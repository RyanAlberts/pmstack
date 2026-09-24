// modes.mjs: failure modes, success modes, and the "Not a product problem"
// bucket. Add, edit, delete, merge, count, and rank what to fix first.

import { slugId } from './schema.mjs';
import { isStageId, stageIndex } from './experience.mjs';
import { failStage, modeMap, orderedReviews, reviewKind } from './review.mjs';

const EMPTY = Object.freeze([]);
const stamp = (opts) => opts?.now || new Date().toISOString();

/** Severity choices for failure modes ({userLabel} is replaced by the view). */
export const SEVERITIES = [
  { id: 'blocks', label: 'Blocks the {userLabel}', short: 'Blocks', weight: 3 },
  { id: 'hurts', label: 'Hurts the {userLabel} or the business', short: 'Hurts', weight: 2 },
  { id: 'annoys', label: 'Annoys the {userLabel}', short: 'Annoys', weight: 1 },
];

/** Decisions per failure mode, with the next step the report shows. */
export const DECISIONS = [
  { id: 'fix', label: 'Fix it now', next: 'Add the instruction, then replay the regression set' },
  { id: 'check', label: 'Build a check', next: 'Build or finish the check' },
  { id: 'watch', label: 'Keep watching', next: 'Recheck after the next 100 traces' },
];

/** Answers to "Did the AI's instructions ask for this?". */
export const INSTRUCTED = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'unsure', label: 'Not sure' },
];

const WEIGHT = { blocks: 3, hurts: 2, annoys: 1 };
const PREFIX = { failure: 'fm', success: 'sm', ignore: 'nm' };
const DEFAULT_NAME = { failure: 'New failure mode', success: 'New success mode', ignore: 'Not a product problem' };

/** The suggested decision from the instructions answer: 'fix' when No, 'check' when Yes, else null. */
export function suggestedDecision(mode) {
  if (mode?.instructed === 'no') return 'fix';
  if (mode?.instructed === 'yes') return 'check';
  return null;
}

/** Add a mode; returns { project, id }. */
export function addMode(p, { kind = 'failure', name = '', definition = '', stage = null, severity = null, instructed = null, decision = null, impact = '', source = 'human' } = {}, opts = {}) {
  const t = stamp(opts);
  const k = PREFIX[kind] ? kind : 'failure';
  const clean = String(name ?? '').trim() || DEFAULT_NAME[k];
  const id = slugId(PREFIX[k], clean, (p.modes || EMPTY).map((m) => m.id));
  const st = isStageId(p.experience, stage) ? stage : null;
  const mode = k === 'failure'
    ? { id, kind: k, name: clean, definition, stage: st, severity, instructed, decision, impact, createdAt: t, definitionUpdatedAt: null, fixedAt: null, source }
    : { id, kind: k, name: clean, definition, stage: st, createdAt: t, source };
  return { project: { ...p, modes: [...(p.modes || EMPTY), mode], updatedAt: t }, id };
}

/** Edit a mode's fields; a changed definition sets definitionUpdatedAt. Ids and kinds never change. */
export function updateMode(p, id, patch = {}, opts = {}) {
  const modes = p.modes || EMPTY;
  const i = modes.findIndex((m) => m.id === id);
  if (i < 0) return p;
  const m = modes[i];
  const { id: _id, kind: _kind, createdAt: _created, ...rest } = patch;
  if (Object.keys(rest).every((k) => m[k] === rest[k])) return p;
  const t = stamp(opts);
  const next = { ...m, ...rest };
  if ('definition' in rest && rest.definition !== m.definition) next.definitionUpdatedAt = t;
  const list = modes.slice();
  list[i] = next;
  return { ...p, modes: list, updatedAt: t };
}

const omit = (obj, key) => {
  if (!obj || !(key in obj)) return obj;
  const { [key]: _drop, ...rest } = obj;
  return rest;
};

