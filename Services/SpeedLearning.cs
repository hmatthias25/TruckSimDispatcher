using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Learns how fast this player's truck actually covers ground, from runs it actually covered.
///
/// <para>Every hour the planner projects is miles divided by <c>GovernedMph × SpeedFactor</c>, and the
/// factor shipped as 0.86 because somebody picked it. That number decides whether a load is feasible,
/// whether the cycle survives it, and how much slack the app thinks is there — so it being an assumption
/// rather than a measurement is felt everywhere, and felt most exactly where it hurts: a plan that
/// finishes with forty-seven minutes of cycle is only as good as the speed it was divided by.</para>
///
/// <para>So it is measured. The same shape as <see cref="FacilityLearning"/>, which has learned dock
/// times off close-outs for a long time: a running average that settles, a sample count, and a hand-set
/// figure that stops it moving. Nothing here is typed from memory — the near end of the drive is a clock
/// the driver read off the game, the far end is the arrival they stamped, and the time that was not
/// driving comes off the trip log.</para>
///
/// <para><b>What it is not.</b> It is not a per-truck figure: a factor describes the roads, and each
/// tractor's governed speed already applies on top of it. It is not fed by short runs, where ramps,
/// yards and town driving swamp the highway average the plan is actually projecting. And it is not fed
/// by a run whose arithmetic comes out somewhere it cannot be, which nearly always means hours that were
/// spent but never logged.</para>
/// </summary>
public static class SpeedLearning
{
    /// <summary>
    /// Shortest run worth learning from.
    ///
    /// Below this the miles per hour is manoeuvring, ramps and traffic lights rather than the highway
    /// figure the planner needs, and folding it in would teach the app that every load is slower than it
    /// is. Fifty rather than something longer because the average has to settle inside a career somebody
    /// is actually playing: it still throws out yard moves and cross-town hops, which is what it is for.
    /// </summary>
    public const double MinMilesToLearn = 50;

    /// <summary>Samples after which each new one stops moving the average much. Mirrors the dock table.</summary>
    private const int SettleAt = 12;

    /// <summary>
    /// How many runs the shipped assumption is treated as being worth.
    ///
    /// Without it the first sample carries a weight of one and replaces the assumption outright, so a
    /// single unlucky afternoon — roadworks, a mountain pass, a run that was mostly town — becomes the
    /// planning speed for every load after it. That is a lurch, and the whole point of an average that
    /// settles is not to lurch. Two, so the first real run moves it a third of the way and the map has to
    /// keep saying the same thing before the app fully believes it.
    /// </summary>
    private const int PriorWeight = 2;

    /// <summary>
    /// The band a derived factor has to land in to be believed.
    ///
    /// <para>Above the top and the truck went faster than its own governor, which it cannot: what
    /// actually happened is that time was spent and not logged, or the odometer reading is out. Below the
    /// bottom and most of the run was something other than driving — a break nobody wrote down, a queue,
    /// a shift sat out at a gate — and it is measuring that instead.</para>
    ///
    /// <para>Both are thrown away rather than clamped. A reading that cannot be right is not evidence
    /// with a bit of noise on it; it is a reading about something else.</para>
    /// </summary>
    public const double MinBelievableFactor = 0.35;
    public const double MaxBelievableFactor = 1.00;

    /// <summary>What a run turned out to average, or null where it cannot honestly be worked out.</summary>
    public class Reading
    {
        public bool Usable { get; set; }
        public double Miles { get; set; }
        public double DriveHours { get; set; }
        public double Mph { get; set; }
        public double Factor { get; set; }
        /// <summary>Hours between pulling out and arriving that the log accounts for as not driving.</summary>
        public double LoggedStops { get; set; }
        public string Why { get; set; } = "";
    }

    /// <summary>
    /// What this trip says about driving speed.
    ///
    /// Elapsed from pulling out of the shipper to arriving at the receiver, less everything the trip log
    /// says was not driving. Breaks, resets, fuel stops, delays and breakdowns all come off — they are on
    /// the log precisely because they are not miles.
    /// </summary>
    public static Reading Measure(AppState s, Trip trip, Truck? truck)
    {
        var r = new Reading();

        var out_ = GameClock.TryParse(trip.PulledOutGameTime) ?? PulledOutFromLog(trip);
        var arrived = GameClock.TryParse(trip.ArrivedGameTime);
        if (out_ == null || arrived == null)
        {
            r.Why = "no pull-out or arrival clock on the trip";
            return r;
        }

        var miles = trip.ActualMiles > 0 ? trip.ActualMiles : trip.DispatchedMiles;
        r.Miles = miles;
        if (miles < MinMilesToLearn)
        {
            r.Why = $"{miles:0} mi is under the {MinMilesToLearn:0}-mile floor — too short to be a highway average";
            return r;
        }

        var elapsed = (arrived.Value - out_.Value).TotalHours;
        if (elapsed <= 0)
        {
            r.Why = "arrival is not after the pull-out — a typo rather than a fast run";
            return r;
        }

        r.LoggedStops = NonDrivingHours(s, trip, out_.Value, arrived.Value);
        r.DriveHours = elapsed - r.LoggedStops;
        if (r.DriveHours <= 0.1)
        {
            r.Why = "the log accounts for nearly all of it as stopped";
            return r;
        }

        r.Mph = miles / r.DriveHours;
        var governed = truck?.GovernedMph > 0 ? truck.GovernedMph : s.Settings.GovernedMph;
        if (governed <= 0) governed = 65;
        r.Factor = r.Mph / governed;

        if (r.Factor is < MinBelievableFactor or > MaxBelievableFactor)
        {
            r.Why = r.Factor > MaxBelievableFactor
                ? $"{r.Mph:0.#} mph is past the truck's own governor — hours were spent and not logged, or the odometer is out"
                : $"{r.Mph:0.#} mph is too slow to be driving — most of that run was something the log does not show";
            return r;
        }

        r.Usable = true;
        r.Why = $"{miles:0} mi in {Hhmm.Of(r.DriveHours)} of driving — {r.Mph:0.#} mph";
        return r;
    }

