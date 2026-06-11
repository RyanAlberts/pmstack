---
description: Execute an eval YAML produced by /eval — runs against a real target, scores metrics, writes summary.md + metrics.csv. HARD-STOPS if no target configured (no fake results).
argument-hint: "[path-to-eval-yaml] [--only id1 id2] [--max-tokens N] [--judge-model NAME] [--dry-run]"
---

Invoke the `pmstack-run-eval` skill from the pmstack plugin using the Skill tool, passing these arguments verbatim:

$ARGUMENTS

Follow that skill exactly. Do not improvise a lighter-weight version of it. If the skill is unavailable, say so and point the user to /plugin install pmstack@pmstack — do not attempt the task from general knowledge.
