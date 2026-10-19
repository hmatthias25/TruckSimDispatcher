using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// The run itself, on Core's trip log: the booked load as a <see cref="Trip"/>, the shipper and the receiver, the
/// events along the way, and what the delivery teaches the planner (speed, dock times, roads). The company-driver
/// app's pay, ledger, probation and fleet steps are not called; see the plan, "Move first, untangle later".
/// </summary>
public static class Run
{
    public static Trip? Trip(OoCareer c, Booking? k) =>
        k == null || string.IsNullOrWhiteSpace(k.TripId) ? null : c.Game.Trips.FirstOrDefault(t => t.Id == k.TripId);

    public static Trip Active(OoCareer c) =>
        Trip(c, Calls.ActiveBooking(c)) ?? throw new InvalidOperationException("Nothing is booked. Book a load first.");

    /// <summary>The booked load as a trip on Core's log, planned as it stands now.</summary>
    public static Trip Open(OoCareer c, Booking k)
    {
        var s = c.Game;
        var truck = DispatchEngine.AssignedTruck(s);
        var trailer = DispatchEngine.AssignedTrailer(s);
        var load = k.Load;
        var e = new LoadEvaluation { Load = load };
        var planned = LoadPlanner.Plan(s, load, truck, trailer, e);

        var trip = new Trip
        {
            Number = k.Number,
            Kind = "Freight",
            Status = "Authorized",
            Cargo = load.Cargo,
            Division = string.IsNullOrWhiteSpace(load.TrailerType) ? "Power only" : load.TrailerType,
            TrailerType = trailer?.Type ?? load.TrailerType ?? "",
            FreightTrailerType = load.TrailerType ?? "",
            Shipper = load.Shipper,
            OriginCity = string.IsNullOrWhiteSpace(load.OriginCity) ? s.Status.LocationCity : load.OriginCity,
            OriginState = string.IsNullOrWhiteSpace(load.OriginState) ? s.Status.LocationState : load.OriginState,
            Receiver = load.Receiver,
            DestCity = load.DestCity,
            DestState = load.DestState,
            WeightLbs = load.WeightLbs,
            DispatchedMiles = load.LoadedMiles,
            DeadheadMiles = load.DeadheadMiles,
            GameRevenue = load.GameRevenue,
            CompanyRevenue = k.Rate,
            DispatchedGameTime = s.Status.GameTime,
            DueGameTime = e.Feasibility.DueGameTime,
            DeadlineHoursAtDispatch = load.DeadlineHours,
            StartOdometer = s.Status.AtsOdometer,
            DispatchOdometer = s.Status.AtsOdometer,
            DispatchCity = s.Status.LocationCity,
            DispatchState = s.Status.LocationState,
            TruckUnit = truck?.Unit ?? "",
            TrailerUnit = trailer?.Unit ?? "",
            LoadingHours = planned.Dock.Loading,
            UnloadingHours = planned.Dock.Unloading,
            ExtraStops = load.ExtraStops,
            IsHazmat = load.IsHazmat,
            HazmatClass = load.HazmatClass,
            // The receiver's side, set exactly as company dispatch sets it: when the window opens, whether they take it
            // whenever it turns up, and (below) the slot booked inside the window.
            AppointmentOpensGameTime = DispatchEngine.ReceiverOpens(s, load),
            ReceiverTakesEarly = DispatchEngine.ReceiverTakesEarly(s, load),
            FeasibilityAtDispatch = e.Feasibility,
            AuthorizationRationale = $"Booked with {k.BrokerName} at {Units.Money(k.Rate)}.",
        };
        DispatchEngine.BookSlot(s, trip, load, e);
        s.Trips.Insert(0, trip);
        s.Status.ActiveTripId = trip.Id;
        k.TripId = trip.Id;
        return trip;
    }

    private static DateTime At(OoCareer c, int? day, string? time)
    {
        if (day is > 0) return GameClock.FromDayTime(day.Value, time) ?? throw new InvalidOperationException("The time of day, as HH:MM.");
        return GameClock.TryParse(c.Game.Status.GameTime) ?? throw new InvalidOperationException("The game day and time.");
    }

