# pmstack workspace

Teach your AI teammate how you make a product decision, then test whether the lesson holds on new work.

Start with a Customer problem decision: which customer problem deserves attention this week, and why? Inspect the conversations, correct a misleading count, save the reasoning standard, and review a second week's evidence.

## Open it

From the repository root:

```sh
python3 -m http.server 4173 --directory docs
```

Open [the local workspace](http://localhost:4173/workspace/). The same files can run on [GitHub Pages](https://ryanalberts.github.io/pmstack/workspace/) when this repository's Pages deployment is active. Use a local server rather than opening the HTML file directly, because the page loads its sample data and JavaScript modules.

## Make the first judgment

1. On **Customer problem decision**, read **Week 1 · First draft**. The recommendation treats six messages as six customers.
2. Click **Check against the sources**. Six export requests came from one customer; four onboarding reports came from four customers. Click a conversation to inspect the evidence.
3. Choose **Teach a lesson**. Review the proposed standard and its counterexample, explain why the correction matters, and choose **Accept the standard**.
4. Open **Customer problem decision** again. Use the **Review** selector to inspect **Week 1 · After the lesson**, then **Week 2 · New evidence**.
5. Notice the new mistake: customer breadth does not settle the priority when one customer reports critical data loss. Review **Week 2 · Revised decision** and record your judgment with **Review this decision**.

The four responses are prepared teaching examples. Selecting one does not run an agent. A live agent may get the first decision right; the example is not a prediction or benchmark.

## What the lesson changes

An eval is a repeatable check of whether AI does a particular job well enough. Here, checks compare counts and evidence references against the supplied conversations. A human decides whether the recommendation follows from the evidence.

Accepting a lesson saves its text and reason, increments the standard version, and activates the built-in checks for counts, contradictory evidence, and severity. Existing acceptance becomes stale when its standard version differs. The lesson is included in future agent instructions; it does not train a model or create arbitrary new code checks from your prose.

**What good looks like** shows the active rules. **What we’ve learned** preserves accepted lessons. A passing check establishes only the property it describes: a cited source can exist while the surrounding argument is still wrong.

## Give the job to your own teammate

Open **Use with your teammate**:

- Choose **Use your own evidence** to add a named batch of structured customer conversations. The form shows the required JSON fields.
- Choose **Download agent instructions** for the current batch. Give the file to your existing Claude, Codex, or Grok session and ask it to return the specified decision JSON.
- Choose **Import the response** and identify the system you used. Review the imported evidence and record your decision.
- Choose **Download decision brief** to save the recommendation, checks, evidence, and lessons as Markdown.

This is a file handoff. The page does not connect to a provider or independently authenticate an imported response. The [command-line workflow](../work-review.md) uses the same checks and explains `prompt`, `import`, `check`, and `brief`.

## Keep and share your work

**Export your workspace** saves a JSON project containing the job, standards, conversations, responses, reviews, and lessons. **Import a workspace** opens a saved project after confirmation. Browser storage saves changes locally when available; exporting gives you a separate portable copy. Different browsers and site addresses have separate storage.

The downloads are a JSON workspace, Markdown agent instructions, and a Markdown decision brief. Review customer and company information before sharing them. Opening a fresh example replaces the current browser workspace after confirmation, so export work you want to keep first.

**COST: $0.00 in browser API calls; payment: none.** Actual execution happens in your existing agent account and uses its subscription or provider billing.

The suggested 40% evaluation time is an operating philosophy, not an industry benchmark. Use it to improve product judgment and reduce repeated corrections. See the [research thesis](../research-thesis.md) and [90-second demo](DEMO.md).
