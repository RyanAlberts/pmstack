#!/usr/bin/env node
// pmstack: Eval Studio on a folder of traces, plus the commands that run, measure, and share checks.
// Node 20 or newer. No dependencies: it runs the same engine Eval Studio runs in the browser
// (docs/studio/lib). Exit codes: 0 all good, 1 checks failed or a limit was crossed,
// 2 a problem with the command or its files.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as lib from '../docs/studio/lib/index.mjs';

/** The pmstack version this command reports. */
export const VERSION = '2.0.0';

const CLI_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(CLI_PATH), '..');
const STUDIO_ROOT = path.join(REPO_ROOT, 'docs', 'studio');
const ASSETS_ROOT = path.join(REPO_ROOT, 'docs', 'assets');
const BODY_LIMIT = 50 * 1024 * 1024;
const CUSTOM_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const NUL = String.fromCharCode(0);
const BOM = String.fromCharCode(0xfeff);
const CHECKS_FORMAT = 'pmstack.checks/1';
const DEFAULT_PORT = 4173;
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

// ---------------------------------------------------------------------------
// Help text

const HELP = {
  main: `pmstack ${VERSION}: find how your AI product fails, then prove it's fixed.

Usage: node bin/pmstack.mjs <command> [options]

Start here
  studio [folder]                    Open Eval Studio on a folder of traces. Reviews save in the folder.
  import <trace-file>                Make a project file from a trace file, without opening the studio.

Build and measure checks
  check <project or checks file>     Run the code checks on every trace. Exits 1 when traces fail.
  judge <project> --check <id>       Run an AI judge with your own model command.
  agreement <project> --check <id>   See how often a check agrees with your labels.
  estimate <project> --check <id>    The likely true failure rate on traces you have not labeled.
  policy <traces or project>         Check every tool call against your company's rules.
  retrieval <project>                How often the sources an answer needed were found.

Share
  report <project>                   Write the report as Markdown, with a picture of the funnel.
  regression-set <project>           Write the traces every future version must still handle.
  checks <project>                   Write the code checks your engineers run on every change.
  validate <project>                 Look for problems in a project file.

Run "pmstack <command> --help" to see a command's options.
Exit codes: 0 all good, 1 checks failed or a limit was crossed, 2 a problem with the command or its files.`,

  studio: `Usage: pmstack studio [folder] [--port 4173] [--traces <file>] [--open]

Open Eval Studio on a folder of traces. Your reviews save to <folder>/pmstack/project.json,
where Claude Code and the other pmstack commands can read them. The folder defaults to
the current one.

The first time, pmstack uses traces.jsonl (or the only .jsonl, .json, or .csv file in the
folder), guesses how your product looks, and picks a first set of 20 traces to review.
You can change every guess in Set up.

Options
  --port <number>   Port to listen on (default 4173). Use 0 to pick a free port.
  --traces <file>   The trace file to use when the project is first made.
  --open            Open Eval Studio in your browser.

Eval Studio listens on 127.0.0.1 only, so your traces never leave this computer.
Press Ctrl+C to stop it.`,

  import: `Usage: pmstack import <trace-file> [--out <file>] [--view <id>] [--pattern <id>] [--name "..."]
       pmstack import <trace-file> --append [--version "Version 2"] [--out <file>]

Make a project file from a trace file. The traces stay in your file; the project points to it.
The project goes to pmstack/project.json next to the trace file, so "pmstack studio <that folder>"
opens it.

Options
  --out <file>        Where to write the project (default: pmstack/project.json next to the trace file).
  --view <id>         How a trace looks: ${lib.VIEWS.map((v) => v.id).join(', ')}, or custom:<id>.
  --pattern <id>      How your AI works: ${lib.PATTERNS.map((p) => p.id).join(', ')}.
  --name "..."        The product name (default: the folder name).
  --append            Add the traces to an existing project. Traces whose id is already there are skipped.
  --version "..."     With --append: tag the new traces with this version name, so you can compare
                      before and after. The first time, earlier traces are tagged "Version 1".

Without --view and --pattern, pmstack guesses both from your traces.`,

  validate: `Usage: pmstack validate <project.json>

Look for problems in a project file: reviews or labels that point to missing traces, unknown
stages, checks for failure modes that do not exist, broken patterns, and more.
Exits 0 when the file is fine, 1 when it has problems, 2 when it cannot be read.`,

  check: `Usage: pmstack check <project.json | checks.json> [--traces <file>] [--only-ci]
                     [--expect <regression.jsonl>] [--max-fail <n> | --max-fail-rate <0-1>]

Run code checks (rules a computer can test, including tool policies) on every trace and
print how many traces pass every check.

Options
  --traces <file>         The traces to check. Needed with a checks file; with a project it
                          replaces the project's traces.
  --only-ci               Run only the checks marked "Run on every change".
  --expect <file>         A regression set from "pmstack regression-set". Fails when a trace
                          that must pass a check now fails it, such as a fixed failure coming back.
  --max-fail <n>          Allow up to n failing traces before failing.
  --max-fail-rate <0-1>   Allow up to this share of failing traces, for example 0.05.

Without --expect or a limit, any failing trace fails the run.
Exits 0 when everything passes, 1 when traces fail, 2 when a check cannot run.`,

  judge: `Usage: pmstack judge <project.json> --check <id> --cmd "<command>" [options]

Run an AI judge on traces with your own model command. pmstack sends each prompt on the
command's standard input and reads Pass or Fail from what it prints. It never starts a shell.
Results save to the project every 10 traces, so Eval Studio shows them as they arrive.

Options
  --check <id>          The judge to run.
  --cmd "<command>"     The model command. {model} is replaced with the judge's pinned model.
                        Example: --cmd "claude -p --model {model}"
  --split <name>        Which traces: tuning (default), test, or unlabeled.
  --final               Needed with --split test. The final test is used once: running it
                        reveals the results. Run it again only to answer final test traces
                        that have no answer yet; after the judge changes, start a fresh
                        final test in Eval Studio.
  --batch <n>           Judge up to n traces per call (1 to 10, default 1).
  --concurrency <n>     Calls at the same time (default 4).
  --limit <n>           Judge at most n traces.
  --timeout <seconds>   Give up on a call after this long (default 120).
  --traces <file>       Judge traces from another file, such as a fresh production sample.
                        Works with --split unlabeled.

Traces set aside as examples for the prompt are never judged.
Exits 1 when some traces could not be judged.`,

  agreement: `Usage: pmstack agreement <project.json> --check <id> [--split tuning|test]

How often a check agrees with your labels, as two numbers:
  Catches real failures   Of the traces you marked as showing the problem, the share the check caught.
  Agrees on good traces   Of the traces you marked Good, the share the check also marked Good.

Code checks use every labeled trace. AI judges use the tuning set, or the final test once
it is revealed.`,

  estimate: `Usage: pmstack estimate <project.json> --check <id> [--traces <file>]

The likely true failure rate on traces you have not labeled: what the judge flagged,
corrected for the mistakes it made on your final test, with a 95% range.
It needs a revealed final test that is still current and judge results on unlabeled traces.

Options
  --traces <file>   Estimate on the traces in this file (judged with
                    "pmstack judge --split unlabeled --traces <file>").`,

  retrieval: `Usage: pmstack retrieval <project.json> [--k 5] [--traces <file>]

For answer bots that search documents: how often the sources an answer needed were found.
It uses the traces where you marked the needed sources in the answer view.

Options
  --k <n>           How many search results count as found (default 5). Match it to how many
                    results your product passes to the AI.
  --traces <file>   Measure a new run of the same questions, with the same trace ids, for
                    example after changing search settings.`,

  report: `Usage: pmstack report <project.json> [--out report.md]

Write what you found as Markdown: the funnel, failure modes, success modes, checks, and
next steps. A picture of the funnel is written beside it (report-funnel.svg) and linked.`,

  'regression-set': `Usage: pmstack regression-set <project.json> [--out regression.jsonl]

Write the traces every future version must still handle: failing traces of failure modes
you chose to fix or check, and Good traces that show success modes. Each line keeps the
original trace plus what it should do now and the input to replay.`,

  checks: `Usage: pmstack checks <project.json> [--out checks.json]

Write the code checks marked "Run on every change" to a file your engineers can run on
every code change: pmstack check checks.json --traces <file>`,

  policy: `Usage: pmstack policy <traces file | project.json> --policy <policy.json> [--user <word>] [--json]
       pmstack policy <traces file | project.json> --list-tools

Check every tool call against your company's rules (a pmstack policy file): which tools
the agent may use, when, and with what details. Prints each rule that was broken, the trace
and step, and why the rule exists.

Options
  --policy <file>   The policy file (format pmstack.policy/1).
  --list-tools      List each tool the traces use, how often, and a first guess at whether
                    it only reads or also changes something. A good start for a policy.
  --user <word>     What to call the people the agent serves in the results, such as employee
                    or patient (default: the project's word, or customer).
  --json            Print machine-readable results for scripts.

Exits 0 when no call breaks the policy, 1 when any does, 2 when a file cannot be read.`,
};

const usageOf = (name) => HELP[name].split('\n')[0];

// ---------------------------------------------------------------------------
// Small helpers

class CliError extends Error {
  constructor(message, exitCode = 2, extra = {}) {
    super(message);
    this.exitCode = exitCode;
    Object.assign(this, extra);
  }
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const stripBom = (s) => (s && s[0] === BOM ? s.slice(1) : s);
const commas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const plural = (n, one, many = one + 's') => `${commas(n)} ${n === 1 ? one : many}`;
const nowIso = () => new Date().toISOString();
const posix = (p) => p.split(path.sep).join('/');

function listIds(ids, max = 8) {
  const shown = ids.slice(0, max).join(', ');
  return ids.length > max ? `${shown} and ${ids.length - max} more` : shown;
}

function table(rows, right = []) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => {
    const s = String(c ?? '');
    return right.includes(i) ? s.padStart(widths[i]) : s.padEnd(widths[i]);
  }).join('   ').trimEnd());
}

