// Checks tab (SPEC 5.3 "Checks" and 12.7 "Tool call checks"). Build a check for one failure
// mode at a time: a code check (a rule a computer can test), a policy or relevance check for
// agents that use tools, or an AI judge (a prompt that asks a model for pass or fail). Every
// check is compared with your labels, so you can see whether it agrees with you.

import {
  html, useStore, useState, useMemo, useEffect, useRef, useDraft,
  Button, Chip, StageChip, Modal, Tabs, Segmented, EmptyState, Icon,
  CopyButton, FileDrop, Menu, toast, plural, formatCount, classes, readFile, registerIcon,
} from 'pmstack/ui';
import { updateProject, navigate } from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { LabelDrawer, labelCounts } from './label-drawer.mjs';
import { openInReview } from './shared.mjs';

registerIcon('lock', ['M7.5 11V8a4.5 4.5 0 0 1 9 0v3', 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z', 'M12 15v2']);
registerIcon('shield', ['M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z', 'M9 12l2 2 4-4']);
registerIcon('target', ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 12h.01']);
registerIcon('ground', ['M4 20h16', 'M7 16h10', 'M12 4v8', 'M8.5 8.5L12 12l3.5-3.5']);

const EMPTY = Object.freeze([]);
const TARGET_GOOD = 0.9;
const TARGET_MIN = 0.8;
const GATE = 20;
const AIM = 50;
const BATCH = 10;
const CHUNK = 400;
const BIG = 2000;

const has = (name) => typeof lib[name] === 'function';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isCodeLike = (c) => c && (c.type === 'code' || c.type === 'policy' || c.type === 'relevance');
const TYPE_NAMES = { code: 'Code check', judge: 'AI judge', policy: 'Code check: policy rules', relevance: 'Code check: intent map' };
const typeLabel = (c) => (has('checkTypeLabel') ? lib.checkTypeLabel(c) : TYPE_NAMES[c?.type] || 'Check');
const TYPE_ICON = { code: 'code', judge: 'judge', policy: 'shield', relevance: 'target' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const fmtPct = (x) => lib.pct(x);

function findCheck(p, id) {
  return (p.checks || EMPTY).find((c) => c.id === id) || null;
}

// ---------------------------------------------------------------------------
// Traces: tools used and details found (memoized per trace list)

const READ_NAMES = /^(get|list|search|lookup|find|read|verify)/i;
const INVENTORY = new WeakMap();

/** Tools the traces call: { list: [{ name, calls, traces, guess }], withTools, calls, total }. */
function toolInventory(project) {
  const key = project.traces || EMPTY;
  const hit = INVENTORY.get(key);
  if (hit && hit.exp === project.experience) return hit.value;
  if (has('toolInventory')) {
    // The engine pairs calls with results the same way the checks do; null policy means a guess from each name.
    const list = lib.toolInventory(project, null).map((r) => ({ name: r.name, calls: r.calls, traces: r.traces, guess: r.access }));
    const s = toolSummary(project);
    const value = { list, withTools: s.withTools, calls: s.calls, total: s.traces };
    INVENTORY.set(key, { exp: project.experience, value });
    return value;
  }
  const tools = new Map();
  let withTools = 0;
  let calls = 0;
  let total = 0;
  for (const n of lib.normalizeAll(project).values()) {
    total++;
    const seen = new Set();
    for (const s of n.steps) {
      if (s.kind !== 'tool_call' && s.kind !== 'tool') continue;
      const name = s.name || 'tool';
      calls++;
      const t = tools.get(name) || { name, calls: 0, traces: 0, guess: READ_NAMES.test(name) ? 'read' : 'write' };
      t.calls++;
      if (!seen.has(name)) t.traces++;
      seen.add(name);
      tools.set(name, t);
    }
    if (seen.size) withTools++;
  }
  const list = [...tools.values()].sort((a, b) => b.calls - a.calls || byText(a.name, b.name));
  const value = { list, withTools, calls, total };
  INVENTORY.set(key, { exp: project.experience, value });
  return value;
}

/** { traces, withTools, calls, writeCalls } from the engine when it has toolCallSummary, else counted here. */
function toolSummary(project) {
  if (has('toolCallSummary')) {
    try {
      const s = lib.toolCallSummary(project);
      if (s && typeof s.withTools === 'number') return s;
    } catch {
      // fall through to the local count
    }
  }
  const inv = toolInventory(project);
  const writeCalls = inv.list.filter((t) => t.guess === 'write').reduce((n, t) => n + t.calls, 0);
  return { traces: inv.total, withTools: inv.withTools, calls: inv.calls, writeCalls };
}

const DETAILS = new WeakMap();

/** Detail keys found in traces with their values by count: [{ key, values: [{ value, count }] }]. */
function detailOptions(project) {
  const key = project.traces || EMPTY;
  const hit = DETAILS.get(key);
  if (hit && hit.exp === project.experience) return hit.value;
  const map = new Map();
  for (const n of lib.normalizeAll(project).values()) {
    for (const [k, v] of Object.entries(n.metadata || {})) {
      if (v == null || v === '') continue;
      const m = map.get(k) || new Map();
      const s = String(v);
      m.set(s, (m.get(s) || 0) + 1);
      map.set(k, m);
    }
  }
  const value = [...map.entries()]
    .map(([k, m]) => ({ key: k, values: [...m.entries()].map(([v, c]) => ({ value: v, count: c })).sort((a, b) => b.count - a.count || byText(a.value, b.value)).slice(0, 60) }))
    .sort((a, b) => byText(a.key, b.key));
  DETAILS.set(key, { exp: project.experience, value });
  return value;
}

// ---------------------------------------------------------------------------
// Tool call checks: templates (SPEC 12)

const CONFIRM_WORDS = ['\\byes\\b', '\\bconfirm', 'go ahead', 'please do', 'sounds good', 'do it', 'that works'];
const CARD_PATTERN = '\\b(?:\\d[ -]?){13,16}\\b';

/** A starter policy from the tools in the traces: listed tools only, ask before writes, verify first, no card numbers. */
function starterPolicy(project) {
  const inv = toolInventory(project);
  const tools = {};
  for (const t of inv.list) tools[t.name] = t.guess === 'write' ? { access: 'write', confirm: true } : { access: 'read' };
  const verify = inv.list.find((t) => /^verify/i.test(t.name));
  const rules = [];
  if (verify) {
    rules.push({ id: 'verify-first', type: 'requires-before', tools: inv.list.filter((t) => t.name !== verify.name).map((t) => t.name), before: verify.name, why: 'Verify identity before reading or changing an account.' });
  }
  rules.push({ id: 'no-card-numbers', type: 'arg-not-match', tools: '*', pattern: CARD_PATTERN, luhn: true, why: 'Never pass card numbers to tools.' });
  const product = String(project.experience?.product || project.name || 'Agent').trim();
  return { format: 'pmstack.policy/1', name: `${product} tool policy`, onlyListedTools: true, confirmationPatterns: CONFIRM_WORDS.slice(), tools, rules };
}

const RULE_LABELS = {
  'only-listed': 'Only listed tools',
  'deny-tools': 'Never use these tools',
  'deny-access': 'No write actions',
  confirm: 'Ask before acting',
  'max-per-trace': 'At most N times per conversation',
  'requires-before': 'Do this first',
  'approval-above': 'Needs approval above a limit',
  'arg-max': 'Stay under a limit',
  'arg-min': 'Stay above a limit',
  'arg-in': 'Only these values',
  'arg-not-match': 'Never include this pattern',
  'arg-required': 'Must include',
  'arg-equals': 'Must match',
};
const RULE_TYPES = ['deny-tools', 'deny-access', 'requires-before', 'approval-above', 'arg-max', 'arg-min', 'arg-in', 'arg-not-match', 'arg-required', 'arg-equals'];
const STAR_OK = new Set(['requires-before', 'arg-max', 'arg-min', 'arg-in', 'arg-not-match', 'arg-required', 'arg-equals']);

/** Plain label for a policy rule type (the engine's labels when it has them). */
function ruleLabel(type) {
  const src = lib.policyRuleLabels;
  if (src && typeof src === 'object' && typeof src[type] === 'string') return src[type];
  if (typeof src === 'function') {
    try {
      const v = src(type);
      if (typeof v === 'string' && v) return v;
    } catch {
      // use ours
    }
  }
  return RULE_LABELS[type] || type;
}

const TEMPLATE_MODES = {
  policy: { name: 'Breaks a tool policy', definition: 'Fails when a tool call breaks a written company rule: a tool the agent may not use, a change made before the {userLabel} said yes, a limit passed without approval, or a sensitive detail passed to a tool.', columns: ['act'] },
  relevance: { name: 'Wrong tool for the request', definition: 'Fails when the agent calls a tool that does not serve what the {userLabel} asked, uses the wrong details in the call, or skips a tool the request needs.', columns: ['plan', 'act'] },
  grounding: { name: "Reply doesn't match the tool results", definition: 'Fails when the reply tells the {userLabel} something the tool results do not support: a different time or amount, a fact no tool returned, a pending or failed action described as done.', columns: ['answer'] },
};

const FAMILY_OF = {
  'policy-example': 'policy', 'policy-starter': 'policy', 'policy-file': 'policy',
  'intent-map': 'relevance', 'relevance-judge': 'relevance',
  'grounding-values': 'grounding', 'grounding-failed': 'grounding', 'grounding-judge': 'grounding',
};

function templateMode(family, exp) {
  const t = (lib.TOOL_CHECK_TEMPLATES && lib.TOOL_CHECK_TEMPLATES[family]) || TEMPLATE_MODES[family];
  const definition = lib.withUser(t.definition, exp);
  let stage = null;
  if (has('templateStage')) stage = lib.templateStage(exp, family);
  else {
    const s = (exp.stages || EMPTY).find((x) => (t.columns || EMPTY).includes(x.column));
    stage = s ? s.id : null;
  }
  return { name: t.name, definition, stage };
}

/** The canonical question and line for a Tool call checks card. */
function toolCopy(family, exp, fallback) {
  const t = lib.TOOL_CHECK_TEMPLATES && lib.TOOL_CHECK_TEMPLATES[family];
  return t ? { question: lib.withUser(t.question, exp), line: lib.withUser(t.summary, exp) } : fallback;
}

function opLabel(id, fallback) {
  const op = (lib.OPERATORS || EMPTY).find((o) => o.id === id);
  return op ? op.label : fallback;
}

/** Add a check of any type; keeps the requested type when an older engine only knows code checks and judges. */
function addTypedCheck(p, fields) {
  const r = lib.addCheck(p, fields);
  const made = findCheck(r.project, r.id);
  if (!made || made.type === fields.type) return r;
  const { rule: _rule, when: _when, failWhen: _fw, ...rest } = made;
  const fixed = { ...rest, ...fields, id: r.id, type: fields.type };
  return { project: { ...r.project, checks: r.project.checks.map((c) => (c.id === r.id ? fixed : c)) }, id: r.id };
}

function familyChecks(project, family) {
  const mm = lib.modeMap(project);
  return (project.checks || EMPTY).filter((c) => {
    if (family === 'policy') return c.type === 'policy';
    if (family === 'relevance') return c.type === 'relevance' || (c.type === 'judge' && mm.get(c.modeId)?.template === 'relevance');
    return (c.type === 'code' && (c.rule?.op === 'grounded-values' || c.rule?.op === 'success-after-error')) || (c.type === 'judge' && mm.get(c.modeId)?.template === 'grounding');
  });
}

// ---------------------------------------------------------------------------
// Running code, policy, and relevance checks over every trace

function policyOf(check) {
  return check.policy || { format: 'pmstack.policy/1', tools: {}, rules: [] };
}

/**
 * One function that judges a normalized trace with a check, the same way the engine measures
 * agreement: { verdict, detail }, plus violations (policy) or relevance (intent map).
 */
function evaluatorFor(project, check) {
  const opts = has('checkOptions') ? lib.checkOptions(project) : {};
  return (n) => {
    try {
      return lib.runCheck(check, n, opts);
    } catch (e) {
      return { verdict: 'error', detail: `The check could not run: ${e.message}` };
    }
  };
}

function runKey(check) {
  return JSON.stringify([check.type, check.rule, check.when, check.failWhen, check.policy, check.ruleIds, check.intents]);
}

/**
 * Run a check over every trace, 300 ms after its rule stops changing, in chunks when there are
 * more than 2,000 traces. Returns { running, done, total, data } where data keeps the last full run.
 */
function useCheckRun(project, check) {
  const key = runKey(check);
  const [state, setState] = useState({ running: true, done: 0, total: 0, data: null });
  const first = useRef(true);
  useEffect(() => {
    const norm = lib.normalizeAll(project);
    const ids = [...norm.keys()];
    const total = ids.length;
    const judge = evaluatorFor(project, check);
    const data = { key, results: new Map(), fail: 0, pass: 0, error: 0, total };
    let i = 0;
    let timer = 0;
    let dead = false;
    const step = () => {
      if (dead) return;
      const size = total > BIG ? CHUNK : total;
      const end = Math.min(total, i + Math.max(1, size));
      for (; i < end; i++) {
        const id = ids[i];
        const r = judge(norm.get(id));
        data.results.set(id, r);
        data[r.verdict === 'fail' ? 'fail' : r.verdict === 'pass' ? 'pass' : 'error']++;
      }
      if (i < total) {
        setState((s) => ({ ...s, running: true, done: i, total }));
        timer = setTimeout(step, 0);
      } else {
        setState({ running: false, done: total, total, data });
      }
    };
    setState((s) => (s.running ? s : { ...s, running: true, done: 0, total }));
    timer = setTimeout(step, first.current ? 0 : 300);
    first.current = false;
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [project.traces, project.experience, key]);
  return state;
}

/** Agreement between a finished run and your labels for the check's failure mode. */
function runAgreement(project, check, data) {
  const pairs = [];
  const errors = [];
  if (!data) return { ...lib.agreement([]), errors };
  for (const { traceId, label } of lib.labeledSet(project, check.modeId)) {
    const r = data.results.get(traceId);
    if (!r) continue;
    if (r.verdict === 'error') errors.push(traceId);
    else pairs.push({ traceId, human: label, check: r.verdict });
  }
  return { ...lib.agreement(pairs), errors };
}

// ---------------------------------------------------------------------------
// All checks: one row per check with its agreement numbers

function checkRow(project, c, mm) {
  let a;
  let split;
  let state = null;
  try {
    if (c.type === 'judge') {
      state = lib.checkTestState(project, c.id);
      a = lib.checkAgreement(project, c.id, { split: state === 'hidden' ? 'tuning' : 'test' });
      split = state === 'hidden' ? 'tuning set' : 'final test';
    } else {
      a = lib.checkAgreement(project, c.id);
      split = 'all labels';
    }
  } catch {
    a = lib.agreement([]);
    split = c.type === 'judge' ? 'tuning set' : 'all labels';
  }
  const judged = c.type === 'judge' ? Object.keys(c.results || {}).length : null;
  return { check: c, mode: mm.get(c.modeId) || null, a, split, state, judged, draft: lib.isDraftCheck(c) };
}

function orderedModes(project) {
  const order = new Map(lib.priorityTable(project).map((r, i) => [r.mode.id, i]));
  const list = (project.modes || EMPTY).filter((m) => m.kind === 'failure');
  const rank = (m) => (m.decision === 'check' ? 0 : 1);
  return list.slice().sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

function rateTone(x) {
  if (x == null) return 'none';
  if (x >= TARGET_GOOD) return 'good';
  if (x < TARGET_MIN) return 'bad';
  return 'mid';
}

function RateCell({ value, num, den }) {
  if (value == null) return html`<td class="num muted">-</td>`;
  return html`<td class="num">
    <span class=${'checks-rate-text is-' + rateTone(value)}>${fmtPct(value)}</span>
    <span class="checks-rate-of">${num} of ${den}</span>
  </td>`;
}

function AllChecksTable({ rows, selectedId }) {
  return html`<section class="checks-all card" aria-labelledby="checks-all-title">
    <div class="row-between checks-all-head">
      <h2 id="checks-all-title" class="checks-h2">All checks</h2>
      <p class="hint">Aim for both numbers above 90%, and never below 80%.</p>
    </div>
    <div class="table-wrap">
      <table class="table checks-all-table">
        <thead><tr>
          <th scope="col">Check</th>
          <th scope="col">Type</th>
          <th scope="col" class="num">Catches real failures</th>
          <th scope="col" class="num">Agrees on good traces</th>
          <th scope="col" class="num">Labels</th>
          <th scope="col">Measured on</th>
          <th scope="col">Runs on every change</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr key=${r.check.id} class=${classes(r.check.id === selectedId && 'is-selected')}>
            <td class="checks-all-name">
              <button type="button" class="checks-link" onClick=${() => navigate('checks', r.check.id)}>${r.check.name}</button>
              <span class="checks-sub">${r.mode ? r.mode.name : 'Failure mode missing'}</span>
            </td>
            <td><span class="checks-type"><${Icon} name=${TYPE_ICON[r.check.type] || 'code'} />${typeLabel(r.check)}</span></td>
            ${r.draft
              ? html`<td class="num muted">Draft</td><td class="num muted">Draft</td>`
              : html`<${RateCell} value=${r.a.catchesFailures} num=${r.a.tn} den=${r.a.tn + r.a.fp} />
                <${RateCell} value=${r.a.agreesOnGood} num=${r.a.tp} den=${r.a.tp + r.a.fn} />`}
            <td class="num">${r.draft ? html`<span class="muted">No rule yet</span>` : r.a.n
              ? html`${r.a.nFail} Problem<span class="checks-rate-of">${r.a.nPass} Good</span>`
              : html`<span class="muted">${r.check.type === 'judge' && !r.judged ? 'No answers yet' : 'None yet'}</span>`}</td>
            <td>
              <span class="row checks-tags">
                <${Chip} class="checks-split-tag">${r.split}<//>
                ${r.state === 'outdated' && html`<${Chip} class="checks-split-tag"><${Icon} name="warning" size=${13} />out of date<//>`}
              </span>
            </td>
            <td>${isCodeLike(r.check)
              ? (r.check.ci ? html`<span class="checks-yes"><${Icon} name="check" size=${14} />Yes</span>` : html`<span class="muted">No</span>`)
              : html`<span class="muted" title="AI judges run in batches, not on every change">Not for judges</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Left list: failure modes, "Build a check" first

function modeStatus(rows) {
  if (!rows.length) return { text: 'No check yet', empty: true };
  const r = rows[0];
  const more = rows.length > 1 ? ` + ${rows.length - 1} more` : '';
  const type = typeLabel(r.check);
  if (r.check.type === 'judge' && !r.judged) return { text: `${type}${more}: draft, no answers yet` };
  if (r.draft) return { text: `${type}${more}: draft, no rule yet` };
  if (!r.a.n) return { text: `${type}${more}: no labels to compare` };
  return { text: `${type}${more}: catches ${fmtPct(r.a.catchesFailures)}, agrees ${fmtPct(r.a.agreesOnGood)}` };
}

function ModeItem({ mode, exp, rows, selected }) {
  const st = modeStatus(rows);
  const decision = lib.DECISIONS.find((d) => d.id === mode.decision);
  const num = mode.stage ? lib.stageNumber(exp, mode.stage) : null;
  return html`<li>
    <button type="button" class=${classes('checks-mode', selected && 'is-selected', num != null && 'has-stage')} aria-current=${selected ? 'true' : undefined}
      onClick=${() => navigate('checks', mode.id)}>
      <span class="checks-mode-top">
        ${num != null && html`<span class="stage-num checks-mode-stage" title=${lib.stageLabel(exp, mode.stage)}><span class="sr-only">Stage </span>${num}</span>`}
        <span class="checks-mode-name">${mode.name}</span>
      </span>
      <span class=${classes('checks-mode-status', st.empty && 'is-empty')}>
        ${rows.length ? html`<${Icon} name=${TYPE_ICON[rows[0].check.type] || 'code'} size=${14} />` : html`<span class="checks-dot" aria-hidden="true"></span>`}
        <span>${st.text}</span>
      </span>
      ${mode.decision !== 'check' && decision && html`<span class="checks-mode-decision">${decision.label}${mode.fixedAt ? ', marked fixed' : ''}</span>`}
    </button>
  </li>`;
}

function ModeList({ modes, exp, rowsByMode, selectedId }) {
  const build = modes.filter((m) => m.decision === 'check');
  const other = modes.filter((m) => m.decision !== 'check');
  const group = (title, list) => list.length > 0 && html`<div class="checks-mode-group">
    <h2 class="section-title">${title} <span class="num">(${list.length})</span></h2>
    <ul class="checks-mode-list">
      ${list.map((m) => html`<${ModeItem} key=${m.id} mode=${m} exp=${exp} rows=${rowsByMode.get(m.id) || EMPTY} selected=${m.id === selectedId} />`)}
    </ul>
  </div>`;
  return html`<nav class="checks-modes" aria-label="Failure modes">
    ${group('Decided: build a check', build)}
    ${group(build.length ? 'Other failure modes' : 'Failure modes', other)}
  </nav>`;
}

// ---------------------------------------------------------------------------
// Tool call checks panel (SPEC 12.7)

function ToolCard({ icon, n, name, question, line, actions, inUse }) {
  return html`<article class="checks-tool-card">
    <header class="checks-tool-card-head">
      <span class="checks-tool-icon" aria-hidden="true"><${Icon} name=${icon} size=${16} /></span>
      <h3 class="checks-tool-q"><span class="checks-tool-n">${n}</span> ${name}: ${question}</h3>
    </header>
    <p class="checks-tool-line">${line}</p>
    ${inUse.length > 0 && html`<div class="checks-tool-inuse">
      <${Icon} name="check" size=${14} />
      <div>
        <span>In use:</span>
        <ul class="checks-tool-inuse-list">
          ${inUse.map((c) => html`<li key=${c.id}><button type="button" class="checks-link" onClick=${() => navigate('checks', c.id)}>${c.name}</button></li>`)}
        </ul>
      </div>
    </div>`}
    <div class="checks-tool-actions">
      ${actions.map((a) => html`<${Button} key=${a.label} kind="secondary" size="sm" icon=${a.icon || 'plus'} onClick=${a.onClick}>${a.label}<//>`)}
    </div>
  </article>`;
}

function ToolCallPanel({ project, summary, onFlow, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const exp = project.experience || {};
  const who = lib.userWord(exp);
  const lineTools = `Your traces call tools ${plural(summary.calls, 'time')} in ${plural(summary.withTools, 'trace')}.`;
  const lineWrites = summary.writeCalls ? ` ${formatCount(summary.writeCalls)} of those calls change something.` : '';
  const policy = toolCopy('policy', exp, { question: 'Is this call allowed?', line: "Your company's rules for which tools the agent may use, when, and with what details." });
  const relevance = toolCopy('relevance', exp, { question: `Is it the right call for what the ${who} asked?`, line: "Right tool, right details, no calls the request didn't need, none it skipped." });
  const grounding = toolCopy('grounding', exp, { question: 'Does the reply match what the tool returned?', line: 'No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.' });
  return html`<section class="checks-tools card" aria-labelledby="checks-tools-title">
    <button type="button" class="checks-tools-toggle" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      <span class="grow">
        <span id="checks-tools-title" class="checks-tools-title">Tool call checks</span>
        <span class="checks-tools-sub">${lineTools}${lineWrites}</span>
      </span>
      <span class=${classes('checks-chevron', open && 'is-open')}><${Icon} name="chevron-down" /></span>
    </button>
    ${open && html`<div class="checks-tools-cards">
      <${ToolCard} icon="shield" n="1" name="Policy" question=${policy.question} line=${policy.line}
        inUse=${familyChecks(project, 'policy')}
        actions=${[
          { label: 'Start from the enterprise example', icon: 'doc', onClick: () => onFlow({ kind: 'policy-example' }) },
          { label: 'Start from a starter policy', icon: 'plus', onClick: () => onFlow({ kind: 'policy-starter' }) },
          { label: 'Paste or upload your policy file', icon: 'upload', onClick: () => onFlow({ kind: 'policy-file' }) },
        ]} />
      <${ToolCard} icon="target" n="2" name="Relevance" question=${relevance.question} line=${relevance.line}
        inUse=${familyChecks(project, 'relevance')}
        actions=${[
          { label: 'Use an intent map', icon: 'list', onClick: () => onFlow({ kind: 'intent-map' }) },
          { label: 'Use the AI judge template', icon: 'judge', onClick: () => onFlow({ kind: 'relevance-judge' }) },
        ]} />
      <${ToolCard} icon="ground" n="3" name="Output grounding" question=${grounding.question} line=${grounding.line}
        inUse=${familyChecks(project, 'grounding')}
        actions=${[
          { label: 'Add the value check', icon: 'code', onClick: () => onFlow({ kind: 'grounding-values' }) },
          { label: 'Add the failed-call check', icon: 'code', onClick: () => onFlow({ kind: 'grounding-failed' }) },
          { label: 'Use the AI judge template', icon: 'judge', onClick: () => onFlow({ kind: 'grounding-judge' }) },
        ]} />
    </div>`}
  </section>`;
}

const FLOW_TITLES = {
  policy: 'Add a policy check',
  'intent-map': 'Relevance: use an intent map',
  'relevance-judge': 'Relevance: use the AI judge template',
  'grounding-values': 'Output grounding: add the value check',
  'grounding-failed': 'Output grounding: add the failed-call check',
  'grounding-judge': 'Output grounding: use the AI judge template',
};

const FLOW_INTRO = {
  'policy-example': 'A worked policy for a fictional internet provider: which tools read or change something, what needs a yes from the {userLabel}, limits, approvals, and data that must never reach a tool. Edit it to match your company.',
  'policy-starter': 'Built from the tools in your traces: only these tools are allowed, write actions wait for a yes, and card numbers never reach a tool. You mark each tool read or write next.',
  'policy-file': 'A pmstack policy file (format pmstack.policy/1). The enterprise example in the pmstack templates folder shows every kind of rule.',
  'intent-map': 'An intent map lists, for each kind of request, the tools it needs, the tools it may use, and the tools it must never use. It needs a detail on each trace that says what the {userLabel} wanted.',
  'relevance-judge': 'A prompt that asks a model whether the agent picked the right tools, with the right details, for what the {userLabel} asked. Use it when your traces have no intent detail, or when the details of a call matter.',
  'grounding-values': 'Fails a trace when the final reply has a number, time, date, amount, or code that no tool returned and the {userLabel} never said. A first-pass filter: exact values only.',
  'grounding-failed': 'Fails a trace when the reply claims success (done, booked, applied) after the last tool call failed or came back pending.',
  'grounding-judge': 'A prompt that asks a model whether the reply matches what the tools returned, including paraphrase and dropped qualifiers such as pending or estimated.',
};

function intentsFromTraces(project, key) {
  const path = 'metadata.' + key;
  const byValue = new Map();
  for (const n of lib.normalizeAll(project).values()) {
    const v = lib.fieldValue(n, path);
    if (v == null || v === '') continue;
    const s = String(v);
    const set = byValue.get(s) || new Set();
    for (const st of n.steps) if (st.kind === 'tool_call' || st.kind === 'tool') set.add(st.name || 'tool');
    byValue.set(s, set);
  }
  const intents = [...byValue.entries()].sort((a, b) => byText(a[0], b[0])).map(([value, tools]) => ({
    id: value, label: value.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), expect: [], allow: [...tools].sort(byText), never: [],
  }));
  return { format: 'pmstack.intents/1', intentFrom: path, intents };
}

function parseJsonText(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: `This is not valid JSON yet: ${e.message}` };
  }
}

function validateWith(name, obj) {
  if (!has(name)) return { ok: true, errors: [] };
  try {
    const r = lib[name](obj);
    return { ok: !!r.ok, errors: r.errors || [] };
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
}

function FilePaste({ label, text, setText, placeholder }) {
  const onFile = async (file) => setText(await readFile(file));
  return html`<div class="stack checks-filepaste">
    <${FileDrop} accept=".json,application/json" onFile=${onFile} label=${label} />
    <label class="field">
      <span class="label">Or paste it here</span>
      <textarea class="textarea mono checks-code-area" rows="7" value=${text} onInput=${(e) => setText(e.currentTarget.value)}
        placeholder=${placeholder} spellcheck="false"></textarea>
    </label>
  </div>`;
}

/** The modal that adds a tool call check and links it to a failure mode. */
function TemplateFlow({ project, flow, onClose }) {
  const exp = project.experience || {};
  const [kind, setKind] = useState(flow.kind);
  const family = FAMILY_OF[kind];
  const tmpl = templateMode(family, exp);
  const modes = (project.modes || EMPTY).filter((m) => m.kind === 'failure');
  const sameTemplate = modes.filter((m) => m.template === family);
  const [pick, setPick] = useState(flow.modeId || (sameTemplate[0] ? sameTemplate[0].id : 'new'));
  const [text, setText] = useState('');
  const details = detailOptions(project);
  const guessKey = (details.find((d) => /intent/i.test(d.key)) || details.find((d) => d.values.length >= 2 && d.values.length <= 30) || details[0] || {}).key || '';
  const [intentKey, setIntentKey] = useState(guessKey);
  const [intentSource, setIntentSource] = useState('traces');

  let payload = null;
  let problems = [];
  if (kind === 'policy-file') {
    if (text.trim()) {
      const parsed = parseJsonText(text);
      if (parsed.error) problems = [parsed.error];
      else {
        const v = validateWith('validatePolicy', parsed.value);
        problems = v.errors;
        if (v.ok) payload = parsed.value;
      }
    }
  } else if (kind === 'intent-map') {
    if (intentSource === 'traces') {
      if (intentKey) payload = intentsFromTraces(project, intentKey);
      if (payload && !payload.intents.length) {
        problems = [`No trace has a value for "${intentKey}".`];
        payload = null;
      }
    } else if (text.trim()) {
      const parsed = parseJsonText(text);
      if (parsed.error) problems = [parsed.error];
      else {
        const obj = parsed.value && !parsed.value.intentFrom && intentKey ? { ...parsed.value, intentFrom: 'metadata.' + intentKey } : parsed.value;
        const v = validateWith('validateIntents', obj);
        problems = v.errors;
        if (v.ok) payload = obj;
      }
    }
  }
  const needsPayload = kind === 'policy-file' || kind === 'intent-map';
  const ready = !needsPayload || !!payload;

  const create = () => {
    let newId = null;
    updateProject((p) => {
      let q = p;
      let modeId = pick;
      if (pick === 'new') {
        const r = lib.addMode(q, { kind: 'failure', name: tmpl.name, definition: tmpl.definition, stage: tmpl.stage, decision: 'check' });
        q = lib.updateMode(r.project, r.id, { template: family });
        modeId = r.id;
      } else {
        const m = lib.modeMap(q).get(modeId);
        if (m && !m.template) q = lib.updateMode(q, modeId, { template: family });
      }
      let fields;
      if (family === 'policy') {
        const policy = kind === 'policy-example'
          ? lib.EXAMPLE_POLICY
          : kind === 'policy-starter' ? starterPolicy(q) : payload;
        fields = { type: 'policy', modeId, name: 'Follows the tool policy', policy: JSON.parse(JSON.stringify(policy)), ruleIds: [], ci: false };
      } else if (kind === 'intent-map') {
        fields = { type: 'relevance', modeId, name: 'Right tools for the request', intents: payload, ci: false };
      } else if (kind === 'grounding-values') {
        fields = { type: 'code', modeId, name: opLabel('grounded-values', 'Every number in the reply comes from a tool'), rule: { op: 'grounded-values', target: 'output' }, when: null, failWhen: 'match', ci: false };
      } else if (kind === 'grounding-failed') {
        fields = { type: 'code', modeId, name: opLabel('success-after-error', 'Claims success after a failed or pending call'), rule: { op: 'success-after-error', target: 'output' }, when: null, failWhen: 'match', ci: false };
      } else {
        const t = lib.JUDGE_TEMPLATES && lib.JUDGE_TEMPLATES[family];
        const inputs = t && Array.isArray(t.inputs) ? t.inputs.slice() : family === 'relevance' ? ['customer', 'tools'] : ['tools', 'customer'];
        fields = { type: 'judge', modeId, name: family === 'relevance' ? 'Picks the right tool' : 'Reply matches the tool results', inputs, model: '' };
      }
      const r2 = addTypedCheck(q, fields);
      newId = r2.id;
      return r2.project;
    }, 'add tool call check');
    onClose();
    if (newId) {
      navigate('checks', newId);
      toast('Check added.', { tone: 'good' });
    }
  };

  const who = lib.userWord(exp);
  const title = family === 'policy' ? FLOW_TITLES.policy : FLOW_TITLES[kind];
  return html`<${Modal} open=${true} title=${title} onClose=${onClose} class="checks-flow-modal"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//>
      <${Button} kind="primary" disabled=${!ready} onClick=${create}>Add the check<//>`}>
    <div class="stack-lg">
      ${family === 'policy' && html`<${Segmented} label="Start from" value=${kind} onChange=${setKind}
        options=${[{ value: 'policy-starter', label: 'Your tools' }, { value: 'policy-example', label: 'Enterprise example' }, { value: 'policy-file', label: 'Your policy file' }]} />`}
      <p class="soft">${lib.withUser(FLOW_INTRO[kind], exp)}</p>

      ${kind === 'policy-file' && html`<${FilePaste} label="Choose your policy file" text=${text} setText=${setText}
        placeholder='{ "format": "pmstack.policy/1", "tools": { ... }, "rules": [ ... ] }' />`}

      ${kind === 'intent-map' && html`<div class="stack">
        <label class="field">
          <span class="label">Which detail says what the ${who} wanted?</span>
          ${details.length
            ? html`<select class="select" value=${intentKey} onChange=${(e) => setIntentKey(e.currentTarget.value)}>
                ${details.map((d) => html`<option key=${d.key} value=${d.key}>${d.key} (${plural(d.values.length, 'value')})</option>`)}
              </select>`
            : html`<p class="error-text">Your traces have no details yet. Use the AI judge template instead.</p>`}
        </label>
        <${Segmented} label="Where the map comes from" value=${intentSource} onChange=${setIntentSource}
          options=${[{ value: 'traces', label: 'Start from your traces' }, { value: 'file', label: 'Upload or paste a map' }]} />
        ${intentSource === 'traces'
          ? payload && html`<p class="hint">We found ${plural(payload.intents.length, 'intent')} and filled "Also allowed" with the tools the agent used for each one. Next, move the tools every request needs to "Expected", and add the tools it must never use.</p>`
          : html`<${FilePaste} label="Choose your intent map" text=${text} setText=${setText}
              placeholder='{ "format": "pmstack.intents/1", "intents": [ ... ] }' />`}
      </div>`}

      ${problems.length > 0 && html`<ul class="checks-problems" role="alert">${problems.map((e, i) => html`<li key=${i} class="error-text">${e}</li>`)}</ul>`}

      ${!flow.modeId && html`<fieldset class="checks-pick">
        <legend class="label">Which failure mode does this check measure?</legend>
        <label class=${classes('checks-pick-row', pick === 'new' && 'is-picked')}>
          <input type="radio" name="checks-pick" checked=${pick === 'new'} onChange=${() => setPick('new')} />
          <span class="grow">
            <span class="checks-pick-name">New failure mode: ${tmpl.name}</span>
            <span class="checks-pick-def">${tmpl.definition}</span>
          </span>
        </label>
        ${[...sameTemplate, ...modes.filter((m) => m.template !== family)].map((m) => html`<label key=${m.id} class=${classes('checks-pick-row', pick === m.id && 'is-picked')}>
          <input type="radio" name="checks-pick" checked=${pick === m.id} onChange=${() => setPick(m.id)} />
          <span class="grow">
            <span class="checks-pick-name">${m.name}${m.template === family ? html` <span class="badge">same template</span>` : ''}</span>
            ${m.definition && html`<span class="checks-pick-def">${m.definition}</span>`}
          </span>
        </label>`)}
      </fieldset>`}
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------
// Selected failure mode: chooser, then the editor for its check

function CheckChooser({ project, mode, tools, onFlow, onCancel }) {
  const create = (type) => {
    let id = null;
    updateProject((p) => {
      const t = mode.template && lib.JUDGE_TEMPLATES && lib.JUDGE_TEMPLATES[mode.template];
      const fields = type === 'judge'
        ? { type: 'judge', modeId: mode.id, inputs: t && Array.isArray(t.inputs) ? t.inputs.slice() : ['customer', 'tools', 'retrieval', 'metadata', 'context'] }
        : { type: 'code', modeId: mode.id };
      const r = lib.addCheck(p, fields);
      id = r.id;
      return r.project;
    }, 'add check');
    if (id) navigate('checks', id);
    if (onCancel) onCancel();
  };
  const exp = project.experience || {};
  return html`<section class="checks-chooser" aria-labelledby="checks-chooser-title">
    <div class="row-between">
      <h3 id="checks-chooser-title" class="checks-h3">Can a simple rule decide this?</h3>
      ${onCancel && html`<${Button} kind="ghost" size="sm" onClick=${onCancel}>Cancel<//>`}
    </div>
    <div class="checks-choices">
      <button type="button" class="checks-choice" onClick=${() => create('code')}>
        <span class="checks-choice-icon"><${Icon} name="code" size=${20} /></span>
        <span class="checks-choice-kicker">Yes, a rule can decide it</span>
        <span class="checks-choice-name">Code check</span>
        <span class="checks-choice-line">A rule a computer can test, like "no formatting symbols in text messages". Fast, free, and it can run on every change.</span>
      </button>
      <button type="button" class="checks-choice" onClick=${() => create('judge')}>
        <span class="checks-choice-icon"><${Icon} name="judge" size=${20} /></span>
        <span class="checks-choice-kicker">No, it takes judgment</span>
        <span class="checks-choice-name">AI judge</span>
        <span class="checks-choice-line">A prompt that asks a model to decide pass or fail for this one failure mode. You confirm it agrees with your labels before you trust it.</span>
      </button>
    </div>
    ${tools && html`<div class="checks-choice-more">
      <span class="small muted">For agents that use tools:</span>
      <${Button} kind="ghost" size="sm" icon="shield" onClick=${() => onFlow({ kind: 'policy-starter', modeId: mode.id })}>Policy check<//>
      <${Button} kind="ghost" size="sm" icon="target" onClick=${() => onFlow({ kind: 'intent-map', modeId: mode.id })}>Relevance check with an intent map<//>
    </div>`}
    ${mode.decision === 'fix' && html`<p class="banner"><${Icon} name="note" />
      <span>You chose Fix it now for this failure mode. ${lib.withUser('Add the instruction first. Build a check only if it keeps failing after the fix, or if it is critical.', exp)}</span></p>`}
  </section>`;
}

function Switch({ checked, onChange, label, hint }) {
  return html`<label class="checks-switch">
    <input type="checkbox" role="switch" checked=${checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span class="checks-switch-track" aria-hidden="true"><span class="checks-switch-thumb"></span></span>
    <span class="checks-switch-text"><span class="checks-switch-label">${label}</span>${hint && html`<span class="hint">${hint}</span>`}</span>
  </label>`;
}

function CheckHeader({ check, onDelete }) {
  const name = useDraft(check.id + '|name', check.name, (text) => updateProject((p) => lib.updateCheck(p, check.id, { name: text.trim() || check.name }), 'check name'));
  return html`<div class="checks-check-head">
    <div class="checks-check-title">
      <span class="checks-type"><${Icon} name=${TYPE_ICON[check.type] || 'code'} />${typeLabel(check)}</span>
      <input class="checks-name-input" type="text" aria-label="Check name" value=${name.value}
        onInput=${name.onInput} onFocus=${name.onFocus} onBlur=${name.onBlur} />
    </div>
    ${isCodeLike(check) && html`<div class="row checks-check-actions">
      <${Switch} checked=${!!check.ci} label="Run on every change"
        hint="Your engineers run it on every code change. Download it from Report."
        onChange=${(v) => updateProject((p) => lib.updateCheck(p, check.id, { ci: v }), 'run on every change')} />
    </div>`}
    <${Button} kind="ghost" size="sm" icon="trash" class="checks-check-delete" title="Delete this check" onClick=${onDelete} />
  </div>`;
}

function ModeHeader({ mode, exp, onAdd }) {
  const sev = lib.SEVERITIES.find((s) => s.id === mode.severity);
  const decision = lib.DECISIONS.find((d) => d.id === mode.decision);
  const template = mode.template;
  return html`<header class="checks-mode-head">
    <p class="checks-eyebrow">Failure mode</p>
    <h2 class="checks-mode-title">${mode.name}</h2>
    ${mode.definition
      ? html`<p class="checks-mode-def">${mode.definition}</p>`
      : html`<p class="checks-mode-def muted">No definition yet. Add one in Failure modes: a check needs to know exactly what fails.</p>`}
    <div class="row checks-mode-chips">
      ${mode.stage && html`<${StageChip} experience=${exp} stageId=${mode.stage} />`}
      ${sev && html`<${Chip} tone=${sev.id === 'blocks' ? 'bad' : sev.id === 'hurts' ? 'warn' : 'neutral'}>${sev.short}<//>`}
      ${decision && html`<${Chip}>${decision.label}<//>`}
      ${template && html`<${Chip}>${template === 'policy' ? 'Policy' : template === 'relevance' ? 'Relevance' : 'Output grounding'} template<//>`}
      <${Button} kind="ghost" size="sm" icon="arrow-right" onClick=${() => navigate('modes')}>Edit in Failure modes<//>
      ${onAdd && html`<${Button} kind="ghost" size="sm" icon="plus" onClick=${onAdd}>Add another check<//>`}
    </div>
  </header>`;
}

function ModeDetail({ project, mode, check, tools, onFlow, storageKind, folder }) {
  const exp = project.experience || {};
  const checks = (project.checks || EMPTY).filter((c) => c.modeId === mode.id);
  const [adding, setAdding] = useState(false);
  const [labels, setLabels] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openLabels = (traceIds = null) => setLabels({ traceIds });
  const active = check && check.modeId === mode.id ? check : checks[0] || null;

  const remove = () => {
    const id = active.id;
    updateProject((p) => lib.deleteCheck(p, id), 'delete check');
    setConfirmDelete(false);
    navigate('checks', mode.id, { replace: true });
    toast('Check deleted.');
  };

  let editor = null;
  if (active && !adding) {
    if (active.type === 'judge') editor = html`<${JudgeBuilder} key=${active.id} project=${project} check=${active} mode=${mode} storageKind=${storageKind} folder=${folder} openLabels=${openLabels} />`;
    else if (active.type === 'policy') editor = html`<${PolicyEditor} key=${active.id} project=${project} check=${active} openLabels=${openLabels} />`;
    else if (active.type === 'relevance') editor = html`<${RelevanceEditor} key=${active.id} project=${project} check=${active} openLabels=${openLabels} onFlow=${onFlow} />`;
    else editor = html`<${CodeEditor} key=${active.id} project=${project} check=${active} openLabels=${openLabels} />`;
  }

  return html`<div class="checks-detail">
    <${ModeHeader} mode=${mode} exp=${exp} onAdd=${checks.length > 0 && !adding ? () => setAdding(true) : null} />
    ${checks.length > 1 && !adding && html`<div class="checks-check-tabs">
      <${Tabs} label="Checks for this failure mode" value=${active.id}
        onChange=${(id) => navigate('checks', id)}
        items=${checks.map((c) => ({ id: c.id, label: c.name }))} />
    </div>`}
    ${(!checks.length || adding) && html`<${CheckChooser} project=${project} mode=${mode} tools=${tools} onFlow=${onFlow}
      onCancel=${checks.length ? () => setAdding(false) : null} />`}
    ${active && !adding && html`<div class="checks-editor card">
      <${CheckHeader} key=${active.id} check=${active} onDelete=${() => setConfirmDelete(true)} />
      ${editor}
    </div>`}
    <${LabelDrawer} open=${!!labels} modeId=${mode.id} traceIds=${labels && labels.traceIds} onClose=${() => setLabels(null)} />
    <${Modal} open=${confirmDelete} title="Delete this check?" onClose=${() => setConfirmDelete(false)}
      footer=${html`<${Button} onClick=${() => setConfirmDelete(false)}>Cancel<//><${Button} kind="bad" icon="trash" onClick=${remove}>Delete check<//>`}>
      <p>"${active ? active.name : ''}" and ${active && active.type === 'judge' ? 'every judge answer it holds' : 'its settings'} go away. Your labels and the failure mode stay.</p>
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------
// Results and agreement, shared by every kind of check

function RateBlock({ label, value, num, den, what }) {
  const tone = rateTone(value);
  const status = value == null ? 'Needs labels'
    : tone === 'good' ? 'At the 90% target'
      : tone === 'mid' ? 'Above the 80% minimum. Aim for 90%.'
        : 'Below the 80% minimum';
  const w = value == null ? 0 : Math.round(value * 100);
  return html`<div class=${'checks-rate is-' + tone}>
    <p class="checks-rate-label">${label}</p>
    <p class="checks-rate-big num">${value == null ? '-' : fmtPct(value)}<span class="checks-rate-count">${den ? `${num} of ${den}` : ''}</span></p>
    <div class="checks-meter" aria-hidden="true">
      <span class="checks-meter-fill" style=${{ width: w + '%' }}></span>
      <span class="checks-meter-tick" style=${{ left: '80%' }}></span>
      <span class="checks-meter-tick" style=${{ left: '90%' }}></span>
    </div>
    <p class="checks-rate-status">${tone === 'good' && html`<${Icon} name="check" size=${14} />`}${tone === 'bad' && html`<${Icon} name="warning" size=${14} />`}<span>${status}</span></p>
    <p class="hint">${what}</p>
  </div>`;
}

function AgreementGrid({ a, who }) {
  const cell = (n, kind, text) => html`<td class=${classes('checks-cell', kind === 'agree' ? 'is-agree' : n > 0 && 'is-off')}>
    <span class="checks-cell-n num">${n}</span><span class="checks-cell-text">${text}</span>
  </td>`;
  return html`<table class="checks-grid">
    <caption class="sr-only">Your labels compared with the ${who.toLowerCase()}, on ${a.n} traces</caption>
    <thead><tr>
      <td></td>
      <th scope="col">${who} said Good</th>
      <th scope="col">${who} said Problem</th>
    </tr></thead>
    <tbody>
      <tr><th scope="row">You said Good</th>${cell(a.tp, 'agree', 'agree')}${cell(a.fn, 'off', 'flagged a good trace')}</tr>
      <tr><th scope="row">You said Problem</th>${cell(a.fp, 'off', 'missed a failure')}${cell(a.tn, 'agree', 'agree')}</tr>
    </tbody>
  </table>`;
}

function yourReason(project, modeId, id) {
  const own = project.critiques?.[modeId]?.[id];
  if (own) return own;
  const r = project.reviews?.[id];
  if (!r) return '';
  return (r.verdict === 'pass' ? r.good : r.note) || '';
}

function TraceLinks({ project, ids, detailOf, limit = 6, empty }) {
  const [all, setAll] = useState(false);
  if (!ids.length) return empty ? html`<p class="small muted">${empty}</p>` : null;
  const shown = all ? ids : ids.slice(0, limit);
  const norm = lib.normalizeAll(project);
  return html`<div class="stack checks-tracelinks">
    <ul class="checks-traces">
      ${shown.map((id) => {
        const n = norm.get(id);
        const detail = detailOf ? detailOf(id) : '';
        return html`<li key=${id}>
          <button type="button" class="checks-trace" onClick=${() => openInReview(id)}>
            <span class="checks-trace-title">${n ? n.title : id}</span>
            <span class="checks-trace-id mono">${id}</span>
            ${detail && html`<span class="checks-trace-detail">${detail}</span>`}
          </button>
        </li>`;
      })}
    </ul>
    ${ids.length > limit && html`<div><${Button} kind="ghost" size="sm" onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${ids.length}`}<//></div>`}
  </div>`;
}

function AgreementPanel({ project, check, a, detailOf, openLabels, who = 'Check', intro, empty, inStep = false }) {
  const exp = project.experience || {};
  const counts = labelCounts(project, check.modeId);
  return html`<section class="checks-agree" aria-label="Agreement with your labels">
    ${!inStep && html`<div class="row-between">
      <h4 class="checks-h4">Agreement with your labels</h4>
      <${Button} kind="secondary" size="sm" icon="check" onClick=${() => openLabels()}>Label more traces<//>
    </div>`}
    <p class="hint">${intro || `Compared on ${plural(a.n, 'trace')} you labeled for this failure mode (${counts.fail} Problem, ${counts.pass} Good).`}</p>
    ${a.n === 0
      ? html`<p class="checks-empty-note">${empty || (counts.total
        ? 'None of your labeled traces has a result yet.'
        : lib.withUser('No labels to compare yet. Mark traces in Review traces, or press Label more traces to answer "Does this trace show this failure mode?" one trace at a time.', exp))}</p>`
      : html`<div class="checks-agree-body">
        <div class="checks-rates">
          <${RateBlock} label="Catches real failures" value=${a.catchesFailures} num=${a.tn} den=${a.tn + a.fp}
            what="Of the traces you marked as showing the problem, the share it also caught." />
          <${RateBlock} label="Agrees on good traces" value=${a.agreesOnGood} num=${a.tp} den=${a.tp + a.fn}
            what="Of the traces you marked Good, the share it also marked Good." />
        </div>
        <${AgreementGrid} a=${a} who=${who} />
      </div>
      <div class="checks-misses">
        <div class="stack">
          <h5 class="checks-h5">${who} missed these failures <span class="num muted">(${a.falsePasses.length})</span></h5>
          <${TraceLinks} project=${project} ids=${a.falsePasses} detailOf=${detailOf} empty="None. It caught every failure you labeled." />
        </div>
        <div class="stack">
          <h5 class="checks-h5">${who} flagged these good traces <span class="num muted">(${a.falseFails.length})</span></h5>
          <${TraceLinks} project=${project} ids=${a.falseFails} detailOf=${detailOf} empty="None. It left every good trace alone." />
        </div>
      </div>`}
  </section>`;
}

function RunStatus({ run }) {
  if (!run.running) return null;
  const big = run.total > BIG;
  return html`<span class="checks-running" role="status">
    ${big ? `Checking ${formatCount(run.done)} of ${formatCount(run.total)} traces...` : 'Updating...'}
    ${big && html`<span class="checks-running-bar"><span style=${{ width: Math.round((run.done / Math.max(1, run.total)) * 100) + '%' }}></span></span>`}
  </span>`;
}

function versionLine(project, data) {
  const versions = lib.traceVersions(project);
  if (versions.length < 2 || !data) return '';
  const norm = lib.normalizeAll(project);
  const tally = new Map(versions.map((v) => [v, { fail: 0, total: 0 }]));
  for (const [id, r] of data.results) {
    const v = norm.get(id)?.metadata?.version;
    const t = v != null ? tally.get(String(v)) : null;
    if (!t) continue;
    t.total++;
    if (r.verdict === 'fail') t.fail++;
  }
  return versions.map((v, i) => `${i === 0 ? 'Fails ' : ''}${tally.get(v).fail} of ${formatCount(tally.get(v).total)} in ${v}`).join(', ') + '.';
}

function ResultsHead({ project, run, headline, incomplete }) {
  const data = run.data;
  const versions = !incomplete && data ? versionLine(project, data) : '';
  return html`<div class="checks-results-head">
    <div class="grow">
      <p class="checks-eyebrow">Results on every trace</p>
      <p class="checks-fails num">${incomplete ? 'No results yet' : data ? headline(data) : 'Checking your traces...'}</p>
      ${versions && html`<p class="soft small num">${versions}</p>`}
    </div>
    <${RunStatus} run=${run} />
  </div>`;
}

function FailingTraces({ project, data, title = 'Traces it fails', detailOf }) {
  const [open, setOpen] = useState(false);
  if (!data || !data.fail) return null;
  const ids = [];
  for (const [id, r] of data.results) if (r.verdict === 'fail') ids.push(id);
  return html`<div class="checks-disclosure">
    <button type="button" class="checks-disclosure-toggle" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      <span class=${classes('checks-chevron', open && 'is-open')}><${Icon} name="chevron-down" size=${14} /></span>
      <span>${title} <span class="num muted">(${ids.length})</span></span>
    </button>
    ${open && html`<${TraceLinks} project=${project} ids=${ids} limit=${10} detailOf=${detailOf || ((id) => data.results.get(id)?.detail || '')} />`}
  </div>`;
}

function ErrorList({ project, data }) {
  if (!data || !data.error) return null;
  const ids = [];
  for (const [id, r] of data.results) if (r.verdict === 'error') ids.push(id);
  return html`<div class="checks-errors" role="alert">
    <p class="checks-errors-title"><${Icon} name="warning" />The check could not run on ${plural(ids.length, 'trace')}</p>
    <${TraceLinks} project=${project} ids=${ids} limit=${5} detailOf=${(id) => data.results.get(id)?.detail || ''} />
  </div>`;
}

// ---------------------------------------------------------------------------
// Code check editor

const NO_TARGET = new Set(['tool-called', 'tool-not-called', 'tool-count-max', 'field-equals', 'field-exists', 'grounded-values', 'success-after-error']);
const TEXT_NEEDS = new Set(['pattern', 'text', 'list', 'number']);

function opOf(rule) {
  return (lib.OPERATORS || EMPTY).find((o) => o.id === rule?.op) || null;
}

function ruleIncomplete(rule, op) {
  if (!op) return 'Pick what to test.';
  const needs = op.needs;
  const v = String(rule.value ?? '').trim();
  if (!needs) return null;
  if (needs === 'pattern') return v ? null : 'Add a pattern, or pick a common one, to see which traces it fails.';
  if (needs === 'text' || needs === 'list') return v ? null : 'Add the words to look for to see which traces it fails.';
  if (needs === 'number') return v !== '' && Number.isFinite(Number(rule.n ?? rule.value)) ? null : 'Add a number of characters to see which traces it fails.';
  if (needs === 'tool') return null;
  if (needs === 'tool+number') return rule.n != null && rule.n !== '' && Number.isFinite(Number(rule.n)) ? null : 'Add the most times the tool may be used.';
  if (needs.startsWith('field')) {
    const path = String(rule.target || '').startsWith('field:') ? String(rule.target).slice(6) : rule.path;
    if (!path) return 'Pick a field to see which traces it fails.';
    if (needs === 'field+text' && !v) return 'Add the value the field should equal.';
  }
  return null;
}

function ruleSentence(check, exp) {
  const rule = check.rule || {};
  const op = opOf(rule);
  if (!op) return 'Pick what to test.';
  const target = (lib.TARGETS || EMPTY).find((t) => t.id === rule.target);
  const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
  const cut = (s) => (s.length > 48 ? s.slice(0, 47) + '...' : s);
  const v = cut(String(rule.value ?? '').trim());
  const n = rule.n ?? rule.value;
  const neg = (check.failWhen || 'match') === 'no-match';
  const path = String(rule.target || '').startsWith('field:') ? String(rule.target).slice(6).replace(/^metadata\./, '') : '';
  const when = check.when && check.when.path ? ` Only traces where ${String(check.when.path).replace(/^metadata\./, '')} is ${check.when.equals || '(pick a value)'} are checked; the rest pass.` : '';
  if (rule.op === 'grounded-values') return lib.withUser(`Fails a trace when the final reply has a number, time, date, amount, or code that no tool returned and the {userLabel} never said. Exact values only.${when}`, exp);
  if (rule.op === 'success-after-error') return `Fails a trace when the reply claims success (done, booked, applied) after the last tool call failed or came back pending.${when}`;
  const tool = v || 'a tool';
  const phrase = {
    regex: neg ? 'does not match the pattern' : 'matches the pattern',
    contains: `${neg ? 'does not contain' : 'contains'} "${v}"`,
    'contains-any': `${neg ? 'contains none of' : 'contains any of'}: ${v}`,
    'not-contains': `${neg ? 'contains' : 'does not contain'} "${v}"`,
    'max-chars': `is ${neg ? 'not ' : ''}longer than ${v} characters`,
    'min-chars': `is ${neg ? 'not ' : ''}shorter than ${v} characters`,
    'json-valid': `is ${neg ? 'not ' : ''}valid structured data`,
    'tool-called': neg ? `never uses ${tool}` : `uses ${tool}`,
    'tool-not-called': neg ? `uses ${tool}` : `never uses ${tool}`,
    'tool-count-max': `${neg ? 'does not use' : 'uses'} ${tool} more than ${n ?? 'N'} times`,
    'field-equals': `${path || 'the field'} ${neg ? 'does not equal' : 'equals'} "${v}"`,
    'field-exists': `${path || 'the field'} is ${neg ? 'missing' : 'present'}`,
  }[rule.op] || lower(op.label);
  if (rule.op === 'field-equals' || rule.op === 'field-exists') return `Fails a trace when ${phrase}.${when}`;
  if (NO_TARGET.has(rule.op)) return `Fails a trace when it ${phrase}.${when}`;
  const what = target ? lower(lib.withUser(target.label, exp)) : path ? `the field ${path}` : 'the final reply';
  return `Reads ${what} and fails the trace when it ${phrase}.${when}`;
}

function CodeEditor({ project, check, openLabels }) {
  const run = useCheckRun(project, check);
  const a = useMemo(() => runAgreement(project, check, run.data), [run.data, project.labels, project.reviews, project.modes, check.modeId]);
  const total = run.data ? run.data.total : 0;
  const rule = check.rule || {};
  const incomplete = ruleIncomplete(rule, opOf(rule)) || (rule.op === 'regex' && patternError(rule.value, rule.flags) ? 'Fix the pattern to see which traces it fails.' : null);
  return html`<div class="checks-body">
    <${CodeRuleForm} project=${project} check=${check} />
    <section class="checks-results" aria-label="Results">
      <${ResultsHead} project=${project} run=${run} incomplete=${!!incomplete} headline=${(d) => `Fails ${formatCount(d.fail)} of ${plural(total, 'trace')}`} />
      ${incomplete
        ? html`<p class="checks-empty-note">${incomplete}</p>`
        : html`<${AgreementPanel} project=${project} check=${check} a=${a} openLabels=${openLabels}
            detailOf=${(id) => run.data?.results.get(id)?.detail || ''} />
          <${FailingTraces} project=${project} data=${run.data} />
          <${ErrorList} project=${project} data=${run.data} />`}
    </section>
  </div>`;
}

function setRuleOn(checkId, patch, reason = 'edit check') {
  updateProject((p) => {
    const c = findCheck(p, checkId);
    if (!c) return p;
    const cur = c.rule || {};
    if (Object.keys(patch).every((k) => cur[k] === patch[k])) return p;
    const next = { ...cur, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return lib.updateCheck(p, checkId, { rule: next });
  }, reason);
}

function patternError(value, flags) {
  if (!String(value ?? '').trim()) return '';
  try {
    new RegExp(String(value), String(flags || '').replace(/[^imsu]/g, ''));
    return '';
  } catch (e) {
    // Browsers say "Invalid regular expression: /x/: Unterminated group"; keep only the reason.
    const reason = String(e.message || '').split(': ').pop().trim().toLowerCase();
    return `This pattern is not valid${reason ? ` (${reason})` : ''}. Check for an unclosed bracket or a stray backslash.`;
  }
}

function CodeRuleForm({ project, check }) {
  const exp = project.experience || {};
  const rule = check.rule || {};
  const ops = lib.OPERATORS || EMPTY;
  const op = opOf(rule);
  const needs = op ? op.needs : null;
  const inv = toolInventory(project);
  const details = detailOptions(project);
  const id = check.id;
  const value = useDraft(id + '|value', rule.value ?? '', (text) => setRuleOn(id, { value: text }));
  const n = useDraft(id + '|n', rule.n == null ? '' : String(rule.n), (text) => setRuleOn(id, { n: text.trim() === '' ? undefined : Number(text) }));
  const fieldPath = String(rule.target || '').startsWith('field:') ? String(rule.target).slice(6) : '';
  // Details show by name ("channel"); other fields by their place in the trace ("output.subject").
  const detailKeys = new Set(details.map((d) => d.key));
  const field = useDraft(id + '|field', fieldPath.replace(/^metadata\./, ''), (text) => {
    const t = text.trim();
    setRuleOn(id, { target: 'field:' + (detailKeys.has(t) ? 'metadata.' + t : t) });
  });

  const changeOp = (next) => {
    const nextOp = ops.find((o) => o.id === next);
    const was = needs;
    const will = nextOp ? nextOp.needs : null;
    const patch = { op: next };
    const textish = (x) => TEXT_NEEDS.has(x);
    if (!(textish(was) && textish(will)) && was !== will) {
      patch.value = '';
      patch.n = undefined;
    }
    if (will && will.startsWith('field') && !String(rule.target || '').startsWith('field:')) patch.target = 'field:' + (details[0] ? 'metadata.' + details[0].key : 'metadata.channel');
    else if (!(will && will.startsWith('field')) && String(rule.target || '').startsWith('field:') && !NO_TARGET.has(next)) patch.target = 'output';
    if (next === 'grounded-values' || next === 'success-after-error') patch.target = 'output';
    if (next !== 'regex') patch.flags = undefined;
    setRuleOn(id, patch, 'check rule');
  };

  const flags = String(rule.flags || '');
  const toggleFlag = (f, on) => setRuleOn(id, { flags: on ? (flags.includes(f) ? flags : flags + f) : flags.replace(f, '') });
  const pErr = needs === 'pattern' ? patternError(value.value, flags) : '';
  const targetId = String(rule.target || 'output').startsWith('field:') ? 'field' : rule.target || 'output';
  const toolNames = inv.list.map((t) => t.name);
  const when = check.when && check.when.path ? check.when : null;
  const whenKey = when ? String(when.path).replace(/^metadata\./, '') : '';
  const whenValues = (details.find((d) => d.key === whenKey) || { values: [] }).values;
  const setWhen = (w) => updateProject((p) => lib.updateCheck(p, id, { when: w }), 'check when');
  const textOp = !NO_TARGET.has(rule.op);
  const showField = targetId === 'field' || (needs && needs.startsWith('field'));

  return html`<section class="checks-form" aria-label="Rule">
    <p class="checks-sentence"><${Icon} name="code" />${ruleSentence(check, exp)}</p>
    <div class="checks-form-grid">
      <label class="field">
        <span class="label">What to test</span>
        <select class="select" value=${rule.op || ''} onChange=${(e) => changeOp(e.currentTarget.value)}>
          ${!op && html`<option value="">Pick a rule</option>`}
          ${ops.map((o) => html`<option key=${o.id} value=${o.id}>${o.label}</option>`)}
        </select>
      </label>
      ${!NO_TARGET.has(rule.op) && html`<label class="field">
        <span class="label">Where to look</span>
        <select class="select" value=${targetId} onChange=${(e) => setRuleOn(id, { target: e.currentTarget.value === 'field' ? 'field:' + (fieldPath || (details[0] ? 'metadata.' + details[0].key : 'output')) : e.currentTarget.value })}>
          ${(lib.TARGETS || EMPTY).map((t) => html`<option key=${t.id} value=${t.id}>${lib.withUser(t.label, exp)}</option>`)}
        </select>
      </label>`}

      ${showField && html`<label class="field">
        <span class="label">Which field</span>
        <input class="input mono" type="text" list=${id + '-fields'} value=${field.value} onInput=${field.onInput} onFocus=${field.onFocus} onBlur=${field.onBlur}
          placeholder="channel" spellcheck="false" />
        <datalist id=${id + '-fields'}>${details.map((d) => html`<option key=${d.key} value=${d.key} />`)}</datalist>
        <span class="hint">A detail such as channel, or a place in the trace such as output.subject.</span>
      </label>`}

      ${needs === 'pattern' && html`<div class="field checks-span-2">
        <div class="row-between">
          <label class="label" for=${id + '-pattern'}>Pattern</label>
          <${Menu} label="Common patterns" size="sm" kind="ghost" align="end"
            items=${(lib.COMMON_PATTERNS || EMPTY).map((c) => ({ label: c.label, hint: c.value.length > 44 ? c.value.slice(0, 44) + '...' : c.value, selected: rule.value === c.value, onClick: () => setRuleOn(id, { value: c.value, flags: c.flags }, 'common pattern') }))} />
        </div>
        <input id=${id + '-pattern'} class="input mono" type="text" value=${value.value} onInput=${value.onInput} onFocus=${value.onFocus} onBlur=${value.onBlur}
          placeholder="Pick a common pattern, or type your own" spellcheck="false" aria-invalid=${pErr ? 'true' : 'false'} />
        ${pErr ? html`<p class="error-text" role="alert">${pErr}</p>` : html`<p class="hint">A pattern describes the text to find. Start from a common one and adjust it.</p>`}
        <label class="check-row small"><input type="checkbox" checked=${flags.includes('i')} onChange=${(e) => toggleFlag('i', e.currentTarget.checked)} /> Ignore capital letters</label>
      </div>`}

      ${(needs === 'text' || needs === 'field+text') && html`<label class="field">
        <span class="label">${needs === 'field+text' ? 'Value' : 'Text'}</span>
        <input class="input" type="text" value=${value.value} onInput=${value.onInput} onFocus=${value.onFocus} onBlur=${value.onBlur} />
        ${needs === 'text' && html`<span class="hint">Capital letters do not matter.</span>`}
      </label>`}

      ${needs === 'list' && html`<label class="field checks-span-2">
        <span class="label">Words or phrases, separated by commas</span>
        <input class="input" type="text" value=${value.value} onInput=${value.onInput} onFocus=${value.onFocus} onBlur=${value.onBlur}
          placeholder="insurance, copay, bill" />
        <span class="hint">Any one of them counts. Capital letters do not matter.</span>
      </label>`}

      ${needs === 'number' && html`<label class="field">
        <span class="label">Number of characters</span>
        <input class="input num" type="number" min="0" inputmode="numeric" value=${value.value} onInput=${value.onInput} onFocus=${value.onFocus} onBlur=${value.onBlur} />
      </label>`}

      ${(needs === 'tool' || needs === 'tool+number') && html`<label class="field">
        <span class="label">Tool</span>
        <input class="input mono" type="text" list=${id + '-tools'} value=${value.value} onInput=${value.onInput} onFocus=${value.onFocus} onBlur=${value.onBlur}
          placeholder=${toolNames[0] || 'tool name'} spellcheck="false" />
        <datalist id=${id + '-tools'}>${toolNames.map((t) => html`<option key=${t} value=${t} />`)}</datalist>
        ${needs === 'tool' && html`<span class="hint">Leave it empty for any tool.</span>`}
      </label>`}

      ${needs === 'tool+number' && html`<label class="field">
        <span class="label">Most times allowed</span>
        <input class="input num" type="number" min="0" inputmode="numeric" value=${n.value} onInput=${n.onInput} onFocus=${n.onFocus} onBlur=${n.onBlur} />
      </label>`}
    </div>

    <div class="checks-form-row">
      <label class="check-row">
        <input type="checkbox" checked=${!!when} onChange=${(e) => setWhen(e.currentTarget.checked
          ? { path: 'metadata.' + (details.find((d) => d.key === 'channel') || details[0] || { key: 'channel' }).key, equals: '' }
          : null)} />
        Only for some traces
      </label>
      ${when && html`<div class="checks-when">
        <span class="small soft">Only for traces where</span>
        <select class="select checks-inline-select" aria-label="Detail" value=${whenKey}
          onChange=${(e) => setWhen({ path: 'metadata.' + e.currentTarget.value, equals: '' })}>
          ${!details.some((d) => d.key === whenKey) && html`<option value=${whenKey}>${whenKey}</option>`}
          ${details.map((d) => html`<option key=${d.key} value=${d.key}>${d.key}</option>`)}
        </select>
        <span class="small soft">is</span>
        <select class="select checks-inline-select" aria-label="Value" value=${String(when.equals ?? '')}
          onChange=${(e) => setWhen({ ...when, equals: e.currentTarget.value })}>
          <option value="">Pick a value</option>
          ${!whenValues.some((v) => v.value === String(when.equals ?? '')) && when.equals && html`<option value=${String(when.equals)}>${String(when.equals)}</option>`}
          ${whenValues.map((v) => html`<option key=${v.value} value=${v.value}>${v.value} (${v.count})</option>`)}
        </select>
      </div>`}
    </div>

    ${rule.op !== 'grounded-values' && rule.op !== 'success-after-error' && html`<div class="checks-form-row">
      <span class="small soft">${textOp ? 'Fail when the text' : 'Fail when the trace'}</span>
      <${Segmented} label="Fail when" value=${check.failWhen || 'match'}
        onChange=${(v) => updateProject((p) => lib.updateCheck(p, id, { failWhen: v }), 'fail when')}
        options=${[{ value: 'match', label: 'matches' }, { value: 'no-match', label: 'does not match' }]} />
    </div>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// Policy check editor (SPEC 12.7)

function setPolicyOn(checkId, fn, reason = 'edit policy') {
  updateProject((p) => {
    const c = findCheck(p, checkId);
    if (!c) return p;
    const next = fn(policyOf(c));
    if (!next || next === c.policy) return p;
    return lib.updateCheck(p, checkId, { policy: next });
  }, reason);
}

function ruleDetail(rule) {
  const arg = rule.argPath ? html`<code>${rule.argPath}</code>` : 'the value';
  switch (rule.type) {
    case 'deny-tools': return 'The agent may never call these.';
    case 'deny-access': return Array.isArray(rule.tools) && rule.tools.length
      ? html`No ${rule.access || 'write'} actions with these tools.`
      : html`No ${rule.access || 'write'} actions with any tool.`;
    case 'requires-before': return html`Call <code>${rule.before}</code> first, and it must not fail.`;
    case 'approval-above': return html`When ${arg} is over ${rule.max}, an earlier <code>${rule.approvalTool}</code> call is needed.`;
    case 'arg-max': return html`${arg} at most ${rule.max}.`;
    case 'arg-min': return html`${arg} at least ${rule.min ?? rule.max}.`;
    case 'arg-in': return html`${arg} is one of ${(rule.values || EMPTY).join(', ')}.`;
    case 'arg-not-match': return html`No match for <code>${rule.pattern}</code> in ${rule.argPath ? html`<code>${rule.argPath}</code>` : 'any detail of the call'}.`;
    case 'arg-required': return html`The call includes ${arg}.`;
    case 'arg-equals': return rule.source?.tool
      ? html`${arg} matches <code>${rule.source.path || rule.argPath}</code> from the latest <code>${rule.source.tool}</code> result.`
      : html`${arg} matches the trace detail <code>${String(rule.source?.detail || '').replace(/^metadata\./, '')}</code>.`;
    default: return '';
  }
}

function whenText(when) {
  if (!when || !when.path) return '';
  return `Only when ${String(when.path).replace(/^metadata\./, '')} is ${when.equals}`;
}

function ToolChips({ tools }) {
  if (tools === '*') return html`<span class="chip checks-tool-chip is-all">Every tool</span>`;
  const list = Array.isArray(tools) ? tools : tools ? [tools] : EMPTY;
  return html`${list.map((t) => html`<span key=${t} class="chip checks-tool-chip mono">${t}</span>`)}`;
}

function PolicyRules({ policy, ruleIds, onEdit, onRemove, onAdd }) {
  const tools = Object.entries(policy.tools || {});
  const confirm = tools.filter(([, t]) => t && t.confirm).map(([k]) => k);
  const maxes = tools.filter(([, t]) => t && t.maxPerTrace != null);
  const only = ruleIds && ruleIds.length ? new Set(ruleIds) : null;
  return html`<div class="stack">
    <ul class="checks-rules">
      ${policy.onlyListedTools && html`<li class="checks-rule is-derived">
        <div class="checks-rule-main">
          <p class="checks-rule-label">${ruleLabel('only-listed')}</p>
          <p class="checks-rule-detail">Any tool not in the tool list below breaks the policy.</p>
        </div>
        <span class="checks-rule-edit small muted">Set in the tool list</span>
      </li>`}
      ${confirm.length > 0 && html`<li class="checks-rule is-derived">
        <div class="checks-rule-main">
          <p class="checks-rule-label">${ruleLabel('confirm')}</p>
          <div class="row checks-rule-tools"><${ToolChips} tools=${confirm} /></div>
          <p class="checks-rule-detail">The latest message before the call has to be a yes, and it has to come after the AI proposed the action.</p>
        </div>
        <span class="checks-rule-edit small muted">Set in the tool list</span>
      </li>`}
      ${maxes.map(([name, t]) => html`<li key=${'max-' + name} class="checks-rule is-derived">
        <div class="checks-rule-main">
          <p class="checks-rule-label">At most ${plural(Number(t.maxPerTrace), 'time')} per conversation</p>
          <div class="row checks-rule-tools"><${ToolChips} tools=${[name]} /></div>
        </div>
        <span class="checks-rule-edit small muted">Set in the tool list</span>
      </li>`)}
      ${(policy.rules || EMPTY).map((r, i) => html`<li key=${r.id || i} class=${classes('checks-rule', only && !only.has(r.id) && 'is-off')}>
        <div class="checks-rule-main">
          <p class="checks-rule-label">${ruleLabel(r.type)}${only && !only.has(r.id) ? html` <span class="badge">not used by this check</span>` : ''}</p>
          ${(r.type !== 'deny-access' || (Array.isArray(r.tools) && r.tools.length > 0)) && html`<div class="row checks-rule-tools"><${ToolChips} tools=${r.tools} /></div>`}
          <p class="checks-rule-detail">${ruleDetail(r)}</p>
          ${r.why && html`<p class="checks-rule-why">${r.why}</p>`}
          ${r.when && html`<p class="checks-rule-when small"><${Icon} name="filter" size=${13} />${whenText(r.when)}</p>`}
        </div>
        <div class="row checks-rule-edit">
          <${Button} kind="ghost" size="sm" onClick=${() => onEdit(i)}>Edit<//>
          <${Button} kind="ghost" size="sm" icon="trash" title=${'Remove the rule ' + ruleLabel(r.type)} onClick=${() => onRemove(i)} />
        </div>
      </li>`)}
    </ul>
    <div><${Button} kind="secondary" size="sm" icon="plus" onClick=${onAdd}>Add a rule<//></div>
  </div>`;
}

function blankRule(type) {
  return { id: '', type, tools: [], why: '' };
}

function ToolPicker({ value, onChange, names, allowAll, emptyMeans }) {
  const [extra, setExtra] = useState('');
  const all = value === '*';
  const list = Array.isArray(value) ? value : EMPTY;
  const known = [...new Set([...names, ...list])];
  const toggle = (name) => onChange(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
  const add = () => {
    const t = extra.trim();
    if (!t) return;
    if (!list.includes(t)) onChange([...list, t]);
    setExtra('');
  };
  return html`<fieldset class="checks-toolpick">
    <legend class="label">Which tools${emptyMeans ? ' (optional)' : ''}</legend>
    ${emptyMeans && !all && !list.length && html`<p class="hint">None picked: ${emptyMeans}.</p>`}
    ${allowAll && html`<label class="check-row small"><input type="checkbox" checked=${all} onChange=${(e) => onChange(e.currentTarget.checked ? '*' : [])} /> Every tool</label>`}
    ${!all && html`<div class="checks-toolpick-list">
      ${known.map((name) => html`<label key=${name} class=${classes('checks-toolpick-item', list.includes(name) && 'is-on')}>
        <input type="checkbox" checked=${list.includes(name)} onChange=${() => toggle(name)} />
        <span class="mono">${name}</span>
      </label>`)}
    </div>
    <div class="row">
      <input class="input mono checks-toolpick-add" type="text" value=${extra} placeholder="A tool not seen in your traces" aria-label="Tool name to add"
        onInput=${(e) => setExtra(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} spellcheck="false" />
      <${Button} size="sm" onClick=${add} disabled=${!extra.trim()}>Add tool<//>
    </div>`}
  </fieldset>`;
}

// Dotted paths to the details recorded in calls to the given tools (all tools when none are given).
function argPaths(project, tools) {
  const pick = Array.isArray(tools) && tools.length ? new Set(tools) : null;
  const args = [];
  for (const n of lib.normalizeAll(project).values()) {
    for (const c of lib.toolCallList(n)) {
      if (pick && !pick.has(c.name)) continue;
      if (c.args && typeof c.args === 'object') args.push(c.args);
    }
    if (args.length >= 200) break;
  }
  return lib.fieldPaths(args, 200).filter(Boolean).slice(0, 80);
}

function RuleModal({ project, rule, names, details, onSave, onClose }) {
  const [draft, setDraft] = useState(() => rule || blankRule('deny-tools'));
  const [errors, setErrors] = useState([]);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setErrors([]); };
  const t = draft.type;
  const needArg = ['approval-above', 'arg-max', 'arg-min', 'arg-in', 'arg-required', 'arg-equals'].includes(t);
  const toolOptions = (name) => html`<datalist id=${name}>${names.map((n) => html`<option key=${n} value=${n} />`)}</datalist>`;
  const source = draft.source || {};
  const sourceKind = source.detail != null && source.tool == null ? 'detail' : 'tool';
  const pathKey = Array.isArray(draft.tools) ? draft.tools.join('|') : String(draft.tools || '');
  const paths = useMemo(() => (needArg || t === 'arg-not-match' ? argPaths(project, draft.tools) : EMPTY), [project.traces, pathKey, needArg, t]);
  const argList = html`<datalist id="checks-rule-args">${paths.map((p) => html`<option key=${p} value=${p} />`)}</datalist>`;

  const save = () => {
    const errs = [];
    const r = { ...draft };
    if (t !== 'deny-access' && !(r.tools === '*' || (Array.isArray(r.tools) && r.tools.length))) errs.push('Pick at least one tool.');
    if (t === 'deny-access') {
      // No tools picked means every write tool; a list limits the rule to those tools.
      if (!(Array.isArray(r.tools) && r.tools.length)) delete r.tools;
      r.access = r.access || 'write';
    }
    if (needArg && !String(r.argPath || '').trim()) errs.push('Name the value in the call, for example amount.');
    if ((t === 'arg-max' || t === 'approval-above') && (r.max === '' || r.max == null || !Number.isFinite(Number(r.max)))) errs.push('Add a limit.');
    if (t === 'arg-min' && (r.min === '' || r.min == null || !Number.isFinite(Number(r.min)))) errs.push('Add a limit.');
    if (t === 'requires-before' && !String(r.before || '').trim()) errs.push('Name the tool that must come first.');
    if (t === 'approval-above' && !String(r.approvalTool || '').trim()) errs.push('Name the approval tool.');
    if (t === 'arg-in' && !(r.values || EMPTY).length) errs.push('List the allowed values.');
    if (t === 'arg-not-match') {
      const pe = !String(r.pattern || '').trim() ? 'Add a pattern.' : patternError(r.pattern, '');
      if (pe) errs.push(pe);
    }
    if (t === 'arg-equals' && !(r.source && (r.source.tool || r.source.detail))) errs.push('Say what the value must match.');
    if (r.when && r.when.path && (r.when.equals == null || r.when.equals === '')) errs.push('Pick a value for Only when, or untick it.');
    if (r.when && !r.when.path) delete r.when;
    if (!r.when) delete r.when;
    for (const k of ['max', 'min']) if (r[k] !== undefined && r[k] !== '') r[k] = Number(r[k]);
    if (errs.length) { setErrors(errs); return; }
    onSave(r);
  };

  const whenKey = draft.when ? String(draft.when.path || '').replace(/^metadata\./, '') : '';
  return html`<${Modal} open=${true} title=${rule && rule.id ? 'Edit rule' : 'Add a rule'} onClose=${onClose} class="checks-rule-modal"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} kind="primary" onClick=${save}>Save rule<//>`}>
    <div class="stack">
      <label class="field">
        <span class="label">Kind of rule</span>
        <select class="select" value=${t} onChange=${(e) => set({ ...blankRule(e.currentTarget.value), id: draft.id, why: draft.why, tools: draft.tools, when: draft.when })}>
          ${RULE_TYPES.map((x) => html`<option key=${x} value=${x}>${ruleLabel(x)}</option>`)}
        </select>
      </label>
      ${t !== 'deny-access' && html`<${ToolPicker} value=${draft.tools} names=${names} allowAll=${STAR_OK.has(t)} onChange=${(v) => set({ tools: v })} />`}
      ${t === 'deny-access' && html`<p class="hint">Blocks tools marked Write in the tool list: all of them, or only the ones you pick. Add "Only when" below to limit it, for example to text messages.</p>`}
      ${t === 'deny-access' && html`<${ToolPicker} value=${Array.isArray(draft.tools) ? draft.tools : EMPTY} names=${names} allowAll=${false}
        emptyMeans="the rule covers all write tools" onChange=${(v) => set({ tools: v })} />`}
      ${t === 'requires-before' && html`<label class="field"><span class="label">Tool that must come first</span>
        <input class="input mono" list="checks-rule-tools" value=${draft.before || ''} onInput=${(e) => set({ before: e.currentTarget.value.trim() })} spellcheck="false" />${toolOptions('checks-rule-tools')}</label>`}
      ${needArg && html`<label class="field"><span class="label">Which value in the call</span>
        <input class="input mono" list="checks-rule-args" value=${draft.argPath || ''} onInput=${(e) => set({ argPath: e.currentTarget.value.trim() })} placeholder="amount" spellcheck="false" />${argList}
        <span class="hint">The name of the detail passed to the tool, such as amount or account_id. Use dots for nested values, like change.percent.</span></label>`}
      ${(t === 'arg-max' || t === 'approval-above') && html`<label class="field"><span class="label">${t === 'arg-max' ? 'Highest allowed' : 'Needs approval above'}</span>
        <input class="input num" type="number" value=${draft.max ?? ''} onInput=${(e) => set({ max: e.currentTarget.value })} /></label>`}
      ${t === 'arg-min' && html`<label class="field"><span class="label">Lowest allowed</span>
        <input class="input num" type="number" value=${draft.min ?? ''} onInput=${(e) => set({ min: e.currentTarget.value })} /></label>`}
      ${t === 'approval-above' && html`<label class="field"><span class="label">Approval tool</span>
        <input class="input mono" list="checks-rule-tools2" value=${draft.approvalTool || ''} onInput=${(e) => set({ approvalTool: e.currentTarget.value.trim() })} spellcheck="false" />${toolOptions('checks-rule-tools2')}</label>`}
      ${t === 'arg-in' && html`<label class="field"><span class="label">Allowed values, separated by commas</span>
        <input class="input" value=${(draft.values || EMPTY).join(', ')} onInput=${(e) => set({ values: e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>`}
      ${t === 'arg-not-match' && html`<label class="field"><span class="label">Pattern that must never appear</span>
        <input class="input mono" value=${draft.pattern || ''} onInput=${(e) => set({ pattern: e.currentTarget.value })} spellcheck="false" /></label>`}
      ${t === 'arg-not-match' && html`<label class="field"><span class="label">Which value in the call (optional)</span>
        <input class="input mono" list="checks-rule-args" value=${draft.argPath || ''} onInput=${(e) => set({ argPath: e.currentTarget.value.trim() || undefined })} spellcheck="false" />${argList}
        <span class="hint">Leave it empty to check every detail of the call. Use dots for nested values, like change.percent.</span></label>`}
      ${t === 'arg-equals' && html`<div class="stack">
        <${Segmented} label="Compare with" value=${sourceKind}
          onChange=${(v) => set({ source: v === 'detail' ? { detail: 'metadata.' + ((details.find((d) => /account/i.test(d.key)) || details[0] || { key: 'account_id' }).key) } : { tool: names[0] || '', path: draft.argPath || '' } })}
          options=${[{ value: 'tool', label: 'A tool result' }, { value: 'detail', label: 'A trace detail' }]} />
        ${sourceKind === 'tool'
          ? html`<div class="checks-form-grid">
              <label class="field"><span class="label">Tool</span><input class="input mono" list="checks-rule-tools3" value=${source.tool || ''}
                onInput=${(e) => set({ source: { ...source, tool: e.currentTarget.value.trim() } })} spellcheck="false" />${toolOptions('checks-rule-tools3')}</label>
              <label class="field"><span class="label">Value in its result</span><input class="input mono" value=${source.path || ''}
                onInput=${(e) => set({ source: { ...source, path: e.currentTarget.value.trim() } })} placeholder="account_id" spellcheck="false" /></label>
            </div>`
          : html`<label class="field"><span class="label">Trace detail</span>
              <select class="select" value=${source.detail || ''} onChange=${(e) => set({ source: { detail: e.currentTarget.value } })}>
                ${details.map((d) => html`<option key=${d.key} value=${'metadata.' + d.key}>${d.key}</option>`)}
              </select></label>`}
      </div>`}
      <label class="field"><span class="label">Why (shown with each violation)</span>
        <input class="input" value=${draft.why || ''} onInput=${(e) => set({ why: e.currentTarget.value })} placeholder="Credits over $50 need a supervisor." /></label>
      <div class="checks-when">
        <label class="check-row small"><input type="checkbox" checked=${!!draft.when}
          onChange=${(e) => set({ when: e.currentTarget.checked ? { path: 'metadata.' + ((details.find((d) => d.key === 'channel') || details[0] || { key: 'channel' }).key), equals: '' } : undefined })} /> Only when</label>
        ${draft.when && html`<select class="select checks-inline-select" aria-label="Detail" value=${whenKey}
            onChange=${(e) => set({ when: { path: 'metadata.' + e.currentTarget.value, equals: '' } })}>
            ${details.map((d) => html`<option key=${d.key} value=${d.key}>${d.key}</option>`)}
          </select>
          <span class="small soft">is</span>
          <select class="select checks-inline-select" aria-label="Value" value=${String(draft.when.equals ?? '')}
            onChange=${(e) => set({ when: { ...draft.when, equals: e.currentTarget.value } })}>
            <option value="">Pick a value</option>
            ${draft.when.equals != null && draft.when.equals !== '' && !((details.find((d) => d.key === whenKey) || { values: [] }).values).some((v) => v.value === String(draft.when.equals))
              && html`<option value=${String(draft.when.equals)}>${String(draft.when.equals)}</option>`}
            ${((details.find((d) => d.key === whenKey) || { values: [] }).values).map((v) => html`<option key=${v.value} value=${v.value}>${v.value}</option>`)}
          </select>`}
      </div>
      ${errors.length > 0 && html`<ul class="checks-problems" role="alert">${errors.map((e, i) => html`<li key=${i} class="error-text">${e}</li>`)}</ul>`}
    </div>
  <//>`;
}

function uniqueRuleId(policy, type) {
  const ids = new Set((policy.rules || EMPTY).map((r) => r.id));
  let i = 1;
  while (ids.has(`${type}-${i}`)) i++;
  return `${type}-${i}`;
}

function MaxInput({ checkId, name, value }) {
  const d = useDraft(checkId + '|max|' + name, value == null ? '' : String(value), (text) => setPolicyOn(checkId, (pol) => {
    const cur = pol.tools?.[name] || {};
    const num = text.trim() === '' ? undefined : Math.max(0, Math.round(Number(text)));
    if (num !== undefined && !Number.isFinite(num)) return pol;
    if (num === cur.maxPerTrace) return pol;
    const nextTool = { ...cur, maxPerTrace: num };
    if (num === undefined) delete nextTool.maxPerTrace;
    return { ...pol, tools: { ...pol.tools, [name]: nextTool } };
  }, 'tool limit'));
  return html`<input class="input num checks-max-input" type="number" min="0" inputmode="numeric" aria-label=${'Most calls per conversation for ' + name}
    value=${d.value} onInput=${d.onInput} onFocus=${d.onFocus} onBlur=${d.onBlur} placeholder="No limit" />`;
}

function ToolTable({ check, policy, inventory }) {
  const listed = policy.tools || {};
  const names = [...new Set([...inventory.list.map((t) => t.name), ...Object.keys(listed)])];
  const calls = new Map(inventory.list.map((t) => [t.name, t]));
  const setTool = (name, patch) => setPolicyOn(check.id, (pol) => ({ ...pol, tools: { ...(pol.tools || {}), [name]: { ...(pol.tools?.[name] || {}), ...patch } } }), 'tool access');
  const removeTool = (name) => setPolicyOn(check.id, (pol) => {
    const next = { ...(pol.tools || {}) };
    delete next[name];
    return { ...pol, tools: next };
  }, 'remove tool');
  return html`<div class="stack">
    <${Switch} checked=${!!policy.onlyListedTools} label="Only listed tools"
      hint="When on, a call to any tool not listed here breaks the policy."
      onChange=${(v) => setPolicyOn(check.id, (pol) => ({ ...pol, onlyListedTools: v }), 'only listed tools')} />
    <div class="table-wrap">
      <table class="table checks-tooltable">
        <thead><tr>
          <th scope="col">Tool</th>
          <th scope="col" class="num">Calls</th>
          <th scope="col">Reads or changes</th>
          <th scope="col">Ask before acting</th>
          <th scope="col">Most per conversation</th>
        </tr></thead>
        <tbody>
          ${names.map((name) => {
            const t = listed[name];
            const seen = calls.get(name);
            return html`<tr key=${name}>
              <td><span class="mono checks-toolname">${name}</span>
                ${!seen && html`<span class="checks-sub">Not seen in your traces</span>`}
                ${!t && policy.onlyListedTools && html`<span class="checks-sub checks-bad-text"><${Icon} name="warning" size=${13} />Not listed, so every call breaks the policy</span>`}
              </td>
              <td class="num">${seen ? formatCount(seen.calls) : 0}</td>
              <td>${t
                ? html`<${Segmented} label=${'Access for ' + name} value=${t.access || 'read'} onChange=${(v) => setTool(name, { access: v })}
                    options=${[{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }]} />`
                : html`<${Button} size="sm" icon="plus" onClick=${() => setTool(name, seen && seen.guess === 'write' ? { access: 'write', confirm: true } : { access: 'read' })}>Add to the list<//>`}</td>
              <td>${t && html`<label class="check-row"><input type="checkbox" checked=${!!t.confirm} aria-label=${'Ask before acting with ' + name}
                onChange=${(e) => setTool(name, { confirm: e.currentTarget.checked })} /><span class="small soft nowrap">Needs a yes</span></label>`}</td>
              <td><div class="row checks-nowrap">${t && html`<${MaxInput} checkId=${check.id} name=${name} value=${t.maxPerTrace} />`}
                ${t && !seen && html`<${Button} kind="ghost" size="sm" icon="trash" title=${'Remove ' + name + ' from the list'} onClick=${() => removeTool(name)} />`}</div></td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    <p class="hint">Read or Write starts as a guess from each tool's name: names that start with get, list, search, lookup, find, read, or verify read. Check each one.</p>
  </div>`;
}

// The first line that is not a valid pattern (1-based), or 0 when every line works.
function badPatternLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      new RegExp(line, 'i');
    } catch {
      return i + 1;
    }
  }
  return 0;
}

function ConfirmWords({ check, policy }) {
  // A list with a broken pattern is not saved: the check keeps the last list that works, and the
  // reader's text stays on screen with the line to fix.
  const [broken, setBroken] = useState(null); // { text, line }
  const d = useDraft(check.id + '|confirm', (policy.confirmationPatterns || EMPTY).join('\n'), (text) => {
    if (badPatternLine(text)) return;
    setPolicyOn(check.id, (pol) => ({ ...pol, confirmationPatterns: text.split('\n').map((s) => s.trim()).filter(Boolean) }), 'confirmation words');
  });
  const onInput = (e) => {
    d.onInput(e);
    if (broken) setBroken(null);
  };
  const onBlur = (e) => {
    const text = e.currentTarget.value;
    d.onBlur(e);
    const line = badPatternLine(text);
    setBroken(line ? { text, line } : null);
  };
  return html`<label class="field">
    <span class="label">What counts as a yes (one pattern per line)</span>
    <textarea class="textarea mono checks-confirm-area" rows="4" value=${broken ? broken.text : d.value} onInput=${onInput} onFocus=${d.onFocus} onBlur=${onBlur}
      spellcheck="false" aria-invalid=${broken ? 'true' : undefined}></textarea>
    ${broken
      ? html`<span class="error-text" role="alert">Line ${broken.line} is not a valid pattern. The check keeps using the last list that worked until you fix it.</span>`
      : html`<span class="hint">Used by "Ask before acting". Capital letters do not matter.</span>`}
  </label>`;
}

function FileEditor({ value, onApply, validator, hint }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [errors, setErrors] = useState([]);
  const current = JSON.stringify(value, null, 2);
  const dirty = text !== current;
  const apply = () => {
    const parsed = parseJsonText(text);
    if (parsed.error) { setErrors([parsed.error]); return; }
    const v = validateWith(validator, parsed.value);
    if (!v.ok) { setErrors(v.errors.length ? v.errors : ['This file has problems.']); return; }
    setErrors([]);
    onApply(parsed.value);
    toast('Changes applied.', { tone: 'good' });
  };
  return html`<div class="stack">
    <p class="hint">${hint}</p>
    <textarea class="textarea mono checks-code-area" rows="18" value=${text} onInput=${(e) => { setText(e.currentTarget.value); setErrors([]); }}
      spellcheck="false" aria-label="File contents"></textarea>
    ${errors.length > 0 && html`<ul class="checks-problems" role="alert">${errors.map((e, i) => html`<li key=${i} class="error-text">${e}</li>`)}</ul>`}
    <div class="row">
      <${Button} kind="primary" size="sm" disabled=${!dirty} onClick=${apply}>Apply changes<//>
      <${Button} kind="ghost" size="sm" disabled=${!dirty} onClick=${() => { setText(current); setErrors([]); }}>Undo my edits<//>
      <${CopyButton} text=${() => text} label="Copy file" />
    </div>
  </div>`;
}

function violationGroups(data) {
  const groups = new Map();
  if (!data) return [];
  for (const [id, r] of data.results) {
    for (const v of r.violations || EMPTY) {
      // Rules made from the tools list give each tool its own why, so they group per tool.
      const perTool = v.ruleId === 'confirm' || v.ruleId === 'max-per-trace';
      const key = perTool ? `${v.ruleId}:${v.tool}` : v.ruleId;
      const label = v.label || ruleLabel(v.ruleType);
      const g = groups.get(key) || { key, ruleId: v.ruleId, label: perTool ? `${label} (${v.tool})` : label, why: v.why || '', traces: new Map() };
      const list = g.traces.get(id) || [];
      list.push(v);
      g.traces.set(id, list);
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.traces.size - a.traces.size || byText(a.label, b.label));
}

function ViolationGroups({ project, data }) {
  const groups = violationGroups(data);
  const norm = lib.normalizeAll(project);
  if (!groups.length) return data && data.total && !data.error ? html`<p class="checks-empty-note"><${Icon} name="check" />No trace breaks the policy.</p>` : null;
  return html`<div class="checks-violations">
    <h5 class="checks-h5">Violations by rule</h5>
    ${groups.map((g, gi) => html`<details key=${g.key} class="checks-vgroup" open=${gi < 2}>
      <summary>
        <span class="checks-vgroup-name">${g.label}</span>
        <span class="checks-vgroup-count num">${plural(g.traces.size, 'trace')}</span>
        ${g.why && html`<span class="checks-vgroup-why">${g.why}</span>`}
      </summary>
      <ul class="checks-traces">
        ${[...g.traces.entries()].map(([id, list]) => html`<li key=${id}>
          <button type="button" class="checks-trace" onClick=${() => openInReview(id, {}, list[0].stepId)}>
            <span class="checks-trace-title">${norm.get(id)?.title || id}</span>
            <span class="checks-trace-id mono">${id}</span>
            ${list.map((v, i) => html`<span key=${i} class="checks-trace-detail">${v.fact || v.message}</span>`)}
          </button>
        </li>`)}
      </ul>
    </details>`)}
  </div>`;
}

function PolicyEditor({ project, check, openLabels }) {
  const policy = policyOf(check);
  const inventory = toolInventory(project);
  const details = detailOptions(project);
  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(null); // { index }, -1 for a new rule
  const run = useCheckRun(project, check);
  const a = useMemo(() => runAgreement(project, check, run.data), [run.data, project.labels, project.reviews, project.modes, check.modeId]);
  const names = [...new Set([...inventory.list.map((t) => t.name), ...Object.keys(policy.tools || {})])];
  const total = run.data ? run.data.total : 0;

  const saveRule = (rule) => {
    const index = editing.index;
    setPolicyOn(check.id, (pol) => {
      const rules = (pol.rules || EMPTY).slice();
      const r = { ...rule, id: rule.id || uniqueRuleId(pol, rule.type) };
      if (index >= 0) rules[index] = r;
      else rules.push(r);
      return { ...pol, rules };
    }, index >= 0 ? 'edit rule' : 'add rule');
    setEditing(null);
  };
  const removeRule = (index) => {
    const label = ruleLabel(policy.rules[index].type);
    setPolicyOn(check.id, (pol) => ({ ...pol, rules: pol.rules.filter((_, i) => i !== index) }), 'remove rule');
    toast(`Removed the rule "${label}".`);
  };

  return html`<div class="checks-body">
    <section class="checks-section" aria-labelledby=${check.id + '-rules'}>
      <div class="row-between">
        <h4 id=${check.id + '-rules'} class="checks-h4">Rules${policy.name ? html` <span class="muted checks-h4-sub">${policy.name}</span>` : ''}</h4>
        <${Segmented} label="How to show the policy" value=${view} onChange=${setView}
          options=${[{ value: 'list', label: 'Readable list' }, { value: 'file', label: 'Policy file' }]} />
      </div>
      ${view === 'list'
        ? html`<${PolicyRules} policy=${policy} ruleIds=${check.ruleIds} onEdit=${(i) => setEditing({ index: i })} onRemove=${removeRule} onAdd=${() => setEditing({ index: -1 })} />`
        : html`<${FileEditor} key=${check.id} value=${policy} validator="validatePolicy"
            hint="The same policy as a file (format pmstack.policy/1). Your engineers can use this file as a guardrail before a tool call runs."
            onApply=${(next) => setPolicyOn(check.id, () => next, 'policy file')} />`}
    </section>

    <section class="checks-section" aria-labelledby=${check.id + '-tools'}>
      <h4 id=${check.id + '-tools'} class="checks-h4">Tools in your traces</h4>
      <${ToolTable} check=${check} policy=${policy} inventory=${inventory} />
      <${ConfirmWords} check=${check} policy=${policy} />
    </section>

    <section class="checks-results" aria-label="Results">
      <${ResultsHead} project=${project} run=${run} headline=${(d) => {
        // Every trace errored: the policy itself cannot run, so say why instead of "0 of N".
        if (d.total && d.error === d.total) {
          const first = d.results.values().next().value;
          const why = first && first.detail ? String(first.detail).replace(/^The policy has a problem: /, '') : 'it has a problem';
          return `The policy can't run: ${why}`;
        }
        return `Breaks the policy in ${formatCount(d.fail)} of ${plural(total, 'trace')}`;
      }} />
      <${ViolationGroups} project=${project} data=${run.data} />
      <${AgreementPanel} project=${project} check=${check} a=${a} openLabels=${openLabels}
        detailOf=${(id) => run.data?.results.get(id)?.detail || ''} />
      <${ErrorList} project=${project} data=${run.data} />
    </section>

    ${editing && html`<${RuleModal} key=${String(editing.index)} project=${project}
      rule=${editing.index >= 0 ? policy.rules[editing.index] : null}
      names=${names} details=${details} onSave=${saveRule} onClose=${() => setEditing(null)} />`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Relevance editor (intent map)

const INTENT_ROWS = [
  { key: 'expect', label: 'Expected', hint: 'Every request of this kind needs these.' },
  { key: 'allow', label: 'Also allowed', hint: 'Fine to use, not required.' },
  { key: 'never', label: 'Never', hint: 'This request must never use these.' },
];

function setIntentsOn(checkId, fn, reason = 'edit intents') {
  updateProject((p) => {
    const c = findCheck(p, checkId);
    if (!c) return p;
    const cur = c.intents || { format: 'pmstack.intents/1', intentFrom: 'metadata.intent', intents: [] };
    const next = fn(cur);
    if (!next || next === cur) return p;
    return lib.updateCheck(p, checkId, { intents: next });
  }, reason);
}

function IntentLabel({ checkId, intent, index }) {
  const d = useDraft(checkId + '|intent|' + intent.id, intent.label || '', (text) => setIntentsOn(checkId, (m) => ({
    ...m, intents: m.intents.map((x, i) => (i === index ? { ...x, label: text } : x)),
  }), 'intent label'));
  return html`<input class="checks-intent-label" type="text" aria-label="Intent name" value=${d.value}
    onInput=${d.onInput} onFocus=${d.onFocus} onBlur=${d.onBlur} />`;
}

function IntentCard({ checkId, intent, index, names, count }) {
  const move = (tool, to) => setIntentsOn(checkId, (m) => ({
    ...m,
    intents: m.intents.map((x, i) => {
      if (i !== index) return x;
      const next = { ...x };
      for (const r of INTENT_ROWS) next[r.key] = (x[r.key] || EMPTY).filter((t) => t !== tool);
      if (to) next[to] = [...next[to], tool];
      return next;
    }),
  }), 'intent tools');
  const remove = () => setIntentsOn(checkId, (m) => ({ ...m, intents: m.intents.filter((_, i) => i !== index) }), 'remove intent');
  const used = new Set(INTENT_ROWS.flatMap((r) => intent[r.key] || EMPTY));
  return html`<article class="checks-intent">
    <header class="checks-intent-head">
      <div class="grow">
        <${IntentLabel} checkId=${checkId} intent=${intent} index=${index} />
        <p class="small muted"><span class="mono">${intent.id}</span>, ${count ? plural(count, 'trace') : 'no traces yet'}${intent.example ? html`. <span class="checks-intent-example">"${intent.example}"</span>` : ''}</p>
      </div>
      <${Button} kind="ghost" size="sm" icon="trash" title=${'Remove the intent ' + (intent.label || intent.id)} onClick=${remove} />
    </header>
    <div class="checks-intent-rows">
      ${INTENT_ROWS.map((r) => html`<div key=${r.key} class=${'checks-intent-row is-' + r.key}>
        <span class="checks-intent-rowlabel" title=${r.hint}>${r.label}</span>
        <div class="checks-intent-tools">
          ${(intent[r.key] || EMPTY).map((t) => html`<button key=${t} type="button" class=${'chip checks-tool-chip is-' + r.key}
            aria-label=${`Remove ${t} from ${r.label}`} title=${`Remove ${t} from ${r.label}`} onClick=${() => move(t, null)}>
            <span class="mono">${t}</span><${Icon} name="x" size=${12} />
          </button>`)}
          <${Menu} icon="plus" title=${'Add a tool to ' + r.label} kind="ghost" size="sm"
            items=${names.length ? names.map((n) => ({ label: n, hint: used.has(n) && !(intent[r.key] || EMPTY).includes(n) ? 'Moves it here' : '', selected: (intent[r.key] || EMPTY).includes(n), onClick: () => move(n, r.key) })) : [{ label: 'No tools found in your traces', disabled: true }]} />
        </div>
      </div>`)}
    </div>
  </article>`;
}

function RelevanceEditor({ project, check, openLabels, onFlow }) {
  const exp = project.experience || {};
  const who = lib.userWord(exp);
  const map = check.intents || { format: 'pmstack.intents/1', intentFrom: 'metadata.intent', intents: [] };
  const inventory = toolInventory(project);
  const details = detailOptions(project);
  const [view, setView] = useState('list');
  const [open, setOpen] = useState(null);
  const run = useCheckRun(project, check);
  const a = useMemo(() => runAgreement(project, check, run.data), [run.data, project.labels, project.reviews, project.modes, check.modeId]);
  const stats = useMemo(() => {
    const s = { missing: [], unexpected: [], forbidden: [], noIntent: [], unmapped: [] };
    if (!run.data) return s;
    for (const [id, r] of run.data.results) {
      const rel = r.relevance;
      if (!rel) continue;
      if (rel.intent == null || rel.intent === '') { s.noIntent.push(id); continue; }
      if (rel.applies === false) { s.unmapped.push(id); continue; }
      if (rel.missing?.length) s.missing.push(id);
      if (rel.unexpected?.length) s.unexpected.push(id);
      if (rel.forbidden?.length) s.forbidden.push(id);
    }
    return s;
  }, [run.data]);
  const total = run.data ? run.data.total : 0;
  const key = String(map.intentFrom || '').replace(/^metadata\./, '');
  const values = (details.find((d) => d.key === key) || { values: [] }).values;
  const known = new Set((map.intents || EMPTY).map((i) => i.id));
  const withValue = values.reduce((n, v) => n + v.count, 0);
  const missingValues = values.filter((v) => !known.has(v.value));
  const counts = new Map(values.map((v) => [v.value, v.count]));
  const names = inventory.list.map((t) => t.name);

  const addIntent = (id = null) => setIntentsOn(check.id, (m) => {
    const ids = new Set((m.intents || EMPTY).map((i) => i.id));
    let nid = id || 'new-intent';
    let k = 2;
    while (ids.has(nid)) nid = (id || 'new-intent') + '-' + k++;
    const label = id ? id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'New intent';
    return { ...m, intents: [...(m.intents || EMPTY), { id: nid, label, expect: [], allow: [], never: [] }] };
  }, 'add intent');

  const tiles = [
    { id: 'missing', label: 'Skipped a needed tool', ids: stats.missing },
    { id: 'unexpected', label: "Called a tool the request didn't need", ids: stats.unexpected },
    { id: 'forbidden', label: 'Called a tool this request must never use', ids: stats.forbidden },
    { id: 'noIntent', label: 'No intent on this trace', ids: stats.noIntent },
  ];
  if (stats.unmapped.length) tiles.push({ id: 'unmapped', label: 'An intent the map does not list yet', ids: stats.unmapped });
  const openTile = tiles.find((t) => t.id === open);

  return html`<div class="checks-body">
    <section class="checks-section" aria-labelledby=${check.id + '-key'}>
      <h4 id=${check.id + '-key'} class="checks-h4">Which detail says what the ${who} wanted?</h4>
      <div class="row">
        <select class="select checks-inline-select" aria-label="Intent detail" value=${key}
          onChange=${(e) => setIntentsOn(check.id, (m) => ({ ...m, intentFrom: 'metadata.' + e.currentTarget.value }), 'intent detail')}>
          ${!details.some((d) => d.key === key) && html`<option value=${key}>${key || 'Pick a detail'}</option>`}
          ${details.map((d) => html`<option key=${d.key} value=${d.key}>${d.key}</option>`)}
        </select>
        <span class="small soft num">${formatCount(withValue)} of ${plural(inventory.total, 'trace')} have a value.</span>
      </div>
      ${missingValues.length > 0 && html`<div class="checks-missing-values">
        <span class="small soft">Values with no intent yet:</span>
        ${missingValues.map((v) => html`<${Button} key=${v.value} kind="secondary" size="sm" icon="plus" onClick=${() => addIntent(v.value)}>${v.value} (${v.count})<//>`)}
      </div>`}
    </section>

    <section class="checks-section" aria-labelledby=${check.id + '-intents'}>
      <div class="row-between">
        <h4 id=${check.id + '-intents'} class="checks-h4">Intents <span class="num muted">(${(map.intents || EMPTY).length})</span></h4>
        <${Segmented} label="How to show the intent map" value=${view} onChange=${setView}
          options=${[{ value: 'list', label: 'Readable list' }, { value: 'file', label: 'Intent map file' }]} />
      </div>
      ${view === 'list'
        ? html`<div class="stack">
            <p class="hint">Click a tool to remove it, or use + to add one. A tool sits in one row per intent.</p>
            <div class="checks-intents">
              ${(map.intents || EMPTY).map((intent, i) => html`<${IntentCard} key=${intent.id} checkId=${check.id} intent=${intent} index=${i} names=${names} count=${counts.get(intent.id) || 0} />`)}
            </div>
            <div><${Button} kind="secondary" size="sm" icon="plus" onClick=${() => addIntent()}>Add an intent<//></div>
          </div>`
        : html`<${FileEditor} key=${check.id} value=${map} validator="validateIntents"
            hint="The same intent map as a file (format pmstack.intents/1)."
            onApply=${(next) => setIntentsOn(check.id, () => next, 'intent map file')} />`}
    </section>

    <section class="checks-results" aria-label="Results">
      <${ResultsHead} project=${project} run=${run} headline=${(d) => `Fails ${formatCount(d.fail)} of ${plural(total, 'trace')}`} />
      ${run.data && html`<div class="checks-tiles">
        ${tiles.map((t) => html`<button key=${t.id} type="button" class=${classes('checks-tile', open === t.id && 'is-open', (t.id === 'noIntent' || t.id === 'unmapped') && 'is-neutral', t.ids.length > 0 && t.id !== 'noIntent' && t.id !== 'unmapped' && 'is-hit')}
          aria-expanded=${open === t.id ? 'true' : 'false'} disabled=${!t.ids.length} onClick=${() => setOpen(open === t.id ? null : t.id)}>
          <span class="checks-tile-n num">${t.ids.length}</span>
          <span class="checks-tile-label">${t.label}</span>
        </button>`)}
      </div>`}
      ${openTile && html`<${TraceLinks} project=${project} ids=${openTile.ids} limit=${10}
        detailOf=${(id) => run.data?.results.get(id)?.detail || ''} />`}
      ${stats.noIntent.length > 0 && html`<div class="banner"><${Icon} name="judge" />
        <p>${plural(stats.noIntent.length, 'trace has', 'traces have')} no intent, so this check passes them without looking. The AI judge template can judge them instead.</p>
        <${Button} size="sm" onClick=${() => onFlow({ kind: 'relevance-judge', modeId: check.modeId })}>Use the AI judge template<//>
      </div>`}
      <${AgreementPanel} project=${project} check=${check} a=${a} openLabels=${openLabels}
        detailOf=${(id) => run.data?.results.get(id)?.detail || ''} />
      <${ErrorList} project=${project} data=${run.data} />
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// AI judge builder

const INPUT_OPTIONS = [
  { id: 'customer', label: 'What the {userLabel} and the AI said' },
  { id: 'tools', label: 'Tool calls and their results' },
  { id: 'retrieval', label: 'Documents it looked up' },
  { id: 'metadata', label: 'Details, such as channel' },
  { id: 'context', label: 'What the AI was given' },
  { id: 'system', label: "The AI's instructions" },
];

function Step({ n, title, aside, children, id }) {
  return html`<section class="checks-step" aria-labelledby=${id}>
    <div class="checks-step-num" aria-hidden="true">${n}</div>
    <div class="checks-step-body">
      <header class="checks-step-head">
        <h4 id=${id} class="checks-h4"><span class="sr-only">Step ${n}: </span>${title}</h4>
        ${aside}
      </header>
      ${children}
    </div>
  </section>`;
}

function LabelBar({ label, value }) {
  const w = Math.min(100, (value / AIM) * 100);
  return html`<div class="checks-labelbar">
    <div class="row-between"><span class="small">${label}</span><span class="small num soft">${value} of about ${AIM}</span></div>
    <div class="checks-labelbar-track" aria-hidden="true">
      <span class=${classes('checks-labelbar-fill', value >= GATE && 'is-ready')} style=${{ width: w + '%' }}></span>
      <span class="checks-labelbar-gate" style=${{ left: (GATE / AIM) * 100 + '%' }}><span class="checks-labelbar-gate-text">20</span></span>
    </div>
  </div>`;
}

function batchPools(project, check, revealed) {
  const tuning = [];
  const test = [];
  const unlabeled = [];
  const modeId = check.modeId;
  for (const id of lib.normalizeAll(project).keys()) {
    const label = lib.humanLabel(project, id, modeId);
    if (label == null) { unlabeled.push(id); continue; }
    const s = lib.splitOf(project, modeId, id);
    if (s === 'tuning') tuning.push(id);
    else if (s === 'test') test.push(id);
  }
  return revealed
    ? [{ id: 'test', label: 'final test', ids: test }, { id: 'unlabeled', label: 'traces you have not labeled', ids: unlabeled }, { id: 'tuning', label: 'tuning set', ids: tuning }]
    : [{ id: 'tuning', label: 'tuning set', ids: tuning }, { id: 'unlabeled', label: 'traces you have not labeled', ids: unlabeled }];
}

/** Record an agreement round; a newer round with the same prompt and model replaces the last one. */
function upsertRun(p, checkId, split) {
  const q = lib.recordRun(p, checkId, split);
  if (q === p) return p;
  const runs = findCheck(q, checkId).runs || EMPTY;
  const last = runs[runs.length - 1];
  const prev = runs[runs.length - 2];
  if (prev && prev.split === last.split && prev.promptHash === last.promptHash && (prev.model ?? null) === (last.model ?? null)) {
    return lib.updateCheck(q, checkId, { runs: [...runs.slice(0, -2), last] });
  }
  return q;
}

function quoteArg(s) {
  return '"' + String(s ?? '').replace(/(["\\$`])/g, '\\$1') + '"';
}

function RunBrowser({ project, check, revealed }) {
  const [rerunSince, setRerunSince] = useState(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const pools = useMemo(() => batchPools(project, check, revealed), [project, check.modeId, revealed]);
  const results = check.results || {};
  const bad = new Set(check.unreadable || EMPTY);
  const tuningIds = new Set((pools.find((p) => p.id === 'tuning') || { ids: [] }).ids);
  const needs = (id) => !results[id] || bad.has(id) || (rerunSince && tuningIds.has(id) && String(results[id].at || '') < rerunSince);
  const all = pools.flatMap((p) => p.ids.map((id) => ({ id, pool: p })));
  const queue = all.filter((x) => needs(x.id));
  const next = queue.slice(0, BATCH);
  const total = all.length;
  const done = total - queue.length;
  const batches = Math.max(1, Math.ceil(total / BATCH));
  const batchNo = Math.min(batches, Math.floor(done / BATCH) + 1);
  const nextPool = next[0] ? next[0].pool : null;

  const add = () => {
    const parsed = lib.parseJudgeResults(text);
    const norm = lib.normalizeAll(project);
    const known = {};
    const errors = parsed.errors.map((e) => (/[.!?]$/.test(e) ? e : e + '.'));
    let unknown = 0;
    for (const [id, r] of Object.entries(parsed.results)) {
      if (norm.has(id)) known[id] = r;
      else unknown++;
    }
    if (unknown) errors.push(`${plural(unknown, 'answer names a trace', 'answers name traces')} not in this project.`);
    const ids = Object.keys(known);
    if (!ids.length) {
      setResult({ added: 0, unreadable: 0, errors: errors.length ? errors : ['No answers found. Paste the whole reply from your AI assistant.'] });
      return;
    }
    updateProject((p) => {
      let q = lib.setJudgeResults(p, check.id, known);
      const tuning = ids.some((id) => lib.splitOf(q, check.modeId, id) === 'tuning');
      const test = ids.some((id) => lib.splitOf(q, check.modeId, id) === 'test');
      if (tuning) q = upsertRun(q, check.id, 'tuning');
      if (test && q.splits?.[check.modeId]?.revealedAt) q = upsertRun(q, check.id, 'test');
      return q;
    }, 'judge answers');
    const unreadable = ids.filter((id) => !known[id].verdict).length;
    setResult({ added: ids.length - unreadable, unreadable, errors });
    setText('');
  };

  return html`<div class="stack">
    ${next.length
      ? html`<ol class="checks-runbox">
          <li class="checks-runbox-step">
            <span class="checks-runbox-n" aria-hidden="true">1</span>
            <div class="stack">
              <p class="small soft">Next: ${plural(next.length, 'trace')} from the ${nextPool.label}. Checked in batches of 10.</p>
              <div><${CopyButton} kind="primary" size="md" text=${() => lib.batchJudgePrompt(project, check.id, next.map((x) => x.id))}
                label=${`Copy the next ${next.length} traces (batch ${batchNo} of ${batches})`} /></div>
              <p class="hint">This prompt includes trace text. Paste it only into an AI assistant your company approves.</p>
            </div>
          </li>
          <li class="checks-runbox-step">
            <span class="checks-runbox-n" aria-hidden="true">2</span>
            <p class="small soft">Paste it into your AI assistant, set to the model you pinned.</p>
          </li>
          <li class="checks-runbox-step">
            <span class="checks-runbox-n" aria-hidden="true">3</span>
            <div class="stack grow">
              <label class="field">
                <span class="label">Paste the answers here</span>
                <textarea class="textarea mono checks-paste" rows="5" value=${text} onInput=${(e) => { setText(e.currentTarget.value); setResult(null); }}
                  placeholder='[{"trace_id": "t-0001", "critique": "...", "result": "Pass"}]' spellcheck="false"></textarea>
              </label>
              <div class="row"><${Button} kind="secondary" disabled=${!text.trim()} onClick=${add}>Add answers<//></div>
            </div>
          </li>
        </ol>`
      : html`<p class="checks-empty-note"><${Icon} name="check" />The judge has answered every trace it can see${revealed ? '' : '. The final test stays closed until you reveal it'}.</p>`}
    ${result && html`<div class=${classes('checks-paste-result', result.errors.length > 0 && 'has-errors')} role="status">
      ${result.added > 0 && html`<p><${Icon} name="check" size=${14} />Added ${plural(result.added, 'answer')}.</p>`}
      ${result.unreadable > 0 && html`<p><${Icon} name="warning" size=${14} />${plural(result.unreadable, 'answer')} could not be read. ${result.unreadable === 1 ? 'That trace goes' : 'Those traces go'} back in the queue.</p>`}
      ${result.errors.map((e, i) => html`<p key=${i} class="error-text">${e}</p>`)}
    </div>`}
    <div class="row">
      <${Button} kind="ghost" size="sm" icon="undo" onClick=${() => { setRerunSince(new Date().toISOString()); setResult(null); }}>Judge the tuning set again<//>
      <span class="hint">After you change the prompt, run the tuning set again to see whether it helped.</span>
    </div>
  </div>`;
}

function RunFolder({ project, check, folder, revealed }) {
  const [picked, setSplit] = useState(revealed ? 'unlabeled' : 'tuning');
  // The final test runs once. After the reveal it can only be finished: final test traces with
  // no answer yet, while the judge is unchanged (the command refuses anything else).
  const final = revealed && lib.checkTestState(project, check.id) === 'current' ? lib.checkAgreement(project, check.id, { split: 'test' }) : null;
  const unanswered = final ? final.missing + final.unreadable.length : 0;
  const offerTest = !revealed || unanswered > 0;
  const split = picked === 'test' && !offerTest ? 'unlabeled' : picked;
  const cli = folder && folder.cliPath ? folder.cliPath : 'bin/pmstack.mjs';
  const projectPath = folder && folder.projectPath ? folder.projectPath : 'pmstack/project.json';
  const extra = split === 'test' ? ' --split test --final' : split === 'unlabeled' ? ' --split unlabeled' : '';
  const cmd = `node ${quoteArg(cli)} judge ${quoteArg(projectPath)} --check ${check.id} --cmd "claude -p --model {model}" --batch 10${extra}`;
  const judged = Object.keys(check.results || {}).length;
  const options = [{ value: 'tuning', label: 'Tuning set' }, { value: 'unlabeled', label: 'Not labeled' }];
  if (offerTest) options.push({ value: 'test', label: revealed ? `Finish the final test (${unanswered} with no answer)` : 'Final test' });
  return html`<div class="stack">
    <${Segmented} label="Which traces" value=${split} onChange=${setSplit} options=${options} />
    ${split === 'test' && !revealed && html`<p class="hint">This runs the final test and reveals it. Do it once, when the tuning numbers look right.</p>`}
    <div class="checks-command">
      <code class="mono">${(cmd.match(/"[^"]*"|\S+/g) || []).map((part, i) => html`${i ? ' ' : ''}<span class=${part.length > 28 ? 'checks-cmd-long' : 'checks-cmd-part'}>${part}</span>`)}</code>
      <${CopyButton} text=${cmd} label="Copy command" />
    </div>
    <p class="hint">Run it in a terminal. {model} becomes the model you pinned. Checked in batches of 10. Answers appear here as the command saves them (${plural(judged, 'answer')} so far).</p>
  </div>`;
}

function Rounds({ runs, promptHash }) {
  if (!runs.length) return html`<p class="small muted">No rounds yet. A round is recorded when answers for the tuning set come in.</p>`;
  return html`<div class="table-wrap">
    <table class="table checks-rounds">
      <caption class="sr-only">Agreement by round</caption>
      <thead><tr>
        <th scope="col">Round</th><th scope="col">Date</th>
        <th scope="col" class="num">Traces</th><th scope="col" class="num">Catches real failures</th><th scope="col" class="num">Agrees on good traces</th><th scope="col">Prompt</th><th scope="col">Model</th>
      </tr></thead>
      <tbody>
        ${runs.map((r, i) => html`<tr key=${i}>
          <td><span class="num">${i + 1}</span><span class="checks-sub">${r.split === 'test' ? 'final test' : 'tuning set'}</span></td>
          <td class="nowrap">${fmtDate(r.at)}</td>
          <td class="num">${r.n}</td>
          <td class="num"><span class=${'checks-rate-text is-' + rateTone(r.catchesFailures)}>${fmtPct(r.catchesFailures)}</span></td>
          <td class="num"><span class=${'checks-rate-text is-' + rateTone(r.agreesOnGood)}>${fmtPct(r.agreesOnGood)}</span></td>
          <td class="small">${r.promptHash === promptHash ? 'Current prompt' : html`<span class="muted">Earlier version</span>`}</td>
          <td class="small mono checks-model-cell">${r.model || html`<span class="muted">Not pinned</span>`}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

function Disagreements({ project, check, a, onRelabel }) {
  const [all, setAll] = useState(false);
  const rows = [...a.falsePasses.map((id) => ({ id, human: 'fail', judge: 'pass' })), ...a.falseFails.map((id) => ({ id, human: 'pass', judge: 'fail' }))];
  if (!rows.length) return html`<p class="small muted">${a.n ? 'No disagreements on the tuning set.' : 'Disagreements show up here once the judge has answered tuning set traces.'}</p>`;
  const norm = lib.normalizeAll(project);
  const shown = all ? rows : rows.slice(0, 4);
  return html`<div class="stack">
    ${shown.map((r) => html`<article key=${r.id} class="checks-disagree">
      <header class="checks-disagree-head">
        <button type="button" class="checks-link" onClick=${() => openInReview(r.id)}>${norm.get(r.id)?.title || r.id}</button>
        <span class="mono small muted">${r.id}</span>
      </header>
      <div class="checks-disagree-cols">
        <div class="checks-disagree-col">
          <p class="checks-disagree-who">The judge said <${Chip} tone=${r.judge === 'pass' ? 'good' : 'bad'}>${r.judge === 'pass' ? 'Good' : 'Problem'}<//></p>
          <p class="checks-disagree-text">${check.results?.[r.id]?.critique || html`<span class="muted">No critique.</span>`}</p>
        </div>
        <div class="checks-disagree-col">
          <p class="checks-disagree-who">You said <${Chip} tone=${r.human === 'pass' ? 'good' : 'bad'}>${r.human === 'pass' ? 'Good' : 'Problem'}<//></p>
          <p class="checks-disagree-text">${yourReason(project, check.modeId, r.id) || html`<span class="muted">No note.</span>`}</p>
          <div><${Button} kind="ghost" size="sm" icon="check" onClick=${() => onRelabel([r.id])}>Check your label<//></div>
        </div>
      </div>
    </article>`)}
    ${rows.length > 4 && html`<div><${Button} kind="ghost" size="sm" onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${rows.length} disagreements`}<//></div>`}
  </div>`;
}

function RangeBar({ flagged, estimate, low, high }) {
  const top = Math.max(flagged ?? 0, estimate ?? 0, high ?? 0);
  const max = Math.min(1, Math.max(0.3, Math.ceil(top * 10 + 1) / 10));
  const W = 560;
  const x = (v) => 14 + (v / max) * (W - 28);
  const ticks = [0, max / 2, max];
  // Keep a label inside the drawing near either end.
  const at = (v) => {
    const px = x(v);
    if (px < 90) return { x: Math.max(4, px - 8), anchor: 'start' };
    if (px > W - 90) return { x: Math.min(W - 4, px + 8), anchor: 'end' };
    return { x: px, anchor: 'middle' };
  };
  return html`<svg class="checks-range" viewBox=${`0 0 ${W} 88`} role="img"
    aria-label=${`Judge flagged ${fmtPct(flagged)}. Likely true failure rate ${fmtPct(estimate)}${low != null ? `, 95% range ${fmtPct(low)} to ${fmtPct(high)}` : ''}.`}>
    <line class="checks-range-axis" x1="14" x2=${W - 14} y1="44" y2="44" />
    ${ticks.map((t) => html`<g key=${String(t)}><line class="checks-range-tick" x1=${x(t)} x2=${x(t)} y1="40" y2="48" />
      <text class="checks-range-ticktext" x=${x(t)} y="84" text-anchor="middle">${fmtPct(t)}</text></g>`)}
    ${low != null && high != null && html`<rect class="checks-range-band" x=${x(low)} y="37" width=${Math.max(2, x(high) - x(low))} height="14" rx="7" />`}
    ${flagged != null && html`<g><circle class="checks-range-flagged" cx=${x(flagged)} cy="44" r="6" />
      <text class="checks-range-label is-muted" x=${at(flagged).x} y="68" text-anchor=${at(flagged).anchor}>Judge flagged ${fmtPct(flagged)}</text></g>`}
    ${estimate != null && html`<g><circle class="checks-range-estimate" cx=${x(estimate)} cy="44" r="6" />
      <text class="checks-range-label" x=${at(estimate).x} y="24" text-anchor=${at(estimate).anchor}>Likely true rate ${fmtPct(estimate)}</text></g>`}
  </svg>`;
}

function LikelyRate({ project, check, state }) {
  const lr = useMemo(() => (state === 'current' ? lib.likelyFailureRate(project, check.id) : null), [project, check.id, state]);
  const unlabeled = useMemo(() => {
    let n = 0;
    for (const id of lib.normalizeAll(project).keys()) if (lib.humanLabel(project, id, check.modeId) == null) n++;
    return n;
  }, [project, check.modeId]);
  const population = lr ? lr.population : unlabeled;
  let body;
  if (state === 'hidden') {
    body = html`<p class="soft">This needs the final test. Reveal it in step 7, then run the judge on the traces you have not labeled.</p>`;
  } else if (state === 'outdated') {
    body = html`<p class="soft">The final test is out of date. ${lr && lr.reason ? lr.reason : 'Label new traces for a fresh final test.'}</p>`;
  } else if (!lr || !lr.judged) {
    body = html`<p class="soft">Run the judge on the traces you have not labeled (step 5). None of them have an answer yet.</p>`;
  } else if (lr.estimate == null) {
    body = html`<p class="soft">The judge flagged ${fmtPct(lr.flagged)} of them. ${lr.reason || 'Its agreement with your labels is too weak to correct the rate.'}</p>`;
  } else {
    body = html`<div class="stack">
      <p class="checks-likely">The judge flagged ${fmtPct(lr.flagged)} of them. Correcting for its known mistakes, the likely true failure rate is <strong>${fmtPct(lr.estimate)}</strong>${lr.low != null ? html` (95% range: ${fmtPct(lr.low)} to ${fmtPct(lr.high)})` : ''}.</p>
      ${lr.low == null && lr.reason && html`<p class="hint">${lr.reason}</p>`}
      ${lr.judged < population && html`<p class="hint">Based on the ${plural(lr.judged, 'trace')} the judge has answered so far.</p>`}
      <${RangeBar} flagged=${lr.flagged} estimate=${lr.estimate} low=${lr.low} high=${lr.high} />
    </div>`;
  }
  return html`<${Step} n="8" id=${check.id + '-likely'} title=${`Likely true failure rate on the ${plural(population, 'trace')} you have not labeled`}>
    ${body}
  <//>`;
}

function FinalTest({ project, check, state, onRelabel, tuned }) {
  const [confirm, setConfirm] = useState(false);
  const counts = lib.splitCounts(project, check.modeId).test;
  const size = counts.pass + counts.fail;
  const revealedAt = check.test?.revealedAt;
  const since = state !== 'hidden' ? lib.labelsSinceReveal(project, check.modeId).length : 0;
  const a = useMemo(() => (state === 'hidden' ? null : lib.checkAgreement(project, check.id, { split: 'test' })), [project, check.id, state]);
  const reveal = () => {
    updateProject((p) => upsertRun(lib.revealTest(p, check.id), check.id, 'test'), 'reveal final test');
    setConfirm(false);
  };
  const fresh = () => {
    updateProject((p) => lib.startFreshTest(p, check.modeId), 'fresh final test');
    toast('Started a fresh final test from your newer labels.', { tone: 'good' });
  };
  return html`<${Step} n="7" id=${check.id + '-final'} title="Final test">
    ${state === 'hidden'
      ? html`<div class="checks-lock">
          <span class="checks-lock-icon"><${Icon} name="lock" size=${20} /></span>
          <div class="stack grow">
            <p><strong>Final test results are hidden.</strong> ${size
              ? `The final test holds ${plural(size, 'label')} (${counts.fail} Problem, ${counts.pass} Good) that the prompt was never tuned on.`
              : 'Label traces first; 40% of them go to the final test.'}</p>
            <p class="small soft">Keep it closed until the tuning numbers look right. It tells you how good the judge is only once.</p>
            <div class="row">
              <${Button} kind="secondary" icon="lock" disabled=${!size || !tuned} onClick=${() => setConfirm(true)}>Reveal final test results<//>
              ${size > 0 && !tuned && html`<span class="hint">Run the judge on the tuning set first.</span>`}
            </div>
          </div>
        </div>`
      : html`<div class="stack">
          ${state === 'outdated' && html`<p class="banner banner-bad"><${Icon} name="warning" />
            <span><strong>Out of date: the judge or your labels changed after the final test.</strong> These numbers describe an earlier version.</span></p>`}
          <p class="small soft">Revealed ${fmtDate(revealedAt)}. Final test labels are read-only now; new labels join the tuning set.</p>
          ${a && a.missing > 0 && html`<p class="small soft">${plural(a.missing, 'final test trace has', 'final test traces have')} no judge answer yet. Run them in step 5.</p>`}
          ${a && html`<${AgreementPanel} project=${project} check=${check} a=${a} who="Judge" openLabels=${onRelabel}
            empty="The judge has not answered any final test trace yet. Run it in step 5."
            intro=${`Measured once, on ${plural(a.n, 'final test trace')} the prompt was never tuned on.`}
            detailOf=${(id) => check.results?.[id]?.critique || ''} />`}
          ${state === 'outdated' && html`<div class="row">
            <${Button} kind="secondary" disabled=${since < 30} onClick=${fresh}>Start a fresh final test<//>
            <span class="hint">${since >= 30 ? `Uses the ${since} labels you added after the reveal.` : `Needs 30 labels added after the reveal. You have ${since}.`}</span>
          </div>`}
        </div>`}
    <${Modal} open=${confirm} title="Reveal final test results?" onClose=${() => setConfirm(false)}
      footer=${html`<${Button} onClick=${() => setConfirm(false)}>Not yet<//><${Button} kind="primary" onClick=${reveal}>Reveal final test results<//>`}>
      <p>Look at the final test once. If you change the prompt after this, the final test no longer tells you how good the judge is.</p>
    <//>
  <//>`;
}

function PromptSection({ project, check, mode, generated }) {
  const exp = project.experience || {};
  const prompt = useDraft(check.id + '|prompt', check.prompt || generated, (text) => updateProject((p) => lib.updateCheck(p, check.id, { prompt: text, promptEdited: true }), 'judge prompt'));
  const model = useDraft(check.id + '|model', check.model || '', (text) => updateProject((p) => lib.updateCheck(p, check.id, { model: text.trim() }), 'judge model'));
  const examples = useMemo(() => lib.judgeExamples(project, mode.id), [project, mode.id]);
  const ex = { fail: examples.filter((e) => e.label === 'fail').length, pass: examples.filter((e) => e.label === 'pass').length, close: examples.filter((e) => e.closeCall).length };
  const floating = model.value.trim() && !/\d/.test(model.value);
  const tmpl = mode.template && lib.JUDGE_TEMPLATES && lib.JUDGE_TEMPLATES[mode.template];
  return html`<div class="stack">
    <p class="small soft">
      ${examples.length
        ? `Uses ${plural(examples.length, 'example')} from your labels: ${ex.fail} Problem, ${ex.pass} Good${ex.close ? `, ${ex.close} close call` : ''}. Examples come only from the examples set.`
        : lib.withUser('No examples yet. Examples come from labeled traces in the examples set that have a one-line Why.', exp)}
      ${tmpl ? ` It includes the ${mode.template === 'relevance' ? 'relevance' : 'output grounding'} checklist.` : ''}
    </p>
    <textarea class="textarea mono checks-prompt" rows="16" aria-label="Judge prompt" spellcheck="false"
      value=${prompt.value} onInput=${prompt.onInput} onFocus=${prompt.onFocus} onBlur=${prompt.onBlur}></textarea>
    <div class="row">
      ${check.promptEdited && html`<${Chip}><${Icon} name="note" size=${13} />Edited by you<//>`}
      <${Button} kind="ghost" size="sm" icon="undo" disabled=${!check.promptEdited}
        onClick=${() => updateProject((p) => lib.updateCheck(p, check.id, { prompt: generated, promptEdited: false }), 'reset prompt')}>Reset to generated<//>
      <${CopyButton} text=${() => prompt.value} label="Copy prompt" />
    </div>
    <label class="field checks-model">
      <span class="label">Model</span>
      <input class="input mono" type="text" value=${model.value} onInput=${model.onInput} onFocus=${model.onFocus} onBlur=${model.onBlur}
        placeholder="Pin an exact model version, for example claude-haiku-4-5-20251001" spellcheck="false" />
      ${floating
        ? html`<span class="error-text">This looks like a name without a version. Pin an exact version so answers stay comparable.</span>`
        : html`<span class="hint">Changing the model after the final test puts the final test out of date.</span>`}
    </label>
  </div>`;
}

function JudgeBuilder({ project, check, mode, storageKind, folder, openLabels }) {
  const exp = project.experience || {};
  const counts = useMemo(() => labelCounts(project, mode.id), [project.labels, project.reviews, project.modes, mode.id]);
  const [peek, setPeek] = useState(false);
  const [showSplits, setShowSplits] = useState(false);
  const inputs = check.inputs && check.inputs.length ? check.inputs : ['customer', 'tools', 'retrieval', 'metadata', 'context'];

  // New labels get a split as soon as the builder sees them (and a mode without splits gets its first).
  useEffect(() => {
    updateProject((p) => lib.assignSplits(p, mode.id), 'splits');
  }, [mode.id, counts.total]);

  const generated = useMemo(() => lib.buildJudgePrompt(project, mode.id, { inputs }), [project, mode.id, inputs.join(',')]);
  useEffect(() => {
    if (!check.promptEdited && check.prompt !== generated) updateProject((p) => lib.updateCheck(p, check.id, { prompt: generated }), 'judge prompt');
  }, [generated, check.promptEdited]);

  const state = lib.checkTestState(project, check.id);
  const revealed = state !== 'hidden';
  const tuning = useMemo(() => lib.checkAgreement(project, check.id, { split: 'tuning' }), [project, check.id]);
  const splits = lib.splitCounts(project, mode.id);
  const canShuffle = lib.canReshuffle(project, mode.id);
  const ready = counts.fail >= GATE && counts.pass >= GATE;
  const judged = Object.keys(check.results || {}).length;
  const open = ready || peek || judged > 0;
  const setAside = splits.test.pass + splits.test.fail;
  const testShare = counts.total ? Math.round((setAside / counts.total) * 100) : 40;

  const toggleInput = (id, on) => updateProject((p) => {
    const c = findCheck(p, check.id);
    const cur = c.inputs && c.inputs.length ? c.inputs : inputs;
    const next = on ? INPUT_OPTIONS.map((o) => o.id).filter((x) => x === id || cur.includes(x)) : cur.filter((x) => x !== id);
    return next.length ? lib.updateCheck(p, check.id, { inputs: next }) : p;
  }, 'judge inputs');

  const locked = html`<div class="checks-gate">
    <span class="checks-lock-icon"><${Icon} name="lock" size=${18} /></span>
    <div class="stack grow">
      <p>Write the judge after at least 20 Problem and 20 Good labels. You have ${counts.fail} and ${counts.pass}.</p>
      <div class="row">
        <${Button} kind="primary" size="sm" icon="check" onClick=${() => openLabels()}>Label more traces for this failure mode<//>
        <${Button} kind="ghost" size="sm" onClick=${() => setPeek(true)}>Show the prompt anyway<//>
      </div>
    </div>
  </div>`;

  return html`<div class="checks-body checks-judge">
    <${Step} n="1" id=${check.id + '-labels'} title="Labels"
      aside=${html`<${Button} kind=${ready ? 'secondary' : 'primary'} size="sm" icon="check" onClick=${() => openLabels()}>Label more traces for this failure mode<//>`}>
      <p class="soft">A label is your yes or no to "Does this trace show this failure mode?" Every trace you reviewed after the failure mode existed already counts.</p>
      <p class="checks-labels-line num"><strong>${plural(counts.total, 'label')}: ${counts.fail} Problem, ${counts.pass} Good.</strong> Write the judge after at least 20 of each; aim for about 50 of each.</p>
      <div class="checks-labelbars">
        <${LabelBar} label="Problem labels" value=${counts.fail} />
        <${LabelBar} label="Good labels" value=${counts.pass} />
      </div>
      ${counts.total > 0 && counts.total < 60 && html`<p class="banner"><${Icon} name="warning" />
        <span>With fewer than 60 labels, the agreement numbers swing a lot from one label to the next.</span></p>`}
    <//>

    <${Step} n="2" id=${check.id + '-splits'} title="Final test set aside">
      <p>${counts.total ? `We set aside ${testShare}% of your labels as a final test.` : 'Once you have labels, we set aside 40% of them as a final test.'}${' '}
        <button type="button" class="checks-link checks-link-inline" aria-expanded=${showSplits ? 'true' : 'false'} onClick=${() => setShowSplits(!showSplits)}>
          ${showSplits ? 'Hide details' : 'Details'}</button></p>
      ${showSplits && html`<div class="stack checks-splits">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Set</th><th scope="col">What it is for</th><th scope="col" class="num">Problem</th><th scope="col" class="num">Good</th></tr></thead>
            <tbody>
              <tr><td>Examples</td><td class="soft">Shown to the judge in its prompt.</td><td class="num">${splits.examples.fail}</td><td class="num">${splits.examples.pass}</td></tr>
              <tr><td>Tuning set</td><td class="soft">For improving the prompt. Read every disagreement.</td><td class="num">${splits.tuning.fail}</td><td class="num">${splits.tuning.pass}</td></tr>
              <tr><td>Final test</td><td class="soft">Used once, at the end, to measure the judge.</td><td class="num">${splits.test.fail}</td><td class="num">${splits.test.pass}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="row">
          <${Button} size="sm" disabled=${!canShuffle} onClick=${() => updateProject((p) => lib.assignSplits(p, mode.id, { reshuffle: true }), 'reshuffle')}>Reshuffle<//>
          <span class="hint">${canShuffle ? 'Draws the sets again. Only possible before the judge has answered any trace.' : 'The sets are fixed now that the judge has answers.'}</span>
        </div>
      </div>`}
    <//>

    <${Step} n="3" id=${check.id + '-inputs'} title="What the judge sees">
      <p class="hint">Give the judge only what it needs to decide.</p>
      <div class="checks-inputs">
        ${INPUT_OPTIONS.map((o) => html`<label key=${o.id} class=${classes('checks-input-opt', inputs.includes(o.id) && 'is-on')}>
          <input type="checkbox" checked=${inputs.includes(o.id)} disabled=${inputs.includes(o.id) && inputs.length === 1}
            onChange=${(e) => toggleInput(o.id, e.currentTarget.checked)} />
          <span>${lib.withUser(o.label, exp)}</span>
        </label>`)}
      </div>
    <//>

    <${Step} n="4" id=${check.id + '-prompt'} title="Prompt">
      ${open ? html`<${PromptSection} project=${project} check=${check} mode=${mode} generated=${generated} />` : locked}
    <//>

    <${Step} n="5" id=${check.id + '-run'} title="Run it">
      ${!open ? html`<p class="small muted">Opens with the prompt.</p>`
        : !check.model ? html`<p class="soft">Pin a model in step 4 first, so every answer comes from the same version.</p>`
          : storageKind === 'folder'
            ? html`<${RunFolder} project=${project} check=${check} folder=${folder} revealed=${revealed} />`
            : html`<${RunBrowser} project=${project} check=${check} revealed=${revealed} />`}
    <//>

    <${Step} n="6" id=${check.id + '-tuning'} title="Agreement on the tuning set"
      aside=${html`<${Button} kind="secondary" size="sm" icon="check" onClick=${() => openLabels()}>Label more traces<//>`}>
      <div class="stack-lg">
        <${AgreementPanel} project=${project} check=${check} a=${tuning} who="Judge" openLabels=${openLabels} inStep=${true}
          empty=${counts.total ? 'The judge has not answered any tuning set trace yet. Run it in step 5.' : null}
          intro=${`Measured on ${plural(tuning.n, 'tuning set trace')} with a judge answer.${tuning.missing ? ` ${plural(tuning.missing, 'tuning set trace has', 'tuning set traces have')} no answer yet.` : ''}`}
          detailOf=${(id) => check.results?.[id]?.critique || ''} />
        ${tuning.unreadable.length > 0 && html`<p class="banner"><${Icon} name="warning" />
          <span>${plural(tuning.unreadable.length, 'judge answer')} could not be read. ${tuning.unreadable.length === 1 ? 'That trace goes' : 'Those traces go'} back in the queue in step 5.</span></p>`}
        <div class="stack">
          <h5 class="checks-h5">Agreement by round</h5>
          <p class="hint">Each round keeps the numbers from the time it ran.</p>
          <${Rounds} runs=${check.runs || EMPTY} promptHash=${lib.promptHash(check)} />
        </div>
        <div class="stack">
          <h5 class="checks-h5">Disagreements, side by side <span class="num muted">(${tuning.falsePasses.length + tuning.falseFails.length})</span></h5>
          <p class="hint">Read each one. Fix the prompt when the judge is wrong, or fix your label when you are.</p>
          <${Disagreements} project=${project} check=${check} a=${tuning} onRelabel=${openLabels} />
        </div>
      </div>
    <//>

    <${FinalTest} project=${project} check=${check} state=${state} onRelabel=${openLabels} tuned=${tuning.n > 0} />
    <${LikelyRate} project=${project} check=${check} state=${state} />
  </div>`;
}

// ---------------------------------------------------------------------------
// The view

function resolve(project, param, modes) {
  const mm = lib.modeMap(project);
  const check = param ? findCheck(project, param) : null;
  if (check) {
    const mode = mm.get(check.modeId);
    if (mode && mode.kind === 'failure') return { mode, check };
  }
  const mode = (param && modes.find((m) => m.id === param)) || modes[0] || null;
  return { mode, check: null };
}

export default function ChecksView({ param }) {
  const project = useStore((s) => s.project);
  const storageKind = useStore((s) => s.storageKind);
  const folder = useStore((s) => s.folder);
  const [flow, setFlow] = useState(null);
  const modes = useMemo(() => (project ? orderedModes(project) : EMPTY), [project && project.modes, project && project.reviews, project && project.experience]);
  const rows = useMemo(() => {
    if (!project) return EMPTY;
    const mm = lib.modeMap(project);
    return (project.checks || EMPTY).filter((c) => mm.get(c.modeId)).map((c) => checkRow(project, c, mm));
  }, [project]);
  const rowsByMode = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const list = m.get(r.check.modeId) || [];
      list.push(r);
      m.set(r.check.modeId, list);
    }
    return m;
  }, [rows]);
  // Judges measure agreement on the tuning set, so every judged failure mode needs its splits.
  const judged = project ? [...new Set((project.checks || EMPTY).filter((c) => c.type === 'judge').map((c) => c.modeId))].join('|') : '';
  useEffect(() => {
    if (!judged) return;
    updateProject((p) => judged.split('|').reduce((q, id) => (lib.modeMap(q).get(id) ? lib.assignSplits(q, id) : q), p), 'splits');
  }, [judged, project && project.labels, project && project.reviews]);
  if (!project) return null;

  const summary = toolSummary(project);
  const tools = summary.withTools > 0;
  const { mode, check } = resolve(project, param, modes);
  // Open the Tool call checks at first for an agent with none yet; otherwise the failure mode list comes first.
  const freshAgent = project.experience?.pattern === 'agent' && !['policy', 'relevance', 'grounding'].some((f) => familyChecks(project, f).length);
  const flowModal = flow && html`<${TemplateFlow} key=${flow.kind + '|' + (flow.modeId || '')} project=${project} flow=${flow} onClose=${() => setFlow(null)} />`;

  if (!modes.length) {
    return html`<section class="page checks">
      <header class="checks-head">
        <h1 class="page-title">Checks</h1>
        <p class="page-lead">Turn the failure modes that matter into checks, and confirm they agree with you.</p>
      </header>
      <div class="card checks-empty-card">
        <${EmptyState} icon="judge" title="No failure modes yet"
          body="You build a check for one failure mode at a time. Name your failure modes first."
          action=${{ label: 'Next: Failure modes', onClick: () => navigate('modes') }} />
      </div>
      ${tools && html`<div class="checks-empty-tools">
        <p class="small soft">Your agent uses tools. Policy rules come from your company, so they are the one kind of check you can write before reading traces.</p>
        <${ToolCallPanel} project=${project} summary=${summary} onFlow=${setFlow} startOpen=${true} />
      </div>`}
      ${flowModal}
    </section>`;
  }

  return html`<section class="page checks">
    <header class="checks-head">
      <h1 class="page-title">Checks</h1>
      <p class="page-lead">Turn the failure modes that matter into checks, and confirm they agree with you.</p>
    </header>
    ${rows.length > 0 && html`<${AllChecksTable} rows=${rows} selectedId=${check ? check.id : null} />`}
    <div class="checks-layout">
      <aside class="checks-side" aria-label="Failure modes and tool call checks">
        ${tools && html`<${ToolCallPanel} project=${project} summary=${summary} onFlow=${setFlow} startOpen=${freshAgent} />`}
        <${ModeList} modes=${modes} exp=${project.experience || {}} rowsByMode=${rowsByMode} selectedId=${mode ? mode.id : null} />
      </aside>
      <div class="checks-main">
        ${mode && html`<${ModeDetail} key=${mode.id} project=${project} mode=${mode} check=${check}
          tools=${tools} onFlow=${setFlow} storageKind=${storageKind} folder=${folder} />`}
      </div>
    </div>
    ${flowModal}
  </section>`;
}
