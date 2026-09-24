// Helpers for the command line tests: temporary folders, captured output, HTTP requests,
// and small projects built in code. Not a test file itself (no .test. in the name).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { main, createServer } from '../../bin/pmstack.mjs';
import * as lib from '../../docs/studio/lib/index.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.resolve(HERE, '../../bin/pmstack.mjs');
export const FAKE_JUDGE = path.join(HERE, 'fake-judge.mjs');
export const NOW = '2026-09-20T12:00:00.000Z';

/** A temporary folder removed after the test. */
export function tmpDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pmstack-cli-')));
  if (t && typeof t.after === 'function') t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Run the command in-process with captured output: { code, out, err }. */
export async function run(argv, cwd, extra = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd,
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
    ...extra,
  });
  return { code, out, err };
}

/** Start a studio server on a free port; stopped after the test. Returns the port. */
export async function startServer(t, options) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }));
  return server.address().port;
}

/** One HTTP request: { status, headers, text, json() }. Host defaults to 127.0.0.1:<port>. */
export function request(port, { method = 'GET', path: p = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, Connection: 'close', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/** Write text to a file, creating folders. */
export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const jsonl = (list) => list.map((x) => JSON.stringify(x)).join('\n') + '\n';

/** A chat trace with one question and one reply. */
export function chat(id, user, reply, metadata = {}, extra = {}) {
  return { id, metadata, messages: [{ role: 'user', content: user }, { role: 'assistant', content: reply }], ...extra };
}

/**
 * A folder with traces.jsonl and pmstack/project.json (tracesFile "../traces.jsonl").
 * Returns { dir, projectPath, tracesPath }.
 */
export async function folderProject(t, { traces, build = (p) => p, inline = false } = {}) {
  const dir = tmpDir(t);
  const tracesPath = write(path.join(dir, 'traces.jsonl'), jsonl(traces));
  const experience = lib.defaultExperience({ product: 'Harbor Bike Rentals assistant', pattern: 'augmented', renderer: 'chat', filters: ['channel'] });
  let p = lib.createProject({ id: 'harbor', name: 'Harbor Bike Rentals assistant', experience, traces: lib.parseTraceFile(jsonl(traces), 'traces.jsonl').traces, now: NOW });
  p = { ...p, tracesFile: inline ? null : '../traces.jsonl' };
  p = build(p);
  const projectPath = path.join(dir, 'pmstack', 'project.json');
  write(projectPath, JSON.stringify(lib.projectForDisk(p), null, 2) + '\n');
  return { dir, projectPath, tracesPath, project: p };
}

/**
 * A project for judge tests: 40 labeled traces for one failure mode (20 fail with "BAD" in the
 * reply, 20 pass) plus 10 unlabeled ones, and an AI judge with a short custom prompt.
 */
export function judgeTraces() {
  const traces = [];
  for (let i = 1; i <= 40; i++) {
    const id = `t-${String(i).padStart(2, '0')}`;
    traces.push(chat(id, `Question ${i} about my rental`, i <= 20 ? `BAD reply number ${i}` : `Good reply number ${i}`, { channel: i % 2 ? 'sms' : 'web' }));
  }
  for (let i = 1; i <= 10; i++) {
    const id = `u-${String(i).padStart(2, '0')}`;
    traces.push(chat(id, `Unlabeled question ${i}`, i <= 3 ? `BAD unlabeled ${i}` : `Fine unlabeled ${i}`, { channel: 'sms' }));
  }
  return traces;
}

export function withJudge(p, { model = 'test-model-1', prompt = 'Decide if the reply is bad.\n{{trace}}' } = {}) {
  let q = lib.addMode(p, { kind: 'failure', name: 'Bad reply', definition: 'Fails when the reply says BAD.', stage: 'answer' }, { now: '2026-09-15T09:00:00.000Z' });
  const modeId = q.id;
  let proj = q.project;
  for (const t of proj.traces) {
    if (!t.id.startsWith('t-')) continue;
    const n = Number(t.id.slice(2));
    proj = lib.setLabel(proj, modeId, t.id, n <= 20 ? 'fail' : 'pass', { now: NOW });
    proj = lib.setCritique(proj, modeId, t.id, n <= 20 ? 'The reply says BAD.' : 'The reply is fine.', { now: NOW });
  }
  const c = lib.addCheck(proj, { id: 'ck-judge', modeId, type: 'judge', name: 'Bad reply judge', prompt, model, inputs: ['customer'] }, { now: NOW });
  return c.project;
}
