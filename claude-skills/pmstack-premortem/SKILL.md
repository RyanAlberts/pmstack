---
name: pmstack-premortem
description: Run a Klein-style pre-mortem on a draft PRD before launch — simulates 3 plausible failure stories 6 months in the future, names leading indicators and mitigations, then offers to mutate the PRD's Risks section. Trigger when the user says "pre-mortem," "what could go wrong," "risk pass," "imagine this fails," "stress test the spec," or asks to harden a PRD before review. Use after /prd, before launch.
---

# premortem — pre-mortem on a target PRD

Klein's pre-mortem trick: pretend the feature failed 6 months from now and write the post-mortem now, before launch. The only pmstack capability that **mutates** an existing artifact rather than appending another.

## Required structure

For each of 3 failure stories:

```
### Failure story <N>: <one-line headline>
**What happened:** <2–4 sentences narrating the specific failure>
**Anchored to PRD:** <quote or section reference from the source PRD>
**Leading indicator:** <a metric, signal, or qualitative observation that would have surfaced this BEFORE launch>
**Mitigation:** <one specific action to take before shipping>
```

The 3 stories must span at least: (a) capability/quality, (b) adoption/UX, (c) operational/cost. Do not stack 3 quality failures.

## Hard rules

- **Stories must be specific, not generic.** "Adoption could be lower than expected" fails. "Devs share screenshots of bad code-review suggestions on day 1, the meme spreads, the trial closes sour" passes.
- **Each leading indicator must be measurable today.** No reliance on production traffic that doesn't exist — use a pre-launch proxy.
- **Confirmation gate is mandatory.** After writing the artifact, list the 3 mitigations and ask which to append to the PRD's Risks section. Do not auto-mutate. Wait for explicit selection ("1,3" or "all" or "none").
- **Anchor every story to the PRD.** Quote or section reference required.

## Where to write

- With filesystem: `outputs/premortem-<topic-slug>-<YYYY-MM-DD>.md`. On accept, mutate the source PRD's Risks section. Rejected mitigations land in `## Rejected mitigations` of the premortem artifact.
- Inline (web/mobile): emit the premortem markdown plus a separate "Suggested PRD diff" block the user pastes into their PRD.

## Decision-log entry

`- <date> — premortem(<topic>): <N>/3 risks accepted — outputs/premortem-<topic>-<date>.md`

## Tone

Concrete, narrative, blunt about failure modes. PMs systematically under-fill risk sections; this skill is the corrective.

## Cold-start behavior

Works the moment **one** PRD exists. No history required.
