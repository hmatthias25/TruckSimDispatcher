using System.Diagnostics;
using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>What a broker owes for a delivered load.</summary>
public class Invoice
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    public string BookingId { get; set; } = "";
    public string BookingNumber { get; set; } = "";
    public string BrokerId { get; set; } = "";
    public string BrokerName { get; set; } = "";
    public decimal Amount { get; set; }
    /// <summary>What the game paid for the same load, which goes to Broker holding.</summary>
    public decimal GamePay { get; set; }
    public string IssuedGameTime { get; set; } = "";
    public string DueGameTime { get; set; } = "";
    /// <summary>Open or Paid.</summary>
    public string Status { get; set; } = "Open";
    public string PaidGameTime { get; set; } = "";
}

/// <summary>
/// Money the player has to move in the GDC Companion App. This app never moves money; it says what, which way and
/// when, and the player says when it is done. See the plan, "Two banks".
/// </summary>
public class Transfer
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    /// <summary>ToHolding (the game's pay, out of the game bank) or ToYou (a paid invoice, out of Broker holding).</summary>
    public string Kind { get; set; } = "";
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public decimal Amount { get; set; }
    public string Reason { get; set; } = "";
    public string Reference { get; set; } = "";
    /// <summary>The Companion App can only move money into or out of the game bank with the game closed.</summary>
    public bool NeedsGameClosed { get; set; }
    public string RaisedGameTime { get; set; } = "";
    /// <summary>Pending or Done.</summary>
    public string Status { get; set; } = "Pending";
    public string DoneGameTime { get; set; } = "";
}

public static class Accounts
{
    public const string GameBank = "Game bank";
    /// <summary>The account in the Companion App that holds delivery pay until the broker pays. Not the player's.</summary>
    public const string Holding = "Broker holding";
    /// <summary>The player's own account in the Companion App.</summary>
    public const string Yours = "Your account";
    /// <summary>Money from outside the game: only a TONU, which a broker pays for a lane that came to nothing.</summary>
    public const string Outside = "Paid by the broker";
}

/// <summary>
/// What the app knows of the game bank: the balance the player last reported, kept current since by what this app
/// knows moved (delivery pay in, moves to Broker holding out). Spending in the game is not seen, so a fresh reading
/// replaces the estimate.
/// </summary>
public class GameBankState
{
    public decimal? Estimate { get; set; }
    public decimal? Reported { get; set; }
    public string ReportedGameTime { get; set; } = "";
}

/// <summary>Delivery, invoices, and the transfers they raise.</summary>
public static class Ledger
{
    /// <summary>
    /// The booked load is delivered. The game has just paid its figure into the game bank, which is the shipper's
    /// money and not the player's; the broker owes the booked rate on their terms.
    /// </summary>
    public static Invoice Deliver(OoCareer c, DeliverRequest r)
    {
        var k = Calls.ActiveBooking(c) ?? throw new InvalidOperationException("Nothing is booked to deliver.");
        var s = c.Game;
        if (r.Day < 1 || GameClock.FromDayTime(r.Day, r.Time) is not { } at)
            throw new InvalidOperationException("When you delivered: the game day and time.");
        if (GameClock.TryParse(k.BookedGameTime) is { } booked && at < booked)
            throw new InvalidOperationException("That is before the load was booked. Check the day and time.");
        if (r.Odometer is { } odo && odo < s.Status.AtsOdometer)
            throw new InvalidOperationException($"The odometer reads lower than the {s.Status.AtsOdometer:N0} on file. Check the number.");

        var wasTime = s.Status.GameTime;
        var wasHome = HomeLife.AtHome(c);

        // The window is the time to be there by, the same way the company-driver app grades it. With a trip on the
        // log, Core closes it and judges it on the arrival it logged; without one, on the time given here.
        var findings = new List<string>();
        if (Run.Trip(c, k) is { } trip)
        {
            var (said, lateByClock) = Run.Close(c, trip, at, r.Odometer);
            findings = said;
            k.Late = lateByClock ?? (GameClock.TryParse(k.BookedGameTime) is { } f0 && at > f0.AddHours(k.Load.DeadlineHours));
        }
        else
            k.Late = GameClock.TryParse(k.BookedGameTime) is { } from && at > from.AddHours(k.Load.DeadlineHours);
        k.Status = BookingStatus.Delivered;

        // The truck is where the load went.
        var moved = !k.Load.DestCity.Equals(s.Status.LocationCity, StringComparison.OrdinalIgnoreCase);
        s.Status.LocationCity = k.Load.DestCity;
        s.Status.LocationState = k.Load.DestState;
        s.Status.LocationKind = "Receiver";
        s.Status.GameTime = GameClock.Format(at);
        if (r.Odometer is { } o) s.Status.AtsOdometer = o;
        if (moved) s.Board.Clear();
        if (!DiscoveryService.IsDiscovered(s, s.Status.LocationCity, s.Status.LocationState))
        {
            s.Discovered.Add(new DiscoveredCity { City = s.Status.LocationCity, State = s.Status.LocationState, DiscoveredGameTime = s.Status.GameTime, Notified = true });
            foreach (var joined in BrokerBook.Refresh(c))
                OoStore.Log(c, "broker", $"{joined.Name} ({joined.Tier.ToLowerInvariant()}, {joined.City}, {joined.State}) is in your directory now.");
        }

        var broker = c.Brokers.FirstOrDefault(b => b.Id == k.BrokerId);
        if (broker != null) broker.Standing = Math.Clamp(broker.Standing + (k.Late ? -10 : 5), -100, 100);

        var invoice = new Invoice
        {
            Number = $"INV-{c.Invoices.Count + 1:000}",
            BookingId = k.Id,
            BookingNumber = k.Number,
            BrokerId = k.BrokerId,
            BrokerName = k.BrokerName,
            Amount = k.Rate,
            GamePay = k.GamePay,
            IssuedGameTime = s.Status.GameTime,
            DueGameTime = GameClock.Format(at.AddDays(Math.Max(1, k.DaysToPay))),
        };
        c.Invoices.Add(invoice);

        // The game has just paid its figure into the game bank. All of it goes to Broker holding, so the game bank
        // only ever holds money the player can spend.
        if (c.GameBank.Estimate is { } bank) c.GameBank.Estimate = bank + k.GamePay;
        Raise(c, "ToHolding", Accounts.GameBank, Accounts.Holding, k.GamePay,
              $"The game paid {Units.Money(k.GamePay)} for {k.Number}. Move all of it to Broker holding in the Companion App: " +
              $"it is the shipper's money, not yours until {k.BrokerName} pays. Close the game first.", k.Number, needsGameClosed: true);

        foreach (var f in findings) OoStore.Log(c, "run", f, k.Number);
        OoStore.Log(c, "money", $"{k.Number} delivered{(k.Late ? " late" : " on time")} at {k.Load.DestCity}, {k.Load.DestState}. " +
                                $"{invoice.Number} to {k.BrokerName} for {Units.Money(invoice.Amount)}, due {GameClock.Pretty(invoice.DueGameTime)}.", k.Number);
        Advance(c);
        HomeLife.Advance(c, wasTime, wasHome);
        return invoice;
    }

