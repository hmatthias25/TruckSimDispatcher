"""Split the one big manual into two books, on the line between playing and understanding.

The manual reached a hundred pages. It is not padded — the median page is 81% full, 39 pages are over
90% full, and only 4% of the prose is design history. It is long because the app is deep and every rule
gets explained as well as stated.

The split is therefore not "what" versus "why". It is **who is reading**:

  User Manual         somebody who wants to play. Get set up, run the loop, know what to type and what
                      the app will tell you. Followable start to finish in an evening.

  Operations Manual   somebody who wants to know how it works. Every threshold, every mechanism, the
                      edge cases, and the reasoning behind the rules the first book simply states.

`manual-full.html` is the single source and the file to edit. Both books are generated:

    python split.py
    python paginate.py manual.html     && python render.py manual.html
    python paginate.py operations.html && python render.py operations.html
"""
from __future__ import annotations

import pathlib
import re

HERE = pathlib.Path(__file__).parent
SOURCE = HERE / "manual-full.html"

# Pages that go in the USER manual, by their HEADING.
#
# Headings, not page numbers. The first cut keyed on the index, and every page inserted afterwards
# shifted everything below it — so the two books quietly drifted apart and shipped wrong. A heading
# survives an insertion above it; a number does not.
#
# The test for each: does somebody who just wants to play need this to get through a day's work? If it
# explains a mechanism rather than telling them what to do, it belongs in Operations.
PLAYER_TITLES = {
    # getting going
    "TruckSimDispatcher",
    "Contents",
    "What this app is, and the rules it holds itself to",
    "Running it, and where your career file lives",
    "Getting hired \u2014 the application and the carrier market",
    "Where you stand, and when to apply",
    "Who is worth keeping, and what is worth running",
    "Probation, and who decides a sacking",
    "Your first day: what to buy and set up",
    # the daily loop
    "The loop, end to end",
    "Reporting from the game",
    "After a delivery you usually just confirm",
    "Hours of service \u2014 the four clocks",
    "Reporting and reading your clocks",
    "Reading your clocks off a screenshot",
    "The board: the dock first, then the city",
    "Stage two: the city board",
    "The other clock: how long the listing lasts",
    "How a load is judged",
    "Turning a load down",
    "Appointments, and the receiver who takes you early",
    "Running the load: the trip log and fuel stops",
    "Reporting after you load, and getting stuck at a dock",
    "Closing out, and never typing a number twice",
    "The empty miles between two loads",
    "Clocks at delivery, and the carry-forward",
    "The audit, and whose fault it was",
    # the company
    "Home time",
    "Choosing and changing your arrangement",
    "What to do when you get in",
    "Garages, equipment and the trade cycle",
    "Money \u2014 one bank account, two sets of obligations",
    "Reporting the balance",
    "Fuel: what it pays to be good at",
    "Payroll \u2014 payday is Friday",
    "The pay stub",
    "The tax year and your W-2",
    "Maintenance and work orders",
    "Where the damage lines put you",
    "Running the GDC service schedule",
    "What the company buys, and what counts as better",
    "Safety: incidents, discipline, and being forgiven",
    "Career, promotion and changing carriers",
    "Hired drivers and the fleet report",
    "Filling the review in",
    # reference
    "Settings, backups and updating the app",
    "If something looks wrong",
    "Credits",
}


def title_of(page: str) -> str:
    """The page's heading, normalised the way PLAYER_TITLES is written."""
    m = re.search(r"<h2>(.*?)</h2>", page, re.S) or re.search(r"<h1>(.*?)</h1>", page, re.S)
    if not m:
        return ""
    text = re.sub(r"<[^>]+>", "", m.group(1))
    text = (text.replace("&mdash;", "\u2014").replace("&ndash;", "\u2013")
                .replace("&middot;", "\u00b7").replace("&rarr;", "\u2192")
                .replace("&amp;", "&").replace("&rsquo;", "\u2019"))
    return re.sub(r"\s+", " ", text).strip()


