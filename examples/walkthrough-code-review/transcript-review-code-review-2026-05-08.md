# Transcript Review: AI Code Review — run code-review-eval-2026-05-06

**Date:** 2026-05-08
**Run folder:** `examples/walkthrough-code-review/eval-runs/code-review-eval-2026-05-06/`
**Failures reviewed:** 4 of 4 failed trials

## Verdict summary

| Diagnosis | Count |
|---|---|
| Model mistake | 2 |
| Grader mistake | 1 |
| Task-spec error | 1 |

## Per-trial review

### Trial tc-03-adversarial-fake-sql-injection, trial 2

- **Diagnosis:** Model mistake
- **Input (truncated):** PR diff for a search endpoint using
  `db.session.execute(text("...:q..."), {"q": "%query%"})`.
- **Agent output (truncated):** Flagged `BLOCKER · security`, claimed
  "f-string interpolation in SQL".
- **Grader said:** Fail — task is `negative_case: true`; expected zero
  blocker-severity SQLi comments.
- **PM verdict:** This is the canonical false-positive we're trying to
  catch. The agent saw an f-string near SQL and pattern-matched
  without reading the bind mechanism. Real signal — the prompt or
  grader rubric needs to teach the bot what `text(... :q ...)` with a
  bound dict looks like.
- **Action:** Prompt fix (add 2-3 examples of safe parameter binding to
  the system prompt). Re-run.

### Trial tc-04-adversarial-real-injection-hidden, trial 4

- **Diagnosis:** Model mistake
- **Input (truncated):** 280-LoC PR with a real f-string SQL injection
  on line 201 of the diff.
- **Agent output (truncated):** Flagged at `minor · style`, suggested
  extracting the SQL into a query helper. Did not call it security.
- **Grader said:** Fail — required at least one `major+` severity
  comment on the injection.
- **PM verdict:** Severity deflation. The bot saw the dangerous pattern
  but downgraded the severity. This is the mirror image of tc-03 and
  the more dangerous failure — false negatives on real bugs are how a
  bug ships.
- **Action:** Severity rubric needs explicit examples: f-string-in-SQL
  with no bind = `blocker`. Re-run after prompt change.

### Trial tc-05-large-pr-cost-budget, trial 1

- **Diagnosis:** Grader mistake
- **Input (truncated):** 4,800-LoC PR.
- **Agent output (truncated):** Bot chunked the diff and produced a
  summary-only review, costing $1.42 — under the $1.50 budget.
- **Grader said:** Fail — case marked failed because `cost_per_pr_usd`
  was `null` (agent's response didn't include a token usage report).
- **PM verdict:** This is a grader-config bug, not a model bug. The
  cost metric is being read from the wrong field in the response. The
  agent did exactly what we wanted.
- **Action:** Update `cost_per_pr_usd` instrumentation to read from the
  Anthropic API usage report, not the agent's self-reported field.
  This is one of the canonical Anthropic warnings: *"failures should
  seem fair: it's clear what the agent got wrong and why."* When 1 in
  4 failures is a grader bug, our scores are lying to us.

### Trial tc-07-edge-no-codeowner, trial 3

- **Diagnosis:** Task-spec error
- **Input (truncated):** PR touches `vendored/legacy/` files that have
  no CODEOWNERS coverage.
- **Agent output (truncated):** Bot picked `@repo-admin` as the
  reviewer (admin is the most-recent committer on this path because
  they did a vendor refresh).
- **Grader said:** Fail — `reviewer_nomination_validity` requires
  CODEOWNERS coverage OR a recent commit; admin has the latter, so
  this should have passed.
- **PM verdict:** Task spec is wrong. The expected behavior says "no
  CODEOWNER means pick a recent committer" but the grader's pass
  condition just checks CODEOWNERS lookup, ignoring the recent-commit
  branch. The agent did the right thing; the grader's logic doesn't
  match the spec.
- **Action:** Rewrite the grader's pass condition to match the
  expected_behavior: pass if CODEOWNERS OR recent-commit (the OR is
  in the metric definition; not in the per-task `pass_condition`).

## Proposed eval changes

- **Rubric updates:**
  - System prompt: add 2-3 examples of safe SQLAlchemy bound-parameter
    queries so the bot stops flagging tc-03-style false positives.
  - System prompt: add explicit severity-anchor examples — f-string-in-
    SQL with no bind = blocker.
- **Task rewrites:**
  - tc-07: fix `pass_condition` to mirror the metric's OR logic.
- **New negative_case tasks to add:**
  - PR using prepared statements via `cursor.execute(sql, (params,))`
    — bot must NOT flag injection.
- **Tasks to retire:**
  - None.

## Next step

- [x] Apply rubric updates (prompt examples) and re-run.
- [x] Fix tc-07's `pass_condition`.
- [x] Fix the `cost_per_pr_usd` instrumentation.
- [ ] Re-run the full suite. Target: pass^k (5 trials) ≥ 0.85 on tc-03
      and tc-04. If we hit that, we can take this suite to launch-
      readiness review.
