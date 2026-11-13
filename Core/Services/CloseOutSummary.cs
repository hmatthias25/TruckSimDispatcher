using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>One labelled figure on the close-out screen. <see cref="Tone"/> is "good", "bad", "warn" or empty.</summary>
public class SummaryRow
{
    public string Label { get; set; } = "";
    public string Value { get; set; } = "";
    /// <summary>A short line under the value, where the figure needs one. Never a paragraph.</summary>
    public string Detail { get; set; } = "";
    public string Tone { get; set; } = "";
}

public class SummarySection
{
    /// <summary>"delivery", "docks", "miles", "money" or "now": where an app slots its own section in.</summary>
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    public List<SummaryRow> Rows { get; set; } = new();

    public SummarySection Add(string label, string value, string detail = "", string tone = "")
    {
        if (!string.IsNullOrWhiteSpace(value))
            Rows.Add(new SummaryRow { Label = label, Value = value, Detail = detail, Tone = tone });
        return this;
    }
}

/// <summary>
/// The close-out screen, as figures rather than prose.
///
/// <para>Reported from play on 2026-11-09: the summary after a delivery read as a wall of sentences, several of
/// them saying the same thing, some about the planner's own learning, and a few plainly wrong ("it counts as on
/// time" under a load marked late). This builds what the player needs at a glance from the trip as it was closed:
/// when they got there against when they were due, how long each dock had them, the miles, and where the truck and
/// its clocks stand now. Each app adds its own money section. The finding lists stay on the audit as the working
/// behind these figures.</para>
///
/// Shared by both apps, so the company-driver close-out and the owner/operator's read the same way.
/// </summary>
public static class CloseOutSummary
{
    /// <summary>The sections every close-out has. An app slots its money in with <see cref="InsertMoney"/>.</summary>
    public static List<SummarySection> Build(AppState s, Trip trip, TripAudit audit, bool ownerOperator = false)
    {
        var list = new List<SummarySection>();
        if (Delivery(s, trip, audit, ownerOperator) is { Rows.Count: > 0 } d) list.Add(d);
        if (Docks(s, trip) is { Rows.Count: > 0 } k) list.Add(k);
        if (Miles(trip) is { Rows.Count: > 0 } m) list.Add(m);
        list.Add(Now(s, audit, ownerOperator));
        return list;
    }

    /// <summary>Puts an app's money section in before where the truck stands, which always reads last.</summary>
    public static void InsertMoney(TripAudit audit, SummarySection money)
    {
        if (money.Rows.Count == 0) return;
        var now = audit.Summary.FindIndex(x => x.Key == "now");
        if (now < 0) audit.Summary.Add(money); else audit.Summary.Insert(now, money);
    }

    private static SummarySection Delivery(AppState s, Trip trip, TripAudit audit, bool ownerOperator)
    {
        var sec = new SummarySection { Key = "delivery", Title = "Delivery" };
        if (trip.Kind != "Freight") return sec.Add("Result", "No delivery window on a move like this");

        var del = GameClock.TryParse(trip.DeliveredGameTime);
        var due = GameClock.TryParse(trip.DueGameTime);
        var slot = trip.ReceiverTakesEarly ? null : GameClock.TryParse(trip.AppointmentGameTime);
        var opens = GameClock.TryParse(trip.AppointmentOpensGameTime);
        var grace = Math.Max(0, s.Settings.AppointmentGraceHours);
        var late = trip.ServiceResult == "Late";

        if (del is { } arrived) sec.Add("Arrived", GameClock.Pretty(arrived));

        if (slot is { } sl)
            sec.Add("Appointment", GameClock.Pretty(sl),
                due is { } d0 && d0 > sl ? $"Window closes {GameClock.Pretty(d0)}" : "");
        else if (due is { } d1)
            sec.Add(trip.ReceiverTakesEarly ? "Deliver by" : "Due", GameClock.Pretty(d1),
                trip.ReceiverTakesEarly ? "No set slot: they take it whenever it arrives"
                : opens is { } o && o < d1 ? $"Window opens {GameClock.Pretty(o)}" : "");

        // The result, in the terms it was judged on. ServiceResult decides late or not; this only says by how much.
        if (del is { } at)
        {
            if (late)
            {
                var pastSlot = slot is { } s1 ? (at - s1).TotalHours : 0;
                var byDue = due is { } d2 ? (at - d2).TotalHours : 0;
                var value = byDue > 0.01 ? $"Late by {Hhmm.Of(byDue)}"
                    : pastSlot > 0.01 ? $"Late: {Hhmm.Of(pastSlot)} after the appointment"
                    : "Late";
                var detail = byDue <= 0.01 && pastSlot > 0.01 ? $"More than the {Hhmm.Of(grace)} grace they allow" : "";
                sec.Add("Result", value, detail, "bad");
            }
            else if (slot is { } s2 && at > s2)
                sec.Add("Result", "On time", $"{Hhmm.Of((at - s2).TotalHours)} after the appointment, inside the {Hhmm.Of(grace)} grace", "good");
            else if (slot is { } s3)
                sec.Add("Result", "On time", (s3 - at).TotalHours > 0.01 ? $"{Hhmm.Of((s3 - at).TotalHours)} before the appointment" : "", "good");
            else if (due is { } d3)
                sec.Add("Result", "On time", (d3 - at).TotalHours > 0.01 ? $"{Hhmm.Of((d3 - at).TotalHours)} to spare" : "", "good");
            else
                sec.Add("Result", "On time", "", "good");
        }
        else
            sec.Add("Result", late ? "Late" : "On time", "No delivery time was reported", late ? "bad" : "good");

        if (late)
            sec.Add("Whose fault", FaultWord(audit.FaultAttribution, ownerOperator), "",
                audit.FaultAttribution == "Driver" ? "bad" : "");

        // Against the plan it was booked on: a figure, not a lecture.
        if (trip.FeasibilityAtDispatch is { } f && del is { } got && DispatchEngine.GateArrivalOf(f) is { } planned)
        {
            var drift = (got - planned).TotalHours;
            sec.Add("Planned arrival", GameClock.Pretty(planned),
                Math.Abs(drift) < 0.25 ? "You were right on the plan"
                : drift > 0 ? $"You got there {Hhmm.Of(drift)} later" : $"You got there {Hhmm.Of(-drift)} sooner");
        }
        return sec;
    }

