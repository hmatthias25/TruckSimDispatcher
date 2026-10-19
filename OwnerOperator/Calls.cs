using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

public static class BookingStatus
{
    public const string Booked = "Booked";
    public const string Delivered = "Delivered";
    public const string Cancelled = "Cancelled";
}

/// <summary>A load booked through a broker: the rate confirmation.</summary>
public class Booking
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    public string BrokerId { get; set; } = "";
    public string BrokerName { get; set; } = "";
    public string CallId { get; set; } = "";
    public BoardLoad Load { get; set; } = new();
    /// <summary>What the broker pays: the booked rate, flat, for a spot load.</summary>
    public decimal Rate { get; set; }
    /// <summary>What the game pays at delivery: the shipper's money passing through.</summary>
    public decimal GamePay { get; set; }
    public bool QuickPay { get; set; }
    public decimal DetentionPerHour { get; set; }
    public double DetentionAfterHours { get; set; }
    public int DaysToPay { get; set; }
    public string BookedGameTime { get; set; } = "";
    /// <summary>The run on Core's trip log. See <see cref="Run"/>.</summary>
    public string TripId { get; set; } = "";
    public string Status { get; set; } = BookingStatus.Booked;
    public bool Late { get; set; }
    /// <summary>Cancelled, and the carrier's fault.</summary>
    public bool OnCarrier { get; set; }
}

public class CallTurn
{
    /// <summary>"broker" or "you".</summary>
    public string Who { get; set; } = "";
    public string Text { get; set; } = "";
    public decimal? Amount { get; set; }
}

/// <summary>
/// One phone call with a broker. <see cref="Ceiling"/> is the most they will ever pay and is never sent to the page.
/// See the plan, "Phone calls": the app negotiates; the AI only talks.
/// </summary>
public class Call
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string BrokerId { get; set; } = "";
    public string StartedGameTime { get; set; } = "";
    /// <summary>Open, Booked, Declined, HungUp, NotYet or Nothing.</summary>
    public string Status { get; set; } = "Open";
    public string LoadId { get; set; } = "";
    public BoardLoad? Load { get; set; }
    public decimal GamePay { get; set; }
    public decimal Offer { get; set; }
    public decimal Ceiling { get; set; }
    public int Patience { get; set; }
    public int Rounds { get; set; }
    public bool AskedForBetter { get; set; }
    public bool FinalOffer { get; set; }
    public List<string> OfferedLoadIds { get; set; } = new();
    public bool QuickPay { get; set; }
    public decimal DetentionPerHour { get; set; }
    public string BookingId { get; set; } = "";
    public List<CallTurn> Turns { get; set; } = new();

    /// <summary>The broker rang the player: a lane, offered near the end of a run. See <see cref="Lanes"/>.</summary>
    public bool Inbound { get; set; }
    public string LaneId { get; set; } = "";
    /// <summary>The booking whose run this call came in on, so one run gets one call.</summary>
    public string BookingContext { get; set; } = "";
}

/// <summary>What the player said, as the app understands it. Typed in on the counter-offer box, or read by the model.</summary>
public class PlayerMove
{
    /// <summary>accept, counter, better, terms, decline.</summary>
    public string Kind { get; set; } = "";
    public decimal? Amount { get; set; }
    /// <summary>deadhead, deadMarket, tight, record, walk.</summary>
    public List<string> Arguments { get; set; } = new();
    /// <summary>quickpay or detention, for a terms move.</summary>
    public string Term { get; set; } = "";
    /// <summary>What the player actually said, for the transcript.</summary>
    public string Said { get; set; } = "";
}

/// <summary>What the broker does next, decided by the rules, and the line that says it.</summary>
public record BrokerReply(string Situation, string Line);

/// <summary>
/// The negotiation. Every number is decided here: what the broker offers off the board, how far they move, when
/// they hang up. A model may phrase the lines and read the player's words, and nothing else.
/// </summary>
public static class Calls
{
    public static Call? Open(OoCareer c) => c.Calls.LastOrDefault(x => x.Status is "Open" or "Ringing");

