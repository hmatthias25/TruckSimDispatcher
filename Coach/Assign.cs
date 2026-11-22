using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>A duty as it would run: the stops with their times, who drives each leg, and the book-on and book-off.</summary>
public record DutyPlan(Line Line, DateTime Departs, List<DutyStop> Stops, string Crew, double MyDriving, double CoDriving,
                       DateTime BookOn, DateTime BookOff);

/// <summary>
/// The company's choice of duty from what the game offers where the driver stands.
///
/// <para>Two questions, in order. What may this driver run: the company's kind of work, the rank, the skills, and the
/// driving hours. Then, of that, which gets them home: a driver at home costs the company nothing overnight, a driver
/// away costs a hotel and the night allowance. So a duty ending at the home depot beats everything; a turnaround the
/// library knows comes next; then a chain of lines home; then ending at a depot with a rest room; a hotel last. Rookies
/// get the night lines, the hours nobody wants. Pay and length matter only between duties otherwise equal.</para>
/// </summary>
public static class Assign
{
    public const int PreTripMinutes = 15, PostTripMinutes = 15;

    static TimeSpan Tod(string t) => TimeSpan.TryParse(t, out var ts) ? ts : TimeSpan.Zero;

    /// <summary>The stops and their times for a line leaving at a moment, and who drives which leg.</summary>
    public static DutyPlan Plan(CoachCareer c, Line l, DateTime departs)
    {
        var offs = Lines.Offsets(l);
        var stops = new List<DutyStop>();
        for (var i = 0; i < l.Stops.Count; i++)
        {
            var s = l.Stops[i];
            var arrive = departs.AddMinutes(offs[i]);
            stops.Add(new DutyStop
            {
                City = s.City, Cc = s.Cc, Station = s.Station,
                ScheduledArrive = i == 0 ? "" : GameClock.Format(arrive),
                ScheduledDepart = i == l.Stops.Count - 1 ? "" : GameClock.Format(i == 0 ? departs : arrive.AddMinutes(s.DwellMinutes)),
                LegKm = i < l.Stops.Count - 1 ? Lines.Km(s.City, s.Cc, l.Stops[i + 1].City, l.Stops[i + 1].Cc) : 0,
            });
        }

        // Each leg's driving time: from the departure to the next arrival.
        var legs = new List<(DateTime From, DateTime To)>();
        for (var i = 0; i < stops.Count - 1; i++)
            legs.Add((GameClock.TryParse(stops[i].ScheduledDepart)!.Value, GameClock.TryParse(stops[i + 1].ScheduledArrive)!.Value));
        var totalDriving = legs.Sum(x => (x.To - x.From).TotalHours);

        // Two drivers: a night line with more than one shift's driving, as the big operators run them, and any line with
        // more driving than one driver's day.
        var crew = (l.Kind == "Night" && totalDriving > Hours.BreakAfter) || totalDriving > Hours.DailyDrive ? "Double" : "Solo";
        if (crew == "Double") AssignLegs(stops, legs, c.Job.Rank == 1 && legs.Any(Night));
        var mine = legs.Select((x, i) => Mine(stops[i], (x.To - x.From).TotalHours)).Sum();
        var bookOn = departs.AddMinutes(-PreTripMinutes);
        var bookOff = GameClock.TryParse(stops[^1].ScheduledArrive)!.Value.AddMinutes(PostTripMinutes);
        return new DutyPlan(l, departs, stops, crew, Math.Round(mine, 2), Math.Round(totalDriving - mine, 2), bookOn, bookOff);
    }

    /// <summary>
    /// Who drives which leg on a double-crewed line. A probationary driver takes the night legs (00:00 to 05:00), the
    /// hours nobody wants; otherwise the two take turns, neither going past 4h30 without the other taking over.
    /// </summary>
    static bool Night((DateTime From, DateTime To) leg)
    {
        for (var t = leg.From; t < leg.To; t = t.AddMinutes(15)) if (t.Hour < 5) return true;
        return false;
    }

