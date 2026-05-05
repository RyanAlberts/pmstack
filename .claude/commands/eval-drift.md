---
description: Re-runs /eval-self (and any user-defined eval YAMLs), diffs against the prior baseline, writes a release-blocker memo on regression. Designed to run on a /loop 7d schedule.
argument-hint: "[--budget-usd N] [--scope self|user|all]"
---

You are operating the **eval-drift** routine from pmstack. This is one of the five default routines.

Read the suite definition: @evals/pmstack-self.yaml
Read the runner: @evals/runner.py
Read regression check: @evals/regression-check.py

Arguments: **$ARGUMENTS**

## What this is, in one line

A scheduled drift-watch over LLM-substrate behavior. **Mechanical diff only — no causal hypotheses.**

## When this runs

- **Primary path:** scheduled via `/loop 7d /eval-drift` (Mondays). PMs do not type this ad hoc — they would type `/eval-self`. The routine exists because nobody remembers to run `/eval-self` weekly.
- **Slash path:** debug-only. Same behavior, just on demand.

## Procedure

1. **Resolve scope.** `--scope self` (default) runs `/eval-self`. `--scope user` runs every `outputs/eval-*.yaml` via `/run-eval`. `--scope all` runs both.
2. **Run the suite.** Invoke the runner with any budget cap from `$ARGUMENTS`. Capture the resulting `evals/results/<timestamp>_<model>.json` (for self) and `outputs/eval-runs/<run-id>/summary.md` (for user evals).
3. **Determine prior baseline.** For self: previous `evals/results/*.json` or `evals/golden/`. For user evals: previous `outputs/eval-runs/<eval-id>/` for the same eval id.
4. **Compute mechanical diffs.** Per-skill / per-suite delta table. P0 pass-rate change. Top 3 regressions with case IDs and observed-vs-expected.
5. **Write the artifact** to `outputs/eval-drift-<YYYY-MM-DD>.md` with this structure:
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
   <ASCII sparkline or short table; only present if 4+ prior runs exist>
   ```
6. **First-run bootstrap.** If no prior baseline exists, replace the body with:
   ```
   BASELINE: this is run 1; drift detection begins next run.
   ```
   Still write the artifact and decision-log entry.
7. **Conditional brief.** If `RELEASE_BLOCKED: true`, invoke `/brief` (read @skills/stakeholder-brief.md) using the eval-drift artifact as input, audience `engineering`. Write to `outputs/brief-eval-drift-<YYYY-MM-DD>.md`.
8. **Append to decision log.** One line: `- <date> — eval-drift: RELEASE_BLOCKED=<true|false> — outputs/eval-drift-<date>.md` (per @skills/_decision-log.md).

## Hard rules

- **No causal hypotheses.** Do not write "this regression is likely due to X." The schedule means nobody is reading it in real time; speculation is hallucinated theater. Mechanical diff only.
- **No suppression.** If P0 regressed by any amount, `RELEASE_BLOCKED: true`. Do not soften.
- **Cold-start writes a real artifact.** Do not skip the artifact on first run. Baseline-only is still useful (it forces an `/eval-self` to actually execute).
- Token budget is real. Default budget is the same as `/eval-self`'s default; `--budget-usd` overrides.

## Success criteria (used by e2e test)

- File `outputs/eval-drift-<date>.md` exists.
- Header contains `RELEASE_BLOCKED:` flag.
- Contains a per-suite delta table OR a baseline marker.
- On a planted regression (deliberately broken golden case), flag flips to `true` and a release-blocker brief is written.
- `decisions-log.md` gains exactly one line per run.

## Anti-patterns

- Do not invent a "likely cause" section.
- Do not auto-update the golden baseline. Only `/eval-self` with explicit user instruction does that.
- Do not skip the artifact when there's no prior baseline. Write the baseline marker.
