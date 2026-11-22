using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>A coach company: what kind of work it runs, how good a driver it wants, what it pays, and its depots.</summary>
public record Company(
    string Id, string RealName, string InventedName,
    /// <summary>Line (scheduled lines and night lines), Tour (excursions and tours), or Mixed (both).</summary>
    string Kind,
    /// <summary>1 budget, 2 mainstream, 3 premium.</summary>
    int Tier,
    string About,
    string[] Depots,
    string[] Coaches)
{
    public string Name(CoachCareer c) => c.Settings.Roster == "Invented" ? InventedName : RealName;
    public IEnumerable<(string City, string Cc)> DepotList => Depots.Select(Companies.Split);
    public bool RunsLines => Kind is "Line" or "Mixed";
    public bool RunsTours => Kind is "Tour" or "Mixed";
}

/// <summary>
/// The roster, the ranks and who may join whom.
///
/// <para>No public source lists coach operators' depots, so these are designed from where each operator's real network
/// centres, on cities the ETS2 map has. Line operators run timetabled lines and night lines; tour houses run excursions
/// and multi-day tours; mixed firms run both. Better companies want better drivers: higher coach level, the skills
/// their work needs, and a record of happy passengers and kept timetables. They pay more for it.</para>
/// </summary>
public static class Companies
{
    public static readonly List<Company> All = new()
    {
        // ---- budget
        new("blablacar", "BlaBlaCar Bus", "Rideshare Coachlines", "Line", 1,
            "Low-cost intercity lines across France and Benelux, and into Germany from Frankfurt.",
            // Frankfurt: BlaBlaCar Bus ran German lines on the same budget network, and it gives a rookie a German base.
            new[] { "Paris|FR", "Lyon|FR", "Bordeaux|FR", "Marseille|FR", "Nantes|FR", "Strasbourg|FR", "Lille|FR", "Brussel|BE",
                    "Frankfurt am Main|DE" },
            new[] { "MAN Lion's Coach", "Scania Touring" }),
        new("ecolines", "Ecolines", "Amber Road Express", "Line", 1,
            "Budget lines around the Baltic states and Poland.",
            new[] { "Rīga|LV", "Vilnius|LT", "Tallinn|EE", "Kaunas|LT", "Daugavpils|LV", "Warszawa|PL" },
            new[] { "MAN Lion's Coach" }),
        new("arriva-dk", "Arriva", "Nordlys Regional", "Mixed", 1,
            "Regional coaches and local excursions across Denmark.",
            new[] { "København|DK", "Aarhus|DK", "Odense|DK", "Aalborg|DK", "Esbjerg|DK" },
            new[] { "Scania Touring", "MAN Lion's Coach" }),
        new("busabout", "Busabout", "Wanderbus Europe", "Tour", 1,
            "Hop-on hop-off backpacker tours around the big European cities.",
            new[] { "London|UK", "Paris|FR", "Amsterdam|NL", "Praha|CZ", "München|DE", "Barcelona|ES", "Roma|IT", "Wien|AT" },
            new[] { "Scania Touring", "MAN Lion's Coach" }),

        // ---- mainstream
        new("flixbus", "FlixBus", "Greenline Intercity", "Line", 2,
            "The big international network: day lines, and two-driver night lines.",
            new[] { "Berlin|DE", "Hamburg|DE", "München|DE", "Frankfurt am Main|DE", "Köln|DE", "Leipzig|DE", "Amsterdam|NL",
                    "Paris|FR", "Milano|IT", "Praha|CZ", "Wien|AT", "Warszawa|PL" },
            new[] { "Volvo 9700 DD", "MAN Lion's Coach", "Scania Touring" }),
        new("national-express", "National Express", "Albion Coachways", "Line", 2,
            "Britain's coach network, London out to the regions.",
            new[] { "London|UK", "Birmingham|UK", "Manchester|UK", "Liverpool|UK", "Glasgow|UK", "Edinburgh|UK", "Cardiff|UK",
                    "Newcastle-upon-Tyne|UK" },
            new[] { "Volvo 9700 DD", "Scania Touring" }),
        new("vy", "Vy Buss", "Fjordline Express", "Line", 2,
            "Express coaches up and down Norway.",
            new[] { "Oslo|NO", "Bergen|NO", "Trondheim|NO", "Stavanger|NO", "Kristiansand|NO", "Lillehammer|NO" },
            new[] { "Scania Touring", "Volvo 9700 DD" }),
        new("alsa", "Alsa", "Meseta Autocares", "Mixed", 2,
            "Spain's lines and excursions, from Madrid to every coast.",
            new[] { "Madrid|ES", "Barcelona|ES", "Sevilla|ES", "València|ES", "Bilbao|ES", "Zaragoza|ES", "A Coruña|ES", "Málaga|ES" },
            new[] { "Scania Touring", "MAN Lion's Coach", "Neoplan Tourliner" }),
        new("leger", "Leger Holidays", "Crossways Coach Holidays", "Tour", 2,
            "Coach holidays from Britain to the Continent.",
            new[] { "London|UK", "Manchester|UK", "Paris|FR", "Brussel|BE", "Amsterdam|NL" },
            new[] { "Neoplan Tourliner", "Scania Touring" }),

        // ---- premium
        new("regiojet", "RegioJet", "Vltava Premium Lines", "Line", 3,
            "Premium service lines from Czechia to Vienna and the Adriatic.",
            new[] { "Praha|CZ", "Brno|CZ", "Ostrava|CZ", "Bratislava|SK", "Košice|SK", "Wien|AT", "Zagreb|HR" },
            new[] { "Neoplan Skyliner", "Neoplan Tourliner" }),
        new("lux-express", "Lux Express", "Baltic Lux Lines", "Line", 3,
            "Premium Baltic lines with a lounge on board.",
            new[] { "Tallinn|EE", "Rīga|LV", "Vilnius|LT", "Tartu|EE", "Kaunas|LT", "Pärnu|EE" },
            new[] { "Neoplan Tourliner", "Scania Touring" }),
        new("trafalgar", "Trafalgar", "Grand Continental Tours", "Tour", 3,
            "Premium guided tours to Europe's great landmarks.",
            new[] { "London|UK", "Paris|FR", "Roma|IT", "Wien|AT", "München|DE", "Amsterdam|NL", "Madrid|ES", "Lisboa|PT",
                    "Athina|GR", "Praha|CZ", "Zürich|CH", "Firenze|IT" },
            new[] { "Neoplan Skyliner", "Neoplan Tourliner" }),
    };