function shownPath(file, cwd) {
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJsonQuiet(file) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function humanName(base) {
  const s = String(base || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'My product';
}

function viewName(id) {
  if (typeof id === 'string' && id.startsWith('custom:')) return `Custom view "${id.slice(7)}"`;
  return (lib.VIEWS.find((v) => v.id === id) || {}).label || String(id);
}

function patternName(id) {
  return (lib.PATTERNS.find((p) => p.id === id) || {}).label || String(id);
}

/** Split a command line into arguments, respecting single and double quotes. No shell is involved. */
export function splitArgs(command) {
  const s = String(command ?? '');
  const out = [];
  let cur = '';
  let has = false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === '\\' && i + 1 < s.length && /[\s"'\\]/.test(s[i + 1])) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new CliError(`The command has a ${quote === '"' ? 'double' : 'single'} quote that is never closed: ${s}`);
  if (has) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Reading and writing files

function jsonErrorLine(text, err) {
  const m = /line (\d+)/.exec(err.message);
  if (m) return Number(m[1]);
  const p = /position (\d+)/.exec(err.message);
  if (p) return text.slice(0, Number(p[1])).split('\n').length;
  return null;
}

function parseJsonText(text, label) {
  const src = stripBom(String(text));
  try {
    return JSON.parse(src);
  } catch (err) {
    const line = jsonErrorLine(src, err);
    const detail = /end of/i.test(err.message) || !src.trim()
      ? 'The file ends before it is complete.'
      : 'A comma, quote, or bracket is out of place.';
    throw new CliError(`${label} could not be read${line ? ` (line ${line})` : ''}. ${detail}`, 2, { status: 422, line, detail });
  }
}

function readJsonFile(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new CliError(`${label} was not found.`, 2, { missing: true });
    if (err.code === 'EISDIR') throw new CliError(`${label} is a folder, not a file.`);
    throw new CliError(`${label} could not be read: ${err.message}`);
  }
  return parseJsonText(text, label);
}

const traceCache = new Map();

// Parse a trace file, reusing the last parse while the file is unchanged.
function readTraceFile(file, { fieldMap = null, label = path.basename(file) } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new CliError(`The trace file ${label} was not found.`, 2, { missing: true });
  }
  if (!st.isFile()) throw new CliError(`The trace file ${label} is not a file.`);
  const key = `${st.mtimeMs}:${st.size}:${fieldMap ? JSON.stringify(fieldMap) : ''}`;
  const hit = traceCache.get(file);
  if (hit && hit.key === key) return hit.parsed;
  const parsed = lib.parseTraceFile(fs.readFileSync(file, 'utf8'), path.basename(file), { fieldMap });
  traceCache.set(file, { key, parsed });
  return parsed;
}

function tracesPathOf(projectPath, project) {
  const tf = project && typeof project.tracesFile === 'string' && project.tracesFile.trim() ? project.tracesFile : null;
  return tf ? path.resolve(path.dirname(projectPath), tf) : null;
}

function labelOf(projectPath) {
  return posix(path.join(path.basename(path.dirname(projectPath)), path.basename(projectPath)));
}

// Load project.json and fill its traces from the trace file it names (or from `tracesPath`).
function loadProject(projectPath, { tracesPath = null, label = labelOf(projectPath) } = {}) {
  const file = path.resolve(projectPath);
  const project = readJsonFile(file, label);
  if (!isObj(project)) throw new CliError(`${label} is not a pmstack project file.`);
  const from = tracesPath || tracesPathOf(file, project);
  let traces = Array.isArray(project.traces) ? project.traces : [];
  let parse = null;
  if (from) {
    parse = readTraceFile(from, { fieldMap: project.experience?.fieldMap || null, label: path.basename(from) });
    traces = parse.traces;
  }
  return { project: { ...project, traces }, file, tracesPath: from, parse };
}

/** Read a project file and fill its traces from the trace file it names (tracesFile is relative to the project's folder). */
export function loadProjectFile(projectPath, opts = {}) {
  return loadProject(projectPath, opts).project;
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock(lock, { timeoutMs, staleMs }) {
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      try { fs.writeSync(fd, `${process.pid}\n`); } finally { fs.closeSync(fd); }
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) {
        fs.unlinkSync(lock);
        continue;
      }
    } catch {
      continue; // the lock went away between the two calls; try again at once
    }
    if (Date.now() - start >= timeoutMs) {
      throw new CliError(`The project is locked by another program (${lock}). If nothing else is saving it, delete that file and try again.`);
    }
    await sleep(50);
  }
}

/**
 * Change a project file safely: take the pmstack/.lock file, re-read the file, apply fn(disk)
 * (disk is the file as stored, or null when it does not exist yet), bump the revision, write a
 * temporary file and rename it over the old one, then release the lock. When fn returns null
 * the file is left as it is. Returns { written, project, revision }.
 */
export async function withProjectLock(projectPath, fn, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  const file = path.resolve(projectPath);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  await acquireLock(lock, { timeoutMs, staleMs });
  try {
    const disk = fs.existsSync(file) ? readJsonFile(file, labelOf(file)) : null;
    const next = await fn(disk);
    if (next == null) return { written: false, project: disk, revision: disk ? disk.revision ?? null : null };
    const revision = disk ? (Number(disk.revision) || 0) + 1 : Number(next.revision) || 1;
    const stored = { ...lib.projectForDisk(next), revision };
    atomicWrite(file, JSON.stringify(stored, null, 2) + '\n');
    return { written: true, project: { ...next, revision }, revision };
  } finally {
    try { fs.unlinkSync(lock); } catch { /* already gone */ }
  }
}

/**
 * Save a project through the lock. `next` is the project to write, or a function that gets the
 * copy on disk and returns the project to write. Traces are left out when tracesFile is set.
 * Returns the saved project with its new revision.
 */
export async function saveProjectFile(projectPath, next) {
  const r = await withProjectLock(projectPath, (disk) => (typeof next === 'function' ? next(disk) : next));
  return r.project;
}

function withVersion(trace, version) {
  return { ...trace, metadata: { ...(isObj(trace.metadata) ? trace.metadata : {}), version } };
}

const hasVersion = (t) => isObj(t.metadata) && t.metadata.version != null && t.metadata.version !== '';

function lastByte(file) {
  const size = fs.statSync(file).size;
  if (!size) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function writeTraces(file, before, fresh, rewrite) {
  if (path.extname(file).toLowerCase() === '.json') {
    const cur = readJsonQuiet(file);
    const all = [...before, ...fresh];
    atomicWrite(file, JSON.stringify(isObj(cur) && Array.isArray(cur.traces) ? { ...cur, traces: all } : all, null, 2) + '\n');
    return;
  }
  if (rewrite) {
    atomicWrite(file, [...before, ...fresh].map((t) => JSON.stringify(t)).join('\n') + '\n');
    return;
  }
  const last = lastByte(file);
  fs.appendFileSync(file, (last && last !== '\n' ? '\n' : '') + fresh.map((t) => JSON.stringify(t)).join('\n') + '\n');
}

// Add traces to a project (its trace file, or project.json when traces are inline), skipping ids already there.
async function appendTraces(projectPath, incoming, { version = null, now = nowIso() } = {}) {
  let added = 0;
  let skipped = 0;
  let tagged = 0;
  const res = await withProjectLock(projectPath, (disk) => {
    if (!disk) throw new CliError(`${labelOf(projectPath)} was not found.`);
    const tracesPath = tracesPathOf(projectPath, disk);
    if (tracesPath && !/\.(jsonl|ndjson|json)$/i.test(tracesPath)) {
      throw new CliError(`New traces can only be added to a .jsonl or .json trace file, and this project uses ${path.basename(tracesPath)}. Save it as .jsonl, point the project to it, and try again.`);
    }
    const parsed = tracesPath ? readTraceFile(tracesPath, { fieldMap: disk.experience?.fieldMap || null }) : null;
    const existing = parsed ? parsed.traces : Array.isArray(disk.traces) ? disk.traces : [];
    const ids = new Set(existing.map((t) => String(t.id)));
    let fresh = [];
    for (const t of incoming) {
      const id = String(t.id);
      if (ids.has(id)) { skipped++; continue; }
      ids.add(id);
      fresh.push(t);
    }
    added = fresh.length;
    if (!added) return null;
    const where = tracesPath ? path.basename(tracesPath) : labelOf(projectPath);
    const room = lib.MAX_TRACES - existing.length;
    if (fresh.length > room) {
      throw new CliError(room > 0
        ? `A project holds up to 20,000 traces. ${where} has ${commas(existing.length)}, so ${commas(room)} more fit, not ${commas(fresh.length)}. Nothing was added.`
        : `A project holds up to 20,000 traces, and ${where} already has that many. Nothing was added.`);
    }
    // Rewriting the file keeps only what pmstack could read, so a file with unreadable lines or
    // entries is never rewritten (a .json file always is; a .jsonl file is when versions are tagged).
    const isJson = path.extname(tracesPath || '').toLowerCase() === '.json';
    const rewrites = parsed && (isJson || (version && !existing.some(hasVersion)));
    if (rewrites && parsed.errors.length) {
      const places = parsed.errors.map((e) => (/^(Line|Trace) \d+/.exec(e) || [])[0]).filter(Boolean);
      const what = places.length
        ? `${isJson ? 'entries' : 'lines'} pmstack could not read (${places.slice(0, 3).join(', ')}${places.length > 3 ? `, and ${commas(places.length - 3)} more` : ''})`
        : `a problem (${parsed.errors[0].replace(/\.$/, '')})`;
      throw new CliError(`${where} has ${what}, so the file was not changed. ${isJson ? 'Fix it and try again.' : 'Fix those lines, or add the traces without --version.'}`);
    }
    let before = existing;
    let experience = disk.experience;
    if (version) {
      fresh = fresh.map((t) => withVersion(t, version));
      if (!existing.some(hasVersion)) {
        before = existing.map((t) => withVersion(t, 'Version 1'));
        tagged = before.length;
      }
      const filters = Array.isArray(experience?.filters) ? experience.filters : [];
      if (!filters.includes('version')) experience = { ...(experience || {}), filters: [...filters, 'version'] };
    }
    const next = { ...disk, experience, updatedAt: now };
    if (tracesPath) {
      writeTraces(tracesPath, before, fresh, tagged > 0);
      return next;
    }
    return { ...next, traces: [...before, ...fresh] };
  });
  return { added, skipped, tagged, revision: res.revision };
}

// A first project for a set of traces: guessed view, pattern, stages, filters, and a first set of 20.
function guessProject({ traces, name, view = null, pattern = null, tracesFile = null, guessed = false, now = nowIso() }) {
  const experience = lib.defaultExperience({
    product: name,
    pattern: pattern || lib.suggestPattern(traces),
    renderer: view || lib.suggestView(traces),
    filters: lib.suggestFilters(traces),
  });
  let p = lib.createProject({ id: lib.slugId('', name, []), name, experience, traces, now });
  p = { ...p, tracesFile, settings: { ...p.settings, ...(guessed ? { guessed: true } : {}) } };
  return lib.setBatch(p, lib.nextBatch(p, { size: 20, strategy: 'mix' }), 'mix', { now });
}

function noteParseProblems(parsed, label, io) {
  const list = [...(parsed?.errors || []), ...(parsed?.warnings || [])];
  if (!list.length) return;
  io.err(`Note: ${label} has ${plural(list.length, 'line')} to look at:`);
  for (const e of list.slice(0, 5)) io.err(`  ${e}`);
  if (list.length > 5) io.err(`  and ${list.length - 5} more`);
}

// Load a project for a command, with optional --traces replacing its traces.
function openProject(args, io, { tracesFlag = 'traces' } = {}) {
  const file = path.resolve(io.cwd, args.positionals[0]);
  const label = shownPath(file, io.cwd);
  const override = tracesFlag && args.flags[tracesFlag] ? path.resolve(io.cwd, args.flags[tracesFlag]) : null;
  const loaded = loadProject(file, { tracesPath: override, label });
  const format = loaded.project.format;
  if (format !== lib.FORMAT) {
    throw new CliError(format === CHECKS_FORMAT
      ? `${label} is a checks file. This command needs a project file (pmstack/project.json).`
      : `${label} is not a pmstack project file.`);
  }
  if (loaded.tracesPath) noteParseProblems(loaded.parse, shownPath(loaded.tracesPath, io.cwd), io);
  return { ...loaded, label };
}

function findCheck(p, id) {
  const check = (p.checks || []).find((c) => c.id === id);
  if (check) return check;
  const ids = (p.checks || []).map((c) => c.id);
  throw new CliError(`No check with id "${id}".${ids.length ? ` Checks in this project: ${ids.join(', ')}.` : ' This project has no checks yet.'}`);
}

function modeOf(p, check) {
  const mode = (p.modes || []).find((m) => m.id === check.modeId);
  if (!mode) throw new CliError(`The check "${check.id}" belongs to a failure mode that no longer exists (${check.modeId}).`);
  return mode;
}

// ---------------------------------------------------------------------------
// Arguments

const FLAG = true;
const VALUE = 'value';

const COMMANDS = {
  studio: { run: cmdStudio, flags: { port: VALUE, traces: VALUE, open: FLAG }, min: 0, max: 1 },
  import: { run: cmdImport, flags: { out: VALUE, view: VALUE, pattern: VALUE, name: VALUE, append: FLAG, version: VALUE }, min: 1, max: 1, what: 'the trace file' },
  validate: { run: cmdValidate, flags: {}, min: 1, max: 1, what: 'the project file' },
  check: { run: cmdCheck, flags: { traces: VALUE, 'only-ci': FLAG, expect: VALUE, 'max-fail': VALUE, 'max-fail-rate': VALUE }, min: 1, max: 1, what: 'the project or checks file' },
  judge: { run: cmdJudge, flags: { check: VALUE, cmd: VALUE, split: VALUE, final: FLAG, batch: VALUE, concurrency: VALUE, limit: VALUE, timeout: VALUE, traces: VALUE }, min: 1, max: 1, what: 'the project file' },
  agreement: { run: cmdAgreement, flags: { check: VALUE, split: VALUE }, min: 1, max: 1, what: 'the project file' },
  estimate: { run: cmdEstimate, flags: { check: VALUE, traces: VALUE }, min: 1, max: 1, what: 'the project file' },
  retrieval: { run: cmdRetrieval, flags: { k: VALUE, traces: VALUE }, min: 1, max: 1, what: 'the project file' },
  report: { run: cmdReport, flags: { out: VALUE }, min: 1, max: 1, what: 'the project file' },
  'regression-set': { run: cmdRegressionSet, flags: { out: VALUE }, min: 1, max: 1, what: 'the project file' },
  checks: { run: cmdChecks, flags: { out: VALUE }, min: 1, max: 1, what: 'the project file' },
  policy: { run: cmdPolicy, flags: { policy: VALUE, json: FLAG, 'list-tools': FLAG, user: VALUE }, min: 1, max: 1, what: 'the trace or project file' },
};

function parseArgs(argv, name) {
  const spec = COMMANDS[name];
  const flags = {};
  const positionals = [];
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { help = true; continue; }
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      let key = a.slice(2);
      let value;
      const eq = key.indexOf('=');
      if (eq >= 0) { value = key.slice(eq + 1); key = key.slice(0, eq); }
      const kind = Object.prototype.hasOwnProperty.call(spec.flags, key) ? spec.flags[key] : null;
      if (!kind) throw new CliError(`Unknown option --${key} for pmstack ${name}.\n${usageOf(name)}`);
      if (kind === FLAG) {
        if (value !== undefined) throw new CliError(`--${key} takes no value.\n${usageOf(name)}`);
        flags[key] = true;
        continue;
      }
      if (value === undefined) {
        if (i + 1 >= argv.length) throw new CliError(`--${key} needs a value.\n${usageOf(name)}`);
        value = argv[++i];
      }
      flags[key] = value;
      continue;
    }
    if (a.length > 1 && a.startsWith('-')) throw new CliError(`Unknown option ${a} for pmstack ${name}.\n${usageOf(name)}`);
    positionals.push(a);
  }
  return { flags, positionals, help };
}

