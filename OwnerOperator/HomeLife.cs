using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// Home life: the standing between the driver and home, kept the way a broker's is. The US reason to go home, where
/// the EU has a law. Agreed as the design on 2026-10-18; see the plan, "Home time". The numbers are first guesses,
/// to be tuned by playing (open question 10).
/// </summary>
public class HomeLifeState
{
    /// <summary>The promise: home every so many days, for so many days.</summary>
    public int EveryDays { get; set; } = 14;
    public int HomeDays { get; set; } = 3;

    /// <summary>0 to 100. Starts at 80: a new venture, and home is behind it.</summary>
    public double Score { get; set; } = 80;

    /// <summary>When the truck last left home, and when it last got there.</summary>
    public string LeftHomeGameTime { get; set; } = "";
    public string AtHomeSinceGameTime { get; set; } = "";
    /// <summary>Already counted the bonus for a full home time this stay.</summary>
    public bool FullStayCounted { get; set; }

    public List<HomeDate> Dates { get; set; } = new();
    public int DatesMade { get; set; }
    public int NextDateSeed { get; set; } = 1;

    public CallFromHome? Call { get; set; }
    /// <summary>Set when home life hits bottom: home, and no freight, until then.</summary>
    public string BottomUntilGameTime { get; set; } = "";
}

/// <summary>
/// Who is at home: a partner, and children, each optionally named. It decides how much home asks of the driver: how many
/// dates there are, how fast home life drops, how soon home calls, and the promise suggested. Asked for from play: single
/// means fewer obligations, married with two kids many more.
/// </summary>
public class Family
{
    public bool Partner { get; set; }
    public string PartnerName { get; set; } = "";
    public List<Kid> Kids { get; set; } = new();
}

public class Kid
{
    public string Name { get; set; } = "";
    /// <summary>Daughter or Son.</summary>
    public string Kind { get; set; } = "Daughter";
}

/// <summary>Something at home on a given game day, known ahead.</summary>
public class HomeDate
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Title { get; set; } = "";
    public int Day { get; set; }
    public string AnnouncedGameTime { get; set; } = "";
    /// <summary>Upcoming, Made or Missed.</summary>
    public string Status { get; set; } = "Upcoming";
    /// <summary>A family holiday (Thanksgiving, Christmas, New Year's Day): it costs more to miss, and is not one of the ordinary dates.</summary>
    public bool Holiday { get; set; }
    /// <summary>What missing it costs, where not the ordinary <see cref="HomeLife.DateMissed"/>.</summary>
    public double MissCost { get; set; }
}

/// <summary>Home ringing instead of a broker: be home by a time.</summary>
public class CallFromHome
{
    public string Reason { get; set; } = "";
    public string RaisedGameTime { get; set; } = "";
    public string BeHomeByGameTime { get; set; } = "";
    /// <summary>Open, Made or Missed.</summary>
    public string Status { get; set; } = "Open";
}

public static class HomeLife
{
    public const double CallBelow = 40;
    public const double PerDayOut = 2;
    public const double PerDayOutPastPromise = 5;
    public const double PerDayHome = 10;
    public const double FullStayBonus = 10;
    public const double DateMade = 15;
    public const double DateMissed = 25;
    /// <summary>A family holiday made, and missed: with a partner, and with children.</summary>
    public const double HolidayMade = 20, HolidayMissedPartner = 30, HolidayMissedKids = 40;
    /// <summary>How far ahead a family holiday goes on the calendar.</summary>
    public const int HolidayNoticeDays = 45;
    public const double CallMade = 10;
    public const double CallMissed = 20;
    public const int BottomDays = 7;


    public static bool AtHome(OoCareer c) =>
        c.Game.Status.LocationCity.Equals(c.Profile.HomeCity, StringComparison.OrdinalIgnoreCase)
        && c.Game.Status.LocationState.Equals(c.Profile.HomeState, StringComparison.OrdinalIgnoreCase);

    /// <summary>Why home is pulling, in the app's words and a broker's, and the day it is pulling toward where there is one.</summary>
    public record HomePull(string Why, string Said, int? Day);

    /// <summary>The miles a job may end from home and still count as getting the driver there.</summary>
    public const double NearHomeMiles = 75;

