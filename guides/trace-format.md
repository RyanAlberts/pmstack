# Trace format

A trace is one full conversation or task, with every step the AI took and what the customer saw. pmstack reads traces from a plain file you export from your logging tool. This guide covers the file types, every trace shape pmstack recognizes, the optional fields that make review easier, and how to map your own field names.

## Files

| File | What goes in it |
|---|---|
| `.jsonl` (best) | One JSON object per line, one trace per object. |
| `.json` | An array of traces, or `{ "traces": [ ... ] }`. |
| `.csv` | A header row, then one trace per row. Quoted cells follow the usual spreadsheet rules, and a cell that looks like JSON (such as `{"channel": "web"}`) is read as JSON. |

A project holds up to 20,000 traces. pmstack reports a broken line with its number ("Line 14: not valid JSON"), skips it, and reads the rest of the file.

## The simplest trace

Only `id` is expected, and even that is filled in when missing. Chat messages are the most common shape:

```json
{
  "id": "t-0042",
  "title": "Move my cleaning to Friday",
  "metadata": { "channel": "sms", "persona": "existing patient" },
  "messages": [
    { "role": "system", "content": "You are the scheduling assistant for Maple Dental." },
    { "role": "user", "content": "can I move my cleaning to friday", "time": "2026-09-18T15:02:11Z" },
    { "role": "assistant", "content": "Friday has 9:30 AM or 2:00 PM open. Which works?", "time": "2026-09-18T15:02:14Z" }
  ]
}
```

(In a `.jsonl` file each trace sits on one line. The examples here are spread out to read.)

## Trace ids

- pmstack reads the id from `id`, `trace_id`, `traceId`, `session_id`, or `conversation_id`, in that order.
- A trace with no id gets one made from its content, such as `t-85ada06f`. The same content always gets the same id.
- Numbers become text: `42` becomes `"42"`.
- A repeated id gets `-2`, `-3` added, and Set up warns you: the second `t-7` becomes `t-7-2`.

Keep ids stable. Your reviews, labels, and judge results point to trace ids, so a trace that comes back with the same id keeps its review.

## Shapes pmstack recognizes

Set up shows the shape it found in plain words. Each shape below parses as shown.

### Chat messages

`messages` with `role` and `content`, as above. Roles can use other common names: agent, bot, ai, and model mean the assistant; caller, customer, and human mean the user. The text can be in `content`, `text`, `message`, or `transcript`.

### Chat messages (OpenAI format)

Tool calls in `tool_calls`, with arguments as a JSON string, and results in `tool` messages:

```json
{
  "id": "t-0043",
  "messages": [
    { "role": "user", "content": "can I move my cleaning to friday" },
    { "role": "assistant", "content": null, "tool_calls": [
      { "id": "call_a1", "type": "function", "function": { "name": "find_slots", "arguments": "{\"date\": \"2026-09-25\"}" } }
    ] },
    { "role": "tool", "tool_call_id": "call_a1", "content": "{\"slots\": [\"09:30\", \"14:00\"]}" },
    { "role": "assistant", "content": "Friday has 9:30 AM or 2:00 PM open. Which works?" }
  ]
}
```

### Chat messages (Anthropic format)

Content blocks: `text`, `tool_use`, `tool_result`, and `thinking`. A user message made only of tool results is not counted as something the customer said.

```json
{
  "id": "t-0044",
  "messages": [
    { "role": "user", "content": "can I move my cleaning to friday" },
    { "role": "assistant", "content": [
      { "type": "thinking", "thinking": "Check Friday first." },
      { "type": "tool_use", "id": "toolu_1", "name": "find_slots", "input": { "date": "2026-09-25" } }
    ] },
    { "role": "user", "content": [ { "type": "tool_result", "tool_use_id": "toolu_1", "content": "{\"slots\": [\"09:30\", \"14:00\"]}" } ] },
    { "role": "assistant", "content": [ { "type": "text", "text": "Friday has 9:30 AM or 2:00 PM open. Which works?" } ] }
  ]
}
```

### OpenAI Responses items

A list of `message`, `function_call`, and `function_call_output` items, linked by `call_id`, in `items` (or `input` and `output`):

```json
{
  "id": "t-0045",
  "items": [
    { "type": "message", "role": "user", "content": "can I move my cleaning to friday" },
    { "type": "function_call", "call_id": "call_a1", "name": "find_slots", "arguments": "{\"date\": \"2026-09-25\"}" },
    { "type": "function_call_output", "call_id": "call_a1", "output": "{\"slots\": [\"09:30\", \"14:00\"]}" },
    { "type": "message", "role": "assistant", "content": [ { "type": "output_text", "text": "Friday has 9:30 AM or 2:00 PM open. Which works?" } ] }
  ]
}
```

### Question and answer pairs

One request and one result: `input` (or `question`, `prompt`) and `output` (or `answer`, `completion`). A spreadsheet with `question` and `answer` columns reads this way:

```csv
id,question,answer,metadata
c-1,Where do I park?,"There is a free lot behind the building.","{""channel"": ""web""}"
```

### Step-by-step agent log

`steps`, each with a `type`: `retrieval`, `llm`, `tool`, `handoff`, `guardrail`, or `note` (any other type counts as a tool). Add `input`, `output`, `status: "error"` for a failed step, and `documents` for a search:

