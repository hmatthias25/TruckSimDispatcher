using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The hours-of-service plan for one board load: dock time for what is hooked, the run to the shipper, the
/// loaded leg, the receiver's window and any booked slot, planned through <see cref="Crossings.PlanBest"/>.
///
/// <para>Lifted out of <see cref="DispatchEngine.Evaluate"/> unchanged, so the owner/operator app can plan a
/// load without going through the company dispatcher. Evaluate calls it and goes on to score and police the
/// result; the owner/operator app calls it and goes on to price it. See docs/owner-operator-plan.md.</para>
/// </summary>
public static class LoadPlanner
{
    /// <summary>What Evaluate goes on to use from the planning, besides what is written onto the evaluation.</summary>
    public record Planned(
        (double Loading, double Unloading, int Samples, bool Learned) Dock,
        FacilityProfile.Profile DockKind,
        bool Booked,
        double QuotedDeadhead,
        double? GuessedDeadhead,
        bool StaleLooking);

    /// <summary>
    /// Plans the load and writes the result onto <paramref name="e"/>: <c>Feasibility</c>, <c>BookedSlotHours</c>,
    /// and a con where the plan only works by walking straight in.
    /// </summary>
    public static Planned Plan(AppState s, BoardLoad load, Truck? truck, Trailer? trailer, LoadEvaluation e)
    {
            // ---- HOS feasibility
            var fuelRange = HosEngine.UsableRange(s.Settings, truck, s.Status.FuelPct);
            // Dock time for whatever is actually hooked, not one figure for every trailer on the map.
            // On drop and hook there is no dock time at either end — you back under what is there and pull the
            // pin at the other. The listing still names a real trailer type, and reading the dock table by it
            // booked a full live unload against a job that is a hook: up to three hours of window spent on
            // paper that the driver was never going to spend, which is enough to plan a reset that is not
            // needed or refuse a load that is comfortably legal. The loading end was already handled through
            // PreLoaded; this is the other one.
            var dock = FacilityLearning.For(s, DispatchEngine.DockTrailerType(s, load, trailer));

            // Every load off a facility's own board is LIVE LOADED, whatever is on the back.
            //
            // This used to believe that a dry van or a reefer taken off the local board came hooked to an
            // already-loaded trailer, and only a flatbed had to be loaded — so those two were planned at a
            // twenty-five minute hook instead of a dock estimate. Reported from play as wrong: in ATS you
            // unload, and if you then take a load from the same facility you go and load it like anybody
            // else. The trailer type never mattered.
            //
            // Drop and hook is the real exception and is not this one: there the trailer belongs to the
            // shipper and is already loaded, and `dock` is already the hook time because FacilityLearning
            // reads it off the Drop & Hook slot rather than the freight.
            var pickupHours = dock.Loading;

            // What kind of place this is going to, which decides what waiting even looks like. A warehouse
            // books a slot and runs all night; a job site takes it whenever, but only while somebody is there.
            var dockKind = FacilityProfile.For(s, load,
                string.IsNullOrWhiteSpace(load.TrailerType) ? trailer?.Type : load.TrailerType);

            // Sites are mostly not booked, and an unbooked one waits on opening hours instead of a slot. The
            // minority that ARE booked behave like a dock for this purpose: somebody is expecting the truck at
            // a stated time, so there is no gate to queue at and no morning to wait for.
            var takesEarly = DeliveryWindow.TakesEarly(s, load, dockKind.TakesEarlyPct);

            // Whether anybody booked this truck in. Unbooked means any hour inside the stated window works;
            // booked means a slot somewhere inside it that the driver is expected to hit.
            var booked = !takesEarly && load.AppointmentOpensHours > 0;

            // Our own reading of a working day is the BACKSTOP, not the authority. Where the game stated a
            // window that window is when they are open, and printing a seeded 07:00-16:00 against a stated
            // 17:16-23:57 is the app arguing with the only fact it has. Reported from play in exactly those
            // terms — "someone has to be there between 8AM and 3PM makes no sense when we have a dropoff
            // range indicated that can be out of this range."
            var siteHours = dockKind.Kind == FacilityProfile.Kind.Site
                            && takesEarly
                            && load.AppointmentOpensHours <= 0;

            // The run to the shipper, when the listing does not quote one and the driver is not standing on
            // it. ATS very often quotes nothing, and the clocks the driver typed in were read wherever they
            // were when they read them — so planning zero is not neutral, it is wrong in one direction every
            // time, and it understates the hours by exactly the run nobody counted. Reported from play as
            // 18:21 of plan against 19:08 of cycle, with forty miles to the shipper that were in neither
            // figure; the driver's own note was that there was no way for the app to know it, which is true
            // of the exact distance and not of the fact that there IS one.
            //
            // Estimated off the city coordinates with a road factor — the measured path in Geo, not the
            // state-centroid fallback — and labelled as an estimate wherever it shows. Where the city is not
            // in the table at all, which means a map mod, nothing is invented: the plan stays as the listing
            // stated it and the driver is told the run is missing from it.
            //
            // PLANNING ONLY. It does not touch the deadhead ratio or the scoring, because a load refused on
            // an estimated distance is a refusal the app made up, and it does not touch what gets booked —
            // empty miles are measured off the odometer at the shipper and always have been.
            // Both towns have to be ones we actually have coordinates for. MilesBetween falls back to a flat
            // 130 miles for an unknown city in a known state, which is fine for "is this load heading home"
            // and is not fine here: it would plan two hours of driving nobody can check into a trip, off a
            // map mod's town name. Geo.Knows is the difference between a measurement and a placeholder.
            var quoted = load.DeadheadMiles;
            double? guessedDeadhead = null;
            if (quoted <= 0 && !load.AtLocation && !string.IsNullOrWhiteSpace(load.OriginCity)
                && Geo.Knows(s.Status.LocationCity, s.Status.LocationState)
                && Geo.Knows(load.OriginCity, load.OriginState))
                guessedDeadhead = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState,
                                                   load.OriginCity, load.OriginState);

