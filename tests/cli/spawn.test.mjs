// The command as a real process: exit codes, and the studio's one line, clean stop, and .studio.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CLI, HERE, tmpDir, folderProject, chat, request } from './helpers.mjs';

const node = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

test('exit codes as a process, and the studio starts and stops cleanly', async (t) => {
  const dir = tmpDir(t);
  assert.equal(node([], dir).status, 0);
  assert.equal(node(['nope'], dir).status, 2);

  const { projectPath } = await folderProject(t, {
    traces: [chat('a', 'q', 'Your **time** is set.', { channel: 'sms' }), chat('b', 'q', 'All set.', { channel: 'sms' })],
    build: (p) => ({
      ...p,
      modes: [{ id: 'fm-x', kind: 'failure', name: 'Stray symbols', definition: 'Fails when a text shows **.', stage: 'answer', createdAt: '2026-09-15T09:00:00.000Z', source: 'human' }],
      checks: [{ id: 'ck-x', modeId: 'fm-x', type: 'code', name: 'No stars', rule: { op: 'contains', target: 'assistant', value: '**' }, when: null, failWhen: 'match', ci: true }],
    }),
  });
  assert.equal(node(['validate', projectPath], dir).status, 0);
  const failing = node(['check', projectPath], dir);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /1 of 2 traces pass every check\./);
  assert.equal(node(['check', projectPath, '--max-fail', '1'], dir).status, 0);

  // Studio as a separate process through a symlinked path, as installs do.
  const folder = tmpDir(t);
  fs.cpSync(path.resolve(HERE, '../fixtures/folder'), folder, { recursive: true });
  const linkDir = tmpDir(t);
  const link = path.join(linkDir, 'pmstack.mjs');
  fs.symlinkSync(CLI, link);
  const child = spawn(process.execPath, [link, 'studio', folder, '--port', '0'], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
  let out = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the studio did not print its address')), 10000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /Eval Studio: (http:\/\/127\.0\.0\.1:(\d+)\/)\n/.exec(out);
      if (m) { clearTimeout(timer); resolve(m); }
    });
    child.on('exit', (code) => reject(new Error(`the studio exited early with ${code}`)));
  });
  const port = Number(url[2]);
  const info = (await request(port, { path: '/api/info' })).json();
  assert.equal(info.mode, 'folder');
  assert.equal(fs.realpathSync(info.folder), fs.realpathSync(folder));
  const studioFile = path.join(folder, 'pmstack', '.studio.json');
  assert.equal(JSON.parse(fs.readFileSync(studioFile, 'utf8')).pid, child.pid);
  const index = await request(port, { path: '/' });
  assert.equal(index.status, 200);

  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 0);
  assert.equal(out, url[0], 'exactly one line on standard output');
  assert.ok(!fs.existsSync(studioFile), '.studio.json removed on stop');
  assert.ok(fs.existsSync(path.join(folder, 'pmstack', 'project.json')));
});
