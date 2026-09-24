#!/usr/bin/env node
// check-samples.mjs: keeps the sample projects in docs/studio/samples/ consistent with the engine.
//
// For every sample it:
//   1. fills a missing reviewedAt on reviewed traces from the review's last edit;
//   2. fills the examples / tuning set / final test splits with assignSplits (seed 7) for every
//      failure mode that has labels (sample authors never write splits by hand);
//   3. writes the generated prompt into judge drafts (no results, no runs, not edited by hand),
//      and reports judges whose stored prompt no longer matches the generated one;
//   4. validates the project with validateProject and checks that every id it mentions exists;
//   5. rebuilds samples/index.json, with every number computed by the engine.
//
// Usage:
//   node scripts/check-samples.mjs           write any changes
//   node scripts/check-samples.mjs --check   write nothing; exit 1 when a file would change
// Exit codes: 0 ok, 1 a sample has problems (or would change with --check), 2 usage errors.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../docs/studio/lib/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'studio', 'samples');
const SEED = 7;

// The order and one-line descriptions of the sample cards (Welcome and the landing page).
const SAMPLES = [
  ['clinic-booking', 'Books, moves, and cancels dental appointments by text message, web chat, and phone.'],
  ['sales-email', 'Writes a first outreach email to each sales prospect from a brief and account notes.'],
  ['policy-answers', 'Answers employee questions about benefits and workplace policy, citing its sources.'],
  ['gift-finder', 'Suggests kitchen gifts from an online store, sorted by fit and within the budget.'],
  ['code-review', 'Reviews pull requests for a small platform team: reads the change, runs tests, comments.'],
  ['support-agent', 'Explains bills, gives credits, changes plans, and books technicians with account tools.'],
];

const VERDICTS = new Set(['pass', 'fail', 'skip']);
const SPLIT_NAMES = new Set(['examples', 'tuning', 'test']);
const EMPTY = Object.freeze([]);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const toJson = (value) => JSON.stringify(value, null, 2) + '\n';

/** A judge check that has never run: its prompt can follow the generated one. */
const isDraft = (c) => !Object.keys(c.results || {}).length && !(c.runs || EMPTY).length && !c.test;

/** Fill the parts of a sample that check-samples owns. Returns { project, notes, problems }. */
function fillSample(p) {
  const now = p.updatedAt;
  const notes = [];
  const problems = [];

  // 1. reviewedAt: set once by the first verdict. A sample written without it gets the last edit time.
  let reviews = p.reviews || {};
  for (const [traceId, r] of Object.entries(reviews)) {
    if (!isObj(r) || !VERDICTS.has(r.verdict) || r.reviewedAt) continue;
    reviews = { ...reviews, [traceId]: { ...r, reviewedAt: r.at || now } };
    notes.push(`filled reviewedAt on ${traceId}`);
  }
  if (reviews !== p.reviews) p = { ...p, reviews };

  // 2. Splits for every failure mode with at least one label, seeded so reruns change nothing.
  if (p.settings?.seed == null) p = { ...p, settings: { ...p.settings, seed: SEED } };
  for (const mode of p.modes || EMPTY) {
    if (mode.kind !== 'failure' || !lib.labeledSet(p, mode.id).length) continue;
    const next = lib.assignSplits(p, mode.id, { seed: SEED }, { now });
    if (next !== p) notes.push(`filled splits for ${mode.id}`);
    p = next;
  }

  // 3. Judge prompts that were never edited by hand must equal the generated prompt.
  for (const check of p.checks || EMPTY) {
    if (check.type !== 'judge' || check.promptEdited) continue;
    const generated = lib.buildJudgePrompt(p, check.modeId, { inputs: check.inputs });
    if (check.prompt === generated) continue;
    if (isDraft(check)) {
      p = lib.updateCheck(p, check.id, { prompt: generated }, { now });
      notes.push(`wrote the generated prompt into ${check.id}`);
    } else {
      problems.push(`Judge ${check.id} has results, but its stored prompt differs from the generated prompt. Re-run the judge or mark the prompt as edited.`);
    }
  }
  return { project: p, notes, problems };
}

/** Does a picked step id exist in the normalized trace? (list cards are <output step>.i<n>) */
function stepExists(n, stepId) {
  if (n.steps.some((s) => s.id === stepId)) return true;
  const card = /^(.+)\.i(\d+)$/.exec(stepId);
  if (card && n.output?.stepId === card[1] && Array.isArray(n.output.items)) return Number(card[2]) < n.output.items.length;
  return false;
}

