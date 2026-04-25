#!/usr/bin/env python3
"""
Regression check for pmstack self-eval results.

Compares a fresh runner result JSON against the locked golden baseline at
evals/golden/baseline.json. Exits non-zero (release blocker) if:
  - any skill's P0 pass rate dropped
  - any skill's mean quality dropped by more than the tolerance (default 0.5)

Usage:
  python3 evals/regression-check.py evals/results/<new>.json
  python3 evals/regression-check.py <new> --tolerance 0.3
  python3 evals/regression-check.py --update <new>     # lock new run as golden

Cases not present in BOTH the golden and the new run are skipped (test set
churn is normal — only compare what's comparable).
"""
from __future__ import annotations
import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "evals" / "golden" / "baseline.json"


def load(p: Path) -> dict:
    if not p.exists():
        sys.exit(f"file not found: {p}")
    return json.loads(p.read_text())


def case_p0_passed(c: dict) -> bool:
    return all(c.get("structural", {}).get(k) for k in
               ("file-written", "file-non-empty", "file-parses", "required-sections-present"))


def skill_summary(skill_data: dict, only_ids: set | None = None) -> dict:
    cases = skill_data.get("cases", [])
    if only_ids is not None:
        cases = [c for c in cases if c["id"] in only_ids]
    qualities = [c["weighted_quality"] for c in cases if c.get("weighted_quality") is not None]
    return {
        "n": len(cases),
        "p0_pass": sum(1 for c in cases if case_p0_passed(c)),
        "mean_quality": round(sum(qualities) / len(qualities), 2) if qualities else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("new_result", type=Path, nargs="?")
    ap.add_argument("--tolerance", type=float, default=0.5,
                    help="Max acceptable drop in mean quality per skill (default 0.5)")
    ap.add_argument("--update", action="store_true",
                    help="Replace the golden baseline with the new result")
    args = ap.parse_args()

    if not args.new_result:
        sys.exit("usage: regression-check.py <new-result.json> [--tolerance N] [--update]")

    new = load(args.new_result)

    if args.update:
        new["_locked_at"] = new.get("started_at", "")
        new["_note"] = f"Golden baseline locked from {args.new_result.name}"
        GOLDEN.write_text(json.dumps(new, indent=2))
        print(f"Updated golden: {GOLDEN}")
        return 0

    golden = load(GOLDEN)
    regressions = []

    print(f"# Regression check vs {GOLDEN.name}\n")
    print(f"| skill | golden P0 | new P0 | golden q | new q | delta | status |")
    print(f"|---|---|---|---|---|---|---|")

    for skill in sorted(set(golden["skills"]) | set(new["skills"])):
        if skill not in golden["skills"]:
            print(f"| {skill} | — | new skill in suite | — | — | — | INFO |")
            continue
        if skill not in new["skills"]:
            print(f"| {skill} | present | MISSING from new run | — | — | — | WARN |")
            continue

        golden_ids = {c["id"] for c in golden["skills"][skill]["cases"]}
        new_ids = {c["id"] for c in new["skills"][skill]["cases"]}
        common = golden_ids & new_ids

        if not common:
            print(f"| {skill} | — | — | — | — | — | NO COMMON CASES |")
            continue

        gs = skill_summary(golden["skills"][skill], common)
        ns = skill_summary(new["skills"][skill], common)

        delta = None
        if gs["mean_quality"] is not None and ns["mean_quality"] is not None:
            delta = round(ns["mean_quality"] - gs["mean_quality"], 2)

        status = "OK"
        if ns["p0_pass"] < gs["p0_pass"]:
            status = "FAIL: P0 regression"
            regressions.append((skill, "P0 dropped", gs["p0_pass"], ns["p0_pass"]))
        elif delta is not None and delta < -args.tolerance:
            status = f"FAIL: quality dropped {delta:+}"
            regressions.append((skill, "quality drop", gs["mean_quality"], ns["mean_quality"]))

        print(f"| {skill} | {gs['p0_pass']}/{gs['n']} | {ns['p0_pass']}/{ns['n']} "
              f"| {gs['mean_quality']} | {ns['mean_quality']} | "
              f"{delta if delta is not None else '—'} | {status} |")

    print()
    if regressions:
        print(f"{len(regressions)} regression(s) detected.\n")
        print("To accept the new baseline (only if you've verified the change is intentional):")
        print(f"  python3 evals/regression-check.py {args.new_result} --update")
        return 1

    print("No regressions detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
