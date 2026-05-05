# Mock transcripts — AI Code Review

Five transcripts simulating real interactions between the AI Code Review
bot and PRs. Each is what `/vibe-test` reads — the kind of raw record a
PM would pull from the bug tracker, support queue, or dogfooding logs.

These are realistic-enough-to-learn-from, fictional. Use them to:

- Run `/vibe-test "AI code review" --from-folder examples/walkthrough-code-review/transcripts/`
  and produce a vibe-test memo.
- Read them yourself before running `/eval` — Anthropic's "read the data
  before you write the eval" practice.
- Compare your `/vibe-test` output to
  [`vibe-test-code-review-2026-05-05.md`](../vibe-test-code-review-2026-05-05.md)
  (the bundled reference output, ships in step 5 of `/onboarding`).

## What's in each transcript

Each `.md` file has the same shape:

```markdown
# Transcript: <PR ID>
## Input        — what the bot saw
## Bot output   — what the bot said
## What happened — short PM note: success / failure / surprise
```

Keep it lightweight. The whole point of this layer is that vibes are
valid signal — we're not pretending to do statistics yet.

## The five transcripts

| File | PR shape | What you'll notice |
|---|---|---|
| `pr-001-paginator-bugfix.md` | small, real bug | bot did fine; one minor surprise |
| `pr-002-rate-limit-middleware.md` | medium feature | mostly fine; comment density borderline |
| `pr-003-parameterized-query.md` | trick: looks like SQLi but isn't | bot wrongly flagged SQL injection (false positive) |
| `pr-004-real-injection-hidden.md` | real bug buried in clean code | bot missed the real injection |
| `pr-005-trivial-typo.md` | trivial typo fix | bot over-commented (noise) |

These five surface the four real failure patterns in the Code Review
PRD's Risks section: hallucinated security findings, comment overload,
severity miscalibration, missed real bugs.
