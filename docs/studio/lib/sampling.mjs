// sampling.mjs: pick the next set of traces to review. Every strategy other
// than random keeps at least 30% random picks, so the set never only shows
// what you were already looking for. Deterministic for a seed.

import { rng } from './metrics.mjs';
import { normalizeAll } from './traces.mjs';
import { runChecks } from './checks.mjs';
import { humanLabel } from './labels.mjs';

const EMPTY = Object.freeze([]);
const stamp = (opts) => opts?.now || new Date().toISOString();
const RANDOM = 'Random pick';

/** Strategy ids with their menu labels. */
export const STRATEGIES = [
  { id: 'mix', label: 'Mix' },
  { id: 'random', label: 'Random' },
  { id: 'outliers', label: 'Unusual ones' },
  { id: 'signal', label: 'Has a specific detail' },
  { id: 'flagged', label: 'Flagged by a check', hint: 'Use with care: finds what your checks already know' },
  { id: 'disagree', label: 'Judge disagrees with you' },
];

function shuffle(list, next) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Customer-visible text length, steps, tool calls, and error steps of a normalized trace.
function features(n) {
  let len = 0, calls = 0, errors = 0;
  for (const s of n.steps) {
    if (s.customerVisible) len += s.text.length;
    if (s.kind === 'tool_call' || s.kind === 'tool') calls++;
    if (s.status === 'error') errors++;
  }
  if (n.input) len += n.input.length;
  return { len, steps: n.steps.length, calls, errors, chat: n.steps.some((s) => s.kind === 'user') };
}

// Take up to `count` ids from ordered candidate lists, round robin, skipping ids already taken.
function roundRobin(lists, count, taken) {
  const out = [];
  const cursors = lists.map(() => 0);
  let progress = true;
  while (out.length < count && progress) {
    progress = false;
    lists.forEach((l, i) => {
      if (out.length >= count) return;
      while (cursors[i] < l.items.length && taken.has(l.items[cursors[i]])) cursors[i]++;
      if (cursors[i] < l.items.length) {
        const id = l.items[cursors[i]++];
        taken.add(id);
        out.push({ traceId: id, reason: l.reason(id) });
        progress = true;
      }
    });
  }
  return out;
}

/**
 * The next set of traces to review, over traces with no review or no verdict yet:
 * [{ traceId, reason }]. strategy: mix | random | outliers | signal | flagged | disagree.
 */
export function nextBatch(p, { size = 20, strategy = 'mix', signal = null, seed } = {}) {
  const norm = normalizeAll(p);
  const pool = [];
  for (const id of norm.keys()) if (!p.reviews?.[id]?.verdict) pool.push(id);
  const next = rng(seed ?? p.settings?.seed ?? 7);
  const randomOrder = shuffle(pool, next);
  const want = Math.min(size, pool.length);
  const takeRandom = (n, taken) => {
    const out = [];
    for (const id of randomOrder) {
      if (out.length >= n) break;
      if (!taken.has(id)) { taken.add(id); out.push({ traceId: id, reason: RANDOM }); }
    }
    return out;
  };
  const effective = strategy === 'mix' && pool.length < 50 ? 'random' : strategy;
  if (effective === 'random') return takeRandom(want, new Set());

  const floor = Math.ceil(0.3 * want);
  const lists = candidateLists(p, effective, pool, norm, next, signal);
  const taken = new Set();
  const picked = roundRobin(lists, want - floor, taken);
  const rest = takeRandom(want - picked.length, taken);
  return shuffle([...picked, ...rest], next);
}