            // And it has to be a plausible hop. Past a couple of hundred miles the likelier explanation is
            // not that the driver is about to deadhead across two states to get under a load — it is that the
            // position on file is stale, because they moved and entered a board for where they are now
            // without reporting in first. Planning the gap then is worse than planning nothing: it invents
            // most of a day's driving out of a reading nobody updated. Said as what it probably is instead.
            const double plausibleRepositionMiles = 250;
            var staleLooking = guessedDeadhead is { } far && far > plausibleRepositionMiles;
            if (staleLooking) guessedDeadhead = null;

            var planDeadhead = quoted > 0 ? quoted : Math.Max(0, guessedDeadhead ?? 0);

            // The loaded leg: where the driver has run this road and the odometer said it was longer than the listing, the
            // plan runs on what they drove. Reported from play: a mileage that came up short, and the appointment missed.
            var routeFrom = (City: string.IsNullOrWhiteSpace(load.OriginCity) ? s.Status.LocationCity : load.OriginCity,
                          State: string.IsNullOrWhiteSpace(load.OriginState) ? s.Status.LocationState : load.OriginState);
            var driven = RoadLearning.Known(routeFrom.City, routeFrom.State, load.DestCity, load.DestState);
            var plannedLoaded = driven is { } dv && dv > load.LoadedMiles * 1.05 ? dv : load.LoadedMiles;
            var routeNote = plannedLoaded > load.LoadedMiles
                ? $"Planned at {Units.Distance(plannedLoaded)} — what you actually drove {DispatchEngine.Place(routeFrom.City, routeFrom.State)} to " +
                  $"{DispatchEngine.Place(load.DestCity, load.DestState)} before, off the odometer. The listing says {Units.Distance(load.LoadedMiles)}."
                : "";

            // How long getting to the shipper really takes, off the driver's own pickups (PickupLearning). A listed or
            // measured leg runs at the speed those legs make; a shipper with no distance at all, in the town the truck is
            // in, is not where the truck stands — it gets the time pickups here usually take. Reported from play: a city
            // board load an hour and forty minutes across town, planned as no time at all, and delivered late.
            var pickupMph = planDeadhead > 0 ? PickupLearning.ListedPickupMph(s) : null;
            var pickup = !load.AtLocation && planDeadhead <= 0.5
                ? PickupLearning.PlannedUnlistedPickup(s, load, string.IsNullOrWhiteSpace(load.OriginCity) ? s.Status.LocationCity : load.OriginCity,
                                               string.IsNullOrWhiteSpace(load.OriginState) ? s.Status.LocationState : load.OriginState)
                : null;

