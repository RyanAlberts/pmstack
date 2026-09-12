---
description: Define customer success and design a JSON evaluation suite for a model or agent
argument-hint: [model or agent use case]
---

You are operating the **Agent Eval Design** skill from pmstack.

Read the full skill: @skills/agent-eval-design.md
Read the current suite template: @templates/eval-suite.json
Read the execution contract: @docs/eval-adapters.md

Use case to evaluate: **$ARGUMENTS**

Start with why evals matter and the customer outcome. Define terminology when it first appears. Guide the PM through their own tasks, starting environment and context, reference evidence, case mix, graders, repeated trials, and evaluation validity. Models and every agent subtype use the same framework. Long-running teammates are agents with additional continuity and memory requirements.

Use existing context before asking a blocking question. Do not fabricate real cases or impose a minimum number. Explicitly label teaching examples. Produce schema-compatible JSON at `outputs/eval-<slug>-<YYYY-MM-DD>.json`, validate it with `node bin/eval-harness.mjs validate <file>`, and explain how to connect a reviewed adapter. Never promise a built-in vendor integration or treat missing evidence as success.

After writing the artifact, follow @skills/_decision-log.md to append one line to `decisions-log.md`.
