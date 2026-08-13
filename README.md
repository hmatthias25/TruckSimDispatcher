# TruckSim Dispatcher

A dispatch office for American Truck Simulator. You are a company driver; the app is the carrier —
operations, safety, maintenance and accounting. It decides what you haul, checks it against your
hours before you hook, audits every trip, and pays you.

Single portable `.exe`. No install, no runtime, no internet.

> Original idea by **SimRacerSteve** on Discord — the company-driver roleplay this app automates is his.

---

## Running it

Double-click **`TruckSimDispatcher.exe`**. A console window opens and your browser opens with it.
Leave the console open while you play; Ctrl+C shuts it down.

It creates a `data` folder beside the exe holding `career.json` plus rotating backups. Copy the whole
folder to another machine and the career goes with it.

- SmartScreen may warn once (unsigned) — *More info → Run anyway*.
- If the exe is blocked by policy, or the folder is read-only, the app falls back to
  `%LOCALAPPDATA%\TruckSimDispatcher\data`. Override with the `TSD_DATA_DIR` environment variable.
- `--port 5199` to pick a port, `--no-browser` to skip launching one.

---

## Before your first load

**You start with one small garage and one truck** — what a fresh ATS profile can afford. That is a
starting point, not a ceiling. Seed cash with an editor, buy the large garage, set the yard to Large
on the Terminals tab, and use **Fleet → Stock a yard** to put a five-truck fleet in it in one step.
Yard tier sets capacity the way the ATS garage upgrades do: Small 1, Medium 3, Large 5.

**What money cannot buy you is coverage.** ATS only generates cargo for cities you have actually
*driven to*. Reveal a city with a save editor and it still counts as undiscovered — it appears on the
map and never offers a single job. A yard bought there would sit empty and a truck based there would
have nothing to haul.

So the network grows the way a real carrier's does. Run out of your home yard, and when you reach
somewhere new the app tells you a garage is for sale there and whether the freight is worth it. Buy
it in game, add it on the Terminals tab, base trucks there.

For seeding cash: money lives in
`Documents\American Truck Simulator\profiles\<profile>\save\<slot>\game.sii`, which is encrypted —
SII_Decrypt opens it, TS SE Tool is a dedicated editor. Mods can unlock all dealerships and
recruiting agencies, which ATS otherwise hides until you drive past them.

> **Back up your profile folder before running any editor.** Editors can corrupt a save, TS SE Tool
> is alpha software, and SCS cannot support a modified save because they cannot tell what changed.

The app gives you a numbered setup checklist the moment you are hired.

---

## The loop

| Step | Where | What happens |
|---|---|---|
| Report status | Dispatch | Game day/time, location, fuel, damage, odometer, ATS bank balance |
| Report clocks | Dispatch | Drive / shift / break / cycle, exactly as your HOS display shows |
| Show the board | Dispatch | Type the jobs, or paste board screenshots |
| Evaluate & assign | Dispatch | Operations picks one load, or rejects the board and says why |
| Authorize | Dispatch | Trip number issued, plan captured |
| Run it | Active Load | Log loaded / fuel / break / rest / arrived |
| Close it out | Active Load | Miles, every fuel stop, tolls, damage, detention, and your clocks |
| Audit | Active Load | Service, fault, money, equipment, pay lines, what happens next |
| Settle | Payroll | Wages paid, bonuses calculated across the period |

### Rules the dispatcher holds itself to

- Feasibility is confirmed **before** you hook, never after.
- No load is planned to consume every remaining minute of HOS.
- Your HOS display is authoritative. The app never invents clock values.
- A load booked too tight is **dispatcher fault** when it runs late, not yours.
- It will reject an entire board rather than commit the truck to bad freight.

---

## Things worth knowing

**The clock is day numbers.** ATS has no calendar, so everything reads `Day 12 · 14:30`.

**Your ATS bank balance is the company's money.** The game already deducts fuel, repairs, garages,
trucks and hired-driver wages from it, so the books reconcile to it. Report it on the Dispatch tab.
Maintenance and payroll reserves are earmarks against that one balance, not separate pots.

