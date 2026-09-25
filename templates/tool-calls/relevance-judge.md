# Relevance judge template

An AI judge prompt for the relevance question: **Is it the right call for what the customer asked?** Right tool, right details, no calls the request didn't need, none it skipped. The judge reads one trace, writes a short critique, then answers Pass or Fail for this one failure mode.

## How to use this template

1. **Confirm the failure in your own traces first.** Read traces with tool calls and note where the agent picked the wrong tool, passed the wrong details, made a call nobody needed, or skipped one. Build this judge only if that keeps happening.
2. **Try the free check first.** If your traces say which kind of request each one is (a label from a router, a classifier, or your reviewer), the intent map in `intents.json` checks relevance with no AI cost. Use this judge when traces have no such label, or when the right call depends on details a list of tools can't capture.
3. **Fill the placeholders** in the prompt below:

| Placeholder | Fill with | Northstar example |
|---|---|---|
| `{{product}}` | Your product's name and what it does, in one line | Northstar Internet's support agent, which helps customers with bills, outage credits, plan changes, cancellations, and technician visits |
| `{{user}}` | Your word for the person using it | customer |
| `{{definition}}` | Your failure mode's definition | The default below |
| `{{examples}}` | 2 to 4 examples you already judged | See "Pick the examples" |
| `{{trace}}` | The trace to judge | Filled in for each trace |

4. **Give the judge only what it needs:** what the customer said, each tool call with its details, and each tool result. Leave out the agent's instructions and long documents unless the right call depends on them.
5. **Pin an exact model version**, for example `claude-haiku-4-5-20251001`, so the judge doesn't change under you.
6. **Test it against your own labels before you trust it.** Run it on your tuning set, read every disagreement, then fix the prompt or your label. Stop when it catches real failures and agrees on good traces at 90% or better each (80% at the least). Then run the final test once. `/pmstack:test-judge` walks you through it.

In Eval Studio, the Checks tab builds this prompt for you: Tool call checks, Relevance, "Use the AI judge template". Use this file when you run judges in your own tools.

**Default definition** for `{{definition}}` (swap in your word for customer, and leave out a leading "Fails when": the prompt already says it):

> The agent calls a tool that does not serve what the customer asked, passes details that differ from what the customer said or a tool returned, makes a call the request did not need, skips a call the request needed, or guesses a missing detail instead of asking.

## Pick the examples

- **Only from traces set aside as examples.** Never use traces from your tuning set or final test: a judge that has seen the answers scores itself too well.
- **One clear fail, one clear pass, one close call.** Two to four in total.
- **Clear fail:** one wrong choice anyone would agree on. The customer wants a cheaper plan and the agent cancels their service.
- **Clear pass:** the needed calls, with details taken straight from the customer or an earlier tool result, and nothing extra.
- **Close call:** a trace you hesitated on. Decide, then write down why. This is where the judge learns where your line is.
- **Mix them up:** different kinds of requests and channels, so the judge doesn't learn that one kind always fails.
- **Write each critique so a new teammate would understand it**, one to three sentences, with the critique before the result.

A filled `{{examples}}` block for Northstar, in the format pmstack uses:

```text
<example number="1">
<trace>
[Customer] The gig plan is too much for us now. Can I go down to basic?
[Tool call verify_identity] {"phone": "555-0142", "zip": "97217"}
[Tool result] {"status": "ok", "account_id": "A-2207"}
[Assistant] I can make that change on account A-2207. Shall I go ahead?
[Customer] yes go ahead
[Tool call cancel_service] {"account_id": "A-2207", "reason": "downgrade"}
[Tool result] {"status": "ok", "effective": "2026-10-01"}
[Assistant] All set. Your change takes effect October 1.
</trace>
Critique: The customer asked to switch from the gig plan to basic, which needs change_plan with plan "basic". The agent called cancel_service instead, which ends their service.
Result: Fail
</example>

<example number="2">
<trace>
[Customer] Why is my bill $20 higher this month?
[Tool call verify_identity] {"phone": "555-0187", "zip": "97214"}
[Tool result] {"status": "ok", "account_id": "A-1182"}
[Tool call get_bill] {"account_id": "A-1182", "month": "2026-09"}
[Tool result] {"total": 89.99, "previous_total": 69.99, "changes": [{"item": "Promotional discount ended", "amount": 20}]}
[Assistant] Your September bill is $89.99, up from $69.99, because your $20 promotional discount ended.
</trace>
Critique: A bill question needs get_bill. The agent verified the customer, then pulled this month's bill for the verified account. No calls were missing or extra.
Result: Pass
</example>

<example number="3" kind="close call">
<trace>
[Customer] my bill went up again?? what happened
[Tool call verify_identity] {"phone": "555-0163", "zip": "97206"}
[Tool result] {"status": "ok", "account_id": "A-3310"}
[Tool call search_help_center] {"query": "price change September 2026"}
[Tool result] {"articles": [{"title": "2026 price updates", "summary": "The plus plan goes up $5 on September 1."}]}
[Tool call get_bill] {"account_id": "A-3310", "month": "2026-09"}
[Tool result] {"total": 75.00, "previous_total": 70.00, "changes": [{"item": "Plus plan price update", "amount": 5}]}
[Assistant] Your bill went from $70 to $75 because the plus plan price went up $5 on September 1.
</trace>
Critique: The needed call, get_bill for the verified account and this month, is there. The help center search was not required, but it looked up the same price change and changed nothing, so it passes. An extra call that changed something or fetched another customer's data would fail.
Result: Pass
</example>
```

## The prompt

```text
You review traces from {{product}}. A trace is one full conversation or task: what the {{user}} said, each tool the AI agent called with the details it passed, what each tool returned, and what the {{user}} saw.

Decide one thing only: did the agent make the right tool calls for what the {{user}} asked?

The failure to look for
Fail when: {{definition}}
Pass when: every tool call serves what the {{user}} asked, uses the details the {{user}} gave or an earlier tool returned, and no needed call is missing. Also pass when no tool was needed and none was called.

How to decide
1. In a few words, name what the {{user}} wanted. If the request changed during the conversation, use the latest one.
2. For each tool call, ask three questions:
   - Does this tool serve what the {{user}} wanted?
   - Do its details (dates, amounts, account numbers, names, plan names) match what the {{user}} said or what an earlier tool returned? A detail that appears nowhere earlier in the trace was made up.
   - Was the call needed? Checking who the {{user}} is before opening their account counts as needed.
3. Ask what is missing: did the request need a call the agent never made? Answering from memory when a tool had the facts counts as skipping the call.
4. When a detail the call needs was never given, the right move is to ask the {{user}}. A call built on a guess fails.

Judge relevance only. Tone, wording, company rules about what the agent may do, and whether the reply matches the tool results are checked separately; they do not change this result. A correct call that failed on the tool's side still passes here.

Quote the {{user}}'s words and the tool call, or the missing call, that decide it.

Examples a reviewer already judged
{{examples}}

How to answer
Reply with one JSON object and nothing else. Write the critique first, then the result:
{"critique": "Two to four sentences: what the {{user}} asked, which call or missing call decides it, and why.", "result": "Pass"}
The result is "Pass" or "Fail". No other values.

The trace to judge
<trace>
{{trace}}
</trace>
```
