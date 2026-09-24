// Test helpers: small projects and traces built in code, plus fixture loading.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProject, defaultExperience } from '../../docs/studio/lib/index.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Read a fixture file as text. */
export function fixtureText(name) {
  return readFileSync(here + name, 'utf8');
}

/** Read a JSON fixture. */
export function fixtureJson(name) {
  return JSON.parse(fixtureText(name));
}

/** A chat trace: turns are [role, text] pairs; calls add a tool call before the last reply. */
export function chatTrace(id, turns = [['user', 'hi'], ['assistant', 'hello']], metadata = {}, extra = {}) {
  return { id, metadata, messages: turns.map(([role, content]) => ({ role, content })), ...extra };
}

/** A project with the augmented pattern stages unless stages are given. */
export function makeProject({ traces = [], stages = null, filters = [], userLabel = 'patient', ...rest } = {}) {
  const experience = defaultExperience({ product: 'Test product', userLabel, customerGoal: 'Get help fast.', pattern: 'augmented', renderer: 'chat', filters });
  if (stages) experience.stages = stages;
  const p = createProject({ id: 'test', name: 'Test project', experience, traces, now: '2026-09-15T08:00:00Z' });
  return { ...p, ...rest };
}

/** A review record with timestamps n minutes after a fixed start. */
export function review(verdict, minute, extra = {}) {
  const t = new Date(Date.UTC(2026, 8, 15, 10, 0, 0) + minute * 60000).toISOString();
  return { verdict, note: '', stage: null, step: null, good: '', modes: [], successModes: [], retrieval: null, reviewedAt: verdict ? t : null, at: t, ...extra };
}

/** An ISO time n minutes after the same fixed start. */
export function minuteIso(minute) {
  return new Date(Date.UTC(2026, 8, 15, 10, 0, 0) + minute * 60000).toISOString();
}
