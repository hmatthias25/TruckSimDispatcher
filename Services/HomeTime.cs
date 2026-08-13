using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Home time: how long the driver agreed to stay out, how long they have actually been out, and what
/// dispatch does about it.
///
/// This is the one driver preference the company is contractually on the hook for. A carrier that
/// runs a driver six weeks when they were promised two loses the driver, so it is not a scoring
/// nicety — as the date approaches, freight that finishes near the home terminal starts outranking
/// freight that pays slightly better going the wrong way, and once the date passes, dispatch argues
/// against anything running further out.
///
/// It aims at a radius, not a bullseye. ATS generates loads to fixed cities and there may simply be
/// no freight to the home yard itself, so landing within a couple of hundred miles counts.
/// </summary>
public static class HomeTime
{
    /// <summary>The arrangements a driver can hold, in the order recruiting offers them.</summary>
    public static readonly (string Key, string Label, int Days, string Note)[] Options =
    {
        ("weekly",     "Home every week",        7,  "Weekend at the house. Regional freight, shorter runs, smaller cheques."),
        ("biweekly",   "Home every other week", 14,  "The common OTR arrangement — two weeks out, a proper reset at home."),
        ("threeweeks", "Home every three weeks", 21, "Longer runs and better mileage between resets."),
        ("monthly",    "Home about once a month",30, "Long OTR. Most miles, most money, least time at the house."),
        ("sixweeks",   "Home every six weeks",   42, "Hard OTR. You will see a lot of the map and not much of home."),
        ("none",       "No arrangement — keep me out", 0, "Dispatch never routes you home. Run until you ask.")
    };

    public static int DaysFor(string? key) =>
        Options.FirstOrDefault(o => o.Key.Equals((key ?? "").Trim(), StringComparison.OrdinalIgnoreCase)).Days;

