// Chat view (SPEC 4): text messages, web chat, and phone calls, drawn the way the user saw them.
// metadata.channel picks the look: sms (a phone thread with formatting symbols shown as typed),
// voice or phone (a call transcript with m:ss times, pauses, overlaps, and the recording), else web chat.

import { html, useState, Icon, classes, plural } from 'pmstack/ui';
import {
  MessageBubble, ToolCall, StepCard, BehindTheScenes, StepMeta, PickButton, Highlightable, LongText,
  EmptyTrace, pairSteps, withHidden, itemIds, highlightsFor, stepAttrs, userName, clock,
  timeOfDay, dayLabel, isEpoch,
} from './common.mjs';
import { OutputBody } from './auto.mjs';

const SMS = new Set(['sms', 'text', 'text message', 'texts', 'mms', 'imessage', 'whatsapp', 'rcs']);
const VOICE = new Set(['voice', 'phone', 'call', 'phone call', 'calls', 'ivr']);

/** 'sms' | 'voice' | 'web' from metadata.channel. */
export function channelMode(metadata) {
  const c = String(metadata?.channel ?? '').trim().toLowerCase();
  if (SMS.has(c)) return 'sms';
  if (VOICE.has(c)) return 'voice';
  return 'web';
}

const WEB_NAMES = new Set(['', 'web', 'chat', 'web chat', 'webchat', 'site', 'website', 'widget']);

// The label in the chat window's corner: "Web chat", or the channel as written ("Mobile app").
function channelName(channel) {
  const c = String(channel || '').trim();
  if (WEB_NAMES.has(c.toLowerCase())) return 'Web chat';
  return c[0].toUpperCase() + c.slice(1);
}

function isSpoken(s) {
  return s.customerVisible && (s.kind === 'user' || s.kind === 'assistant' || (s.kind === 'output' && s.data?.type === 'text'));
}

// Groups to draw: messages, tool cards, and "behind the scenes" runs, plus the input when the trace has no user message.
function chatGroups(trace, showHidden) {
  const groups = withHidden(pairSteps(trace.steps || []), showHidden);
  const hasUser = (trace.steps || []).some((s) => s.kind === 'user');
  if (trace.input && !hasUser) groups.unshift({ type: 'input', text: trace.input });
  return groups;
}

function sideOf(g) {
  if (g.type === 'input') return 'them';
  if (g.type !== 'step' || !isSpoken(g.step)) return null;
  return g.step.kind === 'user' ? 'them' : 'us';
}

// Mark bubbles that continue a run from the same side, so they sit closer together.
function withRuns(groups) {
  return groups.map((g, i) => {
    const side = sideOf(g);
    const next = groups[i + 1];
    return { g, side, last: !side || !next || sideOf(next) !== side };
  });
}

// Where a day-and-time line goes: before the first timed message and after any gap over an hour.
function timeMarks(rows) {
  const marks = new Map();
  let last = null;
  rows.forEach(({ g, side }, i) => {
    const t = g.type === 'step' ? g.step.time : null;
    if (!side || !isEpoch(t)) return;
    if (last == null || t - last > 60 * 60 * 1000) marks.set(i, t);
    last = t;
  });
  return marks;
}

function When({ t, cls }) {
  return html`<li class=${cls}><time datetime=${new Date(t).toISOString()}><span>${dayLabel(t)}</span> · <span>${timeOfDay(t)}</span></time></li>`;
}

function InputBubble({ text, side = 'them', plain }) {
  return html`<div class=${classes('rv-msg', 'rv-msg-' + side, plain && 'is-plain', 'rv-msg-input')}>
    <div class="rv-bubble"><${LongText} text=${text} limit=${4000} /></div>
  </div>`;
}

// Anything that is not a message bubble: a tool card, a step card, a typed output, or the behind-the-scenes expander.
function Aside({ g, props, dense }) {
  if (g.type === 'hidden') return html`<${BehindTheScenes} ...${props} class="rv-chat-bts" items=${g.items} />`;
  if (g.type === 'tool') return html`<div class="rv-chat-aside"><${ToolCall} ...${props} step=${g.call} result=${g.result} dense=${dense} /></div>`;
  const s = g.step;
  if (s.kind === 'output') {
    return html`<div ...${stepAttrs(props, s.id, 'rv-chat-output')}>
      <${OutputBody} ...${props} output=${s.data} stepId=${s.id} />
      <${StepMeta} ...${props} stepId=${s.id} stageId=${s.stage} />
      <${PickButton} stepId=${s.id} stageId=${s.stage} onPickStep=${props.onPickStep} picked=${props.pickedStepId === s.id} floating=${true} />
    </div>`;
  }
  return html`<div class="rv-chat-aside"><${StepCard} ...${props} step=${s} /></div>`;
}

function Bubble({ g, side, last, props, plain, who, meta }) {
  if (g.type === 'input') return html`<${InputBubble} text=${g.text} side=${side} plain=${plain} />`;
  const s = g.step;
  const step = s.kind === 'output' ? { ...s, text: s.data?.text ?? s.text } : s;
  return html`<${MessageBubble} ...${props} step=${step} side=${side} plain=${plain} meta=${meta} label=${who} />`;
}

