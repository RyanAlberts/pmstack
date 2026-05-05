# pmstack and Anthropic's eval framework

pmstack implements the framework Anthropic published in
[Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
(Anthropic Engineering, January 2026) as PM-runnable commands. The
article is the canonical reference. This page is the cheat sheet that
maps it to the slash commands.

You don't need to read the full article before shipping. Run the
commands; the artifacts they produce teach the vocabulary inline. Come
back to the article when you want to understand *why* a step exists.

---

## The vocabulary

| Term | One-line definition |
|---|---|
| **task** | One test with defined inputs and a success criterion. |
| **trial** | One attempt at a task. Models are non-deterministic — we run multiple trials per task. (pmstack default: `n_trials = 5`.) |
| **grader** | Logic that scores some part of the agent's output. Three flavors: **code** (deterministic), **model** (LLM-as-judge), **human** (SME). |
| **transcript** | Full record of one trial — outputs, tool calls, reasoning, intermediate state. (a.k.a. trace, trajectory.) |
| **outcome** | Final state of the environment at the end of the trial (e.g. did the refund actually post?), distinct from what the agent *said* it did. |
| **suite** | The full eval YAML — a collection of tasks measuring a capability or guarding a regression. |
| **harness** | The runner that executes the suite (in pmstack: `/run-eval`). |
| **purpose** | `capability` ("what can this agent do well?" — start at low pass-rate) or `regression` ("does it still handle what it used to?" — should sit near 100%). Capability suites graduate to regression once they pass consistently. |
| **pass@k** | Probability of ≥1 correct in k trials. Use when one success matters (a coding tool with retry). |
| **pass^k** | Probability of correct on every one of k trials. Use when consistency matters (customer-facing — every user expects it to work). |

---

## Anthropic's 8-step roadmap → pmstack commands

Anthropic's article structures eval-driven development as an 8-step
roadmap. Here's where pmstack lives:

| # | Anthropic step | What it means | pmstack command(s) |
|---|---|---|---|
| 0 | **Start early, start small** | 20–50 simple tasks drawn from real failures is a great start. Don't wait for the perfect suite. | `/vibe-test`, `/eval` |
| 1 | **Start with what you already test manually** | Bug tracker, support queue, pre-release manual checks. Convert each into a task. | `/vibe-test` |
| 2 | **Write unambiguous tasks with reference solutions** | Two domain experts → same pass/fail verdict. For P0 tasks, include a `reference_solution` (a known good output). | `/eval` (elicits `reference_solution:` for P0 tasks) |
| 3 | **Build balanced problem sets** | For every "should do X" case, include a "should NOT do X" case. One-sided evals create one-sided optimization. | `/eval` (elicits `negative_case: true` companions); `/vibe-test` (drafts both) |
| 4 | **Build a robust eval harness with stable environment** | Each trial runs from a clean state. Shared state can artificially inflate or correlate failures. | `/run-eval` (the runner; restarts state per trial) |
| 5 | **Design graders thoughtfully** | Prefer deterministic where possible; LLM where needed; human judiciously. Design graders to resist agents "winning unexpectedly." | `/eval` (per-metric `grader_type: code | model | human`) |
| 6 | **Check the transcripts** | "When a task fails, the transcript tells you whether the agent made a genuine mistake or whether your graders rejected a valid solution." | `/transcript-review` |
| 7 | **Monitor for capability eval saturation** | An eval at 100% tracks regressions but provides no signal for improvement. Capability evals graduate to regression suites. | `/eval-drift` (weekly drift watch); `/eval` (encourages splitting suites by `purpose`) |
| 8 | **Keep eval suites healthy long-term** | Open contribution + maintenance. Eval-driven development as routine PM work. | `/lint` (workspace audit); `/weekly` (changed-my-mind ritual) |

---

## The Swiss Cheese model

Anthropic's framing: no single evaluation layer catches every issue. The
holistic picture combines automated evals, production monitoring, A/B
testing, user feedback, manual transcript review, and systematic human
studies.

pmstack today is strongest on the **automated eval** layer and the
**transcript review** layer. The other layers — production monitoring,
A/B testing, systematic human studies — are deliberately out of pmstack's
scope for v0.6. They live in your observability tooling, your A/B
platform, and your research org. pmstack tries to be the part you can run
yourself as a PM, not the part that requires data engineering or
experimentation infrastructure.

| Layer | Anthropic calls it | pmstack covers it? |
|---|---|---|
| Automated evals (pre-launch + CI/CD) | First line of defense | ✓ `/eval`, `/run-eval`, `/eval-drift`, `/eval-self` |
| Manual transcript review | Builds intuition for failure modes | ✓ `/vibe-test`, `/transcript-review` |
| Production monitoring | Distribution drift, real-world failures | ✗ — use your observability stack |
| A/B testing | Validates significant changes | ✗ — use your experimentation platform |
| User feedback | Sparse, severe issues | ✗ — use your support / feedback tooling |
| Systematic human studies | Calibrating LLM graders, subjective tasks | ✗ — manual today; future `/grader-calibration` |

---

## Future work (Tier 3, deferred)

The article covers more than pmstack ships today. These are on the
backlog for future versions:

- **Trajectory grading** (tool-call sequence checks, state-checks,
  max-turn constraints) — engineering-deep; Tier 3.
- **Grader calibration as a skill** — sample N cases, run human + judge,
  compute agreement, write a memo when calibration drifts.
- **A/B test design + readout** — bridges pmstack and the experimentation
  platform.
- **Production-trace mining** — pull traces from observability into
  eval-task candidates.
- **Domain templates** — eval scaffolds tuned for coding agents,
  conversational agents, research agents, computer-use agents.
- **Eval-framework export** — emit suites compatible with Harbor,
  Braintrust, Langfuse, Phoenix for teams that need to run them at scale.

---

## Reading order if you want to go deeper

1. Anthropic's article: [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
2. The worked example: [`examples/walkthrough-code-review/`](../examples/walkthrough-code-review/) — a full week of eval artifacts produced by pmstack
3. The eval template: [`templates/eval-template.yaml`](../templates/eval-template.yaml) — vocabulary glossary in the header
4. Run it yourself: [`docs/run-eval-setup.md`](./run-eval-setup.md)
