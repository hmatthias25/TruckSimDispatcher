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
    // Drop and hook has nothing of ours on the back. Whatever damage the driver read belongs to the
    // shipper's trailer, and writing it onto the arrangement would invent a repair bill for a box the
    // company does not own.
    if (tr != null && u.TrailerDamagePct.HasValue && !DropHook.Is(tr.Type))
        tr.DamagePct = s.Status.TrailerDamagePct;

    // Arriving somewhere new grows the network — and may be worth a yard.
    var discovery = DiscoveryService.Note(s, s.Status.LocationCity, s.Status.LocationState, s.Status.GameTime);

    // Rank and rates as they stand before the yard review gets a look at them. A probation that clears
    // itself has to be announced, not left for the driver to spot on a settlement two days later.
    var rankBefore = s.Driver.Rank;
    var loadedBefore = s.Driver.Pay.LoadedCpm;
    var deadheadBefore = s.Driver.Pay.DeadheadCpm;

    // Reporting in at the home yard is how home time gets taken — we observe it, we do not schedule it.
    var wentHome = HomeTime.Touch(s);
    if (wentHome)
        store.Log(s, "career", $"Home time taken at {DispatchEngine.Place(s.Status.LocationCity, s.Status.LocationState)}.");
    var homeBrief = wentHome ? HomeTime.ArrivalBrief(s) : null;

    // Earning the ordinary market back happens on its own as the clock advances, rather than being
    // something the driver has to remember to claim.
    var redeemed = Redemption.CheckEarned(s);
    if (redeemed != null) store.Log(s, "career", redeemed);

    // Payday is Friday. The app cannot see the game, so it settles the moment it is told the clock has
    // crossed one — and pays each Friday in turn if several have gone by.
    var paid = PayEngine.RunDuePaydays(s);
    foreach (var st in paid)
        store.Log(s, "pay", $"{st.Number} paid — ${st.Gross:N2} gross, ${st.Stub?.Net ?? st.Gross:N2} net.", st.Number);

    // Either the yard review just cleared probation, or the driver has earned the next rung. Both are
    // the company acting on its own, and both get said out loud.
    var advance = s.Driver.Rank != rankBefore
        ? CareerService.NoticeFor(s, rankBefore == "probationary" ? "probation" : "promotion",
                                  loadedBefore, deadheadBefore)
        : CareerService.AutoAdvance(s);
    if (advance != null) store.Log(s, "career", advance.Headline);

    return new { snapshot = Snapshot(s), discovery, wentHome, homeBrief, paid, redeemed, advance };
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
    // A reading typed in by the driver is a reading: not a projection, and not stale. Nothing here used
    // to set Confirmed, so once it went false it stayed false and the driver was told their clocks were
    // out of date however many times they reported them.
    s.Hos.Projected = false;
    s.Hos.Confirmed = true;
    // A fresh reading is a fresh chance to have copied a break-capped drive figure off the display.
    ClockCheck.Rearm(s);
    s.Hos.Source = h.Source ?? "";
    s.Hos.Notes = h.Notes ?? "";
    s.Hos.AsOfGameTime = string.IsNullOrWhiteSpace(h.AsOfGameTime) ? s.Status.GameTime : h.AsOfGameTime;
    s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
    store.Log(s, "dispatch", $"HOS reported: drive {s.Hos.DriveRemaining:0.##}, shift {s.Hos.ShiftRemaining:0.##}, break {s.Hos.BreakRemaining:0.##}, cycle {s.Hos.CycleRemaining:0.##}");
    if (ClockCheck.Capped(s) is { } q)
        store.Log(s, "dispatch",
            $"Queried the drive clock: {Hhmm.Of(s.Hos.DriveRemaining)} reported with the break clock on the " +
            $"same figure. Either the display is capping and there is {Hhmm.Of(q.Recovered)}, or it is not.");
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
    var decision = Carriers.Screen(s, req.Code);
    if (!decision.Hired)
        return new { hired = false, decision, snapshot = (object?)null };

    // Settle up before anything else. You do not leave wages on a previous employer's books, and the
    // driver should not have to remember to press a button to avoid it.
    var finalPay = PayEngine.SettleOnLeaving(s);
    if (finalPay != null)
        store.Log(s, "pay", $"{finalPay.Number} — final settlement from {s.Company.Name}, " +
                            $"${finalPay.Gross:N2} gross, ${finalPay.Stub?.Net ?? finalPay.Gross:N2} net.", finalPay.Number);

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

    // What the player actually owns in ATS, read BEFORE the hire clears our books. After this line the
    // fleet is gone from the app and still sitting in their garage, which is the whole problem.
    var had = Changeover.Read(s, req.Code);

    // New employer: new books, new fleet, new probation. The driver's record carries over.
    //
    // Settlements are deliberately NOT cleared. They are the driver's pay history, not the company's
    // books — including the final stub issued moments ago, which they have not even seen yet.
    s.Trips.Clear();
    s.Board.Clear();
    s.Ledger.Clear();
    s.WorkOrders.Clear();
    s.Incidents.Clear();
    s.Discipline.Clear();
    s.Counters = new Counters();
    s.Driver.Transfers.Clear();
    s.Driver.HomeTerminalId = "";
    s.Status.ActiveTripId = "";

    var carriedApp = s.Application ?? new DriverApplication();
    Carriers.Employ(s, req.Code, carriedApp, markHqReached: had.NewHqAlreadyReached);
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
    // Starting at the new yard assumes the driver can get to it, which is only true if they have been
    // there before. A carrier based somewhere they have never driven leaves them exactly where they
    // resigned, with the trip to their new job still to make — see the changeover instruction below.
    if (had.NewHqAlreadyReached)
    {
        s.Status.LocationCity = s.Company.TerminalCity;
        s.Status.LocationState = s.Company.TerminalState;
        s.Status.LocationKind = "Terminal";
        s.Status.LocationDetail = $"{s.Company.Name} yard";
    }
    var hqTerminal = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
    if (hqTerminal != null) s.Driver.HomeTerminalId = hqTerminal.Id;

    store.Log(s, "career", $"Resigned from {leaving} and hired at {s.Company.Name} as {s.Driver.RankTitle}.");

    // Sell what belonged to the last company, buy what this one runs, and get to the cities where that
    // has to happen. The app cannot do any of it, so it is written down and worked through.
    s.Changeover = Changeover.Raise(s, had);
    store.Log(s, "career",
        $"{s.Changeover.Number} raised — {s.Changeover.Steps.Count(x => !x.Done)} thing(s) to do in ATS " +
        $"to bring the game into line with the move to {s.Company.Name}.");

    return new
    {
        hired = true, decision, truck, trailer,
        finalPay,
        setup = Carriers.SetupChecklist(s),
        changeover = Changeover.View(s),
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
    // Read before the hire replaces the driver object — SkillsExceed reads the skills off it.
    var comesInStrong = !string.IsNullOrWhiteSpace(req.Code) && Carriers.SkillsExceed(s, req.Code);

    Seed.HireDriver(s, a, decision);
    // HireDriver has its own generic starting-rate table; the employer's posted scale wins.
    if (!string.IsNullOrWhiteSpace(req.Code)) Carriers.ApplyPayScale(s, req.Code, a);

    // Somebody who turns up already levelled for the work is not a probationary hire. Promote rather
    // than hand-set the fields, so the rate comes off the employer's own scale like any other rung.
    if (comesInStrong)
    {
        s.Driver.Probation.Active = false;
        s.Driver.Probation.ClearedGameDate = s.Status.GameTime;
        s.Driver.Status = "Active";
        CareerService.Promote(s, "company", "Hired straight onto the company scale — skills already at the level the work needs.", force: true);
        store.Log(s, "career",
            $"{s.Driver.Name} starts as a Company Driver rather than on probation: the skill levels are " +
            "already there for the freight they run.");
    }
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
    return EvaluateBoard(s);
})));

