using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How long a new employer's probation runs, and how many good reviews it takes.
///
/// It used to be three consecutive passes for everybody, forever, because <c>PassesToClear</c> was a
/// constant. Everything else in the plan scaled with history — loads, miles, days all halved for a
/// driver with 40 loads behind them — and the one dimension that did not became the binding
/// constraint. It also bound <b>backwards</b>:
///
/// <list type="bullet">
///   <item><b>Veteran:</b> 45 days at a review every 14 = three reviews available, three required.
///     Zero slack. A single non-pass resets the run and the plan cannot be completed at all.</item>
///   <item><b>Rookie:</b> 90 days = six reviews for the same three. Room to stumble twice.</item>
/// </list>
///
/// So the reward for a long clean record was a probation that could not survive one bad fortnight.
///
/// It also took no notice of which way the move went. Dropping to an easier carrier, moving sideways
/// to a peer, and stretching up to an outfit that wants five years and 96% on time all produced the
/// same probation. A carrier at the top of the market expects more and looks harder for longer; that
/// is most of what makes moving up feel like moving up.
///
/// So the plan comes from <b>the stretch</b>: how far the new carrier's bar sits above what this
/// driver has actually proven. And whatever the passes figure is, the window always leaves slack for
/// it — see <see cref="ReviewsAvailable"/>. Passes required must never equal reviews available.
/// </summary>
public static class ProbationPlanner
{
    /// <summary>
    /// What a period asks for, in the shape the driver actually runs.
    ///
    /// A flat "13 loads and 19,800 miles" is an over-the-road shape, and holding a local driver to it
    /// punishes them for running the work they chose — they would need the mileage of a long-haul
    /// driver on runs a fifth the length. The same effort looks completely different depending on the
    /// preference: short runs mean many deliveries and few miles, OTR the reverse.
    ///
    /// Deliberately around half of what a working driver does. The point is that the period cannot be
    /// sat out at the terminal, not that it is a grind.
    /// </summary>
    private static (double LoadsPerWeek, double MilesPerWeek) WeeklyTarget(string? preference) =>
        (preference ?? "medium").Trim().ToLowerInvariant() switch
        {
            "short" => (4.0, 700),
            "long" => (1.5, 1300),
            "otr" => (1.0, 1400),
            _ => (2.5, 1200),                 // medium
        };

    /// <summary>
    /// Loads and miles this driver's period asks for, on the preference in force NOW.
    ///
    /// Recomputed rather than frozen at hire, because a driver who switches from OTR to local halfway
    /// through has changed what their work looks like, and holding them to the old shape would be the
    /// app punishing them for a choice it invited them to make.
    /// </summary>
    public static (int Loads, double Miles) TargetsFor(AppState s, int days)
    {
        var (loadsWeek, milesWeek) = WeeklyTarget(s.Application?.PreferredTripLength);
        var weeks = Math.Max(1.0, days / 7.0);
        return ((int)Math.Max(4, Math.Round(loadsWeek * weeks)), Math.Round(milesWeek * weeks, 0));
    }

    /// <summary>
    /// Brings a running plan's requirements back in line with the preference in force.
    ///
    /// Called when the driver changes how they want to run, so the numbers on the Career tab are the
    /// numbers they will actually be held to rather than the ones that applied when they signed on.
    /// </summary>
    public static void Retarget(AppState s)
    {
        if (!s.Driver.Probation.Active) return;
        var (loads, miles) = TargetsFor(s, s.Driver.Probation.DurationDays);
        s.Driver.Probation.RequiredLoads = loads;
        s.Driver.Probation.RequiredMiles = miles;
    }

    /// <summary>A rookie's first probation, in days. The period the whole model is built on.</summary>
    public const int RookieDays = 90;

    /// <summary>The second look granted after a failed first review. There is no third.</summary>
    public const int SecondChanceDays = 30;

    /// <summary>
    /// The shortest orientation a specialised carrier will run, however good the record is.
    ///
    /// Every offer from one of these says "specialised freight — expect a longer orientation before
    /// they turn you loose", and nothing longer used to happen: the flag was read by the hiring screen
    /// and by nothing else, so an outfit moving transformers and project cargo put a strong hire on the
    /// same shortened clock as a grocery run, having just told them the opposite.
    ///
    /// A floor rather than an extension, because the point is not to punish a good record — it is that
    /// permits, routing and securement take as long to learn as they take, and a carrier does not turn
    /// somebody loose on a lowboy in thirty days because their van numbers were tidy.
    /// </summary>
    public const int SpecialisedFloorDays = 60;

    /// <summary>Days out from the review at which the driver starts being warned it is coming.</summary>
    public const int WarnWithinDays = 14;