    /// <summary>
    /// Why home is pulling now, or null: home has called, a date at home within five days, home life under 40, or the
    /// promise due within five days. Brokers aim the next load home on it. Asked for from play: "if my home life value is
    /// getting low what do I do to get back home?"
    /// </summary>
    public static HomePull? Pull(OoCareer c)
    {
        if (AtHome(c)) return null;
        var h = c.HomeLife;
        if (h.Call is { Status: "Open" }) return new("home has called", "you've got family calling you home", null);
        var today = GameClock.DayOf(c.Game.Status.GameTime) ?? 1;
        if (h.Dates.Where(d => d.Status == "Upcoming" && d.Day - today <= 5).OrderBy(d => d.Day).FirstOrDefault() is { } date)
            return new($"{date.Title} on Day {date.Day}", $"you've got {date.Title} on Day {date.Day}", date.Day);
        if (h.Score < CallLine(c)) return new("home life is low", "you've been out a long while", null);
        if (h.LeftHomeGameTime.Length > 0 && GameClock.HoursBetween(h.LeftHomeGameTime, c.Game.Status.GameTime) is { } outHours
            && h.EveryDays - outHours / 24 <= 5)
            return new("you are due home", "you're due home", null);
        return null;
    }

    /// <summary>Whether a place is home, or near enough that a load ending there gets the driver home.</summary>
    public static bool NearHome(OoCareer c, string city, string state) =>
        (city.Equals(c.Profile.HomeCity, StringComparison.OrdinalIgnoreCase) && state.Equals(c.Profile.HomeState, StringComparison.OrdinalIgnoreCase))
        || Geo.MilesBetween(city, state, c.Profile.HomeCity, c.Profile.HomeState) is <= NearHomeMiles;

