---
description: Grade an existing eval A–F against Anthropic's eval-design principles and emit a shareable Eval Report Card (the inverse of /eval)
argument-hint: "[path-to-eval | pasted eval | feature]"
---

Invoke the `pmstack-eval-grade` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
