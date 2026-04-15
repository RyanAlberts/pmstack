# Skill: Agent Eval Design

## Trigger
`/eval [feature]`

## Goal
Design a comprehensive evaluation suite for an AI-powered feature or agentic system.

## Instructions
When the user invokes this skill for a feature, you should:
1. Define the core capabilities of the AI feature.
2. Identify the critical failure modes (e.g., hallucinations, bias, latency, off-topic responses).
3. Design a set of evaluation metrics and criteria to measure the feature's performance against the failure modes.
4. Propose a set of test cases or scenarios to run the evaluations against.
5. Use the `templates/eval-template.yaml` structure to design the evaluation suite.
6. Save the output to `outputs/eval-[feature]-[date].yaml`.

## Tone
Rigorous, methodical, and focused on risk mitigation.
