---
name: pmstack-validate-judge
description: Measures whether an AI judge agrees with the reviewer's own labels before anyone trusts its numbers. Runs the judge on the tuning set, reads every disagreement by hand, fixes the prompt or the labels, runs the final test once, and estimates the likely true failure rate with a 95% range. Use after pmstack-write-judge, when a judge's agreement is unknown or out of date, or after a judge's prompt, model, or failure mode definition changes.
---

# Validate an AI judge

An AI judge is a prompt that asks a model to decide pass or fail for one failure mode. Validation compares its verdicts with the reviewer's labels until both agreement numbers clear the bar, then measures it once on traces it has never seen.

Two numbers, always reported together, always with counts:

- **Catches real failures**: of the traces the reviewer labeled as showing the failure mode, the share the judge also failed.
- **Agrees on good traces**: of the traces the reviewer labeled Good for this failure mode, the share the judge also passed.

Target: both above 90%. Minimum: both above 80%. Never summarize with overall accuracy or percent agreement: when 5 of every 100 traces fail, a judge that always says Pass is 95% accurate and catches nothing.

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

## Find the pmstack tool

`<skill-dir>` is this skill's base directory: the folder holding this SKILL.md, which your agent receives when it loads the skill. Run:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

It needs Node 20 or newer (`node --version`). If your shell forgets variables between commands, use the found path literally.

If no path is found, validate in the browser instead: point the user to https://ryanalberts.github.io/pmstack/studio/, open the judge in the Checks tab, and use "Copy the next 10 traces" with the paste box to run it through an AI assistant their company approves. The tab shows the same agreement numbers, the final test, and the likely true failure rate. Never install npm packages.

Below, `pmstack/project.json` is the project file inside the user's folder; `<check-id>` is the judge's id in `checks`.

## Guardrails

- Labels and verdicts come only from the reviewer. You read them, count them, and ask the reviewer to change them; you never write them.
- Prompt examples come only from the examples split. Tuning and final-test traces stay out of the prompt.
- The final test runs once per frozen prompt and model, after the reviewer agrees.
- The judge's model is an exact dated version, such as `claude-haiku-4-5-20251001`.
- While the studio runs (`pmstack/.studio.json` names a live process), change the project only through the studio or `pmstack` commands. Check with:

```sh
node -e 'try{process.kill(JSON.parse(require("fs").readFileSync("pmstack/.studio.json","utf8")).pid,0);console.log("studio running")}catch{console.log("studio not running")}'
```

## Phase 1: Check readiness

1. Run `node "$PMSTACK" validate pmstack/project.json`. Fix nothing yourself; report errors to the user.
2. Count labels and splits:

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [cli, projectPath, checkId] = process.argv.slice(1);
const lib = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cli)).href);
const p = JSON.parse(readFileSync(projectPath, "utf8"));
const check = p.checks.find((c) => c.id === checkId);
const labels = lib.labeledSet(p, check.modeId);
const problem = labels.filter((l) => l.label === "fail").length;
const assign = p.splits?.[check.modeId]?.assign ?? {};
console.log(JSON.stringify({
  mode: check.modeId, model: check.model, runMode: check.runMode,
  problem, good: labels.length - problem,
  splits: lib.splitCounts(p, check.modeId),
  examples: Object.keys(assign).filter((id) => assign[id] === "examples"),
}, null, 2));
' "$PMSTACK" pmstack/project.json <check-id>
```

3. Apply these rules:

| Finding | Action |
|---|---|
| No judge check, or no prompt | Run pmstack-write-judge first. |
| `model` empty or a floating alias ("latest", no date) | Ask the user for an exact dated version and set it in the Checks tab. |
| Fewer than 20 Problem or 20 Good labels | Stop. Ask the reviewer to label more in the Checks tab ("Label more traces for this failure mode"). |
| Under 60 labels in total | Continue, and tell the user the ranges will be wide. Aim for about 50 of each. |
| All splits at zero | Ask the reviewer to open the judge in the Checks tab once, which sets aside the splits (about 15% examples, 45% tuning, 40% final test, balanced per label). |

Phase 1 is done when the judge has a pinned model and at least 20 Problem and 20 Good labels split across examples, tuning, and final test.

## Phase 2: Run the judge on the tuning set

1. Tell the user how many model calls this makes (tuning traces, divided by 10 with `--batch 10`) and which command runs them. Each call costs money on their model account.
2. Run the judge in the same mode it will use later: keep `--batch 10` when the check's `runMode` is `batch`; drop it when judging one trace per call.

```sh
node "$PMSTACK" judge pmstack/project.json --check <check-id> --cmd "claude -p --model {model}" --split tuning --batch 10
```

`--cmd` is any command that reads the prompt on standard input and prints the model's reply; `{model}` becomes the check's pinned model. Add `--timeout 300` for slow models.

3. The command prints both agreement numbers and records a round. Reprint them any time without calling the model: `node "$PMSTACK" agreement pmstack/project.json --check <check-id> --split tuning`.

Phase 2 is done when every tuning trace has a judge result or is listed as unreadable.

## Phase 3: Read every disagreement by hand

Every trace in "Check missed these failures" and "Check flagged these good traces" gets read before anything changes. Print what you need for each:

```sh
node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const [checkId, ...ids] = process.argv.slice(2);
const c = p.checks.find((x) => x.id === checkId);
for (const id of ids) console.log(JSON.stringify({ id, judge: c.results?.[id], review: p.reviews?.[id], label: p.labels?.[c.modeId]?.[id], why: p.critiques?.[c.modeId]?.[id] }, null, 1));
' pmstack/project.json <check-id> <trace-id> <trace-id>
```

Read the trace itself too (its line in the traces file, or `#/review/<trace-id>` in the studio). Sort each disagreement into exactly one cause:

| Cause | Sign | Change |
|---|---|---|
| Judge misread the rule | Its critique applies a different test than the definition | Reword the prompt's Fail or Pass lines |
| Label looks wrong | The trace plainly does or does not show the failure mode | Ask the reviewer to look again; only tuning-split labels change |
| Judge could not see the deciding detail | The reviewer used a detail missing from "What the judge sees" (channel, customer type, a tool result) | Add that input in the Checks tab |
| Failure mode covers two problems | Disagreements split into two recognizable kinds | Propose splitting the failure mode; each part gets its own judge |
| Answer unreadable | Listed as "could not be read" | Check that `--cmd` prints only the reply; keep the JSON output instruction; raise `--timeout` |

Put each change where it belongs:

- Wording that only helps the judge goes in the prompt (Checks tab prompt box). With the studio stopped you may edit `checks[].prompt` in the project file instead: set `promptEdited: true`, add 1 to `revision`, update `updatedAt`, then rerun `validate`.
- Change the failure mode definition only when the reviewer's meaning changed. A definition edit sends every implied Good label for that failure mode back to Re-check, so the reviewer confirms them before the next round.
- Better examples come from the reviewer: a "Close call" mark or a one-line "Why?" on an examples-split trace. Any trace you paste into the prompt by hand must appear in the `examples` list from Phase 1.

Write each change in general terms ("a request for a callback counts as asking for a person"), never as a description of one tuning trace. Every tuned detail leaks the tuning set into the prompt.

Phase 3 is done when every disagreement has a cause and a change, or the reviewer has confirmed the judge was right.

## Phase 4: Repeat until the bar is met

Rerun Phase 2 after each set of changes. Each run adds a round to "Agreement by round" in the Checks tab.

| After a round | Next move |
|---|---|
| Both above 90% | Go to Phase 5. |
| Both above 80%, one or both under 90% | Show the user the remaining misses; go to Phase 5 if they accept. |
| Catches real failures low, the other fine | Spell out more failing cases under "Fail when"; ask for a clear failing example in the examples split. |
| Agrees on good traces low, the other fine | Say what does not count ("Pass when ... even if ..."); ask for a close-call example. |
| Both low | Try a more capable pinned model, or split the failure mode. |
| Wrong mostly on one kind of trace (calls, one product line) | Add an example of that kind and the detail that tells it apart. |
| No gain for two rounds in a row | Stop rewording. Pick a different remedy from this table, or propose a code check for the part a rule can decide. |

Phase 4 is done when both numbers clear the bar the user accepted, with the prompt and model now frozen.

## Phase 5: Run the final test once

1. Confirm with the reviewer: "The final test runs once. After it, changing the prompt or model means building a fresh final test from new labels."
2. Run it:

```sh
node "$PMSTACK" judge pmstack/project.json --check <check-id> --cmd "claude -p --model {model}" --split test --final --batch 10
node "$PMSTACK" agreement pmstack/project.json --check <check-id> --split test
```

3. Read the result:
   - Final-test numbers within about 10 points of tuning: the judge is validated. Report the final-test numbers as its quality.
   - Either number more than 10 points below tuning: the prompt fit the tuning set too closely. Return to Phase 3 with general fixes, and ask the reviewer to label at least 30 new traces so the studio can "Start a fresh final test". Never rerun the used final test and report it as new.
   - Fewer than 10 Problem traces in the final test: one miss moves the number by 10 points or more. Say so next to the numbers.

Phase 5 is done when the final-test numbers are recorded with their counts.

## Phase 6: Estimate the likely true failure rate

The judge misses some failures and flags some good traces. The estimate corrects its raw failure rate for both, using the final-test numbers, and gives a 95% range.

On the project's unlabeled traces:

```sh
node "$PMSTACK" judge pmstack/project.json --check <check-id> --cmd "claude -p --model {model}" --split unlabeled --batch 10
node "$PMSTACK" estimate pmstack/project.json --check <check-id>
```

That number describes the traces nobody labeled, which were often picked on purpose. For a number that describes production, run the judge on a fresh random sample of production traces instead:

```sh
node "$PMSTACK" judge pmstack/project.json --check <check-id> --cmd "claude -p --model {model}" --traces sample.jsonl --split unlabeled --batch 10
node "$PMSTACK" estimate pmstack/project.json --check <check-id> --traces sample.jsonl
```

If `estimate` refuses, it names the reason (no final test yet, or the judge or labels changed after it). Fix that reason; never work around it.

## Keep it validated

Validate again, starting at Phase 2 and ending with a fresh final test, after any change to the judge's prompt, model, inputs, or failure mode definition. The Checks tab marks the final test "Out of date" when that happens.

## Report to the user

End with a short summary:

```
Judge: <check name> for "<failure mode>" (model <exact version>)
Tuning, round <n>: catches real failures <x>% (<a> of <b>), agrees on good traces <y>% (<c> of <d>)
Final test: catches real failures <x>% (<a> of <b>), agrees on good traces <y>% (<c> of <d>)
Likely true failure rate on <population>: <z>% (95% range <low>% to <high>%)
Changes made: <one line each>
Next: <pmstack-regression-checks to keep it running, or what still blocks it>
```
