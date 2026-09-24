import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  humanLabel, setLabel, setLabelResult, setCritique, toggleCloseCall, labeledSet, assignSplits, splitOf, splitCounts,
  splitTargets, labelsHash, canReshuffle, labelsSinceReveal, startFreshTest, isLockedLabel,
} from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace, review, minuteIso } from '../fixtures/build.mjs';

const now = { now: '2026-09-20T12:00:00Z' };
const traces = Array.from({ length: 60 }, (_, i) => chatTrace(`t${String(i).padStart(2, '0')}`));
const mode = (id, createdMinute, extra = {}) => ({ id, kind: 'failure', name: id, definition: 'Fails when x.', stage: null, severity: 'hurts', createdAt: minuteIso(createdMinute), definitionUpdatedAt: null, fixedAt: null, source: 'human', ...extra });

function base() {
  return makeProject({
    traces,
    modes: [mode('fm-x', 5), mode('fm-y', 0), { id: 'sm-ok', kind: 'success', name: 'ok', definition: '', stage: null, createdAt: minuteIso(0), source: 'human' }],
    reviews: {
      t00: review('fail', 1, { modes: ['fm-y'] }), // Problem with another mode
      t01: review('pass', 2), // Good before fm-x existed
      t02: review('pass', 10), // Good after fm-x existed
      t03: review('fail', 11, { modes: ['fm-x'] }),
      t04: review('skip', 12),
    },
  });
}

test('humanLabel: explicit wins; Problem with the mode is fail; Good after creation is pass; else null', () => {
  const p = base();
  assert.equal(humanLabel(p, 't00', 'fm-x'), null, 'a Problem trace with another mode is not an implied pass');
  assert.equal(humanLabel(p, 't01', 'fm-x'), null, 'a Good trace reviewed before the mode existed');
  assert.equal(humanLabel(p, 't02', 'fm-x'), 'pass');
  assert.equal(humanLabel(p, 't03', 'fm-x'), 'fail');
  assert.equal(humanLabel(p, 't04', 'fm-x'), null);
  assert.equal(humanLabel(p, 't09', 'fm-x'), null);
  const q = setLabel(p, 'fm-x', 't01', 'pass', now);
  assert.equal(humanLabel(q, 't01', 'fm-x'), 'pass', 'an explicit No makes it pass');
  const r = setLabel(q, 'fm-x', 't03', 'pass', now);
  assert.equal(humanLabel(r, 't03', 'fm-x'), 'pass', 'explicit label wins over the review');
  // A definition edit after the Good review needs a new look.
  const edited = { ...p, modes: p.modes.map((m) => (m.id === 'fm-x' ? { ...m, definitionUpdatedAt: minuteIso(20) } : m)) };
  assert.equal(humanLabel(edited, 't02', 'fm-x'), null);
  assert.equal(humanLabel(p, 't02', 'sm-ok'), null, 'labels are for failure modes only');
});

test('setLabel writes labels, creates a label-only review, and shares structure', () => {
  const p = base();
  const q = setLabel(p, 'fm-x', 't20', 'fail', now);
  assert.equal(q.labels['fm-x'].t20, 'fail');
  assert.equal(q.reviews.t20.verdict, null);
  assert.equal(q.reviews.t20.at, now.now);
  assert.equal(q.updatedAt, now.now);
  assert.equal(q.traces, p.traces);
  assert.equal(q.experience, p.experience);
  assert.equal(q.reviews.t00, p.reviews.t00);
  const r = setLabel(q, 'fm-x', 't03', 'fail', now);
  assert.equal(r.reviews.t03, q.reviews.t03, 'an existing review is left alone');
  const cleared = setLabel(q, 'fm-x', 't20', null, now);
  assert.equal(cleared.labels['fm-x'].t20, undefined);
  assert.equal(setLabel(cleared, 'fm-x', 't20', null, now), cleared, 'no change, same project');
});

test('critiques and close calls', () => {
  let p = setCritique(base(), 'fm-x', 't03', 'Asked twice for the front desk.', now);
  assert.equal(p.critiques['fm-x'].t03, 'Asked twice for the front desk.');
  p = setCritique(p, 'fm-x', 't03', '', now);
  assert.equal(p.critiques['fm-x'].t03, undefined);
  p = toggleCloseCall(p, 'fm-x', 't02', now);
  assert.deepEqual(p.closeCalls['fm-x'], ['t02']);
  p = toggleCloseCall(p, 'fm-x', 't02', now);
  assert.deepEqual(p.closeCalls['fm-x'], []);
});

test('labeledSet lists non-null labels in trace order', () => {
  const p = setLabel(base(), 'fm-x', 't30', 'fail', now);
  assert.deepEqual(labeledSet(p, 'fm-x'), [
    { traceId: 't02', label: 'pass', explicit: false },
    { traceId: 't03', label: 'fail', explicit: false },
    { traceId: 't30', label: 'fail', explicit: true },
  ]);
});

function forty() {
  // 12 fail and 28 pass explicit labels.
  let p = makeProject({ traces, modes: [mode('fm-x', 0)] });
  for (let i = 0; i < 40; i++) p = setLabel(p, 'fm-x', `t${String(i).padStart(2, '0')}`, i < 12 ? 'fail' : 'pass', now);
  return p;
}

