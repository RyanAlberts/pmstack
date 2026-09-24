---
name: pmstack-regression-checks
description: Keeps known failures from coming back and keeps watching for new ones. Builds a regression set from a pmstack project, replays it through the product on every code change and runs code checks with pmstack check, samples production traces for a validated judge's likely true failure rate, and schedules fresh error discovery after big changes. Includes a GitHub Actions example. Use when a failure mode is fixed or has a check, when adding AI checks to a build pipeline, or when monitoring AI quality in production.
---

# Run checks on every change

Three loops, each with its own job:

| Loop | When | Data | Catches | On failure |
|---|---|---|---|---|
| Regression checks | Every code change | The regression set, replayed | Known failures coming back | Block the change |
| Production sampling | Daily or weekly | A random sample of real traces | A failure mode growing | Alert the team |
| Fresh error discovery | After big changes, every 2 to 4 weeks | About 100 new traces | Failure modes nobody has named yet | New failure modes and checks |

A passing build means no known failure came back. It says nothing about overall quality or about new failures; only fresh error discovery finds those.

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

## Find the pmstack tool

`<skill-dir>` is this skill's base directory: the folder holding this SKILL.md, which your agent receives when it loads the skill. Run:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

It needs Node 20 or newer. If your shell forgets variables between commands, use the found path literally. If no path is found, the Report tab at https://ryanalberts.github.io/pmstack/studio/ downloads the regression set and the checks file; the build then fetches the tool itself (Phase 4). Never install npm packages.

Below, `pmstack/project.json` is the project file and `evals/` is a folder in the product's repository.

## Phase 1: Build the regression set

1. When a failure mode has been fixed, the reviewer marks it with "Mark fixed" in the Funnel tab. A bug reported outside the project (a support ticket, an incident) first becomes a trace in it: `node "$PMSTACK" import ticket-trace.jsonl --out pmstack/project.json --append`, then the reviewer marks it Problem with its failure mode. Every fixed bug gets at least one regression trace this way.
2. Export the set:

```sh
node "$PMSTACK" regression-set pmstack/project.json --out evals/regression.jsonl
```

