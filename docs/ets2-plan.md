# Euro Truck Simulator 2 support: plan

Status: **not started**. This is the reference for building it later. It was written on 2026-10-01 against v0.73 (`2c8c2b6`). The counts below are approximate and came from a read-through of the code. Re-check any file or symbol named here before relying on it, because the code will have moved on.

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
- **Home time:** `HomeTime.cs` (about 1,800 lines) is built on US over-the-road patterns (biweekly, a 34 at home). The EU Mobility Package equivalent is: home every 4 weeks, and no regular weekly rest in the cab.
- **Probation, grades and conduct** (`Probation*.cs`, `DriverRank.cs`) are the game's own rules, not law, and mostly carry over.

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
5. **Handle pay and tax:** a pay-model choice (salary or hourly in place of per-mile), a flat deduction in place of W-2s, and optional detention.
6. **Integrate the game and add the career choice to onboarding:** the ETS2 Steam app ID and paths, the AI prompts, the 24-hour window parsing, and the game choice on the new-career screen.
7. **Write the manuals and the EU test suite**, and run both games' suites in the finishing routine.

## Decisions to make before starting

- Whether to support EU hours-of-service rules in full, or start with a simpler subset: daily driving, the 4.5 + 45 break and daily rest first, then weekly and two-week limits.
- Currency: euros only, or a currency setting.
- Pay model for EU careers: salary, hourly, or per-km.
- Carriers: real European companies, fictional ones, or both, as in the US build.
- Mods: whether to support ProMods or other European map mods at the start.
- Career storage: one store that records each career's game, or a folder per game.
