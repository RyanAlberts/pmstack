import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { acceptLesson } from '../docs/workspace/decision-engine.mjs';

const cli = fileURLToPath(new URL('../bin/work-review.mjs', import.meta.url));
const example = () => JSON.parse(readFileSync(new URL('../docs/workspace/demo-data.json', import.meta.url), 'utf8'));
const learned = () => acceptLesson(example(), 'Count customers, show counterevidence, and weigh severity.', 'Message volume is not reach.');
function workspace(t, project = learned()) {
  const dir = mkdtempSync(join(tmpdir(), 'pmstack-cli-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'project.json');
  writeFileSync(path, JSON.stringify(project));
  return { dir, path, project };
}
function invoke(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}
function jsonResult(result, status) {
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('CLI prompt exports the selected evidence and current standard without editing input', t => {
  const { path } = workspace(t);
  const before = readFileSync(path, 'utf8');
  const result = invoke('prompt', path, 'week-two');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Standard version: 2/);
  assert.match(result.stdout, /w2-01/);
  assert.match(result.stdout, /"decision"/);
  assert.doesNotMatch(result.stdout, /w1-01/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('CLI import creates an unreviewed imported run that check and brief can read', t => {
  const { path, dir, project } = workspace(t);
  const before = readFileSync(path, 'utf8');
  const decisionPath = join(dir, 'response.json');
  const output = join(dir, 'imported.json');
  writeFileSync(decisionPath, JSON.stringify({ decision: project.runs.find(r => r.id === 'revised-draft').decision }));
  const result = jsonResult(invoke('import', path, 'week-one', decisionPath, '--system', 'External teammate v2', '--output', output), 0);
  const imported = JSON.parse(readFileSync(output, 'utf8'));
  const run = imported.runs.find(r => r.id === result.runId);
  assert.equal(imported.activeRunId, run.id);
  assert.equal(run.system, 'External teammate v2');
  assert.equal(run.provenance, 'imported');
  assert.equal(run.review, null);
  assert.equal(run.standardVersion, 2);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(jsonResult(invoke('check', output), 1).status, 'needs-review');
  const brief = invoke('brief', output);
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /External teammate v2/);
  assert.match(brief.stdout, /not independently verified/);
  assert.match(brief.stdout, /Status: needs-review/);
});

test('CLI refuses both input overwrite and existing output overwrite', t => {
  const { path, dir, project } = workspace(t);
  const original = readFileSync(path, 'utf8');
  const decisionPath = join(dir, 'response.json');
  writeFileSync(decisionPath, JSON.stringify({ decision: project.runs[1].decision }));
  const overwriteInput = invoke('import', path, 'week-one', decisionPath, '--system', 'agent', '--output', path);
  assert.equal(overwriteInput.status, 2);
  assert.match(overwriteInput.stderr, /different from the input/);
  assert.equal(readFileSync(path, 'utf8'), original);
  const output = join(dir, 'existing.json');
  writeFileSync(output, 'existing contents');
  const overwriteOutput = invoke('import', path, 'week-one', decisionPath, '--system', 'agent', '--output', output);
  assert.equal(overwriteOutput.status, 2);
  assert.equal(readFileSync(output, 'utf8'), 'existing contents');
});

test('CLI exits 1 for failed checks, stale acceptance, and missing human review', t => {
  const { path, project } = workspace(t);
  assert.equal(jsonResult(invoke('check', path, 'next-week'), 1).status, 'needs-work');
  assert.equal(jsonResult(invoke('check', path, 'revised-draft'), 1).status, 'needs-review');
  project.runs[0].review = { verdict: 'accept', reason: 'Original judgment', date: '2026-09-12' };
  writeFileSync(path, JSON.stringify(project));
  const stale = jsonResult(invoke('check', path, 'first-draft'), 1);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.stale, true);
});

test('CLI exits 0 only after current evidence has an accepted human review', t => {
  const project = learned();
  const run = project.runs.find(r => r.id === 'next-week-revised');
  run.review = { verdict: 'accept', reason: 'Investigate possible data loss before cosmetic work.', date: '2026-09-12' };
  project.activeRunId = run.id;
  const { path } = workspace(t, project);
  const checked = jsonResult(invoke('check', path), 0);
  assert.equal(checked.status, 'accepted');
  assert.equal(checked.failed, 0);
  assert.equal(checked.unknown, 0);
  const brief = invoke('brief', path, run.id);
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /Status: accepted/);
  assert.match(brief.stdout, /No model was run/);
  assert.match(brief.stdout, /Investigate possible data loss/);
});

test('CLI unknown evidence stays unresolved even with a recorded acceptance', t => {
  const project = learned();
  const run = project.runs.find(r => r.id === 'revised-draft');
  run.decision.counts = [];
  run.review = { verdict: 'accept', reason: 'I prefer this recommendation.', date: '2026-09-12' };
  const { path } = workspace(t, project);
  const checked = jsonResult(invoke('check', path, run.id), 1);
  assert.equal(checked.status, 'needs-review');
  assert.ok(checked.unknown > 0);
});

test('CLI invalid JSON, missing IDs, bad flags and malformed imports exit 2', t => {
  const { path, dir } = workspace(t);
  const invalid = join(dir, 'invalid.json');
  writeFileSync(invalid, '{broken json');
  const output = join(dir, 'not-created.json');
  for (const args of [
    ['check', invalid],
    ['check', path, 'missing-run'],
    ['prompt', path, 'missing-batch'],
    ['brief', path, 'missing-run'],
    ['import', path, 'week-one', invalid, '--system', 'agent', '--output', output],
    ['import', path, 'week-one', invalid, '--unknown', 'agent', '--output', output],
    ['check'],
  ]) {
    const result = invoke(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /work-review:/);
  }
  assert.equal(existsSync(output), false);
});
