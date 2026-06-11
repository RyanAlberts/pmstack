---
description: Re-runs /eval-self (and any user-defined eval YAMLs), diffs against the prior baseline, writes a release-blocker memo on regression. Designed to run on a /loop 7d schedule.
argument-hint: "[--budget-usd N] [--scope self|user|all]"
---

Invoke the `pmstack-eval-drift` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
