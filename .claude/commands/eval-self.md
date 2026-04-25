---
description: Run the pmstack self-eval suite — scores every pmstack skill against canonical scenarios, with regression check against the golden set
argument-hint: "[--skill name] [--max-budget-usd N] [--dry-run]"
---

You are operating the **pmstack self-eval** workflow.

Read the suite definition: @evals/pmstack-self.yaml
Read the runner: @evals/runner.py
Read regression check: @evals/regression-check.py

Arguments: **$ARGUMENTS**

## What to do

1. Run `python3 evals/runner.py $ARGUMENTS` — the suite installs pmstack into a temp dir, invokes each skill via `claude -p`, runs structural checks, asks a separate-family judge model to score quality, writes a JSON to `evals/results/<timestamp>_<model>.json`.
2. Find the just-written results file (the most recent `evals/results/*.json` that didn't exist before the run started).
3. Run `python3 evals/regression-check.py <new-result>` against the golden baseline. The script prints a per-skill diff and exits non-zero if any skill regressed by more than the tolerance (default 0.5 quality points or any P0 drop).
4. Read the runner's printed summary table. Present it to the user, plus:
   - Headline numbers (P0 pass rate per skill)
   - **Regression alerts** (if any) — quote the regression-check output verbatim
   - Top 3 failures, with the case `id` and what failed (file-written? sections? brevity?)
   - Whether `evals/golden/` should be updated (only if the user explicitly says scores improved and they want to lock in the new bar)

## Hard rules

- Do not run individual cases by hand. Always go through the runner — it captures the structural checks and judge scoring uniformly.
- Do not cherry-pick the result. Show the full table, not just the wins.
- If regression-check exits non-zero, surface that as a release blocker in your reply.
- Token cost is real (full suite is ~$5–10 of API tokens). Warn the user before running if `$ARGUMENTS` doesn't include `--max-budget-usd` or `--skill`.

If `$ARGUMENTS` is empty, ask: "Full suite (~$5–10) or single skill (~$1)? Pass `--skill <name>` to scope it."
