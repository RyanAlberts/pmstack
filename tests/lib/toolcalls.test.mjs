import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeTrace, defaultExperience, createProject, validateProject, outputText, buildJudgePrompt, addMode, updateMode,
  runCheck, runChecks, checkAgreement, addCheck, ciChecks, reportModel, stepBadges, checkOptions, isCodeCheck, checkTypeLabel,
  JUDGE_TEMPLATES, OPERATORS,
  validatePolicy, evaluatePolicy, policyRuleLabels, policyRules, POLICY_RULE_TYPES, ruleLabel,
  validateIntents, evaluateRelevance, extractValues, groundedValues, successAfterError,
  toolCallSummary, toolCallList, toolInventory, guessAccess, toolAccess, templateStage, TOOL_CHECK_TEMPLATES, EXAMPLE_POLICY,
} from '../../docs/studio/lib/index.mjs';

const repo = new URL('../../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, repo), 'utf8'));
const exp = defaultExperience({ pattern: 'agent', userLabel: 'customer' });

// A chat trace in OpenAI format. Items: ['user', text], ['assistant', text], or
// ['call', name, args, result, say]; a call adds the assistant message and its tool result.
function trace(items, metadata = {}, id = 't-1') {
  const messages = [{ role: 'system', content: 'You are the Northstar support agent. Store hours 9 AM to 6 PM.' }];
  let k = 0;
  for (const [kind, a, b, c, d] of items) {
    if (kind === 'call') {
      const callId = `call_${k++}`;
      messages.push({ role: 'assistant', content: d || '', tool_calls: [{ id: callId, type: 'function', function: { name: a, arguments: JSON.stringify(b) } }] });
      if (c !== undefined) messages.push({ role: 'tool', tool_call_id: callId, content: typeof c === 'string' ? c : JSON.stringify(c) });
    } else messages.push({ role: kind, content: a });
  }
  return normalizeTrace({ id, metadata, messages }, exp);
}

const P = (tools, rules, extra = {}) => ({ format: 'pmstack.policy/1', name: 'Test', tools, rules, ...extra });
const TOOLS = {
  verify_identity: { access: 'read' },
  get_bill: { access: 'read' },
  request_approval: { access: 'read' },
  search_help: { access: 'read' },
  issue_credit: { access: 'write', confirm: true, maxPerTrace: 1, why: 'Credits cost money.' },
  change_plan: { access: 'write' },
};
const PLAIN = { ...TOOLS, issue_credit: { access: 'write' } };
const ids = (r) => r.violations.map((v) => v.ruleId);

const verified = ['call', 'verify_identity', { account_id: 'A-1' }, { status: 'verified', account_id: 'A-1' }];
const approved = ['call', 'request_approval', { account_id: 'A-1', amount: 80 }, { status: 'approved' }];
const credit = (amount = 80, extra = {}, result = { status: 'applied', amount }) => ['call', 'issue_credit', { account_id: 'A-1', amount, reason: 'outage', ...extra }, result];
const good = [
  ['user', 'We were down two days. Can I get a credit?'],
  verified,
  approved,
  ['assistant', 'I can put a $80 credit on your account. Want me to go ahead?'],
  ['user', 'Yes please'],
  credit(),
  ['assistant', 'Done. $80 is off your next bill.'],
];

const FULL = P(TOOLS, [
  { id: 'never-delete', type: 'deny-tools', tools: ['delete_account', 'run_sql'], why: 'Agents never delete accounts.' },
  { id: 'no-writes-by-text', type: 'deny-access', access: 'write', when: { path: 'metadata.channel', equals: 'sms' }, why: 'No account changes by text.' },
  { id: 'verify-first', type: 'requires-before', tools: ['get_bill', 'issue_credit'], before: 'verify_identity', why: 'Verify first.' },
  { id: 'same-account', type: 'arg-equals', tools: ['get_bill', 'issue_credit'], argPath: 'account_id', source: { tool: 'verify_identity', path: 'account_id' } },
  { id: 'credit-approval', type: 'approval-above', tools: ['issue_credit'], argPath: 'amount', max: 50, approvalTool: 'request_approval', why: 'Credits over $50 need a supervisor.' },
  { id: 'credit-cap', type: 'arg-max', tools: ['issue_credit'], argPath: 'amount', max: 200 },
  { id: 'credit-min', type: 'arg-min', tools: ['issue_credit'], argPath: 'amount', min: 1 },
  { id: 'plan-names', type: 'arg-in', tools: ['change_plan'], argPath: 'plan', values: ['basic', 'plus', 'gig'] },
  { id: 'no-card-numbers', type: 'arg-not-match', tools: '*', pattern: '\\b(?:\\d[ -]?){13,16}\\b', why: 'Never pass card numbers.' },
  { id: 'credit-reason', type: 'arg-required', tools: ['issue_credit'], argPath: 'reason' },
], { onlyListedTools: true, confirmationPatterns: ['\\byes\\b', 'go ahead'] });

// ------------------------------------------------------------------ policy files

test('validatePolicy accepts the shipped templates and reports plain errors', () => {
  for (const f of ['templates/tool-calls/policy.json', 'templates/tool-calls/policy-starter.json']) {
    assert.deepEqual(validatePolicy(readJson(f)), { ok: true, errors: [] }, f);
  }
  assert.deepEqual(validatePolicy(FULL), { ok: true, errors: [] });
  assert.deepEqual(validatePolicy(null).errors, ['This is not a policy file.']);
  const bad = validatePolicy({
    format: 'nope', onlyListedTools: 'yes', confirmationPatterns: ['('],
    tools: { a: { access: 'delete' }, b: { maxPerTrace: 1.5 } },
    rules: [
      { id: 'x', type: 'arg-max', tools: ['a'] },
      { id: 'x', type: 'teleport' },
      { id: 'confirm', type: 'deny-tools', tools: ['a'] },
      { id: 'p', type: 'arg-not-match', pattern: '[' },
      { id: 'e', type: 'arg-equals', tools: '*', argPath: 'id', source: {} },
      { id: 'w', type: 'deny-access', when: { equals: 'sms' } },
      { type: 'requires-before' },
    ],
  });
  assert.equal(bad.ok, false);
  const text = bad.errors.join('\n');
  for (const part of ['expected "pmstack.policy/1"', 'onlyListedTools must be true or false', 'Confirmation pattern "(" is not valid', 'Tool "a": access must be "read" or "write"', 'Tool "b": maxPerTrace must be a whole number', 'Rule "x" needs argPath', 'Rule "x" needs max: a number', 'Rule "x": the id is used twice', 'unknown type "teleport"', 'Rule "confirm": this id is kept', 'Rule "p": the pattern is not valid', 'Rule "e" needs source', 'Rule "w": when needs a path', 'Rule 7 needs an id', 'Rule 7 needs tools', 'Rule 7 needs before']) {
    assert.ok(text.includes(part), `missing error: ${part}\n${text}`);
  }
});

test('rule labels, rule types, and the rules a policy enforces', () => {
  assert.equal(policyRuleLabels.confirm, 'Ask before acting');
  assert.equal(policyRuleLabels['arg-equals'], 'Must match');
  assert.equal(POLICY_RULE_TYPES.length, 13);
  assert.ok(POLICY_RULE_TYPES.every((t) => t.label && t.hint && Array.isArray(t.needs)));
  const rules = policyRules(FULL);
  assert.deepEqual(rules.slice(0, 3).map((r) => [r.id, r.derived]), [['only-listed', true], ['confirm', true], ['max-per-trace', true]]);
  assert.deepEqual(rules[1].tools, ['issue_credit']);
  assert.equal(rules.length, 13);
  assert.equal(ruleLabel(rules[2], 'issue_credit', FULL), 'At most 1 time per conversation');
  assert.equal(ruleLabel({ type: 'deny-access', access: 'read' }), 'No read actions');
  assert.equal(policyRules(null).length, 0);
});

test('a clean trace passes every rule type at once', () => {
  assert.deepEqual(evaluatePolicy(FULL, trace(good)), { verdict: 'pass', violations: [] });
  assert.deepEqual(evaluatePolicy(null, trace(good)), { verdict: 'pass', violations: [] });
});

test('only listed tools, never use these tools, and "*"', () => {
  const r = evaluatePolicy(FULL, trace([['user', 'hi'], ['call', 'run_sql', { q: 'select 1' }, { rows: [] }], ['call', 'lookup_weather', {}, {}]]));
  assert.deepEqual(ids(r), ['only-listed', 'never-delete', 'only-listed']);
  const v = r.violations[1];
  assert.deepEqual(
    { ruleType: v.ruleType, label: v.label, stepId: v.stepId, tool: v.tool, message: v.message },
    { ruleType: 'deny-tools', label: 'Never use these tools', stepId: 'm2.c0', tool: 'run_sql', message: 'run_sql called, and this policy never allows it. Agents never delete accounts.' },
  );
  assert.equal(r.violations[0].fact, "run_sql called, but it is not on the policy's list of tools.");
  const star = P(TOOLS, [{ id: 'no-tools', type: 'deny-tools', tools: '*' }]);
  assert.deepEqual(ids(evaluatePolicy(star, trace(good))), ['no-tools', 'no-tools', 'no-tools']);
});

test('no write actions, with when', () => {
  const sms = evaluatePolicy(FULL, trace(good, { channel: 'sms' }));
  assert.deepEqual(ids(sms), ['no-writes-by-text']);
  assert.equal(sms.violations[0].message, 'issue_credit called, and it changes something (a write action). No account changes by text.');
  assert.equal(sms.violations[0].label, 'No write actions');
  assert.equal(evaluatePolicy(FULL, trace(good, { channel: 'chat' })).verdict, 'pass', 'when does not match');
  const reads = P(TOOLS, [{ id: 'no-reads', type: 'deny-access', access: 'read', tools: ['get_bill'] }]);
  const r = evaluatePolicy(reads, trace([['user', 'bill?'], ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }]]));
  assert.deepEqual([r.violations[0].label, r.violations[0].fact], ['No read actions', 'get_bill called, and it reads data (a read action).']);
  const guessed = P({}, [{ id: 'nw', type: 'deny-access', access: 'write' }]);
  assert.deepEqual(ids(evaluatePolicy(guessed, trace([['user', 'x'], ['call', 'refund_order', {}, {}], ['call', 'get_order', {}, {}]]))), ['nw'], 'unlisted tools use the name guess');
});

