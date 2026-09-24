// samples.test.mjs: the sample products in docs/studio/samples/. Every number the studio, the
// visuals, and the docs show for a sample is computed by the engine from these files, so the
// numbers the spec promises (SPEC 8, 11, 12.9) are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../../docs/studio/lib/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'docs', 'studio', 'samples');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const ORDER = ['clinic-booking', 'sales-email', 'policy-answers', 'gift-finder', 'code-review', 'support-agent'];
const index = readJson(path.join(DIR, 'index.json'));
const samples = new Map(index.map((row) => [row.id, readJson(path.join(DIR, `${row.id}.json`))]));
const clinic = samples.get('clinic-booking');
const support = samples.get('support-agent');

const PERSON = 'fm-ignores-requests-for-a-person';
const TAKEN = 'fm-offers-a-time-that-is-taken';
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `t-${String(from + i).padStart(4, '0')}`);
const failIds = (byTrace) => Object.keys(byTrace).filter((id) => byTrace[id] === 'fail').sort();

/** Every sample number the docs may quote, computed by the engine: { [sampleId]: { ... } }. */
function sampleNumbers() {
  const out = {};
  for (const [id, p] of samples) {
    const stats = lib.reviewStats(p);
    const f = lib.computeFunnel(p);
    out[id] = {
      traces: p.traces.length,
      reviewed: stats.reviewed,
      good: stats.pass,
      problem: stats.fail,
      counted: f.counted,
      ignored: f.ignored,
      onTrack: f.stages.map((s) => s.onTrack),
      failedHere: f.stages.map((s) => s.failedHere),
      goodOutcome: f.goodOutcome,
      failureModes: Object.fromEntries(lib.priorityTable(p).map((r) => [r.mode.name, r.traces])),
      successModes: Object.fromEntries(f.stages.flatMap((s) => s.successModes.map((m) => [m.name, m.count]))),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Every sample

test('samples/index.json lists the six samples in order, with numbers from the engine', () => {
  assert.deepEqual(index.map((r) => r.id), ORDER);
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, [...ORDER.map((id) => `${id}.json`), 'index.json'].sort());
  const numbers = sampleNumbers();
  for (const row of index) {
    const p = samples.get(row.id);
    assert.deepEqual(Object.keys(row), ['id', 'name', 'view', 'pattern', 'userLabel', 'traceCount', 'reviewed', 'description'], row.id);
    assert.equal(row.name, p.name, row.id);
    assert.equal(row.view, p.experience.renderer, row.id);
    assert.equal(row.pattern, p.experience.pattern, row.id);
    assert.equal(row.userLabel, lib.userWord(p.experience), row.id);
    assert.equal(row.traceCount, numbers[row.id].traces, row.id);
    assert.equal(row.reviewed, numbers[row.id].reviewed, row.id);
    assert.ok(row.description.length > 20, row.id);
  }
  assert.deepEqual(index.map((r) => [r.traceCount, r.reviewed]), [[170, 102], [40, 0], [40, 0], [40, 0], [30, 0], [45, 23]]);
  assert.deepEqual(index.map((r) => [r.view, r.pattern, r.userLabel]), [
    ['chat', 'augmented', 'patient'], ['email', 'chain', 'prospect'], ['answer', 'augmented', 'employee'],
    ['list', 'routing', 'shopper'], ['code-review', 'agent', 'developer'], ['chat', 'agent', 'customer'],
  ]);
});

test('every sample validates as a pmstack project', () => {
  for (const [id, p] of samples) {
    assert.deepEqual(lib.validateProject(p), { ok: true, errors: [] }, id);
    assert.equal(p.id, id);
    assert.equal(p.sample, true, id);
    assert.equal(p.tracesFile, null, id);
    assert.ok(p.createdAt.startsWith('2026-09') && p.updatedAt.startsWith('2026-09'), id);
    assert.equal(new Set(p.traces.map((t) => t.id)).size, p.traces.length, `${id}: trace ids are unique`);
  }
});

test('stages, modes, labels, checks, splits, suggestions, and the next set point to ids that exist', () => {
  for (const [id, p] of samples) {
    const traces = new Set(p.traces.map((t) => t.id));
    const stages = new Set(p.experience.stages.map((s) => s.id));
    const modes = new Map(p.modes.map((m) => [m.id, m]));
    const kind = (modeId) => modes.get(modeId)?.kind;
    const normalized = lib.normalizeAll(p);
    const where = (what) => `${id}: ${what}`;

    for (const m of p.modes) if (m.stage != null) assert.ok(stages.has(m.stage), where(`mode ${m.id} stage`));
    for (const [traceId, r] of Object.entries(p.reviews)) {
      assert.ok(traces.has(traceId), where(`review ${traceId}`));
      if (r.stage != null) assert.ok(r.stage === 'unknown' || stages.has(r.stage), where(`review ${traceId} stage`));
      for (const m of r.modes) assert.ok(['failure', 'ignore'].includes(kind(m)), where(`review ${traceId} mode ${m}`));
      for (const m of r.successModes) assert.equal(kind(m), 'success', where(`review ${traceId} success mode ${m}`));
      if (r.step != null) assert.ok(normalized.get(traceId).steps.some((s) => s.id === r.step), where(`review ${traceId} step ${r.step}`));
      if (r.verdict) assert.ok(r.reviewedAt && r.at >= r.reviewedAt, where(`review ${traceId} times`));
    }
    for (const key of ['labels', 'critiques', 'closeCalls', 'splits']) {
      for (const [modeId, value] of Object.entries(p[key])) {
        assert.equal(kind(modeId), 'failure', where(`${key} for ${modeId}`));
        const ids = key === 'splits' ? Object.keys(value.assign) : Array.isArray(value) ? value : Object.keys(value);
        for (const traceId of ids) assert.ok(traces.has(traceId), where(`${key} ${modeId} ${traceId}`));
      }
    }
    for (const c of p.checks) {
      assert.equal(kind(c.modeId), 'failure', where(`check ${c.id}`));
      for (const traceId of Object.keys(c.results || {})) assert.ok(traces.has(traceId), where(`check ${c.id} result ${traceId}`));
    }
    for (const s of p.suggestions) {
      if (s.traceId) assert.ok(traces.has(s.traceId), where(`suggestion ${s.id}`));
      if (s.modeId) assert.ok(modes.has(s.modeId), where(`suggestion ${s.id} mode`));
    }
    const setIds = p.batch.items.map((it) => it.traceId);
    assert.equal(new Set(setIds).size, setIds.length, where('next set has no repeats'));
    for (const traceId of setIds) assert.ok(traces.has(traceId) && !p.reviews[traceId]?.verdict, where(`next set ${traceId}`));
  }
});

test('every stage with match rules is reached by at least one trace, and names tools the traces use', () => {
  for (const [id, p] of samples) {
    const reached = new Set();
    const names = new Set();
    for (const n of lib.normalizeAll(p).values()) {
      for (const s of n.steps) {
        if (s.stage) reached.add(s.stage);
        if (s.name) names.add(s.name);
      }
    }
    for (const stage of p.experience.stages) {
      if (Object.keys(stage.match).length) assert.ok(reached.has(stage.id), `${id}: stage ${stage.id} is never reached`);
      for (const tool of stage.match.tools || []) assert.ok(names.has(tool), `${id}: stage ${stage.id} tool ${tool}`);
    }
  }
  assert.deepEqual(samples.get('policy-answers').experience.stages.map((s) => s.id), ['understand', 'gather', 'answer']);
});

test('splits are filled for every failure mode with labels, sized by label, and stable on rerun', () => {
  for (const [id, p] of samples) {
    for (const m of p.modes.filter((x) => x.kind === 'failure')) {
      const labeled = lib.labeledSet(p, m.id);
      if (!labeled.length) {
        assert.equal(p.splits[m.id], undefined, `${id}: ${m.id} has no labels, so no splits`);
        continue;
      }
      const s = p.splits[m.id];
      assert.ok(s, `${id}: splits for ${m.id}`);
      assert.equal(s.seed, 7);
      assert.equal(s.revealedAt, null);
      assert.deepEqual(Object.keys(s.assign).sort(), labeled.map((x) => x.traceId).sort(), `${id}: ${m.id} assigns every labeled trace`);
      const counts = lib.splitCounts(p, m.id);
      for (const label of ['pass', 'fail']) {
        const n = labeled.filter((x) => x.label === label).length;
        const want = lib.splitTargets(n);
        for (const split of ['examples', 'tuning', 'test']) assert.equal(counts[split][label], want[split], `${id}: ${m.id} ${label} ${split}`);
      }
      assert.equal(lib.assignSplits(p, m.id, {}, { now: p.updatedAt }), p, `${id}: ${m.id} splits are stable`);
    }
  }
});

test('judge prompts not edited by hand equal the generated prompt', () => {
  for (const [id, p] of samples) {
    for (const c of p.checks.filter((x) => x.type === 'judge' && !x.promptEdited)) {
      assert.equal(c.prompt, lib.buildJudgePrompt(p, c.modeId, { inputs: c.inputs }), `${id}: ${c.id}`);
    }
  }
});

test('scripts/check-samples.mjs --check finds nothing to change', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-samples.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /6 samples checked/);
});

