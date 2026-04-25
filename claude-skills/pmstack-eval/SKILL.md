---
name: pmstack-eval
description: Design a comprehensive, executable evaluation suite for an AI-powered feature or agentic system. Use when a PM wants to define what "good" looks like before shipping, when a product launch needs measurable acceptance criteria, when designing tests for a Claude/LLM-powered feature, or when the user mentions "evaluation suite", "eval design", "agent eval", "AI quality bars", or asks "how would we know if X works?"
---

# Agent Eval Design

You are designing a structured evaluation suite for an AI feature. The output is a YAML file the PM can hand to a runner (`/run-eval` or `bin/run-eval.py`) that produces real, reproducible scores.

## Inputs you need
- The feature being evaluated (capability under test)
- Optional: target system details (URL, model, script) — if not given, default to `target.type: claude-session` with a sensible model

## Output structure (the YAML you produce)

```yaml
# Header comment block: how to run this file with /run-eval, plain-text procedure
# diagram, what outputs the run produces. (See templates/eval-template.yaml.)

name: "Eval Suite: <Feature>"
description: "..."

target:
  type: claude-session   # or http, or script
  model: claude-haiku-4-5-20251001
  # http or script fields if relevant

capabilities: [...]       # 4-10 things the feature must do well
failure_modes: [...]      # tagged P0/P1/P2
metrics:                  # each with name, type, pass_bar, instrumentation
  - name: "..."
    type: boolean | score | pass_rate | latency_ms | tokens
    pass_bar: ">= 4"
test_cases:               # >=10, mix golden/adversarial/edge/regression
  - id: "..."
    severity: P0|P1|P2
    description: "..."
    input: "..."
    expected_behavior: "..."
    metrics: ["Accuracy", "Relevance"]

# Appendix: pro tips, troubleshooting, anti-patterns
```

## Hard rules

- ALWAYS include the header instructions block (how to run, procedure diagram, what outputs you get). PMs need this.
- ALWAYS include the `target:` section. If you don't know the target, ask.
- ALWAYS include the pro-tips appendix at the bottom.
- Every metric needs a concrete `pass_bar`.
- Every test case needs `severity` (P0/P1/P2). Without it, the runner can't gate releases.

## Where to write
- In Claude Code / SDK with filesystem: write to `outputs/eval-<feature-slug>-<YYYY-MM-DD>.yaml`.
- In Claude.ai web/mobile (no filesystem): emit the full YAML inline as a code block, prefixed with the filename the user should save it as.

## Tone
Rigorous, methodical, focused on risk mitigation. State confidence, not hedge words.
