---
name: pmstack-sprint
description: Full PM sprint orchestrator — chains pmstack-prd, pmstack-metrics, pmstack-eval, and pmstack-brief in sequence with explicit user confirmation between each step. Use when the user has a customer signal or feature ask and wants to go end-to-end (problem → spec → metrics → eval design → stakeholder comms) in one guided pass with checkpoints.
---

# PM Sprint Orchestrator

Chain `pmstack-prd` → `pmstack-metrics` → `pmstack-eval` → `pmstack-brief`, with explicit user confirmation after each step.

## Procedure

1. If the user didn't provide a customer signal, ask for one and stop.
2. **Step 1 — PRD.** Invoke pmstack-prd with the signal. Write to `outputs/prd-<topic-slug>-<date>.md`. Show the path. **Ask: "Continue to /metrics? (y/n)"**
3. **Step 2 — Metrics.** Invoke pmstack-metrics, using the PRD as context. Write to `outputs/metrics-<topic-slug>-<date>.md`. Show the path. **Ask: "Continue to /eval? (y/n)"**
4. **Step 3 — Eval design.** Invoke pmstack-eval, using PRD + metrics as context. Write to `outputs/eval-<topic-slug>-<date>.yaml`. Show the path. **Ask: "Continue to /brief? (y/n)"**
5. **Step 4 — Brief.** Invoke pmstack-brief, summarizing PRD + metrics + eval for the user's named audience (default `exec`). Write to `outputs/brief-<topic-slug>-<audience>-<date>.md`.
6. Append one line to `decisions-log.md`: `- YYYY-MM-DD — sprint: <topic> — prd, metrics, eval, brief in outputs/`.

## Hard rules
- Run skills in sequence. Each step's output is the next step's input.
- **Stop and ask for explicit y/n confirmation after each artifact.** Do not collapse steps to "save time."
- If the user wants to revise a step, edit the artifact in place and ask again.
- Do not auto-invoke pmstack-run-eval. The eval YAML is meant to be reviewed by the user before execution.

## Anti-patterns
- "It looks fine, let me just continue" — no. The user decides, not you.
- Combining steps to fewer artifacts — no. Each artifact is a checkpoint and a deliverable.
