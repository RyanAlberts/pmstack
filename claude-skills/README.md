# pmstack — Claude Agent Skills

These are the same pmstack capabilities as the `.claude/commands/` slash commands, but packaged as **Anthropic Agent Skills** so they work cross-platform: Claude.ai web, mobile, desktop, API, and Claude Code.

## Why two formats?

| Format | Where it works | How it triggers |
|---|---|---|
| `.claude/commands/*.md` | Claude Code CLI / IDE only | Type `/eval`, `/prd`, etc. |
| `claude-skills/*/SKILL.md` (this dir) | Claude.ai web + mobile + desktop, API, Claude Agent SDK, Claude Code | Auto-loads when description matches user intent |

If you only use Claude Code, the slash commands are friendlier (you control when they fire). If you use Claude.ai on the web or mobile and want the same PM brain on the go, install these Skills instead — or in addition.

## How to install

### In Claude.ai (web / mobile / desktop)

1. Go to a Claude.ai Project (Pro/Max/Team/Enterprise).
2. Settings → Skills → Upload skill.
3. Zip the folder you want (e.g., `claude-skills/pmstack-eval/`) and upload. The platform reads `SKILL.md` and registers it.
4. Repeat for each pmstack skill you want.

(If Claude.ai's UI evolves and the upload step changes, the [Anthropic docs](https://www.anthropic.com/news/skills) are the source of truth.)

### In Claude Code (global, all sessions)

```bash
./setup --global
```

The setup script installs both formats:
- `.claude/commands/` → slash commands at `~/.claude/commands/`
- `claude-skills/` → Anthropic Skills at `~/.claude/skills/`

Both work in Claude Code. Slash commands fire on `/name`. Skills fire on intent match (the model reads the `description:` and decides whether your message warrants the skill).

### Via the API or Claude Agent SDK

Pass each skill's folder to the Skills system per the SDK's docs. Same `SKILL.md` files; same behavior.

## What's in here

- `pmstack-eval/` — Design an eval suite for an AI feature
- `pmstack-prd/` — Turn a customer signal into a PRD draft
- `pmstack-competitive/` — Market positioning analysis
- `pmstack-metrics/` — Design a measurement framework
- `pmstack-brief/` — Stakeholder brief tailored to audience
- `pmstack-compare/` — Feature-by-feature comparison across products
- `pmstack-run-eval/` — Execute an eval YAML against a real target

## Limitations on web / mobile

- Skills run with whatever tools Claude has on that surface. Claude.ai web/mobile **does not have a local filesystem** — so skills that "write to `outputs/`" instead produce the artifact inline in the conversation. You can copy/paste it.
- `pmstack-run-eval` requires a runtime that can execute `bin/run-eval.py` (Python + the `claude` CLI). On Claude.ai web, that means running it in a sandbox/code-execution context, OR you run it locally yourself after producing the eval YAML. The Skill walks the user through the local path when sandboxed execution isn't available.