    /// <summary>
    /// Brokers pay what has come due by the game clock. Called whenever the clock moves. A paid invoice is what the
    /// player may move out of Broker holding into their own account.
    /// </summary>
    public static List<Invoice> Advance(OoCareer c)
    {
        var now = GameClock.TryParse(c.Game.Status.GameTime);
        var paid = new List<Invoice>();
        if (now == null) return paid;
        foreach (var inv in c.Invoices.Where(i => i.Status == "Open"))
        {
            if (GameClock.TryParse(inv.DueGameTime) is not { } due || now < due) continue;
            inv.Status = "Paid";
            inv.PaidGameTime = c.Game.Status.GameTime;
            paid.Add(inv);

            // What is yours to move: the rate. Rates never go above the game's pay, so the load's pay always covers it;
            // the rest is the broker's share and stays in Broker holding (agreed 2026-10-18).
            if (inv.GamePay <= 0)
            {
                // A TONU: the broker's own money, never in the game bank or Broker holding.
                Raise(c, "TopUp", Accounts.Outside, Accounts.Yours, inv.Amount,
                      $"{inv.BrokerName} paid the {Units.Money(inv.Amount)} TONU on {inv.BookingNumber}. Add it to your account as income.",
                      inv.Number, false);
                OoStore.Log(c, "money", $"{inv.BrokerName} paid {inv.Number}: {Units.Money(inv.Amount)}.", inv.Number);
                continue;
            }
            var fromHolding = Math.Min(inv.Amount, inv.GamePay);
            Raise(c, "ToYou", Accounts.Holding, Accounts.Yours, fromHolding,
                  $"{inv.BrokerName} paid {inv.Number}. Move {Units.Money(fromHolding)} out of Broker holding into your account." +
                  (inv.GamePay > inv.Amount ? $" The other {Units.Money(inv.GamePay - inv.Amount)} of {inv.BookingNumber}'s pay is the broker's share: leave it in Broker holding." : ""),
                  inv.Number, false);

            OoStore.Log(c, "money", $"{inv.BrokerName} paid {inv.Number}: {Units.Money(inv.Amount)}.", inv.Number);
        }
        return paid;
    }

