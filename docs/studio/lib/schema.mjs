// schema.mjs: the pmstack.project/1 file format. Create, validate, slug ids,
// copies for disk and download, and the merge used when another tool (the
// CLI or an agent) changed the project file while Eval Studio had it open.

import { defaultExperience, RESERVED_STAGE_IDS } from './experience.mjs';
import { validatePolicy, validateIntents, policyRules } from './toolcalls.mjs';

/** The project file format id. */
export const FORMAT = 'pmstack.project/1';

const VERDICTS = new Set(['pass', 'fail', 'skip', null]);
const MODE_KINDS = new Set(['failure', 'success', 'ignore']);
const CHECK_TYPES = new Set(['code', 'judge', 'policy', 'relevance']);
const MODE_TEMPLATES = new Set(['policy', 'relevance', 'grounding']);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** A new, empty project. */
export function createProject({ id, name = '', experience = null, traces = [], now } = {}) {
  const t = now || new Date().toISOString();
  const exp = experience || defaultExperience({ product: name });
  return {
    format: FORMAT,
    revision: 1,
    id: id || slugId('', name || exp.product || 'project', []),
    name: name || exp.product || 'Untitled project',
    sample: false,
    createdAt: t,
    updatedAt: t,
    experience: exp,
    tracesFile: null,
    traces,
    reviews: {},
    labels: {},
    critiques: {},
    closeCalls: {},
    modes: [],
    checks: [],
    splits: {},
    suggestions: [],
    batch: null,
    settings: { seed: 7 },
  };
}

/** A readable id: prefix + slug of the name, made unique against existingIds with -2, -3. */
export function slugId(prefix, name, existingIds = []) {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '') || 'untitled';
  const base = prefix ? `${prefix}-${slug}` : slug;
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(`${base}-${k}`)) k++;
  return `${base}-${k}`;
}

