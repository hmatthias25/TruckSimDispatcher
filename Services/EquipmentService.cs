using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>One way the driver could get onto the trailer a load needs.</summary>
public class SwapOption
{
    public string TrailerUnit { get; set; } = "";
    public string TrailerType { get; set; } = "";
    public string Length { get; set; } = "";
    public double DamagePct { get; set; }
    public string LocationLabel { get; set; } = "";
    public string TerminalId { get; set; } = "";
    /// <summary>True when the truck is already standing where this trailer is.</summary>
    public bool HereNow { get; set; }
    public bool AtCompanyYard { get; set; }
    public string Note { get; set; } = "";
}

public class SwapPlan
{
    public bool Possible { get; set; }
    public string Reason { get; set; } = "";
    public string RequiredType { get; set; } = "";
    public List<SwapOption> Options { get; set; } = new();
}

/// <summary>
/// Trailer and tractor changes. Previously a load needing a different trailer was simply rejected,
/// which named the fix and refused to let the driver do it. Dispatch should instead route the truck
/// to a yard holding the right trailer and issue an equipment move.
/// </summary>
public static class EquipmentService
{
    /// <summary>Where the driver could pick up a trailer of the type a load needs.</summary>
    public static SwapPlan PlanSwap(AppState s, string requiredType)
    {
        var plan = new SwapPlan { RequiredType = requiredType };
        if (string.IsNullOrWhiteSpace(requiredType))
        {
            plan.Reason = "No trailer type given.";
            return plan;
        }

        var here = $"{s.Status.LocationCity}, {s.Status.LocationState}";
        var candidates = s.Trailers
            .Where(t => t.Status == "InService"
                        && t.Unit != s.Driver.AssignedTrailerUnit
                        && TypeCovers(t.Type, requiredType))
            .ToList();

        if (candidates.Count == 0)
        {
            plan.Reason = $"The company has no available {requiredType} trailer. " +
                          "Buy one in ATS and add it on the Fleet tab, or take a market trailer with the job.";
            return plan;
        }

        foreach (var t in candidates)
        {
            var yard = Migrations.TerminalOf(s, t.HomeTerminalId);
            var where = !string.IsNullOrWhiteSpace(t.CurrentLocation)
                ? t.CurrentLocation
                : yard != null ? $"{yard.City}, {yard.State}" : "location unknown";

            plan.Options.Add(new SwapOption
            {
                TrailerUnit = t.Unit,
                TrailerType = t.Type,
                Length = t.Length,
                DamagePct = t.DamagePct,
                LocationLabel = where,
                TerminalId = t.HomeTerminalId,
                HereNow = where.Equals(here, StringComparison.OrdinalIgnoreCase),
                AtCompanyYard = yard != null && where.Equals($"{yard.City}, {yard.State}", StringComparison.OrdinalIgnoreCase),
                Note = t.DamagePct >= s.Settings.Maintenance.MandatoryReviewPct
                    ? $"At {t.DamagePct:0.#}% damage — needs shop attention before it earns anything."
                    : ""
            });
        }

        plan.Options = plan.Options
            .OrderByDescending(o => o.HereNow)
            .ThenByDescending(o => o.AtCompanyYard)
            .ThenBy(o => o.DamagePct)
            .ToList();
        plan.Possible = true;
        plan.Reason = plan.Options[0].HereNow
            ? $"Trailer {plan.Options[0].TrailerUnit} is here — swap and go."
            : $"Nearest company {requiredType} is {plan.Options[0].TrailerUnit} at {plan.Options[0].LocationLabel}. " +
              "Run an equipment move to collect it.";
        return plan;
    }

