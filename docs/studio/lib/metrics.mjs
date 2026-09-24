// metrics.mjs: hashing, seeded random numbers, agreement between a check and
// your labels, the likely true failure rate with a 95% range, and retrieval
// metrics.
//
// The agreement and correction math is adapted from judgy (MIT,
// https://github.com/ai-evals-course/judgy) and hamelsmu/evals-skills
// (MIT, (c) 2026 Hamel Husain). As in judgy, Pass is the positive class:
// "agrees on good traces" is what judgy calls TPR and "catches real failures"
// is what it calls TNR.
// Unlike judgy, pmstack also resamples the unlabeled verdicts because its
// unlabeled sets are small.

/**
 * cyrb53 string hash as a 14-character lowercase hex string. The 32-bit half comes first,
 * so any 8-character prefix (used for trace ids) keeps 32 bits of the hash.
 */
export function hashString(str, seed = 0) {
  const s = String(str);
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (2097151 & h2).toString(16).padStart(6, '0');
}

/** mulberry32 seeded generator; returns a function giving floats in [0, 1). Non-number seeds are hashed. */
export function rng(seed = 7) {
  let a = typeof seed === 'number' && Number.isFinite(seed)
    ? seed >>> 0
    : parseInt(hashString(String(seed)).slice(-8), 16) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isVerdict = (v) => v === 'pass' || v === 'fail';

/**
 * Compare check verdicts with your labels. Pairs are { traceId, human, check } with
 * values 'pass' | 'fail'; other values are left out.
 */
export function agreement(pairs = []) {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  const falsePasses = []; // you said Problem, the check said Good: "Check missed these failures"
  const falseFails = []; // you said Good, the check said Problem: "Check flagged these good traces"
  for (const pair of pairs) {
    if (!pair || !isVerdict(pair.human) || !isVerdict(pair.check)) continue;
    if (pair.human === 'pass') {
      if (pair.check === 'pass') tp++;
      else { fn++; falseFails.push(pair.traceId); }
    } else if (pair.check === 'pass') {
      fp++; falsePasses.push(pair.traceId);
    } else tn++;
  }
  const nPass = tp + fn;
  const nFail = fp + tn;
  return {
    n: nPass + nFail, nPass, nFail, tp, fn, fp, tn,
    agreesOnGood: nPass ? tp / nPass : null,
    catchesFailures: nFail ? tn / nFail : null,
    falsePasses, falseFails,
  };
}

const clip01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Correct an observed pass rate for the judge's known mistakes (Rogan-Gladen); null when the judge is near chance. */
export function correctedPassRate({ observedPassRate, agreesOnGood, catchesFailures } = {}) {
  if (observedPassRate == null || agreesOnGood == null || catchesFailures == null) return null;
  const denom = agreesOnGood + catchesFailures - 1;
  if (denom <= 0.05) return null;
  return clip01((observedPassRate + catchesFailures - 1) / denom);
}

/**
 * Likely true pass rate with a 95% bootstrap range. Each draw resamples the test pairs and,
 * with the same generator, the unlabeled verdicts. Set resampleUnlabeled false to hold them fixed.
 */
export function bootstrapCorrected({ testPairs = [], unlabeledVerdicts = [], iterations = 2000, seed = 7, resampleUnlabeled = true } = {}) {
  const pairs = testPairs.filter((p) => p && isVerdict(p.human) && isVerdict(p.check));
  const unl = unlabeledVerdicts
    .map((v) => (typeof v === 'string' ? v : v?.verdict))
    .filter(isVerdict);
  const observedPassRate = unl.length ? unl.filter((v) => v === 'pass').length / unl.length : null;
  const full = agreement(pairs);
  const estimate = correctedPassRate({ observedPassRate, agreesOnGood: full.agreesOnGood, catchesFailures: full.catchesFailures });
  const base = { observedPassRate, estimate, low: null, high: null, iterationsUsed: 0, reason: null };
  if (!pairs.length) return { ...base, reason: 'The final test has no judge results yet.' };
  if (!unl.length) return { ...base, reason: 'The judge has not run on any traces you have not labeled.' };
  if (estimate == null) return { ...base, reason: 'The judge is too close to guessing to correct its rate.' };

  const next = rng(seed);
  const n = pairs.length;
  const m = unl.length;
  const kept = [];
  for (let it = 0; it < iterations; it++) {
    let tp = 0, fn = 0, fp = 0, tn = 0;
    for (let i = 0; i < n; i++) {
      const p = pairs[Math.floor(next() * n)];
      if (p.human === 'pass') { if (p.check === 'pass') tp++; else fn++; }
      else if (p.check === 'pass') fp++; else tn++;
    }
    let obs = observedPassRate;
    if (resampleUnlabeled) {
      let passes = 0;
      for (let i = 0; i < m; i++) if (unl[Math.floor(next() * m)] === 'pass') passes++;
      obs = passes / m;
    }
    if (tp + fn === 0 || fp + tn === 0) continue;
    const tpr = tp / (tp + fn);
    const tnr = tn / (fp + tn);
    if (tpr + tnr - 1 <= 0.05) continue;
    kept.push(clip01((obs + tnr - 1) / (tpr + tnr - 1)));
  }
  kept.sort((a, b) => a - b);
  const k = kept.length;
  if (k < 0.9 * iterations) return { ...base, iterationsUsed: k, reason: 'The final test is too small to give a range.' };
  return { ...base, low: kept[Math.floor(0.025 * k)], high: kept[Math.ceil(0.975 * k) - 1], iterationsUsed: k };
}

/** Turn pass rates into failure rates: 1 - x, with the range bounds swapped. */
export function asFailureRate({ observedPassRate = null, estimate = null, low = null, high = null } = {}) {
  const flip = (x) => (x == null ? null : 1 - x);
  return { observed: flip(observedPassRate), estimate: flip(estimate), low: flip(high), high: flip(low) };
}

const uniq = (ids) => [...new Set((ids || []).filter((x) => x != null).map(String))];

/** Share of needed documents found in the top k retrieved; null when nothing is needed. */
export function recallAtK(retrievedIds, neededIds, k = 5) {
  const needed = uniq(neededIds);
  if (!needed.length) return null;
  const top = new Set(uniq(retrievedIds).slice(0, k));
  return needed.filter((id) => top.has(id)).length / needed.length;
}

/** 1 / rank of the first needed document in the retrieved list; 0 when none is found; null when nothing is needed. */
export function reciprocalRank(retrievedIds, neededIds) {
  const needed = new Set(uniq(neededIds));
  if (!needed.size) return null;
  const list = uniq(retrievedIds);
  const i = list.findIndex((id) => needed.has(id));
  return i < 0 ? 0 : 1 / (i + 1);
}

// Retrieved document ids of a raw trace, in order: documents of retrieval steps.
function retrievedIdsOf(raw) {
  const out = [];
  for (const s of Array.isArray(raw?.steps) ? raw.steps : []) {
    if (s?.type !== 'retrieval' || !Array.isArray(s.documents)) continue;
    for (const d of s.documents) if (d?.id != null) out.push(String(d.id));
  }
  return out;
}

/** Recall at k and mean reciprocal rank over reviews that mark needed documents. */
export function retrievalSummary(project, k = 5) {
  const byId = new Map((project?.traces || []).map((t) => [String(t.id), t]));
  let n = 0, recall = 0, rr = 0;
  for (const [traceId, review] of Object.entries(project?.reviews || {})) {
    const r = review?.retrieval;
    if (!r) continue;
    const needed = uniq([...(r.needed || []), ...(r.missing || [])]);
    if (!needed.length) continue;
    const retrieved = retrievedIdsOf(byId.get(traceId));
    n++;
    recall += recallAtK(retrieved, needed, k);
    rr += reciprocalRank(retrieved, needed);
  }
  return { n, k, recallAtK: n ? recall / n : null, mrr: n ? rr / n : null };
}

/** Format a share as a whole percent ("92%"); "-" when unknown. */
export function pct(x) {
  if (x == null || Number.isNaN(x)) return '-';
  return Math.round(x * 100) + '%';
}

/** Read a verdict from judge or file values ("Pass", "fail", true, 0) as 'pass' | 'fail' | null. */
export function verdictFor(v) {
  if (v === true) return 'pass';
  if (v === false) return 'fail';
  if (typeof v === 'number') return v === 1 ? 'pass' : v === 0 ? 'fail' : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/[.!"'`*]/g, '');
  if (s === 'pass' || s === 'passed' || s === 'good' || s === 'true' || s === '1') return 'pass';
  if (s === 'fail' || s === 'failed' || s === 'problem' || s === 'false' || s === '0') return 'fail';
  return null;
}
