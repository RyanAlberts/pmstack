#!/usr/bin/env python3
"""
pmstack self-eval runner.

Runs each skill in evals/pmstack-self.yaml against a clean install of pmstack,
collects the artifacts written to outputs/, runs structural checks, and asks a
judge model to score quality. Writes a JSON report to evals/results/.

Requires:
  - `claude` CLI on PATH and a logged-in session
  - PyYAML

Usage:
  python evals/runner.py
  python evals/runner.py --target-model claude-haiku-4-5-20251001
  python evals/runner.py --skill eval
  python evals/runner.py --max-budget-usd 5
  python evals/runner.py --dry-run    # plan only, no API calls
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

REPO_ROOT = Path(__file__).resolve().parent.parent
SUITE_PATH = REPO_ROOT / "evals" / "pmstack-self.yaml"
RESULTS_DIR = REPO_ROOT / "evals" / "results"

FORBIDDEN_PHRASES = [
    "i apologize for the confusion",
    "you're absolutely right",
    "great question",
    "certainly!",
    "absolutely!",
]


def install_pmstack(target: Path) -> None:
    """Run ./setup against target — proves install path works each run."""
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [str(REPO_ROOT / "setup"), str(target)],
        check=True,
        capture_output=True,
        text=True,
    )


def invoke_skill(
    project: Path,
    command: str,
    arg: str,
    model: str,
    max_budget: float,
    dry_run: bool,
) -> tuple[str, int]:
    """Invoke a slash command in a project. Returns (stdout, returncode)."""
    prompt = f"{command} {arg}".strip()
    if dry_run:
        return f"[dry-run] would invoke: {prompt} in {project}", 0
    proc = subprocess.run(
        [
            "claude",
            "--print",
            "--model", model,
            "--max-budget-usd", str(max_budget),
            "--permission-mode", "acceptEdits",
            prompt,
        ],
        cwd=project,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.stdout + proc.stderr, proc.returncode


def find_artifact(project: Path, glob: str) -> Path | None:
    matches = sorted(project.glob(glob), key=lambda p: p.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def structural_checks(artifact: Path | None, spec: dict, expectations: dict | None = None) -> dict:
    """Returns dict of {check_id: True|False|None}.

    `expectations.should_ask=True` means the skill is supposed to ask a clarifying
    question instead of producing an artifact — in that case, file-absent is the
    correct behavior and all checks PASS.
    """
    expectations = expectations or {}
    if expectations.get("should_ask") and (artifact is None or not artifact.exists()):
        return {
            "file-written": True,
            "file-non-empty": True,
            "file-parses": True,
            "required-sections-present": True,
            "forbidden-phrases-absent": True,
            "_note": "should_ask=true; artifact-absence is expected",
        }

    out = {
        "file-written": False,
        "file-non-empty": False,
        "file-parses": False,
        "required-sections-present": False,
        "forbidden-phrases-absent": False,
    }
    if artifact is None or not artifact.exists():
        return out
    out["file-written"] = True
    text = artifact.read_text(errors="replace")
    out["file-non-empty"] = len(text.encode()) > 200

    if artifact.suffix in (".yaml", ".yml"):
        try:
            doc = yaml.safe_load(text)
            out["file-parses"] = isinstance(doc, dict)
            sections = list(doc.keys()) if isinstance(doc, dict) else []
            required = spec.get("required_sections", [])
            out["required-sections-present"] = all(s in sections for s in required)
        except yaml.YAMLError:
            out["file-parses"] = False
            out["required-sections-present"] = False
    else:
        out["file-parses"] = bool(re.search(r"^#\s+\S", text, re.M))
        required = spec.get("required_sections", [])
        out["required-sections-present"] = all(s.lower() in text.lower() for s in required)

    lower = text.lower()
    out["forbidden-phrases-absent"] = not any(p in lower for p in FORBIDDEN_PHRASES)
    return out


def judge_quality(
    artifact: Path,
    spec: dict,
    judge_model: str,
    max_budget: float,
    dry_run: bool,
) -> dict:
    """Ask judge model to score the artifact against the rubric. Returns dict of dim → score (1-5)."""
    rubric = spec.get("quality_rubric", [])
    if not rubric or dry_run or artifact is None:
        return {r["dim"]: None for r in rubric}

    rubric_text = "\n".join(
        f"- {r['dim']} (weight {r['weight']}): {r['question']}" for r in rubric
    )
    artifact_text = artifact.read_text(errors="replace")
    if len(artifact_text) > 30_000:
        artifact_text = artifact_text[:30_000] + "\n\n[truncated]"

    prompt = f"""You are an independent judge for a pmstack skill output.

Score the artifact on each rubric dimension, 1 (poor) to 5 (excellent). Output ONLY a JSON object: {{"<dim>": <int>, ...}}. No prose.

