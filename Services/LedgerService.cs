using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The company's operating ledger, reconciled to the ATS bank balance.
///
/// ATS has exactly one bank account and already deducts fuel, repairs, garages, equipment and hired
/// driver wages from it, so that balance IS the company's cash. Maintenance and payroll "reserves"
/// are therefore earmarks computed against it rather than separate pots — moving money between
/// accounts would invent cash the game does not have.
///
/// The one thing that never reaches the game is the driver's own wages: in ATS the player is the
/// owner and pays themselves nothing, so those live only in this app's books.
/// </summary>
public static class LedgerService
{
    public const string Operating = "operating";
    public const string MaintenanceReserve = "maintenance_reserve";
    public const string PayrollReserve = "payroll_reserve";
    public const string EquipmentNote = "equipment_note";

    public static decimal Balance(AppState s, string key)
    {
        var acct = s.Accounts.FirstOrDefault(a => a.Key == key);
        if (acct == null) return 0;
        return Math.Round(acct.OpeningBalance + s.Ledger.Where(e => e.AccountKey == key).Sum(e => e.Amount), 2);
    }

    public static LedgerEntry Post(AppState s, string account, decimal amount, string category,
        string memo, string tripNumber = "", bool isAdjustment = false)
    {
        var entry = new LedgerEntry
        {
            AccountKey = account,
            Amount = Math.Round(amount, 2),
            Category = category,
            Memo = memo,
            TripNumber = tripNumber,
            GameTime = s.Status.GameTime,
            IsAdjustment = isAdjustment
        };
        s.Ledger.Insert(0, entry);
        return entry;
    }

    /// <summary>
    /// Moves money between accounts. Under the single-cash model this is a no-op: ATS has one bank
    /// account, so shuffling cash into a "reserve" would invent money the game does not have.
    /// Reserves are computed as earmarks instead — see <see cref="Position"/>.
    /// </summary>
    private static void Transfer(AppState s, string from, string to, decimal amount, string memo, string tripNumber)
    {
        if (amount <= 0 || s.Settings.SingleCashAccount) return;
        Post(s, from, -amount, "Transfer", $"{memo} (to {Name(s, to)})", tripNumber);
        Post(s, to, amount, "Transfer", $"{memo} (from {Name(s, from)})", tripNumber);
    }

    /// <summary>
    /// The company's actual financial position, anchored on the ATS bank balance.
    ///
    /// The game already takes fuel, repairs, garages, equipment and AI wages out of that balance, so
    /// it is the company's cash. The two things ATS does not know about are the reserves the company
    /// earmarks against future maintenance and payroll, and the wages it owes the player — because
    /// in ATS the player is the owner, not an employee. Both are subtracted to give what the company
    /// can actually spend.
    /// </summary>
    public static CompanyPosition Position(AppState s)
    {
        var p = new CompanyPosition
        {
            AtsBankBalance = s.Status.AtsBankBalance,
            BalanceReportedAt = s.Status.AtsBalanceGameTime,
            LedgerCash = Balance(s, Operating),
            WagesOwed = s.Driver.UnsettledPay
        };

        // NOT reconciled against the books, and no longer earmarked.
        //
        // This used to compute a variance between the ATS balance and the company's ledger and call
        // anything over a pound out of sync. That was a double-entry ledger shadowing a game which emits
        // no transactions — only a balance. ATS moves that number constantly for things the app can never
        // see: a hired driver's income landing, fuel, tolls, ferries, fines, a garage, a trailer. So the
        // difference was not an error to chase, it was the shape of the problem, and every "true up" was
        // the app admitting it could not see what happened and then posting an entry pretending it had.
        //
        // It also inverted this app's whole stance. Everything here holds that the player is a DRIVER —
        // not my money — and then asked them to square the carrier's bank, which is the one piece of
        // bookkeeping a driver would never be handed.
        //
        // The two earmarks went with it. Eight per cent for maintenance and thirty for payroll, taken off
        // a balance the app cannot see, made Spendable about three fifths of the figure the player was
        // reading in their own game, for no reason they could point at. A driver has no earmarks.
        //
        // What is left is the one deduction that is real: money the company owes the driver. The app
        // originated every settlement behind it, so it knows that figure exactly.
        p.HasReportedBalance = s.Status.AtsBankBalance != 0 || !string.IsNullOrWhiteSpace(s.Status.AtsBalanceGameTime);
        var basis = p.HasReportedBalance ? p.AtsBankBalance : p.LedgerCash;
        p.Spendable = Math.Round(basis - p.WagesOwed, 2);
        p.TotalCash = TotalCompanyCash(s);

        p.Note = !p.HasReportedBalance
            ? "No ATS balance reported yet. Type what your game shows when you want to know what the " +
              "company can put its hands on."
            : p.WagesOwed > 0
                ? $"ATS keeps one bank, and that balance is the company's. ${p.WagesOwed:N2} of it is owed " +
                  "to you and is not the company's to spend. Your own pay is the settlement figures — a " +
                  "different thing from this number."
                : "ATS keeps one bank, and that balance is the company's. Your own pay is the settlement " +
                  "figures — a different thing from this number.";

        if (p.Spendable < 0)
            p.Warning = "The company owes you more than the bank holds. That is worth knowing before it " +
                        "buys anything else.";

        // The driver's own money. Deliberately computed apart from company cash.
        var loadedMiles = s.Settlements.Sum(x => x.LoadedMiles);
        p.Earnings = new DriverEarnings
        {
            Settled = s.Driver.LifetimeEarnings,
            Unsettled = s.Driver.UnsettledPay,
            TotalEarned = Math.Round(s.Driver.LifetimeEarnings + s.Driver.UnsettledPay, 2),
            Settlements = s.Settlements.Count,
            LoadedMiles = Math.Round(loadedMiles, 0),
            EffectiveCpm = loadedMiles > 0
                ? Math.Round(s.Driver.LifetimeEarnings / (decimal)loadedMiles, 3) : 0
        };
        return p;
    }

