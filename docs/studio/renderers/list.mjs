// Ranked list or cards view (SPEC 4): the request, then numbered cards (title, subtitle,
// detail rows, and the reason in muted text). Each card is its own pickable step: out.i<n>.

import { html, classes, plural } from 'pmstack/ui';
import {
  StepFlow, SurfaceLabel, PickButton, Markdown, LongText, EmptyTrace, StepBadges, FirstProblemTag,
  stepAttrs, highlightsFor, badgesFor, asText, makeMarker, findQuote,
} from './common.mjs';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// Quotes for the whole list land on the intro or the first card that holds them.
function homes(list, quotes) {
  const items = Array.isArray(list.items) ? list.items : [];
  const pieces = [['intro', asText(list.intro)], ...items.map((it, i) => ['i' + i, [it?.title, it?.subtitle, it?.reason, ...Object.values(isObj(it?.details) ? it.details : {})].map(asText).join('\n')])];
  const home = {};
  for (const q of quotes) {
    const hit = pieces.find(([, t]) => t && findQuote(t, q.quote));
    if (hit) (home[hit[0]] = home[hit[0]] || []).push(q);
  }
  return home;
}

function Card({ it, i, stepId, props, extra }) {
  const id = `${stepId}.i${i}`;
  const picked = props.pickedStepId === id;
  const marker = makeMarker([...highlightsFor(props.highlights, id), ...(extra || [])]);
  const item = isObj(it) ? it : { title: asText(it) };
  const details = isObj(item.details) ? Object.entries(item.details) : [];
  return html`<li ...${stepAttrs(props, id, 'rv-list-card')}>
    <div class="rv-list-rank" aria-hidden="true">${i + 1}</div>
    <div class="rv-list-main">
      <h4 class="rv-list-title"><span class="sr-only">${i + 1}. </span>${marker.mark(asText(item.title) || `Item ${i + 1}`)}</h4>
      ${item.subtitle != null && item.subtitle !== '' && html`<p class="rv-list-sub">${marker.mark(asText(item.subtitle))}</p>`}
      ${details.length > 0 && html`<dl class="rv-list-details">${details.map(([k, v]) => html`<div class="rv-list-detail" key=${k}>
        <dt>${k}</dt><dd>${marker.mark(asText(v))}</dd>
      </div>`)}</dl>`}
      ${item.reason && html`<p class="rv-list-reason">${marker.mark(asText(item.reason))}</p>`}
      ${(badgesFor(props.stepBadges, id).length > 0 || picked) && html`<div class="rv-meta">
        <${StepBadges} badges=${badgesFor(props.stepBadges, id)} />
        ${picked && html`<${FirstProblemTag} />`}
      </div>`}
    </div>
    <${PickButton} stepId=${id} stageId=${null} onPickStep=${props.onPickStep} picked=${picked} floating=${true} />
  </li>`;
}

/** The intro and the numbered cards. Props: list ({ intro, items }), stepId, plus the view props. */
export function ListBody(props) {
  const { list = {}, stepId = 'out' } = props;
  const items = Array.isArray(list.items) ? list.items : [];
  const home = homes(list, highlightsFor(props.highlights, stepId));
  return html`<div class="rv-list">
    ${list.intro && html`<div class="rv-list-intro"><${Markdown} text=${asText(list.intro)} highlights=${home.intro} /></div>`}
    ${items.length
      ? html`<ol class="rv-list-items" aria-label=${plural(items.length, 'item')}>
          ${items.map((it, i) => html`<${Card} key=${i} it=${it} i=${i} stepId=${stepId} props=${props} extra=${home['i' + i]} />`)}
        </ol>`
      : html`<p class="rv-list-none">The list is empty.</p>`}
  </div>`;
}

/** The ranked list view. */
export default function ListView(props) {
  const { trace, compact } = props;
  const steps = trace.steps || [];
  const out = steps.find((s) => s.isOutput) || null;
  const list = out && out.kind === 'output' && out.data?.type === 'list' ? out.data : null;
  const hasUser = steps.some((s) => s.kind === 'user');
  return html`<div class=${classes('rv-view', 'rv-listview', compact && 'is-compact')}>
    ${trace.input && !hasUser && html`<section class="rv-request">
      <h3 class="rv-label">Request</h3>
      <${LongText} class="rv-request-text" text=${trace.input} limit=${900} />
    </section>`}
    <${StepFlow} ...${props} skip=${new Set(out ? [out.id] : [])} />
    ${out
      ? html`<div ...${stepAttrs(props, out.id, 'rv-list-wrap')}>
          <${SurfaceLabel} icon="list" label=${list ? `${plural((list.items || []).length, 'item')} shown` : 'Reply'} step=${out} props=${props} />
          ${list
            ? html`<${ListBody} ...${props} list=${list} stepId=${out.id} />`
            : html`<${Markdown} text=${out.kind === 'output' ? asText(out.data?.text ?? out.text) : out.text} highlights=${highlightsFor(props.highlights, out.id)} />`}
        </div>`
      : html`<${EmptyTrace}>No list in this trace.<//>`}
  </div>`;
}