app.MapPost("/api/board/add", (BoardLoad l) => Results.Ok(store.Mutate(s =>
{
    if (string.IsNullOrWhiteSpace(l.Id)) l.Id = Guid.NewGuid().ToString("N")[..8];
    if (string.IsNullOrWhiteSpace(l.OriginCity)) { l.OriginCity = s.Status.LocationCity; l.OriginState = s.Status.LocationState; }
    l.OriginState = (l.OriginState ?? "").Trim().ToUpperInvariant();
    l.DestState = (l.DestState ?? "").Trim().ToUpperInvariant();
    if (string.IsNullOrWhiteSpace(l.TrailerType)) l.TrailerType = DispatchEngine.AssignedTrailer(s)?.Type ?? "";

    // A window typed straight off the listing beats two figures the driver had to work out. Parsed here,
    // against the app's own game clock, which is the only place that knows what "tomorrow" means.
    if (!string.IsNullOrWhiteSpace(l.WindowText)
        && DeliveryWindow.Read(s, l.WindowText) is { } win
        && GameClock.TryParse(s.Status.GameTime) is { } nowAt)
    {
        // A clock range has no day in it, so it resolves to the soonest future occurrence — tonight.
        // Where the driver also typed the listing's time-to-deliver, that countdown says which day was
        // meant, and the window moves to match rather than replacing a correct deadline with a wrong one.
        win = DeliveryWindow.RollToDeadline(win, nowAt, l.DeadlineHours);

        l.DeadlineHours = Math.Round(win.HoursUntilDue, 2);
        if (win.OpensAt != null)
            l.AppointmentOpensHours = Math.Max(0, Math.Round((win.OpensAt.Value - nowAt).TotalHours, 2));
    }

    // The same job entered twice is a real hazard rather than a theoretical one: the dock board is not
    // cleared when the driver moves to the city board, so anything ATS lists in both places can go on
    // twice. Flagged rather than refused — two genuinely similar loads out of one shipper is ordinary,
    // and the driver is the one looking at the screen.
    l.LooksDuplicated = s.Board.Any(b =>
        b.Cargo.Equals(l.Cargo ?? "", StringComparison.OrdinalIgnoreCase)
        && b.DestCity.Equals(l.DestCity ?? "", StringComparison.OrdinalIgnoreCase)
        && b.DestState.Equals(l.DestState ?? "", StringComparison.OrdinalIgnoreCase)
        && b.OriginCity.Equals(l.OriginCity ?? "", StringComparison.OrdinalIgnoreCase)
        && Math.Abs(b.LoadedMiles - l.LoadedMiles) < 1
        && Math.Abs(b.GameRevenue - l.GameRevenue) < 1);

    s.Board.Add(l);
    return EvaluateBoard(s);
})));

app.MapDelete("/api/board/{id}", (string id) => Results.Ok(store.Mutate(s =>
{
    s.Board.RemoveAll(b => b.Id == id);
    return EvaluateBoard(s);
})));

app.MapPost("/api/board/clear", () => Results.Ok(store.Mutate(s =>
{
    s.Board.Clear();
    return EvaluateBoard(s);
})));

app.MapPost("/api/board/evaluate", () => Results.Ok(store.Mutate(EvaluateBoard)));
app.MapGet("/api/board/evaluate", () => Results.Ok(store.Mutate(EvaluateBoard)));

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

/// Reads the driver's clocks off a GDC Companion recap screenshot.
///
/// Deliberately does NOT save. The four clocks gate every dispatch decision the app makes, so the read
/// is staged for the driver to look at and confirm — one glance at their own screen is all it takes to
/// catch a misread, and there is no way to catch one after it has silently become the plan.
app.MapPost("/api/hos/extract", async (ExtractRequest req, CancellationToken ct) =>
{
    var result = await AiService.ExtractHosAsync(store.State, req.Images ?? new(), ct);
    if (!result.Ok) return Results.Ok(new { reading = result, snapshot = Snapshot(store.State) });

    // Paste it and it is entered. That is the whole point of pasting it: a driver doing this daily
    // should not be deciding which of two panels a number came off, which is the mistake the screen
    // invites. What it could not read keeps its old value rather than being written as zero, and the
    // previous clocks come back on the reply so a bad read is one button away from undone.
    var applied = store.Mutate(s =>
    {
        var was = new HosSnapshot
        {
            DriveRemaining = s.Hos.DriveRemaining, ShiftRemaining = s.Hos.ShiftRemaining,
            BreakRemaining = s.Hos.BreakRemaining, CycleRemaining = s.Hos.CycleRemaining,
            Recap = s.Hos.Recap.Select(r => new RecapDay { InDays = r.InDays, Hours = r.Hours }).ToList(),
            Source = s.Hos.Source, Notes = s.Hos.Notes, AsOfGameTime = s.Hos.AsOfGameTime,
        };

        void Put(double? read, string label, Action<double> set, double current)
        {
            if (read is { } v) { set(v); result.Saved.Add($"{label} {Hhmm.Of(v)}"); }
            else { result.Kept.Add($"{label} left at {Hhmm.Of(current)}"); }
        }
        Put(result.DriveRemaining, "drive", v => s.Hos.DriveRemaining = v, s.Hos.DriveRemaining);
        Put(result.ShiftRemaining, "shift", v => s.Hos.ShiftRemaining = v, s.Hos.ShiftRemaining);
        Put(result.BreakRemaining, "break", v => s.Hos.BreakRemaining = v, s.Hos.BreakRemaining);
        Put(result.CycleRemaining, "cycle", v => s.Hos.CycleRemaining = v, s.Hos.CycleRemaining);

        if (result.Recap.Count > 0 || result.TodayDay != null)
        {
            s.Hos.Recap = result.Recap.Select(r => new RecapDay { InDays = r.InDays, Hours = r.Hours }).ToList();
            result.Saved.Add($"{s.Hos.Recap.Count} recap batch(es)");
        }

        s.Hos.Source = "GDC Companion";
        s.Hos.AsOfGameTime = s.Status.GameTime;
        s.Hos.Confirmed = true;
        // The reader is as faithful as the driver is: it reads the capped figure straight off the image.
        ClockCheck.Rearm(s);
        s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
        result.Applied = true;

        store.Log(s, "dispatch",
            "Clocks read from a GDC Companion recap screenshot and entered: " +
            string.Join(", ", result.Saved) +
            (result.Kept.Count > 0 ? $" ({string.Join(", ", result.Kept)})" : "") +
            (result.UnaccountedHours is { } gap ? $" — {Hhmm.Of(gap)} of cycle unaccounted for" : ""));

        return was;
    });

    return Results.Ok(new { reading = result, previous = applied, snapshot = Snapshot(store.State) });
});

/// The driver settling the break-cap question about the clocks on file.
///
/// The one place in the app a reported clock is changed, and it changes because the driver just said to.
/// "Stop asking" is a statement about their mod rather than about this reading, so it is remembered on
/// the rules and can be undone in Settings.
app.MapPost("/api/hos/clock-check", (ClockCheckRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var (message, drive) = ClockCheck.Answer(s, req.Uncap == true, req.StopAsking == true);
    store.Log(s, "dispatch", req.Uncap == true
        ? $"Drive clock corrected to {Hhmm.Of(drive)} — the display was capping it at the break clock."
        : $"Drive clock confirmed at {Hhmm.Of(drive)} as reported.");
    return new { message, driveRemaining = drive, snapshot = Snapshot(s) };
})));

/// Ticking off one of the things a change of employer left to do in ATS.
///
/// Selling a yard is the only one with a consequence for our books — the app was carrying a garage the
/// player no longer owns. Reaching a city puts it on the map, because they just drove there.
app.MapPost("/api/changeover/confirm", (ChangeoverRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var said = Changeover.Confirm(s, req.StepId);
    store.Log(s, "career", said);
    return new { message = said, changeover = Changeover.View(s), snapshot = Snapshot(s) };
})));

/// Putting the changeover instruction away. Allowed — a player who did all of it before being asked
/// should not have to tick boxes about it.
app.MapPost("/api/changeover/close", () => Results.Ok(store.Mutate<object>(s =>
{
    Changeover.Close(s);
    store.Log(s, "career", "Changeover instruction closed off.");
    return new { message = "Closed. It stays in your career file if you want to look back at it.",
                 snapshot = Snapshot(s) };
})));

/// Puts back the clocks that were on file before a screenshot read. One button, because a misread that
/// has already been saved needs an obvious way back rather than a re-typing exercise.
app.MapPost("/api/hos/undo", (HosSnapshot was) => Results.Ok(store.Mutate(s =>
{
    s.Hos.DriveRemaining = Math.Max(0, was.DriveRemaining);
    s.Hos.ShiftRemaining = Math.Max(0, was.ShiftRemaining);
    s.Hos.BreakRemaining = Math.Max(0, was.BreakRemaining);
    s.Hos.CycleRemaining = Math.Max(0, was.CycleRemaining);
    s.Hos.Recap = was.Recap ?? new();
    s.Hos.Source = was.Source ?? "";
    s.Hos.AsOfGameTime = string.IsNullOrWhiteSpace(was.AsOfGameTime) ? s.Status.GameTime : was.AsOfGameTime;
    s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
    store.Log(s, "dispatch", "Screenshot read undone — the previous clocks are back on file.");
    return new { message = "Put back the clocks that were on file before the read.", snapshot = Snapshot(s) };
})));

