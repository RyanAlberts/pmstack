import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJudgePrompt, judgeExamples, renderJudgeInput, batchJudgePrompt, parseJudgeOutput, parseJudgeResults,
  promptHash, definitionHash, cutMiddle, getNormalized, addCheck,
} from '../../docs/studio/lib/index.mjs';
import { makeProject, chatTrace, review } from '../fixtures/build.mjs';

const longTurns = [];
for (let i = 0; i < 30; i++) longTurns.push(i % 2 ? ['assistant', `Reply number ${i}: ${'lorem ipsum '.repeat(8)}`] : ['user', `Message ${i}: ${'dolor sit amet '.repeat(6)}`]);
longTurns[15] = ['assistant', 'PICKED STEP: here are more times instead of a person'];
longTurns.push(['assistant', 'FINAL OUTPUT: see you Friday']);

function project() {
  const traces = [
    chatTrace('e1', longTurns, { channel: 'sms' }),
    chatTrace('e2', [['user', 'two problems'], ['assistant', 'x']]),
    chatTrace('e3', [['user', 'book tuesday'], ['assistant', 'Booked for Tuesday at 9.']]),
    chatTrace('e4', [['user', 'book wednesday'], ['assistant', 'Booked.']]),
    chatTrace('e5', [['user', 'call me maybe'], ['assistant', 'Here are times.']]),
    chatTrace('e6', [['user', 'I want a human'], ['assistant', 'Sure, Friday?']]),
    chatTrace('t1', [['user', 'TUNING-ONLY-TEXT'], ['assistant', 'x']]),
    chatTrace('x1', [['user', 'TEST-ONLY-TEXT'], ['assistant', 'x']]),
  ];
  const p = makeProject({ traces, filters: ['channel'] });
  return {
    ...p,
    experience: { ...p.experience, product: 'Maple Dental booking assistant', customerGoal: 'Book, move, or cancel a visit by text.' },
    modes: [
      { id: 'fm-x', kind: 'failure', name: 'Ignores requests for a person', definition: 'Fails when the patient asks for a human and the assistant keeps handling it.', stage: null, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'fm-y', kind: 'failure', name: 'Other', definition: 'Fails when other.', stage: null, createdAt: '2026-09-01T00:00:00Z' },
    ],
    reviews: {
      e1: review('fail', 1, { modes: ['fm-x'], note: 'Asked twice for a person, kept offering times.', step: 'm15' }),
      e2: review('fail', 2, { modes: ['fm-x', 'fm-y'], note: 'Two things went wrong' }),
      e3: review('pass', 3, { good: 'Booked as asked; never asked for a person.' }),
      e4: review('pass', 4),
      e5: review('fail', 5, { modes: ['fm-x'], note: 'maybe' }),
      e6: review(null, 6),
      t1: review('fail', 7, { modes: ['fm-x'], note: 'TUNING NOTE' }),
      x1: review('fail', 8, { modes: ['fm-x'], note: 'TEST NOTE' }),
    },
    labels: { 'fm-x': { e6: 'fail' } },
    critiques: { 'fm-x': { e5: 'Close call: said "call me" once, then booked.', e6: 'Said "a human" and got times.' } },
    closeCalls: { 'fm-x': ['e5'] },
    splits: { 'fm-x': { seed: 7, assign: { e1: 'examples', e2: 'examples', e3: 'examples', e4: 'examples', e5: 'examples', e6: 'examples', t1: 'tuning', x1: 'test' }, revealedAt: null } },
  };
}

test('examples come from the examples split only and follow the critique rules', () => {
  const ex = judgeExamples(project(), 'fm-x', { maxExamples: 4 });
  assert.deepEqual(ex.map((e) => [e.traceId, e.label, e.closeCall]), [['e1', 'fail', false], ['e3', 'pass', false], ['e5', 'fail', true], ['e6', 'fail', false]]);
  assert.equal(ex[0].critique, 'Asked twice for a person, kept offering times.', 'the note, when it is the only failure mode');
  assert.equal(ex[1].critique, 'Booked as asked; never asked for a person.', 'the Good note for a pass example');
  assert.equal(ex[2].critique, 'Close call: said "call me" once, then booked.', 'an explicit critique wins');
  assert.equal(judgeExamples(project(), 'fm-x', { maxExamples: 2 }).length, 2);
});

