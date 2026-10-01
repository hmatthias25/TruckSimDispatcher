using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Crossings in the dispatch calculation. The second half of step 7 of ETS2 support (#266, #273).
///
/// <para>The app's distances are straight lines with a road factor, which assumes the land is continuous.
/// Europe has water in the way. So every city gets a <b>land area</b> — Great Britain, the island of Ireland,
/// Sicily, Sardinia, Corsica, Crete and the Greek islands, Iceland and the rest — and everything joined by
/// road (Scandinavia included, over the Danish bridges) is one area. A leg whose ends are in different areas
/// needs a crossing, and every crossing in <see cref="Ferries"/> that joins the two is a way across.</para>
///
/// <para>The planner is run once for each way across and the best is kept: the best verdict, then the
/// earliest arrival. When that is not the shortest way, the plan says why. With real sailings on, the wait
/// for the next departure is part of it — reported from play: "if a driver is scheduled to get to Calais at
/// 2AM but there isn't a ferry to the UK until 6AM then this needs to be figured into feasibility. Also
/// possibly tell the user to go a longer route but take a chunnel train that leaves at 2:30AM".</para>
///
/// <para>Only crossings that are needed are planned. A ferry that is merely a shortcut over a road that exists
/// (Hirtshals to Kristiansand against driving round through Sweden) is not compared yet.</para>
/// </summary>
public static class Crossings
{
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
        if (c == "UK") return lon < -5.4 && lat > 54.0 && lat < 55.4 ? "Ireland" : "GB";
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

    /// <summary>One way across: the crossing, which way it is taken, and the road either side of it.</summary>
    public sealed record Option(Ferries.Route Route, bool FromA, double MilesBefore, double MilesAfter);

    /// <summary>Every direct crossing that joins the two ends of a leg, when they are in different areas.</summary>
    public static List<Option> Options(string? fromCity, string? fromCc, string? toCity, string? toCc)
    {
        var a = Area(fromCity, fromCc);
        var b = Area(toCity, toCc);
        var list = new List<Option>();
        if (a == b) return list;
        foreach (var r in Ferries.All)
        {
            var ra = Area(r.ACity, r.ACc);
            var rb = Area(r.BCity, r.BCc);
            if (ra == a && rb == b) list.Add(Leg(r, true, fromCity, fromCc, toCity, toCc));
            else if (rb == a && ra == b) list.Add(Leg(r, false, fromCity, fromCc, toCity, toCc));
        }
        return list;
    }

    private static Option Leg(Ferries.Route r, bool fromA, string? fromCity, string? fromCc, string? toCity, string? toCc)
    {
        var (pc, pcc) = fromA ? (r.ACity, r.ACc) : (r.BCity, r.BCc);
        var (qc, qcc) = fromA ? (r.BCity, r.BCc) : (r.ACity, r.ACc);
        var before = Geo.MilesBetween(fromCity, fromCc, pc, pcc) ?? 0;
        var after = Geo.MilesBetween(qc, qcc, toCity, toCc) ?? 0;
        return new Option(r, fromA, before, after);
    }

    /// <summary>
    /// The plan for a load with its crossings chosen: every way across tried, the best kept. A career not on
    /// EU rules, or a load with no water in the way, is planned exactly as it always was.
    /// </summary>
    public static FeasibilityResult PlanBest(AppState s, PlanRequest req, Truck? truck)
    {
        if (GameProfile.For(s).Id != "ETS2") return HosEngine.Plan(s, req, truck);
        // A crossing already chosen is planned as given.
        if (req.DeadheadCrossing != null || req.LoadedCrossing != null) return HosEngine.Plan(s, req, truck);

        var fromCity = string.IsNullOrWhiteSpace(req.FromCity) ? s.Status.LocationCity : req.FromCity;
        var fromCc = string.IsNullOrWhiteSpace(req.FromState) ? s.Status.LocationState : req.FromState;
        var dh = req.DeadheadMiles > 0 && !string.IsNullOrWhiteSpace(req.OriginCity)
            ? Scale(Options(fromCity, fromCc, req.OriginCity, req.OriginState), req.DeadheadMiles)
            : new List<Option>();
        // Only where both ends of the leg are known: an empty destination is not "the Continent".
        var ld = !string.IsNullOrWhiteSpace(req.DestCity) && !string.IsNullOrWhiteSpace(req.DestState)
                 && (!string.IsNullOrWhiteSpace(req.OriginCity) || !string.IsNullOrWhiteSpace(fromCity))
            ? Scale(Options(string.IsNullOrWhiteSpace(req.OriginCity) ? fromCity : req.OriginCity,
                            string.IsNullOrWhiteSpace(req.OriginState) ? fromCc : req.OriginState,
                            req.DestCity, req.DestState), req.LoadedMiles)
            : new List<Option>();
        if (dh.Count == 0 && ld.Count == 0) return HosEngine.Plan(s, req, truck);

        var tried = new List<(FeasibilityResult Plan, Option? Dh, Option? Ld)>();
        foreach (var d in dh.Count > 0 ? dh.Select(x => (Option?)x) : new Option?[] { null })
        foreach (var l in ld.Count > 0 ? ld.Select(x => (Option?)x) : new Option?[] { null })
        {
            var r = req.Clone();
            if (d != null) { r.DeadheadCrossing = new CrossingLeg(d.Route.Id, d.FromA, d.MilesBefore, d.MilesAfter); r.DeadheadMiles = d.MilesBefore + d.MilesAfter; }
            if (l != null) { r.LoadedCrossing = new CrossingLeg(l.Route.Id, l.FromA, l.MilesBefore, l.MilesAfter); r.LoadedMiles = l.MilesBefore + l.MilesAfter; }
            tried.Add((HosEngine.Plan(s, r, truck), d, l));
        }

        static int Rank(string v) => v == "Feasible" ? 0 : v == "Tight" ? 1 : 2;
        var best = tried.OrderBy(t => Rank(t.Plan.Verdict))
                        .ThenBy(t => GameClock.TryParse(t.Plan.ProjectedArrivalGameTime) ?? DateTime.MaxValue)
                        .First();
        var shortest = tried.OrderBy(t => (t.Dh?.MilesBefore + t.Dh?.MilesAfter ?? 0) + (t.Ld?.MilesBefore + t.Ld?.MilesAfter ?? 0)).First();

        if (!ReferenceEquals(best.Plan, shortest.Plan) && shortest.Plan.ProjectedArrivalGameTime != best.Plan.ProjectedArrivalGameTime)
        {
            var saved = (GameClock.TryParse(shortest.Plan.ProjectedArrivalGameTime) - GameClock.TryParse(best.Plan.ProjectedArrivalGameTime))?.TotalHours;
            var name = (shortest.Ld ?? shortest.Dh)?.Route.Label ?? "the shortest way";
            var chose = (best.Ld ?? best.Dh)?.Route.Label ?? "another way";
            best.Plan.Warnings.Insert(0, saved is > 0.01
                ? $"Cross {chose} rather than {name}: it is further to drive, but you arrive {Hhmm.Of(saved.Value)} sooner — " +
                  "the sailing times decide it."
                : $"Cross {chose} rather than {name} — the plan comes out better that way.");
        }
        return best.Plan;
    }

    /// <summary>Legs scaled so the shortest way across reads the listing's own distance.</summary>
    private static List<Option> Scale(List<Option> options, double listedMiles)
    {
        if (options.Count == 0 || listedMiles <= 0) return options;
        var shortest = options.Min(o => o.MilesBefore + o.MilesAfter);
        if (shortest <= 0.01) return options.Select(o => o with { MilesBefore = listedMiles / 2, MilesAfter = listedMiles / 2 }).ToList();
        var k = listedMiles / shortest;
        return options.Select(o => o with { MilesBefore = o.MilesBefore * k, MilesAfter = o.MilesAfter * k }).ToList();
    }
}

/// <summary>A crossing on one leg of a plan: the route, which way, and the road before and after it.</summary>
public sealed record CrossingLeg(string Route, bool FromA, double MilesBefore, double MilesAfter);