/// The same interpretation the screenshot reader runs, over a payload you supply instead of an image.
///
/// Exposed for the same reason as /api/geo/distance: the arithmetic that matters here is the day
/// subtraction and the never-guess handling, and neither should need an API key or a picture to check.
app.MapPost("/api/hos/interpret", (HosPayload payload) =>
    Results.Ok(AiService.Interpret(store.State, payload)));

/// The board-reading equivalent: hand it what the model transcribed and get back the figures the app
/// would plan on. Exposed so the conversion can be checked without a key — it is where a delivery
/// window's opening half was being dropped.
app.MapPost("/api/board/interpret", (List<ExtractedLoad> rows) =>
    Results.Ok(new { loads = (rows ?? new()).Select(r => AiService.InterpretLoad(store.State, r)).ToList() }));

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
    // Miles are the app's job, not the driver's. It has coordinates for both ends, so asking somebody to
    // work out Austin to San Antonio by hand — and then judging their empty pay on what they typed — is
    // the same mistake as asking them to convert a delivery window into hours from now.
    var miles = req.Miles;
    if (miles <= 0
        && Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, req.DestCity, req.DestState)
           is { } measured)
        miles = Math.Round(measured, 0);

    var trip = req.Kind == "Maintenance"
        ? DispatchEngine.CreateMaintenanceMove(s, req.DestCity, req.DestState, miles, req.Reason)
        : DispatchEngine.CreateEmptyMove(s, req.DestCity, req.DestState, miles, req.Reason);
    store.Log(s, "dispatch", $"{trip.Number} — {trip.Cargo} to {DispatchEngine.Place(trip.DestCity, trip.DestState)} ({miles:N0} mi): {req.Reason}", trip.Number);
    return new { trip, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- trips

// Payday is Friday, and the app only learns the date when the driver tells it. Anything that moves the
// game clock can cross a payday — closing a load out is the commonest of all — so every one of those
// paths settles what the calendar owes rather than leaving it for whenever a status report happens next.
// RunDuePaydays advances LastPaydayDay and skips what is already settled, so calling it often is safe.
List<Settlement> SettleDue(AppState s)
{
    var due = PayEngine.RunDuePaydays(s);
    foreach (var st in due)
        store.Log(s, "pay", $"{st.Number} paid — ${st.Gross:N2} gross, ${st.Stub?.Net ?? st.Gross:N2} net.", st.Number);
    return due;
}

app.MapGet("/api/trips", () => Results.Ok(store.State.Trips));

app.MapPost("/api/trips/{id}/event", (string id, TripEvent ev) => Results.Ok(store.Mutate(s =>
{
    if (string.IsNullOrWhiteSpace(ev.GameTime)) ev.GameTime = s.Status.GameTime;
    TripService.LogEvent(s, id, ev);
    var paid = SettleDue(s);
    return new { paid, snapshot = Snapshot(s) };
})));

// What dispatch asks for once the trailer is on: real weight, trailer condition as hooked, odometer.
// It used to ask with nowhere to answer, which sent players looking for a field that did not exist.
/// Correcting a stamp already logged, or dropping the event.
///
/// An AM/PM swap on an End unload made a two-hour dock read as thirteen and trained the planner on it,
/// with no way back — the log only ever appended. On a closed trip this re-derives the dock times and
/// works the learned averages out again from every trip, because the average keeps a result rather than
/// its samples and deriving it twice is the only honest way to un-teach one.
app.MapPost("/api/trips/{id}/event/{eventId}", (string id, string eventId, AmendEventRequest req) =>
    Results.Ok(store.Mutate<object>(s =>
{
    var (ev, message, rebuilt) = TripService.AmendEvent(
        s, id, eventId, req.GameTime, req.Detail, req.Remove == true);
    store.Log(s, "dispatch", message);
    return new { message, ev, rebuilt, snapshot = Snapshot(s) };
})));

/// Working the dock averages out again from every trip log. Offered on its own because a career that
/// already learned from a bad reading needs a way back that does not involve editing the reading.
app.MapPost("/api/facility/rebuild", () => Results.Ok(store.Mutate<object>(s =>
{
    var rebuilt = FacilityLearning.Rebuild(s);
    var said = rebuilt.Count == 0
        ? "Nothing to work from yet — no closed trip has a logged Begin/End pair on it. The seeds stand."
        : "Dock times worked out again from every trip log: " +
          string.Join(", ", rebuilt.Select(x => $"{x.Type} off {x.Samples} load(s)")) + ".";
    store.Log(s, "system", said);
    return new { message = said, facilityTimes = FacilityLearning.View(s), snapshot = Snapshot(s) };
})));

app.MapPost("/api/trips/{id}/loaded", (string id, LoadedReportRequest req) => Results.Ok(store.Mutate(s =>
{
    var (trip, notes) = TripService.ReportLoaded(s, id, req.WeightLbs, req.TrailerDamagePct, req.Odometer);
    store.Log(s, "dispatch", $"{trip.Number} loaded report: {string.Join(" ", notes)}", trip.Number);
    var paid = SettleDue(s);
    return new { trip, notes, paid, snapshot = Snapshot(s) };
})));

app.MapPost("/api/trips/{id}/complete", (string id, CompleteTripRequest req) => Results.Ok(store.Mutate(s =>
{
    var audit = TripService.Complete(s, id, req);
    store.Log(s, "trip", audit.Headline, audit.Trip.Number);
    // The commonest way the clock crosses a Friday, and the one that never used to pay.
    var paid = SettleDue(s);
    return new { audit, paid, snapshot = Snapshot(s) };
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
    // One game ID per unit, or the label is ambiguous in exactly the case it exists to resolve.
    Equip.GuardGameId(s, t.GameId, t.Unit);

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

    if (existing == null)
    {
        // Dated on arrival, so "did I only just get this one" is answerable later without guessing from
        // mileage. A truck the company buys new and one bought to replace a write-off both start here.
        if (string.IsNullOrWhiteSpace(t.AcquiredGameTime)) t.AcquiredGameTime = s.Status.GameTime;
        s.Trucks.Add(t);
    }
    else s.Trucks[s.Trucks.IndexOf(existing)] = t;

    // A driver with no tractor gets put in this one.
    //
    // The write-off steps end "add it on the Fleet tab and I will pick it up from there", and until now
    // nothing did: the truck went on the books and the driver stayed grounded with "No truck assigned",
    // one self-assignment guard away from the tractor they had just been told to buy. There is nothing
    // to decide here — they have no truck and this is one.
    if (string.IsNullOrWhiteSpace(s.Driver.AssignedTruckUnit)
        && t.Status == "InService"
        && !s.HiredDrivers.Any(h => h.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase)))
    {
        t.AssignedDriver = s.Driver.Name;
        s.Driver.AssignedTruckUnit = t.Unit;
        s.Settings.GovernedMph = t.GovernedMph;
        s.Status.TruckDamagePct = t.DamagePct;
        s.Status.AtsOdometer = t.AtsOdometer;

        var box = s.Trailers.FirstOrDefault(x =>
            x.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase));
        if (box != null) box.AssignedTruckUnit = t.Unit;

        store.Log(s, "career", $"Unit {t.Ref} added and assigned — you had no tractor.");
    }

    CareerService.Recalculate(s);
    return Snapshot(s);
})));

app.MapPost("/api/fleet/trailer", (Trailer t) => Results.Ok(store.Mutate(s =>
{
    Equip.GuardGameId(s, t.GameId, t.Unit);
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

app.MapPost("/api/fleet/stock", (StockRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var result = Seed.StockYard(s, req.TerminalId, req.Count, req.AlreadyBought,
        req.TransmissionPreference ?? "either", req.AddTrailers);
    store.Log(s, "system", $"Yard stocked: {result.Message}");
    CareerService.Recalculate(s);
    return new { snapshot = Snapshot(s), result };
})));

app.MapPost("/api/fleet/trim", (TrimRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var notes = Migrations.TrimBackdropEquipment(s, req.IncludeYards);
    foreach (var n in notes) store.Log(s, "maintenance", n);
    return new { snapshot = Snapshot(s), notes };
})));

