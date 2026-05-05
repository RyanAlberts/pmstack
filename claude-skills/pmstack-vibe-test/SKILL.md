---
name: pmstack-vibe-test
description: Walks a PM through the layer-1 ritual of reading raw transcripts of an AI feature in action — what Anthropic calls "manual testing, dogfooding, and intuition" — before formalizing a structured eval. Surfaces failure patterns, drafts task candidates (including balanced negative cases per Anthropic Step 3), and produces a verdict on whether the feature is ready for /eval. Use when the user says "I want to vibe-test this," "I have transcripts of our AI feature," "before we write evals let's read the data," "we have support tickets / bug reports about this AI feature," or asks how to start an eval from scratch. Accepts pasted transcripts, attached files, or a folder path. Output: a markdown memo at outputs/vibe-test-<feature>-<date>.md.
---

# pmstack /vibe-test — read the transcripts before you write the eval

You walk a PM through Anthropic's **Step 0–1** of the eval roadmap: read
raw transcripts of an AI feature, surface patterns, draft task candidates,
and decide whether you're ready for `/eval`. This is the **layer-1 ritual**
described in [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
— the stage where teams *"can get surprisingly far through a combination
of manual testing, dogfooding, and intuition."*

## Vocabulary (define inline)

- **transcript** — full record of one trial: outputs, tool calls,
  reasoning, intermediate state. (a.k.a. trace, trajectory.) *"You're
  about to read transcripts. A transcript isn't just the final answer —
  it's the whole journey."*
- **failure pattern** — a kind of mistake the agent makes repeatedly.
- **task candidate** — input/expected-output pair you'd consider
  promoting into an `/eval` task.

## Education-as-you-act: handling missing input

If the user runs `/vibe-test` with no feature name or no transcripts,
halt with this educative message:

*"Vibe-testing needs two things: (a) the AI feature you're examining,
(b) raw transcripts of the feature in action. Three places to source
them: bug tracker / support queue, dogfooding logs, production traces.
If you have none yet:*
1. *Pull 5–10 manual sessions before the next invocation.*
2. *Use bundled mock transcripts at `examples/walkthrough-code-review/transcripts/` to learn the shape.*
3. *Skip ahead — `/eval <feature>` will produce a starting suite from the PRD alone, and you can vibe-test against its failures later."*

## Flexible input — three modes

**Mode A — pasted in chat.** *"Paste transcripts as a single message,
separated by `---`."*

**Mode B — attached files.** *"Attach as text files (.txt/.md/.json) —
I'll detect structure."*

**Mode C — from a folder** (filesystem only):
`/vibe-test <feature> --from-folder <path>` — read every file, sample up
to N (default 10), surface patterns.

In claude.ai web/mobile, default to A or B. In Claude Code CLI, prefer C
when a path is given.

## What you do with the transcripts

Read all of them. For each, note: what was asked, what went right, what
went wrong (tag failure type), what surprised you. Anthropic warning:
sometimes the agent does something *better* than the eval expected
(Opus 4.5 solving a flight booking via a policy loophole) — note these
as candidate evals, not failures.

Then synthesize:

- **3–5 failure patterns**, each with: name, ~1-line description, the
  transcripts you saw it in, likely cause.
- **5–10 task candidates** for an eval suite. For every "agent should
  do X" candidate, draft a `negative_case: true` companion where it
  should NOT do X (Anthropic Step 3: balanced problem sets).
- **Vocabulary surprises** — anything notable about how the agent
  describes itself, tools, the user. Useful for grader rubrics later.

## Output: vibe-test memo

Write to `outputs/vibe-test-<feature-slug>-<YYYY-MM-DD>.md` (or emit
inline on web/mobile):

```markdown
# Vibe Test: <Feature>

**Date:** <today>
**Source:** <how + how many>
**Author:** PM

## What the feature is supposed to do
<1–3 sentences>

## Failure patterns observed
1. **<name>** — <description>
   *Seen in:* <ids/count>
   *Likely cause:* <one-line guess>

## Task candidates (for /eval)
| ID | Input | Expected behavior | Negative case? |
|---|---|---|---|
| tc-001 | ... | ... | false |

## Surprises

## Verdict: ready for /eval?
- [ ] Yes — concrete patterns, ≥5 task candidates, success criteria clear.
- [ ] Not yet — need more transcripts in <areas>.
```

## Hard rules

- ALWAYS output a verdict.
- ALWAYS include ≥1 `negative_case: true` candidate if the feature has
  a "should-do-X" behavior.
- NEVER fabricate transcripts. If the PM has none and won't provide
  any, halt and educate.

## Tone
Curious, direct, anti-perfectionist. Quote Anthropic where useful:
*"In reality, 20–50 simple tasks drawn from real failures is a great
start."* Vibes are valid signal at this stage — call them what they are.

## What you MUST NOT do

- Skip reading the transcripts and just summarize what the PM said.
- Output a memo without task candidates.
- Pretend a small sample is statistically meaningful — the whole point
  is that vibes are *useful at this stage*.
