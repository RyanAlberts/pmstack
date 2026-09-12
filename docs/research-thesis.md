# The framework is the product

The initial customer-problem recommendation demo was too narrow. It made one application look like the repository's framework. That direction has been replaced.

The current foundation is [Anthropic's guide to agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), applied to the PM's responsibility for defining success. See [the framework guide](eval-framework.md) and [the evaluation studio](https://ryanalberts.github.io/pmstack/workspace/).

The key product decision is to teach the general structure first: tasks, environments and context, trials, transcripts, outcomes, graders, suites, and the distinction between evaluation and agent harnesses. Models and agent subtypes share the structure. A persistent teammate adds continuity and memory concerns; it does not need a separate theory of evaluation.

Examples follow the framework and remain explicitly illustrative. The library includes coding, support, travel assistance, persistent teammate memory, research, extraction, and computer use. Each example exposes a meaningful boundary, not merely an easy success.

The new harness separates suite data from executable adapters, target claims from observed state, and target failure from evaluation failure. Its design is intended to help PMs make measurements worth trusting. Structural tests and a working interface cannot establish demand, product taste, or a productivity multiple.

Useful validation questions remain: can a PM define a fair task in their own domain, challenge a faulty grader, explain why a trial failed, and make a better decision from the resulting evidence? Test that with real users and compare with their current workflow.
