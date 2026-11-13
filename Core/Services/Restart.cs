using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The 34-hour restart, as a thing the company plans and the driver actually does.
///
/// It used to be a warning that got louder. The app set a reset watch, favoured freight that ended
/// somewhere a restart could be sat, and then kept dispatching until nothing on the board could be run
/// legally — at which point the driver took their thirty-four hours wherever they happened to have
/// stopped. That is the wrong order. Thirty-four hours of not earning is a real decision, so it gets
/// made in advance, and the company picks the place.
///
/// There was also no way to <i>take</i> one. The driver reported clocks and the app believed them.
/// Now it is a sequence: report arriving, sit it, report back with the clocks reset. The app checks the
/// elapsed game time really was thirty-four hours and that the cycle actually came back, and only then
/// puts freight on the truck. A restart nobody sat is not a restart.
/// </summary>
public static class Restart
{
    /// <summary>
    /// Cycle hours at or below which dispatch stops. One more full day of driving is enough to reach a
    /// decent truck stop; a second is not, and running the cycle to zero is how you end up sitting a
    /// restart at a customer's gate. Editable, like every other threshold.
    /// </summary>
    public static double StopDispatchAtCycleHours(AppState s) => s.Settings.Hos.StopDispatchAtCycleHours;

    /// <summary>Whether this career runs on EU rules, where a "restart" is the weekly rest.</summary>
    public static bool IsEu(AppState s) => GameProfile.For(s).HosRuleset == "EU561";

