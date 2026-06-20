# Skill: Eval Grade (`/eval-grade`)

## Trigger
`/eval-grade [path-to-eval | pasted eval | feature]`

## Goal
Grade an **existing** eval against Anthropic's eval-design roadmap and hand the
PM back an **Eval Report Card** — a letter grade, the failures that earned it
(with the offending line), the one fix that matters most, and a shareable
verdict card.

This is the **inverse of `/eval`**. `/eval` *produces* a suite that meets
Anthropic's [eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents);
`/eval-grade` *checks whether a suite you already have meets that same bar.*
It is the meta-eval: most PMs can write an eval; far fewer can tell whether
their eval is any good. That judgment — not the writing — is the scarce skill,
and it is the one engineers gatekeep.

## Vocabulary you use (define inline the first time)

These are Anthropic's terms (same canon as `/eval`). Define each on first use.

| Term | One-line definition |
|---|---|
| **grader** | Logic that scores output: **code** (deterministic), **model** (LLM-as-judge), **human** (SME). |
| **grader leakage** | The reference answer is visible inside the grader's own prompt, so the judge "passes" by copying, not by judging. The most common silent eval bug. |
| **negative case** | A task where the behavior should NOT occur (`negative_case: true`). Without these, you optimize one direction only. |
| **calibration** | Checking an LLM-as-judge against human labels before trusting it. An uncalibrated judge defaults to rating everything "good." |
| **pass^k** | Probability the agent is right on *every* one of k trials — the bar for customer-facing consistency. |
| **target** | The system the suite actually runs against. No `target:` block → the eval can't run, it's a wish list. |

## Education-as-you-act: handling missing input

Never grade something you can't see. If `$ARGUMENTS` names no eval and none is
pasted or attached, halt with an *educative* message:

*"`/eval-grade` grades an eval you already have — paste it, attach it, or point
me at a file (`outputs/eval-*.yaml`, or a rubric / success-metric in plain
text). It reads the suite and grades it A–F against Anthropic's eval-design
principles: are tasks sourced from real failures, are they unambiguous, are the
problem sets balanced, is there a target, are the graders chosen right, is the
answer leaking into the judge? If you don't have an eval yet, run `/eval
<feature>` first — then bring it back here for a grade."*

Then ask which form they'll provide.

## Input — three modes

**Mode A: a file path (CLI / filesystem).**
`/eval-grade outputs/eval-checkout-bot-2026-06-20.yaml`
If no path is given, glob `outputs/eval-*.yaml` and `examples/**/eval-*.yaml`;
if exactly one exists, grade it and say which. If several, list them and ask.

**Mode B: pasted or attached eval.** A full YAML suite pasted in chat or
attached as a file. Detect structure (YAML, or a loose rubric).

**Mode C: a plain-English rubric / success metric.** Not a full suite — e.g.
"we check the summary is accurate and the tone is friendly." Grade what is
gradeable, and grade the *absence* of structure as the finding it is (no tasks,
no target, no measurable bar). This is the most common real-world input and the
most useful to grade — most PMs are at exactly this stage.

## The rubric — eight dimensions, graded against Anthropic's canon

Grade each dimension **Pass / Partial / Fail**, and for every Partial or Fail
quote the **specific offending line or absence** (evidence, never vibes).

1. **Sourced from real failures (Step 1).** Do tasks trace to real bugs /
   tickets / dogfooding, or are they abstract inventions? *Fail tell:* generic
   tasks with no failure provenance.
2. **Unambiguous tasks + reference solutions (Step 2).** Would two experts reach
   the same pass/fail verdict? Do P0 capability tasks carry a `reference_solution`?
   *Fail tell:* `expected_behavior` like "responds well."
3. **Balanced problem sets (Step 3).** For each "should-do-X" behavior, is there a
   `negative_case: true`? *Fail tell:* zero negative cases — a one-sided eval.
4. **Target specified (Step 4).** Is there a `target:` block the suite can run
   against? *Fail tell:* no target — the eval is theoretical.
5. **Grader choice (Step 5).** Does each metric's `grader_type` fit the metric —
   `code` for verifiable, `model` for judgment, `human` for expert-only? *Fail
   tell:* an LLM-judge scoring something a string-match or regex should own.
6. **Measurable bar.** Every metric has a concrete `pass_bar`; the suite names a
   `success_metric` (pass@k / pass^k) and a `purpose` (capability / regression).
   *Fail tell:* "looks good" with no number.
7. **Grader leakage.** Does the reference answer appear inside a model-grader's
   prompt? Read each model grader and check whether it embeds the expected
   output. *Fail tell:* the judge is handed the answer it's supposed to find.
8. **Judge calibration.** If any grader is `model` (LLM-as-judge), is there a
   plan to calibrate it against human labels? *Fail tell:* model graders trusted
   at scale with no calibration step — they drift toward rating everything good.

### From dimensions to a letter

Start from the count of Pass (2) / Partial (1) / Fail (0) across the eight
dimensions (max 16), then apply the **disqualifiers** — some failures cap the
grade no matter how clean the rest is, because they make the eval unrunnable or
self-deceiving:

- No `target:` block → **cap at D** (it cannot run).
- Zero negative cases when ≥1 "should-do-X" behavior exists → **cap at C**.
- Grader leakage found → **cap at C** (the score is fiction).
- Fewer than 5 tasks → **cap at C** (note Step 0's "small is fine," but this is
  below a usable floor).

Band the (capped) score: **A** 15–16 · **B** 12–14 · **C** 9–11 · **D** 6–8 ·
**F** ≤5. State the grade with confidence, not a hedge.

## Output: the Eval Report Card

Write to `outputs/eval-grade-<slug>-<YYYY-MM-DD>.md` (CLI/filesystem) or emit
inline (claude.ai). `<slug>` is a kebab-case of the eval/feature name.

```markdown
# Eval Report Card: <Feature / suite name>

