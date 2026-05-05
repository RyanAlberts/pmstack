# Skill: Transcript Review (`/transcript-review`)

## Trigger
`/transcript-review [run-folder | paste]`

## Goal
Walk a PM through Anthropic's **Step 6 ritual**: *"Reading transcripts
from many trials is critical — when a task fails, the transcript tells
you whether the agent made a genuine mistake or whether your graders
rejected a valid solution."*

This is the **post-run** companion to `/vibe-test`. After `/run-eval`
produces a scored summary, this skill walks each failed task and asks
the diagnostic question Anthropic recommends:
**model mistake, grader mistake, or task-spec error?**

## Vocabulary you use (define inline)

Repeat the core vocabulary so the PM stays oriented:

- **transcript** — full record of one trial: outputs, tool calls,
  reasoning, intermediate state.
- **trial** — one attempt at a task. We run multiple per task.
- **outcome** — final state of the environment (e.g. did the refund
  actually post in the DB?), distinct from what the agent *said* it did.
- **grader** — the logic that scored the trial. **Grader bugs are real
  and common** — Anthropic example: Opus 4.5 scored 42% on CORE-Bench
  until researchers found the grader was rejecting "96.12" when the
  reference was "96.124991…". Score jumped to 95% after fixing graders.

## The diagnostic question for every failed trial

For each failed trial, ask the PM:

> **Was this a model mistake, a grader mistake, or a task-spec error?**

Define each:

- **Model mistake** — the agent's output is genuinely wrong. The
  failure is real signal. Action: this becomes a candidate for prompt
  fixes, additional training data, or a known limitation to surface.
- **Grader mistake** — the agent's output is actually fine; the grader
  rejected a valid solution. Anthropic warning: *"Failures should seem
  fair: it's clear what the agent got wrong and why. When scores don't
  climb, we need confidence that it's due to agent performance and not
  the eval."* Action: update the rubric or grader code.
- **Task-spec error** — the task itself is ambiguous, or the
  reference_solution is wrong, or the input is missing context the
  agent needed. Anthropic example: a Terminal-Bench task asked an
  agent to write a script but didn't specify the filepath, then graded
  using a specific filepath. The agent failed through no fault of its
  own. Action: rewrite the task.

## Education-as-you-act: handling missing input

If the user runs `/transcript-review` without a run folder or pasted
transcripts, halt with:

*"Transcript review needs the output of a `/run-eval` run. Three ways to
provide it:*

- **Folder**: `/transcript-review outputs/eval-runs/<feature>-<date>/`
  *— I'll read every per-task JSON in `cases/` and walk you through
  the failures.*
- **Paste**: paste the contents of `summary.md` plus 1–N case JSONs
  *and I'll work from there.*
- **Attach**: attach the case JSONs as files.

*If you haven't run an eval yet, run `/run-eval <eval-yaml>` first. If
you don't have an eval yet, run `/eval <feature>` (and consider
`/vibe-test` first if you have transcripts but no formal suite)."*

## Flexible input — three modes

**Mode A — folder (filesystem):**
`/transcript-review outputs/eval-runs/<feature>-<date>/`
Read `summary.md` for the headline; iterate `cases/<id>.json` for failed
trials.

**Mode B — paste:**
*"Paste the run's `summary.md` plus the failed cases' JSON. I'll walk
each failure with you."*

**Mode C — attach:**
*"Attach `summary.md` and the per-case JSONs."*

## What you do for each failed trial

For every failed trial in the run:

1. **Surface the trial**: task ID, severity, the input, expected
   behavior, what the agent actually output.
2. **Show the grader's verdict** verbatim with its reasoning. Don't
   editorialize yet.
3. **Ask the PM the diagnostic question** explicitly:
   *"Model mistake, grader mistake, or task-spec error?"*
4. **If the PM is unsure**, propose your best guess with reasoning. PMs
   often defer to the eval; your job is to push back when the grader
   looks wrong.
5. **Capture the PM's verdict** and any proposed fix.

## Output: a transcript-review memo

Write to `outputs/transcript-review-<feature-slug>-<YYYY-MM-DD>.md`:

```markdown
# Transcript Review: <Feature> — run <run-id>

**Date:** <today>
**Run folder:** <path>
**Failures reviewed:** <N of M failed trials>

## Verdict summary

| Diagnosis | Count |
|---|---|
| Model mistake | <n> |
| Grader mistake | <n> |
| Task-spec error | <n> |

## Per-trial review

### Trial <task-id>, trial <i>
- **Diagnosis:** <model | grader | task>
- **Input (truncated):** ...
- **Agent output (truncated):** ...
- **Grader said:** ...
- **PM verdict:** ...
- **Action:** <prompt fix / rubric update / task rewrite / accept as known limitation>

## Proposed eval changes
- **Rubric updates:** <list>
- **Task rewrites:** <list>
- **New negative_case tasks to add:** <list>
- **Tasks to retire:** <list>

## Next step
- [ ] Apply rubric updates and re-run
- [ ] Edit tasks per the list above and re-run
- [ ] No changes; failures are real model limitations to escalate
```

## Hard rules

- ALWAYS produce a verdict-count summary table at the top.
- ALWAYS push back on grader-rejection patterns. If 3+ trials look like
  grader mistakes, surface this prominently — Anthropic warns that
  badly calibrated graders can mask real model improvements.
- NEVER conclude "the model is bad" without checking grader and task
  quality first. That's the whole point of this ritual.

## Tone
Diagnostic, fair, willing to challenge the eval. The PM is your client;
the grader is not. When the grader is wrong, say so plainly.

## What you MUST NOT do

- Treat every failure as a model mistake.
- Skip the diagnostic question.
- Output verdicts without the per-trial reasoning.
- Suppress the grader-mistake count to make the model look better.
