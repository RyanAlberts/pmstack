---
name: pmstack-build-judge
description: "Builds an AI judge (a prompt that asks a model for Pass or Fail) for one failure mode found while reviewing traces, and saves it as a check in the pmstack project. Checks the prerequisites (at least 20 Problem and 20 Good labels, no simple rule that could decide it, the product's instructions already ask for the behavior), turns the failure mode's definition into Pass and Fail rules, picks 2 to 4 examples from the examples split only, puts the critique before the result, limits what the judge sees, pins an exact model version, and runs it on the tuning set. Use when a failure mode is marked Build a check and needs judgment a simple rule cannot make, or when someone asks to write, draft, or improve a judge prompt."
---

# Build an AI judge for one failure mode

An AI judge is a prompt that reads one trace and answers Pass or Fail for exactly one failure mode, writing its critique before its result. This skill writes the judge, saves it as a check, and runs it on the tuning set. `pmstack-test-judge` then reads the disagreements and runs the final test. Work through the phases in order and tell the user in one line what each phase did.

Words used here:
- **Trace**: one full conversation or task. **{userLabel}**: the project's user word, from `experience.userLabel` (patient, customer, employee).
- **Label**: the reviewer's yes or no to "Does this trace show this failure mode?" Reviews already count: a Problem tagged with the mode is a Problem label, and a Good trace reviewed after the mode existed is a Good label.
- **Splits**, set per failure mode and balanced across Problem and Good: **examples** (about 15%) go into the prompt; the **tuning set** (about 45%) is for improving it; the **final test** (about 40%) is used once, at the end.
- **Catches real failures**: of the traces the reviewer marked as showing the problem, the share the judge also caught. **Agrees on good traces**: of the traces the reviewer marked Good, the share the judge also passed.

Examples use the Maple Dental booking assistant (patients book, move, or cancel appointments by text, web chat, or phone; tools include `find_slots`, `book_appointment`, and `transfer_to_staff`).

## Setup

Locate the pmstack command line. Replace `<skill-dir>` with this skill's base directory (Claude Code shows it as "Base directory for this skill") and keep the quotes:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

