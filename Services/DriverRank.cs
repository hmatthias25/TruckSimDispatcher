using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What a hired driver has earned at this company, as opposed to what ATS says they are.
///
/// <para><b>Level is not seniority, but it is a gate.</b> The first cut of this read the grade straight
/// off the ATS level, which was wrong for the reason any fleet manager would give: an AI driver climbs
/// levels fast, on nothing but miles turned. A fortnight of good running can move somebody two levels,
/// and calling that a promotion to Senior Company Driver makes the ladder meaningless — everybody is
/// senior by the end of the quarter and there is nothing left to earn.</para>
///
/// <para>So level is one gate of four and never the whole answer, and the thresholds are deliberately
/// low against the tenure ones: anybody who has served the days has almost certainly passed them. What
/// it catches is the other case — somebody who has been on the books three months and has not moved
/// off level 1 has not actually done very much, and the days alone should not promote them. Pay remains
/// a property of the rung: two drivers on the same rung are paid the same whatever their levels.</para>
///
/// <para>It took this job over from the driver's <b>rating</b>, which had no business holding it. Rating
/// in ATS is derived purely from how the skill points have been spent — SCS's own reference says it has
/// "nothing to do with any other aspect or talent of a Driver, like his/her good, efficient or
/// penalty-free driving" — so it described the player's training policy rather than the driver, and
/// gating a pay rise on it let the player grant one. It is not a continuous scale either: thirteen
/// values exist, and the old gates of 6.0, 7.0, 8.0, 8.5 and 9.0 were none of them, so each silently
/// became the next reachable one and Specialist and Master ended up sharing a bar.</para>
///
/// <para><b>Earned the way the player's is.</b> Time served, distance covered, the level the game has
/// them on, and a clean recent record. All four, not the best of them: the rung is the highest one whose
/// every gate is met, so a driver with the miles but not the months waits, and so does one with the
/// months and two preventables behind them.</para>
///
/// <para><b>Everybody starts on probation.</b> Ninety days from the day they were hired, the same period
/// the player serves, and no rung above the bottom one opens until it is behind them. A carrier that
/// promotes somebody in their first month is not one that was watching.</para>
///
/// <para>The mileage gates are the player's own, from <c>CareerService</c>'s ladder. One ladder, one set
/// of numbers: a company that asked more of its hired drivers than of the driver reading this would be
/// telling two stories about the same job.</para>
/// </summary>
public static class DriverRank
{
    /// <summary>
    /// The probationary period every new hire serves, in game days.
    ///
    /// Ninety, because that is what the player serves and there is no argument for a different number.
    /// Nothing above the bottom rung opens while it is running, whatever the figures say.
    /// </summary>
    public const int ProbationDays = 90;

    /// <summary>
    /// How far back a preventable counts against a promotion.
    ///
    /// Twelve reports, about six months. The record keeps everything for ever — the driver's file lists
    /// it all — but a bar that never lifts is not discipline, it is a life sentence, and the rest of this
    /// app is built on clean work walking a mistake off.
    /// </summary>
    public const int PreventableWindowReports = 12;

    /// <summary>One rung, and everything that has to be true to stand on it.</summary>
    public sealed record Rung(
        int Index,
        string Name,
        string Short,
        /// <summary>Game days since they were hired.</summary>
        int Days,
        /// <summary>Lifetime miles, from the odometers reported on them.</summary>
        double Miles,
        /// <summary>
        /// The level ATS has them on — a plain integer off the driver manager.
        ///
        /// <para>This gate used to be the driver's <b>rating</b>, and that was wrong twice over. Rating
        /// in ATS is derived purely from how the skill points have been spent — SCS's own reference says
        /// it has "nothing to do with any other aspect or talent of a Driver, like his/her good,
        /// efficient or penalty-free driving" — so it measures the player's training policy rather than
        /// anything the driver did. Gating a pay rise on it meant the player could grant themselves
        /// one.</para>
        ///
        /// <para>And it is not a continuous 0-10 scale. Rating only ever takes thirteen values: 0.0,
        /// 0.8, 1.7, 2.5, 3.3, 4.2, 5.0, 5.8, 6.7, 7.5, 8.3, 9.2, 10.0. The old gates of 6.0, 7.0, 8.0,
        /// 8.5 and 9.0 were none of them reachable, so each silently became the next real value up — and
        /// 8.5 and 9.0 both became 9.2, which made Specialist and Master the same gate. Drivers sat
        /// stuck against a bar that was not the one written down.</para>
        /// </summary>
        int Level,
        /// <summary>Preventables inside <see cref="PreventableWindowReports"/> they may carry.</summary>
        int Preventables,
        /// <summary>Share of what they bring in that this rung is paid.</summary>
        double Share);

