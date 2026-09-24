// checks.mjs: code checks (rules a computer can test) and AI judge bookkeeping:
// run code checks, measure agreement with your labels, the final-test lock,
// agreement by round, and the likely true failure rate. Tool call checks (a policy,
// an intent map, and the two output grounding rules) run here as code checks.

import { agreement, bootstrapCorrected, asFailureRate } from './metrics.mjs';
import { getNormalized, getPath, normalizeAll, outputText, traceText, TEXT_PARTS } from './traces.mjs';
import { humanLabel, labeledSet, labelsHash, splitOf, assignSplits } from './labels.mjs';
import { promptHash, definitionHash, parseJudgeOutput, JUDGE_TEMPLATES } from './judge.mjs';
import { modeMap } from './review.mjs';
import { slugId } from './schema.mjs';
import { userWord } from './experience.mjs';
import {
  evaluatePolicy, evaluateRelevance, groundedValues, successAfterError, validatePolicy, validateIntents, projectPolicy,
  RELEVANCE_LABELS,
} from './toolcalls.mjs';

const EMPTY = Object.freeze([]);
const stamp = (opts) => opts?.now || new Date().toISOString();
const MAX_TEXT = 100000;

/** Code check operators. `needs` says which fields the editor asks for: pattern, text, list, number, tool, field. */
export const OPERATORS = [
  { id: 'regex', label: 'Text matches a pattern', needs: 'pattern' },
  { id: 'contains', label: 'Text contains', needs: 'text' },
  { id: 'contains-any', label: 'Text contains any of (comma-separated)', needs: 'list' },
  { id: 'not-contains', label: 'Text does not contain', needs: 'text' },
  { id: 'max-chars', label: 'Longer than N characters', needs: 'number' },
  { id: 'min-chars', label: 'Shorter than N characters', needs: 'number' },
  { id: 'json-valid', label: 'Is valid structured data', needs: null },
  { id: 'tool-called', label: 'Uses a tool', needs: 'tool' },
  { id: 'tool-not-called', label: 'Never uses a tool', needs: 'tool' },
  { id: 'tool-count-max', label: 'Uses a tool more than N times', needs: 'tool+number' },
  { id: 'field-equals', label: 'A field equals', needs: 'field+text' },
  { id: 'field-exists', label: 'A field is present', needs: 'field' },
  { id: 'grounded-values', label: 'Every number in the reply comes from a tool', needs: null, group: 'tool-calls' },
  { id: 'success-after-error', label: 'Claims success after a failed or pending call', needs: null, group: 'tool-calls' },
];

const CODE_TYPES = new Set(['code', 'policy', 'relevance']);

/** True for checks a computer runs without a model: code checks, policy checks, and relevance checks. */
export function isCodeCheck(check) {
  return CODE_TYPES.has(check?.type);
}

/** Plain name of a check's type: "Code check", "Code check: policy rules", "Code check: intent map", or "AI judge". */
export function checkTypeLabel(check) {
  if (check?.type === 'judge') return 'AI judge';
  if (check?.type === 'policy') return 'Code check: policy rules';
  if (check?.type === 'relevance') return 'Code check: intent map';
  return 'Code check';
}

/**
 * True for a code check with no rule yet: its operator needs a value (a pattern, words, a number,
 * a field) and it is empty. A new check starts this way. Drafts measure nothing, are skipped by
 * runChecks, and stay out of the report's check list and its downloads.
 */
export function isDraftCheck(check) {
  if (check?.type !== 'code') return false;
  const rule = check.rule || {};
  const op = OPERATORS.find((o) => o.id === rule.op);
  if (!op || !op.needs) return false;
  const empty = (v) => String(v ?? '').trim() === '';
  const path = String(rule.target || '').startsWith('field:') ? String(rule.target).slice(6) : rule.path;
  switch (op.needs) {
    case 'pattern': case 'text': case 'list': return empty(rule.value);
    case 'number': return empty(rule.n ?? rule.value) || !Number.isFinite(numberOf(rule));
    case 'tool+number': return empty(rule.n) || !Number.isFinite(Number(rule.n));
    case 'field': return empty(path);
    case 'field+text': return empty(path) || empty(rule.value);
    default: return false;
  }
}

