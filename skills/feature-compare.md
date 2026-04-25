# Skill: Feature Comparison

## Trigger
`/compare [products...]`

## Goal
Produce a *feature-by-feature* comparison plan across two or more products, with a built-in eval design and a runnable execution method, gated by an explicit user confirmation.

## How this differs from /competitive
- `/competitive` does **market positioning** (audience, value prop, white space, where to wedge in).
- `/compare` does **feature parity** (does Product A do feature X? Better or worse than B?). Heavy on dimensions, scoring, and reproducible evidence.

## The three phases (always sequential, never collapsed)

### Phase 1 — Explore
Goal: gather raw material so dimensions emerge from the products, not from your priors.

Steps:
1. Parse the user's product list. Each product needs at minimum a name. URL is helpful but optional. **If two products share a name (e.g., "Notion" the company vs "Notion" the open-source tool), STOP and ask which one.**
2. For each product, gather: official feature list (from docs / pricing page if URL given), pricing model, deployment options, target customer.
3. Note explicitly what you could not find. Do not fill gaps with guesses.

Output of Phase 1: a brief raw-data summary. Do not write the comparison yet.

### Phase 2 — Define
Goal: derive comparison dimensions from what you found in Phase 1, then propose a measurement plan.

Steps:
1. From the Phase 1 material, propose 5–10 comparison dimensions specific to *this product category*. Do not import a generic SaaS-comparison template.
2. For each dimension, define how you'll judge it (objective fact, scored 1–5, qualitative).
3. Design an eval suite (use the structure from `templates/eval-template.yaml`) that includes ≥6 test cases hitting the proposed dimensions.
4. Choose execution mode based on what's feasible:
   - **Mode (a) Live execution** — when products have public docs, free tiers, or open APIs. The eval will probe each product directly.
   - **Mode (b) Plan-only** — when products require auth/payment/credentials Claude does not have. The eval YAML is generated; the user runs `/run-eval` themselves with their credentials.
5. Write the **plan** as `outputs/compare-<products-slug>-<YYYY-MM-DD>-plan.md`. Include:
   - Phase 1 raw summary
   - Proposed dimensions with rationale
   - Proposed eval design (inline reference to the YAML you'll write)
   - Proposed execution mode (a or b) and why
   - Cost / risk note (token usage, time, what could go wrong)

Then **STOP** and ask the user to confirm. Single y/n on the whole plan: dimensions + eval design + execution mode.

### Phase 3 — Execute
Goal: only after confirmation. Either run the comparison live, or hand the runner to the user.

Steps:
1. Write the eval YAML to `outputs/eval-compare-<products-slug>-<YYYY-MM-DD>.yaml` using the standard `templates/eval-template.yaml` structure.
2. If Mode (a): invoke `/run-eval` on the YAML and write findings to `outputs/compare-<products-slug>-<YYYY-MM-DD>-findings.md`.
3. If Mode (b): print the exact `/run-eval` command the user should run, with notes on the env vars they need to set first.

## Output contract

After Phase 3, the user has these files (paths relative to project root):
```
outputs/compare-<slug>-<date>-plan.md            ← the plan they confirmed
outputs/eval-compare-<slug>-<date>.yaml          ← runnable eval suite
outputs/compare-<slug>-<date>-findings.md        ← the actual comparison (Mode a only)
```

## Quality bars
- Dimensions are derived from products, not imposed. If you couldn't find enough data to derive them, say so and stop.
- The plan calls out what you don't know explicitly. Comparing on assumptions is worse than admitting gaps.
- The confirmation step is real — do not silently proceed to Phase 3 without explicit user approval.
- No invented features. If a product page doesn't mention a feature, say "not documented" not "doesn't have it."

## Tone
Analytical and direct. Lead with what's surprising. Hedge appropriately on facts you couldn't fully verify.

## What you MUST NOT do
- Do not skip Phase 1. Phase 2 dimensions emerge from Phase 1 data, not from your priors.
- Do not produce findings without confirmation. The plan exists for a reason.
- Do not silently switch from Mode (a) to Mode (b) mid-execution. If Mode (a) fails, stop and tell the user what's needed for Mode (b).
