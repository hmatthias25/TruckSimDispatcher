using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The wider search, for a town with no freight for the trailer.
///
/// <para>Asked for from play. An economy mod often leaves the town a load delivers to with nothing going out for the
/// trailer the truck has, and the board then had nowhere to go: a load from another town entered on it confused the
/// city-board logic, and "nothing in the city either" ended in "reposition somewhere better", leaving the driver to
/// pick. Picking is dispatch's job.</para>
///
/// <para>So the driver says the town has nothing, and dispatch names the towns to look at, ring by ring: everything
/// reached within 100 miles, then 100 to 250, 250 to 400, 400 to 800, each ring only the towns the last did not cover.
/// The driver pulls those towns' boards and enters what they have as one board. A load that works is assigned, judged on
/// its loaded miles, because the empty run to it is a run the truck makes either way. The driver may turn any of them
/// down for nothing, at any rank. If none works, or all are turned down, dispatch picks one of the towns with freight
/// and books the empty run there; the board is pulled on arrival and everything is as usual from there. Past 800
/// miles there is no freight for that trailer, and the driver is sent home to swap it.</para>
///
/// <para>With home time pressing the same search runs, but only through towns that leave the truck nearer home, and
/// the loads are held to the home-time rules as ever. A town nearer home with freight is where the empty run goes.
/// When the rings reach home with nothing on the way, the run is home.</para>
///
/// <para>Only towns the driver has reached are named: ATS makes no cargo in a town that has not been discovered.
/// Market towns in the ring the app has no record of are named as such, in case the driver reached them before
/// the app knew them.</para>
/// </summary>
public static class LoadSearch
{
    public static readonly double[] Rings = { 100, 250, 400, 800 };

    /// <summary>Nearer home by at least this much to count as on the way home.</summary>
    private const double TowardHomeMargin = 10;

    private static bool Same(string? a, string? b) =>
        string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