/** Every id a sample mentions must exist. Returns plain problem sentences. */
function crossReferences(p, fileId) {
  const out = [];
  const say = (m) => out.push(m);
  if (p.id !== fileId) say(`The project id "${p.id}" does not match the file name ${fileId}.json.`);
  if (p.sample !== true) say('A sample project needs "sample": true.');

  const traceIds = new Set();
  for (const t of p.traces || EMPTY) {
    if (traceIds.has(String(t.id))) say(`Trace id "${t.id}" is used twice.`);
    traceIds.add(String(t.id));
  }
  const hasTrace = (id) => traceIds.has(id);
  const modes = new Map((p.modes || EMPTY).map((m) => [m.id, m]));
  const kindOf = (id) => modes.get(id)?.kind ?? null;
  const normalized = lib.normalizeAll(p);

  // Reviews: mode kinds, picked steps, and review times.
  for (const [traceId, r] of Object.entries(p.reviews || {})) {
    for (const id of r.modes || EMPTY) {
      if (modes.has(id) && kindOf(id) === 'success') say(`Review for "${traceId}" lists success mode "${id}" under modes; it belongs in successModes.`);
    }
    for (const id of r.successModes || EMPTY) {
      if (modes.has(id) && kindOf(id) !== 'success') say(`Review for "${traceId}" lists "${id}" under successModes, but it is not a success mode.`);
    }
    const n = normalized.get(traceId);
    if (n && r.step != null && !stepExists(n, r.step)) say(`Review for "${traceId}" picks step "${r.step}", which the trace does not have.`);
    if (VERDICTS.has(r.verdict) && !r.reviewedAt) say(`Review for "${traceId}" has a verdict but no reviewedAt.`);
    if (r.reviewedAt && r.at && lib.ms(r.at) < lib.ms(r.reviewedAt)) say(`Review for "${traceId}" was last edited before it was first reviewed.`);
  }

  // Critiques and close calls: failure modes and existing traces only.
  for (const key of ['critiques', 'closeCalls']) {
    for (const [modeId, value] of Object.entries(p[key] || {})) {
      if (kindOf(modeId) !== 'failure') say(`${key} for "${modeId}" point to a failure mode that does not exist.`);
      const ids = Array.isArray(value) ? value : Object.keys(value || {});
      for (const id of ids) if (!hasTrace(id)) say(`${key} for "${modeId}" mention trace "${id}", which does not exist.`);
    }
  }

  // Checks: unique ids; judge results only on existing traces.
  const checkIds = new Set();
  for (const c of p.checks || EMPTY) {
    if (checkIds.has(c.id)) say(`Check id "${c.id}" is used twice.`);
    checkIds.add(c.id);
    for (const id of Object.keys(c.results || {})) if (!hasTrace(id)) say(`Check "${c.id}" has a result for trace "${id}", which does not exist.`);
    for (const id of c.unreadable || EMPTY) if (!hasTrace(id)) say(`Check "${c.id}" lists unreadable trace "${id}", which does not exist.`);
  }

  // Splits: every assigned trace exists, has a label, and sits in a known split.
  for (const [modeId, s] of Object.entries(p.splits || {})) {
    for (const [id, split] of Object.entries(s?.assign || {})) {
      if (!hasTrace(id)) say(`Splits for "${modeId}" place trace "${id}", which does not exist.`);
      else if (!lib.humanLabel(p, id, modeId)) say(`Splits for "${modeId}" place trace "${id}", which has no label.`);
      if (!SPLIT_NAMES.has(split)) say(`Splits for "${modeId}" use an unknown split "${split}".`);
    }
  }

  // Suggestions and the current set.
  const suggestionIds = new Set();
  for (const s of p.suggestions || EMPTY) {
    if (suggestionIds.has(s.id)) say(`Suggestion id "${s.id}" is used twice.`);
    suggestionIds.add(s.id);
    if (s.traceId != null && !hasTrace(s.traceId)) say(`Suggestion "${s.id}" points to trace "${s.traceId}", which does not exist.`);
    if (s.modeId != null && !modes.has(s.modeId)) say(`Suggestion "${s.id}" points to mode "${s.modeId}", which does not exist.`);
    for (const id of s.traceIds || EMPTY) if (!hasTrace(id)) say(`Suggestion "${s.id}" lists trace "${id}", which does not exist.`);
    for (const it of s.items || EMPTY) if (!hasTrace(it.traceId)) say(`Suggestion "${s.id}" lists trace "${it.traceId}", which does not exist.`);
  }
  const inSet = new Set();
  for (const it of p.batch?.items || EMPTY) {
    if (!hasTrace(it.traceId)) say(`The current set lists trace "${it.traceId}", which does not exist.`);
    if (inSet.has(it.traceId)) say(`The current set lists trace "${it.traceId}" twice.`);
    inSet.add(it.traceId);
  }

  // Product setup: stage rules name tools the traces use, and every stage with rules is reached.
  const exp = p.experience || {};
  const toolNames = new Set();
  const reached = new Map();
  const metaKeys = new Set();
  for (const n of normalized.values()) {
    const seen = new Set();
    for (const step of n.steps) {
      if (step.name) toolNames.add(step.name);
      if (step.stage) seen.add(step.stage);
    }
    for (const id of seen) reached.set(id, (reached.get(id) || 0) + 1);
    for (const k of Object.keys(n.metadata || {})) metaKeys.add(k);
  }
  for (const stage of exp.stages || EMPTY) {
    for (const tool of stage.match?.tools || EMPTY) {
      if (!toolNames.has(tool)) say(`Stage "${stage.id}" matches tool "${tool}", which no trace uses.`);
    }
    const hasRules = isObj(stage.match) && Object.keys(stage.match).length > 0;
    if (hasRules && !reached.get(stage.id)) say(`Stage "${stage.id}" has match rules, but no step in any trace reaches it.`);
  }
  for (const key of exp.filters || EMPTY) if (!metaKeys.has(key)) say(`Filter "${key}" is not a detail on any trace.`);
  if (exp.rendererBy?.key && !metaKeys.has(exp.rendererBy.key)) say(`rendererBy uses detail "${exp.rendererBy.key}", which no trace has.`);
  return out;
}

