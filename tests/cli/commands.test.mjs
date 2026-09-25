// Commands run in-process through main(): studio, import, validate, check, checks, report,
// regression-set, retrieval, and agreement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as lib from '../../docs/studio/lib/index.mjs';
import { run, tmpDir, write, readJson, jsonl, chat, folderProject, request, HERE } from './helpers.mjs';

const FIXTURE = path.resolve(HERE, '../fixtures/folder');
const at = (m) => new Date(Date.UTC(2026, 8, 16, 10, m)).toISOString();

// Four text or chat traces, one failure mode (stray ** symbols) marked fixed, one success mode, two code checks.
function symbolsProject(p) {
  const modes = [
    { id: 'fm-stray', kind: 'failure', name: 'Stray ** symbols in texts', definition: 'Fails when a text message shows formatting symbols.', stage: 'answer', severity: 'annoys', instructed: 'no', decision: 'fix', impact: '', createdAt: at(0), definitionUpdatedAt: null, fixedAt: at(50), source: 'human' },
    { id: 'sm-repeat', kind: 'success', name: 'Repeats the booking back', definition: 'Passes when the reply restates the day and time.', stage: 'answer', createdAt: at(0), source: 'human' },
  ];
  const review = (verdict, minute, extra = {}) => ({ verdict, note: '', stage: null, step: null, good: '', modes: [], successModes: [], retrieval: null, reviewedAt: at(minute), at: at(minute), ...extra });
  const reviews = {
    's-1': review('fail', 10, { note: 'Stars around Friday in a text.', modes: ['fm-stray'] }),
    's-2': review('pass', 11, { successModes: ['sm-repeat'] }),
    's-4': review('pass', 12),
  };
  const checks = [
    { id: 'ck-stray', modeId: 'fm-stray', type: 'code', name: 'No formatting symbols in text messages', rule: { op: 'regex', target: 'assistant', value: '\\*\\*', flags: '' }, when: { path: 'metadata.channel', equals: 'sms' }, failWhen: 'match', ci: true },
    { id: 'ck-long', modeId: 'fm-stray', type: 'code', name: 'Replies over 60 characters', rule: { op: 'max-chars', target: 'output', value: 60 }, when: null, failWhen: 'match', ci: false },
  ];
  return { ...p, modes, reviews, checks };
}

const symbolTraces = [
  chat('s-1', 'can I come friday', 'Your time is **Friday** at 9:30 AM.', { channel: 'sms' }),
  chat('s-2', 'friday at 930?', 'Friday at 9:30 AM works.', { channel: 'sms' }),
  chat('s-3', 'Friday?', '**Friday** at 9:30 AM is open.', { channel: 'web' }),
  chat('s-4', 'book it', 'Booked for Friday.', { channel: 'sms' }),
];

// ---------------------------------------------------------------------------
// studio

test('studio makes a guessed project, prints one line, and cleans up when stopped', async (t) => {
  const dir = tmpDir(t);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const controller = new AbortController();
  let out = '';
  let err = '';
  let resolveLine;
  const line = new Promise((r) => { resolveLine = r; });
  const done = (await import('../../bin/pmstack.mjs')).main(['studio', dir, '--port', '0'], {
    cwd: dir,
    signal: controller.signal,
    stdout: { write: (s) => { out += s; resolveLine(); } },
    stderr: { write: (s) => { err += s; } },
  });
  await line;
  assert.match(out, /^Eval Studio: http:\/\/127\.0\.0\.1:\d+\/\n$/);
  const port = Number(/:(\d+)\//.exec(out)[1]);
  const info = readJson(path.join(dir, 'pmstack', '.studio.json'));
  assert.equal(info.pid, process.pid);
  assert.equal(info.port, port);
  assert.equal(info.url, `http://127.0.0.1:${port}/`);
  const project = readJson(path.join(dir, 'pmstack', 'project.json'));
  assert.equal(project.revision, 1);
  assert.equal(project.tracesFile, '../traces.jsonl');
  assert.equal(project.settings.guessed, true);
  assert.equal(project.experience.renderer, 'chat');
  assert.deepEqual(project.experience.filters, ['channel', 'rider']);
  assert.equal(project.batch.items.length, 12, 'first set of up to 20');
  assert.ok(!('traces' in project));
  assert.match(err, /Made pmstack\/project\.json from traces\.jsonl: 12 traces/);
  const api = (await request(port, { path: '/api/project' })).json();
  assert.equal(api.traces.length, 12);
  controller.abort();
  assert.equal(await done, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'pmstack', '.studio.json')), '.studio.json removed');
});

