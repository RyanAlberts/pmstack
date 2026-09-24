// Answer view (SPEC 4): the question, the answer with citation markers, and the sources.
// Markers like [1] are buttons that bring the cited source into view. Cited sources always show;
// sources the search found but the answer did not cite show with the behind-the-scenes steps.
// With onRetrieval, each source has a "Needed" toggle and missing documents can be added by id.

import { html, useState, useRef, useId, Icon, Button, classes, plural } from 'pmstack/ui';
import {
  StepFlow, StepMeta, SurfaceLabel, PickButton, Markdown, LongText, EmptyTrace, StageTag, StepBadges, FirstProblemTag,
  stepAttrs, highlightsFor, badgesFor, userName, asText, findQuote,
} from './common.mjs';

function citationsOf(answer) {
  return (Array.isArray(answer?.citations) ? answer.citations : [])
    .filter((c) => c && c.n != null)
    .map((c) => ({ n: Number(c.n), doc: c.doc != null ? String(c.doc) : null, quote: c.quote ? String(c.quote) : '' }));
}

function docsOf(step) {
  const list = step?.data && Array.isArray(step.data.documents) ? step.data.documents : [];
  return list.map((d, i) => ({
    id: d && d.id != null ? String(d.id) : `${step.id}-${i + 1}`,
    title: asText(d?.title),
    text: asText(d?.text ?? d?.content),
    score: typeof d?.score === 'number' ? d.score : null,
  }));
}

function reduced() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The answer text with citation markers. Props: answer ({ text, citations }), stepId, activeDoc,
 * onCite(docId, n), titles (docId -> title), plus the view props. Without onCite it lists the citations below.
 */
export function AnswerText(props) {
  const { answer = {}, stepId, activeDoc, onCite, titles } = props;
  const hl = highlightsFor(props.highlights, stepId);
  const cites = citationsOf(answer);
  const byN = new Map(cites.map((c) => [c.n, c]));
  const cite = (nums) => html`<span class="rv-cites">${nums.map((n, i) => {
    const c = byN.get(n);
    if (!c) return html`<span key=${i} class="rv-cite is-missing" title=${`No source is listed for [${n}]`}>${n}</span>`;
    const title = (titles && titles.get(c.doc)) || c.doc || 'source';
    if (!onCite) return html`<span key=${i} class="rv-cite" title=${`Source ${n}: ${title}`}>${n}</span>`;
    return html`<button key=${i} type="button" class=${classes('rv-cite', activeDoc && activeDoc === c.doc && 'is-active')}
      aria-label=${`Source ${n}: ${title}`} title=${title} onClick=${() => onCite(c.doc, n)}>${n}</button>`;
  })}</span>`;
  return html`<div class="rv-answer-textwrap">
    <${LongText} text=${asText(answer.text)} limit=${8000} highlights=${hl}
      render=${(t) => html`<${Markdown} class="rv-answer-text" text=${t} highlights=${hl} cite=${cite} />`} />
    ${!onCite && cites.length > 0 && html`<ol class="rv-answer-cites">${cites.map((c) => html`<li key=${c.n}>
      <span class="rv-cite">${c.n}</span> <code>${c.doc ?? 'no document'}</code>${c.quote && html` <span class="rv-answer-quote">"${c.quote}"</span>`}
    </li>`)}</ol>`}
  </div>`;
}

