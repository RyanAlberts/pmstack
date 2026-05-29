# Example inputs gallery

Every pmstack capability with a runnable example input. Copy any block, paste into Claude Code (or Claude.ai with the skills installed), get a real artifact back.

If you don't have a real customer signal of your own yet, **steal one of these to start** — they're realistic, varied across domains, and produce non-trivial outputs.

---

## Translation skills (signal → spec)

### `/voc` — synthesize a pile of signals into ranked problems

The step *before* `/prd`. Paste a stack of raw feedback; get themes scored by frequency × severity × fit and the top-3 PRD-ready problems. This 15-signal set is the bundled walkthrough fixture — notice the most-*frequent* theme (noisy comments) is **not** the winner, and the rarest theme (missed security) is the silent killer.

```
/voc
1. Churn interview: "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason."
2. Churn interview, Northwind: "We're paying for review automation but our devs wait a full day for the first pass. They've gone back to pinging each other on Slack. We didn't renew."
3. NPS verbatim (detractor, 3): "The reviews are fine when they show up. The problem is they don't show up fast enough to matter."
4. Support ticket #5120: "The bot leaves 40 comments on a 20-line PR. My team mutes it."
5. App review (3 stars): "Half the comments are nitpicks about formatting our linter already catches."
6. Interview, mid-market: "It comments on everything equally — a typo and a real logic bug get the same treatment. I can't tell what's urgent."
7. Support ticket #5188: "Can we turn off the style comments? They drown the useful ones."
8. Slack complaint via CSM: "Devs are starting to ignore the bot because 9 of 10 comments are noise."
9. Churn-risk flag, Acme (Enterprise, $180k ARR): "Their security team found the bot approved a PR that introduced a SQL injection. They've paused rollout pending a trust review."
10. Interview, fintech customer: "It's great at style but it missed a hardcoded secret last week. A missed security issue is worse than ten missed style nits."
11. Support ticket #5044: "The GitHub check randomly shows pending for hours and blocks our merge queue."
12. Sales-call note (prospect, lost): "They liked the reviews but the CI status would hang and block merges. Dealbreaker."
13. Interview, platform team: "On anything over ~800 lines it just summarizes the first file and gives up."
14. Support ticket #5201: "Big refactor PRs get a useless 2-line review. Small PRs are great."
15. App review (4 stars): "Love it for small PRs. For our monorepo's big changes it's basically silent."
```

**Variations to try:**
- Attach a CSV/markdown export of support tickets instead of pasting.
- `/voc --from-folder outputs/transcripts/` to synthesize a folder of interview notes.

**Output:** `outputs/voc-<topic>-<date>.md` — theme table + top-3 PRD-ready problems + sampling-bias note.

**Reference:** [examples/walkthrough-code-review/voc-code-review-2026-05-04.md](../walkthrough-code-review/voc-code-review-2026-05-04.md)

---

### `/prd` — turn a signal into a PRD

```
/prd "Three of our biggest enterprise customers said code reviews are taking 24+ hours and devs are skipping them or merging without review. Two churned this quarter and named slow review as a top reason."
```

**Variations to try:**

- A support-ticket signal:
  ```
  /prd "Support ticket #4421: 'Every time we onboard a new agent it takes 3 days for them to learn our routing rules. Half quit before they're productive.'"
  ```

- An exec ask:
  ```
  /prd "CEO at Monday QBR: 'Why are we losing deals to Cursor on the AI-first IDE story? Our agent is better.' Build the PM response."
  ```

- A churn quote:
  ```
  /prd "Churn interview, Acme Corp: 'We loved the product but our security team flagged 17 issues with how the agent stores conversation history. We didn't have time to wait for the fix.'"
  ```

**Output:** `outputs/prd-<topic>-<date>.md` (full 6-section PRD).

**Reference:** [examples/walkthrough-code-review/prd-code-review-2026-05-05.md](../walkthrough-code-review/prd-code-review-2026-05-05.md)

---

### `/competitive` — scan a market

```
/competitive "AI code review tools"
```

**Variations:**
- `/competitive "AI customer-support agents for e-commerce"`
- `/competitive "developer-facing observability tools with AI features"`
- `/competitive "low-code workflow builders that target operations teams"`

**Output:** `outputs/competitive-<market>-<date>.md` (3–5 players, positioning, white-space).

**Reference:** [examples/walkthrough-code-review/competitive-ai-code-review-2026-05-05.md](../walkthrough-code-review/competitive-ai-code-review-2026-05-05.md)

---

### `/compare` — side-by-side two or more products

```
/compare "GitHub Copilot Code Review" "CodeRabbit"
```

**Variations:**
- `/compare "Cursor" "Windsurf" "Zed"`
- `/compare "Claude" "GPT-4" "Gemini" "Llama"` (for a model-pick decision)

**Output:** `outputs/compare-<a>-vs-<b>-<date>-plan.md` PLUS an executable eval YAML (`outputs/compare-...-eval.yaml`) you can run with `/run-eval`.

**Reference:** [examples/walkthrough-compare-tools/](../walkthrough-compare-tools/)

---

## Spec-tightening skills

### `/metrics` — design a measurement framework

```
/metrics "AI code review feature — measure whether it's actually speeding up reviews without missing bugs"
```

**Variations:**
- `/metrics "the recommendation engine on our product page"`
- `/metrics "support agent triage speed"`