    /// <summary>A lane offered on an inbound call, priced like a load at the band's middle distance.</summary>
    public static void OfferLane(OoCareer c, Broker b, Call call, Lane lane)
    {
        var p = Personalities.For(b.Personality);
        call.GamePay = Math.Round(lane.GamePayPerMile * (decimal)lane.MidMiles, 2);
        var quiet = HomeLife.HolidayNow(c) != null ? 0.05m : 0m;
        var target = call.GamePay * (1 - b.TargetMargin - quiet);
        var ceiling = call.GamePay * (1 - b.MinMargin - quiet + b.Standing / 100m * 0.02m);
        call.Ceiling = Math.Min(Math.Floor(call.GamePay / 5m) * 5m, Round5(Math.Max(target, ceiling)));
        call.Offer = Round5(Math.Min(call.Ceiling, target + (decimal)p.Opening * (call.Ceiling - target)));
        call.Patience = p.Patience + (b.Standing > 30 ? 1 : 0);
        call.Load = new BoardLoad
        {
            Id = lane.Id, Cargo = "Lane", OriginCity = lane.PickupCity, OriginState = lane.PickupState,
            DestCity = "", DestState = "", LoadedMiles = lane.MidMiles, GameRevenue = call.GamePay,
        };
        call.Turns.Add(new CallTurn { Who = "broker", Text = Templates.LaneOffer(b, p, lane, call.Offer), Amount = call.Offer });
    }

    /// <summary>Picking up a ringing phone.</summary>
    public static Call Answer(OoCareer c, string callId)
    {
        var call = c.Calls.FirstOrDefault(x => x.Id == callId && x.Status == "Ringing")
                   ?? throw new InvalidOperationException("Nobody is calling.");
        call.Status = "Open";
        return call;
    }

    public static Booking? ActiveBooking(OoCareer c) => c.Bookings.LastOrDefault(b => b.Status == BookingStatus.Booked);

    // ---------------------------------------------------------------- starting a call

    public static (Call Call, BrokerReply Reply) Start(OoCareer c, string brokerId)
    {
        var b = c.Brokers.FirstOrDefault(x => x.Id == brokerId && x.Known)
                ?? throw new InvalidOperationException("That broker is not in your directory.");
        if (Open(c) is { } open) open.Status = "Declined";
        if (ActiveBooking(c) is { } booked)
            throw new InvalidOperationException($"You are booked on {booked.Number} already. Deliver it before you book another.");

        if (HomeLife.AtBottom(c))
            throw new InvalidOperationException($"You are needed at home. No freight until {GameClock.Pretty(c.HomeLife.BottomUntilGameTime)}.");

        var call = new Call { BrokerId = b.Id, StartedGameTime = c.Game.Status.GameTime };
        c.Calls.Add(call);
        var p = Personalities.For(b.Personality);

        if (BrokerBook.NotYet(c, b) is { } missing)
        {
            call.Status = "NotYet";
            return Say(c, call, b, new BrokerReply("notyet", Templates.NotYet(b, p, missing)));
        }

        var pick = Pick(c, b, call);
        if (pick == null)
        {
            call.Status = "Nothing";
            var here = Carriers.AtsRegionOf(c.Game.Status.LocationState);
            var line = c.Game.Board.Count == 0
                ? Templates.NoBoard(b)
                : !b.Regions.Contains(here)
                    ? Templates.NotMyRegion(b, c.Game.Status.LocationCity)
                    : Templates.NothingFits(b);
            return Say(c, call, b, new BrokerReply("nothing", line));
        }

        SetOffer(c, b, p, call, pick);
        call.Patience = p.Patience + (b.Standing > 30 ? 1 : 0);
        return Say(c, call, b, new BrokerReply("offer", Templates.Offer(b, p, pick.Load, call.Offer)));
    }