test('studio needs a trace file it can find', async (t) => {
  const empty = tmpDir(t);
  const none = await run(['studio', empty, '--port', '0'], empty);
  assert.equal(none.code, 2);
  assert.equal(none.err.trim(), `No trace file found in ${empty}. Pass --traces <file>.`);
  write(path.join(empty, 'a.jsonl'), jsonl([chat('x', 'q', 'a')]));
  write(path.join(empty, 'b.csv'), 'id,input,output\ny,q,a\n');
  const two = await run(['studio', empty, '--port', '0'], empty);
  assert.equal(two.code, 2);
  assert.match(two.err, /Found 2 files that could hold traces .*a\.jsonl, b\.csv\. Pass --traces <file>/);
  const bad = await run(['studio', path.join(empty, 'missing'), '--port', '0'], empty);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Folder not found/);
  const port = await run(['studio', empty, '--port', 'abc'], empty);
  assert.equal(port.code, 2);
  assert.match(port.err, /--port needs a whole number/);
});

// ---------------------------------------------------------------------------
// import

test('import makes a project next to the trace file with guessed setup and a first set', async (t) => {
  const dir = tmpDir(t);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const r = await run(['import', 'traces.jsonl'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Made pmstack\/project\.json from traces\.jsonl: 12 traces \(Chat messages \(OpenAI format\)\)\./);
  assert.match(r.out, /View: Chat or call \(guessed from your traces\)/);
  const p = readJson(path.join(dir, 'pmstack', 'project.json'));
  assert.equal(p.format, 'pmstack.project/1');
  assert.equal(p.name, path.basename(dir)[0].toUpperCase() + path.basename(dir).slice(1).replace(/[-_]+/g, ' '));
  assert.equal(p.tracesFile, '../traces.jsonl');
  assert.equal(p.experience.pattern, 'augmented');
  assert.equal(p.settings.guessed, true);
  assert.ok(p.batch.items.length > 0);
  assert.ok(lib.validateProject(p, { tracesLoaded: false }).ok);

  const again = await run(['import', 'traces.jsonl'], dir);
  assert.equal(again.code, 2);
  assert.match(again.err, /already exists\. Add --append/);
});

test('import takes a chosen view, pattern, name, and output path', async (t) => {
  const dir = tmpDir(t);
  write(path.join(dir, 'data', 'emails.jsonl'), jsonl([chat('e-1', 'brief', 'Hi Dana, ...'), chat('e-2', 'brief 2', 'Hello Sam, ...')]));
  const r = await run(['import', 'data/emails.jsonl', '--out', 'proj/pmstack/project.json', '--view', 'email', '--pattern', 'chain', '--name', 'Outreach writer'], dir);
  assert.equal(r.code, 0, r.err);
  const p = readJson(path.join(dir, 'proj', 'pmstack', 'project.json'));
  assert.equal(p.name, 'Outreach writer');
  assert.equal(p.experience.renderer, 'email');
  assert.equal(p.experience.pattern, 'chain');
  assert.equal(p.tracesFile, '../../data/emails.jsonl');
  assert.equal(p.settings.guessed, undefined);
  assert.match(r.out, /Open it: node ".*pmstack\.mjs" studio ".*proj"/);
  const bad = await run(['import', 'data/emails.jsonl', '--view', 'hologram', '--out', 'x.json'], dir);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Unknown view "hologram"/);
  const badPattern = await run(['import', 'data/emails.jsonl', '--pattern', 'swarm', '--out', 'x.json'], dir);
  assert.equal(badPattern.code, 2);
  const versionAlone = await run(['import', 'data/emails.jsonl', '--version', 'Version 2', '--out', 'y.json'], dir);
  assert.equal(versionAlone.code, 2);
  assert.match(versionAlone.err, /--version tags traces added with --append/);
  const missing = await run(['import', 'nope.jsonl'], dir);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /The trace file nope\.jsonl was not found/);
});

