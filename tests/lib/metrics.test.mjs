import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashString, rng, agreement, correctedPassRate, bootstrapCorrected, asFailureRate, recallAtK, reciprocalRank,
  retrievalSummary, pct, verdictFor,
} from '../../docs/studio/lib/index.mjs';
import { makeProject } from '../fixtures/build.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

// 75 final-test pairs: 25 you called Problem (judge caught 23), 50 you called Good (judge agreed on 47).
const testPairs = [
  ...Array.from({ length: 25 }, (_, i) => ({ traceId: `f${i}`, human: 'fail', check: i < 23 ? 'fail' : 'pass' })),
  ...Array.from({ length: 50 }, (_, i) => ({ traceId: `p${i}`, human: 'pass', check: i < 47 ? 'pass' : 'fail' })),
];
const unlabeled = (n, fails) => Array.from({ length: n }, (_, i) => (i < fails ? 'fail' : 'pass'));

test('hashString is stable cyrb53 hex; rng is seeded', () => {
  assert.match(hashString('abc'), /^[0-9a-f]{14}$/);
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.notEqual(hashString('abc', 1), hashString('abc'));
  const a = rng(7), b = rng(7), c = rng(8);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  const s = rng('seed-as-text');
  assert.equal(typeof s(), 'number');
});

test('agreement: cells, rates, and the two lists', () => {
  const a = agreement([
    { traceId: 't1', human: 'pass', check: 'pass' },
    { traceId: 't2', human: 'pass', check: 'fail' },
    { traceId: 't3', human: 'fail', check: 'pass' },
    { traceId: 't4', human: 'fail', check: 'fail' },
    { traceId: 't5', human: 'pass', check: 'pass' },
    { traceId: 't6', human: 'pass', check: 'error' },
    { traceId: 't7', human: null, check: 'pass' },
  ]);
  assert.deepEqual(
    { n: a.n, nPass: a.nPass, nFail: a.nFail, tp: a.tp, fn: a.fn, fp: a.fp, tn: a.tn },
    { n: 5, nPass: 3, nFail: 2, tp: 2, fn: 1, fp: 1, tn: 1 },
  );
  close(a.agreesOnGood, 2 / 3);
  close(a.catchesFailures, 1 / 2);
  assert.deepEqual(a.falsePasses, ['t3'], 'you said Problem, the check said Good');
  assert.deepEqual(a.falseFails, ['t2'], 'you said Good, the check said Problem');
  const none = agreement([{ traceId: 'x', human: 'pass', check: 'pass' }]);
  assert.equal(none.catchesFailures, null);
  assert.equal(none.agreesOnGood, 1);
});

test('corrected pass rate: worked example, near-chance judge, clipping', () => {
  close(correctedPassRate({ observedPassRate: 0.8, agreesOnGood: 0.92, catchesFailures: 0.88 }), 0.85);
  assert.equal(correctedPassRate({ observedPassRate: 0.8, agreesOnGood: 0.5, catchesFailures: 0.5 }), null);
  assert.equal(correctedPassRate({ observedPassRate: 0.8, agreesOnGood: 0.52, catchesFailures: 0.52 }), null);
  assert.equal(correctedPassRate({ observedPassRate: 0.99, agreesOnGood: 0.9, catchesFailures: 0.9 }), 1);
  assert.equal(correctedPassRate({ observedPassRate: 0.05, agreesOnGood: 0.9, catchesFailures: 0.9 }), 0);
  assert.equal(correctedPassRate({ observedPassRate: null, agreesOnGood: 0.9, catchesFailures: 0.9 }), null);
});

test('bootstrap: deterministic, range contains the estimate', () => {
  const opts = { testPairs, unlabeledVerdicts: unlabeled(400, 72), iterations: 2000, seed: 7 };
  const a = bootstrapCorrected(opts);
  const b = bootstrapCorrected(opts);
  assert.deepEqual(a, b);
  close(a.observedPassRate, 0.82);
  close(a.estimate, (0.82 + 0.92 - 1) / (0.94 + 0.92 - 1));
  assert.ok(a.low <= a.estimate && a.estimate <= a.high, `${a.low} ${a.estimate} ${a.high}`);
  assert.ok(a.iterationsUsed >= 1800);
  assert.equal(a.reason, null);
  assert.notDeepEqual(bootstrapCorrected({ ...opts, seed: 8 }), a);
});