    public static Company? Find(string? id) => All.FirstOrDefault(x => x.Id == id);
    public static Company Of(CoachCareer c) => Find(c.Job.CompanyId) ?? throw new InvalidOperationException("You are not with a company. Join one on the Career tab.");

    /// <summary>"City|CC" to its parts, the city in the one spelling the app keeps (see <see cref="Canon"/>).</summary>
    internal static (string City, string Cc) Split(string key)
    {
        var p = key.Split('|');
        var cc = p.Length > 1 ? p[1].Trim().ToUpperInvariant() : "";
        return (Canon(p[0], cc), cc);
    }

    /// <summary>
    /// The one spelling kept for a city: the English name ETS2 shows with localized names on (Prague, Munich, Vienna),
    /// so "Praha" read off one screenshot and "Prague" off another are the same place. Core's CityNames.
    /// </summary>
    public static string Canon(string? city, string? cc) => CityNames.Canonical(city, cc);

    public static string Key(string city, string cc) => $"{city}|{cc}";
    public static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    public static bool SamePlace(string c1, string cc1, string c2, string cc2) =>
        Same(cc1, cc2) && (Same(c1, c2) || Same(Canon(c1, cc1), Canon(c2, cc2)));

    // ---------------------------------------------------------------- ranks

    public static readonly string[] RankNames =
        { "", "Probationary driver", "Line driver", "Senior line driver", "Excursion driver", "Tour driver" };

    public static string RankName(int rank) => rank is >= 1 and <= 5 ? RankNames[rank] : "Driver";

    /// <summary>The ranks a company has: a line operator tops out at Senior; a tour house goes from probation to excursions to tours.</summary>
    public static int[] Ladder(Company co) => co.Kind switch
    {
        "Line" => new[] { 1, 2, 3 },
        "Tour" => new[] { 1, 4, 5 },
        _ => new[] { 1, 2, 3, 4, 5 },
    };

    public static int? NextRank(Company co, int rank)
    {
        var ladder = Ladder(co);
        var i = Array.IndexOf(ladder, rank);
        return i >= 0 && i + 1 < ladder.Length ? ladder[i + 1] : null;
    }

