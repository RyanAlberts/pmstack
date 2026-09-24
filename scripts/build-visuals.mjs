#!/usr/bin/env node
// build-visuals.mjs: draws the README and landing page visuals from the pmstack engine.
//
//   node scripts/build-visuals.mjs            write docs/assets/visuals/<name>-light.svg, <name>-dark.svg, <name>.svg,
//                                             and <name>-narrow-*.svg for phones (heading wrapped to fit)
//   node scripts/build-visuals.mjs --check    rebuild in memory; exit 1 if any committed visual differs
//   node scripts/build-visuals.mjs --png      also render docs/assets/og.png (social card, 1200 x 630)
//   node scripts/build-visuals.mjs --screens  also capture docs/assets/screens/<name>-<theme>.png
//   node scripts/build-visuals.mjs --demo     also record docs/assets/screens/demo.gif (needs ffmpeg)
//
// Every number comes from the engine: the funnel and the notes-to-modes ranking from the dental
// booking sample (computeFunnel, priorityTable), the judge visual from
// scripts/visual-data/judge-example.json (agreement, correctedPassRate, bootstrapCorrected, seed 7).
// Writing the SVGs needs nothing but Node 20. --png, --screens, and --demo use Playwright with the
// system Chrome, installed once with: cd tests/e2e && npm install
//
// Each visual is one layout function drawing onto an Svg builder. The builder writes literal colors
// for the light and dark files and CSS variables (with light fallbacks) for the inline version, so
// the three files of a visual can never drift apart. Labels are measured with Helvetica metrics plus
// a safety margin; a label that would not fit its box stops the build with a plain error.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { inflateSync, deflateSync } from 'node:zlib';
import * as lib from '../docs/studio/lib/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VISUALS_DIR = join(ROOT, 'docs', 'assets', 'visuals');
const SCREENS_DIR = join(ROOT, 'docs', 'assets', 'screens');
const OG_PATH = join(ROOT, 'docs', 'assets', 'og.png');
const PLAYWRIGHT = join(ROOT, 'tests', 'e2e', 'node_modules', '@playwright', 'test', 'index.mjs');

// ------------------------------------------------------------------ design tokens (SPEC 5.4)

const TOKENS = {
  light: {
    bg: '#F7F6F2', surface: '#FFFFFF', 'surface-2': '#F0EEE8', ink: '#16191D', 'ink-2': '#4A525C', 'ink-3': '#646B73', line: '#E2DFD8',
    accent: '#3A56D4', 'accent-soft': '#E7EBFB', good: '#1B7851', 'good-soft': '#E3F2EA', bad: '#BE3E29', 'bad-soft': '#FBE7E2',
    warn: '#965F00', 'warn-soft': '#FBF0DC', ai: '#7A4FD1', 'ai-soft': '#F1EAFD',
  },
  dark: {
    bg: '#0F1216', surface: '#171B21', 'surface-2': '#1E232A', ink: '#E9EBEE', 'ink-2': '#A9B1BB', 'ink-3': '#8A929D', line: '#2A3038',
    accent: '#8AA2FF', 'accent-soft': '#1F2747', good: '#4CC38A', 'good-soft': '#14301F', bad: '#FF7A63', 'bad-soft': '#3A1D18',
    warn: '#F0B34A', 'warn-soft': '#33260F', ai: '#B79CFF', 'ai-soft': '#2A2140',
  },
};
const THEMES = ['light', 'dark', 'vars'];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const SEVERITY_WORD = { blocks: 'Blocks', hurts: 'Hurts', annoys: 'Annoys' };
const SEVERITY_COLOR = { blocks: 'bad', hurts: 'warn', annoys: 'ink-2' };
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// ------------------------------------------------------------------ text measuring

// Advance widths (1/1000 em) for ASCII 32..126: Helvetica and Helvetica Bold. Chrome's system font
// on macOS measures within 3% of these; FIT adds room for Segoe UI, Roboto, and Arial.
const REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611,
  722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611,
  722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const FIT = 1.04;

/** Width in px of one line of text; weights of 600 and up use the bold table. */
function measure(text, size, weight = 400, mono = false) {
  const s = String(text);
  if (mono) return s.length * 0.6 * size;
  const table = weight >= 600 ? BOLD : REG;
  let w = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    w += code >= 32 && code <= 126 ? table[code - 32] : ch === '·' ? 278 : 556;
  }
  return (w / 1000) * size;
}

/** Stop the build when a label cannot fit its space. */
function assertFits(text, size, weight, maxWidth, mono = false) {
  const w = measure(text, size, weight, mono) * FIT;
  if (w > maxWidth) throw new Error(`Label "${text}" needs ${Math.ceil(w)}px at ${size}px but has ${Math.floor(maxWidth)}px.`);
  return text;
}

/** Greedy wrap; limits is a width or a per-line list of widths (its length is the line cap, default 2). */
function wrap(text, limits, size, weight = 400) {
  const lim = Array.isArray(limits) ? limits : [limits, limits];
  const lines = [];
  let cur = '';
  for (const word of String(text).split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    const room = lim[Math.min(lines.length, lim.length - 1)];
    if (!cur || measure(next, size, weight) * FIT <= room) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > lim.length) throw new Error(`Label "${text}" needs ${lines.length} lines at ${size}px; ${lim.length} allowed.`);
  lines.forEach((l, i) => assertFits(l, size, weight, lim[i]));
  return lines;
}

/** One line when it fits, else the two-line split with the shortest longer line. */
function wrapBalanced(text, limit, size, weight = 400, { force = false } = {}) {
  if (!force && measure(text, size, weight) * FIT <= limit) return [text];
  const words = String(text).split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(measure(a, size, weight), measure(b, size, weight));
    if (w * FIT <= limit && (!best || w < best.w)) best = { w, lines: [a, b] };
  }
  if (!best) throw new Error(`Label "${text}" does not fit two lines of ${limit}px at ${size}px.`);
  return best.lines;
}

// ------------------------------------------------------------------ SVG builder

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (x) => {
  const v = Math.round(x * 10) / 10;
  return Object.is(v, -0) ? '0' : String(v);
};

class Svg {
  constructor(theme, prefix) {
    this.theme = theme;
    this.prefix = prefix;
    this.parts = [];
  }

  id(key) { return `${this.prefix}-${key}`; }

  color(name) {
    if (!(name in TOKENS.light)) throw new Error(`Unknown color token "${name}".`);
    return this.theme === 'vars' ? `var(--${name}, ${TOKENS.light[name]})` : TOKENS[this.theme][name];
  }

  style({ fill = null, stroke = null, fo = null, so = null } = {}) {
    let s = `fill:${fill ? this.color(fill) : 'none'}`;
    if (fill && fo != null) s += `;fill-opacity:${fo}`;
    if (stroke) s += `;stroke:${this.color(stroke)}`;
    if (stroke && so != null) s += `;stroke-opacity:${so}`;
    return ` style="${s}"`;
  }

  strokeAttrs({ stroke = null, sw = 1, dash = null, cap = null, join = null } = {}) {
    if (!stroke) return '';
    return ` stroke-width="${n(sw)}"${dash ? ` stroke-dasharray="${dash}"` : ''}${cap ? ` stroke-linecap="${cap}"` : ''}${join ? ` stroke-linejoin="${join}"` : ''}`;
  }

  raw(s) { this.parts.push(s); }

  rect(x, y, w, h, o = {}) {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.r ? ` rx="${n(o.r)}"` : ''}${this.style(o)}${this.strokeAttrs(o)}/>`);
  }

  circle(cx, cy, r, o = {}) {
    this.parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${this.style(o)}${this.strokeAttrs(o)}/>`);
  }

  path(d, o = {}) {
    this.parts.push(`<path d="${d}"${this.style(o)}${this.strokeAttrs(o)}/>`);
  }

  line(x1, y1, x2, y2, o = {}) {
    this.path(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, { cap: 'round', ...o });
  }

  runs(line) {
    if (typeof line === 'string') return esc(line);
    return line.map((r) => (typeof r === 'string' ? esc(r)
      : `<tspan${r.weight ? ` font-weight="${r.weight}"` : ''}${r.size ? ` font-size="${r.size}"` : ''}${r.color ? this.style({ fill: r.color }) : ''}>${esc(r.t)}</tspan>`)).join('');
  }

  /** Text: content is a string, or a list of lines; a line is a string or a list of runs { t, weight, color, size }. */
  text(x, y, content, { size = 18, weight = 400, color = 'ink', anchor = 'start', lh = Math.round(size * 1.25), mono = false } = {}) {
    const lines = Array.isArray(content) ? content : [content];
    const head = `<text x="${n(x)}" y="${n(y)}" font-size="${size}"${weight !== 400 ? ` font-weight="${weight}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${mono ? ` font-family="${esc(MONO)}"` : ''}${this.style({ fill: color })}>`;
    const body = lines.length === 1 ? this.runs(lines[0])
      : lines.map((l, i) => `<tspan x="${n(x)}"${i ? ` dy="${lh}"` : ''}>${this.runs(l)}</tspan>`).join('');
    this.parts.push(`${head}${body}</text>`);
  }
}

/**
 * Wrap a drawing into a complete SVG document with title, alt text, and the background card.
 * The narrow version is for phones, where a visual scrolls sideways: its title, subtitle, and
 * legend wrap to fit the first view, and the rest of the drawing moves down to make room.
 */
function svgDocument(visual, theme, { narrow = false } = {}) {
  const name = narrow ? `${visual.name}-narrow` : visual.name;
  const svg = new Svg(theme, `pmv-${name}`);
  svg.narrow = narrow;
  visual.draw(svg);
  const shift = narrow ? svg.shift : 0;
  if (narrow && !(shift >= 0)) throw new Error(`${name}: the narrow version needs a heading and a legend.`);
  const height = visual.height + shift;
  const card = new Svg(theme, svg.prefix);
  card.rect(0.5, 0.5, visual.width - 1, height - 1, { r: 20, fill: 'surface', stroke: 'line' });
  const body = narrow
    ? [...svg.parts.slice(0, svg.contentStart), `<g transform="translate(0 ${n(shift)})">`, ...svg.parts.slice(svg.contentStart), '</g>']
    : svg.parts;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${visual.width} ${n(height)}" width="${visual.width}" height="${n(height)}" role="img" aria-labelledby="${svg.id('title')} ${svg.id('desc')}" font-family="${esc(FONT)}">`;
  const out = [head, `<title id="${svg.id('title')}">${esc(visual.title)}</title>`, `<desc id="${svg.id('desc')}">${esc(visual.desc)}</desc>`, ...card.parts, ...body, '</svg>', ''].join('\n');
  lintSvg(name, theme, out);
  return out;
}

/** SPEC 9 rules for every generated file. */
function lintSvg(name, theme, text) {
  const where = `${name} (${theme})`;
  const dash = String.fromCharCode(0x2014);
  const enDash = String.fromCharCode(0x2013);
  if (text.includes(dash) || text.includes(enDash)) throw new Error(`${where}: contains a long dash.`);
  for (const word of ['LLM', 'TPR', 'TNR', 'CI']) if (text.includes(word)) throw new Error(`${where}: contains "${word}".`);
  if (new RegExp(['hon', 'est'].join(''), 'i').test(text)) throw new Error(`${where}: contains a banned word.`);
  if (/<script|foreignObject|href=/i.test(text)) throw new Error(`${where}: scripts, foreignObject, and links are not allowed.`);
  if (Buffer.byteLength(text) > 60 * 1024) throw new Error(`${where}: ${Buffer.byteLength(text)} bytes; the limit is 60 KB.`);
}

// ------------------------------------------------------------------ shared marks (one legend grammar)

const GLYPH_WIDTH = { success: 28, failure: 10, check: 30, person: 16, sparkle: 18, start: 32 };

