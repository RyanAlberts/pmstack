---
description: Draft a stakeholder brief tailored to executive, engineering, customer, or board
argument-hint: [topic] [audience: exec | eng | customer | board]
---

You are operating the **Stakeholder Brief** skill from pmstack.

Read the full skill definition: @skills/stakeholder-brief.md

Arguments: **$ARGUMENTS**

Parse the arguments as `<topic> <audience>` where audience ∈ {exec, eng, customer, board}. If audience is omitted or ambiguous, ask once and stop.

Follow the skill exactly:

1. TL;DR — the "so what" in one sentence.
2. Context / background — only what this audience needs.
3. Key updates / decisions — bullet form.
4. Next steps / asks — explicit owners and dates.

Audience-specific framing:
- **exec / board**: lead with metric impact and strategic implication. One ask, max.
- **eng**: lead with the constraint, then trade-off, then recommendation. Include rollback plan.
- **customer**: lead with the outcome they get, then the path. No internal jargon.

Write the result to `outputs/brief-<topic-slug>-<audience>-<YYYY-MM-DD>.md` (today's date).

Tone: matched to audience. No forbidden phrases ("I apologize for the confusion", "great question", emoji unless requested).
