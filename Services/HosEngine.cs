using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

public class HosTask
{
    public string Label { get; set; } = "";
    /// <summary>Drive | OnDuty</summary>
    public string Kind { get; set; } = "Drive";
    public double Hours { get; set; }
    public double Miles { get; set; }
    /// <summary>The drop itself, which cannot start before the receiver opens.</summary>
    public bool IsUnload { get; set; }

    /// <summary>
    /// Work done on a customer's property: loading or unloading.
    ///
    /// It matters because this kind of task <b>cannot be split by a ten-hour reset</b>. Nobody loads for
    /// forty minutes, sleeps on the dock, and finishes in the morning — the driver either has the window
    /// to do the whole job or they go and rest before they start it.
    /// </summary>
    public bool AtDock { get; set; }
}

public class PlanRequest
{
    public double DeadheadMiles { get; set; }
    public double LoadedMiles { get; set; }
    public double LoadingHours { get; set; }
    public double UnloadingHours { get; set; }
    /// <summary>ATS navigation drive-time estimate, when the driver reports it.</summary>
    public double? NavEstimateHours { get; set; }
    public int ExtraStops { get; set; }
    /// <summary>Hours until the load is late, as shown on the ATS job.</summary>
    public double DeadlineHours { get; set; }
    /// <summary>
    /// Hours until the receiver will actually take the load. ATS shows the window as a range and the
    /// first time is when the doors open — arriving before it means sitting there.
    ///
    /// <b>Zero means unknown</b>, and unknown plans exactly as it did before this existed. Loads
    /// already running have no opening time on file and must not have their plans change underneath
    /// them.
    /// </summary>
    public double AppointmentOpensHours { get; set; }
    /// <summary>
    /// Whether the receiver will let a truck sit on their property. Only consulted when the wait is
    /// long enough to be worth sleeping; a short wait is sat at the gate either way.
    ///
    /// Defaults to true so a plan that never sets it behaves as it always did.
    /// </summary>
    public bool ReceiverAllowsOvernight { get; set; } = true;
    public bool IncludePreTrip { get; set; } = true;
    /// <summary>Miles the truck can run on the fuel currently aboard.</summary>
    public double UsableFuelRangeMiles { get; set; } = 9999;
    /// <summary>In-game clock the plan starts from. Falls back to the reported status clock.</summary>
    public string StartGameTime { get; set; } = "";
    public string Label { get; set; } = "load";
}

/// <summary>
/// Projects the driver's reported HOS clocks forward across a planned trip, inserting the
/// breaks, 10-hour resets and cycle restarts the rule set requires, and reports whether the
/// load can be delivered with the company's required safety buffer intact.
///
/// The driver's HOS display is authoritative for the STARTING clocks. This engine only
/// projects forward from those numbers using the (editable) rule set in settings.
/// </summary>
public static class HosEngine
{
    private const double Eps = 0.0005;
    private const int MaxIterations = 400;

    public static double EffectiveMph(AppSettings s, Truck? truck)
    {
        var governed = truck?.GovernedMph > 0 ? truck.GovernedMph : s.GovernedMph;
        if (governed <= 0) governed = 65;
        var factor = s.SpeedFactor is > 0.2 and <= 1.0 ? s.SpeedFactor : 0.86;
        return Math.Round(governed * factor, 1);
    }

    /// <summary>Miles the truck can cover on the fuel currently aboard.</summary>
    public static double UsableRange(AppSettings s, Truck? truck, double fuelPct)
    {
        var cap = truck?.FuelCapacityGal > 0 ? truck.FuelCapacityGal : 250;
        var mpg = truck?.AvgMpg > 0 ? truck.AvgMpg : 6.5;
        var pct = Math.Clamp(fuelPct, 0, 100) / 100.0;
        // Never plan to run the tanks dry — reserve 10%.
        return Math.Max(0, cap * pct * mpg - cap * 0.10 * mpg);
    }