    /// <summary>
    /// The job a broker offers off the board, by tier. A starter broker offers the leftovers: the bottom half of the
    /// board by what a load leaves per day. Established offer from the middle, premium from the top. Never a job past
    /// the driver's skills, one the plan cannot make, or one this call has offered already.
    /// </summary>
    public static LoadView? Pick(OoCareer c, Broker b, Call call, bool better = false)
    {
        var here = Carriers.AtsRegionOf(c.Game.Status.LocationState);
        if (!b.Regions.Contains(here)) return null;

        var runnable = LoadDesk.Evaluate(c)
            .Where(v => v.Feasibility.Verdict != "Infeasible" && v.SkillNotes.Count == 0)
            .OrderBy(v => v.NetPerDay)
            .ToList();
        if (runnable.Count == 0) return null;

        var n = runnable.Count;
        var (from, to) = b.Tier switch
        {
            BrokerTiers.Starter => (0, Math.Max(1, (n + 1) / 2)),
            BrokerTiers.Established => (n / 4, Math.Max(n / 4 + 1, (3 * n + 3) / 4)),
            _ => (Math.Max(0, n - Math.Max(1, n / 4)), n),
        };
        var pool = runnable.Skip(from).Take(to - from).Where(v => !call.OfferedLoadIds.Contains(v.Load.Id)).ToList();

        if (better)
        {
            // Asked for something better: the next one up from what is on offer, even out of the tier's pool.
            var current = runnable.FirstOrDefault(v => v.Load.Id == call.LoadId);
            return runnable.FirstOrDefault(v => current != null && v.NetPerDay > current.NetPerDay
                                                && !call.OfferedLoadIds.Contains(v.Load.Id));
        }
        if (pool.Count == 0) return null;
        // Seeded per call, so asking the same question twice gets the same answer.
        return pool[BrokerBook.Stable(call.Id) % pool.Count];
    }

    private static void SetOffer(OoCareer c, Broker b, Personality p, Call call, LoadView pick)
    {
        call.LoadId = pick.Load.Id;
        call.Load = pick.Load;
        call.OfferedLoadIds.Add(pick.Load.Id);
        call.GamePay = pick.GamePay;
        // The holidays: freight goes quiet and brokers keep more of it.
        var quiet = HomeLife.HolidayNow(c) != null ? 0.05m : 0m;
        var target = pick.GamePay * (1 - b.TargetMargin - quiet);
        // Standing buys a little of their margin: up to two points either way.
        var ceiling = pick.GamePay * (1 - b.MinMargin - quiet + b.Standing / 100m * 0.02m);
        // Never above what the game pays: a rate over it would be money that was never in the game bank. Agreed with
        // the project owner on 2026-10-18; negotiating claws back the broker's margin and nothing more.
        call.Ceiling = Math.Min(Math.Floor(pick.GamePay / 5m) * 5m, Round5(Math.Max(target, ceiling)));
        call.Offer = Round5(Math.Min(call.Ceiling, target + (decimal)p.Opening * (call.Ceiling - target)));
        call.FinalOffer = false;
    }

    // ---------------------------------------------------------------- the conversation

    public static (Call Call, BrokerReply Reply) Respond(OoCareer c, string callId, PlayerMove move)
    {
        var call = c.Calls.FirstOrDefault(x => x.Id == callId) ?? throw new InvalidOperationException("No such call.");
        if (call.Status == "Ringing" && (move.Kind ?? "").Equals("decline", StringComparison.OrdinalIgnoreCase))
        {
            call.Status = "Declined";
            if (c.Lanes.FirstOrDefault(l => l.Id == call.LaneId) is { } missed) missed.Status = "Expired";
            return (call, new BrokerReply("declined", "You let it ring."));
        }
        if (call.Status == "Ringing") call.Status = "Open";
        if (call.Status != "Open") throw new InvalidOperationException("That call is over. Ring them again if you want another go.");
        var b = c.Brokers.First(x => x.Id == call.BrokerId);
        var p = Personalities.For(b.Personality);
        var load = call.Load ?? throw new InvalidOperationException("Nothing is on offer on this call.");

        call.Turns.Add(new CallTurn { Who = "you", Text = string.IsNullOrWhiteSpace(move.Said) ? Templates.YouSaid(move) : move.Said, Amount = move.Amount });
        call.Rounds++;

        switch ((move.Kind ?? "").ToLowerInvariant())
        {
            case "accept":
                return Book(c, b, call, call.Offer, Templates.Done(b, p, call.Offer));

            case "decline":
                call.Status = "Declined";
                if (c.Lanes.FirstOrDefault(l => l.Id == call.LaneId) is { } passed) passed.Status = "Expired";
                return Say(c, call, b, new BrokerReply("declined", Templates.Declined(b, p)));

            case "better":
                if (call.LaneId.Length > 0) { call.Patience--; return Say(c, call, b, new BrokerReply("nobetter", Templates.NoBetter(b, p, call.Offer))); }
                return AskBetter(c, b, p, call);

            case "terms":
                return Terms(c, b, p, call, move.Term);

            case "counter":
                if (move.Amount is not { } ask || ask <= 0)
                    return Say(c, call, b, new BrokerReply("unclear", Templates.Unclear(b)));
                return Counter(c, b, p, call, load, Round5(ask), move.Arguments ?? new());

            default:
                return Say(c, call, b, new BrokerReply("unclear", Templates.Unclear(b)));
        }
    }

