using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// Multi-day coach tours: the tour driver's work, and the best paid.
///
/// <para>The game has no tour job, so the company plans one from places the driver can reach: a group taken from the
/// home depot through a city a day and brought home. Each day's stage is a contract line between the two cities where
/// the library knows one, or a drive with the group where it does not; a tourist job in a tour city is the day's
/// sightseeing. Nights away are paid the night allowance in a hotel the company pays for.</para>
///
/// <para>A tour is a single occasional service, so the weekly rest may be put off for up to twelve days (EU 561/2006
/// as amended in 2024, domestic or international). After a tour that used it, two weekly rests are owed before the
/// next working week.</para>
/// </summary>
public static class Tours
{
    public const int MaxDays = 12, MinDays = 3;

    public static List<string> WhyNot(CoachCareer c)
    {
        var why = new List<string>();
        if (c.Job.Status != "Active") { why.Add("You are not with a company."); return why; }
        var co = Companies.Of(c);
        if (!co.RunsTours) why.Add($"{co.Name(c)} does not run tours.");
        if (c.Job.Rank < 5) why.Add("Tours are for tour drivers.");
        if (c.Tour is { Status: "Running" }) why.Add("You are on a tour.");
        if (!Depots.IsHome(c, c.City, c.Cc)) why.Add("Tours start from your home depot.");
        if (c.Hours.OwesDoubleRest) why.Add("Two weekly rests are owed from the last tour first.");
        return why;
    }

    /// <summary>A tour of a number of days: a city a day, each a reasonable stage from the last, ending at home.</summary>
    public static TourState Plan(CoachCareer c, int days)
    {
        days = Math.Clamp(days, MinDays, MaxDays);
        var home = (c.Job.HomeCity, c.Job.HomeCc);
        // Candidate cities: the company's depots, and everywhere the library knows a line or an excursion from.
        var places = c.Depots.Select(d => (City: d.City, Cc: d.Cc))
            .Concat(c.Lines.SelectMany(l => l.Stops.Select(s => (City: s.City, Cc: s.Cc))))
            // The game's own map, without the cities only ProMods adds.
            .Concat(Markets.BuiltIn.Where(m => m.Tier <= 2 && m.Source != "ProMods").Select(m => (City: m.City, Cc: m.State)))
            .Where(p => Geo.Knows(p.City, p.Cc))
            .Select(p => (City: Companies.Canon(p.City, p.Cc), p.Cc))
            .Where(p => !Companies.SamePlace(p.City, p.Cc, home.HomeCity, home.HomeCc))
            .DistinctBy(p => Companies.Key(p.City, p.Cc).ToLowerInvariant())
            .OrderBy(p => Companies.StableHash($"{c.History.Count}|{c.Duties.Count}|{p.Item1}"))
            .ToList();

        var route = new List<(string City, string Cc)>();
        var at = (home.HomeCity, home.HomeCc);
        for (var day = 1; day < days; day++)
        {
            var next = places.Where(p => !route.Any(r => Companies.SamePlace(r.City, r.Cc, p.City, p.Cc)))
                .Select(p => (p, km: Lines.Km(at.Item1, at.Item2, p.City, p.Cc), back: Lines.Km(p.City, p.Cc, home.HomeCity, home.HomeCc)))
                // Every city within a day's drive of home, so the group can always be brought back.
                .Where(x => x.km is >= 120 and <= 520 && x.back <= 520)
                .OrderBy(x => Math.Abs(x.km - 320))
                .Select(x => x.p).FirstOrDefault();
            if (next == default) break;
            route.Add(next);
            at = next;
        }
        // Home is a day's drive from the last city: where the map ran out further away, the tour turns back sooner.
        while (route.Count > 0 && Lines.Km(route[^1].City, route[^1].Cc, home.HomeCity, home.HomeCc) > 520) route.RemoveAt(route.Count - 1);
        if (route.Count == 0) throw new InvalidOperationException("No cities within a day's drive of home were found for a tour.");

        var tour = new TourState
        {
            Name = $"{route.Count + 1}-day tour: " + string.Join(", ", route.Select(r => r.City)),
            Days = route.Count + 1,
            Passengers = 30 + Math.Abs(Companies.StableHash(c.GameTime)) % 19,
            International = route.Any(r => !Companies.Same(r.Cc, home.HomeCc)),
        };
        var n = 1;
        foreach (var r in route) tour.Itinerary.Add(new TourDay { Day = n++, City = r.City, Cc = r.Cc, Plan = $"Take the group to {r.City}, with time to see it." });
        tour.Itinerary.Add(new TourDay { Day = n, City = home.HomeCity, Cc = home.HomeCc, Plan = "Bring the group home." });
        return tour;
    }

