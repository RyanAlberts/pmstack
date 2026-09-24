// Agent view (SPEC 4): the task, then every step on a vertical timeline (tool calls with their
// results, searches, AI steps, hand offs, built-in checks), then the final report.
// Failed steps carry a red "Error" chip and show the error text.

import { html, Icon, classes, plural } from 'pmstack/ui';
import {
  ItemCard, BehindTheScenes, StepMeta, SurfaceLabel, PickButton, LongText, Markdown, EmptyTrace, pairSteps, withHidden, itemIds,
  isErrorStep, stepAttrs, highlightsFor, userName, duration, kindInfo,
} from './common.mjs';
import { OutputBody } from './auto.mjs';

function errorCount(items) {
  let n = 0;
  for (const it of items) {
    if (it.type === 'hidden') n += errorCount(it.items);
    else if (it.type === 'tool') n += isErrorStep(it.call) || isErrorStep(it.result) ? 1 : 0;
    else n += isErrorStep(it.step) ? 1 : 0;
  }
  return n;
}

function spanOf(steps) {
  const t = steps.filter((s) => typeof s.time === 'number').map((s) => s.time);
  const e = steps.map((s) => (typeof s.endTime === 'number' ? s.endTime : s.time)).filter((x) => typeof x === 'number');
  return t.length && e.length ? Math.max(...e) - Math.min(...t) : null;
}

function nodeIcon(g) {
  if (g.type === 'hidden') return 'agent';
  if (g.type === 'tool') return 'wrench';
  return kindInfo(g.step.kind).icon;
}

/** The agent view. */
export default function AgentView(props) {
  const { trace, showHidden, compact } = props;
  const steps = trace.steps || [];
  const out = steps.find((s) => s.isOutput) || null;
  const firstUser = !trace.input ? steps.find((s) => s.kind === 'user' && s.customerVisible) : null;
  const task = trace.input ?? firstUser?.text ?? null;
  const rest = steps.filter((s) => s !== out && s !== firstUser);
  const groups = withHidden(pairSteps(rest), showHidden);
  const errors = errorCount(groups);
  const span = spanOf(steps);
  const toolCount = rest.filter((s) => s.kind === 'tool_call' || s.kind === 'tool').length;
  const who = userName(props.experience);
  const thl = firstUser ? highlightsFor(props.highlights, firstUser.id) : [];
  const outData = out ? (out.kind === 'output' ? out.data : { type: 'text', text: out.text }) : null;

  return html`<div class=${classes('rv-view', 'rv-agent', compact && 'is-compact')}>
    ${task != null && task !== '' && html`<section ...${firstUser ? stepAttrs(props, firstUser.id, 'rv-agent-task') : { class: 'rv-agent-task' }}>
      <div class="rv-agent-task-head">
        <h3 class="rv-label">${firstUser ? `${who} asked` : 'Task'}</h3>
        ${firstUser && html`<${PickButton} stepId=${firstUser.id} stageId=${firstUser.stage} onPickStep=${props.onPickStep} picked=${props.pickedStepId === firstUser.id} />`}
      </div>
      <${LongText} class="rv-agent-task-text" text=${task} limit=${700} highlights=${thl}
        render=${(t) => html`<${Markdown} text=${t} highlights=${thl} />`} />
      ${firstUser && html`<${StepMeta} ...${props} stepId=${firstUser.id} stageId=${firstUser.stage} />`}
    </section>`}

    ${groups.length > 0 && html`<div class="rv-agent-run">
      <p class="rv-agent-sum">
        <span>${plural(rest.length, 'step')}</span>
        ${toolCount > 0 && html`<span>${plural(toolCount, 'tool call')}</span>`}
        ${span != null && span > 0 && html`<span>${duration(span)} in all</span>`}
        ${errors > 0 && html`<span class="rv-agent-errs"><${Icon} name="warning" size=${13} />${plural(errors, 'step')} failed</span>`}
      </p>
      <ol class="rv-timeline">${groups.map((g) => {
        const failed = errorCount([g]) > 0;
        return html`<li class=${classes('rv-tl-item', failed && 'is-error', g.type === 'hidden' && 'is-hidden')} key=${itemIds(g)[0]}>
          <span class="rv-tl-node" aria-hidden="true"><${Icon} name=${failed ? 'x' : nodeIcon(g)} size=${13} /></span>
          ${g.type === 'hidden'
            ? html`<${BehindTheScenes} ...${props} items=${g.items} />`
            : html`<${ItemCard} ...${props} item=${g} />`}
        </li>`;
      })}</ol>
    </div>`}

    ${out
      ? html`<section ...${stepAttrs(props, out.id, 'rv-agent-final')}>
          <${SurfaceLabel} icon="doc" label="Final report" step=${out} props=${props} />
          <div class="rv-agent-final-body"><${OutputBody} ...${props} output=${outData} stepId=${out.id} /></div>
        </section>`
      : !groups.length && html`<${EmptyTrace} />`}
  </div>`;
}