/** What runCheck needs from the project: { userLabel, policy } (the policy of the first policy check, for success-after-error). */
export function checkOptions(p) {
  return { userLabel: userWord(p?.experience), policy: projectPolicy(p) };
}

/** Ready-made patterns for the regex operator. */
export const COMMON_PATTERNS = [
  { id: 'formatting', label: 'Formatting symbols', value: '(\\*\\*|__|^#{1,6} |^\\s*[-*] |\\[[^\\]]+\\]\\([^)]+\\)|`)', flags: 'm' },
  { id: 'email', label: 'Email address', value: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', flags: '' },
  { id: 'phone', label: 'Phone number', value: '(\\+?\\d{1,2}[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}', flags: '' },
  { id: 'link', label: 'Link', value: 'https?://\\S+|www\\.\\S+', flags: 'i' },
  { id: 'dollar', label: 'Dollar amount', value: '\\$\\s?\\d[\\d,]*(\\.\\d{2})?', flags: '' },
];

/** What a code check reads. The stored target for a field is 'field:<path>'. */
export const TARGETS = [
  { id: 'output', label: 'The final reply' },
  { id: 'assistant', label: 'Everything the AI said' },
  { id: 'last-assistant', label: "The AI's last message" },
  { id: 'user', label: 'What the {userLabel} said' },
  { id: 'all', label: 'The whole trace' },
  { id: 'field', label: 'A specific field', prefix: 'field:' },
];

const cut = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);
const lower = (s) => String(s ?? '').toLowerCase();
const show = (s, n = 60) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
};

/** Read a path from the raw trace first, then from the normalized trace. */
export function fieldValue(normalized, path) {
  const v = getPath(normalized?.raw, path);
  return v !== undefined ? v : getPath(normalized, path);
}

/** The text a check target reads from a normalized trace (capped at 100,000 characters). */
export function targetText(normalized, target = 'output') {
  const n = normalized;
  if (!n) return '';
  const steps = n.steps || EMPTY;
  const out = n.output && n.output.stepId === 'out' ? outputText(n.output) : '';
  let text;
  if (typeof target === 'string' && target.startsWith('field:')) {
    const v = fieldValue(n, target.slice(6));
    text = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  } else if (target === 'assistant') {
    text = [...steps.filter((s) => s.kind === 'assistant').map((s) => s.text), out].filter(Boolean).join('\n\n');
  } else if (target === 'last-assistant') {
    const said = steps.filter((s) => s.kind === 'assistant');
    text = said.length ? said[said.length - 1].text : out;
  } else if (target === 'user') {
    const said = steps.filter((s) => s.kind === 'user').map((s) => s.text);
    text = said.length ? said.join('\n\n') : n.input || '';
  } else if (target === 'all') {
    text = traceText(n, { include: TEXT_PARTS, filters: Object.keys(n.metadata) });
  } else {
    text = n.output ? outputText(n.output) : '';
  }
  return cut(String(text ?? ''));
}

const REGEX_CACHE = new Map();
function compileRegex(value, flags) {
  const key = `${flags || ''}/${value}`;
  if (REGEX_CACHE.has(key)) return REGEX_CACHE.get(key);
  const clean = String(flags || '').replace(/[^dgimsuy]/g, '').replace('g', '').replace('y', '');
  let out;
  try { out = { re: new RegExp(String(value ?? ''), clean) }; } catch (e) { out = { error: e.message }; }
  if (REGEX_CACHE.size > 500) REGEX_CACHE.clear();
  REGEX_CACHE.set(key, out);
  return out;
}

const toolCalls = (n, name) => (n.steps || EMPTY).filter((s) => (s.kind === 'tool_call' || s.kind === 'tool') && (!name || s.name === name));
const numberOf = (rule) => Number(rule.n ?? rule.value);

