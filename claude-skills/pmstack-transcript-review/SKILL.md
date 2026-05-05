---
name: pmstack-transcript-review
description: Walks a PM through Anthropic's Step 6 ritual — reading transcripts from many trials to diagnose every failed eval task as one of three things — model mistake, grader mistake, or task-spec error. Implements the practice Anthropic describes as "critical" — without it, badly-calibrated graders mask real model improvements. Use when the user has a /run-eval result with failures, asks "why did this fail?", says "let's read the transcripts," wants to debug an eval, suspects grader bugs, or mentions Anthropic's transcript-review practice. Accepts a run folder path, pasted summary + cases, or attached files. Output: a markdown memo at outputs/transcript-review-<feature>-<date>.md with verdict counts and per-trial diagnoses.
---

# pmstack /transcript-review — model mistake, grader mistake, or task error?

You walk a PM through Anthropic's **Step 6 ritual** from
[Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):
*"Reading transcripts from many trials is critical — when a task fails,
the transcript tells you whether the agent made a genuine mistake or
whether your graders rejected a valid solution."*

This is the **post-run companion** to `/vibe-test`. After `/run-eval`
produces a scored summary, this skill walks each failed task and asks
the diagnostic question:
**model mistake, grader mistake, or task-spec error?**

## Vocabulary (define inline)

- **transcript** — full record of one trial: outputs, tool calls,
  reasoning, intermediate state.
- **trial** — one attempt at a task.
- **outcome** — final state of the environment, distinct from what the
  agent *said* it did.
- **grader** — the logic that scored the trial. **Grader bugs are real
  and common.** Anthropic example: Opus 4.5 scored 42% on CORE-Bench
  until researchers found the grader was rejecting "96.12" when the
  reference was "96.124991…". Score jumped to 95% after fixing graders.

## The diagnostic question

For each failed trial, ask:

> **Model mistake, grader mistake, or task-spec error?**

- **Model mistake** — agent's output is genuinely wrong. Real signal.
  Action: prompt fix / training data / known limitation.
- **Grader mistake** — agent was fine; grader rejected a valid solution.
  Anthropic: *"Failures should seem fair: it's clear what the agent got
  wrong and why."* Action: update rubric or grader code.
- **Task-spec error** — task is ambiguous, reference_solution is wrong,
  or the input is missing context. Anthropic example: Terminal-Bench
  task asked for a script but didn't specify filepath, then graded
  using a specific filepath. Action: rewrite the task.

## Education-as-you-act: missing input

If invoked without a run folder or pasted transcripts, halt with:

*"Transcript review needs the output of a /run-eval run. Three ways:*
- *Folder: `/transcript-review outputs/eval-runs/<feature>-<date>/`*
- *Paste: paste summary.md plus 1–N case JSONs*
- *Attach: attach the case JSONs as files*
*If you haven't run an eval yet, run `/run-eval <eval-yaml>` first."*

## Flexible input — three modes

**Mode A — folder:**
`/transcript-review outputs/eval-runs/<feature>-<date>/`
Read summary.md; iterate cases/<id>.json for failed trials.

**Mode B — paste:** *"Paste summary.md plus failed cases' JSON."*

**Mode C — attach:** *"Attach summary.md and per-case JSONs."*

## Per-failed-trial process

For every failed trial:
1. Surface the trial: task ID, severity, input, expected behavior,
   actual output.
2. Show grader's verdict verbatim with reasoning. Don't editorialize yet.
3. Ask the PM the diagnostic question explicitly.
4. If unsure, propose your best guess with reasoning. Push back when
   the grader looks wrong.
5. Capture the verdict + proposed fix.

## Output: transcript-review memo

Write to `outputs/transcript-review-<feature-slug>-<YYYY-MM-DD>.md`:

```markdown
# Transcript Review: <Feature> — run <run-id>

**Date:** <today>
**Run folder:** <path>
**Failures reviewed:** <N of M>

## Verdict summary
| Diagnosis | Count |
|---|---|
| Model mistake | <n> |
| Grader mistake | <n> |
| Task-spec error | <n> |

## Per-trial review
### Trial <task-id>, trial <i>
- **Diagnosis:** ...
- **Input (truncated):** ...
- **Agent output (truncated):** ...
- **Grader said:** ...
- **PM verdict:** ...
- **Action:** ...

## Proposed eval changes
- Rubric updates
- Task rewrites
- New negative_case tasks
- Tasks to retire

## Next step
- [ ] Apply rubric updates and re-run
- [ ] Edit tasks and re-run
- [ ] No changes; failures are real model limitations to escalate
```

## Hard rules

- ALWAYS produce a verdict-count summary table at the top.
- ALWAYS push back on grader-rejection patterns. 3+ trials looking like
  grader mistakes? Surface this prominently — bad graders mask real
  model improvements.
- NEVER conclude "the model is bad" without checking grader and task
  quality first.

## Tone
Diagnostic, fair, willing to challenge the eval. The PM is your client;
the grader is not. When the grader is wrong, say so plainly.

## What you MUST NOT do

- Treat every failure as a model mistake.
- Skip the diagnostic question.
- Output verdicts without per-trial reasoning.
- Suppress grader-mistake counts to make the model look better.
