# PRD: AI-Powered Support Triage

## 1. Problem Statement
- **What is the problem?** Support agents spend 30% of their time manually categorizing and routing incoming tickets.
- **Who is experiencing it?** Tier 1 Support Agents.
- **Why solve it now?** Ticket volume is growing 15% MoM, and we are missing our 2-hour initial response SLA on 40% of tickets.

## 2. Proposed Solution
- **High-level description:** An LLM-based service that reads incoming tickets, predicts the category, urgency, and best-fit team, and automatically routes the ticket.
- **Value proposition:** Reduces manual triage time to zero, improving SLA compliance and agent satisfaction.

## 3. Key Features (MoSCoW)
- **Must Have:** Auto-categorization (Billing, Tech, Account), Urgency prediction (Low, Med, High), Auto-routing to correct queue.
- **Should Have:** Suggested initial response draft for the agent.
- **Could Have:** Confidence score visible to the agent.
- **Won't Have:** Fully automated replies to the customer (human-in-the-loop only for V1).

## 4. User Experience / Flow
- **Step-by-step flow:** 
  1. Customer submits ticket.
  2. System processes ticket in background (<5s).
  3. Ticket appears in the correct agent queue with tags applied.
- **Key states:** If confidence is <80%, route to a "Needs Manual Triage" queue.

## 5. Success Metrics
- **North Star Metric:** % of tickets correctly routed on the first try (Target: >85%).
- **Supporting Metrics:** Average time to initial response (Target: <2 hours).
- **Counter Metrics:** % of tickets re-routed by agents (Target: <10%).

## 6. Open Questions / Risks
- **Technical risks:** Latency of the LLM call delaying ticket creation.
- **Business risks:** Incorrect routing of high-urgency Enterprise tickets.
- **Open decisions:** Which model to use (Claude 3.5 Haiku vs Sonnet) for the optimal cost/latency/accuracy tradeoff.
