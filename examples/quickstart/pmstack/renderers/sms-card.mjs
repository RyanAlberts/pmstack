// sms-card: a custom view for Eval Studio. Each exchange in a text message conversation
// (what the patient sent, what the assistant did behind the scenes, and what it texted back)
// is one compact card. Replies show every character exactly as the patient's phone got it,
// with a character count and how many texts the reply took.
//
// Use it by setting "renderer": "custom:sms-card" in pmstack/project.json, then run
// `node bin/pmstack.mjs studio examples/quickstart`. Custom views follow the trace view
// contract: they import only pmstack/ui, pmstack/renderers/common, and preact/hooks, take the
// view props (trace, experience, showHidden, pickedStepId, onPickStep, highlights, stepBadges,
// compact), and put data-step-id on every step they draw.

import { html, useMemo, classes, plural } from 'pmstack/ui';
import {
  StepMeta, PickButton, Highlightable, LongText, BehindTheScenes, ToolCall, StepCard, EmptyTrace,
  pairSteps, withHidden, itemIds, highlightsFor, stepAttrs, userName, timeOfDay, dayLabel,
  isEpoch, clock, asText,
} from 'pmstack/renderers/common';

// ---------------------------------------------------------------------------
// Styles, added once. Colors come only from the studio's tokens, so light and dark both work.

const CSS = `
.smsc { display: grid; gap: 12px; min-width: 0; container: smsc / inline-size; color: var(--ink); }
.smsc-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin: 0; color: var(--ink-3); font-size: var(--text-xs); }
.smsc-top strong { color: var(--ink); font-size: var(--text-sm); font-weight: 600; }
.smsc-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.smsc-card {
  display: grid; grid-template-columns: 80px minmax(0, 1fr); min-width: 0;
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow);
}
.smsc-gutter { display: flex; flex-direction: column; gap: 4px; padding: 14px 0 12px 14px; min-width: 0; color: var(--ink-3); }
.smsc-num { font: 500 var(--text-lg)/1 var(--font-mono); letter-spacing: -0.02em; color: var(--ink); }
.smsc-when { font: 400 var(--text-xs)/1.35 var(--font-mono); white-space: nowrap; }
.smsc-body { display: grid; gap: 6px; min-width: 0; padding: 8px 10px 10px 4px; }
.smsc-line { position: relative; display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 2px 12px; padding: 8px 10px; border-radius: 8px; }
.smsc-line > .rv-pick-float { top: -13px; left: auto; right: 8px; }
.smsc-line.is-them { background: var(--surface-2); }
.smsc-line.is-us { background: var(--accent-soft); }
.smsc-line.is-picked { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bad) 45%, transparent); }
.smsc-line.is-picked::before { left: 0; top: 6px; bottom: 6px; }
.smsc-who { padding-top: 1px; font: 600 var(--text-xs)/1.5 var(--font-sans); color: var(--ink-2); }
.smsc-text .rv-text { font-size: var(--text-sm); line-height: 1.5; color: var(--ink); }
.smsc-foot { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-height: 0; }
.smsc-foot:empty { display: none; }
.smsc-foot .rv-meta { margin-top: 0; }
.smsc-count { display: inline-flex; align-items: center; gap: 6px; font: 400 var(--text-xs)/1.4 var(--font-mono); color: var(--ink-2); }
.smsc-meter { display: inline-flex; gap: 3px; }
.smsc-meter i { position: relative; display: block; width: 26px; height: 5px; overflow: hidden; border-radius: 3px; background: color-mix(in srgb, var(--ink-3) 28%, transparent); }
.smsc-meter b { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--ink-2); }
.smsc-steps { display: grid; gap: 6px; min-width: 0; margin-left: 110px; }
.smsc-steps .rv-bts { margin: 0; }
.smsc-before { display: grid; gap: 6px; min-width: 0; }
.smsc.is-compact { gap: 8px; }
.smsc.is-compact .smsc-card { box-shadow: none; }
.smsc.is-compact .smsc-gutter { padding: 10px 0 8px 10px; }
@container smsc (max-width: 560px) {
  .smsc-card { grid-template-columns: minmax(0, 1fr); }
  .smsc-gutter { flex-direction: row; align-items: baseline; gap: 10px; padding: 10px 12px 0; }
  .smsc-num { font-size: var(--text-md); }
  .smsc-body { padding: 6px 8px 8px; }
  .smsc-line { grid-template-columns: minmax(0, 1fr); }
  .smsc-foot { grid-column: 1; }
  .smsc-steps { margin-left: 0; }
}
`;

