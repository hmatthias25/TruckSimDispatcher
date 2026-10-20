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
    /// <summary>The broker's trade, or the company, the job at the pickup has to belong to.</summary>
    public string Specialty { get; set; } = "General";
    public string ShipperName { get; set; } = "";
    /// <summary>Set where the lane takes the driver home: why (home has called, a date at home), and home, as "City, ST".</summary>
    public string HomeFor { get; set; } = "";
    public string HomeCity { get; set; } = "";
    /// <summary>Set where the lane leans into a busy region: the freight that is busy there, in words.</summary>
    public string LeanedFor { get; set; } = "";
    /// <summary>Terms agreed on the call that booked the lane, carried onto the job taken for it.</summary>
    public bool QuickPay { get; set; }
    public decimal DetentionPerHour { get; set; }
    /// <summary>Offered, Booked, Matched, Cancelled or Expired.</summary>
    public string Status { get; set; } = "Offered";
    public string BookingId { get; set; } = "";
    public string OfferedGameTime { get; set; } = "";
    /// <summary>The run it was offered on. A "NoCall" record marks a run whose phone did not ring.</summary>
    public string ForBookingId { get; set; } = "";

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
            // The game's roads against the map: every listing is a measured pair, and the ratio is what turns a map
            // distance into the miles a job would list. Implausible ratios are a misread, not a road.
            var origin = (City: string.IsNullOrWhiteSpace(l.OriginCity) ? c.Game.Status.LocationCity : l.OriginCity,
                          State: string.IsNullOrWhiteSpace(l.OriginState) ? c.Game.Status.LocationState : l.OriginState);
            if (Geo.EstimatedMiles(origin.City, origin.State, l.DestCity, l.DestState) is { } est && est > 20
                && l.LoadedMiles / est is var ratio && ratio is > 0.4 and < 1.6)
            {
                c.PaySeen.MapRatioSum += ratio;
                c.PaySeen.MapRatioCount++;
            }
        }
    }

    /// <summary>
    /// What a job lists against the map's estimate for the same two cities: learned from the boards put in, 0.85 until there
    /// are five. The game's roads run shorter than the real-world map (Austin to Beaumont lists under 200 mi).
    /// </summary>
    public static double MapFactor(OoCareer c) =>
        c.PaySeen.MapRatioCount >= 5 ? Math.Clamp(c.PaySeen.MapRatioSum / c.PaySeen.MapRatioCount, 0.6, 1.2) : 0.85;

    /// <summary>The ATS cities in a region a job out of the pickup could reach inside the lane's band, in the game's miles.</summary>
    public static int CitiesInReach(OoCareer c, string pickupCity, string pickupState, string region, double minMiles, double maxMiles)
    {
        var factor = MapFactor(c);
        return Markets.BuiltIn.Count(m => Carriers.AtsRegionOf(m.State) == region
            && Geo.EstimatedMiles(pickupCity, pickupState, m.City, m.State) is { } est
            && est * factor >= minMiles && est * factor <= maxMiles);
    }

    /// <summary>A region needs at least this many cities in reach before a lane leans into it: fewer, and nothing may fit at the pickup.</summary>
    public const int LeanMinCities = 3;

    /// <summary>
    /// Leaning a lane toward where the freight is: where the run's own region is ordinary or slow this month for the freight
    /// this broker deals in, and another region in reach of the band is busy (see Seasons), the lane goes there, so the
    /// driver lands where the next load is easy. Asked for from play. A shipper's own lanes, and a lane home, do not lean.
    /// </summary>
    private static void LeanToSeason(OoCareer c, Lane lane, Broker broker)
    {
        if (broker.Kind == "Shipper") return;
        var kind = Seasons.KindOf(DispatchEngine.AssignedTrailer(c.Game)?.Type, broker.Specialty);
        if (Seasons.Now(c, kind, lane.DestRegion) > 1.0) return;
        var best = Seasons.Regions
            .Where(r => r != lane.DestRegion)
            .Select(r => (Region: r, Index: Seasons.Now(c, kind, r)))
            .Where(x => x.Index >= Seasons.Busy)
            .Where(x => CitiesInReach(c, lane.PickupCity, lane.PickupState, x.Region, lane.MinMiles, lane.MaxMiles) >= LeanMinCities)
            .OrderByDescending(x => x.Index)
            .FirstOrDefault();
        if (best.Region is null) return;
        lane.DestRegion = best.Region;
        lane.LeanedFor = Seasons.Words(kind);
    }

    /// <summary>
    /// The phone rings near the end of a run: a broker who works where the load is going, with the next one. Not every
    /// run: it is a roll, likelier with brokers who know you (see <see cref="RingChance"/>). Only once the run is loaded
    /// and the plan from here has the truck empty within a day and a half, with nothing booked next already.
    /// </summary>
    public static Call? MaybeRing(OoCareer c)
    {
        var k = Calls.ActiveBooking(c);
        var trip = Run.Trip(c, k);
        if (k == null || trip == null || Booked(c) != null || Calls.Open(c) != null || HomeLife.AtBottom(c)) return null;
        if (!(trip.LoadedReported || trip.Events.Any(e => e.Kind == "EndLoad"))) return null;
        if (c.Calls.Any(x => x.Inbound && x.BookingContext == k.Id) || c.Lanes.Any(l => l.ForBookingId == k.Id && l.Status == "NoCall")) return null;
        if (Reach(c, k, trip) is not { } reach || reach.Hours > 36) return null;

        var region = Carriers.AtsRegionOf(trip.DestState);
        var broker = c.Brokers
            .Where(b => b.Known && b.Regions.Contains(region) && BrokerBook.NotYet(c, b) == null && b.Standing > -30)
            .OrderByDescending(b => b.Standing)
            .ThenBy(b => BrokerBook.Stable(b.Id + k.Id))
            .FirstOrDefault();
        if (broker == null) return null;

        // Not every run gets a call. Decided once per run, so asking again changes nothing.
        // The season where the run ends, for the freight the broker deals in: busy rings more, slow less.
        var season = Seasons.Now(c, Seasons.KindOf(DispatchEngine.AssignedTrailer(c.Game)?.Type, broker.Specialty), region);
        var chance = Environment.GetEnvironmentVariable("TSO_RING_CHANCE") is { Length: > 0 } ? RingChance(broker) : Seasons.RingChance(RingChance(broker), season);
        if (BrokerBook.Stable("ring|" + k.Id) % 100 >= chance)
        {
            c.Lanes.Add(new Lane { Status = "NoCall", ForBookingId = k.Id, OfferedGameTime = c.Game.Status.GameTime });
            return null;
        }

        var lane = Build(c, broker, k, trip, reach);
        var call = new Call
        {
            BrokerId = broker.Id,
            StartedGameTime = c.Game.Status.GameTime,
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

    /// <summary>
    /// Being around pays: on the last day of a home time, a broker who works home rings with a load out of the home city.
    /// Once a stay, and only with nothing booked. See the plan, "Home time".
    /// </summary>
    public static Call? RingAtHome(OoCareer c)
    {
        var h = c.HomeLife;
        if (!HomeLife.AtHome(c) || Calls.ActiveBooking(c) != null || Booked(c) != null || Calls.Open(c) != null || HomeLife.AtBottom(c)) return null;
        var stay = "home|" + h.AtHomeSinceGameTime;
        if (c.Calls.Any(x => x.BookingContext == stay)) return null;
        if (GameClock.HoursBetween(h.AtHomeSinceGameTime, c.Game.Status.GameTime) is not { } hours || hours < Math.Max(0, h.HomeDays - 1) * 24) return null;
        if (GameClock.TryParse(c.Game.Status.GameTime) is not { } now) return null;

        var homeRegion = Carriers.AtsRegionOf(c.Profile.HomeState);
        var broker = c.Brokers
            .Where(b => b.Known && b.Regions.Contains(homeRegion) && BrokerBook.NotYet(c, b) == null && b.Kind == "Broker")
            .OrderBy(b => b.City.Equals(c.Profile.HomeCity, StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenByDescending(b => b.Standing)
            .FirstOrDefault();
        if (broker == null) return null;

        var opens = now.AddHours(Math.Max(2, h.HomeDays * 24 - hours));
        var limit = LoadDesk.LongDistanceLimit(c) ?? 3000;
        var max = Math.Round(Math.Min(limit, Math.Max(250, limit * 0.8)) / 10) * 10;
        var lane = new Lane
        {
            Number = $"LN-{c.Lanes.Count(l => l.Status != "NoCall") + 1:000}",
            BrokerId = broker.Id,
            BrokerName = broker.Name,
            PickupCity = c.Profile.HomeCity,
            PickupState = c.Profile.HomeState,
            PickupFromGameTime = GameClock.Format(opens),
            PickupToGameTime = GameClock.Format(opens.AddHours(10)),
            DestRegion = homeRegion,
            MinMiles = Math.Round(max * 0.6 / 10) * 10,
            MaxMiles = max,
            GamePayPerMile = PayPerMile(c),
            OfferedGameTime = c.Game.Status.GameTime,
            Specialty = broker.Specialty,
            ForBookingId = stay,
        };
        c.Lanes.Add(lane);
        var call = new Call { BrokerId = broker.Id, StartedGameTime = c.Game.Status.GameTime, Inbound = true, LaneId = lane.Id, BookingContext = stay, Status = "Ringing" };
        c.Calls.Add(call);
        Calls.OfferLane(c, broker, call, lane);
        OoStore.Log(c, "broker", $"{broker.Name} is calling: they have a load out of {c.Profile.HomeCity} when your home time is up.");
        return call;
    }

    /// <summary>
    /// The chance a broker rings near the end of a run, in percent: about half the time from a stranger, more from a
    /// broker you have run well for. TSO_RING_CHANCE overrides it, for the tests.
    /// </summary>
    public static int RingChance(Broker b)
    {
        if (int.TryParse(Environment.GetEnvironmentVariable("TSO_RING_CHANCE"), out var forced)) return forced;
        return Math.Clamp(45 + b.Standing / 2, 20, 85);
    }

    /// <summary>
    /// Ringing a broker yourself, mid-run, to line up the next load: from a break or a rest, never while driving. What
    /// they offer is a lane out of where the plan has you empty, the same as an inbound call; no board is involved.
    /// </summary>
    public static (Call Call, BrokerReply Reply) Ask(OoCareer c, Broker b)
    {
        var k = Calls.ActiveBooking(c) ?? throw new InvalidOperationException("Nothing is booked.");
        var trip = Run.Trip(c, k) ?? throw new InvalidOperationException("Nothing is booked.");
        if (Booked(c) is { } has) throw new InvalidOperationException($"{has.Number} is booked next already.");
        if (PullOver(c) is { } wheel) throw new InvalidOperationException(wheel);

        var p = Personalities.For(b.Personality);
        var call = new Call { BrokerId = b.Id, StartedGameTime = c.Game.Status.GameTime, LaneId = "", BookingContext = k.Id };
        c.Calls.Add(call);
        Reply Say(string situation, string line)
        {
            call.Turns.Add(new CallTurn { Who = "broker", Text = line });
            return new Reply(call, new BrokerReply(situation, line));
        }
        if (BrokerBook.NotYet(c, b) is { } missing) { call.Status = "NotYet"; return Say("notyet", Templates.NotYet(b, p, missing)).Out; }
        if (!b.Regions.Contains(Carriers.AtsRegionOf(trip.DestState))) { call.Status = "Nothing"; return Say("nothing", Templates.NotMyRegion(b, trip.DestCity)).Out; }
        if (Reach(c, k, trip) is not { } reach) { call.Status = "Nothing"; return Say("nothing", Templates.NothingFits(b)).Out; }

        var lane = Build(c, b, k, trip, reach);
        call.LaneId = lane.Id;
        Calls.OfferLane(c, b, call, lane);
        return (call, new BrokerReply("offer", call.Turns.Last().Text));
    }

    /// <summary>Why a mid-run call cannot be made yet, or null: only from a break or a rest, or at a dock, never at the wheel.</summary>
    public static string? PullOver(OoCareer c)
    {
        var trip = Run.Trip(c, Calls.ActiveBooking(c));
        if (trip == null) return null;
        var last = trip.Events.OrderBy(e => e.GameTime).LastOrDefault();
        var stopped = last is { Kind: "Break" or "Rest" }
                      || !string.IsNullOrWhiteSpace(trip.ArrivedGameTime)
                      || (!string.IsNullOrWhiteSpace(trip.ShipperArrivedGameTime) && !trip.LoadedReported);
        return stopped ? null : "Pull over first: make the call from a break or a rest, not at the wheel. Log the break, then ring.";
    }

    /// <summary>
    /// A lane offered on an inbound call, planned again off the clocks the driver gave on answering: the restart, and
    /// when the truck can be at the pickup. Returns what the broker says about it when it moved, or null.
    /// </summary>
    public static string? Refit(OoCareer c, Call call)
    {
        var lane = c.Lanes.FirstOrDefault(l => l.Id == call.LaneId);
        var k = c.Bookings.FirstOrDefault(b => lane != null && b.Id == lane.ForBookingId);
        var trip = Run.Trip(c, k);
        if (lane == null || k == null || trip == null || Reach(c, k, trip) is not { } reach) return null;
        var (from, to) = Window(c, trip, reach);
        var was = lane.PickupFromGameTime;
        if (GameClock.TryParse(was) is { } before && Math.Abs((from - before).TotalHours) < 1) return null;
        lane.PickupFromGameTime = GameClock.Format(from);
        lane.PickupToGameTime = GameClock.Format(to);
        return $"With those clocks, call it from {GameClock.Pretty(lane.PickupFromGameTime)} at {lane.PickupCity}. Same rate.";
    }

    /// <summary>Under these, the day is spent at empty: too little drive or shift left to load and run another, so a reset comes first.</summary>
    public const double DriveToStartHours = 2, ShiftToStartHours = 3;

    /// <summary>
    /// When the lane's pickup window opens and shuts: after the run empties, then a 34 where the cycle will be low, or a
    /// 10-hour reset where the day's drive or shift will be nearly spent, and the deadhead. Reported from play: a pickup
    /// an hour after empty, offered to a driver who would arrive with half an hour of driving left.
    /// </summary>
    private static (DateTime From, DateTime To) Window(OoCareer c, Trip trip, ReachInfo reach)
    {
        var hos = c.Game.Settings.Hos;
        var restart = reach.CycleAfter < 11 ? hos.CycleRestartHours
            : reach.DriveAfter < DriveToStartHours || reach.ShiftAfter < ShiftToStartHours ? hos.OffDutyReset
            : 0;
        var deadhead = Geo.MilesBetween(trip.DestCity, trip.DestState, reach.Pickup.City, reach.Pickup.State) ?? 0;
        var opens = reach.Empty.AddHours(restart + deadhead / 45.0 + 1);
        return (opens, opens.AddHours(8));
    }

    private record Reply(Call Call, BrokerReply Answer)
    {
        public (Call, BrokerReply) Out => (Call, Answer);
    }

    /// <summary>Where the truck will be empty and when, and somewhere discovered to pick up near it.</summary>
    public record ReachInfo(DateTime Empty, double Hours, double CycleAfter, (string City, string State) Pickup,
                            double? DriveAfter = null, double? ShiftAfter = null);

    public static ReachInfo? Reach(OoCareer c, Booking k, Trip trip)
    {
        var s = c.Game;
        if (GameClock.TryParse(s.Status.GameTime) is not { } now) return null;
        var plan = Run.FromHere(c);
        var empty = plan != null && GameClock.TryParse(plan.ProjectedArrivalGameTime) is { } pa ? pa
                    : string.IsNullOrWhiteSpace(trip.ArrivedGameTime) ? now.AddHours(Math.Max(1, trip.DispatchedMiles / 45.0)) : now.AddHours(trip.UnloadingHours);
        var pickup = PickupNear(c, trip.DestCity, trip.DestState);
        if (pickup == null) return null;
        // The day's clocks as the run leaves them, off the last step of the plan: what the next load starts on.
        var last = plan?.Timeline.LastOrDefault();
        return new ReachInfo(empty, (empty - now).TotalHours, plan?.CycleRemainingAfter ?? s.Hos.CycleRemaining, pickup.Value,
                             last?.DriveRemainingAfter, last?.ShiftRemainingAfter);
    }

    /// <summary>
    /// The lane a broker offers from the driver's reach: a restart first where the cycle will be low, a pickup window
    /// after the run to the pickup, and a band inside the Long Distance limit.
    /// </summary>
    private static Lane Build(OoCareer c, Broker broker, Booking k, Trip trip, ReachInfo reach)
    {
        var s = c.Game;
        var (opens, closes) = Window(c, trip, reach);
        var limit = LoadDesk.LongDistanceLimit(c) ?? 3000;
        var max = Math.Round(Math.Min(limit, Math.Max(250, limit * 0.8)) / 10) * 10;
        var min = Math.Round(max * 0.6 / 10) * 10;
        var lane = new Lane
        {
            Number = $"LN-{c.Lanes.Count(l => l.Status != "NoCall") + 1:000}",
            BrokerId = broker.Id,
            BrokerName = broker.Name,
            PickupCity = reach.Pickup.City,
            PickupState = reach.Pickup.State,
            PickupFromGameTime = GameClock.Format(opens),
            PickupToGameTime = GameClock.Format(closes),
            DestRegion = Carriers.AtsRegionOf(trip.DestState),
            MinMiles = min,
            MaxMiles = max,
            GamePayPerMile = PayPerMile(c),
            OfferedGameTime = s.Status.GameTime,
            Specialty = broker.Specialty,
            ShipperName = broker.Kind == "Shipper" ? Companies.Base(broker) : "",
            ForBookingId = k.Id,
        };
        LeanToSeason(c, lane, broker);
        AimHome(c, lane, limit);
        if (lane.HomeFor.Length > 0) lane.LeanedFor = "";
        c.Lanes.Add(lane);
        return lane;
    }

    /// <summary>
    /// Where home is pulling (see HomeLife.Pull), the lane goes home: to a job ending near the home city when one load
    /// reaches it inside the Long Distance limit, or otherwise into the home region, the way there.
    /// </summary>
    private static void AimHome(OoCareer c, Lane lane, double limit)
    {
        if (HomeLife.Pull(c) is not { } pull) return;
        lane.DestRegion = Carriers.AtsRegionOf(c.Profile.HomeState);
        if (Geo.MilesBetween(lane.PickupCity, lane.PickupState, c.Profile.HomeCity, c.Profile.HomeState) is not { } home || home > limit) return;
        lane.HomeFor = pull.Said;
        lane.HomeCity = $"{c.Profile.HomeCity}, {c.Profile.HomeState}";
        // The map's miles run long against the game's roads, so the band takes in well under the estimate.
        lane.MinMiles = Math.Max(20, Math.Round(home * 0.5 / 10) * 10);
        lane.MaxMiles = Math.Max(lane.MinMiles + 50, Math.Min(limit, Math.Round(home * 1.2 / 10) * 10));
    }

    /// <summary>
    /// The run's destination. It need not be discovered yet: delivering there discovers it, so by the time the lane
    /// picks up the game offers jobs out of it. Requiring it already discovered left a new career's first runs into new
    /// cities, which is most of them, with no call at all.
    /// </summary>
    private static (string City, string State)? PickupNear(OoCareer c, string city, string state) =>
        string.IsNullOrWhiteSpace(city) ? null : (city, state);

    /// <summary>Where the lane delivers into: home's region when home is due soon, otherwise wherever the broker's freight goes.</summary>

    /// <summary>Which jobs on the board fit the booked lane: the pickup city, the region, the band, runnable.</summary>
    public static List<LoadView> Fits(OoCareer c, Lane lane, List<LoadView> board) =>
        board.Where(v => v.Load.OriginCity.Equals(lane.PickupCity, StringComparison.OrdinalIgnoreCase)
                         && v.Load.OriginState.Equals(lane.PickupState, StringComparison.OrdinalIgnoreCase)
                         // A lane home fits any job that ends near home; any other, the region and the band.
                         && (lane.HomeFor.Length > 0
                             ? HomeLife.NearHome(c, v.Load.DestCity, v.Load.DestState)
                             : Carriers.AtsRegionOf(v.Load.DestState) == lane.DestRegion
                               && v.Load.LoadedMiles >= lane.MinMiles && v.Load.LoadedMiles <= lane.MaxMiles)
                         && v.Feasibility.Verdict != "Infeasible" && v.SkillNotes.Count == 0
                         && (lane.ShipperName.Length > 0 ? Companies.Is(c, lane.ShipperName, v.Load.Shipper)
                             : lane.Specialty == Specialties.General || Specialties.Of(c, v.Load) == lane.Specialty))
             // The dock the truck is at first: no empty miles to it. Then the nearest the booked distance.
             .OrderByDescending(v => Calls.AtTheDock(c, v.Load))
             .ThenBy(v => Math.Abs(v.Load.LoadedMiles - lane.MidMiles))
             .ToList();

    /// <summary>How many of the nearest jobs the broker puts up when nothing fits the lane exactly.</summary>
    public const int CloseCount = 3;

    /// <summary>
    /// The jobs the lane can be taken on: the exact fits, or where there are none, the broker's nearest. A lane is the
    /// broker's word on a kind of run, not a listing, and the game's board is what it is: reported from play, a lane of
    /// 150-250 mi out of Lawton against a board whose shortest job was 273, and nothing to do but call it off. So the
    /// broker finds the closest runnable jobs out of the pickup, into the region first, then nearest the band (or home),
    /// at the lane's rate on the job's own miles.
    /// </summary>
    public static (List<LoadView> Jobs, bool Close) Matches(OoCareer c, Lane lane, List<LoadView> board)
    {
        var exact = Fits(c, lane, board);
        if (exact.Count > 0) return (exact, false);
        double Off(double miles) => miles < lane.MinMiles ? lane.MinMiles - miles : miles > lane.MaxMiles ? miles - lane.MaxMiles : 0;
        var close = board
            .Where(v => v.Load.OriginCity.Equals(lane.PickupCity, StringComparison.OrdinalIgnoreCase)
                        && v.Load.OriginState.Equals(lane.PickupState, StringComparison.OrdinalIgnoreCase)
                        && v.Feasibility.Verdict != "Infeasible" && v.SkillNotes.Count == 0
                        && (lane.ShipperName.Length > 0 ? Companies.Is(c, lane.ShipperName, v.Load.Shipper)
                            : lane.Specialty == Specialties.General || Specialties.Of(c, v.Load) == lane.Specialty))
            .OrderBy(v => lane.HomeFor.Length > 0
                ? Geo.MilesBetween(v.Load.DestCity, v.Load.DestState, c.Profile.HomeCity, c.Profile.HomeState) ?? 9999
                : (Carriers.AtsRegionOf(v.Load.DestState) == lane.DestRegion ? 0 : 1) * 100000 + Off(v.Load.LoadedMiles))
            .Take(CloseCount)
            .ToList();
        return (close, close.Count > 0);
    }

    /// <summary>The booked lane against the board, for the snapshot: the jobs it can be taken on, whether they are only near, and why.</summary>
    public static (List<string> Fits, bool Close, string? Why) Board(OoCareer c)
    {
        if (!c.Started || Booked(c) is not { } lane) return (new(), false, null);
        var board = LoadDesk.Evaluate(c);
        var (jobs, close) = Matches(c, lane, board);
        return (jobs.Select(v => v.Load.Id).ToList(), close, Why(c, lane, board));
    }

    /// <summary>Why nothing on the board fit the lane exactly, said once the board is in.</summary>
    public static string? Why(OoCareer c, Lane lane, List<LoadView> board)
    {
        var here = board.Where(v => v.Load.OriginCity.Equals(lane.PickupCity, StringComparison.OrdinalIgnoreCase)
                                    && v.Load.OriginState.Equals(lane.PickupState, StringComparison.OrdinalIgnoreCase)).ToList();
        if (here.Count == 0 || Fits(c, lane, board).Count > 0) return null;
        if (lane.HomeFor.Length > 0) return $"Nothing on the {lane.PickupCity} board ends near home.";
        var into = here.Count(v => Carriers.AtsRegionOf(v.Load.DestState) == lane.DestRegion);
        var lo = here.Min(v => v.Load.LoadedMiles);
        var hi = here.Max(v => v.Load.LoadedMiles);
        return into == 0 ? $"Nothing on the {lane.PickupCity} board goes into the {lane.DestRegion}."
            : $"Nothing on the {lane.PickupCity} board runs {lane.MinMiles:N0}-{lane.MaxMiles:N0} mi into the {lane.DestRegion}: " +
              $"its jobs run {lo:N0} to {hi:N0} mi.";
    }

    /// <summary>
    /// Taking a fitting job for the booked lane. The broker owes the lane rate on the job's miles, never above what the
    /// game pays for it, and the run opens as for any booking.
    /// </summary>
    public static Booking Take(OoCareer c, string loadId)
    {
        var lane = Booked(c) ?? throw new InvalidOperationException("No lane is booked.");
        if (Calls.ActiveBooking(c) is { } busy) throw new InvalidOperationException($"Deliver {busy.Number} first.");
        var board = LoadDesk.Evaluate(c);
        var v = Matches(c, lane, board).Jobs.FirstOrDefault(x => x.Load.Id == loadId)
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
            // The terms agreed on the lane's call. Reported from play: quick pay agreed on a lane, then lost on the job.
            QuickPay = lane.QuickPay,
            DetentionPerHour = lane.DetentionPerHour,
            DetentionAfterHours = lane.DetentionPerHour > 0 ? 2 : 0,
            DaysToPay = lane.QuickPay ? 2 : broker.DaysToPay,
            BookedGameTime = c.Game.Status.GameTime,
        };
        c.Bookings.Add(booking);
        Run.Open(c, booking);
        lane.Status = "Matched";
        lane.BookingId = booking.Id;
        broker.LoadsBooked++;
        c.Game.Board.Clear();   // booked: the board is done with
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
            var tonu = new Invoice
            {
                Number = $"INV-{c.Invoices.Count + 1:000}",
                BrokerId = broker.Id,
                BrokerName = broker.Name,
                BookingNumber = lane.Number,
                Amount = Tonu,
                IssuedGameTime = c.Game.Status.GameTime,
                DueGameTime = GameClock.TryParse(c.Game.Status.GameTime) is { } now ? GameClock.Format(now.AddDays(broker.DaysToPay)) : c.Game.Status.GameTime,
            };
            c.Invoices.Add(tonu);
            Receivables.SetTerms(c, tonu, broker);
            var said = $"{broker.Name} cancelled {lane.Number}: nothing fit. They pay a {Units.Money(Tonu)} TONU (truck ordered, not used).";
            OoStore.Log(c, "broker", said, lane.Number);
            return said;
        }
        broker.Standing = Math.Max(-100, broker.Standing - 5);
        var none = $"{broker.Name} cancelled {lane.Number}: nothing fit, and they are not paying anything for it.";
        OoStore.Log(c, "broker", none, lane.Number);
        return none;
    }

    /// <summary>The player calling off a booked lane: on the record with that broker, and no TONU.</summary>
    public static string Cancel(OoCareer c, string why)
    {
        var lane = Booked(c) ?? throw new InvalidOperationException("No lane is booked.");
        lane.Status = "Cancelled";
        if (c.Brokers.FirstOrDefault(b => b.Id == lane.BrokerId) is { } b) b.Standing = Math.Max(-100, b.Standing - 10);
        var said = $"You called off {lane.Number} with {lane.BrokerName}{(string.IsNullOrWhiteSpace(why) ? "" : $": {why}")}. They will remember it.";
        OoStore.Log(c, "broker", said, lane.Number);
        return said;
    }

    public static object View(OoCareer c, Lane l) => new
    {
        l.Id, l.Number, l.BrokerName, l.PickupCity, l.PickupState, l.PickupFromGameTime, l.PickupToGameTime,
        l.DestRegion, l.MinMiles, l.MaxMiles, l.RatePerMile, l.Status, l.HomeFor, l.HomeCity, l.LeanedFor,
    };
}

/// <summary>What the game has been seen to pay, from every board put in.</summary>
public class PaySeen
{
    public double Miles { get; set; }
    public decimal Pay { get; set; }
    /// <summary>Listed miles over the map's estimate, summed over every board job where both are known: see Lanes.MapFactor.</summary>
    public double MapRatioSum { get; set; }
    public int MapRatioCount { get; set; }
}
