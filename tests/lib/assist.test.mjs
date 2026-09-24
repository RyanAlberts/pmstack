import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupingPrompt, scanPrompt, parseAssistResponse, mergeSuggestions, acceptSuggestion, dismissSuggestion,
  openSuggestionsFor, pastedId, hashString,
} from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace, review } from '../fixtures/build.mjs';

const now = { now: '2026-09-20T12:00:00Z' };

function project() {
  const traces = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => chatTrace(id, [['user', `question ${id}`], ['assistant', `answer ${id}`]]));
  return makeProject({
    traces,
    modes: [{ id: 'fm-person', kind: 'failure', name: 'Ignores requests for a person', definition: 'Fails when the patient asks for a person and gets times.', stage: 'act', createdAt: '2026-09-15T00:00:00Z' }],
    reviews: {
      a: review('fail', 1, { note: 'Asked for the front desk twice', modes: ['fm-person'] }),
      b: review('fail', 2, { note: 'Offered Friday 9:30 but it was taken', stage: 'gather' }),
      c: review('pass', 3, { good: 'Read the booking back' }),
      d: review('skip', 4),
      e: review('fail', 5, { note: '' }),
    },
  });
}

test('groupingPrompt: notes, stages, existing modes, rules, answer format', () => {
  const parts = groupingPrompt(project());
  assert.equal(parts.length, 1);
  const [p] = parts;
  assert.doesNotMatch(p, /^Part /);
  assert.match(p, /- b \(gather\): Offered Friday 9:30 but it was taken/);
  assert.doesNotMatch(p, /Asked for the front desk twice/, 'notes already in a failure mode are not regrouped');
  assert.doesNotMatch(p, /- e/, 'empty notes are left out');
  assert.match(p, /- act: Use tools/);
  assert.match(p, /- Ignores requests for a person \(stage act\): Fails when/);
  assert.match(p, /under 10 failure modes/);
  assert.match(p, /in the patient's terms/);
  assert.match(p, /Start each definition with "Fails when"/);
  assert.match(p, /\{ "modes": \[ \{ "name": "\.\.\.", "definition": "Fails when \.\.\.", "stage": "<stage id or null>", "traceIds": \["<trace id>"\] \} \] \}/);
  const success = groupingPrompt(project(), { kind: 'success' })[0];
  assert.match(success, /- c: Read the booking back/);
  assert.match(success, /"Passes when"/);
});

test('groupingPrompt splits into self-contained parts over 60,000 characters', () => {
  const p = project();
  const traces = [];
  const reviews = {};
  for (let i = 0; i < 400; i++) {
    const id = `n${i}`;
    traces.push(chatTrace(id));
    reviews[id] = review('fail', i, { note: `Note ${i}: ${'the assistant kept offering times instead of a person '.repeat(4)}` });
  }
  const big = { ...p, traces, reviews };
  const parts = groupingPrompt(big);
  assert.ok(parts.length >= 2);
  parts.forEach((part, i) => {
    assert.ok(part.length <= 60000, `part ${i + 1} is ${part.length} characters`);
    assert.ok(part.startsWith(`Part ${i + 1} of ${parts.length}.`));
    assert.match(part, /Rules:/);
    assert.match(part, /Answer with one JSON object/);
  });
  const all = parts.join('\n');
  for (let i = 0; i < 400; i++) assert.equal(all.split(`- n${i}: `).length, 2, `note n${i} appears once`);
});

test('scanPrompt: every trace not tagged with the mode, with example notes and the mode id', () => {
  const [p] = scanPrompt(project(), 'fm-person');
  assert.match(p, /Id: fm-person/);
  assert.match(p, /Name: Ignores requests for a person/);
  assert.match(p, /- "Asked for the front desk twice"/);
  for (const id of ['b', 'c', 'd', 'e', 'f']) assert.match(p, new RegExp(`<trace id="${id}">`));
  assert.doesNotMatch(p, /<trace id="a">/);
  assert.match(p, /\{ "modeId": "fm-person", "flags": \[/);
  assert.deepEqual(scanPrompt(project(), 'nope'), []);
  const only = scanPrompt(project(), 'fm-person', ['f'])[0];
  assert.equal(only.split('<trace id=').length - 1, 1);
});

test('parseAssistResponse: modes and flags, pasted ids, errors', () => {
  const reply = 'Sure!\n```json\n{"modes": [{"name": "Offers a taken time", "definition": "Fails when it offers a booked slot.", "stage": "gather", "traceIds": ["b"]}, {"name": "", "traceIds": []}]}\n```\nAnd part 2: {"modes": [{"name": "Offers a taken time", "traceIds": ["e"]}]}';
  const r = parseAssistResponse(reply, { kind: 'mode', now: now.now });
  assert.equal(r.suggestions.length, 1);
  const s = r.suggestions[0];
  assert.equal(s.id, `sg-p-${hashString('mode' + '' + 'Offers a taken time')}`);
  assert.equal(s.id, pastedId('mode', '', 'Offers a taken time'));
  assert.deepEqual(s.traceIds, ['b', 'e'], 'the same mode across parts merges its traces');
  assert.deepEqual(s.mode, { name: 'Offers a taken time', definition: 'Fails when it offers a booked slot.', stage: 'gather', kind: 'failure' });
  assert.equal(s.status, 'open');
  assert.equal(s.createdAt, now.now);
  assert.deepEqual(r.errors, ['Suggested mode 2 has no name.']);

  const flags = parseAssistResponse('{"modeId": "fm-person", "flags": [{"traceId": "c", "quote": "call me", "reason": "Asked for a call"}, {"quote": "x"}]}', { kind: 'flag' });
  assert.equal(flags.suggestions[0].id, `sg-p-${hashString('flag' + 'c' + 'fm-person')}`);
  assert.equal(flags.suggestions[0].modeId, 'fm-person');
  assert.deepEqual(flags.errors, ['Flag 2 has no trace id.']);
  const noEcho = parseAssistResponse('{"flags": [{"traceId": "c"}]}', { kind: 'flag', modeId: 'fm-person' });
  assert.equal(noEcho.suggestions[0].modeId, 'fm-person', 'the option fills in a missing modeId');
  assert.match(parseAssistResponse('no json here', { kind: 'mode' }).errors[0], /no answer we can read/);
});

test('mergeSuggestions: new ids only, statuses never change, reviewed computed', () => {
  let p = project();
  const flag = (traceId, id = pastedId('flag', traceId, 'fm-person')) => ({ id, kind: 'flag', status: 'open', from: 'paste', traceId, modeId: 'fm-person', quote: '', reason: '' });
  p = mergeSuggestions(p, [flag('c'), flag('f'), flag('zzz'), flag('a')], now);
  assert.deepEqual(p.suggestions.map((s) => [s.traceId, s.reviewed]), [['c', true], ['f', false]], 'unknown traces and already-tagged traces are skipped');
  p = dismissSuggestion(p, p.suggestions[0].id, now);
  const again = mergeSuggestions(p, [{ ...flag('c'), status: 'open' }], now);
  assert.equal(again, p, 'nothing new');
  assert.equal(again.suggestions[0].status, 'dismissed');
  const m1 = { id: 'sg-m', kind: 'mode', status: 'open', mode: { name: 'X' }, traceIds: ['b'] };
  p = mergeSuggestions(p, [m1], now);
  p = mergeSuggestions(p, [{ ...m1, traceIds: ['e'] }], now);
  assert.deepEqual(p.suggestions.find((s) => s.id === 'sg-m').traceIds, ['b', 'e']);
});

test('accepting a mode: creates it, tags Problem reviews, leaves Good and Not sure alone, flags unreviewed traces', () => {
  let p = project();
  p = mergeSuggestions(p, [{ id: 'sg-1', kind: 'mode', status: 'open', from: 'paste', createdAt: now.now, mode: { name: 'Offers a taken time', definition: 'Fails when x.', stage: 'gather', kind: 'failure' }, traceIds: ['b', 'c', 'd', 'e', 'f'], reason: '' }], now);
  const { project: q, openTraceId } = acceptSuggestion(p, 'sg-1', now);
  assert.equal(openTraceId, null);
  const mode = q.modes.find((m) => m.name === 'Offers a taken time');
  assert.equal(mode.id, 'fm-offers-a-taken-time');
  assert.equal(mode.source, 'ai');
  assert.equal(mode.stage, 'gather');
  assert.deepEqual(q.reviews.b.modes, ['fm-offers-a-taken-time']);
  assert.deepEqual(q.reviews.e.modes, ['fm-offers-a-taken-time']);
  assert.equal(q.reviews.c, p.reviews.c, 'a Good review is untouched');
  assert.equal(q.reviews.d, p.reviews.d, 'a Not sure yet review is untouched');
  assert.equal(q.suggestions.find((s) => s.id === 'sg-1').status, 'accepted');
  const newFlags = q.suggestions.filter((s) => s.kind === 'flag');
  assert.deepEqual(newFlags.map((s) => [s.traceId, s.modeId, s.status]), [['f', 'fm-offers-a-taken-time', 'open']]);
  const kept = acceptSuggestion(p, 'sg-1', { ...now, traceIds: ['b'] }).project;
  assert.deepEqual(kept.reviews.e.modes, [], 'unticked traces are left out');
  assert.deepEqual(acceptSuggestion(q, 'sg-1', now).project, q, 'an accepted suggestion cannot be accepted twice');
});

test('accepting a flag: tags a Problem review; a Good or unreviewed trace opens for the reviewer', () => {
  let p = project();
  const f = (id, traceId) => ({ id, kind: 'flag', status: 'open', from: 'paste', traceId, modeId: 'fm-person', quote: 'q', reason: 'r' });
  p = mergeSuggestions(p, [f('s-b', 'b'), f('s-c', 'c'), f('s-f', 'f')], now);
  const onFail = acceptSuggestion(p, 's-b', now);
  assert.deepEqual(onFail.project.reviews.b.modes, ['fm-person']);
  assert.equal(onFail.project.suggestions.find((s) => s.id === 's-b').status, 'accepted');
  const onPass = acceptSuggestion(p, 's-c', now);
  assert.equal(onPass.openTraceId, 'c');
  assert.equal(onPass.project, p, 'kept open, nothing written');
  const unreviewed = acceptSuggestion(p, 's-f', now);
  assert.equal(unreviewed.openTraceId, 'f');
  assert.deepEqual(openSuggestionsFor(p, 'c').map((s) => s.id), ['s-c']);
  assert.deepEqual(openSuggestionsFor(dismissSuggestion(p, 's-c', now), 'c'), []);
});

test('accepting a batch suggestion sets the next set', () => {
  let p = project();
  p = mergeSuggestions(p, [{ id: 'sg-batch', kind: 'batch', status: 'open', from: 'agent', items: [{ traceId: 'f', reason: 'sms, long conversation' }] }], now);
  const { project: q } = acceptSuggestion(p, 'sg-batch', now);
  assert.deepEqual(q.batch, { createdAt: now.now, strategy: 'suggested', items: [{ traceId: 'f', reason: 'sms, long conversation' }] });
  assert.equal(q.suggestions[0].status, 'accepted');
});