// Rewrite only the reviews that mention a mode id.
function mapReviews(reviews, id, fn) {
  let out = null;
  for (const [tid, r] of Object.entries(reviews || {})) {
    if (!r) continue;
    if ((r.modes || EMPTY).includes(id) || (r.successModes || EMPTY).includes(id)) {
      out = out || { ...reviews };
      out[tid] = fn(r);
    }
  }
  return out || reviews;
}

/** Delete a mode and everything tied to it: review tags, labels, critiques, close calls, splits, and its checks. */
export function deleteMode(p, id, opts = {}) {
  if (!(p.modes || EMPTY).some((m) => m.id === id)) return p;
  const t = stamp(opts);
  const drop = (list) => (list || EMPTY).filter((x) => x !== id);
  return {
    ...p,
    modes: p.modes.filter((m) => m.id !== id),
    reviews: mapReviews(p.reviews, id, (r) => ({ ...r, modes: drop(r.modes), successModes: drop(r.successModes) })),
    labels: omit(p.labels, id),
    critiques: omit(p.critiques, id),
    closeCalls: omit(p.closeCalls, id),
    splits: omit(p.splits, id),
    checks: (p.checks || EMPTY).some((c) => c.modeId === id) ? p.checks.filter((c) => c.modeId !== id) : p.checks,
    suggestions: (p.suggestions || EMPTY).some((s) => s.modeId === id && s.status === 'open')
      ? p.suggestions.map((s) => (s.modeId === id && s.status === 'open' ? { ...s, status: 'dismissed' } : s))
      : p.suggestions,
    updatedAt: t,
  };
}

/** Merge dropId into keepId: moves review tags, copies labels and critiques where keep has none, moves checks. */
export function mergeModes(p, keepId, dropId, opts = {}) {
  const mm = modeMap(p);
  if (keepId === dropId || !mm.has(keepId) || !mm.has(dropId)) return p;
  const t = stamp(opts);
  const swap = (list) => {
    const out = [];
    for (const x of list || EMPTY) {
      const y = x === dropId ? keepId : x;
      if (!out.includes(y)) out.push(y);
    }
    return out;
  };
  const mergeMap = (maps) => {
    if (!maps || !maps[dropId]) return omit(maps, dropId);
    return omit({ ...maps, [keepId]: { ...maps[dropId], ...(maps[keepId] || {}) } }, dropId);
  };
  const closeCalls = p.closeCalls?.[dropId]
    ? omit({ ...p.closeCalls, [keepId]: [...new Set([...(p.closeCalls[keepId] || EMPTY), ...p.closeCalls[dropId]])] }, dropId)
    : p.closeCalls;
  return {
    ...p,
    modes: p.modes.filter((m) => m.id !== dropId),
    reviews: mapReviews(p.reviews, dropId, (r) => ({ ...r, modes: swap(r.modes), successModes: swap(r.successModes) })),
    labels: mergeMap(p.labels),
    critiques: mergeMap(p.critiques),
    closeCalls,
    splits: omit(p.splits, dropId),
    checks: (p.checks || EMPTY).some((c) => c.modeId === dropId) ? p.checks.map((c) => (c.modeId === dropId ? { ...c, modeId: keepId } : c)) : p.checks,
    suggestions: (p.suggestions || EMPTY).some((s) => s.modeId === dropId) ? p.suggestions.map((s) => (s.modeId === dropId ? { ...s, modeId: keepId } : s)) : p.suggestions,
    updatedAt: t,
  };
}

const COUNTS = new WeakMap();
/**
 * Traces per mode over counted reviews: Map(modeId -> { traces, traceIds, firstHere }).
 * firstHere counts traces whose first failing stage is the mode's own stage. Ignore modes
 * count every Problem review that carries them.
 */
