using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

public class CompleteTripRequest
{
    public string DeliveredGameTime { get; set; } = "";
    /// <summary>Set when the driver has no game timestamp — ATS flagged the load late.</summary>
    public bool? DeliveredLate { get; set; }
    public double ActualMiles { get; set; }
    public double EndOdometer { get; set; }
    public decimal? ActualRevenue { get; set; }

    /// <summary>
    /// Every fuel stop on the trip. Pre-populated from fuel events logged while the load was running,
    /// so the driver confirms what is already there instead of adding it all up at the end.
    /// </summary>
    public List<FuelPurchase>? FuelStops { get; set; }
    /// <summary>Single-stop shorthand, still honoured when no stop list is sent.</summary>
    public double FuelGallons { get; set; }
    public decimal FuelCost { get; set; }
    public decimal Tolls { get; set; }
    public decimal RepairCost { get; set; }
    public decimal Fines { get; set; }
    public decimal OtherExpense { get; set; }
    public string OtherExpenseMemo { get; set; } = "";

    public double TruckDamageAfter { get; set; }
    public double TrailerDamageAfter { get; set; }
    public double CargoDamagePct { get; set; }

    public double LoadingHours { get; set; }
    public double UnloadingHours { get; set; }
    public double DetentionHours { get; set; }

    /// <summary>
    /// The unload has already run in game, and the clock with it.
    ///
    /// Tick this when the next load came off the receiver's own board. ATS finishes the unload the moment
    /// that button is pressed — advancing the clock and spending the shift and cycle — and only then shows
    /// the loads. The time typed in above is arrival at the dock, so everything after it has to be added
    /// on rather than waited for.
    /// </summary>
    public bool UnloadAlreadyRan { get; set; }

    /// <summary>
    /// What the game clock read once the load board appeared, if you noted it.
    ///
    /// The better of the two inputs, and the easier one: there is no "end unload" event to log in this
    /// flow, because ATS never stops to let you record one. Reading a clock is something you can just do.
    /// Given this, the app measures the dock time as the gap from arrival rather than taking a duration
    /// on trust.
    /// </summary>
    public string ReleasedGameTime { get; set; } = "";
    public double LayoverDays { get; set; }
    public double BreakdownDays { get; set; }
    public int ExtraStops { get; set; }
    public int TarpsUsed { get; set; }

    /// <summary>Driver's account of any delay. Operations decides fault, not the driver.</summary>
    public string DelayReason { get; set; } = "";
    /// <summary>Driver's account of how the equipment got damaged, if it did.</summary>
    public string DamageCause { get; set; } = "";
    /// <summary>Optional explicit fault override by operations.</summary>
    public string FaultOverride { get; set; } = "";
    public decimal Chargeback { get; set; }
    public string ChargebackMemo { get; set; } = "";
    public string Notes { get; set; } = "";

    // Post-delivery status
    public string LocationCity { get; set; } = "";
    public string LocationState { get; set; } = "";
    public string LocationKind { get; set; } = "Receiver";
    public double FuelPct { get; set; } = -1;
    public string GameTime { get; set; } = "";

    // Clocks as they read at delivery. Optional, but reporting them here means the next dispatch
    // starts from a confirmed HOS position instead of asking for the same four numbers again.
    public double? HosDriveRemaining { get; set; }
    public double? HosShiftRemaining { get; set; }
    public double? HosBreakRemaining { get; set; }
    public double? HosCycleRemaining { get; set; }
}

public class TripAudit
{
    public Trip Trip { get; set; } = new();
    public string Headline { get; set; } = "";
    public List<string> ServiceFindings { get; set; } = new();
    public List<string> MileageFindings { get; set; } = new();
    /// <summary>Numbers that look wrong and were posted anyway. Surfaced loudly, never blocking.</summary>
    public List<string> Warnings { get; set; } = new();
    public List<string> MoneyFindings { get; set; } = new();
    public List<string> EquipmentFindings { get; set; } = new();
    public List<string> Directives { get; set; } = new();
    public string MaintenanceStatus { get; set; } = "Monitor";
    public string FaultAttribution { get; set; } = "None";
    public string FaultRationale { get; set; } = "";
    public decimal DriverPay { get; set; }
    public decimal CompanyMargin { get; set; }
    public string? IncidentNumber { get; set; }
    public string? WorkOrderNumber { get; set; }
    public string? DisciplineRecommendation { get; set; }
    /// <summary>Readings this close-out handed straight to the next dispatch, so nothing is retyped.</summary>
    public List<string> CarriedForward { get; set; } = new();
    /// <summary>True when the driver reported their clocks at delivery, so dispatch need not ask again.</summary>
    public bool ClocksReported { get; set; }
    /// <summary>Set when delivering here put a new city on the map.</summary>
    public DiscoveryService.DiscoveryNotice? Discovery { get; set; }

    /// <summary>A rank the driver has just moved into, or an offer waiting on them.</summary>
    public CareerService.AdvanceNotice? Advance { get; set; }
    /// <summary>Home-time instructions: report to the yard, and what to put through the shop while there.</summary>
    public List<string> HomeTimeInstructions { get; set; } = new();
    /// <summary>
    /// Where this delivery leaves the driver on home time. Read at the moment a load closes, which is
    /// exactly when they are deciding what to do next — and when a lower-paying ride home stops looking
    /// like a mistake.
    /// </summary>
    public string HomeTimeNote { get; set; } = "";
    /// <summary>This load was the ride home, and they are close enough to take it now.</summary>
    public bool GotYouHome { get; set; }
    /// <summary>
    /// What operations came back with on anything the driver asked for. Answered at close-out because
    /// that is when a dispatcher actually gets to it.
    /// </summary>
    public List<string> RequestAnswers { get; set; } = new();
    /// <summary>Set when a home-time request was approved on this close-out.</summary>
    public bool HomeRequestGranted { get; set; }
    /// <summary>
    /// Anything outstanding the driver has to do before the next load — the restart order, a fleet
    /// report waiting. Read at close-out because that is the one moment they are certainly looking at
    /// the app, and it is when they are deciding where to point the truck.
    /// </summary>
    public List<string> WhatsNext { get; set; } = new();
    /// <summary>Set when a 34-hour restart was ordered off the back of this delivery.</summary>
    public bool RestartOrdered { get; set; }
}

/// <summary>Closes a load out: service audit, pay accrual, ledger postings, equipment and career updates.</summary>
public static class TripService
{
    public static Trip? Active(AppState s) =>
        s.Trips.FirstOrDefault(t => t.Id == s.Status.ActiveTripId && t.Status is "Authorized" or "InTransit");

    public static void LogEvent(AppState s, string tripId, TripEvent ev)
    {
        var trip = s.Trips.FirstOrDefault(t => t.Id == tripId)
                   ?? throw new InvalidOperationException("Trip not found.");
        trip.Events.Add(ev);
        // "Loaded" and "Departed" are the retired names, still honoured for older careers.
        if (trip.Status == "Authorized" && ev.Kind is "EndLoad" or "BeginLoad" or "Loaded" or "Departed")
            trip.Status = "InTransit";
        if (!string.IsNullOrWhiteSpace(ev.GameTime)) s.Status.GameTime = ev.GameTime;

        // A fuel stop logged as it happens becomes a purchase on the trip, so close-out already has it
        // and the driver is never asked to reconstruct three fills from memory.
        if (ev.Kind == "Fuel" && (ev.Gallons > 0 || ev.Cost > 0))
        {
            var stop = new FuelPurchase
            {
                GameTime = ev.GameTime,
                City = string.IsNullOrWhiteSpace(ev.City) ? s.Status.LocationCity : ev.City,
                State = string.IsNullOrWhiteSpace(ev.State) ? s.Status.LocationState : ev.State,
                Gallons = ev.Gallons,
                PricePerGal = ev.PricePerGal,
                Cost = ev.Cost,
                Notes = ev.Detail
            };
            if (stop.Cost <= 0) stop.Cost = stop.Total();
            if (stop.PricePerGal <= 0 && stop.Gallons > 0)
                stop.PricePerGal = Math.Round(stop.Cost / (decimal)stop.Gallons, 3);
            trip.FuelStops.Add(stop);
            trip.FuelGallons = Math.Round(trip.FuelStops.Sum(f => f.Gallons), 2);
            trip.FuelCost = Math.Round(trip.FuelStops.Sum(f => f.Cost), 2);
        }

        // Events carry a location when the driver gives one — that is a city we have now been to.
        if (!string.IsNullOrWhiteSpace(ev.City))
            DiscoveryService.Note(s, ev.City, ev.State, ev.GameTime, trip.Number);
    }

