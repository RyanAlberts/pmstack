// Project file reads and writes (SPEC 6.3): the lock, the revision bump, and atomic writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withProjectLock, saveProjectFile, loadProjectFile, splitArgs } from '../../bin/pmstack.mjs';
import { folderProject, chat, readJson, write, tmpDir } from './helpers.mjs';

const traces = [chat('a', 'hi', 'hello'), chat('b', 'bye', 'goodbye')];

test('loadProjectFile fills traces from the trace file named relative to the project', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  const p = loadProjectFile(projectPath);
  assert.equal(p.tracesFile, '../traces.jsonl');
  assert.deepEqual(p.traces.map((x) => x.id), ['a', 'b']);
  assert.ok(!('traces' in readJson(projectPath)));
});

test('saveProjectFile bumps the revision and drops traces when tracesFile is set', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  const p = loadProjectFile(projectPath);
  const saved = await saveProjectFile(projectPath, { ...p, name: 'Next' });
  assert.equal(saved.revision, 2);
  assert.equal(saved.traces.length, 2, 'the returned project keeps its traces in memory');
  const disk = readJson(projectPath);
  assert.equal(disk.revision, 2);
  assert.equal(disk.name, 'Next');
  assert.ok(!('traces' in disk));
  const again = await saveProjectFile(projectPath, (d) => ({ ...d, name: 'From disk' }));
  assert.equal(again.revision, 3);
  assert.equal(readJson(projectPath).name, 'From disk');
});

test('the revision always comes from the file on disk', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  const p = loadProjectFile(projectPath);
  await saveProjectFile(projectPath, { ...p, revision: 99 });
  assert.equal(readJson(projectPath).revision, 2);
});

test('concurrent writers wait for the lock and never lose a change', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  await Promise.all(Array.from({ length: 8 }, (_, i) => withProjectLock(projectPath, async (disk) => {
    await new Promise((r) => setTimeout(r, 5));
    return { ...disk, settings: { ...disk.settings, count: (disk.settings.count || 0) + 1, [`w${i}`]: true } };
  })));
  const disk = readJson(projectPath);
  assert.equal(disk.revision, 9);
  assert.equal(disk.settings.count, 8);
  const dir = path.dirname(projectPath);
  assert.ok(!fs.existsSync(path.join(dir, '.lock')), 'lock removed');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'no temporary files left');
});

test('a held lock makes the writer wait; a stale lock is taken over', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  const lock = path.join(path.dirname(projectPath), '.lock');
  fs.writeFileSync(lock, '12345\n');
  const started = Date.now();
  setTimeout(() => fs.unlinkSync(lock), 200);
  await withProjectLock(projectPath, (d) => ({ ...d, name: 'after wait' }));
  assert.ok(Date.now() - started >= 180, 'waited for the other writer');
  assert.equal(readJson(projectPath).name, 'after wait');

  fs.writeFileSync(lock, '12345\n');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  const t0 = Date.now();
  await withProjectLock(projectPath, (d) => ({ ...d, name: 'stale lock ignored' }));
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(readJson(projectPath).name, 'stale lock ignored');
});

test('a lock that never goes away ends in a plain error', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  const lock = path.join(path.dirname(projectPath), '.lock');
  fs.writeFileSync(lock, '12345\n');
  await assert.rejects(withProjectLock(projectPath, (d) => d, { timeoutMs: 150 }), /locked by another program/);
  assert.equal(readJson(projectPath).revision, 1);
  fs.unlinkSync(lock);
});

test('the lock is released when the change fails, and returning null writes nothing', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  await assert.rejects(withProjectLock(projectPath, () => { throw new Error('nope'); }), /nope/);
  assert.ok(!fs.existsSync(path.join(path.dirname(projectPath), '.lock')));
  const r = await withProjectLock(projectPath, () => null);
  assert.equal(r.written, false);
  assert.equal(r.revision, 1);
  assert.equal(readJson(projectPath).revision, 1);
});

test('writes replace the file in one step', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  const before = fs.statSync(projectPath).ino;
  await saveProjectFile(projectPath, (d) => ({ ...d, name: 'renamed' }));
  assert.notEqual(fs.statSync(projectPath).ino, before, 'a new file was renamed into place');
  assert.equal(readJson(projectPath).name, 'renamed');
});

test('a new project file starts at revision 1 and makes its folder', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'pmstack', 'project.json');
  const r = await withProjectLock(file, (disk) => {
    assert.equal(disk, null);
    return { format: 'pmstack.project/1', id: 'x', revision: 1, traces: [] };
  });
  assert.equal(r.revision, 1);
  assert.equal(readJson(file).revision, 1);
});

test('a broken project file is reported with its line and left alone', async (t) => {
  const { projectPath } = await folderProject(t, { traces });
  write(projectPath, '{\n  "revision": 2,\n  oops\n}\n');
  assert.throws(() => loadProjectFile(projectPath), (err) => err.line === 3 && /could not be read \(line 3\)/.test(err.message));
  await assert.rejects(withProjectLock(projectPath, (d) => d), /line 3/);
  assert.equal(fs.readFileSync(projectPath, 'utf8'), '{\n  "revision": 2,\n  oops\n}\n');
});

test('splitArgs keeps quoted parts together and never needs a shell', () => {
  assert.deepEqual(splitArgs('claude -p --model {model}'), ['claude', '-p', '--model', '{model}']);
  assert.deepEqual(splitArgs(`node "my judge.mjs" --flag 'a b' ""`), ['node', 'my judge.mjs', '--flag', 'a b', '']);
  assert.deepEqual(splitArgs('say "a \\"quoted\\" word"'), ['say', 'a "quoted" word']);
  assert.deepEqual(splitArgs('a\\ b c'), ['a b', 'c']);
  assert.deepEqual(splitArgs('C:\\tools\\judge.exe --x'), ['C:\\tools\\judge.exe', '--x']);
  assert.deepEqual(splitArgs('echo $(rm -rf /) ; ls'), ['echo', '$(rm', '-rf', '/)', ';', 'ls']);
  assert.throws(() => splitArgs('say "open'), /never closed/);
});
