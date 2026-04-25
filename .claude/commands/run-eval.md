---
description: Execute an eval YAML produced by /eval — runs against a real target, scores metrics, writes summary.md + metrics.csv. HARD-STOPS if no target configured (no fake results).
argument-hint: "[path-to-eval-yaml] [--only id1 id2] [--max-tokens N] [--judge-model NAME] [--dry-run]"
---

You are operating the **Run Eval** skill from pmstack.

Read the full skill: @skills/run-eval.md

Arguments: **$ARGUMENTS**

## Critical context (DO NOT skip — affects correctness)

This command does NOT design evals. It EXECUTES an existing eval YAML against a real target system, then writes deterministic artifacts to `outputs/eval-runs/<feature>-<date>/`.

**HARD STOP behavior**: if the YAML lacks a `target:` section or the target is unreachable, the runner FAILS with a clear error message. It does NOT simulate results. If you (the assistant) try to fabricate scores when the runner stops, you have introduced a hallucination. Don't.

Full setup guide: [docs/run-eval-setup.md](../../docs/run-eval-setup.md) — read this if the user asks "what do I need to set up first?"

## What to do

1. If `$ARGUMENTS` is empty or doesn't include an eval YAML path, ask for one and stop.
2. Read the YAML. Show the user a one-line summary: name, # cases, target type, target endpoint/model.
3. Run `bin/run-eval.py <yaml-path> --dry-run` first to validate target + show estimate. Always do this before a real run on a YAML you haven't run before.
4. If the dry-run validates cleanly, ask the user to confirm with one y/n. Default no.
5. On confirm, run `bin/run-eval.py <yaml-path>` (passing through any `--only`, `--max-tokens`, `--judge-model`, `--yes` flags from `$ARGUMENTS`).
6. After the run finishes, read `outputs/eval-runs/.../summary.md` and post the headline + metrics table to the user.
7. **Surface gaps explicitly**: if any case is `dry_run`, or any metric used `method: needs-judge` without a judge model, say so. Tell the user the score is incomplete.

## Hard rules (these are anti-hallucination guards)

- **Never invent metric scores.** If the runner says `case_passed: null`, you say "needs judge model" — not "passed".
- **Never claim a target was invoked when it wasn't.** Look at `evidence.dry_run`. If true, the target was not reached.
- **Never silently retry a fatal error.** If the runner hard-stops, surface that to the user with the exact fix from the skill's "Common failure modes" table.
- **Token cap, not dollar cap.** Never translate to dollars in the output — the user explicitly chose token-based budgeting because it's reproducible across pricing changes.
