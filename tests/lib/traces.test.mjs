import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTraceFile, normalizeTrace, normalizeAll, getNormalized, traceIndex, traceText, traceBlocks, getPath, fieldPaths,
  suggestView, suggestPattern, suggestFilters, searchIndex, detectShape, outputText, MAX_TRACES, defaultExperience,
} from '../../docs/studio/lib/index.mjs';
import { fixtureText, makeProject } from '../fixtures/build.mjs';

const parse = (name, opts) => parseTraceFile(fixtureText('traces/' + name), name, opts);
const norm = (raw, exp = null) => normalizeTrace(raw, exp);
const ids = (n) => n.steps.map((s) => s.id);
const outputs = (n) => n.steps.filter((s) => s.isOutput);

test('JSONL chat: ids, shape, metadata flattening, context, derived output', () => {
  const r = parse('chat.jsonl');
  assert.equal(r.shape, 'chat');
  assert.equal(r.shapeLabel, 'Chat messages');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.traces.map((t) => t.id), ['c-1', 'c-2', 'c-3']);
  const n = norm(r.traces[0]);
  assert.deepEqual(ids(n), ['m0', 'm1', 'm2']);
  assert.deepEqual(n.steps.map((s) => s.kind), ['system', 'user', 'assistant']);
  assert.equal(n.steps[0].customerVisible, false);
  assert.equal(n.steps[1].customerVisible, true);
  assert.equal(n.title, 'Move my cleaning');
  assert.deepEqual(n.metadata, { channel: 'sms', persona: 'existing patient', feedback: 'thumbs_down', 'clinic.city': 'Portland', tags: 'vip, returning' });
  assert.deepEqual(n.context, [{ label: 'Brief', value: 'Patient record 55' }]);
  assert.deepEqual(n.output, { type: 'text', text: 'Friday has **9:30 AM** or 2:00 PM open.', stepId: 'm2' });
  assert.equal(n.steps[2].isOutput, true);
  assert.equal(n.steps[1].time, Date.parse('2026-09-18T15:02:11Z'));
});

test('role aliases and text fields (content, text, message, transcript), times from start', () => {
  const [, voice, aliases] = parse('chat.jsonl').traces;
  const v = norm(voice);
  assert.deepEqual(v.steps.map((s) => [s.id, s.kind, s.text]), [
    ['m0', 'user', 'Hi, I need to cancel.'], ['m1', 'assistant', 'Sure, which day?'], ['m2', 'user', 'Tuesday'],
  ]);
  assert.equal(v.steps[0].time, 0);
  assert.equal(v.steps[0].endTime, 2500);
  assert.equal(v.steps[1].time, 3000);
  assert.equal(v.output.stepId, 'm1');
  assert.equal(v.title, 'Hi, I need to cancel.');
  const a = norm(aliases);
  assert.deepEqual(a.steps.map((s) => s.kind), ['user', 'assistant', 'assistant', 'assistant']);
  assert.equal(a.output.stepId, 'm3');
});

test('JSONL errors carry line numbers and keep the good lines', () => {
  const r = parse('broken.jsonl');
  assert.deepEqual(r.traces.map((t) => t.id), ['b-1', 'b-3']);
  assert.deepEqual(r.errors, ['Line 3: not valid JSON', 'Line 4: expected one trace object per line']);
});

test('JSON array: generated ids, numeric ids as strings, question and answer pairs, bare text', () => {
  const r = parse('array.json');
  assert.equal(r.traces.length, 3);
  assert.match(r.traces[0].id, /^t-[0-9a-f]{8}$/);
  assert.equal(r.traces[1].id, '42');
  assert.equal(r.shape, 'io');
  const qa = norm(r.traces[1]);
  assert.equal(qa.input, 'Do you ship to Canada?');
  assert.deepEqual(ids(qa), ['out']);
  assert.equal(qa.output.type, 'text');
  assert.equal(qa.title, 'Do you ship to Canada?');
  assert.equal(norm(r.traces[2]).output.text, 'Plain text trace');
  // Same content gives the same generated id on every parse.
  assert.equal(parse('array.json').traces[0].id, r.traces[0].id);
});

