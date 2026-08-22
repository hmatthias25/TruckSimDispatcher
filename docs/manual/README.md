# The user manual

Source for **TruckSim-Dispatcher-User-Manual.pdf**, the PDF that ships inside the release zip.

`manual.html` is the whole manual — one `<div class="page">` per printed page, each a fixed 8.5x11in
box with `overflow:hidden`. That last detail is why the checker below exists: content too tall for a
page is silently cut off in the PDF rather than reflowing, so it is invisible unless something
measures it.

## Prerequisites

| | |
|---|---|
| Python | 3.13, with `PyMuPDF` (`pip install pymupdf`) — `render.py` uses it to rasterise |
| Chrome | at `C:\Program Files\Google\Chrome\Application\chrome.exe` (path is hardcoded in `render.py`) |
| Node | for `checkpages.cjs` and the capture scripts, which drive Chrome over CDP |

## Building it

```sh
python paginate.py      # renumber footers + rebuild the contents from the HTML itself
python render.py        # Chrome --headless -> PDF, then PyMuPDF -> pages/page-NN.png
```

`paginate.py` derives every page number by counting the `.page` divs that precede it, so inserting a
page cannot leave the contents stale. Run it after any edit that adds or removes a page. It also
picks up "Section N, continued" pages as sub-rows in the contents.

`render.py` writes `TruckSim-Dispatcher-User-Manual.pdf` here, then rasterises each page to
`pages/` at ~110dpi so the layout can be looked at instead of assumed.

## Checking it

```sh
# Chrome must already be listening on 9222:
chrome.exe --remote-debugging-port=9222 --user-data-dir=docs/manual/chromeprof
node checkpages.cjs
```

Reports any page whose content overflows its fixed height (the silent-clipping case) and any image
that failed to load. A clean run is the gate before shipping a PDF.

## Screenshots

`img/` holds all of them, flat, because both `manual.html` and the capture scripts expect them there.
26 are placed in the manual; the other 10 are the **full-page originals** the crops were cut from —
`active-full`, `active-header`, `dispatch-full`, `fleet-full`, `fleetops`, `payday-modal`, `payroll`,
`safety`, `terminals`, `trips`. They are kept so a shot can be re-cropped without standing up a demo
career again.

To recapture: the `demo*.cjs` scripts build a demo career against a running app, the `shoot*.cjs`
scripts drive Chrome over CDP and write full-page PNGs to `shots/`, and `prep_images.py` crops them
into `img/`. These were written incrementally as the manual grew and overlap somewhat — `shootall.cjs`
is the broad sweep, `shootnew.cjs` and `shootone.cjs` are for topping up individual screens.

Careers created by those scripts land in `demodata*/` and are gitignored, like every other career
file — see the note in the root `.gitignore`.

## Shipping

`build.ps1` does **not** copy the PDF into the release zip. Build the manual first, then add the PDF
to the zip alongside the exe.
