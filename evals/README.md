# pmstack self-eval

> **The skill we sell is eval design.** If pmstack doesn't have evals for itself, you shouldn't trust the eval skill. This directory is the dogfood.

## What's here

- `pmstack-self.yaml` — the eval suite. Defines, per skill, what a "good" output looks like and the scoring rubric.
- `runner.py` — runs the suite against a target Claude model, scores each skill output, writes a JSON report.
- `golden/` — anchor outputs. The bar each skill must clear or exceed.
- `results/` — historical runs. One file per run: `YYYY-MM-DD-HHMM_<model>.json`.

## How to run

```bash
# One-shot run against the default model
python evals/runner.py

# Pin model + budget
python evals/runner.py --model claude-sonnet-4-6 --max-budget-usd 5

# Run a single skill
python evals/runner.py --skill eval

# Compare against the previous run
python evals/runner.py --compare-to evals/results/<previous>.json
```

Requires `claude` CLI on PATH and a Claude Code session logged in.

## Pass / fail policy

| Severity | Bar |
|---|---|
| **P0 structural** | YAML parses, sections all present, file written to `outputs/`. Any P0 fail blocks release. |
| **P1 quality** | Rubric score ≥ 4/5 from a Sonnet judge on at least 80% of cases. |
| **P2 trends** | Tracked in `results/` for drift detection. No release gate. |

## Why this matters

The biggest gap in AI product work isn't building the feature. It's knowing whether the feature still works after the next model upgrade, prompt tweak, or skill edit. Without an eval suite, every change is a vibe check.

pmstack v0.2 had no way to answer "does the `/prd` skill still produce useful PRDs?" except by reading them. v0.3 makes that question scriptable.
