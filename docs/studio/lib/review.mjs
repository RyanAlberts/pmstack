// review.mjs: the reviewer's verdicts, notes, and stages; review stats; the
// discovery curve and saturation hint; the re-check queue; trace filters.
// Mutators copy only the changed path and set updatedAt.

import { isStageId, stageIndex } from './experience.mjs';
import { normalizeAll, searchIndex, tracePositions } from './traces.mjs';

const VERDICTS = new Set(['pass', 'fail', 'skip']);
const EMPTY = Object.freeze([]);
const stamp = (opts) => opts?.now || new Date().toISOString();

/** Milliseconds for an ISO time; -Infinity when missing or unreadable. */
export function ms(iso) {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
}

/** An empty review record. */
export function blankReview() {
  return { verdict: null, note: '', stage: null, step: null, good: '', modes: [], successModes: [], retrieval: null, reviewedAt: null, at: null };
}

const MODE_MAPS = new WeakMap();
/** Map of mode id -> mode (memoized on project.modes). */
export function modeMap(project) {
  const modes = project?.modes || EMPTY;
  let m = MODE_MAPS.get(modes);
  if (!m) { m = new Map(modes.map((x) => [x.id, x])); MODE_MAPS.set(modes, m); }
  return m;
}

/**
 * How a review counts: 'pass', 'fail' (counted Problem), 'ignored' (Problem made only of
 * "Not a product problem" modes), 'skip', or null (no verdict).
 */
export function reviewKind(project, review) {
  if (!review) return null;
  if (review.verdict === 'pass') return 'pass';
  if (review.verdict === 'skip') return 'skip';
  if (review.verdict !== 'fail') return null;
  const mm = modeMap(project);
  let any = false;
  for (const id of review.modes || EMPTY) {
    const m = mm.get(id);
    if (!m) continue;
    any = true;
    if (m.kind !== 'ignore') return 'fail';
  }
  return any ? 'ignored' : 'fail';
}

/** The stage where a Problem trace first went wrong: its own stage, else the earliest stage of its failure modes, else 'unknown'. */
export function failStage(project, review) {
  const exp = project?.experience;
  if (review?.stage && isStageId(exp, review.stage)) return review.stage;
  const mm = modeMap(project);
  let best = null, bestIdx = Infinity;
  for (const id of review?.modes || EMPTY) {
    const m = mm.get(id);
    if (!m || m.kind !== 'failure' || !m.stage) continue;
    const i = stageIndex(exp, m.stage);
    if (i < bestIdx) { bestIdx = i; best = m.stage; }
  }
  return best ?? 'unknown';
}

// Write one review with structural sharing; returns p unchanged when nothing changes.
function patchReview(p, traceId, patch, opts) {
  const r = p.reviews?.[traceId];
  if (r && Object.keys(patch).every((k) => r[k] === patch[k])) return p;
  const t = stamp(opts);
  const next = { ...(r || blankReview()), ...patch, at: t };
  return { ...p, reviews: { ...p.reviews, [traceId]: next }, updatedAt: t };
}

/** Review counts: reviewed = Good + Problem; needsNote = Problem with an empty note. */
export function reviewStats(project) {
  let pass = 0, fail = 0, skip = 0, needsNote = 0;
  for (const r of Object.values(project?.reviews || {})) {
    if (!r) continue;
    if (r.verdict === 'pass') pass++;
    else if (r.verdict === 'fail') { fail++; if (!String(r.note || '').trim()) needsNote++; }
    else if (r.verdict === 'skip') skip++;
  }
  const total = project?.traces?.length || 0;
  return { total, reviewed: pass + fail, pass, fail, skip, unreviewed: Math.max(0, total - pass - fail - skip), needsNote };
}

/** Set the verdict ('pass' | 'fail' | 'skip' | null); the first non-null verdict sets reviewedAt. */
export function setVerdict(p, traceId, verdict, opts = {}) {
  const v = VERDICTS.has(verdict) ? verdict : null;
  const r = p.reviews?.[traceId];
  if ((r?.verdict ?? null) === v && (r || v === null)) return p;
  const t = stamp(opts);
  return patchReview(p, traceId, { verdict: v, reviewedAt: r?.reviewedAt ?? (v ? t : null) }, { now: t });
}

/** Set the note (what went wrong, from the user's side). */
export function setNote(p, traceId, note, opts = {}) {
  const text = String(note ?? '');
  if (!p.reviews?.[traceId] && !text) return p;
  return patchReview(p, traceId, { note: text }, opts);
}

/** Set where it first went wrong: a stage id, 'unknown', or null. */
export function setStage(p, traceId, stageId, opts = {}) {
  if (!p.reviews?.[traceId] && stageId == null) return p;
  return patchReview(p, traceId, { stage: stageId ?? null }, opts);
}

/** Pick the step that first went wrong; a non-null stageId also sets the stage. */
export function setStep(p, traceId, stepId, stageId = null, opts = {}) {
  const patch = { step: stepId ?? null };
  if (stageId != null) patch.stage = stageId;
  if (!p.reviews?.[traceId] && patch.step == null && stageId == null) return p;
  return patchReview(p, traceId, patch, opts);
}

