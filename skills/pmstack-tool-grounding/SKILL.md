---
name: pmstack-tool-grounding
description: Checks output grounding for an AI agent that calls tools, asking whether the reply matches what the tool returned. Confirms grounding failures in reviewed traces first, adds two code checks (every number in the reply comes from a tool; no success claimed after a failed or pending call), tunes them on what they flag, then sets up the output grounding AI judge template for reworded facts and dropped qualifiers and hands it to pmstack-test-judge. Use when an agent's replies contradict tool results, report pending actions as done, change times or amounts, or state facts no tool returned, or when someone asks to evaluate faithfulness to tool output or made-up tool results in replies.
---

# Check that replies match what the tools returned

Output grounding is the third of three Tool call checks, the questions pmstack asks about every tool call an AI agent makes:

1. **Policy: Is this call allowed?** Your company's rules for which tools the agent may use, when, and with what details.
2. **Relevance: Is it the right call for what the customer asked?** Right tool, right details, no calls the request didn't need, none it skipped.
3. **Output grounding: Does the reply match what the tool returned?** No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.

This skill covers output grounding. `pmstack-tool-policy` and `pmstack-tool-relevance` cover the other two.

Grounding failures are among the most common ways agents that use tools let people down, and the customer acts on the wrong fact: they wait at home for a visit nobody booked. Confirm them in your own traces with error discovery first, then use the templates as a head start. Grounding failures start at the reply: the answer stage of the funnel.

Words used here:
- **Tool result**: what a tool returned to the agent, such as `{"status": "pending_approval", "amount": 80}`. **Reply**: what the customer saw.
- **Qualifier**: a word that limits a fact, such as pending, estimated, partial, or until a date.
- **Reviewer**: the person whose judgment sets the bar in Eval Studio. **Label**: the reviewer's yes or no to "Does this trace show this failure mode?"

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

Examples use the Northstar Internet support agent, a made-up internet provider (sample `support-agent`: https://ryanalberts.github.io/pmstack/studio/#/open/support-agent). The table below adds one from the Maple Dental booking assistant and two from a kitchen store's order agent.

## Common grounding failures

| Failure | The tool returned | The reply said | First check that catches it |
|---|---|---|---|
| Pending shown as done | `issue_credit`: `"status": "pending_approval"` | "Done! $80 is off your next bill." | Claims success after a failed or pending call |
| Changed time | `schedule_technician`: `"arrival_window": "12:00-16:00"` | "between 8:00 AM and 12:00 PM" | Every number in the reply comes from a tool |
| Wrong time | `book_appointment`: `"time": "10:30"` | "You're booked for Friday at 9:30 AM." | Every number in the reply comes from a tool |
| Rounded amount | `issue_refund`: `"amount": 79.50` | "Your refund of $80 is on its way." | Every number in the reply comes from a tool |
| Success after an error | `schedule_technician`: `"status": "error"`, slot already taken | "You're booked!" | Claims success after a failed or pending call |
| Dropped qualifier | `track_order`: `"status": "delayed"`, no new date | "Good news: it arrives tomorrow." | The AI judge: the reply holds no number to match |

## Setup

Locate the pmstack command line. Replace `<skill-dir>` with this skill's base directory (Claude Code shows it as "Base directory for this skill") and keep the quotes:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
TEMPLATES="$(dirname "$PMSTACK")/../templates/tool-calls"
```

It needs Node 20 or newer. If your shell forgets variables between commands, use the found paths literally. When `$TEMPLATES/grounding-judge.md` is missing, read the same files at https://github.com/RyanAlberts/pmstack/tree/main/templates/tool-calls.

If `PMSTACK` stays empty, work in Eval Studio in the browser (https://ryanalberts.github.io/pmstack/studio/): in the Checks tab, the Tool call checks panel offers "Add the value check", "Add the failed-call check", and "Use the AI judge template" under Output grounding. Never install npm packages.

Set `PROJECT` to `<folder>/pmstack/project.json`. Save the helper at the end of this file as `pmstack-grounding-helper.mjs` in a temporary directory outside the project folder, and set `HELPER` to its path.

**Studio running** means `<folder>/pmstack/.studio.json` names a live process:

```sh
node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.kill(s.pid,0);console.log("running "+s.url)}catch(e){console.log(e.code==="EPERM"?"running":"stopped")}' "$(dirname "$PROJECT")/.studio.json"
```

While it runs, add checks through Eval Studio and leave `project.json` to the studio. The helper's `flags` command only reads, so it is safe at any time.

**Questions**: when the user must choose, give 2 to 5 lettered options in plain words. When one option is better, put it first, marked "(recommended)" with its reason. Accept a single letter. When the files already answer a question, state what you found and continue.

## Phase 1: Confirm grounding failures in the traces

Grounding checks start from what the reviewer saw. With no project or no reviews yet, load `pmstack-find-failures` and come back after at least 30 reviewed traces.

List the reviewer's Problem notes with their failure modes:

```sh
node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const names = Object.fromEntries((p.modes ?? []).map((m) => [m.id, m.name]));
for (const [id, r] of Object.entries(p.reviews ?? {}))
  if (r.verdict === "fail") console.log(`${id} [${r.stage ?? "no stage"}] ${(r.modes ?? []).map((m) => names[m]).join(", ") || "no failure mode"}: ${r.note}`);
