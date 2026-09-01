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

    /// <summary>Ceiling on the home area's growth, as a multiple of the configured radius.</summary>
    public const double MaxRadiusMultiple = 2.0;

    /// <summary>
    /// How many shifts of empty running the app will offer to get a driver home, when nothing on the
    /// board will do it for them.
    ///
    /// Going to a market to pull a fresh board is a today problem: if it cannot be reached on the clock
    /// in hand there is no point offering it. Going HOME is not — a driver heading for the house takes
    /// their ten hours on the way and carries on, and nobody refuses to drive home because it is a day
    /// and a bit.
    ///
    /// Judged on one shift for both, the app would not offer a 615-mile run home from Houston — ten miles
    /// past a single shift — but happily offered a 497-mile empty leg to a market instead. The driver ran
    /// 713 empty miles and lost two days avoiding one 615-mile run.
    /// </summary>
    public const double HomeRunShifts = 2;

    /// <summary>
    /// How far a driver can drive in a day, for turning days into miles and back.
    ///
    /// A shift's driving at the app's own default speed. Deliberately coarse — it is used to ask "could
    /// they get there and back before the date", which is a question about days, not about minutes.
    /// </summary>
    public const double MilesPerDrivingDay = 11 * 55;

    /// <summary>
    /// How late the company is, as a share of what it promised.
    ///
    /// This is the number that should drive everything, and for a long time none of it did. Every
    /// distance in this file was an absolute tuned against a fortnight, so a weekly driver seven days
    /// late — a driver who has blown their entire arrangement — was treated exactly like a six-week
    /// driver seven days late, who has blown a sixth of it.
    ///
    /// 0 while the date is being kept; 1 when the driver is a full arrangement past it.
    /// </summary>
    public static double Overrun(HomeStatus st) =>
        st.IntervalDays <= 0 ? 0 : Math.Clamp(st.DaysLate / st.IntervalDays, 0, 1);

    /// <summary>
    /// The furthest outward leg the app will ever permit while home time is approaching, in miles.
    ///
    /// A cap on the arithmetic below rather than the answer itself. Past about this the driver is
    /// crossing the country and the date is at real risk however many days the sum says are left —
    /// "he can send you further away but not like 700 miles further away" is where the number came from.
    /// </summary>
    public const double MaxOutboundWhenDueSoonMiles = 500;

    /// <summary>The least it will ever shrink to while the date is still being kept.</summary>
    public const double MinOutboundWhenDueSoonMiles = 150;

    /// <summary>
    /// The most a load may run away from the yard on the <b>first</b> day the company is late, in miles.
    ///
    /// Not zero, and deliberately not the fifty the scorer starts arguing at. Arguing and refusing are
    /// different jobs: a load a hundred miles the wrong way into a market full of freight home may well
    /// be the right call on the day the date slips, and it should lose points rather than be taken off
    /// the table. Five hundred miles into Texas from Tulsa is not that, and no rate makes it that.
    ///
    /// It does not stay at a hundred and fifty. See <see cref="OutboundNarrowingPerLateDayMiles"/>.
    /// </summary>
    public const double MaxOutboundWhenOverdueMiles = 150;

    /// <summary>
    /// Where that narrowing stops, in miles.
    ///
    /// Not zero, because the geography here is state-centroid distance with a same-state fallback and is
    /// rough by design — see the manual. A load measuring twenty miles further out is inside the error
    /// bars of the measurement, and refusing freight on a number the app has already said it cannot
    /// compute precisely would be the app pretending to a precision it does not have.
    /// </summary>
    public const double MinOutboundWhenOverdueMiles = 40;

    /// <summary>
    /// How near the yard counts as home, given how far past its word the company is.
    ///
    /// Widens on the SHARE of the arrangement overrun rather than on absolute days, so every driver
    /// reaches the same point at the same point in their own story: a weekly driver a week late and a
    /// six-week driver six weeks late are both a full arrangement past it, and both get the widest area.
    /// It used to grow forty miles a day for everybody, which meant the identical treatment for a driver
    /// who had broken their whole promise and one who had barely dented it.
    ///
    /// There has to be a stop: past some distance "close enough to run in empty" becomes a day of unpaid
    /// driving, and calling that home would be the app solving its own scoring problem with the driver's
    /// time.
    /// </summary>
    public static double EffectiveHomeRadius(AppState s, HomeStatus st)
    {
        var configured = s.Settings.Scoring.HomeRadiusMiles;
        var overrun = Overrun(st);
        if (overrun <= 0) return configured;
        return configured * (1 + overrun * (MaxRadiusMultiple - 1));
    }

    /// <summary>
    /// How far further out a load is allowed to take the driver before it stops being a load dispatch
    /// argues about and becomes one it refuses.
    ///
    /// Null while home time is not in play at all — a driver with most of their arrangement left goes
    /// where the freight is, and that is the whole point of an arrangement with a date on it.
    ///
    /// While the date is still being KEPT, it is whatever the driver could actually come back from: the
    /// days they have left, at a day's driving, halved because they have to return. That is a real
    /// question with a real answer, and it replaces a flat 500 miles for everybody — which spent every
    /// hour a weekly driver had left while giving a six-week driver with ten days in hand the same leash.
    ///
    /// Once the date has PASSED it narrows on the share of the arrangement overrun, so every driver
    /// reaches the floor when they are one full arrangement late: a weekly driver at seven days, a
    /// six-week driver at forty-two. It stops at <see cref="MinOutboundWhenOverdueMiles"/> rather than at
    /// nothing, because the geography is rough enough that the last few tens of miles are noise.
    ///
    /// Rounded to the nearest five so the figure quoted back to the driver reads like a policy rather
    /// than like arithmetic.
    /// </summary>
    public static double? OutboundAllowance(HomeStatus st)
    {
        if (!st.Tracked || !st.DueSoon) return null;

        if (!st.Overdue)
        {
            // The round trip has to fit in HALF the days left, not all of them. The other half is the
            // freight itself: the load out, the docks at both ends, the hours the run actually eats. A
            // detour sized to consume every remaining day is a detour that arrives home late.
            var recoverable = Math.Max(0, st.DaysUntilDue) * MilesPerDrivingDay / 4;
            return Math.Round(Math.Clamp(recoverable, MinOutboundWhenDueSoonMiles,
                                         MaxOutboundWhenDueSoonMiles) / 5) * 5;
        }

        var narrowed = MaxOutboundWhenOverdueMiles * (1 - Overrun(st));
        return Math.Round(Math.Max(MinOutboundWhenOverdueMiles, narrowed) / 5) * 5;
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
        /// How near the yard counts as home <b>for this driver right now</b>, in miles.
        ///
        /// Starts at the configured radius and widens the later the company runs — see
        /// <see cref="EffectiveHomeRadius"/>. Read this rather than the setting, or half the app will be
        /// working to a different definition of home than the other half.
        /// </summary>
        public double HomeRadius { get; set; }

        /// <summary>Days past the agreed interval. Zero when not overdue.</summary>
        public double DaysLate { get; set; }

        /// <summary>
        /// The furthest a load may finish from the yard, above where the driver is standing now, before
        /// dispatch refuses it outright rather than merely arguing against it. Null = no ceiling.
        /// </summary>
        public double? OutboundAllowance { get; set; }

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

        // How late we are, and therefore how near counts as home. Worked out once here so the scorer,
        // the board notes and the empty-run offer cannot disagree about where home ends.
        st.DaysLate = st.Overdue ? Math.Max(0, st.DaysOut - st.IntervalDays) : 0;
        st.HomeRadius = EffectiveHomeRadius(s, st);
        st.OutboundAllowance = OutboundAllowance(st);

        st.MilesFromHome = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        st.AtHome = st.MilesFromHome is { } m && m <= st.HomeRadius;
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
        // Another tour done on the same box. Ticked here, alongside the home time it counts, so the
        // notice given on the way in and the order issued on arrival are working from the same number.
        s.Driver.HomeTimesOnTrailer++;

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

        // Nor is a driver pulling something they asked for. A posting gets moved around with the freight
        // mix; an arrangement does not, or asking for it would have meant nothing. They come off it by
        // asking to come off it — see Requests.ReleaseTrailerArrangement.
        if (s.Driver.TrailerByRequest) return null;

        // A drop and hook the driver ASKED for is caught by TrailerByRequest above, the same as any
        // other arrangement. One they were simply put on is not an arrangement, it is a posting — and it
        // used to be exempt here anyway, which left a driver on it permanently with no way off short of
        // asking. Worse, ReassignmentTypeFor never knew about the exemption, so a drop-and-hook driver
        // was told on the way in that they were changing trailers and then nothing happened.
        //
        // They get the same fortnight's notice as anybody being re-rigged — see ReassignmentNotice.

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

        // Being put on drop and hook changes how the driver works, not just what is on the back, so the
        // reason says what it means rather than reading like another freight-mix shuffle.
        var reason = DropHook.Is(pick)
            ? "Freight mix — operations wants you on drop and hook for the next tour. Freight Market jobs, " +
              "the shipper's trailer, dropped at the other end. No trailer of your own."
            : $"Freight mix — operations wants you on {pick.ToLowerInvariant()} for the next tour.";

        return EquipmentService.IssueTrailerReassignment(s, pick, reason);
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
    /// <summary>
    /// How likely a freight-mix re-rig is, given how many tours the driver has done on this trailer.
    ///
    /// Was a flat 34 whatever the tenure. Flat is wrong in both directions: a driver settled on a box
    /// last month should mostly be left alone, and one who has been on the same freight for four tours
    /// is somebody a real carrier moves. It also produced the outcome nobody wants — a run of failed
    /// rolls leaving a player on one trailer indefinitely with nothing accumulating toward a change.
    ///
    /// Climbs twelve a tour and stops at eighty, because the last rung should still be a roll rather
    /// than a certainty. Something you can see coming is not the same as something scheduled.
    /// </summary>
    public static int ReassignChancePercent(int tenure) =>
        (int)Math.Clamp(34 + 12 * (Math.Max(1, tenure) - 1), 34, 80);

    /// <summary>
    /// The same idea for drop and hook, which climbs more gently.
    ///
    /// It is a bigger change than swapping a van for a reefer — different market, different job, no
    /// trailer of your own — so it should stay the occasional posting rather than becoming the likely
    /// one for anybody who sits still long enough.
    /// </summary>
    public static int DropHookChancePercent(int tenure) =>
        (int)Math.Clamp(12 + 4 * (Math.Max(1, tenure) - 1), 12, 28);

    /// <summary>
    /// Tours completed on the current trailer as at a given home time.
    ///
    /// Worked out relative to the home time being asked about, because this question is asked from both
    /// sides of the counter being ticked: the notice on the way in asks about <c>HomeTimesTaken + 1</c>
    /// before <see cref="Touch"/> runs, and the order on arrival asks about <c>HomeTimesTaken</c> after
    /// it. Both mean the same home time and both must get the same answer, or the warning and the order
    /// disagree — which is worse than no warning at all.
    /// </summary>
    public static int TenureAt(AppState s, int homeTimeNumber) =>
        Math.Max(1, s.Driver.HomeTimesOnTrailer + (homeTimeNumber - s.Driver.HomeTimesTaken));

    /// <summary>
    /// Where the driver stands on the re-rig curve, for the equipment screen.
    ///
    /// Published rather than left as a constant nobody can see. A rising chance the player cannot
    /// observe is indistinguishable from a flat one, and half the value of it rising is knowing that it
    /// is — a fourth tour on the same box should feel like something building, not like more of the same.
    /// </summary>
    public static object TenureView(AppState s)
    {
        var trailer = DispatchEngine.AssignedTrailer(s);
        var tours = Math.Max(0, s.Driver.HomeTimesOnTrailer);
        var next = TenureAt(s, s.Driver.HomeTimesTaken + 1);
        var byRequest = s.Driver.TrailerByRequest;
        var eligible = trailer != null && !byRequest && !Dedicated.Active(s)
                       && (s.Company.Divisions?.Count(d => !string.IsNullOrWhiteSpace(d)) ?? 0) >= 2;

        return new
        {
            unit = trailer?.Ref ?? "",
            tours,
            byRequest,
            eligible,
            chancePercent = eligible ? ReassignChancePercent(next) : 0,
            dropHookPercent = eligible && !DropHook.Is(trailer?.Type) ? DropHookChancePercent(next) : 0,
            note = byRequest
                ? "You asked for this one, so operations does not move you off it. You come off it by asking."
                : !eligible
                    ? "Nothing is going to move you off this one."
                    : tours <= 1
                        ? "Freshly assigned. Operations will leave you on it for a while yet."
                        : $"{tours} tour(s) on this one. The longer you are on a box the more likely operations " +
                          "is to move you, so a change gets more likely every time you come in.",
            curve = Enumerable.Range(1, 6).Select(t => new
            {
                tenure = t,
                percent = ReassignChancePercent(t),
                dropHookPercent = DropHookChancePercent(t),
            }).ToList(),
        };
    }

    public static string? ReassignmentTypeFor(AppState s, int homeTimeNumber)
    {
        if (homeTimeNumber < 2) return null;
        if (Dedicated.Active(s)) return null;

        var divisions = s.Company.Divisions?.Where(d => !string.IsNullOrWhiteSpace(d)).ToList() ?? new List<string>();
        if (divisions.Count < 2) return null;

        var current = DispatchEngine.AssignedTrailer(s);
        if (current == null) return null;

        // Drop and hook is postable too — the whole reason it was built as a trailer type is so a driver
        // can be put on it for a tour and taken back off, the same as being moved off a reefer. Leaving
        // it out would have meant it could only ever be asked for, which is half the feature.
        //
        // Rolled for on its own, ABOVE the freight-mix gate, because it is its own decision. Behind that
        // gate it was 34% of 12% — about one home time in twenty-five, a game-year of biweekly runs, which
        // is not "occasionally" but "practically never". On its own it is one in eight.
        //
        // Its own seed key, so an ordinary reassignment still lands exactly where it always did.
        var tenure = TenureAt(s, homeTimeNumber);

        if (!DropHook.Is(current.Type)
            && Qualified(s, DropHook.TrailerType)
            && Hash($"{s.Driver.Name}|drophook|{homeTimeNumber}") % 100 < (uint)DropHookChancePercent(tenure))
            return DropHook.TrailerType;

        // Seeded, so refreshing does not re-roll it — but the THRESHOLD rises with how long the driver
        // has been on this box. One in three on a fresh assignment, four in five by the fifth tour.
        if (Hash($"{s.Driver.Name}|reassign|{homeTimeNumber}") % 100 >= (uint)ReassignChancePercent(tenure)) return null;

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

        // Where the one they want is somewhere other than the yard, say so now. That wait is what turned
        // a home time into a home time plus a day, and knowing about it in advance is the whole point.
        //
        // Asked of the TRAILER. It used to look up whichever hired driver the app had down as pulling one
        // of that type and describe where THEY were, which is a fact about a person the app cannot keep
        // current — AI drivers change trailers by themselves and the app never hears about it.
        var wanted = s.Trailers.FirstOrDefault(t => !t.Retired
            && !t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase)
            && EquipmentService.TypeCovers(t.Type, next));

        if (wanted == null)
        {
            msg += $" I do not have a {next.ToLowerInvariant()} on the books, so operations will be sourcing one. " +
                   "There may be a wait at the yard — plan your home time around it rather than sitting on top of it.";
            return msg;
        }

        var where = Whereabouts.Assess(s, wanted);
        msg += $" The one we have is {wanted.Ref}. ";

        if (!where.Known)
            msg += "I have nothing current on where it is — have a look at the trailer screen while you are in " +
                   "and tell me, and I can say whether it is a straight swap or a wait at the yard.";
        else
            msg += where.Text + (where.WorthWaiting
                ? ""
                : " That is a wait at the yard rather than a straight swap, so plan your home time around it " +
                  "rather than sitting on top of it.");

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
        // Auto is not a trailer type either, for the same reason Dedicated is not: ATS sells no car
        // carrier, so there is nothing to re-rig a driver onto and nothing to tell the company to buy.
        // Both callers here decide about equipment we own. Car hauling runs as the drop-and-hook
        // arrangement instead — see TrailerSpec.ForDivision.
        "Auto" or "Car Hauling" => "",
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

        var radius = st.HomeRadius > 0 ? st.HomeRadius : s.Settings.Scoring.HomeRadiusMiles;
        var w = s.Settings.Scoring.HomeTime;
        // Overdue doubles the weight — at that point the company is breaking its own promise.
        var urgency = st.Overdue ? 1.0 : 0.55;

        var nowMiles = st.MilesFromHome ?? destMiles.Value;
        var closes = nowMiles - destMiles.Value;   // positive = ends up nearer home

        // How far a move has to be before it counts either way.
        //
        // A hundred and fifty miles is right while home time is merely coming due — freight does not run
        // in straight lines and penalising every wobble would make the board unusable. Once the company
        // is actually LATE it is far too generous: a load 150 miles further out scored a flat zero and
        // won on rate, which is how a driver overdue by weeks got sent from Rock Springs to Salt Lake
        // City and told it was "roughly neutral on home time".
        var deadBand = st.Overdue ? 50.0 : 150.0;

        if (destMiles.Value <= radius)
        {
            var pts = 1.0 * w * urgency;
            return (pts,
                $"Finishes {destMiles.Value:N0} mi from {st.TerminalLabel}, inside our {radius:N0} mi home radius" +
                $" and home time is {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}: {pts:+0.00;-0.00}",
                $"Gets you home — {destMiles.Value:N0} mi from {st.TerminalLabel}.", null);
        }

        if (closes > deadBand)
        {
            var pts = 0.5 * w * urgency;
            return (pts,
                $"Closes {closes:N0} mi toward {st.TerminalLabel} ({nowMiles:N0} → {destMiles.Value:N0} mi out): {pts:+0.00;-0.00}",
                $"Works you back toward {st.TerminalLabel}.", null);
        }

        if (closes < -deadBand)
        {
            // Scaled by how far wrong, not flat.
            //
            // A flat penalty says a load sixty miles further out and a load seven hundred miles further
            // out are the same mistake. They are not, and treating them as one is how a 500-mile run into
            // Texas beat everything else on rate while the driver was two and a half days late for home.
            // Doubles by the time the load has put a full day's driving between the driver and the yard.
            var wrongWay = Math.Abs(closes);
            var severity = 1.0 + Math.Clamp((wrongWay - deadBand) / 500.0, 0, 1.0);
            var pts = -1.0 * w * urgency * severity;
            return (pts,
                $"Runs {wrongWay:N0} mi further from {st.TerminalLabel} ({nowMiles:N0} → {destMiles.Value:N0} mi out) with home time {(st.Overdue ? "overdue" : "close")}: {pts:+0.00;-0.00}",
                null,
                st.Overdue
                    ? $"Takes you {Math.Abs(closes):N0} mi further out and your home time is already {st.DaysOut - st.IntervalDays:0.#} days late. That is the company breaking its word."
                    : $"Takes you {Math.Abs(closes):N0} mi further from {st.TerminalLabel} with home time due in {st.DaysUntilDue:0.#} days.");
        }

        return (0, $"Roughly neutral on home time ({nowMiles:N0} → {destMiles.Value:N0} mi from {st.TerminalLabel}).", null, null);
    }

    /// <summary>
    /// Whether this load runs so far the wrong way that dispatch declines it outright.
    ///
    /// The scorer argues; this refuses. The two are different jobs and the difference matters, because a
    /// penalty is something a good rate can outbid and a refusal is not. Once the company has actually
    /// broken its own promise about a date, a load that puts more miles between the driver and the yard
    /// is not a trade to be priced — there is no number that makes it the right answer.
    ///
    /// Returns null when the load is fine. When it is not, returns the sentence to put in front of the
    /// driver, because "rejected" with no reason is how somebody ends up re-entering the same board.
    /// </summary>
    public static string? OutboundRefusal(AppState s, BoardLoad load)
    {
        var st = Status(s);

        // Two things can hold a driver near the yard: home time falling due, and a truck over the
        // run-home damage line. Whichever is tighter wins. The damage clock is worked out the same way
        // an overdue home time is — see Shop.DamageOutboundAllowance — but it is a separate clock and
        // never appears on the home-time record.
        var byDamage = Shop.DamageOutboundAllowance(s, st);
        var allowed = st.OutboundAllowance is { } byHomeTime
            ? (byDamage is { } d ? Math.Min(byHomeTime, d) : byHomeTime)
            : byDamage;
        if (allowed is not { } allowance) return null;
        var damageIsTighter = byDamage is { } bd && Math.Abs(bd - allowance) < 0.01
                              && (st.OutboundAllowance is not { } h2 || bd < h2);

        var home = HomeTerminal(s);
        if (home == null) return null;

        var destMiles = Geo.MilesBetween(load.DestCity, load.DestState, home.City, home.State);
        if (destMiles == null) return null;                 // unmeasurable is not the same as unacceptable
        if (st.MilesFromHome is not { } nowMiles) return null;

        // How much further out this load leaves the driver. Negative means it closes the distance, which
        // is the case the ceiling was never about.
        //
        // There used to be an exemption above this for anything finishing inside the home area — written
        // for the small case, a load landing forty miles the far side of the yard. But the home area
        // WIDENS with lateness, so the exemption widened with it: at ten days late a 400-mile bubble round
        // the yard was exempt from the rule that exists because the company is late. Standing in Tulsa,
        // that authorised Omaha and Des Moines — 168 and 156 miles FURTHER from home — which is the
        // reported bug arriving by a different road.
        //
        // The exemption was never needed. A load finishing nearer the yard than the driver already is has
        // a negative gap and passes here on its own.
        var further = destMiles.Value - nowMiles;

        // Already inside the home area and late: the only freight worth taking is freight that gets the
        // driver meaningfully NEARER the yard. Anything else loses to the empty run in, which is sitting
        // right there on the Dispatch tab and is shorter than the load.
        //
        // This is what turned run 8 of the Los Angeles simulation into a tour. The driver landed in
        // Kansas City 182 mi from Springfield, overdue, and every lateral load on the board was inside
        // the ordinary tolerance — so it took one, and then another, and came home three days later than
        // a 182-mile deadhead would have.
        //
        // The floor is the same measurement noise the tolerance uses: a load ending twenty miles nearer
        // is not closing anything the geography can actually resolve.
        if (st.Overdue && st.AtHome && further > -MinOutboundWhenOverdueMiles)
        {
            var where0 = DispatchEngine.Place(load.DestCity, load.DestState);
            return $"You are already {nowMiles:N0} mi from {st.TerminalLabel} and {st.DaysLate:0.#} days late. " +
                   $"{where0} leaves you {destMiles.Value:N0} mi out, which is no nearer — so it is another day " +
                   "on the road to end up where you are. Run it in empty and take your home time; if something " +
                   "turns up that actually finishes near the yard, show me and I will put you under it.";
        }

        if (further <= allowance) return null;

        var where = DispatchEngine.Place(load.DestCity, load.DestState);

        // Say which clock is doing the squeezing. A driver whose home time is not due for a fortnight,
        // being told the board is narrow "because home time", would reasonably think the app was broken.
        if (damageIsTighter)
        {
            var days = Shop.DamageDaysOverdue(s) ?? 0;
            return $"{where} is {further:N0} mi FURTHER from {st.TerminalLabel}, and the truck is over the " +
                   $"damage line — {(days < 1 ? "as of today" : $"{days:0.#} day(s) now")}. It is going to our shop " +
                   $"and I am not sending it the wrong way to get there: about {allowance:N0} mi out is the limit, " +
                   "and it tightens for every day this takes. Nothing to do with your home time — that stands where " +
                   "it was.";
        }

        return st.Overdue
            ? $"{where} is {further:N0} mi FURTHER from {st.TerminalLabel} and your home time is already " +
              $"{st.DaysLate:0.#} days late. At that point I will not take you more than about {allowance:N0} mi " +
              "further out, and that shrinks every day we keep you — no rate on this board buys back a promise " +
              "we have already broken."
            : $"{where} runs {further:N0} mi further from {st.TerminalLabel} with home time due in " +
              $"{st.DaysUntilDue:0.#} days. I will take you out of the way to keep the truck earning, but not by " +
              $"more than about {allowance:N0} mi this close to your date — that is a different week, not a detour.";
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
        if (destMiles != null && destMiles.Value <= st.HomeRadius) return 1.0;

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
            if (miles != null && miles.Value <= st.HomeRadius) return null;
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
        if (miles == null || miles.Value > st.HomeRadius) return false;

        // And it has to actually get them nearer. The home area widens with lateness — 400 mi at six days
        // over — so "inside the home area" stopped meaning much: standing in Kansas City 182 mi out, a
        // load to Tulsa finishing 208 mi out qualified, and the driver was told it was being run to get
        // them home. It was 250 loaded miles to end up further from the yard than they started.
        return st.MilesFromHome is not { } nowMiles || miles.Value <= nowMiles;
    }

    /// <summary>
    /// Overdue for home time, and this load genuinely heads there.
    ///
    /// Wider than <see cref="IsOverdueRideHome"/> on purpose: that one asks whether the load ARRIVES
    /// home, which is what justifies paying below break-even. This asks whether it makes real progress
    /// — inside the home radius, or closing more than the scoring dead band. A thousand miles from
    /// Rock Springs to Tulsa does not reach Springfield, but it closes most of the gap, and on an overdue
    /// arrangement that is the load worth having.
    /// </summary>
    public static bool OverdueAndHeadsHome(AppState s, BoardLoad load)
    {
        var st = Status(s);
        if (!st.Tracked || !st.Overdue) return false;

        var home = HomeTerminal(s);
        if (home == null) return false;

        var destMiles = Geo.MilesBetween(load.DestCity, load.DestState, home.City, home.State);
        if (destMiles == null) return false;
        if (destMiles.Value <= st.HomeRadius) return true;

        var nowMiles = st.MilesFromHome;
        return nowMiles != null && nowMiles.Value - destMiles.Value > 150;
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
        if (destMiles == null || destMiles.Value > st.HomeRadius) return lines;

        // Never call a load the ride home when it ends further out than the driver already is. Inside a
        // home area that widens to 400 miles, that was a sentence the app said about journeys in the
        // wrong direction.
        if (st.MilesFromHome is { } atNow && destMiles.Value > atNow) return lines;

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
            // Whichever schedule is in force says whether there is work to book in for. Quoting the
            // single PM cycle under GDC named a clock nothing on that schedule ever moves.
            if (ServicePlan.GdcActive(s))
            {
                var owing = ServicePlan.DueNow(s, truck);
                var soon = ServicePlan.Next(s, truck);
                if (owing.Count > 0)
                    jobs.Add($"Unit {truck.Ref} is due {owing.Count} service checkpoint(s) — " +
                             string.Join(", ", owing.Select(d => d.Name.ToLowerInvariant())) +
                             ". Do them now rather than on the road, and record it as a Preventive work " +
                             "order on the Maintenance tab — that is what clears the schedule.");
                else if (soon != null && soon.MilesUntilDue <= soon.IntervalMiles * 0.15)
                    jobs.Add($"Unit {truck.Ref} is {soon.MilesUntilDue:N0} mi off its {soon.Name.ToLowerInvariant()} — do it now rather than on the road.");
            }
            else
            {
                var sinceService = truck.ServiceMiles - truck.LastServiceMiles;
                if (sinceService >= truck.ServiceIntervalMiles * 0.85)
                    jobs.Add($"Unit {truck.Ref} is {sinceService:N0} mi into a {truck.ServiceIntervalMiles:N0}-mile PM cycle — do the service now rather than on the road.");
            }
        }
        // Nothing to book in for a trailer we do not own. Whatever was hooked went back to the shipper.
        if (trailer is { InGameGarage: true } && !DropHook.Is(trailer.Type) && trailer.DamagePct >= m.ReportPct)
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
        /// Company trailers whose whereabouts are worth asking about.
        ///
        /// Asked here because this is the one moment the player is at the yard with the game's trailer
        /// screen available, and because the answer only ever decides one thing: whether a trailer they
        /// might be re-rigged onto is worth waiting for.
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

            if (ServicePlan.GdcActive(s))
            {
                var owing = ServicePlan.DueNow(s, truck);
                var soon = ServicePlan.Next(s, truck);
                if (owing.Count > 0)
                    b.Shop.Add($"Unit {truck.Ref} is due {owing.Count} service checkpoint(s) — " +
                               string.Join(", ", owing.Select(d => d.Name.ToLowerInvariant())) +
                               $". Do them now; the yard reckons ${ServicePlan.EstimateFor(s, truck):N0}. " +
                               "Record it as a Preventive work order on the Maintenance tab and the " +
                               "checkpoints clear.");
                else if (soon != null && soon.MilesUntilDue <= soon.IntervalMiles * 0.15)
                    b.Shop.Add($"{soon.Name} due on unit {truck.Ref} in {soon.MilesUntilDue:N0} mi. Cheaper to do it here than on the road.");
            }
            else
            {
                var since = truck.ServiceMiles - truck.LastServiceMiles;
                if (since >= truck.ServiceIntervalMiles)
                    b.Shop.Add($"Unit {truck.Ref} is {since - truck.ServiceIntervalMiles:N0} mi PAST its {truck.ServiceIntervalMiles:N0}-mile PM. Do it now.");
                else if (since >= truck.ServiceIntervalMiles * 0.85)
                    b.Shop.Add($"PM due on unit {truck.Ref} in {truck.ServiceIntervalMiles - since:N0} mi. Cheaper to do it here than on the road.");
            }

            // Past servicing it. The yard is where a swap actually happens — the driver is standing on
            // the property and the spare, if there is one, is parked on it — so this is the right place
            // to say a tractor is finished rather than a fleet report the player may never file.
            if (FleetOpsService.OwnTruckRetirement(s) is { } trade)
            {
                b.Shop.Add(trade.Headline);
                foreach (var line in trade.Evidence) b.Shop.Add($"  · {line}");
            }
        }

        if (trailer is { InGameGarage: true } && !DropHook.Is(trailer.Type))
        {
            if (trailer.DamagePct >= m.ReportPct)
                b.Shop.Add($"Trailer {trailer.Ref} is at {trailer.DamagePct:0.#}% — get it done at the same time.");
            else
                b.Shop.Add($"Trailer {trailer.Ref} is fine at {trailer.DamagePct:0.#}%.");
        }
        else if (DropHook.Is(trailer?.Type))
            b.Shop.Add("No trailer of ours to look at — you are on drop and hook, so it is the tractor only.");

        if (b.Shop.Any(x => x.Contains("Repair") || x.Contains("PM") || x.Contains("shop") || x.Contains("done")))
            b.Shop.Add(hasShop
                ? $"The {home!.City} yard has its own shop, so labour is cheaper here than anywhere on the road."
                : $"The {home?.City ?? "home"} yard has no shop — book it into a dealer or service centre nearby.");

        // If the damage is what brought them here, say how long it takes and be explicit that this is
        // home time, not a detour off it. Otherwise the driver reads "run it home" as losing their days.
        var stopPct = s.Settings.Maintenance.StopDispatchPct;
        var worst = Math.Max(truck is { InGameGarage: true } ? truck.DamagePct : 0,
                             trailer is { InGameGarage: true } && !DropHook.Is(trailer.Type) ? trailer.DamagePct : 0);
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

        // Was `t.Year > truck.Year` and nothing else, so this would send a driver to put in for a
        // newer plate on a worse truck and let them find out when they climbed into it.
        var spare = s.Trucks.FirstOrDefault(t => !t.Retired && t.InGameGarage
                                                 && t.Unit != s.Driver.AssignedTruckUnit
                                                 && t.HomeTerminalId == home?.Id
                                                 && string.IsNullOrWhiteSpace(t.AssignedDriver)
                                                 && truck != null
                                                 && TruckGrade.IsUpgrade(s, truck, t, out _));
        if (spare != null)
        {
            b.BetterUnitAvailable = true;
            b.BetterUnit = spare.Ref;
            TruckGrade.IsUpgrade(s, truck, spare, out var spareWhy);
            b.Equipment.Add($"There is a better unit sitting here: {spare.Ref} ({spare.Year} {spare.Make} {spare.Model}, " +
                            $"{spare.ServiceMiles:N0} mi) against your {truck!.Year} {truck.Make}. {spareWhy} " +
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

        // Company trailers we have nothing recent on. Asked per BOX rather than per driver, because the
        // driver the app has down for a trailer is the part that goes stale.
        foreach (var t in Whereabouts.WorthAsking(s))
            b.AskWhereabouts.Add(new
            {
                unit = t.Unit,
                trailer = t.Ref,
                trailerType = t.Type,
                current = t.Whereabouts,
                city = t.WhereaboutsCity,
                state = t.WhereaboutsState,
                known = Whereabouts.Assess(s, t).Text,
            });

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

        // The 34 comes first, because a driver out of cycle is not going anywhere on freight and the
        // empty run to sit it is the same shape of decision as the run home: the app already knows
        // WHERE it wants them, so making them work out the mileage — or drive it unpaid and unrecorded —
        // is asking them to do the app's arithmetic.
        offers.AddRange(RestartOffers(s));

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

        // The run home. Allowed to span a rest, unlike the market legs below — see HomeRunShifts.
        var homeReach = reach * HomeRunShifts;
        var offeredHome = false;
        if (!alreadyHome && toHome is { } hm && hm <= homeReach)
        {
            offeredHome = true;
            var overnight = hm > reach;
            offers.Add(new RepositionOffer
            {
                City = home.City, State = home.State, Miles = Math.Round(hm, 0), IsHomeRun = true,
                Reason = $"Empty to the yard for home time — {(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}, " +
                         "and nothing on the board is worth staying out for." +
                         (overnight
                             ? $" That is further than one shift, so take your {s.Settings.Hos.OffDutyReset:0.#} on the way — " +
                               "it is still the shortest way to end this."
                             : "")
            });
        }

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
                     // Never an empty leg to a market that is not meaningfully shorter than the empty leg
                     // home. Running 497 mi unpaid to pull a board, when 615 mi unpaid ends the trip, is
                     // not a saving — it is the same driving with the job still to do at the end of it.
                     .Where(x => !offeredHome || toHome == null || x.out_ < toHome.Value * 0.6)
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
    /// <summary>
    /// The empty run to wherever the 34 is being sat, when that is not where the driver is standing.
    ///
    /// <see cref="Restart.Where"/> already decides the city — home if the two stops merge sensibly, a
    /// restart-friendly market otherwise. What was missing was any way to ACT on it: the driver either
    /// drove there without telling the app, losing the empty miles off their settlement, or raised the
    /// move by hand and typed a distance the app could have measured.
    ///
    /// Nothing is offered when the restart city is the one they are already in. A nought-mile
    /// reposition is not a job, and putting a button on it would be noise at exactly the moment the
    /// driver wants to stop reading and go to bed.
    /// </summary>
    public static List<RepositionOffer> RestartOffers(AppState s)
    {
        var offers = new List<RepositionOffer>();
        if (!Restart.Needed(s) && Restart.Open(s) == null) return offers;

        var (city, state, isHome, why) = Restart.Where(s);
        if (string.IsNullOrWhiteSpace(city)) return offers;

        // Already standing in it — nothing to drive, nothing to offer.
        if (city.Equals(s.Status.LocationCity, StringComparison.OrdinalIgnoreCase)
            && (string.IsNullOrWhiteSpace(state)
                || state.Equals(s.Status.LocationState, StringComparison.OrdinalIgnoreCase)))
            return offers;

        var miles = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, city, state);
        if (miles is not { } mi || mi < 1) return offers;

        offers.Add(new RepositionOffer
        {
            City = city,
            State = state,
            Miles = Math.Round(mi, 0),
            IsHomeRun = isHome,
            Reason = $"Empty to sit the {s.Settings.Hos.CycleRestartHours:0.#} — " +
                     $"{Hhmm.Of(s.Hos.CycleRemaining)} left on the {s.Settings.Hos.CycleLimit:0}. " +
                     (string.IsNullOrWhiteSpace(why) ? "" : why + " ") +
                     "The miles are measured, so they are paid rather than lost.",
        });

        return offers;
    }

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

        // Home is within reach on the clock in hand. Then the answer is to GO, not to hunt.
        //
        // This used to say "look at the board in Springfield itself, or anything running that way, and
        // show me what is there" — which is nonsense from Tulsa. You cannot see Springfield's board from
        // Tulsa, and the driver is not looking for freight OUT of home; they are trying to reach it. They
        // had also just shown a board with nothing going that way, so asking to see one again is asking
        // for what they have already given.
        // Reachable across a rest, not just on the clock in hand — the same allowance the offer itself
        // gets. Judged on one shift, this went quiet at 615 miles and started naming markets instead,
        // which is how a driver ends up running further empty than the trip home would have been.
        if (toHome is { } miles && miles <= reach * HomeRunShifts)
            return $"Nothing on this board goes home and your home time is " +
                   $"{(st.Overdue ? "overdue" : $"due in {st.DaysUntilDue:0.#} days")}. " +
                   $"{DispatchEngine.Place(home.City, home.State)} is {miles:N0} mi — " +
                   (miles <= reach
                       ? $"inside what you can drive on {Hhmm.Of(drivable)}. "
                       : $"further than the {Hhmm.Of(drivable)} you have, so take your " +
                         $"{s.Settings.Hos.OffDutyReset:0.#} on the way. ") +
                   "Run it in empty and take your home time; the empty miles are on the " +
                   "Dispatch tab and they are paid. If something going that way turns up before you roll, show me " +
                   "and I will put you under it instead.";

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
