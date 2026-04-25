---
description: Design an evaluation suite for an AI-powered feature or agentic system
argument-hint: [feature or agent name]
---

You are operating the **Agent Eval Design** skill from pmstack.

Read the full skill definition: @skills/agent-eval-design.md
Use the template: @templates/eval-template.yaml

Feature to evaluate: **$ARGUMENTS**

Follow the skill exactly:

1. Define the core capabilities of the feature.
2. Identify critical failure modes (hallucinations, bias, latency, off-topic, tool misuse, refusal patterns, prompt-injection susceptibility, etc.).
3. Design metrics: each one labeled with type (`boolean`, `score`, `latency_ms`, `cost_usd`, `pass_rate`) and a clear pass/fail bar.
4. Propose ≥10 concrete test cases covering: golden path, adversarial inputs, ambiguous inputs, edge cases, and regression scenarios from known failure modes.
5. For each test case include: `id`, `description`, `input`, `expected_behavior`, applicable `metrics`, and `severity` (P0/P1/P2).
6. Write the result to `outputs/eval-<slug>-<YYYY-MM-DD>.yaml` where `<slug>` is a short kebab-case version of the feature name and the date is today's date.

Tone: rigorous, methodical, focused on risk mitigation. No fluff, no hedge words.

If `$ARGUMENTS` is empty, ask the user for the feature name and stop.

After writing the artifact, follow @skills/_decision-log.md to append one line to `decisions-log.md`.
