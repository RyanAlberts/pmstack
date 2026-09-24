---
name: pmstack-tool-relevance
description: Checks relevance for an AI agent that calls tools, asking whether each call is the right one for what the user asked. Right tool, right details, no calls the request did not need, none it skipped. Confirms relevance failures in reviewed traces first, builds an intent map from real requests (for each kind of request, the tools it needs, may use, and must never use), runs it as a code check when traces carry an intent label, and otherwise sets up the relevance AI judge template and hands it to judge validation. Use when an agent picks the wrong tool, skips a needed lookup, makes calls nobody asked for, or passes wrong details, or when someone asks to evaluate tool selection, intent to tool mapping, or tool call relevance.
---

# Check that the agent makes the right tool calls

Relevance is the second of three Tool call checks, the questions pmstack asks about every tool call an AI agent makes:

1. **Policy: Is this call allowed?** Your company's rules for which tools the agent may use, when, and with what details.
2. **Relevance: Is it the right call for what the customer asked?** Right tool, right details, no calls the request didn't need, none it skipped.
3. **Output grounding: Does the reply match what the tool returned?** No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.

This skill covers relevance. `pmstack-tool-policy` and `pmstack-tool-grounding` cover the other two.

Relevance failures are among the most common ways agents that use tools let people down. Confirm them in your own traces with error discovery first, then use the templates as a head start. Relevance failures start where the agent chose the tool: the plan or act stage of the funnel.

Words used here:
- **Intent**: one kind of request, such as "Question about a bill". **Intent label**: a detail on each trace that names its intent, such as `metadata.intent`, written by a router, a classifier, or a reviewer.
- **Intent map**: an open JSON file (format `pmstack.intents/1`) that lists, for each intent, the tools the request needs (`expect`), may use (`allow`), and must never use (`never`).
- **Reviewer**: the person whose judgment sets the bar in Eval Studio. **Label**: the reviewer's yes or no to "Does this trace show this failure mode?"

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

Examples use the Northstar Internet support agent, a made-up internet provider (sample `support-agent`: https://ryanalberts.github.io/pmstack/studio/#/open/support-agent). Its traces carry `metadata.intent` with six intents: billing-question, outage-credit, plan-change, cancel-service, technician-visit, and how-to.

## Setup

Locate the pmstack command line. Replace `<skill-dir>` with this skill's base directory (Claude Code shows it as "Base directory for this skill") and keep the quotes:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
TEMPLATES="$(dirname "$PMSTACK")/../templates/tool-calls"
```

It needs Node 20 or newer. If your shell forgets variables between commands, use the found paths literally. When `$TEMPLATES/intents.json` is missing, read the same files at https://github.com/RyanAlberts/pmstack/tree/main/templates/tool-calls.

If `PMSTACK` stays empty, work in Eval Studio in the browser (https://ryanalberts.github.io/pmstack/studio/): in the Checks tab, the Tool call checks panel offers "Use an intent map" and "Use the AI judge template" under Relevance. Never install npm packages.

Set `PROJECT` to `<folder>/pmstack/project.json`. Save the helper at the end of this file as `pmstack-relevance-helper.mjs` in a temporary directory outside the project folder, and set `HELPER` to its path.

**Studio running** means `<folder>/pmstack/.studio.json` names a live process:

```sh
node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.kill(s.pid,0);console.log("running "+s.url)}catch(e){console.log(e.code==="EPERM"?"running":"stopped")}' "$(dirname "$PROJECT")/.studio.json"
```

While it runs, add checks through Eval Studio and leave `project.json` to the studio. The helper's `tools` and `flags` commands only read, so they are safe at any time.

**Questions**: when the user must choose, give 2 to 5 lettered options in plain words. When one option is better, put it first, marked "(recommended)" with its reason. Accept a single letter. When the files already answer a question, state what you found and continue.

## Phase 1: Confirm relevance failures in the traces

Relevance checks start from what the reviewer saw. With no project or no reviews yet, load `pmstack-error-discovery` and come back after at least 30 reviewed traces.

List the reviewer's Problem notes with their failure modes:

```sh
node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const names = Object.fromEntries((p.modes ?? []).map((m) => [m.id, m.name]));
for (const [id, r] of Object.entries(p.reviews ?? {}))
  if (r.verdict === "fail") console.log(`${id} [${r.stage ?? "no stage"}] ${(r.modes ?? []).map((m) => names[m]).join(", ") || "no failure mode"}: ${r.note}`);
