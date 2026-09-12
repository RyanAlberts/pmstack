# Run an eval without an account or model

This offline example teaches the complete harness: create fixture state, execute a target, observe the resulting state, and grade it. The target is a **deterministic simulation of a support agent**. It is not a live AI evaluation or model benchmark.

Two tasks distinguish a safe fix from an unsafe shortcut. A stale lock can be cleared and the export retried. An active transaction must be preserved and escalated instead. Each task runs three times in fresh fixture directories.

## Run the working simulation

From the repository root, with Node.js installed:

```sh
node bin/eval-harness.mjs validate examples/eval-adapters/suite.json

node bin/eval-harness.mjs run examples/eval-adapters/suite.json \
  --adapter examples/eval-adapters/adapters.json \
  --output /tmp/pmstack-support-working

node bin/eval-harness.mjs report /tmp/pmstack-support-working/run.json
```

Choose a new output directory if that path already exists. The runner refuses to overwrite a previous run.

Expected result: six passing trials and an exit code of zero. The observer confirms that the safe recovery wrote the correct export, and that the unsafe case preserved the active transaction and created an escalation ticket. Both cases also check the permission boundary.

## Prove that a success claim is insufficient

The second configuration adds `--claim-only` to the same simulated target. In the safe-recovery case it says the export is resolved but leaves the job stalled and creates no file. It still handles the escalation case normally.

```sh
node bin/eval-harness.mjs run examples/eval-adapters/suite.json \
  --adapter examples/eval-adapters/adapters-claim-only.json \
  --output /tmp/pmstack-support-claim-only

node bin/eval-harness.mjs report /tmp/pmstack-support-claim-only/run.json
```

Expected result: three failed recovery trials, three passing escalation trials, and exit code **1** from both commands. This failure is intentional. Open a `safe-recovery-1.json` trial record: the target's `output` claims success, while the observer's `outcome.resolution.confirmed` is false. The file and job state determine the grade.

## Follow the evidence

| File | Responsibility |
| --- | --- |
| [suite.json](suite.json) | Public task context, reference outcomes, and two required code checks per task. |
| [adapters.json](adapters.json) | Trusted setup, target, and observer commands. Commands stay outside the suite. |
| [setup.mjs](setup.mjs) | Creates `state.json` in the trial directory from the public fictional fixture. |
| [simulated-target.mjs](simulated-target.mjs) | Reads diagnostics, follows the fixture policy, and writes an export or escalation. |
| [observe.mjs](observe.mjs) | Reads persisted files and compares protected rows with the original fixture. It does not grade the target's success claim. |
| [adapters-claim-only.json](adapters-claim-only.json) | Selects the intentionally misleading response mode. |

The target receives the public request and context, never the reference or grader definitions. Relative script paths resolve from the adapter file's directory. Each trial record includes its workspace path so you can inspect `state.json`, `export.json`, or `escalation.json` directly.

The observer is a separate process, but these local files are not tamper-proof. The target and observer share host permissions. A malicious program could edit audit state; use a separate protected service or evaluator-owned environment when your real threat model requires it. A temporary working directory is not an operating-system sandbox.

## Replace the simulation when ready

Keep the task and observer contract, then replace the target adapter with your actual system. Preserve the setup and observer boundaries, and collect the actual transcript. Do not rename the simulator after a commercial model and present its deterministic results as that model's performance.

These checks establish specific fixture outcomes. They do not evaluate conversational quality, empathy, general troubleshooting, or live customer results. Repeated simulation trials verify the harness path; they do not estimate AI reliability.

Read the [framework guide](../../docs/eval-framework.md) and [adapter contract](../../docs/eval-adapters.md) before extending the example.

**COST: $0.00 in API calls; payment: none.** The included scripts use local files only and require no added packages, credentials, or services.
