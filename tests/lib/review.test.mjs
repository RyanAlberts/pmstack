import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewStats, setVerdict, setNote, setStage, setStep, setGood, toggleMode, toggleSuccessMode, setRetrieval,
  reviewSnapshot, restoreReview, orderedReviews, discoveryCurve, saturationHint, recheckQueue, filterTraces, nextTrace,
  setLabel, reviewKind, failStage,
} from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace, review, minuteIso } from '../fixtures/build.mjs';

const ids = (n, prefix = 't') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);
const fm = (id, createdMinute, extra = {}) => ({ id, kind: 'failure', name: `Mode ${id}`, definition: 'Fails when x.', stage: null, severity: 'annoys', createdAt: minuteIso(createdMinute), definitionUpdatedAt: null, fixedAt: null, source: 'human', ...extra });

test('mutators: reviewedAt set once, structural sharing, updatedAt', () => {
  const p = makeProject({ traces: ids(3).map((id) => chatTrace(id)) });
  const a = setVerdict(p, 't00', 'fail', { now: '2026-09-20T10:00:00Z' });
  assert.equal(a.reviews.t00.verdict, 'fail');
  assert.equal(a.reviews.t00.reviewedAt, '2026-09-20T10:00:00Z');
  assert.equal(a.updatedAt, '2026-09-20T10:00:00Z');
  assert.equal(a.traces, p.traces);
  assert.equal(a.experience, p.experience);
  assert.equal(a.modes, p.modes);
  const b = setVerdict(a, 't00', 'pass', { now: '2026-09-20T11:00:00Z' });
  assert.equal(b.reviews.t00.reviewedAt, '2026-09-20T10:00:00Z', 'reviewedAt never changes');
  assert.equal(b.reviews.t00.at, '2026-09-20T11:00:00Z');
  assert.equal(setVerdict(b, 't00', 'pass'), b, 'same verdict, same project');
  const c = setNote(b, 't01', 'Note before a verdict', { now: '2026-09-20T12:00:00Z' });
  assert.equal(c.reviews.t01.verdict, null);
  assert.equal(c.reviews.t01.reviewedAt, null);
  assert.equal(c.reviews.t00, b.reviews.t00, 'other reviews keep identity');
  const d = setVerdict(c, 't01', 'skip', { now: '2026-09-20T13:00:00Z' });
  assert.equal(d.reviews.t01.reviewedAt, '2026-09-20T13:00:00Z');
  assert.equal(setNote(p, 't02', ''), p);
});

test('stage, step, good note, modes, retrieval, undo', () => {
  let p = makeProject({ traces: ids(2).map((id) => chatTrace(id)) });
  const snap = reviewSnapshot(p, 't00');
  p = setVerdict(p, 't00', 'fail');
  p = setStage(p, 't00', 'act');
  assert.equal(p.reviews.t00.stage, 'act');
  p = setStep(p, 't00', 'm1', 'answer');
  assert.deepEqual([p.reviews.t00.step, p.reviews.t00.stage], ['m1', 'answer']);
  p = setStep(p, 't00', 'm0');
  assert.deepEqual([p.reviews.t00.step, p.reviews.t00.stage], ['m0', 'answer'], 'a step with no stage keeps the stage');
  p = toggleMode(p, 't00', 'fm-a');
  p = toggleMode(p, 't00', 'fm-b');
  p = toggleMode(p, 't00', 'fm-a');
  assert.deepEqual(p.reviews.t00.modes, ['fm-b']);
  p = toggleSuccessMode(p, 't00', 'sm-a');
  assert.deepEqual(p.reviews.t00.successModes, ['sm-a']);
  p = setGood(p, 't00', 'Read the booking back');
  assert.equal(p.reviews.t00.good, 'Read the booking back');
  p = setRetrieval(p, 't00', { needed: ['d1'], missing: ['d9'] });
  assert.deepEqual(p.reviews.t00.retrieval, { needed: ['d1'], missing: ['d9'] });
  const mid = reviewSnapshot(p, 't00');
  const q = setNote(p, 't00', 'changed');
  assert.equal(restoreReview(q, 't00', mid).reviews.t00, mid);
  const gone = restoreReview(q, 't00', snap);
  assert.equal('t00' in gone.reviews, false, 'undo back to no review removes it');
});

test('reviewStats counts Good and Problem as reviewed, and Problems without a note', () => {
  const p = makeProject({
    traces: ids(6).map((id) => chatTrace(id)),
    reviews: { t00: review('pass', 0), t01: review('fail', 1, { note: 'x' }), t02: review('fail', 2), t03: review('skip', 3), t04: review(null, 4) },
  });
  assert.deepEqual(reviewStats(p), { total: 6, reviewed: 3, pass: 1, fail: 2, skip: 1, unreviewed: 2, needsNote: 1 });
});

