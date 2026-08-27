using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Roughly where one of the company's trailers is.
///
/// The app cannot see the game, and nothing the fortnightly report collects says where anything is. What
/// the player CAN tell, glancing at the ATS trailer screen, is a direction and somewhere it appears to be
/// heading — or that it is sitting still. That is imprecise and it is enough: the only decision it feeds
/// is how many days ATS will skip to hand that trailer over, and whether it is worth them.
///
/// <b>Asked about the trailer, not the driver holding it.</b> It used to be filed against a
/// <c>HiredDriver</c> and keyed on <c>AssignedTrailerUnit</c>, which assumed a driver stays on the box the
/// app has them down for. AI drivers in ATS swap trailers on their own, so the app asked where M. Torres
/// was with DV-3 when Torres had been on something else for a fortnight, and every answer given was filed
/// against the wrong trailer. The driver was never the thing being asked about; they were an
/// implementation detail the app had no way to keep current.
/// </summary>
public static class Whereabouts
{
    /// <summary>Above this many days of skipped time, the trailer is not worth what it costs.</summary>
    public const double WorthWaitingDays = 2;

    /// <summary>How rough an estimate is allowed to get before it is treated as no answer at all.</summary>
    public const double StaleAfterDays = 14;

    /// <summary>The answers a player can honestly give off the game's trailer screen.</summary>
    public static readonly (string Key, string Label)[] Directions =
    {
        ("Unknown",  "No idea"),
        ("Inbound",  "Rolling toward a yard"),
        ("Outbound", "Rolling away from the yard"),
        ("Parked",   "Parked — nobody is using it"),
    };

