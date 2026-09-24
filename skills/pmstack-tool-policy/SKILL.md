---
name: pmstack-tool-policy
description: Writes and tests a tool policy for an AI agent that calls tools, meaning the company's rules for which tools it may use, when, and with what details. Covers allowlists, a yes from the user before write (mutating) actions, identity checks first, approvals and limits, and sensitive data kept out of tool calls. Gathers requirements from the policy owner with a checklist, lists the tools found in traces, writes a pmstack policy file, runs it over past traces, reviews every violation with the user, adds it as a check that runs on every code change, and shows how to call it as a guardrail before a write runs. Use when an agent's tool calls must follow company, security, or compliance rules, or when someone asks about tool permissions, allowlists, mutating actions, or enterprise policy requirements for agents.
---

# Check tool calls against your company's policy

Policy is the first of three Tool call checks, the questions pmstack asks about every tool call an AI agent makes:

1. **Policy: Is this call allowed?** Your company's rules for which tools the agent may use, when, and with what details.
2. **Relevance: Is it the right call for what the customer asked?** Right tool, right details, no calls the request didn't need, none it skipped.
3. **Output grounding: Does the reply match what the tool returned?** No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.

This skill covers policy. `pmstack-tool-relevance` and `pmstack-tool-grounding` cover the other two.

Policy rules are requirements your company already knows, so you write them down before reading traces: it is the one check pmstack builds ahead of error discovery. Then you read traces anyway (Phase 8), because traces show the rules nobody wrote down. Policy failures start at the call itself, the act stage of the funnel.

Words used here:
- **Tool call**: one request the agent sends to a tool, with the tool's name and details (arguments), plus the result the tool returns.
- **Read tool**: only looks something up. **Write tool**: changes something for the customer, such as a credit, a plan, or a visit (a mutating action).
- **Policy file**: an open JSON file (format `pmstack.policy/1`) that lists the tools and the rules. **Violation**: one call that breaks one rule, shown with a plain message and the rule's reason (`why`).
- **Policy owner**: the person who owns the company's rules for the agent (security, compliance, legal, or the support lead). **Reviewer**: the person whose judgment sets the bar in Eval Studio.

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

