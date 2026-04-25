---
name: pmstack-brief
description: Draft a stakeholder brief on a topic, tailored to executive, engineering, customer, or board audience. Use when a PM asks for a "brief", "update", "readout", "exec summary", "eng comms", "customer announcement", or "board update", or when they need to communicate a status / decision / change to a specific audience and need help adapting the framing.
---

# Stakeholder Brief

Draft a one-page brief tailored to its audience.

## Argument parsing — be tolerant

Audience tokens: `exec`, `executive`, `eng`, `engineering`, `customer`, `customers`, `board`. Map executive→exec, engineering→eng, customers→customer.

Accept any of these formats — pick the audience by detecting the trailing or pipe-separated audience token:
- `Q2 launch slipping exec`
- `Q2 launch slipping | exec`
- `Q2 launch slipping, exec`
- `Q2 launch slipping --audience exec`

If no audience is found, ask once: "Which audience? (exec, eng, customer, board)" and stop.

## Required structure

1. **TL;DR** — one sentence. The "so what".
2. **Context / background** — only what this audience needs. ≤3 bullets.
3. **Key updates / decisions** — bullet form. ≤5 bullets.
4. **Next steps / asks** — explicit owners and dates. ≤3 bullets.

## Audience framing

- **exec / board**: lead with metric impact and strategic implication. Exactly one ask, no more.
- **eng**: lead with the constraint, then trade-off, then recommendation. Include rollback plan as the last bullet.
- **customer**: lead with the outcome they get, then the path. No internal jargon — no team names, codenames, or undefined acronyms.

## Length discipline
≤400 words total. One printed page. If you find yourself padding, cut.

## Where to write
- With filesystem: `outputs/brief-<topic-slug>-<audience>-<YYYY-MM-DD>.md`
- Inline (web/mobile): emit as markdown with the suggested filename

## Forbidden
- Emoji unless the user requested
- "great question", "I apologize for the confusion", "absolutely"
- Trailing "I have now completed..." summaries