// Evaluate the operator: { matched, detail, extra } or { error }.
function evaluate(rule, n, opts) {
  const op = rule?.op;
  const target = rule?.target || 'output';
  const value = rule?.value ?? '';
  switch (op) {
    case 'regex': {
      const c = compileRegex(value, rule.flags);
      if (c.error) return { error: `The pattern is not valid: ${c.error}` };
      const m = c.re.exec(targetText(n, target));
      return m ? { matched: true, detail: `Found "${show(m[0])}"` } : { matched: false, detail: 'No match' };
    }
    case 'contains': case 'not-contains': {
      const needle = lower(value).trim();
      if (!needle) return { error: 'Add the text to look for.' };
      const has = lower(targetText(n, target)).includes(needle);
      if (op === 'contains') return { matched: has, detail: has ? `Found "${show(value)}"` : 'Not found' };
      return { matched: !has, detail: has ? `Contains "${show(value)}"` : `Does not contain "${show(value)}"` };
    }
    case 'contains-any': {
      const words = String(value).split(',').map((w) => w.trim()).filter(Boolean);
      if (!words.length) return { error: 'Add at least one word or phrase.' };
      const hay = lower(targetText(n, target));
      const hit = words.find((w) => hay.includes(w.toLowerCase()));
      return hit ? { matched: true, detail: `Found "${show(hit)}"` } : { matched: false, detail: 'None found' };
    }
    case 'max-chars': case 'min-chars': {
      const limit = numberOf(rule);
      if (!Number.isFinite(limit)) return { error: 'Add a number of characters.' };
      const len = targetText(n, target).length;
      return { matched: op === 'max-chars' ? len > limit : len < limit, detail: `${len} characters` };
    }
    case 'json-valid': {
      const t = targetText(n, target).trim();
      try { JSON.parse(t); return { matched: t !== '', detail: t ? 'Valid structured data' : 'Empty' }; } catch { return { matched: false, detail: 'Not valid structured data' }; }
    }
    case 'tool-called': case 'tool-not-called': {
      const count = toolCalls(n, String(value).trim()).length;
      const name = String(value).trim() || 'any tool';
      const detail = count ? `Used ${name} ${count === 1 ? 'once' : count + ' times'}` : `Never used ${name}`;
      return { matched: op === 'tool-called' ? count > 0 : count === 0, detail };
    }
    case 'tool-count-max': {
      const limit = Number(rule.n);
      if (!Number.isFinite(limit)) return { error: 'Add the most times the tool may be used.' };
      const count = toolCalls(n, String(value).trim()).length;
      return { matched: count > limit, detail: `Used ${String(value).trim() || 'tools'} ${count} times` };
    }
    case 'field-equals': case 'field-exists': {
      const path = String(target).startsWith('field:') ? String(target).slice(6) : rule.path;
      if (!path) return { error: 'Pick a field.' };
      const v = fieldValue(n, path);
      const present = v !== undefined && v !== null && v !== '';
      if (op === 'field-exists') return { matched: present, detail: present ? `${path} is present` : `${path} is missing` };
      const shown = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      return { matched: present && shown.trim() === String(value).trim(), detail: present ? `${path} is "${show(shown)}"` : `${path} is missing` };
    }
    case 'grounded-values': {
      const g = groundedValues(n, { text: rule.target ? targetText(n, target) : undefined });
      return { matched: g.verdict === 'fail', detail: g.detail, extra: { ungrounded: g.ungrounded } };
    }
    case 'success-after-error': {
      const s = successAfterError(n, opts.policy || null, { text: rule.target ? targetText(n, target) : undefined });
      return { matched: s.verdict === 'fail', detail: s.detail };
    }
    default:
      return { error: 'This check has an unknown rule.' };
  }
}

// Validation results per policy or intent map object, so a run over many traces validates once.
const VALID = new WeakMap();
function validated(obj, validate) {
  let v = VALID.get(obj);
  if (!v) { v = validate(obj); VALID.set(obj, v); }
  return v;
}

