# Verification record

Verified September 12, 2026 for the general evaluation framework rebuild.

## Automated checks

`node --test evals/*.test.mjs` passed **49 tests**: 26 checks for the new evaluation harness, including nested stage-failure cases, and 23 existing work-review checks. `python3 evals/eval-report-test.py` passed 20 existing report checks. JavaScript syntax and `git diff --check` passed.

The new harness tests cover strict schemas, reference validity, required unknown judgments, code checks, critical failures, balanced and weighted aggregates, repeated trials, isolated working directories, independent observation, external graders, malformed output, size limits, timeouts, stage errors, and forged imported pass claims. Saved labels cannot override freshly computed grades. These tests do not establish the validity of a customer's chosen rubric.

## Browser checks

Playwright exercised the actual local studio:

- Open the framework and clearly labeled library; choose the chief-of-staff example.
- Edit a custom evaluation from a blank suite and export it. The CLI accepted the exported suite.
- Add a human grader, check reference evidence, and reject an unsupported completion claim as unresolved.
- Load the recorded simulation and inspect its 50% failing result.
- Import run evidence through the file picker.
- Record a human judgment: an otherwise passing trial changed from unknown to pass.
- Download the reviewed JSON run and a Markdown report containing a failure diagnosis and next experiment.
- Reload and retain the authored suite. Run records and review notes require download; they are not persisted in browser storage.
- Check mobile layouts at 390 pixels. The results view initially overflowed; the action layout was corrected and rechecked at exactly 390 pixels of page width.

The preview and seven-state visual walkthrough were captured from the rebuilt interface. The video sequences actual screens; it is not a live model execution recording.

## Actual harness execution

The [offline adapter example](../../examples/eval-adapters/README.md) was run again from the CLI after integration:

| Configuration | Result | Exit code |
| --- | --- | --- |
| Working deterministic simulation | 6 passing trials | 0 |
| Claim-only deterministic simulation | 3 passing and 3 failing trials | 1 |

The observer checks persisted export and escalation state. The claim-only target's assertion of success does not satisfy the outcome checks.

[sample-run.json](sample-run.json) contains the recorded claim-only execution used by the studio. Its suite display name identifies the example; local workspace paths were removed and the adapter path made repository-relative for sharing. Trial evidence remains unchanged. The record is unsigned, and the UI recomputes its grades on load.

No live commercial model, Grok Bot deployment, production customer system, or flight-booking service was evaluated for this rebuild. Adapters must connect those targets and establish trustworthy state observation. Temporary directories are not an operating-system sandbox.