/** Validate a project object; errors are plain sentences. */
export function validateProject(obj, { tracesLoaded = true } = {}) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['This file is not a pmstack project.'] };
  if (obj.format !== FORMAT) errors.push(`This file is not a pmstack project (format "${obj.format ?? 'missing'}"; expected "${FORMAT}").`);
  if (!obj.id || typeof obj.id !== 'string') errors.push('The project has no id.');

  const exp = obj.experience;
  const stageIds = new Set();
  if (!isObj(exp)) errors.push('The project has no product setup.');
  else {
    if (exp.showHiddenDefault != null && typeof exp.showHiddenDefault !== 'boolean') errors.push('The product setup\'s default for "Show behind-the-scenes steps" (showHiddenDefault) must be true or false.');
    if (exp.filters != null && !Array.isArray(exp.filters)) errors.push('The product setup\'s filters are not a list.');
    const stages = Array.isArray(exp.stages) ? exp.stages : [];
    if (!Array.isArray(exp.stages)) errors.push('The product setup has no list of stages.');
    for (const s of stages) {
      if (!isObj(s) || !s.id) { errors.push('A stage has no id.'); continue; }
      if (RESERVED_STAGE_IDS.includes(s.id)) errors.push(`Stage id "${s.id}" is reserved. Pick another id.`);
      if (stageIds.has(s.id)) errors.push(`Stage id "${s.id}" is used twice.`);
      stageIds.add(s.id);
      const pattern = s.match?.namePattern;
      if (pattern != null && pattern !== '') {
        try { new RegExp(pattern, 'i'); } catch { errors.push(`Stage "${s.label || s.id}": the name pattern "${pattern}" is not valid, so it is skipped.`); }
      }
    }
  }
  const stageOk = (id) => id == null || id === 'unknown' || stageIds.has(id);

  let traceIds = null;
  if (Array.isArray(obj.traces)) {
    traceIds = new Set(obj.traces.map((t) => String(t?.id)));
    if (obj.traces.some((t) => !isObj(t) || t.id == null || t.id === '')) errors.push('Some traces have no id.');
  } else if (tracesLoaded || !obj.tracesFile) errors.push('The project has no traces list.');
  const checkTraces = tracesLoaded && traceIds;

  const modes = Array.isArray(obj.modes) ? obj.modes : [];
  if (obj.modes != null && !Array.isArray(obj.modes)) errors.push('The failure modes are not a list.');
  const modeById = new Map();
  for (const m of modes) {
    if (!isObj(m) || !m.id) { errors.push('A failure mode has no id.'); continue; }
    if (modeById.has(m.id)) errors.push(`Failure mode id "${m.id}" is used twice.`);
    modeById.set(m.id, m);
    if (!MODE_KINDS.has(m.kind)) errors.push(`Mode "${m.name || m.id}" has an unknown kind "${m.kind}".`);
    if (!stageOk(m.stage)) errors.push(`Mode "${m.name || m.id}" uses stage "${m.stage}", which does not exist.`);
    if (m.template != null && !MODE_TEMPLATES.has(m.template)) errors.push(`Mode "${m.name || m.id}" has an unknown template "${m.template}". Use policy, relevance, grounding, or none.`);
  }

  // Views read these as a list or as entries by id, so any other shape leaves them blank.
  if (obj.reviews != null && !isObj(obj.reviews)) errors.push('The reviews are not stored by trace id.');
  if (obj.labels != null && !isObj(obj.labels)) errors.push('The labels are not stored by failure mode.');
  if (obj.splits != null && !isObj(obj.splits)) errors.push('The splits are not stored by failure mode.');
  if (obj.checks != null && !Array.isArray(obj.checks)) errors.push('The checks are not a list.');

  for (const [tid, r] of Object.entries(isObj(obj.reviews) ? obj.reviews : {})) {
    if (checkTraces && !traceIds.has(tid)) errors.push(`Review for "${tid}" points to a trace that does not exist.`);
    if (!isObj(r)) { errors.push(`Review for "${tid}" is not an object.`); continue; }
    if (!VERDICTS.has(r.verdict ?? null)) errors.push(`Review for "${tid}" has an unknown verdict "${r.verdict}".`);
    if (!stageOk(r.stage)) errors.push(`Review for "${tid}" uses stage "${r.stage}", which does not exist.`);
    for (const id of [...(r.modes || []), ...(r.successModes || [])]) {
      if (!modeById.has(id)) errors.push(`Review for "${tid}" uses mode "${id}", which does not exist.`);
    }
  }

  for (const [mid, map] of Object.entries(isObj(obj.labels) ? obj.labels : {})) {
    const m = modeById.get(mid);
    if (!m) errors.push(`Labels for "${mid}" point to a failure mode that does not exist.`);
    else if (m.kind !== 'failure') errors.push(`Labels for "${m.name || mid}" are on a mode that is not a failure mode.`);
    for (const [tid, v] of Object.entries(isObj(map) ? map : {})) {
      if (v !== 'pass' && v !== 'fail') errors.push(`Label for "${tid}" on "${mid}" must be pass or fail.`);
      if (checkTraces && !traceIds.has(tid)) errors.push(`Label for "${tid}" points to a trace that does not exist.`);
    }
  }

  for (const c of Array.isArray(obj.checks) ? obj.checks : []) {
    if (!isObj(c) || !c.id) { errors.push('A check has no id.'); continue; }
    const m = modeById.get(c.modeId);
    if (!m) errors.push(`Check "${c.name || c.id}" points to a failure mode that does not exist.`);
    else if (m.kind !== 'failure') errors.push(`Check "${c.name || c.id}" points to a mode that is not a failure mode.`);
    const label = `Check "${c.name || c.id}"`;
    if (!CHECK_TYPES.has(c.type)) errors.push(`${label} has an unknown type "${c.type}".`);
    if (c.type === 'policy' && c.policy != null) {
      for (const e of validatePolicy(c.policy).errors) errors.push(`${label}: ${e}`);
      if (c.ruleIds != null && !(Array.isArray(c.ruleIds) && c.ruleIds.every((r) => typeof r === 'string'))) errors.push(`${label}: ruleIds must be a list of rule ids.`);
      else if (Array.isArray(c.ruleIds) && c.ruleIds.length) {
        const known = new Set(policyRules(c.policy).map((r) => r.id));
        for (const r of c.ruleIds) if (!known.has(r)) errors.push(`${label} lists rule "${r}", which its policy does not have.`);
      }
    }
    if (c.type === 'relevance' && c.intents != null) {
      for (const e of validateIntents(c.intents).errors) errors.push(`${label}: ${e}`);
    }
  }

  for (const mid of Object.keys(isObj(obj.splits) ? obj.splits : {})) {
    if (!modeById.has(mid)) errors.push(`Splits for "${mid}" point to a failure mode that does not exist.`);
  }
  if (obj.suggestions != null && !Array.isArray(obj.suggestions)) errors.push('The suggestions are not a list.');
  return { ok: errors.length === 0, errors };
}

