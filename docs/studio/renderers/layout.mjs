// "Build your own view" (SPEC 4): panels from experience.layout, each showing one field of the raw
// trace as text, formatted text, a chat, cards, a table, labeled details, or raw data.
// Each panel is a pickable step: panel:<i>.

import { html, classes } from 'pmstack/ui';
import { getPath } from '../lib/index.mjs';
import {
  PickButton, Markdown, LongText, DataView, JsonBlock, EmptyTrace, StepBadges, FirstProblemTag,
  stepAttrs, highlightsFor, badgesFor, asText, maybeJson, userName, makeMarker,
} from './common.mjs';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isPrim = (v) => v == null || typeof v !== 'object';
const TITLE_KEYS = ['title', 'name', 'label', 'subject', 'id', 'sku'];
const SUB_KEYS = ['subtitle', 'summary', 'price', 'status'];
const USER_ROLES = new Set(['user', 'human', 'customer', 'caller']);

function roleSide(m) {
  const r = String(m?.role ?? m?.speaker ?? m?.author ?? '').toLowerCase();
  if (USER_ROLES.has(r)) return 'them';
  if (r === 'system') return 'system';
  if (r === 'tool' || r === 'function') return 'tool';
  return 'us';
}

function ChatPanel({ value, experience, hl }) {
  const list = Array.isArray(value) ? value : [value];
  const who = userName(experience);
  return html`<ol class="rv-layout-chat">${list.map((m, i) => {
    const text = typeof m === 'string' ? m : asText(m?.content ?? m?.text ?? m?.message ?? m?.transcript ?? m);
    const side = typeof m === 'string' ? (i % 2 ? 'us' : 'them') : roleSide(m);
    if (side === 'system' || side === 'tool') {
      return html`<li key=${i} class="rv-layout-chat-note"><span class="rv-label">${side === 'system' ? 'Instructions' : 'Tool'}</span><${LongText} text=${text} limit=${280} /></li>`;
    }
    return html`<li key=${i} class=${classes('rv-msg', 'rv-msg-' + side)}>
      <span class="sr-only">${side === 'them' ? who : 'Assistant'}: </span>
      <div class="rv-bubble"><${Markdown} text=${text} highlights=${hl} /></div>
    </li>`;
  })}</ol>`;
}

function CardsPanel({ value, hl }) {
  const list = Array.isArray(value) ? value : [value];
  const marker = makeMarker(hl);
  return html`<ol class="rv-layout-cards">${list.map((it, i) => {
    if (!isObj(it)) return html`<li key=${i} class="rv-layout-card"><p class="rv-layout-card-title">${marker.mark(asText(it))}</p></li>`;
    const tk = TITLE_KEYS.find((k) => it[k] != null && isPrim(it[k]));
    const sk = SUB_KEYS.find((k) => k !== tk && it[k] != null && isPrim(it[k]));
    // A nested group of plain values (like details: { Price, Why }) reads better as rows of its own.
    const rest = Object.entries(it).filter(([k]) => k !== tk && k !== sk)
      .flatMap(([k, v]) => (isObj(v) && Object.values(v).every(isPrim) ? Object.entries(v) : [[k, v]]));
    return html`<li key=${i} class="rv-layout-card">
      <p class="rv-layout-card-title">${marker.mark(tk ? asText(it[tk]) : `Item ${i + 1}`)}</p>
      ${sk && html`<p class="rv-layout-card-sub">${marker.mark(asText(it[sk]))}</p>`}
      ${rest.length > 0 && html`<dl class="rv-layout-card-rows">${rest.map(([k, v]) => html`<div key=${k}>
        <dt>${k}</dt><dd>${isPrim(v) ? marker.mark(v == null ? 'none' : String(v)) : html`<${DataView} value=${v} depth=${2} limit=${200} />`}</dd>
      </div>`)}</dl>`}
    </li>`;
  })}</ol>`;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (isPrim(v)) return String(v);
  if (Array.isArray(v) && v.every(isPrim)) return v.join(', ');
  return asText(v);
}