test('wrapper object with duplicate ids gets -2, -3 and a warning', () => {
  const r = parse('wrapper.json');
  assert.deepEqual(r.traces.map((t) => t.id), ['dup', 'dup-2', 'dup-3']);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /"dup" appears more than once/);
});

test('CSV: quotes, embedded commas and newlines, dotted headers, JSON cells', () => {
  const r = parse('traces.csv');
  assert.deepEqual(r.errors, []);
  const [a, b, c] = r.traces;
  assert.equal(a.input, 'Hello, world');
  assert.equal(a.output, 'Reply with "quotes"');
  assert.deepEqual(a.metadata, { channel: 'sms' });
  assert.match(b.input, /^Line one\r?\nline two$/);
  assert.ok(Array.isArray(b.messages));
  assert.deepEqual(ids(norm(b)), ['m0', 'm1', 'out']);
  assert.deepEqual(c, { id: 'csv-3' });
  const extra = parseTraceFile('id,input\nx-1,hello\nx-2,a,b\n', 'more.csv');
  assert.deepEqual(extra.errors, ['Line 3: has 3 cells but the header has 2']);
});

test('Anthropic blocks: thinking notes, tool_use, tool_result-only user message', () => {
  const r = parse('anthropic.jsonl');
  assert.equal(r.shape, 'anthropic');
  assert.equal(r.shapeLabel, 'Chat messages (Anthropic format)');
  const n = norm(r.traces[0]);
  assert.deepEqual(ids(n), ['m0', 'm1.t0', 'm1', 'm1.c0', 'm2.r0', 'm3']);
  const byId = Object.fromEntries(n.steps.map((s) => [s.id, s]));
  assert.equal(byId['m1.t0'].kind, 'note');
  assert.equal(byId['m1.t0'].customerVisible, false);
  assert.equal(byId['m1.c0'].kind, 'tool_call');
  assert.equal(byId['m1.c0'].callId, 'toolu_1');
  assert.deepEqual(byId['m1.c0'].data, { q: 'vacation days' });
  assert.equal(byId['m2.r0'].kind, 'tool_result');
  assert.equal(byId['m2.r0'].name, 'search_policies');
  assert.equal(byId['m2.r0'].customerVisible, false);
  assert.deepEqual(byId['m2.r0'].data, { days: 20 });
  assert.equal(n.steps.filter((s) => s.kind === 'user').length, 1, 'the tool_result-only message is not a user turn');
  assert.equal(n.output.stepId, 'm3');
  assert.deepEqual(n.context, [{ label: 'Instructions', value: 'You help with benefits questions.' }]);
});

test('OpenAI tool_calls with string arguments and role:tool results', () => {
  const r = parse('openai.jsonl');
  assert.equal(r.shape, 'openai');
  const n = norm(r.traces[0]);
  assert.deepEqual(ids(n), ['m0', 'm1', 'm2.c0', 'm2.c1', 'm3', 'm4', 'm5']);
  const [, , c0, c1, r0, r1] = n.steps;
  assert.deepEqual([c0.name, c0.callId, c0.data], ['find_slots', 'call_a1', { date: '2026-09-25' }]);
  assert.equal(c1.name, 'get_patient');
  assert.deepEqual([r0.kind, r0.callId, r0.name, r0.data], ['tool_result', 'call_a1', 'find_slots', { slots: ['09:30', '14:00'] }]);
  assert.equal(r1.data, null);
  assert.equal(r1.text, 'not json at all');
  assert.equal(n.output.stepId, 'm5');
});

test('OpenAI Responses items: function_call, function_call_output, reasoning', () => {
  const r = parse('responses.jsonl');
  assert.equal(r.shape, 'openai-responses');
  assert.equal(r.shapeLabel, 'OpenAI Responses items');
  const n = norm(r.traces[0]);
  assert.deepEqual(ids(n), ['m0', 'm1', 'm2.c0', 'm3', 'm4']);
  assert.deepEqual(n.steps.map((s) => s.kind), ['user', 'note', 'tool_call', 'tool_result', 'assistant']);
  assert.equal(n.steps[2].callId, 'fc_1');
  assert.deepEqual(n.steps[2].data, { q: 'blender', max: 80 });
  assert.equal(n.steps[3].name, 'search_catalog');
  assert.equal(n.output.stepId, 'm4');
  assert.equal(n.title, 'Find me a blender under $80');
});

