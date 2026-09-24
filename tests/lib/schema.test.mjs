import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT, createProject, validateProject, slugId, cloneProject, projectForDisk, projectForDownload, mergeExternal, defaultExperience,
} from '../../docs/studio/lib/index.mjs';
import { fixtureJson } from '../fixtures/build.mjs';

test('createProject fills every field of pmstack.project/1', () => {
  const p = createProject({ id: 'demo', name: 'Demo', traces: [{ id: 'a' }], now: '2026-09-20T00:00:00Z' });
  assert.equal(p.format, FORMAT);
  assert.equal(p.revision, 1);
  assert.equal(p.createdAt, '2026-09-20T00:00:00Z');
  assert.equal(p.experience.gate, 10);
  assert.deepEqual([p.tracesFile, p.batch, p.settings], [null, null, { seed: 7 }]);
  for (const k of ['reviews', 'labels', 'critiques', 'closeCalls', 'splits']) assert.deepEqual(p[k], {});
  for (const k of ['modes', 'checks', 'suggestions']) assert.deepEqual(p[k], []);
  assert.deepEqual(validateProject(p), { ok: true, errors: [] });
  assert.equal(createProject({ name: 'Maple Dental: booking!' }).id, 'maple-dental-booking');
});

test('slugId: prefix, plain slug, uniqueness', () => {
  assert.equal(slugId('fm', 'Stray ** symbols in texts', []), 'fm-stray-symbols-in-texts');
  assert.equal(slugId('fm', 'Caf\u00E9 menu', []), 'fm-cafe-menu');
  assert.equal(slugId('sm', '', []), 'sm-untitled');
  assert.equal(slugId('fm', 'X', ['fm-x', 'fm-x-2']), 'fm-x-3');
  assert.equal(slugId('ck', 'X', new Set(['ck-x'])), 'ck-x-2');
});

test('validateProject reports plain errors', () => {
  const p = fixtureJson('funnel-project.json');
  assert.deepEqual(validateProject(p), { ok: true, errors: [] });
  const bad = cloneProject(p);
  bad.reviews['t-9'] = { verdict: 'fail', stage: 'nowhere', modes: ['fm-missing'] };
  bad.reviews.t1.verdict = 'maybe';
  bad.experience.stages.push({ id: 'unknown', label: 'Reserved', match: {} }, { id: 'odd', label: 'Odd pattern', match: { namePattern: '(' } });
  bad.labels = { 'sm-x': { t1: 'pass' }, 'fm-a': { t2: 'yes' } };
  bad.checks.push({ id: 'ck-orphan', name: 'Orphan', modeId: 'fm-gone', type: 'code' });
  bad.splits = { 'fm-gone': { assign: {} } };
  const { ok, errors } = validateProject(bad);
  assert.equal(ok, false);
  for (const e of [
    'Review for "t-9" points to a trace that does not exist.',
    'Review for "t-9" uses stage "nowhere", which does not exist.',
    'Review for "t-9" uses mode "fm-missing", which does not exist.',
    'Review for "t1" has an unknown verdict "maybe".',
    'Stage id "unknown" is reserved. Pick another id.',
    'Stage "Odd pattern": the name pattern "(" is not valid, so it is skipped.',
    'Labels for "X reads it back" are on a mode that is not a failure mode.',
    'Label for "t2" on "fm-a" must be pass or fail.',
    'Check "Orphan" points to a failure mode that does not exist.',
    'Splits for "fm-gone" point to a failure mode that does not exist.',
  ]) assert.ok(errors.includes(e), `missing: ${e}\n${errors.join('\n')}`);
  assert.deepEqual(validateProject(null).errors, ['This file is not a pmstack project.']);
  assert.match(validateProject({ format: 'other' }).errors[0], /not a pmstack project/);
});

test('traces may be missing when they live in a trace file', () => {
  const p = { ...createProject({ id: 'x', traces: [] }), tracesFile: '../traces.jsonl' };
  const { traces, ...noTraces } = p;
  assert.equal(validateProject(noTraces, { tracesLoaded: false }).ok, true);
  assert.equal(validateProject(noTraces).ok, false);
  const disk = projectForDisk({ ...p, traces: [{ id: 'a' }] });
  assert.equal('traces' in disk, false);
  const inline = createProject({ id: 'y', traces: [{ id: 'a' }] });
  assert.equal(projectForDisk(inline), inline);
  const dl = projectForDownload({ ...p, traces: [{ id: 'a' }] });
  assert.equal(dl.tracesFile, null);
  assert.deepEqual(dl.traces, [{ id: 'a' }]);
});

test('cloneProject makes an independent copy', () => {
  const p = fixtureJson('funnel-project.json');
  const c = cloneProject(p);
  assert.deepEqual(c, p);
  c.reviews.t1.note = 'changed';
  assert.notEqual(p.reviews.t1.note, 'changed');
});

