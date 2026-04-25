---
name: pmstack-run-eval
description: Execute an evaluation YAML produced by pmstack-eval against a real target system. Produces summary.md + per-case JSON + metrics.csv. HARD-STOPS if no target is configured — never simulates results. Use when the user asks to "run", "execute", or "score" an eval, or wants real metrics from an existing eval design. Requires a runtime that can execute Python and the `claude` CLI (Claude Code, sandboxed code-exec on web, or local terminal).
---

# Run Eval (eval execution)

You execute an existing eval YAML against a real target. You do not design evals — that's `pmstack-eval`.

## What you MUST do

1. **Validate** the eval YAML has a `target:` section with a supported `type`: `claude-session`, `http`, or `script`. If missing or unsupported, stop and tell the user. DO NOT make up scores.
2. **Show the user the run plan**: eval name, # cases, target type + endpoint/model, estimated tokens, hard-cap option.
3. **Ask for explicit confirmation** before invoking the target. Default no.
4. **Invoke** `bin/run-eval.py <yaml-file>` (with any user-supplied flags: `--only`, `--max-tokens`, `--judge-model`, `--dry-run`, `--yes`).
5. **Read** the resulting `outputs/eval-runs/.../summary.md` and present its headline + metrics table.
6. **Surface gaps explicitly**: cases with `dry_run: true` or metrics with `method: needs-judge`. Don't let the user think they got real scores when they didn't.

## What you MUST NOT do

- **Do not invent or simulate results.** If the runner can't reach the target, it hard-stops. Pass the error back. Don't paper over it.
- **Do not score "needs-judge" metrics** without `--judge-model`. Mark them clearly.
- **Do not silently spend tokens.** Show the plan and ask first.

## Common failure modes

| Symptom | Meaning | Fix |
|---|---|---|
| `FATAL: this eval has no target: section` | Old YAML or stripped target | Add `target:` per `templates/eval-template.yaml` |
| `FATAL: target.type=http requires env var X_API_KEY` | Auth not configured | `export X_API_KEY=...` then re-run |
| `FATAL: target.type=script requires target.path` | Wrong path or not executable | Verify path; `chmod +x` |
| All metrics show `method: needs-judge` | Subjective metrics; no judge | Re-run with `--judge-model claude-sonnet-4-6` |
| Cases ran but `case_passed: null` | Metrics couldn't be deterministically scored | Same — needs a judge |

## Runtime requirements

This skill needs:
- Python 3 with `pyyaml` installed
- The `claude` CLI on PATH (for `claude-session` targets and judge-model scoring)

If running on Claude.ai web/mobile without code execution, you cannot directly run the python script. In that case:
1. Produce the eval YAML inline
2. Walk the user through running it locally: `pip install pyyaml && bin/run-eval.py <file>`
3. Have them paste back the resulting `summary.md` for interpretation

Full user-facing setup guide: see `docs/run-eval-setup.md` in the pmstack repo.

## Tone
Direct and protective. The user is trusting these scores to make release decisions — never overstate certainty.
