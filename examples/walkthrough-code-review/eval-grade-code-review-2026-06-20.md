# Eval Report Card: AI Code Review

**Date:** 2026-06-20  ·  **Graded against:** Anthropic eval framework, Steps 0–5
**Source:** `examples/walkthrough-code-review/eval-code-review-2026-05-06.yaml`  ·  **Grade: A**

> A genuinely strong suite — real-failure provenance, a runnable target, balanced
> adversarial pairs, and (rare) a built-in judge-calibration protocol. One real
> gap holds it off a perfect score: only one of the P0 *capability* tasks ships a
> `reference_solution`, so two of the graders are unproven on a known-good output.

## Scorecard
| # | Dimension | Grade | Finding (with offending line) |
|---|---|---|---|
| 1 | Sourced from real failures | Pass | `failure_modes` carry `prd_risk_anchor` to PRD §6 + premortem stories; `tc-12` replays "the most-debated PR from the shadow period"; `tc-08` is premortem story #2. Provenance is explicit, not invented. |
| 2 | Unambiguous + reference solutions | Partial | Unambiguous half is strong — adversarial tasks pin a `pass_condition` ("At least one major+ severity comment on the injected line"). But **only `tc-01` has a `reference_solution`**; `tc-02` (P0, `purpose: capability`) and the P0 capability tasks `tc-04`/`tc-05` have none. Step 2 wants one on *each* P0 capability task to prove the grader is configured right. |
| 3 | Balanced problem sets | Pass | Explicit `negative_case: true` on `tc-03` ("bot must NOT flag SQL injection"), paired against `tc-04` (real hidden injection). Plus `tc-06` (don't manufacture comments), `tc-11` (ignore prompt injection). Textbook Step 3. |
| 4 | Target specified | Pass | Full `target:` block — `type: http`, `url`, `requires`, `request_template`. The suite can actually run; not a wish list. |
| 5 | Grader choice | Pass | Right tool per metric: `code` for counts/cost/latency/reviewer-validity, `model` for judgment (`security_correctness_precision`, `severity_calibration`), `human` for `refusal_precision`. |
| 6 | Measurable bar | Pass | Every metric has a concrete `pass_bar` (e.g. `p75 <= 6`, `<= $1.50`); suite names `success_metric: pass^k`, `purpose: capability`, `n_trials: 5`. No vibes. |
| 7 | Grader leakage | Pass | Model graders score against rubrics, not embedded answers. `tc-01`'s `reference_solution` is task-level, not injected into a judge prompt. The judge is not handed the answer. |
| 8 | Judge calibration | Pass | The standout. `security_correctness_precision` uses a 2-rater protocol (judge model + human rater on the bottom decile); `run_policy.judges.manual_spot_check` mandates a human on P0 release decisions. Most suites skip this entirely. |

**Score:** 7 Pass + 1 Partial = 15/16. No disqualifiers (target present · negative
cases present · no leakage · 12 tasks ≥ 5). → **A**.

## The three failures that cost you most
1. **Reference solutions are thin (Step 2).** Only `tc-01` proves a known-good
   output exists. **Fix:** add a `reference_solution` to `tc-02` and the other P0
   capability tasks — it's the cheapest way to prove `severity_calibration` and
   `security_correctness_precision` are scoring correctly, not just running.
2. **Seed-set skew is flagged but unresolved (Step 1 quality).** `open_questions`
   admits the seed is 55% Python vs ~40% in production. **Fix:** re-weight the
   80-PR seed before treating any pass-rate as ground truth — a skewed corpus
   makes a green run lie.
3. **Cost ceilings are uncalibrated against prod (Step 0 honesty).** `$0.30 / $1.50`
   bars are pre-launch guesses. **Fix:** recalibrate against the first 200 real
   PRs (already in `open_questions`) so `cost_per_pr_usd` isn't gating on a guess.

## Fix this first
Add `reference_solution` to every P0 capability task. It's a one-sitting change,
and it's the difference between graders that *run* and graders you've *proven* —
which is the whole point of an eval.

## Shareable verdict card
```
📊 Eval Report Card — AI Code Review  ·  graded by pmstack /eval-grade
Grade: A
✓ Strong: built-in LLM-judge calibration (judge + human on bottom decile)
✗ Weak:   only 1 P0 capability task has a reference solution
✗ Missing:proven graders on tc-02/tc-04/tc-05
Fix first: add reference_solution to every P0 capability task
→ grade your own eval: github.com/RyanAlberts/pmstack
```