    /// <summary>
    /// What dispatch asks for once the trailer is loaded: the real weight, the trailer's condition as
    /// hooked, and the odometer pulling out. Everything is optional — a blank field leaves what was
    /// there rather than overwriting it with zero, because a driver who could not find the number in
    /// game should not have it recorded as none.
    /// </summary>
    public static (Trip Trip, List<string> Notes) ReportLoaded(AppState s, string tripId,
        double? weightLbs, double? trailerDamagePct, double? odometer)
    {
        var trip = s.Trips.FirstOrDefault(t => t.Id == tripId)
                   ?? throw new InvalidOperationException("Trip not found.");
        if (trip.Status is "Delivered" or "Cancelled")
            throw new InvalidOperationException($"{trip.Number} is already closed.");

        var notes = new List<string>();

        if (weightLbs is > 0)
        {
            var booked = trip.WeightLbs;
            trip.WeightLbs = weightLbs.Value;
            if (booked > 0 && Math.Abs(weightLbs.Value - booked) > Math.Max(500, booked * 0.03))
            {
                var diff = weightLbs.Value - booked;
                trip.WeightVarianceNote =
                    $"scaled {Math.Abs(diff):N0} lb {(diff > 0 ? "heavier" : "lighter")} than the {booked:N0} lb on the board";
                notes.Add($"Weight came in at {weightLbs.Value:N0} lb against {booked:N0} lb booked — {trip.WeightVarianceNote}. " +
                          (diff > 0
                              ? "Heavier freight costs fuel and hill time; it is on the record."
                              : "Lighter than billed. Worth knowing if it repeats on this lane."));
            }
            else
            {
                trip.WeightVarianceNote = "";
                notes.Add($"Weight confirmed at {weightLbs.Value:N0} lb.");
            }
        }

        if (trailerDamagePct is >= 0)
        {
            trip.TrailerDamageAtHook = trailerDamagePct.Value;
            s.Status.TrailerDamagePct = trailerDamagePct.Value;
            var trailer = s.Trailers.FirstOrDefault(x => x.Unit == s.Driver.AssignedTrailerUnit);
            if (trailer != null) trailer.DamagePct = trailerDamagePct.Value;

            var stop = s.Settings.Maintenance.StopDispatchPct;
            if (trailerDamagePct.Value >= stop)
                notes.Add($"That trailer is at {trailerDamagePct.Value:0.#}%, at or past our {stop:0}% line. " +
                          "It goes through the shop before it goes out again — see the shop order.");
        }

        if (odometer is > 0)
        {
            trip.StartOdometer = odometer.Value;
            s.Status.AtsOdometer = odometer.Value;
            var truck = s.Trucks.FirstOrDefault(x => x.Unit == s.Driver.AssignedTruckUnit);
            if (truck != null) truck.AtsOdometer = odometer.Value;
            notes.Add($"Odometer {odometer.Value:N0} recorded as the start of this leg — close-out measures the run from it.");

            // The empty run to the shipper, measured rather than taken off the listing. Both readings are
            // the driver's own: one at the truck stop when the load was booked, this one after loading.
            // The difference is the deadhead they actually drove, which is what should be paid — the
            // listing's figure is the game's estimate of a route they may not have taken.
            notes.AddRange(MeasureDeadhead(trip, odometer.Value));
        }

        trip.LoadedReported = true;
        if (notes.Count == 0) notes.Add("Nothing to change. Marked as reported so I stop asking.");
        return (trip, notes);
    }

    /// <summary>Cap on a believable empty run to a shipper. Beyond it, something was mistyped.</summary>
    private const double ImplausibleDeadheadMiles = 600;

    /// <summary>
    /// Works the deadhead to the shipper out of the two odometer readings the driver gave.
    ///
    /// This is the leg the job listing quotes, and the quote is the game's estimate. The driver's own two
    /// readings are a measurement, so where there is a measurement it wins — the same rule as the dock
    /// clock beating a typed duration.
    ///
    /// Nothing is replaced on a reading that cannot be true. A zero gap against a listing that quoted
    /// real deadhead means the reading was not updated rather than that the truck never moved, and
    /// silently paying zero for a drive the driver made is the failure this whole path exists to stop.
    /// </summary>
    private static List<string> MeasureDeadhead(Trip trip, double loadedOdometer)
    {
        var notes = new List<string>();
        if (trip.DispatchOdometer <= 0) return notes;          // older trip, nothing to measure against

        var ran = loadedOdometer - trip.DispatchOdometer;
        var quoted = trip.DeadheadMiles;

        if (ran < 0)
        {
            notes.Add($"That reading is {Math.Abs(ran):N0} mi BELOW the {trip.DispatchOdometer:N0} on file when this " +
                      "load was booked. Keeping the quoted deadhead and leaving it alone — check the number.");
            return notes;
        }

        if (ran > ImplausibleDeadheadMiles)
        {
            notes.Add($"That is {ran:N0} mi between booking this load and loading it, which is too far to be a run " +
                      $"to the shipper. Keeping the {quoted:N0} mi quoted — if you really ran that empty it wants " +
                      "dispatching as an empty move.");
            return notes;
        }

        if (ran < 0.5 && quoted >= 1)
        {
            notes.Add($"The odometer has not moved since this load was booked, but the listing quoted {quoted:N0} mi " +
                      "of deadhead to the shipper. I am keeping the quoted figure rather than paying you nothing — " +
                      "report the reading from the shipper if you want it exact.");
            return notes;
        }

        trip.DeadheadMiles = Math.Round(ran, 0);
        trip.DeadheadMeasured = true;

        if (quoted >= 1 && Math.Abs(ran - quoted) >= 5)
            notes.Add($"Deadhead to the shipper measured at {trip.DeadheadMiles:N0} mi from your own readings " +
                      $"({trip.DispatchOdometer:N0} → {loadedOdometer:N0}), against {quoted:N0} mi on the listing. " +
                      "Going with yours — you drove it, the listing guessed it.");
        else
            notes.Add($"Deadhead to the shipper: {trip.DeadheadMiles:N0} empty mi, measured " +
                      $"({trip.DispatchOdometer:N0} → {loadedOdometer:N0}) and paid at the empty rate.");

        return notes;
    }

    /// <summary>
    /// Corrects the delivery window on a load already in flight.
    ///
    /// There was no way to do this. A window read wrong off a screenshot was the appointment for the
    /// rest of the trip, and the driver had no way to fix it short of cancelling the load. The window
    /// is measured from when the load was dispatched, so correcting the hours moves the appointment
    /// to where it should have been all along.
    /// </summary>
    public static Trip CorrectWindow(AppState s, string tripId, double deadlineHours, string note)
    {
        var trip = s.Trips.FirstOrDefault(t => t.Id == tripId)
                   ?? throw new InvalidOperationException("Trip not found.");
        if (trip.Status is "Delivered" or "Cancelled")
            throw new InvalidOperationException($"{trip.Number} is closed — the window cannot be changed now.");
        if (deadlineHours <= 0)
            throw new InvalidOperationException("Give me the hours to deliver from the ATS job screen.");

        var from = GameClock.TryParse(trip.DispatchedGameTime)
                   ?? GameClock.TryParse(s.Status.GameTime)
                   ?? throw new InvalidOperationException("No dispatch time on file to measure the window from.");

        var was = trip.DueGameTime;
        trip.DeadlineHoursAtDispatch = deadlineHours;
        trip.DueGameTime = GameClock.Format(from.AddHours(deadlineHours));
        trip.WindowWarning = "";

        if (trip.FeasibilityAtDispatch is { } f) f.DueGameTime = trip.DueGameTime;

        trip.Events.Add(new TripEvent
        {
            Kind = "Note",
            GameTime = s.Status.GameTime,
            Detail = $"Delivery window corrected to {Hhmm.Of(deadlineHours)} — due {GameClock.Pretty(trip.DueGameTime)}" +
                     (string.IsNullOrWhiteSpace(was) ? "" : $", was {GameClock.Pretty(was)}") +
                     (string.IsNullOrWhiteSpace(note) ? "." : $". {note}")
        });

        return trip;
    }

