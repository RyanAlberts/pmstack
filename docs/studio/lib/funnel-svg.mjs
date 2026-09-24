// funnel-svg.mjs: draw the funnel of an AI experience. funnelLayout is pure
// geometry (the Funnel tab draws its interactive version from it); funnelSvg
// turns the same geometry into a standalone SVG string for the report, the
// CLI, and the generated visuals. Stages stay neutral: green is for success
// modes, red for failure modes, and checks are neutral pills.

/** Color tokens used by the SVG (section 5.4), light and dark. */
export const SVG_TOKENS = {
  light: {
    bg: '#F7F6F2', surface: '#FFFFFF', surface2: '#F0EEE8', ink: '#16191D', ink2: '#4A525C', ink3: '#646B73', line: '#E2DFD8',
    accent: '#3A56D4', accentSoft: '#E7EBFB', good: '#1B7851', goodSoft: '#E3F2EA', bad: '#BE3E29', badSoft: '#FBE7E2', warn: '#965F00', warnSoft: '#FBF0DC',
  },
  dark: {
    bg: '#0F1216', surface: '#171B21', surface2: '#1E232A', ink: '#E9EBEE', ink2: '#A9B1BB', ink3: '#8A929D', line: '#2A3038',
    accent: '#8AA2FF', accentSoft: '#1F2747', good: '#4CC38A', goodSoft: '#14301F', bad: '#FF7A63', badSoft: '#3A1D18', warn: '#F0B34A', warnSoft: '#33260F',
  },
};
const VAR_NAMES = {
  bg: '--bg', surface: '--surface', surface2: '--surface-2', ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', line: '--line',
  accent: '--accent', accentSoft: '--accent-soft', good: '--good', goodSoft: '--good-soft', bad: '--bad', badSoft: '--bad-soft', warn: '--warn', warnSoft: '--warn-soft',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SEVERITY_WORD = { blocks: 'Blocks', hurts: 'Hurts', annoys: 'Annoys' };
const SEVERITY_TONE = { blocks: 'bad', hurts: 'warn', annoys: 'ink2' };
const DEFAULT_FOOTER = 'Each failing trace is counted once, at the first stage that went wrong.';
const r1 = (x) => Math.round(x * 10) / 10;

/** Wrap text into at most maxLines lines of maxChars; the last line ends with an ellipsis when cut. */
export function wrapText(text, maxChars, maxLines = 2) {
  const limit = Math.max(4, Math.floor(maxChars));
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > limit) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, limit - 1) + '-');
      w = w.slice(limit - 1);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= limit) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  if (last.length > limit - 1) last = last.slice(0, limit - 1).trimEnd();
  kept[maxLines - 1] = last.replace(/[\s,.;:-]+$/, '') + '\u2026';
  return kept;
}

const plural = (n, unit) => `${n} ${n === 1 ? unit[0] : unit[1]}`;

function checkPill(mode, checks) {
  const types = [...new Set(checks.filter((c) => c.modeId === mode.id).map((c) => c.type))];
  if (types.length) {
    return { label: types.map((t) => (t === 'judge' ? 'AI judge' : 'Code check')).join(', '), dashed: false, checkIds: checks.filter((c) => c.modeId === mode.id).map((c) => c.checkId) };
  }
  const label = mode.decision === 'watch' ? 'Keep watching' : mode.decision === 'fix' ? (mode.fixedAt ? 'Fixed' : 'Fix it now') : 'No check yet';
  return { label, dashed: true, checkIds: [] };
}

/**
 * Pure geometry for the funnel: stage headers, the on-track band, red drops with failure
 * mode cards, green success chips, a checks row, the good outcome box, the legend, and the
 * unknown-stage and not-a-product-problem buckets. Height grows to fit the content.
 */