/** Draw a legend glyph with its left edge at x, vertically centered on cy. */
function glyph(svg, kind, x, cy) {
  if (kind === 'success') svg.rect(x, cy - 8, 28, 16, { r: 8, fill: 'good-soft', stroke: 'good', sw: 1.5 });
  else if (kind === 'failure') svg.path(dropPath(x, cy), { fill: 'bad' });
  else if (kind === 'check') svg.rect(x, cy - 8, 30, 16, { r: 8, fill: 'surface-2', stroke: 'ink-3', sw: 1.3 });
  else if (kind === 'person') person(svg, x + 8, cy, 'accent');
  else if (kind === 'sparkle') sparkle(svg, x + 9, cy, 9, 'ai');
  else if (kind === 'start') {
    svg.circle(x + 16, cy, 16, { fill: 'bad-soft' });
    svg.circle(x + 16, cy, 9, { fill: 'bad' });
  }
}

/** The failure mark: a red drop, the same glyph as the live funnel's legend in Eval Studio. */
function dropPath(x, cy) {
  const w = GLYPH_WIDTH.failure;
  return `M${n(x)} ${n(cy - 9)}h${n(w)}v13a${n(w / 2)} ${n(w / 2)} 0 0 1 ${n(-w)} 0Z`;
}

function person(svg, cx, cy, color, s = 1) {
  svg.circle(cx, cy - 4.6 * s, 3.8 * s, { fill: color });
  svg.path(`M${n(cx - 7 * s)} ${n(cy + 8 * s)}a${n(7 * s)} ${n(6.6 * s)} 0 0 1 ${n(14 * s)} 0z`, { fill: color });
}

function sparkle(svg, cx, cy, r, color) {
  const k = r * 0.2;
  svg.path(`M${n(cx)} ${n(cy - r)}Q${n(cx + k)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}Q${n(cx + k)} ${n(cy + k)} ${n(cx)} ${n(cy + r)}`
    + `Q${n(cx - k)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}Q${n(cx - k)} ${n(cy - k)} ${n(cx)} ${n(cy - r)}Z`, { fill: color });
}

// The narrow version's heading and legend fit in this width, starting at x 32: what a 360 px wide
// phone shows of a visual drawn 760 px wide, before the reader scrolls sideways.
const NARROW_WIDTH = 470;

/** Legend in the top right: items [{ glyph, label }], right-aligned at `right`, text baseline `y`. */
function legend(svg, items, right, y) {
  if (svg.narrow) {
    // Under the heading, from the left edge. The drawing below moves down by the height the
    // wrapped heading and the legend add, so it keeps its distance from the text above it.
    const ly = svg.headEnd + 40;
    let x = 32;
    for (const it of items) {
      glyph(svg, it.glyph, x, ly - 6);
      x += GLYPH_WIDTH[it.glyph] + 10;
      svg.text(x, ly, it.label, { color: 'ink-2' });
      x += measure(it.label, 18) * FIT + 30;
    }
    if (x - 30 > 32 + NARROW_WIDTH) throw new Error(`The legend "${items.map((it) => it.label).join(', ')}" is too wide for the narrow version.`);
    svg.shift = ly + 12 - 102;
    svg.contentStart = svg.parts.length;
    return 32;
  }
  let x = right;
  const placed = [];
  for (const it of [...items].reverse()) {
    x -= measure(it.label, 18);
    const tx = x;
    x -= 10 + GLYPH_WIDTH[it.glyph];
    placed.push({ ...it, gx: x, tx });
    x -= 30;
  }
  for (const p of placed) {
    glyph(svg, p.glyph, p.gx, y - 6);
    svg.text(p.tx, y, p.label, { color: 'ink-2' });
  }
  return x + 30;
}

/** One or two lines within NARROW_WIDTH, split between sentences when both fit, else balanced. */
function narrowLines(text, size, weight = 400) {
  const fits = (s) => measure(s, size, weight) * FIT <= NARROW_WIDTH;
  if (fits(text)) return [text];
  const at = text.indexOf('. ');
  if (at > 0 && fits(text.slice(0, at + 1)) && fits(text.slice(at + 2))) return [text.slice(0, at + 1), text.slice(at + 2)];
  return wrapBalanced(text, NARROW_WIDTH, size, weight);
}

/** Title and subtitle, top left. The narrow version wraps each one to fit NARROW_WIDTH. */
function heading(svg, title, subtitle, x = 32) {
  if (!svg.narrow) {
    svg.text(x, 68, title, { size: 40, weight: 700 });
    if (subtitle) svg.text(x, 102, subtitle, { size: 22, color: 'ink-2' });
    return;
  }
  const lines = narrowLines(title, 40, 700);
  svg.text(x, 68, lines, { size: 40, weight: 700, lh: 46 });
  let y = 68 + 46 * (lines.length - 1);
  if (subtitle) {
    const sub = narrowLines(subtitle, 22);
    y += 34;
    svg.text(x, y, sub, { size: 22, color: 'ink-2', lh: 28 });
    y += 28 * (sub.length - 1);
  }
  svg.headEnd = y;
}

/** A filled arrowhead with its tip at (x, y) pointing in direction dir. */
function arrowHead(svg, x, y, dir, color = 'ink-3', size = 9) {
  const v = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }[dir];
  const bx = x - v[0] * size;
  const by = y - v[1] * size;
  const px = -v[1] * size * 0.55;
  const py = v[0] * size * 0.55;
  svg.path(`M${n(x)} ${n(y)}L${n(bx + px)} ${n(by + py)}L${n(bx - px)} ${n(by - py)}Z`, { fill: color });
}

/** A number badge: dark circle with the number in the surface color. */
function badge(svg, cx, cy, label, r = 13) {
  svg.circle(cx, cy, r, { fill: 'ink' });
  svg.text(cx, cy + 6.3, String(label), { size: 18, weight: 700, color: 'surface', anchor: 'middle' });
}

/** A neutral check pill (or a dashed "no check" pill), left edge x, top y. Returns its width. */
function pill(svg, x, y, label, { dashed = false, h = 34, center = false } = {}) {
  const w = measure(label, 18, dashed ? 500 : 600) * FIT + 32;
  const left = center ? x - w / 2 : x;
  if (dashed) svg.rect(left, y, w, h, { r: h / 2, stroke: 'ink-3', sw: 1.4, dash: '5 4' });
  else svg.rect(left, y, w, h, { r: h / 2, fill: 'surface-2', stroke: 'ink-3', so: 0.55, sw: 1.2 });
  svg.text(left + w / 2, y + h / 2 + 6.3, label, { weight: dashed ? 500 : 600, color: dashed ? 'ink-2' : 'ink', anchor: 'middle' });
  return w;
}

