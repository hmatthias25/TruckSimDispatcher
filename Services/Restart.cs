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
        var open = s.RestartOrders.FirstOrDefault(r => r.Status is "Ordered" or "Arrived");
        if (open == null) return null;

        // Ordered but never parked up, and a restart is no longer called for. Either the cycle came
        // back — the driver re-read their display and it was better than we thought, and their display
        // is authoritative — or recap now covers it, which is the whole point of the recap adviser.
        // Holding them against a problem that no longer exists would be the app being stubborn.
        if (open.Status == "Ordered" && open.Trigger != "Operational" && !Needed(s))
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
        // behind them. Frozen once they have parked up, because then the clock is running.
        if (open.Status == "Ordered")
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
            var closeEnough = hoursHome <= maxHop && hoursHome <= Math.Max(1, s.Hos.CycleRemaining);
            var dueEnough = homeStatus.Tracked
                            && (homeStatus.Overdue
                                || homeStatus.DaysUntilDue <= s.Settings.Hos.RestartHomeMaxDaysUntilDue);

            if (closeEnough && dueEnough)
                return (home.City, home.State, true,
                    $"Home time is {(homeStatus.Overdue ? "overdue" : $"due in {homeStatus.DaysUntilDue:0.#} days")} and " +
                    $"{DispatchEngine.Place(home.City, home.State)} is {toHome:N0} mi out — about {Hhmm.Of(hoursHome)} " +
                    "empty. Worth it to do both in one stop: sit the restart at the yard and take your home time while " +
                    "you are there, rather than thirty-four hours here and a run home a day later.");

            // Declined, and worth saying why — otherwise the driver wonders why they are sitting at a
            // truck stop with the yard on the map.
            if (homeStatus.Tracked && toHome is { } far)
            {
                if (!dueEnough && !closeEnough)
                    homeDeclined = $"The yard is {far:N0} mi out and home time is not due for " +
                                   $"{homeStatus.DaysUntilDue:0.#} days, so I am not running you there empty for this. " +
                                   "I will work you back with freight when it is closer.";
                else if (!dueEnough)
                    homeDeclined = $"{DispatchEngine.Place(home.City, home.State)} is close, but home time is not due " +
                                   $"for {homeStatus.DaysUntilDue:0.#} days — no point burning the trip now. " +
                                   "I will route you home with a load nearer the time.";
                else
                    homeDeclined = $"Home time is {(homeStatus.Overdue ? "overdue" : "close")}, but the yard is " +
                                   $"{far:N0} mi out — about {Hhmm.Of(hoursHome)} empty, and that is too far to " +
                                   "deadhead for a restart. Sit it here and I will get you home with freight.";
            }
        }

        var options = Markets.ResetOptions(s, here.LocationState, 40);
        var best = options
            .Select(c => new
            {
                c,
                miles = Geo.MilesBetween(here.LocationCity, here.LocationState, c.City, c.State) ?? double.MaxValue
            })
            .Where(x => x.miles < double.MaxValue)
            .OrderBy(x => x.miles)
            .ThenBy(x => x.c.Tier)
            .FirstOrDefault();

        if (best != null)
            return (best.c.City, best.c.State, false,
                $"{DispatchEngine.Place(best.c.City, best.c.State)} is {best.miles:N0} mi out and has the parking and " +
                $"services to sit thirty-four hours. Tier-{best.c.Tier} freight market too, so you will not be " +
                "starting from nowhere when you come back on the clock." +
                (homeDeclined.Length > 0 ? " " + homeDeclined : ""));

        // Nothing in the table we can measure against. Say so rather than invent a city.
        var fallback = options.FirstOrDefault();
        return fallback != null
            ? (fallback.City, fallback.State, false,
                $"{DispatchEngine.Place(fallback.City, fallback.State)} is reset-capable. I cannot measure the distance " +
                "from where you are, so check it is a sensible run before you commit." +
                (homeDeclined.Length > 0 ? " " + homeDeclined : ""))
            : ("", "", false,
                "I have nowhere reset-capable on file near you. Find a truck stop with real parking and services, " +
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
            RequiredHours = s.Settings.Hos.CycleRestartHours,
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

        if (order.Status == "Ordered")
        {
            if (order.Trigger == "Operational")
            {
                lines.Add($"{order.Number}: operations is parking you for {order.RequiredHours:0.#} hours — " +
                          $"{order.WhyParked}.");
                lines.Add("Your clocks are fine. This is the company's call, not a mark against you, and " +
                          "nothing about it touches your record.");
                lines.Add("No freight until it is sat, so you may as well be somewhere useful when it is over.");
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
            lines.Add($"{order.Number}: you are at {where} and the restart started " +
                      $"{GameClock.Pretty(order.ArrivedGameTime)}.");
            lines.Add($"Sit the full {order.RequiredHours:0.#} hours, then report your clocks. " +
                      $"Earliest you can be back on the road is {GameClock.Pretty(order.EligibleGameTime)}.");
            if (order.AtHomeTerminal)
                lines.Add("You are at the yard, so this is your home time as well — the clock on the next one resets here.");
        }
        return lines;
    }

    /// <summary>The driver has arrived and is parking up. Starts the clock.</summary>
    public static RestartOrder ReportArrived(AppState s, string gameTime, string city, string state)
    {
        var order = Open(s) ?? throw new InvalidOperationException("There is no restart on order.");
        if (order.Status == "Arrived")
            throw new InvalidOperationException($"{order.Number} already started at {GameClock.Pretty(order.ArrivedGameTime)}.");

        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        var at = GameClock.TryParse(when) ?? throw new InvalidOperationException("I need the game time you arrived.");

        order.Status = "Arrived";
        order.ArrivedGameTime = GameClock.Format(at);
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
        var order = Open(s) ?? throw new InvalidOperationException("There is no restart on order.");
        if (order.Status != "Arrived")
            throw new InvalidOperationException($"{order.Number}: report in at the truck stop first so I can start the clock.");

        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        var now = GameClock.TryParse(when) ?? throw new InvalidOperationException("I need the game time.");
        var arrived = GameClock.TryParse(order.ArrivedGameTime)!.Value;

        var elapsed = (now - arrived).TotalHours;
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

        order.Status = "Completed";
        order.CompletedGameTime = GameClock.Format(now);
        order.ElapsedHours = Math.Round(elapsed, 2);
        order.CycleAfter = cycle;

        var msg = $"{order.Number} complete — {Hhmm.Of(elapsed)} parked, cycle back to {Hhmm.Of(cycle)}. " +
                  "You are clear for freight.";
        if (order.AtHomeTerminal) msg += " That counted as your home time as well.";
        return (order, true, msg);
    }
}
