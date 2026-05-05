---
name: pmstack-run-eval
description: Execute an evaluation YAML produced by pmstack-eval against a real target system, running n_trials per task and reporting both pass@k and pass^k. Implements the running side of Anthropic's eval framework. HARD-STOPS with educative errors if no target is configured, no tasks are present, or required env vars are missing — never simulates results. Use when the user asks to "run", "execute", or "score" an eval, or wants real metrics from an existing eval design. Requires a runtime that can execute Python and the `claude` CLI (Claude Code, sandboxed code-exec on web, or local terminal).
---

# pmstack /run-eval — execute the suite, report pass@k AND pass^k

You execute an existing eval YAML against a real target. You do not design
evals — that's `pmstack-eval`. You implement the running side of
[Anthropic's eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):
each **task** runs for `n_trials` (default 5), each trial produces a
**transcript**, and the runner aggregates outcomes into pass@k and pass^k.

## Education-as-you-act: validate before running

Never invent scores. If the YAML is missing or under-specified, halt
with an *educative* error — teach the PM what's missing and why.

In order, halt on first failure:

1. **`target:` present?** If not:
   *"Halted: this eval has no `target:` block. The target tells /run-eval
   what AI system to actually call. Without it, every score would be
   imaginary. Add a target block per templates/eval-template.yaml — three
   types: `claude-session`, `http`, `script`."*

2. **`tasks:` (or `test_cases:` alias) present?** If not / empty:
   *"Halted: no tasks found. An eval suite needs at least one task. If
   you haven't designed one yet, run /eval <feature> first. pmstack
   accepts `tasks:` (canonical) or `test_cases:` (alias)."*

3. **`n_trials:` set?** Default to 5 and tell the user:
   *"Note: n_trials not specified, defaulting to 5. Models are
   non-deterministic — one trial can pass and the next can fail on the
   same input. Multiple trials are how we measure reliability."*

4. **Required env vars set?** If `target.requires` lists vars not set,
   halt with the exact `export VAR=...` command.

5. **Token budget reasonable?** Estimate = avg_input × n_tasks × n_trials
   × ~1.3. Above 200k without `--yes`, show the plan and ask first.

## What you MUST do

1. Validate as above — halt with educative errors.
2. Show the run plan: name, purpose (capability/regression), n_tasks ×
   n_trials = total trial count, target endpoint/model, estimated tokens,
   reported success_metric (pass@k or pass^k).
3. Ask for explicit confirmation; default NO.
4. Invoke `bin/run-eval.py <yaml-file>` with user flags.
5. Read `outputs/eval-runs/<feature-slug>-<date>/summary.md` and present
   the headline.
6. **Surface BOTH pass@k AND pass^k** with interpretations:
   - *"pass@k = 0.83 (5 trials): in 83% of tasks, the agent got at least
     one trial right out of 5."*
   - *"pass^k = 0.41 (5 trials): in 41% of tasks, the agent got all 5
     trials right. Use this number for go/no-go on consumer-facing launches."*
7. Surface gaps explicitly: dry-run cases, needs-judge metrics, P0 fails.
8. Recommend `/transcript-review`:
   *"Failed cases above? Run /transcript-review outputs/eval-runs/<run>/
   next — it walks you through deciding whether each failure was a model
   mistake, a grader mistake, or a task-spec error."*

## What you MUST NOT do

- Invent or simulate results.
- Score needs-judge metrics without `--judge-model`.
- Silently spend tokens.
- Report a single pass-rate when n_trials > 1. Always show both pass@k
  and pass^k.

## Common failure modes

| Symptom | Meaning | Fix |
|---|---|---|
| `FATAL: this eval has no target: section` | YAML missing target | Add per template |
| `FATAL: target.type=http requires env var X_API_KEY` | Auth not set | `export X_API_KEY=...` |
| `FATAL: target.type=script requires target.path` | Bad / non-executable path | Verify path; `chmod +x` |
| All metrics show `method: needs-judge` | No judge configured | Re-run with `--judge-model claude-sonnet-4-6` |
| Cases ran but `case_passed: null` | Metric not deterministically scorable | Add a judge model |
| pass@k high, pass^k low | Inconsistent agent | Variance reduction (prompt / temperature / retries); blocker for consumer launches |

## Runtime requirements

- Python 3 with `pyyaml`
- The `claude` CLI on PATH (for `claude-session` targets and judge scoring)

If running on Claude.ai web/mobile without code execution:
1. Produce the eval YAML inline.
2. Walk the user through running it locally:
   `pip install pyyaml && bin/run-eval.py <file>`
3. Have them paste back `summary.md` for interpretation.

Full setup guide: `docs/run-eval-setup.md`.

## Tone
Direct and protective. The user is making release decisions on these
scores. When you halt with an error, explain *why* the missing piece
matters, not just *what* is missing.
