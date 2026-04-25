# Decision-log auto-append (shared snippet)

After writing the artifact, append one line to `decisions-log.md` at the project root:

```
- YYYY-MM-DD — <skill>: <topic> — <relative-artifact-path>
```

Examples:
```
- 2026-04-25 — prd: trial onboarding overwhelm — outputs/prd-trial-onboarding-2026-04-25.md
- 2026-04-25 — eval: Claude Ultraplan — outputs/eval-claude-ultraplan-2026-04-25.yaml
- 2026-04-25 — compare: Cursor vs Windsurf — outputs/compare-cursor-windsurf-2026-04-25-plan.md
```

If `decisions-log.md` doesn't exist, create it with a one-line H1 header (`# Decisions log`) and then append.

**Why:** future skill invocations (especially `/sprint` and follow-up calls) read this log to know what's already been decided. Without it, each skill runs stateless and re-asks the same questions.

**Hard rule:** one line per artifact. Do not paste the artifact content here. Just topic + path + date.