    /// <summary>The hourly rate: the company's tier, plus what the rank adds. Euros.</summary>
    public static decimal HourlyRate(Company co, int rank) =>
        (co.Tier switch { 1 => 14.50m, 2 => 16.00m, _ => 17.50m })
        + (rank switch { 2 => 1.00m, 3 => 2.00m, 4 => 2.50m, 5 => 3.50m, _ => 0m });

    // ---------------------------------------------------------------- the record

    public record Record(int Duties, double AvgSatisfaction, double Punctuality, int Level, bool DismissedLately);

    /// <summary>The driver's record over their last thirty closed duties, whoever they ran them for.</summary>
    public static Record RecordOf(CoachCareer c)
    {
        var done = c.Duties.Where(d => d.Status == "Done").TakeLast(30).ToList();
        var now = GameClock.TryParse(c.GameTime);
        var dismissedLately = c.History.Any(h => h.Ended is "Dismissed" or "ProbationFailed"
            && GameClock.TryParse(h.To) is { } t && now is { } n && (n - t).TotalDays < 60);
        return new Record(done.Count,
            done.Count == 0 ? 0 : Math.Round(done.Average(d => d.FinalSatisfaction), 1),
            done.Count == 0 ? 0 : Math.Round(done.Average(d => d.PunctualityPct), 1),
            c.Discipline.Level, dismissedLately);
    }

    /// <summary>What a company asks of a new driver, as plain lines. Empty when nothing stands in the way.</summary>
    public static List<string> WhyNot(CoachCareer c, Company co)
    {
        var why = new List<string>();
        var s = c.Profile.Skills;
        var r = RecordOf(c);
        if (c.History.Any(h => h.CompanyId == co.Id && h.Ended is "Dismissed" or "ProbationFailed"))
            why.Add("They let you go. They will not take you back.");
        if (c.Started && c.Job.Status == "Active" && c.Job.CompanyId == co.Id)
            why.Add("You already drive for them.");
        if (co.Tier >= 2)
        {
            if (c.Profile.CoachLevel < 4) why.Add($"Coach level 4 or more (you have {c.Profile.CoachLevel}).");
            if (s.DemandingTimetables < 1) why.Add("At least 1 point in Demanding Timetables.");
            if (r.Duties >= 5 && r.AvgSatisfaction < 70) why.Add($"Passengers at 70% or better on average (yours: {r.AvgSatisfaction:0}%).");
            if (r.Duties >= 5 && r.Punctuality < 90) why.Add($"90% of stops on time (yours: {r.Punctuality:0}%).");
            if (r.DismissedLately) why.Add("No dismissal in the last 60 days.");
        }
        if (co.Tier >= 3)
        {
            if (c.Profile.CoachLevel < 10) why.Add($"Coach level 10 or more (you have {c.Profile.CoachLevel}).");
            if (s.PremiumService < 2) why.Add("At least 2 points in Premium Service.");
            if (s.CushionedJourney < 2) why.Add("At least 2 points in Cushioned Journey.");
            if (r.Duties < 30) why.Add($"30 duties on your record (you have {r.Duties}).");
            else
            {
                if (r.AvgSatisfaction < 85) why.Add($"Passengers at 85% or better on average (yours: {r.AvgSatisfaction:0}%).");
                if (r.Punctuality < 95) why.Add($"95% of stops on time (yours: {r.Punctuality:0}%).");
            }
            if (r.Level > 0) why.Add("A clean discipline record: no warning standing.");
        }
        return why;
    }

