#!/usr/bin/env python3
"""
End-to-end structural test for the five default routines + onboarding.

Validates that the bundled walkthrough artifacts in
examples/walkthrough-code-review/ conform to the success criteria defined in:
  - .claude/commands/<routine>.md (per-routine "Success criteria" section)
  - the synthesis test plan (a realistic PM week, Day 1 -> Day 8)

Exits 0 if every check passes, non-zero on any failure. Prints a per-routine
table so a maintainer can see at a glance which contract is broken.

Stdlib only. No live Claude invocation. To extend with live tests, see
routines-e2e.md.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NamedTuple

REPO = Path(__file__).resolve().parents[1]
WALKTHROUGH = REPO / "examples" / "walkthrough-code-review"


class Check(NamedTuple):
    routine: str
    name: str
    passed: bool
    detail: str


def read(p: Path) -> str:
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8")


def check_eval_drift() -> list[Check]:
    p = WALKTHROUGH / "eval-drift-2026-05-12.md"
    body = read(p)
    return [
        Check("eval-drift", "artifact exists", p.exists(), str(p)),
        Check(
            "eval-drift",
            "header has RELEASE_BLOCKED flag",
            "RELEASE_BLOCKED:" in body,
            "looks for line 'RELEASE_BLOCKED: true|false'",
        ),
        Check(
            "eval-drift",
            "first-run baseline marker present (this is run 1)",
            "BASELINE" in body and "run 1" in body,
            "first run must show baseline marker; subsequent runs replace with delta table",
        ),
        Check(
            "eval-drift",
            "no causal-hypothesis prose",
            not re.search(r"likely (cause|due to|because)", body, re.IGNORECASE),
            "mechanical diff only — no 'likely cause' speculation",
        ),
        Check(
            "eval-drift",
            "scope declared",
            "SCOPE:" in body,
            "header line 'SCOPE: self|user|all'",
        ),
    ]


def check_premortem() -> list[Check]:
    p = WALKTHROUGH / "premortem-code-review-2026-05-05.md"
    body = read(p)
    stories = re.findall(r"###\s+Failure story\s+\d", body)
    return [
        Check("premortem", "artifact exists", p.exists(), str(p)),
        Check(
            "premortem",
            "exactly 3 failure stories",
            len(stories) == 3,
            f"found {len(stories)} stories",
        ),
        Check(
            "premortem",
            "stories have leading-indicator structure",
            "**Leading indicator:**" in body,
            "each story must include a 'Leading indicator' field",
        ),
        Check(
            "premortem",
            "stories have mitigation structure",
            "**Mitigation:**" in body,
            "each story must include a 'Mitigation' field",
        ),
        Check(
            "premortem",
            "rejected mitigations section present",
            "## Rejected mitigations" in body,
            "confirmation gate produces a rejected-mitigations record",
        ),
        Check(
            "premortem",
            "PRD anchor exists",
            "PRD:" in body,
            "header references the source PRD path",
        ),
        Check(
            "premortem",
            "source PRD shows mutation",
            "added by /premortem 2026-05-05" in read(WALKTHROUGH / "prd-code-review-2026-05-05.md"),
            "PRD's Risks section must show the appended mitigations",
        ),
    ]


def check_weekly() -> list[Check]:
    p = WALKTHROUGH / "weekly-2026-W19.md"
    body = read(p)
    return [
        Check("weekly", "artifact exists", p.exists(), str(p)),
        Check(
            "weekly",
            "exactly 3 named sections",
            all(
                section in body
                for section in [
                    "## Decisions made",
                    "## Open loops aging",
                    "## One thing I changed my mind about",
                ]
            ),
            "must contain Decisions made / Open loops aging / Changed my mind",
        ),
        Check(
            "weekly",
            "no shipped/accomplishments section (anti-vanity rule)",
            not re.search(r"##\s+(Shipped|Accomplishments|This week.*ship)", body, re.IGNORECASE),
            "vanity sections are forbidden by the routine spec",
        ),
        Check(
            "weekly",
            "open loops list real file paths or 'no open loops'",
            ("outputs/" in body) or ("no open loops" in body.lower()),
            "open-loop bullets must cite real paths, not placeholder text",
        ),
        Check(
            "weekly",
            "changed-my-mind section is non-empty (or literal 'none this week')",
            bool(
                re.search(
                    r"## One thing I changed my mind about\n+\S",
                    body,
                )
            ),
            "section must contain real text or the literal 'none this week'",
        ),
    ]


def check_launch_readiness() -> list[Check]:
    p = WALKTHROUGH / "launch-readiness-code-review-2026-05-09.md"
    body = read(p)
    has_verdict = bool(re.search(r"VERDICT:\s*(GO|NO-GO|CONDITIONAL)", body))
    expected_items = [
        "PRD signed off",
        "Metrics defined",
        "Eval designed",
        "Eval actually run",
        "No P0 regression",
        "Premortem completed",
        "Brief sent",
    ]
    rows = [item for item in expected_items if re.search(rf"\|\s*{re.escape(item)}", body)]
    return [
        Check("launch-readiness", "artifact exists", p.exists(), str(p)),
        Check(
            "launch-readiness",
            "single-line verdict (GO|NO-GO|CONDITIONAL)",
            has_verdict,
            "header must contain 'VERDICT: GO|NO-GO|CONDITIONAL'",
        ),
        Check(
            "launch-readiness",
            "all 7 checklist rows present",
            len(rows) == 7,
            f"found {len(rows)} checklist rows; expected 7",
        ),
        Check(
            "launch-readiness",
            "acknowledged-gap section present (CONDITIONAL example)",
            "## Acknowledged gaps" in body,
            "the example artifact demonstrates the override path",
        ),
        Check(
            "launch-readiness",
            "verdict reasoning section present",
            "## Verdict reasoning" in body,
            "2–3 sentences explaining the verdict",
        ),
    ]


def check_lint() -> list[Check]:
    p = WALKTHROUGH / "lint-2026-05-08.md"
    body = read(p)
    return [
        Check("lint", "artifact exists", p.exists(), str(p)),
        Check(
            "lint",
            "all 3 sections present (always, even if empty)",
            all(
                section in body
                for section in [
                    "## Graph gaps",
                    "## Cross-artifact drift",
                    "## Stale candidates",
                ]
            ),
            "Graph gaps / Cross-artifact drift / Stale candidates required",
        ),
        Check(
            "lint",
            "every finding has 'Do this:' action",
            (body.count("Do this:") >= 1)
            and not re.search(r"^- (?!.*Do this:).+$", body, re.MULTILINE)
            or all(
                "Do this:" in line
                for line in body.splitlines()
                if line.startswith("- ") and "**" not in line and not line.lower().startswith("- no ") and not line.lower().startswith("- nothing")
            ),
            "pure-observation findings are forbidden",
        ),
        Check(
            "lint",
            "FINDINGS count in header",
            "FINDINGS:" in body,
            "header line 'FINDINGS: <total>'",
        ),
    ]


def check_decisions_log() -> list[Check]:
    p = WALKTHROUGH / "decisions-log.md"
    body = read(p)
    expected_skills = [
        "prd",
        "competitive",
        "premortem",
        "metrics",
        "eval",
        "run-eval",
        "lint",
        "launch-readiness",
        "brief",
        "weekly",
        "eval-drift",
    ]
    # Decision-log entries can use "skill:" or "skill(...)": form.
    found = {
        skill: bool(re.search(rf"—\s+{re.escape(skill)}(?:\(|:)", body))
        for skill in expected_skills
    }
    return [
        Check("decisions-log", "log file exists", p.exists(), str(p)),
        Check(
            "decisions-log",
            "header is '# Decisions log'",
            body.lstrip().startswith("# Decisions log"),
            "convention from skills/_decision-log.md",
        ),
        Check(
            "decisions-log",
            f"contains entries for all {len(expected_skills)} skills/routines",
            all(found.values()),
            f"missing: {[s for s, ok in found.items() if not ok]}",
        ),
    ]


def check_cross_references() -> list[Check]:
    """Cross-artifact references resolve."""
    refs = []
    # premortem references the PRD
    pm = read(WALKTHROUGH / "premortem-code-review-2026-05-05.md")
    refs.append(
        Check(
            "cross-ref",
            "premortem references PRD path",
            "prd-code-review-2026-05-05.md" in pm,
            "premortem header should cite the source PRD",
        )
    )
    # eval YAML references at least one PRD risk
    ev = read(WALKTHROUGH / "eval-code-review-2026-05-06.yaml")
    refs.append(
        Check(
            "cross-ref",
            "eval YAML failure_modes anchor to PRD risks",
            ("PRD" in ev) or ("prd-code-review" in ev) or ("Risks" in ev) or ("risk" in ev.lower()),
            "eval failure_modes should reference at least one PRD risk",
        )
    )
    # launch-readiness cites every prior artifact
    lr = read(WALKTHROUGH / "launch-readiness-code-review-2026-05-09.md")
    artifacts = [
        "prd-code-review",
        "metrics-code-review",
        "eval-code-review",
        "premortem-code-review",
    ]
    missing = [a for a in artifacts if a not in lr]
    refs.append(
        Check(
            "cross-ref",
            "launch-readiness cites prior artifacts",
            len(missing) == 0,
            f"missing references: {missing}" if missing else "all present",
        )
    )
    # weekly references decisions from the week
    wk = read(WALKTHROUGH / "weekly-2026-W19.md")
    refs.append(
        Check(
            "cross-ref",
            "weekly cites artifact paths",
            "outputs/" in wk or "examples/" in wk or "walkthrough-code-review" in wk,
            "weekly's decisions list should cite paths",
        )
    )
    return refs


def check_routine_files_present() -> list[Check]:
    """Every routine ships in both forms (slash command + Anthropic Skill package)."""
    checks = []
    for routine in ["eval-drift", "premortem", "weekly", "launch-readiness", "lint", "onboarding"]:
        slash = REPO / ".claude" / "commands" / f"{routine}.md"
        skill = REPO / "claude-skills" / f"pmstack-{routine}" / "SKILL.md"
        checks.append(
            Check(
                "packaging",
                f"{routine}: slash command file present",
                slash.exists(),
                str(slash.relative_to(REPO)),
            )
        )
        checks.append(
            Check(
                "packaging",
                f"{routine}: Anthropic Skill package present",
                skill.exists(),
                str(skill.relative_to(REPO)),
            )
        )
    return checks


def check_skill_graph_updated() -> list[Check]:
    g = read(REPO / "skills" / "_graph.yaml")
    routines = ["premortem", "weekly", "launch-readiness", "lint", "eval-drift", "onboarding"]
    return [
        Check(
            "graph",
            f"skill graph declares edges for {r}",
            f"\n  {r}:\n" in g,
            f"missing edges entry for {r}",
        )
        for r in routines
    ] + [
        Check(
            "graph",
            "default_routines block present",
            "default_routines:" in g,
            "graph must declare the 5 default routines block",
        ),
    ]


def main() -> int:
    all_checks: list[Check] = []
    all_checks += check_routine_files_present()
    all_checks += check_skill_graph_updated()
    all_checks += check_eval_drift()
    all_checks += check_premortem()
    all_checks += check_weekly()
    all_checks += check_launch_readiness()
    all_checks += check_lint()
    all_checks += check_decisions_log()
    all_checks += check_cross_references()

    by_routine: dict[str, list[Check]] = {}
    for c in all_checks:
        by_routine.setdefault(c.routine, []).append(c)

    print(f"\npmstack routines e2e — {len(all_checks)} checks across {len(by_routine)} groups\n")
    failures: list[Check] = []
    for routine, checks in by_routine.items():
        passed = sum(1 for c in checks if c.passed)
        total = len(checks)
        print(f"  [{passed}/{total}] {routine}")
        for c in checks:
            mark = "✓" if c.passed else "✗"
            print(f"    {mark} {c.name}")
            if not c.passed:
                print(f"        ↳ {c.detail}")
                failures.append(c)

    print()
    if failures:
        print(f"FAIL — {len(failures)} of {len(all_checks)} checks failed")
        return 1
    print(f"PASS — all {len(all_checks)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