    private static string Here(AppState s) => DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState);

    /// <summary>The search, where one is running from where the truck is. A truck that has moved has left it behind.</summary>
    public static LoadSearchState? Current(AppState s)
    {
        var x = s.Search;
        if (x == null) return null;
        return Same(x.FromCity, s.Status.LocationCity) && Same(x.FromState, s.Status.LocationState) ? x : null;
    }

    /// <summary>A load off another town's board, entered while the search runs.</summary>
    public static bool Found(AppState s, BoardLoad l) =>
        Current(s) != null && !(Same(l.OriginCity, s.Status.LocationCity) && Same(l.OriginState, s.Status.LocationState));

    private static (string City, string State)? Home(AppState s) =>
        HomeTime.HomeTerminal(s) is { } t ? (t.City, t.State) : null;

    private static double? HomeMiles(AppState s, string city, string state) =>
        Home(s) is { } h ? Geo.MilesBetween(city, state, h.City, h.State) : null;

    private static bool HomePressing(AppState s, out double homeMiles)
    {
        var st = HomeTime.Status(s);
        homeMiles = st.MilesFromHome ?? 0;
        return st.Tracked && (st.DueSoon || st.Overdue || st.Tight) && homeMiles > st.HomeRadius;
    }

    private static string TrailerWord(LoadSearchState x) => string.IsNullOrWhiteSpace(x.TrailerType) ? "your trailer" : $"a {x.TrailerType.ToLowerInvariant()}";

    private static string RingWords(LoadSearchState x) =>
        x.InnerMiles <= 0 ? $"within {Units.Dist(x.OuterMiles):0} {Units.DistUnit}"
            : $"{Units.Dist(x.InnerMiles):0} to {Units.Dist(x.OuterMiles):0} {Units.DistUnit} out";

    // ---------------------------------------------------------------- starting, widening, stopping

    /// <summary>The driver says the town has nothing for the trailer: the first ring.</summary>
    public static BoardDecision Start(AppState s)
    {
        if (s.Trips.FirstOrDefault(t => t.Id == s.Status.ActiveTripId) is { Status: not ("Delivered" or "Cancelled") } open)
            throw new InvalidOperationException($"{open.Number} is still open. Close it out before looking for the next load.");
        var trailer = DispatchEngine.AssignedTrailer(s);
        var homeBound = HomePressing(s, out var homeMiles);
        s.Search = new LoadSearchState
        {
            FromCity = s.Status.LocationCity, FromState = s.Status.LocationState, StartedGameTime = s.Status.GameTime,
            Ring = -1, HomeBound = homeBound, HomeMilesHere = homeMiles,
            // Drop and hook is an arrangement, not a trailer: the freight decides the box, so it is "your trailer".
            TrailerType = trailer == null || DropHook.Is(trailer.Type) ? "" : trailer.Type,
        };
        s.Board.Clear();
        return NextRing(s, $"Nothing in {Here(s)} for {TrailerWord(s.Search)}.");
    }

    /// <summary>The towns in this ring had nothing either: the next ring out.</summary>
    public static BoardDecision Widen(AppState s)
    {
        var x = Current(s) ?? throw new InvalidOperationException("No search is running from here.");
        s.Board.Clear();
        return NextRing(s, $"Nothing {RingWords(x)} either.");
    }

    public static void Stop(AppState s) => s.Search = null;

    private static BoardDecision NextRing(AppState s, string opening)
    {
        var x = s.Search!;
        x.Notes = new List<string> { opening };
        while (true)
        {
            x.Ring++;
            // Past the last ring: home. On the way home that is the run home; otherwise there is no freight for the trailer.
            if (x.Ring >= Rings.Length) return End(s, x.HomeBound);
            x.InnerMiles = x.Ring == 0 ? 0 : Rings[x.Ring - 1];
            x.OuterMiles = Rings[x.Ring];
            // On the way home, past home there is nothing nearer it worth driving to: the run is home.
            if (x.HomeBound && x.InnerMiles >= x.HomeMilesHere) return End(s, true);
            Fill(s, x);
            if (x.Cities.Count > 0) break;
            x.Notes.Add($"No town you have reached lies {RingWords(x)}{(x.HomeBound ? " on the way home" : "")}" +
                        (x.NotDiscovered.Count > 0 ? $" (not reached: {string.Join(", ", x.NotDiscovered)})" : "") + ".");
        }
        return Decision(s, new BoardDecision { NextTripNumberPreview = DispatchEngine.PeekNumber(s, "Freight") });
    }

    /// <summary>The towns to look at in the ring: reached, on the driver's map, and nearer home where home is pressing.</summary>
    private static void Fill(AppState s, LoadSearchState x)
    {
        bool InRing(double? m) => m is { } mi && mi > x.InnerMiles && mi <= x.OuterMiles;
        bool OnTheWay(double? home) => !x.HomeBound || home is { } h && h < x.HomeMilesHere - TowardHomeMargin;
        bool NotHere(string city, string state) => !(Same(city, x.FromCity) && Same(state, x.FromState));

        x.Cities = s.Discovered
            .Where(d => NotHere(d.City, d.State) && MapCoverage.Allows(s, d.State))
            .GroupBy(d => (d.City.ToLowerInvariant(), d.State.ToLowerInvariant())).Select(g => g.First())
            .Select(d => new SearchCity
            {
                City = d.City, State = d.State,
                Miles = Math.Round(Geo.MilesBetween(x.FromCity, x.FromState, d.City, d.State) ?? -1),
                HomeMiles = x.HomeBound ? HomeMiles(s, d.City, d.State) is { } hm ? Math.Round(hm) : null : null,
            })
            .Where(c => InRing(c.Miles) && OnTheWay(c.HomeMiles))
            .OrderBy(c => c.Miles)
            .ToList();
        x.NotDiscovered = Markets.Effective(s)
            .Where(m => NotHere(m.City, m.State) && MapCoverage.Allows(s, m.State) && !DiscoveryService.IsDiscovered(s, m.City, m.State)
                        && InRing(Geo.MilesBetween(x.FromCity, x.FromState, m.City, m.State))
                        && OnTheWay(x.HomeBound ? HomeMiles(s, m.City, m.State) : null))
            .Select(m => DispatchEngine.Place(m.City, m.State)).Distinct().Take(10).ToList();
    }

    // ---------------------------------------------------------------- what dispatch says

    /// <summary>The ring as a board decision: the towns to pull boards from, and what to do when they have nothing.</summary>
    public static BoardDecision Decision(AppState s, BoardDecision d)
    {
        var x = Current(s)!;
        d.RejectAll = false;
        d.Search = View(s);
        d.Headline = $"Look at the boards {RingWords(x)}" + (x.HomeBound ? ", on the way home." : ".");
        d.Rationale = $"Pull the freight boards in these towns and enter what they have for {TrailerWord(x)} as one board, each " +
                      "job with the town it leaves from. I will assign one that works. If none of them has anything, say so and I will " +
                      "look further out.";
        d.DispatchNotes.AddRange(x.Notes);
        d.DispatchNotes.Add(string.Join(", ", x.Cities.Select(c => $"{DispatchEngine.Place(c.City, c.State)} ({Units.Distance(c.Miles)}" +
                                                                        (c.HomeMiles is { } h ? $", {Units.Distance(h)} from home" : "") + ")")) + ".");
        if (x.HomeBound)
            d.DispatchNotes.Add($"Home time is close, so only towns nearer home than here ({Units.Distance(x.HomeMilesHere)}). " +
                                "A load still has to keep you on course for home; the usual home-time rules apply to it.");
        if (x.NotDiscovered.Count > 0)
            d.DispatchNotes.Add($"Also in the ring but not on my list of towns you have reached: {string.Join(", ", x.NotDiscovered)}. " +
                                "ATS makes no freight in a town you have not discovered; if you have been there, their boards count too.");
        d.DispatchNotes.Add("A load out of one of these is judged on its own loaded miles: the run to the pickup is the empty run " +
                            "you would make anyway, and it is paid as empty miles. Turning one down is free, whatever your rank.");
        return d;
    }

    /// <summary>
    /// Dispatch's pick of a town to run empty to, from the towns on the board with freight for the trailer: the nearest
    /// whose run fits the cycle, or on the way home the one nearest home. Null when no town on the board has any.
    /// </summary>
    public static (string City, string State, double Miles, double? HomeMiles, FeasibilityResult? Plan, int Loads)? Pick(AppState s)
        => Pick(s, out _);

    /// <summary><see cref="Pick(AppState)"/>, saying whether towns with freight were there but none left time to get home by the date.</summary>
    public static (string City, string State, double Miles, double? HomeMiles, FeasibilityResult? Plan, int Loads)? Pick(AppState s,
        out bool ruledOutByHomeDate)
    {
        ruledOutByHomeDate = false;
        var x = Current(s);
        if (x == null) return null;
        var trailer = DispatchEngine.AssignedTrailer(s);
        bool Fits(BoardLoad l) => string.IsNullOrWhiteSpace(l.TrailerType) || trailer == null || DropHook.Is(trailer.Type)
                                  || Same(l.TrailerType, trailer.Type);
        var towns = s.Board.Where(l => Found(s, l) && Fits(l))
            .GroupBy(l => (l.OriginCity.Trim().ToLowerInvariant(), l.OriginState.Trim().ToLowerInvariant()))
            .Select(g => (City: g.First().OriginCity.Trim(), State: g.First().OriginState.Trim(), Loads: g.Count()))
            .Select(t => (t.City, t.State, Miles: Geo.MilesBetween(x.FromCity, x.FromState, t.City, t.State) ?? 0,
                          HomeMiles: HomeMiles(s, t.City, t.State), t.Loads))
            .Where(t => t.Miles > 0 && (!x.HomeBound || t.HomeMiles is { } h && h < x.HomeMilesHere - TowardHomeMargin))
            .Select(t => (t.City, t.State, t.Miles, t.HomeMiles, Plan: DispatchEngine.PlanEmptyMove(s, t.City, t.State, Math.Round(t.Miles)), t.Loads))
            .ToList();
        if (towns.Count == 0) return null;
        // Not somewhere the driver cannot get home from by the date, with an arrangement to keep (home time not yet due
        // soon included — see HomeTime.HomeByDateRefusal). When that rules out every town, the run home does instead.
        if (HomeTime.DueAt(s, HomeTime.Status(s)) is { } due && GameClock.TryParse(s.Status.GameTime) is { } now)
        {
            towns = towns.Where(t => HomeTime.HoursHomeFrom(s, t.City, t.State) is not { } back
                                     || now.AddHours((t.Plan?.ElapsedHours ?? 0) + back) <= due.AddHours(-HomeTime.HomeSlackHours(back))).ToList();
            if (towns.Count == 0) { ruledOutByHomeDate = true; return null; }
        }
        var fit = towns.Where(t => t.Plan is not { CycleRestartRequired: true }).ToList();
        var pool = fit.Count > 0 ? fit : towns;
        var pick = x.HomeBound
            ? pool.OrderBy(t => t.HomeMiles ?? double.MaxValue).ThenBy(t => t.Miles).First()
            : pool.OrderBy(t => t.Miles).ThenByDescending(t => t.Loads).First();
        return pick;
    }

    /// <summary>
    /// Nothing on the board works, or the driver turned it all down: the run dispatch will book. Said on the decision,
    /// with one button that books it. The town is dispatch's call; nothing on the screen offers another.
    /// </summary>
    public static BoardDecision Proposal(AppState s, BoardDecision d)
    {
        var x = Current(s)!;
        d.RejectAll = true;
        d.Search = View(s);
        foreach (var e in d.Evaluations.Where(e => e.Recommendation != "Authorize")) e.Recommendation = "Reject";
        var allPassed = d.Evaluations.Count > 0 && d.Evaluations.All(e => e.Load.PassedOver);
        if (Pick(s, out var byDate) is not { } p)
        {
            if (byDate && HomeTime.Status(s) is { } hs)
            {
                d.Headline = $"The towns with freight are too far out to get you home to {hs.TerminalLabel} in time.";
                d.Rationale = $"Home time is due in {hs.DaysUntilDue:0.#} days, and from any of them the run in would land after it. " +
                              "Enter what the nearer towns have, or take the run home.";
                d.DispatchNotes.Add(d.Rationale);
                return d;
            }
            d.Headline = $"Nothing here works, and none of these towns has freight for {TrailerWord(x)}" + (x.HomeBound ? " nearer home." : ".");
            d.Rationale = "Enter what the other towns in the ring have, or say there is nothing in them and I will look further out.";
            d.DispatchNotes.Add(d.Rationale);
            return d;
        }
        var place = DispatchEngine.Place(p.City, p.State);
        d.Headline = $"Run empty to {place} and pull the board there.";
        d.Rationale = (allPassed ? "You turned these down. " : "None of these works for you. ") +
                      $"{place} has freight for {TrailerWord(x)}, {Units.Distance(p.Miles)} from {Here(s)}" +
                      (p.HomeMiles is { } hm && x.HomeBound ? $", and it leaves you {Units.Distance(hm)} from home against {Units.Distance(x.HomeMilesHere)} here" : "") +
                      ". That is where I am sending you.";
        d.DispatchNotes.Add(d.Rationale);
        if (p.Plan is { CycleRestartRequired: true })
            d.DispatchNotes.Add("None of the towns with freight is in reach on what is left of your cycle, so this run starts with " +
                                (Restart.IsEu(s) ? "your weekly rest" : "a 34-hour restart") + ". The plan has it.");
        else if (p.Plan != null) d.DispatchNotes.Add(DispatchEngine.EmptyMovePlanNote(p.Plan));
        d.DispatchNotes.Add("When you get there, report in and pull the board. From there it is the usual: a load, or your rest first." +
                            (x.HomeBound ? " Home time is judged there as anywhere." : ""));
        d.Reposition = new { city = p.City, state = p.State, place, miles = Math.Round(p.Miles), homeMiles = p.HomeMiles, loads = p.Loads };
        return d;
    }

    /// <summary>The driver acknowledges the order: the empty run is booked, and the search is over.</summary>
    public static Trip BookReposition(AppState s)
    {
        var x = Current(s) ?? throw new InvalidOperationException("No search is running from here.");
        var p = Pick(s) ?? throw new InvalidOperationException("No town on the board has freight for the trailer yet.");
        var trip = DispatchEngine.CreateEmptyMove(s, p.City, p.State, Math.Round(p.Miles),
            $"Wider search from {Here(s)}: nothing on the boards {RingWords(x)} worked. " +
            $"{DispatchEngine.Place(p.City, p.State)} has freight for {TrailerWord(x)}: pull the board there.");
        s.Board.Clear();
        s.Search = null;
        return trip;
    }

    /// <summary>Past the last ring, or home reached on the way: the run home. Booked, and the search is over.</summary>
    private static BoardDecision End(AppState s, bool homeReached)
    {
        var x = s.Search!;
        var d = new BoardDecision { NextTripNumberPreview = DispatchEngine.PeekNumber(s, "Freight"), RejectAll = true };
        d.DispatchNotes.AddRange(x.Notes);
        var home = HomeTime.HomeTerminal(s);
        var why = homeReached
            ? $"Nothing between {Here(s)} and home has freight for {TrailerWord(x)}."
            : $"Nothing within {Units.Distance(Rings[^1])} of {Here(s)} has freight for {TrailerWord(x)}: there is probably none for that trailer anywhere just now.";
        s.Search = null;
        if (home == null)
        {
            d.Headline = why;
            d.Rationale = homeReached ? "Head home." : "Swap the trailer for one with work at the nearest yard of ours.";
            d.DispatchNotes.Add(d.Rationale);
            return d;
        }
        var label = DispatchEngine.Place(home.City, home.State);
        var miles = Math.Round(Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State) ?? 0);
        var swap = homeReached ? "" : " Swap the trailer there for one there is freight for.";
        if (miles < 1)
        {
            d.Headline = why;
            d.Rationale = $"You are at {label}.{swap}";
            d.DispatchNotes.Add(d.Rationale);
            return d;
        }
        var trip = DispatchEngine.CreateEmptyMove(s, home.City, home.State, miles, $"{why} Run it home to {label}.{swap}");
        // The run home brings the run home's questions: the trailer for home time, and the days off.
        DispatchEngine.AskAboutTrailersHome(s, d);
        s.Board.Clear();
        d.Headline = $"{trip.Number}: run it home to {label}.";
        d.Rationale = $"{why} I have booked the empty run home, {Units.Distance(miles)}.{swap}";
        d.DispatchNotes.Add(d.Rationale);
        if (trip.FeasibilityAtDispatch is { } plan) d.DispatchNotes.Add(DispatchEngine.EmptyMovePlanNote(plan));
        d.Reposition = new { city = home.City, state = home.State, place = label, miles, booked = trip.Number, home = true };
        return d;
    }

    public static object? View(AppState s)
    {
        var x = Current(s);
        if (x == null) return null;
        return new
        {
            from = DispatchEngine.Place(x.FromCity, x.FromState), ring = x.Ring + 1, rings = Rings.Length,
            innerMiles = x.InnerMiles, outerMiles = x.OuterMiles, words = RingWords(x), homeBound = x.HomeBound,
            homeMilesHere = x.HomeMilesHere, trailer = x.TrailerType, lastRing = x.Ring >= Rings.Length - 1,
            cities = x.Cities.Select(c => new { c.City, c.State, place = DispatchEngine.Place(c.City, c.State), c.Miles, c.HomeMiles }),
            notDiscovered = x.NotDiscovered, notes = x.Notes,
        };
    }
}