test('mergeExternal: disk first, local dirty keys, checks merged per id', () => {
  const base = { ...createProject({ id: 'm', traces: [{ id: 'a' }] }), experience: defaultExperience({}) };
  const local = {
    ...base, revision: 3, name: 'Local name', reviews: { a: { verdict: 'fail', note: 'local note' } },
    checks: [
      { id: 'ck-1', modeId: 'fm', type: 'judge', prompt: 'local prompt', model: 'm-local', results: {}, runs: [], unreadable: [], test: null },
      { id: 'ck-local', modeId: 'fm', type: 'code', rule: {} },
    ],
  };
  const disk = {
    ...projectForDisk({ ...base, tracesFile: '../traces.jsonl' }), revision: 5, name: 'Disk name', reviews: {}, labels: { fm: { a: 'fail' } },
    checks: [
      { id: 'ck-1', modeId: 'fm', type: 'judge', prompt: 'disk prompt', model: 'm-disk', results: { a: { verdict: 'fail' } }, runs: [{ n: 3 }], unreadable: ['b'], test: { revealedAt: 'x' } },
      { id: 'ck-disk', modeId: 'fm', type: 'code', rule: {} },
    ],
  };
  const m = mergeExternal(local, disk, new Set(['reviews', 'checks']));
  assert.equal(m.revision, 5);
  assert.equal(m.name, 'Disk name', 'clean keys come from disk');
  assert.deepEqual(m.reviews, local.reviews, 'dirty keys come from local');
  assert.deepEqual(m.labels, disk.labels);
  assert.equal(m.traces, local.traces, 'traces stay loaded when the disk copy has none');
  assert.deepEqual(m.checks.map((c) => c.id), ['ck-1', 'ck-local', 'ck-disk']);
  const c1 = m.checks[0];
  assert.deepEqual([c1.prompt, c1.model], ['local prompt', 'm-local'], 'edits come from local');
  assert.deepEqual([c1.results, c1.runs, c1.unreadable, c1.test], [disk.checks[0].results, disk.checks[0].runs, ['b'], { revealedAt: 'x' }], 'results come from disk');
  const clean = mergeExternal(local, disk, []);
  assert.equal(clean.checks, disk.checks, 'checks not dirty: disk wins, CLI results kept');
  assert.equal(clean.name, 'Disk name');
});

test('mergeExternal: a final test revealed on disk stays revealed when the local copy changed splits', () => {
  const modes = [{ id: 'fm-a', kind: 'failure', name: 'A' }, { id: 'fm-b', kind: 'failure', name: 'B' }, { id: 'fm-c', kind: 'failure', name: 'C' }];
  const base = { ...createProject({ id: 'm', traces: [] }), modes };
  const disk = {
    ...base, revision: 6,
    splits: {
      'fm-a': { seed: 7, assign: { t1: 'test', t2: 'tuning' }, revealedAt: '2026-09-20T12:00:00Z' },
      'fm-b': { seed: 7, assign: { t1: 'tuning' }, revealedAt: null },
      'fm-c': { seed: 7, assign: { t9: 'test' }, revealedAt: null },
    },
  };
  // The local copy never saw the reveal, and just assigned t3 on the same mode and t4 on another.
  const local = {
    ...base, revision: 5,
    splits: {
      'fm-a': { seed: 7, assign: { t1: 'test', t2: 'tuning', t3: 'test' }, revealedAt: null },
      'fm-b': { seed: 7, assign: { t1: 'tuning', t4: 'test' }, revealedAt: null },
    },
  };
  const m = mergeExternal(local, disk, ['labels', 'splits']);
  assert.deepEqual(m.splits['fm-a'], { seed: 7, assign: { t1: 'test', t2: 'tuning', t3: 'tuning' }, revealedAt: '2026-09-20T12:00:00Z', afterReveal: ['t3'] }, 'a new label joins tuning after the reveal');
  assert.deepEqual(m.splits['fm-b'], local.splits['fm-b'], 'a mode without a reveal takes the local entry');
  assert.deepEqual(m.splits['fm-c'], disk.splits['fm-c'], 'a mode only on disk is kept');
  const deleted = mergeExternal({ ...local, modes: modes.slice(0, 2) }, disk, ['modes', 'splits']);
  assert.equal('fm-c' in deleted.splits, false, 'a mode deleted locally does not come back through its splits');
});

test('validateProject: parts of the wrong shape are errors, not blank pages', () => {
  const p = fixtureJson('funnel-project.json');
  const errors = validateProject({ ...p, checks: {}, experience: { ...p.experience, filters: 'channel' }, reviews: [], labels: 'x', splits: [] }).errors;
  assert.deepEqual(errors, [
    'The product setup\'s filters are not a list.',
    'The reviews are not stored by trace id.',
    'The labels are not stored by failure mode.',
    'The splits are not stored by failure mode.',
    'The checks are not a list.',
  ]);
  assert.deepEqual(validateProject({ ...p, checks: 'x' }).errors, ['The checks are not a list.']);
});