    public static bool IsDirection(string? d) =>
        Directions.Any(x => x.Key.Equals((d ?? "").Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Normalises whatever came off the wire to one of <see cref="Directions"/>.</summary>
    public static string Normalise(string? d) =>
        Directions.FirstOrDefault(x => x.Key.Equals((d ?? "").Trim(), StringComparison.OrdinalIgnoreCase)).Key
        ?? "Unknown";

    public class Estimate
    {
        public bool Known { get; set; }
        public string Direction { get; set; } = "";
        public double? Days { get; set; }
        public bool WorthWaiting { get; set; }
        public string Text { get; set; } = "";
    }

    /// <summary>
    /// Turns what the player reported into a forecast of what the swap will cost, and a recommendation.
    ///
    /// <b>What it forecasts is the game's own time skip.</b> Assigning a trailer somebody else is on
    /// makes ATS ask "driver is N days out, is this ok?", and accepting advances the clock by N. So the
    /// question worth answering is not "how long do I wait" — nobody waits — but "how many days is this
    /// trailer going to cost me", which comes out of home time rather than hours.
    ///
    /// Deliberately coarse. An inbound trailer a state away is a day or so; an outbound one is days
    /// whatever the distance, because it is going the wrong way and has to come back. A parked one has
    /// no driver to be out at all, so it is free.
    /// </summary>
    public static Estimate Assess(AppState s, Trailer t)
    {
        var e = new Estimate { Direction = t.Whereabouts ?? "" };
        var label = t.Ref;

        var reported = GameClock.TryParse(t.WhereaboutsGameTime);
        var now = GameClock.TryParse(s.Status.GameTime);
        var stale = reported != null && now != null && (now.Value - reported.Value).TotalDays > StaleAfterDays;

        if (string.IsNullOrWhiteSpace(e.Direction) || e.Direction == "Unknown" || stale)
        {
            e.Text = stale
                ? $"What you told me about {label} is a fortnight old, so I am treating it as nothing. " +
                  "Have another look at the trailer screen next time you are in."
                : $"I have nothing on where {label} is. Next time you report in, tell me whether it is rolling " +
                  "toward a yard, rolling away from one, or parked, and I can tell you what it will cost to take.";
            return e;
        }

        var home = HomeTime.HomeTerminal(s);
        var miles = home != null && !string.IsNullOrWhiteSpace(t.WhereaboutsCity)
            ? Geo.MilesBetween(t.WhereaboutsCity, t.WhereaboutsState, home.City, home.State)
            : null;

        // A rough speed on purpose. This is an estimate of somebody else's week, not a plan.
        const double milesPerDay = 500;

        if (e.Direction == "Parked")
        {
            // Nobody is on it, so the game has no driver to be days out. Taking it costs nothing.
            //
            // This used to say "order an equipment move and go and collect it", which is not something
            // ATS lets anybody do. What the game actually does is ask how many days the current driver is
            // out and skip them — and a parked trailer has no current driver, so there is no prompt and
            // no skip. That is the whole value of the answer.
            e.Known = true;
            e.Days = 0;
            e.WorthWaiting = true;

            e.Text = miles is { } pmi
                ? $"{label} is parked at {DispatchEngine.Place(t.WhereaboutsCity, t.WhereaboutsState)} with nobody " +
                  $"on it — {pmi:N0} mi from the yard. Nobody is out with it, so the game will not charge you " +
                  "days for it: straight swap in the trailer manager."
                : $"{label} is parked and nobody is on it. No driver to be days out, so the game will not " +
                  "charge you anything for taking it — straight swap in the trailer manager.";
            return e;
        }

        if (e.Direction == "Inbound")
        {
            e.Known = true;
            e.Days = miles is { } m ? Math.Max(0.5, Math.Round(m / milesPerDay, 1)) : 1.5;
            e.WorthWaiting = e.Days <= WorthWaitingDays;
            e.Text = miles is { } mi
                ? $"{label} is heading in, last seen making for {DispatchEngine.Place(t.WhereaboutsCity, t.WhereaboutsState)} " +
                  $"— about {mi:N0} mi from the yard, so the game will likely charge about {e.Days:0.#} day(s) to take it. " +
                  (e.WorthWaiting
                      ? "Worth it: those days come off your home time rather than your hours."
                      : "More than I would spend on a trailer. I will find you another one.")
                : $"{label} is heading in, but I do not know where from — call it a day or two off your home time. " +
                  "Worth it if your home time covers it.";
            return e;
        }

        // Outbound: going the wrong way, and has to turn round before any of it helps.
        e.Known = true;
        e.Days = miles is { } om ? Math.Max(2, Math.Round(om / milesPerDay * 2, 1)) : 4;
        e.WorthWaiting = false;
        e.Text = miles is { } omi
            ? $"{label} is running the other way, out toward {DispatchEngine.Place(t.WhereaboutsCity, t.WhereaboutsState)} " +
              $"— {omi:N0} mi from the yard and still going. Reckon the game charges {e.Days:0.#} day(s) to take it " +
              "off them. Not worth that; I will re-rig you another way."
            : $"{label} is heading away from the yard. Days rather than hours off your home time, and not worth " +
              "it — I will sort the trailer another way.";
        return e;
    }

    /// <summary>One line about a trailer, whatever is known.</summary>
    public static string Describe(AppState s, Trailer t) => Assess(s, t).Text;

    /// <summary>
    /// Company trailers whose position is worth asking about on arrival.
    ///
    /// Only asked where it could matter — a real trailer that is not the one under the driver's own
    /// truck, with the answer either missing or old enough to be useless. The drop-and-hook slot is not
    /// a box that exists anywhere, so it is never asked about.
    /// </summary>
    public static List<Trailer> WorthAsking(AppState s)
    {
        var now = GameClock.TryParse(s.Status.GameTime);
        return s.Trailers
            .Where(t => !t.Retired && !DropHook.Is(t.Type))
            .Where(t => !t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase))
            .Where(t =>
            {
                if (string.IsNullOrWhiteSpace(t.Whereabouts)) return true;
                var when = GameClock.TryParse(t.WhereaboutsGameTime);
                return when == null || now == null || (now.Value - when.Value).TotalDays > StaleAfterDays / 2;
            })
            .ToList();
    }
}
