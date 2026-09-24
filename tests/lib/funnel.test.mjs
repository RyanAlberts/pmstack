import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, funnelLayout, funnelSvg, funnelDescription, wrapText, priorityTable, modeCounts } from '../../docs/studio/lib/index.mjs';
import { fixtureJson } from '../fixtures/build.mjs';

// Hand-computed from tests/fixtures/funnel-project.json:
// Good: t1..t5 (5). Problem, counted: t6 t7 t8 t9 t10 t11 t16 t17 (8). Ignored: t12 (only "Not a product problem").
// Excluded: t13 (Not sure yet), t15 (no verdict), t14 (no review).
// First stage that went wrong: t6 understand (from fm-a), t7 lookup (review stage), t8 lookup (earliest of
// fm-b lookup and fm-c act), t9 act, t10 reply, t11 unknown (no stage, no mode), t16 reply ('unknown' falls
// back to fm-d), t17 act (review stage wins over its modes).
// failedHere = 1, 2, 2, 2; unknown = 1; onTrack[0] = 5 + 7 = 12, then 11, 9, 7; 7 - 2 = 5 = Good outcome.
const p = fixtureJson('funnel-project.json');

test('funnel counts on the hand-computed fixture', () => {
  const f = computeFunnel(p);
  assert.equal(f.counted, 13);
  assert.equal(f.passed, 5);
  assert.equal(f.failed, 8);
  assert.equal(f.ignored, 1);
  assert.deepEqual(f.ignoredIds, ['t12']);
  assert.equal(f.unknown.count, 1);
  assert.deepEqual(f.unknown.traceIds, ['t11']);
  assert.deepEqual(f.stages.map((s) => s.failedHere), [1, 2, 2, 2]);
  assert.deepEqual(f.stages.map((s) => s.onTrack), [12, 11, 9, 7]);
  assert.equal(f.goodOutcome, 5);
  assert.deepEqual(f.stages.map((s) => s.number), [1, 2, 3, 4]);
});

test('invariant: the band ends at the Good outcome and unknown failures never enter it', () => {
  const f = computeFunnel(p);
  const last = f.stages[f.stages.length - 1];
  assert.equal(last.onTrack - last.failedHere, f.passed);
  assert.equal(f.stages[0].onTrack + f.unknown.count, f.counted);
  assert.equal(f.stages.reduce((a, s) => a + s.failedHere, 0) + f.unknown.count, f.failed);
});

test('failure modes per stage: first here, also present, two modes at one stage count under both labels', () => {
  const f = computeFunnel(p);
  const at = (i) => f.stages[i].failureModes.map((m) => [m.id, m.firstHere, m.alsoPresent]);
  assert.deepEqual(at(0), [['fm-a', 1, 1]]);
  // t8 carries fm-b and fm-c and first went wrong at lookup, so both show there.
  assert.deepEqual(at(1), [['fm-b', 2, 1], ['fm-c', 1, 1]]);
  // t17 (fm-a and fm-b) and t9 (fm-c) went wrong at act: three labels, one drop of 2.
  assert.deepEqual(at(2), [['fm-a', 1, 1], ['fm-b', 1, 2], ['fm-c', 1, 1]]);
  assert.equal(f.stages[2].failedHere, 2);
  assert.deepEqual(at(3), [['fm-d', 2, 0]]);
  assert.deepEqual(f.stages[3].failureModes[0].traceIds, ['t10', 't16']);
});

test('success modes count counted traces, including Problem traces; checks listed per stage', () => {
  const f = computeFunnel(p);
  assert.deepEqual(f.stages[0].successModes, [{ id: 'sm-y', name: 'Y asks for the day', count: 2 }]);
  assert.deepEqual(f.stages[3].successModes, [{ id: 'sm-x', name: 'X reads it back', count: 2 }]);
  assert.deepEqual(f.stages[3].checks, [{ modeId: 'fm-d', checkId: 'ck-d', type: 'code' }]);
  assert.deepEqual(f.stages[0].checks, []);
});

test('reached counts counted traces with a step in the stage', () => {
  // understand has match {} so no step reaches it; find_slots in t1 t2 t7 t8 t9 t17; book in t1 t9 t17;
  // every counted trace but t11 has a reply.
  assert.deepEqual(computeFunnel(p).stages.map((s) => s.reached), [0, 6, 3, 12]);
});

test('version filter keeps only traces of that version', () => {
  const v1 = computeFunnel(p, { version: 'v1' });
  assert.equal(v1.passed, 5);
  assert.equal(v1.failed, 5);
  assert.equal(v1.ignored, 0);
  const v2 = computeFunnel(p, { version: 'v2' });
  assert.equal(v2.passed, 0);
  assert.equal(v2.failed, 3);
  assert.equal(v2.ignored, 1);
  assert.equal(v2.unknown.count, 1);
});

