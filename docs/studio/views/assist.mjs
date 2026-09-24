// AI help drawer (SPEC 5.3): copy a prompt into any AI assistant, paste its reply back, and
// turn it into suggestions the reviewer accepts or dismisses. In folder mode, Claude Code
// can write suggestions directly; they arrive through the store's suggestions poll.

import {
  html, useStore, useState, useEffect, useMemo, useKeys,
  Drawer, Button, Segmented, CopyButton, Icon, Kbd, plural, formatCount, MOD_LABEL,
} from 'pmstack/ui';
import { updateProject, navigate, setUi, DEFAULT_FILTERS } from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { gates } from './shared.mjs';

const EMPTY = Object.freeze([]);

function ago(iso, now) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m === 1 ? '1 minute ago' : `${m} minutes ago`;
}

function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function AgentStatus({ project }) {
  const poll = useStore((s) => s.suggestionsPoll);
  const now = useNow(5000);
  const open = (project.suggestions || EMPTY).filter((s) => s.status === 'open').length;
  let status;
  if (poll && poll.error) status = `Could not read new suggestions: ${poll.error}`;
  else if (poll && poll.at) status = `Checked for new suggestions ${ago(poll.at, now)}. ${plural(open, 'open suggestion')}.`;
  else status = 'Checking for new suggestions...';
  return html`<section class="assist-agent" aria-label="Claude Code">
    <p><strong>Claude Code can do this for you:</strong> run <code>/pmstack:error-discovery</code> in this folder. New suggestions appear here automatically.</p>
    <p class="assist-poll" role="status"><span class=${'assist-poll-dot' + (poll && poll.error ? ' is-error' : '')} aria-hidden="true"></span>${status}</p>
  </section>`;
}

function Locked({ children }) {
  return html`<p class="assist-locked"><${Icon} name="sparkle" size=${16} /><span>${children}</span></p>`;
}

function PromptSteps({ parts, part, onPart, reply, onReply, onAdd, result, onFollow, followLabel }) {
  const n = parts.length;
  const text = parts[part] || '';
  return html`<ol class="assist-steps">
    <li class="assist-step">
      <p class="assist-step-title">Copy the prompt${n > 1 ? ` (Part ${part + 1} of ${n})` : ''}</p>
      ${n > 1 && html`<div class="assist-parts" role="group" aria-label="Prompt parts">
        ${parts.map((_, i) => html`<button type="button" key=${i} class=${'assist-part' + (i === part ? ' is-active' : '')}
          aria-pressed=${i === part ? 'true' : 'false'} onClick=${() => onPart(i)}>Part ${i + 1}</button>`)}
      </div>`}
      <div class="row">
        <${CopyButton} text=${text} label=${n > 1 ? `Copy part ${part + 1}` : 'Copy the prompt'} kind="primary" size="md" />
        <span class="hint num">${formatCount(text.length)} characters</span>
      </div>
      <details class="assist-preview">
        <summary>See the prompt</summary>
        <pre class="assist-pre" tabindex="0">${text}</pre>
      </details>
    </li>
    <li class="assist-step">
      <p class="assist-step-title">Paste it into your AI assistant</p>
      <p class="hint">${n > 1 ? 'Use a new chat for each part. Each part stands on its own.' : 'A new chat works best.'}</p>
    </li>
    <li class="assist-step">
      <label class="assist-step-title" for="assist-reply">Paste the reply here</label>
      <textarea id="assist-reply" class="assist-reply" rows="6" value=${reply} placeholder="Paste the whole reply, including the part in curly brackets."
        onInput=${(e) => onReply(e.currentTarget.value)}></textarea>
      <div class="row">
        <${Button} kind="primary" icon="plus" disabled=${!reply.trim()} onClick=${onAdd}>Add suggestions<//>
        <span class="hint"><${Kbd}>${MOD_LABEL}<//> <${Kbd}>Enter<//></span>
      </div>
      ${result && result.errors.length > 0 && html`<div class="assist-errors" role="alert">
        <p><strong>${result.found ? 'Part of the reply could not be used:' : 'We could not read that reply.'}</strong></p>
        <ul>${result.errors.map((e, i) => html`<li key=${i}>${e}</li>`)}</ul>
      </div>`}
      ${result && result.found > 0 && html`<div class="assist-done" role="status">
        <p><${Icon} name="check" size=${14} />${result.added
          ? `Added ${plural(result.added, 'suggestion')}.`
          : 'These suggestions are already here.'}${result.nextPart ? ` Now copy part ${result.nextPart}.` : ''}</p>
        <${Button} kind="secondary" size="sm" icon="arrow-right" onClick=${onFollow}>${followLabel}<//>
      </div>`}
    </li>
  </ol>`;
}

