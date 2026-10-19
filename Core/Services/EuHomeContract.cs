using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Home time on a European career, as a term of a salaried driver's contract rather than a preference.
///
/// <para><b>Weeks out, days home.</b> European rotas are named for it — 2/1, 3/1, 4/2: weeks on the road,
/// then time at the house. The Mobility Package caps the first number at four. The second is the contract's,
/// and here it grows two ways: with how long the tour is, because four weeks away earns more than two, and
/// with rank, because a senior driver has negotiated better terms than a probationer. See
/// <see cref="DaysOffTable"/>.</para>
///
/// <para><b>Home time is the weekly rest.</b> However many days the contract gives, the driver does not
/// leave the yard until they have had a full 45 hours plus every hour owed back for a reduced rest, and not
/// before the week has turned over if they drove in it — so each tour starts with a full week's driving,
/// nothing owed and the six-day clock reset. The time at home is then written to the record as that weekly
/// rest, which is what the EU counters read.</para>
///
/// <para><b>Not the driver's to change at will.</b> Fixed through probation, as in the US. Fixed for six
/// months after it. Then renegotiated — at the yard, at the first home time it is due — and good for a
/// year, when it comes up again. Keeping it as it is counts as renegotiating it.</para>
/// </summary>
public static class EuHomeContract
{
    public static bool Applies(AppState s) => MobilityPackage.Applies(s);

    /// <summary>The tours an EU contract can be written for. Four weeks is the law's ceiling.</summary>
    public static readonly (string Key, string Label, int Days, string Note)[] Options =
    {
        ("biweekly",   "Home every other week",  14, "Two weeks out. Short tours, the most time at the house for the miles."),
        ("threeweeks", "Home every three weeks", 21, "Three weeks out — the common European rota."),
        ("fourweeks",  "Home every four weeks",  28, "Four weeks out, as long as the law allows, and the longest stretch at home to match.")
    };

    /// <summary>Days at home, by rank (rows) and tour (columns: two, three and four weeks out).</summary>
    public static readonly (string Label, int[] Days)[] DaysOffTable =
    {
        ("Probationary",   new[] { 4, 5,  7 }),
        ("Company driver", new[] { 5, 7,  9 }),
        ("Senior",         new[] { 6, 8, 11 }),
        ("Lead and above", new[] { 7, 10, 14 }),
    };

    /// <summary>First renegotiation, counted from the day probation cleared.</summary>
    public const int FirstTermDays = 180;

    /// <summary>Every renegotiation after that, counted from the last.</summary>
    public const int TermDays = 365;

    public static int RankRow(string? rank) => (rank ?? "").Trim().ToLowerInvariant() switch
    {
        "company" => 1,
        "senior" => 2,
        "lead" or "lease" or "owner" => 3,
        _ => 0,
    };

    public static int TourColumn(int intervalDays) => intervalDays <= 14 ? 0 : intervalDays <= 21 ? 1 : 2;

    public static int DaysOff(string? rank, int intervalDays) =>
        DaysOffTable[RankRow(rank)].Days[TourColumn(intervalDays)];

    /// <summary>The contract's days at home for this driver as they stand now.</summary>
    public static int DaysOff(AppState s) => DaysOff(s.Driver.Rank, Probation.EffectiveIntervalDays(s));

    /// <summary>
    /// The nearest EU tour to an arrangement made under other terms — a career that started before this, or
    /// an arrangement read off an application. Weekly rounds up to two weeks; anything past four weeks, or
    /// none at all, is four, because that is what the law would hold them to anyway.
    /// </summary>
    public static string NearestKey(int days) =>
        days > 0 && days <= 14 ? "biweekly" : days > 0 && days <= 21 ? "threeweeks" : "fourweeks";

