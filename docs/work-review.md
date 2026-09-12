# Review an AI teammate's customer feedback brief

Use pmstack to check whether a customer problem recommendation follows the evidence. The agent produces the work. You decide whether its judgment is good enough, and preserve useful corrections for the next run.

The reusable artifact is a **Customer problem decision**: a recommendation with supporting conversations, contradictory evidence, customer counts, and an explanation of severity. The point is to make a better product decision when the next batch of feedback arrives.

## Three parts of the workflow

An **evaluation**, or eval, is a repeatable check of behavior against an explicit expectation. Counting distinct customers is a check a program can perform. Deciding whether an urgent problem deserves priority still requires judgment.

A **skill** gives an agent instructions for a job. An **acceptance harness** checks the resulting work and records whether expectations were met. A **managed loop** also runs the job repeatedly and follows up on failures. This workflow supplies the acceptance checks and portable records. Your existing agent produces the work; this command does not schedule or operate it.

The [browser workspace](workspace/index.html) and the command below use the same [decision engine](workspace/decision-engine.mjs). Projects are JSON files, a plain text data format, so you can move your work between them.

## Try the file handoff

Use Node.js to run these commands from the repository root. No additional packages are required. Start with a project exported from the browser workspace. The included [sample project](workspace/demo-data.json) provides teaching examples; its contents are not measured commercial-model results.

For a first run, copy the sample project and generate the prompt for its first batch:

```sh
cp docs/workspace/demo-data.json my-project.json
node bin/work-review.mjs prompt my-project.json week-one > review-prompt.txt
```

For your own project, use its exported file and a batch ID from its `batches` list.

Open the prompt in your existing Claude, Codex, or Grok session. Ask the agent to follow it and return the requested JSON decision. Use the actual response from that session, without editing it to match an answer key. Save the returned JSON as `decision.json`.

For an agent with file access, ask it to read `review-prompt.txt` and write its decision to `decision.json`. For a chat interface, paste the prompt, then copy the returned JSON into that file. This is a file handoff, not a direct integration with any named provider. Keep the session or conversation reference alongside your work if you need independent provenance.

Import the response into a new project file. Name the system you actually used:

```sh
node bin/work-review.mjs import my-project.json week-one decision.json \
  --system "Actual agent and model used" --output reviewed-project.json
```

Import records a supplied response. A system name is a user-provided label, not proof of which model produced it. The command requires `--output` and refuses to overwrite an existing file or the input project.

The prompt specifies this response structure:

```json
{
  "decision": {
    "recommendation": "The customer problem to address next",
    "problemId": "a-problem-id-from-the-batch",
    "rationale": "Why the evidence supports this choice",
    "counts": [{ "problemId": "a-problem-id-from-the-batch", "messages": 3, "customers": 2 }],
    "supportingIds": ["a-conversation-id-from-the-batch"],
    "counterevidenceIds": ["a-contradictory-conversation-id"],
    "severityNote": "Explain impact, including severe low-volume problems"
  }
}
```

Those values illustrate the structure. Use the IDs and evidence from your actual batch, and include the counts requested by the generated prompt.

## Check the decision and review what remains

```sh
node bin/work-review.mjs check reviewed-project.json
node bin/work-review.mjs brief reviewed-project.json > customer-problem-decision.md
```

Both commands use the active run by default. Add a run ID to select an earlier result:

```sh
node bin/work-review.mjs check reviewed-project.json RUN_ID
node bin/work-review.mjs brief reviewed-project.json RUN_ID
```

`check` prints JSON with individual checks and their status. Its process exit code is:

| Code | Meaning |
| --- | --- |
| `0` | The engine reports the run as accepted. |
| `1` | The run needs work, needs review, or uses stale expectations. |
| `2` | The command, project, decision, or selected run is invalid. Read the error on standard error. |

A check marked `unknown` is unresolved. Passing mechanical checks does not establish that the recommendation is sound. Inspect the evidence and complete the human review in the browser workspace. Acceptance applies to this record and its expectations; it is not a general claim about an agent's reliability.

## Make a correction useful next time

Import the project into the browser workspace, review the result, and record a specific lesson with its reason. For example: “Show distinct customers separately from message volume. One customer's repeated messages must remain visible as one customer.”

Review the proposed expectation before accepting it. A correction should explain the decision you want improved, not silently prescribe which problem must always win. Accepting a lesson changes the expectation version, so previous work needs review against the new version.

Export the updated project. Generate a new prompt and obtain a new agent response for both the original batch and a separate batch the agent has not already solved in this exercise. Keep the inputs fixed when comparing runs. New examples test whether the correction helps beyond the original case; they do not prove general reliability.

Show the resulting Customer problem decision to the people who own the product choice. Keep contradictory evidence and unresolved checks visible when sharing it.

## Continue with existing pmstack commands

The [voice-of-customer skill](../skills/voice-of-customer.md) helps identify problems in feedback. The [evaluation design skill](../skills/agent-eval-design.md) defines broader test suites, and [transcript review](../skills/transcript-review.md) helps distinguish agent mistakes from problems in grading or task instructions.

For automated target execution, follow the separate [evaluation runner setup](run-eval-setup.md). Its target and grading configuration are separate from this file-based decision review.

Spending 40% of PM time evaluating AI work is a chosen operating philosophy, not a measured industry benchmark. Use recurring reviews to improve decisions and reduce repeated corrections. Time spent clicking through a queue is not the outcome.

## Share the learning

Share a redacted Customer problem decision showing the initial mistake, the accepted correction, and what happened on new evidence. Include the reusable project file when its contents are safe to share. Readers can run the same job with their own agent and customer evidence.

Keep prepared examples labeled as samples. For real runs, identify the actual system used and preserve the source response. A before-and-after story should show the underlying evidence, not imply that a higher score alone proves a better product decision.

**COST: $0.00 in API calls from this command; payment: none.** Your external agent session may use an existing subscription or incur provider charges. Review its cost before running the job. The commands do not create accounts, store credentials, or publish your artifacts.
