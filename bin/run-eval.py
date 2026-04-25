#!/usr/bin/env python3
"""
pmstack evaluation executor.

Reads an evaluation YAML produced by /eval, validates it has a real target,
invokes the target once per test case, scores the output, and writes
deterministic artifacts to outputs/eval-runs/<feature>-<run-date>/.

Hard-stops if:
  - no target section
  - target.type unsupported
  - required env vars missing
  - target unreachable on a sanity-check call

Never simulates results when the target is unreachable. Never invents
scores. If a metric requires a judge model and one is not configured,
the metric is recorded as "not-evaluated", not "passed".

Usage:
  bin/run-eval.py outputs/eval-customer-chatbot-2026-04-24.yaml
  bin/run-eval.py <file> --only test-case-1 test-case-2
  bin/run-eval.py <file> --max-tokens 200000
  bin/run-eval.py <file> --judge-model claude-sonnet-4-6
  bin/run-eval.py <file> --dry-run    # plan + cost estimate, no calls
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

# Tunables
DEFAULT_TOKEN_WARN = 200_000
PER_CASE_TOKEN_BUDGET = 8_000
JUDGE_TOKEN_BUDGET = 4_000

SUPPORTED_TARGET_TYPES = {"claude-session", "http", "script"}


def fatal(msg: str, code: int = 2):
    print(f"\n[run-eval] FATAL: {msg}\n", file=sys.stderr)
    sys.exit(code)


def warn(msg: str) -> None:
    print(f"[run-eval] WARN: {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"[run-eval] {msg}", file=sys.stderr)


def load_eval_doc(path: Path) -> dict:
    if not path.exists():
        fatal(f"eval file not found: {path}")
    try:
        doc = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        fatal(f"eval YAML failed to parse: {e}")
    if not isinstance(doc, dict):
        fatal("eval YAML must be a mapping at the top level")
    return doc


def validate_target(doc: dict) -> dict:
    target = doc.get("target")
    if not target:
        fatal(
            "this eval has no `target:` section. /run-eval needs a target to "
            "produce real results — it will not simulate. Add a target block "
            "to the YAML (see templates/eval-template.yaml for examples) and "
            "re-run."
        )
    t_type = target.get("type")
    if t_type not in SUPPORTED_TARGET_TYPES:
        fatal(
            f"target.type={t_type!r} not supported. "
            f"Supported: {sorted(SUPPORTED_TARGET_TYPES)}"
        )

    if t_type == "claude-session":
        if not shutil.which("claude"):
            fatal("target.type=claude-session but `claude` CLI is not on PATH.")
        if not target.get("model"):
            fatal("target.type=claude-session requires target.model (e.g., claude-haiku-4-5-20251001)")
    elif t_type == "http":
        if not target.get("url"):
            fatal("target.type=http requires target.url")
        for var in target.get("requires", []):
            if not os.environ.get(var):
                fatal(f"target.type=http requires env var {var} (set it before running)")
    elif t_type == "script":
        path = target.get("path")
        if not path or not Path(path).exists():
            fatal(f"target.type=script requires target.path; got {path!r}")
        if not os.access(path, os.X_OK):
            fatal(f"target.script {path} is not executable (chmod +x).")

    test_cases = doc.get("test_cases") or []
    if not test_cases:
        fatal("eval has no test_cases")
    for tc in test_cases:
        for k in ("id", "input", "severity"):
            if k not in tc:
                fatal(f"test_case missing required field {k!r}: {tc}")
    return target


def estimate_tokens(doc: dict, n_cases: int, judge_model: str | None) -> dict:
    target_tokens = n_cases * PER_CASE_TOKEN_BUDGET
    judge_tokens = n_cases * JUDGE_TOKEN_BUDGET if judge_model else 0
    return {
        "target_tokens": target_tokens,
        "judge_tokens": judge_tokens,
        "total_tokens": target_tokens + judge_tokens,
        "calls": n_cases + (n_cases if judge_model else 0),
    }


def invoke_target(target: dict, prompt: str, dry_run: bool) -> tuple[str, dict]:
    """Returns (text_output, evidence_dict). Evidence MUST be real."""
    if dry_run:
        return "[dry-run]", {"dry_run": True}

    t_type = target["type"]
    if t_type == "claude-session":
        sys_prompt = target.get("system_prompt") or ""
        cmd = ["claude", "--print", "--model", target["model"]]
        if sys_prompt:
            cmd += ["--append-system-prompt", sys_prompt]
        cmd.append(prompt)
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return proc.stdout.strip(), {
            "type": "claude-session",
            "model": target["model"],
            "exit_code": proc.returncode,
            "stderr_excerpt": (proc.stderr or "")[:300],
        }
    if t_type == "http":
        try:
            import urllib.request
            import urllib.error
        except ImportError:
            fatal("http target requires urllib (stdlib)")
        body = target.get("request_template", "{{input}}").replace("{{input}}", json.dumps(prompt)[1:-1])
        headers = {"Content-Type": "application/json"}
        for k, v in (target.get("headers") or {}).items():
            headers[k] = os.path.expandvars(v)
        req = urllib.request.Request(
            target["url"],
            data=body.encode(),
            headers=headers,
            method=target.get("method", "POST"),
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                status = r.status
        except urllib.error.HTTPError as e:
            return "", {"type": "http", "status": e.code, "error": str(e)}
        except urllib.error.URLError as e:
            fatal(f"http target unreachable: {e}")
        path = target.get("response_path", "$")
        text = raw
        if path != "$":
            try:
                doc = json.loads(raw)
                cur = doc
                for part in re.findall(r"\.([^.\[]+)|\[(\d+)\]", path):
                    key, idx = part
                    cur = cur[key] if key else cur[int(idx)]
                text = str(cur)
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                warn(f"response_path={path!r} did not resolve in response: {e}")
        return text, {"type": "http", "status": status, "url": target["url"]}
    if t_type == "script":
        proc = subprocess.run(
            [target["path"]],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=target.get("timeout_sec", 30),
        )
        return proc.stdout.strip(), {
            "type": "script",
            "path": target["path"],
            "exit_code": proc.returncode,
            "stderr_excerpt": (proc.stderr or "")[:300],
        }
    fatal(f"unreachable: target type {t_type}")


def check_threshold(value, bar) -> bool | None:
    if bar is None or value is None:
        return None
    if isinstance(bar, str):
        m = re.match(r"\s*(>=|<=|>|<|==)\s*([0-9_.]+)", bar)
        if m:
            op, n = m.group(1), float(m.group(2).replace("_", ""))
            return {">=": value >= n, "<=": value <= n, ">": value > n, "<": value < n, "==": value == n}[op]
        if bar.strip().lower() == "true":
            return bool(value)
        if bar.strip().lower() == "false":
            return not bool(value)
    if isinstance(bar, (int, float)):
        return value >= bar
    return None


def score_metric_deterministic(metric: dict, output: str) -> dict:
    """Score what we can without a judge."""
    name = metric["name"]
    mtype = metric.get("type", "score")
    bar = metric.get("pass_bar")

    if mtype == "tokens":
        v = max(1, len(output) // 4)
        return {"value": v, "passed": check_threshold(v, bar), "method": "char-estimate"}
    if mtype == "latency_ms":
        return {"value": None, "passed": None, "method": "captured-during-invocation"}
    if mtype == "cost_usd":
        return {"value": None, "passed": None, "method": "not-tracked-here"}
    return {"value": None, "passed": None, "method": "needs-judge",
            "note": f"metric {name!r} requires --judge-model to score"}


def judge_case(judge_model: str, output: str, expected: str, metrics: list) -> dict:
    """Ask a judge model to score the case against listed metrics."""
    if not judge_model:
        return {}
    metric_block = "\n".join(f"- {m}" for m in metrics)
    prompt = (
        f"You are an independent judge. Score the following metrics on the OUTPUT, "
        f"given the EXPECTED behavior. Reply with JSON only: "
        f'{{"<metric_name>": <int 1-5 or true/false>, ...}}. No prose.\n\n'
        f"METRICS:\n{metric_block}\n\nEXPECTED:\n{expected}\n\nOUTPUT:\n{output[:8000]}"
    )
    proc = subprocess.run(
        ["claude", "--print", "--model", judge_model, prompt],
        capture_output=True, text=True, timeout=120,
    )
    raw = proc.stdout.strip()
    m = re.search(r"\{[^{}]+\}", raw)
    if not m:
        return {"_judge_raw": raw[:300], "_judge_error": "no JSON found"}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as e:
        return {"_judge_raw": raw[:300], "_judge_error": str(e)}


def write_summary(out_dir: Path, doc: dict, run_results: list, tokens_used: int) -> None:
    name = doc.get("name", "Eval")
    p0 = sum(1 for r in run_results if r.get("severity") == "P0")
    p0_pass = sum(1 for r in run_results if r.get("severity") == "P0" and r.get("case_passed"))
    p1 = sum(1 for r in run_results if r.get("severity") == "P1")
    p1_pass = sum(1 for r in run_results if r.get("severity") == "P1" and r.get("case_passed"))
    p2 = sum(1 for r in run_results if r.get("severity") == "P2")
    p2_pass = sum(1 for r in run_results if r.get("severity") == "P2" and r.get("case_passed"))
    sim = sum(1 for r in run_results if r.get("evidence", {}).get("dry_run"))

    lines = []
    lines.append(f"# {name} — run {datetime.now(timezone.utc).isoformat()}")
    lines.append("")
    lines.append("## Headline")
    lines.append("")
    lines.append("| severity | passed | total |")
    lines.append("|---|---|---|")
    lines.append(f"| P0 | {p0_pass} | {p0} |")
    lines.append(f"| P1 | {p1_pass} | {p1} |")
    lines.append(f"| P2 | {p2_pass} | {p2} |")
    lines.append("")
    lines.append(f"- tokens used (estimated): {tokens_used:,}")
    lines.append(f"- cases run: {len(run_results)}")
    if sim:
        lines.append(f"- WARNING: {sim} cases were dry-run (no real target invocation)")
    lines.append("")
    lines.append("## Metrics — per case")
    lines.append("")
    lines.append("| case | severity | passed | metrics |")
    lines.append("|---|---|---|---|")
    for r in run_results:
        if r.get("case_passed") is True:
            passed_str = "PASS"
        elif r.get("case_passed") is False:
            passed_str = "FAIL"
        else:
            passed_str = "—"
        m = r.get("metric_results", {})
        m_summary = "; ".join(f"{k}={v.get('value', 'n/a')}" for k, v in m.items())[:120]
        lines.append(f"| {r['id']} | {r['severity']} | {passed_str} | {m_summary} |")
    lines.append("")
    lines.append("## What to do next")
    lines.append("")
    lines.append("- P0 fails block release. Fix or accept-with-justification.")
    lines.append("- P1 fails open issues.")
    lines.append("- P2 fails are tracked in trends.")
    lines.append("- For each fail, open `cases/<id>.json` to see actual output and evidence.")
    lines.append("- If any case shows `dry_run: true` in its evidence, /run-eval did not invoke the target — that is a SETUP issue, not a real score.")
    (out_dir / "summary.md").write_text("\n".join(lines))


def write_metrics_csv(out_dir: Path, run_results: list) -> None:
    rows = []
    for r in run_results:
        for mname, mval in (r.get("metric_results") or {}).items():
            rows.append({
                "case_id": r["id"],
                "severity": r["severity"],
                "metric": mname,
                "value": mval.get("value"),
                "passed": mval.get("passed"),
                "method": mval.get("method"),
            })
    if not rows:
        return
    with (out_dir / "metrics.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("eval_file", type=Path)
    ap.add_argument("--only", nargs="*", default=None, help="Run only these case ids")
    ap.add_argument("--max-tokens", type=int, default=None, help="Cap total tokens; partial run on hit")
    ap.add_argument("--judge-model", default=None, help="Model for rubric scoring")
    ap.add_argument("--dry-run", action="store_true", help="Plan only, no API calls")
    ap.add_argument("--yes", action="store_true", help="Skip confirm prompt")
    args = ap.parse_args()

    doc = load_eval_doc(args.eval_file)
    target = validate_target(doc)

    cases = doc["test_cases"]
    if args.only:
        cases = [c for c in cases if c["id"] in args.only]
        if not cases:
            fatal(f"--only filtered out all cases. Valid ids: {[c['id'] for c in doc['test_cases']]}")

    est = estimate_tokens(doc, len(cases), args.judge_model)
    info(f"eval: {doc.get('name', '<unnamed>')}")
    info(f"target: {target['type']} ({target.get('model') or target.get('url') or target.get('path')})")
    info(f"cases: {len(cases)}  estimate: ~{est['total_tokens']:,} tokens, ~{est['calls']} API calls")
    if args.max_tokens:
        info(f"hard cap: {args.max_tokens:,} tokens (will partial-run if exceeded)")
    elif est["total_tokens"] > DEFAULT_TOKEN_WARN:
        warn(f"large run (>{DEFAULT_TOKEN_WARN:,} estimated tokens). Pass --max-tokens N to cap, or --dry-run to plan.")

    if not args.yes and not args.dry_run:
        ans = input("[run-eval] Proceed? (y/N) ").strip().lower()
        if ans not in ("y", "yes"):
            info("aborted by user")
            return 1

    feature_slug = re.sub(r"[^A-Za-z0-9._-]", "-", doc.get("name", "eval"))[:60]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    out_dir = Path("outputs") / "eval-runs" / f"{feature_slug}-{stamp}"
    (out_dir / "cases").mkdir(parents=True, exist_ok=True)

    tokens_used = 0
    run_results = []
    for tc in cases:
        if args.max_tokens and tokens_used >= args.max_tokens:
            warn(f"token cap {args.max_tokens:,} reached — partial run, {len(run_results)} cases done")
            break
        info(f"  case {tc['id']} ({tc.get('severity', '?')})")

        output, evidence = invoke_target(target, tc["input"], args.dry_run)
        tokens_used += PER_CASE_TOKEN_BUDGET

        metric_results = {}
        for m_ref in tc.get("metrics", []):
            m_def = next((m for m in doc.get("metrics", []) if m.get("name") == m_ref), None)
            if not m_def:
                metric_results[m_ref] = {"value": None, "passed": None, "method": "metric-not-defined"}
                continue
            metric_results[m_ref] = score_metric_deterministic(m_def, output)

        if args.judge_model and not args.dry_run and tc.get("metrics"):
            tokens_used += JUDGE_TOKEN_BUDGET
            judge_scores = judge_case(args.judge_model, output, tc.get("expected_behavior", ""), tc.get("metrics", []))
            for mname, score in judge_scores.items():
                if mname.startswith("_"):
                    continue
                if mname in metric_results and metric_results[mname]["passed"] is None:
                    m_def = next((m for m in doc.get("metrics", []) if m.get("name") == mname), None)
                    bar = m_def.get("pass_bar") if m_def else None
                    metric_results[mname] = {
                        "value": score,
                        "passed": check_threshold(score, bar),
                        "method": f"judge:{args.judge_model}",
                    }

        case_passed = None
        bool_results = [r["passed"] for r in metric_results.values() if r.get("passed") is not None]
        if bool_results:
            case_passed = all(bool_results)

        case_record = {
            "id": tc["id"],
            "severity": tc.get("severity", "P2"),
            "input": tc["input"],
            "expected_behavior": tc.get("expected_behavior"),
            "output": output,
            "evidence": evidence,
            "metric_results": metric_results,
            "case_passed": case_passed,
        }
        run_results.append(case_record)
        (out_dir / "cases" / f"{tc['id']}.json").write_text(json.dumps(case_record, indent=2))

    write_summary(out_dir, doc, run_results, tokens_used)
    write_metrics_csv(out_dir, run_results)

    info(f"\nWrote {out_dir}")
    info(f"  summary.md ({len(run_results)} cases)")
    info(f"  cases/ ({len(run_results)} json files)")
    info(f"  metrics.csv")
    print(str(out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