' "$PROJECT"
```

Look for notes where the reply and a tool result disagree. Northstar's reviewer, Sam, wrote:
- t-0015: "Tool booked 12 to 4 because no morning windows were left. Reply told him 8 to 12. He leaves at noon and will miss the tech."
- t-0019: "Scheduler said the slot was already taken. Reply says 'You're booked!' Nobody is coming Thursday."
- t-0002: "Gave $80 with no supervisor OK, then told her 'Done! $80 is off your next bill' when billing said pending approval."

Sam grouped them into the failure mode "Reply doesn't match the tool results" at the stage "Reply to the customer".

| What the notes show | Next |
|---|---|
| Grounding failures, grouped into a failure mode | Phase 2 with that failure mode |
| Grounding failures with no failure mode yet | Ask the reviewer to group them in the Failure modes tab, or suggest one through `pmstack-find-failures` (Phase 5) |
| No grounding failures | Stop here, and look again after the next round of reviews |

Done when a failure mode built from the reviewer's notes covers the grounding failures, or the reviewer confirms none appear.

## Phase 2: Add the two code checks

Code checks are rules a computer can test: free to run, fast, and they never drift. Add both before any AI judge.

- **Every number in the reply comes from a tool** (the value check): finds amounts, percentages, times, dates, numbers with units, and codes such as `TV-80198` in the final reply, and fails the trace when one appears nowhere in a tool result, a tool call's details, a retrieved document, or the customer's own words. It compares exact values after tidying the format ("9:30 AM" equals "09:30"; "$1,234.50" equals "1234.5"; "Sept 25" equals "2026-09-25"). It reads no meaning, so a reworded fact passes.
- **Claims success after a failed or pending call** (the failed-call check): fails the trace when the reply says done, booked, confirmed, applied, refunded, cancelled, scheduled, updated, all set, or taken care of, and the most recent write call came back with an error or a pending result. Replies that say it is pending or that it failed pass. It learns which tools write from the project's policy check (`pmstack-tool-policy`); with no policy, it looks at the most recent call of any tool.

Add them:
- **Studio running**: Checks tab, Tool call checks, Output grounding, "Add the value check" and "Add the failed-call check", each linked to the failure mode from Phase 1.
- **No studio running**:
  ```sh
  node "$HELPER" "$PROJECT" "$PMSTACK" add <modeId>
  ```
  It marks the failure mode with the grounding template and saves checks `ck-grounded-values` and `ck-success-after-error`.

Done when `node "$PMSTACK" check "$PROJECT"` lists both checks.

## Phase 3: Read their flags and tune

```sh
node "$HELPER" "$PROJECT" "$PMSTACK" flags <modeId>
node "$PMSTACK" agreement "$PROJECT" --check ck-grounded-values
node "$PMSTACK" agreement "$PROJECT" --check ck-success-after-error
```

Northstar:

```
Every number in the reply comes from a tool (ck-grounded-values):
  t-0015 [fail] Not found in tool results: 8:00 AM | review: fail | label: fail
  t-0041 [fail] Not found in tool results: 3:00 PM | review: none | label: none
Claims success after a failed or pending call (ck-success-after-error):
  t-0002 [fail] The reply says "Done", but issue_credit returned status "pending_approval" | review: fail | label: fail
  t-0019 [fail] The reply says "booked", but schedule_technician returned status "error" | review: fail | label: fail
  ...
