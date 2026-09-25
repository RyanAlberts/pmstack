---
name: pmstack-find-failures
description: "Finds how an AI product fails, with a person reviewing real traces in Eval Studio. Finds or creates a trace file, sets up a pmstack project (how traces look, the product's stages, filters), starts the local studio, watches reviews as they come in, and suggests likely problems, groupings, and the next traces to read for the reviewer to accept or dismiss. Reports coverage and when new failure modes stop appearing, and helps rank failure modes by stage and severity. Use when someone has traces, logs, or conversation exports from an AI feature and wants to know how it fails, asks for an error analysis, wants help reviewing traces, or needs to start saving traces from an app."
---

# Find how your AI product fails, with Eval Studio

The reviewer reads traces and writes notes. You organize: set up the project, keep Eval Studio running, watch reviews arrive, and suggest failure modes, flags, and the next traces to read. The reviewer accepts or dismisses every suggestion. Work through the phases in order. Before and after each phase, tell the reviewer in one line what you did and what comes next.

Words used here:
- **Trace**: one full conversation or task, with every step the AI took and what the {userLabel} saw. Count traces, not messages.
- **{userLabel}**: the project's word for the product's user, from `experience.userLabel` (patient, customer, employee). Default "customer".
- **Reviewer**: the person whose judgment sets the bar, usually the product manager.
- **Failure mode**: a named, recurring way the product lets the {userLabel} down. **Success mode**: a named, recurring way it gets one stage right.

Examples use the Maple Dental booking assistant: patients book, move, or cancel appointments by text, web chat, or phone, and the assistant calls tools such as `find_slots`, `book_appointment`, and `transfer_to_staff`.

## Setup

Locate the pmstack command line. Replace `<skill-dir>` with this skill's base directory (Claude Code shows it as "Base directory for this skill" when the skill loads) and keep the quotes, since paths often contain spaces:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

`node --version` must report 20 or newer. If `PMSTACK` stays empty or Node is older, ask:

> pmstack's command line is not on this computer. How do you want to review?
> A. Use Eval Studio in your browser at https://ryanalberts.github.io/pmstack/studio/ (recommended: nothing to install)
> B. Download pmstack with `git clone https://github.com/RyanAlberts/pmstack` (needs Node 20 or newer), then continue here

On A, the reviewer loads traces in Set up. When they open the AI help drawer ("Ask AI to find more", "Group my notes with AI") and paste its prompt into this chat, answer with only the JSON the prompt asks for. Never install npm packages.

On B, clone it in the current directory, then set `PMSTACK="$PWD/pmstack/bin/pmstack.mjs"` (the paths above do not look there) and continue.

Set `FOLDER` to the directory that holds the trace file; the project lives in `$FOLDER/pmstack/`. Save the helper at the end of this file as `pmstack-helper.mjs` in a temporary directory outside `$FOLDER`, and set `HELPER` to its path.

## Rules for every phase

- The reviewer owns verdicts, notes, stages, labels, severity, and decisions. You write suggestions.
- **Studio running** means `$FOLDER/pmstack/.studio.json` names a live process. Check before any write:
  ```sh
  node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.kill(s.pid,0);console.log("running "+s.url)}catch(e){console.log(e.code==="EPERM"?"running":"stopped")}' "$FOLDER/pmstack/.studio.json"
  ```
  While it runs, the only file you write is `$FOLDER/pmstack/suggestions.json`, through the helper. Reading the project is always safe.
- **Gates**, from `experience.gate` and `experience.groupGate` (defaults 10 and 30): flags wait until `gate` traces are reviewed; mode suggestions wait until `groupGate`. Reviewed means verdict `pass` or `fail`. "Not sure yet" (`skip`) and label-only reviews (`verdict: null`) do not count.
- **Questions**: when the reviewer must choose, give 2 to 5 lettered options in plain words. When one option is better, put it first, marked "(recommended)" with its reason. Accept a single letter. When the files already answer a question, state what you found and continue.

## Phase 1: Find or create traces

