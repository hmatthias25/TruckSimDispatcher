using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Brings career files written by older builds up to the current shape. Runs on every load and is
/// deliberately additive — it fills in what is missing and never discards or rewrites real history.
/// </summary>
public static class Migrations
{
    public static void Apply(AppState s)
    {
        if (!s.Onboarded) return;

        RebaseGameCalendar(s);
        EnsureTerminals(s);
        EnsureEquipmentTerminalIds(s);
        EnsureAssignedEquipmentIsInGarage(s);
        EnsureAccounts(s);
        CollapseReservesIntoOneCashAccount(s);
        EnsureDiscoveredCities(s);
        EnsureTripFuelStops(s);
        EnsureHomeTimeArrangement(s);
        ClearPhantomBankBalance(s);
        EnsureEquipmentStandard(s);
        EnsureCarrierNetwork(s);
        EnsureEndorsements(s);
        EnsureAtHomeFlag(s);
        EnsureCarrierStanding(s);
        EnsureFleetStars(s);
    }

    /// <summary>
    /// Home time used to be counted on every status report made from the yard rather than on arriving
    /// at it, so a driver sitting out a 34 at the house and reporting their clocks each morning was
    /// recorded as taking home time again every day.
    ///
    /// Seeds the flag from where the truck actually is, so a career loaded while parked at home does
    /// not get one final phantom count on the next report.
    /// </summary>
    private static void EnsureAtHomeFlag(AppState s)
    {
        if (s.Driver.AtHomeYard) return;
        var home = HomeTime.HomeTerminal(s);
        if (home == null) return;
        var miles = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        if (miles is { } m && m <= 1) s.Driver.AtHomeYard = true;
    }

    /// <summary>
    /// Endorsements used to live in the qualifications list, which rank promotion also writes company
    /// unlocks into — so being promoted to company driver handed the driver a hazmat endorsement they
    /// never sat an exam for. They have their own list now.
    ///
    /// Carried across from the application flags only. A "Hazmat" that arrived through promotion is NOT
    /// moved over, because it was never a licence — it was the carrier lifting its own restriction, and
    /// treating it as an endorsement is the bug being fixed.
    /// </summary>
    private static void EnsureEndorsements(AppState s)
    {
        if (s.Driver.Endorsements.Count > 0) return;
        if (s.Application == null) return;

        if (s.Application.HasHazmat) s.Driver.Endorsements.Add(Endorsements.Hazmat);
        if (s.Application.HasTanker) s.Driver.Endorsements.Add(Endorsements.Tanker);
        if (s.Application.HasDoublesTriples) s.Driver.Endorsements.Add(Endorsements.DoublesTriples);
    }

    /// <summary>
    /// Pay and home-time ratings were not stored, so retention had nothing to work from. Look them up
    /// from the carrier code. A career at a generated carrier keeps zeros and falls back to neutral.
    /// </summary>
    private static void EnsureCarrierStanding(AppState s)
    {
        if (s.Company.PayStars > 0 || s.Company.HomeTimeStars > 0) return;
        var (pay, home) = Carriers.StandingFor(s.Company.Code);
        if (pay <= 0 && home <= 0) return;
        s.Company.PayStars = pay;
        s.Company.HomeTimeStars = home;
    }

    /// <summary>
    /// Careers written before the app understood that ATS shows STARS for equipment under a hired
    /// driver — never a damage percentage — have no star readings at all.
    ///
    /// Nothing is invented here. A star rating cannot be derived from a percentage the player was
    /// wrongly asked to guess at, so units are left at zero stars, which the app reads as "not
    /// reported" and simply asks for on the next fortnightly report. What does get set is the trailer
    /// acquisition date, because age has to start counting from somewhere and the career's own hire
    /// date is the honest floor.
    /// </summary>
    private static void EnsureFleetStars(AppState s)
    {
        var fallback = string.IsNullOrWhiteSpace(s.Driver.HiredGameDate)
            ? s.Status.GameTime
            : s.Driver.HiredGameDate;
        if (string.IsNullOrWhiteSpace(fallback)) return;

        foreach (var tr in s.Trailers)
            if (string.IsNullOrWhiteSpace(tr.AcquiredGameTime))
                tr.AcquiredGameTime = fallback;

        // Yards had no trailer capacity, so an unset one would read as zero and refuse every purchase.
        foreach (var yard in s.Company.Terminals)
            if (yard.TrailerCapacity <= 0)
                yard.TrailerCapacity = yard.Level switch
                {
                    "Large" => 12,
                    "Medium" => 6,
                    _ => 3
                };
    }