test('bootstrap: resampling the unlabeled verdicts gives a range at least as wide as holding them fixed', () => {
  const opts = { testPairs, unlabeledVerdicts: unlabeled(48, 9), iterations: 2000, seed: 7 };
  const both = bootstrapCorrected(opts);
  const fixed = bootstrapCorrected({ ...opts, resampleUnlabeled: false });
  assert.equal(both.estimate, fixed.estimate);
  assert.ok(both.high - both.low >= fixed.high - fixed.low, `${both.high - both.low} < ${fixed.high - fixed.low}`);
});

test('bootstrap: too small a final test gives no range, with a plain reason', () => {
  const tiny = [{ traceId: 'a', human: 'fail', check: 'fail' }, { traceId: 'b', human: 'pass', check: 'pass' }, { traceId: 'c', human: 'pass', check: 'pass' }];
  const r = bootstrapCorrected({ testPairs: tiny, unlabeledVerdicts: unlabeled(20, 4) });
  assert.equal(r.low, null);
  assert.equal(r.high, null);
  assert.equal(r.reason, 'The final test is too small to give a range.');
  assert.equal(bootstrapCorrected({ testPairs, unlabeledVerdicts: [] }).estimate, null);
});

test('asFailureRate flips rates and swaps the bounds', () => {
  const f = asFailureRate({ observedPassRate: 0.82, estimate: 0.86, low: 0.8, high: 0.9 });
  close(f.observed, 0.18);
  close(f.estimate, 0.14);
  close(f.low, 0.1);
  close(f.high, 0.2);
  assert.ok(f.low <= f.estimate && f.estimate <= f.high);
  assert.deepEqual(asFailureRate({ observedPassRate: 0.5, estimate: null, low: null, high: null }), { observed: 0.5, estimate: null, low: null, high: null });
});

test('recall at k and reciprocal rank, worked examples', () => {
  const retrieved = ['hr-01', 'hr-07', 'hr-12', 'hr-03', 'hr-09', 'hr-20'];
  assert.equal(recallAtK(retrieved, ['hr-12', 'hr-20'], 5), 0.5);
  assert.equal(recallAtK(retrieved, ['hr-12', 'hr-20'], 6), 1);
  assert.equal(recallAtK(retrieved, ['hr-99'], 5), 0);
  assert.equal(recallAtK(retrieved, [], 5), null);
  assert.equal(reciprocalRank(retrieved, ['hr-12', 'hr-99']), 1 / 3);
  assert.equal(reciprocalRank(retrieved, ['hr-01']), 1);
  assert.equal(reciprocalRank(retrieved, ['hr-99']), 0);
  assert.equal(reciprocalRank(retrieved, []), null);
});

test('retrievalSummary over reviews that mark needed documents', () => {
  const docs = (ids) => [{ type: 'retrieval', name: 'search', documents: ids.map((id) => ({ id })) }];
  const p = makeProject({
    traces: [
      { id: 'a', input: 'q', steps: docs(['d1', 'd2', 'd3']), output: 'x' },
      { id: 'b', input: 'q', steps: docs(['d4', 'd5']), output: 'y' },
      { id: 'c', input: 'q', steps: docs(['d6']), output: 'z' },
    ],
  });
  p.reviews = {
    a: { verdict: 'pass', retrieval: { needed: ['d2'], missing: [] } },
    b: { verdict: 'fail', retrieval: { needed: ['d5'], missing: ['d9'] } },
    c: { verdict: 'pass', retrieval: null },
  };
  const r = retrievalSummary(p, 5);
  assert.equal(r.n, 2);
  assert.equal(r.recallAtK, (1 + 0.5) / 2);
  assert.equal(r.mrr, (1 / 2 + 1 / 2) / 2);
  assert.deepEqual(retrievalSummary(makeProject(), 5), { n: 0, k: 5, recallAtK: null, mrr: null });
});

test('pct and verdictFor', () => {
  assert.equal(pct(0.924), '92%');
  assert.equal(pct(0.925), '93%');
  assert.equal(pct(1), '100%');
  assert.equal(pct(null), '-');
  assert.equal(verdictFor('Pass'), 'pass');
  assert.equal(verdictFor(' FAIL. '), 'fail');
  assert.equal(verdictFor(true), 'pass');
  assert.equal(verdictFor(0), 'fail');
  assert.equal(verdictFor('maybe'), null);
});
