// Shared pieces for Review traces and other views: the trace list, the judgment panel,
// per-trace undo, AI suggestion highlights, and Tool call checks badges for a trace.

import {
  html, useState, useEffect, useLayoutEffect, useRef, useKeys, useDraft, useStore,
  Button, Chip, StageChip, Modal, Icon, Kbd, classes, plural, formatCount, toast, MOD_LABEL,
} from 'pmstack/ui';
import { store, updateProject, navigate, setUi, flush, hashFor, DEFAULT_FILTERS } from '../store.mjs';
import * as lib from '../lib/index.mjs';

export { LabelDrawer, labelQueue, labelCounts } from './label-drawer.mjs';

const EMPTY = Object.freeze([]);

// ---------------------------------------------------------------------------
// Small helpers

/** Match a media query and follow its changes: useMedia('(max-width: 899px)'). */
export function useMedia(query) {
  const read = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [on, setOn] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return on;
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 3).replace(/\s+\S*$/, '') + '...' : s);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const words = (s) => oneLine(s).split(' ').filter(Boolean).length;

/** The AI gates for a project: { gate, groupGate } (defaults 10 and 30). */
export function gates(project) {
  const exp = project?.experience || {};
  return {
    gate: Number.isFinite(exp.gate) ? exp.gate : 10,
    groupGate: Number.isFinite(exp.groupGate) ? exp.groupGate : 30,
  };
}

/** How a review shows in lists: 'pass' | 'fail' | 'skip' | 'todo'. */
export function verdictKey(review) {
  const v = review?.verdict;
  return v === 'pass' || v === 'fail' || v === 'skip' ? v : 'todo';
}

const STATUS = {
  pass: { label: 'Good', icon: 'check' },
  fail: { label: 'Problem', icon: 'x' },
  skip: { label: 'Not sure yet', icon: 'skip' },
  todo: { label: 'To review', icon: null },
};

/** Status mark for a trace: an icon plus the word for screen readers. */
export function StatusIcon({ verdict }) {
  const key = STATUS[verdict] ? verdict : 'todo';
  const s = STATUS[key];
  return html`<span class=${classes('review-status', 'is-' + key)}>
    ${s.icon && html`<${Icon} name=${s.icon} size=${12} />`}
    <span class="sr-only">${s.label}.</span>
  </span>`;
}

function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

function shortDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Row text for the trace list (memoized per normalized set and filter keys)

const ROWS = new WeakMap();

function outputLine(n) {
  const o = n.output;
  if (!o) return '';
  if (o.type === 'text') return o.text || '';
  const lead = [o.subject, o.text, o.intro, o.summary, o.body].find((v) => typeof v === 'string' && v.trim());
  if (lead) return lead;
  try {
    return lib.outputText(o) || '';
  } catch {
    return '';
  }
}

const ELLIPSIS = String.fromCharCode(0x2026);

function describeTrace(n, filters) {
  const title = oneLine(n.title || n.id);
  const stem = title.endsWith(ELLIPSIS) ? title.slice(0, -1).trim() : title;
  const user = (n.steps || EMPTY).find((s) => s.kind === 'user' && s.text);
  let snippet = '';
  for (const c of [user && user.text, n.input, outputLine(n)]) {
    const line = oneLine(c);
    if (line && !line.startsWith(stem) && !stem.startsWith(line)) {
      snippet = clip(line, 160);
      break;
    }
  }
  const chips = [];
  for (const k of filters) {
    const v = n.metadata?.[k];
    if (v == null || v === '' || k === 'version') continue;
    chips.push({ key: k, value: String(v) });
    if (chips.length === 2) break;
  }
  return { title: clip(title, 140), snippet, chips };
}

/** Title, one-line snippet, and detail chips for one trace. */
export function traceRow(project, id) {
  const norm = lib.normalizeAll(project);
  const filters = project.experience?.filters || EMPTY;
  let table = ROWS.get(norm);
  if (!table || table.filters !== filters) {
    table = { filters, rows: new Map() };
    ROWS.set(norm, table);
  }
  let row = table.rows.get(id);
  if (!row) {
    const n = norm.get(id);
    row = n ? describeTrace(n, filters) : { title: id, snippet: '', chips: [] };
    table.rows.set(id, row);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Trace list

function TraceRow({ id, info, review, current, flagged, onOpen }) {
  const vk = verdictKey(review);
  const needsNote = vk === 'fail' && !String(review.note || '').trim();
  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(id, e.detail > 0);
  };
  return html`<li class="review-row-item">
    <a class=${classes('review-row', current && 'is-current')} href=${hashFor('review', id)} data-trace-id=${id}
      aria-current=${current ? 'true' : undefined} onClick=${onClick}>
      <${StatusIcon} verdict=${vk} />
      <span class="review-row-body">
        <span class="review-row-title">${info.title}</span>
        ${info.snippet && html`<span class="review-row-snippet">${info.snippet}</span>`}
        ${(info.chips.length > 0 || needsNote || flagged) && html`<span class="review-row-tags">
          ${needsNote && html`<span class="review-tag is-note">Needs a note</span>`}
          ${flagged && html`<span class="review-tag is-ai"><${Icon} name="sparkle" size=${11} />AI flagged</span>`}
          ${info.chips.map((c) => html`<span class="review-tag" key=${c.key} title=${c.key + ': ' + c.value}>${c.value}</span>`)}
        </span>`}
      </span>
    </a>
  </li>`;
}

// Arrow keys move focus between rows inside the list (no global arrow bindings).
function listKeys(e) {
  const keys = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
  const move = keys[e.key];
  if (!move) return;
  const rows = [...e.currentTarget.querySelectorAll('a.review-row')];
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement);
  e.preventDefault();
  const j = move === 'first' ? 0 : move === 'last' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, i === -1 ? 0 : i + move));
  rows[j].focus();
}

