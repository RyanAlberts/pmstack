// Eval Studio in a real browser (SPEC 11 and 12.7). Every test fails on any console error.
// Browser mode runs against serve.mjs (docs/ as GitHub Pages serves it). Folder mode starts
// `pmstack studio` on a temporary copy of a trace folder.

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as lib from '../../docs/studio/lib/index.mjs';
import { loadProjectFile, saveProjectFile } from '../../bin/pmstack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CLI = path.join(REPO, 'bin/pmstack.mjs');
const FAKE_JUDGE = path.join(REPO, 'tests/cli/fake-judge.mjs');
const SAMPLES_DIR = path.join(REPO, 'docs/studio/samples');
const SAMPLE_INDEX = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, 'index.json'), 'utf8'));
const run = promisify(execFile);

const sampleCache = new Map();
function sample(id) {
  if (!sampleCache.has(id)) sampleCache.set(id, JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, id + '.json'), 'utf8')));
  return sampleCache.get(id);
}

// ---------------------------------------------------------------------------
// Fixtures: every browser context blocks outside font requests (the app has fallbacks) and
// records console errors and uncaught page errors. Each test ends by asserting there were none.

async function watch(context, errors) {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console error: ${msg.text()} (${msg.location().url || 'no url'})`);
  });
  context.on('weberror', (err) => errors.push(`page error: ${err.error().message}`));
}

const test = base.extend({
  errors: async ({}, use) => {
    await use([]);
  },
  context: async ({ context, errors }, use) => {
    await watch(context, errors);
    await use(context);
  },
  newContext: async ({ browser, errors }, use) => {
    const made = [];
    await use(async (options = {}) => {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...options });
      await watch(c, errors);
      made.push(c);
      return c;
    });
    for (const c of made) await c.close();
  },
});

test.afterEach(async ({ errors }) => {
  expect(errors, 'console errors and page errors').toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers

/** Open a sample from a deep link and wait for its first trace to review. */
async function openSample(page, id) {
  await page.goto('/studio/#/open/' + id);
  await expect(page).toHaveURL(/#\/review\/[^/]+$/);
  await expect(page.locator('.review-head .review-id')).toBeVisible();
}

const judgePanel = (page) => page.locator('.review-judge');
const tabBadge = (page, label) => page.locator('.navtab', { hasText: label }).locator('.badge');

async function goTab(page, label) {
  await page.locator('.navtab', { hasText: label }).click();
}

async function readDownload(download) {
  return fs.readFileSync(await download.path(), 'utf8');
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Start `pmstack studio <folder> --port 0` and read the one line it prints. */
async function startStudio(folder) {
  const child = spawn(process.execPath, [CLI, 'studio', folder, '--port', '0'], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the studio did not print its address. ${err}`)), 15000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /Eval Studio: (http:\/\/127\.0\.0\.1:\d+\/)\n/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the studio stopped early with exit code ${code}. ${err}`));
    });
  });
  const stop = async () => {
    if (child.exitCode != null || child.signalCode != null) return;
    const done = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
  };
  return { url, stop };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Leave the studio page before its server stops, so the page's polling does not hit a closed port. */
async function leave(page, studio) {
  await page.goto('about:blank').catch(() => {});
  if (studio) await studio.stop();
}

/** Wait until the page stops scrolling (smooth scrolls close open menus). */
async function settleScroll(page) {
  await page.evaluate(async () => {
    let last = -1;
    let same = 0;
    const until = Date.now() + 3000;
    while (same < 5 && Date.now() < until) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const y = scrollY;
      same = y === last ? same + 1 : 0;
      last = y;
    }
  });
}

// ---------------------------------------------------------------------------
// Welcome

test('welcome renders the tagline, the funnel, the samples, and the six steps', async ({ page }) => {
  await page.goto('/studio/');
  await expect(page.locator('.welcome-tagline')).toHaveText("Find how your AI product fails. Then prove it's fixed.");
  await expect(page.locator('.welcome-subhead')).toContainText('name the failure modes');
  await expect(page.locator('.welcome-figure-art svg')).toBeVisible();

  const cards = page.locator('.welcome-sample');
  await expect(cards).toHaveCount(SAMPLE_INDEX.length);
  for (const s of SAMPLE_INDEX) {
    const card = page.locator(`.welcome-sample[href="#/open/${s.id}"]`);
    await expect(card).toContainText(s.name);
    await expect(card.locator('.welcome-sample-count')).toHaveText(`${s.traceCount} traces`);
    await expect(card.locator('.welcome-sample-state')).toHaveText(
      s.reviewed > 0 ? `${s.reviewed} of ${s.traceCount} reviewed: see every step` : 'Fresh: start at trace 1',
    );
  }
  const clinic = sample('clinic-booking');
  expect(SAMPLE_INDEX.find((s) => s.id === 'clinic-booking').reviewed).toBe(lib.reviewStats(clinic).reviewed);

  await expect(page.locator('.welcome-step')).toHaveCount(6);
  await expect(page.locator('.welcome-step').first()).toContainText('Set up: load your traces and choose how your product looks.');
  await page.getByRole('button', { name: 'No traces yet?' }).click();
  await expect(page.locator('#welcome-notraces')).toContainText('/pmstack:synthetic-traces');
});

// ---------------------------------------------------------------------------
// Review traces

test('deep link to the clinic sample in a clean profile opens its first unreviewed trace', async ({ page }) => {
  const clinic = sample('clinic-booking');
  const first = clinic.batch.items.map((it) => String(it.traceId)).find((id) => !clinic.reviews[id]?.verdict);
  await openSample(page, 'clinic-booking');
  await expect(page).toHaveURL(new RegExp(`#/review/${first}$`));
  await expect(page.locator('.review-head .review-id')).toHaveText(first);
  await expect(page.locator('.review-title')).toHaveText(lib.getNormalized(clinic, first).title);
  await expect(judgePanel(page).getByRole('button', { name: /^Good/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(judgePanel(page).getByRole('button', { name: /^Problem/ })).toHaveAttribute('aria-pressed', 'false');
  const stats = lib.reviewStats(clinic);
  await expect(tabBadge(page, 'Review traces')).toContainText(`${stats.reviewed} of ${stats.total}`);
  await expect(page.locator('.review-progress-count')).toHaveText(`${stats.reviewed} of ${stats.total} reviewed`);
  await expect(page.locator('.review-strip-sample')).toHaveText(`Sample: ${stats.reviewed} of ${stats.total} already reviewed, so every tab has something to show.`);
  await expect(page.locator('.sample-badge')).toHaveText('Sample data');
  // Chat hides the steps behind the scenes by default.
  await expect(page.getByRole('button', { name: /Show behind-the-scenes steps/ })).toHaveAttribute('aria-pressed', 'false');
});

test('review with keys: Problem, a note, a stage, next trace; counts update and survive a reload', async ({ page }) => {
  const clinic = sample('clinic-booking');
  const stats = lib.reviewStats(clinic);
  await openSample(page, 'clinic-booking');
  const first = await page.locator('.review-head .review-id').textContent();

  await page.keyboard.press('2');
  await expect(judgePanel(page).getByRole('button', { name: /^Problem/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(tabBadge(page, 'Review traces')).toContainText(`${stats.reviewed + 1} of ${stats.total}`);
  await expect(page.locator('.review-progress-count')).toHaveText(`${stats.reviewed + 1} of ${stats.total} reviewed`);
  await expect(page.locator('.review-progress-split .is-fail')).toHaveText(`${stats.fail + 1} Problem`);

  // Problem with no note moves focus to the note box, so typing goes straight into the note.
  await expect(page.locator('#review-note-box')).toBeFocused();
  const note = 'Says the cleaning moved to Friday, but never asked her to confirm the time.';
  await page.keyboard.type(note);
  await page.keyboard.press('Escape');
  await expect(page.locator('#review-note-box')).not.toBeFocused();

  const stages = judgePanel(page).locator('section[aria-labelledby="review-stage-title"]');
  const reply = stages.getByRole('button', { name: /Reply to the patient/ });
  await reply.click();
  await expect(reply).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.review-head .review-id')).not.toHaveText(first);
  const second = await page.locator('.review-head .review-id').textContent();
  await expect(page).toHaveURL(new RegExp(`#/review/${second}$`));

  await page.reload();
  await expect(page.locator('.review-head .review-id')).toHaveText(second);
  await expect(tabBadge(page, 'Review traces')).toContainText(`${stats.reviewed + 1} of ${stats.total}`);
  await page.locator('.review-center').focus();
  await page.keyboard.press('k');
  await expect(page.locator('.review-head .review-id')).toHaveText(first);
  await expect(page.locator('#review-note-box')).toHaveValue(note);
  await expect(judgePanel(page).getByRole('button', { name: /^Problem/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(stages.getByRole('button', { name: /Reply to the patient/ })).toHaveAttribute('aria-pressed', 'true');
});

test('create a failure mode, add a note to it, and see the new count in the funnel', async ({ page }) => {
  const clinic = sample('clinic-booking');
  const before = lib.computeFunnel(clinic);
  await openSample(page, 'clinic-booking');
  const traceId = await page.locator('.review-head .review-id').textContent();

  await page.keyboard.press('2');
  await expect(page.locator('#review-note-box')).toBeFocused();
  const note = 'Told her the booking was done while the calendar still showed it as pending.';
  await page.keyboard.type(note);
  await judgePanel(page).locator('section[aria-labelledby="review-stage-title"]').getByRole('button', { name: /Reply to the patient/ }).click();

  await goTab(page, 'Failure modes');
  await expect(page).toHaveURL(/#\/modes$/);
  const notes = page.locator('.modes-notes');
  await expect(notes.locator('.modes-note')).toHaveCount(1);
  await expect(notes.locator('.modes-note-text')).toHaveText(note);

  const name = 'Says it is booked when it is not';
  await page.locator('.modes-toolbar').getByRole('button', { name: 'New failure mode' }).click();
  const modal = page.getByRole('dialog', { name: 'New failure mode' });
  await modal.getByLabel('Name').fill(name);
  await modal.getByLabel('Definition').fill('Fails when the reply says a booking is done before the calendar confirms it.');
  await modal.getByLabel('Stage where it starts').selectOption('reply');
  await modal.getByRole('button', { name: 'Create failure mode' }).click();
  await expect(modal).toBeHidden();
  await settleScroll(page);

  await notes.locator('.modes-note').getByRole('button', { name: 'Add to...' }).click();
  await page.getByRole('menuitem', { name: name }).click();
  await expect(notes.locator('.modes-note')).toHaveCount(0);
  const card = page.locator('.modes-quote', { hasText: note });
  await expect(card).toBeVisible();
  await expect(card).toContainText(traceId);

  await goTab(page, 'Funnel');
  await expect(page).toHaveURL(/#\/funnel$/);
  await expect(page.getByRole('button', { name: new RegExp(`^Failure mode ${name}: 1 trace went wrong here first`) }).first()).toBeAttached();
  await expect(page.getByRole('button', { name: `Good outcome: ${before.passed} of ${before.counted + 1} counted traces. Show them.` })).toBeAttached();
  await expect(page.getByRole('button', { name: `Not a product problem: ${before.ignored} traces, not counted. Show them.` })).toBeAttached();
  await expect(tabBadge(page, 'Failure modes')).toHaveText(String(clinic.modes.filter((m) => m.kind === 'failure').length + 1));
});

// ---------------------------------------------------------------------------
// Checks

test('a code check shows its agreement with your labels', async ({ page }) => {
  const clinic = sample('clinic-booking');
  const check = clinic.checks.find((c) => c.id === 'ck-stray-symbols');
  const a = lib.checkAgreement(clinic, check.id);
  await openSample(page, 'clinic-booking');
  await page.goto('/studio/#/checks/' + check.id);
  const agree = page.getByRole('region', { name: 'Agreement with your labels' });
  await expect(agree).toBeVisible();
  const catches = agree.locator('.checks-rate', { hasText: 'Catches real failures' });
  const good = agree.locator('.checks-rate', { hasText: 'Agrees on good traces' });
  await expect(catches.locator('.checks-rate-big')).toHaveText(`${lib.pct(a.catchesFailures)}${a.tn} of ${a.tn + a.fp}`);
  await expect(good.locator('.checks-rate-big')).toHaveText(`${lib.pct(a.agreesOnGood)}${a.tp} of ${a.tp + a.fn}`);
  const fails = lib.runChecks(clinic, { checkIds: [check.id] }).summary[0].fail;
  await expect(page.locator('.checks-results')).toContainText(`Fails ${fails} of ${clinic.traces.length}`);
});

test('the AI judge keeps its final test locked until you reveal it', async ({ page }) => {
  const clinic = sample('clinic-booking');
  const check = clinic.checks.find((c) => c.id === 'ck-person-judge');
  const finalTest = lib.splitCounts(clinic, check.modeId).test;
  await openSample(page, 'clinic-booking');
  await page.goto('/studio/#/checks/' + check.id);
  const lock = page.locator('.checks-lock');
  await expect(lock).toContainText('Final test results are hidden.');
  await expect(lock).toContainText(`The final test holds ${finalTest.pass + finalTest.fail} labels (${finalTest.fail} Problem, ${finalTest.pass} Good)`);
  const row = page.locator('.checks-all-table tr', { hasText: check.name });
  await expect(row.locator('.checks-split-tag')).toHaveText('tuning set');

  await lock.getByRole('button', { name: 'Reveal final test results' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reveal final test results?' });
  await expect(dialog).toContainText('Look at the final test once.');
  await dialog.getByRole('button', { name: 'Not yet' }).click();
  await expect(dialog).toBeHidden();
  await expect(lock).toBeVisible();

  await lock.getByRole('button', { name: 'Reveal final test results' }).click();
  await dialog.getByRole('button', { name: 'Reveal final test results' }).click();
  await expect(page.locator('.checks-lock')).toHaveCount(0);
  await expect(page.getByText(`Measured once, on ${finalTest.pass + finalTest.fail} final test traces the prompt was never tuned on.`)).toBeVisible();
  await expect(row.locator('.checks-split-tag').first()).toHaveText('final test');
});

test('tool call checks: the policy check groups violations by rule, and Review badges the tool call', async ({ page }) => {
  const agent = sample('support-agent');
  const check = agent.checks.find((c) => c.type === 'policy');
  const fails = lib.runChecks(agent, { checkIds: [check.id] }).summary[0].fail;
  const groups = new Map();
  for (const [id, n] of lib.normalizeAll(agent)) {
    for (const v of lib.runCheck(check, n, lib.checkOptions(agent)).violations || []) {
      // Rules made from the tools list (confirm, max-per-trace) group per tool.
      const perTool = v.ruleId === 'confirm' || v.ruleId === 'max-per-trace';
      const key = perTool ? `${v.ruleId}:${v.tool}` : v.ruleId;
      const g = groups.get(key) || { label: perTool ? `${v.label} (${v.tool})` : v.label, ids: new Set() };
      g.ids.add(id);
      groups.set(key, g);
    }
  }
  expect(groups.size).toBeGreaterThan(1);

  await openSample(page, 'support-agent');
  // The sample asks for tool calls to show by default.
  await expect(page.getByRole('button', { name: /Show behind-the-scenes steps/ })).toHaveAttribute('aria-pressed', 'true');

  await goTab(page, 'Checks');
  const panel = page.locator('.checks-tools');
  await expect(panel.locator('.checks-tools-title')).toHaveText('Tool call checks');
  // The sample already has tool call checks, so the panel starts folded.
  const toggle = panel.locator('.checks-tools-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(panel.locator('.checks-tool-q')).toHaveText([/Policy: Is this call allowed\?/, /Relevance: Is it the right call for what the customer asked\?/, /Output grounding: Does the reply match what the tool returned\?/]);

  await page.goto('/studio/#/checks/' + check.id);
  await expect(page.locator('.checks-results')).toContainText(`Breaks the policy in ${fails} of ${agent.traces.length} traces`);
  const byRule = page.locator('.checks-violations');
  await expect(byRule.locator('.checks-h5')).toHaveText('Violations by rule');
  await expect(byRule.locator('.checks-vgroup')).toHaveCount(groups.size);
  for (const g of groups.values()) {
    const summary = byRule.locator('.checks-vgroup summary', { hasText: g.label });
    await expect(summary.locator('.checks-vgroup-count')).toHaveText(`${g.ids.size} ${g.ids.size === 1 ? 'trace' : 'traces'}`);
  }

  // The first violating trace, opened in Review, shows the badge on the tool call that broke the rule.
  const [traceId, n] = [...lib.normalizeAll(agent)].find(([, t]) => Object.values(lib.stepBadges(agent, t)).some((list) => list.some((b) => b.text.startsWith('Breaks policy'))));
  const badges = lib.stepBadges(agent, n);
  const [stepId, list] = Object.entries(badges).find(([, l]) => l.some((b) => b.text.startsWith('Breaks policy')));
  const step = n.steps.find((s) => s.id === stepId);
  expect(step.kind).toBe('tool_call');
  await page.goto('/studio/#/review/' + traceId);
  await expect(page.locator('.review-head .review-id')).toHaveText(traceId);
  const badge = page.locator(`.review-trace [data-step-id="${stepId}"] .rv-badge`).filter({ hasText: list.find((b) => b.text.startsWith('Breaks policy')).text });
  await expect(badge.first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Report and project files

test('report shows the summary and downloads the report, funnel, regression set, and checks', async ({ page }) => {
  const clinic = sample('clinic-booking');
  const model = lib.reportModel(clinic);
  expect(model.summary).toBe('You reviewed 102 of 170 traces. 36 had a problem, and 2 were set aside as not a product problem. The biggest failure mode is Ignores requests for a person (7 traces, 7%), which blocks the patient.');
  await openSample(page, 'clinic-booking');
  await goTab(page, 'Report');
  await expect(page.locator('.report-summary')).toHaveText(model.summary);

  const grab = async (label) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
    return { name: download.suggestedFilename(), text: await readDownload(download) };
  };
  const md = await grab('Download report (.md)');
  expect(md.name).toBe('clinic-booking-report.md');
  expect(md.text).toContain(model.summary);

  const svg = await grab('Download funnel image (.svg)');
  expect(svg.name).toMatch(/\.svg$/);
  expect(svg.text.trimStart().startsWith('<svg')).toBe(true);

  const regression = await grab('Download regression set (.jsonl)');
  const lines = regression.text.trim().split('\n');
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(JSON.parse(line).expected).toBeTruthy();

  const ci = await grab('Download checks for your build (.json)');
  expect(JSON.parse(ci.text).format).toBe('pmstack.checks/1');
});

test('import round-trip: a downloaded project opens in a clean browser with every review', async ({ page, newContext }) => {
  const clinic = sample('clinic-booking');
  const stats = lib.reviewStats(clinic);
  await openSample(page, 'clinic-booking');
  const traceId = await page.locator('.review-head .review-id').textContent();
  await page.keyboard.press('2');
  await expect(page.locator('#review-note-box')).toBeFocused();
  const note = 'Offered Thursday at 9 after she said she works Thursdays.';
  await page.keyboard.type(note);
  await page.keyboard.press('Escape');

  await goTab(page, 'Report');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download project (.json)' }).click()]);
  const file = await download.path();
  const saved = readJson(file);
  expect(saved.format).toBe('pmstack.project/1');
  expect(saved.traces.length).toBe(clinic.traces.length);
  expect(saved.reviews[traceId].note).toBe(note);

  const other = await newContext();
  const fresh = await other.newPage();
  await fresh.goto('/studio/');
  await expect(fresh.locator('.welcome-tagline')).toBeVisible();
  await fresh.locator('label.setup-filebtn', { hasText: 'Open a project file' }).locator('input[type=file]').setInputFiles(file);
  await expect(fresh).toHaveURL(/#\/review/);
  await expect(tabBadge(fresh, 'Review traces')).toContainText(`${stats.reviewed + 1} of ${stats.total}`);
  await fresh.goto('/studio/#/review/' + traceId);
  await expect(fresh.locator('#review-note-box')).toHaveValue(note);
  await expect(judgePanel(fresh).getByRole('button', { name: /^Problem/ })).toHaveAttribute('aria-pressed', 'true');
});

test('a note and a verdict made just before a reload are still there after it', async ({ page }) => {
  await openSample(page, 'clinic-booking');
  const traceId = await page.locator('.review-head .review-id').textContent();
  await page.locator('#review-note-box').click();
  const note = 'Asked for her birthday twice.';
  await page.keyboard.type(note);
  await page.reload();
  await page.goto('/studio/#/review/' + traceId);
  await expect(page.locator('#review-note-box')).toHaveValue(note);
  await page.locator('.review-center').focus();
  await page.keyboard.press('1');
  await page.reload();
  await page.goto('/studio/#/review/' + traceId);
  await expect(judgePanel(page).getByRole('button', { name: /^Good/ })).toHaveAttribute('aria-pressed', 'true');
});

test('a change in another tab stops saving that project only', async ({ page, context }) => {
  await openSample(page, 'clinic-booking');
  const other = await context.newPage();
  await openSample(other, 'clinic-booking');
  await page.bringToFront();
  await page.keyboard.press('1');
  await expect(other.locator('.save')).toContainText('Read only');
  await other.bringToFront();
  await openSample(other, 'gift-finder');
  await expect(other.locator('.save')).toContainText('Saved in this browser only');
  const traceId = await other.locator('.review-head .review-id').textContent();
  await other.keyboard.press('2');
  await other.keyboard.type('Suggests a gift over the budget.');
  await other.keyboard.press('Escape');
  await expect(other.locator('.save')).toContainText('Saved in this browser only');
  await other.reload();
  await other.goto('/studio/#/review/' + traceId);
  await expect(other.locator('#review-note-box')).toHaveValue('Suggests a gift over the budget.');
});

// ---------------------------------------------------------------------------
// Theme and small screens

test('dark mode: the theme toggle and the system setting both switch to the dark tokens', async ({ page }) => {
  const dark = 'rgb(15, 18, 22)';
  const light = 'rgb(247, 246, 242)';
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/studio/');
  await expect(page.locator('.welcome-tagline')).toBeVisible();
  expect(await bg()).toBe(light);

  const toggle = page.locator('.theme-toggle');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName(/^Theme: Light/);
  await toggle.click();
  await expect(toggle).toHaveAccessibleName(/^Theme: Dark/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe(dark);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe(dark);

  await toggle.click();
  await expect(toggle).toHaveAccessibleName(/^Theme: Auto/);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe(dark);

  await openSample(page, 'clinic-booking');
  await expect.poll(bg).toBe(dark);
  await goTab(page, 'Funnel');
  await expect(page.locator('.funnel-svg').first()).toBeVisible();
});

test('no sideways scrolling at 375 px on any tab', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto('/studio/');
  await expect(page.locator('.welcome-tagline')).toBeVisible();
  await expect(page.locator('.welcome-sample').first()).toBeVisible();
  expect(await overflow(), 'Welcome').toBeLessThanOrEqual(0);

  for (const id of ['clinic-booking', 'support-agent']) {
    await openSample(page, id);
    for (const tab of ['review', 'setup', 'modes', 'funnel', 'checks', 'report']) {
      await page.goto(`/studio/#/${tab}`);
      await expect(page.locator(`main.main-${tab}`)).toBeVisible();
      await page.waitForTimeout(150);
      expect(await overflow(), `${id} ${tab}`).toBeLessThanOrEqual(0);
    }
  }
});

// ---------------------------------------------------------------------------
// Every trace of every sample

for (const s of SAMPLE_INDEX) {
  test(`every trace of the ${s.id} sample renders at #/review/<id>`, async ({ page }) => {
    const p = sample(s.id);
    await openSample(page, s.id);
    const problems = [];
    for (const t of p.traces) {
      const id = String(t.id);
      const r = await page.evaluate(async (traceId) => {
        location.hash = '#/review/' + encodeURIComponent(traceId);
        const until = Date.now() + 8000;
        while (Date.now() < until) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const head = document.querySelector('.review-head .review-id');
          const view = document.querySelector('.review-trace .trace-view');
          if (head && head.textContent === traceId && view && view.querySelector('[data-step-id]')) {
            return {
              steps: view.querySelectorAll('[data-step-id]').length,
              broken: !!view.querySelector('.rv-fallback, .rv-broken'),
            };
          }
        }
        return { steps: 0, broken: false, timeout: true };
      }, id);
      if (r.timeout) problems.push(`${id}: no [data-step-id] after 8 s`);
      else if (r.broken) problems.push(`${id}: the view fell back after an error`);
    }
    expect(problems).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// Folder mode (pmstack studio)

test.describe('folder mode', () => {
  /** A temporary copy of tests/fixtures/folder with no pmstack/ folder yet. */
  function fixtureCopy() {
    const folder = tmpDir('pmstack-e2e-folder-');
    fs.cpSync(path.join(REPO, 'tests/fixtures/folder'), folder, { recursive: true });
    fs.rmSync(path.join(folder, 'pmstack'), { recursive: true, force: true });
    return folder;
  }

  test('the studio sets up a fresh folder, and a review lands in pmstack/project.json', async ({ page }) => {
    const folder = fixtureCopy();
    const projectPath = path.join(folder, 'pmstack', 'project.json');
    let studio = null;
    try {
      studio = await startStudio(folder);
      expect(fs.existsSync(projectPath)).toBe(true);
      await page.goto(studio.url);
      await expect(page).toHaveURL(/#\/review\/[^/]+$/);
      await expect(page.locator('.save')).toContainText('Saving to');
      await expect(page.locator('.review-banner', { hasText: 'We guessed your setup' })).toBeVisible();
      const target = await page.locator('.review-head .review-id').textContent();

      await page.keyboard.press('2');
      await expect(page.locator('#review-note-box')).toBeFocused();
      const note = 'Offered a tandem when the rider asked for two hybrids.';
      await page.keyboard.type(note);
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator('.review-head .review-id')).not.toHaveText(target);

      await expect.poll(() => readJson(projectPath).reviews?.[target]?.note, { timeout: 10_000 }).toBe(note);
      const disk = readJson(projectPath);
      expect(disk.reviews[target].verdict).toBe('fail');
      expect(disk.traces).toBeUndefined();
      expect(disk.tracesFile).toBeTruthy();
    } finally {
      await leave(page, studio);
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  test('pmstack judge runs while the studio is open: answers appear, and a later studio edit keeps them', async ({ page }) => {
    const folder = fixtureCopy();
    const projectPath = path.join(folder, 'pmstack', 'project.json');
    let studio = null;
    try {
      await run(process.execPath, [CLI, 'import', path.join(folder, 'traces.jsonl')], { cwd: folder });

      // Setup: one failure mode, ten reviewed traces, and a judge with a pinned model.
      let p = loadProjectFile(projectPath);
      const ids = p.traces.map((t) => String(t.id));
      expect(ids.length).toBeGreaterThanOrEqual(12);
      const made = lib.addMode(p, { kind: 'failure', name: 'Books before the rider says yes', definition: 'Fails when the assistant books a bike before the rider agrees to the time.', stage: null }, { now: '2026-09-20T10:00:00.000Z' });
      p = made.project;
      ids.slice(0, 10).forEach((id, i) => {
        const now = `2026-09-20T11:${String(i).padStart(2, '0')}:00.000Z`;
        p = lib.setVerdict(p, id, i < 4 ? 'fail' : 'pass', { now });
        if (i < 4) p = lib.toggleMode(lib.setNote(p, id, 'Booked the bikes before the rider said yes.', { now }), id, made.id, { now });
      });
      const judge = lib.addCheck(p, {
        type: 'judge', modeId: made.id, name: 'Waits for a yes', prompt: lib.buildJudgePrompt(p, made.id), model: 'fake-model-1', runMode: 'single',
      });
      p = judge.project;
      await saveProjectFile(projectPath, p);

      studio = await startStudio(folder);

      // Opening the judge sets aside its final test; let that save land before the command runs,
      // so the two writers do not collide (a collision is handled, but the browser logs the 409).
      await page.goto(studio.url + '#/checks/' + judge.id);
      await expect(page.locator('.save')).toContainText('Saving to');
      await expect(page.locator('.checks-rounds')).toHaveCount(0);
      await expect.poll(() => Object.keys(readJson(projectPath).splits?.[made.id]?.assign || {}).length, { timeout: 10_000 }).toBeGreaterThan(0);
      await expect(page.locator('.save.is-saved')).toBeVisible();

      const out = await run(process.execPath, [CLI, 'judge', projectPath, '--check', judge.id, '--cmd', `node "${FAKE_JUDGE}" single --model {model}`], { cwd: folder });
      expect(out.stdout).toContain('Catches real failures');
      const judged = readJson(projectPath).checks.find((c) => c.id === judge.id);
      const answers = Object.keys(judged.results).length;
      expect(answers).toBeGreaterThan(0);
      expect(judged.runs.length).toBe(1);

      // The studio picks up the answers without a reload.
      const rounds = page.locator('.checks-rounds tbody tr');
      await expect(rounds).toHaveCount(1, { timeout: 15_000 });
      await expect(rounds.first()).toContainText('fake-model-1');

      // A later edit in the studio keeps the judge answers on disk.
      const later = ids[11];
      await page.goto(studio.url + '#/review/' + encodeURIComponent(later));
      await expect(page.locator('.review-head .review-id')).toHaveText(later);
      await page.keyboard.press('1');
      await expect(judgePanel(page).getByRole('button', { name: /^Good/ })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => readJson(projectPath).reviews?.[later]?.verdict, { timeout: 10_000 }).toBe('pass');
      const kept = readJson(projectPath).checks.find((c) => c.id === judge.id);
      expect(kept.results).toEqual(judged.results);
      expect(kept.runs).toEqual(judged.runs);
    } finally {
      await leave(page, studio);
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  test('the custom view from examples/quickstart loads', async ({ page }) => {
    const folder = tmpDir('pmstack-e2e-quickstart-');
    fs.copyFileSync(path.join(REPO, 'examples/quickstart/traces.jsonl'), path.join(folder, 'traces.jsonl'));
    fs.mkdirSync(path.join(folder, 'pmstack', 'renderers'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'examples/quickstart/pmstack/renderers/sms-card.mjs'), path.join(folder, 'pmstack', 'renderers', 'sms-card.mjs'));
    let studio = null;
    try {
      await run(process.execPath, [CLI, 'import', path.join(folder, 'traces.jsonl'), '--view', 'custom:sms-card'], { cwd: folder });
      expect(readJson(path.join(folder, 'pmstack', 'project.json')).experience.renderer).toBe('custom:sms-card');
      studio = await startStudio(folder);
      await page.goto(studio.url);
      await expect(page).toHaveURL(/#\/review\/[^/]+$/);
      const view = page.locator('.review-trace .trace-view[data-view="custom:sms-card"]');
      await expect(view.locator('.smsc')).toBeVisible();
      await expect(view.locator('[data-step-id]').first()).toBeAttached();
      await expect(view.locator('.rv-notice, .rv-fallback, .rv-broken')).toHaveCount(0);
    } finally {
      await leave(page, studio);
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