    public static bool IsOption(string? key) =>
        Options.Any(o => o.Key.Equals((key ?? "").Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The tours a carrier will sign on an EU career. Its home-time standing still decides the shortest, but
    /// nobody is offered longer than the law allows, so every carrier signs four weeks.
    /// </summary>
    public static (List<string> Keys, string Note) Offer(int homeTimeStars)
    {
        var min = Math.Min(Carriers.MinHomeDaysFor(homeTimeStars), 28);
        var keys = Options.Where(o => o.Days >= min).Select(o => o.Key).ToList();
        var best = Options.First(o => o.Key == keys[0]);
        return (keys, keys.Count == Options.Length
            ? "Two, three or four weeks out — they run the lanes for any of them."
            : $"The shortest tour they will write is {best.Label.ToLowerInvariant()}.");
    }

    // ------------------------------------------------------------------ the renegotiation

    /// <summary>When the agreement next comes up. Null on probation, or outside the EU.</summary>
    public static DateTime? RenewalDue(AppState s)
    {
        if (!Applies(s) || Probation.IsOn(s)) return null;
        if (GameClock.TryParse(s.Driver.HomeContractRenewedGameTime) is { } last) return last.AddDays(TermDays);
        var cleared = GameClock.TryParse(s.Driver.Probation.ClearedGameDate) ?? GameClock.TryParse(s.Driver.HiredGameDate);
        return cleared?.AddDays(FirstTermDays);
    }

    public static bool RenewalIsDue(AppState s) =>
        RenewalDue(s) is { } due && GameClock.TryParse(s.Status.GameTime) is { } now && now >= due;

    /// <summary>
    /// Refuses a change to the agreement unless it is on the table. Probation's own refusal is the caller's,
    /// as it is for every term of the job.
    /// </summary>
    public static void RefuseChange(AppState s)
    {
        if (!Applies(s) || s.Driver.HomeContractRenewalOpen) return;
        var company = string.IsNullOrWhiteSpace(s.Company?.Name) ? "The company" : s.Company.Name;
        var due = RenewalDue(s);
        throw new InvalidOperationException(due is { } d && RenewalIsDue(s)
            ? $"Your home-time agreement is up for renegotiation, and {company} does that with you at the yard. " +
              "It is on the table at your next home time."
            : $"Your home-time agreement with {company} is in your contract and stands until " +
              $"{GameClock.Pretty(GameClock.Format(due ?? DateTime.MinValue))}. It is renegotiated at the first " +
              "home time after that.");
    }

    /// <summary>The driver changed it, or kept it. Either way the next year starts now.</summary>
    public static void Renewed(AppState s)
    {
        s.Driver.HomeContractRenewedGameTime = s.Status.GameTime;
        s.Driver.HomeContractRenewalOpen = false;
    }

    // ------------------------------------------------------------------ the home time itself

    /// <summary>
    /// The earliest the driver goes back out from a home time that began at <paramref name="arrived"/>, and
    /// why: whichever is latest of the contract's days, a full weekly rest with the owed hours on top, and
    /// Monday 00:00 where they drove in the week they came home in.
    /// </summary>
    public static (DateTime Ready, string Why) Ready(AppState s, DateTime arrived)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        var days = DaysOff(s);
        var owed = Math.Max(0, s.Hos.EuCompensationOwed);

        // The contract's days, counted the way the arrival brief always has: from the day they parked, out
        // at seven in the morning.
        var byContract = arrived.Date.AddDays(days).AddHours(7);
        var byRest = arrived.AddHours(r.RegularWeeklyRest + owed);
        var ready = byContract;
        var why = $"your contract gives you {days} days at home";
        if (byRest > ready)
        {
            ready = byRest;
            why = $"a full {r.RegularWeeklyRest:0} hours" + (owed > 0.01 ? $" plus the {Hhmm.Of(owed)} owed back" : "");
        }

        // Weekly driving comes back at Monday 00:00 and nothing else brings it back. Driven in this week, the
        // driver waits for the next one; not driven, the week is already whole.
        var week = HosEngine.WeekStart(arrived);
        var weekKey = GameClock.Format(week);
        var driven = s.Hos.EuDayWeek == weekKey && s.Hos.EuDayDriving is { Count: > 0 } d ? d.Values.Sum() : 0;
        if (driven <= 0.01 && s.Hos.EuWeekDriven is { } wd && s.Hos.EuDayWeek == weekKey) driven = wd;
        var monday = week.AddDays(7);
        if (driven > 0.01 && monday > ready)
        {
            ready = monday;
            why = "Monday 00:00, when a fresh week's driving comes back";
        }
        return (ready, why);
    }

    /// <summary>
    /// Called by <see cref="HomeTime.Touch"/> as the driver arrives at the yard.
    ///
    /// <para>Only a home time the tour has <paramref name="earned"/> — due, overdue, or approved — holds the
    /// driver for the contract's days. The first report after hire, or a run through the home city two days
    /// into a tour, is being at the yard, not a home time: parking a new hire for four days, or a driver whose
    /// load happened to pass the gate, is not what the contract says.</para>
    /// </summary>
    public static void OnArrival(AppState s, bool earned)
    {
        if (!Applies(s) || GameClock.TryParse(s.Status.GameTime) is not { } now) return;
        // The renegotiation is had at the yard either way.
        if (RenewalIsDue(s)) s.Driver.HomeContractRenewalOpen = true;
        if (!earned)
        {
            s.Driver.HomeArrivedGameTime = s.Driver.HomeReadyGameTime = "";
            s.Driver.HomeRestRecorded = true;
            return;
        }
        s.Driver.HomeArrivedGameTime = s.Status.GameTime;
        s.Driver.HomeRestRecorded = false;
        s.Driver.HomeReadyGameTime = GameClock.Format(Ready(s, now).Ready);
        // The contract decides the days, so the trailer changeover is priced on them rather than on a guess.
        s.Driver.HomeDaysPlanned = DaysOff(s);
    }

    /// <summary>
    /// Called by <see cref="HomeTime.Touch"/> as the driver leaves the yard. Writes the rest if it has not been
    /// already, and an agreement left on the table is kept as it is.
    /// </summary>
    public static void OnLeaving(AppState s)
    {
        if (!Applies(s)) return;
        if (GameClock.TryParse(s.Status.GameTime) is { } now) Settle(s, now);
        if (s.Driver.HomeContractRenewalOpen)
        {
            Renewed(s);
            Log(s, $"Home-time agreement kept as it was — {HomeTime.LabelFor(s.Application?.HomeTimePreference)}, " +
                   $"{DaysOff(s)} days at home. It comes up again in a year.");
        }
    }

    /// <summary>Held at the yard: on home time, and not yet at the earliest the contract lets them go.</summary>
    public static bool OnHold(AppState s) =>
        Applies(s) && s.Driver.AtHomeYard && !s.Driver.HomeRestRecorded
        && GameClock.TryParse(s.Driver.HomeReadyGameTime) is { } ready
        && GameClock.TryParse(s.Status.GameTime) is { } now && now < ready;

    /// <summary>What dispatch says while the driver is held. Null when they are not.</summary>
    public static string? HoldBlocker(AppState s)
    {
        if (!OnHold(s)) return null;
        var arrived = GameClock.TryParse(s.Driver.HomeArrivedGameTime);
        var why = arrived is { } a ? Ready(s, a).Why : "your contract";
        return $"You are on home time until {GameClock.Pretty(s.Driver.HomeReadyGameTime)} — {why}. It is your weekly " +
               "rest as well, so you go back out with a full week, nothing owed and the six days starting fresh. " +
               "Report your clocks from then and pull a board.";
    }

    /// <summary>
    /// Writes the time at home to the record as the weekly rest it was, once it has run its length — or once
    /// the driver has left, whatever it came to. Called before the EU counters are worked out, so they read it.
    ///
    /// <para>A home time is a rest the trip log never sees: nothing is logged while the truck stands on the
    /// yard. Without this a driver could have a week at the house and come back out still owing hours for a
    /// reduced rest a fortnight before.</para>
    /// </summary>
    public static void Settle(AppState s, DateTime now)
    {
        if (!Applies(s) || s.Driver.HomeRestRecorded) return;
        if (GameClock.TryParse(s.Driver.HomeArrivedGameTime) is not { } arrived) return;
        var ready = GameClock.TryParse(s.Driver.HomeReadyGameTime) ?? arrived;
        var leaving = !s.Driver.AtHomeYard || !OnYardNow(s);
        if (!leaving && now < ready) return;

        // The rest ends when they were last seen at the yard, or at the ready time if they were held to it and
        // only reported again from the road — they were not driving before then.
        var lastAtYard = GameClock.TryParse(s.Driver.LastHomeGameTime) ?? arrived;
        var heldTo = now < ready ? now : ready;
        var end = !leaving ? now : lastAtYard > heldTo ? lastAtYard : heldTo;
        var hours = (end - arrived).TotalHours;
        s.Driver.HomeRestRecorded = true;

        var r = s.Settings.EuHos ?? new EuHosRules();
        if (hours < r.ReducedWeeklyRest - 0.01) return;      // too short to be a weekly rest at all

        // A weekly rest order already running at the yard IS this rest: close it with the home time's span
        // rather than counting the same hours twice.
        var order = s.RestartOrders.FirstOrDefault(o => o.Status is "Ordered" or "Arrived");
        if (order == null)
        {
            order = new RestartOrder
            {
                Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-RS-{s.RestartOrders.Count + 1:0000}",
                OrderedGameTime = s.Driver.HomeArrivedGameTime,
                Trigger = "HomeTime",
            };
            s.RestartOrders.Insert(0, order);
        }
        var home = HomeTime.HomeTerminal(s);
        order.TargetCity = order.ArrivedCity = home?.City ?? s.Status.LocationCity;
        order.TargetState = order.ArrivedState = home?.State ?? s.Status.LocationState;
        order.AtHomeTerminal = true;
        order.Trigger = "HomeTime";
        order.Reason = "Home time — taken as the weekly rest.";
        order.RequiredHours = r.RegularWeeklyRest + Math.Max(0, s.Hos.EuCompensationOwed);
        order.ArrivedGameTime = s.Driver.HomeArrivedGameTime;
        order.EligibleGameTime = s.Driver.HomeReadyGameTime;
        order.CompletedGameTime = GameClock.Format(end);
        order.ElapsedHours = Math.Round(hours, 2);
        order.Status = "Completed";

        // What the counters will make of it, said now rather than at the next report.
        var reduced = hours < r.RegularWeeklyRest - 0.01;
        s.Hos.EuCompensationOwed = reduced
            ? Math.Max(0, s.Hos.EuCompensationOwed) + (r.RegularWeeklyRest - hours)
            : Math.Max(0, s.Hos.EuCompensationOwed - (hours - r.RegularWeeklyRest));
        s.Hos.EuLastWeeklyRestReduced = reduced;
        s.Hos.EuHoursSinceWeeklyRest = Math.Max(0, Math.Round((now - end).TotalHours, 2));
        s.Hos.EuReducedRestsUsed = 0;

        Log(s, $"{order.Number}: home time counted as the weekly rest — {Hhmm.Of(hours)} at {order.TargetCity}" +
               (s.Hos.EuCompensationOwed > 0.01 ? $", {Hhmm.Of(s.Hos.EuCompensationOwed)} still owed." : ", nothing owed."));
    }

    private static bool OnYardNow(AppState s)
    {
        var home = HomeTime.HomeTerminal(s);
        return home != null && Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State)
            is { } m && m <= HomeTime.AtYardMiles;
    }