test('ask before acting: the yes must answer the latest proposal', () => {
  const policy = P(TOOLS, []);
  const run = (items, opts) => evaluatePolicy(policy, trace(items), opts).violations.map((v) => v.fact);
  assert.deepEqual(run(good), []);
  assert.deepEqual(run([['user', 'Can I get a credit?'], ['assistant', 'I can add $80. OK?'], credit()]), ['issue_credit called before the customer answered the agent\'s last message.']);
  assert.deepEqual(
    run([['user', 'yes that is my account'], verified, ['assistant', 'Thanks. I will add an $80 credit.'], credit()]),
    ['issue_credit called before the customer answered the agent\'s last message.'],
    'a yes to an earlier question does not cover a new proposal',
  );
  assert.deepEqual(run([['assistant', 'Want the $80 credit?'], ['user', 'YES'], ['call', 'issue_credit', { amount: 80 }, { status: 'applied' }, 'Applying it now.']]), [], 'text sent with the call is the agent acting, not a new proposal');
  assert.deepEqual(run([['user', 'yes, that is me'], ['call', 'issue_credit', { amount: 80 }, { status: 'applied' }, 'Want an $80 credit?']]), ['issue_credit called before the customer answered the agent\'s last message.'], 'asking and acting in one message is not waiting');
  assert.deepEqual(run([['assistant', 'Want the $80 credit?'], ['user', 'how much is that again?'], credit()], { userLabel: 'patient' }), ['issue_credit called without a yes from the patient: their last message does not agree to it.']);
  assert.deepEqual(run([credit()]), ['issue_credit called without a yes from the customer.']);
  const why = evaluatePolicy(policy, trace([credit()])).violations[0];
  assert.deepEqual([why.ruleId, why.label, why.why], ['confirm', 'Ask before acting', 'Credits cost money.']);
  const noPatterns = { ...policy, tools: { issue_credit: { access: 'write', confirm: true } } };
  assert.equal(evaluatePolicy(noPatterns, trace([['assistant', 'OK?'], ['user', 'sounds good'], credit()])).verdict, 'pass', 'default patterns');
  assert.equal(evaluatePolicy(noPatterns, trace([credit()])).violations[0].why, 'Actions that change something need a yes from the customer first.');
});

test('at most N times per conversation; failed calls do not count', () => {
  const policy = P({ issue_credit: { access: 'write', maxPerTrace: 1 } }, []);
  const twice = evaluatePolicy(policy, trace([['user', 'x'], credit(10), credit(20)]));
  assert.deepEqual(twice.violations.map((v) => [v.ruleId, v.stepId, v.label, v.fact]), [['max-per-trace', 'm4.c0', 'At most 1 time per conversation', 'issue_credit called 2 times; the limit is 1 per conversation.']]);
  assert.equal(evaluatePolicy(policy, trace([['user', 'x'], credit(10, {}, { status: 'error', error: 'timeout' }), credit(10)])).verdict, 'pass');
});

test('do this first', () => {
  const policy = P(PLAIN, [FULL.rules[2]]);
  const run = (items) => evaluatePolicy(policy, trace(items)).violations.map((v) => v.fact);
  assert.deepEqual(run([['user', 'bill?'], ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }]]), ['get_bill called before verify_identity.']);
  assert.deepEqual(run([['user', 'bill?'], ['call', 'verify_identity', {}, { status: 'failed', reason: 'Code does not match.' }], ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }]]), ['get_bill called after verify_identity failed.']);
  assert.deepEqual(run([['user', 'bill?'], verified, ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }]]), []);
  assert.deepEqual(run([['user', 'bill?'], ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }], verified]), ['get_bill called before verify_identity.'], 'order matters');
});

test('needs approval above a limit: order and approval status', () => {
  const policy = P(PLAIN, [FULL.rules[4]]);
  const run = (items) => evaluatePolicy(policy, trace(items)).violations.map((v) => v.message);
  assert.deepEqual(run([['user', 'credit?'], credit(80)]), ['issue_credit called with amount 80 without an earlier request_approval. Credits over $50 need a supervisor.']);
  assert.deepEqual(run([['user', 'credit?'], credit(40)]), [], 'at or under the limit');
  assert.deepEqual(run([['user', 'credit?'], approved, credit(80)]), []);
  assert.deepEqual(run([['user', 'credit?'], credit(80), approved]), ['issue_credit called with amount 80 without an earlier request_approval. Credits over $50 need a supervisor.'], 'approval after the call is too late');
  assert.deepEqual(run([['user', 'credit?'], ['call', 'request_approval', { amount: 90 }, { status: 'pending', request_id: 'SA-1' }], credit(90)]), ['issue_credit called with amount 90 while request_approval was still pending. Credits over $50 need a supervisor.']);
  assert.deepEqual(run([['user', 'credit?'], ['call', 'request_approval', { amount: 90 }, { status: 'denied' }], credit(90)]), ['issue_credit called with amount 90 after request_approval returned status "denied". Credits over $50 need a supervisor.']);
  assert.deepEqual(run([['user', 'credit?'], credit('80.00')]).length, 1, 'numbers written as text');
});