// Thirty reviews in order t00..t29 (reviewedAt minute i). t00 was edited much later: its `at` moves, its reviewedAt does not.
function discovery() {
  const reviews = {};
  for (let i = 0; i < 30; i++) reviews[`t${String(i).padStart(2, '0')}`] = review(i % 5 === 0 ? 'fail' : 'pass', i);
  reviews.t00 = { ...reviews.t00, modes: ['fm-1'], at: minuteIso(500) };
  reviews.t05 = { ...reviews.t05, modes: ['fm-1'] };
  reviews.t10 = { ...reviews.t10, modes: ['fm-2'], reviewedAt: minuteIso(12), at: minuteIso(12) };
  reviews.t15 = { ...reviews.t15, modes: ['nm-x'] };
  reviews.t20 = { ...reviews.t20, modes: ['fm-2'] };
  reviews.t25 = { ...reviews.t25, modes: ['fm-3'] };
  return makeProject({
    traces: ids(30).map((id) => chatTrace(id)),
    modes: [fm('fm-1', 0), fm('fm-2', 11), fm('fm-3', 26), { id: 'nm-x', kind: 'ignore', name: 'Not a product problem', stage: null, createdAt: minuteIso(0), source: 'human' }],
    reviews,
  });
}

test('orderedReviews and discoveryCurve use reviewedAt, not the last edit', () => {
  const p = discovery();
  const order = orderedReviews(p).map((r) => r.traceId);
  assert.equal(order[0], 't00');
  assert.equal(order.indexOf('t10'), 11, 't10 was first reviewed at minute 12, after t11');
  assert.equal(order.indexOf('t12'), 12, 't12 ties with t10 at minute 12; trace position breaks the tie');
  const curve = discoveryCurve(p);
  assert.equal(curve.length, 30);
  assert.deepEqual(curve[0], { n: 1, modesKnown: 1, newInWindow: 1 });
  assert.deepEqual(curve[12], { n: 13, modesKnown: 2, newInWindow: 1 });
  assert.deepEqual(curve[24], { n: 25, modesKnown: 2, newInWindow: 0 });
  assert.deepEqual(curve[25], { n: 26, modesKnown: 3, newInWindow: 1 });
  assert.equal(orderedReviews(p), orderedReviews(p), 'memoized');
});

test('saturationHint: early, group, keep, stop', () => {
  const early = makeProject({ traces: ids(5).map((id) => chatTrace(id)), reviews: { t00: review('pass', 0) } });
  assert.equal(saturationHint(early).level, 'early');
  assert.equal(saturationHint(early).message, 'Keep reviewing. Aim for 100 traces, or until new failure modes stop appearing.');

  const p = discovery();
  assert.deepEqual(saturationHint(p), { level: 'keep', message: 'Keep going: 2 new failure modes in your last 20 traces.' });

  const loose = { ...p, reviews: { ...p.reviews, t29: review('fail', 29) } };
  assert.equal(saturationHint(loose).level, 'group', 'a Problem in the last 20 has no failure mode yet');

  // 50 reviews; failure modes only in the first 20, created before the last 20 began.
  const reviews = {};
  for (let i = 0; i < 50; i++) reviews[`t${String(i).padStart(2, '0')}`] = review('pass', i);
  reviews.t02 = review('fail', 2, { modes: ['fm-1'] });
  reviews.t08 = review('fail', 8, { modes: ['fm-2'] });
  reviews.t35 = review('fail', 35, { modes: ['fm-1'] });
  const done = makeProject({ traces: ids(50).map((id) => chatTrace(id)), modes: [fm('fm-1', 3), fm('fm-2', 9)], reviews });
  assert.deepEqual(saturationHint(done), { level: 'stop', message: 'New failure modes have stopped appearing in your last 20 traces. You can move on to checks.' });

  const edited = { ...done, modes: [fm('fm-1', 3), fm('fm-2', 9, { definitionUpdatedAt: minuteIso(40) })] };
  assert.deepEqual(saturationHint(edited), { level: 'keep', message: 'Keep going: 1 new failure mode in your last 20 traces.' });
});

test('recheckQueue: Good reviews older than a failure mode, until labeled', () => {
  const p = discovery();
  const q = recheckQueue(p);
  // fm-2 was created at minute 11 and fm-3 at 26; Good reviews before each need a look.
  assert.deepEqual(q.find((x) => x.traceId === 't01'), { traceId: 't01', modeIds: ['fm-2', 'fm-3'] });
  assert.deepEqual(q.find((x) => x.traceId === 't24'), { traceId: 't24', modeIds: ['fm-3'] });
  assert.equal(q.find((x) => x.traceId === 't26'), undefined);
  assert.equal(q.some((x) => x.traceId === 't05'), false, 'Problem reviews are not in the queue');
  const labeled = setLabel(p, 'fm-3', 't24', 'pass');
  assert.equal(recheckQueue(labeled).find((x) => x.traceId === 't24'), undefined);
});