    /// <summary>A step deck covers flatbed freight and a reefer runs dry; nothing else substitutes.</summary>
    /// <summary>
    /// Whether one trailer type can stand in for another when <b>choosing equipment</b> — planning a
    /// swap, stocking a yard, re-rigging at home time.
    ///
    /// Deliberately NOT used to gate freight. ATS filters the board by the trailer already hooked, so a
    /// job the driver can see is one their trailer pulls, and second-guessing that from a short table of
    /// equivalences refused legitimate loads. See DispatchEngine.Evaluate.
    /// </summary>
    public static bool TypeCovers(string have, string need)
    {
        if (string.IsNullOrWhiteSpace(have) || string.IsNullOrWhiteSpace(need)) return false;
        have = have.Trim(); need = need.Trim();
        if (have.Equals(need, StringComparison.OrdinalIgnoreCase)) return true;
        if (have.Equals("Step Deck", StringComparison.OrdinalIgnoreCase) &&
            need.Equals("Flatbed", StringComparison.OrdinalIgnoreCase)) return true;
        if (have.Equals("Reefer", StringComparison.OrdinalIgnoreCase) &&
            need.Equals("Dry Van", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    /// <summary>
    /// Hooks a different company trailer. Only legal where the trailer actually is — you cannot
    /// drop a reefer in Denver and be under a flatbed in Tulsa.
    /// </summary>
    public static string SwapTrailer(AppState s, string trailerUnit, bool force)
    {
        // Hooking a different trailer is still operations' call, not the driver's — the physical checks
        // below (it has to be here, nothing hooked to it) are about whether it is possible, not whether
        // it is allowed.
        Requests.GuardSelfAssignment(s, null, trailerUnit);

        var trailer = s.Trailers.FirstOrDefault(t => t.Unit.Equals(trailerUnit, StringComparison.OrdinalIgnoreCase))
                      ?? throw new InvalidOperationException($"Trailer {trailerUnit} is not in the fleet.");
        if (trailer.Status != "InService" && !force)
            throw new InvalidOperationException($"Trailer {trailer.Ref} is {trailer.Status}.");

        var open = s.Trips.FirstOrDefault(t => t.Status is "Authorized" or "InTransit");
        if (open != null)
            throw new InvalidOperationException($"{open.Number} is still open — you are hooked to freight. Close it first.");

        var here = $"{s.Status.LocationCity}, {s.Status.LocationState}";
        var trailerAt = !string.IsNullOrWhiteSpace(trailer.CurrentLocation)
            ? trailer.CurrentLocation
            : Migrations.TerminalOf(s, trailer.HomeTerminalId) is { } y ? $"{y.City}, {y.State}" : "";

        if (!force && !trailerAt.Equals(here, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Trailer {trailer.Ref} is at {trailerAt}; you are at {here}. Run an equipment move to collect it first.");

        // Drop what we are on where we are standing.
        var previous = s.Trailers.FirstOrDefault(t => t.Unit == s.Driver.AssignedTrailerUnit);
        if (previous != null)
        {
            previous.AssignedTruckUnit = "";
            previous.CurrentLocation = here;
        }

        trailer.AssignedTruckUnit = s.Driver.AssignedTruckUnit;
        trailer.CurrentLocation = here;
        s.Driver.AssignedTrailerUnit = trailer.Unit;
        s.Status.TrailerDamagePct = trailer.DamagePct;

        return previous == null
            ? $"Hooked trailer {trailer.Ref} ({trailer.Length} {trailer.Type}) at {here}."
            : $"Dropped {previous.Ref} and hooked {trailer.Ref} ({trailer.Length} {trailer.Type}) at {here}.";
    }

    /// <summary>
    /// An empty move whose purpose is to go and collect equipment. Uses the maintenance number
    /// series so it never consumes a freight number.
    /// </summary>
    public static Trip CreateEquipmentMove(AppState s, string trailerUnit, double miles, string reason)
    {
        var trailer = s.Trailers.FirstOrDefault(t => t.Unit.Equals(trailerUnit, StringComparison.OrdinalIgnoreCase))
                      ?? throw new InvalidOperationException($"Trailer {trailerUnit} is not in the fleet.");

        var yard = Migrations.TerminalOf(s, trailer.HomeTerminalId);
        var dest = !string.IsNullOrWhiteSpace(trailer.CurrentLocation)
            ? trailer.CurrentLocation
            : yard != null ? $"{yard.City}, {yard.State}" : "";
        var parts = dest.Split(',', StringSplitOptions.TrimEntries);

        var move = DispatchEngine.CreateMaintenanceMove(
            s, parts.ElementAtOrDefault(0) ?? "", parts.ElementAtOrDefault(1) ?? "", miles,
            string.IsNullOrWhiteSpace(reason)
                ? $"Equipment move — collect trailer {trailer.Ref} ({trailer.Type})"
                : reason);
        move.Cargo = $"Equipment move — trailer {trailer.Ref}";
        move.Notes = $"On arrival, swap onto {trailer.Ref} ({trailer.Length} {trailer.Type}).";
        return move;
    }

    // ---------------------------------------------------------------- equipment orders

    private static EquipmentOrder Issue(AppState s, EquipmentOrder o)
    {
        var code = string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;
        o.Number = $"{code}-EQ-{s.EquipmentOrders.Count + 1:000}";
        o.IssuedGameTime = s.Status.GameTime;
        o.LoadCountAtIssue = s.Trips.Count(t => t.Status == "Delivered" && t.Kind == "Freight");
        s.EquipmentOrders.Insert(0, o);
        return o;
    }

    public static EquipmentOrder? OpenOrder(AppState s) =>
        s.EquipmentOrders.FirstOrDefault(o => o.Status == "Open");

    /// <summary>
    /// Puts the driver on a different type of trailer for their next tour.
    ///
    /// Issued during home time, because that is the only point a carrier can realistically re-rig a
    /// driver — the truck is standing at its own yard with nothing hooked to it. Where the trailer
    /// comes from decides how long it takes:
    ///
    ///   * one sitting free at the home yard  — ready when you are
    ///   * one out under a hired driver       — you wait for them to bring it in, at home
    ///   * none on the property               — you buy one in ATS before you leave
    ///
    /// The wait is the point rather than an inconvenience to design away. A real driver whose next
    /// tour needs a reefer does not get one conjured up; they sit at the house until the reefer is
    /// back, and those days are days at home.
    /// </summary>
    public static EquipmentOrder? IssueTrailerReassignment(AppState s, string requiredType, string reason)
    {
        if (string.IsNullOrWhiteSpace(requiredType)) return null;

        var current = DispatchEngine.AssignedTrailer(s);
        if (current != null && TypeCovers(current.Type, requiredType)) return null;   // already on it
        if (s.EquipmentOrders.Any(o => o.Status == "Open" && o.Kind == "TrailerSwap")) return null;

        var homeYard = Migrations.TerminalOf(s, s.Driver.HomeTerminalId)
                       ?? s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
        var homeLabel = homeYard != null ? DispatchEngine.Place(homeYard.City, homeYard.State) : "the yard";

        var matching = s.Trailers
            .Where(t => t.Status == "InService" && TypeCovers(t.Type, requiredType))
            .ToList();

        // A trailer one of our own drivers is pulling is NOT free, however empty its AssignedTruckUnit
        // looks. Assigning a hired driver to a trailer only ever set it on the driver's record, never on
        // the trailer, so this used to hand the player a trailer that was out on the road under somebody
        // else — and quietly, as a straight swap.
        bool HeldByHire(Trailer t) => s.HiredDrivers.Any(h => h.Status == "Active"
            && h.AssignedTrailerUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));

        // 1. Something free — nobody on it, and it is sitting at our home yard.
        var free = matching.FirstOrDefault(t => string.IsNullOrWhiteSpace(t.AssignedTruckUnit)
                                                && !HeldByHire(t)
                                                && homeYard != null && t.HomeTerminalId == homeYard.Id)
                   ?? matching.FirstOrDefault(t => string.IsNullOrWhiteSpace(t.AssignedTruckUnit)
                                                   && !HeldByHire(t));

        if (free != null)
        {
            var at = !string.IsNullOrWhiteSpace(free.CurrentLocation) ? free.CurrentLocation : homeLabel;
            return Issue(s, new EquipmentOrder
            {
                Kind = "TrailerSwap",
                Reason = reason,
                FromTrailerUnit = current?.Unit ?? "",
                ToTrailerUnit = free.Unit,
                TerminalId = homeYard?.Id ?? "",
                TerminalLabel = homeLabel,
                AvailableFromGameTime = s.Status.GameTime,
                Instruction = $"Next tour is {TrailerSpec.Describe(requiredType, free.Subtype)} freight. " +
                              $"Drop {(current == null ? "your trailer" : current.Unit)} and hook trailer {free.Ref} " +
                              $"({free.Year} {free.Make}, {free.Length} {TrailerSpec.Describe(free.Type, free.Subtype)}) at {at}. " +
                              "Do the swap in ATS, then mark this order complete.",
                Notes = "Trailer is on the property and free."
            });
        }

        // 2. Out with one of our own drivers — we wait for it.
        var taken = matching
            .Select(t => new { Trailer = t, Driver = s.HiredDrivers.FirstOrDefault(h => h.AssignedTrailerUnit == t.Unit && h.Status == "Active") })
            .FirstOrDefault(x => x.Driver != null);

        if (taken != null)
        {
            // A date only if the player gave us one. Nothing here guesses.
            var back = ReportedReturn(taken.Driver!);
            var when = back != null
                ? $"You have them down as due back around {GameClock.Pretty(back)}. "
                : "I have no way of knowing where they are — nothing you report on the fleet tab tells me that. " +
                  "Check your company screen in game; if it gives you a date, put it on their record and I will " +
                  "plan around it. ";

            return Issue(s, new EquipmentOrder
            {
                Kind = "TrailerSwap",
                Reason = reason,
                FromTrailerUnit = current?.Unit ?? "",
                ToTrailerUnit = taken.Trailer.Unit,
                TerminalId = homeYard?.Id ?? "",
                TerminalLabel = homeLabel,
                AvailableFromGameTime = back ?? "",
                HeldByDriverName = taken.Driver!.Name,
                Instruction = $"Next tour is {TrailerSpec.Describe(requiredType, taken.Trailer.Subtype)} freight, and our " +
                              $"{TrailerSpec.Describe(taken.Trailer.Type, taken.Trailer.Subtype)} " +
                              $"({taken.Trailer.Ref}) is out with {taken.Driver!.Name}. " + when +
                              "Stay home until it is in; the wait comes out of your home time, not your hours. " +
                              $"When the trailer turns up, hook {taken.Trailer.Ref} and mark this order complete — " +
                              "or ask me for a different trailer if you would rather not sit on it.",
                Notes = $"Waiting on {taken.Driver!.Name} to return {taken.Trailer.Ref}."
            });
        }

        // 3. We simply do not own one.
        return Issue(s, new EquipmentOrder
        {
            Kind = "TrailerSwap",
            Reason = reason,
            FromTrailerUnit = current?.Unit ?? "",
            ToTrailerUnit = "",
            TerminalId = homeYard?.Id ?? "",
            TerminalLabel = homeLabel,
            MustPurchase = true,
            AvailableFromGameTime = s.Status.GameTime,
            Instruction = $"Next tour is {TrailerSpec.Describe(requiredType, null)} freight and the company has none " +
                          $"available. While you are home, buy one in ATS at {homeLabel}: " +
                          $"{(TrailerSpec.IsTanker(requiredType) ? TrailerSpec.BuyingAdvice(s, requiredType, null) : $"a {requiredType.ToLowerInvariant()}.")} " +
                          "Add it on the Fleet tab, hook it, then mark this order complete.",
            Notes = $"No {requiredType} on the property."
        });
    }

    /// <summary>
    /// Orders the trailer that replaces one coming off the fleet.
    ///
    /// Raised by the fleet report rather than asked for: whether a trailer earns its place and what
    /// replaces it are operations decisions, so the driver gets a number and a spec instead of a
    /// question. Same shape as the order raised when a tractor is written off.
    ///
    /// Returns null when an equipment order is already open — one at a time, and the report says so
    /// rather than pretending the order exists.
    /// </summary>
    public static EquipmentOrder? OrderReplacementTrailer(AppState s, Trailer retiring, string newType, string reason)
    {
        if (OpenOrder(s) != null) return null;

        var homeYard = HomeTime.HomeTerminal(s);
        var homeLabel = homeYard != null ? $"{homeYard.City}, {homeYard.State}" : "your home yard";
        var advice = TrailerSpec.IsTanker(newType)
            ? TrailerSpec.BuyingAdvice(s, newType, null)
            : $"a {newType.ToLowerInvariant()}.";

        return Issue(s, new EquipmentOrder
        {
            Kind = "TrailerSwap",
            Reason = reason,
            FromTrailerUnit = retiring.Unit,
            ToTrailerUnit = "",
            TerminalId = homeYard?.Id ?? "",
            TerminalLabel = homeLabel,
            MustPurchase = true,
            AvailableFromGameTime = s.Status.GameTime,
            Instruction = $"{retiring.Ref} is coming off the fleet. Buy the replacement in ATS at {homeLabel}: " +
                          $"{advice} Add it on the Fleet tab, then mark this order complete — " +
                          $"{retiring.Ref} retires when the new one is on the books.",
            Notes = $"Replacing {retiring.Ref} ({retiring.Type}) with a {newType}."
        });
    }

    /// <summary>
    /// Roughly how long until a hired driver brings a trailer back. Seeded on the driver and the day
    /// so the answer does not change when the page is refreshed.
    /// </summary>
    /// <summary>
    /// When a hired driver will be back with the trailer — <b>only if the player has told us</b>.
    ///
    /// This used to be <c>1 + seed % 7 * 0.5</c>: a made-up number between one and four days, printed
    /// with a game time on it as though it were known. The app cannot know. It knows who holds the
    /// trailer, because the driver-to-trailer assignment is something the player entered, but nothing in
    /// the fortnightly report carries a location or an ETA — it collects level, rating, $/mile, $/day,
    /// stars, the odometer, wages and repairs, and none of that says where anybody is.
    ///
    /// Telling a driver to sit at home for four days on the strength of that is the one thing this app
    /// is built not to do, so it does not any more. Where the player has looked at their own company
    /// screen and given a date, that date is real and gets used. Otherwise the wait is on the event: they
    /// report in when the trailer turns up.
    /// </summary>
    private static string? ReportedReturn(HiredDriver d) => null;

    private static uint StableHash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }

    /// <summary>
    /// A trailer swap we are still waiting on. Dispatch uses this to hold the driver at home rather
    /// than sending them out on the wrong equipment.
    /// </summary>
    /// <summary>
    /// An open trailer swap the driver is still waiting on.
    ///
    /// Where a due-back date has been reported, the wait ends when that date passes — the trailer should
    /// be in. Where there is <b>no date</b>, the wait ends when the driver says it is in by closing the
    /// order. It used to require a date and return null without one, which meant removing the invented
    /// date silently stopped the wait being recognised at all: dispatch unblocked and the driver could
    /// roll away from a trailer they had been told to collect.
    ///
    /// Only a swap held by one of our own drivers waits on anything. A straight swap off the property is
    /// something the driver can do the moment they read it.
    /// </summary>
    public static EquipmentOrder? PendingTrailerWait(AppState s)
    {
        var o = s.EquipmentOrders.FirstOrDefault(x => x.Status == "Open" && x.Kind == "TrailerSwap");
        if (o == null) return null;
        if (string.IsNullOrWhiteSpace(o.HeldByDriverName)) return null;   // nothing to wait for

        // No date on file: waiting on the event, so it stays pending until the order is closed.
        if (string.IsNullOrWhiteSpace(o.AvailableFromGameTime)) return o;

        var ready = GameClock.TryParse(o.AvailableFromGameTime);
        var now = GameClock.TryParse(s.Status.GameTime);
        if (ready == null || now == null) return o;
        return now.Value < ready.Value ? o : null;
    }

    /// <summary>
    /// Earned an upgrade. The best unassigned sleeper on the property is reserved and the driver is
    /// told which yard to collect it from — they do the swap in ATS and confirm it here.
    /// </summary>
    /// <summary>
    /// An upgrade onto a tractor that does not exist yet, because the player has to go and buy it.
    ///
    /// <see cref="IssueUpgrade"/> moves a driver onto a better unit already standing on the property.
    /// This is the other case: the review traded a truck out, the replacement is going under the player
    /// rather than the hired driver, and nothing is on the yard to move into until they have been to a
    /// dealer. So the order is raised with <see cref="EquipmentOrder.MustPurchase"/> set and no target
    /// unit — it holds the swap open, points them at the yard, and is closed once the truck is on the
    /// books and they are standing next to it.
    /// </summary>
    public static EquipmentOrder? IssuePurchasedUpgrade(AppState s, string reason, string yardLabel,
                                                        string yardId, string driverName,
                                                        string fromTruckUnit, string spec)
    {
        if (OpenOrder(s) != null) return null;   // one equipment order at a time

        return Issue(s, new EquipmentOrder
        {
            Kind = "Upgrade",
            Reason = reason,
            FromTruckUnit = fromTruckUnit,
            ToTruckUnit = "",
            TerminalId = yardId,
            TerminalLabel = yardLabel,
            MustPurchase = true,
            Instruction =
                $"Buy the tractor in ATS: {spec} Add it on the Fleet tab, and leave it unassigned — " +
                $"it is going under you, not {driverName}. Then report to {yardLabel} and mark this order " +
                $"complete; {driverName} takes your old unit at the same time. I will work you back that " +
                "way with freight rather than running you there empty."
        });
    }

    public static EquipmentOrder? IssueUpgrade(AppState s, string reason)
    {
        var current = DispatchEngine.AssignedTruck(s);
        var better = BestAvailableTruck(s);
        if (better == null || (current != null && better.Unit == current.Unit)) return null;

        // Only an actual improvement is worth moving a driver for.
        if (current != null && better.Year <= current.Year && better.ServiceMiles >= current.ServiceMiles)
            return null;

        var yard = Migrations.TerminalOf(s, better.HomeTerminalId);
        var label = yard != null ? $"{yard.City}, {yard.State}" : "the yard";
        var home = Migrations.TerminalOf(s, s.Driver.HomeTerminalId)
                   ?? s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
        var homeLabel = home != null ? $"{home.City}, {home.State}" : "your home yard";
        var remote = home != null && yard != null && home.Id != yard.Id;

        return Issue(s, new EquipmentOrder
        {
            Kind = "Upgrade",
            Reason = reason,
            FromTruckUnit = current?.Unit ?? "",
            ToTruckUnit = better.Unit,
            TerminalId = better.HomeTerminalId,
            TerminalLabel = label,
            Instruction =
                $"Report to the {label} yard and move into unit {better.Ref} — a {better.Year} {better.Make} " +
                $"{better.Model}, {better.Engine}, {better.Transmission}. " +
                (current != null
                    ? remote
                        ? $"Drop {current.Ref} there; it becomes a {label} unit and {better.Ref} comes onto your " +
                          $"{homeLabel} book. A straight swap, so neither yard changes headcount. "
                        : $"Leave {current.Ref} at the yard. "
                    : "") +
                "Do the swap in ATS, then mark this order complete and the fleet records update themselves."
        });
    }

    /// <summary>
    /// A discipline consequence short of suspension: out of the good truck and into the highest
    /// mileage unit on the property, with a stated way to earn it back.
    /// </summary>
    public static EquipmentOrder? IssueDowngrade(AppState s, string reason, int restoreAfterLoads)
    {
        var current = DispatchEngine.AssignedTruck(s);
        var worst = s.Trucks
            .Where(t => t.Status == "InService" && t.CabConfig == "Sleeper"
                        && t.Unit != s.Driver.AssignedTruckUnit
                        && !s.HiredDrivers.Any(h => h.AssignedTruckUnit == t.Unit))
            .OrderByDescending(t => t.ServiceMiles)
            .ThenBy(t => t.Year)
            .FirstOrDefault();
        if (worst == null) return null;

        var yard = Migrations.TerminalOf(s, worst.HomeTerminalId);
        var label = yard != null ? $"{yard.City}, {yard.State}" : "the yard";

        return Issue(s, new EquipmentOrder
        {
            Kind = "Downgrade",
            Reason = reason,
            FromTruckUnit = current?.Unit ?? "",
            ToTruckUnit = worst.Unit,
            TerminalId = worst.HomeTerminalId,
            TerminalLabel = label,
            RestoreAfterLoads = restoreAfterLoads,
            Instruction =
                $"Report to {label} and turn in {current?.Ref}. You are going into unit {worst.Ref} — " +
                $"a {worst.Year} {worst.Make} {worst.Model} with {worst.ServiceMiles:N0} miles on it. " +
                $"Run {restoreAfterLoads} clean loads and we will talk about putting you back in something better."
        });
    }

    /// <summary>
    /// The best tractor the driver could realistically be moved into. Prefers one already near where
    /// they are — sending a driver across three states to collect a truck that is marginally newer is
    /// not how a fleet is run, and the yard nearest them almost always wins.
    /// </summary>
    public static Truck? BestAvailableTruck(AppState s)
    {
        var candidates = s.Trucks
            .Where(t => t.Status == "InService" && t.CabConfig == "Sleeper"
                        && t.Unit != s.Driver.AssignedTruckUnit
                        && !s.HiredDrivers.Any(h => h.AssignedTruckUnit == t.Unit))
            .ToList();
        if (candidates.Count == 0) return null;

        return candidates
            .OrderBy(t => Proximity(s, t))          // 0 = this city, 1 = this state, 2 = elsewhere
            .ThenByDescending(t => t.Year)
            .ThenBy(t => t.ServiceMiles)
            .FirstOrDefault();
    }

    /// <summary>How far out of the driver's way a unit's yard is. Lower is closer.</summary>
    private static int Proximity(AppState s, Truck t)
    {
        var yard = Migrations.TerminalOf(s, t.HomeTerminalId);
        if (yard == null) return 3;
        if (yard.City.Equals(s.Status.LocationCity, StringComparison.OrdinalIgnoreCase)) return 0;
        if (yard.State.Equals(s.Status.LocationState, StringComparison.OrdinalIgnoreCase)) return 1;
        return 2;
    }

    /// <summary>Records that the driver actually did the swap in the game.</summary>
    public static string CompleteOrder(AppState s, string number)
    {
        var o = s.EquipmentOrders.FirstOrDefault(x => x.Number == number)
                ?? throw new InvalidOperationException("No such equipment order.");
        if (o.Status != "Open") throw new InvalidOperationException($"{o.Number} is already {o.Status.ToLowerInvariant()}.");

        var messages = new List<string>();

        if (!string.IsNullOrWhiteSpace(o.ToTruckUnit))
        {
            var newTruck = s.Trucks.FirstOrDefault(t => t.Unit == o.ToTruckUnit)
                           ?? throw new InvalidOperationException($"Unit {o.ToTruckUnit} is no longer in the fleet.");
            var old = s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit);

            // Where the exchange physically happened — the order's yard, or wherever the driver is.
            var swapYard = Migrations.TerminalOf(s, o.TerminalId)
                           ?? Migrations.TerminalOf(s, newTruck.HomeTerminalId);
            var homeYard = Migrations.TerminalOf(s, s.Driver.HomeTerminalId)
                           ?? s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);

            if (old != null)
            {
                old.AssignedDriver = "";
                // The truck you hand in stays where you left it. It does not teleport home.
                if (swapYard != null && old.HomeTerminalId != swapYard.Id)
                {
                    old.HomeTerminalId = swapYard.Id;
                    messages.Add($"Unit {old.Ref} is now based at {swapYard.City}, {swapYard.State} — you left it there.");
                }
            }

            newTruck.AssignedDriver = s.Driver.Name;
            newTruck.InGameGarage = true;
            // The truck you take on re-domiciles to your home yard, because you will be running it
            // out of there. A 1-for-1 exchange keeps both yards at the same headcount.
            if (homeYard != null && newTruck.HomeTerminalId != homeYard.Id)
            {
                newTruck.HomeTerminalId = homeYard.Id;
                messages.Add($"Unit {newTruck.Ref} re-domiciled to {homeYard.City}, {homeYard.State}.");
            }

            s.Driver.AssignedTruckUnit = newTruck.Unit;
            // Moving into it counts as getting it, whatever the unit's own history. This is what stops a
            // run of end-of-life trucks handing the player a new tractor every fortnight.
            newTruck.AcquiredGameTime = s.Status.GameTime;
            s.Settings.GovernedMph = newTruck.GovernedMph;
            s.Status.TruckDamagePct = newTruck.DamagePct;
            s.Status.AtsOdometer = newTruck.AtsOdometer;
            messages.Insert(0, $"Now on unit {newTruck.Ref} ({newTruck.Year} {newTruck.Make} {newTruck.Model}).");
        }

        if (o.Kind == "TrailerSwap")
        {
            // You cannot hook a trailer that is still three states away under another driver.
            var ready = GameClock.TryParse(o.AvailableFromGameTime);
            var now = GameClock.TryParse(s.Status.GameTime);
            if (ready != null && now != null && now.Value < ready.Value)
                throw new InvalidOperationException(
                    string.IsNullOrWhiteSpace(o.HeldByDriverName)
                        ? $"Trailer {o.ToTrailerUnit} is not available until {GameClock.Pretty(ready.Value)}."
                        : $"{o.HeldByDriverName} still has trailer {o.ToTrailerUnit} — due back around " +
                          $"{GameClock.Pretty(ready.Value)}. Report the game clock when they are in and close this then.");

            if (o.MustPurchase && string.IsNullOrWhiteSpace(o.ToTrailerUnit))
            {
                // The player bought one and added it on the Fleet tab; find it and hook that.
                var bought = s.Trailers.FirstOrDefault(t => t.Status == "InService"
                                                            && string.IsNullOrWhiteSpace(t.AssignedTruckUnit)
                                                            && t.Unit != s.Driver.AssignedTrailerUnit);
                if (bought == null)
                    throw new InvalidOperationException(
                        "No new trailer on the books yet. Buy it in ATS, add it on the Fleet tab, then close this order.");
                o.ToTrailerUnit = bought.Unit;
            }
        }

        if (!string.IsNullOrWhiteSpace(o.ToTrailerUnit))
            messages.Add(SwapTrailer(s, o.ToTrailerUnit, force: true));

        o.Status = "Completed";
        o.CompletedGameTime = s.Status.GameTime;
        return string.Join(" ", messages);
    }

    public static string DeclineOrder(AppState s, string number, string why)
    {
        var o = s.EquipmentOrders.FirstOrDefault(x => x.Number == number)
                ?? throw new InvalidOperationException("No such equipment order.");
        o.Status = "Declined";
        o.Notes = why;
        return o.Kind == "Downgrade"
            ? $"{o.Number} declined. Refusing a downgrade is a separate conversation with Safety."
            : $"{o.Number} declined — you are staying on {o.FromTruckUnit}.";
    }

    /// <summary>
    /// Whether a driver who was downgraded has now run the clean loads asked of them. Called after
    /// each delivery so the offer comes to them rather than needing to be asked for.
    /// </summary>
    public static EquipmentOrder? CheckDowngradeRestoration(AppState s)
    {
        var downgrade = s.EquipmentOrders
            .FirstOrDefault(o => o.Kind == "Downgrade" && o.Status == "Completed" && o.RestoreAfterLoads > 0);
        if (downgrade == null) return null;

        // Already made good on it?
        if (s.EquipmentOrders.Any(o => o.Kind == "Upgrade" && o.Status != "Declined"
                                       && string.CompareOrdinal(o.CreatedUtc, downgrade.CreatedUtc) > 0))
            return null;

        var loadsSince = s.Trips.Count(t => t.Status == "Delivered" && t.Kind == "Freight") - downgrade.LoadCountAtIssue;
        if (loadsSince < downgrade.RestoreAfterLoads) return null;

        // Clean means clean — a fresh driver-fault incident resets the clock.
        var faultsSince = s.Incidents.Count(i => i.FaultAttribution == "Driver" && i.Preventable
            && string.CompareOrdinal(i.CreatedUtc, downgrade.CreatedUtc) > 0);
        if (faultsSince > 0) return null;

        return IssueUpgrade(s,
            $"{loadsSince} clean loads since {downgrade.Number}. Earned the better truck back.");
    }

    /// <summary>
    /// How likely operations is to put this driver in a better tractor.
    ///
    /// Seniority is what buys the pick of the fleet, so rank sets the odds and a clean file is the price
    /// of entry. It is not a certainty at any rung: a company that moved every driver into every better
    /// truck the moment one came free would have no ladder left to climb.
    ///
    /// Zero means never — not a low chance, an outright no.
    /// </summary>
    public static int UpgradeChancePct(AppState s)
    {
        if (s.Driver.Probation.Active || s.Driver.Rank == "probationary") return 0;
        if (SafetyService.CountingFaults(s).Count > 0) return 0;

        return s.Driver.Rank switch
        {
            "company" => 45,
            "senior" => 70,
            "lead" => 85,
            "lease" => 95,      // Specialist Driver
            "owner" => 95,      // Master Driver
            _ => 0
        };
    }

    /// <summary>
    /// Settles whether the move happens. Seeded on the driver and the unit, so it is the same answer
    /// however many times the page is reloaded — and a different answer for the next truck.
    /// </summary>
    public static bool UpgradeGranted(AppState s, string unit)
    {
        var chance = UpgradeChancePct(s);
        if (chance <= 0) return false;
        return Hash($"{s.Driver.EmployeeId}|upgrade|{unit}") % 100 < (uint)chance;
    }

    /// <summary>
    /// A seat has been vacated. Decide whether the driver is moved into it.
    ///
    /// A carrier with a good tractor standing empty and a proven driver in an older one moves the driver;
    /// that is what seniority is for. The app used to leave the truck on the Fleet tab as one of four
    /// things the player might do, next to a note suggesting they go and hire somebody for it — which is
    /// the company asking the driver to fill a seat it should have given them.
    ///
    /// Returns the order raised, or null when nothing came of it.
    /// </summary>
    public static EquipmentOrder? ConsiderSeatVacated(AppState s, string freedUnit)
    {
        if (string.IsNullOrWhiteSpace(freedUnit)) return null;
        if (OpenOrder(s) != null) return null;                   // one equipment order at a time

        var freed = s.Trucks.FirstOrDefault(t => t.Unit.Equals(freedUnit, StringComparison.OrdinalIgnoreCase));
        if (freed == null || freed.Retired || freed.Status != "InService") return null;
        if (freed.CabConfig != "Sleeper") return null;           // not a truck to live in

        var mine = DispatchEngine.AssignedTruck(s);
        if (mine == null || freed.Unit.Equals(mine.Unit, StringComparison.OrdinalIgnoreCase)) return null;

        // Worth moving for, on the same test the Fleet tab already used to call it an upgrade.
        var better = freed.Year > mine.Year || freed.ServiceMiles < mine.ServiceMiles * 0.6;
        if (!better) return null;

        if (!UpgradeGranted(s, freed.Unit)) return null;

        var yard = Migrations.TerminalOf(s, freed.HomeTerminalId);
        var label = yard != null ? DispatchEngine.Place(yard.City, yard.State) : "the yard it is standing at";

        return Issue(s, new EquipmentOrder
        {
            Kind = "Upgrade",
            Reason = $"{freed.Ref} came free and you have the seniority for it.",
            FromTruckUnit = mine.Unit,
            ToTruckUnit = freed.Unit,
            TerminalId = yard?.Id ?? "",
            TerminalLabel = label,
            AvailableFromGameTime = s.Status.GameTime,
            Instruction = $"{freed.Ref} — a {freed.Year} {freed.Make} {freed.Model} with {freed.ServiceMiles:N0} mi — " +
                          $"is standing at {label} with nobody in it. It is yours: do not hire for that seat. " +
                          "No rush and no empty running — I will work freight back that way, and you swap over " +
                          $"when you get in. Move your gear across from {mine.Ref} and mark this order complete.",
            Notes = $"Seat vacated; {s.Driver.RankTitle} moved up from {mine.Ref}."
        });
    }

    /// <summary>
    /// Weighs a load by whether it carries the driver toward equipment the company has ordered them onto.
    ///
    /// A seat can come free while the driver is four days out, and telling them to report to a yard on the
    /// other side of the country without ever routing them there is not dispatching, it is a note. So the
    /// board leans that way for as long as the order stands, exactly as it does when home time is due —
    /// they get there with freight on rather than running empty for a truck.
    /// </summary>
    public static (double Points, string? Detail, string? Pro, string? Con) ScoreLoad(AppState s, BoardLoad load)
    {
        var order = OpenOrder(s);
        if (order == null || string.IsNullOrWhiteSpace(order.TerminalLabel)) return (0, null, null, null);
        if (string.IsNullOrWhiteSpace(order.ToTruckUnit) && string.IsNullOrWhiteSpace(order.ToTrailerUnit))
            return (0, null, null, null);

        var yard = Migrations.TerminalOf(s, order.TerminalId);
        if (yard == null) return (0, null, null, null);

        var here = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, yard.City, yard.State);
        var dest = Geo.MilesBetween(load.DestCity, load.DestState, yard.City, yard.State);
        if (here == null || dest == null) return (0, null, null, null);

        var closer = here.Value - dest.Value;
        var label = DispatchEngine.Place(yard.City, yard.State);

        // Same shape as the home-time bias: worth something, never worth more than the freight itself.
        var pts = Math.Clamp(closer / 500.0, -1.0, 1.0) * EquipmentPullWeight;

        if (dest.Value <= 50)
            return (pts, $"Finishes at {label}, where {order.Number} is waiting: {pts:+0.00;-0.00}",
                $"Puts you at {label} for {order.Number} — pick the unit up when you drop.", null);

        if (closer > 50)
            return (pts, $"{closer:N0} mi closer to {label} for {order.Number}: {pts:+0.00;-0.00}",
                $"Works you toward {label}, where {order.Number} is standing.", null);

        if (closer < -50)
            return (pts, $"{-closer:N0} mi further from {label} for {order.Number}: {pts:+0.00;-0.00}", null,
                $"Takes you {-closer:N0} mi further from {label}, and {order.Number} is waiting there.");

        return (0, null, null, null);
    }

