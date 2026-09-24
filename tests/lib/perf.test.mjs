import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAll, setNote, reviewStats, filterTraces, computeFunnel, searchIndex, orderedReviews } from '../../docs/studio/lib/index.mjs';
import { makeTraces } from '../fixtures/perf-traces.mjs';
import { makeProject, review } from '../fixtures/build.mjs';

const ms = (fn) => {
  const t = performance.now();
  const value = fn();
  return { value, took: performance.now() - t };
};

test('20,000 traces stay fast', () => {
  const traces = makeTraces(20000, 7);
  const stages = [
    { id: 'understand', label: 'Understand the request', column: 'understand', match: {} },
    { id: 'lookup', label: 'Check the calendar', column: 'gather', match: { tools: ['find_slots', 'get_patient'] } },
    { id: 'act', label: 'Book or change', column: 'act', match: { tools: ['book_appointment'] } },
    { id: 'reply', label: 'Reply', column: 'answer', match: { last: 'assistant' } },
  ];
  const modes = [
    { id: 'fm-a', kind: 'failure', name: 'A', definition: '', stage: 'lookup', severity: 'blocks', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'fm-b', kind: 'failure', name: 'B', definition: '', stage: 'reply', severity: 'annoys', createdAt: '2026-09-01T00:00:00Z' },
  ];
  const reviews = {};
  for (let i = 0; i < 2000; i++) {
    const id = traces[i * 10].id;
    reviews[id] = i % 3 ? review('pass', i) : review('fail', i, { note: `note ${i}`, modes: [i % 2 ? 'fm-a' : 'fm-b'] });
  }
  const p = makeProject({ traces, stages, filters: ['channel', 'persona'], modes, reviews });

  const norm = ms(() => normalizeAll(p));
  assert.equal(norm.value.size, 20000);
  assert.ok(norm.took < 3000, `normalizeAll took ${Math.round(norm.took)} ms`);

  // Warm the memoized indexes the Review view uses.
  searchIndex(p);
  filterTraces(p, { status: 'todo', meta: { channel: 'sms' } });
  reviewStats(p);
  orderedReviews(p);

  const edit = ms(() => {
    const q = setNote(p, traces[5].id, 'Asked twice for the front desk');
    reviewStats(q);
    return filterTraces(q, { status: 'todo', meta: { channel: 'sms' }, text: 'cleaning' });
  });
  assert.ok(edit.value.length > 0);
  assert.ok(edit.took < 50, `setNote + reviewStats + filterTraces took ${Math.round(edit.took)} ms`);

  const funnel = ms(() => computeFunnel(setNote(p, traces[5].id, 'x')));
  assert.equal(funnel.value.counted, 2000);
  assert.equal(funnel.value.stages[funnel.value.stages.length - 1].onTrack - funnel.value.stages[funnel.value.stages.length - 1].failedHere, funnel.value.passed);
  assert.ok(funnel.took < 300, `computeFunnel took ${Math.round(funnel.took)} ms`);
});