function Source({ doc, nums, quotes, retrieval, onRetrieval, active, missing }) {
  const needed = !!retrieval && Array.isArray(retrieval.needed) && retrieval.needed.includes(doc.id);
  const toggle = () => {
    const list = Array.isArray(retrieval?.needed) ? retrieval.needed : [];
    const next = needed ? list.filter((x) => x !== doc.id) : [...list, doc.id];
    onRetrieval({ needed: next, missing: Array.isArray(retrieval?.missing) ? retrieval.missing : [] });
  };
  const ranges = [];
  const unsupported = [];
  for (const q of quotes) {
    const r = findQuote(doc.text, q);
    if (r) ranges.push(r);
    else unsupported.push(q);
  }
  ranges.sort((a, b) => a.start - b.start);
  const renderText = (t) => {
    const parts = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.start < pos || r.start >= t.length) continue;
      if (r.start > pos) parts.push(t.slice(pos, r.start));
      parts.push(html`<mark class="rv-src-quote">${t.slice(r.start, Math.min(r.end, t.length))}</mark>`);
      pos = Math.min(r.end, t.length);
    }
    if (pos < t.length) parts.push(t.slice(pos));
    return html`<span class="rv-text">${parts}</span>`;
  };
  const late = ranges.length && ranges[ranges.length - 1].end > 700;
  return html`<li class=${classes('rv-src', active && 'is-active', !nums.length && 'is-uncited', missing && 'is-missing')} data-doc=${doc.id} tabindex="-1">
    <div class="rv-src-head">
      ${nums.length > 0 && html`<span class="rv-src-nums">${nums.map((n) => html`<span key=${n} class="rv-cite is-static">${n}</span>`)}</span>`}
      <span class="rv-src-title">${doc.title || doc.id}</span>
      ${doc.title && html`<code class="rv-src-id">${doc.id}</code>`}
      ${doc.score != null && html`<span class="rv-src-score" title="How closely the search matched this document">match ${doc.score.toFixed(2)}</span>`}
      ${!nums.length && !missing && html`<span class="rv-src-flag">Not cited</span>`}
      ${onRetrieval && !missing
        ? html`<button type="button" class=${classes('rv-needed-toggle', needed && 'is-on')} aria-pressed=${needed ? 'true' : 'false'} onClick=${toggle}
            title="Did the answer need this source?">
            <${Icon} name=${needed ? 'check' : 'plus'} size=${13} /><span>Needed</span>
          </button>`
        : needed && html`<span class="rv-needed-toggle is-on is-static"><${Icon} name="check" size=${13} /><span>Needed</span></span>`}
    </div>
    ${missing
      ? html`<p class="rv-src-note"><${Icon} name="warning" size=${14} /><span>The answer cites this document, but the search did not return it.</span></p>`
      : html`<${LongText} class="rv-src-text" text=${doc.text} limit=${late ? 100000 : 560} render=${renderText} />`}
    ${unsupported.length > 0 && html`<p class="rv-src-note"><${Icon} name="warning" size=${14} />
      <span>${unsupported.length === 1 ? 'The quoted words are not in this source:' : 'These quoted words are not in this source:'} ${unsupported.map((q, i) => html`${i ? ' ' : ''}<q key=${i}>${q}</q>`)}</span></p>`}
  </li>`;
}

function NeededMissing({ retrieval, onRetrieval, found }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const inputId = 'rv-missing-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const missing = Array.isArray(retrieval?.missing) ? retrieval.missing : [];
  const needed = Array.isArray(retrieval?.needed) ? retrieval.needed : [];
  const add = (e) => {
    e.preventDefault();
    const id = text.trim();
    if (!id) {
      setError('Type a document id first.');
      return;
    }
    if (found.has(id)) {
      setError(`${id} is already in the sources above. Mark it Needed there.`);
      return;
    }
    if (!missing.includes(id)) onRetrieval({ needed, missing: [...missing, id] });
    setText('');
    setError('');
  };
  const remove = (id) => onRetrieval({ needed, missing: missing.filter((x) => x !== id) });
  return html`<section class="rv-missing" aria-label="Needed but not found">
    <h4 class="rv-label">Needed but not found</h4>
    <p class="rv-missing-hint">Add the id of any document the answer needed that the search did not return.</p>
    ${missing.length > 0 && html`<ul class="rv-missing-list">${missing.map((id) => html`<li key=${id} class="rv-missing-chip">
      <code>${id}</code>
      <button type="button" class="rv-missing-x" aria-label=${`Remove ${id}`} title="Remove" onClick=${() => remove(id)}><${Icon} name="x" size=${12} /></button>
    </li>`)}</ul>`}
    <form class="rv-missing-form" onSubmit=${add}>
      <label class="sr-only" for=${inputId}>Document id</label>
      <input id=${inputId} class="input rv-missing-input" value=${text} placeholder="Document id, for example hr-12"
        onInput=${(e) => { setText(e.currentTarget.value); if (error) setError(''); }} autocomplete="off" spellcheck="false" />
      <${Button} type="submit" size="sm" icon="plus">Add<//>
    </form>
    ${error && html`<p class="error-text" role="alert">${error}</p>`}
  </section>`;
}

