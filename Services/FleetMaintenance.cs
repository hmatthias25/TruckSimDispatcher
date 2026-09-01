using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Scheduled maintenance on the tractors hired drivers run.
///
/// These units raised the same "PM overdue by 11,400 mi" alert the player's own truck raises, and the
/// player could do nothing about it: ATS gives you no way to take a hired driver's truck to a shop. An
/// alert nobody can act on is worse than no alert, because it teaches the player to skip the panel where
/// the alerts that DO matter live.
///
/// The first cut put two buttons on it — service it, or defer it — and that was wrong for a reason worth
/// writing down. <b>The player is a driver.</b> Probation, reviews, discipline, home time: the whole app
/// rests on their being an employee of a carrier with standards. An employee does not authorise the
/// company's capital spending and does not defer its maintenance. An approve/defer pair handed them an
/// authority the rest of the app spends its time telling them they have not got — and once deferring is
/// off the table, approving is not a decision either, because the answer is always yes.
///
/// So the company services its own fleet, at the fleet report, which is already where fleet mileage
/// updates and fleet money moves. Deferring still happens; the company does it, when the balance is
/// thin, and the player reads about it in the findings rather than choosing it.
///
/// Two facts shape the rest. The app cannot make ATS do anything, so it must never claim a truck was off
/// the road for a routine service — the game would contradict it the next time they opened the driver
/// manager. Money is the opposite: the app IS the books, and hired-driver repairs already post to the
/// ledger off this same report.
/// </summary>
public static class FleetMaintenance
{
    /// <summary>Labour and parts for a routine service, before anything is found.</summary>
    public const decimal BasePmCost = 900m;

    /// <summary>Added per 100,000 miles on the clock. Old units cost more to keep, which is the point.</summary>
    public const decimal CostPerHundredThousand = 240m;

    /// <summary>
    /// Operating cash the company will not service below.
    ///
    /// A carrier that serviced itself into an empty account would be a worse carrier, so a thin period
    /// holds the work over. That is the company's call, and the player is told it was made.
    /// </summary>
    public const decimal ReserveFloor = 5000m;

    /// <summary>Each time the company holds a service over, this much is added to the odds of a find.</summary>
    public const int FindChancePerDeferral = 9;

    /// <summary>Miles past the interval that count as neglect, per percentage point of find chance.</summary>
    public const double OverdueMilesPerPoint = 4000;

    /// <summary>The worst it gets, however old and neglected. Something must always be able to go right.</summary>
    public const int MaxFindChance = 55;

    /// <summary>Odometer past which a find is more likely to be terminal than expensive.</summary>
    public const double HighMileage = 700_000;

    /// <summary>A found fault costs this many times the routine service.</summary>
    public const decimal MajorRepairMultiple = 6m;

    /// <summary>Trucks a hired driver is running that the company owes a service.</summary>
    public static List<Truck> DueUnits(AppState s) =>
        s.Trucks.Where(t => IsHiredUnit(s, t) && NeedsService(s, t)).ToList();

    /// <summary>
    /// Whether a unit owes work at all, on whichever schedule is in force.
    ///
    /// Separate from <see cref="DueBy"/>, which measures the <i>overrun</i>. A checkpoint sitting
    /// exactly on its interval is due and is nought miles past due, and gating the report on the
    /// overrun let those units through — the alert panel said the work was due, the report never did
    /// it, and the alert was still there afterwards.
    /// </summary>
    public static bool NeedsService(AppState s, Truck t) =>
        ServicePlan.GdcActive(s)
            ? ServicePlan.DueNow(s, t).Count > 0
            : t.ServiceMiles - t.LastServiceMiles >= t.ServiceIntervalMiles;

    /// <summary>How far past due a unit is, on whichever schedule is in force.</summary>
    public static double DueBy(AppState s, Truck t) =>
        ServicePlan.GdcActive(s) ? GdcMilesPastDue(s, t) : MilesPastDue(t);