```

Alone, the value check catches 1 of the 3 labeled failures and the failed-call check catches 2; together they catch all 3, and neither flags a Good trace. Unreviewed flags such as t-0041 go to the reviewer to read and label.

Read every flag and sort it:

| Flag | Cause | Change |
|---|---|---|
| The reply contradicts the tool | A real problem | The reviewer labels it for the failure mode |
| A value the agent worked out, such as a total or a count of days | The value check matches exact values only | Leave it to the judge; keep the value check off "Run on every change" while this happens often |
| A value from the agent's instructions, such as opening hours | That text sits outside the tool results | Limit the check with "Only for traces where" a detail, or leave that kind to the judge |
| "Done" about an earlier action that worked | The failed-call check reads the most recent write call | Add the policy check so it knows which calls write, or leave that kind to the judge |
| A reviewer's failure the checks passed ("Check missed these failures") | A reworded fact, a dropped qualifier, or missing information | Phase 4 |

Done when every flag is a real problem the reviewer has labeled or a known false alarm with its change, and both agreement numbers are reported with their counts.

## Phase 4: Set up the output grounding AI judge

The judge covers what exact matching misses: reworded facts, dropped qualifiers, and tool information left out that changes what the customer should do next. An AI judge is a prompt that asks a model for Pass or Fail on one failure mode.

1. Mark the failure mode with the grounding template: in the studio, Tool call checks, Output grounding, "Use the AI judge template" (pick the failure mode from Phase 1). With no studio running, the helper's `add` command in Phase 2 already did it.
2. pmstack's judge prompt for that failure mode then includes the grounding checklist: every fact in the reply is backed by a tool result, every value matches the tool result, qualifiers are kept, an action is called done only when a tool result shows it done, and the reply keeps every tool result that changes what the customer should do next.
3. Give the judge the tool results and the reply. The template's default inputs are the tool calls with their results, plus what the customer and the agent said. Leave out the agent's instructions, retrieved documents, and details unless the notes show the judge needs them. The judge sees at most 12,000 characters of a trace, cut from the middle, so fewer inputs keep more of the tool results and the final reply in view.
4. Load `pmstack-build-judge` for this failure mode. It checks the label counts (at least 20 Problem and 20 Good), picks examples, pins the model, saves the judge, and runs it on the tuning set. Good examples mix the kinds of mistakes: one pending shown as done, one changed value, a clear pass, and a close call where the reply left something out.
5. Load `pmstack-test-judge` to read every disagreement with the reviewer's labels and run the final test once. Trust the judge after both numbers clear 90% (80% at the least).

For judges run outside pmstack, `$TEMPLATES/grounding-judge.md` holds the full prompt with placeholders and a filled Northstar examples block. The Northstar sample already holds a draft judge, `ck-grounding-judge`, with no results yet.

Done when the judge is saved and `pmstack-test-judge` has started.

## Phase 5: Keep it running

- Turn on "Run on every change" for each code check whose "Agrees on good traces" is at or near 100%: the toggle in the Checks tab, or `node "$HELPER" "$PROJECT" "$PMSTACK" add <modeId> ci`. `pmstack check` then runs them with the other code checks and exits 1 when a trace fails; `pmstack-regression-checks` puts them in the build and runs the judge on production samples.
- The failed-call check is fast enough to run on a reply before the customer sees it. Put it there only when it flags no good traces, and log every time it fires.

## Report to the user

```
Grounding failure mode: <name> (<n> Problem notes)
Value check: catches real failures <x>% (<a> of <b>), agrees on good traces <y>% (<c> of <d>)
Failed-call check: catches real failures <x>% (<a> of <b>), agrees on good traces <y>% (<c> of <d>)
Known false alarms: <kind: change made>
AI judge: <status>
Runs on every change: <checks>
```

## Never

- Set verdicts, notes, or labels: the reviewer owns them.
- Write `project.json` by hand while the studio runs.
- Build a grounding check before the reviewer's notes show grounding failures.

## The helper

Save as `pmstack-grounding-helper.mjs` outside the project folder. It needs Node 20 and the pmstack command line.

```js
// pmstack-grounding-helper.mjs: the two output grounding code checks and their flags.
// node pmstack-grounding-helper.mjs <project.json> <pmstack.mjs> add <modeId> [ci]
// node pmstack-grounding-helper.mjs <project.json> <pmstack.mjs> flags <modeId>
import { pathToFileURL } from "node:url";

const [projectPath, cliPath, command, modeId, ci] = process.argv.slice(2);
const { loadProjectFile, saveProjectFile } = await import(pathToFileURL(cliPath).href);
const lib = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cliPath)).href);
let p = loadProjectFile(projectPath);
const OPS = { "grounded-values": ["ck-grounded-values", "Every number in the reply comes from a tool"], "success-after-error": ["ck-success-after-error", "Claims success after a failed or pending call"] };
const ours = (c) => c.modeId === modeId && c.type === "code" && OPS[c.rule?.op];

if (command === "add") {
  p = lib.updateMode(p, modeId, { template: "grounding" }); // its AI judge gets the grounding checklist
  for (const [op, [id, name]] of Object.entries(OPS)) {
    const found = (p.checks ?? []).find((c) => ours(c) && c.rule.op === op);
    if (found) p = lib.updateCheck(p, found.id, { ci: ci === "ci" });
    else p = lib.addCheck(p, { id, type: "code", modeId, name, rule: { op, target: "output" }, when: null, failWhen: "match", ci: ci === "ci" }).project;
  }
  await saveProjectFile(projectPath, p);
  console.log(`Saved both grounding checks on failure mode ${modeId}. Runs on every change: ${ci === "ci" ? "yes" : "no"}.`);
} else if (command === "flags") {
  // Every trace each check fails, with why, and the reviewer's verdict and label for the failure mode.
  const opts = lib.checkOptions(p);
  for (const check of (p.checks ?? []).filter(ours)) {
    console.log(`${check.name} (${check.id}):`);
    for (const [id, n] of lib.normalizeAll(p)) {
      const r = lib.runCheck(check, n, opts);
      if (r.verdict !== "pass") console.log(`  ${id} [${r.verdict}] ${r.detail} | review: ${p.reviews?.[id]?.verdict ?? "none"} | label: ${lib.humanLabel(p, id, modeId) ?? "none"}`);
    }
  }
}
```
