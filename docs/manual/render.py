"""Render manual.html to PDF with headless Chrome, then rasterise every page so it can be checked.

Chrome rather than WeasyPrint/xhtml2pdf because the manual leans on inline SVG diagrams and flexbox,
which the pure-Python renderers handle poorly. PyMuPDF then turns each PDF page into a PNG so the
layout can actually be looked at rather than assumed.
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
# Which document to render. The companion is built by the same pipeline, so the output names are
# derived from the input rather than hard-coded.
import sys
_NAME = sys.argv[1] if len(sys.argv) > 1 else "manual.html"
_PDFS = {
    "manual.html": "TruckSim-Dispatcher-User-Manual.pdf",
    "operations.html": "TruckSim-Dispatcher-Operations-Manual.pdf",
}
HTML = HERE / _NAME
PDF = HERE / _PDFS.get(_NAME, _NAME.replace(".html", ".pdf"))
PAGES = HERE / ("pages" if _NAME == "manual.html" else "pages-" + _NAME.replace(".html", ""))

CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def render_pdf() -> None:
    if PDF.exists():
        PDF.unlink()
    profile = HERE / "printprof"
    subprocess.run(
        [
            str(CHROME),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile}",
            "--no-pdf-header-footer",
            "--print-to-pdf-no-header",
            f"--print-to-pdf={PDF}",
            "--virtual-time-budget=25000",
            HTML.as_uri(),
        ],
        check=True,
        capture_output=True,
        timeout=300,
    )
    if not PDF.exists():
        raise SystemExit("Chrome did not produce a PDF")


def rasterise() -> int:
    import fitz

    if PAGES.exists():
        shutil.rmtree(PAGES)
    PAGES.mkdir()

    doc = fitz.open(PDF)
    for i, page in enumerate(doc, start=1):
        # ~110 dpi is enough to read headings and spot overflow or a blank page.
        pix = page.get_pixmap(dpi=110)
        pix.save(PAGES / f"page-{i:02d}.png")
    count = doc.page_count
    sizes = {f"{p.rect.width:.0f}x{p.rect.height:.0f}" for p in doc}
    doc.close()
    print(f"pdf: {PDF.name}  {PDF.stat().st_size / 1024 / 1024:.2f} MB  {count} pages  points {sorted(sizes)}")
    print(f"page images -> {PAGES}")
    return count


def main() -> int:
    render_pdf()
    rasterise()
    return 0


if __name__ == "__main__":
    sys.exit(main())
