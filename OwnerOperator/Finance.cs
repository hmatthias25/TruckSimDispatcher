using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// How the business is doing, week by game week (Monday to Sunday; Day 1 is a Monday). Asked for from play, with the
/// decisions taken on 2026-10-21: a check of the game bank every Monday, finding what went out unseen (tolls, tickets,
/// in-game repairs); fuel logged at every fill, on a job or not; and the cost factor worked out again after each check,
/// from fuel and that spending per mile, plus the monthly bills the Companion App pays, spread over the miles driven.
/// </summary>
public class FinanceState
{
    public List<FuelBuy> Fuel { get; set; } = new();
    /// <summary>Spending the game bank showed that nothing logged: the gap at a balance check.</summary>
    public List<Spend> Other { get; set; } = new();
    public List<WeekCheck> Checks { get; set; } = new();
    public List<FactorStep> Factor { get; set; } = new();
    public Bills Bills { get; set; } = new();
    /// <summary>The Monday (game day) of the week tracking began. No check is asked for that week: an existing career keeps
    /// its factor until the next game Monday, as agreed.</summary>
    public int StartWeek { get; set; }
    public double StartOdometer { get; set; }
    /// <summary>The odometer each time it changed, with the game time: what a week's miles are read off, loaded or empty.</summary>
    public List<OdoReading> Odometer { get; set; } = new();
}

public class OdoReading
{
    public string GameTime { get; set; } = "";
    public double Miles { get; set; }
}

public class FuelBuy
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string GameTime { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public double Gallons { get; set; }
    public decimal PricePerGal { get; set; }
    public decimal Total { get; set; }
    /// <summary>The odometer at the pump, where given: what real MPG is worked out from.</summary>
    public double? Odometer { get; set; }
    public string TripNumber { get; set; } = "";
}

public class Spend
{
    public string GameTime { get; set; } = "";
    public decimal Amount { get; set; }
    public string Source { get; set; } = "";
}

public class WeekCheck
{
    /// <summary>The Monday (game day) of the week checked into.</summary>
    public int Week { get; set; }
    public string GameTime { get; set; } = "";
    public decimal Reported { get; set; }
    public decimal? Expected { get; set; }
    public decimal MovedIn { get; set; }
    /// <summary>Expected less reported: spending nothing logged where positive; money unaccounted for where negative.</summary>
    public decimal Gap { get; set; }
    public double Odometer { get; set; }
    public string Note { get; set; } = "";
}

public class FactorStep
{
    public int Week { get; set; }
    public string GameTime { get; set; } = "";
    public decimal Was { get; set; }
    public decimal Measured { get; set; }
    public decimal Fixed { get; set; }
    public decimal Total { get; set; }
    public double Miles { get; set; }
    public double Days { get; set; }
    public bool Changed { get; set; }
    public string Note { get; set; } = "";
}

/// <summary>The monthly bills the Companion App pays out of Nexora: never seen in the game bank.</summary>
public class Bills
{
    public decimal TruckPayment { get; set; }
    public decimal Insurance { get; set; }
    public decimal Maintenance { get; set; }
    public decimal Other { get; set; }
    public decimal Total => TruckPayment + Insurance + Maintenance + Other;
}

public static class Finance
{
    /// <summary>The cost factor looks back this far: four weeks, so one bad week does not swing it.</summary>
    public const double WindowDays = 28;
    /// <summary>Under this many miles in the window there is too little to go on, and the factor is left as it is.</summary>
    public const double MinMiles = 300;

    /// <summary>The Monday of the week a game day falls in. Day 1 is a Monday.</summary>
    public static int Monday(int day) => day - (((day - 1) % 7) + 7) % 7;

    private static int Today(OoCareer c) => GameClock.DayOf(c.Game.Status.GameTime) ?? 1;
    private static DateTime Now(OoCareer c) => GameClock.TryParse(c.Game.Status.GameTime) ?? GameClock.Epoch;
    private static DateTime StartOf(int day) => GameClock.FromDay(day, 0, 0);

    /// <summary>Tracking begins this week: on a new career, and on the first load of one from before it. Nothing else moves.</summary>
    public static void Ensure(OoCareer c)
    {
        if (!c.Started || c.Finance.StartWeek > 0) return;
        c.Finance.StartWeek = Monday(Today(c));
        c.Finance.StartOdometer = c.Game.Status.AtsOdometer;
    }

