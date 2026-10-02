using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The EU counters the driver does not type. An HOS companion's status line in ETS2 shows four figures —
/// "B 4:30 D 10:00 W 56:00 2W 90", break, day, week and fortnight, all hours left — and that is all the
/// driver reports. Everything else the rules need is worked out here, from those reports and the trip log,
/// and shown read-only:
///
/// <list type="bullet">
/// <item><b>10-hour days used</b> this week: the driving on each day, taken from how far W fell between
/// reports on that day. A day over nine hours was an extended one.</item>
/// <item><b>The daily limit</b>: ten while the week has a 10-hour day left, nine once both are used — and
/// a D typed above nine then is capped to nine, because the day cannot have ten in it.</item>
/// <item><b>The weekly rest</b>: the last rest of 24 hours or more in the trip log — how long ago it
/// ended, whether it was reduced, and the hours a reduced one is owed.</item>
/// <item><b>Reduced daily rests</b> since it: logged rests of nine hours or more and under eleven.</item>
/// <item><b>The spread</b>: <see cref="HosEngine.EstimateEuSpread"/>.</item>
/// </list>
/// </summary>
public static class EuCounters
{
    /// <summary>
    /// A logged span that is time off under EU rules, whatever it was logged as. The law has no "break" and
    /// "rest" kinds — nine hours off is a daily rest — so a nine-hour stop logged as a Break is one. Reported
    /// from play: a reduced nine logged as a Break was not counted as the reduced rest it was. How long it
    /// has to be for which rest is the caller's threshold.
    /// </summary>
    public static bool IsTimeOff(TripEvent e) => e.Kind is "Rest" or "Restart" or "Break" || (e.Kind == "Ferry" && e.Cabin);

    /// <summary>
    /// The driving day a moment belongs to. Daily driving under EU rules runs between two daily rests, not
    /// midnight to midnight: a shift that crosses midnight is one day. So the day is the one the last logged
    /// rest of nine hours or more ended on, where that was within the last day; the calendar day otherwise,
    /// which is all there is to go on when rests are not logged.
    /// </summary>
    public static int ShiftDay(AppState s, DateTime at) =>
        ShiftStart(s, at) is { } start ? KeyOf(start) : KeyOf(at.Date);

