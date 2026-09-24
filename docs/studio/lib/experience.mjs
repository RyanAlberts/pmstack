// experience.mjs: the product setup. Stage kinds, how-your-AI-works patterns
// (named after Anthropic's "Building effective agents"), trace views, and the
// stage matcher that places each step of a trace in a stage.

/** Kinds of stage, used to line different products up on the same stage kinds. */
export const COLUMNS = [
  { id: 'ask', label: 'Ask', question: 'Did we get a usable request?' },
  { id: 'understand', label: 'Understand', question: 'Did it grasp what the {userLabel} wants?' },
  { id: 'gather', label: 'Gather', question: 'Did it pull the right facts?' },
  { id: 'plan', label: 'Plan', question: 'Did it pick a sensible approach?' },
  { id: 'act', label: 'Act', question: 'Did it use tools correctly and safely?' },
  { id: 'check', label: 'Check', question: 'Did its own checks catch problems?' },
  { id: 'answer', label: 'Answer', question: 'Is the reply correct, clear, and in the right tone?' },
  { id: 'outcome', label: 'Outcome', question: 'Did the {userLabel} end up where they needed to be?' },
];

const TOOL_KINDS = ['tool_call', 'tool_result', 'tool'];
const st = (id, label, column, match = {}) => ({ id, label, column, match });

/** The eight ways an AI product can be built, with default stages for each. */
export const PATTERNS = [
  {
    id: 'single', label: 'One model call', anthropicName: 'single LLM call',
    summary: 'One prompt goes in and one reply comes out. No tools, no look-ups.',
    whenToUse: 'Drafting, rewriting, or answering from what is already in the prompt.',
    stages: [st('understand', 'Understand the request', 'understand'), st('answer', 'Reply', 'answer', { last: 'assistant' })],
  },
  {
    id: 'augmented', label: 'One call with tools', anthropicName: 'the augmented LLM',
    summary: 'One model that can search, look things up, and call tools before it replies.',
    whenToUse: 'Assistants that check a calendar, a database, or documents to answer.',
    stages: [
      st('understand', 'Understand the request', 'understand'),
      st('gather', 'Look things up', 'gather', { kinds: ['retrieval'] }),
      st('act', 'Use tools', 'act', { kinds: [...TOOL_KINDS] }),
      st('answer', 'Reply', 'answer', { last: 'assistant' }),
    ],
  },
  {
    id: 'chain', label: 'Step by step chain', anthropicName: 'prompt chaining',
    summary: 'A fixed series of model calls, each working on the last one\'s output, often with a quality gate in between.',
    whenToUse: 'Tasks that split cleanly into steps, such as research, then draft, then polish.',
    stages: [
      st('understand', 'Understand the request', 'understand'),
      st('draft', 'First draft', 'plan', { kinds: ['llm'] }),
      st('gate', 'Quality gate', 'check', { kinds: ['guardrail'] }),
      st('final', 'Final pass', 'answer', { last: 'assistant' }),
    ],
  },
  {
    id: 'routing', label: 'Sort and route', anthropicName: 'routing',
    summary: 'A first step sorts the request, then sends it down the path built for that kind of request.',
    whenToUse: 'Products that handle a few distinct kinds of requests, such as returns versus product questions.',
    stages: [
      st('classify', 'Sort the request', 'understand'),
      st('route', 'Pick the right path', 'plan', { kinds: ['handoff'] }),
      st('handle', 'Handle it', 'act', { kinds: [...TOOL_KINDS, 'retrieval', 'llm'] }),
      st('answer', 'Reply', 'answer', { last: 'assistant' }),
    ],
  },
  {
    id: 'parallel', label: 'Split into parallel parts', anthropicName: 'parallelization',
    summary: 'Several model calls work at once on parts of the task, or on the same task for a vote, and the results are combined.',
    whenToUse: 'Long inputs that split into sections, or decisions that gain from several independent opinions.',
    stages: [
      st('split', 'Split the work', 'plan'),
      st('workers', 'Work in parallel', 'act', { kinds: ['llm', ...TOOL_KINDS] }),
      st('screen', 'Safety screen', 'check', { kinds: ['guardrail'] }),
      st('merge', 'Combine results', 'answer', { last: 'assistant' }),
    ],
  },
  {
    id: 'orchestrator', label: 'Planner and workers', anthropicName: 'orchestrator-workers',
    summary: 'A planner decides what needs doing, hands pieces to workers, and combines what they send back.',
    whenToUse: 'Open-ended tasks where the steps depend on the request, such as research briefs or changes across many files.',
    stages: [
      st('plan', 'Plan the work', 'plan'),
      st('delegate', 'Hand out tasks', 'plan', { kinds: ['handoff'] }),
      st('workers', 'Workers act', 'act', { kinds: ['llm', ...TOOL_KINDS, 'retrieval'] }),
      st('synthesize', 'Combine results', 'answer', { last: 'assistant' }),
    ],
  },
  {
    id: 'evaluator', label: 'Draft and critique loop', anthropicName: 'evaluator-optimizer',
    summary: 'One call drafts, another critiques the draft against a clear bar, and the draft is revised until it passes.',
    whenToUse: 'Work with a clear quality bar, such as summaries or translations that must keep every fact.',
    stages: [
      st('draft', 'Draft', 'act', { kinds: ['llm'] }),
      st('critique', 'Critique', 'check', { kinds: ['guardrail'] }),
      st('revise', 'Revise', 'act'),
      st('answer', 'Final answer', 'answer', { last: 'assistant' }),
    ],
  },
  {
    id: 'agent', label: 'Agent', anthropicName: 'autonomous agent',
    summary: 'The model picks its own steps, uses tools in a loop, and checks its progress until the task is done.',
    whenToUse: 'Long tasks with steps nobody can list in advance, such as fixing code or working a support case.',
    stages: [
      st('clarify', 'Clarify the task', 'understand'),
      st('gather', 'Gather context', 'gather', { kinds: ['retrieval'] }),
      st('plan', 'Plan', 'plan'),
      st('act', 'Take actions', 'act', { kinds: [...TOOL_KINDS] }),
      st('check', 'Check results', 'check', { kinds: ['guardrail'] }),
      st('report', 'Report back', 'answer', { last: 'assistant' }),
    ],
  },
];

