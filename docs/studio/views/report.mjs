// Report tab (SPEC 5.3 "Report"): the live funnel, then what you found (the engine's
// reportModel drawn with components), and the six ways to share it or hand it to engineers.

import {
  html, useStore, useState, useEffect, useMemo,
  Button, Chip, StageChip, EmptyState, Icon, CopyButton, toast, plural, formatCount, download,
} from 'pmstack/ui';
import { navigate, projectFile, noteBackup } from '../store.mjs';
import * as lib from '../lib/index.mjs';

const EMPTY = Object.freeze([]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TYPE_NAMES = { code: 'Code check', judge: 'AI judge', policy: 'Code check: policy rules', relevance: 'Code check: intent map' };
const typeLabel = (type) => (typeof lib.checkTypeLabel === 'function' ? lib.checkTypeLabel({ type }) : TYPE_NAMES[type] || 'Check');
const SEVERITY_TONE = { blocks: 'bad', hurts: 'warn', annoys: 'neutral' };

function longDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

const pct = (x) => lib.pct(x);

/** True when the page shows the dark theme (the reader's pick, or the system's under Auto). */
function useDark() {
  const theme = useStore((s) => s.ui.theme);
  const [system, setSystem] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = (e) => setSystem(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme !== 'light' && system);
}

function svgSize(svg) {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1200, h: 680 };
}

function Stat({ value, label }) {
  return html`<div class="report-stat">
    <dt class="report-stat-label">${label}</dt>
    <dd class="report-stat-value num">${value}</dd>
  </div>`;
}

function Section({ id, title, note, children }) {
  return html`<section class="report-section" aria-labelledby=${id}>
    <header class="report-section-head">
      <h2 id=${id} class="report-h2">${title}</h2>
      ${note && html`<p class="report-note">${note}</p>`}
    </header>
    ${children}
  </section>`;
}