    /// <summary>
    /// Careers written before the employer's terminal network was stored have nothing to check garage
    /// opportunities against, so the app offered a yard in every city the truck reached. Look the
    /// network up from the carrier code.
    ///
    /// Yards the driver already owns are left alone, even off-network — they bought those garages in
    /// ATS and they are real. This only affects what gets offered from here on.
    /// </summary>
    private static void EnsureCarrierNetwork(AppState s)
    {
        if (s.Company.NetworkCities.Count > 0) return;
        var net = Carriers.NetworkCitiesFor(s.Company.Code);
        if (net.Count == 0) return;      // fictional carrier: no real network to be faithful to

        // Anywhere we already have a yard belongs on the network too, or the app would start telling
        // the driver their own terminal is somewhere the company does not operate.
        foreach (var t in s.Company.Terminals)
        {
            var key = $"{t.City},{t.State}";
            if (!net.Any(n => n.Equals(key, StringComparison.OrdinalIgnoreCase))) net.Add(key);
        }
        s.Company.NetworkCities = net;
    }

    /// <summary>
    /// Careers written before the carrier's equipment standard was stored have no idea what tier of
    /// truck their employer runs. Look it up from the carrier code so upgrades and stocked yards
    /// issue the right equipment from here on. Nothing already in the fleet is touched.
    /// </summary>
    private static void EnsureEquipmentStandard(AppState s)
    {
        if (s.Company.EquipmentStars > 0) return;
        s.Company.EquipmentStars = Carriers.EquipmentStarsFor(s.Company.Code);
    }

    /// <summary>
    /// Older builds stamped the balance-reported timestamp on every status update, because the UI sent
    /// 0 for an untouched box rather than "not reported". The app then believed the game held zero and
    /// warned about a mismatch against its own perfectly correct figure — with no way out except
    /// zeroing the books to match a phantom.
    ///
    /// A zero balance on a career that has been trading is not a real reading, so treat it as never
    /// reported and ask for it properly. Nothing is destroyed; the ledger is untouched.
    /// </summary>
    private static void ClearPhantomBankBalance(AppState s)
    {
        if (s.Status.AtsBankBalance != 0) return;
        if (string.IsNullOrWhiteSpace(s.Status.AtsBalanceGameTime)) return;
        s.Status.AtsBalanceGameTime = "";
    }

    /// <summary>
    /// Home time used to be free text on the application ("every couple of weeks", "whenever") and was
    /// never acted on. Read what the driver wrote into a real interval where the wording is clear, and
    /// otherwise fall back to the common OTR arrangement rather than silently deciding they never go
    /// home. They can change it on the Career tab.
    /// </summary>
    private static void EnsureHomeTimeArrangement(AppState s)
    {
        if (s.Driver.HomeTimeIntervalDays != 0) return;                 // already set, or deliberately none
        if (s.Application == null) return;
        if (!string.IsNullOrWhiteSpace(s.Driver.LastHomeGameTime)) return;

        var text = (s.Application.HomeTimePreference ?? "").Trim().ToLowerInvariant();
        var key = text switch
        {
            _ when text.Length == 0 => "biweekly",
            _ when HomeTime.DaysFor(text) > 0 => text,                   // already a key
            _ when text.Contains("never") || text.Contains("stay out") || text.Contains("no pref") => "none",
            _ when text.Contains("week") && (text.Contains("every") || text.Contains("each"))
                   && !text.Contains("other") && !text.Contains("two") && !text.Contains("three") => "weekly",
            _ when text.Contains("other week") || text.Contains("two week") || text.Contains("biweek")
                   || text.Contains("14") => "biweekly",
            _ when text.Contains("three week") || text.Contains("21") => "threeweeks",
            _ when text.Contains("month") || text.Contains("30") => "monthly",
            _ when text.Contains("six week") || text.Contains("42") => "sixweeks",
            _ => "biweekly"
        };

        s.Application.HomeTimePreference = key;
        s.Driver.HomeTimeIntervalDays = HomeTime.DaysFor(key);
        // Start the clock from the hire date rather than pretending they just got home.
        s.Driver.LastHomeGameTime = s.Driver.HiredGameDate;
    }