function numberFlag(flags, key, { min = -Infinity, max = Infinity, integer = true, def } = {}) {
  if (flags[key] === undefined) return def;
  const raw = String(flags[key]).trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    const range = max === Infinity ? `${min} or more` : `from ${min} to ${max}`;
    throw new CliError(`--${key} needs ${integer ? 'a whole number' : 'a number'} ${range}, not "${flags[key]}".`);
  }
  return n;
}

function makeIo(io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  return {
    cwd: io.cwd || process.cwd(),
    env: io.env || process.env,
    signal: io.signal || null,
    out: (s = '') => stdout.write(s + '\n'),
    err: (s = '') => stderr.write(s + '\n'),
  };
}

/**
 * Run one pmstack command. argv excludes node and the script path. io may set stdout, stderr,
 * cwd, env, and signal (an AbortSignal that stops a running studio). Resolves to the exit code.
 */
export async function main(argv = process.argv.slice(2), ioOptions = {}) {
  const io = makeIo(ioOptions);
  const [name, ...rest] = argv;
  try {
    if (!name || name === 'help' || name === '-h' || name === '--help') {
      io.out(name === 'help' && HELP[rest[0]] && rest[0] !== 'main' ? HELP[rest[0]] : HELP.main);
      return 0;
    }
    if (name === '--version' || name === '-v' || name === 'version') {
      io.out(`pmstack ${VERSION}`);
      return 0;
    }
    const cmd = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
    if (!cmd) throw new CliError(`Unknown command "${name}". Run "pmstack help" to see the commands.`);
    const args = parseArgs(rest, name);
    if (args.help) {
      io.out(HELP[name]);
      return 0;
    }
    if (args.positionals.length < cmd.min) throw new CliError(`Missing ${cmd.what}.\n${usageOf(name)}`);
    if (args.positionals.length > cmd.max) throw new CliError(`Too many arguments: ${args.positionals.slice(cmd.max).join(' ')}\n${usageOf(name)}`);
    return await cmd.run(args, io);
  } catch (err) {
    if (err instanceof CliError) {
      io.err(err.message);
      return err.exitCode;
    }
    io.err(`Something went wrong: ${err && err.message ? err.message : err}`);
    if (io.env.PMSTACK_DEBUG && err && err.stack) io.err(err.stack);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// Static files

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

const notFound = (res) => sendText(res, 404, 'Not found.');

function insideRoot(real, rootReal) {
  return real === rootReal || real.startsWith(rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep);
}

// Serve one file from a root folder. sub is the decoded path below the root ("/app.mjs").
function sendFileFrom(req, res, root, sub, { rawPath = sub, index = 'index.html' } = {}) {
  let rootReal;
  let real;
  try {
    rootReal = fs.realpathSync(root);
    real = fs.realpathSync(path.resolve(root, '.' + sub));
  } catch {
    return notFound(res);
  }
  if (!insideRoot(real, rootReal)) return notFound(res);
  let st = fs.statSync(real);
  if (st.isDirectory()) {
    if (!rawPath.endsWith('/')) {
      // A relative redirect keeps the browser on this server.
      return sendText(res, 301, 'Moved.', { Location: path.posix.basename(rawPath) + '/' });
    }
    try {
      real = fs.realpathSync(path.join(real, index));
      st = fs.statSync(real);
    } catch {
      return notFound(res);
    }
    if (!insideRoot(real, rootReal)) return notFound(res);
  }
  if (!st.isFile()) return notFound(res);
  return streamFile(req, res, real, st);
}

function streamFile(req, res, file, st) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { ...BASE_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  let start = 0;
  let end = st.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range && st.size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416, { ...BASE_HEADERS, 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), st.size - 1);
    } else {
      start = Math.max(0, st.size - Number(m[2]));
    }
    if (start > end || start >= st.size) {
      res.writeHead(416, { ...BASE_HEADERS, 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = st.size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !st.size) return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return undefined;
}

// Decode a request path: null (answered with 400) when it is malformed or holds a NUL.
function decodePath(res, raw) {
  let pathname;
  try {
    pathname = decodeURIComponent(raw);
  } catch {
    sendText(res, 400, 'Bad request: the address is not encoded correctly.');
    return null;
  }
  if (pathname.includes(NUL) || !pathname.startsWith('/')) {
    sendText(res, 400, 'Bad request.');
    return null;
  }
  return pathname;
}

/**
 * A handler (req, res) that serves files from `root`, plus folders mounted at path prefixes
 * (mounts: { '/assets/': dir }). Paths are decoded safely, NUL is refused, and every file's real
 * path must stay inside its root, so links that point outside are not followed.
 */
export function createStaticHandler(root, { mounts = {}, index = 'index.html' } = {}) {
  const base = path.resolve(root);
  const extra = Object.entries(mounts)
    .map(([prefix, dir]) => ({ prefix: prefix.endsWith('/') ? prefix : prefix + '/', dir: path.resolve(dir) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return function handleStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    const raw = String(req.url || '/').split('?')[0].split('#')[0] || '/';
    if (raw.startsWith('//')) return notFound(res);
    const pathname = decodePath(res, raw);
    if (pathname == null) return undefined;
    for (const m of extra) {
      if (pathname.startsWith(m.prefix)) return sendFileFrom(req, res, m.dir, pathname.slice(m.prefix.length - 1), { rawPath: raw, index });
    }
    return sendFileFrom(req, res, base, pathname, { rawPath: raw, index });
  };
}

// ---------------------------------------------------------------------------
// The studio server

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new CliError('The request is too large.', 2, { status: 413 }));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(new CliError('The request is too large.', 2, { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

const isJsonType = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json';

function parseIfMatch(value) {
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(String(value ?? ''));
  return m ? Number(m[1]) : null;
}

const recordingKey = (r) => String(r).replace(/^\.?[\\/]+/, '').split(/[\\/]+/).filter(Boolean).join('/');

/**
 * The Eval Studio server for one folder (listen on 127.0.0.1 yourself). It serves docs/studio,
 * /assets/, the folder's custom views and call recordings, and the /api/ routes that read and
 * write pmstack/project.json. Options: folder, projectPath, studioRoot, assetsRoot, bodyLimit.
 */
export function createServer({
  folder,
  projectPath = path.join(folder, 'pmstack', 'project.json'),
  studioRoot = STUDIO_ROOT,
  assetsRoot = ASSETS_ROOT,
  bodyLimit = BODY_LIMIT,
} = {}) {
  const folderAbs = path.resolve(folder);
  const projectAbs = path.resolve(projectPath);
  const projectDir = path.dirname(projectAbs);
  const label = labelOf(projectAbs);
  const renderersDir = path.join(folderAbs, 'pmstack', 'renderers');
  const suggestionsFile = path.join(projectDir, 'suggestions.json');
  const serveStatic = createStaticHandler(studioRoot, { mounts: { '/assets/': assetsRoot } });
  let queue = Promise.resolve();
  let revCache = null;
  let lastGoodSuggestions = 0;

  const enqueue = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  // Revision and trace file of project.json, re-read only when the file changes.
  function diskState() {
    let st = null;
    try { st = fs.statSync(projectAbs); } catch { /* no file yet */ }
    if (!st) return { revision: null, mtimeMs: null, tracesPath: null };
    if (!revCache || revCache.mtimeMs !== st.mtimeMs || revCache.size !== st.size) {
      const p = readJsonQuiet(projectAbs);
      revCache = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        revision: isObj(p) ? p.revision ?? null : null,
        tracesPath: isObj(p) ? tracesPathOf(projectAbs, p) : null,
      };
    }
    return revCache;
  }

  function tracesFileForInfo(tracesPath) {
    if (!tracesPath) return null;
    const rel = path.relative(folderAbs, tracesPath);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? posix(rel) : tracesPath;
  }

  function loadForServer() {
    return loadProject(projectAbs, { label });
  }

  function projectError(res, err) {
    if (err instanceof CliError) {
      if (err.missing && !err.status) return sendJson(res, err.message.startsWith('The trace file') ? 422 : 404, { error: err.message, line: null });
      return sendJson(res, err.status === 422 ? 422 : 400, { error: err.status === 422 ? err.detail || err.message : err.message, line: err.line ?? null });
    }
    throw err;
  }

  async function putProject(req, res) {
    if (!isJsonType(req)) return sendJson(res, 415, { error: 'Send the project as application/json.' });
    const ifMatch = parseIfMatch(req.headers['if-match']);
    if (ifMatch == null) return sendJson(res, 428, { error: 'Send If-Match with the revision you last loaded.' });
    let incoming;
    try {
      incoming = JSON.parse(await readBody(req, bodyLimit));
    } catch (err) {
      if (err.status === 413) return sendJson(res, 413, { error: 'The project is larger than 50 MB.' }, { Connection: 'close' });
      return sendJson(res, 400, { error: 'The body is not a readable project.' });
    }
    if (!isObj(incoming) || incoming.format !== lib.FORMAT) return sendJson(res, 400, { error: 'The body is not a pmstack project.' });
    let outcome = 'ok';
    let result;
    try {
      result = await enqueue(() => withProjectLock(projectAbs, (disk) => {
        if (disk && (Number(disk.revision) || 0) !== ifMatch) {
          outcome = 'conflict';
          return null;
        }
        const tracesFile = 'tracesFile' in incoming ? incoming.tracesFile : disk?.tracesFile ?? null;
        if (incoming.traces != null && tracesFile) {
          outcome = 'traces';
          return null;
        }
        let next = 'tracesFile' in incoming ? incoming : { ...incoming, tracesFile };
        if (!tracesFile && !Array.isArray(next.traces)) next = { ...next, traces: Array.isArray(disk?.traces) ? disk.traces : [] };
        return next;
      }));
    } catch (err) {
      return projectError(res, err);
    }
    if (outcome === 'traces') {
      return sendJson(res, 400, { error: 'This project keeps its traces in its own trace file, so a save must not include traces.' });
    }
    if (outcome === 'conflict') {
      try {
        const { project } = loadForServer();
        return sendJson(res, 409, { project, revision: project.revision ?? null }, { ETag: `"${project.revision ?? 0}"` });
      } catch (err) {
        return projectError(res, err);
      }
    }
    return sendJson(res, 200, { ok: true, revision: result.revision }, { ETag: `"${result.revision}"` });
  }

  async function postTraces(req, res) {
    if (!isJsonType(req)) return sendJson(res, 415, { error: 'Send the traces as application/json.' });
    let body;
    try {
      body = JSON.parse(await readBody(req, bodyLimit));
    } catch (err) {
      if (err.status === 413) return sendJson(res, 413, { error: 'The traces are larger than 50 MB.' }, { Connection: 'close' });
      return sendJson(res, 400, { error: 'The body is not readable.' });
    }
    if (!isObj(body) || !Array.isArray(body.traces)) return sendJson(res, 400, { error: 'Send { "traces": [ ... ] }.' });
    if (!body.traces.length) return sendJson(res, 400, { error: 'There are no traces to add.' });
    // Optional version name: tags the new traces, and the earlier ones "Version 1" the first time.
    const version = body.version == null ? null : String(body.version).trim();
    if (body.version != null && !version) return sendJson(res, 400, { error: 'The version name is empty.' });
    const disk = readJsonQuiet(projectAbs);
    const parsed = lib.parseTraceFile(JSON.stringify(body.traces), 'traces.json', { fieldMap: isObj(disk) ? disk.experience?.fieldMap || null : null });
    try {
      const r = await enqueue(() => appendTraces(projectAbs, parsed.traces, { version }));
      return sendJson(res, 200, { added: r.added, skipped: r.skipped, revision: r.revision }, r.revision != null ? { ETag: `"${r.revision}"` } : {});
    } catch (err) {
      return projectError(res, err);
    }
  }

  function getSuggestions(res, query) {
    const since = Number(query.get('since')) || 0;
    let st;
    try {
      st = fs.statSync(suggestionsFile);
    } catch {
      return sendJson(res, 200, { suggestions: [], mtimeMs: 0 });
    }
    if (st.mtimeMs <= since) {
      res.writeHead(204, BASE_HEADERS);
      return res.end();
    }
    const value = readJsonQuiet(suggestionsFile);
    const list = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.suggestions) ? value.suggestions : null;
    if (!list) return sendJson(res, 200, { suggestions: [], mtimeMs: lastGoodSuggestions, error: 'suggestions.json is not valid JSON yet' });
    lastGoodSuggestions = st.mtimeMs;
    return sendJson(res, 200, { suggestions: list, mtimeMs: st.mtimeMs });
  }

  async function api(req, res, route, query) {
    const method = req.method;
    const allow = (methods) => sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: methods });
    if (route === '/api/info') {
      if (method !== 'GET') return allow('GET');
      const s = diskState();
      return sendJson(res, 200, {
        mode: 'folder', folder: folderAbs, projectPath: projectAbs, tracesFile: tracesFileForInfo(s.tracesPath),
        version: VERSION, cliPath: CLI_PATH, revision: s.revision,
      });
    }
    if (route === '/api/project') {
      if (method === 'PUT') return putProject(req, res);
      if (method !== 'GET') return allow('GET, PUT');
      try {
        const { project } = loadForServer();
        return sendJson(res, 200, project, { ETag: `"${project.revision ?? 0}"` });
      } catch (err) {
        return projectError(res, err);
      }
    }
    if (route === '/api/revision') {
      if (method !== 'GET') return allow('GET');
      const s = diskState();
      let tracesMtimeMs = null;
      if (s.tracesPath) {
        try { tracesMtimeMs = fs.statSync(s.tracesPath).mtimeMs; } catch { tracesMtimeMs = null; }
      }
      return sendJson(res, 200, { revision: s.revision, mtimeMs: s.mtimeMs, tracesMtimeMs });
    }
    if (route === '/api/suggestions') {
      if (method !== 'GET') return allow('GET');
      return getSuggestions(res, query);
    }
    if (route === '/api/traces') {
      if (method !== 'POST') return allow('POST');
      return postTraces(req, res);
    }
    return sendJson(res, 404, { error: 'Not found.' });
  }

  function customRenderer(req, res, raw) {
    const m = /^\/custom\/renderers\/([^/]+)\.mjs$/.exec(raw);
    if (!m || !CUSTOM_ID.test(m[1])) return notFound(res);
    return sendFileFrom(req, res, renderersDir, `/${m[1]}.mjs`);
  }

  function recording(req, res, raw) {
    const pathname = decodePath(res, raw);
    if (pathname == null) return undefined;
    const key = recordingKey(pathname.slice('/recordings/'.length));
    if (!key || key.split('/').includes('..')) return notFound(res);
    let known;
    try {
      known = new Set();
      for (const t of loadForServer().project.traces) {
        const r = isObj(t?.metadata) ? t.metadata.recording : null;
        if (typeof r === 'string' && r.trim() && !/^[a-z][a-z0-9+.-]*:/i.test(r.trim())) known.add(recordingKey(r.trim()));
      }
    } catch {
      return notFound(res);
    }
    if (!known.has(key)) return notFound(res);
    return sendFileFrom(req, res, folderAbs, '/' + key);
  }

  async function handle(req, res) {
    const port = server.address() && server.address().port;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return sendText(res, 403, 'Forbidden: this server answers only requests for its own address.');
    }
    const raw = String(req.url || '/').split('#')[0];
    const [rawPath, search = ''] = raw.split('?');
    const isApi = rawPath.startsWith('/api/');
    const origin = req.headers.origin;
    const writes = req.method !== 'GET' && req.method !== 'HEAD';
    if (origin !== undefined && (writes || isApi) && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return sendText(res, 403, 'Forbidden: requests from other sites are refused.');
    }
    if (req.method === 'OPTIONS') return sendText(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD, PUT, POST' });
    if (isApi) return api(req, res, rawPath, new URLSearchParams(search));
    if (writes) return sendText(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    if (rawPath.startsWith('/custom/renderers/')) return customRenderer(req, res, rawPath);
    if (rawPath.startsWith('/recordings/')) return recording(req, res, rawPath);
    return serveStatic(req, res);
  }

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((err) => {
        if (!res.headersSent) sendJson(res, 500, { error: `Something went wrong: ${err && err.message ? err.message : err}` });
        else res.destroy();
      });
  });
  return server;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function openBrowser(url, io) {
  const [cmd, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => io.err(`Could not open a browser. Open ${url} yourself.`));
    child.unref();
  } catch {
    io.err(`Could not open a browser. Open ${url} yourself.`);
  }
}

function findTraceFile(folder) {
  const preferred = path.join(folder, 'traces.jsonl');
  if (isFile(preferred)) return preferred;
  const skip = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json']);
  const found = fs.readdirSync(folder)
    .filter((n) => !n.startsWith('.') && /\.(jsonl|ndjson|json|csv)$/i.test(n) && !skip.has(n) && isFile(path.join(folder, n)))
    .sort();
  if (found.length === 1) return path.join(folder, found[0]);
  if (!found.length) throw new CliError(`No trace file found in ${folder}. Pass --traces <file>.`);
  throw new CliError(`Found ${found.length} files that could hold traces in ${folder}: ${found.join(', ')}. Pass --traces <file> to pick one.`);
}

async function cmdStudio({ flags, positionals }, io) {
  const folder = path.resolve(io.cwd, positionals[0] || '.');
  if (!isDirectory(folder)) throw new CliError(`Folder not found: ${folder}`);
  const port = numberFlag(flags, 'port', { min: 0, max: 65535, def: DEFAULT_PORT });
  const projectPath = path.join(folder, 'pmstack', 'project.json');
  const infoPath = path.join(folder, 'pmstack', '.studio.json');
  const running = readJsonQuiet(infoPath);
  if (running && Number.isInteger(running.pid) && running.pid !== process.pid && isAlive(running.pid)) {
    throw new CliError(`Eval Studio is already running for this folder at ${running.url}\nOpen that address, or stop the other one first.`);
  }

  if (!fs.existsSync(projectPath)) {
    const tracesPath = flags.traces ? path.resolve(io.cwd, flags.traces) : findTraceFile(folder);
    const shown = shownPath(tracesPath, io.cwd);
    const parsed = readTraceFile(tracesPath, { label: shown });
    if (!parsed.traces.length) throw new CliError(`No traces could be read from ${shown}.${parsed.errors.length ? ' ' + parsed.errors.slice(0, 3).join(' ') : ''}`);
    noteParseProblems(parsed, shown, io);
    const tracesFile = posix(path.relative(path.dirname(projectPath), tracesPath));
    const p = guessProject({ traces: parsed.traces, name: humanName(path.basename(folder)), tracesFile, guessed: true });
    await saveProjectFile(projectPath, p);
    io.err(`Made pmstack/project.json from ${shown}: ${plural(p.traces.length, 'trace')}, ${viewName(p.experience.renderer)}, ${plural(p.experience.stages.length, 'stage')}. Adjust them in Set up.`);
  } else {
    if (flags.traces) io.err('Note: --traces is used only when the project is first made. This project uses the trace file named in pmstack/project.json.');
    try {
      const loaded = loadProject(projectPath);
      if (loaded.tracesPath) noteParseProblems(loaded.parse, shownPath(loaded.tracesPath, io.cwd), io);
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      io.err(`Note: ${err.message} Eval Studio shows the project read-only until the file is fixed.`);
    }
  }

  const server = createServer({ folder, projectPath });
  try {
    await listen(server, port);
  } catch (err) {
    if (err.code === 'EADDRINUSE') throw new CliError(`Port ${port} is already in use. Pass --port 0 to pick a free port.`);
    throw err;
  }
  const actual = server.address().port;
  const url = `http://127.0.0.1:${actual}/`;
  io.out(`Eval Studio: ${url}`);
  const info = { pid: process.pid, port: actual, url, startedAt: nowIso() };
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + '\n');
  const removeInfo = () => {
    const cur = readJsonQuiet(infoPath);
    if (cur && cur.pid === info.pid && cur.port === info.port) {
      try { fs.unlinkSync(infoPath); } catch { /* already gone */ }
    }
  };
  if (flags.open) openBrowser(url, io);

  return new Promise((resolve) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      process.off('exit', removeInfo);
      if (io.signal) io.signal.removeEventListener('abort', stop);
      removeInfo();
      server.close(() => resolve(0));
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('exit', removeInfo);
    if (io.signal) {
      if (io.signal.aborted) stop();
      else io.signal.addEventListener('abort', stop, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// import, validate

async function cmdImport({ flags, positionals }, io) {
  const tracesPath = path.resolve(io.cwd, positionals[0]);
  const shown = shownPath(tracesPath, io.cwd);
  const out = flags.out ? path.resolve(io.cwd, flags.out) : path.join(path.dirname(tracesPath), 'pmstack', 'project.json');
  const outShown = shownPath(out, io.cwd);
  const version = flags.version !== undefined ? String(flags.version).trim() : null;
  if (flags.version !== undefined && !version) throw new CliError('--version needs a name, for example --version "Version 2".');
  if (flags.view !== undefined) {
    const v = String(flags.view);
    const custom = v.startsWith('custom:') && CUSTOM_ID.test(v.slice(7));
    if (!custom && !lib.VIEWS.some((x) => x.id === v)) throw new CliError(`Unknown view "${v}". Pick one of: ${lib.VIEWS.map((x) => x.id).join(', ')}, or custom:<id>.`);
  }
  if (flags.pattern !== undefined && !lib.PATTERNS.some((x) => x.id === flags.pattern)) {
    throw new CliError(`Unknown pattern "${flags.pattern}". Pick one of: ${lib.PATTERNS.map((x) => x.id).join(', ')}.`);
  }
  if (flags.append && (flags.view || flags.pattern || flags.name)) throw new CliError('--view, --pattern, and --name set up a new project. Leave them out with --append.');
  if (version && !flags.append) throw new CliError('--version tags traces added with --append. Leave it out when you make a new project.');

  const parsed = readTraceFile(tracesPath, { label: shown });
  if (!parsed.traces.length) throw new CliError(`No traces could be read from ${shown}.${parsed.errors.length ? ' ' + parsed.errors.slice(0, 3).join(' ') : ''}`);
  noteParseProblems(parsed, shown, io);

  if (flags.append) {
    if (!fs.existsSync(out)) throw new CliError(`${outShown} was not found. Leave out --append to make a new project.`);
    const r = await appendTraces(out, parsed.traces, { version });
    io.out(`Added ${commas(r.added)}, skipped ${commas(r.skipped)} already here (${outShown}).`);
    if (version && r.added) {
      io.out(r.tagged
        ? `Tagged the ${plural(r.tagged, 'earlier trace')} "Version 1" and the new ones "${version}". Pick a version in Eval Studio's filters to compare them.`
        : `Tagged the new traces "${version}".`);
    }
    return 0;
  }

  if (fs.existsSync(out)) throw new CliError(`${outShown} already exists. Add --append to add these traces to it, or pick another --out.`);
  const name = String(flags.name || '').trim() || humanName(path.basename(path.dirname(tracesPath)));
  const tracesFile = posix(path.relative(path.dirname(out), tracesPath));
  const p = guessProject({ traces: parsed.traces, name, view: flags.view || null, pattern: flags.pattern || null, tracesFile, guessed: !flags.view && !flags.pattern });
  await saveProjectFile(out, p);
  const e = p.experience;
  io.out(`Made ${outShown} from ${shown}: ${plural(p.traces.length, 'trace')} (${parsed.shapeLabel}).`);
  io.out(`  View: ${viewName(e.renderer)}${flags.view ? '' : ' (guessed from your traces)'}`);
  io.out(`  How your AI works: ${patternName(e.pattern)}${flags.pattern ? '' : ' (guessed from your traces)'}`);
  io.out(`  Stages: ${e.stages.map((s, i) => `${i + 1} ${s.label}`).join(', ')}`);
  io.out(`  Filters: ${e.filters.length ? e.filters.join(', ') : 'none found'}`);
  io.out(`  First set: ${plural(p.batch ? p.batch.items.length : 0, 'trace')} to review`);
  if (path.basename(path.dirname(out)) === 'pmstack') {
    io.out(`Open it: node "${CLI_PATH}" studio "${path.dirname(path.dirname(out))}"`);
  }
  return 0;
}

async function cmdValidate(args, io) {
  const file = path.resolve(io.cwd, args.positionals[0]);
  const label = shownPath(file, io.cwd);
  const loaded = loadProject(file, { label });
  if (loaded.tracesPath) noteParseProblems(loaded.parse, shownPath(loaded.tracesPath, io.cwd), io);
  const p = loaded.project;
  const r = lib.validateProject(p, { tracesLoaded: true });
  if (!r.ok) {
    io.out(`${label} has ${plural(r.errors.length, 'problem')}:`);
    for (const e of r.errors) io.out(`  - ${e}`);
    return 1;
  }
  const stats = lib.reviewStats(p);
  const modes = (p.modes || []).filter((m) => m.kind === 'failure').length;
  io.out(`${label} is a valid project: ${plural(p.traces.length, 'trace')}, ${commas(stats.reviewed)} reviewed, ${plural(modes, 'failure mode')}, ${plural((p.checks || []).length, 'check')}.`);
  return 0;
}

// ---------------------------------------------------------------------------
// check, checks

async function cmdCheck({ flags, positionals }, io) {
  const file = path.resolve(io.cwd, positionals[0]);
  const label = shownPath(file, io.cwd);
  if (flags['max-fail'] !== undefined && flags['max-fail-rate'] !== undefined) throw new CliError('Use --max-fail or --max-fail-rate, not both.');
  const maxFail = numberFlag(flags, 'max-fail', { min: 0 });
  const maxRate = numberFlag(flags, 'max-fail-rate', { min: 0, max: 1, integer: false });
  const input = readJsonFile(file, label);
  let p;
  if (isObj(input) && input.format === CHECKS_FORMAT) {
    if (!flags.traces) throw new CliError(`A checks file needs --traces <file>: the traces to check.\n${usageOf('check')}`);
    const tracesPath = path.resolve(io.cwd, flags.traces);
    const experience = isObj(input.experience) ? input.experience : lib.defaultExperience({});
    const parsed = readTraceFile(tracesPath, { fieldMap: experience.fieldMap || null, label: shownPath(tracesPath, io.cwd) });
    noteParseProblems(parsed, shownPath(tracesPath, io.cwd), io);
    const base = lib.createProject({ id: 'checks', name: input.product || 'Checks', experience, traces: parsed.traces });
    p = { ...base, checks: Array.isArray(input.checks) ? input.checks : [] };
  } else if (isObj(input) && input.format === lib.FORMAT) {
    p = openProject({ flags, positionals }, io).project;
  } else {
    throw new CliError(`${label} is not a pmstack project or checks file.`);
  }

  const checks = (p.checks || []).filter((c) => lib.isCodeCheck(c) && (!flags['only-ci'] || c.ci));
  if (!checks.length) {
    throw new CliError(flags['only-ci']
      ? `${label} has no code checks marked "Run on every change".`
      : `${label} has no code checks to run.`);
  }
  const norm = lib.normalizeAll(p);
  const opts = lib.checkOptions(p);
  const results = {};
  const failing = new Set();
  const rows = [['Check', 'Fails', 'Errors']];
  const lines = [];
  let errorCount = 0;
  for (const c of checks) {
    const byTrace = {};
    const fails = [];
    const errors = [];
    for (const [id, n] of norm) {
      const r = lib.runCheck(c, n, opts);
      byTrace[id] = r;
      if (r.verdict === 'fail') fails.push(id);
      if (r.verdict === 'error') errors.push({ id, detail: r.detail });
      if (r.verdict !== 'pass') failing.add(id);
    }
    results[c.id] = byTrace;
    errorCount += errors.length;
    rows.push([`${c.name || c.id} (${c.id})`, `${commas(fails.length)} of ${commas(norm.size)}`, errors.length ? commas(errors.length) : '']);
    if (fails.length) lines.push(`${c.name || c.id} fails on: ${listIds(fails)}`);
    for (const e of errors.slice(0, 5)) lines.push(`${c.name || c.id} could not run on ${e.id}: ${e.detail}`);
    if (errors.length > 5) lines.push(`${c.name || c.id} could not run on ${errors.length - 5} more traces.`);
  }
  const total = norm.size;
  const passAll = total - failing.size;
  io.out(`Ran ${plural(checks.length, 'check')} on ${plural(total, 'trace')}.`);
  io.out('');
  for (const l of table(rows, [1, 2])) io.out(l);
  if (lines.length) {
    io.out('');
    for (const l of lines) io.out(l);
  }
  io.out('');
  io.out(`${commas(passAll)} of ${commas(total)} traces pass every check.`);

  let failed = false;
  if (flags.expect) {
    const expectPath = path.resolve(io.cwd, flags.expect);
    const parsed = readTraceFile(expectPath, { label: shownPath(expectPath, io.cwd) });
    const modes = new Map((p.modes || []).map((m) => [m.id, m]));
    const regressions = [];
    const missing = [];
    for (const t of parsed.traces) {
      const expected = isObj(t.expected) && isObj(t.expected.modes) ? t.expected.modes : {};
      const id = String(t.id);
      if (!norm.has(id)) { missing.push(id); continue; }
      for (const c of checks) {
        if (expected[c.modeId] !== 'pass') continue;
        if (results[c.id][id].verdict === 'fail') regressions.push({ id, check: c, mode: modes.get(c.modeId) });
      }
    }
    io.out('');
    if (regressions.length) {
      const came = regressions.length === 1 ? '1 known failure came back' : `${commas(regressions.length)} known failures came back`;
      io.out(`Regression set: ${plural(parsed.traces.length - missing.length, 'trace')} checked, ${came}.`);
      for (const r of regressions) {
        const modeText = r.mode ? ` It must pass for "${r.mode.name}"${r.mode.fixedAt ? ', which was marked fixed' : ''}.` : '';
        io.out(`  ${r.id}: ${r.check.name || r.check.id} failed.${modeText}`);
      }
      failed = true;
    } else {
      io.out(`Regression set: ${plural(parsed.traces.length - missing.length, 'trace')} checked. No known failure came back.`);
    }
    if (missing.length) io.err(`Note: ${plural(missing.length, 'regression trace')} ${missing.length === 1 ? 'was' : 'were'} not in the traces you checked (${listIds(missing, 5)}). Replay them so the checks cover them.`);
  }
  if (maxFail !== undefined) {
    if (failing.size > maxFail) {
      io.out(`${plural(failing.size, 'trace')} fail a check, more than the limit of ${commas(maxFail)}.`);
      failed = true;
    }
  } else if (maxRate !== undefined) {
    const rate = total ? failing.size / total : 0;
    if (rate > maxRate) {
      io.out(`${lib.pct(rate)} of traces fail a check, more than the limit of ${lib.pct(maxRate)}.`);
      failed = true;
    }
  } else if (!flags.expect && failing.size > 0) {
    failed = true;
  }
  if (errorCount) {
    io.err(`${plural(errorCount, 'check result')} could not be computed. Fix the check and run it again.`);
    return 2;
  }
  return failed ? 1 : 0;
}

async function cmdChecks(args, io) {
  const { project: p } = openProject(args, io, { tracesFlag: null });
  const out = path.resolve(io.cwd, args.flags.out || 'checks.json');
  const data = lib.ciChecks(p);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  const shown = shownPath(out, io.cwd);
  if (!data.checks.length) {
    io.out(`Wrote ${shown} with no checks yet. In Eval Studio, turn on "Run on every change" for a code check first.`);
  } else {
    io.out(`Wrote ${shown}: ${plural(data.checks.length, 'code check')} that ${data.checks.length === 1 ? 'runs' : 'run'} on every change.`);
    io.out(`Run them with: node "${CLI_PATH}" check "${shown}" --traces <file>`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// judge

const MAX_OUTPUT = 10 * 1024 * 1024;

// Run one model command. Off Windows the command gets its own process group, so a timeout or
// Ctrl+C stops it and anything it started (a shell script's sleep, a model client's helpers).
// `children` collects { kill(signal) } for every running command.
function runCommand(argv, input, { timeoutMs, cwd, env, children }) {
  return new Promise((resolve) => {
    let child;
    let done = false;
    const group = process.platform !== 'win32';
    const entry = {
      kill(signal) {
        if (!child || child.pid == null) return;
        try {
          if (group) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          try { child.kill(signal); } catch { /* already gone */ }
        }
      },
    };
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      children.delete(entry);
      resolve(r);
    };
    let timer = null;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: group });
    } catch (err) {
      finish({ ok: false, fatal: true, reason: `Could not start "${argv[0]}": ${err.message}` });
      return;
    }
    children.add(entry);
    const out = [];
    let outLen = 0;
    let errText = '';
    // On a timeout, stop the whole group and answer at once: a process the command started
    // can keep the output open long after the command itself is gone.
    timer = setTimeout(() => {
      entry.kill('SIGTERM');
      setTimeout(() => entry.kill('SIGKILL'), 2000).unref();
      child.stdout.destroy();
      child.stderr.destroy();
      finish({ ok: false, reason: `No answer within ${plural(Number((timeoutMs / 1000).toFixed(1)), 'second')}.` });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (outLen < MAX_OUTPUT) { out.push(d); outLen += d.length; }
    });
    child.stderr.on('data', (d) => {
      if (errText.length < 4000) errText += d.toString('utf8');
    });
    // A command that exits without reading its input closes the pipe; that is not our failure.
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      finish({
        ok: false,
        fatal: err.code === 'ENOENT' || err.code === 'EACCES',
        reason: err.code === 'ENOENT' ? `Could not start "${argv[0]}": the command was not found.` : `Could not start "${argv[0]}": ${err.message}`,
      });
    });
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const first = errText.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
        const how = code == null ? `was stopped (${signal})` : `exited with code ${code}`;
        return finish({ ok: false, stopped: code == null, reason: `The command ${how}${first ? `: ${first.slice(0, 200)}` : '.'}` });
      }
      return finish({ ok: true, stdout: Buffer.concat(out).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

function rateLine(label, rate, num, den) {
  return `${label.padEnd(24)}${lib.pct(rate).padStart(5)}   (${commas(num)} of ${commas(den)})`;
}

function agreementLines(a) {
  return [
    rateLine('Catches real failures', a.catchesFailures, a.tn, a.tn + a.fp),
    rateLine('Agrees on good traces', a.agreesOnGood, a.tp, a.tp + a.fn),
  ];
}

async function cmdJudge(args, io) {
  const { flags } = args;
  if (!flags.check) throw new CliError(`Pass --check <id>: the AI judge to run.\n${usageOf('judge')}`);
  if (!flags.cmd) throw new CliError(`Pass --cmd "<command>": the model command, for example --cmd "claude -p --model {model}".\n${usageOf('judge')}`);
  const split = flags.split || (flags.traces ? 'unlabeled' : 'tuning');
  if (!['tuning', 'test', 'unlabeled'].includes(split)) throw new CliError(`--split must be tuning, test, or unlabeled, not "${split}".`);
  if (flags.traces && split !== 'unlabeled') throw new CliError('--traces judges traces from another file, which have no labels. Use it with --split unlabeled.');
  if (split === 'test' && !flags.final) throw new CliError('The final test is used once, at the end. Add --final to run it and reveal the results.');
  if (flags.final && split !== 'test') throw new CliError('--final goes with --split test.');
  const batch = numberFlag(flags, 'batch', { min: 1, max: 10, def: 1 });
  const concurrency = numberFlag(flags, 'concurrency', { min: 1, max: 32, def: 4 });
  const limit = numberFlag(flags, 'limit', { min: 1 });
  const timeout = numberFlag(flags, 'timeout', { min: 0.1, integer: false, def: 120 });

  const { project: loaded, file, label } = openProject(args, io, { tracesFlag: null });
  const check = findCheck(loaded, flags.check);
  if (check.type !== 'judge') throw new CliError(`"${check.id}" is a code check. pmstack judge runs AI judges; run code checks with pmstack check.`);
  const mode = modeOf(loaded, check);
  let argv = splitArgs(flags.cmd);
  if (!argv.length) throw new CliError('--cmd is empty.');
  if (argv.some((a) => a.includes('{model}'))) {
    const model = String(check.model || '').trim();
    if (!model) throw new CliError(`The judge "${check.id}" has no model yet, so {model} cannot be filled in. Pin an exact model version in Eval Studio (Checks), or write the model into --cmd.`);
    argv = argv.map((a) => a.split('{model}').join(model));
  }

  let p = lib.assignSplits(loaded, mode.id);
  // The final test is used once. After the reveal it can only be finished (traces with no
  // answer yet), never run again: a second run would let you keep the best result.
  const finishing = split === 'test' && !!check.test;
  const usedOn = finishing ? String(check.test.revealedAt || '').slice(0, 10) : '';
  if (finishing && lib.checkTestState(p, check.id) === 'outdated') {
    throw new CliError(`The final test for "${check.name || check.id}" was used on ${usedOn}, and the judge or your labels changed since. Label 30 new traces and start a fresh final test in Eval Studio (Checks).`);
  }
  const labeled = lib.labeledSet(p, mode.id);
  const nFail = labeled.filter((l) => l.label === 'fail').length;
  const nPass = labeled.length - nFail;
  if (nFail < 20 || nPass < 20) {
    io.err(`Note: this failure mode has ${plural(nFail, 'Problem label')} and ${plural(nPass, 'Good label')}. Trust a judge only after at least 20 of each; aim for about 50 of each.`);
  }

  let judgeProject = p;
  let ids;
  if (split === 'unlabeled' && flags.traces) {
    const tracesPath = path.resolve(io.cwd, flags.traces);
    const shown = shownPath(tracesPath, io.cwd);
    const parsed = readTraceFile(tracesPath, { fieldMap: p.experience?.fieldMap || null, label: shown });
    noteParseProblems(parsed, shown, io);
    const projectIds = new Set((p.traces || []).map((t) => String(t.id)));
    const kept = [];
    const collided = [];
    const skipped = [];
    for (const t of parsed.traces) {
      const id = String(t.id);
      if (projectIds.has(id)) {
        collided.push(id);
        if (lib.humanLabel(p, id, mode.id) != null || lib.splitOf(p, mode.id, id) != null) { skipped.push(id); continue; }
      }
      kept.push(t);
    }
    if (collided.length) {
      const replaced = collided.length - skipped.length;
      io.err(`Note: ${plural(collided.length, 'trace')} in ${shown} have the same id as traces in the project.`
        + (skipped.length ? ` Skipped ${commas(skipped.length)} that you labeled in the project (${listIds(skipped, 5)}).` : '')
        + (replaced ? ` Results are stored by trace id, so the other ${commas(replaced)} replace the results of the project traces with those ids.` : ''));
    }
    const keptIds = new Set(kept.map((t) => String(t.id)));
    judgeProject = { ...p, traces: [...(p.traces || []).filter((t) => !keptIds.has(String(t.id))), ...kept] };
    ids = kept.map((t) => String(t.id));
  } else if (split === 'unlabeled') {
    ids = (p.traces || []).map((t) => String(t.id)).filter((id) => lib.humanLabel(p, id, mode.id) == null && lib.splitOf(p, mode.id, id) == null);
  } else {
    ids = labeled.filter((l) => lib.splitOf(p, mode.id, l.traceId) === split).map((l) => l.traceId);
  }
  // Examples appear in the prompt, so they are never judged.
  ids = ids.filter((id) => lib.splitOf(p, mode.id, id) !== 'examples');
  if (finishing) {
    ids = ids.filter((id) => !['pass', 'fail'].includes(check.results?.[id]?.verdict));
    if (!ids.length) throw new CliError(`The final test for "${check.name || check.id}" was used on ${usedOn}, and every final test trace has an answer. It is used once, so it cannot run again.`);
  }
  if (limit !== undefined) ids = ids.slice(0, limit);
  const splitName = split === 'test' ? 'final test' : split === 'tuning' ? 'tuning set' : 'unlabeled traces';
  if (!ids.length) {
    throw new CliError(split === 'unlabeled'
      ? `There are no unlabeled traces to judge for "${mode.name}". Use --traces to judge a fresh sample.`
      : `The ${splitName} for "${mode.name}" has no labeled traces yet. Label traces for this failure mode in Eval Studio (Checks, Label more traces).`);
  }

  const exp = p.experience || {};
  const renderOpts = { inputs: check.inputs, filters: exp.filters || [], userLabel: lib.userWord(exp) };
  const prompt = String(check.prompt || '').trim() ? check.prompt : lib.buildJudgePrompt(p, mode.id, { inputs: check.inputs });
  const groups = [];
  for (let i = 0; i < ids.length; i += batch) groups.push(ids.slice(i, i + batch));

  const children = new Set();
  const recorded = {};
  const errors = [];
  let pending = {};
  let pendingCount = 0;
  let judged = 0;
  let stopping = false;
  let fatal = null;
  let saving = Promise.resolve();
  let saveError = null;

  const save = (final) => {
    const chunk = pending;
    pending = {};
    pendingCount = 0;
    saving = saving.then(() => saveProjectFile(file, (disk) => {
      if (!disk) throw new CliError(`${label} was not found.`);
      let d = disk.tracesFile ? { ...disk, traces: loaded.traces } : disk;
      d = lib.assignSplits(d, mode.id);
      if (Object.keys(chunk).length) d = lib.setJudgeResults(d, check.id, chunk);
      if (final && Object.keys(recorded).length) {
        if (split === 'test') d = lib.revealTest(d, check.id); // no change when already revealed
        if (split !== 'unlabeled') d = lib.recordRun(d, check.id, split);
      }
      return d;
    })).then((saved) => saved, (err) => { saveError = err; return null; });
    return saving;
  };

  const record = async (id, verdict, critique) => {
    recorded[id] = { verdict, critique };
    pending[id] = { verdict, critique };
    pendingCount++;
    if (pendingCount >= 10) await save(false);
  };

  // Model commands run in their own process groups, so Ctrl+C reaches them only through here.
  const onSignal = () => {
    if (stopping) { // a second Ctrl+C stops at once, without the last save
      for (const c of children) c.kill('SIGKILL');
      process.exit(1);
    }
    stopping = true;
    io.err('Stopping. Saving the results so far...');
    for (const c of children) c.kill('SIGTERM');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const worker = async (group) => {
    const input = batch === 1
      ? lib.renderJudgeInput(prompt, lib.getNormalized(judgeProject, group[0]), renderOpts)
      : lib.batchJudgePrompt(judgeProject, check.id, group);
    const r = await runCommand(argv, input, { timeoutMs: timeout * 1000, cwd: io.cwd, env: io.env, children });
    if (stopping && !r.ok) return;
    if (!r.ok) {
      if (r.fatal) fatal = r.reason;
      for (const id of group) errors.push({ id, reason: r.reason });
    } else if (batch === 1) {
      const v = lib.parseJudgeOutput(r.stdout);
      if (v && (v.verdict === 'pass' || v.verdict === 'fail')) await record(group[0], v.verdict, v.critique);
      else errors.push({ id: group[0], reason: 'The answer had no readable Pass or Fail result.' });
    } else {
      const got = lib.parseJudgeResults(r.stdout).results;
      for (const id of group) {
        const v = got[id];
        if (v && (v.verdict === 'pass' || v.verdict === 'fail')) await record(id, v.verdict, v.critique);
        else errors.push({ id, reason: 'The batch answer had no readable Pass or Fail result for this trace.' });
      }
    }
    judged += group.length;
    if (judged % 10 < group.length || judged === ids.length) io.err(`Judged ${commas(judged)} of ${plural(ids.length, 'trace')}...`);
  };

  io.err(`Judging ${plural(ids.length, 'trace')} (${splitName}) for "${mode.name}" with: ${argv.map((a) => (/\s/.test(a) || !a ? `"${a}"` : a)).join(' ')}`);
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
      while (next < groups.length && !stopping && !fatal) await worker(groups[next++]);
    }));
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  const saved = await save(true);
  if (saveError) throw saveError;

  const count = Object.keys(recorded).length;
  if (!count) {
    const first = fatal || (errors[0] && errors[0].reason) || 'no answers came back.';
    throw new CliError(stopping ? 'Stopped before any trace was judged.' : `None of the traces could be judged. ${first}`);
  }
  const after = saved || p;
  if (!after.checks?.some((c) => c.id === check.id)) io.err(`Note: the check "${check.id}" was deleted from ${label} while the judge ran, so its results were not kept.`);

  io.out(`Judged ${plural(count, 'trace')} (${splitName}) with "${check.name || check.id}".${errors.length ? ` ${plural(errors.length, 'trace')} could not be judged.` : ''}`);
  if (split === 'unlabeled') {
    const flagged = Object.values(recorded).filter((v) => v.verdict === 'fail').length;
    io.out(`The judge flagged ${commas(flagged)} of ${commas(count)} (${lib.pct(flagged / count)}).`);
    io.out(`For the likely true failure rate, run: node "${CLI_PATH}" estimate "${label}" --check ${check.id}${flags.traces ? ` --traces "${flags.traces}"` : ''}`);
  } else {
    const a = lib.checkAgreement(after, check.id, { split });
    if (split === 'test') io.out(finishing ? `Added answers to the final test revealed on ${usedOn}.` : 'The final test is now revealed.');
    for (const l of agreementLines(a)) io.out(l);
    io.out('Aim for both above 90%. 80% is the minimum.');
    if (a.falsePasses.length) io.out(`Check missed these failures: ${listIds(a.falsePasses)}`);
    if (a.falseFails.length) io.out(`Check flagged these good traces: ${listIds(a.falseFails)}`);
  }
  for (const e of errors.slice(0, 5)) io.err(`Could not judge ${e.id}: ${e.reason}`);
  if (errors.length > 5) io.err(`Could not judge ${commas(errors.length - 5)} more traces.`);
  io.out(`Saved to ${label}.`);
  if (stopping) {
    io.err('Stopped early. Run the same command again to judge the rest.');
    return 1;
  }
  return errors.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// agreement, estimate, retrieval

async function cmdAgreement(args, io) {
  const { flags } = args;
  if (!flags.check) throw new CliError(`Pass --check <id>.\n${usageOf('agreement')}`);
  const split = flags.split || 'tuning';
  if (!['tuning', 'test'].includes(split)) throw new CliError(`--split must be tuning or test, not "${split}".`);
  const { project } = openProject(args, io, { tracesFlag: null });
  const check = findCheck(project, flags.check);
  const mode = modeOf(project, check);
  let a;
  let where;
  if (lib.isCodeCheck(check)) {
    a = lib.checkAgreement(project, check.id);
    where = `${plural(a.n, 'labeled trace')}`;
    if (flags.split) io.err('Note: code checks are measured on every labeled trace, so --split does not apply.');
  } else {
    const p = lib.assignSplits(project, mode.id);
    if (split === 'test' && !p.splits?.[mode.id]?.revealedAt) {
      throw new CliError(`The final test for "${mode.name}" is still hidden. Reveal it once, at the end: pmstack judge ... --split test --final`);
    }
    a = lib.checkAgreement(p, check.id, { split });
    where = `${plural(a.n, 'labeled trace')} in the ${split === 'test' ? 'final test' : 'tuning set'}`;
    if (split === 'test' && lib.checkTestState(p, check.id) === 'outdated') io.err('Note: out of date. The judge or your labels changed after the final test.');
  }
  io.out(`${check.name || check.id} (${lib.checkTypeLabel(check)}) for "${mode.name}", on ${where}.`);
  if (!a.n) {
    io.out(check.type === 'judge'
      ? 'No judge results on these traces yet. Run pmstack judge first.'
      : 'No labeled traces yet. Review traces and label this failure mode in Eval Studio.');
    return 0;
  }
  for (const l of agreementLines(a)) io.out(l);
  if (a.falsePasses.length) io.out(`Check missed these failures: ${listIds(a.falsePasses)}`);
  if (a.falseFails.length) io.out(`Check flagged these good traces: ${listIds(a.falseFails)}`);
  if (a.unreadable?.length) io.out(`${plural(a.unreadable.length, 'judge answer')} could not be read.`);
  if (a.missing) io.out(`${plural(a.missing, 'labeled trace')} ${a.missing === 1 ? 'has' : 'have'} no judge result yet.`);
  if (a.errors?.length) io.out(`The check could not run on ${plural(a.errors.length, 'trace')}: ${listIds(a.errors)}`);
  return 0;
}

async function cmdEstimate(args, io) {
  const { flags } = args;
  if (!flags.check) throw new CliError(`Pass --check <id>.\n${usageOf('estimate')}`);
  const { project } = openProject(args, io);
  const check = findCheck(project, flags.check);
  if (check.type !== 'judge') throw new CliError('Only AI judges have a likely true failure rate. A code check has no mistakes to correct for.');
  const mode = modeOf(project, check);
  const p = lib.assignSplits(project, mode.id);
  const state = lib.checkTestState(p, check.id);
  if (state === 'hidden') throw new CliError(`The final test for "${mode.name}" is still hidden. Reveal it first: pmstack judge ... --split test --final`);
  if (state === 'outdated') throw new CliError('Label new traces for a fresh final test. The judge or your labels changed after the final test, so it no longer says how good the judge is.');
  const r = lib.likelyFailureRate(p, check.id);
  if (!r.judged) {
    throw new CliError(`No judge results on unlabeled traces yet. Run: pmstack judge ... --check ${check.id} --split unlabeled${flags.traces ? ' --traces <file>' : ''}`);
  }
  if (r.estimate == null) throw new CliError(r.reason || 'The final test is too small to correct for the judge\'s mistakes. Label more traces for a fresh final test.');
  const on = `On the ${plural(r.population, 'trace')} you have not labeled`;
  io.out(`${on}${r.judged < r.population ? ` (${commas(r.judged)} judged)` : ''}, the judge flagged ${lib.pct(r.flagged)} of them.`);
  const range = r.low != null && r.high != null ? ` (95% range: ${lib.pct(r.low)} to ${lib.pct(r.high)})` : '';
  io.out(`Correcting for its known mistakes, the likely true failure rate is ${lib.pct(r.estimate)}${range}.`);
  if (!range && r.reason) io.out(r.reason);
  if (r.test && r.test.n) {
    io.out(`From the final test: catches real failures ${lib.pct(r.test.catchesFailures)} (${r.test.tn} of ${r.test.tn + r.test.fp}), agrees on good traces ${lib.pct(r.test.agreesOnGood)} (${r.test.tp} of ${r.test.tp + r.test.fn}).`);
  }
  return 0;
}

async function cmdRetrieval(args, io) {
  const k = numberFlag(args.flags, 'k', { min: 1, max: 1000, def: 5 });
  const { project } = openProject(args, io);
  const r = lib.retrievalSummary(project, k);
  if (!r.n) {
    throw new CliError('No reviewed traces mark the sources they needed yet. In Eval Studio, open a trace in the answer view and mark each source the answer needed.');
  }
  io.out(`Retrieval on ${plural(r.n, 'reviewed trace')} that mark the sources they needed:`);
  const rows = [
    [`  Found in the top ${k} (recall at ${k})`, lib.pct(r.recallAtK), 'of the needed sources'],
    ['  Mean reciprocal rank', r.mrr.toFixed(2), '1.00 means a needed source always came first'],
  ];
  for (const l of table(rows, [1])) io.out(l);
  io.out(`Pick --k to match how many search results your product passes to the AI.`);
  return 0;
}

// ---------------------------------------------------------------------------
// report, regression-set

async function cmdReport(args, io) {
  const { project: p } = openProject(args, io, { tracesFlag: null });
  const out = path.resolve(io.cwd, args.flags.out || 'report.md');
  const svgPath = out.replace(/\.(md|markdown)$/i, '') + '-funnel.svg';
  const svgName = path.basename(svgPath);
  const md = lib.markdownReport(p, { funnelImage: svgName.split(' ').join('%20') });
  const svg = lib.funnelSvg(lib.computeFunnel(p), { theme: 'light' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  fs.writeFileSync(svgPath, svg);
  io.out(`Wrote ${shownPath(out, io.cwd)} and ${shownPath(svgPath, io.cwd)}.`);
  io.out('The report quotes your traces. Read it before sharing outside your company.');
  return 0;
}

async function cmdRegressionSet(args, io) {
  const { project: p } = openProject(args, io, { tracesFlag: null });
  const out = path.resolve(io.cwd, args.flags.out || 'regression.jsonl');
  const text = lib.regressionSet(p);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  const n = text ? text.trim().split('\n').length : 0;
  const shown = shownPath(out, io.cwd);
  if (!n) {
    io.out(`Wrote an empty ${shown}. It fills in once a failure mode is set to "Fix it now" or "Build a check", or a Good trace shows a success mode.`);
  } else {
    io.out(`Wrote ${shown}: ${plural(n, 'trace')} every future version must still handle. Give it to your engineers.`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// policy

function loadTracesOrProject(file, io) {
  const label = shownPath(file, io.cwd);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new CliError(err.code === 'ENOENT' ? `${label} was not found.` : `${label} could not be read: ${err.message}`);
  }
  if (/\.json$/i.test(file)) {
    const value = readJsonQuiet(file);
    if (isObj(value) && value.format === lib.FORMAT) return openProject({ positionals: [file], flags: {} }, io, { tracesFlag: null }).project;
  }
  const parsed = lib.parseTraceFile(text, path.basename(file));
  if (!parsed.traces.length) throw new CliError(`No traces could be read from ${label}.${parsed.errors.length ? ' ' + parsed.errors.slice(0, 3).join(' ') : ''}`);
  noteParseProblems(parsed, label, io);
  const experience = lib.defaultExperience({ pattern: lib.suggestPattern(parsed.traces), renderer: lib.suggestView(parsed.traces) });
  return lib.createProject({ id: 'traces', name: path.basename(file), experience, traces: parsed.traces });
}

async function cmdPolicy({ flags, positionals }, io) {
  const file = path.resolve(io.cwd, positionals[0]);
  if (typeof lib.evaluatePolicy !== 'function' || typeof lib.validatePolicy !== 'function' || typeof lib.toolInventory !== 'function') {
    throw new CliError('This copy of pmstack cannot check tool policies yet. Update pmstack and try again.');
  }
  let policy = null;
  let policyLabel = '';
  if (flags.policy) {
    const policyPath = path.resolve(io.cwd, flags.policy);
    policyLabel = shownPath(policyPath, io.cwd);
    policy = readJsonFile(policyPath, policyLabel);
    const v = lib.validatePolicy(policy);
    if (!v.ok) throw new CliError(`${policyLabel} has ${plural(v.errors.length, 'problem')}:\n${v.errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  const p = loadTracesOrProject(file, io);
  const total = (p.traces || []).length;

  if (flags['list-tools']) {
    const inv = lib.toolInventory(p, policy);
    const summary = lib.toolCallSummary(p);
    if (flags.json) {
      io.out(JSON.stringify({ traces: total, withTools: summary.withTools, calls: summary.calls, tools: inv }, null, 2));
      return 0;
    }
    if (!inv.length) {
      io.out(`No tool calls found in ${plural(total, 'trace')}.`);
      return 0;
    }
    io.out(`Tools used in ${commas(summary.withTools)} of ${plural(total, 'trace')} (${plural(summary.calls, 'call')}):`);
    io.out('');
    const rows = [['Tool', 'Calls', 'Traces', policy ? 'Access' : 'Guess']];
    for (const t of inv) rows.push([t.name, commas(t.calls), commas(t.traces), policy && t.listed ? t.access : `${t.access}${policy ? ' (not in the policy)' : ''}`]);
    for (const l of table(rows, [1, 2])) io.out(l);
    io.out('');
    io.out('Read means the tool only looks something up. Write means it changes something, so it usually needs a yes first.');
    io.out('The guess comes from the name (get, list, search, lookup, find, read, verify mean read). Check each one before you write your policy.');
    return 0;
  }

  if (!policy) throw new CliError(`Pass --policy <policy.json>. To start one, list the tools your agent uses: pmstack policy "${positionals[0]}" --list-tools`);
  if (flags.user !== undefined && !String(flags.user).trim()) throw new CliError('--user needs a word, for example --user employee.');
  const userLabel = flags.user !== undefined ? String(flags.user).trim() : lib.userWord(p.experience);
  const results = [];
  for (const [id, n] of lib.normalizeAll(p)) results.push({ traceId: id, ...lib.evaluatePolicy(policy, n, { userLabel }) });
  const failing = results.filter((r) => r.verdict === 'fail');
  if (flags.json) {
    io.out(JSON.stringify({ policy: policy.name || null, traces: results.length, failing: failing.length, results }, null, 2));
    return failing.length ? 1 : 0;
  }
  // Rules made from the tools list (Ask before acting, At most N times) give each tool its own
  // reason, so they group by rule and tool; every other rule has one reason and one group.
  const groups = new Map();
  for (const r of failing) {
    for (const v of r.violations) {
      const perTool = v.ruleId === 'confirm' || v.ruleId === 'max-per-trace';
      const key = perTool ? `${v.ruleId}, ${v.tool}` : v.ruleId;
      const g = groups.get(key) || { label: v.label, why: v.why, items: [], traces: new Set() };
      g.items.push({ traceId: r.traceId, ...v });
      g.traces.add(r.traceId);
      groups.set(key, g);
    }
  }
  io.out(`Checked ${plural(results.length, 'trace')} against ${policy.name ? `"${policy.name}"` : policyLabel}.`);
  for (const [ruleId, g] of groups) {
    io.out('');
    io.out(`${g.label} (${ruleId}): ${plural(g.traces.size, 'trace')}, ${plural(g.items.length, 'call')}`);
    if (g.why) io.out(`  Why: ${g.why}`);
    for (const v of g.items.slice(0, 10)) io.out(`  ${v.traceId}  step ${v.stepId}  ${v.fact || v.message}`);
    if (g.items.length > 10) io.out(`  and ${commas(g.items.length - 10)} more`);
  }
  io.out('');
  io.out(failing.length
    ? `Breaks the policy in ${commas(failing.length)} of ${plural(results.length, 'trace')}.`
    : `No call breaks the policy in ${plural(results.length, 'trace')}.`);
  return failing.length ? 1 : 0;
}

// ---------------------------------------------------------------------------

if (process.argv[1] && (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
