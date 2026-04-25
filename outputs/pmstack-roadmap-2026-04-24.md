# pmstack v0.2 → v1.0 Roadmap

**Author:** AI PM
**Date:** 2026-04-24
**Audience:** pmstack maintainer (you), early adopters, contributors

## TL;DR

pmstack v0.1 ships 5 skills as static markdown. Gstack ships 23+ skills wired into a workflow, with telemetry, an installer, multi-host support, and self-update. The gap isn't more skills — it's the *system around the skills*. Three moves close most of the gap:

1. **Wire skills into a workflow**, not a list. PM work is a pipeline (Discover → Define → Decide → Deliver → Measure). Each skill should hand off to the next.
2. **Ship infrastructure**: installer (done), self-update, opt-in telemetry, taste memory, a real eval suite that scores pmstack on its own outputs (the canonical dogfooding).
3. **Add the high-leverage skills that PMs actually re-do every week**: launch checklist, weekly review, voice-of-customer synthesis, pricing decision, exec readout, decision log.

This memo is the plan to get there. It's prioritized, scoped, and mapped to a release.

---

## What gstack does that pmstack doesn't (yet)

Researched 2026-04-24 from [github.com/garrytan/gstack](https://github.com/garrytan/gstack).

| Pattern | gstack | pmstack v0.1 | Gap |
|---|---|---|---|
| Install script | `./setup` | None — README said `cp -r` (now fixed in this release) | Closed in v0.2 |
| Slash commands wired | 23+ commands in `.claude/commands/` | Skills referenced but commands never installed | **Closed in v0.2** |
| Workflow ordering | Skills are sprint-phase ordered | Skills are alphabetical | Open |
| Output handoff | `/plan-ceo-review` feeds `/plan-eng-review` feeds `/ship` | Each skill produces a standalone artifact | Open |
| Self-update | `/gstack-upgrade` | None | Open |
| Telemetry | Opt-in JSONL, local-only | None | Open |
| Multi-host | Claude Code, Codex, Cursor, Factory, Slate, Kiro, Hermes | Claude Code only | Open (defer) |
| Memory / taste | `gstack-taste-update` decays 5%/week | None | Open |
| MCP integration | `gbrain` registered as MCP server | None | Open |
| Sub-agent orchestration | `/pair-agent`, `/codex` cross-model second opinion | None | Open |
| Personality | "CEO mode", "voice-friendly triggers" | Generic PM voice in CLAUDE.md | Partially closed |
| Self-eval | Manual | None | Open (and embarrassing — we own the eval skill) |
| Safety | `/guard`, secret scanner, prompt-injection defense | None | Open |
| Process enforcement | "Confusion Protocol", auto-skill suggestion | None | Open |

The single most embarrassing gap: **pmstack's `agent-eval-design` skill exists, and we have no eval suite for pmstack itself**. Fixing this is the v0.3 anchor.

---

## What I'd ship next, prioritized

### v0.2 — "Make it actually work" (this PR)
- [x] `.claude/commands/*.md` for all 5 skills so `/eval`, `/prd`, etc. fire natively
- [x] `setup` script with project-scope and `--global` modes
- [x] README correctly tells users how to install
- [x] First eval artifact in `outputs/` (Claude Ultraplan) — proves the loop closes

**Success metric:** A PM clones the repo, runs `./setup`, types `/eval`, and gets a populated YAML in `outputs/`. Time-to-first-output < 2 minutes.

### v0.3 — "Eat your own dog food" (1–2 weeks)
The skill we sell is eval design. We should have the most-evaluated PM toolkit on GitHub.

- [ ] **Self-eval suite**: `evals/pmstack-self.yaml` — for each skill, define ≥10 input scenarios + a rubric. Rubric scored by Claude Sonnet (different family). Results published in `evals/results/`.
- [ ] **Golden output set**: `examples/golden/` — one perfect output per skill, used as anchor for "does the skill still produce work this good?"
- [ ] **Regression alerting**: any skill that regresses on the golden set gates a release.
- [ ] **`/eval-self` command**: re-runs the suite on demand.

**Success metric:** Every skill has a public score. Score visible in README. Trend tracked over time.

### v0.4 — "Workflow, not a list" (2–3 weeks)
PM work is a pipeline. Skills should know about each other.

- [ ] **Skill graph** (`skills/_graph.yaml`): `prd` outputs feed `metrics`; `metrics` feeds `eval`; `competitive` feeds `prd`. Each skill reads the prior artifact from `outputs/` if present.
- [ ] **`/sprint`** orchestrator: `prd → metrics → eval → brief` in one command, with checkpoint approval at each step.
- [ ] **Decision log auto-update**: every skill appends a one-line entry to `decisions-log.md` with the artifact link, so future skills have memory.
- [ ] **CLAUDE.md "context engineering" pass**: explicit references to the workflow, not just communication style.

**Success metric:** A new feature can go from "customer quote" → "shipped eval criteria" in < 30 minutes with one orchestrator call.

### v0.5 — "The PM weekly loop" (3 new skills + 1 orchestrator)
The skills a Staff PM runs every week, that pmstack v0.1 doesn't have.

- [ ] **`/launch` — launch checklist generator**: pre-launch, day-of, post-launch readouts. Includes legal, ops, support handoff, exec comm.
- [ ] **`/voc` — voice-of-customer synthesis**: paste in 20–50 quotes / tickets, get themes, frequency, severity, and 3 PRD-ready problem statements.
- [ ] **`/pricing` — pricing decision support**: framework-driven (Van Westendorp, anchor effects, willingness-to-pay), forces explicit assumptions.
- [ ] **`/standup`** orchestrator: pulls last week's commits / Linear / Slack into a 5-bullet weekly readout.

**Success metric:** Adoption — at least one external PM team using the weekly loop in production.

### v0.6 — "Self-update + telemetry" (infrastructure parity with gstack)
- [ ] **`/pmstack-upgrade`**: `git pull` + show changelog + warn on local edits.
- [ ] **Opt-in local telemetry**: `~/.pmstack/usage.jsonl`, captures `{skill, duration_ms, success_bool, version}`. Never artifact content. Local-only by default; user can opt into upload.
- [ ] **`/pmstack-stats`**: shows the user their own most-used skills, average duration, eval pass rates over time.

**Success metric:** Maintainer (you) can see usage patterns without violating privacy. Users see their own PM productivity dashboard.

### v0.7 — "Sharper edges" (skill quality)
- [ ] **Cross-model second opinion** (`/critique` — gstack's `/codex` analog): runs the artifact through GPT/Gemini for adversarial review. Returns a YAML diff: "what would another model push back on?"
- [ ] **Confusion Protocol**: when a skill hits ambiguity, it stops and asks instead of guessing. Encoded as a meta-skill that all 5 skills reference.
- [ ] **Personality dial**: `~/.pmstack/voice.yaml` lets the user choose tone (blunt-Bezos, warm-Doerr, technical-Hsu). Default = blunt.

### v1.0 — "Domain packs + MCP"
- [ ] **Domain packs**: `pmstack-fintech`, `pmstack-devtools`, `pmstack-healthcare`, `pmstack-ai-platform`. Each adds 3–5 domain-specific skills + tunes the existing 5.
- [ ] **MCP integrations**: connect to Linear, Notion, Mixpanel, Amplitude, Slack — so the analysis runs on real data, not the LLM's general knowledge. Per-tool trust policies (read-only by default).
- [ ] **Multi-host**: Cursor and Codex support via the same `setup --host <name>` pattern gstack uses.

---

## Things I would NOT copy from gstack

Worth saying explicitly so we don't mindlessly clone.

1. **23 skills out of the gate.** Five well-scoped skills with great evals beat twenty generic ones. Add slowly.
2. **Sprint metaphor as the only workflow.** PM work isn't always sprint-shaped. Roadmap planning, deep-research weeks, and exec prep all break the model.
3. **Heavy CLI tooling in Bash + Go.** pmstack should stay markdown-first. A `setup` script is the right amount of code; a multi-binary toolchain is not.
4. **Telemetry uploaded by default.** Even opt-in cloud telemetry is a hard sell in PM teams (artifacts contain customer quotes, internal strategy, sometimes legal-flagged terms). Local-only with explicit upload.

---

## Open questions

- **Distribution.** gstack got 72K stars partly via Garry's reach. What's the launch strategy? (Hacker News post, "PM newsletter" guest essay, conference workshop, all three?)
- **Naming.** Is "pmstack" too close to gstack? Adjacent enough to ride the SEO, distinct enough to stand alone? I'd keep it.
- **License.** Inherit MIT from the inspiration? (Probably yes.)
- **Contribution model.** Skills are inherently opinionated. Do we accept skill PRs, or only "fork your own pack"? Recommend: PRs only for the core 5; encourage forks for everything else.

---

## What I'd want to validate before committing to this roadmap

1. **Does anyone outside Ryan use pmstack?** If not, the v0.5 weekly-loop skills should come *after* user research with 5 PMs. Building skills no one runs is the worst failure mode in [USER.md](../CLAUDE.md).
2. **Does `/eval Claude Ultraplan` produce something a PM would actually take to a launch review?** That's the live test of the existing skill quality. Ship the v0.2 release, run it, gut-check the output.
3. **Is the workflow / handoff feature (v0.4) more valuable than just adding skills (v0.5)?** I'd argue yes — but it depends on whether users already love the existing 5. If they do, v0.5 first.

---

## Recommendation

Ship v0.2 today. It removes the "the README lies" problem.

Then run the v0.3 self-eval next week — it's the most pmstack-coherent thing we can do, and the results will tell us whether the existing skills need tuning before adding more.

Defer v0.4–v1.0 until v0.3 surfaces real evidence about quality and use.