export function funnelLayout(funnel, {
  width = 1200, height = 560, fontSize = 14, title = null, subtitle = null, footer = DEFAULT_FOOTER,
  unit = ['trace', 'traces'], maxFailures = 3, maxSuccess = 2, legend = true,
} = {}) {
  const f = fontSize;
  const W = Math.max(560, width);
  const pad = Math.round(f * 1.7);
  const cw = (size, bold = false) => size * (bold ? 0.6 : 0.56); // average glyph width
  const lh = (size) => Math.round(size * 1.3);
  const stages = funnel?.stages || [];
  const n = Math.max(1, stages.length);
  const labelW = W >= 900 ? Math.round(f * 10.5) : Math.round(f * 8.4);
  const outcomeW = W >= 900 ? Math.round(f * 10.5) : Math.round(f * 8);
  const gap = Math.round(f * 1.15);
  const x0 = pad + labelW;
  const x1 = W - pad - outcomeW - gap;
  const colW = (x1 - x0) / n;
  const inner = colW - 12;

  // Title and legend.
  let y = pad;
  const head = { title: null, subtitle: null };
  if (title) {
    head.title = { x: pad, y: y + f + 8, text: title, size: f + 8 };
    y += lh(f + 8) + 4;
    if (subtitle) { head.subtitle = { x: pad, y: y + f, text: subtitle, size: f }; y += lh(f) + 4; }
  }
  const legendItems = [];
  if (legend) {
    const items = [{ kind: 'success', label: 'Success mode', glyph: 22 }, { kind: 'failure', label: 'Failure mode', glyph: 9 }, { kind: 'check', label: 'Check', glyph: 24 }];
    let lx = W - pad;
    const ly = pad + Math.round((title ? f + 8 : f) * 0.62);
    for (const it of items.reverse()) {
      const tw = it.label.length * cw(f - 2);
      lx -= tw;
      const textX = lx;
      lx -= 6 + it.glyph;
      legendItems.unshift({ kind: it.kind, label: it.label, x: r1(lx), y: ly, glyphWidth: it.glyph, textX: r1(textX) });
      lx -= 18;
    }
    if (!title) y += lh(f) + 6;
  }
  y += 10;

  // Stage headers.
  const headerY = y;
  const badgeR = Math.round(f * 0.8);
  const labelRoom = inner - 4 - (badgeR * 2 + 14);
  const stacked = labelRoom < 70;
  const headerLines = stages.map((s) => wrapText(s.label, (stacked ? inner - 12 : labelRoom) / cw(f, true), stacked ? 3 : 2));
  const maxHeaderLines = Math.max(1, ...headerLines.map((l) => l.length));
  const headerH = stacked ? Math.round(badgeR * 2 + 16 + maxHeaderLines * lh(f)) : Math.max(Math.round(f * 3.9), Math.round(maxHeaderLines * lh(f) + 20));
  const reachedY = headerY + headerH + f + 2;

  // Success chips.
  const chipTop = reachedY + 10;
  const chipSize = f - 1;
  const chipsFor = (s) => {
    const list = (s.successModes || []).filter((m) => m.count > 0);
    let cy = chipTop;
    const chips = list.slice(0, maxSuccess).map((m) => {
      const countW = String(m.count).length * cw(chipSize, true) + 8;
      const room = (inner - 20 - countW) / cw(chipSize);
      const countBelow = room < 12; // narrow column: the count gets its own line
      const lines = wrapText(m.name, countBelow ? (inner - 20) / cw(chipSize) : room, 2);
      const h = 10 + (lines.length + (countBelow ? 1 : 0)) * lh(chipSize);
      const chip = { id: m.id, name: m.name, count: m.count, lines, countBelow, x: 0, y: cy, width: inner, height: h };
      cy += h + 6;
      return chip;
    });
    return { chips, more: Math.max(0, list.length - maxSuccess), bottom: cy + (list.length > maxSuccess ? lh(f - 2) : 0) };
  };
  const chipSets = stages.map(chipsFor);
  const successH = Math.max(f * 2, ...chipSets.map((c) => c.bottom - chipTop));

  // Band.
  const bandTop = chipTop + successH + 24;
  const maxThick = Math.round(f * 7.8);
  const start = stages.length ? stages[0].onTrack : funnel?.passed || 0;
  const scale = start > 0 ? maxThick / start : 0;
  const thick = (v) => (v > 0 ? Math.max(2, v * scale) : 0);

  // Failure cards.
  const failTop = bandTop + maxThick + 28;
  const nameSize = f - 1;
  const metaSize = f - 2;
  // One layout for every card: when any card needs the severity on its own line, all of them use it.
  const wordFits = (m) => {
    const word = SEVERITY_WORD[m.severity];
    return !word || (plural(m.firstHere, unit).length + 3 + word.length) * cw(metaSize, true) <= inner - 18;
  };
  const ownLine = stages.some((s) => (s.failureModes || []).slice(0, maxFailures).some((m) => !wordFits(m)));
  const cardsFor = (s) => {
    const list = s.failureModes || [];
    let cy = failTop;
    const cards = list.slice(0, maxFailures).map((m) => {
      const lines = wrapText(m.name, (inner - 16) / cw(nameSize, true), colW < 150 ? 3 : 2);
      const meta = plural(m.firstHere, unit);
      const word = SEVERITY_WORD[m.severity] || null;
      const severityOwnLine = !!word && ownLine;
      const h = 10 + lines.length * lh(nameSize) + lh(metaSize) * (severityOwnLine ? 2 : 1) + 6;
      const card = { id: m.id, name: m.name, count: m.firstHere, alsoPresent: m.alsoPresent || 0, severity: m.severity ?? null, severityWord: word, severityOwnLine, lines, x: 0, y: cy, width: inner, height: h, meta, traceIds: m.traceIds || [] };
      cy += h + 8;
      return card;
    });
    return { cards, more: Math.max(0, list.length - maxFailures), bottom: cy - 8 + (list.length > maxFailures ? lh(metaSize) + 4 : 0) };
  };
  const cardSets = stages.map(cardsFor);
  const bucketChars = (outcomeW - 20) / cw(metaSize);

  // Unknown stage bucket: the count, then the failure modes of those traces (name and count).
  const hasUnknown = funnel?.unknown?.count > 0;
  const unknownAll = hasUnknown ? (funnel.unknown.modes || []).filter((m) => m && m.count > 0) : [];
  let uy = 10 + lh(nameSize) + lh(metaSize) + (unknownAll.length ? 4 : 6);
  const unknownModes = unknownAll.slice(0, maxFailures).map((m) => {
    const countW = String(m.count).length * cw(metaSize, true) + 8;
    const lines = wrapText(m.name, (outcomeW - 20 - countW) / cw(metaSize), 2);
    const item = { id: m.id, name: m.name, count: m.count, lines, dy: uy };
    uy += lines.length * lh(metaSize) + 4;
    return item;
  });
  const unknownMore = Math.max(0, unknownAll.length - unknownModes.length);
  const unknownH = uy + (unknownMore ? lh(metaSize) : 0) + (unknownModes.length ? 4 : 0);

  // Not a product problem: in the failure modes row, under the unknown stage bucket.
  const ignoredLines = funnel?.ignored > 0
    ? [...wrapText('Not a product problem', bucketChars, 2), ...wrapText(`${plural(funnel.ignored, unit)}, not counted`, bucketChars, 2)]
    : null;
  const ignoredH = ignoredLines ? 12 + ignoredLines.length * lh(metaSize) : 0;
  const ignoredTop = failTop + (hasUnknown ? unknownH + 8 : 0);
  const bucketsH = (hasUnknown ? unknownH : 0) + (ignoredLines ? (hasUnknown ? 8 : 0) + ignoredH : 0);
  const failH = Math.max(f * 2.2, bucketsH, ...cardSets.map((c) => c.bottom - failTop));

  // Checks row.
  const checksTop = failTop + failH + 22;
  const pillH = Math.round(f * 1.85);
  const maxPills = Math.max(1, ...cardSets.map((c) => c.cards.length));
  const checksH = Math.max(f * 2.6, maxPills * (pillH + 6) - 6);
  const footerY = checksTop + checksH + Math.round(f * 2.2);
  const H = Math.max(height, Math.round(footerY + (footer ? f : 0) + pad * 0.6));

  // Per-stage geometry.
  const out = stages.map((s, i) => {
    const x = x0 + i * colW;
    const e = x + colW;
    const tHere = thick(s.onTrack);
    const next = s.onTrack - s.failedHere;
    const tNext = thick(next);
    const dropW = s.failedHere > 0 ? Math.max(8, Math.min(colW * 0.4, s.failedHere * scale)) : 0;
    const dropRight = e - 6 - Math.min(16, colW * 0.08);
    const drop = s.failedHere > 0 ? { x: r1(dropRight - dropW), y: r1(bandTop + tNext), width: r1(dropW), height: r1(failTop - (bandTop + tNext)), count: s.failedHere } : null;
    const lines = headerLines[i];
    const cx = x + 6;
    const chips = chipSets[i].chips.map((c) => ({ ...c, x: r1(cx) }));
    const cards = cardSets[i].cards.map((c) => ({ ...c, x: r1(cx) }));
    const pills = (s.failureModes || []).slice(0, maxFailures).map((m, k) => {
      const p = checkPill(m, s.checks || []);
      const w = Math.min(inner, p.label.length * cw(f - 2) + 28);
      return { modeId: m.id, ...p, x: r1(cx), y: checksTop + k * (pillH + 6), width: r1(w), height: pillH };
    });
    const countInside = tHere >= f * 1.9;
    return {
      id: s.id, number: s.number ?? i + 1, label: s.label, onTrack: s.onTrack, reached: s.reached || 0, failedHere: s.failedHere, failedIds: s.failedIds || [],
      x: r1(x), width: r1(colW),
      header: { x: r1(x + 4), y: headerY, width: r1(colW - 8), height: headerH, lines, stacked, badge: { cx: r1(x + 4 + 10 + badgeR), cy: stacked ? headerY + 10 + badgeR : headerY + headerH / 2, r: badgeR } },
      reachedLabel: s.reached > 0 ? { x: r1(x + 8), y: reachedY, text: `reached by ${s.reached}` } : null,
      band: { x: r1(x), y: bandTop, width: r1(colW), thickness: r1(tHere), nextThickness: r1(tNext) },
      count: { x: r1(x + 10), y: r1(countInside ? bandTop + Math.min(tHere, f * 2.8) / 2 + f * 0.36 : bandTop - 7), value: s.onTrack, inside: countInside, first: i === 0 },
      drop,
      successChips: chips, moreSuccess: chipSets[i].more, moreSuccessY: chipSets[i].bottom - 4,
      failures: cards, moreFailures: cardSets[i].more, moreFailuresY: cardSets[i].bottom,
      checks: pills,
    };
  });

  // Band outline: flat top, bottom steps up at each drop, then runs into the outcome box.
  const outX = x1 + gap;
  const tEnd = thick(funnel?.passed || 0);
  const pts = [`M${r1(x0)} ${bandTop}`, `H${r1(outX)}`, `V${r1(bandTop + tEnd)}`];
  for (let i = out.length - 1; i >= 0; i--) {
    const s = out[i];
    const e = s.x + s.width;
    const cut = s.drop ? s.drop.x : e;
    pts.push(`H${r1(cut)}`, `V${r1(bandTop + s.band.thickness)}`, `H${r1(s.x)}`);
  }
  if (!out.length) pts.push(`H${r1(x0)}`);
  pts.push(`V${bandTop}`, 'Z');

  const outcomeH = Math.max(Math.round(f * 5.2), Math.round(tEnd));
  const valueText = `${funnel?.passed || 0} of ${funnel?.counted || 0}`;
  const valueSize = Math.max(f, Math.min(f + 8, Math.floor((outcomeW - 28) / (valueText.length * 0.6))));
  const outcome = { x: r1(outX), y: bandTop, width: outcomeW, height: outcomeH, value: funnel?.passed || 0, total: funnel?.counted || 0, valueSize, bandThickness: r1(tEnd) };
  const unknown = hasUnknown
    ? {
      x: r1(outX), y: failTop, width: outcomeW, height: unknownH, count: funnel.unknown.count, label: 'Unknown stage', meta: plural(funnel.unknown.count, unit), traceIds: funnel.unknown.traceIds || [],
      modes: unknownModes.map((m) => ({ ...m, y: failTop + m.dy })), moreModes: unknownMore, moreModesY: failTop + uy + lh(metaSize) - 4,
    }
    : null;
  const ignored = ignoredLines
    ? { x: r1(outX), y: ignoredTop, width: outcomeW, height: ignoredH, count: funnel.ignored, label: 'Not a product problem', lines: ignoredLines, traceIds: funnel.ignoredIds || [] }
    : null;

  const rowLabel = (id, title2, sub, yy) => ({ id, title: title2, sub, x: pad, y: r1(yy) });
  const rows = [
    rowLabel('success', 'Success modes', 'what went right', chipTop + f),
    rowLabel('band', 'On track', `${unit[1]} still going`, bandTop + f + 2),
    rowLabel('failures', 'Failure modes', 'first went wrong', failTop + f),
    rowLabel('checks', 'Checks', 'what catches it', checksTop + f + 2),
  ];

  return {
    width: W, height: H, fontSize: f, pad, unit,
    title: head.title, subtitle: head.subtitle,
    legend: legendItems,
    rows,
    stages: out,
    band: { path: pts.join(' '), top: bandTop, x0: r1(x0), x1: r1(outX), maxThickness: maxThick, scale },
    outcome, unknown, ignored,
    footer: footer ? { x: pad, y: r1(footerY), text: footer } : null,
    empty: !(funnel?.counted > 0),
  };
}

