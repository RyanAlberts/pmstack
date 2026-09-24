// pmstack policy (SPEC 12.8): violations grouped by rule, exit codes, --json, and --list-tools.
// Also: pmstack check runs policy checks like any code check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { run, tmpDir, write, jsonl, folderProject, readJson } from './helpers.mjs';

function agentTrace(id, user, calls, reply, metadata = {}) {
  const messages = [{ role: 'user', content: user }];
  calls.forEach(([name, args, result], i) => {
    const callId = `${id}-c${i}`;
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    messages.push({ role: 'tool', tool_call_id: callId, name, content: JSON.stringify(result) });
  });
  messages.push({ role: 'assistant', content: reply });
  return { id, metadata, messages };
}

const traces = [
  agentTrace('p-1', 'What is on my bill?', [['verify_identity', { phone: '555-0100' }, { account_id: 'A-1' }], ['get_bill', { account_id: 'A-1' }, { total: 82.5 }]], 'Your bill is $82.50.'),
  agentTrace('p-2', 'The outage took us down. Credit please.', [['issue_credit', { account_id: 'A-2', amount: 20 }, { status: 'applied' }]], 'Done, $20 is off your next bill.'),
  agentTrace('p-3', 'Close my account for good.', [['verify_identity', { phone: '555-0199' }, { account_id: 'A-3' }], ['delete_account', { account_id: 'A-3' }, { ok: true }]], 'Your account is deleted.'),
  agentTrace('p-4', 'What are your hours?', [], 'We are open 8 AM to 8 PM every day.'),
];

const policy = {
  format: 'pmstack.policy/1',
  name: 'Test support policy',
  onlyListedTools: true,
  tools: {
    verify_identity: { access: 'read' },
    get_bill: { access: 'read' },
    issue_credit: { access: 'write', confirm: true },
  },
  rules: [
    { id: 'verify-first', type: 'requires-before', tools: ['get_bill', 'issue_credit'], before: 'verify_identity', why: 'Verify identity before reading or changing an account.' },
    { id: 'never-delete', type: 'deny-tools', tools: ['delete_account'], why: 'Agents may never delete accounts.' },
  ],
};

function files(t) {
  const dir = tmpDir(t);
  write(path.join(dir, 'traces.jsonl'), jsonl(traces));
  write(path.join(dir, 'clean.jsonl'), jsonl([traces[0], traces[3]]));
  write(path.join(dir, 'policy.json'), JSON.stringify(policy, null, 2));
  return dir;
}

test('policy groups violations by rule and exits 1 when any call breaks it', async (t) => {
  const dir = files(t);
  const r = await run(['policy', 'traces.jsonl', '--policy', 'policy.json'], dir);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /^Checked 4 traces against "Test support policy"\./);
  assert.match(r.out, /Do this first \(verify-first\): 1 trace, 1 call\n {2}Why: Verify identity before reading or changing an account\.\n {2}p-2 {2}step m1\.c0 {2}issue_credit/);
  assert.match(r.out, /Ask before acting \(confirm, issue_credit\): 1 trace/, 'rules from the tools list group by tool, so each why fits');
  assert.match(r.out, /Never use these tools \(never-delete\): 1 trace, 1 call/);
  assert.match(r.out, /Only listed tools \(only-listed\): 1 trace/);
  assert.match(r.out, /Breaks the policy in 2 of 4 traces\.\n$/);

  const clean = await run(['policy', 'clean.jsonl', '--policy', 'policy.json'], dir);
  assert.equal(clean.code, 0, clean.out + clean.err);
  assert.match(clean.out, /No call breaks the policy in 2 traces\./);
});

test('policy --user names the people the agent serves', async (t) => {
  const dir = files(t);
  const r = await run(['policy', 'traces.jsonl', '--policy', 'policy.json', '--user', 'employee'], dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Why: Actions that change something need a yes from the employee first\./);
  assert.match(r.out, /issue_credit called without a yes from the employee/);
  assert.doesNotMatch(r.out, /customer/);
  const empty = await run(['policy', 'traces.jsonl', '--policy', 'policy.json', '--user', ' '], dir);
  assert.equal(empty.code, 2);
  assert.match(empty.err, /--user needs a word/);
});

