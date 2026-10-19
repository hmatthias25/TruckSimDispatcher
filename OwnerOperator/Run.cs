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
            AppointmentOpensGameTime = GameClock.TryParse(s.Status.GameTime) is { } now && load.AppointmentOpensHours > 0
                ? GameClock.Format(now.AddHours(load.AppointmentOpensHours)) : "",
            ReceiverTakesEarly = e.ReceiverTakesEarly,
            FeasibilityAtDispatch = e.Feasibility,
            AuthorizationRationale = $"Booked with {k.BrokerName} at {Units.Money(k.Rate)}.",
        };
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
    public static string AtShipper(OoCareer c, int? day, string? time)
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
        return said;
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
        var kinds = new[] { "BeginLoad", "EndLoad", "BeginUnload", "EndUnload", "Break", "Rest", "Fuel", "Note" };
        var kind = kinds.FirstOrDefault(k => k.Equals(r.Kind ?? "", StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("What happened: begin or end loading, a break, a rest, fuel, or a note.");
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

    /// <summary>At the receiver: straight in, or a wait for a door, rolled once.</summary>
    public static string Arrived(OoCareer c, int? day, string? time)
    {
        var trip = Active(c);
        var at = At(c, day, time);
        var call = ReceiverCall.Assess(c.Game, trip, at);
        trip.ArrivedGameTime = GameClock.Format(at);
        trip.ReceiverCallKind = call?.Kind ?? "StraightIn";
        trip.WorkStartsGameTime = call?.WorkStartsGameTime ?? GameClock.Format(at);
        trip.ReceiverCallNote = call?.Instruction ?? "Nothing to wait for. Log Begin unload now and get it off.";
        trip.QueuePosition = call?.Position ?? 0;
        c.Game.Status.GameTime = GameClock.Format(at);
        var said = $"{trip.Number}: arrived {GameClock.Pretty(trip.ArrivedGameTime)}. {(call == null ? "Straight onto a door." : call.Headline + ". " + call.Instruction)}";
        OoStore.Log(c, "run", said, trip.Number);
        return said;
    }

    /// <summary>
    /// Closing the trip at delivery: the arrival from the log, the miles off the odometer, the dock times, and what
    /// the run teaches the planner. Returns the findings worth saying, and whether it was late by the clock.
    /// </summary>
    public static (List<string> Findings, bool? Late) Close(OoCareer c, Trip trip, DateTime at, double? odometer)
    {
        var s = c.Game;
        var said = new List<string>();
        trip.DeliveredGameTime = TripService.ArrivalFromLog(trip, GameClock.Format(at), out var arrivalNote);
        if (arrivalNote != null) said.Add(arrivalNote);
        var end = odometer ?? s.Status.AtsOdometer;
        var mileage = TripService.DeriveMiles(s, trip, 0, end);
        trip.ActualMiles = mileage.LoadedMiles;
        trip.EndOdometer = end;
        if (trip.StartOdometer <= 0 && mileage.StartOdometer > 0) trip.StartOdometer = mileage.StartOdometer;
        said.AddRange(mileage.Warnings);

        var facility = TripService.DeriveFacilityTimes(s, trip, 0, 0, 0);
        if (facility.LoadingHours > 0) trip.LoadingHours = facility.LoadingHours;
        if (facility.UnloadingHours > 0) trip.UnloadingHours = facility.UnloadingHours;
        trip.DetentionHours = facility.DetentionHours;
        var stay = FacilityLearning.Measured(s, trip);
        FacilityLearning.Record(s, trip.TrailerType,
            facility.LoadDerived && !trip.PreLoaded ? stay.Loading : null,
            facility.UnloadDerived ? stay.Unloading : null);

        if (SpeedLearning.Record(s, trip, DispatchEngine.AssignedTruck(s)) is { } learned) said.Add(learned);
        var late = TripService.LateByTheClock(s, trip, out var lateNote);
        if (!string.IsNullOrWhiteSpace(lateNote)) said.Add(lateNote);

        trip.Status = "Delivered";
        trip.ServiceResult = late == true ? "Late" : "OnTime";
        trip.ClosedUtc = DateTime.UtcNow.ToString("o");
        said.AddRange(RoadLearning.RecordTrip(s, trip));
        s.Status.ActiveTripId = "";
        return (said, late);
    }
}

public record RunEventRequest(string? Kind, int? Day, string? Time, int? EndDay, string? EndTime, double? Hours,
                              string? Detail, string? City, string? State, double? Gallons, decimal? PricePerGal);
public record RunStageRequest(int? Day, string? Time, double? WeightLbs, double? Odometer);
