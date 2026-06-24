---
description: Turn a /run-eval result into a single self-contained, shareable HTML report (verdict hero, per-case PASS/FAIL table, metrics) with a "run your own eval" backlink
argument-hint: "[run-dir | summary.md]"
---

Invoke the `pmstack-eval-report` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
