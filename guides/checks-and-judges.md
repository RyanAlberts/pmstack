# Checks and AI judges

A check turns one failure mode into a pass or fail answer on every trace. You build checks in the Checks tab after error discovery, for the failure modes you decided to check. This guide covers both kinds of checks, the labels they are measured against, the final test, the likely true failure rate, and how to run checks on every code change.

Examples come from the Maple Dental booking assistant sample. [Open its Checks tab](https://ryanalberts.github.io/pmstack/studio/#/open/clinic-booking) to follow along.

## Pick the kind of check

For each failure mode, ask: can a simple rule decide this?

- **Code check**: a rule a computer can test, like "no formatting symbols in text messages". Free, fast, and the same answer every time. Use one whenever a rule can decide.
- **AI judge**: a prompt that asks a model to decide pass or fail for one failure mode. Use one when the answer takes judgment, such as whether a reply handed the patient to a person or only said it would.

Check the instructions first. If your AI's instructions never asked for the behavior, add the instruction and read new traces before you build anything. A check for a rule nobody wrote down measures a gap you can close in one line.

## Code checks

A code check has four parts: what to test, where to look, which traces it applies to, and when it fails.

| What to test | Fails or passes on |
|---|---|
| Text matches a pattern | A pattern (with ready-made ones: formatting symbols, email address, phone number, link, dollar amount) |
| Text contains | A word or phrase |
| Text contains any of (comma-separated) | Any word in a list |
| Text does not contain | A missing word or phrase |
| Longer than N characters | Length over a limit |
| Shorter than N characters | Length under a limit |
| Is valid structured data | Text that must parse as JSON |
| Uses a tool | A call to a named tool |
| Never uses a tool | No call to a named tool |
| Uses a tool more than N times | Too many calls to one tool |
| A field equals | A value at a path in the trace |
| A field is present | A path that must exist |
| Every number in the reply comes from a tool | See [Tool call checks](tool-call-evals.md#output-grounding) |
| Claims success after a failed or pending call | See [Tool call checks](tool-call-evals.md#output-grounding) |

| Where to look | Means |
|---|---|
| The final reply | The output the customer saw last |
| Everything the AI said | Every assistant message |
| The AI's last message | The last assistant message |
| What the customer said | Every message from the customer |
| The whole trace | All text in the trace |
| A specific field | One path in the trace, such as `metadata.plan` |

"Only for traces where a detail is a value" limits the check: traces that don't match pass with "Does not apply". "Fail when the text matches" or "does not match" sets the direction.

The dental sample's stray symbols check, as saved in the project file:

```json
{
  "id": "ck-stray-symbols",
  "modeId": "fm-stray-symbols-in-texts",
  "type": "code",
  "name": "No formatting symbols in text messages",
  "rule": { "op": "regex", "target": "assistant", "value": "(\\*\\*|^#{1,3} |^\\s*[-*] |\\[[^\\]]+\\]\\([^)]+\\))", "flags": "m" },
  "when": { "path": "metadata.channel", "equals": "sms" },
  "failWhen": "match",
  "ci": true
}
```

Results update as you edit: "Fails 11 of 170 traces", and per version when your traces have versions ("11 of 150 in Before the fix, 0 of 20 in After the fix").

## AI judges

A judge is a prompt. pmstack writes the first version from your failure mode, and you improve it. Before you write one:

- Finish error discovery, so the failure mode is one you saw, with a definition you trust.
- Try a code check first.
- Label at least 20 traces that show the problem and 20 that don't. Aim for about 50 of each.

Every judge follows the same rules:

- **One failure mode per judge.** "Ignores requests for a person" gets its own judge. A judge that checks several things at once can't tell you which one failed.
- **Pass or Fail.** Never a score from 1 to 5: nobody can act on a 3.
- **Critique first, then the result.** The judge writes one or two sentences about the trace, then answers `{"critique": "...", "result": "Pass"}`. Writing the reason first makes the answer more careful, and the critique tells you why it decided.
- **Examples from your labels.** The prompt shows 2 to 4 labeled traces with your one-line critique of each: a clear pass, a clear fail, and a close call when you marked one. They come only from the examples set (below), so the judge is never graded on a trace it saw in its prompt.
- **Only what it needs.** "What the judge sees" picks the parts of each trace: what the customer said, the tool calls, the details, the context. Less text means fewer ways to get distracted.
- **A pinned model.** Write an exact model version, such as `claude-haiku-4-5-20251001`, never a name that moves to a new model on its own. A new model is a new judge and needs a new test.

### Run a judge

**In the browser.** Copy the next 10 traces as one prompt, paste it into an AI assistant your company approves, and paste the answer back. pmstack reads the results and shows agreement as they arrive.

**On your computer.** `pmstack judge` sends each prompt to a model command you choose and saves the results in the project:

```sh
node bin/pmstack.mjs judge pmstack/project.json --check ck-person-judge --cmd "claude -p --model {model}" --batch 10
```

`{model}` becomes the judge's pinned model. pmstack starts the command directly, with no shell, and sends the prompt on its standard input. The [command line guide](cli.md#judge) lists every option.

`/pmstack:build-judge` in Claude Code writes a judge with you, and `/pmstack:test-judge` measures it.

## Labels

A label is your yes or no to "Does this trace show this failure mode?" Every trace you reviewed after the failure mode existed already counts:

- A Problem trace you tagged with the failure mode counts as yes.
- A Good trace you reviewed after the failure mode was created counts as no.
- A Problem trace tagged with a different failure mode has no label for this one. It failed for another reason, and it may or may not show this one too.
- A Good trace reviewed before the failure mode existed needs a re-check first.

For more labels, open "Label more traces for this failure mode". The drawer shows one trace at a time: press 2 for Yes or 1 for No, mark a close call, and write a one-line "Why?" that the prompt can use as the example's critique.

## Examples, tuning set, and final test

pmstack splits your labels three ways for each failure mode:

| Set | Share | Used for |
|---|---|---|
| Examples | about 15% | Shown in the judge's prompt |
| Tuning set | about 45% | Improving the prompt: run, read the disagreements, fix, run again |
| Final test | about 40% | Measuring the finished judge, once |

The split is made separately for yes and no labels, so each set gets its share of both. The same labels always land in the same sets, and new labels fill whichever set is furthest below its share. You can reshuffle only before the judge has any results.

## Agreement: two numbers

Eval Studio compares each check with your labels and shows two numbers:

- **Catches real failures.** Of the traces you marked as showing the problem, the share the check also caught.
- **Agrees on good traces.** Of the traces you marked Good, the share the check also marked Good.

Aim for both above 90%, with 80% as the minimum. Look at both, because one number hides the other kind of mistake: a judge that always says Good agrees on every good trace and catches no failures at all. A single "accuracy" or "percent agreement" figure hides this too, because most traces are good.

Below the numbers, two lists: "Check missed these failures" and "Check flagged these good traces". Read every one. Each disagreement means the prompt needs a fix, or your label was wrong. Fix labels only in the tuning set.

Code checks are measured on every labeled trace. Judges are measured on the tuning set until you reveal the final test.

In the dental sample:

| Check | Catches real failures | Agrees on good traces |
|---|---|---|
| No formatting symbols in text messages (code check) | 100% (9 of 9) | 100% (64 of 64) |
| Billing words in the last reply (code check) | 60% (3 of 5) | 92% (59 of 64) |
| Hands off when asked for a person (AI judge, tuning set) | 89% (8 of 9) | 94% (33 of 35) |

The billing word list flags replies that remind the patient to bring an insurance card, and it misses calls where the billing answer came before a last reply with none of the listed words. That failure mode needs a judge.

## The final test

Reveal the final test once, when the tuning numbers are where you want them. Eval Studio asks you to confirm: "Look at the final test once. If you change the prompt after this, the final test no longer tells you how good the judge is."

After the reveal:

- The final test's labels are locked, and new labels join the tuning set.
- A change to the prompt, the model, the failure mode's definition, or the final test's labels marks the result "Out of date".
- Once 30 or more labels have been added since the reveal, you can start a fresh final test.

If the final test scores well below the tuning set, the prompt was tuned too closely to the tuning traces. Simplify it, and measure again on a fresh final test.

## Likely true failure rate

A judge that flags 18% of new traces is not telling you 18% of traces fail: it misses some failures and flags some good traces. pmstack corrects the flagged share with the two numbers from the final test:

```
likely good share = (share the judge marked Good + catches real failures - 1)
                    / (agrees on good traces + catches real failures - 1)
likely true failure rate = 1 - likely good share
```

The 95% range comes from redoing that calculation 2,000 times on resampled data, drawing both the final test's labels and the judge's answers on unlabeled traces again each time. Eval Studio shows it on the traces you haven't labeled: "The judge flagged 18% of them. Correcting for its known mistakes, the likely true failure rate is 14% (95% range: 4% to 21%)."

It needs a revealed final test that is still current, and judge results on traces you haven't labeled. When the final test is too small for a steady range, pmstack says so instead of printing one. From the command line:

```sh
node bin/pmstack.mjs estimate pmstack/project.json --check ck-person-judge
```

## Run checks on every change

Most engineering teams run automatic checks on every code change, a setup called continuous integration (CI). pmstack's checks fit into it:

1. **Mark the checks.** In the Checks tab, turn on "Run on every change" for each code check your engineers should run.
2. **Hand over two files.** From the Report tab, or from the command line:

   ```sh
   node bin/pmstack.mjs checks pmstack/project.json --out checks.json
   node bin/pmstack.mjs regression-set pmstack/project.json --out regression.jsonl
   ```

   `checks.json` holds the code checks. `regression.jsonl` holds the traces every future version must still handle: the failing traces of failure modes you chose to fix or check, and Good traces that show success modes, each with the input to replay.
3. **Replay and check in the build.** Your team's own script sends each regression trace's replay input through the product and writes fresh traces with the same ids. Then:

   ```sh
   node bin/pmstack.mjs check checks.json --traces fresh.jsonl --expect regression.jsonl
   ```

   It exits 1 when a trace fails a check it is expected to pass, or when a fixed failure comes back, so the build stops. A passing build means no known failure came back.

`/pmstack:regression-checks` in Claude Code sets this up with a GitHub Actions workflow, adds production sampling (run a validated judge on a random sample of new traces, then `pmstack estimate`), and schedules fresh error discovery after big changes. New traces bring new failures that no existing check knows about.