function runPolicyCheck(check, n, opts) {
  if (!check.policy || typeof check.policy !== 'object') return { verdict: 'error', detail: 'Add a policy to this check first.', violations: [] };
  const v = validated(check.policy, validatePolicy);
  if (!v.ok) return { verdict: 'error', detail: `The policy has a problem: ${v.errors[0]}`, violations: [] };
  const r = evaluatePolicy(check.policy, n, { userLabel: opts.userLabel, ruleIds: check.ruleIds });
  if (!r.violations.length) return { verdict: 'pass', detail: 'Follows the policy', violations: r.violations };
  const first = r.violations[0];
  const more = r.violations.length > 1 ? ` (and ${r.violations.length - 1} more)` : '';
  return { verdict: 'fail', detail: `${first.label}: ${first.fact}${more}`, violations: r.violations };
}

function runRelevanceCheck(check, n) {
  if (!check.intents || typeof check.intents !== 'object') return { verdict: 'error', detail: 'Add an intent map to this check first.', relevance: null };
  const v = validated(check.intents, validateIntents);
  if (!v.ok) return { verdict: 'error', detail: `The intent map has a problem: ${v.errors[0]}`, relevance: null };
  const r = evaluateRelevance(check.intents, n);
  return { verdict: r.verdict, detail: r.detail, relevance: r };
}

/**
 * Run one code check, policy check, or relevance check on a normalized trace:
 * { verdict: 'pass' | 'fail' | 'error', detail }, plus `violations` for policy checks,
 * `relevance` (the evaluateRelevance result) for relevance checks, and `ungrounded` for
 * grounded-values. opts: checkOptions(project), for the user word and the policy.
 */
export function runCheck(check, normalized, opts = {}) {
  const n = normalized || { steps: [] };
  const when = check?.when;
  if (when && when.path) {
    const v = fieldValue(n, when.path);
    if (String(v ?? '') !== String(when.equals ?? '')) {
      const skip = { verdict: 'pass', detail: 'Does not apply' };
      if (check.type === 'policy') return { ...skip, violations: [] };
      if (check.type === 'relevance') return { ...skip, relevance: null };
      return skip;
    }
  }
  if (check?.type === 'policy') return runPolicyCheck(check, n, opts);
  if (check?.type === 'relevance') return runRelevanceCheck(check, n);
  const r = evaluate(check?.rule || {}, n, opts);
  if (r.error) return { verdict: 'error', detail: r.error };
  const failOnMatch = (check?.failWhen || 'match') !== 'no-match';
  return { verdict: r.matched === failOnMatch ? 'fail' : 'pass', detail: r.detail, ...(r.extra || {}) };
}

/**
 * Run code checks (including policy and relevance checks) over traces. passAll = traces that
 * pass every included check. Returns { byCheck: { [checkId]: { [traceId]: verdict } }, summary, passAll, total }.
 */
export function runChecks(p, { onlyCi = false, traceIds = null, checkIds = null } = {}) {
  const checks = (p.checks || EMPTY).filter((c) => isCodeCheck(c) && !isDraftCheck(c) && (!onlyCi || c.ci) && (!checkIds || checkIds.includes(c.id)));
  const norm = normalizeAll(p);
  const opts = checkOptions(p);
  const ids = traceIds || [...norm.keys()];
  const byCheck = {};
  const summary = [];
  const failing = new Set();
  for (const c of checks) {
    const verdicts = {};
    let pass = 0, fail = 0, error = 0;
    for (const id of ids) {
      const n = norm.get(String(id));
      if (!n) continue;
      const v = runCheck(c, n, opts).verdict;
      verdicts[id] = v;
      if (v === 'pass') pass++;
      else { if (v === 'fail') fail++; else error++; failing.add(id); }
    }
    byCheck[c.id] = verdicts;
    summary.push({ checkId: c.id, pass, fail, error });
  }
  const total = ids.filter((id) => norm.has(String(id))).length;
  return { byCheck, summary, passAll: total - failing.size, total };
}

/** Judge result verdict for a trace: 'pass' | 'fail' | null (missing or unreadable). */
function judgeVerdict(check, traceId) {
  const r = check.results?.[traceId];
  if (!r) return null;
  return r.verdict === 'pass' || r.verdict === 'fail' ? r.verdict : null;
}

