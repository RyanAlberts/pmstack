# Eval Studio contract for view and renderer agents

This file tells you how to plug a view (`views/*.mjs`) or a trace view (`renderers/*.mjs`) into the shell. SPEC.md section 5.6 is the source of truth; this file adds the details the shell settled on. It is for agents, not readers of the studio.

## 1. Files

- Frozen, owned by the shell: `index.html`, `app.mjs`, `ui.mjs`, `store.mjs`, `storage.mjs`, `renderers/index.mjs`, `styles/tokens.css`, `styles/base.css`. Do not edit them. If you need a change, say so in your result (`open_issues`).
- Yours: your view file, its stylesheet in `styles/` (already linked from `index.html`, in this order: renderers, welcome, setup, review, modes, funnel, checks, report), and any helper module you create next to your view.
- Placeholders marked "Placeholder so the shell runs end to end" are meant to be overwritten.

## 2. Imports

Views:

```js
import { html, useStore, useState, useKeys, useDraft, Button, Chip } from 'pmstack/ui';
import { store, updateProject, navigate, setUi, flush } from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { TraceView, defaultShowHidden } from '../renderers/index.mjs';
```

Renderers: `pmstack/ui`, `pmstack/renderers/common` (or `./common.mjs`), `preact/hooks`, and `../lib/index.mjs` for pure helpers. A custom renderer in a user's folder may import only `pmstack/ui`, `pmstack/renderers/common`, and `preact/hooks`.

Never import `app.mjs`. `store.mjs` never imports `ui.mjs`.

## 3. View components

Each view file has a default export: a component that takes `{ param }` and reads everything else from the store.

```js
export default function ModesView({ param }) {
  const project = useStore((s) => s.project);
  return html`<section class="page modes">...</section>`;
}
```