    /// <summary>
    /// How hard the board leans toward an ordered unit. Deliberately below the home-time pull — a truck
    /// waiting is worth routing for, but it is not worth running bad freight over.
    /// </summary>
    private const double EquipmentPullWeight = 0.5;

    /// <summary>FNV-1a, so a decision is stable and cannot be re-rolled by reloading the page.</summary>
    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }

    /// <summary>Yards that can actually do shop work, nearest-in-state first.</summary>
    public static List<Terminal> ShopOptions(AppState s) =>
        s.Company.Terminals
            .Where(t => t.HasShop)
            .OrderBy(t => t.State.Equals(s.Status.LocationState, StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenByDescending(t => t.ShopLabourDiscount)
            .ToList();

    /// <summary>
    /// Whether the assigned tractor is due a preventive service, and where it could be done in
    /// house. PM in our own shop is cheaper than a roadside vendor, so it is worth routing for.
    /// </summary>
    public static PmAdvice PmCheck(AppState s)
    {
        var advice = new PmAdvice();
        var truck = DispatchEngine.AssignedTruck(s);
        if (truck == null) return advice;

        var since = truck.ServiceMiles - truck.LastServiceMiles;
        advice.MilesSinceService = since;
        advice.IntervalMiles = truck.ServiceIntervalMiles;
        advice.MilesRemaining = truck.ServiceIntervalMiles - since;
        advice.Due = since >= truck.ServiceIntervalMiles;
        advice.Soon = !advice.Due && since >= truck.ServiceIntervalMiles * 0.9;

        if (!advice.Due && !advice.Soon) return advice;

        var shops = ShopOptions(s);
        advice.ShopYards = shops.Select(t => $"{t.City}, {t.State} ({t.ShopLabourDiscount * 100:0}% off labour)").ToList();
        advice.Message = advice.Due
            ? $"Unit {truck.Ref} is {since - truck.ServiceIntervalMiles:N0} mi past its {truck.ServiceIntervalMiles:N0}-mile PM."
            : $"Unit {truck.Ref} is due a PM in {advice.MilesRemaining:N0} mi.";
        if (shops.Count > 0)
            advice.Message += $" Our own shops: {string.Join("; ", advice.ShopYards)}.";
        else
            advice.Message += " No company yard has a shop — you will be paying a vendor.";
        return advice;
    }
}

public class PmAdvice
{
    public bool Due { get; set; }
    public bool Soon { get; set; }
    public double MilesSinceService { get; set; }
    public double IntervalMiles { get; set; }
    public double MilesRemaining { get; set; }
    public string Message { get; set; } = "";
    public List<string> ShopYards { get; set; } = new();
}
