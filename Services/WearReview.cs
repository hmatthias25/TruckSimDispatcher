using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What the damage on a tractor says about the driver, at review time.
///
/// A review used to read <c>Status.TruckDamagePct</c> and hold the driver to the number, which cannot
/// tell a wreck from a wreck that was not theirs, and cannot see wear at all:
///
/// <list type="bullet">
///   <item>AI traffic puts eighteen points into the truck, Safety agrees it was not preventable — and the
///     review still opened with "brought the tractor back at 18% damage".</item>
///   <item>A driver who took a tractor from 2% to 24% over a period heard nothing, as long as they
///     finished under the line. One who inherited a unit at 14% heard about it every time while doing
///     nothing wrong.</item>
/// </list>
///
/// So this asks two questions instead of one. What was <b>reported</b>, and what is <b>left over</b>.
///
/// Reported damage is accounted for. Non-preventable incidents are noted as context and cost the driver
/// nothing; preventable ones already count once through the fault line, and counting their damage a
/// second time here would be trying the same offence twice.
///
/// Everything left over is wear, because wear generates no report — nothing happened, it is just miles.
/// It is judged as <b>damage per thousand miles driven</b> rather than as points on the clock, so the
/// same threshold governs a fortnightly probation review and a sixty-day periodic one, and a driver is
/// not punished for having run more.
/// </summary>
public static class WearReview
{
    /// <summary>
    /// Unexplained damage per 1,000 miles above which somebody is being hard on the equipment.
    ///
    /// Deliberately forgiving. Curbs, docks, gravel yards and other people's mirrors are the job, and a
    /// review that comments on ordinary miles teaches the driver to skim past the ones that matter.
    /// </summary>
    public const double HeavyPer1000 = 2.5;

    /// <summary>
    /// Miles below which no rate is worth computing. A handful of points over three hundred miles is a
    /// dock scrape, not a pattern, and dividing by it produces an alarming number from nothing.
    /// </summary>
    public const double MinimumMilesToJudge = 1000;

    /// <summary>
    /// Unexplained points below which nothing is said whatever the rate. Keeps a trivial pickup on a
    /// short period from reading as an equipment problem.
    /// </summary>
    public const double MinimumPointsToMention = 5;

    /// <summary>What the damage on the truck came to, and whose doing it was.</summary>
    public sealed class Assessment
    {
        /// <summary>Damage on the tractor as this review found it.</summary>
        public double DamageNow { get; set; }
        /// <summary>Damage the last review recorded, or -1 where there is nothing to measure from.</summary>
        public double DamageThen { get; set; } = -1;
        /// <summary>True on the first review after this started being recorded — no delta exists yet.</summary>
        public bool NoBaseline => DamageThen < 0;

        /// <summary>Points accounted for by incidents the driver actually reported.</summary>
        public double ExplainedPoints { get; set; }
        /// <summary>Points nobody reported: wear.</summary>
        public double WearPoints { get; set; }
        public double MilesDriven { get; set; }
        /// <summary>Wear per 1,000 miles, or -1 where there were too few miles to judge.</summary>
        public double WearPer1000 { get; set; } = -1;
        public bool Heavy { get; set; }

        /// <summary>Goes in Concerns. Empty when there is nothing to say.</summary>
        public string Concern { get; set; } = "";
        /// <summary>Goes in Strengths, or in Concerns as context. Empty when there is nothing to say.</summary>
        public string Note { get; set; } = "";
    }

