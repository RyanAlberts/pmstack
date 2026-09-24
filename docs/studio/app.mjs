// Eval Studio shell: router, top bar, help drawer, toasts, and the view for the current route.

import {
  html, render, useStore, useKeys, useState, useEffect, useMemo, useRef, shallowEqual, classes, formatCount,
  Button, Chip, Drawer, Tabs, Icon, Kbd, Menu, Toaster, toast, dismissToast, download, MOD_LABEL,
} from './ui.mjs';
import {
  store, init, navigate, setRoute, setUi, onNotice, openProject, openSample, flush, projectFile, noteBackup, hashFor, leaveBlocked,
} from './store.mjs';
import { reviewStats, userWord } from './lib/index.mjs';
import welcome from './views/welcome.mjs';
import setup from './views/setup.mjs';
import review from './views/review.mjs';
import modes from './views/modes.mjs';
import funnel from './views/funnel.mjs';
import checks from './views/checks.mjs';
import report from './views/report.mjs';
import { AssistDrawer } from './views/assist.mjs';

const VIEWS = { welcome, setup, review, modes, funnel, checks, report };

// The six numbered tabs, with the method panel line for each as hover text.
const TABS = [
  { id: 'setup', n: 1, label: 'Set up', line: 'Set up: load your traces and choose how your product looks.' },
  { id: 'review', n: 2, label: 'Review traces', line: 'Review traces: read each trace, mark Good or Problem, write what went wrong.' },
  { id: 'modes', n: 3, label: 'Failure modes', line: 'Failure modes: group your notes into named failure modes.' },
  { id: 'funnel', n: 4, label: 'Funnel', line: 'Funnel: see the stage where each failing trace went wrong first, and what to fix first.' },
  { id: 'checks', n: 5, label: 'Checks', line: 'Checks: turn the failure modes that matter into checks, and confirm they agree with you.' },
  { id: 'report', n: 6, label: 'Report', line: 'Report: share what you found and hand checks to your engineers.' },
];
const TAB_LABELS = { welcome: 'Welcome', open: 'Opening sample', ...Object.fromEntries(TABS.map((t) => [t.id, t.label])) };
const PROJECT_TABS = new Set(TABS.map((t) => t.id));
const KNOWN_TABS = new Set(['welcome', 'open', ...PROJECT_TABS]);
const THEMES = ['auto', 'light', 'dark'];
const THEME_NAMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };

// ---------------------------------------------------------------------------
// Router

/** '#/review/t%2F1' -> { tab: 'review', param: 't/1', known: true } */
function parseHash(hash) {
  const path = String(hash || '').replace(/^#\/?/, '');
  if (!path) return { tab: 'welcome', param: null, known: true };
  const cut = path.indexOf('/');
  const tab = cut === -1 ? path : path.slice(0, cut);
  let param = cut === -1 ? null : path.slice(cut + 1);
  if (param != null) {
    try {
      param = decodeURIComponent(param);
    } catch {
      // Keep the raw text when the address is not valid percent-encoding.
    }
    if (param === '') param = null;
  }
  if (!KNOWN_TABS.has(tab)) return { tab: 'welcome', param: null, known: false };
  return { tab, param, known: true };
}

function followHash() {
  const r = parseHash(location.hash);
  if (r.known && leaveBlocked(r.tab, r.param)) {
    // A view with unsaved input asks first: put its address back until the reader decides.
    const cur = store.get().route;
    history.replaceState(null, '', hashFor(cur.tab, cur.param));
    return;
  }
  if (!r.known) navigate('welcome', null, { replace: true });
  else setRoute(r.tab, r.param);
}

// Opens samples from #/open/<id> and sends project tabs to Welcome when nothing is open.
function useRouteGuards(ready, route, hasProject, kind) {
  const opening = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const { tab, param } = route;
    if (tab === 'open') {
      if (opening.current === param) return;
      if (!param) {
        navigate('welcome', null, { replace: true });
        return;
      }
      if (kind === 'folder') {
        toast('Samples open in the web version of Eval Studio. This one works on your folder.');
        navigate('review', null, { replace: true });
        return;
      }
      opening.current = param;
      openSample(param)
        .then(() => navigate('review', null, { replace: true }))
        .catch((err) => {
          toast(err.message, { tone: 'bad' });
          navigate('welcome', null, { replace: true });
        })
        .finally(() => {
          opening.current = null;
        });
      return;
    }
    if (PROJECT_TABS.has(tab) && tab !== 'setup' && !hasProject) navigate('welcome', null, { replace: true });
  }, [ready, route.tab, route.param, hasProject, kind]);
}

