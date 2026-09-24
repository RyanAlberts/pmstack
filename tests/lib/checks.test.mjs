import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATORS, TARGETS, COMMON_PATTERNS, runCheck, runChecks, targetText, checkAgreement, checkTestState, revealTest, recordRun,
  addCheck, updateCheck, deleteCheck, setJudgeResults, likelyFailureRate, normalizeTrace, defaultExperience,
  setLabel, assignSplits, splitOf, updateMode, labelsHash, isDraftCheck, reportModel, ciChecks,
} from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace } from '../fixtures/build.mjs';

const now = { now: '2026-09-20T12:00:00Z' };
const exp = defaultExperience({ pattern: 'augmented', userLabel: 'patient' });
const trace = normalizeTrace({
  id: 'op', metadata: { channel: 'sms', tier: 'gold' },
  messages: [
    { role: 'user', content: 'Can I use my insurance for a cleaning?' },
    { role: 'assistant', content: 'Let me check.', tool_calls: [{ id: 'c1', function: { name: 'find_slots', arguments: '{}' } }, { id: 'c2', function: { name: 'find_slots', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{}' },
    { role: 'assistant', content: 'Your **copay** is $20. Call 555-123-4567.' },
  ],
  result: { booked: true },
}, exp);
const run = (rule, extra = {}) => runCheck({ type: 'code', rule, failWhen: 'match', ...extra }, trace);

test('operator and target lists match the spec', () => {
  assert.deepEqual(OPERATORS.map((o) => o.id), ['regex', 'contains', 'contains-any', 'not-contains', 'max-chars', 'min-chars', 'json-valid', 'tool-called', 'tool-not-called', 'tool-count-max', 'field-equals', 'field-exists', 'grounded-values', 'success-after-error']);
  assert.equal(OPERATORS.find((o) => o.id === 'contains-any').label, 'Text contains any of (comma-separated)');
  assert.deepEqual(TARGETS.map((t) => t.id), ['output', 'assistant', 'last-assistant', 'user', 'all', 'field']);
  assert.deepEqual(COMMON_PATTERNS.map((c) => c.label), ['Formatting symbols', 'Email address', 'Phone number', 'Link', 'Dollar amount']);
  for (const c of COMMON_PATTERNS) assert.doesNotThrow(() => new RegExp(c.value, c.flags));
});

test('targets read the right text', () => {
  assert.equal(targetText(trace, 'output'), 'Your **copay** is $20. Call 555-123-4567.');
  assert.equal(targetText(trace, 'assistant'), 'Let me check.\n\nYour **copay** is $20. Call 555-123-4567.');
  assert.equal(targetText(trace, 'last-assistant'), 'Your **copay** is $20. Call 555-123-4567.');
  assert.equal(targetText(trace, 'user'), 'Can I use my insurance for a cleaning?');
  assert.match(targetText(trace, 'all'), /\[Tool call find_slots\]/);
  assert.equal(targetText(trace, 'field:result.booked'), 'true');
  assert.equal(targetText(trace, 'field:metadata.channel'), 'sms');
  const long = normalizeTrace({ id: 'l', input: 'q', output: 'x'.repeat(150000) }, exp);
  assert.equal(targetText(long, 'output').length, 100000, 'capped at 100,000 characters');
});

test('every operator', () => {
  assert.deepEqual(run({ op: 'regex', target: 'output', value: '\\*\\*' }), { verdict: 'fail', detail: 'Found "**"' });
  assert.equal(run({ op: 'regex', target: 'output', value: 'booked' }, { failWhen: 'no-match' }).verdict, 'fail');
  assert.equal(run({ op: 'regex', target: 'output', value: 'copay' }, { failWhen: 'no-match' }).verdict, 'pass');
  assert.equal(run({ op: 'regex', target: 'output', value: COMMON_PATTERNS[2].value }).verdict, 'fail', 'phone number');
  assert.deepEqual(run({ op: 'contains', target: 'output', value: 'COPAY' }), { verdict: 'fail', detail: 'Found "COPAY"' });
  assert.equal(run({ op: 'contains', target: 'output', value: 'refund' }).verdict, 'pass');
  assert.equal(run({ op: 'contains-any', target: 'assistant', value: 'insurance, bill' }).verdict, 'pass');
  assert.deepEqual(run({ op: 'contains-any', target: 'user', value: 'bill,  insurance ' }), { verdict: 'fail', detail: 'Found "insurance"' });
  assert.equal(run({ op: 'not-contains', target: 'output', value: 'refund' }).verdict, 'fail');
  assert.equal(run({ op: 'not-contains', target: 'output', value: 'copay' }).verdict, 'pass');
  assert.deepEqual(run({ op: 'max-chars', target: 'output', value: 10 }), { verdict: 'fail', detail: '41 characters' });
  assert.equal(run({ op: 'max-chars', target: 'output', value: '100' }).verdict, 'pass');
  assert.equal(run({ op: 'min-chars', target: 'output', n: 1000 }).verdict, 'fail');
  assert.equal(run({ op: 'json-valid', target: 'field:metadata' }).verdict, 'fail');
  assert.equal(run({ op: 'json-valid', target: 'output' }, { failWhen: 'no-match' }).verdict, 'fail');
  assert.deepEqual(run({ op: 'tool-called', value: 'find_slots' }), { verdict: 'fail', detail: 'Used find_slots 2 times' });
  assert.equal(run({ op: 'tool-called', value: 'book_appointment' }).verdict, 'pass');
  assert.equal(run({ op: 'tool-not-called', value: 'book_appointment' }).verdict, 'fail');
  assert.equal(run({ op: 'tool-count-max', value: 'find_slots', n: 1 }).verdict, 'fail');
  assert.equal(run({ op: 'tool-count-max', value: 'find_slots', n: 2 }).verdict, 'pass');
  assert.deepEqual(run({ op: 'field-equals', target: 'field:metadata.tier', value: 'gold' }), { verdict: 'fail', detail: 'metadata.tier is "gold"' });
  assert.equal(run({ op: 'field-equals', target: 'field:metadata.tier', value: 'silver' }).verdict, 'pass');
  assert.equal(run({ op: 'field-exists', target: 'field:result.booked' }).verdict, 'fail');
  assert.deepEqual(run({ op: 'field-exists', target: 'field:result.nope' }), { verdict: 'pass', detail: 'result.nope is missing' });
});

test('when limits a check to matching traces; errors are plain', () => {
  const rule = { op: 'regex', target: 'assistant', value: '\\*\\*' };
  assert.deepEqual(run(rule, { when: { path: 'metadata.channel', equals: 'web' } }), { verdict: 'pass', detail: 'Does not apply' });
  assert.equal(run(rule, { when: { path: 'metadata.channel', equals: 'sms' } }).verdict, 'fail');
  const bad = run({ op: 'regex', target: 'output', value: '(' });
  assert.equal(bad.verdict, 'error');
  assert.match(bad.detail, /^The pattern is not valid: /);
  assert.equal(run({ op: 'regex', target: 'output', value: 'x', flags: 'zz' }).verdict, 'pass', 'unknown flags are dropped');
  assert.deepEqual(run({ op: 'nope' }), { verdict: 'error', detail: 'This check has an unknown rule.' });
  assert.equal(run({ op: 'contains', target: 'output', value: '' }).verdict, 'error');
});

function project() {
  const traces = Array.from({ length: 60 }, (_, i) => {
    const id = `t${String(i).padStart(2, '0')}`;
    const stars = i < 12;
    return chatTrace(id, [['user', 'Move my visit'], ['assistant', stars ? 'Friday at **9:30**' : 'Friday at 9:30']], { channel: i % 3 ? 'sms' : 'web' });
  });
  let p = makeProject({ traces, filters: ['channel'] });
  p = { ...p, modes: [{ id: 'fm-x', kind: 'failure', name: 'Stray symbols', definition: 'Fails when a text shows **.', stage: 'answer', severity: 'annoys', createdAt: '2026-09-15T00:00:00Z', definitionUpdatedAt: null, fixedAt: null, source: 'human' }] };
  for (let i = 0; i < 40; i++) p = setLabel(p, 'fm-x', `t${String(i).padStart(2, '0')}`, i < 12 ? 'fail' : 'pass', now);
  return assignSplits(p, 'fm-x', { seed: 7 }, now);
}

test('runChecks: code checks, only CI, pass every check', () => {
  let p = project();
  p = addCheck(p, { modeId: 'fm-x', type: 'code', name: 'No stars', rule: { op: 'regex', target: 'assistant', value: '\\*\\*' }, ci: true }, now).project;
  p = addCheck(p, { modeId: 'fm-x', type: 'code', name: 'Short', rule: { op: 'max-chars', target: 'output', value: 14 } }, now).project;
  p = addCheck(p, { modeId: 'fm-x', type: 'judge', name: 'Judge' }, now).project;
  assert.deepEqual(p.checks.map((c) => c.id), ['ck-no-stars', 'ck-short', 'ck-judge']);
  const all = runChecks(p);
  assert.deepEqual(all.summary, [{ checkId: 'ck-no-stars', pass: 48, fail: 12, error: 0 }, { checkId: 'ck-short', pass: 48, fail: 12, error: 0 }]);
  assert.equal(all.passAll, 48);
  assert.equal(all.total, 60);
  assert.equal(all.byCheck['ck-no-stars'].t00, 'fail');
  const ci = runChecks(p, { onlyCi: true });
  assert.deepEqual(Object.keys(ci.byCheck), ['ck-no-stars']);
  assert.equal(runChecks(p, { traceIds: ['t00', 't50'] }).passAll, 1);
});

test('code check agreement uses every labeled trace; split is ignored', () => {
  let p = project();
  // Flags t00..t11 (the 12 Problems) plus nothing else, then break one label on purpose.
  p = addCheck(p, { modeId: 'fm-x', type: 'code', rule: { op: 'regex', target: 'assistant', value: '\\*\\*' } }, now).project;
  p = setLabel(p, 'fm-x', 't11', 'pass', now);
  const a = checkAgreement(p, p.checks[0].id, { split: 'test' });
  assert.equal(a.split, null);
  assert.deepEqual([a.n, a.nFail, a.nPass, a.tn, a.fn], [40, 11, 29, 11, 1]);
  assert.deepEqual(a.falseFails, ['t11']);
  const broken = updateCheck(p, p.checks[0].id, { rule: { op: 'regex', target: 'assistant', value: '(' } }, now);
  assert.equal(checkAgreement(broken, p.checks[0].id).errors.length, 40);
});

function judged() {
  let p = project();
  p = addCheck(p, { modeId: 'fm-x', type: 'judge', name: 'Stray symbols judge', prompt: 'Judge this {{trace}}', model: 'claude-haiku-4-5-20251001', inputs: ['customer'] }, now).project;
  const results = {};
  for (let i = 0; i < 60; i++) {
    const id = `t${String(i).padStart(2, '0')}`;
    // The judge misses t00 and flags t20 and t45; everything else matches the truth.
    results[id] = { verdict: (i < 12 && i !== 0) || i === 20 || i === 45 ? 'fail' : 'pass', critique: 'x' };
  }
  return setJudgeResults(p, 'ck-stray-symbols-judge', results, now);
}

test('judge agreement: tuning only by default, examples never, final test locked until revealed', () => {
  const p = judged();
  const id = 'ck-stray-symbols-judge';
  const tuning = checkAgreement(p, id);
  assert.equal(tuning.split, 'tuning');
  const inTuning = Object.entries(p.splits['fm-x'].assign).filter(([, s]) => s === 'tuning').length;
  assert.equal(tuning.n, inTuning);
  const locked = checkAgreement(p, id, { split: 'test' });
  assert.deepEqual([locked.locked, locked.n], [true, 0]);
  assert.equal(checkTestState(p, id), 'hidden');
  const q = revealTest(p, id, { now: '2026-09-21T00:00:00Z' });
  assert.equal(q.splits['fm-x'].revealedAt, '2026-09-21T00:00:00Z');
  assert.equal(q.checks[0].test.model, 'claude-haiku-4-5-20251001');
  assert.equal(checkTestState(q, id), 'current');
  const t = checkAgreement(q, id, { split: 'test' });
  assert.equal(t.split, 'test');
  assert.equal(t.n, Object.values(q.splits['fm-x'].assign).filter((s) => s === 'test').length);
  const examples = Object.keys(q.splits['fm-x'].assign).filter((k) => q.splits['fm-x'].assign[k] === 'examples');
  assert.ok(examples.every((e) => !t.falsePasses.includes(e) && !tuning.falsePasses.includes(e)));
  const missed = splitOf(q, 'fm-x', 't00');
  assert.ok((missed === 'test' ? t : missed === 'tuning' ? tuning : { falsePasses: ['t00'] }).falsePasses.includes('t00'));
});

test('test state turns outdated when the prompt, model, test labels, or definition change', () => {
  const id = 'ck-stray-symbols-judge';
  const q = revealTest(judged(), id, now);
  assert.equal(checkTestState(updateCheck(q, id, { prompt: 'New prompt {{trace}}' }), id), 'outdated');
  assert.equal(checkTestState(updateCheck(q, id, { model: 'another-model' }), id), 'outdated');
  assert.equal(checkTestState(updateCheck(q, id, { inputs: ['customer', 'tools'] }), id), 'outdated');
  assert.equal(checkTestState(updateMode(q, 'fm-x', { definition: 'Fails when a text shows ** or #.' }), id), 'outdated');
  const testId = Object.keys(q.splits['fm-x'].assign).find((k) => q.splits['fm-x'].assign[k] === 'test');
  const flipped = { ...q, labels: { ...q.labels, 'fm-x': { ...q.labels['fm-x'], [testId]: q.labels['fm-x'][testId] === 'pass' ? 'fail' : 'pass' } } };
  assert.notEqual(labelsHash(flipped, 'fm-x'), labelsHash(q, 'fm-x'));
  assert.equal(checkTestState(flipped, id), 'outdated');
  assert.equal(checkTestState(updateCheck(q, id, { name: 'Renamed' }), id), 'current', 'a new name changes nothing');
});

test('a revealed final test is never revealed again, so "out of date" stays out of date', () => {
  const id = 'ck-stray-symbols-judge';
  const edited = updateCheck(revealTest(judged(), id, now), id, { prompt: 'New prompt {{trace}}' });
  assert.equal(checkTestState(edited, id), 'outdated');
  const again = revealTest(edited, id, { now: '2026-09-30T00:00:00Z' });
  assert.equal(again, edited, 'unchanged');
  assert.equal(checkTestState(again, id), 'outdated');
});

test('recordRun appends agreement rounds', () => {
  const id = 'ck-stray-symbols-judge';
  let p = judged();
  p = recordRun(p, id, 'tuning', { now: '2026-09-20T13:00:00Z' });
  const run1 = p.checks[0].runs[0];
  assert.equal(run1.split, 'tuning');
  assert.equal(run1.model, 'claude-haiku-4-5-20251001');
  assert.equal(run1.n, checkAgreement(p, id).n);
  assert.equal(recordRun(p, id, 'test'), p, 'nothing to record while the final test is locked');
});

test('setJudgeResults keeps unreadable answers apart', () => {
  const id = 'ck-stray-symbols-judge';
  let p = judged();
  const tuningId = Object.keys(p.splits['fm-x'].assign).find((k) => p.splits['fm-x'].assign[k] === 'tuning');
  p = setJudgeResults(p, id, { [tuningId]: 'I could not decide.', t50: '```json\n{"critique": "Plain text", "result": "Pass"}\n```' }, now);
  assert.deepEqual(p.checks[0].unreadable, [tuningId]);
  assert.equal(p.checks[0].results[tuningId], undefined);
  assert.deepEqual(p.checks[0].results.t50, { verdict: 'pass', critique: 'Plain text', at: now.now });
  assert.deepEqual(checkAgreement(p, id).unreadable, [tuningId]);
  p = setJudgeResults(p, id, { [tuningId]: { verdict: 'fail', critique: 'ok' } }, now);
  assert.deepEqual(p.checks[0].unreadable, []);
});

test('likely true failure rate needs a current final test and results on unlabeled traces', () => {
  const id = 'ck-stray-symbols-judge';
  const p = judged();
  assert.equal(likelyFailureRate(p, id).reason, 'Reveal the final test first.');
  const q = revealTest(p, id, now);
  const r = likelyFailureRate(q, id);
  assert.equal(r.population, 20);
  assert.equal(r.judged, 20);
  assert.equal(r.flagged, 1 / 20, 't45 is the only unlabeled trace the judge flagged');
  assert.ok(r.low <= r.estimate && r.estimate <= r.high || r.low == null);
  const stale = updateCheck(q, id, { model: 'other' });
  assert.equal(likelyFailureRate(stale, id).reason, 'Label new traces for a fresh final test.');
});

test('addCheck, updateCheck, deleteCheck', () => {
  let p = project();
  const made = addCheck(p, { modeId: 'fm-x', type: 'code' }, now);
  p = made.project;
  assert.equal(made.id, 'ck-stray-symbols');
  assert.deepEqual(p.checks[0].rule, { op: 'regex', target: 'output', value: '', flags: '' });
  assert.equal(p.checks[0].failWhen, 'match');
  const same = updateCheck(p, made.id, { name: p.checks[0].name });
  assert.equal(same, p);
  p = updateCheck(p, made.id, { ci: true, type: 'judge' }, now);
  assert.equal(p.checks[0].type, 'code');
  assert.equal(p.checks[0].ci, true);
  p = deleteCheck(p, made.id, now);
  assert.deepEqual(p.checks, []);
});

test('a new code check with no rule yet is a draft: it measures nothing and stays out of runs and downloads', () => {
  let p = project();
  p = addCheck(p, { modeId: 'fm-x', type: 'code', ci: true }, now).project;
  const id = p.checks[0].id;
  assert.equal(isDraftCheck(p.checks[0]), true);
  assert.equal(checkAgreement(p, id).n, 0);
  assert.deepEqual(runChecks(p).summary, []);
  assert.deepEqual(reportModel(p).checks, []);
  assert.deepEqual(ciChecks(p).checks, []);
  for (const rule of [{ op: 'max-chars', value: '' }, { op: 'tool-count-max', value: 'find_slots' }, { op: 'field-exists', target: 'field:' }]) {
    assert.equal(isDraftCheck({ type: 'code', rule }), true, rule.op);
  }
  assert.equal(isDraftCheck({ type: 'code', rule: { op: 'json-valid' } }), false);
  assert.equal(isDraftCheck({ type: 'code', rule: { op: 'tool-called', value: '' } }), false);
  p = updateCheck(p, id, { rule: { op: 'regex', target: 'assistant', value: '\\*\\*' } }, now);
  assert.equal(isDraftCheck(p.checks[0]), false);
  assert.equal(checkAgreement(p, id).n, 40);
  assert.equal(ciChecks(p).checks.length, 1);
});

test('judge agreement places labels that have no split yet the way assignSplits will', () => {
  const p = judged();
  const id = 'ck-stray-symbols-judge';
  // New labels after the splits were saved: agreement counts them exactly as the saved splits would.
  let next = p;
  const added = Array.from({ length: 10 }, (_, i) => `t${40 + i}`);
  for (const t of added) next = setLabel(next, 'fm-x', t, 'pass', now);
  assert.equal(splitOf(next, 'fm-x', 't45'), null);
  const saved = assignSplits(next, 'fm-x');
  const inTuning = added.filter((t) => splitOf(saved, 'fm-x', t) === 'tuning').length;
  assert.ok(inTuning > 0);
  assert.equal(checkAgreement(next, id).n, checkAgreement(p, id).n + inTuning);
  assert.deepEqual(checkAgreement(next, id), checkAgreement(saved, id));
});
