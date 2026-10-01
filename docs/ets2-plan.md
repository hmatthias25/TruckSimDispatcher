# Euro Truck Simulator 2 support: plan

Status: **not started**. This is the reference for building it later. It was written on 2026-10-01 against v0.73 (`2c8c2b6`), and the same day gained the Mobility Package home-time and weekly-rest rules (section 3a), cabotage inside and outside the EU (section 3b), and ferries and trains (section 3c). The counts below are approximate and came from a read-through of the code. Re-check any file or symbol named here before relying on it, because the code will have moved on.

## The decision

**One app, with the game chosen per career.** When a player starts a new career they pick American Truck Simulator or Euro Truck Simulator 2, and that career stays on that game for good. Someone who plays both keeps both careers in one app and switches between them, the way they would switch save profiles in the game.

- One download, one zip, one release, one set of manuals per game.
- The game belongs to the **career**, not to the app. A career can never change game: its cities, distances, pay history and hours-of-service clocks would all be wrong in the other one.
- Both games' data ships in the one exe. That costs a few MB on a 51 MB file.
- The risk is a US label ("mi", "$", "the 34") showing up in a European career. The test suite has to run both games to catch that.

The alternative was two apps built from the same code. It was rejected because it means two zips, two release routines, and two apps for anyone who plays both.

## The shape of the work

There are no interfaces in the codebase. Every service is a `public static class` reading `AppState` and `AppSettings`. The plan is a **game profile** that the career carries, plus lookups that go through it. Most hard-coded US data already sits in isolated static tables, so each table becomes one swap point. Four things are not isolated and are spread through the code: the shape of the US hours-of-service rules, miles and dollars written directly into text, per-mile pay, and the word "ATS".

## What has to change, biggest first

### 1. Hours of service (the biggest and riskiest part)

The **limits** are already settings: `HosRules` in `Models/Models.cs` (drive 11, shift 14, break after 8 for 0.5, cycle 70 in 8, reset 10, restart 34), editable in Settings. The **structure** of the planner is US-only:

- `Services/HosEngine.cs` (`Plan`, about 1,200 lines) models one daily drive limit, a 14-hour duty window that breaks do not extend, a break triggered by cumulative driving, and a rolling 70-hour/8-day cycle drawn down by **on-duty** time with a full refill on restart.
- `Services/Recap.cs` (the rolling 8-day recap), `Services/Restart.cs` (the 34-hour restart workflow), `ClockCheck`, and the `AiService.DeriveRecap` function are all US.
- `HosSnapshot` has four clocks (drive, shift, break, cycle), used about 240 times across 12 C# files and `ui/app.js`.
- The wording "14-hour", "70-hour", "34-hour", "the 34", "30-minute" and "the ten" appears about 130 times across the code, UI and docs.

What EU rules (Regulation 561/2006) need:

| EU rule | Fits the current model? |
|---|---|
| Break of 45 min after 4.5 h of driving | Mostly: `DrivingBeforeBreak` 4.5, `BreakLength` 0.75 |
| Break split as 15 + 30 | No, needs new logic |
| Daily driving of 9 h, extendable to 10 h twice a week | No, needs a counter of extended days |
| Daily rest of 11 h, reducible to 9 h three times between weekly rests | Partly (`OffDutyReset` 11); the reduced-rest counter is new |
| 56 h of **driving** per calendar week, 90 h per two weeks | No. Counts driving, not on-duty, by calendar week, not a rolling window |
| Weekly rest of 45 h (reducible to 24 h with compensation), due within six 24-hour periods | Replaces the 34-hour restart; the compensation tracking is new |
| No 14-hour window | The rule set has to be able to turn it off |

Recommended approach: add a rule-set selector to the profile (US FMCSA or EU 561), and give `HosEngine.Plan`, the recap and the restart a separate path for EU rules. Don't try to bend the US engine with different numbers. The EU path needs its own test suite.

Open question: HOS screenshots are read from **GDC Companion** (`AiService` `HosPrompt`), which tracks the US rules. Find out whether a European equivalent exists. If none does, EU clocks are entered by hand. GDC is also the economy mod behind the service schedule (`FleetMaintenance.cs`).

### 2. Units and currency

There is no units layer.

- About 70 data fields carry an imperial unit in their name: `LoadedMiles`, `DeadheadMiles`, `WeightLbs`, `FuelPricePerGal`, `FuelCapacityGal`, `AvgMpg`, `GovernedMph`, `FuelRangeMiles`, `ServiceIntervalMiles` and others.
- Miles, gallons, mpg, mph and pounds appear in over 1,000 calculations and strings, including a fixed `EarthRadiusMiles` in `Services/Geo.cs`.
- Money: `ui/app.js` has `money`, `money0` and `num`, hard-coded to `$` and `en-US`. That is one choke point with about 120 call sites, but about 340 more lines of app.js write `$` or `/mi` directly, and about 270 C# interpolated strings do the same.

ETS2 needs km, litres, km/h, kg or tonnes, and euros. Check whether ETS2 lets the player choose another currency (it is believed to); if so, currency becomes a setting.

Recommended approach: keep one internal unit for each quantity, convert only for display and input, and route every displayed figure through formatters that come from the profile. Field names can stay imperial internally if the conversion is strict at the edges. Decide that first, because renaming 70 fields touches every career file.

### 3. Pay, tax and employment

