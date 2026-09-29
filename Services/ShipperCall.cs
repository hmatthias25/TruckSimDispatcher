using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What happens when the truck pulls onto the SHIPPER's property. The other end of
/// <see cref="ReceiverCall"/>, and said the same way: set the game clock, then do the work.
///
/// <para>ATS loads you the second you back up to the dock. Real shippers do not: the freight is still
/// being picked, the mill is running behind, the loader is down, the gate does not go up until six. None
/// of that was on the clock before this, so every pickup was a pickup with no wait — and a wait at the
/// shipper is the one the delivery window has to absorb, because the window was already running.</para>
///
/// <para>Reported from play: "Since we don't have an appointment time for pickups (and I don't want
/// that) and just a range on when we can pick up, the player just needs to report when they are at the
/// shipper ready to pick up the load." So there is no slot here and nothing to be early or late FOR.
/// The range is the shipper's working day: a dock never closes, a site keeps the hours
/// <see cref="FacilityProfile.SeededHours"/> gives it, exactly as it does at the receiver.</para>
///
/// <para><b>Picking up where you just dropped</b> is not reported at all. You are already standing on
/// their property, so the arrival is the moment the unload finished — see <see cref="AutoArrive"/>.</para>
///
/// <para><b>Rolled once, at arrival</b>, seeded on the trip and the hour, for the same reason the
/// receiver's is: refreshing the page must not shop for freight that is ready.</para>
/// </summary>
public static class ShipperCall
{
    /// <summary>
    /// The answer, plus the one thing the receiver's call has no need of: the moment the shipper's clock
    /// starts. That is the arrival, except at a site you reached before it opened — nobody is keeping you
    /// waiting at a gate with nobody behind it, so those hours are not theirs to pay for.
    /// </summary>
    public class Call : ReceiverCall.Call
    {
        public string ClockFromGameTime { get; set; } = "";
        /// <summary>True where the arrival was not reported but taken off the drop you just made there.</summary>
        public bool Auto { get; set; }
    }

