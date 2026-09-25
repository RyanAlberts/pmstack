# Output grounding judge template

An AI judge prompt for the output grounding question: **Does the reply match what the tool returned?** No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call. The judge reads one trace, writes a short critique, then answers Pass or Fail for this one failure mode.

## How to use this template

1. **Confirm the failure in your own traces first.** Read traces where the agent used tools and compare each reply with the tool results. Note where the reply said something the tools never returned. Build this judge only if that keeps happening.
2. **Add the two free code checks first.** "Every number in the reply comes from a tool" flags amounts, times, dates, and confirmation numbers that no tool returned. "Claims success after a failed or pending call" flags "done" after an error or a pending result. Read what they flag and tune them. Use this judge for what exact matching misses: reworded facts, dropped conditions, and left-out information.
3. **Fill the placeholders** in the prompt below:

| Placeholder | Fill with | Northstar example |
|---|---|---|
| `{{product}}` | Your product's name and what it does, in one line | Northstar Internet's support agent, which helps customers with bills, outage credits, plan changes, cancellations, and technician visits |
| `{{user}}` | Your word for the person using it | customer |
| `{{definition}}` | Your failure mode's definition | The default below |
| `{{examples}}` | 2 to 4 examples you already judged | See "Pick the examples" |
| `{{trace}}` | The trace to judge | Filled in for each trace |

4. **Give the judge the tool results and the reply,** plus what the customer said so it knows what was asked. When traces are long, leave out the agent's instructions and the steps before the last request.
5. **Pin an exact model version**, for example `claude-haiku-4-5-20251001`, so the judge doesn't change under you.
6. **Test it against your own labels before you trust it.** Run it on your tuning set, read every disagreement, then fix the prompt or your label. Stop when it catches real failures and agrees on good traces at 90% or better each (80% at the least). Then run the final test once. `/pmstack:test-judge` walks you through it.

In Eval Studio, the Checks tab builds this prompt for you: Tool call checks, Output grounding, "Use the AI judge template". Use this file when you run judges in your own tools.

**Default definition** for `{{definition}}` (swap in your word for customer, and leave out a leading "Fails when": the prompt already says it):

> The reply to the customer states something the tool results do not back up: a value that differs from what a tool returned, a fact no tool returned, a pending or partial result described as final, a failed or unapproved action described as done, or tool information left out that changes what the customer should do next.

## Pick the examples

- **Only from traces set aside as examples.** Never use traces from your tuning set or final test: a judge that has seen the answers scores itself too well.
- **One clear fail, one clear pass, one close call.** Two to four in total.
- **Clear fail:** a reply that plainly contradicts a tool result. A credit waiting for approval reported as applied is the classic case.
- **Clear pass:** a reply that restates the tool results correctly in friendly words, with every condition kept.
- **Close call:** a trace you hesitated on, often one where the reply leaves something out. Decide, then write down why. This is where the judge learns where your line is.
- **Mix the kinds of mistakes:** a wrong value, a dropped condition, a claim of success after an error. A judge that only sees one kind looks for only that kind.
- **Write each critique so a new teammate would understand it**, one to three sentences that quote the reply and the tool result, with the critique before the result.

A filled `{{examples}}` block for Northstar, in the format pmstack uses:

```text
<example number="1">
<trace>
[Customer] The outage took us down for two days. Can I get a credit?
[Tool call verify_identity] {"phone": "555-0187", "zip": "97214"}
[Tool result] {"status": "ok", "account_id": "A-1182"}
[Assistant] I'm sorry about the outage. I can put in an $80 credit for the two days. Shall I go ahead?
[Customer] yes please
[Tool call issue_credit] {"account_id": "A-1182", "amount": 80}
[Tool result] {"status": "pending_approval", "amount": 80}
[Assistant] Done! $80 is off your next bill.
</trace>
Critique: issue_credit returned pending_approval, so the $80 credit is waiting for a supervisor. The reply says it is done and already off the next bill. It should say the credit is requested and pending approval.
Result: Fail
</example>

<example number="2">
<trace>
[Customer] My connection keeps dropping. Can someone come out Tuesday afternoon?
[Tool call verify_identity] {"phone": "555-0119", "zip": "97211"}
[Tool result] {"status": "ok", "account_id": "A-4471"}
[Assistant] I can book a technician for Tuesday, September 29, between 1 and 5 PM. Does that work?
[Customer] that works
[Tool call schedule_technician] {"account_id": "A-4471", "date": "2026-09-29", "window": "13:00-17:00"}
[Tool result] {"status": "scheduled", "date": "2026-09-29", "window": "1:00 PM to 5:00 PM", "confirmation": "TV-40817"}
[Assistant] You're booked: a technician will come Tuesday, September 29, between 1 and 5 PM. Your confirmation number is TV-40817.
</trace>
Critique: The date, the time window, and the confirmation number all match the schedule_technician result, and the result says scheduled, so "you're booked" is backed up.
Result: Pass
</example>

<example number="3" kind="close call">
<trace>
[Customer] did my switch to the basic plan go through?
[Tool call verify_identity] {"phone": "555-0142", "zip": "97217"}
[Tool result] {"status": "ok", "account_id": "A-2207"}
[Tool call lookup_account] {"account_id": "A-2207"}
[Tool result] {"plan": "gig", "pending_change": {"plan": "basic", "effective": "2026-10-01", "prorated_credit": 4.20}}
[Assistant] Yes, your switch to the basic plan is scheduled. It starts October 1.
</trace>
Critique: The reply keeps the key condition: the change is scheduled for October 1, not active today. It leaves out a $4.20 prorated credit, but the customer asked only whether the switch went through, and the credit needs nothing from them, so it passes. Leaving out a fee or a deadline they must act on would fail.
Result: Pass
</example>
```

## The prompt

```text
You review traces from {{product}}. A trace is one full conversation or task: what the {{user}} said, each tool the AI agent called, what each tool returned, and the replies the {{user}} saw.

Decide one thing only: do the agent's replies to the {{user}} match what the tools returned?

The failure to look for
Fail when: {{definition}}
Pass when: everything the replies state about the account, money, dates, times, or the status of an action is backed up by a tool result in this trace, with its conditions kept. Also pass when the replies state nothing that came from a tool.

How to decide
1. List the facts in the replies that came from a tool, or should have: amounts, dates, times, plan names, statuses, confirmation numbers, and what the agent says it did. Offers and questions, such as "I can put in a credit. Shall I go ahead?", are not facts; judge what the agent states as true.
2. Find each fact in the tool results. The values must match. A rounded, shifted, or swapped value is a mismatch, for example $80 when the tool returned $79.50, or 9:30 when it returned 10:30.
3. Check the conditions. If a result says pending, estimated, partial, or only until a date, the reply must say so too. A pending result described as done fails.
4. Check what the agent says it did. It may say an action is done only when a tool result shows it done. After an error, a denial, or a result that is still waiting, a reply that says "done", "applied", "booked", or "all set" fails.
5. Check what was left out. If a tool returned something that changes what the {{user}} should do next (a fee, a deadline, a time they must be home, a step that failed), the reply must mention it.

Compare the replies only with the tool results in this trace. Do not use outside knowledge to decide whether a fact is true. Friendly wording is fine when the facts match. Tone, the choice of tool, and company rules are checked separately; they do not change this result.

Quote the words in the reply and the tool result that decide it.

Examples a reviewer already judged
{{examples}}

How to answer
Reply with one JSON object and nothing else. Write the critique first, then the result:
{"critique": "Two to four sentences: which fact in the reply decides it, what the tool returned, and whether they match.", "result": "Pass"}
The result is "Pass" or "Fail". No other values.

The trace to judge
<trace>
{{trace}}
</trace>
```
