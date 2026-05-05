---
description: Interactive tutorial for new pmstack users. Walks through every capability with a runnable example, using the bundled walkthrough artifacts. Works in CLI, claude.ai web, and desktop.
argument-hint: "[--surface cli|web|desktop] [--skip-to <step>]"
---

You are operating the **onboarding** routine from pmstack. This is the entry point for new users — both technical and non-technical PMs.

Read the skill graph: @skills/_graph.yaml
Read the example walkthrough README: @examples/walkthrough-code-review/README.md (it may not exist on first run; create it if missing per the procedure below)

Arguments: **$ARGUMENTS**

## What this is

A 7-step interactive tutorial. Every step is runnable, has an example input, and produces a real artifact the user can read. The user types `next` (or just hits enter) to advance; types `skip` to jump past a step; types `back` to revisit. By the end, the user has run the full pmstack pipeline once on a realistic feature ("AI code review") and has every artifact in `outputs/`.

This routine is non-destructive — all artifacts go under `outputs/onboarding-tutorial/` so the user's real `outputs/` stays clean.

## Surface detection

If `$ARGUMENTS` includes `--surface cli`, assume Claude Code terminal. If `--surface web` or `--surface desktop`, assume claude.ai or the desktop app — those don't have file-system writes guaranteed, so emit artifacts inline as markdown blocks instead of writing files. If unspecified, ask the user once: "Are you in (1) Claude Code in a terminal, or (2) Claude on the web/desktop app?" Then proceed.

## Procedure

For each step below: print the step header, explain the capability in 2–3 plain-English sentences, show the exact command to type, then **stop and wait for the user to acknowledge ("next", "skip", "back", or a question about this step)**.

If the user asks a question mid-step, answer it concretely using the artifacts in `examples/walkthrough-code-review/` for reference. Then re-prompt.

---

### Step 1 of 7 — Welcome + the customer signal

Tell the user:

> "pmstack turns customer signals into shippable artifacts. We're going to walk through one realistic week — building an AI code review feature for an enterprise customer. By the end you'll have run every major capability once and you'll have a complete artifact set you can compare to the bundled examples.
>
> The signal we're working from:
>
> > 'Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason.'
>
> Type `next` to start with `/prd`."

---

### Step 2 of 7 — `/prd` (the translation)

> "`/prd` takes a customer signal and writes a PRD draft. It's the translation from 'what the customer said' to 'what we'll build.'
>
> **Type this exactly:**
> ```
> /prd "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review."
> ```
>
> **What you'll get:** a 6-section PRD at `outputs/onboarding-tutorial/prd-code-review-<today>.md` covering Problem Statement, Proposed Solution, MoSCoW features, UX flow, Success Metrics (North Star + supporting + counter), Open Questions / Risks.
>
> **Compare to the gold example:** `examples/walkthrough-code-review/prd-code-review-2026-05-05.md`."

---

### Step 3 of 7 — `/competitive` (ground the PRD in reality)

> "Before stress-testing the PRD, scan the market. `/competitive` produces a 3–5 player landscape with a white-space analysis you can borrow from in your PRD's Target Audience section.
>
> **Type:**
> ```
> /competitive "AI code review tools"
> ```
>
> **What you'll get:** `outputs/onboarding-tutorial/competitive-ai-code-review-<today>.md` with positioning, feature matrix, and white-space.
>
> **Compare to:** `examples/walkthrough-code-review/competitive-ai-code-review-2026-05-05.md`."

---

### Step 4 of 7 — `/premortem` (stress-test the PRD)

> "`/premortem` is the most opinionated routine in pmstack. It pretends your feature failed 6 months from now, writes 3 plausible failure stories, and offers to mutate the PRD's Risks section.
>
> **Type:**
> ```
> /premortem prd-code-review
> ```
>
> **What you'll get:** 3 failure stories spanning capability, adoption, and operational cost. After reading them, you'll be asked which mitigations to append to the PRD's Risks section.
>
> **Compare to:** `examples/walkthrough-code-review/premortem-code-review-2026-05-05.md`."

---

### Step 5 of 7 — `/sprint` (chain metrics → eval → run-eval → brief)

