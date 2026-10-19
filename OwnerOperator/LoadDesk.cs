using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>One board load as the owner/operator sees it: can it be made, and what does it leave after costs.</summary>
public class LoadView
{
    public BoardLoad Load { get; set; } = new();
    public FeasibilityResult Feasibility { get; set; } = new();

    public double Miles { get; set; }
    public decimal GamePay { get; set; }
    public decimal CostPerMile { get; set; }
    public decimal Cost { get; set; }

    /// <summary>What the load leaves at the game's own pay. A broker's rate comes in below this.</summary>
    public decimal NetAtGamePay { get; set; }
    public double Days { get; set; }
    public decimal NetPerDay { get; set; }

    /// <summary>Things about the driver's skills and this load. The game should not have listed it if one applies.</summary>
    public List<string> SkillNotes { get; set; } = new();
    public List<string> Notes { get; set; } = new();
    public int Rank { get; set; }
}

/// <summary>
/// The board, ranked. No authorize and no reject: the app plans each load through Core's <see cref="LoadPlanner"/>,
/// prices it on the cost per mile, and ranks; the player chooses. See the plan, "Choosing loads".
/// </summary>
public static class LoadDesk
{
    /// <summary>The least time any load is counted as taking, for the per-day figure. See <see cref="View"/>.</summary>
    public const double MinimumDays = 0.5;

    public static List<LoadView> Evaluate(OoCareer c)
    {
        var s = c.Game;
        var truck = DispatchEngine.AssignedTruck(s);
        var trailer = DispatchEngine.AssignedTrailer(s);
        var views = s.Board.Select(l => View(c, l, truck, trailer)).ToList();

        var ranked = views
            .OrderBy(v => v.Feasibility.Verdict switch { "Feasible" => 0, "Tight" => 1, _ => 2 })
            .ThenByDescending(v => v.NetPerDay)
            .ToList();
        for (var i = 0; i < ranked.Count; i++) ranked[i].Rank = i + 1;
        return ranked;
    }

    public static LoadView View(OoCareer c, BoardLoad load, Truck? truck, Trailer? trailer)
    {
        var s = c.Game;
        var e = new LoadEvaluation { Load = load };
        LoadPlanner.Plan(s, load, truck, trailer, e);
        var f = e.Feasibility;

        var miles = f.TotalMiles > 0 ? f.TotalMiles : load.LoadedMiles + load.DeadheadMiles;
        var cost = Math.Round(c.Settings.CostPerMile * (decimal)miles, 2);
        var net = load.GameRevenue - cost;
        // The whole time the truck is tied up: from now to empty at the receiver, rests and waits included. Never less
        // than half a day: a short hop still costs most of a shift once finding and reaching the next load is counted,
        // and dividing by five hours made a 250-mile run look like it earned four times its pay in a day.
        var days = Math.Max(MinimumDays, f.ElapsedHours / 24.0);

        var v = new LoadView
        {
            Load = load,
            Feasibility = f,
            Miles = Math.Round(miles, 1),
            GamePay = load.GameRevenue,
            CostPerMile = c.Settings.CostPerMile,
            Cost = cost,
            NetAtGamePay = net,
            Days = Math.Round(days, 2),
            NetPerDay = Math.Round(net / (decimal)days, 2),
        };
        v.SkillNotes.AddRange(SkillNotes(c, load));
        v.Notes.AddRange(e.Cons);

        // Home, once it is close to due: which loads head there and which take the truck away.
        if (!HomeLife.AtHome(c) && c.HomeLife.LeftHomeGameTime.Length > 0
            && GameClock.HoursBetween(c.HomeLife.LeftHomeGameTime, s.Status.GameTime) is { } outHours
            && c.HomeLife.EveryDays - outHours / 24 <= 4
            && Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, c.Profile.HomeCity, c.Profile.HomeState) is { } fromHere
            && Geo.MilesBetween(load.DestCity, load.DestState, c.Profile.HomeCity, c.Profile.HomeState) is { } fromThere)
        {
            var due = c.HomeLife.EveryDays - outHours / 24;
            if (fromThere < fromHere - 50)
                v.Notes.Add($"Heads home: finishes {Units.Distance(fromThere)} from {c.Profile.HomeCity}, and you are due home in {Math.Max(0, due):0.#} days.");
            else if (fromThere > fromHere + 50)
                v.Notes.Add($"Takes you further from home ({Units.Distance(fromThere)} from {c.Profile.HomeCity}), with home due in {Math.Max(0, due):0.#} days.");
        }

        var dest = Markets.Find(s, load.DestCity, load.DestState);
        if (dest is { Tier: 3 })
            v.Notes.Add($"{load.DestCity}, {load.DestState} is a thin market. Expect to run empty to get the next load.");
        return v;
    }

    /// <summary>The longest job the game offers at this Long Distance level, or null for anywhere.</summary>
    public static double? LongDistanceLimit(OoCareer c)
    {
        var limits = c.Settings.LongDistanceLimits;
        var level = Math.Clamp(c.Profile.Skills.LongDistance, 0, OoSkills.Max);
        return level < limits.Count ? limits[level] : null;
    }

    /// <summary>
    /// Where this load needs a skill the driver has not unlocked. The game hides such jobs, so one of these means
    /// a skill on file is out of date or a listing was misread, and it is said rather than refused.
    /// </summary>
    public static IEnumerable<string> SkillNotes(OoCareer c, BoardLoad load)
    {
        var k = c.Profile.Skills;
        if (LongDistanceLimit(c) is { } limit && load.LoadedMiles > limit)
            yield return $"{Units.Distance(load.LoadedMiles)} is past what Long Distance {k.LongDistance} unlocks " +
                         $"({Units.Distance(limit)}). The game should not have listed it: check your level, or the distance.";
        if (load.IsHazmat && k.Adr.Count == 0)
            yield return "Hazardous cargo, and you have no ADR classes on file. Check your skills.";
        else if (load.IsHazmat && !string.IsNullOrWhiteSpace(load.HazmatClass)
                 && !k.Adr.Any(a => load.HazmatClass.Contains(a, StringComparison.OrdinalIgnoreCase)
                                    || a.Contains(load.HazmatClass, StringComparison.OrdinalIgnoreCase)))
            yield return $"Hazardous cargo ({load.HazmatClass}) in a class you have not unlocked. Check your ADR skill.";
        if (load.IsFragile && k.Fragile == 0)
            yield return "Fragile cargo needs the Fragile skill. Check your skills.";
        if (load.IsUrgent && k.JustInTime == 0)
            yield return "An urgent job needs Just-In-Time. Check your skills.";
    }
}