test('stay under and above a limit, only these values, must include', () => {
  const policy = P(PLAIN, FULL.rules.slice(5, 10).filter((r) => r.type !== 'arg-not-match'));
  const facts = (items) => evaluatePolicy(policy, trace(items)).violations.map((v) => `${v.ruleId}: ${v.fact}`);
  assert.deepEqual(facts([['user', 'x'], credit(250)]), ['credit-cap: issue_credit called with amount 250, above the limit of 200.']);
  assert.deepEqual(facts([['user', 'x'], credit('$250')]), ['credit-cap: issue_credit called with amount $250, above the limit of 200.']);
  assert.deepEqual(facts([['user', 'x'], credit(200)]), []);
  assert.deepEqual(facts([['user', 'x'], credit(0)]), ['credit-min: issue_credit called with amount 0, below the minimum of 1.']);
  assert.deepEqual(facts([['user', 'x'], ['call', 'change_plan', { plan: 'platinum' }, { status: 'ok' }]]), ['plan-names: change_plan called with plan "platinum", which is not one of: basic, plus, gig.']);
  assert.deepEqual(facts([['user', 'x'], ['call', 'change_plan', { plan: 'gig' }, { status: 'ok' }]]), []);
  assert.deepEqual(facts([['user', 'x'], credit(20, { reason: '' })]), ['credit-reason: issue_credit called without reason.']);
  assert.equal(ruleLabel(FULL.rules[5]), 'Stay under a limit');
  assert.equal(ruleLabel(FULL.rules[6]), 'Stay above a limit');
  assert.equal(ruleLabel(FULL.rules[7]), 'Only these values');
  assert.equal(ruleLabel(FULL.rules[9]), 'Must include');
});

test('never include this pattern: a card number anywhere in the arguments, never echoed back', () => {
  const policy = P(TOOLS, [FULL.rules[8]]);
  const card = ['call', 'verify_identity', { method: 'card_on_file', card_number: '4716 2231 9054 8810' }, { status: 'verified', account_id: 'A-1' }];
  const r = evaluatePolicy(policy, trace([['user', 'my card is on file'], card]));
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].message, 'verify_identity called with a value that matches a forbidden pattern in card_number (ending "8810"). Never pass card numbers.');
  assert.ok(!r.violations[0].message.includes('4716'), 'the full number is not repeated');
  assert.equal(evaluatePolicy(policy, trace([['user', 'x'], ['call', 'verify_identity', { phone: '503-555-0267' }, { status: 'verified' }]])).verdict, 'pass', 'a phone number is not a card');
  const onePath = P(TOOLS, [{ id: 'q', type: 'arg-not-match', tools: ['search_help'], argPath: 'query', pattern: '[a-z]+@[a-z]+\\.com', flags: 'i' }]);
  assert.equal(evaluatePolicy(onePath, trace([['user', 'x'], ['call', 'search_help', { query: 'reset for AMY@EXAMPLE.COM' }, {}]])).violations[0].fact, 'search_help called with a value that matches a forbidden pattern in query (ending ".COM").');
  assert.equal(evaluatePolicy(onePath, trace([['user', 'x'], ['call', 'search_help', { query: 'wifi', email: 'amy@example.com' }, {}]])).verdict, 'pass', 'only the named argument');
});

test('never include this pattern with luhn: card numbers are flagged, timestamps and order numbers are not', () => {
  const run = (rule, args) => evaluatePolicy(P(TOOLS, [rule]), trace([['user', 'x'], ['call', 'get_bill', args, { status: 'ok' }]]));
  const luhn = { ...FULL.rules[8], luhn: true };
  assert.equal(run(FULL.rules[8], { slot_start_ms: 1767225600000 }).verdict, 'fail', 'without luhn, any 13 to 16 digits match');
  assert.equal(run(luhn, { slot_start_ms: 1767225600000 }).verdict, 'pass', 'an epoch-millisecond timestamp');
  assert.equal(run(luhn, { order: 'ORD 1234567890123' }).verdict, 'pass', 'an order number');
  const card = run(luhn, { order: 'ORD 1234567890123', note: 'card 4111 1111 1111 1111' });
  assert.deepEqual(card.violations.map((v) => v.fact), ['get_bill called with a value that matches a forbidden pattern in note (ending "1111").']);
  const onePath = run({ ...luhn, argPath: 'note' }, { note: 'order 1234567890123 then 4242424242424242' });
  assert.deepEqual(onePath.violations.map((v) => v.fact), ['get_bill called with a value that matches a forbidden pattern in note (ending "4242").'], 'a later match that passes the checksum');
  assert.deepEqual(validatePolicy(P(TOOLS, [{ ...luhn, luhn: 'yes' }])).errors, ['Rule "no-card-numbers": luhn must be true or false.']);
});

test('must match: an earlier tool result or a trace detail', () => {
  const policy = P(PLAIN, [FULL.rules[3]]);
  const bill = (account) => ['call', 'get_bill', { account_id: account }, { status: 'ok' }];
  const facts = (items, meta) => evaluatePolicy(policy, trace(items, meta)).violations.map((v) => v.fact);
  assert.deepEqual(facts([['user', 'x'], verified, bill('A-1')]), []);
  assert.deepEqual(facts([['user', 'x'], verified, bill('A-2')]), ['get_bill called with account_id A-2, but verify_identity returned A-1.']);
  assert.deepEqual(facts([['user', 'x'], bill('A-2')]), ['get_bill called with account_id A-2, but no earlier verify_identity returned account_id to match.']);
  assert.deepEqual(
    facts([['user', 'x'], verified, ['call', 'verify_identity', { account_id: 'A-2' }, { status: 'verified', account_id: 'A-2' }], bill('A-2')]),
    [], 'the most recent verified result counts',
  );
  assert.deepEqual(
    facts([['user', 'x'], verified, ['call', 'verify_identity', { account_id: 'A-2' }, { status: 'failed', account_id: 'A-2' }], bill('A-2')]),
    ['get_bill called with account_id A-2, but verify_identity returned A-1.'], 'a failed call is not a source',
  );
  const detail = P(TOOLS, [{ id: 'signed-in', type: 'arg-equals', tools: ['get_bill'], argPath: 'account_id', source: { detail: 'metadata.account_id' } }]);
  assert.deepEqual(evaluatePolicy(detail, trace([['user', 'x'], bill('A-2')], { account_id: 'A-1' })).violations.map((v) => [v.label, v.fact]), [['Must match', "get_bill called with account_id A-2, but this trace's account_id is A-1."]]);
  assert.equal(evaluatePolicy(detail, trace([['user', 'x'], bill('A-2')])).verdict, 'pass', 'no detail to compare');
});

