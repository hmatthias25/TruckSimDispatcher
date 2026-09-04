using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Probation, as something that actually happens to you.
///
/// It used to be a number: ten loads, six thousand miles, on-time above 95%, and the rank quietly
/// flipped. The driver never came in, nobody looked at their work, and there was no moment where the
/// company decided whether to keep them. That is not what probation is.
///
/// So a probationary driver comes to the yard <b>every fortnight</b> — whatever arrangement they picked
/// at hire is suspended until this is behind them — and each time they report in, somebody goes through
/// the period with them and writes a verdict. Three good ones in a row clears it.
///
/// The old thresholds are still the floor. A run of quiet fortnights with four loads in them is not a
/// case for taking someone off probation, and the evaluation says so rather than passing them anyway.
/// </summary>
public static class Probation
{
    /// <summary>How often a probationary driver reports to the yard. Not negotiable while on it.</summary>
    public const int ReviewIntervalDays = 14;

    /// <summary>
    /// The default, and what every career written before the plan carried its own figure used.
    /// <b>Historical.</b> Probation is a period now, and nothing requires a run of reviews. Kept for the
    /// schema-4 migration, which is about careers cleared under this rule and has to know what it was.
    /// </summary>
    public const int PassesToClear = 3;

    /// <summary>
    /// Consecutive passes this driver's probation requires. <b>Zero, unless a plan still says otherwise.</b>
    ///
    /// This used to read the retired zero as "unset" and hand back <see cref="PassesToClear"/>:
    ///
    ///     PassesRequired > 0 ? PassesRequired : PassesToClear
    ///
    /// The migration writes zero deliberately, to mean the streak is not the gate. Turning it back into
    /// three put "3 good reviews in a row" on the career panel of every migrated career — half filled
    /// and unmeetable, beside a standing line already counting the period down. The comment on
    /// ProbationPlan.PassesRequired says the field is kept at zero rather than deleted so it reads as
    /// "not used" rather than as a requirement nothing enforces. Then this read it as one.
    /// </summary>
    public static int PassesFor(AppState s) => Math.Max(0, s.Driver.Probation.PassesRequired);

    /// <summary>Days past the fortnight before the overrun is worth writing down.</summary>
    private const double OverrunGraceDays = 3;

    public static bool IsOn(AppState s) => s.Driver.Rank == "probationary";

    /// <summary>
    /// The home-time interval actually in force. While probationary the driver's own arrangement is
    /// suspended — including "no arrangement", which is not an option for somebody still being assessed.
    /// </summary>
    public static int EffectiveIntervalDays(AppState s) =>
        IsOn(s) ? ReviewIntervalDays : s.Driver.HomeTimeIntervalDays;

    /// <summary>Passes standing right now. Reset by any fail, which is the point of them being in a row.</summary>
    public static int ConsecutivePasses(AppState s)
    {
        var run = 0;
        foreach (var e in s.ProbationReviews)          // newest first
        {
            if (e.Verdict != "Pass") break;
            run++;
        }
        return run;
    }

    /// <summary>Where the driver stands, for the Career tab.</summary>
    public static string Standing(AppState s)
    {
        if (!IsOn(s))
            return s.ProbationReviews.Count > 0
                ? $"Probation cleared after {s.ProbationReviews.Count} review(s)."
                : "Not on probation.";

        // The period, not the streak. Interim reviews still land every fortnight, but they are feedback
        // on how it is going rather than the thing that ends it.
        var left = ProbationPlanner.DaysLeft(s);
        var days = s.Driver.Probation.DurationDays;
        var attempt = s.Driver.Probation.Attempt >= 2 ? " This is the second look." : "";

        if (left is not { } d)
            return $"On probation — a {days}-day period, reviewed at your first home time after it ends.{attempt}";

        return d <= 0
            ? $"Probation served. The review that decides it happens at your next home time.{attempt}"
            : $"On probation. {d:0.#} of {days} day(s) left; the review is taken at the first home time " +
              $"after that.{attempt}";
    }

