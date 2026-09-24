// Review traces (SPEC 5.3): read each trace the way the user saw it, mark Good or Problem,
// and write what went wrong. Left rail: progress, saturation, filters, the current set, and
// the trace list. Center: the trace. Right: "Your judgment" (views/shared.mjs).

import {
  html, useStore, useState, useEffect, useMemo, useRef, useLayoutEffect, useKeys,
  Button, Chip, Drawer, Modal, Menu, Icon, Kbd, ProgressBar, Spark, EmptyState, Segmented, CopyButton,
  classes, plural, formatCount, toast,
} from 'pmstack/ui';
import { store, updateProject, navigate, setUi, getSampleIndex, DEFAULT_FILTERS } from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { TraceView, showHiddenFor } from '../renderers/index.mjs';
import { ContextPanel } from 'pmstack/renderers/common';
import {
  TraceList, JudgmentPanel, changeTrace, toolCallBadges, suggestionHighlights, traceFlags, useMedia, gates,
} from './shared.mjs';

const EMPTY = Object.freeze([]);
const CAP_STEP = 200;

const STATUS_OPTIONS = [
  ['all', 'All'],
  ['todo', 'To review'],
  ['pass', 'Good'],
  ['fail', 'Problem'],
  ['skip', 'Not sure yet'],
  ['suggested', 'AI flagged'],
  ['recheck', 'Re-check'],
  ['needsNote', 'Needs a note'],
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS);

const LEVEL_ICON = { early: 'note', group: 'merge', keep: 'arrow-right', stop: 'check' };

// ---------------------------------------------------------------------------
// Filters

const metaEntries = (f) => Object.entries(f.meta || {}).filter(([, v]) => v != null && v !== '');

function isPlain(f) {
  return (!f.status || f.status === 'all') && !metaEntries(f).length && !f.modeId && !f.stage && !f.text && f.version == null;
}

function activeCount(f) {
  return (f.status && f.status !== 'all' ? 1 : 0) + metaEntries(f).length + (f.modeId ? 1 : 0) + (f.stage ? 1 : 0)
    + (f.version != null ? 1 : 0) + (f.text ? 1 : 0);
}

const keyLabel = (k) => {
  const s = String(k).replace(/([a-z0-9])([A-Z])/g, (m, a, b) => a + ' ' + b.toLowerCase()).replace(/[_.]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

function filterSummary(f, project) {
  const exp = project.experience || {};
  const parts = [];
  if (f.status && f.status !== 'all') parts.push(STATUS_LABEL[f.status] || f.status);
  for (const [k, v] of metaEntries(f)) parts.push(`${keyLabel(k)}: ${v}`);
  if (f.modeId) parts.push(lib.modeMap(project).get(f.modeId)?.name || f.modeId);
  if (f.stage) parts.push(f.stage === 'unknown' ? 'Unknown stage' : `Went wrong at ${lib.stageLabel(exp, f.stage)}`);
  if (f.version != null) parts.push(String(f.version));
  if (f.text) parts.push(`"${f.text}"`);
  return parts.join(', ');
}

// Replace filters from the latest store state (typing and clicks may overlap).
function patchFilters(patch) {
  setUi({ filters: { ...store.get().ui.filters, ...patch } });
}

// A filter looks across all traces; "This set" stays one click away.
function setFilter(patch) {
  const cur = store.get().ui.filters;
  patchFilters(isPlain(cur) && cur.scope === 'set' ? { ...patch, scope: 'all' } : patch);
}

// Back to no filters; the list shows the current set again when one is in progress.
function clearFilters() {
  setUi({ filters: { ...DEFAULT_FILTERS } });
}

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Hidden for this page view only.
  }
}

// ---------------------------------------------------------------------------
// Picking the next set

let pickRound = 0;

function pickSet(strategy, signal = null) {
  const p = store.get().project;
  if (!p) return;
  pickRound += 1;
  const seed = (Number(p.settings?.seed) || 7) + pickRound * 101 + Object.keys(p.reviews || {}).length;
  const items = lib.nextBatch(p, { size: 20, strategy, signal, seed });
  if (!items.length) {
    toast('Every trace has a verdict, so there is nothing left to pick.');
    return;
  }
  updateProject((q) => lib.setBatch(q, items, strategy), 'next set');
  setUi({ filters: { ...DEFAULT_FILTERS, scope: 'set' } });
  navigate('review', items[0].traceId);
  toast(`Picked ${plural(items.length, 'trace')} for your next set.`);
}