It holds the failing traces of failure modes marked "Fix it now", "Build a check", or fixed, plus passing traces that show success modes. Each line is the original trace plus `expected` (the verdict each failure mode should get) and `replay` (the conversation up to the customer's turn before the first failure, or the original input).

3. The file quotes real traces. Remove names, phone numbers, emails, and account details before it enters a shared repository, keeping each trace's `id`, `expected`, and the wording that triggers the failure.

Phase 1 is done when `evals/regression.jsonl` exists, has a line for every fixed bug, and holds no personal details.

## Phase 2: Export the checks the build runs

Download "Checks for your build (.json)" from the Report tab, or write it from the project:

```sh
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [cli, projectPath, out] = process.argv.slice(1);
const { ciChecks } = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cli)).href);
writeFileSync(out, JSON.stringify(ciChecks(JSON.parse(readFileSync(projectPath, "utf8"))), null, 2) + "\n");
' "$PMSTACK" pmstack/project.json evals/checks.json
```

It contains the code checks marked "Run on every change". Commit `evals/checks.json` and `evals/regression.jsonl`; keep `project.json` (notes, full traces) out of the product repository.

A regression trace only protects anything when some check can see its failure on a fresh trace. List the gaps:

```sh
node -e '
const fs = require("fs");
const covered = new Set(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).checks.map((c) => c.modeId));
const modes = new Set();
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n"))
  if (line.trim()) for (const m of Object.keys(JSON.parse(line).expected?.modes ?? {})) modes.add(m);
for (const m of modes) console.log(covered.has(m) ? "code check    " : "no code check ", m);
' evals/checks.json evals/regression.jsonl
```

For each "no code check" line: build a code check if a rule can decide it (Checks tab, then turn on "Run on every change" and export again). If only an AI judge can decide it, run that judge on the replayed traces in a nightly job instead of on every change (Phase 4).

Phase 2 is done when every failure mode in the regression set has a code check in `evals/checks.json` or a nightly judge.

## Phase 3: Write the replay script

Write a replay script inside the product's repository, in the product's own language (the build example below calls it `evals/replay.mjs`). It takes the regression set path and an output path. For each line of the regression set:

1. Send `replay.messages` (or `replay.input`) through the product's real entry point: the same instructions, model, and tools as production.
2. Point every tool that changes something (bookings, emails, payments) at a test account or a sandbox. Never replay against live systems.
3. Record the new trace in the pmstack trace format with the same `id`, including tool calls and their results, since checks can test tool use.
4. Write one JSON line per trace to the output file.

Run it locally, then check:

```sh
node evals/replay.mjs evals/regression.jsonl fresh.jsonl
node "$PMSTACK" check evals/checks.json --traces fresh.jsonl --expect evals/regression.jsonl
```

Exit code 0: no known failure came back. 1: a trace failed a check for a failure mode expected to pass, or a fixed failure returned. 2: a check or input error; read the message. The output ends with a line like "58 of 80 traces pass every check".

Replies vary from run to run. For a failure mode that blocks the customer, replay 3 times into 3 files and check each; the change fails if any run fails. For a larger set of everyday traces where a few failures are expected, gate with `--max-fail <n>` or `--max-fail-rate <0-1>` instead of `--expect`.

Phase 3 is done when a local run of the replay and the check exits 0 on the current product.

## Phase 4: Add it to the build

`.github/workflows/pmstack-regression.yml`:

```yaml
name: Regression checks
on:
  pull_request:
  push:
    branches: [main]

jobs:
  regression:
    runs-on: ubuntu-latest
    env:
      PMSTACK_REF: v2.0.0 # pin a pmstack release tag
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Get the pmstack command-line tool
        run: git clone --depth 1 --branch "$PMSTACK_REF" https://github.com/RyanAlberts/pmstack.git "$RUNNER_TEMP/pmstack"
      - name: Replay the regression set through the product
        run: node evals/replay.mjs evals/regression.jsonl "$RUNNER_TEMP/fresh.jsonl"
        env:
          MODEL_API_KEY: ${{ secrets.MODEL_API_KEY }}
      - name: Check that no known failure came back
        run: >-
          node "$RUNNER_TEMP/pmstack/bin/pmstack.mjs" check evals/checks.json
          --traces "$RUNNER_TEMP/fresh.jsonl"
          --expect evals/regression.jsonl
```

Adjust the replay step to the product's language, and add the product's own install step before it. The replay calls the model, so every run costs money: keep the set to the traces that matter (tens to a few hundred). Pull requests from forks get no secrets; skip the job for them or run it after merge.

For failure modes only a judge can decide, add a scheduled job (`on: schedule`) that replays the set and runs `pmstack judge` with `--traces` on the fresh file, then reads which replayed traces the judge failed. Run it against a temporary copy of `project.json`: replayed traces reuse the project's trace ids, and judge results are stored by id.

Phase 4 is done when the workflow runs on a pull request and passes.

## Phase 5: Sample production

Use only judges that passed pmstack-validate-judge with a current final test; `estimate` refuses otherwise.

1. Ask the PM for a limit per failure mode: the highest failure rate they accept (for example "no more than 3% of patients asking for a person get ignored").
2. On a schedule, take a random sample of production traces (course notes suggest 1 to 5% of traffic) and write it as `sample.jsonl`. Keep it random; a sample of flagged or complained-about traces describes those traces only.
3. Judge it and estimate:

```sh
node "$PMSTACK" judge pmstack/project.json --check <check-id> --cmd "claude -p --model {model}" --traces sample.jsonl --split unlabeled --batch 10
node "$PMSTACK" estimate pmstack/project.json --check <check-id> --traces sample.jsonl
```

4. Alert when the high end of the 95% range crosses the limit. That is the early warning: the true rate may already be above it. Then read the flagged traces.

Phase 5 is done when each validated judge has a limit, a schedule, and an alert.

## Phase 6: Run fresh error discovery

After a model switch, a prompt rewrite, a new feature, or an incident, and every 2 to 4 weeks otherwise, add about 100 fresh traces as a new version and review them:

```sh
node "$PMSTACK" import new-traces.jsonl --out pmstack/project.json --append --version "Version 3"
```

Then run pmstack-error-discovery on them. The Funnel and Report tabs compare versions. New failure modes get checks, new fixed bugs join the regression set, and Phases 1 and 2 run again.

## Checks that block a reply

A check in the request path stops a reply before the customer sees it, so every false alarm blocks a good reply. Use only fast code checks there, and only ones whose "Agrees on good traces" on labeled traces is at or near 100%. Log every time one fires. AI judges run after the reply, in Phases 4 and 5.

## Report to the user

```
Regression set: <n> traces covering <m> failure modes (<k> fixed bugs)
Build: <workflow path>, <passing | failing: which traces>
Not covered by a code check: <failure modes, and their nightly judge>
Production sampling: <judge, limit, schedule> or <not set up: reason>
Next fresh error discovery: <date or trigger>
```