- **Pay:** `PayPlan` in `Models/Models.cs` is cents-per-mile (loaded, deadhead, reefer, hazmat, oversize and drop-and-hook adders, plus tarps, stops, detention, layover, breakdown and bonuses), settled every Friday (`PayEngine.cs`, `SettlementPeriodDays`). Carrier offers each carry their own per-mile rates (`Carriers.cs`). European company drivers are typically salaried, monthly or hourly, so this needs a pay-model choice in the profile, not just new numbers.
- **Tax:** `Services/PayrollTax.cs` (US federal brackets, FICA, state rates) and `Services/W2.cs` (W-2s per employer) are US-only. Per-country European payroll is a rabbit hole; use a flat deduction for an EU career.
- **Detention:** detention pay is much less of a convention in Europe. Consider making it optional for EU careers. The arrival mechanics for the shipper and receiver should stay either way, because they keep the clocks honest.
- **Home time:** `HomeTime.cs` (about 1,800 lines) is built on US over-the-road patterns (biweekly, a 34 at home). EU careers replace this with the two Mobility Package rules in [section 3a](#3a-home-time-and-weekly-rest-the-mobility-package).
- **Probation, grades and conduct** (`Probation*.cs`, `DriverRank.cs`) are the game's own rules, not law, and mostly carry over.

### 3a. Home time and weekly rest: the Mobility Package

The EU's 2020 Mobility Package changed the driving and rest rules (Regulation (EU) 2020/1054, amending 561/2006). Two of its rules decide where a driver spends their weekly rest, which is exactly what `HomeTime.cs` and the restart planning do in the US build. There is no US equivalent: in the US build, home time is a company policy chosen at hire ("biweekly") and no law sets it, and a 34-hour restart can be taken in the sleeper anywhere.

**Rule 1: home at least every 4 weeks.**
The carrier must organise schedules so each driver can return home at least every **4 consecutive weeks**, or every **3 weeks** if they took two reduced weekly rests in a row. "Home" is either where the driver lives or the employer's operational centre. The driver may choose to spend the rest somewhere else, but the carrier owes the trip home.

How it maps to the app:
- For an EU career the 4 weeks is a **legal ceiling**, treated like an hours-of-service limit and not as a preference. Dispatch has to route the driver home before it runs out, and a load that cannot get them home in time is refused the way a load that breaks the clock is.
- A shorter company policy (home every 2 weeks, say) can still sit on top, the way the US home-time arrangements do now.
- The 3-week variant ties this to the reduced-weekly-rest counter in section 1.

**Rule 2: no regular weekly rest in the cab.**
The EU has two kinds of weekly rest:
- **Regular weekly rest** (45 hours or more) may **not** be taken in the vehicle. Away from home it has to be in suitable accommodation, such as a hotel, paid for by the employer.
- **Reduced weekly rest** (at least 24 hours) **may** be taken in the cab, if the truck is parked and has a proper sleeper. The hours short of 45 have to be made up later, attached to another rest of at least 9 hours, before the end of the third week after.

How it maps to the app:
- The planner has to know **where** each weekly rest falls, and what kind it is:
  - **At home:** fine, no cost.
  - **Away from home, regular (45 h+):** the driver needs a hotel. That is a **company expense** booked to the ledger, and the stop has to be somewhere with accommodation.
  - **Away from home, reduced (24 h+):** the cab is allowed, but it adds a debt of 21 hours or less to the compensation counter.
- In the game you can sleep anywhere, so the app is the only thing enforcing this, the same as the receiver's opening hours. It should say so when it matters, for example: *"This weekly rest is a regular one and you are 600 km from home: book a hotel, or take a reduced one in the cab and make up 21 hours by week 14."*
- Hotel stays need a cost figure (a setting, maybe varying by country) and a place on the settlement or ledger. They are an operating cost the company pays, not a deduction from the driver.

**Not included: the truck-return rule.** The Mobility Package also required the **vehicle** to return to its operational centre in the home country within 8 weeks. The EU Court of Justice **annulled** that rule on 4 October 2024, and rejected the other challenges to the package, so the driver-home and in-cab rest rules above still stand. Leave the vehicle-return rule out.

### 3b. Cabotage: domestic loads in someone else's country

There is no US equivalent at all. **Cabotage** is a haulier from one EU country carrying a load that starts and ends inside **another** EU country, for example a German-based truck moving freight from Lyon to Paris. The EU allows it, but only in short bursts after an international delivery, so foreign trucks cannot set up permanently inside another country's domestic market. The rules are in Regulation (EC) 1072/2009, amended by (EU) 2020/1055, and have applied since 21 February 2022.

**The rules:**

| Rule | What it says |
|---|---|
| What starts it | An **international** load **delivered into** the host country, fully unloaded first. Cabotage cannot start until that delivery is done. |
| How many | **Up to 3** cabotage operations, using the **same vehicle**. |
| Time limit | All within **7 days** of that unloading. The window closes at 7 days even if fewer than 3 were done. |
| Arriving empty in another country | Cabotage can also be done in a different EU country entered **unladen**, but only **1 operation per country**, within **3 days** of entering it, and it counts toward the 3 and stays inside the 7 days. |
| Cooling-off | When the cabotage period ends, that vehicle may do **no more cabotage in that country for 4 days**, and not until it has done a new international load into it. The count starts at 00:00 the day after the last unloading and ends at 23:59 on the fourth day. It applies per vehicle and per country. |
| What counts as one operation | One collection, delivered within the host country. It can have several drops from that one pickup. EU countries may set their own limits on loading and unloading points, so the exact definition varies by country. |
| Evidence | A consignment note (CMR) for the incoming international load and for each cabotage operation, plus tachograph records. A roadside check can ask for all of them. |
| Not restricted | Loads within the company's **own** country, international loads between countries (including cross-trade between two foreign countries), and loads out of a foreign country back home. Only domestic loads in a foreign country are cabotage. |

**How it maps to the app:**
- **Every career needs a home country**: the company's country of establishment, taken from the HQ yard. A company with yards in several countries still has one home country, which keeps the rules simple.
- **Every load gets classified** as domestic (home country), international, or **cabotage** (origin and destination in the same foreign country). This is a small check on origin and destination countries, but it runs on every board evaluation.
- **A per-vehicle cabotage state:**
  - the host country and the day the international load was unloaded (when the window opened);
  - the operations used, out of 3;
  - countries entered empty (date of entry, and whether their one operation is used);
  - cooling-off end dates for each country.

  It lives on the truck the same way `Whereabouts` and the trailer state do. It is per vehicle, so hired drivers' trucks carry their own.
- **Dispatch enforces it the way it enforces hours of service:** a cabotage load that would be the fourth, would fall outside the 7 days, or lands in a cooling-off country is refused with the reason given. Example: *"This is cabotage in France and you have done 3 since the Rotterdam delivery on day 12. You need an international load out of France first, and then 4 days before you can come back for domestic work."*
- **It shapes the board:** after an international delivery into a foreign country, the board should show how many cabotage loads are left and how long the window has, so the driver can choose between local work and heading out on the next international load.
- **Fault and penalties:** a cabotage breach is the **dispatcher's** fault, never the driver's, because operations chooses the loads, the same as booking a load too tight. Real fines vary by country, roughly €5,000 to €30,000 per offence. The app can either refuse breaching loads outright (simplest) or book a fine; refusing outright fits how the app already treats loads it should not authorise.
- **Hired drivers** need the same check on whatever the fleet runs, but their loads are not run load by load in the app. This may only be practical as a warning on the fleet report.

#### Outside the EU

ETS2's map includes countries outside the EU. The base game has the **UK** and **Switzerland**. The DLC adds **Norway** (Scandinavia, Nordic Horizons), **Russia** (Beyond the Baltic Sea), European **Turkey** (Road to the Black Sea), and **Serbia, Bosnia and Herzegovina, Montenegro, Albania, North Macedonia and Kosovo** (West Balkans). Iceland is announced, and it is EEA like Norway. The rules depend on both ends: **where the truck is based** (the company's home country) and **where the load is**. Researched on 2026-10-01; sources at the end.