    public static TripAudit Complete(AppState s, string tripId, CompleteTripRequest req)
    {
        var trip = s.Trips.FirstOrDefault(t => t.Id == tripId)
                   ?? throw new InvalidOperationException("Trip not found.");
        if (trip.Status is "Delivered" or "Cancelled")
            throw new InvalidOperationException($"{trip.Number} is already closed ({trip.Status}).");

        var audit = new TripAudit { Trip = trip };

        // ---- record what the driver reported
        trip.DeliveredGameTime = string.IsNullOrWhiteSpace(req.DeliveredGameTime) ? req.GameTime : req.DeliveredGameTime;
        // Miles come off the odometer, because that is the number ATS shows. The typed figure is only
        // an override for a reading that was missed or fat-fingered.
        var mileage = DeriveMiles(s, trip, req.ActualMiles, req.EndOdometer);
        trip.ActualMiles = mileage.LoadedMiles;
        trip.EndOdometer = req.EndOdometer;
        if (trip.StartOdometer <= 0 && mileage.StartOdometer > 0) trip.StartOdometer = mileage.StartOdometer;
        if (req.ActualRevenue.HasValue && req.ActualRevenue.Value > 0)
        {
            trip.GameRevenue = req.ActualRevenue.Value;
            trip.CompanyRevenue = Math.Round(trip.GameRevenue * (decimal)Math.Clamp(s.Settings.RevenueFactor, 0.05, 3.0), 2);
        }

        RecordFuel(trip, req, audit);
        trip.Tolls = req.Tolls;
        trip.RepairCost = req.RepairCost;
        trip.Fines = req.Fines;
        trip.OtherExpense = req.OtherExpense;
        trip.OtherExpenseMemo = req.OtherExpenseMemo;
        trip.TruckDamageAfter = req.TruckDamageAfter;
        trip.TrailerDamageAfter = req.TrailerDamageAfter;
        trip.CargoDamagePct = req.CargoDamagePct;
        // Facility time comes from the Begin/End pairs in the log where they exist. Detention is pay,
        // so it is derived from clock times rather than taken on trust.
        var facility = DeriveFacilityTimes(s, trip, req.LoadingHours, req.UnloadingHours, req.DetentionHours);
        if (facility.LoadingHours > 0) trip.LoadingHours = facility.LoadingHours;
        if (facility.UnloadingHours > 0) trip.UnloadingHours = facility.UnloadingHours;
        trip.DetentionHours = facility.DetentionHours;
        audit.ServiceFindings.AddRange(facility.Explain);

        // Only measured times train the planner. A typed fallback is the driver's recollection, and
        // baking a guess into every future projection is how the old flat 1.0 went wrong.
        // A pre-loaded pickup teaches nothing about how long that shipper takes to load a trailer, because
        // nobody loaded one. Feeding twenty-five minutes into the live-load average would drag it toward
        // zero and have the app planning real dock work as though it were instant. The UNLOAD still counts:
        // the receiver unloaded normally whatever the pickup looked like.
        var dockBefore = FacilityLearning.For(s, trip.TrailerType);
        FacilityLearning.Record(s, trip.TrailerType,
            facility.LoadDerived && !trip.PreLoaded ? facility.LoadingHours : null,
            facility.UnloadDerived ? facility.UnloadingHours : null);
        if (trip.PreLoaded && facility.LoadDerived)
            audit.ServiceFindings.Add(
                "Pre-loaded pickup, so the hook time is not counted toward what this dock takes to load a " +
                "trailer — only real loads move that figure.");
        var dockAfter = FacilityLearning.For(s, trip.TrailerType);

        // Say so when this load moved the planning assumption — it changes every future projection.
        if (Math.Abs(dockAfter.Loading - dockBefore.Loading) >= 0.05
            || Math.Abs(dockAfter.Unloading - dockBefore.Unloading) >= 0.05)
        {
            var type = FacilityLearning.Normalise(trip.TrailerType).ToLowerInvariant();
            audit.ServiceFindings.Add(
                $"Dock time for {type} updated: load {dockBefore.Loading:0.##} → {Hhmm.Of(dockAfter.Loading)}, " +
                $"unload {dockBefore.Unloading:0.##} → {Hhmm.Of(dockAfter.Unloading)}, now off {dockAfter.Samples} " +
                $"measured load(s). I plan every {type} run on those figures from here.");
        }
        trip.LayoverDays = req.LayoverDays;
        trip.BreakdownDays = req.BreakdownDays;
        if (req.ExtraStops > 0) trip.ExtraStops = req.ExtraStops;
        if (req.TarpsUsed > 0) trip.TarpsUsed = req.TarpsUsed;
        if (!string.IsNullOrWhiteSpace(req.Notes))
            trip.Notes = string.IsNullOrWhiteSpace(trip.Notes) ? req.Notes : trip.Notes + " | " + req.Notes;

        // ---- service result
        var late = DetermineLate(s, trip, req, out var serviceNote);
        trip.ServiceResult = trip.Kind == "Freight" ? (late ? "Late" : "OnTime") : "NotApplicable";
        audit.ServiceFindings.Add(serviceNote);

        // An early take is the receiver's doing, not a schedule beaten. Recorded so the figure is on the
        // file rather than quietly flattering the driver's numbers when somebody reads them back later.
        if (trip.ReceiverTakesEarly && trip.Kind == "Freight"
            && GameClock.TryParse(trip.DeliveredGameTime) is { } deliveredAt)
        {
            var against = GameClock.TryParse(trip.AppointmentGameTime)
                          ?? GameClock.TryParse(trip.AppointmentOpensGameTime);
            trip.EarlyTakeHoursSaved = against is { } slot
                ? Math.Max(0, Math.Round((slot - deliveredAt).TotalHours, 2))
                : 0;

            audit.ServiceFindings.Add(trip.EarlyTakeHoursSaved > 0.1
                ? $"The receiver took this one ahead of the appointment — {Hhmm.Of(trip.EarlyTakeHoursSaved)} " +
                  "earlier than the slot. Their call, not a schedule beaten, so it counts as on time and " +
                  "nothing more."
                : "The receiver had agreed to take this one whenever it arrived. It still counts as on " +
                  "time and nothing more.");
        }

        // ---- fault attribution: the company owns its own bad dispatching
        var (fault, rationale) = AttributeFault(s, trip, req, late);
        trip.FaultAttribution = fault;
        audit.FaultAttribution = fault;
        audit.FaultRationale = rationale;
        if (late) audit.ServiceFindings.Add(rationale);

        // ---- mileage audit
        if (trip.Kind == "Freight" && trip.DispatchedMiles > 0)
        {
            var variance = trip.ActualMiles - trip.DispatchedMiles;
            var pct = variance / trip.DispatchedMiles * 100;
            audit.MileageFindings.Add($"Dispatched {trip.DispatchedMiles:N0} mi, ran {trip.ActualMiles:N0} mi ({variance:+0;-0;0} mi, {pct:+0.#;-0.#;0}%).");
            if (pct > 12)
                audit.MileageFindings.Add("Out-of-route miles are high. Either the routing was wrong or you took a detour — either way it costs fuel and hours.");
        }
        audit.MileageFindings.AddRange(mileage.Explain);
        audit.MileageFindings.AddRange(mileage.Warnings);
        audit.Warnings.AddRange(mileage.Warnings);

        if (trip.FeasibilityAtDispatch is { } f && GameClock.TryParse(trip.DeliveredGameTime) is DateTime del
            && GameClock.TryParse(f.ProjectedArrivalGameTime) is DateTime proj)
        {
            var driftHours = (del - proj).TotalHours;
            audit.ServiceFindings.Add($"Projected arrival was {GameClock.Pretty(proj)}; you delivered {GameClock.Pretty(del)} ({driftHours:+0.#;-0.#;0} h vs plan).");
            if (driftHours > 3)
                audit.ServiceFindings.Add("Plan drifted by more than three hours. I am adjusting the speed factor assumption if this repeats.");
        }

        // ---- pay
        trip.Pay = PayEngine.ComputeTripPay(s, trip);
        if (req.Chargeback > 0)
        {
            trip.Pay.Chargebacks = req.Chargeback;
            trip.Pay.ChargebackMemo = req.ChargebackMemo;
            trip.Pay.Total = Math.Round(trip.Pay.Total - req.Chargeback, 2);
            trip.Pay.Lines.Add($"Chargeback: {req.ChargebackMemo} = -${req.Chargeback:N2}");
        }
        audit.DriverPay = trip.Pay.Total;
        s.Driver.UnsettledPay = Math.Round(s.Driver.UnsettledPay + trip.Pay.Total, 2);

        // ---- ledger
        trip.Status = "Delivered";
        trip.ClosedUtc = DateTime.UtcNow.ToString("o");
        LedgerService.PostTripFinancials(s, trip);

        var costs = trip.FuelCost + trip.Tolls + trip.RepairCost + trip.OtherExpense
                    + (trip.Kind == "Freight" ? s.Settings.OverheadPerLoad : 0)
                    + (trip.FaultAttribution == "Driver" && trip.Pay.Chargebacks >= trip.Fines ? 0 : trip.Fines);
        audit.CompanyMargin = Math.Round(trip.CompanyRevenue - costs - trip.Pay.Total, 2);
        audit.MoneyFindings.Add($"Revenue ${trip.CompanyRevenue:N2} (ATS paid ${trip.GameRevenue:N2}) less ${costs:N2} operating and ${trip.Pay.Total:N2} driver pay = ${audit.CompanyMargin:N2} contribution.");
        if (trip.ActualMiles + trip.DeadheadMiles > 0)
        {
            var allIn = trip.CompanyRevenue / (decimal)(trip.ActualMiles + trip.DeadheadMiles);
            audit.MoneyFindings.Add($"${allIn:0.00}/mi all-in on {trip.ActualMiles + trip.DeadheadMiles:N0} total miles.");
            if (allIn < s.Settings.Scoring.FloorAllInRpm)
                audit.MoneyFindings.Add($"That is under our ${s.Settings.Scoring.FloorAllInRpm:0.00} floor. My call to book it, not yours.");
        }
        if (trip.FuelGallons > 0 && trip.ActualMiles + trip.DeadheadMiles > 0)
        {
            var mpg = (trip.ActualMiles + trip.DeadheadMiles) / trip.FuelGallons;
            audit.MoneyFindings.Add($"Fuel economy {mpg:0.0} mpg over the trip.");
        }
        if (audit.CompanyMargin < 0)
            audit.MoneyFindings.Add("Negative contribution. The company lost money on this load.");

        // ---- equipment
        UpdateEquipment(s, trip, audit, req);

        // ---- location / clocks
        var priorCity = s.Status.LocationCity;
        if (!string.IsNullOrWhiteSpace(req.LocationCity)) s.Status.LocationCity = req.LocationCity;
        else if (!string.IsNullOrWhiteSpace(trip.DestCity)) s.Status.LocationCity = trip.DestCity;
        // The old "which dock / which yard" note belongs to the place we just left.
        if (!string.Equals(priorCity, s.Status.LocationCity, StringComparison.OrdinalIgnoreCase))
            s.Status.LocationDetail = string.IsNullOrWhiteSpace(trip.Receiver) ? "" : trip.Receiver;
        if (!string.IsNullOrWhiteSpace(req.LocationState)) s.Status.LocationState = req.LocationState;
        else if (!string.IsNullOrWhiteSpace(trip.DestState)) s.Status.LocationState = trip.DestState;
        s.Status.LocationKind = string.IsNullOrWhiteSpace(req.LocationKind) ? "Receiver" : req.LocationKind;
        if (req.FuelPct >= 0) s.Status.FuelPct = req.FuelPct;
        if (!string.IsNullOrWhiteSpace(trip.DeliveredGameTime)) s.Status.GameTime = trip.DeliveredGameTime;

        // The unload ran in game before the driver saw anything, so the game is already this far past the
        // time they reported arriving. Everything downstream — the next load's window, its recap, whether
        // it is even legal — is planned off this moment, so it has to be the right one.
        var spentAtDock = trip.UnloadingHours + trip.DetentionHours;
        var arrivedAt = GameClock.TryParse(trip.DeliveredGameTime);

        // Three ways to know when the driver was released, best first. An EndUnload event is the same
        // reading as the optional field below, logged at the dock instead of typed at close-out — so a
        // driver who logs Begin/End needs no extra box and no extra tick.
        var releasedAt = GameClock.TryParse(req.ReleasedGameTime)
                         ?? trip.Events.Where(e => e.Kind == "EndUnload")
                              .Select(e => GameClock.TryParse(e.GameTime))
                              .Where(d => d != null).Max();

        // A clock reading beats a duration. There is no end-of-unload event to measure in this flow, so if
        // the driver noted what the clock said when the board came up, that gap IS the dock time.
        if (releasedAt != null && arrivedAt != null && releasedAt.Value > arrivedAt.Value)
        {
            var measured = (releasedAt.Value - arrivedAt.Value).TotalHours;
            if (spentAtDock > 0 && Math.Abs(measured - spentAtDock) > 0.25)
                audit.ServiceFindings.Add(
                    $"You reported {Hhmm.Of(spentAtDock)} at the dock but the clock moved {Hhmm.Of(measured)}. " +
                    "Going with the clock \u2014 it is what the game actually charged.");
            spentAtDock = measured;
            s.Status.GameTime = GameClock.Format(releasedAt.Value);
            audit.CarriedForward.Add(
                $"Off the clock: arrived {GameClock.Pretty(trip.DeliveredGameTime)}, board came up " +
                $"{GameClock.Pretty(s.Status.GameTime)} \u2014 {Hhmm.Of(spentAtDock)} at the dock.");
        }
        else if (req.UnloadAlreadyRan && spentAtDock > 0 && arrivedAt != null)
        {
            s.Status.GameTime = GameClock.Format(arrivedAt.Value.AddHours(spentAtDock));
            audit.CarriedForward.Add(
                $"Unload ran when you opened the board: {Hhmm.Of(spentAtDock)} on top of {GameClock.Pretty(trip.DeliveredGameTime)}, " +
                $"so it is {GameClock.Pretty(s.Status.GameTime)} now.");
        }
        s.Status.ActiveTripId = "";
        s.Status.DutyStatus = "OnDuty";
        s.Status.UpdatedUtc = DateTime.UtcNow.ToString("o");

        // Everything the close-out just told us IS the driver's current position. Hand it forward
        // rather than asking for the same readings a second time on the dispatch screen.
        s.Status.CarriedForwardFrom = trip.Number;
        s.Status.CarriedForwardGameTime = trip.DeliveredGameTime;
        s.Status.Confirmed = false;
        audit.CarriedForward.Add($"Position: {DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState)}"
                                 + (string.IsNullOrWhiteSpace(s.Status.LocationDetail) ? "" : $" ({s.Status.LocationDetail})"));
        audit.CarriedForward.Add($"Game clock: {GameClock.Pretty(s.Status.GameTime)}");
        if (req.FuelPct >= 0) audit.CarriedForward.Add($"Fuel: {s.Status.FuelPct:0}%");
        audit.CarriedForward.Add($"Damage: tractor {s.Status.TruckDamagePct:0.#}%, trailer {s.Status.TrailerDamagePct:0.#}%");
        if (s.Status.AtsOdometer > 0) audit.CarriedForward.Add($"Odometer: {s.Status.AtsOdometer:N0}");

        // Whether the clocks on file were trustworthy BEFORE this close-out touched the flag. The block
        // below clears Confirmed when nothing was reported, so asking afterwards always says "stale".
        var baselineWasFresh = s.Hos.Confirmed;

        // Clocks at delivery, if the driver read them off while they were closing the load out.
        if (req.HosDriveRemaining.HasValue || req.HosShiftRemaining.HasValue
            || req.HosBreakRemaining.HasValue || req.HosCycleRemaining.HasValue)
        {
            if (req.HosDriveRemaining.HasValue) s.Hos.DriveRemaining = Math.Max(0, req.HosDriveRemaining.Value);
            if (req.HosShiftRemaining.HasValue) s.Hos.ShiftRemaining = Math.Max(0, req.HosShiftRemaining.Value);
            if (req.HosBreakRemaining.HasValue) s.Hos.BreakRemaining = Math.Max(0, req.HosBreakRemaining.Value);
            if (req.HosCycleRemaining.HasValue) s.Hos.CycleRemaining = Math.Max(0, req.HosCycleRemaining.Value);
            s.Hos.AsOfGameTime = trip.DeliveredGameTime;
            s.Hos.CarriedForwardFrom = trip.Number;
            s.Hos.Confirmed = true;   // read off the game just now — this is a fresh reading, not a stale one
            s.Hos.Projected = false;
            ClockCheck.Rearm(s);      // clocks read at the dock come off the same capped display

            s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
            audit.ClocksReported = true;
            audit.CarriedForward.Add(
                $"Clocks: drive {s.Hos.DriveRemaining:0.##}, shift {s.Hos.ShiftRemaining:0.##}, cycle {s.Hos.CycleRemaining:0.##}");

            // These are the clocks AS THE DRIVER ARRIVED — they stopped driving, backed in, and read
            // the display. That is the natural moment to read them and the only one the app can anchor
            // to, because it is the last point at which the driver and the game agree.
            //
            // So the dock time comes off them, exactly as it would off a figure we had carried ourselves.
            // Not doing this was worse than a double count: with no reading at all the app was taking the
            // dock time off clocks from BEFORE the drive, leaving a whole trip's driving unaccounted for.
            CarryClocksAcrossTheDock(s, trip, req, audit, spentAtDock, baselineWasFresh);
        }
        else
        {
            // Clocks not reported at delivery, so whatever we hold is now stale by a whole trip.
            s.Hos.Confirmed = false;
            CarryClocksAcrossTheDock(s, trip, req, audit, spentAtDock, baselineWasFresh);
        }

        // ---- did this load put a new city on our map?
        audit.Discovery = DiscoveryService.Note(s, s.Status.LocationCity, s.Status.LocationState,
            trip.DeliveredGameTime, trip.Number);

        // ---- anything the driver asked operations for gets answered now.
        //
        // Deliberately here rather than at the moment they ask. A dispatcher does not drop what they
        // are doing to answer a text mid-lane, and answering on the spot would make a home-time request
        // a free way out of the load in front of them.
        if (Requests.Answer(s) is { } homeReq)
        {
            audit.RequestAnswers.Add($"{homeReq.Number} — home time: {homeReq.Answer}");
            audit.HomeRequestGranted = homeReq.Status == "Granted";
        }
        if (Requests.AnswerTrailerRequest(s) is { } trailerReq)
            audit.RequestAnswers.Add($"{trailerReq.Number} — {trailerReq.RequestedType}: {trailerReq.Answer}");

        // ---- has this load earned them the next rung? The close-out is where the numbers move, so it is
        // where the company notices. Probation is not done here — that clears at the yard review.
        audit.Advance = CareerService.AutoAdvance(s);

        // ---- and where does it leave us on home time?
        var homeNow = HomeTime.Status(s);
        if (homeNow.Tracked)
        {
            if (homeNow.AtHome && (homeNow.DueSoon || homeNow.Overdue))
            {
                audit.GotYouHome = true;
                audit.HomeTimeNote =
                    $"That load got you home. You are {homeNow.MilesFromHome:N0} mi from {homeNow.TerminalLabel} " +
                    $"and {homeNow.DaysOut:0.#} days out on a {homeNow.IntervalDays}-day arrangement. " +
                    "Run in to the yard and report at the terminal to take it.";
            }
            else if (homeNow.Overdue)
                audit.HomeTimeNote =
                    $"Home time is overdue — {homeNow.DaysOut:0.#} days out. You are still " +
                    $"{homeNow.MilesFromHome:N0} mi from {homeNow.TerminalLabel}, so the next load is going that way.";
            else if (homeNow.DueSoon)
                audit.HomeTimeNote =
                    $"Home time is due in {homeNow.DaysUntilDue:0.#} days and you are {homeNow.MilesFromHome:N0} mi " +
                    $"from {homeNow.TerminalLabel}. The next load will be the one that gets you back, which is why " +
                    "I may pass over something that pays better.";
            else
                audit.HomeTimeNote =
                    $"{homeNow.DaysOut:0.#} days out, home time in {homeNow.DaysUntilDue:0.#}. Nothing to plan around yet.";
        }
        else if (!string.IsNullOrWhiteSpace(homeNow.Suggestion))
        {
            // No arrangement, but a very long time out. Worth saying once they are stopped and reading.
            audit.HomeTimeNote = homeNow.Suggestion;
        }

        // ---- safety record
        //
        // Whose fault it was goes on the trip, so the pattern can be read off the work rather than off a
        // pile of incident records. That distinction is the whole fix here: the app used to file an
        // incident for EVERY late delivery, non-preventable ones included, and every incident restarted
        // the clean-work counter — so a driver nobody blamed still looked like they had just started.
        trip.DelayFault = late ? fault : "";

        if (late && fault != "Driver")
        {
            // Not the driver's doing. Recorded on the trip and on the books, and nowhere else: no
            // incident, no record to work off, nothing to age.
            audit.ServiceFindings.Add(fault == "Dispatcher"
                ? "Logged against dispatch, not you. No incident, nothing on your record, and it does not " +
                  "count toward anything — I put you on a run that would not go."
                : $"Logged as {Humanize(fault)}. Non-preventable, so there is no incident and nothing on your record.");
        }
        else if (late)
        {
            // The driver's own. One is a bad day; a pattern is a different matter, and only a pattern
            // reaches discipline. Strikes are counted over the last ten loads, so clean work walks them off.
            var strikes = SafetyService.LateStrikes(s);
            var window = SafetyService.LateStrikeWindow;
            var needed = SafetyService.LateStrikesBeforeDiscipline;

            if (strikes < needed)
            {
                audit.ServiceFindings.Add(
                    $"Late, and down to you. That is {strikes} in your last {window} loads — noted on the file and " +
                    $"nothing more. It takes {needed} before it becomes a safety matter, and {window} clean loads " +
                    "clears the count.");
                SafetyService.RecordIncident(s, new Incident
                {
                    Kind = "Late",
                    TripNumber = trip.Number,
                    GameTime = trip.DeliveredGameTime,
                    Description = $"Late delivery on {trip.Number} — {trip.Cargo} to " +
                                  $"{DispatchEngine.Place(trip.DestCity, trip.DestState)}. {req.DelayReason}".Trim(),
                    FaultAttribution = "Driver",
                    Severity = "Minor",
                    // Noted, not held against them. Below the pattern threshold this is a diary entry.
                    Preventable = false,
                    LocationCity = trip.DestCity,
                    LocationState = trip.DestState
                });
            }
            else
            {
                var (inc, action) = SafetyService.FileAndDecide(s, new Incident
                {
                    Kind = "Late",
                    TripNumber = trip.Number,
                    GameTime = trip.DeliveredGameTime,
                    Description = $"Late delivery on {trip.Number} — {trip.Cargo} to " +
                                  $"{DispatchEngine.Place(trip.DestCity, trip.DestState)}. " +
                                  $"{strikes} driver-fault late deliveries in the last {window} loads. {req.DelayReason}".Trim(),
                    FaultAttribution = "Driver",
                    Severity = "Moderate",
                    Preventable = true,
                    LocationCity = trip.DestCity,
                    LocationState = trip.DestState
                });
                audit.IncidentNumber = inc.Number;
                audit.DisciplineRecommendation = action?.Level;
                audit.ServiceFindings.Add(
                    $"That is {strikes} late in your last {window} loads, all down to you. One is a bad day; this is " +
                    $"a pattern, so it goes on the record. {window} clean loads clears the count.");
            }
        }

        var damageJump = trip.TruckDamageAfter - trip.TruckDamageBefore;
        if (damageJump >= 10)
        {
            var (dmgFault, dmgWhy) = AttributeDamage(req, damageJump);

            // Damage nobody could have avoided still costs the company money, so it is recorded — but it
            // is not a mark against the driver, and saying what to do about it is more use than a
            // penalty. AI traffic driving into a parked truck is the case this exists for.
            if (dmgFault != "Driver")
                audit.ServiceFindings.Add(
                    $"{damageJump:0.#}% of damage, logged as {Humanize(dmgFault)} — not your fault and not on your " +
                    "record. Get it into a shop before the next load: damage left on a unit comes back as more " +
                    "damage, and it is the company's bill either way. Book it on the Maintenance tab.");
            var (inc, dmgAction) = SafetyService.FileAndDecide(s, new Incident
            {
                Kind = "Damage",
                TripNumber = trip.Number,
                GameTime = trip.DeliveredGameTime,
                Description = $"Tractor damage rose {damageJump:0.#} points on {trip.Number} ({trip.TruckDamageBefore:0.#}% → {trip.TruckDamageAfter:0.#}%)."
                              + (string.IsNullOrWhiteSpace(req.DamageCause) ? "" : $" Driver reports: {req.DamageCause}"),
                FaultAttribution = dmgFault,
                Severity = damageJump >= 25 ? "Serious" : "Moderate",
                Preventable = dmgFault == "Driver",
                Cost = trip.RepairCost,
                LocationCity = trip.DestCity,
                LocationState = trip.DestState
            });
            audit.EquipmentFindings.Add(dmgWhy);
            audit.IncidentNumber ??= inc.Number;
            audit.DisciplineRecommendation ??= dmgAction?.Level;
        }
        if (trip.CargoDamagePct >= 5)
            audit.EquipmentFindings.Add($"Cargo damage {trip.CargoDamagePct:0.#}% — that shows up as a claim. Secure and slow down in the rough spots.");

        // ---- headline
        audit.Headline = trip.Kind != "Freight"
            ? $"{trip.Number} closed — {trip.Cargo.ToLowerInvariant()} to {DispatchEngine.Place(trip.DestCity, trip.DestState)}."
            : late
                ? $"{trip.Number} delivered LATE — {trip.Cargo} to {DispatchEngine.Place(trip.DestCity, trip.DestState)}. Fault: {Humanize(fault)}."
                : $"{trip.Number} delivered on time — {trip.Cargo} to {DispatchEngine.Place(trip.DestCity, trip.DestState)}. Driver pay ${trip.Pay.Total:N2}.";

        // ---- what happens next
        audit.Directives.Add("Show me the jobs available here at the receiver before I order you anywhere empty.");
        var hosView = HosEngine.Describe(s, s.Trucks.FirstOrDefault(t => t.Unit == trip.TruckUnit));
        if (!string.IsNullOrWhiteSpace(hosView.ResetWatch)) audit.Directives.Add(hosView.ResetWatch);
        audit.Directives.Add(audit.ClocksReported
            ? $"Clocks logged at delivery — I have what I need to plan the next load. {hosView.NextRequiredAction}"
            : $"Re-read your HOS display and report the clocks — I am not booking the next load off stale numbers. Current reading: {hosView.NextRequiredAction}");
        if (audit.Discovery is { GarageAvailable: true } disc)
            audit.Directives.Add($"{disc.Place} is new to us and ATS sells a garage here. See the note on the Dispatch tab before you leave.");

        // The load that was run to get them home ends with the instruction to actually go home.
        if (trip.IsHomeRun || HomeTime.Status(s).Overdue)
        {
            var homeSteps = HomeTime.HomeRunInstructions(s, s.Status.LocationCity, s.Status.LocationState);
            if (homeSteps.Count > 0)
            {
                audit.HomeTimeInstructions.AddRange(homeSteps);
                audit.Directives.Add(homeSteps[0]);
            }
        }
        if (audit.MaintenanceStatus is "MandatoryReview" or "OutOfService")
            audit.Directives.Add("Maintenance comes before the next load. See the directive above.");

        CareerService.Recalculate(s);

        // A driver who was downgraded and has since run clean gets the offer without asking.
        var restored = EquipmentService.CheckDowngradeRestoration(s);
        if (restored != null)
            audit.Directives.Add($"{restored.Number}: {restored.Instruction}");

        // ---- what happens before the next load
        //
        // Everything below is already discoverable somewhere else in the app. It is repeated here
        // because closing a load out is the one moment the driver is certainly reading, and it is when
        // they are deciding where to point the truck — a banner they meet after driving somewhere else
        // is too late to be useful.

        // The cycle. Ordered now rather than when the board stops working, so they can reach a decent
        // truck stop instead of parking wherever they ran out.
        if (Restart.Open(s) is { } openRestart)
        {
            audit.WhatsNext.AddRange(Restart.Instructions(s, openRestart));
            audit.RestartOrdered = true;
        }
        else if (Restart.Needed(s))
        {
            audit.WhatsNext.AddRange(Restart.Instructions(s, Restart.Order(s)));
            audit.RestartOrdered = true;
        }
        else if (Restart.OperationalReason(s, trip.Number) is { } opsWhy)
        {
            // The company parking the driver for its own reasons. Rare, and never their fault — the
            // clocks are fine and nothing about it touches their record.
            audit.WhatsNext.AddRange(Restart.Instructions(s, Restart.OrderOperational(s, opsWhy)));
            audit.RestartOrdered = true;
        }

        // The fortnightly fleet report. It had a banner and a tab callout but was never mentioned at
        // the moment the driver might act on it.
        var fleetDue = FleetOpsService.DueCheck(s);
        if (fleetDue.IsDue)
            audit.WhatsNext.Add($"Fleet report is due — {fleetDue.Message} File it on the Fleet tab; " +
                                "your hired drivers' revenue does not post until you do.");
        else if (fleetDue.IsSoon)
            audit.WhatsNext.Add($"Fleet report coming due: {fleetDue.Message}");

        // Home time already has its own callout on the summary, so only mention it here when it is
        // actually actionable rather than repeating the note twice.
        if (!audit.GotYouHome && audit.HomeTimeInstructions.Count > 0)
            audit.WhatsNext.Add(audit.HomeTimeInstructions[0]);

        // A trailer change coming at the next home time, said on the way in rather than sprung on
        // arrival. Being told after you have parked is how a wait for the trailer gets tacked onto the
        // end of your home time instead of overlapping with it.
        var homeStatus = HomeTime.Status(s);
        if (homeStatus.Tracked && (homeStatus.DueSoon || homeStatus.Overdue || audit.GotYouHome)
            && HomeTime.ReassignmentNotice(s) is { } reNotice)
            audit.WhatsNext.Add(reNotice);

        return audit;
    }

