using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The way back for a driver who was let go.
///
/// A career should survive one bad stretch and not two. Being fired for the work puts the driver in
/// front of second-chance carriers only; running clean for one of them for long enough puts the
/// ordinary market back within reach. Failing there ends the career, and that is the whole tension —
/// the second chance is real, and it is the last one.
/// </summary>
public static class Redemption
{
    /// <summary>Clean game days at a second-chance carrier before other carriers will look again.</summary>
    public const int DaysRequired = 90;

    /// <summary>And loads, so time alone parked somewhere is not a career recovery.</summary>
    public const int LoadsRequired = 40;

    /// <summary>On-time percentage expected over the stint.</summary>
    public const double OnTimeRequired = 85;

    /// <summary>Where the clean run is measured from: the day the second-chance stint began.</summary>
    private static DateTime? StintStart(AppState s) =>
        GameClock.TryParse(s.Driver.HiredGameDate)
        ?? GameClock.TryParse(s.Driver.TerminatedGameTime);

    /// <summary>Progress toward the ordinary market, or null when this does not apply.</summary>
    public class Progress
    {
        public bool Applies { get; set; }
        public double Days { get; set; }
        public int Loads { get; set; }
        public double OnTimePct { get; set; }
        public int Preventables { get; set; }
        public bool Earned { get; set; }
        public string Summary { get; set; } = "";
        public List<string> Outstanding { get; set; } = new();
    }

    public static Progress Assess(AppState s)
    {
        var p = new Progress();
        if (!Carriers.NeedsSecondChance(s)) return p;
        if (!Carriers.IsSecondChance(s.Company.Code))
        {
            p.Summary = "You are not running for a second-chance carrier, so there is nothing to prove yet. " +
                        "Take a job with one of the outfits that will have you and start the run.";
            p.Applies = true;
            return p;
        }

        p.Applies = true;
        var since = StintStart(s);
        var now = GameClock.TryParse(s.Status.GameTime);
        if (since == null || now == null)
        {
            p.Summary = "No start date on this stint yet — report your position and I can start counting.";
            return p;
        }

        p.Days = Math.Round((now.Value - since.Value).TotalDays, 1);

        var trips = s.Trips
            .Where(t => t.Status == "Delivered" && t.Kind == "Freight")
            .Where(t => GameClock.TryParse(t.DeliveredGameTime) is { } d && d >= since.Value)
            .ToList();
        p.Loads = trips.Count;
        p.OnTimePct = trips.Count == 0 ? 0
            : Math.Round(trips.Count(t => t.ServiceResult == "OnTime") * 100.0 / trips.Count, 1);

        // Only what the driver is actually answerable for. Counting the rest would make redemption
        // impossible for reasons outside their hands, which is not a second chance at all.
        p.Preventables = s.Incidents
            .Where(i => GameClock.TryParse(i.GameTime) is { } d && d >= since.Value)
            .Count(i => i.FaultAttribution == "Driver" && i.Preventable);

        if (p.Days < DaysRequired)
            p.Outstanding.Add($"{DaysRequired - p.Days:0.#} more days ({p.Days:0.#} of {DaysRequired})");
        if (p.Loads < LoadsRequired)
            p.Outstanding.Add($"{LoadsRequired - p.Loads} more loads ({p.Loads} of {LoadsRequired})");
        if (trips.Count > 0 && p.OnTimePct < OnTimeRequired)
            p.Outstanding.Add($"on-time up to {OnTimeRequired:0}% (currently {p.OnTimePct:0.#}%)");
        if (p.Preventables > 0)
            p.Outstanding.Add($"{p.Preventables} preventable incident(s) on this stint — that resets nothing, " +
                              "but carriers will read it");

        p.Earned = p.Days >= DaysRequired
                   && p.Loads >= LoadsRequired
                   && p.OnTimePct >= OnTimeRequired
                   && p.Preventables == 0;

        p.Summary = p.Earned
            ? $"{p.Days:0} days, {p.Loads} loads, {p.OnTimePct:0.#}% on time and nothing preventable. That is " +
              "the run. Other carriers will take an application from you again — you have earned it back."
            : $"{p.Days:0} of {DaysRequired} days and {p.Loads} of {LoadsRequired} loads at " +
              $"{p.OnTimePct:0.#}% on time. Still to do: {string.Join("; ", p.Outstanding)}.";

        return p;
    }

    /// <summary>
    /// Marks the driver redeemed once the run is there. Called where the clock advances, so it happens
    /// on its own rather than being something to remember to claim.
    /// </summary>
    public static string? CheckEarned(AppState s)
    {
        if (!Carriers.NeedsSecondChance(s)) return null;
        var p = Assess(s);
        if (!p.Earned) return null;

        s.Driver.RedeemedGameTime = s.Status.GameTime;
        return $"Redeemed. {p.Summary}";
    }

    /// <summary>
    /// Ends the career. A driver let go by a second-chance carrier has nowhere left to go, and saying so
    /// plainly is better than leaving them applying to a market that will not answer.
    /// </summary>
    public static bool NowhereLeft(AppState s) =>
        s.Driver.TerminatedForCause
        && string.IsNullOrWhiteSpace(s.Driver.RedeemedGameTime)
        && Carriers.IsSecondChance(s.Company.Code)
        && s.Driver.Rank == "terminated";
}