// ---------------------------------------------------------------------------
// Maple Dental booking assistant (clinic-booking): the hero sample (SPEC 8)

test('clinic funnel: 100 counted, on track 100/96/84/79/73, Good outcome 64', () => {
  const f = lib.computeFunnel(clinic);
  assert.equal(f.counted, 100);
  assert.equal(f.passed, 64);
  assert.equal(f.failed, 36);
  assert.equal(f.ignored, 2);
  assert.deepEqual(f.ignoredIds, ['t-0101', 't-0102']);
  assert.equal(f.unknown.count, 0);
  assert.deepEqual(f.stages.map((s) => s.id), ['understand', 'handoff', 'lookup', 'act', 'reply']);
  assert.deepEqual(f.stages.map((s) => s.onTrack), [100, 96, 84, 79, 73]);
  assert.deepEqual(f.stages.map((s) => s.failedHere), [4, 12, 5, 6, 9]);
  assert.equal(f.goodOutcome, 64);
  const firstHere = f.stages.map((s) => s.failureModes.filter((m) => m.firstHere > 0).map((m) => [m.id, m.firstHere]));
  assert.deepEqual(firstHere, [
    [['fm-asks-again-for-details-given', 4]],
    [[PERSON, 7], ['fm-answers-billing-questions-itself', 5]],
    [[TAKEN, 5]],
    [['fm-books-before-the-patient-confirms', 6]],
    [['fm-stray-symbols-in-texts', 9]],
  ]);
});