if (typeof document !== 'undefined' && !document.getElementById('smsc-style')) {
  const style = document.createElement('style');
  style.id = 'smsc-style';
  style.textContent = CSS;
  document.head.append(style);
}

// ---------------------------------------------------------------------------
// Grouping: one exchange per message the patient sent.

function stepText(step) {
  if (step.kind === 'output') {
    const d = step.data || {};
    return String(d.text ?? d.body ?? step.text ?? asText(d));
  }
  return String(step.text ?? '');
}

const isVisible = (s) => s.customerVisible && (s.kind === 'user' || s.kind === 'assistant' || s.kind === 'output');

function exchangesOf(trace) {
  const before = [];
  const list = [];
  let current = null;
  for (const item of pairSteps(trace.steps || [])) {
    const s = item.type === 'step' ? item.step : null;
    if (s && s.kind === 'user' && s.customerVisible) {
      current = { key: s.id, user: s, items: [] };
      list.push(current);
    } else if (current) current.items.push(item);
    else before.push(item);
  }
  if (!list.length) {
    // No message from the patient: one exchange around the input, or around whatever the trace has.
    const start = before.filter((it) => !(it.type === 'step' && it.step.kind === 'system'));
    const setup = before.filter((it) => it.type === 'step' && it.step.kind === 'system');
    if (trace.input || start.length) return { before: setup, list: [{ key: 'input', user: null, input: trace.input || '', items: start }] };
  }
  // The assistant spoke first (a greeting on a call, a reminder text): that opens its own card.
  const opener = before.findIndex((it) => it.type === 'step' && isVisible(it.step));
  if (opener >= 0) list.unshift({ key: 'open', user: null, input: null, items: before.splice(opener) });
  return { before, list };
}

// A text message holds 160 plain characters, or 70 when it has emoji or other special characters.
// Longer replies are split into parts of 153 (or 67).
function textsFor(text) {
  const plain = /^[\x20-\x7E\n\r]*$/.test(text);
  const one = plain ? 160 : 70;
  const part = plain ? 153 : 67;
  const n = text.length;
  return n <= one ? { texts: 1, size: one } : { texts: Math.ceil(n / part), size: part };
}

function channelOf(trace) {
  const c = String(trace.metadata?.channel ?? '').trim().toLowerCase();
  if (['sms', 'text', 'text message', 'mms', 'whatsapp'].includes(c)) return 'sms';
  if (['voice', 'phone', 'call', 'phone call'].includes(c)) return 'voice';
  return 'web';
}

const CHANNEL_WORDS = { sms: 'Text messages', voice: 'Phone call', web: 'Web chat' };

// ---------------------------------------------------------------------------
// Pieces

// One small bar per text the reply took; the last bar fills as that text fills up.
function TextCount({ text }) {
  const n = text.length;
  const { texts, size } = textsFor(text);
  const bars = Array.from({ length: Math.min(texts, 6) }, (_, i) => {
    const fill = i < texts - 1 ? 1 : (n - size * (texts - 1)) / size;
    return html`<i key=${i}><b style=${{ width: Math.max(8, Math.round(fill * 100)) + '%' }}></b></i>`;
  });
  return html`<span class="smsc-count">
    <span class="smsc-meter" aria-hidden="true">${bars}</span>
    <span>${plural(n, 'character')}, ${texts === 1 ? '1 text' : `sent as ${texts} texts`}</span>
  </span>`;
}