test('buildJudgePrompt: one criterion, definitions, examples, JSON answer, placeholder last', () => {
  const prompt = buildJudgePrompt(project(), 'fm-x', { inputs: ['customer', 'metadata'] });
  assert.match(prompt, /Maple Dental booking assistant/);
  assert.match(prompt, /What the patient is trying to do: Book, move, or cancel a visit by text\./);
  assert.match(prompt, /does this trace show the failure "Ignores requests for a person"\?/);
  assert.match(prompt, /^Fail when: the patient asks for a human and the assistant keeps handling it\.$/m);
  assert.match(prompt, /^Pass when: the trace does not show this failure, even if something else went wrong\.$/m);
  assert.match(prompt, /\{"critique": ".*", "result": "Pass"\}/);
  assert.match(prompt, /Write the critique first/);
  assert.ok(prompt.trimEnd().endsWith('<trace>\n{{trace}}\n</trace>'));
  assert.equal(prompt.split('{{trace}}').length, 2);
  assert.doesNotMatch(prompt, /TUNING-ONLY-TEXT|TEST-ONLY-TEXT|TUNING NOTE|TEST NOTE/);
  assert.doesNotMatch(prompt, /Two things went wrong/);
  assert.match(prompt, /<example number="3" kind="close call">/);
  assert.match(prompt, /Result: Pass/);
  assert.match(prompt, /Details\nchannel: sms/, 'metadata filters appear when included');
  // The long example keeps the picked step window and the output, cut to 1,500 characters.
  const first = prompt.split('<example number="1">')[1].split('</trace>')[0];
  assert.ok(first.length <= 1520, `example is ${first.length} characters`);
  assert.match(first, /PICKED STEP/);
  assert.match(first, /FINAL OUTPUT/);
  assert.match(first, /\[\.\.\.\]/);
  assert.doesNotMatch(prompt, /[\u2013\u2014]/);
  const bare = buildJudgePrompt({ ...project(), splits: {} }, 'fm-x');
  assert.doesNotMatch(bare, /Examples a reviewer already judged/);
});

test('renderJudgeInput keeps $& and $\' literal and cuts long traces to 12,000 characters', () => {
  const p = makeProject({ traces: [chatTrace('h', [['user', "Price is $& and $' and $1"], ['assistant', 'ok']])] });
  const out = renderJudgeInput('Before {{trace}} after {{trace}}', getNormalized(p, 'h'), { inputs: ['customer'], userLabel: 'patient' });
  assert.equal(out, "Before [Patient] Price is $& and $' and $1\n[Assistant] ok after [Patient] Price is $& and $' and $1\n[Assistant] ok");
  const big = makeProject({ traces: [{ id: 'b', input: 'q', output: 'y'.repeat(30000) }] });
  const cut = renderJudgeInput('{{trace}}', getNormalized(big, 'b'), { inputs: ['customer'] });
  assert.ok(cut.length < 12100);
  assert.match(cut, /\[\.\.\. \d+ characters cut \.\.\.\]/);
  const total = ('[Customer] q\n[Output] ' + 'y'.repeat(30000)).length;
  assert.match(cut, new RegExp(`\\[\\.\\.\\. ${total - 12000} characters cut`));
  assert.equal(cutMiddle('short', 100), 'short');
});

test('batchJudgePrompt: up to 10 traces in trace blocks, answered as a JSON array', () => {
  let p = project();
  p = addCheck(p, { modeId: 'fm-x', type: 'judge', prompt: buildJudgePrompt(p, 'fm-x', { inputs: ['customer'] }), inputs: ['customer'] }).project;
  const ids = ['e3', 'e4', 't1'];
  const b = batchJudgePrompt(p, p.checks[0].id, ids);
  for (const id of ids) assert.match(b, new RegExp(`<trace id="${id}">`));
  assert.match(b, /Judge each trace on its own/);
  assert.match(b, /\[\{"trace_id": "<id from the trace tag>", "critique": "\.\.\.", "result": "Pass"\}\]/);
  assert.doesNotMatch(b, /\{\{trace\}\}/);
  assert.match(b, /This time there are 3 traces/);
  const many = batchJudgePrompt(p, p.checks[0].id, Array.from({ length: 14 }, (_, i) => (i % 2 ? 'e3' : 'e4')));
  assert.equal(many.split('<trace id=').length - 1, 10);
});