/** The built-in ways to draw a trace. */
export const VIEWS = [
  { id: 'chat', label: 'Chat or call', description: 'Messages as bubbles: text messages, web chat, or a phone call transcript.' },
  { id: 'email', label: 'Email', description: 'An email with From, To, and Subject, the way the recipient saw it.' },
  { id: 'document', label: 'Document', description: 'A longer piece of writing, laid out like an article.' },
  { id: 'answer', label: 'Answer with sources', description: 'An answer with numbered citations and the sources behind them.' },
  { id: 'agent', label: 'Agent steps', description: 'Every step the AI took, in order, with what each tool got and returned.' },
  { id: 'code-review', label: 'Code review', description: 'A pull request diff with the review comments in place.' },
  { id: 'fields', label: 'Form fields', description: 'Values pulled from a document, each checked against the source.' },
  { id: 'list', label: 'Ranked list or cards', description: 'Numbered picks or results, each with its reason.' },
  { id: 'layout', label: 'Build your own view', description: 'Pick which fields to show and how to show each one.' },
  { id: 'auto', label: 'Automatic', description: 'Pick a view from the shape of each trace.' },
];

const VIEW_IDS = new Set(VIEWS.map((v) => v.id));

/** Suggested words for the person who uses the product. */
export const USER_LABELS = ['customer', 'patient', 'employee', 'developer', 'shopper', 'prospect'];

/** Stage ids the engine keeps for itself. */
export const RESERVED_STAGE_IDS = ['unknown', 'start'];