test('clinic success modes: 11, 9, 14, 22, 31', () => {
  const f = lib.computeFunnel(clinic);
  assert.deepEqual(f.stages.map((s) => s.successModes.map((m) => [m.id, m.count])), [
    [['sm-asks-for-the-missing-day', 11]],
    [['sm-hands-off-with-a-summary', 9]],
    [['sm-offers-the-two-nearest-times', 14]],
    [['sm-confirms-the-time-first', 22]],
    [['sm-repeats-the-booking-back', 31]],
  ]);
});

test('clinic reviews: 102 reviewed (64 Good, 38 Problem), 20 left to try, 28 label-only', () => {
  assert.deepEqual(lib.reviewStats(clinic), { total: 170, reviewed: 102, pass: 64, fail: 38, skip: 0, unreviewed: 68, needsNote: 0 });
  for (const id of range(1, 102)) assert.ok(['pass', 'fail'].includes(clinic.reviews[id]?.verdict), id);
  for (const id of range(103, 122)) assert.equal(clinic.reviews[id], undefined, id);
  for (const id of range(123, 150)) assert.equal(clinic.reviews[id].verdict, null, id);
  for (const id of range(151, 170)) assert.equal(clinic.reviews[id], undefined, id);
  for (const id of ['t-0101', 't-0102']) assert.deepEqual(clinic.reviews[id].modes, ['nm-not-a-product-problem']);
  const reviewers = new Set(Object.values(clinic.reviews).filter((r) => r.verdict).map((r) => r.reviewedAt.slice(0, 10)));
  for (const day of reviewers) assert.ok(day >= '2026-09-15' && day <= '2026-09-19', day);
  assert.equal(clinic.experience.reviewer, 'Priya (PM)');
  const versions = clinic.traces.map((t) => t.metadata.version);
  assert.equal(versions.filter((v) => v === 'Before the fix').length, 150);
  assert.deepEqual(clinic.traces.filter((t) => t.metadata.version === 'After the fix').map((t) => t.id), range(151, 170));
  const channels = clinic.traces.map((t) => t.metadata.channel);
  assert.equal(channels.filter((c) => c === 'voice').length, 14);
  assert.equal(clinic.batch.items.length, 20);
});

