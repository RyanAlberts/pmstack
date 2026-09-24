// toolcalls.mjs: Tool call checks for agents that use tools. Three questions:
// policy (is this call allowed?), relevance (is it the right call for what the
// user asked?), and output grounding (does the reply match what the tool
// returned?). Pure functions with no DOM, file system, or network, so the same
// code runs in Eval Studio, the CLI, and any Node service. As a guardrail, pass
// the trace so far with the proposed call last to evaluatePolicy before a write runs.

import { getPath, normalizeAll, outputText } from './traces.mjs';

const EMPTY = Object.freeze([]);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const unique = (list) => [...new Set(list)];
const fill = (text, who) => String(text ?? '').split('{userLabel}').join(who);
// Curly quotes become straight ones so "couldn't" matches however it was typed.
const CURLY = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, 'g');
const EN_DASH = String.fromCharCode(0x2013);

/** The policy file format id. */
export const POLICY_FORMAT = 'pmstack.policy/1';
/** The intent map file format id. */
export const INTENTS_FORMAT = 'pmstack.intents/1';

/** The worked enterprise policy (SPEC 12.1): the same file as templates/tool-calls/policy.json and the support-agent sample. */
export const EXAMPLE_POLICY = {
  "format": "pmstack.policy/1",
  "name": "Northstar support agent policy",
  "note": [
    "Worked example for Northstar Internet, a made-up internet provider. Copy it, then replace the tools, limits, and reasons with your company's.",
    "Every rule has a why: the reason in plain words. It is shown next to each violation, so write it for the person who reads the violation.",
    "onlyListedTools: true means a call to any tool not listed under tools breaks the policy (rule: Only listed tools). Why: a new or renamed tool should be reviewed before the agent may use it.",
    "access: read tools only look things up. write tools change something for the customer, such as a credit, a plan, or a visit.",
    "confirm: true means the agent must propose the action, and the customer's next message must say yes (one of confirmationPatterns, any capitalization) before the call runs (rule: Ask before acting).",
    "maxPerTrace limits how many times the agent may call a tool in one conversation (rule: At most N times per conversation).",
    "A rule with when applies only to traces where that detail has that value. tools set to \"*\" means every tool."
  ],
  "onlyListedTools": true,
  "confirmationPatterns": [
    "\\byes\\b",
    "\\bconfirm",
    "go ahead",
    "please do",
    "sounds good",
    "do it",
    "that works"
  ],
  "tools": {
    "verify_identity": {
      "access": "read"
    },
    "lookup_account": {
      "access": "read"
    },
    "get_bill": {
      "access": "read"
    },
    "search_help_center": {
      "access": "read"
    },
    "find_technician_slots": {
      "access": "read",
      "why": "Only lists open visit times. Booking one is schedule_technician."
    },
    "issue_credit": {
      "access": "write",
      "confirm": true,
      "maxPerTrace": 1,
      "why": "Credits cost money. The customer agrees to the amount first, and one credit per conversation stops repeated credits."
    },
    "change_plan": {
      "access": "write",
      "confirm": true,
      "why": "A plan change moves the monthly price, so the customer agrees to the new plan first."
    },
    "cancel_service": {
      "access": "write",
      "confirm": true,
      "why": "Cancelling ends the customer's internet service, so it happens only after they say yes."
    },
    "schedule_technician": {
      "access": "write",
      "confirm": true,
      "why": "Someone must be home for a visit, so the customer agrees to the time first."
    },
    "request_supervisor_approval": {
      "access": "read",
      "why": "Listed as read: asking for approval changes nothing for the customer until a supervisor acts."
    }
  },
  "rules": [
    {
      "id": "never-delete",
      "type": "deny-tools",
      "tools": [
        "delete_account",
        "run_sql"
      ],
      "why": "Agents may never delete accounts or run their own database queries. Only staff with the right access do that."
    },
    {
      "id": "no-writes-by-text",
      "type": "deny-access",
      "access": "write",
      "when": {
        "path": "metadata.channel",
        "equals": "sms"
      },
      "why": "Account changes are not allowed over text message, because anyone holding the phone can reply."
    },
    {
      "id": "verify-first",
      "type": "requires-before",
      "tools": [
        "lookup_account",
        "get_bill",
        "issue_credit",
        "change_plan",
        "cancel_service",
        "schedule_technician"
      ],
      "before": "verify_identity",
      "why": "Verify who the customer is before reading or changing an account."
    },
    {
      "id": "same-account",
      "type": "arg-equals",
      "tools": [
        "lookup_account",
        "get_bill",
        "issue_credit",
        "change_plan",
        "cancel_service"
      ],
      "argPath": "account_id",
      "source": {
        "tool": "verify_identity",
        "path": "account_id"
      },
      "why": "Only touch the account the customer verified. Any other account number means someone else's data."
    },
    {
      "id": "signed-in-account",
      "type": "arg-equals",
      "tools": [
        "lookup_account",
        "get_bill",
        "issue_credit",
        "change_plan",
        "cancel_service"
      ],
      "argPath": "account_id",
      "source": {
        "detail": "metadata.account_id"
      },
      "when": {
        "path": "metadata.channel",
        "equals": "chat"
      },
      "why": "In web chat the customer is signed in, so the agent works only on the signed-in account."
    },
    {
      "id": "credit-approval",
      "type": "approval-above",
      "tools": [
        "issue_credit"
      ],
      "argPath": "amount",
      "max": 50,
      "approvalTool": "request_supervisor_approval",
      "why": "Credits over $50 need a supervisor."
    },
    {
      "id": "credit-cap",
      "type": "arg-max",
      "tools": [
        "issue_credit"
      ],
      "argPath": "amount",
      "max": 200,
      "why": "No credit above $200, even with approval. Larger credits go through the billing team."
    },
    {
      "id": "credit-minimum",
      "type": "arg-min",
      "tools": [
        "issue_credit"
      ],
      "argPath": "amount",
      "min": 1,
      "why": "A credit under $1 is a typo, such as 0 or a negative amount."
    },
    {
      "id": "plan-names",
      "type": "arg-in",
      "tools": [
        "change_plan"
      ],
      "argPath": "plan",
      "values": [
        "basic",
        "plus",
        "gig"
      ],
      "why": "Only plans Northstar sells today. An old or misspelled plan name breaks billing."
    },
    {
      "id": "writes-name-account",
      "type": "arg-required",
      "tools": [
        "issue_credit",
        "change_plan",
        "cancel_service"
      ],
      "argPath": "account_id",
      "why": "Every account change names the account, so the audit log shows what changed and where."
    },
    {
      "id": "no-card-numbers",
      "type": "arg-not-match",
      "tools": "*",
      "pattern": "\\b(?:\\d[ -]?){13,16}\\b",
      "why": "Never pass card numbers to tools. Tool logs are not secure enough for payment details."
    },
    {
      "id": "no-government-ids",
      "type": "arg-not-match",
      "tools": "*",
      "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      "why": "Never pass Social Security numbers to tools. Northstar never needs them, and storing them adds legal risk."
    },
    {
      "id": "no-email-in-search",
      "type": "arg-not-match",
      "tools": [
        "search_help_center"
      ],
      "argPath": "query",
      "pattern": "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
      "why": "Help center searches are logged and read by the content team, so a search must never include a customer's email address."
    }
  ]
};

