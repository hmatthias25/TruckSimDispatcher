using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// EU 561/2006 for a coach driver, kept from what the app logs.
///
/// <para>Driving is the legs the driver drove: departure from one stop to arrival at the next. A co-driver's legs on a
/// double-crewed night line are availability, not driving. Time standing at a stop is a break where it is 15 minutes
/// or more (45 minutes in all, which may be 15 then 30). Time between duties is rest: 9 hours or more is a daily rest,
/// 24 or more a weekly one. The limits: 4h30 to a break, 9 hours a day (10 twice a week), 56 a week, 90 a fortnight,
/// a 13-hour spread from the last daily rest (21 hours shared with a co-driver, who needs only 9 hours' rest in 30),
/// and a weekly rest after six 24-hour periods, or twelve on a single occasional service: a tour.</para>
/// </summary>
public static class Hours
{
    public const double BreakAfter = 4.5, DailyDrive = 9, ExtendedDrive = 10, WeeklyDrive = 56, FortnightDrive = 90;
    public const double Spread = 13, SpreadMultiManned = 21;

    static DateTime Monday(DateTime t) => t.Date.AddDays(-(((int)t.DayOfWeek + 6) % 7));

    /// <summary>Opens the clocks for a new career: fully rested at the start.</summary>
    public static void Start(CoachCareer c, DateTime at)
    {
        c.Hours = new HoursState
        {
            SpreadStart = GameClock.Format(at),
            WeekStart = GameClock.Format(Monday(at)),
            LastWeeklyRestEnd = GameClock.Format(at),
            Fresh = true,
        };
    }

    /// <summary>Roll the calendar week over where a moment falls in a new one.</summary>
    static void Week(HoursState h, DateTime at)
    {
        var start = GameClock.TryParse(h.WeekStart) ?? Monday(at);
        var monday = Monday(at);
        if (monday <= start) return;
        h.DrivenLastWeek = (monday - start).TotalDays <= 7 ? h.DrivenThisWeek : 0;
        h.DrivenThisWeek = 0;
        h.ExtendedDaysUsed = 0;
        h.WeekStart = GameClock.Format(monday);
    }

    /// <summary>
    /// Time off the wheel: a stop, the gap between duties, or a rest reported. What it counts as follows from how long
    /// it was. Returns what it counted as, or null for a gap too short to be anything.
    /// </summary>
    public static string? Off(CoachCareer c, DateTime from, DateTime to, string where = "")
    {
        var h = c.Hours;
        var hours = (to - from).TotalHours;
        if (hours < 0.25) return null;
        Week(h, to);
        string kind;
        if (h.Fresh)
        {
            // Before the first duty of a career the driver has been off all along: the spread starts at book-on.
            Daily(h, to);
            h.Fresh = true;
            return null;
        }
        if (hours >= 24)
        {
            kind = "Weekly";
            h.LastWeeklyRestEnd = GameClock.Format(to);
            if (hours >= 69) h.OwesDoubleRest = false;
            Daily(h, to);
        }
        else if (hours >= 9 || (h.MultiManned && hours >= 9))
        {
            kind = "Daily";
            Daily(h, to);
        }
        else
        {
            kind = "Break";
            h.BreakCredit += hours;
            // 45 minutes in all, in parts of 15 or more: the 15 + 30 split, or one stop long enough.
            if (h.BreakCredit >= 0.75) { h.DrivenSinceBreak = 0; h.BreakCredit = 0; }
        }
        if (kind != "Break" || hours >= 0.75)
            h.Rests.Add(new RestEntry { From = GameClock.Format(from), To = GameClock.Format(to), Kind = kind, Where = where });
        if (h.Rests.Count > 200) h.Rests.RemoveRange(0, h.Rests.Count - 200);
        return kind;
    }

    static void Daily(HoursState h, DateTime to)
    {
        h.SpreadStart = GameClock.Format(to);
        h.DrivenToday = 0;
        h.DrivenSinceBreak = 0;
        h.BreakCredit = 0;
        h.MultiManned = false;
    }

    /// <summary>A leg driven. Returns any limit it broke, said plainly.</summary>
    public static List<string> Drive(CoachCareer c, DateTime from, DateTime to)
    {
        var h = c.Hours;
        var hrs = Math.Max(0, (to - from).TotalHours);
        Week(h, from);
        h.Fresh = false;
        var wasToday = h.DrivenToday;
        h.DrivenToday += hrs;
        h.DrivenSinceBreak += hrs;
        h.DrivenThisWeek += hrs;
        var broke = new List<string>();
        if (c.Settings.Breaks && h.DrivenSinceBreak > BreakAfter + 0.1)
            broke.Add($"{Hhmm.Of(h.DrivenSinceBreak)} driven without a 45-minute break: the limit is 4:30.");
        if (wasToday <= DailyDrive && h.DrivenToday > DailyDrive + 0.05)
        {
            if (h.ExtendedDaysUsed < 2) h.ExtendedDaysUsed++;
            else broke.Add($"A third 10-hour day this week: {Hhmm.Of(h.DrivenToday)} driven today, where 9:00 is the limit.");
        }
        if (h.DrivenToday > ExtendedDrive + 0.1) broke.Add($"{Hhmm.Of(h.DrivenToday)} driven today: 10:00 is the most, twice a week.");
        if (h.DrivenThisWeek > WeeklyDrive + 0.1) broke.Add($"{Hhmm.Of(h.DrivenThisWeek)} driven this week: 56:00 is the limit.");
        if (h.DrivenThisWeek + h.DrivenLastWeek > FortnightDrive + 0.1) broke.Add("Over 90 hours driven in two weeks.");
        if (GameClock.TryParse(h.SpreadStart) is { } s && (to - s).TotalHours > (h.MultiManned ? SpreadMultiManned : 15) + 0.1)
            broke.Add($"Driving {Hhmm.Of((to - s).TotalHours)} after your last daily rest: past the spread.");
        return broke;
    }

