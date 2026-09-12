# Verification record

Verified September 12, 2026 before publication.

## Automated checks

```sh
node --test evals/*.test.mjs
node --check docs/workspace/app.mjs
python3 evals/eval-report-test.py
git diff --check
```

Results: 23 Node tests and 20 existing report checks passed. The JavaScript syntax and whitespace checks passed. No application build or package install is required.

The tests cover source counts, citations, omitted contradictory evidence, severe incidents, unknown evidence, changed standards, import validation, Markdown escaping, and the actual CLI's commands and exit codes. Missing human review never passes the acceptance gate.

## Browser checks

Playwright exercised the rendered application at desktop and 390-pixel mobile widths:

- Open source evidence and reveal source-derived counts.
- Accept a lesson and inspect the new standard.
- Review the revised decision and record an acceptance.
- Reject acceptance when the new-week example omits severity.
- Reject an empty review reason without mutating the decision.
- Replace a revision request with an acceptance when factual checks pass.
- Add a custom evidence batch and download its prompt.
- Import a workspace and an actual agent response.
- Reload the page and retain the imported response.
- Download a decision brief and reset the prepared example.

The mobile decision and handoff views had no horizontal page overflow. The screenshots and visual walkthrough were generated from actual browser states. The walkthrough sequences prepared examples; it is not a model execution recording.

## Real execution

The [Claude handoff example](../../examples/work-review/README.md) preserves the prompt, response, and review packet. Its four factual checks pass. Human judgment remains unresolved. One earlier output-format failure is documented separately from the final valid JSON response.

This verifies a file handoff and limited checks. It does not establish improvement over a baseline, unattended operation, a Grok integration, customer demand, or a productivity multiple.
