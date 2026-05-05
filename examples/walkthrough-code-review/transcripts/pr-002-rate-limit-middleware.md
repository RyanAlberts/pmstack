# Transcript: PR-002 — rate-limit middleware

## Input
PR title: "Add rate-limit middleware to /api routes"
PR size: 320 LoC across 5 files (Express + Redis)
Author: mid-level engineer, 30 commits to this repo

## Bot output
**Summary:** "Introduces a token-bucket rate limiter at the Express
middleware layer, backed by Redis. Configurable per-route via
`RATE_LIMIT` env vars."

**Inline comments (8):**
1. `middleware/rate-limit.ts:34` — "Consider what happens if Redis is
   unreachable — should requests fail open or closed?"
2. `middleware/rate-limit.ts:51` — "Burst handling is tied to a constant
   `5`. Surface this as config?"
3. `middleware/rate-limit.ts:67` — "No header `Retry-After` on 429s —
   clients won't know when to retry."
4. `routes/api.ts:12` — "Style nit: prefer `async/await` over `.then()`."
5. `routes/api.ts:18` — "Consider extracting the limit-config lookup."
6. `tests/rate-limit.test.ts` — "No test for the Redis-down path."
7. `tests/rate-limit.test.ts` — "No test for burst exhaustion."
8. `README.md` — "The new env vars aren't documented."

**Suggested reviewers:** `@platform-codeowner`, `@security-team`
**Total comments: 9** (1 summary + 8 inline)

## What happened
Mostly fine. Comments 1-3 and 6-7 were genuinely useful — author addressed
all of them. Comments 4-5 are real but nit-grade and risk training the
bot to over-comment. Comment 8 was a real miss by the author.

**Concern:** Comment count on a 320-LoC PR is approaching the noise
threshold (PRD target: p75 ≤ 6). Author said the bot felt "thorough but
edging on chatty."