    /// <summary>The game day the period ends, or null when there is no probation running.</summary>
    public static DateTime? EndsOn(AppState s)
    {
        if (!Probation.IsOn(s)) return null;
        var start = GameClock.TryParse(s.Driver.Probation.StartedGameDate)
                    ?? GameClock.TryParse(s.Driver.HiredGameDate);
        if (start == null) return null;
        return start.Value.AddDays(Math.Max(1, s.Driver.Probation.DurationDays));
    }

    /// <summary>Days left, negative once the period is served and the review is owed.</summary>
    public static double? DaysLeft(AppState s)
    {
        var ends = EndsOn(s);
        var now = GameClock.TryParse(s.Status.GameTime);
        return ends == null || now == null ? null : (ends.Value - now.Value).TotalDays;
    }

    /// <summary>The period is served, so the next home time carries the verdict.</summary>
    public static bool ReviewDue(AppState s) => DaysLeft(s) is { } d && d <= 0;

    /// <summary>
    /// What to tell the driver, and when to start telling them.
    ///
    /// The banner matters more than it looks: the review lands at a home time, and a driver running with
    /// no fixed arrangement has to know to ask for one or it never happens at all.
    /// </summary>
    public static string? Notice(AppState s)
    {
        if (!Probation.IsOn(s)) return null;
        var left = DaysLeft(s);
        if (left == null) return null;

        var ends = EndsOn(s);
        var on = ends == null ? "" : $" ({GameClock.Pretty(GameClock.Format(ends.Value))})";

        if (left <= 0)
            return $"Your probation period is served{on}. The review happens at your next home time — " +
                   "if you are not on a home-time arrangement, ask for one on the Career tab or this waits.";

        if (left <= WarnWithinDays)
            return $"{left:0.#} day(s) left of probation{on}. The review is taken at the first home time " +
                   "after that, so make sure one is booked.";

        return $"{left:0.#} day(s) of probation left{on}. Reviewed at the first home time after it ends.";
    }

    /// <summary>
    /// Whether the work was actually done, separately from how well.
    ///
    /// Three tests, because totals alone can be passed by running hard for a fortnight and parking for
    /// the rest. The working-weeks check is built from delivered trips rather than duty status — the app
    /// only sees what is reported, and a driver's duty log is not something it can audit.
    /// </summary>
    public static (bool Met, List<string> Shortfall) WorkDone(AppState s)
    {
        var gaps = new List<string>();

        // The driver may have changed how they run since signing on. Judge them on what they are doing
        // now — a local runner should not be held to an over-the-road mileage they never signed up for.
        Retarget(s);
        var plan = s.Driver.Probation;
        var start = GameClock.TryParse(plan.StartedGameDate) ?? GameClock.TryParse(s.Driver.HiredGameDate);
        var now = GameClock.TryParse(s.Status.GameTime);

        var runs = s.Trips
            .Where(t => t.Status == "Delivered" && t.Kind == "Freight")
            .Where(t => start == null || (GameClock.TryParse(t.DeliveredGameTime) is { } d && d >= start.Value))
            .ToList();

        if (runs.Count < plan.RequiredLoads)
            gaps.Add($"{runs.Count} load(s) delivered against {plan.RequiredLoads} the period asks for.");

        var miles = runs.Sum(t => t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles);
        if (miles < plan.RequiredMiles)
            gaps.Add($"{miles:N0} mi run against {plan.RequiredMiles:N0}.");

        // Weeks with a delivery in them. Parking up for two months and running the totals in a fortnight
        // passes on loads and miles and should not pass here.
        if (start != null && now != null)
        {
            var weeks = Math.Max(1, (int)Math.Ceiling((now.Value - start.Value).TotalDays / 7.0));
            var worked = runs
                .Select(t => GameClock.TryParse(t.DeliveredGameTime))
                .Where(d => d != null)
                .Select(d => (int)((d!.Value - start.Value).TotalDays / 7))
                .Distinct().Count();
            var wanted = (int)Math.Ceiling(weeks * 0.6);
            if (worked < wanted)
                gaps.Add($"Delivered in {worked} of {weeks} week(s); we want to see work in at least {wanted}. " +
                         "The period is about showing you can do the job week in week out, not about a good fortnight.");
        }

        return (gaps.Count == 0, gaps);
    }

    /// <summary>Reviews the window allows, at one every <see cref="Probation.ReviewIntervalDays"/> days.</summary>
    public static int ReviewsAvailable(int durationDays) => durationDays / Probation.ReviewIntervalDays;

    /// <summary>Spare reviews a driver must have beyond the passes required, so one bad one is survivable.</summary>
    public const int SlackReviews = 2;