    /// <summary>
    /// The ladder. Days are multiples of the probation they all serve; miles are the player's own gates.
    ///
    /// Master is a long way up on purpose. At a carrier worth working for the churn is low enough that
    /// somebody gets there; at a middling one they are poached long before, which is the point being
    /// made — you keep a Master Driver by being worth staying with, not by waiting.
    /// </summary>
    public static readonly Rung[] Ladder =
    {
        new(0, "Probationary Company Driver", "Probationary",      0,       0,  0, 99, 0.25),
        new(1, "Company Driver",              "Company",          90,   6_000,  3,  3, 0.28),
        new(2, "Senior Company Driver",       "Senior",          270,  30_000,  8,  3, 0.31),
        new(3, "Lead Driver",                 "Lead",            540,  65_000, 14,  2, 0.34),
        new(4, "Specialist Driver",           "Specialist",      900, 120_000, 22,  1, 0.37),
        new(5, "Master Driver",               "Master",        1_350, 220_000, 30,  1, 0.40),
    };

    /// <summary>
    /// Game days since they were hired, or 0 when the hire date is unknown.
    ///
    /// Measured to the latest moment the app actually knows about — the driver's own clock, or the end
    /// of the most recent fleet report, whichever is further on. A player who runs the office without
    /// driving much still moves time forward by filing reports, and tenure that only counted the
    /// player's own clock would have left their fleet permanently on probation.
    /// </summary>
    public static int TenureDays(AppState s, HiredDriver d)
    {
        var from = GameClock.DayOf(d.HiredGameDate);
        if (from is null) return 0;

        var now = GameClock.DayOf(s.Status.GameTime);
        var lastReport = s.FleetReports.Count > 0 ? GameClock.DayOf(s.FleetReports[0].PeriodEndGame) : null;
        var to = Math.Max(now ?? 0, lastReport ?? 0);
        return Math.Max(0, to - from.Value);
    }

    /// <summary>Whether they are still inside the ninety days every hire serves.</summary>
    public static bool ServingProbation(AppState s, HiredDriver d) =>
        d.Status == "Active" && TenureDays(s, d) < ProbationDays;

    /// <summary>Days left of it, or 0.</summary>
    public static int ProbationDaysLeft(AppState s, HiredDriver d) =>
        Math.Max(0, ProbationDays - TenureDays(s, d));

    /// <summary>
    /// The rung their record earns them right now.
    ///
    /// Walked from the top down so the answer is the best rung they fully qualify for, and never a
    /// half-met one. A driver on disciplinary probation is held where they are: you do not promote
    /// somebody in the same fortnight you told them to sort themselves out.
    /// </summary>
    public static Rung Earned(AppState s, HiredDriver d)
    {
        if (ServingProbation(s, d)) return Ladder[0];

        var held = d.OnProbation ? Ladder[Math.Clamp(d.Grade, 0, Ladder.Length - 1)] : null;
        if (held != null) return held;

        var days = TenureDays(s, d);
        var recent = RecentPreventables(s, d);
        for (var i = Ladder.Length - 1; i >= 0; i--)
        {
            var r = Ladder[i];
            if (days >= r.Days && d.LifetimeMiles >= r.Miles
                && d.Level >= r.Level && recent <= r.Preventables)
                return r;
        }
        return Ladder[0];
    }

    /// <summary>The rung above, or null at the top.</summary>
    public static Rung? Next(Rung r) => r.Index + 1 < Ladder.Length ? Ladder[r.Index + 1] : null;