    /// <summary>
    /// Reads the period and works out what the damage means.
    /// </summary>
    /// <param name="damageThen">
    /// What the previous review recorded, or -1 when there is none — the first review of a career, and
    /// every career that predates this being kept.
    ///
    /// Wear does not depend on it. That is deliberate: the rises come off the trips themselves, so a
    /// missing baseline costs nothing and no migration is needed. It is used only to notice that the
    /// truck ended the period in better shape than it started, which genuinely does need two endpoints.
    /// </param>
    public static Assessment Assess(AppState s, DateTime since, DateTime now, double damageThen)
    {
        var a = new Assessment
        {
            DamageNow = Math.Max(0, s.Status.TruckDamagePct),
            DamageThen = damageThen,
        };

        var trips = s.Trips
            .Where(t => t.Kind == "Freight" && t.Status == "Delivered")
            .Where(t => GameClock.TryParse(t.DeliveredGameTime) is { } d && d > since && d <= now)
            .ToList();
        a.MilesDriven = Math.Round(trips.Sum(t => t.DispatchedMiles + t.DeadheadMiles), 0);

        var reported = s.Incidents
            .Where(i => GameClock.TryParse(i.GameTime) is { } d && d > since && d <= now)
            .Where(i => i.TruckDamagePctAfter >= 0)
            .ToList();

        // Non-preventable damage is context on the review and costs nothing. Named, because "we know
        // about that one" is the entire point of having filed it.
        var notMine = reported.Where(i => !i.Preventable && i.FaultAttribution != "Driver").ToList();
        if (notMine.Count > 0)
            a.Note = $"{notMine.Count} reported incident(s) not down to the driver — " +
                     $"{string.Join("; ", notMine.Select(i => $"{i.Kind.ToLowerInvariant()}, {i.FaultAttribution.ToLowerInvariant()}"))}. " +
                     "The damage from those is on the record and not held against them.";

        // What each load put on the truck, from the readings the driver gave at the time.
        //
        // NOT "damage now minus damage at the last review". That looks right and loses almost everything:
        // dispatch stops at 10%, so the driver repairs mid-period, and a driver who went 0->10, fixed it,
        // and went 0->10 again reads as zero wear. The rises survive the repairs because each one was
        // recorded before the shop touched it.
        var rises = trips
            .Select(t => Math.Round(Math.Max(0, t.TruckDamageAfter - t.TruckDamageBefore), 1))
            .Where(r => r > 0)
            .OrderByDescending(r => r)
            .ToList();
        var gross = rises.Sum();

        // A reported incident claims the biggest rise still going, because that is the shape of one: a
        // collision is a single jump, not a drift. Preventable ones claim a rise too — those are already
        // paid for through the fault line, and charging their damage again here is the same offence
        // twice.
        a.ExplainedPoints = Math.Round(rises.Take(reported.Count).Sum(), 1);
        a.WearPoints = Math.Round(Math.Max(0, gross - a.ExplainedPoints), 1);

        // Ending lower than they started means somebody put it through a shop, which is the thing the
        // company wants and is worth saying. Needs the baseline, so it waits for one.
        if (!a.NoBaseline && a.DamageNow - a.DamageThen < -1 && string.IsNullOrEmpty(a.Note))
            a.Note = $"Tractor came back better than it went out — {a.DamageThen:0.#}% down to {a.DamageNow:0.#}%. " +
                     "Somebody put it through a shop.";

        if (a.MilesDriven < MinimumMilesToJudge) return a;

        a.WearPer1000 = Math.Round(a.WearPoints / (a.MilesDriven / 1000), 2);
        a.Heavy = a.WearPer1000 > HeavyPer1000 && a.WearPoints >= MinimumPointsToMention;

        if (a.Heavy)
            a.Concern = $"{a.WearPoints:0.#} points of damage on the tractor that nothing explains, over " +
                        $"{a.MilesDriven:N0} miles — {a.WearPer1000:0.0}% per thousand against the " +
                        $"{HeavyPer1000:0.0} we expect. Nothing was reported, so this is wear. " +
                        "Ease up on the equipment: docks, curbs and trailers do not have to cost this much.";

        return a;
    }

    /// <summary>
    /// Puts the assessment onto a review's two lists.
    ///
    /// Reasonable wear says nothing at all, which is the rule this exists to keep: a review that
    /// remarks on normal miles is noise, and noise is how the lines that matter get skimmed.
    /// </summary>
    public static void Apply(Assessment a, List<string> strengths, List<string> concerns)
    {
        if (!string.IsNullOrEmpty(a.Concern)) concerns.Add(a.Concern);
        if (string.IsNullOrEmpty(a.Note)) return;

        // Context on a bad period belongs beside the bad news; on a good one it is a point in their
        // favour, because reporting something that was not your fault is the driver doing it right.
        if (!string.IsNullOrEmpty(a.Concern)) concerns.Add(a.Note);
        else strengths.Add(a.Note);
    }
}