app.MapPost("/api/fleet/assign", (AssignRequest req) => Results.Ok(store.Mutate(s =>
{
    // A driver does not put themselves in a different truck. They ask, and they can be told no.
    Requests.GuardSelfAssignment(s, req.TruckUnit, req.TrailerUnit);

    if (!string.IsNullOrWhiteSpace(req.TruckUnit))
    {
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == req.TruckUnit)
                    ?? throw new InvalidOperationException($"Unit {req.TruckUnit} is not in the fleet.");
        if (truck.Status is "OutOfService" or "Shop" && !req.Force)
            throw new InvalidOperationException($"Unit {truck.Ref} is {truck.Status}. Repair it or force the assignment.");
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
        store.Log(s, "system", $"Trailer {tr.Ref} re-homed to {yard.City}, {yard.State}.");
    }
    else
    {
        var tk = s.Trucks.FirstOrDefault(t => t.Unit.Equals(req.Unit, StringComparison.OrdinalIgnoreCase))
                 ?? throw new InvalidOperationException($"Unit {req.Unit} is not in the fleet.");
        if (tk.HomeTerminalId != yard.Id && Migrations.RoomAt(s, yard) <= 0)
            throw new InvalidOperationException(
                $"{yard.City} holds {yard.TruckCapacity} tractor(s) and is full. Move something out first, or upgrade the yard.");
        tk.HomeTerminalId = yard.Id;
        store.Log(s, "system", $"Unit {tk.Ref} re-homed to {yard.City}, {yard.State}.");
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
    reports = store.State.FleetReports.Take(20).ToList(),
    // Decisions the last report left open: seats to fill, terminations to confirm, units to trade.
    openUnits = FleetOpsService.OpenUnitDecisions(store.State),
    pendingTerminations = store.State.FleetReports
        .SelectMany(r => r.Personnel).Where(p => p.Pending).ToList(),
    retirements = store.State.FleetReports.FirstOrDefault()?.Retirements ?? new List<RetirementRecommendation>(),
    watching = store.State.FleetReports.FirstOrDefault()?.Watching ?? new List<TrailerWatchNote>(),
    recommendedTruck = Seed.RecommendedTruck(store.State)
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

app.MapPost("/api/fleetops/terminate", (TerminateRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var change = FleetOpsService.Terminate(s, req.DriverId, req.Reason ?? "");
    store.Log(s, "career", $"{change.DriverName} terminated: {string.Join(" ", change.Evidence)}");
    return new { snapshot = Snapshot(s), change };
})));

app.MapPost("/api/fleetops/retire", (RetireRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var message = FleetOpsService.RetireUnit(s, req.Unit, req.ReplacementUnit ?? "");
    store.Log(s, "maintenance", message);
    return new { snapshot = Snapshot(s), message };
})));

// The company asking for a trailer. It cannot buy one, so the player does and reports the price.
app.MapPost("/api/fleetops/trailer-request/confirm", (TrailerBoughtRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var trailer = TrailerFleet.Confirm(s, req.RequestId, req.Unit, req.PaidPrice, req.GameTime ?? "", req.GameId ?? "");
    var message = $"Trailer {trailer.Ref} ({trailer.Type}) added to the fleet.";
    store.Log(s, "maintenance", message);
    return new { snapshot = Snapshot(s), message };
})));

app.MapPost("/api/fleetops/trailer-request/decline", (TrailerDeclineRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var declined = TrailerFleet.Decline(s, req.RequestId, req.GameTime ?? "");
    var message = $"{declined.Number} declined — I will not ask about {declined.TrailerType} at {declined.TerminalLabel} again.";
    store.Log(s, "maintenance", message);
    return new { snapshot = Snapshot(s), message };
})));

// Reading a delivery window the way ATS shows it. Exposed so the arithmetic can be checked directly
// rather than only through a screenshot import.
app.MapPost("/api/window/read", (WindowReadRequest req) =>
{
    var parsed = DeliveryWindow.Read(store.State, req.Text);
    return Results.Ok(parsed == null
        ? new { readable = false, hadRange = false, opensAt = (string?)null, dueAt = (string?)null, hoursUntilDue = 0.0 }
        : new
        {
            readable = true,
            hadRange = parsed.HadRange,
            opensAt = parsed.OpensAt is { } o ? GameClock.Format(o) : null,
            dueAt = (string?)GameClock.Format(parsed.DueAt),
            hoursUntilDue = parsed.HoursUntilDue
        });
});

// The 34-hour restart, as a sequence. Report arriving, sit it, report back — and the app checks the
// elapsed game time and the cycle before freight goes back on the truck.
app.MapPost("/api/restart/arrived", (RestartArrivedRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var order = Restart.ReportArrived(s, req.GameTime ?? "", req.City ?? "", req.State ?? "");
    var message = $"{order.Number}: clock started {GameClock.Pretty(order.ArrivedGameTime)}. " +
                  $"Eligible {GameClock.Pretty(order.EligibleGameTime)}.";
    store.Log(s, "hos", message, order.Number);
    return new { snapshot = Snapshot(s), message, order };
})));

app.MapPost("/api/restart/complete", (RestartCompleteRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var (order, accepted, message) = Restart.ReportComplete(s, req.GameTime ?? "");
    store.Log(s, "hos", (accepted ? "" : "REFUSED — ") + message, order.Number);
    return new { snapshot = Snapshot(s), message, accepted, order };
})));

// Asking to be moved into a better unit sitting at the yard. Answered on the spot, because the driver
// is standing there looking at it.
app.MapPost("/api/equipment/ask-better-unit", () => Results.Ok(store.Mutate<object>(s =>
{
    var (granted, message, order) = Requests.AskForBetterUnit(s);
    store.Log(s, "career", (granted ? "" : "Refused — ") + message, order?.Number ?? "");
    return new { snapshot = Snapshot(s), granted, message, order };
})));

// Distance between two places, and whether it was measured from real coordinates or guessed from a
// state centroid. Exposed so the arithmetic can be checked directly.
app.MapGet("/api/geo/distance", (string? cityA, string? stateA, string? cityB, string? stateB) =>
    Results.Ok(new
    {
        miles = Geo.MilesBetween(cityA, stateA, cityB, stateB),
        measured = Geo.IsMeasured(cityA, stateA, cityB, stateB)
    }));

app.MapGet("/api/geo/meta", () => Results.Ok(new { knownCityCount = Geo.KnownCityCount }));

// Whether a receiver will let a truck sit overnight. Seeded on the facility, so the same customer in
// the same city always answers the same way and refreshing cannot re-roll it.
app.MapGet("/api/facility/parking", (string? city, string? state, string? receiver) =>
    Results.Ok(new
    {
        allowsOvernight = Facilities.AllowsOvernightParking(store.State, city, state, receiver),
        note = Facilities.OvernightNote(store.State, city, state, receiver, 12)
    }));

app.MapGet("/api/window/check", (double deadlineHours, double miles, string? trailerType) =>
    Results.Ok(new
    {
        needed = DeliveryWindow.HoursNeeded(store.State, miles, trailerType),
        warning = DeliveryWindow.Implausible(store.State, deadlineHours, miles, trailerType)
    }));

// Correcting a window on a load already in flight. There was no way to do this at all.
app.MapPost("/api/trips/{id}/window", (string id, WindowFixRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var trip = TripService.CorrectWindow(s, id, req.DeadlineHours, req.Note ?? "");
    var message = $"{trip.Number} is now due {GameClock.Pretty(trip.DueGameTime)}.";
    store.Log(s, "dispatch", message, trip.Number);
    return new { snapshot = Snapshot(s), message };
})));