    /// <summary>Posts the difference between the books and the game as an explicit adjustment.</summary>
    private static string Name(AppState s, string key) =>
        s.Accounts.FirstOrDefault(a => a.Key == key)?.Name ?? key;

    /// <summary>Book everything a completed trip does to the company's money.</summary>
    public static void PostTripFinancials(AppState s, Trip trip)
    {
        var cfg = s.Settings;

        if (trip.CompanyRevenue > 0)
        {
            var memo = $"Linehaul {trip.Cargo} {DispatchEngine.Place(trip.OriginCity, trip.OriginState)} → {DispatchEngine.Place(trip.DestCity, trip.DestState)}";
            if (Math.Abs(cfg.RevenueFactor - 1.0) > 0.001)
                memo += $" (ATS paid ${trip.GameRevenue:N2}; booked at ×{cfg.RevenueFactor:0.##} realism factor)";
            Post(s, Operating, trip.CompanyRevenue, "FreightRevenue", memo, trip.Number);
        }

        if (trip.FuelCost > 0)
            Post(s, Operating, -trip.FuelCost, "Fuel",
                $"{trip.FuelGallons:0.#} gal{(trip.FuelGallons > 0 ? $" @ ${trip.FuelCost / (decimal)trip.FuelGallons:0.000}/gal" : "")}", trip.Number);

        if (trip.Tolls > 0)
            Post(s, Operating, -trip.Tolls, "Tolls", "Tolls and scales", trip.Number);

        if (trip.RepairCost > 0)
            SpendOnMaintenance(s, trip.RepairCost, "En-route repair", trip.Number);

        if (trip.Fines > 0)
        {
            var driverPays = trip.FaultAttribution == "Driver" && trip.Pay.Chargebacks >= trip.Fines;
            if (!driverPays)
                Post(s, Operating, -trip.Fines, "Fines", $"Fines/citations ({trip.FaultAttribution} fault)", trip.Number);
            else
                Post(s, Operating, 0, "Fines",
                    $"Fines ${trip.Fines:N2} charged back to driver — no company expense", trip.Number);
        }

        if (trip.OtherExpense > 0)
            Post(s, Operating, -trip.OtherExpense, "Overhead",
                string.IsNullOrWhiteSpace(trip.OtherExpenseMemo) ? "Other trip expense" : trip.OtherExpenseMemo, trip.Number);

        if (trip.Kind == "Freight" && cfg.OverheadPerLoad > 0)
            Post(s, Operating, -cfg.OverheadPerLoad, "Overhead",
                "Fixed overhead per load (insurance, plates, ELD, admin)", trip.Number);

        if (trip.CompanyRevenue > 0)
        {
            Transfer(s, Operating, MaintenanceReserve,
                Math.Round(trip.CompanyRevenue * (decimal)cfg.MaintenanceReservePct, 2),
                $"Maintenance reserve sweep {cfg.MaintenanceReservePct * 100:0.#}% of revenue", trip.Number);
            Transfer(s, Operating, PayrollReserve,
                Math.Round(trip.CompanyRevenue * (decimal)cfg.PayrollReservePct, 2),
                $"Payroll reserve sweep {cfg.PayrollReservePct * 100:0.#}% of revenue", trip.Number);
        }
    }

