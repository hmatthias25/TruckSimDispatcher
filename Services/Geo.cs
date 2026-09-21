using System.Reflection;
using System.Text;

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

        // Canadian provinces and territories, on the same footing as the states: the answer for a town
        // the city table has never heard of. Rough by construction — Ontario is 900 miles across and one
        // point cannot be near both Windsor and Thunder Bay — which is equally true of Texas above, and
        // is why Knows() exists to tell a measurement from a placeholder.
        ["AB"] = (55.0, -115.0), ["BC"] = (54.0, -125.0), ["MB"] = (55.0, -97.0),
        ["NB"] = (46.5, -66.1), ["NL"] = (53.2, -60.5), ["NS"] = (45.0, -63.0),
        ["NT"] = (65.0, -119.0), ["NU"] = (70.0, -92.0), ["ON"] = (50.0, -86.0),
        ["PE"] = (46.4, -63.2), ["QC"] = (53.0, -72.0), ["SK"] = (54.5, -105.5),
        ["YT"] = (63.5, -135.5),
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

            // Two files, one format, one table. Canada is a separate resource because it comes from a
            // different source under a different licence and both have to be attributable — not because
            // the app cares which side of the border a city is on. Reported from play: a C2C career can
            // switch Ontario on under "Where you run" and then every distance rule goes quiet on it,
            // including the home-time ceiling that is the only thing stopping a run the wrong way.
            foreach (var resource in new[] { "data/us-cities.txt", "data/ca-cities.txt" })
            {
                try
                {
                    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource);
                    if (stream == null) continue;
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
                catch
                {
                    // A missing or unreadable table is not fatal — centroids still answer, just roughly.
                    // Carry on to the next one rather than losing both to one bad read.
                }
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
        var c = Fold(city).Trim().ToLowerInvariant()
            .Replace("’", "")
            .Replace("'", "")
            .Replace(".", "")
            .Replace("-", " ");
        if (c.StartsWith("saint ")) c = "st " + c[6..];
        c = string.Join(" ", c.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return c;
    }

    /// <summary>
    /// Strips accents, so Montréal and Montreal are one place.
    ///
    /// <para>Needed the moment Canada arrived: Québec, Trois-Rivières and Rivière-du-Loup are how the
    /// game and the mods spell them, and they are not what somebody types on a US keyboard. The shipped
    /// tables are pure ASCII, so this only ever runs on what the driver entered — but it has to run, or
    /// the accented spelling misses a row sitting right there in the file.</para>
    ///
    /// <para><b>Written out by hand on purpose.</b> The obvious implementation is to decompose with
    /// <c>Normalize(FormD)</c>, drop the combining marks and recompose — and it does not work here.
    /// This app publishes with <c>InvariantGlobalization</c>, so there is no ICU, and in that mode
    /// <c>Normalize</c> does not throw: it returns the string unchanged. The fold silently did nothing
    /// and Montréal went on missing, with a plausible-looking centroid distance to cover for it.</para>
    ///
    /// <para>So: an explicit map, which needs nothing from the platform. Latin-1 covers French and
    /// Spanish place names, which is the whole of what North America needs; a bare combining mark is
    /// dropped too, in case a name arrives already decomposed. Anything else is passed through rather
    /// than deleted — it will not match, which is the same answer as before and an honest one.</para>
    /// </summary>
    private static string Fold(string text)
    {
        var plain = true;
        foreach (var ch in text) if (ch > 127) { plain = false; break; }
        if (plain) return text;                         // the common case, and free

        var sb = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (ch < 128) { sb.Append(ch); continue; }
            if (ch is >= '̀' and <= 'ͯ') continue;      // a combining mark on its own
            sb.Append(ch switch
            {
                'À' or 'Á' or 'Â' or 'Ã' or 'Ä' or 'Å' or 'à' or 'á' or 'â' or 'ã' or 'ä' or 'å' => "a",
                'Æ' or 'æ' => "ae",
                'Ç' or 'ç' => "c",
                'È' or 'É' or 'Ê' or 'Ë' or 'è' or 'é' or 'ê' or 'ë' => "e",
                'Ì' or 'Í' or 'Î' or 'Ï' or 'ì' or 'í' or 'î' or 'ï' => "i",
                'Ð' or 'ð' or 'Đ' or 'đ' => "d",
                'Ñ' or 'ñ' => "n",
                'Ò' or 'Ó' or 'Ô' or 'Õ' or 'Ö' or 'Ø' or 'ò' or 'ó' or 'ô' or 'õ' or 'ö' or 'ø' => "o",
                'Œ' or 'œ' => "oe",
                'Ù' or 'Ú' or 'Û' or 'Ü' or 'ù' or 'ú' or 'û' or 'ü' => "u",
                'Ý' or 'ý' or 'ÿ' => "y",
                'Þ' or 'þ' => "th",
                'ß' => "ss",
                'Š' or 'š' => "s",
                'Ž' or 'ž' => "z",
                'Ł' or 'ł' => "l",
                _ => ch.ToString(),
            });
        }
        return sb.ToString();
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
