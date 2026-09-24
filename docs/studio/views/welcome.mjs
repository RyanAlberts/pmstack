// Welcome (SPEC 5.3): the first screen. Tagline, the funnel visual, sample products,
// ways to start with your own traces, and how the six tabs fit together.

import { html, useStore, useState, useEffect, useRef, shallowEqual, classes, formatCount, plural, Button, Icon } from 'pmstack/ui';
import { navigate } from '../store.mjs';
import * as lib from '../lib/index.mjs';
import { ImportProjectButton, VIEW_ICONS, viewLabel, sampleStateLine, useSampleIndex } from './setup.mjs';

const TAGLINE = "Find how your AI product fails. Then prove it's fixed.";
const SUBHEAD = 'Read real conversations and tasks from your product (we call each one a trace), name the failure modes, and turn the ones that matter into checks you can trust.';
const FILE_LINE = 'You need a file of real traces; a spreadsheet export works. Most people review 20 to 50 traces in about 30 minutes.';
const FUNNEL_URL = '../assets/visuals/funnel.svg';
const FUNNEL_CAPTION = 'Green chips are success modes to keep working. Red drops are failure modes, each counted once at the first stage that went wrong. The bottom row is the check that now catches each one: a code check (a rule a computer can test) or an AI judge (a prompt that asks a model for pass or fail).';
const GUIDE_URL = 'https://github.com/RyanAlberts/pmstack/blob/main/guides/trace-format.md';
const WEB_STUDIO_URL = 'https://ryanalberts.github.io/pmstack/studio/';

// The method panel: one line per tab (SPEC 0.5).
const METHOD = [
  ['Set up', 'load your traces and choose how your product looks.'],
  ['Review traces', 'read each trace, mark Good or Problem, write what went wrong.'],
  ['Failure modes', 'group your notes into named failure modes.'],
  ['Funnel', 'see the stage where each failing trace went wrong first, and what to fix first.'],
  ['Checks', 'turn the failure modes that matter into checks, and confirm they agree with you.'],
  ['Report', 'share what you found and hand checks to your engineers.'],
];

// ---------------------------------------------------------------------------
// The funnel visual, fetched and inlined so it follows the theme through CSS variables.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Parse the SVG and keep only drawing: no scripts, no embedded HTML, no event handlers, no outside links.
function safeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  for (const el of [...root.querySelectorAll('script, foreignObject, iframe, object, embed, image')]) el.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) el.removeAttribute(attr.name);
      else if (value.includes('javascript:')) el.removeAttribute(attr.name);
    }
  }
  const title = root.querySelector('title');
  const desc = root.querySelector('desc');
  const label = (desc && desc.textContent.trim()) || (title && title.textContent.trim()) || 'The funnel of an AI experience';
  root.setAttribute('role', 'img');
  const named = (root.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).every((id) => doc.getElementById(id));
  if (!root.getAttribute('aria-labelledby') || !named) {
    root.removeAttribute('aria-labelledby');
    root.setAttribute('aria-label', label);
  }
  root.setAttribute('focusable', 'false');
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('class', 'welcome-funnel-svg');
  return document.importNode(root, true);
}

function FunnelFigure() {
  const art = useRef(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let live = true;
    fetch(FUNNEL_URL)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('missing'))))
      .then((text) => {
        const svg = safeSvg(text);
        if (!svg) throw new Error('unreadable');
        if (!live || !art.current) return;
        art.current.replaceChildren(svg);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('missing');
      });
    return () => {
      live = false;
    };
  }, []);
  if (state === 'missing') return null;
  return html`<figure class=${classes('welcome-figure', 'is-' + state)} aria-busy=${state === 'loading' ? 'true' : undefined}>
    <div class="welcome-figure-art" ref=${art}></div>
    <p class="welcome-figure-hint" aria-hidden="true">Scroll sideways to see the whole funnel.</p>
    <figcaption class="welcome-figure-caption">${FUNNEL_CAPTION}</figcaption>
  </figure>`;
}