function TablePanel({ value }) {
  let head;
  let rows;
  if (Array.isArray(value) && value.length && value.every(isObj)) {
    head = [];
    for (const o of value) for (const k of Object.keys(o)) if (!head.includes(k) && head.length < 12) head.push(k);
    rows = value.map((o) => head.map((k) => cellText(o[k])));
  } else if (Array.isArray(value)) {
    head = ['Value'];
    rows = value.map((v) => [cellText(v)]);
  } else if (isObj(value)) {
    head = ['Field', 'Value'];
    rows = Object.entries(value).map(([k, v]) => [k, cellText(v)]);
  } else {
    head = ['Value'];
    rows = [[cellText(value)]];
  }
  if (!rows.length) return html`<p class="rv-layout-none">The table is empty.</p>`;
  return html`<div class="rv-dv-scroll"><table class="rv-dv-table">
    <thead><tr>${head.map((h) => html`<th key=${h} scope="col">${h}</th>`)}</tr></thead>
    <tbody>${rows.slice(0, 200).map((r, i) => html`<tr key=${i}>${r.map((c, k) => html`<td key=${k}>${c}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

function PanelBody({ as, value, experience, hl }) {
  switch (as) {
    case 'markdown':
      return html`<${LongText} text=${asText(value)} limit=${4000} highlights=${hl} render=${(t) => html`<${Markdown} text=${t} highlights=${hl} />`} />`;
    case 'chat':
      return html`<${ChatPanel} value=${maybeJson(value)} experience=${experience} hl=${hl} />`;
    case 'cards':
      return html`<${CardsPanel} value=${maybeJson(value)} hl=${hl} />`;
    case 'table':
      return html`<${TablePanel} value=${maybeJson(value)} />`;
    case 'details':
      return html`<${DataView} value=${value} />`;
    case 'json':
      return html`<${JsonBlock} value=${value} label="Raw data" open=${true} />`;
    default:
      return typeof value === 'string'
        ? html`<${LongText} text=${value} limit=${2000} highlights=${hl} />`
        : html`<${DataView} value=${value} />`;
  }
}

/** The "Build your own view" layout. */
export default function LayoutView(props) {
  const { trace, experience, compact } = props;
  const layout = Array.isArray(experience?.layout) ? experience.layout.filter((p) => p && p.path != null) : [];
  if (!layout.length) {
    return html`<div class=${classes('rv-view', 'rv-layout', compact && 'is-compact')}>
      <${EmptyTrace}>This view has no panels yet. Add them in Set up, under "Build your own view".<//>
    </div>`;
  }
  const raw = trace.raw && typeof trace.raw === 'object' ? trace.raw : {};
  return html`<div class=${classes('rv-view', 'rv-layout', compact && 'is-compact')}>
    ${layout.map((p, i) => {
      const id = `panel:${i}`;
      const value = getPath(raw, p.path);
      const picked = props.pickedStepId === id;
      const hl = highlightsFor(props.highlights, id);
      const missing = value === undefined || value === null || value === '';
      return html`<section ...${stepAttrs(props, id, classes('rv-panel', 'rv-panel-' + (p.as || 'text')))} key=${id}>
        <div class="rv-panel-head">
          <h3 class="rv-panel-title">${p.label || p.path}</h3>
          <span class="rv-card-tags">
            <${StepBadges} badges=${badgesFor(props.stepBadges, id)} />
            ${picked && html`<${FirstProblemTag} />`}
          </span>
          <${PickButton} stepId=${id} stageId=${null} onPickStep=${props.onPickStep} picked=${picked} />
        </div>
        <div class="rv-panel-body">
          ${missing
            ? html`<p class="rv-layout-none">Nothing at <code>${String(p.path)}</code> in this trace.</p>`
            : html`<${PanelBody} as=${p.as} value=${value} experience=${experience} hl=${hl} />`}
        </div>
      </section>`;
    })}
  </div>`;
}
