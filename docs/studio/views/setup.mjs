// Set up tab (SPEC 5.3): the projects in this browser, the new project wizard (#/setup/new),
// and the open project's settings. Also exports the project import button and the sample
// list hook that the Welcome view uses.

import {
  html, useStore, useState, useEffect, useMemo, useRef, useCallback, useReducer, useDraft, useId,
  classes, plural, formatCount,
  Button, Chip, Modal, EmptyState, Icon, Menu, FileDrop, toast, download, readFile, registerIcon,
} from 'pmstack/ui';
import {
  store, updateProject, navigate, openProject, importProjectFile, createProjectFrom,
  deleteProject, resetSample, getSampleIndex, projectFile, noteBackup, loadProjectCopy, setLeaveGuard,
} from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { TraceView } from '../renderers/index.mjs';

const GUIDE_URL = 'https://github.com/RyanAlberts/pmstack/blob/main/guides/trace-format.md';
const WEB_STUDIO_URL = 'https://ryanalberts.github.io/pmstack/studio/';
const TRACE_ACCEPT = '.jsonl,.ndjson,.json,.csv,.txt';
const SCAN_LIMIT = 300; // traces read for previews, counts, and pickers

/** Icon for each view id. */
export const VIEW_ICONS = {
  chat: 'chat', email: 'email', document: 'doc', answer: 'answer', agent: 'agent',
  'code-review': 'diff', fields: 'fields', list: 'list', layout: 'layout', auto: 'setup-auto',
};

