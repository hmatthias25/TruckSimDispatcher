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

        /// <summary>
        /// Inside the planning radius — near enough that freight this way counts as heading home. This
        /// is a routing hint. It does NOT mean the driver got there.
        /// </summary>
        public bool AtHome { get; set; }

        /// <summary>
        /// Standing at the yard itself, which is the only thing that takes home time. Separate from
        /// <see cref="AtHome"/> on purpose: two hundred miles is a hint, one mile is an arrival, and
        /// telling a driver a day out that they are home is how an approved trip went missing.
        /// </summary>
        public bool AtYard { get; set; }
        public string Headline { get; set; } = "";
        public string LastHomeGameTime { get; set; } = "";
        public int HomeTimesTaken { get; set; }
        /// <summary>Operations approved a request, so dispatch is routing home off-schedule.</summary>
        public bool Granted { get; set; }
        /// <summary>
        /// Advice rather than an instruction — surfaced when a driver on no arrangement has been out a
        /// very long time. It changes nothing on its own.
        /// </summary>
        public string Suggestion { get; set; } = "";
        /// <summary>
        /// Notice of a trailer change due at the next home time. Given in advance so the wait for the
        /// trailer overlaps with the home time rather than extending it.
        /// </summary>
        public string ReassignmentNotice { get; set; } = "";

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
            // A probationary driver comes in every fortnight whatever they signed up for — including
            // "no arrangement", which is not on offer to somebody still being assessed.
            IntervalDays = Probation.EffectiveIntervalDays(s),
            Arrangement = Probation.IsOn(s)
                ? $"Probation — in every {Probation.ReviewIntervalDays} days for review"
                : LabelFor(s.Application?.HomeTimePreference),
            HomeTimesTaken = s.Driver.HomeTimesTaken,
            LastHomeGameTime = s.Driver.LastHomeGameTime
        };

        var home = HomeTerminal(s);
        if (home == null)
        {
            st.Headline = "No home terminal set, so there is nowhere to route you.";
            return st;
        }

        // No arrangement and nothing approved: they elected to stay out, and that is the whole answer.
        // A granted request falls through below and is tracked like any other trip home.
        if (st.IntervalDays <= 0 && !s.Driver.HomeTimeGranted)
        {
            st.TerminalId = home.Id;
            st.TerminalLabel = DispatchEngine.Place(home.City, home.State);

            var lastHome = GameClock.TryParse(s.Driver.LastHomeGameTime)
                           ?? GameClock.TryParse(s.Driver.HiredGameDate);
            var at = GameClock.TryParse(s.Status.GameTime);
            if (lastHome != null && at != null) st.DaysOut = Math.Max(0, (at.Value - lastHome.Value).TotalDays);

            st.Headline = "No home-time arrangement on file — dispatch will not route you home. " +
                          "Ask for home time on the Career tab when you want it.";

            // Nobody actually stays out forever. Past a long stretch the app says something — and it
            // is a suggestion, not a directive. They chose this arrangement and it is still their call;
            // operations is just the colleague pointing out you have been gone two months.
            if (st.DaysOut >= SuggestHomeAfterDays)
            {
                st.Suggestion =
                    $"You have been out {st.DaysOut:0} days. There is no arrangement on your file so I am not going to " +
                    $"route you anywhere — but that is a long stretch, and {st.TerminalLabel} is still your yard. " +
                    "Put in for home time whenever you want it and I will work you back.";
            }
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

        // Operations approved a request, so they are going home whether the clock says due or not.
        // For a driver on no arrangement this is the only thing that ever puts them on the road home.
        if (s.Driver.HomeTimeGranted)
        {
            st.Granted = true;
            st.DueSoon = true;
            st.Overdue = true;
        }

        st.MilesFromHome = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        st.AtHome = st.MilesFromHome is { } m && m <= s.Settings.Scoring.HomeRadiusMiles;
        st.AtYard = st.MilesFromHome is { } y && y <= AtYardMiles;

        // Re-rigged and waiting on the trailer to come back in — that wait is spent at home.
        if (EquipmentService.PendingTrailerWait(s) is { } wait)
        {
            st.WaitingOn = string.IsNullOrWhiteSpace(wait.HeldByDriverName)
                ? $"trailer {wait.ToTrailerUnit}"
                : $"{wait.HeldByDriverName} to bring trailer {wait.ToTrailerUnit} in";
            st.WaitingUntil = wait.AvailableFromGameTime;
            st.Headline = string.IsNullOrWhiteSpace(wait.AvailableFromGameTime)
                ? $"Home, and held here until {st.WaitingOn}. I have no way of seeing where they are — report in " +
                  "when the trailer is on the property. The wait is home time, not hours."
                : $"Home, and held here until {st.WaitingOn} — you have them down as around " +
                  $"{GameClock.Pretty(wait.AvailableFromGameTime)}. The wait is home time, not hours.";
            return st;
        }

        if (st.Granted)
        {
            st.Headline = st.AtYard
                ? "Home time approved and you are here. Take it."
                : st.AtHome
                    ? $"Home time approved — you are close. Bring it in to {st.TerminalLabel} and report " +
                      "in at the yard to take it."
                    : $"Home time approved — dispatch is working freight back toward {st.TerminalLabel}.";
            return st;
        }

        // Coming trailer change, from as soon as it is known. NOT gated on home time being due: the
        // reassignment fires whenever the driver next reports in at the yard, so gating the warning on
        // the schedule would leave anyone who came home early with no warning at all — which is the
        // whole complaint. Better a fortnight's notice than none.
        st.ReassignmentNotice = ReassignmentNotice(s) ?? "";

        st.Headline = st.Overdue
            ? $"Home time is OVERDUE — {st.DaysOut:0.#} days out against a {st.IntervalDays}-day arrangement. " +
              (st.AtYard ? "You are at the yard — take it now."
                  : st.AtHome ? "You are close; bring it in to {0} and report in at the yard.".Replace("{0}", st.TerminalLabel)
                  : "Dispatch is routing you toward {0}.".Replace("{0}", st.TerminalLabel))
            : st.DueSoon
                ? $"Home time due in {st.DaysUntilDue:0.#} days. Operations is working freight back toward {st.TerminalLabel}."
                : $"{st.DaysOut:0.#} days out, home time in {st.DaysUntilDue:0.#} days.";

        return st;
    }

    /// <summary>
    /// How long a driver on no arrangement can be out before the app mentions it. Roughly two months —
    /// long enough that it is genuinely unusual, short enough that somebody has not simply forgotten
    /// they have a house.
    /// </summary>
    public const double SuggestHomeAfterDays = 60;

    /// <summary>
    /// How close counts as standing at the yard. Home time is taken here and nowhere else — the
    /// planning radius is a different number doing a different job, and conflating the two is what let
    /// an approved home time be spent two hundred miles from the house.
    /// </summary>
    public const double AtYardMiles = 1;

    /// <summary>
    /// Records a visit home when the driver reports being at (or near) their home terminal. Called on
    /// every status report — being home is something we observe, not something we schedule.
    /// </summary>
    public static bool Touch(AppState s)
    {
        // No early-out on the arrangement. Being home is something we OBSERVE, and it happens whether
        // or not a clock scheduled it — a driver who elected to stay out and then drove home anyway has
        // still been home. Skipping it left their days-out climbing forever and the long-stretch
        // suggestion nagging about a trip they had already taken. The arrangement decides ROUTING, not
        // whether we notice where the truck is.
        var home = HomeTerminal(s);
        if (home == null) return false;

        var miles = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        // Only the yard itself counts as actually taking home time. The radius is for planning loads,
        // not for claiming the driver got home when they are still two hours away.
        var atYard = miles is { } m && m <= AtYardMiles;

        if (!atYard)
        {
            s.Driver.AtHomeYard = false;
            return false;
        }

        // An approved request is satisfied by actually getting to the yard — the same mile that counts
        // as taking home time. Clearing it on the planning radius spent the trip while the driver was
        // still a day out: the approval vanished, no home time was recorded, and nothing said so.
        //
        // Cleared here rather than in the arriving branch below, so a grant that lands while the driver
        // is already parked at the yard is satisfied too, instead of staying approved forever.
        if (s.Driver.HomeTimeGranted)
        {
            s.Driver.HomeTimeGranted = false;
            s.Driver.HomeTimeGrantedGameTime = "";
        }

        // Days out is measured from the last day they were home, so it keeps ticking over to today for
        // as long as they are standing at the yard. That is what makes it zero while they are here.
        var arriving = !s.Driver.AtHomeYard;
        s.Driver.LastHomeGameTime = s.Status.GameTime;
        s.Driver.AtHomeYard = true;

        // Only ARRIVING is taking home time. Sitting out a 34 at the house and reporting clocks each
        // morning is one home time, not four — counting each report was the bug this replaces.
        if (!arriving) return false;

        s.Driver.HomeTimesTaken++;

        // Reporting in is the whole point of probation. Somebody goes through the period with them and
        // writes a verdict; three good ones in a row is what ends it.
        var review = Probation.ReviewOnArrival(s);
        if (review is { ClearedProbation: true })
            CareerService.ClearProbation(s, force: true, note: $"Cleared on {review.Number} — {Probation.PassesToClear} good reviews in a row.");

        // Off probation the reviewing carries on, just less often. Filed here for the same reason: the
        // driver is standing at the yard, which is the only place this conversation happens.
        if (PeriodicReview.ReviewOnArrival(s) is { EndsEmployment: true } fired)
        {
            // The verdict said the job is over, so make it so. Without this the review announced a
            // termination and nothing happened, which is worse than not having the rule.
            s.Driver.TerminatedForCause = true;
            s.Driver.TerminationReason = $"{fired.Number}: {fired.Summary}";
            s.Driver.TerminatedGameTime = s.Status.GameTime;
            s.Driver.Rank = "terminated";
            s.Driver.Status = "Terminated";
        }

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
        // A dedicated driver is not re-rigged: the account decides the trailer, not the freight mix.
        if (Dedicated.Active(s)) return null;

        var divisions = s.Company.Divisions?.Where(d => !string.IsNullOrWhiteSpace(d)).ToList() ?? new List<string>();
        if (divisions.Count < 2) return null;    // a one-division carrier has nothing to move you to

        var current = DispatchEngine.AssignedTrailer(s);
        if (current == null) return null;

        // Never on the first trip home. A carrier settles a new driver on one kind of freight before
        // it starts moving them around, and being re-rigged on your first weekend reads as chaos
        // rather than as a company with a plan.
        if (s.Driver.HomeTimesTaken < 2) return null;

        var pick = ReassignmentTypeFor(s, s.Driver.HomeTimesTaken);
        if (pick == null) return null;

        return EquipmentService.IssueTrailerReassignment(s, pick,
            $"Freight mix — operations wants you on {pick.ToLowerInvariant()} for the next tour.");
    }

    /// <summary>
    /// What the driver would be re-rigged onto at a given home time, or null for no change.
    ///
    /// Pulled out of the issuing so the same answer can be given <b>before</b> the driver gets to the
    /// yard. It used to be decided only at the moment they reported in, which meant the first they heard
    /// of a trailer change was after they had already arrived — and if the trailer was out under a hired
    /// driver, the wait for it was tacked onto the end of their home time instead of overlapping with it.
    ///
    /// Seeded on the visit number, so the warning given on the way in is necessarily the same answer
    /// issued on arrival. Two different answers would be worse than no warning at all.
    /// </summary>
    public static string? ReassignmentTypeFor(AppState s, int homeTimeNumber)
    {
        if (homeTimeNumber < 2) return null;
        if (Dedicated.Active(s)) return null;

        var divisions = s.Company.Divisions?.Where(d => !string.IsNullOrWhiteSpace(d)).ToList() ?? new List<string>();
        if (divisions.Count < 2) return null;

        var current = DispatchEngine.AssignedTrailer(s);
        if (current == null) return null;

        // Roughly one home time in three. Seeded, so refreshing does not re-roll it.
        if (Hash($"{s.Driver.Name}|reassign|{homeTimeNumber}") % 100 >= 34) return null;

        // A division the carrier runs that is not what they are pulling now, and that they are actually
        // qualified for — no tanker without the endorsement.
        var options = divisions
            .Select(TrailerTypeFor)
            .Where(t => !string.IsNullOrWhiteSpace(t) && !EquipmentService.TypeCovers(current.Type, t))
            .Where(t => Qualified(s, t))
            .Distinct()
            .ToList();
        if (options.Count == 0) return null;

        return options[(int)(Hash($"{s.Driver.Name}|type|{homeTimeNumber}") % (uint)options.Count)];
    }

    /// <summary>
    /// Notice of a trailer change coming at the next home time, for saying on the way in rather than on
    /// arrival. Null when nothing is changing.
    /// </summary>
    public static string? ReassignmentNotice(AppState s)
    {
        var next = ReassignmentTypeFor(s, s.Driver.HomeTimesTaken + 1);
        if (next == null) return null;

        var current = DispatchEngine.AssignedTrailer(s);
        var msg = $"Heads up: operations wants you on {next.ToLowerInvariant()} for the next tour, so you are " +
                  $"changing trailers when you get in" +
                  (current != null ? $" — off {current.Ref} ({current.Type})." : ".");

        // Where the one they want is out under one of ours, say so now. That wait is what turned a home
        // time into a home time plus a day, and knowing about it in advance is the whole point.
        var holder = s.HiredDrivers.FirstOrDefault(d => d.Status == "Active"
            && !string.IsNullOrWhiteSpace(d.AssignedTrailerUnit)
            && s.Trailers.Any(t => t.Unit == d.AssignedTrailerUnit
                                   && EquipmentService.TypeCovers(t.Type, next)));
        if (holder != null)
        {
            msg += $" The {next.ToLowerInvariant()} we have is out under {holder.Name}, so there may be a wait at the " +
                   "yard — plan your home time around it rather than sitting on top of it.";
            // What the player last told us about where that driver is heading. Rough by nature, and
            // enough to say whether the trailer is worth waiting for.
            msg += " " + Whereabouts.Describe(s, holder);
        }
        else
            msg += " Should be one on the property, so it ought to be a straight swap.";

        return msg;
    }

    private static bool Qualified(AppState s, string trailerType)
    {
        var app = s.Application;
        if (app == null) return true;
        if (s.Driver.Restrictions.Any(r => r.Equals(trailerType, StringComparison.OrdinalIgnoreCase))) return false;
        // Never assign freight the driver said they would not haul.
        return !app.WillNotHaul.Any(w => w.Equals(trailerType, StringComparison.OrdinalIgnoreCase));
    }

    public static string TrailerTypeFor(string division) => (division ?? "").Trim() switch
    {
        // Dedicated is not a trailer type — the customer's freight decides what you pull.
        "Dedicated" => "",
        "Intermodal" => "Dry Van",
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
    /// How much harder a thin destination market should count while home time is closing in.
    ///
    /// The tier penalty used to be flat: the same whether home was a fortnight away or two hours. But a
    /// thin market is exactly where a home-time promise dies. There is nothing coming out of it, so the
    /// load after this one is an empty run home on the company's money — or a late one, which costs the
    /// driver instead. That is a real cost and it belongs on the load that causes it.
    ///
    /// Returns a multiplier: 1.0 normally, rising as the arrangement runs out, and heaviest once it has
    /// already been broken. A load that finishes inside the home radius is exempt however thin the town —
    /// arriving home is the point, and the yard is not somewhere you need a reload out of.
    /// </summary>
    public static double ThinMarketBite(AppState s, BoardLoad load)
    {
        var st = Status(s);
        if (!st.Tracked || !st.DueSoon) return 1.0;

        var home = HomeTerminal(s);
        if (home == null) return 1.0;

        var destMiles = Geo.MilesBetween(load.DestCity, load.DestState, home.City, home.State);
        if (destMiles != null && destMiles.Value <= s.Settings.Scoring.HomeRadiusMiles) return 1.0;

        return st.Overdue ? 2.0 : 1.6;
    }

    /// <summary>
    /// Whether dispatch should see the whole city before committing to a board pulled at one dock.
    ///
    /// The board screen has always promised this — "show me these first; if none of them work I will ask
    /// for the whole city" — but the asking only ever happened when the board was rejected outright. A
    /// load that was merely acceptable got committed to and the city was never looked at.
    ///
    /// Near home time that is the expensive case. A receiver with three loads on it is not the town: the
    /// shipper down the road may have something going the right way, and nobody will ever know because
    /// the truck is already hooked. Acceptable is not the same as gets you home.
    ///
    /// Three things have to be true, and the third is what keeps this quiet: if anything on the dock
    /// board actually goes home, there is nothing to ask about.
    ///
    /// Returns what to say, or null when there is no question to raise.
    /// </summary>
    public static string? WantCityBoardFirst(AppState s, List<LoadEvaluation> clear)
    {
        var st = Status(s);
        if (!st.Tracked || !st.DueSoon) return null;
        if (clear.Count == 0) return null;

        // Everything the driver showed us came off the dock they are standing on. Read off the board
        // rather than off the runnable subset: a city board with only its local rows feasible has still
        // been looked at, and asking for it again would be asking for something already in hand.
        if (s.Board.Count == 0 || !s.Board.All(b => b.AtLocation)) return null;

        var home = HomeTerminal(s);
        if (home == null) return null;

        // If any of them gets the driver home, take it and say nothing.
        foreach (var e in clear)
        {
            var miles = Geo.MilesBetween(e.Load.DestCity, e.Load.DestState, home.City, home.State);
            if (miles != null && miles.Value <= s.Settings.Scoring.HomeRadiusMiles) return null;
        }

        var where = DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState);
        var pick = clear[0].Load;

        return
            $"That is {s.Board.Count} load(s) off one dock and not one of them finishes near {st.TerminalLabel}. " +
            (st.Overdue
                ? $"Your home time is already {st.DaysOut - st.IntervalDays:0.#} days late"
                : $"Home time is due in {st.DaysUntilDue:0.#} days") +
            $", so before I tie the truck up on {DispatchEngine.Place(pick.DestCity, pick.DestState)} I want to " +
            $"see the whole board for {where}. There are usually more shippers in a town than the one you are " +
            "standing on, and ten minutes looking beats another day and a half in the wrong direction.\n\n" +
            $"Switch to the full city board and show me that. If a dock really is all {where} has, say so and " +
            "I will send you on the one I have picked.";
    }

    /// <summary>
    /// Whether this load actually gets the driver home — finishes inside the home radius of their own
    /// yard — with home time already <b>overdue</b>.
    ///
    /// Deliberately stricter than the scoring test above on both counts. Overdue rather than merely due
    /// soon, because "due in three days" is not a promise broken yet and there is still time to find
    /// freight that pays; and finishing at home rather than merely closing distance, because paying to
    /// lose money to get two hundred miles nearer is not the same purchase.
    ///
    /// Used by load scoring to let below-break-even freight through the floor. See the break-even hard
    /// fail in <see cref="DispatchEngine"/>.
    /// </summary>
    public static bool IsOverdueRideHome(AppState s, BoardLoad load)
    {
        var st = Status(s);
        if (!st.Tracked || !st.Overdue) return false;

        var home = HomeTerminal(s);
        if (home == null) return false;

        var miles = Geo.MilesBetween(load.DestCity, load.DestState, home.City, home.State);
        return miles != null && miles.Value <= s.Settings.Scoring.HomeRadiusMiles;
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
                jobs.Add($"Unit {truck.Ref} is at {truck.DamagePct:0.#}% — get it repaired.");
            var sinceService = truck.ServiceMiles - truck.LastServiceMiles;
            if (sinceService >= truck.ServiceIntervalMiles * 0.85)
                jobs.Add($"Unit {truck.Ref} is {sinceService:N0} mi into a {truck.ServiceIntervalMiles:N0}-mile PM cycle — do the service now rather than on the road.");
        }
        if (trailer is { InGameGarage: true } && trailer.DamagePct >= m.ReportPct)
            jobs.Add($"Trailer {trailer.Ref} is at {trailer.DamagePct:0.#}% — get it done at the same time.");

        var openWork = s.WorkOrders.Count(w => w.Status == "Open");
        if (openWork > 0)
            jobs.Add($"{openWork} work order(s) are still open. Close them out while the truck is standing still.");

        if (jobs.Count > 0)
            jobs.Add(home.HasShop
                ? $"The {home.City} yard has its own shop, so the labour is cheaper there than on the road."
                : $"The {home.City} yard has no shop, so book it into a dealer or service centre nearby.");

        return jobs;
    }

    /// <summary>What the driver should actually do now that they are home.</summary>
    public class ArrivalBriefing
    {
        public string Headline { get; set; } = "";
        public string Terminal { get; set; } = "";
        public double DaysOut { get; set; }
        public int IntervalDays { get; set; }
        public List<string> Parking { get; set; } = new();
        public List<string> Shop { get; set; } = new();
        public List<string> Equipment { get; set; } = new();
        public List<string> Paperwork { get; set; } = new();
        public bool NothingToDo { get; set; }

        /// <summary>
        /// A better tractor is sitting here and can be asked for. The brief used to say "ask operations"
        /// with nothing behind it; these let the UI put the ask in front of the driver.
        /// </summary>
        public bool BetterUnitAvailable { get; set; }
        public string BetterUnit { get; set; } = "";

        /// <summary>
        /// A review filed on this arrival, probationary or periodic, with the verdict and what follows.
        ///
        /// It used to be written to the file and nowhere else, so a driver could come in, have a review
        /// filed on them, and drive away without knowing. A review nobody is told about is not a review.
        /// </summary>
        public object? Review { get; set; }

        /// <summary>Set when the review just filed ended the job.</summary>
        public bool Terminated { get; set; }

        /// <summary>Advance notice of a periodic review, so it is never a surprise.</summary>
        public string ReviewNotice { get; set; } = "";

        /// <summary>
        /// Hired drivers holding a company trailer whose whereabouts are worth asking about.
        ///
        /// Asked here because this is the one moment the player is at the yard with the company screen in
        /// front of them, and because the answer only ever decides one thing: whether a trailer they might
        /// be re-rigged onto is worth waiting for.
        /// </summary>
        public List<object> AskWhereabouts { get; set; } = new();
    }

    /// <summary>
    /// The brief handed over when the driver reports in at their home yard.
    ///
    /// Arriving home is the one point in the loop where the truck is standing still at a company yard
    /// with nothing hooked to it, which makes it the moment for everything that cannot be done on the
    /// road. This pulls what is scattered across Maintenance, Fleet and Equipment into one place, at
    /// the one time it all applies — and says so plainly when the answer is "nothing, take your days".
    /// </summary>
    public static ArrivalBriefing ArrivalBrief(AppState s)
    {
        var home = HomeTerminal(s);
        var b = new ArrivalBriefing
        {
            Terminal = home == null ? "the yard" : DispatchEngine.Place(home.City, home.State),
            IntervalDays = s.Driver.HomeTimeIntervalDays
        };

        var last = GameClock.TryParse(s.Driver.LastHomeGameTime);
        var hired = GameClock.TryParse(s.Driver.HiredGameDate);
        var previous = s.Driver.HomeTimesTaken > 1 ? last : hired;
        b.DaysOut = previous != null && last != null ? Math.Max(0, (last.Value - previous.Value).TotalDays) : 0;

        b.Headline = $"Home at {b.Terminal}. That is home time number {s.Driver.HomeTimesTaken} — " +
                     $"you have been out {(b.DaysOut > 0 ? $"{b.DaysOut:0.#} days" : "since your last reset")}.";

        // ---- parking and how long they have
        b.Parking.Add($"Park it at the {b.Terminal} yard. Nothing is dispatched against you while you are home.");
        if (s.Driver.HomeTimeIntervalDays > 0)
            b.Parking.Add($"Your arrangement is home every {s.Driver.HomeTimeIntervalDays} days. Take the time — " +
                          "the clock on the next one starts when you report in here again.");
        var restart = s.Settings.Hos.CycleRestartHours;
        if (s.Hos.CycleRemaining < s.Settings.Hos.CycleLimit * 0.5)
            b.Parking.Add($"Cycle is down to {Hhmm.Of(s.Hos.CycleRemaining)}. Sit a {restart:0.#}-hour restart while you " +
                          "are stopped and you go back out with a full 70.");

        // ---- the shop, unit by unit. Only equipment ATS actually knows about.
        var m = s.Settings.Maintenance;
        var truck = DispatchEngine.AssignedTruck(s);
        var trailer = DispatchEngine.AssignedTrailer(s);
        var hasShop = home?.HasShop ?? false;

        if (truck is { InGameGarage: true })
        {
            if (truck.DamagePct >= m.MandatoryReviewPct)
                b.Shop.Add($"Unit {truck.Ref} is at {truck.DamagePct:0.#}% — over our {m.MandatoryReviewPct:0}% review line. Repair it before you go back out.");
            else if (truck.DamagePct >= m.ReportPct)
                b.Shop.Add($"Unit {truck.Ref} is at {truck.DamagePct:0.#}%. Worth putting through the shop while it is standing.");
            else
                b.Shop.Add($"Unit {truck.Ref} is fine at {truck.DamagePct:0.#}% — nothing needed.");

            var since = truck.ServiceMiles - truck.LastServiceMiles;
            if (since >= truck.ServiceIntervalMiles)
                b.Shop.Add($"Unit {truck.Ref} is {since - truck.ServiceIntervalMiles:N0} mi PAST its {truck.ServiceIntervalMiles:N0}-mile PM. Do it now.");
            else if (since >= truck.ServiceIntervalMiles * 0.85)
                b.Shop.Add($"PM due on unit {truck.Ref} in {truck.ServiceIntervalMiles - since:N0} mi. Cheaper to do it here than on the road.");
        }

        if (trailer is { InGameGarage: true })
        {
            if (trailer.DamagePct >= m.ReportPct)
                b.Shop.Add($"Trailer {trailer.Ref} is at {trailer.DamagePct:0.#}% — get it done at the same time.");
            else
                b.Shop.Add($"Trailer {trailer.Ref} is fine at {trailer.DamagePct:0.#}%.");
        }

        if (b.Shop.Any(x => x.Contains("Repair") || x.Contains("PM") || x.Contains("shop") || x.Contains("done")))
            b.Shop.Add(hasShop
                ? $"The {home!.City} yard has its own shop, so labour is cheaper here than anywhere on the road."
                : $"The {home?.City ?? "home"} yard has no shop — book it into a dealer or service centre nearby.");

        // If the damage is what brought them here, say how long it takes and be explicit that this is
        // home time, not a detour off it. Otherwise the driver reads "run it home" as losing their days.
        var stopPct = s.Settings.Maintenance.StopDispatchPct;
        var worst = Math.Max(truck is { InGameGarage: true } ? truck.DamagePct : 0,
                             trailer is { InGameGarage: true } ? trailer.DamagePct : 0);
        if (worst >= stopPct)
        {
            var quote = Shop.Quote(s, truck is { InGameGarage: true } ? truck.DamagePct : 0,
                                      trailer is { InGameGarage: true } ? trailer.DamagePct : 0, hasShop, truck);
            b.Shop.Add($"This is the repair that stopped your dispatch — reckon on about {Hhmm.Of(quote.WaitHours)} in the shop.");
            b.Shop.Add("Fixing it here counts as your home time. You are at the yard with the truck in pieces; " +
                       "that is home time, and the clock on the next one has already started over from today.");
            b.Shop.Add($"Same expectation as any home time: sit the {restart:0.#}-hour restart while you are here. " +
                       "You are not going anywhere until the shop is finished, so take the reset and go back out on a full 70.");
        }

        // ---- equipment waiting on them
        if (EquipmentService.OpenOrder(s) is { } order)
            b.Equipment.Add($"{order.Number}: {order.Instruction}");

        var spare = s.Trucks.FirstOrDefault(t => !t.Retired && t.InGameGarage
                                                 && t.Unit != s.Driver.AssignedTruckUnit
                                                 && t.HomeTerminalId == home?.Id
                                                 && string.IsNullOrWhiteSpace(t.AssignedDriver)
                                                 && truck != null && t.Year > truck.Year);
        if (spare != null)
        {
            b.BetterUnitAvailable = true;
            b.BetterUnit = spare.Ref;
            b.Equipment.Add($"There is a better unit sitting here: {spare.Ref} ({spare.Year} {spare.Make} {spare.Model}, " +
                            $"{spare.ServiceMiles:N0} mi) against your {truck!.Year} {truck.Make}. " +
                            "Put in for it below and operations will answer while you are standing here.");
        }

        // ---- paperwork that can be closed while standing still
        var open = s.WorkOrders.Count(w => w.Status == "Open");
        if (open > 0)
            b.Paperwork.Add($"{open} work order(s) still open. Close them out on the Maintenance tab while the truck is here.");

        var unack = SafetyService.Unacknowledged(s).Count;
        if (unack > 0)
            b.Paperwork.Add($"{unack} disciplinary action(s) waiting on your signature — Safety tab.");

        if (FleetOpsService.DueCheck(s) is { IsDue: true })
            b.Paperwork.Add("The fleet report is due. Good time to pull the hired drivers' numbers off the game.");

        // ---- whatever review was filed on the way in
        //
        // Touch() files it just before this runs, so a review stamped with the current game time is one
        // that happened on THIS arrival. Written to the file and nowhere else is how a driver ends up
        // finding out weeks later that they had been reviewed.
        var now = s.Status.GameTime;
        if (s.PeriodicReviews.FirstOrDefault() is { } per && per.GameTime == now)
        {
            b.Review = per;
            b.Terminated = per.EndsEmployment;
        }
        else if (s.ProbationReviews.FirstOrDefault() is { } prob && prob.GameTime == now)
        {
            b.Review = prob;
        }

        // And notice of the next one, so it is never a surprise — particularly once a bad one can end it.
        b.ReviewNotice = PeriodicReview.Notice(s) ?? "";

        // Anybody out with a company trailer whose position we have nothing recent on.
        foreach (var d in Whereabouts.WorthAsking(s))
        {
            var box = s.Trailers.FirstOrDefault(x => x.Unit == d.AssignedTrailerUnit);
            b.AskWhereabouts.Add(new
            {
                driverId = d.Id,
                driver = d.Name,
                trailer = box?.Ref ?? d.AssignedTrailerUnit,
                trailerType = box?.Type ?? "",
                known = Whereabouts.Assess(s, d).Text,
            });
        }

        b.NothingToDo = b.Shop.All(x => x.Contains("fine at") || x.Contains("nothing needed"))
                        && b.Equipment.Count == 0 && b.Paperwork.Count == 0
                        && b.Review == null && b.ReviewNotice.Length == 0
                        && b.AskWhereabouts.Count == 0;
        return b;
    }

    /// <summary>A dispatch-note line for the board decision, when home time is a live consideration.</summary>
    /// <summary>A reposition dispatch would raise for the driver, ready to authorise.</summary>
    public class RepositionOffer
    {
        public string City { get; set; } = "";
        public string State { get; set; } = "";
        public double Miles { get; set; }
        public string Reason { get; set; } = "";
        /// <summary>True when this is the last empty leg to the yard rather than a move to chase freight.</summary>
        public bool IsHomeRun { get; set; }
    }

    /// <summary>
    /// Empty moves worth offering when the board is rejected and home time is close.
    ///
    /// Two cases, and both are miles the driver actually runs with nothing on the trailer:
    /// <list type="bullet">
    ///   <item>Chasing a board — sitting in Austin, the load worth having is out of San Antonio.</item>
    ///   <item>The last leg home — delivered in Kansas City, the yard is Springfield.</item>
    /// </list>
    ///
    /// Either way the driver should not have to raise it by hand and type a mileage the app already
    /// knows, because that mileage is what their empty pay is worked out from.
    /// </summary>
    public static List<RepositionOffer> RepositionOffers(AppState s)
    {
        var offers = new List<RepositionOffer>();
        var st = Status(s);
        if (!st.Tracked || !st.DueSoon) return offers;

        var home = HomeTerminal(s);
        if (home == null) return offers;

        var here = (s.Status.LocationCity, s.Status.LocationState);
        var mph = HosEngine.EffectiveMph(s.Settings, DispatchEngine.AssignedTruck(s));
        if (mph <= 0) return offers;
        var drivable = Math.Max(0, Math.Min(Math.Min(s.Hos.DriveRemaining, s.Hos.ShiftRemaining),
                                            s.Hos.CycleRemaining));
        var reach = drivable * mph;

        var alreadyHome = here.LocationCity.Equals(home.City, StringComparison.OrdinalIgnoreCase)
                          && here.LocationState.Equals(home.State, StringComparison.OrdinalIgnoreCase);
        var toHome = Geo.MilesBetween(here.LocationCity, here.LocationState, home.City, home.State);

        // The run home, when the yard is reachable and we are not standing in it.
        if (!alreadyHome && toHome is { } hm && hm <= reach)
            offers.Add(new RepositionOffer
            {
                City = home.City, State = home.State, Miles = Math.Round(hm, 0), IsHomeRun = true,
                Reason = $"Empty to the yard for home time — {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}, " +
                         "and nothing on the board is worth staying out for."
            });

        // Markets on the way, for pulling a fresh board from somewhere better placed.
        foreach (var c in Markets.Effective(s)
                     .Where(c => !(c.City.Equals(here.LocationCity, StringComparison.OrdinalIgnoreCase)
                                   && c.State.Equals(here.LocationState, StringComparison.OrdinalIgnoreCase)))
                     .Where(c => !(c.City.Equals(home.City, StringComparison.OrdinalIgnoreCase)
                                   && c.State.Equals(home.State, StringComparison.OrdinalIgnoreCase)))
                     .Select(c => new
                     {
                         c,
                         out_ = Geo.MilesBetween(here.LocationCity, here.LocationState, c.City, c.State) ?? double.MaxValue,
                         home_ = Geo.MilesBetween(c.City, c.State, home.City, home.State) ?? double.MaxValue
                     })
                     .Where(x => x.out_ <= reach && x.home_ < double.MaxValue)
                     .Where(x => toHome == null || x.home_ < toHome.Value - 25)
                     .OrderBy(x => x.c.Tier)
                     .ThenBy(x => x.home_)
                     .Take(3))
            offers.Add(new RepositionOffer
            {
                City = c.c.City, State = c.c.State, Miles = Math.Round(c.out_, 0),
                Reason = $"Empty to {DispatchEngine.Place(c.c.City, c.c.State)} to pull a board closer to " +
                         $"{st.TerminalLabel} — tier-{c.c.Tier} market, {c.home_:N0} mi from the yard."
            });

        return offers;
    }

    /// <summary>
    /// Where to go looking for freight when the board on offer has nothing and home time is close.
    ///
    /// The app only ever sees what the driver types in, and what they can type in is whatever ATS is
    /// showing where they are standing. So "nothing here works" is not the same as "there is nothing" —
    /// it means the search has to move. Dispatch knows which direction home is and roughly how far the
    /// driver can legally get; naming two or three markets on the way is the difference between useful
    /// advice and telling somebody to go and have a look round.
    ///
    /// Only called once a board has actually been rejected. If something on offer is worth running,
    /// there is nothing to suggest and this never fires.
    /// </summary>
    public static string? WhereToLookForHome(AppState s)
    {
        var st = Status(s);
        if (!st.Tracked || !st.DueSoon) return null;

        var home = HomeTerminal(s);
        if (home == null) return null;

        var here = (s.Status.LocationCity, s.Status.LocationState);
        var toHome = Geo.MilesBetween(here.LocationCity, here.LocationState, home.City, home.State);
        var mph = HosEngine.EffectiveMph(s.Settings, DispatchEngine.AssignedTruck(s));
        if (mph <= 0) return null;

        // The binding clock, same as anywhere else the app talks about what is reachable.
        var drivable = Math.Max(0, Math.Min(Math.Min(s.Hos.DriveRemaining, s.Hos.ShiftRemaining),
                                            s.Hos.CycleRemaining));
        var reach = drivable * mph;

        // Home itself, if a load could plausibly finish there. Worth saying first — the driver can look
        // at the board in their own yard's city and stop hunting.
        if (toHome is { } miles && miles <= reach)
            return $"Nothing here works and home time is {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}. " +
                   $"{DispatchEngine.Place(home.City, home.State)} is only {miles:N0} mi out, inside what you can drive " +
                   $"on {Hhmm.Of(drivable)}. Look at the board in {home.City} itself, or anything running that way, and " +
                   "show me what is there.";

        // Otherwise, markets that are both reachable and genuinely closer to home than we are.
        var options = Markets.Effective(s)
            .Where(c => !(c.City.Equals(here.LocationCity, StringComparison.OrdinalIgnoreCase)
                          && c.State.Equals(here.LocationState, StringComparison.OrdinalIgnoreCase)))
            .Select(c => new
            {
                c,
                out_ = Geo.MilesBetween(here.LocationCity, here.LocationState, c.City, c.State) ?? double.MaxValue,
                home_ = Geo.MilesBetween(c.City, c.State, home.City, home.State) ?? double.MaxValue
            })
            .Where(x => x.out_ <= reach && x.out_ < double.MaxValue && x.home_ < double.MaxValue)
            .Where(x => toHome == null || x.home_ < toHome.Value - 25)      // real progress, not a shuffle
            .OrderBy(x => x.c.Tier)
            .ThenBy(x => x.home_)
            .Take(3)
            .ToList();

        if (options.Count == 0)
            return $"Nothing here works and home time is {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}. " +
                   $"On {Hhmm.Of(drivable)} of driving I cannot reach anywhere closer to {st.TerminalLabel} that is worth " +
                   "pulling a board in. Take your rest, and show me the board again when the clocks are back.";

        var named = string.Join(", ", options.Select(x =>
            $"{DispatchEngine.Place(x.c.City, x.c.State)} ({x.out_:N0} mi out, {x.home_:N0} from the yard)"));

        return $"Nothing here works and home time is {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}. " +
               $"Rather than sit on this board, check what is loading out of {named}. All of those are inside the " +
               $"{Hhmm.Of(drivable)} you have left and every one puts you closer to {st.TerminalLabel} than you are now. " +
               "Show me whichever board looks best and I will work from that.";
    }

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