// ------------------------------------------------------------------ data

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadData() {
  const clinic = readJson('docs/studio/samples/clinic-booking.json');
  const funnel = lib.computeFunnel(clinic);
  const priority = lib.priorityTable(clinic);
  const modes = new Map((clinic.modes || []).map((m) => [m.id, m]));
  const judge = readJson('scripts/visual-data/judge-example.json');
  const agree = lib.agreement(judge.testPairs);
  const observedPassRate = judge.unlabeledVerdicts.filter((v) => v === 'pass').length / judge.unlabeledVerdicts.length;
  const corrected = lib.correctedPassRate({ observedPassRate, agreesOnGood: agree.agreesOnGood, catchesFailures: agree.catchesFailures });
  const boot = lib.bootstrapCorrected({ testPairs: judge.testPairs, unlabeledVerdicts: judge.unlabeledVerdicts, iterations: 2000, seed: 7 });
  const rate = lib.asFailureRate({ observedPassRate, estimate: corrected, low: boot.low, high: boot.high });
  if (rate.low == null || rate.high == null) throw new Error(`The judge example has no range: ${boot.reason}`);
  return { clinic, funnel, priority, modes, judge, agree, rate, unlabeled: judge.unlabeledVerdicts.length };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** The check pill for a failure mode, from the sample's checks and decisions. */
function checkPillFor(mode, stageChecks) {
  const types = [...new Set(stageChecks.filter((c) => c.modeId === mode.id).map((c) => c.type))];
  if (types.length) return { label: types.map((t) => (t === 'judge' ? 'AI judge' : 'Code check')).join(', '), dashed: false };
  if (mode.decision === 'watch') return { label: 'Keep watching', dashed: true };
  if (mode.decision === 'fix') return { label: mode.fixedAt ? 'Fixed' : 'Fix it now', dashed: true };
  return { label: 'No check yet', dashed: true };
}

// ------------------------------------------------------------------ 9.1 funnel (1200 x 720)

function funnelVisual(D) {
  const { funnel, modes } = D;
  const stages = funnel.stages;
  if (stages.length !== 5) throw new Error(`The funnel visual is laid out for 5 stages; the sample has ${stages.length}.`);
  const personMode = stages.flatMap((s) => s.failureModes).find((m) => m.id === 'fm-ignores-requests-for-a-person');
  const repeats = modes.get('sm-repeats-the-booking-back');
  const desc = `The funnel of an AI experience for a dental booking assistant. ${funnel.counted} reviewed conversations move left to right through ${NUMBER_WORDS[stages.length]} stages: ${stages.map((s) => lowerFirst(s.label)).join(', ')}. `
    + `At each stage, failing conversations drop out under a named failure mode, such as ${personMode ? personMode.firstHere : 0} that ignored requests for a person, and green chips show success modes, such as ${repeats ? 'repeating the booking back' : 'what went right'}. `
    + `A bottom row shows the check for each failure mode, where one exists. ${funnel.passed} of ${funnel.counted} reach a good outcome.`;

  return {
    name: 'funnel', width: 1200, height: 720, title: 'The funnel of an AI experience', desc,
    draw(svg) {
      const X0 = 176, CW = 178, END = X0 + CW * stages.length;
      const colX = (i) => X0 + i * CW;
      const HEAD = { y: 118, h: 58 };
      const CHIP = { y: 186, h: 54 };
      const TB = 256, THICK = 110;
      const CARD_Y = 414;
      const PILL_Y = 600, PILL_H = 34, PILL_GAP = 6;
      // Each outflow ribbon leaves the band PEEL px into its column and lands RUN px further right.
      const PEEL = 40, RUN = 76;
      const k = THICK / stages[0].onTrack;
      const T = (v) => v * k;
      const nexts = stages.map((s) => s.onTrack - s.failedHere);

      heading(svg, 'The funnel of an AI experience', `Example: ${funnel.counted} reviewed conversations with a dental booking assistant`);
      legend(svg, [{ glyph: 'success', label: 'Success mode' }, { glyph: 'failure', label: 'Failure mode' }, { glyph: 'check', label: 'Check' }], 1168, 60);

      // Row labels.
      const rows = [
        { y: CHIP.y + 22, title: 'Success modes', color: 'good', sub: ['what to keep', 'working'] },
        { y: TB + 30, title: 'On track', color: 'ink', sub: ['conversations'] },
        { y: CARD_Y + 25, title: 'Failure modes', color: 'bad', sub: ['where it first', 'went wrong'] },
        { y: PILL_Y + 23, title: 'Checks', color: 'ink', sub: ['what catches it'] },
      ];
      for (const r of rows) {
        svg.text(32, r.y, assertFits(r.title, 18, 700, X0 - 32), { weight: 700, color: r.color });
        r.sub.forEach((s) => assertFits(s, 18, 400, X0 - 32));
        svg.text(32, r.y + 22, r.sub, { color: 'ink-2', lh: 22 });
      }

      // Stage headers: neutral, numbered.
      stages.forEach((s, i) => {
        const x = colX(i) + 3;
        svg.rect(x, HEAD.y, 172, HEAD.h, { r: 10, fill: 'surface-2', stroke: 'line' });
        const cy = HEAD.y + HEAD.h / 2;
        badge(svg, colX(i) + 20, cy, s.number ?? i + 1, 12);
        const lines = wrapBalanced(s.label, 134, 20, 700, { force: true });
        svg.text(colX(i) + 37, cy - ((lines.length - 1) * 24) / 2 + 7, lines, { size: 20, weight: 700, lh: 24 });
      });

      // Success chips.
      stages.forEach((s, i) => {
        const list = (s.successModes || []).filter((m) => m.count > 0);
        if (list.length > 1) throw new Error(`Stage "${s.label}" has ${list.length} success modes; the funnel visual has room for one.`);
        const m = list[0];
        if (!m) return;
        const x = colX(i) + 3;
        svg.rect(x, CHIP.y, 172, CHIP.h, { r: 14, fill: 'good-soft', stroke: 'good', so: 0.55, sw: 1.2 });
        const countW = measure(String(m.count), 18, 700);
        const lines = wrap(m.name, [152 - countW - 10, 152], 18);
        svg.text(x + 10, CHIP.y + 22 + (lines.length === 1 ? 11 : 0), lines, { lh: 22 });
        svg.text(x + 162, CHIP.y + 22, String(m.count), { weight: 700, color: 'good', anchor: 'end' });
      });

      // Failure cards: one per stage, listing its failure modes, drawn before the ribbons pour into them.
      const cardBottoms = [];
      stages.forEach((s, i) => {
        if (!s.failureModes.length) return;
        const x = colX(i) + 3;
        const blocks = s.failureModes.map((m) => ({ m, lines: wrap(m.name, 154, 18, 600) }));
        const blockH = (b) => 63 + 22 * (b.lines.length - 1);
        const h = blocks.reduce((a, b) => a + blockH(b), 0);
        svg.rect(x, CARD_Y, 172, h, { r: 10, fill: 'bad-soft' });
        svg.line(x + 12, CARD_Y + 1.5, x + 160, CARD_Y + 1.5, { stroke: 'bad', sw: 3 });
        let y = CARD_Y;
        blocks.forEach((b, j) => {
          if (j) svg.line(x + 10, y, x + 162, y, { stroke: 'bad', sw: 1.2, so: 0.35 });
          svg.text(x + 10, y + 25, b.lines, { weight: 600, lh: 22 });
          const meta = [{ t: String(b.m.firstHere), weight: 700, color: 'bad' }, { t: ' \u00B7 ', color: 'ink-3' }];
          if (b.m.severity) meta.push({ t: SEVERITY_WORD[b.m.severity], weight: 600, color: SEVERITY_COLOR[b.m.severity] });
          svg.text(x + 10, y + 25 + 22 * (b.lines.length - 1) + 24, [meta]);
          y += blockH(b);
        });
        cardBottoms.push(CARD_Y + h);
      });
      if (Math.max(CARD_Y, ...cardBottoms) > PILL_Y - 12) throw new Error('Failure cards run into the checks row.');

      // Outflow ribbons, Sankey style: the conversations that failed at a stage leave the band's lower
      // edge, bend smoothly downward, and pour into that stage's failure card. Each ribbon is exactly as
      // wide as the band narrows there, so every conversation is drawn once, on track or leaving.
      const drops = stages.map((s, i) => {
        if (!s.failedHere) return null;
        const w = T(s.failedHere);
        const yb = TB + T(s.onTrack);
        const xs = colX(i) + PEEL;
        if (CARD_Y - yb < 30) throw new Error(`The ribbon for stage "${s.label}" has ${Math.round(CARD_Y - yb)}px to fall; it needs 30.`);
        if (xs + RUN + w > colX(i) + 160) throw new Error(`The ribbon for stage "${s.label}" lands past its card.`);
        return { w, ya: yb - w, yb, xs, x0: i ? colX(i) : X0 + 14 };
      });

      // The band: flat top; the lower edge steps up exactly where each ribbon leaves.
      svg.raw(`<defs><linearGradient id="${svg.id('band')}" x1="0" y1="0" x2="1" y2="0">`
        + `<stop offset="0" style="stop-color:${svg.color('accent')};stop-opacity:0.28"/>`
        + `<stop offset="1" style="stop-color:${svg.color('accent')};stop-opacity:0.13"/></linearGradient></defs>`);
      const RC = 10;
      let d = `M${X0 + RC} ${TB}H${END + 14}V${n(TB + T(nexts[stages.length - 1]))}`;
      for (let i = stages.length - 1; i >= 0; i--) {
        if (drops[i]) d += `H${n(drops[i].x0)}V${n(drops[i].yb)}`;
      }
      const bottom0 = TB + T(stages[0].onTrack);
      d += `H${X0 + RC}Q${X0} ${n(bottom0)} ${X0} ${n(bottom0 - RC)}V${TB + RC}Q${X0} ${TB} ${X0 + RC} ${TB}Z`;
      svg.raw(`<path d="${d}" style="fill:url(#${svg.id('band')});stroke:none"/>`);
      svg.line(X0 + RC, TB, END, TB, { stroke: 'accent', sw: 2 });

      // Each ribbon: the failing slice runs along the bottom of its stage, then its two edges swing
      // down as nested quarter ellipses (outer edge from the band's new lower edge, inner edge from the
      // old one), so the ribbon keeps its width until it pours into the card.
      const C = 0.5523;
      const Y1 = CARD_Y + 3;
      drops.forEach((p) => {
        if (!p) return;
        const xi = p.xs + RUN, xo = xi + p.w;
        const outer = `C${n(p.xs + C * (xo - p.xs))} ${n(p.ya)} ${n(xo)} ${n(Y1 - C * (Y1 - p.ya))} ${n(xo)} ${Y1}`;
        const inner = `C${n(xi)} ${n(Y1 - C * (Y1 - p.yb))} ${n(p.xs + C * (xi - p.xs))} ${n(p.yb)} ${n(p.xs)} ${n(p.yb)}`;
        svg.raw(`<path d="M${n(p.x0)} ${n(p.ya)}H${n(p.xs)}${outer}H${n(xi)}${inner}H${n(p.x0)}Z" style="fill:${svg.color('bad')};fill-opacity:.85;stroke:none"/>`);
      });

      // Counts inside the band: how many are still on track at each stage.
      stages.forEach((s, i) => {
        const runs = [{ t: String(s.onTrack), size: 22, weight: 700, color: 'accent' }, { t: ' on track', color: 'ink-2' }];
        const w = measure(runs[0].t, 22, 700) + measure(runs[1].t, 18);
        if (w * FIT > CW - 20) throw new Error(`The band label "${runs[0].t}${runs[1].t}" does not fit its stage.`);
        svg.text(colX(i) + 14, TB + 30, [runs]);
      });

      // Good outcome.
      const ox = END, ow = 1168 - END, mx = ox + ow / 2;
      svg.rect(ox, TB, ow, 144, { r: 12, fill: 'good-soft', stroke: 'good', sw: 1.5 });
      svg.text(mx, TB + 30, ['Good', 'outcome'], { weight: 700, color: 'good', anchor: 'middle', lh: 22 });
      assertFits('outcome', 18, 700, ow - 12);
      svg.text(mx, TB + 104, String(funnel.passed), { size: 40, weight: 700, anchor: 'middle' });
      svg.text(mx, TB + 128, assertFits(`of ${funnel.counted}`, 18, 400, ow - 12), { color: 'ink-2', anchor: 'middle' });

      // Checks row: one pill per failure mode, in the same order as the cards.
      stages.forEach((s, i) => {
        s.failureModes.forEach((m, j) => {
          const p = checkPillFor(m, s.checks || []);
          assertFits(p.label, 18, 600, 172 - 32);
          pill(svg, colX(i) + 3, PILL_Y + j * (PILL_H + PILL_GAP), p.label, { dashed: p.dashed });
        });
      });

      svg.text(32, 704, 'Each failing conversation is counted once, at the first stage that went wrong.', { color: 'ink-2' });
    },
  };
}

// ------------------------------------------------------------------ 9.2 loop (1200 x 600)

function loopVisual() {
  const STEPS = [
    { label: 'Read traces', caption: ['See what your', 'customer saw'], tab: 'in Review traces', marks: ['person'] },
    { label: 'Write notes', caption: ['The first thing', 'that went wrong'], tab: 'in Review traces', marks: ['person'] },
    { label: 'Group into failure modes', caption: ['Name what keeps', 'happening'], tab: 'in Failure modes', marks: ['person', 'sparkle'] },
    { label: 'Count by stage', caption: ['Find where each', 'one starts'], tab: 'in Funnel', marks: [] },
    { label: 'Build checks', caption: ['A code check or', 'an AI judge'], tab: 'in Checks', marks: ['sparkle'] },
    { label: 'Test, then keep running', caption: ['Check it agrees', 'with your labels'], tab: 'in Checks and Report', marks: ['person'] },
  ];
  return {
    name: 'loop', width: 1200, height: 600, title: 'Error discovery, step by step',
    desc: 'Error discovery in six steps: read traces, write notes, group into failure modes, count by stage, build checks, then test the checks and keep them running. Steps one to three repeat until new failure modes stop appearing. A problem caused by a missing instruction is fixed right away instead of getting a check.',
    draw(svg) {
      const NW = 158, PITCH = 184, X1 = 61, NY = 314, NH = 80;
      const left = (i) => X1 + i * PITCH;
      const mid = (i) => left(i) + NW / 2;
      const cy = NY + NH / 2;
      const LX = X1 - 26, RX = left(5) + NW + 26, BOTTOM = 530;
      const FIX = { x: left(4), y: 152, w: NW, h: 54 };

      heading(svg, 'Error discovery, step by step', 'Your judgment sets the bar. AI helps you go faster.');
      legend(svg, [{ glyph: 'person', label: 'You decide' }, { glyph: 'sparkle', label: 'AI can help' }], 1168, 60);

      const line = { stroke: 'ink-3', sw: 1.8, cap: 'round', join: 'round' };
      // Forward arrows between steps.
      for (let i = 0; i < 5; i++) {
        svg.line(left(i) + NW + 4, cy, left(i + 1) - 6, cy, line);
        arrowHead(svg, left(i + 1) - 3, cy, 'right');
      }

      // Repeat arc over steps 1 to 3, with a sparkline of new failure modes per 10 traces.
      const arcTop = NY - 128;
      svg.path(`M${mid(2)} ${NY - 2}C${mid(2)} ${arcTop} ${mid(0)} ${arcTop} ${mid(0)} ${NY - 12}`, line);
      arrowHead(svg, mid(0), NY - 3, 'down');
      const apex = NY - 2 - 0.75 * (NY - 2 - arcTop);
      svg.text(mid(1), apex - 14, assertFits('Repeat until new failure modes stop appearing', 18, 600, 2 * PITCH + 100), { weight: 600, color: 'ink', anchor: 'middle' });
      const spark = [4, 3, 3, 2, 1, 0, 0];
      const sx0 = mid(1) - 48, sy0 = apex + 52, step = 16, unit = 8;
      svg.line(sx0 - 6, sy0 + 0.5, sx0 + step * (spark.length - 1) + 6, sy0 + 0.5, { stroke: 'line', sw: 1.5 });
      svg.path(spark.map((v, i) => `${i ? 'L' : 'M'}${n(sx0 + i * step)} ${n(sy0 - v * unit)}`).join(''), { stroke: 'accent', sw: 2.2, cap: 'round', join: 'round' });
      spark.forEach((v, i) => svg.circle(sx0 + i * step, sy0 - v * unit, 2.8, { fill: 'accent' }));

      // "Fix it now" branch from step 4.
      const bx = left(3) + NW - 22;
      const fy = FIX.y + FIX.h / 2;
      svg.path(`M${bx} ${NY - 2}V${fy + 12}Q${bx} ${fy} ${bx + 12} ${fy}H${FIX.x - 6}`, line);
      arrowHead(svg, FIX.x - 3, fy, 'right');
      svg.rect(FIX.x, FIX.y, FIX.w, FIX.h, { r: 12, fill: 'surface', stroke: 'ink-3', sw: 1.5 });
      svg.text(FIX.x + FIX.w / 2, fy + 7, assertFits('Fix it now', 20, 700, FIX.w - 20), { size: 20, weight: 700, anchor: 'middle' });
      svg.text(FIX.x + FIX.w / 2, FIX.y + FIX.h + 28, ['Missing instruction?', 'Change the prompt.'], { color: 'ink-2', anchor: 'middle', lh: 22 });
      svg.text(left(3), NY - 52, ['Eval Studio', 'counts this'], { color: 'ink-3', lh: 22 });

      // Return path: from step 6 and from "Fix it now" back to step 1.
      const rr = 14;
      svg.path(`M${FIX.x + FIX.w + 4} ${fy}H${RX - rr}Q${RX} ${fy} ${RX} ${fy + rr}V${BOTTOM - rr}Q${RX} ${BOTTOM} ${RX - rr} ${BOTTOM}`
        + `H${LX + rr}Q${LX} ${BOTTOM} ${LX} ${BOTTOM - rr}V${cy + rr}Q${LX} ${cy} ${LX + rr} ${cy}H${left(0) - 6}`, line);
      arrowHead(svg, left(0) - 3, cy, 'right');
      svg.line(left(5) + NW + 4, cy, RX, cy, line);
      const ret = 'New traces bring new failures';
      const rw = measure(ret, 18, 600) + 28;
      svg.rect(600 - rw / 2, BOTTOM - 16, rw, 32, { r: 16, fill: 'surface' });
      svg.text(600, BOTTOM + 6, ret, { weight: 600, color: 'ink-2', anchor: 'middle' });

      // Steps.
      STEPS.forEach((s, i) => {
        const x = left(i);
        svg.rect(x, NY, NW, NH, { r: 12, fill: 'surface-2', stroke: 'line', sw: 1.2 });
        const lines = wrapBalanced(s.label, NW - 18, 20, 700);
        svg.text(mid(i), cy + 9.25 - 12 * (lines.length - 1), lines, { size: 20, weight: 700, anchor: 'middle', lh: 24 });
        badge(svg, x + 22, NY, i + 1);
        s.marks.forEach((m, j) => {
          const mx = x + NW - 22 - j * 32;
          svg.circle(mx, NY, 14, { fill: 'surface', stroke: 'line', sw: 1.2 });
          if (m === 'person') person(svg, mx, NY - 1, 'accent', 0.82);
          else sparkle(svg, mx, NY, 8.5, 'ai');
        });
        s.caption.forEach((c) => assertFits(c, 18, 400, PITCH - 8));
        svg.text(mid(i), NY + NH + 32, s.caption, { color: 'ink-2', anchor: 'middle', lh: 22 });
        svg.text(mid(i), NY + NH + 80, assertFits(s.tab, 18, 400, PITCH + 20), { color: 'ink-3', anchor: 'middle' });
      });
    },
  };
}

// ------------------------------------------------------------------ 9.3 notes-to-modes (1200 x 600)

function notesVisual(D) {
  const { priority, modes, funnel } = D;
  const name = (id, fallback) => (modes.get(id) ? modes.get(id).name : fallback);
  const PILES = [
    { id: 'fm-ignores-requests-for-a-person', kind: 'failure' },
    { id: 'fm-stray-symbols-in-texts', kind: 'failure' },
    { id: 'fm-books-before-the-patient-confirms', kind: 'failure' },
    { id: 'sm-repeats-the-booking-back', kind: 'success' },
    { id: 'nm-not-a-product-problem', kind: 'ignore' },
  ].map((p) => ({ ...p, name: name(p.id, p.id) }));
  const NOTES = [
    ['Asked for a person twice. Ignored.', 0], ['Text shows **Friday** with stars', 1], ['Booked 9:30 before she chose a time', 2],
    ['Read back day, time, and dentist', 3], ['Wanted the front desk, got slots', 0], ['Dash bullets in a text reply', 1],
    ['Test session from our team', 4], ['Moved the cleaning without asking', 2], ['Said call me, it kept texting', 0], ['Asterisks around the address', 1],
  ].map(([text, pile]) => ({ text, pile }));
  const top = priority[0];
  const common = [...priority].sort((a, b) => b.traces - a.traces || a.stageIndex - b.stageIndex)[0];
  if (!top || !common) throw new Error('The clinic sample has no failure modes to rank.');
  return {
    name: 'notes-to-modes', width: 1200, height: 600, title: 'From notes to failure modes',
    desc: `Ten review notes sorted into three failure modes, one success mode, and a Not a product problem pile, then ranked by how often and how badly each hurts. ${top.mode.name.replace(/^Ignores/, 'Ignoring')} ranks first even though ${lowerFirst(common.mode.name).replace(/^stray \*\* symbols/, 'stray symbols')} is more common.`,
    draw(svg) {
      heading(svg, 'From notes to failure modes', 'Sort what you wrote. Then rank by how often and how badly it hurts.');
      legend(svg, [{ glyph: 'success', label: 'Success mode' }, { glyph: 'failure', label: 'Failure mode' }], 1168, 60);

      const HY = 152, Y0 = 188;
      const NX = 40, NW = 346, NH = 30, NP = 35;
      const PX = 440, PW = 320;
      const RX = 796, RW = 1168 - RX, RY0 = 192, RP = 61;
      svg.text(NX, HY, '1. Your notes', { size: 20, weight: 700 });
      svg.text(PX, HY, '2. Grouped and named', { size: 20, weight: 700 });
      svg.text(RX, HY, '3. What to fix first', { size: 20, weight: 700 });
      svg.text(RX, HY + 24, `all ${funnel.counted} conversations`, { color: 'ink-3' });

      // Notes, in the order they were written.
      const noteY = (i) => Y0 + i * NP;
      NOTES.forEach((note, i) => {
        const kind = PILES[note.pile].kind;
        const y = noteY(i);
        svg.rect(NX, y, NW, NH, { r: 7, fill: 'surface', stroke: 'line', sw: 1.2 });
        svg.rect(NX + 7, y + 6, 4, NH - 12, { r: 2, fill: kind === 'failure' ? 'bad' : kind === 'success' ? 'good' : 'ink-3' });
        svg.text(NX + 22, y + 21, assertFits(note.text, 18, 400, NW - 30), {});
      });

      // Piles, stacked like sorted cards.
      const CARD_W = PW - 10, NAME_X = 46, COUNT_W = 34, PBOTTOM = noteY(NOTES.length - 1) + NH;
      const piles = PILES.map((p, i) => {
        const count = NOTES.filter((x) => x.pile === i).length;
        const lines = wrapBalanced(p.name, CARD_W - NAME_X - COUNT_W, 18, 600);
        return { ...p, count, lines, h: lines.length === 1 ? 44 : 66, stack: Math.min(2, count - 1) * 5 };
      });
      const used = piles.reduce((a, p) => a + p.h + p.stack, 0);
      const gap = (PBOTTOM - Y0 - used) / (piles.length - 1);
      let py = Y0;
      piles.forEach((p) => { p.y = py; py += p.h + p.stack + gap; });

      // Connectors from each note to its pile, drawn under the cards.
      piles.forEach((p, pi) => {
        const incoming = NOTES.map((x, i) => ({ ...x, i })).filter((x) => x.pile === pi);
        incoming.forEach((x, j) => {
          const y1 = noteY(x.i) + NH / 2;
          const y2 = p.y + (p.h * (j + 1)) / (incoming.length + 1);
          const color = p.kind === 'failure' ? 'bad' : p.kind === 'success' ? 'good' : 'ink-3';
          svg.path(`M${NX + NW} ${n(y1)}C${NX + NW + 30} ${n(y1)} ${PX - 30} ${n(y2)} ${PX} ${n(y2)}`, { stroke: color, sw: 1.6, so: 0.7, cap: 'round' });
          svg.circle(NX + NW, y1, 3, { fill: color });
        });
      });

      piles.forEach((p) => {
        const shape = (dx, back) => {
          const o = p.kind === 'failure' ? { fill: back ? 'surface' : 'bad-soft', stroke: back ? 'line' : null, sw: 1.2 }
            : p.kind === 'success' ? { fill: 'good-soft', stroke: 'good', sw: 1.4, so: 0.6 }
              : { fill: 'surface', stroke: 'ink-3', sw: 1.4, dash: '5 4' };
          svg.rect(PX + dx, p.y + dx, CARD_W, p.h, { r: p.kind === 'success' ? p.h / 2 : 10, ...o });
        };
        for (let s = p.stack; s > 0; s -= 5) shape(s, true);
        shape(0, false);
        const cy = p.y + p.h / 2;
        if (p.kind === 'failure') glyph(svg, 'failure', PX + 17, cy + 1);
        else if (p.kind === 'success') glyph(svg, 'success', PX + 10, cy);
        else svg.rect(PX + 14, cy - 8, 16, 16, { r: 4, stroke: 'ink-3', sw: 1.4, dash: '3 3' });
        svg.text(PX + NAME_X, cy - ((p.lines.length - 1) * 22) / 2 + 6.3, p.lines, { weight: 600, color: p.kind === 'ignore' ? 'ink-2' : 'ink', lh: 22 });
        svg.text(PX + CARD_W - 14, cy + 6.3, String(p.count), { weight: 700, color: p.kind === 'failure' ? 'bad' : p.kind === 'success' ? 'good' : 'ink-2', anchor: 'end' });
      });

      // Ranked by traces x severity weight (priorityTable): the bar length is the priority.
      const max = Math.max(...priority.map((r) => r.priority));
      const rowY = (i) => RY0 + i * RP;
      priority.slice(0, 6).forEach((r, i) => {
        const y = rowY(i);
        const bw = Math.max(8, (r.priority / max) * RW);
        svg.text(RX, y + 14, assertFits(r.mode.name, 18, 600, RW), { weight: 600 });
        svg.rect(RX, y + 21, RW, 6, { r: 3, fill: 'surface-2' });
        svg.rect(RX, y + 21, bw, 6, { r: 3, fill: 'bad' });
        const meta = [{ t: `${r.traces} conversations`, color: 'ink-2' }, { t: ' · ', color: 'ink-3' }, { t: SEVERITY_WORD[r.mode.severity] || '', weight: 600, color: SEVERITY_COLOR[r.mode.severity] || 'ink-2' }];
        if (r === common) meta.push({ t: ' \u00B7 ', color: 'ink-3' }, { t: 'Most common', weight: 700, color: 'ink' });
        const metaW = meta.reduce((a, m) => a + measure(m.t, 18, m.weight || 400), 0) * FIT;
        if (metaW > RW) throw new Error(`The ranking line for "${r.mode.name}" needs ${Math.ceil(metaW)}px; it has ${RW}px.`);
        svg.text(RX, y + 45, [meta]);
      });
      // Dotted links from each failure pile to its place in the ranking.
      piles.forEach((p) => {
        const idx = priority.findIndex((r) => r.mode.id === p.id);
        if (p.kind !== 'failure' || idx < 0 || idx > 5) return;
        const x1 = PX + CARD_W + p.stack + 3;
        const y1 = p.y + p.h / 2;
        const y2 = rowY(idx) + 8;
        svg.path(`M${n(x1)} ${n(y1)}C${n(x1 + 18)} ${n(y1)} ${RX - 20} ${n(y2)} ${RX - 8} ${n(y2)}`, { stroke: 'ink-3', sw: 1.4, dash: '2 4', cap: 'round' });
      });

      svg.text(40, 574, 'The most common failure mode is not always the one to fix first.', { color: 'ink-2' });
    },
  };
}

// ------------------------------------------------------------------ 9.4 judge-trust (1200 x 600)

function judgeVisual(D) {
  const { agree, rate, judge, unlabeled } = D;
  const range = `${pct(rate.low)} to ${pct(rate.high)}`;
  return {
    name: 'judge-trust', width: 1200, height: 600, title: 'Can you trust your AI judge?',
    desc: `Can you trust your AI judge? The judge for ${judge.judge} was measured on ${agree.n} labeled conversations kept aside until the end. `
      + `It caught ${agree.tn} of ${agree.nFail} real failures (${pct(agree.catchesFailures)}) and agreed on ${agree.tp} of ${agree.nPass} good conversations (${pct(agree.agreesOnGood)}). `
      + `On ${unlabeled} new conversations it flagged ${pct(rate.observed)}. Correcting for its known mistakes, the likely true failure rate is ${pct(rate.estimate)}, with a 95% range of ${range}.`,
    draw(svg) {
      heading(svg, 'Can you trust your AI judge?', 'Compare it with your own labels. Ask two questions.');
      legend(svg, [{ glyph: 'person', label: 'You decide' }, { glyph: 'check', label: 'Check' }], 1168, 60);
      glyph(svg, 'check', 32, 132);
      svg.text(72, 138, assertFits(`Judge: ${judge.judge}. Measured on ${agree.n} labeled conversations kept aside until the end.`, 18, 400, 1090), { color: 'ink-2' });

      const DX = 48, PITCH = 22, R = 8;
      const dots = (y, list, perLine = 25) => list.forEach((kind, i) => {
        const x = DX + (i % perLine) * PITCH;
        const yy = y + Math.floor(i / perLine) * 26;
        dot(kind, x, yy, R);
      });
      const dot = (kind, x, y, r) => {
        if (kind === 'caught') svg.circle(x, y, r, { fill: 'bad' });
        else if (kind === 'missed') svg.circle(x, y, r - 0.9, { fill: 'surface', stroke: 'bad', sw: 1.8, dash: '3 2.6' });
        else if (kind === 'good') svg.circle(x, y, r, { fill: 'good' });
        else svg.circle(x, y, r - 0.9, { fill: 'surface', stroke: 'bad', sw: 1.8 });
      };
      const key = (x, y, items) => {
        let cx = x;
        for (const [kind, label] of items) {
          dot(kind, cx + 7, y - 6, 7);
          svg.text(cx + 22, y, label, { color: 'ink-2' });
          cx += 22 + measure(label, 18) + 28;
        }
      };
      const bigNumber = (x, y, value, label, detail) => {
        svg.text(x, y, value, { size: 48, weight: 700 });
        svg.text(x, y + 30, label, { color: 'ink-2' });
        svg.text(x, y + 54, detail, { color: 'ink-3' });
      };
      const who = (y, text) => {
        person(svg, 48, y - 6, 'accent', 0.9);
        svg.text(64, y, text, { color: 'ink-2' });
      };

      // Row 1: real failures.
      svg.text(40, 190, 'Does it catch real failures?', { size: 20, weight: 700 });
      who(216, `${agree.nFail} you marked Problem`);
      dots(250, [...Array(agree.tn).fill('caught'), ...Array(agree.fp).fill('missed')]);
      key(40, 290, [['caught', 'Judge caught it'], ['missed', 'Judge missed it']]);
      bigNumber(640, 240, pct(agree.catchesFailures), 'Catches real failures', `${agree.tn} of ${agree.nFail}`);

      // Row 2: good conversations.
      svg.text(40, 350, 'Does it leave good traces alone?', { size: 20, weight: 700 });
      who(376, `${agree.nPass} you marked Good`);
      dots(410, [...Array(agree.tp).fill('good'), ...Array(agree.fn).fill('flagged')]);
      key(40, 476, [['good', 'Judge said Good'], ['flagged', 'Judge flagged it']]);
      bigNumber(640, 400, pct(agree.agreesOnGood), 'Agrees on good traces', `${agree.tp} of ${agree.nPass}`);

      svg.line(836, 168, 836, 512, { stroke: 'line', sw: 1.5 });

      // Right: the likely true failure rate on new conversations.
      const AX = 874, AW = 280, MAXP = 0.3;
      const ax = (p) => AX + (Math.min(p, MAXP) / MAXP) * AW;
      svg.text(866, 190, assertFits(`On ${unlabeled} new conversations`, 20, 700, 300), { size: 20, weight: 700 });
      svg.text(866, 232, [[{ t: 'Judge flagged ', color: 'ink-2' }, { t: pct(rate.observed), weight: 700 }]]);
      svg.line(AX, 256, AX + AW, 256, { stroke: 'line', sw: 2 });
      svg.circle(ax(rate.observed), 256, 8, { fill: 'surface', stroke: 'bad', sw: 2.5 });
      svg.text(866, 298, [[{ t: 'Likely true rate ', weight: 600 }, { t: pct(rate.estimate), weight: 700 }]]);
      svg.line(AX, 322, AX + AW, 322, { stroke: 'line', sw: 2 });
      svg.rect(ax(rate.low), 316, ax(rate.high) - ax(rate.low), 12, { r: 6, fill: 'bad', fo: 0.28 });
      svg.circle(ax(rate.estimate), 322, 8, { fill: 'bad' });
      [0, 0.1, 0.2, 0.3].forEach((p) => {
        svg.line(ax(p), 262, ax(p), 268, { stroke: 'ink-3', sw: 1.5 });
        svg.line(ax(p), 340, ax(p), 347, { stroke: 'ink-3', sw: 1.5 });
        svg.text(ax(p), 370, pct(p), { color: 'ink-3', anchor: 'middle' });
      });
      svg.text(866, 406, `95% range: ${range}`, { color: 'ink-2' });
      const caption = wrap('The judge misses some failures and flags some good ones. Correcting for both gives the likely true rate.', [300, 300, 300, 300], 18);
      svg.text(866, 446, caption, { lh: 24 });

      const foot = 'A judge that always says Good would score 100% on the second question and 0% on the first. You need both numbers.';
      svg.text(40, 558, assertFits(foot, 18, 400, 1128), { color: 'ink-2' });
    },
  };
}

// ------------------------------------------------------------------ 9.5 patterns (1200 x 800)

function patternsVisual() {
  const COLS = ['Understand', 'Gather', 'Plan', 'Act', 'Check', 'Answer'];
  const ROWS = [
    { name: 'One call with tools', product: 'Dental booking assistant', check: 'Right tool, right details?',
      nodes: [[0, 'Understand'], [1, 'Look up'], [3, 'Use tools', true], [5, 'Reply']] },
    { name: 'Step by step chain', product: 'Sales email writer', check: 'Does the gate stop weak drafts?',
      nodes: [[0, 'Read brief'], [2, 'Draft'], [4, 'Gate', true], [5, 'Final pass']] },
    { name: 'Sort and route', product: 'Gift finder', check: 'Sorted into the right path?', fork: true,
      nodes: [[0, 'Sort', true]] },
    { name: 'Planner and workers', product: 'Research brief', check: 'Did it split the work well?', fan: true,
      nodes: [[2, 'Plan', true], [5, 'Combine']] },
    { name: 'Draft and critique loop', product: 'Contract summary', check: 'Does the critique catch real problems?', loop: [4, 3, 'Revise'],
      nodes: [[3, 'Draft'], [4, 'Critique', true], [5, 'Final']] },
    { name: 'Agent', product: 'Code review agent', check: 'Did it verify before reporting?', loop: [4, 2, null],
      nodes: [[0, 'Clarify'], [1, 'Read code'], [2, 'Plan'], [3, 'Run tests'], [4, 'Verify', true], [5, 'Report']] },
  ];
  return {
    name: 'patterns', width: 1200, height: 800, title: 'Every product is a different funnel',
    desc: 'Six ways AI products are built, drawn on the same stages from understand to answer, with a red mark where failures usually start in each.',
    draw(svg) {
      heading(svg, 'Every product is a different funnel', 'Same stages, different paths. Red marks where failures usually start.');
      legend(svg, [{ glyph: 'start', label: 'Failures usually start here' }, { glyph: 'check', label: 'Check' }], 1168, 60);

      const LABEL_X = 32, C0 = 262, CW = 110, RIGHT_X = C0 + 6 * CW + 22, PILL_W = 1168 - RIGHT_X;
      const cx = (i) => C0 + i * CW + CW / 2;
      const HY = 150, ROW0 = 170, RH = 96;
      COLS.forEach((c, i) => svg.text(cx(i), HY, assertFits(c, 20, 700, CW + 20), { size: 20, weight: 700, anchor: 'middle' }));
      svg.text(RIGHT_X, HY, 'Check here first', { size: 20, weight: 700 });
      svg.line(LABEL_X, ROW0 - 4, 1168, ROW0 - 4, { stroke: 'line', sw: 1.5 });
      COLS.forEach((c, i) => svg.line(cx(i), ROW0 + 2, cx(i), ROW0 + RH * ROWS.length - 6, { stroke: 'line', sw: 1.5, dash: '2 5' }));

      const lane = { stroke: 'ink-3', sw: 2.2, cap: 'round', join: 'round' };
      // A step name under its node, on a small patch of card color so the dotted stage guide stops behind it.
      const stepLabel = (x, y, text, red = false) => {
        const w = measure(assertFits(text, 18, red ? 700 : 400, CW + 4), 18, red ? 700 : 400) * FIT + 8;
        svg.rect(x - w / 2, y - 16, w, 22, { r: 4, fill: 'surface' });
        svg.text(x, y, text, { weight: red ? 700 : 400, color: red ? 'bad' : 'ink-2', anchor: 'middle' });
      };
      const node = (x, y, label, red, small = false) => {
        if (red) glyph(svg, 'start', x - 16, y);
        else svg.circle(x, y, small ? 5.5 : 7.5, { fill: 'surface', stroke: 'ink-2', sw: 2.2 });
        if (label) stepLabel(x, y + 37, label, red);
      };

      ROWS.forEach((row, r) => {
        const top = ROW0 + r * RH;
        if (r) svg.line(LABEL_X, top, 1168, top, { stroke: 'line', sw: 1 });
        const y = top + (row.loop ? 52 : row.fork || row.fan ? 38 : 40);
        // Left label.
        const nameLines = wrapBalanced(row.name, 222, 20, 700);
        svg.text(LABEL_X, top + 34, nameLines, { size: 20, weight: 700, lh: 24 });
        svg.text(LABEL_X, top + 34 + nameLines.length * 24, assertFits(row.product, 18, 400, 222), { color: 'ink-2' });

        // Lanes.
        const pts = row.nodes.map(([c]) => cx(c));
        if (pts.length > 1) svg.line(pts[0], y, pts[pts.length - 1], y, lane);
        if (row.fork) {
          const x0 = cx(0);
          [-22, 0, 22].forEach((dy) => {
            svg.path(`M${x0} ${y}C${x0 + 60} ${y} ${cx(2) - 70} ${y + dy} ${cx(2)} ${y + dy}H${cx(5)}`, lane);
            [2, 3, 5].forEach((c) => node(cx(c), y + dy, null, false, true));
          });
          [[2, 'Pick path'], [3, 'Handle'], [5, 'Reply']].forEach(([c, t]) => stepLabel(cx(c), y + 22 + 30, t));
        }
        if (row.fan) {
          const a = cx(2), b = cx(3), c = cx(5);
          [-22, 0, 22].forEach((dy) => {
            svg.path(`M${a} ${y}C${a + 50} ${y} ${b - 50} ${y + dy} ${b} ${y + dy}C${b + 90} ${y + dy} ${c - 90} ${y} ${c} ${y}`, lane);
            node(b, y + dy, null, false, true);
          });
          stepLabel(b, y + 22 + 30, 'Workers');
        }
        if (row.loop) {
          const [from, to, label] = row.loop;
          const x1 = cx(from), x2 = cx(to), h = 34;
          svg.path(`M${x1} ${y - 12}C${x1} ${y - h - 6} ${x2} ${y - h - 6} ${x2} ${y - 16}`, lane);
          arrowHead(svg, x2, y - 11, 'down', 'ink-3', 8);
          if (label) {
            const ay = y - 12 - 0.75 * (h - 6 + 12) + 1;
            const w = measure(label, 18, 600) + 16;
            svg.rect((x1 + x2) / 2 - w / 2, ay - 13, w, 24, { r: 12, fill: 'surface' });
            svg.text((x1 + x2) / 2, ay + 5.5, label, { weight: 600, color: 'ink-2', anchor: 'middle' });
          }
        }
        row.nodes.forEach(([c, label, red]) => node(cx(c), y, label, !!red));

        // Where to check first: a neutral pill.
        const lines = wrapBalanced(row.check, PILL_W - 32, 18, 400, { force: true });
        const ph = 22 * lines.length + 20;
        const py = y - ph / 2;
        svg.rect(RIGHT_X, py, PILL_W, ph, { r: 18, fill: 'surface-2', stroke: 'ink-3', so: 0.55, sw: 1.2 });
        svg.text(RIGHT_X + 16, py + 10 + 16, lines, { lh: 22 });
      });

      svg.text(LABEL_X, 778, 'Pattern names follow Anthropic\'s Building effective agents.', { color: 'ink-2' });
    },
  };
}

// ------------------------------------------------------------------ 12.10 tool-calls (1200 x 620)

function toolCallsVisual() {
  return {
    name: 'tool-calls', width: 1200, height: 620, title: 'Three questions for every tool call',
    desc: 'Three questions for every tool call, shown on one example. The customer asks: The outage took us down for two days. Can I get a credit? '
      + 'The agent calls the tool issue_credit with account_id A-1182 and amount 80. The tool returns status pending_approval. The agent replies: Done! $80 is off your next bill. '
      + 'Policy sits on the call: allowed, verified, confirmed, under the limit? Here it fails, because a credit over $50 needs a supervisor. It is checked with a code check of policy rules. '
      + 'Relevance spans the request and the call: right tool, right details for what they asked? It is checked with a code check that uses an intent map, or with an AI judge. '
      + 'Output grounding spans the tool result and the reply: does the reply match what the tool returned? Here it fails, because a pending credit is shown as done. It is checked with a code check of the values, then an AI judge. '
      + 'Policy rules come from your company. Relevance and grounding problems show up when you read traces.',
    draw(svg) {
      heading(svg, 'Three questions for every tool call', 'Policy, relevance, and output grounding checks for agents that use tools.');
      legend(svg, [{ glyph: 'failure', label: 'Failure mode' }, { glyph: 'check', label: 'Check' }], 1168, 60);

      const BW = 260, GAP = 32, BX = (i) => 32 + i * (BW + GAP), BY = 280, BH = 128;
      const boxes = [
        { head: 'Customer asks', text: wrap('The outage took us down for two days. Can I get a credit?', [BW - 32, BW - 32, BW - 32], 18) },
        { head: 'Agent calls a tool', mono: ['issue_credit', 'account_id: A-1182', 'amount: 80'], hot: 2 },
        { head: 'Tool returns', mono: ['status:', 'pending_approval'], strong: 1 },
        { head: 'Agent replies', text: ['Done! $80 is off your', 'next bill.'], hotWord: 'Done!' },
      ];
      boxes.forEach((b, i) => {
        const x = BX(i);
        svg.rect(x, BY, BW, BH, { r: 12, fill: 'surface-2', stroke: 'line', sw: 1.2 });
        svg.text(x + 16, BY + 28, b.head, { weight: 600, color: 'ink-2' });
        svg.line(x + 16, BY + 40, x + BW - 16, BY + 40, { stroke: 'line', sw: 1.2 });
        const ly = (k) => BY + 66 + k * 24;
        if (b.mono) {
          b.mono.forEach((l) => assertFits(l, 18, 400, BW - 32, true));
          if (b.hot != null) {
            const hw = measure(b.mono[b.hot], 18, 400, true) + 12;
            svg.rect(x + 10, ly(b.hot) - 18, hw, 25, { r: 5, fill: 'bad-soft' });
            svg.line(x + 12, ly(b.hot) + 6, x + 8 + hw, ly(b.hot) + 6, { stroke: 'bad', sw: 2 });
          }
          b.mono.forEach((l, k) => svg.text(x + 16, ly(k), l, { mono: true, weight: (k === 0 && b.hot != null) || k === b.strong ? 700 : 400 }));
        } else {
          if (b.hotWord) {
            const hw = measure(b.hotWord, 18, 600) + 10;
            svg.rect(x + 11, ly(0) - 18, hw, 25, { r: 5, fill: 'bad-soft' });
            svg.line(x + 13, ly(0) + 6, x + 9 + hw, ly(0) + 6, { stroke: 'bad', sw: 2 });
          }
          const lines = b.hotWord ? [[{ t: b.hotWord, weight: 600 }, b.text[0].slice(b.hotWord.length)], ...b.text.slice(1)] : b.text;
          svg.text(x + 16, ly(0), lines, { lh: 24 });
        }
        if (i < 3) {
          svg.line(x + BW + 5, BY + BH / 2, x + BW + GAP - 8, BY + BH / 2, { stroke: 'ink-3', sw: 1.8 });
          arrowHead(svg, x + BW + GAP - 4, BY + BH / 2, 'right');
        }
      });

      const bracket = { stroke: 'ink-3', sw: 1.8, cap: 'round', join: 'round' };
      const title = (cx, y, label) => svg.text(cx, y, label, { size: 20, weight: 700, anchor: 'middle' });
      const redMark = (cx, y, label) => {
        const w = GLYPH_WIDTH.failure + 10 + measure(label, 18, 600);
        glyph(svg, 'failure', cx - w / 2, y - 6);
        svg.text(cx - w / 2 + GLYPH_WIDTH.failure + 10, y, label, { weight: 600, color: 'bad' });
      };

      // Policy: above the call.
      const pcx = BX(1) + BW / 2;
      title(pcx, 150, 'Policy');
      svg.text(pcx, 178, assertFits('Allowed? Verified? Confirmed? Under the limit?', 18, 400, 520), { color: 'ink-2', anchor: 'middle' });
      pill(svg, pcx, 192, 'Code check: policy rules', { center: true });
      redMark(pcx, 247, 'Over $50 needs a supervisor');
      svg.path(`M${BX(1) + 10} ${BY - 8}V${BY - 16}H${BX(1) + BW - 10}V${BY - 8}M${pcx} ${BY - 16}V${BY - 24}`, bracket);

      // Relevance and Output grounding: below, each spanning two boxes.
      const spans = [
        { a: 0, b: 1, label: 'Relevance', q: 'Right tool, right details for what they asked?', check: 'Code check: intent map, or AI judge' },
        { a: 2, b: 3, label: 'Output grounding', q: 'Does the reply match what the tool returned?', check: 'Code check: values, then AI judge', red: 'Pending shown as done' },
      ];
      for (const s of spans) {
        const x1 = BX(s.a) + 10, x2 = BX(s.b) + BW - 10, cx = (x1 + x2) / 2, y = BY + BH;
        svg.path(`M${x1} ${y + 8}V${y + 16}H${x2}V${y + 8}M${cx} ${y + 16}V${y + 24}`, bracket);
        title(cx, y + 56, s.label);
        svg.text(cx, y + 84, assertFits(s.q, 18, 400, 540), { color: 'ink-2', anchor: 'middle' });
        pill(svg, cx, y + 98, assertFits(s.check, 18, 600, 500), { center: true });
        if (s.red) redMark(cx, y + 156, s.red);
      }

      svg.text(32, 600, 'Policy rules come from your company. Relevance and grounding problems show up when you read traces.', { color: 'ink-2' });
    },
  };
}

// ------------------------------------------------------------------ build, check, write

// The visuals the landing page and Eval Studio's Welcome show, which scroll sideways on phones.
const NARROW_VISUALS = ['funnel', 'loop', 'patterns', 'tool-calls'];

function buildVisuals() {
  const D = loadData();
  const visuals = [funnelVisual(D), loopVisual(), notesVisual(D), judgeVisual(D), patternsVisual(), toolCallsVisual()];
  const files = new Map();
  for (const v of visuals) {
    for (const theme of THEMES) files.set(`${v.name}${theme === 'vars' ? '' : `-${theme}`}.svg`, svgDocument(v, theme));
    if (!NARROW_VISUALS.includes(v.name)) continue;
    for (const theme of THEMES) files.set(`${v.name}-narrow${theme === 'vars' ? '' : `-${theme}`}.svg`, svgDocument(v, theme, { narrow: true }));
  }
  return { files, data: D };
}

function checkVisuals(files) {
  const problems = [];
  for (const [name, text] of files) {
    const path = join(VISUALS_DIR, name);
    if (!existsSync(path)) problems.push(`${name} is missing`);
    else if (readFileSync(path, 'utf8') !== text) problems.push(`${name} is out of date`);
  }
  return problems;
}

// ------------------------------------------------------------------ PNG: size-aware re-encoding (no dependencies)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode an 8-bit RGB or RGBA PNG (what Chrome writes) to raw RGB pixels. */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) return null;
    } else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[out + i - bpp] : 0;
      const b = y ? px[out - stride + i] : 0;
      const c = y && i >= bpp ? px[out - stride + i - bpp] : 0;
      const v = raw[src + i];
      px[out + i] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < px.length; i += bpp, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  return { width, height, rgb };
}

