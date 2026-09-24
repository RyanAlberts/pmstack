# Product setup

The product setup tells Eval Studio what your product is, how a trace should look, and which stages a trace passes through. You edit it in Set up. It is saved as `experience` inside the project file (`pmstack/project.json` in your trace folder), so you or an agent can also edit it by hand. This guide covers every field.

## A full example

The Maple Dental booking assistant, one of the samples:

```json
{
  "product": "Maple Dental booking assistant",
  "userLabel": "patient",
  "customerGoal": "Book, move, or cancel a dental appointment by text or phone without waiting for the front desk.",
  "renderer": "chat",
  "rendererBy": null,
  "pattern": "augmented",
  "stages": [
    { "id": "understand", "label": "Understand the request", "column": "understand", "match": {} },
    { "id": "handoff", "label": "Hand off when needed", "column": "plan", "match": { "tools": ["transfer_to_staff"], "kinds": ["handoff"] } },
    { "id": "lookup", "label": "Check the calendar", "column": "gather", "match": { "tools": ["find_slots", "get_patient"] } },
    { "id": "act", "label": "Book or change", "column": "act", "match": { "tools": ["book_appointment", "cancel_appointment", "reschedule_appointment"] } },
    { "id": "reply", "label": "Reply to the patient", "column": "answer", "match": { "last": "assistant" } }
  ],
  "fieldMap": null,
  "layout": null,
  "filters": ["channel", "persona"],
  "reviewer": "Priya (PM)",
  "gate": 10,
  "groupGate": 30
}
```

