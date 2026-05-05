---
name: pmstack-eval-drift
description: Re-runs an existing eval suite, diffs against the prior baseline, and writes a release-blocker memo if anything regressed. Use weekly on a schedule, or on demand before a release. Trigger when the user mentions "did my AI feature get worse," "eval drift," "model regression," "eval over time," "weekly eval," "release-blocker check," "is this still working," or asks to re-run /eval-self / /run-eval and compare to last time. Designed for repeated runs — produces durable, dated artifacts.
---

# eval-drift — scheduled drift watch over an AI feature

A scheduled drift-watch over LLM-substrate behavior. **Mechanical diff only — no causal hypotheses.**

## Required structure for the artifact

```
# eval-drift — <YYYY-MM-DD>
RELEASE_BLOCKED: true|false
SCOPE: self|user|all
RUNS_SINCE_BASELINE: N

## Per-suite delta
| suite | prev | now | Δ | P0 pass-rate Δ |
...

## Top regressions (max 3)
- <suite> / <case-id>: expected X, got Y
...

## Trailing-4-run trajectory
<short table; only if 4+ prior runs exist>
```

## Hard rules

- **No causal hypotheses.** Never write "this regression is likely due to X." Mechanical diff only — speculation under unattended schedule is hallucinated theater.
- **No suppression.** If P0 regressed by any amount, RELEASE_BLOCKED is true.
- **First-run bootstrap.** When no prior baseline exists, replace the body with `BASELINE: this is run 1; drift detection begins next run.` Still write the artifact.
- **Conditional brief.** On RELEASE_BLOCKED=true, run the stakeholder-brief skill (audience: engineering) using this artifact as input.

## Where to write

- With filesystem: `outputs/eval-drift-<YYYY-MM-DD>.md` and (on regression) `outputs/brief-eval-drift-<YYYY-MM-DD>.md`.
- Inline (web/mobile): emit the artifact as markdown with the suggested filename at the top. The user pastes it into their tracker.

## Decision-log entry

Append one line: `- <date> — eval-drift: RELEASE_BLOCKED=<bool> — outputs/eval-drift-<date>.md`

## Tone

Mechanical. Direct. No softening of regressions, no editorializing on causes.

## Cold-start behavior

First invocation against an empty baseline still produces a useful artifact (the baseline marker). Do not skip the artifact.