/**
 * The list of traces: status, title, one-line snippet, detail chips, "Needs a note".
 * Shows `cap` rows, then "Show 200 more". onOpen(id, byPointer) opens a trace.
 */
export function TraceList({ project, ids, currentId, cap = 200, onShowMore, onOpen, flaggedIds = null, label = 'Traces' }) {
  const listRef = useRef(null);
  const reviews = project.reviews || {};
  const shown = ids.length > cap ? ids.slice(0, cap) : ids;

  useLayoutEffect(() => {
    // Keep the open trace in view inside the scrolling rail.
    const list = listRef.current;
    if (!list || !currentId) return;
    const row = list.querySelector(`[data-trace-id="${cssEscape(currentId)}"]`);
    const box = list.closest('.review-scroll');
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + 8) box.scrollTop -= b.top + 8 - r.top + 48;
    else if (r.bottom > b.bottom - 8) box.scrollTop += r.bottom - (b.bottom - 8) + 48;
  }, [currentId]);

  return html`<div class="review-list-wrap">
    <ol class="review-list" ref=${listRef} aria-label=${label} onKeyDown=${listKeys}>
      ${shown.map((id) => html`<${TraceRow} key=${id} id=${id} info=${traceRow(project, id)} review=${reviews[id]}
        current=${id === currentId} flagged=${!!(flaggedIds && flaggedIds.has(id))} onOpen=${onOpen} />`)}
    </ol>
    ${ids.length > cap && html`<div class="review-list-more">
      <p class="hint">Showing ${formatCount(cap)} of ${formatCount(ids.length)}</p>
      <${Button} kind="secondary" size="sm" onClick=${onShowMore}>Show ${formatCount(Math.min(200, ids.length - cap))} more<//>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Undo: the last changes on each trace, kept for this page view.

const UNDO = new Map(); // projectId -> Map(traceId -> snapshots)

function stackFor(projectId, traceId) {
  let byTrace = UNDO.get(projectId);
  if (!byTrace) {
    byTrace = new Map();
    UNDO.set(projectId, byTrace);
  }
  let stack = byTrace.get(traceId);
  if (!stack) {
    stack = [];
    byTrace.set(traceId, stack);
  }
  return stack;
}

const touches = (s, traceId) => ((s.kind === 'flag' || s.kind === 'assign') && s.traceId === traceId)
  || (s.kind === 'mode' && (s.traceIds || EMPTY).includes(traceId));

// Everything a change on one trace can touch: its review, its labels, its suggestions.
function snapshotTrace(p, traceId) {
  const labels = {};
  for (const [modeId, map] of Object.entries(p.labels || {})) labels[modeId] = map?.[traceId] ?? null;
  const suggestions = {};
  for (const s of p.suggestions || EMPTY) if (touches(s, traceId)) suggestions[s.id] = s.status;
  return { review: p.reviews?.[traceId] ?? null, labels, suggestions };
}

function restoreTrace(p, traceId, snap) {
  let q = p;
  const modeIds = new Set([...Object.keys(q.labels || {}), ...Object.keys(snap.labels)]);
  for (const modeId of modeIds) {
    const want = snap.labels[modeId] ?? null;
    if ((q.labels?.[modeId]?.[traceId] ?? null) !== want) q = lib.setLabel(q, modeId, traceId, want);
  }
  const back = snap.suggestions;
  if ((q.suggestions || EMPTY).some((s) => s.id in back && s.status !== back[s.id])) {
    q = { ...q, suggestions: q.suggestions.map((s) => (s.id in back && s.status !== back[s.id] ? { ...s, status: back[s.id] } : s)) };
  }
  return lib.restoreReview(q, traceId, snap.review);
}

/** Change the project for one trace and remember how to undo it. fn(project) returns the next project. */
export function changeTrace(traceId, fn, reason = 'review') {
  updateProject((p) => {
    const before = snapshotTrace(p, traceId);
    const next = fn(p);
    if (next && next !== p) {
      const stack = stackFor(p.id, traceId);
      stack.push(before);
      if (stack.length > 60) stack.shift();
    }
    return next;
  }, reason);
}

/**
 * Open Review traces on one trace from another tab. The list shows all traces (not only the
 * current set) narrowed by `filters`, so J and K stay inside the group the reader clicked.
 * With stepId, Review shows the steps behind the scenes and scrolls to that step.
 */
export function openInReview(traceId, filters = {}, stepId = null) {
  const focus = traceId && stepId ? { focusStep: { traceId: String(traceId), stepId: String(stepId) }, showHidden: true } : { focusStep: null };
  setUi({ filters: { ...DEFAULT_FILTERS, ...filters, scope: 'all' }, ...focus });
  navigate('review', traceId || null);
}

/** True when there is a change on this trace to undo. */
export function canUndo(projectId, traceId) {
  return !!UNDO.get(projectId)?.get(traceId)?.length;
}

/** Undo the last change on one trace. Returns false when there is nothing to undo. */
export function undoTrace(traceId) {
  const p = store.get().project;
  if (!p) return false;
  const snap = stackFor(p.id, traceId).pop();
  if (!snap) return false;
  updateProject((q) => restoreTrace(q, traceId, snap), 'undo');
  return true;
}

// ---------------------------------------------------------------------------
// AI suggestions and Tool call checks for one trace

/** Open suggestions for a trace (flags and assigns whose failure mode still exists, and suggested modes). */
export function traceFlags(project, traceId) {
  const modes = lib.modeMap(project);
  return lib.openSuggestionsFor(project, traceId).filter((s) => s.kind === 'mode' || modes.has(s.modeId));
}

/** Highlights for the trace view: the quote of each open AI suggestion, in the step that holds it. */
export function suggestionHighlights(suggestions, trace) {
  const out = [];
  if (!trace) return out;
  const steps = trace.steps || EMPTY;
  for (const s of suggestions) {
    const q = String(s.quote || '').trim();
    if (!q || (s.kind !== 'flag' && s.kind !== 'assign')) continue;
    const lower = q.toLowerCase();
    const step = steps.find((st) => st.text && st.text.includes(q)) || steps.find((st) => st.text && st.text.toLowerCase().includes(lower));
    if (step) out.push({ stepId: step.id, quote: q, tone: 'ai' });
  }
  return out;
}

