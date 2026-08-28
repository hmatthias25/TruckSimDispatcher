using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The review a driver gets once probation is behind them.
///
/// Clearing probation used to end the reviewing entirely, which is not how a company works — it stops
/// looking closely, it does not stop looking. So roughly every two months somebody goes through the
/// period with the driver: what they moved, whether it arrived when it was promised, and what it cost
/// to keep the equipment on the road.
///
/// Nobody is called in for it. It happens the next time the driver is at the yard after the sixty days
/// are up, the same way the fortnightly fleet report waits for them, because a carrier does not burn a
/// day of somebody's time on a conversation that can happen when they are already standing there.
/// </summary>
public static class PeriodicReview
{
    /// <summary>Game days between reviews once probation is behind them.</summary>
    public const int IntervalDays = 60;

    /// <summary>
    /// A review needs a period worth reviewing. A driver whose yard sits on their lane touches it
    /// constantly, and writing an empty review each time would bury the real ones.
    /// </summary>
    public const double MinimumDaysCovered = IntervalDays * 0.6;

    /// <summary>On-time percentage a review expects. Below it the driver hears about it.</summary>
    public const double ExpectedOnTimePct = 90;

    /// <summary>Days after which the driver is told a review is waiting for them at the yard.</summary>
    public const int NoticeDays = 7;

    /// <summary>When the current period started: the last review, or the day probation ended.</summary>
    private static DateTime? PeriodStart(AppState s)
    {
        var last = s.PeriodicReviews.FirstOrDefault();
        return GameClock.TryParse(last?.GameTime)
               ?? GameClock.TryParse(s.Driver.Probation.ClearedGameDate)
               ?? GameClock.TryParse(s.Driver.HiredGameDate);
    }

    /// <summary>Days into the current review period. Null when there is nothing to measure from.</summary>
    public static double? DaysIntoPeriod(AppState s)
    {
        var since = PeriodStart(s);
        var now = GameClock.TryParse(s.Status.GameTime);
        return since == null || now == null ? null : (now.Value - since.Value).TotalDays;
    }

    /// <summary>
    /// Advance warning that a review is waiting at the yard, so it is never a surprise.
    ///
    /// A driver should know a review is coming before they are sitting in it — particularly once a bad
    /// one can end the job. Null when there is nothing to say.
    /// </summary>
    public static string? Notice(AppState s)
    {
        if (Probation.IsOn(s)) return null;                       // probation has its own reviewing
        if (s.Driver.Rank == "terminated") return null;
        if (DaysIntoPeriod(s) is not { } days) return null;

        var due = IntervalDays - days;
        var last = s.PeriodicReviews.FirstOrDefault();
        var warned = last is { Verdict: "Fail" };

        if (due <= 0)
            return warned
                ? $"Your {IntervalDays}-day review is waiting at {TerminalLabel(s)}, and the last one did not go " +
                  "well. Report in when you are next there — this one decides where you stand."
                : $"Your {IntervalDays}-day review is waiting at {TerminalLabel(s)}. Report in when you are next " +
                  "there and we will go through the period.";

        if (due <= NoticeDays)
            return warned
                ? $"Review due in {due:0.#} days, and the last one was a fail. Next time you are at " +
                  $"{TerminalLabel(s)} after that we go through it, and it decides where you stand."
                : $"Review due in {due:0.#} days — we will go through the period next time you are at " +
                  $"{TerminalLabel(s)}. Nothing to prepare; it is a conversation about the work.";

        return null;
    }

    private static string TerminalLabel(AppState s) =>
        HomeTime.HomeTerminal(s) is { } t ? $"{t.City}, {t.State}" : "the yard";