/**
 * Agreement between a check and your labels. Code checks (policy and relevance checks too) use
 * every labeled trace. Judge checks use the tuning set (default) or the final test once it is
 * revealed; never examples. Labels without a split yet are placed the way assignSplits will place
 * them, so every view shows the same numbers before the Checks tab saves the new splits.
 */
export function checkAgreement(project, checkId, { split = 'tuning' } = {}) {
  const check = (project.checks || EMPTY).find((c) => c.id === checkId);
  const empty = { ...agreement([]), split: null, unreadable: [], errors: [], missing: 0, locked: false };
  if (!check || isDraftCheck(check)) return empty;
  const p = check.type === 'judge' ? assignSplits(project, check.modeId) : project;
  const modeId = check.modeId;
  const pairs = [];
  const unreadable = [];
  const errors = [];
  let missing = 0;
  if (isCodeCheck(check)) {
    const opts = checkOptions(p);
    for (const { traceId, label } of labeledSet(p, modeId)) {
      const n = getNormalized(p, traceId);
      if (!n) continue;
      const v = runCheck(check, n, opts).verdict;
      if (v === 'error') errors.push(traceId);
      else pairs.push({ traceId, human: label, check: v });
    }
    return { ...agreement(pairs), split: null, unreadable, errors, missing, locked: false };
  }
  const which = split === 'test' ? 'test' : 'tuning';
  if (which === 'test' && !p.splits?.[modeId]?.revealedAt) return { ...empty, split: 'test', locked: true };
  const bad = new Set(check.unreadable || EMPTY);
  for (const { traceId, label } of labeledSet(p, modeId)) {
    if (splitOf(p, modeId, traceId) !== which) continue;
    const v = judgeVerdict(check, traceId);
    if (v) pairs.push({ traceId, human: label, check: v });
    else if (bad.has(traceId) || check.results?.[traceId]) unreadable.push(traceId);
    else missing++;
  }
  return { ...agreement(pairs), split: which, unreadable, errors, missing, locked: false };
}

/** Final-test state of a judge: 'hidden' (not revealed), 'current', or 'outdated' (prompt, model, labels, or definition changed). */
export function checkTestState(p, checkId) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  if (!check || !check.test) return 'hidden';
  const mode = modeMap(p).get(check.modeId);
  const t = check.test;
  const same = t.promptHash === promptHash(check) && (t.model ?? null) === (check.model ?? null)
    && t.labelsHash === labelsHash(p, check.modeId) && t.definitionHash === definitionHash(mode);
  return same ? 'current' : 'outdated';
}

const replaceCheck = (p, checkId, fn, t) => ({ ...p, checks: p.checks.map((c) => (c.id === checkId ? fn(c) : c)), updatedAt: t });

/**
 * Reveal the final test for a judge: records what was tested and locks the mode's test split.
 * A final test is used once, so a judge whose final test is already revealed is left as it is
 * (startFreshTest clears it for a fresh one).
 */
export function revealTest(p, checkId, opts = {}) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  if (!check || check.test) return p;
  const t = stamp(opts);
  let q = p.splits?.[check.modeId] ? p : assignSplits(p, check.modeId, {}, { now: t });
  const mode = modeMap(q).get(check.modeId);
  const test = { revealedAt: t, promptHash: promptHash(check), model: check.model ?? null, labelsHash: labelsHash(q, check.modeId), definitionHash: definitionHash(mode) };
  const split = q.splits[check.modeId];
  q = { ...q, splits: { ...q.splits, [check.modeId]: { ...split, revealedAt: split.revealedAt || t } } };
  return replaceCheck(q, checkId, (c) => ({ ...c, test }), t);
}