    /// <summary>
    /// Careers written before city discovery was tracked know nothing about where the truck has been.
    /// Rebuild that from the history we do have, so an established career is not told it has
    /// discovered nothing. Backfilled cities are marked notified — a career with forty loads behind it
    /// should not open to forty "new city" notices.
    /// </summary>
    private static void EnsureDiscoveredCities(AppState s)
    {
        if (s.Discovered.Count == 0) DiscoveryService.Backfill(s);
        else DiscoveryService.SyncOwnership(s);
    }

    /// <summary>
    /// Fuel used to be one gallons/cost pair per trip. Promote those to a single fuel stop so every
    /// closed trip stores fuel the same way and the per-stop reporting has something to show.
    /// </summary>
    private static void EnsureTripFuelStops(AppState s)
    {
        foreach (var t in s.Trips)
        {
            if (t.FuelStops.Count > 0) continue;
            if (t.FuelGallons <= 0 && t.FuelCost <= 0) continue;
            t.FuelStops.Add(new FuelPurchase
            {
                GameTime = t.DeliveredGameTime,
                City = t.DestCity,
                State = t.DestState,
                Gallons = t.FuelGallons,
                Cost = t.FuelCost,
                PricePerGal = t.FuelGallons > 0 ? Math.Round(t.FuelCost / (decimal)t.FuelGallons, 3) : 0,
                Notes = "Reconstructed from the trip total — this build records each stop separately."
            });
        }
    }

    /// <summary>
    /// Equipment the carrier "owns" on paper but that does not exist in the driver's ATS garage.
    ///
    /// Older careers were seeded with a six-truck fleet across three yards. That cannot be reconciled
    /// with the game: the player never bought those units, so their damage and mileage are fiction,
    /// and yards in cities they never drove to would never see cargo anyway. This reports the problem
    /// and <see cref="TrimBackdropEquipment"/> fixes it — but only when the player asks, because
    /// deleting equipment is not something a migration should do behind their back.
    /// </summary>
    public static (int trucks, int trailers, int yards) CountBackdrop(AppState s)
    {
        var trucks = s.Trucks.Count(t => !t.InGameGarage && t.Unit != s.Driver.AssignedTruckUnit
                                         && !s.HiredDrivers.Any(h => h.AssignedTruckUnit == t.Unit));
        var trailers = s.Trailers.Count(t => !t.InGameGarage && t.Unit != s.Driver.AssignedTrailerUnit
                                             && !s.HiredDrivers.Any(h => h.AssignedTrailerUnit == t.Unit));
        var yards = s.Company.Terminals.Count(t => !t.IsHeadquarters
                                                   && !DiscoveryService.IsDiscovered(s, t.City, t.State));
        return (trucks, trailers, yards);
    }