/** Confirmation patterns used when a policy lists none: the most recent message must match one (any capitalization). */
export const DEFAULT_CONFIRMATION_PATTERNS = ['\\byes\\b', '\\bconfirm', 'go ahead', 'please do', 'sounds good', 'do it', 'that works'];

/**
 * The three Tool call checks: canonical label, question, and one line, plus the default
 * failure mode (name, definition) and the kinds of stage where the failures start.
 */
export const TOOL_CHECK_TEMPLATES = {
  policy: {
    id: 'policy', label: 'Policy', question: 'Is this call allowed?',
    summary: "Your company's rules for which tools the agent may use, when, and with what details.",
    name: 'Breaks a tool policy',
    definition: "Fails when the agent calls a tool in a way your company's rules do not allow: a tool it may not use, an action without the {userLabel}'s yes, a required step skipped, or a value over a limit.",
    columns: ['act'],
  },
  relevance: {
    id: 'relevance', label: 'Relevance', question: 'Is it the right call for what the {userLabel} asked?',
    summary: "Right tool, right details, no calls the request didn't need, none it skipped.",
    name: 'Wrong tool for the request',
    definition: 'Fails when the agent calls a tool that does not serve what the {userLabel} asked, passes details that differ from what the {userLabel} said, makes a call the request did not need, or skips a call it needed.',
    columns: ['plan', 'act'],
  },
  grounding: {
    id: 'grounding', label: 'Output grounding', question: 'Does the reply match what the tool returned?',
    summary: 'No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.',
    name: "Reply doesn't match the tool results",
    definition: 'Fails when the reply contradicts a tool result, states a fact no tool returned, drops a qualifier such as pending, or claims success after a failed call.',
    columns: ['answer'],
  },
};

/** The id of the first stage where a template's failures start (policy: act; relevance: plan or act; grounding: answer), or null. */
export function templateStage(experience, template) {
  const cols = TOOL_CHECK_TEMPLATES[template]?.columns || EMPTY;
  const stages = Array.isArray(experience?.stages) ? experience.stages : EMPTY;
  for (const col of cols) {
    const s = stages.find((x) => x?.column === col);
    if (s) return s.id;
  }
  return null;
}

// ------------------------------------------------------------------ rule types