    public static void PostCancellation(AppState s, Trip trip, bool chargeCompany)
    {
        if (!chargeCompany || s.Settings.CancellationPenalty <= 0) return;
        Post(s, Operating, -s.Settings.CancellationPenalty, "Cancellation",
            $"Cancellation penalty — {trip.Cargo} to {DispatchEngine.Place(trip.DestCity, trip.DestState)} ({trip.FaultAttribution} fault)",
            trip.Number);
    }

    /// <summary>
    /// Maintenance spending. Under the single-cash model it all comes out of the one bank account —
    /// the earmark is a claim on that money, not a separate pot to draw from.
    /// </summary>
    private static void SpendOnMaintenance(AppState s, decimal amount, string memo, string reference)
    {
        if (amount <= 0) return;
        if (s.Settings.SingleCashAccount)
        {
            Post(s, Operating, -amount, "Repairs", memo, reference);
            return;
        }
        var reserve = Balance(s, MaintenanceReserve);
        var fromReserve = Math.Min(Math.Max(0, reserve), amount);
        if (fromReserve > 0) Post(s, MaintenanceReserve, -fromReserve, "Repairs", memo, reference);
        if (amount - fromReserve > 0) Post(s, Operating, -(amount - fromReserve), "Repairs", $"{memo} (reserve short)", reference);
    }

    public static void PostWorkOrder(AppState s, WorkOrder wo)
    {
        if (wo.Cost <= 0) return;
        if (wo.PaidBy == "Driver")
        {
            Post(s, Operating, 0, "Repairs",
                $"{wo.Number} ${wo.Cost:N2} charged to driver — no company expense", wo.Number);
            return;
        }

        var category = wo.Kind == "Preventive" ? "Maintenance" : "Repairs";
        var memo = $"{wo.Number} {Equip.Label(s, wo.Unit)}: {wo.Description}";
        if (s.Settings.SingleCashAccount)
        {
            Post(s, Operating, -wo.Cost, category, memo, wo.Number);
            return;
        }
        var reserve = Balance(s, MaintenanceReserve);
        var fromReserve = Math.Min(Math.Max(0, reserve), wo.Cost);
        if (fromReserve > 0) Post(s, MaintenanceReserve, -fromReserve, category, memo, wo.Number);
        if (wo.Cost - fromReserve > 0) Post(s, Operating, -(wo.Cost - fromReserve), category, $"{memo} (reserve short)", wo.Number);
    }

    /// <summary>
    /// Driver wages. This is the one expense ATS never sees — the game does not pay its owner a
    /// per-mile wage — so it reduces the company's book cash without ever moving the game balance.
    /// </summary>
    public static void PostPayroll(AppState s, Settlement st)
    {
        var memo = $"{st.Number} driver settlement — {s.Driver.Name} (not reflected in ATS)";
        if (s.Settings.SingleCashAccount)
        {
            Post(s, Operating, -st.Gross, "Payroll", memo, st.Number);
            return;
        }
        var reserve = Balance(s, PayrollReserve);
        var fromReserve = Math.Min(Math.Max(0, reserve), st.Gross);
        if (fromReserve > 0) Post(s, PayrollReserve, -fromReserve, "Payroll", memo, st.Number);
        if (st.Gross - fromReserve > 0) Post(s, Operating, -(st.Gross - fromReserve), "Payroll", $"{memo} (reserve short)", st.Number);
    }

    // ------------------------------------------------------------- reporting

