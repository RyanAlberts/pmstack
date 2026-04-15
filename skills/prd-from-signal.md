# Skill: PRD from Signal

## Trigger
`/prd [signal]`

## Goal
Transform a raw user signal (e.g., a customer quote, a support ticket, or a feature request) into a structured Product Requirements Document (PRD) draft.

## Instructions
When the user invokes this skill with a signal, you should:
1. Analyze the signal to extract the underlying user problem (the "Why").
2. Propose a solution or feature that addresses the problem.
3. Use the `templates/prd-template.md` structure to draft the PRD.
4. Include:
   - Problem Statement
   - Target Audience
   - Proposed Solution
   - Key Features (MoSCoW prioritization)
   - Success Metrics
5. Save the output to `outputs/prd-[topic]-[date].md`.

## Tone
Clear, concise, and focused on user value. Use active voice.
