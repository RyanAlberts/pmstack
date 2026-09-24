// judge.mjs: AI judge prompts and answers. One judge decides pass or fail for
// one failure mode, writes its critique before its result, and learns from
// examples drawn only from the examples split.
//
// The method (binary judges, critique first, examples kept apart from the data
// used to measure the judge) is adapted from hamelsmu/evals-skills (MIT,
// (c) 2026 Hamel Husain). The prompt wording below is pmstack's own.

import { hashString, verdictFor } from './metrics.mjs';
import { getNormalized, parseCsv, traceBlocks, traceText } from './traces.mjs';
import { labeledSet, splitOf } from './labels.mjs';
import { modeMap } from './review.mjs';
import { userWord } from './experience.mjs';
import { TOOL_CHECK_TEMPLATES } from './toolcalls.mjs';

const EMPTY = Object.freeze([]);
const DEFAULT_INPUTS = ['customer', 'tools', 'retrieval', 'metadata', 'context'];
const EXAMPLE_MAX = 1500;
const TRACE_MAX = 12000;
const TRACE_BLOCK = '<trace>\n{{trace}}\n</trace>';

/**
 * Judge templates for Tool call checks. Each has the default failure mode name and definition,
 * the inputs the judge sees by default, and criteria that buildJudgePrompt inserts when a mode's
 * template is set. {userLabel} is replaced with the project's user word.
 */
export const JUDGE_TEMPLATES = {
  relevance: {
    id: 'relevance',
    name: TOOL_CHECK_TEMPLATES.relevance.name,
    definition: TOOL_CHECK_TEMPLATES.relevance.definition,
    inputs: ['customer', 'tools'],
    focus: 'Read what the {userLabel} asked for, then each tool call the agent made and the details it passed.',
    criteria: [
      'The tool the agent calls serves what the {userLabel} asked for.',
      'The details it passes (dates, amounts, account numbers, names) match what the {userLabel} said.',
      'It makes no calls the request did not need.',
      'It does not skip a call the request needed.',
      'When a required detail is missing, it asks the {userLabel} instead of guessing.',
    ],
  },
  grounding: {
    id: 'grounding',
    name: TOOL_CHECK_TEMPLATES.grounding.name,
    definition: TOOL_CHECK_TEMPLATES.grounding.definition,
    inputs: ['tools', 'customer'],
    focus: 'Compare the final reply with the tool results. The rest of the trace is only context.',
    criteria: [
      'Every fact in the reply is backed by a tool result shown in the trace.',
      'No value in the reply differs from a tool result (amounts, times, dates, ids).',
      'Qualifiers from the tool results are kept, such as pending, estimated, partial, or until a date.',
      'Nothing is described as done unless a tool result shows it done.',
      'The reply leaves out no tool result that changes what the {userLabel} should do next.',
    ],
  },
};

/** Cut the middle of long text: first and last halves with "[... N characters cut ...]" between. */
export function cutMiddle(text, max = TRACE_MAX) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return `${s.slice(0, half)}\n[... ${s.length - 2 * half} characters cut ...]\n${s.slice(s.length - half)}`;
}

// Shorten an example trace to about 1,500 characters: keep the header, the picked step
// with its neighbors, and the output; drop the rest with "[...]".
function exampleText(n, pickedStep, opts) {
  const full = traceText(n, opts);
  if (full.length <= EXAMPLE_MAX) return full;
  const blocks = traceBlocks(n, opts);
  const ids = blocks.map((b) => b.stepId);
  const firstStep = ids.findIndex((id) => id != null);
  const keep = new Set();
  // Details, Context, and the input come before the first step.
  blocks.forEach((_, i) => { if (firstStep < 0 || i < firstStep) keep.add(i); });
  const at = pickedStep ? ids.indexOf(pickedStep) : -1;
  if (at >= 0) { for (let i = at - 1; i <= at + 1; i++) if (i >= 0 && i < blocks.length) keep.add(i); }
  else if (firstStep >= 0) keep.add(firstStep); // the opening request
  const outAt = n.output ? ids.indexOf(n.output.stepId) : -1;
  keep.add(outAt >= 0 ? outAt : blocks.length - 1);

  const kept = [...keep].sort((a, b) => a - b);
  const budget = Math.max(100, Math.floor((EXAMPLE_MAX - 8 * (kept.length + 1)) / kept.length));
  const shorten = (t) => (t.length > budget ? `${t.slice(0, Math.floor(budget / 2))} [...] ${t.slice(t.length - Math.floor(budget / 2))}` : t);
  const parts = [];
  let prev = -1;
  for (const i of kept) {
    if (i > prev + 1) parts.push('[...]');
    parts.push(shorten(blocks[i].text));
    prev = i;
  }
  if (prev < blocks.length - 1) parts.push('[...]');
  const joined = parts.join('\n');
  if (joined.length <= EXAMPLE_MAX) return joined;
  const half = Math.floor((EXAMPLE_MAX - 7) / 2);
  return `${joined.slice(0, half)}\n[...]\n${joined.slice(joined.length - half)}`;
}