test('step logs: s{j} ids, raw id in data.rawId, kinds, typed output step, result', () => {
  const r = parse('steps.jsonl');
  assert.equal(r.shape, 'steps');
  const n = norm(r.traces[0]);
  assert.deepEqual(ids(n), ['s0', 's1', 's2', 's3', 's4', 's5', 'out']);
  assert.deepEqual(n.steps.map((s) => s.kind), ['retrieval', 'llm', 'tool', 'handoff', 'guardrail', 'tool', 'output']);
  assert.equal(n.steps[0].data.rawId, 'step-a');
  assert.equal(n.steps[1].data.rawId, null);
  assert.equal(n.steps[2].status, 'error');
  assert.equal(n.output.type, 'answer');
  assert.equal(n.output.stepId, 'out');
  assert.deepEqual(n.result, { booked: false });
  assert.deepEqual(outputs(n).map((s) => s.id), ['out']);
});

test('typed outputs are inferred from their fields', () => {
  const [email, haiku, list] = parse('io.jsonl').traces.map((t) => norm(t));
  assert.equal(email.output.type, 'email');
  assert.equal(outputText(email.output), 'From: bot@example.com\nTo: legal@example.com\nSubject: Summary\n\nTwo parties agree.');
  assert.equal(haiku.input, 'Write a haiku');
  assert.equal(haiku.output.text, 'Leaves fall\nquietly');
  assert.equal(list.output.type, 'list');
  assert.match(outputText(list.output), /^1\. Copper pan \(\$64\)/);
  const single = norm(parse('text.jsonl').traces[0]);
  assert.equal(single.output.text, 'A single block of text the user saw.');
});

test('fieldMap maps id at parse time and title, input, output, messages at normalization', () => {
  const r = parse('fieldmap.jsonl', { fieldMap: { id: 'session' } });
  assert.equal(r.traces[0].id, 'sess-9');
  assert.equal(parse('fieldmap.jsonl').shape, 'unknown');
  const exp = { ...defaultExperience({}), fieldMap: { title: 'subject_line', input: 'request.text', output: 'reply', messages: 'turns' } };
  const n = norm(r.traces[0], exp);
  assert.equal(n.title, 'Order status');
  assert.equal(n.input, 'Where is my order?');
  assert.deepEqual(n.steps.map((s) => [s.id, s.kind]), [['m0', 'user'], ['m1', 'assistant'], ['out', 'output']]);
  assert.equal(n.output.text, 'It ships tomorrow.');
});

test('exactly one output step whenever there is an output', () => {
  for (const name of ['chat.jsonl', 'array.json', 'traces.csv', 'anthropic.jsonl', 'openai.jsonl', 'responses.jsonl', 'steps.jsonl', 'io.jsonl', 'text.jsonl']) {
    for (const t of parse(name).traces) {
      const n = norm(t);
      assert.equal(outputs(n).length, n.output ? 1 : 0, `${name} ${t.id}`);
      if (n.output) assert.equal(outputs(n)[0].id, n.output.stepId);
    }
  }
});

test('the trace cap is 20,000 with a plain error', () => {
  const lines = [];
  for (let i = 0; i <= MAX_TRACES; i++) lines.push(`{"id":"t${i}"}`);
  const r = parseTraceFile(lines.join('\n'), 'big.jsonl');
  assert.equal(r.traces.length, MAX_TRACES);
  assert.match(r.errors[0], /20,001 traces/);
});

test('detectShape covers the simple shapes', () => {
  assert.equal(detectShape({ input: 'a', output: 'b' }), 'io');
  assert.equal(detectShape({ text: 'x' }), 'text');
  assert.equal(detectShape({ foo: 1 }), 'unknown');
  assert.equal(detectShape({ steps: [{ type: 'llm' }] }), 'steps');
});

