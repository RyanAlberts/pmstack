# pmstack

**Claude Code config for AI product managers.** [Gstack](https://github.com/garrytan/gstack) is for engineers. This is for the PM sitting next to them.

## What is this?

A curated set of skills that turn Claude into an AI product management co-pilot. Ships in **two formats** — slash commands for Claude Code, and Anthropic Agent Skills for Claude.ai web/mobile/desktop/API.

### Commands

- `/competitive [market]` — Structured competitive analysis in 60 seconds
- `/compare [products...]` — **NEW** — Feature-by-feature comparison with built-in eval design
- `/prd [signal]` — Turn a customer quote into a PRD draft
- `/metrics [feature]` — Design a measurement framework for AI products
- `/brief [topic] [audience]` — Exec / eng / customer / board comms
- `/eval [feature]` — Design an evaluation suite for any AI feature
- `/run-eval [yaml]` — **NEW** — Execute an eval against a real target. Hard-stops on missing target — no fake results.

## Install (30 seconds)

```bash
git clone https://github.com/RyanAlberts/pmstack.git
cd pmstack
./setup /path/to/your-project        # project-scoped install
# or
./setup --global                     # available in every Claude Code session
```

The installer copies `CLAUDE.md`, slash commands, Anthropic Skills, the runner script (`bin/run-eval.py`), templates, and docs.

After install, the commands work natively in Claude Code:

```
/eval Claude Ultraplan
/run-eval outputs/eval-claude-ultraplan-2026-04-24.yaml
/compare Cursor Windsurf
/prd "Customers say onboarding takes 3 days"
/brief Q2 launch exec
```

For Claude.ai web / mobile / desktop, upload the `claude-skills/<name>/` folders to a Claude.ai Project — same brain, runs anywhere. See [claude-skills/README.md](./claude-skills/README.md).

> **Manual install**: copy `CLAUDE.md`, `skills/`, `templates/`, `bin/`, `docs/`, `.claude/commands/`, and `claude-skills/` into your target.

## New in v0.4

**`/compare`** — feature-by-feature comparison across products. Three sequential phases (explore → define → execute) with one explicit confirmation gate. Differs from `/competitive` (market positioning) in that it produces a runnable eval suite for the comparison.

**`/run-eval`** — actually runs an eval YAML produced by `/eval`. Three target types: `claude-session`, `http`, `script`. **Hard-stops if no target is configured — never simulates results.** Outputs `summary.md`, per-case JSON, and `metrics.csv`. Token-based budgeting (no dollars — reproducible across price changes). New PMs: read [docs/run-eval-setup.md](./docs/run-eval-setup.md).

**Anthropic Agent Skills** — same pmstack capabilities, packaged as cross-platform Skills. Works in Claude.ai web / mobile / desktop, the API, and Claude Code. Same content as the slash commands, different distribution surface.

## Why skills, not a framework?

The most valuable layer in AI tooling isn't code — it's encoded judgment. These skills aren't templates. They're cognitive modes that guide Claude to think the way a senior PM thinks: start with the customer problem, define success metrics before building, and always ask "what would make us stop and investigate?"

Read [DECISIONS.md](./DECISIONS.md) for the full rationale behind every choice.

## Inspired by

- [Gstack](https://github.com/garrytan/gstack) by Garry Tan — proved that prompt engineering IS product engineering
- [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) by Andrej Karpathy — showed that the best AI tools are just well-structured markdown
- [gbrain](https://github.com/garrytan/gbrain) by Garry Tan — persistent memory for Claude Code projects

## Who is this for?

Product managers working on AI products who use Claude Code. If that's you, fork this and make it yours. The skills are designed to be customized — they're starting points, not gospel.

## What's next?

See [DECISIONS.md](./DECISIONS.md#what-id-add-next) for the roadmap. PRs welcome.

---

Built by [Ryan](https://github.com/RyanAlberts) — Staff PM working in Agentic AI. I write about AI product management and building with LLMs.