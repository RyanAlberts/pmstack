# Using pmstack outside Claude Code

Slash commands like `/prd` and `/eval` only work when you type them into Claude Code (the terminal app). If you live in a different AI tool, the underlying **skills** are still useful — they're just plain markdown instructions Claude (or any other capable LLM) can follow.

This guide tells you the simplest path for each common surface.

## Pick your tool

| If you mostly use… | Best path | Effort |
|---|---|---|
| Claude Code (terminal) | Slash commands work natively. See main [README](../README.md). | None |
| Claude.ai (web / mobile / desktop) | Upload as Anthropic Agent Skills — once. | 5 min |
| Cursor (agent mode / Composer) | Drop into `.cursorrules` or paste into Composer. | 2 min |
| ChatGPT | Custom GPT or paste into a project's instructions. | 5 min |
| Gemini | Save as a Gem instruction or paste into a Gem. | 5 min |
| Anything else (open-source LLMs, internal AI) | The skills are markdown — paste into your system prompt. | 1 min |

---

## Claude.ai (web / mobile / desktop)

The most convenient if you want pmstack on your phone or in the browser. Anthropic's Agent Skills are the official cross-platform format and they auto-trigger when you ask Claude something a skill is relevant for.

**One-time setup** (~5 min):

1. Open Claude.ai (Pro/Max/Team/Enterprise required for Skills).
2. Go to a Project (or create one — call it "PM toolkit").
3. **Settings** → **Skills** → **Upload skill**.
4. Zip and upload the folder `claude-skills/pmstack-prd/` (or any other you want).
5. Repeat for as many of the **14 skills** as you want — the original nine (`pmstack-prd`, `pmstack-eval`, `pmstack-compare`, `pmstack-brief`, `pmstack-metrics`, `pmstack-competitive`, `pmstack-run-eval`, `pmstack-sprint`, `pmstack-eval-self`) plus the **five default routines** (`pmstack-eval-drift`, `pmstack-premortem`, `pmstack-weekly`, `pmstack-launch-readiness`, `pmstack-lint`) and the **interactive tutorial** (`pmstack-onboarding`).

**Recommended starter set** (4 skills, covers 80% of PM work): `pmstack-prd`, `pmstack-premortem`, `pmstack-weekly`, `pmstack-onboarding`. Upload these four, ask Claude "walk me through pmstack," and the onboarding tutorial does the rest.

**Now what?** Just chat with Claude in that Project. When you say "I have a customer quote, write a PRD," it'll auto-invoke `pmstack-prd`. No slash commands needed.

Full deep-dive: [claude-skills/README.md](../claude-skills/README.md).

> **Note:** Skills on Claude.ai web don't write files — there's no filesystem. The artifact appears inline in the conversation. Copy-paste it where you need it.

---

## Cursor (agent mode / Composer)

Cursor doesn't have an "official" skills system, but its `.cursorrules` file is loaded into context for every chat in a project. That's where you put pmstack.

**One-time setup** (~2 min):

```bash
# in your Cursor project root:
mkdir -p .cursor/rules
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/skills/prd-from-signal.md \
  > .cursor/rules/pmstack-prd.md
```

Or just clone pmstack and copy whichever skill files you want into `.cursor/rules/`. Cursor will pick them up automatically.

**Now what?** In Composer / agent chat, ask Claude (Cursor uses Claude under the hood by default):

> "I have a customer quote: 'three of our biggest customers said onboarding feels like a full day project.' Write a PRD using the pmstack-prd skill."

The agent reads the skill instructions from `.cursor/rules/` and applies them.

> **Tip:** if Cursor's rules are getting crowded, only add the 1–2 skills you use most often. The skill files are short (under 50 lines each), but every rules file adds to context per turn.

---

## ChatGPT

Two options:

**Option 1: Custom GPT** (best if you'll use it often)

1. ChatGPT → Explore GPTs → Create.
2. In Instructions, paste the contents of any pmstack skill (e.g., `skills/prd-from-signal.md`).
3. Save. Now you have a "PM PRD assistant" GPT.

**Option 2: Project instructions** (faster, less reusable)

1. Create a Project in ChatGPT.
2. Project instructions → paste the skill markdown.
3. Chat in that project.

---

## Gemini

**Gems** are Google's equivalent of Custom GPTs — same idea:

1. gemini.google.com → Gems → Create a Gem.
2. Instructions → paste the contents of `skills/<name>.md`.
3. Save. Use the Gem when you want that PM mode.

---

## Anything else (open-source LLMs, your internal AI, agents, etc.)

The skills in `skills/*.md` are just markdown. They contain plain-English instructions a competent LLM can follow. You can:

- Paste a skill into the system prompt of any LLM API call
- Use them as reference templates even without an LLM (read `skills/agent-eval-design.md` for "how to design an eval")
- Adapt the instructions for your team's house style and check the modified version into your repo

The format is intentionally simple — no DSL, no framework, no compile step. If your AI tool can read markdown instructions, it can run pmstack skills.

---

## What you can't do without Claude Code

A few capabilities only work in Claude Code (terminal):

- **`/run-eval`** — needs Python + the `claude` CLI to actually execute eval suites against a real target.
- **`/eval-self`** — runs the pmstack self-eval suite (Python script).
- **`/eval-drift`** — wraps `/eval-self` and `/run-eval`; needs the same toolchain.

Everything else — including the other four default routines (`/premortem`, `/weekly`, `/launch-readiness`, `/lint`) and the `/onboarding` tutorial — works fine in claude.ai web/desktop/mobile after you've uploaded the skills.

Workaround for the eval-running ones: read the eval YAML inline in any tool, then run the eval locally on your laptop when you need real scores.

---

## Stuck?

- Browse [example outputs](../examples/README.md) to see what each skill produces, regardless of which tool runs it.
- Check the main [README](../README.md) for the full command list and install paths.
- Open an issue on [github.com/RyanAlberts/pmstack](https://github.com/RyanAlberts/pmstack/issues) — "doesn't work in <my tool>" is a useful bug report.