test('ruleIds limits the rules; a guardrail checks the proposed call before it runs', () => {
  const t = trace([['user', 'x'], credit(250), ['call', 'run_sql', {}, {}]]);
  assert.deepEqual(ids(evaluatePolicy(FULL, t, { ruleIds: ['credit-cap'] })), ['credit-cap']);
  const proposed = trace([['user', 'Can I get a credit?'], verified, ['call', 'issue_credit', { account_id: 'A-1', amount: 80, reason: 'outage' }]]);
  assert.equal(toolCallList(proposed)[1].state, 'none');
  assert.deepEqual(ids(evaluatePolicy(FULL, proposed)), ['confirm', 'credit-approval']);
});

test('tool calls pair with results across formats', () => {
  const log = normalizeTrace({
    id: 's', steps: [
      { type: 'tool', name: 'verify_identity', input: { account_id: 'A-1' }, output: { status: 'verified', account_id: 'A-1' } },
      { type: 'tool', name: 'issue_credit', input: { amount: 30 }, output: 'Credit pending_approval', status: 'ok' },
      { type: 'tool', name: 'change_plan', input: { plan: 'gig' }, status: 'error' },
    ], output: 'Done!',
  }, exp);
  assert.deepEqual(toolCallList(log).map((c) => [c.stepId, c.name, c.state, c.status]), [['s0', 'verify_identity', 'ok', 'verified'], ['s1', 'issue_credit', 'pending', 'pending_approval'], ['s2', 'change_plan', 'error', 'error']]);
  const anthropic = normalizeTrace({
    id: 'a', messages: [
      { role: 'user', content: 'credit please' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'issue_credit', input: { amount: 30 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Service unavailable', is_error: true }] },
      { role: 'assistant', content: 'All set!' },
    ],
  }, exp);
  assert.deepEqual(toolCallList(anthropic).map((c) => [c.stepId, c.result?.stepId, c.state]), [['m1.c0', 'm2.r0', 'error']]);
  assert.equal(successAfterError(anthropic).verdict, 'fail');
  assert.equal(guessAccess('lookup_account'), 'read');
  assert.equal(guessAccess('Verify_identity'), 'read');
  assert.equal(guessAccess('issue_credit'), 'write');
  assert.equal(toolAccess(FULL, 'request_approval'), 'read', 'the policy wins over the name guess');
});

// ------------------------------------------------------------------ relevance

const INTENTS = {
  format: 'pmstack.intents/1', intentFrom: 'metadata.intent',
  intents: [{ id: 'billing-question', label: 'Question about a bill', expect: ['get_bill'], allow: ['verify_identity'], never: ['issue_credit'] }],
};

test('relevance: missing, unexpected, forbidden, and no intent', () => {
  assert.deepEqual(validateIntents(readJson('templates/tool-calls/intents.json')), { ok: true, errors: [] });
  const rel = (items, intent = 'billing-question') => evaluateRelevance(INTENTS, trace(items, intent ? { intent } : {}));
  const bill = ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }];
  const ok = rel([['user', 'why is my bill high?'], verified, bill]);
  assert.deepEqual([ok.verdict, ok.applies, ok.intent, ok.label, ok.detail], ['pass', true, 'billing-question', 'Question about a bill', 'Right tools for "Question about a bill".']);
  const missing = rel([['user', 'why is my bill high?'], verified]);
  assert.deepEqual([missing.verdict, missing.missing, missing.detail], ['fail', ['get_bill'], 'Skipped a needed tool: get_bill.']);
  const extra = rel([['user', 'bill?'], verified, bill, ['call', 'search_help', { query: 'bill' }, {}]]);
  assert.deepEqual([extra.verdict, extra.unexpected, extra.forbidden, extra.detail], ['fail', ['search_help'], [], "Called a tool the request didn't need: search_help."]);
  const never = rel([['user', 'bill?'], verified, credit(10)]);
  assert.deepEqual([never.missing, never.forbidden, never.unexpected, never.argIssues], [['get_bill'], ['issue_credit'], [], []]);
  assert.equal(never.detail, 'Skipped a needed tool: get_bill. Called a tool this request must never use: issue_credit.');
  const none = rel([['user', 'hi']], null);
  assert.deepEqual([none.verdict, none.applies, none.detail], ['pass', false, 'No intent on this trace']);
  const unknown = rel([['user', 'hi']], 'small-talk');
  assert.deepEqual([unknown.verdict, unknown.applies, unknown.detail], ['pass', false, 'The intent "small-talk" is not in the intent map']);
  assert.equal(rel([['user', 'bill?'], bill], 'Question about a bill').applies, true, 'the intent label also matches');
  const bad = validateIntents({ format: 'x', intentFrom: '', intents: [{ id: 'a', expect: ['t'], never: ['t'] }, { id: 'a', allow: 'get_bill' }, {}] });
  assert.deepEqual(bad.errors, [
    'This is not a pmstack intent map (format "x"; expected "pmstack.intents/1").',
    'intentFrom must name a trace detail, like "metadata.intent".',
    'Intent "a": t is in both expect and never.',
    'Intent "a": the id is used twice.',
    'Intent "a": allow must be a list of tool names.',
    'Intent 3 needs an id.',
  ]);
});

// ------------------------------------------------------------------ output grounding

test('extractValues: times, dates, money, ids, and more, normalized', () => {
  const norms = (text) => extractValues(text).map((v) => `${v.kind}:${v.norm}`);
  assert.deepEqual(norms('9:30 AM, 09:30, 9:30, 14:00, 2pm, 2 p.m., 12 AM, 12:30 PM'), ['time:09:30', 'time:09:30', 'time:09:30', 'time:14:00', 'time:14:00', 'time:14:00', 'time:00:00', 'time:12:30']);
  assert.deepEqual(norms('between 8:00 AM and 12:00 PM, or 8 to 10 AM, or 11 to 1 PM, or 12:00-16:00'), ['time:08:00', 'time:12:00', 'time:08:00', 'time:10:00', 'time:11:00', 'time:13:00', 'time:12:00', 'time:16:00']);
  assert.deepEqual(norms('Sept 25, 2026-09-25, Friday, September 25, 9/25, 25th of September, Sep. 25th'), Array(6).fill('date:09-25'));
  assert.deepEqual(norms('$1,234.50, $80.00, 50 dollars, USD 12, 15%'), ['money:1234.5', 'money:80', 'money:50', 'money:12', 'percent:15']);
  assert.deepEqual(norms('Visit TV-80198, outage OUT7719, account A-1182, confirmation number 55812, #20931'), ['id:TV80198', 'id:OUT7719', 'id:A1182', 'id:55812', 'id:20931']);
  assert.deepEqual(norms('600 Mbps within 3 business days or 24 hours'), ['number:600', 'number:3', 'number:24']);
  assert.deepEqual(norms('Call 503-555-0267, 24/7. We have 3 plans.'), [], 'phone numbers, 24/7, and bare counts are not checked');
  assert.deepEqual(norms('2026-09-18T09:40:00-07:00'), ['date:09-18', 'time:09:40'], 'a time zone offset is not a time');
  const range = extractValues('Arrives between 8 and 10 AM.');
  assert.deepEqual(range.map((v) => v.raw), ['8 AM', '10 AM']);
  assert.deepEqual(extractValues('It starts at 12:00 PM.').map((v) => v.raw), ['12:00 PM']);
});