**Your wages exist only here.** ATS has no concept of paying its owner a per-mile rate, so driver pay
is tracked in this app and never touches your game balance.

**Thresholds come from your own costs.** The floor a load must clear is your computed break-even —
fuel ÷ mpg, plus your CPM, plus overhead over the miles. If everything is being rejected, go to
**Finances → Cost model → Calibrate to my market**. On a scaled map, overhead per load is usually
the culprit.

**You report a number once.** Closing a load already tells operations where you are, your fuel,
damage and odometer — so the Dispatch tab inherits all of it and you just confirm. Report your HOS
clocks in the same close-out and dispatch will not ask for them again either.

**Fuel is recorded per stop.** A long run fuels two or three times at different prices. Log each fill
from the trip log as you make it and it is already on the close-out; the audit gives you the blended
price and flags a lane worth planning fuel around.

**Cities have to be discovered.** See above — this is why the app tracks where you have been and only
suggests yards in cities that will actually offer freight.

**You get re-rigged at home sometimes.** Occasionally — roughly one home time in three, and never on
your first trip home — operations puts you on a different trailer for the next tour. If the trailer
you need is out with one of your hired drivers, you wait at the yard until they bring it in, and that
wait is part of your home time rather than your hours. If the company owns nothing suitable, you buy
one in game while you are home.

**Home time is a promise, not a note.** You pick an arrangement when you sign on — weekly through six
weeks, or none. Dispatch tracks days out and, as the date approaches, loads finishing near your home
yard start outranking better-paying freight going the other way. When a load is your ride home it says
so, tells you to report to the yard once you are empty, and lists what to put through the shop while
the truck is sitting.

**Equipment lives in garages.** Each yard holds what its tier allows (Small 1, Medium 3, Large 5).
When operations sends you to a yard for a better truck, it is a straight exchange — the unit you hand
in becomes based there, the one you take comes onto your home yard's book, and the app does that
bookkeeping when you mark the order complete.

**Damage is only tracked for equipment ATS knows about.** Units marked *in garage* have real
condition; the rest are company backdrop and never get invented damage or a shop directive you
could not act on.

**Hired drivers report on a cycle.** Every 15 game days the app asks for each AI driver's revenue,
miles and equipment damage. Anything over your review threshold gets a work order raised
automatically.

---

## Playing with Claude

**Dispatch Packet** tab → *Full packet* → copy. Paste it into a chat and the roleplay resumes with
full continuity — carrier, driver file, equipment, clocks, money, safety record, trip history.

Optionally, **Settings → In-app dispatcher** takes an Anthropic API key
([console.anthropic.com](https://console.anthropic.com) → API Keys) and the app writes dispatch
messages itself and reads freight-board screenshots. Everything works without it; with no key the
app makes no network calls at all.

---

## Data

Settings → Data: snapshot, download the career file, list and restore backups, or start over. Every
save writes atomically and rotates a backup first.

**Starting over keeps your settings.** The API key, HOS rules, mod list and cost assumptions describe
your game and your machine, not the career that just ended, so a reset leaves them alone. There is a
second prompt if you genuinely want factory defaults.

## Updating the app

**Replace `TruckSimDispatcher.exe` in the folder you are already using.** Leave the `data` folder
alone — the career stays put, and newer builds migrate older career files forward on load. Migrations
only ever add what is missing; they never rewrite history.

If you move the exe somewhere new, it looks for an existing career before opening a blank one:
`TSD_DATA_DIR` if set, then beside the exe, then `%LOCALAPPDATA%\TruckSimDispatcher\data`. A career
found in any of those wins over an empty folder, and the console prints which file it opened. Any
career it finds elsewhere is listed under **Settings → Data → List backups** with a button to load it,
so an update never silently looks like a lost save.

## Building from source

```powershell
.\build.ps1        # -> publish\TruckSimDispatcher.exe
```

.NET 10 SDK, `win-x64`, self-contained single file.
