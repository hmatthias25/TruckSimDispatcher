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

    /// <summary>Consecutive passes needed. A fail breaks the run — that is what makes each one matter.</summary>
    public const int PassesToClear = 3;

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

        var run = ConsecutivePasses(s);
        var need = PassesToClear - run;
        return s.ProbationReviews.Count == 0
            ? $"On probation. Report to the yard every {ReviewIntervalDays} days — {PassesToClear} good reviews in a row clears it."
            : $"On probation. {run} pass(es) in a row, {need} more to go.";
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

        var onTime = trips.Count == 0 ? 0
            : trips.Count(t => t.ServiceResult == "OnTime") * 100.0 / trips.Count;

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
            if (onTime >= 95) forThem.Add($"{onTime:0.#}% on time.");
            else if (onTime >= 80) against.Add($"{onTime:0.#}% on time — under the 95% we expect.");
            else against.Add($"{onTime:0.#}% on time. That is not close.");
        }

        if (faults.Count == 0) forThem.Add("Nothing preventable on the safety record this period.");
        else against.Add($"{faults.Count} preventable incident(s): {string.Join("; ", faults.Select(f => f.Kind))}.");

        var damage = Math.Max(s.Status.TruckDamagePct, 0);
        if (damage >= s.Settings.Maintenance.MandatoryReviewPct)
            against.Add($"Brought the tractor back at {damage:0.#}% damage.");
        else if (damage <= 5)
            forThem.Add($"Equipment came back clean — {damage:0.#}% on the tractor.");

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

        // ---- does this clear it?
        var run = ConsecutivePasses(s);
        review.PassesInARow = run;

        if (review.Verdict == "Pass" && run >= PassesToClear)
        {
            var (metThresholds, shortfall) = MeetsCompanyThresholds(s);
            if (metThresholds)
            {
                review.ClearedProbation = true;
                review.NextStep = $"That is {PassesToClear} in a row. Probation is done — you are a company driver. " +
                                  "Your own home-time arrangement takes over from here.";
            }
            else
            {
                review.NextStep = $"That is {PassesToClear} good reviews in a row, which is the hard part. " +
                                  $"You are still short on the numbers though: {shortfall} Keep the run going and it will come.";
            }
        }
        else if (review.Verdict == "Pass")
        {
            review.NextStep = $"{run} in a row. {PassesToClear - run} more and you are off probation. " +
                              $"Back in {ReviewIntervalDays} days.";
        }
        else
        {
            review.NextStep = $"The run resets — you need {PassesToClear} in a row. Back in {ReviewIntervalDays} days. " +
                              "This is not discipline and it is not on your safety record; it means the probation carries on.";
        }

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
        if (onTimeAll < plan.RequiredOnTimePct)
            missing.Add($"{onTimeAll:0.#}% of {plan.RequiredOnTimePct:0.#}% on time");
        if (faults > plan.MaxDriverFaultIncidents)
            missing.Add($"{faults} driver-fault incident(s) against an allowance of {plan.MaxDriverFaultIncidents}");

        return missing.Count == 0
            ? (true, "")
            : (false, string.Join(", ", missing) + ".");
    }
}
