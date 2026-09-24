// Shared building blocks for Eval Studio views and trace views (SPEC 5.6).
// Import from 'pmstack/ui'. Components are written with htm: html`<${Button} kind="primary">Save<//>`.

import { h, render, Fragment, createContext } from 'preact';
import {
  useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect,
  useReducer, useErrorBoundary, useContext, useId,
} from 'preact/hooks';
import htm from 'htm';
import { store } from './store.mjs';
import { stageNumber, stageLabel } from './lib/index.mjs';

export const html = htm.bind(h);
export {
  h, render, Fragment, createContext,
  useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect,
  useReducer, useErrorBoundary, useContext, useId,
};

// ---------------------------------------------------------------------------
// Small helpers

/** Join class names; skips falsy values. classes('btn', on && 'is-on') */
export function classes(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** 2340 -> "2,340". */
export function formatCount(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** plural(3, 'trace') -> "3 traces"; plural(1, 'trace') -> "1 trace". */
export function plural(n, one, many = one + 's') {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** True on Apple keyboards, where "mod" means the Command key. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
/** How to show the "mod" key to the reader. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

/** Save text as a file on the reader's computer. */
export function download(filename, text, type = 'text/plain') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: /^text\/|json/.test(type) ? type + ';charset=utf-8' : type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Copy text to the clipboard. Resolves to true when it worked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or no permission: fall back to a hidden text area inside the open dialog, if any.
    const host = (document.activeElement && document.activeElement.closest('dialog')) || document.body;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    host.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Read a File as text. */
export function readFile(file) {
  return file.text();
}

// ---------------------------------------------------------------------------
// Store hooks

/** One level of equality for objects and arrays. */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  return true;
}

/** Read part of the store; re-renders only when selector(state) changes by `equal`. */
export function useStore(selector, equal = Object.is) {
  const [, force] = useReducer((n) => n + 1, 0);
  const value = selector(store.get());
  const ref = useRef({});
  ref.current.selector = selector;
  ref.current.equal = equal;
  ref.current.value = value;
  useLayoutEffect(() => {
    const check = () => {
      const r = ref.current;
      try {
        if (!r.equal(r.value, r.selector(store.get()))) force();
      } catch {
        force(); // let the render surface the problem
      }
    };
    const unsubscribe = store.subscribe(check);
    check(); // a change may have landed between render and subscribe
    return unsubscribe;
  }, []);
  return value;
}

// ---------------------------------------------------------------------------
// Keyboard: one window listener and a stack of scopes.
// The most recently activated scope is asked first. A scope that does not bind the key
// passes it down, except trap scopes (Drawer, Modal), which stop it.

const keyScopes = [];
let scopeSeq = 0;
let listening = false;

function keyName(e) {
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'Enter') return 'mod+Enter';
    if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) return 'mod+z';
    return null;
  }
  return e.key;
}

function skipForTarget(name, target) {
  const el = target && target.nodeType === 1 ? target : null;
  if (!el) return false;
  if (name === 'mod+Enter' || name === 'Escape') return false;
  const editable = el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  // In text fields only Escape and mod+Enter reach the scopes; mod+z stays the field's own undo.
  if (editable) return true;
  if (name.length === 1 || name === 'Enter') return !!el.closest('button, a');
  return false;
}

function lookup(map, name) {
  if (!map) return null;
  if (typeof map[name] === 'function') return map[name];
  if (name.length === 1) {
    const other = name === name.toLowerCase() ? name.toUpperCase() : name.toLowerCase();
    if (typeof map[other] === 'function') return map[other];
  }
  if (name === 'mod+z' && typeof map['mod+Z'] === 'function') return map['mod+Z'];
  return null;
}

function onWindowKey(e) {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  const name = keyName(e);
  if (!name || skipForTarget(name, e.target)) return;
  const ordered = keyScopes.slice().sort((a, b) => b.seq - a.seq);
  for (const scope of ordered) {
    const fn = lookup(scope.map.current, name);
    if (fn) {
      if (fn(e) !== false) e.preventDefault();
      return;
    }
    if (scope.trap) return;
  }
}