    /// <summary>Keeps the odometer where it moved since the last reading. Called after every change to the career.</summary>
    public static void Sample(OoCareer c)
    {
        if (!c.Started || c.Finance.StartWeek <= 0) return;
        var odo = c.Game.Status.AtsOdometer;
        var last = c.Finance.Odometer.LastOrDefault();
        if (last != null && Math.Abs(last.Miles - odo) < 0.5) return;
        c.Finance.Odometer.Add(new OdoReading { GameTime = c.Game.Status.GameTime, Miles = odo });
    }

    /// <summary>The odometer as it stood at a moment: the last reading at or before it, the reading now counted as of now.</summary>
    private static double OdoAt(OoCareer c, DateTime at)
    {
        var readings = c.Finance.Odometer.Append(new OdoReading { GameTime = c.Game.Status.GameTime, Miles = c.Game.Status.AtsOdometer });
        var before = readings.Where(r => GameClock.TryParse(r.GameTime) is { } t && t <= at).OrderBy(r => r.GameTime).LastOrDefault();
        return before?.Miles ?? c.Finance.StartOdometer;
    }

    /// <summary>The Monday whose check is waiting, or null: a game Monday has come round since the last check.</summary>
    public static int? CheckDue(OoCareer c)
    {
        if (!c.Started || c.Finance.StartWeek <= 0) return null;
        var week = Monday(Today(c));
        var last = c.Finance.Checks.Count > 0 ? c.Finance.Checks.Max(x => x.Week) : 0;
        return week > Math.Max(c.Finance.StartWeek, last) ? week : null;
    }

    // ---------------------------------------------------------------- fuel

    /// <summary>A fill, logged as it happens. On a run it goes on the trip log as well (see Run.Event), counted once here.</summary>
    public static FuelBuy LogFuel(OoCareer c, FuelBuy f)
    {
        if (f.Gallons <= 0 && f.Total <= 0) throw new InvalidOperationException("The gallons, and the price per gallon or the total.");
        if (f.Total <= 0) f.Total = Math.Round((decimal)f.Gallons * f.PricePerGal, 2);
        if (f.PricePerGal <= 0 && f.Gallons > 0) f.PricePerGal = Math.Round(f.Total / (decimal)f.Gallons, 3);
        if (string.IsNullOrWhiteSpace(f.GameTime)) f.GameTime = c.Game.Status.GameTime;
        if (string.IsNullOrWhiteSpace(f.City)) { f.City = c.Game.Status.LocationCity; f.State = c.Game.Status.LocationState; }
        c.Finance.Fuel.Add(f);
        // Paid out of the game bank: the estimate follows, so the Monday check does not count it twice.
        if (c.GameBank.Estimate is { } bank) c.GameBank.Estimate = bank - f.Total;
        OoStore.Log(c, "money", $"Fuel: {f.Gallons:0.#} gal at {Units.Money(f.PricePerGal)} in {f.City}, {f.State}, {Units.Money(f.Total)}.", f.TripNumber);
        return f;
    }

    // ---------------------------------------------------------------- the game bank checked

    /// <summary>
    /// A fresh reading of the game bank. Where the app knew what to expect, the gap is what went out that nothing logged
    /// (tolls, tickets, in-game repairs) and is kept as other spending. A bank higher than expected is money the app
    /// was not told of, kept on the check but not counted as income.
    /// </summary>
    public static decimal? ReportBalance(OoCareer c, decimal balance, decimal movedIn, string source, out decimal? expected)
    {
        expected = c.GameBank.Estimate is { } e ? e + movedIn : null;
        var gap = expected is { } x ? Math.Round(x - balance, 2) : (decimal?)null;
        if (gap is > 0.5m)
            c.Finance.Other.Add(new Spend { GameTime = c.Game.Status.GameTime, Amount = gap.Value, Source = source });
        Ledger.ReportGameBank(c, balance);
        return gap;
    }

