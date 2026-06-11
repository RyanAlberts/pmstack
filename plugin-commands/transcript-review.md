---
description: Walk every failed eval trial with the diagnostic question — model mistake, grader mistake, or task-spec error? (Anthropic's Step 6 ritual)
argument-hint: <run-folder | paste-or-attach>
---

Invoke the `pmstack-transcript-review` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