' "$PROJECT"
```

Look for notes about the wrong tool, a skipped lookup, a call nobody needed, or wrong details (dates, amounts, account numbers, names). Northstar's reviewer, Sam, wrote:
- t-0021: "Wanted a cheaper plan. It cancelled his whole service instead."
- t-0007: "Asked why the bill is $67.90. It never pulled the bill, so it missed the $10 late fee and called the rest taxes."

Sam grouped both into the failure mode "Wrong tool for the request" at the stage "Pick the right action".

| What the notes show | Next |
|---|---|
| Relevance failures, grouped into a failure mode | Phase 2 with that failure mode |
| Relevance failures with no failure mode yet | Ask the reviewer to group them in the Failure modes tab, or suggest one through `pmstack-error-discovery` (Phase 5) |
| No relevance failures | Stop here, and look again after the next round of reviews |

Done when a failure mode built from the reviewer's notes covers the relevance failures, or the reviewer confirms none appear.

## Phase 2: Choose the intent map, the AI judge, or both

See whether the traces carry an intent label:

```sh
node "$HELPER" "$PROJECT" "$PMSTACK" tools metadata.intent
```

It prints each intent with its trace count and how many of those traces call each tool, then lists the first request of each trace with no intent. Use a different detail path if the router or classifier writes somewhere else.

| What you find | Use | Why |
|---|---|---|
| An intent label on most traces | The intent map, a code check | Free, fast, and it never drifts |
| No intent label | The AI judge template | The judge reads the request itself |
| Failures about wrong details (dates, amounts, ids) | The AI judge template too | The intent map checks which tools were called, not their details |

Wrong details that break a company rule, such as a plan name outside the list or another customer's account, belong in the policy (`pmstack-tool-policy`), so each problem has one check.

> How should we check relevance?
> A. The intent map (recommended: all 45 traces carry metadata.intent, and both of Sam's notes are about which tool was called)
> B. The AI judge template
> C. Both: the intent map for which tool, the judge for the details

Done when the user has picked. On B alone, go to Phase 5.

## Phase 3: Build the intent map from real requests

Read the Phase 2 output with the user. Northstar:

```
billing-question (11 traces): verify_identity 11/11, get_bill 8/11, lookup_account 4/11, search_help_center 3/11
plan-change (6 traces): verify_identity 6/6, lookup_account 6/6, change_plan 4/6, search_help_center 3/6, cancel_service 2/6
technician-visit (7 traces): verify_identity 7/7, lookup_account 7/7, schedule_technician 7/7, find_technician_slots 6/7, search_help_center 4/7
```

For each intent, sort its tools:
- **expect**: the request needs it to be served (a bill question needs `get_bill`).
- **allow**: fine to call, and optional (`search_help_center` on a bill question).
- **never**: a tool that would hurt the customer on this request (`cancel_service` on a plan change).

A needed tool called in fewer traces than the intent holds points at failures: `get_bill` 8 of 11 means 3 bill questions were answered without the bill. Ask one intent at a time:

> For "Wants a different plan", which tool must every trace call?
> A. change_plan (recommended: 4 of 6 traces call it, and the other 2 called cancel_service, which Sam flagged)
> B. change_plan and lookup_account

> Which tools must a plan change never use?
> A. cancel_service (recommended: it ends the customer's service, as in t-0021)
> B. None

With no intent label, group the first requests of 30 to 50 traces with the user into 4 to 8 intents named in the customer's terms. The map then needs a label on each trace: ask the engineers to log the router's or classifier's choice as `metadata.intent`. Until those traces arrive, use the AI judge (Phase 5).

Write `pmstack/intents.json`, starting from `$TEMPLATES/intents.json`: `"format": "pmstack.intents/1"`, `intentFrom` (the detail path), and `intents`, each with `id` (the value in the traces), `label`, an `example` request, `expect`, `allow`, and `never`.

Done when every intent value in the traces has an entry and every tool the traces call for it sits in `expect`, `allow`, or `never`.

## Phase 4: Run it and read every flag

- **Studio running**: Checks tab, Tool call checks, Relevance, "Use an intent map", then upload the file and link it to the failure mode from Phase 1.
- **No studio running**:
  ```sh
  node "$HELPER" "$PROJECT" "$PMSTACK" add pmstack/intents.json <modeId>
  ```
  It marks the failure mode with the relevance template and saves check `ck-intent-map` with the map inside the project. Run it again after each change to the map.

Then print every trace the check fails, with the reviewer's verdict and label, and compare with the labels:

```sh
node "$HELPER" "$PROJECT" "$PMSTACK" flags ck-intent-map
node "$PMSTACK" agreement "$PROJECT" --check ck-intent-map
```

Each flag reads "Skipped a needed tool", "Called a tool the request didn't need", or "Called a tool this request must never use". Sort each one:

| Flag | Cause | Change |
|---|---|---|
| The trace shows the failure | A real problem | The reviewer labels it for the failure mode |
| A fine call reads "didn't need" | The map is too strict | Add the tool to `allow` |
| A needed call reads "skipped", yet the request was served another way | The map expects too much | Move the tool to `allow` |
| The reviewer's failure passes (listed under "Check missed these failures") | The map is too loose | Add the tool to `never`, or the missing one to `expect` |

Northstar's first map had 11 flags. Six were `find_technician_slots` on technician visits, a read tool that lists open visit times; t-0004 among them was a Good trace, so it moved to `allow`. The other five were real: three bill questions answered without `get_bill` (t-0007, t-0030, t-0040) and two plan changes done with `cancel_service` (t-0021, t-0036). After the fix: catches real failures 100% (2 of 2), agrees on good traces 100% (12 of 12).

The helper also counts traces with no intent the map lists. The check passes them without looking, so a large count means the AI judge (Phase 5) has work to do.

Done when every flag is a real problem the reviewer has labeled or a fixed entry in the map, and the agreement numbers are reported with their counts.

## Phase 5: Set up the relevance AI judge

Use it for traces with no intent label and for wrong details. An AI judge is a prompt that asks a model for Pass or Fail on one failure mode.

1. Mark the failure mode with the relevance template: in the studio, Tool call checks, Relevance, "Use the AI judge template" (pick the failure mode from Phase 1). With no studio running, the helper's `add` command already did it; on the judge-only path, run `node "$HELPER" "$PROJECT" "$PMSTACK" mark <modeId>`.
2. pmstack's judge prompt for that failure mode then includes the relevance checklist: the tool serves what the customer asked, its details match what the customer said, every call was needed, every needed call was made, and the agent asks when a required detail is missing. By default the judge sees what the customer and the agent said, plus the tool calls and results.
3. Load `pmstack-write-judge` for this failure mode. It checks the label counts (at least 20 Problem and 20 Good), picks examples, pins the model, saves the judge, and runs it on the tuning set.
4. Load `pmstack-validate-judge` to read every disagreement with the reviewer's labels and run the final test once. Trust the judge after both numbers clear 90% (80% at the least).

For judges run outside pmstack, `$TEMPLATES/relevance-judge.md` holds the full prompt with placeholders and a filled Northstar examples block: a clear fail (cancel_service for a plan change), a clear pass, and a close call (an extra help center search that changed nothing).

Done when the judge is saved and `pmstack-validate-judge` has started, or the intent map covers every trace and the notes show no wrong-detail failures.

## Phase 6: Keep it running

- Turn on "Run on every change" for the intent map check once its flags are all real: the toggle in the Checks tab, or `node "$HELPER" "$PROJECT" "$PMSTACK" add pmstack/intents.json <modeId> ci`. `pmstack check` then runs it with the other code checks and exits 1 when a trace fails; `pmstack-regression-checks` puts it in the build.
- When the product gains a tool or a new kind of request, update the map. Traces with an intent the map does not list pass unchecked, so read the helper's count after each new batch of traces.

## Report to the user

```
Relevance failure mode: <name> (<n> Problem notes)
Intent map: <n> intents from <detail path>; <a> of <b> traces have an intent it lists
Flags: <n> real, <m> fixed in the map
Agreement: catches real failures <x>% (<a> of <b>), agrees on good traces <y>% (<c> of <d>)
AI judge: <status, or not needed: reason>
Runs on every change: <yes or no>
```

## Never

- Set verdicts, notes, or labels: the reviewer owns them.
- Write `project.json` by hand while the studio runs.
- Build a relevance check before the reviewer's notes show relevance failures.

## The helper

Save as `pmstack-relevance-helper.mjs` outside the project folder. It needs Node 20 and the pmstack command line.

```js
// pmstack-relevance-helper.mjs: tools per intent, the relevance check, and its flags.
// node pmstack-relevance-helper.mjs <project.json> <pmstack.mjs> tools [intentPath]
// node pmstack-relevance-helper.mjs <project.json> <pmstack.mjs> add <intents.json> <modeId> [ci]
// node pmstack-relevance-helper.mjs <project.json> <pmstack.mjs> flags <checkId>
// node pmstack-relevance-helper.mjs <project.json> <pmstack.mjs> mark <modeId>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [projectPath, cliPath, command, arg, modeId, ci] = process.argv.slice(2);
const { loadProjectFile, saveProjectFile } = await import(pathToFileURL(cliPath).href);
const lib = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cliPath)).href);
let p = loadProjectFile(projectPath);
const traces = lib.normalizeAll(p);

