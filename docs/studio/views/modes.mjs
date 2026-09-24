// Failure modes tab (SPEC 5.3): sort Problem notes into named failure modes and Good notes
// into success modes, keep the list short, and answer "Did the AI's instructions ask for this?".
// Notes move with "Add to..." menus and multi-select (no drag and drop).

import {
  html, useStore, useState, useMemo, useRef, useEffect, useLayoutEffect, useDraft, useKeys, useId,
  classes, plural, formatCount, Button, Chip, StageChip, Modal, Segmented, EmptyState, Icon, Menu,
  RendererBoundary, registerIcon, toast,
} from 'pmstack/ui';
import { updateProject, navigate, setUi, DEFAULT_FILTERS, hashFor } from '../store.mjs';
import * as lib from '../lib/index.mjs';

registerIcon('lock', ['M7 11h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z', 'M9 11V8a3 3 0 0 1 6 0v3']);

const EMPTY = Object.freeze([]);
const KIND_OPTIONS = [
  { value: 'failure', label: 'Failure modes' },
  { value: 'success', label: 'Success modes' },
];
const IGNORE_NAME = 'Not a product problem';
const IGNORE_DEFINITION = 'Test sessions and unclear traces.';
const QUOTES_SHOWN = 3;
const SEVERITY_TONE = { blocks: 'bad', hurts: 'warn', annoys: 'neutral' };
const OPEN_QUOTE = String.fromCharCode(0x201C);
const CLOSE_QUOTE = String.fromCharCode(0x201D);
const DOT = String.fromCharCode(0x00B7);

// The toggle survives switching tabs during this visit.
let lastKind = 'failure';

// ---------------------------------------------------------------------------
// Helpers

const WORDS = {
  failure: { one: 'failure mode', many: 'failure modes', title: 'Failure mode', defHint: 'Fails when...', field: 'modes' },
  success: { one: 'success mode', many: 'success modes', title: 'Success mode', defHint: 'Passes when...', field: 'successModes' },
};

/** Open Review traces with these filters, on the first matching trace. */
function reviewWith(project, filters) {
  const next = { ...DEFAULT_FILTERS, ...filters, scope: 'all' };
  let first = null;
  try {
    first = lib.filterTraces(project, next)[0] || null;
  } catch {
    first = null;
  }
  setUi({ filters: next });
  navigate('review', first);
}

/** Link handler: open one trace in Review traces with a list that holds it (a plain click; modified clicks open a new tab). */
function openTrace(e, traceId, filters = {}) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  setUi({ filters: { ...DEFAULT_FILTERS, ...filters, scope: 'all' } });
  navigate('review', traceId);
}

function tagTraces(p, ids, modeId, kind) {
  const field = WORDS[kind === 'success' ? 'success' : 'failure'].field;
  let q = p;
  for (const id of ids) {
    const r = q.reviews && q.reviews[id];
    if (!r || (r[field] || EMPTY).includes(modeId)) continue;
    q = kind === 'success' ? lib.toggleSuccessMode(q, id, modeId) : lib.toggleMode(q, id, modeId);
  }
  return q;
}

function untagTraces(p, ids, modeId, kind) {
  const field = WORDS[kind === 'success' ? 'success' : 'failure'].field;
  let q = p;
  for (const id of ids) {
    const r = q.reviews && q.reviews[id];
    if (!r || !(r[field] || EMPTY).includes(modeId)) continue;
    q = kind === 'success' ? lib.toggleSuccessMode(q, id, modeId) : lib.toggleMode(q, id, modeId);
  }
  return q;
}

function quoted(name) {
  return OPEN_QUOTE + name + CLOSE_QUOTE;
}

function noteCount(n) {
  return n === 1 ? 'the note' : plural(n, 'note');
}

/** Tag traces with a mode and offer Undo. */
function addNotesTo(ids, mode) {
  if (!ids.length) return;
  const kind = mode.kind === 'success' ? 'success' : 'failure';
  updateProject((p) => tagTraces(p, ids, mode.id, kind), 'group notes');
  toast(`Added ${noteCount(ids.length)} to ${quoted(mode.name)}.`, {
    action: { label: 'Undo', onClick: () => updateProject((p) => untagTraces(p, ids, mode.id, kind), 'undo group notes') },
  });
}

/** Put notes in "Not a product problem", creating that bucket the first time. */
function addNotesToIgnore(ids) {
  if (!ids.length) return;
  let modeId = null;
  updateProject((p) => {
    let q = p;
    let m = (q.modes || EMPTY).find((x) => x.kind === 'ignore');
    if (!m) {
      const made = lib.addMode(q, { kind: 'ignore', name: IGNORE_NAME, definition: IGNORE_DEFINITION });
      q = made.project;
      m = q.modes.find((x) => x.id === made.id);
    }
    modeId = m.id;
    return tagTraces(q, ids, m.id, 'failure');
  }, 'not a product problem');
  toast(`Moved ${noteCount(ids.length)} to ${quoted(IGNORE_NAME)}. These traces are not counted in the funnel.`, {
    action: { label: 'Undo', onClick: () => modeId && updateProject((p) => untagTraces(p, ids, modeId, 'failure'), 'undo not a product problem') },
  });
}

function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function stageText(experience, stageId) {
  if (!stageId) return '';
  const n = lib.stageNumber(experience, stageId);
  return n ? `${n} ${lib.stageLabel(experience, stageId)}` : lib.stageLabel(experience, stageId);
}

/** Notes behind a mode, in review order: [{ traceId, text }]. */
function evidence(project, traceIds, kind) {
  const out = [];
  for (const id of traceIds || EMPTY) {
    const r = project.reviews && project.reviews[id];
    if (!r) continue;
    const text = String((kind === 'success' ? r.good || r.note : r.note) || '').trim();
    out.push({ traceId: id, text });
  }
  return out;
}

