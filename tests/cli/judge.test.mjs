// pmstack judge, estimate, and agreement for AI judges, with a fake model command (fake-judge.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as lib from '../../docs/studio/lib/index.mjs';
import { run, folderProject, readJson, write, jsonl, chat, judgeTraces, withJudge, FAKE_JUDGE } from './helpers.mjs';

const fake = (mode, model = true) => `node "${FAKE_JUDGE}" ${mode}${model ? ' --model {model}' : ''}`;
const setup = (t, opts = {}) => folderProject(t, { traces: judgeTraces(), build: (p) => withJudge(p, opts) });
const splitIds = (p, modeId, name) => Object.entries(p.splits[modeId].assign).filter(([, s]) => s === name).map(([id]) => id).sort();

test('judge runs the tuning set, fills {model}, never sends examples, and records a round', async (t) => {
  const { dir, projectPath } = await setup(t);
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--concurrency', '3'], dir);
  assert.equal(r.code, 0, r.err);
  // The path is quoted only when it has a space, so accept it either way.
  assert.match(r.err, /Judging 18 traces \(tuning set\) for "Bad reply" with: node "?[^"\n]*fake-judge\.mjs"? single --model test-model-1/);
  assert.match(r.out, /Judged 18 traces \(tuning set\) with "Bad reply judge"\./);
  assert.match(r.out, /Catches real failures\s+100%\s+\(9 of 9\)/);
  assert.match(r.out, /Agrees on good traces\s+100%\s+\(9 of 9\)/);
  const p = readJson(projectPath);
  const check = p.checks.find((c) => c.id === 'ck-judge');
  const modeId = check.modeId;
  const tuning = splitIds(p, modeId, 'tuning');
  assert.deepEqual(Object.keys(check.results).sort(), tuning, 'results for exactly the tuning set');
  for (const id of splitIds(p, modeId, 'examples')) assert.ok(!(id in check.results), `example ${id} not judged`);
  assert.equal(check.results['t-01'] ? check.results['t-01'].verdict : 'fail', 'fail');
  assert.match(Object.values(check.results)[0].critique, /test-model-1/, '{model} was filled in');
  assert.equal(check.runs.length, 1);
  assert.equal(check.runs[0].split, 'tuning');
  assert.equal(check.runs[0].n, 18);
  assert.equal(check.test, null);
  assert.ok(p.revision >= 3, 'saved every 10 results and at the end');
  assert.ok(!('traces' in p));
});

test('the final test needs --final, then reveals it; estimate works on unlabeled results', async (t) => {
  const { dir, projectPath } = await setup(t);
  const refused = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--split', 'test'], dir);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /The final test is used once, at the end\. Add --final/);
  assert.equal(readJson(projectPath).revision, 1);

  const hidden = await run(['estimate', projectPath, '--check', 'ck-judge'], dir);
  assert.equal(hidden.code, 2);
  assert.match(hidden.err, /still hidden/);
  const hiddenAgreement = await run(['agreement', projectPath, '--check', 'ck-judge', '--split', 'test'], dir);
  assert.equal(hiddenAgreement.code, 2);

  const final = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--split', 'test', '--final'], dir);
  assert.equal(final.code, 0, final.err);
  assert.match(final.out, /Judged 16 traces \(final test\)/);
  assert.match(final.out, /The final test is now revealed\./);
  let p = readJson(projectPath);
  const check = p.checks[0];
  assert.ok(check.test && check.test.revealedAt);
  assert.ok(p.splits[check.modeId].revealedAt);
  assert.equal(check.runs.at(-1).split, 'test');

  const noResults = await run(['estimate', projectPath, '--check', 'ck-judge'], dir);
  assert.equal(noResults.code, 2);
  assert.match(noResults.err, /No judge results on unlabeled traces yet/);

  const unlabeled = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--split', 'unlabeled'], dir);
  assert.equal(unlabeled.code, 0, unlabeled.err);
  assert.match(unlabeled.out, /The judge flagged 3 of 10 \(30%\)\./);
  const est = await run(['estimate', projectPath, '--check', 'ck-judge'], dir);
  assert.equal(est.code, 0, est.err);
  assert.match(est.out, /On the 10 traces you have not labeled, the judge flagged 30% of them\./);
  assert.match(est.out, /the likely true failure rate is 30%/);
  assert.match(est.out, /From the final test: catches real failures 100% \(8 of 8\)/);
  const agree = await run(['agreement', projectPath, '--check', 'ck-judge', '--split', 'test'], dir);
  assert.equal(agree.code, 0);
  assert.match(agree.out, /on 16 labeled traces in the final test/);

  // Changing the prompt after the reveal makes the final test out of date.
  p = readJson(projectPath);
  write(projectPath, JSON.stringify({ ...p, checks: [{ ...p.checks[0], prompt: 'A new prompt.\n{{trace}}' }] }));
  const outdated = await run(['estimate', projectPath, '--check', 'ck-judge'], dir);
  assert.equal(outdated.code, 2);
  assert.match(outdated.err, /Label new traces for a fresh final test\./);
});