    /// <summary>
    /// Removes on-paper-only equipment and undiscovered yards, keeping anything real: the driver's own
    /// units, anything assigned to a hired driver, anything flagged as being in an ATS garage, and
    /// headquarters. Units carrying real history are re-homed rather than deleted.
    /// </summary>
    public static List<string> TrimBackdropEquipment(AppState s, bool includeYards)
    {
        var notes = new List<string>();

        bool TruckIsReal(Truck t) => t.InGameGarage
                                     || t.Unit == s.Driver.AssignedTruckUnit
                                     || s.HiredDrivers.Any(h => h.AssignedTruckUnit == t.Unit)
                                     || s.Trips.Any(x => x.TruckUnit == t.Unit);

        bool TrailerIsReal(Trailer t) => t.InGameGarage
                                         || t.Unit == s.Driver.AssignedTrailerUnit
                                         || s.HiredDrivers.Any(h => h.AssignedTrailerUnit == t.Unit)
                                         || s.Trips.Any(x => x.TrailerUnit == t.Unit);

        var droppedTrucks = s.Trucks.Where(t => !TruckIsReal(t)).Select(t => t.Unit).ToList();
        s.Trucks.RemoveAll(t => droppedTrucks.Contains(t.Unit));
        if (droppedTrucks.Count > 0)
            notes.Add($"Removed {droppedTrucks.Count} tractor(s) that were never in your garage: {string.Join(", ", droppedTrucks)}.");

        var droppedTrailers = s.Trailers.Where(t => !TrailerIsReal(t)).Select(t => t.Unit).ToList();
        s.Trailers.RemoveAll(t => droppedTrailers.Contains(t.Unit));
        if (droppedTrailers.Count > 0)
            notes.Add($"Removed {droppedTrailers.Count} trailer(s) that were never in your garage: {string.Join(", ", droppedTrailers)}.");

        if (includeYards)
        {
            var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
            var doomed = s.Company.Terminals
                .Where(t => !t.IsHeadquarters && !DiscoveryService.IsDiscovered(s, t.City, t.State))
                .ToList();
            foreach (var y in doomed)
            {
                // Never orphan a unit. Anything based here comes back to headquarters.
                foreach (var t in s.Trucks.Where(t => t.HomeTerminalId == y.Id)) t.HomeTerminalId = hq?.Id ?? "";
                foreach (var t in s.Trailers.Where(t => t.HomeTerminalId == y.Id)) t.HomeTerminalId = hq?.Id ?? "";
                foreach (var d in s.HiredDrivers.Where(d => d.HomeTerminalId == y.Id)) d.HomeTerminalId = hq?.Id ?? "";
                if (s.Driver.HomeTerminalId == y.Id) s.Driver.HomeTerminalId = hq?.Id ?? "";
                s.Company.Terminals.Remove(y);
            }
            if (doomed.Count > 0)
                notes.Add($"Closed {doomed.Count} yard(s) in cities you have not reached: " +
                          $"{string.Join(", ", doomed.Select(y => DispatchEngine.Place(y.City, y.State)))}. " +
                          "Anything based there came back to headquarters.");
        }

        SyncHeadquarters(s);
        DiscoveryService.SyncOwnership(s);
        if (notes.Count == 0) notes.Add("Nothing to trim — every unit and yard on the book is real.");
        return notes;
    }

    /// <summary>
    /// Older careers physically moved money into "maintenance" and "payroll" reserve accounts. ATS
    /// has a single bank account, so that split invented cash the game does not have. Sweep any
    /// reserve balances back into operating once; from then on the reserves are computed earmarks
    /// against the one balance rather than pots holding money.
    /// </summary>
    private static void CollapseReservesIntoOneCashAccount(AppState s)
    {
        if (!s.Settings.SingleCashAccount) return;

        foreach (var key in new[] { LedgerService.MaintenanceReserve, LedgerService.PayrollReserve })
        {
            var acct = s.Accounts.FirstOrDefault(a => a.Key == key);
            if (acct == null) continue;

            var balance = LedgerService.Balance(s, key);
            if (Math.Abs(balance) < 0.01m) continue;

            // Move the money, preserving the history that put it there.
            LedgerService.Post(s, key, -balance, "Transfer",
                $"Reserve folded into operating cash — ATS has one bank account.", isAdjustment: true);
            LedgerService.Post(s, LedgerService.Operating, balance, "Transfer",
                $"{acct.Name} folded in; now tracked as an earmark, not separate cash.", isAdjustment: true);
        }
    }