    /// <summary>
    /// The run home, empty, planned on the clocks as they stand: how far, when the truck gets there, and the rests on the
    /// way. Null at home, or with a load booked (that is delivered first).
    /// </summary>
    public static FeasibilityResult? Route(OoCareer c)
    {
        var s = c.Game;
        if (AtHome(c) || Calls.ActiveBooking(c) != null) return null;
        if (Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, c.Profile.HomeCity, c.Profile.HomeState) is not { } miles) return null;
        var req = new PlanRequest
        {
            OriginCity = s.Status.LocationCity,
            OriginState = s.Status.LocationState,
            DestCity = c.Profile.HomeCity,
            DestState = c.Profile.HomeState,
            LoadedMiles = miles,
            DeadlineHours = 24 * 14,
            IncludePreTrip = true,
            UsableFuelRangeMiles = HosEngine.UsableRange(s.Settings, DispatchEngine.AssignedTruck(s), s.Status.FuelPct),
            StartGameTime = s.Status.GameTime,
            Label = "Home",
        };
        return Crossings.PlanBest(s, req, DispatchEngine.AssignedTruck(s));
    }

    public static bool AtBottom(OoCareer c) =>
        GameClock.TryParse(c.HomeLife.BottomUntilGameTime) is { } until
        && GameClock.TryParse(c.Game.Status.GameTime) is { } now && now < until;

    /// <summary>Start of a career: home, with the first date on the calendar.</summary>
    public static void Begin(OoCareer c)
    {
        c.HomeLife = new HomeLifeState { AtHomeSinceGameTime = c.Game.Status.GameTime, FullStayCounted = true };
        ScheduleDates(c);
    }

    /// <summary>
    /// The clock moved from <paramref name="fromTime"/>, and the truck was at <paramref name="wasHome"/> before it.
    /// Time counts as home only where the truck was home both before and after; anything else was on the road.
    /// </summary>
    public static List<string> Advance(OoCareer c, string fromTime, bool wasHome)
    {
        var said = new List<string>();
        var h = c.HomeLife;
        if (GameClock.TryParse(fromTime) is not { } from || GameClock.TryParse(c.Game.Status.GameTime) is not { } now || now <= from)
        {
            Arrive(c, wasHome, said);
            return said;
        }
        var home = AtHome(c);
        var hours = (now - from).TotalHours;

        if (wasHome && home)
        {
            var gain = PerDayHome * hours / 24 * (Holiday(c, from) is null ? 1 : 2);
            h.Score = Math.Min(100, h.Score + gain);
        }
        else
        {
            if (wasHome) h.LeftHomeGameTime = fromTime;
            // Split at the promise: the days inside it cost a little, the days past it cost more. One rate for the
            // whole stretch charged a fortnight out at the broken-promise rate the moment it was reported in one go.
            var promise = GameClock.TryParse(h.LeftHomeGameTime) is { } left ? left.AddDays(h.EveryDays) : now;
            var inside = Math.Max(0, ((promise < now ? promise : now) - from).TotalHours);
            var past = hours - inside;
            var weight = Weight(c);
            h.Score = Math.Max(0, h.Score - weight * (PerDayOut * inside / 24 + PerDayOutPastPromise * past / 24));
        }
        Arrive(c, wasHome, said);

        // A full home time, as promised, counts for more than the days in it.
        if (home && !h.FullStayCounted && GameClock.HoursBetween(h.AtHomeSinceGameTime, c.Game.Status.GameTime) is { } stayed
            && stayed >= h.HomeDays * 24)
        {
            h.FullStayCounted = true;
            h.Score = Math.Min(100, h.Score + FullStayBonus);
            said.Add($"A proper home time: {h.HomeDays} days, as promised.");
        }

        // Dates at home: made by being home on the day, missed once the day is gone.
        var today = GameClock.DayOf(now);
        var fromDay = GameClock.DayOf(from);
        foreach (var date in h.Dates.Where(x => x.Status == "Upcoming"))
        {
            // Home on the day, or home the whole stretch the clock just moved across it. Reported from play: home from
            // Day 14 to 16 with nothing reported on the 15th, and the 15th's date marked missed.
            if ((home && date.Day == today) || (wasHome && home && date.Day >= fromDay && date.Day <= today))
            {
                date.Status = "Made";
                h.DatesMade++;
                h.Score = Math.Min(100, h.Score + (date.Holiday ? HolidayMade : DateMade));
                said.Add($"Home for {date.Title}.");
            }
            else if (today > date.Day)
            {
                date.Status = "Missed";
                h.Score = Math.Max(0, h.Score - (date.MissCost > 0 ? date.MissCost : DateMissed));
                said.Add($"You missed {date.Title}.");
            }
        }

        // The call from home: made by getting there, missed by the deadline.
        if (h.Call is { Status: "Open" } call)
        {
            if (home) { call.Status = "Made"; h.Score = Math.Min(100, h.Score + CallMade); said.Add("You made it home."); }
            else if (GameClock.TryParse(call.BeHomeByGameTime) is { } by && now > by)
            {
                call.Status = "Missed";
                h.Score = Math.Max(0, h.Score - CallMissed);
                said.Add("You did not make it home in time.");
            }
        }

        if (h.Score < CallLine(c) && h.Call is not { Status: "Open" } && !home && !AtBottom(c))
        {
            // Less notice the more there is at home: a sick child does not wait three days.
            var fam = FamilyOf(c);
            var notice = fam.Kids.Count > 0 ? (h.Score < 25 ? 1 : 2) : fam.Partner ? (h.Score < 25 ? 2 : 3) : 4;
            var troubles = TroublesFor(fam);
            h.Call = new CallFromHome
            {
                Reason = troubles[BrokerBook.Stable($"{c.Profile.HomeCity}|{c.Game.Status.GameTime}") % troubles.Count],
                RaisedGameTime = c.Game.Status.GameTime,
                BeHomeByGameTime = GameClock.Format(now.AddDays(notice)),
            };
            said.Add($"Home called: {h.Call.Reason} Be home within {notice} days.");
        }

        if (h.Score <= 0 && !AtBottom(c))
        {
            h.BottomUntilGameTime = GameClock.Format(now.AddDays(BottomDays));
            said.Add($"Home life has hit bottom. Go home: no freight for {BottomDays} days.");
        }

        ScheduleDates(c);
        foreach (var line in said) OoStore.Log(c, "home", line);
        return said;
    }

    private static void Arrive(OoCareer c, bool wasHome, List<string> said)
    {
        var h = c.HomeLife;
        var home = AtHome(c);
        if (home && !wasHome)
        {
            h.AtHomeSinceGameTime = c.Game.Status.GameTime;
            h.FullStayCounted = false;
            said.Add("Home.");
        }
    }

    /// <summary>
    /// Keep the calendar filled for the family: one date at a time when single, two with a partner, more with children,
    /// closer together the more there is at home. Each is announced at least a week ahead.
    /// </summary>
    private static void ScheduleDates(OoCareer c)
    {
        var h = c.HomeLife;
        var fam = FamilyOf(c);
        var today = GameClock.DayOf(c.Game.Status.GameTime) ?? 1;
        var wanted = fam.Kids.Count > 0 ? 2 + Math.Min(2, fam.Kids.Count) : fam.Partner ? 2 : 1;
        var (gap, spread) = fam.Kids.Count > 0 ? (5, 8) : fam.Partner ? (8, 10) : (12, 12);
        var occasions = OccasionsFor(fam);
        ScheduleHolidays(c, fam, today);
        while (h.Dates.Count(x => x.Status == "Upcoming" && !x.Holiday) < wanted)
        {
            var seed = BrokerBook.Stable($"{c.Profile.HomeCity}|{c.Profile.StartedGameTime}|{h.NextDateSeed++}");
            var last = h.Dates.Count > 0 ? Math.Max(h.Dates.Max(x => x.Day), today) : today;
            h.Dates.Add(new HomeDate
            {
                Title = occasions[seed % occasions.Count],
                Day = Math.Max(today + 7, last + gap + seed % spread),
                AnnouncedGameTime = c.Game.Status.GameTime,
            });
        }
    }

    /// <summary>
    /// With a family, Thanksgiving, Christmas and New Year's Day go on the calendar about six weeks ahead: be home on the
    /// day. Missing one costs more than an ordinary date, and more with children. A single driver has none. Asked for from
    /// play: "if they are out during these and have a family that would be... bad. Single doesn't matter really."
    /// </summary>
    private static void ScheduleHolidays(OoCareer c, Family fam, int today)
    {
        var h = c.HomeLife;
        if (!fam.Partner && fam.Kids.Count == 0) return;
        var year = Calendar(c, GameClock.FromDay(today, 0, 0)).Year;
        var cost = fam.Kids.Count > 0 ? HolidayMissedKids : HolidayMissedPartner;
        foreach (var y in new[] { year, year + 1 })
            foreach (var (day, title) in new[]
                     {
                         (ThanksgivingDay(c, y), "Thanksgiving"),
                         (GameDay(c, new DateTime(y, 12, 25)), "Christmas"),
                         (GameDay(c, new DateTime(y + 1, 1, 1)), "New Year's Day"),
                     })
            {
                if (day <= today || day - today > HolidayNoticeDays || h.Dates.Any(d => d.Holiday && d.Day == day)) continue;
                h.Dates.Add(new HomeDate { Title = title, Day = day, Holiday = true, MissCost = cost, AnnouncedGameTime = c.Game.Status.GameTime });
            }
    }

    /// <summary>
    /// Thanksgiving's game day in a calendar year, on the app's own weekdays (Day 1 is a Monday, see GameClock), so it falls
    /// on the Thursday the app shows. Worked out on the real calendar of 2000 it landed on a Monday here.
    /// </summary>
    public static int ThanksgivingDay(OoCareer c, int year)
    {
        // The remainder kept positive: a November before the career started is at negative game days, and C#'s % is
        // negative there, so a plain d % 7 never reached 4 and the search ran on into the career's own days.
        var d = GameDay(c, new DateTime(year, 11, 1));
        while (((d % 7) + 7) % 7 != 4) d++;
        return d + 21;
    }

    /// <summary>Days the career's calendar runs ahead of the game's count: none for a January start, 59 for March.</summary>
    public static int CalendarOffset(OoCareer c) => GameClock.DayOf(new DateTime(2000, Math.Clamp(c.StartMonth, 1, 12), 1)) - 1;

    /// <summary>The calendar date a game time falls on, for this career.</summary>
    public static DateTime Calendar(OoCareer c, DateTime gameTime) => gameTime.AddDays(CalendarOffset(c));

    /// <summary>The game day a calendar date falls on, for this career.</summary>
    public static int GameDay(OoCareer c, DateTime calendarDate) => GameClock.DayOf(calendarDate) - CalendarOffset(c);

    // ---------------------------------------------------------------- the family

    public static Family FamilyOf(OoCareer c) => c.Family ?? new Family();

    /// <summary>How hard days away bite: 0.6 single, 1.0 with a partner, and 0.2 more for each child, to 1.8 at most.</summary>
    public static double Weight(OoCareer c)
    {
        var f = FamilyOf(c);
        return Math.Min(1.8, (f.Partner ? 1.0 : 0.6) + 0.2 * f.Kids.Count);
    }

    /// <summary>Below this home calls: 30 single, 40 with a partner, 45 with children.</summary>
    public static double CallLine(OoCareer c)
    {
        var f = FamilyOf(c);
        return f.Kids.Count > 0 ? 45 : f.Partner ? CallBelow : 30;
    }

    /// <summary>The promise to suggest: home every 21 days single, 14 with a partner, 10 with children.</summary>
    public static int SuggestedEveryDays(Family f) => f.Kids.Count > 0 ? 10 : f.Partner ? 14 : 21;

    /// <summary>What the family means, in a line, for the Home tab.</summary>
    public static string FamilySays(OoCareer c)
    {
        var f = FamilyOf(c);
        var who = f.Kids.Count > 0 ? $"{(f.Partner ? "A partner and " : "")}{f.Kids.Count} kid{(f.Kids.Count == 1 ? "" : "s")}" : f.Partner ? "A partner" : "Single";
        var dates = f.Kids.Count > 0 ? 2 + Math.Min(2, f.Kids.Count) : f.Partner ? 2 : 1;
        var w = Weight(c);
        var drops = w < 1 ? "slowly" : w <= 1 ? "at the usual rate" : $"{w:0.#}× as fast as with a partner alone";
        return $"{who}: {dates} date{(dates == 1 ? "" : "s")} on the calendar at a time, home life drops {drops}, home calls below " +
               $"{CallLine(c):0}. Suggested: home every {SuggestedEveryDays(f)} days.";
    }

    private static string Possessive(string name, string fallback) => string.IsNullOrWhiteSpace(name) ? fallback : $"{name.Trim()}'s";

    private static List<string> OccasionsFor(Family f)
    {
        var list = new List<string> { "your mother's birthday", "a friend's wedding", "the family reunion", "a doctor's appointment" };
        if (!f.Partner && f.Kids.Count == 0) list.AddRange(new[] { "your buddy's birthday", "your dad's birthday" });
        if (f.Partner)
        {
            var p = Possessive(f.PartnerName, "your partner's");
            list.AddRange(new[] { $"{p} birthday", "your anniversary", $"dinner with {p} parents" });
        }
        foreach (var k in f.Kids)
        {
            var son = k.Kind.Equals("Son", StringComparison.OrdinalIgnoreCase);
            var who = Possessive(k.Name, son ? "your son's" : "your daughter's");
            list.AddRange(new[] { $"{who} birthday", son ? $"{who} ballgame" : $"{who} recital", $"{who} school play", "parent-teacher night" });
        }
        return list;
    }

    private static List<string> TroublesFor(Family f)
    {
        var list = new List<string> { "The furnace is out and it's cold.", "The basement flooded.", "Your dad had a fall." };
        if (f.Partner) list.Add($"{(string.IsNullOrWhiteSpace(f.PartnerName) ? "Your partner" : f.PartnerName.Trim())} needs you home. It has been too long.");
        foreach (var k in f.Kids)
            list.Add($"{(string.IsNullOrWhiteSpace(k.Name) ? (k.Kind == "Son" ? "Your son" : "Your daughter") : k.Name.Trim())} is sick and asking for you.");
        if (!f.Partner && f.Kids.Count == 0) list.Add("Your mother needs help at home.");
        return list;
    }

    /// <summary>
    /// A family set or changed. The dates still to come are replaced with ones for the family as it is now; nothing past
    /// is touched, and home life is not charged for it.
    /// </summary>
    public static void SetFamily(OoCareer c, Family f)
    {
        if (f.Kids.Count > 8) throw new InvalidOperationException("Eight kids at most.");
        f.PartnerName = f.Partner ? (f.PartnerName ?? "").Trim() : "";
        foreach (var k in f.Kids) { k.Name = (k.Name ?? "").Trim(); k.Kind = k.Kind == "Son" ? "Son" : "Daughter"; }
        c.Family = f;
        c.HomeLife.Dates.RemoveAll(d => d.Status == "Upcoming");
        ScheduleDates(c);
        OoStore.Log(c, "home", $"Family: {FamilySays(c)}");
    }

    /// <summary>
    /// A career from before families: single, as decided with the project owner on 2026-10-19, with the dates still to come
    /// (a daughter's and a son's among them) cleared and replaced by a single driver's. True where it changed anything.
    /// </summary>
    public static bool MigrateFamily(OoCareer c)
    {
        if (!c.Started || c.Family != null) return false;
        SetFamily(c, new Family());
        return true;
    }

    /// <summary>
    /// The US holidays when freight goes quiet, on the career's calendar: Day 1 falls on the 1st of the month chosen when the
    /// career started (January on a career from before that), and Thanksgiving week, Christmas and New Year fall from there.
    /// </summary>
    public static string? Holiday(OoCareer c, DateTime at)
    {
        var day = GameClock.DayOf(at.Date);
        var d = Calendar(c, at.Date);
        var thanksgiving = ThanksgivingDay(c, d.Year);
        if (day >= thanksgiving - 1 && day <= thanksgiving + 3) return "Thanksgiving";
        if (d.Month == 12 && d.Day >= 22) return d.Day >= 30 ? "New Year" : "Christmas";
        if (d.Month == 1 && d.Day <= 2) return "New Year";
        return null;
    }

    public static string? HolidayNow(OoCareer c) => GameClock.TryParse(c.Game.Status.GameTime) is { } now ? Holiday(c, now) : null;

    public static object View(OoCareer c)
    {
        var h = c.HomeLife;
        var daysOut = AtHome(c) ? 0 : GameClock.HoursBetween(h.LeftHomeGameTime, c.Game.Status.GameTime) is { } d ? Math.Round(d / 24, 1) : 0;
        return new
        {
            h.EveryDays, h.HomeDays,
            score = Math.Round(h.Score),
            band = h.Score >= 70 ? "Good" : h.Score >= CallLine(c) ? "Strained" : h.Score > 0 ? "Bad" : "Bottom",
            family = FamilyOf(c),
            familySays = FamilySays(c),
            suggestedEveryDays = SuggestedEveryDays(FamilyOf(c)),
            callBelow = CallLine(c),
            atHome = AtHome(c),
            daysOut,
            dueHomeInDays = AtHome(c) ? (double?)null : Math.Round(h.EveryDays - daysOut, 1),
            dates = h.Dates.Where(x => x.Status == "Upcoming").OrderBy(x => x.Day),
            recent = h.Dates.Where(x => x.Status != "Upcoming").OrderByDescending(x => x.Day).Take(3),
            call = h.Call is { Status: "Open" } ? h.Call : null,
            bottomUntil = AtBottom(c) ? h.BottomUntilGameTime : null,
            holiday = HolidayNow(c),
            // A family holiday within a week, while away: said above every tab so there is time to get home for it.
            holidayComing = AtHome(c) ? null : h.Dates.Where(d => d.Holiday && d.Status == "Upcoming"
                                                               && d.Day - (GameClock.DayOf(c.Game.Status.GameTime) ?? 0) <= 7)
                                                     .OrderBy(d => d.Day).FirstOrDefault(),
        };
    }

    /// <summary>The promise, changed. Not free every week: each change costs a little.</summary>
    public static void SetPromise(OoCareer c, int everyDays, int homeDays)
    {
        if (everyDays < 5 || everyDays > 42) throw new InvalidOperationException("Home every 5 to 42 days.");
        if (homeDays < 1 || homeDays > 10) throw new InvalidOperationException("Home for 1 to 10 days.");
        var h = c.HomeLife;
        if (h.EveryDays == everyDays && h.HomeDays == homeDays) return;
        h.EveryDays = everyDays;
        h.HomeDays = homeDays;
        h.Score = Math.Max(0, h.Score - 3);
        OoStore.Log(c, "home", $"The promise is now home every {everyDays} days, for {homeDays}.");
    }
}