function Line({ step, props, who, side, sms, input }) {
  const text = step ? stepText(step) : String(input ?? '');
  const hl = step ? highlightsFor(props.highlights, step.id) : [];
  const picked = !!step && props.pickedStepId === step.id;
  const attrs = step
    ? stepAttrs(props, step.id, classes('smsc-line', 'is-' + side))
    : { class: classes('smsc-line', 'is-' + side) };
  return html`<div ...${attrs}>
    <span class="smsc-who">${who}</span>
    <${LongText} class="smsc-text" text=${text} limit=${1200} highlights=${hl}
      render=${(t) => html`<${Highlightable} text=${t} highlights=${hl} />`} />
    <div class="smsc-foot">
      ${sms && side === 'us' && text && html`<${TextCount} text=${text} />`}
      ${step && html`<${StepMeta} ...${props} stepId=${step.id} stageId=${step.stage} />`}
    </div>
    ${step && html`<${PickButton} stepId=${step.id} stageId=${step.stage} onPickStep=${props.onPickStep} picked=${picked} floating=${true} />`}
  </div>`;
}

function Inside({ group, props }) {
  if (group.type === 'hidden') return html`<${BehindTheScenes} ...${props} items=${group.items} />`;
  if (group.type === 'tool') return html`<${ToolCall} ...${props} step=${group.call} result=${group.result} dense=${true} />`;
  return html`<${StepCard} ...${props} step=${group.step} />`;
}

function when(step, base) {
  const t = step && step.time;
  if (isEpoch(t)) return timeOfDay(t);
  if (typeof t === 'number' && base != null) return clock(t - base);
  return '';
}

function Exchange({ ex, index, props, who, sms, base }) {
  const groups = withHidden(ex.items, props.showHidden);
  const rows = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    rows.push(html`<div class="smsc-steps" key=${'s' + itemIds(pending[0])[0]}>${pending.map((g) => html`<${Inside} key=${itemIds(g)[0]} group=${g} props=${props} />`)}</div>`);
    pending = [];
  };
  for (const g of groups) {
    if (g.type === 'step' && isVisible(g.step)) {
      flush();
      rows.push(html`<${Line} key=${g.step.id} step=${g.step} props=${props} who="Assistant" side="us" sms=${sms} />`);
    } else pending.push(g);
  }
  flush();
  const firstStep = ex.user || (ex.items[0] && (ex.items[0].type === 'tool' ? ex.items[0].call : ex.items[0].step));
  const stamp = when(firstStep, base);
  return html`<li class="smsc-card">
    <div class="smsc-gutter">
      <span class="smsc-num" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
      <span class="sr-only">Exchange ${index + 1}</span>
      ${stamp && html`<span class="smsc-when">${stamp}</span>`}
    </div>
    <div class="smsc-body">
      ${(ex.user || ex.input) && html`<${Line} step=${ex.user} input=${ex.input} props=${props} who=${who} side="them" sms=${sms} />`}
      ${rows}
    </div>
  </li>`;
}

// ---------------------------------------------------------------------------

/** The sms-card view: one compact card per exchange. */
export default function SmsCardView(props) {
  const { trace, experience, showHidden, compact } = props;
  const { before, list } = useMemo(() => exchangesOf(trace), [trace]);
  const channel = channelOf(trace);
  const sms = channel === 'sms';
  const who = userName(experience);
  const times = (trace.steps || []).map((s) => s.time).filter((t) => typeof t === 'number');
  const base = times.length ? Math.min(...times) : null;
  const first = list[0] && list[0].user ? list[0].user.time : null;
  const setup = withHidden(before, showHidden);
  return html`<div class=${classes('rv-view', 'smsc', compact && 'is-compact')}>
    <p class="smsc-top">
      <strong>${CHANNEL_WORDS[channel]}</strong>
      <span>${plural(list.length, 'exchange')}</span>
      ${isEpoch(first) && html`<span>${dayLabel(first)}</span>`}
    </p>
    ${setup.length > 0 && html`<div class="smsc-before">${setup.map((g) => html`<${Inside} key=${itemIds(g)[0]} group=${g} props=${props} />`)}</div>`}
    ${list.length
      ? html`<ol class="smsc-list" aria-label="Exchanges">${list.map((ex, i) => html`<${Exchange} key=${ex.key} ex=${ex} index=${i} props=${props} who=${who} sms=${sms} base=${base} />`)}</ol>`
      : html`<${EmptyTrace}>This trace has no messages to show as cards.<//>`}
  </div>`;
}