test('clinic failure modes, success modes, and decisions use the exact ids', () => {
  const rows = clinic.modes.map((m) => [m.id, m.kind, m.stage, m.severity ?? null, m.instructed ?? null, m.decision ?? null]);
  assert.deepEqual(rows, [
    ['fm-asks-again-for-details-given', 'failure', 'understand', 'annoys', 'yes', 'watch'],
    [PERSON, 'failure', 'handoff', 'blocks', 'yes', 'check'],
    ['fm-answers-billing-questions-itself', 'failure', 'handoff', 'hurts', 'no', 'check'],
    [TAKEN, 'failure', 'lookup', 'blocks', 'yes', 'check'],
    ['fm-books-before-the-patient-confirms', 'failure', 'act', 'hurts', 'yes', 'check'],
    ['fm-stray-symbols-in-texts', 'failure', 'reply', 'annoys', 'no', 'fix'],
    ['sm-asks-for-the-missing-day', 'success', 'understand', null, null, null],
    ['sm-hands-off-with-a-summary', 'success', 'handoff', null, null, null],
    ['sm-offers-the-two-nearest-times', 'success', 'lookup', null, null, null],
    ['sm-confirms-the-time-first', 'success', 'act', null, null, null],
    ['sm-repeats-the-booking-back', 'success', 'reply', null, null, null],
    ['nm-not-a-product-problem', 'ignore', null, null, null, null],
  ]);
  const byId = new Map(clinic.modes.map((m) => [m.id, m]));
  assert.equal(byId.get('fm-stray-symbols-in-texts').fixedAt, '2026-09-20T17:00:00Z');
  assert.equal(byId.get(PERSON).createdAt, '2026-09-16T15:10:00Z');
  assert.deepEqual(lib.priorityTable(clinic).map((r) => [r.mode.id, r.traces, r.priority]), [
    [PERSON, 7, 21], [TAKEN, 5, 15], ['fm-books-before-the-patient-confirms', 6, 12],
    ['fm-answers-billing-questions-itself', 5, 10], ['fm-stray-symbols-in-texts', 9, 9], ['fm-asks-again-for-details-given', 4, 4],
  ]);
  // A mode is created after the first review that describes it.
  for (const m of clinic.modes.filter((x) => x.kind === 'failure')) {
    const first = Object.values(clinic.reviews).filter((r) => r.verdict === 'fail' && r.modes.includes(m.id)).map((r) => r.reviewedAt).sort()[0];
    assert.ok(first < m.createdAt, `${m.id} is created after ${first}`);
  }
});

test('clinic person labels: 20 fail and 79 pass (13 and 15 from the targeted pull)', () => {
  const labeled = lib.labeledSet(clinic, PERSON);
  assert.equal(labeled.filter((x) => x.label === 'fail').length, 20);
  assert.equal(labeled.filter((x) => x.label === 'pass').length, 79);
  const targeted = range(123, 150).map((id) => clinic.labels[PERSON][id]);
  assert.equal(targeted.filter((v) => v === 'fail').length, 13);
  assert.equal(targeted.filter((v) => v === 'pass').length, 15);
  for (const id of range(123, 150)) assert.equal(clinic.traces.find((t) => t.id === id).metadata.round, 'Asked for a person', id);
});

test('clinic re-check queue has exactly 6 traces, all for Offers a time that is taken', () => {
  const queue = lib.recheckQueue(clinic);
  assert.equal(queue.length, 6);
  for (const row of queue) assert.deepEqual(row.modeIds, [TAKEN]);
});

test('clinic critiques exist for every labeled trace, with one close call', () => {
  for (const m of clinic.modes.filter((x) => x.kind === 'failure')) {
    for (const { traceId } of lib.labeledSet(clinic, m.id)) assert.ok(clinic.critiques[m.id]?.[traceId], `${m.id} ${traceId}`);
  }
  assert.deepEqual(Object.values(clinic.closeCalls).flat().length, 1);
});

