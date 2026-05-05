# pmstack

**A PM toolkit that runs inside the browser, desktop, or mobile Claude app, as well as the terminal.** I built it to give Product Managers a path to AI fluency...irrespective of your technical fluency today. Learn by building. Part learning playground, part tactical skillset. All-in-one.

Turn customer signals into outcomes like I do @AWS - delegate your work to AI agents as Routines or run commands on demand: run evals like an ML engineer. Schedule pre-mortems, stress-test launches, monitor your AI feature for drift, and write the Monday memo — all from one consistent set of commands you type into Claude (terminal, browser, desktop, or mobile).

**Brand new?** → `/onboarding` walks you through every capability with a runnable example. Skip the rest of this README until you've done it once.

If you find this repo useful, star it and help me make it better!

---

## Who this is for
There are two Personas. Neither is presumed to be AI-pilled. 

**Technical PM** — you live in a terminal. You want one consistent muscle memory across every PM artifact you produce. You install pmstack as slash commands inside Claude Code.

**Non-technical PM** — you do PM work in claude.ai web, the desktop app, or on your phone. You want the same toolkit without ever opening a terminal. You install pmstack as Anthropic Skills inside your Claude account. Same skills, same outputs, no terminal.

---

## Install

### Path 1: claude.ai web, desktop, or mobile (non-technical PMs)

**~30 seconds. No terminal.**

1. claude.ai → **Projects** → new Project ("PM toolkit").
2. **Settings → Skills → Upload skill** → upload each folder from [`claude-skills/`](./claude-skills/). All 14, or pick the 4–5 you'll use most.
3. Chat normally. "Write a PRD from this customer quote" auto-activates the skill; output appears inline — copy-paste anywhere.

### Path 2: Claude Code CLI (technical PMs)

```bash
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- --global
```

Installs to `~/.claude/` so `/prd`, `/eval`, `/weekly` work in any folder. Drop `--global` to install in the current folder only.

<details>
<summary>Manual install / other tools (Cursor, ChatGPT, Gemini, …)</summary>

```bash
git clone https://github.com/RyanAlberts/pmstack.git && cd pmstack
./setup --global    # or: ./setup ~/work/my-pm-stuff
```

For non-Claude tools, see [docs/using-other-tools.md](./docs/using-other-tools.md) — the skills are plain markdown, paste them into `.cursorrules`, a Custom GPT, or a system prompt.

</details>

---

## Start here

If you just installed pmstack, run this once. It's the only command you need to remember.

| Command template | What it answers | What you get | Where it runs |
|---|---|---|---|
| `/onboarding` | "I just installed pmstack. Where do I start?" | A 9-step interactive tutorial running every capability in this README with examples so you can see what good looks like | CLI · web · desktop |

### Prefer to browse first?

- [examples/walkthrough-code-review/](./examples/walkthrough-code-review/) — the full set of artifacts a PM produced over a realistic week working on an "AI code review" feature. Twelve files, all referencing each other.
- [examples/walkthrough-compare-tools/](./examples/walkthrough-compare-tools/) — what `/compare` produces (Cursor vs Windsurf).
- [examples/inputs/README.md](./examples/inputs/README.md) — every command's example input, copy-pasteable.

---

## What's an eval? 

An **eval** is the test suite for an AI feature - it's how we evaluate non-deterministic systems like LLMs, agents, and agentic systems. You define inputs ("what a real user might say") and what success looks like, then run these inputs through your AI system and score the results. This repo abstracts the measurement appartus in the same way that you depend on your engineering team to write unit and integration tests in traditional software development. 

[From Anthropic] "An evaluation (“eval”) is a test for an AI system: give an AI an input, then apply grading logic to its output to measure success." 

<p align="center">
  <img src="docs/eval-diagram.png" alt="Diagram of an evaluation pipeline: input → AI system → grading logic → score. Adapted from Anthropic's 'Demystifying Evals for AI Agents.'" width="800">
</p>

<p align="center">
  <sub>
    <em>Image taken from Anthropic — <a href="https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents"><strong>Demystifying Evals for AI Agents</strong></a> (Anthropic Engineering, 2025). Used with attribution; original copyright Anthropic, PBC. Read the full article for the canonical guidance pmstack draws on.</em>
  </sub>