function encodePng(width, height, rows, colorType, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra,
    chunk('IDAT', deflateSync(rows, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Truecolor with a per-row adaptive filter. */
function encodeRgb({ width, height, rgb }) {
  const stride = width * 3;
  const rows = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const cur = y * stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      const row = cand[f];
      for (let i = 0; i < stride; i++) {
        const v = rgb[cur + i];
        const a = i >= 3 ? rgb[cur + i - 3] : 0;
        const b = y ? rgb[cur - stride + i] : 0;
        const c = y && i >= 3 ? rgb[cur - stride + i - 3] : 0;
        const o = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 255;
        row[i] = o;
        sum += o < 128 ? o : 256 - o;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    rows[y * (stride + 1)] = best;
    cand[best].copy(rows, y * (stride + 1) + 1);
  }
  return encodePng(width, height, rows, 2);
}

/**
 * 256-color palette for flat UI screenshots, no dithering: split color boxes at the middle of
 * their widest channel (so rare text colors never merge into a common background), refine with a
 * few weighted k-means passes, then map every color to its nearest palette entry.
 */
function encodePalette({ width, height, rgb }) {
  const counts = new Map();
  for (let i = 0; i < rgb.length; i += 3) {
    const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const colors = [...counts.entries()].map(([k, c]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, c, k]);
  let boxes = [colors];
  while (boxes.length < 256) {
    let pick = -1, best = 0, pickCh = 0, pickMid = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      let pop = 0;
      for (const col of b) pop += col[3];
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const col of b) { if (col[ch] < lo) lo = col[ch]; if (col[ch] > hi) hi = col[ch]; }
        const score = (hi - lo) * Math.sqrt(pop);
        if (score > best) { best = score; pick = i; pickCh = ch; pickMid = (lo + hi) / 2; }
      }
    });
    if (pick < 0) break;
    const b = boxes[pick];
    boxes.splice(pick, 1, b.filter((col) => col[pickCh] <= pickMid), b.filter((col) => col[pickCh] > pickMid));
  }
  let centers = boxes.map((b) => {
    let r = 0, g = 0, bl = 0, t = 0;
    for (const col of b) { r += col[0] * col[3]; g += col[1] * col[3]; bl += col[2] * col[3]; t += col[3]; }
    return [r / t, g / t, bl / t];
  });
  const nearest = (col) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      const d = (col[0] - c[0]) ** 2 + (col[1] - c[1]) ** 2 + (col[2] - c[2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  for (let pass = 0; pass < 4; pass++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const col of colors) {
      const s = sum[nearest(col)];
      s[0] += col[0] * col[3]; s[1] += col[1] * col[3]; s[2] += col[2] * col[3]; s[3] += col[3];
    }
    centers = centers.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  const palette = Buffer.alloc(centers.length * 3);
  centers.forEach((c, i) => { palette[i * 3] = Math.round(c[0]); palette[i * 3 + 1] = Math.round(c[1]); palette[i * 3 + 2] = Math.round(c[2]); });
  const index = new Map();
  for (const col of colors) index.set(col[4], nearest(col));
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rows[y * (width + 1) + 1 + x] = index.get((rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]);
    }
  }
  return encodePng(width, height, rows, 3, [chunk('PLTE', palette)]);
}