Examples use the Northstar Internet support agent, a made-up internet provider (sample `support-agent`: https://ryanalberts.github.io/pmstack/studio/#/open/support-agent). Its read tools are `verify_identity`, `lookup_account`, `get_bill`, `search_help_center`, and `find_technician_slots`. Its write tools are `issue_credit`, `change_plan`, `cancel_service`, and `schedule_technician`. `request_supervisor_approval` only asks a supervisor, so it counts as read.

## Setup

Locate the pmstack command line. Replace `<skill-dir>` with this skill's base directory (Claude Code shows it as "Base directory for this skill") and keep the quotes:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
TEMPLATES="$(dirname "$PMSTACK")/../templates/tool-calls"
```

It needs Node 20 or newer. If your shell forgets variables between commands, use the found paths literally. When `$TEMPLATES/policy.json` is missing, read the same files at https://github.com/RyanAlberts/pmstack/tree/main/templates/tool-calls.

If `PMSTACK` stays empty, work in Eval Studio in the browser (https://ryanalberts.github.io/pmstack/studio/). In the Checks tab, the Tool call checks panel lists the tools in the traces and offers "Start from the enterprise example", "Start from a starter policy", and "Paste or upload your policy file". Run Phases 2 and 3 with the user in chat, paste the finished file there, and review the violations the Checks tab lists (Phase 4). Never install npm packages.

Set `TRACES` to the trace file or to `<folder>/pmstack/project.json`, and `PROJECT` to the project file when one exists. Save the helper at the end of this file as `pmstack-policy-helper.mjs` in a temporary directory outside the project folder, and set `HELPER` to its path.

**Studio running** means `<folder>/pmstack/.studio.json` names a live process:

```sh
node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.kill(s.pid,0);console.log("running "+s.url)}catch(e){console.log(e.code==="EPERM"?"running":"stopped")}' "$(dirname "$PROJECT")/.studio.json"
```

While it runs, add checks through Eval Studio and leave `project.json` to the studio. The policy file is yours to write at any time.

**Questions**: when the user must choose, give 2 to 5 lettered options in plain words. When one option is better, put it first, marked "(recommended)" with its reason. Accept a single letter. When the files already answer a question, state what you found and continue.

## Phase 1: List the tools

The policy reads tool calls from traces: each call's name and details, each result, and a failed status (`"status": "error"`, or an error word in the result). If the traces hold no tool calls, stop and ask the engineers to log them, then come back.

```sh
node "$PMSTACK" policy "$TRACES" --list-tools
```

It prints each tool with its calls, the traces that use it, and a first guess at read or write (names starting with get, list, search, lookup, find, read, or verify guess read). The guess comes from the name only: Northstar's `request_supervisor_approval` guesses write, yet it only asks, so the policy lists it as read.

Done when every tool the agent calls is listed with its call count and a guess, and the user has seen the list.

## Phase 2: Gather the requirements

Open `$TEMPLATES/policy-requirements-checklist.md`. It holds 15 requirements, each with the question for the policy owner and the rule type that writes it down, then a section of requirements a rule can't check.

1. Find the owner:
   > Who decides what the agent may do with its tools?
   > A. A named person or team, such as security, compliance, or the support lead (recommended: every rule needs an owner who can say yes to it)
   > B. Me for now; I'll confirm with the owner later
   > C. Nobody yet

   On C, start from the starter rules (only listed tools, a yes before every write, identity first, no card numbers) and mark each one "to confirm".
2. Go down the checklist in order, one question at a time, with the recommendation drawn from Phase 1 and the traces:
   > Which tools may the agent call?
   > A. Only the 10 tools in the traces, and any new tool waits for a review (recommended: a tool nobody listed is a change nobody reviewed)
   > B. These 10, plus any tool the engineers add later

   > Which actions need the customer's clear yes first?
   > A. Every write tool: issue_credit, change_plan, cancel_service, schedule_technician (recommended: each one changes money or service)
   > B. Only cancel_service, which can't be undone
3. Limits, amounts, and lists of allowed values need the owner's own words: ask for the number or the list and the reason behind it ("Credits over $50 need a supervisor").
4. Record each answer as a rule with its `why` in the owner's words, as "does not apply", or as "to confirm with <owner>".
5. For each requirement in "Requirements a rule can't check", record who checks it: the right tool for the request goes to `pmstack-tool-relevance`; a reply that must match the tool results goes to `pmstack-tool-grounding`; the rest go to an AI judge, a code check on the reply, or the company's own systems, as the checklist says.

Done when all 15 checklist items have an answer and every requirement a rule can't check names who checks it.

## Phase 3: Write the policy file

Start from `$TEMPLATES/policy-starter.json` for a first policy, or copy rules from `$TEMPLATES/policy.json`, which shows every rule type with a reason. Write `pmstack/policy.json` beside the project, or where the user asks. When engineers will run it on every change, keep a copy in the product's repository (`evals/policy.json`).

The top of the file sets `"onlyListedTools": true`, the words that count as yes (`confirmationPatterns`), and `tools`: each tool with `"access": "read"` or `"write"`, plus `"confirm": true` (Ask before acting) and `"maxPerTrace": 1` (At most N times per conversation) where the owner asked for them. Then `rules`, each with an `id`, a `type`, a `why`, and the fields below:

| Plain label | `type` | Fields | Northstar rule |
|---|---|---|---|
| Never use these tools | `deny-tools` | `tools` | `never-delete`: no `delete_account` or `run_sql` |
| No write actions | `deny-access` | `access`, usually `when` | `no-writes-by-text`: no account changes over text message |
| Do this first | `requires-before` | `tools`, `before` | `verify-first`: `verify_identity` before any account tool |
| Needs approval above a limit | `approval-above` | `tools`, `argPath`, `max`, `approvalTool` | `credit-approval`: credits over $50 need `request_supervisor_approval` |
| Stay under a limit / Stay above a limit | `arg-max` / `arg-min` | `tools`, `argPath`, `max` or `min` | `credit-cap`: no credit above $200 |
| Only these values | `arg-in` | `tools`, `argPath`, `values` | `plan-names`: basic, plus, or gig |
| Never include this pattern | `arg-not-match` | `tools`, `pattern`, optional `argPath` | `no-card-numbers`: no card number in any call |
| Must include | `arg-required` | `tools`, `argPath` | `writes-name-account`: every change names the account |
| Must match | `arg-equals` | `tools`, `argPath`, `source` | `same-account`: the account the customer verified |

How the rules read a trace:
- `"tools": "*"` means every tool. `"when": { "path": "metadata.channel", "equals": "sms" }` limits any rule to traces with that detail.
- Ask before acting passes when the customer's most recent message before the call matches one of `confirmationPatterns` (any capitalization) and comes after the agent's message that proposed the action.
- Do this first counts any earlier call that succeeded or is still waiting. Needs approval above a limit counts only an approval call that went through, so a pending approval still leaves the call in violation.
- Must match compares the value at `argPath` with the most recent earlier successful call to `source.tool` (at `source.path`), or with a trace detail (`"source": { "detail": "metadata.account_id" }`).
- Never include this pattern reads every detail of the call when `argPath` is left out. Patterns are JavaScript regular expressions, written with doubled backslashes in JSON.

Each violation prints its rule's `why`, so write the `why` for the person who reads the violation.

Done when every rule has a `why` and the Phase 4 command runs without exit code 2 (a broken policy file exits 2 and lists each problem in plain words).

## Phase 4: Run it on past traces and review every violation

```sh
node "$PMSTACK" policy "$TRACES" --policy pmstack/policy.json
```

It groups violations by rule, with the trace id, the step id, and what happened, and ends with a line like "Breaks the policy in 19 of 45 traces". Exit code 0 means no violations, 1 means some, 2 means a file could not be read. Add `--json` for the full results.

Go through every violation with the user. Each one is a real problem or a rule to fix:

| What you see | Cause | Change |
|---|---|---|
| Only listed tools flags a tool the agent should use | The policy left the tool out | Add it under `tools` with its access |
| Ask before acting flags a clear yes ("sure, book it") | The customer's words are missing from `confirmationPatterns` | Add the phrase |
| A rule flags a call the owner allows | The rule is too broad | Narrow it with `tools` or `when` |
| Must match flags a signed-in web chat | The account comes from the session, not from a lookup | Use `source.detail`, with `when` for that channel |
| The owner agrees the call broke the rule | A real problem | Keep the rule; the reviewer labels the trace |

Northstar's first draft broke the policy in 19 of 45 traces:
- 6 traces broke Only listed tools with `find_technician_slots`, a read tool that lists open visit times. The draft left it out. Adding `"find_technician_slots": { "access": "read" }` brought the count to 13 of 45.
- t-0042 is a real problem: the agent asked for approval, got `pending`, and issued the $90 credit anyway ("issue_credit called with amount 90 while request_supervisor_approval was still pending").
- t-0023 is a real problem the reviewer missed. Sam marked it Good because the bill was explained line by line, but the caller read out a full card number and the agent passed it to `verify_identity`. A rule catches what the customer never sees.

Labels belong to the reviewer: show them the trace ids to label in Eval Studio.

Done when every violation is marked real or fixed, a rerun shows only real problems, and the owner has seen the count per rule.

## Phase 5: Add the policy check to the project

- **Studio running**: Checks tab, Tool call checks, Policy, "Paste or upload your policy file". Link it to an existing failure mode or create "Breaks a tool policy", then turn on "Run on every change".
- **No studio running**:
  ```sh
  node "$HELPER" "$PROJECT" "$PMSTACK" pmstack/policy.json ci
  ```
  It creates the failure mode "Breaks a tool policy" at the first act stage (or reuses the one marked with the policy template), saves check `ck-tool-policy` with the policy inside the project, and turns on "Run on every change". To link an existing failure mode instead, pass its id before `ci`. Run it again whenever the policy file changes, so the project's copy stays the same.

Then compare the check with the reviewer's labels:

```sh
node "$PMSTACK" agreement "$PROJECT" --check ck-tool-policy
```

A failure mode created after reviews starts with few labels: Good traces reviewed before it existed wait under Re-check in Review traces until the reviewer confirms them. "Check flagged these good traces" lists rules to fix or labels to revisit (Northstar's t-0023). "Check missed these failures" lists rules the policy lacks (Phase 8).

Done when `node "$PMSTACK" check "$PROJECT"` lists the policy check.

## Phase 6: Run it on every code change

`pmstack policy` exits 1 when any call breaks the policy, and `pmstack check` runs the policy check with the other code checks and exits 1 when a trace fails. Either can stop a build.

- **With the regression set** (the usual case): export the checks that run on every change, including the policy check, then check the traces the build replays through the product:
  ```sh
  node "$PMSTACK" checks "$PROJECT" --out evals/checks.json
  node "$PMSTACK" check evals/checks.json --traces fresh.jsonl
  ```
  `pmstack-regression-checks` writes the replay script and the full GitHub Actions workflow.
- **The policy alone**, as one more step in that workflow:
  ```yaml
      - name: Check tool calls against the policy
        run: node "$RUNNER_TEMP/pmstack/bin/pmstack.mjs" policy "$RUNNER_TEMP/fresh.jsonl" --policy evals/policy.json
  ```

Run the policy on a sample of production traces each day too. A violation in production is an incident to read, trace by trace.

Done when the build file has the step and a local run of the same command gives the exit code you expect on current traces.

## Phase 7: Stop a bad call before it runs

The policy check is plain JavaScript with no dependencies, so a Node service can call it as a guardrail before a write runs. Copy pmstack's engine folder, `$(dirname "$PMSTACK")/../docs/studio/lib/`, into the service (here `vendor/pmstack-lib/`), with the policy file beside the guardrail:

```js
// policy-guard.mjs: check one tool call against the policy before it runs.
import { readFileSync } from 'node:fs';
import { normalizeTrace, evaluatePolicy } from './vendor/pmstack-lib/index.mjs';

