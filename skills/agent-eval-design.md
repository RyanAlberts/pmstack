# Skill: Agent Eval Design

## Trigger
`/eval [feature]`

## Goal
Design a comprehensive, *executable* evaluation suite for an AI-powered feature or agentic system.

The output is a YAML file that can be run end-to-end by `/run-eval`. The PM reading the file should know exactly how to use it.

## Instructions

When invoked, you MUST:

1. **Define core capabilities** — what the feature is supposed to do well. 4–10 items.
2. **Identify failure modes** — hallucination, off-topic, latency, refusal, prompt injection, scope creep, etc. Tag each with severity (P0/P1/P2).
3. **Design metrics** — every metric needs:
   - `name`, `description`, `type` (`boolean`, `score`, `pass_rate`, `latency_ms`, `cost_usd`, `tokens`)
   - `pass_bar` — concrete threshold (e.g., `">= 0.95"`, `"true"`, `"<= 60_000"`)
4. **Propose ≥10 test cases** spanning golden, adversarial, edge, ambiguous, and regression categories. Each case has `id`, `severity`, `description`, `input`, `expected_behavior`, applicable `metrics`.
5. **Specify the target** — fill out the `target:` section of the template. Default to `type: claude-session` with a sensible model when the feature is itself a Claude/AI capability. For external products, use `http` with a placeholder URL and document required env vars under `requires:`.
6. **Use the structure in `templates/eval-template.yaml` exactly**. The header instructions, procedure diagram, target section, and pro-tips appendix are part of the contract — they teach the PM how to actually run the eval. DO NOT strip them.
7. **Save the output to `outputs/eval-<feature-slug>-<YYYY-MM-DD>.yaml`** using today's date.

## Quality bars

- Every metric is measurable today, OR the YAML lists the instrumentation work needed.
- Every test case includes severity. Without severity, /run-eval can't gate a release.
- The `target:` section is filled in, not left as `[fill in]`. If you genuinely don't know the target, ask the user before producing the file.
- Adversarial and edge categories are present, not just golden.

## Tone
Rigorous, methodical, focused on risk mitigation. State confidence levels, not hedge words.

## What you MUST NOT do
- Do not produce a YAML without the header instructions block — the PM needs to know how to run it.
- Do not invent test_case `expected_behavior` for systems you don't understand. Ask.
- Do not strip the appendix pro tips — they're load-bearing for users new to evals.