**Date:** <today>  ·  **Graded against:** Anthropic eval framework, Steps 0–5
**Source:** <path / pasted / rubric>  ·  **Grade: <A–F>**

> <one-line verdict — the so-what, e.g. "Solid task coverage, but two model
> graders leak the answer, so the pass-rate is meaningless until you fix them.">

## Scorecard
| # | Dimension | Grade | Finding (with offending line) |
|---|---|---|---|
| 1 | Sourced from real failures | Pass/Partial/Fail | ... |
| 2 | Unambiguous + reference solutions | ... | ... |
| 3 | Balanced problem sets | ... | ... |
| 4 | Target specified | ... | ... |
| 5 | Grader choice | ... | ... |
| 6 | Measurable bar | ... | ... |
| 7 | Grader leakage | ... | ... |
| 8 | Judge calibration | ... | ... |

## The three failures that cost you most
1. **<named failure>** — <offending line/quote>. **Fix:** <concrete change>.
2. ...
3. ...

## Fix this first
<the single highest-leverage change — the one that moves the grade most.>

## Shareable verdict card
```
📊 Eval Report Card — <feature>  ·  graded by pmstack /eval-grade
Grade: <A–F>
✓ Strong: <one true strength>
✗ Weak:   <the headline failure, in plain words>
✗ Missing:<the most important absence>
Fix first: <one line>
→ grade your own eval: github.com/RyanAlberts/pmstack
```
```

After writing, follow `@skills/_decision-log.md` to append one line to
`decisions-log.md`.

## Hard rules

- ALWAYS produce a letter grade and the shareable verdict card. The card is the
  point — it's what a PM screenshots and what teaches the next PM the standard.
- ALWAYS cite the offending line for every Partial/Fail. A grade without
  evidence is exactly the "vibes-as-metric" failure this skill exists to catch.
- ALWAYS grade against the Anthropic step, naming it (Step 1–5), so the PM can
  go fix the real thing. This skill teaches the standard while applying it.
- NEVER fabricate an eval to grade, and NEVER invent failures that aren't in the
  text. If the suite is genuinely good, give it an A and say why.
- Grade the eval's **design**, not the underlying product. A great eval for a
  mediocre feature still earns a great grade.

## Tone
Rigorous, direct, professional — a senior reviewer handing back a graded
artifact. No hedge words; state the grade and defend it with the evidence. Not a
roast: the verdict is sharp because it's specific, not because it's mean.

## What you MUST NOT do
- Output a grade with no offending-line evidence behind it.
- Skip the shareable verdict card (it's the distribution surface).
- Grade against your own invented criteria instead of Anthropic's Steps 0–5.
- Soften a real Fail into a Partial to be nice — the PM ships on this judgment.