/** Return a known view id, a custom:<id> view, or 'auto'. */
export function normalizeViewId(id) {
  if (typeof id !== 'string') return 'auto';
  if (VIEW_IDS.has(id)) return id;
  if (/^custom:[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return id;
  return 'auto';
}

const cloneMatch = (m) => {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
};

/** A fresh product setup with the default stages of the chosen pattern. */
export function defaultExperience({ product = '', userLabel = 'customer', customerGoal = '', pattern = 'single', renderer = 'auto', filters = [] } = {}) {
  const pat = PATTERNS.find((p) => p.id === pattern) || PATTERNS[0];
  return {
    product,
    userLabel: userLabel || 'customer',
    customerGoal,
    renderer: normalizeViewId(renderer),
    rendererBy: null,
    pattern: pat.id,
    stages: pat.stages.map((s) => ({ ...s, match: cloneMatch(s.match) })),
    fieldMap: null,
    layout: null,
    filters: [...(filters || [])],
    reviewer: '',
    gate: 10,
    groupGate: 30,
  };
}

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);

// One stage's match rule as a test function. Keys are ORed; {} matches no step.
function compileMatch(stage) {
  const m = stage?.match || {};
  const tests = [];
  const roles = asList(m.roles);
  if (roles.length) tests.push((s) => roles.includes(s.role));
  const kinds = asList(m.kinds);
  if (kinds.length) tests.push((s) => kinds.includes(s.kind));
  const tools = asList(m.tools);
  if (tools.length) tests.push((s) => s.name != null && tools.includes(s.name));
  if (typeof m.namePattern === 'string' && m.namePattern) {
    try {
      const re = new RegExp(m.namePattern, 'i');
      tests.push((s) => s.name != null && re.test(s.name));
    } catch {
      // An invalid pattern is skipped here; validateProject reports it.
    }
  }
  if (m.last === 'assistant') tests.push((s) => s.isOutput === true);
  return { id: stage.id, test: (s) => tests.some((t) => t(s)) };
}

const COMPILED = new WeakMap();
const NO_STAGE = () => null;

/** Compile stage match rules once: returns (step) => stageId | null. A step's rawStage naming a real stage wins. */
export function compileStages(stages) {
  if (!Array.isArray(stages) || !stages.length) return NO_STAGE;
  let fn = COMPILED.get(stages);
  if (fn) return fn;
  const ids = new Set(stages.map((s) => s.id));
  const rules = stages.map(compileMatch);
  fn = (step) => {
    if (!step) return null;
    const pre = step.rawStage ?? step.stage;
    if (pre != null && ids.has(pre)) return pre;
    for (const r of rules) if (r.test(step)) return r.id;
    return null;
  };
  COMPILED.set(stages, fn);
  return fn;
}

const POSITIONS = new WeakMap();
function positions(experience) {
  const stages = experience?.stages;
  if (!Array.isArray(stages)) return new Map();
  let m = POSITIONS.get(stages);
  if (!m) {
    m = new Map(stages.map((s, i) => [s.id, i]));
    POSITIONS.set(stages, m);
  }
  return m;
}

/** 0-based position of a stage; Infinity for null, 'unknown', or a missing id. */
export function stageIndex(experience, stageId) {
  if (stageId == null) return Infinity;
  const i = positions(experience).get(stageId);
  return i == null ? Infinity : i;
}

/** Label of a stage, or "Unknown stage". */
export function stageLabel(experience, stageId) {
  const i = stageIndex(experience, stageId);
  return i === Infinity ? 'Unknown stage' : experience.stages[i].label;
}

/** 1-based stage number, or null. */
export function stageNumber(experience, stageId) {
  const i = stageIndex(experience, stageId);
  return i === Infinity ? null : i + 1;
}

/** True when the id names one of the project's stages. */
export function isStageId(experience, stageId) {
  return stageId != null && positions(experience).has(stageId);
}

/** The view for one normalized trace: rendererBy first, then the project view. */
export function viewFor(trace, experience) {
  const by = experience?.rendererBy;
  if (by && by.key && by.map) {
    const v = trace?.metadata?.[by.key];
    if (v != null && Object.prototype.hasOwnProperty.call(by.map, String(v))) return normalizeViewId(by.map[String(v)]);
  }
  return normalizeViewId(experience?.renderer);
}

/** The project's word for its user, or "customer". */
export function userWord(experience) {
  const w = typeof experience?.userLabel === 'string' ? experience.userLabel.trim() : '';
  return w || 'customer';
}

/** Replace {userLabel} in copy with the project's user word. */
export function withUser(text, experience) {
  return String(text ?? '').split('{userLabel}').join(userWord(experience));
}
