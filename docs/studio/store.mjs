// Eval Studio state (SPEC 5.6). One plain object, replaced on every change.
// Views read it with useStore (ui.mjs) and change the project with updateProject.
// Persistence runs only when state.project changes identity. This file never imports ui.mjs;
// it reports messages for the reader through onNotice, which app.mjs turns into toasts.

import * as lib from './lib/index.mjs';
import { detect, folderInfo, browserAdapter, folderAdapter, isQuotaError, projectSummary } from './storage.mjs';

/** Default Review filters (the shape filterTraces takes). */
export const DEFAULT_FILTERS = Object.freeze({ status: 'all', meta: {}, modeId: null, stage: null, text: '', version: null });

const BACKUP_MESSAGE = 'Your reviews are saved only in this browser. Download a copy to keep them safe.';
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

function readTheme() {
  try {
    const t = localStorage.getItem('pmstack-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

let state = {
  ready: false,
  project: null,
  projects: [],
  activeProjectId: null,
  storageKind: 'browser',
  folder: null,
  saveState: 'saved',
  baseRevision: null,
  dirtyKeys: [],
  route: { tab: 'welcome', param: null },
  ui: { traceId: null, filters: DEFAULT_FILTERS, showHidden: null, helpOpen: false, assistOpen: false, theme: readTheme() },
  // Extras beyond the frozen list, read by the shell and the AI help drawer:
  loadError: null, // folder mode: { message, line } when pmstack/project.json cannot be parsed
  externalChange: false, // browser mode: 'changed' or 'deleted' when another tab saved or deleted this project
  suggestionsPoll: null, // folder mode: { at, error } from the last suggestions check
  memoryOnly: false, // IndexedDB blocked: work lasts until the tab closes
};

const subscribers = new Set();
const noticeSubscribers = new Set();

let adapter = null;
const dirty = new Set();
let saveTimer = 0;
let chain = Promise.resolve();
let inFlight = 0;
let blocked = false; // folder mode: saving paused while pmstack/project.json cannot be read
let otherTab = null; // browser mode: 'changed' or 'deleted' when another tab replaced the open project
let savingKeys = []; // top-level keys in the save that is running now
let storedStamp = null; // updatedAt of the open project's copy known to be in this browser's storage
let lastSaveFailed = false;
let lastSavedStamp = null; // updatedAt of the last project this tab wrote, to tell our own writes from others'
let lastVerdictCount = 0;
let persistAsked = false;
let channel = null;
let lastTracesMtime = null;
let lastErrorMtime = null;
let lastMtime = null; // project.json mtime at the last revision check; null right after this tab saves
let suggestionsMtime = 0;
let pollingRevision = false;
let pollingSuggestions = false;
let sampleIndex = null;

const paused = () => blocked || !!otherTab;

// ---------------------------------------------------------------------------
// Core store

function set(fn, { reason = '', persist = true } = {}) {
  const prev = state;
  const next = typeof fn === 'function' ? fn(prev) : { ...prev, ...fn };
  if (!next || next === prev) return prev;
  state = next;
  const a = prev.project;
  const b = next.project;
  if (persist && a && b && a !== b && a.id === b.id) {
    // Mark the top-level keys that changed identity, then save after a pause.
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) dirty.add(k);
    state = { ...state, dirtyKeys: [...dirty], saveState: paused() ? state.saveState : 'saving' };
    scheduleSave();
  }
  if (next.route !== prev.route) rememberRoute(next.route);
  for (const sub of [...subscribers]) sub(state, prev, reason);
  return state;
}

/** The store: get() the state, set(fn, { reason }) to replace it, subscribe(fn) for changes. */
export const store = {
  get: () => state,
  set,
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};

/** Listen for messages meant for the reader (fn(message, { action, sticky })). Returns an unsubscribe function. */
export function onNotice(fn) {
  noticeSubscribers.add(fn);
  return () => noticeSubscribers.delete(fn);
}

function notice(message, opts = {}) {
  for (const fn of noticeSubscribers) fn(message, opts);
}

/** Change the open project: fn(project) returns the next project. Marks dirty keys and schedules a save. */
export function updateProject(fn, reason = 'edit') {
  const p = state.project;
  if (!p) return p;
  const next = fn(p);
  if (!next || next === p) return p;
  set((s) => ({ ...s, project: next }), { reason });
  return next;
}

/** Merge a patch into state.ui. */
export function setUi(patch) {
  set((s) => ({ ...s, ui: { ...s.ui, ...patch } }), { reason: 'ui', persist: false });
}

// ---------------------------------------------------------------------------
// Routes

/** The hash for a route: hashFor('review', 't-1') is '#/review/t-1'. */
export function hashFor(tab, param = null) {
  if (!tab || tab === 'welcome') return '#/';
  return '#/' + tab + (param != null && param !== '' ? '/' + encodeURIComponent(param) : '');
}

/** Put a parsed route into the state (used by the router in app.mjs). */
export function setRoute(tab, param = null) {
  const t = tab || 'welcome';
  const p = param ?? null;
  set((s) => {
    if (s.route.tab === t && s.route.param === p) return s;
    const ui = t === 'review' && p ? { ...s.ui, traceId: p } : s.ui;
    return { ...s, route: { tab: t, param: p }, ui };
  }, { reason: 'route', persist: false });
}

let leaveGuard = null;

/**
 * While a view holds unsaved input it can guard route changes: guard(tab, param) returns true to keep
 * the reader where they are (the view asks first, then navigates itself). setLeaveGuard(null) removes it.
 */
export function setLeaveGuard(fn) {
  leaveGuard = typeof fn === 'function' ? fn : null;
}

/** True when the leave guard kept the reader on the current route instead of going to tab/param. */
export function leaveBlocked(tab, param = null) {
  if (!leaveGuard) return false;
  const r = state.route;
  if (r.tab === (tab || 'welcome') && r.param === (param ?? null)) return false;
  return leaveGuard(tab || 'welcome', param ?? null) === true;
}

/** Go to a tab. navigate('review', traceId); pass { replace: true } to replace the history entry. */
export function navigate(tab, param = null, { replace = false } = {}) {
  if (leaveBlocked(tab, param)) return;
  const hash = hashFor(tab, param);
  setRoute(tab, param);
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

const PROJECT_TABS = new Set(['setup', 'review', 'modes', 'funnel', 'checks', 'report']);

function rememberRoute(route) {
  if (adapter && PROJECT_TABS.has(route.tab)) adapter.kvSet('lastRoute', route).catch(() => {});
}

// ---------------------------------------------------------------------------
// Saving

function scheduleSave() {
  if (paused()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

/** Save now. Resolves when everything dirty at call time has been written (or has failed). */
export function flush() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  chain = chain.then(saveNow).catch(() => {});
  return chain;
}

function verdictCount(project) {
  let n = 0;
  for (const r of Object.values(project.reviews || {})) if (r && r.verdict) n++;
  return n;
}

function upsertSummary(list, project) {
  const entry = projectSummary(project);
  const i = list.findIndex((p) => p.id === project.id);
  if (i === -1) return [...list, entry];
  const old = list[i];
  if (old.name === entry.name && old.updatedAt === entry.updatedAt && old.traceCount === entry.traceCount && old.reviewed === entry.reviewed && old.sample === entry.sample) return list;
  const next = list.slice();
  next[i] = entry;
  return next;
}

async function saveNow() {
  const project = state.project;
  if (!adapter || !project || !dirty.size || paused()) return;
  const keys = [...dirty];
  dirty.clear();
  savingKeys = keys;
  inFlight++;
  set((s) => ({ ...s, saveState: 'saving', dirtyKeys: [] }), { reason: 'saving', persist: false });
  try {
    if (keys.includes('traces')) {
      let done = null;
      try {
        done = await adapter.saveTraces(project.id, project.traces || []);
      } catch (err) {
        // The folder refused the traces (for example a .csv trace file): say why, keep saving the rest.
        if (state.storageKind !== 'folder' || err.status == null) throw err;
        notice('The new traces could not be added to the trace file. ' + err.message, { sticky: true });
      }
      if (done && done.revision != null) {
        // Our own write moved the trace file and the revision: save the rest on top of it, no reload.
        lastTracesMtime = null;
        set((s) => ({ ...s, baseRevision: done.revision }), { reason: 'saved', persist: false });
      }
    }
    const res = await adapter.saveProject(project, { ifMatch: state.baseRevision });
    if (res && res.conflict) {
      mergeDisk(res.project, { extraDirty: keys, revision: res.revision });
      return;
    }
    lastSaveFailed = false;
    lastSavedStamp = project.updatedAt;
    storedStamp = project.updatedAt;
    savingKeys = [];
    if (state.storageKind === 'browser') dropJournal(project.id, project.updatedAt);
    lastMtime = null; // our own write moved the mtime; the next check records it without reloading
    const known = res && res.revision != null;
    const revision = known ? res.revision : state.storageKind === 'folder' ? (state.baseRevision ?? 0) + 1 : state.baseRevision;
    set((s) => ({
      ...s,
      baseRevision: revision,
      saveState: paused() ? 'readonly' : dirty.size ? 'saving' : 'saved',
      dirtyKeys: [...dirty],
      projects: upsertSummary(s.projects, project),
    }), { reason: 'saved', persist: false });
    afterBrowserSave(project);
  } catch (err) {
    for (const k of keys) dirty.add(k);
    if (err && err.deleted) {
      stopForOtherTab('deleted');
      return;
    }
    set((s) => ({ ...s, saveState: 'error', dirtyKeys: [...dirty] }), { reason: 'save-error', persist: false });
    if (!lastSaveFailed) {
      if (isQuotaError(err)) notice('Could not save in this browser. Download the project to keep your work.', { action: 'download-project', sticky: true });
      else if (state.storageKind === 'folder') notice('Could not save to the folder: ' + err.message);
      else notice('Could not save in this browser. Download the project to keep your work.', { action: 'download-project' });
    }
    lastSaveFailed = true;
  } finally {
    savingKeys = [];
    inFlight--;
  }
}

// Tell other tabs in this browser that a project changed: { projectId, updatedAt }, plus
// replaced (an import or a reset put a new copy in its place) or deleted.
function announce(msg) {
  if (state.storageKind !== 'browser') return;
  try {
    if (channel) channel.postMessage(msg);
  } catch {
    // Another tab simply will not hear about this change.
  }
}

function afterBrowserSave(project) {
  if (state.storageKind !== 'browser') return;
  announce({ projectId: project.id, updatedAt: project.updatedAt });
  const count = verdictCount(project);
  const added = count - lastVerdictCount;
  lastVerdictCount = count;
  if (added > 0) {
    askPersist();
    countTowardBackup(added);
  }
}

async function countTowardBackup(added) {
  try {
    const n = ((await adapter.kvGet('reviewsSinceBackup')) || 0) + added;
    if (n >= 25) {
      await adapter.kvSet('reviewsSinceBackup', 0);
      notice(BACKUP_MESSAGE, { action: 'download-project' });
    } else {
      await adapter.kvSet('reviewsSinceBackup', n);
    }
  } catch {
    // The reminder is a convenience; saving already happened.
  }
}

/** Record that the reader just downloaded the project, so backup reminders start counting again. */
export function noteBackup() {
  if (adapter) adapter.kvSet('reviewsSinceBackup', 0).catch(() => {});
}

async function askPersist() {
  if (persistAsked || state.storageKind !== 'browser') return;
  persistAsked = true;
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Persistent storage is a request, not a promise.
  }
}

// ---------------------------------------------------------------------------
// Browser mode: a small journal for the last changes before the tab closes.
// A save started while the page unloads may never finish, so on pagehide (and when the tab is hidden)
// the changed top-level keys are also written to localStorage at once. The next open puts them back.

const JOURNAL = 'pmstack-journal:';

function dropJournal(id, savedStamp = null) {
  try {
    if (savedStamp != null) {
      const raw = localStorage.getItem(JOURNAL + id);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (j && String(j.updatedAt || '') > String(savedStamp || '')) return; // newer than what was saved
    }
    localStorage.removeItem(JOURNAL + id);
  } catch {
    // Nothing to clean up.
  }
}

/** Write the unsaved keys of the open project. Returns false when they could not all be kept. */
function writeJournal() {
  const p = state.project;
  if (!p || !adapter || state.storageKind !== 'browser' || adapter.memory || paused()) return true;
  const keys = new Set([...dirty, ...savingKeys]);
  if (!keys.size) return true;
  const complete = !keys.has('traces'); // traces are too large for the journal
  keys.delete('traces');
  keys.delete('id');
  const values = {};
  const removed = [];
  for (const k of keys) {
    if (k in p) values[k] = p[k];
    else removed.push(k);
  }
  try {
    localStorage.setItem(JOURNAL + p.id, JSON.stringify({ base: storedStamp, updatedAt: p.updatedAt || null, values, removed }));
    return complete;
  } catch {
    return false;
  }
}

// Put back what a closed tab had not finished saving. Returns { project, keys } with the keys to save again.
function applyJournal(project) {
  if (!project || !adapter || adapter.memory) return { project, keys: [] };
  let j = null;
  try {
    j = JSON.parse(localStorage.getItem(JOURNAL + project.id) || 'null');
  } catch {
    j = null;
  }
  if (!j) return { project, keys: [] };
  const stored = String(project.updatedAt || '');
  const unsaved = j.values && typeof j.values === 'object' && (stored === String(j.base || '') || String(j.updatedAt || '') > stored);
  if (!unsaved) {
    // Saved after all, or another tab has written a newer copy since.
    dropJournal(project.id);
    return { project, keys: [] };
  }
  const next = { ...project, ...j.values, id: project.id, traces: project.traces };
  const removed = Array.isArray(j.removed) ? j.removed.filter((k) => k !== 'id' && k !== 'traces') : [];
  for (const k of removed) delete next[k];
  return { project: next, keys: [...Object.keys(j.values).filter((k) => k !== 'id' && k !== 'traces'), ...removed] };
}

function beforeLeaving() {
  writeJournal();
  flush();
}

// ---------------------------------------------------------------------------
// Folder mode: merge changes other writers made to pmstack/project.json

function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Keep traces and experience identity when their content did not change, so memoized engine work stays warm.
function keepIdentity(local, merged, disk, tracesChanged) {
  let out = merged;
  const diskTraces = Array.isArray(disk.traces) && disk.traces.length ? disk.traces : null;
  const tracesSame = !tracesChanged && (!diskTraces || diskTraces.length === (local.traces || []).length);
  if (tracesSame && out.traces !== local.traces) out = { ...out, traces: local.traces };
  if (out.experience !== local.experience && sameJson(out.experience, local.experience)) out = { ...out, experience: local.experience };
  return out;
}

function mergeDisk(disk, { extraDirty = [], tracesChanged = false, revision = null } = {}) {
  const local = state.project;
  for (const k of extraDirty) dirty.add(k);
  let merged = disk;
  if (local) merged = keepIdentity(local, lib.mergeExternal(local, disk, [...dirty]), disk, tracesChanged);
  const changed = !local || (local.updatedAt !== disk.updatedAt && disk.updatedAt !== lastSavedStamp);
  set((s) => ({
    ...s,
    project: merged,
    activeProjectId: merged.id,
    baseRevision: disk.revision ?? revision ?? s.baseRevision,
    dirtyKeys: [...dirty],
    saveState: dirty.size ? 'saving' : 'saved',
    projects: upsertSummary(s.projects, merged),
  }), { reason: 'disk', persist: false });
  if (local && changed) notice('Updated from disk.');
  if (dirty.size) flush();
}

async function loadFolderProject() {
  try {
    const project = await adapter.loadProject();
    if (state.loadError) {
      blocked = false;
      set((s) => ({ ...s, loadError: null, saveState: dirty.size ? 'saving' : 'saved' }), { reason: 'disk', persist: false });
    }
    return project;
  } catch (err) {
    if (err.status !== 422) throw err;
    blocked = true;
    clearTimeout(saveTimer);
    set((s) => ({ ...s, loadError: { message: err.message, line: err.line ?? null }, saveState: 'readonly' }), { reason: 'disk', persist: false });
    return null;
  }
}

async function pollRevision() {
  if (pollingRevision || inFlight || document.visibilityState !== 'visible') return;
  pollingRevision = true;
  try {
    const r = await adapter.revision();
    if (!r) return;
    const tracesChanged = lastTracesMtime != null && r.tracesMtimeMs !== lastTracesMtime;
    if (lastTracesMtime == null) lastTracesMtime = r.tracesMtimeMs ?? null;
    // A file edited without a revision bump (a hand edit, or a broken write) still needs a look.
    const touched = lastMtime != null && r.mtimeMs !== lastMtime;
    lastMtime = r.mtimeMs;
    const broken = !!state.loadError;
    const newer = !broken && (state.baseRevision == null || r.revision > state.baseRevision || tracesChanged || touched);
    const fixedMaybe = broken && r.mtimeMs !== lastErrorMtime;
    if (!newer && !fixedMaybe) return;
    const disk = await loadFolderProject();
    if (!disk) {
      lastErrorMtime = r.mtimeMs;
      return;
    }
    lastTracesMtime = r.tracesMtimeMs ?? null;
    mergeDisk(disk, { tracesChanged, revision: r.revision ?? null });
  } catch {
    // The server may have stopped. The next save shows "Could not save" if so.
  } finally {
    pollingRevision = false;
  }
}

async function pollSuggestions() {
  if (pollingSuggestions || blocked || !state.project || document.visibilityState !== 'visible') return;
  pollingSuggestions = true;
  try {
    const r = await adapter.pollSuggestions(suggestionsMtime);
    if (r) {
      if (r.mtimeMs) suggestionsMtime = r.mtimeMs;
      if (Array.isArray(r.suggestions) && r.suggestions.length) {
        updateProject((p) => lib.mergeSuggestions(p, r.suggestions), 'suggestions');
      }
    }
    const error = r && r.error ? r.error : null;
    set((s) => ({ ...s, suggestionsPoll: { at: new Date().toISOString(), error } }), { reason: 'poll', persist: false });
  } catch (err) {
    set((s) => ({ ...s, suggestionsPoll: { at: new Date().toISOString(), error: err.message } }), { reason: 'poll', persist: false });
  } finally {
    pollingSuggestions = false;
  }
}

// ---------------------------------------------------------------------------
// Browser mode: another tab saved the same project

// Stop saving the open project: another tab changed, replaced, or deleted it.
function stopForOtherTab(why) {
  if (otherTab === 'deleted' || otherTab === why) return;
  otherTab = why;
  clearTimeout(saveTimer);
  set((s) => ({ ...s, externalChange: why, saveState: 'readonly' }), { reason: 'other-tab', persist: false });
  const message = why === 'deleted' ? 'This project was deleted in another tab.' : 'This project changed in another tab.';
  notice(message, { action: 'reload', sticky: true, key: 'other-tab' });
}

function listenToOtherTabs() {
  if (typeof BroadcastChannel !== 'function') return;
  channel = new BroadcastChannel('pmstack');
  channel.onmessage = (e) => {
    const msg = e.data || {};
    if (!msg.projectId) return;
    if (msg.deleted || msg.replaced) {
      // Keep the project switcher and Set up in step with the other tab.
      adapter.listProjects().then((projects) => set((s) => ({ ...s, projects }), { reason: 'other-tab', persist: false })).catch(() => {});
    }
    const p = state.project;
    if (blocked || !p || msg.projectId !== p.id) return;
    if (!msg.deleted && !msg.replaced && msg.updatedAt === p.updatedAt) return;
    stopForOtherTab(msg.deleted ? 'deleted' : 'changed');
  };
}

async function remindAfterAbsence() {
  try {
    const last = await adapter.kvGet('lastOpenedAt');
    const now = Date.now();
    await adapter.kvSet('lastOpenedAt', now);
    if (last && now - last >= THREE_DAYS && state.project && verdictCount(state.project) > 0) {
      notice(BACKUP_MESSAGE, { action: 'download-project' });
    }
  } catch {
    // Reminder only.
  }
}

// ---------------------------------------------------------------------------
// Boot and projects

// Open a project just loaded from storage or just created. A copy from storage is current, so a
// stop from another tab no longer applies.
function activate(loaded) {
  dirty.clear();
  clearTimeout(saveTimer);
  storedStamp = loaded.updatedAt ?? null;
  const { project, keys } = state.storageKind === 'browser' ? applyJournal(loaded) : { project: loaded, keys: [] };
  if (otherTab) {
    otherTab = null;
    notice(null, { clear: 'other-tab' });
  }
  lastVerdictCount = verdictCount(loaded);
  for (const k of keys) dirty.add(k);
  set((s) => ({
    ...s,
    project,
    activeProjectId: project.id,
    baseRevision: project.revision ?? null,
    dirtyKeys: [...dirty],
    saveState: blocked ? 'readonly' : dirty.size ? 'saving' : 'saved',
    externalChange: false,
    projects: upsertSummary(s.projects, project),
    ui: { ...s.ui, traceId: null, filters: DEFAULT_FILTERS },
  }), { reason: 'open', persist: false });
  adapter.kvSet('activeProjectId', project.id).catch(() => {});
  if (dirty.size) flush();
}

/** Start the store: pick the storage mode, load the project list and the last open project. Returns { lastRoute }. */
export async function init() {
  const kind = await detect();
  adapter = kind === 'folder' ? folderAdapter() : await browserAdapter();
  set((s) => ({ ...s, storageKind: kind, folder: folderInfo(), memoryOnly: !!adapter.memory }), { reason: 'init', persist: false });

  if (kind === 'folder') {
    let startRevision = null;
    try {
      const r = await adapter.revision();
      lastTracesMtime = r ? r.tracesMtimeMs ?? null : null;
      startRevision = r ? r.revision ?? null : null;
    } catch {
      lastTracesMtime = null;
    }
    try {
      const project = await loadFolderProject();
      if (project) activate(project.revision == null && startRevision != null ? { ...project, revision: startRevision } : project);
    } catch (err) {
      notice('The folder project could not be loaded: ' + err.message);
    }
    setInterval(pollRevision, 2000);
    setInterval(pollSuggestions, 3000);
    pollSuggestions();
  } else {
    const projects = await adapter.listProjects().catch(() => []);
    set((s) => ({ ...s, projects }), { reason: 'init', persist: false });
    const activeId = await adapter.kvGet('activeProjectId').catch(() => null);
    if (activeId && projects.some((p) => p.id === activeId)) {
      const project = await adapter.loadProject(activeId).catch(() => null);
      if (project) activate(project);
    }
    listenToOtherTabs();
    remindAfterAbsence();
    if (adapter.memory) notice('This browser is not letting Eval Studio save. Your work lasts until you close this tab, so download the project before you go.', { sticky: true });
  }

  const lastRoute = await adapter.kvGet('lastRoute').catch(() => null);
  addEventListener('pagehide', beforeLeaving);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beforeLeaving();
  });
  addEventListener('beforeunload', (e) => {
    // Ask before closing only when the unsaved changes could not be kept in the journal.
    if (state.storageKind !== 'browser' || paused() || (!dirty.size && !savingKeys.length)) return;
    if (writeJournal()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  set((s) => ({ ...s, ready: true }), { reason: 'ready', persist: false });
  return { lastRoute: lastRoute || null };
}

/** Open a project from this browser by id (folder mode has one project). */
export async function openProject(id) {
  if (state.project && state.project.id === id) return state.project;
  if (state.storageKind === 'folder') return state.project;
  await flush();
  const project = await adapter.loadProject(id);
  if (!project) throw new Error('That project is no longer saved in this browser.');
  activate(project);
  return project;
}

/** A project with its traces, without opening it: the open project, or the saved copy (null when none). */
export async function loadProjectCopy(id) {
  if (state.project && state.project.id === id) return state.project;
  if (!adapter || state.storageKind === 'folder') return null;
  return adapter.loadProject(id);
}

/** The list of sample products (samples/index.json), or [] when it cannot load. */
export function getSampleIndex() {
  if (!sampleIndex) {
    sampleIndex = fetch('samples/index.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => (Array.isArray(list) ? list : []))
      .catch(() => [])
      .then((list) => {
        if (!list.length) sampleIndex = null; // try again next time
        return list;
      });
  }
  return sampleIndex;
}

async function fetchSample(id) {
  const name = String(id ?? '');
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(name)) throw new Error(`There is no sample called "${name}".`);
  const index = await getSampleIndex();
  if (index.length && !index.some((s) => s.id === name)) throw new Error(`There is no sample called "${name}".`);
  let res;
  try {
    res = await fetch(`samples/${name}.json`, { cache: 'no-cache' });
  } catch {
    throw new Error('The sample could not be downloaded. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(`The sample "${name}" is not available right now.`);
  let project;
  try {
    project = await res.json();
  } catch {
    throw new Error(`The sample "${name}" could not be read.`);
  }
  return { ...project, id: name, sample: true, tracesFile: null };
}

async function saveWhole(project) {
  await adapter.saveTraces(project.id, project.traces || []);
  await adapter.saveProject(project, { ifMatch: null, create: true });
}

/** Open a sample product, creating this browser's working copy on first open. */
export async function openSample(sampleId) {
  if (state.storageKind === 'folder') throw new Error('Samples open in the web version of Eval Studio.');
  if (state.project && state.project.id === sampleId) return state.project;
  await flush();
  let project = await adapter.loadProject(sampleId).catch(() => null);
  if (!project) {
    project = await fetchSample(sampleId);
    await saveWhole(project);
  }
  activate(project);
  return project;
}

/** Put a sample back to how it shipped. */
export async function resetSample(id) {
  if (state.storageKind === 'folder') throw new Error('Samples open in the web version of Eval Studio.');
  const fresh = await fetchSample(id);
  if (state.activeProjectId === id) {
    dirty.clear();
    clearTimeout(saveTimer);
  }
  await chain;
  await saveWhole(fresh);
  dropJournal(id);
  announce({ projectId: id, updatedAt: fresh.updatedAt, replaced: true });
  if (state.activeProjectId === id) activate(fresh);
  else set((s) => ({ ...s, projects: upsertSummary(s.projects, fresh) }), { reason: 'reset', persist: false });
  return fresh;
}

/** Remove a project from this browser. */
export async function deleteProject(id) {
  if (state.storageKind === 'folder') throw new Error('A folder project cannot be deleted from Eval Studio.');
  const wasActive = state.activeProjectId === id;
  if (wasActive) {
    dirty.clear();
    clearTimeout(saveTimer);
  }
  await chain;
  await adapter.deleteProject(id);
  dropJournal(id);
  announce({ projectId: id, deleted: true });
  set((s) => ({
    ...s,
    projects: s.projects.filter((p) => p.id !== id),
    ...(wasActive ? { project: null, activeProjectId: null, dirtyKeys: [], saveState: 'saved' } : {}),
  }), { reason: 'delete', persist: false });
  if (wasActive) adapter.kvSet('activeProjectId', undefined).catch(() => {});
}

function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return s || 'project';
}

function uniqueId(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Create a browser project from the Set up wizard and open it. */
export async function createProjectFrom({ name, experience, traces = [] }) {
  if (state.storageKind === 'folder') throw new Error('This studio works on one folder. Change its setup with updateProject instead.');
  await flush();
  const id = uniqueId(slugify(name), state.projects.map((p) => p.id));
  const project = lib.createProject({ id, name, experience, traces });
  await saveWhole(project);
  activate(project);
  askPersist();
  return project;
}

/**
 * Import a downloaded project file. onClash(project) resolves to 'replace', 'keep' (keep both), or null (cancel).
 * Returns { ok, errors, id }.
 */
export async function importProjectFile(text, { onClash } = {}) {
  if (state.storageKind === 'folder') {
    return { ok: false, errors: ['This studio is working on a folder. Open the web version of Eval Studio to import a project file.'] };
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This file could not be read as a project file.'] };
  }
  if (!obj || typeof obj !== 'object' || obj.format !== lib.FORMAT) {
    return { ok: false, errors: ['This is not an Eval Studio project file. Project files come from "Download project".'] };
  }
  if (obj.tracesFile && !(Array.isArray(obj.traces) && obj.traces.length)) {
    return { ok: false, errors: ['This project keeps its traces in a separate file. Download it again from Eval Studio, which puts the traces inside.'] };
  }
  const check = lib.validateProject(obj, { tracesLoaded: true });
  if (!check.ok) return { ok: false, errors: check.errors };

  let project = { ...obj, tracesFile: null };
  if (state.projects.some((p) => p.id === project.id)) {
    const choice = onClash ? await onClash(project) : 'keep';
    if (choice === 'keep') {
      project = { ...project, id: uniqueId(project.id, state.projects.map((p) => p.id)), name: `${project.name} (copy)` };
    } else if (choice !== 'replace') {
      return { ok: false, errors: [], canceled: true };
    }
  }
  await flush();
  await saveWhole(project);
  dropJournal(project.id);
  announce({ projectId: project.id, updatedAt: project.updatedAt, replaced: true });
  activate(project);
  askPersist();
  return { ok: true, errors: [], id: project.id };
}

/** The project as a downloadable file: { filename, text } with traces inlined. */
export function projectFile(project = state.project) {
  return {
    filename: `${project.id}-project.json`,
    text: JSON.stringify(lib.projectForDownload(project), null, 2),
  };
}
