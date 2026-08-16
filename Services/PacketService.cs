using System.Text;
using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Builds the "Dispatch Packet" — a complete, self-contained snapshot of the carrier, the driver,
/// the equipment, the clocks, the money and the history. Paste it into a chat with Claude and the
/// roleplay resumes with full continuity, no matter how long ago the last session was.
/// </summary>
public static class PacketService
{
    public static string BuildPacket(AppState s, bool includeRules = true, bool includeHistory = true)
    {
        var b = new StringBuilder();
        var truck = DispatchEngine.AssignedTruck(s);
        var trailer = DispatchEngine.AssignedTrailer(s);
        var hos = HosEngine.Describe(s, truck);
        var money = LedgerService.Summary(s);
        var career = CareerService.Review(s);

        b.AppendLine("# DISPATCH PACKET — resume the trucking roleplay from this state");
        b.AppendLine();
        b.AppendLine($"Generated {DateTime.Now:yyyy-MM-dd HH:mm} local from TruckSim Dispatcher.");
        b.AppendLine("This is the authoritative system of record. Where anything here conflicts with your memory of the roleplay, this file wins.");
        b.AppendLine();

        if (includeRules)
        {
            b.AppendLine("## Your role");
            b.AppendLine();
            b.AppendLine($"You are operations for **{s.Company.Name}** — owner, dispatcher, safety manager and accounting. " +
                         $"I am your driver, {s.Driver.Name}. Stay in character as company operations. Be decisive: tell me what the company is assigning, " +
                         "then briefly why, then what information you need back from me. Do not ask me which load I prefer — evaluate and decide.");
            b.AppendLine();
            b.AppendLine("Company dispatch policy in force:");
            b.AppendLine();
            b.AppendLine($"- Feasibility is confirmed BEFORE I hook, never after. Once loaded, we are committed to the freight barring a genuine emergency.");
            b.AppendLine($"- Never plan a load that consumes every remaining minute of HOS. Required slack after parking allowance: **{Hhmm.Of(s.Settings.SafetyBufferHours)}**.");
            b.AppendLine($"- My HOS display is the authoritative source for my clocks. Never confuse the break clock with available driving time.");
            b.AppendLine($"- A normal overnight rest does NOT restore the {s.Settings.Hos.CycleLimit:0.#}-hour cycle. Only a {s.Settings.Hos.CycleRestartHours:0.#}-hour restart does.");
            b.AppendLine("- After a delivery I show you jobs at the receiver first. Evaluate those before ordering an empty move.");
            b.AppendLine("- Distinguish driver-caused, dispatcher-caused, unavoidable, mechanical and game-limitation delays. If you booked a load too tight, own it as the company.");
            b.AppendLine("- Company freight revenue belongs to the company. My wages settle separately on a settlement.");
            b.AppendLine();
        }

        b.AppendLine("## Carrier");
        b.AppendLine();
        b.AppendLine($"| | |");
        b.AppendLine($"|---|---|");
        b.AppendLine($"| Company | {s.Company.Name} ({s.Company.Code}) |");
        b.AppendLine($"| Headquarters | {DispatchEngine.Place(s.Company.TerminalCity, s.Company.TerminalState)} |");
        b.AppendLine($"| DOT / MC | {s.Company.DotNumber} / {s.Company.McNumber} |");
        b.AppendLine($"| Divisions | {string.Join(", ", s.Company.Divisions)} |");
        b.AppendLine($"| Trip numbering | Freight `{DispatchEngine.PeekNumber(s, "Freight")}` · empty `{DispatchEngine.PeekNumber(s, "EmptyMove")}` · maintenance `{DispatchEngine.PeekNumber(s, "Maintenance")}` · cancelled `{DispatchEngine.PeekNumber(s, "Cancelled")}` (next available — never reuse) |");
        b.AppendLine();

        if (s.Company.Terminals.Count > 0)
        {
            b.AppendLine("### Terminals");
            b.AppendLine();
            b.AppendLine("| Yard | Level | Capacity | Fuel | Shop | Services |");
            b.AppendLine("|---|---|---|---|---|---|");
            foreach (var t in s.Company.Terminals)
            {
                var svc = new List<string>();
                if (t.HasParking) svc.Add("parking");
                if (t.HasTrailerDrop) svc.Add("trailer drop");
                if (t.HasDriverFacilities) svc.Add("driver facilities");
                b.AppendLine($"| {t.City}, {t.State}{(t.IsHeadquarters ? " **(HQ)**" : "")} | {t.Level} | {t.TruckCapacity} tractors | " +
                             $"{(t.HasFuel ? $"yes — ${t.FuelPricePerGal:0.00}/gal contract" : "no")} | " +
                             $"{(t.HasShop ? $"yes — {t.ShopLabourDiscount * 100:0}% off labour" : "no")} | {string.Join(", ", svc)} |");
            }
            b.AppendLine();
            var home = s.Company.Terminals.FirstOrDefault(t => t.Id == s.Driver.HomeTerminalId);
            if (home != null)
                b.AppendLine($"My home terminal is **{home.City}, {home.State}** — that is where home time starts and ends.");
            b.AppendLine();
        }

        b.AppendLine("## Driver");
        b.AppendLine();
        b.AppendLine($"| | |");
        b.AppendLine($"|---|---|");
        b.AppendLine($"| Name | {s.Driver.Name} ({s.Driver.EmployeeId}) |");
        b.AppendLine($"| Position | {s.Driver.RankTitle} |");
        b.AppendLine($"| Status | {s.Driver.Status}{(s.Driver.Probation.Active ? " — probation active" : "")} |");
        b.AppendLine($"| Hired | {GameClock.Pretty(s.Driver.HiredGameDate)} (game time) |");
        b.AppendLine($"| Pay | ${s.Driver.Pay.LoadedCpm:0.000}/loaded mi · ${s.Driver.Pay.DeadheadCpm:0.000}/empty mi |");
        b.AppendLine($"| Accessorials | detention ${s.Driver.Pay.DetentionPerHour:0.00}/h after {Hhmm.Of(s.Driver.Pay.DetentionFreeHours)} free · layover ${s.Driver.Pay.LayoverPerDay:0.00}/day · breakdown ${s.Driver.Pay.BreakdownPerDay:0.00}/day · stop ${s.Driver.Pay.ExtraStopPay:0.00} · tarp ${s.Driver.Pay.TarpPay:0.00} |");
        b.AppendLine($"| Bonuses | on-time ${s.Driver.Pay.OnTimeBonusCpm:0.000}/loaded mi at 100% service · safety ${s.Driver.Pay.SafetyBonusPerSettlement:0.00}/settlement |");
        b.AppendLine($"| Qualifications | {(s.Driver.Qualifications.Count > 0 ? string.Join(", ", s.Driver.Qualifications) : "—")} |");
        b.AppendLine($"| Restrictions | {(s.Driver.Restrictions.Count > 0 ? string.Join(", ", s.Driver.Restrictions) : "none")} |");
        b.AppendLine($"| Unsettled pay | ${s.Driver.UnsettledPay:N2} · lifetime earnings ${s.Driver.LifetimeEarnings:N2} |");
        b.AppendLine();

        if (s.Application is { } app)
        {
            b.AppendLine("Application on file: " +
                $"prefers **{app.PreferredDivision}** (2nd: {app.SecondDivision}), {app.TransmissionPreference} transmission, " +
                $"{app.ExperienceYears:0.#} yrs experience, {app.PreferredTripLength} trips" +
                (string.IsNullOrWhiteSpace(app.HomeTimePreference) ? "" : $", home time: {app.HomeTimePreference}") +
                (app.WillNotHaul.Count > 0 ? $". **Will not haul: {string.Join(", ", app.WillNotHaul)}.**" : "."));
            b.AppendLine();
        }

        b.AppendLine("## Assigned equipment");
        b.AppendLine();
        if (truck != null)
        {
            b.AppendLine($"**Unit {truck.Unit}** — {truck.Year} {truck.Make} {truck.Model}, {truck.Engine}, {truck.Transmission} ({truck.TransmissionType}), {truck.CabConfig}.");
            b.AppendLine($"Governed {truck.GovernedMph} mph · {truck.FuelCapacityGal:0} gal · ~{truck.AvgMpg:0.0} mpg · {truck.DamagePct:0.#}% damage.");
            b.AppendLine($"Company service odometer {truck.ServiceMiles:N0} mi · ATS odometer {truck.AtsOdometer:N0} mi · last PM at {truck.LastServiceMiles:N0} ({truck.ServiceIntervalMiles:N0} mi interval).");
        }
        else b.AppendLine("**No truck assigned.**");
        b.AppendLine();
        if (trailer != null)
            b.AppendLine($"**Trailer {trailer.Unit}** — {trailer.Year} {trailer.Make}, {trailer.Length} {trailer.Type} ({trailer.Division} division), {trailer.DamagePct:0.#}% damage, currently {trailer.CurrentLocation}.");
        else b.AppendLine("**No trailer assigned.**");
        b.AppendLine();

        b.AppendLine("## Current status");
        b.AppendLine();
        b.AppendLine($"| | |");
        b.AppendLine($"|---|---|");
        b.AppendLine($"| Game date/time | {GameClock.Pretty(s.Status.GameTime)} |");
        b.AppendLine($"| Location | {DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState)} ({s.Status.LocationKind}){(string.IsNullOrWhiteSpace(s.Status.LocationDetail) ? "" : $" — {s.Status.LocationDetail}")} |");
        b.AppendLine($"| Duty status | {s.Status.DutyStatus} |");
        b.AppendLine($"| Fuel | {s.Status.FuelPct:0}% (~{HosEngine.UsableRange(s.Settings, truck, s.Status.FuelPct):N0} mi of planned range) |");
        b.AppendLine($"| Tractor / trailer damage | {s.Status.TruckDamagePct:0.#}% / {s.Status.TrailerDamagePct:0.#}% |");
        b.AppendLine($"| ATS odometer | {s.Status.AtsOdometer:N0} |");
        b.AppendLine();

        b.AppendLine("## Hours of service (driver-reported, authoritative)");
        b.AppendLine();
        b.AppendLine($"Clocks read at {GameClock.Pretty(s.Hos.AsOfGameTime)}{(string.IsNullOrWhiteSpace(s.Hos.Source) ? "" : $" from {s.Hos.Source}")}.");
        b.AppendLine();
        b.AppendLine("| Clock | Remaining | Limit |");
        b.AppendLine("|---|---|---|");
        b.AppendLine($"| Drive | {Hhmm.Of(hos.DriveRemaining)} | {Hhmm.Of(hos.DriveLimit)} |");
        b.AppendLine($"| Shift / on-duty window | {Hhmm.Of(hos.ShiftRemaining)} | {Hhmm.Of(hos.ShiftLimit)} |");
        b.AppendLine($"| Break clock (driving until 30-min break) | {Hhmm.Of(hos.BreakRemaining)} | {Hhmm.Of(hos.BreakLimit)} |");
        b.AppendLine($"| {hos.CycleLimit:0.#}-hour cycle | {Hhmm.Of(hos.CycleRemaining)} | {Hhmm.Of(hos.CycleLimit)} |");
        b.AppendLine();
        b.AppendLine($"- **Legally drivable right now: {Hhmm.Of(hos.DrivableNowHours)}** (binding clock: {hos.BindingClock}) ≈ {hos.ProjectedMilesNow:N0} mi at {hos.EffectiveMph:0.#} mph effective.");
        b.AppendLine($"- Single stint before the required break: {Hhmm.Of(hos.StintBeforeBreakHours)} ≈ {hos.StintMiles:N0} mi.");
        b.AppendLine($"- Next required action: {hos.NextRequiredAction}");
        if (s.Hos.Recap.Count > 0)
            b.AppendLine($"- Projected recap: {string.Join(", ", s.Hos.Recap.OrderBy(r => r.InDays).Select(r => $"+{Hhmm.Of(r.Hours)} in {r.InDays} day(s)"))} (total {Hhmm.Of(hos.RecapHours)}).");
        if (!string.IsNullOrWhiteSpace(hos.ResetWatch)) b.AppendLine($"- **{hos.ResetWatch}**");
        if (!string.IsNullOrWhiteSpace(s.Hos.Notes)) b.AppendLine($"- Driver note: {s.Hos.Notes}");
        b.AppendLine();
        b.AppendLine($"Rule set in force: {s.Settings.Hos.DriveLimit:0.#}/{s.Settings.Hos.ShiftLimit:0.#}, " +
                     $"{s.Settings.Hos.BreakLength * 60:0}-min break after {Hhmm.Of(s.Settings.Hos.DrivingBeforeBreak)} driving, " +
                     $"{s.Settings.Hos.CycleLimit:0.#}-in-{s.Settings.Hos.CycleDays}, " +
                     $"{Hhmm.Of(s.Settings.Hos.OffDutyReset)} off resets drive/shift, {Hhmm.Of(s.Settings.Hos.CycleRestartHours)} restarts the cycle." +
                     (s.Settings.UsesHosMod ? $" Source: {s.Settings.HosModName} (mod values — use these, not real FMCSA)." : " Source: real FMCSA defaults as the roleplay layer."));
        b.AppendLine();

        var active = TripService.Active(s);
        if (active != null)
        {
            b.AppendLine($"## OPEN LOAD — {active.Number} ({active.Status})");
            b.AppendLine();
            b.AppendLine($"{active.Cargo} · {DispatchEngine.Place(active.OriginCity, active.OriginState)} → {DispatchEngine.Place(active.DestCity, active.DestState)}");
            b.AppendLine($"Dispatched {active.DispatchedMiles:N0} mi loaded + {active.DeadheadMiles:N0} mi deadhead · revenue ${active.GameRevenue:N2} · due {GameClock.Pretty(active.DueGameTime)}");
            if (active.FeasibilityAtDispatch is { } fz)
                b.AppendLine($"Feasibility at dispatch: **{fz.Verdict}** — {Hhmm.Of(fz.SlackHours)} slack, {fz.RestsRequired} rest(s), {fz.BreaksRequired} break(s), {fz.FuelStopsRequired} fuel stop(s).");
            b.AppendLine($"Authorization rationale: {active.AuthorizationRationale}");
            if (active.Events.Count > 0)
            {
                b.AppendLine();
                b.AppendLine("Trip log:");
                foreach (var ev in active.Events.TakeLast(12))
                    b.AppendLine($"- {GameClock.Pretty(ev.GameTime)} — **{ev.Kind}**: {ev.Detail}");
            }
            b.AppendLine();
        }

        if (s.Board.Count > 0)
        {
            b.AppendLine("## Freight board awaiting a decision");
            b.AppendLine();
            b.AppendLine("| Cargo | Origin | Destination | Loaded mi | DH mi | Revenue | $/mi all-in | Deliver in | Trailer |");
            b.AppendLine("|---|---|---|---|---|---|---|---|---|");
            foreach (var l in s.Board)
            {
                var total = l.LoadedMiles + l.DeadheadMiles;
                var rpm = total > 0 ? l.GameRevenue / (decimal)total : 0;
                b.AppendLine($"| {l.Cargo} | {DispatchEngine.Place(l.OriginCity, l.OriginState)} | {DispatchEngine.Place(l.DestCity, l.DestState)} | " +
                             $"{l.LoadedMiles:N0} | {l.DeadheadMiles:N0} | ${l.GameRevenue:N0} | ${rpm:0.00} | {Hhmm.Of(l.DeadlineHours)} | {l.TrailerType} |");
            }
            b.AppendLine();

            var decision = DispatchEngine.EvaluateBoard(s);
            b.AppendLine($"**System recommendation:** {decision.Headline}");
            if (!string.IsNullOrWhiteSpace(decision.Rationale)) b.AppendLine($"> {decision.Rationale}");
            b.AppendLine();
            foreach (var e in decision.Evaluations)
            {
                b.AppendLine($"- **{e.Recommendation}** — {e.Load.Cargo} to {DispatchEngine.Place(e.Load.DestCity, e.Load.DestState)}: " +
                             $"${e.AllInRpm:0.00}/mi all-in, feasibility {e.Feasibility.Verdict} ({Hhmm.Of(e.Feasibility.SlackHours)} slack), " +
                             $"tier-{e.DestTier} destination, score {e.Score:0.00}.");
                foreach (var hf in e.HardFails) b.AppendLine($"  - HARD FAIL: {hf}");
                foreach (var bl in e.Feasibility.Blockers) b.AppendLine($"  - BLOCKER: {bl}");
            }
            b.AppendLine();
            if (decision.InfoNeeded.Count > 0)
            {
                b.AppendLine("Information still needed before committing freight:");
                foreach (var n in decision.InfoNeeded) b.AppendLine($"- {n}");
                b.AppendLine();
            }
        }

        b.AppendLine("## Company finances");
        b.AppendLine();
        b.AppendLine("| Account | Balance |");
        b.AppendLine("|---|---|");
        foreach (var a in money.Accounts) b.AppendLine($"| {a.Name} | ${a.Balance:N2} |");
        b.AppendLine($"| **Net position** | **${money.NetPosition:N2}** |");
        b.AppendLine();
        b.AppendLine($"Lifetime: revenue ${money.Revenue:N2} · fuel ${money.Fuel:N2} · maintenance ${money.MaintenanceSpend:N2} · " +
                     $"payroll ${money.PayrollSpend:N2} · tolls ${money.TollSpend:N2} · overhead ${money.OverheadSpend:N2}.");
        b.AppendLine($"Operating income ${money.OperatingIncome:N2} · operating ratio {money.OperatingRatio:0.000} · " +
                     $"${money.RevenuePerLoadedMile:0.000}/loaded mi revenue · ${money.CostPerMile:0.000}/mi cost.");
        if (Math.Abs(s.Settings.RevenueFactor - 1.0) > 0.001)
            b.AppendLine($"Revenue realism factor ×{s.Settings.RevenueFactor:0.##} is applied to ATS payouts before the company books them.");
        b.AppendLine();

        b.AppendLine("## Career record");
        b.AppendLine();
        var st = career.Stats;
        b.AppendLine($"| | |");
        b.AppendLine($"|---|---|");
        b.AppendLine($"| Loads delivered | {st.LoadsDelivered} ({st.LoadsOnTime} on time, {st.LoadsLate} late — {st.DriverFaultLate} driver-fault) |");
        b.AppendLine($"| On-time service | {st.OnTimePct:0.#}% |");
        b.AppendLine($"| Miles | {st.LoadedMiles:N0} loaded + {st.DeadheadMiles:N0} empty = {st.TotalMiles:N0} |");
        b.AppendLine($"| Avg damage per trip | {st.AvgDamagePerTrip:0.##} points |");
        b.AppendLine($"| Cancellations | {st.Cancellations} |");
        b.AppendLine($"| Days employed (game) | {st.DaysEmployed} |");
        b.AppendLine();
        if (career.ProbationActive)
        {
            b.AppendLine("Probation progress:");
            b.AppendLine();
            b.AppendLine("| Requirement | Current | Required | Met |");
            b.AppendLine("|---|---|---|---|");
            foreach (var r in career.ProbationProgress)
                b.AppendLine($"| {r.Label} | {r.Current} | {r.Required} | {(r.Met ? "yes" : "no")} |");
            b.AppendLine();
        }
        if (career.NextRank != null)
        {
            b.AppendLine($"Next position: **{career.NextRankTitle}** — {(career.NextRankMet ? "ELIGIBLE NOW" : "not yet eligible")}.");
            b.AppendLine();
        }
        foreach (var f in career.Findings) b.AppendLine($"- {f}");
        b.AppendLine();

        b.AppendLine("## Safety record");
        b.AppendLine();
        var sr = career.Safety;
        b.AppendLine($"Current discipline level: **{sr.CurrentLevel}**. Next step if a preventable incident occurs: {sr.NextStepIfPreventable}.");
        b.AppendLine($"Incidents: {sr.TotalIncidents} total — {sr.DriverFault} driver-fault, {sr.DispatcherFault} dispatcher-fault, " +
                     $"{sr.Mechanical} mechanical, {sr.Unavoidable} unavoidable, {sr.GameLimitation} game-limitation.");
        if (sr.ActiveDiscipline.Count > 0)
        {
            b.AppendLine();
            foreach (var d in sr.ActiveDiscipline)
                b.AppendLine($"- {d.Number} **{d.Level}** ({GameClock.Pretty(d.GameTime)}): {d.Reason}");
        }
        b.AppendLine();

        var openWo = s.WorkOrders.Where(w => w.Status == "Open").ToList();
        var alerts = MaintenanceService.FleetAlerts(s);
        if (openWo.Count > 0 || alerts.Count > 0)
        {
            b.AppendLine("## Maintenance");
            b.AppendLine();
            foreach (var w in openWo)
                b.AppendLine($"- **OPEN {w.Number}** — {w.UnitKind} {w.Unit}, {w.Kind}: {w.Description}");
            foreach (var a in alerts) b.AppendLine($"- {a}");
            b.AppendLine();
            b.AppendLine($"Thresholds: monitor below {s.Settings.Maintenance.ReportPct:0}% · report after delivery at {s.Settings.Maintenance.ReportPct:0}% · " +
                         $"mandatory review at {s.Settings.Maintenance.MandatoryReviewPct:0}% · out of service at {s.Settings.Maintenance.OutOfServicePct:0}%.");
            b.AppendLine();
        }

        if (includeHistory)
        {
            var closed = s.Trips.Where(t => t.Status is "Delivered" or "Cancelled").Take(15).ToList();
            if (closed.Count > 0)
            {
                b.AppendLine("## Recent trip history (newest first)");
                b.AppendLine();
                b.AppendLine("| Trip | Cargo | Lane | Miles | Revenue | Service | Fault | Driver pay |");
                b.AppendLine("|---|---|---|---|---|---|---|---|");
                foreach (var t in closed)
                    b.AppendLine($"| {t.Number} | {t.Cargo} | {DispatchEngine.Place(t.OriginCity, t.OriginState)} → {DispatchEngine.Place(t.DestCity, t.DestState)} | " +
                                 $"{(t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles):N0}+{t.DeadheadMiles:N0} | ${t.CompanyRevenue:N0} | " +
                                 $"{t.ServiceResult} | {(t.FaultAttribution == "None" ? "—" : t.FaultAttribution)} | ${t.Pay.Total:N2} |");
                b.AppendLine();
            }

            if (s.Settlements.Count > 0)
            {
                b.AppendLine("## Settlements (newest first)");
                b.AppendLine();
                foreach (var stl in s.Settlements.Take(6))
                    b.AppendLine($"- **{stl.Number}** — {stl.TripNumbers.Count} trip(s), {stl.LoadedMiles:N0} loaded mi, " +
                                 $"{stl.OnTimePct:0.#}% on time, gross **${stl.Gross:N2}**.");
                b.AppendLine();
            }
        }

        b.AppendLine("## Game environment");
        b.AppendLine();
        b.AppendLine($"- ATS version: {(string.IsNullOrWhiteSpace(s.Settings.AtsVersion) ? "not reported" : s.Settings.AtsVersion)}");
        if (s.Settings.MapMods.Count > 0) b.AppendLine($"- Map mods: {string.Join(", ", s.Settings.MapMods)}");
        if (s.Settings.Mods.Count > 0) b.AppendLine($"- Other mods: {string.Join(", ", s.Settings.Mods)}");
        b.AppendLine($"- HOS mod: {(s.Settings.UsesHosMod ? s.Settings.HosModName : "none — real FMCSA rules used as a roleplay layer")}");
        b.AppendLine($"- Economy mod: {(s.Settings.UsesEconomyMod ? "yes — ATS revenue treated as realistic" : $"no — revenue discounted ×{s.Settings.RevenueFactor:0.##}")}");
        b.AppendLine($"- Effective planning speed: {hos.EffectiveMph:0.#} mph ({s.Settings.GovernedMph} mph governed × {s.Settings.SpeedFactor:0.00} factor)");
        b.AppendLine($"- Parking buffer {Hhmm.Of(s.Settings.ParkingBufferHours)} · pre-trip {Hhmm.Of(s.Settings.PreTripHours)} · default load {Hhmm.Of(s.Settings.DefaultLoadingHours)} · default unload {Hhmm.Of(s.Settings.DefaultUnloadingHours)}");
        b.AppendLine();
        b.AppendLine("---");
        b.AppendLine();
        b.AppendLine("Acknowledge the state briefly, then give me my next dispatch or tell me what you need.");

        return b.ToString();
    }

    /// <summary>Short form for a single dispatch decision, when the driver just wants a load call.</summary>
    public static string BuildBoardBrief(AppState s)
    {
        var b = new StringBuilder();
        var truck = DispatchEngine.AssignedTruck(s);
        var hos = HosEngine.Describe(s, truck);

        b.AppendLine($"Dispatch request — {s.Company.Name}, driver {s.Driver.Name}, unit {s.Driver.AssignedTruckUnit} / trailer {s.Driver.AssignedTrailerUnit}.");
        b.AppendLine();
        b.AppendLine($"Sitting at {DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState)} ({s.Status.LocationKind}), " +
                     $"game clock {GameClock.Pretty(s.Status.GameTime)}, fuel {s.Status.FuelPct:0}%, " +
                     $"tractor {s.Status.TruckDamagePct:0.#}% / trailer {s.Status.TrailerDamagePct:0.#}% damage.");
        b.AppendLine();
        b.AppendLine($"HOS: drive {Hhmm.Of(hos.DriveRemaining)}, shift {Hhmm.Of(hos.ShiftRemaining)}, break clock {Hhmm.Of(hos.BreakRemaining)}, " +
                     $"cycle {Hhmm.Of(hos.CycleRemaining)}. Drivable now {Hhmm.Of(hos.DrivableNowHours)} (~{hos.ProjectedMilesNow:N0} mi at {hos.EffectiveMph:0.#} mph). " +
                     hos.NextRequiredAction);
        if (!string.IsNullOrWhiteSpace(hos.ResetWatch)) b.AppendLine($"{hos.ResetWatch}");
        b.AppendLine();

        if (s.Board.Count == 0)
        {
            b.AppendLine("No board entered yet.");
            return b.ToString();
        }

        b.AppendLine($"Board ({s.Board.Count} job(s)). Next freight number would be {DispatchEngine.PeekNumber(s, "Freight")}.");
        b.AppendLine();
        foreach (var l in s.Board)
        {
            var total = l.LoadedMiles + l.DeadheadMiles;
            var rpm = total > 0 ? l.GameRevenue / (decimal)total : 0;
            b.AppendLine($"- {l.Cargo}: {DispatchEngine.Place(l.OriginCity, l.OriginState)} → {DispatchEngine.Place(l.DestCity, l.DestState)}, " +
                         $"{l.LoadedMiles:N0} loaded + {l.DeadheadMiles:N0} DH, ${l.GameRevenue:N0} (${rpm:0.00}/mi all-in), " +
                         $"deliver within {Hhmm.Of(l.DeadlineHours)}, {l.TrailerType}" +
                         (l.WeightLbs > 0 ? $", {l.WeightLbs:N0} lb" : "") +
                         (l.IsUrgent ? ", URGENT" : "") + (l.IsFragile ? ", fragile" : "") +
                         (l.IsHazmat ? ", HAZMAT" : "") + (l.IsOversize ? ", oversize" : "") + ".");
        }
        b.AppendLine();

        var d = DispatchEngine.EvaluateBoard(s);
        b.AppendLine($"System says: {d.Headline}");
        if (!string.IsNullOrWhiteSpace(d.Rationale)) b.AppendLine(d.Rationale);
        b.AppendLine();
        b.AppendLine("Confirm or override the assignment, and tell me what to report after loading.");
        return b.ToString();
    }
}