test('policy --json prints results for scripts', async (t) => {
  const dir = files(t);
  const r = await run(['policy', 'traces.jsonl', '--policy', 'policy.json', '--json'], dir);
  assert.equal(r.code, 1);
  const body = JSON.parse(r.out);
  assert.equal(body.traces, 4);
  assert.equal(body.failing, 2);
  const p2 = body.results.find((x) => x.traceId === 'p-2');
  assert.equal(p2.verdict, 'fail');
  assert.deepEqual(p2.violations.map((v) => v.ruleId).sort(), ['confirm', 'verify-first']);
});

test('policy --list-tools lists tools with call counts and a read or write guess', async (t) => {
  const dir = files(t);
  const r = await run(['policy', 'traces.jsonl', '--list-tools'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Tools used in 3 of 4 traces \(5 calls\):/);
  assert.match(r.out, /verify_identity\s+2\s+2\s+read/);
  assert.match(r.out, /get_bill\s+1\s+1\s+read/);
  assert.match(r.out, /issue_credit\s+1\s+1\s+write/);
  assert.match(r.out, /delete_account\s+1\s+1\s+write/);
  const json = await run(['policy', 'traces.jsonl', '--list-tools', '--json'], dir);
  const body = JSON.parse(json.out);
  assert.equal(body.calls, 5);
  assert.deepEqual(body.tools.map((x) => [x.name, x.access]), [['verify_identity', 'read'], ['delete_account', 'write'], ['get_bill', 'read'], ['issue_credit', 'write']]);
  const none = await run(['policy', 'clean.jsonl', '--list-tools'], dir);
  assert.match(none.out, /Tools used in 1 of 2 traces/);
});

test('policy input errors exit 2', async (t) => {
  const dir = files(t);
  const noPolicy = await run(['policy', 'traces.jsonl'], dir);
  assert.equal(noPolicy.code, 2);
  assert.match(noPolicy.err, /Pass --policy <policy\.json>\. To start one, list the tools your agent uses/);
  write(path.join(dir, 'bad-policy.json'), JSON.stringify({ format: 'pmstack.policy/1', rules: [{ id: 'x', type: 'arg-max', tools: ['issue_credit'] }] }));
  const bad = await run(['policy', 'traces.jsonl', '--policy', 'bad-policy.json'], dir);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /bad-policy\.json has \d+ problems?:/);
  write(path.join(dir, 'broken.json'), '{ "format": ');
  assert.equal((await run(['policy', 'traces.jsonl', '--policy', 'broken.json'], dir)).code, 2);
  assert.equal((await run(['policy', 'missing.jsonl', '--policy', 'policy.json'], dir)).code, 2);
});

test('policy reads a project file, and pmstack check runs its policy check like any code check', async (t) => {
  const { dir, projectPath } = await folderProject(t, {
    traces,
    build: (p) => {
      const mode = { id: 'fm-policy', kind: 'failure', name: 'Breaks a tool policy', definition: 'Fails when a call breaks the policy.', stage: 'act', template: 'policy', createdAt: '2026-09-15T09:00:00.000Z', source: 'human' };
      const check = { id: 'ck-policy', modeId: 'fm-policy', type: 'policy', name: 'Tool policy', policy, ruleIds: [], when: null, ci: true };
      return { ...p, modes: [mode], checks: [check] };
    },
  });
  write(path.join(dir, 'policy.json'), JSON.stringify(policy));
  const r = await run(['policy', projectPath, '--policy', 'policy.json'], dir);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /Breaks the policy in 2 of 4 traces\./);
  const check = await run(['check', projectPath], dir);
  assert.equal(check.code, 1);
  assert.match(check.out, /Tool policy \(ck-policy\)\s+2 of 4/);
  assert.match(check.out, /2 of 4 traces pass every check\./);
  assert.equal(readJson(projectPath).revision, 1, 'policy never writes the project');
});