test('getPath and fieldPaths', () => {
  const obj = { a: { b: [{ c: 5 }] }, messages: [{ role: 'user', content: 'hi' }] };
  assert.equal(getPath(obj, 'a.b[0].c'), 5);
  assert.equal(getPath(obj, 'a.b.0.c'), 5);
  assert.equal(getPath(obj, 'messages[0].content'), 'hi');
  assert.equal(getPath(obj, 'a.x.y'), undefined);
  const paths = fieldPaths(parse('chat.jsonl').traces);
  for (const p of ['id', 'metadata.channel', 'messages', 'messages[0].role', 'messages[0].content']) assert.ok(paths.includes(p), p);
});

test('traceText: sections in order, tool lines, retrieval lines, typed output, include filter', () => {
  const openai = norm(parse('openai.jsonl').traces[0]);
  const text = traceText(openai, { userLabel: 'patient' });
  assert.match(text, /^\[Patient\] Book me for Friday/m);
  assert.match(text, /^\[Tool call find_slots\] \{"date":"2026-09-25"\}$/m);
  assert.match(text, /^\[Tool result\] \{"slots":\["09:30","14:00"\]\}$/m);
  assert.match(text, /^\[Assistant\] Friday has 9:30 AM/m);
  assert.doesNotMatch(text, /You book appointments/, 'instructions only with include system');
  assert.match(traceText(openai, { include: ['customer', 'system'] }), /\[Instructions\] You book appointments/);
  assert.doesNotMatch(traceText(openai, { include: ['customer'] }), /Tool call/);

  const chat = norm(parse('chat.jsonl').traces[0]);
  const withDetails = traceText(chat, { filters: ['channel', 'persona'] });
  assert.ok(withDetails.startsWith('Details\nchannel: sms\npersona: existing patient\nContext\nBrief: Patient record 55\n\n[Customer]'));
  assert.doesNotMatch(traceText(chat, { filters: [] }), /Details/);

  const steps = norm(parse('steps.jsonl').traces[0]);
  const st = traceText(steps, {});
  assert.match(st, /^\[Customer\] How much parental leave/m);
  assert.match(st, /^\[Retrieved hr-12\] Parental leave policy: Employees get 16 weeks\.$/m);
  assert.match(st, /^\[Step run_tests\] \(error\) 2 failed$/m);
  assert.match(st, /\[Answer\]\nYou get 16 weeks of parental leave \[1\]\.\n\nSources cited:\n\[1\] hr-12: "Employees get 16 weeks\."/);
  assert.doesNotMatch(traceText(steps, { include: ['customer'] }), /Retrieved/);
  assert.deepEqual(traceBlocks(steps, {}).filter((b) => b.stepId).map((b) => b.stepId), ['s0', 's1', 's2', 's3', 's4', 's5', 'out']);
});

test('suggestView, suggestPattern, suggestFilters', () => {
  assert.equal(suggestView(parse('chat.jsonl').traces), 'chat');
  assert.equal(suggestView(parse('steps.jsonl').traces), 'answer');
  assert.equal(suggestView([parse('io.jsonl').traces[0]]), 'email');
  assert.equal(suggestView([parse('io.jsonl').traces[2]]), 'list');
  assert.equal(suggestView([{ id: 'a', steps: [{ type: 'tool', name: 'x' }] }]), 'agent');
  assert.equal(suggestView([{ id: 'a', foo: 'bar' }]), 'document');

  assert.equal(suggestPattern(parse('openai.jsonl').traces), 'augmented');
  assert.equal(suggestPattern(parse('steps.jsonl').traces), 'routing');
  assert.equal(suggestPattern(parse('chat.jsonl').traces), 'single');
  const agentLog = { id: 'ag', steps: ['read_file', 'read_file', 'run_tests', 'read_file', 'post_comment'].map((name) => ({ type: 'tool', name })) };
  assert.equal(suggestPattern([agentLog]), 'agent');
  assert.equal(suggestPattern([{ id: 'ch', steps: [{ type: 'llm', name: 'draft' }, { type: 'llm', name: 'polish' }] }]), 'chain');

  const traces = ['sms', 'web', 'sms', 'voice'].map((channel, i) => ({ id: `f${i}`, input: 'x', metadata: { channel, unique: `u${i}`, same: 'one' } }));
  assert.deepEqual(suggestFilters(traces), ['channel', 'unique']);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, input: 'x', metadata: { session: `s${i}`, channel: i % 2 ? 'sms' : 'web' } }));
  assert.deepEqual(suggestFilters(many), ['channel']);
});