// ---------------------------------------------------------------------------
// Top bar

function Brand() {
  return html`<a class="brand" href="#/" aria-label="pmstack Eval Studio, home" onClick=${(e) => { if (leaveBlocked('welcome')) e.preventDefault(); }}>
    <svg class="brand-mark" width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="5" width="26" height="6" rx="3" />
      <rect x="7.5" y="13" width="17" height="6" rx="3" />
      <rect x="12" y="21" width="8" height="6" rx="3" />
    </svg>
    <span class="brand-name">pmstack</span>
    <span class="brand-product">Eval Studio</span>
  </a>`;
}

function ProjectSwitcher() {
  const project = useStore((s) => s.project);
  const projects = useStore((s) => s.projects);
  const kind = useStore((s) => s.storageKind);
  const tab = useStore((s) => s.route.tab);
  // The new project wizard is a project of its own until it is created.
  const creating = useStore((s) => s.storageKind === 'browser' && s.route.tab === 'setup' && s.route.param === 'new');

  const open = async (id) => {
    try {
      await openProject(id);
      navigate(PROJECT_TABS.has(tab) ? tab : 'review');
    } catch (err) {
      toast(err.message, { tone: 'bad' });
    }
  };

  let items;
  if (kind === 'folder') {
    items = [{ label: 'Project settings', icon: 'folder', onClick: () => navigate('setup') }];
  } else {
    const sorted = projects.slice().sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : (a.updatedAt || '') > (b.updatedAt || '') ? -1 : 0));
    items = [
      ...sorted.map((p) => ({
        label: p.name,
        hint: `${p.sample ? 'Sample data, ' : ''}${formatCount(p.reviewed)} of ${formatCount(p.traceCount)} reviewed`,
        selected: !!project && p.id === project.id,
        onClick: () => open(p.id),
      })),
      sorted.length ? 'divider' : null,
      { label: 'All projects', icon: 'folder', onClick: () => navigate('setup') },
      { label: 'New project', icon: 'plus', onClick: () => navigate('setup', 'new') },
      { label: 'Try a sample product', icon: 'arrow-right', onClick: () => navigate('welcome') },
    ];
  }

  return html`<div class="project-switch">
    <${Menu} kind="ghost" label=${creating ? 'New project' : project ? project.name : 'No project open'} icon=${kind === 'folder' ? 'folder' : null}
      items=${items} title="Switch project" />
    ${!creating && project && project.sample && html`<${Chip} class="sample-badge">Sample data<//>`}
  </div>`;
}

function tabBadges(project) {
  if (!project) return {};
  let stats = null;
  try {
    stats = reviewStats(project);
  } catch {
    stats = null;
  }
  const failureModes = (project.modes || []).filter((m) => m.kind === 'failure').length;
  return {
    review: stats ? html`${formatCount(stats.reviewed)} of ${formatCount(stats.total)}<span class="sr-only"> reviewed</span>` : null,
    modes: failureModes ? String(failureModes) : null,
  };
}

function NavTabs() {
  const tab = useStore((s) => s.route.tab);
  const project = useStore((s) => s.project);
  const traceId = useStore((s) => s.ui.traceId);
  // While a new project is being made, the switcher reads "New project", so the old project's counts stay hidden.
  const creating = useStore((s) => s.storageKind === 'browser' && s.route.tab === 'setup' && s.route.param === 'new');
  const counts = useMemo(() => tabBadges(project), [project && project.reviews, project && project.traces, project && project.modes]);
  const badges = creating ? {} : counts;
  const nav = useRef(null);
  useEffect(() => {
    // On narrow screens the tab row scrolls sideways: keep the current tab in view.
    const el = nav.current;
    const active = el && el.querySelector('.navtab.is-active');
    if (!active || el.scrollWidth <= el.clientWidth) return;
    const a = active.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (a.left < box.left || a.right > box.right) {
      el.scrollLeft += a.left - box.left - (box.width - a.width) / 2;
    }
  }, [tab]);
  return html`<nav class="navtabs" aria-label="Steps" ref=${nav}>
    <ol class="navtabs-list">
      ${TABS.map((t) => {
        const disabled = !project && t.id !== 'setup';
        const active = tab === t.id;
        return html`<li key=${t.id}>
          <a class=${classes('navtab', active && 'is-active', disabled && 'is-disabled')}
            href=${hashFor(t.id, t.id === 'review' ? traceId : null)} title=${t.line}
            aria-current=${active ? 'page' : undefined} aria-disabled=${disabled ? 'true' : undefined}
            tabindex=${disabled ? -1 : undefined}
            onClick=${(e) => { if (disabled || leaveBlocked(t.id, t.id === 'review' ? traceId : null)) e.preventDefault(); }}>
            <span class="navtab-num" aria-hidden="true">${t.n}</span>
            <span class="navtab-label">${t.label}</span>
            ${badges[t.id] && html`<span class="badge">${badges[t.id]}</span>`}
          </a>
        </li>`;
      })}
    </ol>
  </nav>`;
}

function folderName(folder) {
  const path = folder && folder.folder ? String(folder.folder) : '';
  return path.split(/[\\/]/).filter(Boolean).pop() || 'your folder';
}

function SaveIndicator() {
  const s = useStore((st) => ({
    save: st.saveState, kind: st.storageKind, folder: st.folder, has: !!st.project, memory: st.memoryOnly, other: st.externalChange,
  }), shallowEqual);
  if (!s.has) return null;
  let text;
  let title;
  if (s.save === 'saving') {
    text = 'Saving...';
    title = s.kind === 'folder' ? 'Writing to pmstack/project.json' : 'Writing to this browser';
  } else if (s.save === 'error') {
    text = 'Could not save';
    title = 'Select to try again';
  } else if (s.save === 'readonly') {
    text = 'Read only';
    title = s.other === 'deleted' ? 'This project was deleted in another tab. Reload to keep working.'
      : s.other ? 'This project changed in another tab. Reload to keep working.' : 'Eval Studio saves again once pmstack/project.json can be read.';
  } else if (s.kind === 'folder') {
    text = `Saving to ${folderName(s.folder)}`;
    title = s.folder && s.folder.projectPath ? s.folder.projectPath : 'pmstack/project.json';
  } else {
    text = 'Saved in this browser only';
    title = s.memory ? 'This browser blocks saving: download the project before closing the tab.' : 'Download the project from Set up to keep a copy.';
  }
  const body = html`<span class=${classes('save-dot', 'is-' + s.save)} aria-hidden="true"></span><span class="save-text">${text}</span>`;
  if (s.save === 'error') {
    return html`<button type="button" class="save is-error" title=${title} onClick=${() => flush()}>${body}</button>`;
  }
  return html`<span class=${classes('save', 'is-' + s.save)} title=${title}>${body}</span>`;
}

function ThemeToggle() {
  const theme = useStore((s) => s.ui.theme);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const icon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'auto';
  return html`<${Button} kind="ghost" size="sm" icon=${icon} class="theme-toggle"
    aria-label=${`Theme: ${THEME_NAMES[theme]}. Switch to ${THEME_NAMES[next]}.`} title=${`Theme: ${THEME_NAMES[theme]}`}
    onClick=${() => setUi({ theme: next })}><span class="theme-label">${THEME_NAMES[theme]}</span><//>`;
}

