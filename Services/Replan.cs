using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The rest of a running load planned again from where the driver is, when the plan they were given has gone: out of
/// the shipper late, a sailing that will not be made. Every way across is tried from here, side by side, with the
/// sailing the driver says they will miss taken out, and the best is kept on the trip as the plan to drive to.
///
/// <para>Asked for from play: out of the shipper late on Kokkola to Groningen, the 17:00 out of Helsinki gone, and the
/// question was whether Naantali – Kapellskär would do better. It would not — Germany's Sunday ban holds both routes
/// to the same Monday morning, and one of them is a thousand kilometres more road — but that took working out by hand,
/// and the app had the sailings, the bans and the clocks to work it out itself.</para>
/// </summary>
public static class Replan
{
    public record Request(string? City, string? State, string? GameTime, string? MissRoute);

    /// <summary>How near the soonest arrival another way has to be for less driving to win instead.</summary>
    public const double CloseEnoughHours = 3;

    public static object Run(AppState s, string tripId, Request ask)
    {
        var trip = s.Trips.FirstOrDefault(t => t.Id == tripId) ?? throw new InvalidOperationException("Trip not found.");
        if (trip.Status is not ("Authorized" or "InTransit"))
            throw new InvalidOperationException("Only a load still running can be re-planned.");
        var city = string.IsNullOrWhiteSpace(ask.City) ? s.Status.LocationCity : ask.City.Trim();
        var cc = string.IsNullOrWhiteSpace(ask.State) ? s.Status.LocationState : Ets2Data.Region(s, ask.State);
        var now = GameClock.TryParse(ask.GameTime) ?? GameClock.TryParse(s.Status.GameTime)
                  ?? throw new InvalidOperationException("No game time to plan from.");

        var req = Build(s, trip, city, cc, now);
        var truck = DispatchEngine.AssignedTruck(s);
        var every = new List<(FeasibilityResult Plan, string Via)>();
        var best = Crossings.PlanBest(s, req, truck, every);

        // "I will miss that one": whichever sailing of it the plans were counting on is taken out, and it is all
        // planned again. Not "nothing before now" — the planner may well think the truck makes it, and the driver
        // is the one who knows about the queue at the shipper.
        var missedNote = "";
        if (!string.IsNullOrWhiteSpace(ask.MissRoute) && Ferries.Find(ask.MissRoute) is { } missed)
        {
            var at = every.Select(x => Departure(x.Plan, missed)).Where(d => d != null).OrderBy(d => d!.Value.At).FirstOrDefault();
            if (at is var (dep, name))
            {
                req.MissedSailings = new Dictionary<string, DateTime> { [missed.Id] = dep };
                every.Clear();
                best = Crossings.PlanBest(s, req, truck, every);
                missedNote = $"Without the {GameClock.Pretty(GameClock.Format(dep))} {name} sailing. ";
            }
        }

        static int Rank(string v) => v == "Feasible" ? 0 : v == "Tight" ? 1 : 2;
        static DateTime Arrives(FeasibilityResult p) => GameClock.TryParse(p.ProjectedArrivalGameTime) ?? DateTime.MaxValue;
        var options = every.GroupBy(x => x.Via).Select(g => g.First())
            .OrderBy(x => Rank(x.Plan.Verdict)).ThenBy(x => Arrives(x.Plan)).ToList();
        // Within a few hours of the soonest, the way with the least driving: an hour or two at the gate is not worth a
        // day at the wheel. Kokkola to Groningen came out 1:25 sooner over Naantali, for 860 km and 11 hours more
        // driving than the Helsinki boat — the arithmetic said Naantali, the driver would not.
        var close = options.Count > 0 && options[0].Plan.Verdict != "Infeasible"
            ? options.Where(o => Rank(o.Plan.Verdict) == Rank(options[0].Plan.Verdict)
                                 && (Arrives(o.Plan) - Arrives(options[0].Plan)).TotalHours <= CloseEnoughHours).ToList()
            : new();
        var lessDriving = close.Count > 1 ? close.MinBy(o => o.Plan.DriveHours) : default;
        if (lessDriving.Plan is { } calmer && !ReferenceEquals(calmer, options[0].Plan)
            && options[0].Plan.DriveHours - calmer.DriveHours >= 2)
        {
            calmer.Warnings.Insert(0, $"{options[0].Via[0].ToString().ToUpper()}{options[0].Via[1..]} gets there " +
                $"{Hhmm.Of((Arrives(calmer) - Arrives(options[0].Plan)).TotalHours)} sooner, but with " +
                $"{Hhmm.Of(options[0].Plan.DriveHours - calmer.DriveHours)} more driving — not worth it.");
            best = calmer;
            options = options.OrderBy(o => ReferenceEquals(o.Plan, best) ? 0 : 1).ToList();
        }
        else best = options.Count > 0 ? options[0].Plan : best;
        var lines = options.Select(o =>
        {
            var p = o.Plan;
            var gate = Arrives(p) == DateTime.MaxValue ? "no arrival worked out" : $"at the receiver {GameClock.Pretty(p.ProjectedArrivalGameTime)}";
            var slack = p.Verdict == "Infeasible"
                ? p.Blockers.FirstOrDefault() ?? "not deliverable"
                : $"{Hhmm.Of(p.SlackHours)} to spare";
            var chosen = ReferenceEquals(p, best) ? "BEST — " : "";
            return $"{chosen}{char.ToUpper(o.Via[0])}{o.Via[1..]}: {gate}, {Units.Distance(p.TotalMiles)} of road, " +
                   $"{Hhmm.Of(p.DriveHours)} driving — {slack}";
        }).ToList();

