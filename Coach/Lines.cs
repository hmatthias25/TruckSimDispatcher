using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>A job as read off the game's menu, or typed in: the stops and times, before it is a line in the library.</summary>
public class OfferInput
{
    /// <summary>Contract or Tourist.</summary>
    public string? Menu { get; set; }
    public List<StopInput>? Stops { get; set; }
    public string? Landmark { get; set; }
    /// <summary>Local or Global.</summary>
    public string? LandmarkScope { get; set; }
    public decimal? Pay { get; set; }
    public int? Passengers { get; set; }
    /// <summary>Tourist: when the group is due back, if the menu shows it.</summary>
    public string? ReturnTime { get; set; }
    /// <summary>The number of stops the menu shows, the first and last included. The cities between are not named there.</summary>
    public int? StopCount { get; set; }
}

public class StopInput
{
    public string? City { get; set; }
    public string? Cc { get; set; }
    public string? Station { get; set; }
    public string? Time { get; set; }
}

/// <summary>
/// The route library.
///
/// <para>No source lists the Coaches DLC's lines, so the app builds its own from what the game offers: every job read
/// off the Contract and Tourist menus is saved as a line, assumed to run every day at the same times. Seeing it again
/// confirms it. The library is what lets the company plan a turnaround home, or know which line brings the driver back
/// tomorrow, instead of stranding them in a hotel. Shown read-only on the Routes tab.</para>
/// </summary>
public static class Lines
{
    public const double KmPerMile = 1.609344;
    /// <summary>Average speed for times the menu did not show: motorway and town together, km/h.</summary>
    public const double PlanningKmh = 68;

    /// <summary>Road km between two places, off Core's ETS2 road table. 0 where neither can be placed.</summary>
    public static double Km(string cityA, string ccA, string cityB, string ccB)
    {
        if (Companies.SamePlace(cityA, ccA, cityB, ccB)) return 0;
        return Geo.MilesBetween(cityA, ccA, cityB, ccB) is { } mi ? Math.Round(mi * KmPerMile) : 0;
    }

    public static string Place(string city, string cc) => string.IsNullOrWhiteSpace(cc) ? city : $"{city}, {cc}";

    /// <summary>A typed city put right: the map's own spelling where it is near enough, as typed otherwise.</summary>
    public static (string City, string Cc) Normalise(string? city, string? cc)
    {
        var c = (city ?? "").Trim();
        var k = (cc ?? "").Trim().ToUpperInvariant();
        if (k == "GB") k = "UK";
        if (c.Length == 0) return (c, k);
        if (Geo.Knows(c, k)) return (Companies.Canon(c, k), k);
        return Geo.Nearest(c, k) is { } near ? (Companies.Canon(near, k), k) : (c, k);
    }

    static TimeSpan? Tod(string? t)
    {
        var s = (t ?? "").Trim();
        return TimeSpan.TryParse(s, out var ts) && ts.TotalHours < 24 ? ts : null;
    }

    static string Fmt(TimeSpan t) => $"{(int)t.TotalHours % 24:00}:{t.Minutes:00}";