test('memoized indexes keep identity until traces or stages change', () => {
  const p = makeProject({ traces: parse('chat.jsonl').traces });
  const all = normalizeAll(p);
  assert.equal(normalizeAll(p), all);
  assert.equal(getNormalized(p, 'c-1'), all.get('c-1'));
  assert.equal(traceIndex(p).get('c-2'), p.traces[1]);
  const idx = searchIndex(p);
  assert.match(idx.get('c-1'), /move my cleaning/);
  // A setup edit that keeps the stages reuses normalized traces.
  const q = { ...p, experience: { ...p.experience, filters: ['channel'] } };
  assert.equal(getNormalized(q, 'c-1'), all.get('c-1'));
  // New stages normalize again.
  const r = { ...p, experience: { ...p.experience, stages: p.experience.stages.slice(0, 2) } };
  assert.notEqual(getNormalized(r, 'c-1'), all.get('c-1'));
  assert.equal(getNormalized(p, 'missing'), null);
});

test('CSV spreadsheet export: extra columns become details, and an id column keeps its ids', () => {
  const rows = ['Conversation ID,Timestamp,Channel,Customer Message,Bot Reply,CSAT'];
  for (let i = 1; i <= 30; i++) rows.push(`CX-${1000 + i},2026-09-${String(i).padStart(2, '0')},${['web', 'email', 'sms'][i % 3]},Question number ${i},Reply number ${i},${(i % 5) + 1}`);
  rows.push(',2026-09-30,web,No id here,Reply,4');
  const r = parseTraceFile(rows.join('\n') + '\n', 'support_export.csv');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.traces.slice(0, 2).map((t) => t.id), ['CX-1001', 'CX-1002'], '"Conversation ID" is the trace id');
  assert.match(r.traces[30].id, /^t-[0-9a-f]{8}$/, 'an empty id cell still gets a generated id');
  assert.deepEqual(r.traces[0].metadata, { Timestamp: '2026-09-01', channel: 'email', 'Customer Message': 'Question number 1', 'Bot Reply': 'Reply number 1', CSAT: '2' });
  assert.deepEqual(suggestFilters(r.traces), ['channel', 'CSAT']);
  const exp = { ...defaultExperience({ pattern: 'single', renderer: 'chat' }), fieldMap: { input: 'metadata.Customer Message', output: 'metadata.Bot Reply' } };
  const n = norm(r.traces[0], exp);
  assert.equal(n.input, 'Question number 1');
  assert.equal(n.output.text, 'Reply number 1');
  assert.deepEqual(n.metadata, { Timestamp: '2026-09-01', channel: 'email', CSAT: '2' }, 'mapped text is not repeated as a detail');
  const both = parseTraceFile('id,metadata,Plan\nm-1,"{""channel"":""sms""}",gig\n', 'mixed.csv');
  assert.deepEqual(both.traces[0].metadata, { Plan: 'gig', channel: 'sms' }, 'a metadata cell and extra columns merge');
});

test('id keys match however a spreadsheet writes them', () => {
  const r = parseTraceFile([{ 'Trace ID': 'a-1', input: 'x' }, { 'session-id': 's-2', input: 'y' }, { traceId: 't-3', input: 'z' }].map((t) => JSON.stringify(t)).join('\n'), 'ids.jsonl');
  assert.deepEqual(r.traces.map((t) => t.id), ['a-1', 's-2', 't-3']);
});

test('a CSV header cannot reach Object.prototype', () => {
  const r = parseTraceFile('id,input,output,__proto__.polluted,constructor\nt1,hi,hello,yes,z\n', 'traces.csv');
  assert.deepEqual(r.errors, ['Header "__proto__.polluted" was skipped: that name is not allowed.', 'Header "constructor" was skipped: that name is not allowed.']);
  assert.deepEqual(r.traces, [{ id: 't1', input: 'hi', output: 'hello' }]);
  assert.equal(({}).polluted, undefined);
  assert.equal(String({}), '[object Object]');
});
