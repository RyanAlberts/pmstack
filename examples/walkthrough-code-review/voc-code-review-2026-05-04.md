# Voice of Customer: AI code review — 2026-05-04

## Snapshot

**15 signals → 5 themes.** Source mix: 4 interviews (2 churn, 2 product), 5 support tickets, 2 app-store reviews, 1 NPS verbatim, 1 sales-call note (lost), 1 CSM-forwarded Slack complaint, 1 churn-risk flag. Skews enterprise + mid-market paying accounts and detractors (see *What I did NOT hear*).

## Themes (ranked by priority)

| # | Theme (the underlying problem) | Signals (n, %) | Severity | Fit | Priority | Representative quote |
|---|---|---|---|---|---|---|
| 1 | **Review turnaround is too slow to be usable → churn** | 3 (20%) | High | High | **High** | *"Two churned this quarter and named slow review as a top reason."* |
| 2 | **The reviewer misses security issues → trust collapse** | 2 (13%) | High | High | **High** | *"Bot approved a PR with a SQL injection. They paused rollout pending a trust review."* |
| 3 | **Comments are high-volume and unranked → devs mute it** | 5 (33%) | Med | High | **Med-High** | *"9 of 10 comments are noise."* |
| 4 | **CI status hangs and blocks the merge queue** | 2 (13%) | High | Med | **Med** | *"CI status would hang and block merges. Dealbreaker."* |
| 5 | **Large PRs get a degraded / empty review** | 3 (20%) | Med | Med | **Med** | *"On anything over ~800 lines it summarizes the first file and gives up."* |

**How priority was derived (not a black box):** Priority is severity × strategic-fit first, frequency as the tie-breaker. Theme 1 leads on severity (two *named churns* — the deepest possible signal) and fit (fast review *is* the value prop), even though Theme 3 is mentioned more often. Theme 2 ties Theme 1 on severity/fit but has lower frequency and hasn't converted to churn *yet* — so it sits at #2 with a flag. Themes 4–5 are real but bounded: workarounds exist and they don't threaten the core promise.

## Prioritization read — loudest ≠ most important

The **most-frequent** theme (comment noise, 5 signals / 33%) is **not** the **highest-priority** one. Volume says "fix the noise"; severity and fit say "fix the latency." Latency wins because it is the only theme with proven churn attached and because it strikes the core value proposition — a review that arrives a day late is the same as no review.

- **Squeaky wheel:** *comment noise* (Theme 3). Loudest in the inbox, genuinely worth fixing, but no account has left over it — devs mute and move on. Don't let its volume jump it ahead of latency.
- **Silent killer:** *missed security issues* (Theme 2). Only 2 mentions, but one is a $180k-ARR enterprise pausing rollout and the other a fintech trust breach. This is the theme most likely to convert quiet dissatisfaction into a lost logo. **Watch it: if a third security signal lands, it becomes #1.**

## Top 3 problems (PRD-ready)

Each is formatted to hand straight to `/prd`.

### 1. Review latency is driving churn *(recommended next PRD)*
- **Underlying problem:** Devs can't rely on a review arriving fast enough to act on, so they skip it or merge unreviewed — defeating the product's purpose.
- **Segment:** Enterprise + mid-market engineering teams (the 3 largest accounts named it; 2 churned).
- **Business cost:** Two confirmed churns this quarter + one non-renewal; named as a top churn reason. Direct revenue + reference risk.
- **Representative quote:** *"Code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason."*
- **Ready to run:**
  ```
  /prd "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason."
  ```

### 2. Missed security issues are eroding trust *(silent killer — fast-follow)*
- **Underlying problem:** A reviewer that misses security defects is worse than no reviewer, because teams stop trusting *any* of its approvals.
- **Segment:** Security-sensitive enterprise + fintech accounts.
- **Business cost:** One $180k-ARR account paused rollout pending a trust review; a fintech customer reported a leaked secret. Trust, once lost, blocks expansion.
- **Representative quote:** *"A missed security issue is worse than ten missed style nits."*
- **Ready to run:**
  ```
  /prd "An enterprise customer's security team found our AI reviewer approved a PR that introduced a SQL injection and paused rollout pending a trust review; a fintech customer separately reported a missed hardcoded secret. For these accounts a missed security issue is account-ending."
  ```

### 3. Comment noise is drowning the signal *(squeaky wheel — highest volume)*
- **Underlying problem:** Comments aren't severity-ranked, so a typo and a logic bug look identical and devs mute the bot to escape the volume.
- **Segment:** All active teams; loudest among high-PR-volume mid-market teams.
- **Business cost:** Adoption decay — a muted bot delivers zero value and silently sets up the next churn. No churn attributed yet.
- **Representative quote:** *"The bot leaves 40 comments on a 20-line PR. My team mutes it."*
- **Ready to run:**
  ```
  /prd "Developers are muting our AI code reviewer because it posts ~40 unranked comments per PR — a typo and a real logic bug get equal weight, and 9 of 10 comments are seen as noise."
  ```

## What I did NOT hear

- **Survivorship gap:** every signal is a detractor, churn, ticket, or lost deal. No voice from *retained, happy power users* — so we don't know what's working and must not regress it. Run a round of success interviews before reprioritizing the roadmap around complaints alone.
- **Stage gap:** all signals are from paying enterprise/mid-market accounts. **Trial-stage and SMB voice is absent** — early-funnel friction (setup, first-run) wouldn't show up here at all. Treat this ranking as enterprise-weighted, not population truth.
- **No latency distribution:** we have "24+ hours" and "a full day" but no p50/p95. Quantify with product analytics before committing a target in the PRD.

## Recommended next step

Run `/prd` on **Problem 1 (review latency)** first — it's the highest-severity, best-fit theme, it's the cheapest to instrument, and it has proven churn behind it. Then `/premortem` the resulting PRD, and fast-follow with a security-trust PRD (Problem 2): the silent killer converts to churn faster than its low mention count suggests.

---
*Generated by `/voc` (pmstack). Input: the 15-signal set in [examples/inputs/README.md](../inputs/README.md). Next in the walkthrough: [prd-code-review-2026-05-05.md](./prd-code-review-2026-05-05.md) — built from Problem 1 above.*