/** Plain label for each policy rule type. */
export const policyRuleLabels = {
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

/**
 * Every rule type with its label, a one-line hint, and the fields a rule of that type uses
 * (`needs`; `optional` may be left out). only-listed, confirm, and max-per-trace usually come
 * from the policy's tools list (onlyListedTools, tools.X.confirm, tools.X.maxPerTrace).
 */
export const POLICY_RULE_TYPES = [
  { id: 'only-listed', hint: 'Any tool the policy does not list breaks it.', needs: [], optional: [] },
  { id: 'deny-tools', hint: 'The agent must never call these tools.', needs: ['tools'], optional: [] },
  { id: 'deny-access', hint: 'No tool that changes something, or only in some traces.', needs: ['access'], optional: ['tools'] },
  { id: 'confirm', hint: 'The {userLabel} must say yes to the proposed action before the call.', needs: ['tools'], optional: [] },
  { id: 'max-per-trace', hint: 'Limits how often a tool runs in one conversation.', needs: ['tools', 'max'], optional: [] },
  { id: 'requires-before', hint: 'Another tool must run first, such as checking who the {userLabel} is.', needs: ['tools', 'before'], optional: [] },
  { id: 'approval-above', hint: 'Above a limit, an approval tool must run first.', needs: ['tools', 'argPath', 'max', 'approvalTool'], optional: [] },
  { id: 'arg-max', hint: 'A value in the call may not go above a number.', needs: ['tools', 'argPath', 'max'], optional: [] },
  { id: 'arg-min', hint: 'A value in the call may not go below a number.', needs: ['tools', 'argPath', 'min'], optional: [] },
  { id: 'arg-in', hint: 'A value in the call must be one of a list.', needs: ['tools', 'argPath', 'values'], optional: [] },
  { id: 'arg-not-match', hint: 'No call may include text that matches a pattern, such as a card number.', needs: ['tools', 'pattern'], optional: ['argPath'] },
  { id: 'arg-required', hint: 'The call must include a value, such as a reason.', needs: ['tools', 'argPath'], optional: [] },
  { id: 'arg-equals', hint: 'A value in the call must match an earlier tool result or a trace detail.', needs: ['tools', 'argPath', 'source'], optional: [] },
].map((t) => ({ ...t, label: policyRuleLabels[t.id] }));

const RULE_TYPES = new Set(Object.keys(policyRuleLabels));
const DERIVED_IDS = new Set(['only-listed', 'confirm', 'max-per-trace']);
const TOOLS_REQUIRED = new Set(['deny-tools', 'confirm', 'max-per-trace', 'requires-before']);
const DEFAULT_WHY = {
  'only-listed': 'Only tools the policy lists may be used. A new or renamed tool needs a review first.',
  confirm: 'Actions that change something need a yes from the {userLabel} first.',
  'max-per-trace': 'Some actions may happen only a limited number of times in one conversation.',
};

/** Plain label of one rule; with a tool, max-per-trace shows that tool's limit ("At most 1 time per conversation"). */
export function ruleLabel(rule, tool = null, policy = null) {
  if (!rule) return '';
  if (rule.type === 'deny-access') return rule.access === 'read' ? 'No read actions' : 'No write actions';
  if (rule.type === 'max-per-trace') {
    const n = limitFor(rule, tool, policy);
    return Number.isFinite(n) ? `At most ${plural(n, 'time', 'times')} per conversation` : policyRuleLabels['max-per-trace'];
  }
  return policyRuleLabels[rule.type] || rule.type;
}

function limitFor(rule, tool, policy) {
  if (rule.derived) return Number(policy?.tools?.[tool]?.maxPerTrace);
  return Number(rule.max);
}

// ------------------------------------------------------------------ validation

function regexError(pattern, flags = '') {
  try { new RegExp(String(pattern), flags); return null; } catch (e) { return e.message; }
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNames = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim());

/** Check a pmstack.policy/1 object; errors are plain sentences. */
export function validatePolicy(obj) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['This is not a policy file.'] };
  if (obj.format !== POLICY_FORMAT) errors.push(`This is not a pmstack policy (format "${obj.format ?? 'missing'}"; expected "${POLICY_FORMAT}").`);
  if (obj.onlyListedTools != null && typeof obj.onlyListedTools !== 'boolean') errors.push('onlyListedTools must be true or false.');
  if (obj.tools != null && !isObj(obj.tools)) errors.push('tools must list each tool by name, like { "get_bill": { "access": "read" } }.');
  for (const [name, def] of Object.entries(isObj(obj.tools) ? obj.tools : {})) {
    if (!isObj(def)) { errors.push(`Tool "${name}" needs settings, like { "access": "read" }.`); continue; }
    if (def.access != null && def.access !== 'read' && def.access !== 'write') errors.push(`Tool "${name}": access must be "read" or "write".`);
    if (def.confirm != null && typeof def.confirm !== 'boolean') errors.push(`Tool "${name}": confirm must be true or false.`);
    if (def.maxPerTrace != null && !(Number.isInteger(def.maxPerTrace) && def.maxPerTrace >= 0)) errors.push(`Tool "${name}": maxPerTrace must be a whole number.`);
  }
  if (obj.confirmationPatterns != null) {
    if (!Array.isArray(obj.confirmationPatterns)) errors.push('confirmationPatterns must be a list of patterns.');
    else {
      for (const p of obj.confirmationPatterns) {
        const e = typeof p === 'string' ? regexError(p, 'i') : 'it is not text';
        if (e) errors.push(`Confirmation pattern "${p}" is not valid: ${e}`);
      }
    }
  }
  if (obj.rules != null && !Array.isArray(obj.rules)) errors.push('rules must be a list.');
  const ids = new Set();
  (Array.isArray(obj.rules) ? obj.rules : EMPTY).forEach((r, i) => {
    const where = isObj(r) && typeof r.id === 'string' && r.id ? `Rule "${r.id}"` : `Rule ${i + 1}`;
    if (!isObj(r)) { errors.push(`${where} is not an object.`); return; }
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`${where} needs an id.`);
    else if (DERIVED_IDS.has(r.id)) errors.push(`${where}: this id is kept for the rule made from the tools list. Pick another id.`);
    else if (ids.has(r.id)) errors.push(`${where}: the id is used twice.`);
    else ids.add(r.id);
    if (!RULE_TYPES.has(r.type)) { errors.push(`${where} has an unknown type "${r.type}".`); return; }
    if (r.tools != null && r.tools !== '*' && !isNames(r.tools)) errors.push(`${where}: tools must be a list of tool names, or "*" for every tool.`);
    else if (r.tools == null && TOOLS_REQUIRED.has(r.type)) errors.push(`${where} needs tools: a list of tool names, or "*" for every tool.`);
    const needText = (key, what) => { if (typeof r[key] !== 'string' || !r[key].trim()) errors.push(`${where} needs ${key}: ${what}.`); };
    const needNum = (key) => { if (!isNum(r[key])) errors.push(`${where} needs ${key}: a number.`); };
    switch (r.type) {
      case 'deny-access':
        if (r.access != null && r.access !== 'read' && r.access !== 'write') errors.push(`${where}: access must be "read" or "write".`);
        break;
      case 'max-per-trace':
        if (!(Number.isInteger(r.max) && r.max >= 0)) errors.push(`${where} needs max: a whole number.`);
        break;
      case 'requires-before':
        needText('before', 'the tool that must run first');
        break;
      case 'approval-above':
        needText('argPath', 'the argument to compare, like "amount"');
        needNum('max');
        needText('approvalTool', 'the tool that gives approval');
        break;
      case 'arg-max':
        needText('argPath', 'the argument to compare, like "amount"');
        needNum('max');
        break;
      case 'arg-min':
        needText('argPath', 'the argument to compare, like "amount"');
        needNum('min');
        break;
      case 'arg-in':
        needText('argPath', 'the argument to check, like "plan"');
        if (!Array.isArray(r.values) || !r.values.length) errors.push(`${where} needs values: the list of allowed values.`);
        break;
      case 'arg-not-match': {
        if (r.argPath != null && (typeof r.argPath !== 'string' || !r.argPath.trim())) errors.push(`${where}: argPath must name an argument, or be left out to check every argument.`);
        if (typeof r.pattern !== 'string' || !r.pattern) errors.push(`${where} needs pattern: the text pattern no call may include.`);
        else {
          const e = regexError(r.pattern, cleanFlags(r.flags));
          if (e) errors.push(`${where}: the pattern is not valid: ${e}`);
        }
        break;
      }
      case 'arg-required':
        needText('argPath', 'the argument every call must include');
        break;
      case 'arg-equals': {
        needText('argPath', 'the argument to compare, like "account_id"');
        const s = r.source;
        const okTool = isObj(s) && typeof s.tool === 'string' && s.tool.trim() && typeof s.path === 'string' && s.path.trim();
        const okDetail = isObj(s) && typeof s.detail === 'string' && s.detail.trim();
        if (!okTool && !okDetail) errors.push(`${where} needs source: { "tool": "...", "path": "..." } for an earlier tool result, or { "detail": "metadata.account_id" } for a trace detail.`);
        break;
      }
      default:
    }
    if (r.when != null && !(isObj(r.when) && typeof r.when.path === 'string' && r.when.path.trim())) {
      errors.push(`${where}: when needs a path, like { "path": "metadata.channel", "equals": "sms" }.`);
    }
    if (r.why != null && typeof r.why !== 'string') errors.push(`${where}: why must be text.`);
  });
  return { ok: errors.length === 0, errors };
}

