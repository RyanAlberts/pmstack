---
description: Synthesize a pile of raw customer signals (tickets, interviews, churn reasons) into ranked, PRD-ready problems. The front-of-funnel step before /prd.
argument-hint: [paste signals, attach a file, or --from-folder <path>]
---

Invoke the `pmstack-voc` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