1. Look before asking: `find . -maxdepth 3 \( -name "*.jsonl" -o -name "*.csv" -o -path "*pmstack/project.json" \) -not -path "*/node_modules/*"`. An existing `pmstack/project.json` means the project exists: set `FOLDER` to the directory that contains that `pmstack/` folder and go to Phase 3.
2. pmstack reads JSONL (preferred), JSON arrays, and CSV, in the common shapes: OpenAI or Anthropic chat messages, OpenAI Responses items, question and answer pairs, step logs, plain text. Only `id` is expected. Format guide: https://github.com/RyanAlberts/pmstack/blob/main/guides/trace-format.md. Traces kept in a tracing vendor (LangSmith, Langfuse, Phoenix, Braintrust) come out through its export, one row per conversation or task.
3. No traces yet: ask
   > There are no traces yet. How should we get some?
   > A. Add trace logging to the app, then collect real sessions (recommended when the product has users)
   > B. Generate test conversations now (recommended before launch)

   On B, load `pmstack-make-traces`. On A, give this brief to the coding agent that owns the app (you, when you have its code):

   > Save every AI session in this app as one trace. A trace holds the user's input, the system instructions, every model call, every tool call with its arguments and result, any documents retrieved, and the final output the user saw. Keep any logging the app already sends to a tracing vendor. Also append one JSON object per session, on one line, to `traces/traces.jsonl`, with `id`, `metadata` (channel such as sms, web, or voice; persona; user feedback; app version), `messages` (role, content, tool calls with name and arguments, tool results), `steps` for work outside the chat (retrieved documents with id, title, and text), and `output` when the result is not a chat reply (an email, an answer with citations, a list). Leave out passwords, payment details, and government ids.

   One Maple Dental trace (a single line in the file):
   ```json
   {"id":"t-0042","metadata":{"channel":"sms","persona":"existing patient"},"messages":[{"role":"system","content":"You are the scheduling assistant for Maple Dental..."},{"role":"user","content":"can I move my cleaning to friday"},{"role":"assistant","content":"","tool_calls":[{"id":"call_a1","name":"find_slots","arguments":{"date":"2026-09-25"}}]},{"role":"tool","tool_call_id":"call_a1","name":"find_slots","content":"{\"slots\":[\"09:30\",\"14:00\"]}"},{"role":"assistant","content":"Friday has 9:30 AM or 2:00 PM open. Which works?"}]}
   ```
   Put the channel in `metadata.channel` (`sms`, `voice` or `phone`, `web`): the chat view uses it to show texts on a phone-width screen with formatting symbols shown literally, calls as a timed transcript, and web chat with formatting rendered.

Done when a trace file holds at least 20 traces (100 or more is better) and the reviewer confirms they may read them.

## Phase 2: Set up the project

1. Read 5 to 10 traces spread across the file: start, middle, end, and each channel or persona. Note where the {userLabel}'s words and the AI's reply live, which steps happen behind the scenes, which tools appear, and which details vary.
2. Create the project, using the real trace file name (add `--view <id>` or `--pattern <id>` when step 1 settled them):
   ```sh
   node "$PMSTACK" import "$FOLDER/traces.jsonl" --out "$FOLDER/pmstack/project.json" --name "Maple Dental booking assistant"
   ```
