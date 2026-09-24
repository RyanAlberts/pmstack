import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, markdownReport, regressionSet, ciChecks } from '../../docs/studio/lib/index.mjs';
import { fixtureJson, makeProject, chatTrace, review } from '../fixtures/build.mjs';

const now = '2026-09-24T10:00:00Z';

// 170 traces, 100 counted reviews (64 Good, 36 Problem) plus 2 set aside as not a product problem, shaped like the dental sample.
function clinicLike() {
  const traces = Array.from({ length: 170 }, (_, i) => chatTrace(`t${String(i).padStart(3, '0')}`));
  const mode = (id, name, severity) => ({ id, kind: 'failure', name, definition: `Fails when ${name}.`, stage: null, severity, decision: 'check', createdAt: '2026-09-15T00:00:00Z' });
  const modes = [
    mode('fm-asks', 'Asks again for details given', 'annoys'), mode('fm-person', 'Ignores requests for a person', 'blocks'),
    mode('fm-billing', 'Answers billing questions itself', 'hurts'), mode('fm-taken', 'Offers a time that is taken', 'blocks'),
    mode('fm-books', 'Books before the patient confirms', 'hurts'), mode('fm-stray', 'Stray ** symbols in texts', 'annoys'),
    { id: 'nm-not-a-product-problem', kind: 'ignore', name: 'Not a product problem', definition: 'Test sessions.', stage: null, createdAt: '2026-09-15T00:00:00Z' },
  ];
  const counts = { 'fm-asks': 4, 'fm-person': 7, 'fm-billing': 5, 'fm-taken': 5, 'fm-books': 6, 'fm-stray': 9 };
  const reviews = {};
  let i = 0;
  for (const [id, n] of Object.entries(counts)) for (let k = 0; k < n; k++, i++) reviews[`t${String(i).padStart(3, '0')}`] = review('fail', i, { modes: [id] });
  for (; i < 100; i++) reviews[`t${String(i).padStart(3, '0')}`] = review('pass', i);
  for (; i < 102; i++) reviews[`t${String(i).padStart(3, '0')}`] = review('fail', i, { modes: ['nm-not-a-product-problem'] });
  return makeProject({ traces, modes, reviews });
}

test('summary sentence follows the spec wording', () => {
  const m = reportModel(clinicLike(), { now });
  assert.equal(m.summary, 'You reviewed 102 of 170 traces. 36 had a problem, and 2 were set aside as not a product problem. The biggest failure mode is Ignores requests for a person (7 traces, 7%), which blocks the patient.');
  assert.deepEqual([m.stats.reviewed, m.stats.counted, m.stats.ignored], [102, 100, 2]);
  assert.equal(m.date, '2026-09-24');
  assert.equal(m.failureModes[0].name, 'Ignores requests for a person');
  assert.equal(reportModel(makeProject({ traces: [chatTrace('a')] })).summary, 'You have not reviewed any traces yet.');
});

test('report model on the funnel fixture', () => {
  const p = fixtureJson('funnel-project.json');
  const m = reportModel(p, { now });
  assert.equal(m.title, 'Funnel fixture: what we found');
  assert.equal(m.summary, 'You reviewed 14 of 17 traces. 8 had a problem, and 1 was set aside as not a product problem. The biggest failure mode is B offers a taken slot (3 traces, 23%), which blocks the patient.');
  assert.deepEqual(m.funnelRows.map((r) => [r.number, r.onTrack, r.failedHere]), [[1, 12, 1], [2, 11, 2], [3, 9, 2], [4, 7, 2]]);
  assert.deepEqual(m.outcome, { passed: 5, counted: 13, unknown: 1, ignored: 1 });
  assert.deepEqual(m.failureModes.map((f) => [f.id, f.priority, f.severityLabel, f.decisionLabel]), [
    ['fm-b', 9, 'Blocks', 'Build a check'], ['fm-c', 4, 'Hurts', 'Fix it now'], ['fm-a', 2, 'Annoys', 'Keep watching'], ['fm-d', 2, 'Annoys', 'Build a check'],
  ]);
  assert.deepEqual(m.failureModes[0].quotes, ['Offered a taken slot', 'Taken slot, then booked it anyway']);
  assert.deepEqual(m.successModes.map((s) => [s.id, s.traces]), [['sm-y', 2], ['sm-x', 2]]);
  const ck = m.checks[0];
  assert.deepEqual([ck.typeLabel, ck.split, ck.ci, ck.fails, ck.total], ['Code check', 'all labels', true, 0, 17]);
  assert.equal(m.passAll.sentence, '17 of 17 traces pass every check that runs on every change.');
  assert.deepEqual(m.versions.versions, ['v1', 'v2']);
  const d = m.versions.rows.find((r) => r.modeId === 'fm-d');
  assert.deepEqual(d.cells.map((c) => [c.version, c.reviewed, c.traces, c.checkFails, c.checkTotal]), [['v1', 10, 1, 0, 10], ['v2', 3, 1, 0, 7]]);
  assert.deepEqual(m.nextSteps.map((s) => [s.modeId, s.text]), [
    ['fm-b', 'Build or finish the check'], ['fm-c', 'Add the instruction, then replay the regression set'],
    ['fm-a', 'Recheck after the next 100 traces'], ['fm-d', 'Build or finish the check'],
  ]);
});

