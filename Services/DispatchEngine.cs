using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Evaluates the freight board the driver reports, gates every load against qualifications,
/// equipment status and HOS feasibility, then authorizes exactly one load — or rejects the
/// whole board when nothing makes operational sense.
/// </summary>
public static class DispatchEngine
{
    public static Truck? AssignedTruck(AppState s) =>
        s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit);

    public static Trailer? AssignedTrailer(AppState s) =>
        s.Trailers.FirstOrDefault(t => t.Unit == s.Driver.AssignedTrailerUnit);

    // ------------------------------------------------------------- trip numbering

    public static string PeekNumber(AppState s, string kind)
    {
        var next = kind switch
        {
            "EmptyMove" => s.Counters.EmptyMove + 1,
            "Maintenance" => s.Counters.Maintenance + 1,
            "Cancelled" => s.Counters.Cancelled + 1,
            _ => s.Counters.Freight + 1
        };
        return FormatNumber(s, kind, next);
    }

    public static string TakeNumber(AppState s, string kind)
    {
        int next;
        switch (kind)
        {
            case "EmptyMove": next = ++s.Counters.EmptyMove; break;
            case "Maintenance": next = ++s.Counters.Maintenance; break;
            case "Cancelled": next = ++s.Counters.Cancelled; break;
            default: next = ++s.Counters.Freight; break;
        }
        return FormatNumber(s, kind, next);
    }

    private static string FormatNumber(AppState s, string kind, int n)
    {
        var code = string.IsNullOrWhiteSpace(s.Settings.FreightPrefix)
            ? (string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)
            : s.Settings.FreightPrefix;
        var pad = Math.Clamp(s.Settings.NumberPadding, 2, 6);
        var seq = n.ToString(new string('0', pad));
        return kind switch
        {
            "EmptyMove" => $"{code}-{s.Settings.EmptyMovePrefix}-{seq}",
            "Maintenance" => $"{code}-{s.Settings.MaintenancePrefix}-{seq}",
            "Cancelled" => $"{code}-{s.Settings.CancelPrefix}-{seq}",
            _ => $"{code}-{seq}"
        };
    }

    // ------------------------------------------------------------- board evaluation

    public static BoardDecision EvaluateBoard(AppState s)
    {
        var decision = new BoardDecision
        {
            NextTripNumberPreview = PeekNumber(s, "Freight"),
            ResetWatch = s.Hos.CycleRemaining > 0 &&
                         s.Hos.CycleRemaining <= s.Settings.Scoring.ResetWatchCycleHours
        };

        decision.InfoNeeded.AddRange(MissingContext(s));

        var truck = AssignedTruck(s);
        var trailer = AssignedTrailer(s);

        foreach (var load in s.Board)
            decision.Evaluations.Add(Evaluate(s, load, truck, trailer));

        // Rank: feasible first, then score.
        decision.Evaluations = decision.Evaluations
            .OrderBy(e => e.HardFails.Count > 0 ? 2 : e.Feasibility.Verdict == "Infeasible" ? 2
                : e.Feasibility.Verdict == "Tight" ? 1 : 0)
            .ThenByDescending(e => e.Score)
            .ToList();

        if (s.Board.Count == 0)
        {
            decision.Headline = "No board submitted.";
            decision.Rationale = "Send me the jobs you can see and I will pick one.";
            decision.RejectAll = false;
            return decision;
        }

        // Home time colours the whole board once it is close, so it leads the notes rather than
        // turning up as a footnote under a load the driver has already been told to run.
        var homeNote = HomeTime.BoardNote(HomeTime.Status(s));
        if (homeNote != null) decision.DispatchNotes.Add(homeNote);

        // Hard stops that prevent ANY dispatch.
        var stops = DispatchBlockers(s, truck, trailer);
        if (stops.Count > 0)
        {
            decision.RejectAll = true;
            decision.Headline = "No dispatch — driver or equipment is not clear to run.";
            decision.Rationale = string.Join(" ", stops);
            decision.DispatchNotes.AddRange(stops);
            foreach (var e in decision.Evaluations) { e.Recommendation = "Reject"; e.HardFails.AddRange(stops); }
            return decision;
        }

        if (decision.InfoNeeded.Count > 0)
        {
            decision.RejectAll = false;
            decision.Headline = "Hold — I need information before I commit freight.";
            decision.Rationale = "Company policy: feasibility is confirmed BEFORE you hook, not after. " +
                                 string.Join(" ", decision.InfoNeeded);
            return decision;
        }

        var clear = decision.Evaluations
            .Where(e => e.HardFails.Count == 0 && e.Feasibility.Verdict == "Feasible")
            .ToList();

        if (clear.Count > 0)
        {
            var pick = clear[0];
            pick.Recommendation = "Authorize";
            foreach (var e in clear.Skip(1)) e.Recommendation = "Backup";
            decision.AuthorizedLoadId = pick.Load.Id;
            decision.Headline =
                $"{decision.NextTripNumberPreview} authorized: {Place(pick.Load.OriginCity, pick.Load.OriginState)} → " +
                $"{Place(pick.Load.DestCity, pick.Load.DestState)}, {pick.Load.Cargo}.";
            decision.Rationale = BuildRationale(s, pick, clear.Skip(1).FirstOrDefault(), decision.ResetWatch);
            decision.DispatchNotes.Add($"Run it at ${pick.AllInRpm:0.00}/mi all-in on {pick.Load.LoadedMiles + pick.Load.DeadheadMiles:0} total miles.");
            decision.DispatchNotes.Add($"Projected delivery {GameClock.Pretty(pick.Feasibility.ProjectedArrivalGameTime)} against a {GameClock.Pretty(pick.Feasibility.DueGameTime)} appointment — {pick.Feasibility.SlackHours:0.#} h of slack after parking allowance.");
            if (pick.Feasibility.RestsRequired > 0)
                decision.DispatchNotes.Add($"Plan on {pick.Feasibility.RestsRequired} × {s.Settings.Hos.OffDutyReset:0.#}-hour reset and {pick.Feasibility.BreaksRequired} required break(s) en route.");
            if (pick.Feasibility.FuelStopsRequired > 0)
                decision.DispatchNotes.Add($"{pick.Feasibility.FuelStopsRequired} fuel stop(s) planned — do not run below a quarter tank.");
            // If this pick is the ride home, say so plainly — the driver should know why they are
            // taking it over a better-paying load, and what to do once the trailer comes off.
            foreach (var line in HomeTime.HomeRunInstructions(s, pick.Load.DestCity, pick.Load.DestState))
                decision.DispatchNotes.Add(line);
            decision.DispatchNotes.Add("After you are loaded, report: loaded game time, odometer, actual trailer weight and trailer damage.");
            return decision;
        }

        // Nothing clean. Reject the board, but name the closest thing to a runnable load.
        decision.RejectAll = true;
        var tight = decision.Evaluations.FirstOrDefault(e => e.HardFails.Count == 0 && e.Feasibility.Verdict == "Tight");
        decision.Headline = "Board rejected — nothing on it is worth committing the truck to.";

        var why = new List<string>();
        foreach (var e in decision.Evaluations.Take(6))
        {
            var reason = e.HardFails.FirstOrDefault()
                         ?? e.Feasibility.Blockers.FirstOrDefault()
                         ?? e.Cons.FirstOrDefault()
                         ?? "does not fit the plan";
            why.Add($"{Place(e.Load.DestCity, e.Load.DestState)} {e.Load.Cargo}: {reason}");
        }
        decision.Rationale = string.Join(" | ", why);

        if (tight != null)
        {
            tight.Recommendation = "Backup";
            decision.DispatchNotes.Add($"Closest to runnable: {Place(tight.Load.OriginCity, tight.Load.OriginState)} → {Place(tight.Load.DestCity, tight.Load.DestState)} {tight.Load.Cargo}, but it leaves only {tight.Feasibility.SlackHours:0.#} h of slack against our {s.Settings.SafetyBufferHours:0.#} h buffer. I will not authorize that on a normal day. If you want it, say so and I will authorize it as an exception and own the call.");
        }

        decision.DispatchNotes.Add(decision.ResetWatch
            ? $"Cycle is down to {s.Hos.CycleRemaining:0.#} h. Reposition toward a restart location rather than chasing this board — see the reset options list."
            : "Reposition and pull a fresh board. I would rather run empty a short distance than tie the truck to bad freight.");

        return decision;
    }

    /// <summary>Things that must be answered before ANY load can be authorized.</summary>
    public static List<string> MissingContext(AppState s)
    {
        var need = new List<string>();
        if (GameClock.TryParse(s.Status.GameTime) == null)
            need.Add("Current in-game day and time.");
        if (string.IsNullOrWhiteSpace(s.Status.LocationCity))
            need.Add("Current truck location (city and state).");
        if (string.IsNullOrWhiteSpace(s.Hos.UpdatedUtc) && string.IsNullOrWhiteSpace(s.Hos.AsOfGameTime))
            need.Add("Current HOS clocks from your HOS display (drive, shift, break, 70-hour).");
        foreach (var l in s.Board)
        {
            if (l.LoadedMiles <= 0)
                need.Add($"Loaded mileage for the {l.Cargo} to {Place(l.DestCity, l.DestState)}.");
            if (l.DeadlineHours <= 0)
                need.Add($"Delivery window (hours to deliver) for the {l.Cargo} to {Place(l.DestCity, l.DestState)}.");
            if (l.GameRevenue <= 0)
                need.Add($"Job revenue for the {l.Cargo} to {Place(l.DestCity, l.DestState)}.");
        }
        return need.Distinct().ToList();
    }

    /// <summary>Conditions that ground the truck entirely.</summary>
    public static List<string> DispatchBlockers(AppState s, Truck? truck, Trailer? trailer)
    {
        var stops = new List<string>();
        var m = s.Settings.Maintenance;

        if (s.Driver.Status is "Terminated" or "Resigned")
            stops.Add($"Driver status is {s.Driver.Status} — no dispatch authority.");
        if (s.Driver.Status == "Suspended")
            stops.Add("Driver is suspended pending safety review — no freight until Safety clears you.");

        if (truck == null)
            stops.Add("No truck assigned. Operations has to assign a unit before you can be dispatched.");
        else
        {
            if (truck.Status == "OutOfService")
                stops.Add($"Unit {truck.Unit} is out of service.");
            if (truck.Status == "Shop")
                stops.Add($"Unit {truck.Unit} is in the shop.");
            var dmg = Math.Max(truck.DamagePct, s.Status.TruckDamagePct);
            if (dmg >= m.OutOfServicePct)
                stops.Add($"Unit {truck.Unit} is at {dmg:0.#}% damage — at or above the {m.OutOfServicePct:0}% out-of-service threshold. Shop first.");
        }

        if (trailer == null)
            stops.Add("No trailer assigned.");
        else
        {
            var tdmg = Math.Max(trailer.DamagePct, s.Status.TrailerDamagePct);
            if (tdmg >= m.OutOfServicePct)
                stops.Add($"Trailer {trailer.Unit} is at {tdmg:0.#}% damage — out of service until repaired.");
        }

        // Re-rigged at home and the trailer is still out under one of our own drivers. Sending the
        // driver out on the wrong equipment would defeat the reassignment, so they wait — at home.
        if (EquipmentService.PendingTrailerWait(s) is { } wait)
            stops.Add(string.IsNullOrWhiteSpace(wait.HeldByDriverName)
                ? $"{wait.Number}: waiting on trailer {wait.ToTrailerUnit} — available {GameClock.Pretty(wait.AvailableFromGameTime)}."
                : $"{wait.Number}: {wait.HeldByDriverName} still has trailer {wait.ToTrailerUnit}, due back around " +
                  $"{GameClock.Pretty(wait.AvailableFromGameTime)}. Stay home until it is in — the wait is home time, not hours.");

        if (s.Hos.CycleRemaining <= 0)
            stops.Add($"70-hour cycle is exhausted. {s.Settings.Hos.CycleRestartHours:0.#}-hour restart required before any driving.");
        else if (s.Hos.DriveRemaining <= 0.25 && s.Hos.ShiftRemaining <= 0.5)
            stops.Add($"Drive and shift clocks are spent. {s.Settings.Hos.OffDutyReset:0.#}-hour reset first.");

        var active = s.Trips.FirstOrDefault(t => t.Id == s.Status.ActiveTripId
                                                 && t.Status is "Authorized" or "InTransit");
        if (active != null)
            stops.Add($"{active.Number} is still open ({active.Status}). Close it out before I book anything else.");

        return stops;
    }

    // ------------------------------------------------------------- single load

    public static LoadEvaluation Evaluate(AppState s, BoardLoad load, Truck? truck, Trailer? trailer)
    {
        var w = s.Settings.Scoring;
        var e = new LoadEvaluation { Load = load };

        var total = load.LoadedMiles + load.DeadheadMiles;

        // Thresholds come from what this operation actually costs, not from fixed real-world rates.
        var (floorRpm, targetRpm, breakEven) = CostModel.Thresholds(s, load.LoadedMiles);
        e.BreakEven = breakEven;
        e.FloorRpmUsed = floorRpm;
        e.TargetRpmUsed = targetRpm;
        e.LoadedRpm = load.LoadedMiles > 0 ? Math.Round(load.GameRevenue / (decimal)load.LoadedMiles, 2) : 0;
        e.AllInRpm = total > 0 ? Math.Round(load.GameRevenue / (decimal)total, 2) : 0;
        e.DeadheadRatio = load.LoadedMiles > 0 ? load.DeadheadMiles / load.LoadedMiles : (load.DeadheadMiles > 0 ? 1 : 0);

        var dest = Markets.Find(s, load.DestCity, load.DestState);
        e.DestTier = dest?.Tier ?? 2;
        e.DestResetFriendly = dest?.ResetFriendly ?? false;

        // ---- hard gates
        e.HardFails.AddRange(QualificationFails(s, load, trailer));

        // ---- trailer: solvable by swapping, so it blocks this load without killing it
        if (trailer != null && !string.IsNullOrWhiteSpace(load.TrailerType) &&
            !EquipmentService.TypeCovers(trailer.Type, load.TrailerType))
        {
            var plan = EquipmentService.PlanSwap(s, load.TrailerType);
            e.SwapPlan = plan;
            if (plan.Possible)
            {
                e.RequiresSwap = true;
                e.Cons.Add($"Needs a {load.TrailerType}; you are on {trailer.Unit} ({trailer.Type}). {plan.Reason}");
            }
            else
            {
                e.HardFails.Add($"Needs a {load.TrailerType}; you are on {trailer.Unit} ({trailer.Type}). {plan.Reason}");
            }
        }

        // ---- HOS feasibility
        var fuelRange = HosEngine.UsableRange(s.Settings, truck, s.Status.FuelPct);
        e.Feasibility = HosEngine.Plan(s, new PlanRequest
        {
            DeadheadMiles = load.DeadheadMiles,
            LoadedMiles = load.LoadedMiles,
            LoadingHours = s.Settings.DefaultLoadingHours,
            UnloadingHours = s.Settings.DefaultUnloadingHours,
            NavEstimateHours = load.NavEstimateHours,
            ExtraStops = load.ExtraStops,
            DeadlineHours = load.DeadlineHours,
            UsableFuelRangeMiles = fuelRange,
            StartGameTime = s.Status.GameTime,
            Label = load.Cargo
        }, truck);

        // ---- economics
        e.EstimatedCompanyRevenue = Math.Round(load.GameRevenue * (decimal)Math.Clamp(s.Settings.RevenueFactor, 0.05, 3.0), 2);
        var mpg = truck?.AvgMpg > 0 ? truck.AvgMpg : 6.5;
        e.EstimatedFuelCost = Math.Round((decimal)(total / mpg) * s.Settings.FuelPricePerGal, 2);
        e.EstimatedDriverPay = PayEngine.EstimatePay(s, load);
        e.EstimatedMargin = Math.Round(
            e.EstimatedCompanyRevenue - e.EstimatedFuelCost - e.EstimatedDriverPay - s.Settings.OverheadPerLoad, 2);

        // ---- score
        double score = 0;
        var detail = new List<string>();

        var rpmScore = targetRpm > 0 ? (double)(e.AllInRpm / targetRpm) : 1;
        var rpmPts = Math.Clamp(rpmScore, 0, 2.0) * w.AllInRpm;
        score += rpmPts;
        detail.Add($"All-in RPM ${e.AllInRpm:0.00} vs ${targetRpm:0.00} target (break-even ${breakEven.BreakEvenRpm:0.00}): {rpmPts:+0.00;-0.00}");

        var revPts = Math.Clamp((double)load.GameRevenue / 2500.0, 0, 1.5) * w.TotalRevenue;
        score += revPts;
        detail.Add($"Gross ${load.GameRevenue:N0}: {revPts:+0.00;-0.00}");

        var dhPts = -Math.Clamp(e.DeadheadRatio / Math.Max(0.05, w.MaxDeadheadRatio), 0, 2.0) * w.DeadheadPenalty;
        score += dhPts;
        detail.Add($"Deadhead {load.DeadheadMiles:0} mi ({e.DeadheadRatio * 100:0}% of loaded): {dhPts:+0.00;-0.00}");

        var posPts = (e.DestTier switch { 1 => 1.0, 2 => 0.0, _ => -1.0 }) * w.Positioning;
        score += posPts;
        detail.Add($"{Place(load.DestCity, load.DestState)} is a tier-{e.DestTier} market{(dest == null ? " (not in the market table)" : "")}: {posPts:+0.00;-0.00}");

        if (s.Hos.CycleRemaining <= w.ResetWatchCycleHours)
        {
            var resetPts = (e.DestResetFriendly ? 1.0 : -0.8) * w.ResetPositioning;
            score += resetPts;
            detail.Add($"Reset watch active ({s.Hos.CycleRemaining:0.#} h cycle) and destination is {(e.DestResetFriendly ? "reset-capable" : "NOT a good restart location")}: {resetPts:+0.00;-0.00}");
        }

        var slackPts = Math.Clamp(e.Feasibility.SlackHours / 8.0, -2.0, 1.5) * w.HosSlack;
        score += slackPts;
        detail.Add($"HOS slack {e.Feasibility.SlackHours:0.#} h: {slackPts:+0.00;-0.00}");

        var division = DivisionFor(load, trailer);
        var app = s.Application;
        var fit = 0.0;
        if (app != null)
        {
            if (division.Equals(app.PreferredDivision, StringComparison.OrdinalIgnoreCase)) fit = 1.0;
            else if (division.Equals(app.SecondDivision, StringComparison.OrdinalIgnoreCase)) fit = 0.5;
        }
        var fitPts = fit * w.DivisionFit;
        score += fitPts;
        if (fit > 0) detail.Add($"{division} matches your division preference: {fitPts:+0.00;-0.00}");

        var utilPts = TripLengthFit(app?.PreferredTripLength, load.LoadedMiles) * w.UtilizationFit;
        score += utilPts;
        detail.Add($"{load.LoadedMiles:0} loaded miles vs your {app?.PreferredTripLength ?? "medium"} length preference: {utilPts:+0.00;-0.00}");

        // Home time. Silent until it is close, then it starts outweighing a better rate the wrong way.
        var homeStatus = HomeTime.Status(s);
        var (homePts, homeDetail, homePro, homeCon) = HomeTime.ScoreLoad(s, load, homeStatus);
        score += homePts;
        if (homeDetail != null) detail.Add(homeDetail);
        if (homePro != null) e.Pros.Add(homePro);
        if (homeCon != null) e.Cons.Add(homeCon);

        e.Score = Math.Round(score, 3);
        e.ScoreDetail = detail;

        // ---- pros / cons
        if (e.AllInRpm >= targetRpm) e.Pros.Add($"${e.AllInRpm:0.00}/mi all-in beats our ${targetRpm:0.00} target.");
        if (load.DeadheadMiles <= 0) e.Pros.Add("No deadhead — loaded from where you sit.");
        if (e.DestTier == 1) e.Pros.Add($"{Place(load.DestCity, load.DestState)} reloads easily.");
        if (e.DestResetFriendly && s.Hos.CycleRemaining <= w.ResetWatchCycleHours)
            e.Pros.Add("Destination can hold a restart.");
        if (e.Feasibility.Verdict == "Feasible" && e.Feasibility.SlackHours >= s.Settings.SafetyBufferHours * 2)
            e.Pros.Add($"Comfortable window — {e.Feasibility.SlackHours:0.#} h of slack.");
        if (e.EstimatedMargin > 0) e.Pros.Add($"Contributes ~${e.EstimatedMargin:N0} after fuel, wages and overhead.");

        if (e.AllInRpm < floorRpm)
            e.Cons.Add($"${e.AllInRpm:0.00}/mi all-in is under our ${floorRpm:0.00} break-even — fuel, wages and overhead come to more than the load pays.");
        else if (e.AllInRpm < targetRpm)
            e.Cons.Add($"${e.AllInRpm:0.00}/mi clears break-even but is below our ${targetRpm:0.00} target.");
        if (e.DeadheadRatio > w.MaxDeadheadRatio)
            e.Cons.Add($"{load.DeadheadMiles:0} mi of deadhead is {e.DeadheadRatio * 100:0}% of the loaded miles — over our {w.MaxDeadheadRatio * 100:0}% limit.");
        if (e.DestTier == 3)
            e.Cons.Add($"{Place(load.DestCity, load.DestState)} is a thin market — expect deadhead or a cheap reload getting out.");
        if (e.EstimatedMargin <= 0)
            e.Cons.Add($"Loses ~${Math.Abs(e.EstimatedMargin):N0} after fuel, wages and overhead.");
        foreach (var b in e.Feasibility.Blockers) e.Cons.Add(b);
        foreach (var wn in e.Feasibility.Warnings) e.Cons.Add(wn);
        if (load.IsUrgent) e.Cons.Add("Urgent freight — no room for error on the clock.");
        if (load.IsFragile) e.Cons.Add("Fragile freight — damage will show up on your record.");

        // Below-floor freight is a hard reject unless it buys us out of a dead market.
        if (e.AllInRpm < floorRpm)
        {
            var currentTier = Markets.Find(s, s.Status.LocationCity, s.Status.LocationState)?.Tier ?? 2;
            var escapes = currentTier == 3 && e.DestTier <= 2;
            var resetsUs = s.Hos.CycleRemaining <= w.ResetWatchCycleHours && e.DestResetFriendly;
            if (escapes) e.Pros.Add("Cheap, but it buys us out of a dead market — that is worth paying for.");
            else if (resetsUs) e.Pros.Add("Cheap, but it parks the truck where we can restart the cycle.");
            else e.HardFails.Add($"Under the ${floorRpm:0.00}/mi break-even with no positioning justification — this load loses money.");
        }

        e.Recommendation = e.HardFails.Count > 0 || e.Feasibility.Verdict == "Infeasible" ? "Reject" : "Backup";
        return e;
    }

    private static List<string> QualificationFails(AppState s, BoardLoad load, Trailer? trailer)
    {
        var fails = new List<string>();
        var app = s.Application;
        var division = DivisionFor(load, trailer);
        var cargo = load.Cargo ?? "";

        if (app != null)
        {
            foreach (var no in app.WillNotHaul.Where(x => !string.IsNullOrWhiteSpace(x)))
            {
                if (cargo.Contains(no, StringComparison.OrdinalIgnoreCase) ||
                    division.Contains(no, StringComparison.OrdinalIgnoreCase) ||
                    (load.TrailerType ?? "").Contains(no, StringComparison.OrdinalIgnoreCase))
                    fails.Add($"You listed \"{no}\" as freight you will not haul — I do not force freight.");
            }
            if (load.IsHazmat && !app.HasHazmat && !s.Driver.Qualifications.Contains("Hazmat"))
                fails.Add("Hazmat load and you have no hazmat endorsement on file.");
            if (division.Equals("Tanker", StringComparison.OrdinalIgnoreCase) && !app.HasTanker
                && !s.Driver.Qualifications.Contains("Tanker"))
                fails.Add("Tanker load and you have no tanker endorsement on file.");
        }

        foreach (var r in s.Driver.Restrictions)
        {
            if (cargo.Contains(r, StringComparison.OrdinalIgnoreCase) ||
                division.Contains(r, StringComparison.OrdinalIgnoreCase) ||
                (load.IsOversize && r.Contains("Oversize", StringComparison.OrdinalIgnoreCase)) ||
                (load.IsHazmat && r.Contains("Hazmat", StringComparison.OrdinalIgnoreCase)))
                fails.Add($"Company restriction on your file: {r}.");
        }

        if (s.Company.Divisions.Count > 0 && !string.IsNullOrWhiteSpace(division) &&
            !s.Company.Divisions.Any(d => d.Equals(division, StringComparison.OrdinalIgnoreCase)))
            fails.Add($"{division} is not a division this company operates.");

        // Trailer mismatch is handled as a swap requirement, not a dead end — see Evaluate.
        return fails;
    }

    private static bool TrailerMatches(string have, string need)
    {
        if (string.IsNullOrWhiteSpace(have) || string.IsNullOrWhiteSpace(need)) return true;
        have = have.Trim(); need = need.Trim();
        if (have.Equals(need, StringComparison.OrdinalIgnoreCase)) return true;
        // A step deck can generally cover flatbed freight; nothing else substitutes.
        if (have.Equals("Step Deck", StringComparison.OrdinalIgnoreCase) &&
            need.Equals("Flatbed", StringComparison.OrdinalIgnoreCase)) return true;
        // Reefers run as dry vans when the freight does not need temperature control.
        if (have.Equals("Reefer", StringComparison.OrdinalIgnoreCase) &&
            need.Equals("Dry Van", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public static string DivisionFor(BoardLoad load, Trailer? trailer)
    {
        if (!string.IsNullOrWhiteSpace(load.TrailerType)) return DivisionForTrailer(load.TrailerType);
        return trailer != null ? DivisionForTrailer(trailer.Type) : "Dry Van";
    }

    public static string DivisionForTrailer(string trailerType) => (trailerType ?? "").Trim() switch
    {
        "Reefer" or "Refrigerated" => "Reefer",
        "Flatbed" or "Step Deck" or "Conestoga" => "Flatbed",
        "Lowboy" or "RGN" or "Heavy Haul" => "Heavy Haul",
        "Tanker" or "Bulk" or "Pneumatic" => "Tanker",
        "Car Hauler" => "Auto",
        "Livestock" => "Livestock",
        "Log" or "Logging" => "Log",
        "Dump" or "Hopper" => "Bulk",
        "" => "Dry Van",
        var t => t
    };

    private static double TripLengthFit(string? pref, double loadedMiles) => (pref ?? "medium") switch
    {
        "short" => loadedMiles <= 250 ? 1 : loadedMiles <= 500 ? 0.3 : -0.6,
        "medium" => loadedMiles is > 200 and <= 700 ? 1 : loadedMiles <= 200 ? 0.1 : 0.2,
        "long" => loadedMiles > 600 ? 1 : loadedMiles > 350 ? 0.4 : -0.3,
        "otr" => loadedMiles > 800 ? 1 : loadedMiles > 500 ? 0.6 : -0.2,
        _ => 0
    };

    private static string BuildRationale(AppState s, LoadEvaluation pick, LoadEvaluation? runnerUp, bool resetWatch)
    {
        var parts = new List<string>();
        var top = pick.Pros.Take(2).ToList();
        if (top.Count > 0) parts.Add(string.Join(" ", top));

        if (runnerUp != null)
        {
            var better = pick.AllInRpm >= runnerUp.AllInRpm
                ? $"It also out-earns the {Place(runnerUp.Load.DestCity, runnerUp.Load.DestState)} option at ${pick.AllInRpm:0.00} vs ${runnerUp.AllInRpm:0.00} all-in."
                : $"The {Place(runnerUp.Load.DestCity, runnerUp.Load.DestState)} load pays more per mile, but this one positions the truck better and I am taking the position.";
            parts.Add(better);
        }

        if (resetWatch)
            parts.Add(pick.DestResetFriendly
                ? $"With {s.Hos.CycleRemaining:0.#} h of cycle left this also drops you somewhere you can sit the restart."
                : $"Cycle is at {s.Hos.CycleRemaining:0.#} h — this is the last load before we plan the restart.");

        if (pick.Load.DeadheadMiles > 0)
            parts.Add($"{pick.Load.DeadheadMiles:0} mi of deadhead is acceptable to get under this freight.");

        return string.Join(" ", parts);
    }

    public static string Place(string city, string st) =>
        string.IsNullOrWhiteSpace(st) ? city : $"{city}, {st}";

    // ------------------------------------------------------------- authorization

    public static Trip Authorize(AppState s, string loadId, string? rationaleOverride, bool overrideTight)
    {
        var load = s.Board.FirstOrDefault(b => b.Id == loadId)
                   ?? throw new InvalidOperationException("That load is not on the current board.");

        var truck = AssignedTruck(s);
        var trailer = AssignedTrailer(s);

        var stops = DispatchBlockers(s, truck, trailer);
        if (stops.Count > 0)
            throw new InvalidOperationException("Cannot authorize: " + string.Join(" ", stops));

        var eval = Evaluate(s, load, truck, trailer);
        if (eval.HardFails.Count > 0)
            throw new InvalidOperationException("Cannot authorize: " + string.Join(" ", eval.HardFails));
        if (eval.Feasibility.Verdict == "Infeasible")
            throw new InvalidOperationException("Cannot authorize: " + string.Join(" ", eval.Feasibility.Blockers));

        // Freight selection is a privilege of rank. Enforced here rather than only in the UI —
        // hiding a button is not a rule, and the driver must not be able to pick their own freight
        // before they have earned it.
        var privileges = CareerService.Privileges(s);
        if (s.Board.Count > 1 && !privileges.CanChooseAlternateLoad)
        {
            var assigned = EvaluateBoard(s).AuthorizedLoadId;
            if (assigned != null && assigned != loadId)
                throw new InvalidOperationException(
                    $"That is not your assignment. {privileges.Summary} " +
                    "Operations has already picked the load for this dispatch — take that one, or ask for a different one and I will decide.");
        }

        if (eval.Feasibility.Verdict == "Tight")
        {
            if (!overrideTight)
                throw new InvalidOperationException(
                    $"Cannot authorize: only {eval.Feasibility.SlackHours:0.#} h of slack against the required {eval.Feasibility.RequiredBufferHours:0.#} h buffer.");
            if (!privileges.CanOverrideTightLoad)
                throw new InvalidOperationException(
                    $"Only {eval.Feasibility.SlackHours:0.#} h of slack against a {eval.Feasibility.RequiredBufferHours:0.#} h buffer, and this is not your call to make. " +
                    privileges.Summary);
        }

        var number = TakeNumber(s, "Freight");
        var division = DivisionFor(load, trailer);

        var trip = new Trip
        {
            Number = number,
            Kind = "Freight",
            Status = "Authorized",
            Cargo = load.Cargo,
            Division = division,
            TrailerType = string.IsNullOrWhiteSpace(load.TrailerType) ? trailer?.Type ?? "" : load.TrailerType,
            Shipper = load.Shipper,
            OriginCity = string.IsNullOrWhiteSpace(load.OriginCity) ? s.Status.LocationCity : load.OriginCity,
            OriginState = string.IsNullOrWhiteSpace(load.OriginState) ? s.Status.LocationState : load.OriginState,
            Receiver = load.Receiver,
            DestCity = load.DestCity,
            DestState = load.DestState,
            WeightLbs = load.WeightLbs,
            DispatchedMiles = load.LoadedMiles,
            DeadheadMiles = load.DeadheadMiles,
            GameRevenue = load.GameRevenue,
            CompanyRevenue = Math.Round(load.GameRevenue * (decimal)Math.Clamp(s.Settings.RevenueFactor, 0.05, 3.0), 2),
            DispatchedGameTime = s.Status.GameTime,
            DueGameTime = eval.Feasibility.DueGameTime,
            DeadlineHoursAtDispatch = load.DeadlineHours,
            StartOdometer = s.Status.AtsOdometer,
            TruckUnit = truck?.Unit ?? "",
            TrailerUnit = trailer?.Unit ?? "",
            TruckDamageBefore = Math.Max(truck?.DamagePct ?? 0, s.Status.TruckDamagePct),
            TrailerDamageBefore = Math.Max(trailer?.DamagePct ?? 0, s.Status.TrailerDamagePct),
            LoadingHours = s.Settings.DefaultLoadingHours,
            UnloadingHours = s.Settings.DefaultUnloadingHours,
            ExtraStops = load.ExtraStops,
            IsHazmat = load.IsHazmat,
            IsOversize = load.IsOversize,
            TarpsUsed = load.RequiresTarp ? 1 : 0,
            FeasibilityAtDispatch = eval.Feasibility,
            AuthorizationRationale = string.IsNullOrWhiteSpace(rationaleOverride)
                ? $"${eval.AllInRpm:0.00}/mi all-in on {load.LoadedMiles + load.DeadheadMiles:N0} total miles, " +
                  $"{eval.Feasibility.SlackHours:0.#} h of slack against a {eval.Feasibility.RequiredBufferHours:0.#} h buffer, " +
                  $"tier-{eval.DestTier} destination{(eval.DestResetFriendly ? " with restart capability" : "")}."
                : rationaleOverride
        };

        if (eval.Feasibility.Verdict == "Tight")
            trip.Notes = "Authorized as an exception with sub-buffer slack. Dispatcher owns any service failure on this load.";

        // Record on the trip itself that this was a ride home, so the close-out audit can repeat the
        // instruction without having to re-derive whether it still applies.
        var homeRun = HomeTime.HomeRunInstructions(s, load.DestCity, load.DestState);
        if (homeRun.Count > 0)
        {
            trip.IsHomeRun = true;
            trip.Events.Add(new TripEvent
            {
                GameTime = s.Status.GameTime,
                Kind = "Note",
                Detail = "Routed for home time. " + homeRun[0]
            });
        }

        trip.Events.Add(new TripEvent
        {
            GameTime = s.Status.GameTime,
            Kind = "Note",
            Detail = $"Authorized by operations. {trip.AuthorizationRationale}"
        });

        s.Trips.Insert(0, trip);
        s.Status.ActiveTripId = trip.Id;
        s.Board.Clear();

        return trip;
    }

    /// <summary>Empty repositioning move — gets its own number series so it never eats a freight number.</summary>
    public static Trip CreateEmptyMove(AppState s, string destCity, string destState, double miles, string reason)
    {
        var truck = AssignedTruck(s);
        var trailer = AssignedTrailer(s);
        var trip = new Trip
        {
            Number = TakeNumber(s, "EmptyMove"),
            Kind = "EmptyMove",
            Status = "Authorized",
            Cargo = "Empty repositioning",
            Division = "Repositioning",
            OriginCity = s.Status.LocationCity,
            OriginState = s.Status.LocationState,
            DestCity = destCity,
            DestState = destState,
            DeadheadMiles = miles,
            DispatchedMiles = 0,
            DispatchedGameTime = s.Status.GameTime,
            StartOdometer = s.Status.AtsOdometer,
            TruckUnit = truck?.Unit ?? "",
            TrailerUnit = trailer?.Unit ?? "",
            TruckDamageBefore = s.Status.TruckDamagePct,
            TrailerDamageBefore = s.Status.TrailerDamagePct,
            AuthorizationRationale = reason,
            TrailerType = trailer?.Type ?? "",
            LoadingHours = 0,
            UnloadingHours = 0
        };
        s.Trips.Insert(0, trip);
        s.Status.ActiveTripId = trip.Id;
        return trip;
    }

    public static Trip CreateMaintenanceMove(AppState s, string destCity, string destState, double miles, string reason)
    {
        var move = CreateEmptyMove(s, destCity, destState, miles, reason);
        // Re-number into the maintenance series and give back the empty-move number.
        s.Counters.EmptyMove--;
        move.Number = TakeNumber(s, "Maintenance");
        move.Kind = "Maintenance";
        move.Cargo = "Maintenance move";
        move.Division = "Maintenance";
        return move;
    }
}