/// Where one of the company's trailers is, as the player last saw it. Asked when they report in at the
/// yard, because that is the moment it matters and the only moment they are looking at the game's
/// trailer screen anyway.
///
/// Keyed on the TRAILER. It used to be keyed on the hired driver the app had down as pulling it, which
/// AI drivers make wrong the first time they hook something else.
app.MapPost("/api/fleetops/whereabouts", (WhereaboutsRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var t = s.Trailers.FirstOrDefault(x => x.Unit.Equals((req.TrailerUnit ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("No such trailer in the fleet.");

    t.Whereabouts = Whereabouts.Normalise(req.Direction);
    t.WhereaboutsCity = (req.City ?? "").Trim();
    t.WhereaboutsState = (req.State ?? "").Trim().ToUpperInvariant();
    t.WhereaboutsGameTime = s.Status.GameTime;

    var estimate = Whereabouts.Assess(s, t);
    store.Log(s, "fleet", $"{t.Ref}: {estimate.Text}");
    return new { estimate, snapshot = Snapshot(s) };
})));

// The driver has now actually seen a settlement. Separate from paying it on purpose: paying is the
// calendar's job and telling them is the screen's, and conflating the two is what let a payday land on a
// fuel-stop log and go unmentioned.
app.MapPost("/api/pay/acknowledge", (AcknowledgePayRequest? req) => Results.Ok(store.Mutate<object>(s =>
{
    var marked = PayEngine.MarkAnnounced(s, req?.Numbers);
    return new { marked, snapshot = Snapshot(s) };
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
    store.Log(s, "maintenance", $"{created.Number} {created.Kind} on {created.UnitKind.ToLowerInvariant()} {Equip.Label(s, created.Unit)}: {created.Description}", created.Number);
    return new { workOrder = created, snapshot = Snapshot(s) };
})));

app.MapPost("/api/maintenance/workorder/{number}/complete", (string number, CompleteWoRequest req) => Results.Ok(store.Mutate(s =>
{
    var wo = MaintenanceService.CompleteWorkOrder(s, number, req.Cost, req.DamageAfter, req.Vendor, req.PaidBy, req.Notes);
    store.Log(s, "maintenance", $"{wo.Number} closed — ${wo.Cost:N2} paid by {wo.PaidBy}, damage now {wo.DamageAfter:0.#}%.", wo.Number);
    return new { workOrder = wo, snapshot = Snapshot(s) };
})));

// What the shop will cost you in hours, before you commit to it. Quoted against whatever damage the
// driver asks about, so they can price a repair they have not taken yet.
app.MapGet("/api/maintenance/quote", (double? truck, double? trailer, bool? companyShop) =>
{
    var s = store.State;
    var atShop = companyShop ?? Shop.AtCompanyShop(s);
    var td = truck ?? Math.Max(s.Status.TruckDamagePct,
        s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit)?.DamagePct ?? 0);
    var rd = trailer ?? Math.Max(s.Status.TrailerDamagePct,
        s.Trailers.FirstOrDefault(t => t.Unit == s.Driver.AssignedTrailerUnit)?.DamagePct ?? 0);
    return Results.Ok(Shop.Quote(s, td, rd, atShop,
        s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit)));
});

// A tractor past the write-off line. The player reports what the wreck fetched for scrap; the app
// never guesses at it, and never invents a number ATS did not show them.
app.MapPost("/api/maintenance/writeoff", (WriteOffRequest req) => Results.Ok(store.Mutate(s =>
{
    var result = Shop.WriteOff(s, req.Unit, req.DriverFault, req.ScrapRecovery, req.Notes ?? "");
    store.Log(s, "maintenance",
        $"Unit {Equip.Label(s, result.Unit)} written off — insurance ${result.InsurancePayout:N2} less ${result.Deductible:N2} deductible, " +
        $"scrap ${result.ScrapRecovery:N2}, net ${result.NetRecovery:N2}.", result.Unit);
    return new { writeOff = result, snapshot = Snapshot(s) };
})));

// ---------------------------------------------------------------- safety

// Filing an incident produces a decision, not a form. The driver reports; the company decides.
app.MapPost("/api/incidents", (Incident inc) => Results.Ok(store.Mutate<object>(s =>
{
    // Damage reported with the incident goes on the truck first, because whether the tractor survives is
    // read off that figure and the driver has just told us what it is.
    var truck = DispatchEngine.AssignedTruck(s);
    if (inc.TruckDamagePctAfter >= 0 && truck != null)
    {
        truck.DamagePct = Math.Clamp(inc.TruckDamagePctAfter, 0, 100);
        s.Status.TruckDamagePct = truck.DamagePct;
    }

    var (created, action) = SafetyService.FileAndDecide(s, inc);
    store.Log(s, "safety", $"{created.Number} {created.Kind} ({created.FaultAttribution} fault): {created.Description}", created.Number);
    if (action != null)
        store.Log(s, "safety", $"{action.Number} {action.Level} issued on {created.Number}.", action.Number);

    // A tractor past the write-off line is not a shop job, and nobody goes looking for a repair estimate
    // after putting a truck in a ditch — so it is said here, where they reported it.
    List<string>? writeOff = null;
    if (TotalLoss.Pending(s) is { } wrecked)
    {
        // Order the replacement before writing the steps, so they can name it.
        TotalLoss.OrderReplacement(s, wrecked);
        writeOff = TotalLoss.Steps(s, wrecked);
        store.Log(s, "maintenance",
            $"Unit {wrecked.Ref} written off in {created.Number} — {wrecked.DamagePct:0.#}%. Dispatch held until it is replaced.",
            wrecked.Unit);
    }

    return new { incident = created, action, writeOff, snapshot = Snapshot(s) };
})));

app.MapPost("/api/incidents/{number}/forgive", (string number, ForgiveRequest req) => Results.Ok(store.Mutate(s =>
{
    var inc = SafetyService.Forgive(s, number, req.Reason ?? "", req.Force);
    store.Log(s, "safety", $"{inc.Number} cleared by Safety: {inc.ForgivenReason}", inc.Number);
    return Snapshot(s);
})));

app.MapPost("/api/discipline/{number}/acknowledge", (string number) => Results.Ok(store.Mutate(s =>
{
    var a = SafetyService.Acknowledge(s, number);
    store.Log(s, "safety", $"{a.Number} acknowledged by the driver.", a.Number);
    return Snapshot(s);
})));

// Management override. The normal path is /api/incidents deciding for itself; this exists because the
// player is also roleplaying the safety manager and may want to overrule. Logged as an override.
app.MapPost("/api/discipline", (DisciplineRequest req) => Results.Ok(store.Mutate(s =>
{
    var action = SafetyService.Issue(s, req.Level, req.Reason, req.CorrectiveAction, req.IncidentNumber, req.ExpiresAfterLoads);
    action.IssuedBy = "Management override";
    store.Log(s, "safety", $"OVERRIDE: {action.Number} {action.Level} issued manually: {action.Reason}", action.Number);
    return new { action, snapshot = Snapshot(s) };
})));

app.MapPost("/api/discipline/reinstate", (NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    SafetyService.Reinstate(s, req.Notes ?? "");
    store.Log(s, "safety", $"Driver reinstated: {req.Notes}");
    return Snapshot(s);
})));

// ---------------------------------------------------------------- payroll & money

// Payday is Friday and a job change settles up — there is no "run one now". Kept as an endpoint so an
// older UI gets a clear answer rather than a 404.
app.MapPost("/api/settlements/run", (NoteRequest _) =>
    Results.BadRequest(new { error = "Settlements run themselves. Payday is Friday, and changing employer settles the old one first." }));

app.MapPost("/api/settlements/legacy-run", (NoteRequest req) => Results.Ok(store.Mutate(s =>
{
    var settlement = PayEngine.RunSettlement(s, req.Notes);
    store.Log(s, "pay", $"{settlement.Number} issued — gross ${settlement.Gross:N2} over {settlement.TripNumbers.Count} trip(s).", settlement.Number);
    return new { settlement, snapshot = Snapshot(s) };
})));

app.MapGet("/api/finance", () => Results.Ok(LedgerService.Summary(store.State)));

app.MapGet("/api/finance/position", () => Results.Ok(LedgerService.Position(store.State)));

// Setting the balance from the Finances tab, where the mismatch warning actually appears. Kept apart
// from /api/status so reporting a number here does not count as confirming the whole status report.
app.MapPost("/api/finance/balance", (BalanceRequest req) => Results.Ok(store.Mutate(s =>
{
    if (req.Balance == null)
    {
        // Explicitly forgetting it — back to "never reported" rather than a reported zero.
        s.Status.AtsBankBalance = 0;
        s.Status.AtsBalanceGameTime = "";
        store.Log(s, "ledger", "ATS bank balance cleared — treated as unreported.");
        return Snapshot(s);
    }

    s.Status.AtsBankBalance = req.Balance.Value;
    s.Status.AtsBalanceGameTime = string.IsNullOrWhiteSpace(req.GameTime) ? s.Status.GameTime : req.GameTime;
    store.Log(s, "ledger", $"ATS bank balance reported: ${req.Balance.Value:N2}.");
    return Snapshot(s);
})));