| Field | What it sets |
|---|---|
| `product` | The product's name, shown in the studio and the report. |
| `userLabel` | Who uses the product: customer, patient, employee, shopper, developer, prospect, or your own word. The studio uses it everywhere ("Describe what the patient experienced"). Default: customer. |
| `customerGoal` | What that person is trying to do. AI judges and AI help read it. |
| `renderer` | The view: how each trace is drawn (below). |
| `rendererBy` | Optional: a different view per trace, picked by a detail such as the channel (below). |
| `pattern` | How your AI works. It sets the starting stages; see [How your AI works](agent-patterns.md). |
| `stages` | The steps of the funnel of an AI experience for your product (below). |
| `fieldMap` | Optional: where your own field names live; see the [trace format guide](trace-format.md#map-your-own-field-names). |
| `layout` | The panels for "Build your own view" (below). |
| `filters` | Details shown as filter menus in Review traces and as coverage bars in the Funnel tab. |
| `reviewer` | The person whose judgment sets the bar. |
| `gate` | How many reviewed traces before AI suggestions appear. Default 10. |
| `groupGate` | How many reviewed traces before AI can help group notes. Default 30. |
| `showHiddenDefault` | Optional, `true` or `false`: whether the steps behind the scenes (tool calls, look-ups, instructions) start shown. Without it, agent steps and code reviews start with them shown, and the other views start with them folded. |

## Views

A view draws a trace the way your customer saw it. Set `renderer` to one of these:

| Id | Name in Set up | Use it for |
|---|---|---|
| `chat` | Chat or call | Text messages, web chat, and phone calls. It adapts to `metadata.channel`: `sms` draws a phone-width text thread with formatting symbols shown as typed, `voice` or `phone` draws a timed call transcript (with the recording when there is one), and anything else draws web chat. |
| `email` | Email | An email with From, To, and Subject rows. |
| `document` | Document | A longer piece of writing, laid out like an article. |
| `answer` | Answer with sources | An answer with numbered citations and the sources behind them. You can mark which sources the answer needed. |
| `agent` | Agent steps | Every step in order, with what each tool got and returned, and failed steps marked. |
| `code-review` | Code review | A pull request diff with review comments on their lines. |
| `fields` | Form fields | Values pulled from a document, each marked "Found in source" or "Not in source". |
| `list` | Ranked list or cards | Numbered picks or results, each with its reason. |
| `layout` | Build your own view | Panels you choose (below). |
| `auto` | Automatic | Picks a view from the shape of each trace. An unknown id falls back to this. |
| `custom:<id>` | A custom view | Your own view file, on your computer only (below). |

### A different view per trace

When some traces look different to the customer (calls and texts, or emails and chats), pick the view from a detail:

```json
"renderer": "chat",
"rendererBy": { "key": "channel", "map": { "email": "email", "voice": "chat" } }
```

A trace whose `metadata.channel` is `email` uses the email view. Every other trace uses `renderer`.

## Stages

A stage is one step of the funnel of an AI experience: understand, look up, act, reply. Each failing trace is counted at the first stage that went wrong, so the stages decide how your funnel reads.

```json
{ "id": "handoff", "label": "Hand off when needed", "column": "plan", "match": { "tools": ["transfer_to_staff"], "kinds": ["handoff"] } }
```

- **`id`** never changes after you create the stage, so reviews keep pointing to it. `unknown` and `start` are reserved.
- **`label`** is what the studio shows, with the stage's number ("2 Hand off when needed"). You can rename it any time.
- **`column`** is the kind of stage (Set up calls it "Kind of stage"). It lines different products up on the same stages in the patterns picture:

| Kind of stage | The question it answers |
|---|---|
| `ask` | Did we get a usable request? |
| `understand` | Did it grasp what the customer wants? |
| `gather` | Did it pull the right facts? |
| `plan` | Did it pick a sensible approach? |
| `act` | Did it use tools correctly and safely? |
| `check` | Did its own checks catch problems? |
| `answer` | Is the reply correct, clear, and in the right tone? |
| `outcome` | Did the customer end up where they needed to be? |

### Which steps belong to a stage

`match` decides which steps of a trace belong to the stage. Each step shows its stage as a small numbered tag, and the Funnel tab counts how many traces reached each stage.

| Rule | Matches a step when |
|---|---|
| `"roles": ["user"]` | its role is one of these (user, assistant, system, tool) |
| `"kinds": ["retrieval"]` | its kind is one of these: `system`, `user`, `assistant`, `tool_call`, `tool_result`, `retrieval`, `llm`, `tool`, `handoff`, `guardrail`, `note`, `output` |
| `"tools": ["find_slots"]` | its name is exactly one of these tool names |
| `"namePattern": "^search"` | its name matches this pattern (any case) |
| `"last": "assistant"` | it is the final output the customer saw |

A step matches when any rule matches, and any listed value counts: `{ "tools": ["transfer_to_staff"], "kinds": ["handoff"] }` takes a call to `transfer_to_staff` and any handoff step. Stages are tried in order, and the first match wins. An empty `match: {}` takes no steps: that stage is set only when the reviewer picks it, which suits stages like "Understand the request" that have no step of their own. A `stage` field on a step in the trace file overrides the rules when it names one of your stages.

Set up lists the tool names found in your traces, so you can pick them instead of typing. When a stage is deleted, reviews that pointed to it move to "Unknown stage".

## Build your own view

When no view fits, set `"renderer": "layout"` and list the panels. Each panel shows one field of the trace:

```json
"renderer": "layout",
"layout": [
  { "label": "Shopper's request", "path": "input", "as": "text" },
  { "label": "Store notes", "path": "context.notes", "as": "markdown" },
  { "label": "Picks", "path": "output.items", "as": "cards" },
  { "label": "Search filters", "path": "steps[0].input", "as": "details" }
]
```

`path` points into the trace as it appears in your file, with dots for nesting and `[0]` for list items. `as` is one of:

| `as` | Shows the value as |
|---|---|
| `text` | Plain text |
| `markdown` | Formatted text (headings, lists, bold) |
| `chat` | Chat bubbles, from a list of messages |
| `cards` | A card per item, from a list |
| `table` | A table, from a list of objects |
| `details` | Labeled rows, from an object |
| `json` | The raw data, folded |

In Review traces, each panel works like a step: the reviewer can pick it as the first thing that went wrong.

## Custom views

For output no panel can show well, write a custom view: one JavaScript file in your trace folder at `pmstack/renderers/<id>.mjs`. Custom views load only when you run Eval Studio on your computer (`node bin/pmstack.mjs studio <folder>`), because the web version cannot read your folder.

The quickstart folder has a working one, [`examples/quickstart/pmstack/renderers/sms-card.mjs`](../examples/quickstart/pmstack/renderers/sms-card.mjs). It draws each text message exchange as one card, shows each reply exactly as the patient's phone got it, and counts how many texts a reply took. To try it:

1. Run `node bin/pmstack.mjs studio examples/quickstart --open`. The first run writes `examples/quickstart/pmstack/project.json`.
2. Set `"renderer": "custom:sms-card"` in that file's `experience`. The studio notices the change and reloads it.

A custom view follows the same rules as the built-in ones:

- It imports only `pmstack/ui`, `pmstack/renderers/common`, and `preact/hooks`, and draws with `html` templates (Preact with htm).
- It takes the same props: `trace` (the trace, already read into steps), `experience`, `showHidden`, `pickedStepId`, `onPickStep`, `highlights`, `stepBadges`, `retrieval`, `onRetrieval`, and `compact`. `stepBadges` is `{ [stepId]: [{ tone, text }] }`, such as a policy check's "Breaks policy: Ask before acting"; draw it next to the step with `StepBadges` and `badgesFor` from `pmstack/renderers/common`.
- Every element that shows a step carries `data-step-id` with the step's id, so the reviewer can pick it and badges land on it.
- It shows the output the way the customer saw it, never hides content by role, and keeps each tool call next to its result.

The id must use lowercase letters, numbers, and dashes. If the file fails to load, the studio says so and falls back to the automatic view. `/pmstack:custom-view` in Claude Code reads your traces, picks between panels and a custom view, writes it, and confirms it renders.

## Check your setup

```sh
node bin/pmstack.mjs validate path/to/pmstack/project.json
```

It reports, in plain sentences, reviews that point to deleted stages, reserved stage ids, broken patterns, and checks for missing failure modes.