    /// <summary>The Monday check: the balance, what was moved in, then the cost factor worked out again.</summary>
    public static string Check(OoCareer c, decimal balance, decimal movedIn, string? note)
    {
        var week = CheckDue(c) ?? throw new InvalidOperationException("No check is due: the next one is on the game's next Monday.");
        if (balance < 0 || movedIn < 0) throw new InvalidOperationException("The game bank as the game shows it, and what you moved in.");
        var gap = ReportBalance(c, balance, movedIn, "Monday check", out var expected);
        c.Finance.Checks.Add(new WeekCheck
        {
            Week = week, GameTime = c.Game.Status.GameTime, Reported = balance, Expected = expected, MovedIn = movedIn,
            Gap = gap ?? 0, Odometer = c.Game.Status.AtsOdometer, Note = note ?? "",
        });
        var said = gap switch
        {
            null => $"Game bank {Units.Money(balance)}: the first reading, so nothing to check it against yet.",
            > 0.5m => $"Game bank {Units.Money(balance)} against {Units.Money(expected!.Value)} expected: {Units.Money(gap.Value)} went out that nothing logged (tolls, tickets, repairs). Counted as this week's other spending.",
            < -0.5m => $"Game bank {Units.Money(balance)}, {Units.Money(-gap.Value)} more than expected. Money in that was not entered? It is noted, not counted as income.",
            _ => $"Game bank {Units.Money(balance)}: just as expected.",
        };
        var step = Recalc(c, week);
        said += " " + step.Note;
        OoStore.Log(c, "money", said);
        return said;
    }

    public static void SetBills(OoCareer c, Bills b)
    {
        if (b.TruckPayment < 0 || b.Insurance < 0 || b.Maintenance < 0 || b.Other < 0) throw new InvalidOperationException("Monthly amounts, none below zero.");
        c.Finance.Bills = b;
        OoStore.Log(c, "money", $"Monthly bills: {Units.Money(b.Total)} (truck {Units.Money(b.TruckPayment)}, insurance {Units.Money(b.Insurance)}, " +
                                $"maintenance {Units.Money(b.Maintenance)}, other {Units.Money(b.Other)}). In the cost factor from the next Monday check.");
    }

    // ---------------------------------------------------------------- the cost factor

    /// <summary>Miles driven since a moment, off the odometer: the reading at the last check before it, or where tracking began.</summary>
    private static (double Miles, DateTime From) MilesSince(OoCareer c, DateTime from)
    {
        var start = StartOf(c.Finance.StartWeek);
        if (from < start) from = start;
        var before = c.Finance.Checks.Where(x => GameClock.TryParse(x.GameTime) is { } t && t <= from).OrderBy(x => x.GameTime).LastOrDefault();
        var odo = before?.Odometer ?? c.Finance.StartOdometer;
        var at = before != null ? GameClock.TryParse(before.GameTime)!.Value : start;
        return (Math.Max(0, c.Game.Status.AtsOdometer - odo), at);
    }

    private static decimal SpentSince(OoCareer c, DateTime from) =>
        c.Finance.Fuel.Where(f => GameClock.TryParse(f.GameTime) is { } t && t >= from).Sum(f => f.Total)
        + c.Finance.Other.Where(o => GameClock.TryParse(o.GameTime) is { } t && t >= from).Sum(o => o.Amount);

    /// <summary>
    /// The cost factor, worked out again: fuel and other spending per mile over the last four weeks (or since tracking
    /// began), plus the month's bills spread over the miles actually driven. With no bills entered yet, the rest of the
    /// old factor is held for them, so loads do not suddenly look better than they are.
    /// </summary>
    public static FactorStep Recalc(OoCareer c, int week)
    {
        var now = Now(c);
        var (miles, from) = MilesSince(c, now.AddDays(-WindowDays));
        var days = Math.Max(1, (now - from).TotalDays);
        var was = c.Settings.CostPerMile;
        var step = new FactorStep { Week = week, GameTime = c.Game.Status.GameTime, Was = was, Total = was, Miles = Math.Round(miles), Days = Math.Round(days, 1) };
        if (miles < MinMiles)
        {
            step.Note = $"Cost factor left at {Units.Money(was)}/mi: only {miles:N0} mi driven since {GameClock.Pretty(GameClock.Format(from))}, too few to go on.";
            c.Finance.Factor.Add(step);
            return step;
        }
        var spent = SpentSince(c, from);
        step.Measured = Math.Round(spent / (decimal)miles, 3);
        var bills = c.Finance.Bills.Total;
        step.Fixed = bills > 0
            ? Math.Round(bills * 12m / 365m * (decimal)days / (decimal)miles, 3)
            : Math.Max(0, Math.Round(was - step.Measured, 3));
        step.Total = Math.Max(0.25m, Math.Round(step.Measured + step.Fixed, 3));
        step.Changed = step.Total != was;
        c.Settings.CostPerMile = step.Total;
        step.Note = $"Cost factor {Units.Money(was)} → {Units.Money(step.Total)}/mi: fuel and other spending {Units.Money(step.Measured)}/mi over {miles:N0} mi, " +
                    (bills > 0 ? $"plus {Units.Money(step.Fixed)}/mi of your {Units.Money(bills)} a month in bills."
                               : $"plus {Units.Money(step.Fixed)}/mi held for your bills (enter them on Financial health to have it worked out).");
        c.Finance.Factor.Add(step);
        return step;
    }

