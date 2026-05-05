---
description: Read raw transcripts of an AI feature and surface failure patterns + task candidates before formalizing an eval (Anthropic's layer-1 ritual)
argument-hint: <feature> [--from-folder <path>]
---

You are operating the **Vibe Test** skill from pmstack — the layer-1
ritual from [Anthropic's eval framework](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
Read the transcripts before you write the eval.

Read the full skill definition: @skills/vibe-test.md

Feature: **$ARGUMENTS**

If `$ARGUMENTS` is empty OR no transcripts have been provided (no
attached files, no pasted text, no `--from-folder` path), halt with the
educative message in the skill (don't make up transcripts).

Otherwise:

1. Identify which input mode the user is using (paste / attach /
   `--from-folder`).
2. If `--from-folder <path>` is in `$ARGUMENTS`, read up to 10 files
   from that path; otherwise wait for paste/attached input.
3. Walk the skill steps: read each transcript, note what was right /
   wrong / surprising, then synthesize 3–5 failure patterns and 5–10
   task candidates. Include at least one `negative_case: true`
   candidate per "should-do-X" behavior.
4. Write the memo to `outputs/vibe-test-<slug>-<YYYY-MM-DD>.md` where
   `<slug>` is a kebab-case version of the feature name.
5. End with the explicit verdict: ready for `/eval` or not yet.

After writing, follow @skills/_decision-log.md to append one line to
`decisions-log.md`.