3. The command guesses the view, pattern, stages, and filters. Correct `experience` in `project.json` directly (the studio is not running yet):

   | Field | Decide | Maple Dental |
   |---|---|---|
   | `userLabel` | The user word: customer, patient, employee, developer, shopper, prospect, or another | `patient` |
   | `customerGoal` | One sentence: what the {userLabel} is trying to get done | Book, move, or cancel a dental appointment without waiting for the front desk. |
   | `renderer` | How the {userLabel} saw the output: `chat` (text, web chat, calls), `email`, `document`, `answer` (with sources), `agent` (steps), `code-review`, `fields`, `list`, `layout`, `auto` | `chat` |
   | `rendererBy` | Only when some traces look different: `{ "key": "channel", "map": { "email": "email" } }` | not needed |
   | `pattern` | How the AI works: `single`, `augmented` (one call with tools), `chain`, `routing`, `parallel`, `orchestrator`, `evaluator`, `agent` | `augmented` |
   | `stages` | 3 to 6 steps of the funnel of an AI experience, in order, named in the {userLabel}'s terms | below |
   | `filters` | Details with 2 to 12 values worth filtering on | `["channel", "persona"]` |

   Stage rules: `id` is lowercase and never changes after creation (`unknown` and `start` are reserved). `label` is what the reviewer sees. `column` is one of `ask understand gather plan act check answer outcome`. `match` says which steps belong to the stage; any listed key can match: `tools` (exact tool names found in the traces), `kinds` (`user`, `assistant`, `tool_call`, `tool_result`, `retrieval`, `llm`, `tool`, `handoff`, `guardrail`, `note`), `roles`, `namePattern` (a case-insensitive pattern on the step name), `last: "assistant"` (the final reply). `{}` matches no step, so only the reviewer sets that stage. The first matching stage in order wins.

   ```json
   "stages": [
     { "id": "understand", "label": "Understand the request", "column": "understand", "match": {} },
     { "id": "handoff", "label": "Hand off when needed", "column": "plan", "match": { "tools": ["transfer_to_staff"], "kinds": ["handoff"] } },
     { "id": "lookup", "label": "Check the calendar", "column": "gather", "match": { "tools": ["find_slots", "get_patient"] } },
     { "id": "act", "label": "Book or change", "column": "act", "match": { "tools": ["book_appointment", "cancel_appointment", "reschedule_appointment"] } },
     { "id": "reply", "label": "Reply to the patient", "column": "answer", "match": { "last": "assistant" } }
   ]
   ```
4. When no view shows the output the way the {userLabel} saw it, set `"renderer": "layout"` with panels such as `"layout": [{ "label": "Patient's request", "path": "input", "as": "text" }]` (`as`: text, markdown, chat, cards, table, details, json), or load `pmstack-custom-view` for a view written in code.
5. Run `node "$PMSTACK" validate "$FOLDER/pmstack/project.json"` and fix every error it prints until it exits 0.
6. Tell the reviewer your choices in 3 to 5 lines (user word, view, stages, filters), then ask:
   > A. Looks right: open Eval Studio (recommended: every choice can change later in Set up)
   > B. Change who the user is or what they are trying to do
   > C. Change the stages
   > D. Change how traces look

Done when validate exits 0 and the reviewer picked A.

## Phase 3: Start Eval Studio and brief the reviewer

1. If the studio is running, reuse its URL. Otherwise start it in the background (in Claude Code, Bash with `run_in_background`), adding `--traces <file>` when the trace file is not `traces.jsonl`:
   ```sh
   node "$PMSTACK" studio "$FOLDER" --port 0 --open
   ```
   It prints one line, `Eval Studio: http://127.0.0.1:<port>/`, and writes the same URL to `.studio.json`, which it removes on exit.
2. Brief the reviewer from [reviewing-traces.md](reviewing-traces.md), section "Briefing".
3. If `project.batch` is null, suggest the first set of 20 (Phase 6, breadth).

Done when the reviewer confirms the studio is open.

## Phase 4: Watch reviews arrive

Run `node "$HELPER" "$FOLDER/pmstack/project.json" "$PMSTACK" watch`. It re-reads the project every 3 seconds and prints one line whenever the review count changes or a failure mode is added or redefined. In Claude Code, run it with the Monitor tool (description "reviews in <product>", `timeout_ms` 1800000) and re-arm it each time it expires while the reviewer is still working. Elsewhere, run it in the background, append its output to a log, and read new lines at the start of each turn.

