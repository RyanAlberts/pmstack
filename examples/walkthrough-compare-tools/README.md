# Walkthrough: `/compare` — Cursor vs Windsurf

Sample artifacts produced when a PM runs `/compare "Cursor" "Windsurf"` to drive an org-wide AI-IDE procurement call. Date of run: 2026-04-25.

## What's in this folder

| File | Purpose |
|---|---|
| `compare-cursor-vs-windsurf-2026-04-25-plan.md` | The comparison plan. Phase 1 raw data, 10 derived dimensions, strengths/weaknesses, decision rules, built-in test plan. **Read this first.** |
| `compare-cursor-vs-windsurf-2026-04-25-eval.yaml` | The same 10 tests in executable form for `/run-eval`. Two targets (cursor, windsurf), 7 metrics, 10 test cases. |
| `README.md` | This file. |

The headline call from the plan: **portfolio answer — Windsurf for the regulated half of the org (it has on-prem, Cursor does not), Cursor for the unregulated half (Composer's multi-file diff UX is best in market).**

## When to use `/compare` vs `/competitive`

- `/compare` — feature parity. "Does product A do feature X better than B?" Heavy on dimensions, scoring, reproducible evidence. Output is a procurement / build-vs-buy recommendation.
- `/competitive` — market positioning. "Where does product A win the market? What's the white space?" Output is a strategy doc.

If you're choosing a tool to buy, use `/compare`. If you're deciding where to wedge your own product in, use `/competitive`.

## How to run the eval against real targets

This is a **Mode (b) plan-only** eval — Claude does not have your org's Cursor or Windsurf credentials. You run it.

```bash
# 1. Get API keys from each vendor's admin console
export CURSOR_API_KEY=...
export CURSOR_WORKSPACE_PATH=/path/to/seed-repo
export WINDSURF_API_KEY=...
export WINDSURF_WORKSPACE_PATH=/path/to/seed-repo

# 2. Pin both IDEs to the same underlying model (e.g. claude-sonnet-4-6)
#    in their respective settings. Otherwise you're comparing models, not IDEs.

# 3. Run the suite once per target
/run-eval examples/walkthrough-compare-tools/compare-cursor-vs-windsurf-2026-04-25-eval.yaml \
  --target cursor --judge-model claude-sonnet-4-6
/run-eval examples/walkthrough-compare-tools/compare-cursor-vs-windsurf-2026-04-25-eval.yaml \
  --target windsurf --judge-model claude-sonnet-4-6

# 4. Diff the two outputs/eval-runs/<run-id>/summary.md files.
#    Headline metric is prs_merged_per_ide_hour. On-prem parity (tc-10) is windsurf-only.
```

Expected wall-clock: ~3 hours per product. Expected token cost: ~$50 per product. Free-tier rate limits will skew tc-08 (latency) — run on Pro or above.
