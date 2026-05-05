# Vibe Test: AI Code Review

**Date:** 2026-05-05
**Source:** 5 mock transcripts in `examples/walkthrough-code-review/transcripts/`
**Author:** PM, Agentic Developer Tools

## What the feature is supposed to do

AI Code Review reads a PR diff + repo context and produces (a) a top-level
summary, (b) inline severity-tagged risk comments, and (c) a suggested
reviewer list. Goal: shorten time-to-first-review on small PRs and
catch real bugs that human reviewers might miss.

## Failure patterns observed

1. **Hallucinated security findings** — bot pattern-matches on syntax
   that *looks* unsafe (f-strings near SQL) without checking the actual
   binding mechanism. Once is forgivable; twice and the team mutes it.
   *Seen in:* PR-003 (false-positive SQL injection).
   *Likely cause:* grader is using surface-level signals, not semantic
   analysis of the parameter-binding API.

2. **Severity deflation on real bugs** — bot can spot the dangerous
   pattern but tag it `minor · style` instead of `blocker · security`.
   The opposite failure of #1, on the same kind of code.
   *Seen in:* PR-004 (real injection tagged `minor · style`).
   *Likely cause:* severity rubric is biased toward "if I'm not 100%
   sure, downgrade."

3. **Comment overload on small PRs** — bot generates 4-5 inline comments
   on a 1-line typo fix. Output volume is not calibrated to PR size.
   *Seen in:* PR-005 (trivial typo, 5 comments). Borderline in PR-002
   (320 LoC, 9 comments — at the noise threshold).
   *Likely cause:* no PR-size-aware ceiling on comment count.

4. **Inconsistent value on micro-PRs** — same 1-line PR could get one
   useful comment (great) or four off-topic ones (noise). Variance is
   high.
   *Seen in:* PR-001 vs PR-005.
   *Likely cause:* no explicit "if PR is trivial, say so and stop"
   instruction.

## Task candidates (for /eval)

| ID | Input | Expected behavior | Negative case? |
|---|---|---|---|
| tc-001 | Small bugfix (~20 LoC) with a clear off-by-one | Summary names the bug + fix; 0–2 inline comments; correct CODEOWNER reviewer | false |
| tc-002 | Medium feature PR (~300 LoC) with real edge cases | 3–6 comments total, edge cases flagged, no nit-grade comments at major+ severity | false |
| tc-003 | PR using bound parameters that *looks* like SQLi | Bot does NOT flag injection; may comment on style or tests | **true** |
| tc-004 | Real SQL injection buried in 200+ LoC of clean code | Bot flags the injection at major+ severity, cites the line | false |
| tc-005 | 1-line typo fix | 0–1 comments total; bot says "trivial fix, lgtm" if anything | **true** |
| tc-006 | PR with bot-mute risk: noisy on a small PR | Comment count ≤ 2 on PRs <50 LoC | **true** |
| tc-007 | PR with no CODEOWNER on changed files | Bot picks the most-recent committer to those files; doesn't pick a random repo admin | false |

## Surprises

- The bot's *positive* output on PR-001 was *better* than the average
  human review — it called out exactly which boundary case the
  suggested unit test would cover. Worth keeping a "delight" eval
  category that tracks when the bot adds genuine value, not just
  whether it avoids harm.
- Author trust is fragile. PR-003's single false-positive cost ~30
  minutes of debate and the author said "if it's going to flag stuff
  that isn't real I'm muting it." Eval pass-bar on
  `security_correctness_precision` should be tight (0.92 at launch,
  0.96 by month 3).

## Verdict: ready for /eval?

- [x] **Yes.** Failure patterns are concrete (4), task candidates are
      specific (7), and we have at least one `negative_case: true` per
      "should-do-X" behavior. Run `/eval AI code review` next, and
      bring this memo as input.

Next step: `/eval AI code review` — and the eval should produce
`outputs/eval-code-review-2026-05-06.yaml` covering tasks tc-001
through tc-007 (plus 3-5 more derived from PRD risks the vibe-test
didn't cover).
