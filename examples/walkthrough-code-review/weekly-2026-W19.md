# weekly — 2026-W19

## Decisions made

**prd**
- 2026-05-05 — PRD for AI Code Review v1, Must/Should/Could/Won't locked: [./prd-code-review-2026-05-05.md](./prd-code-review-2026-05-05.md)

**competitive**
- 2026-05-05 — Five-player matrix; identified reviewer-nomination + agree/dismiss feedback loop as white space: [./competitive-ai-code-review-2026-05-05.md](./competitive-ai-code-review-2026-05-05.md)

**premortem**
- 2026-05-05 — 3 failure stories surfaced; mitigations 1 & 2 accepted into PRD, mitigation 3 (cost-eval) tracked under metrics not PRD: [./premortem-code-review-2026-05-05.md](./premortem-code-review-2026-05-05.md)

**metrics**
- 2026-05-06 — North Star = TTFR < 4h on 80% of PRs; 3 supporting (acceptance, FP rate, depth coverage) + 2 counter-metrics (cycle-time, noise ratio): [./metrics-code-review-2026-05-06.md](./metrics-code-review-2026-05-06.md)

**eval**
- 2026-05-06 — 12-case suite, 7 metrics, 3 failure modes anchored to PRD risks: [./eval-code-review-2026-05-06.yaml](./eval-code-review-2026-05-06.yaml)

**run-eval**
- 2026-05-07 — First run: 9/11 P0 (82%). Two P0 fails (severity deflation, comment overload), both addressed by Thursday landings: [./eval-runs/code-review-eval-2026-05-06/summary.md](./eval-runs/code-review-eval-2026-05-06/summary.md)

**lint**
- 2026-05-08 — 3 findings: brief-not-yet-written, eval re-run pending, metrics counter-metric C1 not represented in eval (documentation gap): [./lint-2026-05-08.md](./lint-2026-05-08.md)

**launch-readiness**
- 2026-05-09 — CONDITIONAL with two acknowledged gaps (brief in-flight, eval-drift baseline scheduled Monday). SHIPPED-DESPITE logged: [./launch-readiness-code-review-2026-05-09.md](./launch-readiness-code-review-2026-05-09.md)

**brief**
- 2026-05-09 — Exec brief for the GA decision; landed before EOD as committed: [./brief-code-review-exec-2026-05-09.md](./brief-code-review-exec-2026-05-09.md)

## Open loops aging

- [/home/user/pmstack/outputs/pmstack-roadmap-2026-04-24.md](../../outputs/pmstack-roadmap-2026-04-24.md) (age 11d) — internal pmstack roadmap, not yet decomposed into PRD/metrics. Approaching the 14-day staleness window. Action next week: either decompose into a PRD or formally archive.

(No code-review-slug open loops this week — the corpus is fresh and complete.)

## One thing I changed my mind about

I went into the week assuming auto-summary on PR open was the headline feature. The premortem changed that. Failure story #2 ("devs muted the bot org-wide on day 3 because every PR got 14 comments") is mostly an auto-summary problem at scale, and the white-space competitive analysis pointed at suggested-reviewer nomination as the actually-differentiated capability that no competitor does well. I cut auto-summary's scope: it now ships as a single short paragraph rather than the structured Risk-Summary-Files-Touched template I'd originally drafted. Same surface, less rope to hang ourselves with on day 3. Confidence: high that this was the right trade — eval `tc-08-noise-stress-test` validated that comment count, not summary richness, is the failure axis. Tracking it as supporting metric S3 (review depth coverage) so we'd notice if I'm wrong.
