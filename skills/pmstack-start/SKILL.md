---
name: pmstack-start
description: "Starts pmstack, which finds how an AI product fails and turns what matters into checks, and routes to the right pmstack skill. Shows the six steps (read traces, write notes, group into failure modes, count by stage, build checks, test and keep running), looks at what already exists in the folder (traces, a pmstack project, existing evals), asks at most two multiple-choice questions, then loads the matching skill. Use when someone wants help evaluating an AI product or asks about evals, traces, failure modes, AI judges, or checks for an agent's tool calls without naming a specific pmstack skill, or does not know where to start."
---

# Start with pmstack

Find where the user is in the method, name the next skill and why in one sentence, then load that skill and follow its phases in order. This skill holds routing only; the workflows live in the skills it loads.

## The method

Show this to a user who is new to pmstack, with their user word (patient, employee, shopper) in place of "customer" when you know it.

**Find how your AI product fails.**  
**Iterate. Raw pattern recognition meets Product Sense.**

**Read real traces, name the failure modes, and turn the ones that matter into checks you can trust.**

| Step | What you do | Eval Studio tab | Skill that helps |
|---|---|---|---|
| 1. Read traces | See each trace the way your customer saw it. | Review traces | `pmstack-find-failures` |
| 2. Write notes | Note the first thing that went wrong, in plain words. | Review traces | `pmstack-find-failures` |
| 3. Group into failure modes | Sort your notes into a short list of named problems, and name what went well as success modes. | Failure modes | `pmstack-find-failures` |
| 4. Count by stage | See where each failure mode starts and how often, then decide: fix it now, build a check, or keep watching. | Funnel | `pmstack-find-failures` |
| 5. Build checks | Turn each failure mode worth tracking into a code check or an AI judge. | Checks | `pmstack-build-judge`, `pmstack-check-sources`, and for agents that use tools `pmstack-tool-policy`, `pmstack-tool-relevance`, `pmstack-tool-grounding` |
| 6. Test, then keep running | Make sure each check agrees with your labels, then run it on every change. | Checks, Report | `pmstack-test-judge`, `pmstack-regression-checks` |

A **trace** is one full conversation or task, with every step the AI took and what the customer saw. A **failure mode** is a named, recurring way the product lets the customer down.

## Phase 1: Look before asking

Run these read-only checks from the working directory:

1. Trace files and projects:
   ```sh
   find . -maxdepth 3 \( -name "*.jsonl" -o -name "*.csv" -o -path "*pmstack/project.json" \) -not -path "*/node_modules/*" | head -20
   ```
2. Existing evals: folders or files named like `evals`, `*judge*`, `*eval*`, or `promptfoo*`, and scripts that score model outputs.
3. Tool calls in each trace file (the count of lines that hold one):
   ```sh
   grep -c -E '"(tool_calls|tool_use|function_call)"|"type": *"tool"' path/to/traces.jsonl
   ```
4. For each `pmstack/project.json`, read its state:
   ```sh
   node -e '
   const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
   const reviewed = Object.values(p.reviews ?? {}).filter((r) => r.verdict === "pass" || r.verdict === "fail").length;
   const modes = (p.modes ?? []).filter((m) => m.kind === "failure").map((m) => `${m.name}: ${m.decision ?? "no decision yet"}`);
   const checks = (p.checks ?? []).map((c) => c.type === "judge"
     ? `AI judge ${c.id} (${c.modeId}): ${Object.keys(c.results ?? {}).length} results, final test ${c.test ? "done" : "not run"}`
     : `code check ${c.id} (${c.modeId}): runs on every change ${c.ci ? "yes" : "no"}`);
   console.log(JSON.stringify({ product: p.experience?.product ?? p.name, reviewed, modes, checks }, null, 2));
   ' "path/to/pmstack/project.json"
   ```

Match what you found:

| What you found | Next skill |
|---|---|
| Trace files, no pmstack project | `pmstack-find-failures` |
| A project with fewer than 100 reviewed traces, no failure modes, or new ones still appearing | `pmstack-find-failures` (it picks up where the reviewer left off) |
| Failure modes marked "Build a check" (`decision: "check"`) with no check | `pmstack-build-judge` for judgment calls; a code check in the Checks tab for visible patterns |
| An AI judge whose final test has not run | `pmstack-test-judge` |
| Checks that agree with the labels, and fixes shipping | `pmstack-regression-checks` |
| Eval code or judge prompts, no pmstack project | `pmstack-evals-checkup` |
| Nothing | Phase 2 |