    /// <summary>
    /// Join a company. The first job starts on probation at the bottom; a driver who has already passed probation
    /// somewhere starts on the company's first full rank with a shorter probation.
    /// </summary>
    public static string Hire(CoachCareer c, string companyId, string homeKey, bool force = false)
    {
        var co = Find(companyId) ?? throw new InvalidOperationException("No company by that name.");
        var why = WhyNot(c, co);
        if (why.Count > 0 && !force) throw new InvalidOperationException($"{co.Name(c)} will not take you yet: {string.Join(" ", why)}");
        var (city, cc) = Split(homeKey);
        if (!co.DepotList.Any(d => SamePlace(d.City, d.Cc, city, cc)))
            throw new InvalidOperationException($"{city} is not one of {co.Name(c)}'s depots.");

        var now = GameClock.TryParse(c.GameTime) ?? GameClock.FromDay(1, 8, 0);
        if (c.Started && c.Job.Status == "Active" && Find(c.Job.CompanyId) is { } old)
            Leave(c, old, "Resigned", $"Left for {co.Name(c)}.");

        var experienced = c.History.Any(h => h.Rank >= 2 || h.Ended == "Resigned" && h.Rank >= 2);
        var entry = experienced ? Ladder(co)[1] : 1;
        var probationDays = experienced ? 30 : 90;
        c.Job = new Employment
        {
            CompanyId = co.Id,
            Rank = entry,
            HiredGameTime = GameClock.Format(now),
            OnProbation = true,
            ProbationEndsGameTime = GameClock.Format(now.AddDays(probationDays)),
            Status = "Active",
            HomeCity = city,
            HomeCc = cc,
            CoachModel = co.Coaches[0],
            FleetNumber = $"{co.Id[..2].ToUpperInvariant()}-{100 + (Math.Abs(StableHash(c.Profile.DriverName + co.Id)) % 900)}",
            LastReviewGameTime = GameClock.Format(now),
        };
        c.Depots = co.DepotList.Select(d => new Depot { City = d.City, Cc = d.Cc }).ToList();
        // A new company, a new coach: whatever happened to the last one stays with the last company.
        c.Coach = new CoachCondition();
        // The home depot is where the driver is now: reached, and opened once the garage is confirmed.
        foreach (var d in c.Depots.Where(d => SamePlace(d.City, d.Cc, city, cc))) d.Reached = true;
        c.Discipline = new DisciplineState();
        c.Board.Clear();
        CoachStore.Log(c, "career", $"Joined {co.Name(c)} as {RankName(entry).ToLowerInvariant()}, based at {city}. " +
                                    $"Probation runs {probationDays} days. Your coach: {c.Job.CoachModel}, fleet number {c.Job.FleetNumber}.");
        return $"{co.Name(c)} has taken you on: {RankName(entry)}, based at {city}, on {probationDays} days' probation.";
    }

    /// <summary>The end of a job: kept on the record, with how it ended.</summary>
    public static void Leave(CoachCareer c, Company co, string ended, string why)
    {
        c.History.Add(new PastJob
        {
            CompanyId = co.Id, CompanyName = co.Name(c), Rank = c.Job.Rank, From = c.Job.HiredGameTime,
            To = c.GameTime, Ended = ended, Why = why,
        });
        c.Job.Status = ended == "Resigned" ? "Resigned" : "Dismissed";
        CoachStore.Log(c, "career", $"{co.Name(c)}: {ended.ToLowerInvariant()}. {why}");
    }

    internal static int StableHash(string s)
    {
        unchecked
        {
            var h = 23;
            foreach (var ch in s) h = h * 31 + ch;
            return h;
        }
    }

    // ---------------------------------------------------------------- promotion

    public record Step(int Rank, int Duties, double Satisfaction, double Punctuality, int MaxLevel, int CoachLevel,
                       (string Skill, int Points)[] Skills);

    /// <summary>What it takes to reach each rank.</summary>
    public static Step Needs(int rank) => rank switch
    {
        2 => new(2, 10, 65, 85, 1, 0, Array.Empty<(string, int)>()),
        3 => new(3, 25, 78, 93, 1, 8, new[] { ("LongerDuties", 2), ("DemandingTimetables", 2) }),
        4 => new(4, 20, 82, 92, 0, 6, new[] { ("PassengerFavourite", 1), ("CushionedJourney", 1) }),
        5 => new(5, 25, 88, 95, 0, 14, new[] { ("CushionedJourney", 3), ("PremiumService", 2), ("LongerDuties", 3) }),
        _ => new(rank, 0, 0, 0, 4, 0, Array.Empty<(string, int)>()),
    };