    /// <summary>
    /// Folds a delivered run into the planning speed, and says whether it moved.
    ///
    /// Returns null where the run taught nothing, which is the ordinary case for a short hop or a trip
    /// with half its hours missing from the log.
    /// </summary>
    /// <summary>
    /// Why a run that looked long enough to teach something taught nothing, or null where there is
    /// nothing worth saying.
    ///
    /// <para>Silence is the wrong answer here. The far end of every measurement is the <b>I have
    /// arrived</b> stamp, and a driver who closes out without pressing it produces no sample at all — so
    /// the feature would simply appear not to work, run after run, with nothing to suggest what was
    /// missing. A short hop is not worth mentioning; a five-hundred-mile run that could not be timed is.</para>
    ///
    /// <para>There is deliberately no fallback to the delivered time. That clock is stamped after the
    /// unload, so using it would fold dock time into the driving and teach the planner the roads are
    /// slower than they are — quietly, and by an amount small enough to get past the believable band.</para>
    /// </summary>
    public static string? WhyNothingLearned(AppState s, Trip trip, Truck? truck)
    {
        if (s.Settings.SpeedFactorManual) return null;

        var miles = trip.ActualMiles > 0 ? trip.ActualMiles : trip.DispatchedMiles;
        if (miles < MinMilesToLearn) return null;          // too short to be worth a word either way

        var r = Measure(s, trip, truck);
        if (r.Usable) return null;

        if (string.IsNullOrWhiteSpace(trip.ArrivedGameTime))
            return $"Nothing learned about driving speed from this one: there is no arrival time on it. " +
                   $"Press <b>I have arrived</b> when you reach the receiver and a run like this " +
                   $"({miles:0} mi) teaches the planner what your roads actually average.";

        return $"Nothing learned about driving speed from this one — {r.Why}.";
    }

    public static string? Record(AppState s, Trip trip, Truck? truck)
    {
        if (s.Settings.SpeedFactorManual) return null;

        var r = Measure(s, trip, truck);
        if (!r.Usable) return null;

        var before = s.Settings.SpeedFactor;
        var weight = 1.0 / Math.Min(s.Settings.SpeedFactorSamples + PriorWeight + 1, SettleAt);
        s.Settings.SpeedFactor = Math.Round(before + (r.Factor - before) * weight, 4);
        s.Settings.SpeedFactorSamples++;

        var governed = truck?.GovernedMph > 0 ? truck.GovernedMph : s.Settings.GovernedMph;
        if (governed <= 0) governed = 65;

        return $"{trip.Number} ran {r.Miles:0} mi in {Hhmm.Of(r.DriveHours)} of driving — {r.Mph:0.#} mph. " +
               $"Planning speed is now {governed * s.Settings.SpeedFactor:0.#} mph over " +
               $"{s.Settings.SpeedFactorSamples} run(s), from {governed * before:0.#}.";
    }

    /// <summary>
    /// Hours between pulling out and arriving that the trip log says were not spent driving.
    ///
    /// Only events inside the window count. A break logged at the receiver after arrival is part of the
    /// delivery, not part of the run, and subtracting it would make the driving look quicker than it was.
    /// </summary>
    private static double NonDrivingHours(AppState s, Trip trip, DateTime from, DateTime to)
    {
        // A trip event is a stamp, not a span — it records that a break happened, not how long it ran.
        // So each kind is costed at what the rule set says it takes, and the layover and breakdown days
        // come off the close-out where the driver stated them outright.
        //
        // That is an approximation, and it is the right one to make here rather than asking for more
        // typing: a driver who sat longer than the minimum comes out looking slower than they drove, and
        // the believable band below throws that sample away rather than letting it teach anything. A
        // measurement that might be wrong is not folded in and hedged; it is not folded in.
        var rules = s.Settings.Hos;
        var total = 0.0;

        foreach (var e in trip.Events)
        {
            if (GameClock.TryParse(e.GameTime) is not { } at) continue;
            if (at < from || at > to) continue;
            total += e.Kind switch
            {
                "Break" => Math.Max(0, rules.BreakLength),
                "Rest" => Math.Max(0, rules.OffDutyReset),
                "Restart" => Math.Max(0, rules.CycleRestartHours),
                "Fuel" => Math.Max(0, s.Settings.FuelStopHours),
                _ => 0,
            };
        }

        total += Math.Max(0, trip.LayoverDays) * 24;
        total += Math.Max(0, trip.BreakdownDays) * 24;

        return Math.Min(total, (to - from).TotalHours);
    }

    /// <summary>
    /// When a live load pulled out, off the log. Drop and hook has no such event and asks instead —
    /// see <see cref="Trip.PulledOutGameTime"/>.
    /// </summary>
    private static DateTime? PulledOutFromLog(Trip trip) =>
        trip.Events.Where(e => e.Kind == "EndLoad")
            .Select(e => GameClock.TryParse(e.GameTime))
            .Where(d => d != null)
            .Max();
}
