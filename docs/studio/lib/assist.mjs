// assist.mjs: AI help with any chat assistant. Build copy-and-paste prompts
// for grouping notes and for finding more traces with a failure mode, read the
// replies into suggestions, and accept or dismiss them. The reviewer decides:
// suggestions never set a verdict.

import { hashString } from './metrics.mjs';
import { traceIndex, getNormalized, traceText } from './traces.mjs';
import { addMode, unassignedNotes } from './modes.mjs';
import { modeMap, orderedReviews } from './review.mjs';
import { isStageId, userWord } from './experience.mjs';
import { cutMiddle, jsonValues } from './judge.mjs';

const EMPTY = Object.freeze([]);
const PART_MAX = 60000;
const SCAN_TRACE_MAX = 4000;
const stamp = (opts) => opts?.now || new Date().toISOString();

// Split item lines into parts so header + items + footer stays under the limit.
function intoParts(header, items, footer) {
  const room = Math.max(2000, PART_MAX - header.length - footer.length - 120); // room for the part line
  const chunks = [];
  let cur = [], size = 0;
  for (const item of items) {
    if (cur.length && size + item.length + 1 > room) { chunks.push(cur); cur = []; size = 0; }
    cur.push(item);
    size += item.length + 1;
  }
  if (cur.length || !chunks.length) chunks.push(cur);
  return chunks.map((chunk, i) => {
    const part = chunks.length > 1 ? `Part ${i + 1} of ${chunks.length}. Each part stands on its own; answer each one separately.\n\n` : '';
    return `${part}${header}\n${chunk.join('\n')}\n\n${footer}`;
  });
}

function productLines(p) {
  const exp = p.experience || {};
  const who = userWord(exp);
  const lines = [`Product: ${exp.product || p.name || 'an AI product'}`];
  if (exp.customerGoal) lines.push(`What the ${who} is trying to do: ${exp.customerGoal}`);
  return lines;
}

/** Prompt parts for grouping notes into failure modes (or success modes) with any AI assistant. */
export function groupingPrompt(p, { kind = 'failure' } = {}) {
  const exp = p.experience || {};
  const who = userWord(exp);
  const success = kind === 'success';
  const noun = success ? 'success modes' : 'failure modes';
  const existing = (p.modes || EMPTY).filter((m) => m.kind === (success ? 'success' : 'failure'));
  const header = [
    `You are helping a product manager sort review notes into ${noun}. A ${success ? 'success' : 'failure'} mode is a named, recurring way the product ${success ? 'gets it right for' : 'lets down'} the ${who}.`,
    '',
    ...productLines(p),
    '',
    'Stages of the product (use these ids):',
    ...(exp.stages || EMPTY).map((s) => `- ${s.id}: ${s.label}`),
    '',
    existing.length ? `${noun[0].toUpperCase() + noun.slice(1)} that already exist (reuse the exact name when a note fits one):` : `No ${noun} exist yet.`,
    ...existing.map((m) => `- ${m.name}${m.stage ? ` (stage ${m.stage})` : ''}: ${m.definition || ''}`),
    '',
    'Rules:',
    `- Keep the whole list under 10 ${noun}, counting the ones that already exist.`,
    `- Name each one in the ${who}'s terms, in a few plain words.`,
    `- Start each definition with "${success ? 'Passes when' : 'Fails when'}".`,
    '- Set stage to one of the stage ids above, or null when no stage fits.',
    `- A note can support more than one ${success ? 'success' : 'failure'} mode. Leave a note out when nothing fits it.`,
    '',
    `Notes to group (trace id, stage when known, then the note):`,
  ].join('\n');
  const notes = unassignedNotes(p, success ? 'success' : 'failure')
    .filter((n) => n.hasNote)
    .map((n) => `- ${n.traceId}${n.stage ? ` (${n.stage})` : ''}: ${n.note.replace(/\s+/g, ' ')}`);
  const footer = [
    'Answer with one JSON object and nothing else:',
    `{ "modes": [ { "name": "...", "definition": "${success ? 'Passes when' : 'Fails when'} ...", "stage": "<stage id or null>", "traceIds": ["<trace id>"] } ] }`,
  ].join('\n');
  return intoParts(header, notes, footer);
}