/**
 * Bind keys while mounted and active: useKeys({ 1: markGood, j: next, 'mod+Enter': saveAndNext }).
 * Key names are KeyboardEvent.key values ('1', 'j', '?', 'Enter', 'Escape') plus 'mod+Enter' and 'mod+z'.
 * A handler that returns false lets the browser's default action run.
 */
export function useKeys(map, { active = true, trap = false } = {}) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const scope = useRef(null);
  if (!scope.current) scope.current = { seq: 0, map: mapRef, trap, active: false };
  const s = scope.current;
  // Order by activation during render: parents render before children, so children win.
  if (active && !s.active) s.seq = ++scopeSeq;
  s.active = !!active;
  s.trap = trap;
  useLayoutEffect(() => {
    if (!active) return undefined;
    if (!listening) {
      addEventListener('keydown', onWindowKey);
      listening = true;
    }
    keyScopes.push(s);
    return () => {
      const i = keyScopes.indexOf(s);
      if (i >= 0) keyScopes.splice(i, 1);
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// Text drafts: typing never waits on the store, and store updates never reset what is being typed.

// Drafts still inside their 300 ms pause. They are committed when the page hides or closes, ahead of
// the store's own save and journal: these listeners are added at module load, before the store starts.
const waitingDrafts = new Set();

function commitWaitingDrafts() {
  for (const d of [...waitingDrafts]) {
    waitingDrafts.delete(d);
    if (!d.timer) continue;
    clearTimeout(d.timer);
    d.timer = 0;
    if (d.pending) d.pending(d.value);
  }
}

if (typeof addEventListener === 'function' && typeof document !== 'undefined') {
  addEventListener('beforeunload', commitWaitingDrafts);
  addEventListener('pagehide', commitWaitingDrafts);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commitWaitingDrafts();
  });
}

/**
 * Local draft for a text field tied to one entity (a trace, a mode).
 * const note = useDraft(traceId, review.note, (text) => updateProject((p) => setNote(p, traceId, text)));
 * html`<textarea value=${note.value} onInput=${note.onInput} onBlur=${note.onBlur} />`
 */
export function useDraft(entityId, storeValue, commit) {
  const [, force] = useReducer((n) => n + 1, 0);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const st = useRef(null);
  const incoming = storeValue ?? '';
  if (!st.current) st.current = { id: entityId, value: incoming, editing: false, timer: 0, pending: null };
  const s = st.current;

  if (s.id !== entityId) {
    // New entity: save what was typed for the old one, then seed from the store.
    waitingDrafts.delete(s);
    if (s.timer) {
      clearTimeout(s.timer);
      const fn = s.pending;
      const text = s.value;
      queueMicrotask(() => fn && fn(text));
    }
    Object.assign(s, { id: entityId, value: incoming, editing: false, timer: 0, pending: null });
  } else if (!s.editing && !s.timer) {
    s.value = incoming; // follow the store (undo, disk updates) while the reader is not typing
  }

  const commitNow = useCallback(() => {
    const d = st.current;
    waitingDrafts.delete(d);
    if (!d.timer) return d.value;
    clearTimeout(d.timer);
    d.timer = 0;
    if (d.pending) d.pending(d.value);
    return d.value;
  }, []);

  const onInput = useCallback((e) => {
    const d = st.current;
    d.value = typeof e === 'string' ? e : e.currentTarget.value;
    d.editing = true;
    d.pending = commitRef.current;
    clearTimeout(d.timer);
    d.timer = setTimeout(() => {
      d.timer = 0;
      waitingDrafts.delete(d);
      if (d.pending) d.pending(d.value);
    }, 300);
    waitingDrafts.add(d);
    force();
  }, []);

  const onBlur = useCallback(() => {
    st.current.editing = false;
    commitNow();
    force();
  }, []);

  const onFocus = useCallback(() => {
    st.current.editing = true;
  }, []);

  // Unmounting (for example the judgment panel keyed by trace) saves what was typed.
  useEffect(() => () => commitNow(), []);

  return { value: s.value, onInput, onBlur, onFocus, commitNow };
}

// ---------------------------------------------------------------------------
// Icons: 24 x 24 grid, 1.75 stroke, round caps. Strings are stroked paths; { d, fill: true } is filled.

const ICONS = {
  check: ['M4.5 12.5l5 5L19.5 7'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  skip: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
  note: ['M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M14 20v-5a1 1 0 0 1 1-1h5', 'M8 9h8', 'M8 12.5h4'],
  stage: ['M3 17h5v-4h5V9h5V5h3'],
  filter: ['M4 5h16l-6 7.5V19l-4 1.5v-8z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'],
  copy: ['M9 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M16 8V5a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2'],
  download: ['M12 4v11', 'M7 10.5l5 5 5-5', 'M5 20h14'],
  upload: ['M12 16V5', 'M7 9.5l5-5 5 5', 'M5 20h14'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  help: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5', 'M12 17h.01'],
  folder: ['M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  warning: ['M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1A2 2 0 0 1 19 20H5a2 2 0 0 1-1.7-3z', 'M12 10v4', 'M12 17h.01'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20c1.3-3.2 4.1-5 7.5-5s6.2 1.8 7.5 5'],
  code: ['M9 7l-5 5 5 5', 'M15 7l5 5-5 5'],
  judge: ['M12 4v16', 'M8 20h8', 'M5 7h14', 'M5 7l-2.5 6h5z', 'M19 7l-2.5 6h5z'],
  chat: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z'],
  email: ['M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4.5 6.5l7.5 6 7.5-6'],
  doc: ['M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M14 3v5h5', 'M8.5 13h7', 'M8.5 17h7'],
  answer: ['M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z', 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z'],
  agent: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v4h-4', 'M12 12h.01'],
  diff: ['M7 4v6', 'M4 7h6', 'M14 17h6', 'M5 19L19 5'],
  fields: ['M4 6h4', 'M11 4h9v4h-9z', 'M4 12h4', 'M11 10h9v4h-9z', 'M4 18h4', 'M11 16h9v4h-9z'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  layout: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 10h16', 'M10 10v10'],
  phone: ['M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12', 'M9 7V4h6v3'],
  merge: ['M6 4v5c0 3 6 4 6 7v4', 'M18 4v5c0 3-6 4-6 7', 'M9 17l3 3 3-3'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2.5v2', 'M12 19.5v2', 'M4.6 4.6L6 6', 'M18 18l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M4.6 19.4L6 18', 'M18 6l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  auto: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', { d: 'M12 3a9 9 0 0 1 0 18z', fill: true }],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a5 5 0 0 1 0 10h-3'],
};

/** Add an icon: registerIcon('flag', ['M5 20V4', 'M5 4h11l-2 4 2 4H5']). Call at module load. */
export function registerIcon(name, paths) {
  ICONS[name] = paths;
}

/** Inline stroke icon. With `label` it is announced; without, it is hidden from screen readers. */
export function Icon({ name, size = 16, label }) {
  const parts = ICONS[name] || [];
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false"
    role=${label ? 'img' : undefined} aria-label=${label || undefined} aria-hidden=${label ? undefined : 'true'}>
    ${parts.map((p) => (typeof p === 'string'
      ? html`<path d=${p} />`
      : html`<path d=${p.d} fill="currentColor" stroke="none" />`))}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Controls

/** Button. kind: primary | secondary | ghost | good | bad; size: sm | md | lg. Extra props pass through. */
export function Button({ kind = 'secondary', size = 'md', icon, onClick, disabled, title, type = 'button', children, class: cls, ...rest }) {
  const hasLabel = children != null && children !== false && children !== '';
  return html`<button type=${type} class=${classes('btn', 'btn-' + kind, 'btn-' + size, !hasLabel && icon && 'btn-icon', cls)}
    onClick=${onClick} disabled=${disabled} title=${title} aria-label=${!hasLabel && title ? title : undefined} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${size === 'lg' ? 18 : 16} />`}
    ${hasLabel && html`<span class="btn-label">${children}</span>`}
  </button>`;
}

/** Chip. tone: neutral | good | bad | ai | warn. With onClick it is a toggle button (aria-pressed). */
export function Chip({ tone = 'neutral', selected = false, onClick, title, children, class: cls, ...rest }) {
  const c = classes('chip', 'chip-' + tone, selected && 'is-selected', onClick && 'chip-button', cls);
  if (onClick) {
    return html`<button type="button" class=${c} aria-pressed=${selected ? 'true' : 'false'} title=${title} onClick=${onClick} ...${rest}>${children}</button>`;
  }
  return html`<span class=${c} title=${title} ...${rest}>${children}</span>`;
}

/** Neutral stage chip with the stage number and label ("2 Hand off when needed"). */
export function StageChip({ experience, stageId, selected, onClick }) {
  let number = null;
  let label = stageId || 'Unknown stage';
  if (experience) {
    try {
      number = stageId && stageId !== 'unknown' ? stageNumber(experience, stageId) : null;
      label = stageLabel(experience, stageId);
    } catch {
      // Fall back to the raw id if the setup is incomplete.
    }
  }
  return html`<${Chip} tone="neutral" class="stage-chip" selected=${selected} onClick=${onClick} title=${label}>
    ${number != null && html`<span class="stage-num" aria-hidden="true">${number}</span>`}
    <span class="stage-label">${number != null && html`<span class="sr-only">Stage ${number}: </span>`}${label}</span>
  <//>`;
}

// Arrow keys move between sibling buttons in tab lists and segmented controls.
function arrowNav(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
  const move = keys[e.key];
  if (!move) return;
  const items = [...e.currentTarget.querySelectorAll('button:not([disabled])')];
  const i = items.indexOf(document.activeElement);
  if (i === -1) return;
  e.preventDefault();
  const next = move === 'first' ? 0 : move === 'last' ? items.length - 1 : (i + move + items.length) % items.length;
  items[next].focus();
  items[next].click();
}

/** Tabs: items [{ id, label, badge }]. Renders the tab buttons; the caller renders the panel. */
export function Tabs({ items = [], value, onChange, label }) {
  return html`<div class="tabs" role="tablist" aria-label=${label} onKeyDown=${arrowNav}>
    ${items.map((it) => html`<button type="button" role="tab" key=${it.id} class=${classes('tab', it.id === value && 'is-active')}
      aria-selected=${it.id === value ? 'true' : 'false'} tabindex=${it.id === value ? 0 : -1}
      onClick=${() => it.id !== value && onChange && onChange(it.id)}>
      <span>${it.label}</span>
      ${it.badge != null && it.badge !== '' && html`<span class="badge">${it.badge}</span>`}
    </button>`)}
  </div>`;
}

/** Segmented control: options [{ value, label }], one chosen. */
export function Segmented({ options = [], value, onChange, label }) {
  return html`<div class="segmented" role="radiogroup" aria-label=${label} onKeyDown=${arrowNav}>
    ${options.map((o) => html`<button type="button" role="radio" key=${String(o.value)} class=${classes('segment', o.value === value && 'is-active')}
      aria-checked=${o.value === value ? 'true' : 'false'} tabindex=${o.value === value || (value == null && o === options[0]) ? 0 : -1}
      onClick=${() => o.value !== value && onChange && onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

/** Hover text through the title attribute. */
export function Tooltip({ text, children }) {
  return html`<span class="tooltip" title=${text}>${children}</span>`;
}

/** Keyboard key: html`<${Kbd}>J<//>`. */
export function Kbd({ children }) {
  return html`<kbd class="kbd">${children}</kbd>`;
}

/** Empty state. action is a vnode or { label, onClick, icon }; views end with a "Next: <tab>" action. */
export function EmptyState({ icon, title, body, action }) {
  const act = action && action.label
    ? html`<${Button} kind="primary" icon=${action.icon || 'arrow-right'} onClick=${action.onClick}>${action.label}<//>`
    : action;
  return html`<div class="empty">
    ${icon && html`<div class="empty-icon"><${Icon} name=${icon} size=${20} /></div>`}
    ${title && html`<h2 class="empty-title">${title}</h2>`}
    ${body && html`<p class="empty-body">${body}</p>`}
    ${act && html`<div class="empty-action">${act}</div>`}
  </div>`;
}

/** Thin progress bar. */
export function ProgressBar({ value = 0, max = 100, label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return html`<div class="progress" role="progressbar" aria-label=${label} aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value}>
    <span class="progress-fill" style=${{ width: pct + '%' }}></span>
  </div>`;
}

/** Tiny line chart for a short series (for example new failure modes per 10 traces). */
export function Spark({ values = [], label, width = 80, height = 24 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = (width - 4) / (values.length - 1);
  const pts = values.map((v, i) => [2 + i * step, height - 3 - (v / max) * (height - 6)]);
  const last = pts[pts.length - 1];
  return html`<svg class="spark" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} role="img"
    aria-label=${label || 'Trend: ' + values.join(', ')}>
    <polyline points=${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')} fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx=${last[0].toFixed(1)} cy=${last[1].toFixed(1)} r="2" fill="currentColor" />
  </svg>`;
}

/** Copy button with a short "Copied" confirmation. text may be a string or a function returning one. */
export function CopyButton({ text, label = 'Copy', kind = 'secondary', size = 'sm' }) {
  const [done, setDone] = useState('');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(typeof text === 'function' ? text() : String(text ?? ''));
    setDone(ok ? 'Copied' : 'Could not copy');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(''), 1600);
  };
  return html`<${Button} kind=${kind} size=${size} icon=${done === 'Copied' ? 'check' : 'copy'} onClick=${onClick} aria-live="polite">${done || label}<//>`;
}

/** Download button with an optional helper line. getText may return a string or a promise of one. */
export function DownloadButton({ filename, getText, type = 'text/plain', label = 'Download', help, kind = 'secondary', size = 'md', onDone }) {
  const onClick = async () => {
    try {
      const text = await getText();
      download(typeof filename === 'function' ? filename() : filename, text, type);
      if (onDone) onDone();
    } catch (err) {
      toast('Could not prepare the download: ' + err.message, { tone: 'bad' });
    }
  };
  return html`<div class="download">
    <${Button} kind=${kind} size=${size} icon="download" onClick=${onClick}>${label}<//>
    ${help && html`<p class="hint">${help}</p>`}
  </div>`;
}

/** File picker that also accepts a dropped file. onFile(file) gets a File; use readFile(file) for its text. */
export function FileDrop({ accept, onFile, label = 'Choose a file' }) {
  const [over, setOver] = useState(false);
  const pick = (file) => {
    if (file && onFile) onFile(file);
  };
  return html`<label class=${classes('filedrop', over && 'is-over')}
    onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer && e.dataTransfer.files[0]); }}>
    <input class="sr-only" type="file" accept=${accept}
      onInput=${(e) => { pick(e.currentTarget.files[0]); e.currentTarget.value = ''; }} />
    <${Icon} name="upload" size=${20} />
    <span class="filedrop-label">${label}</span>
    <span class="filedrop-hint">or drop it here</span>
  </label>`;
}

/** Catches errors thrown while drawing children. fallback is a vnode or (error, reset) => vnode. */
export function RendererBoundary({ fallback = null, children }) {
  const [error, reset] = useErrorBoundary();
  if (error) return typeof fallback === 'function' ? fallback(error, reset) : fallback;
  return children;
}

// ---------------------------------------------------------------------------
// Dialogs on native <dialog>: focus stays inside, Escape closes, the page behind is inert.

function useDialog(open, onClose) {
  const ref = useRef(null);
  const live = useRef({ open, onClose });
  live.current = { open, onClose };
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    let downOnBackdrop = false;
    const close = () => live.current.onClose && live.current.onClose();
    const onCancel = (e) => {
      e.preventDefault();
      close();
    };
    const onClosed = () => {
      if (live.current.open) close(); // closed by the browser while the owner still thinks it is open
    };
    const onDown = (e) => {
      downOnBackdrop = e.target === d;
    };
    const onClick = (e) => {
      if (downOnBackdrop && e.target === d) close();
      downOnBackdrop = false;
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClosed);
    d.addEventListener('mousedown', onDown);
    d.addEventListener('click', onClick);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onClosed);
      d.removeEventListener('mousedown', onDown);
      d.removeEventListener('click', onClick);
      if (d.open) d.close();
    };
  }, []);
  return ref;
}

/** Centered dialog. Children render only while open. */
export function Modal({ open, title, onClose, footer, children, class: cls }) {
  const ref = useDialog(open, onClose);
  const id = useId();
  useKeys({}, { active: !!open, trap: true });
  return html`<dialog ref=${ref} class=${classes('modal', cls)} aria-labelledby=${'dlg' + id}>
    ${open && html`<div class="modal-box">
      <header class="dialog-head">
        <h2 class="dialog-title" id=${'dlg' + id}>${title}</h2>
        <${Button} kind="ghost" size="sm" icon="x" title="Close" onClick=${onClose} />
      </header>
      <div class="dialog-body">${children}</div>
      ${footer && html`<footer class="dialog-foot">${footer}</footer>`}
    </div>`}
  </dialog>`;
}

/** Side drawer. Children render only while open, so their key bindings exist only then. */
export function Drawer({ open, title, side = 'right', onClose, children, class: cls }) {
  const ref = useDialog(open, onClose);
  const id = useId();
  useKeys({}, { active: !!open, trap: true });
  return html`<dialog ref=${ref} class=${classes('drawer', 'drawer-' + side, cls)} aria-labelledby=${'dlg' + id}>
    ${open && html`<div class="drawer-box">
      <header class="dialog-head">
        <h2 class="dialog-title" id=${'dlg' + id}>${title}</h2>
        <${Button} kind="ghost" size="sm" icon="x" title="Close" onClick=${onClose} />
      </header>
      <div class="dialog-body">${children}</div>
    </div>`}
  </dialog>`;
}

/**
 * Menu on a button, using the browser's popover (closes on outside click and Escape).
 * items: [{ label, onClick, disabled, danger, hint, selected, icon }] with 'divider' between groups.
 */
export function Menu({ label, icon, items = [], align = 'start', kind = 'secondary', size = 'md', title, class: cls }) {
  const id = 'menu' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const btn = useRef(null);
  const pop = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = pop.current;
    if (!el || !el.showPopover) return undefined;
    const close = () => {
      try { el.hidePopover(); } catch { /* already closed */ }
    };
    const onScroll = (e) => {
      if (!el.contains(e.target)) close();
    };
    // Open below the button, or above it when the menu does not fit below and there is more room above.
    const placeY = (height) => {
      const r = btn.current.getBoundingClientRect();
      const below = innerHeight - r.bottom - 12;
      const above = r.top - 12;
      if (height > below && above > below) {
        el.style.top = 'auto';
        el.style.bottom = Math.round(innerHeight - r.top + 4) + 'px';
        el.style.maxHeight = Math.round(Math.min(440, above)) + 'px';
      } else {
        el.style.bottom = 'auto';
        el.style.top = Math.round(r.bottom + 4) + 'px';
        el.style.maxHeight = Math.round(Math.max(120, Math.min(440, below))) + 'px';
      }
    };
    const place = (e) => {
      if (e.newState !== 'open') return;
      const r = btn.current.getBoundingClientRect();
      // The menu is not drawn yet, so estimate its height from its rows; onToggle measures it.
      const rows = el.querySelectorAll('.menu-item').length;
      const hints = el.querySelectorAll('.menu-item-hint').length;
      const dividers = el.querySelectorAll('.menu-divider').length;
      placeY(10 + rows * 38 + hints * 18 + dividers * 9);
      if (align === 'end') {
        el.style.left = 'auto';
        el.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
      } else {
        el.style.right = 'auto';
        el.style.left = Math.max(8, Math.min(Math.round(r.left), innerWidth - 248)) + 'px';
      }
    };
    const onToggle = (e) => {
      const isOpen = e.newState === 'open';
      setOpen(isOpen);
      if (isOpen) {
        placeY(el.scrollHeight);
        addEventListener('resize', close);
        addEventListener('scroll', onScroll, true);
        const first = el.querySelector('.menu-item:not([disabled])');
        if (first) first.focus();
      } else {
        removeEventListener('resize', close);
        removeEventListener('scroll', onScroll, true);
      }
    };
    el.addEventListener('beforetoggle', place);
    el.addEventListener('toggle', onToggle);
    return () => {
      el.removeEventListener('beforetoggle', place);
      el.removeEventListener('toggle', onToggle);
      removeEventListener('resize', close);
      removeEventListener('scroll', onScroll, true);
    };
  }, [align]);
  const choose = (item) => {
    try { pop.current.hidePopover(); } catch { /* already closed */ }
    if (btn.current) btn.current.focus();
    if (item.onClick) item.onClick();
  };
  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = [...e.currentTarget.querySelectorAll('.menu-item:not([disabled])')];
    const i = list.indexOf(document.activeElement);
    e.preventDefault();
    const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    if (next) next.focus();
  };
  return html`<span class=${classes('menu-wrap', cls)}>
    <button type="button" ref=${btn} class=${classes('btn', 'btn-' + kind, 'btn-' + size, 'menu-button', !label && 'btn-icon')}
      popovertarget=${id} aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} title=${title} aria-label=${!label && title ? title : undefined}>
      ${icon && html`<${Icon} name=${icon} />`}
      ${label && html`<span class="btn-label">${label}</span>`}
      <${Icon} name="chevron-down" size=${14} />
    </button>
    <div id=${id} ref=${pop} popover="auto" class="menu" role="menu" onKeyDown=${onMenuKey}>
      ${items.filter(Boolean).map((item, i) => (item === 'divider'
        ? html`<div class="menu-divider" role="separator" key=${'d' + i}></div>`
        : html`<button type="button" role="menuitem" key=${'i' + i} class=${classes('menu-item', item.danger && 'is-danger', item.selected && 'is-selected')}
            disabled=${item.disabled} onClick=${() => choose(item)}>
            ${item.icon && html`<${Icon} name=${item.icon} />`}
            <span class="menu-item-text"><span class="menu-item-label">${item.label}</span>${item.hint && html`<span class="menu-item-hint">${item.hint}</span>`}</span>
            ${item.selected && html`<${Icon} name="check" label="Current" />`}
          </button>`))}
    </div>
  </span>`;
}

