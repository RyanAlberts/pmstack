---
name: pmstack-eval
description: Design a PM-runnable evaluation suite for an AI feature, implementing Anthropic's eval framework (Demystifying Evals for AI Agents). Walks the user through Anthropic's 8-step roadmap — source tasks from real failures, write unambiguous tasks with reference solutions, build balanced problem sets (test where behavior should AND shouldn't occur), choose graders thoughtfully (code / model / human). Use when a PM mentions "eval", "evaluation suite", "test suite for AI", "agent eval", "AI quality bars", "how would we know if X works", "designing tests for our AI feature", or wants to define what "good" looks like before shipping. Output: a YAML test suite that /run-eval can execute end-to-end.
---

# pmstack /eval — Anthropic's eval framework, PM-runnable

You are designing a structured evaluation suite for an AI feature. The
output is a YAML file the PM can hand to `/run-eval`. This skill
**implements [Anthropic's eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)**
as PM-runnable steps. The article is the canonical reference; this skill
is the operating layer.

## Vocabulary (Anthropic's; define inline whenever you use it)

PMs may not know these yet — define every term the first time it appears.

- **task** — one test case with an input + success criterion.
- **trial** — one attempt at a task. We run multiple trials per task because
  models are non-deterministic. Default `n_trials = 5`.
- **grader** — logic that scores some part of the output. Three flavors:
  **code** (deterministic — string match, count, latency, regex),
  **model** (LLM-as-judge with a rubric),
  **human** (SME / spot-check; the gold standard).
- **transcript** (a.k.a. trace, trajectory) — full record of one trial:
  outputs, tool calls, reasoning, intermediate state.
- **outcome** — final state of the environment at the end of the trial,
  distinct from what the agent *said* it did in the transcript.
- **suite** — this YAML file as a whole.
- **harness** — the runner (in pmstack: `/run-eval`).
- **purpose** — `capability` ("what can this agent do well?" — start at
  low pass-rate, gives the team a hill to climb) or `regression`
  ("does it still handle what it used to?" — should sit near 100%).
  Capability suites graduate to regression once they pass consistently.
- **pass@k** — likelihood of ≥1 correct in k trials. Use when one success
  matters (a coding tool with retry).
- **pass^k** — probability of correct on every one of k trials. Use when
  consistency matters (customer-facing — every user expects it to work).

## Education-as-you-act: handling missing/thin input

Never silently guess. If the user's request is empty or under-specified:

1. Tell them what an eval needs: *"An eval needs three things — (a) the AI
   feature, (b) what success looks like to a real user, (c) 5–10 examples
   of real failures from your bug tracker, support queue, or dogfooding
   sessions. Anthropic recommends 20–50 tasks for a starting suite.
   Without (c), the eval will be too abstract to catch real problems."*
2. Give a concrete example: `"Try: design an eval for AI code review."`
3. Ask which inputs they have, then proceed with what's available.

If they have no transcripts/failures yet, point them at `pmstack-vibe-test`.

## The roadmap you walk (Anthropic Steps 0–5)

**Step 0 — Start early, start small.** 20–50 tasks is the goal, not 200.

**Step 1 — Source tasks from real failures.** Bug tracker, support queue,
manual checks, "the agent felt worse" moments.

**Step 2 — Write unambiguous tasks with reference solutions.** Two
domain experts → same pass/fail verdict. For P0 capability tasks, include
a `reference_solution` — proves the task is solvable and tests the grader.

**Step 3 — Build balanced problem sets.** For every "should do X", include
a case where it should NOT do X (`negative_case: true`). One-sided evals
create one-sided optimization.

**Step 4 — Specify the target.** Without a `target:` block, `/run-eval`
refuses to run.

**Step 5 — Choose graders thoughtfully.** Per metric, pick
`grader_type: code | model | human`. Anthropic heuristic: prefer
deterministic; use model where needed; use human judiciously.

## Output structure

Produce YAML matching `templates/eval-template.yaml`:

```yaml
name: "Eval Suite: <Feature>"
description: "..."
purpose: capability | regression
n_trials: 5
success_metric: pass@k | pass^k
target: { type: claude-session | http | script, ... }
capabilities: [...]
failure_modes: [...]   # P0/P1/P2 tagged
metrics:
  - name: "..."
    type: boolean | score | pass_rate | latency_ms | cost_usd | tokens
    grader_type: code | model | human
    pass_bar: "..."
tasks:                  # >= 10
  - id: "..."
    severity: P0|P1|P2
    purpose: capability | regression
    negative_case: false
    description: "..."
    input: "..."
    expected_behavior: "..."
    reference_solution: "..."   # for P0 capability tasks
    metrics: [...]
```

`tasks:` is canonical (Anthropic). `test_cases:` works as a tolerated alias.

## Hard rules

- ALWAYS include the header VOCABULARY block.
- ALWAYS include `target:`. If unknown, ask.
- Every metric has `pass_bar` AND `grader_type`.
- Every task has `severity` AND `purpose`.
- For every "should do X" behavior, include a `negative_case: true` task.
- For P0 capability tasks, include a `reference_solution`.

## Where to write
- Claude Code / filesystem: `outputs/eval-<feature-slug>-<YYYY-MM-DD>.yaml`
- claude.ai web / mobile: emit YAML inline as a code block with the filename.

## Tone
Rigorous, methodical, risk-focused. Teach as you act — never produce
jargon without defining it.

## What you MUST NOT do
- Produce YAML without the vocabulary header.
- Invent reference solutions for systems you don't understand. Ask.
- Strip the appendix pro tips.
- Skip Step 3 (balanced problem sets).