function AssistBody({ mode, modeId, kind, onClose }) {
  const project = useStore((s) => s.project);
  const storageKind = useStore((s) => s.storageKind);
  const [tab, setTab] = useState(mode === 'group' ? 'group' : 'scan');
  const [scanId, setScanId] = useState(modeId);
  const [groupKind, setGroupKind] = useState(kind === 'success' ? 'success' : 'failure');
  const [part, setPart] = useState(0);
  const [reply, setReply] = useState('');
  const [result, setResult] = useState(null);

  const modes = project ? project.modes || EMPTY : EMPTY;
  const failureModes = modes.filter((m) => m.kind === 'failure');
  const chosen = failureModes.find((m) => m.id === scanId) || failureModes[0] || null;
  const stats = project ? lib.reviewStats(project) : { reviewed: 0 };
  const { gate, groupGate } = gates(project);
  const scanOpen = stats.reviewed >= gate;
  const groupOpen = stats.reviewed >= groupGate;
  const notes = useMemo(() => (project && tab === 'group'
    ? lib.unassignedNotes(project, groupKind).filter((n) => n.hasNote).length : 0),
  [project && project.reviews, project && project.modes, tab, groupKind]);

  const parts = useMemo(() => {
    if (!project) return EMPTY;
    try {
      if (tab === 'scan') return chosen && scanOpen ? lib.scanPrompt(project, chosen.id) : EMPTY;
      return groupOpen && notes > 0 ? lib.groupingPrompt(project, { kind: groupKind }) : EMPTY;
    } catch {
      return EMPTY;
    }
  }, [project && project.traces, project && project.reviews, project && project.modes, tab, chosen && chosen.id, groupKind, scanOpen, groupOpen, notes]);

  useEffect(() => {
    setPart(0);
    setResult(null);
  }, [tab, chosen && chosen.id, groupKind]);

  const add = () => {
    const text = reply.trim();
    if (!text || !project) return;
    const parsed = tab === 'scan'
      ? lib.parseAssistResponse(text, { kind: 'flag', modeId: chosen ? chosen.id : null })
      : lib.parseAssistResponse(text, { kind: 'mode', modeKind: groupKind });
    let added = 0;
    if (parsed.suggestions.length) {
      updateProject((p) => {
        const before = (p.suggestions || EMPTY).length;
        const q = lib.mergeSuggestions(p, parsed.suggestions);
        added = (q.suggestions || EMPTY).length - before;
        return q;
      }, 'suggestions');
    }
    const nextPart = parsed.suggestions.length && parts.length > 1 && part < parts.length - 1 ? part + 2 : 0;
    setResult({ added, found: parsed.suggestions.length, errors: parsed.errors, nextPart });
    if (parsed.suggestions.length) {
      setReply('');
      if (nextPart) setPart(part + 1);
    }
  };

  useKeys({ 'mod+Enter': add }, { active: !!project });

  if (!project) return html`<p class="soft">Open a project first.</p>`;

  const follow = () => {
    onClose();
    if (tab === 'scan') {
      setUi({ filters: { ...DEFAULT_FILTERS, status: 'suggested', scope: 'all' } });
      const first = lib.filterTraces(project, { status: 'suggested' })[0];
      navigate('review', first || null);
    } else {
      navigate('modes');
    }
  };

  let content;
  if (tab === 'scan') {
    if (!scanOpen) {
      content = html`<${Locked}>AI suggestions unlock after you review ${gate} traces (you've done ${stats.reviewed}). Reading them yourself first keeps your judgment in charge.<//>`;
    } else if (!chosen) {
      content = html`<div class="assist-empty">
        <p class="soft">Name a failure mode first. The AI looks for more traces like the ones you tagged with it.</p>
        <${Button} kind="secondary" size="sm" icon="arrow-right" onClick=${() => { onClose(); navigate('modes'); }}>Go to Failure modes<//>
      </div>`;
    } else {
      content = html`
        <label class="field">
          <span class="label">Failure mode to look for</span>
          <select value=${chosen.id} onInput=${(e) => setScanId(e.currentTarget.value)}>
            ${failureModes.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
          </select>
        </label>
        ${chosen.definition && html`<p class="hint">${chosen.definition}</p>`}
        ${parts.length
          ? html`<${PromptSteps} parts=${parts} part=${part} onPart=${setPart} reply=${reply} onReply=${setReply} onAdd=${add}
              result=${result} onFollow=${follow} followLabel="Show AI flagged traces" />`
          : html`<p class="soft">Every trace already carries this failure mode.</p>`}`;
    }
  } else if (!groupOpen) {
    content = html`<${Locked}>Grouping with AI unlocks after ${groupGate} reviewed traces (you've done ${stats.reviewed}).<//>`;
  } else {
    content = html`
      <${Segmented} label="What to group" value=${groupKind} onChange=${setGroupKind}
        options=${[{ value: 'failure', label: 'Failure modes' }, { value: 'success', label: 'Success modes' }]} />
      <p class="hint">${notes
        ? `${plural(notes, 'note')} not in a ${groupKind === 'success' ? 'success' : 'failure'} mode yet.`
        : groupKind === 'success'
          ? 'Every "what went well" note already belongs to a success mode.'
          : 'Every note already belongs to a failure mode.'}</p>
      ${parts.length > 0 && html`<${PromptSteps} parts=${parts} part=${part} onPart=${setPart} reply=${reply} onReply=${setReply} onAdd=${add}
        result=${result} onFollow=${follow} followLabel="Open Failure modes" />`}`;
  }

  return html`<div class="assist">
    <${Segmented} label="What AI should help with" value=${tab} onChange=${setTab}
      options=${[{ value: 'scan', label: 'Find more traces' }, { value: 'group', label: 'Group my notes' }]} />
    <p class="assist-lead">${tab === 'scan'
      ? 'The AI reads the traces you have not tagged with a failure mode and flags the ones that look like it. You check every flag.'
      : 'The AI sorts your notes into a short list of named modes. You accept, change, or dismiss each one in Failure modes.'}</p>
    ${storageKind === 'folder' && html`<${AgentStatus} project=${project} />`}
    ${parts.length > 0 && html`<p class="assist-privacy"><${Icon} name="warning" size=${14} /><span>This prompt includes your notes and trace text. Paste it only into an AI assistant your company approves.</span></p>`}
    ${content}
  </div>`;
}

/** The AI help drawer. The shell mounts one; views open it with setUi({ assistOpen: { mode, modeId, kind } }). */
export function AssistDrawer({ open, onClose, mode = 'scan', modeId = null, kind = null }) {
  return html`<${Drawer} open=${open} title="AI help" class="assist-drawer" onClose=${onClose}>
    <${AssistBody} mode=${mode} modeId=${modeId} kind=${kind} onClose=${onClose} />
  <//>`;
}

export default AssistDrawer;
