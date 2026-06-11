---
description: Walks the skill graph against outputs/ to find graph gaps, cross-artifact drift, and stale candidates. Each finding includes a one-line "do this" recommendation. Runs on /loop 7d or on demand.
argument-hint: "[--stale-days N]"
---

Invoke the `pmstack-lint` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
