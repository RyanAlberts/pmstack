// Funnel tab (SPEC 5.3): the live funnel of an AI experience, drawn from funnelLayout so every
// label is a button, then "What to fix first" (priorityTable) and coverage per detail value.
// Stages stay neutral and numbered; green is for success modes, red for failure modes, and
// checks are neutral pills (dashed when there is no check yet).

import {
  html, useStore, useState, useMemo, useLayoutEffect, classes, plural, formatCount,
  Button, Drawer, Segmented, EmptyState, Icon, DownloadButton, RendererBoundary,
} from 'pmstack/ui';
import { updateProject, navigate, setUi, DEFAULT_FILTERS, hashFor } from '../store.mjs';
import * as lib from '../lib/index.mjs';

const EMPTY = Object.freeze([]);
const DOT = String.fromCharCode(0x00B7);
const TRACE_UNIT = ['trace', 'traces'];
const MIN_COLUMN = 124; // narrowest stage column before the funnel scrolls sideways
const DRAWER_PAGE = 200;
const TEXT_SIZE = 14; // funnelLayout's default text size, which the drawing below matches
const COMPACT_BELOW = 980; // below this width the funnel becomes a list of stages
const SEVERITY_TONE = { blocks: 'bad', hurts: 'warn', annoys: 'ink2' };
const SEVERITY_RANK = { blocks: 3, hurts: 2, annoys: 1 };
const DECISION_RANK = { fix: 0, check: 1, watch: 2 };

// The version filter survives switching tabs during this visit.
let lastVersion = null;

// ---------------------------------------------------------------------------
// Helpers

function hasRules(stage) {
  const m = stage && stage.match;
  if (!m || typeof m !== 'object') return false;
  return Object.values(m).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== '' && v !== false));
}