    private static void Log(AppState s, string message) =>
        s.Events.Insert(0, new LogEvent { Channel = "career", Message = message, GameTime = s.Status.GameTime });

    /// <summary>For the Career tab and the arrival brief.</summary>
    public static object? View(AppState s)
    {
        if (!Applies(s)) return null;
        var due = RenewalDue(s);
        var interval = Probation.EffectiveIntervalDays(s);
        return new
        {
            daysOff = DaysOff(s),
            rankRow = RankRow(s.Driver.Rank),
            tourColumn = TourColumn(interval),
            table = DaysOffTable.Select(r => new { label = r.Label, days = r.Days }).ToList(),
            tours = new[] { "2 weeks out", "3 weeks out", "4 weeks out" },
            locked = !s.Driver.HomeContractRenewalOpen,
            onProbation = Probation.IsOn(s),
            renewalDue = due is { } d ? GameClock.Format(d) : "",
            renewalIsDue = RenewalIsDue(s),
            renewalOpen = s.Driver.HomeContractRenewalOpen,
            lastRenewed = s.Driver.HomeContractRenewedGameTime,
            onHold = OnHold(s),
            readyGameTime = s.Driver.AtHomeYard ? s.Driver.HomeReadyGameTime : "",
            readyWhy = s.Driver.AtHomeYard && GameClock.TryParse(s.Driver.HomeArrivedGameTime) is { } a ? Ready(s, a).Why : "",
            note = Probation.IsOn(s)
                ? "Fixed while you are on probation. Six months after you clear it, it comes up for renegotiation."
                : s.Driver.HomeContractRenewalOpen
                    ? "Up for renegotiation while you are at the yard: change it or keep it, and it stands for a year. " +
                      "Leave without saying and it is kept as it is."
                    : RenewalIsDue(s)
                        ? "Due for renegotiation — it is taken at the yard, at your next home time."
                        : $"In your contract until {GameClock.Pretty(GameClock.Format(due ?? DateTime.MinValue))}, then renegotiated at the yard.",
        };
    }
}