On each line:
1. Run `node "$HELPER" "$FOLDER/pmstack/project.json" "$PMSTACK" status`. It prints counts, the saturation hint, re-check count, notes waiting to be grouped, coverage per detail value, the priority table, and a suggested next set, all computed by pmstack's own engine so the numbers match the studio.
2. After every 10 new reviews, coach notes in chat, following [reviewing-traces.md](reviewing-traces.md), section "Coaching".
3. Act: flags when a failure mode is new or its definition changed, grouping once `groupGate` is reached and notes are waiting (Phase 5); the next set when the current one is done (Phase 6); a report every 20 reviews (Phase 7).

Done when the reviewer stops for the day, or the saturation level is `stop` and the reviewer agrees to move on.

## Phase 5: Suggest; the reviewer decides

### Flags: traces that may show a failure mode (after `gate`)

Flags need a failure mode. Until the reviewer creates one ("+ New failure mode from this note" in the judgment panel), stay with breadth (Phase 6). Scan for a failure mode when it first appears and whenever its definition changes. The scan covers every trace not already tagged with the mode, reviewed and unreviewed: flags on traces the reviewer marked Good are the main defense against criteria drift, where the reviewer's idea of good sharpens as they read.

1. Write the scan prompt parts, each a self-contained brief with the mode, example notes, traces, and the answer format: `node "$HELPER" "$FOLDER/pmstack/project.json" "$PMSTACK" scan <modeId> "$OUT"` (`OUT` is a temporary directory).
2. Give each part to its own subagent, running different failure modes in parallel when your agent supports subagents; otherwise answer the parts yourself. Each answer is `{ "modeId": "...", "flags": [ { "traceId", "quote", "reason" } ] }`.
3. Favor recall. Dismissing a wrong flag costs the reviewer one click; a missed instance hides a failure. Keep borderline flags and say "borderline" in the reason.
4. Keep a flag only when its quote is copied exactly from one step of that trace (under 120 characters) and its reason names, in one line, what the {userLabel} experienced.
5. Append each as `{ "kind": "flag", "traceId", "modeId", "quote", "reason" }`.

A Problem review whose note fits an existing failure mode but carries none gets `{ "kind": "assign", "traceId", "modeId", "quote": "<words from the note>", "reason" }`.

### Grouping notes into failure modes (after `groupGate`)

1. Write the grouping prompt: `node "$HELPER" "$FOLDER/pmstack/project.json" "$PMSTACK" group failure "$OUT"` (`group success` for Good notes). Answer it yourself. It lists the notes without a mode, the existing modes, and the stage ids.
2. Group by what the {userLabel} experienced and by the fix it needs, following [reviewing-traces.md](reviewing-traces.md), section "Grouping notes". Maple Dental: "Wanted the front desk, got slots" and "Said call me, it kept texting" share one fix and become "Ignores requests for a person" (stage `handoff`). "Booked 9:30 before she chose a time" and "Offered 3:30, already booked" look alike but need different fixes, so they become "Books before the patient confirms" (`act`) and "Offers a time that is taken" (`lookup`).
3. Keep the total failure modes under 10. Definitions start "Fails when" (success modes: "Passes when"). Test sessions and junk go to a mode of kind `ignore` named "Not a product problem".
4. Append each as `{ "kind": "mode", "mode": { "name", "definition", "stage", "kind": "failure" }, "traceIds": [...], "reason": "<which notes, and why they belong together>" }`. The reviewer unticks notes that do not belong before accepting.

### Appending suggestions

Write new suggestions as a JSON array to a temporary file, then run `node "$HELPER" "$FOLDER/pmstack/project.json" "$PMSTACK" append <file>`. The helper keeps every existing entry unchanged, skips any trace and mode pair or mode name already suggested (dismissed ones included) or already a mode, fills `id` (`sg-<YYYYMMDDHHmmss>-<n>`), `status`, `from`, `createdAt`, and `reviewed`, and replaces the file in one step. The studio polls the file and shows new suggestions with a dashed purple border.

## Phase 6: Alternate breadth and depth

