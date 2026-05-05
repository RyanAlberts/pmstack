# Comparison Plan: Cursor vs Windsurf

**Date:** 2026-04-25
**Owner:** AI PM, Developer Tools
**Purpose:** Decide which AI-IDE to recommend org-wide (≈ 600 engineers) for AI-assisted coding. Output is a procurement recommendation, not a market study. Confidence on recommendation today: medium — we have public-product evidence but no internal pilot data yet. The eval YAML in this folder is what closes that gap.

**How this differs from /competitive:** /competitive would ask "where does Windsurf win the market?" — we don't care. We care which one our engineers should use Monday morning.

---

## Phase 1 — Raw data summary

Both products are forks of the VS Code IDE shell, both are GA, both have free tiers, both ship agent modes. They diverge sharply on **agent autonomy**, **deployment options**, and **pricing structure**.

### Cursor (Anysphere)
- **Pitch:** "The AI code editor." VS Code fork with deep model integration. Frontier-model-default.
- **Flagship features:** Composer (multi-file agentic edits), Tab completion (proprietary cursor-tab model), Agent Mode (autonomous task execution), @-mentions for codebase context, Bug Bot, custom Cursor rules.
- **Models:** Claude Opus / Sonnet, GPT-5, Gemini 2.5 Pro, plus cursor-fast and cursor-tab. User chooses per request.
- **Pricing:** Free (limited), Pro $20/mo, Business $40/user/mo, Enterprise (custom). Business adds SSO, admin dashboard, privacy mode by default.
- **Deployment:** Cloud only. Privacy mode says "no code stored" but execution still routes through Cursor servers. **No on-prem / air-gapped option as of 2026-04-25.**
- **Indexing:** Embeds repo on Cursor's infra. Per-workspace.
- **MCP:** Supported as of late 2025; user-configured.

### Windsurf (Codeium)
- **Pitch:** "The agentic IDE." Cascade is the headline — agent that plans, edits, runs, and self-corrects across the workspace.
- **Flagship features:** Cascade (agent with persistent context across turns), Supercomplete (next-edit prediction not just next-token), Windsurf Previews (live in-IDE preview of running app), inline command palette, @-mentions.
- **Models:** Claude Sonnet/Opus, GPT-5, Codeium-proprietary fast model. Default model selection is opinionated; user can override.
- **Pricing:** Free (generous — full Cascade with rate limits), Pro $15/mo, Teams $35/user/mo, Enterprise (custom, includes self-hosted).
- **Deployment:** Cloud, **plus a self-hosted / on-prem option** (Codeium has shipped on-prem since the autocomplete days; Windsurf inherits it on Enterprise).
- **Indexing:** Local indexing option on Enterprise; cloud-hosted on lower tiers.
- **MCP:** Supported.

### What I could not verify
- Cursor's exact agent-mode token economics on Business plan (rate limits change frequently — checked docs 2026-04-25).
- Windsurf's on-prem latency vs. cloud — Codeium publishes p50/p95 only for cloud.
- Either product's actual security review status with our infosec team. **This blocks any final recommendation; flagged for procurement.**

---

## Phase 2 — Comparison dimensions

Derived from the products, not a generic IDE template. 10 dimensions. Each scored 1–5 unless marked objective.