    /// <summary>The fault, said as a person would.</summary>
    public static string FaultWord(string fault, bool ownerOperator) => fault switch
    {
        "Driver" => "Yours",
        "Dispatcher" => ownerOperator ? "Yours, as your own dispatcher" : "Dispatch's: the load was booked too tight",
        "Unavoidable" => "Nobody's: the road or the dock",
        "Mechanical" => "The truck",
        "GameLimitation" => "The game",
        _ => fault,
    };

    private static SummarySection Docks(AppState s, Trip trip)
    {
        var sec = new SummarySection { Key = "docks", Title = "At the docks" };

        // Logged at the dock, or the plan's figure standing in for it: said which, so an estimate never reads as measured.
        var loadLogged = trip.Events.Any(e => e.Kind == "EndLoad");
        var unloadLogged = trip.Events.Any(e => e.Kind == "EndUnload");
        const string NotLogged = "Nothing logged at the dock: the planned time";

        var atShipper = TripService.TimeAtShipperFor(trip, trip.LoadingHours, out var shipperWait);
        if (trip.PreLoaded)
            sec.Add("Shipper", atShipper is { } h0 ? Hhmm.Of(h0) : "Pre-loaded", atShipper != null ? "Pre-loaded: hooked and away" : "Hooked and away");
        else if (atShipper is { } h1)
            sec.Add("Shipper", Hhmm.Of(h1), loadLogged || shipperWait > 0.01
                ? Split(shipperWait, Math.Max(0, h1 - shipperWait), "loading", loadLogged) : NotLogged);
        else if (trip.LoadingHours > 0)
            sec.Add("Shipper", Hhmm.Of(trip.LoadingHours), loadLogged ? "Loading" : NotLogged);

        var atReceiver = TripService.TimeOnTheirPropertyFor(trip, trip.UnloadingHours, out var receiverWait);
        if (atReceiver is { } h2)
            sec.Add("Receiver", Hhmm.Of(h2), trip.UnloadingHours > 0 && (unloadLogged || receiverWait > 0.01)
                ? Split(receiverWait, Math.Min(trip.UnloadingHours, Math.Max(0, h2 - receiverWait)), "unloading", unloadLogged)
                : receiverWait > 0.01 ? "Waiting for them to take you"
                : unloadLogged ? "" : NotLogged);
        // Taken before the slot: nothing on their clock, but the stay itself is still what the player sat through.
        else if (GameClock.TryParse(trip.ArrivedGameTime) is { } got
                 && trip.Events.Where(e => e.Kind == "EndUnload").Select(e => GameClock.TryParse(e.GameTime)).Max() is { } done
                 && done > got)
        {
            var stay = (done - got).TotalHours;
            sec.Add("Receiver", Hhmm.Of(stay), Split(Math.Max(0, stay - trip.UnloadingHours), Math.Min(trip.UnloadingHours, stay), "unloading"));
        }
        else if (trip.UnloadingHours > 0)
            sec.Add("Receiver", Hhmm.Of(trip.UnloadingHours), unloadLogged ? "Unloading" : NotLogged);

        if (sec.Rows.Count == 0) return sec;
        var free = Math.Max(0, s.Driver.Pay.DetentionFreeHours);
        var queueFree = Math.Max(0, s.Driver.Pay.QueueFreeHours);
        sec.Add("Detention", trip.DetentionHours > 0.01 ? Hhmm.Of(trip.DetentionHours) : "None",
            $"Free time: {Hhmm.Of(free)} for the work, {Hhmm.Of(queueFree)} for waiting",
            trip.DetentionHours > 0.01 ? "good" : "");
        return sec;
    }