function scrollToCard(modeId) {
  const el = document.getElementById('modes-card-' + modeId);
  if (!el) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  el.classList.remove('is-flash');
  // Restart the highlight on repeat jumps.
  void el.offsetWidth;
  el.classList.add('is-flash');
}

// ---------------------------------------------------------------------------
// Small pieces

/** Text area that grows with its text. */
function GrowText({ value, onInput, onBlur, onFocus, onKeyDown, placeholder, class: cls, label, id }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }, [value]);
  return html`<textarea ref=${ref} id=${id} class=${classes('modes-grow', cls)} rows="1" value=${value}
    placeholder=${placeholder} aria-label=${label} onInput=${onInput} onBlur=${onBlur} onFocus=${onFocus} onKeyDown=${onKeyDown}></textarea>`;
}

function ViewError({ error, reset }) {
  return html`<section class="page">
    <div class="empty" role="alert">
      <div class="empty-icon"><${Icon} name="warning" size=${20} /></div>
      <h2 class="empty-title">This tab could not be drawn</h2>
      <p class="empty-body">${error && error.message ? error.message : 'Something in this project could not be read.'}</p>
      <div class="empty-action"><${Button} kind="primary" onClick=${reset}>Try again<//></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Notes to sort

function addToItems({ modes, kind, experience, onPick, onIgnore, onNew, newLabel }) {
  const items = modes.map((m) => ({
    label: m.name,
    hint: m.stage ? stageText(experience, m.stage) : undefined,
    onClick: () => onPick(m),
  }));
  if (items.length) items.push('divider');
  if (kind === 'failure') {
    items.push({ label: IGNORE_NAME, hint: 'Test sessions and unclear traces. Not counted.', onClick: onIgnore });
    items.push('divider');
  }
  items.push({ label: newLabel, icon: 'plus', onClick: onNew });
  return items;
}

function NoteCard({ note, index, title, selected, experience, items, onSelect }) {
  const onCard = (e) => {
    if (e.target.closest('a, button, input, select, textarea, .menu')) return;
    onSelect(index, e.shiftKey);
  };
  return html`<li class=${classes('modes-note', selected && 'is-selected', !note.hasNote && 'is-empty')} onClick=${onCard}>
    <input type="checkbox" class="modes-note-check" checked=${selected}
      aria-label=${`Select the note on ${title}`}
      onClick=${(e) => { e.stopPropagation(); onSelect(index, e.shiftKey); }} />
    <div class="modes-note-body">
      <p class="modes-note-text">${note.hasNote ? note.note : '(no note yet)'}</p>
      <div class="modes-note-meta">
        ${note.stage && note.stage !== 'unknown' && html`<${StageChip} experience=${experience} stageId=${note.stage} />`}
        <a class="modes-note-link" href=${hashFor('review', note.traceId)} onClick=${(e) => openTrace(e, note.traceId)} title=${`Open ${title} in Review traces`}>${title}</a>
        <${Menu} label="Add to..." kind="ghost" size="sm" align="end" class="modes-note-menu" items=${items}
          title=${`Add the note on ${title} to a mode`} />
      </div>
    </div>
  </li>`;
}

function NotesPanel({ project, kind, notes, titles, selected, onSelect, onSelectAll, onClear, modes, onNew, noNote }) {
  const w = WORDS[kind];
  const experience = project.experience;
  const selectedIds = notes.filter((n) => selected.has(n.traceId)).map((n) => n.traceId);
  const allOn = notes.length > 0 && selectedIds.length === notes.length;
  const bulkItems = addToItems({
    modes, kind, experience,
    onPick: (m) => { addNotesTo(selectedIds, m); onClear(); },
    onIgnore: () => { addNotesToIgnore(selectedIds); onClear(); },
    onNew: () => onNew(selectedIds),
    newLabel: `New ${w.one} from selected`,
  });
  return html`<aside class="modes-notes card" aria-labelledby="modes-notes-title">
    <div class="modes-notes-head">
      <h2 class="modes-h2" id="modes-notes-title">Notes to sort <span class="modes-count-badge">${formatCount(notes.length)}</span></h2>
      ${notes.length > 1 && html`<label class="check-row modes-select-all">
        <input type="checkbox" checked=${allOn} onClick=${() => (allOn ? onClear() : onSelectAll())} />
        <span>Select all</span>
      </label>`}
    </div>
    ${notes.length > 0 && selectedIds.length === 0 && html`<p class="hint modes-notes-tip">
      ${kind === 'failure' ? 'Problem' : 'Good'} notes not in any ${w.one} yet. Click notes to select them; shift-click selects a range.
    </p>`}
    ${selectedIds.length > 0 && html`<div class="modes-bulk" role="region" aria-label="Selected notes">
      <div class="modes-bulk-top">
        <span class="modes-bulk-count" aria-live="polite">${plural(selectedIds.length, 'note')} selected</span>
        <${Menu} label="Add to..." kind="secondary" size="sm" items=${bulkItems} title="Add the selected notes to a mode" />
        <${Button} kind="ghost" size="sm" onClick=${onClear}>Clear<//>
      </div>
      <${Button} kind="primary" size="sm" icon="plus" class="modes-bulk-new" onClick=${() => onNew(selectedIds)}>New ${w.one} from selected<//>
    </div>`}
    ${notes.length > 0
      ? html`<ul class="modes-note-list">
        ${notes.map((note, i) => html`<${NoteCard} key=${note.traceId} note=${note} index=${i}
          title=${titles.get(note.traceId) || note.traceId} selected=${selected.has(note.traceId)}
          experience=${experience} onSelect=${onSelect}
          items=${addToItems({
            modes, kind, experience,
            onPick: (m) => addNotesTo([note.traceId], m),
            onIgnore: () => addNotesToIgnore([note.traceId]),
            onNew: () => onNew([note.traceId]),
            newLabel: `New ${w.one} from this note`,
          })} />`)}
      </ul>`
      : html`<div class="modes-notes-done">
        <span class="modes-done-mark"><${Icon} name="check" /></span>
        <p>${kind === 'failure'
          ? 'Every Problem note is in a failure mode.'
          : 'Every "What went well?" note is in a success mode.'}</p>
      </div>`}
    ${kind === 'failure' && noNote > 0 && html`<p class="modes-nonote">
      <span>Problems without a note (${formatCount(noNote)})</span>
      <button type="button" class="modes-link" onClick=${() => reviewWith(project, { status: 'needsNote' })}>Write them</button>
    </p>`}
  </aside>`;
}

// ---------------------------------------------------------------------------
// Ranked bars

function SummaryBars({ rows, counted, kind }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return html`<section class="modes-summary card" aria-labelledby="modes-summary-title">
    <div class="modes-summary-head">
      <h2 class="modes-h2" id="modes-summary-title">How often each one happens</h2>
      <span class="hint">Share of ${plural(counted, 'counted trace')}</span>
    </div>
    <ol class="modes-bars">
      ${rows.map((r, i) => {
        const share = counted ? r.count / counted : null;
        return html`<li key=${r.mode.id}>
          <button type="button" class="modes-bar-row" onClick=${() => scrollToCard(r.mode.id)}
            aria-label=${`${r.mode.name}: ${plural(r.count, 'trace')}, ${lib.pct(share)}. Go to its card.`}>
            <span class="modes-bar-rank" aria-hidden="true">${i + 1}</span>
            <span class="modes-bar-name" aria-hidden="true">${r.mode.name}</span>
            <span class="modes-bar-track" aria-hidden="true">
              <span class=${classes('modes-bar-fill', 'is-' + kind)} style=${{ width: `${Math.max(r.count ? 2 : 0, (r.count / max) * 100)}%` }}></span>
            </span>
            <span class="modes-bar-count num" aria-hidden="true">${formatCount(r.count)}</span>
            <span class="modes-bar-share num" aria-hidden="true">${lib.pct(share)}</span>
          </button>
        </li>`;
      })}
    </ol>
  </section>`;
}

// ---------------------------------------------------------------------------
// AI suggestions for new modes

function suggestionRow(project, titles, traceId) {
  const r = project.reviews && project.reviews[traceId];
  const title = titles.get(traceId) || traceId;
  if (!r || !r.verdict) return { title, text: '', status: 'Not reviewed yet: becomes an AI flag to check in Review traces' };
  if (r.verdict === 'pass') return { title, text: String(r.good || '').trim(), status: 'Marked Good' };
  if (r.verdict === 'skip') return { title, text: String(r.note || '').trim(), status: 'Marked Not sure yet' };
  return { title, text: String(r.note || '').trim(), status: '' };
}

function SuggestionCard({ project, suggestion, titles }) {
  const s = suggestion;
  const ids = s.traceIds || EMPTY;
  const [off, setOff] = useState(() => new Set());
  const kept = ids.filter((id) => !off.has(id));
  const experience = project.experience;
  const name = (s.mode && s.mode.name) || 'Unnamed';
  const stage = s.mode && lib.isStageId(experience, s.mode.stage) ? s.mode.stage : null;
  const toggle = (id) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const accept = () => {
    updateProject((p) => lib.acceptSuggestion(p, s.id, { traceIds: kept }).project, 'accept suggestion');
    toast(`Added ${quoted(name)}${kept.length ? ` with ${noteCount(kept.length)}` : ''}.`, { tone: 'good' });
  };
  const dismiss = () => {
    updateProject((p) => lib.dismissSuggestion(p, s.id), 'dismiss suggestion');
    toast(`Dismissed the suggestion ${quoted(name)}.`);
  };
  return html`<article class="modes-suggestion" aria-label=${`AI suggestion: ${name}`}>
    <div class="modes-suggestion-tag"><${Icon} name="sparkle" /> AI suggestion</div>
    <h3 class="modes-suggestion-name">${name}</h3>
    ${s.mode && s.mode.definition && html`<p class="modes-suggestion-def">${s.mode.definition}</p>`}
    ${(stage || s.reason) && html`<div class="modes-suggestion-meta">
      ${stage && html`<${StageChip} experience=${experience} stageId=${stage} />`}
      ${s.reason && html`<span class="modes-suggestion-reason">${s.reason}</span>`}
    </div>`}
    ${ids.length > 0 && html`<fieldset class="modes-suggestion-notes">
      <legend class="label">Notes it would group (${kept.length} of ${ids.length} kept)</legend>
      <ul>
        ${ids.map((id) => {
          const row = suggestionRow(project, titles, id);
          return html`<li key=${id}>
            <label class="modes-suggestion-note">
              <input type="checkbox" checked=${!off.has(id)} onClick=${() => toggle(id)} />
              <span class="modes-suggestion-note-body">
                <span class="modes-suggestion-note-text">${row.text || '(no note yet)'}</span>
                <span class="modes-suggestion-note-meta">${row.title}${row.status ? ` ${DOT} ${row.status}` : ''}</span>
              </span>
            </label>
          </li>`;
        })}
      </ul>
    </fieldset>`}
    <div class="modes-suggestion-actions">
      <${Button} kind="primary" size="sm" icon="check" onClick=${accept}>Accept<//>
      <${Button} kind="ghost" size="sm" icon="x" onClick=${dismiss}>Dismiss<//>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Mode cards

function Evidence({ project, mode, count, traceIds }) {
  const kind = mode.kind;
  const all = evidence(project, traceIds, kind);
  const withText = all.filter((q) => q.text);
  const shown = withText.slice(0, QUOTES_SHOWN);
  const more = Math.max(0, count - shown.length);
  if (!count) {
    return html`<p class="modes-evidence-empty">No notes here yet. Use <strong>Add to...</strong> on a note to put it in this ${WORDS[kind === 'success' ? 'success' : 'failure'].one}.</p>`;
  }
  return html`<div class="modes-evidence">
    <h3 class="modes-evidence-title">What your notes say</h3>
    ${shown.length
      ? html`<ul class="modes-quotes">
        ${shown.map((q) => html`<li key=${q.traceId}>
          <a class="modes-quote" href=${hashFor('review', q.traceId)} onClick=${(e) => openTrace(e, q.traceId, { modeId: mode.id })}>
            <span class="modes-quote-text">${q.text}</span>
            <span class="modes-quote-id">${q.traceId}</span>
          </a>
        </li>`)}
      </ul>`
      : html`<p class="modes-evidence-empty">${count === 1 ? 'This trace has' : 'These traces have'} no written note yet.</p>`}
    ${shown.length === 0
      ? html`<button type="button" class="modes-more" onClick=${() => reviewWith(project, { modeId: mode.id })}>Open in Review traces</button>`
      : more > 0 && html`<button type="button" class="modes-more" onClick=${() => reviewWith(project, { modeId: mode.id })}>+ ${formatCount(more)} more<span class="sr-only"> traces, in Review traces</span></button>`}
  </div>`;
}

function suggestionText(mode) {
  const next = lib.suggestedDecision(mode);
  if (next === 'fix') return 'Suggested: Fix it now. Add the instruction first. Build a check only if it keeps failing after the fix, or if it is critical.';
  if (next === 'check') return 'Suggested: Build a check.';
  if (mode.instructed === 'unsure') return 'Read what the AI was told to do, then answer. The answer decides whether to fix the instructions or build a check.';
  return '';
}

function RecheckNote({ project, mode, n }) {
  const edited = mode.definitionUpdatedAt && lib.ms(mode.definitionUpdatedAt) > lib.ms(mode.createdAt);
  return html`<div class="modes-recheck" role="note">
    <${Icon} name="warning" />
    <p>You reviewed ${plural(n, 'trace')} before this ${edited ? 'definition changed' : 'failure mode existed'}. Check them for it.</p>
    <${Button} kind="secondary" size="sm" onClick=${() => reviewWith(project, { status: 'recheck' })}>Re-check<//>
  </div>`;
}

function DecisionChips({ project, mode }) {
  const experience = project.experience;
  const sev = lib.SEVERITIES.find((s) => s.id === mode.severity);
  const dec = lib.DECISIONS.find((d) => d.id === mode.decision);
  return html`<div class="modes-chips">
    <span class="label">Severity and decision</span>
    <div class="modes-chips-row">
      <${Chip} tone=${sev ? SEVERITY_TONE[sev.id] : 'neutral'} class=${classes('modes-readonly-chip', !sev && 'is-unset')}>
        ${sev ? lib.withUser(sev.label, experience) : 'No severity yet'}
      <//>
      <${Chip} class=${classes('modes-readonly-chip', !dec && 'is-unset')}>${dec ? dec.label : 'No decision yet'}<//>
      ${mode.fixedAt && html`<${Chip} tone="good" class="modes-readonly-chip"><${Icon} name="check" /> Fixed ${formatDay(mode.fixedAt)}<//>`}
      <a class="modes-link" href=${hashFor('funnel')}>Change in What to fix first</a>
    </div>
  </div>`;
}

function ModeCard({ project, mode, count, counted, traceIds, recheckN, others, onMerge, onDelete, flash }) {
  const experience = project.experience;
  const kind = mode.kind === 'success' ? 'success' : 'failure';
  const w = WORDS[kind];
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const name = useDraft(mode.id + ':name', mode.name, (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t) updateProject((p) => lib.updateMode(p, mode.id, { name: t }), 'rename mode');
  });
  const def = useDraft(mode.id + ':definition', mode.definition || '', (text) => {
    updateProject((p) => lib.updateMode(p, mode.id, { definition: text }), 'edit definition');
  });
  useEffect(() => {
    if (flash) scrollToCard(mode.id);
  }, [flash]);

  const stages = (experience && experience.stages) || EMPTY;
  const share = counted ? count / counted : null;
  const hint = kind === 'failure' ? suggestionText(mode) : '';
  // A name is one line: Enter saves it instead of starting a new line.
  const nameKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return html`<article class=${classes('modes-card', 'card', 'is-' + kind)} id=${'modes-card-' + mode.id} tabindex="-1"
    aria-label=${`${w.title}: ${mode.name}`}>
    <div class="modes-card-head">
      <div class="modes-card-titles">
        <${GrowText} id=${'mi' + uid} class="modes-name" value=${name.value} onInput=${name.onInput} onBlur=${name.onBlur}
          onFocus=${name.onFocus} onKeyDown=${nameKey} label=${`Name of this ${w.one}`} />
        <${GrowText} class="modes-def" value=${def.value} onInput=${def.onInput} onBlur=${def.onBlur} onFocus=${def.onFocus}
          placeholder=${w.defHint} label=${`Definition of ${mode.name}`} />
      </div>
      <div class="modes-card-count">
        <span class=${classes('modes-count-num', 'is-' + kind, !count && 'is-zero')}>${formatCount(count)}</span>
        <span class="modes-count-word">${count === 1 ? 'trace' : 'traces'}</span>
        <span class="modes-count-share">${lib.pct(share)}</span>
      </div>
    </div>

    ${recheckN > 0 && html`<${RecheckNote} project=${project} mode=${mode} n=${recheckN} />`}

    <div class="modes-card-grid">
      <label class="modes-field">
        <span class="label">${kind === 'failure' ? 'Stage where it starts' : 'Stage'}</span>
        <select class="select modes-stage" value=${mode.stage || ''}
          onChange=${(e) => { const v = e.currentTarget.value || null; updateProject((p) => lib.updateMode(p, mode.id, { stage: v }), 'mode stage'); }}>
          <option value="">No stage yet</option>
          ${stages.map((s, i) => html`<option key=${s.id} value=${s.id}>${i + 1} ${s.label}</option>`)}
        </select>
      </label>
      ${kind === 'failure' && html`<div class="modes-field modes-instructed">
        <span class="label">Did the AI's instructions ask for this?</span>
        <${Segmented} label="Did the AI's instructions ask for this?" value=${mode.instructed || null}
          options=${lib.INSTRUCTED.map((o) => ({ value: o.id, label: o.label }))}
          onChange=${(v) => updateProject((p) => lib.updateMode(p, mode.id, { instructed: v }), 'instructed')} />
        ${hint && html`<p class="hint modes-instructed-hint">${hint}</p>`}
      </div>`}
    </div>

    ${kind === 'failure' && html`<${DecisionChips} project=${project} mode=${mode} />`}

    <${Evidence} project=${project} mode=${mode} count=${count} traceIds=${traceIds} />

    <div class="modes-card-foot">
      ${mode.source === 'ai' && html`<span class="modes-source"><${Icon} name="sparkle" /> Started from an AI suggestion</span>`}
      <div class="modes-card-actions">
        ${others.length > 0 && html`<${Button} kind="ghost" size="sm" icon="merge" onClick=${() => onMerge(mode)}
          aria-label=${`Merge ${mode.name} into another ${w.one}`}>Merge into...<//>`}
        <${Button} kind="ghost" size="sm" icon="trash" class="modes-delete" onClick=${() => onDelete(mode)}>Delete<//>
      </div>
    </div>
  </article>`;
}

function IgnoreBucket({ project, mode, count, traceIds, onDelete }) {
  const def = useDraft(mode.id + ':definition', mode.definition || '', (text) => {
    updateProject((p) => lib.updateMode(p, mode.id, { definition: text }), 'edit definition');
  });
  const quotes = evidence(project, traceIds, 'ignore').filter((q) => q.text).slice(0, 5);
  return html`<details class="modes-bucket" id=${'modes-card-' + mode.id} tabindex="-1">
    <summary class="modes-bucket-summary">
      <span class="modes-bucket-title">${mode.name}</span>
      <span class="modes-bucket-meta">${plural(count, 'trace')}, not counted in the funnel</span>
      <span class="modes-bucket-chevron"><${Icon} name="chevron-down" /></span>
    </summary>
    <div class="modes-bucket-body">
      <${GrowText} class="modes-def" value=${def.value} onInput=${def.onInput} onBlur=${def.onBlur} onFocus=${def.onFocus}
        placeholder="What belongs here, for example test sessions and unclear traces." label=${`Definition of ${mode.name}`} />
      ${quotes.length > 0 && html`<ul class="modes-quotes">
        ${quotes.map((q) => html`<li key=${q.traceId}><a class="modes-quote" href=${hashFor('review', q.traceId)} onClick=${(e) => openTrace(e, q.traceId, { modeId: mode.id })}>
          <span class="modes-quote-text">${q.text}</span><span class="modes-quote-id">${q.traceId}</span>
        </a></li>`)}
      </ul>`}
      <div class="modes-card-actions">
        ${count > 0 && html`<${Button} kind="ghost" size="sm" icon="arrow-right" onClick=${() => reviewWith(project, { modeId: mode.id })}>Open in Review traces<//>`}
        <${Button} kind="ghost" size="sm" icon="trash" class="modes-delete" onClick=${() => onDelete(mode)}>Delete<//>
      </div>
    </div>
  </details>`;
}

// ---------------------------------------------------------------------------
// Dialogs

function NewModeModal({ project, kind, traceIds, titles, onClose, onCreated }) {
  const w = WORDS[kind];
  const experience = project.experience;
  const stages = (experience && experience.stages) || EMPTY;
  const formId = 'modes-new-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const firstStage = useMemo(() => {
    const stagesOf = traceIds.map((id) => project.reviews && project.reviews[id] && project.reviews[id].stage);
    const set = new Set(stagesOf);
    const only = set.size === 1 ? stagesOf[0] : null;
    return only && lib.isStageId(experience, only) ? only : '';
  }, []);
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [stage, setStage] = useState(firstStage);
  const clean = name.trim();
  const clash = clean && (project.modes || EMPTY).some((m) => m.name.trim().toLowerCase() === clean.toLowerCase());
  const notes = traceIds.map((id) => {
    const r = project.reviews && project.reviews[id];
    return { id, text: String((kind === 'success' ? r && (r.good || r.note) : r && r.note) || '').trim(), title: titles.get(id) || id };
  });

  const submit = (e) => {
    if (e) e.preventDefault();
    if (!clean) return;
    let newId = null;
    updateProject((p) => {
      const made = lib.addMode(p, { kind, name: clean, definition: definition.trim(), stage: stage || null });
      newId = made.id;
      return tagTraces(made.project, traceIds, made.id, kind);
    }, 'new mode');
    onCreated(newId, clean, traceIds.length);
  };

  const footer = html`
    <${Button} kind="ghost" onClick=${onClose}>Cancel<//>
    <${Button} kind="primary" type="submit" form=${formId} disabled=${!clean}>Create ${w.one}<//>`;

  return html`<${Modal} open=${true} title=${`New ${w.one}`} onClose=${onClose} footer=${footer} class="modes-modal">
    <form id=${formId} class="modes-form" onSubmit=${submit}>
      <label class="field">
        <span class="label">Name</span>
        <input class="input" value=${name} onInput=${(e) => setName(e.currentTarget.value)} autofocus
          placeholder=${kind === 'failure' ? 'For example: Ignores requests for a person' : 'For example: Repeats the booking back'} />
        ${clash
          ? html`<span class="hint">A mode with this name already exists. You can still create it, or add the notes to the existing one.</span>`
          : html`<span class="hint">Use words the ${lib.userWord(experience)} would recognize.</span>`}
      </label>
      <label class="field">
        <span class="label">Definition</span>
        <textarea class="textarea modes-form-def" rows="3" value=${definition} placeholder=${w.defHint}
          onInput=${(e) => setDefinition(e.currentTarget.value)}></textarea>
        <span class="hint">${kind === 'failure'
          ? 'Start with "Fails when" and say what a teammate would look for.'
          : 'Start with "Passes when" and say what a teammate would look for.'}</span>
      </label>
      <label class="field">
        <span class="label">${kind === 'failure' ? 'Stage where it starts' : 'Stage'}</span>
        <select class="select" value=${stage} onChange=${(e) => setStage(e.currentTarget.value)}>
          <option value="">No stage yet</option>
          ${stages.map((s, i) => html`<option key=${s.id} value=${s.id}>${i + 1} ${s.label}</option>`)}
        </select>
      </label>
      ${notes.length > 0 && html`<div class="modes-form-notes">
        <span class="label">${notes.length === 1 ? 'This note goes in it' : `These ${notes.length} notes go in it`}</span>
        <ul>
          ${notes.slice(0, 5).map((n) => html`<li key=${n.id}><span>${n.text || '(no note yet)'}</span><span class="modes-form-note-id">${n.title}</span></li>`)}
          ${notes.length > 5 && html`<li class="modes-form-more">and ${plural(notes.length - 5, 'more note')}</li>`}
        </ul>
      </div>`}
    </form>
  <//>`;
}

function goesWith(project, mode) {
  const items = [];
  const id = mode.id;
  const mm = lib.modeMap(project);
  let tagged = 0;
  let back = 0;
  for (const r of Object.values(project.reviews || {})) {
    if (!r) continue;
    const inModes = (r.modes || EMPTY).includes(id);
    if (!inModes && !(r.successModes || EMPTY).includes(id)) continue;
    tagged++;
    const list = inModes ? r.modes : r.successModes;
    const kinds = mode.kind === 'success' ? ['success'] : ['failure', 'ignore'];
    if (!list.some((x) => x !== id && mm.get(x) && kinds.includes(mm.get(x).kind))) back++;
  }
  if (tagged) {
    const where = back ? ` ${back === tagged ? (tagged === 1 ? 'It goes' : 'They go') : `${back} of them go`} back to Notes to sort.` : '';
    items.push(`Its tag on ${plural(tagged, 'trace')}. Your notes stay.${where}`);
  }
  const labels = Object.keys((project.labels && project.labels[id]) || {}).length;
  if (labels) items.push(`${plural(labels, 'label')} (your yes or no for this failure mode)`);
  const critiques = Object.keys((project.critiques && project.critiques[id]) || {}).length;
  if (critiques) items.push(`${plural(critiques, '"Why?" line', '"Why?" lines')} written for AI judge examples`);
  const close = ((project.closeCalls && project.closeCalls[id]) || EMPTY).length;
  if (close) items.push(plural(close, 'close call'));
  for (const c of (project.checks || EMPTY).filter((x) => x.modeId === id)) {
    items.push(`The ${c.type === 'judge' ? 'AI judge' : 'code check'} ${quoted(c.name || c.id)}${c.results && Object.keys(c.results).length ? ', with its results' : ''}`);
  }
  if (project.splits && project.splits[id]) items.push('Its examples, tuning set, and final test');
  const open = (project.suggestions || EMPTY).filter((s) => s.modeId === id && s.status === 'open').length;
  if (open) items.push(`${plural(open, 'open AI suggestion')} (dismissed)`);
  return items;
}

function DeleteModal({ project, mode, onClose, onDone }) {
  const items = goesWith(project, mode);
  const kindWord = mode.kind === 'success' ? 'success mode' : mode.kind === 'ignore' ? 'bucket' : 'failure mode';
  const confirm = () => {
    updateProject((p) => lib.deleteMode(p, mode.id), 'delete mode');
    onDone(mode);
  };
  const footer = html`
    <${Button} kind="ghost" onClick=${onClose}>Cancel<//>
    <${Button} kind="bad" icon="trash" class="is-active" onClick=${confirm}>Delete ${kindWord}<//>`;
  return html`<${Modal} open=${true} title=${`Delete ${quoted(mode.name)}?`} onClose=${onClose} footer=${footer} class="modes-modal">
    ${items.length
      ? html`<p>This also removes:</p><ul class="modes-goes">${items.map((t) => html`<li key=${t}>${t}</li>`)}</ul>`
      : html`<p>Nothing else is tied to it yet.</p>`}
    <p class="hint">This cannot be undone. Download the project first if you might want it back.</p>
  <//>`;
}

function MergeModal({ project, drop, others, onClose, onDone }) {
  const [keepId, setKeepId] = useState(null);
  const keep = others.find((m) => m.id === keepId) || null;
  const counts = lib.modeCounts(project);
  const dropN = (counts.get(drop.id) || {}).traces || 0;
  const checks = (project.checks || EMPTY).filter((c) => c.modeId === drop.id);
  const labels = Object.keys((project.labels && project.labels[drop.id]) || {}).length;
  const name = keep ? quoted(keep.name) : 'the one you pick';
  const confirm = () => {
    if (!keep) return;
    updateProject((p) => lib.mergeModes(p, keep.id, drop.id), 'merge modes');
    onDone(keep);
  };
  const footer = html`
    <${Button} kind="ghost" onClick=${onClose}>Cancel<//>
    <${Button} kind="primary" icon="merge" disabled=${!keep} onClick=${confirm}>Merge<//>`;
  return html`<${Modal} open=${true} title=${`Merge ${quoted(drop.name)} into...`} onClose=${onClose} footer=${footer} class="modes-modal">
    <fieldset class="modes-merge-pick">
      <legend class="label">Keep this one</legend>
      ${others.map((m) => html`<label key=${m.id} class=${classes('modes-merge-option', keepId === m.id && 'is-on')}>
        <input type="radio" name="modes-merge" value=${m.id} checked=${keepId === m.id} onChange=${() => setKeepId(m.id)} />
        <span class="modes-merge-name">${m.name}</span>
        <span class="modes-merge-count">${plural(m.count, 'trace')}</span>
      </label>`)}
    </fieldset>
    <p>${quoted(drop.name)} goes away. ${keep ? `${name} keeps its name and definition.` : 'The one you keep holds on to its name and definition.'}</p>
    <ul class="modes-goes">
      <li>${dropN ? `Its ${plural(dropN, 'trace')} ${dropN === 1 ? 'moves' : 'move'} to ${name}.` : 'It has no traces to move.'}</li>
      ${labels > 0 && html`<li>${plural(labels, 'label')} ${labels === 1 ? 'moves' : 'move'} over where ${name} has none.</li>`}
      ${checks.length > 0 && html`<li>${checks.length === 1 ? 'Its check now belongs' : `Its ${checks.length} checks now belong`} to ${name}.</li>`}
    </ul>
  <//>`;
}

// ---------------------------------------------------------------------------
// The page

function sortModes(rows, experience) {
  const at = (m) => {
    const i = lib.stageIndex(experience, m.stage);
    return Number.isFinite(i) ? i : 999;
  };
  return rows.slice().sort((a, b) => (b.count - a.count) || (at(a.mode) - at(b.mode))
    || (a.mode.name < b.mode.name ? -1 : a.mode.name > b.mode.name ? 1 : 0));
}

function ModesPage({ project }) {
  const [kind, setKindState] = useState(lastKind);
  const setKind = (k) => {
    lastKind = k;
    setKindState(k);
  };
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);
  const [dialog, setDialog] = useState(null);
  const [flash, setFlash] = useState(null);
  const headRef = useRef(null);

  const experience = project.experience;
  const w = WORDS[kind];
  const stats = useMemo(() => lib.reviewStats(project), [project.reviews, project.traces]);
  const counts = lib.modeCounts(project);
  const counted = lib.countedTotal(project);
  const notes = useMemo(() => lib.unassignedNotes(project, kind), [project.reviews, project.modes, project.traces, kind]);
  const norm = lib.normalizeAll(project);
  const titles = useMemo(() => {
    const m = new Map();
    for (const n of notes) m.set(n.traceId, (norm.get(n.traceId) || {}).title || n.traceId);
    for (const s of project.suggestions || EMPTY) {
      if (s.kind === 'mode') for (const id of s.traceIds || EMPTY) if (!m.has(id)) m.set(id, (norm.get(id) || {}).title || id);
    }
    return m;
  }, [notes, norm, project.suggestions]);

  const rows = sortModes((project.modes || EMPTY).filter((m) => m.kind === kind).map((mode) => {
    const c = counts.get(mode.id) || { traces: 0, traceIds: EMPTY };
    return { mode, count: c.traces, traceIds: c.traceIds };
  }), experience);
  const ignoreModes = kind === 'failure' ? (project.modes || EMPTY).filter((m) => m.kind === 'ignore') : EMPTY;
  const suggestions = (project.suggestions || EMPTY).filter((s) => s.kind === 'mode' && s.status === 'open'
    && ((s.mode && s.mode.kind === 'success') ? 'success' : 'failure') === kind);
  const recheck = useMemo(() => {
    const m = new Map();
    if (stats.reviewed < 20) return m;
    for (const item of lib.recheckQueue(project)) for (const id of item.modeIds) m.set(id, (m.get(id) || 0) + 1);
    return m;
  }, [project.reviews, project.modes, project.labels, stats.reviewed]);
  const failureCount = (project.modes || EMPTY).filter((m) => m.kind === 'failure').length;
  const groupGate = Number(experience && experience.groupGate) || 30;
  const aiOpen = stats.reviewed >= groupGate;

  // Keep the selection to notes that are still waiting.
  const waiting = new Set(notes.map((n) => n.traceId));
  const liveSelected = [...selected].filter((id) => waiting.has(id));
  const selectedSet = liveSelected.length === selected.size ? selected : new Set(liveSelected);

  const clear = () => {
    setSelected(new Set());
    anchor.current = null;
  };
  // Escape clears the selection, unless it is closing an open menu first.
  useKeys({
    Escape: () => {
      if (!document.querySelector('.menu:popover-open')) clear();
      return false;
    },
  }, { active: selectedSet.size > 0 && !dialog });

  const onSelect = (i, shift) => {
    const id = notes[i] && notes[i].traceId;
    if (!id) return;
    const a = shift && anchor.current != null ? notes.findIndex((n) => n.traceId === anchor.current) : -1;
    setSelected((prev) => {
      const next = new Set([...prev].filter((x) => waiting.has(x)));
      if (a >= 0) {
        const lo = Math.min(a, i);
        const hi = Math.max(a, i);
        for (let k = lo; k <= hi; k++) next.add(notes[k].traceId);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (a === -1) anchor.current = id;
  };

  const openNew = (traceIds = []) => setDialog({ type: 'new', traceIds, seq: Date.now() });
  const onCreated = (id, name, n) => {
    setDialog(null);
    clear();
    setFlash(id);
    toast(`Created ${quoted(name)}${n ? ` with ${noteCount(n)}` : ''}.`, { tone: 'good' });
  };
  const afterRemove = (message) => {
    setDialog(null);
    toast(message);
    requestAnimationFrame(() => headRef.current && headRef.current.focus());
  };

  const others = (mode) => rows.filter((r) => r.mode.id !== mode.id).map((r) => ({ ...r.mode, count: r.count }));
  const hasAnything = rows.length || notes.length || suggestions.length || ignoreModes.length;

  let body;
  if (!hasAnything) {
    body = html`<div class="card modes-empty-card"><${EmptyState} icon=${kind === 'failure' ? 'merge' : 'check'}
      title=${kind === 'failure' ? 'No failure modes yet' : 'No success modes yet'}
      body=${kind === 'failure'
        ? 'Failure modes come from your notes. Mark a few traces as Problem in Review traces and write what went wrong.'
        : 'Success modes come from "What went well?" notes on Good traces.'}
      action=${{ label: 'Next: Review traces', onClick: () => navigate('review') }} /></div>`;
  } else {
    body = html`<div class="modes-layout">
      <${NotesPanel} project=${project} kind=${kind} notes=${notes} titles=${titles} selected=${selectedSet}
        onSelect=${onSelect} onSelectAll=${() => setSelected(new Set(notes.map((n) => n.traceId)))} onClear=${clear}
        modes=${rows.map((r) => r.mode)} onNew=${openNew} noNote=${kind === 'failure' ? stats.needsNote : 0} />
      <div class="modes-main">
        ${kind === 'failure' && failureCount > 10 && html`<div class="modes-hint-many" role="note">
          <${Icon} name="warning" />
          <p>More than 10 failure modes is hard to act on. Merge the ones that share a fix.</p>
        </div>`}
        ${suggestions.length > 0 && html`<section class="modes-suggestions" aria-labelledby="modes-sugg-title">
          <div class="modes-summary-head">
            <h2 class="modes-h2" id="modes-sugg-title">Suggested by AI <span class="modes-count-badge">${suggestions.length}</span></h2>
            <span class="hint">Nothing changes until you accept. Untick any note that does not belong.</span>
          </div>
          ${suggestions.map((s) => html`<${SuggestionCard} key=${s.id} project=${project} suggestion=${s} titles=${titles} />`)}
        </section>`}
        ${rows.length > 0 && html`<${SummaryBars} rows=${rows} counted=${counted} kind=${kind} />`}
        ${rows.length === 0 && html`<div class="modes-start">
          <span class="modes-start-icon"><${Icon} name=${kind === 'failure' ? 'merge' : 'check'} size=${20} /></span>
          <div>
            <h2 class="modes-h2">Name your first ${w.one}</h2>
            <p>Select the notes that describe the same ${kind === 'failure' ? 'problem' : 'thing done well'}, then choose
              <strong> New ${w.one} from selected</strong>. Name it the way the ${lib.userWord(experience)} would put it.</p>
          </div>
        </div>`}
        ${rows.map((r) => html`<${ModeCard} key=${r.mode.id} project=${project} mode=${r.mode} count=${r.count} counted=${counted}
          traceIds=${r.traceIds} recheckN=${kind === 'failure' ? recheck.get(r.mode.id) || 0 : 0} others=${others(r.mode)}
          flash=${flash === r.mode.id}
          onMerge=${(drop) => setDialog({ type: 'merge', drop, others: others(drop) })}
          onDelete=${(mode) => setDialog({ type: 'delete', mode })} />`)}
        ${ignoreModes.map((m) => {
          const c = counts.get(m.id) || { traces: 0, traceIds: EMPTY };
          return html`<${IgnoreBucket} key=${m.id} project=${project} mode=${m} count=${c.traces} traceIds=${c.traceIds}
            onDelete=${(mode) => setDialog({ type: 'delete', mode })} />`;
        })}
        ${rows.length > 0 && notes.length === 0 && html`<div class="modes-next">
          <p>${kind === 'failure' ? 'Every note is sorted. Next, see where each failure mode starts.' : 'Every note is sorted.'}</p>
          <${Button} kind="primary" icon="arrow-right" onClick=${() => navigate('funnel')}>Next: Funnel<//>
        </div>`}
      </div>
    </div>`;
  }

  return html`<section class="page modes" aria-labelledby="modes-title">
    <header class="modes-head">
      <div class="modes-head-text">
        <h1 class="page-title" id="modes-title" tabindex="-1" ref=${headRef}>Failure modes</h1>
        <p class="page-lead">${kind === 'failure'
          ? 'Sort your notes into a short list of named problems. Aim for fewer than 10.'
          : 'Name what went well at each stage, so you know what to keep working.'}</p>
      </div>
      <${Segmented} label="Show" options=${KIND_OPTIONS} value=${kind} onChange=${(k) => { clear(); setKind(k); }} />
    </header>

    <div class="modes-toolbar">
      <${Button} kind="primary" icon="plus" onClick=${() => openNew([])}>New ${w.one}<//>
      <div class="modes-ai">
        <${Button} kind="secondary" icon=${aiOpen ? 'sparkle' : 'lock'} disabled=${!aiOpen}
          onClick=${() => setUi({ assistOpen: { mode: 'group', kind } })} aria-describedby=${aiOpen ? undefined : 'modes-ai-lock'}>Group my notes with AI<//>
        ${!aiOpen && html`<span class="hint modes-ai-lock" id="modes-ai-lock">Grouping with AI unlocks after ${groupGate} reviewed traces (you've done ${formatCount(stats.reviewed)})</span>`}
      </div>
    </div>

    ${body}

    ${dialog && dialog.type === 'new' && html`<${NewModeModal} key=${dialog.seq} project=${project} kind=${kind}
      traceIds=${dialog.traceIds} titles=${titles} onClose=${() => setDialog(null)} onCreated=${onCreated} />`}
    ${dialog && dialog.type === 'delete' && html`<${DeleteModal} project=${project} mode=${dialog.mode}
      onClose=${() => setDialog(null)} onDone=${(m) => afterRemove(`Deleted ${quoted(m.name)}.`)} />`}
    ${dialog && dialog.type === 'merge' && html`<${MergeModal} project=${project} drop=${dialog.drop} others=${dialog.others}
      onClose=${() => setDialog(null)}
      onDone=${(keep) => { setDialog(null); setFlash(null); requestAnimationFrame(() => setFlash(keep.id)); toast(`Merged into ${quoted(keep.name)}.`); }} />`}
  </section>`;
}

/** The Failure modes tab. */
export default function ModesView() {
  const project = useStore((s) => s.project);
  if (!project) return null;
  return html`<${RendererBoundary} fallback=${(error, reset) => html`<${ViewError} error=${error} reset=${reset} />`}>
    <${ModesPage} project=${project} />
  <//>`;
}
