# Connect an eval to real work

An adapter connects the task to the system being tested and returns evidence in a form the evaluator can inspect. It must not replace a failed execution with a plausible answer.

Start with one task and one real attempt before running a suite. Use [the framework guide](eval-framework.md) to define the outcome and required evidence first.

For a runnable first step, use the [offline support simulation](../examples/eval-adapters/README.md). It includes working setup, target, and observer programs plus an intentionally false success claim that the observer rejects. No model account or external service is required; its results demonstrate the harness, not AI performance.

## Decide what is being tested

| Target | Required boundary | Evidence to retain |
| --- | --- | --- |
| Single-turn model | One request with the exact instructions and model settings. | Request, response, model identifier, and execution status. |
| Coding agent | A defined repository snapshot and tool environment. | Patch, available transcript, exit status, and results from evaluator-owned tests. |
| Support agent | A test account with known diagnostic state. | Messages, diagnostic calls, service state, and escalation or resolution record. |
| Chief-of-staff assistant | Test calendar, travel inventory, and explicit action permissions. | Proposed itinerary, approval state, and reservation or payment records. |
| Persistent teammate | Defined sessions with controlled shared memory and identities. | Session boundaries, available memory snapshots, and responses to changed context. |
| Research agent | A dated source collection or a recorded live retrieval session. | Search results, citations, retrieved evidence, and final synthesis. |

Treat the model and its agent harness as the target together. A model called directly through an API is not the same test as that model operating through a desktop agent's tools and memory.

## File handoff

For an existing Claude, Codex, or Grok session, give the agent a task packet containing the request, allowed context, constraints, and expected response format. Keep evaluator-only references separate. Save the actual response and whatever execution evidence the host exposes, then import those records for grading.

The user-supplied system name documents intent; it does not authenticate the producer. Retain a conversation or run reference when available. A pasted transcript can support response review, but a claim about external state requires a state record. “I booked it” is insufficient evidence of a reservation.

A file handoff does not imply a direct integration, unattended execution, or access to a private provider API. For Grok Bot memory tests, use separate sessions in the actual host. If the host cannot expose the necessary state, report that observation limit.

## Choose the execution format

There are two separate formats. The new JSON framework uses `bin/eval-harness.mjs` and a trusted adapter configuration. The older Python command below consumes its own YAML structure. Do not pass a JSON framework suite to the older command.

## JSON framework adapter contract

The framework commands are:

```sh
node bin/eval-harness.mjs validate suite.json
node bin/eval-harness.mjs run suite.json --adapter adapters.json --output new-run
node bin/eval-harness.mjs report new-run/run.json
```

`suite.json` is one suite, not the entire library array. Download one from the builder or select a single object from [the library](workspace/eval-library.json). Validation checks structure and references; it does not invoke the target.

Keep executable commands in a separate trusted `adapters.json`. A downloaded suite must not decide which programs run on your computer. Each configured command is an argument array, executed without a shell:

```json
{
  "target": { "command": ["/absolute/path/to/target-wrapper"], "timeoutMs": 60000 },
  "setup": { "command": ["/absolute/path/to/fixture-setup"], "timeoutMs": 60000 },
  "observe": { "command": ["/absolute/path/to/independent-observer"], "timeoutMs": 60000 },
  "graders": {
    "your-grader-id": { "command": ["/absolute/path/to/review-wrapper"], "timeoutMs": 60000 }
  }
}
```

These paths illustrate the configuration shape. Replace them with programs you own and have reviewed. `setup`, `observe`, and `graders` are optional in configuration, but outcome checks need an observer and subjective checks need their configured reviewer. Relative command paths beginning with `./` resolve from the adapter configuration's directory.

The target receives public task fields, environment context, trial information, and a workspace through JSON on standard input. It does not receive the reference outcome or grader definitions. Return JSON with `output` and `transcript` on standard output. Keep diagnostics on standard error so they do not corrupt the response.