function FunnelRows({ model, exp }) {
  return html`<div class="table-wrap">
    <table class="table report-table">
      <thead><tr>
        <th scope="col">Stage</th>
        <th scope="col" class="num">On track</th>
        <th scope="col" class="num">Went wrong here</th>
        <th scope="col">Failure modes that start here</th>
        <th scope="col">Success modes</th>
      </tr></thead>
      <tbody>
        ${model.funnelRows.map((r) => html`<tr key=${r.id}>
          <td><${StageChip} experience=${exp} stageId=${r.id} /></td>
          <td class="num">${r.onTrack}</td>
          <td class="num">${r.failedHere}${r.failedHere > 0 && html`<span class="report-of">${pct(r.share)}</span>`}</td>
          <td>${r.failureModes.length
            ? html`<ul class="report-inline">${r.failureModes.map((f) => html`<li key=${f.id}><span class="report-drop" aria-hidden="true"></span>${f.name} <span class="num soft">(${f.count})</span></li>`)}</ul>`
            : html`<span class="muted">None</span>`}</td>
          <td>${r.successModes.length
            ? html`<div class="report-chips">${r.successModes.map((s) => html`<${Chip} key=${s.id} tone="good">${s.name} <span class="num">${s.count}</span><//>`)}</div>`
            : html`<span class="muted">None yet</span>`}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

function FailureModes({ model, exp }) {
  if (!model.failureModes.length) {
    return html`<p class="report-empty-line">No failure modes yet. Group your notes in Failure modes to see them here.</p>`;
  }
  return html`<ol class="report-modes">
    ${model.failureModes.map((f, i) => html`<li key=${f.id} class="report-mode">
      <span class="report-rank num" aria-hidden="true">${i + 1}</span>
      <div class="report-mode-body">
        <div class="report-mode-top">
          <h3 class="report-mode-name">${f.name}</h3>
          <p class="report-mode-count num"><strong>${plural(f.traces, 'trace')}</strong><span class="soft">${pct(f.share)} of ${formatCount(model.stats.counted)}</span></p>
        </div>
        <div class="report-chips">
          ${f.stage && html`<${StageChip} experience=${exp} stageId=${f.stage} />`}
          ${f.severityLabel && html`<${Chip} tone=${SEVERITY_TONE[f.severity] || 'neutral'}>${f.severityLabel}<//>`}
          ${f.decisionLabel && html`<${Chip}>${f.decisionLabel}<//>`}
          ${f.fixedAt && html`<${Chip} tone="good"><${Icon} name="check" size=${13} />Marked fixed<//>`}
          ${f.checks.length > 0 && f.checks.map((c) => html`<${Chip} key=${c.id}><${Icon} name=${c.type === 'judge' ? 'judge' : 'code'} size=${13} />${typeLabel(c.type)}<//>`)}
          <span class="report-priority num">Priority ${f.priority}</span>
        </div>
        ${f.definition && html`<p class="report-def">${f.definition}</p>`}
        ${f.impact && html`<p class="report-impact"><span class="report-label">Impact</span>${f.impact}</p>`}
        ${f.quotes[0] && html`<blockquote class="report-quote"><span class="report-label">Example note</span>${f.quotes[0]}</blockquote>`}
      </div>
    </li>`)}
  </ol>`;
}

function SuccessModes({ model, exp }) {
  if (!model.successModes.length) return html`<p class="report-empty-line">No success modes yet. Tag what went well on Good traces to see them here.</p>`;
  return html`<div class="table-wrap">
    <table class="table report-table">
      <thead><tr><th scope="col">Success mode</th><th scope="col">Stage</th><th scope="col" class="num">Traces</th><th scope="col" class="num">Share</th></tr></thead>
      <tbody>
        ${model.successModes.map((s) => html`<tr key=${s.id}>
          <td><span class="report-good-dot" aria-hidden="true"></span>${s.name}${s.definition && html`<span class="report-sub">${s.definition}</span>`}</td>
          <td>${s.stage ? html`<${StageChip} experience=${exp} stageId=${s.stage} />` : html`<span class="muted">Unknown stage</span>`}</td>
          <td class="num">${s.traces}</td>
          <td class="num">${pct(s.share)}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

function rateClass(x) {
  if (x == null) return 'report-rate';
  return 'report-rate ' + (x >= 0.9 ? 'is-good' : x < 0.8 ? 'is-bad' : '');
}

function Checks({ model }) {
  if (!model.checks.length) return html`<p class="report-empty-line">No checks yet. Build one for a failure mode in Checks.</p>`;
  return html`<div class="stack">
    ${model.passAll && html`<p class="report-passall"><${Icon} name="check" />${model.passAll.sentence}</p>`}
    <div class="table-wrap">
      <table class="table report-table report-checks-table">
        <thead><tr>
          <th scope="col">Check</th>
          <th scope="col" class="num">Catches real failures</th>
          <th scope="col" class="num">Agrees on good traces</th>
          <th scope="col" class="num">Labels</th>
          <th scope="col">Measured on</th>
          <th scope="col">Likely true failure rate</th>
        </tr></thead>
        <tbody>
          ${model.checks.map((c) => html`<tr key=${c.id}>
            <td class="report-check-name">
              <button type="button" class="report-link" onClick=${() => navigate('checks', c.id)}>${c.name}</button>
              <span class="report-sub">${typeLabel(c.type)} for ${c.modeName}${c.ci ? '. Runs on every change.' : ''}</span>
            </td>
            <td class="num"><span class=${rateClass(c.catchesFailures)}>${pct(c.catchesFailures)}</span></td>
            <td class="num"><span class=${rateClass(c.agreesOnGood)}>${pct(c.agreesOnGood)}</span></td>
            <td class="num">${c.n ? html`${c.nFail} Problem<span class="report-sub">${c.nPass} Good</span>` : html`<span class="muted">None yet</span>`}</td>
            <td><${Chip}>${c.split}<//></td>
            <td>${c.likely
              ? html`<strong class="num">${pct(c.likely.estimate)}</strong>${c.likely.low != null && html`<span class="report-sub num">95% range: ${pct(c.likely.low)} to ${pct(c.likely.high)}</span>`}`
              : html`<span class="muted">${c.type === 'judge' ? 'After the final test' : 'AI judges only'}</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <p class="report-note">Catches real failures: of the traces you marked as showing the problem, the share the check also caught. Agrees on good traces: of the traces you marked Good, the share the check also marked Good. Aim for both above 90%.</p>
  </div>`;
}

function Versions({ model }) {
  const v = model.versions;
  return html`<div class="table-wrap">
    <table class="table report-table">
      <thead><tr><th scope="col">Failure mode</th>${v.versions.map((x) => html`<th key=${x} scope="col" class="num">${x}</th>`)}</tr></thead>
      <tbody>
        ${v.rows.map((r) => html`<tr key=${r.modeId}>
          <td>${r.name}</td>
          ${r.cells.map((c) => html`<td key=${c.version} class="num report-version-cell">
            ${c.reviewed ? html`<span>${c.traces} of ${c.reviewed} reviewed <span class="soft">(${pct(c.share)})</span></span>` : html`<span class="muted">Not reviewed</span>`}
            ${c.checkTotal != null && html`<span class="report-sub">Check fails ${c.checkFails} of ${formatCount(c.checkTotal)}</span>`}
          </td>`)}
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

function NextSteps({ model }) {
  if (!model.nextSteps.length) return html`<p class="report-empty-line">Decide what to do about each failure mode in the Funnel tab: fix it now, build a check, or keep watching.</p>`;
  return html`<ul class="report-next">
    ${model.nextSteps.map((s) => html`<li key=${s.modeId}>
      <${Chip}>${s.decisionLabel}<//>
      <div class="report-next-text"><strong>${s.name}</strong>${s.fixedAt ? html` <span class="soft">(marked fixed)</span>` : ''}<span>${s.text}.</span></div>
    </li>`)}
  </ul>`;
}

function Action({ children, help, extra }) {
  return html`<div class="report-action">
    ${children}
    ${help && html`<p class="hint">${help}</p>`}
    ${extra}
  </div>`;
}

function Actions({ project, model }) {
  const id = project.id || 'project';
  const funnelName = `${id}-funnel.svg`;
  const regression = useMemo(() => lib.regressionSet(project), [project]);
  const ci = useMemo(() => lib.ciChecks(project), [project]);
  const regressionCount = regression ? regression.trim().split('\n').length : 0;
  const save = (filename, text, type, done) => {
    try {
      download(filename, text, type);
      if (done) done();
    } catch (err) {
      toast('Could not prepare the download: ' + err.message, { tone: 'bad' });
    }
  };
  return html`<div class="report-actions-box">
    <h2 class="report-h2 report-actions-title">Share and hand off</h2>
    <${Action} help="Paste it into a doc, a wiki page, or a ticket.">
      <${CopyButton} kind="primary" size="md" label="Copy as Markdown" text=${() => lib.markdownReport(project)} />
    <//>
    <${Action} help="The same report as a file. Keep the funnel image in the same folder to show the picture.">
      <${Button} icon="download" onClick=${() => save(`${id}-report.md`, lib.markdownReport(project, { funnelImage: funnelName }), 'text/markdown')}>Download report (.md)<//>
    <//>
    <${Action} help="The funnel above, for slides and documents.">
      <${Button} icon="download" onClick=${() => save(funnelName, lib.funnelSvg(model.funnel, { theme: 'light' }), 'image/svg+xml')}>Download funnel image (.svg)<//>
    <//>
    <${Action} help="Everything you did, to reopen later or share with a teammate.">
      <${Button} icon="download" onClick=${() => { const f = projectFile(project); save(f.filename, f.text, 'application/json', noteBackup); }}>Download project (.json)<//>
    <//>
    <${Action} help="Traces every future version must still handle. Give this to your engineers."
      extra=${regressionCount
        ? html`<p class="hint num">${plural(regressionCount, 'trace')}.</p>`
        : html`<p class="hint report-hint-empty">Empty for now. Choose Fix it now or Build a check for a failure mode in the Funnel tab.</p>`}>
      <${Button} icon="download" disabled=${!regressionCount} onClick=${() => save(`${id}-regression.jsonl`, regression, 'application/x-ndjson')}>Download regression set (.jsonl)<//>
    <//>
    <${Action} help="Code checks your engineers can run on every change."
      extra=${ci.checks.length
        ? html`<p class="hint num">${plural(ci.checks.length, 'check')}.</p>`
        : html`<p class="hint report-hint-empty">No check runs on every change yet. Turn on "Run on every change" for a check in <button type="button" class="report-link" onClick=${() => navigate('checks')}>Checks</button>.</p>`}>
      <${Button} icon="download" disabled=${!ci.checks.length} onClick=${() => save(`${id}-checks.json`, JSON.stringify(ci, null, 2) + '\n', 'application/json')}>Download checks for your build (.json)<//>
    <//>
    <p class="report-share"><${Icon} name="warning" /><span>The report quotes your traces. Read it before sharing outside your company.</span></p>
  </div>`;
}

export default function ReportView() {
  const project = useStore((s) => s.project);
  const dark = useDark();
  const model = useMemo(() => (project ? lib.reportModel(project) : null), [project]);
  const svg = useMemo(() => (model && model.stats.counted ? lib.funnelSvg(model.funnel, { theme: dark ? 'dark' : 'light', idPrefix: 'rpf' }) : ''), [model, dark]);
  const src = useMemo(() => (svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : ''), [svg]);
  if (!project || !model) return null;
  const exp = project.experience || {};

  if (!model.stats.counted) {
    return html`<section class="page report">
      <h1 class="page-title">Report</h1>
      <${EmptyState} icon="doc" title="Nothing to report yet" body="Your report fills in as you review."
        action=${{ label: 'Next: Review traces', onClick: () => navigate('review') }} />
    </section>`;
  }

  const size = svgSize(svg);
  const checksCount = (project.checks || EMPTY).length;
  return html`<section class="page report">
    <header class="report-head">
      <p class="report-eyebrow">Report<span aria-hidden="true"> / </span><span class="num">${longDate(model.date)}</span></p>
      <h1 class="report-title">${model.title}</h1>
      <p class="report-summary">${model.summary}</p>
      <dl class="report-stats">
        <${Stat} label="Reviewed" value=${`${formatCount(model.stats.reviewed)} of ${formatCount(model.stats.total)}`} />
        <${Stat} label="Had a problem" value=${String(model.funnel.failed)} />
        ${model.funnel.ignored > 0 && html`<${Stat} label="Not a product problem" value=${String(model.funnel.ignored)} />`}
        <${Stat} label="Good outcome" value=${`${model.outcome.passed} of ${model.outcome.counted}`} />
        <${Stat} label="Failure modes" value=${String(model.failureModes.length)} />
        <${Stat} label="Checks" value=${String(checksCount)} />
      </dl>
    </header>

    <figure class="report-funnel">
      <div class="report-funnel-scroll">
        <img class="report-funnel-img" src=${src} width=${size.w} height=${size.h} alt=${lib.funnelDescription(model.funnel)} />
      </div>
      <figcaption class="report-note">Open the Funnel tab to see the traces behind each number.</figcaption>
    </figure>

    <div class="report-layout">
      <div class="report-main">
        <${Section} id="report-where" title="Where traces go wrong">
          <${FunnelRows} model=${model} exp=${exp} />
          <p class="report-note">
            Good outcome: ${model.outcome.passed} of ${model.outcome.counted}.
            ${model.outcome.unknown ? ` Unknown stage: ${model.outcome.unknown}.` : ''}
            ${model.outcome.ignored ? ` Not a product problem: ${model.outcome.ignored} (not counted).` : ''}
          </p>
        <//>
        <${Section} id="report-modes" title="Failure modes" note="Ranked by priority: traces x severity (Blocks 3, Hurts 2, Annoys 1).">
          <${FailureModes} model=${model} exp=${exp} />
        <//>
        <${Section} id="report-success" title="Success modes" note="What goes right at each stage, worth keeping as the product changes.">
          <${SuccessModes} model=${model} exp=${exp} />
        <//>
        <${Section} id="report-checks" title="Checks">
          <${Checks} model=${model} />
        <//>
        ${model.versions && html`<${Section} id="report-versions" title="Before and after" note="Each failure mode by version of your product.">
          <${Versions} model=${model} />
        <//>`}
        <${Section} id="report-next" title="Next steps">
          <${NextSteps} model=${model} />
        <//>
      </div>
      <aside class="report-actions" aria-label="Share and hand off">
        <${Actions} project=${project} model=${model} />
      </aside>
    </div>
  </section>`;
}
