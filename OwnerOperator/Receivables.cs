using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// Getting paid: when a broker really pays (by their credit), detention and its disputes, factoring, chasing a slow
/// payer, collections and writing one off. See the plan, "Getting paid".
/// </summary>
public static class Receivables
{
    /// <summary>A factor's fee, by the broker's credit. A D-credit invoice is not bought at all.</summary>
    public static decimal FactorFeePct(string credit) => credit switch { "A" => 2.5m, "B" => 3.5m, "C" => 6m, _ => 0m };

    /// <summary>What collections keeps of a broker who would not pay.</summary>
    public const decimal CollectionsShare = 0.5m;

    /// <summary>
    /// When this broker will really pay, decided once at the invoice: on time at A, a day or two late at B, a week or
    /// so late at C, and at D perhaps never.
    /// </summary>
    public static void SetTerms(OoCareer c, Invoice inv, Broker b)
    {
        inv.Credit = b.Credit;
        var roll = BrokerBook.Stable("pay|" + inv.Id);
        var due = GameClock.TryParse(inv.DueGameTime) ?? DateTime.MinValue;
        var (late, will) = b.Credit switch
        {
            "A" => (0, true),
            "B" => (roll % 3, true),
            "C" => (3 + roll % 8, true),
            _ => (10 + roll % 11, roll % 100 >= 40),
        };
        inv.WillPay = will;
        inv.PaysGameTime = GameClock.Format(due.AddDays(late));
    }

    /// <summary>
    /// Detention on a delivered load, where it was agreed on the call: the hours past the free time, off the dock times
    /// the run logged. A hustler always argues it, a grinder sometimes.
    /// </summary>
    public static void BillDetention(OoCareer c, Invoice inv, Booking k, Trip? trip, Broker b)
    {
        if (k.DetentionPerHour <= 0 || trip == null || trip.DetentionHours <= 0.01) return;
        inv.DetentionHours = Math.Round(trip.DetentionHours, 2);
        inv.DetentionAmount = Math.Round((decimal)inv.DetentionHours * k.DetentionPerHour, 2);
        var argues = b.Personality == "Hustler" || (b.Personality == "Grinder" && BrokerBook.Stable("det|" + inv.Id) % 2 == 0);
        inv.DetentionStatus = argues ? "Disputed" : "Billed";
        OoStore.Log(c, "money", $"{inv.Number}: detention {Hhmm.Of(inv.DetentionHours)} at {Units.Money(k.DetentionPerHour)}/h, " +
                                $"{Units.Money(inv.DetentionAmount)}" + (argues ? $". {b.Name} disputes it: argue it with your log." : "."), inv.Number);
    }

    /// <summary>Arguing disputed detention with the trip log: the dock times logged win it; nothing logged loses it.</summary>
    public static string Argue(OoCareer c, string id)
    {
        var inv = Find(c, id);
        if (inv.DetentionStatus != "Disputed") throw new InvalidOperationException("Nothing on that invoice is disputed.");
        var k = c.Bookings.FirstOrDefault(x => x.Id == inv.BookingId);
        var trip = Run.Trip(c, k);
        // The dock pairs where there was a dock; on drop and hook, the gate stamps, which are all there is to log.
        var logged = trip != null && (Pair(trip, "BeginLoad", "EndLoad") || Pair(trip, "BeginUnload", "EndUnload")
                                      || (DropHook.Is(trip.TrailerType) && (trip.ShipperArrivedGameTime.Length > 0 || trip.ArrivedGameTime.Length > 0)));
        inv.DetentionStatus = logged ? "Granted" : "Denied";
        var said = logged
            ? $"{inv.BrokerName} looked at your log: {Units.Money(inv.DetentionAmount)} detention, paid with the invoice."
            : $"{inv.BrokerName}: no dock times on your log, no detention. " +
              (trip != null && DropHook.Is(trip.TrailerType) ? "Report at the shipper and at the receiver next time." : "Log Begin and End at the dock next time.");
        OoStore.Log(c, "money", said, inv.Number);
        return said;

        static bool Pair(Trip t, string a, string b) => t.Events.Any(e => e.Kind == a) && t.Events.Any(e => e.Kind == b);
    }