    /// <summary>
    /// Writes the review for the period since the last one.
    ///
    /// Called when a probationary driver reports in at the home terminal. Everything it weighs is
    /// already on the record — this invents nothing, it just reads the file the way a person would.
    /// </summary>
    public static ProbationReview? ReviewOnArrival(AppState s)
    {
        if (!IsOn(s)) return null;

        var last = s.ProbationReviews.FirstOrDefault();
        var since = GameClock.TryParse(last?.GameTime) ?? GameClock.TryParse(s.Driver.HiredGameDate);
        var now = GameClock.TryParse(s.Status.GameTime);
        if (since == null || now == null) return null;

        var daysCovered = (now.Value - since.Value).TotalDays;

        // A review needs a period to review. A driver whose home yard is on their lane touches it
        // constantly, and writing an empty review every time they pass through would bury the real
        // ones under a pile of "nothing delivered since yesterday". Half the interval is the floor.
        if (daysCovered < ReviewIntervalDays * 0.5) return null;

        var trips = s.Trips
            .Where(t => t.Status == "Delivered" && t.Kind == "Freight")
            .Where(t => GameClock.TryParse(t.DeliveredGameTime) is { } d && d > since.Value && d <= now.Value)
            .ToList();

        // Only lateness the driver was blamed for. This counted every load that was not "OnTime",
        // so a shipper loading late, a receiver refusing the truck, or weather all read back to the
        // driver as their own failure — the one thing the career ladder was careful never to do.
        var lateOnThem = trips.Count(t => t.ServiceResult == "Late"
                                          && t.DelayFault.Equals("Driver", StringComparison.OrdinalIgnoreCase));
        var onTime = trips.Count == 0 ? 0
            : (trips.Count - lateOnThem) * 100.0 / trips.Count;

        var faults = s.Incidents
            .Where(i => GameClock.TryParse(i.GameTime) is { } d && d > since.Value && d <= now.Value)
            .Where(i => i.FaultAttribution == "Driver" && i.Preventable)
            .ToList();

        var review = new ProbationReview
        {
            Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-PR-{s.ProbationReviews.Count + 1:0000}",
            GameTime = s.Status.GameTime,
            PeriodStartGameTime = GameClock.Format(since.Value),
            DaysCovered = Math.Round(daysCovered, 1),
            LoadsDelivered = trips.Count,
            OnTimePct = Math.Round(onTime, 1),
            PreventableFaults = faults.Count,
            ReviewNumber = s.ProbationReviews.Count + 1
        };

        // ---- the case, either way
        var against = new List<string>();
        var forThem = new List<string>();

        if (trips.Count == 0)
            against.Add($"Nothing delivered in {daysCovered:0} days. There is nothing here to assess.");
        else if (trips.Count < 3)
            against.Add($"{trips.Count} load(s) in {daysCovered:0} days. That is light for the period.");
        else
            forThem.Add($"{trips.Count} loads delivered in {daysCovered:0} days.");

        if (trips.Count > 0)
        {
            // Worded as what it now measures. "On time" beside a service figure that counts every
            // late load however it happened would read as two different answers to one question.
            if (lateOnThem == 0)
                forThem.Add($"{trips.Count} load(s) and nothing late that was on you.");
            else if (onTime >= 80)
                against.Add($"{lateOnThem} load(s) late on you out of {trips.Count}. Delays that were " +
                            "not your doing are not counted here.");
            else
                against.Add($"{lateOnThem} of {trips.Count} load(s) late on you. That is not close.");
        }

        if (faults.Count == 0) forThem.Add("Nothing preventable on the safety record this period.");
        else against.Add($"{faults.Count} preventable incident(s): {string.Join("; ", faults.Select(f => f.Kind))}.");

        // Equipment. Not "what does the gauge say" — that punished a driver for the damage somebody
        // else did to them and never once noticed wear. See WearReview.
        var wear = WearReview.Assess(s, since.Value, now.Value, last?.TruckDamagePct ?? -1);
        WearReview.Apply(wear, forThem, against);
        review.TruckDamagePct = wear.DamageNow;

        if (daysCovered > ReviewIntervalDays + OverrunGraceDays)
            against.Add($"Took {daysCovered:0} days to report in against a {ReviewIntervalDays}-day requirement. " +
                        "Come in when you are due — I cannot review work I have not seen.");

        review.Strengths = forThem;
        review.Concerns = against;

        // ---- the verdict. A pass needs work done, done on time, and nothing preventable.
        var enoughWork = trips.Count >= 3;
        var enoughService = trips.Count > 0 && onTime >= 95;
        var clean = faults.Count == 0;
        review.Verdict = enoughWork && enoughService && clean ? "Pass" : "Fail";

        review.Summary = review.Verdict == "Pass"
            ? $"Review {review.ReviewNumber}: passed. {string.Join(" ", forThem)}"
            : $"Review {review.ReviewNumber}: not yet. {string.Join(" ", against)}";

        s.ProbationReviews.Insert(0, review);

        // The run of passes at the time of this review. Recorded because it is a true thing about the
        // review and old ones carry it, not because anything is counting to a target — nothing has been
        // since probation became a period, and the review card stopped showing it as "1 of 3".
        review.PassesInARow = ConsecutivePasses(s);

        // ---- the verdict that actually decides it
        //
        // A streak is not a probationary period. Interim reviews carry on as feedback so a driver can
        // see where they stand, but only the review AFTER the period is served clears anything — and
        // that is the one this branch handles.
        if (!ProbationPlanner.ReviewDue(s))
        {
            var left = ProbationPlanner.DaysLeft(s) ?? 0;
            review.NextStep = review.Verdict == "Pass"
                ? $"Nothing wrong here. {left:0.#} day(s) of the period left — the review that decides it is " +
                  "taken at the first home time after that."
                : $"Not a good period, and it goes on the record for the review at the end. {left:0.#} day(s) " +
                  "left. This is not discipline; it is a warning shot while there is still time to fix it.";
            return review;
        }

        // The period is served. Two questions, kept apart on purpose: was the work done at all, and was
        // it done well? A driver who parked for two months fails the first regardless of how clean the
        // few loads they ran were.
        var (workMet, workGaps) = ProbationPlanner.WorkDone(s);
        var (metThresholds, shortfall) = MeetsCompanyThresholds(s);
        var quality = review.Verdict == "Pass" && metThresholds;

        if (workMet && quality)
        {
            review.ClearedProbation = true;
            review.NextStep = $"That is the {s.Driver.Probation.DurationDays}-day period served and the review " +
                              "passed. Probation is done — you are a company driver, and your own home-time " +
                              "arrangement takes over from here.";
            return review;
        }

        var why = new List<string>();
        why.AddRange(workGaps);
        if (!metThresholds) why.Add(shortfall);
        if (review.Verdict != "Pass") why.Add("And this period's own review did not pass.");

        if (s.Driver.Probation.Attempt < 2)
        {
            // One more look. Not a formality — the same review against the same bar, thirty days on.
            s.Driver.Probation.Attempt = 2;
            s.Driver.Probation.DurationDays += ProbationPlanner.SecondChanceDays;
            review.NextStep =
                $"The period is up and this does not clear it: {string.Join(" ", why)} " +
                $"You get {ProbationPlanner.SecondChanceDays} more days and one more review. Pass that and you are " +
                "a company driver. Do not, and we part company.";
            return review;
        }

        // Second look failed. That is the job.
        review.EndsEmployment = true;
        review.NextStep = $"That was the second review and it does not clear either: {string.Join(" ", why)} " +
                          "This is the end of it here.";
        return review;
    }

