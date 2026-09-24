// Shared pieces for trace views (SPEC 4). Custom views import this file as 'pmstack/renderers/common'.
//
// Every step component takes the step plus the view props it was given:
//   { trace, experience, showHidden, pickedStepId, onPickStep, highlights, stepBadges, retrieval, onRetrieval, compact }
// so a custom view can write html`<${StepCard} step=${s} ...${props} />`.
// Nothing here sets inner HTML: all trace text is rendered as text nodes.

import { html, useState, useEffect, useMemo, Icon, registerIcon, classes, formatCount, plural } from 'pmstack/ui';
import { stageNumber, stageLabel, userWord } from '../lib/index.mjs';

// ---------------------------------------------------------------------------
// Icons used by trace views (24 x 24 grid, stroked, round caps).

registerIcon('flag', ['M5 21V4', 'M5 4h11l-2 4 2 4H5']);
registerIcon('wrench', ['M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z']);
registerIcon('shield', ['M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z']);
registerIcon('model', ['M8 8h8v8H8z', 'M10 3v3', 'M14 3v3', 'M10 18v3', 'M14 18v3', 'M3 10h3', 'M3 14h3', 'M18 10h3', 'M18 14h3']);
registerIcon('target', ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 12h.01']);
registerIcon('pull', ['M6 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M6 7.5v13', 'M18 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M18 16.5V9a3 3 0 0 0-3-3h-4', 'M13 3.5l-2.5 2.5 2.5 2.5']);
registerIcon('image', ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 16l5-5 4 4 2-2 5 5', 'M15 9h.01']);
registerIcon('pause', ['M9 6v12', 'M15 6v12']);
registerIcon('link', ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1']);

// ---------------------------------------------------------------------------
// Small helpers

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isPrim = (v) => v == null || typeof v !== 'object';

/** Text for any value: strings as they are, everything else as compact structured data. */
export function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Parse a string that looks like structured data; return the input when it does not. */
export function maybeJson(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** The project's user word with a capital: "Patient". */
export function userName(experience) {
  return cap(userWord(experience));
}

/** 65000 ms -> "1:05"; one hour or more -> "1:02:03". */
export function clock(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 420 -> "0.4 s"; 12500 -> "13 s"; 95000 -> "1:35". */
export function duration(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return '';
  if (v < 10000) return (Math.round(v / 100) / 10).toFixed(1) + ' s';
  if (v < 60000) return Math.round(v / 1000) + ' s';
  return clock(v);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Epoch ms -> "2:05 PM" in the reader's time zone. */
export function timeOfDay(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Epoch ms -> "Wed, Sep 9". */
export function dayLabel(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** True for real clock times (epoch ms), false for "seconds from the start" times. */
export function isEpoch(ms) {
  return typeof ms === 'number' && ms > 1e11;
}

/** True when the step is not something the user saw (instructions, tools, searches, AI steps). */
export function isInternal(step) {
  return !step.customerVisible;
}

/** Word count of a text, for email and document footers. */
export function wordCount(text) {
  const m = String(text ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// Step identity helpers

const KIND_INFO = {
  system: { label: 'Instructions', icon: 'doc' },
  tool_call: { label: 'Tool call', icon: 'wrench' },
  tool_result: { label: 'Tool result', icon: 'wrench' },
  tool: { label: 'Tool', icon: 'wrench' },
  retrieval: { label: 'Search', icon: 'search' },
  llm: { label: 'AI step', icon: 'model' },
  handoff: { label: 'Hand off', icon: 'arrow-right' },
  guardrail: { label: 'Built-in check', icon: 'shield' },
  note: { label: 'AI reasoning', icon: 'note' },
  user: { label: 'Message', icon: 'person' },
  assistant: { label: 'Assistant', icon: 'chat' },
  output: { label: 'Output', icon: 'arrow-right' },
};

/** Plain label and icon name for a step kind. */
export function kindInfo(kind) {
  return KIND_INFO[kind] || { label: cap(String(kind || 'Step')), icon: 'agent' };
}

/** True when the step failed (status error, or a result that says so). */
export function isErrorStep(step) {
  if (!step) return false;
  const s = String(step.status ?? '').toLowerCase();
  if (s === 'error' || s === 'failed' || s === 'fail') return true;
  const d = step.data;
  if (isObj(d) && d.error != null && d.error !== false && d.error !== '') return true;
  return false;
}

/** Highlights for one step id: [{ quote, tone }]. */
export function highlightsFor(highlights, stepId) {
  if (!Array.isArray(highlights) || stepId == null) return [];
  return highlights.filter((h) => h && h.stepId === stepId && typeof h.quote === 'string' && h.quote.trim());
}

/** Badges for one step id: [{ tone, text }] from the stepBadges prop. */
export function badgesFor(stepBadges, stepId) {
  const list = stepBadges && stepId != null ? stepBadges[stepId] : null;
  return Array.isArray(list) ? list.filter((b) => b && b.text) : [];
}

/** Attributes every step element carries: data-step-id, picked state, and click focus for touch screens. */
export function stepAttrs(props, stepId, extraClass) {
  const picked = props.pickedStepId != null && props.pickedStepId === stepId;
  return {
    'data-step-id': stepId,
    class: classes('rv-step', picked && 'is-picked', extraClass),
    tabindex: props.onPickStep ? '-1' : undefined,
  };
}

/**
 * Pair each tool call with its result so they draw as one card.
 * Returns items: { type: 'step', step } or { type: 'tool', call, result }.
 */
export function pairSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const resultFor = new Map();
  const used = new Set();
  list.forEach((s, i) => {
    if (s.kind !== 'tool_call' || s.callId == null) return;
    for (let j = i + 1; j < list.length; j++) {
      const r = list[j];
      if (r.kind === 'tool_result' && r.callId === s.callId && !used.has(r.id)) {
        resultFor.set(s.id, r);
        used.add(r.id);
        break;
      }
    }
  });
  const items = [];
  for (const s of list) {
    if (used.has(s.id)) continue;
    if (s.kind === 'tool_call') items.push({ type: 'tool', call: s, result: resultFor.get(s.id) || null });
    else items.push({ type: 'step', step: s });
  }
  return items;
}

/** Step ids inside an item (a tool pair has two). */
export function itemIds(item) {
  if (item.type === 'tool') return item.result ? [item.call.id, item.result.id] : [item.call.id];
  if (item.type === 'hidden') return item.items.flatMap(itemIds);
  return [item.step.id];
}

/** True when the item is not something the user saw. */
export function itemInternal(item) {
  return item.type === 'tool' ? true : isInternal(item.step);
}

/**
 * Group items for drawing: with showHidden false, runs of internal items become
 * { type: 'hidden', items } so they can draw as one "N steps behind the scenes" expander.
 */
export function withHidden(items, showHidden) {
  if (showHidden) return items;
  const out = [];
  for (const it of items) {
    if (itemInternal(it)) {
      const last = out[out.length - 1];
      if (last && last.type === 'hidden') last.items.push(it);
      else out.push({ type: 'hidden', items: [it] });
    } else out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Highlights: mark the first place a quote appears in a step's text.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find a quote in text: exact first, then ignoring case and runs of spaces. Returns { start, end } or null. */
export function findQuote(text, quote) {
  const t = String(text ?? '');
  const q = String(quote ?? '').trim();
  if (!q || !t) return null;
  const i = t.indexOf(q);
  if (i >= 0) return { start: i, end: i + q.length };
  if (q.length > 4000) return null;
  const parts = q.split(/\s+/).filter(Boolean).map(escapeRe);
  if (!parts.length) return null;
  const re = new RegExp(parts.join('\\s+'), 'i');
  const m = re.exec(t);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * A marker places each quote once across several text pieces of one step.
 * mark(text) returns strings and mark elements; left() lists quotes not placed yet.
 */
export function makeMarker(list, extraClass) {
  const pending = (Array.isArray(list) ? list : []).filter((h) => h && typeof h.quote === 'string' && h.quote.trim());
  return {
    mark(text) {
      const t = String(text ?? '');
      if (!pending.length || !t) return [t];
      const found = [];
      for (const h of pending) {
        const r = findQuote(t, h.quote);
        if (r) found.push({ ...r, h });
      }
      if (!found.length) return [t];
      found.sort((a, b) => a.start - b.start);
      const out = [];
      let pos = 0;
      for (const f of found) {
        if (f.start < pos) continue; // overlaps an earlier mark; it may land in a later piece
        if (f.start > pos) out.push(t.slice(pos, f.start));
        const note = f.h.tone === 'note';
        out.push(html`<mark class=${classes('rv-hl', note ? 'rv-hl-note' : 'rv-hl-ai', extraClass)}
          title=${note ? 'Quoted in your note' : 'AI suggestion'}>${t.slice(f.start, f.end)}</mark>`);
        pos = f.end;
        pending.splice(pending.indexOf(f.h), 1);
      }
      if (pos < t.length) out.push(t.slice(pos));
      return out;
    },
    left() {
      return pending.slice();
    },
  };
}

function leftClass(left) {
  if (!left.length) return null;
  return 'rv-hl-block ' + (left[0].tone === 'note' ? 'rv-hl-note' : 'rv-hl-ai');
}

/**
 * Plain text with highlighted quotes. Props: text, highlights ([{ quote, tone }]) or quote and tone.
 * Line breaks and formatting symbols show exactly as typed.
 */
export function Highlightable({ text, highlights, quote, tone = 'ai', class: cls }) {
  const list = Array.isArray(highlights) ? highlights : quote ? [{ quote, tone }] : [];
  const marker = makeMarker(list);
  const parts = marker.mark(String(text ?? ''));
  return html`<span class=${classes('rv-text', leftClass(marker.left()), cls)}>${parts}</span>`;
}

// ---------------------------------------------------------------------------
// Markdown: a safe subset drawn as elements (paragraphs, headings as h4/h5, bold, italics,
// code, lists, quotes, tables, links with http, https, or mailto only). Images show as text.

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const MAX_INLINE = 20000;

const PAT = {
  code: /(`+)([^`\n]|[^`][\s\S]*?[^`])\1(?!`)/g,
  image: /!\[([^\]\n]{0,500})\]\(\s*([^\s)]{0,2000})(?:\s+"[^"\n]*")?\s*\)/g,
  link: /\[([^\]\n]{1,500})\]\(\s*([^\s)]{0,2000})(?:\s+"[^"\n]*")?\s*\)/g,
  auto: /<((?:https?:\/\/|mailto:)[^\s<>]{1,2000})>/g,
  bold: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)/g,
  strike: /~~(?=\S)([\s\S]*?\S)~~/g,
  em: /\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)|(?<![\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w])/g,
  cite: /\[(\d{1,3}(?:\s*,\s*\d{1,3}){0,9})\](?!\()/g,
};
const BASE_PATTERNS = ['code', 'image', 'link', 'auto', 'bold', 'strike', 'em'];

function pushText(out, s, ctx, keepLines) {
  if (!s) return;
  for (const p of ctx.marker.mark(s)) {
    if (typeof p !== 'string' || keepLines) {
      out.push(p);
      continue;
    }
    p.split('\n').forEach((line, i) => {
      if (i) out.push(html`<br />`);
      if (line) out.push(line);
    });
  }
}

function linkNode(label, url, ctx, depth) {
  const u = String(url || '').trim();
  const kids = inline(label, ctx, depth + 1);
  if (SAFE_URL.test(u)) {
    return html`<a class="rv-md-link" href=${u} target="_blank" rel="noopener noreferrer">${kids}</a>`;
  }
  // Other targets (javascript:, relative paths) are shown as text, not linked, so the reviewer can see them.
  return html`<span class="rv-md-badlink">${kids}${u ? html` <span class="rv-md-url">(${u})</span>` : null}</span>`;
}

function token(type, m, ctx, depth) {
  switch (type) {
    case 'code':
      return html`<code class="rv-md-code">${ctx.marker.mark(m[2])}</code>`;
    case 'image':
      return html`<span class="rv-md-img"><${Icon} name="image" size=${14} /><span>Image${m[1] ? ': ' + m[1] : ''}</span>${m[2] ? html` <span class="rv-md-url">${m[2]}</span>` : null}</span>`;
    case 'link':
      return linkNode(m[1], m[2], ctx, depth);
    case 'auto':
      return linkNode(m[1], m[1], ctx, depth);
    case 'bold':
      return html`<strong>${inline(m[1] ?? m[2], ctx, depth + 1)}</strong>`;
    case 'strike':
      return html`<del>${inline(m[1], ctx, depth + 1)}</del>`;
    case 'em':
      return html`<em>${inline(m[1] ?? m[2], ctx, depth + 1)}</em>`;
    case 'cite':
      return ctx.cite ? ctx.cite(m[1].split(',').map((x) => Number(x.trim())), m[0]) : m[0];
    default:
      return m[0];
  }
}

function inline(text, ctx, depth = 0) {
  const out = [];
  const s = String(text ?? '');
  if (depth > 8 || s.length > MAX_INLINE) {
    pushText(out, s, ctx);
    return out;
  }
  const names = ctx.cite ? [...BASE_PATTERNS, 'cite'] : BASE_PATTERNS;
  const cache = new Array(names.length);
  let pos = 0;
  while (pos < s.length) {
    let best = null;
    let bi = -1;
    for (let k = 0; k < names.length; k++) {
      let m = cache[k];
      if (m === undefined || (m && m.index < pos)) {
        const re = PAT[names[k]];
        re.lastIndex = pos;
        m = re.exec(s);
        cache[k] = m;
      }
      if (m && (best === null || m.index < best.index)) {
        best = m;
        bi = k;
      }
    }
    if (!best) break;
    if (best.index > pos) pushText(out, s.slice(pos, best.index), ctx);
    out.push(token(names[bi], best, ctx, depth));
    pos = best.index + Math.max(1, best[0].length);
  }
  if (pos < s.length) pushText(out, s.slice(pos), ctx);
  return out;
}

const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s{0,3}>\s?/;
const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function parseBlocks(src, depth = 0) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const startsBlock = (l) => RE_FENCE.test(l) || RE_HEADING.test(l) || RE_QUOTE.test(l) || RE_LIST.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = RE_FENCE.exec(line))) {
      const fence = m[1];
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence) && lines[i].trim().replace(/[`~]/g, '') === '')) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ t: 'code', lang: m[2].trim(), text: body.join('\n') });
      continue;
    }
    if ((m = RE_HEADING.exec(line))) {
      blocks.push({ t: 'h', level: m[1].length, text: m[2] });
      i++;
      continue;
    }
    if (RE_HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && RE_QUOTE.test(lines[i])) {
        body.push(lines[i].replace(RE_QUOTE, ''));
        i++;
      }
      blocks.push({ t: 'quote', blocks: depth < 4 ? parseBlocks(body.join('\n'), depth + 1) : [{ t: 'p', text: body.join('\n') }] });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && RE_TABLE_SEP.test(lines[i + 1])) {
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(tableRow(lines[i]));
        i++;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if ((m = RE_LIST.exec(line)) && depth < 6) {
      const base = m[1].length;
      const ordered = /\d/.test(m[2]);
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const mm = RE_LIST.exec(l);
        if (mm && mm[1].length <= base + 1) {
          if (/\d/.test(mm[2]) !== ordered) break;
          items.push([mm[3]]);
          i++;
          continue;
        }
        if (!l.trim()) {
          const next = lines[i + 1];
          const nm = next != null ? RE_LIST.exec(next) : null;
          if (next != null && ((nm && nm[1].length <= base + 1 && /\d/.test(nm[2]) === ordered) || /^\s{2,}\S/.test(next))) {
            items[items.length - 1].push('');
            i++;
            continue;
          }
          break;
        }
        if (mm || /^\s+\S/.test(l)) {
          items[items.length - 1].push(l.replace(new RegExp('^\\s{0,' + (base + 4) + '}'), ''));
          i++;
          continue;
        }
        if (!startsBlock(l) && !RE_HR.test(l)) {
          items[items.length - 1].push(l);
          i++;
          continue;
        }
        break;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', start, items: items.map((ls) => parseBlocks(ls.join('\n'), depth + 1)) });
      continue;
    }
    const body = [];
    while (i < lines.length && lines[i].trim() && !(body.length && (startsBlock(lines[i]) || RE_HR.test(lines[i])))) {
      body.push(lines[i]);
      i++;
    }
    blocks.push({ t: 'p', text: body.join('\n') });
  }
  return blocks;
}

const blockCache = new Map();
function blocksOf(text) {
  let b = blockCache.get(text);
  if (!b) {
    b = parseBlocks(text);
    if (blockCache.size > 400) blockCache.clear();
    blockCache.set(text, b);
  }
  return b;
}

function renderBlocks(blocks, ctx, depth = 0) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'h':
        return b.level <= 2
          ? html`<h4 class="rv-md-h" key=${i}>${inline(b.text, ctx)}</h4>`
          : html`<h5 class="rv-md-h rv-md-h5" key=${i}>${inline(b.text, ctx)}</h5>`;
      case 'hr':
        return html`<hr class="rv-md-hr" key=${i} />`;
      case 'code': {
        const out = [];
        pushText(out, b.text, ctx, true);
        return html`<pre class="rv-md-pre" key=${i}><code>${out}</code></pre>`;
      }
      case 'quote':
        return html`<blockquote class="rv-md-quote" key=${i}>${renderBlocks(b.blocks, ctx, depth + 1)}</blockquote>`;
      case 'table':
        return html`<div class="rv-md-table-wrap" key=${i}><table class="rv-md-table">
          <thead><tr>${b.head.map((c, k) => html`<th key=${k} scope="col">${inline(c, ctx)}</th>`)}</tr></thead>
          <tbody>${b.rows.map((r, ri) => html`<tr key=${ri}>${b.head.map((_, k) => html`<td key=${k}>${inline(r[k] ?? '', ctx)}</td>`)}</tr>`)}</tbody>
        </table></div>`;
      case 'ul':
      case 'ol': {
        const items = b.items.map((blocks, k) => {
          const tight = blocks.length === 1 && blocks[0].t === 'p';
          return html`<li key=${k}>${tight ? inline(blocks[0].text, ctx) : renderBlocks(blocks, ctx, depth + 1)}</li>`;
        });
        return b.t === 'ol'
          ? html`<ol class="rv-md-list" start=${b.start !== 1 ? b.start : undefined} key=${i}>${items}</ol>`
          : html`<ul class="rv-md-list" key=${i}>${items}</ul>`;
      }
      default:
        return html`<p class="rv-md-p" key=${i}>${inline(b.text, ctx)}</p>`;
    }
  });
}