function TopBar() {
  return html`<header class="topbar">
    <div class="topbar-row">
      <${Brand} />
      <span class="topbar-divider" aria-hidden="true"></span>
      <${ProjectSwitcher} />
      <div class="topbar-end">
        <${SaveIndicator} />
        <${Button} kind="ghost" size="sm" icon="help" title="Help and shortcuts (?)" onClick=${() => setUi({ helpOpen: true })} />
        <${ThemeToggle} />
      </div>
    </div>
    <${NavTabs} />
  </header>`;
}

// ---------------------------------------------------------------------------
// Banners under the top bar

function readSessionFlag(key) {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function Banners() {
  const s = useStore((st) => ({ kind: st.storageKind, folder: st.folder, loadError: st.loadError }), shallowEqual);
  const [hidden, setHidden] = useState(() => readSessionFlag('pmstack-folder-banner'));
  const hide = () => {
    setHidden(true);
    try {
      sessionStorage.setItem('pmstack-folder-banner', '1');
    } catch {
      // Hidden for this page view only.
    }
  };
  const err = s.loadError;
  const detail = err && err.message ? (/[.!?]$/.test(err.message) ? err.message : err.message + '.') : '';
  return html`
    ${err && html`<div class="banner banner-bad" role="alert">
      <${Icon} name="warning" />
      <p><strong>pmstack/project.json could not be read${err.line ? ` (line ${err.line})` : ''}.</strong>
        ${' '}${detail} Fix the file and Eval Studio picks it up again. Nothing is saved until then.</p>
    </div>`}
    ${s.kind === 'folder' && !hidden && html`<div class="banner">
      <${Icon} name="folder" />
      <p>Working in <strong title=${s.folder && s.folder.folder}>${folderName(s.folder)}</strong>. Your reviews save to pmstack/project.json in that folder, where Claude Code and the pmstack command can read them.</p>
      <${Button} kind="ghost" size="sm" icon="x" title="Hide this message" onClick=${hide} />
    </div>`}`;
}

// ---------------------------------------------------------------------------
// Help drawer: shortcuts and plain-words glossary (SPEC 0.3)

const SHORTCUTS = [
  { group: 'Anywhere', rows: [
    [[['?']], 'Open this help'],
    [[['Esc']], 'Close a drawer or dialog'],
  ] },
  { group: 'Review traces', rows: [
    [[['1']], 'Good'],
    [[['2']], 'Problem'],
    [[['3'], ['D']], 'Not sure yet'],
    [[['N']], 'Write a note'],
    [[['Esc']], 'Leave the note box'],
    [[['J']], 'Next trace'],
    [[['K']], 'Previous trace'],
    [[[MOD_LABEL, 'Enter']], 'Save and go to the next trace'],
    [[['H']], 'Show or hide the steps behind the scenes'],
    [[['U'], [MOD_LABEL, 'Z']], 'Undo the last change on this trace'],
  ] },
  { group: 'Re-checking and labeling a failure mode', rows: [
    [[['2']], 'Yes, this trace shows it'],
    [[['1']], 'No, it does not'],
  ] },
];

// [plain label, definition ({user} = the project's user word), course term, optional note]
const WORDS = [
  ['trace', 'One full conversation or task, with every step the AI took and what the {user} saw.', 'trace'],
  ['error discovery', 'Reading traces to find which failures are worth measuring.', 'error analysis'],
  ['writing notes', "A short note on each trace about the first thing that went wrong, in the {user}'s terms.", 'open coding'],
  ['grouping notes', 'Sorting notes into named failure modes.', 'axial coding'],
  ['failure mode', 'A named, recurring way the product lets the {user} down.', 'failure mode'],
  ['success mode', 'A named, recurring way the product gets it right at one stage.', 'success mode'],
  ['stage', 'One step of the funnel of an AI experience, such as understand, look up, act, reply.', 'stage'],
  ['reviewer', 'The person whose judgment sets the bar.', 'benevolent dictator, or principal domain expert'],
  ['code check', 'A rule a computer can test, like "no formatting symbols in text messages".', 'code-based evaluator'],
  ['AI judge', 'A prompt that asks a model to decide pass or fail for one failure mode.', 'LLM-as-judge'],
  ['Agrees on good traces', 'Of the traces you marked Good, the share the check also marked Good.', 'TPR (Pass is positive, judgy convention)',
    "judgy and the validate-evaluator skill call this TPR because they treat Pass as the positive class. Hamel and Shreya's FAQ uses the opposite convention, where TPR is the share of failures caught. pmstack shows plain labels for this reason."],
  ['Catches real failures', 'Of the traces you marked as showing the problem, the share the check also caught.', 'TNR'],
  ['Likely true failure rate', "The failure rate after correcting for the judge's known mistakes, with a 95% range.", 'Rogan-Gladen corrected rate'],
  ['examples, tuning set, final test', 'Examples go in the prompt; the tuning set is for improving the prompt; the final test is used once.', 'train, dev, test'],
  ['regression set', 'Traces every future version must still handle.', 'golden dataset'],
  ['new failure modes stop appearing', 'The point where reading more traces no longer turns up new failure modes.', 'theoretical saturation'],
  ['run on every change', 'Automatic checks your engineers run on every code change.', 'CI'],
  ['view', 'How a trace is drawn (chat, email, answer with sources...).', 'renderer'],
  ['product setup', 'What your product is, who uses it, its stages, and how its traces are drawn.', 'experience config'],
  ['how your AI works', 'How the product is built, such as one call with tools, a step by step chain, or an agent.', 'pattern (Anthropic)'],
  ['details', 'Fields like channel or persona that you can filter on.', 'metadata'],
  ['next set', 'The traces picked for you to review next.', 'batch'],
  ['your yes or no for one failure mode', 'Whether one trace shows one failure mode. Checks are measured against these answers.', 'per-mode label'],
  ['pattern', 'A text rule that matches words or symbols, used by code checks.', 'regex'],
  ['formatting symbols like ** and #', 'Marks that make bold text or headings in some apps but show up as raw characters in a text message.', 'Markdown'],
];

function KeyCombo({ combo }) {
  return html`<span class="key-combo">${combo.map((k) => html`<${Kbd} key=${k}>${k}<//>`)}</span>`;
}

function ShortcutList() {
  return html`<div class="help-keys">
    ${SHORTCUTS.map((g) => html`<section class="help-group" key=${g.group}>
      <h3 class="help-group-title">${g.group}</h3>
      <dl class="help-list">
        ${g.rows.map(([alts, what]) => html`<div class="help-row" key=${what}>
          <dt>${alts.map((combo, i) => html`${i > 0 && html`<span class="help-or">or</span>`}<${KeyCombo} combo=${combo} />`)}</dt>
          <dd>${what}</dd>
        </div>`)}
      </dl>
    </section>`)}
    <p class="hint">Keys do nothing while you type in a text box, except Esc and ${MOD_LABEL} Enter.</p>
  </div>`;
}

function Glossary({ user }) {
  return html`<dl class="glossary">
    ${WORDS.map(([label, definition, term, note]) => html`<div class="glossary-row" key=${label}>
      <dt>${label}</dt>
      <dd>
        <span class="glossary-def">${definition.split('{user}').join(user)}</span>
        <span class="glossary-term">Course term: ${term}</span>
        ${note && html`<span class="glossary-note">${note}</span>`}
      </dd>
    </div>`)}
  </dl>`;
}

function HelpDrawer() {
  const open = useStore((s) => s.ui.helpOpen);
  const experience = useStore((s) => (s.project ? s.project.experience : null));
  const [tab, setTab] = useState('keys');
  let user = 'customer';
  try {
    if (experience) user = userWord(experience);
  } catch {
    user = 'customer';
  }
  return html`<${Drawer} open=${open} title="Help" class="help-drawer" onClose=${() => setUi({ helpOpen: false })}>
    <${Tabs} label="Help sections" value=${tab} onChange=${setTab}
      items=${[{ id: 'keys', label: 'Shortcuts' }, { id: 'words', label: 'Words we use' }]} />
    <div class="help-panel" role="tabpanel">
      ${tab === 'keys' ? html`<${ShortcutList} />` : html`<${Glossary} user=${user} />`}
    </div>
  <//>`;
}

// The AI help drawer opens from any view with setUi({ assistOpen: { mode: 'scan' | 'group', modeId, kind } }).
// kind ('failure' | 'success') picks what the grouping prompt sorts.
function AssistHost() {
  const assist = useStore((s) => s.ui.assistOpen);
  const opts = assist && typeof assist === 'object' ? assist : {};
  return html`<${AssistDrawer} open=${!!assist} mode=${opts.mode || 'scan'} modeId=${opts.modeId || null} kind=${opts.kind || null}
    onClose=${() => setUi({ assistOpen: false })} />`;
}

// ---------------------------------------------------------------------------
// App

function useTheme(theme) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    try {
      if (theme === 'light' || theme === 'dark') localStorage.setItem('pmstack-theme', theme);
      else localStorage.removeItem('pmstack-theme');
    } catch {
      // The choice lasts for this page view.
    }
  }, [theme]);
}

