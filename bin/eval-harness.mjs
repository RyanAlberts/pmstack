#!/usr/bin/env node
/** Trusted local execution. A suite is data; commands come only from --adapter. */
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateSuite, inspectSuite, gradeTrial, summarizeRun, reportMarkdown } from '../docs/workspace/eval-engine.mjs';

const usage = 'Usage: eval-harness.mjs validate <suite.json> | run <suite.json> --adapter <trusted-adapter.json> --output <new-directory> | report <run.json>';
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
async function readJSON(path) { const raw = await readFile(path, 'utf8'); requireValue(Buffer.byteLength(raw) <= 10_000_000, 'JSON input exceeds 10 MB.'); return { raw, value: JSON.parse(raw) }; }
function adapterConfig(input, base) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Adapter must be an object.');
  requireValue(Object.keys(input).every(k => ['target', 'setup', 'observe', 'graders'].includes(k)), 'Unknown adapter field.');
  function command(value) {
    requireValue(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => ['command', 'timeoutMs'].includes(k)), 'Invalid command configuration.');
    requireValue(Array.isArray(value.command) && value.command.length > 0 && value.command.length <= 50 && value.command.every(x => typeof x === 'string' && x.length <= 10000 && !x.includes('\0')), 'Command must be a bounded argv array.');
    requireValue(Number.isInteger(value.timeoutMs) && value.timeoutMs >= 10 && value.timeoutMs <= 600000, 'timeoutMs must be 10–600000.');
    return { command: value.command.map(arg => arg.startsWith('./') || arg.startsWith('../') ? resolve(base, arg) : arg), timeoutMs: value.timeoutMs };
  }
  const result = { target: command(input.target), graders: Object.create(null) };
  if (input.setup) result.setup = command(input.setup);
  if (input.observe) result.observe = command(input.observe);
  if (input.graders !== undefined) {
    requireValue(input.graders && typeof input.graders === 'object' && !Array.isArray(input.graders) && Object.keys(input.graders).length <= 100, 'Invalid graders mapping.');
    for (const [id, config] of Object.entries(input.graders)) {
      requireValue(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id), 'Invalid grader identifier.');
      result.graders[id] = command(config);
    }
  }
  return result;
}
function execute(config, input, cwd) {
  return new Promise(resolveResult => {
    let stdout = '', stderr = '', bytes = 0, error = null, settled = false;
    const child = spawn(config.command[0], config.command.slice(1), { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    function kill() { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} }
    const timer = setTimeout(() => { error = 'Command timed out.'; kill(); }, config.timeoutMs);
    function finish(code, signal) {
      if (settled) return; settled = true; clearTimeout(timer);
      resolveResult({ stdout, stderr, code, signal, error: error || (code === 0 ? null : `Command exited ${code ?? signal ?? 'without status'}.`) });
    }
    function collect(chunk, stream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_000_000) { error = 'Command output exceeded 1 MB.'; kill(); return; }
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => collect(chunk, 'stdout'));
    child.stderr.on('data', chunk => collect(chunk, 'stderr'));
    child.on('error', err => { error = `Could not launch command: ${err.message}`; finish(null, null); });
    child.on('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
function parseStage(result, stage, errors, allowEmpty = false) {
  if (result.error) { errors.push({ stage, message: result.error, stderr: result.stderr.slice(0, 4000) }); return null; }
  try {
    const value = allowEmpty && !result.stdout.trim() ? {} : JSON.parse(result.stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('expected a JSON object');
    return value;
  } catch (error) { errors.push({ stage, message: `Invalid JSON response: ${error.message}` }); return null; }
}
async function runSuite(suitePath, adapterPath, outputPath) {
  const suite = validateSuite((await readJSON(suitePath)).value), readiness = inspectSuite(suite);
  requireValue(readiness.ready, readiness.issues.filter(i => i.level === 'error').map(i => i.message).join('\n'));
  const adapterFile = await readJSON(adapterPath), adapter = adapterConfig(adapterFile.value, dirname(resolve(adapterPath)));
  const output = resolve(outputPath);
  await mkdir(output); // No recursive or overwrite mode: each execution gets a new artifact directory.
  const run = { schemaVersion: 1, suite, adapter: { configPath: resolve(adapterPath), sha256: createHash('sha256').update(adapterFile.raw).digest('hex'), outcomeObserverConfigured: Boolean(adapter.observe), isolation: 'Fresh working directory per trial; NOT an operating-system security sandbox.' }, startedAt: new Date().toISOString(), trials: [], summary: null };
  for (const task of suite.tasks) for (let trial = 1; trial <= suite.plan.trials; trial++) {
    const started = Date.now(), workspace = await mkdtemp(join(tmpdir(), 'pmstack-eval-'));
    const publicTask = Object.fromEntries(['id', 'name', 'prompt', 'context', 'successCriteria'].map(key => [key, task[key]]));
    const input = { task: publicTask, environment: suite.environment, workspace, trial };
    const evidence = { output: null, transcript: null, outcome: null, graderResults: {} }, errors = [], stages = {};
    if (adapter.setup) { stages.setup = await execute(adapter.setup, input, workspace); parseStage(stages.setup, 'setup', errors, true); }
    if (!errors.length) {
      stages.target = await execute(adapter.target, input, workspace);
      const returned = parseStage(stages.target, 'target', errors);
      if (returned) {
        if (!Object.hasOwn(returned, 'output')) errors.push({ stage: 'target', message: 'Target response is missing output.' });
        else { evidence.output = returned.output; evidence.transcript = returned.transcript ?? null; }
        // Deliberately ignore target-returned outcome, verdict, and graderResults.
      }
    }
    if (!errors.length && adapter.observe) {
      stages.observe = await execute(adapter.observe, { ...input, output: evidence.output, transcript: evidence.transcript }, workspace);
      const observed = parseStage(stages.observe, 'observe', errors);
      if (observed) {
        if (!Object.hasOwn(observed, 'outcome') || observed.outcome === null || typeof observed.outcome !== 'object' || Array.isArray(observed.outcome)) errors.push({ stage: 'observe', message: 'Observer must return an outcome object.' });
        else evidence.outcome = observed.outcome;
      }
    }
    if (!errors.length) for (const grader of task.graders.filter(g => g.type !== 'code')) {
      const config = adapter.graders[grader.id];
      if (!config) continue;
      const result = await execute(config, { task: publicTask, grader, reference: task.reference, evidence: { output: evidence.output, transcript: evidence.transcript, outcome: evidence.outcome }, workspace, trial }, workspace);
      stages[`grader:${grader.id}`] = result;
      const judgment = parseStage(result, `grader:${grader.id}`, errors);
      if (judgment) {
        if (judgment.status === 'unknown') continue;
        if (!Number.isFinite(judgment.score) || judgment.score < 0 || judgment.score > 1 || typeof judgment.reason !== 'string' || !judgment.reason.trim()) errors.push({ stage: `grader:${grader.id}`, message: 'Grader must return score 0–1 and nonempty reason, or status unknown.' });
        else evidence.graderResults[grader.id] = { score: judgment.score, reason: judgment.reason };
      }
    }
    let graded;
    try { graded = gradeTrial(suite, task.id, evidence); }
    catch (error) { errors.push({ stage: 'grading', message: error.message }); graded = { status: 'unknown', score: null, grades: [] }; }
    const row = { taskId: task.id, trial, status: errors.length ? 'invalid' : graded.status, output: evidence.output, transcript: evidence.transcript, outcome: evidence.outcome, graderResults: evidence.graderResults, grades: graded.grades, score: graded.score, errors, durationMs: Date.now() - started, workspace, stages };
    run.trials.push(row);
    await writeFile(join(output, `${task.id}-${trial}.json`), `${JSON.stringify(row, null, 2)}\n`, { flag: 'wx' });
    run.summary = summarizeRun(suite, run.trials);
    await writeFile(join(output, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    process.stderr.write(`${task.id} / ${trial}: ${row.status}\n`);
  }
  run.finishedAt = new Date().toISOString();
  run.summary = summarizeRun(suite, run.trials);
  await writeFile(join(output, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(join(output, 'report.md'), reportMarkdown(run), { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ output, status: run.summary.status, planned: run.summary.planned, invalid: run.summary.invalid, unknown: run.summary.unknown }, null, 2)}\n`);
  if (run.summary.status !== 'pass') process.exitCode = 1;
}
async function main() {
  const [command, path, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') { process.stdout.write(`${usage}\n`); return; }
  requireValue(path, usage);
  if (command === 'validate') {
    requireValue(!args.length, usage);
    const suite = validateSuite((await readJSON(path)).value), inspection = inspectSuite(suite);
    process.stdout.write(`${JSON.stringify({ id: suite.id, ...inspection }, null, 2)}\n`);
    if (!inspection.ready) process.exitCode = 1;
  } else if (command === 'report') {
    requireValue(!args.length, usage);
    const run = (await readJSON(path)).value;
    process.stdout.write(reportMarkdown(run));
    if (summarizeRun(run.suite, run.trials).status !== 'pass') process.exitCode = 1;
  } else if (command === 'run') {
    requireValue(args.length === 4, usage);
    const options = {};
    for (let i = 0; i < args.length; i += 2) { requireValue(['--adapter', '--output'].includes(args[i]) && !options[args[i]] && args[i + 1], usage); options[args[i]] = args[i + 1]; }
    requireValue(options['--adapter'] && options['--output'], usage);
    await runSuite(path, options['--adapter'], options['--output']);
  } else throw Error(usage);
}
main().catch(error => { process.stderr.write(`eval-harness: ${error.message}\n`); process.exitCode = 2; });