/** Set the "why was this good" note. */
export function setGood(p, traceId, text, opts = {}) {
  const t = String(text ?? '');
  if (!p.reviews?.[traceId] && !t) return p;
  return patchReview(p, traceId, { good: t }, opts);
}

const toggled = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Add or remove a failure mode (or "Not a product problem" mode) on a trace. */
export function toggleMode(p, traceId, modeId, opts = {}) {
  const r = p.reviews?.[traceId] || blankReview();
  return patchReview(p, traceId, { modes: toggled(r.modes || EMPTY, modeId) }, opts);
}

/** Add or remove a success mode on a trace. */
export function toggleSuccessMode(p, traceId, modeId, opts = {}) {
  const r = p.reviews?.[traceId] || blankReview();
  return patchReview(p, traceId, { successModes: toggled(r.successModes || EMPTY, modeId) }, opts);
}

/** Set needed and missing documents for the answer view, or null. */
export function setRetrieval(p, traceId, retrieval, opts = {}) {
  const value = retrieval ? { needed: [...(retrieval.needed || [])], missing: [...(retrieval.missing || [])] } : null;
  if (!p.reviews?.[traceId] && !value) return p;
  return patchReview(p, traceId, { retrieval: value }, opts);
}

/** The current review of a trace (or null), for undo. */
export function reviewSnapshot(p, traceId) {
  return p.reviews?.[traceId] ?? null;
}

/** Put back a review saved with reviewSnapshot (null removes the review). */
export function restoreReview(p, traceId, snapshot, opts = {}) {
  const cur = p.reviews?.[traceId] ?? null;
  if (cur === snapshot) return p;
  const t = stamp(opts);
  const reviews = { ...p.reviews };
  if (snapshot == null) delete reviews[traceId];
  else reviews[traceId] = snapshot;
  return { ...p, reviews, updatedAt: t };
}

const ORDERED = new WeakMap();
/** Good and Problem reviews in the order they were first reviewed (ties by trace position): [{ traceId, review }]. */
export function orderedReviews(project) {
  const reviews = project?.reviews || {};
  const cached = ORDERED.get(reviews);
  if (cached && cached.traces === project.traces) return cached.value;
  const pos = tracePositions(project);
  const rows = [];
  for (const [traceId, review] of Object.entries(reviews)) {
    if (!review || (review.verdict !== 'pass' && review.verdict !== 'fail')) continue;
    rows.push({ traceId, review, t: ms(review.reviewedAt ?? review.at), p: pos.get(traceId) ?? Infinity });
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.p < b.p ? -1 : a.p > b.p ? 1 : a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0));
  const value = rows.map(({ traceId, review }) => ({ traceId, review }));
  ORDERED.set(reviews, { traces: project.traces, value });
  return value;
}

// Position (1-based, in review order) where each failure mode first appears.
function firstAppearance(project) {
  const failure = new Set((project.modes || EMPTY).filter((m) => m.kind === 'failure').map((m) => m.id));
  const first = new Map();
  orderedReviews(project).forEach(({ review }, i) => {
    if (review.verdict !== 'fail') return;
    for (const id of review.modes || EMPTY) if (failure.has(id) && !first.has(id)) first.set(id, i + 1);
  });
  return first;
}

