using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Empty miles between one load and the next.
///
/// Getting from the last receiver — or the truck stop you slept at — to where the next job starts is
/// real running on the driver's own time, and in a big ATS city it can be forty miles. None of it was
/// being paid. <see cref="BoardLoad.DeadheadMiles"/> only covers the deadhead the job listing quotes,
/// which is the leg to the shipper <i>after</i> dispatch; nothing covered the leg before it.
///
/// Nothing here is estimated. The odometer is recorded at close-out and again when the next load is
/// authorized, so the empty miles are the difference between two numbers the driver read off the game.
/// Where that difference cannot be trusted — it went backwards, or it is wildly too large — it pays
/// nothing and says so, because a bad reading is a bad reading and not a windfall.
/// </summary>
public static class Repositioning
{
    /// <summary>
    /// Beyond this, a delta is a mistyped odometer rather than a repositioning run. Nobody deadheads
    /// a thousand miles between loads without it being a dispatched empty move in its own right.
    /// </summary>
    private const double ImplausibleMiles = 1_000;

    public class Leg
    {
        public double Miles { get; set; }
        public double FromOdometer { get; set; }
        public double ToOdometer { get; set; }
        /// <summary>The load that closed before this empty running.</summary>
        public string AfterTrip { get; set; } = "";
        public string Explanation { get; set; } = "";
        /// <summary>Set when the readings cannot be trusted. Pays nothing.</summary>
        public string Warning { get; set; } = "";
    }

    /// <summary>
    /// Works out the empty leg that ended when this load was dispatched.
    ///
    /// Measured from the last odometer we were given — the previous close-out — to the reading at
    /// dispatch. Returns null when there is nothing to measure, which is the normal case for a first
    /// load or a driver who was already sitting at the shipper.
    /// </summary>
    /// <summary>
    /// Whether empty miles are about to be lost for want of an odometer reading — asked BEFORE anything
    /// is booked.
    ///
    /// <see cref="Measure"/> runs when a load is authorised and never again, so a warning on the trip
    /// afterwards tells the driver to do something that can no longer help: the load is dispatched, the
    /// figure is fixed, and reporting the reading then changes nothing. This is the same check, put where
    /// it can still be acted on.
    /// </summary>
    public static string? PendingReadingNote(AppState s)
    {
        var previous = s.Trips
            .Where(t => t.EndOdometer > 0 && t.Status == "Delivered")
            .OrderByDescending(t => GameClock.TryParse(t.DeliveredGameTime) ?? DateTime.MinValue)
            .FirstOrDefault();
        if (previous == null) return null;

        // Only interesting when the reading has NOT moved. If it has, Measure will do its job.
        if (Math.Abs(s.Status.AtsOdometer - previous.EndOdometer) >= 0.5) return null;

        var closedAt = $"{previous.DestCity}, {previous.DestState}".Trim(' ', ',');
        var nowAt = $"{s.Status.LocationCity}, {s.Status.LocationState}".Trim(' ', ',');
        if (closedAt.Length == 0 || nowAt.Length == 0) return null;
        if (closedAt.Equals(nowAt, StringComparison.OrdinalIgnoreCase)) return null;   // never left

        return $"Before I book anything: you closed {previous.Number} in {closedAt} and you are standing in " +
               $"{nowAt}, but the odometer still reads {s.Status.AtsOdometer:N0} — what it read when you closed. " +
               "Report it on the status panel first and the empty run gets paid on this load. Authorise without " +
               "it and those miles are gone, because I only work the repositioning out once.";
    }

    public static Leg? Measure(AppState s, Trip trip, double odometerAtDispatch)
    {
        if (odometerAtDispatch <= 0) return null;

        var previous = s.Trips
            .Where(t => t.Id != trip.Id && t.EndOdometer > 0 && t.Status == "Delivered")
            .OrderByDescending(t => GameClock.TryParse(t.DeliveredGameTime) ?? DateTime.MinValue)
            .FirstOrDefault();
        if (previous == null) return null;

        var delta = odometerAtDispatch - previous.EndOdometer;
        var leg = new Leg
        {
            FromOdometer = previous.EndOdometer,
            ToOdometer = odometerAtDispatch,
            AfterTrip = previous.Number
        };

        // No movement on the odometer. Usually right — the driver closed out and took the next load from
        // the same dock. But if they are standing somewhere ELSE, they plainly drove there, and the app
        // is about to pay nothing for it because nobody reported a new reading. Say so rather than
        // quietly settling at zero: this is the case where a truck stop to terminal run, or a hop from
        // one yard to another to pick up freight, silently earns nothing.
        if (Math.Abs(delta) < 0.5)
        {
            var closedAt = $"{previous.DestCity}, {previous.DestState}".Trim(' ', ',');
            var nowAt = $"{s.Status.LocationCity}, {s.Status.LocationState}".Trim(' ', ',');
            if (closedAt.Length > 0 && nowAt.Length > 0
                && !closedAt.Equals(nowAt, StringComparison.OrdinalIgnoreCase))
            {
                leg.Warning = $"You closed {previous.Number} in {closedAt} and you are dispatching from {nowAt}, " +
                              $"but the odometer still reads {odometerAtDispatch:N0} — the same as when you closed. " +
                              "I cannot pay empty miles I have no reading for. Report your odometer and I will put " +
                              "the repositioning on this load.";
                return leg;
            }
            return null;
        }

        if (delta < 0)
        {
            leg.Warning = $"The odometer at dispatch ({odometerAtDispatch:N0}) is lower than it was when " +
                          $"{previous.Number} closed ({previous.EndOdometer:N0}). No empty miles paid on that — " +
                          "check the readings.";
            return leg;
        }

        if (delta > ImplausibleMiles)
        {
            leg.Warning = $"That is {delta:N0} mi between {previous.Number} closing and this dispatch. Too far to " +
                          "be repositioning — if you really ran that empty it wants dispatching as an empty move. " +
                          "Nothing paid on it here.";
            return leg;
        }

        leg.Miles = Math.Round(delta, 0);
        leg.Explanation = $"{leg.Miles:N0} empty mi repositioning after {previous.Number} " +
                          $"(odometer {previous.EndOdometer:N0} → {odometerAtDispatch:N0}).";
        return leg;
    }
}
