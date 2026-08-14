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

            // Trailer condition, where the driver is on a company trailer.
            if (string.IsNullOrWhiteSpace(line.TrailerUnit)) line.TrailerUnit = driver.AssignedTrailerUnit;
            var trailer = s.Trailers.FirstOrDefault(t => t.Unit == line.TrailerUnit);
            if (trailer != null && line.TrailerDamagePctAfter > 0)
            {
                trailer.DamagePct = line.TrailerDamagePctAfter;
                trailer.ServiceMiles = Math.Round(trailer.ServiceMiles + line.Miles, 0);
                trailer.InGameGarage = true;
                var (tStatus, tDirective) = MaintenanceService.Assess(s.Settings, trailer.DamagePct, $"Trailer {trailer.Unit}");
                if (tStatus is "MandatoryReview" or "OutOfService")
                {
                    report.Findings.Add($"{driver.Name}: {tDirective}");
                    report.RepairsNeeded.Add(new RepairFlag
                    {
                        Unit = trailer.Unit, UnitKind = "Trailer", DriverName = driver.Name,
                        DamagePct = trailer.DamagePct, Directive = tDirective,
                        OutOfService = tStatus == "OutOfService"
                    });
                }
            }

            // Equipment condition and mileage come from the game reading.
            var truck = s.Trucks.FirstOrDefault(t => t.Unit == line.TruckUnit);
            if (truck != null)
            {
                var before = truck.DamagePct;
                truck.ServiceMiles = Math.Round(truck.ServiceMiles + line.Miles, 0);
                truck.AtsOdometer = Math.Round(truck.AtsOdometer + line.Miles, 0);
                truck.DamagePct = line.DamagePctAfter;
                truck.InGameGarage = true;

                var (status, directive) = MaintenanceService.Assess(s.Settings, truck.DamagePct, $"Unit {truck.Unit}");
                if (status != "Monitor") report.Findings.Add($"{driver.Name}: {directive}");
                if (status is "MandatoryReview" or "OutOfService")
                    report.RepairsNeeded.Add(new RepairFlag
                    {
                        Unit = truck.Unit, UnitKind = "Truck", DriverName = driver.Name,
                        DamagePct = truck.DamagePct, Directive = directive,
                        OutOfService = status == "OutOfService"
                    });
                if (line.DamagePctAfter - before >= 10)
                    report.Findings.Add($"{driver.Name} put {line.DamagePctAfter - before:0.#} points on unit {truck.Unit} this period.");

                var sinceService = truck.ServiceMiles - truck.LastServiceMiles;
                if (sinceService >= truck.ServiceIntervalMiles)
                    report.Findings.Add($"Unit {truck.Unit} is {sinceService - truck.ServiceIntervalMiles:N0} mi past its PM.");
            }

            driver.LifetimeMiles = Math.Round(driver.LifetimeMiles + line.Miles, 0);
            driver.LifetimeRevenue = Math.Round(driver.LifetimeRevenue + booked, 2);
            driver.LifetimeWages = Math.Round(driver.LifetimeWages + line.Wages, 2);
            driver.ReportsFiled++;
            driver.Periods.Insert(0, new DriverPeriodResult
            {
                ReportNumber = report.Number,
                PeriodEndGame = report.PeriodEndGame,
                Revenue = booked,
                Miles = line.Miles,
                Wages = line.Wages,
                Repairs = line.Repairs,
                DamageAfter = line.DamagePctAfter,
                RatePerMile = line.Miles > 0 ? Math.Round(booked / (decimal)line.Miles, 3) : 0
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

        report.NetContribution = Math.Round(report.TotalRevenue - report.TotalWages - report.TotalRepairs, 2);
        if (report.NetContribution < 0)
            report.Findings.Add("The hired fleet lost money this period. Check wages against what they actually brought in.");
        if (report.TotalMiles > 0 && report.TotalRevenue > 0)
            report.Findings.Add($"Fleet averaged ${report.TotalRevenue / (decimal)report.TotalMiles:0.00}/mi over {report.TotalMiles:N0} mi.");

        s.FleetReports.Insert(0, report);
        return report;
    }

    /// <summary>
    /// Who is leaving, and why.
    ///
    /// Two ways out. A driver who has produced badly for several periods running gets a termination
    /// RECOMMENDED with the figures attached — it is the player's company, so they confirm it. A
    /// driver may also simply resign, occasionally and without notice, which is what actually happens
    /// in a fleet; that one is applied on the spot.
    ///
    /// Both are seeded on the driver and the report so reloading cannot re-roll the outcome.
    /// </summary>
    private static void ResolvePersonnel(AppState s, FleetReport report)
    {
        var active = s.HiredDrivers.Where(d => d.Status == "Active").ToList();
        if (active.Count == 0) return;

        // The bar is the fleet's own average, not an absolute figure — it moves with the economy mod,
        // the map and the freight the player is running.
        var fleetRpm = report.TotalMiles > 0 ? report.TotalRevenue / (decimal)report.TotalMiles : 0;

        foreach (var d in active)
        {
            var recent = d.Periods.Take(3).ToList();
            if (recent.Count == 0) continue;

            // ---- the case for termination
            if (recent.Count >= 3 && fleetRpm > 0)
            {
                var avgRpm = recent.Average(p => p.RatePerMile);
                var repairs = recent.Sum(p => p.Repairs);
                var damage = recent.Max(p => p.DamageAfter);
                var evidence = new List<string>();

                if (avgRpm < fleetRpm * 0.7m)
                    evidence.Add($"Averaged ${avgRpm:0.00}/mi over {recent.Count} periods against a fleet average of ${fleetRpm:0.00}.");
                if (repairs >= 3000m)
                    evidence.Add($"Put ${repairs:N0} through the shop in that time.");
                if (damage >= s.Settings.Maintenance.MandatoryReviewPct)
                    evidence.Add($"Handed the truck back at {damage:0.#}% damage.");

                if (evidence.Count >= 2)
                {
                    report.Personnel.Add(new PersonnelChange
                    {
                        DriverId = d.Id, DriverName = d.Name, Kind = "Terminated", Pending = true,
                        Headline = $"{d.Name} is not carrying their unit. Recommend termination.",
                        Evidence = evidence,
                        TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
                    });
                    continue;   // do not also roll them for resignation
                }
            }

            // ---- or they just quit
            // Deliberately uncommon: roughly one period in fourteen, and never in a driver's first.
            if (d.ReportsFiled < 2) continue;
            if (Hash($"{d.Id}|quit|{report.Number}") % 100 >= 7) continue;

            var change = new PersonnelChange
            {
                DriverId = d.Id, DriverName = d.Name, Kind = "Resigned", Pending = false,
                Headline = $"{d.Name} has handed their notice in.",
                TruckUnit = d.AssignedTruckUnit, TrailerUnit = d.AssignedTrailerUnit
            };
            change.Evidence.Add(ResignationReason(d, report));
            change.Evidence.Add($"{d.ReportsFiled} period(s) with us, {d.LifetimeMiles:N0} mi, ${d.LifetimeRevenue:N0} brought in.");
            report.Personnel.Add(change);
            Separate(s, d, "Resigned", change.Evidence[0]);
        }
    }

    /// <summary>Drivers leave for reasons the office rarely learns. Seeded so it does not re-roll.</summary>
    private static string ResignationReason(HiredDriver d, FleetReport report)
    {
        var reasons = new[]
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

            var evidence = new List<string>();
            var high = t.ServiceMiles >= 700_000;
            var costly = t.LifetimeRepairCost >= 12_000m;
            var beaten = t.DamagePct >= s.Settings.Maintenance.MandatoryReviewPct;

            if (high) evidence.Add($"{t.ServiceMiles:N0} company-service miles.");
            if (costly) evidence.Add($"${t.LifetimeRepairCost:N0} in repairs against it.");
            if (beaten) evidence.Add($"Sitting at {t.DamagePct:0.#}% damage.");

            // Two reasons, not one. Mileage on its own is just a well-used truck.
            if (evidence.Count < 2) continue;

            var driver = s.HiredDrivers.FirstOrDefault(d => d.AssignedTruckUnit == t.Unit && d.Status == "Active");
            var isMine = t.Unit == s.Driver.AssignedTruckUnit;
            var spare = BestSpare(s, t);

            // Your own truck goes to trade like anyone else's — the company just puts you in another.
            if (isMine)
                evidence.Add(spare != null
                    ? $"There is a spare on the property: unit {spare.Unit} ({spare.Year} {spare.Make} {spare.Model}, " +
                      $"{spare.ServiceMiles:N0} mi). Report to the yard and we will move you into it."
                    : $"Nothing spare on the property. Buy the replacement in ATS: {Seed.RecommendedTruck(s)}");
            else if (spare == null)
                evidence.Add($"No spare to replace it with. What to buy: {Seed.RecommendedTruck(s)}");

            report.Retirements.Add(new RetirementRecommendation
            {
                Unit = t.Unit,
                UnitKind = "Truck",
                Headline = isMine
                    ? $"Unit {t.Unit} ({t.Year} {t.Make} {t.Model}) — your own truck — is due for trade."
                    : $"Unit {t.Unit} ({t.Year} {t.Make} {t.Model}) has done its time. Recommend trading it.",
                Evidence = evidence,
                ServiceMiles = t.ServiceMiles,
                RepairSpend = t.LifetimeRepairCost,
                DamagePct = t.DamagePct,
                AssignedTo = t.Unit == s.Driver.AssignedTruckUnit ? s.Driver.Name : driver?.Name ?? "",
                IsPlayerUnit = t.Unit == s.Driver.AssignedTruckUnit
            });
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
            throw new InvalidOperationException($"Unit {t.Unit} is on an open load.");

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
                messages.Add($"You are now in unit {rep.Unit} ({rep.Year} {rep.Make} {rep.Model}).");
            }
            else
            {
                var hired = s.HiredDrivers.FirstOrDefault(d => d.AssignedTruckUnit == t.Unit);
                if (hired != null)
                {
                    hired.AssignedTruckUnit = rep.Unit;
                    rep.AssignedDriver = hired.Name;
                    rep.InGameGarage = true;
                    messages.Add($"{hired.Name} moves into unit {rep.Unit}.");
                }
            }
        }
        else if (t.Unit == s.Driver.AssignedTruckUnit)
        {
            throw new InvalidOperationException(
                $"Unit {t.Unit} is the truck you are in and there is no spare on the property to put you in. " +
                "Buy the replacement in ATS, add it on the Fleet tab, then retire this one against it.");
        }

        t.Retired = true;
        t.Status = "Reserve";
        t.AssignedDriver = "";
        t.RetiredGameTime = s.Status.GameTime;
        messages.Insert(0, $"Unit {t.Unit} retired at {t.ServiceMiles:N0} mi" +
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
                .Select(t => t.Unit).ToList()
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
}