    private static (Call, BrokerReply) Counter(OoCareer c, Broker b, Personality p, Call call, BoardLoad load,
                                                decimal ask, List<string> arguments)
    {
        // At or under what they offered: nobody argues with that.
        if (ask <= call.Offer) return Book(c, b, call, ask, Templates.Done(b, p, ask));

        // Arguments are checked against the truth. A true one earns more; a false one costs trust and patience.
        var (trueArgs, lie) = call.LaneId.Length > 0 ? CheckLaneArguments(c, call, arguments) : CheckArguments(c, load, arguments);
        if (lie != null)
        {
            // A point of patience and some trust, not the call: two points made one wrong argument plus one polite
            // question a hang-up, live on the first test call.
            b.Standing = Math.Max(-100, b.Standing - 5);
            call.Patience -= 1;
            if (call.Patience <= 0) return HangUp(c, b, p, call);
            return Say(c, call, b, new BrokerReply("caught", Templates.Caught(b, p, lie, call.Offer)));
        }

        if (p.TradesTermsNotRate)
        {
            call.Patience--;
            if (call.Patience <= 0) return HangUp(c, b, p, call);
            return Say(c, call, b, new BrokerReply("norate", Templates.NoRate(b, p, call.Offer)));
        }

        var room = call.Ceiling - call.Offer;
        var step = Round5(room * (decimal)(p.Step * (1 + 0.5 * trueArgs)));
        if (arguments.Contains("walk") && call.Patience <= 2 && room > 0 && !call.FinalOffer)
        {
            // Threatening to walk on their last nerve gets their best, once.
            step = Math.Max(step, Round5(room * 0.5m));
            call.FinalOffer = true;
        }
        step = Math.Min(step, room);

        if (ask <= call.Offer + step) return Book(c, b, call, ask, Templates.Met(b, p, ask));

        call.Patience--;
        if (call.Patience <= 0 && !call.FinalOffer) return HangUp(c, b, p, call);
        if (step <= 0)
        {
            call.FinalOffer = true;
            return Say(c, call, b, new BrokerReply("final", Templates.AtCeiling(b, p, ask, call.Offer)));
        }
        call.Offer += step;
        return Say(c, call, b, new BrokerReply("moved", call.FinalOffer
            ? Templates.Final(b, p, ask, call.Offer)
            : Templates.Moved(b, p, ask, call.Offer, trueArgs > 0)));
    }

    private static (Call, BrokerReply) AskBetter(OoCareer c, Broker b, Personality p, Call call)
    {
        call.Patience--;
        var friendly = p.Id is "Friend" or "Rookie" || b.Standing >= 20;
        if (call.AskedForBetter || (b.Tier == BrokerTiers.Starter && !friendly))
        {
            if (call.Patience <= 0) return HangUp(c, b, p, call);
            call.AskedForBetter = true;
            return Say(c, call, b, new BrokerReply("nobetter", Templates.NoBetter(b, p, call.Offer)));
        }
        call.AskedForBetter = true;
        var next = Pick(c, b, call, better: true);
        if (next == null) return Say(c, call, b, new BrokerReply("nobetter", Templates.NoBetter(b, p, call.Offer)));
        SetOffer(c, b, p, call, next);
        return Say(c, call, b, new BrokerReply("offer", Templates.Better(b, p, next.Load, call.Offer)));
    }

