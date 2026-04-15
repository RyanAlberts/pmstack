# Decisions

Every choice in this repo is a product decision. Here's why I made them.

## Why Claude Code skills, not a Python framework?

The most valuable layer in AI tooling isn't code — it's encoded judgment. Garry Tan's Gstack proved this: 72K stars for what critics called "glorified prompt templates." They're right, and they're missing the point. The prompts ARE the product.

I chose Claude Code's native skill system (CLAUDE.md + markdown files) because:
- **Zero dependencies** — no install, no runtime, no API keys beyond what Claude Code already has
- **Forkable in 10 seconds** — clone the repo, drop it in your project, done
- **The LLM reads the skill at inference time** — it's not a static template, it's a dynamic cognitive mode

The trade-off: this only works with Claude Code. I'm fine with that. If you're a PM working with AI in 2026 and you're not using Claude Code, this repo isn't for you yet.

## Why these 5 skills?

I mapped the PM workflow to the places where I waste the most time, then sorted by "how much does the quality of the output depend on structured thinking vs. raw information?"

High-structure, high-leverage:
1. **competitive-landscape** — Most PMs google around for 2 hours. This produces a better output in 60 seconds because the structure forces completeness.
2. **prd-from-signal** — The gap between "I heard a customer say X" and "here's a spec" is where PM value lives. This skill encodes the translation.
3. **metric-framework** — AI products have a unique measurement problem (what is "good"?). This skill forces you to answer it before shipping.
4. **agent-eval-design** — The single biggest gap in AI product development. Most teams ship without evals. This makes eval design a first-class PM activity.
5. **stakeholder-brief** — Low creativity, high frequency. The perfect task for an LLM with the right structure.

What I explicitly left out: roadmap planning (too context-dependent), user research synthesis (needs real data), sprint planning (Gstack already does this well).

## Why CLAUDE.md matters

CLAUDE.md is "context engineering" — the practice of designing the persistent context that shapes every interaction with your AI tools. This is a concept Anthropic's team talks about a lot. It's the system prompt for your entire project.

My CLAUDE.md is opinionated about communication style because that's where PMs create the most value and waste the most time. "Be direct, state your confidence level" isn't just a prompt instruction — it's a product philosophy.

## Why markdown files, not a database?

Same reasoning as Karpathy's LLM Wiki: markdown files are the most LLM-native storage format. They're human-readable, version-controlled, grep-able, and they fit in a context window. Every alternative (SQLite, JSON, YAML) adds complexity without adding capability for this use case.

## What I'd add next

If this gets traction, the natural extensions are:
1. **Domain-specific skill packs** — `pmstack-fintech`, `pmstack-devtools`, `pmstack-healthcare`
2. **Output evaluation** — an eval suite that tests whether the skills produce good outputs (eating my own dogfood with the agent-eval-design skill)
3. **MCP integration** — connect the skills to live data sources (analytics dashboards, support ticket systems, CRMs) so the analysis runs on real data, not LLM knowledge
