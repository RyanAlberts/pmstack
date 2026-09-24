# pmstack: guide for agents working on this repo

pmstack is an eval system for product managers built on error discovery: read real traces, write notes, group them into failure modes and success modes, see where each failure starts in the funnel of an AI experience, build checks (code checks or AI judges), prove the judges agree with the reviewer, and keep the checks running. It ships as Eval Studio (a static web app), twelve Agent Skills, a zero-dependency command-line tool, generated visuals, a landing page, and a quiz. Users start from [README.md](README.md); the method is in [guides/method.md](guides/method.md).

## Layout

| Path | What lives there |
|---|---|
| `docs/studio/lib/*.mjs` | The engine: pure ES2022 modules shared by the studio, the CLI, and the visual generator. `index.mjs` re-exports everything. |
| `docs/studio/` | Eval Studio: `index.html`, `app.mjs`, `store.mjs`, `storage.mjs`, `ui.mjs`, `views/` (one file per tab), `renderers/` (views of a trace), `styles/`, `samples/`, `vendor/` (Preact and htm, unchanged), `dev/renderers.html` (every view on fixtures). |
| `bin/pmstack.mjs` | The CLI and the local studio server. Node 20, no dependencies. |
| `skills/pmstack-*/SKILL.md`, `commands/*.md` | The twelve skills and their slash command shims for the Claude Code plugin (`.claude-plugin/`). |
| `templates/tool-calls/` | Policy, intent map, and judge templates for tool call checks. |
| `scripts/build-visuals.mjs`, `scripts/check-samples.mjs` | Generators for `docs/assets/` and `docs/studio/samples/index.json`. |
| `docs/index.html`, `docs/eval-readiness/`, `docs/workspace/` | Landing page, quiz, and a redirect from the 1.x workspace URL. |
| `guides/` | User guides. `examples/quickstart/` is the README's quickstart folder, with a custom view. |
| `tests/lib`, `tests/cli`, `tests/repo.test.mjs`, `tests/e2e` | Engine, CLI, and repo tests (`node --test`); browser tests (Playwright). |
| `setup`, `install.sh` | Copy the skills and the runtime into a project or the home folder. |

## Commands

```sh
node --test                                   # every engine, CLI, and repo test; run from the repo root
node scripts/check-samples.mjs                # refresh sample splits and samples/index.json (--check writes nothing)
node scripts/build-visuals.mjs                # regenerate docs/assets/visuals (--check, --png, --screens)
node bin/pmstack.mjs studio examples/quickstart --port 0   # the studio in folder mode
cd tests/e2e && npm ci && npx playwright test # browser tests on the system Chrome
```

`--png` and `--screens` need `tests/e2e` installed. The web studio needs any static server over `docs/` (`tests/e2e/serve.mjs` serves port 4180). `node bin/pmstack.mjs <command> --help` documents each CLI command.

A change is done when `node --test` passes, both `--check` runs exit 0, and a change to the studio has been seen working in a real browser at desktop and 375 px widths, in light and dark, with no console errors.

## Numbers come from the engine

Every number shown for a sample (studio, report, visuals, README, landing page) is computed from `docs/studio/samples/*.json`, and `tests/lib/samples.test.mjs` pins them, including each number quoted in `README.md` and `docs/index.html`. After editing a sample or the engine's funnel, priority, label, or agreement math:

1. `node scripts/check-samples.mjs`
2. `node scripts/build-visuals.mjs` (and `--screens` when the studio looks different)
3. Update any quoted number the samples test reports, then `node --test`.

Reviewed counts use `reviewStats().reviewed` (Good plus Problem, including traces set aside as not a product problem). The funnel and the report count only product traces and say how many were set aside.

## Copy rules

`tests/repo.test.mjs` enforces the mechanical ones across the repo: no U+2014 dash (and no U+2013 used as a dash), no word from the banned word family (see the test for the pattern), no filler words in Markdown, plus skill names, shims, plugin paths, doc links, visual triples, Preact and htm conventions, and engine purity. Beyond the test:

- Write plain words for a reader with no context. Restructure a sentence with a comma, a colon, parentheses, or a full stop.
- Use the product's names verbatim: error discovery, failure modes, success modes, the funnel of an AI experience, Eval Studio.
- The studio shows plain labels only. The Help drawer's "Words we use" list (`WORDS` in `docs/studio/app.mjs`) maps each label to its course term; use its labels in UI text, SVG text, CLI help, and skills.
- Claim what the product does and stop. One "Sample data" badge on a sample is the only disclaimer.
- Run the voice linter on README, guides, skills, and the changelog: `"/Users/MacBookPro15/Desktop/AI Agents/Claude Code/voice/scripts/lint-copy.sh" <file>`, and fix every error.

## Contracts

Users' saved projects, custom views, and build scripts depend on these. Change them only on purpose, with tests and a changelog entry:

- File formats: `pmstack.project/1`, `pmstack.policy/1`, `pmstack.intents/1`, `pmstack.checks/1`, and the regression set lines. Every disk writer bumps `revision` through `withProjectLock` in `bin/pmstack.mjs`.
- Step ids (`m{i}`, `m{i}.c{k}`, `m{i}.r{k}`, `m{i}.t{k}`, `s{j}`, `out`) and stage ids: reviews point to them.
- The engine stays pure: no DOM, storage, network, `process`, or `node:` imports in `docs/studio/lib`. Mutators return a new project with structural sharing and set `updatedAt`.
- The renderer props (`trace`, `experience`, `showHidden`, `pickedStepId`, `onPickStep`, `highlights`, `stepBadges`, `retrieval`, `onRetrieval`, `compact`), `data-step-id` on every step element, and the `pmstack/ui` and `pmstack/renderers/common` import names that custom views use.
- The shell (`index.html`, `app.mjs`, `ui.mjs`, `store.mjs`, `storage.mjs`, `renderers/index.mjs`, `styles/tokens.css`, `styles/base.css`) owns routing, saving, and shared components. Views read the store through `useStore` and write through `updateProject`.
- CLI commands, flags, and exit codes (0 ok, 1 checks failed, 2 input problems). The version string lives in `bin/pmstack.mjs` (`VERSION`), `.claude-plugin/plugin.json`, the `app.mjs?v=` query in `docs/studio/index.html`, and `tests/e2e/package.json`; bump all four together.
- Never copy text, code, prompts, or pictures from `ai-evals-course/evals-skills` (it has no license). Adapt ideas in our own words, and credit MIT sources in the file header and `guides/credits.md`.

## Git

- Author and committer on every commit: `Ryan Alberts <25306145+RyanAlberts@users.noreply.github.com>`. Before the first commit in a session, check `git config user.email` and set it with `git config user.name "Ryan Alberts"` and `git config user.email 25306145+RyanAlberts@users.noreply.github.com` (local scope) if it differs.
- Push verified, committed work straight to `main`. Open a pull request only when asked.
- The 1.x PM commands and eval harness live at tag `v1.2.0`.