test('import --append --version adds new traces, skips known ids, and tags versions', async (t) => {
  const { dir, projectPath, tracesPath } = await folderProject(t, { traces: symbolTraces });
  write(path.join(dir, 'week2.jsonl'), jsonl([chat('s-4', 'dup', 'dup'), chat('s-5', 'monday?', 'Monday at 8:00 AM.', { channel: 'sms' }), chat('s-6', 'tues', 'Tuesday works.', { channel: 'web' })]));
  const r = await run(['import', 'week2.jsonl', '--append', '--version', 'Version 2', '--out', projectPath], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Added 2, skipped 1 already here/);
  assert.match(r.out, /Tagged the 4 earlier traces "Version 1" and the new ones "Version 2"/);
  const lines = fs.readFileSync(tracesPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((x) => [x.id, x.metadata.version]), [['s-1', 'Version 1'], ['s-2', 'Version 1'], ['s-3', 'Version 1'], ['s-4', 'Version 1'], ['s-5', 'Version 2'], ['s-6', 'Version 2']]);
  const p = readJson(projectPath);
  assert.equal(p.revision, 2);
  assert.ok(p.experience.filters.includes('version'));

  write(path.join(dir, 'week3.jsonl'), jsonl([chat('s-7', 'wed', 'Wednesday.', { channel: 'sms' })]));
  const r2 = await run(['import', 'week3.jsonl', '--append', '--version', 'Version 3', '--out', projectPath], dir);
  assert.match(r2.out, /Added 1, skipped 0 already here/);
  assert.match(r2.out, /Tagged the new traces "Version 3"\./);
  const plain = await run(['import', 'week3.jsonl', '--append', '--out', projectPath], dir);
  assert.match(plain.out, /Added 0, skipped 1 already here/);
  assert.equal(readJson(projectPath).revision, 3, 'nothing new, nothing written');
  const noProject = await run(['import', 'week3.jsonl', '--append', '--out', path.join(dir, 'none', 'project.json')], dir);
  assert.equal(noProject.code, 2);
});

test('adding traces never rewrites a trace file pmstack could not read in full', async (t) => {
  const { dir, projectPath, tracesPath } = await folderProject(t, { traces: [chat('a', 'q', 'r'), chat('b', 'q', 'r')] });
  fs.appendFileSync(tracesPath, '{"id": "half-writ\n');
  const before = fs.readFileSync(tracesPath, 'utf8');
  write(path.join(dir, 'new.jsonl'), jsonl([chat('n-1', 'q', 'r')]));
  const tagged = await run(['import', 'new.jsonl', '--append', '--version', 'Version 2', '--out', projectPath], dir);
  assert.equal(tagged.code, 2);
  assert.match(tagged.err, /traces\.jsonl has lines pmstack could not read \(Line 3\), so the file was not changed\. Fix those lines, or add the traces without --version\./);
  assert.equal(fs.readFileSync(tracesPath, 'utf8'), before);
  assert.equal(readJson(projectPath).revision, 1);
  const plain = await run(['import', 'new.jsonl', '--append', '--out', projectPath], dir);
  assert.equal(plain.code, 0, plain.err);
  assert.ok(fs.readFileSync(tracesPath, 'utf8').startsWith(before), 'a plain append keeps every line');

  const json = path.join(dir, 'traces.json');
  const jsonText = JSON.stringify([chat('c-1', 'q', 'r'), 42, chat('c-2', 'q', 'r')]);
  write(json, jsonText);
  write(projectPath, JSON.stringify({ ...readJson(projectPath), tracesFile: '../traces.json' }));
  const entries = await run(['import', 'new.jsonl', '--append', '--out', projectPath], dir);
  assert.equal(entries.code, 2);
  assert.match(entries.err, /traces\.json has entries pmstack could not read \(Trace 2\), so the file was not changed\. Fix it and try again\./);
  assert.equal(fs.readFileSync(json, 'utf8'), jsonText);
});