test('grounded values: pass when every value comes from the trace, fail with the ones that do not', () => {
  const visit = ['call', 'schedule_technician', { date: '2026-09-18', window: 'morning' }, { status: 'scheduled', visit_id: 'TV-80198', date: '2026-09-18', arrival_window: '12:00-16:00' }];
  const good = groundedValues(trace([['user', 'Can someone come Friday?'], visit, ['assistant', 'Booked for Friday, September 18, between 12:00 PM and 4:00 PM. Your visit number is TV-80198.']]));
  assert.deepEqual([good.verdict, good.ungrounded, good.detail, good.stepId], ['pass', [], 'All 4 values in the reply appear in the trace', 'm4']);
  const bad = groundedValues(trace([['user', 'Can someone come Friday?'], visit, ['assistant', 'Booked for Friday, September 18, between 8:00 AM and 12:00 PM. Your visit number is TV-80198.']]));
  assert.deepEqual([bad.verdict, bad.ungrounded, bad.detail], ['fail', [{ raw: '8:00 AM', norm: '08:00', kind: 'time' }], 'Not found in tool results: 8:00 AM']);
  const money = groundedValues(trace([['user', 'credit?'], credit(80, {}, { status: 'applied', amount: '80.00' }), ['assistant', 'Your $80 credit is applied, and $30 more next month.']]));
  assert.deepEqual([money.verdict, money.detail], ['fail', 'Not found in tool results: $30']);
  const fromUser = groundedValues(trace([['user', 'I pay $65 a month for 600 Mbps'], ['call', 'get_bill', {}, { amount_due: 65 }], ['assistant', 'Right, $65 a month for 600 Mbps.']]));
  assert.equal(fromUser.verdict, 'pass', 'values the user said count');
  const fromPrompt = groundedValues(trace([['user', 'When are you open?'], ['assistant', 'We are open 9 AM to 6 PM.']]));
  assert.deepEqual([fromPrompt.verdict, fromPrompt.detail], ['fail', 'Not found in tool results: 9 AM, 6 PM'], 'the instructions are not a source');
  assert.deepEqual(groundedValues(trace([['user', 'hi'], ['assistant', 'Hello! How can I help?']])).detail, 'No numbers, dates, times, or codes in the reply');
  const pct = groundedValues(trace([['user', 'discount?'], ['call', 'get_offer', {}, { discount: 0.15 }], ['assistant', 'You get 15% off.']]));
  assert.equal(pct.verdict, 'pass', '15% matches 0.15');
  const docs = normalizeTrace({ id: 'r', input: 'How many days of leave?', steps: [{ type: 'retrieval', name: 'search', documents: [{ id: 'hr-1', text: 'Parents get 16 weeks of paid leave.' }] }], output: 'You get 16 weeks.' }, exp);
  assert.equal(groundedValues(docs).verdict, 'pass', 'retrieved documents count');
});

test('success after error: pending_approval, errors, negations, and the policy', () => {
  const pending = credit(80, {}, { status: 'pending_approval', credit_id: 'CR-1', amount: 80 });
  const said = (reply, calls = [pending], policy = null) => successAfterError(trace([['user', 'credit?'], ...calls, ['assistant', reply]]), policy);
  const lie = said('Done! $80 is off your next bill.');
  assert.deepEqual([lie.verdict, lie.detail, lie.tool, lie.stepId, lie.status], ['fail', 'The reply says "Done", but issue_credit returned status "pending_approval"', 'issue_credit', 'm2.c0', 'pending_approval']);
  assert.equal(said('I asked for the $80 credit. It is pending a supervisor\'s approval.').verdict, 'pass');
  assert.equal(said("The credit isn't applied yet.").verdict, 'pass', 'negated');
  assert.equal(said('I will let you know once it is confirmed.').verdict, 'pass', 'not a claim yet');
  assert.equal(said('Thanks for waiting! Anything else?').verdict, 'pass', 'no success words');
  const err = ['call', 'change_plan', { plan: 'plus' }, { status: 'error', error: 'Plan changes are on hold.' }];
  assert.equal(said('All set, you are on Plus now.', [err]).detail, 'The reply says "All set", but change_plan returned status "error"');
  assert.equal(said('Sorry, the plan change did not go through. Changes are on hold for now.', [err]).verdict, 'pass');
  assert.equal(said('All set.', [err, ['call', 'change_plan', { plan: 'plus' }, { status: 'ok' }]]).verdict, 'pass', 'a retry that worked');
  const readErr = ['call', 'search_help', {}, 'Error: index offline'];
  assert.equal(said('Done, you are on Plus.', [['call', 'change_plan', { plan: 'plus' }, { status: 'ok' }], readErr]).verdict, 'fail', 'no policy: any call counts');
  assert.equal(said('Done, you are on Plus.', [['call', 'change_plan', { plan: 'plus' }, { status: 'ok' }], readErr], FULL).verdict, 'pass', 'with a policy: only write calls');
  assert.equal(said('Done.', []).detail, 'No tool calls before the reply');
});

// ------------------------------------------------------------------ checks, judge, schema

function supportProject() {
  const traces = [
    { id: 'a', metadata: { intent: 'billing-question' }, messages: [{ role: 'user', content: 'bill?' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'get_bill', arguments: '{"account_id":"A-1"}' } }] }, { role: 'tool', tool_call_id: 'c1', content: '{"status":"ok","amount_due":65}' }, { role: 'assistant', content: 'You owe $65.' }] },
    { id: 'b', metadata: { intent: 'billing-question' }, messages: [{ role: 'user', content: 'credit?' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'issue_credit', arguments: '{"amount":80}' } }] }, { role: 'tool', tool_call_id: 'c1', content: '{"status":"pending_approval"}' }, { role: 'assistant', content: 'Done! $90 is off.' }] },
    { id: 'c', metadata: {}, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }] },
  ];
  let p = createProject({ id: 'sa', name: 'Support', experience: exp, traces, now: '2026-09-20T10:00:00Z' });
  let r = addMode(p, { kind: 'failure', name: TOOL_CHECK_TEMPLATES.policy.name, definition: TOOL_CHECK_TEMPLATES.policy.definition, stage: templateStage(exp, 'policy') }, { now: '2026-09-20T10:00:00Z' });
  p = updateMode(r.project, r.id, { template: 'policy' });
  const policyMode = r.id;
  r = addMode(p, { kind: 'failure', name: JUDGE_TEMPLATES.grounding.name, definition: JUDGE_TEMPLATES.grounding.definition }, { now: '2026-09-20T10:00:00Z' });
  p = updateMode(r.project, r.id, { template: 'grounding' });
  const groundMode = r.id;
  p = { ...p, labels: { [policyMode]: { a: 'pass', b: 'fail', c: 'pass' } } };
  const policy = P(PLAIN, [FULL.rules[4]], { onlyListedTools: true });
  let c = addCheck(p, { type: 'policy', modeId: policyMode, policy, ci: true });
  p = c.project;
  const policyCheck = c.id;
  c = addCheck(p, { type: 'relevance', modeId: policyMode, intents: INTENTS });
  p = c.project;
  const relCheck = c.id;
  c = addCheck(p, { type: 'code', modeId: groundMode, name: 'Values come from tools', rule: { op: 'grounded-values' } });
  p = c.project;
  const valuesCheck = c.id;
  c = addCheck(p, { type: 'code', modeId: groundMode, name: 'No success after a failed call', rule: { op: 'success-after-error' }, ci: true });
  p = c.project;
  return { p, policyMode, groundMode, policyCheck, relCheck, valuesCheck, saeCheck: c.id };
}