OPS_COVER = """<div class="page">
  <div class="kicker">TruckSim Dispatcher</div>
  <h1>Operations<br>Manual</h1>
  <div class="rulebar"></div>
  <p class="lede">How it works, and why it works that way: every threshold, every mechanism, and the
    failure each rule was built to prevent.</p>

  <div class="note">
    <h4>You do not need this to play</h4>
    <p>The <b>User Manual</b> is the one to read first. It gets you set up, walks the loop end to end,
      and tells you what to enter and what the app will say back. You can run a career on it alone.</p>
    <p style="margin-top:6pt">This book is for when you want to know what is going on underneath &mdash;
      why home time narrows the later you run, why wear is measured per thousand miles, why a driver
      cannot defer a repair, how a dock time is learned.</p>
  </div>

  <div class="rule">
    <h4>How the two fit together</h4>
    <p>They are numbered against each other. A page here headed <b>From Section 13</b> goes behind
      Section 13 of the User Manual, so anything the first book states in a sentence can be followed
      here to the end.</p>
    <p style="margin-top:6pt"><b>Nothing was deleted in the split.</b> Every word that was in the single
      manual is in one of these two books.</p>
  </div>

  <div class="pfoot"><span>Operations Manual</span><span class="pn"></span></div>
</div>

<div class="page">
  <h2>Contents</h2>
  <div class="toc">
  </div>

  <div class="note" style="margin-top:10pt">
    <p style="margin:0">Section numbers are the <b>User Manual's</b>. A page here headed
      <b>From Section 13</b> belongs behind that book's Section 13, so the two can be read side by
      side.</p>
  </div>

  <div class="pfoot"><span>Operations Manual</span><span class="pn"></span></div>
</div>
"""


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")

    parts = re.split(r'(<div class="page[^"]*">)', text)
    head = parts[0]
    pages = [parts[i] + parts[i + 1] for i in range(1, len(parts), 2)]

    # The closing </body></html> rides on the final page. Take it off so each book adds its own.
    pages[-1] = pages[-1].split("</body>")[0].rstrip() + "\n"
    tail = "\n</body>\n</html>\n"

    titled = [(i, p, title_of(p)) for i, p in enumerate(pages, 1)]

    # A page with no h1/h2 has nothing to key on, so it fell through to Operations by default — which
    # is a page silently changing books, the exact failure this rewrite exists to stop. It looked like
    # a working continuation page in the source and only showed up as a page count that went the wrong
    # way. Every page carries a heading, or the split does not happen.
    untitled = [i for i, _, ti in titled if not ti]
    if untitled:
        raise SystemExit("split.py: page(s) with no <h2> heading: "
                         + ", ".join(str(i) for i in untitled)
                         + "\n\nA page with no heading cannot be assigned to a book. Give it an <h2> and, "
                           "if it belongs to the User Manual, add that heading to PLAYER_TITLES.")

    player = [(i, p) for i, p, ti in titled if ti in PLAYER_TITLES]
    ops = [(i, p) for i, p, ti in titled if ti not in PLAYER_TITLES]

    # A heading that no longer matches anything is a page silently changing books, which is exactly the
    # failure this rewrite exists to stop. Fail loudly instead.
    missing = PLAYER_TITLES - {ti for _, _, ti in titled}
    if missing:
        raise SystemExit("split.py: these headings are in PLAYER_TITLES but not in the source:\n  "
                         + "\n  ".join(sorted(missing))
                         + "\n\nRetitled a page? Update the set. Do not let the books drift.")

    # A page in Operations says "Section 19, continued", which means nothing in a different book.
    # "From Section 19" points back at where it belongs.
    def relabel(p: str) -> str:
        p = re.sub(r'<div class="kicker">Section (\d+), continued</div>',
                   r'<div class="kicker">From Section \1</div>', p)
        return re.sub(r'<div class="kicker">Section (\d+)</div>',
                      r'<div class="kicker">From Section \1</div>', p)

    # The contents page of the User Manual should say that the depth exists somewhere, or a reader
    # who wants it will conclude it was never written.
    pointer = '''
  <div class="rule" style="margin-top:8pt">
    <h4>If you want to know how it works</h4>
    <p>This book tells you what to do. The <b>Operations Manual</b> that ships beside it tells you why
      &mdash; every threshold, every mechanism, and the failure each rule was built to prevent. You do
      not need it to play, and nothing here depends on having read it.</p>
    <p style="margin-top:6pt">It is numbered against this one: a page there headed <b>From Section 13</b>
      belongs behind Section 13 here.</p>
  </div>
'''
    body = "".join(p for _, p in player)
    marker = '<div class="pfoot"><span>TruckSim Dispatcher'
    at = body.find(marker)
    if at > 0:
        body = body[:at] + pointer + "\n  " + body[at:]

    (HERE / "manual.html").write_text(head + body + tail, encoding="utf-8", newline="")

    (HERE / "operations.html").write_text(
        head.replace("TruckSim Dispatcher — User Manual", "TruckSim Dispatcher — Operations Manual")
        + OPS_COVER + "".join(relabel(p) for _, p in ops) + tail,
        encoding="utf-8", newline="")

    print(f"user manual        {len(player):>3} pages")
    print(f"operations manual  {len(ops) + 1:>3} pages (including its cover)")

    def title(p: str) -> str:
        h = re.search(r"<h2>(.*?)</h2>", p, re.S) or re.search(r"<h1>(.*?)</h1>", p, re.S)
        return re.sub(r"<[^>]+>|&mdash;|&middot;", "", h.group(1)).strip() if h else "(untitled)"

    print("\nUSER MANUAL:")
    for i, p in player:
        print(f"  p{i:<4} {title(p)[:64]}")


if __name__ == "__main__":
    main()