test('markdownReport serializes the model and links the funnel image', () => {
  const md = markdownReport(fixtureJson('funnel-project.json'), { funnelImage: 'report-funnel.svg', now });
  assert.ok(md.startsWith('# Funnel fixture: what we found\n\n2026-09-24\n\nYou reviewed 14 of 17 traces.'));
  assert.match(md, /!\[The funnel of an AI experience\]\(report-funnel\.svg\)/);
  assert.match(md, /\| 2 Check the calendar \| 11 \| 2 \| B offers a taken slot \(2\), C books too early \(1\) \|/);
  assert.match(md, /Good outcome: 5 of 13\. Unknown stage: 1\. Not a product problem: 1 \(not counted\)\./);
  assert.match(md, /## Checks\n\n17 of 17 traces pass every check that runs on every change\./);
  assert.match(md, /## Before and after/);
  assert.match(md, /- \*\*C books too early\*\* \(Fix it now\): Add the instruction, then replay the regression set\./);
  assert.doesNotMatch(md, /[\u2013\u2014]/);
  assert.doesNotMatch(markdownReport(fixtureJson('funnel-project.json')), /!\[/);
});

test('regressionSet: failing traces of fix and check modes, Good traces with success modes', () => {
  const p = fixtureJson('funnel-project.json');
  const lines = regressionSet(p).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), ['t1', 't2', 't7', 't8', 't9', 't10', 't16', 't17']);
  const t8 = lines.find((l) => l.id === 't8');
  assert.deepEqual(t8.expected, { verdict: 'pass', modes: { 'fm-b': 'pass', 'fm-c': 'pass' } });
  assert.deepEqual(lines.find((l) => l.id === 't17').expected.modes, { 'fm-b': 'pass' }, 'fm-a is only watched');
  assert.deepEqual(lines.find((l) => l.id === 't1').expected.modes, { 'fm-b': 'pass', 'fm-c': 'pass', 'fm-d': 'pass' });
  assert.deepEqual(t8.messages, p.traces.find((t) => t.id === 't8').messages, 'the original trace is kept');
  assert.deepEqual(t8.replay, { messages: [p.traces.find((t) => t.id === 't8').messages[0]] });
});

test('regressionSet replay ends at the user turn before the picked step', () => {
  const trace = {
    id: 'r', metadata: {},
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first ask' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'second ask' },
      { role: 'assistant', content: 'second reply' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
      { role: 'assistant', content: 'third reply' },
      { role: 'user', content: 'third ask' },
      { role: 'assistant', content: 'last reply' },
    ],
  };
  const mode = { id: 'fm-z', kind: 'failure', name: 'Z', definition: '', stage: null, decision: 'fix', createdAt: '2026-01-01T00:00:00Z' };
  const at = (step) => {
    const p = makeProject({ traces: [trace], modes: [mode], reviews: { r: review('fail', 0, { modes: ['fm-z'], step }) } });
    return JSON.parse(regressionSet(p).trim()).replay.messages.map((m) => (typeof m.content === 'string' ? m.content : 'blocks'));
  };
  assert.deepEqual(at('m4'), ['sys', 'first ask', 'first reply', 'second ask']);
  assert.deepEqual(at('m6'), ['sys', 'first ask', 'first reply', 'second ask'], 'a tool_result-only message is not a user turn');
  assert.deepEqual(at('m2'), ['sys', 'first ask']);
  assert.deepEqual(at(null), trace.messages.slice(0, 8).map((m) => (typeof m.content === 'string' ? m.content : 'blocks')), 'no step: up to the last user turn');
  const io = makeProject({ traces: [{ id: 'q', input: 'What is the refund window?', output: '30 days' }], modes: [mode], reviews: { q: review('fail', 0, { modes: ['fm-z'] }) } });
  assert.deepEqual(JSON.parse(regressionSet(io)).replay, { input: 'What is the refund window?' });
});

test('ciChecks keeps code checks that run on every change', () => {
  const p = fixtureJson('funnel-project.json');
  const withMore = { ...p, checks: [...p.checks, { id: 'ck-off', modeId: 'fm-b', type: 'code', ci: false }, { id: 'ck-j', modeId: 'fm-b', type: 'judge', ci: true }] };
  const out = ciChecks(withMore);
  assert.equal(out.format, 'pmstack.checks/1');
  assert.equal(out.product, 'Fixture booking bot');
  assert.deepEqual(out.checks.map((c) => c.id), ['ck-d']);
  assert.equal(out.experience, p.experience);
});
