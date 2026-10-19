using System.Reflection;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Road distances between the ETS2 and ProMods cities, measured on real roads (OSRM over OpenStreetMap, built by
/// tools/ets2-data/build_roads.py) rather than guessed from a straight line.
///
/// <para>Reported from play (v0.87): Travemünde to Groningen planned at 247 km after the Helsinki boat, where the road
/// is nearer 400, and the driver was late. In the US a straight line and a road factor hold up — the roads run fairly
/// direct and every load comes with its distance. In Europe the coasts and bays bend the roads, and where a ferry splits
/// a load, the legs either side have no listing to go by: the app guessed both, then stretched or squeezed them to make
/// the listing add up, and the squeezing is where the 247 came from.</para>
///
/// <para>Still an estimate of the game's road, which is not the real one: what the driver actually drives between two
/// places (<see cref="RoadLearning"/>) is preferred to this wherever it is known.</para>
/// </summary>
public static class RoadTable
{
    private const double KmPerMile = 1.609344;
    private static Dictionary<string, int>? _index;
    private static int[][]? _rows;              // _rows[i][j - i - 1] = km from i to j (j > i); -1 = no road
    private static readonly object Gate = new();

    /// <summary>Road miles between two cities on the table; null where either is not on it, or no road joins them.</summary>
    public static double? Miles(string? cityA, string? ccA, string? cityB, string? ccB)
    {
        Load();
        if (_index is null || _rows is null) return null;
        if (!_index.TryGetValue(Key(cityA, ccA), out var a) || !_index.TryGetValue(Key(cityB, ccB), out var b)) return null;
        if (a == b) return 0;
        var (i, j) = a < b ? (a, b) : (b, a);
        var row = _rows[i];
        var k = j - i - 1;
        if (k >= row.Length || row[k] <= 0) return null;    // no road, or a server that could not route it (Iceland)
        var miles = row[k] / KmPerMile;
        // Never shorter than the straight line: a figure that is shorter was routed somewhere else (snapped to the wrong road,
        // or no road there at all on the server's map).
        if (Geo.StraightMiles(cityA, ccA, cityB, ccB) is { } straight && miles < straight * 0.95) return null;
        return miles;
    }

    /// <summary>Whether the table can answer for this pair.</summary>
    public static bool Knows(string? cityA, string? ccA, string? cityB, string? ccB) => Miles(cityA, ccA, cityB, ccB) != null;

    /// <summary>How many cities the table covers, for the credits and the tests.</summary>
    public static int CityCount { get { Load(); return _index?.Count ?? 0; } }

    private static string Key(string? city, string? cc)
    {
        // One spelling for both sides: the table has the game's local names (Roma, Frankfurt am Main), the board the
        // English ones (Rome, Frankfurt).
        var c = CityNames.Fold(CityNames.Canonical(city, cc).Trim()).ToLowerInvariant()
            .Replace("’", "").Replace("'", "").Replace(".", "").Replace("-", " ");
        if (c.StartsWith("saint ")) c = "st " + c[6..];
        return $"{string.Join(" ", c.Split(' ', StringSplitOptions.RemoveEmptyEntries))}|{(cc ?? "").Trim().ToUpperInvariant()}";
    }

    private static void Load()
    {
        if (_index != null) return;
        lock (Gate)
        {
            if (_index != null) return;
            var index = new Dictionary<string, int>();
            var rows = new List<int[]>();
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("data/eu-roads.txt");
            if (stream != null)
            {
                using var reader = new StreamReader(stream);
                while (reader.ReadLine() is { } line)
                {
                    if (line.Length < 2 || line[0] == '#') continue;
                    var p = line.Split('|');
                    if (p[0] == "C" && p.Length >= 4 && int.TryParse(p[1], out var ci))
                        index.TryAdd(Key(p[2], p[3]), ci);
                    else if (p[0] == "R" && p.Length >= 3)
                        rows.Add(p[2].Length == 0 ? Array.Empty<int>()
                            : p[2].Split(',').Select(x => int.TryParse(x, out var km) ? km : -1).ToArray());
                }
            }
            _rows = rows.ToArray();
            _index = index;
        }
    }
}