    /// <summary>
    /// The career's own probation terms, still the floor. Evaluations are the judgement, but a run of
    /// quiet fortnights with four loads in them is not a case for promoting somebody.
    ///
    /// Read from <see cref="ProbationPlan"/> rather than hard-coded, because that is the same set of
    /// numbers the requirements panel shows the driver — two different figures for the same rule is a
    /// contradiction they would be right to complain about, and carriers shorten probation for verified
    /// experience so the numbers genuinely vary between careers.
    /// </summary>
    public static (bool Met, string Shortfall) MeetsCompanyThresholds(AppState s)
    {
        var plan = s.Driver.Probation;
        var delivered = s.Trips.Count(t => t.Status == "Delivered" && t.Kind == "Freight");
        var miles = s.Trips.Where(t => t.Status == "Delivered")
            .Sum(t => (t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles) + t.DeadheadMiles);
        var onTimeAll = delivered == 0 ? 0
            : s.Trips.Count(t => t.Status == "Delivered" && t.Kind == "Freight" && t.ServiceResult == "OnTime") * 100.0 / delivered;
        var faults = SafetyService.CountingFaults(s).Count;

        var missing = new List<string>();
        if (delivered < plan.RequiredLoads) missing.Add($"{delivered} of {plan.RequiredLoads} loads");
        if (miles < plan.RequiredMiles) missing.Add($"{miles:N0} of {plan.RequiredMiles:N0} mi");
        // Counted like the career ladder counts them: driver-fault only, inside a recent window, so
        // clean work walks them off. A percentage over the whole period never forgave anything.
        var lateStrikes = SafetyService.LateStrikes(s);
        if (lateStrikes >= plan.MaxLateStrikes)
            missing.Add($"{lateStrikes} driver-fault late delivery(s) in the last " +
                        $"{SafetyService.LateStrikeWindow} loads, against an allowance of {plan.MaxLateStrikes}");
        if (faults > plan.MaxDriverFaultIncidents)
            missing.Add($"{faults} driver-fault incident(s) against an allowance of {plan.MaxDriverFaultIncidents}");

        return missing.Count == 0
            ? (true, "")
            : (false, string.Join(", ", missing) + ".");
    }
}
