namespace TruckSimDispatcher.Services;

/// <summary>
/// Crude US geography, used only to answer "is this load taking me toward home or away from it?".
///
/// Deliberately rough. ATS runs a scaled map with mod-dependent distances, so there is no true mileage
/// table to work from — and the question being asked does not need one. Home time only has to land the
/// driver somewhere near their home terminal, not on the dot, so state-centroid distance plus a
/// same-state fallback is accurate enough to rank loads and honest about what it is.
///
/// Never use this for pay, fuel or feasibility. Those run off the miles ATS actually reports.
/// </summary>
public static class Geo
{
    /// <summary>Rough state centroids. Degrees, not survey-grade.</summary>
    private static readonly Dictionary<string, (double Lat, double Lon)> Centers = new(StringComparer.OrdinalIgnoreCase)
    {
        ["AL"] = (32.8, -86.8), ["AZ"] = (34.2, -111.7), ["AR"] = (34.9, -92.4), ["CA"] = (37.2, -119.5),
        ["CO"] = (39.0, -105.5), ["CT"] = (41.6, -72.7), ["DE"] = (39.0, -75.5), ["FL"] = (28.6, -82.4),
        ["GA"] = (32.6, -83.4), ["ID"] = (44.4, -114.6), ["IL"] = (40.0, -89.2), ["IN"] = (39.9, -86.3),
        ["IA"] = (42.1, -93.5), ["KS"] = (38.5, -98.4), ["KY"] = (37.5, -85.3), ["LA"] = (31.1, -92.0),
        ["ME"] = (45.4, -69.2), ["MD"] = (39.0, -76.8), ["MA"] = (42.3, -71.8), ["MI"] = (44.3, -85.4),
        ["MN"] = (46.3, -94.3), ["MS"] = (32.7, -89.7), ["MO"] = (38.4, -92.5), ["MT"] = (47.0, -109.6),
        ["NE"] = (41.5, -99.8), ["NV"] = (39.3, -116.6), ["NH"] = (43.7, -71.6), ["NJ"] = (40.2, -74.7),
        ["NM"] = (34.4, -106.1), ["NY"] = (42.9, -75.5), ["NC"] = (35.5, -79.4), ["ND"] = (47.4, -100.5),
        ["OH"] = (40.3, -82.8), ["OK"] = (35.6, -97.5), ["OR"] = (43.9, -120.6), ["PA"] = (40.9, -77.8),
        ["RI"] = (41.7, -71.6), ["SC"] = (33.9, -80.9), ["SD"] = (44.4, -100.2), ["TN"] = (35.8, -86.4),
        ["TX"] = (31.5, -99.3), ["UT"] = (39.3, -111.7), ["VT"] = (44.1, -72.7), ["VA"] = (37.5, -78.9),
        ["WA"] = (47.4, -120.5), ["WV"] = (38.6, -80.6), ["WI"] = (44.6, -89.7), ["WY"] = (43.0, -107.5),
    };

    private const double MilesPerDegree = 69.0;

    /// <summary>
    /// Typical distance between two different cities in the same state. A state centroid cannot
    /// separate them, and calling them zero miles apart would read as "you are home" when you are
    /// three hours away.
    /// </summary>
    private const double SameStateMiles = 130.0;

    public static bool Knows(string? state) => !string.IsNullOrWhiteSpace(state) && Centers.ContainsKey(state.Trim());

    /// <summary>
    /// Rough miles between two places. Returns null when the states are unknown to the table (map mods
    /// add cities we have no coordinates for) so callers can say "I do not know" instead of guessing.
    /// </summary>
    public static double? MilesBetween(string? cityA, string? stateA, string? cityB, string? stateB)
    {
        var ca = (cityA ?? "").Trim();
        var cb = (cityB ?? "").Trim();
        var sa = (stateA ?? "").Trim();
        var sb = (stateB ?? "").Trim();

        // Same city is the only case we can be certain about.
        if (ca.Length > 0 && ca.Equals(cb, StringComparison.OrdinalIgnoreCase) &&
            (sa.Length == 0 || sb.Length == 0 || sa.Equals(sb, StringComparison.OrdinalIgnoreCase)))
            return 0;

        if (!Centers.TryGetValue(sa, out var a) || !Centers.TryGetValue(sb, out var b)) return null;

        if (sa.Equals(sb, StringComparison.OrdinalIgnoreCase)) return SameStateMiles;

        var dLat = a.Lat - b.Lat;
        var dLon = (a.Lon - b.Lon) * Math.Cos(a.Lat * Math.PI / 180);
        var miles = Math.Sqrt(dLat * dLat + dLon * dLon) * MilesPerDegree;

        // Neighbouring states can produce a small centroid gap for what is still a real drive.
        return Math.Max(miles, SameStateMiles);
    }
}
