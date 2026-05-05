# Default routines — e2e test plan

This document describes the end-to-end test for the five default routines (`/eval-drift`, `/premortem`, `/weekly`, `/launch-readiness`, `/lint`) and the `/onboarding` tutorial.

## What runs today

`evals/routines-e2e.py` is a stdlib-only Python script that validates the **bundled walkthrough artifacts** in `examples/walkthrough-code-review/` against the success criteria defined in each routine's command file (`.claude/commands/<routine>.md`).

```bash
python3 evals/routines-e2e.py
```

The script is self-contained — no API tokens, no live Claude invocations — and is suitable for CI. It catches:

- Routine command + skill packaging (both forms ship for each routine)
- Skill graph (`skills/_graph.yaml`) declares edges for every routine
- Each routine's required artifact structure (sections, headers, flags)
- Anti-pattern violations (e.g., `/eval-drift` must not contain "likely cause" prose)
- Cross-artifact references (premortem cites PRD, launch-readiness cites priors, etc.)
- `decisions-log.md` contains entries for every routine in the realistic week

Exit code 0 = all green; non-zero = at least one check failed. The output table shows which routine and which contract was violated.

## Scenario the test models

The bundled walkthrough simulates one PM's week working on an "AI code review" feature. The exact scenario from the synthesis test plan:

| Day | Date | Event | Artifact produced |
|---|---|---|---|
| 1 (Mon) | 2026-05-05 | Customer signal arrives → /prd | `prd-code-review-2026-05-05.md` |
| 1 (Mon) | 2026-05-05 | Market scan → /competitive | `competitive-ai-code-review-2026-05-05.md` |
| 1 (Mon) | 2026-05-05 | Stress-test → /premortem | `premortem-code-review-2026-05-05.md` (mutates PRD's Risks) |
| 2 (Tue) | 2026-05-06 | /metrics + /eval | `metrics-code-review-2026-05-06.md`, `eval-code-review-2026-05-06.yaml` |
| 3 (Wed) | 2026-05-07 | /run-eval | `eval-runs/code-review-eval-2026-05-06/summary.md` |
| 4 (Thu) | 2026-05-08 | /lint | `lint-2026-05-08.md` |
| 5 (Fri) | 2026-05-09 | /launch-readiness + /brief | `launch-readiness-code-review-2026-05-09.md` (CONDITIONAL with override), `brief-code-review-exec-2026-05-09.md` |
| 8 (Mon next) | 2026-05-12 | Scheduled /weekly + /eval-drift | `weekly-2026-W19.md`, `eval-drift-2026-05-12.md` (BASELINE form) |

Each artifact references the prior ones. The test verifies that.

## Per-routine success criteria checked

### `/eval-drift`
- Artifact exists at expected path
- Header contains `RELEASE_BLOCKED:` flag
- First-run shows `BASELINE: this is run 1` marker
- No causal-hypothesis prose (regex against "likely cause/due to/because")
- `SCOPE:` declared in header

### `/premortem`
- Artifact exists
- Exactly 3 failure stories
- Each has Leading indicator + Mitigation fields
- Rejected mitigations section present (confirmation-gate evidence)
- PRD anchor in header
- Source PRD shows the mutation (`## Risks (added by /premortem ...)`)

### `/weekly`
- Artifact exists
- Exactly 3 named sections (Decisions made / Open loops aging / One thing I changed my mind about)
- No shipped/accomplishments section (anti-vanity rule)
- Open loops cite real file paths
- Changed-my-mind field is non-empty

### `/launch-readiness`
- Artifact exists
- Single-line verdict (GO|NO-GO|CONDITIONAL)
- All 7 checklist rows present (one per evidence item)
- Acknowledged-gap section (the example demonstrates the override path)
- Verdict reasoning section

### `/lint`
- Artifact exists
- All 3 sections present (Graph gaps / Cross-artifact drift / Stale candidates)
- Every finding has a "Do this:" action line (no pure observations)
- FINDINGS count in header

### `decisions-log.md`
- File exists with `# Decisions log` header
- Contains entries for every skill+routine that ran in the scenario week

## What the test does NOT do (yet)

- **Live invocation.** The script does not run `claude -p` against the actual command files. Future extension: a `--live` mode that invokes each routine in a temp directory with a planted set of inputs and verifies the live output matches the structural contract.
- **Planted-regression test for `/eval-drift`.** The bundled example covers the BASELINE first-run case; a future test should plant a deliberate regression (e.g., a broken golden case) and verify the routine flips `RELEASE_BLOCKED: true` and writes a release-blocker brief.
- **Token-cost check for live runs.** When `--live` lands, it should report budget consumed.

## Adding a new routine

To add a sixth (or seventh) default routine to pmstack:

1. Write `.claude/commands/<routine>.md` and `claude-skills/pmstack-<routine>/SKILL.md`.
2. Add the routine to `skills/_graph.yaml` (both `edges:` and `default_routines:` blocks).
3. Add a representative artifact to `examples/walkthrough-code-review/`.
4. Add `check_<routine>()` to `evals/routines-e2e.py` and call it from `main()`.
5. Update this document's table.

## CI integration

Add to your CI:

```yaml
- name: pmstack routines e2e
  run: python3 evals/routines-e2e.py
```

Runs in <1 second. Adds zero token cost.

## Live-mode hooks (planned)

When `--live` lands, the test will:
1. Create a temp directory.
2. Plant a known PRD, metrics, eval YAML.
3. For each routine, invoke `claude -p '/routine ...'`.
4. Verify the resulting artifact passes the same structural checks the static mode runs.
5. Tear down the temp directory.

This is the layer that catches behavioral regressions in the routine prompts themselves (e.g., the model starts hallucinating causal hypotheses in `/eval-drift`). Until then, structural mode catches contract regressions in the bundled examples and gives 80% of the value at 0% of the cost.