- **Breadth**: when every trace in the current set (`project.batch.items`) has a review, suggest the next 20. Start from `nextSet` in the status output, which mixes detail values and lengths and keeps at least 30% random picks. Swap in up to 5 targeted picks for gaps in `coverage` (a channel with few reviews, negative feedback, the longest conversations), keeping at least 6 random picks. Append `{ "kind": "batch", "items": [ { "traceId", "reason" } ], "reason" }` with item reasons such as "voice, not reviewed yet", "Has feedback = thumbs_down", "Random pick".
- **Depth**: when a failure mode is new or its definition changed, run its flag scan (Phase 5).
- Go broad until a new failure mode appears, go deep on it, then go broad again.
- **Re-check nudge**: when `recheck` is 5 or more, tell the reviewer: "<n> Good traces were reviewed before newer failure modes existed. Filter Review traces to Re-check to confirm them."

## Phase 7: Report coverage and saturation

After every 20 reviews, and whenever asked, report from the status output in 3 to 5 lines:

> Reviewed 42 of 170 (sms 25 of 102, web 12 of 54, voice 5 of 14). 17 problems across 5 failure modes. New in your last 20: "Books before the patient confirms". Next set leans on phone calls.

The aim is 100 reviewed traces, or until new failure modes stop appearing. Saturation level `group` means the latest notes need grouping first. Level `stop` (20 reviews in a row added no new failure mode, and nothing was renamed or redefined in that span) means say so and suggest Phase 8.

## Phase 8: Rank failure modes with the reviewer

Priority is traces x severity weight (Blocks 3, Hurts 2, Annoys 1); ties go to the earlier stage. The most common failure mode is not always the first to fix. The reviewer decides and records choices in the Funnel tab ("What to fix first") and on the Failure modes cards. For each of the top failure modes, up to 5:

1. Severity, with the recommendation drawn from the notes:
   > How badly does "Offers a time that is taken" hurt the patient?
   > A. Blocks the patient (recommended: 3 notes say the patient arrived for a slot that was not theirs)
   > B. Hurts the patient or the business
   > C. Annoys the patient
2. "Did the AI's instructions ask for this?" Answer from evidence first: find the instruction in the traces' system messages or in the app's prompt file, quote it, then ask the reviewer to confirm Yes, No, or Not sure. No suggests **Fix it now**: add the instruction first, and build a check only if it keeps failing after the fix or it is critical. Yes suggests **Build a check**. A rare, mild failure mode suggests **Keep watching**.
3. Multi-turn failure modes: ask the product the same thing in one turn. Maple Dental offered a taken Friday slot on turn 4, after the patient changed days; send the fresh message "Is Friday at 2 PM open for a cleaning?" Still fails: a knowledge or look-up problem (the calendar tool or its data). Passes: a conversation problem (it lost track of earlier turns). Run it yourself when the app runs locally; otherwise give the reviewer the one message to try. Record the result in the mode's `impact` field once the studio has stopped.

Hand off in one line each: Build a check with an AI judge: `pmstack-build-judge` (code checks are built in the Checks tab). An answer bot whose failures start at the look-up stage: `pmstack-check-sources`. Fixes shipped: `pmstack-regression-checks`.

## Runs without a person

With nobody to answer (`claude -p`, `codex exec`, a scheduled job): run Phases 1 and 2 taking the recommended option at every question, and list each choice. Smoke-test the studio: start it with `--port 0` in the background, read the URL, confirm `curl -s "<url>api/info"` returns `"mode":"folder"`, stop the process, and confirm `.studio.json` is gone. Print the command that starts it later. Report that no review has happened: the review loop needs a person.

## Never

- Set a verdict, write or edit a note, pick a stage, or write a label.
- Write `project.json` by hand while the studio runs.
- Flag traces before `gate`, or suggest failure modes before `groupGate`.
- Present flag counts as failure rates. Rates come from the reviewer's reviews.

## The helper

Save as `pmstack-helper.mjs` outside `$FOLDER`. It needs Node 20 and the pmstack command line.

