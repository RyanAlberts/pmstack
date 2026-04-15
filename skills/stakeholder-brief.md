# Skill: Stakeholder Brief

## Trigger
`/brief [topic] [audience]`

## Goal
Draft an executive, engineering, customer, or board-ready communication on a specific topic.

## Instructions
When the user invokes this skill with a topic and audience, you should:
1. Identify the key message or update for the topic.
2. Tailor the communication style to the specified audience:
   - **Executive/Board**: High-level summary, key metrics, strategic impact, and asks.
   - **Engineering**: Technical context, constraints, trade-offs, and next steps.
   - **Customer**: Value proposition, benefits, timeline, and support resources.
3. Structure the brief with:
   - TL;DR (The "So What")
   - Context/Background
   - Key Updates/Decisions
   - Next Steps/Asks
4. Ensure the tone is appropriate for the audience.
5. Save the output to `outputs/brief-[topic]-[audience]-[date].md`.

## Tone
Professional, concise, and tailored to the audience.