    // ---------------------------------------------------------------- the figures

    private record Delivered(Booking Booking, Trip? Trip, Invoice? Invoice, DateTime At);

    private static List<Delivered> Deliveries(OoCareer c) =>
        c.Bookings.Where(k => k.Status == BookingStatus.Delivered)
            .Select(k => (k, t: Run.Trip(c, k)))
            .Select(x => new Delivered(x.k, x.t, c.Invoices.FirstOrDefault(i => i.BookingId == x.k.Id),
                GameClock.TryParse(x.t?.DeliveredGameTime) ?? GameClock.TryParse(x.t?.ClosedUtc) ?? GameClock.Epoch))
            .OrderByDescending(d => d.At).ToList();

    /// <summary>Miles a delivered load ran, off the odometer where read: from dispatch (so the run empty to the shipper too) to the drop.</summary>
    private static (double Total, double Empty) MilesOf(Delivered d)
    {
        var t = d.Trip;
        if (t == null) return (d.Booking.Load.LoadedMiles + d.Booking.Load.DeadheadMiles, d.Booking.Load.DeadheadMiles);
        var empty = t.StartOdometer > 0 && t.DispatchOdometer > 0 ? Math.Max(0, t.StartOdometer - t.DispatchOdometer) : t.DeadheadMiles;
        var total = t.EndOdometer > 0 && t.DispatchOdometer > 0 ? Math.Max(0, t.EndOdometer - t.DispatchOdometer) : t.ActualMiles + empty;
        return (total, empty);
    }

    private static decimal DetentionOf(Invoice? i) => i != null && i.DetentionStatus is "Billed" or "Granted" or "Factored" ? i.DetentionAmount : 0;
    private static decimal FeesOf(Invoice? i) => i == null ? 0 : i.QuickPayFee + i.FactorFee;

    /// <summary>Game weeks, newest first: loads, miles, what was earned, the fees, fuel, other spending and what was left.</summary>
    public static List<object> Weeks(OoCareer c, int count = 8)
    {
        var all = Deliveries(c);
        var thisWeek = Monday(Today(c));
        var weeks = new List<object>();
        for (var n = 0; n < count; n++)
        {
            var monday = thisWeek - 7 * n;
            if (monday < 1) break;
            var from = StartOf(monday);
            var to = from.AddDays(7);
            bool In(string? at) => GameClock.TryParse(at) is { } t && t >= from && t < to;
            var loads = all.Where(d => d.At >= from && d.At < to).ToList();
            // Every mile the truck ran that week, off the odometer: to the shipper, between loads and home as well.
            var tracked = monday >= c.Finance.StartWeek;
            var loaded = loads.Sum(d => d.Trip?.ActualMiles > 0 ? d.Trip.ActualMiles : d.Booking.Load.LoadedMiles);
            var odoMiles = tracked ? Math.Max(0, OdoAt(c, to) - OdoAt(c, from)) : 0;
            var miles = Math.Max(odoMiles, loads.Sum(d => MilesOf(d).Total));
            var empty = Math.Max(0, miles - loaded);
            var tonu = c.Invoices.Where(i => i.GamePay <= 0 && i.BookingNumber.StartsWith("LN-") && In(i.IssuedGameTime)).Sum(i => i.Amount);
            var earned = loads.Sum(d => d.Booking.Rate + DetentionOf(d.Invoice)) + tonu;
            var fees = loads.Sum(d => FeesOf(d.Invoice));
            var fuel = c.Finance.Fuel.Where(f => In(f.GameTime)).Sum(f => f.Total);
            var other = c.Finance.Other.Where(o => In(o.GameTime)).Sum(o => o.Amount);
            var net = earned - fees - fuel - other;
            weeks.Add(new
            {
                monday, label = $"Week of Day {monday}", loads = loads.Count, miles = Math.Round(miles), emptyPct = miles > 0 ? Math.Round(empty / miles * 100) : 0,
                earned, fees, fuel, other, net, netPerMile = miles > 0 ? Math.Round(net / (decimal)miles, 2) : (decimal?)null,
                earnedPerMile = miles > 0 ? Math.Round(earned / (decimal)miles, 2) : (decimal?)null,
                current = n == 0, tracked = monday >= c.Finance.StartWeek,
            });
        }
        return weeks;
    }

