---
name: pmstack-eval-audit
description: "Audits an existing AI evaluation setup against the error discovery method and returns findings ordered by product impact, each with evidence and a fix. Inspects six areas: where the failure modes came from, how checks are designed, whether judges were measured against human labels, who reviews and what they see, how many labels exist, and whether checks stay current. Use when inheriting evals, when a team reports AI quality scores nobody has verified, or before a release decision rests on eval numbers."
---

# Audit an existing eval setup

An audit inspects the real artifacts (prompts, label files, scripts, dashboards) and reports what would make the team's quality numbers wrong. Every finding points at evidence you read and at one concrete fix.

## Find the pmstack tool (for pmstack projects only)

`<skill-dir>` is this skill's base directory: the folder holding this SKILL.md, which your agent receives when it loads the skill. When the setup includes a `pmstack/project.json`, run:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

Then `node "$PMSTACK" validate pmstack/project.json` and `node "$PMSTACK" report pmstack/project.json --out "${TMPDIR:-/tmp}/pmstack-audit-evidence.md"` (a temporary file, so the only report left in the folder is the audit) give you reviews, failure modes, checks, and agreement numbers as evidence. If no path is found, read `project.json` directly; the rest of the audit uses only your own tools. Never install npm packages.

## Phase 1: Gather the artifacts

Collect everything that produces or reports an AI quality number:

- Search the code: `rg -il "judge|evaluator|rubric|grader|eval|score|golden|ragas|deepeval|promptfoo|braintrust|langsmith|phoenix" --glob '!node_modules'`. Open every hit that defines a check, a judge prompt, a label file, or a metric.
- Trace exports and label files (`*.jsonl`, `*.csv`, notebooks), dashboards, and the numbers the team quotes in documents.
- A connected observability tool, when your agent has one: pull evaluator definitions, recent results, and a sample of traces.
- Ask the user for what the files cannot show: who labels traces, what they see while labeling, when the last model or prompt change shipped, and which numbers leadership watches.

If there are no evals at all, stop the audit and route: to pmstack-error-discovery when traces exist, to pmstack-synthetic-traces otherwise. Judges, scores, and dashboards come after error discovery has named failure modes.

Phase 1 is done when you hold a list of every check and judge, where its labels come from, and every number the team reports.

## Phase 2: Inspect the six areas

When your agent can start subagents, give each area to its own subagent with the artifact list, that area's checks, and the finding format from Phase 3; then merge their findings. Otherwise go area by area.

For every check below, open the artifact and record evidence: a file and line, a quoted fragment of a prompt, a number from a label file. Status is **Problem**, **OK**, or **Can't tell** (say what was missing).

### 1. Where the failure modes came from

- Evaluators exist with no written failure mode behind them.
- Categories look brainstormed (helpfulness, coherence, hallucination score, toxicity) instead of observed in this product's traces (for example "offers a time that is already booked").
- No record of anyone reading traces and writing notes before the checks were built.

### 2. How checks are designed

- Scores on a 1 to 5 scale, letter grades, or numbers with no pass line, where a pass or fail decision per failure mode would do.
- One judge prompt covering several failure modes, or "overall quality".
- An AI judge where a code check would decide it: formatting, length, required fields, keywords, valid structure, whether a tool was called.
- Similarity scores (ROUGE, BLEU, BERTScore, cosine similarity) used as the main measure of answer quality.

### 3. Whether judges were measured against human labels

- A judge in use with no comparison to human labels at all. Treat this as the most severe finding in the area.
- Judge agreement reported as accuracy, percent agreement, or Cohen's kappa (a chance-corrected agreement score meant for comparing two human reviewers), instead of two numbers: the share of real failures it catches and the share of good traces it agrees on.
- Prompt examples drawn from the same traces used to measure the judge.
- No held-out final test that was used once.
- The judge's model named by a floating alias ("latest", no date) instead of an exact version.
- Reported judge failure rates with no correction for the judge's known mistakes and no range.

### 4. Who reviews and what they see

- Labels come from outsourced or rotating reviewers instead of one person whose judgment sets the bar and who knows the domain.
- Reviewers see raw structured data, spreadsheet cells, or only the final output, instead of the full trace drawn the way the customer saw it.

### 5. How many labels exist

- Fewer than 50 Problem and 50 Good labels behind any judge's agreement numbers.
- Fewer than about 100 traces read during error discovery, or no sign that new failure modes had stopped appearing.
- Samples picked only by one signal (thumbs-down, flagged by an existing check), with no random traces mixed in.

### 6. Whether checks stay current

- No re-validation of a judge after its prompt, model, or definition changed.
- No error discovery on fresh traces since the last model switch, prompt rewrite, new feature, or incident.
- Fixed bugs have no regression trace, or checks never run on code changes.

Phase 2 is done when every check in every area has a status and evidence.

## Phase 3: Write the report

Write the report to `eval-audit-<YYYY-MM-DD>.md` in the working folder. Leave out every area where all checks are OK. Order findings by product impact: an unvalidated judge that gates releases outranks a naming problem.

Each finding:

```markdown
### <The problem, in plain words>
Status: Problem | OK | Can't tell
Evidence: <file:line, quoted fragment, or number>
Fix: <one concrete action> (<skill or guide>)
```

Point each fix at the pmstack piece that does it:

| Fix | Where |
|---|---|
| Find failure modes from real traces | pmstack-error-discovery |
| No traces to read yet | pmstack-synthetic-traces |
| Replace a score or a broad judge with one pass or fail judge per failure mode | pmstack-write-judge |
| Measure a judge against labels, final test, corrected rate | pmstack-validate-judge |
| Separate search from answers in an answer bot | pmstack-evaluate-rag |
| Reviewers see raw data | pmstack-custom-view |
| Regression set, checks on every change, production sampling | pmstack-regression-checks |
| Code checks versus AI judges | https://github.com/RyanAlberts/pmstack/blob/main/guides/checks-and-judges.md |
| The method end to end | https://github.com/RyanAlberts/pmstack/blob/main/guides/method.md |

Phase 3 is done when the report file exists and every Problem finding has evidence and a fix.

## Report to the user

In chat, give the file path and the top three findings, one line each: the problem, its evidence, the fix. Then offer the first fix as the next step.
