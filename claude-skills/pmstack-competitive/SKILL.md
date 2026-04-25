---
name: pmstack-competitive
description: Generate a structured competitive landscape analysis for a market or product category. Use when a PM mentions "competitive analysis", "market positioning", "white space", "where do we wedge in", asks who else is in a space, or wants to size up rivals before strategy/launch. Focus is on market positioning (audience, value prop, white space) — for feature-by-feature parity, use pmstack-compare instead.
---

# Competitive Landscape Analysis

Produce a comparative analysis of 3–5 real competitors and identify white space.

## Required structure

For each competitor:
- Target audience
- Core value proposition
- Key strengths
- Key weaknesses / gaps
- Pricing model (if known)
- Recent moves in the last 12 months

Then synthesize:
- **White Space** — concrete wedge a new entrant could exploit (not "better UX")
- **What I'd want to validate** — the 3 biggest assumptions in the analysis

## Hard rules
- Only name competitors you are confident exist. If you're not sure, say so explicitly. Do not fabricate.
- Cite source URLs for factual claims.
- Use a markdown table for the comparison matrix — same dimensions across competitors.
- Hedge appropriately for facts you couldn't fully verify.

## Where to write
- With filesystem: `outputs/competitive-<market-slug>-<YYYY-MM-DD>.md`
- Inline (web/mobile): emit as markdown with the suggested filename

## Tone
Objective, analytical, direct. No marketing fluff.