test('a revealed final test is never run again; it can only be finished', async (t) => {
  const { dir, projectPath } = await setup(t);
  const final = ['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--split', 'test', '--final'];
  const first = await run([...final, '--limit', '5'], dir);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /The final test is now revealed\./);
  const revealed = readJson(projectPath).checks[0].test;
  const finish = await run(final, dir);
  assert.equal(finish.code, 0, finish.err);
  assert.match(finish.out, /Judged 11 traces \(final test\)/, 'only the final test traces with no answer');
  assert.match(finish.out, /Added answers to the final test revealed on \d{4}-\d{2}-\d{2}\./);
  assert.deepEqual(readJson(projectPath).checks[0].test, revealed, 'the first reveal is kept');
  const again = await run(final, dir);
  assert.equal(again.code, 2);
  assert.match(again.err, /every final test trace has an answer\. It is used once, so it cannot run again\./);

  // After the prompt changes, the final test is out of date and stays that way.
  const p = readJson(projectPath);
  write(projectPath, JSON.stringify({ ...p, checks: [{ ...p.checks[0], prompt: 'A new prompt.\n{{trace}}' }] }));
  const before = fs.readFileSync(projectPath, 'utf8');
  const outdated = await run(final, dir);
  assert.equal(outdated.code, 2);
  assert.match(outdated.err, /was used on \d{4}-\d{2}-\d{2}, and the judge or your labels changed since\. Label 30 new traces and start a fresh final test in Eval Studio \(Checks\)\./);
  assert.equal(fs.readFileSync(projectPath, 'utf8'), before, 'check.test and everything else unchanged');
  assert.match((await run(['estimate', projectPath, '--check', 'ck-judge'], dir)).err, /Label new traces for a fresh final test\./);
});

test('a timeout also stops what the command started', { skip: process.platform === 'win32' }, async (t) => {
  const { dir, projectPath } = await setup(t);
  // sh runs sleep as its own child, which keeps the output open after sh is stopped.
  const script = write(path.join(dir, 'slow.sh'), 'cat > /dev/null\nsleep 20\necho \'{"critique": "late", "result": "Pass"}\'\n');
  const start = Date.now();
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', `sh "${script}"`, '--timeout', '0.5', '--limit', '1'], dir);
  const took = Date.now() - start;
  assert.equal(r.code, 2);
  assert.match(r.err, /No answer within 0\.5 seconds\./);
  assert.ok(took < 5000, `returned after ${took} ms`);
});

test('batches of traces in one call', async (t) => {
  const { dir, projectPath } = await setup(t);
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('batch'), '--batch', '5', '--limit', '12'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Judged 12 traces/);
  const results = readJson(projectPath).checks[0].results;
  assert.equal(Object.keys(results).length, 12);
  assert.match(Object.values(results)[0].critique, /Batch answer from test-model-1/);
  const tooBig = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('batch'), '--batch', '11'], dir);
  assert.equal(tooBig.code, 2);
  assert.match(tooBig.err, /--batch needs a whole number from 1 to 10/);
});

test('timeouts, failing commands, and unreadable answers record nothing', async (t) => {
  const { dir, projectPath } = await setup(t);
  const slow = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('sleep'), '--timeout', '0.3', '--limit', '2'], dir);
  assert.equal(slow.code, 2);
  assert.match(slow.err, /None of the traces could be judged\. No answer within 0\.3 seconds\./);
  const garbage = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('garbage'), '--limit', '3'], dir);
  assert.equal(garbage.code, 2);
  assert.match(garbage.err, /no readable Pass or Fail result/);
  const exit1 = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('exit1'), '--limit', '1'], dir);
  assert.equal(exit1.code, 2);
  assert.match(exit1.err, /exited with code 1: boom: the model is unavailable/);
  const missing = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', 'no-such-command-pmstack --x', '--limit', '1'], dir);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /Could not start "no-such-command-pmstack": the command was not found\./);
  const p = readJson(projectPath);
  assert.deepEqual(p.checks[0].results, {});
  assert.deepEqual(p.checks[0].unreadable, []);
});