    /// <summary>
    /// Work out the call for a truck arriving at the shipper. Always answers — even "straight in" is worth
    /// saying at a pickup, because the driver is about to set the clock off it.
    /// </summary>
    public static Call? Assess(AppState s, Trip trip, DateTime arrived, bool auto = false)
    {
        if (trip.Kind != "Freight") return null;

        var isSite = FacilityProfile.KindOf(FacilityProfile.FreightTypeOf(trip)) == FacilityProfile.Kind.Site;
        var hook = DropHook.Is(trip.TrailerType);
        var who = string.IsNullOrWhiteSpace(trip.Shipper) ? "The shipper" : trip.Shipper.Trim();
        var seed = $"{s.Driver.EmployeeId}|pickup|{trip.Id}|{arrived:yyyy-MM-ddTHH}";

        var reasons = new List<string>();
        var clockFrom = arrived;
        var wait = 0.0;
        var ahead = 0;
        var kind = "StraightIn";

        // THE RANGE. A site keeps a working day and is shut outside it; a dock ships around the clock.
        if (isSite)
        {
            var hours = FacilityProfile.SeededHours(s, trip.OriginCity, trip.OriginState, trip.Shipper);
            var peak = FacilityProfile.QueuePeakHours(s, trip.OriginCity, trip.OriginState, trip.Shipper);
            var tod = arrived.TimeOfDay.TotalHours;
            var open = tod >= hours.OpenHour && tod < hours.CloseHour;

            if (!open)
            {
                var untilOpen = (hours.OpenHour - tod + 24) % 24;
                // At the gate early buys the front of the line, same as it does at a receiver's.
                var earned = Math.Clamp(untilOpen / ReceiverCall.EarlyEnoughHours, 0, 1);
                ahead = (int)Math.Round(peak / ReceiverCall.HoursPerTruckAhead * (1 - earned));
                wait = untilOpen + ahead * ReceiverCall.HoursPerTruckAhead;
                clockFrom = arrived.AddHours(untilOpen);
                kind = "Closed";
                reasons.Add($"{who} {(tod >= hours.CloseHour ? "shut" : "do not open until")} " +
                            $"{Clock(tod >= hours.CloseHour ? hours.CloseHour : hours.OpenHour)}" +
                            (tod >= hours.CloseHour ? $" and open again at {Clock(hours.OpenHour)}" : "") +
                            $", so you are {Hhmm.Of(untilOpen)} ahead of them" +
                            (ahead > 0 ? $", with {ahead} in front of you when the gate goes up." : " and first through the gate."));
            }
            else
            {
                ahead = (int)Math.Round(FacilityProfile.QueueAt(peak, tod - hours.OpenHour) / ReceiverCall.HoursPerTruckAhead);
                if (ahead > 0)
                {
                    wait = ahead * ReceiverCall.HoursPerTruckAhead;
                    kind = "Queued";
                    reasons.Add($"They are open, with {ahead} in front of you to load.");
                }
            }
        }

        // THE FREIGHT. Deliberately uncommon — a hold-up that happens most visits is the schedule, not a
        // hold-up — and one roll, so the two do not stack into a four-hour wait on every other load.
        var roll = Hash(seed) % 100;
        if (roll < 18)
        {
            var late = 0.5 + (Hash(seed + "|notready") % 11) * 0.25;         // half an hour to three
            wait += late;
            if (kind != "Closed") kind = "NotReady";
            reasons.Add((Hash(seed + "|why") % 4) switch
            {
                0 when hook => $"The trailer is not ready — they are still loading it. Another {Hhmm.Of(late)}.",
                0 => $"The load is not ready — they are still picking it. Another {Hhmm.Of(late)}.",
                1 when trip.TrailerType is "Reefer" or "Refrigerated" =>
                    $"It is still coming down to temperature in the cooler. They say {Hhmm.Of(late)}.",
                1 => $"Production is running late on it. They say {Hhmm.Of(late)}.",
                2 => $"The paperwork is not done and nothing leaves without it. {Hhmm.Of(late)}.",
                _ => $"It has not come off the line yet. {Hhmm.Of(late)} before it is ready to go on.",
            });
        }
        else if (roll < 33)
        {
            var behind = 0.25 + (Hash(seed + "|behind") % 8) * 0.25;         // fifteen minutes to two
            wait += behind;
            if (kind == "StraightIn") kind = "BackedUp";
            reasons.Add(isSite
                ? (Hash(seed + "|site") % 2 == 0
                    ? $"Their loader is down and the fitter is on his way — {Hhmm.Of(behind)} before anything moves."
                    : $"They are one operator short on the yard, so {Hhmm.Of(behind)} longer than it should be.")
                : (Hash(seed + "|dock") % 2 == 0
                    ? $"They are running behind and the doors are full — {Hhmm.Of(behind)} for one to come free."
                    : $"Short-staffed on this shift. {Hhmm.Of(behind)} before anybody gets to you."));
        }

        var starts = arrived.AddHours(wait);
        var call = new Call
        {
            Kind = kind,
            ArrivedGameTime = GameClock.Format(arrived),
            WorkStartsGameTime = GameClock.Format(starts),
            ClockFromGameTime = GameClock.Format(clockFrom),
            WaitHours = Math.Round(wait, 2),
            Position = ahead + 1,
            Ahead = ahead,
            Auto = auto,
        };

        var act = hook ? "hook the trailer" : "log Begin load";
        var here = auto ? "You are still on their property from the drop. " : "";

        if (wait < 0.01)
        {
            call.Headline = hook ? "The trailer is ready — hook it" : "The load is ready — straight onto a door";
            call.Instruction = here + (hook
                ? "Nothing to wait for. Hook it and go."
                : "Nothing to wait for. Log Begin load now and get it on.");
            return call;
        }

        call.Headline = kind switch
        {
            "Closed" => $"They are shut — {(hook ? "hook" : "load")} at {GameClock.Pretty(starts)}",
            "NotReady" => $"Not ready yet — {(hook ? "hook" : "load")} at {GameClock.Pretty(starts)}",
            _ => $"You wait — {(hook ? "hook" : "load")} at {GameClock.Pretty(starts)}",
        };
        var billed = (starts - clockFrom).TotalHours;
        call.Instruction = here + string.Join(" ", reasons) + " " +
            $"Set the game clock to {GameClock.Pretty(starts)} and {act} then, so the {Hhmm.Of(wait)} lands " +
            "on your clocks where it actually went. " +
            (billed > 0.01
                ? $"{(clockFrom > arrived ? $"From their opening at {GameClock.Pretty(clockFrom)} that" : "That")} " +
                  $"is waiting on their property, and it counts toward detention with the {(hook ? "hook" : "loading")}."
                : "None of it is theirs to pay for — they were not open.");
        return call;
    }

