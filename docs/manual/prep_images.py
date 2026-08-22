"""Prepare the app screenshots for print.

Three problems to solve:

1. Shots are captured at deviceScaleFactor 2, so some are 3000 px wide and megabytes each. Print
   needs roughly 200 dpi over a 6.5 in column, so ~1400 px is plenty.
2. Whole-tab captures are 3:1 tall. Scaled to fit a page they become a thumbnail nobody can read, so
   they are cropped to the top of the tab instead — which is the part being described anyway.
3. One form (the close-out) is worth showing in full but is far too tall for a single page, so it is
   split into two images that each fill a column properly.
"""
from __future__ import annotations

import pathlib
from PIL import Image

HERE = pathlib.Path(__file__).parent
SRC = HERE / "shots"
DST = HERE / "img"
DST.mkdir(exist_ok=True)

MAX_W = 1400

# Whole-tab captures: keep the top of the page at a readable aspect rather than shrinking it all.
TOP_CROP = {
    "active-full": 1.40,
    "career": 1.30,
    "dispatch-full": 1.45,
    "finances": 1.30,
    "fleet-full": 1.35,
    "maintenance": 1.25,
    "packet": 1.15,
    "payroll": 1.30,
    "safety": 1.25,
    "settings": 1.30,
    "terminals": 1.35,
    "trips": 1.10,
    "fleetops": 1.30,
}

# Tall forms worth showing entirely: split into equal parts, with a little overlap for continuity.
SPLIT = {"active-closeout": 2}

rows: list[tuple[str, str, str, str]] = []


def save(im: Image.Image, name: str) -> None:
    w, h = im.size
    if w > MAX_W:
        im = im.resize((MAX_W, int(h * MAX_W / w)), Image.LANCZOS)
    out = DST / f"{name}.png"
    im.save(out, "PNG", optimize=True)
    rows.append((name, f"{im.size[0]}x{im.size[1]}", f"{im.size[1] / im.size[0]:.2f}",
                 f"{out.stat().st_size / 1024:.0f} KB"))


for png in sorted(SRC.glob("*.png")):
    stem = png.stem
    im = Image.open(png).convert("RGB")
    w, h = im.size

    if stem in SPLIT:
        parts = SPLIT[stem]
        overlap = int(h * 0.015)
        step = h // parts
        for i in range(parts):
            top = max(0, i * step - (overlap if i else 0))
            bottom = min(h, (i + 1) * step + (overlap if i < parts - 1 else 0))
            save(im.crop((0, top, w, bottom)), f"{stem}-{i + 1}")
        continue

    if stem in TOP_CROP:
        target_h = int(w * TOP_CROP[stem])
        if target_h < h:
            im = im.crop((0, 0, w, target_h))
        save(im, stem)
        continue

    save(im, stem)


name_w = max(len(r[0]) for r in rows)
print(f"{'image'.ljust(name_w)}  {'print px':>11}  {'h/w':>5}  {'size':>8}")
for r in sorted(rows):
    print(f"{r[0].ljust(name_w)}  {r[1]:>11}  {r[2]:>5}  {r[3]:>8}")

total = sum(f.stat().st_size for f in DST.glob("*.png")) / 1024 / 1024
print(f"\n{len(rows)} images, {total:.1f} MB in {DST}")
