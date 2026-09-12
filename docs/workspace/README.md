# The evaluation studio

The studio teaches the evaluation framework before introducing any example. Its first screen explains why evals exist and the relationship among task, trial, transcript, outcome, grader, and harness.

## Open locally

From the repository root:

```sh
python3 -m http.server 4173 --directory docs
```

Open [the studio](http://localhost:4173/workspace/). Use a web server rather than opening the HTML file directly. The app loads JavaScript modules and the [example library](eval-library.json).

## Author your own suite

Choose **Define my evaluation** to begin with your customer and target. A model and an agent use the same basic framework; an agent adds a runtime, tools, state, and possibly memory. The guidance changes with the selected target type.

Use the numbered steps to write tasks, supply context and reference evidence, choose an environment strategy, add graders, and plan trials. You can edit every field in an example. **New suite** opens a blank draft after confirmation. **Import** accepts a saved suite or harness run.

The case library is explicitly illustrative. Its proposed references establish an intended result, not a successful live execution. Browser reference checks exercise the same code-grading logic as the terminal, while subjective reference judgments stay unresolved.

**Export suite** saves portable JSON. Incomplete drafts can also be downloaded, but the harness refuses structurally incomplete evaluations. Valid JSON and a clean design checklist do not establish customer value or grader fairness.

## Execute and review

The browser never executes adapter commands or makes target calls. Follow [the adapter guide](../eval-adapters.md) or begin with the [offline executable example](../../examples/eval-adapters/README.md).

On **Run and learn**, import the resulting `run.json`. The viewer recomputes grades from supplied evidence and keeps errors, unknowns, and missing trials visible. Imported evidence is not independently authenticated.

Expand a trial to inspect its output, observed outcome, graders, and transcript. **Record human grade** appears when the task includes a human grader. It records an explicit score and reason, without overriding failed code checks or infrastructure errors. Save the reviewed run to preserve those grades.

**Diagnose this trial** records whether the likely issue belongs to the agent, task, grader, environment, or missing evidence. The diagnosis appears in the downloadable report and does not alter original grades. Download the report before leaving the page to preserve these session notes.

## Storage and cost

Draft edits save in this browser when storage is available. Export important work separately. Run evidence and review notes remain in the current page until downloaded; they are not a hosted database.

No accounts, credentials, or provider connections are created by the page. The static studio and offline example incur no API charges. A real target or model grader uses the account and billing configured by its adapter.

See [the framework guide](../eval-framework.md) for the underlying PM decisions and [verification notes](VERIFICATION.md) for what was tested.