/** Failure modes known after each review: [{ n, modesKnown, newInWindow }]; newInWindow counts the last 10 reviews. */
export function discoveryCurve(project) {
  const n = orderedReviews(project).length;
  const newAt = new Array(n + 2).fill(0);
  for (const pos of firstAppearance(project).values()) newAt[pos]++;
  const out = [];
  let known = 0;
  for (let i = 1; i <= n; i++) {
    known += newAt[i];
    let win = 0;
    for (let j = Math.max(1, i - 9); j <= i; j++) win += newAt[j];
    out.push({ n: i, modesKnown: known, newInWindow: win });
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Whether to keep reviewing: { level: 'early' | 'group' | 'keep' | 'stop', message }. */
export function saturationHint(project) {
  const ordered = orderedReviews(project);
  const failureModes = (project.modes || EMPTY).filter((m) => m.kind === 'failure');
  const early = { level: 'early', message: 'Keep reviewing. Aim for 100 traces, or until new failure modes stop appearing.' };
  if (ordered.length < 10 || !failureModes.length) return early;

  const mm = modeMap(project);
  const grouped = (r) => (r.modes || EMPTY).some((id) => { const k = mm.get(id)?.kind; return k === 'failure' || k === 'ignore'; });
  const fails = ordered.filter((o) => o.review.verdict === 'fail');
  const loose = fails.filter((o) => !grouped(o.review)).length;
  const last = ordered.slice(-20);
  if (loose > 0.2 * fails.length || last.some((o) => o.review.verdict === 'fail' && !grouped(o.review))) {
    return { level: 'group', message: 'Group your latest notes into failure modes first, then check whether new ones are still appearing.' };
  }

  const start = ordered.length - last.length + 1;
  const fresh = new Set();
  for (const [id, pos] of firstAppearance(project)) if (pos >= start) fresh.add(id);
  const spanStart = ms(last[0].review.reviewedAt ?? last[0].review.at);
  for (const m of failureModes) {
    if (ms(m.createdAt) >= spanStart || ms(m.definitionUpdatedAt) >= spanStart) fresh.add(m.id);
  }
  if (fresh.size) return { level: 'keep', message: `Keep going: ${plural(fresh.size, 'new failure mode', 'new failure modes')} in your last 20 traces.` };
  if (ordered.length >= 20) return { level: 'stop', message: 'New failure modes have stopped appearing in your last 20 traces. You can move on to checks.' };
  return early;
}

/** Good reviews made before a failure mode existed (or before its definition changed) with no label for it yet. */
export function recheckQueue(project) {
  const failureModes = (project.modes || EMPTY).filter((m) => m.kind === 'failure');
  if (!failureModes.length) return [];
  const since = failureModes.map((m) => ({ id: m.id, t: Math.max(ms(m.createdAt), ms(m.definitionUpdatedAt)) }));
  const out = [];
  for (const { traceId, review } of orderedReviews(project)) {
    if (review.verdict !== 'pass') continue;
    const t = ms(review.reviewedAt ?? review.at);
    const modeIds = since.filter((m) => t < m.t && project.labels?.[m.id]?.[traceId] == null).map((m) => m.id);
    if (modeIds.length) out.push({ traceId, modeIds });
  }
  return out;
}

// Trace ids with an open AI suggestion.
function suggestedIds(project) {
  const ids = new Set();
  for (const s of project.suggestions || EMPTY) {
    if (s?.status !== 'open') continue;
    if ((s.kind === 'assign' || s.kind === 'flag') && s.traceId) ids.add(s.traceId);
    if (s.kind === 'mode') for (const id of s.traceIds || EMPTY) ids.add(id);
  }
  return ids;
}

/**
 * Trace ids matching the filters, in trace order. status: all | todo | pass | fail | skip |
 * suggested | recheck | needsNote. stage filters Problem traces by where they first went wrong.
 */
export function filterTraces(project, { status = 'all', meta = {}, modeId = null, stage = null, text = '', version = null } = {}) {
  const traces = project?.traces || EMPTY;
  const metaEntries = Object.entries(meta || {}).filter(([, v]) => v != null && v !== '');
  const norm = metaEntries.length || version != null ? normalizeAll(project) : null;
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const index = words.length ? searchIndex(project) : null;
  const recheck = status === 'recheck' ? new Set(recheckQueue(project).map((x) => x.traceId)) : null;
  const suggested = status === 'suggested' ? suggestedIds(project) : null;
  const modeKind = modeId ? modeMap(project).get(modeId)?.kind : null;
  const out = [];
  for (const t of traces) {
    const id = String(t.id);
    const r = project.reviews?.[id];
    const v = r?.verdict ?? null;
    switch (status) {
      case 'todo': if (v) continue; break;
      case 'pass': case 'fail': case 'skip': if (v !== status) continue; break;
      case 'needsNote': if (v !== 'fail' || String(r.note || '').trim()) continue; break;
      case 'recheck': if (!recheck.has(id)) continue; break;
      case 'suggested': if (!suggested.has(id)) continue; break;
      default: break;
    }
    if (modeId) {
      if (!r) continue;
      if (modeKind === 'success') { if (!(v === 'pass' || v === 'fail') || !(r.successModes || EMPTY).includes(modeId)) continue; }
      else if (v !== 'fail' || !(r.modes || EMPTY).includes(modeId)) continue;
    }
    if (stage) {
      if (reviewKind(project, r) !== 'fail' || failStage(project, r) !== stage) continue;
    }
    if (norm) {
      const n = norm.get(id);
      if (!n) continue;
      if (version != null && String(n.metadata.version ?? '') !== String(version)) continue;
      if (metaEntries.some(([k, val]) => String(n.metadata[k] ?? '') !== String(val))) continue;
    }
    if (words.length) {
      const hay = index.get(id) || '';
      const notes = r ? `${r.note || ''}\n${r.good || ''}`.toLowerCase() : '';
      if (!words.every((w) => hay.includes(w) || notes.includes(w))) continue;
    }
    out.push(id);
  }
  return out;
}

/** The next (dir 1) or previous (dir -1) trace id in a filtered list; null at the end. */
export function nextTrace(project, fromId, ids, dir = 1) {
  if (!ids || !ids.length) return null;
  const i = ids.indexOf(fromId);
  if (i >= 0) {
    const j = i + (dir < 0 ? -1 : 1);
    return j >= 0 && j < ids.length ? ids[j] : null;
  }
  const pos = tracePositions(project);
  const from = pos.get(fromId) ?? -1;
  if (dir >= 0) return ids.find((id) => (pos.get(id) ?? Infinity) > from) ?? null;
  for (let k = ids.length - 1; k >= 0; k--) if ((pos.get(ids[k]) ?? -1) < from) return ids[k];
  return null;
}
