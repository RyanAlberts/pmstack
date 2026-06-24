# Skill: Eval Report (`/eval-report`)

## Trigger
`/eval-report [run-dir | summary.md]`

## Goal
Turn a `/run-eval` result into a **single, self-contained, shareable HTML
report** — the artifact a PM drops in a launch doc, a Slack thread, or a
stakeholder review. It carries a "run your own eval" backlink, so every place
it's shared is a quiet on-ramp back to pmstack.

`/run-eval` produces the numbers (`summary.md`, `cases/`, `metrics.csv`).
`/eval-report` makes those numbers *presentable and portable*: a verdict hero,
the per-case table with PASS/FAIL color-coding, and the metrics table — one
HTML file, inline CSS, no external assets, opens anywhere.

## What it is (and is not)

- It is the **presentation layer** over a real run. It renders what
  `/run-eval` already measured. It never invents or edits numbers.
- It is **filesystem / CLI** (like `/run-eval`): it shells out to
  `bin/eval-report.py`. On claude.ai with no filesystem, there's no run to
  render — run the eval where the runner lives, then report from there.

## Steps

1. **Resolve the run.** If the user passed a path, use it (a run directory or a
   `summary.md`). If not, glob `outputs/eval-runs/*/` and pick the most recent;
   if several are plausible, list them and ask. If there are none, educate (see
   below) — don't fabricate a run.
2. **Generate.** Run `bin/eval-report.py <run-dir>`. It writes `report.html`
   next to the run's `summary.md` (override with `--out <path>`). It prints the
   output path.
3. **Hand it back.** Tell the user where the report is and that it's a single
   self-contained file — shareable in Slack, a launch doc, LinkedIn, or a PR
   description as-is. Point out the footer backlink: anyone who opens the report
   can click through to run their own eval.
4. **Log it.** Append one line to `decisions-log.md` per `@skills/_decision-log.md`.

## Education-as-you-act: no run yet

If there's no `/run-eval` output to render, halt and educate:

*"`/eval-report` renders a real eval run into a shareable HTML page — so it
needs a run first. Run `/run-eval <your-eval.yaml>` to produce
`outputs/eval-runs/<...>/` (with `summary.md`), then `/eval-report` turns it
into a report you can paste anywhere. No eval yet? Start at `/eval <feature>`."*

## Hard rules

- NEVER generate a report for a run that doesn't exist, and never hand-write
  the HTML — always run `bin/eval-report.py` so the numbers come from the real
  `summary.md`. A report that doesn't match the run is worse than no report.
- ALWAYS keep the output self-contained (the generator does this — don't post-
  process external assets in). The whole point is one file a PM can paste.
- Don't alter the run's verdict or pass-rates to look better. The report's value
  is that it's the real result.

## Tone
Crisp, practical. This is the "make it shareable" step at the end of the eval
loop — get the PM a clean artifact and tell them exactly where it'll land well.

## What you MUST NOT do
- Invent a run or hand-author the HTML instead of running the generator.
- Strip or fake the backlink footer — it's the distribution surface.
- Present a report whose numbers don't match the source `summary.md`.
