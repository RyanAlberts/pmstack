---
name: pmstack-lint
description: Walks the pmstack skill graph against the outputs/ directory to find graph gaps (missing downstream artifacts), cross-artifact drift (PRD-metrics-eval misalignment), and stale candidates (superseded files). Each finding includes a one-line "do this" recommendation. Trigger when the user says "lint my workspace," "graph check," "find drift," "tidy up outputs," "what's stale," or asks for a workspace audit. Run weekly on schedule, or before any review.
---

# lint — graph + drift + staleness pass over the artifact corpus

A structural lint over your accumulated artifacts. Finds the silent drift that compounds when nobody is watching.

## Required structure (exactly three sections, always present)

```
# lint — <YYYY-MM-DD>
FINDINGS: <total>

## Graph gaps
- <finding>: <file path> — Do this: <one-line action>
(or: "No gaps." if section is empty)

## Cross-artifact drift
- <finding>: <file paths involved> — Do this: <one-line action>
(or: "No drift." if section is empty)

## Stale candidates
- <file path> (age: Nd) superseded by <newer path> — Do this: archive or delete
(or: "Nothing stale." if section is empty)
```

## What goes in each category

**Graph gaps** — for each topic slug in `outputs/`:
- PRD with no metrics file
- Metrics with no eval YAML
- Eval YAML with no matching `outputs/eval-runs/<eval-id>/summary.md`
- Brief that references an artifact path no longer present
- Compare YAML with no matching eval run

**Cross-artifact drift**:
- PRD's Success Metrics North-Star line not present (verbatim or near) in same-slug metrics file
- Eval YAML's failure_modes don't map to any same-slug PRD Risks item
- Latest eval-drift shows RELEASE_BLOCKED:true while same-slug launch-readiness within 7 days returned GO

**Stale candidates** — files older than 30 days (default) with a newer same-slug, same-skill artifact (superseded). Mutating files is out of scope; just flag.

## Hard rules

- **Every finding has a "Do this:" line.** Pure observation gets ignored — every line specifies an action (a command, a deletion, a section to update).
- **All three sections always present**, even when empty. Empty sections write the empty marker text.
- **No mutations.** Lint reports only. Do not delete, archive, or modify any file.
- **Cold-start writes a real artifact** with the cold-start prompt: "Graph is empty — start with `/prd \"<a customer signal>\"`."

## Where to write

- With filesystem: `outputs/lint-<YYYY-MM-DD>.md`. Reads `skills/_graph.yaml`, all `outputs/`, `decisions-log.md`.
- Inline (web/mobile): emit the artifact as markdown with the suggested filename at the top, and ask the user to paste their decisions log + outputs/ inventory if running inline.

## Decision-log entry

`- <date> — lint: <N> findings (gaps:<g>/drift:<d>/stale:<s>) — outputs/lint-<date>.md`

## Tone

Mechanical, action-oriented. Every line ends in a "Do this." imperative.

## Cold-start behavior

Writes a real artifact even with near-empty `outputs/`. The cold-start prompt is itself a useful signal.