if (command === "tools") {
  // For each intent value: how many traces, and how many of them call each tool.
  const path = arg ?? "metadata.intent";
  const groups = new Map();
  for (const [id, n] of traces) {
    const intent = lib.fieldValue(n, path) || "(no intent)";
    if (!groups.has(intent)) groups.set(intent, []);
    groups.get(intent).push({ id, n });
  }
  for (const [intent, list] of groups) {
    const counts = {};
    for (const { n } of list) for (const name of new Set(lib.toolCallList(n).map((c) => c.name))) counts[name] = (counts[name] ?? 0) + 1;
    const tools = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, k]) => `${name} ${k}/${list.length}`);
    console.log(`${intent} (${list.length} traces): ${tools.join(", ") || "no tool calls"}`);
    if (intent === "(no intent)") for (const { id, n } of list.slice(0, 50)) console.log(`  ${id}: ${n.title}`);
  }
} else if (command === "add") {
  const intents = JSON.parse(readFileSync(arg, "utf8"));
  const valid = lib.validateIntents(intents);
  if (!valid.ok) throw new Error(`${arg} has problems:\n${valid.errors.join("\n")}`);
  p = lib.updateMode(p, modeId, { template: "relevance" }); // its AI judge gets the relevance checklist
  let checkId = (p.checks ?? []).find((c) => c.type === "relevance" && c.modeId === modeId)?.id;
  if (checkId) p = lib.updateCheck(p, checkId, { intents, ci: ci === "ci" });
  else ({ project: p, id: checkId } = lib.addCheck(p, { id: "ck-intent-map", type: "relevance", modeId, name: "Right tools for the request", intents, ci: ci === "ci" }));
  await saveProjectFile(projectPath, p);
  console.log(`Saved ${checkId} on failure mode ${modeId}. Runs on every change: ${ci === "ci" ? "yes" : "no"}.`);
} else if (command === "flags") {
  // Every trace the check fails, with why, and the reviewer's verdict and label for its failure mode.
  const check = p.checks.find((c) => c.id === arg);
  const opts = lib.checkOptions(p);
  let skipped = 0;
  for (const [id, n] of traces) {
    const r = lib.runCheck(check, n, opts);
    if (r.relevance && !r.relevance.applies) skipped++;
    if (r.verdict === "pass") continue;
    console.log(`${id} [${r.verdict}] ${r.detail} | review: ${p.reviews?.[id]?.verdict ?? "none"} | label: ${lib.humanLabel(p, id, check.modeId) ?? "none"}`);
  }
  console.log(`${skipped} traces had no intent the map lists, so the check passed them without looking.`);
} else if (command === "mark") {
  // Judge only, no intent map: mark the failure mode so its AI judge gets the relevance checklist.
  p = lib.updateMode(p, arg, { template: "relevance" });
  await saveProjectFile(projectPath, p);
  console.log(`Marked ${arg} with the relevance template.`);
}
```
