using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What kind of place the freight is going to, and what that means for waiting.
///
/// <para>The app used to model one kind of waiting for the whole fleet: an appointment you turn up early
/// for. Everything ran through <c>AppointmentOpensHours</c>, so a load with no appointment had no wait at
/// all, ever. That is right for some freight and badly wrong for the rest, and it read from the driver's
/// seat as flatbed work being free of the one cost that dominates dry van work.</para>
///
/// <para>There are two kinds of receiver and they behave differently:</para>
///
/// <list type="bullet">
/// <item><b>Docks</b> — dry van and reefer into warehouses and stores. Busy places running around the
/// clock, so being early is fine: there is a third shift stocking shelves at 3am. What you wait for is
/// your <b>slot</b>, because forty other trucks are booked into the same doors. Reefer freight is nearly
/// always booked, being perishable; a reefer running something that does not need cooling is a dry van
/// with an expensive trailer, and gets dry van's odds.</item>
/// <item><b>Sites</b> — flatbed, tanker, dump, log into job sites, tank farms, yards and mills. Rarely
/// booked: they take it when you get there. But they are <b>not open around the clock</b>. Nobody is at a
/// construction site at 3am, so what you wait for is <b>opening</b> — and then for the trucks that queued
/// up at the gate before you.</item>
/// </list>
///
/// <para>So a dock wait is a <i>point</i> you wait for even when the building is lit up, and a site wait is
/// a <i>range</i> where any time inside it is free. That distinction is the whole of this file.</para>
///
/// <para><b>The game's own window comes first.</b> ATS shows a time range on the listing, the screenshot
/// reader is told to transcribe it verbatim, and <see cref="DeliveryWindow.Read"/> turns it into an
/// opening and a due time. Where that exists it IS the operating hours and nothing here is guessed. The
/// seeded hours below are the backstop for a load typed in without one.</para>
/// </summary>
public static class FacilityProfile
{
    public enum Kind
    {
        /// <summary>A warehouse or store: booked slots, staffed around the clock.</summary>
        Dock,
        /// <summary>A site, yard, mill or tank: take it when you arrive, but only while they are open.</summary>
        Site,
    }

    /// <summary>
    /// Which kind of place this trailer's freight goes to.
    ///
    /// Decided on the trailer rather than the cargo, because it is about the building: a reefer full of
    /// cardboard still backs onto a warehouse dock. What the cargo decides is whether the load is
    /// <i>booked</i> — see <see cref="TakesEarlyPercent"/>.
    ///
    /// Drop and hook is a dock. You are pulling a warehouse's own trailer to and from warehouses.
    /// </summary>
    public static Kind KindOf(string? trailerType)
    {
        var t = (trailerType ?? "").Trim();
        if (DropHook.Is(t)) return Kind.Dock;

        return t switch
        {
            "Dry Van" or "Reefer" or "Refrigerated" or "Van" => Kind.Dock,
            "Flatbed" or "Step Deck" or "Lowboy" or "Tanker" or "Dump"
                or "Hopper" or "Log" or "Livestock" or "Car Hauler" => Kind.Site,
            _ => Kind.Dock,      // unknown freight is treated as the gentler case
        };
    }

    /// <summary>Freight that needs the reefer actually running, and is therefore booked in.</summary>
    private static readonly string[] ColdWords =
    {
        "frozen", "chilled", "refriger", "cold", "ice", "produce", "fruit", "vegetab", "dairy", "milk",
        "cheese", "yogurt", "meat", "beef", "pork", "poultry", "chicken", "fish", "seafood", "flower",
        "plant", "pharma", "vaccine", "medic", "bakery", "dough", "juice",
    };

    /// <summary>
    /// Whether a reefer load actually needs the box running.
    ///
    /// A guess off the cargo name, and said as a guess: the game does not report a setpoint anywhere the
    /// app can read, so this is the only signal available short of asking on every listing. It only ever
    /// moves the odds of the load being booked — it never invents a window, and where the game gave one
    /// that window wins outright.
    /// </summary>
    public static bool IsColdFreight(string? cargo)
    {
        var c = (cargo ?? "").Trim().ToLowerInvariant();
        return c.Length > 0 && ColdWords.Any(w => c.Contains(w, StringComparison.Ordinal));
    }

    /// <summary>
    /// The chance this receiver simply takes the load whenever it turns up, rather than holding it to a
    /// booked slot.
    ///
    /// Replaces one flat number for the whole fleet. That number was 12%, which said every receiver in
    /// the country books nearly every load — true of a grocery DC and nonsense at a bridge job.
    ///
    /// Sites are mostly unbooked and get their waiting from opening hours and the queue instead. Docks
    /// are mostly booked, and reefer nearly always: perishables move to a schedule.
    /// </summary>
    /// <summary>What the setting reads before anybody touches it. Away from this it is an instruction.</summary>
    public const double SettingDefaultPct = 12;