/**
 * Safe Markdown. Props: text, highlights ([{ quote, tone }]), cite ((numbers, raw) => element) to draw
 * citation markers like [1], class. Never uses inner HTML.
 */
export function Markdown({ text, highlights, cite, class: cls }) {
  const src = String(text ?? '');
  const marker = makeMarker(highlights);
  const ctx = { marker, cite };
  const nodes = src.length > 400000 ? [src] : renderBlocks(blocksOf(src), ctx);
  return html`<div class=${classes('rv-md', leftClass(marker.left()), cls)}>${nodes}</div>`;
}

// ---------------------------------------------------------------------------
// Long text: show the start with "Show more".

function cutAt(text, limit) {
  const at = Math.max(text.lastIndexOf(' ', limit), text.lastIndexOf('\n', limit));
  return at > limit * 0.6 ? at : limit;
}

/**
 * Long text shown in part with a "Show more" button. render(text) draws the visible part
 * (plain text with highlights by default). It opens by itself when a highlight sits past the cut.
 */
export function LongText({ text, limit = 600, highlights, render, class: cls }) {
  const full = String(text ?? '');
  const long = full.length > limit * 1.25;
  const cut = long ? cutAt(full, limit) : full.length;
  const hidden = long && (highlights || []).some((h) => {
    const r = findQuote(full, h.quote);
    return r && r.end > cut;
  });
  const [open, setOpen] = useState(false);
  const showAll = !long || open || hidden;
  const shown = showAll ? full : full.slice(0, cut).trimEnd() + '…';
  const draw = render || ((t) => html`<${Highlightable} text=${t} highlights=${highlights} />`);
  return html`<div class=${classes('rv-long', cls)}>
    ${draw(shown)}
    ${long && !hidden && html`<button type="button" class="rv-more" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      ${open ? 'Show less' : `Show more (${formatCount(full.length - cut)} more characters)`}
    </button>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Data: labeled key-value views, tables for lists of records, and a pretty raw view.

function tokens(json) {
  const out = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let pos = 0;
  let m;
  while ((m = re.exec(json))) {
    if (m.index > pos) out.push(json.slice(pos, m.index));
    if (m[1]) {
      out.push(html`<span class=${m[2] ? 'rv-j-key' : 'rv-j-str'}>${m[1]}</span>`);
      if (m[2]) out.push(m[2]);
    } else if (m[3]) out.push(html`<span class="rv-j-lit">${m[0]}</span>`);
    else out.push(html`<span class="rv-j-num">${m[0]}</span>`);
    pos = m.index + m[0].length;
  }
  if (pos < json.length) out.push(json.slice(pos));
  return out;
}

/** Pretty, collapsible view of structured data. Props: value, label, open. */
export function JsonBlock({ value, label = 'Raw data', open = false, class: cls }) {
  const parsed = maybeJson(value);
  let text;
  if (typeof parsed === 'string') text = parsed;
  else {
    try {
      text = JSON.stringify(parsed, null, 2) ?? String(parsed);
    } catch {
      text = String(parsed);
    }
  }
  const lines = text.split('\n').length;
  const body = typeof parsed === 'string' || text.length > 120000 ? text : tokens(text);
  return html`<details class=${classes('rv-json', cls)} open=${open}>
    <summary class="rv-json-sum"><${Icon} name="chevron-down" size=${14} /><span>${label}</span><span class="rv-json-count">${plural(lines, 'line')}</span></summary>
    <pre class="rv-json-pre"><code>${body}</code></pre>
  </details>`;
}

function tableKeys(arr) {
  if (arr.length < 2 || !arr.every(isObj)) return null;
  const keys = [];
  for (const o of arr) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
  if (keys.length > 8) return null;
  const ok = arr.every((o) => Object.values(o).every((v) => isPrim(v) || (Array.isArray(v) && v.every(isPrim) && v.length <= 6)));
  return ok ? keys : null;
}

function cell(v) {
  if (v == null) return html`<span class="rv-dv-none">none</span>`;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return html`<span class="rv-dv-lit">${v ? 'yes' : 'no'}</span>`;
  if (typeof v === 'number') return html`<span class="rv-dv-num">${String(v)}</span>`;
  return String(v);
}

function DataTable({ rows, keys, limit = 20 }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return html`<div class="rv-dv-tablewrap">
    <div class="rv-dv-scroll">
      <table class="rv-dv-table">
        <thead><tr>${keys.map((k) => html`<th key=${k} scope="col">${k}</th>`)}</tr></thead>
        <tbody>${shown.map((r, i) => html`<tr key=${i}>${keys.map((k) => html`<td key=${k}>${cell(r[k])}</td>`)}</tr>`)}</tbody>
      </table>
    </div>
    ${rows.length > limit && html`<button type="button" class="rv-more" onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${formatCount(rows.length)} rows`}</button>`}
  </div>`;
}

/**
 * Labeled view of any value: key-value rows for objects, a table for lists of records,
 * chips for short lists, text for strings. Very deep data falls back to the raw view.
 */
export function DataView({ value, depth = 0, limit = 600 }) {
  const v = maybeJson(value);
  if (v == null || v === '') return html`<span class="rv-dv-none">none</span>`;
  if (typeof v === 'string') return html`<${LongText} class="rv-dv-text" text=${v} limit=${limit} />`;
  if (typeof v !== 'object') return cell(v);
  if (Array.isArray(v)) {
    if (!v.length) return html`<span class="rv-dv-none">empty list</span>`;
    if (v.every(isPrim) && v.join(', ').length <= 160) {
      return html`<ul class="rv-dv-tags">${v.map((x, i) => html`<li key=${i}>${cell(x)}</li>`)}</ul>`;
    }
    const keys = tableKeys(v);
    if (keys) return html`<${DataTable} rows=${v} keys=${keys} />`;
    if (depth >= 3) return html`<${JsonBlock} value=${v} label=${plural(v.length, 'item')} />`;
    return html`<ol class="rv-dv-list">
      ${v.slice(0, 50).map((x, i) => html`<li key=${i}><${DataView} value=${x} depth=${depth + 1} /></li>`)}
      ${v.length > 50 && html`<li class="rv-dv-none">and ${formatCount(v.length - 50)} more</li>`}
    </ol>`;
  }
  const entries = Object.entries(v);
  if (!entries.length) return html`<span class="rv-dv-none">empty</span>`;
  if (depth >= 3) return html`<${JsonBlock} value=${v} label=${plural(entries.length, 'field')} />`;
  return html`<dl class="rv-dv">${entries.map(([k, x]) => html`<div class="rv-dv-row" key=${k}>
    <dt>${k}</dt><dd><${DataView} value=${x} depth=${depth + 1} limit=${limit} /></dd>
  </div>`)}</dl>`;
}

/** Compact one-line-per-field arguments: "date  2026-09-25". */
export function ArgList({ value }) {
  const v = maybeJson(value);
  if (v == null || v === '' || (isObj(v) && !Object.keys(v).length)) return html`<span class="rv-dv-none">no details</span>`;
  if (!isObj(v)) return html`<${DataView} value=${v} />`;
  return html`<dl class="rv-args">${Object.entries(v).map(([k, x]) => html`<div class="rv-args-row" key=${k}>
    <dt>${k}</dt><dd>${isPrim(x) ? cell(x) : html`<${DataView} value=${x} depth=${1} limit=${300} />`}</dd>
  </div>`)}</dl>`;
}

// ---------------------------------------------------------------------------
// Step chrome: stage tag, badges, the picked state, and the pick button.

/** Neutral stage tag with number and label: "2 Hand off when needed". */
export function StageTag({ experience, stageId }) {
  if (!stageId) return null;
  let num = null;
  let label = String(stageId);
  try {
    num = stageNumber(experience, stageId);
    if (num != null) label = stageLabel(experience, stageId);
  } catch {
    // Setup incomplete: show the raw id.
  }
  return html`<span class="rv-stage" title=${num != null ? `Stage ${num}: ${label}` : label}>
    ${num != null && html`<span class="rv-stage-num" aria-hidden="true">${num}</span>`}
    <span class="rv-stage-label">${num != null && html`<span class="sr-only">Stage ${num}: </span>`}${label}</span>
  </span>`;
}

/** Badges on a step (SPEC 12.7), for example "Breaks policy: Ask before acting". */
export function StepBadges({ badges }) {
  if (!badges || !badges.length) return null;
  return html`<span class="rv-badges">${badges.map((b, i) => html`<span key=${i} class=${classes('rv-badge', b.tone === 'warn' ? 'rv-badge-warn' : 'rv-badge-bad')}>
    <${Icon} name="warning" size=${13} /><span>${b.text}</span>
  </span>`)}</span>`;
}

/** Tag shown on the picked step. */
export function FirstProblemTag() {
  return html`<span class="rv-first"><${Icon} name="flag" size=${13} /><span>First problem</span></span>`;
}

/** Button that marks a step as the first thing that went wrong. It shows when the step is hovered or focused. */
export function PickButton({ stepId, stageId = null, onPickStep, picked, floating = false, onClick }) {
  const act = onClick || (onPickStep && (() => onPickStep(stepId, stageId ?? null)));
  if (!act || picked) return null;
  return html`<button type="button" class=${classes('rv-pick', floating && 'rv-pick-float')}
    onClick=${(e) => { e.stopPropagation(); act(); }} title="Mark this step as the first thing that went wrong">
    <${Icon} name="flag" size=${14} /><span class="rv-pick-label">First thing that went wrong</span>
  </button>`;
}

/**
 * Stage tag, badges, and the "First problem" tag for one step, in one row.
 * Props: stepId, stageId, plus the view props. children go first (for example a time).
 */
export function StepMeta({ stepId, stageId, experience, pickedStepId, stepBadges, children, class: cls, showStage = true }) {
  const badges = badgesFor(stepBadges, stepId);
  const picked = pickedStepId != null && pickedStepId === stepId;
  const kids = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!kids.length && !(showStage && stageId) && !badges.length && !picked) return null;
  return html`<div class=${classes('rv-meta', cls)}>
    ${kids}
    ${showStage && html`<${StageTag} experience=${experience} stageId=${stageId} />`}
    <${StepBadges} badges=${badges} />
    ${picked && html`<${FirstProblemTag} />`}
  </div>`;
}

/**
 * Label row above an output surface (an email, a document, an answer): icon, label, stage tag,
 * badges, the "First problem" tag, and the pick button. Props: icon, label, step, props, extra.
 */
export function SurfaceLabel({ icon, label, step, props, extra, as: tag = 'div' }) {
  const picked = props.pickedStepId === step.id;
  const Tag = tag;
  return html`<${Tag} class="rv-surface-label">
    ${icon && html`<${Icon} name=${icon} size=${14} />`}<span class="rv-surface-text">${label}</span>
    ${extra}
    <span class="rv-card-tags">
      <${StageTag} experience=${props.experience} stageId=${step.stage} />
      <${StepBadges} badges=${badgesFor(props.stepBadges, step.id)} />
      ${picked && html`<${FirstProblemTag} />`}
    </span>
    <${PickButton} stepId=${step.id} stageId=${step.stage} onPickStep=${props.onPickStep} picked=${picked} />
  <//>`;
}

