# Policy requirements checklist

Use this list with the person who owns your company's rules for the agent (security, compliance, legal, or the support lead) to turn those rules into a policy file. Each item gives the question to ask, why it matters, and the rule type that writes it down. The last section covers requirements a rule can't check, and who checks them instead.

Rule names are shown as the plain label, then the name used in the policy file. Examples point to rules in `policy.json`, the worked policy for Northstar Internet (a made-up internet provider).

## How to run the session

1. Before the meeting, list the agent's tools and how often each one is called: `node bin/pmstack.mjs policy traces.jsonl --list-tools`.
2. Go down the list with the policy owner. Write each answer as a rule, with a `why` in their words.
3. Run the policy on your traces and review every violation together: is it a real problem, or a rule to fix?
4. Then read traces for problems no rule covers. The rules you forgot show up there.

## Requirements you can write as rules

### 1. Which tools the agent may use
- [ ] **Ask:** "Which tools may the agent call? What should happen when engineers add a new one?"
- **Why it matters:** A tool nobody listed is a change nobody reviewed.
- **Rule:** Only listed tools (`onlyListedTools: true`). For tools that must stay off even if someone lists them by mistake: Never use these tools (`deny-tools`).
- **Example:** `never-delete` blocks `delete_account` and `run_sql`.

### 2. Looking up versus changing
- [ ] **Ask:** "Which tools only read information, and which change something for the customer? Are some channels or situations read-only?"
- **Why it matters:** Mistakes in lookups annoy people; mistakes in changes cost money or trust.
- **Rule:** Mark each tool `"access": "read"` or `"write"`. To turn writes off in a situation: No write actions (`deny-access`, usually with `when`).
- **Example:** `no-writes-by-text` allows no account changes over text message.

### 3. Asking the customer before acting
- [ ] **Ask:** "Which actions need the customer's clear yes first? Which words count as yes?"
- **Why it matters:** An action the customer never agreed to is a complaint, and sometimes a legal problem.
- **Rule:** Ask before acting (`"confirm": true` on the tool, with `confirmationPatterns` for the words that count as yes).
- **Example:** every Northstar write tool has `confirm: true`.

### 4. Approval above a limit
- [ ] **Ask:** "Above what amount, quantity, or scope does a person have to approve? Which tool asks for approval?"
- **Why it matters:** Large actions need a second pair of eyes, and the approval should show in the record.
- **Rule:** Needs approval above a limit (`approval-above`, with `approvalTool`).
- **Example:** `credit-approval`: credits over $50 need `request_supervisor_approval` first.
- **Tip:** The rule counts an earlier approval call that did not fail. If your approval tool can answer "denied" as a normal result, ask your engineers to mark that as a failed call, so the rule can tell a request from an approval.

### 5. Hard limits on amounts and quantities
- [ ] **Ask:** "What is the most, and the least, the agent may ever give, change, or order, even with approval?"
- **Why it matters:** A typo or a confused agent should never produce a $2,000 credit.
- **Rule:** Stay under a limit (`arg-max`) and Stay above a limit (`arg-min`).
- **Example:** `credit-cap` (no credit above $200) and `credit-minimum` (no credit under $1).

### 6. Allowed values
- [ ] **Ask:** "Which fields accept only a fixed list of values, such as plan names, reason codes, or regions?"
- **Why it matters:** A made-up or outdated value can break billing or send a request to the wrong team.
- **Rule:** Only these values (`arg-in`).
- **Example:** `plan-names` allows only basic, plus, and gig.

### 7. Identity before access
- [ ] **Ask:** "What must happen before the agent reads or changes an account: an identity check, a signed-in session, a one-time code?"
- **Why it matters:** Reading an account for the wrong person is a data leak.
- **Rule:** Do this first (`requires-before`).
- **Example:** `verify-first` requires `verify_identity` before any account tool.

### 8. One customer's account only
- [ ] **Ask:** "Which account, organization, or workspace may the agent touch in a conversation? Where does that come from: the identity check, or the signed-in session?"
- **Why it matters:** An agent that can reach another customer's account turns one mistake into a breach.
- **Rule:** Must match (`arg-equals`), compared with a value from an earlier tool result (`source.tool`) or a detail on the trace (`source.detail`).
- **Example:** `same-account` (the account the customer verified) and `signed-in-account` (the signed-in account in web chat).

### 9. Sensitive data kept out of tools
- [ ] **Ask:** "What must never be passed to a tool: card numbers, government ID numbers, health information, passwords, access keys?"
- **Why it matters:** Tool calls are logged and often sent to other systems, so anything passed there spreads.
- **Rule:** Never include this pattern (`arg-not-match`). Leave out `argPath` to check every detail of every call, or set it to check one field.
- **Example:** `no-card-numbers`, `no-government-ids`, and `no-email-in-search`.

