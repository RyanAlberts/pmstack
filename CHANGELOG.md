# Changelog

## 2.0.0 (2026-09-24)

pmstack 2.0 is rebuilt around error discovery, the method Hamel Husain and Shreya Shankar teach: read real traces, name the failure modes, and turn the ones that matter into checks you can trust. Everything from 1.x is kept at the `v1.2.0` tag.

### New

- **Eval Studio**, a web app with six tabs: Set up, Review traces, Failure modes, Funnel, Checks, and Report. It runs [on the web](https://ryanalberts.github.io/pmstack/studio/) with your work saved in your browser, or on your computer with `node bin/pmstack.mjs studio <folder>`, saving plain files next to your traces.
- **Review traces** the way your customer saw them: text messages, web chat, phone calls, emails, documents, answers with sources, agent steps, code reviews, form fields, ranked lists, panels you choose, or your own custom view. Keyboard review (1 Good, 2 Problem, 3 Not sure yet), notes first, the first thing that went wrong, sets of 20 picked across your details, and a signal for when new failure modes stop appearing.
- **Failure modes and success modes**, grouped from your notes, with re-checks for traces reviewed before a failure mode existed.
- **The funnel of an AI experience**: each failing trace counted once at the first stage that went wrong, success modes per stage, the check for each failure mode, and a "What to fix first" table ranked by traces times severity, with a decision for each (fix it now, build a check, keep watching).
- **Checks**: code checks with 14 kinds of tests, AI judges written from your failure modes, labels, examples, tuning set, and final test, agreement shown as two numbers (catches real failures, agrees on good traces), and the likely true failure rate with a 95% range.
- **Tool call checks** for agents that use tools: policy (is this call allowed?), relevance (is it the right call for what the customer asked?), and output grounding (does the reply match what the tool returned?). Policy files with 13 rule types, intent maps, two grounding code checks, two judge templates, an enterprise requirements checklist, and a guardrail your service can call before a tool runs.
- **AI help** that waits for your judgment: suggestions after 10 reviewed traces and grouping after 30, through a prompt you paste into an approved assistant, or through Claude Code watching your folder.
- **Report**: a one-page summary, the funnel picture, a before and after table per version, the regression set, and the checks your engineers run on every change.
- **Six sample products** with realistic traces: a dental booking assistant (reviewed, labeled, and checked), an outreach email writer, a policy answer bot, a gift finder, a pull request reviewer, and an internet provider's support agent.
- **Twelve skills** for Claude Code and any agent that reads skills: start, error-discovery, synthetic-traces, write-judge, validate-judge, evaluate-rag, custom-view, eval-audit, regression-checks, tool-policy, tool-relevance, and tool-grounding, each with a `/pmstack:` slash command.
- **Command line** (`bin/pmstack.mjs`, Node 20, no dependencies): studio, import, validate, check, judge, agreement, estimate, policy, retrieval, report, regression-set, and checks.
- **Guides** for the method, trace formats, product setup, checks and judges, tool call checks, agent patterns, and the command line.
- **Visuals** generated from the samples' real numbers, in light and dark; a new landing page; and the eval readiness quiz rewritten around the method.

### Retired

Each of these is still available at the [`v1.2.0` tag](https://github.com/RyanAlberts/pmstack/tree/v1.2.0).

| Retired | Where it went |
|---|---|
| PM commands: `/prd`, `/metrics`, `/brief`, `/competitive`, `/compare`, `/voc`, `/sprint`, `/weekly`, `/premortem`, `/launch-readiness`, `/lint`, `/onboarding`, `/transcript-review`, `/vibe-test` | Tag `v1.2.0` only. pmstack 2.0 focuses on evals. |
| Eval commands: `/eval`, `/run-eval`, `/eval-grade`, `/eval-report`, `/eval-drift`, `/eval-self` | Replaced by error discovery, the Checks tab, `pmstack judge`, and `pmstack check`. `/pmstack:eval-audit` reviews an existing eval setup. |
| YAML eval templates and the Python runners (`bin/run-eval.py`, `bin/eval-report.py`) | Replaced by the project file and `bin/pmstack.mjs`. |
| The JSON evaluation harness (`bin/eval-harness.mjs`, `examples/eval-adapters/`) | Replaced by `pmstack judge` with your own model command, and regression sets replayed in your build. |
| The evaluation workspace (`docs/workspace/`) | Replaced by Eval Studio. The old address redirects to it. |
| `bin/work-review.mjs` | Tag `v1.2.0` only. |
| `claude-skills/`, `plugin-commands/`, `.claude/commands/` | `skills/` and `commands/`. |
| Framework documents in `docs/*.md` | `guides/`. |
| `evals/` self-evaluation suite | `tests/` (`node --test`). |
| `outputs/`, walkthrough examples, and `templates/prd-template.md` | Tag `v1.2.0` only. |

### Changed

- `setup` copies the skills to `.claude/skills/` and the command-line tool with Eval Studio to `.pmstack/`, in a project or in your home folder with `--global`. It no longer writes a `CLAUDE.md` into your project.
- The plugin is version 2.0.0. Commands are `/pmstack:start`, `/pmstack:error-discovery`, and the ten others listed in the README.
