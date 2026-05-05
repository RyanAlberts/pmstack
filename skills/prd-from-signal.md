# Skill: PRD from Signal

## Trigger
`/prd "<a customer signal>"` — a quote, ticket, exec ask, support thread, sales note, churn reason. Anything that says "we have a customer problem; help me write a spec."

## Goal
Transform a raw signal into a PRD draft that engineering can plan from and an exec can fund. **The skill's value is the translation from "what they said" → "what they meant" → "what they need" → "what we build."** PMs leak hours doing this badly; the skill makes it 60 seconds.

## What good looks like

Before writing anything, you should be able to fill these blanks:

- **What they said:** [the signal verbatim]
- **What they meant:** [the underlying frustration, dependency, or fear — usually broader than the literal ask]
- **What they need:** [the outcome they're optimizing for — not a feature]
- **What we'll build:** [a specific scope that delivers the outcome, not the literal ask]

If you can't fill all 4 from the signal alone, **ask 1–2 clarifying questions before drafting**. Do not invent answers.

## Read prior context (skill graph)

Before writing, glob `outputs/competitive-*.md`. If a recent (≤30 days) competitive scan covers this market, **use it for the Target Audience and Proposed Solution sections** — competitive positioning is the cheapest way to ground a PRD in reality. Don't re-derive what's already been analyzed.

Also check `outputs/prd-*.md`. If a same-topic PRD exists, decide: refresh-in-place (edit the prior file) or fork (new dated file with a slug suffix). Default to refresh; fork only if the scope materially changed.

## Required structure (6 sections)

1. **Problem Statement** — what / who / why now
   - Quote the signal verbatim.
   - Name the segment(s) affected, with rough size if known.
   - Name the business cost of *not* fixing it (revenue, churn, NPS, support load).

2. **Proposed Solution** — description + value proposition
   - One paragraph the user could read in 20 seconds.
   - Lead with the *outcome* delivered, not the *feature* shipped.
   - Name 1–2 explicit *non-goals* (what this is NOT). Non-goals are 80% of scope discipline.

3. **Key Features (MoSCoW)** — Must / Should / Could / Won't
   - Each item must be a *concrete feature*, not an adjective.
   - **Bad:** "Must have great onboarding." **Good:** "Must show a 60-second product tour on first session that the user can dismiss."
   - **Won't** is required and must contain ≥1 item — explicitly excluding scope is what makes Must/Should defensible.

4. **User Experience / Flow** — step-by-step
   - Walk through the *primary* flow numbered 1, 2, 3.
   - Then enumerate *empty / loading / error / success* states. AI features especially fail at error states; do not skip.

5. **Success Metrics** — North Star + supporting + counter
   - **North Star:** one metric. Measurable today (or with a known instrumentation cost). State the target.
   - **Supporting (2–3):** intermediate metrics that move when the North Star moves.
   - **Counter (1–2):** metrics that getting *worse* would tell you you're optimizing the wrong thing. (E.g., for "median review time," a counter might be "% reviews that catch blocker bugs" — speed-without-quality is the failure mode.)

6. **Open Questions / Risks**
   - Bullet the *unresolved* decisions (do not pretend they're decided).
   - Risks at two layers: technical and business. Each risk has a one-line "if X, then Y" structure.

## Hard rules

- **Extract the underlying problem, not the surface ask.** Customers describe symptoms ("can we have a button"); PMs translate to mechanism ("they can't tell which PRs need urgent review").
- **MoSCoW must be specific.** No adjective-only items. No "Must work well." Every item is a feature you could draw or describe in one sentence.
- **Always include North Star + supporting + counter.** The counter-metric is not optional — without it the optimization goes too far and you don't notice.
- **Never invent customer numbers.** If you don't have segment size or revenue impact, write "unknown — need [data source]" instead of fabricating.
- **State confidence, don't hedge.** Per CLAUDE.md: replace "this might work" with "I'm confident this works for X; uncertain on Y."
- **Empty/loading/error states are required.** Skipping them produces PRDs that look complete but ship features that crash on edge cases.
- **`Won't` (MoSCoW) requires ≥1 explicit item.** "Won't: nothing" fails this rule.

## Anti-patterns

- Restating the customer's literal ask as the problem statement. (Customers describe symptoms.)
- Vague North Stars like "improve UX" or "delight users." If you can't measure it, it's not a North Star.
- MoSCoW with only "Must" items — that's a feature list, not a prioritization.
- Skipping the counter-metric because "we'll know if it's bad."
- Solving the wrong problem because the signal was misread. (See "What good looks like" above.)

## Where to write

- With filesystem: `outputs/prd-<topic-slug>-<YYYY-MM-DD>.md`. The slug is 2–4 words, kebab-case, derived from the problem (not the solution): `prd-trial-onboarding-2026-04-25.md`, not `prd-product-tour-2026-04-25.md`.
- Inline (web/mobile): emit as markdown with the suggested filename at the top.

## Decision-log entry

Per @skills/_decision-log.md, append one line to `decisions-log.md`:

```
- <YYYY-MM-DD> — prd: <topic> — outputs/prd-<topic-slug>-<YYYY-MM-DD>.md
```

## Worked example

The signal:
> "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason."

The translation:
- **What they said:** code reviews are slow.
- **What they meant:** the review queue depth is killing dev velocity AND blocking merges, and we can't tell which.
- **What they need:** confidence that any given PR will get a fast, useful review.
- **What we'll build:** an AI reviewer that produces a useful first-pass review within minutes of PR open, plus a queue-priority signal so humans review the right PRs first.

The full output: see `examples/walkthrough-code-review/prd-code-review-2026-05-05.md`.

## Tone
Direct. Customer-centric. State confidence levels — don't hedge. Active voice. No emojis. No "I apologize" or "great question." Per CLAUDE.md.