function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function capital(s) {
  const t = String(s || '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Open Review traces on one trace, with filters that keep J and K inside the same group. */
function openInReview(traceId, filter) {
  setUi({ filters: { ...DEFAULT_FILTERS, ...(filter || {}), scope: 'all' } });
  navigate('review', traceId);
}

/** Trace id groups the funnel labels point to. */
function traceGroups(project, funnel, version) {
  const passIds = lib.filterTraces(project, { ...DEFAULT_FILTERS, status: 'pass', version });
  const failedByStage = funnel.stages.map((s) => s.failedIds || EMPTY);
  const counted = [...passIds, ...failedByStage.flat(), ...((funnel.unknown && funnel.unknown.traceIds) || EMPTY)];
  return {
    passIds,
    onTrack: (i) => [...failedByStage.slice(i).flat(), ...passIds],
    reached: (stageId) => {
      const norm = lib.normalizeAll(project);
      return counted.filter((id) => {
        const n = norm.get(id);
        return !!n && n.steps.some((st) => st.stage === stageId);
      });
    },
  };
}

// Agreement numbers for one check, when known. Judges use the tuning set until the final
// test is revealed; splits are worked out the same way the Checks tab assigns them.
function checkRates(project, check) {
  try {
    if (check.type === 'judge') {
      const q = project.splits && project.splits[check.modeId] ? project : lib.assignSplits(project, check.modeId);
      const revealed = q.splits && q.splits[check.modeId] && q.splits[check.modeId].revealedAt;
      const a = lib.checkAgreement(q, check.id, { split: revealed ? 'test' : 'tuning' });
      return a.n ? { ...a, where: revealed ? 'on the final test' : 'on the tuning set' } : null;
    }
    const a = lib.checkAgreement(project, check.id);
    return a.n ? { ...a, where: '' } : null;
  } catch {
    return null;
  }
}

function ViewError({ error, reset }) {
  return html`<section class="page">
    <div class="empty" role="alert">
      <div class="empty-icon"><${Icon} name="warning" size=${20} /></div>
      <h2 class="empty-title">This tab could not be drawn</h2>
      <p class="empty-body">${error && error.message ? error.message : 'Something in this project could not be read.'}</p>
      <div class="empty-action"><${Button} kind="primary" onClick=${reset}>Try again<//></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Interactive funnel (SVG from funnelLayout)

const lhOf = (size) => Math.round(size * 1.3);
const r1 = (x) => Math.round(x * 10) / 10;

// Text fitting with the real font. funnelLayout wraps with an average glyph width, which is
// cautious for Instrument Sans; re-fitting with measured widths keeps whole names readable
// without ever using more lines than the layout reserved.
const ELLIPSIS = String.fromCharCode(0x2026);
const widthCache = new Map();
let measureCtx = null;
let fontFamily = '';

function textWidth(text, size, weight) {
  const key = weight + '|' + size + '|' + text;
  let w = widthCache.get(key);
  if (w == null) {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
      fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
    }
    if (!measureCtx) return text.length * size * 0.56;
    measureCtx.font = `${weight} ${size}px ${fontFamily}`;
    w = measureCtx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

// Balanced wrap: the narrowest width that keeps the same number of whole lines, so a
// two-line label never ends with one lonely word.
function fitLines(text, maxWidth, size, weight, maxLines) {
  const first = greedyLines(text, maxWidth, size, weight, maxLines);
  if (first.cut || first.lines.length < 2) return first;
  let lo = maxWidth * 0.5;
  let hi = maxWidth;
  let best = first;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const tryIt = greedyLines(text, mid, size, weight, maxLines);
    if (!tryIt.cut && tryIt.lines.length === first.lines.length && !tryIt.lines.some((l) => l.endsWith('-'))) {
      best = tryIt;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

function greedyLines(text, maxWidth, size, weight, maxLines) {
  const fits = (t) => textWidth(t, size, weight) <= maxWidth;
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (let word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (fits(next)) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    while (!fits(word) && word.length > 4) {
      let cut = word.length - 1;
      while (cut > 2 && !fits(word.slice(0, cut) + '-')) cut--;
      lines.push(word.slice(0, cut) + '-');
      word = word.slice(cut);
    }
    cur = word;
  }
  if (cur) lines.push(cur);
  const max = Math.max(1, maxLines);
  if (lines.length <= max) return { lines, cut: false };
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last.length > 1 && !fits(last + ELLIPSIS)) last = last.slice(0, -1).trimEnd();
  kept[max - 1] = last.replace(/[\s,.;:-]+$/, '') + ELLIPSIS;
  return { lines: kept, cut: true };
}

/** Re-measure once web fonts finish loading. */
function useFontsReady() {
  const [n, setN] = useState(0);
  useLayoutEffect(() => {
    let live = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!live) return;
        widthCache.clear();
        setN((x) => x + 1);
      });
    }
    return () => { live = false; };
  }, []);
  return n;
}

function Lines({ x, y, lines, size, weight = 400, tone = 'ink' }) {
  const lh = lhOf(size);
  return html`<text x=${x} y=${r1(y)} font-size=${size} font-weight=${weight} class=${'funnel-t-' + tone}>
    ${lines.map((l, i) => html`<tspan key=${i} x=${x} dy=${i ? lh : 0}>${l}</tspan>`)}
  </text>`;
}

/** A focusable, clickable group in the funnel. The ring doubles as the click target and the focus outline. */
function Hit({ label, onActivate, box, radius = 8, children, class: cls }) {
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
  return html`<g class=${classes('funnel-hit', cls)} role="button" tabindex="0" aria-label=${label}
    onClick=${onActivate} onKeyDown=${onKeyDown}>
    ${children}
    <rect class="funnel-ring" x=${r1(box.x - 3)} y=${r1(box.y - 3)} width=${r1(box.w + 6)} height=${r1(box.h + 6)} rx=${radius + 3} />
  </g>`;
}

function StageHeader({ s, f, onOpen }) {
  const h = s.header;
  const lineH = lhOf(f);
  let label;
  if (h.stacked) {
    const fit = fitLines(s.label, h.width - 20, f, 700, h.lines.length);
    label = html`<${Lines} x=${h.x + 10} y=${h.y + 20 + h.badge.r * 2 + f * 0.2} lines=${fit.lines} size=${f} weight="700" />`;
  } else {
    const lx = r1(h.badge.cx + h.badge.r + 9);
    const fit = fitLines(s.label, h.x + h.width - lx - 8, f, 700, h.lines.length);
    const top = h.y + h.height / 2 - ((fit.lines.length - 1) * lineH) / 2 + f * 0.36;
    label = html`<${Lines} x=${lx} y=${top} lines=${fit.lines} size=${f} weight="700" />`;
  }
  const said = s.failedHere
    ? `${plural(s.failedHere, 'trace')} went wrong here first.`
    : 'No trace went wrong here first.';
  return html`<${Hit} label=${`Stage ${s.number}: ${s.label}. ${said} Show them.`} onActivate=${onOpen}
    box=${{ x: h.x, y: h.y, w: h.width, h: h.height }} radius=${10} class="funnel-hit-stage">
    <rect class="funnel-stage-bg" x=${h.x} y=${h.y} width=${h.width} height=${h.height} rx="10" />
    <circle class="funnel-stage-badge" cx=${h.badge.cx} cy=${h.badge.cy} r=${h.badge.r} />
    <text x=${h.badge.cx} y=${r1(h.badge.cy + (f - 2) * 0.36)} font-size=${f - 2} font-weight="700" text-anchor="middle" class="funnel-t-surface">${s.number}</text>
    ${label}
  <//>`;
}

function FunnelChart({ layout: L, funnel, showReached, open, emptyText }) {
  useFontsReady();
  const f = TEXT_SIZE;
  const chipSize = f - 1;
  const nameSize = f - 1;
  const metaSize = f - 2;

  return html`<svg class="funnel-svg" viewBox=${`0 0 ${L.width} ${L.height}`} width=${L.width} height=${L.height}
    role="group" aria-label="The funnel of an AI experience. Every label is a button that lists its traces.">
    <defs>
      <linearGradient id="funnel-view-band" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" class="funnel-band-stop-a" />
        <stop offset="1" class="funnel-band-stop-b" />
      </linearGradient>
    </defs>

    ${L.rows.map((r) => html`<g key=${r.id} aria-hidden="true">
      <text x=${r.x} y=${r.y} font-size=${f} font-weight="700" class="funnel-t-ink">${r.title}</text>
      <text x=${r.x} y=${r.y + lhOf(f - 2) + 1} font-size=${f - 2} class="funnel-t-ink3">${r.sub}</text>
    </g>`)}

    ${L.stages.map((s) => html`<g key=${'h' + s.id}>
      <${StageHeader} s=${s} f=${f} onOpen=${() => open({ type: 'stage', stageId: s.id })} />
      ${s.reachedLabel && showReached.has(s.id) && html`<${Hit} label=${`Reached by ${plural(s.reached, 'trace')}: counted traces with a step in ${s.label}. Show them.`}
        onActivate=${() => open({ type: 'reached', stageId: s.id })} radius=${4}
        box=${{ x: s.reachedLabel.x - 2, y: s.reachedLabel.y - (f - 2) * 0.95, w: s.reachedLabel.text.length * (f - 2) * 0.54 + 4, h: (f - 2) * 1.3 }}>
        <text x=${s.reachedLabel.x} y=${s.reachedLabel.y} font-size=${f - 2} class="funnel-t-ink3">${s.reachedLabel.text}</text>
      <//>`}
    </g>`)}

    ${L.stages.map((s) => html`<g key=${'c' + s.id}>
      ${s.successChips.map((ch) => {
        const fit = fitLines(ch.name, ch.width - 20 - (ch.countBelow ? 0 : textWidth(String(ch.count), chipSize, 700) + 8), chipSize, 500, ch.lines.length);
        const top = ch.y + 5 + chipSize + ((ch.lines.length - fit.lines.length) * lhOf(chipSize)) / 2;
        return html`<${Hit} key=${ch.id} label=${`Success mode ${ch.name}: ${plural(ch.count, 'trace')}. Show them.`}
          onActivate=${() => open({ type: 'success', modeId: ch.id })} radius=${Math.min(12, ch.height / 2)}
          box=${{ x: ch.x, y: ch.y, w: ch.width, h: ch.height }}>
          <rect class="funnel-chip" x=${ch.x} y=${ch.y} width=${ch.width} height=${ch.height} rx=${Math.min(12, ch.height / 2)} />
          ${fit.cut && html`<title>${ch.name}</title>`}
          <${Lines} x=${ch.x + 10} y=${top} lines=${fit.lines} size=${chipSize} weight="500" />
          ${ch.countBelow
            ? html`<text x=${ch.x + 10} y=${r1(top + fit.lines.length * lhOf(chipSize))} font-size=${chipSize} font-weight="700" class="funnel-t-good">${ch.count}</text>`
            : html`<text x=${r1(ch.x + ch.width - 10)} y=${r1(top)} font-size=${chipSize} font-weight="700" text-anchor="end" class="funnel-t-good">${ch.count}</text>`}
        <//>`;
      })}
      ${s.moreSuccess > 0 && html`<${Hit} label=${`${s.moreSuccess} more success modes at ${s.label}. Open Failure modes.`}
        onActivate=${() => navigate('modes')} radius=${4}
        box=${{ x: s.x + 6, y: s.moreSuccessY - (f - 2), w: 80, h: (f - 2) * 1.35 }}>
        <text x=${r1(s.x + 8)} y=${r1(s.moreSuccessY)} font-size=${f - 2} class="funnel-t-ink3">+ ${s.moreSuccess} more</text>
      <//>`}
    </g>`)}

    ${!L.empty && html`<g>
      <path class="funnel-band" d=${L.band.path} />
      <line class="funnel-band-top" x1=${L.band.x0} y1=${L.band.top} x2=${L.band.x1} y2=${L.band.top} />
      ${L.stages.map((s, i) => {
        const k = s.count;
        const w = String(k.value).length * (f + 1) * 0.62 + (k.first ? 9 * (f - 2) * 0.55 : 0);
        return html`<${Hit} key=${'n' + s.id} label=${`${plural(k.value, 'trace')} still on track at stage ${s.number}, ${s.label}. Show them.`}
          onActivate=${() => open({ type: 'onTrack', index: i })} radius=${4}
          box=${{ x: k.x - 4, y: k.y - (f + 1) * 0.92, w: w + 8, h: (f + 1) * 1.3 }}>
          <text x=${k.x} y=${k.y} font-size=${f + 1} class="funnel-t-accent">
            <tspan font-weight="700">${k.value}</tspan>${k.first && html`<tspan font-weight="500" font-size=${f - 2}> on track</tspan>`}
          </text>
        <//>`;
      })}
      ${L.stages.filter((s) => s.drop).map((s) => html`<${Hit} key=${'d' + s.id}
        label=${`${plural(s.drop.count, 'trace')} went wrong first at stage ${s.number}, ${s.label}. Show them.`}
        onActivate=${() => open({ type: 'stage', stageId: s.id })} radius=${2}
        box=${{ x: s.drop.x, y: s.drop.y, w: s.drop.width, h: s.drop.height }}>
        <rect class="funnel-drop" x=${s.drop.x} y=${s.drop.y} width=${s.drop.width} height=${s.drop.height} />
      <//>`)}
    </g>`}
    ${L.empty && html`<g aria-hidden="true">
      <rect class="funnel-empty-band" x=${L.band.x0} y=${L.band.top} width=${r1(L.outcome.x + L.outcome.width - L.band.x0)} height=${L.band.maxThickness} rx="10" />
      <text x=${r1((L.band.x0 + L.outcome.x + L.outcome.width) / 2)} y=${r1(L.band.top + L.band.maxThickness / 2 + f * 0.35)}
        font-size=${f} text-anchor="middle" class="funnel-t-ink2">${emptyText}</text>
    </g>`}

    ${L.stages.map((s) => html`<g key=${'f' + s.id}>
      ${s.failures.map((card) => {
        const fit = fitLines(card.name, card.width - 18, nameSize, 600, card.lines.length);
        const top = card.y + 6 + nameSize + ((card.lines.length - fit.lines.length) * lhOf(nameSize)) / 2;
        const my = top + fit.lines.length * lhOf(nameSize);
        const word = card.severityWord;
        return html`<${Hit} key=${card.id}
          label=${`Failure mode ${card.name}: ${plural(card.count, 'trace')} went wrong here first${word ? `, ${word}` : ''}. Show them.`}
          onActivate=${() => open({ type: 'failure', modeId: card.id, stageId: s.id })}
          box=${{ x: card.x, y: card.y, w: card.width, h: card.height }}>
          <rect class="funnel-card" x=${card.x} y=${card.y} width=${card.width} height=${card.height} rx="8" />
          <rect class="funnel-card-rule" x=${card.x} y=${card.y + 6} width="3" height=${card.height - 12} rx="1.5" />
          ${fit.cut && html`<title>${card.name}</title>`}
          <${Lines} x=${card.x + 10} y=${top} lines=${fit.lines} size=${nameSize} weight="600" />
          <text x=${card.x + 10} y=${r1(my)} font-size=${metaSize}>
            <tspan font-weight="700" class="funnel-t-bad">${card.meta}</tspan>
            ${word && (card.severityOwnLine
              ? html`<tspan x=${card.x + 10} dy=${lhOf(metaSize)} font-weight="600" class=${'funnel-t-' + (SEVERITY_TONE[card.severity] || 'ink2')}>${word}</tspan>`
              : html`<tspan class="funnel-t-ink3">${` ${DOT} `}</tspan><tspan font-weight="600" class=${'funnel-t-' + (SEVERITY_TONE[card.severity] || 'ink2')}>${word}</tspan>`)}
          </text>
        <//>`;
      })}
      ${s.moreFailures > 0 && html`<${Hit} label=${`${s.moreFailures} more failure modes at ${s.label}. Show the traces.`}
        onActivate=${() => open({ type: 'stage', stageId: s.id })} radius=${4}
        box=${{ x: s.x + 6, y: s.moreFailuresY - metaSize, w: 80, h: metaSize * 1.35 }}>
        <text x=${r1(s.x + 8)} y=${r1(s.moreFailuresY)} font-size=${metaSize} class="funnel-t-ink3">+ ${s.moreFailures} more</text>
      <//>`}
      ${s.checks.map((p) => html`<${Hit} key=${'p' + p.modeId}
        label=${p.dashed ? `${p.label} for this failure mode. Open Checks.` : `${p.label}. Open it in Checks.`}
        onActivate=${() => navigate('checks', p.checkIds.length === 1 ? p.checkIds[0] : p.modeId)} radius=${p.height / 2}
        box=${{ x: p.x, y: p.y, w: p.width, h: p.height }}>
        <rect class=${classes('funnel-pill', p.dashed && 'is-dashed')} x=${p.x} y=${p.y} width=${p.width} height=${p.height} rx=${p.height / 2} />
        <text x=${r1(p.x + p.width / 2)} y=${r1(p.y + p.height / 2 + (f - 2) * 0.36)} font-size=${f - 2} font-weight=${p.dashed ? 500 : 600}
          text-anchor="middle" class=${p.dashed ? 'funnel-t-ink2' : 'funnel-t-ink'}>${p.label}</text>
      <//>`)}
    </g>`)}

    ${!L.empty && html`<${Hit} label=${`Good outcome: ${L.outcome.value} of ${L.outcome.total} counted traces. Show them.`}
      onActivate=${() => open({ type: 'good' })} radius=${12}
      box=${{ x: L.outcome.x, y: L.outcome.y, w: L.outcome.width, h: L.outcome.height }}>
      <rect class="funnel-outcome" x=${L.outcome.x} y=${L.outcome.y} width=${L.outcome.width} height=${L.outcome.height} rx="12" />
      <text x=${L.outcome.x + 14} y=${r1(L.outcome.y + L.outcome.height / 2 - f * 1.35 + f * 0.9)} font-size=${f - 1} font-weight="700" class="funnel-t-good">Good outcome</text>
      <text x=${L.outcome.x + 14} y=${r1(L.outcome.y + L.outcome.height / 2 - f * 1.35 + f * 0.9 + f + 12)} font-size=${L.outcome.valueSize} font-weight="700" class="funnel-t-ink">${L.outcome.value} of ${L.outcome.total}</text>
    <//>`}

    ${L.unknown && html`<${Hit} label=${`Unknown stage: ${plural(L.unknown.count, 'trace')} went wrong at a stage nobody picked yet. Show them.`}
      onActivate=${() => open({ type: 'unknown' })}
      box=${{ x: L.unknown.x, y: L.unknown.y, w: L.unknown.width, h: L.unknown.height }}>
      <rect class="funnel-unknown" x=${L.unknown.x} y=${L.unknown.y} width=${L.unknown.width} height=${L.unknown.height} rx="8" />
      <text x=${L.unknown.x + 10} y=${r1(L.unknown.y + 6 + nameSize)} font-size=${nameSize} font-weight="600" class="funnel-t-ink">${L.unknown.label}</text>
      <text x=${L.unknown.x + 10} y=${r1(L.unknown.y + 6 + nameSize + lhOf(nameSize))} font-size=${metaSize} font-weight="700" class="funnel-t-bad">${L.unknown.meta}</text>
    <//>`}

    ${L.ignored && html`<${Hit} label=${`Not a product problem: ${plural(L.ignored.count, 'trace')}, not counted. Show them.`}
      onActivate=${() => open({ type: 'ignored' })}
      box=${{ x: L.ignored.x, y: L.ignored.y, w: L.ignored.width, h: L.ignored.height }}>
      <rect class="funnel-ignored" x=${L.ignored.x} y=${L.ignored.y} width=${L.ignored.width} height=${L.ignored.height} rx="8" />
      <${Lines} x=${L.ignored.x + 10} y=${L.ignored.y + 6 + metaSize} lines=${L.ignored.lines} size=${metaSize} weight="500" tone="ink2" />
    <//>`}
  </svg>`;
}

// Phones and small tablets: the same funnel as a numbered list of stages, top to bottom.
// A rail on the left narrows as traces drop out, like the band in the wide drawing.
function MobileFunnel({ layout: L, funnel, showReached, open, emptyText }) {
  const start = L.stages.length ? L.stages[0].onTrack : 0;
  const share = (v) => `${start > 0 ? Math.max(v > 0 ? 6 : 0, (v / start) * 100) : 0}%`;
  if (L.empty) return html`<p class="funnel-m-empty">${emptyText}</p>`;
  return html`<div class="funnel-m">
    <ol class="funnel-m-list">
      ${L.stages.map((s, i) => html`<li class="funnel-m-stage" key=${s.id}>
        <div class="funnel-m-rail" aria-hidden="true">
          <span class="funnel-m-band" style=${{ width: share(s.onTrack) }}></span>
        </div>
        <div class="funnel-m-body">
          <div class="funnel-m-top">
            <button type="button" class="funnel-m-head" onClick=${() => open({ type: 'stage', stageId: s.id })}
              aria-label=${`Stage ${s.number}: ${s.label}. ${plural(s.failedHere, 'trace')} went wrong here first. Show them.`}>
              <span class="funnel-m-num">${s.number}</span>
              <span class="funnel-m-label">${s.label}</span>
            </button>
            <button type="button" class="funnel-m-count" onClick=${() => open({ type: 'onTrack', index: i })}
              aria-label=${`${plural(s.onTrack, 'trace')} still on track at stage ${s.number}. Show them.`}>
              <strong>${formatCount(s.onTrack)}</strong> on track
            </button>
          </div>
          ${s.reachedLabel && showReached.has(s.id) && html`<button type="button" class="funnel-m-reached"
            onClick=${() => open({ type: 'reached', stageId: s.id })}>${s.reachedLabel.text}</button>`}
          ${s.successChips.length > 0 && html`<div class="funnel-m-chips">
            ${s.successChips.map((ch) => html`<button type="button" key=${ch.id} class="funnel-m-chip"
              onClick=${() => open({ type: 'success', modeId: ch.id })} aria-label=${`Success mode ${ch.name}: ${plural(ch.count, 'trace')}. Show them.`}>
              <span>${ch.name}</span><strong>${ch.count}</strong>
            </button>`)}
          </div>`}
          ${s.failures.map((card, k) => {
            const pill = s.checks[k];
            return html`<div class="funnel-m-fail-row" key=${card.id}>
              <button type="button" class="funnel-m-fail" onClick=${() => open({ type: 'failure', modeId: card.id, stageId: s.id })}
                aria-label=${`Failure mode ${card.name}: ${plural(card.count, 'trace')} went wrong here first${card.severityWord ? `, ${card.severityWord}` : ''}. Show them.`}>
                <span class="funnel-m-fail-name">${card.name}</span>
                <span class="funnel-m-fail-meta"><strong>${card.meta}</strong>${card.severityWord && html`<span class=${'is-' + (card.severity || 'none')}>${` ${DOT} `}${card.severityWord}</span>`}</span>
              </button>
              ${pill && html`<button type="button" class=${classes('funnel-m-pill', pill.dashed && 'is-dashed')}
                onClick=${() => navigate('checks', pill.checkIds.length === 1 ? pill.checkIds[0] : pill.modeId)}>${pill.label}</button>`}
            </div>`;
          })}
          ${s.moreFailures > 0 && html`<button type="button" class="funnel-m-more" onClick=${() => open({ type: 'stage', stageId: s.id })}>+ ${s.moreFailures} more</button>`}
        </div>
      </li>`)}
    </ol>
    <div class="funnel-m-end">
      <button type="button" class="funnel-m-outcome" onClick=${() => open({ type: 'good' })}>
        <span>Good outcome</span><strong>${L.outcome.value} of ${L.outcome.total}</strong>
      </button>
      ${L.unknown && html`<button type="button" class="funnel-m-bucket is-unknown" onClick=${() => open({ type: 'unknown' })}>
        <span>Unknown stage</span><strong>${L.unknown.meta}</strong>
      </button>`}
      ${L.ignored && html`<button type="button" class="funnel-m-bucket" onClick=${() => open({ type: 'ignored' })}>
        <span>Not a product problem</span><strong>${plural(L.ignored.count, 'trace')}, not counted</strong>
      </button>`}
    </div>
  </div>`;
}

function Legend() {
  return html`<ul class="funnel-legend" aria-label="Legend">
    <li><span class="funnel-glyph is-success" aria-hidden="true"></span>Success mode</li>
    <li><span class="funnel-glyph is-failure" aria-hidden="true"></span>Failure mode</li>
    <li><span class="funnel-glyph is-check" aria-hidden="true"></span>Check</li>
  </ul>`;
}

// ---------------------------------------------------------------------------
// Drawer of traces behind a label

function drawerSpec(project, funnel, groups, req, version) {
  const exp = project.experience;
  const stageOf = (id) => funnel.stages.find((s) => s.id === id);
  const v = version != null ? { version } : {};
  if (req.type === 'stage') {
    const s = stageOf(req.stageId);
    const modes = s.failureModes.map((m) => m.name);
    return {
      title: `${s.number} ${s.label}`,
      lead: s.failedHere
        ? `${plural(s.failedHere, 'trace')} went wrong here first${modes.length ? `: ${modes.join(', ')}` : ''}.`
        : `No trace went wrong here first. ${plural(s.onTrack, 'trace')} passed through on track.`,
      ids: s.failedIds || EMPTY,
      filter: { status: 'fail', stage: s.id, ...v },
    };
  }
  if (req.type === 'failure') {
    const s = stageOf(req.stageId);
    const m = s.failureModes.find((x) => x.id === req.modeId);
    const also = m.alsoPresent ? ` It also shows up in ${plural(m.alsoPresent, 'trace')} that went wrong first at another stage.` : '';
    return {
      title: m.name,
      lead: `${plural(m.firstHere, 'trace')} went wrong first at ${s.number} ${s.label} with this failure mode.${also}`,
      ids: m.traceIds || EMPTY,
      filter: { status: 'fail', modeId: m.id, stage: s.id, ...v },
      modeId: m.id,
    };
  }
  if (req.type === 'success') {
    const mode = (project.modes || EMPTY).find((x) => x.id === req.modeId);
    const c = lib.modeCounts(project).get(req.modeId);
    const ids = version != null ? lib.filterTraces(project, { ...DEFAULT_FILTERS, modeId: req.modeId, version }) : (c ? c.traceIds : EMPTY);
    return {
      title: mode ? mode.name : 'Success mode',
      lead: `${plural(ids.length, 'counted trace')} got this right${mode && mode.stage ? ` at ${lib.stageNumber(exp, mode.stage)} ${lib.stageLabel(exp, mode.stage)}` : ''}.`,
      ids,
      filter: { modeId: req.modeId, ...v },
      modeId: req.modeId,
    };
  }
  if (req.type === 'onTrack') {
    const s = funnel.stages[req.index];
    return {
      title: `On track at ${s.number} ${s.label}`,
      lead: `${plural(s.onTrack, 'trace')} had not gone wrong before this stage: ${funnel.passed} Good, and ${s.onTrack - funnel.passed} that go wrong here or later.`,
      ids: groups.onTrack(req.index),
      filter: null,
    };
  }
  if (req.type === 'reached') {
    const s = stageOf(req.stageId);
    const ids = groups.reached(s.id);
    return {
      title: `Reached ${s.number} ${s.label}`,
      lead: `${plural(ids.length, 'counted trace')} had at least one step in this stage.`,
      ids,
      filter: null,
    };
  }
  if (req.type === 'good') {
    return {
      title: 'Good outcome',
      lead: `${funnel.passed} of ${funnel.counted} counted traces went well from start to finish.`,
      ids: groups.passIds,
      filter: { status: 'pass', ...v },
    };
  }
  if (req.type === 'unknown') {
    return {
      title: 'Unknown stage',
      lead: 'These Problem traces have no stage yet. Pick where each one first went wrong, or add it to a failure mode that has a stage.',
      ids: (funnel.unknown && funnel.unknown.traceIds) || EMPTY,
      filter: { status: 'fail', stage: 'unknown', ...v },
    };
  }
  const ignoreModes = (project.modes || EMPTY).filter((m) => m.kind === 'ignore');
  return {
    title: 'Not a product problem',
    lead: 'Test sessions and unclear traces. They are not counted in the funnel.',
    ids: funnel.ignoredIds || EMPTY,
    filter: ignoreModes.length === 1 ? { status: 'fail', modeId: ignoreModes[0].id, ...v } : null,
  };
}

function TraceRow({ project, id, trace, onGo }) {
  const r = project.reviews && project.reviews[id];
  const verdict = r && r.verdict;
  const note = String((verdict === 'pass' ? r.good : r && r.note) || '').trim();
  const tag = verdict === 'pass'
    ? html`<span class="funnel-verdict is-pass"><${Icon} name="check" size=${14} />Good</span>`
    : verdict === 'fail'
      ? html`<span class="funnel-verdict is-fail"><${Icon} name="x" size=${14} />Problem</span>`
      : html`<span class="funnel-verdict">Not reviewed</span>`;
  return html`<li>
    <button type="button" class="funnel-trace" onClick=${() => onGo(id)}>
      <span class="funnel-trace-top">
        ${tag}
        <span class="funnel-trace-title">${(trace && trace.title) || id}</span>
        <span class="funnel-trace-go"><${Icon} name="arrow-right" size=${14} /></span>
      </span>
      ${note && html`<span class="funnel-trace-note">${note}</span>`}
      <span class="funnel-trace-id">${id}</span>
    </button>
  </li>`;
}

function DrawerBody({ project, spec, onClose }) {
  const [limit, setLimit] = useState(DRAWER_PAGE);
  const norm = lib.normalizeAll(project);
  const ids = spec.ids || EMPTY;
  const go = (id) => {
    onClose();
    openInReview(id, spec.filter);
  };
  return html`<div class="funnel-drawer-body">
    <p class="funnel-drawer-lead">${spec.lead}</p>
    ${ids.length > 0 && spec.filter && html`<div class="funnel-drawer-actions">
      <${Button} kind="primary" icon="arrow-right" onClick=${() => go(ids[0])}>Review ${ids.length === 1 ? 'this trace' : `these ${formatCount(ids.length)} traces`}<//>
      ${spec.modeId && html`<${Button} kind="ghost" onClick=${() => { onClose(); navigate('modes'); }}>Open in Failure modes<//>`}
    </div>`}
    ${ids.length
      ? html`<ul class="funnel-trace-list">
        ${ids.slice(0, limit).map((id) => html`<${TraceRow} key=${id} project=${project} id=${id} trace=${norm.get(id)} onGo=${go} />`)}
      </ul>`
      : html`<p class="funnel-drawer-empty">No traces here yet.</p>`}
    ${ids.length > limit && html`<div class="funnel-drawer-more">
      <span class="hint">Showing ${formatCount(limit)} of ${formatCount(ids.length)}</span>
      <${Button} kind="secondary" size="sm" onClick=${() => setLimit(limit + DRAWER_PAGE)}>Show ${Math.min(DRAWER_PAGE, ids.length - limit)} more<//>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// What to fix first

const COLUMNS = [
  { key: 'name', label: 'Failure mode' },
  { key: 'stage', label: 'Stage' },
  { key: 'traces', label: 'Traces', num: true },
  { key: 'share', label: 'Share', num: true },
  { key: 'severity', label: 'Severity' },
  { key: 'priority', label: 'Priority', num: true, note: 'traces x severity (Blocks 3, Hurts 2, Annoys 1)' },
  { key: 'decision', label: 'Decision' },
  { key: 'check', label: 'Check' },
];

const SORTERS = {
  name: (r) => r.mode.name.toLowerCase(),
  stage: (r) => (Number.isFinite(r.stageIndex) ? r.stageIndex : 999),
  traces: (r) => r.traces,
  share: (r) => r.share || 0,
  severity: (r) => SEVERITY_RANK[r.mode.severity] || 0,
  priority: (r) => r.priority,
  decision: (r) => (r.mode.decision in DECISION_RANK ? DECISION_RANK[r.mode.decision] : 9),
  check: (r) => (r.checks.length ? (r.checks.some((c) => c.type === 'judge') ? 2 : 1) : 0),
};

function sortRows(rows, sort) {
  const get = SORTERS[sort.key] || SORTERS.priority;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = get(a.r);
    const y = get(b.r);
    if (x !== y) return (x < y ? -1 : 1) * dir;
    return a.i - b.i;
  }).map((x) => x.r);
}

function CheckCell({ row, rates }) {
  if (!row.checks.length) {
    return html`<div class="funnel-check-none">
      <span class="muted">None</span>
      <a class="funnel-link" href=${hashFor('checks', row.mode.id)}>Build one</a>
    </div>`;
  }
  return html`<ul class="funnel-check-list">
    ${row.checks.map((c) => {
      const a = rates.get(c.id);
      const judge = c.type === 'judge';
      return html`<li key=${c.id}>
        <a class="funnel-check-link" href=${hashFor('checks', c.id)}>
          <${Icon} name=${judge ? 'judge' : 'code'} size=${14} />${judge ? 'AI judge' : 'Code check'}
        </a>
        ${a
          ? html`<span class="funnel-check-rates" title=${`Catches real failures: ${a.tn} of ${a.tn + a.fp}. Agrees on good traces: ${a.tp} of ${a.tp + a.fn}.`}>
            <span>Catches real failures <strong>${lib.pct(a.catchesFailures)}</strong></span>
            <span>Agrees on good traces <strong>${lib.pct(a.agreesOnGood)}</strong></span>
            ${a.where && html`<span class="funnel-check-where">${a.where}</span>`}
          </span>`
          : html`<span class="funnel-check-rates is-unknown">Not measured yet</span>`}
      </li>`;
    })}
  </ul>`;
}

function FixedCell({ mode }) {
  if (mode.fixedAt) {
    return html`<div class="funnel-fixed">
      <span class="funnel-fixed-tag"><${Icon} name="check" size=${14} />Fixed ${formatDay(mode.fixedAt)}</span>
      <${Button} kind="ghost" size="sm" onClick=${() => updateProject((p) => lib.updateMode(p, mode.id, { fixedAt: null }), 'unmark fixed')}
        title=${`Mark ${mode.name} as not fixed`}>Undo<//>
    </div>`;
  }
  return html`<${Button} kind="ghost" size="sm" icon="check" class="funnel-mark-fixed"
    onClick=${() => updateProject((p) => lib.updateMode(p, mode.id, { fixedAt: new Date().toISOString() }), 'mark fixed')}
    aria-label=${`Mark ${mode.name} fixed`}>Mark fixed<//>`;
}

function PriorityTable({ project, version }) {
  const [sort, setSort] = useState({ key: 'priority', dir: 'desc' });
  const experience = project.experience;
  const rows = useMemo(() => lib.priorityTable(project), [project.reviews, project.modes, project.checks, project.experience, project.traces]);
  const rates = useMemo(() => {
    const m = new Map();
    for (const c of project.checks || EMPTY) {
      const a = checkRates(project, c);
      if (a) m.set(c.id, a);
    }
    return m;
  }, [project.checks, project.labels, project.reviews, project.splits, project.modes, project.traces]);
  const sorted = sortRows(rows, sort);
  const severityOptions = lib.SEVERITIES.map((s) => ({ value: s.id, label: s.short }));
  const decisionOptions = lib.DECISIONS.map((d) => ({ value: d.id, label: d.label }));
  const setSortKey = (key) => setSort((cur) => (cur.key === key
    ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'name' || key === 'stage' || key === 'decision' ? 'asc' : 'desc' }));

  return html`<section class="funnel-section card" aria-labelledby="funnel-fix-title" id="funnel-fix">
    <div class="funnel-section-head">
      <div>
        <h2 class="funnel-h2" id="funnel-fix-title">What to fix first</h2>
        <p class="funnel-section-lead">${lib.withUser('Priority weighs how often a failure mode happens by how badly it hurts the {userLabel}. The most common one is not always the one to fix first.', experience)}</p>
      </div>
      ${version != null && rows.length > 0 && html`<span class="hint funnel-all-versions">Counts here include every version.</span>`}
    </div>
    ${rows.length === 0
      ? html`<div class="funnel-inline-empty">
        <p>No failure modes yet. Group your notes into failure modes to rank them here.</p>
        <${Button} kind="primary" icon="arrow-right" onClick=${() => navigate('modes')}>Next: Failure modes<//>
      </div>`
      : html`<div class="table-wrap funnel-table-wrap">
        <table class="table funnel-table">
          <caption class="sr-only">What to fix first, sorted by ${COLUMNS.find((c) => c.key === sort.key).label.toLowerCase()}</caption>
          <thead>
            <tr>
              ${COLUMNS.map((c) => html`<th key=${c.key} scope="col" class=${classes(c.num && 'num', 'funnel-th-' + c.key)}
                aria-sort=${sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" class="th-button" onClick=${() => setSortKey(c.key)}>
                  ${c.label}
                  <span class=${classes('funnel-sort', sort.key === c.key && 'is-on', sort.key === c.key && sort.dir === 'asc' && 'is-asc')} aria-hidden="true"><${Icon} name="chevron-down" size=${12} /></span>
                </button>
                ${c.note && html`<span class="funnel-th-note">${c.note}</span>`}
              </th>`)}
            </tr>
          </thead>
          <tbody>
            ${sorted.map((r) => {
              const m = r.mode;
              const suggested = !m.decision ? lib.suggestedDecision(m) : null;
              const suggestedLabel = suggested ? lib.DECISIONS.find((d) => d.id === suggested).label : '';
              return html`<tr key=${m.id} class=${classes(m.fixedAt && 'is-fixed')}>
                <th scope="row" class="funnel-td-name" data-label="Failure mode">${m.name}</th>
                <td data-label="Stage">${m.stage
                  ? html`<span class="funnel-stage"><span class="stage-num">${lib.stageNumber(experience, m.stage)}</span><span>${lib.stageLabel(experience, m.stage)}</span></span>`
                  : html`<span class="muted">No stage</span>`}</td>
                <td class="num" data-label="Traces">${formatCount(r.traces)}</td>
                <td class="num" data-label="Share">${lib.pct(r.share)}</td>
                <td data-label="Severity" class=${'funnel-sev is-' + (m.severity || 'none')}>
                  <${Segmented} label=${`Severity of ${m.name}`} value=${m.severity || null} options=${severityOptions}
                    onChange=${(v) => updateProject((p) => lib.updateMode(p, m.id, { severity: v }), 'severity')} />
                  ${!m.severity && html`<span class="funnel-cell-hint">Not set: counts as Annoys</span>`}
                </td>
                <td class="num funnel-priority" data-label="Priority"><span class="funnel-priority-num">${formatCount(r.priority)}</span></td>
                <td data-label="Decision" class="funnel-decision">
                  <${Segmented} label=${`Decision for ${m.name}`} value=${m.decision || null} options=${decisionOptions}
                    onChange=${(v) => updateProject((p) => lib.updateMode(p, m.id, { decision: v }), 'decision')} />
                  <div class="funnel-decision-foot">
                    ${suggestedLabel && html`<span class="funnel-cell-hint">Suggested: ${suggestedLabel}</span>`}
                    <${FixedCell} mode=${m} />
                  </div>
                </td>
                <td data-label="Check"><${CheckCell} row=${r} rates=${rates} /></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <p class="funnel-severity-key">${lib.SEVERITIES.map((s, i) => html`<span key=${s.id}>${i ? ` ${DOT} ` : ''}<strong>${s.short}</strong>: ${lib.withUser(s.label, experience)}</span>`)}<span class="funnel-key-priority">. <strong>Priority</strong>: traces x severity (Blocks 3, Hurts 2, Annoys 1)</span></p>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// Coverage

const COVERAGE_ROWS = 12;

function Coverage({ project }) {
  const cov = useMemo(() => lib.coverage(project), [project.traces, project.reviews, project.experience]);
  const keys = Object.keys(cov).filter((k) => cov[k].length);
  return html`<section class="funnel-section card" aria-labelledby="funnel-cov-title">
    <div class="funnel-section-head">
      <div>
        <h2 class="funnel-h2" id="funnel-cov-title">Coverage</h2>
        <p class="funnel-section-lead">How many traces you reviewed for each detail value. Gaps show where to read next.</p>
      </div>
    </div>
    ${keys.length === 0
      ? html`<div class="funnel-inline-empty">
        <p>Coverage shows up when your traces have details to filter on, such as channel or persona. Pick them in Set up.</p>
        <${Button} kind="secondary" onClick=${() => navigate('setup')}>Open Set up<//>
      </div>`
      : html`<div class="funnel-cov-grid">
        ${keys.map((k) => {
          const rows = cov[k];
          const shown = rows.slice(0, COVERAGE_ROWS);
          return html`<div class="funnel-cov-group" key=${k}>
            <h3 class="funnel-cov-key">${capital(k)}</h3>
            <ul class="funnel-cov-list">
              ${shown.map((r) => html`<li key=${r.value} class="funnel-cov-row">
                <span class="funnel-cov-value" title=${r.value}>${r.value}</span>
                <span class="funnel-cov-bar" aria-hidden="true">
                  <span class="funnel-cov-fill" style=${{ width: `${r.total ? (r.reviewed / r.total) * 100 : 0}%` }}></span>
                </span>
                <span class="funnel-cov-text"><span class="sr-only">${r.value}: </span>${formatCount(r.reviewed)} of ${formatCount(r.total)} reviewed</span>
              </li>`)}
            </ul>
            ${rows.length > shown.length && html`<p class="hint">and ${plural(rows.length - shown.length, 'more value')}</p>`}
          </div>`;
        })}
      </div>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// The page

function useWidth(el) {
  const [width, setWidth] = useState(() => Math.max(320, Math.min(1200, typeof innerWidth === 'number' ? innerWidth : 1200) - 96));
  useLayoutEffect(() => {
    if (!el) return undefined;
    setWidth(Math.round(el.clientWidth));
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

function VersionFilter({ versions, value, onChange }) {
  const options = [{ value: null, label: 'All versions' }, ...versions.map((v) => ({ value: v, label: v }))];
  if (options.length <= 4) {
    return html`<div class="funnel-version">
      <span class="label" id="funnel-version-label">Version</span>
      <${Segmented} label="Version" options=${options} value=${value} onChange=${onChange} />
    </div>`;
  }
  return html`<label class="funnel-version">
    <span class="label">Version</span>
    <select class="select" value=${value == null ? '' : value} onChange=${(e) => onChange(e.currentTarget.value || null)}>
      ${options.map((o) => html`<option key=${String(o.value)} value=${o.value == null ? '' : o.value}>${o.label}</option>`)}
    </select>
  </label>`;
}

function FunnelPage({ project }) {
  const experience = project.experience;
  const versions = lib.traceVersions(project);
  const [version, setVersionState] = useState(() => (lastVersion != null && versions.includes(lastVersion) ? lastVersion : null));
  const setVersion = (v) => {
    lastVersion = v;
    setVersionState(v);
  };
  const activeVersion = versions.length >= 2 && versions.includes(version) ? version : null;
  const [req, setReq] = useState(null);
  const [box, setBox] = useState(null);
  const width = useWidth(box);

  const stats = useMemo(() => lib.reviewStats(project), [project.reviews, project.traces]);
  const funnel = useMemo(() => lib.computeFunnel(project, { version: activeVersion }), [project, activeVersion]);
  const stageCount = funnel.stages.length;
  const layoutWidth = Math.max(300 + Math.max(1, stageCount) * MIN_COLUMN, width);
  const layout = useMemo(() => lib.funnelLayout(funnel, { width: layoutWidth, legend: false, footer: null, unit: TRACE_UNIT }), [funnel, layoutWidth]);
  const showReached = useMemo(() => new Set(((experience && experience.stages) || EMPTY).filter(hasRules).map((s) => s.id)), [experience]);
  const loose = useMemo(() => lib.unassignedNotes(project, 'failure').length, [project.reviews, project.modes, project.traces]);
  const spec = useMemo(() => {
    if (!req) return null;
    try {
      return drawerSpec(project, funnel, traceGroups(project, funnel, activeVersion), req, activeVersion);
    } catch {
      return null;
    }
  }, [req, project, funnel, activeVersion]);
  const compact = width < COMPACT_BELOW;
  const emptyText = activeVersion != null
    ? 'Review traces from this version to see where they go wrong.'
    : 'Every reviewed trace is marked Not a product problem, so nothing is counted yet.';
  const scrolls = !compact && layout.width > width + 1;

  if (stats.reviewed < 10) {
    return html`<section class="page funnel" aria-labelledby="funnel-title">
      <header class="funnel-head">
        <div class="funnel-head-text">
          <h1 class="page-title" id="funnel-title">Funnel</h1>
          <p class="page-lead">See the stage where each failing trace went wrong first, and what to fix first.</p>
        </div>
      </header>
      <div class="card funnel-empty-card">
        <${EmptyState} icon="stage" title="The funnel fills in as you review"
          body=${lib.withUser(`Review at least 10 traces and group your notes to see where {userLabel}s drop off. You have reviewed ${formatCount(stats.reviewed)}.`, experience)}
          action=${{ label: 'Next: Review traces', onClick: () => navigate('review') }} />
      </div>
    </section>`;
  }

  const svgText = () => lib.funnelSvg(funnel, {
    theme: 'light',
    width: 1200,
    title: 'The funnel of an AI experience',
    subtitle: `${project.name ? project.name + ': ' : ''}${plural(funnel.counted, 'reviewed trace')}${activeVersion != null ? ` in ${activeVersion}` : ''}`,
  });

  return html`<section class="page funnel" aria-labelledby="funnel-title">
    <header class="funnel-head">
      <div class="funnel-head-text">
        <h1 class="page-title" id="funnel-title">Funnel</h1>
        <p class="page-lead">See the stage where each failing trace went wrong first, and what to fix first.</p>
      </div>
      <div class="funnel-head-tools">
        ${versions.length >= 2 && html`<${VersionFilter} versions=${versions} value=${activeVersion} onChange=${setVersion} />`}
        <${DownloadButton} filename=${`${project.id}-funnel.svg`} getText=${svgText} type="image/svg+xml" label="Download funnel image (.svg)" />
      </div>
    </header>

    ${loose > 0 && html`<div class="funnel-note" role="note">
      <${Icon} name="note" />
      <p>${`${plural(loose, 'Problem note is', 'Problem notes are')} not in a failure mode yet. Until you group ${loose === 1 ? 'it, it counts' : 'them, they count'} at the stage you picked in Review traces, or under Unknown stage.`}</p>
      <${Button} kind="secondary" size="sm" onClick=${() => navigate('modes')}>Group ${loose === 1 ? 'it' : 'them'}<//>
    </div>`}

    <figure class="funnel-figure card">
      <div class="funnel-figure-head">
        <div>
          <h2 class="funnel-h2">The funnel of an AI experience</h2>
          <p class="funnel-figure-sub">${funnel.counted === 0
            ? (activeVersion != null ? `No reviewed traces in ${activeVersion} yet.` : 'No counted traces yet.')
            : `${plural(funnel.counted, 'reviewed trace')}${activeVersion != null ? ` in ${activeVersion}` : ''}, left to right through each stage.${funnel.ignored > 0 ? ` ${plural(funnel.ignored, 'trace')} marked Not a product problem ${funnel.ignored === 1 ? 'is' : 'are'} left out.` : ''}`}</p>
        </div>
        <${Legend} />
      </div>
      ${stageCount === 0
        ? html`<div class="funnel-inline-empty">
          <p>This project has no stages yet. Name the stages of your product in Set up to see where traces go wrong.</p>
          <${Button} kind="primary" icon="arrow-right" onClick=${() => navigate('setup')}>Next: Set up<//>
        </div>`
        : html`${scrolls && html`<p class="hint funnel-scroll-hint"><${Icon} name="arrow-right" size=${14} /> Scroll sideways to see every stage.</p>`}
        <div class=${classes('funnel-scroll', scrolls && 'is-scrolling')} ref=${setBox} tabindex=${scrolls ? 0 : undefined}
          role=${scrolls ? 'region' : undefined} aria-label=${scrolls ? 'Funnel, scrolls sideways' : undefined}>
          ${compact
            ? html`<${MobileFunnel} layout=${layout} funnel=${funnel} showReached=${showReached} open=${setReq} emptyText=${emptyText} />`
            : html`<${FunnelChart} layout=${layout} funnel=${funnel} showReached=${showReached} open=${setReq} emptyText=${emptyText} />`}
        </div>
        <p class="sr-only">${lib.funnelDescription(funnel, TRACE_UNIT)}</p>`}
      <figcaption class="funnel-caption">Each failing trace is counted once, at the first stage that went wrong. ${compact ? 'Select any stage, mode, or count' : 'Select any label'} to see its traces.</figcaption>
    </figure>

    <${PriorityTable} project=${project} version=${activeVersion} />
    <${Coverage} project=${project} />

    <div class="funnel-next">
      <p>Turn the failure modes you decided to check into checks you can trust.</p>
      <${Button} kind="primary" icon="arrow-right" onClick=${() => navigate('checks')}>Next: Checks<//>
    </div>

    <${Drawer} open=${!!spec} title=${spec ? spec.title : ''} onClose=${() => setReq(null)} class="funnel-drawer">
      ${spec && html`<${DrawerBody} key=${JSON.stringify(req)} project=${project} spec=${spec} onClose=${() => setReq(null)} />`}
    <//>
  </section>`;
}

/** The Funnel tab. */
export default function FunnelView() {
  const project = useStore((s) => s.project);
  if (!project) return null;
  return html`<${RendererBoundary} fallback=${(error, reset) => html`<${ViewError} error=${error} reset=${reset} />`}>
    <${FunnelPage} project=${project} />
  <//>`;
}