    /// <summary>
    /// The player has moved the takes-early knob off its default, so it is an instruction about the whole
    /// world rather than a default to be refined per receiver.
    ///
    /// It overrides the opening hours too. Somebody who has set "every receiver takes it whenever" has
    /// said something about job sites as much as about docks, and a setting that quietly stops applying
    /// to half the fleet is worse than not having one.
    /// </summary>
    public static bool KnobMoved(AppState s) =>
        Math.Abs(s.Settings.ReceiverTakesEarlyPct - SettingDefaultPct) > 0.01;

    public static int TakesEarlyPercent(AppState s, string? trailerType, string? cargo)
    {
        // A knob the player has actually moved wins outright. It is the whole fleet's answer because
        // that is what somebody setting one number for the whole fleet is asking for, and a setting that
        // silently stops doing anything is worse than not having it.
        var knob = s.Settings.ReceiverTakesEarlyPct;
        if (Math.Abs(knob - SettingDefaultPct) > 0.01) return (int)Math.Clamp(knob, 0, 100);

        var t = (trailerType ?? "").Trim();

        // A job site is not booked; it is open or it is not. Its waiting comes from opening hours and the
        // queue at the gate instead.
        if (KindOf(t) == Kind.Site) return 85;
        if (DropHook.Is(t)) return 40;    // the trailer is already there; it is the dock time that is booked

        // Perishables move to a schedule. A reefer hauling something that does not need the box running
        // is a dry van with an expensive trailer.
        if (t is "Reefer" or "Refrigerated" && IsColdFreight(cargo)) return 5;

        return 25;                        // dry van into a warehouse: booked three times in four
    }

    /// <summary>When a site is open, as hours of the day. Null where the place never closes.</summary>
    public record OpeningHours(double OpenHour, double CloseHour)
    {
        public double LengthHours => CloseHour > OpenHour ? CloseHour - OpenHour : 24 - OpenHour + CloseHour;
    }

    /// <summary>
    /// The hours a site keeps, seeded on the career and the customer.
    ///
    /// Seeded exactly the way <see cref="Facilities.AllowsOvernightParking"/> is, and for the same reason:
    /// it is a fact about a place rather than a reading off the driver's truck, it has to be the same
    /// answer every time it is asked, and two players should not get an identical map of early starters.
    ///
    /// Only ever consulted when the game gave no window. A range off the listing is real and beats this.
    /// </summary>
    public static OpeningHours SeededHours(AppState s, string? city, string? state, string? receiver)
    {
        var key = $"{(receiver ?? "").Trim().ToLowerInvariant()}|" +
                  $"{(city ?? "").Trim().ToLowerInvariant()},{(state ?? "").Trim().ToLowerInvariant()}";

        var open = 5 + (int)(Hash($"{s.Driver.EmployeeId}|open|{key}") % 4);       // 05:00 - 08:00
        var close = 15 + (int)(Hash($"{s.Driver.EmployeeId}|close|{key}") % 5);    // 15:00 - 19:00
        return new OpeningHours(open, close);
    }

    /// <summary>
    /// How long the queue at the gate runs when the place opens, in hours.
    ///
    /// Everybody shows up at opening, so that is when it is worst; it eases off through the morning. This
    /// is the thing that stops "no appointment" reading as "no waiting" — a flatbed at a busy yard waits
    /// for the four trucks in front of it whether or not anybody booked a time.
    ///
    /// It is time ON the property, on duty, so it lands on the dock clock rather than being idle at a
    /// gate. That keeps it out of the appointment-idle term, which prices a different thing.
    /// </summary>
    public static double QueuePeakHours(AppState s, string? city, string? state, string? receiver)
    {
        var key = $"{(receiver ?? "").Trim().ToLowerInvariant()}|" +
                  $"{(city ?? "").Trim().ToLowerInvariant()},{(state ?? "").Trim().ToLowerInvariant()}";

        // A quiet yard, a normal one, or one where half the county turns up at seven.
        return (Hash($"{s.Driver.EmployeeId}|queue|{key}") % 7) switch
        {
            0 or 1 => 0,          // walk straight in
            2 or 3 or 4 => 0.5,   // a couple ahead of you
            5 => 1.0,
            _ => 1.5,             // busy place, and you will know about it
        };
    }

    /// <summary>
    /// How much of that queue is still there, arriving this many hours after they opened.
    ///
    /// Straight-line decay over the morning: worst on the dot of opening, gone by mid-day. Turning up at
    /// ten rather than six is a real decision, and this is what makes it one.
    /// </summary>
    public const double QueueEasesOverHours = 5.0;

