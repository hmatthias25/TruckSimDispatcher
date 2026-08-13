using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

// ---------------------------------------------------------------- startup

var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
var store = new StateStore(exeDir);

var port = 5173;
var openBrowser = true;
for (var i = 0; i < args.Length; i++)
{
    if (args[i] is "--port" or "-p" && i + 1 < args.Length && int.TryParse(args[i + 1], out var p)) port = p;
    if (args[i] is "--no-browser") openBrowser = false;
}
port = FindFreePort(port);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args });
builder.Logging.ClearProviders();
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.PropertyNameCaseInsensitive = true;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
});

var app = builder.Build();
var ui = LoadEmbeddedUi();

app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Exception ex)
    {
        ctx.Response.StatusCode = 400;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

// ---------------------------------------------------------------- UI

app.MapGet("/", () => Results.Content(ui["ui/index.html"], "text/html; charset=utf-8"));
app.MapGet("/app.js", () => Results.Content(ui["ui/app.js"], "text/javascript; charset=utf-8"));
app.MapGet("/styles.css", () => Results.Content(ui["ui/styles.css"], "text/css; charset=utf-8"));
app.MapGet("/favicon.ico", () => Results.NoContent());

// ---------------------------------------------------------------- state

app.MapGet("/api/bootstrap", () => Results.Ok(Snapshot()));

app.MapPost("/api/status", (StatusUpdate u) => Results.Ok(store.Mutate<object>(s =>
{
    if (u.LocationCity != null) s.Status.LocationCity = u.LocationCity.Trim();
    if (u.LocationState != null) s.Status.LocationState = u.LocationState.Trim().ToUpperInvariant();
    if (u.LocationKind != null) s.Status.LocationKind = u.LocationKind;
    if (u.LocationDetail != null) s.Status.LocationDetail = u.LocationDetail;
    if (u.GameTime != null) s.Status.GameTime = u.GameTime;
    if (u.FuelPct.HasValue) s.Status.FuelPct = Math.Clamp(u.FuelPct.Value, 0, 100);
    if (u.TruckDamagePct.HasValue) s.Status.TruckDamagePct = Math.Clamp(u.TruckDamagePct.Value, 0, 100);
    if (u.TrailerDamagePct.HasValue) s.Status.TrailerDamagePct = Math.Clamp(u.TrailerDamagePct.Value, 0, 100);
    if (u.AtsOdometer.HasValue) s.Status.AtsOdometer = u.AtsOdometer.Value;
    if (u.AtsBankBalance.HasValue)
    {
        s.Status.AtsBankBalance = u.AtsBankBalance.Value;
        s.Status.AtsBalanceGameTime = s.Status.GameTime;
    }
    if (u.DutyStatus != null) s.Status.DutyStatus = u.DutyStatus;
    if (u.Notes != null) s.Status.Notes = u.Notes;
    s.Status.UpdatedUtc = DateTime.UtcNow.ToString("o");

    // The driver has now signed off on these readings, whether they edited them or accepted what the
    // last close-out carried forward.
    s.Status.Confirmed = true;
    s.Status.CarriedForwardFrom = "";

    // Keep the assigned units in step with what the driver reports from the game.
    var tk = DispatchEngine.AssignedTruck(s);
    if (tk != null)
    {
        if (u.TruckDamagePct.HasValue) tk.DamagePct = s.Status.TruckDamagePct;
        if (u.AtsOdometer.HasValue) tk.AtsOdometer = s.Status.AtsOdometer;
    }
    var tr = DispatchEngine.AssignedTrailer(s);
    if (tr != null && u.TrailerDamagePct.HasValue) tr.DamagePct = s.Status.TrailerDamagePct;

    // Arriving somewhere new grows the network — and may be worth a yard.
    var discovery = DiscoveryService.Note(s, s.Status.LocationCity, s.Status.LocationState, s.Status.GameTime);

    return new { snapshot = Snapshot(s), discovery };
})));

// ---------------------------------------------------------------- discovery

app.MapPost("/api/discovery/note", (DiscoverRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    if (string.IsNullOrWhiteSpace(req.City)) throw new InvalidOperationException("Which city?");
    var notice = DiscoveryService.Note(s, req.City, req.State, s.Status.GameTime);
    return new { snapshot = Snapshot(s), discovery = notice, already = notice == null };
})));

app.MapPost("/api/discovery/decline", (DiscoverRequest req) => Results.Ok(store.Mutate(s =>
{
    var hit = DiscoveryService.Find(s, req.City, req.State)
              ?? throw new InvalidOperationException("That city is not on our discovered list.");
    hit.Declined = true;
    hit.Notified = true;
    store.Log(s, "dispatch", $"Passed on a yard in {DispatchEngine.Place(hit.City, hit.State)}.");
    return Snapshot(s);
})));

app.MapPost("/api/discovery/reconsider", (DiscoverRequest req) => Results.Ok(store.Mutate(s =>
{
    var hit = DiscoveryService.Find(s, req.City, req.State)
              ?? throw new InvalidOperationException("That city is not on our discovered list.");
    hit.Declined = false;
    return Snapshot(s);
})));

app.MapPost("/api/hos", (HosSnapshot h) => Results.Ok(store.Mutate(s =>
{
    s.Hos.DriveRemaining = Math.Max(0, h.DriveRemaining);
    s.Hos.ShiftRemaining = Math.Max(0, h.ShiftRemaining);
    s.Hos.BreakRemaining = Math.Max(0, h.BreakRemaining);
    s.Hos.CycleRemaining = Math.Max(0, h.CycleRemaining);
    s.Hos.Recap = h.Recap ?? new();
    s.Hos.Source = h.Source ?? "";
    s.Hos.Notes = h.Notes ?? "";
    s.Hos.AsOfGameTime = string.IsNullOrWhiteSpace(h.AsOfGameTime) ? s.Status.GameTime : h.AsOfGameTime;
    s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
    store.Log(s, "dispatch", $"HOS reported: drive {s.Hos.DriveRemaining:0.##}, shift {s.Hos.ShiftRemaining:0.##}, break {s.Hos.BreakRemaining:0.##}, cycle {s.Hos.CycleRemaining:0.##}");
    return Snapshot(s);
})));

app.MapPost("/api/hos/plan", (PlanRequest req) =>
{
    var s = store.State;
    var truck = DispatchEngine.AssignedTruck(s);
    if (req.UsableFuelRangeMiles >= 9999)
        req.UsableFuelRangeMiles = HosEngine.UsableRange(s.Settings, truck, s.Status.FuelPct);
    if (req.LoadingHours <= 0) req.LoadingHours = s.Settings.DefaultLoadingHours;
    if (req.UnloadingHours <= 0) req.UnloadingHours = s.Settings.DefaultUnloadingHours;
    return Results.Ok(HosEngine.Plan(s, req, truck));
});