```js
// pmstack-helper.mjs: status, watch, AI help prompts, and safe writes to suggestions.json.
// node pmstack-helper.mjs <project.json> <pmstack.mjs> status | watch | scan <modeId> <outDir>
//   | group failure|success <outDir> | append <new-suggestions.json>
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [projectPath, cliPath, command, arg, outDir] = process.argv.slice(2);
const readJson = (file, empty) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : empty);
const isReviewed = (r) => r?.verdict === "pass" || r?.verdict === "fail";

if (command === "watch") {
  // Read-and-compare loop: one line per change in reviews, or when a failure mode is added or redefined.
  let last = "";
  setInterval(() => {
    let p;
    try { p = JSON.parse(readFileSync(projectPath, "utf8")); } catch { return; }
    const done = Object.entries(p.reviews ?? {}).filter(([, r]) => isReviewed(r));
    const modes = (p.modes ?? []).filter((m) => m.kind === "failure");
    const modesEdited = modes.map((m) => m.definitionUpdatedAt ?? m.createdAt ?? "").sort().at(-1) ?? "none";
    const state = `reviewed=${done.length} problems=${done.filter(([, r]) => r.verdict === "fail").length} failureModes=${modes.length} modesEdited=${modesEdited}`;
    if (state === last) return;
    last = state;
    const newest = done.sort(([, a], [, b]) => (a.at < b.at ? 1 : -1))[0]?.[0] ?? "none";
    console.log(`${state} lastEdited=${newest}`);
  }, 3000);
} else if (command === "append") {
  // Keep existing entries untouched; skip anything already suggested, dismissed, or already a mode.
  const project = readJson(projectPath, {});
  const file = join(dirname(projectPath), "suggestions.json");
  const current = readJson(file, { suggestions: [] });
  const key = (s) => (s.kind === "batch" ? null : s.kind === "mode" ? `mode:${s.mode.name.toLowerCase()}` : `${s.traceId}:${s.modeId}`);
  const seen = new Set([...(project.suggestions ?? []), ...current.suggestions].map(key).filter(Boolean));
  for (const m of project.modes ?? []) seen.add(`mode:${m.name.toLowerCase()}`);
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const createdAt = new Date().toISOString();
  const before = current.suggestions.length;
  for (const s of readJson(arg, [])) {
    const k = key(s);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    const reviewed = s.traceId ? { reviewed: isReviewed(project.reviews?.[s.traceId]) } : {};
    current.suggestions.push({ ...s, ...reviewed, id: `sg-${stamp}-${current.suggestions.length + 1}`, status: "open", from: "agent", createdAt });
  }
  writeFileSync(`${file}.tmp`, JSON.stringify(current, null, 2));
  renameSync(`${file}.tmp`, file); // one-step replace, so the studio never reads half a file
  console.log(`Added ${current.suggestions.length - before} suggestion(s).`);
} else {
  const { loadProjectFile } = await import(pathToFileURL(cliPath).href);
  const lib = await import(new URL("../docs/studio/lib/index.mjs", pathToFileURL(cliPath)).href);
  const p = await loadProjectFile(projectPath);
  if (command === "status") {
    const s = lib.reviewStats(p);
    console.log(JSON.stringify({
      reviewed: s.reviewed, total: s.total, problems: s.fail, notSure: s.skip, needsNote: s.needsNote,
      saturation: lib.saturationHint(p), recheck: lib.recheckQueue(p).length, notesToGroup: lib.unassignedNotes(p).length,
      coverage: lib.coverage(p),
      priority: lib.priorityTable(p).map((r) => ({ id: r.mode.id, name: r.mode.name, stage: r.mode.stage, traces: r.traces, severity: r.mode.severity ?? null, priority: r.priority })),
      nextSet: lib.nextBatch(p, { size: 20, strategy: "mix" }),
    }, null, 2));
  } else {
    const parts = command === "scan" ? lib.scanPrompt(p, arg) : lib.groupingPrompt(p, { kind: arg });
    parts.forEach((text, i) => writeFileSync(join(outDir, `${command}-${arg}-${i + 1}.txt`), text));
    console.log(`${parts.length} part(s) written to ${outDir}`);
  }
}
```