    /// <summary>Waiting, then the work: the work marked as the plan's figure where nothing was logged at the dock.</summary>
    private static string Split(double waited, double worked, string work, bool logged = true) =>
        !logged ? (waited > 0.01 ? $"{Hhmm.Of(waited)} waiting, then {Hhmm.Of(worked)} {work} as planned (nothing logged)"
                                 : $"{Hhmm.Of(worked)} {work} as planned (nothing logged)")
        : waited > 0.01 ? $"{Hhmm.Of(waited)} waiting, {Hhmm.Of(worked)} {work}" : $"All {work}";

    private static SummarySection Miles(Trip trip)
    {
        var sec = new SummarySection { Key = "miles", Title = "Distance" };
        if (trip.ActualMiles > 0)
        {
            var detail = "";
            var tone = "";
            if (trip.DispatchedMiles > 0)
            {
                var pct = (trip.ActualMiles - trip.DispatchedMiles) / trip.DispatchedMiles * 100;
                detail = Math.Abs(pct) < 1 ? $"Planned {Units.Distance(trip.DispatchedMiles)}"
                    : $"Planned {Units.Distance(trip.DispatchedMiles)} ({pct:+0;-0}%)";
                if (pct > 12) { tone = "warn"; detail += ": more than a detour should cost"; }
            }
            sec.Add("Driven loaded", Units.Distance(trip.ActualMiles), detail, tone);
        }
        if (trip.DeadheadMiles > 0) sec.Add("Empty to the pickup", Units.Distance(trip.DeadheadMiles));
        if (trip.StartOdometer > 0 && trip.EndOdometer > trip.StartOdometer)
            sec.Add("Odometer", $"{trip.StartOdometer:N0} → {trip.EndOdometer:N0}");
        return sec;
    }

    private static SummarySection Now(AppState s, TripAudit audit, bool ownerOperator)
    {
        var sec = new SummarySection { Key = "now", Title = "Where you stand now" };
        var st = s.Status;
        sec.Add("Location", DispatchEngine.Place(st.LocationCity, st.LocationState), st.LocationDetail ?? "");
        sec.Add("Game clock", GameClock.Pretty(st.GameTime));
        sec.Add("Clocks", Clocks(s),
            !audit.ClocksReported && !s.Hos.Confirmed && !s.Hos.Projected ? "Not reported: read them off the game before the next load"
            : s.Hos.Projected ? "Worked out across the unload: check them against the game"
            : "As you read them at delivery",
            !audit.ClocksReported && !s.Hos.Confirmed && !s.Hos.Projected ? "warn" : "");
        if (st.FuelPct >= 0) sec.Add("Fuel", $"{st.FuelPct:0}%");
        // The owner/operator's truck is the Companion App's to look after; damage is not reported here.
        if (!ownerOperator) sec.Add("Damage", $"Tractor {st.TruckDamagePct:0.#}% · trailer {st.TrailerDamagePct:0.#}%");
        return sec;
    }

    /// <summary>The clocks as the game shows them, after the unload.</summary>
    public static string Clocks(AppState s)
    {
        var h = s.Hos;
        if (HosEngine.Eu(s))
        {
            var r = s.Settings.EuHos ?? new EuHosRules();
            var week = Math.Max(0, r.WeeklyDriving - (h.EuWeekDriven ?? 0));
            var two = Math.Max(0, r.FortnightDriving - (h.EuWeekDriven ?? 0) - (h.EuLastWeekDriven ?? 0));
            return $"Drive {Hhmm.Of(h.DriveRemaining)} · spread {Hhmm.Of(h.ShiftRemaining)} · week {Hhmm.Of(week)} · " +
                   $"fortnight {Hhmm.Of(two)} · break in {Hhmm.Of(h.BreakRemaining)}";
        }
        return $"Drive {Hhmm.Of(h.DriveRemaining)} · shift {Hhmm.Of(h.ShiftRemaining)} · cycle {Hhmm.Of(h.CycleRemaining)} · " +
               $"break in {Hhmm.Of(h.BreakRemaining)}";
    }
}
