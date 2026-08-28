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

# Pages that go in the USER manual, by index in the source.
#
# The test for each: does somebody who just wants to play need this to get through a day's work? If it
# explains a mechanism rather than telling them what to do, it belongs in Operations.
#
# Deliberately an explicit list rather than a rule over titles — the call is a judgement per page and
# should be reviewable as one.
PLAYER = {
    1, 2,            # cover, contents
    3,               # what this app is, and the rules it holds itself to
    4,               # running it, and where your career file lives
    5, 6,            # getting hired, your first day
    7,               # THE LOOP, END TO END — the spine of the book
    8, 9,            # reporting from the game; after a delivery you usually just confirm
    10, 11, 12,      # the four clocks, reporting them, reading them off a screenshot
    18, 19,          # the board: the dock first, then the city
    21,              # how a load is judged
    23,              # appointments, and the receiver who takes you early
    26, 27,          # running the load; reporting after you load
    28, 29,          # closing out; clocks at delivery
    35,              # the audit, and whose fault it was
    37, 40, 48,      # home time: what it is, choosing it, what to do at the yard
    51,              # garages, equipment and the trade cycle
    53, 55,          # money; reporting the balance
    56, 57,          # payroll; the pay stub
    58,              # maintenance and work orders
    66,              # safety: incidents, discipline, being forgiven
    72,              # career, promotion and changing carriers
    78, 84,          # hired drivers and the fleet report; filling it in
    98, 99, 100,     # settings, if something looks wrong, credits
}

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

    player = [(i, p) for i, p in enumerate(pages, 1) if i in PLAYER]
    ops = [(i, p) for i, p in enumerate(pages, 1) if i not in PLAYER]

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