/** Prompt parts asking an AI assistant to flag traces that show one failure mode (default: every trace not already tagged with it). */
export function scanPrompt(p, modeId, traceIds = null) {
  const mode = modeMap(p).get(modeId);
  if (!mode) return [];
  const exp = p.experience || {};
  const who = userWord(exp);
  const ids = traceIds || [...traceIndex(p).keys()].filter((id) => {
    const r = p.reviews?.[id];
    return !(r?.verdict === 'fail' && (r.modes || EMPTY).includes(modeId));
  });
  const examples = orderedReviews(p)
    .filter(({ review }) => review.verdict === 'fail' && (review.modes || EMPTY).includes(modeId) && String(review.note || '').trim())
    .slice(0, 5)
    .map(({ review }) => `- "${String(review.note).trim().replace(/\s+/g, ' ')}"`);
  const header = [
    `You are helping a product manager find more traces that show one failure mode. A trace is one full conversation or task with the product.`,
    '',
    ...productLines(p),
    '',
    'The failure mode:',
    `Id: ${mode.id}`,
    `Name: ${mode.name}`,
    `Definition: ${mode.definition || mode.name}`,
    ...(examples.length ? ['', 'Notes the reviewer wrote about traces that show it:', ...examples] : []),
    '',
    'What to do:',
    `- Read every trace below. Flag each one that shows this failure mode, even when you are not sure; the reviewer checks every flag.`,
    `- Skip traces that clearly do not show it.`,
    `- For each flag, quote the exact words from the trace that show it, from the ${who}'s side where possible, and give a one-sentence reason.`,
    '',
    'Traces:',
  ].join('\n');
  const opts = { include: ['customer', 'tools', 'retrieval', 'metadata', 'context'], filters: exp.filters || EMPTY, userLabel: who };
  const items = ids.map((id) => {
    const n = getNormalized(p, id);
    return n ? `<trace id="${id}">\n${cutMiddle(traceText(n, opts), SCAN_TRACE_MAX)}\n</trace>` : null;
  }).filter(Boolean);
  const footer = [
    'Answer with one JSON object and nothing else:',
    `{ "modeId": "${mode.id}", "flags": [ { "traceId": "<trace id>", "quote": "<exact words>", "reason": "<one sentence>" } ] }`,
  ].join('\n');
  return intoParts(header, items, footer);
}

/** Suggestion id for a pasted reply: sg-p-<hash of kind + traceId + (modeId or name)>. */
export function pastedId(kind, traceId, modeIdOrName) {
  return `sg-p-${hashString(`${kind}${traceId ?? ''}${modeIdOrName ?? ''}`)}`;
}

/** Read an assistant's reply into suggestions: { suggestions, errors }. kind is 'mode' or 'flag'. */
export function parseAssistResponse(text, { kind = 'mode', modeId = null, modeKind = 'failure', now } = {}) {
  const t = now || new Date().toISOString();
  const errors = [];
  const found = jsonValues(text).filter((o) => o && typeof o === 'object' && (Array.isArray(o.modes) || Array.isArray(o.flags)));
  if (!found.length) return { suggestions: [], errors: ['The reply has no answer we can read. Paste the whole reply, including the part in curly brackets.'] };
  const out = new Map();
  if (kind === 'mode') {
    for (const o of found) {
      (o.modes || EMPTY).forEach((m, i) => {
        const name = String(m?.name ?? '').trim();
        if (!name) { errors.push(`Suggested mode ${i + 1} has no name.`); return; }
        const id = pastedId('mode', '', name);
        const traceIds = (Array.isArray(m.traceIds) ? m.traceIds : []).map(String);
        const prev = out.get(id);
        if (prev) { prev.traceIds = [...new Set([...prev.traceIds, ...traceIds])]; return; }
        out.set(id, {
          id, kind: 'mode', status: 'open', from: 'paste', createdAt: t,
          mode: { name, definition: String(m.definition ?? ''), stage: m.stage ?? null, kind: modeKind === 'success' ? 'success' : 'failure' },
          traceIds, reason: String(m.reason ?? ''),
        });
      });
    }
  } else {
    for (const o of found) {
      const mid = modeId || o.modeId;
      if (!mid) { errors.push('The reply does not say which failure mode it is about.'); continue; }
      (o.flags || EMPTY).forEach((f, i) => {
        const traceId = f?.traceId ?? f?.trace_id;
        if (traceId == null || traceId === '') { errors.push(`Flag ${i + 1} has no trace id.`); return; }
        const id = pastedId('flag', String(traceId), mid);
        out.set(id, { id, kind: 'flag', status: 'open', from: 'paste', createdAt: t, traceId: String(traceId), modeId: mid, quote: String(f.quote ?? ''), reason: String(f.reason ?? ''), reviewed: false });
      });
    }
  }
  return { suggestions: [...out.values()], errors };
}

/**
 * Add suggestions with new ids only. Existing ids keep their status; an open mode
 * suggestion with the same id gains the new trace ids. Flags on missing traces, or on
 * traces already tagged with the mode, are skipped.
 */