    /// <summary>Facility time worked out from the trip log rather than typed in from memory.</summary>
    public class FacilityTimes
    {
        public double LoadingHours { get; set; }
        public double UnloadingHours { get; set; }
        public double DetentionHours { get; set; }
        public bool LoadDerived { get; set; }
        public bool UnloadDerived { get; set; }
        public List<string> Explain { get; set; } = new();
    }

    /// <summary>
    /// Carries the clocks across an unload the driver never had a chance to read past.
    ///
    /// Unloading is on-duty-not-driving, so it eats the <b>shift</b> and the <b>cycle</b> and leaves the
    /// <b>drive</b> clock alone. The thirty-minute break counter is driving time, so that is untouched too
    /// — sitting at a dock is not a break and does not reset it.
    ///
    /// This is arithmetic on figures the driver reported, not a simulation, which is the only reason it is
    /// allowed to write clocks at all. It is still marked projected, because a worked-out figure is not a
    /// read one and the app says which it is holding.
    /// </summary>
    private static void CarryClocksAcrossTheDock(AppState s, Trip trip, CompleteTripRequest req,
                                                 TripAudit audit, double spentAtDock,
                                                 bool baselineWasFresh)
    {
        // Any of: the tick, a typed release reading, or an EndUnload logged at the dock. All three say
        // the same thing — the unload has run and the clocks on file are from before it.
        var known = req.UnloadAlreadyRan
                    || !string.IsNullOrWhiteSpace(req.ReleasedGameTime)
                    || trip.Events.Any(e => e.Kind == "EndUnload");
        if (!known || spentAtDock <= 0) return;

        // Only reached when no clocks were reported at all — a reported reading is taken as given and
        // never adjusted, which is what stops the same hours coming off twice.

        // Nothing to carry from unless we know where the driver stood when they arrived. Without a
        // reading the figures on file are from before the drive, and taking only the dock time off them
        // would report a shift clock that never paid for the driving.
        if (!baselineWasFresh && !audit.ClocksReported)
        {
            // Whatever is on file is stale, not projected. Leaving the flag set from an earlier trip
            // would have the panel claim it carried these across an unload it refused to touch.
            s.Hos.Projected = false;
            audit.CarriedForward.Add(
                $"The dock cost {Hhmm.Of(spentAtDock)} of on-duty time, but I have no reading from when you " +
                "arrived to take it off \u2014 what I hold is from before the drive. Report your clocks and I " +
                "will do the arithmetic; until then I am planning on stale figures.");
            return;
        }

        var shiftWas = s.Hos.ShiftRemaining;
        var cycleWas = s.Hos.CycleRemaining;
        s.Hos.ShiftRemaining = Math.Max(0, s.Hos.ShiftRemaining - spentAtDock);
        s.Hos.CycleRemaining = Math.Max(0, s.Hos.CycleRemaining - spentAtDock);
        s.Hos.Projected = true;
        s.Hos.AsOfGameTime = s.Status.GameTime;
        s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");

        audit.CarriedForward.Add(
            $"Clocks carried across the unload: shift {Hhmm.Of(shiftWas)} \u2192 {Hhmm.Of(s.Hos.ShiftRemaining)}, " +
            $"cycle {Hhmm.Of(cycleWas)} \u2192 {Hhmm.Of(s.Hos.CycleRemaining)}. On-duty time, so your drive clock " +
            "and break counter are untouched. Worked out, not read \u2014 check it against your display.");
    }

