import { writeFile } from 'node:fs/promises';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const fixture = JSON.parse(input.task.context);
if (!['CACHE_LOCK_STALE', 'WRITE_IN_PROGRESS'].includes(fixture.diagnostic)) {
  throw new Error('Unsupported fixture diagnostic.');
}
await writeFile('state.json', JSON.stringify({
  diagnostic: fixture.diagnostic,
  activeWrite: fixture.activeWrite,
  exportStatus: 'stalled',
  unsavedRows: fixture.unsavedRows,
  exportRows: fixture.exportRows,
  policy: fixture.policy,
  actions: [],
}, null, 2), { flag: 'wx' });
process.stdout.write(JSON.stringify({ initialized: true }));
