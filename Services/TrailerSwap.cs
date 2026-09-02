using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Re-rigging a driver at a yard they are passing, rather than only at home time.
///
/// A carrier with garages across the map moves equipment where the freight is. This one only ever
/// changed a driver's trailer when they came home, so a yard eighty miles away holding exactly the box
/// the next month's freight wants was never used.
///
/// It is decided <b>at load close-out</b>: the one moment the app knows where the driver is standing
/// with nothing hooked to them, and the moment the instruction can actually be acted on.
///
/// <b>What the app cannot see.</b> It does not know whether an AI driver still has that trailer — they
/// swap constantly and nothing reports it. So the order names the box and the driver tells us what they
/// found. If it is gone, they say how long until it is back, and that turns an unknown into a decision
/// worth making: given the wait and what is left on their cycle, either sit it out or take the 34 now
/// and be legal when the box lands. A wait that overlaps a restart they needed anyway costs nothing.
/// </summary>
public static class TrailerSwap
{
    /// <summary>Furthest a driver is sent for a box. Beyond this it is a trip, not a detour.</summary>
    public const double MaxDetourMiles = 150;

    /// <summary>Cycle hours at or under which a restart is close enough to be worth pairing with a wait.</summary>
    public const double RestartCloseHours = 14;

    /// <summary>Base odds at close-out. Deliberately occasional — a re-rig every delivery is a treadmill.</summary>
    public const int BaseChancePct = 12;

    /// <summary>Odds when the driver is also near needing a restart, where waiting is nearly free.</summary>
    public const int NearRestartChancePct = 34;

    /// <summary>
    /// Boxes at a yard the driver could actually be put on.
    ///
    /// Three things have to hold, and each of them is a fact the app has rather than a guess:
    /// the yard is real in the driver's game, the trailer has been bought in it, and the driver holds
    /// the hazmat class that trailer's contents need.
    /// </summary>
    public static List<(Terminal Yard, Trailer Box, double Miles)> Candidates(AppState s)
    {
        var found = new List<(Terminal, Trailer, double)>();
        var mine = DispatchEngine.AssignedTrailer(s);

        foreach (var yard in s.Company.Terminals)
        {
            // A garage the player has not bought holds nothing. Sending them to one is sending them
            // to an empty patch of map.
            if (!Migrations.Populated(s, yard.Id)) continue;

            var miles = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, yard.City, yard.State);
            if (miles is not { } m || m > MaxDetourMiles) continue;

            foreach (var box in s.Trailers)
            {
                if (box.Retired || DropHook.Is(box.Type)) continue;
                if (!box.InGameGarage) continue;                       // backdrop: nothing to hook
                if (box.HomeTerminalId != yard.Id) continue;
                if (mine != null && box.Unit.Equals(mine.Unit, StringComparison.OrdinalIgnoreCase)) continue;
                if (mine != null && box.Type.Equals(mine.Type, StringComparison.OrdinalIgnoreCase)
                    && (box.Subtype ?? "").Equals(mine.Subtype ?? "", StringComparison.OrdinalIgnoreCase))
                    continue;                                          // same box in a different colour

                // A hired driver's box is theirs. Taking it would leave somebody bobtailing to solve a
                // problem nobody had.
                if (s.HiredDrivers.Any(d => d.Status == "Active"
                        && d.AssignedTrailerUnit.Equals(box.Unit, StringComparison.OrdinalIgnoreCase)))
                    continue;

                if (!Qualified(s, box)) continue;

                found.Add((yard, box, m));
            }
        }