app.MapPost("/api/settings", (AppSettings incoming) => Results.Ok(store.Mutate(s =>
{
    var keepKey = s.Settings.AnthropicApiKey;
    s.Settings = incoming;
    // A blank key in the payload means "unchanged", so the key is never echoed to the browser.
    if (string.IsNullOrWhiteSpace(incoming.AnthropicApiKey)) s.Settings.AnthropicApiKey = keepKey;
    if (string.IsNullOrWhiteSpace(s.Settings.FreightPrefix)) s.Settings.FreightPrefix = s.Company.Code;
    return Snapshot(s);
})));

// ---------------------------------------------------------------- onboarding

app.MapPost("/api/onboarding/screen", (DriverApplication a) => Results.Ok(Seed.Screen(a)));

/// The job market. Records the application, then shows every carrier and whether they would take
/// this driver right now. A "no" here is not final — it is a target to come back to.
app.MapPost("/api/onboarding/market", (DriverApplication a) => Results.Ok(store.Mutate(s =>
{
    s.Application = a;
    return new { market = Carriers.Market(s, includeCurrent: true), application = a };
})));

app.MapGet("/api/market", () => Results.Ok(new
{
    market = Carriers.Market(store.State),
    current = store.State.Company.Code,
    canQuit = store.State.Onboarded
}));

/// Applying to another carrier while employed. Being accepted ends the current stint and starts a
/// new one; the driver's record follows them, the company's books do not.
app.MapPost("/api/market/apply", (CarrierApplication req) => Results.Ok(store.Mutate<object>(s =>
{
    if (!s.Onboarded) throw new InvalidOperationException("Finish onboarding first.");
    if (string.Equals(req.Code, s.Company.Code, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("That is who you already work for.");

    var open = s.Trips.FirstOrDefault(t => t.Status is "Authorized" or "InTransit");
    if (open != null)
        throw new InvalidOperationException($"{open.Number} is still open. Finish or cancel it before you resign.");
    if (s.Driver.UnsettledPay > 0)
        throw new InvalidOperationException($"You have ${s.Driver.UnsettledPay:N2} in unsettled pay. Run a settlement first — you will not see it after you leave.");

    var decision = Carriers.Screen(s, req.Code);
    if (!decision.Hired)
        return new { hired = false, decision, snapshot = (object?)null };

    // Close out the stint that is ending.
    var stats = CareerService.Compute(s);
    s.Driver.EmploymentHistory.Insert(0, new EmploymentRecord
    {
        CarrierCode = s.Company.Code,
        CarrierName = s.Company.Name,
        StartedGameDate = s.Driver.HiredGameDate,
        EndedGameDate = s.Status.GameTime,
        RankAtExit = s.Driver.RankTitle,
        LoadsDelivered = stats.LoadsDelivered,
        Miles = stats.TotalMiles,
        OnTimePct = stats.OnTimePct,
        DriverFaultIncidents = stats.DriverFaultIncidents,
        Earnings = s.Driver.LifetimeEarnings,
        Separation = "Resigned",
        Reason = req.Reason ?? ""
    });
    s.Driver.PriorLoads += stats.LoadsDelivered;
    s.Driver.PriorMiles += stats.TotalMiles;
    s.Driver.PriorFaultIncidents += stats.DriverFaultIncidents;

    var leaving = s.Company.Name;

    // New employer: new books, new fleet, new probation. The driver's record carries over.
    s.Trips.Clear();
    s.Board.Clear();
    s.Settlements.Clear();
    s.Ledger.Clear();
    s.WorkOrders.Clear();
    s.Incidents.Clear();
    s.Discipline.Clear();
    s.Counters = new Counters();
    s.Driver.Transfers.Clear();
    s.Driver.HomeTerminalId = "";
    s.Status.ActiveTripId = "";

    var carriedApp = s.Application ?? new DriverApplication();
    Carriers.Employ(s, req.Code, carriedApp);
    Seed.CreateFleet(s, carriedApp);
    Carriers.ApplyPayScale(s, req.Code, carriedApp);
    var (truck, trailer) = Seed.AssignEquipment(s, carriedApp);

    s.Driver.Status = "Probation";
    s.Driver.Rank = "probationary";
    s.Driver.RankTitle = "Probationary Company Driver";
    s.Driver.HiredGameDate = s.Status.GameTime;
    s.Driver.Probation = new ProbationPlan
    {
        Active = true,
        RequiredLoads = s.Driver.PriorLoads >= 40 ? 5 : 10,
        RequiredMiles = s.Driver.PriorLoads >= 40 ? 3000 : 6000,
        DurationDays = s.Driver.PriorLoads >= 40 ? 45 : 90,
        StartedGameDate = s.Status.GameTime,
        Notes = s.Driver.PriorLoads >= 40 ? "Shortened on verified history from previous carriers." : "Standard probation."
    };
    s.Driver.EmployeeId = $"{s.Company.Code}-{1000 + Math.Abs(s.Driver.Name.GetHashCode() % 9000)}";
    s.Driver.UnsettledPay = 0;
    s.Status.LocationCity = s.Company.TerminalCity;
    s.Status.LocationState = s.Company.TerminalState;
    s.Status.LocationKind = "Terminal";
    s.Status.LocationDetail = $"{s.Company.Name} yard";
    var hqTerminal = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
    if (hqTerminal != null) s.Driver.HomeTerminalId = hqTerminal.Id;

    store.Log(s, "career", $"Resigned from {leaving} and hired at {s.Company.Name} as {s.Driver.RankTitle}.");

    return new
    {
        hired = true, decision, truck, trailer,
        setup = Carriers.SetupChecklist(s),
        snapshot = (object?)Snapshot(s)
    };
})));

app.MapPost("/api/onboarding/hire", (HireRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var a = req.Application;
    s.Application = a;

    // The driver picks who to apply to; that carrier decides whether to take them.
    var decision = string.IsNullOrWhiteSpace(req.Code) ? Seed.Screen(a) : Carriers.Screen(s, req.Code);
    if (!decision.Hired && !req.Force)
        return new { hired = false, decision, snapshot = (object?)null };

    if (!string.IsNullOrWhiteSpace(req.GameTime)) s.Status.GameTime = req.GameTime;
    if (!string.IsNullOrWhiteSpace(a.HomeCity)) { s.Status.LocationCity = a.HomeCity; s.Status.LocationState = a.HomeState; }

    if (string.IsNullOrWhiteSpace(req.Code)) Seed.CreateCompany(s, a);
    else Carriers.Employ(s, req.Code, a);
    Seed.CreateFleet(s, a);
    Seed.HireDriver(s, a, decision);
    // HireDriver has its own generic starting-rate table; the employer's posted scale wins.
    if (!string.IsNullOrWhiteSpace(req.Code)) Carriers.ApplyPayScale(s, req.Code, a);
    var (truck, trailer) = Seed.AssignEquipment(s, a);

    s.Status.LocationCity = s.Company.TerminalCity;
    s.Status.LocationState = s.Company.TerminalState;
    s.Status.LocationKind = "Terminal";
    s.Status.LocationDetail = $"{s.Company.Name} yard";
    s.Status.DutyStatus = "OffDuty";
    s.Status.FuelPct = 100;

    // Fresh driver starts a clean cycle.
    s.Hos = new HosSnapshot
    {
        DriveRemaining = s.Settings.Hos.DriveLimit,
        ShiftRemaining = s.Settings.Hos.ShiftLimit,
        BreakRemaining = s.Settings.Hos.DrivingBeforeBreak,
        CycleRemaining = s.Settings.Hos.CycleLimit,
        AsOfGameTime = s.Status.GameTime,
        Source = "Orientation — full clocks",
        UpdatedUtc = DateTime.UtcNow.ToString("o")
    };

    LedgerService.Post(s, LedgerService.Operating, 0, "Opening",
        $"Driver {s.Driver.Name} onboarded as {s.Driver.RankTitle}.");
    s.Onboarded = true;
    store.Log(s, "career", $"{s.Driver.Name} hired at {s.Company.Name} as {s.Driver.RankTitle}.");

    var hqTerminal = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
    if (hqTerminal != null) s.Driver.HomeTerminalId = hqTerminal.Id;

    return new
    {
        hired = true,
        decision,
        company = s.Company,
        truck,
        trailer,
        directive = BuildFirstDispatch(s, truck, trailer),
        setup = Carriers.SetupChecklist(s),
        snapshot = (object?)Snapshot(s)
    };
})));