// Details worth picking by, over traces still to review: [{ key, values: [{ value, count }] }].
function detailOptions(project) {
  const norm = lib.normalizeAll(project);
  const byKey = new Map();
  for (const [id, n] of norm) {
    if (project.reviews?.[id]?.verdict) continue;
    for (const [k, v] of Object.entries(n.metadata || {})) {
      if (v == null || v === '' || String(v).length > 60) continue;
      if (!byKey.has(k)) byKey.set(k, new Map());
      const m = byKey.get(k);
      m.set(String(v), (m.get(String(v)) || 0) + 1);
    }
  }
  const filters = project.experience?.filters || EMPTY;
  const out = [];
  for (const [key, m] of byKey) {
    if (m.size > 40) continue;
    const values = [...m.entries()].map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    out.push({ key, values });
  }
  const rank = (k) => (filters.includes(k) ? filters.indexOf(k) : 100);
  return out.sort((a, b) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function DetailPickModal({ open, project, onClose }) {
  const options = useMemo(() => (open ? detailOptions(project) : EMPTY), [open, project.traces, project.reviews]);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const chosen = options.find((o) => o.key === key) || options[0] || null;
  const values = chosen ? chosen.values : EMPTY;
  const current = values.find((v) => v.value === value) || values[0] || null;
  const pick = () => {
    if (!chosen || !current) return;
    onClose();
    pickSet('signal', { key: chosen.key, value: current.value });
  };
  return html`<${Modal} open=${open} title="Pick traces with a specific detail" onClose=${onClose}
    footer=${html`<${Button} kind="ghost" onClick=${onClose}>Cancel<//>
      <${Button} kind="primary" disabled=${!current} onClick=${pick}>Pick up to 20<//>`}>
    ${options.length
      ? html`<div class="stack">
          <p class="soft">Good for signals like feedback = thumbs down. At least 30% of the set stays random, so you still see the unexpected.</p>
          <label class="field">
            <span class="label">Detail</span>
            <select value=${chosen ? chosen.key : ''} onInput=${(e) => { setKey(e.currentTarget.value); setValue(''); }}>
              ${options.map((o) => html`<option key=${o.key} value=${o.key}>${keyLabel(o.key)}</option>`)}
            </select>
          </label>
          <label class="field">
            <span class="label">Value</span>
            <select value=${current ? current.value : ''} onInput=${(e) => setValue(e.currentTarget.value)}>
              ${values.map((v) => html`<option key=${v.value} value=${v.value}>${v.value} (${plural(v.count, 'trace')} to review)</option>`)}
            </select>
          </label>
        </div>`
      : html`<p class="soft">The traces left to review have no details to pick by.</p>`}
  <//>`;
}

// ---------------------------------------------------------------------------
// Rail blocks

function ProgressBlock({ project, stats }) {
  const { hint, spark } = useMemo(() => {
    const curve = lib.discoveryCurve(project);
    const values = [];
    for (let i = 9; i < curve.length; i += 10) values.push(curve[i].newInWindow);
    return { hint: lib.saturationHint(project), spark: values };
  }, [project.reviews, project.modes, project.traces]);
  const failureCount = (project.modes || EMPTY).filter((m) => m.kind === 'failure').length;
  const showSpark = stats.reviewed >= 10 && failureCount > 0 && spark.length >= 2;
  const { groupGate } = gates(project);
  return html`<section class="review-rail-block review-progress" aria-label="Progress">
    <p class="review-progress-count"><strong class="num">${formatCount(stats.reviewed)}</strong> of ${formatCount(stats.total)} reviewed</p>
    <${ProgressBar} value=${stats.reviewed} max=${stats.total || 1} label="Traces reviewed" />
    <p class="review-progress-split">
      <span class="is-pass"><${Icon} name="check" size=${12} />${formatCount(stats.pass)} Good</span>
      <span class="is-fail"><${Icon} name="x" size=${12} />${formatCount(stats.fail)} Problem</span>
      ${stats.skip > 0 && html`<span><${Icon} name="skip" size=${12} />${formatCount(stats.skip)} Not sure yet</span>`}
    </p>
    ${hint.level !== 'early' && html`<p class="hint">Aim for 100, or until new failure modes stop appearing.</p>`}
    <div class=${classes('review-sat', 'is-' + hint.level)}>
      <p class="review-sat-msg"><span class="review-sat-icon"><${Icon} name=${LEVEL_ICON[hint.level] || 'note'} size=${14} /></span><span>${hint.message}</span></p>
      ${showSpark && html`<div class="review-sat-spark">
        <${Spark} values=${spark} width=${88} height=${24} label=${'New failure modes in each 10 traces: ' + spark.join(', ')} />
        <span class="hint">New failure modes per 10 traces</span>
      </div>`}
      ${hint.level === 'group' && html`<div class="row">
        <${Button} kind="secondary" size="sm" icon="merge" onClick=${() => navigate('modes')}>Group notes<//>
        ${stats.reviewed >= groupGate && html`<${Button} kind="ghost" size="sm" icon="sparkle" onClick=${() => setUi({ assistOpen: { mode: 'group' } })}>Group with AI<//>`}
      </div>`}
      ${hint.level === 'stop' && html`<div class="row"><${Button} kind="secondary" size="sm" icon="arrow-right" onClick=${() => navigate('checks')}>Next: Checks<//></div>`}
    </div>
  </section>`;
}

function SearchBox({ value }) {
  const [text, setText] = useState(value || '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value || '');
  }, [value]);
  useEffect(() => {
    if ((value || '') === text) return undefined;
    const t = setTimeout(() => setFilter({ text: text.trim() }), 200);
    return () => clearTimeout(t);
  }, [text]);
  return html`<input type="search" class="review-search" value=${text} placeholder="Words in a trace or a note"
    onInput=${(e) => setText(e.currentTarget.value)}
    onFocus=${() => { focused.current = true; }} onBlur=${() => { focused.current = false; }} />`;
}

function FilterPanel({ project, filters, counts }) {
  const exp = project.experience || {};
  const cov = useMemo(() => lib.coverage(project), [project.traces, project.experience, project.reviews]);
  const versions = lib.traceVersions(project);
  const showVersion = versions.length >= 2 && !(exp.filters || EMPTY).includes('version');
  const modes = project.modes || EMPTY;
  const groups = [
    ['Failure modes', modes.filter((m) => m.kind === 'failure')],
    ['Success modes', modes.filter((m) => m.kind === 'success')],
    ['Other', modes.filter((m) => m.kind === 'ignore')],
  ].filter(([, list]) => list.length);
  const setMeta = (k, v) => {
    const meta = { ...(store.get().ui.filters.meta || {}) };
    if (v) meta[k] = v;
    else delete meta[k];
    setFilter({ meta });
  };
  return html`<div class="review-filter-panel" id="review-filters">
    <fieldset class="review-fieldset">
      <legend class="label">Status</legend>
      <div class="review-status-chips">
        ${STATUS_OPTIONS.map(([v, label]) => html`<${Chip} key=${v} selected=${(filters.status || 'all') === v}
          onClick=${() => setFilter({ status: v })}>${label}<span class="review-count num">${formatCount(counts[v] ?? 0)}</span><//>`)}
      </div>
    </fieldset>
    ${((exp.filters || EMPTY).length > 0 || showVersion) && html`<div class="review-filter-grid">
      ${(exp.filters || EMPTY).map((k) => html`<label class="field" key=${k}>
        <span class="label">${keyLabel(k)}</span>
        <select value=${filters.meta?.[k] ?? ''} onInput=${(e) => setMeta(k, e.currentTarget.value)}>
          <option value="">Any</option>
          ${(cov[k] || EMPTY).map((r) => html`<option key=${r.value} value=${r.value}>${r.value} (${formatCount(r.total)})</option>`)}
        </select>
      </label>`)}
      ${showVersion && html`<label class="field">
        <span class="label">Version</span>
        <select value=${filters.version ?? ''} onInput=${(e) => setFilter({ version: e.currentTarget.value || null })}>
          <option value="">Any</option>
          ${versions.map((v) => html`<option key=${v} value=${v}>${v}</option>`)}
        </select>
      </label>`}
    </div>`}
    ${groups.length > 0 && html`<label class="field">
      <span class="label">Failure or success mode</span>
      <select value=${filters.modeId ?? ''} onInput=${(e) => setFilter({ modeId: e.currentTarget.value || null })}>
        <option value="">Any</option>
        ${groups.map(([label, list]) => html`<optgroup label=${label} key=${label}>
          ${list.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
        </optgroup>`)}
      </select>
    </label>`}
    ${(exp.stages || EMPTY).length > 0 && html`<label class="field">
      <span class="label">Where it first went wrong</span>
      <select value=${filters.stage ?? ''} onInput=${(e) => setFilter({ stage: e.currentTarget.value || null })}>
        <option value="">Any</option>
        ${exp.stages.map((s, i) => html`<option key=${s.id} value=${s.id}>${i + 1} ${s.label}</option>`)}
        <option value="unknown">Unknown stage</option>
      </select>
    </label>`}
    <label class="field">
      <span class="label">Search</span>
      <${SearchBox} value=${filters.text || ''} />
    </label>
  </div>`;
}

function reasonChips(items) {
  const counts = new Map();
  for (const it of items) {
    const r = String(it.reason || '').trim();
    if (r) counts.set(r, (counts.get(r) || 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
}

function SetBlock({ project, stats, batchIds, batchLeft, currentId }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const pool = Math.max(0, stats.total - stats.pass - stats.fail - stats.skip);
  const size = Math.min(20, pool);
  const checks = project.checks || EMPTY;
  const hasFlags = checks.some((c) => c.type !== 'judge' || Object.keys(c.results || {}).length);
  const hasJudge = checks.some((c) => c.type === 'judge' && Object.keys(c.results || {}).length);
  const label = (id) => lib.STRATEGIES.find((s) => s.id === id)?.label || id;
  const more = [
    { label: label('random'), onClick: () => pickSet('random') },
    { label: label('outliers'), hint: 'Longest, shortest, most steps, failed steps', onClick: () => pickSet('outliers') },
    { label: label('signal'), hint: 'For example feedback = thumbs down', onClick: () => setDetailOpen(true) },
    { label: label('flagged'), hint: hasFlags ? 'Use with care: finds what your checks already know' : 'Build a check first', disabled: !hasFlags, onClick: () => pickSet('flagged') },
    { label: label('disagree'), hint: hasJudge ? 'Traces where an AI judge and your label differ' : 'Needs AI judge results first', disabled: !hasJudge, onClick: () => pickSet('disagree') },
  ];
  const reasons = reasonChips((project.batch?.items || EMPTY).filter((it) => batchIds.includes(String(it.traceId))));
  const here = currentId ? (project.batch?.items || EMPTY).find((it) => String(it.traceId) === currentId) : null;
  const hereReason = here && String(here.reason || '').trim();
  const done = batchIds.length - batchLeft;

  let body;
  if (pool === 0 && (!batchIds.length || batchLeft === 0)) {
    body = html`<p class="review-set-line"><${Icon} name="check" size=${14} /><span>Every trace has a verdict.</span></p>`;
  } else if (batchIds.length && batchLeft > 0) {
    body = html`
      <p class="review-set-line"><span><strong>Set of ${formatCount(batchIds.length)}</strong>: ${formatCount(batchLeft)} left</span></p>
      <${ProgressBar} value=${done} max=${batchIds.length} label="Set progress" />
      ${hereReason && html`<p class="review-set-here"><span class="hint">Picked for</span><span class="review-tag" title=${hereReason}>${hereReason}</span></p>`}
      <div class="review-set-foot">
        ${reasons.length > 0
          ? html`<button type="button" class="review-link review-set-why" aria-expanded=${why ? 'true' : 'false'} aria-controls="review-set-reasons"
              onClick=${() => setWhy(!why)}>${why ? 'Hide reasons' : `Why these ${batchIds.length}`}</button>`
          : html`<span></span>`}
        <${Menu} kind="ghost" size="sm" label="More ways to pick" align="end"
          items=${[{ label: 'Mix', hint: 'Covers your details and conversation lengths', onClick: () => pickSet('mix') }, 'divider', ...more]} />
      </div>
      ${why && html`<div class="review-set-reasons" id="review-set-reasons">
        ${reasons.map((r) => html`<span class="review-tag" key=${r.reason} title=${r.reason}>${r.reason}${r.count > 1 ? ` (${r.count})` : ''}</span>`)}
      </div>`}`;
  } else {
    body = html`
      <p class="review-set-line">${batchIds.length
        ? html`<${Icon} name="check" size=${14} /><strong>Set done.</strong>`
        : 'Review in sets of 20, picked to cover your traces.'}</p>
      <div class="row">
        <${Button} kind="primary" size="sm" class="review-pick" onClick=${() => pickSet('mix')}>
          ${batchIds.length ? (size === 20 ? 'Pick 20 more' : `Pick the last ${size}`) : `Pick a set of ${size}`}
        <//>
        <${Menu} kind="ghost" size="sm" label="More ways to pick" items=${more} />
      </div>`;
  }
  return html`<section class="review-rail-block review-set" aria-label="Your set">
    ${body}
    <${DetailPickModal} open=${detailOpen} project=${project} onClose=${() => setDetailOpen(false)} />
  </section>`;
}

function ListBlock({ project, ids, filters, counts, filterOpen, onToggleFilter, currentId, scope, hasBatch, cap, onShowMore, onOpen, flaggedIds }) {
  const n = activeCount(filters);
  return html`<section class="review-rail-block review-listblock" aria-label="Trace list">
    <div class="review-list-top">
      <div class="review-list-head">
        <h2 class="section-title">${scope === 'set' ? 'This set' : 'All traces'} <span class="num">${formatCount(ids.length)}</span></h2>
        <${Button} kind="secondary" size="sm" icon="filter" class=${classes('review-filter-btn', filterOpen && 'is-open')}
          aria-expanded=${filterOpen ? 'true' : 'false'} aria-controls="review-filters" onClick=${onToggleFilter}>
          Filter${n > 0 && html`<span class="badge review-filter-badge">${n}<span class="sr-only"> active</span></span>`}
        <//>
      </div>
      ${hasBatch && html`<${Segmented} label="Which traces to list" value=${scope}
        options=${[{ value: 'set', label: 'This set' }, { value: 'all', label: 'All traces' }]}
        onChange=${(v) => patchFilters({ scope: v })} />`}
      ${n > 0 && html`<div class="review-filter-summary">
        <span>${filterOpen ? `${plural(n, 'filter')} on` : `Showing: ${filterSummary(filters, project)}`}</span>
        <button type="button" class="review-link" onClick=${clearFilters}>Clear filters</button>
      </div>`}
      ${filterOpen && html`<${FilterPanel} project=${project} filters=${filters} counts=${counts} />`}
    </div>
    <div class="review-list-scroll review-scroll">
      ${ids.length
        ? html`<${TraceList} project=${project} ids=${ids} currentId=${currentId} cap=${cap} onShowMore=${onShowMore}
            onOpen=${onOpen} flaggedIds=${flaggedIds} label=${scope === 'set' ? 'Traces in this set' : 'Traces'} />`
        : html`<div class="review-list-empty">
            <p>${n > 0 ? (scope === 'set' ? 'No traces in this set match these filters.' : 'No traces match these filters.') : 'This set is empty.'}</p>
            ${n > 0
              ? html`<${Button} kind="secondary" size="sm" onClick=${clearFilters}>Clear filters<//>`
              : html`<${Button} kind="secondary" size="sm" onClick=${() => patchFilters({ scope: 'all' })}>Show all traces<//>`}
          </div>`}
    </div>
  </section>`;
}

function ReviewRail(props) {
  const { project, stats, batchIds, batchLeft } = props;
  return html`<div class="review-rail-inner">
    <${ProgressBlock} project=${project} stats=${stats} />
    <${SetBlock} project=${project} stats=${stats} batchIds=${batchIds} batchLeft=${batchLeft} currentId=${props.currentId} />
    <${ListBlock} ...${props} hasBatch=${batchIds.length > 0} />
  </div>`;
}

// ---------------------------------------------------------------------------
// Center pieces

function GuessedBanner({ project }) {
  if (!project.settings?.guessed) return null;
  const exp = project.experience || {};
  const viewId = lib.normalizeViewId(exp.renderer);
  const view = lib.VIEWS.find((v) => v.id === viewId)?.label
    || (String(viewId).startsWith('custom:') ? `Custom view ${String(viewId).slice(7)}` : 'Automatic');
  const n = (exp.stages || EMPTY).length;
  const dismiss = () => updateProject((p) => ({ ...p, settings: { ...(p.settings || {}), guessed: false }, updatedAt: new Date().toISOString() }), 'setup guessed');
  return html`<div class="review-banner" role="status">
    <${Icon} name="layout" />
    <p>We guessed your setup: <strong>${view}</strong>, ${plural(n, 'stage')}.</p>
    <div class="review-banner-actions">
      <${Button} kind="secondary" size="sm" onClick=${() => navigate('setup')}>Adjust<//>
      <${Button} kind="ghost" size="sm" onClick=${dismiss}>Looks right<//>
    </div>
  </div>`;
}

// Views that draw fields straight from the raw trace, so they show text even without messages.
const LISTS_FIELDS = new Set(['auto', 'layout']);

// True when the trace shows the reader some text: what the user asked, or a step they saw.
function showsText(trace) {
  if (trace.input && String(trace.input).trim()) return true;
  return (trace.steps || EMPTY).some((st) => st.customerVisible && st.text && String(st.text).trim());
}

function NoTextBanner({ who }) {
  return html`<div class="review-banner" role="status">
    <${Icon} name="warning" />
    <p>This trace shows no text. Pick the field that holds what the ${who} asked, so each trace shows text.</p>
    <div class="review-banner-actions">
      <${Button} kind="secondary" size="sm" onClick=${() => navigate('setup', 'traces')}>Pick the fields in Set up<//>
    </div>
  </div>`;
}

function RecheckBanner({ project, queue, filters }) {
  const [hidden, setHidden] = useState(false);
  const modeIds = new Set();
  for (const q of queue) for (const id of q.modeIds) modeIds.add(id);
  if (hidden || queue.length < 5 || modeIds.size < 2 || filters.status === 'recheck') return null;
  const show = () => {
    setUi({ filters: { ...DEFAULT_FILTERS, status: 'recheck', scope: 'all' } });
    const first = lib.filterTraces(project, { status: 'recheck' })[0];
    if (first) navigate('review', first);
  };
  return html`<div class="review-banner" role="status">
    <${Icon} name="warning" />
    <p>${modeIds.size} failure modes were added after you reviewed ${formatCount(queue.length)} traces. Re-check them so your counts stay right.</p>
    <div class="review-banner-actions">
      <${Button} kind="secondary" size="sm" onClick=${show}>Show traces to re-check<//>
      <${Button} kind="ghost" size="sm" icon="x" title="Hide this message" onClick=${() => setHidden(true)} />
    </div>
  </div>`;
}

// How many traces a sample had reviewed the first time this browser showed it.
function firstSeenReviewed(project, reviewed) {
  const key = 'pmstack-review-first:' + project.id;
  try {
    const seen = localStorage.getItem(key);
    if (seen != null) return Number(seen) || 0;
    localStorage.setItem(key, String(reviewed));
  } catch {
    // Without storage, samples/index.json decides.
  }
  return reviewed;
}

// True when this sample ships partly reviewed (samples/index.json, or what this browser saw first).
function useShippedReviewed(project, reviewed) {
  const [shipped, setShipped] = useState(() => !!project.sample && firstSeenReviewed(project, reviewed) > 0);
  useEffect(() => {
    let live = true;
    if (!project.sample) return undefined;
    getSampleIndex().then((list) => {
      const entry = (list || EMPTY).find((x) => x && x.id === project.id);
      if (live && entry) setShipped(Number(entry.reviewed) > 0);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [project.id, project.sample]);
  return shipped;
}

function IntroStrip({ project, stats, who }) {
  const sampleKey = 'pmstack-review-sample:' + project.id;
  const [hideTip, setHideTip] = useState(() => readFlag('pmstack-review-tip'));
  const [hideSample, setHideSample] = useState(() => readFlag(sampleKey));
  const shipped = useShippedReviewed(project, stats.reviewed);
  const showSample = shipped && stats.reviewed > 0 && !hideSample;
  if (hideTip && !showSample) return null;
  const dismiss = () => {
    writeFlag('pmstack-review-tip');
    if (showSample) writeFlag(sampleKey);
    setHideTip(true);
    setHideSample(true);
  };
  return html`<aside class="review-strip" aria-label="How to review">
    <div class="review-strip-text">
      ${!hideTip && html`<p>Read the trace. Press <${Kbd}>1<//> if it is good, <${Kbd}>2<//> if there is a problem, then write what went wrong as the ${who} would describe it.</p>`}
      ${showSample && html`<p class="review-strip-sample">Sample: ${formatCount(stats.reviewed)} of ${formatCount(stats.total)} already reviewed, so every tab has something to show.</p>`}
    </div>
    <${Button} kind="ghost" size="sm" icon="x" title="Dismiss" onClick=${dismiss} />
  </aside>`;
}

function Toggle({ on, onClick, children, kbd, title }) {
  return html`<button type="button" class=${classes('review-toggle', on && 'is-on')} aria-pressed=${on ? 'true' : 'false'} title=${title} onClick=${onClick}>
    <span class="review-switch" aria-hidden="true"></span>
    <span class="review-toggle-label">${children}</span>
    ${kbd && html`<${Kbd}>${kbd}<//>`}
  </button>`;
}

function orderedDetails(metadata, filters) {
  const entries = Object.entries(metadata || {}).filter(([, v]) => v != null && v !== '');
  const rank = (k) => (filters.includes(k) ? filters.indexOf(k) : filters.length);
  return entries.sort((a, b) => rank(a[0]) - rank(b[0]));
}

function TraceHeader({ trace, exp, index, count, scope, filtered, showHidden, onToggleHidden, raw, onToggleRaw, allDetails, onAllDetails }) {
  const details = orderedDetails(trace.metadata, exp.filters || EMPTY);
  const shown = allDetails ? details : details.slice(0, 4);
  return html`<header class="review-head">
    <div class="review-head-bar">
      <p class="review-pos">
        ${index >= 0
          ? html`<span class="num">${formatCount(index + 1)}</span> of ${formatCount(count)}${scope === 'set' ? ' in this set' : ''}`
          : html`<span>${filtered ? 'Not in the filtered list' : scope === 'set' ? 'Not in this set' : 'Not in this list'}</span>
              ${' '}<button type="button" class="review-link" onClick=${filtered ? clearFilters : () => patchFilters({ scope: 'all' })}>
                ${filtered ? 'Clear filters' : 'Show all traces'}</button>`}
        <span class="review-id mono" title="Trace id">${trace.id}</span>
      </p>
      <div class="review-head-tools">
        <${Toggle} on=${showHidden} onClick=${onToggleHidden} kbd="H" title="Show or hide tool calls, look-ups, and instructions">Show behind-the-scenes steps<//>
        <${Toggle} on=${raw} onClick=${onToggleRaw}>View raw data<//>
      </div>
    </div>
    <h1 class="review-title">${trace.title}</h1>
    ${details.length > 0 && html`<ul class="review-details" aria-label="Details">
      ${shown.map(([k, v]) => html`<li class="review-detail" key=${k} title=${`${k}: ${v}`}>
        <span class="review-detail-key">${keyLabel(k)}</span><span class="review-detail-value">${String(v)}</span>
      </li>`)}
      ${details.length > 4 && html`<li><button type="button" class="review-link" aria-expanded=${allDetails ? 'true' : 'false'} onClick=${onAllDetails}>
        ${allDetails ? 'Fewer details' : `${details.length - 4} more`}
      </button></li>`}
    </ul>`}
  </header>`;
}

const RAW_MAX = 100000;

function RawData({ trace }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(trace.raw, null, 2) ?? '';
    } catch {
      return String(trace.raw);
    }
  }, [trace]);
  const cut = text.length > RAW_MAX;
  return html`<section class="review-raw" aria-labelledby="review-raw-title">
    <div class="row-between">
      <h2 class="section-title" id="review-raw-title">Raw data</h2>
      <${CopyButton} text=${text} label="Copy" />
    </div>
    <pre class="review-raw-pre" tabindex="0">${cut ? text.slice(0, RAW_MAX) : text}</pre>
    ${cut && html`<p class="hint">Showing the first ${formatCount(RAW_MAX)} characters.</p>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// The view

function menuOpen(active) {
  if (active && active.closest('[popover]')) return true;
  try {
    return !!document.querySelector('.menu:popover-open');
  } catch {
    return false;
  }
}

function firstToReview(project, ids, batchIds) {
  const todo = (id) => !project.reviews?.[id]?.verdict;
  return batchIds.find(todo) || ids.find(todo) || ids[0] || (project.traces?.[0] ? String(project.traces[0].id) : null);
}

function Workbench({ project, param }) {
  const filters = useStore((s) => s.ui.filters);
  const uiShowHidden = useStore((s) => s.ui.showHidden);
  const focusStep = useStore((s) => s.ui.focusStep);
  const narrow = useMedia('(max-width: 899px)');
  const [cap, setCap] = useState(CAP_STEP);
  const [filterOpen, setFilterOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const [allDetails, setAllDetails] = useState(false);
  const rootRef = useRef(null);
  const centerRef = useRef(null);
  const lastIndex = useRef({ filters: null, i: 0 });

  const exp = project.experience || {};
  const who = lib.userWord(exp);
  const norm = lib.normalizeAll(project);
  const stats = useMemo(() => lib.reviewStats(project), [project.reviews, project.traces]);
  const { gate } = gates(project);
  const gateOpen = stats.reviewed >= gate;

  const batchIds = useMemo(() => {
    const seen = new Set();
    for (const it of project.batch?.items || EMPTY) {
      const id = String(it.traceId);
      if (norm.has(id)) seen.add(id);
    }
    return [...seen];
  }, [project.batch, norm]);
  const batchLeft = useMemo(() => batchIds.filter((id) => !project.reviews?.[id]?.verdict).length, [batchIds, project.reviews]);

  // The list shows the current set until the reader filters or picks "All traces".
  const wanted = filters.scope === 'set' || filters.scope === 'all' ? filters.scope
    : (batchIds.length && batchLeft > 0 && isPlain(filters) ? 'set' : 'all');
  const scope = wanted === 'set' && batchIds.length ? 'set' : 'all';
  useEffect(() => {
    if (filters.scope !== 'set' && filters.scope !== 'all') setUi({ filters: { ...filters, scope } });
  }, [filters]);

  const base = useMemo(() => lib.filterTraces(project, filters),
    [project.traces, project.experience, project.reviews, project.modes, project.labels, project.suggestions, filters]);
  const ids = useMemo(() => {
    if (scope !== 'set') return base;
    const keep = new Set(base);
    return batchIds.filter((id) => keep.has(id));
  }, [base, batchIds, scope]);

  useEffect(() => setCap(CAP_STEP), [filters]);

  const queue = useMemo(() => lib.recheckQueue(project), [project.reviews, project.modes, project.labels, project.traces]);
  const counts = useMemo(() => ({
    all: stats.total,
    todo: Math.max(0, stats.total - stats.pass - stats.fail - stats.skip),
    pass: stats.pass,
    fail: stats.fail,
    skip: stats.skip,
    suggested: lib.filterTraces(project, { status: 'suggested' }).length,
    recheck: queue.length,
    needsNote: stats.needsNote,
  }), [stats, queue, project.suggestions, project.traces]);

  const flaggedIds = useMemo(() => {
    if (!gateOpen) return null;
    const set = new Set();
    for (const s of project.suggestions || EMPTY) {
      if (s?.status === 'open' && (s.kind === 'flag' || s.kind === 'assign') && s.traceId) set.add(String(s.traceId));
    }
    return set;
  }, [project.suggestions, gateOpen]);

  const currentId = param != null && norm.has(String(param)) ? String(param) : null;
  const trace = currentId ? norm.get(currentId) : null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index >= 0) lastIndex.current = { filters, i: index };
  const effectiveCap = index >= cap ? Math.ceil((index + 1) / CAP_STEP) * CAP_STEP : cap;

  // No trace in the address: open the first one to review.
  useEffect(() => {
    if (param != null && param !== '') return;
    const id = firstToReview(project, ids, batchIds);
    if (id) navigate('review', id, { replace: true });
  }, [param]);

  // Keep the rail and panel below the sticky top bar.
  useLayoutEffect(() => {
    const bar = document.querySelector('.topbar');
    const root = rootRef.current;
    if (!bar || !root) return undefined;
    const sync = () => root.style.setProperty('--review-top', bar.offsetHeight + 'px');
    sync();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    if (ro) ro.observe(bar);
    return () => {
      if (ro) ro.disconnect();
    };
  }, []);

  // A new trace starts at the top.
  useLayoutEffect(() => {
    if (!currentId) return;
    const root = rootRef.current;
    const panel = root && root.querySelector('.review-judge-scroll');
    if (panel) panel.scrollTop = 0;
    if (scrollY > 0) scrollTo(0, 0);
  }, [currentId]);

  // Another tab asked for one step of this trace (a policy violation, for example): scroll to it.
  useEffect(() => {
    if (!focusStep || focusStep.traceId !== currentId) return undefined;
    const t = setTimeout(() => {
      const root = rootRef.current;
      const el = root && root.querySelector(`[data-step-id="${CSS.escape(focusStep.stepId)}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      setUi({ focusStep: null });
    }, 80);
    return () => clearTimeout(t);
  }, [focusStep, currentId]);

  const viewId = trace ? lib.viewFor(trace, exp) : 'auto';
  const showHidden = uiShowHidden ?? showHiddenFor(exp, viewId);
  const toggleHidden = () => setUi({ showHidden: !showHidden });

  const go = (dir, via) => {
    let target = null;
    if (index >= 0) target = ids[index + dir] ?? null;
    else if (ids.length) {
      const j = lastIndex.current.filters === filters ? Math.min(lastIndex.current.i, ids.length) : 0;
      target = dir > 0 ? ids[j] ?? null : (j > 0 ? ids[j - 1] : null);
    }
    if (!target && dir > 0 && via === 'next') {
      // At the end: go back to the first trace in this list still waiting for a verdict.
      target = ids.find((id) => id !== currentId && !project.reviews?.[id]?.verdict) || null;
    }
    if (!target) {
      const pool = Math.max(0, stats.total - stats.pass - stats.fail - stats.skip);
      if (dir < 0) toast('This is the first trace in this list.');
      else if (scope === 'set' && batchLeft) toast('That was the last trace in this set.');
      else if (scope === 'set' && pool) {
        const n = Math.min(20, pool);
        toast('Set done.', { action: { label: n === 20 ? 'Pick 20 more' : `Pick the last ${n}`, onClick: () => pickSet('mix') } });
      } else if (!pool) toast('Every trace has a verdict.');
      else toast('That was the last trace in this list.');
      return false;
    }
    navigate('review', target);
    return true;
  };

  // Opening a trace moves focus to it, so the number keys work right away.
  const onOpen = (id) => {
    navigate('review', id);
    if (narrow) setListOpen(false);
    if (centerRef.current) centerRef.current.focus({ preventScroll: true });
  };

  useKeys({
    j: () => {
      go(1, 'key');
    },
    k: () => {
      go(-1, 'key');
    },
    h: toggleHidden,
    Escape: () => {
      const a = document.activeElement;
      if (menuOpen(a)) return false; // an open menu closes itself on Escape
      if (filterOpen) {
        setFilterOpen(false);
        return undefined;
      }
      if (a && rootRef.current && rootRef.current.contains(a) && a !== centerRef.current) {
        centerRef.current.focus({ preventScroll: true });
        return undefined;
      }
      return false;
    },
  }, { active: !!trace });

  const review = currentId ? project.reviews?.[currentId] : null;
  const suggestions = useMemo(() => (trace && gateOpen ? traceFlags(project, currentId) : EMPTY), [trace, gateOpen, project.suggestions, project.modes]);
  const highlights = useMemo(() => suggestionHighlights(suggestions, trace), [suggestions, trace]);
  const badges = useMemo(() => toolCallBadges(project, trace), [project.checks, project.experience, trace]);
  const hasBadges = Object.keys(badges).length > 0;

  const onPickStep = (stepId, stageId) => {
    if (!currentId) return;
    changeTrace(currentId, (p) => {
      const r = p.reviews?.[currentId];
      if (r?.step === stepId) return lib.setStep(p, currentId, null);
      let q = lib.setStep(p, currentId, stepId, stageId && lib.isStageId(p.experience, stageId) ? stageId : null);
      if (!r?.verdict) q = lib.setVerdict(q, currentId, 'fail');
      return q;
    }, 'step');
  };
  const onRetrieval = (next) => {
    if (currentId) changeTrace(currentId, (p) => lib.setRetrieval(p, currentId, next), 'retrieval');
  };

  const railProps = {
    project, stats, filters, counts, ids, currentId, scope, batchIds, batchLeft, flaggedIds,
    cap: effectiveCap, onShowMore: () => setCap(effectiveCap + CAP_STEP), onOpen,
    filterOpen, onToggleFilter: () => setFilterOpen(!filterOpen),
  };

  const position = index >= 0 ? `${formatCount(index + 1)} of ${formatCount(ids.length)}` : 'Not in the list';

  return html`<section class="review" ref=${rootRef}>
    <div class="review-grid">
      ${!narrow && html`<aside class="review-rail review-scroll" aria-label="Progress and trace list">
        <${ReviewRail} ...${railProps} />
      </aside>`}

      <div class="review-center" ref=${centerRef} tabindex="-1">
        <div class="review-center-inner">
          ${narrow && html`<div class="review-mobilebar">
            <${Button} kind="secondary" size="sm" icon="list" onClick=${() => setListOpen(true)}>Traces<//>
            <span class="review-mobilebar-pos num">${position}</span>
            <${Button} kind="secondary" size="sm" icon="arrow-left" title="Previous trace" onClick=${() => go(-1, 'button')} />
            <${Button} kind="secondary" size="sm" icon="arrow-right" title="Next trace" onClick=${() => go(1, 'button')} />
          </div>`}
          <${GuessedBanner} project=${project} />
          ${trace && !LISTS_FIELDS.has(viewId) && !String(viewId).startsWith('custom:') && !showsText(trace) && html`<${NoTextBanner} who=${who} />`}
          <${RecheckBanner} project=${project} queue=${queue} filters=${filters} />
          <${IntroStrip} key=${project.id} project=${project} stats=${stats} who=${who} />
          ${trace
            ? html`
              <${TraceHeader} trace=${trace} exp=${exp} index=${index} count=${ids.length} scope=${scope} filtered=${activeCount(filters) > 0}
                showHidden=${showHidden} onToggleHidden=${toggleHidden} raw=${raw} onToggleRaw=${() => setRaw(!raw)}
                allDetails=${allDetails} onAllDetails=${() => setAllDetails(!allDetails)} />
              ${raw && html`<${RawData} trace=${trace} />`}
              ${(trace.context || EMPTY).length > 0 && html`<${ContextPanel} context=${trace.context} />`}
              <div class="review-trace">
                <${TraceView} trace=${trace} experience=${exp} showHidden=${showHidden}
                  pickedStepId=${review?.step || null} onPickStep=${onPickStep}
                  highlights=${highlights} stepBadges=${hasBadges ? badges : undefined}
                  retrieval=${review?.retrieval || null} onRetrieval=${onRetrieval} />
              </div>`
            : param
              ? html`<${EmptyState} icon="search" title="This trace is not in the project"
                  body=${`There is no trace called "${param}" here. It may have been removed, or the link has a typo.`}
                  action=${{ label: 'Go to the first trace to review', onClick: () => navigate('review', firstToReview(project, ids, batchIds)) }} />`
              : html`<p class="review-loading" role="status">Opening the first trace...</p>`}
        </div>
      </div>

      ${trace && html`<aside class="review-judge" aria-label="Your judgment">
        <${JudgmentPanel} key=${currentId} project=${project} traceId=${currentId} trace=${trace}
          showHidden=${showHidden} onShowHidden=${() => setUi({ showHidden: true })} onGo=${go}
          hasPrev=${index > 0 || (index < 0 && ids.length > 0)} hasNext=${index < 0 ? ids.length > 0 : index < ids.length - 1} />
      </aside>`}
    </div>

    ${narrow && html`<${Drawer} open=${listOpen} side="left" title="Traces" class="review-list-drawer" onClose=${() => setListOpen(false)}>
      <div class="review-drawer-rail review-scroll">
        <${ReviewRail} ...${railProps} />
      </div>
    <//>`}
  </section>`;
}

/** Review traces. */
export default function ReviewView({ param }) {
  const project = useStore((s) => s.project);
  if (!project) return null;
  if (!(project.traces || EMPTY).length) {
    const who = lib.userWord(project.experience);
    return html`<section class="page review-empty">
      <${EmptyState} icon="upload" title="No traces to review yet"
        body=${`Add a file of traces in Set up. Each trace is one full conversation or task, with every step the AI took and what the ${who} saw.`}
        action=${{ label: 'Next: Set up', onClick: () => navigate('setup') }} />
    </section>`;
  }
  return html`<${Workbench} project=${project} param=${param} />`;
}