    public static string LabelFor(string? key)
    {
        var hit = Options.FirstOrDefault(o => o.Key.Equals((key ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        return hit.Label ?? "No arrangement";
    }

    /// <summary>Where home time stands right now.</summary>
    public class HomeStatus
    {
        public bool Tracked { get; set; }
        public int IntervalDays { get; set; }
        public string Arrangement { get; set; } = "";
        public string TerminalId { get; set; } = "";
        public string TerminalLabel { get; set; } = "";
        public double DaysOut { get; set; }
        public double DaysUntilDue { get; set; }
        /// <summary>Inside the last quarter of the arrangement — start steering that way.</summary>
        public bool DueSoon { get; set; }
        /// <summary>Past the agreed interval. The company is now late.</summary>
        public bool Overdue { get; set; }
        /// <summary>Rough miles from where the truck is now to the home terminal. Null = unknown.</summary>
        public double? MilesFromHome { get; set; }
        public bool AtHome { get; set; }
        public string Headline { get; set; } = "";
        public string LastHomeGameTime { get; set; } = "";
        public int HomeTimesTaken { get; set; }
        /// <summary>Set when a trailer reassignment is holding the driver at the yard.</summary>
        public string WaitingOn { get; set; } = "";
        public string WaitingUntil { get; set; } = "";
    }

    public static Terminal? HomeTerminal(AppState s) =>
        s.Company.Terminals.FirstOrDefault(t => t.Id == s.Driver.HomeTerminalId)
        ?? s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters)
        ?? s.Company.Terminals.FirstOrDefault();

    public static HomeStatus Status(AppState s)
    {
        var st = new HomeStatus
        {
            IntervalDays = s.Driver.HomeTimeIntervalDays,
            Arrangement = LabelFor(s.Application?.HomeTimePreference),
            HomeTimesTaken = s.Driver.HomeTimesTaken,
            LastHomeGameTime = s.Driver.LastHomeGameTime
        };

        var home = HomeTerminal(s);
        if (home == null || st.IntervalDays <= 0)
        {
            st.Headline = st.IntervalDays <= 0
                ? "No home-time arrangement on file — dispatch will not route you home."
                : "No home terminal set, so there is nowhere to route you.";
            return st;
        }

        st.Tracked = true;
        st.TerminalId = home.Id;
        st.TerminalLabel = DispatchEngine.Place(home.City, home.State);

        // Count from the last time we were home; failing that, from the day they were hired.
        var since = GameClock.TryParse(s.Driver.LastHomeGameTime)
                    ?? GameClock.TryParse(s.Driver.HiredGameDate);
        var now = GameClock.TryParse(s.Status.GameTime);
        if (since != null && now != null)
            st.DaysOut = Math.Max(0, (now.Value - since.Value).TotalDays);

        st.DaysUntilDue = st.IntervalDays - st.DaysOut;
        st.DueSoon = st.DaysOut >= st.IntervalDays * 0.75;
        st.Overdue = st.DaysOut >= st.IntervalDays;

        st.MilesFromHome = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        st.AtHome = st.MilesFromHome is { } m && m <= s.Settings.Scoring.HomeRadiusMiles;

        // Re-rigged and waiting on the trailer to come back in — that wait is spent at home.
        if (EquipmentService.PendingTrailerWait(s) is { } wait)
        {
            st.WaitingOn = string.IsNullOrWhiteSpace(wait.HeldByDriverName)
                ? $"trailer {wait.ToTrailerUnit}"
                : $"{wait.HeldByDriverName} to bring trailer {wait.ToTrailerUnit} in";
            st.WaitingUntil = wait.AvailableFromGameTime;
            st.Headline = $"Home, and held here until {st.WaitingOn} — around {GameClock.Pretty(wait.AvailableFromGameTime)}. " +
                          "The wait is home time, not hours.";
            return st;
        }

        st.Headline = st.Overdue
            ? $"Home time is OVERDUE — {st.DaysOut:0.#} days out against a {st.IntervalDays}-day arrangement. " +
              (st.AtHome ? "You are close enough to take it now." : "Dispatch is routing you toward {0}.".Replace("{0}", st.TerminalLabel))
            : st.DueSoon
                ? $"Home time due in {st.DaysUntilDue:0.#} days. Operations is working freight back toward {st.TerminalLabel}."
                : $"{st.DaysOut:0.#} days out, home time in {st.DaysUntilDue:0.#} days.";

        return st;
    }

    /// <summary>
    /// Records a visit home when the driver reports being at (or near) their home terminal. Called on
    /// every status report — being home is something we observe, not something we schedule.
    /// </summary>
    public static bool Touch(AppState s)
    {
        if (s.Driver.HomeTimeIntervalDays <= 0) return false;
        var home = HomeTerminal(s);
        if (home == null) return false;

        var miles = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        // Only the yard itself counts as actually taking home time. The radius is for planning loads,
        // not for claiming the driver got home when they are still two hours away.
        var atYard = miles is { } m && m <= 1;
        if (!atYard) return false;

        // Do not re-stamp repeatedly while parked at home; only when meaningfully out and back.
        var last = GameClock.TryParse(s.Driver.LastHomeGameTime);
        var now = GameClock.TryParse(s.Status.GameTime);
        if (last != null && now != null && (now.Value - last.Value).TotalDays < 1) return false;

        s.Driver.LastHomeGameTime = s.Status.GameTime;
        s.Driver.HomeTimesTaken++;
        ConsiderTrailerReassignment(s);
        return true;
    }

    /// <summary>
    /// Sometimes — not every time — the company re-rigs a driver while they are home, because the
    /// freight it wants them on next needs a different trailer.
    ///
    /// Home time is the only realistic moment for this: the truck is standing at its own yard with
    /// nothing hooked to it. Whether it happens is seeded on the driver and which home time this is,
    /// so it cannot be re-rolled by reloading the page, and it is deliberately occasional — a carrier
    /// that changed your trailer every single time you came home would be a carrier with no plan.
    /// </summary>
    public static EquipmentOrder? ConsiderTrailerReassignment(AppState s)
    {
        var divisions = s.Company.Divisions?.Where(d => !string.IsNullOrWhiteSpace(d)).ToList() ?? new List<string>();
        if (divisions.Count < 2) return null;    // a one-division carrier has nothing to move you to

        var current = DispatchEngine.AssignedTrailer(s);
        if (current == null) return null;

        // Never on the first trip home. A carrier settles a new driver on one kind of freight before
        // it starts moving them around, and being re-rigged on your first weekend reads as chaos
        // rather than as a company with a plan.
        if (s.Driver.HomeTimesTaken < 2) return null;

        // Roughly one home time in three thereafter. Seeded, so refreshing does not re-roll it.
        var roll = Hash($"{s.Driver.Name}|reassign|{s.Driver.HomeTimesTaken}") % 100;
        if (roll >= 34) return null;

        // Move them onto a division the carrier runs that is not what they are pulling now, and that
        // they are actually qualified for — no tanker without the endorsement.
        var options = divisions
            .Select(TrailerTypeFor)
            .Where(t => !string.IsNullOrWhiteSpace(t) && !EquipmentService.TypeCovers(current.Type, t))
            .Where(t => Qualified(s, t))
            .Distinct()
            .ToList();
        if (options.Count == 0) return null;

        var pick = options[(int)(Hash($"{s.Driver.Name}|type|{s.Driver.HomeTimesTaken}") % (uint)options.Count)];

        return EquipmentService.IssueTrailerReassignment(s, pick,
            $"Freight mix — operations wants you on {pick.ToLowerInvariant()} for the next tour.");
    }

    private static bool Qualified(AppState s, string trailerType)
    {
        var app = s.Application;
        if (app == null) return true;
        if (trailerType.Equals("Tanker", StringComparison.OrdinalIgnoreCase) && !app.HasTanker) return false;
        if (s.Driver.Restrictions.Any(r => r.Equals(trailerType, StringComparison.OrdinalIgnoreCase))) return false;
        // Never assign freight the driver said they would not haul.
        return !app.WillNotHaul.Any(w => w.Equals(trailerType, StringComparison.OrdinalIgnoreCase));
    }

    private static string TrailerTypeFor(string division) => (division ?? "").Trim() switch
    {
        "Reefer" or "Refrigerated" => "Reefer",
        "Dry Van" or "Van" => "Dry Van",
        "Flatbed" or "Open Deck" => "Flatbed",
        "Step Deck" => "Step Deck",
        "Heavy Haul" or "Oversize" => "Lowboy",
        "Tanker" or "Bulk" => "Tanker",
        "Auto" or "Car Hauling" => "Car Hauler",
        "Livestock" => "Livestock",
        "Log" => "Log",
        _ => ""
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

    /// <summary>
    /// The home-time contribution to a load's score, plus the line that explains it. Returns zero and
    /// no line when there is no arrangement, so nothing changes for a driver who chose to stay out.
    /// </summary>
    public static (double Points, string? Detail, string? Pro, string? Con) ScoreLoad(AppState s, BoardLoad load, HomeStatus st)
    {
        if (!st.Tracked || !st.DueSoon) return (0, null, null, null);

        var home = HomeTerminal(s);
        if (home == null) return (0, null, null, null);

        var destMiles = Geo.MilesBetween(load.DestCity, load.DestState, home.City, home.State);
        if (destMiles == null)
            return (0, $"{DispatchEngine.Place(load.DestCity, load.DestState)} is not in our geography table, so I cannot tell whether it moves you toward home.", null, null);

        var radius = s.Settings.Scoring.HomeRadiusMiles;
        var w = s.Settings.Scoring.HomeTime;
        // Overdue doubles the weight — at that point the company is breaking its own promise.
        var urgency = st.Overdue ? 1.0 : 0.55;

        var nowMiles = st.MilesFromHome ?? destMiles.Value;
        var closes = nowMiles - destMiles.Value;   // positive = ends up nearer home

        if (destMiles.Value <= radius)
        {
            var pts = 1.0 * w * urgency;
            return (pts,
                $"Finishes {destMiles.Value:N0} mi from {st.TerminalLabel}, inside our {radius:N0} mi home radius" +
                $" and home time is {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}: {pts:+0.00;-0.00}",
                $"Gets you home — {destMiles.Value:N0} mi from {st.TerminalLabel}.", null);
        }

        if (closes > 150)
        {
            var pts = 0.5 * w * urgency;
            return (pts,
                $"Closes {closes:N0} mi toward {st.TerminalLabel} ({nowMiles:N0} → {destMiles.Value:N0} mi out): {pts:+0.00;-0.00}",
                $"Works you back toward {st.TerminalLabel}.", null);
        }

        if (closes < -150)
        {
            var pts = -1.0 * w * urgency;
            return (pts,
                $"Runs {Math.Abs(closes):N0} mi further from {st.TerminalLabel} ({nowMiles:N0} → {destMiles.Value:N0} mi out) with home time {(st.Overdue ? "overdue" : "close")}: {pts:+0.00;-0.00}",
                null,
                st.Overdue
                    ? $"Takes you {Math.Abs(closes):N0} mi further out and your home time is already {st.DaysOut - st.IntervalDays:0.#} days late. That is the company breaking its word."
                    : $"Takes you {Math.Abs(closes):N0} mi further from {st.TerminalLabel} with home time due in {st.DaysUntilDue:0.#} days.");
        }

        return (0, $"Roughly neutral on home time ({nowMiles:N0} → {destMiles.Value:N0} mi from {st.TerminalLabel}).", null, null);
    }

    /// <summary>
    /// Whether a load finishing at this destination is being run to get the driver home, and what they
    /// should do once it is delivered.
    ///
    /// Told at authorization so the driver knows why they are taking this load rather than the
    /// better-paying one, and again at close-out so the instruction is in front of them when the
    /// trailer comes off. Maintenance rides along with it: the truck is about to sit at a yard for a
    /// reset, which is the cheapest time to put it in the shop.
    /// </summary>
    public static List<string> HomeRunInstructions(AppState s, string destCity, string destState)
    {
        var lines = new List<string>();
        var st = Status(s);
        if (!st.Tracked || !st.DueSoon) return lines;

        var home = HomeTerminal(s);
        if (home == null) return lines;

        var destMiles = Geo.MilesBetween(destCity, destState, home.City, home.State);
        if (destMiles == null || destMiles.Value > s.Settings.Scoring.HomeRadiusMiles) return lines;

        lines.Add(destMiles.Value <= 1
            ? $"This load is your ride home — it delivers at {st.TerminalLabel}. Once you are empty, park it at the yard and take your home time."
            : $"This load is being run to get you home: it drops {destMiles.Value:N0} mi from {st.TerminalLabel}. " +
              $"Once you are empty, deadhead to the {st.TerminalLabel} yard and report in — then take your home time.");

        lines.Add(st.Overdue
            ? $"You are {st.DaysOut - st.IntervalDays:0.#} days past a {st.IntervalDays}-day arrangement. Getting you back is the priority on this one, not the rate."
            : $"That puts you home with {st.DaysUntilDue:0.#} days to spare on your {st.IntervalDays}-day arrangement.");

        // The truck is about to sit anyway — spend the downtime on the shop rather than a load's worth of clock.
        var shop = MaintenanceWhileHome(s, home);
        if (shop.Count > 0)
        {
            lines.Add("While you are sitting, put the equipment through the shop:");
            lines.AddRange(shop);
        }

        return lines;
    }

    /// <summary>Maintenance worth doing during a home-time reset, phrased as shop instructions.</summary>
    private static List<string> MaintenanceWhileHome(AppState s, Terminal home)
    {
        var jobs = new List<string>();
        var m = s.Settings.Maintenance;
        var truck = DispatchEngine.AssignedTruck(s);
        var trailer = DispatchEngine.AssignedTrailer(s);

        // Only equipment ATS actually knows about has real condition to act on.
        if (truck is { InGameGarage: true })
        {
            if (truck.DamagePct >= m.ReportPct)
                jobs.Add($"Unit {truck.Unit} is at {truck.DamagePct:0.#}% — get it repaired.");
            var sinceService = truck.ServiceMiles - truck.LastServiceMiles;
            if (sinceService >= truck.ServiceIntervalMiles * 0.85)
                jobs.Add($"Unit {truck.Unit} is {sinceService:N0} mi into a {truck.ServiceIntervalMiles:N0}-mile PM cycle — do the service now rather than on the road.");
        }
        if (trailer is { InGameGarage: true } && trailer.DamagePct >= m.ReportPct)
            jobs.Add($"Trailer {trailer.Unit} is at {trailer.DamagePct:0.#}% — get it done at the same time.");

        var openWork = s.WorkOrders.Count(w => w.Status == "Open");
        if (openWork > 0)
            jobs.Add($"{openWork} work order(s) are still open. Close them out while the truck is standing still.");

        if (jobs.Count > 0)
            jobs.Add(home.HasShop
                ? $"The {home.City} yard has its own shop, so the labour is cheaper there than on the road."
                : $"The {home.City} yard has no shop, so book it into a dealer or service centre nearby.");

        return jobs;
    }

    /// <summary>A dispatch-note line for the board decision, when home time is a live consideration.</summary>
    public static string? BoardNote(HomeStatus st)
    {
        if (!st.Tracked || !st.DueSoon) return null;
        if (st.Overdue)
            return $"Home time is overdue — {st.DaysOut:0.#} days out on a {st.IntervalDays}-day arrangement. " +
                   $"I am weighting freight toward {st.TerminalLabel} and will argue against anything running further out. " +
                   "If nothing on the board works, say so and I will run you home empty rather than keep you out.";
        return $"Home time is due in {st.DaysUntilDue:0.#} days. I am favouring loads that finish within " +
               $"{st.TerminalLabel}'s area so you are positioned to get home on time.";
    }
}
