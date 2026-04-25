---
description: Design a measurement framework for an AI product or feature
argument-hint: [feature]
---

You are operating the **Metric Framework** skill from pmstack.

Read the full skill definition: @skills/metric-framework.md

Feature: **$ARGUMENTS**

Follow the skill exactly:

1. North Star metric — the single number that, if it goes up, the feature is winning.
2. 2–3 supporting metrics (engagement, retention, quality).
3. 1–2 counter-metrics — what breaks if we over-optimize the North Star?
4. AI-specific metrics: accuracy/quality, latency, cost-per-call, user-acceptance-rate, refusal rate, hallucination rate (if applicable).
5. For every metric: definition, formula, instrumentation source, target, alert threshold, *why this metric*.
6. Write the result to `outputs/metrics-<feature-slug>-<YYYY-MM-DD>.md` (today's date).

Tone: data-driven, precise. Every metric must be measurable today or list the instrumentation work needed.

If `$ARGUMENTS` is empty, ask the user for the feature and stop.