    /// <summary>
    /// Turn what the menu showed into a line: stops placed on the map, times filled in from the distance where the menu
    /// showed none, the days a night line crosses counted, and the kind worked out.
    /// </summary>
    public static Line Build(OfferInput o, bool breaks = false)
    {
        var tourist = string.Equals(o.Menu, "Tourist", StringComparison.OrdinalIgnoreCase);
        var raw = (o.Stops ?? new()).Where(s => !string.IsNullOrWhiteSpace(s.City)).ToList();
        if (raw.Count == 0) throw new InvalidOperationException("A job needs at least its first stop.");
        if (!tourist && raw.Count < 2) throw new InvalidOperationException("A line needs at least two stops.");
        if (Tod(raw[0].Time) == null) throw new InvalidOperationException("The first stop needs its departure time, e.g. 08:15.");

        var stops = raw.Select(s =>
        {
            var (city, cc) = Normalise(s.City, s.Cc);
            return new LineStop { City = city, Cc = cc, Station = (s.Station ?? "").Trim(), Time = Tod(s.Time) is { } t ? Fmt(t) : "" };
        }).ToList();

        var line = new Line { Kind = tourist ? "Tourist" : "Line" };
        if (tourist)
        {
            line.Landmark = (o.Landmark ?? "").Trim();
            line.LandmarkScope = string.Equals(o.LandmarkScope, "Global", StringComparison.OrdinalIgnoreCase) ? "Global" : "Local";
            // A round trip: out to the landmark and back to where the group boarded.
            if (stops.Count == 1) stops.Add(new LineStop { City = stops[0].City, Cc = stops[0].Cc, Station = line.Landmark });
            var back = new LineStop { City = stops[0].City, Cc = stops[0].Cc, Station = stops[0].Station, Time = Tod(o.ReturnTime) is { } r ? Fmt(r) : "" };
            if (!Companies.SamePlace(stops[^1].City, stops[^1].Cc, back.City, back.Cc) || stops.Count == 2) stops.Add(back);
            // The landmark visit: two hours for a local one, three for a famous one.
            stops[1].DwellMinutes = line.LandmarkScope == "Global" ? 180 : 120;
            if (string.IsNullOrWhiteSpace(stops[1].Station)) stops[1].Station = line.Landmark;
        }

        // Stops on the way the menu counted but did not name: the line goes to its last stop, calling somewhere between.
        var unknown = tourist ? 0 : Math.Max(0, (o.StopCount ?? 0) - stops.Count);

        // Distances along the line.
        var n = stops.Count;
        var cum = new double[n];
        var expected = new double[n];   // minutes after the first departure, from the distance alone
        for (var i = 1; i < n; i++)
        {
            var leg = Km(stops[i - 1].City, stops[i - 1].Cc, stops[i].City, stops[i].Cc);
            if (leg <= 0 && !Companies.SamePlace(stops[i - 1].City, stops[i - 1].Cc, stops[i].City, stops[i].Cc)) leg = 80;
            if (tourist && i == 1 && leg <= 0) leg = 40;          // a landmark outside town
            if (tourist && i == 2 && leg <= 0) leg = cum[1];      // back the way they came
            cum[i] = cum[i - 1] + leg;
            var driveMinutes = Math.Round(leg / PlanningKmh * 60 / 5) * 5;
            // With breaks on, a leg over 4h30 at the wheel has its 45-minute break on the way, and the timetable allows for it.
            if (breaks && driveMinutes > Hours.BreakAfter * 60) driveMinutes += 45;
            expected[i] = expected[i - 1] + driveMinutes + (i == 1 ? 0 : stops[i - 1].DwellMinutes);
        }
        // Each unnamed stop on the way stands the coach a while, and the long way round through it costs a little more.
        if (unknown > 0) expected[n - 1] += unknown * 15;

        // Times the menu showed are fixed. Each wraps at midnight to the day nearest where the distance puts it, never
        // before the last fixed time.
        var first = Tod(stops[0].Time)!.Value.TotalMinutes;
        var abs = new double?[n];
        abs[0] = 0;
        double lastFixed = 0;
        for (var i = 1; i < n; i++)
        {
            if (Tod(stops[i].Time) is not { } shown) continue;
            var t = shown.TotalMinutes - first;
            while (t < lastFixed) t += 1440;
            while (t + 1440 - expected[i] < expected[i] - t && t + 1440 >= lastFixed && expected[i] - t > 720) t += 1440;
            abs[i] = t;
            lastFixed = t;
        }
        // The rest are worked out: between two fixed times in proportion to the distance, after the last from the distance.
        for (var i = 1; i < n; i++)
        {
            if (abs[i] != null) continue;
            var a = i - 1;
            var b = Enumerable.Range(i + 1, n - i - 1).FirstOrDefault(j => abs[j] != null);
            double v;
            if (b > 0)
            {
                var span = cum[b] - cum[a];
                var share = span > 0 ? (cum[i] - cum[a]) / span : (double)(i - a) / (b - a);
                v = abs[a]!.Value + (abs[b]!.Value - abs[a]!.Value) * share;
            }
            else v = abs[a]!.Value + (expected[i] - expected[a]);
            abs[i] = Math.Round(v / 5) * 5;
            stops[i].Derived = true;
        }
        for (var i = 1; i < n; i++)
        {
            var total = first + abs[i]!.Value;
            stops[i].Time = Fmt(TimeSpan.FromMinutes(Math.Round(total % 1440)));
            stops[i].DayOffset = (int)Math.Floor(total / 1440);
        }
        stops[^1].DwellMinutes = 0;

        line.Stops = stops;
        line.StopCount = stops.Count + unknown;
        line.Km = Math.Round(cum[n - 1]);
        line.GamePay = o.Pay ?? 0;
        line.Passengers = o.Passengers ?? 0;
        if (!tourist && IsNight(line)) line.Kind = "Night";
        return line;
    }

