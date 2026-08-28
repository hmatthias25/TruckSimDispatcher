# The manuals

Two PDFs ship in the release zip, and both are generated from one source:

| | |
|---|---|
| **TruckSim-Dispatcher-User-Manual.pdf** | ~37pp. Somebody who wants to play: get set up, run the loop, know what to type. |
| **TruckSim-Dispatcher-Operations-Manual.pdf** | ~65pp. Somebody who wants to know how it works: every threshold, every mechanism, and the reasoning. |

**`manual-full.html` is the source. Edit that.** `manual.html` and `operations.html` are both written
by `split.py` and any change made to them directly is lost on the next split.

The split exists because the single manual reached a hundred pages. It was not padded — the median
page was 81% full, 39 pages were over 90% full, and only 4% of the prose was design history. It was
long because the app is deep and every rule got explained as well as stated. Splitting by *who is
reading* rather than by what/why is what made it tractable; nothing was deleted.

One `<div class="page">` is one printed page, each a fixed 8.5x11in box with `overflow:hidden`. That
is why the checker below exists: content too tall for a page is silently cut off in the PDF rather
than reflowing, so it is invisible unless something measures it. It is also why shrinking the type
does **not** shorten a book — it just leaves white space at the bottom of every page.

## Prerequisites

| | |
|---|---|
| Python | 3.13, with `PyMuPDF` (`pip install pymupdf`) — `render.py` uses it to rasterise |
| Chrome | at `C:\Program Files\Google\Chrome\Application\chrome.exe` (path is hardcoded in `render.py`) |
| Node | for `checkpages.cjs` and the capture scripts, which drive Chrome over CDP |

## Building it

```sh
python split.py                     # manual-full.html -> manual.html + operations.html
python paginate.py manual.html      # renumber footers + rebuild that book's contents
python render.py   manual.html      # Chrome --headless -> PDF, then PyMuPDF -> pages/page-NN.png
python paginate.py operations.html
python render.py   operations.html  # -> pages-operations/page-NN.png
```

`split.py` holds the page classification as an explicit set of source page numbers, `PLAYER`. Moving a
page between the books is a one-line edit to that set — which is the point of keeping it as a list
rather than a rule over titles.

`paginate.py` derives every page number by counting the `.page` divs that precede it, so inserting a
page cannot leave the contents stale. Run it after any edit that adds or removes a page. It also
picks up "Section N, continued" pages as sub-rows in the contents.

`render.py` writes the matching PDF here, then rasterises each page to `pages/` (or
`pages-operations/`) at ~110dpi so the layout can be looked at instead of assumed.

## Checking for clipped pages, without a browser

A page whose content overruns is cut off silently. The quickest check needs no CDP session: render,
then look for dark pixels in the middle of the footer band, where a clean page has only the section
name at far left and the number at far right.

```python
im = Image.open(png).convert("L"); w, h = im.size
band = im.crop((int(w*0.21), int(h*0.962), int(w*0.75), int(h*0.995)))
clipped = sum(1 for v in band.getdata() if v < 140) > 40
```

The cover always trips it and always should — it has no footer.

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
