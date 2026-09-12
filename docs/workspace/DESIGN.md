# Customer problem decision: design notes

The work artifact is the interface. A PM opens a recommendation with its supporting conversations and decides whether the reasoning is good enough. The useful interaction is correcting that reasoning and testing it against new evidence.

## Layout

The navigation rail holds four destinations: **Customer problem decision**, **What good looks like**, **What we’ve learned**, and **Use with your teammate**. Export and import remain available below them.

The decision page puts customer conversations on the left, the recommendation in the center, and acceptance checks on the right. Source buttons open the original conversation. The count table can reveal source-derived counts directly beneath the agent's numbers. The **Review** selector changes the run while retaining its batch and standard version.

The visual hierarchy uses a light background, a white decision document, dark text, and blue actions. The current stylesheet uses background `#f5f7fb`, ink `#1b2941`, and blue `#335bcc`, with system sans-serif text. Reading the recommendation and evidence takes priority over status decoration.

## Teach where judgment changes

The first sample exposes a specific mistake: repeated messages were treated as distinct customers. **Teach a lesson** asks for the correction and its reason. It shows the built-in checks that will activate and a counterexample before acceptance.

The second week's evidence introduces a critical issue affecting one customer. This prevents the lesson from becoming “always choose the largest customer count.” The user must weigh severity and uncertainty. The prepared revision demonstrates one defensible response; the human review remains explicit.

Saving a lesson versions the standard and includes the lesson in future prompts. It activates existing checks, not a generated grader for arbitrary text. The interface should describe that boundary whenever the user might mistake saved instructions for model training.

## Evidence and acceptance

Prepared responses stay labeled. Imported responses retain a user-supplied system name, but their origin is not independently authenticated. The checker establishes limited facts about supplied data; it cannot establish customer identity, source completeness, every prose claim, or the right business priority.

Failed checks, unresolved factual checks, and stale standards prevent acceptance in the review form. Unresolved checks remain visible in the engine's overall result even if a human records acceptance. A recorded decision and an accepted engine result are distinct states.

## Execution and portability

The browser downloads a job prompt and imports the agent's decision JSON. Existing tools execute the job. The [command-line workflow](../work-review.md) uses the same [decision engine](decision-engine.mjs), avoiding separate browser and terminal grading logic.

JSON preserves the workspace; Markdown carries the prompt and decision brief. There is no browser inference service, unattended scheduler, or separate trace database. The [research thesis](../research-thesis.md) explains why the scope starts with one PM job.

## What still needs user validation

The [demo](DEMO.md) establishes an understandable interaction only if viewers can follow the evidence and correction. It does not establish demand or productivity. Observe whether PMs prefer the resulting decision over their current process, return with new evidence, and need fewer repeated corrections.