    /// <summary>At the shipper: whether the load is ready, rolled once, as the company-driver app does.</summary>
    public static (string Said, ReceiverCall.Call Call) AtShipper(OoCareer c, int? day, string? time)
    {
        var trip = Active(c);
        if (!string.IsNullOrWhiteSpace(trip.ShipperArrivedGameTime))
            throw new InvalidOperationException($"Already at the shipper from {GameClock.Pretty(trip.ShipperArrivedGameTime)}.");
        var at = At(c, day, time);
        var call = ShipperCall.Assess(c.Game, trip, at)!;
        ShipperCall.Record(trip, call);
        c.Game.Status.GameTime = GameClock.Format(at);
        var said = $"{trip.Number}: at the shipper {GameClock.Pretty(trip.ShipperArrivedGameTime)}. {call.Headline}. {call.Instruction}";
        OoStore.Log(c, "run", said, trip.Number);
        return (said, call);
    }

    /// <summary>Loaded and pulling out: weight, the odometer at the shipper, and when.</summary>
    public static List<string> Loaded(OoCareer c, double? weight, double? odometer, int? day, string? time)
    {
        var trip = Active(c);
        var pulled = day is > 0 ? GameClock.Format(At(c, day, time)) : null;
        var (_, notes) = TripService.ReportLoaded(c.Game, trip.Id, weight, null, odometer, pulled);
        OoStore.Log(c, "run", $"{trip.Number} loaded and rolling.", trip.Number);
        return notes;
    }

