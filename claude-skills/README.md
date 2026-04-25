# pmstack — Claude Agent Skills (cross-platform)

This folder contains the same pmstack capabilities as the slash commands in `.claude/commands/`, but packaged as **Anthropic Agent Skills** — Anthropic's official portable skill format. They work on Claude.ai (web / mobile / desktop), the API, the Agent SDK, and Claude Code.

For non-Claude tools (Cursor, ChatGPT, Gemini, etc.), see [docs/using-other-tools.md](../docs/using-other-tools.md) instead.

## Two formats — what's the difference?

| | `.claude/commands/` (slash commands) | `claude-skills/` (this folder) |
|---|---|---|
| **Where it works** | Claude Code (terminal) only | Claude.ai web/mobile/desktop, API, SDK, Claude Code |
| **How you trigger it** | You type `/eval`, `/prd`, etc. | Auto-fires when you ask Claude something a skill is relevant for |
| **Best for** | Power users in a terminal | PMs on the go, or who don't live in a terminal |

Run both if you want — they don't conflict.

## Install for Claude.ai (web / mobile / desktop)

**Requirements:** A Claude.ai paid plan (Pro / Max / Team / Enterprise — Skills aren't on the free tier).

1. Open **claude.ai** in your browser. Sign in.
2. Create a Project (or use an existing one). Call it "PM toolkit" or whatever fits.
3. In the Project: **Settings** → **Skills** → **Upload skill**.
4. Zip the skill folder you want and upload it. For example:
   ```bash
   cd claude-skills
   zip -r pmstack-prd.zip pmstack-prd/    # then upload pmstack-prd.zip
   ```
5. Repeat for each skill you want available. Recommended starter set: `pmstack-prd`, `pmstack-competitive`, `pmstack-eval`, `pmstack-brief`.

**Now what?** Just chat with Claude in that Project. When you say something like "I have a customer quote, write a PRD," the matching skill auto-loads. No slash commands to remember.

## Install for Claude Code (terminal)

If you ran `./setup --global` (or the 1-line installer with `--global`), these skills are already at `~/.claude/skills/` and Claude Code reads them automatically. Nothing else to do.

If you ran a project-scoped install, they're at `<your-project>/.claude/skills/`.

## Install via the API or Claude Agent SDK

Pass each skill folder to the Skills system per the [SDK docs](https://www.anthropic.com/news/skills). Same `SKILL.md` files; same behavior.

## What's in here

| Folder | What it does |
|---|---|
| `pmstack-prd/` | Turn a customer quote into a PRD draft |
| `pmstack-competitive/` | Market positioning + white-space analysis |
| `pmstack-compare/` | Feature-by-feature comparison across products |
| `pmstack-metrics/` | A measurement framework: North Star + supporting + counter-metrics |
| `pmstack-brief/` | Stakeholder brief sized for exec / eng / customer / board |
| `pmstack-eval/` | Test suite design for an AI feature |
| `pmstack-run-eval/` | Execute an eval YAML against a real target system |
| `pmstack-sprint/` | Chains PRD → Metrics → Eval → Brief with confirmation gates |
| `pmstack-eval-self/` | Scores pmstack against its own quality bar |

## Things to know about Claude.ai web/mobile

- **No filesystem.** Skills that normally "write to `outputs/`" emit the artifact inline in the chat. Copy/paste it where you need it.
- **`pmstack-run-eval` is limited.** It needs Python + the `claude` CLI to actually execute. On Claude.ai web that requires the sandbox / code-execution feature. If unavailable, the skill walks you through running it locally on your laptop with the eval YAML it produced.
- **Skills auto-trigger on intent.** No slash commands. Saying "draft a brief for the exec team about our launch slip" should auto-fire `pmstack-brief`.
