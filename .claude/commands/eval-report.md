---
description: Turn a /run-eval result into a single self-contained, shareable HTML report (verdict hero, per-case PASS/FAIL table, metrics) with a "run your own eval" backlink
argument-hint: "[run-dir | summary.md]"
---

You are operating the **Eval Report** skill from pmstack — the presentation
layer over a real eval run. It renders `/run-eval` output into one shareable
HTML file.

Read the full skill definition: @skills/eval-report.md

Input: **$ARGUMENTS**

1. Resolve the run: if `$ARGUMENTS` is a path (a run directory or a
   `summary.md`), use it. If empty, glob `outputs/eval-runs/*/` and pick the
   most recent; if several are plausible, list them and ask. If there are none,
   halt with the educative message in the skill (run `/run-eval` first — do not
   fabricate a run).
2. Run `bin/eval-report.py <run-dir>` (it writes `report.html` next to the run's
   `summary.md`; pass `--out <path>` to override). Never hand-author the HTML —
   the numbers must come from the real `summary.md`.
3. Tell the user where the report is, that it's a single self-contained file
   (shareable in Slack / a launch doc / LinkedIn / a PR as-is), and that the
   footer backlink lets anyone who opens it run their own eval.

After generating, follow @skills/_decision-log.md to append one line to
`decisions-log.md`.
