using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// A lane: what a broker books ahead of the game job. A pickup city and window, a region to deliver into and a
/// distance band, at a rate per mile. The game supplies the job when the truck gets there. See the plan, "Brokers".
/// </summary>
public class Lane
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    public string BrokerId { get; set; } = "";
    public string BrokerName { get; set; } = "";
    public string PickupCity { get; set; } = "";
    public string PickupState { get; set; } = "";
    public string PickupFromGameTime { get; set; } = "";
    public string PickupToGameTime { get; set; } = "";
    /// <summary>The region the load delivers into: Core's ATS region name.</summary>
    public string DestRegion { get; set; } = "";
    public double MinMiles { get; set; }
    public double MaxMiles { get; set; }
    /// <summary>The game's pay the lane was priced against: what the game pays per mile, by the boards seen.</summary>
    public decimal GamePayPerMile { get; set; }
    /// <summary>The booked rate per mile. Paid on the job's actual miles, and never above what the game pays for it.</summary>
    public decimal RatePerMile { get; set; }
    /// <summary>Offered, Booked, Matched, Cancelled or Expired.</summary>
    public string Status { get; set; } = "Offered";
    public string BookingId { get; set; } = "";
    public string OfferedGameTime { get; set; } = "";

    public double MidMiles => Math.Round((MinMiles + MaxMiles) / 2);
}

public static class Lanes
{
    /// <summary>What the game pays per mile when no board has been seen yet.</summary>
    public const decimal DefaultPayPerMile = 2.60m;
    /// <summary>A broker who cancels a booked lane and is good for it pays this: truck ordered, not used.</summary>
    public const decimal Tonu = 150m;

    public static Lane? Booked(OoCareer c) => c.Lanes.LastOrDefault(l => l.Status == "Booked");

    /// <summary>The game's pay per mile, learned from every board the player has put in. See <see cref="Learn"/>.</summary>
    public static decimal PayPerMile(OoCareer c) =>
        c.PaySeen.Miles >= 200 ? Math.Round(c.PaySeen.Pay / (decimal)c.PaySeen.Miles, 2) : DefaultPayPerMile;

    /// <summary>Boards teach what the game pays. Every listing that goes onto the board is counted.</summary>
    public static void Learn(OoCareer c, IEnumerable<BoardLoad> loads)
    {
        foreach (var l in loads.Where(l => l.LoadedMiles > 20 && l.GameRevenue > 0))
        {
            c.PaySeen.Miles += l.LoadedMiles;
            c.PaySeen.Pay += l.GameRevenue;
        }
    }