test('policy, relevance, and grounding checks run like code checks', () => {
  const { p, policyMode, policyCheck, relCheck, valuesCheck, saeCheck } = supportProject();
  assert.deepEqual(OPERATORS.filter((o) => o.group === 'tool-calls').map((o) => [o.id, o.label]), [['grounded-values', 'Every number in the reply comes from a tool'], ['success-after-error', 'Claims success after a failed or pending call']]);
  const check = (id) => p.checks.find((c) => c.id === id);
  assert.deepEqual(Object.keys(check(policyCheck)).sort(), ['ci', 'id', 'modeId', 'name', 'policy', 'ruleIds', 'type', 'when']);
  assert.equal(check(policyCheck).name, 'Breaks a tool policy');
  assert.ok(isCodeCheck(check(policyCheck)) && isCodeCheck(check(relCheck)) && isCodeCheck(check(valuesCheck)));
  assert.deepEqual([checkTypeLabel(check(policyCheck)), checkTypeLabel(check(relCheck)), checkTypeLabel(check(valuesCheck)), checkTypeLabel({ type: 'judge' })], ['Code check: policy rules', 'Code check: intent map', 'Code check', 'AI judge']);

  const opts = checkOptions(p);
  const nb = p.traces[1];
  const norm = (t) => normalizeTrace(t, p.experience);
  const pol = runCheck(check(policyCheck), norm(nb), opts);
  assert.equal(pol.verdict, 'fail');
  assert.equal(pol.detail, 'Needs approval above a limit: issue_credit called with amount 80 without an earlier request_approval.');
  assert.deepEqual(pol.violations.map((v) => v.ruleId), ['credit-approval']);
  assert.deepEqual(runCheck(check(policyCheck), norm(p.traces[0]), opts), { verdict: 'pass', detail: 'Follows the policy', violations: [] });
  const rel = runCheck(check(relCheck), norm(nb), opts);
  assert.deepEqual([rel.verdict, rel.relevance.forbidden, rel.detail], ['fail', ['issue_credit'], 'Skipped a needed tool: get_bill. Called a tool this request must never use: issue_credit.']);
  assert.equal(runCheck(check(relCheck), norm(p.traces[2]), opts).detail, 'No intent on this trace');
  const vals = runCheck(check(valuesCheck), norm(nb), opts);
  assert.deepEqual([vals.verdict, vals.detail, vals.ungrounded.map((v) => v.raw)], ['fail', 'Not found in tool results: $90', ['$90']]);
  assert.equal(runCheck(check(saeCheck), norm(nb), opts).detail, 'The reply says "Done", but issue_credit returned status "pending_approval"');
  assert.deepEqual(runCheck({ type: 'policy', policy: null }, norm(nb)), { verdict: 'error', detail: 'Add a policy to this check first.', violations: [] });
  assert.equal(runCheck({ type: 'policy', policy: { format: 'x' } }, norm(nb)).detail, 'The policy has a problem: This is not a pmstack policy (format "x"; expected "pmstack.policy/1").');
  assert.equal(runCheck({ type: 'relevance', intents: null }, norm(nb)).verdict, 'error');
  assert.deepEqual(runCheck({ ...check(policyCheck), when: { path: 'metadata.intent', equals: 'none' } }, norm(nb)), { verdict: 'pass', detail: 'Does not apply', violations: [] });

  const all = runChecks(p);
  assert.deepEqual(all.byCheck[policyCheck], { a: 'pass', b: 'fail', c: 'pass' });
  assert.deepEqual(all.byCheck[relCheck], { a: 'pass', b: 'fail', c: 'pass' });
  assert.deepEqual(all.byCheck[saeCheck], { a: 'pass', b: 'fail', c: 'pass' });
  assert.equal(all.passAll, 2);
  assert.deepEqual(runChecks(p, { onlyCi: true }).summary.map((s) => s.checkId), [policyCheck, saeCheck]);

  const a = checkAgreement(p, policyCheck, { split: 'test' });
  assert.deepEqual([a.n, a.tp, a.tn, a.agreesOnGood, a.catchesFailures, a.split, a.locked], [3, 2, 1, 1, 1, null, false], 'all labeled traces, split ignored');
  assert.equal(checkAgreement(p, relCheck).n, 3);
  assert.equal(labelsFor(p, policyMode), 3);
  assert.deepEqual(ciChecks(p).checks.map((c) => c.id), [policyCheck, saeCheck]);
  const rows = reportModel(p).checks;
  assert.deepEqual(rows.find((r) => r.id === policyCheck).split, 'all labels');
  assert.deepEqual(rows.find((r) => r.id === policyCheck).typeLabel, 'Code check: policy rules');
});

const labelsFor = (p, modeId) => Object.keys(p.labels[modeId] || {}).length;

test('step badges mark the call that breaks policy and the reply that does not match', () => {
  const { p } = supportProject();
  const n = normalizeTrace(p.traces[1], p.experience);
  assert.deepEqual(stepBadges(p, n), {
    'm1.c0': [{ tone: 'bad', text: 'Breaks policy: Needs approval above a limit' }, { tone: 'bad', text: 'Called a tool this request must never use' }],
    m3: [{ tone: 'warn', text: 'Not found in tool results: $90' }, { tone: 'warn', text: 'The reply says "Done", but issue_credit returned status "pending_approval"' }],
  });
  assert.deepEqual(stepBadges(p, normalizeTrace(p.traces[0], p.experience)), {});
});

test('tool call summary and inventory', () => {
  const { p } = supportProject();
  assert.deepEqual(toolCallSummary(p), { traces: 3, withTools: 2, calls: 2, writeCalls: 1 });
  assert.equal(toolCallSummary(p), toolCallSummary(p), 'memoized');
  assert.deepEqual(toolInventory(p), [
    { name: 'get_bill', calls: 1, traces: 1, access: 'read', listed: true },
    { name: 'issue_credit', calls: 1, traces: 1, access: 'write', listed: true },
  ]);
  assert.deepEqual(toolInventory(p, null).map((r) => r.listed), [false, false]);
  assert.equal(templateStage(exp, 'relevance'), 'plan');
  assert.equal(templateStage(exp, 'grounding'), 'report');
  assert.equal(templateStage({ stages: [] }, 'policy'), null);
});

test('judge templates: criteria go into the prompt for a templated mode', () => {
  const { p, groundMode, policyMode } = supportProject();
  assert.deepEqual(Object.keys(JUDGE_TEMPLATES), ['relevance', 'grounding']);
  for (const t of Object.values(JUDGE_TEMPLATES)) {
    assert.ok(t.name && t.definition.startsWith('Fails when') && t.criteria.length === 5 && t.inputs.length === 2);
  }
  assert.deepEqual(JUDGE_TEMPLATES.relevance.inputs, ['customer', 'tools']);
  assert.deepEqual(JUDGE_TEMPLATES.grounding.inputs, ['tools', 'customer']);
  const prompt = buildJudgePrompt(p, groundMode);
  assert.ok(prompt.includes('What to check\nCompare the final reply with the tool results.'));
  for (const c of JUDGE_TEMPLATES.grounding.criteria) assert.ok(prompt.includes(`- ${c.split('{userLabel}').join('customer')}`), c);
  assert.ok(prompt.includes('Fail when: the reply contradicts a tool result'));
  assert.ok(!prompt.includes('{userLabel}'));
  assert.ok(prompt.indexOf('What to check') < prompt.indexOf('How to answer'));
  const rel = updateMode(p, groundMode, { template: 'relevance' });
  assert.ok(buildJudgePrompt(rel, groundMode).includes('- When a required detail is missing, it asks the customer instead of guessing.'));
  assert.ok(!buildJudgePrompt(p, policyMode).includes('What to check'), 'policy has no judge template');
  const judge = addCheck(p, { type: 'judge', modeId: groundMode });
  assert.deepEqual(judge.project.checks.find((c) => c.id === judge.id).inputs, ['tools', 'customer']);
});