    /// <summary>
    /// Careers written before the clock moved to day numbers stored real-world dates like
    /// 2026-03-02. ATS has no calendar, so those dates were fiction — and they would now render as
    /// "Day 9558". Shift every recorded moment so the career starts at Day 1, preserving all the
    /// intervals between them, which is the only thing the dates ever meant.
    /// </summary>
    private static void RebaseGameCalendar(AppState s)
    {
        // Anchor on the EARLIEST recorded moment, not the hire date. A career whose clock was moved
        // backwards at some point would otherwise shift below the epoch and render as a negative day.
        var earliest = AllGameTimes(s)
            .Select(GameClock.TryParse)
            .Where(d => d != null)
            .Select(d => d!.Value)
            .DefaultIfEmpty()
            .Min();
        if (earliest == default) return;

        // Anything at or before the epoch year is already on day numbering.
        if (earliest.Year <= GameClock.Epoch.Year) return;

        var offset = earliest.Date - GameClock.Epoch;

        string Shift(string? v) =>
            GameClock.TryParse(v) is { } dt ? GameClock.Format(dt - offset) : (v ?? "");

        s.Status.GameTime = Shift(s.Status.GameTime);
        s.Hos.AsOfGameTime = Shift(s.Hos.AsOfGameTime);
        s.Driver.HiredGameDate = Shift(s.Driver.HiredGameDate);
        s.Driver.Probation.StartedGameDate = Shift(s.Driver.Probation.StartedGameDate);
        s.Driver.Probation.ClearedGameDate = Shift(s.Driver.Probation.ClearedGameDate);

        foreach (var t in s.Driver.Transfers) t.RequestedGameTime = Shift(t.RequestedGameTime);
        foreach (var h in s.Driver.EmploymentHistory)
        {
            h.StartedGameDate = Shift(h.StartedGameDate);
            h.EndedGameDate = Shift(h.EndedGameDate);
        }

        foreach (var t in s.Trips)
        {
            t.DispatchedGameTime = Shift(t.DispatchedGameTime);
            t.DueGameTime = Shift(t.DueGameTime);
            t.DeliveredGameTime = Shift(t.DeliveredGameTime);
            foreach (var e in t.Events) e.GameTime = Shift(e.GameTime);
            if (t.FeasibilityAtDispatch is { } f)
            {
                f.ProjectedArrivalGameTime = Shift(f.ProjectedArrivalGameTime);
                f.DueGameTime = Shift(f.DueGameTime);
                foreach (var step in f.Timeline)
                {
                    step.StartGameTime = Shift(step.StartGameTime);
                    step.EndGameTime = Shift(step.EndGameTime);
                }
            }
        }

        foreach (var e in s.Ledger) e.GameTime = Shift(e.GameTime);
        foreach (var w in s.WorkOrders) w.GameTime = Shift(w.GameTime);
        foreach (var i in s.Incidents) i.GameTime = Shift(i.GameTime);
        foreach (var d in s.Discipline) d.GameTime = Shift(d.GameTime);
        foreach (var o in s.EquipmentOrders)
        {
            o.IssuedGameTime = Shift(o.IssuedGameTime);
            o.CompletedGameTime = Shift(o.CompletedGameTime);
        }
        foreach (var st in s.Settlements)
        {
            st.PeriodStartGame = Shift(st.PeriodStartGame);
            st.PeriodEndGame = Shift(st.PeriodEndGame);
        }
        foreach (var r in s.FleetReports)
        {
            r.PeriodStartGame = Shift(r.PeriodStartGame);
            r.PeriodEndGame = Shift(r.PeriodEndGame);
        }
        foreach (var d in s.HiredDrivers) d.HiredGameDate = Shift(d.HiredGameDate);
        foreach (var e in s.Events) e.GameTime = Shift(e.GameTime);
    }