The setup program prepares fixture state. The independent observer returns `{ "outcome": { ... } }` based on actual state after the target runs. A configured grader returns `{ "score": 0.0, "reason": "Evidence for this judgment" }`, using a score from zero to one, or `{ "status": "unknown" }` when it cannot judge. The adapter must connect a model or human reviewer honestly; a hard-coded passing result is not a completed review.

The target's input fields are `task`, `environment`, `workspace`, and `trial`. The public task includes `id`, `name`, `prompt`, `context`, and `successCriteria`. The observer also receives the returned `output` and `transcript`. Grader programs receive the rubric, reference, and captured evidence so they can review the attempt; the target does not receive those evaluator-only fields. All stages run from the trial's working directory.

The new output directory contains one JSON record per trial, an aggregate `run.json`, and `report.md`. An existing output directory is refused. `run` and `report` exit with code 1 when the decision is failed or incomplete; command or input errors exit with code 2. `validate` can return success with review warnings, so read its issues as well as its exit code.

Per-trial directories separate ordinary files. They are **not an operating-system sandbox**: programs can retain the host's permissions and access other resources. Use an appropriate external test environment for untrusted code or consequential actions. For `session-sequence` tasks, the adapter must perform the specified session transitions within each trial; the task label alone cannot reset a provider's memory.

Missing observation leaves outcome grading unknown. Missing model or human review leaves those grades unknown. Setup, target, observer, and grader errors must remain distinguishable in the resulting records. Inspect the report and its per-trial evidence before making a release decision.

## Legacy Python runner

The repository's [Python runner](../bin/run-eval.py) currently supports three target types. Its detailed configuration is in [the setup guide](run-eval-setup.md).

| Type | What the current runner invokes | Important limit |
| --- | --- | --- |
| `claude-session` | The local `claude` command with a selected model and prompt. | This does not automatically reproduce another host's saved memory or tools. |
| `http` | A configured HTTP endpoint with a request template. | Confirm the response path and retain state evidence separately when the response alone is insufficient. |
| `script` | An executable receiving the task input. | The wrapper must supply the real target interaction and environment you intend to evaluate. |

The current runner expects `test_cases`, invokes each selected case once, and provides limited built-in grading. The broader [evaluation template](../templates/eval-template.yaml) describes repeated trials and `tasks`; those descriptions are not proof that the current runner implements them. Do not assume a new framework packet can run through the legacy command without an explicit conversion.

Plan-only output is not executed evidence. A missing judge leaves subjective measures ungraded. The runner's token estimate is not a measured provider bill or a hard dollar cap.

## What an execution adapter must preserve

Keep the task ID, trial ID, target configuration, start and end status, supplied instructions, and observable transcript connected. Record the initial and final state needed by the outcome grader. Version or identify the environment so another person can distinguish a target regression from a changed fixture.

Use explicit states for executed, errored, and not run. Grading adds its own result: passed, failed, or unknown. A failed invocation and a successfully executed but wrong answer call for different action.

For a coding task, the target can modify its assigned repository. The independent test client and expected results belong to the evaluator. For a booking task, use a test service; a successful test must not purchase a real ticket. Preserve task-specific permission boundaries in the adapter.

## Verify the adapter before trusting its results

Run a known valid attempt and a known invalid attempt through the same evidence path. Confirm that the grader distinguishes them. Then simulate an unavailable target and confirm the record shows an execution error rather than a score.

Check the actual external effect when the task requires one. A support resolution should be verified against the service or ticket state. A cross-session preference should be tested after the intended reset, not merely recalled from the current conversation.

Do not claim an adapter is verified from documentation or a generated configuration alone. Record which system was invoked, which task was attempted, what evidence returned, and which checks remain manual.

## Cost and credentials

File preparation and local checks do not themselves purchase model access. Actual runs use the selected host's subscription or provider billing, plus any tools it invokes. Estimate the number of tasks, trials, target calls, and judge calls before execution. Verify provider pricing and account access before quoting a cost.

Keep credentials in the host or local environment, outside shareable task files. Export the task, configuration references, and evidence needed for review without publishing secrets.