    public static List<HosTask> BuildTasks(AppSettings s, PlanRequest req, double mph)
    {
        var tasks = new List<HosTask>();
        var totalMiles = req.DeadheadMiles + req.LoadedMiles;

        // Drive time: be conservative — take the slower of the ATS nav estimate and the
        // governor-derived estimate, because the governor is what we actually run.
        var mileBased = mph > 0 ? totalMiles / mph : 0;
        var driveHours = req.NavEstimateHours.HasValue
            ? Math.Max(req.NavEstimateHours.Value, mileBased)
            : mileBased;

        var dhShare = totalMiles > 0 ? req.DeadheadMiles / totalMiles : 0;

        if (req.IncludePreTrip && s.PreTripHours > 0)
            tasks.Add(new HosTask { Label = "Pre-trip inspection", Kind = "OnDuty", Hours = s.PreTripHours });

        if (req.DeadheadMiles > 0)
            tasks.Add(new HosTask
            {
                Label = $"Deadhead {req.DeadheadMiles:0} mi",
                Kind = "Drive",
                Hours = driveHours * dhShare,
                Miles = req.DeadheadMiles
            });

        if (req.LoadingHours > 0)
            // A hook is a few minutes and can be done on the last of a window; a live load cannot. Both
            // are dock work, and the planner refuses to split either around a reset.
            tasks.Add(new HosTask { Label = "Hook / load", Kind = "OnDuty", Hours = req.LoadingHours,
                                    AtDock = true });

        // Fuel stops planned across the loaded leg.
        var fuelStops = FuelStopsNeeded(s, totalMiles, req.UsableFuelRangeMiles);
        var loadedDrive = driveHours * (1 - dhShare);

        if (fuelStops > 0 && req.LoadedMiles > 0)
        {
            // Interleave: split the loaded leg into (fuelStops + 1) segments with a fuel stop between each.
            var segments = fuelStops + 1;
            for (var i = 0; i < segments; i++)
            {
                tasks.Add(new HosTask
                {
                    Label = $"Line haul leg {i + 1}/{segments}",
                    Kind = "Drive",
                    Hours = loadedDrive / segments,
                    Miles = req.LoadedMiles / segments
                });
                if (i < fuelStops)
                    tasks.Add(new HosTask { Label = "Fuel stop", Kind = "OnDuty", Hours = s.FuelStopHours });
            }
        }
        else if (req.LoadedMiles > 0)
        {
            tasks.Add(new HosTask
            {
                Label = $"Line haul {req.LoadedMiles:0} mi",
                Kind = "Drive",
                Hours = loadedDrive,
                Miles = req.LoadedMiles
            });
        }

        for (var i = 0; i < req.ExtraStops; i++)
            tasks.Add(new HosTask { Label = $"Intermediate stop {i + 1}", Kind = "OnDuty", Hours = 0.5 });

        if (req.UnloadingHours > 0)
            tasks.Add(new HosTask { Label = "Unload / drop", Kind = "OnDuty", Hours = req.UnloadingHours,
                                    IsUnload = true, AtDock = true });

        return tasks;
    }

    public static int FuelStopsNeeded(AppSettings s, double totalMiles, double usableRange)
    {
        if (totalMiles <= usableRange) return 0;
        var plannedRange = s.FuelRangeMiles > 50 ? s.FuelRangeMiles : 900;
        var after = totalMiles - usableRange;
        return 1 + (int)Math.Floor(Math.Max(0, after - 0.01) / plannedRange);
    }