// ---------------------------------------------------------------- freight board

app.MapPost("/api/board", (List<BoardLoad> loads) => Results.Ok(store.Mutate(s =>
{
    s.Board = loads ?? new();
    foreach (var l in s.Board)
    {
        if (string.IsNullOrWhiteSpace(l.Id)) l.Id = Guid.NewGuid().ToString("N")[..8];
        if (string.IsNullOrWhiteSpace(l.OriginCity)) { l.OriginCity = s.Status.LocationCity; l.OriginState = s.Status.LocationState; }
        l.OriginState = (l.OriginState ?? "").Trim().ToUpperInvariant();
        l.DestState = (l.DestState ?? "").Trim().ToUpperInvariant();
    }
    return DispatchEngine.EvaluateBoard(s);
})));

app.MapPost("/api/board/add", (BoardLoad l) => Results.Ok(store.Mutate(s =>
{
    if (string.IsNullOrWhiteSpace(l.Id)) l.Id = Guid.NewGuid().ToString("N")[..8];
    if (string.IsNullOrWhiteSpace(l.OriginCity)) { l.OriginCity = s.Status.LocationCity; l.OriginState = s.Status.LocationState; }
    l.OriginState = (l.OriginState ?? "").Trim().ToUpperInvariant();
    l.DestState = (l.DestState ?? "").Trim().ToUpperInvariant();
    if (string.IsNullOrWhiteSpace(l.TrailerType)) l.TrailerType = DispatchEngine.AssignedTrailer(s)?.Type ?? "";
    s.Board.Add(l);
    return DispatchEngine.EvaluateBoard(s);
})));

app.MapDelete("/api/board/{id}", (string id) => Results.Ok(store.Mutate(s =>
{
    s.Board.RemoveAll(b => b.Id == id);
    return DispatchEngine.EvaluateBoard(s);
})));

app.MapPost("/api/board/clear", () => Results.Ok(store.Mutate(s =>
{
    s.Board.Clear();
    return DispatchEngine.EvaluateBoard(s);
})));

app.MapGet("/api/board/evaluate", () => Results.Ok(DispatchEngine.EvaluateBoard(store.State)));

/// Reads freight-board screenshots into candidate loads. Deliberately does NOT touch the board —
/// the driver confirms the numbers first, because a misread payout or mileage would silently
/// corrupt every feasibility and rate decision downstream.
app.MapPost("/api/board/extract", async (ExtractRequest req, CancellationToken ct) =>
{
    var result = await AiService.ExtractLoadsAsync(store.State, req.Images ?? new(), ct);
    if (result.Ok)
        store.Mutate(s => store.Log(s, "dispatch",
            $"Read {result.Loads.Count} candidate load(s) from {req.Images!.Count} screenshot(s) via {result.Model}."));
    return Results.Ok(result);
});

app.MapPost("/api/dispatch/authorize", (AuthorizeRequest req) => Results.Ok(store.Mutate(s =>
{
    var trip = DispatchEngine.Authorize(s, req.LoadId, req.Rationale, req.OverrideTight);
    store.Log(s, "dispatch", $"{trip.Number} authorized: {trip.Cargo} {DispatchEngine.Place(trip.OriginCity, trip.OriginState)} → {DispatchEngine.Place(trip.DestCity, trip.DestState)}", trip.Number);
    return new { trip, snapshot = Snapshot(s) };
})));

/// A driver below lead rank cannot take a different load, but they can put a request on the record.
/// Operations still decides — this only makes the ask visible in the log and the dispatch packet.
app.MapPost("/api/dispatch/request-alternate", (AlternateRequest req) => Results.Ok(store.Mutate(s =>
{
    var load = s.Board.FirstOrDefault(b => b.Id == req.LoadId)
               ?? throw new InvalidOperationException("That load is not on the current board.");
    var privileges = CareerService.Privileges(s);
    if (!privileges.CanRequestAlternate && !privileges.CanChooseAlternateLoad)
        throw new InvalidOperationException(privileges.Summary);

    var lane = DispatchEngine.Place(load.DestCity, load.DestState);
    store.Log(s, "dispatch",
        $"Driver requested {load.Cargo} to {lane} instead of the assignment. Reason: {req.Reason}");
    return new
    {
        message = $"Request logged: {load.Cargo} to {lane}. Operations decides — raise it with dispatch and the reason is on the record.",
        snapshot = Snapshot(s)
    };
})));

app.MapPost("/api/dispatch/reject-all", (RejectRequest req) => Results.Ok(store.Mutate(s =>
{
    var count = s.Board.Count;
    store.Log(s, "dispatch", $"Board of {count} job(s) rejected: {req.Reason}");
    s.Board.Clear();
    return new { rejected = count, snapshot = Snapshot(s) };
})));