```json
{
  "id": "pr-421",
  "input": "Review pull request 421",
  "steps": [
    { "type": "tool", "name": "read_diff", "input": { "pr": 421 }, "output": "2 files changed" },
    { "type": "tool", "name": "run_tests", "input": { "path": "api/" }, "output": "2 failed", "status": "error" },
    { "type": "llm", "name": "draft_review", "output": "Two tests fail in api/." }
  ],
  "output": "Requesting changes: two tests fail in api/."
}
```

Messages and steps can sit in the same trace. pmstack shows the messages first, then the steps, then the output.

### Single text

Just `text` (or `content`, `transcript`): one piece of writing to judge.

### Not recognized yet

When pmstack can't find the conversation, Set up asks three questions ("What the customer asked", "What the AI answered", "The conversation, if any") with every field path found in your file and a live preview. Your answers are saved as a field map (below).

## Fields that make review easier

| Field | What it does |
|---|---|
| `title` | The name in the trace list. Without it, pmstack uses the first thing the customer said (60 characters), then the id. |
| `metadata` | Details you can filter on and count, such as channel, persona, plan, or version. Nested objects become dotted names (`caller.plan`), and lists are joined with commas. The studio calls these details. |
| `context` | What the AI was given, shown beside the trace: an object of labeled text (`{ "Brief": "...", "CRM notes": "..." }`) or one string. |
| `input` | The request, when there are no messages. |
| `output` | What the customer finally saw. Text, or one of the typed outputs below. |
| `result` | What happened as a result: "booking made", or an object such as `{ "booked": true }`. Shown after the trace. |
| `messages[].time` | When each message was sent: a date and time such as `2026-09-18T15:02:11Z`, milliseconds since 1970, or seconds from the start of the call. Add `endTime` to show where speakers talked over each other on a call. |
| `metadata.recording` | A call recording: a path inside your trace folder (played in the studio on your computer), or a web address (shown as an "Open recording" link, never fetched on its own). |
| `stage` | On any message or step: the id of the stage it belongs to. When it names one of your stages, it overrides the stage rules in your product setup. |

## Typed outputs

Give `output` a `type` so Eval Studio draws it the way the customer saw it:

| Type | Fields | Drawn as |
|---|---|---|
| `email` | `from`, `to`, `subject`, `body` | An email with its header rows |
| `answer` | `text` with markers like `[1]`, `citations: [{ n, doc, quote }]` | An answer with numbered sources |
| `code-review` | `title`, `diff` (unified diff), `comments: [{ file, line, severity, body }]`, `summary`, `verdict` | A pull request with comments on their lines |
| `fields` | `document`, `fields: [{ name, value }]` | A source document beside the fields pulled from it |
| `document` | `title`, `body` (Markdown) | An article |
| `list` | `intro`, `items: [{ title, subtitle, details, reason }]` | Numbered cards |
| `image` | `src` (the image itself as a `data:` address, or a path in the folder), `alt` | An image |

An answer bot's trace, with the search that found its source:

```json
{
  "id": "q-001",
  "input": "How many weeks of parental leave do I get?",
  "steps": [
    { "type": "retrieval", "name": "search_policies", "input": "parental leave weeks",
      "documents": [ { "id": "hr-12", "title": "Parental leave policy", "text": "All employees receive 16 weeks of paid parental leave.", "score": 0.82 } ] }
  ],
  "output": { "type": "answer", "text": "You get 16 weeks of paid parental leave [1].",
    "citations": [ { "n": 1, "doc": "hr-12", "quote": "16 weeks of paid parental leave" } ] }
}
```

## Step ids

Every step gets an id that stays the same as long as the file doesn't change. Reviews point to them ("the first thing that went wrong was step `m3`"), and so do policy violations.

| Step | Id |
|---|---|
| Message number i (counting from 0, system messages included) | `m{i}`, such as `m3` |
| Tool call k inside message i | `m{i}.c{k}`, such as `m1.c0` |
| An Anthropic tool result block k inside message i | `m{i}.r{k}` |
| An Anthropic thinking block k inside message i | `m{i}.t{k}` |
| Step j in `steps` | `s{j}` |
| The `output` field | `out` |

When a trace has no `output` field, the last assistant message the customer saw is the output and keeps its `m{i}` id.

## Map your own field names

When your export uses its own names, add a `fieldMap` to the product setup in `pmstack/project.json`. Each value is a path into your trace, with dots for nesting and `[0]` for list items:

```json
"fieldMap": { "id": "session.key", "input": "request.text", "output": "response.text" }
```

With that map, this line becomes a question and answer pair with the id `abc-1`:

```json
{ "session": { "key": "abc-1" }, "request": { "text": "Find a gift for my sister under $50" }, "response": { "text": "Here are three picks under $50." } }
```

The map can set `id`, `title`, `input`, `output`, and `messages`. Set up writes it for you when you answer the three questions.

## Record traces from your product

If you don't log traces yet, ask your engineers to append one JSON object per conversation to a `traces/traces.jsonl` file: the messages (with tool calls and results), the final output, and the details you want to filter on. Keep any logging tool you already use; this file is for reading. `/pmstack:find-failures` in Claude Code can write this change with them.
