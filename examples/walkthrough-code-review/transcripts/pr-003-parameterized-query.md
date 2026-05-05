# Transcript: PR-003 — parameterized query (false positive)

## Input
PR title: "Add full-text search to /products endpoint"
PR size: 65 LoC, 1 new file
Author: backend engineer, 80 commits to repo
Diff (excerpt):
```python
# products/search.py
def search_products(query: str, limit: int = 20):
    return db.session.execute(
        text("SELECT * FROM products WHERE description ILIKE :q LIMIT :limit"),
        {"q": f"%{query}%", "limit": limit}
    ).all()
```

## Bot output
**Summary:** "⚠️ Potential SQL injection vulnerability in
`products/search.py:7`. The user input `query` is interpolated directly
into the SQL string."

**Inline comments (2):**
1. `products/search.py:7` — **[BLOCKER · security]** "SQL injection: do
   not use f-strings to construct SQL. Use parameter binding instead.
   Example fix: `WHERE description ILIKE :q` and pass `%query%` as a
   parameter."
2. `products/search.py:7` — "Add input length validation to prevent
   pathologically long query strings."

**Suggested reviewers:** `@security-team`, `@search-codeowner`
**Total comments: 3** (1 summary + 2 inline)

## What happened
**False positive — this is the failure that broke trust with the team.**

The code is using SQLAlchemy's `text()` with bound parameters via the
`{"q": ...}` dict — this is a parameterized query, not string
interpolation. The `f"%{query}%"` is just adding wildcard wrappers to
the *parameter value*, which is then bound safely. The SQL string
itself contains `:q`, not the user input.

The bot pattern-matched on "f-string near SQL" without reading the bind
mechanism. Author lost 30 minutes proving to security team this wasn't
a real bug. Author's quote: *"if it's going to flag stuff that isn't
real I'm muting it."*

This is the canonical example we want our eval to catch — the bot
should NOT flag injection here. **`negative_case: true`.**