    /// <summary>
    /// Derives loading, unloading and detention from the Begin/End pairs in the trip log.
    ///
    /// Detention is real money, so it is never a number the driver guesses at — it comes from the
    /// clock times they logged at the dock, and the audit shows the working. Free time is granted per
    /// stop, which is how it works in practice: sitting three hours at a shipper and three at a
    /// receiver is two separate detention claims, not one six-hour one.
    ///
    /// Anything the log cannot answer falls back to what the driver typed, so forgetting to log a pair
    /// degrades to the old behaviour instead of silently recording zero.
    /// </summary>
    public static FacilityTimes DeriveFacilityTimes(AppState s, Trip trip, double typedLoading,
        double typedUnloading, double typedDetention)
    {
        var f = new FacilityTimes();
        var free = Math.Max(0, s.Driver.Pay.DetentionFreeHours);

        double? Span(string beginKind, string endKind)
        {
            var begin = trip.Events.Where(e => e.Kind == beginKind)
                .Select(e => GameClock.TryParse(e.GameTime)).Where(d => d != null).Min();
            var end = trip.Events.Where(e => e.Kind == endKind)
                .Select(e => GameClock.TryParse(e.GameTime)).Where(d => d != null).Max();
            if (begin == null || end == null) return null;
            var hours = (end.Value - begin.Value).TotalHours;
            return hours >= 0 ? hours : null;      // a reversed pair is a typo, not negative time
        }

        var loaded = Span("BeginLoad", "EndLoad");
        var unloaded = Span("BeginUnload", "EndUnload");

        f.LoadingHours = loaded ?? typedLoading;
        f.LoadDerived = loaded != null;
        f.UnloadingHours = unloaded ?? typedUnloading;
        f.UnloadDerived = unloaded != null;

        if (loaded != null)
            f.Explain.Add($"Loading {Hhmm.Of(loaded.Value)} from the log ({Stamp(trip, "BeginLoad")} → {Stamp(trip, "EndLoad")}).");
        if (unloaded != null)
            f.Explain.Add($"Unloading {Hhmm.Of(unloaded.Value)} from the log ({Stamp(trip, "BeginUnload")} → {Stamp(trip, "EndUnload")}).");

        if (loaded == null && unloaded == null)
        {
            // Nothing logged. The driver types time spent at the dock, so net the free window off it
            // here — the stored figure is always billable hours, whichever way it arrived.
            f.DetentionHours = Math.Round(Math.Max(0, typedDetention - free), 2);
            if (typedDetention > 0)
                f.Explain.Add(f.DetentionHours > 0
                    ? $"Detention {Hhmm.Of(f.DetentionHours)} billable from the {Hhmm.Of(typedDetention)} you reported, " +
                      $"less {Hhmm.Of(free)} free. No Begin/End pairs in the log to check it against."
                    : $"Detention {Hhmm.Of(typedDetention)} as reported is inside the {Hhmm.Of(free)} free window — not payable.");
            return f;
        }

        var atShipper = Math.Max(0, f.LoadingHours - free);
        var atReceiver = Math.Max(0, f.UnloadingHours - free);
        f.DetentionHours = Math.Round(atShipper + atReceiver, 2);

        if (f.DetentionHours > 0)
        {
            var parts = new List<string>();
            if (atShipper > 0) parts.Add($"{Hhmm.Of(atShipper)} at the shipper");
            if (atReceiver > 0) parts.Add($"{Hhmm.Of(atReceiver)} at the receiver");
            f.Explain.Add($"Detention {Hhmm.Of(f.DetentionHours)} — {string.Join(" plus ", parts)}, " +
                          $"after {Hhmm.Of(free)} free at each stop.");
        }
        else
        {
            f.Explain.Add($"No detention — both stops came in inside the {Hhmm.Of(free)} free window.");
        }

        // A typed figure that disagrees with the log is worth saying out loud rather than discarding.
        if (typedDetention > 0 && Math.Abs(typedDetention - f.DetentionHours) > 0.25)
            f.Explain.Add($"You reported {Hhmm.Of(typedDetention)} of detention; the log works out to {Hhmm.Of(f.DetentionHours)}. " +
                          "I am paying the log.");

        return f;
    }

