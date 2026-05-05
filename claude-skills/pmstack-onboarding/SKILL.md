---
name: pmstack-onboarding
description: An interactive 7-step tutorial that walks a new user through every pmstack capability using a realistic AI-code-review scenario. Works in claude.ai web, desktop, and mobile (no terminal needed). Trigger when the user says "I just installed pmstack," "how do I use this," "tutorial," "walk me through pmstack," "getting started," or "show me what pmstack does."
---

# pmstack-onboarding — interactive tutorial

A 7-step walkthrough of pmstack's full capability set. Every step is runnable, has an example input, and produces a real artifact.

## Procedure

For each step: print the header, explain the capability in 2–3 plain-English sentences, show the exact command (or, on web/desktop, show the natural-language phrasing that triggers the skill), then **stop and wait** for the user to type `next`, `skip`, `back`, or ask a question.

The 7 steps:

1. **Welcome + customer signal** — present the tutorial signal: "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review."
2. **`/prd`** — translate the signal into a PRD.
3. **`/competitive`** — scan the market.
4. **`/premortem`** — stress-test the PRD with 3 failure stories.
5. **`/sprint`** — chain metrics → eval → brief.
6. **`/launch-readiness` + `/lint`** — gate routines before shipping.
7. **Schedule the recurring routines** — `/weekly`, `/eval-drift`, `/lint` on `/loop 7d`.

After step 7, print a final recap table mapping each capability to "when you'd use it" and prompt the user to run a *real* `/prd` on a quote they have lying around.

## Hard rules

- **Wait for explicit user advance between steps.** Never auto-run all 7.
- **Tutorial artifacts go to `outputs/onboarding-tutorial/`** (not the user's real `outputs/`).
- **Surface-aware.** If the user is on claude.ai web/desktop (no filesystem), emit each artifact inline as a markdown block they can copy. Tell them this up front.
- **If a comparison-example file is missing**, fall back to a one-paragraph inline description.

## Where to write

- Filesystem: `outputs/onboarding-tutorial/<artifact-name>.md`.
- Inline (web/desktop): markdown blocks in the conversation. Suggest a filename at the top of each block so the user knows what to call it if they save it.

## Decision-log entry

Append one line *only at the end of the tutorial*: `- <date> — onboarding: tutorial completed — outputs/onboarding-tutorial/`.

## Tone

Friendly, concise, anti-jargon. State each capability's value in plain English before the technical details. The user may not be technical.

## Cold-start behavior

If `outputs/` is empty (this is most users on first run), the tutorial fills it as it goes. If `outputs/` already has content, the tutorial still writes to `outputs/onboarding-tutorial/` — never overwriting prior work.