When one row fits, state what you found in one or two lines and go to Phase 3; the user can redirect you. When the traces hold tool calls, ask the tools question in Phase 2 first, unless the user already said what they want to check.

## Phase 2: Ask, only when Phase 1 did not decide

> Where are you with your AI product's quality?
> A. I have traces (logs or exports of real conversations or tasks) to review
> B. I have no traces yet
> C. I already have evals or checks and want to know whether to trust them
> D. I have a failure mode and want an AI judge for it
> E. I have a judge and want to test it against my own labels
> F. I want checks that run on every change
> G. Show me an example first

Put the option the evidence supports first and mark it "(recommended)" with the reason; with no evidence, recommend A, since reading traces is the first step. On G, share the dental booking sample, https://ryanalberts.github.io/pmstack/studio/#/open/clinic-booking, and ask again.

Ask a second question only for these answers:
- B:
  > A. Generate test conversations now (recommended before launch)
  > B. Add trace logging to the app, then collect real sessions (recommended when the product has users)
- A, when the traces hold tool calls: the tools question below.
- A otherwise, when you cannot tell from the files whether the product answers questions by searching documents or shows its output in an unusual form (not chat, calls, email, answers with sources, documents, code reviews, form fields, or ranked lists): ask which fits, with "Neither" as an option.

### Agents that use tools

An agent that looks things up or changes things through tools gets three Tool call checks:

1. **Policy: Is this call allowed?** Your company's rules for which tools the agent may use, when, and with what details.
2. **Relevance: Is it the right call for what the customer asked?** Right tool, right details, no calls the request didn't need, none it skipped.
3. **Output grounding: Does the reply match what the tool returned?** No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.

> Does your agent use tools, such as looking up an account or issuing a credit?
> A. Yes, and my company has rules for what it may do with them (recommended when the agent changes money, accounts, or bookings: these rules can be written down before reading traces)
> B. Yes, and I want to know whether it picks the right tool for each request
> C. Yes, and I want to know whether its replies match what the tools returned
> D. Yes, and I'm not sure what to check yet
> E. No

Route A to `pmstack-tool-policy`. Route B and C through `pmstack-find-failures` first, since relevance and grounding problems are confirmed in the traces, then to `pmstack-tool-relevance` or `pmstack-tool-grounding`. Route D and E to `pmstack-find-failures`.

## Phase 3: Route

| Situation | Load |
|---|---|
| Has traces to review | `pmstack-find-failures` |
| No traces; generate test conversations | `pmstack-make-traces` |
| No traces; add logging to the app | `pmstack-find-failures` (its Phase 1 gives the logging brief) |
| An answer bot that searches documents | `pmstack-find-failures` first, then `pmstack-check-sources` |
| Output that looks like none of chat, calls, email, answers with sources, documents, code reviews, form fields, or ranked lists | `pmstack-custom-view`, then `pmstack-find-failures` |
| A failure mode ready for an AI judge | `pmstack-build-judge` |
| A judge to validate | `pmstack-test-judge` |
| Existing evals to review | `pmstack-evals-checkup` |
| Checks that run on every change | `pmstack-regression-checks` |
| Company rules for an agent's tool calls | `pmstack-tool-policy` |
| An agent that picks the wrong tool or passes wrong details | `pmstack-find-failures` first, then `pmstack-tool-relevance` |
| An agent whose replies don't match what its tools returned | `pmstack-find-failures` first, then `pmstack-tool-grounding` |

1. Say which skill and why in one sentence: "You have 212 traces in traces/traces.jsonl and no project yet, so I'm starting error discovery."
2. Load it. In Claude Code, use the Skill tool (the plugin lists it as `pmstack:pmstack-find-failures`; the slash command is `/pmstack:find-failures`). An agent without skill loading reads `<skill-dir>/../pmstack-find-failures/SKILL.md`, where `<skill-dir>` is this skill's base directory.
3. Follow the loaded skill from its first phase, in order.

## Multiple-choice questions

Every pmstack skill asks this way:
- 2 to 5 lettered options (the first routing question may have up to 7), each in plain words a person with no context understands.
- When one option is better, put it first, marked "(recommended)" with a short reason drawn from what you found.
- One question at a time. Accept a single letter or a sentence.
- Skip a question the files already answer: say what you found and continue.
- Ask for free text only when no options can capture the answer, such as a product name.

## Never

- Build checks or judges before error discovery: failure modes come from reading traces, and generic qualities such as "helpfulness" measure the wrong things. The one exception is a company's policy rules for tool calls, which `pmstack-tool-policy` writes down first.
- Run a workflow from memory in place of loading its skill.