    /// <summary>Every stored game moment, used to find the true start of the career.</summary>
    private static IEnumerable<string> AllGameTimes(AppState s)
    {
        yield return s.Status.GameTime;
        yield return s.Hos.AsOfGameTime;
        yield return s.Driver.HiredGameDate;
        yield return s.Driver.Probation.StartedGameDate;
        foreach (var h in s.Driver.EmploymentHistory) yield return h.StartedGameDate;
        foreach (var t in s.Trips)
        {
            yield return t.DispatchedGameTime;
            foreach (var e in t.Events) yield return e.GameTime;
        }
        foreach (var e in s.Ledger) yield return e.GameTime;
        foreach (var w in s.WorkOrders) yield return w.GameTime;
        foreach (var i in s.Incidents) yield return i.GameTime;
        foreach (var d in s.Discipline) yield return d.GameTime;
        foreach (var st in s.Settlements) yield return st.PeriodStartGame;
        foreach (var r in s.FleetReports) yield return r.PeriodStartGame;
        foreach (var d in s.HiredDrivers) yield return d.HiredGameDate;
    }

    /// <summary>
    /// Equipment used to record its yard as free text, which meant capacity checks did fragile
    /// string matching on city names. Resolve each unit to a real terminal id once.
    /// </summary>
    private static void EnsureEquipmentTerminalIds(AppState s)
    {
        if (s.Company.Terminals.Count == 0) return;
        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters) ?? s.Company.Terminals[0];

