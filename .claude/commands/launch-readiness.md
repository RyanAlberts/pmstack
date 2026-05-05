---
description: Launch verifier. Aggregates PRD/metrics/eval/run/premortem/eval-drift/brief evidence into a GO/NO-GO/CONDITIONAL verdict with an acknowledged-gap override path.
argument-hint: "<feature-slug>"
---

You are operating the **launch-readiness** routine from pmstack. This is one of the five default routines.

Read the decision-log spec: @skills/_decision-log.md
Read the skill graph: @skills/_graph.yaml

Arguments: **$ARGUMENTS**

## What this is, in one line

A pre-launch gate that reads the artifact graph for a feature and returns **GO / NO-GO / CONDITIONAL** with each item showing pass / fail / missing + the file that proves it.

## When this runs

- **Slash only.** Launches don't happen on a cron. `/loop` would generate noise.
- Invoke with `/launch-readiness <feature-slug>`. The slug matches the topic slug used in `outputs/<skill>-<slug>-<date>.{md,yaml}`.

## Procedure

1. **Resolve feature slug.** If `$ARGUMENTS` is empty, list all distinct topic slugs from `outputs/` and ask which. Slug must match an existing PRD path; otherwise NO-GO at the first checklist item.
2. **Build the checklist.** For each item, find the most recent matching artifact under `outputs/`:
   - **PRD signed off** — `outputs/prd-<slug>-*.md` exists AND its decisions-log entry has been written.
   - **Metrics defined** — `outputs/metrics-<slug>-*.md` exists.
   - **Eval designed** — `outputs/eval-<slug>-*.yaml` exists.
   - **Eval actually run** — `outputs/eval-runs/<eval-id>/summary.md` exists for the eval YAML above.
   - **No P0 regression in latest eval-drift** — most recent `outputs/eval-drift-*.md` has `RELEASE_BLOCKED: false` (or no eval-drift exists yet, in which case mark "Missing" not "Fail").
   - **Premortem completed** — `outputs/premortem-<slug>-*.md` exists AND has at least 1 accepted mitigation in the decision-log entry.
   - **Brief sent** — `outputs/brief-<slug>-*.md` exists.
3. **Write the artifact** to `outputs/launch-readiness-<feature>-<YYYY-MM-DD>.md` with this exact structure:
   ```
   # launch-readiness — <feature> — <YYYY-MM-DD>
   VERDICT: GO|NO-GO|CONDITIONAL

   ## Checklist
   | Item | Status | Evidence |
   |---|---|---|
   | PRD signed off | Pass/Fail/Missing | <path or "—"> |
   | Metrics defined | Pass/Fail/Missing | <path or "—"> |
   | Eval designed | Pass/Fail/Missing | <path or "—"> |
   | Eval actually run | Pass/Fail/Missing | <path or "—"> |
   | No P0 regression (latest eval-drift) | Pass/Fail/Missing | <path or "—"> |
   | Premortem completed | Pass/Fail/Missing | <path or "—"> |
   | Brief sent | Pass/Fail/Missing | <path or "—"> |

   ## Verdict reasoning
   <2–3 sentences naming the failures or gaps>
   ```
4. **Verdict rules.**
   - **GO** — all 7 items Pass.
   - **NO-GO** — any P0 item is Fail (PRD missing, eval-drift RELEASE_BLOCKED).
   - **CONDITIONAL** — non-P0 items Missing or Fail (e.g., brief not yet written, premortem skipped on a low-stakes feature).
5. **Acknowledged-gap path.** If the PM responds "ship anyway" to a NO-GO or CONDITIONAL verdict, append to the artifact:
   ```
   ## Acknowledged gaps
   <YYYY-MM-DD> — Shipping despite: <list of failed items>
   Reason given: <PM-supplied reason; required>
   ```
   And add an *additional* line to `decisions-log.md`:
   `- <date> — launch-readiness(<feature>): SHIPPED-DESPITE-<gap-list> — outputs/launch-readiness-<feature>-<date>.md`
6. **Append to decision log** (always). One line for the verdict itself: `- <date> — launch-readiness(<feature>): <VERDICT> — outputs/launch-readiness-<feature>-<date>.md`.

## Hard rules

- **Verifier, not generator.** This routine never writes a missing PRD or runs a missing eval. It reports what's missing and stops. Suggest the next command (e.g., "next: `/eval <feature>`") in the verdict reasoning.
- **NO-GO is honest, not punitive.** First-launch with empty `outputs/` correctly returns NO-GO with everything Missing. That's the point.
- **Acknowledged-gap requires a reason.** Empty-string reason is rejected. The reason lands in `decisions-log.md` permanently.
- **Status values are exactly Pass/Fail/Missing.** Do not invent partial-credit states.

## Success criteria (used by e2e test)

- File `outputs/launch-readiness-<feature>-<date>.md` exists.
- Contains a single header verdict (GO|NO-GO|CONDITIONAL).
- Each of 7 checklist items has Pass/Fail/Missing + evidence path or "—".
- On NO-GO with override, an acknowledged-gap line exists in artifact AND a SHIPPED-DESPITE line lands in `decisions-log.md`.
- `decisions-log.md` gains one verdict line per run regardless of outcome.

## Anti-patterns

- Do not auto-run missing skills to make the verdict GO. The PM decides.
- Do not soften the verdict ("almost-GO," "GO-ish"). Three states only.
- Do not skip the acknowledged-gap log line — that's what makes the override durable.