// ---------------------------------------------------------------------------
// Toasts: short messages at the bottom of the screen, shown above open drawers.

let toasts = [];
let toastSeq = 0;
const toastSubscribers = new Set();

function emitToasts() {
  for (const fn of toastSubscribers) fn(toasts);
}

/** Show a message. Options: action { label, onClick }, tone (neutral | good | bad), sticky, timeout (ms). */
export function toast(message, { action, tone = 'neutral', sticky = false, timeout } = {}) {
  const same = toasts.find((t) => t.message === message);
  if (same) return same.id;
  const id = ++toastSeq;
  toasts = [...toasts, { id, message, action, tone }].slice(-4);
  emitToasts();
  if (!sticky) setTimeout(() => dismissToast(id), timeout ?? (action ? 10000 : 5000));
  return id;
}

/** Remove a toast by id. */
export function dismissToast(id) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emitToasts();
}

/** Renders the toasts. app.mjs mounts one. */
export function Toaster() {
  const [list, setList] = useState(toasts);
  const ref = useRef(null);
  useEffect(() => {
    toastSubscribers.add(setList);
    setList(toasts);
    return () => toastSubscribers.delete(setList);
  }, []);
  useLayoutEffect(() => {
    // Re-enter the top layer so a new toast shows above any open drawer.
    const el = ref.current;
    if (!el || !el.showPopover) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (list.length) el.showPopover();
    } catch {
      // Popover not supported: the toaster still shows in normal flow.
    }
  }, [list]);
  return html`<div ref=${ref} class="toaster" popover="manual" role="status" aria-live="polite">
    ${list.map((t) => html`<div class=${classes('toast', 'toast-' + t.tone)} key=${t.id}>
      <span class="toast-text">${t.message}</span>
      ${t.action && html`<${Button} kind="secondary" size="sm" onClick=${() => { dismissToast(t.id); t.action.onClick(); }}>${t.action.label}<//>`}
      <${Button} kind="ghost" size="sm" icon="x" title="Dismiss" onClick=${() => dismissToast(t.id)} />
    </div>`)}
  </div>`;
}