function OpeningView() {
  return html`<div class="page"><p class="boot-line" role="status">Opening the sample...</p></div>`;
}

function App() {
  const ready = useStore((s) => s.ready);
  const route = useStore((s) => s.route);
  const hasProject = useStore((s) => !!s.project);
  const projectName = useStore((s) => (s.project ? s.project.name : ''));
  const kind = useStore((s) => s.storageKind);
  const theme = useStore((s) => s.ui.theme);
  const mainRef = useRef(null);
  const lastTab = useRef(route.tab);

  useKeys({ '?': () => setUi({ helpOpen: true }) });
  useTheme(theme);
  useRouteGuards(ready, route, hasProject, kind);

  useEffect(() => {
    document.title = [TAB_LABELS[route.tab], projectName, 'Eval Studio'].filter(Boolean).join(' · ');
  }, [route.tab, projectName]);

  useEffect(() => {
    // After a tab change from the top bar, move focus to the new content (views may focus their own field first).
    if (lastTab.current !== route.tab) {
      scrollTo(0, 0);
      const active = document.activeElement;
      if (mainRef.current && (!active || active === document.body || active.closest('.topbar'))) mainRef.current.focus({ preventScroll: true });
    }
    lastTab.current = route.tab;
  }, [route.tab]);

  if (!ready) return html`<div class="boot"><p class="boot-line" role="status">Loading Eval Studio...</p></div>`;

  const View = VIEWS[route.tab] || (route.tab === 'open' ? OpeningView : VIEWS.welcome);
  return html`
    <button type="button" class="skip-link" onClick=${() => mainRef.current && mainRef.current.focus()}>Skip to content</button>
    <${TopBar} />
    <${Banners} />
    <main id="main" ref=${mainRef} tabindex="-1" class=${classes('main', 'main-' + route.tab)}>
      <${View} key=${route.tab} param=${route.param} />
    </main>
    <${HelpDrawer} />
    <${AssistHost} />
    <${Toaster} />`;
}