    /// <summary>
    /// The plan for joining <paramref name="code"/>, on what this driver has behind them.
    ///
    /// Three bands. <b>Reaching</b> is a carrier asking for more than the driver has proven — they get
    /// the longest look. <b>Comparable</b> is the ordinary move. <b>Established</b> is a driver whose
    /// record clears the new bar with real room, which includes stepping down.
    /// </summary>
    public static ProbationPlan For(AppState s, string code, string startedGameDate)
    {
        var stats = s.Onboarded ? CareerService.Compute(s) : new CareerStats();
        var loads = stats.LoadsDelivered + s.Driver.PriorLoads;
        var onTime = loads > 0 ? stats.OnTimePct : 100;
        var faults = (s.Onboarded ? SafetyService.CountingFaults(s).Count : 0) + s.Driver.PriorFaultIncidents;

        var bar = Carriers.StandardsOf(s, code);
        var credited = Carriers.CreditedExperienceFor(s);

        // Does this carrier want more than the driver has actually proven?
        var reaching =
            (bar.MinYears > 0 && credited < bar.MinYears + 1)
            || (bar.MinLoads > 0 && loads < bar.MinLoads * 1.4)
            || (bar.MinOnTime > 0 && onTime < bar.MinOnTime + 2)
            || (bar.MaxFaults == 0 && faults > 0)
            || Carriers.HasSkillShortfall(s, code);

        // Or does the record clear it with room to spare?
        var established = !reaching && loads >= 40
                          && (bar.MinOnTime <= 0 || onTime >= bar.MinOnTime + 4)
                          && faults <= bar.MaxFaults;

        int days, reqLoads;
        double reqMiles;
        string note;

        // A PERIOD, reviewed at the end of it. There is no passes figure any more: it was written here,
        // never read, and meanwhile Probation.PassesFor was reading the retired zero as "unset" and
        // substituting three — putting a requirement on the career panel that nothing enforced.
        //
        // Loads and miles are scaled to the period rather than fixed, because they are what stops the
        // whole thing being sat out at the terminal. A driver doing the job clears them without
        // noticing; a driver parked for three months does not.
        if (reaching)
        {
            days = RookieDays;
            note = "Reaching above your record — they want more than you have proven, so the full " +
                   $"{RookieDays} days, reviewed at your first home time after it.";
        }
        else if (established)
        {
            days = loads >= 200 ? 30 : 45;
            note = $"Shortened to {days} days on {loads} verified loads and a record that clears their bar " +
                   "with room. Reviewed at your first home time after it.";
        }
        else
        {
            days = RookieDays;
            note = $"Standard {RookieDays}-day probation, reviewed at your first home time after it.";
        }

        // ---- and a specialised carrier does not turn anybody loose on the short clock
        if (Carriers.IsSpecialized(code) && days < SpecialisedFloorDays)
        {
            var was = days;
            days = SpecialisedFloorDays;
            note = $"{note} Held to {SpecialisedFloorDays} days rather than {was}: this is specialised " +
                   "freight, and the orientation is the orientation whatever your record says.";
        }

        // In the shape this driver runs, not a single over-the-road figure everyone is held to.
        (reqLoads, reqMiles) = TargetsFor(s, days);

        return EnsureSlack(new ProbationPlan
        {
            Active = true,
            // Zero: the PERIOD is the gate now. Kept on the model so older files load and so the field
            // reads as "not used" rather than as a requirement of three that nothing checks — showing a
            // driver a bar the app does not enforce is worse than showing them nothing.
            PassesRequired = 0,
            RequiredLoads = reqLoads,
            RequiredMiles = reqMiles,
            DurationDays = days,
            StartedGameDate = startedGameDate,
            Notes = note,
        });
    }

    /// <summary>
    /// Widens the window until it outlasts the passes it asks for, and says how much room that leaves.
    ///
    /// Every plan goes through here, however it was built. The trap was never the passes figure on its
    /// own — it was a window sized independently of it. The first hire had the same shape in miniature:
    /// 60 days at a review a fortnight is four reviews for three passes, so a single bad one left the
    /// driver needing three in a row from two remaining.
    /// </summary>
    public static ProbationPlan EnsureSlack(ProbationPlan plan)
    {
        // This existed to widen the window until it outlasted the passes it asked for. Under a period
        // there are no passes to outlast — the period IS the gate — so the only thing left worth
        // guaranteeing is that it runs long enough for a couple of interim reviews to land before the
        // verdict. A driver should hear how it is going at least twice before it is decided.
        //
        // It also used to resurrect PassesRequired from zero to three, which quietly put the streak
        // back on every plan that had deliberately retired it.
        var floor = (SlackReviews + 1) * Probation.ReviewIntervalDays;
        if (plan.DurationDays < floor) plan.DurationDays = floor;

        var reviews = ReviewsAvailable(plan.DurationDays);
        plan.Notes = (plan.Notes ?? "").TrimEnd() +
                     $" About {reviews} review(s) along the way to tell you how it is going; the one that " +
                     "decides it is the one after the period ends.";
        return plan;
    }
}