**Output:** `outputs/metrics-<topic>-<date>.md` (North Star, 2–3 supporting, 1–2 counter-metrics, instrumentation plan).

**Reference:** [examples/walkthrough-code-review/metrics-code-review-2026-05-06.md](../walkthrough-code-review/metrics-code-review-2026-05-06.md)

---

### `/premortem` — stress-test a draft PRD

```
/premortem prd-code-review
```

(The slug must match an existing PRD file in `outputs/`. Run `/prd` first if you don't have one.)

**Variations:**
- `/premortem prd-trial-onboarding`
- `/premortem outputs/prd-support-routing-2026-04-25.md` (full path)

**Output:** `outputs/premortem-<topic>-<date>.md` plus a confirmation gate to mutate the source PRD's Risks section.

**Reference:** [examples/walkthrough-code-review/premortem-code-review-2026-05-05.md](../walkthrough-code-review/premortem-code-review-2026-05-05.md)

---

## Eval skills (the AI-PM-specific ones)

### `/eval` — design a test suite for an AI feature

```
/eval "AI code review service — first-pass review with severity tags"
```

**Variations:**
- `/eval "support chatbot for an e-commerce site"`
- `/eval "an agent that schedules customer meetings end-to-end"`

**Output:** `outputs/eval-<topic>-<date>.yaml` (capabilities, failure modes, metrics, test cases).

**Reference:** [outputs/eval-claude-ultraplan-2026-04-24.yaml](../../outputs/eval-claude-ultraplan-2026-04-24.yaml) and [examples/walkthrough-code-review/eval-code-review-2026-05-06.yaml](../walkthrough-code-review/eval-code-review-2026-05-06.yaml)

---

### `/run-eval` — actually run the eval

```
/run-eval outputs/eval-code-review-2026-05-06.yaml
```

**Output:** `outputs/eval-runs/<run-id>/summary.md` (pass-rates, top failures, metrics table, cost).

**Reference:** [examples/walkthrough-code-review/eval-runs/code-review-eval-2026-05-06/summary.md](../walkthrough-code-review/eval-runs/code-review-eval-2026-05-06/summary.md)

---

### `/eval-self` — run pmstack against itself

```
/eval-self --skill prd
```

(Or `/eval-self` with no args to run the full suite. Costs ~$5–10 in tokens for the full run.)

**Output:** `evals/results/<timestamp>_<model>.json` plus a summary table.

---

## Routine skills (the new five — schedulable)

### `/eval-drift` — weekly drift watch

```
/eval-drift
```

Or schedule it: `/loop 7d /eval-drift`.

**Output:** `outputs/eval-drift-<date>.md` with `RELEASE_BLOCKED: true|false` flag.

**Reference:** [examples/walkthrough-code-review/eval-drift-2026-05-12.md](../walkthrough-code-review/eval-drift-2026-05-12.md)

---

### `/weekly` — Monday self-snapshot

```
/weekly
```

Or schedule it: `/loop 7d /weekly`.

**Output:** `outputs/weekly-<YYYY-Www>.md` with three sections: Decisions made, Open loops aging, One thing I changed my mind about.

**Reference:** [examples/walkthrough-code-review/weekly-2026-W19.md](../walkthrough-code-review/weekly-2026-W19.md)

---

### `/launch-readiness` — pre-launch verifier

```
/launch-readiness code-review
```

**Output:** `outputs/launch-readiness-<feature>-<date>.md` with verdict (GO/NO-GO/CONDITIONAL) and 7-item evidence checklist.

**Reference:** [examples/walkthrough-code-review/launch-readiness-code-review-2026-05-09.md](../walkthrough-code-review/launch-readiness-code-review-2026-05-09.md)

---

### `/lint` — workspace audit

```
/lint
```

Or schedule it: `/loop 7d /lint`.

**Output:** `outputs/lint-<date>.md` with three sections: Graph gaps, Cross-artifact drift, Stale candidates.

**Reference:** [examples/walkthrough-code-review/lint-2026-05-08.md](../walkthrough-code-review/lint-2026-05-08.md)

---

### `/premortem` — see above (in spec-tightening section)

---

## Stakeholder + orchestrator skills

### `/brief` — stakeholder readout

```
/brief code-review exec
```

(Audiences: `exec`, `engineering`, `customer`, `board`, `self`.)

**Output:** `outputs/brief-<topic>-<audience>-<date>.md`.

**Reference:** [examples/walkthrough-code-review/brief-code-review-exec-2026-05-09.md](../walkthrough-code-review/brief-code-review-exec-2026-05-09.md)

---

### `/sprint` — orchestrate prd → metrics → eval → brief

```
/sprint "Three of our biggest customers said code reviews are taking 24+ hours and devs are skipping them."
```

**Output:** four artifacts in sequence — PRD, metrics, eval YAML, brief — with confirmation gates between each.

---

### `/onboarding` — interactive tutorial

```
/onboarding
```

Walks through every capability above using the bundled walkthrough. Recommended for first-time users.

---

## How to use this gallery

1. **Pick the skill that matches the problem in front of you.**
2. **Steal an example from this file** — copy the input, replace one or two words to match your context.
3. **Run it.** Read the output. Compare to the reference artifact.
4. **Iterate** — refine the input, ask Claude follow-ups about the artifact, edit it.

If you produce a great artifact you'd be willing to share, [open a PR](https://github.com/RyanAlberts/pmstack/pulls) adding it under `examples/`.
