// Form fields view (SPEC 4): the source document on the left and the extracted fields on the right,
// each marked "Found in source" or "Not in source" by an exact text match.

import { html, Icon, classes } from 'pmstack/ui';
import {
  StepFlow, SurfaceLabel, PickButton, LongText, EmptyTrace, StepBadges, FirstProblemTag,
  stepAttrs, highlightsFor, badgesFor, asText, makeMarker,
} from './common.mjs';

function fieldValue(v) {
  if (v == null) return '';
  return typeof v === 'string' ? v : asText(v);
}

// Mark every found value in the source (first place each appears), plus any highlight quotes.
function markedSource(text, values, hl) {
  const spots = [];
  for (const v of values) {
    if (!v || v.length < 2) continue;
    const i = text.indexOf(v);
    if (i >= 0) spots.push({ start: i, end: i + v.length });
  }
  spots.sort((a, b) => a.start - b.start || b.end - a.end);
  const marker = makeMarker(hl);
  const out = [];
  let pos = 0;
  for (const s of spots) {
    if (s.start < pos) continue;
    if (s.start > pos) out.push(...marker.mark(text.slice(pos, s.start)));
    out.push(html`<mark class="rv-fields-found">${marker.mark(text.slice(s.start, s.end))}</mark>`);
    pos = s.end;
  }
  if (pos < text.length) out.push(...marker.mark(text.slice(pos)));
  return out;
}

/** Source document and field table. Props: out ({ document, fields }), stepId, source (fallback text), plus the view props. */
export function FieldsBody(props) {
  const { out = {}, stepId = 'out' } = props;
  const doc = asText(out.document ?? props.source ?? '');
  const fields = (Array.isArray(out.fields) ? out.fields : []).map((f) => ({ name: asText(f?.name ?? f?.label ?? f?.key), value: fieldValue(f?.value) }));
  const hl = highlightsFor(props.highlights, stepId);
  const hasDoc = doc.trim().length > 0;
  const foundCount = fields.filter((f) => f.value && hasDoc && doc.includes(f.value)).length;
  return html`<div class="rv-fields">
    <section class="rv-fields-doc" aria-label="Source document">
      <h4 class="rv-label"><${Icon} name="doc" size=${14} /><span>Source document</span></h4>
      ${hasDoc
        ? html`<div class="rv-fields-doctext"><${LongText} text=${doc} limit=${4000}
            render=${(t) => html`<span class="rv-text">${markedSource(t, fields.map((f) => f.value), hl)}</span>`} /></div>`
        : html`<p class="rv-fields-none">This trace has no source document, so the values cannot be checked.</p>`}
    </section>
    <section class="rv-fields-table" aria-label="Fields">
      <div class="rv-fields-head">
        <h4 class="rv-label"><${Icon} name="fields" size=${14} /><span>Fields</span></h4>
        ${hasDoc && fields.length > 0 && html`<span class="rv-fields-count">${foundCount} of ${fields.length} found in source</span>`}
      </div>
      ${fields.length
        ? html`<ol class="rv-fields-list">${fields.map((f, i) => {
            const id = `${stepId}.f${i}`;
            const picked = props.pickedStepId === id;
            const found = hasDoc && f.value !== '' && doc.includes(f.value);
            const vhl = highlightsFor(props.highlights, id);
            const marker = makeMarker(vhl);
            return html`<li ...${stepAttrs(props, id, classes('rv-field', !found && 'is-missing'))} key=${i}>
              <div class="rv-field-name">${f.name || `Field ${i + 1}`}</div>
              <div class=${classes('rv-field-value', !f.value && 'is-empty')}>${f.value ? marker.mark(f.value) : 'Empty'}</div>
              <div class="rv-field-status">
                ${!hasDoc
                  ? html`<span class="rv-status">Can't check</span>`
                  : found
                    ? html`<span class="rv-status rv-status-good"><${Icon} name="check" size=${12} /><span>Found in source</span></span>`
                    : html`<span class="rv-status rv-status-missing"><${Icon} name="warning" size=${12} /><span>${f.value ? 'Not in source' : 'No value'}</span></span>`}
                <${StepBadges} badges=${badgesFor(props.stepBadges, id)} />
                ${picked && html`<${FirstProblemTag} />`}
              </div>
              <${PickButton} stepId=${id} stageId=${null} onPickStep=${props.onPickStep} picked=${picked} floating=${true} />
            </li>`;
          })}</ol>`
        : html`<p class="rv-fields-none">No fields were filled in.</p>`}
    </section>
  </div>`;
}

/** The form fields view. */
export default function FieldsView(props) {
  const { trace, compact } = props;
  const steps = trace.steps || [];
  const out = steps.find((s) => s.isOutput) || null;
  const data = out && out.kind === 'output' && out.data?.type === 'fields' ? out.data : null;
  return html`<div class=${classes('rv-view', 'rv-fieldsview', compact && 'is-compact')}>
    <${StepFlow} ...${props} skip=${new Set(out ? [out.id] : [])} />
    ${out
      ? html`<div ...${stepAttrs(props, out.id, 'rv-fields-wrap')}>
          <${SurfaceLabel} icon="fields" label="Form the AI filled in" step=${out} props=${props} />
          ${data
            ? html`<${FieldsBody} ...${props} out=${data} stepId=${out.id} source=${trace.input} />`
            : html`<${LongText} text=${out.kind === 'output' ? asText(out.data?.text ?? out.text) : out.text} limit=${2000} />`}
        </div>`
      : html`<${EmptyTrace}>No fields in this trace.<//>`}
  </div>`;
}
