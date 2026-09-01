using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What makes one tractor better than another, in one place.
///
/// There were four answers to this and they disagreed with each other:
/// <list type="bullet">
///   <item><c>ConsiderSeatVacated</c>: newer year OR under 60% of the miles.</item>
///   <item><c>IssueUpgrade</c>: newer year OR fewer miles, by any margin at all.</item>
///   <item>The arrival brief: <b>newer year only</b> — mileage not consulted.</item>
///   <item><c>OpenUnitDecisions</c>: newer year OR under 60% of the miles.</item>
/// </list>
///
/// Under three of those a 2019 tractor with 900,000 miles beat a 2018 with 120,000, and the arrival
/// brief would tell a driver to put in for it. That is not an upgrade, it is a worse truck with a
/// newer plate, and the driver would have found that out the first time they climbed into it.
///
/// So: one score, and everything asks this. Five things go into it, and the order matters.
///
/// <b>Mileage</b> carries the most, because it is what is actually left in the unit. <b>The model</b>
/// comes next — a new Volvo is a better truck than a tired Freightliner even with more miles on it,
/// and ATS's line-up really does range from flagship long-haul down to a day cab nobody wants to
/// live in. <b>Year</b> separates two of the same model. <b>Damage</b> stops a wrecked unit reading
/// as an upgrade. <b>Spec</b> is the smallest term: horsepower, a bunk, and whether the gearbox is
/// the one the driver asked for.
///
/// A candidate has to clear the current unit by a real margin. Half a point is not a reason to move
/// a driver across the country, and an upgrade offer nobody understands is worse than none.
/// </summary>
public static class TruckGrade
{
    /// <summary>Points a candidate must beat the current unit by before it counts as an upgrade.</summary>
    public const double UpgradeMargin = 6.0;

    /// <summary>Miles at which a tractor is treated as having nothing left to give, for scoring.</summary>
    public const double WornOutMiles = 1_200_000;

    /// <summary>
    /// Where each model sits in ATS's own range: 3 flagship, 2 standard long-haul, 1 vocational or
    /// regional. Judged on what the game actually sells, not on brand loyalty.
    ///
    /// Unknown models score 2. A mod truck is not a worse truck for being a mod truck, and defaulting
    /// low would quietly tell everyone running one that their tractor is junk.
    /// </summary>
    private static readonly (string Make, string Model, int Grade)[] Lineup =
    {
        // Flagships — the ones a driver puts in for by name.
        ("Peterbilt",    "389",      3),
        ("Peterbilt",    "579",      3),
        ("Peterbilt",    "589",      3),
        ("Kenworth",     "W900",     3),
        ("Kenworth",     "W990",     3),
        ("International","LoneStar", 3),
        ("Western Star", "49X",      3),
        ("Western Star", "57X",      3),

        // The long-haul workhorses. Nothing wrong with any of them.
        ("Freightliner", "Cascadia", 2),
        ("Freightliner", "eCascadia",2),
        ("Kenworth",     "T680",     2),
        ("Volvo",        "VNL",      2),
        ("Mack",         "Anthem",   2),
        ("Mack",         "Pioneer",  2),
        ("International","LT",       2),
        ("International","9900i",    2),
        ("Western Star", "5700XE",   2),

        // Vocational and regional: day cabs and site trucks. Fine for what they are, not a long-haul seat.
        ("Mack",         "Pinnacle", 1),
        ("International","HX",       1),
        ("Western Star", "4900",     1),
        ("Volvo",        "VNR",      1),
    };

    /// <summary>Where a model sits in the range. 2 when we do not recognise it.</summary>
    public static int GradeOf(string? make, string? model)
    {
        var mk = (make ?? "").Trim();
        var md = (model ?? "").Trim();
        if (md.Length == 0) return 2;

        foreach (var (lmk, lmd, grade) in Lineup)
            if (md.StartsWith(lmd, StringComparison.OrdinalIgnoreCase)
                && (mk.Length == 0 || mk.Equals(lmk, StringComparison.OrdinalIgnoreCase)))
                return grade;

        // Model matched nothing with its make attached — try the model alone, since a career can carry
        // "Cascadia" under a mod's renamed manufacturer.
        foreach (var (_, lmd, grade) in Lineup)
            if (md.StartsWith(lmd, StringComparison.OrdinalIgnoreCase))
                return grade;

        return 2;
    }