    /// <summary>What still stands between the driver and the next rank, as lines. Empty when they qualify.</summary>
    public static List<string> PromotionGaps(CoachCareer c, Company co, int next)
    {
        var need = Needs(next);
        var mine = c.Duties.Where(d => d.Status == "Done" && d.CompanyId == co.Id).ToList();
        var recent = mine.TakeLast(15).ToList();
        var gaps = new List<string>();
        if (c.Job.OnProbation && c.Job.Rank == 1) gaps.Add("Pass probation first.");
        if (mine.Count < need.Duties) gaps.Add($"{need.Duties} duties with {co.Name(c)} ({mine.Count} so far).");
        var sat = recent.Count == 0 ? 0 : recent.Average(d => d.FinalSatisfaction);
        var punct = recent.Count == 0 ? 0 : recent.Average(d => d.PunctualityPct);
        if (recent.Count > 0 && sat < need.Satisfaction) gaps.Add($"Passengers at {need.Satisfaction:0}% over your last 15 duties (now {sat:0}%).");
        if (recent.Count > 0 && punct < need.Punctuality) gaps.Add($"{need.Punctuality:0}% of stops on time over your last 15 duties (now {punct:0}%).");
        if (c.Discipline.Level > need.MaxLevel)
            gaps.Add(need.MaxLevel == 0 ? "No warning standing." : "Nothing beyond a verbal warning standing.");
        if (Maintenance.WearGap(c) is { } wear) gaps.Add(wear);
        if (c.Profile.CoachLevel < need.CoachLevel) gaps.Add($"Coach level {need.CoachLevel} (you have {c.Profile.CoachLevel}).");
        foreach (var (skill, pts) in need.Skills)
            if (c.Profile.Skills.Get(skill) < pts) gaps.Add($"{pts} points in {CoachSkills.Word(skill)} (you have {c.Profile.Skills.Get(skill)}).");
        return gaps;
    }

    /// <summary>
    /// The end of probation, and the rank reviews after it. Run on every catch-up; each part only does what is due.
    /// Returns what was decided, for the log and the close-out.
    /// </summary>
    public static List<string> Review(CoachCareer c)
    {
        var said = new List<string>();
        if (!c.Started || c.Job.Status != "Active" || Find(c.Job.CompanyId) is not { } co) return said;
        var now = GameClock.TryParse(c.GameTime);
        if (now == null) return said;

        if (c.Job.OnProbation && GameClock.TryParse(c.Job.ProbationEndsGameTime) is { } ends && now >= ends)
        {
            var mine = c.Duties.Where(d => d.Status == "Done" && d.CompanyId == co.Id).ToList();
            var sat = mine.Count == 0 ? 0 : mine.Average(d => d.FinalSatisfaction);
            if (mine.Count >= 8 && sat >= 65 && c.Discipline.Level <= 1)
            {
                c.Job.OnProbation = false;
                var promoted = c.Job.Rank == 1 ? NextRank(co, 1) : null;
                if (promoted is { } p) c.Job.Rank = p;
                var line = $"Probation passed with {co.Name(c)}" + (promoted is { } q ? $": you are a {RankName(q).ToLowerInvariant()} now." : ".");
                said.Add(line);
                CoachStore.Log(c, "career", line);
            }
            else if (!c.Job.ProbationExtended && mine.Count < 8 && c.Discipline.Level <= 1)
            {
                // Not enough work to judge: one extension, then it is judged on what there is.
                c.Job.ProbationExtended = true;
                c.Job.ProbationEndsGameTime = GameClock.Format(now.Value.AddDays(30));
                var line = $"Probation extended 30 days: {mine.Count} duties is not enough to judge. Eight is the least.";
                said.Add(line);
                CoachStore.Log(c, "career", line);
            }
            else
            {
                Leave(c, co, "ProbationFailed", $"Probation not passed: {mine.Count} duties, passengers at {sat:0}% on average" +
                                                (c.Discipline.Level >= 2 ? ", and a written reprimand on file." : "."));
                said.Add($"{co.Name(c)} has not kept you on after probation. Find another company on the Career tab.");
            }
            return said;
        }

        // A rank review once a fortnight after probation.
        if (!c.Job.OnProbation && GameClock.TryParse(c.Job.LastReviewGameTime) is { } last && (now.Value - last).TotalDays >= 14
            && NextRank(co, c.Job.Rank) is { } next)
        {
            c.Job.LastReviewGameTime = c.GameTime;
            if (PromotionGaps(c, co, next).Count == 0)
            {
                c.Job.Rank = next;
                var line = $"Promoted: {RankName(next).ToLowerInvariant()} with {co.Name(c)}. The rate goes up to {Units.Money(HourlyRate(co, next))} an hour.";
                said.Add(line);
                CoachStore.Log(c, "career", line);
            }
        }
        return said;
    }
}
