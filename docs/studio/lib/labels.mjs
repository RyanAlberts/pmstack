// labels.mjs: your yes or no for one failure mode on one trace, critiques and
// close calls for judge examples, and the examples / tuning set / final test
// splits. Split sizes follow the 15% / 45% / 40% guidance in hamelsmu/evals-skills
// (MIT, (c) 2026 Hamel Husain), assigned here with our own stable stratified fill.

import { hashString } from './metrics.mjs';
import { modeMap, ms, blankReview } from './review.mjs';
import { tracePositions } from './traces.mjs';

const EMPTY = Object.freeze([]);
const stamp = (opts) => opts?.now || new Date().toISOString();
const SPLITS = ['examples', 'test', 'tuning']; // tie order when filling

/**
 * Your label for one trace and one failure mode: an explicit label wins; a Problem review
 * carrying the mode is 'fail'; a Good review made after the mode existed (and after its last
 * definition edit) is 'pass'; everything else is null.
 */
export function humanLabel(p, traceId, modeId) {
  const explicit = p.labels?.[modeId]?.[traceId];
  if (explicit === 'pass' || explicit === 'fail') return explicit;
  const r = p.reviews?.[traceId];
  if (!r) return null;
  if (r.verdict === 'fail' && (r.modes || EMPTY).includes(modeId)) return 'fail';
  if (r.verdict === 'pass') {
    const m = modeMap(p).get(modeId);
    if (!m || m.kind !== 'failure') return null;
    const t = ms(r.reviewedAt ?? r.at);
    if (t >= ms(m.createdAt) && t >= ms(m.definitionUpdatedAt)) return 'pass';
  }
  return null;
}

/** True when the trace sits in a final test that was already revealed (its label is read-only). */
export function isLockedLabel(p, modeId, traceId) {
  const s = p.splits?.[modeId];
  return !!(s?.revealedAt && s.assign?.[traceId] === 'test');
}

/** Write a label ('pass' | 'fail' | null) and report refusals: { project, error }. */
export function setLabelResult(p, modeId, traceId, value, opts = {}) {
  if (isLockedLabel(p, modeId, traceId)) {
    return { project: p, error: 'This trace is in the final test, which you already used, so its label stays as it is.' };
  }
  const v = value === 'pass' || value === 'fail' ? value : null;
  const cur = p.labels?.[modeId]?.[traceId] ?? null;
  const hasReview = !!p.reviews?.[traceId];
  if (cur === v && (hasReview || v === null)) return { project: p, error: null };
  const t = stamp(opts);
  const map = { ...(p.labels?.[modeId] || {}) };
  if (v === null) delete map[traceId];
  else map[traceId] = v;
  const next = { ...p, labels: { ...p.labels, [modeId]: map }, updatedAt: t };
  if (!hasReview && v !== null) next.reviews = { ...p.reviews, [traceId]: { ...blankReview(), at: t } };
  return { project: next, error: null };
}

/** Write a label; returns the project (unchanged when refused; see setLabelResult). */
export function setLabel(p, modeId, traceId, value, opts = {}) {
  return setLabelResult(p, modeId, traceId, value, opts).project;
}

/** Set the one-line critique used when this trace is a judge example ('' removes it). */
export function setCritique(p, modeId, traceId, text, opts = {}) {
  const v = String(text ?? '');
  const cur = p.critiques?.[modeId]?.[traceId] ?? '';
  if (cur === v) return p;
  const t = stamp(opts);
  const map = { ...(p.critiques?.[modeId] || {}) };
  if (v) map[traceId] = v;
  else delete map[traceId];
  return { ...p, critiques: { ...p.critiques, [modeId]: map }, updatedAt: t };
}

/** Mark or unmark a trace as a close call for a failure mode. */
export function toggleCloseCall(p, modeId, traceId, opts = {}) {
  const t = stamp(opts);
  const list = p.closeCalls?.[modeId] || EMPTY;
  const next = list.includes(traceId) ? list.filter((x) => x !== traceId) : [...list, traceId];
  return { ...p, closeCalls: { ...p.closeCalls, [modeId]: next }, updatedAt: t };
}

/** Every trace with a non-null label for the mode, in trace order: [{ traceId, label, explicit }]. */
export function labeledSet(p, modeId) {
  const ids = new Set([...Object.keys(p.reviews || {}), ...Object.keys(p.labels?.[modeId] || {})]);
  const pos = tracePositions(p);
  const out = [];
  for (const traceId of ids) {
    const label = humanLabel(p, traceId, modeId);
    if (!label) continue;
    const e = p.labels?.[modeId]?.[traceId];
    out.push({ traceId, label, explicit: e === 'pass' || e === 'fail' });
  }
  out.sort((a, b) => {
    const pa = pos.get(a.traceId) ?? Infinity, pb = pos.get(b.traceId) ?? Infinity;
    return pa < pb ? -1 : pa > pb ? 1 : a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0;
  });
  return out;
}

/** Split targets for a label group of n traces: { examples, test, tuning }. */
export function splitTargets(n) {
  const examples = n >= 3 ? Math.max(1, Math.round(0.15 * n)) : 0;
  const test = Math.round(0.4 * n);
  return { examples, test, tuning: n - examples - test };
}