    /// <summary>Something along the way: a break, a rest, fuel, the dock work. Core's log, unchanged.</summary>
    public static void Event(OoCareer c, RunEventRequest r)
    {
        var trip = Active(c);
        var kinds = new[] { "BeginLoad", "EndLoad", "BeginUnload", "EndUnload", "Fuel", "Break", "Rest", "Scale", "Delay", "Breakdown", "Note" };
        var kind = kinds.FirstOrDefault(k => k.Equals(r.Kind ?? "", StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("What happened: the dock work, fuel, a break, a rest, a scale, a delay, a breakdown, or a note.");
        var at = At(c, r.Day, r.Time);
        string end = "";
        if (r.EndDay is > 0) end = GameClock.Format(GameClock.FromDayTime(r.EndDay.Value, r.EndTime) ?? throw new InvalidOperationException("When it ended, as HH:MM."));
        else if (r.Hours is > 0) end = GameClock.Format(at.AddHours(r.Hours.Value));
        if (kind is "Break" or "Rest" && end.Length == 0)
            throw new InvalidOperationException("When it ended, or how long it was.");
        TripService.LogEvent(c.Game, trip.Id, new TripEvent
        {
            Kind = kind,
            GameTime = GameClock.Format(at),
            EndGameTime = end,
            Detail = string.IsNullOrWhiteSpace(r.Detail) ? kind : r.Detail,
            City = r.City ?? "",
            State = (r.State ?? "").ToUpperInvariant(),
            Gallons = r.Gallons ?? 0,
            PricePerGal = r.PricePerGal ?? 0,
        });
        if (!string.IsNullOrWhiteSpace(r.City)) BrokerBook.Refresh(c);
    }

    /// <summary>Correcting or dropping an entry already logged, as the company-driver app does: Core re-derives what it fed.</summary>
    public static string Amend(OoCareer c, string eventId, AmendRequest r)
    {
        var trip = Active(c);
        string? Stamp(int? day, string? time) => day is > 0
            ? GameClock.Format(GameClock.FromDayTime(day.Value, time) ?? throw new InvalidOperationException("The time of day, as HH:MM."))
            : null;
        var (_, message, _) = TripService.AmendEvent(c.Game, trip.Id, eventId, Stamp(r.Day, r.Time), r.Detail, r.Remove, Stamp(r.EndDay, r.EndTime));
        OoStore.Log(c, "run", message, trip.Number);
        return message;
    }

    /// <summary>The delivery window read again off the job screen, where the one on the load was wrong.</summary>
    public static string CorrectWindow(OoCareer c, double deadlineHours, string? note)
    {
        var trip = Active(c);
        if (deadlineHours <= 0) throw new InvalidOperationException("The time to deliver, as h:mm off the job screen.");
        TripService.CorrectWindow(c.Game, trip.Id, deadlineHours, note ?? "");
        if (Calls.ActiveBooking(c) is { } k) k.Load.DeadlineHours = deadlineHours;
        var said = $"{trip.Number}: window corrected, due {GameClock.Pretty(trip.DueGameTime)}.";
        OoStore.Log(c, "run", said, trip.Number);
        return said;
    }

    /// <summary>At the receiver: straight in, or a wait for a door, rolled once.</summary>
    public static (string Said, ReceiverCall.Call? Call) Arrived(OoCareer c, int? day, string? time)
    {
        var trip = Active(c);
        if (!string.IsNullOrWhiteSpace(trip.ArrivedGameTime))
            throw new InvalidOperationException($"Already at the receiver from {GameClock.Pretty(trip.ArrivedGameTime)}.");
        var at = At(c, day, time);
        var call = ReceiverCall.Assess(c.Game, trip, at);
        trip.ArrivedGameTime = GameClock.Format(at);
        trip.ReceiverCallKind = call?.Kind ?? "StraightIn";
        trip.WorkStartsGameTime = call?.WorkStartsGameTime ?? GameClock.Format(at);
        trip.ReceiverCallNote = call?.Instruction ?? (DropHook.Is(trip.TrailerType)
            ? "Nothing to wait for: drop it and close the load out."
            : "Nothing to wait for. Log Begin unload now and get it off.");
        trip.QueuePosition = call?.Position ?? 0;
        c.Game.Status.GameTime = GameClock.Format(at);
        var said = $"{trip.Number}: arrived {GameClock.Pretty(trip.ArrivedGameTime)}. {(call == null ? trip.ReceiverCallNote : call.Headline + ". " + call.Instruction)}";
        OoStore.Log(c, "run", said, trip.Number);
        return (said, call);
    }

    /// <summary>
    /// The rest of the run, planned from where the truck is now on the clocks just reported: the miles left, the
    /// dock work left, against the time left before the window shuts. Null where there is nothing left to plan (not
    /// booked, or already at the receiver).
    /// </summary>
    public static FeasibilityResult? FromHere(OoCareer c)
    {
        var k = Calls.ActiveBooking(c);
        var trip = Trip(c, k);
        var s = c.Game;
        if (k == null || trip == null || !string.IsNullOrWhiteSpace(trip.ArrivedGameTime)) return null;
        if (GameClock.TryParse(s.Status.GameTime) is not { } now || GameClock.TryParse(k.BookedGameTime) is not { } booked) return null;

        var loaded = trip.LoadedReported || trip.Events.Any(e => e.Kind == "EndLoad");
        var started = loaded || !string.IsNullOrWhiteSpace(trip.ShipperArrivedGameTime);
        var leftLoaded = MilesLeft(c, trip, loaded);
        var toShipper = !started && Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, trip.OriginCity, trip.OriginState) is { } d
                        && !s.Status.LocationCity.Equals(trip.OriginCity, StringComparison.OrdinalIgnoreCase) ? d : 0;
        var opens = k.Load.AppointmentOpensHours > 0 ? Math.Max(0, (booked.AddHours(k.Load.AppointmentOpensHours) - now).TotalHours) : 0;

        var req = new PlanRequest
        {
            OriginCity = loaded ? s.Status.LocationCity : trip.OriginCity,
            OriginState = loaded ? s.Status.LocationState : trip.OriginState,
            DestCity = trip.DestCity,
            DestState = trip.DestState,
            DeadheadMiles = toShipper,
            DeadheadIsEstimate = toShipper > 0,
            LoadedMiles = leftLoaded,
            LoadingHours = loaded ? 0 : trip.LoadingHours,
            UnloadingHours = trip.UnloadingHours,
            TrailerType = trip.TrailerType,
            ExtraStops = trip.ExtraStops,
            DeadlineHours = Math.Max(0, (booked.AddHours(k.Load.DeadlineHours) - now).TotalHours),
            AppointmentOpensHours = opens,
            WaitUntilHours = opens,
            ReceiverAllowsOvernight = Facilities.AllowsOvernightParking(s, trip.DestCity, trip.DestState, trip.Receiver),
            // Already on duty once the run has started: the pre-trip is behind them.
            IncludePreTrip = !started,
            UsableFuelRangeMiles = HosEngine.UsableRange(s.Settings, DispatchEngine.AssignedTruck(s), s.Status.FuelPct),
            StartGameTime = s.Status.GameTime,
            Label = trip.Cargo,
        };
        return Crossings.PlanBest(s, req, DispatchEngine.AssignedTruck(s));
    }

    /// <summary>
    /// The loaded miles still to run. Off the odometer where one has been read since pulling out. Where not, and the truck
    /// has been reported somewhere other than the shipper, the share of the run still ahead of it by the map: the miles from
    /// here to the receiver over the miles from the shipper to it, applied to the listing. As a share rather than the map's
    /// own figure, because the game's roads are shorter than the real-world map (Austin to Beaumont lists under 200 mi).
    /// Reported from play: resting halfway with clocks and a position reported, and the whole run still planned ahead.
    /// </summary>
    public static double MilesLeft(OoCareer c, Trip trip, bool loaded)
    {
        var s = c.Game;
        if (!loaded) return trip.DispatchedMiles;
        if (trip.StartOdometer > 0 && s.Status.AtsOdometer > trip.StartOdometer)
            return Math.Max(0, trip.DispatchedMiles - (s.Status.AtsOdometer - trip.StartOdometer));
        var here = (City: s.Status.LocationCity, State: s.Status.LocationState);
        if (here.City.Equals(trip.OriginCity, StringComparison.OrdinalIgnoreCase) && here.State.Equals(trip.OriginState, StringComparison.OrdinalIgnoreCase))
            return trip.DispatchedMiles;
        if (here.City.Equals(trip.DestCity, StringComparison.OrdinalIgnoreCase) && here.State.Equals(trip.DestState, StringComparison.OrdinalIgnoreCase))
            return 0;
        if (Geo.EstimatedMiles(here.City, here.State, trip.DestCity, trip.DestState) is not { } ahead
            || Geo.EstimatedMiles(trip.OriginCity, trip.OriginState, trip.DestCity, trip.DestState) is not { } whole || whole <= 0)
            return trip.DispatchedMiles;
        return Math.Round(trip.DispatchedMiles * Math.Clamp(ahead / whole, 0, 1), 0);
    }

    /// <summary>
    /// Closing the run out, in the order the company-driver app's close-out takes (TripService.Complete), less what is
    /// the company's: no pay, no ledger, no fleet. What the driver reported, the dock times and detention off the log,
    /// what the run teaches the planner, the service result and whose fault a late was, the miles, and the truck, the
    /// clock and the clocks carried forward. Returns the summary shown after it.
    /// </summary>
    public static (TripAudit Audit, bool Late, string Fault) Close(OoCareer c, Booking k, Trip trip, DeliverRequest r, DateTime at)
    {
        var s = c.Game;
        var audit = new TripAudit { Trip = trip };
        var req = new CompleteTripRequest
        {
            DeliveredGameTime = GameClock.Format(at),
            GameTime = GameClock.Format(at),
            EndOdometer = r.Odometer ?? s.Status.AtsOdometer,
            CargoDamagePct = Math.Clamp(r.CargoDamagePct ?? 0, 0, 100),
            FuelPct = r.FuelPct is { } fuel ? Math.Clamp(fuel, 0, 100) : -1,
            HosDriveRemaining = r.Drive, HosShiftRemaining = r.Shift, HosBreakRemaining = r.Break, HosCycleRemaining = r.Cycle,
            TookYouGameTime = r.TookYou ?? "",
            ReleasedGameTime = r.Released ?? "",
            UnloadAlreadyRan = r.UnloadAlreadyRan == true,
            LoadingHours = r.LoadingHours ?? 0,
            UnloadingHours = r.UnloadingHours ?? 0,
            DetentionHours = r.DetentionHours ?? 0,
            DelayReason = r.DelayReason ?? "",
            FaultOverride = r.Fault ?? "",
            Notes = r.Notes ?? "",
            LocationKind = "Receiver",
        };

        // ---- what the driver reported. Arrival off the log where there is one: it is what the window is judged on.
        trip.DeliveredGameTime = TripService.ArrivalFromLog(trip, req.DeliveredGameTime, out var arrivalNote);
        if (arrivalNote != null) audit.ServiceFindings.Add(arrivalNote);
        var mileage = TripService.DeriveMiles(s, trip, 0, req.EndOdometer);
        trip.ActualMiles = mileage.LoadedMiles;
        trip.EndOdometer = req.EndOdometer;
        if (trip.StartOdometer <= 0 && mileage.StartOdometer > 0) trip.StartOdometer = mileage.StartOdometer;
        trip.CargoDamagePct = req.CargoDamagePct;
        if (!string.IsNullOrWhiteSpace(req.Notes))
            trip.Notes = string.IsNullOrWhiteSpace(trip.Notes) ? req.Notes : trip.Notes + " | " + req.Notes;

        // When they actually took you, where the app quoted a time at the gate: before the dock times, which run off it.
        if (GameClock.TryParse(req.TookYouGameTime) is { } saidTaken
            && GameClock.TryParse(trip.ArrivedGameTime) is { } gotThere && saidTaken >= gotThere)
        {
            var quoted = GameClock.TryParse(trip.WorkStartsGameTime);
            if (quoted == null || Math.Abs((saidTaken - quoted.Value).TotalHours) > 0.01)
                audit.ServiceFindings.Add($"You put them taking you at {GameClock.Pretty(GameClock.Format(saidTaken))}" +
                                          (quoted != null ? $", against the {GameClock.Pretty(quoted.Value)} I quoted at the gate" : "") +
                                          ". Going with yours: you were there.");
            trip.WorkStartsGameTime = GameClock.Format(saidTaken);
        }

        // ---- the dock times and detention, off the Begin/End pairs where they were logged
        var facility = TripService.DeriveFacilityTimes(s, trip, req.LoadingHours, req.UnloadingHours, req.DetentionHours);
        if (facility.LoadingHours > 0) trip.LoadingHours = facility.LoadingHours;
        if (facility.UnloadingHours > 0) trip.UnloadingHours = facility.UnloadingHours;
        trip.DetentionHours = facility.DetentionHours;
        audit.ServiceFindings.AddRange(facility.Explain);

        // ---- what the run teaches the planner: only measured times, as in the company-driver app
        var dockBefore = FacilityLearning.For(s, trip.TrailerType);
        if (facility.LoadDerived && !trip.PreLoaded
            && FacilityLearning.QuestionSpan(s, trip.TrailerType, facility.LoadingHours, "loading") is { } lq) audit.Warnings.Add(lq);
        if (facility.UnloadDerived
            && FacilityLearning.QuestionSpan(s, trip.TrailerType, facility.UnloadingHours, "unloading") is { } uq) audit.Warnings.Add(uq);
        var stay = FacilityLearning.Measured(s, trip);
        FacilityLearning.Record(s, trip.TrailerType,
            facility.LoadDerived && !trip.PreLoaded ? stay.Loading : null,
            facility.UnloadDerived ? stay.Unloading : null);
        if (SpeedLearning.Record(s, trip, DispatchEngine.AssignedTruck(s)) is { } learned) audit.ServiceFindings.Add(learned);
        else if (SpeedLearning.WhyNothingLearned(s, trip, DispatchEngine.AssignedTruck(s)) is { } quiet) audit.ServiceFindings.Add(quiet);
        var dockAfter = FacilityLearning.For(s, trip.TrailerType);
        if (Math.Abs(dockAfter.Loading - dockBefore.Loading) >= 0.05 || Math.Abs(dockAfter.Unloading - dockBefore.Unloading) >= 0.05)
        {
            var type = FacilityLearning.Normalise(trip.TrailerType).ToLowerInvariant();
            audit.ServiceFindings.Add($"Dock time for {type} updated: load {Hhmm.Of(dockBefore.Loading)} → {Hhmm.Of(dockAfter.Loading)}, " +
                                      $"unload {Hhmm.Of(dockBefore.Unloading)} → {Hhmm.Of(dockAfter.Unloading)}, now off {dockAfter.Samples} " +
                                      $"measured load(s). Every {type} run is planned on those from here.");
        }

        // ---- the service result, and whose fault a late was
        var late = TripService.DetermineLate(s, trip, req, out var serviceNote);
        trip.ServiceResult = late ? "Late" : "OnTime";
        audit.ServiceFindings.Add(serviceNote);
        if (trip.ReceiverTakesEarly && GameClock.TryParse(trip.DeliveredGameTime) is { } deliveredAt)
        {
            var against = GameClock.TryParse(trip.AppointmentGameTime) ?? GameClock.TryParse(trip.AppointmentOpensGameTime);
            trip.EarlyTakeHoursSaved = against is { } slot ? Math.Max(0, Math.Round((slot - deliveredAt).TotalHours, 2)) : 0;
            audit.ServiceFindings.Add(trip.EarlyTakeHoursSaved > 0.1
                ? $"The receiver took this one ahead of the appointment, {Hhmm.Of(trip.EarlyTakeHoursSaved)} early. Their call, so it counts as on time."
                : "The receiver had agreed to take this one whenever it arrived. It counts as on time.");
        }
        var (fault, why) = Fault(s, trip, req, late, k);
        trip.FaultAttribution = fault;
        audit.FaultAttribution = fault;
        audit.FaultRationale = why;

        // ---- the miles
        if (trip.DispatchedMiles > 0)
        {
            var variance = trip.ActualMiles - trip.DispatchedMiles;
            var pct = variance / trip.DispatchedMiles * 100;
            audit.MileageFindings.Add($"Listed {Units.Distance(trip.DispatchedMiles)}, ran {Units.Distance(trip.ActualMiles)} " +
                                      $"({Units.Dist(variance):+0;-0;0} {Units.DistUnit}, {pct:+0.#;-0.#;0}%).");
            if (pct > 12) audit.MileageFindings.Add("Out-of-route miles are high: a detour or a wrong turn costs fuel and hours.");
        }
        audit.MileageFindings.AddRange(mileage.Explain);
        audit.MileageFindings.AddRange(mileage.Warnings);
        audit.Warnings.AddRange(mileage.Warnings);
        if (trip.FeasibilityAtDispatch is { } f && GameClock.TryParse(trip.DeliveredGameTime) is { } del && DispatchEngine.GateArrivalOf(f) is { } proj)
        {
            var drift = (del - proj).TotalHours;
            audit.ServiceFindings.Add($"Planned to be at the gate {GameClock.Pretty(proj)}; you got there {GameClock.Pretty(del)} ({drift:+0.#;-0.#;0} h on the plan).");
        }

        trip.Status = "Delivered";
        trip.ClosedUtc = DateTime.UtcNow.ToString("o");
        foreach (var leg in RoadLearning.RecordTrip(s, trip))
            audit.ServiceFindings.Add($"Driven distance recorded: {leg}. That road is planned on it from now on.");

        // ---- the truck, the clock and the clocks, carried across the dock exactly as the company-driver app does
        if (r.Odometer is { } odo) s.Status.AtsOdometer = odo;
        TripService.CarryForward(s, trip, req, audit);
        s.Status.ActiveTripId = "";

        audit.Headline = !late ? $"{trip.Number} delivered on time."
            : fault == "Driver" ? $"{trip.Number} delivered late, and it is on your record with {k.BrokerName}."
            : $"{trip.Number} delivered late, but not on you.";
        return (audit, late, fault);
    }

    /// <summary>
    /// Whose fault a late was. Core's reading of the log decides most of it (a shipper that held the truck, the hours
    /// running out on a dock, what the driver said happened, or what they chose from the list); what Core calls the
    /// dispatcher's fault is the driver's here, because an owner/operator books their own freight.
    /// </summary>
    private static (string Fault, string Why) Fault(AppState s, Trip trip, CompleteTripRequest req, bool late, Booking k)
    {
        if (!late) return ("None", "");
        if (!string.IsNullOrWhiteSpace(req.FaultOverride))
            return req.FaultOverride switch
            {
                "Driver" => ("Driver", $"Yours, you said. {k.BrokerName} will remember it."),
                "Unavoidable" => ("Unavoidable", "Nobody's: traffic, weather, a dock that held you. Not on your record."),
                "Mechanical" => ("Mechanical", "The truck let you down. Not on your record; the Companion App has the repair."),
                "GameLimitation" => ("GameLimitation", "The game: a crash, a bug, a reload. Not on your record."),
                _ => ("Driver", $"Late, and on your record with {k.BrokerName}."),
            };
        var (fault, why) = TripService.AttributeFault(s, trip, req, late);
        if (fault == "Dispatcher")
        {
            var plan = trip.FeasibilityAtDispatch;
            return ("Driver", plan != null && (plan.Verdict == "Tight" || plan.SlackHours < plan.RequiredBufferHours)
                ? $"You booked it with {Hhmm.Of(plan.SlackHours)} of slack against a {Hhmm.Of(plan.RequiredBufferHours)} buffer. As your own " +
                  $"dispatcher, that one is yours, and {k.BrokerName} will remember it."
                : $"You booked it, and it did not make the window. That one is yours, and {k.BrokerName} will remember it.");
        }
        return (fault, why);
    }
}

public record AmendRequest(int? Day, string? Time, int? EndDay, string? EndTime, string? Detail, bool Remove);
public record WindowFixRequest(double DeadlineHours, string? Note);
public record RunEventRequest(string? Kind, int? Day, string? Time, int? EndDay, string? EndTime, double? Hours,
                              string? Detail, string? City, string? State, double? Gallons, decimal? PricePerGal);
public record RunStageRequest(int? Day, string? Time, double? WeightLbs, double? Odometer);
