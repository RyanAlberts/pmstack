// report.mjs: what you found, in one model the Report tab renders and the CLI
// writes as Markdown; the regression set for your engineers; and the code
// checks to run on every change.

import { computeFunnel } from './funnel.mjs';
import { priorityTable, modeCounts, countedTotal, DECISIONS, SEVERITIES } from './modes.mjs';
import { runChecks, checkAgreement, checkTestState, likelyFailureRate, isCodeCheck, checkTypeLabel } from './checks.mjs';
import { reviewStats, modeMap, orderedReviews, reviewKind } from './review.mjs';
import { traceIndex, tracePositions, traceVersions, normalizeAll, getPath } from './traces.mjs';
import { stageIndex, stageLabel, stageNumber, userWord } from './experience.mjs';
import { pct } from './metrics.mjs';

const EMPTY = Object.freeze([]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const DECISION = Object.fromEntries(DECISIONS.map((d) => [d.id, d]));
const SEVERITY = Object.fromEntries(SEVERITIES.map((s) => [s.id, s]));
const SEVERITY_CLAUSE = { blocks: 'which blocks the {u}', hurts: 'which hurts the {u} or the business', annoys: 'which annoys the {u}' };

function checkRow(p, c, runs, mm) {
  const mode = mm.get(c.modeId);
  let a, split = null, state = null;
  if (isCodeCheck(c)) {
    a = checkAgreement(p, c.id);
    split = 'all labels';
  } else {
    state = checkTestState(p, c.id);
    if (state === 'hidden') { a = checkAgreement(p, c.id, { split: 'tuning' }); split = 'tuning set'; }
    else { a = checkAgreement(p, c.id, { split: 'test' }); split = state === 'outdated' ? 'final test (out of date)' : 'final test'; }
  }
  const likely = c.type === 'judge' && state === 'current' ? likelyFailureRate(p, c.id) : null;
  const verdicts = runs.byCheck[c.id];
  const fails = verdicts ? Object.values(verdicts).filter((v) => v === 'fail').length : null;
  return {
    id: c.id, name: c.name, type: c.type, typeLabel: checkTypeLabel(c),
    modeId: c.modeId, modeName: mode?.name ?? c.modeId, ci: !!c.ci, split, testState: state,
    n: a.n, nPass: a.nPass, nFail: a.nFail, agreesOnGood: a.agreesOnGood, catchesFailures: a.catchesFailures,
    fails, total: verdicts ? Object.keys(verdicts).length : null,
    likely: likely && likely.ok ? { population: likely.population, flagged: likely.flagged, estimate: likely.estimate, low: likely.low, high: likely.high } : null,
  };
}

function versionTable(p, versions, runs) {
  const norm = normalizeAll(p);
  const versionOf = (id) => String(norm.get(id)?.metadata.version ?? '');
  const reviewed = new Map(versions.map((v) => [v, 0]));
  for (const { traceId, review } of orderedReviews(p)) {
    const k = reviewKind(p, review);
    if (k === 'pass' || k === 'fail') { const v = versionOf(traceId); if (reviewed.has(v)) reviewed.set(v, reviewed.get(v) + 1); }
  }
  const counts = modeCounts(p);
  const rows = (p.modes || EMPTY).filter((m) => m.kind === 'failure').map((m) => {
    const ids = counts.get(m.id)?.traceIds || EMPTY;
    const codeChecks = (p.checks || EMPTY).filter((c) => c.modeId === m.id && isCodeCheck(c));
    const cells = versions.map((v) => {
      const traces = ids.filter((id) => versionOf(id) === v).length;
      const n = reviewed.get(v);
      let checkFails = null, checkTotal = null;
      if (codeChecks.length) {
        checkFails = 0; checkTotal = 0;
        for (const [id] of norm) {
          if (versionOf(id) !== v) continue;
          checkTotal++;
          if (codeChecks.some((c) => runs.byCheck[c.id]?.[id] === 'fail')) checkFails++;
        }
      }
      return { version: v, reviewed: n, traces, share: n ? traces / n : null, checkFails, checkTotal };
    });
    return { modeId: m.id, name: m.name, cells };
  });
  return { versions, rows };
}

/** Everything the report shows: title, date, summary sentence, funnel rows, modes, checks, versions, next steps. */
export function reportModel(p, { now } = {}) {
  const exp = p.experience || {};
  const who = userWord(exp);
  const funnel = computeFunnel(p);
  const stats = reviewStats(p);
  const table = priorityTable(p);
  const counts = modeCounts(p);
  const counted = countedTotal(p);
  const mm = modeMap(p);
  const date = String(now || new Date().toISOString()).slice(0, 10);
  const name = p.name || exp.product || 'Untitled project';

  // Reviewed counts every Good and Problem trace; the funnel and shares count only product traces.
  let summary;
  if (!stats.reviewed) summary = 'You have not reviewed any traces yet.';
  else {
    const problems = funnel.failed ? `${funnel.failed} had a problem` : 'None had a problem';
    const aside = funnel.ignored ? `, and ${funnel.ignored === 1 ? '1 was' : `${funnel.ignored} were`} set aside as not a product problem` : '';
    summary = `You reviewed ${stats.reviewed} of ${plural(stats.total, 'trace', 'traces')}. ${problems}${aside}.`;
    const top = table.find((r) => r.traces > 0);
    if (top) {
      const clause = SEVERITY_CLAUSE[top.mode.severity];
      summary += ` The biggest failure mode is ${top.mode.name} (${plural(top.traces, 'trace', 'traces')}, ${pct(top.share)})${clause ? ', ' + clause.replace('{u}', who) : ''}.`;
    }
  }

  const funnelRows = funnel.stages.map((s) => ({
    id: s.id, number: s.number, label: s.label, onTrack: s.onTrack, reached: s.reached, failedHere: s.failedHere,
    share: counted ? s.failedHere / counted : null,
    failureModes: s.failureModes.map((m) => ({ id: m.id, name: m.name, count: m.firstHere, severity: m.severity })),
    successModes: s.successModes.filter((m) => m.count > 0).map((m) => ({ id: m.id, name: m.name, count: m.count })),
  }));

  const quotes = (ids) => ids.map((id) => String(p.reviews?.[id]?.note || '').trim()).filter(Boolean).slice(0, 2);
  const failureModes = table.map((r) => ({
    id: r.mode.id, name: r.mode.name, definition: r.mode.definition || '', stage: r.mode.stage ?? null,
    stageLabel: stageLabel(exp, r.mode.stage), stageNumber: stageNumber(exp, r.mode.stage),
    traces: r.traces, share: r.share, severity: r.mode.severity ?? null, severityLabel: SEVERITY[r.mode.severity]?.short ?? null,
    weight: r.weight, priority: r.priority, decision: r.mode.decision ?? null, decisionLabel: DECISION[r.mode.decision]?.label ?? null,
    instructed: r.mode.instructed ?? null, fixedAt: r.mode.fixedAt ?? null, impact: r.mode.impact || '',
    checks: r.checks, quotes: quotes(counts.get(r.mode.id)?.traceIds || EMPTY),
  }));

  const successModes = (p.modes || EMPTY).filter((m) => m.kind === 'success').map((m) => {
    const traces = counts.get(m.id)?.traces || 0;
    return { id: m.id, name: m.name, definition: m.definition || '', stage: m.stage ?? null, stageLabel: stageLabel(exp, m.stage), stageNumber: stageNumber(exp, m.stage), traces, share: counted ? traces / counted : null };
  }).sort((a, b) => stageIndex(exp, a.stage) - stageIndex(exp, b.stage) || b.traces - a.traces);

  const runs = runChecks(p);
  const checks = (p.checks || EMPTY).map((c) => checkRow(p, c, runs, mm));
  const ci = runChecks(p, { onlyCi: true });
  const passAll = ci.summary.length ? { pass: ci.passAll, total: ci.total, sentence: `${ci.passAll} of ${plural(ci.total, 'trace passes', 'traces pass')} every check that runs on every change.` } : null;

  const versionList = traceVersions(p);
  const versions = versionList.length >= 2 ? versionTable(p, versionList, runs) : null;

  const nextSteps = table.filter((r) => DECISION[r.mode.decision]).map((r) => ({
    modeId: r.mode.id, name: r.mode.name, decision: r.mode.decision, decisionLabel: DECISION[r.mode.decision].label,
    text: DECISION[r.mode.decision].next, fixedAt: r.mode.fixedAt ?? null,
  }));

  return {
    title: `${name}: what we found`, date, summary, funnelRows, failureModes, successModes, checks, versions, nextSteps,
    funnel, passAll, stats: { ...stats, counted, ignored: funnel.ignored },
    outcome: { passed: funnel.passed, counted: funnel.counted, unknown: funnel.unknown.count, ignored: funnel.ignored },
  };
}

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;

/** The report as Markdown; funnelImage (a path or URL) adds the funnel picture. */
export function markdownReport(p, { funnelImage = null, now } = {}) {
  const m = reportModel(p, { now });
  const out = [`# ${m.title}`, '', m.date, '', m.summary, ''];
  if (funnelImage) out.push(`![The funnel of an AI experience](${funnelImage})`, '');

  out.push('## Where traces go wrong', '');
  if (m.funnelRows.length) {
    out.push(row(['Stage', 'On track', 'Went wrong here', 'Failure modes that start here']), '|---|---:|---:|---|');
    for (const r of m.funnelRows) out.push(row([`${r.number} ${r.label}`, r.onTrack, r.failedHere, r.failureModes.map((f) => `${f.name} (${f.count})`).join(', ')]));
    out.push('');
  }
  const extra = [`Good outcome: ${m.outcome.passed} of ${m.outcome.counted}.`];
  if (m.outcome.unknown) extra.push(`Unknown stage: ${m.outcome.unknown}.`);
  if (m.outcome.ignored) extra.push(`Not a product problem: ${m.outcome.ignored} (not counted).`);
  out.push(extra.join(' '), '', 'Each failing trace is counted once, at the first stage that went wrong.', '');

  if (m.failureModes.length) {
    out.push('## Failure modes', '', 'Priority is traces x severity (Blocks 3, Hurts 2, Annoys 1).', '');
    out.push(row(['Failure mode', 'Stage', 'Traces', 'Share', 'Severity', 'Priority', 'Decision', 'Check']), '|---|---|---:|---:|---|---:|---|---|');
    for (const f of m.failureModes) {
      const check = f.checks.length ? f.checks.map((c) => (c.type === 'judge' ? 'AI judge' : 'Code check')).join(', ') : 'None';
      out.push(row([f.name, f.stageNumber ? `${f.stageNumber} ${f.stageLabel}` : 'Unknown stage', f.traces, pct(f.share), f.severityLabel || 'Not set', f.priority, (f.decisionLabel || 'Not decided') + (f.fixedAt ? ' (fixed)' : ''), check]));
    }
    out.push('');
    for (const f of m.failureModes) {
      const lines = [`- **${f.name}**: ${f.definition || 'No definition yet.'}`];
      if (f.impact) lines.push(`  Impact: ${f.impact}`);
      if (f.quotes[0]) lines.push(`  Example note: "${f.quotes[0]}"`);
      out.push(...lines);
    }
    out.push('');
  }

  if (m.successModes.length) {
    out.push('## Success modes', '', row(['Success mode', 'Stage', 'Traces', 'Share']), '|---|---|---:|---:|');
    for (const s of m.successModes) out.push(row([s.name, s.stageNumber ? `${s.stageNumber} ${s.stageLabel}` : 'Unknown stage', s.traces, pct(s.share)]));
    out.push('');
  }

  if (m.checks.length) {
    out.push('## Checks', '');
    if (m.passAll) out.push(m.passAll.sentence, '');
    out.push(row(['Check', 'Type', 'Failure mode', 'Catches real failures', 'Agrees on good traces', 'Labels (Problem / Good)', 'Measured on', 'Likely true failure rate']), '|---|---|---|---:|---:|---|---|---|');
    for (const c of m.checks) {
      const likely = c.likely ? `${pct(c.likely.estimate)}${c.likely.low != null ? ` (95% range: ${pct(c.likely.low)} to ${pct(c.likely.high)})` : ''}` : '';
      out.push(row([c.name, c.typeLabel, c.modeName, pct(c.catchesFailures), pct(c.agreesOnGood), `${c.nFail} / ${c.nPass}`, c.split, likely]));
    }
    out.push('');
  }

  if (m.versions) {
    out.push('## Before and after', '', row(['Failure mode', ...m.versions.versions]), `|---|${m.versions.versions.map(() => '---').join('|')}|`);
    for (const r of m.versions.rows) {
      out.push(row([r.name, ...r.cells.map((c) => {
        const parts = [c.reviewed ? `${c.traces} of ${c.reviewed} reviewed (${pct(c.share)})` : 'Not reviewed'];
        if (c.checkTotal != null) parts.push(`check fails ${c.checkFails} of ${c.checkTotal}`);
        return parts.join('; ');
      })]));
    }
    out.push('');
  }

  if (m.nextSteps.length) {
    out.push('## Next steps', '');
    for (const s of m.nextSteps) out.push(`- **${s.name}** (${s.decisionLabel}${s.fixedAt ? ', fixed' : ''}): ${s.text}.`);
    out.push('');
  }
  out.push('Made with pmstack Eval Studio.', '');
  return out.join('\n');
}

// The replay input: messages up to the last real user turn before the picked step, else the input.
function replayOf(p, raw, stepId) {
  const n = normalizeAll(p).get(String(raw.id));
  const fm = p.experience?.fieldMap;
  const msgs = fm?.messages ? getPath(raw, fm.messages) : raw.messages;
  if (Array.isArray(msgs) && msgs.length && n && n.shape !== 'openai-responses') {
    const userAt = n.steps.filter((s) => s.kind === 'user' && /^m\d+$/.test(s.id)).map((s) => Number(s.id.slice(1)));
    const picked = /^m(\d+)/.exec(stepId || '');
    const limit = picked ? Number(picked[1]) : Infinity;
    const before = userAt.filter((i) => i < limit);
    const last = before.length ? before[before.length - 1] : userAt[userAt.length - 1];
    if (last != null) return { messages: msgs.slice(0, last + 1) };
  }
  return { input: raw.input ?? n?.input ?? null };
}

/**
 * The regression set as JSON lines: failing traces of failure modes you chose to fix or check
 * (or marked fixed), plus Good traces that show success modes. Each line is the original
 * trace plus "expected" and "replay".
 */
export function regressionSet(p) {
  const mm = modeMap(p);
  const tracked = (p.modes || EMPTY).filter((m) => m.kind === 'failure' && (m.decision === 'fix' || m.decision === 'check' || m.fixedAt)).map((m) => m.id);
  const trackedSet = new Set(tracked);
  const idx = traceIndex(p);
  const pos = tracePositions(p);
  const ids = Object.keys(p.reviews || {}).filter((id) => idx.has(id)).sort((a, b) => pos.get(a) - pos.get(b));
  const lines = [];
  for (const id of ids) {
    const r = p.reviews[id];
    const kind = reviewKind(p, r);
    let modes;
    if (kind === 'fail') {
      const hit = (r.modes || EMPTY).filter((m) => trackedSet.has(m));
      if (!hit.length) continue;
      modes = Object.fromEntries(hit.map((m) => [m, 'pass']));
    } else if (kind === 'pass' && (r.successModes || EMPTY).some((m) => mm.get(m)?.kind === 'success')) {
      modes = Object.fromEntries(tracked.map((m) => [m, 'pass']));
    } else continue;
    const raw = idx.get(id);
    lines.push(JSON.stringify({ ...raw, expected: { verdict: 'pass', modes }, replay: replayOf(p, raw, r.step) }));
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

/** Code checks (policy and relevance checks too) that run on every change, as a pmstack.checks/1 file for your build. */
export function ciChecks(p) {
  return {
    format: 'pmstack.checks/1',
    product: p.experience?.product || p.name || '',
    checks: (p.checks || EMPTY).filter((c) => isCodeCheck(c) && c.ci),
    experience: p.experience,
  };
}
