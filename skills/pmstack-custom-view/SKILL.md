---
name: pmstack-custom-view
description: Makes Eval Studio draw each trace the way the user saw it when no built-in view fits. Chooses between a panel layout in the product setup and a custom view file in pmstack/renderers/, writes it, and confirms it renders in the studio. Use when traces look like raw fields in Review traces, or when the product's output is not a chat, text message, phone call, email, document, answer with sources, agent steps, code review, form fields, or ranked list.
---

# Build a custom view of a trace

A reviewer can only judge what they can see. The view shows each trace the way the customer saw it, so the reviewer notices what the customer noticed: a raw `**` in a text message, a wrong price on a product card, a slide with overflowing text.

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

## Find the pmstack tool

`<skill-dir>` is this skill's base directory: the folder holding this SKILL.md, which your agent receives when it loads the skill. Run:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

It needs Node 20 or newer. If your shell forgets variables between commands, use the found path literally. If no path is found, send the user to https://ryanalberts.github.io/pmstack/studio/: its Set up tab offers every built-in view and "Build your own view" (the panel layout). Custom view files need the local studio. Never install npm packages.

## Guardrails

- While the studio runs (`pmstack/.studio.json` names a live process), change the product setup in the studio's Set up tab, not in `project.json`. Check with:

```sh
node -e 'try{process.kill(JSON.parse(require("fs").readFileSync("pmstack/.studio.json","utf8")).pid,0);console.log("studio running")}catch{console.log("studio not running")}'
```

- When you edit `pmstack/project.json` with the studio stopped, add 1 to `revision`, update `updatedAt`, and run `node "$PMSTACK" validate pmstack/project.json` afterwards.
- Claim a view works only after you have seen it render.

## Phase 1: Read the traces

Read 5 to 10 traces that differ: short and long, each channel or product line, one with an error. For each, write down:

- What the customer actually saw, and in what form (a text bubble, a product card, a slide, a calendar invite, a filled form).
- Which fields change from trace to trace and which stay the same.
- Which details a reviewer would want to filter on (channel, plan, language, product line).
- Which internal steps explain the output (search results, tool calls and their results).

Phase 1 is done when you can describe, in one sentence per trace, what the customer saw.

## Phase 2: Choose the smallest thing that works

| Situation | Use |
|---|---|
| A built-in view matches: chat (text, web chat, phone calls), email, document, answer with sources, agent steps, code review, form fields, ranked list | Set `experience.renderer` to it and stop |
| Different traces need different built-in views (calls and texts, for example) | `experience.rendererBy`: `{ "key": "channel", "map": { "email": "email" } }` |
| The trace is a few fields, each fine as text, formatted text, chat, cards, a table, details, or structured data | A panel layout (Phase 3a) |
| The customer saw something panels cannot draw: a styled card, a slide, an image with overlays, two items side by side | A custom view file (Phase 3b) |

Phase 2 is done when you have picked one row and can say why the row above it falls short.

## Phase 3a: Write a panel layout

Set `experience.renderer` to `"layout"` and list the panels in `experience.layout`, in reading order:

```json
"layout": [
  { "label": "Shopper's request", "path": "input", "as": "text" },
  { "label": "What the shopper saw", "path": "output.items", "as": "cards" },
  { "label": "Search results", "path": "steps[0].output", "as": "table" }
]
```

`path` points into the raw trace (dots and `[index]`). `as` is one of `text`, `markdown`, `chat`, `cards`, `table`, `details`, `json`. Each panel becomes a pickable step `panel:<i>`, so the reviewer can mark the first panel that went wrong. The studio's "Build your own view" card edits the same list with a live preview.

## Phase 3b: Write a custom view file

Write `pmstack/renderers/<id>.mjs`. The id matches `^[a-z0-9][a-z0-9-]{0,40}$`, such as `slide-card`. Then set `experience.renderer` to `"custom:<id>"`, or name it in a `rendererBy` map. Custom views load only in the local studio.

Read these before writing, so you match the real contract:

- `$(dirname "$PMSTACK")/../docs/studio/renderers/common.mjs`: the shared pieces and their props.
- One built-in view close to your case in the same folder, such as `list.mjs` or `chat.mjs`.
- `examples/quickstart/pmstack/renderers/sms-card.mjs` in the pmstack repository, when available: a complete custom view.

The contract:

