---
name: pmstack-prd
description: Turn a raw customer signal (quote, support ticket, feature request, exec ask) into a structured Product Requirements Document. Use when a PM mentions a customer quote and wants a spec, when "let's write a PRD" comes up, when a vague feature request needs scoping, or when the user asks for a problem statement, MoSCoW prioritization, success metrics, or PRD template.
---

# PRD from Signal

Transform a single customer signal into a PRD draft. The PRD is shareable with eng and exec.

## Required structure

1. **Problem Statement** — what is the problem, who experiences it, why solve now (business impact / urgency)
2. **Proposed Solution** — high-level description and value proposition
3. **Key Features (MoSCoW)** — Must / Should / Could / Won't, each specific (not "must work well")
4. **User Experience / Flow** — step-by-step, including empty / loading / error / success states
5. **Success Metrics** — North Star + 2-3 supporting + 1-2 counter-metrics
6. **Open Questions / Risks** — technical, business, unresolved decisions

## Hard rules
- Extract the *underlying* problem, not just restate the surface ask
- MoSCoW must be specific — concrete features, not adjectives
- Always include North Star + supporting + counter-metric (the counter-metric is what tells you the optimization went too far)
- Active voice. State confidence levels instead of hedging.

## Where to write
- With filesystem: `outputs/prd-<topic-slug>-<YYYY-MM-DD>.md`
- Inline (web/mobile): emit as markdown with the suggested filename at the top

## Tone
Clear, concise, customer-centric. Lead with the customer problem, not the technology.