    /// <summary>The minutes after the first departure each stop is reached.</summary>
    public static List<double> Offsets(Line l)
    {
        var first = Tod(l.From.Time)!.Value;
        return l.Stops.Select(s => (TimeSpan.FromDays(s.DayOffset) + (Tod(s.Time) ?? first) - first).TotalMinutes).ToList();
    }

    public static double DurationHours(Line l) => Offsets(l)[^1] / 60.0;

    /// <summary>A night line: any part of the run inside 00:00–05:00.</summary>
    public static bool IsNight(Line l)
    {
        var start = Tod(l.From.Time)!.Value.TotalMinutes;
        var end = start + Offsets(l)[^1];
        for (var t = start; t <= end; t += 15)
        {
            var m = t % 1440;
            if (m >= 0 && m < 300) return true;
        }
        return false;
    }

    /// <summary>
    /// What makes a line the same line: where it starts and ends, when it leaves, and how many stops it makes. Not the
    /// cities between, which the menu does not name: a line read again is the line the driver already filled in.
    /// </summary>
    static string Key(Line l) =>
        $"{l.Kind == "Tourist"}|{Companies.Key(l.From.City, l.From.Cc).ToLowerInvariant()}>{Companies.Key(l.To.City, l.To.Cc).ToLowerInvariant()}" +
        $"|{(l.Kind == "Tourist" ? 0 : Math.Max(l.StopCount, l.Stops.Count))}|{l.From.Time}|{l.Landmark.ToLowerInvariant()}";

    /// <summary>Save a line to the library, or confirm one already in it. Returns the line kept.</summary>
    public static Line Upsert(CoachCareer c, Line fresh)
    {
        var key = Key(fresh);
        var known = c.Lines.FirstOrDefault(l => Key(l) == key);
        if (known == null)
        {
            fresh.FirstSeen = fresh.LastSeen = c.GameTime;
            fresh.TimesSeen = 1;
            c.Lines.Add(fresh);
            return fresh;
        }
        known.LastSeen = c.GameTime;
        known.TimesSeen++;
        // What the menu shows today wins over what was derived before: the arrival time, where it shows one. The cities
        // between, filled in by the driver, are kept.
        if (known.To.Derived && !fresh.To.Derived) known.Stops[^1] = fresh.Stops[^1];
        if (known.Stops.Count == fresh.Stops.Count)
            for (var i = 1; i < known.Stops.Count - 1; i++)
                if (known.Stops[i].Derived && !fresh.Stops[i].Derived) known.Stops[i] = fresh.Stops[i];
        if (fresh.GamePay > 0) known.GamePay = fresh.GamePay;
        if (fresh.Passengers > 0) known.Passengers = fresh.Passengers;
        return known;
    }