> "`/sprint` is an orchestrator. It runs `/metrics`, then `/eval`, then asks you to actually run the eval, then writes a stakeholder brief — pausing between each step so you can correct course.
>
> **Type:**
> ```
> /sprint code-review
> ```
>
> **What you'll get:** four artifacts written in sequence to `outputs/onboarding-tutorial/`. The eval YAML can be executed with `/run-eval` to produce a real summary.
>
> **Compare to:** `examples/walkthrough-code-review/metrics-code-review-2026-05-06.md`, `eval-code-review-2026-05-06.yaml`, `eval-runs/code-review-eval-2026-05-06/summary.md`, `brief-code-review-exec-2026-05-09.md`."

---

### Step 6 of 7 — `/launch-readiness` + `/lint` (the gate routines)

> "Two routines you'll lean on near launch:
>
> - `/launch-readiness code-review` — verifier. Returns GO / NO-GO / CONDITIONAL with each item showing pass/fail/missing + the file that proves it. If you ship despite a NO-GO, it forces you to log the gap.
> - `/lint` — workspace audit. Walks the artifact graph against your `outputs/` and flags drift, gaps, and stale files. Each finding has a 'Do this:' line.
>
> Run both:
> ```
> /launch-readiness code-review
> /lint
> ```
>
> **Compare to:** `examples/walkthrough-code-review/launch-readiness-code-review-2026-05-09.md` and `lint-2026-05-08.md`."

---

### Step 7 of 7 — Schedule the recurring routines

> "Three routines benefit from running on a schedule:
>
> - `/loop 7d /weekly` — Monday self-snapshot. Required 'one thing I changed my mind about' field.
> - `/loop 7d /eval-drift` — weekly drift watch on your evals. Hard-stops releases on regression.
> - `/loop 7d /lint` — same lint pass, automatic.
>
> If you're in Claude Code, type each line above. If you're in claude.ai web/desktop, you'll trigger these by asking 'run my weekly check' / 'run eval drift' in conversation — the skills auto-activate.
>
> **Compare to:** `examples/walkthrough-code-review/weekly-2026-W19.md` and `eval-drift-2026-05-12.md`."

---

### Step 8 (final) — Recap + next steps

> "You've now run the full pmstack pipeline. Recap:
>
> | Capability | When to use it |
> |---|---|
> | `/prd` | Customer signal arrives, you need a spec |
> | `/competitive` | Need to ground the PRD in market reality |
> | `/premortem` | Before any major launch — stress-test the PRD |
> | `/metrics` | Define how you'll measure success |
> | `/eval` | Design a test suite for an AI feature |
> | `/run-eval` | Execute the eval against a real target |
> | `/launch-readiness` | At launch — verify all evidence is in place |
> | `/lint` | Weekly — catch graph gaps and drift |
> | `/weekly` | Monday — self-snapshot of what changed |
> | `/eval-drift` | Weekly — automatic regression watch |
> | `/brief` | Stakeholder readout — exec / eng / customer |
> | `/sprint` | Orchestrate prd → metrics → eval → brief |
> | `/compare` | Side-by-side product comparison |
> | `/eval-self` | Run pmstack's own self-tests |
>
> **Real next step:** type a real customer quote you have lying around, prefixed with `/prd`. That's where the value lives — pmstack on YOUR signals, not the tutorial one."

## Hard rules

- **Wait for explicit user advance between every step.** Do not run all 7 steps without pausing.
- **Tutorial artifacts go under `outputs/onboarding-tutorial/`**, not `outputs/` directly. Otherwise the user's real workspace gets polluted.
- **If a referenced example file is missing**, fall back to a one-paragraph in-line description and tell the user "the bundled example wasn't found at <path>; you can compare against your own output instead."
- **Surface-aware:** in web/desktop mode, emit artifact contents inline as markdown blocks rather than writing files. The user copies them.

## Success criteria (used by e2e test)

- Each step prints, the user advances, the next step prints. (No batch run.)
- After step 7, `outputs/onboarding-tutorial/` contains at least 8 artifacts (or, in web mode, 8 inline markdown blocks were emitted).
- Final recap table is printed.

## Anti-patterns

- Don't run all steps automatically — the value of the tutorial is the runnable practice.
- Don't write tutorial artifacts to the root `outputs/` directory.
- Don't skip the comparison-to-gold-example references — that's how users learn what good looks like.
