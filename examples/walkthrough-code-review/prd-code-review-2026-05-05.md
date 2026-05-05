# PRD — AI Code Review — 2026-05-05

**Author:** PM, Agentic Developer Tools
**Status:** Draft v1
**Topic slug:** `code-review`

## 1. Problem Statement

**Customer signal (verbatim from QBR notes, 2026-04):** "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason."

**What:** Pull request review is the slowest stage of the inner-loop dev cycle for our enterprise tier. Median time-to-first-review on instrumented accounts is 19h; p90 is 41h. 22% of PRs in those accounts merge with zero human review.

**Who:** Backend and platform engineers at companies with 200–5,000 devs, working in monorepos on GitHub Enterprise. Reviewers are senior ICs and tech leads who are themselves the bottleneck.

**Why now:** Two churns this quarter cited review latency as a top-3 reason. Confidence: high — direct customer quotes, not inferred. Competitor pressure (CodeRabbit, Greptile) is closing fast on the AI-review niche. We have a 1–2 quarter window before "AI code review" becomes table stakes.

## 2. Proposed Solution

An AI reviewer that posts a structured first-pass review within 90 seconds of PR open: a plain-English summary of the change, a list of risks tagged by severity, and concrete suggested edits as inline comments. The AI also nominates the right human reviewers based on file ownership and recent expertise. Goal: turn the human review from "read 800 lines cold" into "validate the AI's findings and approve."

**Value prop:** Human reviewers spend their attention on judgment calls, not boilerplate. PRs get unblocked in hours, not days.

## 3. Key Features (MoSCoW)

**Must:**
- Auto-summary comment on PR open (what changed, why it likely matters, files touched)
- Inline risk comments tagged with severity (`blocker` / `major` / `minor` / `nit`)
- Suggested human reviewers based on CODEOWNERS + git blame recency
- One-click "dismiss" / "agree" on each AI comment, with the dismissal reason captured

**Should:**
- Auto-link to related past PRs that touched the same files
- "Re-review on push" that only re-comments on changed hunks, not the whole PR
- Per-repo config: severity threshold for posting, paths to ignore, max comments per PR

**Could:**
- Confidence score per comment, surfaced in the UI
- Slack DM to the suggested reviewer when the AI finishes its first pass
- Test-coverage diff inline ("this PR drops coverage on `auth/session.go` by 4%")

**Won't (this version):**
- Auto-merge on AI approval — humans must approve
- Cross-repo refactor suggestions
- Code generation / "fix it for me" beyond suggested edits

## 4. User Experience / Flow

1. Dev opens a PR.
2. Within 90s, the bot posts: top-level summary comment + N inline severity-tagged comments + reviewer suggestions in the sidebar.
3. Suggested human reviewer gets a notification with the AI summary inline.
4. Human reviewer triages: agrees / dismisses each AI comment, then makes their own judgment calls.
5. Dev addresses comments, pushes; AI re-reviews only changed hunks.
6. Human approves; PR merges.

**States:**
- *Empty:* No prior PRs in repo — show one-time onboarding card explaining what the AI will and won't do.
- *Loading:* Banner "AI review in progress — usually <90s" with a spinner. Dismissable.
- *Error:* If the model call fails, post a single comment "AI review unavailable — human review required" and page on-call after 3 consecutive failures.
- *Success:* Summary + inline comments visible; "AI reviewed" badge on the PR.

## 5. Success Metrics

**North Star:** Median PR time-to-first-review < 4 hours for 80% of PRs in opted-in repos, within 60 days of GA. (Baseline: 19h median; we expect AI first-pass to compress this dramatically since the AI review *is* a first review.)

**Supporting:**
- ≥ 70% of AI inline comments marked "agree" or acted upon by the human reviewer (signal: comments are useful, not noise)
- ≥ 60% of opted-in repos still active after 30 days (signal: it survives the honeymoon)
- p95 AI-review latency < 120s from PR open

**Counter-metrics:**
- Post-merge defect rate must not increase vs. control repos. Target: ≤ baseline + 5%.
- Reviewer "comment fatigue" — if the human ignores ≥ 80% of AI comments on a repo for 7 consecutive days, auto-tune severity threshold up and alert the PM team.

## 6. Open Questions / Risks

**Open questions:**
- Build vs. buy on the inline-suggestion UX — do we layer on GitHub's native suggestion API or render our own?
- Pricing: per-seat, per-repo, or per-PR? Confidence: low. Need finance + 3 customer interviews.
- How do we handle monorepos with > 10k file PRs? Hard cutoff or sampled review?

**Risks:**
- **Quality risk:** AI hallucinates a security finding that isn't real; reviewer wastes 30 minutes; trust collapses.
- **Adoption risk:** Devs perceive the AI as noise and mute the bot org-wide in week 1.
- **Cost risk:** Token spend per PR exceeds gross margin on the enterprise SKU at p90 PR size.
- **Compliance risk:** Customer code is sent to a third-party model; some regulated customers will not opt in without on-prem inference.

## Risks (added by /premortem 2026-05-05)

Mitigations accepted from [premortem-code-review-2026-05-05.md](./premortem-code-review-2026-05-05.md). Two of three failure-story mitigations were merged into this PRD; the third (pre-launch 200-PR cost eval) was rejected as out-of-scope here and tracked separately under metrics.

- **Mitigation 1 — Gate `blocker` severity behind eval precision threshold.** The model may not post `blocker`-severity comments unless precision on the internal eval set is ≥ 90%. Below threshold, downgrade to `major` and prefix with "AI suggestion — please verify." Owner: Eval lead. Gate fires before GA. Anchored to Failure Story 1 (hallucinated security finding).
- **Mitigation 2 — Conservative default config + "bot disabled" telemetry.** New installs default to `major` and above, not all severities. Emit a telemetry event when an org disables the GitHub App so we detect mass-mute within 24h, not weeks. Owner: Eng lead + PM. Done before GA. Anchored to Failure Story 2 (devs mute bot on day 3).
