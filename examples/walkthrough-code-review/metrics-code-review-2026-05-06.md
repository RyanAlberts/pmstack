# Metrics Framework: AI Code Review

**Feature slug:** `code-review`
**Author:** AI PM, Agentic Tools
**Date:** 2026-05-06
**Source PRD:** [./prd-code-review-2026-05-05.md](./prd-code-review-2026-05-05.md)
**Premortem:** [./premortem-code-review-2026-05-05.md](./premortem-code-review-2026-05-05.md)
**Competitive scan:** [./competitive-ai-code-review-2026-05-05.md](./competitive-ai-code-review-2026-05-05.md)

## So what

The PRD's success criterion is a customer-experience metric — review wait time. This framework operationalizes it, adds the supporting signals that tell us *why* the North Star is moving, and the counter-metrics that catch the obvious gaming paths. Confidence: high on instrumentation; medium on the latency pass-bar (we'll re-baseline after the first 200 PRs reviewed).

---

## North Star

**Median PR time-to-first-review (TTFR) < 4 hours for ≥ 80% of PRs.**

- **Definition:** TTFR = wall-clock time from `pull_request.opened` event to first non-bot review comment posted on the PR. AI review counts as the first review *iff* it produces at least one substantive comment (not just "LGTM" or an empty pass).
- **Why this metric:** It is the customer-experienced outcome. Internal PR throughput is the constraint engineering leadership has named for three quarterly reviews running. A reviewer suggestion engine that doesn't move TTFR is decoration.
- **Source:** GitHub webhook events → BigQuery → metrics dashboard.
- **Reporting cadence:** daily during launch month; weekly post-launch.
- **Pass bar at GA:** ≥ 80% of PRs hit < 4h TTFR over a rolling 7-day window.

---

## Supporting metrics

These tell us *why* the North Star moves, and which lever to pull when it doesn't.

### S1. Suggestion acceptance rate

- **Definition:** Of AI-generated review comments, the % that the author either applies as-suggested or marks as "useful" via inline thumbs-up.
- **Type:** pass_rate (per comment), aggregated weekly.
- **Why:** Acceptance is the cleanest proxy for *quality of the suggestion*. A high TTFR with low acceptance means we're fast and unhelpful — worse than slow and absent because it trains reviewers to ignore the bot.
- **Pass bar:** ≥ 35% accept-or-useful at launch; ≥ 50% by month 3.
- **Instrumentation:** GitHub Reactions API + a "Apply suggestion" click-through event from the PR UI extension.

### S2. P0 false-positive rate on security/correctness comments

- **Definition:** Of AI comments tagged "security" or "correctness," the % that a human reviewer marks "wrong / not a real issue" via the dismiss-with-reason action.
- **Type:** pass_rate, aggregated weekly.
- **Why:** Security/correctness is where false positives erode trust fastest. One confidently wrong "this is a SQL injection" comment costs more than ten missed nits. The premortem (failure story #1, "credibility collapse") names this directly.
- **Pass bar:** ≤ 8% at launch; ≤ 4% by month 3.
- **Instrumentation:** Reviewer dismiss-with-reason dropdown; required field for dismissals on flagged comments.

### S3. Review depth coverage

- **Definition:** Of PR diffs > 50 LoC, the % where the AI review comments on at least 70% of the changed files.
- **Type:** pass_rate.
- **Why:** Catches the failure mode where the bot reviews the easy parts and silently skips the hard ones (large config changes, generated files, test fixtures). Without this, S1 and S2 can both look good while customers complain that real review hasn't happened.
- **Pass bar:** ≥ 85% of eligible PRs.
- **Instrumentation:** Diff parser → comment-to-file mapping; computed at PR-close.

---

## Counter-metrics

These catch the gaming paths. If the North Star moves but a counter-metric tanks, we have a Pyrrhic win.

### C1. PR cycle-time-to-merge (full)

- **Definition:** Time from `pull_request.opened` to `pull_request.merged`.
- **Why:** TTFR can drop while total cycle time rises (e.g., the AI review surfaces noise that triggers more revision rounds). This metric protects against a "we sped up the first review and slowed down everything else" outcome.
- **Pass bar:** Cycle-time-to-merge **does not regress** by more than 10% vs. the pre-launch 4-week baseline. Any regression beyond that is a release-blocker.
- **Instrumentation:** Same webhook stream as North Star.

### C2. Reviewer comment-to-noise ratio

- **Definition:** Number of human reviewer comments per PR that are direct replies to AI comments (corrections, clarifications, dismissals).
- **Why:** If humans spend their saved time arguing with the bot, we have moved the work, not eliminated it. This is the premortem's failure story #2 ("reviewers babysit the bot").
- **Pass bar:** Average ≤ 1.5 reply-to-AI comments per PR. Investigation trigger at 2.5.
- **Instrumentation:** Threaded comment tree → AI-author detection.

---

## Cost & latency (operational, not headline)

| Metric | Pass bar | Why |
|---|---|---|
| p50 AI-review wall-clock latency | ≤ 90 s for PRs < 500 LoC; ≤ 4 min for PRs < 5K LoC | If review takes longer than a coffee break, humans context-switch and TTFR doesn't actually drop. |
| p95 AI-review wall-clock latency | ≤ 4 min / ≤ 12 min on the same brackets | Tail latency erodes trust on the worst PRs (which are the ones reviewers most need help with). |
| Cost per PR reviewed | ≤ $0.30 for < 500 LoC; ≤ $1.50 for < 5K LoC | Eval `tc-09-cost-budget` enforces this. Above the bar requires a chunked-review fallback. |

---

## What I'd want to validate before treating this framework as final

1. **TTFR baseline.** We are using a 90-day pre-launch baseline of median TTFR = 11.2h. Confirm with the data eng team that the baseline window excludes the December holiday distortion.
2. **Acceptance rate pass-bar (35%).** This is calibrated against GitHub Copilot Workspace's published 32% accept rate on similar surface. We may want to lower to 30% if our blast radius (security/correctness comments) is harsher to grade.
3. **C2 noise ratio.** Needs a 2-week shadow period with the bot's comments hidden from authors before we trust the baseline.

---

## Decision-log entry

`- 2026-05-06 — metrics(code-review): North Star = TTFR <4h on 80% PRs; 3 supporting + 2 counter — examples/walkthrough-code-review/metrics-code-review-2026-05-06.md`
