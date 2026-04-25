# /run-eval — Setup Guide for PMs

> If you've never run an eval before, read this once. Then come back as a reference.

## What is an eval, in plain English?

An eval is a way to check whether an AI feature actually does what you think it does — at scale, repeatably, before customers find out it doesn't.

You give it:
- A list of **inputs** (things a real user might say)
- An **expected behavior** (what should happen)
- **Metrics** with pass/fail bars (how to grade what actually happened)
- A **target system** (the AI feature being evaluated)

The runner sends each input to the target, captures what comes back, scores it, and tells you what passed and what failed.

## The procedure (read once, then refer back)

```
   ┌──────────────┐    ┌────────────────┐    ┌─────────────────┐    ┌──────────────┐
   │  /eval         │───▶│  eval YAML     │───▶│  /run-eval     │───▶│   summary.md  │
   │  (designs)     │    │  (you keep     │    │  (executes)     │    │   metrics.csv │
   │                │    │   this file)   │    │                 │    │   cases/*.json│
   └──────────────┘    └────────────────┘    └─────────────────┘    └──────────────┘
                                                       │
                                                target invoked
                                                ONCE per case
```

You design once with `/eval`. You execute as many times as you want with `/run-eval`. The eval YAML is the contract.

## What you need before your first run

### 1. An eval YAML

Produce one with:
```
/eval <feature you want to test>
```

This writes to `outputs/eval-<feature-slug>-<date>.yaml`. **Open that file once and read the top — there's a header that tells you exactly how to run it.**

### 2. A target

The target is the system you're evaluating. Three types are supported:

| type            | what it is                                       | when to use                          |
|-----------------|--------------------------------------------------|--------------------------------------|
| `claude-session` | invokes Claude with the prompt                   | evaluating a Claude-based capability |
| `http`           | POSTs to a JSON endpoint                         | evaluating an external API           |
| `script`         | pipes input to a local CLI                       | evaluating anything else, locally    |

The eval YAML has a `target:` section near the top. If you got the YAML from `/eval`, it'll have a sensible default. Edit it if needed — the default is rarely perfect.

### 3. Whatever the target needs

- For `http`: an API key, set as an env var. The YAML's `target.requires` lists which env vars must be set. **Never paste secrets into the YAML itself.**
- For `script`: a runnable, executable file (`chmod +x`).
- For `claude-session`: nothing extra — your existing Claude Code session credentials work.

## Your first run, step by step

```bash
# 1. Read the YAML you generated. Edit target if needed.
cat outputs/eval-customer-chatbot-2026-04-24.yaml

# 2. Dry-run. This validates the target and shows you what the run will cost.
/run-eval outputs/eval-customer-chatbot-2026-04-24.yaml --dry-run

# 3. Run a single case to verify the loop works.
/run-eval outputs/eval-customer-chatbot-2026-04-24.yaml --only test-case-1

# 4. If that case looks right, run the full thing.
/run-eval outputs/eval-customer-chatbot-2026-04-24.yaml
```

The runner asks you to confirm before spending tokens. Default is NO — you have to explicitly say `y`.

## What the output looks like

```
outputs/eval-runs/<feature-slug>-<run-date>/
├── summary.md       ← read this first. headline + metrics table.
├── cases/
│   ├── test-case-1.json    ← per-case input, output, score, evidence
│   ├── test-case-2.json
│   └── ...
└── metrics.csv      ← one row per metric. paste into Sheets if you want.
```

`summary.md` has a metrics table that looks like:

| case          | severity | passed | metrics                                |
|---------------|----------|--------|----------------------------------------|
| test-case-1   | P0       | PASS   | accuracy=true; relevance=5             |
| test-case-2   | P0       | FAIL   | accuracy=false; relevance=2            |

**Read it like this:**
- **P0 fails** = release blockers. Fix or formally accept-with-justification.
- **P1 fails** = open issues. Track in your bug tracker.
- **P2 fails** = trends. No immediate action; watch over time.

## Cost / token control

The runner does NOT translate cost into dollars. It uses tokens and API calls because:
- Token counts are reproducible across model price changes
- You can compare runs over time without re-doing math
- Real-world cost depends on which model + which provider + your contract

Before a run:
- The runner prints an **estimate** like `~120,000 tokens, ~30 API calls`
- If you want a hard cap, pass `--max-tokens 100000`
- If the cap is hit, the runner **stops cleanly**, writes a partial summary, and tells you exactly how many cases ran

## Anti-hallucination guarantees

The runner is built to NEVER fake results. Three things to know:

1. **No target = hard stop.** If the YAML doesn't have a `target:` section, the runner refuses to run.
2. **Unreachable target = hard stop.** If the URL is down or the script is missing, hard stop.
3. **Subjective metrics need a judge.** Things like "is this response relevant?" can't be scored deterministically. The runner records `method: needs-judge` and leaves the score empty unless you pass `--judge-model`. **Empty is honest. Don't accept "passed" when the runner couldn't evaluate it.**

If you see `dry_run: true` in any case's evidence, that case was NOT actually executed. That's a setup bug — fix the target and re-run.

## Troubleshooting

| Error                                                   | What to do                                                        |
|---------------------------------------------------------|-------------------------------------------------------------------|
| `FATAL: this eval has no target: section`               | The YAML is from an older `/eval` template. Add `target:` per `templates/eval-template.yaml` |
| `FATAL: target.type=http requires env var FOO_API_KEY`  | `export FOO_API_KEY=...` before running                           |
| `FATAL: target.type=script requires target.path`        | Path doesn't exist or isn't executable. `chmod +x ./scripts/foo.sh` |
| All cases run but `case_passed: null`                   | Subjective metrics need a judge. Re-run with `--judge-model claude-sonnet-4-6` |
| Token cap hit after 5 cases                             | Either widen the cap or split into multiple runs with `--only`     |
| Result feels wrong vs. manual sanity-check              | Open `cases/<id>.json`, look at `output` and `evidence`. Compare to what you got by hand. The runner is reporting facts. |

## Pro tips

- **Run one case first.** Catch setup bugs in 30 seconds, not 30 minutes.
- **Save secrets in env vars, not the YAML.** `target.requires` exists for this reason.
- **Don't tune tests to make real bugs pass.** If a P0 case fails because the target is broken, fix the target — not the test.
- **Variance is data.** If the same case passes 8/10 times, that's a "flaky" signal — record it, don't bury it.
- **Re-running an eval costs tokens every time.** Use `--dry-run` and `--only` aggressively while iterating.

## When to use a judge model

A judge model is a *second* AI that scores subjective quality. Use one when your eval has metrics like:
- "Is the response on-topic?" (yes/no)
- "Does it match the brand voice?" (1-5)
- "Is it factually accurate given this expected behavior?" (yes/no)

Default judge is Claude Sonnet (`--judge-model claude-sonnet-4-6`) — it's a different family than the most common targets (Haiku/Opus), so it gives independent grades.

**The judge is also an AI** — it can be wrong. Spot-check 2-3 cases by hand on every run.

## When NOT to use this command

- For one-off "does it work?" sanity checks — just talk to the AI directly.
- For load testing — this is correctness, not performance.
- For evaluating non-AI features — overkill. Use unit tests.