    private static string Stamp(Trip trip, string kind)
    {
        var e = trip.Events.Where(x => x.Kind == kind)
            .Select(x => GameClock.TryParse(x.GameTime)).Where(d => d != null)
            .OrderBy(d => d!.Value).FirstOrDefault();
        return e == null ? "?" : GameClock.Pretty(e.Value);
    }

    public class MileageReading
    {
        public double LoadedMiles { get; set; }
        public double StartOdometer { get; set; }
        public double OdometerMiles { get; set; }
        public bool Derived { get; set; }
        public List<string> Explain { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
    }

    /// <summary>
    /// The last odometer reading the driver reported, for a trip that was already rolling before the
    /// app started capturing one at authorization. The most recent close-out is the better source than
    /// the running status, because status can be updated mid-trip and would shorten the delta.
    /// </summary>
    public static double LastReportedOdometer(AppState s, Trip? exclude = null)
    {
        var last = s.Trips
            .Where(t => t.Id != exclude?.Id && t.EndOdometer > 0)
            .OrderByDescending(t => GameClock.TryParse(t.DeliveredGameTime) ?? DateTime.MinValue)
            .FirstOrDefault();
        if (last != null && last.EndOdometer > 0) return last.EndOdometer;
        return Math.Max(0, s.Status.AtsOdometer);
    }

    /// <summary>
    /// Works out how far the truck actually ran.
    ///
    /// The odometer is the number ATS puts on the screen, so it is the number the app trusts: end
    /// minus start is the distance, and loaded miles are that less the deadhead already on the
    /// dispatch. Asking for the odometer *and* the miles run is asking for the same fact twice and
    /// then arguing with the answer — so the typed figure is only an override for when the reading was
    /// missed or mistyped.
    ///
    /// A reading that did not move, went backwards, or lands nowhere near the routing is flagged
    /// before the trip posts. It is a warning and not a block: this app reconciles what the driver saw,
    /// it does not overrule it.
    /// </summary>
    public static MileageReading DeriveMiles(AppState s, Trip trip, double typedMiles, double endOdometer)
    {
        var m = new MileageReading();
        var deadhead = Math.Max(0, trip.DeadheadMiles);
        var planned = Math.Max(0, trip.DispatchedMiles) + deadhead;

        var start = trip.StartOdometer > 0 ? trip.StartOdometer : LastReportedOdometer(s, trip);
        m.StartOdometer = start;

        if (endOdometer > 0 && start > 0)
        {
            var delta = endOdometer - start;
            m.OdometerMiles = delta;

            if (delta < 0)
                m.Warnings.Add($"The ending odometer ({endOdometer:N0}) is lower than the starting one ({start:N0}). " +
                               "An odometer does not run backwards — check for a mistyped digit, or a reading off a different truck.");
            else if (delta < 0.5)
                m.Warnings.Add($"The odometer has not moved off {start:N0}. Either it was not updated after the run, " +
                               "or this reading came from before you rolled.");
            else if (planned > 0 && delta > Math.Max(planned * 2.5, planned + 250))
                m.Warnings.Add($"The odometer says {delta:N0} mi against a routing of {planned:N0} mi. That is far more than the run — " +
                               "a stray digit puts an odometer out by a factor of ten.");
            else if (planned > 0 && delta < planned * 0.5 && planned - delta > 50)
                m.Warnings.Add($"The odometer says {delta:N0} mi against a routing of {planned:N0} mi. That is well short of the run — " +
                               "check the reading before I post it.");
            else
            {
                m.Derived = true;
                m.LoadedMiles = Math.Round(Math.Max(0, delta - deadhead), 0);
                m.Explain.Add(deadhead > 0
                    ? $"Miles from the odometer: {start:N0} → {endOdometer:N0} = {delta:N0} mi, less {deadhead:N0} mi deadhead = {m.LoadedMiles:N0} loaded."
                    : $"Miles from the odometer: {start:N0} → {endOdometer:N0} = {delta:N0} mi.");
            }
        }

        if (typedMiles > 0)
        {
            if (m.Derived && Math.Abs(typedMiles - m.LoadedMiles) > Math.Max(20, m.LoadedMiles * 0.05))
                m.Explain.Add($"You overrode the odometer with {typedMiles:N0} mi; it works out to {m.LoadedMiles:N0}. Using yours.");
            m.LoadedMiles = typedMiles;
            m.Derived = false;
        }
        else if (!m.Derived)
        {
            m.LoadedMiles = trip.DispatchedMiles;
            if (endOdometer > 0 || start > 0)
                m.Explain.Add($"Falling back to the dispatched {trip.DispatchedMiles:N0} mi — the odometer could not settle it and nothing was typed.");
        }

        return m;
    }