/** Check a pmstack.intents/1 intent map; errors are plain sentences. */
export function validateIntents(obj) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['This is not an intent map.'] };
  if (obj.format !== INTENTS_FORMAT) errors.push(`This is not a pmstack intent map (format "${obj.format ?? 'missing'}"; expected "${INTENTS_FORMAT}").`);
  if (obj.intentFrom != null && (typeof obj.intentFrom !== 'string' || !obj.intentFrom.trim())) errors.push('intentFrom must name a trace detail, like "metadata.intent".');
  if (!Array.isArray(obj.intents)) { errors.push('intents must be a list.'); return { ok: false, errors }; }
  const ids = new Set();
  obj.intents.forEach((it, i) => {
    const where = isObj(it) && typeof it.id === 'string' && it.id ? `Intent "${it.id}"` : `Intent ${i + 1}`;
    if (!isObj(it)) { errors.push(`${where} is not an object.`); return; }
    if (typeof it.id !== 'string' || !it.id.trim()) errors.push(`${where} needs an id.`);
    else if (ids.has(it.id)) errors.push(`${where}: the id is used twice.`);
    else ids.add(it.id);
    for (const key of ['expect', 'allow', 'never']) {
      if (it[key] != null && !isNames(it[key])) errors.push(`${where}: ${key} must be a list of tool names.`);
    }
    if (isNames(it.expect) && isNames(it.never)) {
      for (const t of it.expect) if (it.never.includes(t)) errors.push(`${where}: ${t} is in both expect and never.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------ tool calls in a trace

// Read a path from the raw trace first, then from the normalized trace.
function detailValue(n, path) {
  const v = getPath(n?.raw, path);
  return v !== undefined ? v : getPath(n, path);
}

function parseMaybe(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try { return JSON.parse(t); } catch { return v; }
}

const ERROR_WORDS = /error|fail|denied|declined|reject|invalid|forbidden|unauthori|unverified|mismatch|timed?[_ -]?out|not[_ -]?found|unavailable|refused|^not[_ -]/i;
const PENDING_WORDS = /pending|queued|awaiting|waiting|in[_ -]?review|in[_ -]?progress|processing/i;
const STATUS_KEYS = ['status', 'state', 'result', 'outcome'];
const TEXT_STATUS = /\b(pending_approval|pending|error|failed|failure|denied)\b/i;

function stateOf(status) {
  if (ERROR_WORDS.test(status)) return 'error';
  if (PENDING_WORDS.test(status)) return 'pending';
  return 'ok';
}

function statusField(data) {
  for (const k of STATUS_KEYS) if (typeof data[k] === 'string' && data[k].trim()) return data[k].trim();
  for (const v of Object.values(data)) {
    if (!isObj(v)) continue;
    for (const k of STATUS_KEYS) if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
  }
  return null;
}

// What a tool result says about how the call went: { state: ok|error|pending|none, status }.
function resultState(stepStatus, data, text, hasResult) {
  if (!hasResult) return { state: 'none', status: null };
  if (stepStatus && String(stepStatus).trim()) {
    const s = String(stepStatus).trim();
    const st = stateOf(s);
    if (st !== 'ok') return { state: st, status: s };
  }
  if (isObj(data)) {
    const status = statusField(data);
    const err = data.error;
    if ((err != null && err !== false && err !== '' && !(isObj(err) && !Object.keys(err).length)) || (Array.isArray(data.errors) && data.errors.length)) {
      return { state: 'error', status: status || 'error' };
    }
    if (data.ok === false || data.success === false) return { state: 'error', status: status || 'error' };
    if (status) return { state: stateOf(status), status };
    return { state: 'ok', status: null };
  }
  const m = TEXT_STATUS.exec(String(text ?? ''));
  if (m) return { state: /pending/i.test(m[1]) ? 'pending' : 'error', status: m[1].toLowerCase() };
  return { state: 'ok', status: null };
}

const CALLS = new WeakMap();
/**
 * Every tool call in a normalized trace, in order, paired with its result:
 * [{ stepId, index, name, callId, args, argsText, result: { stepId, index, text, data } | null, state: 'ok'|'error'|'pending'|'none', status }].
 * Covers chat tool calls (paired by call id) and step-log tool and handoff steps.
 */
export function toolCallList(normalized) {
  const n = normalized;
  if (!n || !Array.isArray(n.steps)) return EMPTY;
  let list = CALLS.get(n);
  if (list) return list;
  list = [];
  const steps = n.steps;
  const used = new Set();
  steps.forEach((s, i) => {
    if (s.kind === 'tool_call') {
      let r = -1;
      if (s.callId != null) r = steps.findIndex((x, j) => j > i && x.kind === 'tool_result' && x.callId === s.callId && !used.has(j));
      if (r < 0) r = steps.findIndex((x, j) => j > i && x.kind === 'tool_result' && !used.has(j) && (x.callId == null || s.callId == null) && (x.name == null || x.name === s.name));
      if (r >= 0) used.add(r);
      const rs = r >= 0 ? steps[r] : null;
      const data = rs ? (rs.data != null ? rs.data : parseMaybe(rs.text)) : null;
      const st = resultState(rs?.status, data, rs?.text, !!rs);
      list.push({
        stepId: s.id, index: i, name: s.name || '', callId: s.callId ?? null,
        args: s.data, argsText: typeof s.data === 'string' ? s.data : s.text || str(s.data ?? {}),
        result: rs ? { stepId: rs.id, index: r, text: rs.text, data } : null,
        state: st.state, status: st.status,
      });
    } else if (s.kind === 'tool' || s.kind === 'handoff') {
      const raw = isObj(s.data) ? s.data : {};
      const args = parseMaybe(raw.input ?? raw.arguments ?? raw.args ?? null);
      const out = raw.output ?? raw.result;
      const has = out != null || (s.status != null && s.status !== '');
      const data = parseMaybe(out);
      const st = resultState(s.status, data, str(out), has);
      list.push({
        stepId: s.id, index: i, name: s.name || '', callId: raw.id ?? null,
        args, argsText: typeof args === 'string' ? args : str(args ?? {}),
        result: has ? { stepId: s.id, index: i, text: str(out), data } : null,
        state: st.state, status: st.status,
      });
    }
  });
  CALLS.set(n, list);
  return list;
}

/** Guess whether a tool only reads (names starting with get, list, search, lookup, find, read, verify) or changes something. */
export function guessAccess(name) {
  return /^(get|list|search|lookup|find|read|verify)/i.test(String(name || '')) ? 'read' : 'write';
}

/** 'read' or 'write' for a tool: the policy's setting when listed, else a guess from the name. */
export function toolAccess(policy, name) {
  const a = policy?.tools?.[name]?.access;
  return a === 'read' || a === 'write' ? a : guessAccess(name);
}

/** The policy of the project's first policy check, or null. */
export function projectPolicy(project) {
  const c = (project?.checks || EMPTY).find((x) => x?.type === 'policy' && isObj(x.policy));
  return c ? c.policy : null;
}

const SUMMARY = new WeakMap();
/** Counts for showing the Tool call checks panel: { traces, withTools, calls, writeCalls }. */
export function toolCallSummary(project) {
  const norm = normalizeAll(project);
  const policy = projectPolicy(project);
  let byPolicy = SUMMARY.get(norm);
  if (!byPolicy) { byPolicy = new Map(); SUMMARY.set(norm, byPolicy); }
  const cached = byPolicy.get(policy);
  if (cached) return cached;
  let withTools = 0, calls = 0, writeCalls = 0;
  for (const n of norm.values()) {
    const list = toolCallList(n);
    if (list.length) withTools++;
    calls += list.length;
    for (const c of list) if (toolAccess(policy, c.name) === 'write') writeCalls++;
  }
  const out = { traces: norm.size, withTools, calls, writeCalls };
  byPolicy.set(policy, out);
  return out;
}

/**
 * Tools found in the project's traces, most used first: [{ name, calls, traces, access, listed }].
 * access comes from the policy when the tool is listed, else a guess from its name.
 */
export function toolInventory(project, policy = projectPolicy(project)) {
  const byName = new Map();
  for (const n of normalizeAll(project).values()) {
    const seen = new Set();
    for (const c of toolCallList(n)) {
      const name = c.name || '(no name)';
      const row = byName.get(name) || { name, calls: 0, traces: 0 };
      row.calls++;
      if (!seen.has(name)) { row.traces++; seen.add(name); }
      byName.set(name, row);
    }
  }
  return [...byName.values()]
    .map((r) => ({ ...r, access: toolAccess(policy, r.name), listed: !!policy?.tools?.[r.name] }))
    .sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ------------------------------------------------------------------ policy

const RULES = new WeakMap();
/**
 * The rules a policy enforces, in order: the rules made from its tools list (only-listed,
 * confirm, max-per-trace; each marked derived) and then its own rules.
 */
export function policyRules(policy) {
  if (!isObj(policy)) return EMPTY;
  let list = RULES.get(policy);
  if (list) return list;
  list = [];
  const tools = isObj(policy.tools) ? policy.tools : {};
  const names = Object.keys(tools);
  if (policy.onlyListedTools === true) list.push({ id: 'only-listed', type: 'only-listed', derived: true, why: DEFAULT_WHY['only-listed'] });
  const confirm = names.filter((t) => tools[t]?.confirm === true);
  if (confirm.length) list.push({ id: 'confirm', type: 'confirm', tools: confirm, derived: true, why: DEFAULT_WHY.confirm });
  const limited = names.filter((t) => Number.isInteger(tools[t]?.maxPerTrace));
  if (limited.length) list.push({ id: 'max-per-trace', type: 'max-per-trace', tools: limited, derived: true, why: DEFAULT_WHY['max-per-trace'] });
  for (const r of Array.isArray(policy.rules) ? policy.rules : EMPTY) if (isObj(r) && RULE_TYPES.has(r.type)) list.push(r);
  RULES.set(policy, list);
  return list;
}

const REGEX = new Map();
function cleanFlags(flags) {
  return String(flags || '').replace(/[^imsu]/g, '');
}
function regex(pattern, flags) {
  const key = `${flags}/${pattern}`;
  if (REGEX.has(key)) return REGEX.get(key);
  let re = null;
  try { re = new RegExp(String(pattern), flags); } catch { re = null; }
  if (REGEX.size > 500) REGEX.clear();
  REGEX.set(key, re);
  return re;
}

function covers(rule, name) {
  if (rule.type === 'only-listed') return true;
  if (rule.tools === '*') return true;
  if (Array.isArray(rule.tools)) return rule.tools.includes(name);
  return !TOOLS_REQUIRED.has(rule.type);
}

function applies(when, n) {
  if (!isObj(when) || !when.path) return true;
  return String(detailValue(n, when.path) ?? '') === String(when.equals ?? '');
}

const argAt = (call, path) => (isObj(call.args) || Array.isArray(call.args) ? getPath(call.args, path) : undefined);
const missing = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const t = v.replace(/[$,\s]/g, '');
  return t === '' ? NaN : Number(t);
}
const shown = (v) => (typeof v === 'string' ? v : str(v));
const okish = (c) => c.state === 'ok' || c.state === 'none';
const lastOf = (list) => list[list.length - 1];

// The first leaf value (as a path) whose text matches re.
function findLeaf(value, re, path = '') {
  if (value == null) return null;
  if (typeof value !== 'object') { re.lastIndex = 0; return re.test(String(value)) ? path : null; }
  for (const [k, v] of Object.entries(value)) {
    const p = Array.isArray(value) ? `${path}[${k}]` : path ? `${path}.${k}` : k;
    const hit = findLeaf(v, re, p);
    if (hit != null) return hit;
  }
  return null;
}

function confirmationRegexes(policy) {
  const list = Array.isArray(policy.confirmationPatterns) ? policy.confirmationPatterns : DEFAULT_CONFIRMATION_PATTERNS;
  return list.map((p) => (typeof p === 'string' ? regex(p, 'i') : null)).filter(Boolean);
}

// Ask before acting: the most recent message from the user before the call says yes, and it
// answers the agent's latest proposal. Agent text sent together with a tool call ("Applying it
// now.") is the agent acting, not proposing, so it is skipped, unless it asks a question.
function actsNow(n, steps, i) {
  const s = steps[i], next = steps[i + 1];
  if (next?.kind !== 'tool_call') return false;
  if (/\?["')\s]*$/.test(String(s.text))) return false;
  return next.id.startsWith(`${s.id}.`) || n.shape === 'openai-responses';
}

function confirmFact(n, call, patterns, who) {
  const steps = n.steps;
  let user = null, proposal = null;
  for (let i = call.index - 1; i >= 0; i--) {
    const s = steps[i];
    if (!user && s.kind === 'user' && String(s.text || '').trim()) user = { i, text: s.text };
    if (!proposal && s.kind === 'assistant' && String(s.text || '').trim() && !actsNow(n, steps, i)) proposal = { i };
    if (user && proposal) break;
  }
  if (!user && n.input && String(n.input).trim()) user = { i: -1, text: String(n.input) };
  if (!user) return `${call.name} called without a yes from the ${who}.`;
  if (proposal && proposal.i > user.i) return `${call.name} called before the ${who} answered the agent's last message.`;
  if (!patterns.some((re) => re.test(user.text))) return `${call.name} called without a yes from the ${who}: their last message does not agree to it.`;
  return null;
}

function ruleFact(rule, call, ctx) {
  const { n, policy, calls, ci, who } = ctx;
  const tool = call.name;
  const earlier = calls.slice(0, ci);
  switch (rule.type) {
    case 'only-listed':
      return isObj(policy.tools) && Object.prototype.hasOwnProperty.call(policy.tools, tool) ? null : `${tool} called, but it is not on the policy's list of tools.`;
    case 'deny-tools':
      return `${tool} called, and this policy never allows it.`;
    case 'deny-access': {
      const access = rule.access === 'read' ? 'read' : 'write';
      if (toolAccess(policy, tool) !== access) return null;
      return access === 'write' ? `${tool} called, and it changes something (a write action).` : `${tool} called, and it reads data (a read action).`;
    }
    case 'confirm':
      return confirmFact(n, call, ctx.patterns, who);
    case 'max-per-trace': {
      if (call.state === 'error') return null;
      const limit = limitFor(rule, tool, policy);
      if (!Number.isFinite(limit)) return null;
      const count = earlier.filter((c) => c.name === tool && c.state !== 'error').length + 1;
      return count > limit ? `${tool} called ${plural(count, 'time', 'times')}; the limit is ${limit} per conversation.` : null;
    }
    case 'requires-before': {
      const prior = earlier.filter((c) => c.name === rule.before);
      if (prior.some((c) => c.state !== 'error')) return null;
      return prior.length ? `${tool} called after ${rule.before} failed.` : `${tool} called before ${rule.before}.`;
    }
    case 'approval-above': {
      const raw = argAt(call, rule.argPath);
      const v = toNumber(raw);
      if (!(Number.isFinite(v) && v > Number(rule.max))) return null;
      const prior = earlier.filter((c) => c.name === rule.approvalTool);
      if (prior.some(okish)) return null;
      const head = `${tool} called with ${rule.argPath} ${shown(raw)}`;
      if (!prior.length) return `${head} without an earlier ${rule.approvalTool}.`;
      const last = lastOf(prior);
      if (last.state === 'pending') return `${head} while ${rule.approvalTool} was still pending.`;
      return `${head} after ${rule.approvalTool} returned ${last.status ? `status "${last.status}"` : 'an error'}.`;
    }
    case 'arg-max': case 'arg-min': {
      const raw = argAt(call, rule.argPath);
      const v = toNumber(raw);
      if (!Number.isFinite(v)) return null;
      if (rule.type === 'arg-max') return v > Number(rule.max) ? `${tool} called with ${rule.argPath} ${shown(raw)}, above the limit of ${rule.max}.` : null;
      return v < Number(rule.min) ? `${tool} called with ${rule.argPath} ${shown(raw)}, below the minimum of ${rule.min}.` : null;
    }
    case 'arg-in': {
      const raw = argAt(call, rule.argPath);
      if (missing(raw)) return null;
      const allowed = (Array.isArray(rule.values) ? rule.values : EMPTY).map(String);
      const bad = (Array.isArray(raw) ? raw : [raw]).map(shown).filter((x) => !allowed.includes(x));
      return bad.length ? `${tool} called with ${rule.argPath} "${bad[0]}", which is not one of: ${allowed.join(', ')}.` : null;
    }
    case 'arg-not-match': {
      const re = regex(rule.pattern, cleanFlags(rule.flags));
      if (!re) return null;
      let text, where;
      if (rule.argPath) {
        const raw = argAt(call, rule.argPath);
        if (missing(raw)) return null;
        text = shown(raw);
        where = rule.argPath;
      } else {
        text = call.argsText;
        where = findLeaf(call.args, re);
      }
      const m = re.exec(text);
      if (!m) return null;
      const end = m[0].trim();
      const tail = end.length > 4 ? end.slice(-4) : end;
      return `${tool} called with a value that matches a forbidden pattern${where ? ` in ${where}` : ''} (ending "${tail}").`;
    }
    case 'arg-required':
      return missing(argAt(call, rule.argPath)) ? `${tool} called without ${rule.argPath}.` : null;
    case 'arg-equals': {
      const raw = argAt(call, rule.argPath);
      if (missing(raw)) return null;
      const src = rule.source || {};
      if (src.detail) {
        const want = detailValue(n, src.detail);
        if (missing(want)) return null;
        if (shown(raw).trim() === shown(want).trim()) return null;
        return `${tool} called with ${rule.argPath} ${shown(raw)}, but this trace's ${String(src.detail).replace(/^metadata\./, '')} is ${shown(want)}.`;
      }
      const from = lastOf(earlier.filter((c) => c.name === src.tool && okish(c) && c.result && !missing(getPath(c.result.data, src.path))));
      if (!from) return `${tool} called with ${rule.argPath} ${shown(raw)}, but no earlier ${src.tool} returned ${src.path} to match.`;
      const want = getPath(from.result.data, src.path);
      if (shown(raw).trim() === shown(want).trim()) return null;
      return `${tool} called with ${rule.argPath} ${shown(raw)}, but ${src.tool} returned ${shown(want)}.`;
    }
    default:
      return null;
  }
}

/**
 * Check one normalized trace against a policy: { verdict: 'pass'|'fail', violations }.
 * Each violation is { ruleId, ruleType, label, stepId, tool, fact, message, why }, where
 * message is the fact followed by the rule's why. opts: { userLabel, ruleIds } (ruleIds
 * limits the rules checked; empty means all).
 */
export function evaluatePolicy(policy, normalizedTrace, { userLabel = 'customer', ruleIds = null } = {}) {
  const violations = [];
  const n = normalizedTrace;
  if (!isObj(policy) || !n) return { verdict: 'pass', violations };
  const who = String(userLabel || 'customer');
  let rules = policyRules(policy);
  if (Array.isArray(ruleIds) && ruleIds.length) {
    const keep = new Set(ruleIds);
    rules = rules.filter((r) => keep.has(r.id));
  }
  rules = rules.filter((r) => applies(r.when, n));
  if (!rules.length) return { verdict: 'pass', violations };
  const calls = toolCallList(n);
  const ctx = { n, policy, calls, ci: 0, who, patterns: confirmationRegexes(policy) };
  calls.forEach((call, ci) => {
    ctx.ci = ci;
    for (const rule of rules) {
      if (!covers(rule, call.name)) continue;
      const fact = ruleFact(rule, call, ctx);
      if (!fact) continue;
      const why = fill((rule.derived && policy.tools?.[call.name]?.why) || rule.why || '', who).trim();
      violations.push({
        ruleId: rule.id, ruleType: rule.type, label: ruleLabel(rule, call.name, policy),
        stepId: call.stepId, tool: call.name, fact, message: why ? `${fact} ${why}` : fact, why,
      });
    }
  });
  return { verdict: violations.length ? 'fail' : 'pass', violations };
}

// ------------------------------------------------------------------ relevance

/** Plain labels for the three relevance problems. */
export const RELEVANCE_LABELS = {
  missing: 'Skipped a needed tool',
  unexpected: "Called a tool the request didn't need",
  forbidden: 'Called a tool this request must never use',
};

/**
 * Relevance of the tool calls for the trace's intent:
 * { verdict, intent, label, applies, missing, unexpected, forbidden, argIssues, calls, detail }.
 * A trace with no intent, or an intent the map does not list, passes with applies false.
 */
export function evaluateRelevance(intents, normalizedTrace) {
  const n = normalizedTrace;
  const from = typeof intents?.intentFrom === 'string' && intents.intentFrom.trim() ? intents.intentFrom.trim() : 'metadata.intent';
  const base = { verdict: 'pass', intent: null, label: null, applies: false, missing: [], unexpected: [], forbidden: [], argIssues: [], calls: [] };
  const raw = n ? detailValue(n, from) : undefined;
  const value = raw == null || typeof raw === 'object' ? '' : String(raw).trim();
  if (!value) return { ...base, detail: 'No intent on this trace' };
  const list = Array.isArray(intents?.intents) ? intents.intents.filter(isObj) : EMPTY;
  const low = value.toLowerCase();
  const it = list.find((x) => x.id === value) || list.find((x) => String(x.id ?? '').toLowerCase() === low || String(x.label ?? '').toLowerCase() === low);
  if (!it) return { ...base, intent: value, detail: `The intent "${value}" is not in the intent map` };
  const names = toolCallList(n).map((c) => c.name);
  const called = unique(names);
  const expect = isNames(it.expect) ? it.expect : EMPTY;
  const allow = isNames(it.allow) ? it.allow : EMPTY;
  const never = isNames(it.never) ? it.never : EMPTY;
  const miss = unique(expect.filter((t) => !called.includes(t)));
  const forbidden = called.filter((t) => never.includes(t));
  const unexpected = called.filter((t) => !expect.includes(t) && !allow.includes(t) && !never.includes(t));
  const parts = [];
  if (miss.length) parts.push(`${RELEVANCE_LABELS.missing}: ${miss.join(', ')}.`);
  if (forbidden.length) parts.push(`${RELEVANCE_LABELS.forbidden}: ${forbidden.join(', ')}.`);
  if (unexpected.length) parts.push(`${RELEVANCE_LABELS.unexpected}: ${unexpected.join(', ')}.`);
  const label = String(it.label || it.id);
  return {
    verdict: parts.length ? 'fail' : 'pass', intent: it.id, label, applies: true,
    missing: miss, unexpected, forbidden, argIssues: [], calls: names,
    detail: parts.length ? parts.join(' ') : `Right tools for "${label}".`,
  };
}

// ------------------------------------------------------------------ output grounding

const NUM = '((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';
const MER = '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)';
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const UNITS = 'mbps|gbps|kbps|gb|mb|tb|kb|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|miles?|km|kg|lbs?|pounds?|ounces?|oz|feet|ft|inches';
const DASH = `(?:-|${EN_DASH}|to|until|till|through|and)`;

const pad2 = (x) => String(x).padStart(2, '0');
const numNorm = (s) => {
  const v = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? String(v) : null;
};
function to24(h, m, mer) {
  let hour = Number(h);
  const min = m == null || m === '' ? 0 : Number(m);
  if (!Number.isInteger(hour) || min > 59) return null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    const pm = /^p/i.test(mer);
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) return null;
  return `${pad2(hour)}:${pad2(min)}`;
}
function dateNorm(month, day) {
  const mo = Number(month), d = Number(day);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return `${pad2(mo)}-${pad2(d)}`;
}
const monthOf = (name) => MONTH_INDEX[String(name).slice(0, 3).toLowerCase()];

// Value patterns in priority order; a later match that overlaps an earlier one is dropped.
const PATTERNS = [
  { kind: 'money', re: new RegExp(`\\$\\s?${NUM}`, 'g'), norm: (m) => numNorm(m[1]) },
  { kind: 'money', re: new RegExp(`(?<![\\w.,])${NUM}\\s?(?:dollars?|usd|bucks)\\b`, 'gi'), norm: (m) => numNorm(m[1]) },
  { kind: 'money', re: new RegExp(`\\busd\\s?${NUM}`, 'gi'), norm: (m) => numNorm(m[1]) },
  { kind: 'percent', re: new RegExp(`(?<![\\w.,])${NUM}\\s?(?:%|percent\\b)`, 'gi'), norm: (m) => numNorm(m[1]) },
  { kind: 'date', re: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, norm: (m) => dateNorm(m[2], m[3]) },
  { kind: 'date', re: new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4}\\b(?![-/]\\d))?`, 'gi'), norm: (m) => dateNorm(monthOf(m[1]), m[2]) },
  { kind: 'date', re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS})\\b\\.?(?:,?\\s+\\d{4}\\b(?![-/]\\d))?`, 'gi'), norm: (m) => dateNorm(monthOf(m[2]), m[1]) },
  { kind: 'date', re: /(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(?:\d{4}|\d{2}))?(?![\d/])/g, norm: (m) => dateNorm(m[1], m[2]) },
  {
    kind: 'time',
    re: new RegExp(`(?<![\\d:.])(\\d{1,2})(?::(\\d{2}))?\\s*${MER}?\\s*${DASH}\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MER}?(?![\\w:])`, 'gi'),
    norm: (m) => {
      const [, h1, m1, mer1, h2, m2, mer2] = m;
      if (!(m1 != null || m2 != null || mer1 || mer2)) return null;
      // A missing half-day word comes from the other end: "8 to 10 AM", "11 to 1 PM", "9 AM to 5".
      const flip = (mer) => (/^p/i.test(mer) ? 'AM' : 'PM');
      let first = mer1, last = mer2;
      if (!first && last) first = Number(h1) % 12 > Number(h2) % 12 ? flip(last) : last;
      if (!last && first && m1 == null && m2 == null) last = Number(h2) % 12 < Number(h1) % 12 ? flip(first) : first;
      const a = to24(h1, m1, first);
      const b = to24(h2, m2, last);
      const text = (h, mm, mer) => `${h}${mm != null ? ':' + mm : ''}${mer ? ' ' + mer.replace(/\s+/g, '') : ''}`;
      return a && b ? [{ norm: a, raw: text(h1, m1, first) }, { norm: b, raw: text(h2, m2, last) }] : null;
    },
  },
  { kind: 'time', re: new RegExp(`(?<![\\d:+\\-.])(\\d{1,2}):(\\d{2})(?::\\d{2})?(?:\\s*${MER}(?![a-z]))?(?!\\d)`, 'gi'), norm: (m) => to24(m[1], m[2], m[3]) },
  { kind: 'time', re: new RegExp(`(?<![\\d:.])(\\d{1,2})\\s*${MER}(?![a-z])`, 'gi'), norm: (m) => to24(m[1], null, m[2]) },
  {
    kind: 'id',
    re: /\b(?:confirmation|reference|ref|ticket|order|case|booking|tracking|visit|request)\s*(?:number|no\.?|code|id)?\s*(?:is\s*)?[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/gi,
    norm: (m) => (/\d/.test(m[1]) ? m[1].toUpperCase().replace(/-/g, '') : null),
    raw: (m) => m[1],
  },
  { kind: 'id', re: /\b([A-Z]{2,}-?\d{3,}|[A-Z]-\d{3,})\b/g, norm: (m) => m[1].replace(/-/g, '') },
  { kind: 'id', re: /#(\d{4,})\b/g, norm: (m) => m[1] },
  { kind: 'number', re: new RegExp(`(?<![\\w.,$])${NUM}\\s?(?:business\\s+)?(?:${UNITS})\\b`, 'gi'), norm: (m) => numNorm(m[1]) },
];

function scan(text) {
  const src = String(text ?? '');
  const taken = [];
  const found = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && x < b);
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src)) !== null) {
      if (m[0] === '') { p.re.lastIndex++; continue; }
      const a = m.index, b = m.index + m[0].length;
      if (!free(a, b)) continue;
      const norm = p.norm(m);
      if (norm == null) continue;
      taken.push([a, b]);
      // "12:00 PM." keeps the half-day word but drops the sentence's period.
      const raw = (p.raw ? p.raw(m) : m[0]).trim().replace(/([^.][ap]m)\.$/i, '$1');
      for (const nv of Array.isArray(norm) ? norm : [norm]) {
        if (typeof nv === 'object') found.push({ raw: nv.raw.replace(/([^.][ap]m)\.$/i, '$1'), norm: nv.norm, kind: p.kind, at: a });
        else found.push({ raw, norm: nv, kind: p.kind, at: a });
      }
    }
  }
  found.sort((x, y) => x.at - y.at);
  return { found, taken };
}