### 10. Channel and time restrictions
- [ ] **Ask:** "Are some actions allowed only on some channels (phone, chat, text), for some customers, or at some hours?"
- **Why it matters:** Some channels can't prove who is on the other end, and some actions need staff on hand.
- **Rule:** Add `when` to any rule, so it applies only where a detail on the trace has a given value. Time rules need a detail your logs add, such as `metadata.hours` set to `after-hours`.
- **Example:** `no-writes-by-text` applies only when `metadata.channel` is `sms`.

### 11. Call limits
- [ ] **Ask:** "How many times may the agent call each tool in one conversation?"
- **Why it matters:** Repeated calls usually mean a loop or a customer pushing for more, and each call may cost money.
- **Rule:** At most N times per conversation (`"maxPerTrace"` on the tool).
- **Example:** `issue_credit` allows one credit per conversation.

### 12. Fields every change must record
- [ ] **Ask:** "What must every change record for the audit trail: the account, a reason, a ticket number?"
- **Why it matters:** Auditors and support staff need to know why a change happened, not only that it did.
- **Rule:** Must include (`arg-required`).
- **Example:** `writes-name-account` requires `account_id` on every account change. A `reason` field works the same way.

### 13. Separation of duties
- [ ] **Ask:** "Which actions need someone other than the agent to approve them? Can the agent ever approve its own request?"
- **Why it matters:** An agent that can both ask for and grant an exception has no real limit.
- **Rule:** Never use these tools (`deny-tools`) on every tool that grants approval, plus Needs approval above a limit (`approval-above`) pointing at the tool that only asks.
- **Example:** the agent may call `request_supervisor_approval`, which only asks. A tool that grants approval, such as an `approve_credit` tool, would go in a `deny-tools` rule.

### 14. Actions that can't be undone
- [ ] **Ask:** "Which actions can't be reversed, such as cancelling, deleting, or sending money? Who must be involved?"
- **Why it matters:** A mistake you can't undo needs a person to catch it before it happens.
- **Rule:** Keep the tool off the list or in Never use these tools (`deny-tools`) so only staff can do it, or require a hand-off first with Do this first (`requires-before`). Always add Ask before acting (`confirm`).
- **Example:** `cancel_service` has `confirm: true`.

### 15. Logging
- [ ] **Ask:** "What must be logged for every tool call: the tool, its details, its result, whether it failed, who approved it?"
- **Why it matters:** A rule can only check what the trace records. A call missing from the log can't break any rule.
- **Rule:** None: this one is for your engineers. Rules read tool calls, results, and a failed status from your traces, so ask for all three. Must include (`arg-required`) checks that audit fields are present.

## Requirements a rule can't check

These depend on meaning, not on which tool was called with which details. Check them with an AI judge, a code check on the reply, a person, or your own systems.

| Requirement | Question to ask | Why it matters | Who checks it |
|---|---|---|---|
| Tone of a refusal | "When the agent says no, how should it sound, and what should it offer instead?" | A cold or vague refusal loses the customer even when the refusal is right. | An AI judge, built from traces your reviewer marked |
| Informed agreement | "What must the customer know before their yes counts?" | The Ask before acting rule sees the word yes, not whether the customer understood what they agreed to. | An AI judge |
| Consequences explained | "Before a cancellation or plan change, what must the agent say about fees, end dates, or lost discounts?" | A customer surprised by a fee calls back angry. | An AI judge, or a code check that the reply contains the required words |
| The right action for the request | "For each kind of request, which tools should the agent use?" | A call can be allowed and still be the wrong one. | Relevance: the intent map (`intents.json`) or the relevance judge |
| Reply matches the tool results | "What must the reply say after each action, and what must it never claim?" | A pending credit reported as done breaks trust without breaking any rule. | Output grounding: the two code checks, then the grounding judge |
| Instructions hidden in tool results | "What should the agent do when a document or tool result contains instructions?" | Text in an email, web page, or ticket can try to steer the agent. | An AI judge, plus a person reading flagged traces |
| Sensitive data in the reply | "What must never appear in what the customer sees?" | The rules above check tool calls, not replies. | A code check on the reply ("Text matches a pattern") |
| Required disclosures | "What must the agent always say: that it is an AI, that the call is recorded?" | Missing disclosures can be a legal problem. | A code check ("Text contains"), or an AI judge when wording varies |
| Limits across conversations | "Is there a limit per customer per month, or per day?" | A trace shows one conversation, so it can't count across them. | Your own systems, before the tool runs |
| Upset or at-risk customers | "When must the agent hand off to a person, whatever the customer asks for?" | Some situations need a person, and no tool call reveals them. | An AI judge, plus a person reviewing hand-offs |
