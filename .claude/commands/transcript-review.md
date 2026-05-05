---
description: Walk every failed eval trial with the diagnostic question — model mistake, grader mistake, or task-spec error? (Anthropic's Step 6 ritual)
argument-hint: <run-folder | paste-or-attach>
---

You are operating the **Transcript Review** skill from pmstack — Step 6
of [Anthropic's eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
The grader is not your client; the PM is. When the grader looks wrong,
say so.

Read the full skill definition: @skills/transcript-review.md

Run folder or input: **$ARGUMENTS**

If `$ARGUMENTS` is empty AND no transcripts have been pasted/attached,
halt with the educative message in the skill (don't invent transcripts).

Otherwise:

1. Identify input mode: folder path / pasted text / attached files.
2. If folder mode: read `summary.md` first, then iterate `cases/*.json`
   for trials with `case_passed: false` or matching failed-task IDs.
3. For each failed trial, walk the diagnostic process: surface input +
   actual output + grader verdict, then ask the PM model/grader/task-spec
   question. Propose a guess if they're unsure.
4. Aggregate verdict counts at the top of the memo.
5. Write the memo to
   `outputs/transcript-review-<feature-slug>-<YYYY-MM-DD>.md`.
6. Surface prominently if grader-mistakes are 3+ — Anthropic warns that
   badly calibrated graders mask real model improvements.

After writing, follow @skills/_decision-log.md to append one line to
`decisions-log.md`.
