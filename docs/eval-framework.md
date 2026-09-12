# Design an eval around the customer's outcome

Start with the responsibility you want to give the AI. Then describe what evidence would justify giving it that responsibility.

“Can it book this trip within the approved budget?” is a useful starting question. “How intelligent is it?” does not tell you what to test, which mistakes matter, or what to change after a failure.

## The shared vocabulary

The core vocabulary follows [Anthropic's agent evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), published January 9, 2026:

| Term | Meaning |
| --- | --- |
| Task | One situation with inputs and criteria for success. |
| Trial | One attempt at that task. |
| Grader | A check of some part of an attempt. |
| Transcript | The observable record: messages, tool calls, results, and intermediate events. |
| Outcome | The state left after the attempt. A claimed booking and an existing reservation are different evidence. |
| Agent harness | The software that lets a model use context and tools to do work. |
| Eval harness | The software that sets up trials, runs the target, captures evidence, and grades results. |
| Suite | Related tasks grouped to answer a product question. |

The guide distinguishes code, model, and human graders; capability tests explore new ability, while regression tests protect established behavior. It recommends inspecting transcripts, checking graders, and maintaining suites. The design exercises below apply that vocabulary to PM decisions; they are illustrative guidance, not results from the article or guarantees about a named agent.

## Turn a product question into an observable task

Write the task as a short contract:

- **Customer value:** What can the person accomplish if this works?
- **Starting state:** What information, permissions, tools, and saved context exist?
- **Request:** What will the user ask, including constraints?
- **Acceptable outcome:** What state or response would satisfy the request?
- **Unacceptable outcome:** What must not happen, even if other parts look good?
- **Evidence:** Which records can prove the difference?
- **Decision:** What would you change after seeing a failure?

For a flight assistant, “find a good flight” becomes “present a refundable flight arriving before the meeting, within the budget, without purchasing before approval.” A reference outcome names an itinerary that meets those constraints and leaves the reservation system unchanged. A convincing paragraph is not proof that the fare is refundable.

For a coding agent, “build an MCP server” becomes “a clean client can discover and call the requested tool, receive the specified data, and recover from malformed input.” MCP means Model Context Protocol, a way for an agent to discover and use tools. Test the server from a separate client; the agent's own test output is supporting evidence, not the entire verdict.

## Choose graders for the evidence you have

| Grader | Concrete use | What can go wrong | How to challenge it |
| --- | --- | --- | --- |
| Code | Query a test booking store for an unauthorized reservation; compare a returned total with fixture data. | A check can read the wrong account or accept an empty result as success. | Insert a known forbidden reservation and verify failure; test a valid alternative itinerary. |
| Model | Compare a troubleshooting explanation with the supplied diagnostic evidence. | Fluent unsupported advice can receive a high grade; wording can influence the judge. | Include a polished wrong answer, a plain correct answer, and an answer that asks the judge to ignore its rules. |
| Human | Decide whether a research brief fairly represents conflicting sources. | Reviewers may apply different product policies or see different context. | Have reviewers judge the same examples independently, explain disagreements, and revise unclear criteria. |

A model grader needs its own versioned rubric and examples reviewed by people. Using a different model from the target does not establish independence or correctness. Separate evidence checks from judgments about usefulness. If a grader lacks the required evidence, its result is unknown, not a pass.

Keep each check narrow enough to diagnose. “Was the trip good?” hides budget, dates, approval, and comfort in one answer. Record those separately. A failed permission boundary should remain visible even when the explanation is excellent.

Mark tasks with a non-negotiable boundary as critical. In the framework, a known failed critical task blocks a passing suite decision even when the average clears its threshold. Missing required grades or invalid trials still make the decision incomplete; they never establish that a critical boundary held.

## Build examples that can expose a shortcut

Pair an expected action with a neighboring situation where that action would be wrong. A support assistant should restart a service when diagnostics justify it, but should preserve an active transaction and escalate when a restart could lose work. This checks whether the assistant uses the relevant distinction instead of repeating a stock fix.

A **reference solution** demonstrates an acceptable outcome. It is not necessarily the one sequence of steps the target must follow. Include a second valid solution when several approaches are acceptable, then confirm both pass. Also include a plausible wrong solution and confirm it fails. Until the reference has been executed or reviewed under the actual setup, label it proposed.

Check whether a target could pass without delivering the customer value: printing “booked” without a reservation, citing an article that does not support the claim, or altering the tests instead of fixing the server. Prefer evidence collected by the evaluator from the resulting state. Keep the evaluator's reference and checks out of the target's writable workspace when running a test.

## Cover behavior without confusing coverage and prevalence

A small design suite can deliberately include equal numbers of “act” and “do not act” cases. That makes a blind spot easier to see. It does not mean the two situations occur equally often in production.

Keep realistic frequency estimates separate from deliberate challenge cases. If you report a production-weighted result, retain the source of each weight and the unweighted case results. A rare but consequential failure deserves its own decision rule, even when its contribution to an average is small.

Use **capability** cases for responsibilities you are considering adding. Use **regression** cases for behavior users already depend on. A case can move into the regression set after the team accepts its behavior, while harder variants remain in the capability set. Preserve both sets when testing a change.

## Make trials comparable

Record the target model, agent harness, instructions, tools, permissions, dataset version, grader version, and initial environment. Reset the environment between independent trials. If a tool depends on changing data, use a dated snapshot for comparisons and a separate live check for freshness.

Report how many attempts were planned, completed, failed to execute, and remained ungraded. A rerun that passes does not erase the first failure. Do not hide failed setup behind a model-quality score.

Decide whether the product allows retries. A user reviewing several candidate drafts has a different experience from an agent making an irreversible action once. Keep individual trial outcomes visible before choosing an aggregate measure. Label the estimator and its assumptions; do not label one observed success as a reliability probability.

## Test memory across sessions deliberately

One long conversation does not establish cross-session memory. Define the exact boundary: end the first session, start a fresh one, and identify which persistent store is intentionally shared.

Use four separate cases:

1. Retain a stable preference the user explicitly asked to save.
2. Apply a later correction instead of the old preference.
3. Refresh a changing fact such as flight availability instead of treating remembered information as current.
4. Keep one person's preferences out of another person's session.

Seed only the intended memory. Record the saved state before and after each session, using the host's supported inspection mechanism where available. If you cannot inspect or control the memory boundary, describe the result as a black-box behavioral observation. Do not claim you proved how memory works.

Grok Bot is one possible target for this kind of test. Its name does not make a prepared transcript a live memory evaluation. [Adapter guidance](eval-adapters.md) explains the evidence boundary.

## Diagnose before changing the agent

| Observation | First question | Useful next step |
| --- | --- | --- |
| The action failed because the test service was unavailable. | Did the environment prevent a valid attempt? | Repair setup and preserve the execution error. |
| A valid itinerary was rejected. | Did the grader require one arbitrary route? | Add the valid alternative to calibration examples. |
| Reviewers disagree on whether to escalate. | Is the product policy ambiguous? | Settle the policy and version the criterion. |
| A reservation exists without approval. | Did the target cross the stated boundary? | Fix the behavior and retest approved and unapproved cases. |
| The test passes but users remain blocked. | Does the outcome check miss the actual job? | Observe the user journey and revise the task. |

The **product loop** changes behavior and tests the result. The **evaluator loop** changes a flawed measurement and tests whether it now judges cases fairly. Keep those changes separate in the report. A higher score after relaxing a grader is not evidence of a better agent.

## Make the result useful to the team

End with the product decision, affected users, remaining uncertainty, and next experiment. Link each claim to the task and trial evidence. Tests inform a decision; customer research and production outcomes still determine whether the product creates value.

The proposed 40% PM evaluation practice is a role philosophy, not a validated allocation. Spend the time learning what customers need and how the system behaves. Let tools handle repeatable setup and bookkeeping.

## Choose an illustrative starting point

The [example library](workspace/eval-library.json) contains seven suites: a coding tool, support troubleshooting, flight assistance, cross-session teammate memory, research, single-turn extraction, and a browser expense draft. Each defines concrete inputs, acceptable outcomes, challenging cases, and checks. They are starting designs with proposed references, not live test results or external service implementations.

Use the relevant example to learn the structure, then replace its fictional context with your own controlled evidence. Inspect the reference checks before connecting a target. A reference matching its code checks establishes internal consistency only; subjective reference judgments remain pending until reviewed.
