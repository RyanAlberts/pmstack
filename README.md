# pmstack

**A PM toolkit that runs inside Claude.** Turn customer signals into PRDs, run pre-mortems, gate launches, watch your AI feature for drift, and write the Monday memo — all from one consistent set of commands you type into Claude (terminal, browser, desktop, or mobile).

**Brand new?** → `/onboarding` walks you through every capability with a runnable example. Skip the rest of this README until you've done it once.

---

## Who this is for

Two audiences. Both welcome.

**Technical PM** — you live in a terminal. You want one consistent muscle memory across every PM artifact you produce. You install pmstack as slash commands inside Claude Code.

**Non-technical PM** — you do PM work in claude.ai web, the desktop app, or on your phone. You want the same toolkit without ever opening a terminal. You install pmstack as Anthropic Skills inside your Claude account. Same skills, same outputs, no terminal.

This saves you 5–15 minutes per artifact and stops you from staring at a blank page. If you're a senior PM with your own templates, fork this and replace the prompts with your house style.

---

## What you get

Fourteen capabilities. Nine "skills" that produce a single artifact each, plus five "routines" that run on demand or on a schedule. Every output is a real markdown or YAML file (or, on web/desktop, an inline markdown block) you can paste into Notion or hand to a teammate.

| Command template | What it answers | What you get | Where it runs |
|---|---|---|---|
| `/prd "<a customer signal>"` | "Customer said X. What's the spec?" | A 6-section PRD draft → [example](./examples/walkthrough-code-review/prd-code-review-2026-05-05.md) | CLI · web · desktop · mobile |
| `/competitive "<market>"` | "Who else is in this space and where's the white space?" | Landscape with positioning + white-space analysis → [example](./examples/walkthrough-code-review/competitive-ai-code-review-2026-05-05.md) | CLI · web · desktop · mobile |
| `/compare "<product A>" "<product B>" [...]` | "Which of these should we pick — and how would we test it?" | Feature matrix + decision rules + executable eval YAML → [example](./examples/walkthrough-compare-tools/) | CLI · web · desktop · mobile |
| `/metrics "<feature>"` | "How will we know this worked?" | North Star + 2–3 supporting + 1–2 counter-metrics → [example](./examples/walkthrough-code-review/metrics-code-review-2026-05-06.md) | CLI · web · desktop · mobile |
| `/eval "<AI feature>"` | "What does 'good' actually look like for this AI feature?" | A test-suite YAML (capabilities, failure modes, metrics, test cases) → [example](./examples/walkthrough-code-review/eval-code-review-2026-05-06.yaml) | CLI · web · desktop · mobile |
| `/run-eval <eval-yaml-path>` | "Does this AI feature actually pass the bar?" | A scored summary.md with pass-rates, top failures, cost → [example](./examples/walkthrough-code-review/eval-runs/code-review-eval-2026-05-06/summary.md) | CLI only (needs a real target) |
| `/brief "<topic>" <audience>` | "What does the exec / eng team / customer need to know?" | A one-page audience-sized brief → [example](./examples/walkthrough-code-review/brief-code-review-exec-2026-05-09.md) | CLI · web · desktop · mobile |
| `/sprint "<a customer signal>"` | "Take this from signal to ship-ready in one pass." | Four artifacts in sequence — PRD → metrics → eval → brief — with confirmation gates | CLI · web · desktop |
| `/eval-self [--skill <name>]` | "Is pmstack itself still good?" | Scores every pmstack skill against canonical scenarios | CLI only |
| `/premortem <prd-slug>` | "How could this feature fail?" | 3 failure stories + leading indicators + mitigations → [example](./examples/walkthrough-code-review/premortem-code-review-2026-05-05.md) | CLI · web · desktop · mobile |
| `/launch-readiness <feature>` | "Are we actually ready to ship this?" | GO / NO-GO / CONDITIONAL verdict + 7-item evidence checklist → [example](./examples/walkthrough-code-review/launch-readiness-code-review-2026-05-09.md) | CLI · web · desktop · mobile |
| `/lint` | "Did anything in my workspace drift out of sync?" | Graph gaps + cross-artifact drift + stale candidates with 'Do this:' actions → [example](./examples/walkthrough-code-review/lint-2026-05-08.md) | CLI · web · desktop |
| `/weekly` | "What changed in my thinking this week?" | Decisions made + open loops aging + one required 'changed my mind' field → [example](./examples/walkthrough-code-review/weekly-2026-W19.md) | CLI · web · desktop |
| `/eval-drift` | "Did my AI feature get worse this week?" | Drift memo with `RELEASE_BLOCKED: true\|false` flag → [example](./examples/walkthrough-code-review/eval-drift-2026-05-12.md) | CLI only (needs real eval runs) |
| `/onboarding` | "I just installed this. What do I do?" | A 7-step interactive tutorial running every capability above | CLI · web · desktop |

