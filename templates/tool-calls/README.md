# Tool call checks: templates

Ready-to-copy files for checking the tool calls of an AI agent: the moments it looks something up or changes something for your customer. They are plain files, so they work in Eval Studio, with the pmstack command line, or in your own code.

## Three questions for every tool call

1. **Policy: Is this call allowed?** Your company's rules for which tools the agent may use, when, and with what details.
2. **Relevance: Is it the right call for what the customer asked?** Right tool, right details, no calls the request didn't need, none it skipped.
3. **Output grounding: Does the reply match what the tool returned?** No contradicted values, no invented facts, no dropped qualifiers (pending shown as done), no success claimed after a failed call.

## What's in this folder

| File | What it is | Use it when |
|---|---|---|
| [`policy.json`](policy.json) | A full policy for Northstar Internet's support agent (a made-up company). Shows every rule type, each with a plain reason. | You want to see a complete company policy, or copy rules from it. |
| [`policy-starter.json`](policy-starter.json) | A short policy with placeholder tool names to replace. | You are writing your first policy. |
| [`policy-requirements-checklist.md`](policy-requirements-checklist.md) | The questions to ask your policy owner, each matched to a rule type, plus the requirements a rule can't check. | Before you write the policy. |
| [`intents.json`](intents.json) | An intent map: for each kind of request, the tools it needs, the tools it may use, and the tools it must never use. | Your traces say which kind of request each one is. |
| [`relevance-judge.md`](relevance-judge.md) | An AI judge prompt for relevance. | Traces don't say the kind of request, or the right call needs judgment. |
| [`grounding-judge.md`](grounding-judge.md) | An AI judge prompt for output grounding. | After the two grounding code checks, to catch reworded facts and dropped conditions. |

A code check is a rule a computer can test, so it is free, fast, and never drifts. An AI judge is a prompt that asks a model for Pass or Fail on one failure mode; test it against your own labels before you trust it.

## Where each question starts in the funnel

Each failing trace counts once, at the first stage that went wrong.

| Question | Where failures start | Check to start with |
|---|---|---|
| Policy | At the call itself (act) | Policy rules |
| Relevance | Where the agent chose the tool (plan or act) | The intent map, or the relevance judge |
| Output grounding | At the reply (answer) | Two code checks, then the grounding judge |

## Read your traces too

**Policy** rules are requirements your company already knows, so write them down first. It is the one kind of check worth writing before you read traces. Then read traces anyway: they show the rules nobody thought to write down.

**Relevance** and **output grounding** are the most common ways agents that use tools let people down. Confirm them in your own traces first with error discovery (reading real traces and noting the first thing that went wrong), then use these templates as a head start.

## Run them

**In Eval Studio.** Open the Checks tab. When your traces include tool calls, a Tool call checks panel appears with one card per question. Start from the full example or the starter policy, upload an intent map, add the grounding code checks, or use a judge template. Each check belongs to a failure mode, so its results sit next to your own labels.

**On your computer** (Node 20 or newer, nothing to install):

```sh
# List every tool in your traces, with a guess at read or write
node bin/pmstack.mjs policy traces.jsonl --list-tools

# Check every trace against a policy; prints each violation and why
node bin/pmstack.mjs policy traces.jsonl --policy templates/tool-calls/policy.json

# Run every check in a project, including policy, relevance, and grounding
node bin/pmstack.mjs check pmstack/project.json
```

`policy` and `check` exit with code 1 when anything fails, so your build can stop on it.

**Before a write runs, in your own service.** The policy check is plain JavaScript with no dependencies, so it can stop a call before it happens (a guardrail). Pass the conversation so far plus the call the agent wants to make:

```js
import { readFileSync } from 'node:fs';
import { normalizeTrace, evaluatePolicy } from './pmstack/docs/studio/lib/index.mjs';

const policy = JSON.parse(readFileSync('policy.json', 'utf8'));

export function checkBeforeRunning({ id, metadata, messages }, call) {
  const next = [...messages, { role: 'assistant', content: '', tool_calls: [call] }];
  const trace = normalizeTrace({ id, metadata, messages: next });
  const callStep = `m${next.length - 1}.c0`; // only the new call decides; earlier calls already ran
  // userLabel is the word the reasons use for your users: replace 'customer' with your product's word.
  const blocking = evaluatePolicy(policy, trace, { userLabel: 'customer' }).violations.filter((v) => v.stepId === callStep);
  return { allowed: blocking.length === 0, reasons: blocking.map((v) => v.message) };
}
```

A guardrail that blocks good requests is a bug your customers feel. Run the policy on past traces first and fix every rule that flags a good call.

**With Claude Code.** `/pmstack:tool-policy` builds a policy with you from the checklist, `/pmstack:tool-relevance` builds an intent map or a relevance judge, and `/pmstack:tool-grounding` adds the grounding checks and judge.

## What your traces need

- Each tool call with its name and details, and each tool result. pmstack reads the common formats: OpenAI and Anthropic messages, and step-by-step logs. See [the trace format guide](../../guides/trace-format.md).
- A `"status": "error"` on failed calls, or an error word in the result, so checks can tell a failure from a success.
- For the intent map: a detail naming the kind of request, such as `metadata.intent`.
- For channel rules: a detail naming the channel, such as `metadata.channel`.

## Learn more

- [Tool call checks guide](../../guides/tool-call-evals.md): every rule type with examples, and how the checks fit error discovery.
- `/pmstack:test-judge`: prove an AI judge agrees with you before you rely on it.