    /// <summary>
    /// Rolls the trip's fuel stops up into the totals the rest of the app costs from.
    ///
    /// A stop list wins when one is sent, because that is the detailed truth. The flat
    /// gallons/cost pair is still accepted for a single fill, and gets promoted to a one-line stop
    /// list so every trip stores fuel the same shape regardless of how it was entered.
    /// </summary>
    private static void RecordFuel(Trip trip, CompleteTripRequest req, TripAudit audit)
    {
        if (req.FuelStops != null)
            trip.FuelStops = req.FuelStops.Where(f => f.Gallons > 0 || f.Total() > 0).ToList();

        foreach (var f in trip.FuelStops)
        {
            if (f.Cost <= 0) f.Cost = f.Total();
            // Back out the price when the driver gave us a total instead — a blended price per gallon
            // is what the cost model calibrates against.
            if (f.PricePerGal <= 0 && f.Gallons > 0) f.PricePerGal = Math.Round(f.Cost / (decimal)f.Gallons, 3);
            if (string.IsNullOrWhiteSpace(f.GameTime)) f.GameTime = trip.DeliveredGameTime;
        }

        if (trip.FuelStops.Count > 0)
        {
            trip.FuelGallons = Math.Round(trip.FuelStops.Sum(f => f.Gallons), 2);
            trip.FuelCost = Math.Round(trip.FuelStops.Sum(f => f.Cost), 2);
        }
        else
        {
            // Single-fill shorthand. Keep it as a stop so the trip record is uniform.
            trip.FuelGallons = req.FuelGallons;
            trip.FuelCost = req.FuelCost;
            if (req.FuelGallons > 0 || req.FuelCost > 0)
            {
                trip.FuelStops.Add(new FuelPurchase
                {
                    GameTime = trip.DeliveredGameTime,
                    City = string.IsNullOrWhiteSpace(req.LocationCity) ? trip.DestCity : req.LocationCity,
                    State = string.IsNullOrWhiteSpace(req.LocationState) ? trip.DestState : req.LocationState,
                    Gallons = req.FuelGallons,
                    Cost = req.FuelCost,
                    PricePerGal = req.FuelGallons > 0 ? Math.Round(req.FuelCost / (decimal)req.FuelGallons, 3) : 0
                });
            }
        }

        if (trip.FuelStops.Count > 1)
        {
            var blended = trip.FuelGallons > 0 ? trip.FuelCost / (decimal)trip.FuelGallons : 0;
            audit.MoneyFindings.Add(
                $"{trip.FuelStops.Count} fuel stops: {trip.FuelGallons:N1} gal for ${trip.FuelCost:N2}, blended ${blended:0.000}/gal.");

            var dear = trip.FuelStops.Where(f => f.PricePerGal > 0).OrderByDescending(f => f.PricePerGal).FirstOrDefault();
            var cheap = trip.FuelStops.Where(f => f.PricePerGal > 0).OrderBy(f => f.PricePerGal).FirstOrDefault();
            if (dear != null && cheap != null && dear != cheap && dear.PricePerGal - cheap.PricePerGal >= 0.25m)
                audit.MoneyFindings.Add(
                    $"Spread of ${dear.PricePerGal - cheap.PricePerGal:0.00}/gal between {Where(cheap)} (${cheap.PricePerGal:0.000}) and " +
                    $"{Where(dear)} (${dear.PricePerGal:0.000}). Worth planning fuel stops around on this lane.");
        }
    }

    private static string Where(FuelPurchase f) =>
        string.IsNullOrWhiteSpace(f.City) ? (string.IsNullOrWhiteSpace(f.Vendor) ? "an unnamed stop" : f.Vendor)
                                          : DispatchEngine.Place(f.City, f.State);

    private static bool DetermineLate(AppState s, Trip trip, CompleteTripRequest req, out string note)
    {
        var grace = Math.Max(0, s.Settings.AppointmentGraceHours);
        if (trip.Kind != "Freight") { note = "Non-revenue move — no service window."; return false; }

        var due = GameClock.TryParse(trip.DueGameTime);
        var del = GameClock.TryParse(trip.DeliveredGameTime);

        // A delivery before the window opened did not happen the way it was reported — the receiver
        // was not taking it yet, so either the time is wrong or the window was. Said, not blocked:
        // this app reconciles what the driver saw, the same as it does for an odometer that reads
        // backwards.
        if (del != null && !trip.ReceiverTakesEarly
            && GameClock.TryParse(trip.AppointmentOpensGameTime) is { } opens && del < opens)
            trip.WindowWarning =
                $"Delivered {GameClock.Pretty(del.Value)}, but the window did not open until " +
                $"{GameClock.Pretty(opens)}. They would not have taken it yet — check the delivery time, " +
                "or correct the window if that is what is wrong.";

        if (due != null && del != null)
        {
            var margin = (due.Value - del.Value).TotalHours;

            // Missing the booked slot is not instantly a service failure — traffic happens and a
            // receiver with the doors still open is not writing you up over ninety minutes. Past the
            // grace it counts, even though the window is still open. Where the receiver took the load
            // whenever it arrived, there was no slot to miss.
            // Never fail a driver against a slot our own plan did not reach. Placement keeps that from
            // happening at dispatch, but a plan can change underneath a load — a reroute, a breakdown,
            // an operational 34 — and leave an old slot behind it. This produced a false strike on a
            // real career once; it does not get to happen twice.
            var plannedArrival = GameClock.TryParse(trip.FeasibilityAtDispatch?.ProjectedArrivalGameTime ?? "");

            if (margin >= 0 && !trip.ReceiverTakesEarly
                && GameClock.TryParse(trip.AppointmentGameTime) is { } slot
                && (plannedArrival == null || plannedArrival.Value <= slot.AddHours(grace)))
            {
                var pastSlot = (del.Value - slot).TotalHours;
                if (pastSlot > grace)
                {
                    note = $"Delivered {GameClock.Pretty(del.Value)} against a {GameClock.Pretty(slot)} " +
                           $"appointment — {Hhmm.Of(pastSlot)} past the slot, beyond the {Hhmm.Of(grace)} " +
                           "grace. Inside the window, but the dock was expecting you earlier.";
                    return true;
                }
                if (pastSlot > 0)
                {
                    note = $"Delivered {GameClock.Pretty(del.Value)} against a {GameClock.Pretty(slot)} " +
                           $"appointment — {Hhmm.Of(pastSlot)} past the slot, inside the {Hhmm.Of(grace)} grace.";
                    return false;
                }
            }

            note = margin >= 0
                ? $"Delivered {GameClock.Pretty(del.Value)} against a {GameClock.Pretty(due.Value)} appointment — {Hhmm.Of(margin)} early."
                : $"Delivered {GameClock.Pretty(del.Value)} against a {GameClock.Pretty(due.Value)} appointment — {Hhmm.Of(Math.Abs(margin))} LATE.";
            return margin < 0;
        }

        if (req.DeliveredLate.HasValue)
        {
            note = req.DeliveredLate.Value
                ? "ATS flagged the load late (no game timestamps available to measure by)."
                : "Delivered inside the window per ATS (no game timestamps available to measure by).";
            return req.DeliveredLate.Value;
        }

        note = "No delivery timestamp and no late flag reported — recorded as on time. Report the game clock next time so the record is real.";
        return false;
    }

    private static (string fault, string rationale) AttributeFault(AppState s, Trip trip, CompleteTripRequest req, bool late)
    {
        if (!late) return ("None", "");

        if (!string.IsNullOrWhiteSpace(req.FaultOverride))
            return (req.FaultOverride, $"Operations recorded this as {Humanize(req.FaultOverride)} fault by review.");

        // The company owns loads it should never have booked.
        var f = trip.FeasibilityAtDispatch;
        if (f != null)
        {
            if (f.Verdict == "Tight" || f.SlackHours < f.RequiredBufferHours)
                return ("Dispatcher", $"Dispatcher fault. This load was authorized with only {Hhmm.Of(f.SlackHours)} of slack against a {Hhmm.Of(f.RequiredBufferHours)} required buffer — I booked it too tight. Not on your record.");
            if (f.CycleRestartRequired)
                return ("Dispatcher", "Dispatcher fault. The plan required a cycle restart mid-trip. That was my planning error.");
        }
        else
        {
            return ("Dispatcher", "Dispatcher fault. This load was committed without a recorded feasibility check, which is a violation of our own dispatch policy.");
        }

        // The window closing while they were still at the dock. Judged from the clocks they reported
        // rather than from whether they thought to write "detention" in the notes — a driver stuck on a
        // receiver's property should not have to know the magic word to avoid a mark on their record.
        if (req.HosShiftRemaining is <= 0.1 || req.HosDriveRemaining is <= 0.1)
        {
            if (f != null && f.ShiftRemainingOnArrival < s.Settings.StrandedMarginHours)
                return ("Dispatcher",
                    $"Dispatcher fault. The plan had you finishing with {Hhmm.Of(f.ShiftRemainingOnArrival)} of window in hand, " +
                    "and the dock took the rest. Booking a load that tight to the window is my error, not yours.");
            return ("Unavoidable",
                "The dock held you until your hours ran out. Finishing the work was legal, moving the truck was not, and " +
                "sitting there was the only lawful option. Detention applies and nothing attaches to your record.");
        }

        var reason = (req.DelayReason ?? "").ToLowerInvariant();
        if (Mentions(reason, "breakdown", "mechanical", "engine", "blew", "tire", "flat", "tow", "malfunction"))
            return ("Mechanical", "Mechanical failure. Equipment problem, not a driver problem — maintenance issue for the shop.");
        if (Mentions(reason, "traffic", "accident", "closure", "closed", "construction", "detour", "weather", "snow", "ice", "fog", "scale", "inspection", "dot"))
            return ("Unavoidable", "Non-preventable delay. Road conditions outside your control — no discipline attaches.");
        if (Mentions(reason, "game", "crash", "bug", "mod", "save", "reload", "desync", "glitch"))
            return ("GameLimitation", "Recorded as a game limitation, not a real service failure. It does not count against you or the company's service score.");
        if (Mentions(reason, "shipper", "receiver", "dock", "detention", "waiting", "loading"))
            return ("Unavoidable", "Facility delay at the dock. Detention applies; no fault to the driver.");
        if (Mentions(reason, "overslept", "slept", "stopped", "forgot", "parked", "late start", "took my time"))
            return ("Driver", "Driver-preventable. The plan had adequate slack and it was not used.");

        return ("Driver", $"Driver-preventable by default: the load was authorized with {Hhmm.Of(f?.SlackHours)} of slack " +
                          "and the plan was sound. If that is not the whole story, say whose fault it was on the " +
                          "close-out — there is a box for it, and anything other than yours leaves your record alone.");
    }

    private static bool Mentions(string text, params string[] words) => words.Any(text.Contains);