    public static LedgerSummary Summary(AppState s)
    {
        var sum = new LedgerSummary();
        foreach (var a in s.Accounts)
            sum.Accounts.Add(new AccountBalance
            {
                Key = a.Key, Name = a.Name, Kind = a.Kind,
                Opening = a.OpeningBalance,
                Balance = Balance(s, a.Key),
                Notes = a.Notes
            });

        sum.TotalAssets = sum.Accounts.Where(a => a.Kind == "Asset").Sum(a => a.Balance);
        sum.TotalLiabilities = sum.Accounts.Where(a => a.Kind == "Liability").Sum(a => a.Balance);
        sum.NetPosition = Math.Round(sum.TotalAssets + sum.TotalLiabilities, 2);

        foreach (var g in s.Ledger.GroupBy(e => e.Category))
            sum.ByCategory[g.Key] = Math.Round(g.Sum(e => e.Amount), 2);

        sum.Revenue = Math.Round(s.Ledger.Where(e => e.Category == "FreightRevenue").Sum(e => e.Amount), 2);
        sum.Fuel = Math.Round(-s.Ledger.Where(e => e.Category == "Fuel").Sum(e => e.Amount), 2);
        sum.MaintenanceSpend = Math.Round(-s.Ledger.Where(e => e.Category is "Repairs" or "Maintenance").Sum(e => e.Amount), 2);
        sum.PayrollSpend = Math.Round(-s.Ledger.Where(e => e.Category == "Payroll").Sum(e => e.Amount), 2);
        sum.TollSpend = Math.Round(-s.Ledger.Where(e => e.Category == "Tolls").Sum(e => e.Amount), 2);
        sum.OverheadSpend = Math.Round(-s.Ledger.Where(e => e.Category is "Overhead" or "Insurance").Sum(e => e.Amount), 2);
        sum.FineSpend = Math.Round(-s.Ledger.Where(e => e.Category == "Fines").Sum(e => e.Amount), 2);
        sum.CancellationSpend = Math.Round(-s.Ledger.Where(e => e.Category == "Cancellation").Sum(e => e.Amount), 2);

        // Capital counts. It used to sit outside opCost entirely, so the one purchase that did reach the
        // ledger — a trailer bought through a company request — never touched operating income or the
        // operating ratio, and yards touched nothing at all because they were never posted. That is
        // defensible accounting and indefensible here: the company decides whether to expand off these
        // figures, so leaving out what expanding costs let it expand forever. Proceeds from selling
        // something come back the same way, because a trade is not a loss.
        sum.EquipmentSpend = Math.Round(-s.Ledger.Where(e => e.Category is "Equipment" or "Property").Sum(e => e.Amount), 2);
        sum.YardUpkeepSpend = Math.Round(-s.Ledger.Where(e => e.Category == "YardUpkeep").Sum(e => e.Amount), 2);

        var opCost = sum.Fuel + sum.MaintenanceSpend + sum.PayrollSpend + sum.TollSpend
                     + sum.OverheadSpend + sum.FineSpend + sum.CancellationSpend
                     + sum.EquipmentSpend + sum.YardUpkeepSpend;
        sum.OperatingIncome = Math.Round(sum.Revenue - opCost, 2);

        var loadedMiles = s.Trips.Where(t => t.Status == "Delivered").Sum(t => t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles);
        var allMiles = loadedMiles + s.Trips.Where(t => t.Status == "Delivered").Sum(t => t.DeadheadMiles);
        sum.LoadedMiles = loadedMiles;
        sum.TotalMiles = allMiles;
        sum.RevenuePerLoadedMile = loadedMiles > 0 ? Math.Round(sum.Revenue / (decimal)loadedMiles, 3) : 0;
        sum.CostPerMile = allMiles > 0 ? Math.Round(opCost / (decimal)allMiles, 3) : 0;
        sum.OperatingRatio = sum.Revenue > 0 ? Math.Round((double)(opCost / sum.Revenue), 3) : 0;
        sum.UnsettledDriverPay = s.Driver.UnsettledPay;

        return sum;
    }

    /// <summary>
    /// Ledger integrity check. Rather than quietly inventing a balance, this reports exactly
    /// what does not tie and offers a single explicit adjusting entry to fix it.
    /// </summary>
    /// <summary>
    /// What the company reckons it is holding, all in: operating cash plus the maintenance and payroll
    /// earmarks. ATS keeps one pot, and the reserves are an accounting split rather than money sitting
    /// somewhere else, so this is the figure the game has to be able to cover.
    /// </summary>
    public static decimal TotalCompanyCash(AppState s) =>
        Balance(s, Operating) + Balance(s, MaintenanceReserve) + Balance(s, PayrollReserve);

