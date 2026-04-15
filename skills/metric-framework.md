# Skill: Metric Framework Design

## Trigger
`/metrics [feature]`

## Goal
Design a comprehensive measurement framework for an AI product or feature.

## Instructions
When the user invokes this skill for a feature, you should:
1. Define the North Star metric for the feature (the ultimate indicator of value).
2. Identify 2-3 supporting metrics (e.g., engagement, retention, or quality).
3. Identify 1-2 counter-metrics (what could go wrong if we optimize for the North Star?).
4. For AI features, specifically include metrics related to:
   - Accuracy/Quality (e.g., hallucination rate, user acceptance rate)
   - Latency/Performance
   - Cost/Efficiency
5. Structure the output clearly, explaining *why* each metric was chosen.
6. Save the output to `outputs/metrics-[feature]-[date].md`.

## Tone
Data-driven, precise, and analytical.