    public static double QueueAt(double peakHours, double hoursAfterOpening)
    {
        if (peakHours <= 0) return 0;
        var left = 1.0 - Math.Clamp(hoursAfterOpening, 0, QueueEasesOverHours) / QueueEasesOverHours;
        return Math.Round(peakHours * left, 2);
    }

    /// <summary>Everything the planner needs to know about where this load is going.</summary>
    public record Profile(Kind Kind, int TakesEarlyPct, double OpenHour, double CloseHour,
                          double QueuePeak, bool HoursAreGuess);

    /// <summary>
    /// Read the receiver off the load.
    ///
    /// <b>The game's own window wins.</b> Where the driver entered a range off the listing — and the
    /// screenshot reader is told to transcribe it verbatim, so it is there on most loads — that range IS
    /// this site's working day and nothing is guessed. The seeded hours are the backstop for a load typed
    /// in without one, which is the case that used to plan as though the place never closed.
    /// </summary>
    public static Profile For(AppState s, BoardLoad load, string? trailerType)
    {
        var kind = KindOf(trailerType);
        var pct = TakesEarlyPercent(s, trailerType, load.Cargo);

        // A dock never closes. There is a third shift stocking shelves at 3am, and what you wait for
        // there is your slot — which WaitUntilHours already handles.
        if (kind == Kind.Dock) return new Profile(kind, pct, -1, -1, 0, false);

        double open, close;
        bool guessed;
        if (load.AppointmentOpensHours > 0 && GameClock.TryParse(s.Status.GameTime) is { } now)
        {
            open = now.AddHours(load.AppointmentOpensHours).TimeOfDay.TotalHours;
            close = now.AddHours(Math.Max(load.AppointmentOpensHours, load.DeadlineHours)).TimeOfDay.TotalHours;
            guessed = false;
        }
        else
        {
            var h = SeededHours(s, load.DestCity, load.DestState, load.Receiver);
            open = h.OpenHour;
            close = h.CloseHour;
            guessed = true;
        }

        return new Profile(kind, pct, Math.Round(open, 2), Math.Round(close, 2),
                           QueuePeakHours(s, load.DestCity, load.DestState, load.Receiver), guessed);
    }

    /// <summary>
    /// What the driver on a load already running should know about the place they are going to.
    ///
    /// <b>This is how a load in flight picks up the rule.</b> A trip's FeasibilityAtDispatch is not
    /// rewritten and must not be: it is the record of what the company knew when it committed the truck,
    /// and Stranded reads it to decide whether a delay was dispatch's doing or the facility's. Giving an
    /// old plan today's reading of a job site would quietly re-attribute blame for something that already
    /// happened.
    ///
    /// So the plan stays as it was and the advice is fresh, exactly the way the overnight-parking note
    /// works — same seed, same answer every time it is asked, nothing to migrate onto old trips.
    /// </summary>
    public static object? SiteHoursFor(AppState s, Trip? trip)
    {
        if (trip == null || trip.Kind != "Freight") return null;
        if (KindOf(trip.TrailerType) != Kind.Site) return null;
        if (string.IsNullOrWhiteSpace(trip.DestCity) && string.IsNullOrWhiteSpace(trip.Receiver)) return null;

        var h = SeededHours(s, trip.DestCity, trip.DestState, trip.Receiver);
        var queue = QueuePeakHours(s, trip.DestCity, trip.DestState, trip.Receiver);
        var who = string.IsNullOrWhiteSpace(trip.Receiver) ? "They" : trip.Receiver.Trim();
        var where = DispatchEngine.Place(trip.DestCity ?? "", trip.DestState ?? "");

        string Clock(double hour) => $"{(int)hour:00}:{(int)Math.Round((hour - (int)hour) * 60):00}";

        return new
        {
            openHour = h.OpenHour,
            closeHour = h.CloseHour,
            queuePeakHours = queue,
            headline = $"No appointment — {who} take it when you get there",
            detail =
                $"{where} is a site rather than a dock, so there is no slot to hit and nothing is gained by " +
                $"pushing to arrive early. What there is instead is a working day: reckon on somebody being " +
                $"there from about {Clock(h.OpenHour)} to {Clock(h.CloseHour)}. Roll up at three in the " +
                "morning and you are waiting for them either way." +
                (queue > 0.01
                    ? $" It is a busy gate, too — about {Hhmm.Of(queue)} of trucks ahead of you if you arrive " +
                      "on the dot of opening, easing off through the morning."
                    : " It is a quiet one, so you should walk straight in.") +
                " That is our reading of the place, not something the game told us — treat it as a plan, not a promise.",
        };
    }

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
