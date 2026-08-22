using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Roughly where a hired driver is with the company's trailer.
///
/// The app cannot see the game, and nothing the fortnightly report collects says where anybody is. What
/// the player CAN tell, glancing at the ATS company screen, is a direction and somewhere the driver
/// appears to be heading. That is imprecise and it is enough: the only decision it feeds is whether a
/// trailer is worth sitting at the yard for.
///
/// This replaces a due-back date that used to be asked for on a fleet review line — a question about
/// where somebody is right now, asked in the wrong place and at the wrong time, and answered with a
/// precision nobody has.
/// </summary>
public static class Whereabouts
{
    /// <summary>Below this, waiting at the yard is the sensible play.</summary>
    public const double WorthWaitingDays = 2;

    /// <summary>How rough an estimate is allowed to get before it is treated as no answer at all.</summary>
    public const double StaleAfterDays = 14;

    public class Estimate
    {
        public bool Known { get; set; }
        public string Direction { get; set; } = "";
        public double? Days { get; set; }
        public bool WorthWaiting { get; set; }
        public string Text { get; set; } = "";
    }

    /// <summary>
    /// Turns what the player reported into a wait and a recommendation.
    ///
    /// Deliberately coarse. An inbound driver a state away is a day or so; an outbound one is days
    /// whatever the distance, because they are going the wrong way and have to come back.
    /// </summary>
    public static Estimate Assess(AppState s, HiredDriver d)
    {
        var e = new Estimate { Direction = d.TrailerWhereabouts ?? "" };

        var reported = GameClock.TryParse(d.TrailerWhereaboutsGameTime);
        var now = GameClock.TryParse(s.Status.GameTime);
        var stale = reported != null && now != null && (now.Value - reported.Value).TotalDays > StaleAfterDays;

        if (string.IsNullOrWhiteSpace(e.Direction) || e.Direction == "Unknown" || stale)
        {
            e.Text = stale
                ? "What you told me about where they are is a fortnight old, so I am treating it as nothing. " +
                  "Have another look at the company screen next time you are in."
                : "I have nothing on where they are. Next time you report in, tell me whether they are heading " +
                  "toward a yard or away from one and I can tell you whether the trailer is worth waiting for.";
            return e;
        }

        var home = HomeTime.HomeTerminal(s);
        var miles = home != null && !string.IsNullOrWhiteSpace(d.TrailerHeadingCity)
            ? Geo.MilesBetween(d.TrailerHeadingCity, d.TrailerHeadingState, home.City, home.State)
            : null;

        // A rough speed on purpose. This is an estimate of somebody else's week, not a plan.
        const double milesPerDay = 500;

        if (e.Direction == "Inbound")
        {
            e.Known = true;
            e.Days = miles is { } m ? Math.Max(0.5, Math.Round(m / milesPerDay, 1)) : 1.5;
            e.WorthWaiting = e.Days <= WorthWaitingDays;
            e.Text = miles is { } mi
                ? $"{d.Name} is heading in, last seen making for {DispatchEngine.Place(d.TrailerHeadingCity, d.TrailerHeadingState)} " +
                  $"— about {mi:N0} mi from the yard, so call it {e.Days:0.#} day(s). " +
                  (e.WorthWaiting
                      ? "Worth sitting on: take your home time and hook it when it lands."
                      : "Longer than I would hold you for. I will find you something else and we will re-rig later.")
                : $"{d.Name} is heading in, but I do not know where from — call it a day or two. " +
                  "Worth waiting on if your home time covers it.";
            return e;
        }

        // Outbound: going the wrong way, and has to turn round before any of it helps.
        e.Known = true;
        e.Days = miles is { } om ? Math.Max(2, Math.Round(om / milesPerDay * 2, 1)) : 4;
        e.WorthWaiting = false;
        e.Text = miles is { } omi
            ? $"{d.Name} is running the other way, out toward {DispatchEngine.Place(d.TrailerHeadingCity, d.TrailerHeadingState)} " +
              $"— {omi:N0} mi from the yard and still going. That is {e.Days:0.#} day(s) before the trailer is back " +
              "here at best. Not worth anybody's time; I will re-rig you another way."
            : $"{d.Name} is heading away from the yard. Days rather than hours, and not worth waiting on — " +
              "I will sort the trailer another way.";
        return e;
    }

    /// <summary>One line for the driver, whatever is known.</summary>
    public static string Describe(AppState s, HiredDriver d) => Assess(s, d).Text;

    /// <summary>
    /// Hired drivers holding a company trailer whose whereabouts are worth asking about on arrival.
    ///
    /// Only asked where it could matter — a driver on a trailer, at the yard, with the answer either
    /// missing or old enough to be useless.
    /// </summary>
    public static List<HiredDriver> WorthAsking(AppState s)
    {
        var now = GameClock.TryParse(s.Status.GameTime);
        return s.HiredDrivers
            .Where(d => d.Status == "Active" && !string.IsNullOrWhiteSpace(d.AssignedTrailerUnit))
            .Where(d =>
            {
                if (string.IsNullOrWhiteSpace(d.TrailerWhereabouts)) return true;
                var when = GameClock.TryParse(d.TrailerWhereaboutsGameTime);
                return when == null || now == null || (now.Value - when.Value).TotalDays > StaleAfterDays / 2;
            })
            .ToList();
    }
}
