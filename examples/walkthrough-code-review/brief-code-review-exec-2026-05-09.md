# Exec Brief — AI Code Review GA — 2026-05-09

**To:** SVP Eng, VP Product, GM Developer Tools
**From:** PM, Agentic Developer Tools
**Audience:** Executive
**Status:** Decision brief — pre-launch readout

## TL;DR (the so-what)

We are shipping AI Code Review to the design-partner cohort on Monday 2026-05-12 with a CONDITIONAL launch-readiness verdict. The two P0 eval fails from Wednesday's run are closed — the prompt + dedupe fixes landed Thursday and the P0 subset re-ran clean Friday morning. Two non-P0 readiness items remain open by design: this brief itself (you're reading it) and the first `/eval-drift` baseline (fires automatically Monday). Confidence: high that we hit the North Star (median PR time-to-first-review < 4h on 80% of opted-in PRs within 60 days). The premortem flagged three failure stories; mitigations for stories 1 and 2 are in the build, story 3 (cost margin) is being tracked separately under metrics, not blocking GA.

## Three numbers that matter

1. **Eval P0 pass-rate after Thursday's fixes: 11/11 (100%)** on the re-run subset; full suite re-ran 12/12 on Friday afternoon. (Source: [./eval-runs/code-review-eval-2026-05-06/summary.md](./eval-runs/code-review-eval-2026-05-06/summary.md))
2. **Pre-launch baseline TTFR: 19h median, p90 41h** on the three design-partner repos. North Star at GA: < 4h on 80% of PRs in 60 days. (Source: [./prd-code-review-2026-05-05.md](./prd-code-review-2026-05-05.md) §5)
3. **Per-PR cost: $0.35 mean, $1.42 max** on the 12-case eval — within the $1.50 ceiling defined in metrics, but the 200-PR production cost validation is the one number that can still kill the SKU. We get that number in week 2 of GA. (Source: [./metrics-code-review-2026-05-06.md](./metrics-code-review-2026-05-06.md), Premortem failure story #3)

## What we're shipping

The Must-have set from the PRD: auto-summary on PR open, severity-tagged inline risk comments, suggested reviewers based on CODEOWNERS + git-blame recency, and one-click agree/dismiss with reason capture. New installs default to `major`+ severity only (post-Premortem-mitigation-2); telemetry includes a "bot disabled" event so we detect mass-mute within 24 hours, not the 11 days that the premortem warned about.

Scope cuts vs. early thinking: no auto-merge on AI approval (humans approve), no whole-codebase indexing this version (Greptile is ahead; ship without and revisit), no cross-repo refactor suggestions.

## Risks I'm watching

- **Severity calibration on the long tail.** Eval covered 12 cases; production sees PR shapes the eval doesn't. Mitigation: P0 subset re-runs on every prompt change; full suite weekly through month 1. (Eval YAML: [./eval-code-review-2026-05-06.yaml](./eval-code-review-2026-05-06.yaml), failure mode `fm-6`.)
- **Comment overload despite the conservative default.** Premortem story #2 fired in week 1 of dogfood at a different company; the new default + "bot disabled" telemetry should catch this within a day if it recurs.
- **Cost margin at p90 PR size.** Premortem story #3 — the 200-PR production cost study runs in week 2 of GA. If p90 cost is above the gross-margin line, the prompt chunks before the price changes.

## Asks

1. **Sign-off to ship Monday 2026-05-12** with the CONDITIONAL verdict and the two acknowledged gaps. (See [./launch-readiness-code-review-2026-05-09.md](./launch-readiness-code-review-2026-05-09.md).)
2. **30-minute slot the week of 2026-05-26** to walk through the first `/eval-drift` and the production cost numbers — that's the meeting that decides whether we expand beyond design partners.
3. **No new Must-haves for v1.1 until GA + 30 days.** Adoption signal is the lever, not feature surface area.

## Source artifacts (in chronological order)

- PRD: [./prd-code-review-2026-05-05.md](./prd-code-review-2026-05-05.md)
- Competitive: [./competitive-ai-code-review-2026-05-05.md](./competitive-ai-code-review-2026-05-05.md)
- Premortem: [./premortem-code-review-2026-05-05.md](./premortem-code-review-2026-05-05.md)
- Metrics: [./metrics-code-review-2026-05-06.md](./metrics-code-review-2026-05-06.md)
- Eval design: [./eval-code-review-2026-05-06.yaml](./eval-code-review-2026-05-06.yaml)
- Eval run: [./eval-runs/code-review-eval-2026-05-06/summary.md](./eval-runs/code-review-eval-2026-05-06/summary.md)
- Launch readiness: [./launch-readiness-code-review-2026-05-09.md](./launch-readiness-code-review-2026-05-09.md)