// The one-line reason a reviewer gave for an example, following the example rules.
function exampleCritique(p, modeId, traceId, label) {
  const own = p.critiques?.[modeId]?.[traceId];
  if (own && own.trim()) return own.trim();
  const r = p.reviews?.[traceId];
  if (!r) return '';
  const mm = modeMap(p);
  if (label === 'fail' && r.verdict === 'fail') {
    const fm = (r.modes || EMPTY).filter((id) => mm.get(id)?.kind === 'failure');
    if (fm.length === 1 && fm[0] === modeId) return String(r.note || '').trim();
  }
  if (label === 'pass' && r.verdict === 'pass') return String(r.good || '').trim();
  return '';
}

/** Examples the prompt will show: [{ traceId, label, critique, closeCall }], from the examples split only. */
export function judgeExamples(p, modeId, { maxExamples = 4 } = {}) {
  const close = new Set(p.closeCalls?.[modeId] || EMPTY);
  const pool = labeledSet(p, modeId)
    .filter(({ traceId }) => splitOf(p, modeId, traceId) === 'examples')
    .map(({ traceId, label }) => ({ traceId, label, critique: exampleCritique(p, modeId, traceId, label), closeCall: close.has(traceId) }))
    .filter((e) => e.critique);
  const picked = [];
  const take = (pred) => {
    const e = pool.find((x) => !picked.includes(x) && pred(x));
    if (e && picked.length < maxExamples) picked.push(e);
    return !!e;
  };
  take((e) => e.label === 'fail' && !e.closeCall) || take((e) => e.label === 'fail');
  take((e) => e.label === 'pass' && !e.closeCall) || take((e) => e.label === 'pass');
  take((e) => e.closeCall);
  // Fill the rest alternating Problem and Good; when one side runs out, take the other.
  let turn = 'fail';
  while (picked.length < maxExamples) {
    const left = pool.filter((x) => !picked.includes(x));
    if (!left.length) break;
    picked.push(left.find((x) => x.label === turn) || left[0]);
    turn = turn === 'fail' ? 'pass' : 'fail';
  }
  return picked;
}

/**
 * Build the judge prompt for one failure mode, in pmstack's own words, ending with the {{trace}}
 * placeholder. A mode made from a tool call template (mode.template 'relevance' or 'grounding')
 * gets that template's criteria, and its inputs when none are given.
 */