    /// <summary>
    /// The phone rings near the end of a run: a broker who works where the load is going, with the next one. Only when
    /// the run is loaded and the plan from here has the truck empty within a day and a half, nothing is booked next
    /// already, and there is a discovered city to pick up in. How far the lane reaches is what the driver can do from
    /// there: the Long Distance limit, and a 34-hour restart first if the cycle will not cover the run.
    /// </summary>
    public static Call? MaybeRing(OoCareer c)
    {
        var k = Calls.ActiveBooking(c);
        var trip = Run.Trip(c, k);
        if (k == null || trip == null || Booked(c) != null || Calls.Open(c) != null || HomeLife.AtBottom(c)) return null;
        if (!(trip.LoadedReported || trip.Events.Any(e => e.Kind == "EndLoad"))) return null;
        if (c.Calls.Any(x => x.Inbound && x.BookingContext == k.Id)) return null;

        var s = c.Game;
        if (GameClock.TryParse(s.Status.GameTime) is not { } now) return null;
        var plan = Run.FromHere(c);
        var empty = plan != null && GameClock.TryParse(plan.ProjectedArrivalGameTime) is { } pa ? pa
                    : string.IsNullOrWhiteSpace(trip.ArrivedGameTime) ? (DateTime?)null : now.AddHours(trip.UnloadingHours);
        if (empty == null || (empty.Value - now).TotalHours > 36) return null;

        var region = Carriers.AtsRegionOf(trip.DestState);
        var pickup = PickupNear(c, trip.DestCity, trip.DestState);
        if (pickup == null) return null;
        var broker = c.Brokers
            .Where(b => b.Known && b.Regions.Contains(region) && BrokerBook.NotYet(c, b) == null && b.Standing > -30)
            .OrderByDescending(b => b.Standing)
            .ThenBy(b => BrokerBook.Stable(b.Id + k.Id))
            .FirstOrDefault();
        if (broker == null) return null;

        // The driver's reach from the delivery: a restart first where the cycle is low, then the distance band.
        var cycleAfter = plan?.CycleRemainingAfter ?? s.Hos.CycleRemaining;
        var restart = cycleAfter < 11 ? s.Settings.Hos.CycleRestartHours : 0;
        var deadhead = Geo.MilesBetween(trip.DestCity, trip.DestState, pickup.Value.City, pickup.Value.State) ?? 0;
        var opens = empty.Value.AddHours(restart + deadhead / 45.0 + 1);
        var limit = LoadDesk.LongDistanceLimit(c) ?? 3000;
        var max = Math.Round(Math.Min(limit, Math.Max(250, limit * 0.8)) / 10) * 10;
        var min = Math.Round(max * 0.6 / 10) * 10;

        var lane = new Lane
        {
            Number = $"LN-{c.Lanes.Count + 1:000}",
            BrokerId = broker.Id,
            BrokerName = broker.Name,
            PickupCity = pickup.Value.City,
            PickupState = pickup.Value.State,
            PickupFromGameTime = GameClock.Format(opens),
            PickupToGameTime = GameClock.Format(opens.AddHours(8)),
            DestRegion = TargetRegion(c, region, broker),
            MinMiles = min,
            MaxMiles = max,
            GamePayPerMile = PayPerMile(c),
            OfferedGameTime = s.Status.GameTime,
        };
        c.Lanes.Add(lane);

        var call = new Call
        {
            BrokerId = broker.Id,
            StartedGameTime = s.Status.GameTime,
            Inbound = true,
            LaneId = lane.Id,
            BookingContext = k.Id,
            Status = "Ringing",
        };
        c.Calls.Add(call);
        Calls.OfferLane(c, broker, call, lane);
        OoStore.Log(c, "broker", $"{broker.Name} is calling about a load out of {lane.PickupCity}, {lane.PickupState}.");
        return call;
    }

    /// <summary>The destination where it is discovered; otherwise the nearest discovered city in reach of it.</summary>
    private static (string City, string State)? PickupNear(OoCareer c, string city, string state)
    {
        if (DiscoveryService.IsDiscovered(c.Game, city, state)) return (city, state);
        return c.Game.Discovered
            .Select(d => (d.City, d.State, Miles: Geo.MilesBetween(city, state, d.City, d.State)))
            .Where(x => x.Miles is <= 150)
            .OrderBy(x => x.Miles)
            .Select(x => ((string City, string State)?)(x.City, x.State))
            .FirstOrDefault();
    }

    /// <summary>Where the lane delivers into: home's region when home is due soon, otherwise wherever the broker's freight goes.</summary>
    private static string TargetRegion(OoCareer c, string fromRegion, Broker b)
    {
        var homeRegion = Carriers.AtsRegionOf(c.Profile.HomeState);
        var dueSoon = c.HomeLife.LeftHomeGameTime.Length > 0
                      && GameClock.HoursBetween(c.HomeLife.LeftHomeGameTime, c.Game.Status.GameTime) is { } h
                      && c.HomeLife.EveryDays - h / 24 <= 5;
        return dueSoon ? homeRegion : fromRegion;
    }

    /// <summary>Which jobs on the board fit the booked lane: the pickup city, the region, the band, runnable.</summary>
    public static List<LoadView> Fits(OoCareer c, Lane lane, List<LoadView> board) =>
        board.Where(v => v.Load.OriginCity.Equals(lane.PickupCity, StringComparison.OrdinalIgnoreCase)
                         && v.Load.OriginState.Equals(lane.PickupState, StringComparison.OrdinalIgnoreCase)
                         && Carriers.AtsRegionOf(v.Load.DestState) == lane.DestRegion
                         && v.Load.LoadedMiles >= lane.MinMiles && v.Load.LoadedMiles <= lane.MaxMiles
                         && v.Feasibility.Verdict != "Infeasible" && v.SkillNotes.Count == 0)
             .OrderBy(v => Math.Abs(v.Load.LoadedMiles - lane.MidMiles))
             .ToList();