    /// <summary>
    /// The board where the driver is: offers read off the menus, each saved to the library. A board for another city
    /// replaces the last one; more of the same city's menu adds to it.
    /// </summary>
    public static List<Offer> AddToBoard(CoachCareer c, IEnumerable<OfferInput> inputs, bool replace)
    {
        if (replace || !Companies.SamePlace(c.BoardCity, c.BoardCc, c.City, c.Cc)) c.Board.Clear();
        c.BoardCity = c.City;
        c.BoardCc = c.Cc;
        var added = new List<Offer>();
        foreach (var o in inputs)
        {
            var line = Upsert(c, Build(o, c.Settings.Breaks));
            if (c.Board.Any(b => b.LineId == line.Id)) continue;
            var offer = new Offer
            {
                LineId = line.Id,
                Menu = line.Kind == "Tourist" ? "Tourist" : "Contract",
                GamePay = o.Pay ?? line.GamePay,
                Passengers = o.Passengers ?? line.Passengers,
                SeenGameTime = c.GameTime,
            };
            c.Board.Add(offer);
            added.Add(offer);
        }
        return added;
    }

    public static Line? Find(CoachCareer c, string? id) => c.Lines.FirstOrDefault(l => l.Id == id);

    /// <summary>
    /// The cities a line calls at on the way, as the driver read them off the game's route: the line in the library is
    /// rebuilt with them, its times between worked out again, its record kept.
    /// </summary>
    public static void FillStops(CoachCareer c, Line l, List<StopInput> between)
    {
        var named = between.Where(s => !string.IsNullOrWhiteSpace(s.City)).ToList();
        if (named.Count != l.UnknownStops)
            throw new InvalidOperationException(l.UnknownStops == 1
                ? $"This line calls at one city before {l.To.City}. Which one?"
                : $"This line calls at {l.UnknownStops} cities before {l.To.City}. Give them in order.");
        var input = new OfferInput
        {
            Menu = "Contract",
            Stops = new List<StopInput> { new() { City = l.From.City, Cc = l.From.Cc, Station = l.From.Station, Time = l.From.Time } }
                .Concat(l.Stops.Skip(1).Take(l.Stops.Count - 2).Select(s => new StopInput { City = s.City, Cc = s.Cc, Station = s.Station, Time = s.Derived ? "" : s.Time }))
                .Concat(named.Select(s => new StopInput { City = s.City, Cc = string.IsNullOrWhiteSpace(s.Cc) ? l.To.Cc : s.Cc, Station = s.Station }))
                .Append(new StopInput { City = l.To.City, Cc = l.To.Cc, Station = l.To.Station, Time = l.To.Derived ? "" : l.To.Time })
                .ToList(),
            Pay = l.GamePay, Passengers = l.Passengers,
        };
        var rebuilt = Build(input, c.Settings.Breaks);
        l.Stops = rebuilt.Stops;
        l.StopCount = rebuilt.StopCount;
        l.Km = rebuilt.Km;
        l.Kind = rebuilt.Kind;
        CoachStore.Log(c, "routes", $"{l.From.City} {l.From.Time} to {l.To.City}: calls at {string.Join(", ", named.Select(s => s.City))}. Saved to the library.");
    }

    /// <summary>When a line next leaves, from a given moment: today's departure if it is still ahead, tomorrow's if not.</summary>
    public static DateTime NextDeparture(Line l, DateTime from, double minLeadMinutes = 0)
    {
        var tod = Tod(l.From.Time)!.Value;
        var dep = from.Date + tod;
        while (dep < from.AddMinutes(minLeadMinutes)) dep = dep.AddDays(1);
        return dep;
    }

    /// <summary>The known line home from the end of another: the same stops reversed, or any line from there to there.</summary>
    public static IEnumerable<(Line Line, DateTime Departs, DateTime Arrives)> From(CoachCareer c, string city, string cc, DateTime after,
        double withinHours = 24)
    {
        foreach (var l in c.Lines.Where(l => l.Kind != "Tourist" && Companies.SamePlace(l.From.City, l.From.Cc, city, cc)))
        {
            var dep = NextDeparture(l, after);
            if ((dep - after).TotalHours > withinHours) continue;
            yield return (l, dep, dep.AddMinutes(Offsets(l)[^1]));
        }
    }