// ---------------------------------------------------------------- SVG string

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Build the alt text for a funnel. */
export function funnelDescription(funnel, unit = ['trace', 'traces']) {
  const stages = funnel?.stages || [];
  if (!(funnel?.counted > 0)) return 'The funnel of an AI experience. No reviewed traces yet.';
  const parts = [`The funnel of an AI experience. ${plural(funnel.counted, ['reviewed ' + unit[0], 'reviewed ' + unit[1]])} move through ${stages.length} ${stages.length === 1 ? 'stage' : 'stages'}: ${stages.map((s) => s.label).join(', ')}.`];
  const drops = stages.filter((s) => s.failedHere > 0).map((s) => `${s.failedHere} at ${s.label}${s.failureModes[0] ? ` (mostly ${s.failureModes[0].name})` : ''}`);
  if (drops.length) parts.push(`Failing ${unit[1]} drop out at the first stage that went wrong: ${drops.join('; ')}.`);
  if (funnel.unknown?.count) parts.push(`${plural(funnel.unknown.count, unit)} failed at an unknown stage.`);
  parts.push(`${funnel.passed} of ${funnel.counted} reach a good outcome.`);
  return parts.join(' ');
}

/**
 * The funnel as a standalone SVG string. theme 'light' or 'dark' writes literal colors;
 * 'vars' writes CSS variables with light fallbacks, for inline use. All text is escaped. Pass a
 * distinct idPrefix when several funnels share one page.
 */