export function mergeSuggestions(p, suggestions = [], opts = {}) {
  const list = (p.suggestions || EMPTY).slice();
  const at = new Map(list.map((s, i) => [s.id, i]));
  const traces = traceIndex(p);
  let changed = false;
  for (const s of suggestions) {
    if (!s?.id) continue;
    if (at.has(s.id)) {
      const cur = list[at.get(s.id)];
      if (cur.kind === 'mode' && cur.status === 'open' && s.kind === 'mode') {
        const ids = [...new Set([...(cur.traceIds || EMPTY), ...(s.traceIds || EMPTY)])];
        if (ids.length !== (cur.traceIds || EMPTY).length) { list[at.get(s.id)] = { ...cur, traceIds: ids }; changed = true; }
      }
      continue;
    }
    let next = s;
    if (s.kind === 'flag' || s.kind === 'assign') {
      if (traces.size && !traces.has(s.traceId)) continue;
      const r = p.reviews?.[s.traceId];
      if (r?.verdict === 'fail' && (r.modes || EMPTY).includes(s.modeId)) continue;
      next = { ...s, reviewed: !!r?.verdict };
    }
    at.set(next.id, list.length);
    list.push(next);
    changed = true;
  }
  return changed ? { ...p, suggestions: list, updatedAt: stamp(opts) } : p;
}

const setStatus = (p, id, status, t) => ({ ...p, suggestions: p.suggestions.map((s) => (s.id === id ? { ...s, status } : s)), updatedAt: t });

// Add a mode to a review with structural sharing.
function tagReview(p, traceId, modeId, field, t) {
  const r = p.reviews[traceId];
  if ((r[field] || EMPTY).includes(modeId)) return p;
  return { ...p, reviews: { ...p.reviews, [traceId]: { ...r, [field]: [...(r[field] || EMPTY), modeId], at: t } }, updatedAt: t };
}

/**
 * Accept a suggestion: { project, openTraceId }. Mode: create it and tag Problem reviews among
 * its traces (opts.traceIds keeps only the ticked ones); unreviewed traces become open flags.
 * Assign or flag: tag a Problem review; on a Good or unreviewed trace, return openTraceId and
 * keep the suggestion open. Batch: set the next set.
 */
export function acceptSuggestion(p, id, opts = {}) {
  const s = (p.suggestions || EMPTY).find((x) => x.id === id);
  if (!s || s.status !== 'open') return { project: p, openTraceId: null };
  const t = stamp(opts);
  if (s.kind === 'mode') {
    const kind = s.mode?.kind === 'success' ? 'success' : 'failure';
    const stage = isStageId(p.experience, s.mode?.stage) ? s.mode.stage : null;
    const made = addMode(p, { kind, name: s.mode?.name, definition: s.mode?.definition || '', stage, source: 'ai' }, { now: t });
    let q = made.project;
    const flags = [];
    for (const traceId of opts.traceIds || s.traceIds || EMPTY) {
      const r = q.reviews?.[traceId];
      if (kind === 'failure' && r?.verdict === 'fail') q = tagReview(q, traceId, made.id, 'modes', t);
      else if (kind === 'success' && r?.verdict === 'pass') q = tagReview(q, traceId, made.id, 'successModes', t);
      else if (!r?.verdict && kind === 'failure') {
        flags.push({ id: pastedId('flag', traceId, made.id), kind: 'flag', status: 'open', from: s.from, createdAt: t, traceId, modeId: made.id, quote: '', reason: s.reason || `Suggested with the new failure mode "${made.project.modes.find((m) => m.id === made.id).name}".`, reviewed: false });
      }
    }
    q = setStatus(q, id, 'accepted', t);
    const known = new Set(q.suggestions.map((x) => x.id));
    const fresh = flags.filter((f) => !known.has(f.id));
    if (fresh.length) q = { ...q, suggestions: [...q.suggestions, ...fresh] };
    return { project: q, openTraceId: null };
  }
  if (s.kind === 'assign' || s.kind === 'flag') {
    const r = p.reviews?.[s.traceId];
    if (r?.verdict === 'fail' && modeMap(p).has(s.modeId)) {
      const q = tagReview(p, s.traceId, s.modeId, 'modes', t);
      return { project: setStatus(q, id, 'accepted', t), openTraceId: null };
    }
    return { project: p, openTraceId: s.traceId };
  }
  if (s.kind === 'batch') {
    const q = { ...p, batch: { createdAt: t, strategy: 'suggested', items: (s.items || EMPTY).map(({ traceId, reason }) => ({ traceId, reason: reason ?? '' })) } };
    return { project: setStatus(q, id, 'accepted', t), openTraceId: null };
  }
  return { project: p, openTraceId: null };
}

/** Dismiss a suggestion. */
export function dismissSuggestion(p, id, opts = {}) {
  const s = (p.suggestions || EMPTY).find((x) => x.id === id);
  if (!s || s.status === 'dismissed') return p;
  return setStatus(p, id, 'dismissed', stamp(opts));
}

/** Open suggestions that mention a trace (flags, assigns, and suggested modes that include it). */
export function openSuggestionsFor(p, traceId) {
  return (p.suggestions || EMPTY).filter((s) => s.status === 'open' && (
    ((s.kind === 'flag' || s.kind === 'assign') && s.traceId === traceId)
    || (s.kind === 'mode' && (s.traceIds || EMPTY).includes(traceId))
  ));
}