    public static object FuelView(OoCareer c)
    {
        var now = Now(c);
        object Span(IEnumerable<FuelBuy> buys)
        {
            var list = buys.ToList();
            var gallons = list.Sum(f => f.Gallons);
            var spent = list.Sum(f => f.Total);
            // Real MPG from fills with an odometer: the miles between the first and last, over the fuel put in after the first.
            var read = list.Where(f => f.Odometer is > 0).OrderBy(f => f.GameTime).ToList();
            double? mpg = null; decimal? perMile = null;
            if (read.Count >= 2 && read[^1].Odometer - read[0].Odometer is > 50 and var span)
            {
                var after = read.Skip(1).ToList();
                var g = after.Sum(f => f.Gallons);
                if (g > 0) mpg = Math.Round(span / g, 2);
                perMile = Math.Round(after.Sum(f => f.Total) / (decimal)span, 3);
            }
            return new
            {
                fills = list.Count, gallons = Math.Round(gallons, 1), spent,
                avgPrice = gallons > 0 ? Math.Round(spent / (decimal)gallons, 3) : (decimal?)null, mpg, perMile,
            };
        }
        return new
        {
            recent = Span(c.Finance.Fuel.Where(f => GameClock.TryParse(f.GameTime) is { } t && t >= now.AddDays(-WindowDays))),
            all = Span(c.Finance.Fuel),
            log = c.Finance.Fuel.OrderByDescending(f => f.GameTime).Take(20),
        };
    }

    public static List<object> Loads(OoCareer c, int count = 10) =>
        Deliveries(c).Take(count).Select(d =>
        {
            var (total, empty) = MilesOf(d);
            var loaded = d.Trip?.ActualMiles > 0 ? d.Trip.ActualMiles : d.Booking.Load.LoadedMiles;
            var fees = FeesOf(d.Invoice);
            var cost = Math.Round(c.Settings.CostPerMile * (decimal)total, 2);
            var earned = d.Booking.Rate + DetentionOf(d.Invoice);
            return (object)new
            {
                d.Booking.Number, d.Booking.Load.Cargo, to = $"{d.Booking.Load.DestCity}, {d.Booking.Load.DestState}", d.Booking.BrokerName,
                delivered = GameClock.Format(d.At), gamePay = d.Booking.GamePay, rate = d.Booking.Rate,
                brokerCutPct = d.Booking.GamePay > 0 ? Math.Round((1 - d.Booking.Rate / d.Booking.GamePay) * 100, 1) : 0,
                loadedMiles = Math.Round(loaded), miles = Math.Round(total), emptyMiles = Math.Round(empty),
                ratePerMile = loaded > 0 ? Math.Round(d.Booking.Rate / (decimal)loaded, 2) : 0,
                detention = DetentionOf(d.Invoice), fees, estCost = cost, left = earned - fees - cost,
            };
        }).ToList();