const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
// Only rules that flagged no good trace in Phase 4.
const GUARD_RULES = ['confirm', 'verify-first', 'same-account', 'credit-approval', 'credit-cap', 'no-card-numbers'];

export function checkToolCall(conversation, call) {
  const messages = [...conversation.messages, { role: 'assistant', content: '', tool_calls: [call] }];
  const trace = normalizeTrace({ id: conversation.id, metadata: conversation.metadata, messages });
  const callStep = `m${messages.length - 1}.c0`; // the new call; earlier calls already ran
  const { violations } = evaluatePolicy(policy, trace, { ruleIds: GUARD_RULES });
  const blocking = violations.filter((v) => v.stepId === callStep);
  return { allowed: blocking.length === 0, reasons: blocking.map((v) => v.message) };
}
```

In the agent loop, before running a tool:

```js
const check = checkToolCall(conversation, call);
if (!check.allowed) {
  logger.warn({ event: 'policy_block', trace: conversation.id, tool: call.name, reasons: check.reasons });
  return { status: 'error', error: 'blocked_by_policy', reasons: check.reasons }; // becomes the tool result
}
```

The agent then sees a failed call with the reason, so it can ask for a yes or request approval, and the grounding checks catch a reply that claims success anyway.

Every block stops a customer, so a guardrail needs a very low false alarm rate. `GUARD_RULES` lists only rules whose Phase 4 violations were all real problems; the derived rules are named `only-listed`, `confirm`, and `max-per-trace`. Log every block and read the log each week.

Done when a test in the service shows a known bad call blocked and a known good call allowed. Northstar: `issue_credit` for $80 with no approval is blocked; `issue_credit` for $40 on the verified account after the customer's yes is allowed.

## Phase 8: Read traces for the rules nobody wrote down

The policy covers what the owner listed. Run `pmstack-error-discovery` on traces with tool calls, and compare the reviewer's Problem notes with the policy: a note that describes a call the company would forbid, on a trace the policy passes, is a missing rule.

Northstar: Sam's note on t-0011 reads "Lookup showed the Lakeview outage, back by 6 PM today. It booked a tech for tomorrow anyway." The support lead agreed that agents never book a visit during a known outage. No rule type reads one tool's result to block another tool, so this became its own failure mode, "Sends a technician during a known outage", with the decision "Fix it now": add the instruction to the agent's prompt.

Each gap becomes a new rule (back to Phase 3), an instruction to add, or a requirement a rule can't check (Phase 2, step 5).

Done when every Problem note on a trace the policy passed has been sorted: a policy gap with its new rule, instruction, or owner, or no policy gap.

## Report to the user

```
Policy: <file path>, <n> rules from <owner>
Past traces: breaks the policy in <a> of <b> traces; top rules: <rule: count>
Rules fixed after review: <one line each>
Check: <check id> on "<failure mode>", runs on every change: <yes or no>
Guardrail: <rules in it, or not set up>
Not covered by rules: <requirement: who checks it>
```

## Never

- Set verdicts, notes, or labels: the reviewer owns them.
- Write `project.json` by hand while the studio runs.
- Put a rule in the guardrail before its violations on past traces were all real problems.

## The helper

Save as `pmstack-policy-helper.mjs` outside the project folder. It needs Node 20 and the pmstack command line.

```js
// pmstack-policy-helper.mjs: add or update the policy check in a pmstack project.
// node pmstack-policy-helper.mjs <project.json> <pmstack.mjs> <policy.json> [modeId] [ci]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [projectPath, cliPath, policyPath, ...rest] = process.argv.slice(2);
const ci = rest.includes("ci");
const modeArg = rest.find((a) => a !== "ci");
const { loadProjectFile, saveProjectFile } = await import(pathToFileURL(cliPath).href);
const lib = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cliPath)).href);

