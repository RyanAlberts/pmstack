# Golden examples — pmstack reference outputs

Anchor outputs each pmstack skill should match or beat. Used by humans (to see "what good looks like") and by `/eval-self` (to ground the regression check in real artifacts).

The numerical regression baseline lives at [`evals/golden/baseline.json`](../../evals/golden/baseline.json) — that's what the runner scores against. This directory holds the human-readable artifact examples per skill.

## What's here today

| Skill | Golden artifact | Why it's golden |
|---|---|---|
| `/eval` | [outputs/eval-claude-ultraplan-2026-04-24.yaml](../../outputs/eval-claude-ultraplan-2026-04-24.yaml) | First worked example. 10 capabilities, 12 failure modes, 13 metrics, 15 test cases with severities. Demonstrates the full template structure. |
| `/competitive` | (none yet) | Add the first one that scores 4.5+ on the self-eval and you'd take to a launch review. |
| `/prd` | (none yet) | Add the first one that an exec would actually approve without revision. |
| `/metrics` | (none yet) | Add the first one where every metric has a real instrumentation source. |
| `/brief` | (none yet) | Add the first one ≤400 words that scores 4.5+ on audience fit. |
| `/compare` | (none yet) | Add the first multi-product comparison where the dimensions came from the products, not the priors. |
| `/run-eval` | (none yet — output is a run dir, not a single artifact) | Score baseline lives in `evals/golden/baseline.json`. |

## How to add a golden

1. Generate a candidate output via the skill in real use.
2. Verify it manually — would you ship it as-is to a stakeholder?
3. Run it through `/eval-self --skill <name>` and confirm the score is at least 4.5/5.
4. Either copy the file here under `examples/golden/<skill>/<topic>.md` or — if it's already in `outputs/` — link it from this README.
5. If the new golden raises the bar, run `python3 evals/regression-check.py <result.json> --update` to lock the new baseline.

## What this prevents

Without goldens, every skill change is a vibe check. With goldens:
- A model upgrade that subtly degrades skill output gets caught
- A prompt edit that helps one case and hurts three gets caught
- A new contributor's "improvement" gets graded against the bar that's already been reached