    /// <summary>
    /// Who drives which leg with two drivers. On a night line a probationary driver takes the night legs (00:00 to 05:00),
    /// the hours nobody wants; otherwise the two take turns, neither going much past four hours before the other takes over.
    /// A leg too long for one (over 4h30) is handed over at a rest area half way: its driver drives to there, the other on.
    /// </summary>
    static void AssignLegs(List<DutyStop> stops, List<(DateTime From, DateTime To)> legs, bool rookieNights)
    {
        static string Other(string w) => w == "You" ? "Co-driver" : "You";
        string who = rookieNights ? "Co-driver" : "You";
        double run = 0;
        for (var i = 0; i < legs.Count; i++)
        {
            var h = (legs[i].To - legs[i].From).TotalHours;
            var want = rookieNights ? (Night(legs[i]) ? "You" : "Co-driver") : who;
            if (want == who && run + h > 4.0 && run > 0) want = Other(who);
            if (want != who) { who = want; run = 0; }
            stops[i].LegDriver = who;
            if (h > Hours.BreakAfter)
            {
                stops[i].HandoverAfterMinutes = (int)(Math.Round(h * 60 / 2 / 5) * 5);
                who = Other(who);
                run = h / 2;
            }
            else run += h;
        }
    }

    /// <summary>The driver's own share of a leg: all of it, none of it, or their side of a handover.</summary>
    public static double Mine(DutyStop s, double legHours)
    {
        if (s.HandoverAfterMinutes <= 0) return s.LegDriver == "You" ? legHours : 0;
        var first = Math.Min(legHours, s.HandoverAfterMinutes / 60.0);
        return s.LegDriver == "You" ? first : legHours - first;
    }

    /// <summary>Why this driver may not run a line, in plain lines. Empty when they may.</summary>
    public static List<string> WhyNot(CoachCareer c, Company co, Line l)
    {
        var why = new List<string>();
        var rank = c.Job.Rank;
        var sk = c.Profile.Skills;
        var stopsBetween = Math.Max(0, Math.Max(l.StopCount, l.Stops.Count) - 2);
        if (l.Kind == "Tourist")
        {
            // An out-and-back trip, not a timetabled line: any company may take one on as charter work, and how often it
            // goes to a driver follows their experience (see Score). Only a famous landmark asks for a skill.
            if (l.LandmarkScope == "Global" && sk.CushionedJourney < 2) why.Add("A famous landmark needs 2 points in Cushioned Journey.");
        }
        else
        {
            if (!co.RunsLines) why.Add($"{co.Name(c)} runs excursions and tours, not lines.");
            if (rank == 1 && l.Kind != "Night" && l.Km > 250) why.Add("On probation, day lines are 250 km at most.");
            if (rank == 2 && l.Kind != "Night" && l.Km > 600) why.Add("Line drivers run day lines up to 600 km. Longer is for seniors.");
            var countries = l.Stops.Select(s => s.Cc).Distinct().Count();
            if (rank == 1 && l.Kind != "Night" && countries > 1) why.Add("International day lines are not for probationary drivers.");
        }
        if (l.Km > 900 && sk.LongerDuties < 3) why.Add("Over 900 km needs 3 points in Longer Duties.");
        else if (l.Km > 500 && sk.LongerDuties < 1) why.Add("Over 500 km needs a point in Longer Duties.");
        if (stopsBetween >= 7 && sk.DemandingTimetables < 4) why.Add("This many stops needs 4 points in Demanding Timetables.");
        else if (stopsBetween >= 4 && sk.DemandingTimetables < 2) why.Add("This many stops needs 2 points in Demanding Timetables.");
        return why;
    }

    public record Choice(Offer Offer, Line Line, DutyPlan? Plan, int Score, string Ends, List<string> Why, List<string> Reasons);

