# Skill: Run Eval (`/run-eval`)

## Trigger
`/run-eval [path-to-eval-yaml]`

## Goal
Execute an evaluation suite produced by `/eval`. Produce real metrics, never
simulated guesses. Output the right interpretation for the suite's
`success_metric` (pass@k or pass^k) across `n_trials`.

This skill executes Anthropic's vocabulary: each **task** is run for
`n_trials` (default 5), producing `n_trials` **transcripts** per task. The
runner aggregates outcomes and reports pass@k AND pass^k.

## Education-as-you-act: validate before running

Never invent scores. If the eval YAML is missing or under-specified, halt
with an *educative* error that teaches the PM what's missing and why.

Run these validations in order, halting on the first failure:

1. **`target:` present?** If not:
   *"Halted: this eval has no `target:` block. The target tells `/run-eval`
   what AI system to actually call. Without it, every score would be
   imaginary. Add a target block per `templates/eval-template.yaml`. Three
   types are supported: `claude-session` (call a Claude model directly),
   `http` (POST to your AI's endpoint), `script` (pipe to a local executable)."*

2. **`tasks:` (or `test_cases:`) present?** If not, or empty:
   *"Halted: no tasks found. An eval suite needs at least one task. If you
   haven't designed one yet, run `/eval <feature-name>` first. If you
   thought you had tasks, check the YAML — pmstack accepts `tasks:`
   (canonical) or `test_cases:` (alias)."*

3. **`n_trials:` set?** If not, default to 5 and tell the user:
   *"Note: n_trials not specified, defaulting to 5. Anthropic recommends
   multiple trials per task because models are non-deterministic — one
   trial can pass and the next can fail on the same input."*

4. **Required env vars set?** If `target.requires:` lists vars not set,
   halt with the exact `export VAR=...` command needed.

5. **Token budget reasonable?** Estimate tokens = (avg_input × n_tasks ×
   n_trials × ~1.3 for output). If > 200,000 and `--yes` not passed, show
   the budget and ask before invoking.

## What you MUST do

1. **Validate** per above — halt on any missing field with an educative error.
2. **Show the run plan**:
   - Suite name + purpose (capability vs. regression)
   - n_tasks × n_trials = total trial count
   - Target type + endpoint/model
   - Estimated token spend
   - success_metric the run will report (pass@k or pass^k)
3. **Ask for confirmation** before invoking. Default to NO.
4. **Invoke** `bin/run-eval.py <yaml-file>` with any user flags
   (`--only`, `--max-tokens`, `--judge-model`, `--dry-run`, `--yes`).
5. **Read** the resulting `outputs/eval-runs/<feature-slug>-<date>/summary.md`
   and present its headline.
6. **Surface both pass@k and pass^k** in the readout, with one-line
   interpretations:
   - *"pass@k = 0.83 (5 trials): in 83% of tasks, the agent got at least
     one trial right out of 5."*
   - *"pass^k = 0.41 (5 trials): in 41% of tasks, the agent got all 5
     trials right. Use this number for go/no-go on consumer-facing launches."*
7. **Surface gaps explicitly**: cases with `dry_run: true`, metrics with
   `method: needs-judge`, P0 fails. Don't let the user think they got
   real scores when they didn't.
8. **Recommend `/transcript-review`** at the end:
   *"Failed cases above? Run `/transcript-review outputs/eval-runs/<run>/`
   next — it walks you through deciding whether each failure was a model
   mistake, a grader mistake, or a task-spec error."*

## What you MUST NOT do

- **Invent or simulate results.** If the runner can't reach the target,
  hard-stop and pass the error back. Never paper over it.
- **Score `needs-judge` metrics** without a judge model. Mark them clearly.
- **Silently spend tokens.** Show the plan and ask first.
- **Report a single pass-rate number when n_trials > 1.** Always show both
  pass@k and pass^k with their interpretations.

## Common failure modes

| Symptom | What it means | Fix |
|---|---|---|
| `FATAL: this eval has no target: section` | YAML missing target | Add `target:` per template |
| `FATAL: target.type=http requires env var X_API_KEY` | Auth not configured | `export X_API_KEY=...` |
| `FATAL: target.type=script requires target.path` | Wrong / non-executable path | Verify path; `chmod +x` |
| All metrics show `method: needs-judge` | Subjective metrics; no judge | Re-run with `--judge-model claude-sonnet-4-6` |
| Cases ran but `case_passed: null` | Metrics couldn't be scored deterministically | Same — needs a judge |
| pass@k high, pass^k low | Agent succeeds *some* times but inconsistently | If launch is consumer-facing, this is a blocker — focus on variance reduction (prompt, temperature, retries) |

## Tone
Direct and protective. The user is making release decisions on these
scores — never overstate certainty. Teach as you act: when you halt with
an error, explain *why* the missing piece matters, not just *what* is
missing.