**Don't worry about understanding all of them.** Run `/onboarding` once. It walks you through every command above with a real signal and produces a complete artifact set you can compare to the bundled examples.

### Prefer to browse first?

- [examples/walkthrough-code-review/](./examples/walkthrough-code-review/) — the full set of artifacts a PM produced over a realistic week working on an "AI code review" feature. Twelve files, all referencing each other.
- [examples/walkthrough-compare-tools/](./examples/walkthrough-compare-tools/) — what `/compare` produces (Cursor vs Windsurf).
- [examples/inputs/README.md](./examples/inputs/README.md) — every command's example input, copy-pasteable.

---

## The five default routines (added v0.5)

Five routines that compose existing pmstack skills into recurring patterns. Run any of them as a one-shot slash command, or schedule on a weekly loop:

```bash
# One-shot — type any of these in Claude
/weekly
/lint
/eval-drift

# Schedule — Claude Code's /loop skill runs them on a cadence
/loop 7d /weekly
/loop 7d /lint
/loop 7d /eval-drift
```

The five:

- **`/eval-drift`** — "Did my AI feature get worse this week?" Re-runs your eval suite, diffs against the prior baseline, hard-stops releases on regression. Designed to run on a `/loop 7d` cron.
- **`/premortem`** — "How could this feature fail?" Runs Klein's pre-mortem trick on a draft PRD: 3 failure stories from 6 months in the future, with leading indicators and mitigations. The only routine that mutates an existing artifact (the PRD's Risks section).
- **`/weekly`** — "What changed in my thinking?" Three sections only — decisions made, open loops aging, and one required "thing I changed my mind about." Anti-vanity by design.
- **`/launch-readiness`** — "Are we ready to ship?" Verifier-not-generator. Aggregates PRD/metrics/eval/run/premortem/eval-drift/brief evidence into GO / NO-GO / CONDITIONAL with each item showing pass/fail/missing + the file that proves it. Ship-anyway path is logged permanently.
- **`/lint`** — "Is my workspace tidy?" Walks the artifact graph, finds gaps, drift, and stale files. Each finding has a one-line 'Do this:' action.

Each routine produces a durable artifact in `outputs/` and appends one line to `decisions-log.md`. See [outputs/](./outputs/) and the example walkthrough for what they look like in practice.

---

## Install

### Path 1: Claude Code CLI (technical PMs)

```bash
# Install into the current folder
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash

# Install into a specific folder
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- ~/work/my-pm-stuff

# Install GLOBALLY (recommended) — works in any folder you open Claude Code in
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- --global
```

The global install puts the skills at `~/.claude/commands/` and `~/.claude/skills/` so you can run `/prd`, `/eval`, `/weekly` from any folder — including your team's repos. **This is the recommended path for PMs who jump between projects.**

<details>
<summary>Manual install (if you prefer to clone and inspect first)</summary>

```bash
git clone https://github.com/RyanAlberts/pmstack.git
cd pmstack
./setup ~/work/my-pm-stuff      # local install
./setup --global                 # global install
```

</details>

### Path 2: claude.ai web / desktop / mobile (non-technical PMs)

If you don't use a terminal, install pmstack as **Anthropic Skills** in your Claude account. Same capabilities. No CLI.

**One-time setup (~5 min):**

1. Open claude.ai → **Projects** → create a Project called "PM toolkit" (or use an existing one).
2. **Project settings → Skills → Upload skill.**
3. Upload each folder from this repo's [`claude-skills/`](./claude-skills/) directory: `pmstack-prd`, `pmstack-eval`, `pmstack-premortem`, etc. Upload all 14 (it takes ~3 minutes total) or pick the 4–5 you'll use most.
4. Done. From the desktop app, mobile, or web, just chat normally — when you say "I have a customer quote, write a PRD," the skill auto-activates.

> Skills on claude.ai don't write files (no filesystem). The artifact appears inline in the conversation. Copy-paste it where you need it. The artifact is identical to what you'd get from the CLI.

**Other tools** (Cursor, Codex, ChatGPT, Gemini, anything else): see [docs/using-other-tools.md](./docs/using-other-tools.md). The skills are markdown — paste into a `.cursorrules`, a Custom GPT, or a system prompt.

---

## What it looks like (claude.ai web — non-technical path)