// ---------------------------------------------------------------------------
// Messages

/**
 * One chat bubble for a user or assistant step. Props: step, side ('them' | 'us'), plain (show
 * formatting symbols as typed), label, limit, plus the view props.
 */
export function MessageBubble(props) {
  const { step, plain = false, label, limit = 1600, onPickStep, meta } = props;
  const side = props.side || (step.kind === 'user' ? 'them' : 'us');
  const hl = highlightsFor(props.highlights, step.id);
  const picked = props.pickedStepId === step.id;
  const speaker = side === 'them' ? userName(props.experience) : 'Assistant';
  return html`<div ...${stepAttrs(props, step.id, classes('rv-msg', 'rv-msg-' + side, plain && 'is-plain'))}>
    ${label ? html`<span class="rv-msg-who">${label}</span>` : html`<span class="sr-only">${speaker}: </span>`}
    <div class="rv-bubble">
      <${LongText} text=${step.text} limit=${limit} highlights=${hl}
        render=${plain ? undefined : (t) => html`<${Markdown} text=${t} highlights=${hl} />`} />
      <${PickButton} stepId=${step.id} stageId=${step.stage} onPickStep=${onPickStep} picked=${picked} floating=${true} />
    </div>
    <${StepMeta} ...${props} stepId=${step.id} stageId=${step.stage} class="rv-msg-meta">${meta}<//>
  </div>`;
}

