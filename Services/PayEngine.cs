using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Driver compensation. Company freight revenue belongs to the company; the driver is paid
/// mileage plus accessorials, accrued per trip and paid out on a settlement.
/// </summary>
public static class PayEngine
{
    private static decimal PayMiles(AppSettings s, double miles) =>
        (decimal)(miles * Math.Clamp(s.PayMileMultiplier, 0.1, 20.0));

    /// <summary>Quick estimate used while scoring a board load.</summary>
    public static decimal EstimatePay(AppState s, BoardLoad load)
    {
        var p = s.Driver.Pay;
        var division = DispatchEngine.DivisionFor(load, DispatchEngine.AssignedTrailer(s));
        var loaded = PayMiles(s.Settings, load.LoadedMiles);
        var dh = PayMiles(s.Settings, load.DeadheadMiles);

        var total = loaded * p.LoadedCpm + dh * p.DeadheadCpm;
        total += loaded * PremiumCpm(p, division, load.IsHazmat, load.IsOversize);
        if (load.ExtraStops > 0) total += p.ExtraStopPay * load.ExtraStops;
        if (load.RequiresTarp) total += p.TarpPay;
        return Math.Round(total, 2);
    }

    private static decimal PremiumCpm(PayPlan p, string division, bool hazmat, bool oversize)
    {
        var cpm = 0m;
        if (division.Equals("Reefer", StringComparison.OrdinalIgnoreCase)) cpm += p.ReeferCpm;
        if (hazmat) cpm += p.HazmatCpm;
        if (oversize || division.Equals("Heavy Haul", StringComparison.OrdinalIgnoreCase)) cpm += p.OversizeCpm;
        return cpm;
    }

    /// <summary>Full per-trip settlement lines, computed at trip close.</summary>
    public static PayBreakdown ComputeTripPay(AppState s, Trip trip)
    {
        var p = s.Driver.Pay;
        var b = new PayBreakdown();

        var loadedMiles = trip.ActualMiles > 0 && trip.Kind == "Freight"
            ? trip.ActualMiles
            : trip.DispatchedMiles;
        if (trip.Kind != "Freight") loadedMiles = 0;
        var dhMiles = trip.Kind == "Freight" ? trip.DeadheadMiles : Math.Max(trip.DeadheadMiles, trip.ActualMiles);

        b.LoadedMiles = loadedMiles;
        b.DeadheadMiles = dhMiles;

        var payLoaded = PayMiles(s.Settings, loadedMiles);
        var payDh = PayMiles(s.Settings, dhMiles);

        b.LinehaulPay = Math.Round(payLoaded * p.LoadedCpm, 2);
        b.DeadheadPay = Math.Round(payDh * p.DeadheadCpm, 2);

        var premium = PremiumCpm(p, trip.Division, trip.IsHazmat, trip.IsOversize);
        b.DivisionPremium = Math.Round(payLoaded * premium, 2);

        b.StopPay = p.ExtraStopPay * trip.ExtraStops;
        b.TarpPay = p.TarpPay * trip.TarpsUsed;

        // Trip.DetentionHours is already net of the free window — it is worked out per stop, because
        // three hours at a shipper and three at a receiver are two separate claims, not one six-hour
        // one. Subtracting the free time again here would take it off twice.
        var billableDetention = Math.Max(0, trip.DetentionHours);
        b.DetentionPay = Math.Round((decimal)billableDetention * p.DetentionPerHour, 2);
        b.LayoverPay = Math.Round((decimal)trip.LayoverDays * p.LayoverPerDay, 2);
        b.BreakdownPay = Math.Round((decimal)trip.BreakdownDays * p.BreakdownPerDay, 2);

        b.Total = b.LinehaulPay + b.DeadheadPay + b.DivisionPremium + b.StopPay + b.TarpPay
                  + b.DetentionPay + b.LayoverPay + b.BreakdownPay - b.Chargebacks;

        var mult = Math.Clamp(s.Settings.PayMileMultiplier, 0.1, 20.0);
        var multNote = Math.Abs(mult - 1.0) > 0.001 ? $" (×{mult:0.##} pay-mile factor)" : "";

        if (b.LinehaulPay > 0)
            b.Lines.Add($"Loaded miles {loadedMiles:N0}{multNote} @ ${p.LoadedCpm:0.000}/mi = ${b.LinehaulPay:N2}");
        if (b.DeadheadPay > 0)
            b.Lines.Add($"Empty miles {dhMiles:N0}{multNote} @ ${p.DeadheadCpm:0.000}/mi = ${b.DeadheadPay:N2}");
        if (b.DivisionPremium > 0)
            b.Lines.Add($"{trip.Division}/endorsement premium @ ${premium:0.000}/mi = ${b.DivisionPremium:N2}");
        if (b.StopPay > 0) b.Lines.Add($"{trip.ExtraStops} extra stop(s) @ ${p.ExtraStopPay:N2} = ${b.StopPay:N2}");
        if (b.TarpPay > 0) b.Lines.Add($"{trip.TarpsUsed} tarp(s) @ ${p.TarpPay:N2} = ${b.TarpPay:N2}");
        if (b.DetentionPay > 0)
            b.Lines.Add($"Detention {billableDetention:0.##} h billable, beyond {p.DetentionFreeHours:0.#} h free per stop @ ${p.DetentionPerHour:N2}/h = ${b.DetentionPay:N2}");
        if (b.LayoverPay > 0) b.Lines.Add($"Layover {trip.LayoverDays:0.#} day(s) @ ${p.LayoverPerDay:N2} = ${b.LayoverPay:N2}");
        if (b.BreakdownPay > 0) b.Lines.Add($"Breakdown {trip.BreakdownDays:0.#} day(s) @ ${p.BreakdownPerDay:N2} = ${b.BreakdownPay:N2}");
        if (b.Chargebacks > 0) b.Lines.Add($"Chargeback: {b.ChargebackMemo} = -${b.Chargebacks:N2}");

        return b;
    }