function outputStepId(trace) {
  if (trace.output?.stepId) return trace.output.stepId;
  const s = (trace.steps || EMPTY).find((x) => x.isOutput);
  return s ? s.id : null;
}

function appliesTo(check, trace) {
  const w = check.when;
  if (!w || !w.path) return true;
  try {
    const v = typeof lib.fieldValue === 'function' ? lib.fieldValue(trace, w.path) : undefined;
    return String(v ?? '') === String(w.equals ?? '');
  } catch {
    return true;
  }
}

function valueText(u) {
  if (u == null) return '';
  if (typeof u !== 'object') return String(u);
  return String(u.raw ?? u.value ?? u.norm ?? '');
}

/**
 * Badges for Tool call checks on one trace: { [stepId]: [{ tone, text }] }.
 * Policy checks badge the tool call that breaks a rule; output grounding badges the reply.
 * Uses the engine's stepBadges when present, else evaluatePolicy and groundedValues, else {}.
 */
export function toolCallBadges(project, trace) {
  const out = {};
  if (!trace) return out;
  if (typeof lib.stepBadges === 'function') {
    try {
      return lib.stepBadges(project, trace) || out;
    } catch {
      return out;
    }
  }
  const add = (stepId, badge) => {
    if (!stepId) return;
    const list = out[stepId] || (out[stepId] = []);
    if (!list.some((b) => b.text === badge.text)) list.push(badge);
  };
  for (const c of project.checks || EMPTY) {
    if (!c || !appliesTo(c, trace)) continue;
    if (c.type === 'policy' && c.policy && typeof lib.evaluatePolicy === 'function') {
      const only = Array.isArray(c.ruleIds) && c.ruleIds.length ? new Set(c.ruleIds) : null;
      let res = null;
      try {
        res = lib.evaluatePolicy(c.policy, trace, { userLabel: lib.userWord(project.experience), ruleIds: only ? [...only] : null });
      } catch {
        res = null;
      }
      for (const v of res?.violations || EMPTY) {
        if (only && !only.has(v.ruleId)) continue;
        add(v.stepId || outputStepId(trace), {
          tone: 'bad',
          text: `Breaks policy: ${v.label || v.ruleId || 'a rule'}`,
          title: [v.message, v.why].filter(Boolean).join(' '),
        });
      }
    } else if (c.type === 'code' && c.rule?.op === 'grounded-values' && typeof lib.groundedValues === 'function') {
      let res = null;
      try {
        res = lib.groundedValues(trace);
      } catch {
        res = null;
      }
      const values = [...new Set((res?.ungrounded || EMPTY).map(valueText).filter(Boolean))];
      if (res && res.verdict === 'fail' && values.length) {
        const shown = values.slice(0, 3).join(', ') + (values.length > 3 ? ` and ${values.length - 3} more` : '');
        add(outputStepId(trace), {
          tone: 'warn',
          text: `Not found in tool results: ${shown}`,
          title: 'The reply states these values, but no tool result, tool call, or message in this trace has them.',
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Example notes (our own wording): two weak and two strong per sample

const EXAMPLE_NOTES = {
  'clinic-booking': {
    weak: [
      ['Bad response.', 'Says nothing about what the patient saw, so nobody can find it again.'],
      ['Model made up a slot.', 'A guess at the cause. Say what the patient experienced first.'],
    ],
    strong: [
      ['Asked for the front desk twice. It kept offering times and never transferred her.', 'Names what she asked for and what the assistant did instead.'],
      ['Text shows **Friday 9:30** with the stars. On her phone that is raw symbols.', 'Points to the exact words the patient saw.'],
    ],
  },
  'sales-email': {
    weak: [
      ['Tone is off.', 'Off how, and for whom? A teammate could not spot it again.'],
      ['Research step failed.', 'A cause, not what the prospect would read.'],
    ],
    strong: [
      ['Says they just raised a Series B. The CRM notes never mention funding.', 'Names the invented fact and where it should have come from.'],
      ['Opens with "Hey!" to a CFO. Reads like a mass email.', 'Says who read it and how it landed.'],
    ],
  },
  'policy-answers': {
    weak: [
      ['Wrong answer.', 'Which part was wrong, and what should it have said?'],
      ['Search is broken.', 'A cause. Start from what the employee was told.'],
    ],
    strong: [
      ['Quotes 12 weeks of parental leave from the old policy. The current one says 16.', 'Gives the wrong value, the right value, and the source.'],
      ['Tells her she qualifies for leave. It should send her to HR for that call.', 'Says what the employee heard and what should have happened.'],
    ],
  },
  'gift-finder': {
    weak: [
      ['Picks are bad.', 'Bad for what reason? The shopper had something specific in mind.'],
      ['Ranking needs work.', 'A fix, not what the shopper saw.'],
    ],
    strong: [
      ['Asked for under $40. The top pick is a $65 Dutch oven.', 'States the limit and the pick that broke it.'],
      ['Said her sister hates coffee. Two of the three picks are pour-over sets.', 'Connects the stated dislike to the picks.'],
    ],
  },
  'code-review': {
    weak: [
      ['Too noisy.', 'Which comments, and why would the developer ignore them?'],
      ['Needs a better prompt.', 'A fix, not what happened on this pull request.'],
    ],
    strong: [
      ['Flags the query string as an injection risk, but it is a fixed constant. The developer would dismiss it.', 'Names the false alarm and why it is wrong.'],
      ['Approved the change while run_tests showed 2 failures.', 'Points to the verdict and the evidence it ignored.'],
    ],
  },
  'support-agent': {
    weak: [
      ['Policy issue.', 'Which rule, and what did the customer get?'],
      ['Grounding is bad.', 'A label, not what the customer was told.'],
    ],
    strong: [
      ['Told him the $80 credit is applied. The tool said it was still waiting for approval.', 'Compares what the customer heard with what the tool returned.'],
      ['He asked to move to the basic plan and the agent canceled his service.', 'Says what he asked for and what the agent did.'],
    ],
  },
};

const GENERIC_NOTES = {
  weak: [
    ['Not great.', 'Says nothing a teammate could act on.'],
    ['The model got confused.', 'A guess at the cause. Start with what the {user} experienced.'],
  ],
  strong: [
    ['Asked when the refund arrives and got the return policy instead. Had to ask twice.', 'Says what the {user} asked for and what they got.'],
    ['The reply promises delivery tomorrow. The order status says delayed.', 'Names the exact claim and the fact it contradicts.'],
  ],
};

function ExampleColumn({ kind, title, items, who }) {
  const fill = (s) => s.split('{user}').join(who);
  return html`<section class="review-examples-col">
    <h3 class=${classes('review-examples-title', 'is-' + kind)}>${title}</h3>
    <ul class="review-examples-list">
      ${items.map(([note, why]) => html`<li key=${note} class=${'is-' + kind}>
        <p class="review-examples-note">${fill(note)}</p>
        <p class="hint">${fill(why)}</p>
      </li>`)}
    </ul>
  </section>`;
}

function ExampleNotes({ project }) {
  const who = lib.userWord(project.experience);
  const set = EXAMPLE_NOTES[project.id] || GENERIC_NOTES;
  return html`<div class="review-examples">
    <p class="soft">A good note says what the ${who} experienced, specifically enough that a new teammate could spot it again. Skip the root cause for now.</p>
    <div class="review-examples-grid">
      <${ExampleColumn} kind="weak" title="Weak" items=${set.weak} who=${who} />
      <${ExampleColumn} kind="strong" title="Strong" items=${set.strong} who=${who} />
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Judgment panel pieces

function nameFromNote(text) {
  const first = oneLine(text).split(/[.!?]\s/)[0] || '';
  return cap(first.replace(/[.!?,;:]+$/, '').split(' ').filter(Boolean).slice(0, 6).join(' '));
}

function stepLabel(step, who) {
  const kinds = {
    user: cap(who), assistant: 'AI', system: 'Instructions', output: 'Final reply', note: 'AI reasoning',
    tool_call: `Tool call ${step.name || ''}`.trim(), tool_result: `Tool result ${step.name || ''}`.trim(),
  };
  return kinds[step.kind] || cap(step.name || step.kind || 'Step');
}

// One line for a step: a tool call reads as its details ("amount 80, plan basic"), not raw structured text.
function stepText(step) {
  const d = step.data;
  if (step.kind === 'tool_call' && d && typeof d === 'object' && !Array.isArray(d)) {
    return Object.entries(d).map(([k, v]) => `${k} ${v != null && typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  }
  return step.text;
}

function scrollToStep(stepId) {
  const el = document.querySelector(`.review-center [data-step-id="${cssEscape(stepId)}"]`);
  if (!el) return;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

function NewModeForm({ project, traceId, review, noteText, onDone }) {
  const exp = project.experience || {};
  const [name, setName] = useState(() => nameFromNote(noteText));
  const [definition, setDefinition] = useState('');
  const [stage, setStage] = useState(() => (review?.stage && lib.isStageId(exp, review.stage) ? review.stage : ''));
  const [error, setError] = useState('');
  const nameRef = useRef(null);
  useEffect(() => {
    const el = nameRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);
  const submit = (e) => {
    e.preventDefault();
    const clean = oneLine(name);
    if (!clean) {
      setError('Give the failure mode a short name.');
      if (nameRef.current) nameRef.current.focus();
      return;
    }
    const existing = (project.modes || EMPTY).find((m) => m.kind === 'failure' && m.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      changeTrace(traceId, (p) => ((p.reviews?.[traceId]?.modes || EMPTY).includes(existing.id) ? p : lib.toggleMode(p, traceId, existing.id)), 'mode');
      toast(`"${existing.name}" already exists, so this trace now carries it.`);
    } else {
      changeTrace(traceId, (p) => {
        const made = lib.addMode(p, { kind: 'failure', name: clean, definition: oneLine(definition), stage: stage || null });
        return lib.toggleMode(made.project, traceId, made.id);
      }, 'add mode');
      toast(`Added the failure mode "${clean}".`, { tone: 'good' });
    }
    onDone(true);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onDone(false);
  };
  return html`<form class="review-newmode" onSubmit=${submit} onKeyDown=${onKeyDown}>
    <label class="field">
      <span class="label">Name, in the ${lib.userWord(exp)}'s terms</span>
      <input ref=${nameRef} value=${name} maxlength="80" placeholder="For example: Ignores requests for a person"
        aria-invalid=${error ? 'true' : undefined} onInput=${(e) => { setName(e.currentTarget.value); setError(''); }} />
    </label>
    ${error && html`<p class="error-text" role="alert">${error}</p>`}
    <label class="field">
      <span class="label">Definition (optional)</span>
      <input value=${definition} placeholder="Fails when..." onInput=${(e) => setDefinition(e.currentTarget.value)} />
    </label>
    ${(exp.stages || EMPTY).length > 0 && html`<label class="field">
      <span class="label">Stage (optional)</span>
      <select value=${stage} onInput=${(e) => setStage(e.currentTarget.value)}>
        <option value="">No stage yet</option>
        ${exp.stages.map((s, i) => html`<option value=${s.id} key=${s.id}>${i + 1} ${s.label}</option>`)}
      </select>
    </label>`}
    <div class="row">
      <${Button} kind="primary" size="sm" type="submit" icon="plus">Add failure mode<//>
      <${Button} kind="ghost" size="sm" onClick=${() => onDone(false)}>Cancel<//>
    </div>
  </form>`;
}

function fromLabel(from) {
  if (from === 'claude-code') return 'from Claude Code';
  if (from === 'paste') return 'from your AI assistant';
  return '';
}

// One AI suggestion: dashed purple until the reviewer accepts or dismisses it.
function SuggestionCard({ s, mode, verdict, rechecking, first, onAccept, onDismiss, onYes, onNo }) {
  const isMode = s.kind === 'mode';
  const name = mode ? mode.name : s.modeId;
  return html`<article class=${classes('review-ai-card', rechecking && 'is-rechecking')} aria-label="AI suggestion">
    <header class="review-ai-head">
      <${Icon} name="sparkle" size=${14} />
      <span class="review-ai-kicker">AI suggestion</span>
      ${fromLabel(s.from) && html`<span class="review-ai-from">${fromLabel(s.from)}</span>`}
    </header>
    ${isMode
      ? html`<p class="review-ai-mode">New failure mode: <strong>${s.mode?.name}</strong></p>
          ${s.mode?.definition && html`<p class="review-ai-reason">${s.mode.definition}</p>`}`
      : html`<p class="review-ai-mode">Shows <strong>${name}</strong></p>`}
    ${s.quote && html`<blockquote class="review-ai-quote">${s.quote}</blockquote>`}
    ${s.reason && !isMode && html`<p class="review-ai-reason">${s.reason}</p>`}
    ${rechecking
      ? html`<div class="review-ai-recheck" role="group" aria-label="Re-check">
          <p><strong>Re-check:</strong> does this trace show ${name}?</p>
          <div class="row">
            <${Button} kind="secondary" size="sm" onClick=${onYes}>${verdict === 'fail' ? 'Yes' : 'Yes, switch to Problem'}${first && html` <${Kbd}>2<//>`}<//>
            <${Button} kind="secondary" size="sm" onClick=${onNo}>${verdict === 'pass' ? 'No, keep it Good' : 'No'}${first && html` <${Kbd}>1<//>`}<//>
          </div>
        </div>`
      : html`<div class="row review-ai-actions">
          <${Button} kind="secondary" size="sm" icon="check" onClick=${onAccept}>Accept<//>
          <${Button} kind="ghost" size="sm" onClick=${onDismiss}>Dismiss<//>
          ${isMode && html`<${Button} kind="ghost" size="sm" onClick=${() => navigate('modes')}>See in Failure modes<//>`}
        </div>`}
  </article>`;
}

function RecheckBlock({ modes, active, onYes, onNo }) {
  return html`<section class="review-block review-recheck" aria-labelledby="review-recheck-title">
    <h3 class="section-title" id="review-recheck-title">Re-check</h3>
    <p class="hint">${modes.length === 1 ? 'This failure mode was' : 'These failure modes were'} added after you reviewed this trace.</p>
    ${modes.map((m, i) => html`<div class="review-recheck-row" key=${m.id}>
      <div class="review-recheck-text">
        <strong>${m.name}</strong>
        ${m.definition && html`<span class="hint">${m.definition}</span>`}
      </div>
      <div class="review-recheck-q">
        <span class="review-recheck-ask">Shows this?</span>
        <${Button} kind="secondary" size="sm" onClick=${() => onYes(m)}>Yes${active && i === 0 && html` <${Kbd}>2<//>`}<//>
        <${Button} kind="secondary" size="sm" onClick=${() => onNo(m)}>No${active && i === 0 && html` <${Kbd}>1<//>`}<//>
      </div>
    </div>`)}
  </section>`;
}

const SAVE_TEXT = { saving: 'Saving...', error: 'Could not save', readonly: 'Read only', saved: 'Saved' };

function SavedMark() {
  const save = useStore((s) => s.saveState);
  const kind = useStore((s) => s.storageKind);
  const title = save === 'saved' ? (kind === 'folder' ? 'Saved to pmstack/project.json' : 'Saved in this browser') : undefined;
  return html`<span class=${classes('review-saved', 'is-' + save)} title=${title}>
    ${save === 'saved' && html`<${Icon} name="check" size=${13} />`}
    ${save === 'error' && html`<${Icon} name="warning" size=${13} />`}
    ${SAVE_TEXT[save] || 'Saved'}
  </span>`;
}

function ConfirmProblem({ open, mode, onConfirm, onCancel }) {
  const okRef = useRef(null);
  useEffect(() => {
    if (open && okRef.current) okRef.current.focus();
  }, [open]);
  return html`<${Modal} open=${open} title="Change this trace to Problem?" onClose=${onCancel}
    footer=${html`<${Button} kind="ghost" onClick=${onCancel}>Keep it Good<//>
      <button type="button" ref=${okRef} class="btn btn-bad btn-md is-active" onClick=${onConfirm}><span class="btn-label">Change to Problem</span></button>`}>
    <p>You marked this trace Good. Changing it to Problem adds ${mode ? html`<strong>${mode.name}</strong>` : 'this failure mode'} and counts it in the funnel.</p>
    <p class="hint">Then write what went wrong in the note.</p>
  <//>`;
}

// ---------------------------------------------------------------------------
// Judgment panel

let focusPanelOnMount = false;

/**
 * "Your judgment" for one trace. Key it by trace id.
 * Props: project, traceId, trace (normalized), showHidden, onShowHidden(), onGo(dir, via) returning
 * true when it moved, hasPrev, hasNext.
 */
export function JudgmentPanel({ project, traceId, trace, showHidden, onShowHidden, onGo, hasPrev = true, hasNext = true }) {
  const exp = project.experience || {};
  const who = lib.userWord(exp);
  const review = project.reviews?.[traceId] || null;
  const verdict = review?.verdict ?? null;
  const field = verdict === 'pass' ? 'good' : 'note';
  const { gate } = gates(project);
  const stats = lib.reviewStats(project);
  const gateOpen = stats.reviewed >= gate;

  const rootRef = useRef(null);
  const noteRef = useRef(null);
  const nudged = useRef(false);
  const [nudge, setNudge] = useState(false);
  const [newMode, setNewMode] = useState(false);
  const [examples, setExamples] = useState(false);
  const [rechecking, setRechecking] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // { mode, suggestionId }
  const [undone, setUndone] = useState(false);

  const note = useDraft(`${traceId}:${field}`, review?.[field] ?? '', (text) => {
    changeTrace(traceId, (p) => (field === 'good' ? lib.setGood(p, traceId, text) : lib.setNote(p, traceId, text)), 'note');
  });

  useEffect(() => {
    if (focusPanelOnMount && rootRef.current) rootRef.current.focus({ preventScroll: true });
    focusPanelOnMount = false;
  }, []);

  useEffect(() => {
    if (!undone) return undefined;
    const t = setTimeout(() => setUndone(false), 2500);
    return () => clearTimeout(t);
  }, [undone]);

  // After a pointer click, move focus off the button so the number keys keep working.
  const release = (e) => {
    if (e && e.detail > 0 && rootRef.current) rootRef.current.focus({ preventScroll: true });
  };

  const modes = project.modes || EMPTY;
  const mm = lib.modeMap(project);
  const failureModes = modes.filter((m) => m.kind === 'failure');
  const ignoreModes = modes.filter((m) => m.kind === 'ignore');
  const successModes = modes.filter((m) => m.kind === 'success');

  // Re-check: failure modes added after this Good trace was reviewed.
  const recheckItem = verdict === 'pass' ? lib.recheckQueue(project).find((x) => x.traceId === traceId) : null;
  const recheckModes = recheckItem ? recheckItem.modeIds.map((id) => mm.get(id)).filter(Boolean) : EMPTY;

  // AI suggestions for this trace, shown once the gate is open.
  const suggestions = gateOpen ? traceFlags(project, traceId) : EMPTY;
  const activeRecheck = verdict === 'fail' ? EMPTY : suggestions.filter((s) => rechecking.has(s.id) && s.kind !== 'mode');
  const pending = [
    ...recheckModes.map((m) => ({ type: 'mode', mode: m })),
    ...activeRecheck.map((s) => ({ type: 'ai', s, mode: mm.get(s.modeId) })),
  ];

  const forget = (sid) => {
    if (!rechecking.has(sid)) return;
    const next = new Set(rechecking);
    next.delete(sid);
    setRechecking(next);
  };

  const setVerdict = (v, e) => {
    note.commitNow();
    const accepting = v === 'fail' ? activeRecheck.map((s) => s.id) : EMPTY;
    changeTrace(traceId, (p) => {
      const r = p.reviews?.[traceId];
      let q = lib.setVerdict(p, traceId, v);
      // Text typed before choosing Good becomes the "what went well" note.
      if (v === 'pass' && r?.verdict !== 'pass' && String(r?.note || '').trim() && !String(r?.good || '').trim()) {
        q = lib.setNote(lib.setGood(q, traceId, r.note), traceId, '');
      }
      // Switching to Problem while re-checking an AI suggestion adds its failure mode.
      for (const sid of accepting) q = lib.acceptSuggestion(q, sid).project;
      return q;
    }, 'verdict');
    if (accepting.length) setRechecking(new Set());
    release(e);
  };

  const toProblemWith = (modeId, suggestionId) => {
    changeTrace(traceId, (p) => {
      let q = lib.setVerdict(p, traceId, 'fail');
      if (!(q.reviews?.[traceId]?.modes || EMPTY).includes(modeId)) q = lib.toggleMode(q, traceId, modeId);
      if (suggestionId) q = lib.acceptSuggestion(q, suggestionId).project;
      return q;
    }, 'recheck');
    if (suggestionId) forget(suggestionId);
  };

  const answerYes = (item) => {
    const sid = item.type === 'ai' ? item.s.id : null;
    if (verdict === 'pass') setConfirm({ mode: item.mode, suggestionId: sid });
    else toProblemWith(item.mode.id, sid);
  };

  const answerNo = (item) => {
    if (item.type === 'mode') {
      let error = null;
      changeTrace(traceId, (p) => {
        const res = lib.setLabelResult(p, item.mode.id, traceId, 'pass');
        error = res.error;
        return res.project;
      }, 'recheck');
      if (error) toast(error, { tone: 'bad' });
      return;
    }
    dismiss(item.s);
  };

  const accept = (s) => {
    if (s.kind === 'mode') {
      changeTrace(traceId, (p) => lib.acceptSuggestion(p, s.id).project, 'accept');
      toast(`Added the failure mode "${s.mode?.name}".`, { tone: 'good' });
      return;
    }
    let openTraceId = null;
    changeTrace(traceId, (p) => {
      const res = lib.acceptSuggestion(p, s.id);
      openTraceId = res.openTraceId;
      return res.project;
    }, 'accept');
    if (!openTraceId) return;
    if (openTraceId !== traceId) {
      navigate('review', openTraceId);
      return;
    }
    // A Good or unreviewed trace: the reviewer re-checks it before the mode is added.
    const next = new Set(rechecking);
    next.add(s.id);
    setRechecking(next);
  };

  const dismiss = (s) => {
    changeTrace(traceId, (p) => {
      let q = lib.dismissSuggestion(p, s.id);
      // Keeping a Good trace Good records that it does not show this failure mode.
      if (s.kind !== 'mode' && p.reviews?.[traceId]?.verdict === 'pass') q = lib.setLabel(q, s.modeId, traceId, 'pass');
      return q;
    }, 'dismiss');
    forget(s.id);
  };

  const onConfirm = () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    toProblemWith(c.mode.id, c.suggestionId);
    requestAnimationFrame(() => {
      if (noteRef.current) noteRef.current.focus();
    });
  };

  const toggleMode = (modeId, e) => {
    changeTrace(traceId, (p) => lib.toggleMode(p, traceId, modeId), 'mode');
    release(e);
  };
  const toggleSuccess = (modeId, e) => {
    changeTrace(traceId, (p) => lib.toggleSuccessMode(p, traceId, modeId), 'mode');
    release(e);
  };
  const pickStage = (stageId, e) => {
    changeTrace(traceId, (p) => lib.setStage(p, traceId, p.reviews?.[traceId]?.stage === stageId ? null : stageId), 'stage');
    release(e);
  };
  const clearStep = () => changeTrace(traceId, (p) => lib.setStep(p, traceId, null), 'step');

  const undo = () => {
    note.commitNow();
    if (undoTrace(traceId)) setUndone(true);
    else toast('Nothing to undo on this trace yet.');
  };

  const next = (e) => {
    note.commitNow();
    const r = store.get().project?.reviews?.[traceId];
    if (r?.verdict === 'fail' && !String(r.note || '').trim() && !nudged.current) {
      nudged.current = true;
      setNudge(true);
      if (noteRef.current) noteRef.current.focus();
      return;
    }
    flush();
    focusPanelOnMount = !!(rootRef.current && rootRef.current.contains(document.activeElement));
    const moved = onGo(1, 'next');
    if (!moved) {
      focusPanelOnMount = false;
      release(e);
    }
  };

  useKeys({
    1: () => (pending.length ? answerNo(pending[0]) : setVerdict('pass')),
    2: () => (pending.length ? answerYes(pending[0]) : setVerdict('fail')),
    3: () => setVerdict('skip'),
    d: () => setVerdict('skip'),
    n: () => {
      if (noteRef.current) noteRef.current.focus();
    },
    u: undo,
    'mod+z': undo,
    'mod+Enter': () => next(),
  });

  const placeholder = verdict === 'pass'
    ? `Why did this meet the ${who}'s need? (optional)`
    : `What did you notice? Start with the first thing that went wrong, from the ${who}'s side.`;
  const noteLabel = verdict === 'pass' ? 'What went well (optional)' : verdict === 'fail' ? 'What went wrong' : 'Note';
  const shortNote = verdict === 'fail' && words(note.value) > 0 && words(note.value) < 6;
  const hiddenSteps = trace ? (trace.steps || EMPTY).filter((s) => !s.customerVisible).length : 0;

  const stages = exp.stages || EMPTY;
  const showStage = verdict === 'fail' || !!review?.stage || !!review?.step;
  const pickedStep = review?.step && trace ? (trace.steps || EMPTY).find((s) => s.id === review.step) : null;

  let successChoices = EMPTY;
  if (verdict === 'pass') successChoices = successModes;
  else if (verdict === 'fail') {
    const failIdx = lib.stageIndex(exp, lib.failStage(project, review));
    successChoices = successModes.filter((m) => m.stage && lib.stageIndex(exp, m.stage) < failIdx);
  }

  const askModeId = (review?.modes || EMPTY).find((id) => mm.get(id)?.kind === 'failure') || failureModes[0]?.id || null;

  return html`<section class="review-judge-panel" ref=${rootRef} tabindex="-1" aria-labelledby="review-judge-title">
    <div class="review-judge-scroll review-scroll">
      <header class="review-judge-head">
        <h2 id="review-judge-title">Your judgment</h2>
        ${review?.reviewedAt && html`<span class="review-judge-when">Reviewed ${shortDate(review.reviewedAt)}</span>`}
      </header>

      <div class="review-block review-note">
        <label class="label" for="review-note-box">${noteLabel}</label>
        <textarea id="review-note-box" ref=${noteRef} class=${classes('review-note-box', nudge && 'is-nudged')}
          rows="4" value=${note.value} placeholder=${placeholder} aria-describedby="review-note-help"
          onInput=${(e) => { note.onInput(e); if (nudge) setNudge(false); }} onFocus=${note.onFocus} onBlur=${note.onBlur}></textarea>
        ${nudge && html`<p class="review-nudge" role="status"><${Icon} name="note" size=${14} />Add a note so you can group it later</p>`}
        ${shortNote && !nudge && html`<p class="review-short">Would a new teammate understand this?</p>`}
        <p class="hint" id="review-note-help">Describe what the ${who} experienced. Skip the root cause for now.${' '}
          <button type="button" class="review-link" onClick=${() => setExamples(true)}>See example notes</button></p>
      </div>

      <div class="review-verdicts" role="group" aria-label="Verdict">
        <${Button} kind="good" class="review-verdict" aria-pressed=${verdict === 'pass' ? 'true' : 'false'} icon="check"
          onClick=${(e) => setVerdict('pass', e)}>Good <${Kbd}>1<//><//>
        <${Button} kind="bad" class="review-verdict" aria-pressed=${verdict === 'fail' ? 'true' : 'false'} icon="x"
          onClick=${(e) => setVerdict('fail', e)}>Problem <${Kbd}>2<//><//>
        <${Button} kind="ghost" size="sm" class=${classes('review-verdict-skip', verdict === 'skip' && 'is-active')}
          aria-pressed=${verdict === 'skip' ? 'true' : 'false'} onClick=${(e) => setVerdict('skip', e)}>Not sure yet <${Kbd}>3<//><//>
      </div>

      ${recheckModes.length > 0 && html`<${RecheckBlock} modes=${recheckModes} active=${true}
        onYes=${(m) => answerYes({ type: 'mode', mode: m })} onNo=${(m) => answerNo({ type: 'mode', mode: m })} />`}

      ${verdict === 'fail' && !showHidden && hiddenSteps > 0 && html`<p class="review-hidden-hint">
        <span>Press <${Kbd}>H<//> to see the steps behind this reply.</span>
        <button type="button" class="review-link" onClick=${onShowHidden}>Show ${plural(hiddenSteps, 'step')}</button>
      </p>`}

      ${showStage && stages.length > 0 && html`<section class="review-block" aria-labelledby="review-stage-title">
        <h3 class="section-title" id="review-stage-title">Where did it first go wrong? (optional)</h3>
        <div class="review-chips">
          ${stages.map((s) => html`<${StageChip} key=${s.id} experience=${exp} stageId=${s.id} selected=${review?.stage === s.id}
            onClick=${(e) => pickStage(s.id, e)} />`)}
          <${Chip} selected=${review?.stage === 'unknown'} onClick=${(e) => pickStage('unknown', e)}>Not sure<//>
        </div>
        ${pickedStep
          ? html`<div class="review-picked">
              <span class="review-picked-label">First problem</span>
              <button type="button" class="review-picked-step" title="Show this step in the trace" onClick=${() => scrollToStep(pickedStep.id)}>
                <strong>${stepLabel(pickedStep, who)}</strong>${' '}${clip(oneLine(stepText(pickedStep)), 70)}
              </button>
              <${Button} kind="ghost" size="sm" onClick=${clearStep}>Clear<//>
            </div>`
          : html`<p class="hint">Pick where the problem first shows, not why it happened. You can also pick a step in the trace.</p>`}
      </section>`}

      ${verdict === 'fail' && html`<section class="review-block" aria-labelledby="review-modes-title">
        <h3 class="section-title" id="review-modes-title">Failure modes</h3>
        ${(failureModes.length > 0 || ignoreModes.length > 0) && html`<div class="review-chips">
          ${failureModes.map((m) => html`<${Chip} key=${m.id} tone="bad" selected=${(review?.modes || EMPTY).includes(m.id)}
            title=${m.definition || m.name} onClick=${(e) => toggleMode(m.id, e)}>${m.name}<//>`)}
          ${ignoreModes.map((m) => html`<${Chip} key=${m.id} class="review-chip-ignore" selected=${(review?.modes || EMPTY).includes(m.id)}
            title=${m.definition || 'Test sessions and unclear traces. Not counted in the funnel.'} onClick=${(e) => toggleMode(m.id, e)}>${m.name}<//>`)}
        </div>`}
        ${newMode
          ? html`<${NewModeForm} project=${project} traceId=${traceId} review=${review} noteText=${note.value}
              onDone=${() => { setNewMode(false); if (rootRef.current) rootRef.current.focus({ preventScroll: true }); }} />`
          : html`<${Button} kind="ghost" size="sm" icon="plus" class="review-newmode-btn"
              onClick=${() => { note.commitNow(); setNewMode(true); }}>New failure mode from this note<//>`}
      </section>`}

      ${successChoices.length > 0 && html`<section class="review-block" aria-labelledby="review-success-title">
        <h3 class="section-title" id="review-success-title">${verdict === 'pass' ? 'Success modes' : 'Went well before the problem'}</h3>
        <div class="review-chips">
          ${successChoices.map((m) => html`<${Chip} key=${m.id} tone="good" selected=${(review?.successModes || EMPTY).includes(m.id)}
            title=${m.definition || m.name} onClick=${(e) => toggleSuccess(m.id, e)}>${m.name}<//>`)}
        </div>
      </section>`}

      <section class="review-block review-ai" aria-labelledby="review-ai-title">
        <h3 class="section-title" id="review-ai-title">AI help</h3>
        ${gateOpen
          ? html`${suggestions.map((s) => html`<${SuggestionCard} key=${s.id} s=${s} mode=${mm.get(s.modeId)} verdict=${verdict}
                rechecking=${rechecking.has(s.id) && verdict !== 'fail'}
                first=${recheckModes.length === 0 && activeRecheck[0] === s}
                onAccept=${() => accept(s)} onDismiss=${() => dismiss(s)}
                onYes=${() => answerYes({ type: 'ai', s, mode: mm.get(s.modeId) })}
                onNo=${() => answerNo({ type: 'ai', s, mode: mm.get(s.modeId) })} />`)}
              ${suggestions.length === 0 && html`<p class="hint">No AI suggestions for this trace.</p>`}
              <${Button} kind="ghost" size="sm" icon="sparkle" class="review-ask"
                onClick=${() => setUi({ assistOpen: { mode: 'scan', modeId: askModeId } })}>Ask AI to find more<//>`
          : html`<p class="review-gate"><${Icon} name="sparkle" size=${14} />
              <span>AI suggestions unlock after you review ${gate} traces (you've done ${stats.reviewed}). Reading them yourself first keeps your judgment in charge.</span></p>`}
      </section>
    </div>

    <footer class="review-judge-foot">
      <div class="review-foot-row">
        <${Button} kind="ghost" size="sm" icon="undo" disabled=${!canUndo(project.id, traceId)} onClick=${undo}
          title="Undo the last change on this trace (U)">Undo<//>
        ${undone ? html`<span class="review-saved" role="status">Undid the last change</span>` : html`<${SavedMark} />`}
      </div>
      <div class="review-foot-nav">
        <${Button} kind="secondary" icon="arrow-left" title="Previous trace (K)" disabled=${!hasPrev} onClick=${() => onGo(-1, 'button')} />
        <${Button} kind="secondary" icon="arrow-right" title="Next in the list (J)" disabled=${!hasNext} onClick=${() => onGo(1, 'button')} />
        <${Button} kind="primary" class="review-next" onClick=${next}>Next trace <span class="review-next-keys"><${Kbd}>${MOD_LABEL}<//><${Kbd}>Enter<//></span><//>
      </div>
    </footer>

    <${Modal} open=${examples} title="Example notes" class="review-examples-modal" onClose=${() => setExamples(false)}>
      <${ExampleNotes} project=${project} />
    <//>

    <${ConfirmProblem} open=${!!confirm} mode=${confirm && confirm.mode} onConfirm=${onConfirm} onCancel=${() => setConfirm(null)} />
  </section>`;
}