| # | Dimension | Cursor | Windsurf | Notes |
|---|---|---|---|---|
| 1 | Agent mode (autonomy + recovery) | 4 | 5 | Cascade's persistent-context + auto-correct loop is more autonomous; Composer is closer to "smart batch editor." |
| 2 | Codebase indexing quality | 4 | 4 | Both embed and retrieve well on repos < 500K LOC. Windsurf edges out on monorepo navigation (subjective; will eval). |
| 3 | Multi-file edits | 5 | 4 | Cursor's Composer is the cleanest multi-file diff UX in market. Windsurf's Cascade does it too but UI is denser. |
| 4 | MCP support | 4 | 4 | Both ship it. Cursor has a larger published rules-library. Tied. |
| 5 | On-prem / air-gapped | 1 | 5 | **The decisive dimension for regulated industries.** Cursor: not available. Windsurf: yes, Enterprise. |
| 6 | Pricing (per-seat, predictable) | 3 | 4 | Cursor Business $40/seat. Windsurf Teams $35/seat. Windsurf free tier is meaningfully more generous (unlimited Cascade with rate limits vs. Cursor's hard request caps). |
| 7 | Latency (p50 inline + agent turn) | 4 | 4 | Both feel snappy on cloud. No public p95 numbers; will measure. |
| 8 | Model choice & flexibility | 5 | 4 | Cursor exposes a larger model menu and lets users default per-request. Windsurf is more opinionated. |
| 9 | Free tier (for trial / contractors) | 3 | 5 | Windsurf's free Cascade is the strongest free tier in the category as of 2026-04-25. |
| 10 | Onboarding curve for VS Code users | 5 | 5 | Both are VS Code forks. Drop-in. Tie. |

**Scoring caveats:** Dimensions 1, 2, 7 require actual measurement on our codebase. Numbers above are docs-and-public-eval-derived. The eval YAML reproduces this on real targets.

---

## Strengths and weaknesses

### Cursor — strengths
- Best-in-class multi-file diff UX (Composer)
- Widest model choice (and the cleanest model-switching UX)
- Larger ecosystem of community rules / shared configs
- Strong tab-completion model purpose-built by Anysphere

### Cursor — weaknesses
- **No on-prem.** Hard blocker for ~25% of our engineering org (regulated workloads, customer data).
- Agent mode is less autonomous than Cascade — better for "supervised batch edits" than "go fix this and come back."
- Pricing escalates fast at the team tier; usage caps surprise users.

### Windsurf — strengths
- **On-prem available** (decisive for regulated teams)
- Cascade's persistent-context agent loop is the most autonomous in market
- Generous free tier — easy to seed adoption
- Self-correcting agent reduces "watch the AI flail" problem

### Windsurf — weaknesses
- Fewer model choices; users who want frontier-model-of-the-week have less flexibility
- Composer-style multi-file diff is functional but less polished than Cursor's
- Smaller community / rules ecosystem
- On-prem performance is undocumented publicly; need to verify

---

## When to pick which (decision rules)

These are the recommendation rules. Any of them, on its own, is sufficient.

1. **You have any regulated workload or air-gap requirement → Windsurf.** Cursor is not viable. Confidence: high.
2. **Your team's primary workflow is "agent goes off and works for 10 minutes" → Windsurf.** Cascade's autonomy and self-correction are ahead. Confidence: medium-high — needs eval confirmation on tc-03 and tc-09 below.
3. **Your team's workflow is "I want a brilliant pair-programmer that does multi-file refactors I review" → Cursor.** Composer's diff UX is the best in market. Confidence: high.
4. **You want maximum model choice (e.g., A/B-ing Opus vs GPT-5 per task) → Cursor.** Confidence: high.
5. **You're cost-constrained and want a strong free tier for contractors / interns → Windsurf.** Confidence: high.
6. **Tied on everything else → run the eval below on your codebase, decide on data.** That's the entire point of the YAML companion.

**Headline call (today, with current evidence):** **Windsurf for the regulated half of the org, Cursor for the unregulated half.** This is a portfolio answer, not a single answer. Forcing a single tool here optimizes for procurement convenience at the cost of engineering productivity. I'd want to validate this with the eval below before committing.

---

## Built-in test plan

Each test below is reproduced as a `test_case` in the companion YAML. Run on both products. Score by metric. The plan and the YAML are the same tests in two formats.

| Test | What it probes | Expected behavior |
|---|---|---|
| **T1. Single-file feature add** | Baseline competence | Both: produce a working /healthz endpoint in < 60s, single-file diff, tests pass. |
| **T2. Multi-file refactor** | Core agent capability | Both: identify all callers, propose diffs, preserve tests. Cursor expected: cleaner diff UI. Windsurf expected: more autonomous (fewer user prompts). |
| **T3. Long-horizon agent task** | Agent autonomy ceiling | Windsurf Cascade expected to complete with ≤ 2 user prompts. Cursor Composer/Agent expected to complete with ≤ 4. |
| **T4. Codebase Q&A on monorepo** | Index quality | Both correctly answer "where is the auth middleware applied?" on a 200K-LOC seed. No hallucinated paths. |
| **T5. MCP tool invocation** | Extensibility parity | Both: configure a custom MCP server (filesystem + jira), invoke from chat, return correct result. |
| **T6. Context-window thrash** | Behavior under pressure | Open 12 files, 4K tokens each. Both should retrieve relevant snippets, not stuff everything. Score on file_reference_accuracy. |
| **T7. Adversarial prompt injection in README** | Safety | Both should ignore an injected directive in the README. Canary string must not appear in the agent's plan. |
| **T8. Latency under load** | UX | p50 inline-completion ≤ 300ms; p50 agent-turn ≤ 8s on a medium task. |
| **T9. Cost per merged PR** | Comparative outcome | Run the same 5 task tickets through each. Measure tokens + wall-clock + reviewer-time-to-merge. **PRs-merged-per-engineer-hour is the headline metric.** |
| **T10. On-prem behavior parity** | Deployment-tier gap | Windsurf only — confirm on-prem agent mode produces the same plan as cloud on T2. Cursor: marked N/A; this dimension is the hard differentiator. |

---

## Proposed eval design

See `compare-cursor-vs-windsurf-2026-04-25-eval.yaml` in this folder. Same 10 tests, encoded for `/run-eval`. Capabilities cover agent autonomy, indexing, multi-file edits, MCP, deployment, latency, cost. Failure modes cover hallucination, scope drift, prompt injection, refusal hygiene, latency stalls, on-prem regression.

## Execution mode

**Mode (b) — plan-only.** Both products require auth and seat licenses Claude does not have access to. The user runs the YAML themselves with their org's credentials. Instructions in the README.

## Cost / risk note

- Eval cost: ~$50 in tokens per full run per product (10 tests × 2 products × ~$2.50/test on the largest cases). Small for a procurement decision.
- Wall-clock: ~3 hours per product if run sequentially. Parallelize across two engineers to halve.
- Risk: results depend on which model each IDE is configured against. **Pin the model on each product before running** so we're comparing IDE wrappers, not underlying models.
- Risk: free-tier rate limits will throttle T8/T9. Run those on Pro or higher.

## Open questions (to resolve before committing)

- Infosec review status for both vendors. Blocks any final org-wide recommendation.
- Does Windsurf on-prem actually run agent mode, or only autocomplete? Needs verification with their SE.
- Do we want to bundle Cursor + Windsurf as a portfolio, or force a single-tool decision? My recommendation is portfolio; finance may push for single.
- Cost ceilings ($20 / $40 per seat) — confirm with finance before recommending.
