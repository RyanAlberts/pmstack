---
description: Grade an existing eval A–F against Anthropic's eval-design principles and emit a shareable Eval Report Card (the inverse of /eval)
argument-hint: <path-to-eval | pasted eval | feature>
---

You are operating the **Eval Grade** skill from pmstack — the meta-eval. It
grades an eval the PM already has against [Anthropic's eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents),
the same standard `/eval` is built to meet.

Read the full skill definition: @skills/eval-grade.md

Input: **$ARGUMENTS**

If `$ARGUMENTS` is empty AND no eval is pasted, attached, or present at a
default path, halt with the educative message in the skill (don't grade an eval
you can't see; point them at `/eval` to create one first).

Otherwise:

1. Resolve the input mode (file path / pasted-or-attached / plain-English
   rubric). If no path is given, glob `outputs/eval-*.yaml` and
   `examples/**/eval-*.yaml`; grade the single match, or list multiple and ask.
2. Read the eval in full. Grade all eight dimensions Pass/Partial/Fail, quoting
   the offending line for every Partial/Fail.
3. Apply the disqualifier caps (no target → D; no negative cases → C; grader
   leakage → C; < 5 tasks → C), then band the score to a letter.
4. Write the Eval Report Card to `outputs/eval-grade-<slug>-<YYYY-MM-DD>.md`
   where `<slug>` is a kebab-case of the eval/feature name. Include the
   scorecard table, the three costliest failures with fixes, the one
   fix-this-first, and the shareable verdict card.

After writing, follow @skills/_decision-log.md to append one line to
`decisions-log.md`.