/** Smallest faithful PNG under the limit: re-encode losslessly first, then fall back to a palette. */
function shrinkPng(buf, limit) {
  const img = decodePng(buf);
  if (!img) return buf;
  let best = buf;
  const rgbPng = encodeRgb(img);
  if (rgbPng.length < best.length) best = rgbPng;
  if (best.length > limit) {
    const pal = encodePalette(img);
    if (pal.length < best.length) best = pal;
  }
  return best;
}

// ------------------------------------------------------------------ Playwright: og.png and screenshots

async function loadPlaywright() {
  if (!existsSync(PLAYWRIGHT)) {
    console.error('Playwright is not installed. Run: cd tests/e2e && npm install');
    process.exit(2);
  }
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    console.error(`Could not start Chrome: ${String(err.message || err).split('\n')[0]}. Install Google Chrome and try again.`);
    process.exit(2);
  }
}

/** The social card: wordmark, tagline, product line on the left; the hero band on the right. */
function ogHtml() {
  const svg = new Svg('light', 'og');
  // The hero in miniature, no text: a band that loses three failing slices, two success chips above.
  // Each slice runs along the bottom of its stage, then swings down as a ribbon, as in the funnel visual.
  const X0 = 24, TB = 236, CW = 138, END = X0 + CW * 3, RUN = 64, FALL = 60, C = 0.5523;
  const thick = [150, 124, 106, 94];
  svg.raw('<defs><linearGradient id="og-band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:#3A56D4;stop-opacity:0.30"/><stop offset="1" style="stop-color:#3A56D4;stop-opacity:0.14"/></linearGradient></defs>');
  const drops = [0, 1, 2].map((i) => {
    const w = thick[i] - thick[i + 1];
    return { w, x0: i ? X0 + i * CW : X0 + 16, xs: X0 + i * CW + 34, ya: TB + thick[i + 1], yb: TB + thick[i] };
  });
  let d = `M${X0} ${TB}H${END + 12}V${TB + thick[3]}`;
  for (let i = 2; i >= 0; i--) d += `H${drops[i].x0}V${drops[i].yb}`;
  d += `H${X0}V${TB}Z`;
  svg.raw(`<path d="${d}" style="fill:url(#og-band)"/>`);
  svg.line(X0, TB, END, TB, { stroke: 'accent', sw: 3 });
  for (const p of drops) {
    const xi = p.xs + RUN, xo = xi + p.w, y2 = p.yb + FALL;
    svg.raw(`<path d="M${p.x0} ${p.ya}H${p.xs}C${n(p.xs + C * (xo - p.xs))} ${p.ya} ${xo} ${n(y2 - C * (y2 - p.ya))} ${xo} ${y2}V640`
      + `H${xi}V${y2}C${xi} ${n(y2 - C * FALL)} ${n(p.xs + C * RUN)} ${p.yb} ${p.xs} ${p.yb}H${p.x0}Z" style="fill:#BE3E29;fill-opacity:.85"/>`);
  }
  [[X0 + 10, 118], [X0 + 2 * CW + 10, 118]].forEach(([x, w]) => {
    svg.rect(x, 156, w, 48, { r: 24, fill: 'good-soft', stroke: 'good', sw: 2 });
    svg.path(`M${x + 20} 180l7 7l14 -15`, { stroke: 'good', sw: 3.5, cap: 'round', join: 'round' });
    svg.rect(x + 52, 175, w - 72, 10, { r: 5, fill: 'good', fo: 0.35 });
  });
  svg.rect(END, TB, 56, 126, { r: 14, fill: 'good-soft', stroke: 'good', sw: 2 });
  svg.path(`M${END + 17} ${TB + 64}l7 7l14 -15`, { stroke: 'good', sw: 3.5, cap: 'round', join: 'round' });
  const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 630" width="520" height="630">${svg.parts.join('')}</svg>`;
  const t = TOKENS.light;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;700&family=Instrument+Serif:ital@1&display=block">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:${t.bg}}
.card{position:relative;width:1200px;height:630px;font-family:"Instrument Sans",${FONT}}
.text{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center}
.mark{display:flex;align-items:center;gap:14px;font-weight:700;font-size:28px;color:${t.ink};letter-spacing:-0.01em;margin-bottom:40px}
.mark svg{width:34px;height:34px}
h1{margin:0;font:italic 400 60px/1.06 "Instrument Serif",Georgia,serif;color:${t.ink};letter-spacing:-0.01em}
p{margin:30px 0 0;font-weight:500;font-size:28px;color:${t['ink-2']}}
.art{position:absolute;left:640px;top:0}
</style></head><body><div class="card">
<div class="text">
<div class="mark"><svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="6" rx="3" fill="${t.accent}"/><rect x="7.5" y="13" width="17" height="6" rx="3" fill="${t.accent}"/><rect x="12" y="21" width="8" height="6" rx="3" fill="${t.accent}"/></svg>pmstack</div>
<h1>Find how your AI product fails. Then prove it's fixed.</h1>
<p>Eval Studio for product managers</p>
</div>
<div class="art">${art}</div>
</div></body></html>`;
}

async function renderOg(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(ogHtml(), { waitUntil: 'networkidle' }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)).catch(() => []);
  if (!fonts.some((f) => /Instrument Serif/.test(f))) console.warn('Instrument Serif did not load (offline?); og.png uses a fallback serif.');
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  mkdirSync(dirname(OG_PATH), { recursive: true });
  const out = shrinkPng(png, 300 * 1024);
  writeFileSync(OG_PATH, out);
  console.log(`Wrote docs/assets/og.png (${Math.round(out.length / 1024)} KB)`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };

/** A tiny static server over docs/ on 127.0.0.1 (random port). */
function serveDocs() {
  const root = join(ROOT, 'docs');
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (pathname === '/studio/api/info' || pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"mode":"static"}');
      return;
    }
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { res.writeHead(404).end(); return; }
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/** An unreviewed text message trace whose reply shows raw ** symbols, as early in the conversation as possible. */
function reviewTraceId(clinic) {
  let best = null;
  for (const t of clinic.traces) {
    if (clinic.reviews?.[t.id] || t.metadata?.channel !== 'sms') continue;
    let before = 0;
    for (const m of t.messages || []) {
      const text = typeof m.content === 'string' ? m.content : '';
      const at = m.role === 'assistant' ? text.indexOf('**') : -1;
      if (at >= 0) {
        if (!best || before + at < best.before) best = { id: t.id, before: before + at };
        break;
      }
      if (m.role !== 'system') before += text.length;
    }
  }
  return best ? best.id : null;
}

async function captureScreens(browser, D) {
  const traceId = reviewTraceId(D.clinic);
  if (!traceId) return ['The dental booking sample has no unreviewed text message whose reply shows ** symbols, so there is no review screenshot to take.'];
  const stageName = D.clinic.experience.stages[D.clinic.experience.stages.length - 1].label;
  const { server, base } = await serveDocs();
  mkdirSync(SCREENS_DIR, { recursive: true });
  const LIMIT = 400 * 1024;
  const failures = [];
  const save = async (name, png) => {
    const out = shrinkPng(png, LIMIT);
    writeFileSync(join(SCREENS_DIR, name), out);
    const kb = Math.round(out.length / 1024);
    console.log(`Wrote docs/assets/screens/${name} (${kb} KB)${out.length > LIMIT ? ' OVER 400 KB' : ''}`);
    if (out.length > LIMIT) failures.push(`${name} is ${kb} KB`);
  };
  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
      await context.addInitScript((t) => { try { localStorage.setItem('pmstack-theme', t); } catch { /* private mode */ } }, theme);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') console.warn(`  (${theme}) console error: ${m.text()}`); });
      const settle = async () => {
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);
      };
      // Every screenshot needs its page parts. A missing one stops this theme with a message that
      // names the screenshot and the selector, instead of saving a screenshot that shows the wrong thing.
      const need = async (shot, locator, what, timeout = 10000) => {
        try {
          await locator.first().waitFor({ state: 'visible', timeout });
        } catch {
          throw new Error(`${shot}: could not find ${what}. The page has changed; update captureScreens in scripts/build-visuals.mjs.`);
        }
        return locator.first();
      };
      const expect = async (shot, ok, what) => {
        if (!(await ok())) throw new Error(`${shot}: ${what}. The page has changed; update captureScreens in scripts/build-visuals.mjs.`);
      };
      try {
        // Open the dental sample in a clean profile (the app lands on Review traces).
        await page.goto(`${base}/studio/#/open/clinic-booking`);
        await page.waitForFunction(() => location.hash.startsWith('#/review'), null, { timeout: 20000 }).catch(() => {
          throw new Error('Opening #/open/clinic-booking did not land on Review traces.');
        });

        // The Funnel tab, before anything changes the sample's numbers.
        let shot = `funnel-tab-${theme}.png`;
        await page.evaluate(() => { location.hash = '#/funnel'; });
        await need(shot, page.locator('.funnel-svg'), 'the funnel drawing (.funnel-svg)');
        await settle();
        await save(shot, await page.screenshot({ type: 'png' }));

        // Review traces: a text message whose reply shows raw ** symbols, marked Problem with a note and a stage.
        shot = `review-${theme}.png`;
        await page.evaluate((id) => { location.hash = `#/review/${encodeURIComponent(id)}`; }, traceId);
        await need(shot, page.locator('.review-id', { hasText: traceId }), `trace ${traceId} open in Review traces (.review-id)`);
        const strip = page.locator('.review-strip').getByRole('button', { name: 'Dismiss' });
        if (await strip.count()) await strip.first().click();
        const note = await need(shot, page.locator('#review-note-box'), 'the note box (#review-note-box)');
        await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await page.keyboard.press('2');
        const problem = page.locator('.review-verdicts .review-verdict', { hasText: 'Problem' });
        await need(shot, problem, 'the Problem button (.review-verdicts .review-verdict)');
        await expect(shot, async () => (await problem.first().getAttribute('aria-pressed')) === 'true', 'pressing 2 did not select Problem');
        await note.fill('The text shows raw ** symbols around words. On a phone it looks broken.');
        await note.blur();
        const stages = await need(shot, page.locator('section[aria-labelledby="review-stage-title"]'), 'the stage picker (#review-stage-title)');
        const chip = await need(shot, stages.getByRole('button', { name: new RegExp(escapeRe(stageName)) }), `the stage chip "${stageName}"`);
        // Mark the reply as the first thing that went wrong (this also picks its stage), as a reviewer would.
        const reply = page.locator('.review-center [data-step-id]').filter({ hasText: '**' }).last();
        if (await reply.count()) {
          await reply.hover();
          const pick = reply.locator('.rv-pick').first();
          if (await pick.count()) await pick.click();
        }
        if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
        await expect(shot, async () => (await chip.getAttribute('aria-pressed')) === 'true', `the stage chip "${stageName}" did not stay selected`);
        // Tag the failure mode, then frame the panels: judgment from the top, the open trace near the top of the list.
        const modeName = D.clinic.modes.find((m) => m.id === 'fm-stray-symbols-in-texts')?.name;
        const modeChip = page.locator('section[aria-labelledby="review-modes-title"]').getByRole('button', { name: modeName || '(none)', exact: true });
        if (modeName && await modeChip.count()) await modeChip.click();
        await page.evaluate(() => {
          const panel = document.querySelector('.review-judge-scroll');
          if (panel) panel.scrollTop = 0;
          const rows = [...document.querySelectorAll('.review-list .review-row-item')];
          const top = rows[Math.max(0, rows.findIndex((li) => li.querySelector('.is-current')) - 2)];
          const box = top && top.closest('.review-scroll');
          if (box) box.scrollTop += top.getBoundingClientRect().top - box.getBoundingClientRect().top;
        });
        await settle();
        await save(shot, await page.screenshot({ type: 'png' }));

        // Four trace views in a 2 x 2 grid. The injected style only frames the screenshot:
        // each cell shows the top of its view and fades out, so all four fit in one frame.
        shot = `views-${theme}.png`;
        await page.goto(`${base}/studio/dev/renderers.html?views=email,answer,list,agent&bare=1&compact=1&theme=${theme}`);
        await need(shot, page.locator('.dv-page .dv-grid'), 'the view grid (.dv-page .dv-grid)');
        await need(shot, page.locator('.dv-case [data-step-id]'), 'a drawn trace step (.dv-case [data-step-id])');
        const cases = await page.locator('.dv-grid .dv-case').count();
        await expect(shot, async () => cases === 4, `the grid shows ${cases} views instead of 4 (.dv-grid .dv-case)`);
        await page.addStyleTag({ content: '.dv-page{max-width:none;padding:28px 40px}.dv-grid{gap:28px 40px}.dv-case-file{display:none}'
          + '.dv-case{height:458px;overflow:hidden;position:relative;align-content:start}'
          + '.dv-case::after{content:"";position:absolute;left:0;right:0;bottom:0;height:64px;pointer-events:none;'
          + 'background:linear-gradient(to bottom,transparent,var(--bg))}' });
        await settle();
        await save(shot, await page.screenshot({ type: 'png' }));
      } catch (err) {
        failures.push(`${theme}: ${String(err.message || err).split('\n')[0]}`);
      }
      if (errors.length) failures.push(`${theme}: page errors: ${errors.join('; ')}`);
      await context.close();
    }
  } finally {
    server.close();
  }
  return failures;
}

