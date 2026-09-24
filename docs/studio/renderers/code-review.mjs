// Code review view (SPEC 4): the pull request title, what the agent looked at (folded),
// the unified diff with line numbers (green additions, red deletions, with + and - markers),
// the agent's comments under the line they are about with severity chips, then the summary and verdict.

import { html, useState, Icon, classes, plural } from 'pmstack/ui';
import {
  BehindTheScenes, StepMeta, PickButton, Markdown, LongText, EmptyTrace, StageTag, StepBadges, FirstProblemTag, Highlightable,
  pairSteps, stepAttrs, highlightsFor, badgesFor, findQuote, asText, isErrorStep,
} from './common.mjs';

// ---------------------------------------------------------------------------
// Unified diff parsing

/** Parse a unified diff into files, hunks, and numbered lines. */
export function parseDiff(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const files = [];
  let file = null;
  let hunk = null;
  let oldN = 0;
  let newN = 0;
  let remOld = 0;
  let remNew = 0;
  const newFile = (path = '') => {
    file = { path, oldPath: null, meta: [], hunks: [], adds: 0, dels: 0, added: false, deleted: false };
    files.push(file);
    hunk = null;
    remOld = 0;
    remNew = 0;
  };
  for (const line of lines) {
    const inHunk = hunk && (remOld > 0 || remNew > 0);
    if (!inHunk && line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      newFile(m ? m[2] : line.slice(11));
      if (m) file.oldPath = m[1];
      continue;
    }
    if (!inHunk && line.startsWith('--- ')) {
      if (!file || file.hunks.length) newFile();
      const p = line.slice(4).trim().replace(/^a\//, '');
      if (p === '/dev/null') file.added = true;
      else file.oldPath = p;
      continue;
    }
    if (!inHunk && line.startsWith('+++ ')) {
      if (!file) newFile();
      const p = line.slice(4).trim().replace(/^b\//, '');
      if (p === '/dev/null') file.deleted = true;
      else file.path = p;
      if (!file.path) file.path = file.oldPath || '';
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (h && !inHunk) {
      if (!file) newFile();
      oldN = +h[1];
      newN = +h[3];
      remOld = h[2] == null ? 1 : +h[2];
      remNew = h[4] == null ? 1 : +h[4];
      hunk = { header: `@@ -${h[1]}${h[2] != null ? ',' + h[2] : ''} +${h[3]}${h[4] != null ? ',' + h[4] : ''} @@`, context: h[5] || '', lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (inHunk) {
      const c = line[0];
      if (c === '+') {
        hunk.lines.push({ t: 'add', text: line.slice(1), newN: newN++ });
        remNew--;
        file.adds++;
      } else if (c === '-') {
        hunk.lines.push({ t: 'del', text: line.slice(1), oldN: oldN++ });
        remOld--;
        file.dels++;
      } else if (c === '\\') {
        hunk.lines.push({ t: 'note', text: line.slice(1).trim() });
      } else {
        hunk.lines.push({ t: 'ctx', text: line.slice(1), oldN: oldN++, newN: newN++ });
        remOld--;
        remNew--;
      }
      continue;
    }
    if (hunk && line.startsWith('\\')) {
      hunk.lines.push({ t: 'note', text: line.slice(1).trim() });
      continue;
    }
    if (file && line.trim()) {
      file.meta.push(line);
      if (/^new file mode/.test(line)) file.added = true;
      if (/^deleted file mode/.test(line)) file.deleted = true;
    }
  }
  for (const f of files) if (!f.path) f.path = f.oldPath || 'file';
  return files.filter((f) => f.hunks.length || f.meta.length);
}

// ---------------------------------------------------------------------------
// Pieces

const SEVERITY = {
  high: { label: 'High', cls: 'rv-sev-high' },
  critical: { label: 'Critical', cls: 'rv-sev-high' },
  medium: { label: 'Medium', cls: 'rv-sev-medium' },
  low: { label: 'Low', cls: 'rv-sev-low' },
  nit: { label: 'Nit', cls: 'rv-sev-nit' },
};

function Severity({ value }) {
  if (!value) return null;
  const s = SEVERITY[String(value).toLowerCase()] || { label: String(value), cls: 'rv-sev-low' };
  return html`<span class=${classes('rv-sev', s.cls)}><span class="sr-only">Severity: </span>${s.label}</span>`;
}

const VERDICT = {
  approve: { label: 'Approved', cls: 'rv-verdict-good', icon: 'check' },
  approved: { label: 'Approved', cls: 'rv-verdict-good', icon: 'check' },
  request_changes: { label: 'Changes requested', cls: 'rv-verdict-bad', icon: 'x' },
  changes_requested: { label: 'Changes requested', cls: 'rv-verdict-bad', icon: 'x' },
  comment: { label: 'Commented', cls: 'rv-verdict-neutral', icon: 'note' },
};

function Verdict({ value }) {
  if (!value) return null;
  const v = VERDICT[String(value).toLowerCase()] || { label: String(value).replace(/_/g, ' '), cls: 'rv-verdict-neutral', icon: 'note' };
  return html`<span class=${classes('rv-verdict', v.cls)}><${Icon} name=${v.icon} size=${13} /><span>${v.label}</span></span>`;
}

function sameFile(a, b) {
  const x = String(a || '').replace(/^\.?\//, '');
  const y = String(b || '').replace(/^\.?\//, '');
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x);
}

/** Which file and line each comment sits under: { byFile: Map(fileIndex -> { lines: Map(key -> [k]), loose: [k] }), other: [k] }. */
function placeComments(files, comments) {
  const byFile = new Map();
  const other = [];
  comments.forEach((c, k) => {
    const fi = files.findIndex((f) => sameFile(f.path, c?.file) || (f.oldPath && sameFile(f.oldPath, c?.file)));
    if (fi < 0) {
      other.push(k);
      return;
    }
    if (!byFile.has(fi)) byFile.set(fi, { lines: new Map(), loose: [] });
    const slot = byFile.get(fi);
    const n = Number(c?.line);
    let key = null;
    if (Number.isFinite(n)) {
      files[fi].hunks.forEach((h, hi) => h.lines.forEach((l, li) => {
        if (key == null && (l.t === 'add' || l.t === 'ctx') && l.newN === n) key = hi + ':' + li;
      }));
      if (key == null) {
        files[fi].hunks.forEach((h, hi) => h.lines.forEach((l, li) => {
          if (key == null && l.t === 'del' && l.oldN === n) key = hi + ':' + li;
        }));
      }
    }
    if (key == null) slot.loose.push(k);
    else {
      if (!slot.lines.has(key)) slot.lines.set(key, []);
      slot.lines.get(key).push(k);
    }
  });
  return { byFile, other };
}

// Quotes for the whole output land on the first piece of text that holds them.
function quoteHome(review, quotes) {
  const pieces = [['title', review.title], ...(review.comments || []).map((c, k) => ['c' + k, c?.body]), ['summary', review.summary]];
  const home = {};
  for (const q of quotes) {
    const hit = pieces.find(([, t]) => t && findQuote(asText(t), q.quote));
    if (hit) (home[hit[0]] = home[hit[0]] || []).push(q);
  }
  return home;
}

function Comment({ c, k, props, home, showWhere }) {
  const id = 'out.c' + k;
  const picked = props.pickedStepId === id;
  const hl = [...highlightsFor(props.highlights, id), ...(home['c' + k] || [])];
  return html`<div ...${stepAttrs(props, id, 'rv-cr-comment')}>
    <div class="rv-cr-comment-head">
      <span class="rv-cr-avatar" aria-hidden="true"><${Icon} name="agent" size=${13} /></span>
      <span class="rv-cr-author">Review agent</span>
      <${Severity} value=${c?.severity} />
      ${showWhere && html`<code class="rv-cr-where">${asText(c?.file)}${c?.line != null ? ':' + c.line : ''}</code>`}
      <span class="rv-card-tags">
        <${StepBadges} badges=${badgesFor(props.stepBadges, id)} />
        ${picked && html`<${FirstProblemTag} />`}
      </span>
      <${PickButton} stepId=${id} stageId=${null} onPickStep=${props.onPickStep} picked=${picked} />
    </div>
    <${Markdown} class="rv-cr-comment-body" text=${asText(c?.body)} highlights=${hl} />
  </div>`;
}

function FileDiff({ file, fi, slot, comments, props, home }) {
  const [open, setOpen] = useState(true);
  const count = slot ? [...slot.lines.values()].reduce((n, l) => n + l.length, 0) + slot.loose.length : 0;
  const rows = [];
  file.hunks.forEach((h, hi) => {
    rows.push(html`<tr class="rv-cr-hunk" key=${'h' + hi}><td colspan="3"><span class="rv-cr-hunk-at">${h.header}</span>${h.context && html` <span class="rv-cr-hunk-ctx">${h.context}</span>`}</td></tr>`);
    h.lines.forEach((l, li) => {
      if (l.t === 'note') {
        rows.push(html`<tr class="rv-cr-note" key=${hi + ':' + li}><td colspan="3">${l.text}</td></tr>`);
        return;
      }
      rows.push(html`<tr class=${classes('rv-cr-line', 'is-' + l.t)} key=${hi + ':' + li}>
        <td class="rv-cr-num">${l.oldN ?? ''}</td>
        <td class="rv-cr-num">${l.newN ?? ''}</td>
        <td class="rv-cr-src"><span class="rv-cr-mark">${l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' '}</span><span class="rv-cr-code">${l.text || ' '}</span></td>
      </tr>`);
      const here = slot && slot.lines.get(hi + ':' + li);
      if (here) {
        rows.push(html`<tr class="rv-cr-comment-row" key=${'c' + hi + ':' + li}><td colspan="3">
          ${here.map((k) => html`<${Comment} key=${k} c=${comments[k]} k=${k} props=${props} home=${home} />`)}
        </td></tr>`);
      }
    });
  });
  const label = file.added ? 'New file' : file.deleted ? 'Deleted' : file.oldPath && file.oldPath !== file.path ? 'Renamed' : null;
  return html`<section class="rv-cr-file">
    <header class="rv-cr-filehead">
      <button type="button" class="rv-cr-fold" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}
        title=${open ? 'Fold this file' : 'Show this file'}>
        <${Icon} name="chevron-down" size=${14} /><span class="sr-only">${open ? 'Fold' : 'Show'} ${file.path}</span>
      </button>
      <code class="rv-cr-path">${file.path}</code>
      ${label && html`<span class="rv-cr-filetag">${label}${label === 'Renamed' ? ' from ' + file.oldPath : ''}</span>`}
      <span class="rv-cr-counts">
        <span class="rv-cr-adds"><span aria-hidden="true">+</span>${file.adds}<span class="sr-only"> added</span></span>
        <span class="rv-cr-dels"><span aria-hidden="true">-</span>${file.dels}<span class="sr-only"> removed</span></span>
      </span>
      ${count > 0 && html`<span class="rv-cr-ccount"><${Icon} name="note" size=${13} />${count}<span class="sr-only"> ${count === 1 ? 'comment' : 'comments'}</span></span>`}
    </header>
    ${open && html`<div class="rv-cr-code-wrap">
      ${file.hunks.length
        ? html`<table class="rv-cr-table">
            <colgroup><col class="rv-cr-col-num" /><col class="rv-cr-col-num" /><col /></colgroup>
            <thead class="sr-only"><tr><th scope="col">Old line</th><th scope="col">New line</th><th scope="col">Code</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
        : html`<p class="rv-cr-meta">${file.meta.join(' · ')}</p>`}
      ${slot && slot.loose.length > 0 && html`<div class="rv-cr-loose">
        <p class="rv-cr-loose-note">${slot.loose.length === 1 ? 'Comment on a line outside this diff' : 'Comments on lines outside this diff'}</p>
        ${slot.loose.map((k) => html`<${Comment} key=${k} c=${comments[k]} k=${k} props=${props} home=${home} showWhere=${true} />`)}
      </div>`}
    </div>`}
  </section>`;
}

function testStatus(steps) {
  const items = pairSteps(steps);
  let found = null;
  for (const it of items) {
    const s = it.type === 'tool' ? it.call : it.step;
    if (!/test/i.test(s.name || '')) continue;
    const r = it.type === 'tool' ? it.result : s;
    const out = asText(r ? (r.data?.output ?? r.data ?? r.text) : '');
    const failed = isErrorStep(s) || isErrorStep(r) || /\bFAIL(ED|URES?)?\b|\b[1-9]\d* (failed|failing)\b|\bERRORS?\b/.test(out);
    found = { name: s.name, failed };
  }
  return found;
}

function ReviewHeader({ review, files, tests, title }) {
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const dels = files.reduce((n, f) => n + f.dels, 0);
  return html`<header class="rv-cr-head">
    <div class="rv-cr-titlerow">
      <span class="rv-cr-titleicon" aria-hidden="true"><${Icon} name="pull" size=${18} /></span>
      <h3 class="rv-cr-title">${title}</h3>
    </div>
    <div class="rv-cr-stats">
      ${files.length > 0 && html`<span>${plural(files.length, 'file')} changed</span>`}
      ${files.length > 0 && html`<span class="rv-cr-counts"><span class="rv-cr-adds">+${adds}<span class="sr-only"> lines added</span></span> <span class="rv-cr-dels">-${dels}<span class="sr-only"> lines removed</span></span></span>`}
      ${tests && html`<span class=${classes('rv-status', tests.failed ? 'rv-status-bad' : 'rv-status-good')} title=${'From ' + tests.name}>
        <${Icon} name=${tests.failed ? 'x' : 'check'} size=${12} /><span>${tests.failed ? 'Tests failed' : 'Tests passed'}</span>
      </span>`}
      <${Verdict} value=${review.verdict} />
    </div>
  </header>`;
}

function Summary({ review, props, home, stepId }) {
  const hl = [...(home.summary || [])];
  const picked = stepId && props.pickedStepId === stepId;
  if (!review.summary && !review.verdict) return null;
  return html`<section class="rv-cr-summary">
    <div class="rv-cr-comment-head">
      <span class="rv-cr-avatar" aria-hidden="true"><${Icon} name="agent" size=${13} /></span>
      <span class="rv-cr-author">Review agent</span>
      <span class="rv-cr-summary-k">Summary</span>
      <${Verdict} value=${review.verdict} />
      ${stepId && html`<span class="rv-card-tags">
        <${StageTag} experience=${props.experience} stageId=${props.stageId} />
        <${StepBadges} badges=${badgesFor(props.stepBadges, stepId)} />
        ${picked && html`<${FirstProblemTag} />`}
      </span>`}
      ${stepId && html`<${PickButton} stepId=${stepId} stageId=${props.stageId} onPickStep=${props.onPickStep} picked=${picked} />`}
    </div>
    ${review.summary
      ? html`<${Markdown} class="rv-cr-summary-body" text=${asText(review.summary)} highlights=${hl} />`
      : html`<p class="rv-cr-meta">No summary written.</p>`}
  </section>`;
}

function titleOf(review, props, home) {
  const title = asText(review.title).trim() || asText(props.trace?.title) || 'Pull request';
  return home.title ? html`<${Highlightable} text=${title} highlights=${home.title} />` : title;
}

/**
 * The diff, its comments, and the summary. Props: review (typed output), stepId, stageId, tests,
 * showHeader (default true), summaryPick, plus the view props.
 */
export function ReviewBody(props) {
  const { review = {}, stepId = 'out', tests = null, showHeader = true } = props;
  const files = parseDiff(review.diff);
  const comments = Array.isArray(review.comments) ? review.comments : [];
  const { byFile, other } = placeComments(files, comments);
  const home = quoteHome(review, highlightsFor(props.highlights, stepId));
  return html`<div class="rv-cr-body">
    ${showHeader && html`<${ReviewHeader} review=${review} files=${files} tests=${tests} title=${titleOf(review, props, home)} />`}
    ${files.length
      ? files.map((f, fi) => html`<${FileDiff} key=${fi + f.path} file=${f} fi=${fi} slot=${byFile.get(fi)} comments=${comments} props=${props} home=${home} />`)
      : review.diff
        ? html`<pre class="rv-cr-raw">${asText(review.diff)}</pre>`
        : html`<p class="rv-cr-meta">This review has no diff.</p>`}
    ${other.length > 0 && html`<section class="rv-cr-other">
      <h4 class="rv-label">${other.length === 1 ? 'Comment on a file not in the diff' : 'Comments on files not in the diff'}</h4>
      ${other.map((k) => html`<${Comment} key=${k} c=${comments[k]} k=${k} props=${props} home=${home} showWhere=${true} />`)}
    </section>`}
    <${Summary} review=${review} props=${props} home=${home} stepId=${props.summaryPick ? stepId : null} />
  </div>`;
}

/** The code review view. */
export default function CodeReviewView(props) {
  const { trace, showHidden, compact } = props;
  const steps = trace.steps || [];
  const out = steps.find((s) => s.isOutput) || null;
  const review = out && out.kind === 'output' && out.data?.type === 'code-review' ? out.data : null;
  const rest = steps.filter((s) => s !== out && !(s.kind === 'user' && s.customerVisible && !trace.input));
  const request = steps.find((s) => s.kind === 'user' && s.customerVisible);
  const items = pairSteps(rest);
  const tests = testStatus(rest);
  const description = asText(trace.input ?? request?.text ?? '');
  // A description that opens with the title line would repeat the header, so that line is dropped.
  const title = asText(review?.title).trim().toLowerCase();
  const firstLine = description.split('\n')[0].trim();
  const descBody = firstLine && title && title.startsWith(firstLine.toLowerCase()) ? description.slice(description.indexOf(firstLine) + firstLine.length).replace(/^\s+/, '') : description;
  const lead = html`
    ${descBody.trim() && html`<section class="rv-cr-desc">
      <h4 class="rv-label">Description</h4>
      <${LongText} text=${descBody} limit=${420} render=${(t) => html`<${Markdown} text=${t} />`} />
    </section>`}
    ${items.length > 0 && html`<${BehindTheScenes} ...${props} class="rv-cr-looked" items=${items}
      label=${showHidden ? 'What the agent looked at' : undefined} />`}`;
  if (!review) {
    return html`<div class=${classes('rv-view', 'rv-crview', compact && 'is-compact')}>
      ${lead}
      ${out
        ? html`<div ...${stepAttrs(props, out.id, 'rv-cr-out')}>
            <${Markdown} text=${out.kind === 'output' ? asText(out.data?.text ?? out.text) : out.text} highlights=${highlightsFor(props.highlights, out.id)} />
            <${StepMeta} ...${props} stepId=${out.id} stageId=${out.stage} />
          </div>`
        : html`<${EmptyTrace}>No review in this trace.<//>`}
    </div>`;
  }
  const home = quoteHome(review, highlightsFor(props.highlights, out.id));
  return html`<div class=${classes('rv-view', 'rv-crview', compact && 'is-compact')}>
    <${ReviewHeader} review=${review} files=${parseDiff(review.diff)} tests=${tests} title=${titleOf(review, props, home)} />
    ${lead}
    <div ...${stepAttrs(props, out.id, 'rv-cr-out')}>
      <${ReviewBody} ...${props} review=${review} stepId=${out.id} stageId=${out.stage} showHeader=${false} summaryPick=${true} />
    </div>
  </div>`;
}