test('mode counts and what to fix first on the fixture', () => {
  const counts = modeCounts(p);
  assert.deepEqual({ ...counts.get('fm-b'), traceIds: undefined }, { traces: 3, traceIds: undefined, firstHere: 2 });
  assert.equal(counts.get('nm-z').traces, 1);
  assert.equal(counts.get('sm-y').traces, 2);
  const table = priorityTable(p);
  // fm-b 3 x Blocks 3 = 9; fm-c 2 x Hurts 2 = 4; fm-a and fm-d 2 x Annoys 1 = 2, earlier stage first.
  assert.deepEqual(table.map((r) => [r.mode.id, r.priority]), [['fm-b', 9], ['fm-c', 4], ['fm-a', 2], ['fm-d', 2]]);
  assert.equal(table[0].share, 3 / 13);
  assert.deepEqual(table[3].checks, [{ id: 'ck-d', type: 'code' }]);
});

test('funnelLayout: pure geometry that follows the funnel', () => {
  const f = computeFunnel(p);
  const L = funnelLayout(f, { width: 1200 });
  assert.equal(L.stages.length, 4);
  assert.equal(L.empty, false);
  const xs = L.stages.map((s) => s.x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'stages run left to right');
  assert.ok(L.stages.every((s) => s.drop && s.drop.width >= 8), 'every stage with failures has a drop');
  assert.ok(L.stages[0].band.thickness > L.stages[3].band.thickness);
  assert.equal(L.outcome.value, 5);
  assert.equal(L.unknown.count, 1);
  assert.equal(L.ignored.count, 1);
  assert.deepEqual(L.legend.map((i) => i.kind), ['success', 'failure', 'check']);
  assert.ok(L.legend[0].x > L.width / 2, 'legend sits top right');
  assert.deepEqual(L.stages[3].checks.map((c) => [c.label, c.dashed]), [['Code check', false]]);
  assert.deepEqual(L.stages[0].checks.map((c) => [c.label, c.dashed]), [['Keep watching', true]]);
  assert.deepEqual(L.stages[1].checks.map((c) => c.label), ['No check yet', 'Fix it now']);
  assert.ok(L.height >= 560);
});

test('funnelSvg: escapes text, themes, alt text, no dashes', () => {
  const f = computeFunnel(p);
  const hostile = { ...f, stages: f.stages.map((s, i) => (i === 0 ? { ...s, label: '<script>alert("x")</script> & more', failureModes: s.failureModes.map((m) => ({ ...m, name: 'Says "hi" <b>' })) } : s)) };
  const light = funnelSvg(hostile, { theme: 'light' });
  assert.ok(light.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(light.trimEnd().endsWith('</svg>'));
  assert.doesNotMatch(light, /<script/);
  assert.match(light, /&lt;script&gt;/);
  assert.match(light, /&amp; more/);
  assert.match(light, /<title id="pmf-title">The funnel of an AI experience<\/title>/);
  assert.match(light, /<desc id="pmf-desc">The funnel of an AI experience\. 13 reviewed traces move through 4 stages/);
  assert.match(light, /#BE3E29/);
  assert.doesNotMatch(light, /var\(--/);
  const dark = funnelSvg(f, { theme: 'dark' });
  assert.match(dark, /#FF7A63/);
  const vars = funnelSvg(f, { theme: 'vars' });
  assert.match(vars, /var\(--bad, #BE3E29\)/);
  for (const svg of [light, dark, vars]) {
    assert.doesNotMatch(svg, /[\u2013\u2014]/);
    assert.doesNotMatch(svg, /foreignObject|<script|href=/);
    assert.match(svg, /Good outcome/);
    assert.match(svg, /on track/);
    assert.ok(svg.length < 60000);
  }
  assert.equal(light, funnelSvg(hostile, { theme: 'light' }), 'deterministic');
});

test('empty funnel draws a placeholder instead of numbers', () => {
  const empty = computeFunnel({ ...p, reviews: {} });
  assert.equal(empty.counted, 0);
  const svg = funnelSvg(empty, { theme: 'light' });
  assert.match(svg, /Review traces to see where they go wrong\./);
  assert.doesNotMatch(svg, /Good outcome/);
  assert.equal(funnelDescription(empty), 'The funnel of an AI experience. No reviewed traces yet.');
});

test('wrapText keeps words whole and marks cut text', () => {
  assert.deepEqual(wrapText('Ignores requests for a person', 16, 2), ['Ignores requests', 'for a person']);
  assert.deepEqual(wrapText('one two three four five six', 8, 2), ['one two', 'three\u2026']);
  assert.deepEqual(wrapText('Short', 16), ['Short']);
});