/** True when splits can still be redrawn: no final test revealed and no judge results for the mode. */
export function canReshuffle(p, modeId) {
  if (p.splits?.[modeId]?.revealedAt) return false;
  return !(p.checks || EMPTY).some((c) => c.modeId === modeId && c.type === 'judge' && c.results && Object.keys(c.results).length);
}

/**
 * Place labeled traces in examples / tuning / final test, per label, stratified and stable:
 * existing assignments stay; new traces fill the split furthest below its target. After the
 * final test is revealed, new traces join tuning (and are remembered in afterReveal).
 */
export function assignSplits(p, modeId, { seed, reshuffle = false } = {}, opts = {}) {
  const cur = p.splits?.[modeId];
  if (reshuffle && !canReshuffle(p, modeId)) return p;
  const s = cur?.seed ?? seed ?? p.settings?.seed ?? 7;
  // A reshuffle without a new seed moves to the next one, so the draw actually changes.
  const useSeed = reshuffle ? (seed ?? (Number(s) || 0) + 1) : s;
  const revealedAt = cur?.revealedAt ?? null;
  const assign = reshuffle ? {} : { ...(cur?.assign || {}) };
  const afterReveal = [...(cur?.afterReveal || EMPTY)];
  let changed = !cur || reshuffle;

  const groups = { pass: [], fail: [] };
  for (const row of labeledSet(p, modeId)) groups[row.label].push(row.traceId);
  for (const label of ['fail', 'pass']) {
    const ids = groups[label];
    const target = splitTargets(ids.length);
    const have = { examples: 0, test: 0, tuning: 0 };
    const todo = [];
    for (const id of ids) {
      if (assign[id]) have[assign[id]] = (have[assign[id]] || 0) + 1;
      else todo.push(id);
    }
    const keyed = todo.map((id) => ({ id, k: hashString(`${useSeed}:${id}`) }));
    keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    for (const { id } of keyed) {
      let pick = 'tuning';
      if (!revealedAt) {
        let best = -Infinity;
        for (const name of SPLITS) {
          const gap = target[name] - have[name];
          if (gap > best) { best = gap; pick = name; }
        }
      } else afterReveal.push(id);
      assign[id] = pick;
      have[pick]++;
      changed = true;
    }
  }
  if (!changed) return p;
  const t = stamp(opts);
  const entry = { seed: useSeed, assign, revealedAt };
  if (afterReveal.length) entry.afterReveal = afterReveal;
  return { ...p, splits: { ...p.splits, [modeId]: entry }, updatedAt: t };
}

/** The split of a trace for a mode: 'examples' | 'tuning' | 'test' | null. */
export function splitOf(p, modeId, traceId) {
  return p.splits?.[modeId]?.assign?.[traceId] ?? null;
}

/** Labeled traces per split and label: { examples: { pass, fail }, tuning: {...}, test: {...} }. */
export function splitCounts(p, modeId) {
  const out = { examples: { pass: 0, fail: 0 }, tuning: { pass: 0, fail: 0 }, test: { pass: 0, fail: 0 } };
  for (const { traceId, label } of labeledSet(p, modeId)) {
    const s = splitOf(p, modeId, traceId);
    if (s && out[s]) out[s][label]++;
  }
  return out;
}

/** Hash of the final-test labels (sorted), used to spot label edits after the reveal. */
export function labelsHash(p, modeId) {
  const lines = [];
  for (const { traceId, label } of labeledSet(p, modeId)) if (splitOf(p, modeId, traceId) === 'test') lines.push(`${traceId}=${label}`);
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hashString(lines.join('\n'));
}

/** Labels added after the final test was revealed (candidates for a fresh final test). */
export function labelsSinceReveal(p, modeId) {
  const after = p.splits?.[modeId]?.afterReveal || EMPTY;
  return after.filter((id) => humanLabel(p, id, modeId) != null);
}

/**
 * Start a fresh final test from labels added after the reveal (needs 30 or more): the old
 * final test joins tuning, 40% of the new labels per label become the new final test, and
 * every judge check of the mode loses its final-test record.
 */
export function startFreshTest(p, modeId, opts = {}) {
  const cur = p.splits?.[modeId];
  const fresh = labelsSinceReveal(p, modeId);
  if (!cur?.revealedAt || fresh.length < 30) return p;
  const t = stamp(opts);
  const assign = {};
  for (const [id, split] of Object.entries(cur.assign || {})) assign[id] = split === 'test' ? 'tuning' : split;
  const groups = { pass: [], fail: [] };
  for (const id of fresh) groups[humanLabel(p, id, modeId)].push(id);
  for (const ids of Object.values(groups)) {
    const keyed = ids.map((id) => ({ id, k: hashString(`${cur.seed ?? 7}:fresh:${id}`) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    const n = Math.round(0.4 * ids.length);
    keyed.forEach(({ id }, i) => { assign[id] = i < n ? 'test' : 'tuning'; });
  }
  const checks = (p.checks || EMPTY).some((c) => c.modeId === modeId && c.test)
    ? p.checks.map((c) => (c.modeId === modeId && c.test ? { ...c, test: null } : c))
    : p.checks;
  return { ...p, splits: { ...p.splits, [modeId]: { seed: cur.seed, assign, revealedAt: null } }, checks, updatedAt: t };
}
