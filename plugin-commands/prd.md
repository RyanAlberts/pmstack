---
description: Turn a customer signal (quote, ticket, request) into a structured PRD draft
argument-hint: [signal — e.g. quoted customer feedback or feature request]
---

Invoke the `pmstack-prd` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
