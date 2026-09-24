# Credits

pmstack puts other people's teaching into a tool. This page says whose, and what pmstack took from each. pmstack is independent and not affiliated with any of them.

## The method: Hamel Husain and Shreya Shankar

Error discovery is Hamel Husain and Shreya Shankar's method: read real traces, write notes on the first thing that went wrong, group them into failure modes, build checks for the ones that matter, and measure every AI judge against a person's labels before trusting it. The six steps, the funnel, and the checks in pmstack follow their teaching, in pmstack's own words and pictures.

- [Building eval systems that improve your AI product](https://www.lennysnewsletter.com/p/building-eval-systems-that-improve), in Lenny's Newsletter
- [Advanced evals: How to find (and fix) hidden AI failures in your product](https://www.lennysnewsletter.com/p/advanced-evals-how-to-find-and-fix), in Lenny's Newsletter, where the method is called error discovery
- [AI Evals For Engineers & PMs](https://maven.com/parlance-labs/evals), their course
- [Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)

Thanks to Lenny Rachitsky and Lenny's Newsletter for publishing both guides. pmstack links to them and reproduces none of their text or figures.

## Their open source work

- **[evals-skills](https://github.com/ai-evals-course/evals-skills)** (ai-evals-course) is their set of agent skills for evals. It has no license, so pmstack copies none of its text, code, prompts, or pictures. pmstack's skills are written from scratch.
- **[hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills)** is the archived earlier version, MIT licensed, copyright (c) 2026 Hamel Husain. pmstack adapts ideas from it, with credit in each source file: the 15%, 45%, and 40% split of labels into examples, tuning set, and final test (`docs/studio/lib/labels.mjs`), and the judge prompt rules of critique before result and examples kept apart from the traces used to measure the judge (`docs/studio/lib/judge.mjs`).
- **[judgy](https://github.com/ai-evals-course/judgy)** (ai-evals-course), MIT licensed, is their library for measuring a judge and correcting its failure rate. pmstack's agreement numbers, likely true failure rate, and 95% range are adapted from its math in `docs/studio/lib/metrics.mjs`. One difference: pmstack also resamples the judge's answers on unlabeled traces when it computes the range, because the unlabeled sets in a product review are small.

## Words pmstack uses, and the course's words

Eval Studio uses plain words. If you take the course or read the guides, here is how the words line up.

| pmstack | Course term |
|---|---|
| error discovery | error analysis |
| writing notes | open coding |
| grouping notes | axial coding |
| reviewer | benevolent dictator, or principal domain expert |
| code check | code-based evaluator |
| AI judge | LLM-as-judge (a judge built on a large language model) |
| Agrees on good traces | true positive rate (TPR), with Pass as the positive class |
| Catches real failures | true negative rate (TNR), with Pass as the positive class |
| Likely true failure rate | Rogan-Gladen corrected rate |
| examples, tuning set, final test | train, dev, test |
| regression set | golden dataset |
| new failure modes stop appearing | theoretical saturation |

judgy and the validate-evaluator skill call "Agrees on good traces" TPR because they treat Pass as the positive class. Hamel and Shreya's FAQ uses the opposite convention, where TPR is the share of failures caught. pmstack shows plain labels for this reason.

## How your AI works: Anthropic

The eight patterns in Set up and the patterns picture use the names from Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): the augmented LLM, prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, and autonomous agents. pmstack's pictures, stages, and advice on where failures start are its own.

## Code and fonts

- **[Preact](https://preactjs.com/)** 10.29.8, MIT license, and **[htm](https://github.com/developit/htm)** 3.1.1, Apache License 2.0, draw Eval Studio. Both are copied unchanged into `docs/studio/vendor/` with their license files.
- **Instrument Sans**, **Instrument Serif**, and **JetBrains Mono** are loaded from Google Fonts under the SIL Open Font License.

## Sample products

The six sample products (Maple Dental, Tidewater Scheduling, Larkspur Labs, Copper & Clay Kitchen, the pull request reviewer, and Northstar Internet) and all of their traces are made up for pmstack. Any match with a real person or company is chance.
