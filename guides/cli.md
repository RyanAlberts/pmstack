# Command line

`bin/pmstack.mjs` runs Eval Studio on your computer and does everything the studio does to a project file: import traces, run checks, run AI judges with your own model, measure agreement, and write the report. It needs Node 20 or newer and nothing else: no install step, no packages.

```sh
node bin/pmstack.mjs --help              # every command
node bin/pmstack.mjs <command> --help    # one command's options
```

Most examples run as written from the pmstack folder right after you clone it. They use the quickstart folder (`examples/quickstart/`, 24 dental booking traces) and the sample projects in `docs/studio/samples/`, and examples that change a file work on a copy. Where an example names `pmstack/project.json` or a file like `week-2.jsonl`, put in your own file.

## Exit codes

| Code | Means |
|---|---|
| 0 | All good. |
| 1 | Checks failed or a limit was crossed: traces failed a check, a policy was broken, a judge could not answer some traces, or a project file has problems. |
| 2 | A problem with the command or its files: a missing file, a wrong option, a check that cannot run. The message says what to fix. |

Builds can stop on exit code 1 and treat 2 as a broken setup.

## Project files and folders

A project is one JSON file (format `pmstack.project/1`): your product setup, reviews, failure modes, labels, and checks. In a trace folder it lives at `pmstack/project.json`, and the traces stay in your own file beside it. Any command that takes `<project.json>` also accepts a downloaded project or a sample, which carry their traces inside.

```
my-traces/
  traces.jsonl
  pmstack/project.json        your reviews, failure modes, and checks
  pmstack/suggestions.json    AI suggestions waiting for the reviewer (from Claude Code)
  pmstack/renderers/          custom views, if any
```

Every write goes through a lock file and bumps the project's revision number, so the studio, Claude Code, and these commands can work on one folder at the same time without losing each other's changes.

## studio

Open Eval Studio on a folder of traces. Reviews save to the folder.

```sh
node bin/pmstack.mjs studio examples/quickstart --open
```

| Option | Does |
|---|---|
| `[folder]` | The trace folder. Default: the current folder. |
| `--port <n>` | The port (default 4173). `--port 0` picks a free one. |
| `--traces <file>` | The trace file to use the first time. Without it, pmstack uses `traces.jsonl`, or the only `.jsonl`, `.json`, or `.csv` file in the folder. |
| `--open` | Open the studio in your browser. |

The first run guesses how your product looks (the view, how your AI works, the stages, the filters), writes `pmstack/project.json`, and picks a first set of 20 traces. Review traces shows "We guessed your setup" until you confirm or change it in Set up. It prints the address on one line, `Eval Studio: http://127.0.0.1:4173/`, and runs until you press Ctrl+C.

The studio listens on 127.0.0.1 only and refuses requests from other sites, so your traces never leave your computer. A second studio on the same folder is refused.

## import

Make a project file from a trace file, without opening the studio.

```sh
node bin/pmstack.mjs import examples/quickstart/traces.jsonl --out quickstart.json
```

| Option | Does |
|---|---|
| `--out <file>` | Where to write the project. Default: `pmstack/project.json` next to the trace file, where `studio` looks for it. |
| `--view <id>` | How a trace looks: `chat`, `email`, `document`, `answer`, `agent`, `code-review`, `fields`, `list`, `layout`, `auto`, or `custom:<id>`. |
| `--pattern <id>` | How your AI works: `single`, `augmented`, `chain`, `routing`, `parallel`, `orchestrator`, `evaluator`, `agent`. |
| `--name "..."` | The product name. Default: the folder name. |
| `--append` | Add the traces to an existing project. Traces whose id is already there are skipped. |
| `--version "..."` | With `--append`: tag the new traces with a version name, to compare before and after. The first time, earlier traces are tagged "Version 1", and version becomes a filter. |

Without `--view` and `--pattern`, pmstack guesses both. To add a new week of traces as a new version:

```sh
node bin/pmstack.mjs import week-2.jsonl --append --version "Version 2" --out quickstart.json
```

## validate

Look for problems in a project file: reviews or labels that point to traces that don't exist, unknown stages, checks for missing failure modes, patterns that can't be read.

```sh
node bin/pmstack.mjs validate docs/studio/samples/clinic-booking.json
```

Exits 0 when the file is fine, 1 when it has problems (each listed in a plain sentence), and 2 when it can't be read.

## check

Run the code checks (rules a computer can test, including tool policies, intent maps, and the grounding checks) on every trace.

```sh
node bin/pmstack.mjs check docs/studio/samples/clinic-booking.json
```

It prints a table of each check with its failures, the traces that failed, and a closing line such as "146 of 170 traces pass every check".

| Option | Does |
|---|---|
| `--traces <file>` | The traces to check. Needed with a checks file; with a project, it replaces the project's traces. |
| `--only-ci` | Run only the checks marked "Run on every change". |
| `--expect <file>` | A regression set from `regression-set`. Fails only when a trace that must pass a check now fails it, such as a fixed failure coming back. |
| `--max-fail <n>` | Allow up to n failing traces. |
| `--max-fail-rate <0-1>` | Allow up to this share of failing traces, for example `0.05`. |

Without `--expect` or a limit, any failing trace exits 1. A check that can't run (a broken pattern, an invalid policy) exits 2. In a build, the usual run is a checks file, fresh traces from the new version, and the regression set:

```sh
node bin/pmstack.mjs check checks.json --traces fresh.jsonl --expect regression.jsonl
```

[Checks and AI judges](checks-and-judges.md#run-checks-on-every-change) covers the whole setup.

## judge

Run an AI judge on traces with your own model command.

```sh
cp docs/studio/samples/clinic-booking.json clinic.json
node bin/pmstack.mjs judge clinic.json --check ck-person-judge --cmd "claude -p --model {model}" --limit 10
```

pmstack builds each trace's prompt, starts your command directly (no shell), sends the prompt on its standard input, and reads Pass or Fail from what the command prints. `{model}` becomes the judge's pinned model. Results save to the project every 10 traces and when you press Ctrl+C, so Eval Studio shows them as they arrive, and it prints the judge's agreement with your labels at the end.

| Option | Does |
|---|---|
| `--check <id>` | The judge to run. |
| `--cmd "<command>"` | The model command. Any command that reads a prompt and prints an answer works. |
| `--split <name>` | Which traces: `tuning` (default), `test`, or `unlabeled`. |
| `--final` | Needed with `--split test`. The final test is used once, and running it reveals the results. |
| `--batch <n>` | Judge up to n traces per call, 1 to 10 (default 1). |
| `--concurrency <n>` | Calls at the same time (default 4). |
| `--limit <n>` | Judge at most n traces. |
| `--timeout <seconds>` | Give up on a call after this long (default 120). |
| `--traces <file>` | Judge traces from another file, such as a fresh production sample. Works with `--split unlabeled`. |

Traces in the examples set are never judged: the judge already saw them in its prompt. A call that fails, times out, or prints something pmstack can't read saves nothing for that trace and counts as an error. Exits 1 when some traces could not be judged, and 2 when none could.

## agreement

How often a check agrees with your labels.

```sh
node bin/pmstack.mjs agreement docs/studio/samples/clinic-booking.json --check ck-person-judge
```

```
Hands off when asked for a person (AI judge) for "Ignores requests for a person", on 44 labeled traces in the tuning set.
Catches real failures     89%   (8 of 9)
Agrees on good traces     94%   (33 of 35)
Check missed these failures: t-0141
Check flagged these good traces: t-0137, t-0139
```

Code checks use every labeled trace. AI judges use the tuning set, or the final test with `--split test` once it has been revealed.

## estimate

The likely true failure rate on traces you haven't labeled: what the judge flagged, corrected for the mistakes it made on your final test, with a 95% range.

```sh
node bin/pmstack.mjs estimate clinic.json --check ck-person-judge
```

It needs a revealed final test that is still current, and judge results on unlabeled traces. When either is missing it exits 2 and says what to do: on the sample, "The final test for "Ignores requests for a person" is still hidden. Reveal it first". `--traces <file>` estimates on a file judged with `judge --split unlabeled --traces <file>`.

## policy

Check every tool call against your company's rules.

```sh
node bin/pmstack.mjs policy docs/studio/samples/support-agent.json --list-tools
node bin/pmstack.mjs policy docs/studio/samples/support-agent.json --policy templates/tool-calls/policy.json
```

| Option | Does |
|---|---|
| `--policy <file>` | The policy file (format `pmstack.policy/1`). |
| `--list-tools` | List each tool the traces use, how often, and a first guess at read or write. |
| `--json` | Print the results as JSON for scripts. |

It takes a trace file or a project. Violations print grouped by rule, each with its trace, step, and the rule's reason, and the run ends with "Breaks the policy in 13 of 45 traces." Exits 1 when any call breaks the policy. [Tool call checks](tool-call-evals.md) covers every rule type.

## retrieval

For answer bots that search documents: how often the sources an answer needed were found.

```sh
node bin/pmstack.mjs retrieval pmstack/project.json --k 5
```

It uses the traces where the reviewer marked the needed sources in the answer view, and reports Recall@k (the share of needed sources found in the top k results) and mean reciprocal rank (how high the first needed source ranked). Match `--k` to how many results your product passes to the AI. `--traces <file>` measures a new run of the same questions, for example after changing search settings. With no marked sources yet, it exits 2 and says how to mark them.

## report

Write what you found as Markdown, with a picture of the funnel beside it.

```sh
node bin/pmstack.mjs report docs/studio/samples/clinic-booking.json --out report.md
```

It writes `report.md` and `report-funnel.svg`: the summary ("You reviewed 102 of 170 traces. 36 had a problem, and 2 were set aside as not a product problem."), where traces go wrong, the failure modes and success modes, the checks and their agreement, before and after tables per version, and next steps. The report quotes your traces, so read it before sharing it outside your company.

## regression-set

Write the traces every future version must still handle.

```sh
node bin/pmstack.mjs regression-set docs/studio/samples/clinic-booking.json --out regression.jsonl
```

Each line is a failing trace of a failure mode you chose to fix or check, or a Good trace that shows a success mode. It keeps the original trace and adds `expected` (what it should do now) and `replay` (the conversation up to the customer's last message before the first thing that went wrong, or the input) for your build to send through the product again.

## checks

Write the code checks marked "Run on every change" to a file your engineers can run.

```sh
node bin/pmstack.mjs checks docs/studio/samples/clinic-booking.json --out checks.json
```

Then, in the build: `node bin/pmstack.mjs check checks.json --traces <file>`.
