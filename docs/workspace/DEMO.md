# Show the craft of defining success

Begin with the framework, not a result. Every library item is an illustrative example. The offline execution demonstrates the harness using a deterministic simulation, not a commercial agent benchmark.

## A 90-second walkthrough

| Time | Show | Explain |
| --- | --- | --- |
| 0–15 seconds | The framework screen | “The PM defines what success means. A task becomes a trial, produces a transcript and an outcome, and is assessed by graders.” |
| 15–30 seconds | The example library, then chief-of-staff flight template | “This is an example, not a flight-booking product. The same framework supports coding, support, research, and long-running teammates.” |
| 30–45 seconds | Task and environment | “Define the customer value, constraints, approval boundaries, and context. Reset between trials while preserving intended memory within a session sequence.” |
| 45–60 seconds | Graders and reference check | “The reservation must exist in the observed state. Saying ‘done’ cannot pass. Reference checks test the grading rule; they are not agent trials.” |
| 60–75 seconds | Trial plan | “Balance action with restraint. Run repeated trials, inspect case slices, and do not hide critical failures inside an average.” |
| 75–90 seconds | Imported offline claim-only run | “The simulated target claimed success. The observer found the job still stalled. Now we can diagnose the failure and know what to change.” |

Use the [offline quickstart](../../examples/eval-adapters/README.md) to generate actual harness records. Import its claim-only run into the studio, or use “Inspect a recorded simulation” on the Run and learn page. Explain that the target is simulated and the state checks actually executed.

## LinkedIn draft

The PM's most important contribution to an AI product is defining success.

What should an agent produce? Under which conditions? What evidence proves the work happened? And how do we know a failed test reflects the agent, rather than our own broken evaluation?

I rebuilt pmstack around those questions, using Anthropic's agent evaluation taxonomy as the foundation.

The studio explains the framework first. Then it helps you define tasks, environments, references, graders, case mixes, and repeated trials for your own system. Examples cover coding, customer support, research, flight booking, and teammates with memory.

One demo target says “resolved” without fixing the problem. The independent state check fails it. That distinction is the point.

The demo is a labeled simulation, not a model benchmark. You can replace it with your own target using the same harness.

Try it: [pmstack evaluation studio](https://ryanalberts.github.io/pmstack/workspace/).

Draft only. Nothing has been posted.

## Shareable assets

The [visual walkthrough](walkthrough.mp4) sequences actual studio screens and the labeled offline example. The [preview image](preview.png) shows the framework-first entry point. These are teaching assets, not claims about agent reliability.