test('clinic checks: two code checks, a judge draft, and the person judge with tuning results', () => {
  const byId = new Map(clinic.checks.map((c) => [c.id, c]));
  assert.deepEqual([...byId.keys()], ['ck-stray-symbols', 'ck-billing-words', 'ck-confirm-judge', 'ck-person-judge']);
  assert.ok(!clinic.checks.some((c) => c.modeId === TAKEN), 'Offers a time that is taken has no check yet');

  const run = lib.runChecks(clinic, {});
  assert.equal(byId.get('ck-stray-symbols').ci, true);
  for (const id of range(151, 170)) assert.equal(run.byCheck['ck-stray-symbols'][id], 'pass', id);
  assert.equal(byId.get('ck-billing-words').ci, false);
  assert.ok(lib.checkAgreement(clinic, 'ck-billing-words', {}).falseFails.length > 0, 'the billing words check has false alarms');

  const draft = byId.get('ck-confirm-judge');
  assert.deepEqual([Object.keys(draft.results).length, draft.runs.length, draft.test], [0, 0, null]);
  assert.ok(draft.prompt.includes('{{trace}}') && draft.model);

  const judge = byId.get('ck-person-judge');
  assert.equal(judge.test, null);
  assert.equal(judge.model, 'claude-haiku-4-5-20251001');
  assert.equal(judge.runMode, 'batch');
  for (const { traceId } of lib.labeledSet(clinic, PERSON)) {
    const split = lib.splitOf(clinic, PERSON, traceId);
    if (split === 'tuning' || split === 'test') assert.ok(judge.results[traceId], `judge result for ${traceId} (${split})`);
  }
  const before = clinic.traces.filter((t) => t.metadata.version === 'Before the fix').map((t) => t.id);
  assert.deepEqual(Object.keys(judge.results).sort(), before.sort());
  const pairs = lib.labeledSet(clinic, PERSON).map((x) => ({ traceId: x.traceId, human: x.label, check: judge.results[x.traceId].verdict }));
  const all = lib.agreement(pairs);
  assert.deepEqual([all.n, all.nFail, all.falsePasses.length, all.falseFails.length], [99, 20, 2, 3]);
  const tuning = lib.checkAgreement(clinic, 'ck-person-judge', { split: 'tuning' });
  const last = judge.runs[judge.runs.length - 1];
  assert.deepEqual([last.split, last.n, last.agreesOnGood, last.catchesFailures], ['tuning', tuning.n, tuning.agreesOnGood, tuning.catchesFailures]);
  assert.equal(last.promptHash, lib.promptHash(judge));
});

// ---------------------------------------------------------------------------
// Northstar Internet support agent (support-agent): tool call checks (SPEC 12.9)

test('support agent: 45 traces, 23 reviewed, tool calls shown by default', () => {
  assert.equal(support.traces.length, 45);
  assert.equal(support.experience.showHiddenDefault, true);
  assert.deepEqual(lib.reviewStats(support), { total: 45, reviewed: 23, pass: 12, fail: 11, skip: 1, unreviewed: 21, needsNote: 0 });
  assert.equal(support.experience.reviewer, 'Sam (PM)');
  assert.deepEqual(support.modes.map((m) => [m.id, m.template]), [
    ['fm-breaks-a-tool-policy', 'policy'],
    ['fm-wrong-tool-for-the-request', 'relevance'],
    ['fm-reply-doesn-t-match-the-tool-results', 'grounding'],
    ['fm-sends-a-technician-during-a-known-outage', null],
  ]);
  assert.deepEqual(support.checks.map((c) => [c.id, c.type, c.rule?.op ?? null, c.ci]), [
    ['ck-tool-policy', 'policy', null, true],
    ['ck-intent-map', 'relevance', null, false],
    ['ck-grounded-values', 'code', 'grounded-values', false],
    ['ck-success-after-error', 'code', 'success-after-error', false],
    ['ck-grounding-judge', 'judge', null, false],
  ]);
  const judge = support.checks.find((c) => c.type === 'judge');
  assert.deepEqual([Object.keys(judge.results).length, judge.runs.length], [0, 0]);
  const summary = lib.toolCallSummary(support);
  assert.equal(summary.withTools, 45);
});

test('support agent tool checks catch the seeded problems from the answer key', () => {
  const run = lib.runChecks(support, {});
  // 12 seeded policy breaks, plus t-0042: its credit went out while the supervisor approval was still pending.
  assert.deepEqual(failIds(run.byCheck['ck-tool-policy']), [
    't-0002', 't-0005', 't-0009', 't-0013', 't-0017', 't-0023', 't-0026', 't-0028', 't-0030', 't-0032', 't-0034', 't-0038', 't-0042',
  ]);
  assert.deepEqual(failIds(run.byCheck['ck-intent-map']), ['t-0007', 't-0021', 't-0030', 't-0036', 't-0040']);
  assert.deepEqual(failIds(run.byCheck['ck-grounded-values']), ['t-0015', 't-0041']);
  assert.deepEqual(failIds(run.byCheck['ck-success-after-error']), ['t-0002', 't-0019', 't-0032', 't-0042', 't-0044']);
  assert.equal(run.passAll, 24);
});