app.MapPost("/api/moves", (MoveRequest req) => Results.Ok(store.Mutate(s =>
{
    var trip = req.Kind == "Maintenance"
        ? DispatchEngine.CreateMaintenanceMove(s, req.DestCity, req.DestState, req.Miles, req.Reason)
        : DispatchEngine.CreateEmptyMove(s, req.DestCity, req.DestState, req.Miles, req.Reason);
    store.Log(s, "dispatch", $"{trip.Number} — {trip.Cargo} to {DispatchEngine.Place(trip.DestCity, trip.DestState)} ({req.Miles:N0} mi): {req.Reason}", trip.Number);
    return new { trip, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- trips

app.MapGet("/api/trips", () => Results.Ok(store.State.Trips));

app.MapPost("/api/trips/{id}/event", (string id, TripEvent ev) => Results.Ok(store.Mutate(s =>
{
    if (string.IsNullOrWhiteSpace(ev.GameTime)) ev.GameTime = s.Status.GameTime;
    TripService.LogEvent(s, id, ev);
    return Snapshot(s);
})));

app.MapPost("/api/trips/{id}/complete", (string id, CompleteTripRequest req) => Results.Ok(store.Mutate(s =>
{
    var audit = TripService.Complete(s, id, req);
    store.Log(s, "trip", audit.Headline, audit.Trip.Number);
    return new { audit, snapshot = Snapshot(s) };
})));

app.MapPost("/api/trips/{id}/cancel", (string id, CancelRequest req) => Results.Ok(store.Mutate(s =>
{
    var trip = TripService.Cancel(s, id, req.Reason, req.Fault, req.ChargeCompany);
    store.Log(s, "trip", $"{trip.Number} cancelled ({trip.FaultAttribution} fault): {req.Reason}", trip.Number);
    return new { trip, snapshot = Snapshot(s) };
})));

app.MapPost("/api/trips/{id}/notes", (string id, NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    var trip = s.Trips.FirstOrDefault(t => t.Id == id) ?? throw new InvalidOperationException("Trip not found.");
    if (req.Notes != null) trip.Notes = req.Notes;
    if (req.SafetyNotes != null) trip.SafetyNotes = req.SafetyNotes;
    if (!string.IsNullOrWhiteSpace(req.FaultAttribution)) trip.FaultAttribution = req.FaultAttribution;
    return trip;
})));

// ---------------------------------------------------------------- fleet

app.MapPost("/api/fleet/truck", (Truck t) => Results.Ok(store.Mutate(s =>
{
    var existing = s.Trucks.FirstOrDefault(x => x.Unit == t.Unit);

    // A yard can only hold what its tier allows. Check before committing the change, and only
    // when the unit is actually moving into a different yard.
    var movingYards = existing == null || existing.HomeTerminalId != t.HomeTerminalId;
    if (movingYards && !string.IsNullOrWhiteSpace(t.HomeTerminalId))
    {
        var yard = Migrations.TerminalOf(s, t.HomeTerminalId)
                   ?? throw new InvalidOperationException("That terminal is not one of ours.");
        if (Migrations.RoomAt(s, yard) <= 0)
            throw new InvalidOperationException(
                $"{yard.City} is a {yard.Level.ToLowerInvariant()} yard and holds {yard.TruckCapacity} tractor(s) — " +
                $"all {Migrations.TrucksBasedAt(s, yard.Id)} slots are taken. Upgrade the yard, or base this unit elsewhere.");
    }

    if (existing == null) s.Trucks.Add(t);
    else s.Trucks[s.Trucks.IndexOf(existing)] = t;
    CareerService.Recalculate(s);
    return Snapshot(s);
})));

app.MapPost("/api/fleet/trailer", (Trailer t) => Results.Ok(store.Mutate(s =>
{
    var existing = s.Trailers.FirstOrDefault(x => x.Unit == t.Unit);
    if (existing == null) s.Trailers.Add(t);
    else s.Trailers[s.Trailers.IndexOf(existing)] = t;
    CareerService.Recalculate(s);
    return Snapshot(s);
})));

app.MapDelete("/api/fleet/truck/{unit}", (string unit) => Results.Ok(store.Mutate(s =>
{
    if (string.Equals(unit, s.Driver.AssignedTruckUnit, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("That is the unit you are assigned to. Assign yourself to another tractor first.");
    if (s.Trips.Any(t => t.Status is "Authorized" or "InTransit" && t.TruckUnit == unit))
        throw new InvalidOperationException("That unit is on an open load.");
    var removed = s.Trucks.RemoveAll(t => string.Equals(t.Unit, unit, StringComparison.OrdinalIgnoreCase));
    if (removed == 0) throw new InvalidOperationException($"Unit {unit} is not in the fleet.");
    store.Log(s, "system", $"Unit {unit} removed from the fleet.");
    return Snapshot(s);
})));

app.MapDelete("/api/fleet/trailer/{unit}", (string unit) => Results.Ok(store.Mutate(s =>
{
    if (string.Equals(unit, s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("That is the trailer you are assigned to. Assign yourself another first.");
    if (s.Trips.Any(t => t.Status is "Authorized" or "InTransit" && t.TrailerUnit == unit))
        throw new InvalidOperationException("That trailer is on an open load.");
    var removed = s.Trailers.RemoveAll(t => string.Equals(t.Unit, unit, StringComparison.OrdinalIgnoreCase));
    if (removed == 0) throw new InvalidOperationException($"Trailer {unit} is not in the fleet.");
    store.Log(s, "system", $"Trailer {unit} removed from the fleet.");
    return Snapshot(s);
})));

app.MapPost("/api/fleet/trim", (TrimRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var notes = Migrations.TrimBackdropEquipment(s, req.IncludeYards);
    foreach (var n in notes) store.Log(s, "maintenance", n);
    return new { snapshot = Snapshot(s), notes };
})));

app.MapPost("/api/fleet/assign", (AssignRequest req) => Results.Ok(store.Mutate(s =>
{
    if (!string.IsNullOrWhiteSpace(req.TruckUnit))
    {
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == req.TruckUnit)
                    ?? throw new InvalidOperationException($"Unit {req.TruckUnit} is not in the fleet.");
        if (truck.Status is "OutOfService" or "Shop" && !req.Force)
            throw new InvalidOperationException($"Unit {truck.Unit} is {truck.Status}. Repair it or force the assignment.");
        foreach (var t in s.Trucks.Where(t => t.AssignedDriver == s.Driver.Name)) t.AssignedDriver = "";
        truck.AssignedDriver = s.Driver.Name;
        s.Driver.AssignedTruckUnit = truck.Unit;
        s.Settings.GovernedMph = truck.GovernedMph;
        s.Status.TruckDamagePct = truck.DamagePct;
        s.Status.AtsOdometer = truck.AtsOdometer;
    }
    if (!string.IsNullOrWhiteSpace(req.TrailerUnit))
    {
        var trailer = s.Trailers.FirstOrDefault(t => t.Unit == req.TrailerUnit)
                      ?? throw new InvalidOperationException($"Trailer {req.TrailerUnit} is not in the fleet.");
        foreach (var t in s.Trailers.Where(t => t.AssignedTruckUnit == s.Driver.AssignedTruckUnit)) t.AssignedTruckUnit = "";
        trailer.AssignedTruckUnit = s.Driver.AssignedTruckUnit;
        s.Driver.AssignedTrailerUnit = trailer.Unit;
        s.Status.TrailerDamagePct = trailer.DamagePct;
    }
    store.Log(s, "career", $"Equipment assignment: unit {s.Driver.AssignedTruckUnit}, trailer {s.Driver.AssignedTrailerUnit}.");
    return Snapshot(s);
})));

// ---------------------------------------------------------------- equipment

app.MapGet("/api/equipment", () => Results.Ok(new
{
    orders = store.State.EquipmentOrders.Take(20).ToList(),
    openOrder = EquipmentService.OpenOrder(store.State),
    pm = EquipmentService.PmCheck(store.State),
    shops = EquipmentService.ShopOptions(store.State),
    trailers = store.State.Trailers,
    yards = store.State.Company.Terminals.Select(t => new
    {
        t.Id, t.City, t.State, t.Level, t.TruckCapacity, t.HasShop, t.HasFuel,
        Based = Migrations.TrucksBasedAt(store.State, t.Id),
        Room = Migrations.RoomAt(store.State, t)
    }).ToList()
}));

app.MapGet("/api/equipment/swap-options", (string? trailerType) =>
    Results.Ok(EquipmentService.PlanSwap(store.State,
        string.IsNullOrWhiteSpace(trailerType)
            ? DispatchEngine.AssignedTrailer(store.State)?.Type ?? ""
            : trailerType)));

app.MapPost("/api/equipment/swap", (SwapRequest req) => Results.Ok(store.Mutate(s =>
{
    var message = EquipmentService.SwapTrailer(s, req.TrailerUnit, req.Force);
    store.Log(s, "system", message);
    return new { message, snapshot = Snapshot(s) };
})));

app.MapPost("/api/equipment/move", (EquipMoveRequest req) => Results.Ok(store.Mutate(s =>
{
    var trip = EquipmentService.CreateEquipmentMove(s, req.TrailerUnit, req.Miles, req.Reason ?? "");
    store.Log(s, "dispatch", $"{trip.Number} — {trip.Cargo} to {DispatchEngine.Place(trip.DestCity, trip.DestState)}.", trip.Number);
    return new { trip, snapshot = Snapshot(s) };
})));

/// Re-homes a unit to another yard — how the player mirrors what they have actually done in ATS.
app.MapPost("/api/equipment/relocate", (RelocateRequest req) => Results.Ok(store.Mutate(s =>
{
    var yard = Migrations.TerminalOf(s, req.TerminalId)
               ?? throw new InvalidOperationException("That terminal is not one of ours.");

    if (req.UnitKind == "Trailer")
    {
        var tr = s.Trailers.FirstOrDefault(t => t.Unit.Equals(req.Unit, StringComparison.OrdinalIgnoreCase))
                 ?? throw new InvalidOperationException($"Trailer {req.Unit} is not in the fleet.");
        tr.HomeTerminalId = yard.Id;
        tr.CurrentLocation = $"{yard.City}, {yard.State}";
        store.Log(s, "system", $"Trailer {tr.Unit} re-homed to {yard.City}, {yard.State}.");
    }
    else
    {
        var tk = s.Trucks.FirstOrDefault(t => t.Unit.Equals(req.Unit, StringComparison.OrdinalIgnoreCase))
                 ?? throw new InvalidOperationException($"Unit {req.Unit} is not in the fleet.");
        if (tk.HomeTerminalId != yard.Id && Migrations.RoomAt(s, yard) <= 0)
            throw new InvalidOperationException(
                $"{yard.City} holds {yard.TruckCapacity} tractor(s) and is full. Move something out first, or upgrade the yard.");
        tk.HomeTerminalId = yard.Id;
        store.Log(s, "system", $"Unit {tk.Unit} re-homed to {yard.City}, {yard.State}.");
    }
    return Snapshot(s);
})));

app.MapPost("/api/equipment/orders/{number}/complete", (string number) => Results.Ok(store.Mutate(s =>
{
    var message = EquipmentService.CompleteOrder(s, number);
    store.Log(s, "career", $"{number} completed. {message}", number);
    return new { message, snapshot = Snapshot(s) };
})));

app.MapPost("/api/equipment/orders/{number}/decline", (string number, NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    var message = EquipmentService.DeclineOrder(s, number, req.Notes ?? "");
    store.Log(s, "career", message, number);
    return new { message, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- economics

app.MapGet("/api/economics", (double? miles) =>
{
    var s = store.State;
    var m = miles ?? CostModel.AverageLoadedMiles(s);
    var (floor, target, detail) = CostModel.Thresholds(s, m);
    return Results.Ok(new { floor, target, detail, manual = s.Settings.Scoring.UseManualThresholds });
});

app.MapGet("/api/economics/calibrate", () => Results.Ok(CostModel.Calibrate(store.State)));

/// Writes the calibration's recommended cost settings into the career.
app.MapPost("/api/economics/apply", (ApplyCalibration req) => Results.Ok(store.Mutate(s =>
{
    var before = CostModel.Compute(s, CostModel.AverageLoadedMiles(s));
    if (req.OverheadPerLoad.HasValue) s.Settings.OverheadPerLoad = Math.Max(0, req.OverheadPerLoad.Value);
    if (req.FuelPricePerGal.HasValue) s.Settings.FuelPricePerGal = Math.Max(0.1m, req.FuelPricePerGal.Value);
    if (req.MarginGoal.HasValue) s.Settings.MarginGoal = Math.Clamp(req.MarginGoal.Value, 1.0, 3.0);
    if (req.PayMileMultiplier.HasValue) s.Settings.PayMileMultiplier = Math.Clamp(req.PayMileMultiplier.Value, 0.1, 20);
    if (req.RevenueFactor.HasValue) s.Settings.RevenueFactor = Math.Clamp(req.RevenueFactor.Value, 0.05, 3.0);
    if (req.UseManualThresholds.HasValue) s.Settings.Scoring.UseManualThresholds = req.UseManualThresholds.Value;

    var after = CostModel.Compute(s, CostModel.AverageLoadedMiles(s));
    store.Log(s, "ledger",
        $"Cost model adjusted — break-even ${before.BreakEvenRpm:0.00}/mi → ${after.BreakEvenRpm:0.00}/mi.");
    return new { before, after, calibration = CostModel.Calibrate(s), snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- hired fleet

app.MapGet("/api/fleetops", () => Results.Ok(new
{
    summary = FleetOpsService.Summary(store.State),
    drivers = store.State.HiredDrivers,
    reports = store.State.FleetReports.Take(20).ToList()
}));

app.MapPost("/api/fleetops/drivers", (HiredDriver d) => Results.Ok(store.Mutate(s =>
{
    var created = string.IsNullOrWhiteSpace(d.Id) || s.HiredDrivers.All(x => x.Id != d.Id)
        ? FleetOpsService.AddDriver(s, d)
        : FleetOpsService.UpdateDriver(s, d);
    store.Log(s, "system", $"Hired driver {created.Name} on unit {created.AssignedTruckUnit}.");
    return new { driver = created, snapshot = Snapshot(s) };
})));

app.MapDelete("/api/fleetops/drivers/{id}", (string id) => Results.Ok(store.Mutate(s =>
{
    FleetOpsService.RemoveDriver(s, id);
    return Snapshot(s);
})));

app.MapPost("/api/fleetops/report", (FleetReport report) => Results.Ok(store.Mutate(s =>
{
    var filed = FleetOpsService.FileReport(s, report);
    store.Log(s, "ledger",
        $"{filed.Number} filed — {filed.Lines.Count} driver(s), revenue ${filed.TotalRevenue:N2}, net ${filed.NetContribution:N2}.",
        filed.Number);
    return new { report = filed, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- terminals

app.MapPost("/api/terminals", (Terminal t) => Results.Ok(store.Mutate<object>(s =>
{
    var existing = s.Company.Terminals.FirstOrDefault(x => x.Id == t.Id);
    t.State = (t.State ?? "").Trim().ToUpperInvariant();
    string? warning = null;
    if (existing == null)
    {
        if (string.IsNullOrWhiteSpace(t.City)) throw new InvalidOperationException("A terminal needs a city.");
        if (string.IsNullOrWhiteSpace(t.Id)) t.Id = Guid.NewGuid().ToString("N")[..8];
        if (string.IsNullOrWhiteSpace(t.Name)) t.Name = $"{s.Company.Name} — {t.City}";
        s.Company.Terminals.Add(t);
        store.Log(s, "system", $"Terminal opened: {t.City}, {t.State} ({t.Level}).");

        // Buying a yard somewhere proves you have been there, so it counts as discovered. The warning
        // is advisory only — the player can see their own game and we cannot.
        warning = DiscoveryService.YardWarning(s, t.City, t.State);
        DiscoveryService.Note(s, t.City, t.State, s.Status.GameTime);
    }
    else
    {
        s.Company.Terminals[s.Company.Terminals.IndexOf(existing)] = t;
    }
    Migrations.SyncHeadquarters(s);
    DiscoveryService.SyncOwnership(s);
    return new { snapshot = Snapshot(s), warning };
})));

app.MapDelete("/api/terminals/{id}", (string id) => Results.Ok(store.Mutate(s =>
{
    var t = s.Company.Terminals.FirstOrDefault(x => x.Id == id)
            ?? throw new InvalidOperationException("No such terminal.");
    if (t.IsHeadquarters) throw new InvalidOperationException("That is headquarters. Make another yard the HQ first.");
    if (s.Driver.HomeTerminalId == id) throw new InvalidOperationException("You are domiciled there. Transfer first.");
    s.Company.Terminals.Remove(t);
    store.Log(s, "system", $"Terminal closed: {t.City}, {t.State}.");
    Migrations.SyncHeadquarters(s);
    return Snapshot(s);
})));

app.MapPost("/api/terminals/{id}/level", (string id, LevelRequest req) => Results.Ok(store.Mutate(s =>
{
    var t = s.Company.Terminals.FirstOrDefault(x => x.Id == id)
            ?? throw new InvalidOperationException("No such terminal.");
    Migrations.ApplyLevel(t, req.Level);
    store.Log(s, "system", $"{t.City} yard re-tiered to {t.Level} ({t.TruckCapacity} tractors).");
    return Snapshot(s);
})));

app.MapPost("/api/terminals/{id}/headquarters", (string id) => Results.Ok(store.Mutate(s =>
{
    var t = s.Company.Terminals.FirstOrDefault(x => x.Id == id)
            ?? throw new InvalidOperationException("No such terminal.");
    foreach (var x in s.Company.Terminals) x.IsHeadquarters = false;
    t.IsHeadquarters = true;
    Migrations.SyncHeadquarters(s);
    store.Log(s, "system", $"Headquarters moved to {t.City}, {t.State}.");
    return Snapshot(s);
})));

app.MapPost("/api/terminals/transfer", (TransferReq req) => Results.Ok(store.Mutate(s =>
{
    var result = CareerService.RequestTransfer(s, req.TerminalId, req.Reason);
    store.Log(s, "career", $"Transfer request to {result.ToTerminalName}: {result.Outcome}. {result.Decision}");
    return new { request = result, snapshot = Snapshot(s) };
})));

app.MapPost("/api/terminals/transfer/{id}/settle", (string id) => Results.Ok(store.Mutate(s =>
{
    var message = CareerService.SettleConditionalTransfer(s, id);
    store.Log(s, "career", message);
    return new { message, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- maintenance

app.MapPost("/api/maintenance/workorder", (WorkOrder wo) => Results.Ok(store.Mutate(s =>
{
    var created = MaintenanceService.OpenWorkOrder(s, wo);
    store.Log(s, "maintenance", $"{created.Number} {created.Kind} on {created.UnitKind.ToLowerInvariant()} {created.Unit}: {created.Description}", created.Number);
    return new { workOrder = created, snapshot = Snapshot(s) };
})));

app.MapPost("/api/maintenance/workorder/{number}/complete", (string number, CompleteWoRequest req) => Results.Ok(store.Mutate(s =>
{
    var wo = MaintenanceService.CompleteWorkOrder(s, number, req.Cost, req.DamageAfter, req.Vendor, req.PaidBy, req.Notes);
    store.Log(s, "maintenance", $"{wo.Number} closed — ${wo.Cost:N2} paid by {wo.PaidBy}, damage now {wo.DamageAfter:0.#}%.", wo.Number);
    return new { workOrder = wo, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- safety

app.MapPost("/api/incidents", (Incident inc) => Results.Ok(store.Mutate(s =>
{
    var created = SafetyService.RecordIncident(s, inc);
    var recommendation = SafetyService.RecommendDiscipline(s, created);
    store.Log(s, "safety", $"{created.Number} {created.Kind} ({created.FaultAttribution} fault): {created.Description}", created.Number);
    return new { incident = created, recommendation, snapshot = Snapshot(s) };
})));

app.MapPost("/api/discipline", (DisciplineRequest req) => Results.Ok(store.Mutate(s =>
{
    var action = SafetyService.Issue(s, req.Level, req.Reason, req.CorrectiveAction, req.IncidentNumber, req.ExpiresAfterLoads);
    store.Log(s, "safety", $"{action.Number} {action.Level} issued: {action.Reason}", action.Number);
    return new { action, snapshot = Snapshot(s) };
})));

app.MapPost("/api/discipline/reinstate", (NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    SafetyService.Reinstate(s, req.Notes ?? "");
    store.Log(s, "safety", $"Driver reinstated: {req.Notes}");
    return Snapshot(s);
})));

// ---------------------------------------------------------------- payroll & money

app.MapPost("/api/settlements/run", (NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    var settlement = PayEngine.RunSettlement(s, req.Notes);
    store.Log(s, "pay", $"{settlement.Number} issued — gross ${settlement.Gross:N2} over {settlement.TripNumbers.Count} trip(s).", settlement.Number);
    return new { settlement, snapshot = Snapshot(s) };
})));

app.MapGet("/api/finance", () => Results.Ok(LedgerService.Summary(store.State)));

app.MapGet("/api/finance/position", () => Results.Ok(LedgerService.Position(store.State)));

app.MapPost("/api/finance/true-up", (NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    var message = LedgerService.TrueUpToGame(s, req.Notes ?? "");
    store.Log(s, "ledger", message);
    return new { message, position = LedgerService.Position(s), snapshot = Snapshot(s) };
})));

app.MapPost("/api/finance/entry", (LedgerEntry e) => Results.Ok(store.Mutate(s =>
{
    var posted = LedgerService.Post(s, e.AccountKey, e.Amount, e.Category, e.Memo, e.TripNumber);
    store.Log(s, "ledger", $"{posted.Category} ${posted.Amount:N2} — {posted.Memo}");
    return new { entry = posted, snapshot = Snapshot(s) };
})));

app.MapGet("/api/ledger", (int? take) =>
{
    var s = store.State;
    return Results.Ok(s.Ledger.Take(take ?? 250).Select(e => new
    {
        e.GameTime, e.Category, e.Memo, e.TripNumber, e.Amount, e.IsAdjustment, e.PostedUtc,
        AccountName = s.Accounts.FirstOrDefault(a => a.Key == e.AccountKey)?.Name ?? e.AccountKey
    }).ToList());
});

app.MapGet("/api/finance/reconcile", () => Results.Ok(LedgerService.Reconcile(store.State)));

app.MapPost("/api/finance/reconcile/apply", (ReconcileRequest req) => Results.Ok(store.Mutate(s =>
{
    if (req.FixUnsettledPay.HasValue) s.Driver.UnsettledPay = req.FixUnsettledPay.Value;
    if (req.FixFreightCounter.HasValue) s.Counters.Freight = req.FixFreightCounter.Value;
    if (!string.IsNullOrWhiteSpace(req.Account) && req.Amount != 0)
        LedgerService.ApplyReconciliation(s, req.Account, req.Amount, req.Memo);
    store.Log(s, "ledger", $"Reconciliation applied: {req.Memo}");
    return new { reconciliation = LedgerService.Reconcile(s), snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- career

app.MapGet("/api/career", () => Results.Ok(CareerService.Review(store.State)));

app.MapPost("/api/career/clear-probation", (CareerActionRequest req) => Results.Ok(store.Mutate(s =>
{
    var message = CareerService.ClearProbation(s, req.Force, req.Note ?? "");
    store.Log(s, "career", message);
    return new { message, snapshot = Snapshot(s) };
})));

app.MapPost("/api/career/promote", (CareerActionRequest req) => Results.Ok(store.Mutate(s =>
{
    var message = CareerService.Promote(s, req.Rank, req.Note ?? "", req.Force);
    store.Log(s, "career", message);
    return new { message, snapshot = Snapshot(s) };
})));

app.MapPost("/api/career/pay", (PayAdjustRequest req) => Results.Ok(store.Mutate(s =>
{
    var message = CareerService.AdjustPay(s, req.LoadedCpm, req.DeadheadCpm, req.Reason ?? "");
    store.Log(s, "pay", message);
    return new { message, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- packet & AI

app.MapGet("/api/packet", (string? mode) =>
{
    var text = mode == "brief"
        ? PacketService.BuildBoardBrief(store.State)
        : PacketService.BuildPacket(store.State, includeRules: mode != "state", includeHistory: mode != "brief");
    return Results.Ok(new { text });
});

app.MapPost("/api/ai/dispatch", async (AiRequest req, CancellationToken ct) =>
{
    var s = store.State;
    var body = string.IsNullOrWhiteSpace(req.Message)
        ? PacketService.BuildPacket(s)
        : PacketService.BuildPacket(s) + "\n\n---\n\nDriver message: " + req.Message;
    var reply = await AiService.AskAsync(s, body, ct);
    if (reply.Ok) store.Mutate(st => store.Log(st, "dispatch", $"AI dispatch reply ({reply.Model}, {reply.OutputTokens} out tokens)."));
    return Results.Ok(reply);
});

app.MapGet("/api/ai/status", () => Results.Ok(new
{
    configured = AiService.Configured(store.State.Settings),
    model = store.State.Settings.AnthropicModel,
    hasKey = !string.IsNullOrWhiteSpace(store.State.Settings.AnthropicApiKey)
}));

// ---------------------------------------------------------------- markets

app.MapGet("/api/markets", (string? state, bool? resetOnly, string? q) =>
{
    var list = Markets.Effective(store.State).AsEnumerable();
    if (!string.IsNullOrWhiteSpace(state)) list = list.Where(c => c.State.Equals(state, StringComparison.OrdinalIgnoreCase));
    if (resetOnly == true) list = list.Where(c => c.ResetFriendly);
    if (!string.IsNullOrWhiteSpace(q)) list = list.Where(c => c.City.Contains(q, StringComparison.OrdinalIgnoreCase));
    return Results.Ok(list.Take(500).ToList());
});

app.MapPost("/api/markets", (MarketCity c) => Results.Ok(store.Mutate(s =>
{
    s.MarketExtras.RemoveAll(x => x.City.Equals(c.City, StringComparison.OrdinalIgnoreCase)
                                  && x.State.Equals(c.State, StringComparison.OrdinalIgnoreCase));
    c.State = (c.State ?? "").Trim().ToUpperInvariant();
    c.Source = "Custom";
    s.MarketExtras.Add(c);
    return c;
})));

// ---------------------------------------------------------------- backup / data

app.MapGet("/api/backups", () => Results.Ok(new
{
    dataDir = store.DataDirectory,
    stateFile = store.StateFile,
    files = store.ListBackups(),
    // Careers left behind by an older copy of the app, so an update never looks like a lost save.
    otherCareers = store.OtherCareerFiles()
}));
app.MapPost("/api/data/adopt", (AdoptRequest r) =>
{
    store.AdoptFile(r.Path);
    return Results.Ok(Snapshot());
});
app.MapPost("/api/backups/snapshot", (NoteRequest r) => Results.Ok(new { path = store.Snapshot(r.Notes ?? "manual") }));
app.MapPost("/api/backups/restore", (RestoreRequest r) => { store.RestoreBackup(r.File); return Results.Ok(Snapshot()); });
app.MapGet("/api/export", () => Results.Text(store.ExportJson(), "application/json"));
app.MapPost("/api/import", async (HttpRequest http) =>
{
    using var reader = new StreamReader(http.Body);
    store.ImportJson(await reader.ReadToEndAsync());
    return Results.Ok(Snapshot());
});
app.MapPost("/api/reset", (ResetRequest r) =>
{
    if (r.Confirm != "RESET") return Results.BadRequest(new { error = "Type RESET to confirm. A snapshot is taken first either way." });
    // Settings describe the install, not the career — they survive unless explicitly wiped.
    store.ResetAll(keepSettings: r.ResetSettings != true);
    return Results.Ok(Snapshot());
});

app.MapGet("/api/events", (int? take) => Results.Ok(store.State.Events.Take(take ?? 200).ToList()));

// ---------------------------------------------------------------- run

var url = $"http://127.0.0.1:{port}/";
Console.WriteLine();
Console.WriteLine("  TruckSim Dispatcher");
Console.WriteLine("  ===================");
Console.WriteLine($"  Console:   {url}");
Console.WriteLine($"  Data file: {store.StateFile}");
Console.WriteLine($"  Backups:   {Path.Combine(store.DataDirectory, "backups")}");
Console.WriteLine();
Console.WriteLine("  Leave this window open while you play. Press Ctrl+C to shut down.");
Console.WriteLine();

if (openBrowser)
{
    try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
    catch { Console.WriteLine($"  Could not open a browser automatically — open {url} yourself."); }
}

app.Run();

// ---------------------------------------------------------------- helpers

object Snapshot(AppState? given = null)
{
    var s = given ?? store.State;
    var truck = DispatchEngine.AssignedTruck(s);
    var trailer = DispatchEngine.AssignedTrailer(s);

    // Never send the API key to the browser.
    var safeSettings = JsonSerializer.Deserialize<AppSettings>(
        JsonSerializer.Serialize(s.Settings, StateStore.Json), StateStore.Json)!;
    safeSettings.AnthropicApiKey = string.IsNullOrWhiteSpace(s.Settings.AnthropicApiKey) ? "" : "********";

    return new
    {
        onboarded = s.Onboarded,
        company = s.Company,
        driver = s.Driver,
        settings = safeSettings,
        status = s.Status,
        hos = s.Hos,          // driver-reported clocks; views.hos is the derived projection
        trucks = s.Trucks,
        trailers = s.Trailers,
        trips = s.Trips.Take(120).ToList(),
        board = s.Board,
        settlements = s.Settlements,
        incidents = s.Incidents,
        discipline = s.Discipline,
        workOrders = s.WorkOrders,
        counters = s.Counters,
        discovered = s.Discovered,
        events = s.Events.Take(80).ToList(),
        views = new
        {
            garageOpportunities = DiscoveryService.GarageOpportunityView(s),
            backdrop = Backdrop(s),
            hos = HosEngine.Describe(s, truck),
            finance = LedgerService.Summary(s),
            career = CareerService.Review(s),
            maintenanceAlerts = MaintenanceService.FleetAlerts(s),
            dispatchBlockers = DispatchEngine.DispatchBlockers(s, truck, trailer),
            infoNeeded = DispatchEngine.MissingContext(s),
            activeTrip = TripService.Active(s),
            nextNumbers = new
            {
                freight = DispatchEngine.PeekNumber(s, "Freight"),
                emptyMove = DispatchEngine.PeekNumber(s, "EmptyMove"),
                maintenance = DispatchEngine.PeekNumber(s, "Maintenance"),
                cancelled = DispatchEngine.PeekNumber(s, "Cancelled")
            },
            truck,
            trailer,
            resetOptions = Markets.ResetOptions(s, s.Status.LocationState),
            fleetOps = FleetOpsService.Summary(s),
            equipmentOrder = EquipmentService.OpenOrder(s),
            pm = EquipmentService.PmCheck(s),
            breakEven = CostModel.Compute(s, CostModel.AverageLoadedMiles(s)),
            position = LedgerService.Position(s),
            privileges = CareerService.Privileges(s),
            atTerminal = Migrations.At(s),
            aiConfigured = AiService.Configured(s.Settings)
        }
    };
}

/// <summary>Equipment and yards on the book that ATS knows nothing about, so the UI can offer a trim.</summary>
static object Backdrop(AppState s)
{
    var (trucks, trailers, yards) = Migrations.CountBackdrop(s);
    return new { trucks, trailers, yards, any = trucks + trailers + yards > 0 };
}

static string BuildFirstDispatch(AppState s, Truck? truck, Trailer? trailer)
{
    var terminal = DispatchEngine.Place(s.Company.TerminalCity, s.Company.TerminalState);
    return $"Welcome aboard, {s.Driver.Name}. You are {s.Driver.RankTitle} at {s.Company.Name}, employee {s.Driver.EmployeeId}, " +
           $"on a {s.Driver.Probation.DurationDays}-day probation at ${s.Driver.Pay.LoadedCpm:0.000} per loaded mile.\n\n" +
           $"Your equipment is unit {truck?.Unit} — {truck?.Year} {truck?.Make} {truck?.Model}, {truck?.Transmission} — " +
           $"pulling trailer {trailer?.Unit}, a {trailer?.Length} {trailer?.Type}. It is not the newest truck on the property; " +
           $"that is how probation works. Take care of it and we will talk about equipment again when your probation clears.\n\n" +
           $"You are sitting at our {terminal} yard. The terminal is not a shipper, so there is no freight to pull directly off it. " +
           $"Open ATS, look at the jobs available from shippers around {s.Company.TerminalCity}, and enter them on the Dispatch tab. " +
           $"Report your in-game date and time and your HOS clocks with them, and I will pick your first load — " +
           $"{DispatchEngine.PeekNumber(s, "Freight")}.";
}

static Dictionary<string, string> LoadEmbeddedUi()
{
    var asm = Assembly.GetExecutingAssembly();
    var map = new Dictionary<string, string>();
    foreach (var name in new[] { "ui/index.html", "ui/app.js", "ui/styles.css" })
    {
        using var stream = asm.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Embedded UI asset missing: {name}");
        using var reader = new StreamReader(stream);
        map[name] = reader.ReadToEnd();
    }
    return map;
}

static int FindFreePort(int preferred)
{
    for (var candidate = preferred; candidate < preferred + 40; candidate++)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, candidate);
            listener.Start();
            listener.Stop();
            return candidate;
        }
        catch (SocketException) { /* in use — try the next one */ }
    }
    return preferred;
}

// ---------------------------------------------------------------- request DTOs

record StatusUpdate(string? LocationCity, string? LocationState, string? LocationKind, string? LocationDetail,
    string? GameTime, double? FuelPct, double? TruckDamagePct, double? TrailerDamagePct, double? AtsOdometer,
    string? DutyStatus, string? Notes, decimal? AtsBankBalance);

record HireRequest(DriverApplication Application, bool Force, string? GameTime, string? Code);
record AuthorizeRequest(string LoadId, string? Rationale, bool OverrideTight);
record RejectRequest(string Reason);
record AlternateRequest(string LoadId, string Reason);
record LevelRequest(string Level);
record TransferReq(string TerminalId, string Reason);
record CarrierApplication(string Code, string? Reason);
record SwapRequest(string TrailerUnit, bool Force);
record RelocateRequest(string Unit, string UnitKind, string TerminalId);
record EquipMoveRequest(string TrailerUnit, double Miles, string? Reason);
record ApplyCalibration(decimal? OverheadPerLoad, decimal? FuelPricePerGal, double? MarginGoal,
    double? PayMileMultiplier, double? RevenueFactor, bool? UseManualThresholds);
record MoveRequest(string Kind, string DestCity, string DestState, double Miles, string Reason);
record CancelRequest(string Reason, string Fault, bool ChargeCompany);
record NoteRequest(string? Notes, string? SafetyNotes, string? FaultAttribution);
record AssignRequest(string? TruckUnit, string? TrailerUnit, bool Force);
record CompleteWoRequest(decimal Cost, double DamageAfter, string Vendor, string PaidBy, string Notes);
record DisciplineRequest(string Level, string Reason, string CorrectiveAction, string IncidentNumber, int ExpiresAfterLoads);
record ReconcileRequest(string? Account, decimal Amount, string Memo, decimal? FixUnsettledPay, int? FixFreightCounter);
record CareerActionRequest(string? Rank, string? Note, bool Force);
record PayAdjustRequest(decimal LoadedCpm, decimal DeadheadCpm, string? Reason);
record AiRequest(string? Message);
record ExtractRequest(List<ScreenshotImage>? Images);
record RestoreRequest(string File);
record ResetRequest(string Confirm, bool? ResetSettings);
record DiscoverRequest(string City, string? State);
record TrimRequest(bool IncludeYards);
record AdoptRequest(string Path);