        var here = DispatchEngine.Place(city, cc);
        var head = best.Verdict == "Infeasible"
            ? $"From {here} at {GameClock.Pretty(GameClock.Format(now))} no way gets {trip.Number} there in time. " +
              (best.Blockers.FirstOrDefault() ?? "") + " Tell operations now, not at the gate."
            : $"From {here} at {GameClock.Pretty(GameClock.Format(now))}: " +
              (best.CrossingRoutes.Count > 0 ? string.Join("; ", best.Crossings) : "by road, no crossing.") +
              $" At the receiver {GameClock.Pretty(best.ProjectedArrivalGameTime)}, {Hhmm.Of(best.SlackHours)} to spare.";
        trip.Replan = best;
        trip.ReplanGameTime = GameClock.Format(now);
        trip.ReplanOptions = lines;
        trip.Events.Add(new TripEvent
        {
            GameTime = GameClock.Format(now), Kind = "Note", City = city, State = cc,
            Detail = $"Re-planned. {missedNote}{head}",
        });
        return new { headline = missedNote + head, options = lines, plan = best };
    }

    /// <summary>The rest of the load, as a plan request from here: the pickup still to do if it is, then the run in.</summary>
    private static PlanRequest Build(AppState s, Trip trip, string city, string cc, DateTime now)
    {
        var loaded = trip.LoadedReported || trip.Events.Any(e => e.Kind == "EndLoad");
        var truck = DispatchEngine.AssignedTruck(s);
        double Road(string? a, string? ac, string? b, string? bc) =>
            Geo.RoadDetour(a, ac, b, bc)?.Miles ?? Geo.MilesBetween(a, ac, b, bc) ?? 0;
        double? Until(string? t) => GameClock.TryParse(t) is { } at ? (at - now).TotalHours : null;

        var req = new PlanRequest
        {
            FromCity = city, FromState = cc,
            OriginCity = loaded ? city : trip.OriginCity,
            OriginState = loaded ? cc : trip.OriginState,
            DeadheadMiles = loaded ? 0 : Road(city, cc, trip.OriginCity, trip.OriginState),
            LoadingHours = loaded ? 0 : trip.LoadingHours,
            // From the shipper, the listing's own distance still stands; from anywhere else on the road, the road.
            LoadedMiles = loaded ? Road(city, cc, trip.DestCity, trip.DestState) : trip.DispatchedMiles,
            DestCity = trip.DestCity, DestState = trip.DestState,
            UnloadingHours = trip.UnloadingHours,
            TrailerType = trip.TrailerType,
            StartGameTime = GameClock.Format(now),
            UsableFuelRangeMiles = HosEngine.UsableRange(s.Settings, truck, s.Status.FuelPct),
            DeadlineHours = Math.Max(0.1, Until(trip.DueGameTime) ?? 24 * 14),
            AppointmentOpensHours = Math.Max(0, Until(trip.AppointmentOpensGameTime) ?? 0),
            WaitUntilHours = !trip.ReceiverTakesEarly && Until(trip.AppointmentGameTime) is { } slot && slot > 0 ? slot : 0,
            Label = trip.Number,
        };
        return req;
    }

    /// <summary>When a plan has the truck leave on this route, or null where it does not take it.</summary>
    private static (DateTime At, string Name)? Departure(FeasibilityResult plan, Ferries.Route r)
    {
        if (!plan.CrossingRoutes.Contains(r.Id)) return null;
        var step = plan.Timeline.FirstOrDefault(t => t.Kind is "Crossing" or "Rest" or "Restart"
                                                     && t.Label.Contains(r.A) && t.Label.Contains(r.B)
                                                     && (t.Label.StartsWith("Ferry") || t.Label.StartsWith("Channel")));
        // The step names the crossing the way the truck goes ("Ferry Helsinki – Travemünde — 29:00 ...").
        var name = step?.Label.Split(" — ")[0].Replace("Ferry ", "") ?? r.Label;
        return step != null && GameClock.TryParse(step.StartGameTime) is { } at ? (at, name) : null;
    }
}
