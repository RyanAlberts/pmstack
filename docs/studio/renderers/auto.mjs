// Automatic view (SPEC 4): picks a view from the output type and the trace's shape.
// Last resort: a labeled key-value view of the trace, never a raw dump.
// Also exports OutputBody, which draws any typed output (used by the agent and chat views).

import { html, Icon, classes } from 'pmstack/ui';
import {
  StepFlow, SurfaceLabel, Markdown, DataView, EmptyTrace, LongText, stepAttrs, highlightsFor, userName, asText,
} from './common.mjs';
import ChatView from './chat.mjs';
import AgentView from './agent.mjs';
import EmailView, { EmailMessage } from './email.mjs';
import DocumentView, { DocumentBody } from './document.mjs';
import AnswerView, { AnswerText } from './answer.mjs';
import CodeReviewView, { ReviewBody } from './code-review.mjs';
import FieldsView, { FieldsBody } from './fields.mjs';
import ListView, { ListBody } from './list.mjs';

const SAFE_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/** An image output: data images are drawn; anything else shows its description and address, with no request made. */
export function ImageOutput({ image }) {
  const src = asText(image?.src).trim();
  const alt = asText(image?.alt).trim();
  if (SAFE_IMAGE.test(src)) {
    return html`<figure class="rv-image"><img src=${src} alt=${alt || 'Image from the trace'} loading="lazy" />
      ${alt && html`<figcaption>${alt}</figcaption>`}</figure>`;
  }
  return html`<figure class="rv-image is-missing">
    <span class="rv-image-icon" aria-hidden="true"><${Icon} name="image" size=${22} /></span>
    <figcaption>
      <span class="rv-image-alt">${alt || 'Image'}</span>
      ${src && html`<code class="rv-image-src">${src.length > 120 ? src.slice(0, 118) + '…' : src}</code>`}
      <span class="rv-image-note">Images from files or web addresses are not loaded here.</span>
    </figcaption>
  </figure>`;
}

/** Draw any typed output. Props: output, stepId, plus the view props. */
export function OutputBody(props) {
  const o = props.output || {};
  const hl = highlightsFor(props.highlights, props.stepId);
  switch (o.type) {
    case 'email': return html`<${EmailMessage} ...${props} email=${o} />`;
    case 'answer': return html`<${AnswerText} ...${props} answer=${o} />`;
    case 'code-review': return html`<${ReviewBody} ...${props} review=${o} />`;
    case 'fields': return html`<${FieldsBody} ...${props} out=${o} />`;
    case 'document': return html`<${DocumentBody} ...${props} doc=${o} />`;
    case 'list': return html`<${ListBody} ...${props} list=${o} />`;
    case 'image': return html`<${ImageOutput} image=${o} />`;
    case 'data': return html`<div class="rv-output-data"><${DataView} value=${o.value} /></div>`;
    default: return html`<${LongText} text=${asText(o.text)} limit=${6000} highlights=${hl}
      render=${(t) => html`<${Markdown} text=${t} highlights=${hl} />`} />`;
  }
}

const TYPED = {
  email: EmailView,
  answer: AnswerView,
  'code-review': CodeReviewView,
  fields: FieldsView,
  document: DocumentView,
  list: ListView,
};

// A request and a reply with no conversation around them (input and output pairs).
function PairView(props) {
  const { trace, compact } = props;
  const out = trace.steps.find((s) => s.isOutput) || null;
  return html`<div class=${classes('rv-view', 'rv-pair', compact && 'is-compact')}>
    ${trace.input != null && html`<section class="rv-pair-in">
      <h3 class="rv-label">${userName(props.experience)} asked</h3>
      <${LongText} text=${trace.input} limit=${1200} />
    </section>`}
    <${StepFlow} ...${props} skip=${new Set(out ? [out.id] : [])} />
    ${out && html`<section ...${stepAttrs(props, out.id, 'rv-pair-out')}>
      <${SurfaceLabel} icon="arrow-right" label="Reply" step=${out} props=${props} />
      <${OutputBody} ...${props} output=${out.kind === 'output' ? out.data : { type: 'text', text: out.text }} stepId=${out.id} />
    </section>`}
  </div>`;
}

// Nothing recognized: show every field of the raw trace with labels.
function DetailsView({ trace, compact }) {
  const raw = trace.raw && typeof trace.raw === 'object' ? trace.raw : { text: trace.raw };
  const rest = {};
  for (const [k, v] of Object.entries(raw)) if (!['id', 'title', 'metadata'].includes(k)) rest[k] = v;
  const keys = Object.keys(rest);
  return html`<div class=${classes('rv-view', 'rv-details', compact && 'is-compact')}>
    ${keys.length
      ? html`<section class="rv-details-card">
          <h3 class="rv-label">What this trace holds</h3>
          <p class="rv-details-hint">This trace has no messages or steps we recognize, so every field is listed here.</p>
          <${DataView} value=${rest} />
        </section>`
      : html`<${EmptyTrace}>This trace is empty apart from its id.<//>`}
  </div>`;
}

/** The automatic view. */
export default function AutoView(props) {
  const t = props.trace;
  if (!t) return null;
  const steps = t.steps || [];
  const View = TYPED[t.output?.type];
  if (View) return html`<${View} ...${props} />`;
  const messages = steps.some((s) => (s.kind === 'user' || s.kind === 'assistant') && s.customerVisible);
  if (messages) return html`<${ChatView} ...${props} />`;
  const internal = steps.some((s) => !s.customerVisible);
  if (internal) return html`<${AgentView} ...${props} />`;
  if (t.input != null || t.output) return html`<${PairView} ...${props} />`;
  return html`<${DetailsView} ...${props} />`;
}
