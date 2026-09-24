import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS, VIEWS, COLUMNS, USER_LABELS, defaultExperience, compileStages, stageIndex, stageLabel, stageNumber,
  viewFor, userWord, withUser, normalizeViewId, normalizeTrace, RESERVED_STAGE_IDS,
} from '../../docs/studio/lib/index.mjs';

const stages = [
  { id: 'understand', label: 'Understand the request', column: 'understand', match: {} },
  { id: 'handoff', label: 'Hand off when needed', column: 'plan', match: { tools: ['transfer_to_staff'], kinds: ['handoff'] } },
  { id: 'lookup', label: 'Check the calendar', column: 'gather', match: { tools: ['find_slots', 'get_patient'] } },
  { id: 'fuzzy', label: 'Anything booking', column: 'act', match: { namePattern: '^BOOK_' } },
  { id: 'broken', label: 'Broken rule', column: 'act', match: { namePattern: '(' } },
  { id: 'reply', label: 'Reply to the patient', column: 'answer', match: { last: 'assistant' } },
];
const exp = { ...defaultExperience({ userLabel: 'patient' }), stages };

test('match rules: OR across keys and values, {} matches nothing, first hit wins', () => {
  const match = compileStages(stages);
  assert.equal(match({ kind: 'handoff', name: 'anything' }), 'handoff', 'kinds alone matches');
  assert.equal(match({ kind: 'tool_call', name: 'transfer_to_staff' }), 'handoff', 'tools alone matches');
  assert.equal(match({ kind: 'tool_result', name: 'get_patient' }), 'lookup', 'any listed tool matches');
  assert.equal(match({ kind: 'user', role: 'user', name: null }), null, '{} matches no step');
  assert.equal(match({ kind: 'tool_call', name: 'book_appointment' }), 'fuzzy', 'namePattern is case-insensitive');
  assert.equal(match({ kind: 'assistant', isOutput: true }), 'reply');
  assert.equal(match({ kind: 'assistant', isOutput: false }), null, 'last matches only the output step');
  assert.equal(compileStages(stages), match, 'compiled once per stages array');
  assert.equal(compileStages([])({ kind: 'user' }), null);
});

test('an invalid namePattern is skipped instead of throwing', () => {
  const match = compileStages([{ id: 'x', label: 'X', match: { namePattern: '[' } }]);
  assert.equal(match({ kind: 'tool', name: '[' }), null);
});

test('a raw stage naming a real stage wins over the rules', () => {
  const match = compileStages(stages);
  assert.equal(match({ kind: 'user', rawStage: 'lookup' }), 'lookup');
  assert.equal(match({ kind: 'tool_call', name: 'find_slots', rawStage: 'nope' }), 'lookup', 'an unknown raw stage is ignored');
  const n = normalizeTrace({ id: 'r', messages: [{ role: 'user', content: 'hi', stage: 'handoff' }, { role: 'assistant', content: 'hello' }] }, exp);
  assert.deepEqual(n.steps.map((s) => s.stage), ['handoff', 'reply']);
});

test('normalized steps carry stages from the matcher', () => {
  const raw = {
    id: 't', messages: [
      { role: 'user', content: 'Can I talk to someone?' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'transfer_to_staff', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'assistant', content: 'Connecting you now.' },
    ],
  };
  const n = normalizeTrace(raw, exp);
  assert.deepEqual(n.steps.map((s) => [s.id, s.stage]), [['m0', null], ['m1.c0', 'handoff'], ['m2', 'handoff'], ['m3', 'reply']]);
});

test('stage position, label, and number', () => {
  assert.equal(stageIndex(exp, 'lookup'), 2);
  assert.equal(stageIndex(exp, 'unknown'), Infinity);
  assert.equal(stageIndex(exp, null), Infinity);
  assert.equal(stageLabel(exp, 'reply'), 'Reply to the patient');
  assert.equal(stageLabel(exp, 'nope'), 'Unknown stage');
  assert.equal(stageNumber(exp, 'understand'), 1);
  assert.equal(stageNumber(exp, 'unknown'), null);
});

test('patterns: eight, with the default stages from the spec and no reserved ids', () => {
  assert.deepEqual(PATTERNS.map((p) => p.id), ['single', 'augmented', 'chain', 'routing', 'parallel', 'orchestrator', 'evaluator', 'agent']);
  const shape = (id) => PATTERNS.find((p) => p.id === id).stages.map((s) => `${s.id}|${s.label}|${s.column}|${JSON.stringify(s.match)}`);
  assert.deepEqual(shape('single'), ['understand|Understand the request|understand|{}', 'answer|Reply|answer|{"last":"assistant"}']);
  assert.deepEqual(shape('chain'), [
    'understand|Understand the request|understand|{}', 'draft|First draft|plan|{"kinds":["llm"]}',
    'gate|Quality gate|check|{"kinds":["guardrail"]}', 'final|Final pass|answer|{"last":"assistant"}',
  ]);
  assert.deepEqual(shape('agent').map((s) => s.split('|')[0]), ['clarify', 'gather', 'plan', 'act', 'check', 'report']);
  for (const p of PATTERNS) {
    assert.ok(p.label && p.anthropicName && p.summary && p.whenToUse, p.id);
    for (const s of p.stages) {
      assert.ok(!RESERVED_STAGE_IDS.includes(s.id));
      assert.ok(COLUMNS.some((c) => c.id === s.column), `${p.id}.${s.id} column`);
    }
  }
});

test('defaultExperience copies pattern stages and fills defaults', () => {
  const e = defaultExperience({ product: 'P', pattern: 'agent', renderer: 'nope', filters: ['channel'] });
  assert.equal(e.pattern, 'agent');
  assert.equal(e.renderer, 'auto');
  assert.equal(e.gate, 10);
  assert.equal(e.groupGate, 30);
  assert.deepEqual(e.filters, ['channel']);
  e.stages[1].match.kinds.push('x');
  assert.deepEqual(PATTERNS.find((p) => p.id === 'agent').stages[1].match.kinds, ['retrieval'], 'pattern defaults stay untouched');
  assert.equal(defaultExperience({ pattern: 'unknown' }).pattern, 'single');
});

test('views, rendererBy, user word', () => {
  assert.equal(VIEWS.length, 10);
  assert.deepEqual(USER_LABELS, ['customer', 'patient', 'employee', 'developer', 'shopper', 'prospect']);
  const e = { ...exp, renderer: 'chat', rendererBy: { key: 'channel', map: { email: 'email', odd: 'nonsense' } } };
  assert.equal(viewFor({ metadata: { channel: 'email' } }, e), 'email');
  assert.equal(viewFor({ metadata: { channel: 'sms' } }, e), 'chat');
  assert.equal(viewFor({ metadata: { channel: 'odd' } }, e), 'auto');
  assert.equal(normalizeViewId('custom:sms-card'), 'custom:sms-card');
  assert.equal(normalizeViewId('custom:../x'), 'auto');
  assert.equal(userWord(exp), 'patient');
  assert.equal(userWord({ userLabel: '  ' }), 'customer');
  assert.equal(withUser(COLUMNS[1].question, exp), 'Did it grasp what the patient wants?');
});