// Squaring the books against what ATS actually holds. Takes the balance rather than reading whatever was
// last reported, because this is the moment the player is looking at the game and typing what they see.
app.MapPost("/api/finance/true-up", (TrueUpRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var balance = req.AtsBalance ?? s.Status.AtsBankBalance;
    var (squared, expected, shortfall, message) = LedgerService.TrueUp(s, balance);

    store.Log(s, "ledger", squared
        ? $"True-up: ATS ${balance:N2} against ${expected:N2} on the books. Squared."
        : $"True-up: ATS ${balance:N2} against ${expected:N2} on the books — short ${shortfall:N2}, not adjusted.");

    return new { squared, expected, shortfall, message,
                 position = LedgerService.Position(s), snapshot = Snapshot(s) };
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

// The driver asking to go home. Answered when the next load closes out, not now.
app.MapPost("/api/career/request-home", (AskHomeRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var r = Requests.SubmitHomeRequest(s, req.Reason ?? "");
    store.Log(s, "career", $"{r.Number}: home time requested after {r.DaysOutAtRequest:0.#} days out.", r.Number);
    return new { snapshot = Snapshot(s), request = r,
                 message = "Request is in. I will give you an answer when you close your next load out." };
})));

// Asking to be re-rigged onto a different trailer type. Off probation only.
app.MapPost("/api/career/request-trailer", (AskTrailerRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var r = Requests.SubmitTrailerRequest(s, req.TrailerType);
    store.Log(s, "career", $"{r.Number}: requested {r.RequestedType}.", r.Number);
    return new { snapshot = Snapshot(s), request = r,
                 message = $"Asked operations for {r.RequestedType.ToLowerInvariant()}. Answer comes with your next close-out." };
})));

// Recording a licence endorsement. The player telling the app about their own CDL.
app.MapPost("/api/career/endorsement", (EndorsementRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var message = Endorsements.Record(s, req.Kind, req.Has, req.GameTime ?? "");
    store.Log(s, "career", message);
    return new { snapshot = Snapshot(s), message };
})));

// The driver telling us what they have levelled up in the game. Nothing here is ever inferred — these
// numbers live in ATS where only the player can read them.
app.MapPost("/api/career/skills", (SkillsRequest req) => Results.Ok(store.Mutate(s =>
{
    static int Clamp(int? v, int now) => v is null ? now : Math.Clamp(v.Value, 0, DriverSkills.Max);

    var sk = s.Driver.Skills;
    var before = $"{sk.LongDistance}/{sk.HighValue}/{sk.Fragile}/{sk.JustInTime}";
    sk.LongDistance = Clamp(req.LongDistance, sk.LongDistance);
    sk.HighValue = Clamp(req.HighValue, sk.HighValue);
    sk.Fragile = Clamp(req.Fragile, sk.Fragile);
    sk.JustInTime = Clamp(req.JustInTime, sk.JustInTime);

    store.Log(s, "career", $"Skills updated: Long Distance {sk.LongDistance}, High Value {sk.HighValue}, " +
                           $"Fragile {sk.Fragile}, Just in Time {sk.JustInTime} (was {before}).");
    return Snapshot(s);
})));

// Taking the truck a Master Driver has earned. A choice, not an assignment — the app cannot buy anything
// in ATS, so what it raises is the usual equipment order.
app.MapPost("/api/career/showcase", (ShowcaseRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    if (!s.Driver.ShowcaseOffered || s.Driver.ShowcaseTaken)
        throw new InvalidOperationException("There is no truck on offer.");
    if (req.Index is null) throw new InvalidOperationException("Pick one.");

    var pick = Seed.ShowcaseChoice(s, req.Index.Value)
               ?? throw new InvalidOperationException("That is not one of the trucks on offer.");

    var yard = HomeTime.HomeTerminal(s);
    var label = yard != null ? DispatchEngine.Place(yard.City, yard.State) : "your home yard";

    var order = EquipmentService.IssuePurchasedUpgrade(s,
        $"{s.Driver.RankTitle} award — {s.Driver.Name} picked their truck.",
        label, yard?.Id ?? "", s.Driver.Name,
        s.Driver.AssignedTruckUnit, pick.Label);

    // The truck being stepped out of does not evaporate — it either goes down the list or it is sold.
    var stepping = DispatchEngine.AssignedTruck(s);
    var cascade = stepping == null ? null : EquipmentService.CascadeOldTruck(s, stepping);
    if (cascade != null && order != null) order.Instruction += " " + cascade;

    s.Driver.ShowcaseTaken = true;
    s.Driver.ShowcaseOffered = false;

    // Picking a gearbox they did not ask for at hire is them changing their mind, and the app takes them
    // at their word rather than quietly issuing something they said they did not want.
    var before = s.Application?.TransmissionPreference ?? "either";
    if (s.Application != null && before != "either" && before != pick.TransType)
    {
        s.Application.TransmissionPreference = pick.TransType;
        store.Log(s, "career", $"Transmission preference now {pick.TransType} — picked one on the award truck.");
    }

    store.Log(s, "career", $"{s.Driver.RankTitle} award taken: {pick.Label}.", order?.Number ?? "");
    return new { order, picked = pick.Label, snapshot = Snapshot(s) };
})));

// What the driver wants to be running. Read live by load scoring, so it takes effect on the next board.
app.MapPost("/api/career/trip-length", (TripLengthRequest req) => Results.Ok(store.Mutate(s =>
{
    var pref = (req.Preference ?? "").Trim().ToLowerInvariant();
    if (pref is not ("short" or "medium" or "long" or "otr"))
        throw new InvalidOperationException("Trip length is short, medium, long or otr.");

    s.Application ??= new DriverApplication();
    s.Application.PreferredTripLength = pref;
    store.Log(s, "career", $"Trip-length preference changed to {pref}. Dispatch will weigh the board on it " +
                           "from the next load.");
    return Snapshot(s);
})));

app.MapPost("/api/career/home-time", (HomeTimeArrangementRequest req) => Results.Ok(store.Mutate(s =>
{
    var days = HomeTime.DaysFor(req.Preference);
    if (days <= 0 && !string.Equals(req.Preference, "none", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("That is not a home-time arrangement I recognise.");

    s.Application ??= new DriverApplication();
    s.Application.HomeTimePreference = req.Preference;
    s.Driver.HomeTimeIntervalDays = days;
    if (string.IsNullOrWhiteSpace(s.Driver.LastHomeGameTime))
        s.Driver.LastHomeGameTime = string.IsNullOrWhiteSpace(s.Driver.HiredGameDate) ? s.Status.GameTime : s.Driver.HiredGameDate;

    store.Log(s, "career", $"Home-time arrangement changed to {HomeTime.LabelFor(req.Preference)}.");
    return Snapshot(s);
})));

app.MapPost("/api/settings/facility-time", (FacilityTimeRequest req) => Results.Ok(store.Mutate(s =>
{
    FacilityLearning.SetManual(s, req.TrailerType, req.LoadingHours, req.UnloadingHours, req.Manual);
    return Snapshot(s);
})));

/// Mod archives we can find, so nobody has to go hunting through folders for one.
///
/// Steam keeps workshop mods under app 270880, and people put games on a second drive — so the Steam
/// libraries are read out of libraryfolders.vdf rather than assumed to be under Program Files.
app.MapGet("/api/mod/scan", () => Results.Ok(new
{
    candidates = ModCompanyNames.Scan(),
    current = store.State.Settings.CompanyNameModPath,
    known = store.State.Settings.ModCompanyNames.Count,
}));

/// Reading the company names out of one.
///
/// Only def/company is touched — a few hundred kilobytes of text out of a file that is mostly models.
/// A mod that cannot be opened says so and changes nothing: the stock names still work, and failing to
/// a wrong name silently is the one outcome worth engineering against.
app.MapPost("/api/mod/read", (ModReadRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var reading = ModCompanyNames.Read(req.Path ?? "");
    if (!reading.Ok) return new { reading, message = reading.Error, snapshot = Snapshot(s) };

    s.Settings.ModCompanyNames = reading.Names;
    s.Settings.CompanyNameModPath = req.Path ?? "";
    s.Settings.RenamesCompanies = "yes";

    var said = $"Read {reading.Names.Count} company name(s) out of your mod, off {reading.Definitions} " +
               "definitions. Dedicated accounts will use what your game calls them.";
    store.Log(s, "system", said);
    return new { reading, message = said, snapshot = Snapshot(s) };
})));

/// The dedicated accounts this driver could be put on, and why they cannot be if they cannot.
///
/// Filtered by the map they have driven and the divisions their carrier hauls. An empty list is a real
/// answer — an account with a company they can never reach would produce no freight at all.
app.MapGet("/api/career/dedicated/offers", () => Results.Ok(new
{
    blocked = DropHook.DedicatedBlockedBecause(store.State),
    offers = Dedicated.Offers(store.State),
    renamesCompanies = store.State.Settings.RenamesCompanies,
    reachedStates = AtsCompanies.ReachedStates(store.State).OrderBy(x => x).ToList(),
}));