/** Deep copy (import, export, and tests only; mutators use structural sharing). */
export function cloneProject(p) {
  return typeof structuredClone === 'function' ? structuredClone(p) : JSON.parse(JSON.stringify(p));
}

/** The project as written to disk: traces are dropped when tracesFile is set. */
export function projectForDisk(p) {
  if (!p?.tracesFile) return p;
  const { traces: _drop, ...rest } = p;
  return rest;
}

/** The project as downloaded: traces inline and tracesFile null. */
export function projectForDownload(p) {
  return { ...p, tracesFile: null, traces: p.traces || [] };
}

// Splits merged per failure mode. A final test revealed on disk (pmstack judge --final) stays
// revealed: the disk entry is kept, and traces only the local copy assigned join the tuning set,
// because after a reveal new labels join tuning only. Disk-only entries are kept while their
// mode still exists.
function mergeSplits(local, disk, modes) {
  const loc = isObj(local) ? local : {};
  const dsk = isObj(disk) ? disk : {};
  const known = new Set((Array.isArray(modes) ? modes : []).map((m) => m?.id));
  const out = {};
  for (const [modeId, d] of Object.entries(dsk)) if (!(modeId in loc) && known.has(modeId)) out[modeId] = d;
  for (const [modeId, l] of Object.entries(loc)) {
    const d = dsk[modeId];
    if (!(isObj(d) && d.revealedAt)) { out[modeId] = l; continue; }
    const assign = { ...(isObj(d.assign) ? d.assign : {}) };
    const after = Array.isArray(d.afterReveal) ? d.afterReveal.slice() : [];
    for (const id of Object.keys(isObj(l?.assign) ? l.assign : {})) {
      if (id in assign) continue;
      assign[id] = 'tuning';
      if (!after.includes(id)) after.push(id);
    }
    out[modeId] = after.length ? { ...d, assign, afterReveal: after } : { ...d, assign };
  }
  return out;
}

/**
 * Merge a newer disk copy with local edits: start from disk, take local for each dirty
 * top-level key, merge checks per id (results, unreadable, runs, test come from disk), and
 * merge splits per failure mode (a final test revealed on disk stays revealed).
 */
export function mergeExternal(local, disk, dirtyKeys = []) {
  const dirty = new Set(dirtyKeys instanceof Set ? [...dirtyKeys] : dirtyKeys);
  const out = { ...disk };
  for (const key of dirty) {
    if (key === 'checks' || key === 'splits' || key === 'revision' || key === 'traces') continue;
    if (key in local) out[key] = local[key];
  }
  if (dirty.has('splits')) out.splits = mergeSplits(local.splits, disk.splits, out.modes);
  if (dirty.has('checks')) {
    const diskChecks = Array.isArray(disk.checks) ? disk.checks : [];
    const diskById = new Map(diskChecks.map((c) => [c.id, c]));
    const localChecks = Array.isArray(local.checks) ? local.checks : [];
    const localIds = new Set(localChecks.map((c) => c.id));
    const merged = localChecks.map((c) => {
      const d = diskById.get(c.id);
      return d ? { ...c, results: d.results, unreadable: d.unreadable, runs: d.runs, test: d.test } : c;
    });
    for (const d of diskChecks) if (!localIds.has(d.id)) merged.push(d);
    out.checks = merged;
  }
  // Disk copies written with tracesFile carry no traces; keep the ones already loaded.
  out.traces = dirty.has('traces') || !Array.isArray(disk.traces) ? local.traces : disk.traces;
  out.revision = disk.revision;
  return out;
}
