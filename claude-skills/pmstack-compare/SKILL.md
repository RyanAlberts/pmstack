---
name: pmstack-compare
description: Feature-by-feature comparison of two or more products with built-in eval design and runnable execution. Use when the PM wants to compare specific features across products (e.g., "compare GitHub Copilot vs Cursor", "how does our pricing stack up against X and Y", "evaluate these two AI coding tools head-to-head"). Use pmstack-competitive instead for market-positioning analysis (audience, value prop, white space).
---

# Feature Comparison

Produce a feature-by-feature comparison plan, eval design, and execution method, in three sequential phases with one explicit user confirmation gate.

## Difference vs pmstack-competitive
- **Competitive** = market positioning (audience, value prop, where to wedge in)
- **Compare** = feature parity, scored, evidence-based, reproducible

## Three phases (always sequential, never collapsed)

### Phase 1 — Explore
Goal: gather raw material so dimensions emerge from products, not from your priors.

1. Parse the user's product list. Each product needs at minimum a name. URL is helpful but optional.
2. **If two products share a name** (e.g., "Notion" company vs "Notion" open-source tool), STOP and ask which one.
3. For each product, gather: official feature list (from docs / pricing if URL given), pricing model, deployment options, target customer.
4. Note explicitly what you could not find. Do not fill gaps with guesses.

Output: a brief raw-data summary. Do not write the comparison yet.

### Phase 2 — Define
Goal: derive comparison dimensions from Phase 1, then propose a measurement plan.

1. From the raw data, propose 5–10 dimensions specific to *this product category*. Do not import a generic SaaS template.
2. For each dimension, define how you'll judge it (objective fact, scored 1–5, qualitative).
3. Design an eval suite (use the eval template structure) with ≥6 test cases hitting the dimensions.
4. Choose execution mode:
   - **Mode (a) Live**: products have public docs / free tier / open API → Claude probes directly
   - **Mode (b) Plan-only**: products require auth / payment / credentials → emit eval YAML + `/run-eval` command for the user to run themselves
5. Write the **plan** (raw summary + dimensions + eval design + chosen mode + risk note) to `outputs/compare-<products-slug>-<YYYY-MM-DD>-plan.md`.
6. **STOP and ask the user for one y/n on the whole plan.**

### Phase 3 — Execute
Only after confirmation:

1. Write eval YAML to `outputs/eval-compare-<products-slug>-<YYYY-MM-DD>.yaml`.
2. Mode (a): invoke `/run-eval` and write findings to `outputs/compare-<products-slug>-<YYYY-MM-DD>-findings.md`.
3. Mode (b): print the exact `/run-eval` command + env vars the user needs to set first.

## Hard rules

- Three phases, in order. No shortcuts.
- Confirmation gate between Phase 2 and Phase 3 is non-negotiable.
- Dimensions are derived from products, not imposed.
- No invented features. "Not documented" ≠ "doesn't have it".
- Do not silently switch modes mid-execution. If Mode (a) fails, stop and tell the user what's needed for Mode (b).

## Where to write
- With filesystem: paths above
- Inline (web/mobile): emit each artifact as a code block with the filename header

## Tone
Analytical, direct. Lead with what's surprising. Hedge appropriately on facts you couldn't fully verify.
