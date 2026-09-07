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
    /// The booked slot the plan should wait for, in hours from the start. Zero means do not wait at all
    /// — the receiver has agreed to take it whenever it arrives.
    ///
    /// Separate from <see cref="AppointmentOpensHours"/> on purpose: that one is a fact off the load
    /// text and is reported back as the window opening. Using it for both meant an early take deleted
    /// the opening from the feasibility result, which is not the app's to delete.
    /// </summary>
    public double WaitUntilHours { get; set; }
    /// <summary>
    /// Whether the receiver will let a truck sit on their property. Only consulted when the wait is
    /// long enough to be worth sleeping; a short wait is sat at the gate either way.
    ///
    /// Defaults to true so a plan that never sets it behaves as it always did.
    /// </summary>
    public bool ReceiverAllowsOvernight { get; set; } = true;
    /// <summary>
    /// How many real deliveries the unload figure is averaged over, or -1 where the caller does not know.
    ///
    /// <see cref="UnloadingHours"/> is a mean, so by definition half of all docks run longer than it. That
    /// is fine when the mean is settled over ten loads and the driver has hours in hand; it is not fine
    /// when the figure came off a seed table and the window only just covers it. This says which of those
    /// the plan is looking at, so the margin it holds back can be sized to how much the number is worth.
    /// </summary>
    public int DockSamples { get; set; } = -1;

    /// <summary>
    /// When a site-type receiver opens and closes, as hours of the day. -1 on both for a place that never
    /// closes, which is every dock and every load planned before this existed.
    ///
    /// A dock wait is a <b>point</b>: your slot, which you wait for even though the building is staffed at
    /// 3am. A site wait is a <b>range</b>: any time inside it is free and any time outside it is a wait for
    /// the morning. See <see cref="FacilityProfile"/>. Both end up as hours-until-they-will-take-it, and
    /// from there the same machinery handles them — including deciding whether to sit the wait out on duty
    /// or hold the rest longer and roll up fresh.
    /// </summary>
    public double SiteOpenHour { get; set; } = -1;
    public double SiteCloseHour { get; set; } = -1;

    /// <summary>
    /// The hours above are the app's guess rather than a range read off the listing.
    ///
    /// It changes what they are allowed to do. A guessed OPENING can only ever hold a driver until the
    /// morning of the day they arrive — that is the reported case, rolling up to a job site at 3am with
    /// nobody there. A guessed CLOSING is not allowed to push a load to the next day at all, because the
    /// game already said when the load is due and a guess must never be what makes a legal run
    /// impossible. Reported as a 1,004-mile flatbed coming back Infeasible against a deadline ATS was
    /// perfectly happy with.
    ///
    /// Where the driver entered the game's own range, both ends are real and both are enforced.
    /// </summary>
    public bool SiteHoursAreGuess { get; set; }

    /// <summary>
    /// How long the queue at the gate runs at opening time. Worst on the dot, eased off by mid-day.
    ///
    /// This is time ON the property with the engine running, so it lands on the dock clock rather than
    /// being idle outside a gate — it is the reason "no appointment" must not mean "no waiting".
    /// </summary>
    public double SiteQueuePeakHours { get; set; }

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

    /// <summary>
    /// Waiting below which sitting at the gate is simpler than rearranging the run.
    ///
    /// Nobody holds a rest an extra twenty minutes to save twenty minutes of window. Above it the swap
    /// is free: the truck is parked either way, and the only question is which clock pays for it.
    /// </summary>
    private const double SleepInWorthIt = 1.0;

    /// <summary>One timeline stamp moved later, for a rest that ended up running longer.</summary>
    private static string Shifted(string gameTime, double hours) =>
        GameClock.TryParse(gameTime) is { } t ? GameClock.Format(t.AddHours(hours)) : gameTime;
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
        // Each batch with the moment it actually lands, worked out once from the day the trip starts.
        //
        // This used to be a plain queue, popped whenever a reset crossed midnight — which credited a
        // batch due in five days on the first night out, and credited two on a trip that spanned two
        // nights. Recap.cs had always done this correctly, so dispatch and the clocks page gave the
        // driver contradictory answers and the plan was built on the optimistic one.
        var recapDue = hos.Recap
            .Where(r => r.Hours > 0 && r.InDays >= 0)
            .OrderBy(r => r.InDays)
            .Select(r => (At: start.Value.Date.AddDays(r.InDays), r.Hours, Taken: false))
            .ToList();
        // Recap batches that land while the trip is being simulated. Held rather than reported one by
        // one, because a batch is only good news if the trip does not need the 34 anyway.
        var recapArrivals = new List<(DateTime At, double Hours)>();
        var timeline = new List<TimelineStep>();
        var guard = 0;

        /// <summary>
        /// Hands back every batch whose midnight the clock has now passed.
        ///
        /// Called on every clock advance rather than only at a rest, because the cycle window rolls
        /// forward at midnight whether the truck is parked or rolling.
        /// </summary>
        void CreditRecapDue()
        {
            for (var i = 0; i < recapDue.Count; i++)
            {
                if (recapDue[i].Taken || clock < recapDue[i].At) continue;
                var before = cycle;
                cycle = Math.Min(rules.CycleLimit, cycle + recapDue[i].Hours);
                recapDue[i] = recapDue[i] with { Taken = true };
                // Banked, not announced. Whether it is worth telling the driver depends on how the rest
                // of the trip goes, and that is not known yet — see the end of the simulation.
                if (cycle > before) recapArrivals.Add((recapDue[i].At, cycle - before));
            }
        }

        void Step(string label, string kind, double hours, double miles)
        {
            var from = clock;
            clock = clock.AddHours(hours);
            CreditRecapDue();
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
            drive = rules.DriveLimit;
            shift = rules.ShiftLimit;
            brk = rules.DrivingBeforeBreak;
            result.RestsRequired++;
            Step($"{rules.OffDutyReset:0.#}-hour off-duty reset", "Rest", rules.OffDutyReset, 0);
            // Recap is credited in Step, against each batch's own due date. It used to be done here,
            // on any midnight a reset happened to cross, which is what made dispatch optimistic.
        }

        /// <summary>
        /// Takes the ten before starting work at a dock, going somewhere that will have you if needed.
        ///
        /// A customer's lot is not a rest area. Some will let a truck sit and most will not, which the
        /// app already models for an early appointment — the same applies here, and it costs the hop out
        /// and back.
        /// </summary>
        void RestBeforeDock(HosTask task, double queueHours = 0)
        {
            var needed = task.Hours + queueHours;
            var shortBy = needed - shift;
            var where = task.IsUnload ? "the receiver" : "the shipper";
            var queued = queueHours > 0.01
                ? $" (including about {Hhmm.Of(queueHours)} queued at the gate)"
                : "";

            if (req.ReceiverAllowsOvernight)
            {
                result.Warnings.Add(
                    $"You have {Hhmm.Of(shift)} of window and {where} needs {Hhmm.Of(needed)}{queued} — " +
                    $"{Hhmm.Of(shortBy)} short. They will let you sit, so take the " +
                    $"{rules.OffDutyReset:0.#} on their property first and start fresh.");
                TakeReset();
                return;
            }

            var hop = Facilities.RepositionHoursEachWay;
            result.Warnings.Add(
                $"You have {Hhmm.Of(shift)} of window and {where} needs {Hhmm.Of(needed)}{queued} — you cannot " +
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
            // A restart wipes the window clean, so anything not yet banked is gone with it.
            for (var i = 0; i < recapDue.Count; i++) recapDue[i] = recapDue[i] with { Taken = true };
            Step($"{rules.CycleRestartHours:0.#}-hour cycle restart", "Restart", rules.CycleRestartHours, 0);
        }

        foreach (var task in tasks)
        {
            // Turning up before the doors open means sitting there. ATS shows the window as a range;
            // the first time is when the receiver will actually take it, so arriving early is dead
            // time rather than slack. Skipped entirely when no opening time is known, which is how
            // every load dispatched before this existed keeps the plan it was given.
            //
            // Two clocks can produce that wait and only one of them existed before. A booked slot is a
            // POINT — you wait for it even though the warehouse is lit up and stocking shelves at 3am. A
            // job site is a RANGE — any time inside it is free, and outside it there is simply nobody
            // there to take the load off you. Both come out as hours-until-they-will-have-it, and from
            // here the same machinery handles them.
            if (task.IsUnload)
            {
                double waiting;
                if (req.WaitUntilHours > 0)
                {
                    waiting = (start.Value.AddHours(req.WaitUntilHours) - clock).TotalHours;
                }
                else if (req.SiteHoursAreGuess)
                {
                    // No window off the listing, so the working day is the app's own guess. It may hold a
                    // driver until the morning of the day they arrive and no further — see the note on
                    // SiteHoursAreGuess for why a guess is not allowed to make a load impossible.
                    waiting = HoursUntilOpen(clock, req.SiteOpenHour, req.SiteCloseHour, guessed: true);
                    if (waiting > Eps) result.WaitedForSiteToOpen = true;
                }
                else
                {
                    waiting = 0;
                }

                if (waiting > Eps)
                {
                    result.WaitForAppointmentHours = Math.Round(waiting, 2);

                    // Waiting on duty is only free if there is still a window left to work the dock
                    // afterwards. On a long run there often is not, and the app used to burn the wait at
                    // the gate, discover it had nothing left, and take the ten anyway — arriving a full
                    // reset later than it needed to and calling a perfectly runnable load infeasible.
                    // Reported on a 1,004-mile Rock Springs to Tulsa: 9:01 of waiting spent the window,
                    // then it wanted 1:49 it no longer had, so delivery landed 9:20 past the close.
                    //
                    // Sitting the reset DURING the wait costs nothing — the truck is parked either way.
                    var windowAfterWaiting = shift - waiting;
                    var restBeatsWaiting = windowAfterWaiting < task.Hours;

                    if (waiting >= rules.OffDutyReset || restBeatsWaiting)
                    {
                        // Long enough to be worth sleeping — but only if they will have you. Plenty of
                        // receivers will not, and then the reset is sat at a truck stop with a run
                        // either side, which is real time off clocks that are already the constraint.
                        if (!req.ReceiverAllowsOvernight)
                        {
                            var hop = Facilities.RepositionHoursEachWay;
                            // At least a full ten. Subtracting the running either side can only shorten
                            // the sit, never the reset it has to be.
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
                        else if (waiting >= rules.OffDutyReset)
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
                        else
                        {
                            // Arriving early with a window too thin to unload, and a wait shorter than a
                            // reset. Sitting a full ten AT the receiver would be ten hours on top of a wait
                            // that was already going to happen — which is how a load with five hours of
                            // room came out with four minutes of it.
                            //
                            // The driver does not have to arrive early. Sleeping longer at the last stop
                            // costs exactly the same wall-clock time and puts them on the dock at opening
                            // with a fresh fourteen. The rest before this leg is already in the plan, so
                            // this is that rest running longer, not a second one.
                            // A reset costs a reset. This used to credit a full 11 and 14 while spending
                            // only `waiting` — six hours, in the case that turned this up — so the driver
                            // was handed four hours of clock that do not exist and every leg after it was
                            // computed off a number the game will never agree with. Sleeping LONGER at the
                            // last stop is the right idea and it means at least the full ten.
                            var slept = Math.Max(waiting, rules.OffDutyReset);
                            drive = rules.DriveLimit;
                            shift = rules.ShiftLimit;
                            brk = rules.DrivingBeforeBreak;
                            result.RestsRequired++;
                            Step($"Rest timed to the opening — {Hhmm.Of(slept)} rather than arriving early", "Rest", slept, 0);
                            result.Warnings.Add(
                                $"You would get there {Hhmm.Of(waiting)} before they open with only " +
                                $"{Hhmm.Of(Math.Max(0, windowAfterWaiting))} of window left, and the dock needs " +
                                $"{Hhmm.Of(task.Hours)}. Sleep in at your last stop instead — a full " +
                                $"{Hhmm.Of(rules.OffDutyReset)}, not just the {Hhmm.Of(waiting)} you would be " +
                                "waiting — and roll up on the opening with a clock that is actually fresh.");
                        }
                    }
                    else if (waiting >= SleepInWorthIt
                             && timeline.FindLastIndex(x => x.Kind is "Rest" or "Restart") is var restAt
                             && restAt >= 0)
                    {
                        // There is already a rest in this plan, so the wait goes on the END of it and the
                        // driver rolls up at opening with the window intact. Same hours parked either way
                        // — the difference is only whether they come off the fourteen.
                        //
                        // This is the driver's own answer, reported from play: "take my 10 and extend my
                        // 10 so I get there at or a little before my appointment, otherwise I'm burning my
                        // shift clock for no reason." The branch above already said as much for a wait
                        // that made the load infeasible. It is just as true for one that only makes it
                        // worse, and that was the whole of the gap.
                        //
                        // Extending the rest already there, not adding one: a fresh ten does not fit
                        // inside seven hours of slack, which is exactly why this had to be the shape.
                        var slept = timeline[restAt];
                        slept.Hours = Math.Round(slept.Hours + waiting, 2);
                        slept.Label = $"{slept.Label} — held {Hhmm.Of(waiting)} longer rather than arriving early";
                        slept.EndGameTime = Shifted(slept.EndGameTime, waiting);

                        // Everything after it happens later by the same amount. The clocks those legs
                        // leave behind do not move: they burn the same hours wherever they sit.
                        for (var i = restAt + 1; i < timeline.Count; i++)
                        {
                            timeline[i].StartGameTime = Shifted(timeline[i].StartGameTime, waiting);
                            timeline[i].EndGameTime = Shifted(timeline[i].EndGameTime, waiting);
                        }

                        // The wall clock still moves. The shift clock does not, and that is the point.
                        clock = clock.AddHours(waiting);
                        result.SleptInHours = Math.Round(waiting, 2);
                        result.WaitForAppointmentHours = 0;
                        result.IdleHours = Math.Round(waiting, 2);
                        result.Warnings.Add(
                            $"You would have got there {Hhmm.Of(waiting)} early, so I have held your rest " +
                            $"{Hhmm.Of(waiting)} longer instead of sitting at the gate. The same hours parked " +
                            $"either way — this way they do not come off your {rules.ShiftLimit:0.#}-hour window.");
                    }
                    else
                    {
                        // Nothing to extend: no rest in this plan to hang the wait on, and a fresh one
                        // will not fit inside slack shorter than a reset. Sitting really is the option.
                        shift = Math.Max(0, shift - waiting);
                        cycle = Math.Max(0, cycle - waiting);
                        result.IdleHours = Math.Round(waiting, 2);
                        Step($"Waiting for the receiver to open — {Hhmm.Of(waiting)}", "OnDuty", waiting, 0);
                        if (waiting >= 0.25)
                            result.Warnings.Add(
                                $"You get there {Hhmm.Of(waiting)} before they open, and there is no rest in this " +
                                "plan to hang the wait on. It gets sat at the receiver, and it is on-duty time — " +
                                $"it comes off your {rules.ShiftLimit:0.#}-hour window, not out of slack.");
                    }
                }
            }

            // Trucks in front of you at the gate. Worst on the dot of opening, because everybody turns up
            // then, and eased off through the morning — which is what makes rolling in at ten instead of
            // six an actual decision rather than just being late.
            //
            // On the DOCK clock, not idle: you are on the property with the engine running and it comes
            // off the fourteen exactly like the unload does. The appointment-idle term prices a truck sat
            // outside a gate it is not allowed through yet, which is a different thing.
            var queue = 0.0;
            if (task.IsUnload && task.AtDock && req.SiteQueuePeakHours > 0 && req.SiteOpenHour >= 0)
            {
                var pastOpen = clock.TimeOfDay.TotalHours - req.SiteOpenHour;
                if (pastOpen < 0) pastOpen += 24;
                queue = FacilityProfile.QueueAt(req.SiteQueuePeakHours, pastOpen);
                if (queue > 0.01) result.QueueHours = Math.Round(queue, 2);
            }

            var remaining = task.Hours + queue;
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
                    // The whole job as it will actually be worked: the unload plus whatever queue is
                    // sat through to get to it. Both are on-duty time on their property and the window
                    // has to cover the pair of them — measuring against the unload alone would let a
                    // driver back in with just enough for the dock and none for the four trucks ahead.
                    var dockWork = task.Hours + queue;
                    var notStarted = Math.Abs(remaining - dockWork) < Eps;
                    if (task.AtDock && notStarted && dockWork > Eps && shift + Eps < dockWork && cycle > Eps)
                    {
                        RestBeforeDock(task, queue);
                        continue;
                    }

                    // The window they will actually have as the doors open — after any reset taken above,
                    // which is the number that decides whether a dock running long strands them.
                    //
                    // Not ShiftRemainingOnArrival, which is what is left once they are EMPTY and reads
                    // zero on any run that simply used its whole day. That is ordinary. This one measured
                    // against the dock time is the thing: reported from play as an hour of window against
                    // a two-hour unload, on a lot with no overnight parking, with nothing said about it.
                    if (task.IsUnload && task.AtDock && notStarted)
                        result.ShiftRemainingAtDock = Math.Round(Math.Max(0, shift), 2);

                    var cap = Min(shift, cycle, remaining);
                    if (cap <= Eps)
                    {
                        if (cycle <= Eps) { TakeRestart(); continue; }
                        TakeReset();
                        continue;
                    }
                    shift -= cap; cycle -= cap;
                    remaining -= cap;
                    Step(task.Label + (cap < dockWork - Eps ? " (segment)" : ""), "OnDuty", cap, 0);
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
            // `due` is when the WINDOW SHUTS, not an appointment. Calling it one put a card on screen
            // reading "window 21:26 -> 04:06" beside "misses the 04:06 appointment", which reads as the
            // app booking a slot at the closing edge — and invited exactly the question of why the
            // appointment sits where it does. It is the deadline; say deadline.
            result.Blockers.Add(
                $"Projected arrival {GameClock.Pretty(clock)} is past the {GameClock.Pretty(due)} window " +
                $"closing by {Hhmm.Of(Math.Abs(result.SlackHours))} after parking allowance. " +
                "Not deliverable legally.");
        }
        else if (result.SlackHours < result.RequiredBufferHours)
        {
            result.Warnings.Add($"Only {Hhmm.Of(result.SlackHours)} of slack against a {Hhmm.Of(result.RequiredBufferHours)} required buffer. One bad scale line or construction zone and we are late.");
        }

        if (result.CycleRestartRequired)
            result.Warnings.Add($"This load cannot be completed without a {rules.CycleRestartHours:0.#}-hour cycle restart mid-trip. That is a planning failure unless it is deliberate.");

        // Recap, told once and only where it changes the answer.
        //
        // This used to fire a cheerful "recap returns 8:00 to the cycle" the moment a batch landed
        // mid-simulation, which on a trip that still needed the 34 put the briefing at odds with the
        // recap advice on the clocks screen — that one correctly says the batch arrives too late to be
        // worth waiting for, and dispatch was simultaneously presenting it as hours in hand.
        //
        // A restart wipes pending recap (see TakeRestart), so anything banked here landed BEFORE the
        // restart and was still not enough. Saying so is the useful version.
        if (recapArrivals.Count > 0)
        {
            var gained = recapArrivals.Sum(r => r.Hours);
            var last = recapArrivals[^1].At;
            result.Warnings.Add(result.CycleRestartRequired
                ? $"Recap puts {Hhmm.Of(gained)} back during this trip and it still does not cover it — " +
                  $"the {rules.CycleRestartHours:0.#} is needed regardless, so there is nothing to wait for."
                : $"Recap returns {Hhmm.Of(gained)} to the cycle by {GameClock.DayLabel(last)}, which this " +
                  "plan is relying on (driver-reported projection).");
        }

        if (cycle <= 0.01)
            result.Warnings.Add("Cycle lands at zero on delivery — the truck will be parked until a restart.");
        else if (cycle < 8)
            result.Warnings.Add($"Only {Hhmm.Of(cycle)} of cycle left on delivery. Reset planning starts now, not later.");

        // Being stranded on the receiver's property is a different risk from being late, and it is the
        // one nobody sees coming. Say it before they accept, in the terms it will actually happen in.
        var strandMargin = Math.Max(0, s.StrandedMarginHours);

        // Where to sleep if it comes to that, said in every one of these rather than assumed. A plan that
        // says "take your ten on their property" at a receiver that turns trucks out is the advice that
        // put a driver on a lot with no legal way to leave it.
        var berth = req.ReceiverAllowsOvernight
            ? $"They will have you overnight, so plan on the {rules.OffDutyReset:0.#} at their gate."
            : $"They do NOT allow overnight parking, so there is nowhere on that lot to take the " +
              $"{rules.OffDutyReset:0.#} — and once the window is gone you cannot legally move to find one. " +
              "Ask before you back in.";

        // How firm the dock figure is. It is an AVERAGE: half of all docks run longer than it, by
        // definition. The question is only by how much, and that depends on where the number came from —
        // a seed table is a guess, ten real deliveries is not. Never zero, however settled.
        var dockSlop = req.DockSamples >= FacilityLearning.SettleAt ? 0.25
                     : req.DockSamples > 0 ? 0.40
                     : 0.60;
        var dockMargin = Math.Max(0.5, req.UnloadingHours * dockSlop);
        var atDock = result.ShiftRemainingAtDock;

        if (req.UnloadingHours > 0 && shift <= 0.01)
            result.Warnings.Add(
                "Your window closes while you are still at the receiver. Finishing the unload is legal, but you will " +
                $"not be able to move the truck afterwards. {berth}");

        // The one nobody sees coming, and the reason this exists: the window covers the unload we PLANNED
        // and nothing more. Reported from play as an hour of window against a dock that took two — the
        // plan fit, so it said nothing, and the driver took a ten somewhere they had been told they could
        // not. The old pair of warnings both measured what was left once the trailer was EMPTY, which is
        // the wrong end: by then the overrun has already happened.
        else if (req.UnloadingHours > 0 && atDock >= 0 && atDock < req.UnloadingHours + dockMargin)
            result.Warnings.Add(
                $"You back in with {Hhmm.Of(atDock)} of window against a dock we have down for " +
                $"{Hhmm.Of(req.UnloadingHours)}" +
                (req.DockSamples > 0
                    ? $", averaged over {req.DockSamples} load(s). "
                    : " — and that figure is a starting estimate, not something we have measured here. ") +
                $"Run {Hhmm.Of(dockMargin)} long and your window shuts while you are on their property. {berth}");

        else if (req.UnloadingHours > 0 && shift < strandMargin)
            result.Warnings.Add(
                $"This delivers with only {Hhmm.Of(shift)} left on your 14-hour SHIFT once you are empty — " +
                $"nothing to do with the delivery window. If they hold you {Hhmm.Of(shift)} longer than " +
                $"planned, the window shuts while you are on the property. {berth}");

        if (result.FuelStopsRequired == 0 && result.TotalMiles > req.UsableFuelRangeMiles)
            result.Warnings.Add("Fuel range check could not be resolved — confirm the fuel level.");

        result.Verdict = result.Blockers.Count > 0 ? "Infeasible"
            : result.SlackHours < result.RequiredBufferHours ? "Tight"
            : "Feasible";

        return result;
    }

    private static double Min(params double[] v) => v.Min();

    /// <summary>
    /// Hours until a site-type receiver will take the load, arriving at this moment. Zero where they are
    /// open now, and zero for anywhere that never closes.
    ///
    /// A range that runs past midnight is handled — a yard open 18:00 to 06:00 is a night shift, not a
    /// twelve-hour gap with the sense inverted.
    /// </summary>
    internal static double HoursUntilOpen(DateTime at, double openHour, double closeHour,
                                          bool guessed = false)
    {
        if (openHour < 0 || closeHour < 0) return 0;               // never closes
        if (Math.Abs(openHour - closeHour) < 0.01) return 0;       // open all hours

        var tod = at.TimeOfDay.TotalHours;
        var inside = closeHour > openHour
            ? tod >= openHour && tod < closeHour
            : tod >= openHour || tod < closeHour;                  // straddles midnight
        if (inside) return 0;

        // Turning up after a closing time nobody told us about. We do not actually know they shut — we
        // guessed the working day — and holding the load to the next morning on that guess is how a run
        // the game called deliverable comes back impossible. Only a real range gets to do that.
        if (guessed && tod >= openHour) return 0;

        var until = openHour - tod;
        if (until < 0) until += 24;
        return Math.Round(until, 2);
    }

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