    /// <summary>Brokers pay what they will, when they will, by the game clock; anything a day past due is overdue.</summary>
    public static void Advance(OoCareer c)
    {
        if (GameClock.TryParse(c.Game.Status.GameTime) is not { } now) return;
        foreach (var inv in c.Invoices.Where(i => i.Status is "Open" or "Overdue" or "Collections" or "Factored").ToList())
        {
            var pays = GameClock.TryParse(string.IsNullOrWhiteSpace(inv.PaysGameTime) ? inv.DueGameTime : inv.PaysGameTime);
            if (inv.WillPay && pays is { } p && now >= p)
            {
                if (inv.Status == "Factored")
                {
                    inv.Status = "Paid";
                    inv.PaidGameTime = c.Game.Status.GameTime;
                    OoStore.Log(c, "money", $"{inv.BrokerName} paid the factor on {inv.Number}. Nothing more to you: it was sold.", inv.Number);
                    continue;
                }
                Pay(c, inv, inv.Status == "Collections" ? CollectionsShare : 1m);
                continue;
            }
            if (inv.Status == "Open" && GameClock.TryParse(inv.DueGameTime) is { } due && now > due.AddDays(1))
            {
                inv.Status = "Overdue";
                OoStore.Log(c, "money", $"{inv.Number} is overdue: {inv.BrokerName} has not paid. Chase them on the Money tab.", inv.Number);
            }
        }
    }

    /// <summary>Paid: the rate is the player's to move out of Broker holding, and agreed detention comes in from the broker.</summary>
    private static void Pay(OoCareer c, Invoice inv, decimal share)
    {
        inv.Status = "Paid";
        inv.PaidGameTime = c.Game.Status.GameTime;
        var rate = Math.Round(inv.Amount * share, 2);
        if (inv.GamePay <= 0)
            FromShare(c, rate, $"{inv.BrokerName} paid the {Units.Money(rate)} on {inv.Number} ({inv.BookingNumber}).", inv.Number);
        else
        {
            var fromHolding = Math.Min(rate, inv.GamePay);
            Ledger.Raise(c, "ToYou", Accounts.Holding, Accounts.Yours, fromHolding,
                $"{inv.BrokerName} paid {inv.Number}. Move {Units.Money(fromHolding)} out of Broker holding into your account." +
                (inv.GamePay > fromHolding
                    ? share < 1
                        ? $" The other {Units.Money(inv.GamePay - fromHolding)} of {inv.BookingNumber}'s pay stays in Broker holding: collections kept the rest."
                        : $" The other {Units.Money(inv.GamePay - fromHolding)} of {inv.BookingNumber}'s pay is the broker's share: leave it in Broker holding."
                    : ""),
                inv.Number, false);
        }
        if (inv.DetentionStatus is "Billed" or "Granted" && inv.DetentionAmount > 0)
            FromShare(c, Math.Round(inv.DetentionAmount * share, 2), $"Detention on {inv.Number}, paid by {inv.BrokerName}.", inv.Number);
        OoStore.Log(c, "money", $"{inv.BrokerName} paid {inv.Number}" + (share < 1 ? $", through collections ({share:P0})" : "") + ".", inv.Number);
    }

    /// <summary>
    /// Sold to a factor for cash now, less a fee. The rate less the fee is the player's to move straight away; the fee
    /// stays in Broker holding as the factor's. The factor collects from the broker, slow or not.
    /// </summary>
    public static string Factor(OoCareer c, string id)
    {
        var inv = Find(c, id);
        if (inv.Status is not ("Open" or "Overdue")) throw new InvalidOperationException("Only an unpaid invoice can be factored.");
        var pct = FactorFeePct(inv.Credit);
        if (pct <= 0) throw new InvalidOperationException($"No factor will buy an invoice on {inv.BrokerName}: their credit is too poor.");
        var fee = Math.Round(inv.Amount * pct / 100m, 2);
        inv.FactorFee = fee;
        inv.Status = "Factored";
        // The factor collects in the end; whether the broker is slow is now the factor's problem.
        inv.WillPay = true;
        var advance = inv.Amount - fee;
        if (inv.GamePay > 0)
            Ledger.Raise(c, "ToYou", Accounts.Holding, Accounts.Yours, Math.Min(advance, inv.GamePay),
                $"{inv.Number} factored at {pct}%: move {Units.Money(Math.Min(advance, inv.GamePay))} out of Broker holding into your account now. The {Units.Money(fee)} fee stays in Broker holding as the factor's.",
                inv.Number, false);
        else
            FromShare(c, advance, $"{inv.Number} factored at {pct}%.", inv.Number);
        if (inv.DetentionStatus is "Billed" or "Granted" && inv.DetentionAmount > 0)
        {
            FromShare(c, Math.Round(inv.DetentionAmount * (1 - pct / 100m), 2), $"Detention on {inv.Number}, factored with it.", inv.Number);
            inv.DetentionStatus = "Factored";
        }
        var said = $"{inv.Number} sold to a factor: {Units.Money(advance)} now, {Units.Money(fee)} fee.";
        OoStore.Log(c, "money", said, inv.Number);
        return said;
    }

