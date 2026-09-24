// Email view (SPEC 4): the message in an email client frame (subject, From, To, body),
// with the steps that produced it above. The body shows exactly as it was written.

import { html, classes, plural } from 'pmstack/ui';
import { userWord } from '../lib/index.mjs';
import {
  StepFlow, SurfaceLabel, EmptyTrace, makeMarker, stepAttrs, highlightsFor, wordCount, asText,
  dayLabel, timeOfDay, isEpoch,
} from './common.mjs';

function people(v) {
  const list = Array.isArray(v) ? v : String(asText(v)).split(/,(?![^<]*>)/);
  return list.map((x) => asText(x).trim()).filter(Boolean).map((s) => {
    const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
    if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || m[2], address: m[2].trim() };
    return { name: s, address: '' };
  });
}

function Person({ p }) {
  return html`<span class="rv-email-person">
    <span class="rv-email-name">${p.name}</span>
    ${p.address && p.address !== p.name && html`<span class="rv-email-addr">${'<' + p.address + '>'}</span>`}
  </span>`;
}

const DATE_KEYS = ['sentAt', 'sent_at', 'sent', 'date', 'drafted', 'draftedAt', 'createdAt'];

function dateOf(email, metadata) {
  for (const v of [email.date, email.sentAt, ...DATE_KEYS.map((k) => metadata?.[k])]) {
    if (v == null || v === '') continue;
    const t = typeof v === 'number' ? v : Date.parse(v);
    if (isEpoch(t)) return t;
  }
  return null;
}

/**
 * One email in a client frame. Props: email ({ from, to, cc, subject, body }), stepId, date (epoch ms),
 * plus the view props (highlights for stepId mark the subject or body).
 */
export function EmailMessage(props) {
  const { email = {}, stepId, compact } = props;
  const marker = makeMarker(highlightsFor(props.highlights, stepId));
  const from = people(email.from);
  const to = people(email.to);
  const cc = people(email.cc);
  const subject = asText(email.subject).trim();
  const body = asText(email.body ?? email.text);
  const when = props.date ?? dateOf(email, props.trace?.metadata);
  const initial = (from[0]?.name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?';
  const subjectParts = marker.mark(subject || '(no subject)');
  const bodyParts = marker.mark(body);
  const words = wordCount(body);
  const left = marker.left();
  return html`<article class=${classes('rv-email', compact && 'is-compact', left.length && 'rv-hl-block rv-hl-ai')}>
    <header class="rv-email-head">
      <h3 class=${classes('rv-email-subject', !subject && 'is-empty')}>${subjectParts}</h3>
      ${from.length > 0 && html`<div class="rv-email-fromrow">
        <span class="rv-email-avatar" aria-hidden="true">${initial}</span>
        <div class="rv-email-from"><span class="sr-only">From: </span><${Person} p=${from[0]} /></div>
        ${when && html`<time class="rv-email-date" datetime=${new Date(when).toISOString()}>${dayLabel(when)}, ${timeOfDay(when)}</time>`}
      </div>`}
      ${to.length > 0 && html`<div class="rv-email-row"><span class="rv-email-k">To</span>
        <span class="rv-email-v">${to.map((p, i) => html`${i ? ', ' : ''}<${Person} p=${p} />`)}</span></div>`}
      ${cc.length > 0 && html`<div class="rv-email-row"><span class="rv-email-k">Cc</span>
        <span class="rv-email-v">${cc.map((p, i) => html`${i ? ', ' : ''}<${Person} p=${p} />`)}</span></div>`}
    </header>
    <div class="rv-email-body">${body.trim() ? bodyParts : html`<span class="rv-email-none">This email has no body.</span>`}</div>
    <footer class="rv-email-foot">${plural(words, 'word')}</footer>
  </article>`;
}

/** The email view. */
export default function EmailView(props) {
  const { trace, compact } = props;
  const steps = trace.steps || [];
  const out = steps.find((s) => s.isOutput) || null;
  const email = out && out.kind === 'output' && out.data?.type === 'email' ? out.data
    : out ? { body: out.kind === 'output' ? asText(out.data?.text ?? out.text) : out.text } : null;
  const skip = new Set(out ? [out.id] : []);
  return html`<div class=${classes('rv-view', 'rv-emailview', compact && 'is-compact')}>
    <${StepFlow} ...${props} skip=${skip} />
    ${out
      ? html`<div ...${stepAttrs(props, out.id, 'rv-email-wrap')}>
          <${SurfaceLabel} icon="email" label=${`Email to the ${userWord(props.experience)}`} step=${out} props=${props} />
          <${EmailMessage} ...${props} email=${email} stepId=${out.id} />
        </div>`
      : html`<${EmptyTrace}>No email in this trace.<//>`}
  </div>`;
}