export function buildJudgePrompt(p, modeId, { maxExamples = 4, inputs } = {}) {
  const mode = modeMap(p).get(modeId) || { name: modeId, definition: '' };
  const exp = p.experience || {};
  const who = userWord(exp);
  const template = JUDGE_TEMPLATES[mode.template] || null;
  const fillWho = (text) => String(text ?? '').split('{userLabel}').join(who);
  if (!inputs) inputs = template ? template.inputs : DEFAULT_INPUTS;
  const product = String(exp.product || p.name || 'an AI product').trim();
  const goal = String(exp.customerGoal || '').trim();
  const definition = fillWho(String(mode.definition || '').trim().replace(/^fails when:?\s*/i, '')) || mode.name;
  const opts = { include: inputs, filters: exp.filters || EMPTY, userLabel: who };
  const lines = [
    `You check traces from ${product}. A trace is one full conversation or task: what the ${who} said, every step the AI took, and what the ${who} saw.`,
    `Your job is to decide one thing only: does this trace show the failure "${mode.name}"?`,
    '',
    'About the product',
    `Product: ${product}`,
    goal ? `What the ${who} is trying to do: ${goal}` : `The ${who} uses it to get something done.`,
    '',
    'The failure to look for',
    `Fail when: ${definition}`,
    'Pass when: the trace does not show this failure, even if something else went wrong.',
  ];
  if (template) {
    lines.push('', 'What to check', fillWho(template.focus), 'The trace passes only when all of these hold:', ...template.criteria.map((c) => `- ${fillWho(c)}`), '');
  }
  lines.push(`Judge this failure only. Other problems do not change the result. Decide from what the trace shows, and quote the words or steps that settle it.`);
  const examples = judgeExamples(p, modeId, { maxExamples });
  if (examples.length) {
    lines.push('', 'Examples a reviewer already judged');
    examples.forEach((e, i) => {
      const r = p.reviews?.[e.traceId];
      const n = getNormalized(p, e.traceId);
      lines.push(
        '',
        `<example number="${i + 1}"${e.closeCall ? ' kind="close call"' : ''}>`,
        '<trace>',
        n ? exampleText(n, r?.step, opts) : '(trace not loaded)',
        '</trace>',
        `Critique: ${e.critique}`,
        `Result: ${e.label === 'pass' ? 'Pass' : 'Fail'}`,
        '</example>',
      );
    });
  }
  lines.push(
    '',
    'How to answer',
    'Reply with one JSON object and nothing else. Write the critique first, then the result:',
    '{"critique": "Two to four sentences that point to the exact words or steps that decide it.", "result": "Pass"}',
    'The result is "Pass" or "Fail". No other values.',
    '',
    'The trace to judge',
    TRACE_BLOCK,
  );
  return lines.join('\n');
}

/** Put one trace into a judge prompt (split and join, so $& and $' stay literal); the trace is cut to 12,000 characters. */
export function renderJudgeInput(prompt, normalized, { inputs = DEFAULT_INPUTS, filters = [], userLabel = 'customer' } = {}) {
  const text = cutMiddle(traceText(normalized, { include: inputs, filters, userLabel }), TRACE_MAX);
  return String(prompt).split('{{trace}}').join(text);
}

/** A prompt that judges up to 10 traces at once, each on its own, answered as a JSON array. */
export function batchJudgePrompt(p, checkId, traceIds) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  if (!check) return '';
  const exp = p.experience || {};
  const opts = { inputs: check.inputs || DEFAULT_INPUTS, filters: exp.filters || EMPTY, userLabel: userWord(exp) };
  const ids = (traceIds || EMPTY).slice(0, 10);
  const base = String(check.prompt || buildJudgePrompt(p, check.modeId, { inputs: opts.inputs }));
  const head = base.includes(TRACE_BLOCK)
    ? base.split(TRACE_BLOCK).join('(The traces are listed below.)')
    : base.split('{{trace}}').join('(The traces are listed below.)');
  const blocks = ids.map((id) => {
    const n = getNormalized(p, id);
    const text = n ? cutMiddle(traceText(n, { include: opts.inputs, filters: opts.filters, userLabel: opts.userLabel }), TRACE_MAX) : '(trace not loaded)';
    return `<trace id="${id}">\n${text}\n</trace>`;
  });
  return [
    head,
    '',
    `This time there are ${ids.length} traces. Judge each trace on its own, as if it were the only one, with the same rules.`,
    '',
    ...blocks,
    '',
    'Reply with one JSON array and nothing else, one entry per trace, in the same order. This replaces the single JSON object described above:',
    '[{"trace_id": "<id from the trace tag>", "critique": "...", "result": "Pass"}]',
  ].join('\n');
}

/** Every balanced {...} (or [...] with open '[' and close ']') in text that parses as JSON, in order. */
export function jsonValues(text, open = '{', close = '}') {
  const s = String(text ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf(open, i);
    if (start < 0) break;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = start; j < s.length; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) { end = j; break; }
    }
    if (end < 0) { i = start + 1; continue; }
    try {
      out.push(JSON.parse(s.slice(start, end + 1)));
      i = end + 1;
    } catch {
      i = start + 1;
    }
  }
  return out;
}

