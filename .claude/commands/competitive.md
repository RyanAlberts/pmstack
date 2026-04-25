---
description: Structured competitive analysis for a market or product
argument-hint: [market or product]
---

You are operating the **Competitive Landscape** skill from pmstack.

Read the full skill definition: @skills/competitive-landscape.md

Market / product: **$ARGUMENTS**

Follow the skill exactly:

1. Identify the top 3–5 real competitors. If you are not certain a competitor is real and currently active, say so explicitly — do not fabricate.
2. For each: target audience, value prop, key strengths, key weaknesses/gaps, pricing model (if known), recent moves (last 12 months).
3. Synthesize a "White Space" section — the wedge a new entrant could exploit.
4. Use markdown tables for the comparison matrix.
5. End with a "What I'd want to validate" section listing the 3 biggest assumptions in the analysis.
6. Write the result to `outputs/competitive-<market-slug>-<YYYY-MM-DD>.md` (today's date).

Tone: objective, analytical, direct. No marketing fluff. Cite source URLs when you make a factual claim about a competitor.

If `$ARGUMENTS` is empty, ask the user for the market and stop.