    /// <summary>Every offer on the board, judged: the reasons it may not be run, or its score and where it leaves the driver.</summary>
    public static List<Choice> Judge(CoachCareer c)
    {
        var co = Companies.Of(c);
        var now = GameClock.TryParse(c.GameTime) ?? GameClock.FromDay(1, 8, 0);
        var list = new List<Choice>();
        foreach (var o in c.Board)
        {
            if (Lines.Find(c, o.LineId) is not { } l) continue;
            var why = WhyNot(c, co, l);
            if (!Companies.SamePlace(l.From.City, l.From.Cc, c.City, c.Cc))
                why.Add($"It leaves from {Lines.Place(l.From.City, l.From.Cc)}, and you are in {Lines.Place(c.City, c.Cc)}.");
            // The next departure with time for the pre-trip check.
            var departs = Lines.NextDeparture(l, now, PreTripMinutes);
            var plan = Plan(c, l, departs);
            if (why.Count == 0) why.AddRange(Hours.Fits(c, plan.BookOn, plan.BookOff, plan.MyDriving, plan.Crew == "Double"));
            if (why.Count == 0) why.AddRange(Maintenance.WhyNot(c, l, plan.BookOn));
            var (score, ends, reasons) = why.Count == 0 ? Score(c, co, l, plan) : (0, "", new List<string>());
            list.Add(new Choice(o, l, plan, score, ends, why, reasons));
        }
        return list.OrderByDescending(x => x.Why.Count == 0).ThenByDescending(x => x.Score).ToList();
    }

    /// <summary>How much the company wants this driver on this duty, where it leaves them, and why.</summary>
    static (int Score, string Ends, List<string> Reasons) Score(CoachCareer c, Company co, Line l, DutyPlan p)
    {
        var score = 0;
        var reasons = new List<string>();
        var home = (c.Job.HomeCity, c.Job.HomeCc);
        var end = l.To;
        var arrive = GameClock.TryParse(p.Stops[^1].ScheduledArrive)!.Value;
        var clocks = Hours.Now(c);
        string ends;

        // On a tour, the day's plan comes first.
        if (Tours.Wants(c, l) is { } tourWhy) { score += 200; reasons.Add(tourWhy); }

        if (Companies.SamePlace(end.City, end.Cc, home.HomeCity, home.HomeCc))
        {
            score += 100;
            ends = "home";
            reasons.Add(l.Kind == "Tourist" ? "A round trip from home: you sleep in your own bed." : "It ends at your home depot.");
        }
        else if (Lines.ReturnWorking(c, l, arrive) is { } back
                 && Companies.SamePlace(back.Line.To.City, back.Line.To.Cc, home.HomeCity, home.HomeCc)
                 && TurnaroundFits(c, p, back.Line, back.Departs))
        {
            score += 80;
            ends = "turnaround";
            reasons.Add($"A turnaround: the {back.Line.From.Time} from {back.Line.From.City} brings you home the same day.");
        }
        else if (ChainHome(c, end.City, end.Cc, arrive) is { } chain)
        {
            score += 50;
            ends = "chain";
            reasons.Add($"Home the same day by {chain}.");
        }
        else if (c.Depots.FirstOrDefault(d => d.Opened && Companies.SamePlace(d.City, d.Cc, end.City, end.Cc)) is { } depot)
        {
            score -= 20;
            ends = "depot";
            reasons.Add($"Ends at the {depot.City} depot: a night in the rest room, not a hotel.");
        }
        else
        {
            score -= 45;
            ends = "away";
            reasons.Add($"Ends in {end.City}, away from home: a hotel and the night allowance.");
        }

        if (ends is not ("home" or "turnaround" or "chain") && clocks.HoursToWeeklyRest < 36 && !clocks.OnTour)
        {
            score -= 60;
            reasons.Add("Your weekly rest is close, and this leaves you away from home for it.");
        }

        // The worst hours go to the newest driver.
        if (l.Kind == "Night") { if (c.Job.Rank == 1) { score += 30; reasons.Add("Night work goes to the probationary drivers."); } else if (c.Job.Rank >= 3) score -= 20; }
        // Tourist trips go to the experienced: rarely to a probationer, more often the higher the rank, and more again at a
        // company whose trade they are.
        if (l.Kind == "Tourist")
        {
            var byRank = c.Job.Rank switch { 1 => -40, 2 => -15, 3 => 0, 4 => 15, _ => 25 };
            score += byRank + (co.RunsTours ? 10 : -10) + (l.LandmarkScope == "Global" ? 5 : 0);
            reasons.Add(c.Job.Rank <= 1 ? "Tourist trips seldom go to probationary drivers."
                : c.Job.Rank >= 4 ? "Tourist trips are your line of work." : "An out-and-back tourist trip.");
        }

        // The coach: something coming up in the garage, or a dent worth a look, leans toward a line that ends at one.
        var (lean, leanWhy) = Maintenance.Lean(c, l);
        if (lean != 0) { score += lean; reasons.Add(leanWhy!); }

        score += (int)Math.Min(20, l.Km / 50) + Math.Min(10, (l.Passengers > 0 ? l.Passengers : 30) / 10);
        return (score, ends, reasons);
    }

