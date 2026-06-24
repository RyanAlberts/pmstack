#!/usr/bin/env python3
"""
pmstack eval-report generator.

Turns a /run-eval result (a run directory, or its summary.md) into a single
self-contained, shareable HTML report — inline CSS, zero external assets, no
JS, no network. A PM drops it in a launch doc or Slack; the footer carries a
"run your own eval" backlink to pmstack.

Reads the always-present summary.md (works on both the machine-written format
from bin/run-eval.py and a hand-authored one) and renders it as a clean page
with a verdict hero, the per-case table (PASS/FAIL color-coded), and the
metrics table. Deterministic: no wall-clock — any date shown comes from the
summary itself.

Usage:
  bin/eval-report.py outputs/eval-runs/my-feature-2026-06-23T1430/
  bin/eval-report.py path/to/summary.md
  bin/eval-report.py <run-dir> --out /tmp/report.html
  bin/eval-report.py <run-dir> --open      # also open in the default browser
"""
from __future__ import annotations

import argparse
import html
import re
import sys
import webbrowser
from pathlib import Path

BACKLINK = "https://github.com/RyanAlberts/pmstack"


def fatal(msg: str, code: int = 2):
    print(f"\n[eval-report] FATAL: {msg}\n", file=sys.stderr)
    sys.exit(code)


def info(msg: str) -> None:
    print(f"[eval-report] {msg}", file=sys.stderr)


def find_summary(path: Path) -> Path:
    if path.is_dir():
        cand = path / "summary.md"
        if not cand.exists():
            fatal(f"no summary.md in {path} — is this a /run-eval output dir?")
        return cand
    if path.is_file():
        return path
    fatal(f"path not found: {path}")


# ── tiny, focused markdown → HTML (enough for a run summary) ──────────────────

def _inline(text: str) -> str:
    """Escape, then apply inline markdown (code, bold, links)."""
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>',
        text,
    )
    return text


def _cell_class(raw: str) -> str:
    """Color a result cell by its leading keyword (PASS/FAIL/CONDITIONAL)."""
    t = re.sub(r"[*`]", "", raw).strip().upper()
    if t.startswith("FAIL"):
        return "fail"
    if t.startswith("PASS"):
        return "pass"
    if t.startswith("CONDITIONAL"):
        return "warn"
    return ""


def _render_table(rows: list[str]) -> str:
    """rows: markdown table lines (header, separator, body...)."""
    def cells(line: str) -> list[str]:
        return [c.strip() for c in line.strip().strip("|").split("|")]

    header = cells(rows[0])
    body = [cells(r) for r in rows[2:]]  # rows[1] is the |---| separator
    out = ["<table>", "<thead><tr>"]
    out += [f"<th>{_inline(h)}</th>" for h in header]
    out += ["</tr></thead>", "<tbody>"]
    for r in body:
        out.append("<tr>")
        for c in r:
            cls = _cell_class(c)
            attr = f' class="{cls}"' if cls else ""
            out.append(f"<td{attr}>{_inline(c)}</td>")
        out.append("</tr>")
    out += ["</tbody>", "</table>"]
    return "\n".join(out)