// ---------------------------------------------------------------------------
// Text messages: a phone-width thread. Formatting symbols show exactly as the user saw them.

function SmsThread(props) {
  const { trace, experience, showHidden, compact } = props;
  const who = userName(experience);
  const rows = withRuns(chatGroups(trace, showHidden));
  const marks = timeMarks(rows);
  const out = [];
  rows.forEach(({ g, side, last }, i) => {
    if (marks.has(i)) out.push(html`<${When} key=${'w' + i} t=${marks.get(i)} cls="rv-sms-when" />`);
    const key = g.type === 'input' ? 'input' : itemIds(g)[0];
    out.push(side
      ? html`<li class=${classes('rv-sms-item', 'is-' + side, last && 'is-last')} key=${key}>
          <${Bubble} g=${g} side=${side} last=${last} props=${props} plain=${true} />
        </li>`
      : html`<li class="rv-sms-item is-aside" key=${key}><${Aside} g=${g} props=${props} dense=${true} /></li>`);
  });
  const initial = (who || '?').slice(0, 1).toUpperCase();
  return html`<div class=${classes('rv-view', 'rv-chat', 'rv-sms', compact && 'is-compact')}>
    <div class="rv-sms-phone">
      <div class="rv-sms-screen">
        <div class="rv-sms-head">
          <span class="rv-sms-avatar" aria-hidden="true">${initial}</span>
          <span class="rv-sms-name">${who}</span>
          <span class="rv-sms-sub">Text messages</span>
        </div>
        ${out.length
          ? html`<ol class="rv-sms-thread" aria-label="Text message thread">${out}</ol>`
          : html`<div class="rv-sms-thread"><${EmptyTrace}>No text messages in this trace.<//></div>`}
        <div class="rv-sms-home" aria-hidden="true"></div>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Web chat: a chat window with formatting drawn (bold, lists, links).

function WebChat(props) {
  const { trace, experience, showHidden, compact } = props;
  const rows = withRuns(chatGroups(trace, showHidden));
  const marks = timeMarks(rows);
  const product = String(experience?.product || '').trim();
  const channel = String(trace.metadata?.channel ?? '').trim();
  return html`<div class=${classes('rv-view', 'rv-chat', 'rv-web', compact && 'is-compact')}>
    <div class="rv-web-frame">
      <div class="rv-web-head">
        <span class="rv-web-mark" aria-hidden="true"><${Icon} name="chat" size=${15} /></span>
        <span class="rv-web-title">${product || 'Assistant'}</span>
        <span class="rv-web-sub">${channelName(channel)}</span>
      </div>
      ${rows.length
        ? html`<ol class="rv-web-thread" aria-label="Conversation">${rows.map(({ g, side, last }, i) => {
            const key = g.type === 'input' ? 'input' : itemIds(g)[0];
            const when = marks.has(i) ? html`<${When} key=${'w' + i} t=${marks.get(i)} cls="rv-web-when" />` : null;
            return [when, side
              ? html`<li class=${classes('rv-web-item', 'is-' + side, last && 'is-last')} key=${key}>
                  <${Bubble} g=${g} side=${side} last=${last} props=${props} plain=${false} />
                </li>`
              : html`<li class="rv-web-item is-aside" key=${key}><${Aside} g=${g} props=${props} dense=${true} /></li>`];
          })}</ol>`
        : html`<div class="rv-web-thread"><${EmptyTrace}>No messages in this trace.<//></div>`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Phone calls: a transcript with m:ss times, speaker labels, pauses, overlaps, and the recording.

function Recording({ src }) {
  const [failed, setFailed] = useState(false);
  const r = String(src ?? '').trim();
  if (!r) return null;
  if (/^https?:\/\//i.test(r)) {
    return html`<a class="rv-call-link" href=${r} target="_blank" rel="noopener noreferrer">
      <${Icon} name="external" size=${14} /><span>Open recording</span>
    </a>`;
  }
  const parts = r.replace(/^\.?\/+/, '').split(/[\\/]+/);
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || parts.includes('..')) {
    return html`<p class="rv-call-file">Recording: <code>${r}</code></p>`;
  }
  const url = 'recordings/' + parts.map(encodeURIComponent).join('/');
  return html`<div class="rv-call-audio">
    <audio controls preload="none" src=${url} onError=${() => setFailed(true)} aria-label="Call recording"></audio>
    ${failed
      ? html`<p class="rv-call-file" role="status">This recording could not be played. Recordings play when Eval Studio runs on the folder that holds them.</p>`
      : html`<p class="rv-call-file"><code>${r}</code></p>`}
  </div>`;
}

function secs(ms) {
  const s = ms / 1000;
  return s < 10 ? (Math.round(s * 10) / 10).toFixed(1) + ' s' : Math.round(s) + ' s';
}

function Turn({ step, props, who, overlap }) {
  const side = step.kind === 'user' ? 'them' : 'us';
  const hl = highlightsFor(props.highlights, step.id);
  const text = step.kind === 'output' ? (step.data?.text ?? step.text) : step.text;
  const picked = props.pickedStepId === step.id;
  return html`<div ...${stepAttrs(props, step.id, classes('rv-call-turn', 'is-' + side))}>
    <div class="rv-call-who">
      <span class="rv-call-speaker">${who}</span>
      ${overlap && html`<span class="rv-call-overlap" title="The two speakers talked at the same time">${overlap}</span>`}
    </div>
    <${LongText} class="rv-call-text" text=${text} limit=${3000} highlights=${hl}
      render=${(t) => html`<${Highlightable} text=${t} highlights=${hl} />`} />
    <${StepMeta} ...${props} stepId=${step.id} stageId=${step.stage} />
    <${PickButton} stepId=${step.id} stageId=${step.stage} onPickStep=${props.onPickStep} picked=${picked} floating=${true} />
  </div>`;
}

function firstTime(g) {
  if (g.type === 'hidden') {
    for (const it of g.items) {
      const t = firstTime(it);
      if (t != null) return t;
    }
    return null;
  }
  if (g.type === 'tool') return g.call.time ?? g.result?.time ?? null;
  if (g.type === 'step') return g.step.time;
  return null;
}

function CallTranscript(props) {
  const { trace, experience, showHidden, compact } = props;
  const steps = trace.steps || [];
  const who = userName(experience);
  const times = steps.filter((s) => typeof s.time === 'number').map((s) => s.time);
  const base = times.length ? Math.min(...times) : null;
  const ends = steps.filter((s) => isSpoken(s)).map((s) => (typeof s.endTime === 'number' ? s.endTime : s.time)).filter((x) => typeof x === 'number');
  const total = base != null && ends.length ? Math.max(...ends) - base : null;
  const spoken = steps.filter(isSpoken);
  const groups = chatGroups(trace, showHidden);
  const rows = [];
  let prev = null;
  groups.forEach((g, i) => {
    const t = firstTime(g);
    const stamp = base != null && typeof t === 'number' ? clock(t - base) : '';
    if (g.type === 'input') {
      rows.push(html`<li class="rv-call-row" key="input"><span class="rv-call-time"></span>
        <div class="rv-call-turn is-them"><div class="rv-call-who"><span class="rv-call-speaker">${who}</span></div>
          <${LongText} class="rv-call-text" text=${g.text} limit=${3000} /></div></li>`);
      return;
    }
    if (g.type === 'step' && isSpoken(g.step)) {
      const s = g.step;
      let overlap = null;
      if (prev && typeof s.time === 'number') {
        const prevEnd = typeof prev.endTime === 'number' ? prev.endTime : prev.time;
        if (typeof prev.endTime === 'number' && s.time < prev.endTime && prev.kind !== s.kind) {
          const other = prev.kind === 'user' ? 'the ' + who.toLowerCase() : 'the assistant';
          overlap = `Started ${secs(prev.endTime - s.time)} before ${other} finished`;
        } else if (typeof prevEnd === 'number' && s.time - prevEnd > 3000) {
          rows.push(html`<li class="rv-call-pause" key=${'p' + i}><span class="rv-call-time"></span>
            <span class="rv-call-pause-mark"><${Icon} name="pause" size=${13} /><span>Pause, ${secs(s.time - prevEnd)}</span></span></li>`);
        }
      }
      prev = s;
      rows.push(html`<li class=${classes('rv-call-row', s.kind === 'user' ? 'is-them' : 'is-us')} key=${s.id}>
        <span class="rv-call-time">${stamp}</span>
        <${Turn} step=${s} props=${props} who=${s.kind === 'user' ? who : 'Assistant'} overlap=${overlap} />
      </li>`);
      return;
    }
    rows.push(html`<li class="rv-call-row is-aside" key=${itemIds(g)[0]}>
      <span class="rv-call-time">${stamp}</span>
      <${Aside} g=${g} props=${props} dense=${true} />
    </li>`);
  });
  const recording = trace.metadata?.recording;
  return html`<div class=${classes('rv-view', 'rv-chat', 'rv-call', compact && 'is-compact')}>
    <div class="rv-call-frame">
      <div class="rv-call-head">
        <span class="rv-call-icon" aria-hidden="true"><${Icon} name="phone" size=${16} /></span>
        <span class="rv-call-title">Phone call</span>
        <span class="rv-call-facts">
          ${total != null && total > 0 && html`<span><span class="sr-only">Length </span>${clock(total)}</span>`}
          <span>${plural(spoken.length, 'turn')}</span>
        </span>
      </div>
      ${recording != null && recording !== '' && html`<div class="rv-call-rec"><${Recording} src=${recording} /></div>`}
      ${rows.length
        ? html`<ol class="rv-call-list" aria-label="Call transcript">${rows}</ol>`
        : html`<div class="rv-call-list"><${EmptyTrace}>No transcript in this trace.<//></div>`}
    </div>
  </div>`;
}

/** The chat view. */
export default function ChatView(props) {
  const mode = channelMode(props.trace?.metadata);
  if (mode === 'sms') return html`<${SmsThread} ...${props} />`;
  if (mode === 'voice') return html`<${CallTranscript} ...${props} />`;
  return html`<${WebChat} ...${props} />`;
}