    /// <summary>
    /// Whether the way back fits the same working day: from this duty's book-on to the return's book-off inside the
    /// spread, and the two together inside the day's driving. A turnaround that would break the hours is no turnaround.
    /// </summary>
    static bool TurnaroundFits(CoachCareer c, DutyPlan p, Line back, DateTime departs)
    {
        var ret = Plan(c, back, departs);
        var span = (ret.BookOff - p.BookOn).TotalHours;
        var spread = p.Crew == "Double" || ret.Crew == "Double" ? Hours.SpreadMultiManned : Hours.Spread;
        return span <= spread + 0.01 && p.MyDriving + ret.MyDriving <= Hours.ExtendedDrive + 0.01;
    }

    /// <summary>Two known lines that bring the driver home the same day from a city, said as the lines. Null if none.</summary>
    static string? ChainHome(CoachCareer c, string city, string cc, DateTime arrive)
    {
        foreach (var (first, dep1, arr1) in Lines.From(c, city, cc, arrive.AddMinutes(30), 10))
            foreach (var (second, dep2, arr2) in Lines.From(c, first.To.City, first.To.Cc, arr1.AddMinutes(30), 6))
                if (Companies.SamePlace(second.To.City, second.To.Cc, c.Job.HomeCity, c.Job.HomeCc) && arr2.Date == arrive.Date)
                    return $"the {first.From.Time} to {first.To.City} and the {second.From.Time} on from there";
        return null;
    }

    /// <summary>The board as the company sees it: its pick, the others it could have given, and what is not for this driver.</summary>
    public static object View(CoachCareer c)
    {
        if (!c.Started || c.Job.Status != "Active" || c.Board.Count == 0) return new { pick = (object?)null, offers = Array.Empty<object>() };
        var judged = Judge(c);
        var pick = judged.FirstOrDefault(x => x.Why.Count == 0);
        return new
        {
            pick = pick?.Offer.Id,
            offers = judged.Select(x => new
            {
                id = x.Offer.Id, lineId = x.Line.Id, menu = x.Offer.Menu, kind = x.Line.Kind, landmark = x.Line.Landmark,
                landmarkScope = x.Line.LandmarkScope,
                from = Lines.Place(x.Line.From.City, x.Line.From.Cc), to = Lines.Place(x.Line.To.City, x.Line.To.Cc),
                departs = x.Plan == null ? "" : GameClock.Format(x.Plan.Departs),
                arrives = x.Plan == null ? "" : x.Plan.Stops[^1].ScheduledArrive,
                bookOn = x.Plan == null ? "" : GameClock.Format(x.Plan.BookOn),
                stops = Math.Max(x.Line.StopCount, x.Line.Stops.Count), unknownStops = x.Line.UnknownStops,
                between = x.Line.Stops.Skip(1).SkipLast(1).Select(s => s.City),
                km = x.Line.Km, crew = x.Plan?.Crew, myDriving = x.Plan?.MyDriving,
                passengers = x.Offer.Passengers, gamePay = x.Offer.GamePay,
                ok = x.Why.Count == 0, why = x.Why, score = x.Score, ends = x.Ends, reasons = x.Reasons,
                assigned = pick != null && pick.Offer.Id == x.Offer.Id,
            }),
        };
    }
}