/**
 * Checkable values in text: money, percentages, times, dates, numbers with units, and ids or
 * codes. Returns [{ raw, norm, kind }] in text order. Normalized: "$1,234.50" -> "1234.5";
 * "9:30 AM" and "09:30" -> "09:30"; "2pm" -> "14:00"; "Sept 25", "2026-09-25", and
 * "Friday, September 25" -> "09-25"; "OUT-7742" -> "OUT7742".
 */
export function extractValues(text) {
  return scan(String(text ?? '').replace(CURLY, "'")).found.map(({ raw, norm, kind }) => ({ raw, norm, kind }));
}

const keyOf = (v) => (v.kind === 'money' || v.kind === 'number' || v.kind === 'percent' ? `num:${v.norm}` : `${v.kind}:${v.norm}`);

// Keys for every value found in one source text, plus every standalone number outside them.
function addKeys(set, text) {
  const src = String(text ?? '');
  if (!src) return;
  const { found, taken } = scan(src);
  for (const v of found) set.add(keyOf(v));
  const re = /(?<![\w.])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![\d])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const a = m.index, b = a + m[0].length;
    if (taken.some(([x, y]) => a < y && x < b)) continue;
    const nv = numNorm(m[1]);
    if (nv != null) set.add(`num:${nv}`);
  }
}