test('templates/tool-calls policy and intent map match the support agent sample', () => {
  const stripNote = ({ note, ...rest }) => rest;
  const policy = readJson(path.join(ROOT, 'templates', 'tool-calls', 'policy.json'));
  const intents = readJson(path.join(ROOT, 'templates', 'tool-calls', 'intents.json'));
  assert.deepEqual(lib.validatePolicy(policy), { ok: true, errors: [] });
  assert.deepEqual(lib.validateIntents(intents), { ok: true, errors: [] });
  const inlinePolicy = support.checks.find((c) => c.type === 'policy').policy;
  const inlineIntents = support.checks.find((c) => c.type === 'relevance').intents;
  assert.deepEqual(stripNote(policy), inlinePolicy);
  assert.deepEqual(stripNote(intents), inlineIntents);
  for (const raw of support.traces) {
    const n = lib.getNormalized(support, raw.id);
    assert.deepEqual(lib.evaluatePolicy(policy, n), lib.evaluatePolicy(inlinePolicy, n), raw.id);
    assert.deepEqual(lib.evaluateRelevance(intents, n), lib.evaluateRelevance(inlineIntents, n), raw.id);
  }
});

// ---------------------------------------------------------------------------
// Fresh samples: seeded for discovery, nothing reviewed yet

test('fresh samples start with no reviews, modes, or checks, and a first set of 20', () => {
  for (const id of ['sales-email', 'policy-answers', 'gift-finder', 'code-review']) {
    const p = samples.get(id);
    assert.deepEqual([Object.keys(p.reviews).length, p.modes.length, p.checks.length, p.suggestions.length], [0, 0, 0, 0], id);
    assert.equal(p.batch.items.length, 20, id);
  }
});

// ---------------------------------------------------------------------------
// Numbers quoted in README.md and docs/index.html (SPEC 11). Each claim is a pattern, the numbers
// it quotes, and the values the engine computes from the sample files (and, for the judge example,
// from scripts/visual-data/judge-example.json). After the claims are checked and blanked out, any
// count, share, or "N of M" still left in the text fails the test, so a new number cannot slip
// into the docs unchecked.

const QUOTING_DOCS = ['README.md', 'docs/index.html'];
const pctOf = (x) => Math.round(x * 100);
const WORD_NUMBERS = { six: 6 };
const LEFTOVER_NUMBERS = /\b\d[\d,]*\s+(?:traces|conversations|reviewed)\b|\b\d+ of \d+\b|\b\d+(?:\.\d+)?%/g;

/** The judge-trust example: agreement on the kept-aside labels and the corrected rate (seed 7). */
function judgeExampleNumbers() {
  const j = readJson(path.join(ROOT, 'scripts', 'visual-data', 'judge-example.json'));
  const a = lib.agreement(j.testPairs);
  const rate = lib.asFailureRate(lib.bootstrapCorrected({ testPairs: j.testPairs, unlabeledVerdicts: j.unlabeledVerdicts, iterations: 2000, seed: 7 }));
  return {
    labeled: a.n, caught: a.tn, failures: a.nFail, leftAlone: a.tp, good: a.nPass,
    catches: pctOf(a.catchesFailures), agrees: pctOf(a.agreesOnGood), newTraces: j.unlabeledVerdicts.length,
    flagged: pctOf(rate.observed), likely: pctOf(rate.estimate), low: pctOf(rate.low), high: pctOf(rate.high),
  };
}

