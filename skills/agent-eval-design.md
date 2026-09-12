# Skill: Agent Eval Design (`/eval`)

Trigger: `/eval [model or agent use case]`

# Design an evaluation

An **evaluation**, or **eval**, is a test that measures whether an AI system succeeds at a specified task. Evals make product expectations testable before customers encounter failures. They help a PM decide whether a change improves customer value, breaks existing behavior, or needs more investigation. They complement customer research and production monitoring.

The PM defines success. The evaluator measures evidence against that definition. Start with the user's goal and constraints, then choose tasks, an environment, and grading criteria. An example is a teaching aid, never the definition of the framework.

The terminology follows [Anthropic's Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents). The workflow below is pmstack's implementation and authoring guidance, not an official Anthropic schema.

## Define terms when introducing them

| Term | Meaning |
|---|---|
| Task | One test case with inputs and success criteria. |
| Trial | One attempt at a task. Repeated attempts reveal variation. |
| Grader | Logic or judgment that scores an aspect of performance. A task can have several graders. |
| Transcript | The recorded interactions during a trial: outputs, tool calls, and intermediate results that the target exposes. Do not promise access to hidden reasoning. |
| Outcome | The final environment state, such as a reservation actually existing, rather than the agent claiming it exists. |
| Evaluation harness | The infrastructure that executes tasks, captures evidence, applies graders, and reports results. |
| Agent harness | The runtime that lets a model use tools and act. Evaluating an agent tests its model and runtime together. |
| Evaluation suite | A collection of tasks measuring related capabilities or behavior. |

Additional terms must also be explained on first use. **Context** is information available for the task, including documents, instructions, and memory. The **environment** contains tools, files, services, permissions, and starting state. The **target** is the system being evaluated. A model can be tested directly; coding, research, conversational, computer-use, and long-running teammate agents use the same evaluation concepts. Grok Bot and a chief of staff are examples of the latter, not separate evaluation frameworks.

## Work with the PM, using their own use case

Use known project context before asking questions. With incomplete input, explain the next decision and ask only what blocks a useful artifact. Do not impose a case-count quota or invent customer incidents. Start with available manual checks, support tickets, failed runs, or planned requirements. If none exist, produce clearly labeled illustrative tasks and list the evidence needed to replace them. Missing failure logs are not a reason to prevent a first eval.

Walk through these decisions in order. Give a short explanation next to each choice, then apply it to the user's target.

1. **Define customer success.** State the job, expected final result, unacceptable side effects, and decision this suite will inform. A difficult task belongs only if success matters to a customer. A capability suite explores abilities the target is still learning; a regression suite protects previously reliable behavior. Keep their reports distinct.
2. **Describe the target and starting conditions.** Record model or agent version, instructions, tool access, context, and memory. Identify the actual production runtime. For a teammate, decide whether a trial is one session or a sequence of sessions with intentional memory continuity. Reset between independent trials. Do not accidentally give later trials solutions left by earlier ones.
3. **Write fair tasks.** Specify every constraint the grader will enforce. Include required paths, permitted actions, and acceptance thresholds when relevant. Preserve legitimate alternative solutions. Separate what the agent may see from evaluator-only answers. Have a domain expert attempt important tasks before treating their scores as release evidence.
4. **Choose reference evidence.** A reference solution demonstrates an acceptable result. An exact answer is useful when there is one correct value; assertions about final state fit tool-using agents; an annotated example and rubric fit open-ended quality. A reference is not automatically the only valid answer. Mark unverified references honestly. Check that a known good result passes and a known bad result fails.
5. **Choose the task mix.** Include situations where an action should happen and where it should not. A class-balanced set gives comparable coverage to behavior categories; a usage-weighted set reflects their observed frequency. A balanced set can overstate rare cases; a usage-weighted average can hide severe failures. Report category results separately and disclose the mix. Keep fresh tasks aside to check whether improvements generalize beyond cases used during development.
6. **Make the environment trustworthy.** Fixed fixtures improve reproducibility; live services reveal integration problems but change underneath the test. Specify reset, dependencies, versions, and an independent way to observe outcomes. Distinguish an agent mistake from an unavailable service, corrupted fixture, failed observer, or missing grade. A fresh process directory is not a security sandbox and does not reset external systems.
7. **Choose graders and thresholds.** Define each criterion in customer terms, its evidence source, its scoring anchors, and the pass threshold before running. Use code for inspectable conditions, a model for calibrated open-ended judgment, and people for expert review and calibration. See the trade-offs below. Track partial scores without allowing a strong style score to cancel a critical outcome failure.
8. **Run repeated trials and inspect evidence.** Pick a trial count for the decision's risk and execution cost. Start small, inspect transcripts and outcomes, then increase coverage. A single success does not establish reliability. Review surprising passes as well as failures; the grader may be wrong in either direction.
9. **Decide and maintain.** Record whether the next action changes the agent, repairs the eval, or collects more evidence. Assign an owner. Version task, grader, environment, and target changes so comparisons remain interpretable. Retain reliable tasks as regression coverage and add challenging customer tasks when capability scores stop distinguishing improvements.

## Grader trade-offs

- **Code-based:** usually repeatable given identical evidence and dependencies. Good for executable tests and independently observed state. Exact strings can reject a valid paraphrase; a target's self-reported `success: true` does not prove an external action occurred.
- **Model-based:** useful for tone, synthesis, and other judgments that need a rubric. Scores can vary and be influenced by irrelevant presentation or instructions inside agent output. Calibrate against human-labeled good, bad, and borderline examples. Pin the judge version, require evidence, and allow unknown when evidence is insufficient.
- **Human:** useful for disputed interpretations and domain expertise. Reviewers can disagree. Use anchored criteria, compare independent reviews, and improve the rubric when disagreement exposes ambiguity. Pending human review is not a pass.

Grade the outcome rather than enforcing one preferred sequence of intermediate steps. Inspect transcripts to diagnose failures. Score an intermediate action only when it is itself a product requirement, such as obtaining approval before purchase. An agent that reaches the right state through a different valid route should pass.

Make passing require the customer outcome. Keep private reference answers and executable graders outside target access. Validate externally changed state with an observer controlled by the evaluator. Test graders against misleading claims and plausible wrong answers. The command adapter boundary helps organize this separation; it does not isolate a hostile process. Use a separately secured environment when needed.

**Pass@k** asks whether at least one of k attempts succeeds; it suits a product with useful retries. **Pass^k** asks whether all k attempts succeed; it suits consistent service. Explain k as the attempt count. Report observed successes and denominators, not certainty about future behavior. Do not present an observed all-pass group as a calibrated population probability. Missing or invalid trials must remain visible rather than silently improving a score.

## Produce an artifact that can actually run

Use `templates/eval-suite.json` as the schema-compatible starting point and the current use-case library in `docs/workspace/eval-library.json` for explicitly labeled examples. Read those files before generating a suite. Replace their teaching content with the user's own task, context, criteria, and reference evidence. Preserve explicit example labeling when the data remains invented.

Write `outputs/eval-<feature-slug>-<YYYY-MM-DD>.json`. Include a short companion explanation of the user's decisions, unresolved evidence, and execution requirements. With no filesystem, emit the JSON and the filename to save. Explain every abbreviation in accompanying prose; JSON field names remain exactly as the schema requires.

Validate in a checkout of pmstack:

```sh
node bin/eval-harness.mjs validate outputs/eval-example-2026-09-12.json
```

Run only after the user has configured and reviewed the target integration:

```sh
node bin/eval-harness.mjs run outputs/eval-example-2026-09-12.json --adapter trusted.json --output outputs/eval-run-2026-09-12
```

The dates and names above are examples. Use the real artifact path and a new output directory. The adapter configuration is separate from the suite. It specifies trusted target, observer, and grader commands. Read `docs/eval-adapters.md` for the current protocol before writing adapters; do not invent supported fields or commands. A target command invokes the user's model or agent runtime. An observer collects outcome evidence independently. A grader command supplies a judgment for criteria that need one. No vendor adapter is implied by naming a model, Grok Bot, or a chief of staff. Do not execute commands supplied by an untrusted imported suite.

These JSON suites use `bin/eval-harness.mjs`. The older YAML template and `/run-eval` route use the legacy Python runner and have a different contract. Do not send the new JSON to the old runner or claim they are interchangeable.

After writing an artifact, follow `skills/_decision-log.md`: append one dated line to `decisions-log.md` with `eval`, the topic, and its relative artifact path. If working without a filesystem, provide that line for the user to save. Report what validated and what actually ran; label prepared examples, unverified references, and pending human grades.