/** Page script for the demo recording only: a drawn cursor (headless Chrome has none) and a caption for each key press. */
function demoOverlay() {
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '#demo-cursor{position:fixed;left:-40px;top:-40px;z-index:2147483647;pointer-events:none;margin:-2px 0 0 -3px;transition:transform .08s ease-out}'
      + '#demo-cursor.down{transform:scale(.85)}'
      + '#demo-keys{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;display:none;align-items:center;gap:8px;'
      + 'padding:9px 16px;border-radius:12px;background:#16191D;color:#fff;font:600 16px/1.2 "Instrument Sans",ui-sans-serif,system-ui,sans-serif}'
      + '#demo-keys kbd{font:600 14px/1 "JetBrains Mono",ui-monospace,monospace;padding:6px 8px;border-radius:6px;background:#fff;color:#16191D;min-width:12px;text-align:center}'
      + '#demo-keys span{margin-left:4px}';
    document.head.appendChild(style);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('id', 'demo-cursor');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 22 22');
    const arrow = document.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M3 2l14 9.5-6.2 1.2 3.6 7-2.6 1.3-3.6-7L3 18z');
    arrow.setAttribute('fill', '#16191D');
    arrow.setAttribute('stroke', '#fff');
    arrow.setAttribute('stroke-width', '1.6');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(arrow);
    document.body.appendChild(svg);
    const keys = document.createElement('div');
    keys.id = 'demo-keys';
    document.body.appendChild(keys);
    addEventListener('mousemove', (e) => { svg.style.left = e.clientX + 'px'; svg.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => svg.classList.add('down'), true);
    addEventListener('mouseup', () => svg.classList.remove('down'), true);
    let timer = 0;
    window.demoKeys = (parts, label) => {
      keys.replaceChildren(...parts.map((p) => Object.assign(document.createElement('kbd'), { textContent: p })),
        Object.assign(document.createElement('span'), { textContent: label }));
      keys.style.display = 'flex';
      clearTimeout(timer);
      timer = setTimeout(() => { keys.style.display = 'none'; }, 1500);
    };
  });
}

