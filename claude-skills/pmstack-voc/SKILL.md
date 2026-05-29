---
name: pmstack-voc
description: Synthesize many raw customer signals (support tickets, interview snippets, churn reasons, sales notes, NPS verbatims, app reviews) into a small set of ranked, PRD-ready problems. Use when a PM pastes or attaches a pile of feedback and asks "what's the real problem / what should we build first / what are the themes", when there are too many signals to read one by one, or when someone needs to turn voice-of-customer data into prioritized problem statements before writing a PRD. This is the front-of-funnel step that precedes pmstack-prd.
---

# Voice of Customer Synthesis

Turn the noise of many signals into a few ranked problems. This is the step *before* a PRD: `/prd` takes the one signal that matters; this skill finds it out of many. The value is the synthesis judgment — cluster by underlying problem, score by **frequency × severity × strategic fit**, and refuse to let the loudest theme automatically win.

If fewer than 5 signals are provided, say so and recommend writing a PRD on the strongest one directly. If none are provided, ask for them — never invent signals.

## Required structure

1. **Snapshot** — `N signals → M themes`, the date, and the source mix.
2. **Theme table** (sorted by priority, not frequency): Theme (the underlying problem) | Signals (n, %) | Severity | Fit | Priority | Representative quote.
   - **Severity** = depth of pain per signal (High = blocks the job / costs money / drives churn). **Fit** = alignment with product direction. **Priority** = a transparent roll-up you can explain, never a black box.
   - Every theme cites a verbatim quote. No quote, no theme.
3. **Prioritization read — loudest ≠ most important** — is the most-frequent theme also the highest-priority? Name the *squeaky wheel* (loud, low-severity) and the *silent killer* (rare, account-ending).
4. **Top 3 problems (PRD-ready)** — ranked. Each: underlying problem, segment, business cost, a verbatim quote, and a copy-paste `/prd "..."` line.
5. **What I did NOT hear** — sampling bias and coverage gaps. Never pretend the sample is the population.
6. **Recommended next step** — which problem to take to a PRD first, and why.

## Hard rules
- Work only from the provided signals — never invent quotes, inflate counts, or fabricate segment size / revenue.
- Cluster by underlying *problem*, not by feature or product area. 3–7 themes; more than ~8 means you're clustering by surface.
- Show the frequency × severity × fit scoring transparently.
- Always deliver the "loudest ≠ most important" read and flag any silent killer.
- Always flag sampling bias.
- Top-3 must be PRD-ready, not vague theme labels.
- Active voice. State confidence instead of hedging.

## When a dedicated tool fits better
For hundreds of signals, continuous ingestion, multi-PM tagging, or governed verbatims, a purpose-built VoC platform (Dovetail, Viable, Productboard Insights, Thematic) is the right call — then bring its top themes here for the prioritization read and PRD handoff. This skill's edge is zero setup, no data egress, and the clean handoff to the next step.

## Where to write
- With filesystem: `outputs/voc-<topic-slug>-<YYYY-MM-DD>.md` (slug names the source/area, not the winning problem).
- Inline (web/mobile): emit as markdown with the suggested filename at the top.

## Tone
Direct, customer-centric, quantified where the signals allow, honest about the sample where they don't. Lead with the problem, not the feature.