/// Putting the driver on one of those accounts.
///
/// `AsTheGameCallsIt` is what a renaming mod shows for the company. Asked at exactly this moment and
/// nowhere else — it is the only time a company name has to match what the player is reading off job
/// listings, and nobody running ordinary freight should be asked about a mod.
app.MapPost("/api/career/dedicated/assign", (AssignAccountRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    if (DropHook.DedicatedBlockedBecause(s) is { } no) throw new InvalidOperationException(no);

    if (req.RenamesCompanies is "yes" or "no") s.Settings.RenamesCompanies = req.RenamesCompanies;

    var message = Dedicated.AssignAccount(s, req.Company, req.AsTheGameCallsIt);

    // Putting somebody on the account also puts them on the arrangement — through an equipment order,
    // like every other change of trailer. The app cannot hook anything in ATS, so the driver reports to
    // the yard and swaps, and nothing on the books moves until they say it happened.
    DropHook.Ensure(s);
    var order = EquipmentService.IssueTrailerReassignment(s, DropHook.TrailerType,
        $"Dedicated drop and hook — {s.Driver.DedicatedAccount}.");
    if (order != null)
        message += $" {order.Number} raised: report to the yard, drop what you are pulling and go " +
                   "freight-market from there.";

    store.Log(s, "career", message);
    return new { message, order, snapshot = Snapshot(s) };
})));

/// Giving up a trailer the driver asked for and going back on the roster.
app.MapPost("/api/career/trailer-arrangement/release", () => Results.Ok(store.Mutate<object>(s =>
{
    var message = Requests.ReleaseTrailerArrangement(s);
    store.Log(s, "career", message);
    return new { message, snapshot = Snapshot(s) };
})));

app.MapPost("/api/career/dedicated", (DedicatedRequest req) => Results.Ok(store.Mutate<object>(s =>
{
    var message = Dedicated.SetAccount(s, req.OnDedicated, req.Account ?? "");
    store.Log(s, "career", message);
    return new { snapshot = Snapshot(s), message };
})));

// ---------------------------------------------------------------- AI

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
    // The build that last wrote this career, so an update can be told apart from a fresh file.
    careerVersion = store.State.AppVersion,
    appVersion = Build.Version,
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
Console.WriteLine($"  TruckSim Dispatcher {Build.Display}");
Console.WriteLine("  ===================================");
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
        version = Build.Version,
        versionDisplay = Build.Display,
        onboarded = s.Onboarded,
        // Diagnostic: the shape this career file is in. 2 means day numbers match the game.
        schemaVersion = s.SchemaVersion,
        company = s.Company,
        driver = s.Driver,
        application = s.Application,
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
        // Restart history, so a driver can see what they sat and when — including the ones that were
        // stood down because the cycle came back without needing them.
        restartOrders = s.RestartOrders,
        counters = s.Counters,
        discovered = s.Discovered,
        events = s.Events.Take(80).ToList(),
        views = new
        {
            garageOpportunities = DiscoveryService.GarageOpportunityView(s),
            // Everywhere the truck has been, with what can be done about a yard there. The opportunity
            // list above is a hard-filtered subset and used to carry this heading, which made a career
            // with a dozen cities look like it had lost nine of them.
            reached = DiscoveryService.ReachedView(s),
            networkSummary = DiscoveryService.NetworkSummary(s),
            unacknowledged = SafetyService.Unacknowledged(s),
            facilityTimes = FacilityLearning.View(s),
            // Empty moves worth offering when the board is rejected and home time is close: the run
            // to the yard, and markets on the way worth pulling a board from. Miles included, so the
            // driver never types a distance the app already knows.
            repositionOffers = HomeTime.RepositionOffers(s),
            payroll = new
            {
                nextPaydayDay = PayEngine.NextPayday(s).Day,
                daysToPayday = PayEngine.NextPayday(s).DaysAway,
                s.Driver.UnsettledPay,
                healthPremium = s.Settings.HealthPremiumPerPeriod,
                stateCode = (HomeTime.HomeTerminal(s)?.State ?? s.Company.TerminalState ?? "").ToUpperInvariant(),
                stateRate = PayrollTax.StateRate(HomeTime.HomeTerminal(s)?.State ?? s.Company.TerminalState),
                ytdGross = PayrollTax.YtdGross(s)
            },
            // The arrangement, when the driver is on it: which ATS market to pull from, and whether it
            // is tied to one account.
            dropHook = new
            {
                on = DropHook.Active(s),
                dedicated = DropHook.DedicatedActive(s),
                instruction = DropHook.Active(s) ? DropHook.Instruction(s) : "",
                premiumCpm = s.Driver.Pay.DedicatedDropHookCpm,
                dedicatedBlocked = DropHook.DedicatedBlockedBecause(s),
                rankAllows = DropHook.RankAllowsDedicated(s),
            },

            // A trailer the driver asked for is theirs until they ask to come off it.
            trailerArrangement = new
            {
                byRequest = s.Driver.TrailerByRequest,
                type = DispatchEngine.AssignedTrailer(s)?.Type ?? "",
            },

            // How long they have been on this box and what that does to the odds of being moved off it.
            // The chance used to be flat and invisible; a rising one nobody can see is the same thing.
            trailerTenure = HomeTime.TenureView(s),

            dedicated = new
            {
                carrierRuns = Dedicated.CarrierRunsDedicated(s),
                s.Driver.OnDedicated,
                s.Driver.DedicatedAccount,
                s.Driver.OffAccountLoads,
                awaitingAccount = Dedicated.AwaitingAccount(s),
                onAccountCount = Dedicated.Active(s) ? s.Board.Count(b => Dedicated.IsOnAccount(s, b)) : 0,
                note = Dedicated.BoardNote(s)
            },
            // Which incidents still bar the driver from carriers, and how close each is to clearing.
            faultStanding = s.Incidents
                .Where(i => i.FaultAttribution == "Driver" && i.Preventable)
                .Select(i => new
                {
                    i.Number, i.Kind, i.Severity, i.GameTime, i.Description,
                    forgiven = !string.IsNullOrWhiteSpace(i.ForgivenGameTime),
                    i.ForgivenReason,
                    i.AgesOffAfterLoads,
                    loadsToClear = SafetyService.LoadsToAgeOff(s, i),
                    counting = SafetyService.CountingFaults(s).Any(x => x.Number == i.Number)
                }).ToList(),
            countingFaults = SafetyService.CountingFaults(s).Count,
            homeTime = HomeTime.Status(s),
            // Standing notice that a periodic review is coming, so a driver who is not at the yard still
            // knows it is waiting for them. The popup covers the moment it happens; this covers before.
            reviewNotice = PeriodicReview.Notice(s),
            // Where the driver stands after being let go: which carriers will have them, and what the
            // run back to the ordinary market still needs.
            // Steps for a tractor that is finished, so they are in front of the driver rather than behind
            // a shop estimate nobody thinks to ask for.
            writeOff = TotalLoss.Pending(s) is { } wreck
                ? new { unit = wreck.Ref, damagePct = wreck.DamagePct, steps = TotalLoss.Steps(s, wreck) }
                : null,
            careerOver = s.Driver.CareerOver
                ? new { over = true, reason = s.Driver.CareerOverReason, at = s.Driver.CareerOverGameTime }
                : null,
            secondChance = new
            {
                applies = Carriers.NeedsSecondChance(s),
                terminatedFor = s.Driver.TerminationReason,
                progress = Redemption.Assess(s),
            },
            periodicReviews = s.PeriodicReviews.Take(10).ToList(),
            homeTimeOptions = HomeTime.Options.Select(o => new { key = o.Key, label = o.Label, days = o.Days, note = o.Note }).ToList(),
            backdrop = Backdrop(s),
            hos = HosEngine.Describe(s, truck),
            // Recap versus the 34, weighed for them. The decision drivers get wrong most often.
            recap = Recap.Assess(s),
            // The restart on order, if any, plus where the app would send them.
            restart = Restart.Open(s) is { } ro
                ? new { order = (RestartOrder?)ro, instructions = Restart.Instructions(s, ro), needed = true }
                : Restart.Needed(s)
                    ? new { order = (RestartOrder?)null, instructions = new List<string>(), needed = true }
                    : null,
            // Out of window on a customer's property: legal, not their fault, and they cannot move.
            stranded = Stranded.Assess(s),
            finance = LedgerService.Summary(s),
            career = CareerService.Review(s),
            // Things the driver has asked for, what they hold, and where probation stands.
            requests = new
            {
                home = Requests.OpenHomeRequest(s),
                trailer = Requests.OpenTrailerRequest(s),
                trailerTypes = Requests.RequestableTrailerTypes(s),
                canRequestTrailer = s.Driver.Rank != "probationary",
                recentHome = s.HomeTimeRequests.Take(4).ToList(),
                recentTrailer = s.TrailerTypeRequests.Take(4).ToList()
            },
            endorsements = new
            {
                held = Endorsements.Held(s),
                all = Endorsements.All
                    .Select(e => new { key = e.Key, label = e.Label, covers = e.Covers, examples = e.Examples })
                    .ToList(),
                // A career migrated off the old CDL model has hazmat on file but no classes chosen.
                needsChoosing = Endorsements.NeedsClassesChosen(s)
            },
            probation = new
            {
                on = Probation.IsOn(s),
                standing = Probation.Standing(s),
                intervalDays = Probation.ReviewIntervalDays,
                passesNeeded = Probation.PassesToClear,
                passesInARow = Probation.ConsecutivePasses(s),
                reviews = s.ProbationReviews.Take(6).ToList(),
                thresholds = Probation.MeetsCompanyThresholds(s).Shortfall
            },
            maintenanceAlerts = MaintenanceService.FleetAlerts(s),
            dispatchBlockers = DispatchEngine.DispatchBlockers(s, truck, trailer),
            // Condition of the equipment and what the company wants done about it, quoted in hours.
            shopOrder = Shop.Assess(s, truck, trailer),
            // The write-off line for every unit we can actually read, since it moves with the odometer.
            writeOffLines = s.Trucks.Where(t => !t.Retired && t.InGameGarage)
                .Select(t => new
                {
                    unit = t.Unit,
                    miles = t.AtsOdometer > 0 ? t.AtsOdometer : t.ServiceMiles,
                    atPct = Shop.TotalLossPctFor(s, t),
                    explain = Shop.ExplainTotalLossLine(s, t)
                }).ToList(),
            infoNeeded = DispatchEngine.MissingContext(s),
            activeTrip = TripService.Active(s),
            // Whether the receiver will have the truck overnight. Said in the dispatch briefing and then
            // lost with the board, which is the one place it was no longer needed — it is planning
            // information for the run, not for the decision to take it.
            receiverParking = Facilities.ParkingFor(s, TripService.Active(s)),
            // What close-out measures the run against. A trip that was already rolling before the app
            // captured one falls back to the last reading the driver reported.
            startOdometer = TripService.Active(s) is { StartOdometer: > 0 } at
                ? at.StartOdometer
                : TripService.LastReportedOdometer(s, TripService.Active(s)),
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
            aiConfigured = AiService.Configured(s.Settings),

            // Sell, buy and drive-to-first, left over from a change of employer. Standing, because it is
            // work across several sessions in ATS rather than something to read once and lose.
            changeover = Changeover.View(s),

            // A drive figure that matches the break clock, which is what a break-capped HOS display looks
            // like. Computed off state rather than off a request, so hand entry, the screenshot reader and
            // the close-out all raise it, and so an unanswered question survives a reload.
            clockQuery = ClockCheck.Capped(s),

            showcase = new
            {
                offered = s.Driver.ShowcaseOffered && !s.Driver.ShowcaseTaken,
                taken = s.Driver.ShowcaseTaken,
                choices = s.Driver.ShowcaseOffered && !s.Driver.ShowcaseTaken
                    ? Seed.ShowcaseChoices(s)
                    : new List<object>()
            },

            // A Monday has gone by and the books have not been squared against the game. Not necessarily
            // TODAY's Monday — the clock jumps in whatever steps the player's driving took, and a week
            // stepped over used to be a week skipped rather than a week deferred.
            trueUp = new
            {
                due = LedgerService.TrueUpDue(s),
                forDay = LedgerService.TrueUpFor(s)?.Day,
                daysAgo = LedgerService.TrueUpFor(s)?.DaysAgo,
                expected = LedgerService.TotalCompanyCash(s),
                lastReported = s.Status.AtsBankBalance,
                shortfall = s.Driver.TrueUpShortfall
            },

            // Paydays the driver has not actually been shown.
            //
            // Read off state rather than off whatever the last call returned, because settling happens on
            // whichever endpoint the clock crossed a Friday on — a status report, a close-out, a fuel-stop
            // log — and two of those had no UI for it. Money moved, the record was right, and nothing said
            // so. See Settlement.Announced.
            unannouncedPay = PayEngine.Unannounced(s)
        }
    };
}

