// traces.mjs: read trace files (JSONL, JSON, CSV) in the common shapes,
// normalize each trace into one step list with stable step ids, and keep
// memoized indexes so views stay fast at 20,000 traces.

import { hashString } from './metrics.mjs';
import { compileStages } from './experience.mjs';

/** Most traces one project holds. */
export const MAX_TRACES = 20000;

/** Plain names for each detected file shape. */
export const SHAPE_LABELS = {
  chat: 'Chat messages',
  anthropic: 'Chat messages (Anthropic format)',
  openai: 'Chat messages (OpenAI format)',
  'openai-responses': 'OpenAI Responses items',
  io: 'Question and answer pairs',
  steps: 'Step-by-step agent log',
  text: 'Single text',
  unknown: 'Not recognized yet: pick the fields below',
};

/** Parts of a trace that traceText can include. */
export const TEXT_PARTS = ['customer', 'tools', 'retrieval', 'metadata', 'context', 'system'];
const DEFAULT_INCLUDE = ['customer', 'tools', 'retrieval', 'metadata', 'context'];

const STEP_KINDS = new Set(['retrieval', 'llm', 'tool', 'handoff', 'guardrail', 'note']);
const OUTPUT_TYPES = new Set(['text', 'email', 'answer', 'code-review', 'fields', 'document', 'list', 'image', 'data']);
const ANTHROPIC_BLOCKS = new Set(['tool_use', 'tool_result', 'thinking', 'redacted_thinking']);
const RESPONSES_TYPES = new Set(['message', 'function_call', 'function_call_output', 'reasoning']);
const ID_KEYS = ['id', 'trace_id', 'traceId', 'session_id', 'conversation_id'];

// ---------------------------------------------------------------- helpers

/** Read a value at a path such as 'a.b[0].c'; undefined when missing. */
export function getPath(obj, path) {
  if (path == null || path === '') return obj;
  const parts = String(path).match(/[^.[\]]+/g) || [];
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const commas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try { return JSON.parse(t); } catch { return v; }
}

