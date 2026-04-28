# Skill: PRD from Signal

## Trigger
`/prd [signal]`

## Goal
Transform a raw user signal (e.g., a customer quote, a support ticket, or a feature request) into a structured Product Requirements Document (PRD) draft.

## Instructions
When the user invokes this skill with a signal, you should:
1. Analyze the signal to extract the underlying user problem (the "Why") — not just restate the surface ask.
2. Name the target audience precisely — persona, segment, JTBD.
3. Propose a solution that addresses the root problem.
4. Fill out the PRD using the canonical structure in [`templates/prd-template.md`](../templates/prd-template.md). All six sections are required:
   1. Problem Statement (what / who / why now)
   2. Proposed Solution (description + value proposition)
   3. Key Features (MoSCoW — specific features, not adjectives)
   4. User Experience / Flow (step-by-step + empty / loading / error / success states)
   5. Success Metrics (North Star + 2–3 supporting + 1–2 counter-metrics)
   6. Open Questions / Risks (technical, business, unresolved decisions)
5. Save the output to `outputs/prd-[topic-slug]-[YYYY-MM-DD].md`.

If `templates/prd-template.md` ever conflicts with the list above, the template wins — update this skill to match.

## Tone
Clear, concise, and focused on user value. Use active voice.