    /// <summary>
    /// EU: the weekly rest is due within a day — six 24-hour periods since the last one, less one more
    /// working day and its rest. Where no weekly rest is logged the week counts from Monday 00:00, the same
    /// reading the planner uses — it used to read "unknown" as "not due".
    /// </summary>
    public static bool EuWeeklyRestDueSoon(AppState s)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        if (GameClock.TryParse(s.Status.GameTime) is not { } now) return false;
        return EuCounters.HoursSinceWeeklyRest(s, now) >= r.WeeklyRestDueAfterHours - 24;
    }

    /// <summary>
    /// EU: the driver's day is done here, and the rest they are about to take would end inside a weekend truck
    /// ban where they are parked — one long enough that the stop is a weekly rest anyway. So it is ordered as the
    /// weekly rest now, at the length <see cref="EuWeeklyRestPlan"/> sets, rather than an eleven that wakes them
    /// in the middle of the ban. Reported from play: Saturday 15:21 in Frankfurt with 0:55 of spread left, told to
    /// take the eleven — up at 02:30 Sunday with the German ban on until 22:00 and the weekly rest due Monday.
    /// </summary>
    public static bool EuRestRunsIntoBan(AppState s)
    {
        if (!IsEu(s) || GameClock.TryParse(s.Status.GameTime) is not { } now) return false;
        var r = s.Settings.EuHos ?? new EuHosRules();
        if (!EuDayDone(s)) return false;
        var cc = s.Status.LocationState;
        var lifts = HosEngine.BanLiftsAt(cc, now.AddHours(r.RegularDailyRest)) ?? HosEngine.BanLiftsAt(cc, now);
        return lifts is { } l && (l - now).TotalHours >= r.ReducedWeeklyRest - 0.01;
    }

    /// <summary>
    /// EU: nothing more can be worked today — the driving or the spread is gone, or what is left of the spread
    /// will not cover loading and getting off the property (the same line as DispatchEngine.NoWindowToWorkBlocker).
    /// </summary>
    public static bool EuDayDone(AppState s)
    {
        var stop = Math.Max(0, s.Settings.Hos.StopDispatchAtDriveHours);
        if (Math.Min(s.Hos.DriveRemaining, s.Hos.ShiftRemaining) <= stop + 0.01) return true;
        var trailer = DispatchEngine.AssignedTrailer(s);
        var dock = FacilityLearning.For(s, trailer?.Type);
        return s.Hos.ShiftRemaining < Math.Max(s.Settings.HookHours, dock.Loading) + Math.Max(0, s.Settings.ParkingBufferHours);
    }

    /// <summary>EU: how long the next weekly rest is — dispatch's call. See <see cref="EuWeeklyRestPlan"/>.</summary>
    public static double EuWeeklyRestHours(AppState s) => EuWeeklyRestPlan(s, false, GameClock.TryParse(s.Status.GameTime)).Hours;

    /// <summary>
    /// How long the weekly rest is, decided by dispatch — the driver works for the company, and the company
    /// says. A reduced weekly rest is anything from 24 hours up to 45; whatever it is short of 45 is owed back.
    ///
    /// <list type="bullet">
    /// <item>The last one was reduced: this one has to be regular — 45, plus anything still owed. That is the
    /// two-week rule, and it is also when the owed hours are paid back, well inside the three weeks.</item>
    /// <item>At the yard: the full 45. It is home time, there is no hotel to pay, and nothing is owed.</item>
    /// <item>Weekly driving is nearly spent: rest until Monday 00:00 brings it back — no point sitting 24
    /// and then waiting for the week. Between 24 and 45 that is a reduced rest with less owed; past 45 it is
    /// a regular one.</item>
    /// <item>Otherwise: 24, in the cab, back on the road soonest, 21 owed.</item>
    /// </list>
    /// </summary>
    public static (double Hours, string Why) EuWeeklyRestPlan(AppState s, bool atHome, DateTime? from)
    {
        var r = s.Settings.EuHos ?? new EuHosRules();
        var owed = Math.Max(0, s.Hos.EuCompensationOwed);
        if (!r.AllowReducedWeeklyRest || s.Hos.EuLastWeeklyRestReduced)
            return (r.RegularWeeklyRest + owed, owed > 0.01
                ? $"your last weekly rest was reduced, so this one is a full {r.RegularWeeklyRest:0} hours plus the {Hhmm.Of(owed)} still owed back"
                : $"your last weekly rest was reduced, so this one is a full {r.RegularWeeklyRest:0} hours");
        // At home it is never reduced, and it pays back everything owed: a tour starts with nothing outstanding.
        if (atHome)
            return (r.RegularWeeklyRest + owed, owed > 0.01
                ? $"you are at the yard, so it is a full {r.RegularWeeklyRest:0} hours at home plus the {Hhmm.Of(owed)} owed back — no hotel, nothing left owing"
                : $"you are at the yard, so it is a full {r.RegularWeeklyRest:0} hours at home — no hotel, nothing owed");
        // A weekend driving ban where the rest is taken: a 24 that ends inside it leaves the truck parked by the
        // ban anyway, so the rest runs on until Monday 00:00 (or the ban's end, where that is later) — more rest,
        // less owed, and weekly driving back at the same moment. Asked for from play: a weekly rest ordered in
        // Milan on a Saturday afternoon that would have ended at midday on Sunday, inside Italy's ban.
        if (from is { } banFrom && IsEu(s) && Ets2Data.SundayBans.TryGetValue(s.Status.LocationState ?? "", out var ban))
        {
            var week = HosEngine.WeekStart(banFrom);
            var bans = new[] { (week.AddHours(ban.Start), week.AddHours(ban.End)), (week.AddHours(ban.Start - 168), week.AddHours(ban.End - 168)) };
            var end24 = banFrom.AddHours(r.ReducedWeeklyRest);
            foreach (var (bs, be) in bans)
            {
                if (end24 <= bs || end24 >= be) continue;
                var monday = HosEngine.WeekStart(bs).AddDays(7);
                var until = be > monday ? be : monday;
                var toUntil = (until - banFrom).TotalHours;
                var len = Math.Clamp(Math.Ceiling(toUntil * 4) / 4, r.ReducedWeeklyRest, r.RegularWeeklyRest);
                var country = Ets2Data.Regions.FirstOrDefault(x => x.Code.Equals(s.Status.LocationState, StringComparison.OrdinalIgnoreCase))?.Name ?? s.Status.LocationState;
                return (len, $"{country} bans heavy trucks {ban.Text}, so a 24 would end with you parked by the ban anyway — " +
                             $"it runs until {(be > monday ? "the ban lifts" : "Monday 00:00, when weekly driving comes back too")}: {Hhmm.Of(len)}" +
                             (len < r.RegularWeeklyRest - 0.01 ? $", with {Hhmm.Of(r.RegularWeeklyRest - len)} owed rather than {Hhmm.Of(r.RegularWeeklyRest - r.ReducedWeeklyRest)}" : ""));
            }
        }
        if (from is { } at && s.Hos.CycleRemaining < r.DailyDriving - 0.01)
        {
            var toMonday = (HosEngine.WeekStart(at).AddDays(7) - at).TotalHours;
            var len = Math.Clamp(Math.Ceiling(toMonday * 4) / 4, r.ReducedWeeklyRest, r.RegularWeeklyRest);
            return (len, len >= r.RegularWeeklyRest - 0.01
                ? $"weekly driving is nearly spent and Monday is {Hhmm.Of(toMonday)} away, so it is a full {r.RegularWeeklyRest:0} hours"
                : $"weekly driving is nearly spent, so it runs until Monday 00:00 brings it back — {Hhmm.Of(len)}, " +
                  $"with {Hhmm.Of(r.RegularWeeklyRest - len)} owed rather than {Hhmm.Of(r.RegularWeeklyRest - r.ReducedWeeklyRest)}");
        }
        return (r.ReducedWeeklyRest, $"a reduced {r.ReducedWeeklyRest:0} hours in the cab gets you back on the road soonest");
    }

    /// <summary>
    /// Reasons a carrier parks a driver that have nothing to do with their hours.
    ///
    /// Being told to sit thirty-four hours with clean clocks is a different experience from running
    /// yourself out of cycle, and it is one of the few times a company driver has a decision made for
    /// them through no fault of their own. So the reason is always given.
    /// </summary>
    private static readonly string[] OperationalReasons =
    {
        "the freight we want you on is not ready — the shipper has pushed loading back and there is nothing else worth putting you on",
        "weather has shut the lane we were going to run you down, and I am not sending you round it for the money on offer",
        "a customer moved an appointment and it has knocked the whole week's planning sideways",
        "we are waiting on equipment at the yard before the next tour can be covered",
        "the account we run out of here has gone quiet for a couple of days and there is nothing on the board worth the truck",
        "a reload fell through at the other end and there is nothing to bring you back with",
    };

    /// <summary>
    /// Should the company park this driver for its own reasons?
    ///
    /// Deliberately rare — roughly one close-out in twenty-five. A carrier that parked you every other
    /// week would be a carrier with no freight. Seeded on the trip so it cannot be re-rolled.
    /// </summary>
    public static string? OperationalReason(AppState s, string tripNumber)
    {
        if (Open(s) != null) return null;                       // already sitting one
        if (Needed(s)) return null;                             // the cycle already says so; not this
        if (s.Trips.Count(t => t.Status == "Delivered") < 3) return null;   // not in the first week

        if (Hash($"{s.Driver.EmployeeId}|opsrestart|{tripNumber}") % 100 >= 4) return null;
        return OperationalReasons[(int)(Hash($"{s.Driver.EmployeeId}|opswhy|{tripNumber}")
                                       % (uint)OperationalReasons.Length)];
    }

    /// <summary>Raises a restart the company wants rather than one the clock demands.</summary>
    public static RestartOrder OrderOperational(AppState s, string why)
    {
        var order = Order(s);
        order.Trigger = "Operational";
        order.WhyParked = why;
        return order;
    }

    /// <summary>
    /// EU: the driver takes their weekly rest where they are, now — offered when the board has nothing and the
    /// week is nearly done. Started on the spot: they are parked already. Reported from play: told to "see the
    /// reset options list" at 01:00 on a Sunday with 14 hours of the week left, and nothing said about the
    /// weekly rest that would have used the wait.
    /// </summary>
    public static RestartOrder TakeHere(AppState s)
    {
        if (!IsEu(s)) throw new InvalidOperationException("A weekly rest taken on the spot is an EU rule.");
        if (Open(s) is { } open)
            throw new InvalidOperationException($"{open.Number} is already on order — sit that one.");
        var order = new RestartOrder
        {
            Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-RS-{s.RestartOrders.Count + 1:0000}",
            OrderedGameTime = s.Status.GameTime,
            CycleAtOrder = s.Hos.CycleRemaining,
            Trigger = "Driver",
            TargetCity = s.Status.LocationCity,
            TargetState = s.Status.LocationState,
            AtHomeTerminal = AtYard(s),
            Reason = "Taken where you were, with nothing on the board to run before the week turns over.",
            Status = "Ordered",
        };
        s.RestartOrders.Insert(0, order);
        return ReportArrived(s, s.Status.GameTime, s.Status.LocationCity, s.Status.LocationState);
    }

    private static bool AtYard(AppState s) => HomeTime.HomeTerminal(s) is { } yard
        && string.Equals(yard.City, s.Status.LocationCity, StringComparison.OrdinalIgnoreCase)
        && string.Equals(yard.State, s.Status.LocationState, StringComparison.OrdinalIgnoreCase);

    /// <summary>FNV-1a, so an outcome is stable and cannot be re-rolled by reloading.</summary>
    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }

    public static RestartOrder? Open(AppState s)
    {
        var open = s.RestartOrders.FirstOrDefault(r => r.Status is "Ordered" or "Arrived" && r.Kind != "Daily");
        if (open == null) return null;

        // EU: until the driver parks, the length follows the clocks — a report since the order may have
        // spent the week's driving (rest until Monday) or put them at the yard. Fixed once the rest starts.
        // A rest the driver chose keeps the length they chose.
        if (IsEu(s) && open.Status == "Ordered" && open.Trigger is not ("Operational" or "Chosen"))
            open.RequiredHours = EuWeeklyRestPlan(s, open.AtHomeTerminal, GameClock.TryParse(s.Status.GameTime)).Hours;

        // Ordered but never parked up, and a restart is no longer called for. Either the cycle came
        // back — the driver re-read their display and it was better than we thought, and their display
        // is authoritative — or recap now covers it, which is the whole point of the recap adviser.
        // Holding them against a problem that no longer exists would be the app being stubborn.
        if (open.Status == "Ordered" && open.Trigger is not ("Operational" or "Driver" or "Chosen") && !Needed(s))
        {
            open.Status = "Cancelled";
            open.CompletedGameTime = s.Status.GameTime;
            open.Reason = $"Stood down — {Hhmm.Of(s.Hos.CycleRemaining)} of cycle and no restart needed after all. " +
                          open.Reason;
            return null;
        }

        // Still ordered, and the driver has moved. The order is a standing instruction, so it has to
        // reflect where the truck actually is — a driver told to sit it in Denver who then ran to Los
        // Angeles should be sent somewhere sensible from Los Angeles, not held to a target four states
        // behind them. Frozen once they have parked up, because then the clock is running. A rest the driver
        // chose is taken where they stop, so there is nowhere to send them.
        if (open.Status == "Ordered" && open.Trigger != "Chosen")
        {
            var (city, state, isHome, why) = Where(s);
            if (!string.Equals(city, open.TargetCity, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(state, open.TargetState, StringComparison.OrdinalIgnoreCase))
            {
                open.TargetCity = city;
                open.TargetState = state;
                open.AtHomeTerminal = isHome;
                // Only the choice of city is rewritten. Why the driver is parked lives on WhyParked and
                // is never touched, so re-targeting cannot lose their explanation.
                open.Reason = why;
            }
        }
        return open;
    }

    /// <summary>
    /// Is the cycle low enough that the driver should be going for a restart rather than a load?
    ///
    /// Recap is checked first, and beats a restart whenever it will do. Sitting thirty-four hours when
    /// the cycle refills itself at midnight is precisely the expensive mistake the recap adviser exists
    /// to prevent, so ordering one over the top of that advice would be the app contradicting itself.
    /// </summary>
    public static bool Needed(AppState s)
    {
        // EU: there is no restart that refills weekly driving — that comes back on a Monday. What has to
        // be ordered is the weekly rest, once the six days since the last one are nearly up.
        // Not while on home time, though: that IS the weekly rest. See EuHomeContract.
        if (IsEu(s)) return !EuHomeContract.OnHold(s) && (EuWeeklyRestDueSoon(s) || EuRestRunsIntoBan(s));
        if (s.Hos.CycleRemaining <= 0) return true;
        if (s.Hos.CycleRemaining > StopDispatchAtCycleHours(s)) return false;
        // Enough coming back soon enough to carry on? Then no restart.
        return Recap.Assess(s).Verdict != "Wait";
    }

    /// <summary>
    /// Where to sit it.
    ///
    /// Home wins when home is reachable and home time is anywhere near due, because a restart at the
    /// yard and home time in the same stop beats a restart on the road followed by running home two
    /// days later. Otherwise the nearest reset-capable market — the ones with the parking and services
    /// to actually sit thirty-four hours.
    /// </summary>
    public static (string City, string State, bool IsHome, string Why) Where(AppState s)
    {
        var here = (s.Status.LocationCity, s.Status.LocationState);
        var home = HomeTime.HomeTerminal(s);
        var homeStatus = HomeTime.Status(s);
        var homeDeclined = "";

        // What the driver can actually legally drive before they have to stop. The binding clock, not
        // the cycle: with 0:43 of cycle left and a full shift there is still only 0:43 of driving in it,
        // and naming a city an hour and a half away is telling somebody to run illegal.
        //
        // Worked out here rather than further down because BOTH branches need it. The home branch used
        // to measure against the cycle alone and would order a 269-mile run home on 3.4 hours of clock —
        // the exact thing the comment below it was written to prevent.
        var mphNow = HosEngine.EffectiveMph(s.Settings, DispatchEngine.AssignedTruck(s));
        var drivable = Math.Max(0, Math.Min(Math.Min(s.Hos.DriveRemaining, s.Hos.ShiftRemaining),
                                            s.Hos.CycleRemaining));

        // Keep a little back. Arriving with the clock on zero means no margin for a wrong turn, traffic,
        // or the last mile through town to the parking.
        var reserve = Math.Min(0.25, drivable * 0.15);
        var reachHours = Math.Max(0, drivable - reserve);
        var reachMiles = mphNow > 0 ? reachHours * mphNow : 0;

        if (home != null)
        {
            var toHome = Geo.MilesBetween(here.LocationCity, here.LocationState, home.City, home.State);
            var mph = HosEngine.EffectiveMph(s.Settings, DispatchEngine.AssignedTruck(s));
            var hoursHome = toHome is { } m && mph > 0 ? m / mph : double.MaxValue;

            // Two conditions, and both have to hold. The point of combining is to avoid being sent
            // home a day after sitting a 34 somewhere else — it is not a reason to deadhead across a
            // state. A short reposition to merge two stops that were both going to happen is sensible;
            // most of a day empty to reach the yard is unpaid driving that saves nothing.
            var maxHop = Math.Max(0, s.Settings.Hos.RestartHomeMaxDeadheadHours);
            // Close enough to be worth it, AND close enough to be legal on the hours in hand. Both, or
            // the driver is sent over their clock to reach better parking — the one outcome worse than
            // parking somewhere ordinary.
            var canGetThere = toHome is { } reach && reach <= reachMiles;
            var closeEnough = hoursHome <= maxHop && canGetThere;
            var dueEnough = homeStatus.Tracked
                            && (homeStatus.Overdue
                                || homeStatus.DaysUntilDue <= s.Settings.Hos.RestartHomeMaxDaysUntilDue);

            if (closeEnough && dueEnough)
                return (home.City, home.State, true,
                    $"Home time is {(homeStatus.Overdue ? "overdue" : $"due in {homeStatus.DaysUntilDue:0.#} days")} and " +
                    $"{DispatchEngine.Place(home.City, home.State)} is {Units.Distance(toHome)} out — about {Hhmm.Of(hoursHome)} " +
                    (IsEu(s)
                        ? "empty. Worth it to do both in one stop: take the weekly rest at the yard as your home time, a " +
                          "full 45 with no hotel, rather than a rest here and a run home a day later."
                        : "empty. Worth it to do both in one stop: sit the restart at the yard and take your home time while " +
                          "you are there, rather than thirty-four hours here and a run home a day later."));

            // Declined, and worth saying why — otherwise the driver wonders why they are sitting at a
            // truck stop with the yard on the map.
            if (homeStatus.Tracked && toHome is { } far)
            {
                if (!dueEnough && !closeEnough)
                    homeDeclined = $"The yard is {Units.Distance(far)} out and home time is not due for " +
                                   $"{homeStatus.DaysUntilDue:0.#} days, so I am not running you there empty for this. " +
                                   "I will work you back with freight when it is closer.";
                else if (!dueEnough)
                    homeDeclined = $"{DispatchEngine.Place(home.City, home.State)} is close, but home time is not due " +
                                   $"for {homeStatus.DaysUntilDue:0.#} days — no point burning the trip now. " +
                                   "I will route you home with a load nearer the time.";
                else if (hoursHome <= maxHop)
                    homeDeclined = $"Home time is {(homeStatus.Overdue ? "overdue" : "close")} and the yard is only " +
                                   $"{Units.Distance(far)} out, but you have {Hhmm.Of(drivable)} of driving left and cannot " +
                                   "legally get there. Sit the restart here; you will have a full clock for it after.";
                else
                    homeDeclined = $"Home time is {(homeStatus.Overdue ? "overdue" : "close")}, but the yard is " +
                                   $"{Units.Distance(far)} out — about {Hhmm.Of(hoursHome)} empty, and that is too far to " +
                                   "deadhead for a restart. Sit it here and I will get you home with freight.";
            }
        }

        var options = Markets.ResetOptions(s, here.LocationState, 40);
        var measured = options
            .Select(c => new
            {
                c,
                miles = Geo.MilesBetween(here.LocationCity, here.LocationState, c.City, c.State) ?? double.MaxValue
            })
            .Where(x => x.miles < double.MaxValue)
            .OrderBy(x => x.miles)
            .ThenBy(x => x.c.Tier)
            .ToList();

        var best = measured.FirstOrDefault(x => x.miles <= reachMiles);

        if (best != null)
            return (best.c.City, best.c.State, false,
                $"{DispatchEngine.Place(best.c.City, best.c.State)} is {Units.Distance(best.miles)} out and has the parking and " +
                $"services to sit {(IsEu(s) ? "a weekly rest" : "thirty-four hours")}. Tier-{best.c.Tier} freight market too, so you will not be " +
                "starting from nowhere when you come back on the clock." +
                (homeDeclined.Length > 0 ? " " + homeDeclined : ""));

        // Somewhere reset-capable exists, but not within the hours left. Say that, name it as the thing
        // they cannot reach, and tell them to park. Sending a driver over their clock to reach better
        // parking is the one outcome worse than parking somewhere ordinary.
        if (measured.Count > 0)
        {
            var nearest = measured[0];
            var needHours = mphNow > 0 ? nearest.miles / mphNow : 0;
            return ("", "", false,
                $"You have {Hhmm.Of(drivable)} of driving left and the nearest place I would choose — " +
                $"{DispatchEngine.Place(nearest.c.City, nearest.c.State)}, {Units.Distance(nearest.miles)} out — is about " +
                $"{Hhmm.Of(needHours)} away. That does not fit, so do not chase it. Park at the first safe place " +
                "you can reach inside your hours, report in from there, and I will start the clock on it. A truck " +
                "stop you can get to beats a better one you cannot." +
                (homeDeclined.Length > 0 ? " " + homeDeclined : ""));
        }

        // Nothing in the table we can measure against. Say so rather than invent a city.
        var fallback = options.FirstOrDefault();
        return fallback != null
            ? (fallback.City, fallback.State, false,
                $"{DispatchEngine.Place(fallback.City, fallback.State)} {(IsEu(s) ? "has the parking for a weekly rest" : "is reset-capable")}. I cannot measure the distance " +
                "from where you are, so check it is a sensible run before you commit." +
                (homeDeclined.Length > 0 ? " " + homeDeclined : ""))
            : ("", "", false,
                $"I have nowhere {(IsEu(s) ? "fit for a weekly rest" : "reset-capable")} on file near you. Find a truck stop with real parking and services, " +
                "report in when you are there, and I will start the clock." +
                (homeDeclined.Length > 0 ? " " + homeDeclined : ""));
    }

    /// <summary>Raises the order that stops dispatch until the restart is sat.</summary>
    public static RestartOrder Order(AppState s)
    {
        if (Open(s) is { } already) return already;

        var (city, state, isHome, why) = Where(s);
        var order = new RestartOrder
        {
            Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-RS-{s.RestartOrders.Count + 1:0000}",
            OrderedGameTime = s.Status.GameTime,
            CycleAtOrder = s.Hos.CycleRemaining,
            TargetCity = city,
            TargetState = state,
            AtHomeTerminal = isHome,
            Reason = why,
            RequiredHours = IsEu(s)
                ? EuWeeklyRestPlan(s, isHome, GameClock.TryParse(s.Status.GameTime)).Hours
                : s.Settings.Hos.CycleRestartHours,
            Status = "Ordered"
        };
        s.RestartOrders.Insert(0, order);
        return order;
    }

    /// <summary>What the driver is told, wherever they are reading it.</summary>
    public static List<string> Instructions(AppState s, RestartOrder order)
    {
        var lines = new List<string>();
        var where = string.IsNullOrWhiteSpace(order.TargetCity)
            ? "a truck stop with real parking"
            : DispatchEngine.Place(order.TargetCity, order.TargetState);

        if (order.Status == "Ordered" && order.Trigger == "Chosen")
        {
            lines.Add($"{order.Number}: you are taking a {What(s, order)} — at least {Hhmm.Of(order.RequiredHours)}.");
            if (IsEu(s) && order.Kind != "Daily" && order.RequiredHours >= (s.Settings.EuHos ?? new EuHosRules()).RegularWeeklyRest - 0.01)
                lines.Add("Away from the yard a full weekly rest is not taken in the cab (the Mobility Package): the company pays the hotel, " +
                          "booked when you report it done.");
            lines.Add("Report in when you have parked up and I will start the clock. Already resting? Give me the time you stopped.");
        }
        else if (order.Status == "Ordered")
        {
            if (order.Trigger == "Operational")
            {
                lines.Add($"{order.Number}: operations is parking you for {order.RequiredHours:0.#} hours — " +
                          $"{order.WhyParked}.");
                lines.Add("Your clocks are fine. This is the company's call, not a mark against you, and " +
                          "nothing about it touches your record.");
                lines.Add("No freight until it is sat, so you may as well be somewhere useful when it is over.");
            }
            else if (IsEu(s))
            {
                var euR = s.Settings.EuHos ?? new EuHosRules();
                var reduced = order.RequiredHours < euR.RegularWeeklyRest - 0.01;
                var plan = EuWeeklyRestPlan(s, order.AtHomeTerminal, GameClock.TryParse(order.OrderedGameTime));
                lines.Add($"{order.Number}: your weekly rest is due — six days since the last one are nearly up. " +
                          $"Dispatch has set it at {Hhmm.Of(order.RequiredHours)}: {plan.Why}. No more freight until it is taken.");
                if (reduced)
                    lines.Add($"That is a reduced weekly rest: the {Hhmm.Of(euR.RegularWeeklyRest - order.RequiredHours)} short of " +
                              $"{euR.RegularWeeklyRest:0} is owed back, and your next weekly rest is a full one that pays it — " +
                              "inside the three weeks the rules allow. I keep the count.");
                lines.Add("A daily rest will not do: only a weekly rest starts the six days again.");
                if (!reduced && !order.AtHomeTerminal)
                {
                    var cost = MobilityPackage.HotelCost(s, order.RequiredHours);
                    lines.Add("A full weekly rest away from home may not be taken in the cab — EU rules (the Mobility " +
                              "Package). Take it in a hotel; the company pays" +
                              (cost > 0 ? $", about {Units.Money0(cost)} for {MobilityPackage.HotelNights(order.RequiredHours)} night(s), " +
                                          "booked when you report it done." : "."));
                }
                else if (reduced)
                    lines.Add("A reduced weekly rest may be taken in the cab, parked, with a proper bunk.");
            }
            else
            {
                lines.Add($"{order.Number}: you are down to {Hhmm.Of(order.CycleAtOrder)} of cycle. " +
                          $"No more freight until you have sat the {order.RequiredHours:0.#}-hour restart.");
                lines.Add($"A {s.Settings.Hos.OffDutyReset:0.#}-hour rest will not fix this — a normal overnight " +
                          $"restores your drive and shift clocks but does not touch the {s.Settings.Hos.CycleLimit:0}-hour " +
                          $"cycle. Only the {order.RequiredHours:0.#} puts it back.");
            }
            lines.Add($"Go to {where}. {order.Reason}");
            lines.Add("Report in when you get there and I will start the clock on it.");
        }
        else
        {
            lines.Add($"{order.Number}: you are at {where} and your {What(s, order)} started " +
                      $"{GameClock.Pretty(order.ArrivedGameTime)}.");
            if (order.Kind == "Daily" && IsEu(s) && (s.Settings.EuHos ?? new EuHosRules()) is var dr
                && order.RequiredHours < dr.RegularDailyRest - 0.01)
                lines.Add($"A full daily rest is {dr.RegularDailyRest:0} hours; {Hhmm.Of(order.RequiredHours)} is a reduced one. " +
                          $"Earliest you can be back on the road is {GameClock.Pretty(order.EligibleGameTime)}.");
            else
                lines.Add($"Sit the full {Hhmm.Of(order.RequiredHours)}, then {(order.Kind == "Daily" ? "report it done" : "report your clocks")}. " +
                          $"Earliest you can be back on the road is {GameClock.Pretty(order.EligibleGameTime)}.");
            if (order.AtHomeTerminal)
                lines.Add("You are at the yard, so this is your home time as well — the clock on the next one resets here.");
        }
        return lines;
    }

    /// <summary>The driver has arrived and is parking up. Starts the clock.</summary>
    public static RestartOrder ReportArrived(AppState s, string gameTime, string city, string state)
    {
        var order = Current(s) ?? throw new InvalidOperationException("There is no rest on order.");
        if (order.Status == "Arrived")
            throw new InvalidOperationException($"{order.Number} already started at {GameClock.Pretty(order.ArrivedGameTime)}.");

        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        var at = GameClock.TryParse(when) ?? throw new InvalidOperationException("I need the game time you arrived.");

        order.Status = "Arrived";
        order.ArrivedGameTime = GameClock.Format(at);
        if (order.Trigger == "Chosen")
        {
            order.TargetCity = string.IsNullOrWhiteSpace(city) ? s.Status.LocationCity : city;
            order.TargetState = string.IsNullOrWhiteSpace(city) ? s.Status.LocationState : state;
            order.AtHomeTerminal = order.Kind != "Daily" && HomeTime.HomeTerminal(s) is { } home
                && string.Equals(home.City, order.TargetCity, StringComparison.OrdinalIgnoreCase)
                && string.Equals(home.State, order.TargetState, StringComparison.OrdinalIgnoreCase);
        }
        if (GameClock.TryParse(s.Status.GameTime) is not { } clock || at > clock) s.Status.GameTime = GameClock.Format(at);
        // EU: the length is settled when the rest starts, off the clocks then — how far Monday is, and whether
        // they are at the yard — not off what was true when it was ordered.
        if (IsEu(s) && order.Trigger is not ("Operational" or "Chosen") && order.Kind != "Daily")
        {
            var atYard = order.AtHomeTerminal || (HomeTime.HomeTerminal(s) is { } yard
                && string.Equals(yard.City, city, StringComparison.OrdinalIgnoreCase)
                && string.Equals(yard.State, state, StringComparison.OrdinalIgnoreCase));
            order.RequiredHours = EuWeeklyRestPlan(s, atYard, at).Hours;
        }
        order.EligibleGameTime = GameClock.Format(at.AddHours(order.RequiredHours));
        if (!string.IsNullOrWhiteSpace(city)) { order.ArrivedCity = city; order.ArrivedState = state; }
        return order;
    }

    /// <summary>
    /// The driver says the restart is done.
    ///
    /// Two things have to be true: enough game time really passed, and the cycle really came back. Both
    /// are checked, because a restart the app takes on trust is not a restart — it is a way of ignoring
    /// the rule the whole app exists to enforce.
    /// </summary>
    public static (RestartOrder Order, bool Accepted, string Message) ReportComplete(AppState s, string gameTime)
    {
        var order = Current(s) ?? throw new InvalidOperationException("There is no rest on order.");
        if (order.Status != "Arrived")
            throw new InvalidOperationException($"{order.Number}: report in where you have parked first so I can start the clock.");

        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        var now = GameClock.TryParse(when) ?? throw new InvalidOperationException("I need the game time.");
        var arrived = GameClock.TryParse(order.ArrivedGameTime)!.Value;

        var elapsed = (now - arrived).TotalHours;
        if (order.Kind == "Daily") return CompleteDaily(s, order, arrived, now, elapsed);

        // Clocks reported after the rest ended are the display's own word on them, and stand.
        var reportedSince = GameClock.TryParse(s.Hos.AsOfGameTime) is { } asOf && asOf > now ? asOf : (DateTime?)null;

        // EU: the weekly rest does not refill weekly driving — Monday does — so there is no cycle to check.
        // What it restores is the six days, the reduced-rest allowance and the day's clocks.
        if (IsEu(s))
        {
            if (elapsed + 0.01 < order.RequiredHours)
                return (order, false,
                    $"That is {Hhmm.Of(elapsed)} since you parked at {GameClock.Pretty(arrived)}. This weekly rest is " +
                    $"{order.RequiredHours:0.#} hours and you are {Hhmm.Of(order.RequiredHours - elapsed)} short — you are " +
                    $"eligible at {GameClock.Pretty(order.EligibleGameTime)}. Sit the rest of it and report again.");
            var r = s.Settings.EuHos ?? new EuHosRules();
            var reduced = elapsed < r.RegularWeeklyRest - 0.01;
            if (reduced) s.Hos.EuCompensationOwed = Math.Max(0, s.Hos.EuCompensationOwed) + (r.RegularWeeklyRest - elapsed);
            else s.Hos.EuCompensationOwed = Math.Max(0, s.Hos.EuCompensationOwed - (elapsed - r.RegularWeeklyRest));
            s.Hos.EuLastWeeklyRestReduced = reduced;
            s.Hos.EuHoursSinceWeeklyRest = reportedSince is { } later ? Math.Round((later - now).TotalHours, 2) : 0;
            var hotel = MobilityPackage.BookHotel(s, elapsed, reduced, order.AtHomeTerminal, order.Number);
            s.Hos.EuReducedRestsUsed = 0;
            if (reportedSince == null)
            {
                s.Hos.DriveRemaining = r.DailyDriving;
                s.Hos.ShiftRemaining = r.Spread;
                s.Hos.BreakRemaining = r.DrivingBeforeBreak;
                s.Hos.EuShiftStart = GameClock.Format(now);
                s.Hos.AsOfGameTime = GameClock.Format(now);
                s.Hos.Projected = false;
            }

            Close(s, order, arrived, now, elapsed);
            order.CycleAfter = s.Hos.CycleRemaining;
            var said = $"{order.Number} complete — {Hhmm.Of(elapsed)} of weekly rest" +
                       (reduced ? $", reduced: {Hhmm.Of(r.RegularWeeklyRest - elapsed)} owed back." : ".") +
                       (hotel > 0 ? $" {Units.Money0(hotel)} of hotel booked to the company." : "") +
                       " The six days start again now. You are clear for freight.";
            if (order.AtHomeTerminal) said += " That counted as your home time as well.";
            return (order, true, said);
        }

        var cycle = s.Hos.CycleRemaining;
        var full = s.Settings.Hos.CycleLimit;

        // The cycle should be back at, or very near, the limit. A driver who reports 12 hours has not
        // restarted anything — they have taken a long break.
        var cycleBack = cycle >= full - 0.5;

        if (elapsed + 0.01 < order.RequiredHours)
        {
            var shortBy = order.RequiredHours - elapsed;
            return (order, false,
                $"That is {Hhmm.Of(elapsed)} since you parked at {GameClock.Pretty(arrived)}. The restart is " +
                $"{order.RequiredHours:0.#} hours and you are {Hhmm.Of(shortBy)} short — you are eligible at " +
                $"{GameClock.Pretty(order.EligibleGameTime)}. Sit the rest of it and report again.");
        }

        if (!cycleBack)
            return (order, false,
                $"{Hhmm.Of(elapsed)} is long enough, but your cycle is showing {Hhmm.Of(cycle)} against a " +
                $"{full:0.#}-hour limit. A completed restart puts the whole {full:0.#} back. Re-read your HOS " +
                "display — if it really has not reset, the break was broken somewhere.");

        Close(s, order, arrived, now, elapsed);
        order.CycleAfter = cycle;

        var msg = $"{order.Number} complete — {Hhmm.Of(elapsed)} parked, cycle back to {Hhmm.Of(cycle)}. " +
                  "You are clear for freight.";
        if (order.AtHomeTerminal) msg += " That counted as your home time as well.";
        return (order, true, msg);
    }

    // ---------------------------------------------------------------- rests the driver takes

    /// <summary>The driver's own daily rest, while it is on order or running.</summary>
    public static RestartOrder? OpenDaily(AppState s) =>
        s.RestartOrders.FirstOrDefault(r => r.Status is "Ordered" or "Arrived" && r.Kind == "Daily");

    /// <summary>
    /// The rest the parked-up and rest-done steps act on: a daily rest where one is open — taken on the way to a
    /// weekly rest dispatch has ordered, say — otherwise the weekly one.
    /// </summary>
    public static RestartOrder? Current(AppState s) => OpenDaily(s) ?? Open(s);

    /// <summary>What a rest is called, for the driver: "daily rest", "reduced weekly rest", "34-hour restart".</summary>
    public static string What(AppState s, RestartOrder o)
    {
        if (IsEu(s))
            return o.Kind == "Daily" ? "daily rest"
                : o.RequiredHours < (s.Settings.EuHos ?? new EuHosRules()).RegularWeeklyRest - 0.01 ? "reduced weekly rest" : "weekly rest";
        return o.Kind == "Daily" ? $"{s.Settings.Hos.OffDutyReset:0.#}-hour rest" : $"{o.RequiredHours:0.#}-hour restart";
    }

    /// <summary>The least a daily rest can be: EU, nine where a reduced one is left before the weekly rest, eleven where not; US, ten.</summary>
    public static double DailyMinimum(AppState s)
    {
        if (!IsEu(s)) return s.Settings.Hos.OffDutyReset;
        var r = s.Settings.EuHos ?? new EuHosRules();
        return s.Hos.EuReducedRestsUsed < r.ReducedRestsBetweenWeekly ? r.ReducedDailyRest : r.RegularDailyRest;
    }

    /// <summary>A rest the driver can choose: its key (daily, reduced, weekly), its name, the least it can be, and a word on it.</summary>
    public record RestChoice(string Key, string Label, double Hours, string Note);

    /// <summary>
    /// The rests the driver can say they are taking. None while one is already running, or while one they chose is
    /// on order. A weekly rest dispatch has ordered and they have not started does not stop them choosing one: theirs
    /// stands in for it (see <see cref="Take"/>). EU: the reduced weekly rest only where the last was a regular one.
    /// </summary>
    public static List<RestChoice> Choices(AppState s)
    {
        var list = new List<RestChoice>();
        var weekly = Open(s);
        if (OpenDaily(s) != null || weekly is { Status: "Arrived" } or { Trigger: "Chosen" }) return list;
        if (IsEu(s))
        {
            var r = s.Settings.EuHos ?? new EuHosRules();
            var reducedLeft = Math.Max(0, r.ReducedRestsBetweenWeekly - s.Hos.EuReducedRestsUsed);
            list.Add(new("daily", "Daily rest", DailyMinimum(s), reducedLeft > 0
                ? $"{r.RegularDailyRest:0} hours, or {r.ReducedDailyRest:0} as a reduced one ({reducedLeft} left before your weekly rest)"
                : $"{r.RegularDailyRest:0} hours — your reduced daily rests are used until the weekly rest"));
            var owed = Math.Max(0, s.Hos.EuCompensationOwed);
            if (r.AllowReducedWeeklyRest && !s.Hos.EuLastWeeklyRestReduced
                && !(GameClock.TryParse(s.Status.GameTime) is { } now && EuCounters.ReducedWeeklyUsedUp(s, now)))
                list.Add(new("reduced", "Reduced weekly rest", r.ReducedWeeklyRest,
                    $"{r.ReducedWeeklyRest:0} hours, in the cab — {Hhmm.Of(r.RegularWeeklyRest - r.ReducedWeeklyRest)} owed back on a later weekly rest"));
            list.Add(new("weekly", "Weekly rest", r.RegularWeeklyRest,
                $"a full {r.RegularWeeklyRest:0} hours" + (owed > 0.01 ? $" — anything past it pays back the {Hhmm.Of(owed)} owed" : "")));
        }
        else
        {
            var h = s.Settings.Hos;
            list.Add(new("daily", $"{h.OffDutyReset:0.#}-hour rest", h.OffDutyReset, "your drive and shift clocks back"));
            list.Add(new("weekly", $"{h.CycleRestartHours:0.#}-hour restart", h.CycleRestartHours, $"the {h.CycleLimit:0}-hour cycle back"));
        }
        return list;
    }

    private static string NextNumber(AppState s) =>
        $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-RS-{s.RestartOrders.Count + 1:0000}";

    /// <summary>
    /// The driver is taking a rest of their own choosing. Raised as an order, so it goes through the same two steps
    /// as one dispatch orders — parked up, which starts the clock, and done, which checks it was long enough — and the
    /// parked-up time can be one already past, for a rest already under way. A weekly one stands in for a weekly rest
    /// dispatch has ordered and they have not started. Reported from play: a 45 sat while the truck was in the shop,
    /// with nowhere to say so, and the app ordered the weekly rest again.
    /// </summary>
    public static RestartOrder Take(AppState s, string key)
    {
        var choice = Choices(s).FirstOrDefault(c => c.Key == key)
            ?? throw new InvalidOperationException(Current(s) is { } open
                ? $"{open.Number} is already {(open.Status == "Arrived" ? "running" : "on order")} — finish that one first."
                : "That is not a rest you can take now.");
        var kind = key == "daily" ? "Daily" : "Weekly";
        if (kind == "Weekly" && Open(s) is { Status: "Ordered" } ordered)
        {
            ordered.Status = "Cancelled";
            ordered.CompletedGameTime = s.Status.GameTime;
            ordered.Reason = $"Taken as {NextNumber(s)}, the rest you chose. {ordered.Reason}";
        }
        var order = new RestartOrder
        {
            Number = NextNumber(s),
            OrderedGameTime = s.Status.GameTime,
            CycleAtOrder = s.Hos.CycleRemaining,
            Trigger = "Chosen",
            Kind = kind,
            TargetCity = s.Status.LocationCity,
            TargetState = s.Status.LocationState,
            Reason = $"Your call: a {choice.Label.ToLowerInvariant()}.",
            RequiredHours = choice.Hours,
            Status = "Ordered",
        };
        s.RestartOrders.Insert(0, order);
        return order;
    }

    /// <summary>A rest the driver chose, called off — before it started, or started by mistake. Not counted.</summary>
    public static RestartOrder Cancel(AppState s)
    {
        var order = Current(s) is { Trigger: "Chosen" } o ? o
            : throw new InvalidOperationException("Only a rest you chose can be called off. One dispatch ordered has to be sat.");
        order.Status = "Cancelled";
        order.CompletedGameTime = s.Status.GameTime;
        return order;
    }

    /// <summary>
    /// Marks a rest sat, and puts it where everything else will see it: the game clock moved on to its end, the trip
    /// log of the load it was taken during — which is what teaches the planner the driving speed, and the counters
    /// then read it from there — and a question about a gap in the clock that it answers, dropped.
    /// </summary>
    private static void Close(AppState s, RestartOrder order, DateTime arrived, DateTime end, double elapsed)
    {
        order.Status = "Completed";
        order.CompletedGameTime = GameClock.Format(end);
        order.ElapsedHours = Math.Round(elapsed, 2);
        if (GameClock.TryParse(s.Status.GameTime) is not { } clock || end > clock) s.Status.GameTime = GameClock.Format(end);
        if (TripService.Active(s) is { } trip && order.TripEventId.Length == 0)
        {
            var ev = new TripEvent
            {
                GameTime = GameClock.Format(arrived),
                EndGameTime = GameClock.Format(end),
                Kind = order.Kind == "Daily" ? "Rest" : "Restart",
                City = string.IsNullOrWhiteSpace(order.ArrivedCity) ? s.Status.LocationCity : order.ArrivedCity,
                State = string.IsNullOrWhiteSpace(order.ArrivedCity) ? s.Status.LocationState : order.ArrivedState,
                Detail = $"{order.Number}: {What(s, order)}, {Hhmm.Of(elapsed)}.",
                WeeklyRest = order.Kind == "Daily" ? "daily" : "weekly",
            };
            trip.Events.Add(ev);
            order.TripEventId = ev.Id;
        }
        if (GameClock.TryParse(s.Status.RestGapFrom) is { } gapFrom && GameClock.TryParse(s.Status.RestGapTo) is { } gapTo
            && arrived < gapTo && end > gapFrom)
            s.Status.RestGapFrom = s.Status.RestGapTo = "";
    }

    /// <summary>
    /// A daily rest, done. Long enough is all that is checked — see <see cref="DailyMinimum"/> — and the day's clocks
    /// come back: EU, D to the day's limit, B to four and a half and a fresh spread; US, the drive clock, the window
    /// and the break clock. Neither the week nor the cycle moves: a rest is not driving, and only Monday or the 34
    /// gives those back. Clocks reported after the rest ended are the display's own word, and are left alone.
    /// </summary>
    private static (RestartOrder Order, bool Accepted, string Message) CompleteDaily(AppState s, RestartOrder order,
        DateTime arrived, DateTime now, double elapsed)
    {
        if (elapsed + 0.01 < order.RequiredHours)
            return (order, false,
                $"That is {Hhmm.Of(elapsed)} since you parked at {GameClock.Pretty(arrived)}. A {What(s, order)} is at least " +
                $"{Hhmm.Of(order.RequiredHours)} and you are {Hhmm.Of(order.RequiredHours - elapsed)} short — you are eligible at " +
                $"{GameClock.Pretty(order.EligibleGameTime)}. Sit the rest of it and report again.");

        var fresh = GameClock.TryParse(s.Hos.AsOfGameTime) is not { } reported || now >= reported;
        Close(s, order, arrived, now, elapsed);
        if (IsEu(s))
        {
            var r = s.Settings.EuHos ?? new EuHosRules();
            if (fresh)
            {
                s.Hos.DriveRemaining = r.ExtendedDailyDriving;
                s.Hos.BreakRemaining = r.DrivingBeforeBreak;
            }
            EuCounters.Derive(s, now, s.Hos.EuWeekDriven, s.Hos.EuDayWeek, report: false);
            if (fresh)
            {
                s.Hos.DriveRemaining = s.Hos.EuDailyLimit > 0 ? s.Hos.EuDailyLimit : r.DailyDriving;
                s.Hos.EuDriveCapped = false;
                s.Hos.EuClocksFromRest = true;
                s.Hos.EuShiftStart = GameClock.Format(now);
                s.Hos.AsOfGameTime = GameClock.Format(now);
                s.Hos.Projected = false;
            }
            var value = elapsed >= r.ReducedWeeklyRest - 0.01 && elapsed < r.RegularWeeklyRest - 0.01
                ? "a long daily rest, not your weekly one — your six days run on"
                : EuCounters.RestValue(s, elapsed, arrived);
            return (order, true, $"{order.Number} complete — {Hhmm.Of(elapsed)} off: under EU rules that is {value}." +
                (fresh ? $" A fresh day: {Hhmm.Of(s.Hos.DriveRemaining)} to drive, {Hhmm.Of(s.Hos.BreakRemaining)} before the break." : ""));
        }

        var h = s.Settings.Hos;
        if (fresh)
        {
            s.Hos.DriveRemaining = h.DriveLimit;
            s.Hos.ShiftRemaining = h.ShiftLimit;
            s.Hos.BreakRemaining = h.DrivingBeforeBreak;
            s.Hos.AsOfGameTime = GameClock.Format(now);
            s.Hos.Projected = false;
        }
        return (order, true, $"{order.Number} complete — {Hhmm.Of(elapsed)} off." +
            (fresh ? $" Your clocks are back: {Hhmm.Of(h.DriveLimit)} to drive in a {Hhmm.Of(h.ShiftLimit)} window." : "") +
            (elapsed >= h.CycleRestartHours - 0.01
                ? $" That is long enough for a restart too — report your clocks so the {h.CycleLimit:0}-hour cycle comes back."
                : " A rest does not touch the cycle."));
    }

    /// <summary>
    /// A status report has moved the game clock on. Where the jump is long enough to have held a rest — after what the
    /// odometer says was driven is taken off — and nothing logged covers it, it is kept as a question for the driver:
    /// were you resting? Never assumed, because a long jump is as often a day's driving reported late. Not asked over
    /// home time, which counts itself, over days the game skipped for a trailer, or while a rest is running.
    /// </summary>
    public static void NoteGap(AppState s, DateTime? before, double odometerBefore, bool wentHome)
    {
        if (before is not { } from || GameClock.TryParse(s.Status.GameTime) is not { } to || to <= from) return;
        if (wentHome || EuHomeContract.OnHold(s) || Current(s) is { Status: "Arrived" }
            || EquipmentService.PendingTrailerWait(s) != null) return;
        var least = DailyMinimum(s);
        var miles = odometerBefore > 0 ? Math.Max(0, s.Status.AtsOdometer - odometerBefore) : 0;
        var mph = HosEngine.EffectiveMph(s.Settings, DispatchEngine.AssignedTruck(s));
        var driving = mph > 0 ? miles / mph : 0;
        if ((to - from).TotalHours - driving < least - 0.01) return;

        // Already on the record: a rest on the trip log, or one sat through the steps.
        var logged = s.Trips.SelectMany(t => t.Events).Where(EuCounters.IsTimeOff)
            .Select(e => (Start: GameClock.TryParse(e.GameTime), End: GameClock.TryParse(e.EndGameTime)))
            .Concat(s.RestartOrders.Where(o => o.Status == "Completed")
                .Select(o => (Start: GameClock.TryParse(o.ArrivedGameTime), End: GameClock.TryParse(o.CompletedGameTime))))
            .Any(x => x.Start is { } a && x.End is { } b && (b - a).TotalHours >= least - 0.01 && a < to && b > from);
        if (logged) return;

        // A jump straight on from one already asked about stretches the same question — unless clocks were reported
        // at its end, which says the driver was back on duty there.
        var keepFrom = s.Status.RestGapTo == GameClock.Format(from) && GameClock.TryParse(s.Status.RestGapFrom) is { } earlier
                       && !(GameClock.TryParse(s.Hos.AsOfGameTime) is { } read && read >= from)
            ? earlier : from;
        s.Status.RestGapFrom = GameClock.Format(keepFrom);
        s.Status.RestGapTo = GameClock.Format(to);
    }

    /// <summary>
    /// The answer to a gap: yes, a rest — sat from <paramref name="from"/> to <paramref name="to"/>, and checked as one
    /// reported as it happened would be. Checked before anything is written, so a refusal leaves nothing behind.
    /// </summary>
    public static (RestartOrder Order, string Message) LogGap(AppState s, string key, string from, string to)
    {
        var start = GameClock.TryParse(from) ?? throw new InvalidOperationException("When did the rest begin?");
        var end = GameClock.TryParse(to) ?? throw new InvalidOperationException("When did the rest end?");
        if (end <= start) throw new InvalidOperationException("The rest has to end after it began.");
        var choice = Choices(s).FirstOrDefault(c => c.Key == key)
                     ?? throw new InvalidOperationException("That is not a rest you can log now — finish the one that is open first.");
        var hours = (end - start).TotalHours;
        if (hours + 0.01 < choice.Hours)
            throw new InvalidOperationException($"{Hhmm.Of(hours)} is short of a {choice.Label.ToLowerInvariant()} — that is at least {Hhmm.Of(choice.Hours)}.");
        if (!IsEu(s) && key == "weekly" && s.Hos.CycleRemaining < s.Settings.Hos.CycleLimit - 0.5)
            throw new InvalidOperationException($"Your cycle is showing {Hhmm.Of(s.Hos.CycleRemaining)}. Report your clocks off the HOS display " +
                                                "first — a restart puts the whole cycle back — then log it.");

        var order = Take(s, key);
        ReportArrived(s, GameClock.Format(start), s.Status.LocationCity, s.Status.LocationState);
        var (_, accepted, message) = ReportComplete(s, GameClock.Format(end));
        if (!accepted) throw new InvalidOperationException(message);
        s.Status.RestGapFrom = s.Status.RestGapTo = "";
        return (order, message);
    }

    /// <summary>No, not a rest: the question about the gap is dropped.</summary>
    public static void DismissGap(AppState s) => s.Status.RestGapFrom = s.Status.RestGapTo = "";
}
