# Skill: Voice of Customer Synthesis (`/voc`)

## Trigger
`/voc [paste | attach | --from-folder <path>]` — a *pile* of raw signals: support tickets, interview snippets, churn reasons, sales-call notes, NPS verbatims, app-store reviews, Slack complaints. Anything that says "I have a stack of customer feedback; tell me what the real problem is and what to build first."

## Goal
Turn the noise of many signals into a small set of ranked, PRD-ready problems. **This is the front of the funnel `/prd` assumes you already finished.** `/prd` takes the *one* signal that matters; `/voc` is how you find it. The skill's value is the synthesis judgment: clustering by underlying problem (not feature), scoring by **frequency × severity × strategic-fit**, and refusing to let the loudest theme automatically win.

PMs leak days reading feedback and still pick the wrong problem — usually the one shouted most often, not the one that hurts most. This skill makes the pass take minutes and makes the prioritization defensible.

## What good looks like

Before writing the synthesis, you should be able to answer:

- **How many distinct underlying problems are in here?** (Usually 3–7. More than ~8 means you're clustering by feature, not by problem.)
- **Which problem is most frequent? Most severe? Best strategic fit?** (These are rarely the same theme — that gap is the whole point.)
- **What's the silent killer?** (The low-frequency, high-severity theme — security, churn, data loss — that frequency-ranking buries.)
- **What did I NOT hear?** (Signals are a biased sample. Name the bias.)

If the input has **fewer than 5 signals**, stop and say so: *"This is `/prd` territory, not `/voc` — with this few signals, run `/prd` on the strongest one directly."* If the input is **empty**, ask for the signals and halt. Never invent signals to hit a count.

## Read prior context (skill graph)

Before synthesizing, glob `outputs/competitive-*.md` — a recent positioning analysis is the cheapest way to judge **strategic fit** (a problem that widens your differentiation scores higher than one that just matches the field). Also glob `outputs/prd-*.md`: if a theme is already specced, mark it `[already in PRD]` instead of re-surfacing it as net-new.

## Required structure

1. **Snapshot** — one line: `N signals → M themes`, the date, and the source mix (e.g., "8 tickets, 4 churn interviews, 3 sales notes"). Source mix is how the reader judges the sample.

2. **Theme table** — one row per theme, sorted by Priority (not by frequency):

   | Theme (the underlying problem) | Signals (n, %) | Severity | Fit | Priority | Representative quote |
   |---|---|---|---|---|---|

   - **Severity** = depth of pain *per signal*: `High` (blocks the core job / costs money / drives churn), `Med` (real friction, workaround exists), `Low` (annoyance / nice-to-have). Not how many people said it — that's frequency.
   - **Fit** = alignment with where the product is going and who you want to serve: `High` / `Med` / `Low`.
   - **Priority** = a transparent roll-up, not a black box. Default: `High` only if Severity *and* Fit are High or the theme is the clear frequency leader with Med+ on both; otherwise reason it out in one clause. Show your logic; never emit a score you can't explain.
   - Every theme **must** cite a verbatim quote. A theme with no quote is a hallucination — delete it.

3. **Prioritization read — loudest ≠ most important** — required, 2–4 sentences:
   - State whether the **most-frequent** theme is also the **highest-priority**. If not, say so plainly and explain why severity/fit outweighs volume.
   - Name any **squeaky wheel**: high frequency, low severity/fit. (Loud but not load-bearing.)
   - Name any **silent killer**: low frequency, high severity/fit. (Few mentions, but the kind that ends accounts.)

4. **Top 3 problems (PRD-ready)** — ranked. Each one is formatted to hand straight to `/prd`:
   - **The underlying problem** (what they *need*, not what they *said*).
   - **Segment** affected (+ rough size only if the signals state it — never fabricate).
   - **Business cost** of not fixing (churn / revenue / support load / NPS), grounded in the signals.
   - **Representative quote** (verbatim).
   - **Ready to run:** a copy-paste line — `` /prd "<a tight signal that captures this problem>" ``

5. **What I did NOT hear** — coverage gaps and sampling bias. Who is over- or under-represented? (E.g., "all 15 signals are from paying enterprise accounts — SMB and trial-stage voice is absent; treat the ranking as enterprise-weighted.") This is what separates synthesis from a tag cloud.

6. **Recommended next step** — which problem to take to `/prd` first, in one sentence, with the reason.

## Hard rules

- **Work only from the provided signals.** Never invent quotes, never inflate counts, never fabricate segment size or revenue. If you don't have a number, write "unknown — would need [source]".
- **Every theme traces to ≥1 verbatim quote.** No quote, no theme.
- **Cluster by underlying problem, not by feature or surface area.** "The API," "the dashboard," "onboarding" are *places*, not problems. "Users can't tell which PRs need urgent review" is a problem.
- **Show the frequency × severity × fit scoring transparently.** A ranking the reader can't audit is worthless.
- **Always deliver the "loudest ≠ most important" read** and always flag a silent killer if one exists. Frequency-only ranking is the failure mode this skill exists to prevent.
- **Always flag sampling bias** in "What I did NOT hear." A synthesis that pretends the sample is the population is dangerous.
- **Top-3 must be PRD-ready** — paste-able into `/prd`, not vague theme labels.
- **State confidence, don't hedge.** Per CLAUDE.md: "I'm confident the churn theme is #1; less sure whether onboarding and latency are one problem or two."

## Anti-patterns

- Ranking by frequency alone. (The squeaky wheel wins and the silent killer ships a quarter late.)
- Themes that are feature buckets ("the integrations," "the mobile app") instead of jobs/problems.
- A "synthesis" that's really a tag cloud — counts with no severity, fit, or recommendation.
- Burying the low-frequency/high-severity theme because it only came up twice.
- Inventing segment sizes or dollar figures the signals never stated.
- Producing 12 themes. That's not synthesis; that's re-typing the inbox. Merge to the underlying problems.

## When to reach for a dedicated tool instead

`/voc` is a **judgment pass on a batch you can paste or attach (≈10–50 signals)**, run inside your own Claude account, that hands the winner to `/prd`. If you're ingesting **hundreds of signals continuously**, need **multi-PM tagging, dashboards, and CRM/ticket sync**, or must keep verbatims inside a governed system, a purpose-built VoC platform (Dovetail, Viable, Productboard Insights, Thematic) is the right call — then bring its top themes *here* for the prioritization read and the PRD handoff. pmstack's edge is zero-setup, zero-data-egress, and the clean handoff into the rest of the pipeline — not large-scale ingestion.

## Where to write

- With filesystem: `outputs/voc-<topic-slug>-<YYYY-MM-DD>.md`. Slug is 2–4 kebab-case words naming the *product area or feedback source*, not the winning problem (the winning problem becomes the PRD's slug): `voc-code-review-2026-05-04.md`.
- Inline (web/mobile): emit as markdown with the suggested filename at the top.

## Decision-log entry

Per @skills/_decision-log.md, append one line to `decisions-log.md`:

```
- <YYYY-MM-DD> — voc: <topic> — outputs/voc-<topic-slug>-<YYYY-MM-DD>.md
```

## Worked example

The input: 15 raw signals about an AI code-review product — a mix of enterprise churn interviews, support tickets, a sales-call note, and two app reviews. They span five underlying problems: slow review turnaround, noisy/low-signal comments, missed security issues, flaky CI integration, and weak large-PR handling.

The synthesis ranks **review-latency-driving-churn** #1 — not because it's the most frequent (noisy comments is mentioned more often), but because its severity (two named churns) and strategic fit are highest. It flags noisy comments as the **squeaky wheel** and missed-security-issues as the **silent killer** (only two mentions, but account-ending). The #1 problem statement is handed to `/prd` verbatim — and it's the exact signal the bundled `prd-code-review-2026-05-05.md` was built from, closing the `voc → prd` loop.

The full output: see `examples/walkthrough-code-review/voc-code-review-2026-05-04.md`.

## Tone
Direct. Customer-centric. Quantified where the signals allow, honest about the sample where they don't. State confidence levels — don't hedge. Active voice. No emojis. No "great question." Per CLAUDE.md.
