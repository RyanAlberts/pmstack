// funnel.mjs: the funnel of an AI experience. Each failing trace is counted
// once, at the first stage that went wrong; the band shows how many traces are
// still on track at each stage; Good outcome is the number of Good traces.

import { modeMap, failStage, orderedReviews, reviewKind } from './review.mjs';
import { normalizeAll } from './traces.mjs';

const EMPTY = Object.freeze([]);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Compute the funnel. Counted = Good reviews + Problem reviews not made only of
 * "Not a product problem" modes; shares use counted as the denominator.
 */
export function computeFunnel(project, { version = null } = {}) {
  const exp = project?.experience || {};
  const stageList = Array.isArray(exp.stages) ? exp.stages : EMPTY;
  const at = new Map(stageList.map((s, i) => [s.id, i]));
  const mm = modeMap(project);
  const norm = normalizeAll(project);

  let passed = 0, failed = 0, ignored = 0;
  const ignoredIds = [];
  const counted = [];
  for (const { traceId, review } of orderedReviews(project)) {
    if (version != null) {
      const n = norm.get(traceId);
      if (!n || String(n.metadata.version ?? '') !== String(version)) continue;
    }
    const kind = reviewKind(project, review);
    if (kind === 'ignored') { ignored++; ignoredIds.push(traceId); continue; }
    if (kind === 'pass') passed++;
    else if (kind === 'fail') failed++;
    else continue;
    counted.push({ traceId, review, kind, where: kind === 'fail' ? failStage(project, review) : null });
  }

  const stages = stageList.map((s, i) => ({
    id: s.id, label: s.label, number: i + 1, column: s.column ?? null,
    onTrack: 0, reached: 0, failedHere: 0, failedIds: [],
    failureModes: [], successModes: [], checks: [],
  }));
  const unknown = { count: 0, modes: [], traceIds: [] };
  const unknownModes = new Map();
  const modeTotal = new Map(); // failure mode -> counted Problem traces carrying it
  const firstAt = new Map(); // failure mode -> Map(stageId -> traceIds)
  const successCount = new Map();

  for (const c of counted) {
    const r = c.review;
    if (c.kind === 'fail') {
      const fm = (r.modes || EMPTY).filter((id) => mm.get(id)?.kind === 'failure');
      if (c.where === 'unknown') {
        unknown.count++; unknown.traceIds.push(c.traceId);
        for (const id of fm) unknownModes.set(id, (unknownModes.get(id) || 0) + 1);
      } else {
        const s = stages[at.get(c.where)];
        s.failedHere++; s.failedIds.push(c.traceId);
      }
      for (const id of fm) {
        modeTotal.set(id, (modeTotal.get(id) || 0) + 1);
        if (c.where === 'unknown') continue;
        if (!firstAt.has(id)) firstAt.set(id, new Map());
        const byStage = firstAt.get(id);
        if (!byStage.has(c.where)) byStage.set(c.where, []);
        byStage.get(c.where).push(c.traceId);
      }
    }
    for (const id of r.successModes || EMPTY) {
      if (mm.get(id)?.kind === 'success') successCount.set(id, (successCount.get(id) || 0) + 1);
    }
  }

  // Stages each counted trace reached (a normalized step placed in the stage).
  if (stages.length) {
    for (const c of counted) {
      const n = norm.get(c.traceId);
      if (!n) continue;
      const seen = new Set();
      for (const step of n.steps) if (step.stage != null && at.has(step.stage)) seen.add(step.stage);
      for (const id of seen) stages[at.get(id)].reached++;
    }
  }

  // The band: everyone who did not fail at an unknown stage starts on track.
  const sumHere = stages.reduce((a, s) => a + s.failedHere, 0);
  stages.forEach((s, i) => { s.onTrack = i === 0 ? passed + sumHere : stages[i - 1].onTrack - stages[i - 1].failedHere; });

  const checksBy = new Map();
  for (const ck of project.checks || EMPTY) {
    if (!checksBy.has(ck.modeId)) checksBy.set(ck.modeId, []);
    checksBy.get(ck.modeId).push({ modeId: ck.modeId, checkId: ck.id, type: ck.type });
  }

  for (const s of stages) {
    const list = [];
    for (const [id, byStage] of firstAt) {
      const ids = byStage.get(s.id);
      if (!ids || !ids.length) continue;
      const m = mm.get(id);
      list.push({
        id, name: m.name, severity: m.severity ?? null, decision: m.decision ?? null, fixedAt: m.fixedAt ?? null,
        firstHere: ids.length, alsoPresent: (modeTotal.get(id) || 0) - ids.length, traceIds: ids,
      });
    }
    list.sort((a, b) => b.firstHere - a.firstHere || byName(a, b));
    s.failureModes = list;
    s.checks = list.flatMap((fm) => checksBy.get(fm.id) || EMPTY);
    s.successModes = (project.modes || EMPTY)
      .filter((m) => m.kind === 'success' && m.stage === s.id)
      .map((m) => ({ id: m.id, name: m.name, count: successCount.get(m.id) || 0 }))
      .sort((a, b) => b.count - a.count || byName(a, b));
  }

  unknown.modes = [...unknownModes].map(([id, count]) => {
    const m = mm.get(id);
    return { id, name: m.name, severity: m.severity ?? null, count };
  }).sort((a, b) => b.count - a.count || byName(a, b));

  return { counted: passed + failed, passed, failed, ignored, ignoredIds, unknown, stages, goodOutcome: passed };
}
