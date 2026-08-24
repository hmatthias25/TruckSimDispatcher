"""Numbers the pages and rebuilds the contents, from the HTML itself.

Every `.page` div renders to exactly one PDF page, so the page number of anything is just how many
page divs precede it. Doing it here rather than by hand means the contents cannot drift out of date
when a page is inserted — which it already had.

Writes the numbers into the empty `<span class="pn"></span>` in each footer and regenerates the
contents rows in place.
"""
from __future__ import annotations

import pathlib
import re

HERE = pathlib.Path(__file__).parent
HTML = HERE / "manual.html"

text = HTML.read_text(encoding="utf-8")

# --- split into pages, keeping the delimiters
parts = re.split(r'(<div class="page[^"]*">)', text)
# parts[0] is the head; then alternating [open tag, body]
pages: list[tuple[str, str]] = []
for i in range(1, len(parts), 2):
    pages.append((parts[i], parts[i + 1]))

print(f"{len(pages)} page divs")

# --- which section does each page belong to, and is it the section's first page
section_start: dict[int, int] = {}
section_title: dict[int, str] = {}
# Continued pages, per section, in page order: (page, title). These carry most of the manual — around
# two pages in three — and none of them used to appear in the contents at all, so anything on one was
# unfindable unless you already knew it was there.
section_more: dict[int, list[tuple[int, str]]] = {}
for idx, (_, body) in enumerate(pages, start=1):
    m = re.search(r'<div class="kicker">Section\s+(\d+)([^<]*)</div>\s*<h2>(.*?)</h2>', body, re.S)
    if not m:
        continue
    num = int(m.group(1))
    continued = "continued" in m.group(2).lower()
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(3))).strip()
    if not continued and num not in section_start:
        section_start[num] = idx
        section_title[num] = title
    elif continued:
        section_more.setdefault(num, []).append((idx, title))

# --- stamp the page number into each footer
#
# Rewrites whatever is already there rather than filling a one-shot placeholder. The placeholder
# version only worked on the very first run: once it had been substituted there was nothing left to
# match, so every page inserted afterwards silently kept the number of whatever it displaced. The
# footers had drifted several pages out before anyone looked at one.
out_parts = [parts[0]]
stamped = 0
for idx, (open_tag, body) in enumerate(pages, start=1):
    # The cover carries no number.
    n = "" if "cover" in open_tag else str(idx)

    def renumber(m: re.Match) -> str:
        global stamped
        stamped += 1
        return f'{m.group(1)}<span>{n}</span>{m.group(3)}'

    # <div class="pfoot"><span>label</span><span>NN</span></div> — only the trailing number moves.
    body, hits = re.subn(
        r'(<div class="pfoot">\s*<span>.*?</span>\s*)(<span[^>]*>[^<]*</span>)(\s*</div>)',
        renumber, body, count=1, flags=re.S)
    if not hits:
        # Older pages may still carry the empty placeholder.
        body = body.replace('<span class="pn"></span>', f"<span>{n}</span>", 1)
    out_parts.append(open_tag)
    out_parts.append(body)
text = "".join(out_parts)
print(f"{stamped} footer(s) renumbered")

# --- rebuild the contents rows
GROUPS = [
    ("Getting going", [1, 2, 3, 4]),
    ("The daily loop", [5, 6, 7, 8, 9, 10, 11, 12]),
    ("The company", [13, 14, 15, 16, 17, 18, 19, 20, 21]),
    ("Reference", [22, 23, 24]),
]
rows: list[str] = []
for label, nums in GROUPS:
    rows.append(f'    <div class="grp">{label}</div>')
    for n in nums:
        if n not in section_start:
            print(f"  ! section {n} not found")
            continue
        rows.append(
            f'    <div><span class="n">{n}</span>'
            f'<span class="t">{section_title[n]}</span>'
            f'<span class="p">{section_start[n]}</span></div>'
        )
        for page, title in section_more.get(n, []):
            rows.append(
                f'    <div class="sub"><span class="n"></span>'
                f'<span class="t">{title}</span>'
                f'<span class="p">{page}</span></div>'
            )
toc = "\n".join(rows)

text, count = re.subn(
    r'(<div class="toc">\n).*?(\n  </div>)',
    lambda m: m.group(1) + toc + m.group(2),
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("could not find the contents block to rewrite")

HTML.write_text(text, encoding="utf-8")

print("\ncontents rebuilt:")
for label, nums in GROUPS:
    print(f"  {label}")
    for n in nums:
        if n in section_start:
            print(f"    {n:>2}  p{section_start[n]:<3} {section_title[n][:58]}")
            for page, title in section_more.get(n, []):
                print(f"          p{page:<3} {title[:54]}")