test('adding traces stops at 20,000 instead of dropping the ones past it', async (t) => {
  const { dir, projectPath, tracesPath } = await folderProject(t, { traces: [chat('a', 'q', 'r')] });
  const many = Array.from({ length: 20005 }, (_, i) => JSON.stringify({ id: `t${i}`, input: 'x' })).join('\n') + '\n';
  write(tracesPath, many);
  write(path.join(dir, 'new.jsonl'), jsonl([chat('n-1', 'q', 'r')]));
  for (const extra of [['--version', 'Version 2'], []]) {
    const r = await run(['import', 'new.jsonl', '--append', ...extra, '--out', projectPath], dir);
    assert.equal(r.code, 2);
    assert.match(r.err, /A project holds up to 20,000 traces, and traces\.jsonl already has that many\. Nothing was added\./);
    assert.equal(fs.readFileSync(tracesPath, 'utf8'), many);
  }
});

// ---------------------------------------------------------------------------
// validate

test('validate: 0 when fine, 1 with problems, 2 when unreadable', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: symbolTraces, build: symbolsProject });
  const ok = await run(['validate', projectPath], dir);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /is a valid project: 4 traces, 3 reviewed, 1 failure mode, 2 checks\./);

  const p = readJson(projectPath);
  write(projectPath, JSON.stringify({ ...p, reviews: { ...p.reviews, 't-9': p.reviews['s-1'] } }));
  const bad = await run(['validate', projectPath], dir);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /has 1 problem:\n {2}- Review for "t-9" points to a trace that does not exist\./);

  write(projectPath, '{\n  "format": "pmstack.project/1",\n  "id": "x"\n  "name": "y"\n}');
  const broken = await run(['validate', projectPath], dir);
  assert.equal(broken.code, 2);
  assert.match(broken.err, /could not be read \(line 4\)\. A comma, quote, or bracket is out of place\./);
  const missing = await run(['validate', 'nope.json'], dir);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /nope\.json was not found/);
});

// ---------------------------------------------------------------------------
// check, checks, regression-set

test('check prints a table and exits 1 when a trace fails', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: symbolTraces, build: symbolsProject });
  const r = await run(['check', projectPath], dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Ran 2 checks on 4 traces\./);
  assert.match(r.out, /No formatting symbols in text messages \(ck-stray\)\s+1 of 4/);
  assert.match(r.out, /No formatting symbols in text messages fails on: s-1/);
  assert.match(r.out, /3 of 4 traces pass every check\./);

  const ci = await run(['check', projectPath, '--only-ci'], dir);
  assert.equal(ci.code, 1);
  assert.match(ci.out, /Ran 1 check on 4 traces/);
  assert.equal((await run(['check', projectPath, '--only-ci', '--max-fail', '1'], dir)).code, 0);
  const rate = await run(['check', projectPath, '--only-ci', '--max-fail-rate', '0.1'], dir);
  assert.equal(rate.code, 1);
  assert.match(rate.out, /25% of traces fail a check, more than the limit of 10%\./);
  assert.equal((await run(['check', projectPath, '--only-ci', '--max-fail-rate', '0.5'], dir)).code, 0);
  const both = await run(['check', projectPath, '--max-fail', '1', '--max-fail-rate', '0.5'], dir);
  assert.equal(both.code, 2);
  assert.equal((await run(['check', projectPath, '--max-fail-rate', '2'], dir)).code, 2);
});

test('a check that cannot run exits 2', async (t) => {
  const { dir, projectPath } = await folderProject(t, {
    traces: symbolTraces,
    build: (p) => {
      const q = symbolsProject(p);
      return { ...q, checks: [{ ...q.checks[0], id: 'ck-broken', rule: { op: 'regex', target: 'assistant', value: '([unclosed', flags: '' }, when: null }] };
    },
  });
  const r = await run(['check', projectPath], dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /could not run on s-1/);
});

