// The labeling queue for one failure mode (SPEC 5.3, Checks > AI judge builder > Labels).
// A label is your yes or no to "Does this trace show this failure mode?". The queue serves
// reviewed traces that have no label for the failure mode first, then traces nobody reviewed.
// Keys work only inside the drawer: 2 Yes, 1 No, C close call, J next, K previous,
// H steps behind the scenes. Escape closes it.

import {
  html, useStore, useState, useMemo, useEffect, useRef, useKeys, useDraft,
  Drawer, Modal, Button, Chip, Kbd, Icon, ProgressBar, EmptyState, toast, plural, classes,
} from 'pmstack/ui';
import { store, updateProject, navigate, setUi, DEFAULT_FILTERS } from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { TraceView, showHiddenFor } from '../renderers/index.mjs';

/** Trace ids to label for a failure mode: reviewed traces with no label first, then unreviewed ones, in trace order. */
export function labelQueue(p, modeId) {
  const reviewed = [];
  const fresh = [];
  for (const id of lib.normalizeAll(p).keys()) {
    if (lib.humanLabel(p, id, modeId) != null) continue;
    if (lib.isLockedLabel(p, modeId, id)) continue;
    const r = p.reviews?.[id];
    if (r && r.verdict) reviewed.push(id);
    else fresh.push(id);
  }
  return [...reviewed, ...fresh];
}

/** Label counts for a failure mode: { pass, fail, total }. */
export function labelCounts(p, modeId) {
  let pass = 0;
  let fail = 0;
  for (const row of lib.labeledSet(p, modeId)) {
    if (row.label === 'fail') fail++;
    else pass++;
  }
  return { pass, fail, total: pass + fail };
}

/**
 * Drawer that asks "Does this trace show this failure mode?" one trace at a time.
 * traceIds (optional) replaces the queue, for example to re-check a single disagreement.
 */
export function LabelDrawer({ open, onClose, modeId, traceIds = null }) {
  const name = useStore((s) => {
    const m = s.project && lib.modeMap(s.project).get(modeId);
    return m ? m.name : '';
  });
  const single = traceIds && traceIds.length === 1;
  const title = single ? `Check your label: ${name}` : `Label traces: ${name}`;
  return html`<${Drawer} open=${open} title=${title} class="checks-label-drawer" onClose=${onClose}>
    ${open && modeId && html`<${LabelQueue} key=${modeId + '|' + (traceIds ? traceIds.join(',') : '')}
      modeId=${modeId} traceIds=${traceIds} onClose=${onClose} />`}
  <//>`;
}

const REVIEW_STATE = {
  pass: { text: 'You marked it Good', tone: 'good', icon: 'check' },
  fail: { text: 'You marked it Problem', tone: 'bad', icon: 'x' },
  skip: { text: 'You marked it Not sure yet', tone: 'neutral', icon: 'skip' },
};

