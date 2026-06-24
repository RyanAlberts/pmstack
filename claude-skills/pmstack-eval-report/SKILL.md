---
name: pmstack-eval-report
description: Turns a /run-eval result into a single self-contained, shareable HTML report — a verdict hero (pass/conditional/fail), the per-case table with PASS/FAIL color-coding, and the metrics table — that a PM can paste into Slack, a launch doc, LinkedIn, or a PR. The report carries a "run your own eval" backlink to pmstack. Use when the user says "make this eval shareable," "turn my eval run into a report," "export the eval results," "an HTML report of my eval," "share my eval results," or has a /run-eval output directory and wants a presentable artifact. Renders real run data only (from summary.md) — never invents numbers. Runs bin/eval-report.py on a run directory. Output: report.html next to the run's summary.md.
---

# pmstack /eval-report — make your eval run shareable

You turn a `/run-eval` result into **one self-contained HTML file** a PM can
paste anywhere. `/run-eval` produces the numbers (`summary.md`, `cases/`,
`metrics.csv`); `/eval-report` makes them presentable and portable: a verdict
hero, the per-case PASS/FAIL table, and the metrics table — inline CSS, no
external assets, opens in any browser. The footer backlinks to pmstack, so every
share is a quiet on-ramp.

## What it is (and is not)

- The **presentation layer** over a real run. It renders what `/run-eval`
  already measured. It never invents, edits, or improves the numbers.
- **Filesystem / CLI**, like `/run-eval`: it runs `bin/eval-report.py`. With no
  filesystem (claude.ai), there's no run to render — run the eval where the
  runner lives, then report from there.

## Steps

1. **Resolve the run.** If the user gave a path (a run directory or a
   `summary.md`), use it. Otherwise glob `outputs/eval-runs/*/` and take the most
   recent; if several are plausible, list them and ask. If there are none,
   educate (below) — never fabricate a run.
2. **Generate.** Run `bin/eval-report.py <run-dir>`. It writes `report.html` next
   to the run's `summary.md` (override with `--out <path>`) and prints the path.
   Never hand-author the HTML — the numbers must come from the real `summary.md`.
3. **Hand it back.** Say where it is and that it's a single self-contained file —
   shareable in Slack, a launch doc, LinkedIn, or a PR as-is. Point out the
   footer backlink: whoever opens it can click through to run their own eval.

## No run yet

*"`/eval-report` renders a real eval run into a shareable HTML page — so it needs
a run first. Run `/run-eval <your-eval.yaml>` to produce
`outputs/eval-runs/<...>/`, then `/eval-report` turns it into a report you can
paste anywhere. No eval yet? Start at `/eval <feature>`."*

## Hard rules

- NEVER generate a report for a run that doesn't exist, and never hand-write the
  HTML — always run `bin/eval-report.py` so the numbers come from the real run.
- ALWAYS keep the output self-contained — that's what makes it one-file-shareable.
- Never alter the verdict or pass-rates to look better. The report's value is
  that it's the real result.

## Tone
Crisp, practical — the "make it shareable" step at the end of the eval loop. Get
the PM a clean artifact and tell them exactly where it lands well.