**Norway: the same as the EU, for EU and EEA trucks.**
Norway is in the EEA, so it applies the EU cabotage regulation. A truck from another EU or EEA country may do **3 cabotage loads within 7 days** of unloading an international load in Norway, with the same vehicle, then must leave, with a **4-day cooling-off** before more cabotage there. Norway adopted the Mobility Package version, with the cooling-off, from **1 November 2022**. A Norwegian-based company is treated like an EU one when working in the EU.
- For the app, Norway behaves exactly like an EU country, both as a host and as a home country.

**United Kingdom: its own, tighter rules, which differ by direction** (the EU-UK Trade and Cooperation Agreement):

| Who | What they may do |
|---|---|
| **EU truck in the UK** | Up to **2 cabotage loads within 7 days** of unloading a **laden** international load into the UK, with the same vehicle. Arriving **empty** and picking up a domestic load is **not** allowed. Sources disagree on whether a 4-day cooling-off follows; check before building. |
| **UK truck in the EU** | Up to **2 jobs inside the EU** after dropping off a load from the UK, of which **at most 1 may be cabotage**. The other is cross-trade, meaning a load between two EU countries. The cabotage job must be in the **same EU country** the UK load was dropped in, within **7 days** of that drop. |
| **UK truck with an ECMT permit** | One extra cross-trade job, so 3 jobs in total, before returning to the UK. |
| **Northern Ireland truck in Ireland** | Up to **2 cabotage jobs in Ireland** within 7 days of dropping off a load brought from Northern Ireland. Ireland is announced for ETS2, so this may matter later. |

- For the app, the UK is a host country with its own limits (2 loads, no empty entry). A **UK-based** company also needs a different rule set in the EU: a combined limit of 2 jobs per trip from the UK, with cross-trade counted too, not just cabotage. That second part is the bigger change, because the EU rules put no limit on cross-trade at all.

**Switzerland: no cabotage, plus driving rules of its own** (the EU-Switzerland Land Transport Agreement, kept in the 2026 "Bilaterals III" update):
- **No foreign truck may do cabotage in Switzerland.** Zurich to Lausanne on a German truck is illegal. EU trucks may still carry international loads into, out of and through Switzerland.
- A **Swiss-based** truck may carry loads **between EU countries** (Germany to France, for example, which the Swiss authority calls "cabotage" but the EU calls cross-trade). It may **not** do domestic loads inside an EU country. Check this point against the agreement's text before building, because the Swiss page uses the word differently.
- For the app, Switzerland as a host is a hard "no cabotage". It also has Swiss road rules worth modelling, because they shape routes and timing, not just cabotage:
  - a **night driving ban** for lorries (22:00 to 05:00) and a **Sunday ban**;
  - a **40-tonne** gross weight limit;
  - a distance-based heavy vehicle charge (**LSVA**). The Swiss authority quotes CHF 325 for a frontier-to-frontier transit as an example.

  The night and Sunday bans in particular work like a facility's opening hours: the planner has to hold the truck at the border or plan the route around them.

