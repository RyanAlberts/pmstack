# pmstack

**A PM toolkit that runs inside Claude.** Turn customer quotes into PRDs, compare competitors, design eval suites, draft exec briefs — all from one consistent set of commands you type into Claude (in your terminal, browser, or mobile app).

## Who this is for

You're a **technical PM** — comfortable in a terminal, can read code, ship product specs and metrics dashboards. You use Claude (or want to) but you're not deep in LLM-land. You don't want to memorize prompt engineering tricks; you want a co-pilot that already knows how a senior PM thinks.

If that's you, this saves you 5–15 minutes per artifact and stops you from staring at a blank page. If you're a senior PM who already has your own templates, fork this and make them yours.

## What you get

Nine commands, each producing a real artifact (markdown or YAML in `outputs/`) you can paste into Notion or hand to a teammate.

| You type… | You get… |
|---|---|
| `/prd "Customers say onboarding takes 3 days"` | A PRD draft from a single customer signal |
| `/competitive AI coding assistants` | 3–5 competitors compared, with white-space analysis |
| `/compare Cursor Windsurf` | Feature-by-feature comparison with a built-in test plan |
| `/metrics "search relevance for our agent"` | A measurement framework: North Star, supporting metrics, counter-metrics |
| `/brief "Q2 launch slipping" exec` | A one-page stakeholder brief sized for the audience |
| `/eval "support chatbot"` | A test suite design for an AI feature (a "what would good look like") |
| `/run-eval outputs/eval-...yaml` | Actually runs the test suite and scores it |
| `/sprint "Customers want pricing transparency"` | All four — PRD → metrics → eval → brief — with you approving each step |
| `/eval-self` | Scores pmstack itself against its own quality bar |

Don't worry about understanding all of them yet. **Start with `/prd` on a real customer quote you have lying around** — that's the fastest way to feel the value.

### Show me what the output actually looks like

Browse the [examples gallery →](./examples/README.md) for real artifacts each command produces. The headliner:

- **[outputs/eval-claude-ultraplan-2026-04-24.yaml](./outputs/eval-claude-ultraplan-2026-04-24.yaml)** — what `/eval` produced when asked to design a test suite for a hypothetical "Claude Ultraplan" planning agent. 10 capabilities, 12 failure modes, 13 metrics, 15 test cases. This is the kind of artifact most teams ship AI features without — pmstack makes it 60 seconds of work.
- **[outputs/pmstack-roadmap-2026-04-24.md](./outputs/pmstack-roadmap-2026-04-24.md)** — strategic roadmap memo. Not from a skill directly, but written by the same Claude+pmstack pairing.
- **[outputs/verification-2026-04-24.md](./outputs/verification-2026-04-24.md)** — a verification report. Format you can reuse for any "does this actually work?" review.

## Install (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash
```

That installs into the folder you're currently in. Want to install it elsewhere or make it available everywhere?

```bash
# Install into a specific folder
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- ~/work/my-pm-stuff

# Install for every Claude Code session (global)
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- --global
```

The installer downloads pmstack to a temp folder, copies the bits you need into your target, and cleans up after itself. **Nothing leftover in your home directory.** Read the script first if you'd like: [install.sh](./install.sh).

<details>
<summary>Manual install (if you prefer to clone and inspect)</summary>

```bash
git clone https://github.com/RyanAlberts/pmstack.git
cd pmstack
./setup ~/work/my-pm-stuff
```

</details>

## Get started in 60 seconds

**Step 1.** Open Claude Code in the folder you installed into.

```bash
cd ~/work/my-pm-stuff   # or wherever you installed
claude                    # starts Claude Code in this folder
```

> **Don't have Claude Code yet?** It's Anthropic's terminal app for Claude — install with one command from [claude.com/code](https://claude.com/code). The pmstack commands only work inside Claude Code (or, for browser/mobile, see "Using this on your phone" below).

**Step 2.** Type one of the commands. Real example to try right now:

```
/prd "Three of our biggest customers said onboarding feels like a full-day project. Two churned in week one."
```

Claude will produce a full PRD draft and save it to `outputs/prd-onboarding-friction-2026-04-25.md`. Open it. Edit it. Hand it to engineering.

**Step 3.** That's it. The other commands work the same way. Each writes its output to `outputs/` so you can find it later, share it, or feed it into the next command.

---

### Using pmstack outside Claude Code

Slash commands only work in Claude Code (terminal). Most other AI tools work fine — the underlying skills are just markdown. **Pick your tool** and follow the 2-5 minute setup:

→ **[docs/using-other-tools.md](./docs/using-other-tools.md)** covers Claude.ai (web/mobile/desktop), Cursor agent mode, ChatGPT, Gemini, and "anything else."

---

## What's an eval? (the one piece of jargon you'll see a lot)

An **eval** is a test suite for an AI feature. You define inputs ("what a real user might say") and what good looks like, then run them through your AI system and score the results. It's how you know whether `gpt-4` does this task better than `claude-sonnet`, or whether your latest prompt change made things better or worse.

Two pmstack commands handle this:

- **`/eval`** — Designs the test suite. Output: a YAML file describing what to test and how to grade it.
- **`/run-eval`** — Actually runs the test suite against a real AI system and writes a scored report.

Most PMs ship AI features without evals because designing one feels intimidating. `/eval` makes the design 80% done in 60 seconds. **`/run-eval` will hard-stop if you haven't told it what AI system to test against — it never invents fake scores.**

A walk-through for your first eval is in [docs/run-eval-setup.md](./docs/run-eval-setup.md).

## A few common questions

**Do I need to know how Claude works internally?**
No. You should know what an LLM is and roughly that they have limits, but pmstack hides everything else.

**Does this cost money?**
The commands themselves are free. The Claude tokens used to run them count against your Claude subscription (Pro/Max/Team) or API key. A typical PRD or competitive analysis is well under a penny. The `/run-eval` command can use more tokens — it tells you the estimate before each run and asks before spending.

**What if I want to change how a command behaves?**
Open the file in `skills/<name>.md` (e.g., `skills/prd-from-signal.md`) and edit. The skill is just markdown — Claude reads it as instructions. Save and re-run; your changes apply immediately.

**Is my data sent anywhere unusual?**
No. Everything runs through your existing Claude account. pmstack adds no servers, no telemetry, no third parties. The skills are just markdown files on your disk.

## Want to contribute, fork, or learn how it's built?

- [DECISIONS.md](./DECISIONS.md) — every design choice and why
- [outputs/pmstack-roadmap-2026-04-24.md](./outputs/pmstack-roadmap-2026-04-24.md) — what's coming next
- Inspired by [Gstack](https://github.com/garrytan/gstack) (the engineer's version) and [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

---

Built by [Ryan Alberts](https://github.com/RyanAlberts) — Staff PM in Agentic AI. PRs and forks welcome.