/** Every claim the docs make about sample numbers: { what, re (global), want, files (must contain it) }. */
function quotedClaims() {
  const c = sampleNumbers()['clinic-booking'];
  const person = c.failureModes['Ignores requests for a person'];
  const stray = c.failureModes['Stray ** symbols in texts'];
  const ranked = lib.priorityTable(clinic);
  const mostCommon = [...ranked].sort((a, b) => b.traces - a.traces)[0];
  const j = judgeExampleNumbers();
  return [
    { what: 'funnel: counted conversations', re: /(\d+) reviewed conversations move/g, want: [c.counted], files: QUOTING_DOCS },
    { what: 'funnel: ignored requests for a person', re: /such as (\d+) that ignored requests for a person/g, want: [person], files: QUOTING_DOCS },
    { what: 'funnel: good outcome', re: /(\d+) of (\d+) reach a good outcome/g, want: [c.goodOutcome, c.counted], files: QUOTING_DOCS },
    { what: 'most common failure mode', re: /stray symbols in texts is the most common failure mode at (\d+) conversations/gi, want: [stray], files: ['README.md'],
      also: () => assert.equal(mostCommon.mode.name, 'Stray ** symbols in texts') },
    { what: 'first in the priority table', re: /ignoring requests for a person ranks first: (\d+) conversations/gi, want: [person], files: ['README.md'],
      also: () => assert.deepEqual([ranked[0].mode.name, ranked[0].mode.severity], ['Ignores requests for a person', 'blocks']) },
    { what: 'number of samples', re: /\b(six) sample products\b/gi, want: [index.length], files: ['README.md'] },
    { what: 'judge example: labeled', re: /(\d+) labeled conversations/g, want: [j.labeled], files: ['README.md'] },
    { what: 'judge example: failures caught', re: /(\d+) of (\d+) real failures(?: \((\d+)%\))?/g, want: [j.caught, j.failures, j.catches], files: ['README.md'] },
    { what: 'judge example: good ones left alone', re: /(\d+) of (\d+) good (?:conversations|ones)(?: \((\d+)%\))?/g, want: [j.leftAlone, j.good, j.agrees], files: ['README.md'] },
    { what: 'judge example: new conversations', re: /(\d+) new conversations/g, want: [j.newTraces], files: ['README.md'] },
    { what: 'judge example: flagged', re: /flag(?:ged|s) (\d+)%/g, want: [j.flagged], files: ['README.md'] },
    { what: 'judge example: likely true failure rate', re: /likely true failure rate is (\d+)%/g, want: [j.likely], files: ['README.md'] },
    { what: 'judge example: 95% range', re: /95% range of (\d+)% to (\d+)%/g, want: [j.low, j.high], files: ['README.md'] },
  ];
}

/** The text a reader sees in a doc: prose and alt text, without code, styles, scripts, or inline SVG. */
function visibleText(file, raw) {
  let src = raw;
  if (file.endsWith('.md')) src = src.replace(/^```[\s\S]*?^```/gm, ' ').replace(/`[^`\n]*`/g, ' ');
  else src = src.replace(/<(style|script|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const alts = [...src.matchAll(/\balt="([^"]*)"/g)].map((m) => m[1]);
  const text = src.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  return `${text}\n${alts.join('\n')}`.replace(/[ \t]+/g, ' ');
}

test('sample cards on the landing page quote each sample trace count', () => {
  const html = readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const cards = [...html.matchAll(/href="studio\/#\/open\/([a-z-]+)">[^<]*<\/a><\/h3>[\s\S]*?<span class="count">(\d[\d,]*) traces<\/span>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ORDER, 'one card per sample, in order');
  const numbers = sampleNumbers();
  for (const [, id, count] of cards) assert.equal(Number(count.replace(/,/g, '')), numbers[id].traces, `${id} card`);
});

test('every sample number quoted in README.md and docs/index.html equals the computed value', () => {
  const claims = quotedClaims();
  for (const file of QUOTING_DOCS) {
    let raw = readFileSync(path.join(ROOT, file), 'utf8');
    if (file === 'docs/index.html') raw = raw.replace(/<span class="count">\d[\d,]* traces<\/span>/g, ' '); // checked by the card test above
    let text = visibleText(file, raw);
    for (const claim of claims) {
      const found = [...text.matchAll(claim.re)];
      if (claim.files.includes(file)) assert.ok(found.length, `${file} quotes "${claim.what}" (pattern ${claim.re})`);
      for (const m of found) {
        const quoted = m.slice(1).map((v) => (v === undefined ? undefined : WORD_NUMBERS[v.toLowerCase()] ?? Number(v.replace(/,/g, ''))));
        quoted.forEach((v, i) => { if (v !== undefined) assert.equal(v, claim.want[i], `${file}: "${m[0]}" (${claim.what})`); });
      }
      if (found.length && claim.also) claim.also();
      text = text.replace(claim.re, (s) => ' '.repeat(s.length));
    }
    const leftover = [...text.matchAll(LEFTOVER_NUMBERS)].map((m) => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, ' ').trim());
    assert.deepEqual(leftover, [], `${file} quotes numbers no claim checks. Add a claim in quotedClaims() for each.`);
  }
});
