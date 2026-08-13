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
                t.TruckCapacity = 5;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = true;
                t.FuelPricePerGal = 3.58m; t.ShopLabourDiscount = 0.35; t.MonthlyCost = 4_200m;
                break;
            case "Medium":
                t.TruckCapacity = 3;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = 3.72m; t.ShopLabourDiscount = 0.20; t.MonthlyCost = 2_400m;
                break;
            default:
                t.Level = "Small";
                t.TruckCapacity = 1;
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
