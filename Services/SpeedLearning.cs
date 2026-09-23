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

        var (stops, unknownStops) = NonDrivingHours(s, trip, out_.Value, arrived.Value);
        r.LoggedStops = stops;
        r.DriveHours = elapsed - r.LoggedStops;
        if (r.DriveHours <= 0.1)
        {
            r.Why = "the log accounts for nearly all of it as stopped";
            return r;
        }

        // A sleep with no end stamp is an unknown, not a ten. See NonDrivingHours: whatever the driver
        // actually sat beyond the minimum is hours that land in the divisor as though they were driving,
        // and there is no way to tell from here how many. So the run does not teach — and the driver is
        // told what to add so that it can, rather than being left with a sample silently thrown away.
        if (unknownStops > 0)
        {
            r.Why = $"{unknownStops} rest(s) on this run have no end time, so there is no telling how long "
                    + "they actually ran — anything sat beyond the minimum would count as driving here. "
                    + "Put the time you rolled again on the rest in the trip log and this run will teach "
                    + "the planner properly";
            return r;
        }

        // Nobody drives 24:55.
        //
        // The hours of service are the whole point of this app, and they cap a driving day at the drive
        // limit. A run can of course span several days — but only across a rest, and a rest that happened
        // is a rest the log should show. So the most driving that can sit between the stops on record is
        // the drive limit for the day it pulled out, plus one more for every rest or restart logged
        // inside the window.
        //
        // Past that it is not a slow run, it is a run with hours in it nobody wrote down, and the speed
        // it implies is arithmetic on a gap. Reported from play on a 630-mile Tulsa to Peoria run that
        // came back as "24:55 of driving": the ten-hour reset in the middle was never logged as a trip
        // event, so NonDrivingHours could not see it and the whole sleep counted as driving.
        //
        // The believable band below would have let that through — 630 mi in 24:55 is 25 mph, and the
        // floor is 0.35 of a 65 mph governor, which is 22.75. Planning speed is what every feasibility
        // answer is built on, so a sample like this does not merely look silly on the card; it makes the
        // next fortnight of freight read as undeliverable.
        var sleeps = trip.Events.Count(e =>
            (e.Kind == "Rest" || e.Kind == "Restart")
            && GameClock.TryParse(e.GameTime) is { } at && at >= out_.Value && at <= arrived.Value);
        var mostThatCouldBeDriving = Math.Max(0, s.Settings.Hos.DriveLimit) * (sleeps + 1);
        if (mostThatCouldBeDriving > 0 && r.DriveHours > mostThatCouldBeDriving)
        {
            r.Why = $"{Hhmm.Of(r.DriveHours)} between the stops on record, and with "
                    + $"{(sleeps == 0 ? "no rest" : $"{sleeps} rest(s)")} logged the rules allow at most "
                    + $"{Hhmm.Of(mostThatCouldBeDriving)} of driving in that span — there are hours in "
                    + "this run the log does not show, most likely a rest that never got entered";
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
    /// <summary>
    /// How much of the span between two stamps was not driving, and whether the log actually knows.
    ///
    /// <para><b>A sleep is measured, not assumed.</b> This costed every rest at the ten-hour minimum,
    /// which is only right when the driver took exactly the minimum. Reported from play: "you know when
    /// I start rest (I can log a rest time) but not when it ends. So if I rest more than 10 (ex waiting
    /// for a shipper to open) then you don't know this. Just assuming a rest is 10 hours is
    /// incorrect."</para>
    ///
    /// <para>Right, and the hours that go missing are counted as DRIVING — sit fourteen against a ten
    /// hour assumption and four hours of sleep land in the divisor. A 630-mile run comes out at 39 mph
    /// instead of 52 and teaches the planner the map is slower than it is. The HOS ceiling above does not
    /// catch that one either: it is comfortably under the limit, just wrong.</para>
    ///
    /// <para>So a stop that records when it ended is measured off its own stamps. One that does not is
    /// reported as <c>Unknown</c>, and the caller refuses the run rather than dividing by a guess. Breaks
    /// keep the minimum where no end is given: thirty minutes is small enough that the believable band
    /// absorbs it, and demanding an end time for every half-hour would cost more typing than it is
    /// worth.</para>
    /// </summary>
    private static (double Hours, int Unknown) NonDrivingHours(AppState s, Trip trip, DateTime from, DateTime to)
    {
        var rules = s.Settings.Hos;
        var total = 0.0;
        var unknown = 0;

        foreach (var e in trip.Events)
        {
            if (GameClock.TryParse(e.GameTime) is not { } at) continue;
            if (at < from || at > to) continue;

            // Measured, where the driver said when they rolled again.
            var measured = GameClock.TryParse(e.EndGameTime) is { } done && done > at
                ? (done - at).TotalHours
                : (double?)null;

            switch (e.Kind)
            {
                case "Rest":
                case "Restart":
                    // The two with big minimums, and so the two where guessing is worth a whole sample.
                    if (measured is { } m) total += m;
                    else
                    {
                        total += Math.Max(0, e.Kind == "Rest" ? rules.OffDutyReset : rules.CycleRestartHours);
                        unknown++;
                    }
                    break;
                case "Break":
                    total += measured ?? Math.Max(0, rules.BreakLength);
                    break;
                case "Delay":
                case "Breakdown":
                    // Costed at nothing unless the driver said how long, because there is no minimum for
                    // these to fall back on. The close-out's layover and breakdown days cover the rest.
                    total += measured ?? 0;
                    break;
                case "Fuel":
                    total += measured ?? Math.Max(0, s.Settings.FuelStopHours);
                    break;
            }
        }

        total += Math.Max(0, trip.LayoverDays) * 24;
        total += Math.Max(0, trip.BreakdownDays) * 24;

        return (Math.Min(total, (to - from).TotalHours), unknown);
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