// ---------------------------------------------------------------------------
// Internal steps: cards

function outputOf(step) {
  const d = step.data;
  if (step.kind === 'tool_result') return d ?? step.text;
  if (isObj(d)) {
    if (d.output !== undefined) return d.output;
    if (d.result !== undefined) return d.result;
    if (d.error != null) return d.error;
    return null;
  }
  return step.kind === 'tool_call' ? null : (step.text || null);
}

function inputOf(step) {
  const d = step.data;
  if (step.kind === 'tool_call') return d ?? step.text;
  if (isObj(d) && d.input !== undefined) return d.input;
  return null;
}

/** Retrieved documents: title, id, match score, and text. */
export function Documents({ docs }) {
  return html`<ol class="rv-docs">${docs.map((d, i) => html`<li class="rv-doc" key=${i}>
    <div class="rv-doc-head">
      <span class="rv-doc-title">${asText(d?.title) || asText(d?.id) || `Document ${i + 1}`}</span>
      ${d?.id != null && html`<code class="rv-doc-id">${asText(d.id)}</code>`}
      ${typeof d?.score === 'number' && html`<span class="rv-doc-score" title="How closely the search matched">match ${d.score.toFixed(2)}</span>`}
    </div>
    ${d?.text != null && html`<${LongText} class="rv-doc-text" text=${asText(d.text)} limit=${280} />`}
  </li>`)}</ol>`;
}

