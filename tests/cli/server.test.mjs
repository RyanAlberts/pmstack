// The studio server (SPEC 6.2): who may talk to it, which files it serves, and the /api/ routes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, createStaticHandler } from '../../bin/pmstack.mjs';
import { tmpDir, startServer, request, write, readJson, chat, folderProject, jsonl, CLI } from './helpers.mjs';
import http from 'node:http';

const traces = [
  chat('r-1', 'Two hybrids Saturday?', 'Pier 3 has two hybrids at 10:00 AM.', { channel: 'sms' }),
  chat('r-2', 'How much is an e-bike?', 'E-bikes are $32 for 2 hours.', { channel: 'web' }),
  chat('r-3', 'Call recording test', 'Sure.', { channel: 'voice', recording: 'calls/r-3.mp3' }),
];

async function studio(t, opts = {}) {
  const f = await folderProject(t, { traces, ...opts });
  const port = await startServer(t, { folder: f.dir, ...(opts.server || {}) });
  return { ...f, port };
}

const put = (port, body, headers = {}) => request(port, {
  method: 'PUT', path: '/api/project', body,
  headers: { 'Content-Type': 'application/json', ...headers },
});

test('refuses requests for another host name', async (t) => {
  const { port } = await studio(t);
  for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`]) {
    const r = await request(port, { path: '/api/info', headers: { Host: host } });
    assert.equal(r.status, 403, host);
  }
  const ok = await request(port, { path: '/api/info', headers: { Host: `localhost:${port}` } });
  assert.equal(ok.status, 200);
});

test('refuses writes from other sites and never sends cross-site headers', async (t) => {
  const { port, projectPath } = await studio(t);
  const project = readJson(projectPath);
  const foreign = await put(port, project, { 'If-Match': '"1"', Origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  const foreignGet = await request(port, { path: '/api/project', headers: { Origin: 'http://evil.example' } });
  assert.equal(foreignGet.status, 403);
  const same = await put(port, project, { 'If-Match': '"1"', Origin: `http://localhost:${port}` });
  assert.equal(same.status, 200);
  const options = await request(port, { method: 'OPTIONS', path: '/api/project', headers: { Origin: `http://127.0.0.1:${port}`, 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(options.status, 405);
  for (const r of [foreign, same, options]) {
    assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control-')), 'no cross-site headers');
  }
  assert.equal(readJson(projectPath).revision, 2);
});

test('serves the studio with the right types and no caching', async (t) => {
  const { port } = await studio(t);
  const index = await request(port, { path: '/' });
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /^text\/html/);
  assert.equal(index.headers['cache-control'], 'no-store');
  assert.match(index.text, /app\.mjs/);
  const app = await request(port, { path: '/app.mjs?v=2.0.0' });
  assert.equal(app.status, 200);
  assert.match(app.headers['content-type'], /^text\/javascript/);
  const css = await request(port, { path: '/styles/tokens.css' });
  assert.match(css.headers['content-type'], /^text\/css/);
  const missing = await request(port, { path: '/nope.mjs' });
  assert.equal(missing.status, 404);
});

test('maps /assets/ to docs/assets', async (t) => {
  const root = tmpDir(t);
  const studioRoot = path.join(root, 'studio');
  const assetsRoot = path.join(root, 'assets');
  write(path.join(studioRoot, 'index.html'), '<!doctype html><title>x</title>');
  write(path.join(assetsRoot, 'visuals', 'funnel.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const f = await folderProject(t, { traces });
  const port = await startServer(t, { folder: f.dir, studioRoot, assetsRoot });
  const r = await request(port, { path: '/assets/visuals/funnel.svg' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/svg+xml');
  const out = await request(port, { path: '/assets/..%2fstudio%2findex.html' });
  assert.equal(out.status, 404);
});

test('path tricks: encoded dot segments, malformed escapes, NUL, and links that leave the root', async (t) => {
  const { port, dir } = await studio(t);
  const r1 = await request(port, { path: '/..%2f..%2fetc/passwd' });
  assert.equal(r1.status, 404);
  const r2 = await request(port, { path: '/..%2f..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd' });
  assert.equal(r2.status, 404);
  const r3 = await request(port, { path: '/%E0%A4%A' });
  assert.equal(r3.status, 400);
  const r4 = await request(port, { path: '/index.html%00.png' });
  assert.equal(r4.status, 400);
  const r5 = await request(port, { path: '//evil.example/' });
  assert.equal(r5.status, 404);

  // A link inside a served folder that points outside it is not followed.
  const root = tmpDir(t);
  const secret = write(path.join(root, 'secret.txt'), 'secret');
  const served = path.join(root, 'site');
  write(path.join(served, 'ok.mjs'), 'export default 1;');
  fs.symlinkSync(secret, path.join(served, 'leak.txt'));
  fs.symlinkSync(root, path.join(served, 'up'));
  const handler = createStaticHandler(served);
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const p = server.address().port;
  assert.equal((await request(p, { path: '/ok.mjs' })).status, 200);
  assert.match((await request(p, { path: '/ok.mjs' })).headers['content-type'], /^text\/javascript/);
  assert.equal((await request(p, { path: '/leak.txt' })).status, 404);
  assert.equal((await request(p, { path: '/up/secret.txt' })).status, 404);
  const dirRedirect = await request(p, { path: '/sub' });
  assert.equal(dirRedirect.status, 404);
  fs.mkdirSync(path.join(served, 'sub'));
  write(path.join(served, 'sub', 'index.html'), 'hi');
  const redirect = await request(p, { path: '/sub?x=1' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, 'sub/');
  assert.equal((await request(p, { path: '/sub/' })).text, 'hi');
  assert.ok(dir);
});

test('custom views: id rules, the right type, and no escape from the renderers folder', async (t) => {
  const { port, dir } = await studio(t);
  write(path.join(dir, 'pmstack', 'renderers', 'sms-card.mjs'), 'export default function View() { return null; }');
  const outside = write(path.join(dir, 'outside.mjs'), 'export default 1;');
  fs.symlinkSync(outside, path.join(dir, 'pmstack', 'renderers', 'linked.mjs'));
  const ok = await request(port, { path: '/custom/renderers/sms-card.mjs' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /^text\/javascript/);
  for (const bad of ['Sms-Card', '-card', 'a'.repeat(42), 'sms_card', '..%2foutside', '%2e%2e', 'linked', 'missing']) {
    const r = await request(port, { path: `/custom/renderers/${bad}.mjs` });
    assert.equal(r.status, 404, bad);
  }
  assert.equal((await request(port, { path: '/custom/renderers/sms-card.js' })).status, 404);
});

test('recordings: only files the traces name, inside the folder', async (t) => {
  const { port, dir } = await studio(t);
  write(path.join(dir, 'calls', 'r-3.mp3'), 'ID3fake');
  write(path.join(dir, 'calls', 'other.mp3'), 'ID3other');
  const ok = await request(port, { path: '/recordings/calls/r-3.mp3' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'audio/mpeg');
  assert.equal(ok.text, 'ID3fake');
  const range = await request(port, { path: '/recordings/calls/r-3.mp3', headers: { Range: 'bytes=0-2' } });
  assert.equal(range.status, 206);
  assert.equal(range.text, 'ID3');
  assert.equal((await request(port, { path: '/recordings/calls/other.mp3' })).status, 404);
  assert.equal((await request(port, { path: '/recordings/..%2fpmstack%2fproject.json' })).status, 404);
  assert.equal((await request(port, { path: '/recordings/%E0%A4%A' })).status, 400);
});

test('api/info names the folder, project, trace file, and this command', async (t) => {
  const { port, dir, projectPath } = await studio(t);
  const info = (await request(port, { path: '/api/info' })).json();
  assert.equal(info.mode, 'folder');
  assert.equal(info.folder, dir);
  assert.equal(info.projectPath, projectPath);
  assert.equal(info.tracesFile, 'traces.jsonl');
  assert.equal(info.version, '2.0.0');
  assert.equal(info.cliPath, CLI);
  assert.equal(info.revision, 1);
});

test('project: ETag, If-Match, 409 on a stale revision, 428 without one, and no traces in saves', async (t) => {
  const { port, projectPath } = await studio(t);
  const get = await request(port, { path: '/api/project' });
  assert.equal(get.status, 200);
  assert.equal(get.headers.etag, '"1"');
  const project = get.json();
  assert.equal(project.traces.length, 3, 'traces come from the trace file');
  const { traces: _t, ...forDisk } = project;

  const saved = await put(port, { ...forDisk, name: 'Renamed' }, { 'If-Match': '"1"' });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.etag, '"2"');
  assert.deepEqual(saved.json(), { ok: true, revision: 2 });
  const disk = readJson(projectPath);
  assert.equal(disk.revision, 2);
  assert.equal(disk.name, 'Renamed');
  assert.ok(!('traces' in disk), 'traces stay in their own file');

  const stale = await put(port, { ...forDisk, name: 'Stale' }, { 'If-Match': '"1"' });
  assert.equal(stale.status, 409);
  const conflict = stale.json();
  assert.equal(conflict.revision, 2);
  assert.equal(conflict.project.name, 'Renamed');
  assert.equal(conflict.project.traces.length, 3);

  assert.equal((await put(port, forDisk)).status, 428);
  assert.equal((await put(port, forDisk, { 'If-Match': '"2"', 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await put(port, 'not json', { 'If-Match': '"2"' })).status, 400);
  assert.equal((await put(port, { format: 'other' }, { 'If-Match': '"2"' })).status, 400);
  const withTraces = await put(port, project, { 'If-Match': '"2"' });
  assert.equal(withTraces.status, 400);
  assert.match(withTraces.json().error, /trace file/);
  assert.equal(readJson(projectPath).revision, 2);
});

test('project with inline traces keeps them when a save leaves them out', async (t) => {
  const { port, projectPath } = await studio(t, { inline: true });
  const project = (await request(port, { path: '/api/project' })).json();
  assert.equal(project.traces.length, 3);
  const { traces: _t, ...rest } = project;
  assert.equal((await put(port, rest, { 'If-Match': '"1"' })).status, 200);
  assert.equal(readJson(projectPath).traces.length, 3);
});

test('422 with the line number when project.json is broken', async (t) => {
  const { port, projectPath } = await studio(t);
  fs.writeFileSync(projectPath, '{\n  "format": "pmstack.project/1",\n  "revision": 3,\n  "name": "x",,\n}\n');
  const r = await request(port, { path: '/api/project' });
  assert.equal(r.status, 422);
  const body = r.json();
  assert.equal(body.line, 4);
  assert.match(body.error, /out of place/);
  const rev = (await request(port, { path: '/api/revision' })).json();
  assert.equal(rev.revision, null);
  assert.equal(typeof rev.mtimeMs, 'number');
  const saved = await put(port, { format: 'pmstack.project/1', id: 'x' }, { 'If-Match': '"3"' });
  assert.equal(saved.status, 422);
});

test('revision reports the project and trace file times', async (t) => {
  const { port, tracesPath } = await studio(t);
  const r = (await request(port, { path: '/api/revision' })).json();
  assert.equal(r.revision, 1);
  assert.equal(r.tracesMtimeMs, fs.statSync(tracesPath).mtimeMs);
  assert.equal(r.mtimeMs > 0, true);
});

test('suggestions: empty when missing, 204 when not newer, error while half written', async (t) => {
  const { port, dir } = await studio(t);
  const file = path.join(dir, 'pmstack', 'suggestions.json');
  const none = await request(port, { path: '/api/suggestions?since=0' });
  assert.equal(none.status, 200);
  assert.deepEqual(none.json(), { suggestions: [], mtimeMs: 0 });

  write(file, JSON.stringify({ suggestions: [{ id: 'sg-20260920120000-1', kind: 'flag', status: 'open', traceId: 'r-1', modeId: 'fm-x' }] }));
  const first = await request(port, { path: '/api/suggestions?since=0' });
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.suggestions.length, 1);
  assert.equal(body.mtimeMs, fs.statSync(file).mtimeMs);
  const same = await request(port, { path: `/api/suggestions?since=${body.mtimeMs}` });
  assert.equal(same.status, 204);

  fs.writeFileSync(file, '{"suggestions": [ {"id": ');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  const broken = await request(port, { path: `/api/suggestions?since=${body.mtimeMs}` });
  assert.equal(broken.status, 200);
  assert.deepEqual(broken.json(), { suggestions: [], mtimeMs: body.mtimeMs, error: 'suggestions.json is not valid JSON yet' });
});

test('POST /api/traces appends new traces and skips ids already there', async (t) => {
  const { port, projectPath, tracesPath } = await studio(t);
  const r = await request(port, {
    method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json' },
    body: { traces: [chat('r-2', 'dup', 'dup'), chat('r-4', 'New question', 'New answer'), chat('r-5', 'Another', 'Reply')] },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { added: 2, skipped: 1, revision: 2 });
  const lines = fs.readFileSync(tracesPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id);
  assert.deepEqual(lines, ['r-1', 'r-2', 'r-3', 'r-4', 'r-5']);
  assert.equal(readJson(projectPath).revision, 2);
  const project = (await request(port, { path: '/api/project' })).json();
  assert.equal(project.traces.length, 5);

  const again = await request(port, {
    method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json' },
    body: { traces: [chat('r-4', 'x', 'y')] },
  });
  assert.deepEqual(again.json(), { added: 0, skipped: 1, revision: 2 });
  const foreign = await request(port, {
    method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: { traces: [chat('r-9', 'x', 'y')] },
  });
  assert.equal(foreign.status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json' }, body: { traces: [] } })).status, 400);
});

test('POST /api/traces with a version tags new traces and, the first time, the earlier ones', async (t) => {
  const { port, projectPath, tracesPath } = await studio(t);
  const r = await request(port, {
    method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json' },
    body: { traces: [chat('r-8', 'After the fix', 'Fixed reply')], version: 'Version 2' },
  });
  assert.deepEqual(r.json(), { added: 1, skipped: 0, revision: 2 });
  const versions = fs.readFileSync(tracesPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.id, x.metadata.version]);
  assert.deepEqual(versions, [['r-1', 'Version 1'], ['r-2', 'Version 1'], ['r-3', 'Version 1'], ['r-8', 'Version 2']]);
  assert.ok(readJson(projectPath).experience.filters.includes('version'));
  const empty = await request(port, {
    method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json' },
    body: { traces: [chat('r-9', 'q', 'a')], version: '  ' },
  });
  assert.equal(empty.status, 400);
});

test('POST /api/traces with inline traces writes them into project.json', async (t) => {
  const { port, projectPath } = await studio(t, { inline: true });
  const r = await request(port, {
    method: 'POST', path: '/api/traces', headers: { 'Content-Type': 'application/json' },
    body: { traces: [chat('r-7', 'Q', 'A')] },
  });
  assert.deepEqual(r.json(), { added: 1, skipped: 0, revision: 2 });
  assert.deepEqual(readJson(projectPath).traces.map((x) => x.id), ['r-1', 'r-2', 'r-3', 'r-7']);
});

test('bodies over the limit are refused', async (t) => {
  const f = await folderProject(t, { traces });
  const port = await startServer(t, { folder: f.dir, bodyLimit: 1000 });
  const big = { ...readJson(f.projectPath), name: 'x'.repeat(5000) };
  const r = await put(port, big, { 'If-Match': '"1"' });
  assert.equal(r.status, 413);
  assert.equal(readJson(f.projectPath).revision, 1);
});

test('writes from the studio are serialized and each bumps the revision once', async (t) => {
  const { port, projectPath } = await studio(t);
  const base = readJson(projectPath);
  const results = await Promise.all([1, 2, 3].map((n) => put(port, { ...base, name: `Try ${n}` }, { 'If-Match': '"1"' })));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  assert.equal(readJson(projectPath).revision, 2);
  assert.ok(!fs.existsSync(path.join(path.dirname(projectPath), '.lock')));
  assert.deepEqual(fs.readdirSync(path.dirname(projectPath)).filter((n) => n.endsWith('.tmp')), []);
});

test('unknown api routes and methods', async (t) => {
  const { port } = await studio(t);
  assert.equal((await request(port, { path: '/api/nope' })).status, 404);
  assert.equal((await request(port, { method: 'DELETE', path: '/api/project' })).status, 405);
  assert.equal((await request(port, { method: 'POST', path: '/index.html', headers: { 'Content-Type': 'application/json' }, body: {} })).status, 405);
  assert.equal(typeof createServer, 'function');
  assert.ok(jsonl([]) === '\n');
});