    /// <summary>
    /// A damage spike is presumed preventable, but not blindly — a blowout, a deer strike or a
    /// game glitch is not a driver failing, and the driver gets to state the cause.
    /// </summary>
    private static (string fault, string why) AttributeDamage(CompleteTripRequest req, double jump)
    {
        if (!string.IsNullOrWhiteSpace(req.FaultOverride))
            return (req.FaultOverride, $"Damage rose {jump:0.#} points; operations attributed it to {Humanize(req.FaultOverride)} on review.");

        var text = ((req.DamageCause ?? "") + " " + (req.DelayReason ?? "")).ToLowerInvariant();

        if (Mentions(text, "blowout", "blew a", "tire failed", "recap", "mechanical", "brake failure", "steering failed", "air line"))
            return ("Mechanical", $"Damage rose {jump:0.#} points from an equipment failure. That is a shop problem, not a driver problem — no discipline attaches.");
        if (Mentions(text, "deer", "animal", "rock", "debris", "hail", "wind", "ice", "black ice", "someone hit me", "rear-ended", "cut me off", "ran me off"))
            return ("Unavoidable", $"Damage rose {jump:0.#} points from a non-preventable event. Recorded, but it does not count against you.");
        if (Mentions(text, "game", "bug", "glitch", "ai traffic", "spawned", "clipped through", "physics", "mod", "reload", "save"))
            return ("GameLimitation", $"Damage rose {jump:0.#} points from a game artifact rather than real driving. Logged as a game limitation only.");
        if (Mentions(text, "dispatch", "rushed", "too tight", "pushed"))
            return ("Dispatcher", $"Damage rose {jump:0.#} points on a load I pushed you to run. That is on operations.");

        return ("Driver", $"Damage rose {jump:0.#} points with no stated cause, so it is recorded as preventable. Tell me what happened and I will re-attribute it.");
    }

    private static void UpdateEquipment(AppState s, Trip trip, TripAudit audit, CompleteTripRequest req)
    {
        var m = s.Settings.Maintenance;
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == trip.TruckUnit);
        var trailer = s.Trailers.FirstOrDefault(t => t.Unit == trip.TrailerUnit);
        var tripMiles = trip.ActualMiles + trip.DeadheadMiles;

        if (truck != null)
        {
            // The company's odometer advances by what the game says the truck moved, never by being
            // overwritten with the game's absolute figure. The two cannot be reconciled: the odometer
            // cannot be set in ATS, so a unit the books call 200,000 miles may read almost nothing.
            if (trip.EndOdometer > 0 && truck.AtsOdometer > 0)
            {
                var moved = trip.EndOdometer - truck.AtsOdometer;
                if (moved >= 0) truck.ServiceMiles = Math.Round(truck.ServiceMiles + moved, 0);
                else
                {
                    // Lower than last time: a replacement unit in game. New baseline, no miles added.
                    truck.ServiceMiles = Math.Round(truck.ServiceMiles + tripMiles, 0);
                    audit.EquipmentFindings.Add(
                        $"Unit {truck.Ref}: the game reads {trip.EndOdometer:N0} against {truck.AtsOdometer:N0} last " +
                        "time. Taking that as a replacement unit and starting the reading again — our own odometer " +
                        $"carries on at {truck.ServiceMiles:N0} mi.");
                }
                truck.AtsOdometer = trip.EndOdometer;
            }
            else
            {
                truck.ServiceMiles = Math.Round(truck.ServiceMiles + tripMiles, 0);
                if (trip.EndOdometer > 0) truck.AtsOdometer = trip.EndOdometer;
            }

            truck.DamagePct = trip.TruckDamageAfter;
            s.Status.TruckDamagePct = trip.TruckDamageAfter;
            s.Status.AtsOdometer = truck.AtsOdometer;
            audit.EquipmentFindings.Add($"Unit {truck.Ref}: {truck.DamagePct:0.#}% damage, {truck.ServiceMiles:N0} mi on our books" +
                                        (Math.Abs(truck.ServiceMiles - truck.AtsOdometer) > 1
                                            ? $" (your game reads {truck.AtsOdometer:N0} — the books are what we judge on)."
                                            : "."));

            var sinceService = truck.ServiceMiles - truck.LastServiceMiles;
            if (sinceService >= truck.ServiceIntervalMiles)
                audit.Directives.Add($"Unit {truck.Ref} is {sinceService - truck.ServiceIntervalMiles:N0} mi past its {truck.ServiceIntervalMiles:N0}-mile PM. Schedule the service at the next terminal.");
            else if (sinceService >= truck.ServiceIntervalMiles * 0.9)
                audit.EquipmentFindings.Add($"PM due in {truck.ServiceIntervalMiles - sinceService:N0} mi on unit {truck.Ref}.");
        }

        if (trailer != null)
        {
            trailer.ServiceMiles = Math.Round(trailer.ServiceMiles + tripMiles, 0);
            trailer.DamagePct = trip.TrailerDamageAfter;
            trailer.CurrentLocation = DispatchEngine.Place(
                string.IsNullOrWhiteSpace(req.LocationCity) ? trip.DestCity : req.LocationCity,
                string.IsNullOrWhiteSpace(req.LocationState) ? trip.DestState : req.LocationState);
            s.Status.TrailerDamagePct = trip.TrailerDamageAfter;
            audit.EquipmentFindings.Add($"Trailer {trailer.Ref}: {trailer.DamagePct:0.#}% damage, now at {trailer.CurrentLocation}.");
        }

        var worst = Math.Max(trip.TruckDamageAfter, trip.TrailerDamageAfter);
        var worstUnit = trip.TruckDamageAfter >= trip.TrailerDamageAfter
            ? $"unit {trip.TruckUnit}" : $"trailer {trip.TrailerUnit}";

        if (worst >= m.OutOfServicePct)
        {
            audit.MaintenanceStatus = "OutOfService";
            audit.Directives.Add($"STOP — {worstUnit} is at {worst:0.#}% damage, at or over our {m.OutOfServicePct:0}% out-of-service line. Do not take another load. Nearest shop, then report to operations.");
            if (trip.TruckDamageAfter >= m.OutOfServicePct && truck != null) truck.Status = "OutOfService";
            if (trip.TrailerDamageAfter >= m.OutOfServicePct && trailer != null) trailer.Status = "OutOfService";
            audit.WorkOrderNumber = MaintenanceService.OpenWorkOrder(s, new WorkOrder
            {
                Unit = trip.TruckDamageAfter >= m.OutOfServicePct ? trip.TruckUnit : trip.TrailerUnit,
                UnitKind = trip.TruckDamageAfter >= m.OutOfServicePct ? "Truck" : "Trailer",
                Kind = "Damage",
                Description = $"Out-of-service damage at {worst:0.#}% after {trip.Number}.",
                LocationCity = trip.DestCity, LocationState = trip.DestState,
                DamageBefore = worst, Status = "Open",
                GameTime = trip.DeliveredGameTime,
                OdometerAtService = trip.EndOdometer
            }).Number;
        }
        else if (worst >= m.MandatoryReviewPct)
        {
            audit.MaintenanceStatus = "MandatoryReview";
            audit.Directives.Add($"Mandatory maintenance review: {worstUnit} is at {worst:0.#}% (threshold {m.MandatoryReviewPct:0}%). Get it repaired before your next dispatch — company pays.");
            audit.WorkOrderNumber = MaintenanceService.OpenWorkOrder(s, new WorkOrder
            {
                Unit = trip.TruckDamageAfter >= trip.TrailerDamageAfter ? trip.TruckUnit : trip.TrailerUnit,
                UnitKind = trip.TruckDamageAfter >= trip.TrailerDamageAfter ? "Truck" : "Trailer",
                Kind = "Repair",
                Description = $"Damage at {worst:0.#}% after {trip.Number} — mandatory review threshold.",
                LocationCity = trip.DestCity, LocationState = trip.DestState,
                DamageBefore = worst, Status = "Open",
                GameTime = trip.DeliveredGameTime,
                OdometerAtService = trip.EndOdometer
            }).Number;
        }
        else if (worst >= m.ReportPct)
        {
            audit.MaintenanceStatus = "Report";
            audit.Directives.Add($"Reportable wear: {worstUnit} at {worst:0.#}%. Keep running, but get it fixed at the next terminal or major stop.");
        }
        else
        {
            audit.MaintenanceStatus = "Monitor";
            audit.EquipmentFindings.Add($"Equipment condition is fine at {worst:0.#}% — monitor only.");
        }
    }

    public static Trip Cancel(AppState s, string tripId, string reason, string fault, bool chargeCompany)
    {
        var trip = s.Trips.FirstOrDefault(t => t.Id == tripId)
                   ?? throw new InvalidOperationException("Trip not found.");
        if (trip.Status is "Delivered" or "Cancelled")
            throw new InvalidOperationException($"{trip.Number} is already closed.");

        // Cancelled loads move to the cancellation series so freight numbers stay a clean sequence.
        var original = trip.Number;
        trip.Number = DispatchEngine.TakeNumber(s, "Cancelled");
        trip.Status = "Cancelled";
        trip.ServiceResult = "NotApplicable";
        trip.CancelReason = reason;
        trip.FaultAttribution = string.IsNullOrWhiteSpace(fault) ? "Dispatcher" : fault;
        trip.ClosedUtc = DateTime.UtcNow.ToString("o");
        trip.CompanyRevenue = 0;
        trip.Notes = $"Originally dispatched as {original}. {trip.Notes}".Trim();
        trip.Events.Add(new TripEvent
        {
            GameTime = s.Status.GameTime, Kind = "Note",
            Detail = $"Cancelled ({trip.FaultAttribution} fault): {reason}"
        });

        // Driver still gets paid for miles actually run on a company-caused cancellation.
        if (trip.FaultAttribution != "Driver")
        {
            trip.Pay = PayEngine.ComputeTripPay(s, trip);
            if (trip.Pay.Total <= 0 && trip.Kind == "Freight")
            {
                trip.Pay.BreakdownPay = s.Driver.Pay.BreakdownPerDay;
                trip.Pay.Total = s.Driver.Pay.BreakdownPerDay;
                trip.Pay.Lines.Add($"Company-caused cancellation — one day of breakdown/detention pay = ${trip.Pay.Total:N2}");
            }
            s.Driver.UnsettledPay = Math.Round(s.Driver.UnsettledPay + trip.Pay.Total, 2);
        }

        LedgerService.PostCancellation(s, trip, chargeCompany);
        if (s.Status.ActiveTripId == trip.Id) s.Status.ActiveTripId = "";
        CareerService.Recalculate(s);
        return trip;
    }

    private static string Humanize(string fault) => fault switch
    {
        "GameLimitation" => "game limitation",
        "Dispatcher" => "dispatcher",
        "Mechanical" => "mechanical",
        "Unavoidable" => "unavoidable",
        "Driver" => "driver",
        _ => fault.ToLowerInvariant()
    };
}