    public static object BrokersView(OoCareer c)
    {
        var now = Now(c);
        var all = Deliveries(c);
        var brokers = all.GroupBy(d => d.Booking.BrokerId).Select(g =>
        {
            var loaded = g.Sum(d => d.Trip?.ActualMiles > 0 ? d.Trip.ActualMiles : d.Booking.Load.LoadedMiles);
            var paid = g.Select(d => d.Invoice).Where(i => i is { Status: "Paid", FactorFee: 0 })
                .Select(i => (GameClock.TryParse(i!.PaidGameTime) - GameClock.TryParse(i.IssuedGameTime))?.TotalDays).Where(x => x != null).ToList();
            var owed = c.Invoices.Where(i => i.BrokerId == g.Key && i.Status is "Open" or "Overdue" or "Collections").Sum(i => i.Amount);
            var b = c.Brokers.FirstOrDefault(x => x.Id == g.Key);
            return new
            {
                id = g.Key, name = b?.Name ?? g.First().Booking.BrokerName, credit = b?.Credit ?? "", loads = g.Count(),
                avgRatePerMile = loaded > 0 ? Math.Round(g.Sum(d => d.Booking.Rate) / (decimal)loaded, 2) : 0,
                avgDaysToPay = paid.Count > 0 ? Math.Round(paid.Average(x => x!.Value), 1) : (double?)null, owed,
            };
        }).OrderByDescending(x => x.loads).ToList();
        var open = c.Invoices.Where(i => i.Status is "Open" or "Overdue" or "Collections").ToList();
        decimal Aged(Func<double, bool> band) => open.Where(i => i.Status == "Open" && band((now - (GameClock.TryParse(i.IssuedGameTime) ?? now)).TotalDays)).Sum(i => i.Amount);
        return new
        {
            brokers,
            aging = new
            {
                under7 = Aged(d => d < 7), to30 = Aged(d => d >= 7 && d <= 30), over30 = Aged(d => d > 30),
                overdue = open.Where(i => i.Status == "Overdue").Sum(i => i.Amount),
                collections = open.Where(i => i.Status == "Collections").Sum(i => i.Amount),
                total = open.Sum(i => i.Amount),
            },
        };
    }

    /// <summary>The Monday check as the form needs it: what the app expects the bank to read, and what went into that.</summary>
    public static object? CheckView(OoCareer c)
    {
        if (CheckDue(c) is not { } week) return null;
        var last = c.Finance.Checks.OrderBy(x => x.GameTime).LastOrDefault();
        var since = GameClock.TryParse(c.GameBank.ReportedGameTime) ?? StartOf(c.Finance.StartWeek);
        return new
        {
            week, expected = c.GameBank.Estimate, lastReported = c.GameBank.Reported, lastReportedGameTime = c.GameBank.ReportedGameTime,
            fuelSince = c.Finance.Fuel.Where(f => GameClock.TryParse(f.GameTime) is { } t && t >= since).Sum(f => f.Total),
            lastCheck = last?.GameTime,
        };
    }

    /// <summary>Everything the Financial health tab shows.</summary>
    public static object View(OoCareer c)
    {
        var weeks = Weeks(c);
        var now = Now(c);
        var (miles, from) = MilesSince(c, now.AddDays(-WindowDays));
        var spent = SpentSince(c, from);
        return new
        {
            weeks,
            measuredPerMile = miles >= MinMiles ? Math.Round(spent / (decimal)miles, 3) : (decimal?)null,
            measuredMiles = Math.Round(miles),
            owed = c.Invoices.Where(i => i.Status is "Open" or "Overdue" or "Collections").Sum(i => i.Amount),
            fuel = FuelView(c),
            loads = Loads(c),
            brokers = BrokersView(c),
            factor = new
            {
                now = c.Settings.CostPerMile, history = c.Finance.Factor.OrderByDescending(f => f.GameTime).Take(12),
                bills = c.Finance.Bills, billsTotal = c.Finance.Bills.Total,
            },
            checks = c.Finance.Checks.OrderByDescending(x => x.GameTime).Take(8),
            startWeek = c.Finance.StartWeek,
            nextCheck = CheckDue(c) is null ? c.Finance.StartWeek > 0 ? Math.Max(c.Finance.StartWeek, c.Finance.Checks.Count > 0 ? c.Finance.Checks.Max(x => x.Week) : 0) + 7 : 0 : (int?)null,
        };
    }
}

public record FuelRequest(int? Day, string? Time, string? City, string? State, double? Gallons, decimal? PricePerGal, decimal? Total,
                          double? Odometer, double? FuelPct);
public record CheckRequest(decimal Balance, decimal? MovedIn, string? Note);
