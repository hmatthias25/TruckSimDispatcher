using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Out of window at the dock.
///
/// A receiver holds the driver longer than planned, and by the time the trailer is empty the 14-hour
/// window is gone. This happens constantly in real trucking, and a player who does not know the rules
/// will either assume they have done something wrong or — much worse — drive.
///
/// The rules are clear and worth stating plainly, because they are counter-intuitive:
///
/// <list type="bullet">
///   <item>Running out of window at a dock is <b>not a violation</b>. The window and the drive clock
///   limit <i>driving</i>, not working, and on-duty-not-driving has no cap of its own.</item>
///   <item>Finishing the unload after the window expires is legal.</item>
///   <item><b>Driving after it expires is not.</b> Not to the exit, not to the truck stop a mile away,
///   not "just off the property".</item>
///   <item>No exception covers it. Adverse driving conditions can extend driving by two hours; being
///   held at a dock cannot. The driver is parked where they stand.</item>
/// </list>
///
/// And it is never the driver's fault. Either the facility overran what we planned for, or dispatch
/// booked a load that arrived with no window left — which is the company's bad call, not theirs.
/// </summary>
public static class Stranded
{
    public class Situation
    {
        public bool IsStranded { get; set; }
        /// <summary>Shipper | Receiver | Yard | elsewhere — where they are stuck.</summary>
        public string Where { get; set; } = "";
        public string Place { get; set; } = "";
        public double DriveRemaining { get; set; }
        public double ShiftRemaining { get; set; }
        /// <summary>Which clock ran out: "14-hour window" | "drive clock" | "both".</summary>
        public string OutOf { get; set; } = "";
        public string Headline { get; set; } = "";
        public List<string> Lines { get; set; } = new();
        /// <summary>Facility | Company — never Driver.</summary>
        public string Fault { get; set; } = "";
        public string FaultReason { get; set; } = "";
    }

    private static bool AtFacility(string kind) =>
        kind is "Shipper" or "Receiver" or "Terminal" or "Yard" or "Customer";

    /// <summary>
    /// Reads the driver's reported clocks and position and decides whether they are stuck on a
    /// customer's property. Judged from both clocks: the window is usually what runs out first, but
    /// either one alone is enough to stop the truck moving.
    /// </summary>
    public static Situation Assess(AppState s)
    {
        var sit = new Situation
        {
            DriveRemaining = Math.Max(0, s.Hos.DriveRemaining),
            ShiftRemaining = Math.Max(0, s.Hos.ShiftRemaining),
            Where = s.Status.LocationKind,
            Place = DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState)
        };

        // A tenth of an hour is the practical floor — nobody moves a truck on six minutes of window.
        var noWindow = sit.ShiftRemaining <= 0.1;
        var noDrive = sit.DriveRemaining <= 0.1;
        if (!noWindow && !noDrive) return sit;
        if (!AtFacility(sit.Where)) return sit;

        sit.IsStranded = true;
        sit.OutOf = noWindow && noDrive ? "both clocks"
            : noWindow ? $"{s.Settings.Hos.ShiftLimit:0.#}-hour window"
            : "drive clock";

        var atCustomer = sit.Where is "Shipper" or "Receiver" or "Customer";
        var restHours = s.Settings.Hos.OffDutyReset;

        sit.Headline = $"You are out of {sit.OutOf} at {(atCustomer ? "the " + sit.Where.ToLowerInvariant() : sit.Place)}. " +
                       "That is not a violation, and it is not your fault — but you are parked.";

        sit.Lines.Add("Finishing the work is legal. The window and the drive clock limit driving, not working — " +
                      "on-duty-not-driving has no cap of its own, so getting the trailer empty is fine.");
        sit.Lines.Add("Moving the truck is not. Not to the exit, not to the truck stop down the road, not just off the " +
                      "property. There is no exception that covers being held at a dock — adverse weather can buy you two " +
                      "hours, detention cannot buy you any.");
        sit.Lines.Add($"So take your {restHours:0.#} where you are. Ask them about parking — plenty of places will let you sit, " +
                      "and it costs nothing to ask.");
        if (atCustomer)
            sit.Lines.Add($"If they turn you out, say so in the delay notes. A {sit.Where.ToLowerInvariant()} that holds a driver past " +
                          "their hours and then will not let them sleep is worth knowing about before we book there again.");
        sit.Lines.Add($"Report your clocks again once you are rested and I will have the next load ready. " +
                      $"The {restHours:0.#} restores drive and window; it does not touch the cycle.");

        // Whose fault. The plan is the evidence: if it projected almost no window left on arrival, this
        // was booked badly. Otherwise the dock overran and the hours belong to the facility.
        var trip = TripService.Active(s) ?? s.Trips.FirstOrDefault(t => t.Status == "Delivered");
        var planned = trip?.FeasibilityAtDispatch;
        var margin = s.Settings.StrandedMarginHours;

        if (planned != null && planned.ShiftRemainingOnArrival is var left and >= 0 && left < margin)
        {
            sit.Fault = "Company";
            sit.FaultReason = $"The plan had you finishing with {Hhmm.Of(left)} of window in hand against our {Hhmm.Of(margin)} margin. " +
                              "That was too thin when I booked it — this one is on dispatch, not on you.";
        }
        else
        {
            sit.Fault = "Facility";
            sit.FaultReason = "The dock ran longer than we planned for. The hours belong to the facility, they are detention, " +
                              "and nothing here touches your safety record.";
        }
        sit.Lines.Add(sit.FaultReason);

        return sit;
    }
}
