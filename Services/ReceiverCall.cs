using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What actually happens when the truck pulls onto the receiver's property.
///
/// <para>ATS has no opinion about any of this. Back up to a trailer drop and the load is delivered, at
/// three in the morning, at a construction site, four hours before your booked slot. The game will not
/// stop you, so the app is the only thing that will — and the way it says so is the way it already says
/// everything else about time: <b>set the game clock, then do the work</b>. Same dev-console habit as
/// sitting a break or a rest.</para>
///
/// <para>Two very different places to arrive at, and the driver says which by saying they are there:</para>
///
/// <list type="bullet">
/// <item><b>A job site with no appointment.</b> Nobody is expecting you, so what matters is whether they
/// are open and how many trucks got there first. A night at the gate buys the front of the line; rolling
/// up at opening puts you behind everyone who waited.</item>
/// <item><b>A dock with a booked slot.</b> They know you are coming, so there is no queue to be in — but
/// a slot is a plan rather than a promise. Turn up at 14:30 for a 15:00 and they might have a door free
/// and wave you on, take you at 15:00 as agreed, or be two hours behind and get to you when they get to
/// you.</item>
/// </list>
///
/// <para><b>Rolled once, at arrival.</b> Seeded on the trip and the hour they say they got there, so
/// reloading the page cannot shop for a better answer — and once it is recorded on the trip it is not
/// rolled again at all. Reporting a genuinely different arrival time is a different arrival and gets its
/// own answer, which is correct: turning up two hours earlier really is a different situation.</para>
/// </summary>
public static class ReceiverCall
{
    /// <summary>How long one truck ahead of you takes to get in, get done and get out of the way.</summary>
    public const double HoursPerTruckAhead = 0.5;

    /// <summary>How early you have to be at a site's gate to be certain of being first through it.</summary>
    public const double EarlyEnoughHours = 4.0;

    public class Call
    {
        /// <summary>Queued | StraightIn | TakenEarly | OnTime | BackedUp</summary>
        public string Kind { get; set; } = "";
        public string ArrivedGameTime { get; set; } = "";
        /// <summary>When the dock actually starts on you. What the driver sets the game clock to.</summary>
        public string WorkStartsGameTime { get; set; } = "";
        public double WaitHours { get; set; }
        /// <summary>Place in the line at a site. 0 where there is no line to be in.</summary>
        public int Position { get; set; }
        public int Ahead { get; set; }
        public string Headline { get; set; } = "";
        public string Instruction { get; set; } = "";
    }

    /// <summary>
    /// Work out the call for a truck arriving now. Null where there is nothing to say — a dock that takes
    /// it straight off you with no wait needs no instruction.
    /// </summary>
    public static Call? Assess(AppState s, Trip trip, DateTime arrived)
    {
        if (trip.Kind != "Freight") return null;

        var booked = GameClock.TryParse(trip.AppointmentOpensGameTime);
        var isSite = FacilityProfile.KindOf(trip.TrailerType) == FacilityProfile.Kind.Site;

        // The seed. The hour they arrived is in it because arriving at three and arriving at seven are
        // different situations and should not share an answer; the trip is in it so the same arrival
        // reported twice does.
        var seed = $"{s.Driver.EmployeeId}|call|{trip.Id}|{arrived:yyyy-MM-ddTHH}";

        return isSite && booked == null
            ? AtSite(s, trip, arrived, seed)
            : AtDock(s, trip, arrived, booked, seed);
    }