function StatusChip({ step }) {
  if (isErrorStep(step)) return html`<span class="rv-status rv-status-bad"><${Icon} name="x" size=${12} /><span>Error</span></span>`;
  const s = String(step.status ?? '').toLowerCase();
  if (s && !['ok', 'success', 'done', 'pass', 'passed'].includes(s)) return html`<span class="rv-status">${s.replace(/_/g, ' ')}</span>`;
  return null;
}

function GuardrailResult({ value }) {
  const v = maybeJson(value);
  const r = isObj(v) ? String(v.result ?? v.verdict ?? v.status ?? '').toLowerCase() : String(v ?? '').toLowerCase().trim();
  if (r === 'pass' || r === 'passed' || r === 'ok') return html`<span class="rv-status rv-status-good"><${Icon} name="check" size=${12} /><span>Passed</span></span>`;
  if (r === 'fail' || r === 'failed' || r === 'block' || r === 'blocked') return html`<span class="rv-status rv-status-bad"><${Icon} name="x" size=${12} /><span>Failed</span></span>`;
  return null;
}

/** Card header: icon, name, kind, time taken, status, stage, badges, and the pick button. */
export function StepHead({ step, title, kindLabel, icon, props, extra }) {
  const picked = props.pickedStepId === step.id;
  const ms = step.endTime != null && step.time != null ? step.endTime - step.time : null;
  return html`<div class="rv-card-head">
    <span class="rv-card-icon" aria-hidden="true"><${Icon} name=${icon} size=${15} /></span>
    <span class="rv-card-title">
      ${title && html`<span class="rv-card-name">${title}</span>`}
      <span class="rv-card-kind">${kindLabel}</span>
    </span>
    ${extra}
    ${ms != null && ms > 0 && html`<span class="rv-card-time" title="How long this step took">${duration(ms)}</span>`}
    <span class="rv-card-tags">
      <${StatusChip} step=${step} />
      <${StageTag} experience=${props.experience} stageId=${step.stage} />
      <${StepBadges} badges=${badgesFor(props.stepBadges, step.id)} />
      ${picked && html`<${FirstProblemTag} />`}
    </span>
    <${PickButton} stepId=${step.id} stageId=${step.stage} onPickStep=${props.onPickStep} picked=${picked} />
  </div>`;
}

