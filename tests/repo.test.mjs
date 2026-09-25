// repo.test.mjs: rules for the whole repository (SPEC 0.1, 7, 9, 11).
// Copy rules, skill and plugin wiring, links in the docs, the generated visuals, the Preact and
// htm conventions in the studio, and the purity of the engine. The long dash characters and the
// banned word family are built from character codes and fragments, so this file never contains
// what it forbids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
const isDir = (rel) => exists(rel) && statSync(path.join(ROOT, rel)).isDirectory();
const list = (rel) => (isDir(rel) ? readdirSync(path.join(ROOT, rel)).sort() : []);

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
// The word family of the banned word (SPEC 0.1), matched as whole words in any case.
const BANNED_WORD = new RegExp('\\b(dis)?' + 'hon' + 'est(ly|y)?\\b', 'i');
// Filler words the copy rules ban (SPEC 0.1). Checked in the Markdown docs. DECISIONS.md keeps
// its older entries word for word, so it is left out of this one check.
const FILLER = new RegExp('\\b(' + [
  'revolutioni[sz]e', 'seamless(ly)?', 'leverag(e|es|ed|ing)', 'unlock(s|ed|ing)?', 'empower(s|ed|ing)?', 'delve',
  'robust', 'crucial', 'pivotal', 'meticulous', 'intricate', 'tapestry', 'navigate the landscape',
  "in today's fast-paced world", 'at its core', 'rooted in', 'window into', 'game-changer', 'supercharge',
].join('|') + ')\\b', 'i');

const BINARY = /\.(png|gif|mp4|ico|woff2?|jpe?g|webp|pdf|mp3|wav|m4a|ttf|zip)$/i;

/** Repo files that git tracks or would track (untracked but not ignored), relative to ROOT. */
function repoFiles() {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  if (run.status === 0 && run.stdout) {
    return [...new Set(run.stdout.split('\0').filter(Boolean))].filter((f) => existsSync(path.join(ROOT, f)) && statSync(path.join(ROOT, f)).isFile()).sort();
  }
  // No git (for example a downloaded zip): walk the folder, skipping what .gitignore would skip.
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(ROOT, rel))) {
      if (['.git', 'node_modules', 'test-results', '.DS_Store'].includes(name)) continue;
      const child = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk('');
  return out.sort();
}

const TEXT_FILES = repoFiles().filter((f) => !BINARY.test(f));

/** Line numbers (1-based) where a test function is true, for readable failures. */
function hits(text, fn) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, i) => { if (fn(line)) out.push(i + 1); });
  return out;
}

// ---------------------------------------------------------------------------
// Copy rules

test('no long dash (U+2014) anywhere, and no U+2013 used as a sentence dash', () => {
  const problems = [];
  for (const f of TEXT_FILES) {
    const text = read(f);
    const em = hits(text, (line) => line.includes(EM_DASH));
    if (em.length) problems.push(`${f}: U+2014 on lines ${em.join(', ')}`);
    const en = hits(text, (line) => new RegExp('\\s' + EN_DASH + '\\s').test(line));
    if (en.length) problems.push(`${f}: U+2013 used as a dash on lines ${en.join(', ')}`);
  }
  assert.ok(TEXT_FILES.length > 100, `found only ${TEXT_FILES.length} text files`);
  assert.deepEqual(problems, [], 'Restructure the sentence: a comma, a colon, parentheses, or two sentences. Never swap in a hyphen.');
});

test('no word from the banned word family in any file', () => {
  const problems = [];
  for (const f of TEXT_FILES) {
    const lines = hits(read(f), (line) => BANNED_WORD.test(line));
    if (lines.length) problems.push(`${f}: lines ${lines.join(', ')}`);
  }
  assert.deepEqual(problems, [], 'State the point plainly instead.');
});

// The docs this repo writes by hand. Files the README's commands generate (report.md) are left out.
const OUR_DOCS = /^(README|CHANGELOG|CLAUDE|DECISIONS)\.md$|^(guides|skills|templates|commands)\/.*\.md$/;
const DOC_FILES = TEXT_FILES.filter((f) => OUR_DOCS.test(f) && f !== 'DECISIONS.md');