</p>

**Fluency in evals separates an AI PM from a traditional PM.** Traditional PMs ship a feature, instrument a dashboard, and read the launch metric. AI PMs do all of that *and* maintain a structured measurement of how the model itself behaves — because LLM outputs are non-deterministic, drift between model versions, and fail in ways feature flags can't catch.

**pmstack implements [Anthropic's eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) as PM-runnable commands.** The Anthropic article is the canonical reference; you don't have to read it cover-to-cover before shipping. pmstack is the operating layer that produces its artifacts — task suites, transcripts, graders, drift watches — without writing engineering scaffolding. Five commands cover the lifecycle in flow order:

- **`/vibe-test`** — Read raw transcripts of your AI feature in action; surface failure patterns and draft task candidates *before* you formalize a test suite. (Anthropic's "start with manual testing" ritual.)
- **`/eval`** — Design the suite. Output: a YAML with tasks, metrics, graders (`code` / `model` / `human`), and pass-bars.
- **`/run-eval`** — Execute the suite against a real AI system; report **pass@k** AND **pass^k**. Hard-stops if no target is configured — never invents fake scores.
- **`/transcript-review`** — Walk every failed trial asking the diagnostic question: *model mistake, grader mistake, or task-spec error?* (Anthropic's "read the transcripts" ritual.)
- **`/eval-drift`** — Re-run the suite weekly, diff against last week, flag any regression as a release blocker.

First-time setup: [docs/run-eval-setup.md](./docs/run-eval-setup.md). How pmstack maps to Anthropic's 8-step roadmap: [docs/anthropic-framework.md](./docs/anthropic-framework.md).

---

## What you get

A growing set of capabilities, each packaging a task to delegate to AI. The logical flow is Spec creation → Measurement → Communicate & orchestrate, with Routines giving you the operating discipline. Each command produces a real markdown or YAML artifact (or, on web/desktop, an inline block you can copy).

**Don't try to memorize them all.** Run `/onboarding` once — it walks the whole stack with a real signal and produces a complete artifact set you can compare to the bundled examples.

&nbsp;

### Spec creation — Signal to shippable

Translate the noise of customer signals, competitor moves, and market gaps into structured artifacts engineering can plan from.

| Command template | What it answers | What you get | Where it runs |
|---|---|---|---|
| `/prd "<a customer signal>"` | "Customer said X. What's the spec?" | A 6-section PRD draft → [example](./examples/walkthrough-code-review/prd-code-review-2026-05-05.md) | CLI · web · desktop · mobile |
| `/competitive "<market>"` | "Who else is in this space and where's the white space?" | Landscape with positioning + white-space analysis → [example](./examples/walkthrough-code-review/competitive-ai-code-review-2026-05-05.md) | CLI · web · desktop · mobile |
| `/compare "<product A>" "<product B>" [...]` | "Which of these should we pick — and how would we test it?" | Feature matrix + decision rules + executable eval YAML → [example](./examples/walkthrough-compare-tools/) | CLI · web · desktop · mobile |

&nbsp;

### Measurement — What does "good" look like?

Define how you'll know your work succeeded, then check whether it did — using Anthropic's framework end-to-end. The six commands below run in flow order: define metrics, read the data, design the suite, run it, diagnose failures, keep pmstack itself honest.

| Command template | What it answers | What you get | Where it runs |
|---|---|---|---|
| `/metrics "<feature>"` | "How will we know this worked?" | North Star + 2–3 supporting + 1–2 counter-metrics → [example](./examples/walkthrough-code-review/metrics-code-review-2026-05-06.md) | CLI · web · desktop · mobile |
| `/vibe-test "<feature>"` | "What does this AI feature actually do in the wild?" | A vibe-test memo — failure patterns + task candidates + 'ready for `/eval`?' verdict (reads transcripts via paste, attach, or `--from-folder`) | CLI · web · desktop · mobile |
| `/eval "<AI feature>"` | "What does 'good' actually look like for this AI feature?" | A test-suite YAML — tasks, metrics, graders (code/model/human), pass@k or pass^k → [example](./examples/walkthrough-code-review/eval-code-review-2026-05-06.yaml) | CLI · web · desktop · mobile |
| `/run-eval <eval-yaml-path>` | "Does this AI feature actually pass the bar?" | A scored summary.md with **both pass@k AND pass^k**, top failures, cost → [example](./examples/walkthrough-code-review/eval-runs/code-review-eval-2026-05-06/summary.md) | CLI only (needs a real target) |
| `/transcript-review <run-folder>` | "Why did these trials fail — model, grader, or task?" | A diagnosis memo — per-trial verdicts + proposed eval changes (reads `/run-eval` output) | CLI · web · desktop · mobile |
| `/eval-self [--skill <name>]` | "Is pmstack itself still good?" | Scores every pmstack skill against canonical scenarios | CLI only |

&nbsp;

### Communicate & orchestrate

Package your work for the audience that needs it, or chain the right tools in the right order.

| Command template | What it answers | What you get | Where it runs |
|---|---|---|---|
| `/brief "<topic>" <audience>` | "What does the exec / eng team / customer need to know?" | A one-page audience-sized brief → [example](./examples/walkthrough-code-review/brief-code-review-exec-2026-05-09.md) | CLI · web · desktop · mobile |
| `/sprint "<a customer signal>"` | "Take this from signal to ship-ready in one pass." | Four artifacts in sequence — PRD → metrics → eval → brief — with confirmation gates | CLI · web · desktop |

&nbsp;

### Routines — Become an AI Director

Recurring patterns that turn pmstack from a set of one-shot commands into a PM operating system. They schedule themselves, audit your workspace, gate launches, and force you to notice your own learning. **This layer is what separates someone running prompts ad hoc from someone directing an AI-augmented workflow.**

| Command template | What it answers | What you get | Where it runs |
|---|---|---|---|
| `/eval-drift` | "Did my AI feature get worse this week?" | Drift memo with `RELEASE_BLOCKED: true\|false` flag → [example](./examples/walkthrough-code-review/eval-drift-2026-05-12.md) | CLI only (needs real eval runs) |
| `/premortem <prd-slug>` | "How could this feature fail?" | 3 failure stories + leading indicators + mitigations; mutates the PRD's Risks section → [example](./examples/walkthrough-code-review/premortem-code-review-2026-05-05.md) | CLI · web · desktop · mobile |
| `/weekly` | "What changed in my thinking this week?" | Decisions made + open loops aging + one required 'changed my mind' field → [example](./examples/walkthrough-code-review/weekly-2026-W19.md) | CLI · web · desktop |
| `/launch-readiness <feature>` | "Are we actually ready to ship this?" | GO / NO-GO / CONDITIONAL verdict + 7-item evidence checklist → [example](./examples/walkthrough-code-review/launch-readiness-code-review-2026-05-09.md) | CLI · web · desktop · mobile |
| `/lint` | "Did anything in my workspace drift out of sync?" | Graph gaps + cross-artifact drift + stale candidates with 'Do this:' actions → [example](./examples/walkthrough-code-review/lint-2026-05-08.md) | CLI · web · desktop |

**Schedule with `/loop`** so the routines run themselves:

```bash
/loop 7d /weekly       # Monday self-snapshot
/loop 7d /lint         # workspace audit
/loop 7d /eval-drift   # weekly eval-regression watch
```

---

## A week with pmstack

A typical week, end to end: a customer signal arrives → `/prd` translates it → `/premortem` stress-tests the spec → `/sprint` chains metrics, eval, and brief → `/launch-readiness` gates the ship → `/eval-drift` watches it after launch. Meanwhile `/lint` keeps your workspace tidy and `/weekly` captures what changed in your thinking. The full week, with all 12 artifacts, lives in [examples/walkthrough-code-review/](./examples/walkthrough-code-review/).

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
│          Welcome to pmstack. We'll walk through 9 steps using a      │
│          realistic AI code review feature. Type 'next' to start      │
│          with /prd.                                                  │
│                                                                      │
│  You:    next                                                        │
│                                                                      │
│  Claude: Step 2 of 9 — /prd                                          │
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
