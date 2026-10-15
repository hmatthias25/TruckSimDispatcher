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

    /// <summary>
    /// Hours since the last weekly rest ended, as of <paramref name="at"/>. The stored figure is as of the last
    /// report, and empty where no weekly rest has been logged — in which case the week is counted from its
    /// Monday 00:00, as the planner always did. Reported from play: with none logged, dispatch read the empty
    /// figure as "not due" and ordered an 11-hour daily rest at 133 hours, when the next rest had to be the weekly.
    /// </summary>
    public static double HoursSinceWeeklyRest(AppState s, DateTime at)
    {
        var asOf = GameClock.TryParse(s.Hos.AsOfGameTime) ?? at;
        if (asOf > at) asOf = at;
        var basis = s.Hos.EuHoursSinceWeeklyRest is { } h ? h : (asOf - HosEngine.WeekStart(asOf)).TotalHours;
        return Math.Max(0, basis + (at - asOf).TotalHours);
    }

    /// <summary>
    /// Reduced weekly rests in a row, international work abroad: two at most (561/2006 Art. 8(6) as amended), and the
    /// next has to be a regular one with the hours owed paid back.
    /// </summary>
    public const int MaxReducedWeeklyInARow = 2;

    /// <summary>
    /// Every logged span of time off that ended by <paramref name="now"/>, oldest first, rest orders included, with
    /// what it was decided to count as where that was decided: "weekly", "daily", or blank to go by its length.
    /// </summary>
    private static List<(DateTime Start, DateTime End, double Hours, string Counts)> TimeOff(AppState s, DateTime now) =>
        s.Trips.SelectMany(t => t.Events)
            .Where(IsTimeOff)
            .Select(e => (Start: GameClock.TryParse(e.GameTime), End: GameClock.TryParse(e.EndGameTime),
                          Counts: e.WeeklyRest is { Length: > 0 } w ? w : e.Kind == "Restart" ? "weekly" : ""))
            .Where(x => x.Start is { } a && x.End is { } b && b > a && b <= now)
            .Select(x => (Start: x.Start!.Value, End: x.End!.Value, Hours: (x.End!.Value - x.Start!.Value).TotalHours, x.Counts))
            .Concat(s.RestartOrders
                .Where(o => o.Status == "Completed")
                .Select(o => (Start: GameClock.TryParse(o.ArrivedGameTime), End: GameClock.TryParse(o.CompletedGameTime)))
                .Where(x => x.Start is { } a && x.End is { } b && b > a && b <= now)
                .Select(x => (Start: x.Start!.Value, End: x.End!.Value, Hours: (x.End!.Value - x.Start!.Value).TotalHours, Counts: "weekly")))
            .OrderBy(x => x.End)
            .ToList();

    /// <summary>
    /// The spans that count as weekly rests, oldest first. Twenty-four hours off is a reduced weekly rest only where
    /// the last two were not both reduced: a third in a row is not one, and the six days run on through it as through
    /// a long daily rest. Reported from play: a 29-hour ferry after two reduced weekly rests, which the log would
    /// have taken as the weekly rest and started the six days again.
    /// </summary>
    private static List<(DateTime Start, DateTime End, double Hours, string Counts)> Weeklies(
        List<(DateTime Start, DateTime End, double Hours, string Counts)> rests, EuHosRules r)
    {
        var list = new List<(DateTime Start, DateTime End, double Hours, string Counts)>();
        var inARow = 0;
        foreach (var x in rests.Where(x => x.Hours >= r.ReducedWeeklyRest - 0.01
                                           && !(x.Counts == "daily" && x.Hours < r.RegularWeeklyRest - 0.01)))
        {
            var reduced = x.Hours < r.RegularWeeklyRest - 0.01;
            if (reduced && inARow >= MaxReducedWeeklyInARow) continue;
            inARow = reduced ? inARow + 1 : 0;
            list.Add(x);
        }
        return list;
    }

    /// <summary>The reduced weekly rests in a row on the log as of <paramref name="at"/>, since the last regular one.</summary>
    public static int ReducedWeeklyInARow(AppState s, DateTime at)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        var n = 0;
        foreach (var w in Enumerable.Reverse(Weeklies(TimeOff(s, at), r)))
        {
            if (w.Hours >= r.RegularWeeklyRest - 0.01) break;
            n++;
        }
        return n;
    }

    /// <summary>Whether a reduced weekly rest starting at <paramref name="at"/> would be one too many in a row.</summary>
    public static bool ReducedWeeklyUsedUp(AppState s, DateTime at) => ReducedWeeklyInARow(s, at) >= MaxReducedWeeklyInARow;

    /// <summary>
    /// How near the end of the six days a stretch off has to leave the driver, taken as a daily rest, before it is
    /// worth counting as a reduced weekly one: two driving days.
    /// </summary>
    public const double WorthAWeeklyHours = 48;

    /// <summary>
    /// Whether 24 to 45 hours off — a long crossing, a long wait — is better counted as the weekly rest than as a long
    /// daily one. The law lets it be either. Counted as weekly it starts the six days again, but a reduced one owes
    /// hours back and two in a row bring the driver home; counted as daily it costs nothing and the six days run on.
    /// So it is the weekly rest only where the six days are nearly gone — would run out within two driving days of
    /// it, or during it — and, where the last weekly rest was reduced too, only where they run out within a day.
    /// Asked for from play: the 29:30 Travemünde – Helsinki ferry was taken as a reduced weekly rest two days after
    /// one at Frankfurt, owed 15:30 back for nothing, and was the second in a row that then called the driver home.
    /// </summary>
    public static bool CountAsWeekly(EuHosRules r, double hours, double sinceWeeklyAtStart, int reducedInARow)
    {
        if (hours >= r.RegularWeeklyRest - 0.01) return true;
        if (hours < r.ReducedWeeklyRest - 0.01 || !r.AllowReducedWeeklyRest) return false;
        if (reducedInARow >= MaxReducedWeeklyInARow) return false;
        var leftAfter = r.WeeklyRestDueAfterHours - (sinceWeeklyAtStart + hours);
        return leftAfter < (reducedInARow > 0 ? 24 : WorthAWeeklyHours);
    }

    /// <summary>What a stretch off starting at <paramref name="start"/> counts as, by <see cref="CountAsWeekly"/>.</summary>
    public static string Decide(AppState s, DateTime start, double hours)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        var weeklies = Weeklies(TimeOff(s, start), r);
        var since = weeklies.Count > 0 ? (start - weeklies[^1].End).TotalHours : HoursSinceWeeklyRest(s, start);
        return CountAsWeekly(r, hours, since, ReducedWeeklyInARow(s, start)) ? "weekly" : "daily";
    }

    /// <summary>What 24 to 45 hours off counts as, for the trip log, once decided.</summary>
    public static string Counted(AppState s, double hours, DateTime start, string counts)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        if (ReducedWeeklyUsedUp(s, start)) return NotAThirdReduced;
        if (counts == "weekly")
            return $"a reduced weekly rest ({Hhmm.Of(r.RegularWeeklyRest - hours)} owed back). It starts your six days again";
        var weeklies = Weeklies(TimeOff(s, start), r);
        var since = weeklies.Count > 0 ? (start - weeklies[^1].End).TotalHours : HoursSinceWeeklyRest(s, start);
        return $"a long daily rest, not your weekly one: {Hhmm.Of(Math.Max(0, r.WeeklyRestDueAfterHours - since - hours))} of " +
               "your six days are left after it, so counting it as weekly would only owe hours back. Your six days run on — " +
               "switch it on the log if you want it as the weekly rest";
    }

    /// <summary>What a third reduced weekly rest in a row counts as, for the trip log.</summary>
    public const string NotAThirdReduced =
        "a long daily rest, not a weekly one: you have had two reduced weekly rests in a row, so the next weekly rest " +
        "has to be a regular 45 hours with what is owed paid back. Your six days run on";

    /// <summary>What a logged span of time off counts as under EU rules, for the trip log. Empty under a daily rest.</summary>
    public static string RestValue(AppState s, double hours, DateTime? start = null)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        if (hours >= r.RegularWeeklyRest - 0.01) return "a regular weekly rest";
        if (hours >= r.ReducedWeeklyRest - 0.01)
            return start is { } at
                ? Counted(s, hours, at, Decide(s, at, hours))
                : $"a reduced weekly rest ({Hhmm.Of(r.RegularWeeklyRest - hours)} owed back)";
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
        // When W was last read off the status line. Not AsOfGameTime: a logged daily rest moves that to the rest's
        // end, and the driving since the last reading was then put after the rest instead of before it — reported
        // from play as a rest logged, the clocks typed on rolling again, and the spread read as spent.
        var prevAt = GameClock.TryParse(h.EuWeekReadAt) ?? GameClock.TryParse(h.AsOfGameTime);
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

        if (freshShift) h.EuShiftStart = GameClock.Format(now);
        if (drop > 0.01)
        {
            // Which shift the driving was in. Where a daily rest lies between the last reading and this one — logged,
            // or this report opening a new shift — the driving is split across it, and D says how: the companion
            // counts D for the shift it is in, so what is gone from it is this shift's driving, and the rest of the
            // fall in W came before the rest.
            var thisShift = drop;
            if (prevAt is { } before && ShiftStart(s, now) is { } began && began > before)
            {
                var dayLimit = Extensions() < r.ExtensionsPerWeek ? r.ExtendedDailyDriving : r.DailyDriving;
                thisShift = Math.Min(drop, Math.Max(0, dayLimit - h.DriveRemaining));
                Add(ShiftDay(s, before), drop - thisShift);
            }
            Add(ShiftDay(s, now), thisShift);

            void Add(int key, double hours)
            {
                if (hours <= 0.01) return;
                if (hours > r.ExtendedDailyDriving + 0.01)
                {
                    // More than a shift can hold: the reading spans driving days, and which of them were 10-hour
                    // days cannot be told. Kept out of the count rather than spending a 10-hour day on a guess.
                    h.EuMultiDayReport = Math.Round(hours, 2);
                    key = Unattributed;
                }
                h.EuDayDriving![key] = Math.Round(h.EuDayDriving.GetValueOrDefault(key) + hours, 2);
            }
        }
        if (report) h.EuWeekReadAt = GameClock.Format(now);
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
        // A home time that has run its length goes on first: the yard is a rest the trip log never sees.
        EuHomeContract.Settle(s, now);
        var rests = TimeOff(s, now);
        var weeklies = Weeklies(rests, r);
        var weekly = weeklies.LastOrDefault();
        if (weekly.Hours > 0)
        {
            h.EuHoursSinceWeeklyRest = Math.Round((now - weekly.End).TotalHours, 2);
            h.EuLastWeeklyRestReduced = weekly.Hours < r.RegularWeeklyRest - 0.01;
            var owed = 0.0;
            foreach (var w in weeklies)
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