const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const valid = lib.validatePolicy(policy);
if (!valid.ok) throw new Error(`${policyPath} has problems:\n${valid.errors.join("\n")}`);

let p = loadProjectFile(projectPath);
let modeId = modeArg ?? (p.modes ?? []).find((m) => m.template === "policy")?.id;
if (!modeId) {
  const t = lib.TOOL_CHECK_TEMPLATES.policy; // policy failures start at the call: the act stage
  ({ project: p, id: modeId } = lib.addMode(p, { name: t.name, definition: lib.withUser(t.definition, p.experience), stage: lib.templateStage(p.experience, "policy"), decision: "check" }));
}
p = lib.updateMode(p, modeId, { template: "policy" });
let checkId = (p.checks ?? []).find((c) => c.type === "policy" && c.modeId === modeId)?.id;
if (checkId) p = lib.updateCheck(p, checkId, { policy, ci });
else ({ project: p, id: checkId } = lib.addCheck(p, { id: "ck-tool-policy", type: "policy", modeId, name: "Follows the tool policy", policy, ruleIds: [], ci }));
await saveProjectFile(projectPath, p);

const run = lib.runChecks(p, { checkIds: [checkId] }).summary[0];
console.log(`Saved ${checkId} on failure mode ${modeId}. Runs on every change: ${ci ? "yes" : "no"}.`);
console.log(`Breaks the policy in ${run.fail} of ${run.pass + run.fail + run.error} traces.`);
```