    /// <summary>How good a tractor is, all in. Higher is better; roughly 0-100.</summary>
    public static double Score(AppState s, Truck t)
    {
        // ---- what is left in it. The company's books, not the game reading: ServiceMiles is the
        // figure every other decision uses and the only one that survives a unit being replaced in ATS.
        var miles = Math.Max(0, t.ServiceMiles);
        var life = Math.Clamp(1.0 - miles / WornOutMiles, 0, 1);
        var score = life * 45.0;

        // ---- the model. A flagship is worth real points over a day cab.
        score += (GradeOf(t.Make, t.Model) - 1) * 11.0;

        // ---- the year, against the fleet's own newest so it does not drift with the calendar.
        var newest = s.Trucks.Where(x => !x.Retired && x.Year > 0)
            .Select(x => x.Year).DefaultIfEmpty(t.Year).Max();
        if (t.Year > 0 && newest > 0)
            score += Math.Clamp(1.0 - (newest - t.Year) / 12.0, 0, 1) * 16.0;

        // ---- condition. Only meaningful on a unit ATS actually reports; a backdrop unit is not
        // penalised for a damage figure the game never gave us.
        if (t.InGameGarage)
            score -= Math.Clamp(t.DamagePct, 0, 100) * 0.18;

        // ---- spec, the smallest term.
        if (t.CabConfig != "Day Cab") score += 5.0;             // somewhere to sleep
        score += Math.Clamp((t.Horsepower - 400) / 150.0, -1, 1) * 4.0;
        if (t.GovernedMph > 0) score += Math.Clamp((t.GovernedMph - 62) / 8.0, -1, 1) * 2.0;

        // The gearbox the driver actually asked for, where they said.
        var want = (s.Application?.TransmissionPreference ?? "").Trim().ToLowerInvariant();
        if (want is "automatic" or "manual"
            && t.TransmissionType.Equals(want, StringComparison.OrdinalIgnoreCase))
            score += 3.0;

        return Math.Round(score, 2);
    }

    /// <summary>
    /// Is <paramref name="candidate"/> enough better than <paramref name="mine"/> to move a driver?
    ///
    /// <paramref name="why"/> comes back as something that can be said out loud, because every caller
    /// puts it in front of the player and "it scored higher" is not a reason anybody can check.
    /// </summary>
    public static bool IsUpgrade(AppState s, Truck? mine, Truck candidate, out string why)
    {
        why = "";
        if (mine == null) { why = Describe(s, candidate); return true; }
        if (candidate.Unit.Equals(mine.Unit, StringComparison.OrdinalIgnoreCase)) return false;

        var gap = Score(s, candidate) - Score(s, mine);
        if (gap < UpgradeMargin) return false;

        why = string.Join(" ", Reasons(s, mine, candidate));
        return true;
    }

    /// <summary>The honest case for one unit over another, in the driver's terms.</summary>
    private static List<string> Reasons(AppState s, Truck mine, Truck candidate)
    {
        var parts = new List<string>();

        if (candidate.ServiceMiles < mine.ServiceMiles * 0.85)
            parts.Add($"{mine.ServiceMiles - candidate.ServiceMiles:N0} fewer miles on it.");
        else if (candidate.ServiceMiles > mine.ServiceMiles)
            parts.Add($"It has {candidate.ServiceMiles - mine.ServiceMiles:N0} more miles than yours, " +
                      "and is still the better truck.");

        var cg = GradeOf(candidate.Make, candidate.Model);
        var mg = GradeOf(mine.Make, mine.Model);
        if (cg > mg)
            parts.Add($"A {candidate.Make} {candidate.Model} against a {mine.Make} {mine.Model} — " +
                      (cg == 3 ? "that is the top of the range." : "a better truck out of the range."));

        if (candidate.Year > mine.Year)
            parts.Add($"{candidate.Year} against your {mine.Year}.");

        if (mine.CabConfig == "Day Cab" && candidate.CabConfig != "Day Cab")
            parts.Add("And it has a bunk.");

        if (candidate.Horsepower >= mine.Horsepower + 75)
            parts.Add($"{candidate.Horsepower} hp against {mine.Horsepower}.");

        if (parts.Count == 0) parts.Add(Describe(s, candidate));
        return parts;
    }

    private static string Describe(AppState s, Truck t) =>
        $"{t.Year} {t.Make} {t.Model}, {t.ServiceMiles:N0} mi.";

    /// <summary>The best of a set on the same scale everything else uses. Null when the set is empty.</summary>
    public static Truck? Best(AppState s, IEnumerable<Truck> candidates) =>
        candidates.OrderByDescending(t => Score(s, t)).ThenBy(t => t.ServiceMiles).FirstOrDefault();
}