    /// <summary>
    /// The booked load handed back to the broker: a cancellation on the carrier's record. What the call from home
    /// costs when the load cannot be delivered on the way. Cancel the job in the game as well.
    /// </summary>
    public static Booking HandBack(OoCareer c, string why)
    {
        var k = Calls.ActiveBooking(c) ?? throw new InvalidOperationException("Nothing is booked to hand back.");
        k.Status = BookingStatus.Cancelled;
        k.OnCarrier = true;
        if (Run.Trip(c, k) is { } trip)
        {
            trip.Status = "Cancelled";
            trip.CancelReason = why;
            c.Game.Status.ActiveTripId = "";
        }
        if (c.Brokers.FirstOrDefault(b => b.Id == k.BrokerId) is { } broker)
            broker.Standing = Math.Max(-100, broker.Standing - 15);
        OoStore.Log(c, "broker", $"{k.Number} handed back to {k.BrokerName}{(string.IsNullOrWhiteSpace(why) ? "" : $": {why}")}. " +
                                 "That is a cancellation on your record. Cancel the job in the game too.", k.Number);
        return k;
    }

    public static Transfer MarkDone(OoCareer c, string id)
    {
        var t = c.Transfers.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("No such transfer.");
        if (t.Status == "Done") return t;
        if (t.NeedsGameClosed && GameRunning())
            throw new InvalidOperationException("The game is still running. The Companion App can only move money in or out of the game bank with the game closed: close it, make the transfer, then mark it done.");
        t.Status = "Done";
        t.DoneGameTime = c.Game.Status.GameTime;
        if (t.From == Accounts.GameBank && c.GameBank.Estimate is { } bank) c.GameBank.Estimate = bank - t.Amount;
        OoStore.Log(c, "money", $"Moved {Units.Money(t.Amount)}: {t.From} to {t.To} ({t.Reference}).", t.Reference);
        return t;
    }

    /// <summary>Of the game bank, how much is shipper money still waiting to go to Broker holding.</summary>
    public static decimal NotYoursInGameBank(OoCareer c) =>
        c.Transfers.Where(t => t.Kind == "ToHolding" && t.Status == "Pending").Sum(t => t.Amount);

    /// <summary>The game bank as the player last read it. Resets the estimate: spending in the game is not seen otherwise.</summary>
    public static void ReportGameBank(OoCareer c, decimal balance)
    {
        if (balance < 0) throw new InvalidOperationException("The game bank balance, as the game shows it.");
        c.GameBank.Reported = balance;
        c.GameBank.Estimate = balance;
        c.GameBank.ReportedGameTime = c.Game.Status.GameTime;
    }

    /// <summary>
    /// What Broker holding should hold, by what this app has seen move: the game's pay for every load moved in, less what
    /// has gone to the player. Split into what is still waiting on a broker and what is the brokers' share of paid loads.
    /// </summary>
    public static object HoldingView(OoCareer c)
    {
        var movedIn = c.Transfers.Where(t => t.To == Accounts.Holding && t.Status == "Done").Sum(t => t.Amount);
        var movedOut = c.Transfers.Where(t => t.From == Accounts.Holding && t.Status == "Done").Sum(t => t.Amount);
        var waiting = c.Invoices.Where(i => i.Status == "Open").Sum(i => i.GamePay);
        var brokers = c.Invoices.Where(i => i.Status == "Paid").Sum(i => Math.Max(0, i.GamePay - i.Amount));
        var yoursToMove = c.Transfers.Where(t => t.Kind == "ToYou" && t.Status == "Pending").Sum(t => t.Amount);
        return new { balance = movedIn - movedOut, waitingOnBrokers = waiting, brokersShare = brokers, yoursToMove };
    }

    /// <summary>The game bank: the estimate, what of it is not yours, and what is left to spend.</summary>
    public static object GameBankView(OoCareer c)
    {
        var notYours = NotYoursInGameBank(c);
        return new
        {
            estimate = c.GameBank.Estimate,
            reported = c.GameBank.Reported,
            reportedGameTime = c.GameBank.ReportedGameTime,
            notYours,
            allowedToSpend = c.GameBank.Estimate is { } e ? Math.Max(0, e - notYours) : (decimal?)null,
        };
    }

    /// <summary>
    /// Whether ATS or ETS2 is running on this PC. Both apps are on the same machine, so the process list says so.
    /// TSO_GAME_RUNNING overrides it, for the tests.
    /// </summary>
    public static bool GameRunning()
    {
        var forced = Environment.GetEnvironmentVariable("TSO_GAME_RUNNING");
        if (!string.IsNullOrWhiteSpace(forced)) return forced == "1";
        try
        {
            return Process.GetProcessesByName("amtrucks").Length > 0 || Process.GetProcessesByName("eurotrucks2").Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private static void Raise(OoCareer c, string kind, string from, string to, decimal amount, string reason, string reference, bool needsGameClosed)
    {
        if (amount <= 0) return;
        c.Transfers.Add(new Transfer
        {
            Kind = kind, From = from, To = to, Amount = Math.Round(amount, 2), Reason = reason, Reference = reference,
            NeedsGameClosed = needsGameClosed, RaisedGameTime = c.Game.Status.GameTime,
        });
    }
}

public record DeliverRequest(int Day, string? Time, double? Odometer);
