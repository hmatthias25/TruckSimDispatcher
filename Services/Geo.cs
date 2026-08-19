using System.Reflection;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How far apart two places are.
///
/// This used to be state centroids with a flat 130-mile fallback for anywhere in the same state, which
/// produced some badly wrong answers: Amarillo to Houston measured the same as Colorado Springs to
/// Denver, and since the home radius is 200 miles, <i>anywhere in your home state</i> counted as being
/// home. It also quietly defeated the cap on deadheading home for a restart, because a same-state yard
/// always came back as a two-hour run however far away it really was.
///
/// So it measures now. Around thirty thousand real US city coordinates ship with the app, which covers
/// vanilla ATS, Coast to Coast and any other map mod that uses real place names — the player can report
/// a city the app's own market table has never heard of and still get a real distance. State centroids
/// remain, but only as the fallback for a city genuinely not in the table.
///
/// Still not survey-grade, and deliberately so: it is a great-circle distance with a road factor, not a
/// routed mileage, and ATS runs a scaled map anyway. Good enough to answer "is this taking me toward
/// home" and "is the yard worth deadheading to". <b>Never use it for pay, fuel or feasibility</b> —
/// those run off the miles ATS actually reports.
/// </summary>
public static class Geo
{
    /// <summary>
    /// Roads are not straight. A great-circle distance understates the drive by a fair margin, and
    /// under-stating it is the dangerous direction — it makes a deadhead look cheaper than it is.
    /// </summary>
    private const double RoadFactor = 1.2;

    private const double EarthRadiusMiles = 3958.8;

    /// <summary>Rough state centroids, for a city the coordinate table does not know.</summary>
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
        ["AK"] = (64.0, -152.0), ["HI"] = (20.8, -156.3), ["DC"] = (38.9, -77.0),
    };

    /// <summary>
    /// When only state centroids are available, two different cities in the same state cannot be told
    /// apart — so this is the least dishonest thing to say about them. Only reached for a city the
    /// coordinate table has never heard of.
    /// </summary>
    private const double SameStateFallbackMiles = 130.0;

    private static Dictionary<string, (double Lat, double Lon)>? _cities;
    private static readonly object Gate = new();

    /// <summary>The shipped coordinate table, loaded once on first use.</summary>
    private static Dictionary<string, (double Lat, double Lon)> Cities()
    {
        if (_cities != null) return _cities;
        lock (Gate)
        {
            if (_cities != null) return _cities;
            var map = new Dictionary<string, (double, double)>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using var stream = Assembly.GetExecutingAssembly()
                    .GetManifestResourceStream("data/us-cities.txt");
                if (stream != null)
                {
                    using var reader = new StreamReader(stream);
                    while (reader.ReadLine() is { } line)
                    {
                        if (line.Length == 0 || line[0] == '#') continue;
                        var p = line.Split('|');
                        if (p.Length < 4) continue;
                        if (!double.TryParse(p[2], System.Globalization.CultureInfo.InvariantCulture, out var lat)) continue;
                        if (!double.TryParse(p[3], System.Globalization.CultureInfo.InvariantCulture, out var lon)) continue;
                        map[Key(p[0], p[1])] = (lat, lon);
                    }
                }
            }
            catch
            {
                // A missing or unreadable table is not fatal — centroids still answer, just roughly.
            }
            _cities = map;
            return _cities;
        }
    }

    /// <summary>How many cities the table holds. Surfaced so the app can say what it is working from.</summary>
    public static int KnownCityCount => Cities().Count;

    private static string Key(string city, string state) =>
        $"{Normalise(city)}|{state.Trim().ToUpperInvariant()}";

    /// <summary>
    /// City names vary in punctuation between the game, the mods and the dataset. "St. Louis",
    /// "Saint Louis" and "St Louis" are one place, and so are "Coeur d'Alene" and "Coeur dAlene".
    /// </summary>
    private static string Normalise(string city)
    {
        var c = city.Trim().ToLowerInvariant()
            .Replace("’", "")
            .Replace("'", "")
            .Replace(".", "")
            .Replace("-", " ");
        if (c.StartsWith("saint ")) c = "st " + c[6..];
        c = string.Join(" ", c.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return c;
    }

    /// <summary>The coordinates of a city, or null when it is not one we know.</summary>
    public static (double Lat, double Lon)? Locate(string? city, string? state)
    {
        var c = (city ?? "").Trim();
        var st = (state ?? "").Trim();
        if (c.Length == 0 || st.Length != 2) return null;
        return Cities().TryGetValue(Key(c, st), out var hit) ? hit : null;
    }

    public static bool Knows(string? city, string? state) => Locate(city, state) != null;

    public static bool KnowsState(string? state) =>
        !string.IsNullOrWhiteSpace(state) && Centers.ContainsKey(state.Trim());

    /// <summary>
    /// Road miles between two places, near enough. Null when neither the city table nor the state
    /// centroids can answer, so callers can say "I do not know" rather than guess.
    /// </summary>
    public static double? MilesBetween(string? cityA, string? stateA, string? cityB, string? stateB)
    {
        var ca = (cityA ?? "").Trim();
        var cb = (cityB ?? "").Trim();
        var sa = (stateA ?? "").Trim();
        var sb = (stateB ?? "").Trim();

        // Same place is the only case anything can be certain about.
        if (ca.Length > 0 && Normalise(ca) == Normalise(cb) &&
            (sa.Length == 0 || sb.Length == 0 || sa.Equals(sb, StringComparison.OrdinalIgnoreCase)))
            return 0;

        // Measured, where we know both cities. This is the path almost everything takes.
        var pa = Locate(ca, sa);
        var pb = Locate(cb, sb);
        if (pa is { } a && pb is { } b)
            return Math.Round(Haversine(a.Lat, a.Lon, b.Lat, b.Lon) * RoadFactor, 0);

        // One or both are unknown — a mod city, or a typo. Fall back to centroids and be rough.
        if (!Centers.TryGetValue(sa, out var ga) || !Centers.TryGetValue(sb, out var gb)) return null;

        if (sa.Equals(sb, StringComparison.OrdinalIgnoreCase)) return SameStateFallbackMiles;

        var rough = Haversine(ga.Lat, ga.Lon, gb.Lat, gb.Lon) * RoadFactor;
        return Math.Round(Math.Max(rough, SameStateFallbackMiles), 0);
    }

    /// <summary>
    /// True when the figure came from real coordinates rather than a state centroid. Lets a caller
    /// hedge its wording — and refuse to make an expensive decision on a rough number.
    /// </summary>
    public static bool IsMeasured(string? cityA, string? stateA, string? cityB, string? stateB) =>
        Knows(cityA, stateA) && Knows(cityB, stateB);

    private static double Haversine(double lat1, double lon1, double lat2, double lon2)
    {
        static double Rad(double d) => d * Math.PI / 180.0;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var h = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * EarthRadiusMiles * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }
}
