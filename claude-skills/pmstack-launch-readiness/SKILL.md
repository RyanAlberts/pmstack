---
name: pmstack-launch-readiness
description: Pre-launch verifier. Aggregates PRD, metrics, eval design, eval run, premortem, eval-drift, and brief evidence into a single GO/NO-GO/CONDITIONAL verdict with each item showing pass/fail/missing plus the file that proves it. Trigger when the user says "are we ready to ship," "launch readiness," "release check," "pre-launch review," "ship it?" or asks to gate a release. Run before any launch.
---

# launch-readiness — pre-launch evidence gate

A verifier that reads the artifact graph for a feature and returns **GO / NO-GO / CONDITIONAL**.

## Required structure

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

## Verdict rules

- **GO** — all 7 items Pass.
- **NO-GO** — any P0 item is Fail (PRD missing, eval-drift RELEASE_BLOCKED).
- **CONDITIONAL** — any non-P0 items are Missing or Fail.

## Hard rules

- **Verifier, not generator.** Never auto-runs a missing skill to make the verdict GO. Suggest the next command in the verdict reasoning.
- **NO-GO is honest, not punitive.** First-launch with empty `outputs/` correctly returns NO-GO.
- **Acknowledged-gap override.** If the PM says "ship anyway" after a NO-GO/CONDITIONAL, append:
  ```
  ## Acknowledged gaps
  <YYYY-MM-DD> — Shipping despite: <list>
  Reason given: <PM-supplied; required, non-empty>
  ```
  And add an additional decision-log line: `- <date> — launch-readiness(<feature>): SHIPPED-DESPITE-<gaps> — <path>`.
- **Status values are exactly Pass / Fail / Missing.** Three states only.

## Where to write

- With filesystem: `outputs/launch-readiness-<feature>-<YYYY-MM-DD>.md`.
- Inline (web/mobile): emit the artifact as markdown with the suggested filename at the top.

## Decision-log entry

Always: `- <date> — launch-readiness(<feature>): <VERDICT> — <path>`. On override, an additional `SHIPPED-DESPITE-...` line.

## Tone

Honest, three-state, not punitive. The verdict is information, not a judgment.

## Cold-start behavior

Empty `outputs/` correctly returns NO-GO with all items Missing. That's the routine working as designed.