        return found.OrderBy(x => x.Item3).ToList();
    }

    /// <summary>
    /// Whether the driver may legally pull what this box carries.
    ///
    /// ATS gates dangerous freight on hazmat CLASSES, not on a "tanker endorsement" — there is no such
    /// thing. A fuel tanker is class 3, a gas tanker class 2, a chemical tanker class 8; food-grade and
    /// dry bulk need nothing at all. <see cref="Endorsements.ClassForTanker"/> is the authority.
    /// </summary>
    public static bool Qualified(AppState s, Trailer box)
    {
        var needed = TrailerSpec.IsTanker(box.Type) ? Endorsements.ClassForTanker(box.Subtype) : "";
        if (!string.IsNullOrWhiteSpace(needed) && !Endorsements.Has(s, needed)) return false;

        // And what they said they would not haul is still what they will not haul.
        var app = s.Application;
        if (app != null && app.WillNotHaul.Any(w => !string.IsNullOrWhiteSpace(w)
                && box.Type.Contains(w, StringComparison.OrdinalIgnoreCase))) return false;

        return !s.Driver.Restrictions.Any(r => r.Equals(box.Type, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>How close the driver is to needing a 34, which is what makes a wait cheap.</summary>
    public static bool NearRestart(AppState s) => s.Hos.CycleRemaining <= RestartCloseHours;

    /// <summary>
    /// Decides a re-rig at close-out, or returns null.
    ///
    /// Seeded on the trip, so re-reading the audit cannot re-roll it.
    /// </summary>
    public static TrailerSwapOrder? Consider(AppState s, Trip trip)
    {
        if (Open(s) != null) return null;                    // one at a time
        if (Probation.IsOn(s)) return null;                  // not while being assessed
        if (Dedicated.Active(s)) return null;                // the account decides the trailer
        if (s.Driver.TrailerByRequest) return null;          // they asked for what they are on

        var options = Candidates(s);
        if (options.Count == 0) return null;

        var near = NearRestart(s);
        var odds = near ? NearRestartChancePct : BaseChancePct;
        if (Hash($"{trip.Number}|rerig") % 100 >= (uint)odds) return null;

        var (yard, box, miles) = options[(int)(Hash($"{trip.Number}|rerig-pick") % (uint)options.Count)];
        var mine = DispatchEngine.AssignedTrailer(s);
        var label = DispatchEngine.Place(yard.City, yard.State);
        var what = TrailerSpec.Describe(box.Type, box.Subtype);

        var order = new TrailerSwapOrder
        {
            Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-RR-{s.TrailerSwaps.Count + 1:0000}",
            TerminalId = yard.Id,
            TerminalLabel = label,
            TakeUnit = box.Unit,
            TakeDescription = what,
            DropUnit = mine?.Unit ?? "",
            Miles = Math.Round(miles, 0),
            NearRestart = near,
            RaisedGameTime = s.Status.GameTime,
            AfterTrip = trip.Number,
            Status = "Open",
        };

        order.Instruction =
            $"Take {mine?.Ref ?? "what you are on"} to the {label} yard — {miles:N0} mi — drop it there and " +
            $"hook {box.Ref}, {what}. " +
            (near
                ? $"You are down to {s.Hos.CycleRemaining:0.#} hours of cycle, so take your 34 there while you are at it."
                : "Then report what you found.");

        order.Bookkeeping =
            $"Once it is done: {mine?.Ref ?? "the box you dropped"} is based at {label} from now on, and " +
            $"{box.Ref} comes onto your home yard's book. Square both on the Equipment tab.";

        s.TrailerSwaps.Insert(0, order);
        return order;
    }

    /// <summary>The re-rig standing against this driver, or null.</summary>
    public static TrailerSwapOrder? Open(AppState s) =>
        s.TrailerSwaps.FirstOrDefault(o => o.Status == "Open" || o.Status == "Waiting");

    /// <summary>
    /// The driver got there and the box was gone, and says when it is back.
    ///
    /// The wait is the decision. Against what is left on the cycle it is either dead time or a restart
    /// they were going to need anyway, and the app can say which — that is the whole reason for asking
    /// how long rather than just cancelling.
    /// </summary>
    public static TrailerSwapOrder ReportMissing(AppState s, double hoursUntilBack, string note)
    {
        var order = Open(s) ?? throw new InvalidOperationException("No re-rig is standing.");

        order.Status = "Waiting";
        order.HoursUntilBack = Math.Max(0, hoursUntilBack);
        order.MissingNote = note ?? "";

        var cycle = s.Hos.CycleRemaining;
        var restart = s.Settings.Hos.CycleRestartHours;

        order.WaitAdvice = hoursUntilBack >= restart
            ? $"{hoursUntilBack:0.#} hours is longer than a {restart:0} anyway — take the restart here. " +
              "You come out of it legal and the box is back before you are."
            : NearRestart(s)
                ? $"{hoursUntilBack:0.#} hours to wait and {cycle:0.#} on the cycle. Take the 34 now: the wait is " +
                  "inside it and you would have needed it within the day regardless."
                : $"{hoursUntilBack:0.#} hours to wait with {cycle:0.#} hours of cycle still on you. Sit it out — " +
                  "burning a 34 on a short wait costs you more than the wait does.";

        return order;
    }

    /// <summary>Done: the box changed hands and the books follow it.</summary>
    public static TrailerSwapOrder Complete(AppState s, string number)
    {
        var order = s.TrailerSwaps.FirstOrDefault(o => o.Number == number || o.Id == number)
                    ?? throw new InvalidOperationException("No such re-rig.");

        var yard = s.Company.Terminals.FirstOrDefault(y => y.Id == order.TerminalId);
        var home = HomeTime.HomeTerminal(s);

        // The box dropped now lives at the yard it was dropped at; the one taken comes onto the home
        // yard's book. Both are facts about where the equipment IS, which is what the books are for.
        if (s.Trailers.FirstOrDefault(t => t.Unit.Equals(order.DropUnit, StringComparison.OrdinalIgnoreCase)) is { } dropped
            && yard != null)
        {
            dropped.HomeTerminalId = yard.Id;
            dropped.CurrentLocation = $"{yard.City}, {yard.State}";
            dropped.Whereabouts = "At a company yard";
            dropped.WhereaboutsCity = yard.City;
            dropped.WhereaboutsState = yard.State;
            dropped.WhereaboutsGameTime = s.Status.GameTime;
        }

        if (s.Trailers.FirstOrDefault(t => t.Unit.Equals(order.TakeUnit, StringComparison.OrdinalIgnoreCase)) is { } taken)
        {
            if (home != null)
            {
                taken.HomeTerminalId = home.Id;
                taken.CurrentLocation = $"{s.Status.LocationCity}, {s.Status.LocationState}";
            }
            taken.Whereabouts = "Under me";
            taken.WhereaboutsCity = s.Status.LocationCity;
            taken.WhereaboutsState = s.Status.LocationState;
            taken.WhereaboutsGameTime = s.Status.GameTime;
            s.Driver.AssignedTrailerUnit = taken.Unit;
            s.Driver.HomeTimesOnTrailer = 0;
        }

        order.Status = "Done";
        order.ResolvedGameTime = s.Status.GameTime;
        return order;
    }

    /// <summary>Called off — the box is gone for good, or operations changed its mind.</summary>
    public static TrailerSwapOrder Cancel(AppState s, string number, string why)
    {
        var order = s.TrailerSwaps.FirstOrDefault(o => o.Number == number || o.Id == number)
                    ?? throw new InvalidOperationException("No such re-rig.");
        order.Status = "Cancelled";
        order.MissingNote = string.IsNullOrWhiteSpace(why) ? order.MissingNote : why;
        order.ResolvedGameTime = s.Status.GameTime;
        return order;
    }

    /// <summary>
    /// Why no freight is going out. The app cannot plan a load around a trailer whose whereabouts it is
    /// halfway through changing — which box is under the truck is the input to every routing decision.
    /// </summary>
    public static string? DispatchBlocker(AppState s)
    {
        var order = Open(s);
        if (order == null) return null;
        return order.Status == "Waiting"
            ? $"{order.Number}: waiting on {order.TakeUnit} at {order.TerminalLabel}. {order.WaitAdvice} " +
              "Nothing goes out until you are on a box."
            : $"{order.Number}: {order.Instruction} Nothing goes out until that is done — I cannot plan " +
              "freight around a trailer that is halfway between two yards.";
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }
}