    /// <summary>
    /// What is actually standing between them and the next rung, in the order a person would say it.
    ///
    /// Only what they have not met. Listing gates they cleared months ago would bury the one that
    /// matters, and the one that matters is the whole reason to look.
    /// </summary>
    public static List<string> Shortfall(AppState s, HiredDriver d)
    {
        var gaps = new List<string>();
        if (ServingProbation(s, d))
        {
            gaps.Add($"{ProbationDaysLeft(s, d)} day(s) of their probation left.");
            return gaps;
        }
        if (d.OnProbation)
        {
            gaps.Add("On probation. Nothing moves until that is behind them.");
            return gaps;
        }

        // Measured from the rung they are ON, not the one they have earned. Those differ for exactly as
        // long as it takes the next report to settle it, and reading from the earned rung made the file
        // answer the wrong question in that gap: a driver who had just cleared their ninety days was
        // shown what still stood between them and SENIOR, which is two rungs of bad news for somebody
        // whose promotion was already due.
        var next = Next(At(d.Grade));
        if (next == null) return gaps;
        if (Earned(s, d).Index >= next.Index) return gaps;   // already qualified; it lands next report

        var days = TenureDays(s, d);
        if (days < next.Days) gaps.Add($"{next.Days - days} more day(s) with us.");
        if (d.LifetimeMiles < next.Miles) gaps.Add($"{next.Miles - d.LifetimeMiles:N0} more mile(s).");
        if (d.Level < next.Level) gaps.Add($"Level {d.Level}, wants {next.Level}.");
        var recent = RecentPreventables(s, d);
        if (recent > next.Preventables)
            gaps.Add($"{recent} preventable(s) in the last {PreventableWindowReports} reports; " +
                     $"{next.Name} takes {next.Preventables}. They age off.");
        return gaps;
    }

    /// <summary>
    /// What this driver is paid, by the rung they stand on.
    ///
    /// Off the grade rather than the ATS level, which was the same mistake in a different place: pay
    /// that followed a level would inflate as fast as the level climbs, and the company would be giving
    /// rises for a fortnight of good miles. A quarter of the load at the bottom, two fifths at the top.
    /// </summary>
    public static double ShareForGrade(int grade) =>
        Ladder[Math.Clamp(grade, 0, Ladder.Length - 1)].Share;

    /// <summary>The rung a stored grade index names.</summary>
    public static Rung At(int grade) => Ladder[Math.Clamp(grade, 0, Ladder.Length - 1)];

    /// <summary>
    /// Bring a driver onto the grade their record earns, and onto the pay that goes with it.
    ///
    /// Returns the rung they moved to, or null if nothing changed. <b>A grade is never taken away by
    /// time</b> — only by a gate they have stopped meeting, and the only one that can go backwards is
    /// the preventable count. That is deliberate: a mistake should cost a rung and not a career, and it
    /// comes back the moment the preventables age off.
    /// </summary>
    public static Rung? Settle(AppState s, HiredDriver d)
    {
        var earned = Earned(s, d);
        var was = d.Grade;
        d.Grade = earned.Index;
        if (!d.WageShareSetByHand) d.WageShare = earned.Share;
        return earned.Index == was ? null : earned;
    }

    /// <summary>
    /// A one-line reading of where they stand, for their file.
    /// </summary>
    public static string Summary(AppState s, HiredDriver d)
    {
        var r = At(d.Grade);
        var share = $"{d.WageShare * 100:0}% of what they bring in";

        if (ServingProbation(s, d))
            return $"On their ninety days — {ProbationDaysLeft(s, d)} to go. Paid {share} until they " +
                   "are through it.";

        // Between clearing a gate and the report that settles it. Worth saying out loud: the roster
        // still shows the old rung and nothing else on screen explains why.
        var earned = Earned(s, d);
        if (earned.Index > d.Grade)
            return $"{r.Name} on {share}, and due {earned.Name} at the next fleet report — " +
                   $"{TenureDays(s, d)} day(s) with us, {d.LifetimeMiles:N0} mi, level {d.Level}. " +
                   $"It takes a report to settle it.";

        var next = Next(r);
        return next == null
            ? $"{r.Name}, on {share}. Top of the company scale."
            : $"{r.Name}, on {share}. {next.Name} pays {next.Share * 100:0}%.";
    }