test('checks.json with fresh traces and a regression set: exit 1 only when a known failure comes back', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: symbolTraces, build: symbolsProject });
  const checks = await run(['checks', projectPath, '--out', 'checks.json'], dir);
  assert.equal(checks.code, 0);
  assert.match(checks.out, /Wrote checks\.json: 1 code check that runs on every change\./);
  const file = readJson(path.join(dir, 'checks.json'));
  assert.equal(file.format, 'pmstack.checks/1');
  assert.deepEqual(file.checks.map((c) => c.id), ['ck-stray']);

  const reg = await run(['regression-set', projectPath, '--out', 'regression.jsonl'], dir);
  assert.equal(reg.code, 0);
  assert.match(reg.out, /Wrote regression\.jsonl: 2 traces every future version must still handle/);
  const lines = fs.readFileSync(path.join(dir, 'regression.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), ['s-1', 's-2']);
  assert.deepEqual(lines[0].expected, { verdict: 'pass', modes: { 'fm-stray': 'pass' } });

  const noTraces = await run(['check', 'checks.json'], dir);
  assert.equal(noTraces.code, 2);
  assert.match(noTraces.err, /A checks file needs --traces <file>/);

  write(path.join(dir, 'fresh.jsonl'), jsonl([
    chat('s-1', 'can I come friday', 'Your time is Friday at 9:30 AM.', { channel: 'sms' }),
    chat('s-2', 'friday at 930?', 'Friday at 9:30 AM works.', { channel: 'sms' }),
  ]));
  const good = await run(['check', 'checks.json', '--traces', 'fresh.jsonl', '--expect', 'regression.jsonl'], dir);
  assert.equal(good.code, 0, good.out + good.err);
  assert.match(good.out, /Regression set: 2 traces checked\. No known failure came back\./);

  write(path.join(dir, 'fresh.jsonl'), jsonl([
    chat('s-1', 'can I come friday', 'Your time is **Friday** at 9:30 AM.', { channel: 'sms' }),
    chat('s-9', 'new', 'A **new** one.', { channel: 'sms' }),
  ]));
  const back = await run(['check', 'checks.json', '--traces', 'fresh.jsonl', '--expect', 'regression.jsonl'], dir);
  assert.equal(back.code, 1);
  assert.match(back.out, /Regression set: 1 trace checked, 1 known failure came back\./);
  assert.match(back.out, /s-1: No formatting symbols in text messages failed\./);
  assert.match(back.err, /1 regression trace was not in the traces you checked \(s-2\)/);

  const onProject = await run(['check', projectPath, '--traces', 'fresh.jsonl', '--expect', 'regression.jsonl', '--only-ci'], dir);
  assert.equal(onProject.code, 1);
  assert.match(onProject.out, /which was marked fixed/);
});

test('regression-set on a project with nothing to keep writes an empty file', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: symbolTraces });
  const r = await run(['regression-set', projectPath], dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /Wrote an empty regression\.jsonl/);
  assert.equal(fs.readFileSync(path.join(dir, 'regression.jsonl'), 'utf8'), '');
  const c = await run(['checks', projectPath], dir);
  assert.match(c.out, /with no checks yet/);
});

// ---------------------------------------------------------------------------
// report, retrieval, agreement

test('report writes Markdown and the funnel picture beside it', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: symbolTraces, build: symbolsProject });
  const r = await run(['report', projectPath, '--out', 'out/findings.md'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Wrote out\/findings\.md and out\/findings-funnel\.svg\./);
  const md = fs.readFileSync(path.join(dir, 'out', 'findings.md'), 'utf8');
  assert.match(md, /!\[The funnel of an AI experience\]\(findings-funnel\.svg\)/);
  assert.match(md, /Stray \*\* symbols in texts/);
  const svg = fs.readFileSync(path.join(dir, 'out', 'findings-funnel.svg'), 'utf8');
  assert.match(svg, /^<svg/);
  const def = await run(['report', projectPath], dir);
  assert.equal(def.code, 0);
  assert.ok(fs.existsSync(path.join(dir, 'report.md')) && fs.existsSync(path.join(dir, 'report-funnel.svg')));
});

