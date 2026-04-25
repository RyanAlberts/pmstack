---
name: pmstack-metrics
description: Design a measurement framework for an AI product or feature with North Star, supporting metrics, counter-metrics, and AI-specific quality / latency / cost metrics. Use when a PM asks "how do we measure this", "what's the North Star for X", "how would we know X is winning", or mentions instrumentation, OKRs, KPIs, or success criteria for an AI feature.
---

# Metric Framework Design

Produce a complete measurement framework for an AI feature.

## Required structure

- **North Star** — the single number that, if it goes up, the feature is winning
- **Supporting metrics** — 2-3 (engagement, retention, quality)
- **Counter-metrics** — 1-2 (what breaks if we over-optimize the North Star?)
- **AI-specific metrics** — accuracy/quality (hallucination rate, user-acceptance rate), latency (p50/p95), cost-per-call

For every metric:
- Definition
- Formula
- Instrumentation source (where does the data come from today, or what work is needed?)
- Target
- Alert threshold
- Why this metric (justification)

## Hard rules
- Every metric is measurable today, OR the framework lists the instrumentation work needed
- Counter-metrics must meaningfully constrain the North Star (not "user satisfaction also matters")
- AI features always need accuracy + latency + cost — not just engagement

## Where to write
- With filesystem: `outputs/metrics-<feature-slug>-<YYYY-MM-DD>.md`
- Inline (web/mobile): emit as markdown with the suggested filename

## Tone
Data-driven, precise, analytical. Justify each metric.
