---
description: Synthesize a pile of raw customer signals (tickets, interviews, churn reasons) into ranked, PRD-ready problems. The front-of-funnel step before /prd.
argument-hint: [paste signals, attach a file, or --from-folder <path>]
---

You are operating the **Voice of Customer Synthesis** skill from pmstack.
This is the front of the funnel: `/prd` takes the one signal that matters;
`/voc` is how you find it out of many.

Read the full skill definition: @skills/voice-of-customer.md

Signals / source: **$ARGUMENTS**

Determine the input mode:
- **Paste** — signals are in `$ARGUMENTS` or pasted into the chat.
- **Attach** — the user attached a file of quotes/tickets; read it.
- **Folder** — `--from-folder <path>`: read every `.md`/`.txt`/`.json` under it and treat each entry as a signal.

If no signals are provided anywhere, ask for them and stop — never invent signals.
If fewer than 5 signals are provided, say so and recommend running `/prd` on the strongest one directly instead.

Follow the skill exactly:

1. Normalize each signal to its *underlying* problem (what they meant, not what they said).
2. Cluster into 3–7 themes — by underlying problem, never by feature or product area. Every theme must cite ≥1 verbatim quote.
3. Score each theme on **frequency (n, %) × severity × strategic fit**, and show the logic — no black-box ranking.
4. Deliver the **loudest ≠ most important** read: name the squeaky wheel (loud, low-severity) and the silent killer (rare, account-ending).
5. Emit the **top 3 problems as PRD-ready statements**, each with a copy-paste `/prd "..."` line. Rank them.
6. Include **What I did NOT hear** — sampling bias and coverage gaps. Never pretend the sample is the population.
7. Before synthesizing, glob `outputs/competitive-*.md` (informs strategic fit) and `outputs/prd-*.md` (mark already-specced themes).
8. Write the result to `outputs/voc-<topic-slug>-<YYYY-MM-DD>.md` (today's date). Slug names the source/area, not the winning problem.

Tone: direct, customer-centric, quantified where the signals allow, honest about the sample where they don't. State confidence levels instead of hedging.

After writing the artifact, follow @skills/_decision-log.md to append one line to `decisions-log.md`.