    public static FeasibilityResult Plan(AppState state, PlanRequest req, Truck? truck = null)
    {
        var s = state.Settings;
        var rules = s.Hos;
        var hos = state.Hos;
        var mph = EffectiveMph(s, truck);
        var result = new FeasibilityResult { EffectiveMph = mph };

        var start = GameClock.TryParse(req.StartGameTime)
                    ?? GameClock.TryParse(state.Status.GameTime);
        if (start == null)
        {
            result.Verdict = "Infeasible";
            result.Blockers.Add("Current in-game date/time is unknown — cannot project a delivery time. Report the ATS clock.");
            return result;
        }

        if (GameClock.TryParse(hos.AsOfGameTime) is DateTime asOf)
        {
            var drift = (start.Value - asOf).TotalHours;
            if (drift > 2)
                result.Warnings.Add($"HOS clocks were reported {drift:0.#} game-hours ago ({GameClock.Pretty(asOf)}). Re-read the HOS display before I commit freight.");
            else if (drift < -0.5)
                result.Warnings.Add("HOS snapshot is stamped later than the current game clock — check the times you reported.");
        }
        else
        {
            result.Warnings.Add("HOS snapshot has no game timestamp; projecting from the current clock as-is.");
        }

        var tasks = BuildTasks(s, req, mph);
        result.TotalMiles = req.DeadheadMiles + req.LoadedMiles;
        result.FuelStopsRequired = tasks.Count(t => t.Label == "Fuel stop");

        // Working clocks. With breaks switched off the break clock is simply not part of the
        // simulation — it never binds and no break is ever inserted.
        var requireBreak = rules.RequireBreak;
        double drive = Math.Max(0, hos.DriveRemaining);
        double shift = Math.Max(0, hos.ShiftRemaining);
        double brk = Math.Max(0, hos.BreakRemaining);
        double cycle = Math.Max(0, hos.CycleRemaining);

        var clock = start.Value;
        var recapQueue = new Queue<RecapDay>(hos.Recap.Where(r => r.Hours > 0).OrderBy(r => r.InDays));
        var timeline = new List<TimelineStep>();
        var guard = 0;

        void Step(string label, string kind, double hours, double miles)
        {
            var from = clock;
            clock = clock.AddHours(hours);
            timeline.Add(new TimelineStep
            {
                Label = label,
                Kind = kind,
                StartGameTime = GameClock.Format(from),
                EndGameTime = GameClock.Format(clock),
                Hours = Math.Round(hours, 2),
                Miles = Math.Round(miles, 1),
                DriveRemainingAfter = Math.Round(drive, 2),
                ShiftRemainingAfter = Math.Round(shift, 2),
                BreakRemainingAfter = Math.Round(brk, 2),
                CycleRemainingAfter = Math.Round(cycle, 2)
            });
        }

        void TakeBreak()
        {
            if (rules.BreakConsumesShift) shift = Math.Max(0, shift - rules.BreakLength);
            cycle = Math.Max(0, cycle - 0); // off-duty break does not burn cycle
            brk = rules.DrivingBeforeBreak;
            result.BreaksRequired++;
            Step($"{rules.BreakLength * 60:0}-minute break (required)", "Break", rules.BreakLength, 0);
        }

        void TakeReset()
        {
            var dayBefore = clock.Date;
            drive = rules.DriveLimit;
            shift = rules.ShiftLimit;
            brk = rules.DrivingBeforeBreak;
            result.RestsRequired++;
            Step($"{rules.OffDutyReset:0.#}-hour off-duty reset", "Rest", rules.OffDutyReset, 0);

            // Recap: hours come back as days roll off the cycle window.
            if (clock.Date > dayBefore && recapQueue.Count > 0)
            {
                var recap = recapQueue.Dequeue();
                var before = cycle;
                cycle = Math.Min(rules.CycleLimit, cycle + recap.Hours);
                if (cycle > before)
                    result.Warnings.Add($"Recap returns {Hhmm.Of(cycle - before)} to the cycle after the reset on {clock:ddd MMM d} (driver-reported projection).");
            }
        }

        /// <summary>
        /// Takes the ten before starting work at a dock, going somewhere that will have you if needed.
        ///
        /// A customer's lot is not a rest area. Some will let a truck sit and most will not, which the
        /// app already models for an early appointment — the same applies here, and it costs the hop out
        /// and back.
        /// </summary>
        void RestBeforeDock(HosTask task)
        {
            var shortBy = task.Hours - shift;
            var where = task.IsUnload ? "the receiver" : "the shipper";

            if (req.ReceiverAllowsOvernight)
            {
                result.Warnings.Add(
                    $"You have {Hhmm.Of(shift)} of window and {where} needs {Hhmm.Of(task.Hours)} — " +
                    $"{Hhmm.Of(shortBy)} short. They will let you sit, so take the " +
                    $"{rules.OffDutyReset:0.#} on their property first and start fresh.");
                TakeReset();
                return;
            }

            var hop = Facilities.RepositionHoursEachWay;
            result.Warnings.Add(
                $"You have {Hhmm.Of(shift)} of window and {where} needs {Hhmm.Of(task.Hours)} — you cannot " +
                $"start that, let alone finish it and get off their lot. Run to a truck stop, take your " +
                $"{rules.OffDutyReset:0.#}, and come back to it with a full window. That is about " +
                $"{Hhmm.Of(hop * 2)} of driving either side plus the reset, and it is the only legal way to " +
                "do this load.");

            drive = Math.Max(0, drive - hop); shift = Math.Max(0, shift - hop);
            cycle = Math.Max(0, cycle - hop);
            if (requireBreak) brk = Math.Max(0, brk - hop);
            Step("Reposition to a truck stop — no window left to work the dock", "Drive", hop, 0);

            TakeReset();

            drive -= hop; shift -= hop; cycle = Math.Max(0, cycle - hop);
            if (requireBreak) brk -= hop;
            Step($"Back to {where}", "Drive", hop, 0);
        }

        void TakeRestart()
        {
            drive = rules.DriveLimit;
            shift = rules.ShiftLimit;
            brk = rules.DrivingBeforeBreak;
            cycle = rules.CycleLimit;
            result.CycleRestartRequired = true;
            recapQueue.Clear();
            Step($"{rules.CycleRestartHours:0.#}-hour cycle restart", "Restart", rules.CycleRestartHours, 0);
        }

        foreach (var task in tasks)
        {
            // Turning up before the doors open means sitting there. ATS shows the window as a range;
            // the first time is when the receiver will actually take it, so arriving early is dead
            // time rather than slack. Skipped entirely when no opening time is known, which is how
            // every load dispatched before this existed keeps the plan it was given.
            if (task.IsUnload && req.AppointmentOpensHours > 0)
            {
                var opensAt = start.Value.AddHours(req.AppointmentOpensHours);
                var waiting = (opensAt - clock).TotalHours;
                if (waiting > Eps)
                {
                    result.WaitForAppointmentHours = Math.Round(waiting, 2);
                    if (waiting >= rules.OffDutyReset)
                    {
                        // Long enough to be worth sleeping — but only if they will have you. Plenty of
                        // receivers will not, and then the reset is sat at a truck stop with a run
                        // either side, which is real time off clocks that are already the constraint.
                        if (!req.ReceiverAllowsOvernight)
                        {
                            var hop = Facilities.RepositionHoursEachWay;
                            var rest = Math.Max(rules.OffDutyReset, waiting - hop * 2);

                            drive = Math.Max(0, drive - hop); shift = Math.Max(0, shift - hop);
                            cycle = Math.Max(0, cycle - hop);
                            Step("Reposition to a truck stop — the receiver will not have you overnight", "Drive", hop, 0);

                            drive = rules.DriveLimit; shift = rules.ShiftLimit; brk = rules.DrivingBeforeBreak;
                            result.RestsRequired++;
                            Step($"{Hhmm.Of(rest)} reset at the truck stop", "Rest", rest, 0);

                            drive -= hop; shift -= hop; cycle = Math.Max(0, cycle - hop);
                            if (requireBreak) brk -= hop;
                            Step("Back to the receiver for the appointment", "Drive", hop, 0);

                            result.Warnings.Add(
                                $"You arrive {Hhmm.Of(waiting)} before they open and they do not allow overnight " +
                                $"parking. Sit the reset at a truck stop and come back — about {Hhmm.Of(hop * 2)} " +
                                "of running either side, and it comes off your clocks.");
                        }
                        else
                        {
                            drive = rules.DriveLimit;
                            shift = rules.ShiftLimit;
                            brk = rules.DrivingBeforeBreak;
                            result.RestsRequired++;
                            Step($"Waiting for the receiver to open — {Hhmm.Of(waiting)}, taken as the reset", "Rest", waiting, 0);
                            result.Warnings.Add(
                                $"You arrive {Hhmm.Of(waiting)} before they open, and they will let you sit on their " +
                                $"property. Take your {rules.OffDutyReset:0.#}-hour reset there — the wait is not wasted.");
                        }
                    }
                    else
                    {
                        // Short wait: on duty at the gate, burning the window.
                        shift = Math.Max(0, shift - waiting);
                        cycle = Math.Max(0, cycle - waiting);
                        Step($"Waiting for the receiver to open — {Hhmm.Of(waiting)}", "OnDuty", waiting, 0);
                        if (waiting >= 0.25)
                            result.Warnings.Add(
                                $"You get there {Hhmm.Of(waiting)} before they open. Short enough to wait at the " +
                                "receiver — no need to go anywhere — but it is on-duty time and comes off your " +
                                $"{rules.ShiftLimit:0.#}-hour window, not slack.");
                    }
                }
            }

            var remaining = task.Hours;
            var milesRemaining = task.Miles;

            while (remaining > Eps)
            {
                if (++guard > MaxIterations)
                {
                    result.Verdict = "Infeasible";
                    result.Blockers.Add("HOS projection did not converge — check the rule set in Settings (a limit may be zero).");
                    result.Timeline = timeline;
                    return result;
                }

                if (task.Kind == "Drive")
                {
                    var cap = requireBreak
                        ? Min(drive, shift, brk, cycle, remaining)
                        : Min(drive, shift, cycle, remaining);

                    if (cap <= Eps)
                    {
                        // Which clock is blocking?
                        if (cycle <= Eps) { TakeRestart(); continue; }
                        if (requireBreak && brk <= Eps && drive > Eps && shift > rules.BreakLength + Eps)
                        { TakeBreak(); continue; }
                        TakeReset();
                        continue;
                    }

                    var miles = task.Hours > 0 ? milesRemaining * (cap / remaining) : 0;
                    drive -= cap; shift -= cap; cycle -= cap;
                    if (requireBreak) brk -= cap;
                    remaining -= cap; milesRemaining -= miles;
                    Step(task.Label + (cap < task.Hours - Eps ? " (segment)" : ""), "Drive", cap, miles);
                }
                else
                {
                    // Work at a dock is indivisible. Splitting it around a ten-hour reset is how this
                    // planner came to call a two-hour flatbed load legal on forty-six minutes of window:
                    // it loaded for forty-six minutes, slept on the customer's property, and finished in
                    // the morning. Nobody does that, and no receiver would allow it.
                    //
                    // So if the window will not cover the whole job, the rest happens BEFORE it starts.
                    var notStarted = Math.Abs(remaining - task.Hours) < Eps;
                    if (task.AtDock && notStarted && task.Hours > Eps && shift + Eps < task.Hours && cycle > Eps)
                    {
                        RestBeforeDock(task);
                        continue;
                    }

                    var cap = Min(shift, cycle, remaining);
                    if (cap <= Eps)
                    {
                        if (cycle <= Eps) { TakeRestart(); continue; }
                        TakeReset();
                        continue;
                    }
                    shift -= cap; cycle -= cap;
                    remaining -= cap;
                    Step(task.Label + (cap < task.Hours - Eps ? " (segment)" : ""), "OnDuty", cap, 0);
                }
            }
        }

        result.Timeline = timeline;
        result.DriveHours = Math.Round(timeline.Where(t => t.Kind == "Drive").Sum(t => t.Hours), 2);
        result.OnDutyHours = Math.Round(timeline.Where(t => t.Kind is "Drive" or "OnDuty").Sum(t => t.Hours), 2);
        result.ElapsedHours = Math.Round((clock - start.Value).TotalHours, 2);
        result.ProjectedArrivalGameTime = GameClock.Format(clock);
        result.CycleRemainingAfter = Math.Round(cycle, 2);
        // The window left once they are empty and standing at the receiver. This is what decides
        // whether a dock holding them a little longer strands them on the property overnight.
        result.ShiftRemainingOnArrival = Math.Round(shift, 2);
        result.DriveRemainingOnArrival = Math.Round(drive, 2);

        if (req.AppointmentOpensHours > 0)
            result.AppointmentOpensGameTime = GameClock.Format(start.Value.AddHours(req.AppointmentOpensHours));

        var due = start.Value.AddHours(req.DeadlineHours);
        result.DueGameTime = GameClock.Format(due);
        var parking = Math.Max(0, s.ParkingBufferHours);
        result.RequiredBufferHours = Math.Max(0, s.SafetyBufferHours);
        result.SlackHours = Math.Round((due - clock).TotalHours - parking, 2);

        // No opening time on file, and a plan that lands most of a day early. ATS windows are hours wide,
        // not days, so arriving this far ahead almost certainly means arriving before the receiver will
        // take it — while the slack figure above says the opposite. The difference between slack and
        // sitting at a gate is the whole point of that number, so it cannot go unsaid.
        if (req.AppointmentOpensHours <= 0 && req.DeadlineHours > 0 && result.SlackHours >= 8)
            result.Warnings.Add(
                $"That plan arrives {Hhmm.Of(result.SlackHours)} before it is due, which is wider than a delivery " +
                "window usually is. If this one opens tomorrow you will be sitting at the gate for most of that, " +
                "and none of it is really slack. Put the opening time on the load and I will plan the wait in.");

        if (req.DeadlineHours <= 0)
        {
            result.Blockers.Add("No delivery window given — I need the hours-to-deliver from the ATS job listing before I commit this freight.");
        }
        else if (result.SlackHours < 0)
        {
            result.Blockers.Add($"Projected arrival {GameClock.Pretty(clock)} misses the {GameClock.Pretty(due)} appointment by {Hhmm.Of(Math.Abs(result.SlackHours))} after parking allowance. Not deliverable legally.");
        }
        else if (result.SlackHours < result.RequiredBufferHours)
        {
            result.Warnings.Add($"Only {Hhmm.Of(result.SlackHours)} of slack against a {Hhmm.Of(result.RequiredBufferHours)} required buffer. One bad scale line or construction zone and we are late.");
        }

        if (result.CycleRestartRequired)
            result.Warnings.Add($"This load cannot be completed without a {rules.CycleRestartHours:0.#}-hour cycle restart mid-trip. That is a planning failure unless it is deliberate.");

        if (cycle <= 0.01)
            result.Warnings.Add("Cycle lands at zero on delivery — the truck will be parked until a restart.");
        else if (cycle < 8)
            result.Warnings.Add($"Only {Hhmm.Of(cycle)} of cycle left on delivery. Reset planning starts now, not later.");

        // Being stranded on the receiver's property is a different risk from being late, and it is the
        // one nobody sees coming. Say it before they accept, in the terms it will actually happen in.
        var strandMargin = Math.Max(0, s.StrandedMarginHours);
        if (req.UnloadingHours > 0 && shift <= 0.01)
            result.Warnings.Add(
                $"Your window closes while you are still at the receiver. Finishing the unload is legal, but you will not be " +
                $"able to move the truck afterwards — plan on a {rules.OffDutyReset:0.#} on their property.");
        else if (req.UnloadingHours > 0 && shift < strandMargin)
            result.Warnings.Add(
                $"This delivers with only {Hhmm.Of(shift)} left on your 14-hour SHIFT once you are empty — " +
                $"nothing to do with the delivery window. If they hold you " +
                $"{Hhmm.Of(shift)} longer than planned, the window shuts while you are on the property and you are parked " +
                $"there for a {rules.OffDutyReset:0.#}. Worth asking about overnight parking before you back in.");

        if (result.FuelStopsRequired == 0 && result.TotalMiles > req.UsableFuelRangeMiles)
            result.Warnings.Add("Fuel range check could not be resolved — confirm the fuel level.");

        result.Verdict = result.Blockers.Count > 0 ? "Infeasible"
            : result.SlackHours < result.RequiredBufferHours ? "Tight"
            : "Feasible";

        return result;
    }