**Russia, Turkey and the West Balkans: no cabotage for foreign trucks.**
None of these give foreign hauliers cabotage rights. International work there runs on bilateral agreements and **ECMT multilateral permits**, and ECMT permits **do not allow cabotage**. Serbia, Turkey, Russia and Bosnia and Herzegovina also limit ECMT trucks to **3 loaded journeys** that do not involve the truck's home country before it must go back home. Montenegro, Albania, North Macedonia and Kosovo were not checked one by one, but nothing found suggests they allow foreign cabotage.
- For the app, these are hard "no cabotage" countries. International loads into and out of them are allowed.
- **Russia is a design choice, not just a rule.** EU sanctions since 2022 restrict road haulage between the EU and Russia: Russian-registered hauliers have been banned from carrying goods in the EU. ETS2 still has Russia on its map. Decide whether the app reflects this or treats the map as the game presents it. The game-world option is probably right for a game, but say so in the manual.

#### What this means for the app

The EU rules above become **one rule set among several**, chosen by two things: the company's home country and the host country. These limit only **domestic loads inside a foreign country** — international loads into, out of and between any of these countries are never restricted. In outline:

| Company based in | Domestic loads inside (a load that starts AND ends there) | Rule |
|---|---|---|
| EU or EEA | another EU or EEA country | 3 loads in 7 days, 1 per country after an empty entry, 4 days cooling-off |
| EU or EEA | UK | 2 loads in 7 days after a laden entry, no empty entry |
| UK | EU | 2 jobs per trip from the UK, at most 1 cabotage (in the drop country, within 7 days) |
| any | Switzerland | no cabotage |
| Switzerland | EU | cross-trade only, no domestic loads |
| any | Russia, Turkey, West Balkans | no cabotage |
| any | its own country | unrestricted domestic work |

Recommendation for the first version:
- Allow **only EU and EEA home countries** for a new career at first. Every rule set then lives in the first five rows, and the hard ones (a UK-based or Swiss-based company) wait until later.
- Treat the UK, Switzerland, Russia, Turkey and the West Balkans as hosts using the rows above. Only the UK row is more than a flat "no".
- Add the Swiss night and Sunday bans as planner rules, separately from cabotage.

### 3c. Ferries and trains

ETS2 has many ferry routes (UK to the continent, Scandinavia, the Baltic, the Mediterranean) and the Channel Tunnel train. ATS has none, so the US build has no equivalent. EU law has specific rules for resting on a ferry or train (Regulation 561/2006, Article 9, as amended by 2020/1054). The game handles ferry time differently from the law, so this is another place where the app enforces something the game does not. Researched on 2026-10-01; sources at the end.

**The law:**

| Rest taken on the crossing | Allowed? | Conditions |
|---|---|---|
| **Regular daily rest** (11 h) | Yes | The driver must have access to a **sleeper cabin, bunk or couchette**. The rest may be interrupted **no more than twice**, for **no more than 1 hour in total**, for other activities such as driving on and off and border checks. The total rest must still reach 11 hours. |
| **Split daily rest** (3 h + 9 h) | Yes | The 9-hour part can be on the crossing, with the same cabin and interruption rules. |
| **Reduced daily rest** (9 h) | On board, yes; interrupted, no | One source says a reduced daily rest cannot be interrupted, so the drive on and drive off would break it. Check this against the regulation text before building. |
| **Reduced weekly rest** (24 h+) | Yes | Same as a regular daily rest: a sleeper cabin, bunk or couchette, and at most 2 interruptions totalling 1 hour. |
| **Regular weekly rest** (45 h+) | Only on long crossings | Only where the crossing is **scheduled for 8 hours or more** and the driver has access to a **sleeper cabin**. A ferry cabin then counts as proper accommodation, so the "no regular weekly rest in the cab" rule in section 3a is satisfied for that part. Once ashore, the rest of it cannot continue in the truck. |
| **No cabin** (for example on a short crossing or the Channel Tunnel) | Not as rest | The crossing does not count as daily or weekly rest. It can usually be logged as a **break**, because the driver is not driving or working, but check how a break on board is treated before building. |

Two related rules:
- **Travel to or from a vehicle** that is not at the driver's home or the employer's base does not count as rest, unless the driver is on a ferry or train with a cabin, bunk or couchette. This matters little in the game, where the driver is always with the truck.
- The tachograph has a ferry/train marker for crossings. The app records crossings itself, so it does not need to model the tachograph.

**The Channel Tunnel** (Le Shuttle Freight) takes about **35 minutes**, and drivers ride in a separate carriage with no cabins. It is never daily rest. At most it can count toward a break, such as the 30-minute half of a split 15 + 30 break. In ETS2 it costs **€300 or £240**.

**How ETS2 itself handles ferries** (as reported by players; check against the current game version):
- Taking a ferry or train skips the game clock forward by the crossing's scheduled time, and the fare comes out of the player's money.
- A crossing of **9 hours or more** leaves the driver **fully rested**. A shorter one gives **partial rest, minute for minute**: an hour left on the sleep timer plus a 9-hour crossing leaves 10 hours.
- The game has **no cabins**, no rule about interruptions, and no difference between daily and weekly rest. Any time on a ferry is rest as far as the game is concerned.
- **Update 1.60** (first shown in May 2026) changes the game's own fatigue and rest system. ETS2 gets a 10-hour driving limit and a 9-hour rest, sleep of a chosen length, a rest indicator, and stricter break warnings with penalties. Nothing was said about ferries, so re-check how crossings behave after 1.60.

