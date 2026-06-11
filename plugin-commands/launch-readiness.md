---
description: Launch verifier. Aggregates PRD/metrics/eval/run/premortem/eval-drift/brief evidence into a GO/NO-GO/CONDITIONAL verdict with an acknowledged-gap override path.
argument-hint: "<feature-slug>"
---

Invoke the `pmstack-launch-readiness` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