    /// <summary>
    /// Whether a severity is something the driver is answerable for.
    ///
    /// Not-at-fault incidents still cost the company a tractor and still belong on the record, but they
    /// are not preventables and a driver is never counted for them. A carrier that tallies people for
    /// being rear-ended loses the ones worth keeping.
    /// </summary>
    public static bool IsPreventable(string severity) =>
        !string.IsNullOrWhiteSpace(severity)
        && !severity.StartsWith("NotAtFault", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Every conduct line on record for one driver, newest report first.
    ///
    /// Read out of the reports rather than kept as a second copy on the driver. The reports are where it
    /// happened and they are already persisted; a running total on the driver would be a second place
    /// deciding the same thing, and the two would drift the first time a report was filed twice.
    /// </summary>
    public static List<(FleetReport Report, DriverConductLine Line)> ConductFor(AppState s, HiredDriver d) =>
        s.FleetReports
            .SelectMany(r => r.Conduct
                .Where(c => Matches(c, d))
                .Select(c => (Report: r, Line: c)))
            .Reverse()
            .ToList();

    /// <summary>How many of those were their fault, over the whole record.</summary>
    public static int PreventablesFor(AppState s, HiredDriver d) =>
        ConductFor(s, d).Count(x => IsPreventable(x.Line.Severity));

    /// <summary>
    /// How many were their fault inside the promotion window.
    ///
    /// Counted against the reports themselves rather than a date, because the window is expressed in
    /// reports and the two would disagree the moment a career ran at a different reporting interval.
    /// </summary>
    public static int RecentPreventables(AppState s, HiredDriver d)
    {
        var recent = s.FleetReports
            .Select(r => r.Number)
            .Reverse()
            .Take(PreventableWindowReports)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return ConductFor(s, d).Count(x =>
            IsPreventable(x.Line.Severity) && recent.Contains(x.Report.Number));
    }

    /// <summary>
    /// Everything about a driver that is worked out rather than stored.
    ///
    /// Sent alongside the roster rather than folded into it. The driver rows are the model as saved, and
    /// a screen that cannot tell what was reported from what was inferred is how a derived figure ends up
    /// being treated as a reading off the game.
    /// </summary>
    public static object Dossier(AppState s, HiredDriver d)
    {
        var conduct = ConductFor(s, d);
        var r = At(d.Grade);
        var next = Next(r);
        var earned = Earned(s, d);
        return new
        {
            id = d.Id,
            grade = d.Grade,
            rank = r.Name,
            rankShort = r.Short,
            offeredShare = r.Share,
            // Earned but not yet settled. A grade only moves when a fleet report is filed, so a driver
            // can stand here having met everything and still read as the rung below until the next one.
            duePromotion = earned.Index > d.Grade,
            dueRank = earned.Index > d.Grade ? earned.Name : null,
            nextRank = next?.Name,
            nextShare = next?.Share,
            summary = Summary(s, d),
            shortfall = Shortfall(s, d),
            tenureDays = TenureDays(s, d),
            servingProbation = ServingProbation(s, d),
            probationDaysLeft = ProbationDaysLeft(s, d),
            incidents = conduct.Count,
            preventables = conduct.Count(x => IsPreventable(x.Line.Severity)),
            recentPreventables = RecentPreventables(s, d),
            conduct = conduct.Select(x => new
            {
                reportNumber = string.IsNullOrWhiteSpace(x.Line.ReportNumber) ? x.Report.Number : x.Line.ReportNumber,
                gameTime = string.IsNullOrWhiteSpace(x.Line.GameTime) ? x.Report.PeriodEndGame : x.Line.GameTime,
                severity = x.Line.Severity,
                outcome = x.Line.Outcome,
                truckUnit = x.Line.TruckUnit,
                damagePct = x.Line.DamagePct,
                preventable = IsPreventable(x.Line.Severity),
            }).ToList(),
        };
    }

    /// <summary>
    /// Whether a stored line belongs to this driver.
    ///
    /// By id where there is one. Lines written before the id was recorded only carry a name, and a
    /// migration backfills what it can — but a driver hired after a namesake left cannot be told apart
    /// from them on a name alone, so the id is what this leans on wherever it exists.
    /// </summary>
    private static bool Matches(DriverConductLine c, HiredDriver d) =>
        !string.IsNullOrWhiteSpace(c.DriverId)
            ? c.DriverId == d.Id
            : !string.IsNullOrWhiteSpace(c.DriverName)
              && c.DriverName.Equals(d.Name, StringComparison.OrdinalIgnoreCase);
}
