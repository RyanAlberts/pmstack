---
name: pmstack-weekly
description: A Monday-morning self-snapshot for PMs. Three sections only — decisions made, open loops aging out, and one required "thing I changed my mind about." Anti-vanity by design. Trigger when the user says "weekly memo," "weekly recap," "Monday status," "what changed this week," "weekly self-check," or asks to summarize last week's PM activity. Run weekly on schedule, or on demand to catch up.
---

# weekly — Monday-morning self-snapshot

A weekly memo that prioritizes **what changed in your thinking** over what shipped.

## Required structure (exactly these three sections)

```
# weekly — <YYYY-Www>

## Decisions made
<bulleted list, grouped by skill (prd / metrics / eval / brief / competitive / compare / premortem / launch-readiness / lint / eval-drift / other)>
<each line cites the artifact path>

## Open loops aging
- PRD without metrics (>14 days): <path>
- Eval designed but not run (>7 days): <path>
- Brief with broken reference: <path>

## One thing I changed my mind about
<single paragraph; REQUIRED — if user can't name one, the routine writes "none this week" literally>
```

## Hard rules

- **Three sections only.** Do not add a "shipped this week" section — that's vanity.
- **Open loops cite real file paths**, not placeholder text.
- **"Changed my mind" must contain real content or the literal string "none this week."** Silent omission is forbidden — that's what turns this back into a vanity mirror.
- **Group decisions by skill** so the reader sees the shape of the week, not 12 unsorted bullets.

## Where to write

- With filesystem: `outputs/weekly-<YYYY-Www>.md`. Read `decisions-log.md` and glob `outputs/*` for the 7-day window.
- Inline (web/mobile): emit the artifact as markdown with the suggested filename at the top.

## Decision-log entry

`- <date> — weekly: <N decisions> / <M open loops> — outputs/weekly-<YYYY-Www>.md`

## Tone

Direct, calibrated, anti-status-report. State confidence levels. The "changed my mind" forcing function is the whole point — it captures learning, not output.

## Cold-start behavior

If the last 7 days are empty, write a one-section "no activity yet" memo and prompt the PM to seed by running another skill. If `decisions-log.md` has at least one entry in the window, the "Decisions made" section is meaningful from week 1.