/// <summary>
/// Evaluates the board and clears it when the driver is out of hours.
///
/// A board that failed purely on the clock is stale by definition — the driver is going to sleep, and
/// the jobs will have turned over by the time they are legal. Leaving it up invites authorizing a load
/// that no longer exists.
/// </summary>
BoardDecision EvaluateBoard(AppState s)
{
    var decision = DispatchEngine.EvaluateBoard(s);
    if (decision.OutOfHours && s.Board.Count > 0)
    {
        s.Board.Clear();
        store.Log(s, "dispatch", decision.NeedsRestart
            ? "Board cleared — out of cycle, 34-hour restart required."
            : "Board cleared — out of hours, 10-hour reset required.");
    }
    return decision;
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
           $"Your equipment is unit {truck?.Ref} — {truck?.Year} {truck?.Make} {truck?.Model}, {truck?.Transmission} — " +
           $"pulling trailer {trailer?.Ref}, a {trailer?.Length} {trailer?.Type}. It is not the newest truck on the property; " +
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

/// Where a hired driver appears to be with the company's trailer. The direction is the honest part.
record WhereaboutsRequest(string? TrailerUnit, string Direction, string? City, string? State);
record AcknowledgePayRequest(List<string>? Numbers);
record AssignRequest(string? TruckUnit, string? TrailerUnit, bool Force);
record CompleteWoRequest(decimal Cost, double DamageAfter, string Vendor, string PaidBy, string Notes);
record WriteOffRequest(string Unit, bool DriverFault, decimal ScrapRecovery, string? Notes);
record LoadedReportRequest(double? WeightLbs, double? TrailerDamagePct, double? Odometer);
record DisciplineRequest(string Level, string Reason, string CorrectiveAction, string IncidentNumber, int ExpiresAfterLoads);
record ReconcileRequest(string? Account, decimal Amount, string Memo, decimal? FixUnsettledPay, int? FixFreightCounter);
record CareerActionRequest(string? Rank, string? Note, bool Force);
record AiRequest(string? Message);
record ExtractRequest(List<ScreenshotImage>? Images);
record RestoreRequest(string File);
record ResetRequest(string Confirm, bool? ResetSettings);
record DiscoverRequest(string City, string? State);
record TrimRequest(bool IncludeYards);
record BalanceRequest(decimal? Balance, string? GameTime);
record ForgiveRequest(string? Reason, bool Force);
record TerminateRequest(string DriverId, string? Reason);
record RetireRequest(string Unit, string? ReplacementUnit);
record TrailerBoughtRequest(string RequestId, string Unit, decimal PaidPrice, string? GameTime, string? GameId);
record TrailerDeclineRequest(string RequestId, string? GameTime);
record RestartArrivedRequest(string? GameTime, string? City, string? State);
record RestartCompleteRequest(string? GameTime);
record WindowReadRequest(string? Text);
record WindowFixRequest(double DeadlineHours, string? Note);
record AskHomeRequest(string? Reason);
record AskTrailerRequest(string TrailerType);
record EndorsementRequest(string Kind, bool Has, string? GameTime);
record DedicatedRequest(bool OnDedicated, string? Account);
record FacilityTimeRequest(string TrailerType, double LoadingHours, double UnloadingHours, bool Manual);
record StockRequest(string TerminalId, int Count, bool AlreadyBought, string? TransmissionPreference, bool AddTrailers);
record AdoptRequest(string Path);
record HomeTimeArrangementRequest(string Preference);
record TripLengthRequest(string? Preference);
record TrueUpRequest(decimal? AtsBalance);
record ClockCheckRequest(bool? Uncap, bool? StopAsking);
record ChangeoverRequest(string? StepId);
record AmendEventRequest(string? GameTime, string? Detail, bool? Remove);
record AssignAccountRequest(string? Company, string? AsTheGameCallsIt, string? RenamesCompanies);
record ModReadRequest(string? Path);
record ShowcaseRequest(int? Index);
record SkillsRequest(int? LongDistance, int? HighValue, int? Fragile, int? JustInTime);
