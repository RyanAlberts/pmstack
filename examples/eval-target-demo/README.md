# Runnable eval target — Support-Ticket Triage

The fastest way to feel what an eval actually does. One command, ~1 minute, nothing to install beyond your Claude session. No mock data — a **real Claude model** is the system under test, and a **second Claude model** grades it.

## Run it

```bash
# from the repo root
bin/run-eval.py examples/eval-target-demo/triage-eval.yaml --judge-model claude-sonnet-4-6 --yes
```

Spend a penny first to confirm the loop, then run the whole thing:

```bash
bin/run-eval.py examples/eval-target-demo/triage-eval.yaml --only clear-outage --judge-model claude-sonnet-4-6 --yes
```

**Cost:** ~$0.05–0.20 for the full 8-case run (a Haiku target + a Sonnet judge). The runner prints a token estimate and, without `--yes`, asks before spending.

Output lands in `outputs/eval-runs/<run>/summary.md` — read that first.

## What's being tested

The "AI feature" is a real Claude model handed a **deliberately naive** triage prompt — the kind you'd write on your first try:

> *Read the customer's message. Output `{"category": ..., "urgency": ...}`. Pick the category that matches the main topic.*

That's it. No guidance on disguised severity, sarcasm, or red-herring keywords. Each of the 8 test cases probes a specific way that naive prompt can break:

| Case | Probes | The trap |
|---|---|---|
| `clear-outage` | control | an unambiguous outage; should pass |
| `routine-billing-calibration` | urgency calibration | does a routine double-charge get over-rated to High? |
| `disguised-security` | routing under red herrings | an account takeover wrapped in billing words |
| `sarcasm-hidden-urgency` | tone → urgency | sarcasm hiding a real outage |
| `urgent-word-trap` | over-escalation (negative case) | the word "urgent" on a "no rush" request |
| `consistency-borderline-1/2/3` | non-determinism (pass^k) | the **same ticket three times** |

## The lesson — which is *not* "watch the AI fail"

When I first ran this, every prediction I'd baked in was wrong:

- `disguised-security` — the case I built to embarrass the naive prompt — **passed.** The model routed the account-takeover to Security despite the "did you charge me?" misdirection.
- `routine-billing-calibration` — the "easy" one — **failed.** The model rated a routine double-charge as **High** urgency.

Is that a model bug (over-escalation) or my spec being too strict? That exact question — **model mistake vs. grader/spec mistake** — is what [`/transcript-review`](../../skills/transcript-review.md) exists to answer. You don't get to skip it.

The takeaway for a PM: **your intuition about where AI breaks is unreliable.** You felt sure about both cases and were wrong about both. That gap is the entire reason evals exist — and the entire reason this is a PM skill, not just an engineering one.

## The part that will reliably surprise you

Run it a few times and watch the three `consistency-*` cases — the identical ticket. The category and urgency will often **flip between identical inputs.** That's non-determinism (pass^k): the failure a dashboard or feature flag can never surface, and the one your customers feel as "it worked for me but not for them." Designing around it is the job.

## Then what

- `/transcript-review outputs/eval-runs/<run>/` — walk each fail: model, grader, or task-spec error?
- Tighten the system prompt in `triage-eval.yaml` (add the missing guidance), re-run, watch the score move. That loop — prompt → eval → diagnose → re-run — is the whole craft.
- Point `target:` at *your* AI feature (swap to `type: http` or `type: script` per [docs/run-eval-setup.md](../../docs/run-eval-setup.md)) and write your own cases.
