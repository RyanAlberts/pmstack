// Trace views (SPEC 4). Picks the view for a trace, loads custom views in folder mode,
// and keeps one broken view from taking down the page.

import { html, useState, useEffect, RendererBoundary, toast } from 'pmstack/ui';
import { viewFor } from '../lib/index.mjs';
import { store } from '../store.mjs';
import * as chat from './chat.mjs';
import * as email from './email.mjs';
import * as documentView from './document.mjs';
import * as answer from './answer.mjs';
import * as agent from './agent.mjs';
import * as codeReview from './code-review.mjs';
import * as fields from './fields.mjs';
import * as list from './list.mjs';
import * as layout from './layout.mjs';
import * as auto from './auto.mjs';
import { ResultPanel } from './common.mjs';

// A view module's component is its default export (a named function export is accepted too).
function componentOf(mod) {
  if (mod && typeof mod.default === 'function') return mod.default;
  return Object.values(mod || {}).find((v) => typeof v === 'function') || null;
}

/** Built-in views by id. */
export const VIEW_COMPONENTS = {
  chat: componentOf(chat),
  email: componentOf(email),
  document: componentOf(documentView),
  answer: componentOf(answer),
  agent: componentOf(agent),
  'code-review': componentOf(codeReview),
  fields: componentOf(fields),
  list: componentOf(list),
  layout: componentOf(layout),
  auto: componentOf(auto),
};

/** Views that open with the steps behind the scenes shown. */
export function defaultShowHidden(viewId) {
  return viewId === 'agent' || viewId === 'code-review';
}

/** Whether the steps behind the scenes start shown: the product setup's showHiddenDefault when set, else the view's default. */
export function showHiddenFor(experience, viewId) {
  const own = experience ? experience.showHiddenDefault : undefined;
  return typeof own === 'boolean' ? own : defaultShowHidden(viewId);
}

const CUSTOM_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const customCache = new Map(); // viewId -> Promise of component
const customNotices = new Map(); // viewId -> message shown above the trace

function customFailed(viewId, id, message) {
  const text = `Custom view ${id} could not load: ${message}`;
  customNotices.set(viewId, text);
  toast(text, { tone: 'bad' });
  return VIEW_COMPONENTS.auto;
}

/** Resolve a view id to a component. Built-ins resolve at once; custom:<id> loads from the folder. */
export function loadRenderer(viewId) {
  if (VIEW_COMPONENTS[viewId]) return Promise.resolve(VIEW_COMPONENTS[viewId]);
  if (typeof viewId !== 'string' || !viewId.startsWith('custom:')) return Promise.resolve(VIEW_COMPONENTS.auto);
  if (customCache.has(viewId)) return customCache.get(viewId);
  const id = viewId.slice('custom:'.length);
  let job;
  if (store.get().storageKind !== 'folder') {
    job = Promise.resolve(customFailed(viewId, id, 'custom views work when Eval Studio runs on a folder (pmstack studio).'));
  } else if (!CUSTOM_ID.test(id)) {
    job = Promise.resolve(customFailed(viewId, id, 'the name may use only lowercase letters, numbers, and dashes.'));
  } else {
    const url = new URL('custom/renderers/' + id + '.mjs', document.baseURI).href;
    // Ask for the file first, so a missing file gets a plain message instead of the browser's import error.
    job = fetch(url, { cache: 'no-store' })
      .then((res) => (res.status === 404
        ? customFailed(viewId, id, `pmstack/renderers/${id}.mjs is not in this folder.`)
        : import(url).then((mod) => componentOf(mod) || customFailed(viewId, id, 'the file does not export a component.'))))
      .catch((err) => customFailed(viewId, id, err && err.message ? err.message : String(err)));
  }
  customCache.set(viewId, job);
  return job;
}

function BrokenView({ error }) {
  return html`<div class="rv-broken" role="alert">
    <strong>This trace could not be drawn.</strong>
    <span>${error && error.message ? error.message : String(error)}</span>
  </div>`;
}

// Used when the chosen view throws: say so, then draw the trace with the automatic view.
function FallbackView({ error, props }) {
  const Auto = VIEW_COMPONENTS.auto;
  return html`<div class="rv-fallback">
    <p class="rv-notice" role="status">This view had a problem (${error && error.message ? error.message : String(error)}), so the trace is shown with the automatic view.</p>
    <${RendererBoundary} fallback=${(err) => html`<${BrokenView} error=${err} />`}>
      <${Auto} ...${props} />
    <//>
  </div>`;
}

/**
 * Draw one normalized trace with the right view, then what happened as a result.
 * Props: the SPEC 4 contract (trace, experience, showHidden, pickedStepId, onPickStep, highlights,
 * retrieval, onRetrieval, compact, stepBadges). showHidden left undefined uses showHiddenFor.
 */
export function TraceView(props) {
  const { trace, experience } = props;
  let viewId = 'auto';
  try {
    viewId = viewFor(trace, experience || {}) || 'auto';
  } catch {
    viewId = 'auto';
  }
  const builtIn = VIEW_COMPONENTS[viewId] || (viewId.startsWith('custom:') ? null : VIEW_COMPONENTS.auto);
  const [custom, setCustom] = useState(null);

  useEffect(() => {
    if (builtIn) return undefined;
    let live = true;
    setCustom(null);
    loadRenderer(viewId).then((comp) => {
      if (live) setCustom(() => comp);
    });
    return () => {
      live = false;
    };
  }, [viewId, builtIn]);

  if (!trace) return null;
  const View = builtIn || custom;
  const viewProps = { ...props, showHidden: props.showHidden ?? showHiddenFor(experience, viewId) };
  const notice = customNotices.get(viewId);
  const hasResult = trace.result != null && trace.result !== '';

  return html`<div class=${'trace-view' + (props.compact ? ' is-compact' : '')} data-view=${viewId}>
    ${notice && html`<p class="rv-notice" role="status">${notice}</p>`}
    ${View
      ? html`<${RendererBoundary} key=${viewId + ':' + trace.id} fallback=${(err) => html`<${FallbackView} error=${err} props=${viewProps} />`}>
          <${View} ...${viewProps} />
        <//>`
      : html`<p class="rv-loading" role="status">Loading the custom view...</p>`}
    ${hasResult && html`<${RendererBoundary} key=${'result:' + trace.id} fallback=${null}>
      <${ResultPanel} result=${trace.result} compact=${props.compact} />
    <//>`}
  </div>`;
}
