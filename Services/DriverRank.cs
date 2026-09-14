using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What a hired driver's level is called.
///
/// <para>ATS gives a hired driver an open-ended level and no word for it, so the fleet table showed a bare
/// integer while the player got a named ladder to climb. The number was never decorative — wages come off
/// it (<see cref="DriverConduct.ShareForLevel"/>), so do the odds of them hitting something
/// (<see cref="DriverConduct.IncidentPercentFor"/>), and <see cref="CompanyHealth.HiringBandFor"/> sends
/// the player out to hire at one. It was simply never said out loud.</para>
///
/// <para><b>The same names the player climbs</b>, from <c>CareerService</c>'s ladder. A carrier does not run
/// one vocabulary for the driver in the seat and another for everybody else on the yard, and two ladders
/// with different words is how a level 6 reads as senior on one screen and as nothing on the next.</para>
///
/// <para><b>Banded on the boundaries that already exist.</b> The rungs break where
/// <see cref="DriverConduct.IncidentPercentFor"/> breaks — 1-2, 3-4, 5-6, 7-8, 9 and up — so the rank a
/// driver is called and the risk the company carries on them can never tell different stories. The one
/// extra line is inside that top band: Specialist and Master share the same odds, because past level 9 the
/// game stops making them measurably safer and only the seniority keeps climbing.</para>
/// </summary>
public static class DriverRank
{
    /// <summary>
    /// The rank a level earns, or empty when the level has never been reported.
    ///
    /// Level 0 is not a rookie, it is a blank — a driver the player has added but not yet filed figures
    /// for. Calling that "probationary" would be the app inventing a reading, which is the one thing it
    /// does not do. It says nothing until the game has told it something.
    /// </summary>
    public static string For(int level) => level switch
    {
        <= 0 => "",
        1 or 2 => "Probationary Company Driver",
        3 or 4 => "Company Driver",
        5 or 6 => "Senior Company Driver",
        7 or 8 => "Lead Driver",
        9 or 10 => "Specialist Driver",
        _ => "Master Driver",
    };

    /// <summary>The same rung with the "Company Driver" tail dropped, for a table column.</summary>
    public static string Short(int level) => level switch
    {
        <= 0 => "",
        1 or 2 => "Probationary",
        3 or 4 => "Company",
        5 or 6 => "Senior",
        7 or 8 => "Lead",
        9 or 10 => "Specialist",
        _ => "Master",
    };

    /// <summary>
    /// The level at which the next rung starts, or null at the top.
    ///
    /// So a driver's line can say what they are working toward rather than only what they are, which is
    /// the difference between a label and a ladder.
    /// </summary>
    public static int? NextAt(int level) => level switch
    {
        <= 0 => null,      // nothing reported: there is no "next" to point at
        1 or 2 => 3,
        3 or 4 => 5,
        5 or 6 => 7,
        7 or 8 => 9,
        9 or 10 => 11,
        _ => null,
    };

    /// <summary>
    /// A one-line description of where a driver stands, for the detail view.
    ///
    /// Deliberately mentions the pay, because the pay IS the rank as far as the company is concerned —
    /// a rung that changed nothing would be a badge rather than a ladder.
    /// </summary>
    public static string Summary(HiredDriver d)
    {
        if (d.Level <= 0)
            return "No level reported yet. File a fleet report with the figures off the ATS company " +
                   "screen and the company can place them.";

        var rank = For(d.Level);
        var share = $"{d.WageShare * 100:0}% of what they bring in";
        var next = NextAt(d.Level);
        var climb = next.HasValue
            ? $" Level {next.Value} makes them {For(next.Value).ToLowerInvariant()}."
            : " Top of the company scale.";

        return $"Level {d.Level} — {rank}, on {share}.{climb}";
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

    /// <summary>How many of those were their fault.</summary>
    public static int PreventablesFor(AppState s, HiredDriver d) =>
        ConductFor(s, d).Count(x => IsPreventable(x.Line.Severity));

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
        return new
        {
            id = d.Id,
            rank = For(d.Level),
            rankShort = Short(d.Level),
            nextAt = NextAt(d.Level),
            summary = Summary(d),
            incidents = conduct.Count,
            preventables = conduct.Count(x => IsPreventable(x.Line.Severity)),
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
