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
/// Two facts decide the shape of the answer.
///
/// The app cannot make ATS do anything, so it must never claim the truck was off the road — the game
/// would contradict it the next time the player opened the driver manager, and an app that is visibly
/// wrong about the world stops being worth reading. No downtime is simulated here. The driver keeps
/// producing, because in the game they will.
///
/// Money is the opposite. The app IS the company's books; hired-driver repairs already go through the
/// ledger off the fleet report. So the alert becomes what it should always have been — a bill the player
/// authorises, on work the company's own shop does, at a yard the player never has to drive to.
/// </summary>
public static class FleetMaintenance
{
    /// <summary>Labour and parts for a routine service, before anything is found.</summary>
    public const decimal BasePmCost = 900m;

    /// <summary>Added per 100,000 miles on the clock. Old units cost more to keep, which is the point.</summary>
    public const decimal CostPerHundredThousand = 240m;

    /// <summary>
    /// Deferring is allowed — cash is cash, and a carrier short this month puts it off. It is remembered,
    /// and each time raises what the shop is likely to find. Said out loud before the player chooses,
    /// never discovered afterwards.
    /// </summary>
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
        s.Trucks.Where(t => IsHiredUnit(s, t) && MilesPastDue(t) > 0).ToList();

    /// <summary>Whether an active hired driver is running this unit.</summary>
    public static bool IsHiredUnit(AppState s, Truck t) =>
        !t.Retired && t.Status != "Retired"
        && s.HiredDrivers.Any(d => d.Status == "Active"
                                   && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));

    /// <summary>How far past the service interval, or 0 when it is not due.</summary>
    public static double MilesPastDue(Truck t) =>
        Math.Max(0, (t.ServiceMiles - t.LastServiceMiles) - t.ServiceIntervalMiles);

    /// <summary>What the shop wants for the service. Older units cost more; that is not a penalty.</summary>
    public static decimal Cost(Truck t) =>
        Math.Round(BasePmCost + CostPerHundredThousand * (decimal)(Math.Max(0, t.AtsOdometer) / 100_000), 0);

    /// <summary>
    /// The odds the service turns something up, as a percentage.
    ///
    /// Driven by real numbers rather than a flat roll: how far past due it was let go, how many times a
    /// service was deferred, and what the unit has on the clock. An existing career upgrading into this
    /// carries no deferrals, because it never had the option to schedule one — mileage and condition are
    /// true regardless of what the app was tracking, and count as they always would.
    /// </summary>
    public static int FindChance(Truck t)
    {
        var fromOverdue = (int)Math.Floor(MilesPastDue(t) / OverdueMilesPerPoint);
        var fromDeferrals = t.PmDeferrals * FindChancePerDeferral;
        var fromAge = (int)Math.Floor(Math.Max(0, t.AtsOdometer) / 200_000);
        var fromCondition = t.DamagePct >= 20 ? 6 : 0;
        return Math.Clamp(fromOverdue + fromDeferrals + fromAge + fromCondition, 2, MaxFindChance);
    }

    /// <summary>What the player is deciding about, before they decide it.</summary>
    public static object? Offer(AppState s, Truck t)
    {
        if (!IsHiredUnit(s, t)) return null;
        var past = MilesPastDue(t);
        if (past <= 0) return null;

        var driver = s.HiredDrivers.FirstOrDefault(
            d => d.Status == "Active" && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));
        var chance = FindChance(t);

        return new
        {
            unit = t.Unit,
            unitRef = t.Ref,
            driver = driver?.Name ?? "",
            milesPastDue = Math.Round(past, 0),
            intervalMiles = t.ServiceIntervalMiles,
            odometer = Math.Round(t.AtsOdometer, 0),
            deferrals = t.PmDeferrals,
            cost = Cost(t),
            findChancePct = chance,
            headline = $"Unit {t.Ref} is {past:N0} mi past its {t.ServiceIntervalMiles:N0}-mile PM.",
            detail = $"Our own shop can take it — ${Cost(t):N0}. " +
                     (driver != null ? $"{driver.Name} keeps running either way; " : "") +
                     "you are authorising the work, not parking the truck.",
            risk = chance >= 25
                ? $"At {t.AtsOdometer:N0} mi and {past:N0} past due, there is a real chance they find something " +
                  "worth more than the service. Better found in the bay than on the road."
                : "Routine, on the numbers we have.",
            deferNote = t.PmDeferrals > 0
                ? $"Deferred {t.PmDeferrals} time(s) already. Each one makes the next look worse."
                : "Deferring is fine if the cash is not there. It is remembered.",
        };
    }

    /// <summary>
    /// Puts a unit off until next time, and remembers it.
    /// </summary>
    public static string Defer(AppState s, string unit)
    {
        var t = Find(s, unit);
        t.PmDeferrals++;
        return $"Unit {t.Ref} left as it is. That is {t.PmDeferrals} deferral(s) on this unit — " +
               $"the shop is now {FindChance(t)}% to find something when it does go in.";
    }

    /// <summary>
    /// Does the service. Charges it, resets the clock, and occasionally finds something.
    ///
    /// The find is seeded on the unit and the mileage it went in at, so filing again cannot re-roll it —
    /// the same rule every other chance in the app follows.
    /// </summary>
    public static PmResult Schedule(AppState s, string unit, string gameTime)
    {
        var t = Find(s, unit);
        var past = MilesPastDue(t);
        if (past <= 0) throw new InvalidOperationException($"Unit {t.Ref} is not due a service.");

        var r = new PmResult { Unit = t.Unit, UnitRef = t.Ref, Cost = Cost(t) };
        var chance = FindChance(t);
        var roll = Hash($"{t.Unit}|pm|{t.ServiceMiles:0}") % 100;
        var found = roll < (uint)chance;

        // The clock resets whatever they find. The service was done.
        t.LastServiceMiles = t.ServiceMiles;
        t.PmDeferrals = 0;

        if (!found)
        {
            r.Outcome = "Routine";
            r.Message = $"Unit {t.Ref} serviced — ${r.Cost:N0}. Nothing untoward. Next one due in " +
                        $"{t.ServiceIntervalMiles:N0} mi.";
            LedgerService.Post(s, LedgerService.Operating, -r.Cost, "Maintenance",
                $"PM — unit {t.Ref}", "");
            return r;
        }

        // Terminal or expensive. A unit deep into its second life is the one they condemn; anything
        // younger gets a bill and keeps working.
        if (t.AtsOdometer >= HighMileage)
        {
            r.Outcome = "Condemned";
            r.Cost = Math.Round(r.Cost / 2, 0);   // they stop when they find it
            r.Message = $"Unit {t.Ref} went in for a ${Cost(t):N0} service and is not coming out. " +
                        $"At {t.AtsOdometer:N0} mi the shop will not put it back on the road, and they are right. " +
                        $"Billed ${r.Cost:N0} for the strip-down.";
            r.RecommendTrade = true;

            // Off the road for real, and this one the game will agree with — the player is being sent to
            // trade it in ATS, so the app and the game converge rather than drift. Nothing like the
            // fiction of a two-day PM downtime, which ATS would contradict the moment they looked.
            t.Status = "OutOfService";

            var driver = s.HiredDrivers.FirstOrDefault(
                d => d.Status == "Active" && d.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase));
            r.Instructions.Add($"Sell unit {t.Ref} ({t.Year} {t.Make} {t.Model}, {t.AtsOdometer:N0} mi) in ATS.");
            r.Instructions.Add($"Buy the replacement: {Seed.RecommendedTruck(s)}");
            r.Instructions.Add("Add what you actually bought on the Fleet tab — " +
                               (driver != null
                                   ? $"{driver.Name} has no tractor until you do, and it comes to them on arrival."
                                   : "the seat is empty until you do."));
        }
        else
        {
            r.Outcome = "MajorRepair";
            r.Cost = Math.Round(Cost(t) * MajorRepairMultiple, 0);
            r.Message = $"Unit {t.Ref} needed more than a service — ${r.Cost:N0} all in. " +
                        "Found in the bay rather than on the shoulder, which is the whole argument for PM.";
        }

        LedgerService.Post(s, LedgerService.Operating, -r.Cost, "Maintenance",
            $"PM — unit {t.Ref} ({r.Outcome})", "");
        return r;
    }

    private static Truck Find(AppState s, string unit) =>
        s.Trucks.FirstOrDefault(t => t.Unit.Equals((unit ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidOperationException($"Unit {unit} is not in the fleet.");

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

/// <summary>What a scheduled service came to.</summary>
public class PmResult
{
    public string Unit { get; set; } = "";
    public string UnitRef { get; set; } = "";
    /// <summary>Routine | MajorRepair | Condemned</summary>
    public string Outcome { get; set; } = "Routine";
    public decimal Cost { get; set; }
    public string Message { get; set; } = "";
    /// <summary>The shop says it is finished. Goes through the same trade path a retirement does.</summary>
    public bool RecommendTrade { get; set; }
    /// <summary>What to do in ATS about it, in order. Empty on a routine service.</summary>
    public List<string> Instructions { get; set; } = new();
}