const SOURCES = new WeakMap();
// Everything in the trace a reply may quote: tool results, tool arguments, retrieved documents, and user messages.
function sourceKeys(n) {
  let set = SOURCES.get(n);
  if (set) return set;
  set = new Set();
  if (n.input) addKeys(set, n.input);
  for (const s of n.steps || EMPTY) {
    if (s.kind === 'user' || s.kind === 'tool_result' || s.kind === 'tool_call') addKeys(set, s.text);
    else if (s.kind === 'tool' || s.kind === 'handoff') {
      addKeys(set, str(s.data?.input ?? s.data?.arguments ?? s.data?.args));
      addKeys(set, str(s.data?.output ?? s.data?.result));
    } else if (s.kind === 'retrieval') {
      addKeys(set, str(s.data?.input));
      for (const d of Array.isArray(s.data?.documents) ? s.data.documents : EMPTY) addKeys(set, `${str(d?.title)}\n${str(d?.text)}`);
      addKeys(set, str(s.data?.output ?? s.data?.result));
    }
  }
  SOURCES.set(n, set);
  return set;
}

function grounded(v, keys) {
  if (keys.has(keyOf(v))) return true;
  if (v.kind === 'percent') {
    const frac = numNorm(Number(v.norm) / 100);
    return frac != null && keys.has(`num:${frac}`);
  }
  return false;
}