export function funnelSvg(funnel, { theme = 'light', width = 1200, title = 'The funnel of an AI experience', subtitle, idPrefix = 'pmf', fontFamily = FONT, ...layoutOpts } = {}) {
  const unit = layoutOpts.unit || ['trace', 'traces'];
  const sub = subtitle !== undefined ? subtitle : funnel?.counted > 0 ? `${plural(funnel.counted, ['reviewed ' + unit[0], 'reviewed ' + unit[1]])}, left to right through each stage` : null;
  const L = funnelLayout(funnel, { width, title, subtitle: sub, ...layoutOpts });
  const pal = SVG_TOKENS[theme === 'dark' ? 'dark' : 'light'];
  const c = (k) => (theme === 'vars' ? `var(${VAR_NAMES[k]}, ${SVG_TOKENS.light[k]})` : pal[k]);
  const paint = (fill, stroke, extra = '') => ` style="fill:${fill ? c(fill) : 'none'};stroke:${stroke ? c(stroke) : 'none'}${extra}"`;
  const f = L.fontSize;
  const text = (x, y, s, { size = f, weight = 400, color = 'ink', anchor = 'start', extra = '' } = {}) =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${paint(color, null)}${extra}>${esc(s)}</text>`;
  const multi = (x, y, lines, size, weight, color, lineH) =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}"${paint(color, null)}>${lines.map((l, i) => `<tspan x="${x}" dy="${i ? lineH : 0}">${esc(l)}</tspan>`).join('')}</text>`;
  const lhOf = (size) => Math.round(size * 1.3);
  const desc = funnelDescription(funnel, unit);
  const id = (k) => `${idPrefix}-${k}`;
  const o = [];

  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" role="img" aria-labelledby="${id('title')} ${id('desc')}" font-family="${esc(fontFamily)}">`);
  o.push(`<title id="${id('title')}">${esc(title || 'The funnel of an AI experience')}</title>`);
  o.push(`<desc id="${id('desc')}">${esc(desc)}</desc>`);
  o.push(`<defs><linearGradient id="${id('band')}" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0" style="stop-color:${c('accent')};stop-opacity:0.26"/>`
    + `<stop offset="1" style="stop-color:${c('accent')};stop-opacity:0.12"/></linearGradient></defs>`);
  o.push(`<rect x="0.5" y="0.5" width="${L.width - 1}" height="${L.height - 1}" rx="16"${paint('surface', 'line')}/>`);

  if (L.title) o.push(text(L.title.x, L.title.y, L.title.text, { size: L.title.size, weight: 700 }));
  if (L.subtitle) o.push(text(L.subtitle.x, L.subtitle.y, L.subtitle.text, { size: L.subtitle.size, color: 'ink2' }));

  // Legend.
  for (const it of L.legend) {
    const gy = it.y;
    if (it.kind === 'success') o.push(`<rect x="${it.x}" y="${gy - 6}" width="22" height="12" rx="6"${paint('goodSoft', 'good')} stroke-width="1.2"/>`);
    else if (it.kind === 'failure') o.push(`<path d="M${it.x} ${gy - 9} h9 v13 a4.5 4.5 0 0 1 -9 0 Z"${paint('bad', null)}/>`);
    else o.push(`<rect x="${it.x}" y="${gy - 6}" width="24" height="12" rx="6"${paint('surface2', 'ink3')} stroke-width="1"/>`);
    o.push(text(it.textX, gy + (f - 2) * 0.35, it.label, { size: f - 2, color: 'ink2' }));
  }

  // Row labels.
  for (const r of L.rows) {
    o.push(text(r.x, r.y, r.title, { size: f, weight: 700 }));
    o.push(text(r.x, r.y + lhOf(f - 2) + 1, r.sub, { size: f - 2, color: 'ink3' }));
  }

  // Stage headers.
  for (const s of L.stages) {
    const h = s.header;
    o.push(`<rect x="${h.x}" y="${h.y}" width="${h.width}" height="${h.height}" rx="10"${paint('surface2', null)}/>`);
    o.push(`<circle cx="${h.badge.cx}" cy="${h.badge.cy}" r="${h.badge.r}"${paint('ink', null)}/>`);
    o.push(text(h.badge.cx, h.badge.cy + (f - 2) * 0.36, String(s.number), { size: f - 2, weight: 700, color: 'surface', anchor: 'middle' }));
    const lineH = lhOf(f);
    if (h.stacked) {
      o.push(multi(h.x + 10, h.y + 20 + h.badge.r * 2 + f * 0.2, h.lines, f, 700, 'ink', lineH));
    } else {
      const lx = h.badge.cx + h.badge.r + 9;
      const top = h.y + h.height / 2 - ((h.lines.length - 1) * lineH) / 2 + f * 0.36;
      o.push(multi(r1(lx), r1(top), h.lines, f, 700, 'ink', lineH));
    }
    if (s.reachedLabel) o.push(text(s.reachedLabel.x, s.reachedLabel.y, s.reachedLabel.text, { size: f - 2, color: 'ink3' }));
  }

  // Success chips.
  const chipSize = f - 1;
  for (const s of L.stages) {
    for (const ch of s.successChips) {
      o.push(`<rect x="${ch.x}" y="${ch.y}" width="${ch.width}" height="${ch.height}" rx="${Math.min(12, ch.height / 2)}"${paint('goodSoft', 'good', ';stroke-opacity:0.5')} stroke-width="1"/>`);
      o.push(multi(ch.x + 10, r1(ch.y + 5 + chipSize), ch.lines, chipSize, 500, 'ink', lhOf(chipSize)));
      if (ch.countBelow) o.push(text(ch.x + 10, r1(ch.y + 5 + chipSize + ch.lines.length * lhOf(chipSize)), String(ch.count), { size: chipSize, weight: 700, color: 'good' }));
      else o.push(text(r1(ch.x + ch.width - 10), r1(ch.y + 5 + chipSize), String(ch.count), { size: chipSize, weight: 700, color: 'good', anchor: 'end' }));
    }
    if (s.moreSuccess) o.push(text(r1(s.x + 8), r1(s.moreSuccessY), `+ ${s.moreSuccess} more`, { size: f - 2, color: 'ink3' }));
  }

  // Band, counts, and drops.
  if (!L.empty) {
    o.push(`<path d="${L.band.path}" style="fill:url(#${id('band')});stroke:none"/>`);
    o.push(`<line x1="${L.band.x0}" y1="${L.band.top}" x2="${L.band.x1}" y2="${L.band.top}"${paint(null, 'accent')} stroke-width="1.5" stroke-linecap="round"/>`);
    for (const s of L.stages) {
      const k = s.count;
      const label = k.first ? `<tspan font-weight="700">${k.value}</tspan><tspan font-weight="500" font-size="${f - 2}"> on track</tspan>` : `<tspan font-weight="700">${k.value}</tspan>`;
      o.push(`<text x="${k.x}" y="${k.y}" font-size="${f + 1}"${paint('accent', null)}>${label}</text>`);
      if (s.drop) {
        const d = s.drop;
        o.push(`<rect x="${d.x}" y="${d.y}" width="${d.width}" height="${d.height}"${paint('bad', null, ';fill-opacity:0.92')}/>`);
      }
    }
  } else {
    const mid = L.stages.length ? L.band.top + L.band.maxThickness / 2 : L.band.top + 40;
    const right = L.outcome.x + L.outcome.width;
    o.push(`<rect x="${L.band.x0}" y="${L.band.top}" width="${r1(right - L.band.x0)}" height="${L.band.maxThickness}" rx="10"${paint('surface2', 'line')} stroke-dasharray="5 4"/>`);
    o.push(text(r1((L.band.x0 + right) / 2), r1(mid + f * 0.35), `Review ${L.unit[1]} to see where they go wrong.`, { size: f, color: 'ink2', anchor: 'middle' }));
  }

  // Failure cards.
  const nameSize = f - 1;
  const metaSize = f - 2;
  const cardText = (x, y, lines, meta, severity, ownLine) => {
    const parts = [multi(x + 10, r1(y + 6 + nameSize), lines, nameSize, 600, 'ink', lhOf(nameSize))];
    const my = r1(y + 6 + nameSize + lines.length * lhOf(nameSize));
    const word = (pos) => `<tspan${pos} font-weight="600"${paint(SEVERITY_TONE[severity] || 'ink2', null)}>${esc(SEVERITY_WORD[severity] || severity)}</tspan>`;
    const sev = !severity ? '' : ownLine ? word(` x="${x + 10}" dy="${lhOf(metaSize)}"`) : `<tspan${paint('ink3', null)}> \u00B7 </tspan>${word('')}`;
    parts.push(`<text x="${x + 10}" y="${my}" font-size="${metaSize}"><tspan font-weight="700"${paint('bad', null)}>${esc(meta)}</tspan>${sev}</text>`);
    return parts.join('');
  };
  for (const s of L.stages) {
    for (const card of s.failures) {
      o.push(`<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="8"${paint('badSoft', null)}/>`);
      o.push(`<rect x="${card.x}" y="${card.y + 6}" width="3" height="${card.height - 12}" rx="1.5"${paint('bad', null)}/>`);
      o.push(cardText(card.x, card.y, card.lines, card.meta, card.severity, card.severityOwnLine));
    }
    if (s.moreFailures) o.push(text(r1(s.x + 8), r1(s.moreFailuresY), `+ ${s.moreFailures} more`, { size: metaSize, color: 'ink3' }));
    for (const p of s.checks) {
      o.push(`<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="${p.height / 2}"${p.dashed ? paint(null, 'ink3') + ' stroke-dasharray="4 3"' : paint('surface2', 'line')} stroke-width="1"/>`);
      o.push(text(r1(p.x + p.width / 2), r1(p.y + p.height / 2 + (f - 2) * 0.36), p.label, { size: f - 2, weight: p.dashed ? 500 : 600, color: p.dashed ? 'ink2' : 'ink', anchor: 'middle' }));
    }
  }

  // Good outcome, unknown stage, and not a product problem.
  const oc = L.outcome;
  if (!L.empty) o.push(`<rect x="${oc.x}" y="${oc.y}" width="${oc.width}" height="${oc.height}" rx="12"${paint('goodSoft', 'good')} stroke-width="1.5"/>`);
  const ocTop = oc.y + oc.height / 2 - f * 1.35;
  if (!L.empty) {
    o.push(text(oc.x + 14, r1(ocTop + f * 0.9), 'Good outcome', { size: f - 1, weight: 700, color: 'good' }));
    o.push(text(oc.x + 14, r1(ocTop + f * 0.9 + f + 12), `${oc.value} of ${oc.total}`, { size: oc.valueSize, weight: 700 }));
  }
  if (L.unknown) {
    const u = L.unknown;
    o.push(`<rect x="${u.x}" y="${u.y}" width="${u.width}" height="${u.height}" rx="8"${paint(null, 'bad')} stroke-width="1.2" stroke-dasharray="5 4"/>`);
    o.push(cardText(u.x, u.y, [u.label], u.meta, null, false));
    for (const m of u.modes) {
      o.push(multi(u.x + 10, r1(m.y + metaSize), m.lines, metaSize, 500, 'ink', lhOf(metaSize)));
      o.push(text(r1(u.x + u.width - 10), r1(m.y + metaSize), String(m.count), { size: metaSize, weight: 700, color: 'bad', anchor: 'end' }));
    }
    if (u.moreModes) o.push(text(u.x + 10, r1(u.moreModesY), `+ ${u.moreModes} more`, { size: metaSize, color: 'ink3' }));
  }
  if (L.ignored) {
    const g = L.ignored;
    o.push(`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="8"${paint(null, 'ink3')} stroke-width="1" stroke-dasharray="4 3"/>`);
    o.push(multi(g.x + 10, r1(g.y + 6 + metaSize), g.lines, metaSize, 500, 'ink2', lhOf(metaSize)));
  }
  if (L.footer) o.push(text(L.footer.x, L.footer.y, L.footer.text, { size: f - 2, color: 'ink3' }));
  o.push('</svg>');
  return o.join('\n');
}