const resultOf = (o) => o?.result ?? o?.verdict ?? o?.label;

/** Read one judge answer (code fences and prose allowed): { verdict, critique } or null. */
export function parseJudgeOutput(text) {
  const objs = jsonValues(text).filter((o) => o && typeof o === 'object' && !Array.isArray(o) && resultOf(o) != null);
  if (objs.length) {
    const o = objs[objs.length - 1];
    const verdict = verdictFor(resultOf(o));
    if (verdict) return { verdict, critique: String(o.critique ?? o.reason ?? o.reasoning ?? '') };
  }
  const re = /"?result"?\s*[:=]\s*"?\**\s*(pass|fail)\b/gi;
  let m, last = null;
  while ((m = re.exec(String(text ?? ''))) !== null) last = m;
  return last ? { verdict: last[1].toLowerCase(), critique: '' } : null;
}

const idOf = (o) => o?.trace_id ?? o?.traceId ?? o?.id;

/**
 * Read pasted judge results: a JSON array, JSON lines, { results: ... }, or CSV with
 * trace_id,result,critique. Unreadable results come back with verdict null plus an error.
 */
export function parseJudgeResults(text) {
  const results = {};
  const errors = [];
  const src = String(text ?? '').replace(/```[a-zA-Z]*\n?/g, '').trim();
  const add = (o, where) => {
    const id = idOf(o);
    if (id == null || id === '') { errors.push(`${where}: no trace id`); return; }
    const verdict = verdictFor(resultOf(o));
    if (!verdict) errors.push(`${where}: the result for "${id}" is not Pass or Fail`);
    results[String(id)] = { verdict, critique: String(o.critique ?? o.reason ?? '') };
  };
  if (!src) return { results, errors: ['Nothing to read yet.'] };

  let value;
  try { value = JSON.parse(src); } catch { value = undefined; }
  if (value === undefined && src.includes('[')) {
    const arrays = jsonValues(src, '[', ']').filter((a) => Array.isArray(a) && a.some((x) => x && typeof x === 'object'));
    if (arrays.length) value = arrays[arrays.length - 1];
  }
  if (value !== undefined) {
    const list = Array.isArray(value) ? value : Array.isArray(value?.results) ? value.results : null;
    if (list) list.forEach((o, i) => add(o, `Entry ${i + 1}`));
    else if (value?.results && typeof value.results === 'object') {
      for (const [id, v] of Object.entries(value.results)) add(typeof v === 'object' && v ? { ...v, trace_id: id } : { trace_id: id, result: v }, `Trace ${id}`);
    } else if (value && typeof value === 'object') add(value, 'Entry 1');
    return { results, errors };
  }

  const lines = src.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length && lines.every((l) => l.trim().startsWith('{'))) {
    lines.forEach((l, i) => {
      try { add(JSON.parse(l), `Line ${i + 1}`); } catch { errors.push(`Line ${i + 1}: not valid JSON`); }
    });
    return { results, errors };
  }

  const rows = parseCsv(src);
  const header = rows[0]?.cells.map((h) => h.trim().toLowerCase()) || [];
  const col = (names) => header.findIndex((h) => names.includes(h));
  const idCol = col(['trace_id', 'traceid', 'id']);
  const resCol = col(['result', 'verdict']);
  if (idCol < 0 || resCol < 0) return { results, errors: ['Could not read these results. Paste a JSON array, JSON lines, or CSV with trace_id,result,critique.'] };
  const critCol = col(['critique', 'reason']);
  for (const { cells, line } of rows.slice(1)) add({ trace_id: cells[idCol]?.trim(), result: cells[resCol], critique: critCol >= 0 ? cells[critCol] : '' }, `Line ${line}`);
  return { results, errors };
}

/** Hash of what the judge is told: its prompt and its inputs. */
export function promptHash(check) {
  return hashString(`${check?.prompt ?? ''}\n${(check?.inputs || EMPTY).join(',')}`);
}

/** Hash of a failure mode's name and definition. */
export function definitionHash(mode) {
  return hashString(`${mode?.name ?? ''}\n${mode?.definition ?? ''}`);
}
