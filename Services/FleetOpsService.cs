using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The rest of the company: AI drivers hired in ATS running company units. Their production is
/// never invented — the player reads revenue, miles and damage off the game and files a report,
/// which posts to the same ledger the player's own freight does.
/// </summary>
public static class FleetOpsService
{
    public static HiredDriver AddDriver(AppState s, HiredDriver d)
    {
        if (string.IsNullOrWhiteSpace(d.Name))
            throw new InvalidOperationException("A hired driver needs a name.");
        if (s.HiredDrivers.Any(x => x.Name.Equals(d.Name, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"{d.Name} is already on the roster.");

        if (string.IsNullOrWhiteSpace(d.Id)) d.Id = Guid.NewGuid().ToString("N")[..8];
        if (string.IsNullOrWhiteSpace(d.HiredGameDate)) d.HiredGameDate = s.Status.GameTime;

        if (!string.IsNullOrWhiteSpace(d.AssignedTruckUnit))
            ClaimUnit(s, d.AssignedTruckUnit, d.Name, d.Id);
        if (!string.IsNullOrWhiteSpace(d.AssignedTrailerUnit))
        {
            var tr = s.Trailers.FirstOrDefault(t => t.Unit == d.AssignedTrailerUnit);
            if (tr != null) tr.AssignedTruckUnit = d.AssignedTruckUnit;
        }

        s.HiredDrivers.Add(d);
        return d;
    }

    /// <summary>A unit can only be under one driver, and never under the player and a hire at once.</summary>
    private static void ClaimUnit(AppState s, string unit, string driverName, string driverId)
    {
        var truck = s.Trucks.FirstOrDefault(t => t.Unit.Equals(unit, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidOperationException($"Unit {unit} is not in the fleet.");
        if (truck.Unit.Equals(s.Driver.AssignedTruckUnit, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Unit {unit} is your own truck. Pick another unit for a hired driver.");

        var heldBy = s.HiredDrivers.FirstOrDefault(x => x.Id != driverId
            && x.AssignedTruckUnit.Equals(unit, StringComparison.OrdinalIgnoreCase));
        if (heldBy != null)
            throw new InvalidOperationException($"Unit {unit} is already assigned to {heldBy.Name}.");

        truck.AssignedDriver = driverName;
        // A unit an AI driver is running exists in the game, so its condition is knowable.
        truck.InGameGarage = true;
    }

    public static HiredDriver UpdateDriver(AppState s, HiredDriver incoming)
    {
        var existing = s.HiredDrivers.FirstOrDefault(x => x.Id == incoming.Id)
                       ?? throw new InvalidOperationException("No such hired driver.");

        if (!string.Equals(existing.AssignedTruckUnit, incoming.AssignedTruckUnit, StringComparison.OrdinalIgnoreCase))
        {
            var old = s.Trucks.FirstOrDefault(t => t.Unit == existing.AssignedTruckUnit);
            if (old != null && old.AssignedDriver == existing.Name) old.AssignedDriver = "";
            if (!string.IsNullOrWhiteSpace(incoming.AssignedTruckUnit))
                ClaimUnit(s, incoming.AssignedTruckUnit, incoming.Name, incoming.Id);
        }

        // Lifetime totals are earned history — never overwritten from a form post.
        incoming.LifetimeMiles = existing.LifetimeMiles;
        incoming.LifetimeRevenue = existing.LifetimeRevenue;
        incoming.LifetimeWages = existing.LifetimeWages;
        incoming.ReportsFiled = existing.ReportsFiled;
        incoming.HiredGameDate = existing.HiredGameDate;

        s.HiredDrivers[s.HiredDrivers.IndexOf(existing)] = incoming;
        return incoming;
    }

    public static void RemoveDriver(AppState s, string id)
    {
        var d = s.HiredDrivers.FirstOrDefault(x => x.Id == id)
                ?? throw new InvalidOperationException("No such hired driver.");
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == d.AssignedTruckUnit);
        if (truck != null && truck.AssignedDriver == d.Name) truck.AssignedDriver = "";
        s.HiredDrivers.Remove(d);
    }

    /// <summary>
    /// Posts a period of hired-driver production. Revenue is booked through the same realism factor
    /// the player's freight uses, wages and repairs are expensed, and each unit's damage and service
    /// mileage move to what the player reported off the game.
    /// </summary>
    public static FleetReport FileReport(AppState s, FleetReport report)
    {
        if (report.Lines == null || report.Lines.Count == 0)
            throw new InvalidOperationException("A fleet report needs at least one driver line.");

        var code = string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;
        report.Number = $"{code}-FR-{s.FleetReports.Count + 1:0000}";
        if (string.IsNullOrWhiteSpace(report.PeriodEndGame)) report.PeriodEndGame = s.Status.GameTime;

        var factor = (decimal)Math.Clamp(s.Settings.RevenueFactor, 0.05, 3.0);
        report.TotalRevenue = 0; report.TotalMiles = 0; report.TotalWages = 0; report.TotalRepairs = 0;

        foreach (var line in report.Lines)
        {
            var driver = s.HiredDrivers.FirstOrDefault(x => x.Id == line.DriverId);
            if (driver == null) continue;
            line.DriverName = driver.Name;
            if (string.IsNullOrWhiteSpace(line.TruckUnit)) line.TruckUnit = driver.AssignedTruckUnit;

            // Wages default to the driver's agreed share of what they brought in.
            if (line.Wages <= 0 && line.Revenue > 0)
                line.Wages = Math.Round(line.Revenue * (decimal)Math.Clamp(driver.WageShare, 0, 0.9), 2);

            var booked = Math.Round(line.Revenue * factor, 2);
            if (booked > 0)
                LedgerService.Post(s, LedgerService.Operating, booked, "FreightRevenue",
                    $"Fleet production — {driver.Name} on unit {line.TruckUnit}" +
                    (Math.Abs(factor - 1m) > 0.001m ? $" (ATS ${line.Revenue:N2}; booked at ×{factor:0.##})" : ""),
                    report.Number);

            if (line.Wages > 0)
                LedgerService.Post(s, LedgerService.Operating, -line.Wages, "Payroll",
                    $"Wages — {driver.Name}", report.Number);

            // Repairs and reserve accrual both go through the single cash account — the earmark is a
            // claim on the one bank balance, not a separate pot to move money into.
            if (line.Repairs > 0)
                LedgerService.Post(s, LedgerService.Operating, -line.Repairs, "Repairs",
                    $"Unit {line.TruckUnit} — {driver.Name}", report.Number);

            // Trailer condition, where the driver is on a company trailer. ATS shows stars for a
            // trailer we are not hooked to, never a percentage, so stars are what we record.
            if (string.IsNullOrWhiteSpace(line.TrailerUnit)) line.TrailerUnit = driver.AssignedTrailerUnit;
            var trailer = s.Trailers.FirstOrDefault(t => t.Unit == line.TrailerUnit);
            if (trailer != null)
            {
                trailer.ServiceMiles = Math.Round(trailer.ServiceMiles + line.Miles, 0);
                trailer.InGameGarage = true;
                if (line.TrailerStars > 0)
                {
                    var tStarsBefore = trailer.Stars;
                    trailer.Stars = line.TrailerStars;
                    trailer.StarsReportedGameTime = report.PeriodEndGame;
                    if (tStarsBefore > 0 && trailer.Stars < tStarsBefore)
                        report.Findings.Add($"Trailer {trailer.Ref} dropped from {tStarsBefore:0.#} to {trailer.Stars:0.#} stars.");
                }
                // A trailer with no acquisition date on file gets one now, so age starts counting from
                // the first period we saw it rather than never.
                if (string.IsNullOrWhiteSpace(trailer.AcquiredGameTime))
                    trailer.AcquiredGameTime = report.PeriodEndGame;
            }

            // Tractor condition and mileage come from the game reading: stars and an odometer. There
            // is no damage percentage to be had for a unit we are not sitting in, so none is asked for.
            var truck = s.Trucks.FirstOrDefault(t => t.Unit == line.TruckUnit);
            if (truck != null)
            {
                var starsBefore = truck.Stars;
                truck.InGameGarage = true;

                // The game reading only ever tells us how far it moved since we last looked. The
                // company's own odometer is advanced by that gap and never overwritten — the two cannot
                // be reconciled, because the odometer cannot be set in ATS. A driver issued a unit the
                // books call 200,000 miles will have bought one reading zero.
                if (line.TruckOdometer > 0)
                {
                    var moved = line.TruckOdometer - truck.AtsOdometer;
                    if (moved < 0)
                    {
                        // Lower than last time means a different truck, not negative miles. New baseline.
                        report.Findings.Add(
                            $"Unit {truck.Ref}: the game reads {line.TruckOdometer:N0} against {truck.AtsOdometer:N0} " +
                            "last time. Taking that as a replacement unit and starting the reading again — " +
                            $"our own odometer stays at {truck.ServiceMiles:N0} mi.");
                    }
                    else
                    {
                        truck.ServiceMiles = Math.Round(truck.ServiceMiles + moved, 0);
                    }
                    truck.AtsOdometer = line.TruckOdometer;
                }
                else
                {
                    // No reading given: fall back to the miles reported for the period.
                    truck.ServiceMiles = Math.Round(truck.ServiceMiles + line.Miles, 0);
                }

                if (line.TruckStars > 0)
                {
                    truck.Stars = line.TruckStars;
                    truck.StarsReportedGameTime = report.PeriodEndGame;
                    if (starsBefore > 0 && truck.Stars < starsBefore)
                        report.Findings.Add($"Unit {truck.Ref} dropped from {starsBefore:0.#} to {truck.Stars:0.#} stars under {driver.Name}.");
                }

                var sinceService = truck.ServiceMiles - truck.LastServiceMiles;
                if (sinceService >= truck.ServiceIntervalMiles)
                    report.Findings.Add($"Unit {truck.Ref} is {sinceService - truck.ServiceIntervalMiles:N0} mi past its PM.");
            }

            driver.LifetimeMiles = Math.Round(driver.LifetimeMiles + line.Miles, 0);
            driver.LifetimeRevenue = Math.Round(driver.LifetimeRevenue + booked, 2);
            driver.LifetimeWages = Math.Round(driver.LifetimeWages + line.Wages, 2);
            driver.ReportsFiled++;

            // Level and rating are the driver's standing now, so they sit on the driver as well as in
            // the period: a trend needs the history, a decision needs the latest.
            if (line.Level > 0) driver.Level = line.Level;
            if (line.Rating > 0) driver.Rating = line.Rating;

            driver.Periods.Insert(0, new DriverPeriodResult
            {
                ReportNumber = report.Number,
                PeriodEndGame = report.PeriodEndGame,
                Revenue = booked,
                Miles = line.Miles,
                Wages = line.Wages,
                Repairs = line.Repairs,
                RatePerMile = line.Miles > 0 ? Math.Round(booked / (decimal)line.Miles, 3) : 0,
                Level = line.Level,
                Rating = line.Rating,
                PerMile = line.PerMile,
                PerDay = line.PerDay,
                // Only a period where the game figures were actually given can be evidence.
                GameFiguresReported = line.PerDay > 0 || line.PerMile > 0
            });
            if (driver.Periods.Count > 12) driver.Periods.RemoveRange(12, driver.Periods.Count - 12);

            // Repair spend is tracked against the unit, because that is what decides its trade date.
            if (truck != null && line.Repairs > 0)
                truck.LifetimeRepairCost = Math.Round(truck.LifetimeRepairCost + line.Repairs, 2);

            report.TotalRevenue += booked;
            report.TotalMiles += line.Miles;
            report.TotalWages += line.Wages;
            report.TotalRepairs += line.Repairs;
        }

        // Anything flagged for the shop gets a work order raised against it, so the notification is
        // an actual job in the maintenance queue rather than a line of text that scrolls away.
        foreach (var flag in report.RepairsNeeded)
        {
            var wo = MaintenanceService.OpenWorkOrder(s, new WorkOrder
            {
                Unit = flag.Unit,
                UnitKind = flag.UnitKind,
                Kind = "Damage",
                Description = $"Flagged on {report.Number} — {flag.DamagePct:0.#}% after {flag.DriverName}'s period.",
                DamageBefore = flag.DamagePct,
                DamageAfter = flag.DamagePct,
                Status = "Open",
                GameTime = report.PeriodEndGame
            });
            flag.WorkOrderNumber = wo.Number;
            if (flag.OutOfService)
            {
                var t = s.Trucks.FirstOrDefault(x => x.Unit == flag.Unit);
                if (t != null) t.Status = "OutOfService";
                var tr = s.Trailers.FirstOrDefault(x => x.Unit == flag.Unit);
                if (tr != null) tr.Status = "OutOfService";
            }
        }

        // Personnel and equipment decisions are resolved AFTER the numbers are posted, so they are made
        // on this period's figures rather than the last one's.
        ResolvePersonnel(s, report);
        AssessRetirements(s, report);
        // The company may also want another box somewhere. Occasional, and always an ask.
        TrailerFleet.Consider(s, report);

        report.NetContribution = Math.Round(report.TotalRevenue - report.TotalWages - report.TotalRepairs, 2);
        if (report.NetContribution < 0)
            report.Findings.Add("The hired fleet lost money this period. Check wages against what they actually brought in.");
        if (report.TotalMiles > 0 && report.TotalRevenue > 0)
            report.Findings.Add($"Fleet averaged ${report.TotalRevenue / (decimal)report.TotalMiles:0.00}/mi over {report.TotalMiles:N0} mi.");

        s.FleetReports.Insert(0, report);
        return report;
    }

    /// <summary>
    /// Probation, termination and resignation, resolved on this period's figures.
    ///
    /// Three ways this goes. A bad period puts a driver on <b>probation</b> — a carrier does not sack
    /// someone over one weak fortnight, it says what has to change and looks again next report. Fail
    /// probation, or land on it twice, and a <b>termination</b> is recommended with the documented
    /// history attached; it is the player's company, so they confirm it. And a driver may simply
    /// <b>resign</b>, which is applied on the spot because nobody asks permission to quit.
    ///
    /// The judgement is made on what ATS actually shows: $/day and $/mile. Level and rating are context
    /// for what to expect of them, not the verdict — a level 2 driver earning less than a level 9 is
    /// new, not failing.
    ///
    /// All of it is seeded on the driver and the report so reloading cannot re-roll an outcome.
    /// </summary>
    private static void ResolvePersonnel(AppState s, FleetReport report)
    {
        var active = s.HiredDrivers.Where(d => d.Status == "Active").ToList();
        if (active.Count == 0) return;

        // The bar is the fleet's own, not an absolute figure — it moves with the economy mod, the map
        // and the freight the player is running. Only periods where the player actually gave us the
        // game figures count toward it; an unreported period is missing data, not a zero.
        var reported = active
            .SelectMany(d => d.Periods.Where(x => x.GameFiguresReported))
            .ToList();
        var fleetPerDay = reported.Count > 0 ? reported.Average(x => x.PerDay) : 0m;
        var fleetPerMile = reported.Count > 0 ? reported.Average(x => x.PerMile) : 0m;

        foreach (var d in active)
        {
            var latest = d.Periods.FirstOrDefault();
            if (latest == null) continue;

            var judgeable = latest.GameFiguresReported && (fleetPerDay > 0 || fleetPerMile > 0);
            var why = "";
            var weak = judgeable && Underperforming(d, latest, fleetPerDay, fleetPerMile, out why);

            // ---- probation, or the end of it
            if (judgeable)
            {
                if (d.OnProbation && !weak)
                {
                    // Turned it around. That is worth saying, and it matters for the next decision:
                    // a driver who has recovered once is not the same case as one who never has.
                    d.ProbationSince = "";
                    d.ProbationReason = "";
                    d.ProbationTarget = "";
                    d.LastClearedProbationGameTime = report.PeriodEndGame;
                    report.Personnel.Add(new PersonnelChange
                    {
                        DriverId = d.Id, DriverName = d.Name, Kind = "ProbationLifted", Pending = false,
                        Headline = $"{d.Name} is off probation — the numbers came back.",
                        Evidence = { ProductionLine(latest, fleetPerDay, fleetPerMile) },
                        TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
                    });
                    continue;
                }

                if (weak && !d.OnProbation)
                {
                    // First bad period: a warning with a stated target, not a sacking. Probation with
                    // no number to beat is just a threat.
                    d.ProbationSince = report.PeriodEndGame;
                    d.ProbationCount++;
                    d.ProbationReason = why;
                    d.ProbationTarget = fleetPerDay > 0
                        ? $"$/day back above the ${fleetPerDay:N0} fleet average by the next report."
                        : $"$/mi back above the ${fleetPerMile:0.00} fleet average by the next report.";
                    report.Personnel.Add(new PersonnelChange
                    {
                        DriverId = d.Id, DriverName = d.Name, Kind = "Probation", Pending = false,
                        Headline = $"{d.Name} is on probation.",
                        Evidence = { why, d.ProbationTarget },
                        TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
                    });
                    continue;   // a warning this period, not also a resignation roll
                }

                // ---- failed probation: now there is a case, and it has history behind it
                if (weak && d.OnProbation)
                {
                    var evidence = new List<string> { why };
                    var priorEnd = GameClock.Pretty(d.ProbationSince);
                    evidence.Add($"Warned on {priorEnd} and told: {d.ProbationTarget}");
                    evidence.Add("The next period came in no better.");
                    if (d.ProbationCount > 1)
                        evidence.Add($"This is probation number {d.ProbationCount} for this driver.");
                    if (!string.IsNullOrWhiteSpace(d.LastClearedProbationGameTime))
                        evidence.Add($"They did recover once before, on {GameClock.Pretty(d.LastClearedProbationGameTime)}.");
                    var repairs = d.Periods.Take(3).Sum(x => x.Repairs);
                    if (repairs >= 3000m)
                        evidence.Add($"Also put ${repairs:N0} through the shop over the last three periods.");

                    report.Personnel.Add(new PersonnelChange
                    {
                        DriverId = d.Id, DriverName = d.Name, Kind = "Terminated", Pending = true,
                        Headline = $"{d.Name} failed probation. Recommend termination.",
                        Evidence = evidence,
                        TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
                    });
                    continue;
                }
            }

            // ---- or they just quit
            if (d.ReportsFiled < 2) continue;
            if (Hash($"{d.Id}|quit|{report.Number}") % 1000 >= ResignationChancePerMille(s, d)) continue;

            var change = new PersonnelChange
            {
                DriverId = d.Id, DriverName = d.Name, Kind = "Resigned", Pending = false,
                Headline = $"{d.Name} has handed their notice in.",
                TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
            };
            change.Evidence.Add(ResignationReason(s, d, report));
            change.Evidence.Add($"{d.ReportsFiled} period(s) with us, {d.LifetimeMiles:N0} mi, ${d.LifetimeRevenue:N0} brought in." +
                                (d.Level > 0 ? $" Level {d.Level}." : ""));
            report.Personnel.Add(change);
            Separate(s, d, "Resigned", change.Evidence[0]);
        }
    }

    /// <summary>
    /// Is this driver failing, on the figures the game actually gives us?
    ///
    /// $/day is the productivity number and $/mile is the rate number. Failing one badly, or both
    /// mildly, is the case. Level is context: a new driver is expected to produce less, so the bar
    /// scales down for them rather than punishing them for being new.
    /// </summary>
    private static bool Underperforming(HiredDriver d, DriverPeriodResult p,
        decimal fleetPerDay, decimal fleetPerMile, out string why)
    {
        why = "";

        // A developing driver is held to a lower bar. Level 1-3 is someone still learning the job.
        var allowance = d.Level > 0 && d.Level <= 3 ? 0.55m : 0.70m;
        var levelNote = d.Level > 0 && d.Level <= 3
            ? $" (allowing for a level {d.Level} driver still developing)"
            : d.Level > 0 ? $" at level {d.Level}" : "";

        var dayShort = fleetPerDay > 0 && p.PerDay > 0 && p.PerDay < fleetPerDay * allowance;
        var mileShort = fleetPerMile > 0 && p.PerMile > 0 && p.PerMile < fleetPerMile * allowance;

        if (dayShort && mileShort)
        {
            why = $"${p.PerDay:N0}/day and ${p.PerMile:0.00}/mi against fleet averages of " +
                  $"${fleetPerDay:N0} and ${fleetPerMile:0.00}{levelNote}.";
            return true;
        }
        if (dayShort)
        {
            why = $"${p.PerDay:N0}/day against a fleet average of ${fleetPerDay:N0}{levelNote}.";
            return true;
        }
        if (mileShort)
        {
            why = $"${p.PerMile:0.00}/mi against a fleet average of ${fleetPerMile:0.00}{levelNote}.";
            return true;
        }
        return false;
    }

    /// <summary>How the period's production reads, for saying why probation was lifted.</summary>
    private static string ProductionLine(DriverPeriodResult p, decimal fleetPerDay, decimal fleetPerMile) =>
        $"${p.PerDay:N0}/day and ${p.PerMile:0.00}/mi this period, against fleet averages of " +
        $"${fleetPerDay:N0} and ${fleetPerMile:0.00}.";

    /// <summary>
    /// The chance in a thousand that a driver quits this period.
    ///
    /// Two things drive it. A <b>developed driver</b> has options — level is what makes someone worth
    /// poaching, so losing one is a consequence of having built them up rather than bad luck. And a
    /// <b>weak employer</b> loses people faster: a five-star outfit holds onto its drivers, a two-star
    /// one trains them and watches them leave. That is what makes working up the carrier ladder worth
    /// something on the fleet side and not just on the player's own payslip.
    ///
    /// Capped deliberately. A high-level driver at a poor carrier should be a real risk, not a
    /// certainty — if the player cannot keep anybody the mechanic has stopped being interesting.
    /// </summary>
    public static int ResignationChancePerMille(AppState s, HiredDriver d)
    {
        var chance = 40.0;                                    // 4% baseline, as before

        // Level is open-ended in ATS. Every level above 3 adds risk, flattening out at the top end.
        var level = Math.Max(0, d.Level);
        if (level > 3) chance += Math.Min(90, (level - 3) * 11.0);

        // The employer's standing is the multiplier. Three stars is the neutral middle.
        var stars = s.Company.EmployerStars;
        if (stars > 0) chance *= Math.Clamp(1.0 + (3.0 - stars) * 0.35, 0.35, 2.1);

        // Someone the company is already unhappy with is likelier to read the room and go.
        if (d.OnProbation) chance *= 1.4;

        return (int)Math.Clamp(Math.Round(chance), 5, 200);    // never certain, never impossible
    }

    /// <summary>
    /// Whether a driver looks like a flight risk. Not a prediction of the roll — a fleet manager can
    /// see plainly that a developed driver at a weak carrier is not going to stay forever.
    /// </summary>
    public static string? FlightRisk(AppState s, HiredDriver d)
    {
        if (d.Status != "Active" || d.Level <= 4) return null;
        var chance = ResignationChancePerMille(s, d);
        if (chance < 80) return null;
        var stars = s.Company.EmployerStars;
        var employer = string.IsNullOrWhiteSpace(s.Company.Name) ? "this carrier" : s.Company.Name;
        return stars > 0 && stars < 3.5
            ? $"{d.Name} is level {d.Level} and {employer} rates {stars:0.#} stars as an employer. " +
              "Drivers that good do not stay at outfits that middling — expect to lose them."
            : $"{d.Name} is level {d.Level}. Developed drivers get approached; do not be surprised if they go.";
    }

    /// <summary>
    /// Drivers leave for reasons the office rarely learns. Seeded so it does not re-roll.
    ///
    /// Which reason fires should fit the driver and the employer. A developed driver walking out of a
    /// middling carrier went somewhere better, and saying so is the honest version of the story — it
    /// tells the player what the actual problem is.
    /// </summary>
    private static string ResignationReason(AppState s, HiredDriver d, FleetReport report)
    {
        var stars = s.Company.EmployerStars;
        var poached = d.Level >= 5 && stars > 0 && stars < 3.5;

        var reasons = poached
            ? new[]
            {
                "Went to a competitor for better miles.",
                "Took an offer from a carrier paying more per mile.",
                "Left for better equipment somewhere else.",
                "Poached — would not say by whom, but they did not haggle."
            }
            : new[]
            {
                "No reason given — took a job closer to home.",
                "Leaving the industry.",
                "Family reasons; did not want to discuss it.",
                "Went to a competitor for better miles.",
                "Retiring.",
                "No reason given."
            };
        return reasons[Hash($"{d.Id}|why|{report.Number}") % (uint)reasons.Length];
    }

    /// <summary>Takes a driver off the roster and frees their equipment, keeping their history.</summary>
    public static void Separate(AppState s, HiredDriver d, string kind, string reason)
    {
        // Resigned is its own status: OnLeave would read as "coming back", and they are not.
        d.Status = kind == "Terminated" ? "Terminated" : "Resigned";
        d.SeparationReason = reason;
        d.SeparatedGameTime = s.Status.GameTime;

        var truck = s.Trucks.FirstOrDefault(t => t.Unit == d.AssignedTruckUnit);
        if (truck != null && truck.AssignedDriver == d.Name) truck.AssignedDriver = "";
        var trailer = s.Trailers.FirstOrDefault(t => t.Unit == d.AssignedTrailerUnit);
        if (trailer != null && trailer.AssignedTruckUnit == d.AssignedTruckUnit) trailer.AssignedTruckUnit = "";

        d.AssignedTruckUnit = "";
        d.AssignedTrailerUnit = "";
    }

    /// <summary>Confirming a recommended termination. The player's call, not the app's.</summary>
    public static PersonnelChange Terminate(AppState s, string driverId, string reason)
    {
        var d = s.HiredDrivers.FirstOrDefault(x => x.Id == driverId)
                ?? throw new InvalidOperationException("No such hired driver.");
        if (d.Status != "Active") throw new InvalidOperationException($"{d.Name} is already {d.Status.ToLowerInvariant()}.");

        var change = new PersonnelChange
        {
            DriverId = d.Id, DriverName = d.Name, Kind = "Terminated", Pending = false,
            Headline = $"{d.Name} terminated.",
            TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
        };
        change.Evidence.Add(string.IsNullOrWhiteSpace(reason) ? "Performance." : reason);
        Separate(s, d, "Terminated", change.Evidence[0]);

        // Mark it resolved on the report that raised it, so the prompt stops nagging.
        foreach (var r in s.FleetReports)
            foreach (var p in r.Personnel.Where(p => p.DriverId == driverId && p.Pending))
            { p.Pending = false; p.Headline = change.Headline; }

        return change;
    }

    /// <summary>
    /// Equipment past its useful life.
    ///
    /// A unit is not retired on mileage alone — a high-mileage truck that is not costing anything is
    /// still earning. It takes mileage plus money, or damage that keeps coming back after repair.
    /// Nothing is retired automatically: the player has to buy the replacement in ATS, so the app can
    /// only make the case.
    /// </summary>
    private static void AssessRetirements(AppState s, FleetReport report)
    {
        foreach (var t in s.Trucks.Where(t => !t.Retired && t.InGameGarage))
        {
            // Never retire a unit that is out on a load.
            if (s.Trips.Any(x => x.Status is "Authorized" or "InTransit" && x.TruckUnit == t.Unit)) continue;

            var driver = s.HiredDrivers.FirstOrDefault(d => d.AssignedTruckUnit == t.Unit && d.Status == "Active");
            var isMine = t.Unit == s.Driver.AssignedTruckUnit;

            var evidence = new List<string>();
            var high = t.ServiceMiles >= 700_000;
            var costly = t.LifetimeRepairCost >= 12_000m;

            // Condition reads differently depending on who is in the seat. The player's own tractor has
            // a damage percentage because they can see the repair screen; a hired driver's unit has a
            // star rating and nothing else, because that is all ATS shows for it.
            var starLimit = s.Settings.Maintenance.TruckReplaceStars;
            var wornOut = !isMine && t.Stars > 0 && t.Stars <= starLimit;
            var beaten = isMine && t.DamagePct >= s.Settings.Maintenance.MandatoryReviewPct;

            if (high) evidence.Add($"{t.ServiceMiles:N0} company-service miles.");
            if (costly) evidence.Add($"${t.LifetimeRepairCost:N0} in repairs against it.");
            if (beaten) evidence.Add($"Sitting at {t.DamagePct:0.#}% damage.");
            if (wornOut) evidence.Add($"Down to {t.Stars:0.#} stars — at or under our {starLimit:0.#}-star replacement line.");

            // Stars at the limit are reason enough on their own for a hired driver's unit: that is the
            // company's stated line, and the odometer and repair spend go alongside as the supporting
            // case. Everything else needs two reasons, because mileage alone is a well-used truck.
            if (!wornOut && evidence.Count < 2) continue;
            if (wornOut)
            {
                if (t.AtsOdometer > 0) evidence.Add($"Odometer reads {t.AtsOdometer:N0}.");
                if (!high && !costly)
                    evidence.Add(t.LifetimeRepairCost > 0
                        ? $"${t.LifetimeRepairCost:N0} spent on it so far — replace it before that climbs."
                        : "Nothing serious spent on it yet, and that is the point of going now.");
            }
            var spare = BestSpare(s, t);

            // Your own truck goes to trade like anyone else's — the company just puts you in another.
            if (isMine)
                evidence.Add(spare != null
                    ? $"There is a spare on the property: unit {spare.Ref} ({spare.Year} {spare.Make} {spare.Model}, " +
                      $"{spare.ServiceMiles:N0} mi). Report to the yard and we will move you into it."
                    : $"Nothing spare on the property. Buy the replacement in ATS: {Seed.RecommendedTruck(s)}");
            else if (spare == null)
                evidence.Add($"No spare to replace it with. What to buy: {Seed.RecommendedTruck(s)}");

            report.Retirements.Add(new RetirementRecommendation
            {
                Unit = t.Unit,
                UnitKind = "Truck",
                Headline = isMine
                    ? $"Unit {t.Ref} ({t.Year} {t.Make} {t.Model}) — your own truck — is due for trade."
                    : wornOut
                        ? $"Unit {t.Ref} ({t.Year} {t.Make} {t.Model}) is down to {t.Stars:0.#} stars. Recommend selling it and replacing it."
                        : $"Unit {t.Ref} ({t.Year} {t.Make} {t.Model}) has done its time. Recommend trading it.",
                Evidence = evidence,
                ServiceMiles = t.ServiceMiles,
                RepairSpend = t.LifetimeRepairCost,
                DamagePct = t.DamagePct,
                AssignedTo = t.Unit == s.Driver.AssignedTruckUnit ? s.Driver.Name : driver?.Name ?? "",
                IsPlayerUnit = t.Unit == s.Driver.AssignedTruckUnit
            });
        }

        AssessTrailers(s, report);
    }

    /// <summary>
    /// Trailers due for replacement.
    ///
    /// A trailer has a star rating and no odometer, so the signals are different from a tractor's:
    /// stars where they have dropped, and <b>age</b> where they have not. Whether trailer stars ever
    /// actually fall in ATS is not certain, which is exactly why age has to stand on its own — an old
    /// box still earning is fine, an old box earning nothing is the one to get rid of.
    ///
    /// The player's own trailer is never touched here. Telling someone mid-lane that the box behind
    /// them is being swapped is confusing and they cannot act on it anyway; their trailer changes at
    /// home time, where they are parked at the yard and can actually do it. See HomeTime.
    /// </summary>
    private static void AssessTrailers(AppState s, FleetReport report)
    {
        var m = s.Settings.Maintenance;
        var now = GameClock.TryParse(report.PeriodEndGame) ?? GameClock.TryParse(s.Status.GameTime);

        foreach (var tr in s.Trailers.Where(x => !x.Retired && x.InGameGarage))
        {
            // Hands off the one the player is pulling.
            if (tr.Unit == s.Driver.AssignedTrailerUnit) continue;
            if (s.Trips.Any(x => x.Status is "Authorized" or "InTransit" && x.TrailerUnit == tr.Unit)) continue;

            var holder = s.HiredDrivers.FirstOrDefault(d => d.AssignedTrailerUnit == tr.Unit && d.Status == "Active");

            var starsGone = tr.Stars > 0 && tr.Stars <= m.TrailerReplaceStars;

            double? ageYears = null;
            if (now != null && GameClock.TryParse(tr.AcquiredGameTime) is { } got)
                ageYears = (now.Value - got).TotalDays / 365.0;
            var old = ageYears is { } a && a >= m.TrailerOldYears;

            // Productivity of whoever is on it. An old trailer under a driver who is doing fine is not
            // a problem to solve — it is a trailer doing its job.
            var unproductive = false;
            var latest = holder?.Periods.FirstOrDefault();
            if (latest is { GameFiguresReported: true, PerDay: > 0 })
            {
                var fleetDay = s.HiredDrivers
                    .SelectMany(d => d.Periods)
                    .Where(x => x.GameFiguresReported && x.PerDay > 0)
                    .Select(x => x.PerDay)
                    .DefaultIfEmpty(0m)
                    .Average();
                unproductive = fleetDay > 0 && latest.PerDay < fleetDay * 0.7m;
            }

            if (!starsGone && !(old && unproductive)) continue;

            var evidence = new List<string>();
            var reason = starsGone ? "condition" : "age and production";

            if (starsGone)
                evidence.Add($"Down to {tr.Stars:0.#} stars — at or under our {m.TrailerReplaceStars:0.#}-star line.");
            if (ageYears is { } yrs)
                evidence.Add($"About {yrs:0.#} years in the fleet.");
            if (old && unproductive)
                evidence.Add("Old, and what it is pulling is not paying. Either reason alone would be fine; together they are not.");
            if (holder != null) evidence.Add($"Currently under {holder.Name}.");
            evidence.Add($"Replace with the same {tr.Type.ToLowerInvariant()}, or re-rig for whatever the lane is actually offering — " +
                         "buy it in ATS and confirm it here.");

            report.Retirements.Add(new RetirementRecommendation
            {
                Unit = tr.Unit,
                UnitKind = "Trailer",
                Headline = starsGone
                    ? $"Trailer {tr.Ref} ({tr.Type}) is down to {tr.Stars:0.#} stars. Recommend replacing it."
                    : $"Trailer {tr.Ref} ({tr.Type}) is old and not earning. Worth replacing.",
                Evidence = evidence,
                ServiceMiles = tr.ServiceMiles,
                DamagePct = 0,
                AssignedTo = holder?.Name ?? "",
                IsPlayerUnit = false
            });

            report.Findings.Add($"Trailer {tr.Ref}: replacement recommended on {reason}.");
        }
    }

    /// <summary>
    /// Retires a unit once the player has actually replaced it in ATS. History stays attached to the
    /// trips that used it — the record should survive the truck.
    /// </summary>
    public static string RetireUnit(AppState s, string unit, string replacementUnit)
    {
        var t = s.Trucks.FirstOrDefault(x => x.Unit.Equals(unit, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"Unit {unit} is not in the fleet.");
        if (s.Trips.Any(x => x.Status is "Authorized" or "InTransit" && x.TruckUnit == t.Unit))
            throw new InvalidOperationException($"Unit {t.Ref} is on an open load.");

        var messages = new List<string>();
        var driverName = t.AssignedDriver;

        // Nobody is left standing at the roadside. If no replacement was named, the company issues one
        // out of the yard — that is what a real carrier does when your truck goes to auction. Only if
        // the property is genuinely empty does the player have to go and buy one.
        if (string.IsNullOrWhiteSpace(replacementUnit))
            replacementUnit = BestSpare(s, t)?.Unit ?? "";

        if (!string.IsNullOrWhiteSpace(replacementUnit))
        {
            var rep = s.Trucks.FirstOrDefault(x => x.Unit.Equals(replacementUnit, StringComparison.OrdinalIgnoreCase))
                      ?? throw new InvalidOperationException($"Unit {replacementUnit} is not on the book yet — add it on the Fleet tab first.");
            rep.HomeTerminalId = string.IsNullOrWhiteSpace(rep.HomeTerminalId) ? t.HomeTerminalId : rep.HomeTerminalId;

            // Whoever was in the old truck takes the new one.
            if (t.Unit == s.Driver.AssignedTruckUnit)
            {
                s.Driver.AssignedTruckUnit = rep.Unit;
                rep.AssignedDriver = s.Driver.Name;
                rep.InGameGarage = true;
                s.Status.TruckDamagePct = rep.DamagePct;
                s.Status.AtsOdometer = rep.AtsOdometer;
                messages.Add($"You are now in unit {rep.Ref} ({rep.Year} {rep.Make} {rep.Model}).");
            }
            else
            {
                var hired = s.HiredDrivers.FirstOrDefault(d => d.AssignedTruckUnit == t.Unit);
                if (hired != null)
                {
                    hired.AssignedTruckUnit = rep.Unit;
                    rep.AssignedDriver = hired.Name;
                    rep.InGameGarage = true;
                    messages.Add($"{hired.Name} moves into unit {rep.Ref}.");
                }
            }
        }
        else if (t.Unit == s.Driver.AssignedTruckUnit)
        {
            throw new InvalidOperationException(
                $"Unit {t.Ref} is the truck you are in and there is no spare on the property to put you in. " +
                "Buy the replacement in ATS, add it on the Fleet tab, then retire this one against it.");
        }

        t.Retired = true;
        t.Status = "Reserve";
        t.AssignedDriver = "";
        t.RetiredGameTime = s.Status.GameTime;
        messages.Insert(0, $"Unit {t.Ref} retired at {t.ServiceMiles:N0} mi" +
                           (t.LifetimeRepairCost > 0 ? $" and ${t.LifetimeRepairCost:N0} of repairs" : "") + ".");
        if (!string.IsNullOrWhiteSpace(driverName) && string.IsNullOrWhiteSpace(replacementUnit))
            messages.Add($"{driverName} has no unit — assign one or they are stood down.");
        return string.Join(" ", messages);
    }

    /// <summary>
    /// The best unit standing idle that could replace one going to trade. Prefers the same yard, then
    /// the newest, lowest-mileage tractor nobody is in.
    /// </summary>
    private static Truck? BestSpare(AppState s, Truck replacing) =>
        s.Trucks
            .Where(x => !x.Retired && x.Unit != replacing.Unit)
            .Where(x => x.Status is "InService" or "Reserve")
            .Where(x => x.Unit != s.Driver.AssignedTruckUnit)
            .Where(x => !s.HiredDrivers.Any(d => d.Status == "Active" && d.AssignedTruckUnit == x.Unit))
            .OrderByDescending(x => x.HomeTerminalId == replacing.HomeTerminalId)
            .ThenByDescending(x => x.Year)
            .ThenBy(x => x.ServiceMiles)
            .FirstOrDefault();

    /// <summary>
    /// A truck with nobody in it, and what the company can honestly do about it. Presented as a
    /// decision rather than left for the player to work out.
    /// </summary>
    public static List<object> OpenUnitDecisions(AppState s)
    {
        var open = s.Trucks
            .Where(t => !t.Retired && t.Status != "OutOfService")
            .Where(t => t.Unit != s.Driver.AssignedTruckUnit)
            .Where(t => !s.HiredDrivers.Any(d => d.Status == "Active"
                        && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        if (open.Count == 0) return new List<object>();

        var position = LedgerService.Position(s);
        var playerTruck = DispatchEngine.AssignedTruck(s);

        return open.Select(t =>
        {
            var yard = Migrations.TerminalOf(s, t.HomeTerminalId);
            // Hiring costs money in ATS that the app cannot see, so judge on what is spendable and say
            // the real price is in the game.
            var canAfford = position.Spendable >= 15_000m;
            var better = playerTruck != null && (t.Year > playerTruck.Year || t.ServiceMiles < playerTruck.ServiceMiles * 0.6);

            return (object)new
            {
                unit = t.Unit,
                spec = $"{t.Year} {t.Make} {t.Model}",
                serviceMiles = t.ServiceMiles,
                damagePct = t.DamagePct,
                yard = yard == null ? "" : DispatchEngine.Place(yard.City, yard.State),
                canAfford,
                betterThanYours = better,
                hireNote = canAfford
                    ? $"Spendable cash is ${position.Spendable:N0}. Hire someone in ATS and add them on this tab."
                    : $"Only ${position.Spendable:N0} spendable after earmarks and wages owed — the company cannot really carry another driver yet.",
                takeNote = better
                    ? $"It is a better truck than the {playerTruck!.Year} {playerTruck.Make} you are in. Taking it is a genuine upgrade."
                    : "You could take it yourself, though it is no better than what you are in.",
                parkNote = "Leave it standing. It earns nothing, but it costs nothing to run either.",
                buyNote = $"If you would rather put a better unit in the seat: {Seed.RecommendedTruck(s)}"
            };
        }).ToList();
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }

    /// <summary>
    /// Whether operations is waiting on fleet numbers. The hired fleet runs whether or not the
    /// player thinks about it, so the ask is on a game-day cycle rather than on demand.
    /// </summary>
    public static FleetReportDue DueCheck(AppState s)
    {
        var due = new FleetReportDue { IntervalDays = Math.Max(1, s.Settings.FleetReportIntervalDays) };
        if (s.HiredDrivers.Count(d => d.Status == "Active") == 0) return due;

        var now = GameClock.TryParse(s.Status.GameTime);
        if (now == null) return due;

        // Count from the last report, or from when the first driver was taken on.
        var lastEnd = GameClock.TryParse(s.FleetReports.FirstOrDefault()?.PeriodEndGame)
                      ?? s.HiredDrivers.Where(d => d.Status == "Active")
                           .Select(d => GameClock.TryParse(d.HiredGameDate))
                           .Where(d => d != null).OrderBy(d => d).FirstOrDefault();
        if (lastEnd == null) return due;

        due.LastPeriodEnd = GameClock.Format(lastEnd.Value);
        due.DaysSince = Math.Round((now.Value - lastEnd.Value).TotalDays, 1);
        due.DaysRemaining = Math.Round(due.IntervalDays - due.DaysSince, 1);
        due.NextDueGameTime = GameClock.Format(lastEnd.Value.AddDays(due.IntervalDays));
        due.IsDue = due.DaysSince >= due.IntervalDays;
        due.IsSoon = !due.IsDue && due.DaysRemaining <= 3;

        if (due.IsDue)
            due.Message = $"Fleet report is due — {due.DaysSince:0.#} game days since the last one. " +
                          "Open the ATS company screen and bring me each driver's earnings and their " +
                          "truck and trailer damage.";
        else if (due.IsSoon)
            due.Message = $"Fleet report due in {due.DaysRemaining:0.#} day(s) (Day {GameClock.DayOf(GameClock.TryParse(due.NextDueGameTime)!.Value)}).";
        return due;
    }

    public static FleetOpsSummary Summary(AppState s)
    {
        var active = s.HiredDrivers.Where(d => d.Status == "Active").ToList();
        return new FleetOpsSummary
        {
            Due = DueCheck(s),
            DriverCount = s.HiredDrivers.Count,
            ActiveCount = active.Count,
            LifetimeRevenue = s.HiredDrivers.Sum(d => d.LifetimeRevenue),
            LifetimeWages = s.HiredDrivers.Sum(d => d.LifetimeWages),
            LifetimeMiles = s.HiredDrivers.Sum(d => d.LifetimeMiles),
            ReportCount = s.FleetReports.Count,
            LastPeriodEnd = s.FleetReports.FirstOrDefault()?.PeriodEndGame ?? "",
            UnassignedUnits = s.Trucks
                .Where(t => t.Unit != s.Driver.AssignedTruckUnit
                            && !s.HiredDrivers.Any(d => d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase)))
                .Select(t => t.Unit).ToList(),
            OnProbation = active.Where(d => d.OnProbation).Select(d => new ProbationView
            {
                DriverId = d.Id,
                DriverName = d.Name,
                Since = d.ProbationSince,
                Reason = d.ProbationReason,
                Target = d.ProbationTarget,
                Attempt = d.ProbationCount
            }).ToList(),
            // A fleet manager can see plainly that a developed driver at a middling outfit will not
            // stay. Not a prediction of the roll — just the observation.
            FlightRisks = active.Select(d => FlightRisk(s, d)).Where(x => x != null).Select(x => x!).ToList(),
            EmployerStars = s.Company.EmployerStars,
            TrailerRequest = TrailerFleet.Open(s)
        };
    }
}

public class FleetReportDue
{
    public bool IsDue { get; set; }
    public bool IsSoon { get; set; }
    public int IntervalDays { get; set; } = 15;
    public double DaysSince { get; set; }
    public double DaysRemaining { get; set; }
    public string LastPeriodEnd { get; set; } = "";
    public string NextDueGameTime { get; set; } = "";
    public string Message { get; set; } = "";
}

/// <summary>A driver on notice, and what they have to do about it.</summary>
public class ProbationView
{
    public string DriverId { get; set; } = "";
    public string DriverName { get; set; } = "";
    public string Since { get; set; } = "";
    public string Reason { get; set; } = "";
    public string Target { get; set; } = "";
    /// <summary>How many times they have been here. A repeat is a different case to a first.</summary>
    public int Attempt { get; set; }
}

public class FleetOpsSummary
{
    public FleetReportDue Due { get; set; } = new();
    public int DriverCount { get; set; }
    public int ActiveCount { get; set; }
    public decimal LifetimeRevenue { get; set; }
    public decimal LifetimeWages { get; set; }
    public double LifetimeMiles { get; set; }
    public int ReportCount { get; set; }
    public string LastPeriodEnd { get; set; } = "";
    public List<string> UnassignedUnits { get; set; } = new();
    /// <summary>Drivers currently on notice after a weak period.</summary>
    public List<ProbationView> OnProbation { get; set; } = new();
    /// <summary>Drivers good enough that a better carrier will come for them.</summary>
    public List<string> FlightRisks { get; set; } = new();
    /// <summary>How this carrier rates as an employer, 1-5. Retention hangs off it.</summary>
    public double EmployerStars { get; set; }
    /// <summary>An outstanding request to buy a trailer, if there is one.</summary>
    public TrailerRequest? TrailerRequest { get; set; }
}
