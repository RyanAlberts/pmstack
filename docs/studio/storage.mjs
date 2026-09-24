// Where projects live (SPEC 5.6).
// Browser mode keeps projects in IndexedDB. Folder mode talks to the local
// server started by `pmstack studio`, which reads and writes pmstack/project.json.
// Every adapter has the same shape:
//   { kind, listProjects(), loadProject(id), saveProject(project, { ifMatch, create }),
//     deleteProject(id), saveTraces(projectId, traces), pollSuggestions(sinceMtimeMs),
//     revision(), kvGet(key), kvSet(key, value) }
// saveTraces may resolve to { revision } when the write moved the project's revision (folder mode).

import { projectForDisk } from './lib/index.mjs';

let info = null;

/** Detect the storage mode. Only a local pmstack server answers ./api/info with { mode: 'folder' }. */
export async function detect() {
  // The CLI server listens on 127.0.0.1 only, so other hosts (GitHub Pages) never probe.
  const host = location.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') return 'browser';
  try {
    const res = await fetch('./api/info', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return 'browser';
    const body = await res.json();
    if (body && body.mode === 'folder') {
      info = body;
      return 'folder';
    }
  } catch {
    // No server behind this page: browser mode.
  }
  return 'browser';
}

/** The /api/info payload from detect(), or null in browser mode. */
export function folderInfo() {
  return info;
}

/** True when an error came from the browser running out of storage space. */
export function isQuotaError(err) {
  return !!err && (err.name === 'QuotaExceededError' || err.code === 22 || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

// ---------------------------------------------------------------------------
// Browser mode: IndexedDB database "pmstack" v1 with stores projects, traces, kv.

const DB_NAME = 'pmstack';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('traces')) db.createObjectStore('traces', { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs work(tx) in one transaction and resolves only when the transaction completes,
// so a resolved save means the data is on disk.
function transact(db, names, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (err) {
      reject(err);
      return;
    }
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error('The browser stopped the save.'));
    const req = work(tx);
    if (req && typeof req === 'object' && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
  });
}

function reviewedCount(project) {
  let n = 0;
  for (const r of Object.values(project.reviews || {})) if (r && (r.verdict === 'pass' || r.verdict === 'fail')) n++;
  return n;
}

/** Short list entry for the project switcher and Set up. */
export function projectSummary(project, extra = {}) {
  return {
    id: project.id,
    name: project.name,
    sample: !!project.sample,
    updatedAt: project.updatedAt || null,
    traceCount: Array.isArray(project.traces) ? project.traces.length : (extra.traceCount ?? 0),
    reviewed: reviewedCount(project),
  };
}

function withoutTraces(project) {
  const { traces, ...rest } = project;
  return rest;
}

/** IndexedDB adapter. Falls back to an in-memory adapter when the browser blocks IndexedDB. */
export async function browserAdapter() {
  let db;
  try {
    db = await openDb();
  } catch {
    return memoryAdapter();
  }
  const getAll = (name) => transact(db, [name], 'readonly', (tx) => tx.objectStore(name).getAll());
  const get = (name, key) => transact(db, [name], 'readonly', (tx) => tx.objectStore(name).get(key));

  return {
    kind: 'browser',
    memory: false,
    async listProjects() {
      const [records, kv] = await Promise.all([getAll('projects'), getAll('kv')]);
      const counts = new Map(kv.filter((e) => e.key.startsWith('summary:')).map((e) => [e.key.slice(8), e.value]));
      return records.map((p) => projectSummary(p, counts.get(p.id) || {}));
    },
    async loadProject(id) {
      const project = await get('projects', id);
      if (!project) return null;
      const rec = await get('traces', id);
      return { ...project, traces: rec ? rec.traces : [] };
    },
    async saveProject(project, { create = false } = {}) {
      // The project store never holds traces; they are written separately and rarely.
      // Only a new or replacing copy (create) may write a project that is not stored yet, so a tab
      // that missed a delete in another tab cannot bring the project back.
      const summary = { traceCount: (project.traces || []).length };
      let gone = false;
      try {
        await transact(db, ['projects', 'kv'], 'readwrite', (tx) => {
          const projects = tx.objectStore('projects');
          const write = () => {
            projects.put(withoutTraces(project));
            tx.objectStore('kv').put({ key: 'summary:' + project.id, value: summary });
          };
          if (create) {
            write();
            return;
          }
          const req = projects.count(project.id);
          req.onsuccess = () => {
            if (req.result) write();
            else {
              gone = true;
              tx.abort();
            }
          };
        });
      } catch (err) {
        if (gone) throw Object.assign(new Error('This project was deleted in another tab.'), { deleted: true });
        throw err;
      }
      return { ok: true, revision: null };
    },
    async deleteProject(id) {
      await transact(db, ['projects', 'traces', 'kv'], 'readwrite', (tx) => {
        tx.objectStore('projects').delete(id);
        tx.objectStore('traces').delete(id);
        tx.objectStore('kv').delete('summary:' + id);
      });
    },
    async saveTraces(projectId, traces) {
      await transact(db, ['traces'], 'readwrite', (tx) => tx.objectStore('traces').put({ projectId, traces }));
    },
    async pollSuggestions() {
      return null;
    },
    async revision() {
      return null;
    },
    async kvGet(key) {
      const rec = await get('kv', key);
      return rec ? rec.value : undefined;
    },
    async kvSet(key, value) {
      await transact(db, ['kv'], 'readwrite', (tx) =>
        value === undefined ? tx.objectStore('kv').delete(key) : tx.objectStore('kv').put({ key, value }));
    },
  };
}

// Used only when IndexedDB is unavailable: the studio still works, but nothing survives a reload.
function memoryAdapter() {
  const projects = new Map();
  const traces = new Map();
  const kv = new Map();
  return {
    kind: 'browser',
    memory: true,
    async listProjects() {
      return [...projects.values()].map((p) => projectSummary({ ...p, traces: traces.get(p.id) || [] }));
    },
    async loadProject(id) {
      const p = projects.get(id);
      return p ? { ...p, traces: traces.get(id) || [] } : null;
    },
    async saveProject(project) {
      projects.set(project.id, withoutTraces(project));
      return { ok: true, revision: null };
    },
    async deleteProject(id) {
      projects.delete(id);
      traces.delete(id);
    },
    async saveTraces(projectId, list) {
      traces.set(projectId, list);
    },
    async pollSuggestions() {
      return null;
    },
    async revision() {
      return null;
    },
    async kvGet(key) {
      return kv.get(key);
    },
    async kvSet(key, value) {
      if (value === undefined) kv.delete(key);
      else kv.set(key, value);
    },
  };
}

// ---------------------------------------------------------------------------
// Folder mode: the local server owns pmstack/project.json and guards writes with revisions.

function revisionFromEtag(res) {
  const tag = res.headers.get('ETag');
  if (!tag) return null;
  const n = Number(tag.replace(/^W\//, '').replace(/"/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function httpError(res, fallback) {
  let message = fallback;
  try {
    const body = await res.json();
    if (body && body.error) message = body.error;
  } catch {
    // Body was not structured; keep the fallback message.
  }
  return Object.assign(new Error(message), { status: res.status });
}

function localKv(key) {
  try {
    const raw = localStorage.getItem('pmstack-kv:' + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Folder adapter for the `pmstack studio` server. */
export function folderAdapter() {
  const prefix = (info && info.folder ? info.folder : 'folder') + ':';
  // The traces on disk at the last load (by id), so a save sends only the traces added since then.
  let onDisk = null;
  let ownTraceFile = false;
  const remember = (project) => {
    if (!project || !Array.isArray(project.traces)) return;
    onDisk = new Map(project.traces.map((t) => [String(t.id), t]));
    ownTraceFile = !!project.tracesFile;
  };
  return {
    kind: 'folder',
    memory: false,
    async listProjects() {
      return [];
    },
    async loadProject() {
      const res = await fetch('./api/project', { cache: 'no-store' });
      if (res.status === 422) {
        let body = {};
        try { body = await res.json(); } catch { /* keep the default message */ }
        throw Object.assign(new Error(body.error || 'pmstack/project.json could not be read.'), { status: 422, line: body.line ?? null });
      }
      if (!res.ok) throw await httpError(res, 'The project could not be loaded from the folder.');
      const project = await res.json();
      remember(project);
      const revision = revisionFromEtag(res);
      return revision != null && project.revision == null ? { ...project, revision } : project;
    },
    async saveProject(project, { ifMatch } = {}) {
      const body = JSON.stringify(projectForDisk(project));
      const res = await fetch('./api/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${ifMatch ?? 0}"` },
        body,
        // keepalive lets the last save finish while the page closes. Browsers share about 64 KB
        // among keepalive requests still in flight, so use it only then, never for every save.
        keepalive: document.visibilityState === 'hidden' && new Blob([body]).size < 60000,
      });
      if (res.status === 409) {
        const conflict = await res.json();
        remember(conflict.project);
        return { conflict: true, project: conflict.project, revision: conflict.revision ?? conflict.project?.revision ?? null };
      }
      if (!res.ok) throw await httpError(res, 'The folder did not accept the save.');
      // Always read the answer, so the browser can finish the request.
      let done = null;
      try {
        done = await res.json();
      } catch {
        done = null;
      }
      const revision = revisionFromEtag(res) ?? done?.revision ?? done?.project?.revision ?? null;
      return { ok: true, revision };
    },
    async deleteProject() {
      throw new Error('A folder project cannot be deleted from Eval Studio.');
    },
    async saveTraces(projectId, traces) {
      // Traces inside project.json (no trace file) travel with the project save.
      if (!ownTraceFile || !onDisk) return null;
      const fresh = [];
      let retagged = false;
      for (const t of traces) {
        const id = String(t.id);
        if (!onDisk.has(id)) fresh.push(t);
        else if (onDisk.get(id) !== t) retagged = true;
      }
      if (!fresh.length) return null;
      // A first "new version" add also tags the traces already on disk "Version 1".
      // The server does the same when it gets the version name, so send it only then.
      const v = fresh[0].metadata ? fresh[0].metadata.version : null;
      const same = v != null && v !== '' && fresh.every((t) => t.metadata && t.metadata.version === v);
      const body = retagged && same ? { traces: fresh, version: String(v) } : { traces: fresh };
      const res = await fetch('./api/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await httpError(res, 'The folder did not accept the new traces.');
      let done = null;
      try {
        done = await res.json();
      } catch {
        done = null;
      }
      onDisk = new Map(traces.map((t) => [String(t.id), t]));
      const revision = done && done.revision != null ? done.revision : revisionFromEtag(res);
      return { revision, added: done ? done.added : fresh.length };
    },
    async pollSuggestions(sinceMtimeMs = 0) {
      const res = await fetch('./api/suggestions?since=' + encodeURIComponent(sinceMtimeMs || 0), { cache: 'no-store' });
      if (res.status === 204) return null;
      if (!res.ok) throw await httpError(res, 'Suggestions could not be read.');
      return res.json();
    },
    async revision() {
      const res = await fetch('./api/revision', { cache: 'no-store' });
      if (!res.ok) throw await httpError(res, 'The folder did not answer.');
      return res.json();
    },
    async kvGet(key) {
      return localKv(prefix + key);
    },
    async kvSet(key, value) {
      try {
        if (value === undefined) localStorage.removeItem('pmstack-kv:' + prefix + key);
        else localStorage.setItem('pmstack-kv:' + prefix + key, JSON.stringify(value));
      } catch {
        // Local conveniences only; nothing depends on them.
      }
    },
  };
}
