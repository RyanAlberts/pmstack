# Why pmstack starts with product judgment

Research reviewed September 12, 2026. This is a build hypothesis, not validated customer demand.

The first job is deciding which customer problem deserves attention this week. An AI teammate makes a recommendation; the PM checks its evidence, explains a correction, and tests whether that lesson helps with new customer conversations. The lasting artifact is a Customer problem decision with sources, expectations, and a recorded judgment.

## What the research changed

A generic review dashboard is insufficient differentiation. LangSmith already documents single and paired review queues. Braintrust Loop supports dataset creation, scoring, and prompt improvement. Linear documents reusable skills and recurring loops inside its existing work environment. These are vendor-documented capabilities, not comparative usability tests. [LangSmith](https://docs.langchain.com/langsmith/annotation-queues), [Braintrust](https://www.braintrust.dev/docs/loop), [Linear](https://linear.app/docs/linear-agent).

The narrower hypothesis is that pmstack can help PMs express a useful reasoning standard and preserve the evidence about whether it transfers to new work. “Separate message count from customer reach, while still considering severity” is one such standard. Portability supports that job but is not, by itself, a reason to adopt a product.

## The proposed loop

The framework keeps five things together: the **job** to accomplish, the **standard** for acceptable work, the **evidence** available, the **decision** a person records, and the **lesson** proposed for next time. An accepted lesson updates the standard. Each run retains its standard version so a changed expectation cannot silently inherit an earlier acceptance.

1. Start with actual work and its source evidence.
2. Identify the reasoning mistake and the outcome it could cause.
3. Propose a standard, its reason, and a counterexample before accepting it.
4. Give the updated instructions to an existing agent.
5. Check both the original case and new evidence. Preserve failures and unresolved questions.
6. Record the product decision and retain the lesson for future work.

An eval is a repeatable check of a specific behavior. Automated checks can verify counts and references; human judgment remains necessary for the recommendation. Anthropic's engineering guidance supports balanced cases, calibrated graders, transcript review, and product-team ownership of expectations. It also separates evaluation evidence from production outcomes. [Agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

A correction changes explicit instructions and expectations. It does not train model weights or guarantee permanent learning. The current workspace activates a fixed set of checks when a lesson is accepted; it does not generate arbitrary code tests from prose.

Two loops need separate attention. The **product loop** changes the agent's work and checks whether the result improves. The **evaluator loop** changes an inaccurate check or unclear standard and checks whether it judges work more fairly. A score can improve because grading changed; that does not establish that the agent improved.

## Interface and execution choices

Keep the recommendation and evidence together. Ask for a judgment when it affects the work. Use existing agent environments for execution, and retain portable files for standards, responses, and decisions. Linear's interaction guidance supports native work objects, clear agent state, and human responsibility. [Agent Interaction Guidelines](https://linear.app/developers/aig).

Grok Bot's September 3 design account describes interactive cards and artifacts inside conversations, with execution details available when needed. Its designers report rejecting extra coordination dashboards because they added work for the user. This supports making the decision itself the interface, rather than another board to manage agents. It is a vendor design account, not independent evidence of improved PM outcomes. [Designing Grok Bot](https://x.ai/news/designing-grok-bot).

The August 15 PM guide describes responsibilities and attention lists built from existing work, plus research across customer sources. Those are first-person usage observations. The useful implication for pmstack is to evaluate a recurring responsibility in its actual context. Grok's existing skills and routines already cover instructions and triggers, so pmstack should preserve acceptance evidence instead of adding a general runtime or scheduler. [Grok Bot for PMs](https://x.ai/bot/guides/grok-bot-for-pms), [skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations).

Do not use fewer clicks as a substitute for useful outcomes. An August 2026 study of 73 people using a content-management interface found reduced interaction effort with AI assistance without significantly faster completion. That study does not establish results for PM work, but it challenges a demo-speed argument. [Study, revised August 25, 2026](https://arxiv.org/abs/2608.19551).

The [workspace](workspace/README.md) and [command-line guide](work-review.md) implement a file handoff. A real response must come from an actual external agent session. Prepared examples demonstrate the interaction and remain labeled as such.

## Distribution hypothesis

Share a useful decision, its correction, and the result on fresh evidence, together with a reproducible project file. A recipient can inspect the reasoning and try the job on their own conversations. The project should earn reuse through its result. GitHub's maintainer guidance favors clear problems, usable examples, and relevant communities; it does not establish that launch attention predicts adoption. [Finding users](https://opensource.guide/finding-users/).

Measure people supplying real evidence, completing a second run, accepting a useful decision artifact, and returning with new work. Stars, views, and likes measure attention. They do not validate demand.

## What would change the decision

Proposed product test: five PMs use three weekly batches. At least three prefer the resulting decision artifact to their current process and return with fresh evidence. Compare correction effort and material errors against a plain document plus their existing tools. These are proposed thresholds, not achieved results.

Narrow or reject the workflow if it creates more review work than it saves, fails to preserve useful corrections, or mainly produces an attractive screen. A technically complete handoff can establish feasibility; repeated PM use must establish value.

The 40% evaluation-time target is a chosen operating philosophy. No reviewed source establishes it as an optimal industry allocation. The aim is better judgment with less bookkeeping, not hours spent grading.

## Research coverage and limits

Four last30days research runs covered AI evaluations, AI product design, agent feedback loops, and Grok Bot across August 13 to September 12, 2026. They returned **345 records before cross-run deduplication and relevance review**. This is retrieval volume, not 345 unique sources or 345 validated findings.

The Grok quick run intentionally omitted several source channels and transcripts. Two runs reported an unavailable Jobs source. The underlying research records distinguish these gaps from evidence. Vendor descriptions establish stated capabilities; neither social attention nor those descriptions establishes unmet customer need.

The directly linked primary sources above carry the argument: [agent evaluation practice](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [existing evaluation assistance](https://www.braintrust.dev/docs/loop), [native agent interaction](https://linear.app/developers/aig), [Grok's artifact-centered design](https://x.ai/news/designing-grok-bot), and [the recent interaction study](https://arxiv.org/abs/2608.19551). Publication dates are identified where available; living product documentation was retrieved September 12, 2026. Neither the retrieval count nor this set of sources establishes comprehensive market coverage.