export function modeCounts(project) {
  const reviews = project?.reviews || {};
  const cached = COUNTS.get(reviews);
  if (cached && cached.modes === project.modes && cached.experience === project.experience && cached.traces === project.traces) return cached.value;
  const out = new Map();
  for (const m of project.modes || EMPTY) out.set(m.id, { traces: 0, traceIds: [], firstHere: 0 });
  const mm = modeMap(project);
  for (const { traceId, review } of orderedReviews(project)) {
    const kind = reviewKind(project, review);
    if (kind === 'fail' || kind === 'ignored') {
      const where = kind === 'fail' ? failStage(project, review) : null;
      for (const id of review.modes || EMPTY) {
        const m = mm.get(id);
        const c = out.get(id);
        if (!m || !c) continue;
        if (m.kind === 'ignore' || (m.kind === 'failure' && kind === 'fail')) {
          c.traces++; c.traceIds.push(traceId);
          if (m.kind === 'ignore' || where === (m.stage || 'unknown')) c.firstHere++;
        }
      }
    }
    if (kind === 'pass' || kind === 'fail') {
      for (const id of review.successModes || EMPTY) {
        const c = out.get(id);
        if (c && mm.get(id)?.kind === 'success') { c.traces++; c.traceIds.push(traceId); c.firstHere++; }
      }
    }
  }
  COUNTS.set(reviews, { modes: project.modes, experience: project.experience, traces: project.traces, value: out });
  return out;
}

/** Counted reviews: Good plus Problem reviews not made only of "Not a product problem" modes. */
export function countedTotal(project) {
  let n = 0;
  for (const { review } of orderedReviews(project)) {
    const k = reviewKind(project, review);
    if (k === 'pass' || k === 'fail') n++;
  }
  return n;
}

/** Notes waiting to be grouped: Problem notes with no failure mode, or Good notes with no success mode. */
export function unassignedNotes(project, kind = 'failure') {
  const mm = modeMap(project);
  const out = [];
  for (const { traceId, review } of orderedReviews(project)) {
    if (kind === 'success') {
      if (review.verdict !== 'pass') continue;
      const good = String(review.good || '').trim();
      if (!good || (review.successModes || EMPTY).some((id) => mm.get(id)?.kind === 'success')) continue;
      out.push({ traceId, note: good, hasNote: true, stage: review.stage ?? null });
    } else {
      if (review.verdict !== 'fail') continue;
      if ((review.modes || EMPTY).some((id) => { const k = mm.get(id)?.kind; return k === 'failure' || k === 'ignore'; })) continue;
      const note = String(review.note || '').trim();
      out.push({ traceId, note: note || '(no note yet)', hasNote: !!note, stage: review.stage ?? null });
    }
  }
  return out;
}

/**
 * What to fix first: failure modes ranked by traces x severity weight (Blocks 3, Hurts 2,
 * Annoys 1; unset counts as 1), then earlier stage, then more traces.
 */
export function priorityTable(project) {
  const counts = modeCounts(project);
  const counted = countedTotal(project);
  const checksBy = new Map();
  for (const c of project.checks || EMPTY) {
    if (!checksBy.has(c.modeId)) checksBy.set(c.modeId, []);
    checksBy.get(c.modeId).push({ id: c.id, type: c.type });
  }
  const rows = (project.modes || EMPTY).filter((m) => m.kind === 'failure').map((mode) => {
    const traces = counts.get(mode.id)?.traces || 0;
    const weight = WEIGHT[mode.severity] || 1;
    return { mode, traces, share: counted ? traces / counted : null, weight, priority: traces * weight, stageIndex: stageIndex(project.experience, mode.stage), checks: checksBy.get(mode.id) || [] };
  });
  const byNum = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  rows.sort((a, b) => byNum(b.priority, a.priority) || byNum(a.stageIndex, b.stageIndex) || byNum(b.traces, a.traces)
    || (a.mode.name < b.mode.name ? -1 : a.mode.name > b.mode.name ? 1 : 0));
  return rows;
}
