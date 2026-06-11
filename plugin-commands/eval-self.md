---
description: Run the pmstack self-eval suite — scores every pmstack skill against canonical scenarios, with regression check against the golden set
argument-hint: "[--skill name] [--max-budget-usd N] [--dry-run]"
---

Invoke the `pmstack-eval-self` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