    /// <summary>
    /// A job site: open or shut, and a line at the gate. Nobody booked you in, so the only questions are
    /// whether anyone is there and who got there first.
    /// </summary>
    private static Call? AtSite(AppState s, Trip trip, DateTime arrived, string seed)
    {
        var hours = FacilityProfile.SeededHours(s, trip.DestCity, trip.DestState, trip.Receiver);
        var peak = FacilityProfile.QueuePeakHours(s, trip.DestCity, trip.DestState, trip.Receiver);
        var busiest = (int)Math.Round(peak / HoursPerTruckAhead);

        var tod = arrived.TimeOfDay.TotalHours;
        var untilOpen = hours.OpenHour - tod;
        if (untilOpen < -12) untilOpen += 24;          // their opening is tomorrow morning

        double startsIn;
        int ahead;

        if (untilOpen > 0.01)
        {
            // Early. Every hour spent at the gate is a truck that did not beat you to it.
            var earned = Math.Clamp(untilOpen / EarlyEnoughHours, 0, 1);
            ahead = (int)Math.Round(busiest * (1 - earned));
            startsIn = untilOpen + ahead * HoursPerTruckAhead;
        }
        else
        {
            // Inside their day, and the rush at opening has been easing off ever since.
            ahead = (int)Math.Round(FacilityProfile.QueueAt(peak, -untilOpen) / HoursPerTruckAhead);
            startsIn = ahead * HoursPerTruckAhead;
        }

        // Sometimes it is not the queue at all. Reported from play: the same lateness happens on flatbed —
        // "unloader broke down", "unloading guy didn't show up" — and it should, occasionally. A site runs
        // on one machine and one operator far more often than a warehouse does, and when either is missing
        // nothing moves however early you got there.
        //
        // Deliberately uncommon. A hold-up that happens most visits is not a hold-up, it is the schedule.
        var snag = "";
        if (Hash(seed + "|snag") % 100 < 12)
        {
            var extra = 0.5 + (Hash(seed + "|snaghrs") % 7) * 0.25;    // half an hour to two and a quarter
            startsIn += extra;
            snag = (Hash(seed + "|snagwhy") % 3) switch
            {
                0 => $"Their loader is down and the fitter is out — that is {Hhmm.Of(extra)} on top before " +
                     "anything moves. ",
                1 => $"The operator has not turned up. They are chasing him and reckon {Hhmm.Of(extra)}. ",
                _ => $"They are one machine short and working through it, so {Hhmm.Of(extra)} longer than " +
                     "the line alone would say. ",
            };
        }

        var call = new Call
        {
            Kind = ahead > 0 || startsIn > 0.01 ? "Queued" : "StraightIn",
            ArrivedGameTime = GameClock.Format(arrived),
            WorkStartsGameTime = GameClock.Format(arrived.AddHours(startsIn)),
            WaitHours = Math.Round(startsIn, 2),
            Position = ahead + 1,
            Ahead = ahead,
        };

        if (call.Kind == "StraightIn")
        {
            call.Headline = "They are open and there is nobody in front of you";
            call.Instruction = "Straight in. Log Begin unload now and get it off.";
            return call;
        }

        var nth = Nth(call.Position);
        call.Headline = $"{nth} in line — start at {GameClock.Pretty(call.WorkStartsGameTime)}";
        call.Instruction =
            (untilOpen > 0.01
                ? ahead == 0
                    ? $"You are {Hhmm.Of(untilOpen)} ahead of them opening and early enough that nobody beats " +
                      $"you to it, so you are {nth} in line. "
                    : $"You are {Hhmm.Of(untilOpen)} ahead of them opening, with {ahead} already waiting when " +
                      $"the gate goes up, so you are {nth} in line. "
                : $"They are open, with {ahead} in front of you, so you are {nth} in line. ") +
            snag +
            $"ATS will let you drop this the second you back up to it; a site at " +
            $"{GameClock.Pretty(call.ArrivedGameTime)} would not. " +
            $"Set the game clock to {GameClock.Pretty(call.WorkStartsGameTime)} and then log Begin unload, " +
            $"so the {Hhmm.Of(startsIn)} lands on your clocks where it actually went.";
        return call;
    }

