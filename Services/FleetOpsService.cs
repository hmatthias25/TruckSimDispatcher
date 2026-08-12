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

        report.NetContribution = Math.Round(report.TotalRevenue - report.TotalWages - report.TotalRepairs, 2);
        if (report.NetContribution < 0)
            report.Findings.Add("The hired fleet lost money this period. Check wages against what they actually brought in.");
        if (report.TotalMiles > 0 && report.TotalRevenue > 0)
            report.Findings.Add($"Fleet averaged ${report.TotalRevenue / (decimal)report.TotalMiles:0.00}/mi over {report.TotalMiles:N0} mi.");

        s.FleetReports.Insert(0, report);
        return report;
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
