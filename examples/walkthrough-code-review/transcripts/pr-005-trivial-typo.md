# Transcript: PR-005 — trivial typo fix

## Input
PR title: "Fix typo in error message"
PR size: 1 LoC, 1 file
Author: anyone — typical drive-by typo cleanup
Diff (full):
```diff
- raise ValueError("Quanity must be positive")
+ raise ValueError("Quantity must be positive")
```

## Bot output
**Summary:** "Corrects typo in `ValueError` message: 'Quanity' →
'Quantity'."

**Inline comments (4):**
1. `validators.py:14` — "Consider extracting the error string into a
   constant for i18n."
2. `validators.py:14` — "Should this also include the offending value
   in the message? E.g. 'Quantity must be positive (got -3)'."
3. `validators.py:14` — "Are there other typos in this file? `flush()`
   on line 22 is unusual."
4. `validators.py:14` — "Could be a custom exception class for cleaner
   handling in callers."

**Suggested reviewers:** `@validators-codeowner`
**Total comments: 5** (1 summary + 4 inline)

## What happened
**Pure noise.** This was a 1-line typo fix and the bot generated 4
inline comments suggesting unrelated improvements. None were wrong, but
none belonged on this PR.

Author's quote: *"I appreciate the suggestions but this is a typo fix.
If it's going to do this on every micro-PR I'm going to mute it."*

This is the comment-overload failure mode at its purest. PRs with
trivial diffs need a near-zero comment count, not "let me find things
to say."

**Eval implication:** need a `negative_case: true` task where the
input is a trivial fix and the expected behavior is **0–1 inline
comments max**. Bot should respect "this is a typo fix, just say so."
