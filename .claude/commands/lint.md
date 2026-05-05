---
description: Walks the skill graph against outputs/ to find graph gaps, cross-artifact drift, and stale candidates. Each finding includes a one-line "do this" recommendation. Runs on /loop 7d or on demand.
argument-hint: "[--stale-days N]"
---

You are operating the **lint** routine from pmstack. This is one of the five default routines.

Read the skill graph: @skills/_graph.yaml
Read the decision-log spec: @skills/_decision-log.md

Arguments: **$ARGUMENTS**

## What this is, in one line

A structural lint pass over your accumulated artifact corpus. Finds the silent drift that compounds when nobody is watching.

## When this runs

- **Both forms.** Canonical: `/loop 7d /lint` (Mondays, alongside `/weekly`). Slash form before any high-stakes review or launch.
- `--stale-days N` overrides the default 30-day staleness threshold.

## Procedure

1. **Read the graph.** Parse `skills/_graph.yaml`. Note each skill's `reads_from` edges and `feeds_to` edges.
2. **Inventory `outputs/`.** Glob every artifact, group by topic slug (the middle segment of `outputs/<skill>-<slug>-<date>.{md,yaml}`).
3. **Compute findings in three categories.**

   **a) Graph gaps** — for each topic slug, check expected downstream:
   - PRD with no metrics file on the same slug.
   - Metrics with no eval YAML on the same slug.
   - Eval YAML with no matching `outputs/eval-runs/<eval-id>/summary.md`.
   - Brief that references an artifact path which no longer exists in `outputs/`.
   - Compare YAML with no matching `outputs/eval-runs/` (compare → run-eval).

   **b) Cross-artifact drift** — for each topic slug:
   - PRD's "Success Metrics" North-Star line does not appear (verbatim or near-verbatim) in the same-slug metrics file.
   - Eval YAML's `failure_modes` block does not map to any "Risks" item in the same-slug PRD.
   - Latest `eval-drift` for any user eval shows `RELEASE_BLOCKED: true` and the topic slug has a `launch-readiness` artifact within the last 7 days that returned GO.

   **c) Stale candidates** — artifacts older than `--stale-days` (default 30) that have a newer same-slug, same-skill artifact (i.e., superseded). Mutating files is out of scope; just flag.

4. **Write the artifact** to `outputs/lint-<YYYY-MM-DD>.md` with exactly three sections (always present, even if empty):
   ```
   # lint — <YYYY-MM-DD>
   FINDINGS: <total>

   ## Graph gaps
   - <finding>: <file path> — Do this: <one-line action>
   ...
   (or: "No gaps." if section is empty)

   ## Cross-artifact drift
   - <finding>: <file paths involved> — Do this: <one-line action>
   ...
   (or: "No drift." if section is empty)

   ## Stale candidates
   - <file path> (age: Nd) superseded by <newer path> — Do this: archive or delete
   ...
   (or: "Nothing stale." if section is empty)
   ```
5. **Append to decision log.** One line: `- <date> — lint: <N> findings (gaps:<g>/drift:<d>/stale:<s>) — outputs/lint-<date>.md`.

## Hard rules

- **Every finding has a "Do this:" line.** Pure observation gets ignored. The action must be specific (a command to run, a file to delete, a section to update).
- **All three sections are always present**, even when empty. Empty sections write "No gaps." / "No drift." / "Nothing stale." Do not omit headers.
- **Cold-start writes a real artifact.** On near-empty `outputs/`, write the artifact with all sections empty plus one line: "Graph is empty — start with `/prd \"<a customer signal>\"`." This is durable and useful.
- **No mutations.** Lint reports only. Do not delete, archive, or modify any file.

## Success criteria (used by e2e test)

- File `outputs/lint-<date>.md` exists.
- Contains all three named sections, each populated or marked empty.
- Each finding has a one-line "Do this:" recommendation.
- On a planted gap (e.g., a PRD with no matching metrics file), the lint detects it under "Graph gaps".
- On a near-empty corpus, the artifact still exists and contains the cold-start prompt line.
- `decisions-log.md` gains one line.

## Anti-patterns

- Do not propose findings without an action.
- Do not invent severity tiers ("critical/warning/info"). The graph either has a gap or it doesn't.
- Do not skip a section because it's empty. The empty marker is informative.
