# A real agent handoff, with a limited claim

On September 12, 2026, the exported standard-v2 instructions were sent to the installed Claude Code CLI. Tools were disabled, and only the prepared customer evidence was supplied. The response recommended investigating the critical data-loss incident rather than prioritizing dark mode.

The [instructions](agent-instructions.md), [original decision JSON](claude-response.json), and [review packet](review.json) reproduce that handoff. Customer conversations are fictional teaching data. This is one execution smoke test, not a benchmark or evidence that a lesson improved the model.

```sh
node bin/work-review.mjs check examples/work-review/review.json
node bin/work-review.mjs brief examples/work-review/review.json
```

The check reports four factual checks passed, one human judgment unresolved, and exits 1. That is the expected result. No PM acceptance has been manufactured for the example.

To reproduce the file contract using your existing Claude Code installation:

```sh
node bin/work-review.mjs prompt examples/work-review/standard-v2.json week-two > agent-instructions.md
claude -p --safe-mode --tools '' --no-session-persistence \
  --system-prompt 'Analyze only the supplied evidence. Return only valid JSON matching the requested decision structure. No markdown fences or prefatory prose.' \
  < agent-instructions.md > decision.json
node bin/work-review.mjs import examples/work-review/standard-v2.json week-two decision.json \
  --system 'My Claude Code run' --output my-review.json
node bin/work-review.mjs check my-review.json
```

The flags above were verified against the installed CLI. Other hosts can read the same instructions and return the same JSON structure. No Grok Bot execution was tested.

An earlier formatting probe returned Markdown around the JSON. The importer deliberately rejected that format. Save the JSON object itself, or explicitly request raw JSON from your host. The final standard-v2 run returned valid JSON without manual editing.

COST: approximately $0.46 in CLI-reported API-equivalent usage across two probes; payment: existing Claude account. This is not an invoice or confirmation of additional charges. The static browser and local checks make no paid API calls.

The source labels also contain a review opportunity: one customer name appears with different segments. The code counts supplied customer names; a PM must confirm whether they identify the same customer. Passing counts cannot establish source authenticity or the correct product priority.