test('no banned filler words in the Markdown docs, skills, and templates', () => {
  const problems = [];
  for (const f of DOC_FILES) {
    const text = read(f);
    for (const n of hits(text, (line) => FILLER.test(line))) problems.push(`${f}:${n}: ${text.split('\n')[n - 1].match(FILLER)[0]}`);
  }
  assert.ok(DOC_FILES.includes('README.md'));
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// Skills, command shims, and the plugin

const SKILLS = list('skills').filter((name) => isDir(`skills/${name}`));

/** The frontmatter of a Markdown file as { key: value } (one line per key). */
function frontmatter(rel) {
  const m = read(rel).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${rel} starts with a frontmatter block`);
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!kv) continue;
    // YAML reads an unquoted value with ": " or " #" in it, or one that starts with a YAML symbol, as
    // something else (or fails), and the skill then loads with no name or description.
    const quoted = /^"[^"]*"$/.test(kv[2]) || /^'[^']*'$/.test(kv[2]);
    assert.ok(quoted || !/:(\s|$)| #|^[[\]{}#&*!|>'"%@`]|^[-?:](\s|$)/.test(kv[2]), `${rel}: put the ${kv[1]} value in double quotes so YAML can read it`);
    out[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

test('every skill folder has a SKILL.md whose name equals the folder', () => {
  assert.equal(SKILLS.length, 12, `12 skills (found ${SKILLS.join(', ')})`);
  for (const name of SKILLS) {
    assert.match(name, /^pmstack-[a-z0-9-]+$/);
    const fm = frontmatter(`skills/${name}/SKILL.md`);
    assert.equal(fm.name, name, `skills/${name}/SKILL.md name`);
    assert.ok(fm.description && fm.description.length > 40, `${name} has a description`);
    assert.ok(fm.description.length < 900, `${name} description is under 900 characters (${fm.description.length})`);
  }
});

test('every command shim points to an existing skill, and every skill has a shim', () => {
  const shims = list('commands').filter((f) => f.endsWith('.md'));
  assert.equal(shims.length, SKILLS.length);
  for (const file of shims) {
    const name = file.replace(/\.md$/, '');
    const fm = frontmatter(`commands/${file}`);
    assert.ok(fm.description, `commands/${file} has a description`);
    assert.ok('argument-hint' in fm, `commands/${file} has an argument-hint`);
    const body = read(`commands/${file}`);
    const named = [...body.matchAll(/`(pmstack-[a-z0-9-]+)`/g)].map((m) => m[1]);
    assert.deepEqual(named, [`pmstack-${name}`], `commands/${file} runs the pmstack-${name} skill`);
    assert.ok(SKILLS.includes(`pmstack-${name}`), `skills/pmstack-${name} exists`);
    assert.match(body, /\$ARGUMENTS/);
    assert.match(body, /\/plugin install pmstack@pmstack/);
  }
});

test('plugin and marketplace manifests point to paths that exist', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(plugin.name, 'pmstack');
  assert.equal(plugin.version, '2.1.0');
  assert.equal(plugin.homepage, 'https://ryanalberts.github.io/pmstack/');
  for (const key of ['skills', 'commands']) {
    assert.equal(typeof plugin[key], 'string', `plugin.json ${key}`);
    assert.ok(isDir(plugin[key]), `plugin.json ${key} path ${plugin[key]} exists`);
  }
  for (const k of ['evals', 'ai-evals', 'error-analysis', 'llm-as-judge', 'product-management', 'claude-code', 'agent-skills']) {
    assert.ok(plugin.keywords.includes(k), `plugin.json keyword ${k}`);
  }
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(market.name, 'pmstack');
  for (const p of market.plugins) assert.ok(isDir(p.source), `marketplace plugin source ${p.source} exists`);
});

test('the README lists every skill and its slash command', () => {
  const readme = read('README.md');
  for (const name of SKILLS) {
    assert.ok(readme.includes(`\`${name}\``), `README names ${name}`);
    assert.ok(readme.includes(`/pmstack:${name.replace(/^pmstack-/, '')}`), `README shows /pmstack:${name.replace(/^pmstack-/, '')}`);
  }
});

// ---------------------------------------------------------------------------
// Links in the docs

/** GitHub's heading anchors for a Markdown file (duplicates get -1, -2, ...). */
function anchors(rel) {
  const out = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of read(rel).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const base = m[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

/** Every link target in a Markdown file: [text](target), and src, srcset, href attributes. */
function linkTargets(rel) {
  const text = read(rel).split('\n');
  const out = [];
  let fenced = false;
  text.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const plain = line.replace(/`[^`]*`/g, '');
    for (const m of plain.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line: i + 1 });
    for (const m of plain.matchAll(/\b(?:src|srcset|href)="([^"]+)"/g)) out.push({ target: m[1].split(/\s+/)[0], line: i + 1 });
  });
  return out;
}

const LINKED_DOCS = TEXT_FILES.filter((f) => OUR_DOCS.test(f));

test('README and guides link only to files and headings that exist', () => {
  assert.ok(LINKED_DOCS.includes('README.md'));
  const guides = LINKED_DOCS.filter((f) => f.startsWith('guides/'));
  assert.deepEqual(guides.map((f) => path.basename(f)).sort(), [
    'agent-patterns.md', 'checks-and-judges.md', 'cli.md', 'credits.md', 'experience-config.md', 'method.md', 'tool-call-evals.md', 'trace-format.md',
  ]);
  const problems = [];
  for (const rel of LINKED_DOCS) {
    for (const { target, line } of linkTargets(rel)) {
      if (/^(https?:|mailto:)/i.test(target)) continue;
      const [filePart, hash] = target.split('#');
      const dest = filePart ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodeURIComponent(filePart))) : rel;
      if (dest.startsWith('..') || !exists(dest)) { problems.push(`${rel}:${line}: ${target} (no file ${dest})`); continue; }
      if (hash && dest.endsWith('.md') && !anchors(dest).has(hash)) problems.push(`${rel}:${line}: ${target} (no heading #${hash} in ${dest})`);
    }
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// Generated visuals

const VISUALS = ['funnel', 'loop', 'notes-to-modes', 'judge-trust', 'patterns', 'tool-calls'];

test('every visual exists as a light, dark, and inline (CSS variable) triple', () => {
  const files = list('docs/assets/visuals').filter((f) => f.endsWith('.svg'));
  // The four visuals that scroll sideways on phones also come in a narrow version (heading wrapped).
  const names = [...VISUALS, ...['funnel', 'loop', 'patterns', 'tool-calls'].map((n) => `${n}-narrow`)];
  const expected = names.flatMap((n) => [`${n}-dark.svg`, `${n}-light.svg`, `${n}.svg`]).sort();
  assert.deepEqual(files, expected);
  for (const f of files) {
    const svg = read(`docs/assets/visuals/${f}`);
    assert.match(svg, /<title[^>]*>[^<]+<\/title>/, `${f} has a title`);
    assert.match(svg, /<desc[^>]*>[^<]+<\/desc>/, `${f} has a description (alt text)`);
    assert.ok(!/<script|<foreignObject|\shref=/i.test(svg), `${f} has no scripts, foreignObject, or links`);
    assert.ok(Buffer.byteLength(svg) < 60 * 1024, `${f} is under 60 KB`);
  }
});

test('scripts/build-visuals.mjs --check finds every visual up to date', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-visuals.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\nRun node scripts/build-visuals.mjs to regenerate.`);
});

// ---------------------------------------------------------------------------
// Studio code conventions (SPEC 4 and 3)

const STUDIO_UI = [
  ...list('docs/studio/views').map((f) => `docs/studio/views/${f}`),
  ...list('docs/studio/renderers').map((f) => `docs/studio/renderers/${f}`),
  'docs/studio/ui.mjs', 'docs/studio/app.mjs',
  ...list('examples/quickstart/pmstack/renderers').map((f) => `examples/quickstart/pmstack/renderers/${f}`),
].filter((f) => f.endsWith('.mjs'));

// SVG presentation attributes that Preact passes through as written, so they must be kebab-case.
const CAMEL_SVG = /\b(stroke(Width|Linecap|Linejoin|Dasharray|Dashoffset|Opacity|Miterlimit)|fill(Rule|Opacity)|clip(Rule|Path)|textAnchor|dominantBaseline|font(Size|Weight|Family|Style)|stop(Color|Opacity)|markerEnd|markerStart|vectorEffect|shapeRendering)=/;
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

test('Preact and htm conventions in views, renderers, ui.mjs, and app.mjs', () => {
  assert.ok(STUDIO_UI.length > 15, `found ${STUDIO_UI.length} studio files`);
  const problems = [];
  for (const f of STUDIO_UI) {
    const text = read(f);
    const say = (lines, what) => { if (lines.length) problems.push(`${f}: ${what} on lines ${lines.join(', ')}`); };
    const code = (line) => !/^\s*(\/\/|\*|\/\*)/.test(line);
    say(hits(text, (l) => code(l) && /<\/?[A-Z][A-Za-z0-9]*[\s>/]/.test(l)), 'a component written as a tag (use <${Comp}> ... <//>)');
    say(hits(text, (l) => code(l) && /\bclassName=/.test(l)), 'className (use class)');
    say(hits(text, (l) => code(l) && CAMEL_SVG.test(l)), 'a camelCase SVG attribute (use kebab-case, such as stroke-width)');
    if (f !== 'docs/studio/views/funnel.mjs') say(hits(text, (l) => code(l) && /dangerouslySetInnerHTML/.test(l)), 'dangerouslySetInnerHTML (only views/funnel.mjs may use it, for funnelSvg)');
    say(hits(text, (l) => code(l) && /\.innerHTML\s*=/.test(l)), 'an innerHTML assignment');
    for (const m of text.matchAll(/<(textarea|input)\b(?:[^>]|=>)*>/g)) {
      if (!/\bonChange=/.test(m[0])) continue;
      const type = (m[0].match(/\btype="?([a-z]+)"?/) || [])[1];
      if (m[1] === 'textarea' || !type || TEXT_INPUT_TYPES.has(type)) {
        problems.push(`${f}:${text.slice(0, m.index).split('\n').length}: a text field uses onChange (use onInput)`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('the engine in docs/studio/lib stays pure: no DOM, storage, network, or Node APIs', () => {
  const files = list('docs/studio/lib').filter((f) => f.endsWith('.mjs'));
  assert.ok(files.includes('index.mjs') && files.includes('toolcalls.mjs'));
  const IMPURE = /\b(document|window)\s*\.|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bfetch\s*\(|\bXMLHttpRequest\b|from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(|\bprocess\./;
  const problems = [];
  for (const f of files) {
    const lines = hits(read(`docs/studio/lib/${f}`), (l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && IMPURE.test(l.replace(/\/\/.*$/, '')));
    if (lines.length) problems.push(`docs/studio/lib/${f}: lines ${lines.join(', ')}`);
  }
  assert.deepEqual(problems, []);
});
