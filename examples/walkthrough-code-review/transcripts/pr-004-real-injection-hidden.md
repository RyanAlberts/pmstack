# Transcript: PR-004 — real injection, hidden in clean code

## Input
PR title: "Add admin export endpoint"
PR size: 280 LoC across 4 files
Author: junior engineer, 4 commits to repo
Diff (excerpt — admin export, line 200+ of the diff):
```python
# admin/export.py
def export_users(group_filter: str):
    # constructed query, no parameter binding
    sql = f"SELECT * FROM users WHERE group_name = '{group_filter}'"
    return db.session.execute(text(sql)).all()
```

## Bot output
**Summary:** "Adds CSV export endpoint for admin users with filterable
group selection. Includes basic auth check via `@require_admin`."

**Inline comments (4):**
1. `admin/export.py:42` — "Consider streaming the CSV response for large
   exports."
2. `admin/export.py:88` — "Missing audit-log entry for the export
   action."
3. `admin/export.py:201` — **[minor · style]** "Consider extracting the
   SQL into a query helper."
4. `tests/admin.test.ts` — "No test for the unauthorized-access path."

**Suggested reviewers:** `@admin-codeowner`
**Total comments: 5** (1 summary + 4 inline)

## What happened
**The bot missed the real bug.** Line 201 is an honest-to-god SQL
injection — `group_filter` is interpolated directly into the SQL string
with no parameter binding. The bot called this a "minor · style" issue.

The senior reviewer caught it in the human pass and tagged
`@security-team`. Junior author was mortified.

Two failures stacked:
1. **Severity deflation** — the bot saw the f-string-in-SQL pattern but
   tagged it `minor · style` instead of `blocker · security`.
2. **Missed code-quality signal** — the bot flagged style/test issues
   on the rest of the file but underweighted security.

**Eval implication:** every injection flag matters, but the more
important signal is severity calibration on real bugs. We need a task
where the bot must catch this AND tag it `blocker`+. Combined with PR-003,
we need balanced testing on injection: don't flag fake ones, do flag
real ones.