/** Append an agreement round ({ at, split, promptHash, model, n, agreesOnGood, catchesFailures }) to a judge's runs. */
export function recordRun(p, checkId, split = 'tuning', opts = {}) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  if (!check) return p;
  const a = checkAgreement(p, checkId, { split });
  if (!a.n) return p;
  const t = stamp(opts);
  const run = { at: t, split: a.split || 'all', promptHash: promptHash(check), model: check.model ?? null, n: a.n, agreesOnGood: a.agreesOnGood, catchesFailures: a.catchesFailures };
  return replaceCheck(p, checkId, (c) => ({ ...c, runs: [...(c.runs || EMPTY), run] }), t);
}

const DEFAULT_NAMES = { code: 'Code check', judge: 'AI judge', policy: 'Policy check', relevance: 'Relevance check' };

/**
 * Add a check for a failure mode; returns { project, id }. type: 'code' (default), 'judge',
 * 'policy' (fields.policy, fields.ruleIds), or 'relevance' (fields.intents). A judge for a mode
 * made from a tool call template starts with that template's inputs.
 */
export function addCheck(p, fields = {}, opts = {}) {
  const t = stamp(opts);
  const type = DEFAULT_NAMES[fields.type] ? fields.type : 'code';
  const mode = modeMap(p).get(fields.modeId);
  const name = String(fields.name || '').trim() || (mode ? mode.name : DEFAULT_NAMES[type]);
  const id = fields.id && !(p.checks || EMPTY).some((c) => c.id === fields.id) ? fields.id : slugId('ck', name, (p.checks || EMPTY).map((c) => c.id));
  const judgeInputs = JUDGE_TEMPLATES[mode?.template]?.inputs || ['customer', 'tools', 'retrieval', 'metadata', 'context'];
  const base = type === 'code'
    ? { id, modeId: fields.modeId, type, name, rule: { op: 'regex', target: 'output', value: '', flags: '' }, when: null, failWhen: 'match', ci: false }
    : type === 'policy' ? { id, modeId: fields.modeId, type, name, policy: null, ruleIds: [], when: null, ci: false }
      : type === 'relevance' ? { id, modeId: fields.modeId, type, name, intents: null, when: null, ci: false }
        : { id, modeId: fields.modeId, type, name, prompt: '', promptEdited: false, model: '', inputs: [...judgeInputs], runMode: 'batch', results: {}, unreadable: [], test: null, runs: [], ci: false };
  const check = { ...base, ...fields, id, type, name };
  return { project: { ...p, checks: [...(p.checks || EMPTY), check], updatedAt: t }, id };
}

/** Edit a check's fields (id and type stay). */
export function updateCheck(p, checkId, patch = {}, opts = {}) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  if (!check) return p;
  const { id: _id, type: _type, ...rest } = patch;
  if (Object.keys(rest).every((k) => check[k] === rest[k])) return p;
  return replaceCheck(p, checkId, (c) => ({ ...c, ...rest }), stamp(opts));
}

/** Delete a check. */
export function deleteCheck(p, checkId, opts = {}) {
  if (!(p.checks || EMPTY).some((c) => c.id === checkId)) return p;
  return { ...p, checks: p.checks.filter((c) => c.id !== checkId), updatedAt: stamp(opts) };
}

/**
 * Store judge results { [traceId]: { verdict, critique } } or raw judge text per trace.
 * Unreadable answers (verdict null) go to check.unreadable instead of results.
 */
export function setJudgeResults(p, checkId, results = {}, opts = {}) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  if (!check) return p;
  const t = stamp(opts);
  const next = { ...(check.results || {}) };
  const bad = new Set(check.unreadable || EMPTY);
  for (const [traceId, value] of Object.entries(results)) {
    const r = typeof value === 'string' ? parseJudgeOutput(value) : value;
    if (r && (r.verdict === 'pass' || r.verdict === 'fail')) {
      next[traceId] = { verdict: r.verdict, critique: String(r.critique ?? ''), at: t };
      bad.delete(traceId);
    } else {
      delete next[traceId];
      bad.add(traceId);
    }
  }
  return replaceCheck(p, checkId, (c) => ({ ...c, results: next, unreadable: [...bad] }), t);
}

/**
 * Likely true failure rate on traces with no label for the mode, from a revealed, current
 * final test and judge results on those traces. Returns failure rates (observed, estimate,
 * low, high), the pass-rate bootstrap, counts, and a plain reason when it cannot run.
 */
