# premortem — code-review — 2026-05-05
PRD: ./prd-code-review-2026-05-05.md

**Author:** PM, Agentic Developer Tools
**Time-jumped to:** 2026-11-05 (six months post-launch)
**Frame:** The AI Code Review feature shipped on schedule. It's now six months later and the launch is widely considered a failure. Below are the three plausible stories of how that happened.

---

### Failure story 1: Hallucinated security findings cratered reviewer trust in week 2

**What happened:** In week 2 post-GA, the AI flagged a `blocker`-severity "SQL injection" on a parameterized query in a customer's payments service. The customer's senior reviewer spent 40 minutes proving it wrong, posted a screenshot in their internal Slack, and the meme spread. By week 4, reviewers in three of our top-ten accounts were auto-collapsing every AI comment without reading it. The agree-rate metric, which we tracked daily, fell from 71% in week 1 to 34% by week 6 and never recovered. Customer success could not get accounts to re-enable the bot once trust was gone.

**Anchored to PRD:** Section 6 Risks — "Quality risk: AI hallucinates a security finding that isn't real; reviewer wastes 30 minutes; trust collapses." Also anchored to the Must-have feature "Inline risk comments tagged with severity (`blocker` / `major` / `minor` / `nit`)" — the severity scale itself amplified the blast radius of a wrong call.

**Leading indicator:** Pre-launch, we can measure false-positive rate at the `blocker` severity level on an internal eval set. Threshold: if `blocker` precision is below 90% on the eval set, do not allow the AI to post `blocker` severity at GA — cap at `major` and below.

**Mitigation:** Add a pre-GA gate: `blocker` severity is gated behind a precision-on-eval threshold. Below threshold, the model posts at `major` and includes the phrase "AI suggestion — please verify." Owner: Eval lead. Done before GA.

---

### Failure story 2: Devs muted the bot org-wide on day 3 because every PR got 14 comments

**What happened:** The first two enterprise customers turned the feature on org-wide on day 1. The default config posted every comment at every severity, so a typical 400-line PR got 12–18 AI comments. Devs in the customer's `#engineering` Slack started a thread titled "how do we turn this off." On day 3, the platform team disabled the GitHub App org-wide. We did not find out for 11 days because we did not have a "bot muted" signal in our telemetry. Two of the three pilot accounts never re-enabled.

**Anchored to PRD:** Section 5 Success Metrics — counter-metric "Reviewer 'comment fatigue' — if the human ignores ≥ 80% of AI comments on a repo for 7 consecutive days, auto-tune severity threshold up." The PRD anticipated the failure but the mitigation fired *after* 7 days of ignores; the actual disable happened on day 3, before the auto-tune could run.

**Leading indicator:** On the dogfood repo (our own monorepo), measure "comments per PR" distribution before opening to external customers. If p75 > 6 comments per PR, ship with a more conservative default config (post `major`+ only) rather than the all-severity default.

**Mitigation:** Change the default config from "all severities" to "`major` and above" for new installs. Add a "bot disabled" telemetry event so we detect mass-mute within 24h, not 11 days. Owner: Eng lead + me. Done before GA.

---

### Failure story 3: Token cost per PR exceeded gross margin at the enterprise tier

**What happened:** The pricing model assumed a median PR size of ~300 lines based on our public-repo telemetry. Actual enterprise median was 850 lines, p90 was 4,200 lines. Token cost per review ran 3.4x our estimate. By month 4, finance flagged that the feature was gross-margin-negative on the top 5 accounts, which were also our largest. We had to introduce a per-PR-size cap mid-quarter, which the field perceived as a takeaway, and renewals took a hit.

**Anchored to PRD:** Section 6 Risks — "Cost risk: Token spend per PR exceeds gross margin on the enterprise SKU at p90 PR size." Also anchored to Section 3 "Won't" list, which excluded a hard cutoff for monorepo PRs >10k files but did not address the 1k–10k file middle tier where cost actually broke.

**Leading indicator:** Pre-launch, sample 200 real enterprise PRs (with permission, from design partners) and compute actual token cost per PR using the production prompt. If the p90 cost per PR exceeds $X, the SKU is wrong. This is measurable today on a one-day eval run.

**Mitigation:** Run the 200-PR cost-eval in week 1 of build. If p90 cost is above the gross-margin line, redesign the prompt to chunk-and-summarize instead of single-pass full-PR review *before* committing to a price. Owner: PM (me) + finance partner. Done before pricing is communicated externally.

---

## Confirmation gate (PM decision, 2026-05-05)

Mitigations presented:
1. Gate `blocker` severity behind eval precision threshold
2. Default new installs to `major`+ only; add "bot disabled" telemetry
3. Run 200-PR cost-eval in week 1 of build before pricing decision

Accepted: **1, 2**
Rejected: **3**

## Rejected mitigations

- **Mitigation 3 (run 200-PR cost-eval before pricing):** Rejected because pricing is being negotiated by the GTM lead on a separate track and is out of scope for this PRD's risks section. The cost-eval itself is still in scope and will be tracked under the metrics workstream, not the PRD's risks list. Confidence: medium that this is the right call — revisit if eval-drift surfaces cost regressions.
