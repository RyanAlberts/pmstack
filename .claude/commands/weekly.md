---
description: Monday-morning self-snapshot. Three sections — decisions made, open loops aging, and one required "thing I changed my mind about." Runs on /loop 7d or on demand.
argument-hint: "[--week YYYY-Www]"
---

You are operating the **weekly** routine from pmstack. This is one of the five default routines.

Read the decision-log spec: @skills/_decision-log.md
Read the brief skill (for the final formatting pass): @skills/stakeholder-brief.md

Arguments: **$ARGUMENTS**

## What this is, in one line

A weekly self-snapshot that prioritizes **what changed in your thinking** over what shipped. Anti-vanity by design.

## When this runs

- **Both forms.** Canonical form is `/loop 7d /weekly` (default Mondays). Slash form is for catching up after travel or running the routine ad hoc.
- If `--week YYYY-Www` is supplied, target that week instead of "last 7 days."

## Procedure

1. **Resolve the window.** Default: now − 7 days. If `--week` is given, derive the start/end. If today is Monday, the window covers the prior Mon–Sun.
2. **Gather state.**
   - Read `decisions-log.md`, filter to entries dated within the window.
   - Glob `outputs/*` and filter to files modified within the window.
   - Identify open loops by structural rule:
     - PRDs without a same-topic metrics file (slug-match) **and** age > 14 days.
     - Eval YAMLs with no matching `outputs/eval-runs/` directory **and** age > 7 days.
     - Briefs whose source artifacts no longer exist (broken reference).
3. **Write the artifact** to `outputs/weekly-<YYYY-Www>.md` with **exactly these three sections in this order**:
   ```
   # weekly — <YYYY-Www>

   ## Decisions made
   <bulleted list, grouped by skill (prd / metrics / eval / brief / competitive / compare / premortem / launch-readiness / lint / eval-drift / other)>
   <each line cites the artifact path>

   ## Open loops aging
   <bulleted list of file paths with age and why flagged; one of:>
   - PRD without metrics (>14 days)
   - Eval designed but not run (>7 days)
   - Brief with broken reference

   ## One thing I changed my mind about
   <single paragraph, REQUIRED>
   ```
4. **Required field handling.** The "Changed my mind" section must contain non-placeholder text. If the routine cannot infer one from the decision log diff (e.g., a `/premortem` reframed risk, a `/launch-readiness` override entry), prompt the PM for a sentence. If the PM declines, write `none this week` literally — silent omission is forbidden because that turns this into a vanity mirror.
5. **Apply final brief polish.** Run the assembled markdown through `/brief` instructions (read @skills/stakeholder-brief.md), audience `self`, to ensure tone is direct and confidence levels are stated.
6. **Append to decision log.** One line: `- <date> — weekly: <N decisions> / <M open loops> — outputs/weekly-<YYYY-Www>.md`.

## Hard rules

- **Three sections only.** Do not add a "shipped this week" section. That's vanity, and it duplicates `/lint`'s graph completeness check anyway.
- **Open loops must cite real file paths.** "Some PRDs are aging" fails. "outputs/prd-trial-onboarding-2026-04-25.md (age 18d, no metrics)" passes.
- **"Changed my mind" cannot silently default to empty.** Either the PM names something or the artifact literally contains "none this week."
- **Group decisions by skill.** Do not list 12 unsorted bullets. Group by `prd / metrics / eval / brief / ...` so the reader sees the shape of the week.

## Success criteria (used by e2e test)

- File `outputs/weekly-<YYYY-Www>.md` exists.
- Contains exactly the 3 named sections (structural check).
- "Open loops" section lists actual file paths from `outputs/`, not placeholder text.
- "Changed my mind" section contains non-empty text (a sentence, or literally "none this week").
- `decisions-log.md` gains one line.

## Anti-patterns

- Do not add an "accomplishments" or "shipped" section.
- Do not summarize what's *in* the decisions-log instead of what *changed*.
- Do not skip the "changed my mind" prompt to "save the user time."