**How it maps to the app:**
- **A crossing is a new kind of trip event**, a span like a rest, with a start and end time, the two ports, the fare, and whether the driver had a **cabin**. The fare is a trip expense the company pays, like tolls, and the end time moves the app's clock the same way a rest does.
- **The hours-of-service engine classifies each crossing** by its length and whether there was a cabin. It counts as one of: a regular daily rest (allowing the 1 hour of interruptions for driving on and off), a reduced weekly rest, a regular weekly rest (8 hours or more scheduled, with a cabin), or only a break. The driver is told when the game and the law disagree, for example: *"The game counts this 6-hour crossing as rest. The regulation does not: without 11 hours, it is a break, and your daily rest is still due."*
- **A long crossing with a cabin solves the Mobility Package problem.** A regular weekly rest taken on an 8-hour-plus crossing with a cabin needs no hotel and costs no hotel night (section 3a). This is the real-world reason hauliers take long overnight ferries, and the planner should know it.
- **The planner can route through ferries and the Channel Tunnel**, using the app's own table of real-world routes (below). With it, the planner can schedule a daily or weekly rest onto a crossing instead of a lay-by, which is often both faster and cheaper.
- **Whether there is a cabin** cannot be read from the game. Default to **yes on overnight crossings** and **no on short ones and the Channel Tunnel**, with a setting or a per-route override.
- **Cabotage and borders:** a crossing between two countries is part of an international load, so it does not change the cabotage counts in section 3b. A crossing to or from the UK starts or ends a UK entry for the UK cabotage rules.

#### The ferry network: real-world routes and sailings

**Decided: the app does not read ferry routes from the game's files.** The game's archives change with every update and DLC, and reading them would need a reader for SCS's own HashFS format. Instead the app carries its **own table of real-world ferry routes**, maintained like the freight market table in `Markets.cs`. It is the app's data, so it only changes when the app chooses to change it.

**What each route holds:**
- the two ports, and the ETS2 cities they correspond to;
- the operator (for example DFDS, Stena Line, P&O Ferries, Tallink, Viking Line, Finnlines, TT-Line, Color Line, Grimaldi or Minoan Lines);
- the real **crossing time**;
- whether freight drivers get a **cabin**, which decides whether the crossing can be a daily or weekly rest (see the table above). Long overnight crossings usually include one; short hops usually do not;
- a typical **freight fare**, used as the trip expense when the player has not entered the one the game charged;
- the **sailings**: either departure times by day of the week, or, for a frequent service, a **frequency** (for example "every 15 minutes, around the clock");
- for a terminal with a check-in, how long before departure the driver has to be there.

**The Channel Tunnel is one of these routes**, treated exactly like a ferry: Folkestone to Calais and back by Le Shuttle Freight. Its real figures:
- **35 minutes** from platform to platform;
- **around the clock**, with up to **4 departures an hour**, so a frequency rather than a timetable;
- drivers are told to allow **30 minutes to 2 hours** for check-in at Folkestone;
- **no cabin**, so the crossing is never a daily or weekly rest, at most a break;
- in ETS2 it costs **€300 or £240** (as reported on the game wiki), against the real-world fare, which is not checked here.

With **Real ferry sailings** on, the driver arriving at the terminal gets the check-in time plus the wait for the next shuttle on the frequency, which is usually short. That is still realism worth having on the UK route, where the tunnel and the Dover ferries compete.

**Matching game routes to real ones.** ETS2's map is compressed, and its ferry links do not all match a real route one for one. For each route the game offers, find the real-world counterpart, the same operator's route between the same or the nearest real ports. Where there is no real counterpart, fall back to the crossing time the game uses and no timetable, and mark the route as such in the table.

**Bonus realism: wait for the real sailing (an optional setting).**
With **Real ferry sailings** on (in Settings, on by default for EU careers, or off — a decision below), a driver who reaches the port is told when the next real sailing leaves and waits for it:
1. The driver reports arriving at the port, the same way they report arriving at a receiver or a shipper.
2. The app finds the **next departure** in that route's timetable after the arrival time, and the arrival time at the other side from the real crossing time.
3. It answers the way `ShipperCall` and `ReceiverCall` do: *"The next DFDS sailing to Rosslare leaves 18:30 and arrives 08:00 the next day. Set the game clock to 18:30 and board then."* After the game's own crossing, a second instruction sets the clock to the real arrival time if the game's crossing was shorter.
4. The wait at the port and the crossing go on the clocks where they really went. A long wait is often best used as part of a break or rest, and the planner should say so, because waiting at the terminal is not driving.