test('validateProject checks the new fields', () => {
  const { p, policyCheck, relCheck, policyMode } = supportProject();
  assert.deepEqual(validateProject(p), { ok: true, errors: [] });
  const withShow = { ...p, experience: { ...p.experience, showHiddenDefault: true } };
  assert.equal(validateProject(withShow).ok, true);
  const broken = {
    ...p,
    experience: { ...p.experience, showHiddenDefault: 'yes' },
    modes: p.modes.map((m) => (m.id === policyMode ? { ...m, template: 'vibes' } : m)),
    checks: [
      ...p.checks.map((c) => (c.id === policyCheck ? { ...c, policy: { ...c.policy, rules: [{ id: 'r', type: 'arg-max', tools: ['x'] }] }, ruleIds: ['nope'] } : c.id === relCheck ? { ...c, intents: { format: 'pmstack.intents/1', intents: 'all' } } : c)),
      { id: 'ck-x', modeId: policyMode, type: 'magic', name: 'Magic' },
    ],
  };
  const errors = validateProject(broken).errors;
  assert.deepEqual(errors, [
    'The product setup\'s default for "Show behind-the-scenes steps" (showHiddenDefault) must be true or false.',
    'Mode "Breaks a tool policy" has an unknown template "vibes". Use policy, relevance, grounding, or none.',
    'Check "Breaks a tool policy": Rule "r" needs argPath: the argument to compare, like "amount".',
    'Check "Breaks a tool policy": Rule "r" needs max: a number.',
    'Check "Breaks a tool policy": Rule "r" names the tool "x", which is not in tools. Check the spelling, or add the tool to tools.',
    'Check "Breaks a tool policy" lists rule "nope", which its policy does not have.',
    'Check "Breaks a tool policy": intents must be a list.',
    'Check "Magic" has an unknown type "magic".',
  ]);
});

test('a list item\'s reason reads "Reason:" in plain text', () => {
  const text = outputText({ type: 'list', items: [{ title: 'Cast iron pan', details: { Why: 'Lasts forever', Price: '$45' }, reason: 'Fits the $50 budget' }] });
  assert.equal(text, '1. Cast iron pan\n   Why: Lasts forever\n   Price: $45\n   Reason: Fits the $50 budget');
});

test('EXAMPLE_POLICY is the template policy file, so Eval Studio starts from the same rules', () => {
  assert.deepEqual(EXAMPLE_POLICY, readJson('templates/tool-calls/policy.json'));
  assert.equal(validatePolicy(EXAMPLE_POLICY).ok, true);
});

// ------------------------------------------------------------------ guardrail gaps found in QA

test('limit rules: a value that is not a plain number never slips through', () => {
  const policy = P(PLAIN, FULL.rules.slice(4, 7));
  const facts = (amount) => evaluatePolicy(policy, trace([['user', 'x'], credit(amount)])).violations.map((v) => `${v.ruleId}: ${v.fact}`);
  assert.deepEqual(facts('500 USD'), ['credit-approval: issue_credit called with amount 500 USD without an earlier request_approval.', 'credit-cap: issue_credit called with amount 500 USD, above the limit of 200.']);
  const notNumber = (shown) => [
    `credit-approval: issue_credit called with amount ${shown}, which is not a number the policy can check, without an earlier request_approval.`,
    `credit-cap: issue_credit called with amount ${shown}, which is not a number the policy can check.`,
    `credit-min: issue_credit called with amount ${shown}, which is not a number the policy can check.`,
  ];
  assert.deepEqual(facts([500]), notNumber('[500]'));
  assert.deepEqual(facts({ value: 500 }), notNumber('{"value":500}'));
  assert.deepEqual(facts('eight'), notNumber('"eight"'));
  const infinity = normalizeTrace({ id: 'inf', messages: [
    { role: 'user', content: 'x' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'issue_credit', arguments: '{"account_id":"A-1","amount":1e999,"reason":"outage"}' } }] },
  ] }, exp);
  assert.deepEqual(evaluatePolicy(policy, infinity).violations.map((v) => v.ruleId), ['credit-approval', 'credit-cap'], '1e999 reads as Infinity, which is over every limit');
  assert.deepEqual(facts('80'), ['credit-approval: issue_credit called with amount 80 without an earlier request_approval.']);
  assert.deepEqual(facts('$80'), ['credit-approval: issue_credit called with amount $80 without an earlier request_approval.']);
  assert.deepEqual(facts('1,000.50').map((f) => f.split(':')[0]), ['credit-approval', 'credit-cap']);
  assert.deepEqual(facts('$40'), [], 'plain numeric text under the limit');
  assert.deepEqual(evaluatePolicy(policy, trace([['user', 'x'], approved, credit([500])])).violations.map((v) => v.ruleId), ['credit-cap', 'credit-min'], 'an approval covers the unknown amount, but the cap cannot be checked');
  const pct = P({ raise: { access: 'write' } }, [{ id: 'cap', type: 'arg-max', tools: ['raise'], argPath: 'change.percent', max: 15 }]);
  const raise = (percent) => evaluatePolicy(pct, trace([['user', 'x'], ['call', 'raise', { change: { percent } }, { status: 'ok' }]])).violations.map((v) => v.fact);
  assert.deepEqual(raise('40 percent'), ['raise called with change.percent 40 percent, above the limit of 15.']);
  assert.deepEqual(raise('18%'), ['raise called with change.percent 18%, above the limit of 15.']);
  assert.deepEqual(raise('8%'), []);
  assert.deepEqual(raise(undefined), [], 'a missing value is for Must include');
});

test('approvals and identity checks: a denial or a missing answer does not count', () => {
  const policy = P(PLAIN, [FULL.rules[2], FULL.rules[4]]);
  const facts = (items) => evaluatePolicy(policy, trace(items)).violations.map((v) => v.fact);
  const ask = (result) => ['call', 'request_approval', { account_id: 'A-1', amount: 80 }, result];
  assert.deepEqual(facts([['user', 'x'], verified, ask({ approved: false, reason: 'over budget' }), credit(80)]), ['issue_credit called with amount 80 after request_approval returned status "not approved".']);
  assert.deepEqual(facts([['user', 'x'], verified, ask({ decision: 'denied' }), credit(80)]), ['issue_credit called with amount 80 after request_approval returned status "denied".']);
  assert.deepEqual(facts([['user', 'x'], verified, ask({ approval_status: 'rejected' }), credit(80)]), ['issue_credit called with amount 80 after request_approval returned status "rejected".']);
  assert.deepEqual(facts([['user', 'x'], verified, ask(undefined), credit(80)]), ['issue_credit called with amount 80 before request_approval returned an answer.']);
  assert.deepEqual(facts([['user', 'x'], verified, ask({ approved: true }), credit(80)]), []);
  const notVerified = ['call', 'verify_identity', { account_id: 'A-1' }, { verified: false }];
  assert.deepEqual(facts([['user', 'x'], notVerified, credit(20)]), ['issue_credit called after verify_identity failed.']);
  assert.equal(toolCallList(trace([['user', 'x'], ['call', 'verify_identity', {}, { result: { authorized: false } }]]))[0].state, 'error', 'one level down counts too');
});