        string Resolve(string legacy)
        {
            if (string.IsNullOrWhiteSpace(legacy)) return hq.Id;
            var city = legacy.Split(',')[0].Trim();
            var hit = s.Company.Terminals.FirstOrDefault(t =>
                t.City.Equals(city, StringComparison.OrdinalIgnoreCase));
            return hit?.Id ?? hq.Id;
        }

#pragma warning disable CS0618 // reading the superseded field is the point of the migration
        foreach (var t in s.Trucks.Where(t => string.IsNullOrWhiteSpace(t.HomeTerminalId)))
            t.HomeTerminalId = Resolve(t.HomeTerminal);
        foreach (var t in s.Trailers.Where(t => string.IsNullOrWhiteSpace(t.HomeTerminalId)))
            t.HomeTerminalId = Resolve(t.HomeTerminal);
#pragma warning restore CS0618
    }

    /// <summary>Tractors based at a yard, which is what its capacity limits.</summary>
    public static int TrucksBasedAt(AppState s, string terminalId) =>
        s.Trucks.Count(t => t.HomeTerminalId == terminalId && t.Status != "OutOfService");

    /// <summary>Remaining tractor slots at a yard. Negative means it is over capacity.</summary>
    public static int RoomAt(AppState s, Terminal t) => t.TruckCapacity - TrucksBasedAt(s, t.Id);

    public static Terminal? TerminalOf(AppState s, string? terminalId) =>
        s.Company.Terminals.FirstOrDefault(t => t.Id == terminalId);

    /// <summary>Older files stored a single terminal city plus a list of strings.</summary>
    private static void EnsureTerminals(AppState s)
    {
        if (s.Company.Terminals.Count > 0)
        {
            SyncHeadquarters(s);
            return;
        }

        if (!string.IsNullOrWhiteSpace(s.Company.TerminalCity))
            s.Company.Terminals.Add(BuildTerminal(s, s.Company.TerminalCity, s.Company.TerminalState, isHq: true, "Large"));

#pragma warning disable CS0618 // reading the superseded field is the whole point of the migration
        foreach (var legacy in s.Company.SecondaryTerminals)
        {
            var parts = legacy.Split(',', StringSplitOptions.TrimEntries);
            if (parts.Length == 0 || string.IsNullOrWhiteSpace(parts[0])) continue;
            var city = parts[0];
            var st = parts.Length > 1 ? parts[1] : "";
            if (s.Company.Terminals.Any(t => t.City.Equals(city, StringComparison.OrdinalIgnoreCase)
                                             && t.State.Equals(st, StringComparison.OrdinalIgnoreCase))) continue;
            s.Company.Terminals.Add(BuildTerminal(s, city, st, isHq: false, "Medium"));
        }
        s.Company.SecondaryTerminals.Clear();
#pragma warning restore CS0618

        SyncHeadquarters(s);
    }

    /// <summary>
    /// The unit the driver sits in must be real equipment, otherwise its damage readings would be
    /// tracked against a truck ATS has never heard of.
    /// </summary>
    private static void EnsureAssignedEquipmentIsInGarage(AppState s)
    {
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit);
        if (truck != null && !truck.InGameGarage) truck.InGameGarage = true;

        var trailer = s.Trailers.FirstOrDefault(t => t.Unit == s.Driver.AssignedTrailerUnit);
        if (trailer != null && !trailer.InGameGarage) trailer.InGameGarage = true;
    }

    private static void EnsureAccounts(AppState s)
    {
        if (s.Accounts.Count == 0) Seed.ApplyDefaultAccounts(s);
    }

    public static Terminal BuildTerminal(AppState s, string city, string state, bool isHq, string level)
    {
        var market = Markets.Find(s, city, state);
        var t = new Terminal
        {
            Name = isHq ? $"{s.Company.Name} — {city} (HQ)" : $"{s.Company.Name} — {city}",
            City = city,
            State = (state ?? "").Trim().ToUpperInvariant(),
            IsHeadquarters = isHq,
            Notes = market == null ? "" : $"Tier-{market.Tier} freight market."
        };
        ApplyLevel(t, level);
        return t;
    }

    /// <summary>
    /// Capacity and services follow the yard tier. Even the smallest yard fuels and parks a truck —
    /// a terminal that cannot do that is not a terminal — while a shop needs real square footage.
    /// </summary>
    public static void ApplyLevel(Terminal t, string level)
    {
        t.Level = level;
        switch (level)
        {
            case "Large":
                t.TruckCapacity = 5; t.TrailerCapacity = 12;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = true;
                t.FuelPricePerGal = 3.58m; t.ShopLabourDiscount = 0.35; t.MonthlyCost = 4_200m;
                break;
            case "Medium":
                t.TruckCapacity = 3; t.TrailerCapacity = 6;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = 3.72m; t.ShopLabourDiscount = 0.20; t.MonthlyCost = 2_400m;
                break;
            default:
                t.Level = "Small";
                t.TruckCapacity = 1; t.TrailerCapacity = 3;
                t.HasFuel = true; t.HasShop = false; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = 3.85m; t.ShopLabourDiscount = 0; t.MonthlyCost = 1_150m;
                break;
        }
    }

    /// <summary>Keeps the convenience HQ fields on Company in step with the terminal list.</summary>
    public static void SyncHeadquarters(AppState s)
    {
        if (s.Company.Terminals.Count == 0) return;
        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters) ?? s.Company.Terminals[0];
        hq.IsHeadquarters = true;
        foreach (var t in s.Company.Terminals.Where(t => t != hq)) t.IsHeadquarters = false;
        s.Company.TerminalCity = hq.City;
        s.Company.TerminalState = hq.State;
    }

    /// <summary>The terminal the truck is standing in right now, if any.</summary>
    public static Terminal? At(AppState s) =>
        s.Status.LocationKind != "Terminal" ? null
        : s.Company.Terminals.FirstOrDefault(t =>
            t.City.Equals(s.Status.LocationCity, StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrWhiteSpace(t.State) || t.State.Equals(s.Status.LocationState, StringComparison.OrdinalIgnoreCase)));
}