    /// <summary>
    /// Files a review if one is due, called when the driver reports in at the yard.
    ///
    /// Returns null when nothing is due — which is most arrivals, and the reason this waits for them
    /// rather than summoning them.
    /// </summary>
    public static PeriodicReviewRecord? ReviewOnArrival(AppState s)
    {
        if (Probation.IsOn(s)) return null;
        if (s.Driver.Rank == "terminated") return null;

        var since = PeriodStart(s);
        var now = GameClock.TryParse(s.Status.GameTime);
        if (since == null || now == null) return null;

        var days = (now.Value - since.Value).TotalDays;
        if (days < IntervalDays) return null;
        if (days < MinimumDaysCovered) return null;

        var trips = s.Trips
            .Where(t => t.Status == "Delivered" && t.Kind == "Freight")
            .Where(t => GameClock.TryParse(t.DeliveredGameTime) is { } d && d > since.Value && d <= now.Value)
            .ToList();

        var onTime = trips.Count == 0 ? 0
            : trips.Count(t => t.ServiceResult == "OnTime") * 100.0 / trips.Count;

        // Only what actually counts. Non-preventable incidents are not the driver's to answer for, and
        // counting them here would undo the whole point of attributing fault in the first place.
        var faults = s.Incidents
            .Where(i => GameClock.TryParse(i.GameTime) is { } d && d > since.Value && d <= now.Value)
            .Where(i => i.FaultAttribution == "Driver" && i.Preventable)
            .ToList();

        var review = new PeriodicReviewRecord
        {
            Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-REV-{s.PeriodicReviews.Count + 1:0000}",
            GameTime = s.Status.GameTime,
            PeriodStartGameTime = GameClock.Format(since.Value),
            DaysCovered = Math.Round(days, 1),
            LoadsDelivered = trips.Count,
            OnTimePct = Math.Round(onTime, 1),
            PreventableFaults = faults.Count,
            ReviewNumber = s.PeriodicReviews.Count + 1
        };

        var forThem = new List<string>();
        var against = new List<string>();

        if (trips.Count == 0)
            against.Add($"Nothing delivered in {days:0} days. There is nothing here to assess.");
        else if (trips.Count < 8)
            against.Add($"{trips.Count} loads in {days:0} days. That is thin for two months.");
        else
            forThem.Add($"{trips.Count} loads delivered over {days:0} days.");

        if (trips.Count > 0)
        {
            if (onTime >= ExpectedOnTimePct) forThem.Add($"{onTime:0.#}% on time.");
            else if (onTime >= 70) against.Add($"{onTime:0.#}% on time, against the {ExpectedOnTimePct:0}% we expect.");
            else against.Add($"{onTime:0.#}% on time. That is not a near miss, that is a problem.");
        }

        if (faults.Count == 0) forThem.Add("Nothing preventable on the record this period.");
        else against.Add($"{faults.Count} preventable incident(s): {string.Join("; ", faults.Select(f => f.Kind))}.");

        // Equipment. This review looked at loads, service and faults and never once at what the driver
        // was doing to the truck, so a senior driver could beat a tractor to death with nothing said.
        var wear = WearReview.Assess(s, since.Value, now.Value, s.PeriodicReviews.FirstOrDefault()?.TruckDamagePct ?? -1);
        WearReview.Apply(wear, forThem, against);
        review.TruckDamagePct = wear.DamageNow;

        review.Strengths = forThem;
        review.Concerns = against;

        // ---- the verdict, and what it costs
        //
        // A bad review can end the job, but never out of nowhere: the previous one says plainly that the
        // next decides it. Two in a row is what does it.
        var previousWasFail = s.PeriodicReviews.FirstOrDefault() is { Verdict: "Fail" };
        var seriouslyBad = trips.Count == 0
                           || faults.Count >= 3
                           || (trips.Count > 0 && onTime < 70);
        var somethingWrong = against.Count > 0 && (faults.Count > 0 || onTime < ExpectedOnTimePct || trips.Count < 8);

        review.Verdict = somethingWrong ? "Fail" : "Pass";

        if (review.Verdict == "Pass")
        {
            review.Summary = $"Review {review.ReviewNumber}: satisfactory. {string.Join(" ", forThem)}";
            review.WhatNext = $"Nothing to do. Next one in about {IntervalDays} days.";
        }
        else if (previousWasFail && seriouslyBad)
        {
            review.Verdict = "Terminated";
            review.Summary = $"Review {review.ReviewNumber}: this is the second in a row and it is worse. " +
                             string.Join(" ", against);
            review.WhatNext = "We are letting you go. You were told last time that this one would decide it.";
            review.EndsEmployment = true;
        }
        else if (previousWasFail)
        {
            review.Summary = $"Review {review.ReviewNumber}: still not right. {string.Join(" ", against)}";
            review.WhatNext = "Final warning. The next review decides whether you stay, and I would rather " +
                              "not be having that conversation.";
            review.WarningIssued = "FinalWarning";
        }
        else if (seriouslyBad)
        {
            review.Summary = $"Review {review.ReviewNumber}: not good enough. {string.Join(" ", against)}";
            review.WhatNext = "Written warning. Put this right over the next period — the next review " +
                              "decides where you stand, and I am telling you that now so it is not a surprise.";
            review.WarningIssued = "WrittenWarning";
        }
        else
        {
            review.Summary = $"Review {review.ReviewNumber}: needs to come up. {string.Join(" ", against)}";
            review.WhatNext = $"Nothing formal. Get it right over the next {IntervalDays} days and this is " +
                              "the end of it; do not, and the next one carries a warning.";
        }

        s.PeriodicReviews.Insert(0, review);
        return review;
    }
}
