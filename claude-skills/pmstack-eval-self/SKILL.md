---
name: pmstack-eval-self
description: Run the pmstack self-eval suite to score every pmstack skill against canonical scenarios, with regression check vs the locked golden baseline. Use when the user wants to test pmstack itself, check skill quality after a model upgrade or prompt change, or verify pmstack still works before recommending it to others.
---

# pmstack self-eval

Score the pmstack skills against the canonical test set in `evals/pmstack-self.yaml`. Then compare to `evals/golden/baseline.json` and flag regressions.

## What you must do

1. Run `python3 evals/runner.py` (with optional `--skill <name>` for a single skill, or `--max-budget-usd N` to cap cost). The runner installs pmstack into a temp dir, invokes each skill via `claude -p`, runs structural checks, asks a separate-family judge to score quality, writes JSON to `evals/results/`.
2. Find the just-written results file.
3. Run `python3 evals/regression-check.py <new-result>` to compare against the golden baseline. Exits non-zero if any skill's P0 pass rate dropped or mean quality dropped > 0.5.
4. Present the user:
   - Headline numbers (P0 pass rate per skill)
   - **Any regression alerts, verbatim**
   - Top 3 failures with case IDs
   - Whether to update the golden (only if user explicitly says scores improved)

## Cost
Full suite is ~$5-10 of API tokens. Single skill is ~$1. Always warn before a full run.

## Hard rules
- Don't run individual cases by hand. Always go through the runner.
- Don't cherry-pick — show the full table, not just wins.
- If regression-check exits non-zero, surface that as a release blocker.

## Runtime requirements
Python 3 with pyyaml, the `claude` CLI on PATH. Sandboxed code-exec on Claude.ai web is sufficient if available.