    // ------------------------------------------------------------- settlements

    public static Settlement RunSettlement(AppState s, string? notes)
    {
        var unsettled = s.Trips
            .Where(t => string.IsNullOrEmpty(t.SettlementNumber)
                        && t.Status is "Delivered" or "Cancelled"
                        && t.Pay.Total != 0)
            .OrderBy(t => t.Number)
            .ToList();

        if (unsettled.Count == 0)
            throw new InvalidOperationException("Nothing to settle — no closed trips with accrued pay.");

        var p = s.Driver.Pay;
        var seq = ++s.Counters.Settlement;
        var code = string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;
        var st = new Settlement
        {
            Number = $"{code}-PAY-{seq:0000}",
            PeriodStartGame = unsettled.First().DispatchedGameTime,
            PeriodEndGame = unsettled.Last().DeliveredGameTime is { Length: > 0 } d
                ? d : s.Status.GameTime,
            TripNumbers = unsettled.Select(t => t.Number).ToList(),
            Notes = notes ?? ""
        };

        foreach (var t in unsettled)
        {
            st.LoadedMiles += t.Pay.LoadedMiles;
            st.DeadheadMiles += t.Pay.DeadheadMiles;
            st.LinehaulPay += t.Pay.LinehaulPay;
            st.DeadheadPay += t.Pay.DeadheadPay;
            st.DivisionPremium += t.Pay.DivisionPremium;
            st.Accessorials += t.Pay.StopPay + t.Pay.TarpPay + t.Pay.DetentionPay
                               + t.Pay.LayoverPay + t.Pay.BreakdownPay;
            st.Chargebacks += t.Pay.Chargebacks;
        }

        var freight = unsettled.Where(t => t.Kind == "Freight" && t.Status == "Delivered").ToList();
        var onTime = freight.Count(t => t.ServiceResult == "OnTime");
        st.OnTimePct = freight.Count > 0 ? Math.Round(onTime * 100.0 / freight.Count, 1) : 100;

        // On-time kicker: retroactive per-mile, only at 100% service.
        if (freight.Count > 0 && onTime == freight.Count && p.OnTimeBonusCpm > 0)
        {
            st.OnTimeBonus = Math.Round((decimal)(st.LoadedMiles * Math.Clamp(s.Settings.PayMileMultiplier, 0.1, 20.0)) * p.OnTimeBonusCpm, 2);
            st.Lines.Add($"On-time service bonus: {freight.Count}/{freight.Count} loads @ ${p.OnTimeBonusCpm:0.000}/loaded mi = ${st.OnTimeBonus:N2}");
        }
        else if (freight.Count > 0)
        {
            st.Lines.Add($"On-time service bonus forfeited — {onTime}/{freight.Count} loads on time ({st.OnTimePct:0.#}%).");
        }

        // Safety bonus: no driver-fault incidents on any trip in the period.
        //
        // Pro-rated by how much of a pay period this settlement actually covers, because a flat
        // per-settlement bonus is farmable — settle after every single load and collect it every
        // time. A safety bonus is earned by a period of clean running, not by pressing the button.
        var periodTripNumbers = st.TripNumbers.ToHashSet();
        var faultIncidents = s.Incidents.Count(i =>
            periodTripNumbers.Contains(i.TripNumber) && i.FaultAttribution == "Driver");

        var periodDays = GameClock.HoursBetween(st.PeriodStartGame, st.PeriodEndGame) is { } h && h > 0
            ? h / 24.0 : 0;
        var fullPeriod = Math.Max(1, s.Settings.SettlementPeriodDays);
        var share = Math.Clamp(periodDays / fullPeriod, 0, 1);
        st.PeriodDays = Math.Round(periodDays, 2);
        st.SafetyBonusShare = Math.Round(share, 3);

        if (faultIncidents > 0)
        {
            st.Lines.Add($"Safety bonus forfeited — {faultIncidents} driver-fault incident(s) this period.");
        }
        else if (p.SafetyBonusPerSettlement > 0)
        {
            st.SafetyBonus = Math.Round(p.SafetyBonusPerSettlement * (decimal)share, 2);
            st.Lines.Add(share >= 0.999
                ? $"Safety bonus (no driver-fault incidents): ${st.SafetyBonus:N2}"
                : $"Safety bonus pro-rated: {periodDays:0.#} of {fullPeriod} day(s) run clean — " +
                  $"{share * 100:0}% of ${p.SafetyBonusPerSettlement:N2} = ${st.SafetyBonus:N2}. " +
                  "Settle a full period to earn all of it.");
        }

        st.Gross = st.LinehaulPay + st.DeadheadPay + st.DivisionPremium + st.Accessorials
                   + st.OnTimeBonus + st.SafetyBonus - st.Chargebacks;

        // Weekly guarantee makes up the shortfall for drivers who are off probation.
        if (p.WeeklyGuarantee > 0 && st.Gross < p.WeeklyGuarantee)
        {
            st.GuaranteeMakeup = Math.Round(p.WeeklyGuarantee - st.Gross, 2);
            st.Gross = p.WeeklyGuarantee;
            st.Lines.Add($"Weekly guarantee make-up to ${p.WeeklyGuarantee:N2}: ${st.GuaranteeMakeup:N2}");
        }

        st.Lines.Insert(0, $"Loaded miles {st.LoadedMiles:N0} — ${st.LinehaulPay:N2}");
        if (st.DeadheadPay > 0) st.Lines.Insert(1, $"Empty miles {st.DeadheadMiles:N0} — ${st.DeadheadPay:N2}");
        if (st.DivisionPremium > 0) st.Lines.Add($"Division / endorsement premium — ${st.DivisionPremium:N2}");
        if (st.Accessorials > 0) st.Lines.Add($"Accessorials (stops, tarps, detention, layover, breakdown) — ${st.Accessorials:N2}");
        if (st.Chargebacks > 0) st.Lines.Add($"Chargebacks — -${st.Chargebacks:N2}");

        foreach (var t in unsettled) t.SettlementNumber = st.Number;

        // Gross to net. Computed before the settlement is filed so year-to-date does not count itself.
        st.Stub = PayrollTax.Compute(s, st, PayrollTax.YtdGross(s), PayrollTax.YtdSocialSecurityWages(s));

        s.Settlements.Insert(0, st);
        s.Driver.UnsettledPay = Math.Round(Math.Max(0, s.Driver.UnsettledPay - unsettled.Sum(t => t.Pay.Total)), 2);
        if (Math.Abs(s.Driver.UnsettledPay) < 0.01m) s.Driver.UnsettledPay = 0;
        s.Driver.LifetimeEarnings = Math.Round(s.Driver.LifetimeEarnings + st.Gross, 2);

        LedgerService.PostPayroll(s, st);
        return st;
    }

