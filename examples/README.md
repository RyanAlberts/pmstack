# Example outputs gallery

Real artifacts produced by pmstack commands. Browse before you install — see if the output is the kind of thing you'd actually share with engineering, your exec team, or a customer.

## How to read this gallery

Each section shows:
- **What you'd type** in Claude
- **What you'd get** — a real artifact, on disk, in this repo
- **What's good about it** — what to look for if you're new to evaluating PM tooling output

If an artifact looks like work you'd want to do less of by hand, that's the value pmstack is offering you.

---

## /eval — design a test suite for an AI feature

**You'd type:**
```
/eval "Claude Ultraplan — a deep planning agent for codebases"
```

**You'd get:** **[outputs/eval-claude-ultraplan-2026-04-24.yaml](../outputs/eval-claude-ultraplan-2026-04-24.yaml)**

**What's good about it:**
- 10 capabilities, 12 failure modes, 13 metrics, 15 test cases
- Every test case has a severity (P0/P1/P2) so you can gate releases
- Header instructions tell you exactly how to run it (`/run-eval ...`)
- Has a `target:` section — meaning a teammate could literally execute it tomorrow
- Has a "jargon glossary" at the top — no PhD required
- Calls out assumptions explicitly ("here's what I assumed about Ultraplan — verify before trusting")

**Time to produce by hand:** half a day if you're meticulous, never if you're not.
**Time with `/eval`:** ~60 seconds + a few minutes to refine.

---

## /prd — translate a customer signal into a PRD draft

**You'd type:**
```
/prd "Support agents spend 30% of their time manually triaging tickets. We're missing our 2-hour SLA on 40% of tickets and ticket volume is growing 15% MoM."
```

**You'd get:** **[examples/sample-prd-output.md](./sample-prd-output.md)**

**What's good about it:**
- Problem statement grounded in numbers (30% of agent time, 40% SLA miss, 15% MoM growth) — not vibes
- MoSCoW scoping makes the V1 cut explicit and defensible (auto-categorize ✓, auto-reply ✗)
- Success metrics include a North Star (>85% first-try routing), a supporting metric (<2hr response), and a counter-metric (<10% re-routing) — the trio you'd want before any launch
- Open questions section names the real trade-off (Haiku vs Sonnet for cost/latency/accuracy) instead of hand-waving "TBD"
- Calls out concrete risks at both layers — technical (LLM latency) and business (mis-routing enterprise tickets)

**Time to produce by hand:** 1–2 hours of staring at a blank page, then more hours arguing about scope.
**Time with `/prd`:** ~60 seconds + a few minutes to add company-specific context.

---

## Strategy / planning artifacts

Not from a single skill — these came from Claude+pmstack working through real strategic questions:

**[outputs/pmstack-roadmap-2026-04-24.md](../outputs/pmstack-roadmap-2026-04-24.md)** — a v0.2→v1.0 roadmap memo for pmstack itself, written by Claude after researching gstack as a comparable project. Useful as a template for "what should our roadmap look like?"

**[outputs/verification-2026-04-24.md](../outputs/verification-2026-04-24.md)** — an end-to-end verification report. Format you can reuse for any "does this actually work?" launch review.

---

## Coming soon (these slots are open — first PRs that produce great artifacts get featured)

| Skill | What we'd put here |
|---|---|
| `/competitive` | A worked landscape analysis with white-space ID |
| `/compare` | A side-by-side product comparison with an evaluable test plan |
| `/metrics` | A real measurement framework with a North Star, supporting metrics, counter-metrics |
| `/brief` | One brief, three audiences (exec, eng, customer) — same topic, different framing |
| `/sprint` | A complete chained run: customer signal → PRD → metrics → eval → brief |
| `/run-eval` (results) | A summary.md from a real eval run with metrics table |

If you produce one of these and would share, [open a PR](https://github.com/RyanAlberts/pmstack/pulls).

---

## What to look for when judging an artifact

Three quick checks — works for any pmstack output:

1. **Does it cite anything?** A PRD that says "customers want better onboarding" with no quote or data is fluff. A PRD that opens with the actual signal it's responding to is grounded.
2. **Does it commit to a number?** A metrics framework without targets ("we'll track engagement") is a wish list. A framework with thresholds ("week-1 retention >= 40%, alert if it drops below 35%") is actionable.
3. **Does it call out assumptions?** Real PM artifacts include "here's what I'm assuming, here's how I'd verify." Hand-wavy assumptions are how launches go sideways.

If pmstack's output passes those three checks — and it should, that's the point — it's ready to share.
