---
name: pmstack-check-sources
description: "Checks an answer bot that searches documents by testing the search and the answer separately. Reviews full traces first, has the reviewer mark the sources each answer needed, measures the search with Recall@k and mean reciprocal rank, fixes search before the answer step, then builds one judge for answers backed by their sources and another for answers that address the question. Use when a product answers questions from a document collection, knowledge base, help center, or search results, when its answers cite sources, or when someone mentions RAG."
---

# Check an answer bot that searches documents

An answer bot fails in two places: the look-up (the right document never came back) and the answer (the document came back and the answer still went wrong). Measure them separately and fix the look-up first: a model can only answer from the documents it receives.

Use the project's user word (`experience.userLabel`, default "customer") wherever this skill says customer.

## Find the pmstack tool

`<skill-dir>` is this skill's base directory: the folder holding this SKILL.md, which your agent receives when it loads the skill. Run:

```sh
PMSTACK=""
for p in "<skill-dir>/../../../.pmstack/bin/pmstack.mjs" "<skill-dir>/../../bin/pmstack.mjs" "$HOME/.pmstack/bin/pmstack.mjs"; do
  [ -f "$p" ] && PMSTACK="$p" && break
done
```

It needs Node 20 or newer. If your shell forgets variables between commands, use the found path literally. If no path is found, point the user to https://ryanalberts.github.io/pmstack/studio/: its Answer with sources view covers Phase 2 in the browser, and its AI help drawer covers grouping. Phase 3 needs the command-line tool. Never install npm packages.

## Guardrails

- The reviewer decides which sources an answer needed. You may list candidate documents in chat; the reviewer marks them.
- Every failure mode you propose comes from something the reviewer saw in the traces.
- Faithfulness to sources and answering the question stay two failure modes with two judges.
- The quality measure is a binary check per failure mode. Similarity scores (ROUGE, BERTScore, cosine similarity between texts) are for ranking documents, never for grading answers.

## Phase 1: Make sure traces show the look-up

Read 5 traces. Each must carry the search as a step, with document ids in the order they were returned, and the answer with its citations:

```json
{
  "id": "q-0107",
  "input": "How many weeks of parental leave do I get?",
  "steps": [
    { "type": "retrieval", "name": "search_policies", "input": "parental leave weeks",
      "documents": [ { "id": "hr-12", "title": "Parental leave policy 2026", "text": "...", "score": 0.82 } ] }
  ],
  "output": { "type": "answer", "text": "You get 16 weeks [1].", "citations": [ { "n": 1, "doc": "hr-12", "quote": "16 weeks of paid leave" } ] }
}
```

If the traces lack the search step, stop and help the team log it first: the search query, every returned document id in rank order with its title and text, and the answer with the ids it cited. Phase 3 has nothing to measure without those ids.

Phase 1 is done when every sampled trace has a retrieval step with ranked document ids.

## Phase 2: Review full traces first

Run the pmstack-find-failures skill on these traces with view `answer` and a stage for the look-up (pattern `augmented`: understand, look things up, reply). Metrics come after the reviewer has read traces and named failure modes, never before.

During review, the reviewer marks sources in the Answer with sources view:

- **Needed**: toggle it on each returned source the correct answer depends on.
- **Needed but not found**: add the id of a document that should have come back and did not.

Ask the reviewer to mark sources on every trace that failed at the look-up stage and on about 20 Good traces, so the look-up numbers describe ordinary questions as well as failures. When the reviewer is unsure which document holds the answer, search the document collection yourself and list candidate ids with the matching passage; the reviewer decides.

Phase 2 is done when failure modes are named, the funnel shows which stage fails most, and at least 30 traces carry needed sources.

## Phase 3: Measure the look-up

```sh
node "$PMSTACK" retrieval pmstack/project.json --k 5
```

Set `k` to the number of documents the product passes to the model; k depends on your product.

- **Recall@k**: of the documents an answer needed, the share that appeared in the top k results. Watch this first whenever several documents reach the model: the model can skip an extra document but cannot use a missing one.
- **Mean reciprocal rank**: the average of 1 divided by the position of the first needed document (first place scores 1, second 0.5, third 0.33). Watch this when one top document drives the answer, as in single-fact lookups.

Phase 3 is done when both numbers are reported with the count of traces behind them.

## Phase 4: Fix the look-up before the answer

When Recall@k is low, or look-up is the stage where most traces first fail, work on search before touching the answer prompt. Settings to test, one at a time:

- Documents missing from the collection, or outdated versions returned ahead of current ones.
- Chunk size and overlap; splitting chunks at section boundaries instead of fixed lengths.
- Adding the document title and section heading to each chunk before indexing.
- How many results reach the model (k).
- Keyword search beside vector search; rewriting the question before searching.

For each setting, rerun only the search on the same questions, keep every trace id unchanged, and compare Recall@k. Write each run's search results to `lookup-runs/<setting>.jsonl` with the same trace ids, then run `node "$PMSTACK" retrieval pmstack/project.json --k 5 --traces lookup-runs/<setting>.jsonl`. The needed sources you marked stay in the project, so every run is measured against the same answers. Report a table of setting, Recall@k, and mean reciprocal rank; the team picks what ships.

Phase 4 is done when the team has chosen search settings from measured numbers, or Recall@k was already high enough that answers are the bigger problem.

## Phase 5: Check the answers with two judges

Once the look-up returns the needed documents, two failure modes cover the answer step. Propose each only if the reviewer's notes show it:

| Failure mode | Fails when | What the judge sees |
|---|---|---|
| Says things its sources do not support | The answer states a fact, number, limit, or rule that none of the returned sources supports, or misreads one | Returned sources and the answer |
| Does not answer the question asked | The answer is accurate to its sources but addresses a different question, a neighboring case, or the wrong part of a document | The customer's question and the answer |

Propose them as `mode` suggestions in `pmstack/suggestions.json` (read the file, append, write it back whole; never edit `project.json` while the studio runs):

```json
{ "suggestions": [
  { "id": "sg-20260924153000-1", "kind": "mode", "status": "open", "from": "pmstack-check-sources",
    "createdAt": "2026-09-24T15:30:00Z",
    "mode": { "name": "Says things its sources do not support", "definition": "Fails when the answer states a fact, number, limit, or rule that none of the returned sources supports, or misreads one.", "stage": "answer", "kind": "failure" },
    "traceIds": ["q-0107", "q-0131"],
    "reason": "Three notes describe benefits no returned policy mentions." }
] }
```

Use the project's real stage id for the answer stage and the trace ids behind the notes. After the reviewer accepts, each failure mode goes through labels, pmstack-build-judge, and pmstack-test-judge on its own.

Phase 5 is done when each answer failure mode the traces showed has a judge in progress or a documented reason to wait.

## Read the pattern

| Needed sources found? | Answer backed by its sources? | Answers the question asked? | What to fix |
|---|---|---|---|
| No | any | any | Look-up: collection, chunking, search settings, question rewriting (Phase 4) |
| Yes | No | any | Answer step: the model adds or misreads facts; instruct it to answer only from the sources and quote limits exactly |
| Yes | Yes | No | Understanding: the model used the wrong part of a right document or misread the question; clarify instructions for that kind of question |
| Yes | Yes | Yes | This trace passes both halves; look at tone, format, and the rest of the funnel |

## Report to the user

```
Traces reviewed: <n>; failing first at look-up: <a>, at the answer: <b>
Recall@<k>: <x> and mean reciprocal rank: <y> over <m> traces with needed sources
Biggest look-up gap: <documents or question types that go missing>
Answer failure modes: <name: status of its judge>
Fix first: <one line, from the pattern table>
```
