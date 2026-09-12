/** Browser-safe evaluation contracts and deterministic grading. No execution or network access. */
const fail = message => { throw new Error(`Invalid evaluation: ${message}`); };
function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be an object`);
  if (Object.keys(value).some(key => !keys.includes(key))) fail(`unknown ${label} field`);
}
function string(value, label, max = 20000) { if (typeof value !== 'string' || value.length > max) fail(label); return value; }
function identifier(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) fail('identifier'); return value; }
function number(value, label, min, max) { if (!Number.isFinite(value) || value < min || value > max) fail(label); return value; }
function integer(value, label, min, max) { number(value, label, min, max); if (!Number.isInteger(value)) fail(label); return value; }
function choice(value, values, label) { if (!values.includes(value)) fail(label); return value; }
function boolean(value, label) { if (typeof value !== 'boolean') fail(label); return value; }
function array(value, label, max = 100) { if (!Array.isArray(value) || value.length > max) fail(label); return value; }
function unique(values, label) { if (new Set(values).size !== values.length) fail(`duplicate ${label}`); }
function json(value, depth = 0, maxString = 20000) {
  if (depth > 12) fail('JSON nesting');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return string(value, 'JSON string', maxString);
  if (typeof value === 'number') return number(value, 'JSON number', -1e15, 1e15);
  if (Array.isArray(value)) return array(value, 'JSON array', 1000).map(item => json(item, depth + 1, maxString));
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    if (Object.keys(value).length > 1000) fail('JSON object size');
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('unsafe JSON key');
      string(key, 'JSON key', 200); copy[key] = json(item, depth + 1, maxString);
    }
    return copy;
  }
  fail('non-JSON value');
}
function checkDefinition(value) {
  record(value, ['operator', 'path', 'expected', 'min', 'max'], 'check');
  const check = { operator: choice(value.operator, ['equals', 'contains', 'exists', 'number-range'], 'operator'), path: string(value.path, 'path', 500) };
  if (check.path.split('.').some(x => ['__proto__', 'prototype', 'constructor'].includes(x))) fail('unsafe check path');
  if (['equals', 'contains'].includes(check.operator)) {
    if (!Object.hasOwn(value, 'expected')) fail('expected required');
    check.expected = json(value.expected);
  }
  if (check.operator === 'number-range') {
    if (value.min === undefined && value.max === undefined) fail('number-range needs a bound');
    if (value.min !== undefined) check.min = number(value.min, 'minimum', -1e15, 1e15);
    if (value.max !== undefined) check.max = number(value.max, 'maximum', -1e15, 1e15);
    if (check.min !== undefined && check.max !== undefined && check.min > check.max) fail('reversed range');
  }
  return check;
}
export function validateSuite(input) {
  record(input, ['schemaVersion', 'id', 'name', 'example', 'target', 'product', 'purpose', 'environment', 'plan', 'tasks'], 'suite');
  if (input.schemaVersion !== 1) fail('schemaVersion');
  record(input.target, ['kind', 'description', 'version'], 'target');
  record(input.product, ['customer', 'job', 'success'], 'product');
  record(input.environment, ['description', 'mode', 'reset', 'context', 'tools', 'memory', 'dependencies', 'constraints'], 'environment');
  record(input.plan, ['trials', 'k', 'mix', 'rationale', 'passRateThreshold'], 'plan');
  const target = { kind: choice(input.target.kind, ['model', 'coding-agent', 'conversational-agent', 'research-agent', 'computer-use-agent', 'long-running-agent'], 'target kind'), description: string(input.target.description, 'target description'), version: string(input.target.version, 'target version', 200) };
  const product = Object.fromEntries(['customer', 'job', 'success'].map(key => [key, string(input.product[key], key)]));
  const environment = { description: string(input.environment.description, 'environment description'), mode: choice(input.environment.mode, ['pinned', 'live'], 'environment mode'), reset: choice(input.environment.reset, ['fresh-trial', 'session-sequence'], 'environment reset'), ...Object.fromEntries(['context', 'memory', 'dependencies', 'constraints'].map(key => [key, string(input.environment[key], key)])), tools: array(input.environment.tools, 'tools').map(x => string(x, 'tool', 500)) };
  const plan = { trials: integer(input.plan.trials, 'trials', 1, 100), k: integer(input.plan.k, 'k', 1, 100), mix: choice(input.plan.mix, ['balanced', 'production-weighted'], 'mix'), rationale: string(input.plan.rationale, 'plan rationale'), passRateThreshold: number(input.plan.passRateThreshold, 'pass rate threshold', 0, 1) };
  if (plan.k > plan.trials) fail('k cannot exceed trials');
  const tasks = array(input.tasks, 'tasks').map(task => {
    record(task, ['id', 'name', 'prompt', 'context', 'successCriteria', 'category', 'difficulty', 'customerValue', 'weight', 'critical', 'reference', 'graders'], 'task');
    record(task.reference, ['description', 'output', 'outcome'], 'reference');
    const outcome = json(task.reference.outcome);
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) fail('reference outcome must be an object');
    const graders = array(task.graders, 'graders', 30).map(grader => {
      record(grader, ['id', 'name', 'type', 'source', 'required', 'weight', 'threshold', 'check', 'rubric', 'calibration'], 'grader');
      const result = { id: identifier(grader.id), name: string(grader.name, 'grader name', 200), type: choice(grader.type, ['code', 'model', 'human'], 'grader type'), source: choice(grader.source, ['outcome', 'output', 'transcript'], 'grader source'), required: boolean(grader.required, 'required'), weight: number(grader.weight, 'grader weight', 0.000001, 1000000), threshold: number(grader.threshold, 'threshold', 0, 1), rubric: string(grader.rubric, 'rubric'), calibration: string(grader.calibration, 'calibration') };
      if (grader.check !== undefined) result.check = checkDefinition(grader.check);
      if (result.type === 'code' && !result.check) fail('code grader requires check');
      return result;
    });
    unique(graders.map(g => g.id), 'grader in task');
    if (!graders.some(g => g.required)) fail('task requires a required grader');
    return { id: identifier(task.id), name: string(task.name, 'task name', 200), prompt: string(task.prompt, 'prompt'), context: string(task.context, 'context'), successCriteria: string(task.successCriteria, 'successCriteria'), category: choice(task.category, ['positive', 'negative', 'edge', 'adversarial'], 'category'), difficulty: string(task.difficulty, 'difficulty', 200), customerValue: string(task.customerValue, 'customerValue'), critical: task.critical === undefined ? false : boolean(task.critical, 'critical'), weight: number(task.weight, 'task weight', 0.000001, 1000000), reference: { description: string(task.reference.description, 'reference description'), output: string(task.reference.output, 'reference output'), outcome }, graders };
  });
  if (!tasks.length || tasks.length * plan.trials > 1000) fail('suite needs 1–1000 planned trials');
  unique(tasks.map(t => t.id), 'task');
  return { schemaVersion: 1, id: identifier(input.id), name: string(input.name, 'name', 200), example: boolean(input.example, 'example'), target, product, purpose: choice(input.purpose, ['capability', 'regression'], 'purpose'), environment, plan, tasks };
}
function pathValue(value, path) {
  if (!path) return value;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
function evaluateCheck(value, check) {
  if (check.operator === 'exists') return value !== undefined && value !== null;
  if (value === undefined) return false;
  if (check.operator === 'equals') return canonical(value) === canonical(check.expected);
  if (check.operator === 'contains') return typeof value === 'string' && typeof check.expected === 'string' ? value.includes(check.expected) : Array.isArray(value) && value.some(x => canonical(x) === canonical(check.expected));
  return typeof value === 'number' && Number.isFinite(value) && (check.min === undefined || value >= check.min) && (check.max === undefined || value <= check.max);
}
export function gradeTrial(input, taskId, evidence) {
  const suite = validateSuite(input), task = suite.tasks.find(t => t.id === taskId);
  if (!task) fail('unknown task');
  const grades = task.graders.map(grader => {
    let score = null, reason;
    const source = evidence?.[grader.source];
    if (source === undefined || source === null) reason = `Missing ${grader.source} evidence; no passing score inferred.`;
    else if (grader.type === 'code') {
      score = evaluateCheck(pathValue(source, grader.check.path), grader.check) ? 1 : 0;
      reason = `${grader.check.operator} check on ${grader.source}${grader.check.path ? `.${grader.check.path}` : ''} ${score ? 'passed' : 'failed'}.`;
    } else {
      const external = evidence.graderResults?.[grader.id];
      if (external && Number.isFinite(external.score) && external.score >= 0 && external.score <= 1 && typeof external.reason === 'string' && external.reason.trim()) { score = external.score; reason = external.reason; }
      else reason = `${grader.type} judgment unavailable or malformed; independent review required.`;
    }
    return { id: grader.id, name: grader.name, type: grader.type, source: grader.source, required: grader.required, weight: grader.weight, score, status: score === null ? 'unknown' : (grader.type === 'code' ? score === 1 : score >= grader.threshold) ? 'pass' : 'fail', reason };
  });
  const required = grades.filter(g => g.required), scored = grades.filter(g => g.score !== null);
  return { status: required.some(g => g.status === 'unknown') ? 'unknown' : required.some(g => g.status === 'fail') ? 'fail' : 'pass', score: scored.length ? scored.reduce((sum, g) => sum + g.score * g.weight, 0) / scored.reduce((sum, g) => sum + g.weight, 0) : null, grades };
}
export function checkReference(input, taskId) {
  const suite = validateSuite(input), task = suite.tasks.find(t => t.id === taskId);
  if (!task) fail('unknown task');
  return { taskId, ...gradeTrial(suite, taskId, { output: task.reference.output, outcome: task.reference.outcome }) };
}
export function inspectSuite(input) {
  const suite = validateSuite(input), issues = [], graderCounts = { code: 0, model: 0, human: 0 }, categoryCounts = {};
  for (const key of ['customer', 'job', 'success']) if (!suite.product[key].trim()) issues.push({ level: 'error', message: `Define the product ${key}.` });
  if (!suite.environment.description.trim()) issues.push({ level: 'error', message: 'Describe the task environment before running.' });
  if (!suite.target.description.trim() || !suite.target.version.trim()) issues.push({ level: 'warning', message: 'Record the target description and version so comparisons identify the evaluated system.' });
  if (!suite.plan.rationale.trim()) issues.push({ level: 'warning', message: 'Explain why this task mix and trial plan represent the product question.' });
  if (suite.environment.mode === 'live') issues.push({ level: 'warning', message: 'Live dependencies may change between trials; capture their versions and observed state.' });
  if (!suite.tasks.some(t => t.category === 'negative' || t.category === 'adversarial')) issues.push({ level: 'warning', message: 'Add a case where the behavior must not occur.' });
  for (const task of suite.tasks) {
    categoryCounts[task.category] = (categoryCounts[task.category] || 0) + 1;
    for (const [key, label] of [['name', 'task name'], ['prompt', 'task prompt'], ['successCriteria', 'success criteria'], ['customerValue', 'customer value']]) if (!task[key].trim()) issues.push({ level: 'error', taskId: task.id, message: `Define the ${label}.` });
    if (!task.reference.description.trim()) issues.push({ level: 'warning', taskId: task.id, message: 'Explain why the reference is a valid solution and how it was reviewed.' });
    for (const grader of task.graders) {
      graderCounts[grader.type]++;
      if (grader.type !== 'code' && !grader.calibration.trim()) issues.push({ level: 'warning', taskId: task.id, message: `Calibrate ${grader.name} against human examples before relying on it.` });
    }
    const reference = checkReference(suite, task.id);
    if (reference.grades.some(g => g.required && g.status === 'fail')) issues.push({ level: 'error', taskId: task.id, message: 'The reference fails a required deterministic check. Repair the task or grader before running.' });
    if (reference.grades.some(g => g.required && g.status === 'unknown')) issues.push({ level: 'warning', taskId: task.id, message: 'The reference needs additional transcript evidence or independent human/model review.' });
  }
  return { ready: !issues.some(i => i.level === 'error'), issues, taskCount: suite.tasks.length, plannedTrials: suite.tasks.length * suite.plan.trials, graderCounts, categoryCounts };
}
function normalizeTrials(suite, input) {
  const keys = new Set();
  return array(input, 'trials', 1000).map(raw => {
    record(raw, ['taskId', 'trial', 'status', 'output', 'transcript', 'outcome', 'graderResults', 'grades', 'score', 'errors', 'durationMs', 'workspace', 'stages'], 'trial');
    const task = suite.tasks.find(t => t.id === raw.taskId);
    if (!task) fail('unknown trial task');
    const trial = integer(raw.trial, 'trial number', 1, suite.plan.trials);
    const key = `${task.id}/${trial}`; if (keys.has(key)) fail('duplicate trial'); keys.add(key);
    const errors = array(raw.errors ?? [], 'trial errors', 100).map(error => {
      record(error, ['stage', 'message', 'stderr'], 'trial error');
      const result = { stage: string(error.stage, 'error stage', 200), message: string(error.message, 'error message') };
      if (error.stderr !== undefined) result.stderr = string(error.stderr, 'error stderr', 1000000);
      return result;
    });
    const stages = json(raw.stages ?? {}, 0, 1000000);
    if (!stages || Array.isArray(stages) || typeof stages !== 'object') fail('stages');
    for (const [stage, result] of Object.entries(stages)) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail('stage result');
      if (result.error || (result.code !== undefined && result.code !== 0) || result.signal) {
        if (!errors.some(error => error.stage === stage)) errors.push({ stage, message: typeof result.error === 'string' && result.error ? result.error : `Recorded execution failure: exit ${result.code ?? result.signal ?? 'unknown'}.` });
      }
    }
    const evidence = {
      output: raw.output === undefined ? null : json(raw.output, 0, 1000000),
      transcript: raw.transcript === undefined ? null : json(raw.transcript, 0, 1000000),
      // Only this separate field is outcome evidence. Never recover it from target stdout or a completion claim.
      outcome: raw.outcome === undefined ? null : json(raw.outcome, 0, 1000000),
      graderResults: json(raw.graderResults ?? {}, 0, 1000000)
    };
    if (evidence.outcome !== null && (typeof evidence.outcome !== 'object' || Array.isArray(evidence.outcome))) fail('outcome must be an object');
    if (!evidence.graderResults || typeof evidence.graderResults !== 'object' || Array.isArray(evidence.graderResults)) fail('graderResults');
    const graded = gradeTrial(suite, task.id, evidence);
    const row = { taskId: task.id, trial, ...evidence, ...graded, status: errors.length ? 'invalid' : graded.status, errors, stages };
    if (raw.durationMs !== undefined) row.durationMs = number(raw.durationMs, 'durationMs', 0, 1e12);
    if (raw.workspace !== undefined) row.workspace = string(raw.workspace, 'workspace', 4000);
    return row;
  });
}
/** Recompute all grades and statuses. Saved summaries and verdicts are not authoritative. */
export function validateRun(raw) {
  record(raw, ['schemaVersion', 'suite', 'adapter', 'startedAt', 'finishedAt', 'trials', 'summary'], 'run');
  if (raw.schemaVersion !== 1) fail('run schemaVersion');
  const suite = validateSuite(raw.suite), trials = normalizeTrials(suite, raw.trials);
  const run = { schemaVersion: 1, suite, trials };
  if (raw.adapter !== undefined) run.adapter = json(raw.adapter);
  for (const key of ['startedAt', 'finishedAt']) if (raw[key] !== undefined) run[key] = string(raw[key], key, 100);
  run.summary = summarizeRun(suite, trials);
  return run;
}
export function summarizeRun(input, suppliedTrials) {
  const suite = validateSuite(input), trials = normalizeTrials(suite, suppliedTrials);
  const byTask = suite.tasks.map(task => {
    const rows = trials.filter(t => t.taskId === task.id), count = status => rows.filter(t => t.status === status).length;
    const passed = count('pass'), failed = count('fail'), valid = passed + failed, passRate = valid ? passed / valid : null;
    return { taskId: task.id, name: task.name, category: task.category, difficulty: task.difficulty, weight: task.weight, planned: suite.plan.trials, valid, passed, failed, unknown: count('unknown'), invalid: count('invalid'), missing: suite.plan.trials - rows.length, passRate, estimatedPassAtK: passRate === null ? null : 1 - (1 - passRate) ** suite.plan.k, estimatedPassPowerK: passRate === null ? null : passRate ** suite.plan.k };
  });
  const total = field => byTask.reduce((sum, task) => sum + task[field], 0), validTasks = byTask.filter(t => t.valid);
  const average = (field, weighted = false) => validTasks.length ? validTasks.reduce((sum, t) => sum + t[field] * (weighted ? t.weight : 1), 0) / validTasks.reduce((sum, t) => sum + (weighted ? t.weight : 1), 0) : null;
  const slices = { category: Object.create(null), difficulty: Object.create(null) };
  for (const dimension of Object.keys(slices)) for (const value of new Set(byTask.map(t => t[dimension]))) {
    const rows = byTask.filter(t => t[dimension] === value), valid = rows.reduce((s, t) => s + t.valid, 0);
    slices[dimension][value] = { tasks: rows.length, valid, passed: rows.reduce((s, t) => s + t.passed, 0), unknown: rows.reduce((s, t) => s + t.unknown, 0), invalid: rows.reduce((s, t) => s + t.invalid, 0), missing: rows.reduce((s, t) => s + t.missing, 0), passRate: valid ? rows.reduce((s, t) => s + t.passed, 0) / valid : null };
  }
  const unknown = total('unknown'), invalid = total('invalid'), missing = total('missing'), valid = total('valid'), weightedPassRate = average('passRate', true), macroPassRate = average('passRate');
  const criticalFailed = suite.tasks.filter(task => task.critical && byTask.find(t => t.taskId === task.id).failed > 0).map(t => t.id);
  const performance = suite.plan.mix === 'production-weighted' ? weightedPassRate : macroPassRate;
  return { status: unknown || invalid || missing ? 'incomplete' : !criticalFailed.length && performance >= suite.plan.passRateThreshold ? 'pass' : 'fail', criticalFailed, planned: total('planned'), completed: trials.length, valid, passed: total('passed'), failed: total('failed'), unknown, invalid, missing, passRate: valid ? total('passed') / valid : null, macroPassRate, weightedPassRate, estimatedPassAtK: average('estimatedPassAtK', suite.plan.mix === 'production-weighted'), estimatedPassPowerK: average('estimatedPassPowerK', suite.plan.mix === 'production-weighted'), k: suite.plan.k, assumptions: 'Pass@k and pass^k are plug-in estimates from each task’s observed success rate, assuming independent, identically distributed attempts. Small samples are uncertain. Unknown and invalid trials are excluded from performance denominators but block a complete decision. These estimates are not guarantees.', byTask, slices, issues: [...(unknown ? ['Required grades remain unknown.'] : []), ...(invalid ? ['Execution or evaluation infrastructure failed; inspect stage errors.'] : []), ...(missing ? ['Planned trials are missing.'] : [])] };
}
export function reportMarkdown(input) {
  const run = validateRun(input), suite = run.suite, summary = run.summary, safe = value => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/([\\`*_{}\[\]#|])/g, '\\$1'), rate = value => value === null ? 'unknown' : `${(value * 100).toFixed(1)}%`;
  return [`# ${safe(suite.name)}`, '', suite.example ? '**Example suite. Results describe this configured example, not a model benchmark.**' : '**Evaluation of the configured system and environment; not a general model ranking.**', '', `Decision: **${summary.status}** against ${rate(suite.plan.passRateThreshold)} ${suite.plan.mix} pass-rate threshold.`, `Target: ${safe(suite.target.description)} (${safe(suite.target.version)})`, `Purpose: ${suite.purpose}`, ...(summary.criticalFailed.length ? [`Critical failures: ${summary.criticalFailed.map(safe).join(', ')}. These block acceptance regardless of the aggregate rate.`] : []), '', `Planned: ${summary.planned}; valid graded: ${summary.valid}; passed: ${summary.passed}; failed: ${summary.failed}; unknown: ${summary.unknown}; invalid: ${summary.invalid}; missing: ${summary.missing}.`, '', `Observed pass rate: ${rate(summary.passRate)}. Macro: ${rate(summary.macroPassRate)}. Weighted: ${rate(summary.weightedPassRate)}.`, `Estimated pass@${summary.k}: ${rate(summary.estimatedPassAtK)}. Estimated pass^${summary.k}: ${rate(summary.estimatedPassPowerK)}.`, '', summary.assumptions, '', '## Tasks', '', '| Task | Pass / valid | Unknown | Invalid | Missing | Estimated pass@k | Estimated pass^k |', '| --- | --- | --- | --- | --- | --- | --- |', ...summary.byTask.map(t => `| ${safe(t.name)} | ${t.passed}/${t.valid} | ${t.unknown} | ${t.invalid} | ${t.missing} | ${rate(t.estimatedPassAtK)} | ${rate(t.estimatedPassPowerK)} |`), '', '## Trial evidence', '', ...run.trials.flatMap(t => [`### ${safe(t.taskId)} / trial ${t.trial}: ${t.status}`, '', ...(t.errors || []).map(e => `- ${safe(e.stage)}: ${safe(e.message)}`), ...(t.grades || []).map(g => `- ${safe(g.name)}: ${g.status}; score ${g.score ?? 'unknown'}. ${safe(g.reason)}`), '']), 'Per-trial workspaces isolate ordinary state, not host permissions. Grades are recomputed from supplied evidence; saved verdicts are ignored. Recorded outcomes and human/model judgments are unsigned assertions: this report does not independently authenticate their origin. Outcome evidence must come from an observer, not the target’s completion claim. Review rubric calibration and customer consequences before making a release decision.', ''].join('\n');
}