test('parseJudgeOutput tolerates fences and prose, takes the last object with a result', () => {
  assert.deepEqual(parseJudgeOutput('```json\n{"critique": "Asked for a person; got times.", "result": "Fail"}\n```'), { verdict: 'fail', critique: 'Asked for a person; got times.' });
  assert.deepEqual(parseJudgeOutput('Let me think. {"note": 1} Final: {"critique": "Fine {really}", "result": "Pass"} Done.'), { verdict: 'pass', critique: 'Fine {really}' });
  assert.deepEqual(parseJudgeOutput('{"critique":"a","result":"Pass"}\n{"critique":"b","result":"Fail"}'), { verdict: 'fail', critique: 'b' });
  assert.deepEqual(parseJudgeOutput('Critique: it ignored the ask.\n**Result:** Fail'), { verdict: 'fail', critique: '' });
  assert.equal(parseJudgeOutput('I cannot tell.'), null);
  assert.equal(parseJudgeOutput('{"critique": "x", "result": "Maybe"}'), null);
});

test('parseJudgeResults reads arrays, JSON lines, results maps, and CSV', () => {
  const arr = parseJudgeResults('Here you go:\n```json\n[{"trace_id": "t1", "critique": "ok", "result": "Pass"}, {"trace_id": "t2", "critique": "no", "result": "Fail"}]\n```');
  assert.deepEqual(arr, { results: { t1: { verdict: 'pass', critique: 'ok' }, t2: { verdict: 'fail', critique: 'no' } }, errors: [] });
  const prose = parseJudgeResults('Results: [{"trace_id": "t3", "critique": "fine", "result": "Pass"}] hope this helps');
  assert.deepEqual(prose.results.t3, { verdict: 'pass', critique: 'fine' });
  const jsonl = parseJudgeResults('{"trace_id": "t1", "result": "Fail", "critique": "a"}\n{"trace_id": "t2", "result": "unsure"}\n{"result": "Pass"}');
  assert.deepEqual(jsonl.results.t1, { verdict: 'fail', critique: 'a' });
  assert.deepEqual(jsonl.results.t2, { verdict: null, critique: '' });
  assert.deepEqual(jsonl.errors, ['Line 2: the result for "t2" is not Pass or Fail', 'Line 3: no trace id']);
  const map = parseJudgeResults('{"results": {"t1": {"result": "Pass", "critique": "c"}, "t2": "Fail"}}');
  assert.deepEqual(map.results, { t1: { verdict: 'pass', critique: 'c' }, t2: { verdict: 'fail', critique: '' } });
  const csv = parseJudgeResults('trace_id,result,critique\nt1,Pass,"Fine, all good"\nt2,Fail,Missed it\n');
  assert.deepEqual(csv.results, { t1: { verdict: 'pass', critique: 'Fine, all good' }, t2: { verdict: 'fail', critique: 'Missed it' } });
  assert.match(parseJudgeResults('nothing useful here').errors[0], /Could not read these results/);
});

test('hashes change with prompt, inputs, name, and definition', () => {
  const c = { prompt: 'a {{trace}}', inputs: ['customer'] };
  assert.equal(promptHash(c), promptHash({ ...c }));
  assert.notEqual(promptHash(c), promptHash({ ...c, prompt: 'b {{trace}}' }));
  assert.notEqual(promptHash(c), promptHash({ ...c, inputs: ['customer', 'tools'] }));
  const m = { name: 'n', definition: 'd' };
  assert.notEqual(definitionHash(m), definitionHash({ ...m, definition: 'e' }));
});