    /// <summary>The Monday on or before this day. Day 0 is a Monday, so the arithmetic is the calendar.</summary>
    public static int MondayOnOrBefore(int day) => Math.Max(0, day) - (Math.Max(0, day) % 7);

    /// <summary>
    /// There is no weekly true-up any more.
    ///
    /// It asked the player, every Monday, to square the carrier's books against their game — and where
    /// ATS held LESS than the books, it told them to put the difference back with a save editor. That is
    /// the app asking somebody to edit their save so its own bookkeeping comes out right. The game is the
    /// world; when the two disagree it is the books that are wrong.
    ///
    /// The company's finances are a profit and loss now, not a bank to be tied out — see the fleet
    /// report, which says what the fleet earned and what it cost. What the player reads off ATS is used
    /// where it is actually useful: once, at the moment the company is deciding whether it can buy
    /// something.
    /// </summary>

    public static Reconciliation Reconcile(AppState s)
    {
        var r = new Reconciliation();

        foreach (var a in s.Accounts)
        {
            var computed = Balance(s, a.Key);
            r.Accounts.Add(new AccountBalance
            {
                Key = a.Key, Name = a.Name, Kind = a.Kind,
                Opening = a.OpeningBalance, Balance = computed
            });
            if (a.Kind == "Asset" && computed < 0)
                r.Findings.Add($"{a.Name} is overdrawn at ${computed:N2}. Move money in or stop spending against it.");
        }

        foreach (var t in s.Trips.Where(t => t.Status == "Delivered" && t.CompanyRevenue > 0))
        {
            var posted = s.Ledger.Where(e => e.TripNumber == t.Number && e.Category == "FreightRevenue")
                .Sum(e => e.Amount);
            if (Math.Abs(posted - t.CompanyRevenue) > 0.01m)
                r.Findings.Add($"{t.Number}: revenue ${t.CompanyRevenue:N2} on the trip record but ${posted:N2} posted to the ledger.");
        }

        foreach (var st in s.Settlements)
        {
            var posted = -s.Ledger.Where(e => e.TripNumber == st.Number && e.Category == "Payroll").Sum(e => e.Amount);
            if (Math.Abs(posted - st.Gross) > 0.01m)
                r.Findings.Add($"{st.Number}: settlement gross ${st.Gross:N2} but ${posted:N2} posted as payroll.");
        }

        var accrued = s.Trips
            .Where(t => string.IsNullOrEmpty(t.SettlementNumber) && t.Status is "Delivered" or "Cancelled")
            .Sum(t => t.Pay.Total);
        if (Math.Abs(accrued - s.Driver.UnsettledPay) > 0.01m)
        {
            r.Findings.Add($"Unsettled driver pay is recorded as ${s.Driver.UnsettledPay:N2} but the open trips total ${accrued:N2}.");
            r.SuggestedUnsettledPay = Math.Round(accrued, 2);
        }

        var openTrips = s.Trips.Count(t => t.Status is "Authorized" or "InTransit");
        if (openTrips > 1)
            r.Findings.Add($"{openTrips} trips are open at once. A single driver can only be on one load.");

        var dupes = s.Trips.GroupBy(t => t.Number).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        foreach (var d in dupes)
            r.Findings.Add($"Trip number {d} is used more than once — numbering continuity is broken.");

        var maxFreight = s.Trips.Where(t => t.Kind == "Freight")
            .Select(t => SeqOf(t.Number)).DefaultIfEmpty(0).Max();
        if (maxFreight > s.Counters.Freight)
            r.Findings.Add($"Freight counter is at {s.Counters.Freight} but {maxFreight} is already issued — the next number would be a duplicate.");

        r.Balanced = r.Findings.Count == 0;
        r.Summary = r.Balanced
            ? "Ledger and trip records tie out. No adjustments needed."
            : $"{r.Findings.Count} item(s) do not tie. Nothing was changed — post an explicit adjustment to correct them.";
        return r;
    }

    private static int SeqOf(string number)
    {
        var last = (number ?? "").Split('-').LastOrDefault();
        return int.TryParse(last, out var n) ? n : 0;
    }

