using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Crossings in the dispatch calculation. The second half of step 7 of ETS2 support (#266, #273).
///
/// <para>The app's distances are straight lines with a road factor, which assumes the land is continuous.
/// Europe has water in the way. So every city gets a <b>land area</b> — Great Britain, the island of Ireland,
/// Sicily, Sardinia, Corsica, Crete and the Greek islands, Iceland, the Scottish and Estonian islands, Malta
/// and the rest — and everything joined by road (Scandinavia included, over the Danish bridges) is one area.
/// A leg whose ends are in different areas needs a crossing, and every crossing in <see cref="Ferries"/> that
/// joins the two is a way across; where none does, two that meet on an island between (Malta by way of
/// Sicily, Jersey by way of Guernsey).</para>
///
/// <para>The planner is run once for each way across and the best is kept: the best verdict, then the
/// earliest arrival. When that is not the plain way, the plan says why. With real sailings on, the wait
/// for the next departure is part of it — reported from play: "if a driver is scheduled to get to Calais at
/// 2AM but there isn't a ferry to the UK until 6AM then this needs to be figured into feasibility. Also
/// possibly tell the user to go a longer route but take a chunnel train that leaves at 2:30AM".</para>
///
/// <para><b>Shortcuts.</b> A ferry can also be the quicker way where a road exists — Hirtshals to Kristiansand
/// against driving round through Sweden. On a leg with no water in the way, a crossing whose road either side
/// comes to well under the listing's distance (<see cref="ShortcutShare"/>) is tried against the road, and kept
/// only when it arrives sooner.</para>
/// </summary>
public static class Crossings
{
    /// <summary>A ferry is tried as a shortcut only when the road to and from it is under this share of the drive.</summary>
    public const double ShortcutShare = 0.75;

    /// <summary>Which land area a place is on. Needs the city's coordinates for the countries split by water.</summary>
    public static string Area(string? city, string? cc)
    {
        var c = (cc ?? "").Trim().ToUpperInvariant();
        switch (c)
        {
            case "IE": return "Ireland";
            case "IS": case "FO": case "SJ": case "GL": case "MT": case "CY": case "AX": case "IM": case "GG": case "JE":
                return c;
        }
        var at = Geo.Locate(city, cc);
        if (at is not { } p) return c is "UK" ? "GB" : "Continent";
        var (lat, lon) = p;
        if (c == "UK")
        {
            if (lon < -5.4 && lat > 54.0 && lat < 55.4) return "Ireland";
            // Lewis and Harris, the Uists: west of the Minch. Skye is bridged, so it stays with Great Britain.
            if (lon < -6.1 && lat > 56.8 && lat < 58.6 && (lat > 57.95 || lon < -6.65)) return "Outer Hebrides";
            if (lat > 58.65 && lat < 59.45 && lon > -3.6 && lon < -2.3) return "Orkney";
            if (lat > 59.8 && lat < 60.9) return "Shetland";
            return "GB";
        }
        if (c == "EE")
        {
            // Saaremaa with Muhu (one by the causeway), and Hiiumaa.
            if (lat > 57.9 && lat < 58.75 && lon > 21.8 && lon < 23.45) return "Saaremaa";
            if (lat > 58.75 && lat < 59.15 && lon > 22.0 && lon < 23.2) return "Hiiumaa";
        }
        if (c == "IT" && lat > 36.5 && lat < 38.35 && lon > 12.3 && lon < 15.6) return "Sicily";
        if (c == "IT" && lat > 38.8 && lat < 41.35 && lon > 8.0 && lon < 9.9) return "Sardinia";
        if (c == "FR" && lat > 41.3 && lat < 43.1 && lon > 8.4 && lon < 9.7) return "Corsica";
        if (c == "GR")
        {
            if (lat > 34.8 && lat < 35.75 && lon > 23.4 && lon < 26.4) return "Crete";
            if (lat > 38.0 && lat < 38.7 && lon > 25.8 && lon < 26.25) return "Chios";
            if (lat > 38.9 && lat < 39.45 && lon > 25.8 && lon < 26.7) return "Lesvos";
            if (lat > 35.8 && lat < 36.5 && lon > 27.6 && lon < 28.3) return "Rhodes";
            if (lat > 38.0 && lat < 38.5 && lon > 20.3 && lon < 20.85) return "Kefalonia";
        }
        return "Continent";
    }

    /// <summary>
    /// One way across: the crossing, which way it is taken, and the road either side of it. A second crossing,
    /// when there is one, follows <see cref="MilesBetween"/> of road on the island between.
    /// </summary>
    public sealed record Option(Ferries.Route Route, bool FromA, double MilesBefore, double MilesAfter,
                                Ferries.Route? Route2 = null, bool FromA2 = false, double MilesBetween = 0,
                                bool Shortcut = false)
    {
        public double RoadMiles => MilesBefore + MilesBetween + MilesAfter;
        public string Label => Route2 == null ? Name(Route, FromA) : $"{Name(Route, FromA)} and {Name(Route2, FromA2)}";
        private static string Name(Ferries.Route r, bool fromA) => fromA ? $"{r.A} – {r.B}" : $"{r.B} – {r.A}";
        public CrossingLeg Leg => new(Route.Id, FromA, MilesBefore, MilesAfter, Route2?.Id ?? "", FromA2, MilesBetween);
    }

    /// <summary>Every crossing that joins the two ends of a leg, when they are in different areas — two in a row where none does it alone.</summary>
    public static List<Option> Options(string? fromCity, string? fromCc, string? toCity, string? toCc) =>
        Options(Ferries.All, fromCity, fromCc, toCity, toCc);

    public static List<Option> Options(IEnumerable<Ferries.Route> routes, string? fromCity, string? fromCc, string? toCity, string? toCc)
    {
        var table = routes as IReadOnlyList<Ferries.Route> ?? routes.ToList();
        var a = Area(fromCity, fromCc);
        var b = Area(toCity, toCc);
        var list = new List<Option>();
        if (a == b) return list;
        foreach (var (r, fromA) in Joining(table, a, b))
            list.Add(Leg(r, fromA, fromCity, fromCc, toCity, toCc));
        if (list.Count > 0) return list;

        foreach (var (r1, fromA1) in table.SelectMany(r => new[] { (r, true), (r, false) }))
        {
            var (nc, ncc) = Near(r1, fromA1);
            var (fc, fcc) = Far(r1, fromA1);
            if (Area(nc, ncc) != a) continue;
            var mid = Area(fc, fcc);
            if (mid == a || mid == b) continue;
            foreach (var (r2, fromA2) in Joining(table, mid, b))
            {
                var (n2, n2cc) = Near(r2, fromA2);
                var (f2, f2cc) = Far(r2, fromA2);
                var first = Leg(r1, fromA1, fromCity, fromCc, n2, n2cc);
                var after = Geo.MilesBetween(f2, f2cc, toCity, toCc) ?? 0;
                list.Add(new Option(r1, fromA1, first.MilesBefore, after, r2, fromA2, first.MilesAfter));
            }
        }
        return list;
    }

    /// <summary>
    /// Ferries that could cut a road leg short: both ports in the leg's own area, and the road to and from them
    /// well under the drive. Fjord and river ferries on the road itself never qualify — their ports are on it.
    /// </summary>
    public static List<Option> Shortcuts(IEnumerable<Ferries.Route> routes, string? fromCity, string? fromCc, string? toCity, string? toCc, double listedMiles)
    {
        var list = new List<Option>();
        var a = Area(fromCity, fromCc);
        if (listedMiles <= 0 || a != Area(toCity, toCc)) return list;
        foreach (var r in routes)
        {
            if (Area(r.ACity, r.ACc) != a || Area(r.BCity, r.BCc) != a) continue;
            foreach (var fromA in new[] { true, false })
            {
                var o = Leg(r, fromA, fromCity, fromCc, toCity, toCc);
                if (o.RoadMiles < listedMiles * ShortcutShare) list.Add(o with { Shortcut = true });
            }
        }
        return list;
    }

    private static IEnumerable<(Ferries.Route Route, bool FromA)> Joining(IEnumerable<Ferries.Route> routes, string a, string b)
    {
        foreach (var r in routes)
        {
            var ra = Area(r.ACity, r.ACc);
            var rb = Area(r.BCity, r.BCc);
            if (ra == a && rb == b) yield return (r, true);
            else if (rb == a && ra == b) yield return (r, false);
        }
    }

    private static (string City, string Cc) Near(Ferries.Route r, bool fromA) => fromA ? (r.ACity, r.ACc) : (r.BCity, r.BCc);
    private static (string City, string Cc) Far(Ferries.Route r, bool fromA) => fromA ? (r.BCity, r.BCc) : (r.ACity, r.ACc);

    private static Option Leg(Ferries.Route r, bool fromA, string? fromCity, string? fromCc, string? toCity, string? toCc)
    {
        var (pc, pcc) = Near(r, fromA);
        var (qc, qcc) = Far(r, fromA);
        var before = Geo.MilesBetween(fromCity, fromCc, pc, pcc) ?? 0;
        var after = Geo.MilesBetween(qc, qcc, toCity, toCc) ?? 0;
        return new Option(r, fromA, before, after);
    }

    /// <summary>
    /// The ways to run one leg, the plain one first: every way across when there is water in the way (the
    /// shortest first), or the road (null) and any ferry that might be quicker when there is not.
    /// </summary>
    private static List<Option?> Ways(AppState s, string? fromCity, string? fromCc, string? toCity, string? toCc,
                                      double listedMiles, List<string> noWay)
    {
        var have = Ferries.Available(s).ToList();
        var across = Scale(Options(have, fromCity, fromCc, toCity, toCc), listedMiles);
        if (across.Count > 0) return across.OrderBy(o => o.RoadMiles).Select(o => (Option?)o).ToList();
        var a = Area(fromCity, fromCc);
        var b = Area(toCity, toCc);
        if (a != b)
        {
            // Water in the way and no crossing the player has joins the two. Said, not driven through.
            noWay.Add(Options(fromCity, fromCc, toCity, toCc).Count > 0
                ? $"No way across from {fromCity} to {toCity}: every crossing that joins {Name(a)} and {Name(b)} is switched off " +
                  "in Settings → Ferries. Switch one back on if your game has it."
                : $"No way across from {fromCity} to {toCity}: no crossing the app knows joins {Name(a)} and {Name(b)}.");
            return new List<Option?> { null };
        }
        var ways = new List<Option?> { null };
        ways.AddRange(Shortcuts(have, fromCity, fromCc, toCity, toCc, listedMiles));
        return ways;
    }

    /// <summary>A land area in words.</summary>
    private static string Name(string area) => area switch
    {
        "Continent" => "the mainland", "GB" => "Great Britain", "Ireland" => "the island of Ireland",
        _ when area.Length == 2 => Ets2Data.Regions.FirstOrDefault(r => r.Code == area)?.Name ?? area,
        _ => area,
    };

    /// <summary>
    /// The plan for a load with its crossings chosen: every way across tried, the best kept. A career not on
    /// EU rules, or a load with no water in the way and no ferry worth trying, is planned exactly as it always was.
    /// </summary>
    public static FeasibilityResult PlanBest(AppState s, PlanRequest req, Truck? truck)
    {
        if (GameProfile.For(s).Id != "ETS2") return HosEngine.Plan(s, req, truck);
        // A crossing already chosen is planned as given.
        if (req.DeadheadCrossing != null || req.LoadedCrossing != null) return HosEngine.Plan(s, req, truck);

        var fromCity = string.IsNullOrWhiteSpace(req.FromCity) ? s.Status.LocationCity : req.FromCity;
        var fromCc = string.IsNullOrWhiteSpace(req.FromState) ? s.Status.LocationState : req.FromState;
        var noWay = new List<string>();
        var dh = req.DeadheadMiles > 0 && !string.IsNullOrWhiteSpace(req.OriginCity)
            ? Ways(s, fromCity, fromCc, req.OriginCity, req.OriginState, req.DeadheadMiles, noWay)
            : new List<Option?> { null };
        // Only where both ends of the leg are known: an empty destination is not "the Continent".
        var ld = !string.IsNullOrWhiteSpace(req.DestCity) && !string.IsNullOrWhiteSpace(req.DestState)
                 && (!string.IsNullOrWhiteSpace(req.OriginCity) || !string.IsNullOrWhiteSpace(fromCity))
            ? Ways(s, string.IsNullOrWhiteSpace(req.OriginCity) ? fromCity : req.OriginCity,
                   string.IsNullOrWhiteSpace(req.OriginState) ? fromCc : req.OriginState,
                   req.DestCity, req.DestState, req.LoadedMiles, noWay)
            : new List<Option?> { null };
        if (noWay.Count > 0)
        {
            var stuck = HosEngine.Plan(s, req, truck);
            stuck.Verdict = "Infeasible";
            stuck.Warnings.InsertRange(0, noWay);
            return stuck;
        }
        if (dh.All(x => x == null) && ld.All(x => x == null)) return HosEngine.Plan(s, req, truck);

        var tried = new List<(FeasibilityResult Plan, Option? Dh, Option? Ld)>();
        foreach (var d in dh)
        foreach (var l in ld)
        {
            var r = req.Clone();
            if (d != null) { r.DeadheadCrossing = d.Leg; r.DeadheadMiles = d.RoadMiles; }
            if (l != null) { r.LoadedCrossing = l.Leg; r.LoadedMiles = l.RoadMiles; }
            tried.Add((HosEngine.Plan(s, r, truck), d, l));
        }

        static int Rank(string v) => v == "Feasible" ? 0 : v == "Tight" ? 1 : 2;
        static DateTime Arrives(FeasibilityResult p) => GameClock.TryParse(p.ProjectedArrivalGameTime) ?? DateTime.MaxValue;
        // The first tried is the plain way: the shortest crossing, or the road. Ties go to it.
        var plain = tried[0];
        var best = tried.Select((t, i) => (t, i))
                        .OrderBy(x => Rank(x.t.Plan.Verdict)).ThenBy(x => Arrives(x.t.Plan)).ThenBy(x => x.i)
                        .First().t;

        if (!ReferenceEquals(best.Plan, plain.Plan))
        {
            var saved = (Arrives(plain.Plan) - Arrives(best.Plan)).TotalHours;
            var sooner = saved > 0.01 ? $"you arrive {Hhmm.Of(saved)} sooner" : "the plan comes out better that way";
            foreach (var (was, now, listed) in new[] { (plain.Dh, best.Dh, req.DeadheadMiles), (plain.Ld, best.Ld, req.LoadedMiles) })
            {
                if (now == null || ReferenceEquals(was, now)) continue;
                best.Plan.Warnings.Insert(0, now.Shortcut
                    ? $"Take the {now.Label} ferry rather than driving round: {Units.Distance(Math.Max(0, listed - now.RoadMiles))} " +
                      $"less road, and {sooner}."
                    : $"Cross {now.Label} rather than {was?.Label ?? "the shortest way"}: it is further to drive, but {sooner} — " +
                      "the sailing times decide it.");
            }
        }
        return best.Plan;
    }

    /// <summary>Legs scaled so the shortest way across reads the listing's own distance.</summary>
    private static List<Option> Scale(List<Option> options, double listedMiles)
    {
        if (options.Count == 0 || listedMiles <= 0) return options;
        var shortest = options.Min(o => o.RoadMiles);
        if (shortest <= 0.01)
            return options.Select(o => o with { MilesBefore = listedMiles / 2, MilesBetween = 0, MilesAfter = listedMiles / 2 }).ToList();
        var k = listedMiles / shortest;
        return options.Select(o => o with { MilesBefore = o.MilesBefore * k, MilesBetween = o.MilesBetween * k, MilesAfter = o.MilesAfter * k }).ToList();
    }
}

/// <summary>
/// A crossing on one leg of a plan: the route, which way, and the road before and after it. A second crossing,
/// when the leg needs two, follows <see cref="MilesBetween"/> of road after the first.
/// </summary>
public sealed record CrossingLeg(string Route, bool FromA, double MilesBefore, double MilesAfter,
                                 string Route2 = "", bool FromA2 = false, double MilesBetween = 0);