            var planReq = new PlanRequest
            {
                // Where the legs run, so an ETS2 plan can find the water in the way. See Crossings.
                OriginCity = string.IsNullOrWhiteSpace(load.OriginCity) ? s.Status.LocationCity : load.OriginCity,
                OriginState = string.IsNullOrWhiteSpace(load.OriginState) ? s.Status.LocationState : load.OriginState,
                DestCity = load.DestCity,
                DeadheadMiles = planDeadhead,
                DeadheadIsEstimate = quoted <= 0 && planDeadhead > 0.5,
                DeadheadMph = pickupMph?.Mph ?? 0,
                PickupHours = pickup?.Hours ?? 0,
                PickupMiles = pickup is { } pk ? pk.Hours * (PickupLearning.ListedPickupMph(s)?.Mph ?? 30) : 0,
                PickupNote = pickup is { } pn
                    ? $"No distance to the shipper on the listing, so getting there is planned at {Hhmm.Of(pn.Hours)} — {pn.Basis}. " +
                      "If this one is further, put the distance on the load and I will plan it properly."
                    : "",
                LoadedMiles = plannedLoaded,
                RouteNote = routeNote,
                LoadingHours = pickupHours,
                UnloadingHours = dock.Unloading,
                // What is on the back decides whether the dock is duty or rest. A van waits, a flatbed works.
                TrailerType = trailer?.Type ?? load.TrailerType ?? "",
                // How much that unload figure is worth. A seed table and ten measured deliveries are not the
                // same number and should not be trusted to the same margin.
                DockSamples = dock.Samples,
                // An hour more buffer for a pickup somewhere inside a tier-one market, and only off the
                // city board — at the dock the truck is already where the freight is. See PlanRequest.
                WideMarketPickup = !load.AtLocation
                    && Markets.Find(s, load.OriginCity ?? "", load.OriginState ?? "")?.Tier == 1,
                NavEstimateHours = load.NavEstimateHours,
                ExtraStops = load.ExtraStops,
                DeadlineHours = load.DeadlineHours,
                // Which clock the arrival, the window and the slot should be quoted on. Only consulted with
                // the game's time zones switched on.
                DestState = load.DestState,
                // The window opening stays a fact off the load, whatever the receiver has agreed to.
                AppointmentOpensHours = load.AppointmentOpensHours,

                // What the plan actually waits for: the booked slot, or nothing where they will take it
                // whenever it turns up.
                //
                // The odds of being booked are now the receiver's rather than the fleet's. One flat 12% said
                // every customer in the country books nearly every load, which is true of a grocery DC and
                // nonsense at a bridge job — see FacilityProfile.TakesEarlyPercent.
                //
                // A site with a real window off the listing waits for the window to OPEN and then goes
                // straight in — that is the whole difference from a dock, which holds you to a slot booked
                // somewhere inside the same range. So it takes the opening directly rather than a slot, and
                // rather than the daily opening hours below: the game gave a moment in time, and a moment in
                // time is not a clock reading that repeats every morning. Collapsing it into one turned a
                // 1,004-mile run the game was perfectly happy with into an infeasible load.
                //
                // An unbooked site waits for nothing at dispatch: it waits for the morning, and that is the
                // SiteOpenHour below. The game's delivery range is its deadline, not its working day — a
                // flatbed job listed 16:04 to 22:04 does not mean the site is open in the evening.
                //
                // Nobody takes it before the window opens — the game said when that is, and the card has said
                // so all along. What the booking changes is only what happens INSIDE the window: a slot to hit,
                // or a gate you can roll through at any hour of it.
                //
                // This read 0 for every unbooked load, which is how a tanker with a window opening at 17:16
                // was planned as though the plant would take it at four in the morning.
                WaitUntilHours = siteHours
                    ? 0
                    : booked
                        ? DispatchEngine.AppointmentHoursFor(s, load)
                        : Math.Max(0, load.AppointmentOpensHours),

                // And a site with NO window is the case that used to plan as though the place never closed.
                // Here the app is guessing, so it may only hold a driver until the morning of the day they
                // get there — the reported case of rolling up to a job site at 3am with nobody about.
                SiteOpenHour = siteHours ? dockKind.OpenHour : -1,
                SiteCloseHour = siteHours ? dockKind.CloseHour : -1,
                SiteQueuePeakHours = siteHours ? dockKind.QueuePeak : 0,
                SiteHoursAreGuess = siteHours && dockKind.HoursAreGuess,
                ReceiverAllowsOvernight = Facilities.AllowsOvernightParking(
                    s, load.DestCity, load.DestState, load.Receiver),
                ShipperAllowsOvernight = Facilities.AllowsOvernightParking(
                    s, string.IsNullOrWhiteSpace(load.OriginCity) ? s.Status.LocationCity : load.OriginCity,
                    string.IsNullOrWhiteSpace(load.OriginState) ? s.Status.LocationState : load.OriginState,
                    load.Shipper),
                UsableFuelRangeMiles = fuelRange,
                StartGameTime = s.Status.GameTime,
                Label = load.Cargo
            };

