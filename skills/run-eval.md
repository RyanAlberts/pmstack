# Skill: Run Eval (eval execution)

## Trigger
`/run-eval [path-to-eval-yaml]`

## Goal
Actually execute an evaluation suite produced by `/eval`. Produce real metrics, not narrated guesses.

## What you MUST do

1. **Validate** the eval YAML has a `target:` section with a supported `type` (`claude-session`, `http`, or `script`). If missing or unsupported, stop and tell the user — DO NOT make up scores.
2. **Show the run plan to the user**:
   - Eval name + how many test cases
   - Target type + endpoint/model
   - Estimated tokens / API calls
   - Hard-cap option (`--max-tokens`)
3. **Ask for explicit confirmation** before invoking the target. Default to NO.
4. **Invoke** `bin/run-eval.py <yaml-file>` (with any user-supplied flags — `--only`, `--max-tokens`, `--judge-model`, `--dry-run`, `--yes`).
5. **Read** the resulting `outputs/eval-runs/<feature-slug>-<date>/summary.md` and present its headline + metrics table to the user.
6. **Be explicit about gaps**: if any case has `dry_run: true` in evidence, or any metric reports `method: needs-judge`, surface those in your reply. Do not let the user think they got real scores when they didn't.

## What you MUST NOT do

- **Do not invent or simulate results.** If the runner can't reach the target, it hard-stops. Pass that error back to the user, don't paper over it.
- **Do not score metrics that the runner left as "needs-judge"** unless the user passed `--judge-model`. Mark them clearly.
- **Do not silently spend tokens.** If estimated tokens > 200,000 or if user did not pass `--yes`, you must show the plan and ask first.

## Common failure modes you will see

| Symptom | What it means | Fix |
|---|---|---|
| `FATAL: this eval has no target: section` | YAML is from old `/eval` template OR target was stripped | Add a `target:` block per `templates/eval-template.yaml` |
| `FATAL: target.type=http requires env var X_API_KEY` | Auth not configured | `export X_API_KEY=...` then re-run |
| `FATAL: target.type=script requires target.path` | Wrong path or not executable | Verify path; `chmod +x` if needed |
| All metrics show `method: needs-judge` | Subjective metrics; no judge model configured | Re-run with `--judge-model claude-sonnet-4-6` |
| Cases ran but `case_passed: null` | Metrics couldn't be deterministically scored | Same as above — needs a judge |

## Tone
Direct and protective. The user is trusting these scores to make release decisions — never overstate certainty.