/** One samples/index.json row. reviewed = Good + Problem (reviewStats), as the tab badges show. */
function indexRow(p, id, description) {
  return {
    id,
    name: p.name,
    view: p.experience.renderer,
    pattern: p.experience.pattern,
    userLabel: lib.userWord(p.experience),
    traceCount: p.traces.length,
    reviewed: lib.reviewStats(p).reviewed,
    description,
  };
}

function main(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error(`Unknown option: ${unknown.join(' ')}\nUsage: node scripts/check-samples.mjs [--check]`);
    return 2;
  }
  const checkOnly = args.includes('--check');
  const listed = new Set(SAMPLES.map(([id]) => id));
  let failed = false;
  const stale = [];
  const writes = [];
  const index = [];

  for (const file of readdirSync(DIR)) {
    if (file.endsWith('.json') && file !== 'index.json' && !listed.has(file.slice(0, -5))) {
      console.error(`${file}: not listed in scripts/check-samples.mjs, so it has no sample card.`);
      failed = true;
    }
  }

  for (const [id, description] of SAMPLES) {
    const file = path.join(DIR, `${id}.json`);
    let text;
    try { text = readFileSync(file, 'utf8'); } catch {
      console.error(`${id}: ${path.relative(ROOT, file)} is missing.`);
      failed = true;
      continue;
    }
    const { project, notes, problems } = fillSample(JSON.parse(text));
    const valid = lib.validateProject(project);
    const all = [...valid.errors, ...problems, ...crossReferences(project, id)];
    for (const m of all) console.error(`${id}: ${m}`);
    if (all.length) failed = true;
    const next = toJson(project);
    if (next !== text) {
      stale.push(`${id}.json (${notes.join('; ') || 'formatting'})`);
      writes.push([file, next]);
    }
    index.push(indexRow(project, id, description));
  }

  const indexFile = path.join(DIR, 'index.json');
  const indexText = toJson(index);
  let current = '';
  try { current = readFileSync(indexFile, 'utf8'); } catch { /* written below */ }
  if (current !== indexText) {
    stale.push('index.json');
    writes.push([indexFile, indexText]);
  }

  if (checkOnly) {
    if (stale.length) {
      console.error(`These sample files are out of date. Run node scripts/check-samples.mjs to update them:\n  ${stale.join('\n  ')}`);
      return 1;
    }
  } else {
    for (const [file, content] of writes) writeFileSync(file, content);
    for (const s of stale) console.log(`Updated ${s}`);
  }
  if (failed) return 1;
  console.log(`${SAMPLES.length} samples checked: ${index.map((r) => `${r.id} ${r.reviewed} of ${r.traceCount} reviewed`).join(', ')}.`);
  return 0;
}

process.exitCode = main(process.argv);