const replyText = (n) => (n?.output ? outputText(n.output) : '');

/**
 * Output grounding, first pass: every value in the final reply (money, percentages, times,
 * dates, numbers with units, ids) must appear, normalized, in a tool result, tool argument,
 * retrieved document, or user message of the same trace. Exact values only, no paraphrase.
 * Returns { verdict, values, ungrounded: [{ raw, norm, kind }], detail, stepId }.
 * opts.text replaces the final reply.
 */
export function groundedValues(normalizedTrace, { text } = {}) {
  const n = normalizedTrace || { steps: [] };
  const reply = text != null ? String(text) : replyText(n);
  const stepId = n.output?.stepId ?? null;
  const seen = new Set();
  const values = extractValues(reply).filter((v) => {
    const k = `${v.kind}:${v.norm}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!values.length) return { verdict: 'pass', values, ungrounded: [], detail: 'No numbers, dates, times, or codes in the reply', stepId };
  const keys = sourceKeys(n);
  const ungrounded = values.filter((v) => !grounded(v, keys));
  if (!ungrounded.length) {
    const detail = values.length === 1 ? 'The one value in the reply appears in the trace' : `All ${values.length} values in the reply appear in the trace`;
    return { verdict: 'pass', values, ungrounded, detail, stepId };
  }
  return { verdict: 'fail', values, ungrounded, detail: `Not found in tool results: ${unique(ungrounded.map((v) => v.raw)).join(', ')}`, stepId };
}

const SUCCESS = /\b(done|booked|confirmed|applied|refunded|cancell?ed|scheduled|updated|all set|taken care of)\b/gi;
const NOT_A_CLAIM = /(?:\bnot|\bno|\bnever|n't|\bunable to|\bcannot|\bfailed to|\byet to|\bonce|\bwhen|\bif|\buntil|\bafter|\bbefore)[\s,]+(?:[\w']+[\s,]+){0,4}$/i;
const SAYS_PENDING = /\b(pending|waiting|awaiting|not yet|queued|in review|needs? (?:a )?supervisor|supervisor(?:'s)? approval|once (?:it'?s |it is )?approved)\b/i;
const SAYS_FAILED = /\b(couldn't|could not|can't|cannot|unable|failed|error|didn't go through|did not go through|wasn't able|was not able|did not work|didn't work|on hold|denied|declined|went wrong)\b/i;

/**
 * Output grounding, first pass: fail when the final reply claims success (done, booked,
 * confirmed, applied, refunded, cancelled, scheduled, updated, all set, taken care of) while the
 * most recent write call (any call when no policy is given) returned an error or a pending result.
 * Negated claims ("isn't applied yet") and replies that say it is pending or failed pass.
 * Returns { verdict, detail, tool, stepId, status }. opts.text replaces the final reply.
 */
export function successAfterError(normalizedTrace, policy = null, { text } = {}) {
  const n = normalizedTrace || { steps: [] };
  const reply = (text != null ? String(text) : replyText(n)).replace(CURLY, "'");
  const outAt = n.output ? (n.steps || EMPTY).findIndex((s) => s.id === n.output.stepId) : -1;
  const calls = toolCallList(n).filter((c) => outAt < 0 || c.index < outAt);
  const pool = isObj(policy) ? calls.filter((c) => toolAccess(policy, c.name) === 'write') : calls;
  const last = lastOf(pool);
  const kind = isObj(policy) ? 'write call' : 'call';
  const none = { verdict: 'pass', tool: null, stepId: null, status: null };
  if (!last) return { ...none, detail: isObj(policy) ? 'No write calls before the reply' : 'No tool calls before the reply' };
  const info = { tool: last.name, stepId: last.stepId, status: last.status };
  if (last.state !== 'error' && last.state !== 'pending') return { verdict: 'pass', ...info, detail: `The last ${kind} (${last.name}) did not fail` };
  const statusText = last.status ? `status "${last.status}"` : last.state === 'pending' ? 'a pending result' : 'an error';
  let claim = null;
  SUCCESS.lastIndex = 0;
  let m;
  while ((m = SUCCESS.exec(reply)) !== null) {
    if (!NOT_A_CLAIM.test(reply.slice(Math.max(0, m.index - 60), m.index))) { claim = m[0]; break; }
  }
  const admits = SAYS_PENDING.test(reply) || SAYS_FAILED.test(reply);
  if (!claim || admits) return { verdict: 'pass', ...info, detail: `${last.name} returned ${statusText}, and the reply does not claim success` };
  return { verdict: 'fail', ...info, detail: `The reply says "${claim}", but ${last.name} returned ${statusText}` };
}