/**
 * Card for one step that is not a chat message: instructions, a search, an AI step,
 * a tool, a hand off, a built-in check, or reasoning. Props: step, title, children, plus the view props.
 */
export function StepCard(props) {
  const { step, children, title } = props;
  const info = kindInfo(step.kind);
  const hl = highlightsFor(props.highlights, step.id);
  const input = inputOf(step);
  const output = outputOf(step);
  const docs = step.kind === 'retrieval' && isObj(step.data) && Array.isArray(step.data.documents) ? step.data.documents : null;
  const err = isErrorStep(step);
  let body = children;
  if (body == null) {
    if (['system', 'note', 'user', 'assistant'].includes(step.kind)) {
      body = html`<${LongText} class="rv-card-text" text=${step.text} limit=${420} highlights=${hl} />`;
    } else {
      const outLabel = err ? 'Error' : step.kind === 'llm' ? 'Wrote' : step.kind === 'guardrail' ? 'Result' : 'Output';
      body = html`
        ${input != null && input !== '' && html`<div class="rv-io">
          <span class="rv-io-label">${step.kind === 'retrieval' ? 'Searched for' : 'Input'}</span>
          <${ArgList} value=${input} />
        </div>`}
        ${docs && html`<div class="rv-io">
          <span class="rv-io-label">Found ${plural(docs.length, 'document')}</span>
          <${Documents} docs=${docs} />
        </div>`}
        ${!docs && output != null && output !== '' && html`<div class=${classes('rv-io', err && 'rv-io-error')}>
          <span class="rv-io-label">${outLabel}${step.kind === 'guardrail' && html` <${GuardrailResult} value=${output} />`}</span>
          ${typeof maybeJson(output) === 'string'
            ? html`<${LongText} class=${classes('rv-card-text', step.kind !== 'llm' && 'is-mono')} text=${output} limit=${420} highlights=${hl} />`
            : html`<${DataView} value=${output} />`}
        </div>`}`;
    }
  }
  const name = title !== undefined ? title : step.kind === 'system' ? null : step.name;
  return html`<div ...${stepAttrs(props, step.id, classes('rv-card', 'rv-card-' + step.kind, err && 'is-error'))}>
    <${StepHead} step=${step} props=${props} icon=${info.icon} title=${name}
      kindLabel=${step.kind === 'user' ? userName(props.experience) : info.label} />
    <div class="rv-card-body">${body}</div>
  </div>`;
}