/**
 * docs/assets/screens/demo.gif: Welcome, open the dental booking sample, review two traces with keys,
 * then Failure modes and Funnel. Playwright records the page (page.screencast), ffmpeg makes the GIF
 * (one palette for the whole clip, 1200 px wide, 12 frames a second).
 */
async function recordDemo(browser) {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return ['--demo needs ffmpeg. Install ffmpeg and try again.'];
  const W = 1200, H = 750, LIMIT = 4 * 1024 * 1024;
  const { server, base } = await serveDocs();
  const tmp = mkdtempSync(join(tmpdir(), 'pmstack-demo-'));
  const failures = [];
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
    await context.addInitScript(() => { try { localStorage.setItem('pmstack-theme', 'light'); } catch { /* private mode */ } });
    await context.addInitScript(demoOverlay);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    let mx = W * 0.62, my = H * 0.56;
    const glide = async (x, y) => {
      await page.mouse.move(x, y, { steps: Math.max(8, Math.round(Math.hypot(x - mx, y - my) / 26)) });
      mx = x; my = y;
    };
    // When the element is out of sight, scroll every box around it smoothly to center it, then wait for it to settle.
    const reveal = async (loc) => {
      await loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        let top = 0, bottom = innerHeight;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY)) continue;
          const q = p.getBoundingClientRect();
          top = Math.max(top, q.top);
          bottom = Math.min(bottom, q.bottom);
        }
        if (r.top < top + 8 || r.bottom > bottom - 8) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      let last = '';
      for (let i = 0; i < 30; i++) {
        await wait(60);
        const now = JSON.stringify(await loc.boundingBox());
        if (now === last) break;
        last = now;
      }
    };
    const click = async (loc) => {
      await reveal(loc);
      const b = await loc.boundingBox();
      await glide(b.x + Math.min(b.width / 2, 48), b.y + b.height / 2);
      await wait(220);
      await page.mouse.down();
      await wait(90);
      await page.mouse.up();
    };
    const press = async (key, parts, label) => {
      await page.evaluate(([p, l]) => window.demoKeys && window.demoKeys(p, l), [parts, label]);
      await wait(380);
      await page.keyboard.press(key);
    };
    const step = async (what, fn) => {
      try { await fn(); } catch (err) { throw new Error(`demo.gif: ${what}: ${String(err.message || err).split('\n')[0]}`); }
    };
    const mod = process.platform === 'darwin' ? String.fromCharCode(0x2318) : 'Ctrl';
    const openTrace = (id) => page.locator('.review-id', { hasText: id }).first().waitFor();

    const frames = [];
    try {
      await step('open the Welcome page', async () => {
        await page.goto(`${base}/studio/#/`);
        await page.locator('a.welcome-sample[href="#/open/clinic-booking"]').waitFor();
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.mouse.move(mx, my);
        await wait(300);
      });
      await page.screencast.start({ size: { width: W, height: H }, quality: 100, onFrame: ({ data, timestamp }) => { frames.push({ data, timestamp }); } });
      await step('open the dental booking sample', async () => {
        await glide(mx - 30, my + 12);
        await wait(1300);
        const head = page.locator('#welcome-samples-title');
        const dy = (await head.boundingBox()).y - 110;
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, dy / 8); await wait(45); }
        await wait(700);
        await click(page.locator('a.welcome-sample[href="#/open/clinic-booking"]'));
        await page.waitForFunction(() => location.hash.startsWith('#/review'), null, { timeout: 20000 });
        await page.locator('#review-note-box').waitFor();
        await wait(1300);
      });
      await step('review a Good trace', async () => {
        await click(page.locator('.review-list a.review-row[data-trace-id="t-0111"]'));
        await openTrace('t-0111');
        await glide(700, 520);
        await wait(2000);
        await press('1', ['1'], 'Good');
        await wait(900);
        await press('ControlOrMeta+Enter', [mod, 'Enter'], 'Next trace');
        await openTrace('t-0112');
      });
      await step('review a Problem trace', async () => {
        await wait(2400);
        await press('2', ['2'], 'Problem');
        await wait(800);
        await press('n', ['N'], 'Write a note');
        await wait(250);
        await page.keyboard.type('Asked twice for someone to call her. It kept offering times by text.', { delay: 30 });
        await wait(400);
        await press('Escape', ['Esc'], 'Leave the note box');
        await wait(600);
        await click(page.locator('section[aria-labelledby="review-stage-title"]').getByRole('button', { name: /Hand off when needed/ }));
        await wait(600);
        const mode = page.locator('section[aria-labelledby="review-modes-title"]').getByRole('button', { name: 'Ignores requests for a person', exact: true });
        await click(mode);
        await wait(1100);
        await press('ControlOrMeta+Enter', [mod, 'Enter'], 'Next trace');
        await openTrace('t-0113');
        await wait(900);
      });
      await step('open Failure modes', async () => {
        await click(page.locator('a.navtab').filter({ has: page.locator('.navtab-label', { hasText: 'Failure modes' }) }));
        await page.waitForFunction(() => location.hash.startsWith('#/modes'));
        const row = page.getByText('Ignores requests for a person', { exact: true }).first();
        await row.waitFor();
        const b = await row.boundingBox();
        await glide(b.x + b.width / 2, b.y + b.height / 2);
        await wait(2400);
      });
      await step('open the Funnel', async () => {
        await click(page.locator('a.navtab').filter({ has: page.locator('.navtab-label', { hasText: 'Funnel' }) }));
        await page.waitForFunction(() => location.hash.startsWith('#/funnel'));
        await page.locator('.funnel-svg').waitFor();
        const label = page.locator('.funnel-svg').getByText('for a person').first();
        const b = (await label.count()) ? await label.boundingBox() : null;
        await glide(b ? b.x + b.width / 2 : 600, b ? b.y + b.height / 2 : 520);
        await wait(3000);
      });
    } finally {
      await page.screencast.stop().catch(() => {});
      await context.close();
    }
    if (errors.length) failures.push(`demo.gif: page errors: ${errors.join('; ')}`);
    if (frames.length < 2) throw new Error('demo.gif: the recording has no frames.');

    // One concat list with each frame's real duration; the last frame holds for 1.5 seconds.
    const lines = ['ffconcat version 1.0'];
    frames.forEach((f, i) => {
      const name = `f${String(i).padStart(5, '0')}.jpg`;
      writeFileSync(join(tmp, name), f.data);
      const next = frames[i + 1];
      lines.push(`file '${name}'`, `duration ${next ? Math.max(0.001, (next.timestamp - f.timestamp) / 1000).toFixed(4) : '1.5'}`);
    });
    lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
    writeFileSync(join(tmp, 'frames.ffconcat'), lines.join('\n') + '\n');
    const out = join(SCREENS_DIR, 'demo.gif');
    mkdirSync(SCREENS_DIR, { recursive: true });
    const run = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'frames.ffconcat'),
      '-vf', `fps=12,scale=${W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`demo.gif: ffmpeg failed: ${(run.stderr || '').trim().split('\n')[0]}`);
    const size = statSync(out).size;
    const seconds = (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000 + 1.5;
    console.log(`Wrote docs/assets/screens/demo.gif (${(size / 1024 / 1024).toFixed(2)} MB, ${seconds.toFixed(1)} s)${size > LIMIT ? ' OVER 4 MB' : ''}`);
    if (size > LIMIT) failures.push(`demo.gif is ${(size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    failures.push(String(err.message || err).split('\n')[0]);
  } finally {
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  return failures;
}

// ------------------------------------------------------------------ main

async function main(argv) {
  const flags = new Set(argv);
  const unknown = argv.filter((a) => !['--check', '--png', '--screens', '--demo', '-h', '--help'].includes(a));
  if (flags.has('-h') || flags.has('--help') || unknown.length) {
    if (unknown.length) console.error(`Unknown option: ${unknown.join(' ')}`);
    console.log('Usage: node scripts/build-visuals.mjs [--check] [--png] [--screens] [--demo]\n'
      + '  (no flags)  write docs/assets/visuals/*.svg\n'
      + '  --check     rebuild in memory and exit 1 if any committed visual differs\n'
      + '  --png       also render docs/assets/og.png\n'
      + '  --screens   also capture docs/assets/screens/*.png\n'
      + '  --demo      also record docs/assets/screens/demo.gif (needs ffmpeg)');
    return unknown.length ? 2 : 0;
  }
  const { files, data } = buildVisuals();
  if (flags.has('--check')) {
    const problems = checkVisuals(files);
    if (problems.length) {
      console.error(`Visuals are out of date. Run: node scripts/build-visuals.mjs\n  ${problems.join('\n  ')}`);
      return 1;
    }
    console.log(`All ${files.size} visuals are up to date.`);
    return 0;
  }
  mkdirSync(VISUALS_DIR, { recursive: true });
  let changed = 0;
  for (const [name, text] of files) {
    const path = join(VISUALS_DIR, name);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    writeFileSync(path, text);
    changed++;
  }
  console.log(`Wrote ${changed} of ${files.size} visuals in docs/assets/visuals/.`);
  if (!flags.has('--png') && !flags.has('--screens') && !flags.has('--demo')) return 0;
  const browser = await loadPlaywright();
  let code = 0;
  try {
    if (flags.has('--png')) await renderOg(browser);
    if (flags.has('--screens')) {
      const failures = await captureScreens(browser, data);
      if (failures.length) { console.error(`Screenshots need attention:\n  ${failures.join('\n  ')}`); code = 1; }
    }
    if (flags.has('--demo')) {
      const failures = await recordDemo(browser);
      if (failures.length) { console.error(`The demo needs attention:\n  ${failures.join('\n  ')}`); code = 1; }
    }
  } finally {
    await browser.close();
  }
  return code;
}

export { buildVisuals, checkVisuals, shrinkPng, decodePng, encodeRgb, encodePalette, main };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}