function SourceGroup({ step, docs, cites, props, active, many }) {
  const [more, setMore] = useState(false);
  const numsFor = (id) => cites.filter((c) => c.doc === id).map((c) => c.n);
  const quotesFor = (id) => cites.filter((c) => c.doc === id && c.quote).map((c) => c.quote);
  const withCites = docs.filter((d) => numsFor(d.id).length).sort((a, b) => Math.min(...numsFor(a.id)) - Math.min(...numsFor(b.id)));
  const uncited = docs.filter((d) => !numsFor(d.id).length);
  const noCites = cites.length === 0;
  const shown = noCites ? docs : withCites;
  const picked = props.pickedStepId === step.id;
  const query = step.data?.input;
  const source = (d) => html`<${Source} key=${d.id} doc=${d} nums=${numsFor(d.id)} quotes=${quotesFor(d.id)} retrieval=${props.retrieval}
    onRetrieval=${props.onRetrieval} active=${active === d.id} />`;
  return html`<section ...${stepAttrs(props, step.id, 'rv-srcs')}>
    <div class="rv-srcs-head">
      <h4 class="rv-label">${noCites ? 'Sources found' : 'Sources'}${many && step.name ? html` <span class="rv-srcs-name">${step.name}</span>` : null}</h4>
      <span class="rv-srcs-count">${noCites ? plural(docs.length, 'document') : `${withCites.length} cited of ${docs.length} found`}</span>
      <span class="rv-card-tags">
        <${StageTag} experience=${props.experience} stageId=${step.stage} />
        <${StepBadges} badges=${badgesFor(props.stepBadges, step.id)} />
        ${picked && html`<${FirstProblemTag} />`}
      </span>
      <${PickButton} stepId=${step.id} stageId=${step.stage} onPickStep=${props.onPickStep} picked=${picked} />
    </div>
    ${props.showHidden && query != null && query !== '' && html`<p class="rv-srcs-query"><${Icon} name="search" size=${13} /><span>Searched for</span> <q>${asText(query)}</q></p>`}
    ${shown.length > 0 && html`<ol class="rv-src-list">${shown.map(source)}</ol>`}
    ${!docs.length && html`<p class="rv-src-empty">The search returned no documents.</p>`}
    ${!noCites && uncited.length > 0 && (props.showHidden || more
      ? html`<ol class="rv-src-list is-uncited">${uncited.map(source)}</ol>`
      : html`<button type="button" class="rv-more rv-srcs-more" onClick=${() => setMore(true)}>
          <${Icon} name="chevron-down" size=${13} />${plural(uncited.length, 'more source')} found but not cited
        </button>`)}
  </section>`;
}