test('a command that never reads its input does not crash the run', async (t) => {
  const long = 'x'.repeat(20000);
  const traces = judgeTraces().map((tr) => ({ ...tr, messages: tr.messages.map((m) => (m.role === 'user' ? { ...m, content: m.content + ' ' + long } : m)) }));
  const { dir, projectPath } = await folderProject(t, { traces, build: (p) => withJudge(p) });
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('noread'), '--batch', '10', '--limit', '10'], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /None of the traces could be judged\. The batch answer had no readable Pass or Fail result/);
});

test('some traces fail, the rest are kept, and the exit code is 1', async (t) => {
  const { dir, projectPath } = await setup(t);
  // The fake answers only for traces it can find; an empty batch answer leaves traces unjudged.
  const script = path.join(dir, 'half.mjs');
  write(script, `let s='';for await (const c of process.stdin) s+=c; if (s.includes('Question 2')) { process.stdout.write('nothing'); } else { process.stdout.write(JSON.stringify({ critique: 'ok', result: s.includes('BAD') ? 'Fail' : 'Pass' })); }`);
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', `node "${script}"`], dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /could not be judged/);
  assert.ok(Object.keys(readJson(projectPath).checks[0].results).length > 0);
});

test('a judge without a model cannot fill {model}', async (t) => {
  const { dir, projectPath } = await folderProject(t, { traces: judgeTraces(), build: (p) => withJudge(p, { model: '' }) });
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single')], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /has no model yet/);
  const ok = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single', false), '--limit', '2'], dir);
  assert.equal(ok.code, 0, ok.err);
});

test('judge refuses code checks and unknown ids, and warns about thin labels', async (t) => {
  const { dir, projectPath } = await folderProject(t, {
    traces: judgeTraces(),
    build: (p) => {
      const q = withJudge(p);
      return lib.addCheck(q, { id: 'ck-code', modeId: q.checks[0].modeId, type: 'code', name: 'Says BAD' }).project;
    },
  });
  const code = await run(['judge', projectPath, '--check', 'ck-code', '--cmd', fake('single')], dir);
  assert.equal(code.code, 2);
  assert.match(code.err, /is a code check/);
  const nope = await run(['judge', projectPath, '--check', 'ck-x', '--cmd', fake('single')], dir);
  assert.match(nope.err, /No check with id "ck-x"/);
  const noCmd = await run(['judge', projectPath, '--check', 'ck-judge'], dir);
  assert.match(noCmd.err, /Pass --cmd/);
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--limit', '1'], dir);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /Trust a judge only after/, '20 of each is enough');

  const thin = await folderProject(t, {
    traces: judgeTraces(),
    build: (p) => {
      const q = withJudge(p);
      const modeId = q.checks[0].modeId;
      const keep = Object.fromEntries(Object.entries(q.labels[modeId]).filter(([id]) => ['t-01', 't-02', 't-03', 't-04', 't-05', 't-21', 't-22', 't-23', 't-24', 't-25'].includes(id)));
      return { ...q, labels: { [modeId]: keep } };
    },
  });
  const warned = await run(['judge', thin.projectPath, '--check', 'ck-judge', '--cmd', fake('single')], thin.dir);
  assert.equal(warned.code, 0, warned.err);
  assert.match(warned.err, /has 5 Problem labels and 5 Good labels\. Trust a judge only after at least 20 of each; aim for about 50 of each\./);
});

test('--traces judges a separate file; ids that match labeled project traces are skipped with a warning', async (t) => {
  const { dir, projectPath } = await setup(t);
  write(path.join(dir, 'sample.jsonl'), jsonl([
    chat('t-01', 'collides with a labeled trace', 'BAD but a different trace'),
    chat('u-01', 'collides with an unlabeled trace', 'Fine now'),
    chat('p-01', 'production one', 'BAD production reply'),
    chat('p-02', 'production two', 'Great reply'),
  ]));
  const wrongSplit = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--traces', 'sample.jsonl', '--split', 'tuning'], dir);
  assert.equal(wrongSplit.code, 2);
  assert.match(wrongSplit.err, /Use it with --split unlabeled/);
  const r = await run(['judge', projectPath, '--check', 'ck-judge', '--cmd', fake('single'), '--traces', 'sample.jsonl'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /2 traces in sample\.jsonl have the same id as traces in the project\. Skipped 1 that you labeled in the project \(t-01\)\. .* the other 1 replace the results/);
  const results = readJson(projectPath).checks[0].results;
  assert.deepEqual(Object.keys(results).sort(), ['p-01', 'p-02', 'u-01']);
  assert.equal(results['p-01'].verdict, 'fail');
  assert.equal(results['u-01'].verdict, 'pass', 'judged the file version of u-01');
});