    private static double Min(params double[] v) => v.Min();

    /// <summary>Plain-language read of the driver's current clocks and what they can legally do now.</summary>
    public static HosStatusView Describe(AppState state, Truck? truck)
    {
        var r = state.Settings.Hos;
        var h = state.Hos;
        var v = new HosStatusView
        {
            DriveRemaining = h.DriveRemaining,
            ShiftRemaining = h.ShiftRemaining,
            BreakRemaining = h.BreakRemaining,
            CycleRemaining = h.CycleRemaining,
            DriveLimit = r.DriveLimit,
            ShiftLimit = r.ShiftLimit,
            BreakLimit = r.DrivingBeforeBreak,
            CycleLimit = r.CycleLimit,
            EffectiveMph = EffectiveMph(state.Settings, truck),
            AsOfGameTime = h.AsOfGameTime,
            RecapHours = h.Recap.Sum(x => x.Hours)
        };

        // Legally drivable right now is the binding minimum of drive / shift / cycle.
        // The break clock caps a single stint, not the day's total.
        v.BreakEnforced = r.RequireBreak;
        v.DrivableNowHours = Math.Max(0, Math.Min(Math.Min(h.DriveRemaining, h.ShiftRemaining), h.CycleRemaining));
        v.StintBeforeBreakHours = r.RequireBreak
            ? Math.Max(0, Math.Min(v.DrivableNowHours, h.BreakRemaining))
            : v.DrivableNowHours;
        v.ProjectedMilesNow = Math.Round(v.DrivableNowHours * v.EffectiveMph, 0);
        v.StintMiles = Math.Round(v.StintBeforeBreakHours * v.EffectiveMph, 0);

        var binding = "drive";
        var min = h.DriveRemaining;
        if (h.ShiftRemaining < min) { min = h.ShiftRemaining; binding = "14-hour window"; }
        if (h.CycleRemaining < min) { binding = $"{r.CycleLimit:0.#}-hour cycle"; }
        v.BindingClock = binding;

        if (h.CycleRemaining <= 0)
            v.NextRequiredAction = $"{r.CycleRestartHours:0.#}-hour cycle restart — no legal driving until it is complete.";
        else if (v.DrivableNowHours <= 0.01)
            v.NextRequiredAction = $"{r.OffDutyReset:0.#}-hour off-duty reset before any driving.";
        else if (r.RequireBreak && h.BreakRemaining <= 0.01)
            v.NextRequiredAction = $"{r.BreakLength * 60:0}-minute break required before driving again.";
        else if (r.RequireBreak)
            v.NextRequiredAction = $"Clear to drive {Hhmm.Of(v.StintBeforeBreakHours)} before the {r.BreakLength * 60:0}-minute break is due.";
        else
            v.NextRequiredAction = $"Clear to drive {Hhmm.Of(v.DrivableNowHours)} — breaks are switched off, so the {r.ShiftLimit:0.#}-hour window is your next stop.";

        if (h.CycleRemaining > 0 && h.CycleRemaining <= 18)
        {
            v.ResetWatch = $"Reset watch: {Hhmm.Of(h.CycleRemaining)} of cycle left. Dispatch is now selecting freight that ends somewhere we can sit a restart.";
            // Unless recap is about to make the restart unnecessary, which is the whole point of it.
            if (Recap.NextBatch(state) is { } batch)
                v.ResetWatch += $" Though you have {Hhmm.Of(batch.Hours)} of recap due — that may be all you need.";
        }

        return v;
    }
}

public class HosStatusView
{
    public double DriveRemaining { get; set; }
    public double ShiftRemaining { get; set; }
    public double BreakRemaining { get; set; }
    public double CycleRemaining { get; set; }
    public double DriveLimit { get; set; }
    public double ShiftLimit { get; set; }
    public double BreakLimit { get; set; }
    public double CycleLimit { get; set; }
    public double RecapHours { get; set; }
    public double DrivableNowHours { get; set; }
    public double StintBeforeBreakHours { get; set; }
    public double ProjectedMilesNow { get; set; }
    public double StintMiles { get; set; }
    public double EffectiveMph { get; set; }
    /// <summary>False when the driver has switched the 30-minute break off in settings.</summary>
    public bool BreakEnforced { get; set; } = true;
    public string BindingClock { get; set; } = "";
    public string NextRequiredAction { get; set; } = "";
    public string ResetWatch { get; set; } = "";
    public string AsOfGameTime { get; set; } = "";
}
