import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMode, updateMode, deleteMode, mergeModes, modeCounts, unassignedNotes, priorityTable, suggestedDecision, setLabel,
  setCritique, toggleCloseCall, assignSplits, validateProject,
} from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace, review } from '../fixtures/build.mjs';

const now = { now: '2026-09-20T12:00:00Z' };

function base() {
  let p = makeProject({ traces: ['a', 'b', 'c', 'd', 'e'].map((id) => chatTrace(id)) });
  let r = addMode(p, { name: 'Ignores requests for a person', definition: 'Fails when the patient asks for a person.', stage: 'act', severity: 'blocks', instructed: 'yes' }, now);
  p = r.project;
  r = addMode(p, { name: 'Ignores requests for a person' }, now);
  p = r.project;
  r = addMode(p, { kind: 'success', name: 'Repeats the booking back', stage: 'answer' }, now);
  p = r.project;
  r = addMode(p, { kind: 'ignore', name: '' }, now);
  p = r.project;
  p.reviews = {
    a: review('fail', 1, { modes: ['fm-ignores-requests-for-a-person'], note: 'Asked twice for the front desk' }),
    b: review('fail', 2, { modes: ['fm-ignores-requests-for-a-person-2'] }),
    c: review('pass', 3, { successModes: ['sm-repeats-the-booking-back'], good: 'Read it back' }),
    d: review('fail', 4, { note: 'Test session', modes: ['nm-not-a-product-problem'] }),
    e: review('fail', 5, { note: '' }),
  };
  return p;
}

test('addMode: slug ids by kind, unique, stage checked', () => {
  const p = base();
  assert.deepEqual(p.modes.map((m) => m.id), ['fm-ignores-requests-for-a-person', 'fm-ignores-requests-for-a-person-2', 'sm-repeats-the-booking-back', 'nm-not-a-product-problem']);
  const m = p.modes[0];
  assert.equal(m.kind, 'failure');
  assert.equal(m.stage, 'act');
  assert.equal(m.createdAt, now.now);
  assert.equal(m.definitionUpdatedAt, null);
  assert.equal(m.source, 'human');
  const bad = addMode(p, { name: 'X', stage: 'no-such-stage' }, now);
  assert.equal(bad.project.modes.find((x) => x.id === bad.id).stage, null);
  assert.equal(suggestedDecision({ instructed: 'no' }), 'fix');
  assert.equal(suggestedDecision({ instructed: 'yes' }), 'check');
  assert.equal(suggestedDecision({ instructed: 'unsure' }), null);
});

test('updateMode: a definition change sets definitionUpdatedAt; ids never change', () => {
  const p = base();
  const q = updateMode(p, 'fm-ignores-requests-for-a-person', { name: 'Ignores a person', id: 'x', kind: 'success' }, { now: '2026-09-21T00:00:00Z' });
  const m = q.modes[0];
  assert.equal(m.id, 'fm-ignores-requests-for-a-person');
  assert.equal(m.kind, 'failure');
  assert.equal(m.name, 'Ignores a person');
  assert.equal(m.definitionUpdatedAt, null);
  const r = updateMode(q, m.id, { definition: 'Fails when the patient asks for a human.' }, { now: '2026-09-22T00:00:00Z' });
  assert.equal(r.modes[0].definitionUpdatedAt, '2026-09-22T00:00:00Z');
  assert.equal(r.modes[1], q.modes[1]);
  assert.equal(updateMode(r, m.id, { name: 'Ignores a person' }), r, 'no change, same project');
});

test('deleteMode removes the mode from reviews, labels, critiques, close calls, splits, checks', () => {
  let p = base();
  const id = 'fm-ignores-requests-for-a-person';
  p = setLabel(p, id, 'c', 'pass', now);
  p = setCritique(p, id, 'a', 'x', now);
  p = toggleCloseCall(p, id, 'c', now);
  p = assignSplits(p, id, {}, now);
  p = { ...p, checks: [{ id: 'ck', modeId: id, type: 'code' }, { id: 'ck2', modeId: 'fm-ignores-requests-for-a-person-2', type: 'code' }], suggestions: [{ id: 's', kind: 'flag', status: 'open', traceId: 'e', modeId: id }] };
  const q = deleteMode(p, id, now);
  assert.equal(q.modes.some((m) => m.id === id), false);
  assert.deepEqual(q.reviews.a.modes, []);
  assert.equal(q.reviews.b, p.reviews.b, 'untouched reviews keep identity');
  for (const key of ['labels', 'critiques', 'closeCalls', 'splits']) assert.equal(id in q[key], false, key);
  assert.deepEqual(q.checks.map((c) => c.id), ['ck2']);
  assert.equal(q.suggestions[0].status, 'dismissed');
  assert.ok(validateProject(q).ok, validateProject(q).errors.join('\n'));
});

test('mergeModes moves review tags, keeps existing labels, moves checks, drops splits', () => {
  let p = base();
  const keep = 'fm-ignores-requests-for-a-person';
  const drop = 'fm-ignores-requests-for-a-person-2';
  p = setLabel(p, keep, 'c', 'pass', now);
  p = setLabel(p, drop, 'c', 'fail', now);
  p = setLabel(p, drop, 'e', 'fail', now);
  p = setCritique(p, drop, 'e', 'why', now);
  p = assignSplits(p, drop, {}, now);
  p = { ...p, checks: [{ id: 'ck', modeId: drop, type: 'judge' }] };
  p.reviews = { ...p.reviews, a: { ...p.reviews.a, modes: [keep, drop] } };
  const q = mergeModes(p, keep, drop, now);
  assert.equal(q.modes.some((m) => m.id === drop), false);
  assert.deepEqual(q.reviews.a.modes, [keep]);
  assert.deepEqual(q.reviews.b.modes, [keep]);
  assert.deepEqual(q.labels[keep], { c: 'pass', e: 'fail' }, 'keep wins where it has a label');
  assert.equal(q.critiques[keep].e, 'why');
  assert.equal(drop in q.labels, false);
  assert.equal(drop in q.splits, false);
  assert.equal(q.checks[0].modeId, keep);
  assert.equal(mergeModes(p, keep, keep), p);
  assert.ok(validateProject(q).ok, validateProject(q).errors.join('\n'));
});

test('modeCounts, unassignedNotes, priorityTable', () => {
  const p = base();
  const counts = modeCounts(p);
  assert.deepEqual(counts.get('fm-ignores-requests-for-a-person'), { traces: 1, traceIds: ['a'], firstHere: 1 });
  assert.equal(counts.get('nm-not-a-product-problem').traces, 1);
  assert.equal(counts.get('sm-repeats-the-booking-back').traces, 1);
  assert.deepEqual(unassignedNotes(p), [{ traceId: 'e', note: '(no note yet)', hasNote: false, stage: null }]);
  assert.deepEqual(unassignedNotes(base(), 'success'), [], 'Good notes that already have a success mode are sorted');
  const q = { ...p, reviews: { ...p.reviews, c: { ...p.reviews.c, successModes: [] } } };
  assert.deepEqual(unassignedNotes(q, 'success'), [{ traceId: 'c', note: 'Read it back', hasNote: true, stage: null }]);
  const table = priorityTable(p);
  // Counted: a, b, c, e (d is only "Not a product problem"). a: 1 x Blocks 3; b: 1 x unset (1).
  assert.deepEqual(table.map((r) => [r.mode.id, r.traces, r.priority, r.share]), [
    ['fm-ignores-requests-for-a-person', 1, 3, 0.25],
    ['fm-ignores-requests-for-a-person-2', 1, 1, 0.25],
  ]);
});
