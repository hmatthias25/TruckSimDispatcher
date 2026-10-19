"""Render the Owner-Operator manual to PDF with headless Chrome, then rasterise every page so it can be checked.

The same pipeline as docs/manual/render.py, for the separate Owner-Operator book. Screenshots come from shoot.cjs.
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess

HERE = pathlib.Path(__file__).parent
HTML = HERE / "manual.html"
PDF = HERE / "TruckSim-Owner-Operator-Manual.pdf"
PAGES = HERE / "pages"
CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def render_pdf() -> None:
    if PDF.exists():
        PDF.unlink()
    subprocess.run(
        [
            str(CHROME), "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            f"--user-data-dir={HERE / 'printprof'}", "--no-pdf-header-footer", "--print-to-pdf-no-header",
            f"--print-to-pdf={PDF}", "--virtual-time-budget=25000", HTML.as_uri(),
        ],
        check=True, capture_output=True, timeout=300,
    )
    if not PDF.exists():
        raise SystemExit("Chrome did not produce a PDF")


def rasterise() -> None:
    import fitz

    if PAGES.exists():
        shutil.rmtree(PAGES)
    PAGES.mkdir()
    doc = fitz.open(PDF)
    for i, page in enumerate(doc, start=1):
        page.get_pixmap(dpi=80).save(PAGES / f"page-{i:02d}.png")
    print(f"pdf: {PDF.name}  {PDF.stat().st_size / 1024 / 1024:.2f} MB  {doc.page_count} pages")
    doc.close()


if __name__ == "__main__":
    render_pdf()
    rasterise()