// Messages from the store become toasts; named actions become buttons.
function noticeAction(action) {
  if (action === 'reload') return { label: 'Reload', onClick: () => location.reload() };
  if (action === 'download-project') {
    return {
      label: 'Download',
      onClick: () => {
        const p = store.get().project;
        if (!p) return;
        const file = projectFile(p);
        download(file.filename, file.text, 'application/json');
        noteBackup();
      },
    };
  }
  return undefined;
}

function BootError({ message }) {
  return html`<div class="boot">
    <div class="boot-error" role="alert">
      <h1>Eval Studio could not start</h1>
      <p>${message}</p>
      <${Button} kind="primary" onClick=${() => location.reload()}>Reload<//>
    </div>
  </div>`;
}

const root = document.getElementById('app');
// A notice with a key can be taken down later with { clear: key } (for example once another project opens).
const keyedToasts = new Map();
onNotice((message, opts = {}) => {
  if (opts.clear) {
    if (keyedToasts.has(opts.clear)) dismissToast(keyedToasts.get(opts.clear));
    keyedToasts.delete(opts.clear);
    return;
  }
  const id = toast(message, { action: noticeAction(opts.action), sticky: !!opts.sticky });
  if (opts.key) keyedToasts.set(opts.key, id);
});
addEventListener('hashchange', followHash);
render(html`<${App} />`, root);

init()
  .then(({ lastRoute }) => {
    const hasHash = location.hash && location.hash !== '#' && location.hash !== '#/';
    const s = store.get();
    if (!hasHash && s.project && (s.storageKind === 'folder' || !location.hash)) {
      // Returning reader: pick up where they left off.
      const back = lastRoute && PROJECT_TABS.has(lastRoute.tab) ? lastRoute : { tab: 'review', param: null };
      navigate(back.tab, back.param, { replace: true });
    } else {
      followHash();
    }
  })
  .catch((err) => {
    render(html`<${BootError} message=${err && err.message ? err.message : String(err)} />`, root);
  });