            // ETS2: every way across the water tried and the best kept. Anything else plans as it always did.
            e.Feasibility = Crossings.PlanBest(s, planReq, truck);

            // ---- the appointment, booked where the truck can actually be
            //
            // A booked slot is what the delivery is graded against, so it is what the plan has to aim at — and a
            // dispatcher books one the driver can make. The slot used to be chosen first and the plan made to wait
            // for it, so a slot at the opening that the driver's rest could not reach was booked anyway and the
            // plan came out the far side of the rest hours after its own appointment. Reported from play: Mannheim
            // to Innsbruck booked for 02:07, the opening, against a rest that had the driver ready at 04:20.
            //
            // So: the earliest the plan can stand at the gate, waiting for nothing but the doors to open. Where
            // that is after the slot, the slot moves to it, and the plan is redone against the slot booked.
            if (booked && load.AppointmentOpensHours > 0 && GameClock.TryParse(s.Status.GameTime) is { } bookNow)
            {
                var seeded = planReq.WaitUntilHours;
                var slotHours = seeded;
                planReq.WaitUntilHours = Math.Max(0, load.AppointmentOpensHours);
                var earliest = Math.Abs(planReq.WaitUntilHours - seeded) < 0.01 ? e.Feasibility : Crossings.PlanBest(s, planReq, truck);
                var nowThere = GameZones.AtReceiver(s, bookNow, load.DestState);
                if (DispatchEngine.GateArrivalOf(earliest) is { } gate && GameClock.TryParse(earliest.DueGameTime) is { } dueThere)
                {
                    var reachable = DeliveryWindow.NextHalfHour(gate);
                    var reachableHours = (reachable - nowThere).TotalHours;
                    if (reachableHours > seeded + 0.01 && reachable <= dueThere) slotHours = Math.Round(reachableHours, 2);
                }
                planReq.WaitUntilHours = slotHours;
                if (Math.Abs(slotHours - seeded) > 0.01)
                {
                    var atSlot = Crossings.PlanBest(s, planReq, truck);
                    // A half hour of rounding is a nicety; it does not get to cost the load. Where it would, the
                    // slot is the minute the plan gets there.
                    if (DispatchEngine.VerdictRank(atSlot.Verdict) < DispatchEngine.VerdictRank(earliest.Verdict) && DispatchEngine.GateArrivalOf(earliest) is { } exact)
                    {
                        slotHours = Math.Round((exact - nowThere).TotalHours, 2);
                        planReq.WaitUntilHours = slotHours;
                        atSlot = earliest;
                    }
                    e.Feasibility = atSlot;
                }
                e.BookedSlotHours = slotHours;
            }

            // When a site opens, and how long the queue at its gate runs, are the app's reading of the world
            // rather than anything the game said. They are allowed to cost the driver hours. They are not
            // allowed to be the reason a load ATS called deliverable comes back refused — that is a guess
            // overruling a fact, which is the one thing this app does not do anywhere else.
            //
            // Reported while building it: a 1,004-mile flatbed to Tulsa went Infeasible by 1.2 minutes on a
            // derived opening time. So where dropping our own reading makes it legal again, the load is legal
            // again and the reading becomes what it always was — a warning about a tight afternoon.
            if (e.Feasibility.Verdict == "Infeasible"
                && dockKind.Kind == FacilityProfile.Kind.Site
                && (planReq.WaitUntilHours > 0 || planReq.SiteQueuePeakHours > 0))
            {
                planReq.WaitUntilHours = 0;
                planReq.SiteQueuePeakHours = 0;
                planReq.SiteOpenHour = -1;
                planReq.SiteCloseHour = -1;

                var straightIn = Crossings.PlanBest(s, planReq, truck);
                if (straightIn.Verdict != "Infeasible")
                {
                    e.Feasibility = straightIn;
                    // Walking straight in has no slot of ours in it; the one stated is whatever the plan reaches.
                    e.BookedSlotHours = 0;
                    e.Cons.Add(
                        "This only works if you walk straight in. On our reading of when they open and how " +
                        "busy the gate is it does not make the deadline — but that reading is ours, not the " +
                        "game's, and I am not refusing a load ATS says is deliverable on the strength of it. " +
                        "Ring ahead if you can.");
                }
            }

        return new Planned(dock, dockKind, booked, quoted, guessedDeadhead, staleLooking);
    }
}