function candidateLists(p, strategy, pool, norm, next, signal) {
  if (strategy === 'mix') {
    const keys = (p.experience?.filters || EMPTY).slice(0, 3);
    const feats = new Map(pool.map((id) => [id, features(norm.get(id))]));
    const lens = pool.map((id) => feats.get(id).len).sort((a, b) => a - b);
    const t1 = lens[Math.floor(lens.length / 3)] ?? 0;
    const t2 = lens[Math.floor((2 * lens.length) / 3)] ?? 0;
    const size = (id) => {
      const f = feats.get(id);
      const word = f.chat ? 'conversation' : 'trace';
      return f.len <= t1 ? `short ${word}` : f.len <= t2 ? `medium ${word}` : `long ${word}`;
    };
    const detailOf = (id) => keys.map((k) => norm.get(id)?.metadata[k]).filter((v) => v != null && v !== '').map(String).join(', ');
    // Detail values with the fewest reviews come first, so thin parts of the data get covered.
    const reviewedBy = new Map();
    for (const [id, r] of Object.entries(p.reviews || {})) {
      if ((r?.verdict !== 'pass' && r?.verdict !== 'fail') || !norm.has(id)) continue;
      const d = detailOf(id);
      reviewedBy.set(d, (reviewedBy.get(d) || 0) + 1);
    }
    const strata = new Map();
    for (const id of shuffle(pool, next)) {
      const detail = detailOf(id);
      const reason = detail ? `${detail}, ${size(id)}` : size(id);
      if (!strata.has(reason)) strata.set(reason, { detail, items: [] });
      strata.get(reason).items.push(id);
    }
    return [...strata.entries()]
      .sort((a, b) => (reviewedBy.get(a[1].detail) || 0) - (reviewedBy.get(b[1].detail) || 0) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([reason, { items }]) => ({ items, reason: () => reason }));
  }
  if (strategy === 'outliers') {
    const feats = pool.map((id) => ({ id, ...features(norm.get(id)) }));
    const tenth = Math.max(1, Math.ceil(feats.length / 10));
    const top = (key, dir, list = feats) => list.slice().sort((a, b) => dir * (b[key] - a[key]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, tenth).map((f) => f.id);
    const word = feats.filter((f) => f.chat).length >= feats.length / 2 ? 'conversations' : 'traces';
    return [
      { items: top('len', 1), reason: () => `Longest 10% of ${word}` },
      { items: top('len', -1), reason: () => `Shortest 10% of ${word}` },
      { items: top('steps', 1), reason: () => 'Most steps (top 10%)' },
      { items: top('calls', 1, feats.filter((f) => f.calls > 0)), reason: () => 'Most tool calls (top 10%)' },
      { items: feats.filter((f) => f.errors > 0).map((f) => f.id), reason: () => 'Has a step that failed' },
    ];
  }
  if (strategy === 'signal' && signal?.key) {
    const items = pool.filter((id) => String(norm.get(id).metadata[signal.key] ?? '') === String(signal.value ?? ''));
    return [{ items: shuffle(items, next), reason: () => `Has ${signal.key} = ${signal.value}` }];
  }
  if (strategy === 'flagged') {
    const run = runChecks(p, { traceIds: pool });
    const flagged = new Set();
    for (const verdicts of Object.values(run.byCheck)) for (const [id, v] of Object.entries(verdicts)) if (v === 'fail') flagged.add(id);
    for (const c of p.checks || EMPTY) if (c.type === 'judge') for (const id of pool) if (c.results?.[id]?.verdict === 'fail') flagged.add(id);
    return [{ items: shuffle(pool.filter((id) => flagged.has(id)), next), reason: () => 'Flagged by a check' }];
  }
  if (strategy === 'disagree') {
    const items = [];
    for (const id of pool) {
      for (const c of p.checks || EMPTY) {
        if (c.type !== 'judge') continue;
        const v = c.results?.[id]?.verdict;
        const h = humanLabel(p, id, c.modeId);
        if (v && h && v !== h) { items.push(id); break; }
      }
    }
    return [{ items: shuffle(items, next), reason: () => 'Judge disagrees with your label' }];
  }
  return [];
}

/** Save the current set (or clear it with null items). */
export function setBatch(p, items, strategy = 'mix', opts = {}) {
  const t = stamp(opts);
  const batch = items ? { createdAt: t, strategy, items: items.map(({ traceId, reason }) => ({ traceId, reason: reason ?? '' })) } : null;
  return { ...p, batch, updatedAt: t };
}

/** Reviewed counts per detail value for each filter key: { [key]: [{ value, total, reviewed }] }. */
export function coverage(p) {
  const norm = normalizeAll(p);
  const out = {};
  for (const key of p.experience?.filters || EMPTY) {
    const rows = new Map();
    for (const [id, n] of norm) {
      const v = n.metadata[key];
      if (v == null || v === '') continue;
      const k = String(v);
      if (!rows.has(k)) rows.set(k, { value: k, total: 0, reviewed: 0 });
      const row = rows.get(k);
      row.total++;
      const verdict = p.reviews?.[id]?.verdict;
      if (verdict === 'pass' || verdict === 'fail') row.reviewed++;
    }
    out[key] = [...rows.values()].sort((a, b) => b.total - a.total || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  }
  return out;
}