    /// <summary>
    /// A dock. They know you are coming, so there is no queue — but a slot is a plan, not a promise, and
    /// a warehouse that is two hours behind is two hours behind whatever it agreed to.
    /// </summary>
    private static Call? AtDock(AppState s, Trip trip, DateTime arrived, DateTime? booked, string seed)
    {
        var roll = Hash(seed) % 100;

        // Nobody booked in: they take it when they can, which is usually straight away.
        if (booked == null)
        {
            if (roll >= 20) return null;                     // waved in, nothing worth saying
            var held = 0.25 + (Hash(seed + "|held") % 7) * 0.25;   // 15 minutes to two hours
            return new Call
            {
                Kind = "BackedUp",
                ArrivedGameTime = GameClock.Format(arrived),
                WorkStartsGameTime = GameClock.Format(arrived.AddHours(held)),
                WaitHours = Math.Round(held, 2),
                Headline = $"They are backed up — start at {GameClock.Pretty(GameClock.Format(arrived.AddHours(held)))}",
                Instruction =
                    $"No appointment on this one, so you take your turn: they are {Hhmm.Of(held)} behind and " +
                    $"the doors are full. Set the game clock to " +
                    $"{GameClock.Pretty(GameClock.Format(arrived.AddHours(held)))} and log Begin unload then.",
            };
        }

        var slot = booked.Value;
        var earlyBy = (slot - arrived).TotalHours;

        // Turning up after your own slot. They are not holding a door for somebody who is not there, so
        // you go in when they get to you.
        if (earlyBy <= 0.01)
        {
            if (roll >= 45) return null;                     // straight in despite being late
            var held = 0.25 + (Hash(seed + "|late") % 6) * 0.25;
            var at = arrived.AddHours(held);
            return new Call
            {
                Kind = "BackedUp",
                ArrivedGameTime = GameClock.Format(arrived),
                WorkStartsGameTime = GameClock.Format(at),
                WaitHours = Math.Round(held, 2),
                Headline = $"Past your slot — start at {GameClock.Pretty(GameClock.Format(at))}",
                Instruction =
                    $"You are past the {GameClock.Pretty(trip.AppointmentOpensGameTime)} you were booked for, " +
                    $"so they have given the door to somebody else and you wait {Hhmm.Of(held)} for the next " +
                    $"one. Set the game clock to {GameClock.Pretty(GameClock.Format(at))} and log Begin unload " +
                    "then. It is not a service failure — the load is judged on when it is DUE — but it is " +
                    "your window it comes out of.",
            };
        }

        // Early for a booked slot. Three ways that goes.
        if (roll < 25)
        {
            return new Call
            {
                Kind = "TakenEarly",
                ArrivedGameTime = GameClock.Format(arrived),
                WorkStartsGameTime = GameClock.Format(arrived),
                WaitHours = 0,
                Headline = "They have a door free — taking you early",
                Instruction =
                    $"You are {Hhmm.Of(earlyBy)} ahead of your {GameClock.Pretty(trip.AppointmentOpensGameTime)} " +
                    "slot and they have a door free, so they are taking you now. Nothing to set — log Begin " +
                    $"unload and get it off. That is {Hhmm.Of(earlyBy)} of window you keep.",
            };
        }

        if (roll < 75)
        {
            return new Call
            {
                Kind = "OnTime",
                ArrivedGameTime = GameClock.Format(arrived),
                WorkStartsGameTime = trip.AppointmentOpensGameTime,
                WaitHours = Math.Round(earlyBy, 2),
                Headline = $"On the slot — start at {GameClock.Pretty(trip.AppointmentOpensGameTime)}",
                Instruction =
                    $"You are {Hhmm.Of(earlyBy)} early and they are running to time, so it is your " +
                    $"{GameClock.Pretty(trip.AppointmentOpensGameTime)} slot and not a minute before. Set the " +
                    $"game clock to {GameClock.Pretty(trip.AppointmentOpensGameTime)} and log Begin unload " +
                    $"then — that {Hhmm.Of(earlyBy)} is sat at their gate and it comes off your window, not " +
                    "out of slack.",
            };
        }

        var behind = 0.5 + (Hash(seed + "|behind") % 9) * 0.25;   // half an hour to two and a half
        var starts = slot.AddHours(behind);
        return new Call
        {
            Kind = "BackedUp",
            ArrivedGameTime = GameClock.Format(arrived),
            WorkStartsGameTime = GameClock.Format(starts),
            WaitHours = Math.Round((starts - arrived).TotalHours, 2),
            Headline = $"They are running behind — start at {GameClock.Pretty(GameClock.Format(starts))}",
            Instruction =
                $"You are {Hhmm.Of(earlyBy)} early, and they are {Hhmm.Of(behind)} behind on top of that — " +
                $"your {GameClock.Pretty(trip.AppointmentOpensGameTime)} slot is not going to happen on time. " +
                $"Set the game clock to {GameClock.Pretty(GameClock.Format(starts))} and log Begin unload " +
                $"then. The whole {Hhmm.Of((starts - arrived).TotalHours)} is detention and it comes out of " +
                "your window — say so in the delay notes if it costs you the day.",
        };
    }

    private static string Nth(int n) => n switch
    {
        1 => "First", 2 => "Second", 3 => "Third", 4 => "Fourth", 5 => "Fifth",
        6 => "Sixth", 7 => "Seventh", 8 => "Eighth", _ => $"{n}th",
    };

    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }
}