    /// <summary>A line that brings the coach back from this one's last stop to its first, the same day it arrives.</summary>
    public static (Line Line, DateTime Departs)? ReturnWorking(CoachCareer c, Line l, DateTime arrives, double turnaroundMinutes = 30)
    {
        foreach (var (back, dep, _) in From(c, l.To.City, l.To.Cc, arrives.AddMinutes(turnaroundMinutes), 12))
            if (Companies.SamePlace(back.To.City, back.To.Cc, l.From.City, l.From.Cc) && dep.Date == arrives.Date)
                return (back, dep);
        return null;
    }

    // ---------------------------------------------------------------- the Routes tab (read-only)

    public static object View(CoachCareer c, Line l)
    {
        var offs = Offsets(l);
        var now = GameClock.TryParse(c.GameTime) ?? GameClock.FromDay(1, 0, 0);
        var arrive = NextDeparture(l, now.Date).AddMinutes(offs[^1]);
        var back = l.Kind == "Tourist" ? null : ReturnWorking(c, l, arrive);
        return new
        {
            id = l.Id, kind = l.Kind, landmark = l.Landmark, landmarkScope = l.LandmarkScope,
            from = Place(l.From.City, l.From.Cc), to = Place(l.To.City, l.To.Cc),
            departs = l.From.Time, arrives = l.To.Time, nextDay = l.To.DayOffset > 0,
            hours = Math.Round(offs[^1] / 60.0, 2), km = l.Km,
            stopCount = Math.Max(l.StopCount, l.Stops.Count), unknownStops = l.UnknownStops,
            stops = l.Stops.Select(s => new { place = Place(s.City, s.Cc), city = s.City, cc = s.Cc, station = s.Station, time = s.Time, derived = s.Derived, dayOffset = s.DayOffset }),
            gamePay = l.GamePay, passengers = l.Passengers,
            firstSeen = l.FirstSeen, lastSeen = l.LastSeen, timesSeen = l.TimesSeen, timesRun = l.TimesRun,
            avgDelay = Math.Round(l.AvgDelayMinutes, 1), avgSatisfaction = Math.Round(l.AvgSatisfaction, 1),
            returnWorking = back is { } b ? new { id = b.Line.Id, departs = b.Line.From.Time, arrives = b.Line.To.Time } : null,
            depot = c.Depots.Any(d => Companies.SamePlace(d.City, d.Cc, l.From.City, l.From.Cc)),
        };
    }

    /// <summary>Everything leaving from and arriving at a station: the city view on the Routes tab.</summary>
    public static object CityView(CoachCareer c, string city, string cc) => new
    {
        place = Place(city, cc),
        departures = c.Lines.Where(l => Companies.SamePlace(l.From.City, l.From.Cc, city, cc)).OrderBy(l => l.From.Time)
            .Select(l => new { id = l.Id, kind = l.Kind, time = l.From.Time, to = l.Kind == "Tourist" ? l.Landmark : Place(l.To.City, l.To.Cc) }),
        arrivals = c.Lines.Where(l => l.Kind != "Tourist" && Companies.SamePlace(l.To.City, l.To.Cc, city, cc)).OrderBy(l => l.To.Time)
            .Select(l => new { id = l.Id, kind = l.Kind, time = l.To.Time, from = Place(l.From.City, l.From.Cc) }),
        calls = c.Lines.Where(l => l.Stops.Skip(1).SkipLast(1).Any(s => Companies.SamePlace(s.City, s.Cc, city, cc)))
            .Select(l => new { id = l.Id, kind = l.Kind, from = Place(l.From.City, l.From.Cc), to = Place(l.To.City, l.To.Cc) }),
    };
}