def md_to_html(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    i, n = 0, len(lines)
    in_list = False

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # table: a header line followed by a |---| separator
        if stripped.startswith("|") and i + 1 < n and re.match(r"^\s*\|[\s|:-]+\|\s*$", lines[i + 1]):
            close_list()
            block = [line]
            j = i + 1
            while j < n and lines[j].strip().startswith("|"):
                block.append(lines[j])
                j += 1
            out.append(_render_table(block))
            i = j
            continue

        if not stripped:
            close_list()
        elif stripped.startswith("### "):
            close_list()
            out.append(f"<h3>{_inline(stripped[4:])}</h3>")
        elif stripped.startswith("## "):
            close_list()
            out.append(f"<h2>{_inline(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            close_list()
            out.append(f"<h1>{_inline(stripped[2:])}</h1>")
        elif stripped == "---":
            close_list()
            out.append("<hr>")
        elif stripped.startswith("> "):
            close_list()
            out.append(f"<blockquote>{_inline(stripped[2:])}</blockquote>")
        elif re.match(r"^[-*]\s+", stripped):
            if not in_list:
                out.append("<ul>")
                in_list = True
            item = re.sub(r"^[-*]\s+", "", stripped)
            out.append(f"<li>{_inline(item)}</li>")
        else:
            close_list()
            out.append(f"<p>{_inline(stripped)}</p>")
        i += 1

    close_list()
    return "\n".join(out)


# ── verdict hero ──────────────────────────────────────────────────────────────

def derive_hero(md: str) -> tuple[str, str, str]:
    """Returns (stat, label, css_class) for the banner."""
    low = md.lower()

    m = re.search(r"P0 pass-rate:\s*(\d+\s*/\s*\d+\s*\(\d+%\))", md, re.IGNORECASE)
    if m:
        stat = "P0 " + re.sub(r"\s+", "", m.group(1))
    else:
        mt = re.search(r"\|\s*P0\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|", md)
        stat = f"P0 {mt.group(1)}/{mt.group(2)}" if mt else ""

    label = ""
    vm = re.search(r"##\s*Verdict\s*\n+(.+)", md)
    if vm:
        label = re.sub(r"[*`]", "", vm.group(1)).strip().rstrip(".")

    if "conditional" in low:
        cls = "warn"
        label = label or "Conditional"
    elif re.search(r"\bfail\b", low) and ("blocks release" in low or "**fail**" in low or re.search(r"\|\s*\**fail", low)):
        cls = "fail"
        label = label or "Release-blocked"
    else:
        cls = "pass"
        label = label or "All clear"
    return stat, label, cls


# ── page assembly ─────────────────────────────────────────────────────────────

CSS = """
:root{--ink:#1a1f29;--muted:#5b6675;--line:#e6e9ef;--bg:#fff;--accent:#2c5fe0}
*{box-sizing:border-box}
body{margin:0;background:#f4f6fa;color:var(--ink);
 font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:40px 24px 64px}
.card{background:var(--bg);border:1px solid var(--line);border-radius:14px;
 padding:32px 36px;box-shadow:0 1px 3px rgba(20,30,50,.05)}
.hero{display:flex;align-items:center;gap:20px;border-radius:12px;padding:20px 24px;margin:0 0 28px;
 border:1px solid var(--line)}
.hero.pass{background:#eafaf0;border-color:#bfe9cf}
.hero.warn{background:#fff7e6;border-color:#f3dca0}
.hero.fail{background:#fdecec;border-color:#f3bcbc}
.hero .stat{font-size:34px;font-weight:700;letter-spacing:-.5px;white-space:nowrap}
.hero.pass .stat{color:#1c7a43}.hero.warn .stat{color:#9a6a00}.hero.fail .stat{color:#b3261e}
.hero .label{font-size:18px;font-weight:600}
.hero .sub{font-size:13px;color:var(--muted);margin-top:2px}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.4px}
h2{font-size:17px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:15px;margin:20px 0 6px}
p{margin:10px 0}ul{margin:10px 0;padding-left:22px}li{margin:4px 0}
blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid var(--accent);
 background:#f6f8fe;color:var(--muted);border-radius:0 6px 6px 0}
code{background:#f0f2f6;padding:1px 5px;border-radius:4px;font-size:.88em}
a{color:var(--accent)}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
td.pass{background:#eafaf0;color:#1c7a43;font-weight:600}
td.fail{background:#fdecec;color:#b3261e;font-weight:600}
td.warn{background:#fff7e6;color:#9a6a00;font-weight:600}
.foot{margin-top:28px;padding-top:18px;border-top:1px solid var(--line);
 display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
 font-size:13px;color:var(--muted)}
.foot .badge{font-weight:600;color:var(--ink)}
.foot a{font-weight:600;text-decoration:none}
"""


def build_html(title: str, body: str, hero: tuple[str, str, str], source: str) -> str:
    stat, label, cls = hero
    hero_html = ""
    if stat or label:
        hero_html = (
            f'<div class="hero {cls}">'
            f'<div class="stat">{html.escape(stat)}</div>'
            f'<div><div class="label">{html.escape(label)}</div>'
            f'<div class="sub">eval run summary · source: {html.escape(source)}</div></div>'
            f"</div>"
        )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<div class="card">
{hero_html}
{body}
<div class="foot">
<span class="badge">📊 Generated by pmstack · /eval-report</span>
<span>Run your own eval → <a href="{BACKLINK}">{BACKLINK.split('//')[-1]}</a></span>
</div>
</div>
</div>
</body>
</html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Render a /run-eval result as a shareable HTML report.")
    ap.add_argument("path", type=Path, help="a run directory or a summary.md")
    ap.add_argument("--out", type=Path, default=None, help="output HTML path (default: report.html next to summary.md)")
    ap.add_argument("--open", action="store_true", help="open the report in the default browser after writing")
    args = ap.parse_args()

    summary = find_summary(args.path)
    md = summary.read_text(encoding="utf-8")
    if not md.strip():
        fatal(f"{summary} is empty")

    title_m = re.search(r"^#\s+(.+)$", md, re.MULTILINE)
    title = title_m.group(1).strip() if title_m else "Eval Run Report"

    body = md_to_html(md)
    hero = derive_hero(md)
    page = build_html(title, body, hero, summary.name)

    out = args.out or (summary.parent / "report.html")
    out.write_text(page, encoding="utf-8")
    info(f"wrote {out}  ({len(page):,} bytes, self-contained)")
    print(str(out))

    if args.open:
        webbrowser.open(out.resolve().as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