    /// <summary>Whether an active hired driver is running this unit.</summary>
    public static bool IsHiredUnit(AppState s, Truck t) =>
        !t.Retired && t.Status != "Retired" && t.Status != "OutOfService"
        && s.HiredDrivers.Any(d => d.Status == "Active"
                                   && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));

    /// <summary>How far past the service interval, or 0 when it is not due.</summary>
    public static double MilesPastDue(Truck t) =>
        Math.Max(0, (t.ServiceMiles - t.LastServiceMiles) - t.ServiceIntervalMiles);

    /// <summary>
    /// How far past due on the GDC schedule: the worst overrun of any checkpoint.
    ///
    /// A unit is as overdue as its most neglected checkpoint. Averaging them would let a truck two
    /// hundred thousand miles past its driveline service read as fine because its tyres were done.
    /// </summary>
    public static double GdcMilesPastDue(AppState s, Truck t)
    {
        var due = ServicePlan.DueNow(s, t);
        return due.Count == 0 ? 0 : due.Max(d => d.MilesSince - d.IntervalMiles);
    }

    /// <summary>What the shop wants for the service. Older units cost more; that is not a penalty.</summary>
    public static decimal Cost(Truck t) =>
        Math.Round(BasePmCost + CostPerHundredThousand * (decimal)(ServicePlan.WearMiles(t) / 100_000), 0);

    /// <summary>
    /// The odds a service turns something up, as a percentage.
    ///
    /// Built from real numbers rather than a flat roll: how far past due it was let go, how many times
    /// the company held it over, and what the unit has on the clock. An existing career upgrading into
    /// this carries no deferrals, because nobody ever had the option — mileage and condition are true
    /// regardless of what the app was tracking, and count as they always would.
    /// </summary>
    public static int FindChance(AppState s, Truck t)
    {
        var fromOverdue = (int)Math.Floor(DueBy(s, t) / OverdueMilesPerPoint);
        var fromDeferrals = t.PmDeferrals * FindChancePerDeferral;
        var fromAge = (int)Math.Floor(ServicePlan.WearMiles(t) / 200_000);
        var fromCondition = t.DamagePct >= 20 ? 6 : 0;
        return Math.Clamp(fromOverdue + fromDeferrals + fromAge + fromCondition, 2, MaxFindChance);
    }

    /// <summary>
    /// What is coming at the next report, so it is visible before it happens.
    ///
    /// Read-only, deliberately. There is no button here and there should not be: this is the player
    /// seeing what the company is about to spend, not being asked about it.
    /// </summary>
    public static object? Coming(AppState s, Truck t)
    {
        if (!IsHiredUnit(s, t)) return null;
        if (!NeedsService(s, t)) return null;

        var gdc = ServicePlan.GdcActive(s);
        var past = DueBy(s, t);
        var odo = ServicePlan.Odometer(t);

        var driver = s.HiredDrivers.FirstOrDefault(
            d => d.Status == "Active" && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));
        var chance = FindChance(s, t);

        // On the GDC schedule the unit goes in against a list, not against one number, so the panel says
        // what is on the list. Quoting a single PM interval here while the Service schedule panel showed
        // eight checkpoints was the app disagreeing with itself on the same page.
        var checkpoints = gdc ? ServicePlan.DueNow(s, t) : new List<ServiceDue>();
        var cost = Cost(t) + (gdc ? ServicePlan.CostOf(s, checkpoints) : 0);
        var work = gdc ? string.Join(", ", checkpoints.Select(c => c.Name.ToLowerInvariant())) : "";

        return new
        {
            unit = t.Unit,
            unitRef = t.Ref,
            driver = driver?.Name ?? "",
            milesPastDue = Math.Round(past, 0),
            // Off GDC this is the one PM interval. On it there is no single interval to quote, so the
            // figure that means something is the worst overrun, and the list carries the rest.
            intervalMiles = gdc ? 0 : t.ServiceIntervalMiles,
            checkpoints = checkpoints.Select(c => new { c.Key, c.Name, c.IntervalMiles, c.Overrun }).ToList(),
            odometer = Math.Round(ServicePlan.WearMiles(t), 0),
            deferrals = t.PmDeferrals,
            cost,
            findChancePct = chance,
            headline = gdc
                ? $"Unit {t.Ref} has {checkpoints.Count} checkpoint(s) due" +
                  (past > 0 ? $", worst {past:N0} mi over." : ".")
                : $"Unit {t.Ref} is {past:N0} mi past its {t.ServiceIntervalMiles:N0}-mile PM.",
            detail = (gdc && work.Length > 0 ? $"Due: {work}. " : "") +
                     $"The yard will do it at the next fleet report — about ${cost:N0}. " +
                     (driver != null ? $"{driver.Name} keeps running; " : "") +
                     "nothing is being parked for it.",
            risk = chance >= 25
                ? $"At {ServicePlan.WearMiles(t):N0} mi and {past:N0} past due, there is a real chance they find " +
                  "something worth more than the service. Better found in the bay than on the road."
                : "Routine, on the numbers we have.",
            deferNote = t.PmDeferrals > 0
                ? $"Held over {t.PmDeferrals} time(s) already — the balance was short. Each one makes the " +
                  "next look worse."
                : "",
        };
    }

    /// <summary>
    /// Services everything that came due, as part of filing a fleet report.
    ///
    /// Runs before <c>AssessRetirements</c> so a condemned unit rides the retirement path that already
    /// exists: the player is told what to sell and what to buy, by make and spec, the same way a
    /// worn-out tractor has always been handled.
    ///
    /// Each find is seeded on the unit and the mileage it went in at, so re-filing cannot re-roll it.
    /// </summary>
    /// <returns>What was spent per unit, so the report can attribute it without posting it twice.</returns>
    public static Dictionary<string, decimal> ServiceDueUnits(AppState s, FleetReport report)
    {
        var spent = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var gdc = ServicePlan.GdcActive(s);
        foreach (var t in DueUnits(s))
        {
            // Costed before the balance is tested, checkpoints included. Quoting the bare intake against
            // the reserve floor let a unit through on a price the yard was never going to charge.
            var owed = gdc ? ServicePlan.DueNow(s, t) : new List<ServiceDue>();
            var cost = Cost(t) + (gdc ? ServicePlan.CostOf(s, owed) : 0);
            var balance = LedgerService.Balance(s, LedgerService.Operating);

            // A thin period holds the work over. Said out loud, because an unlogged deferral looks
            // exactly like the app having forgotten.
            if (balance - cost < ReserveFloor)
            {
                t.PmDeferrals++;
                report.Findings.Add(
                    $"Unit {t.Ref} was due {(gdc ? $"{owed.Count} checkpoint(s)" : "a PM")} and it is being " +
                    $"held over — ${balance:N0} in operating will not carry a ${cost:N0} service this " +
                    $"period. That is {t.PmDeferrals} time(s) on this unit, and the shop is now " +
                    $"{FindChance(s, t)}% to find something when it does go in.");
                continue;
            }

            var chance = FindChance(s, t);
            var found = Hash($"{t.Unit}|pm|{t.ServiceMiles:0}") % 100 < (uint)chance;

            // On the GDC schedule a unit goes in and everything due gets done at once. A hired driver's
            // tractor cannot be worked on piece by piece — the player is not there, and ATS offers no
            // such control — so the report says which checkpoints were covered rather than pretending
            // somebody chose.
            var checkpoints = gdc ? ServicePlan.ServiceAll(t, s) : new List<ServiceDue>();

            // The single-interval clock is reset on either schedule. Leaving it stale under GDC left the
            // maintenance panel repeating "PM overdue" on a unit that had just come out of the shop.
            t.LastServiceMiles = t.ServiceMiles;
            t.PmDeferrals = 0;

            if (!found)
            {
                LedgerService.Post(s, LedgerService.Operating, -cost, "Maintenance",
                    $"PM — unit {t.Ref}", report.Number);
                report.Findings.Add(checkpoints.Count > 0
                    ? $"Unit {t.Ref} went through the shop, ${cost:N0} — " +
                      string.Join(", ", checkpoints.Select(c => c.Name.ToLowerInvariant())) + "."
                    : $"Unit {t.Ref} was due a PM. Done at the yard, ${cost:N0}. " +
                      $"Next one at {t.ServiceMiles + t.ServiceIntervalMiles:N0} mi on our books.");
                spent[t.Unit] = spent.GetValueOrDefault(t.Unit) + cost;
                continue;
            }

            if (ServicePlan.WearMiles(t) >= HighMileage)
            {
                // They stop when they find it, so the bill is the strip-down rather than the service.
                var billed = Math.Round(cost / 2, 0);
                LedgerService.Post(s, LedgerService.Operating, -billed, "Maintenance",
                    $"PM — unit {t.Ref} (condemned)", report.Number);

                var driver = s.HiredDrivers.FirstOrDefault(
                    d => d.Status == "Active"
                         && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));

                report.Findings.Add(
                    $"Unit {t.Ref} went in for a PM and is not coming out. At {ServicePlan.WearMiles(t):N0} mi " +
                    $"the shop will not put it back on the road. Billed ${billed:N0} for the strip-down.");

                // The existing retirement path takes it from here: trade instructions by make and spec.
                report.Retirements.Add(new RetirementRecommendation
                {
                    Unit = t.Unit,
                    UnitKind = "Truck",
                    Headline = $"Unit {t.Ref} condemned at PM — {ServicePlan.WearMiles(t):N0} mi.",
                    Evidence =
                    {
                        $"Went in for a routine service at {ServicePlan.WearMiles(t):N0} mi.",
                        "The shop stopped rather than rebuilding it.",
                        "Wear, not a wreck — there is no insurance claim here.",
                    },
                    ServiceMiles = t.ServiceMiles,
                    DamagePct = t.DamagePct,
                    AssignedTo = driver?.Name ?? "",
                    IsPlayerUnit = false,
                });
                spent[t.Unit] = spent.GetValueOrDefault(t.Unit) + billed;
                continue;
            }

            var major = Math.Round(cost * MajorRepairMultiple, 0);
            LedgerService.Post(s, LedgerService.Operating, -major, "Maintenance",
                $"PM — unit {t.Ref} (major repair)", report.Number);
            report.Findings.Add(
                $"Unit {t.Ref} needed more than a service — ${major:N0} all in. Found in the bay rather " +
                "than on the shoulder, which is the whole argument for PM.");
            spent[t.Unit] = spent.GetValueOrDefault(t.Unit) + major;
        }

        return spent;
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }
}
