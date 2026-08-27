using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What a receiver will and will not let you do on their property.
///
/// Turning up before the doors open means sitting somewhere, and where that somewhere is depends on
/// the receiver. Plenty of them will let a truck sit overnight at the gate; plenty of them will not,
/// and then the driver has to find a truck stop, take the reset there, and come back for the
/// appointment. That is a real difference — it is extra driving on a clock that is already the
/// binding constraint — so the app plans for it rather than assuming the friendly case.
///
/// Whether a given facility allows it is <b>seeded on the facility itself</b>, not on the load. A
/// receiver either has room for parked trucks or it does not, so the answer has to be the same every
/// time you look at it: the same customer in the same city gives the same answer on every board, and
/// refreshing cannot re-roll it into a more convenient one.
/// </summary>
public static class Facilities
{
    /// <summary>
    /// Roughly half of receivers will let you sit overnight. Not a majority either way, because the
    /// interesting case is the one where you have to plan around it.
    /// </summary>
    private const uint AllowsOvernightPercent = 55;

    /// <summary>Getting to a truck stop and back when the receiver will not have you.</summary>
    public const double RepositionHoursEachWay = 0.5;

    /// <summary>
    /// Will this receiver let a truck sit on their property overnight?
    ///
    /// Keyed on the customer and the city, so a customer with sites in two places can differ between
    /// them — which is how it actually works. A receiver we have no name for is judged on the city
    /// alone rather than treated as a fresh unknown every time.
    /// </summary>
    public static bool AllowsOvernightParking(AppState s, string? city, string? state, string? receiver)
    {
        var key = $"{(receiver ?? "").Trim().ToLowerInvariant()}|" +
                  $"{(city ?? "").Trim().ToLowerInvariant()},{(state ?? "").Trim().ToLowerInvariant()}";
        if (key.Trim(' ', '|', ',').Length == 0) return true;   // nothing to judge: assume the easy case

        // Salted with the career so two players do not get an identical map of friendly receivers.
        return Hash($"{s.Driver.EmployeeId}|parking|{key}") % 100 < AllowsOvernightPercent;
    }

    /// <summary>
    /// Whether the receiver on an open load will take the truck overnight, for the trip card.
    ///
    /// The briefing says this once, at authorization, and then the board is gone. It stays true for the
    /// whole run and it decides where the last few hours before the appointment are spent — a decision
    /// made several hundred miles and possibly two days after the sentence that answered it.
    ///
    /// Recomputed rather than stored: the answer is seeded on the career, the customer and the city, so
    /// asking again gives the same answer and there is nothing to migrate onto old trips.
    /// </summary>
    public static object? ParkingFor(AppState s, Trip? trip)
    {
        if (trip == null || trip.Kind != "Freight") return null;
        if (string.IsNullOrWhiteSpace(trip.DestCity) && string.IsNullOrWhiteSpace(trip.Receiver)) return null;

        var allowed = AllowsOvernightParking(s, trip.DestCity, trip.DestState, trip.Receiver);
        var who = string.IsNullOrWhiteSpace(trip.Receiver) ? "The receiver" : trip.Receiver.Trim();
        var where = DispatchEngine.Place(trip.DestCity ?? "", trip.DestState ?? "");

        return new
        {
            allowed,
            receiver = who,
            where,
            headline = allowed ? "You can sit on their property" : "No overnight parking on site",
            detail = allowed
                ? $"{who} at {where} will have you on the property. So an early arrival is yours to sit out at " +
                  "the dock if you want it, and running the last leg straight in is an option rather than the " +
                  "plan. A truck stop has showers, food and fuel; which of those is worth more tonight is your " +
                  "call, not ours."
                : $"{who} at {where} does not allow overnight parking. If you get in ahead of the window you " +
                  $"need a truck stop nearby, which is about {Hhmm.Of(RepositionHoursEachWay * 2)} of running " +
                  "either side and it comes off your clocks. Plan the last leg to arrive inside the window."
        };
    }

    /// <summary>
    /// What the driver is told once we know there is a wait to sit out.
    ///
    /// One fact and no instruction when the gate is open: whether they may sit there is something the app
    /// knows, and whether they want to is not. It used to say "park up there and take the 2:30 where you
    /// are dropping", which reads as the plan rather than as one of two — and a shower and a meal are a
    /// perfectly good reason to spend the running instead.
    /// </summary>
    public static string OvernightNote(AppState s, string? city, string? state, string? receiver, double waitHours)
    {
        var who = string.IsNullOrWhiteSpace(receiver) ? "The receiver" : receiver.Trim();
        var where = DispatchEngine.Place(city ?? "", state ?? "");

        return AllowsOvernightParking(s, city, state, receiver)
            ? $"{who} at {where} will let you sit on their property, so the {Hhmm.Of(waitHours)} can be taken " +
              "where you are dropping if that suits you. A truck stop instead costs about " +
              $"{Hhmm.Of(RepositionHoursEachWay * 2)} of running either side and buys you a shower and a meal. " +
              "Both are fine — I am telling you the gate is open, not where to sleep."
            : $"{who} at {where} does not allow overnight parking. Find a truck stop nearby, sit the " +
              $"{Hhmm.Of(waitHours)} there, and come back for your appointment — that is about " +
              $"{Hhmm.Of(RepositionHoursEachWay * 2)} of running either side, and it comes off your clocks.";
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }
}