// ---------------------------------------------------------------------------
// Pieces

function Resume() {
  const s = useStore((st) => {
    const p = st.project;
    if (!p) return null;
    let stats = { reviewed: 0, total: (p.traces || []).length };
    try {
      stats = lib.reviewStats(p);
    } catch {
      // Show the name without counts when the project is still loading.
    }
    return { name: p.name, sample: !!p.sample, reviewed: stats.reviewed, total: stats.total };
  }, shallowEqual);
  if (!s) return null;
  return html`<aside class="welcome-resume" aria-label="Pick up where you left off">
    <span class="welcome-resume-icon" aria-hidden="true"><${Icon} name="arrow-right" /></span>
    <p class="welcome-resume-text">
      <span class="welcome-resume-label">Continue where you left off</span>
      <strong class="welcome-resume-name">${s.name}</strong>
      <span class="welcome-resume-meta num">${formatCount(s.reviewed)} of ${formatCount(s.total)} reviewed</span>
    </p>
    <${Button} kind="primary" icon="arrow-right" onClick=${() => navigate('review')}>Continue reviewing<//>
  </aside>`;
}

function NoTraces({ open }) {
  if (!open) return null;
  return html`<div class="welcome-notraces" id="welcome-notraces">
    <div class="welcome-notraces-item">
      <span class="welcome-notraces-icon" aria-hidden="true"><${Icon} name="download" /></span>
      <div>
        <h3>Export from your logging tool</h3>
        <p>Export one row per conversation, as a spreadsheet (.csv) or a JSON file, from the tool that logs your AI product. Include what the customer said, each step the AI took, and what it replied.</p>
      </div>
    </div>
    <div class="welcome-notraces-item">
      <span class="welcome-notraces-icon" aria-hidden="true"><${Icon} name="code" /></span>
      <div>
        <h3>Generate test conversations</h3>
        <p>In Claude Code, run <code>/pmstack:synthetic-traces</code>. It helps you write realistic requests, run them through your product, and save the traces to a file you can open here.</p>
      </div>
    </div>
    <p class="hint"><a href=${GUIDE_URL} target="_blank" rel="noopener noreferrer">What should a trace file look like?</a></p>
  </div>`;
}

function SampleCard({ sample, copy }) {
  const reviewed = copy ? copy.reviewed : sample.reviewed;
  const total = copy ? copy.traceCount : sample.traceCount;
  const share = total ? Math.min(1, reviewed / total) : 0;
  const state = copy ? `Your copy: ${formatCount(reviewed)} of ${formatCount(total)} reviewed` : sampleStateLine(sample);
  return html`<li class="welcome-sample-item">
    <a class="welcome-sample" href=${'#/open/' + encodeURIComponent(sample.id)}>
      <span class="welcome-sample-top">
        <span class="welcome-sample-icon" aria-hidden="true"><${Icon} name=${VIEW_ICONS[sample.view] || 'doc'} size=${20} /></span>
        <span class="welcome-sample-view">${viewLabel(sample.view)}</span>
      </span>
      <span class="welcome-sample-name">${sample.name}</span>
      <span class="welcome-sample-line">${sample.description}</span>
      <span class="welcome-sample-foot">
        <span class="welcome-sample-count num">${plural(sample.traceCount, 'trace')}</span>
        <span class="welcome-sample-meter" aria-hidden="true"><span style=${{ width: Math.round(share * 100) + '%' }}></span></span>
        <span class=${classes('welcome-sample-state', reviewed > 0 && 'is-started')}>${state}</span>
      </span>
    </a>
  </li>`;
}