With the setting **off**, the ferry leaves when the driver arrives, and the crossing takes the real crossing time (or the game's, if the route has no real counterpart). The rest classification and fares still apply either way.

**The planner uses the timetable too.** When the setting is on, dispatch plans for the real departure, including the wait and the possibility of arriving just after one leaves. A load that only works by catching a particular sailing should say so: *"This only fits if you make the 22:00 out of Kiel. Miss it and the next is 22:00 tomorrow."*

#### Crossings in the dispatch calculation

A crossing has to be part of **feasibility**, not something the driver discovers at the port. Example: the plan gets the truck to Calais at **02:00**, but the next ferry to Dover is **06:00**. Those four hours are as real as a receiver's slot, and a plan that ignores them is four hours optimistic. That is exactly the kind of error the dock-time learning and the receiver's opening hours were built to remove.

**A crossing is a wait the planner already knows how to handle.** `HosEngine.Plan` already holds a truck for a receiver's slot or a site's opening (`WaitUntilHours`, `SiteOpenHour`). A sailing is the same thing on the route instead of at the end of it:
1. Drive to the port, on the clocks as now.
2. Check in, and wait for the **next departure** after arrival, from the route's timetable or frequency. With **Real ferry sailings** off, there is no wait.
3. The crossing itself, classified as rest or break as described above. This is where it can help: a long crossing with a cabin can **be** the daily rest the plan needed anyway, so the wait and the rest overlap instead of adding up.
4. Drive on from the far port.

The verdict, the slack against the buffer and the projected arrival all include the wait and the crossing, the same way they include the dock time.

**Comparing ways across.** Many crossings have alternatives: the Dover ferries, the Dunkirk ferries and the Channel Tunnel all cross the Channel, and the North Sea and the Baltic each have several routes. The planner should **try each reasonable crossing** for the load and keep the best one, by the same measure it uses now: earliest feasible arrival with enough slack. It should then **say why**, when the best choice is not the obvious one:
- *"The 06:00 ferry from Calais means four hours at the port. Drive on to the tunnel at Coquelles instead, 15 minutes further, and take the 02:30 shuttle: you reach the UK three and a half hours sooner."*
- *"Take the overnight Hook of Holland to Harwich sailing instead of driving to Calais. It is a 7-hour crossing with a cabin, so it is your daily rest as well, and you arrive in England fresh at 08:00."*

The choice is stored on the trip with the plan, like the dock time is now, so the close-out and the late-delivery fault judgement measure against the crossing the plan expected.

**When the driver arrives at a different time.** The plan is an expectation. If the driver reaches the port earlier or later than planned, reporting the arrival at the port gets a fresh answer for the next departure, the way the receiver's call works now, and the app says when that changes the picture: *"You missed the 02:30. The next shuttle is 02:45, so nothing lost."* or *"The 22:00 has gone and the next sailing is tomorrow at 22:00. Take the tunnel instead: 3 hours' drive to Calais."*

**What this needs that the app does not have:**
- **Knowing a crossing is needed at all.** The app's distances come from straight lines between cities with a road factor (`Geo.cs`), which assumes the land is continuous. Europe has water in the way: Great Britain, Ireland, Scandinavia across the Baltic, Sardinia, Sicily and the Greek islands. The EU build needs a simple model of which areas are separated by water and which crossings join them. That can be a list of land areas with their crossings, without a full road map.
- **Distances that depend on the crossing.** A load's distance comes from the job listing, which already assumes the game's route. Choosing a different crossing changes it. For a crossing other than the game's, the distance is the leg to the chosen port plus the leg from the far port, from `Geo`, against the listing's total as a check.
- **Fault when a sailing is missed.** If the plan's crossing was reasonable and the driver missed it through their own delay, it is the driver's. If the sailing was not there, because the timetable was wrong or the setting was changed mid-trip, it is unavoidable. That follows the existing pattern of judging fault against the plan made at dispatch.

**Keeping the data honest:**
- Real timetables change by season and year. Treat the table as a **typical weekly timetable**, record **when it was last checked**, and say so in the app and the manual. It is realism for a game, not a booking system.
- Each operator's own timetable pages are the source. Build the first table from them, route by route, and re-check it when the app is updated.
- The table should never be the reason a load is refused outright. If a sailing time is wrong, the driver can still take the crossing as it happened, the way they can correct any other time.

### 4. Map and market data (large but cleanly isolated)

| US table | Where | EU replacement |
|---|---|---|
| Freight markets: 425 cities with tiers, restart-friendly flags and strong divisions (base game plus Coast to Coast mod) | `Services/Markets.cs` | ETS2 cities with tiers (base map plus DLC, plus mods such as ProMods if wanted) |
| City coordinates: about 49,000 lines, US and Canada | `data-embedded/us-cities.txt`, `ca-cities.txt`, merged in `Geo.cs` | A European cities file, embedded the same way |
| State centroids | `Geo.cs` `Centers` | Country centroids |
| Selectable regions | `Services/MapCoverage.cs` (already has a `Country` field) | Countries |
| Carrier regions | `Carriers.RegionOf` (Northwest, West, Midwest, South, and so on) | European regions |
| Time zones | `Services/GameZones.cs` (Pacific to Eastern by state) | UK/WET, CET, EET by country |
| Fuel prices | `Services/Fuel.cs` (`StateIndex`, EIA prices, "fuel before you cross") | Country fuel prices; the crossing advice carries over |
| Starting companies | `Seed.cs` `Profiles` | European equivalents |

The `State` fields (about 23 on the models) are plain strings, so country codes fit. Some places assume exactly two letters: checks in `AtsCompanies.cs`, `Fuel.cs` and `Geo.cs`, 13 `maxlength="2"` inputs in `ui/app.js`, and the AI prompt's "two-letter US state code". European country codes are two letters too, but check the UK ("UK" or "GB") and anything the game shows differently.

City discovery (`DiscoveryService.cs`) is game-neutral: SCS's rule that an undiscovered city generates no cargo applies to both games.

### 5. Companies, carriers, trucks and trailers

- **In-game companies:** the 77 ATS companies in `Services/AtsCompanies.cs` (name, category, states, depots, SCS token). ETS2 has its own list (Posped, Kaarfor, ITCC and the rest) to transcribe.
- **Carriers:** 31 real, 31 fictional and 2 second-chance US carriers in `Services/Carriers.cs`, each with an HQ, yards, pay, standards and a description. These need European equivalents. Decide whether to use real company names or fictional ones only; the US build offers both (`CarrierRoster`).
- **Trucks:** the makes in `Seed.cs` (`AmtSpecs`, `ManualSpecs`, `ShowcaseSpecs`) are all US. Europe needs Scania, Volvo FH, DAF, MAN, Mercedes Actros, Iveco and Renault, with European gearboxes.
- **Trailers:** the types ("Dry Van", "Flatbed", "Reefer", "Step Deck", "Lowboy", "Car Hauler", "Livestock", "Intermodal", "Heavy Haul", "Drop & Hook") are bare strings in about 1,000 lines with no list behind them. They are matched in switches in `TrailerSpec.cs`, `Seed.TrailerMake`, `AtsCompanies.DivisionsFor`, the strong divisions in `Markets.cs`, and the AI prompt's trailer list. Make a trailer type list per profile first; then the EU types (curtainsider, box, reefer, low loader, tanker, flatbed, container and others) plug in.
- **Dangerous goods:** `Services/Endorsements.cs` uses the ATS HazMat classes. ETS2 uses ADR classes with essentially the same unlock model, so this is mostly a relabel.

### 6. Game integration (small and localised)

- `Services/ModCompanyNames.cs` uses ATS's Steam app ID `270880` and the `Documents\American Truck Simulator\mod` folder. ETS2 is `227300` and `Euro Truck Simulator 2`. The `.scs` mod file format is the same SCS format, so the reader carries over.
- The save paths are repeated in UI help text (`ui/app.js`, `Program.cs`) and in the save-editor help in `Carriers.cs`.
- The AI screenshot prompts in `Services/AiService.cs` (`ExtractPrompt` and its JSON schema) ask for US state codes, miles, dollars, pounds (tons × 2000), US time-zone names, ATS HazMat classes and the US trailer list. Each needs an ETS2 version.
- `DeliveryWindow` parses times like "Mon 11:14 pm - Tue 5:54 am". ETS2 screens are likely in 24-hour time; check the parser handles it.
- Terms that both SCS games use (Freight Market, Cargo Market, Trailer Manager, company screen, loads from this location) carry over, but the text around them says "ATS".

### 7. Wording, manuals and tests (lots of volume, all mechanical)

- "ATS" appears about 700 times across `Services`, `Models`, `Program.cs` and `ui/app.js`. The product name, "TruckSim Dispatcher", is already neutral.
- **Data location:** careers are stored under `%LocalAppData%\TruckSimDispatcher\data` or beside the exe in `data\`. With per-career games, either keep one career store that records the game, or use a folder per game. Decide this alongside the career-switching UI.
- **Manuals:** about 10,000 lines of HTML plus three PDFs, all written for ATS and the US. An EU career needs its own manual and FAQ, rewritten rather than edited. The build pipeline in `docs/manual` (`split.py`, `paginate.py`, `render.py`) carries over.
- **Tests:** 151 of the 153 suites use US cities, states, units or rules in their fixtures, and about 70% check US hours-of-service behaviour. Keep them as the ATS suite, add an EU suite, and run both on every update.

## What carries over unchanged

City discovery, the learned dock times and planning speed (`FacilityLearning`, `SpeedLearning`), the delivery-window mechanics and the receiver and shipper arrival calls, trips and the trip log, the ledger, equipment and maintenance (except the GDC-specific service schedule), career storage and backups. The 74 career-file migrations in `Migrations.cs` do not apply to a new EU career, which can start at its own schema version.

## Build order

1. **Add the game profile, with no change in behaviour.** Add the career-level game choice (defaulting to ATS for every existing career), and route the isolated tables (markets, coordinates, regions, time zones, fuel, companies, carriers, trucks, trailers, endorsements, tax, mod paths) through it. Prove ATS still passes the whole suite unchanged.
2. **Add the units and currency layer.** Route every displayed figure through formatters from the profile, and sweep the hard-coded `$`, `mi`, `gal` and `lb` text. ATS still passes unchanged.
3. **Build the European data** behind the profile: cities and tiers, coordinates, countries and regions, time zones, fuel prices, ETS2 companies, carriers, trucks, trailers, ADR.
4. **Build the EU hours-of-service engine**, with its own test suite. Expect this to be the largest step.
5. **Add home time and weekly rest under the Mobility Package** ([section 3a](#3a-home-time-and-weekly-rest-the-mobility-package)): the 4-week (or 3-week) home ceiling in dispatch, the regular-or-reduced weekly rest choice with its location, hotel costs on the ledger, and the compensation counter. This builds on step 4's reduced-rest tracking.
6. **Add cabotage** ([section 3b](#3b-cabotage-domestic-loads-in-someone-elses-country)): the company's home country, load classification, the per-vehicle cabotage state, enforcement in dispatch with the reason given, the board showing the remaining cabotage, and the dispatcher-fault rule. Start with EU and EEA home countries only, with the UK, Switzerland, Russia, Turkey and the West Balkans as hosts using the table in section 3b.
7. **Add ferries and trains** ([section 3c](#3c-ferries-and-trains)): the crossing event with its fare and cabin flag, its classification as daily rest, weekly rest or a break in the hours-of-service engine, the warning when the game and the law disagree, then the table of real-world routes and sailings, the optional real-sailing wait at the port, crossings in the feasibility calculation (the wait for the next departure, comparing the ways across, and saying why one was chosen), and the model of which areas are separated by water.
8. **Handle pay and tax:** a pay-model choice (salary or hourly in place of per-mile), a flat deduction in place of W-2s, and optional detention.
9. **Integrate the game and add the career choice to onboarding:** the ETS2 Steam app ID and paths, the AI prompts, the 24-hour window parsing, and the game choice on the new-career screen.
10. **Write the manuals and the EU test suite**, and run both games' suites in the finishing routine.

## Decisions to make before starting

- Whether to support EU hours-of-service rules in full, or start with a simpler subset: daily driving, the 4.5 + 45 break and daily rest first, then weekly and two-week limits.
- Currency: euros only, or a currency setting.
- Pay model for EU careers: salary, hourly, or per-km.
- Carriers: real European companies, fictional ones, or both, as in the US build.
- Mods: whether to support ProMods or other European map mods at the start.
- Career storage: one store that records each career's game, or a folder per game.
- Hotel costs for a regular weekly rest away from home: one flat figure, or a figure per country.
- Cabotage breaches: refuse the load outright (simplest, and it matches how dispatch treats other loads it should not authorise), or allow it and book a fine.
- Home countries for a new career: EU and EEA only at first (recommended), or the UK and Switzerland as well, each of which needs its own rules for working in the EU.
- Whether the EU truck in the UK has a 4-day cooling-off after its 2 cabotage loads. Sources disagree; settle it from the agreement's text.
- Swiss road rules (the night and Sunday bans, 40 tonnes, LSVA): model them in the planner, or leave them out.
- Russia: follow the game's map as presented (recommended), or reflect the post-2022 sanctions.
- Ferry cabins: assume a cabin on overnight crossings and none on short ones (recommended), or ask the driver on each crossing.
- Real ferry sailings: on by default for EU careers, or off by default, with the setting to change it either way.
- Where the timetable data comes from and how often it is re-checked. The operators' own timetable pages are the source; a re-check with each app update is the suggestion.
- Whether a reduced daily rest on a ferry may be interrupted for driving on and off. One source says no; settle it from the regulation text.

## Sources for the EU rules

These were checked on 2026-10-01. Laws and their interpretation change, so re-check before building.

- Cabotage, the 3 operations in 7 days, unladen entry and cooling-off: Regulation (EC) 1072/2009 as amended by (EU) 2020/1055, on [EUR-Lex](https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX:32009R1072); the IRU's summary, [Market access for road freight transport](https://www.irumobilitypackages.org/access-to-market); the European Commission's [Q&A on the cabotage regime](https://transport.ec.europa.eu/system/files/2016-09/qa_the_new_cabotage_regime_2011.pdf); and [Hansatic's cabotage guide](https://hansatic.com/en/guides/eu-cabotage-rules-guide), for what counts as one operation and the evidence required.
- Vehicle return within 8 weeks, and its annulment: the European Commission's [Rule on the return of the vehicle](https://transport.ec.europa.eu/transport-modes/road/mobility-package-i/market-rules/rule-return-vehicle_en), and the IRU's report of the [Court of Justice ruling of 4 October 2024](https://www.iru.org/news-resources/newsroom/eus-highest-court-weighs-road-transport-mobility-package).
- Driver return home and weekly rest outside the cab: Regulation (EU) 2020/1054, amending 561/2006, on EUR-Lex.
- ETS2's map and its non-EU countries: [Steam guide to all ETS2 DLCs](https://steamcommunity.com/sharedfiles/filedetails/?id=3514929302) and [ETS2 Hub's map DLC guide](https://www.ets2hub.com/guides/ets2-map-dlc-roadmap-global).
- UK: GOV.UK, [Jobs inside an EU country or between EU countries](https://www.gov.uk/guidance/international-road-haulage-jobs-inside-an-eu-country-or-between-eu-countries), for UK trucks in the EU; the FTC's [Cabotage in the UK: rules for EU operators](https://www.theftc.co.uk/cabotage-in-the-uk/) and FleetRadar's [post-Brexit cabotage guide](https://fleetradar.co.uk/blog/posts/cabotage-rules-uk-eu-haulage-post-brexit-2026-guide/), for EU trucks in the UK; the European Parliament's [briefing on the Trade and Cooperation Agreement](https://www.europarl.europa.eu/RegData/etudes/IDAN/2021/679071/EPRS_IDA(2021)679071_EN.pdf).
- Switzerland: the Federal Office of Transport's [Land Transport Agreement](https://www.bav.admin.ch/en/land-transport-agreement) page, and Trans.info's [EU-Switzerland deal: road cabotage still banned](https://trans.info/en/eu-switzerland-deal-459089).
- Norway: the Norwegian Public Roads Administration's [International transport, cabotage and penalties](https://www.vegvesen.no/en/vehicles/professional-transport/international-transport-and-cabotage-by-road/international-transport-cabotage-and-penalties/), and Trans.info's [Norway adopts Mobility Package rules from 1 November](https://trans.info/en/norway-adopts-mobility-package-rules-november-2022-309759).
- Ferries and trains, the law: the European Commission's [Driving and rest times](https://transport.ec.europa.eu/transport-modes/road/mobility-package-i/driving-rest-times_en) page; Regulation (EU) 2020/1054 on [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2020/1054/oj/eng); Tachogram's [Rests on trains and ferries](https://tachogram.com/en/blog/2021/01/28/mobility-package-regulation-rests-on-trains-ferries); and Truck Mobility Info's [Sleeping on the ferry](https://truckmobility-info.com/sleeping-on-the-ferry-rest-rules/). The last one describes the rules from before the 2020 amendment, so take the weekly rest rules from the others.
- Ferries and trains, in the game: the Steam discussion [Time to sleep](https://steamcommunity.com/app/227300/discussions/0/1644292444647278764/) on ferry time and the sleep timer; the Truck Simulator wiki's [Channel Tunnel](https://truck-simulator.fandom.com/wiki/Channel_Tunnel) page; and iXBT's [first look at update 1.60](https://ixbt.games/en/news/2026/05/30/euro-truck-simulator-2-i-ats-izmeniat-mexaniku-ustalosti-i-otdyxa-pervyi-vzgliad-na-obnovlenie-160.html).
- The Channel Tunnel in real life: Freightlink's [LeShuttle Freight live service updates](https://www.freightlink.co.uk/eurotunnel-live-service-updates) (departures per hour), and Ferryscanner's [Folkestone to Calais shuttle](https://www.ferryscanner.com/en/ferry-routes/train-folkestone-calais) page (the 35-minute crossing, round-the-clock service and check-in times).
- Russia, Turkey and the West Balkans: the ITF's [ECMT multilateral quota user guide, January 2026](https://www.itf-oecd.org/sites/default/files/docs/user_guide_2026_e.pdf).