test('parallel tool calls: a call in the same batch never counts as done first', () => {
  const parallel = (calls) => normalizeTrace({ id: 'par', messages: [
    { role: 'user', content: 'We were down two days. Can I get a credit?' },
    { role: 'assistant', content: '', tool_calls: calls.map(([name, args], i) => ({ id: `p${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) },
    ...calls.map(([, , result], i) => ({ role: 'tool', tool_call_id: `p${i}`, content: JSON.stringify(result) })),
  ] }, exp);
  const approval = P(PLAIN, [FULL.rules[4]]);
  const both = parallel([['request_approval', { amount: 80 }, { status: 'approved' }], ['issue_credit', { account_id: 'A-1', amount: 80, reason: 'outage' }, { status: 'applied' }]]);
  assert.deepEqual(evaluatePolicy(approval, both).violations.map((v) => v.fact), ['issue_credit called with amount 80 without an earlier request_approval.']);
  const identity = P(PLAIN, [FULL.rules[2], FULL.rules[3]]);
  const read = parallel([['verify_identity', { account_id: 'A-1' }, { status: 'verified', account_id: 'A-1' }], ['get_bill', { account_id: 'A-1' }, { status: 'ok' }]]);
  assert.deepEqual(evaluatePolicy(identity, read).violations.map((v) => v.fact), ['get_bill called before verify_identity.', 'get_bill called with account_id A-1, but no earlier verify_identity returned account_id to match.']);
  assert.equal(evaluatePolicy(identity, trace([['user', 'bill?'], verified, ['call', 'get_bill', { account_id: 'A-1' }, { status: 'ok' }]])).verdict, 'pass', 'one after the other still passes');
});

test('"every tool" does not check the tool a rule waits for against itself', () => {
  const bill = (account) => ['call', 'get_bill', { account_id: account }, { status: 'ok' }];
  const first = P(PLAIN, [{ id: 'verify-first', type: 'requires-before', tools: '*', before: 'verify_identity' }]);
  assert.equal(evaluatePolicy(first, trace([['user', 'x'], verified, bill('A-1')])).verdict, 'pass');
  assert.deepEqual(evaluatePolicy(first, trace([['user', 'x'], bill('A-1'), verified])).violations.map((v) => v.fact), ['get_bill called before verify_identity.']);
  const match = P(PLAIN, [{ id: 'same', type: 'arg-equals', tools: '*', argPath: 'account_id', source: { tool: 'verify_identity', path: 'account_id' } }]);
  assert.deepEqual(evaluatePolicy(match, trace([['user', 'x'], verified, bill('A-2')])).violations.map((v) => v.tool), ['get_bill']);
  const approval = P(PLAIN, [{ id: 'approve', type: 'approval-above', tools: '*', argPath: 'amount', max: 50, approvalTool: 'request_approval' }]);
  assert.deepEqual(evaluatePolicy(approval, trace([['user', 'x'], approved, credit(80)])).violations, []);
});

test('ask before acting: a refusal that contains a yes word is not a yes', () => {
  const policy = P(TOOLS, []);
  const answer = (reply) => evaluatePolicy(policy, trace([['assistant', 'I can add an $80 credit. Shall I go ahead?'], ['user', reply], credit()])).violations.map((v) => v.fact);
  const no = ['issue_credit called without a yes from the customer: their last message does not agree to it.'];
  for (const reply of ['No, do not go ahead.', "Please don't do it", "I can't confirm that yet", 'Hold on, do not do it', "No, don't do it.", 'Please do not', 'Do not confirm that.', "I'm not sure that works", 'Please don’t', 'no thanks', 'Not yet, wait']) {
    assert.deepEqual(answer(reply), no, reply);
  }
  for (const reply of ['Yes, cancel it. The fiber is half the price.', 'Sure, go ahead', 'No worries, go ahead', 'yes please', 'Sounds good, do it']) {
    assert.deepEqual(answer(reply), [], reply);
  }
});

test('validatePolicy reports typos and tool names that would silently turn a rule off', () => {
  const typo = P({ update_salary: { access: 'write', confrim: true }, verify_employee: { access: 'read' } }, [
    { id: 'a', type: 'deny-access', access: 'write', when: { path: 'metadata.channel', equal: 'sms' } },
    { id: 'b', type: 'requires-before', tools: ['update_salry'], before: 'verify_employe' },
    { id: 'c', type: 'arg-not-match', tools: '*', argpath: 'x', pattern: 'y' },
    { id: 'd', type: 'deny-tools', tools: ['delete_everything'] },
  ], { onlyListedTools: true, onlyListedTool: true });
  assert.deepEqual(validatePolicy(typo).errors, [
    '"onlyListedTool" is not a setting pmstack knows. Did you mean "onlyListedTools"?',
    'Tool "update_salary": "confrim" is not a setting pmstack knows. Did you mean "confirm"?',
    'Rule "a": in when, "equal" is not a setting pmstack knows. Did you mean "equals"?',
    'Rule "a": when needs equals, the value that turns the rule on, like { "path": "metadata.channel", "equals": "sms" }.',
    'Rule "b" names the tool "update_salry", which is not in tools. Check the spelling, or add the tool to tools.',
    'Rule "b" names the tool "verify_employe", which is not in tools. Check the spelling, or add the tool to tools.',
    'Rule "c": "argpath" is not a setting pmstack knows. Did you mean "argPath"?',
  ]);
  const unlisted = P({ get_bill: { access: 'read' } }, [{ id: 'b', type: 'requires-before', tools: ['lookup'], before: 'verify' }]);
  assert.equal(validatePolicy(unlisted).ok, true, 'without onlyListedTools a rule may name any tool');
  assert.equal(validatePolicy(P(TOOLS, [{ id: 'x', type: 'deny-tools', tools: ['run_sql'], label: 'free text', notes: 'kept' }])).errors.length, 1, 'only keys close to a known one are reported');
});

test('success after a pending call: a reply about what will happen is not a claim', () => {
  const pending = credit(80, {}, { status: 'pending_approval', credit_id: 'CR-1', amount: 80 });
  const said = (reply) => successAfterError(trace([['user', 'credit?'], pending, ['assistant', reply]])).verdict;
  for (const reply of [
    'Your credit will be applied after a supervisor approves it.',
    'A supervisor needs to approve it first; then it will be applied to your next bill.',
    'Your request is being processed and will be applied on Oct 1 after HR signs off.',
    'It gets applied as soon as they approve.',
  ]) assert.equal(said(reply), 'pass', reply);
  assert.equal(said('Done! $80 is off your next bill.'), 'fail');
  const err = ['call', 'change_plan', { plan: 'plus' }, { status: 'error' }];
  assert.equal(successAfterError(trace([['user', 'x'], err, ['assistant', 'Your plan will be updated tonight.']])).verdict, 'fail', 'after an error, a promise is still a false claim');
});

test('value extraction stays fast on long runs of spaces', () => {
  for (const word of ['1', 'confirmation']) {
    const start = Date.now();
    extractValues(word + ' '.repeat(200000) + 'x');
    assert.ok(Date.now() - start < 100, `${word} followed by 200,000 spaces took ${Date.now() - start} ms`);
  }
  assert.deepEqual(extractValues('9 AM - 5 PM, 8 to 10 AM, 9am-5pm').map((v) => v.norm), ['09:00', '17:00', '08:00', '10:00', '09:00', '17:00']);
  assert.deepEqual(extractValues('Your confirmation number is: AB-1234, ref#5567').map((v) => v.norm), ['AB1234', '5567']);
});