/** The answer view. */
export default function AnswerView(props) {
  const { trace, compact } = props;
  const steps = trace.steps || [];
  const root = useRef(null);
  const [active, setActive] = useState(null);
  const out = steps.find((s) => s.isOutput) || null;
  const answer = out && out.kind === 'output' && out.data?.type === 'answer' ? out.data
    : out ? { text: out.kind === 'output' ? asText(out.data?.text ?? out.text) : out.text } : null;
  const qStep = steps.find((s) => s.kind === 'user' && s.customerVisible) || null;
  const question = qStep ? qStep.text : trace.input;
  const searches = steps.filter((s) => s.kind === 'retrieval');
  const cites = citationsOf(answer);
  const groups = searches.map((s) => ({ step: s, docs: docsOf(s) }));
  const found = new Set(groups.flatMap((g) => g.docs.map((d) => d.id)));
  const titles = new Map(groups.flatMap((g) => g.docs.map((d) => [d.id, d.title || d.id])));
  const notReturned = [...new Set(cites.filter((c) => c.doc && !found.has(c.doc)).map((c) => c.doc))];
  const skip = new Set([out?.id, qStep?.id, ...searches.map((s) => s.id)].filter(Boolean));
  const qhl = qStep ? highlightsFor(props.highlights, qStep.id) : [];

  const onCite = (docId) => {
    setActive(docId);
    const el = root.current && docId ? root.current.querySelector(`[data-doc="${CSS.escape(docId)}"]`) : null;
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
    }
  };

  return html`<div ref=${root} class=${classes('rv-view', 'rv-answerview', compact && 'is-compact')}>
    ${question != null && question !== '' && html`<section ...${qStep ? stepAttrs(props, qStep.id, 'rv-ask') : { class: 'rv-ask' }}>
      <div class="rv-ask-head">
        <h3 class="rv-label">${userName(props.experience)} asked</h3>
        ${qStep && html`<${PickButton} stepId=${qStep.id} stageId=${qStep.stage} onPickStep=${props.onPickStep} picked=${props.pickedStepId === qStep.id} />`}
      </div>
      <${LongText} class="rv-ask-text" text=${question} limit=${900} highlights=${qhl} />
      ${qStep && html`<${StepMeta} ...${props} stepId=${qStep.id} stageId=${qStep.stage} />`}
    </section>`}

    <${StepFlow} ...${props} skip=${skip} />

    ${out
      ? html`<article ...${stepAttrs(props, out.id, 'rv-answer')}>
          <${SurfaceLabel} icon="answer" label="Answer" step=${out} props=${props}
            extra=${cites.length > 0 && html`<span class="rv-surface-count">${plural(new Set(cites.map((c) => c.doc)).size, 'source')} cited</span>`} />
          <${AnswerText} ...${props} answer=${answer} stepId=${out.id} activeDoc=${active} onCite=${onCite} titles=${titles} />
        </article>`
      : html`<${EmptyTrace}>No answer in this trace.<//>`}

    ${groups.map((g) => html`<${SourceGroup} key=${g.step.id} step=${g.step} docs=${g.docs} cites=${cites} props=${props}
      active=${active} many=${groups.length > 1} />`)}

    ${notReturned.length > 0 && html`<section class="rv-srcs is-orphan">
      <div class="rv-srcs-head"><h4 class="rv-label">Cited but not found</h4></div>
      <ol class="rv-src-list">${notReturned.map((id) => html`<${Source} key=${id} doc=${{ id, title: '', text: '' }}
        nums=${cites.filter((c) => c.doc === id).map((c) => c.n)} quotes=${[]} retrieval=${props.retrieval}
        onRetrieval=${props.onRetrieval} active=${active === id} missing=${true} />`)}</ol>
    </section>`}

    ${props.onRetrieval && html`<${NeededMissing} retrieval=${props.retrieval} onRetrieval=${props.onRetrieval} found=${found} />`}
    ${!props.onRetrieval && Array.isArray(props.retrieval?.missing) && props.retrieval.missing.length > 0 && html`<section class="rv-missing">
      <h4 class="rv-label">Needed but not found</h4>
      <ul class="rv-missing-list">${props.retrieval.missing.map((id) => html`<li key=${id} class="rv-missing-chip"><code>${id}</code></li>`)}</ul>
    </section>`}
  </div>`;
}