    private static (Call, BrokerReply) Terms(OoCareer c, Broker b, Personality p, Call call, string term)
    {
        var t = (term ?? "").ToLowerInvariant();
        var easy = p.TradesTermsNotRate || call.Patience >= 2;
        call.Patience--;
        if (!easy && call.Patience <= 0) return HangUp(c, b, p, call);
        if (t == "quickpay" && !call.QuickPay && easy)
        {
            call.QuickPay = true;
            return Say(c, call, b, new BrokerReply("terms", Templates.QuickPay(b, p, call.Offer)));
        }
        if (t == "detention" && call.DetentionPerHour == 0 && easy)
        {
            call.DetentionPerHour = 40;
            return Say(c, call, b, new BrokerReply("terms", Templates.Detention(b, p, call.Offer)));
        }
        return Say(c, call, b, new BrokerReply("noterms", Templates.NoTerms(b, p, call.Offer)));
    }

    /// <summary>How many of the player's arguments are true for this load, and the first one that is not.</summary>
    public static (int TrueCount, string? Lie) CheckArguments(OoCareer c, BoardLoad load, List<string> arguments)
    {
        var count = 0;
        var view = LoadDesk.View(c, load, DispatchEngine.AssignedTruck(c.Game), DispatchEngine.AssignedTrailer(c.Game));
        var record = BrokerBook.Record(c);
        foreach (var a in arguments.Select(x => x.ToLowerInvariant()).Distinct())
        {
            var truth = a switch
            {
                "deadmarket" => Markets.Find(c.Game, load.DestCity, load.DestState) is { Tier: 3 },
                "tight" => view.Feasibility.Verdict == "Tight" || view.Feasibility.SlackHours < 3,
                "deadhead" => view.Feasibility.TotalMiles - load.LoadedMiles > 30 || Markets.Find(c.Game, load.DestCity, load.DestState) is { Tier: 3 },
                "record" => record.Loads >= 5 && record.OnTimePct >= 95,
                "walk" => true,
                _ => true,
            };
            if (!truth)
                return (count, a switch
                {
                    "deadmarket" => $"{load.DestCity} is not a dead market",
                    "tight" => "the window is not that tight",
                    "deadhead" => "there is no real deadhead on this one",
                    "record" => "you have not got that record yet",
                    _ => "that is not so",
                });
            if (a != "walk") count++;
        }
        return (count, null);
    }

    /// <summary>A lane's arguments, judged on the lane: a pickup away from the delivery is deadhead; a window soon after empty is tight.</summary>
    private static (int, string?) CheckLaneArguments(OoCareer c, Call call, List<string> arguments)
    {
        var lane = c.Lanes.First(l => l.Id == call.LaneId);
        var trip = Run.Trip(c, c.Bookings.FirstOrDefault(k => k.Id == call.BookingContext));
        var record = BrokerBook.Record(c);
        var count = 0;
        foreach (var a in arguments.Select(x => x.ToLowerInvariant()).Distinct())
        {
            var truth = a switch
            {
                "deadhead" => trip != null && !trip.DestCity.Equals(lane.PickupCity, StringComparison.OrdinalIgnoreCase),
                "tight" => GameClock.HoursBetween(lane.OfferedGameTime, lane.PickupFromGameTime) is < 24,
                "record" => record.Loads >= 5 && record.OnTimePct >= 95,
                "deadmarket" => false,
                _ => true,
            };
            if (!truth)
                return (count, a switch
                {
                    "deadhead" => "you're picking up right where you drop",
                    "tight" => "you've got plenty of time to get there",
                    "record" => "you have not got that record yet",
                    "deadmarket" => "you don't know where it's going yet",
                    _ => "that is not so",
                });
            if (a != "walk") count++;
        }
        return (count, null);
    }

