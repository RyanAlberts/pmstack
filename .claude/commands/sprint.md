---
description: PM sprint orchestrator — chains /prd → /metrics → /eval → /brief with explicit user checkpoint after each step
argument-hint: "[customer signal or feature ask]"
---

You are operating the **PM Sprint** orchestrator from pmstack.

Read the skill graph: @skills/_graph.yaml

Input signal: **$ARGUMENTS**

## What this is

A guided four-skill chain for moving from a customer signal to ready-to-ship-to-stakeholders artifacts. **You stop and ask for confirmation between each step.** That's the point — the user can correct course at every gate, not just at the end.

The chain (default — see `skills/_graph.yaml` for the full graph):

```
  customer signal
        │
        ▼
   ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐
   │  /prd   │───▶│ /metrics │───▶│ /eval   │───▶│ /brief  │
   │         │    │  (reads  │    │ (reads  │    │ (reads  │
   │         │    │   PRD)   │    │ all 2)  │    │ all 3)  │
   └─────────┘    └──────────┘    └─────────┘    └─────────┘
        │              │              │              │
     [confirm]      [confirm]      [confirm]     [final]
```

## Hard rules

1. **Run skills in sequence, not in parallel.** Each step's output is the next step's input.
2. **Stop and ask for explicit y/n confirmation after each artifact.** Show the user the artifact path and ask: "Continue to next step?"
3. **If the user wants to revise a step, do it before continuing.** Edit the artifact in place, then ask again.
4. **At the end, append a one-line entry to `decisions-log.md`** with the four artifact paths and the date. (See decision-log section in skills/_graph.yaml.)

## Procedure

1. If `$ARGUMENTS` is empty, ask for the customer signal and stop.
2. **Step 1: PRD.** Invoke the `/prd` skill (read @skills/prd-from-signal.md) using `$ARGUMENTS` as the signal. Write to `outputs/prd-<topic-slug>-<date>.md`. Show the path. Ask "Continue to /metrics? (y/n)".
3. **Step 2: Metrics.** Invoke `/metrics` (read @skills/metric-framework.md) using the PRD as context. Write to `outputs/metrics-<topic-slug>-<date>.md`. Show the path. Ask "Continue to /eval? (y/n)".
4. **Step 3: Eval design.** Invoke `/eval` (read @skills/agent-eval-design.md) using the PRD + metrics as context. Write to `outputs/eval-<topic-slug>-<date>.yaml`. Show the path. Ask "Continue to /brief? (y/n)".
5. **Step 4: Stakeholder brief.** Invoke `/brief` (read @skills/stakeholder-brief.md) summarizing the PRD + metrics + eval for the audience the user names (or default to `exec`). Write to `outputs/brief-<topic-slug>-<audience>-<date>.md`. Show the path.
6. **Decision log update.** Append to `decisions-log.md`:
   ```
   - YYYY-MM-DD — sprint: <topic> — prd, metrics, eval, brief in outputs/
   ```

## Anti-patterns

- Do not collapse two steps into one to "save time." The whole point is the gate.
- Do not skip confirmation because the artifact "looks fine." User decides, not you.
- Do not invoke `/run-eval` automatically — the eval YAML the sprint produces is meant to be reviewed by the user before it's run.