// Times become milliseconds: epoch ms, ISO strings, or seconds from the start (small numbers).
function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v > 1e11 ? v : v * 1000) : null;
  if (typeof v === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return toMs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function roleOf(r) {
  const s = typeof r === 'string' ? r.trim().toLowerCase() : '';
  if (['agent', 'bot', 'ai', 'model', 'assistant'].includes(s)) return 'assistant';
  if (['caller', 'customer', 'human', 'user'].includes(s)) return 'user';
  if (s === 'system' || s === 'developer') return 'system';
  if (s === 'tool' || s === 'function' || s === 'ipython') return 'tool';
  return s || 'user';
}

// ---------------------------------------------------------------- CSV

/** Parse RFC 4180 CSV text into rows of cells, each row with its starting line number. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, line = 1, rowLine = 1, i = 0;
  const src = String(text);
  const endRow = () => { row.push(cell); rows.push({ cells: row, line: rowLine }); row = []; cell = ''; };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      if (ch === '\n') line++;
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' && src[i + 1] === '\n') { i++; continue; }
    if (ch === '\n' || ch === '\r') { endRow(); line++; rowLine = line; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) endRow();
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

// ---------------------------------------------------------------- parsing

function rowsFromJsonValue(value, errors) {
  const list = Array.isArray(value) ? value
    : isObj(value) && Array.isArray(value.traces) ? value.traces
      : isObj(value) ? [value] : null;
  if (!list) { errors.push('Could not find traces in this file. Expected a list of traces or { "traces": [...] }.'); return []; }
  const rows = [];
  list.forEach((item, i) => {
    if (typeof item === 'string') rows.push({ raw: { text: item }, where: `Trace ${i + 1}` });
    else if (isObj(item)) rows.push({ raw: item, where: `Trace ${i + 1}` });
    else errors.push(`Trace ${i + 1}: expected an object`);
  });
  return rows;
}

function rowsFromJsonl(src, errors) {
  const rows = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    let v;
    try { v = JSON.parse(t); } catch { errors.push(`Line ${i + 1}: not valid JSON`); return; }
    if (!isObj(v)) { errors.push(`Line ${i + 1}: expected one trace object per line`); return; }
    rows.push({ raw: v, where: `Line ${i + 1}` });
  });
  return rows;
}

function rowsFromCsv(src, errors) {
  const table = parseCsv(src);
  if (!table.length) return [];
  const header = table[0].cells.map((h) => h.trim());
  const rows = [];
  for (const { cells, line } of table.slice(1)) {
    if (cells.length > header.length) errors.push(`Line ${line}: has ${cells.length} cells but the header has ${header.length}`);
    const raw = {};
    header.forEach((h, i) => {
      if (!h) return;
      const cell = cells[i];
      if (cell == null || cell.trim() === '') return;
      const value = parseMaybeJson(cell);
      if (h.includes('.')) setPath(raw, h, value);
      else raw[h] = value;
    });
    rows.push({ raw, where: `Line ${line}` });
  }
  return rows;
}

/** Parse a trace file: JSONL, JSON array, { traces: [...] }, or CSV. Assigns ids and detects the shape. */
export function parseTraceFile(text, filename = '', { fieldMap = null } = {}) {
  const errors = [];
  const warnings = [];
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  if (!src.trim()) return { traces: [], shape: 'unknown', shapeLabel: SHAPE_LABELS.unknown, errors: ['The file is empty.'], warnings };
  const ext = ((String(filename).match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const first = src.trimStart()[0];
  let rows;
  if (ext === 'csv') rows = rowsFromCsv(src, errors);
  else if (ext === 'jsonl' || ext === 'ndjson') rows = rowsFromJsonl(src, errors);
  else if (ext === 'json' || first === '[' || first === '{') {
    let value, ok = false;
    try { value = JSON.parse(src); ok = true; } catch { /* maybe JSONL */ }
    if (ok) rows = rowsFromJsonValue(value, errors);
    else if (first === '{' && src.trim().split(/\r?\n/).length > 1) rows = rowsFromJsonl(src, errors);
    else { errors.push('This file is not valid JSON.'); rows = []; }
  } else rows = rowsFromCsv(src, errors);

  if (rows.length > MAX_TRACES) {
    errors.push(`This file has ${commas(rows.length)} traces. A project holds up to 20,000, so only the first 20,000 were read.`);
    rows = rows.slice(0, MAX_TRACES);
  }

  const seen = new Map();
  const traces = [];
  for (const { raw, where } of rows) {
    let id = fieldMap?.id ? getPath(raw, fieldMap.id) : undefined;
    if (id == null || id === '') id = ID_KEYS.map((k) => raw[k]).find((v) => v != null && v !== '' && typeof v !== 'object');
    if (id == null || id === '') id = 't-' + hashString(JSON.stringify(raw)).slice(0, 8);
    id = String(id);
    if (seen.has(id)) {
      let k = seen.get(id) + 1;
      while (seen.has(`${id}-${k}`)) k++;
      seen.set(id, k);
      const renamed = `${id}-${k}`;
      warnings.push(`${where}: the id "${id}" appears more than once, so this trace is now "${renamed}".`);
      seen.set(renamed, 1);
      id = renamed;
    } else seen.set(id, 1);
    const { id: _old, ...rest } = raw;
    traces.push({ id, ...rest });
  }

  const counts = new Map();
  for (const t of traces.slice(0, 50)) {
    const s = detectShape(fieldMap ? applyFieldMap(t, fieldMap) : t);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let shape = 'unknown', best = 0;
  for (const [s, c] of counts) if (c > best) { shape = s; best = c; }
  return { traces, shape, shapeLabel: SHAPE_LABELS[shape], errors, warnings };
}

// ---------------------------------------------------------------- shapes

function responsesItems(raw) {
  const arrays = [raw.items, raw.messages, raw.input, raw.output].filter(Array.isArray);
  if (!arrays.some((a) => a.some((it) => isObj(it) && RESPONSES_TYPES.has(it.type) && (it.type !== 'message' || it.role)))) return null;
  return [
    ...(Array.isArray(raw.items) ? raw.items : []),
    ...(Array.isArray(raw.messages) ? raw.messages : []),
    ...(Array.isArray(raw.input) ? raw.input : []),
    ...(Array.isArray(raw.output) ? raw.output : []),
  ];
}

const ioInput = (raw) => [raw.input, raw.question, raw.prompt].find((v) => v != null && typeof v !== 'object');
const ioOutput = (raw) => (raw.output != null ? raw.output : [raw.answer, raw.completion].find((v) => typeof v === 'string'));
const singleText = (raw) => [raw.text, raw.content, raw.transcript].find((v) => typeof v === 'string');

/** Detect the shape of one raw trace: chat, anthropic, openai, openai-responses, io, steps, text, or unknown. */
export function detectShape(raw) {
  if (typeof raw === 'string') return 'text';
  if (!isObj(raw)) return 'unknown';
  if (responsesItems(raw)) return 'openai-responses';
  const msgs = Array.isArray(raw.messages) ? raw.messages : null;
  if (msgs && msgs.length) {
    if (msgs.some((m) => Array.isArray(m?.content) && m.content.some((b) => isObj(b) && ANTHROPIC_BLOCKS.has(b.type)))) return 'anthropic';
    if (msgs.some((m) => isObj(m) && (Array.isArray(m.tool_calls) || m.role === 'tool' || m.function_call || m.tool_call_id))) return 'openai';
    return 'chat';
  }
  if (Array.isArray(raw.steps) && raw.steps.length) return 'steps';
  if (ioInput(raw) != null || ioOutput(raw) != null) return 'io';
  if (singleText(raw) != null) return 'text';
  return 'unknown';
}

function applyFieldMap(raw, fm) {
  if (!fm) return raw;
  const out = { ...raw };
  for (const key of ['title', 'input', 'output', 'messages']) {
    if (!fm[key]) continue;
    const v = getPath(raw, fm[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// ---------------------------------------------------------------- outputs

function inferOutput(obj) {
  if (typeof obj.subject === 'string' && obj.body != null) return { type: 'email', ...obj };
  if (typeof obj.diff === 'string' || Array.isArray(obj.comments)) return { type: 'code-review', ...obj };
  if (Array.isArray(obj.citations) && obj.text != null) return { type: 'answer', ...obj };
  if (Array.isArray(obj.fields)) return { type: 'fields', ...obj };
  if (Array.isArray(obj.items)) return { type: 'list', ...obj };
  if (typeof obj.src === 'string') return { type: 'image', ...obj };
  if (typeof obj.body === 'string') return { type: 'document', ...obj };
  if (typeof obj.text === 'string') return { type: 'text', ...obj };
  return { type: 'data', value: obj };
}

// Turn any raw output value into a typed output object.
function typedOutput(v) {
  if (typeof v === 'string') return { type: 'text', text: v };
  if (typeof v === 'number' || typeof v === 'boolean') return { type: 'text', text: String(v) };
  if (Array.isArray(v)) return { type: 'data', value: v };
  if (isObj(v)) {
    if (typeof v.type === 'string' && OUTPUT_TYPES.has(v.type)) return { ...v };
    const { type: _t, ...rest } = v;
    const inferred = inferOutput(v.type ? rest : v);
    return inferred.type === 'data' ? { type: 'data', value: v } : inferred;
  }
  return { type: 'text', text: '' };
}

/** Plain text of a typed output. With full, include source material (the diff, the source document). */
export function outputText(output, { full = false } = {}) {
  const o = output;
  if (!o) return '';
  const lines = [];
  switch (o.type) {
    case 'email':
      if (o.from) lines.push(`From: ${str(o.from)}`);
      if (o.to) lines.push(`To: ${str(o.to)}`);
      if (o.subject) lines.push(`Subject: ${str(o.subject)}`);
      if (lines.length) lines.push('');
      lines.push(str(o.body));
      break;
    case 'answer': {
      lines.push(str(o.text));
      const cites = Array.isArray(o.citations) ? o.citations : [];
      if (cites.length) {
        lines.push('', 'Sources cited:');
        for (const c of cites) lines.push(`[${c?.n ?? '?'}] ${str(c?.doc)}${c?.quote ? `: "${str(c.quote)}"` : ''}`);
      }
      break;
    }
    case 'code-review': {
      if (o.title) lines.push(str(o.title));
      if (full && o.diff) lines.push('', 'Diff:', str(o.diff));
      const comments = Array.isArray(o.comments) ? o.comments : [];
      if (comments.length) {
        lines.push('', 'Review comments:');
        for (const c of comments) lines.push(`${str(c?.file)}${c?.line != null ? ':' + c.line : ''}${c?.severity ? ` (${c.severity})` : ''} ${str(c?.body)}`);
      }
      if (o.summary) lines.push('', `Summary: ${str(o.summary)}`);
      if (o.verdict) lines.push(`Verdict: ${str(o.verdict)}`);
      break;
    }
    case 'fields':
      if (full && o.document) lines.push('Source document:', str(o.document), '', 'Fields:');
      for (const f of Array.isArray(o.fields) ? o.fields : []) lines.push(`${str(f?.name)}: ${str(f?.value)}`);
      break;
    case 'document':
      if (o.title) lines.push(str(o.title), '');
      lines.push(str(o.body));
      break;
    case 'list':
      if (o.intro) lines.push(str(o.intro), '');
      (Array.isArray(o.items) ? o.items : []).forEach((it, i) => {
        lines.push(`${i + 1}. ${str(it?.title)}${it?.subtitle ? ` (${str(it.subtitle)})` : ''}`);
        for (const [k, v] of Object.entries(isObj(it?.details) ? it.details : {})) lines.push(`   ${k}: ${str(v)}`);
        if (it?.reason) lines.push(`   Reason: ${str(it.reason)}`);
      });
      break;
    case 'image':
      lines.push(`[Image] ${str(o.alt)}`);
      break;
    case 'data':
      lines.push(JSON.stringify(o.value, null, 2));
      break;
    default:
      lines.push(str(o.text));
  }
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------- steps

function makeStep(id, kind, fields) {
  return {
    id, kind,
    role: fields.role ?? null,
    name: fields.name ?? null,
    text: fields.text ?? '',
    data: fields.data ?? null,
    status: fields.status ?? null,
    time: fields.time ?? null,
    endTime: fields.endTime ?? null,
    callId: fields.callId ?? null,
    stage: fields.rawStage ?? null, // replaced by the stage matcher
    customerVisible: fields.customerVisible ?? false,
    isOutput: false,
  };
}

function contentText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : b?.type === 'image' ? '[image]' : str(b))).join('\n');
  }
  if (typeof c.text === 'string') return c.text;
  return str(c);
}

function callStep(id, name, args, callId, m, rawStage) {
  const data = parseMaybeJson(args);
  return makeStep(id, 'tool_call', {
    role: 'assistant', name, text: typeof args === 'string' ? args : str(args ?? {}), data, callId,
    time: toMs(m?.time ?? m?.timestamp), rawStage,
  });
}

function resultStep(id, callId, content, name, m, rawStage, isError) {
  const text = contentText(content);
  const parsed = typeof content === 'string' ? parseMaybeJson(content) : content;
  return makeStep(id, 'tool_result', {
    role: 'tool', name, text, data: parsed === text ? null : parsed, callId,
    status: isError ? 'error' : null, time: toMs(m?.time ?? m?.timestamp), rawStage,
  });
}

// Messages (chat, OpenAI, Anthropic, Responses items) -> steps. Ids follow the raw index.
function messageSteps(msgs, steps) {
  const callNames = new Map();
  msgs.forEach((m, i) => {
    if (m == null) return;
    const id = `m${i}`;
    if (typeof m === 'string') { steps.push(makeStep(id, 'user', { role: 'user', text: m, customerVisible: true })); return; }
    if (!isObj(m)) return;
    const rawStage = m.stage;
    const time = toMs(m.time ?? m.timestamp ?? m.start ?? m.start_time);
    const endTime = toMs(m.endTime ?? m.end_time ?? m.end);

    if (m.type === 'function_call') {
      callNames.set(m.call_id ?? m.id, m.name);
      steps.push(callStep(`${id}.c0`, m.name ?? null, m.arguments, m.call_id ?? m.id ?? null, m, rawStage));
      return;
    }
    if (m.type === 'function_call_output') {
      steps.push(resultStep(id, m.call_id ?? null, m.output, m.name ?? callNames.get(m.call_id) ?? null, m, rawStage));
      return;
    }
    if (m.type === 'reasoning') {
      const text = Array.isArray(m.summary) ? m.summary.map((s) => s?.text ?? '').join('\n') : contentText(m.content);
      steps.push(makeStep(id, 'note', { role: 'assistant', text, rawStage }));
      return;
    }

    const role = roleOf(m.role ?? m.speaker ?? m.author);
    const c = [m.content, m.text, m.message, m.transcript].find((v) => v != null);

    if (role === 'tool') {
      const callId = m.tool_call_id ?? m.call_id ?? null;
      steps.push(resultStep(id, callId, c, m.name ?? callNames.get(callId) ?? null, m, rawStage));
      return;
    }

    // Walk content blocks in order; text blocks merge into one step at the first text position.
    const entries = [];
    const texts = [];
    let textAt = -1, k = 0, r = 0, t = 0;
    const addText = (s) => {
      if (textAt < 0) { textAt = entries.length; entries.push(null); }
      texts.push(s);
    };
    if (Array.isArray(c)) {
      for (const b of c) {
        if (typeof b === 'string') { addText(b); continue; }
        if (!isObj(b)) continue;
        if (b.type === 'tool_use') {
          callNames.set(b.id, b.name);
          entries.push(callStep(`${id}.c${k++}`, b.name ?? null, b.input, b.id ?? null, m, rawStage));
        } else if (b.type === 'tool_result') {
          entries.push(resultStep(`${id}.r${r++}`, b.tool_use_id ?? null, b.content, callNames.get(b.tool_use_id) ?? null, m, rawStage, b.is_error));
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          entries.push(makeStep(`${id}.t${t++}`, 'note', { role: 'assistant', text: b.thinking ?? '(hidden reasoning)', rawStage }));
        } else if (b.type === 'image' || b.type === 'image_url' || b.type === 'input_image') addText('[image]');
        else if (typeof b.text === 'string') addText(b.text);
      }
    } else if (c != null) addText(contentText(c));

    for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      const name = tc?.function?.name ?? tc?.name ?? null;
      callNames.set(tc?.id, name);
      entries.push(callStep(`${id}.c${k++}`, name, tc?.function?.arguments ?? tc?.arguments ?? tc?.input, tc?.id ?? null, m, rawStage));
    }
    if (isObj(m.function_call)) {
      entries.push(callStep(`${id}.c${k++}`, m.function_call.name ?? null, m.function_call.arguments, null, m, rawStage));
    }

    const text = texts.join('\n\n');
    if (textAt >= 0) {
      if (text.trim()) {
        const kind = role === 'system' ? 'system' : role === 'user' ? 'user' : 'assistant';
        entries[textAt] = makeStep(id, kind, {
          role: kind === 'assistant' && role !== 'assistant' ? role : kind, text, time, endTime,
          customerVisible: kind !== 'system', rawStage,
        });
      } else entries.splice(textAt, 1);
    }
    for (const e of entries) if (e) steps.push(e);
  });
}

function rawSteps(list, steps) {
  list.forEach((s, j) => {
    if (!isObj(s)) return;
    const kind = STEP_KINDS.has(s.type) ? s.type : 'tool';
    const out = s.output ?? s.result;
    const text = out != null ? str(out) : str(s.input);
    steps.push(makeStep(`s${j}`, kind, {
      role: null,
      name: s.name ?? s.type ?? null,
      text,
      data: { ...s, rawId: s.id ?? null },
      status: s.status ?? (s.error ? 'error' : null),
      time: toMs(s.time ?? s.start_time ?? s.startTime),
      endTime: toMs(s.endTime ?? s.end_time),
      rawStage: s.stage,
    }));
  });
}

function flatten(obj, prefix, out, depth) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) continue;
    if (Array.isArray(v)) out[key] = v.map((x) => (x != null && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    else if (typeof v === 'object') { if (depth < 6) flatten(v, key, out, depth + 1); }
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
  }
  return out;
}

function contextOf(raw) {
  const out = [];
  const c = raw.context;
  if (typeof c === 'string') { if (c.trim()) out.push({ label: 'Context', value: c }); }
  else if (Array.isArray(c)) {
    c.forEach((x, i) => {
      if (isObj(x) && 'value' in x) out.push({ label: String(x.label ?? `Item ${i + 1}`), value: str(x.value) });
      else out.push({ label: `Item ${i + 1}`, value: str(x) });
    });
  } else if (isObj(c)) {
    for (const [k, v] of Object.entries(c)) out.push({ label: k, value: typeof v === 'string' ? v : JSON.stringify(v, null, 2) });
  }
  const sys = typeof raw.system === 'string' ? raw.system : Array.isArray(raw.system) ? contentText(raw.system) : '';
  if (sys.trim()) out.push({ label: 'Instructions', value: sys });
  return out;
}

const clip = (s, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '\u2026' : t;
};

function buildNormalized(rawIn, experience) {
  const raw0 = isObj(rawIn) ? rawIn : { text: str(rawIn) };
  const raw = applyFieldMap(raw0, experience?.fieldMap);
  const steps = [];
  const items = responsesItems(raw);
  if (items) messageSteps(items, steps);
  else if (Array.isArray(raw.messages)) messageSteps(raw.messages, steps);
  if (Array.isArray(raw.steps)) rawSteps(raw.steps, steps);

  let outVal = items && Array.isArray(raw.output) ? undefined : ioOutput(raw);
  if (outVal === undefined && !items && !Array.isArray(raw.messages) && !Array.isArray(raw.steps) && singleText(raw) != null) outVal = singleText(raw);
  let output = null;
  if (outVal != null) {
    const o = typedOutput(outVal);
    const s = makeStep('out', 'output', { role: 'assistant', text: outputText(o), data: o, customerVisible: true, rawStage: raw.outputStage });
    s.isOutput = true;
    steps.push(s);
    output = { ...o, stepId: 'out' };
  } else {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.kind === 'assistant' && s.customerVisible && s.text.trim()) {
        s.isOutput = true;
        output = { type: 'text', text: s.text, stepId: s.id };
        break;
      }
    }
  }

  const match = compileStages(experience?.stages);
  for (const s of steps) s.stage = match(s);

  const input = items ? (typeof raw.input === 'string' ? raw.input : null) : ioInput(raw);
  const firstUser = steps.find((s) => s.kind === 'user' && s.text.trim());
  const id = String(raw0.id ?? '');
  const title = (typeof raw.title === 'string' && raw.title.trim()) ? raw.title.trim()
    : firstUser ? clip(firstUser.text) : input != null && String(input).trim() ? clip(input) : id;

  return {
    id,
    title,
    metadata: isObj(raw.metadata) ? flatten(raw.metadata, '', {}, 0) : {},
    context: contextOf(raw),
    input: input == null ? null : String(input),
    steps,
    output,
    result: raw.result ?? null,
    shape: detectShape(raw),
    raw: rawIn,
  };
}

// ---------------------------------------------------------------- memoized indexes

// Normalization depends only on stages and fieldMap, so edits to other setup fields reuse the cache.
const NO_STAGES = [];
const NO_FIELDMAP = {};
const KEYS = new WeakMap();
function normKey(experience) {
  const stages = Array.isArray(experience?.stages) ? experience.stages : NO_STAGES;
  const fm = isObj(experience?.fieldMap) ? experience.fieldMap : NO_FIELDMAP;
  let inner = KEYS.get(stages);
  if (!inner) { inner = new WeakMap(); KEYS.set(stages, inner); }
  let key = inner.get(fm);
  if (!key) { key = { stages, fieldMap: fm === NO_FIELDMAP ? null : fm }; inner.set(fm, key); }
  return key;
}

const NORM = new WeakMap(); // raw -> WeakMap(key -> normalized)
const NO_TRACES = [];

/** Normalize one raw trace (memoized by the raw object and the setup's stages and field map). */
export function normalizeTrace(raw, experience = null) {
  const key = normKey(experience);
  if (!raw || typeof raw !== 'object') return buildNormalized(raw, key);
  let inner = NORM.get(raw);
  if (!inner) { inner = new WeakMap(); NORM.set(raw, inner); }
  let n = inner.get(key);
  if (!n) { n = buildNormalized(raw, key); inner.set(key, n); }
  return n;
}

const INDEX = new WeakMap();
/** Map of trace id -> raw trace (memoized on project.traces). */
export function traceIndex(project) {
  const traces = project?.traces || NO_TRACES;
  let m = INDEX.get(traces);
  if (!m) { m = new Map(traces.map((t) => [String(t.id), t])); INDEX.set(traces, m); }
  return m;
}

const POS = new WeakMap();
/** Map of trace id -> position in project.traces (memoized). */
export function tracePositions(project) {
  const traces = project?.traces || NO_TRACES;
  let m = POS.get(traces);
  if (!m) { m = new Map(traces.map((t, i) => [String(t.id), i])); POS.set(traces, m); }
  return m;
}

const ALL = new WeakMap();
/** Map of trace id -> normalized trace for the whole project (memoized). */
export function normalizeAll(project) {
  const traces = project?.traces || NO_TRACES;
  const key = normKey(project?.experience);
  let inner = ALL.get(traces);
  if (!inner) { inner = new WeakMap(); ALL.set(traces, inner); }
  let m = inner.get(key);
  if (!m) {
    m = new Map();
    for (const t of traces) m.set(String(t.id), normalizeTrace(t, key));
    inner.set(key, m);
  }
  return m;
}

/** One normalized trace by id, or null. */
export function getNormalized(project, id) {
  const raw = traceIndex(project).get(String(id));
  return raw ? normalizeTrace(raw, project.experience) : null;
}

const VERSIONS = new WeakMap();
/** Distinct metadata.version values in trace order. */
export function traceVersions(project) {
  const traces = project?.traces || NO_TRACES;
  let v = VERSIONS.get(traces);
  if (!v) {
    const seen = new Set();
    for (const t of traces) {
      const x = t?.metadata?.version;
      if (x != null && x !== '') seen.add(String(x));
    }
    v = [...seen];
    VERSIONS.set(traces, v);
  }
  return v;
}

// ---------------------------------------------------------------- text

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const OUTPUT_LABELS = { text: 'Output', email: 'Email', answer: 'Answer', 'code-review': 'Code review', fields: 'Fields', document: 'Document', list: 'List', image: 'Image', data: 'Output' };

function stepLine(s, inc, who) {
  switch (s.kind) {
    case 'user': return inc.has('customer') ? `[${who}] ${s.text}` : null;
    case 'assistant': return inc.has('customer') ? `[Assistant] ${s.text}` : null;
    case 'system': return inc.has('system') ? `[Instructions] ${s.text}` : null;
    case 'tool_call': return inc.has('tools') ? `[Tool call ${s.name ?? 'tool'}] ${s.text}` : null;
    case 'tool_result': return inc.has('tools') ? `[Tool result]${s.status === 'error' ? ' (error)' : ''} ${s.text}` : null;
    case 'note': return inc.has('tools') ? `[AI reasoning] ${s.text}` : null;
    case 'output': {
      if (!inc.has('customer')) return null;
      const o = s.data || {};
      const label = OUTPUT_LABELS[o.type] || 'Output';
      const body = outputText(o, { full: true });
      return o.type === 'text' ? `[${label}] ${body}` : `[${label}]\n${body}`;
    }
    case 'retrieval': {
      if (!inc.has('retrieval')) return null;
      const docs = Array.isArray(s.data?.documents) ? s.data.documents : [];
      const lines = [];
      if (s.data?.input != null) lines.push(`[Search ${s.name ?? 'documents'}] ${str(s.data.input)}`);
      for (const d of docs) lines.push(`[Retrieved ${str(d?.id)}] ${d?.title ? str(d.title) + ': ' : ''}${str(d?.text)}`);
      if (!docs.length && s.data?.output != null) lines.push(`[Step ${s.name ?? 'retrieval'}] ${str(s.data.output)}`);
      return lines.length ? lines.join('\n') : null;
    }
    default:
      return inc.has('tools') ? `[Step ${s.name ?? s.kind}]${s.status === 'error' ? ' (error)' : ''} ${s.text}` : null;
  }
}

/** Blocks of trace text, each tied to a step id (null for Details, Context, and the input). */
export function traceBlocks(normalized, { include = DEFAULT_INCLUDE, filters = [], userLabel = 'customer' } = {}) {
  const n = normalized;
  if (!n) return [];
  const inc = new Set(include);
  const blocks = [];
  if (inc.has('metadata') && filters.length) {
    const lines = filters.filter((k) => n.metadata[k] != null && n.metadata[k] !== '').map((k) => `${k}: ${n.metadata[k]}`);
    if (lines.length) blocks.push({ stepId: null, text: 'Details\n' + lines.join('\n') });
  }
  if (inc.has('context') && n.context.length) {
    blocks.push({ stepId: null, text: 'Context\n' + n.context.map((c) => `${c.label}: ${c.value}`).join('\n') });
  }
  const who = cap(String(userLabel || 'customer'));
  if (inc.has('customer') && n.input && !n.steps.some((s) => s.kind === 'user')) blocks.push({ stepId: null, text: `[${who}] ${n.input}` });
  for (const s of n.steps) {
    const t = stepLine(s, inc, who);
    if (t) blocks.push({ stepId: s.id, text: t });
  }
  return blocks;
}

/** Plain text of a normalized trace: Details, Context, then each step, then the final output. */
export function traceText(normalized, opts = {}) {
  const blocks = traceBlocks(normalized, opts);
  const head = blocks.filter((b) => b.stepId == null && /^(Details|Context)\n/.test(b.text));
  const body = blocks.filter((b) => !head.includes(b));
  return [...head.map((b) => b.text), ...(head.length && body.length ? [''] : []), ...body.map((b) => b.text)].join('\n');
}

const SEARCH = new WeakMap();
/** Map of trace id -> lowercased searchable text (memoized). */
export function searchIndex(project) {
  const traces = project?.traces || NO_TRACES;
  const key = normKey(project?.experience);
  let inner = SEARCH.get(traces);
  if (!inner) { inner = new WeakMap(); SEARCH.set(traces, inner); }
  let m = inner.get(key);
  if (!m) {
    m = new Map();
    for (const [id, n] of normalizeAll(project)) {
      const meta = Object.entries(n.metadata).map(([k, v]) => `${k} ${v}`).join('\n');
      const text = traceText(n, { include: TEXT_PARTS, filters: [], userLabel: 'customer' });
      m.set(id, `${id}\n${n.title}\n${meta}\n${text}`.toLowerCase());
    }
    inner.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------- suggestions

/** Field paths found in the first `limit` traces, for the field-mapping menus. */
export function fieldPaths(traces, limit = 20) {
  const seen = new Set();
  const out = [];
  const add = (p) => { if (p && !seen.has(p)) { seen.add(p); out.push(p); } };
  const walk = (v, path, depth) => {
    if (v == null || depth > 5) return;
    if (Array.isArray(v)) {
      add(path);
      if (v.length && v[0] != null && typeof v[0] === 'object') walk(v[0], `${path}[0]`, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      add(path);
      for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k, depth + 1);
      return;
    }
    add(path);
  };
  for (const t of (traces || []).slice(0, limit)) walk(t, '', 0);
  return out;
}

const sample = (traces, n = 200) => (traces || []).slice(0, n).map((t) => normalizeTrace(t, null));
const share = (list, pred) => (list.length ? list.filter(pred).length / list.length : 0);

/** Suggest a view id from the shape and outputs of the traces. */
export function suggestView(traces) {
  const list = sample(traces);
  if (!list.length) return 'auto';
  const types = new Map();
  for (const n of list) if (n.output && n.output.stepId === 'out') types.set(n.output.type, (types.get(n.output.type) || 0) + 1);
  let top = null, best = 0;
  for (const [t, c] of types) if (c > best) { top = t; best = c; }
  if (top && best >= list.length / 2) {
    if (top === 'code-review' || top === 'fields' || top === 'list' || top === 'email' || top === 'answer' || top === 'document') return top;
  }
  const hasMessages = (n) => n.steps.some((s) => s.kind === 'user' || s.kind === 'assistant');
  const hasDocs = (n) => n.steps.some((s) => s.kind === 'retrieval' && Array.isArray(s.data?.documents) && s.data.documents.length);
  if (share(list, (n) => !hasMessages(n) && hasDocs(n)) >= 0.5) return 'answer';
  if (share(list, hasMessages) >= 0.5) return 'chat';
  if (share(list, (n) => n.steps.some((s) => s.id[0] === 's')) >= 0.5) return 'agent';
  return 'document';
}

/** Suggest how the AI works (a PATTERNS id) from the steps in the traces. */
export function suggestPattern(traces) {
  const list = sample(traces);
  if (!list.length) return 'single';
  const calls = (n) => n.steps.filter((s) => s.kind === 'tool_call' || s.kind === 'tool');
  const agentLike = (n) => {
    const c = calls(n);
    return c.length >= 5 && new Set(c.map((s) => s.name)).size < c.length;
  };
  const routes = (n) => n.steps.some((s) => s.kind === 'handoff' || /route|classif/i.test(s.name || ''));
  const chained = (n) => {
    const llm = new Set(n.steps.filter((s) => s.kind === 'llm').map((s) => s.name));
    return llm.size >= 2 || (llm.size >= 1 && n.steps.some((s) => s.kind === 'guardrail'));
  };
  const tools = (n) => n.steps.some((s) => s.kind === 'tool_call' || s.kind === 'tool' || s.kind === 'retrieval');
  const at = 0.25;
  if (share(list, agentLike) >= at) return 'agent';
  if (share(list, routes) >= at) return 'routing';
  if (share(list, chained) >= at) return 'chain';
  if (share(list, tools) >= at) return 'augmented';
  return 'single';
}

/** Suggest filter keys: details with 2 to 12 distinct values. */
export function suggestFilters(traces) {
  const values = new Map();
  for (const n of sample(traces, 500)) {
    for (const [k, v] of Object.entries(n.metadata)) {
      if (k === 'recording') continue;
      if (!values.has(k)) values.set(k, new Set());
      const set = values.get(k);
      if (set.size <= 12) set.add(String(v));
    }
  }
  const out = [];
  for (const [k, set] of values) if (set.size >= 2 && set.size <= 12) out.push(k);
  return out.slice(0, 6);
}