    public static string Start(CoachCareer c, int days)
    {
        var why = WhyNot(c);
        if (why.Count > 0) throw new InvalidOperationException(string.Join(" ", why));
        var t = Plan(c, days);
        t.Status = "Running";
        t.StartGameTime = c.GameTime;
        t.Today = 1;
        c.Tour = t;
        CoachStore.Log(c, "tour", $"Tour started: {t.Name}, {t.Passengers} passengers.");
        return $"Tour started: {t.Name}. Day 1, take the group to {t.Itinerary[0].City}.";
    }

    public static TourDay? Today(CoachCareer c) =>
        c.Tour is { Status: "Running" } t ? t.Itinerary.FirstOrDefault(d => !d.Done) : null;

    /// <summary>Why the company wants this line for the tour today, or null.</summary>
    public static string? Wants(CoachCareer c, Line l)
    {
        if (Today(c) is not { } day) return null;
        if (l.Kind != "Tourist" && Companies.SamePlace(l.To.City, l.To.Cc, day.City, day.Cc))
            return $"Today's tour stage: the group goes to {day.City}.";
        if (l.Kind == "Tourist" && Companies.SamePlace(l.From.City, l.From.Cc, c.City, c.Cc) && c.Tour!.Itinerary.Any(d => d.Done && Companies.SamePlace(d.City, d.Cc, c.City, c.Cc)))
            return $"Sightseeing for the tour group in {c.City}.";
        return null;
    }

    /// <summary>A day's stage with no line for it: the coach and the group, driven to the day's city.</summary>
    public static Line LegLine(CoachCareer c, DateTime departs)
    {
        var day = Today(c) ?? throw new InvalidOperationException("No tour stage is due.");
        var dep = $"{departs:HH:mm}";
        return Lines.Build(new OfferInput
        {
            Menu = "Contract",
            Stops = new() { new() { City = c.City, Cc = c.Cc, Time = dep }, new() { City = day.City, Cc = day.Cc } },
        }, c.Settings.Breaks);
    }

    /// <summary>A duty has closed on a tour: the day is done if it reached the day's city. Returns what happened.</summary>
    public static List<string> AfterDuty(CoachCareer c, Duty d)
    {
        var said = new List<string>();
        if (c.Tour is not { Status: "Running" } t || Today(c) is not { } day) return said;
        d.TourId = t.Id;
        t.Tips += d.Tips;
        if (!Companies.SamePlace(c.City, c.Cc, day.City, day.Cc)) return said;
        day.Done = true;
        t.Today = day.Day + 1;
        if (Today(c) is { } next)
        {
            t.NightsAway++;
            said.Add($"Tour day {day.Day} done: the group is in {day.City} tonight. Tomorrow: {next.Plan}");
            return said;
        }
        t.Status = "Done";
        var co = Companies.Of(c);
        var bonus = 40m * t.Days;
        c.Pay.Pending.Add(new PayLine { GameTime = c.GameTime, Duty = d.Number, Kind = "Tour bonus", Amount = bonus,
            Text = $"Tour completed: {t.Days} days with {co.Name(c)}" });
        var used12 = GameClock.TryParse(c.Hours.LastWeeklyRestEnd) is { } lastWeekly && (GameClock.TryParse(c.GameTime)!.Value - lastWeekly).TotalHours > 144;
        if (used12) c.Hours.OwesDoubleRest = true;
        said.Add($"Tour complete: the group is home after {t.Days} days. A tour bonus of {Units.Money(bonus)}" +
                 (used12 ? ". The tour put your weekly rest off, so two are owed now: 69 hours off before the next working week." : "."));
        CoachStore.Log(c, "tour", said[^1]);
        return said;
    }

    public static object? View(CoachCareer c) => c.Tour == null ? null : new
    {
        c.Tour.Id, c.Tour.Name, c.Tour.Status, c.Tour.Days, c.Tour.Passengers, c.Tour.International, c.Tour.NightsAway, c.Tour.Tips,
        c.Tour.StartGameTime, itinerary = c.Tour.Itinerary, today = Today(c),
    };
}
