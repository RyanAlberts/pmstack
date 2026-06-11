---
description: Pre-mortem on a target PRD — simulates 3 plausible failure stories with leading indicators and mitigations, then offers to mutate the PRD's Risks section behind a confirmation gate.
argument-hint: "<prd-slug-or-path>"
---

Invoke the `pmstack-premortem` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