Rubric:
{rubric_text}

Artifact (from skill `{spec['name']}`):
---
{artifact_text}
---
"""
    proc = subprocess.run(
        [
            "claude",
            "--print",
            "--model", judge_model,
            "--max-budget-usd", str(max_budget),
            "--permission-mode", "default",
            prompt,
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    raw = proc.stdout.strip()
    match = re.search(r"\{[^{}]+\}", raw)
    if not match:
        return {r["dim"]: None for r in rubric}
    try:
        parsed = json.loads(match.group(0))
        return {r["dim"]: parsed.get(r["dim"]) for r in rubric}
    except json.JSONDecodeError:
        return {r["dim"]: None for r in rubric}


def weighted_score(scores: dict, rubric: list) -> float | None:
    pairs = [(scores.get(r["dim"]), r["weight"]) for r in rubric if isinstance(scores.get(r["dim"]), int)]
    if not pairs:
        return None
    total_w = sum(w for _, w in pairs)
    return round(sum(s * w for s, w in pairs) / total_w, 2)


def run_suite(args) -> dict:
    suite = yaml.safe_load(SUITE_PATH.read_text())
    target_model = args.target_model or suite["run_policy"]["default_target_model"]
    judge_model = args.judge_model or suite["run_policy"]["default_judge_model"]
    per_invoke_budget = max(0.10, args.max_budget_usd / 20)

    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "target_model": target_model,
        "judge_model": judge_model,
        "max_budget_usd": args.max_budget_usd,
        "skills": {},
    }

    skills = suite["skills"]
    if args.skill:
        skills = [s for s in skills if s["name"] == args.skill]
        if not skills:
            sys.exit(f"No skill named {args.skill}")

    with tempfile.TemporaryDirectory(prefix="pmstack-eval-") as tmp:
        project = Path(tmp) / "project"
        install_pmstack(project)
        print(f"  installed pmstack to {project}", file=sys.stderr)

        for spec in skills:
            name = spec["name"]
            print(f"\n=== {name} ===", file=sys.stderr)
            cases = []
            for tc in spec["test_inputs"]:
                print(f"  case {tc['id']} ({tc['category']})", file=sys.stderr)
                # Clean outputs/ between cases for unambiguous artifact attribution.
                outputs_dir = project / "outputs"
                if outputs_dir.exists():
                    shutil.rmtree(outputs_dir)
                outputs_dir.mkdir()

                stdout, rc = invoke_skill(
                    project, spec["command"], tc["input"],
                    target_model, per_invoke_budget, args.dry_run,
                )
                artifact = find_artifact(project, spec["output_glob"])
                struct = structural_checks(artifact, spec, tc.get("expectations"))
                quality = judge_quality(artifact, spec, judge_model, per_invoke_budget, args.dry_run)
                cases.append({
                    "id": tc["id"],
                    "category": tc["category"],
                    "input": tc["input"],
                    "expectations": tc.get("expectations"),
                    "exit_code": rc,
                    "artifact": str(artifact.relative_to(project)) if artifact else None,
                    "stdout_excerpt": (stdout or "")[:600],
                    "structural": struct,
                    "quality": quality,
                    "weighted_quality": weighted_score(quality, spec["quality_rubric"]),
                })
            report["skills"][name] = {"cases": cases}

    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    return report


def summarize(report: dict) -> str:
    lines = [f"# pmstack self-eval — {report['started_at']}", ""]
    lines.append(f"**target:** `{report['target_model']}`  **judge:** `{report['judge_model']}`")
    lines.append("")
    lines.append("| skill | cases | P0 pass | mean quality |")
    lines.append("|---|---|---|---|")
    for name, data in report["skills"].items():
        cases = data["cases"]
        p0_pass = sum(
            1 for c in cases if all(
                c["structural"].get(k) for k in ("file-written", "file-non-empty", "file-parses", "required-sections-present")
            )
        )
        qualities = [c["weighted_quality"] for c in cases if c["weighted_quality"] is not None]
        mean_q = round(sum(qualities) / len(qualities), 2) if qualities else "—"
        lines.append(f"| {name} | {len(cases)} | {p0_pass}/{len(cases)} | {mean_q} |")
    return "\n".join(lines)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--target-model", default=None)
    p.add_argument("--judge-model", default=None)
    p.add_argument("--skill", default=None, help="Run only this skill")
    p.add_argument("--max-budget-usd", type=float, default=5.0)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not shutil.which("claude") and not args.dry_run:
        sys.exit("claude CLI not found on PATH — install it or use --dry-run")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    report = run_suite(args)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    safe_model = re.sub(r"[^A-Za-z0-9._-]", "-", report["target_model"])
    out_path = RESULTS_DIR / f"{stamp}_{safe_model}.json"
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nWrote {out_path}", file=sys.stderr)
    print("\n" + summarize(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
