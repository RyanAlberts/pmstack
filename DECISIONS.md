# Decisions

Every choice in this repo is a product decision. Here's why I made them.

## Why Claude Code skills, not a Python framework?

The most valuable layer in AI tooling isn't code. It's encoded judgment. Garry Tan's Gstack proved this: 72K stars for what critics called "glorified prompt templates." They're right, and they're missing the point. The prompts ARE the product.

I chose Claude Code's native skill system (CLAUDE.md + markdown files) because:
- **Zero dependencies**: no install, no runtime, no API keys beyond what Claude Code already has
- **Forkable in 10 seconds**: clone the repo, drop it in your project, done
- **The LLM reads the skill at inference time**: it's not a static template, it's a dynamic cognitive mode

The trade-off: this only works with Claude Code. I'm fine with that. If you're a PM working with AI in 2026 and you're not using Claude Code, this repo isn't for you yet.

## Why these 5 skills?

I mapped the PM workflow to the places where I waste the most time, then sorted by "how much does the quality of the output depend on structured thinking vs. raw information?"

High-structure, high-leverage:
1. **competitive-landscape**: Most PMs google around for 2 hours. This produces a better output in 60 seconds because the structure forces completeness.
2. **prd-from-signal**: The gap between "I heard a customer say X" and "here's a spec" is where PM value lives. This skill encodes the translation.
3. **metric-framework**: AI products have a unique measurement problem (what is "good"?). This skill forces you to answer it before shipping.
4. **agent-eval-design**: The single biggest gap in AI product development. Most teams ship without evals. This makes eval design a first-class PM activity.
5. **stakeholder-brief**: Low creativity, high frequency. The perfect task for an LLM with the right structure.

What I explicitly left out: roadmap planning (too context-dependent), user research synthesis (needs real data), sprint planning (Gstack already does this well).

## Why CLAUDE.md matters

CLAUDE.md is "context engineering": the practice of designing the persistent context that shapes every interaction with your AI tools. This is a concept Anthropic's team talks about a lot. It's the system prompt for your entire project.

My CLAUDE.md is opinionated about communication style because that's where PMs create the most value and waste the most time. "Be direct, state your confidence level" isn't just a prompt instruction. It's a product philosophy.

## Why markdown files, not a database?

Same reasoning as Karpathy's LLM Wiki: markdown files are the most LLM-native storage format. They're human-readable, version-controlled, grep-able, and they fit in a context window. Every alternative (SQLite, JSON, YAML) adds complexity without adding capability for this use case.

## Why a Claude Code plugin (2026-06)

`curl | bash` is the wrong install idiom for this audience: it's the one command pattern a security-conscious PM has been told never to run. The repo now doubles as a plugin marketplace (`.claude-plugin/`): `/plugin marketplace add RyanAlberts/pmstack` then `/plugin install pmstack@pmstack`. Plugin users get namespaced commands (`/pmstack:eval`) and versioned updates; the copy-install path stays for people who want bare `/eval` names or non-Claude tools. The plugin's command files are 6-line shims that invoke the self-contained skills in `claude-skills/`, deliberately, so there's no fourth copy of the skill content to drift.

## Why MIT, not CC-BY-SA (2026-06)

Share-alike was the wrong default for a tool whose target user works at a company with a legal department. "Can I edit this skill file for internal use?" should never require a lawyer. MIT removes the conversation. (Relicensed while the repo had a single author, so no contributor sign-off was needed.)

## What I'd add next

If this gets traction, the natural extensions are:
1. **Domain-specific skill packs**: `pmstack-fintech`, `pmstack-devtools`, `pmstack-healthcare`
2. **Output evaluation**: an eval suite that tests whether the skills produce good outputs (eating my own dogfood with the agent-eval-design skill)
3. **MCP integration**: connect the skills to live data sources (analytics dashboards, support ticket systems, CRMs) so the analysis runs on real data, not LLM knowledge

## 2.0 error discovery overhaul (2026-09)

**What.** pmstack 2.0 does one job: evals for product managers, built on error discovery, the method Hamel Husain and Shreya Shankar teach. You read real traces, note the first thing that went wrong in each, group the notes into failure modes and success modes, see where each failure starts in the funnel of an AI experience, build a code check or an AI judge for each failure mode that matters, prove each judge agrees with your own labels, and keep the checks running. It ships as Eval Studio (a static web app that also runs on your computer against a folder of traces), twelve Agent Skills with slash commands, a zero-dependency command-line tool, six sample products, generated visuals, and guides.

**Why.** 1.x spread across twenty commands, from PRDs to the Monday memo, and its eval commands started from a template: pick the metrics, write the test cases, score them. That order measures what someone guessed would fail. Reading traces first finds what fails for real customers, and that reading is the part of evals a PM is best placed to do, because it takes product judgment rather than code. One tool that does that job end to end, from the first trace to a check in the build, is worth more than twenty prompts that each cover a slice.

**What was retired.** The PM commands (`/prd`, `/metrics`, `/brief`, `/competitive`, `/compare`, `/voc`, `/sprint`, `/weekly`, `/premortem`, `/launch-readiness`, `/lint`, `/onboarding`, `/transcript-review`, `/vibe-test`), the eval commands (`/eval`, `/run-eval`, `/eval-grade`, `/eval-report`, `/eval-drift`, `/eval-self`), the YAML templates and Python runners, the JSON evaluation harness, the evaluation workspace, and the `claude-skills/` and `plugin-commands/` folders. All of it is preserved at the tag `v1.2.0`, and CHANGELOG.md maps each piece to what replaced it.

**What this changes from earlier entries.** The skills are now plain Agent Skills that Codex, Cursor, Gemini CLI, and Claude on the web can read too, so the "only works with Claude Code" trade-off no longer applies. Project state moved from Markdown to open JSON (`pmstack.project/1`), because the studio, the command line, and agents all read and write the same reviews and labels, and every number must be computed from them rather than written by hand. The plugin install path stays the main one.

**Tool call checks.** Added partway through the 2.0 build, at my request: evals for agents that call tools, asking three questions of every call. Policy: is this call allowed? Relevance: is it the right call for what the customer asked? Output grounding: does the reply match what the tool returned? Policy is the one place the method supports writing checks before reading traces, because policy rules are requirements the company already knows. Relevance and grounding failures are confirmed in real traces first, then the templates give a head start.

**Licensing.** `ai-evals-course/evals-skills` has no license, so pmstack copies nothing from it and re-implements the ideas in its own words and pictures. The MIT sources (the archived `hamelsmu/evals-skills` and `judgy`) are adapted with credit in each source file header and in `guides/credits.md`.
