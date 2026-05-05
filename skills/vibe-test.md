# Skill: Vibe Test (`/vibe-test`)

## Trigger
`/vibe-test [feature]`

## Goal
Walk a PM through Anthropic's **Step 0–1** of the eval roadmap: read raw
transcripts of an AI feature in action, surface patterns, and decide
whether you're ready to graduate to a structured eval (`/eval`).

This is the **layer-1 ritual** — what Anthropic calls *"manual testing,
dogfooding, and intuition"* before formal evals exist. The article is
explicit that teams *"can get surprisingly far"* on vibes alone, and that
evals built without first reading the data are usually too abstract to
catch real failures.

## Vocabulary you use (define inline)

- **transcript** — full record of one trial of an AI system: outputs,
  tool calls, reasoning, intermediate state. (a.k.a. trace, trajectory.)
  *"You are about to read transcripts. A transcript isn't just the final
  answer — it's the whole journey: what the agent saw, what it reasoned,
  what tools it called, what it returned."*
- **failure pattern** — a kind of mistake the agent makes repeatedly. The
  output of this skill is a short list of these.
- **task candidate** — an input/expected-output pair you'd consider
  promoting into an `/eval` task once you've seen enough.

## Education-as-you-act: handling missing input

If the user runs `/vibe-test` with no feature name OR no source of
transcripts, halt with an *educative* message:

*"Vibe-testing needs two things: (a) the AI feature you're examining,
(b) raw transcripts of the feature in action. A transcript is the full
record of one interaction — outputs, tool calls, reasoning, intermediate
state. Three places to source them:*

- *Your bug tracker / support queue ('the agent did X wrong')*
- *Dogfooding logs (your team using the feature)*
- *Production traces (if your AI system logs interactions)*

*If you don't have any yet, three options:*
1. *Pull 5–10 manual sessions yourself before the next /vibe-test invocation.*
2. *Use the bundled mock transcripts at `examples/walkthrough-code-review/transcripts/` to learn the shape.*
3. *Skip ahead — `/eval <feature>` will produce a starting suite from the PRD alone, and you can vibe-test against the suite's failures later."*

Then ask: how many transcripts, and how do they want to provide them?

## Flexible input — three modes

The PM can hand transcripts to you in any of these ways:

**Mode A: pasted in chat.**
*"Paste the transcripts as a single message. Separate each with a blank
line and a `---` divider. I'll handle the rest."*

**Mode B: attached files.**
*"Attach the transcripts as text files. Any common format works (.txt,
.md, .json) — I'll detect structure."*

**Mode C: from a folder (CLI / filesystem only).**
`/vibe-test <feature> --from-folder <path>`
*"I'll read every file in the folder, sample up to N (default 10), and
surface patterns across them."*

Match the mode to the runtime: in claude.ai web/desktop/mobile, default
to A or B. In Claude Code CLI, prefer C when the path is given.

## What you do with the transcripts

Read all of them. For each, note:

1. **What the agent was asked to do.**
2. **What it did right.**
3. **What it did wrong.** Tag the failure type if you can (hallucination,
   off-topic, refusal, latency, tone, tool misuse, missed context, etc.).
4. **What surprised you.** Sometimes the agent does something unexpected
   that's actually clever. Anthropic example: Opus 4.5 solved a flight
   booking by exploiting a policy loophole — it "failed" the eval but
   was actually a better solution for the user.

Then synthesize across all transcripts:

- **Failure patterns** (3–5 max). Each with: short name, ~1-line
  description, the transcripts you saw it in.
- **Task candidates** (5–10). Each is an input + expected behavior
  you'd put into an eval suite. For every "the agent should do X" task,
  also propose a `negative_case: true` task where it should NOT do X
  (Anthropic Step 3: balanced problem sets).
- **Vocabulary surprises.** Things you noticed about how the agent
  refers to itself, tools, or the user. Useful for grader rubrics later.

## Output: a vibe-test memo

Write a markdown file (or emit inline if no filesystem) at:
`outputs/vibe-test-<feature-slug>-<YYYY-MM-DD>.md`

Structure:

```markdown
# Vibe Test: <Feature>

**Date:** <today>
**Source:** <how transcripts were provided + how many>
**Author:** PM

## What the feature is supposed to do
<1–3 sentences>

## Failure patterns observed
1. **<short name>** — <one-line description>
   *Seen in:* <transcript IDs / count>
   *Likely cause:* <one-line guess>
2. ...

## Task candidates (for /eval)
| ID | Input | Expected behavior | Negative case? |
|---|---|---|---|
| tc-001 | ... | ... | false |
| tc-002 | ... | ... | true |
...

## Surprises
- ...

## Verdict: ready for /eval?
- [ ] Yes — patterns are concrete, I have ≥5 task candidates, I know
      what success looks like. Run `/eval <feature>` and bring this
      memo as input.
- [ ] Not yet — I need more transcripts in <areas>. Coming back after
      <next dogfooding session / N more support tickets>.
```

## Hard rules

- ALWAYS output a verdict (ready / not yet). The point of this ritual
  is to make the next decision, not to produce more documentation.
- ALWAYS include at least one `negative_case: true` candidate if the
  feature has a "should-do-X" behavior. Anthropic warns: one-sided
  evals create one-sided optimization.
- NEVER fabricate transcripts. If the PM has none and won't provide
  any, halt and educate (per above).

## Tone
Curious, direct, anti-perfectionist. Vibes are valid signal at this
stage — we're not pretending to do statistics. Quote Anthropic where
useful: *"In reality, 20–50 simple tasks drawn from real failures is a
great start."*

## What you MUST NOT do

- Skip reading the transcripts and just summarize what the PM said.
- Output a memo without task candidates.
- Pretend a small sample (3 transcripts) is statistically meaningful.
  Call it what it is: vibes. The whole point is that vibes are
  *useful at this stage*.
