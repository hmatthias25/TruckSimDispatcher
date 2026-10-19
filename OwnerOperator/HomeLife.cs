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

/// <summary>Something at home on a given game day, known ahead.</summary>
public class HomeDate
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Title { get; set; } = "";
    public int Day { get; set; }
    public string AnnouncedGameTime { get; set; } = "";
    /// <summary>Upcoming, Made or Missed.</summary>
    public string Status { get; set; } = "Upcoming";
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
    public const double CallMade = 10;
    public const double CallMissed = 20;
    public const int BottomDays = 7;

    private static readonly string[] Occasions =
    {
        "your daughter's birthday", "your son's ballgame", "your anniversary", "a doctor's appointment",
        "your mother's birthday", "the school play", "a friend's wedding", "the family reunion", "parent-teacher night",
    };
    private static readonly string[] Troubles =
    {
        "The furnace is out and it's cold.", "Your youngest is sick and asking for you.", "The basement flooded.",
        "Your spouse needs you home. It has been too long.", "Your dad had a fall.",
    };

    public static bool AtHome(OoCareer c) =>
        c.Game.Status.LocationCity.Equals(c.Profile.HomeCity, StringComparison.OrdinalIgnoreCase)
        && c.Game.Status.LocationState.Equals(c.Profile.HomeState, StringComparison.OrdinalIgnoreCase);

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
            var gain = PerDayHome * hours / 24 * (Holiday(from) is null ? 1 : 2);
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
            h.Score = Math.Max(0, h.Score - PerDayOut * inside / 24 - PerDayOutPastPromise * past / 24);
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
        foreach (var date in h.Dates.Where(x => x.Status == "Upcoming"))
        {
            if (home && date.Day == today)
            {
                date.Status = "Made";
                h.DatesMade++;
                h.Score = Math.Min(100, h.Score + DateMade);
                said.Add($"Home for {date.Title}.");
            }
            else if (today > date.Day)
            {
                date.Status = "Missed";
                h.Score = Math.Max(0, h.Score - DateMissed);
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

        if (h.Score < CallBelow && h.Call is not { Status: "Open" } && !home && !AtBottom(c))
        {
            var notice = h.Score < 25 ? 2 : 3;
            h.Call = new CallFromHome
            {
                Reason = Troubles[BrokerBook.Stable($"{c.Profile.HomeCity}|{c.Game.Status.GameTime}") % Troubles.Length],
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

    /// <summary>Keep two dates on the calendar, each announced at least a week ahead.</summary>
    private static void ScheduleDates(OoCareer c)
    {
        var h = c.HomeLife;
        var today = GameClock.DayOf(c.Game.Status.GameTime) ?? 1;
        while (h.Dates.Count(x => x.Status == "Upcoming") < 2)
        {
            var seed = BrokerBook.Stable($"{c.Profile.HomeCity}|{c.Profile.StartedGameTime}|{h.NextDateSeed++}");
            var last = h.Dates.Count > 0 ? Math.Max(h.Dates.Max(x => x.Day), today) : today;
            h.Dates.Add(new HomeDate
            {
                Title = Occasions[seed % Occasions.Length],
                Day = Math.Max(today + 7, last + 8 + seed % 10),
                AnnouncedGameTime = c.Game.Status.GameTime,
            });
        }
    }

    /// <summary>
    /// The US holidays when freight goes quiet. ATS keeps a calendar under its day count (Day 1 is 1 January 2000), so
    /// Thanksgiving week, Christmas and New Year fall where they really do.
    /// </summary>
    public static string? Holiday(DateTime at)
    {
        var d = at.Date;
        var thanksgiving = new DateTime(d.Year, 11, 1);
        while (thanksgiving.DayOfWeek != DayOfWeek.Thursday) thanksgiving = thanksgiving.AddDays(1);
        thanksgiving = thanksgiving.AddDays(21);
        if (d >= thanksgiving.AddDays(-1) && d <= thanksgiving.AddDays(3)) return "Thanksgiving";
        if (d.Month == 12 && d.Day >= 22) return d.Day >= 30 ? "New Year" : "Christmas";
        if (d.Month == 1 && d.Day <= 2) return "New Year";
        return null;
    }

    public static string? HolidayNow(OoCareer c) => GameClock.TryParse(c.Game.Status.GameTime) is { } now ? Holiday(now) : null;

    public static object View(OoCareer c)
    {
        var h = c.HomeLife;
        var daysOut = AtHome(c) ? 0 : GameClock.HoursBetween(h.LeftHomeGameTime, c.Game.Status.GameTime) is { } d ? Math.Round(d / 24, 1) : 0;
        return new
        {
            h.EveryDays, h.HomeDays,
            score = Math.Round(h.Score),
            band = h.Score >= 70 ? "Good" : h.Score >= CallBelow ? "Strained" : h.Score > 0 ? "Bad" : "Bottom",
            atHome = AtHome(c),
            daysOut,
            dueHomeInDays = AtHome(c) ? (double?)null : Math.Round(h.EveryDays - daysOut, 1),
            dates = h.Dates.Where(x => x.Status == "Upcoming").OrderBy(x => x.Day),
            recent = h.Dates.Where(x => x.Status != "Upcoming").OrderByDescending(x => x.Day).Take(3),
            call = h.Call is { Status: "Open" } ? h.Call : null,
            bottomUntil = AtBottom(c) ? h.BottomUntilGameTime : null,
            holiday = HolidayNow(c),
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