- Export the component as the module's default export.
- Import only from `pmstack/ui` (`html`, hooks, small components), `pmstack/renderers/common`, and `preact/hooks`. No other imports, no network requests, no remote images.
- Props: `{ trace, experience, showHidden, pickedStepId, onPickStep, highlights, stepBadges, retrieval, onRetrieval, compact }`. Every callback may be missing; with no `onPickStep`, draw no pick button.
- `stepBadges` is `{ [stepId]: [{ tone, text }] }`, such as a policy check's "Breaks policy: Ask before acting". Draw each step's badges next to it with `StepBadges` and `badgesFor` from `pmstack/renderers/common`: `<${StepBadges} badges=${badgesFor(stepBadges, step.id)} />`.
- `trace` is the normalized trace: `id`, `title`, `metadata` (flat keys like `channel`), `context` (`[{ label, value }]`), `input`, `steps` (`id`, `kind`, `role`, `name`, `text`, `data`, `status`, `stage`, `callId`, `customerVisible`, `isOutput`), and `output`. The studio draws `trace.result` itself; leave it out.
- Every element that shows a step carries `data-step-id` with that step's `id`, and shows its stage tag when `step.stage` is set.
- A step the reviewer can blame offers the shared pick button, which calls `onPickStep(step.id, step.stage)`; the picked step (`pickedStepId`) shows as picked.
- When `showHidden` is false, internal steps (system, tool calls and results, search, model steps) collapse into the shared "steps behind the scenes" expander in place. They stay one click away.
- Write markup with htm: components as `<${Comp} ...>` closed with `<//>`, `class` (not `className`), `onInput` for text fields, kebab-case SVG attributes such as `stroke-width`. Render text as text; formatted text goes through the shared `Markdown` component. Never set inner HTML.
- Style with inline `style` attributes that use the studio's color variables (`var(--surface)`, `var(--surface-2)`, `var(--ink)`, `var(--ink-2)`, `var(--line)`), so light and dark themes both work.

A minimal starting shape, before adding the shared pieces:

```js
import { html } from 'pmstack/ui';

// Draws the slide the customer saw. Every step element carries data-step-id.
export default function SlideView({ trace, pickedStepId }) {
  const out = trace.steps.find((s) => s.isOutput);
  return html`
    <article style="background: var(--surface); color: var(--ink)">
      <h4>${trace.title}</h4>
      ${out && html`
        <section data-step-id=${out.id} aria-current=${out.id === pickedStepId ? 'true' : null}>
          ${out.text}
        </section>`}
    </article>`;
}
```

Design rules:

- Show the output exactly as the customer saw it. If a text message showed `**Friday**` literally, the view shows the asterisks.
- Put details worth filtering on at the top as chips, and add their keys to `experience.filters`.
- Keep every role at full strength. System prompts and tool results often hold the bug; collapse them, never fade them.
- Draw each tool call together with its result (matching `callId`), so cause and effect sit side by side.
- Status never relies on color alone: pair color with a word or icon.

Before starting the studio, check the syntax: `node --check pmstack/renderers/<id>.mjs`.

## Phase 4: Confirm it renders

1. Run `node "$PMSTACK" validate pmstack/project.json`.
2. Start the studio in the background and read the one line it prints, `Eval Studio: http://127.0.0.1:<port>/`:

```sh
node "$PMSTACK" studio <folder> --port 0
```

3. For a custom view file, confirm the server finds it: `curl -s -o /dev/null -w "%{http_code}\n" "<url>custom/renderers/<id>.mjs"` prints `200`.
4. Open `<url>#/review/<trace-id>` for 3 of the traces from Phase 1 (encode the id with `encodeURIComponent`). With a browser tool: take a screenshot of each, read the console, and count `[data-step-id]` elements. Toggle "Show behind-the-scenes steps" (H) and click a step's "First thing that went wrong" button once.
5. Without a browser tool, give the user the URLs and ask them to look. Say plainly that you have not seen it render.
6. Stop the studio you started unless the user wants to keep reviewing.

Phase 4 is done when 3 traces render in the new view with a clean console, a `data-step-id` on every step, and a working pick button, and the "Custom view <id> could not load" notice never appears.

## Report to the user

```
View: <built-in name | layout with n panels | custom:<id>>
Why: <one line on what the customer saw that the built-in views missed>
Checked on: <3 trace ids>, <screenshots taken | not seen, user to confirm>
Filters added: <keys>
```