test('retrieval: recall at k and mean reciprocal rank, with --k and --traces', async (t) => {
  const withDocs = (id, docs) => ({ id, input: `Question ${id}`, steps: [{ type: 'retrieval', name: 'search', documents: docs.map((d) => ({ id: d, title: d, text: '...' })) }], output: 'Answer' });
  const traces = [withDocs('q-1', ['d1', 'd2']), withDocs('q-2', ['d3']), withDocs('q-3', ['d4'])];
  const review = (needed) => ({ verdict: 'fail', note: '', stage: null, step: null, good: '', modes: [], successModes: [], retrieval: { needed, missing: [] }, reviewedAt: at(1), at: at(1) });
  const { dir, projectPath } = await folderProject(t, { traces, build: (p) => ({ ...p, reviews: { 'q-1': review(['d2']), 'q-2': review(['d9']) } }) });
  const r = await run(['retrieval', projectPath], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Retrieval on 2 reviewed traces that mark the sources they needed:/);
  assert.match(r.out, /Found in the top 5 \(recall at 5\)\s+50%/);
  assert.match(r.out, /Mean reciprocal rank\s+0\.25/);
  const k1 = await run(['retrieval', projectPath, '--k', '1'], dir);
  assert.match(k1.out, /Found in the top 1 \(recall at 1\)\s+0%/);
  write(path.join(dir, 'rerun.jsonl'), jsonl([withDocs('q-1', ['d2', 'd1']), withDocs('q-2', ['d9'])]));
  const rerun = await run(['retrieval', projectPath, '--traces', 'rerun.jsonl'], dir);
  assert.match(rerun.out, /recall at 5\)\s+100%/);
  assert.match(rerun.out, /Mean reciprocal rank\s+1\.00/);
  const none = await folderProject(t, { traces });
  const empty = await run(['retrieval', none.projectPath], none.dir);
  assert.equal(empty.code, 2);
  assert.match(empty.err, /No reviewed traces mark the sources they needed yet/);
});

test('agreement for a code check uses every labeled trace', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: symbolTraces, build: symbolsProject });
  const r = await run(['agreement', projectPath, '--check', 'ck-stray'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No formatting symbols in text messages \(Code check\) for "Stray \*\* symbols in texts", on 3 labeled traces\./);
  assert.match(r.out, /Catches real failures\s+100%\s+\(1 of 1\)/);
  assert.match(r.out, /Agrees on good traces\s+100%\s+\(2 of 2\)/);
  const long = await run(['agreement', projectPath, '--check', 'ck-long'], dir);
  assert.match(long.out, /Check missed these failures: s-1/);
  const missing = await run(['agreement', projectPath, '--check', 'ck-nope'], dir);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /No check with id "ck-nope"\. Checks in this project: ck-stray, ck-long\./);
  const noFlag = await run(['agreement', projectPath], dir);
  assert.equal(noFlag.code, 2);
});

// ---------------------------------------------------------------------------
// help and usage

test('help, version, and usage errors', async (t) => {
  const dir = tmpDir(t);
  const help = await run([], dir);
  assert.equal(help.code, 0);
  assert.match(help.out, /^pmstack 2\.1\.0: Find how your AI product fails\. Iterate\. Raw pattern recognition meets Product Sense\./);
  for (const cmd of ['studio', 'import', 'validate', 'check', 'judge', 'agreement', 'estimate', 'retrieval', 'report', 'regression-set', 'checks', 'policy']) {
    const r = await run([cmd, '--help'], dir);
    assert.equal(r.code, 0, cmd);
    assert.match(r.out, new RegExp(`^Usage: pmstack ${cmd}`), cmd);
    const text = r.out;
    assert.ok(!text.includes(String.fromCharCode(0x2014)) && !text.includes(String.fromCharCode(0x2013)), `${cmd} help has no long dashes`);
    assert.ok(!/\b(TPR|TNR|LLM|regex|CI)\b/.test(text), `${cmd} help uses plain words`);
  }
  assert.equal((await run(['help', 'judge'], dir)).out.split('\n')[0], (await run(['judge', '-h'], dir)).out.split('\n')[0]);
  assert.equal((await run(['--version'], dir)).out, 'pmstack 2.1.0\n');
  const unknownFlag = await run(['validate', 'x.json', '--fast'], dir);
  assert.equal(unknownFlag.code, 2);
  assert.match(unknownFlag.err, /Unknown option --fast for pmstack validate\.\nUsage: pmstack validate/);
  const missingArg = await run(['report'], dir);
  assert.equal(missingArg.code, 2);
  assert.match(missingArg.err, /Missing the project file\./);
  const extra = await run(['validate', 'a.json', 'b.json'], dir);
  assert.equal(extra.code, 2);
  const noValue = await run(['report', 'a.json', '--out'], dir);
  assert.match(noValue.err, /--out needs a value/);
  const unknown = await run(['frob'], dir);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /Unknown command "frob"/);
});
