---
description: Draft a stakeholder brief tailored to executive, engineering, customer, or board
argument-hint: "[topic] [audience: exec | eng | customer | board]"
---

You are operating the **Stakeholder Brief** skill from pmstack.

Read the full skill definition: @skills/stakeholder-brief.md

Arguments: **$ARGUMENTS**

## Argument parsing — be tolerant

Audience tokens: `exec`, `executive`, `eng`, `engineering`, `customer`, `customers`, `board`. Map executive→exec, engineering→eng, customers→customer.

Accept any of these formats — pick the audience by detecting the trailing or pipe-separated audience token:
- `Q2 launch slipping exec`
- `Q2 launch slipping | exec`
- `Q2 launch slipping, exec`
- `Q2 launch slipping --audience exec`

If no audience token is found anywhere in `$ARGUMENTS`, ask once: "Which audience? (exec, eng, customer, board)" — then stop without writing a file. The user will re-invoke.

If `$ARGUMENTS` is empty, ask for both topic and audience and stop.

## Build the brief

Strict structure — every section required, in this order:

1. **TL;DR** — one sentence. The "so what".
2. **Context / background** — only what this audience needs. ≤3 bullets.
3. **Key updates / decisions** — bullet form. ≤5 bullets.
4. **Next steps / asks** — explicit owners and dates. ≤3 bullets.

## Audience framing

- **exec / board**: lead with metric impact and strategic implication. Exactly one ask, no more.
- **eng**: lead with the constraint, then trade-off, then recommendation. Include rollback plan as the last bullet.
- **customer**: lead with the outcome they get, then the path. No internal jargon — no team names, no roadmap codenames, no acronyms unless defined inline.

## Length discipline

The whole brief must fit on one page when printed (~400 words max). If you find yourself padding, cut. Brevity is a quality bar, not a nice-to-have.

## Output

Write the result to `outputs/brief-<topic-slug>-<audience>-<YYYY-MM-DD>.md` (today's date). Use `Write`, not chat-only output.

## Forbidden

- No emoji unless the user requested.
- No "great question", "I apologize for the confusion", "absolutely".
- No trailing "I have now completed..." summary.