function LabelQueue({ modeId, traceIds, onClose }) {
  const project = useStore((s) => s.project);
  const [queue] = useState(() => (traceIds && traceIds.length ? traceIds.slice() : labelQueue(store.get().project, modeId)));
  const [index, setIndex] = useState(0);
  const [labeled, setLabeled] = useState(() => new Set());
  const [hidden, setHidden] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const root = useRef(null);

  const mode = lib.modeMap(project).get(modeId);
  const exp = project.experience || {};
  const who = lib.userWord(exp);
  const traceId = index < queue.length ? queue[index] : null;
  const trace = useMemo(() => (traceId ? lib.getNormalized(project, traceId) : null), [project.traces, project.experience, traceId]);
  const counts = useMemo(() => labelCounts(project, modeId), [project.labels, project.reviews, project.modes, modeId]);
  const current = traceId ? lib.humanLabel(project, traceId, modeId) : null;
  const locked = traceId ? lib.isLockedLabel(project, modeId, traceId) : false;
  const closeCall = traceId ? (project.closeCalls?.[modeId] || []).includes(traceId) : false;
  const review = traceId ? project.reviews?.[traceId] : null;

  const why = useDraft(modeId + '|' + (traceId || ''), traceId ? project.critiques?.[modeId]?.[traceId] ?? '' : '',
    (text) => traceId && updateProject((p) => lib.setCritique(p, modeId, traceId, text.trim() ? text : ''), 'critique'));

  const baseHidden = trace ? showHiddenFor(exp, lib.viewFor(trace, exp)) : false;
  const showHidden = hidden ?? baseHidden;
  // Tool call checks mark the steps that broke a rule, the same badges Review traces shows.
  const badges = useMemo(() => (trace && typeof lib.stepBadges === 'function' ? lib.stepBadges(project, trace) : null), [project.checks, trace]);

  // Keys ignore single letters on buttons, so after a click the queue takes focus back.
  const refocus = () => {
    if (root.current && root.current.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    if (root.current) root.current.focus({ preventScroll: true });
  };
  useEffect(() => {
    refocus();
  }, [index]);

  const advance = () => setIndex((i) => Math.min(queue.length, i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  const write = (value) => {
    why.commitNow();
    let error = null;
    updateProject((p) => {
      const r = lib.setLabelResult(p, modeId, traceId, value);
      error = r.error;
      return r.project;
    }, 'label');
    if (error) {
      toast(error, { tone: 'bad' });
      return;
    }
    setLabeled((s) => (s.has(traceId) ? s : new Set([...s, traceId])));
    advance();
  };

  const answer = (value) => {
    if (!traceId || locked) return;
    if (value === 'fail' && review?.verdict === 'pass') {
      setConfirm(true);
      return;
    }
    write(value);
  };

  const changeToProblem = () => {
    why.commitNow();
    updateProject((p) => {
      let q = lib.setVerdict(p, traceId, 'fail');
      if (!(q.reviews?.[traceId]?.modes || []).includes(modeId)) q = lib.toggleMode(q, traceId, modeId);
      return lib.setLabelResult(q, modeId, traceId, 'fail').project;
    }, 'label');
    setConfirm(false);
    setLabeled((s) => new Set([...s, traceId]));
    advance();
  };

  const toggleClose = () => {
    if (!traceId || locked) return;
    updateProject((p) => lib.toggleCloseCall(p, modeId, traceId), 'close call');
  };

  useKeys({
    1: () => answer('pass'),
    2: () => answer('fail'),
    c: toggleClose,
    j: advance,
    k: back,
    h: () => setHidden((v) => !(v ?? baseHidden)),
  }, { active: !!traceId });

  if (!mode) {
    return html`<${EmptyState} icon="warning" title="This failure mode no longer exists"
      body="It was deleted or merged. Close this panel and pick another failure mode." action=${html`<${Button} onClick=${onClose}>Close<//>`} />`;
  }

  if (!queue.length) {
    return html`<${EmptyState} icon="check" title="Every trace has a label"
      body=${`Each trace already has your yes or no for "${mode.name}". Add traces in Set up to label more.`}
      action=${html`<${Button} kind="primary" onClick=${onClose}>Done<//>`} />`;
  }

  if (!traceId) {
    return html`<div class="checks-label-done">
      <${EmptyState} icon="check" title=${labeled.size ? `You labeled ${plural(labeled.size, 'trace')}` : 'You reached the end of the queue'}
        body=${`${counts.total} labels for "${mode.name}": ${counts.fail} Problem, ${counts.pass} Good.`}
        action=${html`<div class="row checks-label-done-actions">
          <${Button} icon="arrow-left" onClick=${back}>Go back<//>
          <${Button} kind="primary" onClick=${onClose}>Done<//>
        </div>`} />
    </div>`;
  }

  const state = review && REVIEW_STATE[review.verdict];
  const chips = (exp.filters || []).filter((k) => trace && trace.metadata[k] != null && trace.metadata[k] !== '');
  const note = review && (review.verdict === 'pass' ? review.good : review.note);

  return html`<div class="checks-label" ref=${root} tabindex="-1">
    <div class="checks-label-head">
      <p class="checks-label-eyebrow">Your yes or no for one failure mode</p>
      <p class="checks-label-question">Does this trace show <strong>${mode.name}</strong>?</p>
      ${mode.definition && html`<p class="checks-label-def">${mode.definition}</p>`}
      <div class="checks-label-meter">
        <${ProgressBar} value=${index} max=${queue.length} label="Place in the queue" />
        <p class="small muted num">
          Trace ${index + 1} of ${queue.length} in this queue${labeled.size ? `, ${labeled.size} labeled now` : ''}.
          ${' '}${counts.total} labels: ${counts.fail} Problem, ${counts.pass} Good.
        </p>
      </div>
    </div>

    <div class="checks-label-trace">
      <div class="checks-label-trace-head">
        <div class="grow">
          <h3 class="checks-label-title">${trace ? trace.title : traceId}</h3>
          <p class="small muted"><span class="mono">${traceId}</span></p>
        </div>
        <${Button} kind="ghost" size="sm" icon="external" title="Open this trace in Review traces"
          onClick=${() => { onClose(); setUi({ filters: { ...DEFAULT_FILTERS, scope: 'all' } }); navigate('review', traceId); }}>Open in Review<//>
      </div>
      <div class="row checks-label-chips">
        ${state
          ? html`<${Chip} tone=${state.tone}><${Icon} name=${state.icon} size=${14} />${state.text}<//>`
          : html`<${Chip}>Not reviewed yet<//>`}
        ${chips.map((k) => html`<${Chip} key=${k}>${k}: ${String(trace.metadata[k])}<//>`)}
        <${Button} kind="ghost" size="sm" onClick=${() => { setHidden((v) => !(v ?? baseHidden)); refocus(); }}
          aria-pressed=${showHidden ? 'true' : 'false'}>
          ${showHidden ? 'Hide' : 'Show'} steps behind the scenes <${Kbd}>H<//>
        <//>
      </div>
      ${note && html`<blockquote class="checks-label-note"><span class="label">Your note in Review</span>${note}</blockquote>`}
      ${trace
        ? html`<${TraceView} trace=${trace} experience=${exp} showHidden=${showHidden} compact=${true} stepBadges=${badges} />`
        : html`<p class="banner banner-warn"><${Icon} name="warning" /><span>This trace is not in the project any more.</span></p>`}
    </div>

    <div class="checks-label-answer" role="group" aria-label="Your answer">
      ${locked
        ? html`<p class="banner"><${Icon} name="warning" /><span>This trace is in the final test, which you already used, so its label stays as it is.</span></p>`
        : html`<div class="checks-label-fields">
          <label class="field grow">
            <span class="label">Why? <span class="muted">(optional, one line)</span></span>
            <input class="input" type="text" value=${why.value} onInput=${why.onInput} onFocus=${why.onFocus} onBlur=${why.onBlur}
              placeholder=${`What decides it, from the ${who}'s side`} maxlength="240" aria-describedby="checks-label-why-hint" />
            <span id="checks-label-why-hint" class="hint checks-label-why-hint">Used if this trace becomes an example in the judge prompt.</span>
          </label>
          <${Chip} selected=${closeCall} onClick=${() => { toggleClose(); refocus(); }} title="A trace that could go either way. Close calls make strong examples.">
            Close call <${Kbd}>C<//>
          <//>
        </div>`}
      <div class="checks-label-buttons">
        <span class="checks-label-ask">Shows this failure mode?</span>
        <${Button} kind="bad" size="lg" class=${classes(current === 'fail' && 'is-active')} aria-pressed=${current === 'fail' ? 'true' : 'false'}
          disabled=${locked} onClick=${() => answer('fail')} title="Yes, this trace shows the failure mode">Yes <${Kbd}>2<//><//>
        <${Button} kind="good" size="lg" class=${classes(current === 'pass' && 'is-active')} aria-pressed=${current === 'pass' ? 'true' : 'false'}
          disabled=${locked} onClick=${() => answer('pass')} title="No, this trace does not show it">No <${Kbd}>1<//><//>
        <span class="grow"></span>
        <${Button} kind="ghost" icon="arrow-left" title="Previous trace (K)" disabled=${index === 0} onClick=${back} />
        <${Button} kind="secondary" onClick=${advance}>Skip <${Kbd}>J<//><//>
      </div>
      ${current && html`<p class="small muted checks-label-current" role="status">
        Current label: ${current === 'fail' ? 'Yes, it shows this failure mode' : 'No, it does not'}. Answering moves to the next trace.
      </p>`}
    </div>

    <${Modal} open=${confirm} title="Change this trace to Problem?" onClose=${() => { setConfirm(false); refocus(); }}
      footer=${html`<${Button} onClick=${() => { setConfirm(false); refocus(); }}>Cancel<//>
        <${Button} kind="bad" onClick=${changeToProblem}>Change to Problem<//>`}>
      <p>You marked this trace Good in Review traces. Saying it shows "${mode.name}" means the ${who} hit a problem.</p>
      <p class="soft">Changing it marks the trace Problem, tags it with this failure mode, and counts it in the funnel.</p>
    <//>
  </div>`;
}
