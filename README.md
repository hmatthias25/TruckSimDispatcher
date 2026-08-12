# TruckSim Dispatcher

A dispatch office for American Truck Simulator. You are a company driver; the app is the carrier —
operations, safety, maintenance and accounting. It decides what you haul, checks it against your
hours before you hook, audits every trip, and pays you.

Single portable `.exe`. No install, no runtime, no internet.

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

**The company this app models costs more than a fresh ATS profile has.** Three honest options, and
the first is the one to take:

1. **Start small and grow.** On the Fleet tab, delete the yards and units you do not actually own.
   Keep the one truck you bought. Add things as you buy them. Everything works for a one-truck
   operation.
2. **Seed your game with a save editor.** Money lives in
   `Documents\American Truck Simulator\profiles\<profile>\save\<slot>\game.sii`, which is encrypted —
   SII_Decrypt opens it, TS SE Tool is a dedicated editor.
3. **Use mods** to unlock all dealerships, garages, cities and recruiting agencies, which ATS
   otherwise hides until you drive to them.

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
| Close it out | Active Load | Miles, fuel, tolls, damage, detention |
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

## Building from source

```powershell
.\build.ps1        # -> publish\TruckSimDispatcher.exe
```

.NET 10 SDK, `win-x64`, self-contained single file.