    public record Clocks(double DriveLeft, double UntilBreak, double SpreadLeft, double WeekLeft, double FortnightLeft,
                         string WeeklyRestDue, double HoursToWeeklyRest, bool MultiManned, bool OnTour, bool OwesDoubleRest);

    /// <summary>Where the clocks stand at a moment.</summary>
    public static Clocks Now(CoachCareer c, DateTime? at = null)
    {
        var h = c.Hours;
        var now = at ?? GameClock.TryParse(c.GameTime) ?? DateTime.MinValue;
        var monday = Monday(now);
        var thisWeek = GameClock.TryParse(h.WeekStart) is { } ws && Monday(ws) == monday ? h.DrivenThisWeek : 0;
        var lastWeek = GameClock.TryParse(h.WeekStart) is { } ws2 && Monday(ws2) == monday ? h.DrivenLastWeek
                     : GameClock.TryParse(h.WeekStart) is { } ws3 && Monday(ws3) == monday.AddDays(-7) ? h.DrivenThisWeek : 0;
        var dayLimit = h.ExtendedDaysUsed < 2 ? ExtendedDrive : DailyDrive;
        var spreadLimit = h.MultiManned ? SpreadMultiManned : Spread;
        var spreadUsed = GameClock.TryParse(h.SpreadStart) is { } st ? (now - st).TotalHours : 0;
        var onTour = c.Tour is { Status: "Running" };
        var weeklyDue = (GameClock.TryParse(h.LastWeeklyRestEnd) ?? now).AddHours(onTour ? 288 : 144);
        return new Clocks(
            Math.Max(0, dayLimit - h.DrivenToday),
            Math.Max(0, BreakAfter - h.DrivenSinceBreak),
            Math.Max(0, spreadLimit - spreadUsed),
            Math.Max(0, WeeklyDrive - thisWeek),
            Math.Max(0, FortnightDrive - thisWeek - lastWeek),
            GameClock.Format(weeklyDue),
            Math.Round((weeklyDue - now).TotalHours, 2),
            h.MultiManned, onTour, h.OwesDoubleRest);
    }

    /// <summary>
    /// Whether a duty fits the clocks, if it starts at a moment: the driver's own driving against today and the week,
    /// the duty's length against the spread, and the end against the weekly rest. The reasons it does not, or empty.
    /// The gap before it counts as rest where it is long enough.
    /// </summary>
    public static List<string> Fits(CoachCareer c, DateTime bookOn, DateTime bookOff, double myDriving, bool doubleCrew)
    {
        var why = new List<string>();
        var now = GameClock.TryParse(c.GameTime) ?? bookOn;
        var gap = (bookOn - now).TotalHours;
        var k = Now(c, bookOn);
        var restedFirst = gap >= 9 || c.Hours.Fresh;
        var weeklyFirst = gap >= 24;
        var driveLeft = restedFirst ? (c.Hours.ExtendedDaysUsed < 2 ? ExtendedDrive : DailyDrive) : k.DriveLeft;
        var spreadLeft = restedFirst ? (doubleCrew ? SpreadMultiManned : Spread)
                       : doubleCrew ? Math.Max(0, k.SpreadLeft + (SpreadMultiManned - Spread)) : k.SpreadLeft;
        var weekLeft = k.WeekLeft;
        if (c.Hours.OwesDoubleRest && !weeklyFirst)
            why.Add("Two weekly rests are owed after the tour: 69 hours off before the next working week.");
        if (myDriving > driveLeft + 0.05)
            why.Add($"{Hhmm.Of(myDriving)} of your own driving, with {Hhmm.Of(driveLeft)} left today.");
        if ((bookOff - bookOn).TotalHours > spreadLeft + 0.05)
            why.Add($"A {Hhmm.Of((bookOff - bookOn).TotalHours)} duty, with {Hhmm.Of(spreadLeft)} of the spread left" +
                    (restedFirst ? "." : ". A daily rest first would reset it."));
        if (myDriving > weekLeft + 0.05) why.Add($"{Hhmm.Of(myDriving)} of driving, with {Hhmm.Of(weekLeft)} left this week.");
        if (!weeklyFirst && GameClock.TryParse(k.WeeklyRestDue) is { } due && bookOff > due)
            why.Add($"Your weekly rest is due by {GameClock.Pretty(due)}, before this duty would end.");
        return why;
    }

    public static object View(CoachCareer c)
    {
        var k = Now(c);
        return new
        {
            driveLeft = Math.Round(k.DriveLeft, 2), untilBreak = Math.Round(k.UntilBreak, 2), spreadLeft = Math.Round(k.SpreadLeft, 2),
            weekLeft = Math.Round(k.WeekLeft, 2), fortnightLeft = Math.Round(k.FortnightLeft, 2),
            weeklyRestDue = k.WeeklyRestDue, hoursToWeeklyRest = k.HoursToWeeklyRest, multiManned = k.MultiManned,
            onTour = k.OnTour, owesDoubleRest = k.OwesDoubleRest, breaks = c.Settings.Breaks,
            rests = c.Hours.Rests.TakeLast(12).Reverse(),
        };
    }
}