test('splits: 12 fail + 28 pass gives examples 2/4, test 5/11, tuning 5/13, stable on rerun', () => {
  assert.deepEqual(splitTargets(12), { examples: 2, test: 5, tuning: 5 });
  assert.deepEqual(splitTargets(28), { examples: 4, test: 11, tuning: 13 });
  assert.deepEqual(splitTargets(2), { examples: 0, test: 1, tuning: 1 });
  const p = assignSplits(forty(), 'fm-x', { seed: 7 }, now);
  assert.deepEqual(splitCounts(p, 'fm-x'), { examples: { pass: 4, fail: 2 }, tuning: { pass: 13, fail: 5 }, test: { pass: 11, fail: 5 } });
  assert.equal(assignSplits(p, 'fm-x', { seed: 7 }, now), p, 'nothing new, same project');
  const again = assignSplits(forty(), 'fm-x', { seed: 7 }, now);
  assert.deepEqual(again.splits['fm-x'].assign, p.splits['fm-x'].assign, 'identical on rerun');
  const other = assignSplits(forty(), 'fm-x', { seed: 8 }, now);
  assert.notDeepEqual(other.splits['fm-x'].assign, p.splits['fm-x'].assign, 'the seed changes the draw');
});

test('splits: new labels keep old assignments and fill the split furthest below target', () => {
  let p = assignSplits(forty(), 'fm-x', { seed: 7 }, now);
  const before = { ...p.splits['fm-x'].assign };
  for (let i = 40; i < 50; i++) p = setLabel(p, 'fm-x', `t${i}`, 'pass', now);
  p = assignSplits(p, 'fm-x', {}, now);
  for (const [id, s] of Object.entries(before)) assert.equal(p.splits['fm-x'].assign[id], s);
  const c = splitCounts(p, 'fm-x');
  assert.equal(c.examples.pass + c.tuning.pass + c.test.pass, 38);
  assert.deepEqual(c.test, { pass: Math.round(0.4 * 38), fail: 5 });
});

test('after the reveal: new labels join tuning, test labels are read-only, reshuffle is refused', () => {
  let p = assignSplits(forty(), 'fm-x', { seed: 7 }, now);
  assert.equal(canReshuffle(p, 'fm-x'), true);
  p = { ...p, splits: { ...p.splits, 'fm-x': { ...p.splits['fm-x'], revealedAt: '2026-09-21T00:00:00Z' } } };
  assert.equal(canReshuffle(p, 'fm-x'), false);
  assert.equal(assignSplits(p, 'fm-x', { reshuffle: true }, now), p);
  const testId = Object.keys(p.splits['fm-x'].assign).find((id) => p.splits['fm-x'].assign[id] === 'test');
  assert.equal(isLockedLabel(p, 'fm-x', testId), true);
  const refused = setLabelResult(p, 'fm-x', testId, 'fail', now);
  assert.equal(refused.project, p);
  assert.match(refused.error, /final test/);
  const hash = labelsHash(p, 'fm-x');
  p = setLabel(p, 'fm-x', 't55', 'fail', now);
  p = assignSplits(p, 'fm-x', {}, now);
  assert.equal(splitOf(p, 'fm-x', 't55'), 'tuning');
  assert.deepEqual(labelsSinceReveal(p, 'fm-x'), ['t55']);
  assert.equal(labelsHash(p, 'fm-x'), hash, 'a tuning label does not change the test hash');
});

test('reshuffle before any judge results redraws; judge results block it', () => {
  const p = assignSplits(forty(), 'fm-x', { seed: 7 }, now);
  const q = assignSplits(p, 'fm-x', { seed: 99, reshuffle: true }, now);
  assert.notDeepEqual(q.splits['fm-x'].assign, p.splits['fm-x'].assign);
  assert.equal(q.splits['fm-x'].seed, 99);
  const next = assignSplits(p, 'fm-x', { reshuffle: true }, now);
  assert.equal(next.splits['fm-x'].seed, 8, 'no seed given: the next seed');
  assert.notDeepEqual(next.splits['fm-x'].assign, p.splits['fm-x'].assign);
  const judged = { ...p, checks: [{ id: 'ck', modeId: 'fm-x', type: 'judge', results: { t00: { verdict: 'fail' } } }] };
  assert.equal(canReshuffle(judged, 'fm-x'), false);
});

test('a fresh final test comes from labels added after the reveal', () => {
  let p = assignSplits(forty(), 'fm-x', { seed: 7 }, now);
  p = { ...p, splits: { ...p.splits, 'fm-x': { ...p.splits['fm-x'], revealedAt: '2026-09-21T00:00:00Z' } }, checks: [{ id: 'ck', modeId: 'fm-x', type: 'judge', test: { revealedAt: 'x' } }] };
  assert.equal(startFreshTest(p, 'fm-x', now), p, 'needs 30 new labels');
  const more = [];
  for (let i = 0; i < 20; i++) more.push(`n${i}`);
  p = { ...p, traces: [...p.traces, ...more.map((id) => chatTrace(id))] };
  for (let i = 40; i < 60; i++) p = setLabel(p, 'fm-x', `t${i}`, i % 2 ? 'pass' : 'fail', now);
  for (const [i, id] of more.entries()) p = setLabel(p, 'fm-x', id, i % 3 ? 'pass' : 'fail', now);
  p = assignSplits(p, 'fm-x', {}, now);
  assert.equal(labelsSinceReveal(p, 'fm-x').length, 40);
  const oldTest = Object.keys(p.splits['fm-x'].assign).filter((id) => p.splits['fm-x'].assign[id] === 'test');
  const q = startFreshTest(p, 'fm-x', now);
  assert.equal(q.splits['fm-x'].revealedAt, null);
  assert.equal(q.checks[0].test, null);
  for (const id of oldTest) assert.equal(splitOf(q, 'fm-x', id), 'tuning');
  const newTest = Object.keys(q.splits['fm-x'].assign).filter((id) => q.splits['fm-x'].assign[id] === 'test');
  assert.ok(newTest.length > 0 && newTest.every((id) => labelsSinceReveal(p, 'fm-x').includes(id)));
});