registerIcon('setup-auto', ['M4 4h7v7H4z', 'M17.5 4a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7z', 'M7.5 13.5l4 6.5h-8z', 'M14 14h6v6h-6z']);
registerIcon('setup-up', ['M12 19V5', 'M6 11l6-6 6 6']);
registerIcon('setup-down', ['M12 5v14', 'M6 13l6 6 6-6']);
registerIcon('setup-reset', ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v5h5']);
registerIcon('setup-copy', ['M9 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M16 8V5a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2']);

// Kinds of step a stage can match, in plain words ({user} is the project's user word).
const STEP_KINDS = [
  ['user', 'What the {user} said'],
  ['assistant', 'AI messages'],
  ['tool_call', 'Tool calls'],
  ['tool_result', 'Tool results'],
  ['tool', 'Tool steps'],
  ['retrieval', 'Document look-ups'],
  ['llm', 'Model calls'],
  ['handoff', 'Handoffs'],
  ['guardrail', 'Safety and quality checks'],
  ['note', 'Internal notes'],
  ['system', 'Instructions to the AI'],
  ['output', 'Final output'],
];

// How a panel in "Build your own view" is drawn.
const SHOW_AS = [
  ['text', 'Plain text'],
  ['markdown', 'Formatted text'],
  ['chat', 'Chat messages'],
  ['cards', 'Cards'],
  ['table', 'Table'],
  ['details', 'Label and value pairs'],
  ['json', 'Structured data'],
];

const VIEW_ORDER = ['chat', 'email', 'document', 'answer', 'agent', 'code-review', 'fields', 'list', 'auto', 'layout'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// Small helpers

const nowIso = () => new Date().toISOString();
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const say = (text, user) => String(text).split('{user}').join(user);

/** Plain label of a view id. */
export function viewLabel(id) {
  const v = lib.VIEWS.find((x) => x.id === id);
  if (v) return v.label;
  if (typeof id === 'string' && id.startsWith('custom:')) return 'Custom view ' + id.slice(7);
  return 'Automatic';
}

function patternLabel(id) {
  const p = lib.PATTERNS.find((x) => x.id === id);
  return p ? p.label : 'One model call';
}

function shortDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

function defaultVersionName(versions) {
  const d = new Date();
  return `Version ${versions.length ? versions.length + 1 : 2}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function reviewedLine(reviewed, total) {
  return `${formatCount(reviewed)} of ${formatCount(total)} reviewed`;
}

/** The state line for a sample: "100 of 170 reviewed: see every step" or "Fresh: start at trace 1". */
export function sampleStateLine(sample) {
  return sample.reviewed > 0 ? `${reviewedLine(sample.reviewed, sample.traceCount)}: see every step` : 'Fresh: start at trace 1';
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

// A local state object whose latest value can be read at once (event handlers run before a re-render).
function useLocal(init) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = typeof init === 'function' ? init() : init;
  const [, force] = useReducer((n) => n + 1, 0);
  const update = useCallback((patch) => {
    const next = typeof patch === 'function' ? patch(ref.current) : patch;
    ref.current = { ...ref.current, ...next };
    force();
  }, []);
  return [ref.current, update, ref];
}

/** The list of sample products, or null while it loads. Returns [list, retry]; [] means it could not load. */
export function useSampleIndex(active = true) {
  const [list, setList] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    getSampleIndex().then((l) => {
      if (live) setList(l);
    });
    return () => {
      live = false;
    };
  }, [active, tick]);
  const retry = useCallback(() => {
    setList(null);
    setTick((t) => t + 1);
  }, []);
  return [list, retry];
}

// What the first traces contain: step kinds, tool names, details, visible text, and stage reach.
function scanTraces(traces, experience) {
  const list = (traces || []).slice(0, SCAN_LIMIT);
  const kinds = new Map();
  const tools = new Map();
  const details = new Map();
  const reach = new Map();
  let visible = 0;
  for (const raw of list) {
    let n;
    try {
      n = lib.normalizeTrace(raw, experience);
    } catch {
      continue;
    }
    let shows = !!(n.input && n.input.trim());
    const hit = new Set();
    for (const s of n.steps) {
      kinds.set(s.kind, (kinds.get(s.kind) || 0) + 1);
      if (s.name && !['user', 'assistant', 'system', 'output'].includes(s.kind)) tools.set(s.name, (tools.get(s.name) || 0) + 1);
      if (s.customerVisible && s.text && String(s.text).trim()) shows = true;
      if (s.stage) hit.add(s.stage);
    }
    for (const id of hit) reach.set(id, (reach.get(id) || 0) + 1);
    if (shows) visible++;
    for (const [k, v] of Object.entries(n.metadata || {})) {
      if (k === 'recording') continue;
      if (!details.has(k)) details.set(k, new Map());
      const vals = details.get(k);
      const key = String(v);
      if (vals.has(key) || vals.size < 60) vals.set(key, (vals.get(key) || 0) + 1);
    }
  }
  return { n: list.length, total: (traces || []).length, kinds, tools, details, reach, visible };
}

// The most common shape among the first traces, in plain words.
function shapeLabelOf(traces) {
  const counts = new Map();
  for (const t of (traces || []).slice(0, 50)) {
    const s = lib.detectShape(t);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let shape = 'unknown';
  let best = 0;
  for (const [s, c] of counts) if (c > best) { shape = s; best = c; }
  return lib.SHAPE_LABELS[shape] || lib.SHAPE_LABELS.unknown;
}

// The shape label once the reader's field choices are applied.
function mappedShapeLabel(traces, fm) {
  if (!fm) return shapeLabelOf(traces);
  const mapped = (traces || []).slice(0, 50).map((t) => {
    const out = { ...t };
    for (const k of ['title', 'input', 'output', 'messages']) {
      if (!fm[k]) continue;
      const v = lib.getPath(t, fm[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  });
  return shapeLabelOf(mapped);
}

// True when the traces need the field-mapping menus: an unknown shape, or most traces show no text.
function needsMapping(traces, shape) {
  if (!traces.length) return false;
  if (shape === 'unknown') return true;
  const s = scanTraces(traces.slice(0, 200), null);
  return s.visible * 2 < s.n;
}

function stageUsage(project, stageIds) {
  const ids = new Set(stageIds);
  const out = { reviews: 0, failure: 0, success: 0 };
  for (const r of Object.values(project.reviews || {})) if (r && ids.has(r.stage)) out.reviews++;
  for (const m of project.modes || []) {
    if (!ids.has(m.stage)) continue;
    if (m.kind === 'success') out.success++;
    else out.failure++;
  }
  return out;
}

function listWords(parts) {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts[parts.length - 1]}`;
}

function usageSentence({ reviews, failure, success }) {
  const parts = [];
  if (reviews) parts.push(plural(reviews, 'review'));
  if (failure) parts.push(plural(failure, 'failure mode'));
  if (success) parts.push(plural(success, 'success mode'));
  if (!parts.length) return 'No reviews or failure modes use it yet.';
  return `${listWords(parts)} ${reviews + failure + success === 1 ? 'uses' : 'use'} it. Their stage becomes Unknown stage, and you can set it again later.`;
}

// Replace the stage list; reviews on removed stages become unknown and modes on them lose their stage.
function withStages(p, stages, now = nowIso()) {
  const keep = new Set(stages.map((s) => s.id));
  const gone = (id) => id != null && id !== 'unknown' && !keep.has(id);
  let reviews = p.reviews || {};
  let changed = false;
  for (const [tid, r] of Object.entries(reviews)) {
    if (r && gone(r.stage)) {
      if (!changed) { reviews = { ...reviews }; changed = true; }
      reviews[tid] = { ...r, stage: 'unknown', at: now };
    }
  }
  const modes = (p.modes || []).some((m) => gone(m.stage))
    ? p.modes.map((m) => (gone(m.stage) ? { ...m, stage: null } : m))
    : p.modes;
  return { ...p, experience: { ...p.experience, stages }, reviews, modes, updatedAt: now };
}

function tagVersion(trace, version) {
  return { ...trace, metadata: { ...(isObj(trace.metadata) ? trace.metadata : {}), version } };
}

// Which parsed traces are new (ids not in the project yet) and how many fit under the 20,000 cap.
function planAdd(project, parsed, version) {
  const have = new Set((project.traces || []).map((t) => String(t.id)));
  const fresh = [];
  let skipped = 0;
  for (const t of parsed) {
    const id = String(t.id);
    if (have.has(id)) { skipped++; continue; }
    have.add(id);
    fresh.push(t);
  }
  const room = Math.max(0, lib.MAX_TRACES - (project.traces || []).length);
  const capped = fresh.length > room ? fresh.length - room : 0;
  return { fresh: capped ? fresh.slice(0, room) : fresh, skipped, capped, version: version || null };
}

// Append new traces. With a version name the new traces are tagged; the first such import also tags
// the existing traces "Version 1" and adds version to the filters.
function addTraces(p, plan, now = nowIso()) {
  let existing = p.traces || [];
  let experience = p.experience;
  let fresh = plan.fresh;
  if (plan.version) {
    if (!lib.traceVersions(p).length) existing = existing.map((t) => tagVersion(t, 'Version 1'));
    fresh = fresh.map((t) => tagVersion(t, plan.version));
    const filters = experience.filters || [];
    if (!filters.includes('version')) experience = { ...experience, filters: [...filters, 'version'] };
  }
  return { ...p, traces: [...existing, ...fresh], experience, updatedAt: now };
}

// Start the "Build your own view" panels from the fields the traces have.
function guessLayout(traces, user) {
  const paths = new Set(lib.fieldPaths(traces));
  const first = (list) => list.find((p) => paths.has(p));
  const out = [];
  const input = first(['input', 'question', 'prompt', 'request', 'query']);
  if (input) out.push({ label: `What the ${user} asked`, path: input, as: 'text' });
  const msgs = first(['messages', 'conversation', 'turns', 'transcript']);
  if (msgs) out.push({ label: 'Conversation', path: msgs, as: 'chat' });
  const output = first(['output', 'answer', 'response', 'reply', 'completion']);
  if (output) out.push({ label: 'What the AI answered', path: output, as: 'markdown' });
  if (paths.has('metadata')) out.push({ label: 'Details', path: 'metadata', as: 'details' });
  if (!out.length) {
    for (const p of [...paths].filter((x) => x && !x.includes('.') && !x.includes('[') && x !== 'id').slice(0, 3)) {
      out.push({ label: p, path: p, as: 'text' });
    }
  }
  return out;
}

// The full project for Duplicate and Download, including one that is not open right now.
async function loadFullProject(id) {
  const project = await loadProjectCopy(id);
  return project || openProject(id);
}

function downloadFile(file) {
  download(file.filename, file.text, 'application/json');
  noteBackup();
}

// ---------------------------------------------------------------------------
// Shared small components

function FileButton({ accept, onFile, label, icon = 'upload', kind = 'secondary', size = 'md', disabled }) {
  return html`<label class=${classes('btn', 'btn-' + kind, 'btn-' + size, 'setup-filebtn', disabled && 'is-disabled')}>
    <input type="file" class="sr-only" accept=${accept} disabled=${disabled}
      onInput=${(e) => { const f = e.currentTarget.files[0]; e.currentTarget.value = ''; if (f) onFile(f); }} />
    <${Icon} name=${icon} size=${size === 'lg' ? 18 : 16} />
    <span class="btn-label">${label}</span>
  </label>`;
}

function ConfirmModal({ open, title, confirmLabel, danger = true, busy, onConfirm, onClose, extra, children }) {
  const footer = html`${extra}
    <${Button} kind="ghost" onClick=${onClose}>Cancel<//>
    <${Button} kind=${danger ? 'bad' : 'primary'} class=${danger ? 'is-active' : ''} disabled=${busy} onClick=${onConfirm}>${confirmLabel}<//>`;
  return html`<${Modal} open=${open} title=${title} onClose=${onClose} footer=${footer} class="setup-modal">
    <div class="setup-modal-body">${children}</div>
  <//>`;
}

function ErrorList({ errors, max = 6 }) {
  if (!errors || !errors.length) return null;
  const shown = errors.slice(0, max);
  return html`<ul class="setup-errors">
    ${shown.map((e, i) => html`<li key=${i}>${e}</li>`)}
    ${errors.length > max && html`<li class="muted">and ${plural(errors.length - max, 'more problem')}</li>`}
  </ul>`;
}

// A text field tied to the project: a local draft, saved 300 ms after typing and on blur.
function LiveText({ entity, value, onCommit, multiline, id, ...rest }) {
  const d = useDraft(entity, value == null ? '' : String(value), onCommit);
  if (multiline) {
    return html`<textarea id=${id} value=${d.value} onInput=${d.onInput} onFocus=${d.onFocus} onBlur=${d.onBlur} ...${rest}></textarea>`;
  }
  return html`<input id=${id} value=${d.value} onInput=${d.onInput} onFocus=${d.onFocus} onBlur=${d.onBlur} ...${rest} />`;
}

// A text field for the wizard's local draft: every keystroke updates the draft right away.
function LocalText({ value, onCommit, multiline, id, entity: _entity, ...rest }) {
  const onInput = (e) => onCommit(e.currentTarget.value);
  if (multiline) return html`<textarea id=${id} value=${value ?? ''} onInput=${onInput} ...${rest}></textarea>`;
  return html`<input id=${id} value=${value ?? ''} onInput=${onInput} ...${rest} />`;
}

function TextInput({ live, ...props }) {
  return live ? html`<${LiveText} ...${props} />` : html`<${LocalText} ...${props} />`;
}

// Card groups that act like radio buttons: arrow keys move between cards.
function cardArrows(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const move = keys[e.key];
  if (!move) return;
  const items = [...e.currentTarget.querySelectorAll('[role="radio"]:not([disabled])')];
  const i = items.indexOf(document.activeElement);
  if (i === -1) return;
  e.preventDefault();
  const next = items[(i + move + items.length) % items.length];
  next.focus();
  next.click();
}

// ---------------------------------------------------------------------------
// Import a project file (used by Set up and Welcome)

// A trace file picked by mistake in "Open a project file", handed to the new project wizard.
let wizardFile = null;

function looksLikeTraces(text, name) {
  try {
    return lib.parseTraceFile(text, name).traces.length > 0;
  } catch {
    return false;
  }
}

/** Button that imports a downloaded project file, with plain errors and a Replace / Keep both choice. */
export function ImportProjectButton({ label = 'Import project (.json)', kind = 'secondary', size = 'md', onImported }) {
  const projects = useStore((s) => s.projects);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [clash, setClash] = useState(null);

  const choose = (choice) => {
    if (clash) clash.resolve(choice);
    setClash(null);
  };

  const onFile = async (file) => {
    setBusy(true);
    try {
      const text = await readFile(file);
      const res = await importProjectFile(text, {
        onClash: (project) => new Promise((resolve) => setClash({ project, resolve })),
      });
      if (res.ok) {
        const p = store.get().project;
        toast(`Opened ${p ? p.name : 'the project'}.`, { tone: 'good' });
        if (onImported) onImported(res);
      } else if (!res.canceled) {
        const traces = store.get().storageKind === 'browser' && looksLikeTraces(text, file.name) ? file : null;
        setProblem({ file: file.name, traces, errors: res.errors && res.errors.length ? res.errors : ['This file could not be opened.'] });
      }
    } catch (err) {
      setProblem({ file: file.name, errors: [errorMessage(err)] });
    } finally {
      setBusy(false);
    }
  };

  const existing = clash ? projects.find((p) => p.id === clash.project.id) : null;
  return html`<span class="setup-import">
    <${FileButton} accept=".json,application/json" onFile=${onFile} label=${busy ? 'Opening...' : label} kind=${kind} size=${size} disabled=${busy} />
    <${Modal} open=${!!clash} title="This project is already here" onClose=${() => choose(null)} class="setup-modal"
      footer=${html`<${Button} kind="ghost" onClick=${() => choose(null)}>Cancel<//>
        <${Button} kind="secondary" onClick=${() => choose('replace')}>Replace<//>
        <${Button} kind="primary" onClick=${() => choose('keep')}>Keep both<//>`}>
      <div class="setup-modal-body">
        <p><strong>${existing ? existing.name : clash && clash.project.name}</strong> is already in this browser${existing && existing.updatedAt ? `, last changed ${shortDate(existing.updatedAt)}` : ''}.</p>
        <p class="soft">Replace puts the file's version in its place. Keep both adds the file as a copy.</p>
      </div>
    <//>
    <${Modal} open=${!!problem} title=${problem && problem.traces ? 'This looks like a trace file' : 'This file could not be opened'}
      onClose=${() => setProblem(null)} class="setup-modal"
      footer=${problem && problem.traces
        ? html`<${Button} kind="ghost" onClick=${() => setProblem(null)}>Cancel<//>
          <${Button} kind="primary" icon="arrow-right" onClick=${() => { wizardFile = problem.traces; setProblem(null); navigate('setup', 'new'); }}>Start a new project with it<//>`
        : html`<${Button} kind="primary" onClick=${() => setProblem(null)}>OK<//>`}>
      <div class="setup-modal-body">
        ${problem && html`<p class="soft mono">${problem.file}</p>
          ${problem.traces
            ? html`<p>This looks like a trace file, not a project file. Project files come from "Download project". Start a new project to review these traces.</p>`
            : html`<${ErrorList} errors=${problem.errors} max=${8} />`}`}
      </div>
    <//>
  </span>`;
}

// ---------------------------------------------------------------------------
// Who uses it

function UserPicker({ value, onChange, live, entity, id }) {
  const custom = !lib.USER_LABELS.includes(value);
  const [other, setOther] = useState(custom);
  const showOther = other || custom;
  return html`<div class="setup-user">
    <div class="setup-chips" role="group" aria-labelledby=${id}>
      ${lib.USER_LABELS.map((w) => html`<${Chip} key=${w} selected=${!showOther && value === w}
        onClick=${() => { setOther(false); onChange(w); }}>${w}<//>`)}
      <${Chip} selected=${showOther} onClick=${() => setOther(true)}>Someone else<//>
    </div>
    ${showOther && html`<div class="setup-user-other">
      <label class="sr-only" for=${id + '-other'}>Word for the person who uses it</label>
      <${TextInput} live=${live} entity=${entity + ':user'} id=${id + '-other'} value=${custom ? value : ''}
        placeholder="For example: member, student, driver" maxlength="40"
        onCommit=${(v) => onChange(v.trim() || 'customer')} />
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// How your AI works: pattern cards with small diagrams in our own style

function arrowHead(x, y, angle) {
  const p = (a) => `${(x - 5 * Math.cos(a)).toFixed(1)} ${(y - 5 * Math.sin(a)).toFixed(1)}`;
  return `M${p(angle - 0.55)} L${x} ${y} L${p(angle + 0.55)}`;
}

function Ln({ x1, y1, x2, y2 }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  return html`<path class="setup-art-line" d=${`M${x1} ${y1} L${x2} ${y2}`} />
    <path class="setup-art-line" d=${arrowHead(x2, y2, a)} />`;
}

function Cv({ d, end, from }) {
  const a = Math.atan2(end[1] - from[1], end[0] - from[0]);
  return html`<path class="setup-art-line" d=${d} /><path class="setup-art-line" d=${arrowHead(end[0], end[1], a)} />`;
}

function Box({ x, y, w = 20, h = 12, strong }) {
  return html`<rect class=${classes('setup-art-node', strong && 'is-strong')} x=${x - w / 2} y=${y - h / 2} width=${w} height=${h} rx="3" />`;
}

function Dot({ x, y }) {
  return html`<circle class="setup-art-dot" cx=${x} cy=${y} r="3" />`;
}

function Diamond({ x, y, r = 7 }) {
  return html`<path class="setup-art-node" d=${`M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`} />`;
}

const ART = {
  single: () => html`<${Dot} x=${10} y=${30} /><${Ln} x1=${15} y1=${30} x2=${44} y2=${30} /><${Box} x=${60} y=${30} w=${28} h=${16} strong=${true} />
    <${Ln} x1=${76} y1=${30} x2=${112} y2=${30} /><${Dot} x=${118} y=${30} />`,
  augmented: () => html`<${Dot} x=${10} y=${22} /><${Ln} x1=${15} y1=${22} x2=${44} y2=${22} /><${Box} x=${60} y=${22} w=${28} h=${16} strong=${true} />
    <${Ln} x1=${76} y1=${22} x2=${112} y2=${22} /><${Dot} x=${118} y=${22} />
    <${Ln} x1=${55} y1=${32} x2=${55} y2=${44} /><${Ln} x1=${65} y1=${44} x2=${65} y2=${32} /><${Box} x=${60} y=${50} w=${24} h=${10} />`,
  chain: () => html`<${Dot} x=${8} y=${30} /><${Ln} x1=${12} y1=${30} x2=${22} y2=${30} /><${Box} x=${33} y=${30} w=${20} h=${14} strong=${true} />
    <${Ln} x1=${44} y1=${30} x2=${55} y2=${30} /><${Diamond} x=${63} y=${30} />
    <${Ln} x1=${71} y1=${30} x2=${81} y2=${30} /><${Box} x=${92} y=${30} w=${20} h=${14} strong=${true} />
    <${Ln} x1=${103} y1=${30} x2=${116} y2=${30} /><${Dot} x=${122} y=${30} />`,
  routing: () => html`<${Dot} x=${8} y=${30} /><${Ln} x1=${12} y1=${30} x2=${28} y2=${30} /><${Diamond} x=${37} y=${30} r=${8} />
    <${Ln} x1=${43} y1=${25} x2=${74} y2=${12} /><${Ln} x1=${46} y1=${30} x2=${74} y2=${30} /><${Ln} x1=${43} y1=${35} x2=${74} y2=${48} />
    <${Box} x=${88} y=${12} w=${26} h=${10} /><${Box} x=${88} y=${30} w=${26} h=${10} strong=${true} /><${Box} x=${88} y=${48} w=${26} h=${10} />
    <${Ln} x1=${102} y1=${30} x2=${116} y2=${30} /><${Dot} x=${122} y=${30} />`,
  parallel: () => html`<${Dot} x=${8} y=${30} /><${Ln} x1=${12} y1=${28} x2=${36} y2=${13} /><${Ln} x1=${12} y1=${30} x2=${36} y2=${30} /><${Ln} x1=${12} y1=${32} x2=${36} y2=${47} />
    <${Box} x=${49} y=${12} w=${24} h=${10} strong=${true} /><${Box} x=${49} y=${30} w=${24} h=${10} strong=${true} /><${Box} x=${49} y=${48} w=${24} h=${10} strong=${true} />
    <${Ln} x1=${62} y1=${13} x2=${80} y2=${27} /><${Ln} x1=${62} y1=${30} x2=${80} y2=${30} /><${Ln} x1=${62} y1=${47} x2=${80} y2=${33} />
    <${Box} x=${90} y=${30} w=${18} h=${14} /><${Ln} x1=${100} y1=${30} x2=${116} y2=${30} /><${Dot} x=${122} y=${30} />`,
  orchestrator: () => html`<rect class="setup-art-node is-strong" x="12" y="16" width="26" height="28" rx="3" />
    <path class="setup-art-line is-inner" d="M18 24h14 M18 30h14 M18 36h9" />
    <${Ln} x1=${40} y1=${26} x2=${64} y2=${13} /><${Ln} x1=${40} y1=${30} x2=${64} y2=${30} /><${Ln} x1=${40} y1=${34} x2=${64} y2=${47} />
    <${Box} x=${77} y=${12} w=${24} h=${10} /><${Box} x=${77} y=${30} w=${24} h=${10} /><${Box} x=${77} y=${48} w=${24} h=${10} />
    <${Ln} x1=${90} y1=${13} x2=${106} y2=${27} /><${Ln} x1=${90} y1=${30} x2=${106} y2=${30} /><${Ln} x1=${90} y1=${47} x2=${106} y2=${33} />
    <${Box} x=${116} y=${30} w=${16} h=${14} />`,
  evaluator: () => html`<${Dot} x=${8} y=${30} /><${Ln} x1=${12} y1=${30} x2=${24} y2=${30} /><${Box} x=${38} y=${30} w=${26} h=${14} strong=${true} />
    <${Cv} d="M44 22 Q62 4 80 22" end=${[80, 22]} from=${[62, 4]} />
    <${Box} x=${88} y=${30} w=${26} h=${14} />
    <${Cv} d="M82 38 Q62 56 44 38" end=${[44, 38]} from=${[62, 56]} />
    <${Ln} x1=${102} y1=${30} x2=${116} y2=${30} /><${Dot} x=${122} y=${30} />`,
  agent: () => html`<${Dot} x=${8} y=${30} /><${Ln} x1=${12} y1=${30} x2=${38} y2=${30} /><circle class="setup-art-node is-strong" cx="52" cy="30" r="11" />
    <${Cv} d="M44 17 Q52 2 60 17" end=${[60, 17]} from=${[52, 2]} />
    <${Ln} x1=${64} y1=${25} x2=${92} y2=${14} /><${Ln} x1=${92} y1=${20} x2=${66} y2=${29} />
    <${Ln} x1=${64} y1=${35} x2=${92} y2=${46} /><${Ln} x1=${92} y1=${40} x2=${66} y2=${31} />
    <${Box} x=${106} y=${14} w=${26} h=${10} /><${Box} x=${106} y=${46} w=${26} h=${10} />`,
};

function PatternArt({ id }) {
  const draw = ART[id] || ART.single;
  return html`<svg class="setup-art" viewBox="0 0 132 60" width="132" height="60" aria-hidden="true" focusable="false">${draw()}</svg>`;
}

function PatternCard({ pattern, selected, suggested, onPick }) {
  return html`<button type="button" role="radio" aria-checked=${selected ? 'true' : 'false'} tabindex=${selected ? 0 : -1}
    class=${classes('setup-card', 'setup-pattern', selected && 'is-selected')} onClick=${() => onPick(pattern.id)}>
    <span class="setup-pattern-art"><${PatternArt} id=${pattern.id} /></span>
    <span class="setup-card-title"><span>${pattern.label}</span>${selected && html`<${Icon} name="check" label="Chosen" />`}</span>
    <span class="setup-card-text">${pattern.summary}</span>
    ${suggested && html`<span class="setup-suggested">Suggested from your traces</span>`}
  </button>`;
}

function PatternPicker({ value, suggested, onPick, onNotSure }) {
  const current = value || suggested;
  return html`<div class="stack">
    <div class="setup-grid setup-grid-patterns" role="radiogroup" aria-label="How your AI works" onKeyDown=${cardArrows}>
      ${lib.PATTERNS.map((p) => html`<${PatternCard} key=${p.id} pattern=${p} selected=${p.id === current}
        suggested=${p.id === suggested} onPick=${onPick} />`)}
    </div>
    ${suggested && html`<div class="setup-notsure">
      <${Button} kind="secondary" size="sm" onClick=${onNotSure}>Not sure<//>
      <span class="hint">Keeps the suggestion from your traces: ${patternLabel(suggested)}.</span>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Stages

function reachText(stage, scan) {
  const m = stage.match || {};
  const rules = Object.keys(m).some((k) => (Array.isArray(m[k]) ? m[k].length : m[k]));
  if (!rules) return 'Set by the reviewer: no steps are placed here on their own.';
  if (!scan || !scan.n) return 'Steps are placed here by the rules below.';
  const hits = scan.reach.get(stage.id) || 0;
  if (!hits) return 'No steps match yet in these traces.';
  const of = scan.n < scan.total ? `the first ${formatCount(scan.n)}` : formatCount(scan.n);
  return `Steps found in ${formatCount(hits)} of ${of} traces.`;
}

function toggleIn(list, value) {
  const l = Array.isArray(list) ? list : [];
  return l.includes(value) ? l.filter((x) => x !== value) : [...l, value];
}

function cleanMatch(m) {
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (Array.isArray(v) ? v.length : v != null && v !== '') out[k] = v;
  }
  return out;
}

function StageRules({ stage, scan, live, user, onMatch, onColumn }) {
  const uid = useId();
  const m = stage.match || {};
  const toolNames = useMemo(() => {
    const names = scan ? [...scan.tools.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) : [];
    for (const t of m.tools || []) if (!names.includes(t)) names.push(t);
    return names;
  }, [scan, m.tools]);
  const kindIds = STEP_KINDS.filter(([k]) => (scan && scan.kinds.has(k)) || (m.kinds || []).includes(k));
  let patternError = '';
  if (m.namePattern) {
    try {
      new RegExp(m.namePattern, 'i');
    } catch {
      patternError = 'This pattern is not valid, so it is skipped.';
    }
  }
  const set = (patch) => onMatch(cleanMatch({ ...m, ...patch }));
  return html`<div class="setup-rules">
    <div class="field">
      <label class="label" for=${uid + '-col'}>Kind of stage</label>
      <select id=${uid + '-col'} value=${stage.column || ''} onChange=${(e) => onColumn(e.currentTarget.value)}>
        ${!stage.column && html`<option value="">Pick one</option>`}
        ${lib.COLUMNS.map((c) => html`<option key=${c.id} value=${c.id}>${c.label}: ${lib.withUser(c.question, { userLabel: user })}</option>`)}
      </select>
      <p class="hint">Lines this stage up with the same kind of stage in other products.</p>
    </div>
    <fieldset class="setup-fieldset">
      <legend class="label">Steps that belong to this stage</legend>
      <p class="hint">Each step goes to the first stage whose rules it matches.</p>
      <div class="setup-rule">
        <span class="setup-rule-name">Tools</span>
        ${toolNames.length
          ? html`<div class="setup-chips">${toolNames.map((t) => html`<${Chip} key=${t} selected=${(m.tools || []).includes(t)}
              onClick=${() => set({ tools: toggleIn(m.tools, t) })}><span class="mono">${t}</span><//>`)}</div>`
          : html`<p class="hint">No tools found in these traces.</p>`}
      </div>
      <div class="setup-rule">
        <span class="setup-rule-name">Kinds of step</span>
        <div class="setup-chips">${kindIds.map(([k, label]) => html`<${Chip} key=${k} selected=${(m.kinds || []).includes(k)}
          onClick=${() => set({ kinds: toggleIn(m.kinds, k) })}>${say(label, user)}<//>`)}</div>
      </div>
      <label class="check-row setup-rule-check">
        <input type="checkbox" checked=${m.last === 'assistant'} onChange=${(e) => set({ last: e.currentTarget.checked ? 'assistant' : null })} />
        <span>The final reply the ${user} saw</span>
      </label>
      <div class="field">
        <label class="label" for=${uid + '-pat'}>Step names that match a pattern</label>
        <${TextInput} live=${live} entity=${'pattern:' + stage.id} id=${uid + '-pat'} value=${m.namePattern || ''} class="mono"
          placeholder="For example: search|lookup" spellcheck="false" autocomplete="off"
          onCommit=${(v) => set({ namePattern: v.trim() || null })} />
        ${patternError ? html`<p class="error-text">${patternError}</p>` : html`<p class="hint">Matches any part of the name, ignoring capital letters. Put | between alternatives.</p>`}
      </div>
    </fieldset>
  </div>`;
}

function StageRow({ stage, index, count, scan, live, user, advanced, onLabel, onMove, onDelete, onMatch, onColumn }) {
  const uid = useId();
  const n = index + 1;
  return html`<li class=${classes('setup-stage', advanced && 'is-open')}>
    <div class="setup-stage-head">
      <span class="setup-stage-num" aria-hidden="true">${n}</span>
      <div class="setup-stage-main">
        <label class="sr-only" for=${uid}>Stage ${n} name</label>
        <${TextInput} live=${live} entity=${'stage:' + stage.id} id=${uid} value=${stage.label} maxlength="60"
          onCommit=${(v) => { if (v.trim()) onLabel(v.trim()); }} />
        <p class="hint">${reachText(stage, scan)}</p>
      </div>
      <div class="setup-stage-actions">
        <${Button} kind="ghost" size="sm" icon="setup-up" title=${`Move ${stage.label} up`} disabled=${index === 0} onClick=${() => onMove(-1)} />
        <${Button} kind="ghost" size="sm" icon="setup-down" title=${`Move ${stage.label} down`} disabled=${index === count - 1} onClick=${() => onMove(1)} />
        <${Button} kind="ghost" size="sm" icon="trash" title=${count === 1 ? 'A project needs at least one stage' : `Delete ${stage.label}`}
          disabled=${count === 1} onClick=${onDelete} />
      </div>
    </div>
    ${advanced && html`<${StageRules} stage=${stage} scan=${scan} live=${live} user=${user} onMatch=${onMatch} onColumn=${onColumn} />`}
  </li>`;
}

function AddStage({ stages, onAdd }) {
  const uid = useId();
  const [label, setLabel] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const text = label.trim();
    if (!text) return;
    const id = lib.slugId('', text, [...stages.map((s) => s.id), ...lib.RESERVED_STAGE_IDS]);
    onAdd({ id, label: text, column: 'act', match: {} });
    setLabel('');
  };
  return html`<form class="setup-addstage" onSubmit=${submit}>
    <label class="sr-only" for=${uid}>New stage name</label>
    <input id=${uid} value=${label} onInput=${(e) => setLabel(e.currentTarget.value)} placeholder="New stage, for example: Check the order" maxlength="60" />
    <${Button} type="submit" icon="plus" disabled=${!label.trim()}>Add stage<//>
  </form>`;
}

function StageEditor({ experience, scan, live, project, user, onStages }) {
  const [advanced, setAdvanced] = useState(false);
  const [removing, setRemoving] = useState(null);
  const stages = experience.stages || [];
  const replace = (i, next) => onStages(stages.map((s, j) => (j === i ? next : s)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const next = stages.slice();
    const t = next[i];
    next[i] = next[j];
    next[j] = t;
    onStages(next);
  };
  const askDelete = (stage) => {
    if (project) setRemoving({ stage, usage: stageUsage(project, [stage.id]) });
    else onStages(stages.filter((s) => s.id !== stage.id));
  };
  const confirmDelete = () => {
    const id = removing.stage.id;
    setRemoving(null);
    onStages(stages.filter((s) => s.id !== id));
  };
  return html`<div class="stack">
    <label class="check-row setup-advanced">
      <input type="checkbox" checked=${advanced} onChange=${(e) => setAdvanced(e.currentTarget.checked)} />
      <span>Advanced: which steps belong to this stage</span>
    </label>
    <ol class="setup-stages">
      ${stages.map((s, i) => html`<${StageRow} key=${s.id} stage=${s} index=${i} count=${stages.length} scan=${scan} live=${live}
        user=${user} advanced=${advanced}
        onLabel=${(label) => replace(i, { ...s, label })}
        onMove=${(dir) => move(i, dir)}
        onDelete=${() => askDelete(s)}
        onMatch=${(match) => replace(i, { ...s, match })}
        onColumn=${(column) => replace(i, { ...s, column })} />`)}
    </ol>
    <${AddStage} stages=${stages} onAdd=${(s) => onStages([...stages, s])} />
    <${ConfirmModal} open=${!!removing} title=${removing ? `Delete the stage "${removing.stage.label}"?` : ''}
      confirmLabel="Delete stage" onConfirm=${confirmDelete} onClose=${() => setRemoving(null)}>
      ${removing && html`<p>${usageSentence(removing.usage)}</p>`}
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------
// How the user sees the output: view cards, preview, per-trace views, and your own layout

function TracePreview({ traces, experience, user, title }) {
  const count = Math.min(traces.length, SCAN_LIMIT);
  const [i, setI] = useState(0);
  const index = Math.min(i, Math.max(0, count - 1));
  const trace = useMemo(() => {
    if (!count) return null;
    try {
      return lib.normalizeTrace(traces[index], experience);
    } catch {
      return null;
    }
  }, [traces, index, experience.stages, experience.fieldMap]);
  if (!count) return null;
  const shownAs = trace ? viewLabel(lib.viewFor(trace, experience)) : '';
  return html`<section class="setup-preview" aria-label=${title || 'Preview'}>
    <header class="setup-preview-head">
      <div class="grow">
        <p class="setup-preview-title">${title || `How the ${user} sees it`}</p>
        <p class="hint num">Trace ${formatCount(index + 1)} of ${formatCount(traces.length)}${shownAs ? ` · ${shownAs}` : ''}</p>
      </div>
      <div class="row">
        <${Button} kind="ghost" size="sm" icon="arrow-left" title="Previous trace" disabled=${index === 0} onClick=${() => setI(index - 1)} />
        <${Button} kind="ghost" size="sm" icon="arrow-right" title="Next trace" disabled=${index >= count - 1} onClick=${() => setI(index + 1)} />
      </div>
    </header>
    <div class="setup-preview-body">
      ${trace
        ? html`<${TraceView} trace=${trace} experience=${experience} compact=${true}
            showHidden=${experience.showHiddenDefault == null ? undefined : !!experience.showHiddenDefault} />`
        : html`<p class="hint">This trace could not be drawn.</p>`}
    </div>
  </section>`;
}

function ViewCard({ view, selected, suggested, onPick }) {
  return html`<button type="button" role="radio" aria-checked=${selected ? 'true' : 'false'} tabindex=${selected ? 0 : -1}
    class=${classes('setup-card', 'setup-view', selected && 'is-selected', view.id === 'layout' && 'is-build')} onClick=${() => onPick(view.id)}>
    <span class="setup-view-icon"><${Icon} name=${VIEW_ICONS[view.id] || 'doc'} size=${18} /></span>
    <span class="setup-card-title"><span>${view.label}</span>${selected && html`<${Icon} name="check" label="Chosen" />`}</span>
    <span class="setup-card-text">${view.description}</span>
    ${suggested && html`<span class="setup-suggested">Suggested from your traces</span>`}
  </button>`;
}

function RendererByEditor({ experience, scan, user, onChange }) {
  const uid = useId();
  const by = experience.rendererBy;
  const keys = scan ? [...scan.details.entries()].filter(([, vals]) => vals.size >= 2 && vals.size <= 12).map(([k]) => k) : [];
  const on = !!by;
  const values = by && scan && scan.details.has(by.key) ? [...scan.details.get(by.key).keys()] : [];
  const setView = (value, view) => {
    const map = { ...(by.map || {}) };
    if (view) map[value] = view;
    else delete map[value];
    onChange({ rendererBy: { ...by, map } });
  };
  return html`<div class="setup-by">
    <label class="check-row">
      <input type="checkbox" checked=${on} disabled=${!on && !keys.length}
        onChange=${(e) => onChange({ rendererBy: e.currentTarget.checked ? { key: keys[0] || '', map: {} } : null })} />
      <span>Some traces look different to the ${user} (for example calls and texts)</span>
    </label>
    ${!on && !keys.length && html`<p class="hint setup-indent">None of the details in these traces has a few values to choose by.</p>`}
    ${on && html`<div class="setup-by-body setup-indent">
      <div class="field">
        <label class="label" for=${uid}>Pick the view by this detail</label>
        <select id=${uid} value=${by.key} onChange=${(e) => onChange({ rendererBy: { key: e.currentTarget.value, map: {} } })}>
          ${!keys.includes(by.key) && html`<option value=${by.key}>${by.key || 'Pick a detail'}</option>`}
          ${keys.map((k) => html`<option key=${k} value=${k}>${k}</option>`)}
        </select>
      </div>
      ${values.length > 0 && html`<div class="table-wrap"><table class="table setup-by-table">
        <thead><tr><th scope="col">When ${by.key} is</th><th scope="col">Show it as</th></tr></thead>
        <tbody>${values.map((v) => html`<tr key=${v}>
          <td><span class="chip">${v}</span></td>
          <td><select aria-label=${`View when ${by.key} is ${v}`} value=${(by.map || {})[v] || ''} onChange=${(e) => setView(v, e.currentTarget.value)}>
            <option value="">Same as above (${viewLabel(experience.renderer)})</option>
            ${VIEW_ORDER.filter((id) => id !== 'layout' || (experience.layout && experience.layout.length)).map((id) => html`<option key=${id} value=${id}>${viewLabel(id)}</option>`)}
          </select></td>
        </tr>`)}</tbody>
      </table></div>`}
    </div>`}
  </div>`;
}

function LayoutRow({ row, index, count, paths, live, onRow, onMove, onRemove }) {
  const uid = useId();
  const options = paths.includes(row.path) || !row.path ? paths : [row.path, ...paths];
  return html`<li class="setup-layout-row">
    <span class="setup-stage-num" aria-hidden="true">${index + 1}</span>
    <div class="setup-layout-fields">
      <div class="field">
        <label class="label" for=${uid + '-f'}>Field</label>
        <select id=${uid + '-f'} class="mono" value=${row.path} onChange=${(e) => onRow({ ...row, path: e.currentTarget.value })}>
          ${!row.path && html`<option value="">Pick a field</option>`}
          ${options.map((p) => html`<option key=${p} value=${p}>${p}</option>`)}
        </select>
      </div>
      <div class="field">
        <label class="label" for=${uid + '-a'}>Show as</label>
        <select id=${uid + '-a'} value=${row.as || 'text'} onChange=${(e) => onRow({ ...row, as: e.currentTarget.value })}>
          ${SHOW_AS.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
        </select>
      </div>
      <div class="field">
        <label class="label" for=${uid + '-l'}>Label</label>
        <${TextInput} live=${live} entity=${'layout:' + index + ':' + row.path} id=${uid + '-l'} value=${row.label} maxlength="60"
          onCommit=${(v) => onRow({ ...row, label: v })} />
      </div>
    </div>
    <div class="setup-stage-actions">
      <${Button} kind="ghost" size="sm" icon="setup-up" title="Move this panel up" disabled=${index === 0} onClick=${() => onMove(-1)} />
      <${Button} kind="ghost" size="sm" icon="setup-down" title="Move this panel down" disabled=${index === count - 1} onClick=${() => onMove(1)} />
      <${Button} kind="ghost" size="sm" icon="trash" title="Remove this panel" onClick=${onRemove} />
    </div>
  </li>`;
}

function LayoutEditor({ experience, traces, live, onChange }) {
  const rows = experience.layout || [];
  const paths = useMemo(() => lib.fieldPaths(traces).filter((p) => p && p !== 'id'), [traces]);
  const set = (next) => onChange({ layout: next });
  const move = (i, dir) => {
    const j = i + dir;
    const next = rows.slice();
    const t = next[i];
    next[i] = next[j];
    next[j] = t;
    set(next);
  };
  return html`<div class="setup-layout">
    <h4 class="setup-subtitle">Your view</h4>
    <p class="hint">Each panel shows one field of the trace, in this order.</p>
    ${rows.length
      ? html`<ol class="setup-layout-rows">${rows.map((row, i) => html`<${LayoutRow} key=${i + ':' + row.path} row=${row} index=${i} count=${rows.length}
          paths=${paths} live=${live} onRow=${(r) => set(rows.map((x, j) => (j === i ? r : x)))} onMove=${(dir) => move(i, dir)}
          onRemove=${() => set(rows.filter((_, j) => j !== i))} />`)}</ol>`
      : html`<p class="setup-empty-line">No panels yet. Add one to show a field of the trace.</p>`}
    <div><${Button} icon="plus" size="sm" onClick=${() => set([...rows, { label: 'New panel', path: paths[0] || '', as: 'text' }])}>Add a panel<//></div>
  </div>`;
}

function ViewPicker({ experience, traces, scan, suggested, live, user, onChange }) {
  const pick = (id) => {
    if (id === 'layout' && !(experience.layout && experience.layout.length)) onChange({ renderer: id, layout: guessLayout(traces, user) });
    else onChange({ renderer: id });
  };
  const current = lib.normalizeViewId(experience.renderer);
  const cards = VIEW_ORDER.map((id) => lib.VIEWS.find((v) => v.id === id)).filter(Boolean);
  return html`<div class="setup-viewpick">
    <div class="setup-viewpick-cards">
      <div class="setup-grid setup-grid-views" role="radiogroup" aria-label=${`How the ${user} sees the output`} onKeyDown=${cardArrows}>
        ${cards.map((v) => html`<${ViewCard} key=${v.id} view=${v} selected=${v.id === current} suggested=${v.id === suggested} onPick=${pick} />`)}
      </div>
      ${current === 'layout' && html`<${LayoutEditor} experience=${experience} traces=${traces} live=${live} onChange=${onChange} />`}
      <${RendererByEditor} experience=${experience} scan=${scan} user=${user} onChange=${onChange} />
      <div>
        <label class="check-row">
          <input type="checkbox" checked=${!!experience.showHiddenDefault} onChange=${(e) => onChange({ showHiddenDefault: e.currentTarget.checked })} />
          <span>Show the steps behind the scenes by default</span>
        </label>
        <p class="hint setup-indent">Tool calls, look-ups, and other steps the ${user} never saw start open in Review traces. Press H there to switch.</p>
      </div>
    </div>
    <div class="setup-viewpick-preview">
      <${TracePreview} traces=${traces} experience=${experience} user=${user} />
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Filters

function FilterPicker({ experience, scan, suggested = [], onChange }) {
  const filters = experience.filters || [];
  const keys = useMemo(() => {
    // Details with one value cannot split the traces, so they are left out unless already chosen.
    const all = scan ? [...scan.details.entries()].filter(([k, vals]) => vals.size > 1 || filters.includes(k)) : [];
    const rank = (k, vals) => (filters.includes(k) ? 0 : suggested.includes(k) ? 1 : vals.size <= 12 ? 2 : 3);
    return all
      .sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 30);
    // The order is set once per scan, so rows do not jump while you tick them.
  }, [scan]);
  const missing = filters.filter((f) => !keys.some(([k]) => k === f));
  const toggle = (k, on) => onChange({ filters: on ? [...filters.filter((f) => f !== k), k] : filters.filter((f) => f !== k) });
  if (!keys.length && !missing.length) {
    return html`<p class="setup-empty-line">These traces have no details to filter on. Details are fields like channel or persona that each trace can carry.</p>`;
  }
  return html`<ul class="setup-filters">
    ${keys.map(([k, vals]) => {
      const list = [...vals.keys()];
      const many = vals.size > 12;
      return html`<li key=${k}>
        <label class="check-row setup-filter">
          <input type="checkbox" checked=${filters.includes(k)} onChange=${(e) => toggle(k, e.currentTarget.checked)} />
          <span class="setup-filter-text">
            <span class="setup-filter-name">${k}</span>
            <span class="hint">${many
              ? `${vals.size >= 60 ? 'Many' : formatCount(vals.size)} values, better for search than for a filter`
              : `${plural(vals.size, 'value')}: ${list.slice(0, 5).join(', ')}${list.length > 5 ? ', ...' : ''}`}</span>
          </span>
          ${suggested.includes(k) && html`<span class="setup-suggested">Suggested</span>`}
        </label>
      </li>`;
    })}
    ${missing.map((k) => html`<li key=${'m:' + k}>
      <label class="check-row setup-filter">
        <input type="checkbox" checked=${true} onChange=${(e) => toggle(k, e.currentTarget.checked)} />
        <span class="setup-filter-text"><span class="setup-filter-name">${k}</span><span class="hint">Not found in the first traces</span></span>
      </label>
    </li>`)}
  </ul>`;
}

// ---------------------------------------------------------------------------
// Field mapping for trace shapes pmstack does not recognize

function FieldMapper({ experience, traces, user, onChange }) {
  const uid = useId();
  const paths = useMemo(() => lib.fieldPaths(traces).filter((p) => p && p !== 'id'), [traces]);
  const fm = experience.fieldMap || {};
  const scan = useMemo(() => scanTraces(traces.slice(0, 200), experience), [traces, experience.stages, experience.fieldMap]);
  const set = (key, value) => {
    const next = { ...fm };
    if (value) next[key] = value;
    else delete next[key];
    onChange({ fieldMap: Object.keys(next).length ? next : null });
  };
  const rows = [
    ['input', `What the ${user} asked`],
    ['output', 'What the AI answered'],
    ['messages', 'The conversation, if any'],
  ];
  const all = scan.n;
  const tone = scan.visible === all ? 'is-good' : scan.visible ? 'is-warn' : 'is-bad';
  return html`<section class="setup-mapper" aria-labelledby=${uid}>
    <h3 id=${uid} class="setup-subtitle">Show us where the text is</h3>
    <p class="soft">We could not tell where the conversation is in these traces. Pick the fields that hold it, and the preview updates.</p>
    <div class="setup-mapper-fields">
      ${rows.map(([key, label]) => html`<div class="field" key=${key}>
        <label class="label" for=${uid + key}>${label}</label>
        <select id=${uid + key} value=${fm[key] || ''} onChange=${(e) => set(key, e.currentTarget.value)}>
          <option value="">Not in these traces</option>
          ${(fm[key] && !paths.includes(fm[key]) ? [fm[key], ...paths] : paths).map((p) => html`<option key=${p} value=${p}>${p === 'metadata' ? 'Details' : p.replace(/^metadata\./, '')}</option>`)}
        </select>
      </div>`)}
    </div>
    <p class=${classes('setup-mapper-result', tone)} role="status">
      <${Icon} name=${scan.visible === all ? 'check' : 'warning'} />
      <span>${scan.visible === all
        ? `All ${formatCount(all)} traces now show text.`
        : scan.visible
          ? `${formatCount(scan.visible)} of ${formatCount(all)} traces now show text.`
          : `No trace shows text yet. Pick the field that holds what the ${user} asked.`}</span>
    </p>
  </section>`;
}

// ---------------------------------------------------------------------------
// New project wizard (#/setup/new)

const STEPS = [
  { n: 1, label: 'Name your product' },
  { n: 2, label: 'Add traces' },
  { n: 3, label: 'How your AI works', optional: true },
  { n: 4, label: 'Name the stages', optional: true },
  { n: 5, label: 'How the {user} sees it', optional: true },
];

function stagesFor(pattern) {
  return lib.defaultExperience({ pattern }).stages;
}

function blankDraft() {
  return {
    name: '', userLabel: 'customer', goal: '',
    file: null, loading: null, loadError: '', traces: [], shape: '', shapeLabel: '', errors: [], warnings: [], mapping: false,
    fieldMap: null, pattern: null, suggestedPattern: null, stages: null,
    renderer: null, suggestedView: null, rendererBy: null, layout: null, filters: [], suggestedFilters: [],
    showHiddenDefault: null, touched: {},
  };
}

function folderDraft(project, info) {
  const e = project.experience || {};
  const traces = project.traces || [];
  const shape = traces.length ? lib.detectShape(traces[0]) : 'unknown';
  return {
    ...blankDraft(),
    name: project.name || e.product || '', userLabel: lib.userWord(e), goal: e.customerGoal || '',
    file: { name: (info && info.tracesFile) || project.tracesFile || 'pmstack/project.json' },
    traces, shape, shapeLabel: shapeLabelOf(traces), mapping: !!e.fieldMap || needsMapping(traces, shape),
    fieldMap: e.fieldMap || null, pattern: e.pattern || null, suggestedPattern: lib.suggestPattern(traces), stages: e.stages || null,
    renderer: e.renderer || null, suggestedView: lib.suggestView(traces), rendererBy: e.rendererBy || null, layout: e.layout || null,
    filters: e.filters || [], suggestedFilters: lib.suggestFilters(traces),
    showHiddenDefault: e.showHiddenDefault ?? null,
  };
}

function draftExperience(d) {
  const base = lib.defaultExperience({
    product: d.name.trim(), userLabel: d.userLabel, customerGoal: d.goal.trim(),
    pattern: d.pattern || d.suggestedPattern || 'single', renderer: d.renderer || d.suggestedView || 'auto', filters: d.filters,
  });
  const out = { ...base, stages: d.stages || base.stages, fieldMap: d.fieldMap || null, rendererBy: d.rendererBy || null, layout: d.layout || null };
  if (d.showHiddenDefault != null) out.showHiddenDefault = d.showHiddenDefault;
  return out;
}

function Stepper({ step, reachable, user, onStep }) {
  return html`<nav class="setup-stepper" aria-label="New project steps">
    <p class="setup-stepper-compact" aria-hidden="true">Step ${step} of 5${step >= 3 ? ' (optional)' : ''}</p>
    <ol>
      ${STEPS.map((s) => {
        const state = s.n === step ? 'is-current' : s.n < step ? 'is-done' : '';
        return html`<li key=${s.n} class=${classes('setup-stepper-item', state, s.optional && 'is-optional')}>
          <button type="button" class="setup-stepper-btn" disabled=${s.n > reachable} aria-current=${s.n === step ? 'step' : undefined}
            onClick=${() => onStep(s.n)}>
            <span class="setup-stepper-num" aria-hidden="true">${s.n < step ? html`<${Icon} name="check" size=${12} />` : s.n}</span>
            <span class="setup-stepper-label"><span class="sr-only">Step ${s.n}${s.optional ? ', optional' : ''}: </span>${say(s.label, user)}</span>
          </button>
        </li>`;
      })}
    </ol>
    <p class="setup-stepper-group" aria-hidden="true"><span>Adjust before you start (optional)</span></p>
  </nav>`;
}

function TraceFileSummary({ d, onReplace, folder }) {
  const fileName = d.file ? d.file.name : '';
  return html`<div class="setup-filesum">
    <div class="setup-filesum-head">
      <span class="setup-row-icon" aria-hidden="true"><${Icon} name=${folder ? 'folder' : 'doc'} size=${18} /></span>
      <div class="grow">
        <p class="setup-filesum-name">${fileName}</p>
        <p class="setup-filesum-meta">
          <span class="num">${plural(d.traces.length, 'trace')}</span>
          ${d.shapeLabel && html`<span class="chip">${d.fieldMap ? mappedShapeLabel(d.traces, d.fieldMap) : d.shapeLabel}</span>`}
        </p>
      </div>
      ${onReplace && html`<${FileButton} accept=${TRACE_ACCEPT} onFile=${onReplace} label="Choose another file" size="sm" />`}
    </div>
    ${d.errors.length > 0 && html`<div class="setup-note is-bad" role="alert">
      <p><strong>Some lines could not be read. The other ${plural(d.traces.length, 'trace')} are fine.</strong></p>
      <${ErrorList} errors=${d.errors} />
    </div>`}
    ${d.warnings.length > 0 && html`<div class="setup-note is-warn">
      <${ErrorList} errors=${d.warnings} max=${3} />
    </div>`}
  </div>`;
}

function WizardStep1({ d, update, nameError, onNext }) {
  const uid = useId();
  const user = d.userLabel || 'customer';
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.focus();
  }, []);
  return html`<form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); onNext(); }}>
    <div class="setup-step-head">
      <h2>Name your product</h2>
      <p class="soft">The name shows in the top bar and at the top of your report.</p>
    </div>
    <div class="field">
      <label class="label" for=${uid + '-name'}>Product name</label>
      <input id=${uid + '-name'} ref=${ref} value=${d.name} maxlength="80" autocomplete="off" aria-invalid=${nameError ? 'true' : undefined}
        aria-describedby=${nameError ? uid + '-err' : undefined}
        placeholder="For example: Order status assistant" onInput=${(e) => update({ name: e.currentTarget.value })} />
      ${nameError && html`<p class="error-text" id=${uid + '-err'} role="alert">Give your product a name.</p>`}
    </div>
    <div class="field">
      <span class="label" id=${uid + '-who'}>Who uses it?</span>
      <${UserPicker} id=${uid + '-who'} value=${user} live=${false} entity="wizard" onChange=${(w) => update({ userLabel: w })} />
      <p class="hint">Eval Studio uses this word everywhere, so your notes read from the ${user}'s side.</p>
    </div>
    <div class="field">
      <label class="label" for=${uid + '-goal'}>What is the ${user} trying to do?</label>
      <textarea id=${uid + '-goal'} rows="2" value=${d.goal} maxlength="300"
        placeholder="For example: Find out where an order is without calling support."
        onInput=${(e) => update({ goal: e.currentTarget.value })}></textarea>
      <p class="hint">One sentence. AI judges and your report use it to describe a good outcome.</p>
    </div>
    <button type="submit" class="setup-hidden-submit" tabindex="-1" aria-hidden="true">Next</button>
  </form>`;
}

function WizardStep2({ d, update, onFile, folder, exp, user }) {
  const showMapper = d.mapping || !!d.fieldMap;
  const loaded = d.traces.length > 0 && !d.loading;
  return html`<div class="stack-lg">
    <div class="setup-step-head">
      <h2>Add traces</h2>
      <p class="soft">A trace is one full conversation or task, with every step the AI took and what the ${user} saw.
        ${folder ? ' This project reads the trace file in your folder.' : ' Use a .jsonl, .json, or .csv file with one trace per line or row.'}</p>
    </div>
    ${!folder && !d.traces.length && !d.loading && html`<div class="stack">
      <${FileDrop} accept=${TRACE_ACCEPT} onFile=${onFile} label="Choose a trace file" />
      <p class="hint"><a href=${GUIDE_URL} target="_blank" rel="noopener noreferrer">What should a trace file look like?</a></p>
      ${d.loadError && html`<div class="setup-note is-bad" role="alert"><p>${d.loadError}</p></div>`}
      ${d.errors.length > 0 && html`<div class="setup-note is-bad" role="alert">
        <p><strong>${d.file ? d.file.name : 'This file'}: no traces could be read.</strong></p>
        <${ErrorList} errors=${d.errors} />
      </div>`}
    </div>`}
    ${d.loading && html`<div class="setup-loading" role="status"><span class="setup-spinner" aria-hidden="true"></span>Reading ${d.loading}...</div>`}
    ${loaded && html`<${TraceFileSummary} d=${d} folder=${folder} onReplace=${folder ? null : onFile} />`}
    ${loaded && showMapper && html`<div class="card card-flat"><${FieldMapper} experience=${exp} traces=${d.traces} user=${user}
      onChange=${(patch) => update({ ...patch, touched: { ...d.touched, fieldMap: true } })} /></div>`}
    ${loaded && html`<${TracePreview} traces=${d.traces} experience=${exp} user=${user} title="Your first trace" />`}
    ${loaded && html`<p class="hint"><a href=${GUIDE_URL} target="_blank" rel="noopener noreferrer">What should a trace file look like?</a></p>`}
  </div>`;
}

function Wizard() {
  const kind = useStore((s) => s.storageKind);
  const folder = kind === 'folder';
  const [d, update, ref] = useLocal(() => {
    const s = store.get();
    return folder && s.project ? folderDraft(s.project, s.folder) : blankDraft();
  });
  const [step, setStep] = useState(1);
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(null); // { tab, param } the reader asked to go to
  const top = useRef(null);
  const user = (d.userLabel || '').trim() || 'customer';
  const started = !folder && !!(d.name.trim() || d.traces.length || d.file);
  const fallback = () => ({ tab: folder || store.get().project ? 'setup' : 'welcome', param: null });

  // Unsaved input: top bar tabs, links, and Back ask before leaving, like Cancel does.
  useEffect(() => {
    if (!started || busy) {
      setLeaveGuard(null);
      return undefined;
    }
    setLeaveGuard((tab, param) => {
      if (tab === 'setup' && param === 'new') return false;
      setLeaving({ tab, param });
      return true;
    });
    return () => setLeaveGuard(null);
  }, [started, busy]);

  const exp = useMemo(() => draftExperience(d), [d.name, d.userLabel, d.goal, d.pattern, d.suggestedPattern, d.stages, d.renderer,
    d.suggestedView, d.rendererBy, d.layout, d.filters, d.fieldMap, d.showHiddenDefault]);
  const scan = useMemo(() => (d.traces.length ? scanTraces(d.traces, exp) : null), [d.traces, exp.stages, exp.fieldMap]);

  const reachable = !d.name.trim() ? 1 : d.traces.length ? 5 : 2;

  const go = (n) => {
    if (n > 1 && !ref.current.name.trim()) {
      setNameError(true);
      setStep(1);
      return;
    }
    setNameError(false);
    setStep(Math.min(n, ref.current.traces.length ? 5 : 2));
    if (top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView({ block: 'start' });
  };

  const onFile = async (file) => {
    update({ loading: file.name, loadError: '', errors: [], warnings: [] });
    try {
      const text = await readFile(file);
      const res = lib.parseTraceFile(text, file.name);
      const traces = res.traces;
      if (!traces.length) {
        update({ loading: null, file: { name: file.name, size: file.size }, traces: [], errors: res.errors.length ? res.errors : ['No traces were found in this file.'], warnings: [] });
        return;
      }
      const cur = ref.current;
      const suggestedPattern = lib.suggestPattern(traces);
      const suggestedView = lib.suggestView(traces);
      const suggestedFilters = lib.suggestFilters(traces);
      const pattern = cur.touched.pattern ? cur.pattern : suggestedPattern;
      update({
        loading: null,
        file: { name: file.name, size: file.size },
        traces,
        shape: res.shape,
        shapeLabel: res.shapeLabel,
        errors: res.errors,
        warnings: res.warnings || [],
        mapping: needsMapping(traces, res.shape),
        fieldMap: null,
        suggestedPattern,
        suggestedView,
        suggestedFilters,
        pattern,
        stages: cur.touched.stages ? cur.stages : stagesFor(pattern),
        renderer: cur.touched.renderer ? cur.renderer : suggestedView,
        filters: cur.touched.filters ? cur.filters : suggestedFilters,
        rendererBy: null,
      });
    } catch (err) {
      update({ loading: null, loadError: `This file could not be read: ${errorMessage(err)}` });
    }
  };

  const finish = async () => {
    const cur = ref.current;
    if (!cur.name.trim()) {
      setNameError(true);
      setStep(1);
      return;
    }
    if (!cur.traces.length || noText) {
      setStep(2);
      return;
    }
    setBusy(true);
    const experience = draftExperience(cur);
    try {
      if (folder) {
        updateProject((p) => {
          const { reviewer, gate, groupGate } = p.experience || {};
          let next = withStages(p, experience.stages);
          next = {
            ...next,
            name: cur.name.trim(),
            experience: { ...p.experience, ...experience, reviewer: reviewer || '', gate: gate ?? 10, groupGate: groupGate ?? 30 },
          };
          if (!next.batch) next = lib.setBatch(next, lib.nextBatch(next, { size: 20, strategy: 'mix' }), 'mix');
          return next;
        }, 'setup');
      } else {
        await createProjectFrom({ name: cur.name.trim(), experience, traces: cur.traces });
        updateProject((p) => lib.setBatch(p, lib.nextBatch(p, { size: 20, strategy: 'mix' }), 'mix'), 'first set');
      }
      setLeaveGuard(null);
      navigate('review');
    } catch (err) {
      setBusy(false);
      toast(`The project could not be created: ${errorMessage(err)}`, { tone: 'bad' });
    }
  };

  const leave = () => {
    const to = fallback();
    if (started) setLeaving(to);
    else navigate(to.tab, to.param);
  };

  const confirmLeave = () => {
    const to = leaving || fallback();
    setLeaving(null);
    setLeaveGuard(null);
    navigate(to.tab, to.param);
  };

  // A trace file picked in "Open a project file" starts here, at Add traces.
  useEffect(() => {
    if (folder || !wizardFile) return;
    const file = wizardFile;
    wizardFile = null;
    setStep(2);
    onFile(file);
  }, []);

  const setPattern = (id) => {
    update({ pattern: id, stages: stagesFor(id), touched: { ...ref.current.touched, pattern: true, stages: false } });
  };

  const expPatch = (patch) => {
    const touched = { ...ref.current.touched };
    for (const k of Object.keys(patch)) touched[k] = true;
    update({ ...patch, touched });
  };

  // Traces that need the field menus must show some text before reviewing starts.
  const noText = (d.mapping || !!d.fieldMap) && !!scan && scan.visible === 0;
  const canFinish = !!d.name.trim() && d.traces.length > 0 && !noText;
  const next = STEPS[step] || null;
  const why = !d.name.trim() ? 'Name your product first.'
    : !d.traces.length ? 'Add a trace file to start reviewing.'
      : `Pick the field that holds what the ${user} asked, so each trace shows text.`;

  let body;
  if (step === 1) {
    body = html`<${WizardStep1} d=${d} nameError=${nameError} onNext=${() => go(2)}
      update=${(p) => { if (nameError && p.name) setNameError(false); update(p); }} />`;
  } else if (step === 2) {
    body = html`<${WizardStep2} d=${d} update=${update} onFile=${onFile} folder=${folder} exp=${exp} user=${user} />`;
  } else if (step === 3) {
    body = html`<div class="stack-lg">
      <div class="setup-step-head">
        <h2>How does your AI work?</h2>
        <p class="soft">Pick the closest match. It sets the starting stages of your funnel, which you can rename next.</p>
      </div>
      <${PatternPicker} value=${d.pattern} suggested=${d.suggestedPattern} onPick=${setPattern}
        onNotSure=${() => { setPattern(ref.current.suggestedPattern); go(4); }} />
    </div>`;
  } else if (step === 4) {
    body = html`<div class="stack-lg">
      <div class="setup-step-head">
        <h2>Name the stages</h2>
        <p class="soft">Stages are the steps of the funnel of an AI experience. Name them the way your team talks about the product, in the order they happen.</p>
      </div>
      <${StageEditor} experience=${exp} scan=${scan} live=${false} project=${null} user=${user}
        onStages=${(stages) => update({ stages, touched: { ...ref.current.touched, stages: true } })} />
    </div>`;
  } else {
    body = html`<div class="stack-lg">
      <div class="setup-step-head">
        <h2>How does the ${user} see the output?</h2>
        <p class="soft">Pick the view that looks most like what the ${user} saw. The preview shows your traces with it.</p>
      </div>
      <${ViewPicker} experience=${exp} traces=${d.traces} scan=${scan} suggested=${d.suggestedView} live=${false} user=${user} onChange=${expPatch} />
      <section class="stack setup-wizard-filters" aria-labelledby="setup-wiz-filters">
        <h3 id="setup-wiz-filters" class="setup-subtitle">Filters</h3>
        <p class="soft">Details you can filter by in Review traces, with a count of how many you reviewed for each value.</p>
        <${FilterPicker} experience=${exp} scan=${scan} suggested=${d.suggestedFilters} onChange=${expPatch} />
      </section>
    </div>`;
  }

  return html`<section class="page setup-page setup-wizard" aria-labelledby="setup-wiz-title">
    <div ref=${top} class="setup-wizard-top">
      <div class="setup-wizard-title">
        <div class="grow">
          <p class="setup-eyebrow">${folder ? 'Your folder project' : 'New project'}</p>
          <h1 id="setup-wiz-title" class="page-title">${folder ? 'Set up your project' : 'Review your own traces'}</h1>
        </div>
        <${Button} kind="ghost" icon="x" onClick=${leave}>${folder ? 'Close' : 'Cancel'}<//>
      </div>
      <${Stepper} step=${step} reachable=${reachable} user=${user} onStep=${go} />
    </div>
    <div class="card setup-wizard-card" key=${step}>${body}</div>
    <footer class="setup-wizard-foot">
      <div class="row">
        ${step > 1 && html`<${Button} kind="ghost" icon="arrow-left" onClick=${() => go(step - 1)}>Back<//>`}
      </div>
      <div class="row setup-wizard-next">
        ${step >= 2 && !canFinish && !d.loading && html`<p class="hint setup-wizard-why">${why}</p>`}
        ${step === 1 && html`<${Button} kind="primary" size="lg" icon="arrow-right" onClick=${() => go(2)}>Next: Add traces<//>`}
        ${step === 2 && canFinish && html`<${Button} kind="secondary" size="lg" onClick=${() => go(3)}>Adjust before you start<//>`}
        ${step >= 3 && step < 5 && next && html`<${Button} kind="secondary" size="lg" onClick=${() => go(step + 1)}>Next: ${say(next.label, user)}<//>`}
        ${step >= 2 && html`<${Button} kind="primary" size="lg" icon="arrow-right" disabled=${!canFinish || busy} onClick=${finish}>
          ${busy ? 'Creating...' : 'Start reviewing'}<//>`}
      </div>
    </footer>
    <${ConfirmModal} open=${!!leaving} title="Leave without creating the project?" confirmLabel="Leave"
      onConfirm=${confirmLeave} onClose=${() => setLeaving(null)}>
      <p>${d.traces.length ? 'The trace file you added is not saved until you start reviewing.' : 'What you typed is not saved until you start reviewing.'}</p>
    <//>
  </section>`;
}

// ---------------------------------------------------------------------------
// Project list (browser mode)

function Monogram({ name }) {
  const letter = (String(name || '').trim()[0] || 'P').toUpperCase();
  return html`<span class="setup-row-icon setup-monogram" aria-hidden="true">${letter}</span>`;
}

function useProjectActions() {
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null); // { type: 'delete' | 'reset', summary }

  const run = async (id, fn) => {
    setBusy(id);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), { tone: 'bad' });
    } finally {
      setBusy(null);
    }
  };

  const downloadIt = (summary) => run(summary.id, async () => {
    const p = await loadFullProject(summary.id);
    downloadFile(projectFile(p));
  });

  const duplicate = (summary, sampleIds = []) => run(summary.id, async () => {
    const p = await loadFullProject(summary.id);
    const now = nowIso();
    const taken = [...store.get().projects.map((x) => x.id), ...sampleIds];
    const copy = {
      ...lib.projectForDownload(p),
      id: lib.slugId('', `${p.id}-copy`, taken),
      name: `${p.name} (copy)`,
      sample: false,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const res = await importProjectFile(JSON.stringify(copy), { onClash: async () => 'keep' });
    if (!res.ok) throw new Error(res.errors && res.errors.length ? `The copy could not be made: ${res.errors[0]}` : 'The copy could not be made.');
    toast(`Made a copy: ${copy.name}. It is open now.`, { tone: 'good' });
  });

  const open = (summary) => run(summary.id, async () => {
    await openProject(summary.id);
    navigate('review');
  });

  const confirmNow = () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.type === 'delete') {
      run(c.summary.id, async () => {
        await deleteProject(c.summary.id);
        toast(`Deleted ${c.summary.name}.`);
      });
    } else {
      run(c.summary.id, async () => {
        await resetSample(c.summary.id);
        toast(`${c.summary.name} is back to how it shipped.`, { tone: 'good' });
      });
    }
  };

  return { busy, confirm, setConfirm, downloadIt, duplicate, open, confirmNow };
}

function ProjectRow({ summary, active, sampleInfo, actions, sampleIds }) {
  const canReset = !!summary.sample && !!(sampleInfo && sampleInfo.id);
  const busy = actions.busy === summary.id;
  const items = [
    { label: 'Duplicate', icon: 'setup-copy', hint: 'A copy you can change freely', onClick: () => actions.duplicate(summary, sampleIds), disabled: busy },
    { label: 'Download project', icon: 'download', hint: 'Everything, to reopen later or share', onClick: () => actions.downloadIt(summary), disabled: busy },
    canReset && { label: 'Reset sample', icon: 'setup-reset', hint: 'Back to how it shipped', onClick: () => actions.setConfirm({ type: 'reset', summary }), disabled: busy },
    'divider',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => actions.setConfirm({ type: 'delete', summary }), disabled: busy },
  ].filter(Boolean);
  const meta = [
    `${summary.sample ? 'Your copy: ' : ''}${reviewedLine(summary.reviewed || 0, summary.traceCount || 0)}`,
    summary.updatedAt && `Updated ${shortDate(summary.updatedAt)}`,
  ].filter(Boolean).join(' · ');
  return html`<li class=${classes('setup-row', active && 'is-active')}>
    ${sampleInfo && sampleInfo.view
      ? html`<span class="setup-row-icon" aria-hidden="true"><${Icon} name=${VIEW_ICONS[sampleInfo.view] || 'doc'} size=${18} /></span>`
      : html`<${Monogram} name=${summary.name} />`}
    <div class="setup-row-main">
      <p class="setup-row-name">
        <span class="setup-row-title">${summary.name}</span>
        ${active && html`<span class="setup-row-open">Open now</span>`}
      </p>
      <p class="setup-row-meta num">${meta}</p>
    </div>
    <div class="setup-row-actions">
      <${Menu} label="More" kind="ghost" size="sm" align="end" items=${items} />
      ${active
        ? html`<${Button} kind="secondary" size="sm" onClick=${() => navigate('review')}>Review traces<//>`
        : html`<${Button} kind="secondary" size="sm" disabled=${busy} onClick=${() => actions.open(summary)}>${busy ? 'Working...' : 'Open'}<//>`}
    </div>
  </li>`;
}

function SampleRow({ sample }) {
  return html`<li class="setup-row">
    <span class="setup-row-icon" aria-hidden="true"><${Icon} name=${VIEW_ICONS[sample.view] || 'doc'} size=${18} /></span>
    <div class="setup-row-main">
      <p class="setup-row-name"><span class="setup-row-title">${sample.name}</span></p>
      <p class="setup-row-meta num">${plural(sample.traceCount, 'trace')} · ${sampleStateLine(sample)}</p>
    </div>
    <div class="setup-row-actions">
      <${Button} kind="secondary" size="sm" onClick=${() => navigate('open', sample.id)}>Open<//>
    </div>
  </li>`;
}

function SkeletonRows() {
  return html`<ul class="setup-rows" aria-busy="true" aria-label="Loading the sample products">
    ${[0, 1, 2].map((i) => html`<li key=${i} class="setup-row is-skeleton">
      <span class="setup-row-icon"></span>
      <div class="setup-row-main"><span class="setup-skel"></span><span class="setup-skel is-short"></span></div>
    </li>`)}
  </ul>`;
}

function ProjectList() {
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeProjectId);
  const [samples, retry] = useSampleIndex();
  const actions = useProjectActions();
  const sampleById = new Map((samples || []).map((s) => [s.id, s]));
  const byDate = (a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : (a.updatedAt || '') > (b.updatedAt || '') ? -1 : 0);
  const own = projects.filter((p) => !p.sample).sort(byDate);
  const strayCopies = projects.filter((p) => p.sample && !sampleById.has(p.id));
  const sampleIds = (samples || []).map((s) => s.id);
  const c = actions.confirm;
  const deleting = c && c.type === 'delete';
  const cSample = c && c.summary.sample;

  return html`<section class="card setup-projects" aria-labelledby="setup-projects-title">
    <div class="setup-projects-head">
      <h2 id="setup-projects-title">Projects</h2>
      <span class="hint">Saved in this browser only</span>
    </div>
    <div class="setup-group">
      <h3 class="section-title">Your projects</h3>
      ${own.length
        ? html`<ul class="setup-rows">${own.map((p) => html`<${ProjectRow} key=${p.id} summary=${p} active=${p.id === activeId}
            actions=${actions} sampleIds=${sampleIds} />`)}</ul>`
        : html`<p class="setup-empty-line">No projects of your own yet. Start one with your traces, or import a project file.</p>`}
    </div>
    <div class="setup-group">
      <h3 class="section-title">Sample products</h3>
      ${samples === null && html`<${SkeletonRows} />`}
      ${samples && !samples.length && html`<div class="setup-note">
        <p>The sample products could not load. Check your connection, then try again.</p>
        <div><${Button} size="sm" onClick=${retry}>Try again<//></div>
      </div>`}
      ${(samples && samples.length > 0 || strayCopies.length > 0) && html`<ul class="setup-rows">
        ${(samples || []).map((s) => {
          const copy = projects.find((p) => p.id === s.id);
          return copy
            ? html`<${ProjectRow} key=${s.id} summary=${copy} sampleInfo=${s} active=${s.id === activeId} actions=${actions} sampleIds=${sampleIds} />`
            : html`<${SampleRow} key=${s.id} sample=${s} />`;
        })}
        ${samples !== null && strayCopies.map((p) => html`<${ProjectRow} key=${p.id} summary=${p} active=${p.id === activeId} actions=${actions} sampleIds=${sampleIds} />`)}
      </ul>`}
    </div>
    <${ConfirmModal} open=${!!c} title=${c ? (deleting ? `Delete ${c.summary.name}?` : `Reset ${c.summary.name}?`) : ''}
      confirmLabel=${deleting ? 'Delete' : 'Reset sample'} onConfirm=${actions.confirmNow} onClose=${() => actions.setConfirm(null)}
      extra=${deleting && !cSample ? html`<${Button} kind="secondary" icon="download" class="setup-modal-extra"
        onClick=${() => actions.downloadIt(c.summary)}>Download first<//>` : null}>
      ${c && (deleting
        ? html`<p>${cSample
          ? 'This removes your copy of the sample, with your reviews, from this browser. You can open a fresh copy at any time.'
          : `This removes the project and its ${plural(c.summary.reviewed || 0, 'reviewed trace')} from this browser. Download it first if you want to keep a copy.`}</p>`
        : html`<p>Your reviews, notes, and changes to this sample are replaced with the original. This cannot be undone.</p>`)}
    <//>
  </section>`;
}

// ---------------------------------------------------------------------------
// Project settings

const SECTIONS = [
  { id: 'product', label: 'Product' },
  { id: 'traces', label: 'Traces' },
  { id: 'pattern', label: 'How your AI works' },
  { id: 'stages', label: 'Stages' },
  { id: 'view', label: 'How the {user} sees it' },
  { id: 'filters', label: 'Filters' },
  { id: 'people', label: 'Reviewer and AI help' },
];

function setExperience(patch, reason = 'setup') {
  updateProject((p) => ({ ...p, experience: { ...p.experience, ...patch }, updatedAt: nowIso() }), reason);
}

function SectionNav({ value, onChange, user }) {
  const onKey = (e) => {
    const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const move = keys[e.key];
    if (!move) return;
    const items = [...e.currentTarget.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = items[(i + move + items.length) % items.length];
    next.focus();
    next.click();
  };
  return html`<div class="setup-nav" role="tablist" aria-label="Project settings" aria-orientation="vertical" onKeyDown=${onKey}>
    ${SECTIONS.map((s) => html`<button type="button" role="tab" key=${s.id} id=${'setup-tab-' + s.id}
      aria-selected=${s.id === value ? 'true' : 'false'} aria-controls="setup-panel" tabindex=${s.id === value ? 0 : -1}
      class=${classes('setup-nav-item', s.id === value && 'is-active')} onClick=${() => onChange(s.id)}>${say(s.label, user)}</button>`)}
  </div>`;
}

function SectionHead({ title, children }) {
  return html`<header class="setup-section-head">
    <h2>${title}</h2>
    ${children && html`<p class="soft">${children}</p>`}
  </header>`;
}

function ProductSection({ project, user }) {
  const uid = useId();
  const e = project.experience || {};
  return html`<div class="stack-lg">
    <${SectionHead} title="Product">What the product is and who uses it. These words show up across Eval Studio and in your report.<//>
    <div class="field">
      <label class="label" for=${uid + '-name'}>Product name</label>
      <${LiveText} entity=${project.id + ':name'} id=${uid + '-name'} value=${project.name} maxlength="80" autocomplete="off"
        onCommit=${(v) => {
          const name = v.trim();
          if (name) updateProject((p) => ({ ...p, name, experience: { ...p.experience, product: name }, updatedAt: nowIso() }), 'name');
        }} />
    </div>
    <div class="field">
      <span class="label" id=${uid + '-who'}>Who uses it?</span>
      <${UserPicker} id=${uid + '-who'} value=${user} live=${true} entity=${project.id} onChange=${(w) => setExperience({ userLabel: w })} />
      <p class="hint">Eval Studio uses this word everywhere, so your notes read from the ${user}'s side.</p>
    </div>
    <div class="field">
      <label class="label" for=${uid + '-goal'}>What is the ${user} trying to do?</label>
      <${LiveText} multiline=${true} rows="2" entity=${project.id + ':goal'} id=${uid + '-goal'} value=${e.customerGoal || ''} maxlength="300"
        onCommit=${(v) => setExperience({ customerGoal: v.trim() })} />
      <p class="hint">One sentence. AI judges and your report use it to describe a good outcome.</p>
    </div>
  </div>`;
}

function AddTracesCard({ project, versioned }) {
  const uid = useId();
  const versions = lib.traceVersions(project);
  const [name, setName] = useState(() => defaultVersionName(versions));
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState(null);
  const [reading, setReading] = useState(false);
  const clash = versioned && versions.includes(name.trim());

  const onFile = async (file) => {
    setResult(null);
    setProblem(null);
    setPending(null);
    if (versioned && !name.trim()) {
      setProblem({ errors: ['Name this version first.'] });
      return;
    }
    if (clash) {
      setProblem({ errors: [`Some traces already use the version name "${name.trim()}". Pick a new name.`] });
      return;
    }
    setReading(true);
    try {
      const text = await readFile(file);
      const res = lib.parseTraceFile(text, file.name, { fieldMap: project.experience && project.experience.fieldMap });
      if (!res.traces.length) {
        setProblem({ file: file.name, errors: res.errors.length ? res.errors : ['No traces were found in this file.'] });
      } else {
        setPending({ file: file.name, errors: res.errors, plan: planAdd(store.get().project, res.traces, versioned ? name.trim() : null) });
      }
    } catch (err) {
      setProblem({ file: file.name, errors: [errorMessage(err)] });
    } finally {
      setReading(false);
    }
  };

  const apply = () => {
    const plan = pending.plan;
    updateProject((p) => addTraces(p, planAdd(p, plan.fresh, plan.version)), versioned ? 'add version' : 'add traces');
    const text = `Added ${formatCount(plan.fresh.length)}, skipped ${formatCount(plan.skipped)} already here`;
    setResult(plan.capped ? `${text}. ${formatCount(plan.capped)} more did not fit: a project holds up to 20,000 traces.` : `${text}.`);
    toast(`${text}.`, { tone: 'good' });
    setPending(null);
    if (versioned) setName(defaultVersionName(lib.traceVersions(store.get().project)));
  };

  const plan = pending && pending.plan;
  const count = (project.traces || []).length;
  return html`<section class="setup-addcard" aria-labelledby=${uid}>
    <h3 id=${uid} class="setup-subtitle">${versioned ? 'Add traces from a new version' : 'Add traces'}</h3>
    <p class="soft">${versioned
      ? `Compare before and after a change. The new traces get this version name${versions.length ? '.' : `, and the ${plural(count, 'trace')} you have now become "Version 1".`}`
      : 'More traces from the same product. Traces with an id you already have are skipped.'}</p>
    ${versioned && html`<div class="field">
      <label class="label" for=${uid + '-v'}>Version name</label>
      <input id=${uid + '-v'} value=${name} maxlength="60" required aria-invalid=${clash || !name.trim() ? 'true' : undefined}
        onInput=${(e) => setName(e.currentTarget.value)} />
      ${clash ? html`<p class="error-text">Some traces already use this name. Pick a new one.</p>`
        : versions.length > 0 && html`<p class="hint">Versions so far: ${versions.join(', ')}</p>`}
    </div>`}
    ${!plan && !reading && html`<${FileDrop} accept=${TRACE_ACCEPT} onFile=${onFile} label="Choose a trace file" />`}
    ${reading && html`<div class="setup-loading" role="status"><span class="setup-spinner" aria-hidden="true"></span>Reading the file...</div>`}
    ${plan && html`<div class="setup-pending" role="status">
      <p class="setup-pending-file mono">${pending.file}</p>
      <p>${plan.fresh.length
        ? `${plural(plan.fresh.length, 'new trace')}${plan.skipped ? `, ${formatCount(plan.skipped)} already here` : ''}.`
        : `All ${plural(plan.skipped, 'trace')} in this file are already here.`}${plan.version && plan.fresh.length ? ` They will be tagged "${plan.version}".` : ''}${plan.capped ? ` ${formatCount(plan.capped)} will not fit: a project holds up to 20,000 traces.` : ''}</p>
      ${pending.errors.length > 0 && html`<${ErrorList} errors=${pending.errors} max=${3} />`}
      <div class="row">
        ${plan.fresh.length > 0 && html`<${Button} kind="primary" icon="plus" onClick=${apply}>Add ${plural(plan.fresh.length, 'trace')}<//>`}
        <${Button} kind="ghost" onClick=${() => setPending(null)}>${plan.fresh.length ? 'Cancel' : 'Choose another file'}<//>
      </div>
    </div>`}
    ${problem && html`<div class="setup-note is-bad" role="alert">
      ${problem.file && html`<p class="mono">${problem.file}</p>`}
      <${ErrorList} errors=${problem.errors} />
    </div>`}
    ${result && html`<p class="setup-result" role="status"><${Icon} name="check" /><span>${result}</span></p>`}
  </section>`;
}

function TracesSection({ project, user, kind, info }) {
  const traces = project.traces || [];
  const e = project.experience || {};
  const versions = lib.traceVersions(project);
  const shape = useMemo(() => mappedShapeLabel(traces, e.fieldMap), [traces, e.fieldMap]);
  const versionCounts = useMemo(() => {
    const m = new Map();
    for (const t of traces) {
      const v = t && t.metadata && t.metadata.version;
      if (v != null && v !== '') m.set(String(v), (m.get(String(v)) || 0) + 1);
    }
    return m;
  }, [traces]);
  const mapping = useMemo(() => needsMapping(traces, traces.length ? lib.detectShape(traces[0]) : 'unknown'), [traces]);
  const showMapper = !!e.fieldMap || mapping;
  return html`<div class="stack-lg">
    <${SectionHead} title="Traces">A trace is one full conversation or task, with every step the AI took and what the ${user} saw.<//>
    <dl class="setup-facts">
      <div class="setup-fact"><dt class="hint">Traces</dt><dd class="setup-fact-num num">${formatCount(traces.length)}</dd></div>
      <div class="setup-fact"><dt class="hint">Shape</dt><dd class="setup-fact-text">${shape}</dd></div>
      ${kind === 'folder' && html`<div class="setup-fact"><dt class="hint">Trace file</dt><dd class="setup-fact-text mono">${(info && info.tracesFile) || project.tracesFile || 'pmstack/project.json'}</dd></div>`}
    </dl>
    ${versions.length > 0 && html`<div class="table-wrap"><table class="table setup-versions">
      <thead><tr><th scope="col">Version</th><th scope="col" class="num">Traces</th></tr></thead>
      <tbody>${versions.map((v) => html`<tr key=${v}><td>${v}</td><td class="num">${formatCount(versionCounts.get(v) || 0)}</td></tr>`)}</tbody>
    </table></div>`}
    ${showMapper && html`<div class="card card-flat"><${FieldMapper} experience=${e} traces=${traces} user=${user} onChange=${(patch) => setExperience(patch)} /></div>`}
    <div class="setup-addgrid">
      <${AddTracesCard} project=${project} versioned=${false} />
      <${AddTracesCard} project=${project} versioned=${true} />
    </div>
    <div class="setup-download">
      <${Button} icon="download" onClick=${() => downloadFile(projectFile(store.get().project))}>Download project<//>
      <p class="hint">Everything you did, to reopen later or share with a teammate.</p>
    </div>
  </div>`;
}

function PatternSection({ project }) {
  const e = project.experience || {};
  const suggested = useMemo(() => lib.suggestPattern(project.traces || []), [project.traces]);
  const [replacing, setReplacing] = useState(false);
  const defaults = stagesFor(e.pattern);
  const same = JSON.stringify(defaults.map((s) => [s.id, s.label])) === JSON.stringify((e.stages || []).map((s) => [s.id, s.label]));
  const removed = (e.stages || []).map((s) => s.id).filter((id) => !defaults.some((s) => s.id === id));
  const confirm = () => {
    setReplacing(false);
    updateProject((p) => withStages(p, stagesFor(p.experience.pattern)), 'stages');
    toast(`Stages set to the ones for ${patternLabel(e.pattern)}.`);
  };
  return html`<div class="stack-lg">
    <${SectionHead} title="How your AI works">The closest match to how your product is built. It suggests the starting stages of your funnel.<//>
    <${PatternPicker} value=${e.pattern} suggested=${suggested} onPick=${(id) => setExperience({ pattern: id })}
      onNotSure=${() => setExperience({ pattern: suggested })} />
    ${!same && html`<div class="setup-note">
      <p>Your stages stay as they are when you change this. To start over from the stages for ${patternLabel(e.pattern)}, replace them.</p>
      <div><${Button} size="sm" onClick=${() => setReplacing(true)}>Use the stages for ${patternLabel(e.pattern)}<//></div>
    </div>`}
    <${ConfirmModal} open=${replacing} title=${`Use the stages for ${patternLabel(e.pattern)}?`} confirmLabel="Replace stages"
      onConfirm=${confirm} onClose=${() => setReplacing(false)}>
      <p>The new stages are ${defaults.map((s) => s.label).join(', ')}.</p>
      ${removed.length > 0 && html`<p>${usageSentence(stageUsage(project, removed))}</p>`}
    <//>
  </div>`;
}

function StagesSection({ project, user }) {
  const e = project.experience || {};
  const scan = useMemo(() => scanTraces(project.traces || [], e), [project.traces, e.stages, e.fieldMap]);
  const onStages = (stages) => {
    const keep = new Set(stages.map((s) => s.id));
    if ((e.stages || []).some((s) => !keep.has(s.id))) updateProject((p) => withStages(p, stages), 'stages');
    else setExperience({ stages }, 'stages');
  };
  return html`<div class="stack-lg">
    <${SectionHead} title="Stages">The steps of the funnel of an AI experience, in order. You can rename stages at any time; reviews keep their stage.<//>
    <${StageEditor} experience=${e} scan=${scan} live=${true} project=${project} user=${user} onStages=${onStages} />
  </div>`;
}

function ViewSection({ project, user }) {
  const e = project.experience || {};
  const traces = project.traces || [];
  const scan = useMemo(() => scanTraces(traces, e), [traces, e.stages, e.fieldMap]);
  const suggested = useMemo(() => lib.suggestView(traces), [traces]);
  return html`<div class="stack-lg">
    <${SectionHead} title=${`How the ${user} sees it`}>Pick the view that looks most like what the ${user} saw. The preview uses your traces.<//>
    ${traces.length
      ? html`<${ViewPicker} experience=${e} traces=${traces} scan=${scan} suggested=${suggested} live=${true} user=${user} onChange=${(patch) => setExperience(patch)} />`
      : html`<p class="setup-empty-line">Add traces first, then pick how they look.</p>`}
  </div>`;
}

function FiltersSection({ project }) {
  const e = project.experience || {};
  const traces = project.traces || [];
  const scan = useMemo(() => scanTraces(traces, e), [traces, e.stages, e.fieldMap]);
  const suggested = useMemo(() => lib.suggestFilters(traces), [traces]);
  return html`<div class="stack-lg">
    <${SectionHead} title="Filters">Details you can filter by in Review traces. Each one also shows how many traces you reviewed for each value.<//>
    <${FilterPicker} experience=${e} scan=${scan} suggested=${suggested} onChange=${(patch) => setExperience(patch)} />
  </div>`;
}

function NumberField({ entity, field, label, value, fallback, hint }) {
  const uid = useId();
  return html`<div class="field setup-number">
    <label class="label" for=${uid}>${label}</label>
    <div class="setup-number-row">
      <${LiveText} entity=${entity} id=${uid} type="number" min="0" max="1000" step="1" inputmode="numeric" value=${value ?? fallback}
        aria-describedby=${uid + '-unit'}
        onCommit=${(v) => {
          const n = Math.round(Number(v));
          if (String(v).trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1000) setExperience({ [field]: n });
        }} />
      <span class="soft" id=${uid + '-unit'}>reviewed traces</span>
    </div>
    ${hint && html`<p class="hint">${hint}</p>`}
  </div>`;
}

function PeopleSection({ project }) {
  const uid = useId();
  const e = project.experience || {};
  return html`<div class="stack-lg">
    <${SectionHead} title="Reviewer and AI help">Who sets the bar, and when AI help becomes available.<//>
    <div class="field">
      <label class="label" for=${uid}>Reviewer</label>
      <${LiveText} entity=${project.id + ':reviewer'} id=${uid} value=${e.reviewer || ''} maxlength="60" autocomplete="name"
        placeholder="For example: Priya (PM)" onCommit=${(v) => setExperience({ reviewer: v.trim() })} />
      <p class="hint">The person whose judgment sets the bar.</p>
    </div>
    <${NumberField} entity=${project.id + ':gate'} field="gate" label="Offer AI suggestions after" value=${e.gate} fallback=${10}
      hint="Reading traces yourself first keeps your judgment in charge. Not sure yet does not count." />
    <${NumberField} entity=${project.id + ':groupGate'} field="groupGate" label="Offer to group notes with AI after" value=${e.groupGate} fallback=${30}
      hint="By then you have enough notes to see which failure modes keep coming back." />
  </div>`;
}

function FolderCard({ project, info }) {
  const traces = project.traces || [];
  const stats = lib.reviewStats(project);
  const folderName = info && info.folder ? String(info.folder).split(/[\\/]/).filter(Boolean).pop() : 'Your folder';
  return html`<section class="card setup-projects setup-folder" aria-labelledby="setup-folder-title">
    <div class="setup-folder-head">
      <span class="setup-row-icon" aria-hidden="true"><${Icon} name="folder" size=${18} /></span>
      <div class="setup-row-main">
        <h2 id="setup-folder-title" class="setup-folder-name">${folderName}</h2>
        <p class="setup-row-meta num">${plural(traces.length, 'trace')} · ${reviewedLine(stats.reviewed, stats.total)}</p>
        <p class="hint mono setup-folder-path">${info && info.projectPath ? info.projectPath : 'pmstack/project.json'}</p>
      </div>
      <div class="setup-row-actions">
        <${Button} size="sm" icon="download" onClick=${() => downloadFile(projectFile(store.get().project))}>Download project<//>
        <${Button} size="sm" kind="ghost" icon="trash" disabled=${true} title="A folder project cannot be deleted from Eval Studio.">Delete<//>
      </div>
    </div>
    <p class="hint">This studio works on one folder, so it has one project. Sample products open in the <a href=${WEB_STUDIO_URL} target="_blank" rel="noopener noreferrer">web version of Eval Studio</a>.</p>
  </section>`;
}

function Settings({ project, kind, info, initial }) {
  const [section, setSection] = useState(() => (SECTIONS.some((s) => s.id === initial) ? initial : 'product'));
  const headRef = useRef(null);
  useEffect(() => {
    // Opened from a link to one section (#/setup/traces): bring the settings into view once the tab has settled.
    if (!initial) return undefined;
    const f = requestAnimationFrame(() => {
      const el = headRef.current;
      if (!el) return;
      const bar = document.querySelector('.topbar');
      scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - (bar ? bar.offsetHeight : 0) - 16) });
    });
    return () => cancelAnimationFrame(f);
  }, []);
  const user = lib.userWord(project.experience);
  const stats = lib.reviewStats(project);
  let panel;
  if (section === 'product') panel = html`<${ProductSection} project=${project} user=${user} />`;
  else if (section === 'traces') panel = html`<${TracesSection} project=${project} user=${user} kind=${kind} info=${info} />`;
  else if (section === 'pattern') panel = html`<${PatternSection} project=${project} />`;
  else if (section === 'stages') panel = html`<${StagesSection} project=${project} user=${user} />`;
  else if (section === 'view') panel = html`<${ViewSection} project=${project} user=${user} />`;
  else if (section === 'filters') panel = html`<${FiltersSection} project=${project} />`;
  else panel = html`<${PeopleSection} project=${project} />`;
  return html`<section class="setup-settings" aria-labelledby="setup-settings-title">
    <header class="setup-settings-head" ref=${headRef}>
      <p class="setup-eyebrow">Project settings</p>
      <h2 id="setup-settings-title" class="setup-settings-name"><span>${project.name}</span>${project.sample && html`<${Chip}>Sample data<//>`}</h2>
      <p class="hint num">${plural((project.traces || []).length, 'trace')} · ${formatCount(stats.reviewed)} reviewed${project.updatedAt ? ` · Updated ${shortDate(project.updatedAt)}` : ''}</p>
    </header>
    <div class="setup-settings-body">
      <${SectionNav} value=${section} onChange=${setSection} user=${user} />
      <div class="card setup-panel" id="setup-panel" role="tabpanel" aria-labelledby=${'setup-tab-' + section} key=${section}>${panel}</div>
    </div>
    <div class="setup-next">
      <${Button} kind="primary" size="lg" icon="arrow-right" onClick=${() => navigate('review')}>Next: Review traces<//>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// The tab

function SetupHome({ section }) {
  const project = useStore((s) => s.project);
  const kind = useStore((s) => s.storageKind);
  const info = useStore((s) => s.folder);
  const folder = kind === 'folder';
  return html`<section class="page setup-page" aria-labelledby="setup-title">
    <header class="setup-head">
      <div class="grow">
        <h1 id="setup-title" class="page-title">Set up</h1>
        <p class="page-lead">Load your traces and choose how your product looks.</p>
      </div>
      ${!folder && html`<div class="setup-head-actions">
        <${ImportProjectButton} />
        <${Button} kind="primary" icon="plus" onClick=${() => navigate('setup', 'new')}>New project<//>
      </div>`}
    </header>
    ${folder
      ? project
        ? html`<${FolderCard} project=${project} info=${info} />`
        : html`<p class="setup-empty-line" role="status">The folder project is loading.</p>`
      : html`<${ProjectList} />`}
    ${project
      ? html`<${Settings} key=${project.id} project=${project} kind=${kind} info=${info} initial=${section} />`
      : !folder && html`<div class="card setup-noproject">
        <${EmptyState} icon="folder" title="No project open"
          body="Open a project from the list, start one with your own traces, or open a sample product."
          action=${{ label: 'Review your own traces', icon: 'arrow-right', onClick: () => navigate('setup', 'new') }} />
      </div>`}
  </section>`;
}

/** Set up tab: #/setup shows projects and settings; #/setup/new starts the wizard; #/setup/<section> opens one settings section. */
export default function SetupView({ param }) {
  const kind = useStore((s) => s.storageKind);
  const hasProject = useStore((s) => !!s.project);
  if (param === 'new') {
    if (kind === 'folder' && !hasProject) {
      return html`<section class="page"><p class="setup-empty-line" role="status">The folder project is loading.</p></section>`;
    }
    return html`<${Wizard} />`;
  }
  return html`<${SetupHome} section=${param} />`;
}