export function likelyFailureRate(p, checkId, { iterations = 2000, seed = 7 } = {}) {
  const check = (p.checks || EMPTY).find((c) => c.id === checkId);
  const out = { ok: false, reason: null, population: 0, judged: 0, flagged: null, observed: null, estimate: null, low: null, high: null, bootstrap: null };
  if (!check || check.type !== 'judge') return { ...out, reason: 'Only AI judges have a likely true failure rate.' };
  const state = checkTestState(p, checkId);
  if (state === 'hidden') return { ...out, reason: 'Reveal the final test first.' };
  if (state === 'outdated') return { ...out, reason: 'Label new traces for a fresh final test.' };
  const test = checkAgreement(p, checkId, { split: 'test' });
  const testPairs = [];
  for (const { traceId, label } of labeledSet(p, check.modeId)) {
    if (splitOf(p, check.modeId, traceId) !== 'test') continue;
    const v = judgeVerdict(check, traceId);
    if (v) testPairs.push({ traceId, human: label, check: v });
  }
  const unlabeled = [];
  let population = 0;
  for (const id of normalizeAll(p).keys()) {
    if (humanLabel(p, id, check.modeId) != null) continue;
    population++;
    const v = judgeVerdict(check, id);
    if (v) unlabeled.push(v);
  }
  const boot = bootstrapCorrected({ testPairs, unlabeledVerdicts: unlabeled, iterations, seed });
  const fail = asFailureRate(boot);
  const flagged = unlabeled.length ? unlabeled.filter((v) => v === 'fail').length / unlabeled.length : null;
  return {
    ...out, ok: boot.estimate != null, reason: boot.reason, population, judged: unlabeled.length, flagged,
    observed: fail.observed, estimate: fail.estimate, low: fail.low, high: fail.high, bootstrap: boot, test,
  };
}

/**
 * Badges for the steps of one trace from the project's tool call checks, for the stepBadges
 * view prop: { [stepId]: [{ tone: 'bad' | 'warn', text }] }. Policy violations mark the call
 * ("Breaks policy: Ask before acting"); output grounding flags mark the reply ("Not found in
 * tool results: $30"); relevance marks calls the request didn't need or must never use.
 */
export function stepBadges(p, normalized) {
  const out = {};
  const n = normalized;
  if (!n) return out;
  const add = (stepId, tone, text) => {
    if (!stepId) return;
    const list = out[stepId] || (out[stepId] = []);
    if (!list.some((b) => b.text === text)) list.push({ tone, text });
  };
  const opts = checkOptions(p);
  for (const c of p.checks || EMPTY) {
    if (!isCodeCheck(c)) continue;
    const isGrounding = c.type === 'code' && (c.rule?.op === 'grounded-values' || c.rule?.op === 'success-after-error');
    if (c.type === 'code' && !isGrounding) continue;
    const r = runCheck(c, n, opts);
    if (r.verdict !== 'fail') continue;
    if (c.type === 'policy') {
      for (const v of r.violations) add(v.stepId, 'bad', `Breaks policy: ${v.label}`);
    } else if (c.type === 'relevance' && r.relevance) {
      const calls = new Map();
      for (const s of n.steps || EMPTY) if ((s.kind === 'tool_call' || s.kind === 'tool' || s.kind === 'handoff') && !calls.has(s.name)) calls.set(s.name, []);
      for (const s of n.steps || EMPTY) if (calls.has(s.name) && (s.kind === 'tool_call' || s.kind === 'tool' || s.kind === 'handoff')) calls.get(s.name).push(s.id);
      for (const name of r.relevance.forbidden) for (const id of calls.get(name) || EMPTY) add(id, 'bad', RELEVANCE_LABELS.forbidden);
      for (const name of r.relevance.unexpected) for (const id of calls.get(name) || EMPTY) add(id, 'warn', RELEVANCE_LABELS.unexpected);
    } else if (isGrounding) {
      add(n.output?.stepId, 'warn', r.detail);
    }
  }
  return out;
}