/**
 * A tool call drawn with its result: the tool name, what it was called with, and what came back.
 * Props: step (the call), result (the result step or null), plus the view props.
 */
export function ToolCall(props) {
  const { step, result, dense = false } = props;
  const rPicked = !!result && props.pickedStepId === result.id;
  const err = isErrorStep(result) || isErrorStep(step);
  const out = result ? (result.data ?? result.text) : null;
  const rhl = result ? highlightsFor(props.highlights, result.id) : [];
  const body = typeof maybeJson(out) === 'string'
    ? html`<${LongText} class="rv-card-text is-mono" text=${out} limit=${dense ? 280 : 420} highlights=${rhl} />`
    : html`<${DataView} value=${out} />`;
  // In a chat thread, bulky results start folded so the conversation stays readable.
  const fold = dense && result && bulky(out) && !rPicked && !rhl.length && !badgesFor(props.stepBadges, result.id).length;
  return html`<div ...${stepAttrs(props, step.id, classes('rv-card', 'rv-tool', err && 'is-error'))}>
    <${StepHead} step=${step} props=${props} icon="wrench" title=${step.name || 'tool'} kindLabel="Tool call" />
    <div class="rv-card-body">
      <div class="rv-io">
        <span class="rv-io-label">Called with</span>
        <${ArgList} value=${step.data ?? step.text} />
      </div>
      ${result
        ? html`<div ...${stepAttrs(props, result.id, classes('rv-io', 'rv-tool-result', isErrorStep(result) && 'rv-io-error'))}>
            <div class="rv-io-head">
              <span class="rv-io-label">${isErrorStep(result) ? 'Returned an error' : 'Returned'}</span>
              <span class="rv-card-tags">
                ${result.stage !== step.stage && html`<${StageTag} experience=${props.experience} stageId=${result.stage} />`}
                <${StepBadges} badges=${badgesFor(props.stepBadges, result.id)} />
                ${rPicked && html`<${FirstProblemTag} />`}
              </span>
              <${PickButton} stepId=${result.id} stageId=${result.stage} onPickStep=${props.onPickStep} picked=${rPicked} />
            </div>
            ${fold
              ? html`<details class="rv-fold"><summary class="rv-fold-sum"><${Icon} name="chevron-down" size=${13} /><span>${summarize(out)}</span></summary>${body}</details>`
              : body}
          </div>`
        : html`<p class="rv-io-none">No result was recorded for this call.</p>`}
    </div>
  </div>`;
}

function bulky(v) {
  const x = maybeJson(v);
  if (x == null) return false;
  if (typeof x === 'string') return x.length > 280;
  if (Array.isArray(x)) return x.length > 3 || JSON.stringify(x).length > 200;
  const n = Object.keys(x).length;
  return n > 5 || JSON.stringify(x).length > 240;
}

function summarize(v) {
  const x = maybeJson(v);
  if (typeof x === 'string') return 'Show the result';
  if (Array.isArray(x)) return `Show the result (${plural(x.length, 'item')})`;
  // A result built around one list reads best by that list's own name: "9 slots".
  const list = Object.entries(x).find(([k, y]) => Array.isArray(y) && y.length > 1 && /^[a-z][a-z ]*s$/i.test(k));
  if (list) return `Show the result (${formatCount(list[1].length)} ${list[0].replace(/_/g, ' ')})`;
  return `Show the result (${plural(Object.keys(x).length, 'field')})`;
}

/** Draw one paired item as a card: a tool call with its result, or any other step. */
export function ItemCard(props) {
  const { item } = props;
  if (item.type === 'tool') return html`<${ToolCall} ...${props} step=${item.call} result=${item.result} />`;
  return html`<${StepCard} ...${props} step=${item.step} />`;
}

/**
 * The "N steps behind the scenes" expander. Props: items (from pairSteps), label, render (item => element),
 * plus the view props. It opens by itself when it holds the picked step or a highlighted step.
 */
