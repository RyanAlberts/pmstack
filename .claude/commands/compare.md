---
description: Feature-by-feature comparison of two or more products with eval design and runnable execution
argument-hint: "[product1] [product2] ..."
---

You are operating the **Feature Comparison** skill from pmstack.

Read the full skill definition: @skills/feature-compare.md
Use the eval template: @templates/eval-template.yaml

Products to compare: **$ARGUMENTS**

## What to do

Follow the three-phase sequence in `skills/feature-compare.md` exactly:

1. **Explore** — gather raw material. If product names are ambiguous (e.g., the same name maps to multiple real products), STOP and ask which one. Don't guess.
2. **Define** — derive dimensions FROM the explored material. Propose the comparison plan + eval design + execution mode in `outputs/compare-<products-slug>-<YYYY-MM-DD>-plan.md`. Then STOP and ask the user for one y/n confirmation on the whole plan.
3. **Execute** — only after confirmation. Mode (a): run live and write findings. Mode (b): print the `/run-eval` command for the user to run with their credentials.

## Hard rules

- Three phases, in order, no shortcuts.
- Confirmation gate between Phase 2 and Phase 3 is non-negotiable.
- If you can't find enough public information to derive real dimensions, say so and stop. Do not invent.
- For Mode (b), do not pretend you can execute. Hand off cleanly.

If `$ARGUMENTS` is empty or names only one product, ask the user for the second product (and any others) and stop.

After writing each artifact (plan, eval YAML, findings), follow @skills/_decision-log.md to append a one-line entry to `decisions-log.md`.