    /// <summary>
    /// Chasing an overdue invoice. A broker who means to pay pays sooner. One who does not: the first call gets a promise,
    /// and after that it goes to collections, which get half, in a fortnight.
    /// </summary>
    public static string Chase(OoCareer c, string id)
    {
        var inv = Find(c, id);
        if (inv.Status != "Overdue") throw new InvalidOperationException("Only an overdue invoice needs chasing.");
        inv.Chases++;
        var now = GameClock.TryParse(c.Game.Status.GameTime) ?? DateTime.MinValue;
        string said;
        if (inv.WillPay)
        {
            var pays = GameClock.TryParse(inv.PaysGameTime) ?? now;
            var sooner = pays.AddDays(-3) > now.AddDays(1) ? pays.AddDays(-3) : now.AddDays(1);
            inv.PaysGameTime = GameClock.Format(sooner);
            said = $"{inv.BrokerName}: \"The check's going out, you'll have it by {GameClock.Pretty(inv.PaysGameTime)}.\"";
        }
        else if (inv.Chases == 1)
            said = $"{inv.BrokerName}: \"Let me look into it and get back to you.\" They won't. Chase again to send it to collections.";
        else
        {
            inv.Status = "Collections";
            inv.WillPay = true;
            inv.PaysGameTime = GameClock.Format(now.AddDays(15));
            said = $"{inv.Number} goes to collections. Expect half of it, about {GameClock.Pretty(inv.PaysGameTime)}.";
        }
        OoStore.Log(c, "money", said, inv.Number);
        return said;
    }

    /// <summary>Giving up on an invoice. The game's pay for it stays in Broker holding; none of it was ever yours.</summary>
    public static string WriteOff(OoCareer c, string id)
    {
        var inv = Find(c, id);
        if (inv.Status is not ("Overdue" or "Open" or "Collections")) throw new InvalidOperationException("That invoice is settled already.");
        inv.Status = "WrittenOff";
        var said = $"{inv.Number} written off: {Units.Money(inv.Amount)} {inv.BrokerName} never paid." +
                   (inv.GamePay > 0 ? " The game's pay for it stays in Broker holding." : "");
        if (c.Brokers.FirstOrDefault(b => b.Id == inv.BrokerId) is { } broker && !broker.Notes.Contains("Did not pay."))
            broker.Notes.Add("Did not pay.");
        OoStore.Log(c, "money", said, inv.Number);
        return said;
    }

    /// <summary>
    /// What is left of the brokers' share in Broker holding: the game's pay for every settled load, less everything the
    /// player has been told to move out of holding. Detention and TONUs are paid from this, so no money ever comes from
    /// outside the game (agreed with the project owner on 2026-10-18).
    /// </summary>
    public static decimal BrokersShareAvailable(OoCareer c)
    {
        var settled = c.Invoices.Where(i => i.Status is "Paid" or "Factored" or "WrittenOff").Sum(i => i.GamePay);
        var out_ = c.Transfers.Where(t => t.From == Accounts.Holding).Sum(t => t.Amount);
        return Math.Max(0, settled - out_);
    }

    /// <summary>
    /// A payment beyond a load's rate (detention, a TONU) moved out of the brokers' share in Broker holding. As far as
    /// the share covers it: a payment the share cannot cover is short by the rest, and said so.
    /// </summary>
    private static void FromShare(OoCareer c, decimal amount, string what, string reference)
    {
        var available = BrokersShareAvailable(c);
        var pay = Math.Min(amount, available);
        if (pay <= 0)
        {
            OoStore.Log(c, "money", $"{what} There is nothing of the brokers' share in Broker holding to pay it from yet, so it is lost.", reference);
            return;
        }
        Ledger.Raise(c, "Extra", Accounts.Holding, Accounts.Yours, pay,
            $"{what} Move {Units.Money(pay)} out of the brokers' share in Broker holding into your account." +
            (pay < amount ? $" The share only covers {Units.Money(pay)} of the {Units.Money(amount)}; the rest is lost." : ""),
            reference, false);
    }

    private static Invoice Find(OoCareer c, string id) =>
        c.Invoices.FirstOrDefault(i => i.Id == id) ?? throw new InvalidOperationException("No such invoice.");
}