test('reviewKind and failStage', () => {
  const p = makeProject({ modes: [fm('fm-1', 0, { stage: 'act' }), { id: 'nm-x', kind: 'ignore', name: 'x', stage: null }] });
  assert.equal(reviewKind(p, review('fail', 0, { modes: ['nm-x'] })), 'ignored');
  assert.equal(reviewKind(p, review('fail', 0, { modes: ['nm-x', 'fm-1'] })), 'fail');
  assert.equal(reviewKind(p, review('fail', 0)), 'fail');
  assert.equal(reviewKind(p, review(null, 0)), null);
  assert.equal(failStage(p, review('fail', 0, { modes: ['fm-1'] })), 'act');
  assert.equal(failStage(p, review('fail', 0, { stage: 'gather', modes: ['fm-1'] })), 'gather');
  assert.equal(failStage(p, review('fail', 0, { stage: 'unknown' })), 'unknown');
});

test('filterTraces by status, details, mode, stage, text, version; nextTrace', () => {
  const traces = [
    chatTrace('a', [['user', 'move my cleaning'], ['assistant', 'Friday works']], { channel: 'sms', version: 'Version 1' }),
    chatTrace('b', [['user', 'cancel tuesday'], ['assistant', 'Done']], { channel: 'web', version: 'Version 1' }),
    chatTrace('c', [['user', 'talk to a person'], ['assistant', 'Here are times']], { channel: 'sms', version: 'Version 2' }),
    chatTrace('d', [['user', 'insurance?'], ['assistant', 'Yes']], { channel: 'voice', version: 'Version 2' }),
    chatTrace('e', [['user', 'hello'], ['assistant', 'hi']], { channel: 'sms', version: 'Version 2' }),
  ];
  const p = makeProject({
    traces,
    modes: [fm('fm-1', 100, { stage: 'act' }), { id: 'sm-1', kind: 'success', name: 's', stage: 'answer', createdAt: minuteIso(0), source: 'human' }],
    reviews: {
      a: review('pass', 1, { successModes: ['sm-1'] }),
      b: review('fail', 2, { note: 'Cancelled the wrong day', modes: ['fm-1'] }),
      c: review('fail', 3),
      d: review('skip', 4),
      e: review(null, 5),
    },
    suggestions: [{ id: 's1', kind: 'flag', status: 'open', traceId: 'd', modeId: 'fm-1' }, { id: 's2', kind: 'flag', status: 'dismissed', traceId: 'e', modeId: 'fm-1' }],
  });
  assert.deepEqual(filterTraces(p), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(filterTraces(p, { status: 'todo' }), ['e']);
  assert.deepEqual(filterTraces(p, { status: 'pass' }), ['a']);
  assert.deepEqual(filterTraces(p, { status: 'fail' }), ['b', 'c']);
  assert.deepEqual(filterTraces(p, { status: 'skip' }), ['d']);
  assert.deepEqual(filterTraces(p, { status: 'needsNote' }), ['c']);
  assert.deepEqual(filterTraces(p, { status: 'suggested' }), ['d']);
  assert.deepEqual(filterTraces(p, { status: 'recheck' }), ['a']);
  assert.deepEqual(filterTraces(p, { meta: { channel: 'sms' } }), ['a', 'c', 'e']);
  assert.deepEqual(filterTraces(p, { modeId: 'fm-1' }), ['b']);
  assert.deepEqual(filterTraces(p, { modeId: 'sm-1' }), ['a']);
  assert.deepEqual(filterTraces(p, { stage: 'act' }), ['b']);
  assert.deepEqual(filterTraces(p, { stage: 'unknown' }), ['c']);
  assert.deepEqual(filterTraces(p, { text: 'PERSON' }), ['c']);
  assert.deepEqual(filterTraces(p, { text: 'wrong day' }), ['b'], 'notes are searched too');
  assert.deepEqual(filterTraces(p, { version: 'Version 2', status: 'fail' }), ['c']);
  const list = filterTraces(p, { meta: { channel: 'sms' } });
  assert.equal(nextTrace(p, 'a', list), 'c');
  assert.equal(nextTrace(p, 'c', list, -1), 'a');
  assert.equal(nextTrace(p, 'e', list), null);
  assert.equal(nextTrace(p, 'b', list), 'c', 'from a trace outside the list, go to the next one in trace order');
  assert.equal(nextTrace(p, 'd', list, -1), 'c');
});