    /// <summary>
    /// Record a call on the trip. One place, so the reported arrival and the automatic one cannot drift.
    /// </summary>
    public static void Record(Trip trip, Call call)
    {
        trip.ShipperArrivedGameTime = call.ArrivedGameTime;
        trip.ShipperCallKind = call.Kind;
        trip.LoadStartsGameTime = call.WorkStartsGameTime;
        trip.ShipperClockFromGameTime = call.ClockFromGameTime;
        trip.ShipperCallNote = call.Instruction;
        trip.ShipperArrivalAuto = call.Auto;
    }

    /// <summary>
    /// A load picked up at the place the last one was dropped needs no arrival: the truck never left.
    ///
    /// <para>Same place means the same city AND the same company — or a load the driver took off the
    /// "from this location" list, which ATS only offers at the facility you are standing on. The arrival
    /// is when the unload finished, because that is when the truck became free to be loaded.</para>
    ///
    /// <para>Returns null, and changes nothing, when it is not the same place. Then the driver reports.</para>
    /// </summary>
    public static Call? AutoArrive(AppState s, Trip trip, bool atLocation)
    {
        if (trip.Kind != "Freight" || !string.IsNullOrWhiteSpace(trip.ShipperArrivedGameTime)) return null;

        var last = s.Trips
            .Where(t => t.Id != trip.Id && t.Kind == "Freight" && t.Status == "Delivered")
            .OrderByDescending(t => GameClock.TryParse(t.DeliveredGameTime) ?? DateTime.MinValue)
            .FirstOrDefault();
        if (last == null) return null;

        static string N(string? v) => (v ?? "").Trim().ToLowerInvariant();
        var sameCity = N(last.DestCity) == N(trip.OriginCity) && N(last.DestState) == N(trip.OriginState);
        var sameCompany = N(last.Receiver) != "" && N(last.Receiver) == N(trip.Shipper);
        if (!sameCity || !(sameCompany || atLocation)) return null;

        var free = UnloadFinished(last);
        if (free == null) return null;

        var call = Assess(s, trip, free.Value, auto: true);
        if (call != null) Record(trip, call);
        return call;
    }

    /// <summary>
    /// When the last trip's unload was done, in order of how much each source actually knows: the logged
    /// End unload, then the unload length laid onto when the receiver started on them.
    /// </summary>
    public static DateTime? UnloadFinished(Trip t)
    {
        var ended = t.Events.Where(e => e.Kind == "EndUnload")
            .Select(e => GameClock.TryParse(e.GameTime)).Where(d => d != null).Max();
        if (ended != null) return ended;

        var began = t.Events.Where(e => e.Kind == "BeginUnload")
                        .Select(e => GameClock.TryParse(e.GameTime)).Where(d => d != null).Min()
                    ?? GameClock.TryParse(t.WorkStartsGameTime)
                    ?? GameClock.TryParse(t.ArrivedGameTime)
                    ?? GameClock.TryParse(t.DeliveredGameTime);
        return began?.AddHours(Math.Max(0, t.UnloadingHours));
    }

    private static string Clock(double hour) =>
        $"{(int)hour:00}:{(int)Math.Round((hour - (int)hour) * 60):00}";

    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }
}