function SampleSkeleton() {
  return html`<ul class="welcome-samples" aria-busy="true" aria-label="Loading the sample products">
    ${[0, 1, 2, 3, 4, 5].map((i) => html`<li key=${i} class="welcome-sample-item"><div class="welcome-sample is-skeleton">
      <span class="welcome-skel is-icon"></span><span class="welcome-skel"></span><span class="welcome-skel is-wide"></span><span class="welcome-skel is-short"></span>
    </div></li>`)}
  </ul>`;
}

function Samples() {
  const [samples, retry] = useSampleIndex();
  const projects = useStore((s) => s.projects);
  return html`<section class="welcome-section" aria-labelledby="welcome-samples-title">
    <div class="welcome-section-head">
      <h2 id="welcome-samples-title">Try a sample product</h2>
      <p class="soft">Each one opens as your own copy in this browser, so you can try every tab.</p>
    </div>
    ${samples === null && html`<${SampleSkeleton} />`}
    ${samples && !samples.length && html`<div class="welcome-note" role="alert">
      <p>The sample products could not load. Check your connection, then try again.</p>
      <${Button} size="sm" onClick=${retry}>Try again<//>
    </div>`}
    ${samples && samples.length > 0 && html`<ul class="welcome-samples">
      ${samples.map((s) => html`<${SampleCard} key=${s.id} sample=${s} copy=${projects.find((p) => p.id === s.id && p.sample)} />`)}
    </ul>`}
  </section>`;
}

function Method() {
  return html`<section class="welcome-section welcome-method" aria-labelledby="welcome-method-title">
    <div class="welcome-section-head">
      <h2 id="welcome-method-title">How it works</h2>
      <p class="soft">Six tabs, in order. Each one hands its work to the next.</p>
    </div>
    <ol class="welcome-steps">
      ${METHOD.map(([tab, line], i) => html`<li key=${tab} class="welcome-step">
        <span class="welcome-step-num" aria-hidden="true">${i + 1}</span>
        <p><strong>${tab}:</strong> ${line}</p>
      </li>`)}
    </ol>
  </section>`;
}

// ---------------------------------------------------------------------------
// The view

/** Welcome: shown on first visit and whenever no project is open. */
export default function WelcomeView() {
  const kind = useStore((s) => s.storageKind);
  const folder = kind === 'folder';
  const [noTraces, setNoTraces] = useState(false);
  return html`<div class="page welcome">
    ${!folder && html`<${Resume} />`}
    <header class="welcome-hero">
      <p class="welcome-eyebrow">Eval Studio</p>
      <h1 class="welcome-tagline display">${TAGLINE}</h1>
      <p class="welcome-subhead">${SUBHEAD}</p>
      ${folder
        ? html`<div class="welcome-actions">
            <${Button} kind="primary" size="lg" icon="arrow-right" onClick=${() => navigate('review')}>Review traces<//>
            <${Button} kind="secondary" size="lg" onClick=${() => navigate('setup')}>Set up<//>
          </div>
          <p class="welcome-fileline">Your traces come from the folder this studio is working on.</p>`
        : html`<div class="welcome-actions">
            <${Button} kind="primary" size="lg" icon="arrow-right" onClick=${() => navigate('setup', 'new')}>Review your own traces<//>
            <${ImportProjectButton} label="Open a project file" size="lg" onImported=${() => navigate('review')} />
          </div>
          <p class="welcome-fileline">
            ${FILE_LINE}${' '}
            <button type="button" class="welcome-link" aria-expanded=${noTraces ? 'true' : 'false'} aria-controls="welcome-notraces"
              onClick=${() => setNoTraces(!noTraces)}>No traces yet?</button>
          </p>
          <${NoTraces} open=${noTraces} />`}
    </header>
    <${FunnelFigure} />
    ${folder
      ? html`<div class="welcome-note"><p>Sample products open in the <a href=${WEB_STUDIO_URL} target="_blank" rel="noopener noreferrer">web version of Eval Studio</a>.</p></div>`
      : html`<${Samples} />`}
    <${Method} />
  </div>`;
}
