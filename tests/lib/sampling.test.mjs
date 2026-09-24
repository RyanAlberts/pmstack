import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBatch, setBatch, coverage, STRATEGIES } from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace, review } from '../fixtures/build.mjs';

const CHANNELS = ['sms', 'web', 'voice'];
function project(n = 120) {
  const traces = Array.from({ length: n }, (_, i) => {
    const turns = [['user', `request ${i} ${'x'.repeat(i % 40)}`], ['assistant', `reply ${i}`]];
    if (i % 7 === 0) turns.push(['user', 'and one more thing'], ['assistant', 'sure '.repeat(30)]);
    return chatTrace(`t${String(i).padStart(3, '0')}`, turns, { channel: CHANNELS[i % 3], feedback: i % 10 === 0 ? 'thumbs_down' : 'none' });
  });
  return makeProject({ traces, filters: ['channel'] });
}
const randomCount = (batch) => batch.filter((b) => b.reason === 'Random pick').length;

test('strategies are listed with plain labels', () => {
  assert.deepEqual(STRATEGIES.map((s) => s.id), ['mix', 'random', 'outliers', 'signal', 'flagged', 'disagree']);
});

test('deterministic for a seed; different seeds differ', () => {
  const p = project();
  const a = nextBatch(p, { size: 20, strategy: 'mix', seed: 7 });
  assert.deepEqual(nextBatch(p, { size: 20, strategy: 'mix', seed: 7 }), a);
  assert.notDeepEqual(nextBatch(p, { size: 20, strategy: 'mix', seed: 8 }), a);
  assert.equal(a.length, 20);
  assert.equal(new Set(a.map((x) => x.traceId)).size, 20, 'no duplicates');
});

test('the pool is traces with no review or no verdict', () => {
  let p = project(60);
  const reviews = {};
  for (let i = 0; i < 30; i++) reviews[`t${String(i).padStart(3, '0')}`] = review(i < 25 ? 'pass' : null, i);
  p = { ...p, reviews };
  const batch = nextBatch(p, { size: 60, strategy: 'random' });
  assert.equal(batch.length, 35);
  assert.ok(batch.every((b) => !p.reviews[b.traceId]?.verdict));
});

test('mix stratifies over details and length, with reasons a reviewer can read', () => {
  const batch = nextBatch(project(), { size: 20, strategy: 'mix', seed: 7 });
  const mixed = batch.filter((b) => b.reason !== 'Random pick');
  assert.equal(mixed.length, 14);
  for (const b of mixed) assert.match(b.reason, /^(sms|web|voice), (short|medium|long) conversation$/);
  assert.ok(new Set(mixed.map((b) => b.reason)).size >= 6, 'spreads across strata');
});

test('at least 30% random picks for every strategy but random', () => {
  const p = project();
  const signal = nextBatch(p, { size: 20, strategy: 'signal', signal: { key: 'channel', value: 'sms' } });
  assert.ok(randomCount(signal) >= 6);
  assert.equal(signal.filter((b) => b.reason === 'Has channel = sms').length, 14);
  const fb = nextBatch(p, { size: 20, strategy: 'signal', signal: { key: 'feedback', value: 'thumbs_down' } });
  assert.equal(fb.filter((b) => b.reason === 'Has feedback = thumbs_down').length, 12, 'all 12 matching traces, the rest random');
  assert.equal(randomCount(fb), 8);
  const out = nextBatch(p, { size: 20, strategy: 'outliers' });
  assert.ok(randomCount(out) >= 6);
  assert.ok(out.some((b) => b.reason === 'Longest 10% of conversations'));
  assert.ok(out.some((b) => b.reason === 'Shortest 10% of conversations'));
});

test('under 50 traces, mix falls back to random picks', () => {
  const small = nextBatch(project(40), { size: 20, strategy: 'mix' });
  assert.equal(small.length, 20);
  assert.equal(randomCount(small), 20);
});

test('flagged and disagree use checks and judge results', () => {
  let p = project();
  p = {
    ...p,
    modes: [{ id: 'fm-x', kind: 'failure', name: 'x', definition: '', stage: null, createdAt: '2026-01-01T00:00:00Z' }],
    checks: [
      { id: 'ck', modeId: 'fm-x', type: 'code', rule: { op: 'contains', target: 'assistant', value: 'sure sure' }, failWhen: 'match' },
      { id: 'jd', modeId: 'fm-x', type: 'judge', results: { t001: { verdict: 'fail' }, t002: { verdict: 'pass' }, t003: { verdict: 'pass' }, t004: { verdict: 'pass' } } },
    ],
    labels: { 'fm-x': { t001: 'pass', t002: 'pass', t003: 'fail', t004: 'fail' } },
    reviews: { t001: review(null, 1), t002: review(null, 2), t003: review(null, 3), t004: review(null, 4) },
    // t003 is in the final test and t004 has no split yet: neither may show where the judge is wrong.
    splits: { 'fm-x': { seed: 7, assign: { t001: 'tuning', t002: 'tuning', t003: 'test' }, revealedAt: null } },
  };
  const flagged = nextBatch(p, { size: 20, strategy: 'flagged' });
  const f = flagged.filter((b) => b.reason === 'Flagged by a check').map((b) => b.traceId);
  assert.equal(f.length, 14);
  assert.ok(f.every((id) => Number(id.slice(1)) % 7 === 0 || id === 't001'));
  const dis = nextBatch(p, { size: 10, strategy: 'disagree' });
  assert.deepEqual(dis.filter((b) => b.reason === 'Judge disagrees with your label').map((b) => b.traceId), ['t001']);
});

test('setBatch and coverage', () => {
  const p = project(9);
  const q = setBatch(p, [{ traceId: 't000', reason: 'Random pick' }], 'random', { now: '2026-09-20T00:00:00Z' });
  assert.deepEqual(q.batch, { createdAt: '2026-09-20T00:00:00Z', strategy: 'random', items: [{ traceId: 't000', reason: 'Random pick' }] });
  assert.equal(setBatch(q, null).batch, null);
  const r = { ...p, reviews: { t000: review('pass', 0), t003: review('fail', 1), t001: review('skip', 2) } };
  assert.deepEqual(coverage(r), { channel: [{ value: 'sms', total: 3, reviewed: 2 }, { value: 'voice', total: 3, reviewed: 0 }, { value: 'web', total: 3, reviewed: 0 }] });
});

test('"Judge disagrees with you" never picks a final test trace before the reveal', async () => {
  const { readFileSync } = await import('node:fs');
  const clinic = JSON.parse(readFileSync(new URL('../../docs/studio/samples/clinic-booking.json', import.meta.url), 'utf8'));
  const picked = nextBatch(clinic, { strategy: 'disagree', seed: 7 }).filter((b) => b.reason === 'Judge disagrees with your label').map((b) => b.traceId);
  assert.deepEqual(picked.sort(), ['t-0137', 't-0139', 't-0141']);
});