    private static (Call, BrokerReply) Book(OoCareer c, Broker b, Call call, decimal rate, string line)
    {
        // A lane books the rate per mile, not a load: the game supplies the job at the pickup.
        if (c.Lanes.FirstOrDefault(l => l.Id == call.LaneId) is { } lane)
        {
            lane.Status = "Booked";
            lane.RatePerMile = Math.Round(rate / (decimal)Math.Max(1, lane.MidMiles), 2);
            call.Status = "Booked";
            call.Offer = rate;
            b.Standing = Math.Min(100, b.Standing + 2);
            Learn(b);
            OoStore.Log(c, "broker", $"{lane.Number} booked with {b.Name}: pick up in {lane.PickupCity}, {lane.PickupState} from " +
                                     $"{GameClock.Pretty(lane.PickupFromGameTime)}, into the {lane.DestRegion}, {lane.MinMiles:N0}-{lane.MaxMiles:N0} mi, " +
                                     $"{Units.Money(lane.RatePerMile)}/mi.", lane.Number);
            return Say(c, call, b, new BrokerReply("booked", line));
        }
        var load = call.Load!;
        var booking = new Booking
        {
            Number = $"OO-{c.NextBookingNumber++:000}",
            BrokerId = b.Id,
            BrokerName = b.Name,
            CallId = call.Id,
            Load = load,
            Rate = rate,
            GamePay = call.GamePay,
            QuickPay = call.QuickPay,
            DetentionPerHour = call.DetentionPerHour,
            DetentionAfterHours = call.DetentionPerHour > 0 ? 2 : 0,
            DaysToPay = call.QuickPay ? 2 : b.DaysToPay,
            BookedGameTime = c.Game.Status.GameTime,
        };
        c.Bookings.Add(booking);
        Run.Open(c, booking);
        call.Status = "Booked";
        call.BookingId = booking.Id;
        call.Offer = rate;
        b.LoadsBooked++;
        b.Standing = Math.Min(100, b.Standing + 2);
        Learn(b);
        // Taken: off the board, so nobody else books it.
        c.Game.Board.RemoveAll(x => x.Id == load.Id);
        OoStore.Log(c, "broker", $"{booking.Number} booked with {b.Name}: {load.Cargo} to {load.DestCity}, {load.DestState} at {Units.Money(rate)} (the game pays {Units.Money(call.GamePay)}).", booking.Number);
        return Say(c, call, b, new BrokerReply("booked", line));
    }

    private static (Call, BrokerReply) HangUp(OoCareer c, Broker b, Personality p, Call call)
    {
        call.Status = "HungUp";
        b.Standing = Math.Max(-100, b.Standing - 3);
        Learn(b);
        return Say(c, call, b, new BrokerReply("hangup", Templates.HangUp(b, p)));
    }

    private static (Call, BrokerReply) Say(OoCareer c, Call call, Broker b, BrokerReply reply)
    {
        call.Turns.Add(new CallTurn { Who = "broker", Text = reply.Line, Amount = call.Status == "Open" ? call.Offer : null });
        return (call, reply);
    }

    /// <summary>After a call, the player knows a little more about how this broker deals.</summary>
    private static void Learn(Broker b)
    {
        var rep = Personalities.For(b.Personality).Reputation;
        if (!b.Notes.Contains(rep)) b.Notes.Add(rep);
    }

    public static decimal Round5(decimal v) => Math.Round(v / 5m, MidpointRounding.AwayFromZero) * 5m;

    /// <summary>The call as the page sees it: never the ceiling.</summary>
    public static object View(OoCareer c, Call call)
    {
        var b = c.Brokers.FirstOrDefault(x => x.Id == call.BrokerId);
        return new
        {
            call.Id, call.BrokerId, broker = b?.Name, rep = b?.Rep, call.Status, call.Load, call.GamePay,
            call.Offer, call.Inbound,
            lane = c.Lanes.FirstOrDefault(l => l.Id == call.LaneId) is { } ln ? Lanes.View(c, ln) : null,
            // How the broker sounds, not how many rounds are left: the count is the app's to know.
            mood = call.Patience >= 3 ? "relaxed" : call.Patience == 2 ? "getting short" : "losing patience",
            call.QuickPay, call.DetentionPerHour, call.AskedForBetter, call.FinalOffer,
            call.Turns, call.BookingId,
        };
    }
}
