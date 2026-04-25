# pmstack

**Claude Code config for AI product managers.** [Gstack](https://github.com/garrytan/gstack) is for engineers. This is for the PM sitting next to them.

## What is this?

A curated set of skills that turn Claude into an AI product management co-pilot. Ships in **two formats** — slash commands for Claude Code, and Anthropic Agent Skills for Claude.ai web/mobile/desktop/API.

### Commands

- `/competitive [market]` — Structured competitive analysis in 60 seconds
- `/compare [products...]` — Feature-by-feature comparison with built-in eval design
- `/prd [signal]` — Turn a customer quote into a PRD draft
- `/metrics [feature]` — Design a measurement framework for AI products
- `/brief [topic] [audience]` — Exec / eng / customer / board comms
- `/eval [feature]` — Design an evaluation suite for any AI feature
- `/run-eval [yaml]` — Execute an eval against a real target. Hard-stops on missing target — no fake results.
- `/sprint [signal]` — **NEW** — Full PM sprint orchestrator: `prd → metrics → eval → brief` with checkpoint approval at each step
- `/eval-self` — **NEW** — Score pmstack against its own self-eval suite, with regression alerting against the golden set

## Install (1 line)

```bash
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash
```

That installs into the current directory. To install elsewhere or globally:

```bash
# install into a specific project
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- /path/to/your-project

# install globally (every Claude Code session)
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- --global
```

The installer clones to a temp dir, runs `./setup`, and cleans up. **No `pmstack/` folder left behind.** Read it first if you'd like: [install.sh](./install.sh).

<details>
<summary>Manual install (clone-and-run)</summary>

```bash
git clone https://github.com/RyanAlberts/pmstack.git && cd pmstack && ./setup /path/to/your-project
```

Or copy `CLAUDE.md`, `skills/`, `templates/`, `bin/`, `docs/`, `.claude/commands/`, and `claude-skills/` into your target by hand.
</details>

## How do I get started today?

After install:

**1. Open Claude Code in the installed project.**

```bash
cd /path/to/your-project
claude
```

**2. Try the commands you'd actually use this week.**

```
/prd "Customers say onboarding takes 3 days"     # turn a quote into a spec
/competitive AI coding assistants                 # market positioning
/compare Cursor Windsurf                          # feature-by-feature
/metrics agent handoff success                    # measurement framework
/brief Q2 launch slipping exec                    # stakeholder comms
/eval Claude Ultraplan                            # design an eval suite
/run-eval outputs/eval-<feature>-<date>.yaml      # actually execute it
/sprint "Customers want pricing transparency"     # full PM sprint, gated
/eval-self                                        # score pmstack itself
```

Every command writes a markdown or YAML artifact to `outputs/` — you can paste into Notion, share a PR, or hand to a teammate.

**3. On Claude.ai web / mobile?** Upload the `claude-skills/<name>/` folders to a Claude.ai Project. Same brain, runs anywhere. See [claude-skills/README.md](./claude-skills/README.md).

**4. New to evals?** Read [docs/run-eval-setup.md](./docs/run-eval-setup.md) — learn-by-doing guide for `/run-eval`.

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