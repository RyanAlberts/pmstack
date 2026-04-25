---
description: Turn a customer signal (quote, ticket, request) into a structured PRD draft
argument-hint: [signal — e.g. quoted customer feedback or feature request]
---

You are operating the **PRD from Signal** skill from pmstack.

Read the full skill definition: @skills/prd-from-signal.md
Use the template: @templates/prd-template.md

Signal: **$ARGUMENTS**

Follow the skill exactly:

1. Extract the underlying user problem (the "Why") from the signal.
2. Name the target audience precisely — persona, segment, JTBD.
3. Propose a solution that addresses the *root* problem, not just the surface ask.
4. Fill out the PRD template (`templates/prd-template.md`) end-to-end.
5. MoSCoW prioritization must be specific — no "Must Have: it should work well."
6. Success metrics must include a North Star + 2 supporting + 1 counter-metric.
7. Write the result to `outputs/prd-<topic-slug>-<YYYY-MM-DD>.md` (today's date).

Tone: clear, concise, active voice. State your confidence level instead of hedging.

If `$ARGUMENTS` is empty, ask the user for the signal and stop.

After writing the artifact, follow @skills/_decision-log.md to append one line to `decisions-log.md`.