Conceptual mockup of a fresh claude.ai conversation after the user has uploaded the pmstack skills:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Project: PM toolkit                                                  │
│ Skills: pmstack-prd, pmstack-premortem, pmstack-launch-readiness,    │
│         pmstack-weekly, pmstack-onboarding, ... (14 total)           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  You:    I just installed pmstack. Walk me through it.               │
│                                                                      │
│  Claude: [auto-activates pmstack-onboarding skill]                   │
│          Welcome to pmstack. We'll walk through 7 steps using a      │
│          realistic AI code review feature. Type 'next' to start      │
│          with /prd.                                                  │
│                                                                      │
│  You:    next                                                        │
│                                                                      │
│  Claude: Step 2 of 7 — /prd                                          │
│          /prd takes a customer signal and writes a PRD draft. ...    │
│          [shows the example signal, the command, the expected        │
│          output, and a link to the bundled example artifact]         │
│                                                                      │
│  You:    [pastes a real customer quote from their team]              │
│          /prd "Half our trial users churn before they finish setup." │
│                                                                      │
│  Claude: [auto-activates pmstack-prd skill]                          │
│          # PRD: Trial setup friction — 2026-05-05                    │
│          ## Problem Statement ...                                    │
│          [full 6-section PRD inline]                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

That's the entire UX. No terminal, no install path, no slash commands to memorize. The skills auto-activate on natural-language phrasing the user is already using.

---

## Get started in 60 seconds

If you installed the CLI:

```bash
cd ~/work/my-pm-stuff      # or wherever you installed
claude                       # opens Claude Code
```

Then type:

```
/onboarding
```

That's it. The tutorial does the rest.

If you installed via claude.ai, just open the Project you set up and ask: *"walk me through pmstack."*

---

## What's an eval? (the one piece of jargon you'll see a lot)

An **eval** is a test suite for an AI feature. You define inputs ("what a real user might say") and what good looks like, then run them through your AI system and score the results. It's how you know whether the latest model change made things better or worse.

Three pmstack commands handle this:

- **`/eval`** — Designs the test suite. Output: a YAML describing what to test and how to grade it.
- **`/run-eval`** — Actually runs the test suite against a real AI system and writes a scored report.
- **`/eval-drift`** — Re-runs the suite weekly, compares to last week, and flags any regression as a release blocker.

Most PMs ship AI features without evals because designing one feels intimidating. `/eval` makes the design 80% done in 60 seconds. **`/run-eval` will hard-stop if you haven't told it what AI system to test against — it never invents fake scores.**

A walk-through for your first eval: [docs/run-eval-setup.md](./docs/run-eval-setup.md).

---

## Common questions

**Do I need to know how Claude works internally?**
No. You should know what an LLM is and roughly that they have limits, but pmstack hides everything else.

**Does this cost money?**
The commands themselves are free. The Claude tokens used to run them count against your Claude subscription (Pro/Max/Team) or API key. A typical PRD or competitive analysis is well under a penny. The `/run-eval` and `/eval-self` commands can use more tokens — they tell you the estimate before each run and ask before spending.

**What if I want to change how a command behaves?**
Open the file in `skills/<name>.md` (e.g., `skills/prd-from-signal.md`) and edit. The skill is just markdown — Claude reads it as instructions. Save and re-run; your changes apply immediately.

**Is my data sent anywhere unusual?**
No. Everything runs through your existing Claude account. pmstack adds no servers, no telemetry, no third parties. The skills are just markdown files on your disk (or, on claude.ai, files Anthropic stores in your Project).

**Can I use pmstack on a project that isn't pmstack itself?**
Yes — that's the point. Install with `--global` (CLI) or upload the skills to a Project (claude.ai) once, and the commands are available wherever you do PM work.

**The five new routines look like a lot. Where do I start?**
Run `/onboarding`. It walks you through every routine with the bundled walkthrough. After that, the highest-leverage starting routine is `/premortem` — runs in 60 seconds against any PRD, mutates the Risks section, and the lift on launch-decision quality is the largest in the set.

---

## Want to contribute, fork, or learn how it's built?

- [DECISIONS.md](./DECISIONS.md) — every design choice and why
- [docs/using-other-tools.md](./docs/using-other-tools.md) — how to use pmstack outside Claude Code
- [skills/_graph.yaml](./skills/_graph.yaml) — the canonical skill graph
- [outputs/pmstack-roadmap-2026-04-24.md](./outputs/pmstack-roadmap-2026-04-24.md) — what's coming next
- Inspired by [Gstack](https://github.com/garrytan/gstack) and [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

---

Built by [Ryan Alberts](https://github.com/RyanAlberts) — Staff PM in Agentic AI. PRs and forks welcome.
