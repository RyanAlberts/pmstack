// Document view (SPEC 4): the output as a page, in article typography at a comfortable
// reading width, with the request and the steps that produced it above.

import { html, classes, plural } from 'pmstack/ui';
import {
  StepFlow, SurfaceLabel, Markdown, LongText, EmptyTrace, makeMarker, stepAttrs, highlightsFor,
  wordCount, asText, userName,
} from './common.mjs';
import { OutputBody } from './auto.mjs';

/** A document page. Props: doc ({ title, body }), stepId, plus the view props. */
export function DocumentBody(props) {
  const { doc = {}, stepId, compact } = props;
  const hl = highlightsFor(props.highlights, stepId);
  const title = asText(doc.title).trim();
  const body = asText(doc.body ?? doc.text);
  // A quote found in the title is marked there; the rest go to the body.
  const titleMarker = makeMarker(hl);
  const titleParts = title ? titleMarker.mark(title) : null;
  const rest = titleMarker.left();
  return html`<article class=${classes('rv-document', compact && 'is-compact')}>
    ${title && html`<h3 class="rv-document-title">${titleParts}</h3>`}
    ${body.trim()
      ? html`<${LongText} text=${body} limit=${compact ? 2500 : 12000} highlights=${rest}
          render=${(t) => html`<${Markdown} class="rv-document-body" text=${t} highlights=${rest} />`} />`
      : html`<p class="rv-document-none">This document is empty.</p>`}
    <footer class="rv-document-foot">${plural(wordCount(body), 'word')}</footer>
  </article>`;
}

/** The document view. */
export default function DocumentView(props) {
  const { trace, compact } = props;
  const steps = trace.steps || [];
  const out = steps.find((s) => s.isOutput) || null;
  const hasUser = steps.some((s) => s.kind === 'user');
  let doc = null;
  if (out) {
    if (out.kind === 'output' && out.data?.type === 'document') doc = out.data;
    else if (out.kind === 'output' && out.data?.type && out.data.type !== 'text') doc = null;
    else doc = { body: out.kind === 'output' ? asText(out.data?.text ?? out.text) : out.text };
  }
  return html`<div class=${classes('rv-view', 'rv-documentview', compact && 'is-compact')}>
    ${trace.input && !hasUser && html`<section class="rv-request">
      <h3 class="rv-label">${userName(props.experience)} asked</h3>
      <${LongText} class="rv-request-text" text=${trace.input} limit=${900} />
    </section>`}
    <${StepFlow} ...${props} skip=${new Set(out ? [out.id] : [])} />
    ${out
      ? html`<div ...${stepAttrs(props, out.id, 'rv-document-wrap')}>
          <${SurfaceLabel} icon="doc" label="Document" step=${out} props=${props} />
          ${doc
            ? html`<${DocumentBody} ...${props} doc=${doc} stepId=${out.id} />`
            : html`<${OutputBody} ...${props} output=${out.data} stepId=${out.id} />`}
        </div>`
      : html`<${EmptyTrace}>No document in this trace.<//>`}
  </div>`;
}