    public static void ApplyReconciliation(AppState s, string account, decimal amount, string memo)
    {
        Post(s, account, amount, "Adjustment",
            string.IsNullOrWhiteSpace(memo) ? "Reconciliation adjustment" : memo, "", isAdjustment: true);
    }
}

/// <summary>
/// The company's position, anchored on the ATS bank balance, plus the driver's personal earnings
/// kept deliberately apart from it. In ATS the player is the owner and pays themselves nothing, so
/// driver wages exist only in this app's books — they are real to the career and invisible to the
/// game, and mixing the two is what makes company money feel like a paycheck when it is not.
/// </summary>
public class CompanyPosition
{
    // --- company cash (mirrors the game)
    public decimal AtsBankBalance { get; set; }
    public string BalanceReportedAt { get; set; } = "";
    public bool HasReportedBalance { get; set; }
    public decimal LedgerCash { get; set; }

    /// <summary>What the company's own books say it holds. A profit and loss, not a bank to tie out.</summary>
    public decimal TotalCash { get; set; }

    // No Variance and no InSync. They compared the ledger against the ATS balance and called anything
    // over a pound an error — but the app sees only that balance, never the transactions behind it, so
    // the difference was the shape of the problem rather than a fault to chase.
    //
    // No earmarks either. Eight per cent for maintenance and thirty for payroll, taken off a figure the
    // app cannot see, made Spendable about three fifths of what the player was reading in their own game.

    /// <summary>Money the company owes the driver. The one deduction the app knows exactly.</summary>
    public decimal WagesOwed { get; set; }
    public decimal Spendable { get; set; }

    public string Note { get; set; } = "";
    public string Warning { get; set; } = "";

    // --- the driver's own money, tracked here and nowhere else
    public DriverEarnings Earnings { get; set; } = new();
}

/// <summary>
/// What the driver has personally earned. Never reconciled to ATS: the game has no concept of
/// paying its owner a per-mile wage, so this is the app's own record of the career.
/// </summary>
public class DriverEarnings
{
    /// <summary>Paid out across all settlements.</summary>
    public decimal Settled { get; set; }
    /// <summary>Accrued on closed trips but not yet settled.</summary>
    public decimal Unsettled { get; set; }
    /// <summary>Everything earned to date, settled or not.</summary>
    public decimal TotalEarned { get; set; }
    public int Settlements { get; set; }
    public double LoadedMiles { get; set; }
    /// <summary>Average gross per loaded mile actually achieved, across settlements.</summary>
    public decimal EffectiveCpm { get; set; }
    public string Note { get; set; } =
        "Tracked in this app only. ATS has no idea you are on a payroll — your game bank balance is " +
        "the company's money, not yours.";
}

public class AccountBalance
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "Asset";
    public decimal Opening { get; set; }
    public decimal Balance { get; set; }
    public string Notes { get; set; } = "";
}

public class LedgerSummary
{
    public List<AccountBalance> Accounts { get; set; } = new();
    public decimal TotalAssets { get; set; }
    public decimal TotalLiabilities { get; set; }
    public decimal NetPosition { get; set; }
    public Dictionary<string, decimal> ByCategory { get; set; } = new();
    public decimal Revenue { get; set; }
    public decimal Fuel { get; set; }
    public decimal MaintenanceSpend { get; set; }
    public decimal PayrollSpend { get; set; }
    public decimal TollSpend { get; set; }
    public decimal OverheadSpend { get; set; }
    public decimal FineSpend { get; set; }
    public decimal CancellationSpend { get; set; }
    /// <summary>Trucks, trailers and yards bought in the window, less anything sold. See Summary.</summary>
    public decimal EquipmentSpend { get; set; }
    /// <summary>What the yards cost to keep over the window.</summary>
    public decimal YardUpkeepSpend { get; set; }
    public decimal OperatingIncome { get; set; }
    public double LoadedMiles { get; set; }
    public double TotalMiles { get; set; }
    public decimal RevenuePerLoadedMile { get; set; }
    public decimal CostPerMile { get; set; }
    public double OperatingRatio { get; set; }
    public decimal UnsettledDriverPay { get; set; }
}

public class Reconciliation
{
    public bool Balanced { get; set; }
    public string Summary { get; set; } = "";
    public List<string> Findings { get; set; } = new();
    public List<AccountBalance> Accounts { get; set; } = new();
    public decimal? SuggestedUnsettledPay { get; set; }
}