    /// <summary>
    /// Taking a fitting job for the booked lane. The broker owes the lane rate on the job's miles, never above what the
    /// game pays for it, and the run opens as for any booking.
    /// </summary>
    public static Booking Take(OoCareer c, string loadId)
    {
        var lane = Booked(c) ?? throw new InvalidOperationException("No lane is booked.");
        if (Calls.ActiveBooking(c) is { } busy) throw new InvalidOperationException($"Deliver {busy.Number} first.");
        var board = LoadDesk.Evaluate(c);
        var v = Fits(c, lane, board).FirstOrDefault(x => x.Load.Id == loadId)
                ?? throw new InvalidOperationException($"That job does not fit {lane.Number}: it has to start in {lane.PickupCity}, deliver into the {lane.DestRegion}, and run {lane.MinMiles:N0} to {lane.MaxMiles:N0} mi.");
        var broker = c.Brokers.First(b => b.Id == lane.BrokerId);
        var rate = Math.Min(v.Load.GameRevenue, Math.Round(lane.RatePerMile * (decimal)v.Load.LoadedMiles, 2));
        var booking = new Booking
        {
            Number = $"OO-{c.NextBookingNumber++:000}",
            BrokerId = broker.Id,
            BrokerName = broker.Name,
            Load = v.Load,
            Rate = rate,
            GamePay = v.Load.GameRevenue,
            DaysToPay = broker.DaysToPay,
            BookedGameTime = c.Game.Status.GameTime,
        };
        c.Bookings.Add(booking);
        Run.Open(c, booking);
        lane.Status = "Matched";
        lane.BookingId = booking.Id;
        broker.LoadsBooked++;
        c.Game.Board.RemoveAll(x => x.Id == loadId);
        OoStore.Log(c, "broker", $"{lane.Number} matched: {booking.Number}, {v.Load.Cargo} to {v.Load.DestCity}, {v.Load.DestState}, " +
                                 $"{Units.Money(rate)} ({Units.Money(lane.RatePerMile)}/mi).", booking.Number);
        return booking;
    }

    /// <summary>
    /// Nothing on the board fits. The broker cancels the lane; a broker good for it (credit A or B) pays a TONU, which
    /// goes on the books as an invoice. A broker who is not leaves you with nothing, which is why credit matters.
    /// </summary>
    public static string NothingFits(OoCareer c)
    {
        var lane = Booked(c) ?? throw new InvalidOperationException("No lane is booked.");
        var broker = c.Brokers.First(b => b.Id == lane.BrokerId);
        lane.Status = "Cancelled";
        if (broker.Credit is "A" or "B")
        {
            c.Invoices.Add(new Invoice
            {
                Number = $"INV-{c.Invoices.Count + 1:000}",
                BrokerId = broker.Id,
                BrokerName = broker.Name,
                BookingNumber = lane.Number,
                Amount = Tonu,
                IssuedGameTime = c.Game.Status.GameTime,
                DueGameTime = GameClock.TryParse(c.Game.Status.GameTime) is { } now ? GameClock.Format(now.AddDays(broker.DaysToPay)) : c.Game.Status.GameTime,
            });
            var said = $"{broker.Name} cancelled {lane.Number}: nothing fit. They pay a {Units.Money(Tonu)} TONU (truck ordered, not used).";
            OoStore.Log(c, "broker", said, lane.Number);
            return said;
        }
        broker.Standing = Math.Max(-100, broker.Standing - 5);
        var none = $"{broker.Name} cancelled {lane.Number}: nothing fit, and they are not paying anything for it.";
        OoStore.Log(c, "broker", none, lane.Number);
        return none;
    }

    public static object View(OoCareer c, Lane l) => new
    {
        l.Id, l.Number, l.BrokerName, l.PickupCity, l.PickupState, l.PickupFromGameTime, l.PickupToGameTime,
        l.DestRegion, l.MinMiles, l.MaxMiles, l.RatePerMile, l.Status,
    };
}

/// <summary>What the game has been seen to pay, from every board put in.</summary>
public class PaySeen
{
    public double Miles { get; set; }
    public decimal Pay { get; set; }
}
