---
name: pmstack-make-traces
description: "Makes realistic test traces for an AI product that has few or no real ones: writes test requests, runs them through the product, and saves the results as traces ready to review in Eval Studio. Starts from three ways the product is likely to fail, checks 20 combinations with the user, writes one request per combination with a separate model call, drops unrealistic ones, confirms each scenario can happen in the test setup, and tags every trace with its values so Eval Studio can filter by them. Use when a product has not launched, real traces are too few to review, or someone wants to probe a known rare failure before users hit it."
---

# Make test traces

You write the {userLabel}'s side only: requests. The real product writes the replies, its trace logging records them, and the reviewer judges them later in error discovery. The target is about 100 traces. Work through the phases in order and tell the user in one line what each phase did.

`{userLabel}` is the product's user word (patient, customer, employee). Examples use the Maple Dental booking assistant, which books, moves, and cancels dental appointments by text, web chat, or phone with tools such as `find_slots`, `get_patient`, and `book_appointment`.

## Setup

Locate the pmstack command line (Phase 9 needs it). Replace `<skill-dir>` with this skill's base directory (Claude Code shows it as "Base directory for this skill") and keep the quotes:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

If none is found, the finished trace file can still be loaded in Eval Studio in the browser (https://ryanalberts.github.io/pmstack/studio/, Set up, then Add traces). Never install npm packages.

**Questions**: when the user must choose, give 2 to 5 lettered options in plain words. When one option is better, put it first, marked "(recommended)" with its reason. Accept a single letter. When the files already answer a question, state what you found and continue.

## Phase 1: Check that test traces fit

- 100 or more real, varied traces already exist: use them instead and load `pmstack-find-failures`.
- Synthetic traces fit before launch, when real traces are too few, and for probing a known rare failure.
- Tell the user once: synthetic traces show what can fail, not how often it fails in production, and they are weakest for specialist documents (medical records, legal filings) and for low-resource languages or dialects, where real examples serve better.

## Phase 2: Pick three dimensions where failures are expected

1. Gather failure guesses: ask the user where they expect the product to break, read its instructions and tool list, and read any traces or user feedback that exist.
2. Define 3 dimensions, each with a name, what it captures, and 3 to 5 values. Add a fourth only after traces show failures along a new axis.

   | Dimension | Captures | Maple Dental values |
   |---|---|---|
   | `task` | What the patient wants | book a new visit, move a visit, cancel a visit, ask about a bill, ask for a person |
   | `patient` | Who is writing | new patient, existing patient, parent booking for a child |
   | `clarity` | How complete the request is | clear day and time, missing the day, a day with no open times, out of scope |

3. Check each value against the product's instructions. When a value targets behavior the instructions never mention, fix the instructions instead of generating tests for them: drop the value for now and tell the team what instruction is missing. Maple Dental's instructions say nothing about bills, so "ask about a bill" waits until the team adds a line saying billing questions go to the front desk; add it back afterwards to confirm the fix.
4. Ask:
   > A. Use these three dimensions (recommended: each one targets a place the product may fail)
   > B. Change some values
   > C. Swap a dimension for another

Done when the user picked A.

## Phase 3: Write 20 combinations with the user

A combination picks one value per dimension; each becomes one test request. Write 20 by hand. Use every value at least once, and include the combinations most likely to fail (out of scope, a day with no open times, a parent booking for a child). Show them as a numbered table and ask:

> Which of these never happen for your product?
> A. All 20 are realistic
> B. Drop some: reply with their numbers

Done when the user confirms the list.

## Phase 4: Expand to about 100 combinations

- Small space (a full cross product under about 150): list every combination with code, drop the impossible ones using the user's rules (Maple Dental: a new patient has no visit to move or cancel), then sample about 100 so every value still appears.
- Large space: ask a model for 10 new combinations at a time, giving it the dimensions, their allowed values, and the approved 20; reject duplicates and values outside the lists.
- Save one line per combination to `synthetic/requests.jsonl`, with an id: `{"id":"syn-001","task":"move a visit","patient":"parent booking for a child","clarity":"missing the day","channel":"sms"}`. When the product has channels, spread combinations across them and record `channel`.

## Phase 5: Write one request per combination

1. Tell the user how many model calls this takes and which model, then start.
2. Make one model call per combination: a single call that writes many requests repeats itself. Use subagents, or a loop over any command that reads a prompt on standard input, such as `claude -p --model <exact model id>`.
3. Prompt for each call:
   ```text
   You write one message that a real person sends to <product>: <one-line description>.
   The person: <patient>. What they want: <task>. How clear they are: <clarity>. Channel: <channel>.
   Write only their message, the way they would type or say it. Real messages are often short and casual, and some have typos.
   A message from a different situation, for style only: "hi do u have anything tues after 3 for a cleaning"
   Return JSON only: {"request": "..."}
   ```
4. Add `request` to the combination's line. Write requests only. The product writes the reply, and the reviewer decides whether it was good.

## Phase 6: Filter

1. Read every request. Regenerate any that read as unrealistic, do not match their combination, or nearly repeat another request.
2. Show the user 10 random requests and ask:
   > A. These read like real patients
   > B. Too formal or too tidy
   > C. Too similar to each other
   > D. Something else

Done when the user picked A and every line has a request.

## Phase 7: Confirm each scenario can happen

A request only tests its scenario when the test setup makes the scenario real:
- "a day with no open times" needs a day with no open slots in the test calendar, so `find_slots` returns nothing for it;
- "existing patient" needs a matching record for `get_patient`;
- "move a visit" needs an appointment to move.

Check each combination with code where you can (call the tool or query the test data), add missing test data, or drop the combination. Record the assumption on the line: `"assumes": "2026-09-25 has no open slots"`.

## Phase 8: Run the requests through the product

1. Send each request as the {userLabel}'s first message through the real product (a local server, staging, or the team's test script) with trace logging on; the trace format is in `pmstack-find-failures`, Phase 1. Make the run script reuse the request's `id` as the trace `id`. Follow-up turns need a simulated user, which is harder to make realistic, so start with first turns.
2. Every trace carries its dimension values in `metadata`, plus `"source": "synthetic"`. When the logging cannot add them, merge them after the run:
   ```sh
   node -e '
   const fs = require("fs");
   const [tracesFile, requestsFile] = process.argv.slice(1);
   const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
   const values = new Map(lines(requestsFile).map(({ id, request, assumes, ...dims }) => [id, dims]));
   const merged = lines(tracesFile).map((t) => values.has(t.id) ? { ...t, metadata: { ...t.metadata, ...values.get(t.id), source: "synthetic" } } : t);
   fs.writeFileSync(tracesFile, merged.map((t) => JSON.stringify(t)).join("\n") + "\n");
   ' traces/traces.jsonl synthetic/requests.jsonl
   ```
3. Count traces per dimension value; every value should appear in at least 5 traces.

Done when about 100 traces exist, each with its dimension values in `metadata`.

## Phase 9: Load the traces into pmstack

`FOLDER` is the directory that holds the trace file (here `traces/`).

1. New project: `node "$PMSTACK" import "$FOLDER/traces.jsonl" --out "$FOLDER/pmstack/project.json" --name "Maple Dental booking assistant"`. Existing project: add `--append` (traces already there are skipped).
2. Add the dimension names to `experience.filters` (edit `project.json` while no studio is running, or use Set up in Eval Studio), so the reviewer can check whether a failure clusters in one kind of scenario.
3. Run `node "$PMSTACK" validate "$FOLDER/pmstack/project.json"` until it exits 0.
4. Load `pmstack-find-failures` and continue from its Phase 2, skipping step 2 (the project already exists): read the traces in step 1, then correct `experience` from step 3 on.

## Never

- Write the product's replies, expected answers, or verdicts.
- Keep a combination the test setup cannot trigger.
- Install npm packages.