    /// <summary>
    /// Runs any settlement the calendar owes the driver.
    ///
    /// Payday is Friday, and the app cannot see the game, so this fires when the driver reports a clock
    /// that has crossed one. Several Fridays can pass if they jump the clock forward — each is settled
    /// in turn rather than lumped together, so per-period bonuses and the guarantee stay honest.
    /// </summary>
    public static List<Settlement> RunDuePaydays(AppState s)
    {
        var issued = new List<Settlement>();
        var now = GameClock.DayOf(s.Status.GameTime);
        if (now == null) return issued;

        var lastPaid = s.Driver.LastPaydayDay > 0
            ? s.Driver.LastPaydayDay
            // First run of a career: only look back to the hire date, not to day one.
            : (GameClock.DayOf(s.Driver.HiredGameDate) ?? 1) - 1;

        foreach (var payday in GameClock.PaydaysBetween(lastPaid, now.Value))
        {
            s.Driver.LastPaydayDay = payday;
            var owed = s.Trips.Any(t => string.IsNullOrEmpty(t.SettlementNumber)
                                        && t.Status is "Delivered" or "Cancelled" && t.Pay.Total != 0);
            if (!owed) continue;   // a quiet week is not an error, it just does not produce a stub

            var st = RunSettlement(s, $"Payday — Friday, Day {payday}.");
            st.Trigger = "Payday";
            issued.Add(st);
        }
        return issued;
    }

    /// <summary>
    /// Settling up on the way out. Leaving an employer with wages on their books is not something the
    /// driver should have to remember to avoid, so accepting a new job closes the old one out first.
    /// </summary>
    public static Settlement? SettleOnLeaving(AppState s)
    {
        var owed = s.Trips.Any(t => string.IsNullOrEmpty(t.SettlementNumber)
                                    && t.Status is "Delivered" or "Cancelled" && t.Pay.Total != 0);
        if (!owed) return null;

        var st = RunSettlement(s, $"Final settlement — leaving {s.Company.Name}.");
        st.Trigger = "JobChange";
        return st;
    }

    /// <summary>When the next payday falls, for the Payroll tab.</summary>
    public static (int Day, double DaysAway) NextPayday(AppState s)
    {
        var now = GameClock.DayOf(s.Status.GameTime) ?? 1;
        var next = GameClock.NextPayday(now);
        // Today counts only if the clock has not already passed this week's payday.
        if (next == now && s.Driver.LastPaydayDay >= now) next = GameClock.NextPayday(now + 1);
        return (next, next - now);
    }
}