export function BehindTheScenes(props) {
  const { items = [], label, render, class: cls } = props;
  const ids = items.flatMap(itemIds);
  const flagged = ids.flatMap((id) => badgesFor(props.stepBadges, id));
  const auto = ids.includes(props.pickedStepId) || ids.some((id) => highlightsFor(props.highlights, id).length > 0);
  const [open, setOpen] = useState(auto);
  useEffect(() => {
    if (auto) setOpen(true);
  }, [auto]);
  const names = [];
  for (const it of items) {
    const n = it.type === 'tool' ? it.call.name : it.step.kind === 'system' ? 'instructions' : it.step.name || kindInfo(it.step.kind).label.toLowerCase();
    if (n && !names.includes(n)) names.push(n);
  }
  const preview = names.slice(0, 4).join(', ') + (names.length > 4 ? ', …' : '');
  return html`<details class=${classes('rv-bts', cls)} open=${open} onToggle=${(e) => setOpen(e.currentTarget.open)}>
    <summary class="rv-bts-sum">
      <${Icon} name="chevron-down" size=${14} />
      <span class="rv-bts-label">${label || `${plural(ids.length, 'step')} behind the scenes`}</span>
      ${preview && html`<span class="rv-bts-names">${preview}</span>`}
      ${flagged.length > 0 && html`<span class=${classes('rv-badge', flagged.some((b) => b.tone !== 'warn') ? 'rv-badge-bad' : 'rv-badge-warn', 'rv-bts-flag')}
        title=${flagged.map((b) => b.text).join('\n')}><${Icon} name="warning" size=${13} /><span>${flagged[0].text}${flagged.length > 1 ? ` (+${flagged.length - 1})` : ''}</span></span>`}
    </summary>
    ${open && html`<div class="rv-bts-body">
      ${items.map((it) => (render ? render(it) : html`<${ItemCard} key=${itemIds(it)[0]} ...${props} class=${undefined} item=${it} />`))}
    </div>`}
  </details>`;
}

// ---------------------------------------------------------------------------
// Steps in order, for views whose main surface is the final output (email, document, answer...).

/**
 * Every step except the ones the view draws itself, in trace order: messages as bubbles, other
 * steps as cards, and internal runs folded into "behind the scenes" when showHidden is false.
 * Props: steps (defaults to trace.steps), skip (a Set of step ids the view draws), plus the view props.
 */
export function StepFlow(props) {
  const { trace, skip, showHidden } = props;
  const steps = (props.steps || trace.steps || []).filter((s) => !(skip && skip.has(s.id)));
  const groups = withHidden(pairSteps(steps), showHidden);
  if (!groups.length) return null;
  const who = userName(props.experience);
  return html`<div class="rv-flow">${groups.map((g) => {
    if (g.type === 'hidden') return html`<${BehindTheScenes} key=${'h' + itemIds(g)[0]} ...${props} items=${g.items} />`;
    if (g.type === 'tool') return html`<${ToolCall} key=${g.call.id} ...${props} step=${g.call} result=${g.result} />`;
    const s = g.step;
    if ((s.kind === 'user' || s.kind === 'assistant') && s.customerVisible) {
      return html`<${MessageBubble} key=${s.id} ...${props} step=${s} label=${s.kind === 'user' ? who : 'Assistant'} />`;
    }
    return html`<${StepCard} key=${s.id} ...${props} step=${s} />`;
  })}</div>`;
}

// ---------------------------------------------------------------------------
// Panels around the trace

/** Detail chips ("channel: sms"). Props: metadata, keys (optional list to show), max. */
export function MetaChips({ metadata, keys, max = 12 }) {
  const m = metadata || {};
  const list = (Array.isArray(keys) && keys.length ? keys : Object.keys(m)).filter((k) => m[k] != null && m[k] !== '').slice(0, max);
  if (!list.length) return null;
  return html`<ul class="rv-metachips" aria-label="Details">${list.map((k) => {
    const v = String(m[k]);
    return html`<li class="rv-metachip" key=${k} title=${`${k}: ${v}`}><span class="rv-metachip-k">${k}</span><span class="rv-metachip-v">${v.length > 48 ? v.slice(0, 46) + '…' : v}</span></li>`;
  })}</ul>`;
}

/** "What the AI was given": the trace's context, collapsed by default. Props: context, open, compact. */
export function ContextPanel({ context, open = false, compact = false }) {
  const list = Array.isArray(context) ? context.filter((c) => c && c.value != null && String(c.value).trim()) : [];
  if (!list.length) return null;
  return html`<details class=${classes('rv-context', compact && 'is-compact')} open=${open}>
    <summary class="rv-context-sum">
      <${Icon} name="chevron-down" size=${14} />
      <span class="rv-context-title">What the AI was given</span>
      <span class="rv-context-labels">${list.map((c) => c.label).join(', ')}</span>
    </summary>
    <div class="rv-context-body">${list.map((c, i) => {
      const v = maybeJson(c.value);
      return html`<section class="rv-context-item" key=${i}>
        <h4 class="rv-context-label">${c.label}</h4>
        ${typeof v === 'string' ? html`<${LongText} class="rv-context-text" text=${v} limit=${700} />` : html`<${DataView} value=${v} />`}
      </section>`;
    })}</div>
  </details>`;
}

/** "What happened as a result": drawn by TraceView after the view. Props: result, compact. */
export function ResultPanel({ result, compact = false }) {
  if (result == null || result === '') return null;
  const v = maybeJson(result);
  return html`<section class=${classes('rv-result', compact && 'is-compact')}>
    <h3 class="rv-result-title"><${Icon} name="target" size=${15} /><span>What happened as a result</span></h3>
    <div class="rv-result-body">
      ${typeof v === 'string' ? html`<${LongText} class="rv-result-text" text=${v} limit=${800} />` : html`<${DataView} value=${v} />`}
    </div>
  </section>`;
}

/** A calm note when a trace has nothing for this view to draw. */
export function EmptyTrace({ children }) {
  return html`<div class="rv-empty"><${Icon} name="doc" size=${18} /><p>${children || 'This trace has no steps to show.'}</p></div>`;
}

/** Memo helper for views: pairs and groups steps once per trace and showHidden value. */
export function useItems(steps, showHidden) {
  return useMemo(() => withHidden(pairSteps(steps || []), showHidden), [steps, showHidden]);
}
