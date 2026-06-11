---
description: PM sprint orchestrator — chains /prd → /metrics → /eval → /brief with explicit user checkpoint after each step
argument-hint: "[customer signal or feature ask]"
---

Invoke the `pmstack-sprint` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