- `app.mjs` mounts the view keyed by tab, so switching tabs remounts it; changing `param` does not.
- `param` is already decoded: `#/review/t%2F42` gives `param === 't/42'`. `#/checks/<id>` gives a check id or a mode id.
- `#/setup/new` gives `param === 'new'` (the project switcher's "New project"). Treat it as "start the wizard".
- Project tabs redirect to Welcome when no project is open, except Set up.
- Every empty state ends with a "Next: <tab>" button: `html\`<${EmptyState} ... action=${{ label: 'Next: Funnel', onClick: () => navigate('funnel') }} />\``.
- `views/assist.mjs` exports `AssistDrawer({ open, onClose, mode, modeId })`. The shell mounts it once. Open it from any view with `setUi({ assistOpen: { mode: 'scan', modeId } })` or `setUi({ assistOpen: { mode: 'group' } })`; close with `setUi({ assistOpen: false })`. Do not mount a second copy.
- The help drawer opens with `setUi({ helpOpen: true })` or the `?` key.

## 4. Store

State (read with `useStore`):

```
{ ready, project, projects: [{ id, name, sample, updatedAt, traceCount, reviewed }], activeProjectId,
  storageKind: 'browser' | 'folder', folder /* /api/info or null */, saveState: 'saved' | 'saving' | 'error' | 'readonly',
  baseRevision, dirtyKeys, route: { tab, param },
  ui: { traceId, filters, showHidden, helpOpen, assistOpen, theme },
  loadError, externalChange, suggestionsPoll /* { at, error } in folder mode */, memoryOnly }
```

- `ui.filters` starts as `DEFAULT_FILTERS` from `store.mjs`: `{ status: 'all', meta: {}, modeId: null, stage: null, text: '', version: null }` (the shape `filterTraces` takes). Replace it whole: `setUi({ filters: { ...filters, status: 'recheck' } })`.
- `ui.showHidden` is `null` until the reader toggles it; then use `defaultShowHidden(viewId)` as the fallback.
- `ui.traceId` follows `#/review/<id>`; other tabs can use it to link back to the trace the reader was on.

Change the project only through `updateProject(fn, reason)`. `fn` gets the current project and returns the next one from an engine mutator. The store marks the changed top-level keys and saves 400 ms later.

```js
updateProject((p) => lib.setVerdict(p, id, 'fail', {}), 'verdict');
updateProject((p) => lib.setNote(p, id, text), 'note');
updateProject((p) => lib.addMode(p, { kind: 'failure', name, definition, stage }).project, 'add mode');
updateProject((p) => lib.acceptSuggestion(p, sid, { traceIds }).project, 'accept');
```

- Return the same project to do nothing. Never mutate the project in place and never deep-clone it; engine mutators share structure on purpose.
- When a mutator returns extra data (`{ project, id }`, `{ project, openTraceId }`), read it inside `fn` and keep it in a local variable: `let newId; updateProject((p) => { const r = lib.addMode(p, m); newId = r.id; return r.project; });`.
- Other exports: `store.get()`, `store.subscribe(fn)`, `flush()` (save now; returns a promise), `navigate(tab, param, { replace })`, `setUi(patch)`, `openProject(id)`, `openSample(id)`, `importProjectFile(text, { onClash })` (onClash resolves to `'replace'`, `'keep'`, or `null` to cancel; returns `{ ok, errors, id }`), `createProjectFrom({ name, experience, traces })`, `deleteProject(id)`, `resetSample(id)`, `getSampleIndex()` (samples/index.json, or `[]`), `projectFile(project)` (`{ filename, text }` for "Download project"), `noteBackup()` (call after the reader downloads the project), `hashFor(tab, param)`.
- Folder mode has one project. `createProjectFrom`, `importProjectFile`, `deleteProject`, `openSample`, and `resetSample` refuse there with a plain message; the wizard edits the folder project with `updateProject`.
- In folder mode with `tracesFile` set, trace changes are not written back to the trace file. Adding traces in folder mode needs its own plan; flag it if your view offers it.

## 5. Components from `pmstack/ui`

All extra props (`class`, `aria-*`, `id`) pass through on `Button` and `Chip`.

- `Button({ kind: 'primary'|'secondary'|'ghost'|'good'|'bad', size: 'sm'|'md'|'lg', icon, onClick, disabled, title, type, children })`. Icon-only buttons need `title`; it becomes the accessible name. `good` and `bad` show filled when `aria-pressed="true"` or class `is-active`.
- `Chip({ tone: 'neutral'|'good'|'bad'|'ai'|'warn', selected, onClick, title, children })`. With `onClick` it is a toggle button with `aria-pressed`.
- `StageChip({ experience, stageId, selected, onClick })`: neutral, numbered ("2 Hand off when needed"). Stages never get a color.
- `Modal({ open, title, onClose, footer, children })`, `Drawer({ open, title, side, onClose, children })`: native `dialog`, modal, Escape and backdrop close. Children render only while open. Both take `class` for sizing (for example `.checks-label-drawer { width: min(760px, 100vw); }`).
- `Tabs({ items: [{ id, label, badge }], value, onChange, label })` renders the tab buttons only; render the panel yourself.
- `Segmented({ options: [{ value, label }], value, onChange, label })`.
- `EmptyState({ icon, title, body, action })`, where `action` is a vnode or `{ label, onClick, icon }`.
- `Menu({ label, icon, items, align: 'start'|'end', kind, size, title })` (extra, built on the browser popover): items `[{ label, onClick, disabled, danger, hint, selected, icon }]` with `'divider'` between groups.
- `Icon`, `Kbd`, `Tooltip({ text, children })`, `ProgressBar({ value, max, label })`, `Spark({ values, label })`, `CopyButton({ text, label })` (text may be a function), `DownloadButton({ filename, getText, type, label, help })` (getText may be async), `FileDrop({ accept, onFile, label })` (onFile gets a `File`; use `readFile(file)`), `RendererBoundary({ fallback, children })`, `Toaster` (the shell mounts it).
- `toast(message, { action: { label, onClick }, tone: 'neutral'|'good'|'bad', sticky, timeout })` shows above open drawers.
- Helpers: `classes(...)`, `plural(n, one, many)` returns the count with the word (`plural(3, 'trace')` is "3 traces"), `formatCount(2340)` is "2,340", `download(filename, text, type)`, `copyText(text)`, `readFile(file)`, `shallowEqual`, `MOD_LABEL` (the Command symbol on Apple keyboards, else "Ctrl").

`useStore(selector, equal = Object.is)` re-renders when the selected value changes. Select small things. When the selector builds a new object, pass `shallowEqual`:

```js
const { reviewed, total } = useStore((s) => lib.reviewStats(s.project), shallowEqual);
```

## 6. Keys: `useKeys`

`useKeys` is the only way to bind shortcuts. Never add a `keydown` listener to `window` or `document`.

```js
useKeys({
  1: () => setVerdict('pass'),
  2: () => setVerdict('fail'),
  3: skip, d: skip,
  j: next, k: previous, h: toggleHidden,
  u: undo, 'mod+z': undo,
  'mod+Enter': saveAndNext,
}, { active: !!trace });
```

- Names are `KeyboardEvent.key` values (`'1'`, `'j'`, `'?'`, `'Enter'`, `'Escape'`, `'ArrowDown'`) plus `'mod+Enter'` and `'mod+z'` (Command on Apple keyboards, Ctrl elsewhere). Letters match either case. Other modifier combinations never reach you.
- The most recently activated scope is asked first. If it does not bind the key, the key passes to the scope below, except that an open `Drawer` or `Modal` stops everything below it. A labeling drawer that binds `1` and `2` therefore never marks the trace underneath.
- Inside text fields only `Escape` and `mod+Enter` arrive (`mod+z` stays the field's own undo). On buttons and links, single characters and `Enter` are left to the element.
- A handler that returns `false` keeps the browser's default action; otherwise the event is prevented.
- No global arrow-key bindings. Arrow keys inside a list (for example the trace list) belong on that element's own `onKeyDown`.

## 7. Text fields: `useDraft`

Every text field that writes to the project uses `useDraft(entityId, storeValue, commit)`.

```js
const note = useDraft(traceId, review?.note ?? '', (text) => updateProject((p) => lib.setNote(p, traceId, text), 'note'));
return html`<textarea class="review-note" value=${note.value} onInput=${note.onInput} onFocus=${note.onFocus} onBlur=${note.onBlur}></textarea>`;
```

- It keeps a local draft, commits 300 ms after typing stops and on blur, and never copies the store value back while the reader is typing.
- When `entityId` changes, it saves the old draft to the old entity and reseeds from the store.
- `commitNow()` saves immediately and returns the text. "Next trace" calls the panel's `commitNow()`, then `await flush()`, then `navigate('review', nextId)`.
- On unmount it commits what was typed.

## 8. Focus rules

- Never declare a component inside another component's body. Declare every component at module top level.
- Text fields use `useDraft`.
- The judgment panel is keyed by trace id (`<${JudgmentPanel} key=${traceId} ... />`).
- After a top bar tab click, the shell focuses `<main>` unless your view already moved focus into itself. It is safe to focus your first field in a mount effect.

## 9. Trace views

- `TraceView(props)` from `renderers/index.mjs` picks the view with `viewFor`, loads custom views in folder mode, catches errors (falls back to the automatic view with a notice), and draws `ResultPanel` after the view when `trace.result` is set. Views never draw the result themselves.
- Props (SPEC 4): `{ trace /* normalized */, experience, showHidden, pickedStepId, onPickStep(stepId, stageId), highlights, retrieval, onRetrieval, compact }`. With `showHidden` undefined, TraceView uses `defaultShowHidden(viewId)` (agent and code-review true).
- Each renderer file has a default export: the view component. `VIEW_COMPONENTS` maps ids to those defaults (a named function export is accepted as a fallback).
- `common.mjs` exports `StepCard`, `ToolCall`, `JsonBlock`, `StageTag`, `Markdown`, `Highlightable`, `MetaChips`, `ContextPanel`, `ResultPanel`, `BehindTheScenes`, `PickButton`. TraceView calls `ResultPanel({ result, compact })`; keep that signature.
- Every step element has `data-step-id`. No `innerHTML` of any kind with trace content.

## 10. CSS

- Use tokens only (`var(--surface)`, `var(--ink-2)`, `var(--space-4)`, `var(--radius)`, `var(--font-mono)`). No hex colors in view styles, no gradients (the funnel band is the only exception), no emoji.
- Prefix every class with your view id: `.welcome-*`, `.setup-*`, `.review-*`, `.modes-*`, `.funnel-*`, `.checks-*`, `.report-*`, `.assist-*`. Renderers use `.rv-*` (shared pieces) and `.rv-<view>-*` (for example `.rv-chat-bubble`, `.rv-code-review-line`).
- Base classes you can use: `.page` (max 1200 px, padded), `.page-narrow`, `.page-title`, `.page-lead`, `.card`, `.card-flat`, `.stack`, `.stack-lg`, `.row`, `.row-between`, `.grow`, `.section-title`, `.muted`, `.soft`, `.small`, `.mono`, `.num`, `.display` (Instrument Serif italic; Welcome and landing only), `.field`, `.label`, `.hint`, `.error-text`, `.input`, `.textarea`, `.select`, `.check-row`, `.table-wrap`, `.table`, `.th-button`, `.badge`, `.banner` (+ `.banner-bad`, `.banner-warn`), `.sr-only`. Bare `input`, `textarea`, and `select` are already styled.
- Color is reserved: `--good` for success, `--bad` for failure, `--warn` for the Hurts severity, dashed `--ai` only for unaccepted AI suggestions. AI judges are checks and are drawn neutral. Status is never shown by color alone: pair it with text or an icon.
- Type sizes 13/14/16/20/28/44 (`--text-xs` to `--text-2xl`). Radius 10 px for cards (`--radius`), 999 px for chips. Motion 120 to 180 ms (`--dur-fast`, `--dur`, `--dur-slow`) with `--ease`; base.css already honors reduced motion.
- Layout must fit 375 px with no horizontal page scroll. Give flex and grid children `min-width: 0`, and let wide content (tables, code) scroll inside its own box.

## 11. Icons

Names: check, x, skip, note, stage, filter, sparkle, copy, download, upload, arrow-left, arrow-right, chevron-down, help, folder, warning, person, code, judge, chat, email, doc, answer, agent, diff, fields, list, layout, phone, trash, merge, plus, search, sun, moon, auto, external, undo.

To add one, call `registerIcon(name, paths)` from `pmstack/ui` at module load in your own file. Draw on a 24 by 24 grid, stroked with round caps; the component sets the stroke width. Pass `{ d, fill: true }` for a filled shape. `Icon({ name, size = 16, label })`: with `label` the icon is announced, without it the icon is hidden from screen readers.

## 12. Preact and htm rules (linted by tests/repo.test.mjs)

- Components are written as `<${Comp} ...>` and closed with `<//>` or `</${Comp}>`. A less-than sign followed by an uppercase letter anywhere in `views/`, `renderers/`, `ui.mjs`, or `app.mjs` fails the lint, comments included. Write "a list of steps", not a generic type in angle brackets.
- SVG attributes in kebab-case (`stroke-width`, `text-anchor`, `font-size`), never the camelCase forms.
- `onInput` for text fields (file inputs too).
- `class`, never the React-style class name prop.
- Raw HTML injection (the Preact prop for setting inner HTML) is allowed only in `views/funnel.mjs`, only for `funnelSvg` output, and never with trace text.

## 13. Copy

- No em-dash glyph, no en-dash as a sentence dash, and none of the banned words from SPEC 0.1, in code, comments, or UI text.
- Use the plain words from SPEC 0.3. The UI never shows the course terms listed in 0.1; only the help drawer's "Words we use" maps plain words to course terms.
- Put the project's user word in copy with `lib.userWord(project.experience)` or `lib.withUser(text, experience)` for `{userLabel}`.