If none is found, the reviewer builds the judge in Eval Studio in the browser (https://ryanalberts.github.io/pmstack/studio/, Checks tab), which copies judge prompts in batches of 10 for any AI assistant and reads the pasted answers; guide them through the same phases. Never install npm packages.

Set `PROJECT` to the project file (`<folder>/pmstack/project.json`). Save the helper at the end of this file as `pmstack-judge-helper.mjs` in a temporary directory outside the project folder, and set `HELPER` to its path.

**Studio running** means `<folder>/pmstack/.studio.json` names a live process:

```sh
node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.kill(s.pid,0);console.log("running "+s.url)}catch(e){console.log(e.code==="EPERM"?"running":"stopped")}' "$(dirname "$PROJECT")/.studio.json"
```

While it runs, build the judge in Eval Studio and leave `project.json` to the studio. `pmstack judge` is safe at any time: it saves through the project lock, and the studio merges its results.

**Questions**: when the user must choose, give 2 to 5 lettered options in plain words. When one option is better, put it first, marked "(recommended)" with its reason. Accept a single letter. When the files already answer a question, state what you found and continue.

## Phase 1: Choose the failure mode

Candidates are failure modes with decision `check` and no check yet, highest priority first (traces x severity weight: Blocks 3, Hurts 2, Annoys 1). Ask:

> Which failure mode gets a check next?
> A. Ignores requests for a person (recommended: highest priority, 7 traces, blocks the patient, no check yet)
> B. Offers a time that is taken (5 traces, blocks the patient)
> C. Books before the patient confirms (6 traces, hurts the patient)

## Phase 2: Check the prerequisites

| Prerequisite | How to check | When it is missing |
|---|---|---|
| The failure mode came from error discovery and has a "Fails when" definition | `modes` in `project.json`, kind `failure` | Load `pmstack-find-failures` |
| The product's instructions ask for this behavior | The mode's `instructed` is `yes`; otherwise read the system instructions and quote the line | Fix the instructions first. Build a judge only if it keeps failing after the fix, or the failure is critical |
| No simple rule can decide it | The table below | Build a code check in the Checks tab instead |
| At least 20 Problem and 20 Good labels | `node "$HELPER" "$PROJECT" "$PMSTACK" labels <modeId>` | Label more in the Checks tab ("Label more traces for this failure mode"); aim for about 50 of each |

A code check is a rule a computer can test: faster, free to run, and it never drifts. Use one whenever a visible pattern decides the failure:

| Maple Dental failure mode | Check | Why |
|---|---|---|
| Stray ** symbols in texts | Code check: "Text matches a pattern" (formatting symbols) on everything the AI said, only for traces where channel is sms | The symbols are characters on the screen |
| Answers billing questions itself | Code check first: "Text contains any of" insurance, copay, bill, balance on the AI's last message; move to a judge if its false alarms stay high | A word list catches most cases |
| Ignores requests for a person | AI judge | It must read what the patient meant ("can someone just call me") and whether the assistant transferred |
| Books before the patient confirms | AI judge | It must decide whether the patient agreed to one specific time before `book_appointment` ran |

Done when all four prerequisites hold. Otherwise route as the first table says and stop. With fewer than 60 labels in total the agreement numbers swing widely, so say so whenever you report them.

## Phase 3: Write the Pass and Fail rules

- One failure mode per judge, and only Pass or Fail: no scores, grades, or partial credit.
- **Fail when** is the failure mode's definition, sharpened until a new teammate could decide any trace with it. The **Pass when** line is always the same: "the trace does not show this failure, even if something else went wrong."
- Maple Dental: "Fails when the patient asks for a person (the front desk, a human, 'call me', 'someone real') and the assistant's next reply keeps handling the request instead of calling `transfer_to_staff`."
- Test the definition on 5 labeled traces yourself. If you hesitate on one, sharpen the definition before writing the judge. Edit it on the failure mode's card in the Failure modes tab (or in `modes` while no studio runs) so the judge and the labels share one definition.

## Phase 4: Pick the examples

- Take 2 to 4 examples from the examples split only: a clear Fail, a clear Pass, and a close call when the reviewer marked one ("Close call" in the labeling drawer). Examples from the tuning set or the final test would make those numbers meaningless.
- Each example needs a critique: one or two sentences citing what the {userLabel} said and what the AI did. The source is the "Why?" line from the labeling drawer; otherwise the review note when this is the trace's only failure mode (Fail), or the Good note (Pass). Examples without a critique are left out, so ask the reviewer to add a "Why?" line when one is missing.
- Fail critique: "In her second message the patient wrote 'can I just talk to someone at the desk'. The assistant replied with two open Friday times and never called transfer_to_staff."
- Close call critique (the reviewer said Pass): "The patient wrote 'fine, or have someone call me' and picked 9:30 in the same message. The assistant booked 9:30 and said the front desk would call to confirm, which answers both requests."

## Phase 5: Choose what the judge sees

The inputs are `customer` (what the {userLabel} and the AI said), `tools` (tool calls and results), `retrieval` (documents found), `metadata` (the details listed in filters, such as channel), and `context` (what the AI was given). Give the judge only what it needs to decide: extra text costs more and distracts it.

| Failure mode | Inputs | Why |
|---|---|---|
| Ignores requests for a person (Maple Dental) | customer, tools, metadata | The request, whether `transfer_to_staff` ran, and the channel |
| Books before the patient confirms (Maple Dental) | customer, tools | The patient's agreement and the `book_appointment` call |
| Cites a source that does not support the claim (policy answer bot) | customer, retrieval | The answer and the documents it cites |
| Wrong tone for the persona (sales email writer) | customer, metadata, context | The email, the prospect's role, and the brief |

## Phase 6: Pin the model

Use an exact, dated model version, such as `claude-haiku-4-5-20251001`. An alias that moves (a "latest" name, a bare family name) lets a provider update change the judge's answers silently. Start with a model strong enough to agree with the reviewer; try a cheaper one only after validation, and validate again after any switch.

## Phase 7: Save the judge as a check

Use a check id of `ck-` plus a short slug, such as `ck-person-judge`.

- **Studio running** (the usual case): guide the reviewer through the Checks tab: pick the failure mode, choose AI judge, confirm the label counts, tick the inputs from Phase 5 under "What the judge sees", read the generated prompt, and paste the pinned model. Then read `checks` in `project.json` to confirm the saved prompt and model.
- **No studio running**: `node "$HELPER" "$PROJECT" "$PMSTACK" save <modeId> <checkId> "<name>" <model> <inputs>` (inputs comma-separated). It assigns splits for new labels, builds the prompt with pmstack's own engine, saves the check through the project lock, and prints the split counts and the prompt. Running it again with the same check id rebuilds the prompt and keeps results.

Read the prompt and confirm it has:
1. One criterion, with the Fail when and Pass when lines from Phase 3.
2. The product and the {userLabel}'s goal.
3. 2 to 4 examples, at least one Pass and one Fail, each with its critique before its result.
4. The answer format: JSON with the critique first, `{"critique": "...", "result": "Pass"}` or `"Fail"`, and nothing else.
5. The `{{trace}}` placeholder where each trace goes.

When examples or critiques are missing, add "Why?" lines in the labeling drawer, then regenerate ("Reset to generated" in the studio, or the save command again). A hand-edited prompt keeps items 4 and 5 exactly.

## Phase 8: Run it on the tuning set

Tell the user how many traces will be judged and with which model, then run:

```sh
node "$PMSTACK" judge "$PROJECT" --check ck-person-judge --split tuning --cmd "claude -p --model {model}" --batch 10
node "$PMSTACK" agreement "$PROJECT" --check ck-person-judge --split tuning
```

`--cmd` is any command that reads the prompt on standard input and prints the answer; `{model}` becomes the check's pinned model. `--batch 10` judges 10 traces per call. The examples split is never sent. Results save as they arrive and appear in the studio.

Report both numbers in plain words: "Catches real failures: 89% (8 of 9). Agrees on good traces: 95% (21 of 22)." The target is both above 90%, with 80% as the minimum. Always give both: a judge that always says Good scores 100% on the second and 0% on the first.

Then load `pmstack-test-judge` to read every disagreement, improve the prompt on the tuning set, and run the final test once.

## Never

- Put tuning or final-test traces in the prompt.
- Run `--split test`: the final test belongs to `pmstack-test-judge` and runs once.
- Cover two failure modes with one judge, or ask the judge for a score.
- Pin a model alias.
- Hand-edit `project.json` while the studio runs.

## The helper

Save as `pmstack-judge-helper.mjs` outside the project folder. It needs Node 20 and the pmstack command line.

```js
// pmstack-judge-helper.mjs: label counts and saving a judge check with pmstack's engine.
// node pmstack-judge-helper.mjs <project.json> <pmstack.mjs> labels <modeId>
// node pmstack-judge-helper.mjs <project.json> <pmstack.mjs> save <modeId> <checkId> "<name>" <model> [inputs]
import { pathToFileURL } from "node:url";

const [projectPath, cliPath, command, modeId, checkId, name, model, inputList = "customer,tools,metadata,context"] = process.argv.slice(2);
const { loadProjectFile, saveProjectFile } = await import(pathToFileURL(cliPath).href);
const lib = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cliPath)).href);
let p = await loadProjectFile(projectPath);

const labels = lib.labeledSet(p, modeId);
const problems = labels.filter((l) => l.label === "fail").length;
console.log(`Labels for ${modeId}: ${problems} Problem, ${labels.length - problems} Good.`);

if (command === "save") {
  const existing = (p.checks ?? []).find((c) => c.id === checkId);
  if (existing?.promptEdited) throw new Error(`${checkId} has a hand-edited prompt. Change it in Eval Studio or use a new check id.`);
  p = lib.assignSplits(p, modeId); // keeps existing assignments; places new labels
  const inputs = inputList.split(",");
  const check = {
    results: {}, unreadable: [], test: null, runs: [], ci: false, runMode: "batch", ...existing,
    id: checkId, modeId, type: "judge", name, model, inputs, promptEdited: false,
    prompt: lib.buildJudgePrompt(p, modeId, { inputs }),
  };
  const checks = existing ? p.checks.map((c) => (c.id === checkId ? check : c)) : [...(p.checks ?? []), check];
  p = { ...p, checks, updatedAt: new Date().toISOString() };
  await saveProjectFile(projectPath, p);
  console.log("Splits:", JSON.stringify(lib.splitCounts(p, modeId)));
  console.log(check.prompt);
}
```
