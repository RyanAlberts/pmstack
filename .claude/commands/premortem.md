---
description: Pre-mortem on a target PRD — simulates 3 plausible failure stories with leading indicators and mitigations, then offers to mutate the PRD's Risks section behind a confirmation gate.
argument-hint: "<prd-slug-or-path>"
---

You are operating the **premortem** routine from pmstack. This is one of the five default routines.

Read the decision-log spec: @skills/_decision-log.md
Read the source PRD skill (for Risks-section structure): @skills/prd-from-signal.md

Arguments: **$ARGUMENTS**

## What this is, in one line

Klein's pre-mortem trick: pretend the feature failed 6 months from now and write the post-mortem now, before launch. The only routine in pmstack that **mutates** an existing artifact instead of appending another.

## When this runs

- **Slash only.** Pre-mortems are PRD-specific events, not calendar events. `/loop` does not apply.
- Invoke with `/premortem <prd-slug>` (matches a glob like `outputs/prd-<slug>-*.md`) or `/premortem <full-path-to-prd>`.

## Procedure

1. **Resolve target PRD.** If `$ARGUMENTS` is empty, list all `outputs/prd-*.md` and ask which. If a slug, glob `outputs/prd-<slug>-*.md`. If a path, read it directly.
2. **Gather context.** Read the PRD. Optionally read same-domain `outputs/competitive-*.md` and `outputs/eval-*.yaml` if their topic slug overlaps. Read prior `outputs/premortem-*.md` (if any) to recognize recurring failure-mode categories.
3. **Simulate failure.** Time-jump 6 months post-launch. Write 3 distinct failure stories in this exact structure:
   ```
   ### Failure story <N>: <one-line headline>
   **What happened:** <2–4 sentences narrating the specific failure>
   **Anchored to PRD:** <quote or section reference from the source PRD>
   **Leading indicator:** <a metric, signal, or qualitative observation that would have surfaced this BEFORE launch>
   **Mitigation:** <one specific action to take before shipping>
   ```
   The stories must span different failure modes — at least one each from: (a) capability/quality, (b) adoption/UX, (c) operational/cost. Do not stack 3 quality failures.
4. **Write the artifact** to `outputs/premortem-<topic-slug>-<YYYY-MM-DD>.md` with header:
   ```
   # premortem — <topic> — <YYYY-MM-DD>
   PRD: <relative path to source PRD>
   ```
5. **Confirmation gate (mandatory).** Show the 3 mitigations as a numbered list. Ask: "Which mitigations should I append to the PRD's Risks section? (e.g., '1,3' or 'all' or 'none')". **Do not auto-mutate.** Wait for explicit selection.
6. **Mutate the PRD's Risks section** with the accepted mitigations. If the PRD has no Risks section, append one with H2 `## Risks (added by /premortem <date>)`. Keep the original PRD content intact otherwise.
7. **Record rejected mitigations** in the premortem artifact under `## Rejected mitigations` with a one-line reason (PM-supplied or "rejected without reason given").
8. **Append to decision log.** One line: `- <date> — premortem(<topic>): <N>/3 risks accepted — outputs/premortem-<topic>-<date>.md`.

## Hard rules

- **Stories must be specific, not generic.** "Adoption could be lower than expected" fails. "Devs in Slack share screenshots of bad code-review suggestions on day 1, the meme spreads, the trial closes with a sour taste" passes.
- **Each story must have a leading indicator that's measurable today.** If the indicator requires production traffic that doesn't exist, replace it with a pre-launch proxy.
- **The confirmation gate is not optional.** Auto-mutating PRDs is a footgun. Wait for the PM's explicit choice.
- **Anchor every story to the PRD.** Quote or section reference is required. Disconnected stories are creative writing, not pre-mortem.

## Success criteria (used by e2e test)

- File `outputs/premortem-<topic>-<date>.md` exists.
- Contains exactly 3 failure stories with the (story / anchor / leading indicator / mitigation) structure.
- Each story has a verifiable PRD anchor (quote or section reference).
- Confirmation gate fires and produces a diff the PM accepts or rejects.
- On accept, source PRD's Risks section is mutated.
- `decisions-log.md` gains one line.

## Anti-patterns

- Do not write 3 stories that are all "quality issues." Span the failure modes.
- Do not auto-accept all mitigations to be "helpful." The gate exists for a reason.
- Do not append to PRD without showing a diff first.
