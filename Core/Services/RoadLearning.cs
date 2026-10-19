using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Road miles between two places, as the driver actually drove them.
///
/// <para>Every distance the app works out for itself is a straight line with a road factor — fine across open
/// country, wrong where the road winds, goes round a lake or climbs a pass. Asked for from play: "we estimate until we
/// have the actual mileage, based on odometer, then the next loads between points will be more accurate." The
/// odometer is read at dispatch, at the shipper and at the receiver, so every closed-out trip says what one or two
/// legs really were:</para>
/// <list type="bullet">
/// <item>the loaded leg, shipper to receiver, where the start was read at the shipper;</item>
/// <item>the pickup leg, from where the truck was dispatched to the shipper;</item>
/// <item>an empty move, from where it was ordered to where it was closed out.</item>
/// </list>
/// <para>Kept per pair of places, either way round, as the last five runs; the figure used is the middle one, so a
/// wrong turn does not become the distance. A leg that took a ferry is not kept: the odometer does not count the
/// crossing. Nor is one shorter than the straight line, or more than three times the estimate — a reading typed wrong.</para>
///
/// <para>Used wherever the app estimates a distance (<see cref="Geo.MilesBetween"/>), and for a load, the longer of
/// the listing and what was driven is planned.</para>
/// </summary>
public static class RoadLearning
{
    /// <summary>Runs kept per pair.</summary>
    public const int Keep = 5;

    // The career's learned table, for the static distance lookups. Set by the store whenever the career is used.
    private static volatile Dictionary<string, double> _current = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Driven roads needed before a factor is learned — per country, or overall.</summary>
    public const int MinRoadsForFactor = 3;

    // How much longer the roads the driver has driven came out than the estimate, overall and by country. Applied to
    // roads not yet driven. Null overall = not enough roads yet.
    private static volatile Dictionary<string, double> _factorByCc = new(StringComparer.OrdinalIgnoreCase);
    private static double? _factor;

    private sealed record Ratio(string CcA, string CcB, double Value);

    private static List<Ratio> Ratios(IEnumerable<RoadLeg> legs) =>
        legs.Where(r => r.Miles.Count > 0)
            .Select(r =>
            {
                var parts = r.Key.Split('>');
                if (parts.Length != 2) return null;
                var a = parts[0].Split('|'); var b = parts[1].Split('|');
                if (a.Length != 2 || b.Length != 2) return null;
                return Geo.EstimatedMiles(a[0], a[1], b[0], b[1]) is { } est && est > 1
                    ? new Ratio(a[1], b[1], Middle(r.Miles) / est) : null;
            })
            .Where(x => x != null).Select(x => x!).ToList();

    /// <summary>
    /// What to multiply the straight-line estimate by on a road not yet driven: the country's own learned figure where
    /// both ends have one (their average across a border), the overall one otherwise. 1 until there is enough driving.
    ///
    /// <para>Asked for from play after the driven-distance table: the roads already driven came out about 1.45 times
    /// the estimate across the Balkans and the Alps, and close to it in Germany — so the first run on a new road
    /// should be planned that way too, not on a straight line the driver has never yet managed.</para>
    /// </summary>
    public static double FactorFor(string? ccA, string? ccB)
    {
        if (_factor is not { } all) return 1;
        double Of(string? cc) => !string.IsNullOrWhiteSpace(cc) && _factorByCc.TryGetValue(cc.Trim(), out var f) ? f : all;
        return (Of(ccA) + Of(ccB)) / 2;
    }

    private static double Clamp(double f) => Math.Clamp(f, 0.9, 2.0);

    private static string Place(string? city, string? cc) =>
        $"{(city ?? "").Trim().ToLowerInvariant()}|{(cc ?? "").Trim().ToUpperInvariant()}";

    /// <summary>One key for a pair, whichever way round it was driven.</summary>
    public static string Key(string? cityA, string? ccA, string? cityB, string? ccB)
    {
        var a = Place(cityA, ccA);
        var b = Place(cityB, ccB);
        return string.CompareOrdinal(a, b) <= 0 ? $"{a}>{b}" : $"{b}>{a}";
    }

    private static double Middle(List<double> v)
    {
        var o = v.OrderBy(x => x).ToList();
        return o.Count == 0 ? 0 : o.Count % 2 == 1 ? o[o.Count / 2] : (o[o.Count / 2 - 1] + o[o.Count / 2]) / 2;
    }

    /// <summary>Makes this career's table the one the distance lookups read.</summary>
    public static void Activate(AppState s)
    {
        var map = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in s.RoadLegs ?? new List<RoadLeg>())
            if (r.Miles.Count > 0) map[r.Key] = Middle(r.Miles);
        _current = map;