    /// <summary>
    /// When the shift a moment belongs to began: the end of the last daily rest before it — logged in the trip
    /// log, or seen on the status line as a fresh D and B (<see cref="HosSnapshot.EuShiftStart"/>) — where that
    /// was within the last day. Null when neither is known, and the calendar day stands in.
    /// </summary>
    public static DateTime? ShiftStart(AppState s, DateTime at)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        var lastRestEnd = s.Trips.SelectMany(t => t.Events)
            .Where(IsTimeOff)
            .Select(e => (Start: GameClock.TryParse(e.GameTime), End: GameClock.TryParse(e.EndGameTime)))
            .Where(x => x.Start is { } a && x.End is { } b && (b - a).TotalHours >= r.ReducedDailyRest - 0.01 && b <= at)
            .Select(x => x.End!.Value)
            .DefaultIfEmpty(DateTime.MinValue).Max();
        if (GameClock.TryParse(s.Hos.EuShiftStart) is { } seen && seen <= at && seen > lastRestEnd) lastRestEnd = seen;
        return lastRestEnd > DateTime.MinValue && (at - lastRestEnd).TotalHours < 24 ? lastRestEnd : null;
    }

    /// <summary>
    /// A shift's key: the hour it began. Two shifts on one calendar day — a morning drive, a nine-hour rest, an
    /// evening drive — are two driving days under the rules, and keying them by the day merged them into one.
    /// A day with no known rest is keyed by its midnight.
    /// </summary>
    private static int KeyOf(DateTime start) => (int)((start - new DateTime(2000, 1, 1)).TotalHours);

    /// <summary>Driving no single shift could hold, kept out of every shift's count. See <see cref="Derive"/>.</summary>
    public const int Unattributed = -1;

    /// <summary>What a logged span of time off counts as under EU rules, for the trip log. Empty under a daily rest.</summary>
    public static string RestValue(AppState s, double hours)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        if (hours >= r.RegularWeeklyRest - 0.01) return "a regular weekly rest";
        if (hours >= r.ReducedWeeklyRest - 0.01) return $"a reduced weekly rest ({Hhmm.Of(r.RegularWeeklyRest - hours)} owed back)";
        if (hours >= r.RegularDailyRest - 0.01) return "a regular daily rest";
        if (hours >= r.ReducedDailyRest - 0.01) return "a reduced daily rest";
        return "";
    }

    /// <summary>
    /// Folds a status-line report into the career's clocks. Called with the clocks already holding the new
    /// B, D, W and 2W, and with the week's driving as it stood before this report.
    /// </summary>
    /// <param name="report">False when the call is a logged rest refreshing the counters rather than a status-line
    /// report — which keeps what the last report said about itself.</param>
    public static void Derive(AppState s, DateTime now, double? weekDrivenBefore, string? weekBefore, bool report = true)
    {
        var h = s.Hos;
        var r = s.Settings.EuHos ?? new EuHosRules();
        var weekKey = GameClock.Format(HosEngine.WeekStart(now));
        h.EuDayDriving ??= new Dictionary<int, double>();

        // ---- driving per day, from the fall in W. A new week clears the record.
        if (h.EuDayWeek != weekKey) { h.EuDayDriving.Clear(); h.EuDayWeek = weekKey; }
        if (report) { h.EuMultiDayReport = 0; h.EuClocksFromRest = false; }
        var prevAt = GameClock.TryParse(h.AsOfGameTime);
        int Extensions() => Math.Min(r.ExtensionsPerWeek, h.EuDayDriving.Count(kv => kv.Key != Unattributed && kv.Value > r.DailyDriving + 0.01));

        // A fresh day, read off the status line itself: D back at a full day's and B at 4:30 only happen after a
        // daily rest. Reported from play: four and a half hours driven, a nine-hour rest not logged, the clocks
        // typed on rolling again — and the app ran the spread from the rest before, read it as spent, and put the
        // morning's driving on the evening's shift. The report is the start of a new shift, and the driving since
        // the last report belongs to the one before it.
        //
        // A fresh B alone is any 45-minute break, so D has to be full too — for the day as it now stands, which is
        // ten while a 10-hour day is left this week and nine after. A report still fresh in the same shift (typed
        // twice before driving) does not move the start again.
        var freshShift = false;
        var drop = weekBefore == weekKey && weekDrivenBefore is { } was && h.EuWeekDriven is { } nowDriven && nowDriven > was + 0.01
            ? nowDriven - was : 0;
        if (report && h.BreakRemaining >= r.DrivingBeforeBreak - 0.01 && h.DriveRemaining >= r.DailyDriving - 0.01)
        {
            var newDayLimit = Extensions() < r.ExtensionsPerWeek ? r.ExtendedDailyDriving : r.DailyDriving;
            var startedBefore = GameClock.TryParse(h.EuShiftStart);
            // Typed twice before driving is the same shift; a fresh report a rest's length after the last one is
            // a new one, driving or not.
            freshShift = h.DriveRemaining >= newDayLimit - 0.01
                         && (startedBefore == null || prevAt == null || startedBefore < prevAt || drop > 0.01
                             || (now - prevAt.Value).TotalHours >= r.ReducedDailyRest - 0.01);
        }

        if (drop > 0.01)
        {
            // Which shift the driving was in: the one the last report was in, where this report opens a new one.
            var key = freshShift && prevAt is { } before ? ShiftDay(s, before) : ShiftDay(s, now);
            if (drop > r.ExtendedDailyDriving + 0.01)
            {
                // More than a shift can hold: the report spans driving days, and which of them were 10-hour days
                // cannot be told. Kept out of the count rather than spending a 10-hour day on a guess, and said.
                h.EuMultiDayReport = Math.Round(drop, 2);
                key = Unattributed;
            }
            h.EuDayDriving[key] = Math.Round(h.EuDayDriving.GetValueOrDefault(key) + drop, 2);
        }
        if (freshShift) h.EuShiftStart = GameClock.Format(now);
        h.EuExtensionsUsed = Extensions();

        // ---- the day's limit: ten while a 10-hour day is left, nine after.
        var today = ShiftDay(s, now);
        var extendedToday = h.EuDayDriving.GetValueOrDefault(today) > r.DailyDriving + 0.01;
        h.EuDailyLimit = extendedToday || h.EuExtensionsUsed < r.ExtensionsPerWeek ? r.ExtendedDailyDriving : r.DailyDriving;
        h.EuDriveCapped = false;
        // The status line counts D from ten while a 10-hour day is left: today's extension is in the figure.
        h.EuDriveIncludesExtension = h.EuDailyLimit > r.DailyDriving + 0.01;
        if (h.DriveRemaining > h.EuDailyLimit + 0.01)
        {
            h.DriveRemaining = h.EuDailyLimit;
            h.EuDriveCapped = true;
        }

        // ---- the weekly rest, and what has happened since, from the trip log.
        var rests = s.Trips.SelectMany(t => t.Events)
            .Where(IsTimeOff)
            .Select(e => (Start: GameClock.TryParse(e.GameTime), End: GameClock.TryParse(e.EndGameTime)))
            .Where(x => x.Start is { } a && x.End is { } b && b > a && b <= now)
            .Select(x => (Start: x.Start!.Value, End: x.End!.Value, Hours: (x.End!.Value - x.Start!.Value).TotalHours))
            .Concat(s.RestartOrders
                .Where(o => o.Status == "Completed")
                .Select(o => (Start: GameClock.TryParse(o.ArrivedGameTime), End: GameClock.TryParse(o.CompletedGameTime)))
                .Where(x => x.Start is { } a && x.End is { } b && b > a && b <= now)
                .Select(x => (Start: x.Start!.Value, End: x.End!.Value, Hours: (x.End!.Value - x.Start!.Value).TotalHours)))
            .OrderBy(x => x.End)
            .ToList();
        var weekly = rests.LastOrDefault(x => x.Hours >= r.ReducedWeeklyRest - 0.01);
        if (weekly.Hours > 0)
        {
            h.EuHoursSinceWeeklyRest = Math.Round((now - weekly.End).TotalHours, 2);
            h.EuLastWeeklyRestReduced = weekly.Hours < r.RegularWeeklyRest - 0.01;
            var owed = 0.0;
            foreach (var w in rests.Where(x => x.Hours >= r.ReducedWeeklyRest - 0.01))
                owed = w.Hours < r.RegularWeeklyRest - 0.01
                    ? owed + (r.RegularWeeklyRest - w.Hours)
                    : Math.Max(0, owed - (w.Hours - r.RegularWeeklyRest));
            h.EuCompensationOwed = Math.Round(owed, 2);
        }
        else
        {
            // None logged: the planner counts from the start of the week, and nothing is owed that it can see.
            h.EuHoursSinceWeeklyRest = null;
            h.EuLastWeeklyRestReduced = false;
            h.EuCompensationOwed = 0;
        }
        var since = weekly.Hours > 0 ? weekly.End : HosEngine.WeekStart(now);
        h.EuReducedRestsUsed = Math.Min(r.ReducedRestsBetweenWeekly,
            rests.Count(x => x.End > since && x.Hours >= r.ReducedDailyRest - 0.01 && x.Hours < r.RegularDailyRest - 0.01));

        // ---- the spread, always estimated: the status line has none.
        h.SpreadEstimated = true;
        h.ShiftRemaining = HosEngine.EstimateEuSpread(s, h.EuDayDriving.TryGetValue(today, out var d) ? d : null, now);
    }
}