        // The factors, off every driven road the map can also estimate.
        var ratios = Ratios(s.RoadLegs ?? new List<RoadLeg>());
        _factor = ratios.Count >= MinRoadsForFactor ? Clamp(Middle(ratios.Select(x => x.Value).ToList())) : null;
        var byCc = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var cc in ratios.SelectMany(x => new[] { x.CcA, x.CcB }).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var touching = ratios.Where(x => x.CcA.Equals(cc, StringComparison.OrdinalIgnoreCase) || x.CcB.Equals(cc, StringComparison.OrdinalIgnoreCase))
                                 .Select(x => x.Value).ToList();
            if (touching.Count >= MinRoadsForFactor) byCc[cc] = Clamp(Middle(touching));
        }
        _factorByCc = byCc;
    }

    /// <summary>The driven miles between two places, or null where they have not been driven.</summary>
    public static double? Known(string? cityA, string? ccA, string? cityB, string? ccB)
    {
        if (string.IsNullOrWhiteSpace(cityA) || string.IsNullOrWhiteSpace(cityB)) return null;
        return _current.TryGetValue(Key(cityA, ccA, cityB, ccB), out var m) ? m : null;
    }

    /// <summary>Adds one driven leg. Returns true where it was kept.</summary>
    public static bool Record(AppState s, string? cityA, string? ccA, string? cityB, string? ccB, double miles, string gameTime)
    {
        if (string.IsNullOrWhiteSpace(cityA) || string.IsNullOrWhiteSpace(cityB) || miles < 1) return false;
        if (Place(cityA, ccA) == Place(cityB, ccB)) return false;
        // Sanity against the map: no road is shorter than the straight line, and three times the estimate is a
        // reading typed wrong rather than a road.
        if (Geo.EstimatedMiles(cityA, ccA, cityB, ccB) is { } est && est > 0
            && (miles < est / Geo.RoadFactorValue * 0.95 || miles > est * 3)) return false;
        s.RoadLegs ??= new List<RoadLeg>();
        var key = Key(cityA, ccA, cityB, ccB);
        var leg = s.RoadLegs.FirstOrDefault(x => x.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
        if (leg == null)
        {
            leg = new RoadLeg { Key = key, A = DispatchEngine.Place(cityA!, ccA ?? ""), B = DispatchEngine.Place(cityB!, ccB ?? "") };
            s.RoadLegs.Add(leg);
        }
        leg.Miles.Add(Math.Round(miles, 1));
        if (leg.Miles.Count > Keep) leg.Miles.RemoveRange(0, leg.Miles.Count - Keep);
        leg.LastGameTime = gameTime;
        return true;
    }

    /// <summary>What a closed-out trip says about the road: its loaded leg, its pickup leg, or the empty move.</summary>
    public static List<string> RecordTrip(AppState s, Trip t)
    {
        var said = new List<string>();
        // A crossing is not on the odometer, so the reading is not the leg.
        if (t.Events.Any(e => e.Kind == "Ferry")) return said;
        var when = string.IsNullOrWhiteSpace(t.DeliveredGameTime) ? s.Status.GameTime : t.DeliveredGameTime;

        if (t.Kind.Equals("Freight", StringComparison.OrdinalIgnoreCase))
        {
            if (t.StartOdometerAtShipper && t.EndOdometer > t.StartOdometer
                && Record(s, t.OriginCity, t.OriginState, t.DestCity, t.DestState, t.EndOdometer - t.StartOdometer, when))
                said.Add($"{DispatchEngine.Place(t.OriginCity, t.OriginState)} → {DispatchEngine.Place(t.DestCity, t.DestState)}: " +
                         $"{Units.Distance(t.EndOdometer - t.StartOdometer)} on the odometer");
            if (t.StartOdometerAtShipper && t.DeadheadMeasured && t.StartOdometer > t.DispatchOdometer && t.DispatchOdometer > 0
                && Record(s, t.DispatchCity, t.DispatchState, t.OriginCity, t.OriginState, t.StartOdometer - t.DispatchOdometer, when))
                said.Add($"{DispatchEngine.Place(t.DispatchCity, t.DispatchState)} → {DispatchEngine.Place(t.OriginCity, t.OriginState)}: " +
                         $"{Units.Distance(t.StartOdometer - t.DispatchOdometer)} to the shipper");
        }
        else if (t.Kind is "EmptyMove" or "Maintenance" && t.EndOdometer > t.StartOdometer && t.StartOdometer > 0
                 && Record(s, t.OriginCity, t.OriginState, t.DestCity, t.DestState, t.EndOdometer - t.StartOdometer, when))
            said.Add($"{DispatchEngine.Place(t.OriginCity, t.OriginState)} → {DispatchEngine.Place(t.DestCity, t.DestState)}: " +
                     $"{Units.Distance(t.EndOdometer - t.StartOdometer)} on the odometer");
        if (said.Count > 0) Activate(s);
        return said;
    }

    /// <summary>
    /// The table built from every trip already on file, for a career that ran before it existed. Where a pickup leg's
    /// starting point was not recorded, the delivery the truck was standing at is taken — if it was the last close-out
    /// before the load was dispatched.
    /// </summary>
    public static void Backfill(AppState s)
    {
        s.RoadLegs = new List<RoadLeg>();
        var ordered = s.Trips.Where(t => t.Status == "Delivered")
                             .OrderBy(t => t.DispatchedGameTime, StringComparer.Ordinal).ToList();
        Trip? before = null;
        foreach (var t in ordered)
        {
            if (string.IsNullOrWhiteSpace(t.DispatchCity) && before != null
                && string.CompareOrdinal(before.DeliveredGameTime, t.DispatchedGameTime) <= 0)
            {
                t.DispatchCity = before.DestCity;
                t.DispatchState = before.DestState;
            }
            RecordTrip(s, t);
            before = t;
        }
        Activate(s);
    }

    /// <summary>For the Settings screen: the pairs learned, newest first, and the factors for roads not yet driven.</summary>
    public static object View(AppState s) => new
    {
        roads = (s.RoadLegs ?? new List<RoadLeg>())
            .OrderByDescending(r => r.LastGameTime, StringComparer.Ordinal)
            .Select(r => new
            {
                a = r.A, b = r.B, miles = Middle(r.Miles), runs = r.Miles.Count,
                estimate = Geo.EstimatedMilesByPlace(r.Key),
            }).ToList(),
        factor = _factor,
        byCountry = _factorByCc.OrderBy(x => x.Key).Select(x => new { cc = x.Key, factor = x.Value }).ToList(),
        minRoads = MinRoadsForFactor,
    };
}
