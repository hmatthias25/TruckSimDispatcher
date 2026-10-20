using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;
using TruckSimOwnerOperator;

// ---------------------------------------------------------------- startup

var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
var store = new OoStore(exeDir);

// A port of its own, so it can run beside the company-driver app (5173).
var port = 5273;
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
    o.SerializerOptions.Converters.Add(new WholeNumberConverter());
});
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

var app = builder.Build();
var ui = LoadEmbeddedUi();

app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Exception ex)
    {
        ctx.Response.StatusCode = 400;
        ctx.Response.ContentType = "application/json";
        var why = ex is BadHttpRequestException && ex.InnerException is JsonException je
            ? $"The app could not read what was sent: {je.Message}"
            : ex.Message;
        await ctx.Response.WriteAsJsonAsync(new { error = why });
    }
});

// ---------------------------------------------------------------- UI

app.MapGet("/", () => Results.Content(ui["ui/index.html"], "text/html; charset=utf-8"));
app.MapGet("/app.js", () => Results.Content(ui["ui/app.js"], "text/javascript; charset=utf-8"));
app.MapGet("/styles.css", () => Results.Content(ui["ui/styles.css"], "text/css; charset=utf-8"));
app.MapGet("/favicon.ico", () => Results.NoContent());

// ---------------------------------------------------------------- career

app.MapGet("/api/bootstrap", () => Results.Ok(Snapshot(store.Career)));

/// The cities a home garage can be in: the game's own, from Core's market table.
app.MapGet("/api/cities", () =>
{
    var s = new AppState();
    GameProfile.Activate(s);
    return Results.Ok(Markets.BuiltIn
        .Where(m => m.HasGarage)
        .OrderBy(m => m.State).ThenBy(m => m.City)
        .Select(m => new { city = m.City, state = m.State, tier = m.Tier }));
});

app.MapPost("/api/start", (StartRequest r) => Results.Ok(store.Mutate(c =>
{
    Onboarding.Start(c, r);
    return Snapshot(c);
})));

app.MapPost("/api/reset", (ResetRequest r) =>
{
    if (!string.Equals(r.Confirm, "RESET", StringComparison.Ordinal))
        throw new InvalidOperationException("Type RESET to start a new career. The old one is kept in the backups folder.");
    store.Reset();
    return Results.Ok(Snapshot(store.Career));
});

// ---------------------------------------------------------------- where and when

app.MapPost("/api/status", (StatusRequest u) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    var s = c.Game;
    var wasTime = s.Status.GameTime;
    var wasHome = HomeLife.AtHome(c);
    var city = (u.LocationCity ?? "").Trim();
    if (city.Length > 0 && !city.Equals(s.Status.LocationCity, StringComparison.OrdinalIgnoreCase) && s.Board.Count > 0)
    {
        // A board is what is on offer where the truck stands. Moved, it is somebody else's town's freight.
        OoStore.Log(c, "board", $"Board of {s.Board.Count} cleared: that was {s.Status.LocationCity}'s freight.");
        s.Board.Clear();
    }
    if (city.Length > 0) s.Status.LocationCity = city;
    if (!string.IsNullOrWhiteSpace(u.LocationState)) s.Status.LocationState = u.LocationState.Trim().ToUpperInvariant();
    if (u.Day is > 0 && GameClock.FromDayTime(u.Day.Value, u.Time) is { } at) s.Status.GameTime = GameClock.Format(at);
    Ledger.Advance(c);
    if (u.Odometer is { } odo && odo >= 0) s.Status.AtsOdometer = odo;
    if (u.FuelPct is { } fuel) s.Status.FuelPct = Math.Clamp(fuel, 0, 100);
    s.Status.UpdatedUtc = DateTime.UtcNow.ToString("o");
    if (!DiscoveryService.IsDiscovered(s, s.Status.LocationCity, s.Status.LocationState))
    {
        s.Discovered.Add(new DiscoveredCity
        {
            City = s.Status.LocationCity, State = s.Status.LocationState, DiscoveredGameTime = s.Status.GameTime, Notified = true,
        });
        foreach (var b in BrokerBook.Refresh(c))
            OoStore.Log(c, "broker", $"{b.Name} ({b.Tier.ToLowerInvariant()}, {b.City}, {b.State}) is in your directory now.");
    }
    HomeLife.Advance(c, wasTime, wasHome);
    Lanes.MaybeRing(c);
    Lanes.RingAtHome(c);
    return Snapshot(c);
})));

app.MapPost("/api/hos", (HosRequest h) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    ApplyClocks(c, h, "Reported");
    Lanes.MaybeRing(c);
    return Snapshot(c);
})));

/// Clocks off a GDC Companion recap screenshot. Applied straight away, as in the company-driver app; what could not
/// be read keeps its old value, and the clocks before come back so a misread is one step from undone.
app.MapPost("/api/hos/extract", async (ExtractRequest req, CancellationToken ct) =>
{
    RequireStarted(store.Career);
    var result = await AiService.ExtractHosAsync(store.Career.Game, req.Images ?? new(), ct);
    if (!result.Ok) return Results.Ok(new { ok = false, error = result.Error, snapshot = Snapshot(store.Career) });
    var said = store.Mutate(c =>
    {
        var h = c.Game.Hos;
        var was = new { drive = h.DriveRemaining, shift = h.ShiftRemaining, brk = h.BreakRemaining, cycle = h.CycleRemaining };
        if (result.DriveRemaining is { } d) h.DriveRemaining = d;
        if (result.ShiftRemaining is { } sh) h.ShiftRemaining = sh;
        if (result.BreakRemaining is { } b) h.BreakRemaining = b;
        if (result.CycleRemaining is { } cy) h.CycleRemaining = cy;
        h.Source = "GDC Companion";
        h.AsOfGameTime = c.Game.Status.GameTime;
        h.Confirmed = true;
        h.UpdatedUtc = DateTime.UtcNow.ToString("o");
        OoStore.Log(c, "run", $"Clocks read from a GDC recap: drive {Hhmm.Of(h.DriveRemaining)}, shift {Hhmm.Of(h.ShiftRemaining)}, " +
                              $"break {Hhmm.Of(h.BreakRemaining)}, cycle {Hhmm.Of(h.CycleRemaining)}.");
        return was;
    });
    return Results.Ok(new { ok = true, previous = said, snapshot = Snapshot(store.Career) });
});

app.MapPost("/api/settings", (SettingsRequest r) => Results.Ok(store.Mutate(c =>
{
    if (r.CostPerMile is { } cpm)
    {
        if (cpm <= 0 || cpm > 20) throw new InvalidOperationException("A cost per mile between $0 and $20.");
        c.Settings.CostPerMile = Math.Round(cpm, 3);
    }
    if (r.LongDistanceLimits is { Count: 7 } limits)
    {
        if (limits.Any(l => l is <= 0)) throw new InvalidOperationException("Each Long Distance limit is a distance above zero, or blank for anywhere.");
        c.Settings.LongDistanceLimits = limits;
    }
    if (r.ResetLongDistance == true) c.Settings.LongDistanceLimits = OoSettings.DefaultLongDistanceMiles();
    // The key is written and never read back out: the snapshot only says whether there is one.
    if (r.AnthropicApiKey != null)
    {
        c.Game.Settings.AnthropicApiKey = r.AnthropicApiKey.Trim();
        c.Game.Settings.AiEnabled = c.Game.Settings.AnthropicApiKey.Length > 0;
    }
    if (!string.IsNullOrWhiteSpace(r.PhoneModel)) c.Settings.PhoneModel = r.PhoneModel.Trim();
    if (!string.IsNullOrWhiteSpace(r.AnthropicModel)) c.Game.Settings.AnthropicModel = r.AnthropicModel.Trim();
    if (r.Skills is { } k && c.Started)
    {
        c.Profile.Skills.LongDistance = Math.Clamp(k.LongDistance, 0, OoSkills.Max);
        c.Profile.Skills.HighValue = Math.Clamp(k.HighValue, 0, OoSkills.Max);
        c.Profile.Skills.Fragile = Math.Clamp(k.Fragile, 0, OoSkills.Max);
        c.Profile.Skills.JustInTime = Math.Clamp(k.JustInTime, 0, OoSkills.Max);
        c.Profile.Skills.Adr = (k.Adr ?? new()).Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim()).Distinct().ToList();
        c.Game.Driver.Skills.LongDistance = Math.Min(c.Profile.Skills.LongDistance, DriverSkills.Max);
        c.Game.Driver.Skills.HighValue = Math.Min(c.Profile.Skills.HighValue, DriverSkills.Max);
        c.Game.Driver.Skills.Fragile = Math.Min(c.Profile.Skills.Fragile, DriverSkills.Max);
        c.Game.Driver.Skills.JustInTime = Math.Min(c.Profile.Skills.JustInTime, DriverSkills.Max);
    }
    return Snapshot(c);
})));

// ---------------------------------------------------------------- the board

/// Reads freight-board screenshots into rows to check. Does not touch the board: the player confirms the numbers.
app.MapPost("/api/board/extract", async (ExtractRequest req, CancellationToken ct) =>
{
    RequireStarted(store.Career);
    var result = await AiService.ExtractLoadsAsync(store.Career.Game, req.Images ?? new(), ct);
    return Results.Ok(new
    {
        ok = result.Ok,
        error = result.Error,
        model = result.Model,
        notes = result.Notes,
        loads = result.Loads.Select(l => ToBoardLoad(store.Career.Game, l)).ToList(),
    });
});

app.MapPost("/api/board/add-many", (List<BoardLoad> loads) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    var refused = new List<object>();
    var added = 0;
    foreach (var l in loads ?? new())
    {
        try { BoardIntake.Add(c.Game, l); Lanes.Learn(c, new[] { l }); added++; }
        catch (InvalidOperationException ex) { refused.Add(new { cargo = l.Cargo, destCity = l.DestCity, reason = ex.Message }); }
    }
    if (added > 0) OoStore.Log(c, "board", $"{added} load(s) onto the board at {c.Game.Status.LocationCity}, {c.Game.Status.LocationState}.");
    return new { added, refused, snapshot = Snapshot(c) };
})));

app.MapDelete("/api/board/{id}", (string id) => Results.Ok(store.Mutate(c =>
{
    c.Game.Board.RemoveAll(b => b.Id == id);
    return Snapshot(c);
})));

app.MapPost("/api/board/clear", () => Results.Ok(store.Mutate(c =>
{
    c.Game.Board.Clear();
    return Snapshot(c);
})));

// ---------------------------------------------------------------- brokers and the phone

/// Ringing a broker. They read the board and make the offer; see the plan, "Spot loads off the board".
app.MapPost("/api/calls", async (CallRequest r, CancellationToken ct) =>
{
    var (callId, reply) = store.Mutate(c =>
    {
        RequireStarted(c);
        // On the road, the call is about the next load, and the broker plans it off the clocks you give them: the same
        // as when a broker rings you. From a break or a rest only, so that is checked first.
        if (Calls.ActiveBooking(c) != null)
        {
            if (Lanes.PullOver(c) is { } wheel) throw new InvalidOperationException(wheel);
            ApplyClocks(c, r.Clocks ?? throw new InvalidOperationException(
                "Tell them your clocks: drive, shift, break and cycle left. That is how far they can plan you."),
                $"Told {c.Brokers.FirstOrDefault(b => b.Id == r.BrokerId)?.Name ?? "a broker"}");
        }
        var (call, rep) = Calls.Start(c, r.BrokerId ?? "");
        return (call.Id, rep);
    });
    await Voice(callId, reply, ct);
    return Results.Ok(new { call = Calls.View(store.Career, store.Career.Calls.First(x => x.Id == callId)), snapshot = Snapshot(store.Career) });
});

/// Saying something on the call: the buttons send a move, typing sends words for the model to read.
app.MapPost("/api/calls/{id}/say", async (string id, SayRequest r, CancellationToken ct) =>
{
    var call = store.Career.Calls.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("No such call.");
    var move = new PlayerMove
    {
        Kind = r.Kind ?? "", Amount = r.Amount, Arguments = r.Arguments ?? new(), Term = r.Term ?? "", Said = r.Text ?? "",
    };
    if (string.IsNullOrWhiteSpace(move.Kind) && !string.IsNullOrWhiteSpace(r.Text))
        move = await PhoneAi.ParseAsync(store.Career, call, r.Text, ct) ?? LocalParse(r.Text);
    var reply = store.Mutate(c => Calls.Respond(c, id, move).Reply);
    await Voice(id, reply, ct);
    return Results.Ok(new { call = Calls.View(store.Career, store.Career.Calls.First(x => x.Id == id)), snapshot = Snapshot(store.Career) });
});

// ---------------------------------------------------------------- delivery and money

app.MapPost("/api/deliver", (DeliverRequest r) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    var invoice = Ledger.Deliver(c, r, out var audit);
    return new { invoice, audit, snapshot = Snapshot(c) };
})));

// ---------------------------------------------------------------- the run

app.MapPost("/api/run/at-shipper", (RunStageRequest r) => Results.Ok(store.Mutate(c =>
{
    var (said, call) = Run.AtShipper(c, r.Day, r.Time);
    return new { said, call, snapshot = Snapshot(c) };
})));

app.MapPost("/api/run/loaded", (RunStageRequest r) => Results.Ok(store.Mutate(c =>
{
    var notes = Run.Loaded(c, r.WeightLbs, r.Odometer, r.Day, r.Time);
    Lanes.MaybeRing(c);
    return new { said = string.Join(" ", notes), snapshot = Snapshot(c) };
})));

app.MapPost("/api/run/event", (RunEventRequest r) => Results.Ok(store.Mutate(c =>
{
    var wasTime = c.Game.Status.GameTime;
    var wasHome = HomeLife.AtHome(c);
    Run.Event(c, r);
    Ledger.Advance(c);
    HomeLife.Advance(c, wasTime, wasHome);
    Lanes.MaybeRing(c);
    return Snapshot(c);
})));

app.MapPost("/api/run/event/{id}", (string id, AmendRequest r) => Results.Ok(store.Mutate(c =>
{
    var said = Run.Amend(c, id, r);
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/run/window", (WindowFixRequest r) => Results.Ok(store.Mutate(c =>
{
    var said = Run.CorrectWindow(c, r.DeadlineHours, r.Note);
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/run/arrived", (RunStageRequest r) => Results.Ok(store.Mutate(c =>
{
    var (said, call) = Run.Arrived(c, r.Day, r.Time);
    Lanes.MaybeRing(c);
    return new { said, call, snapshot = Snapshot(c) };
})));

app.MapPost("/api/calls/{id}/answer", async (string id, AnswerRequest? r, CancellationToken ct) =>
{
    var reply = store.Mutate(c =>
    {
        var ringing = c.Calls.FirstOrDefault(x => x.Id == id && x.Status == "Ringing") ?? throw new InvalidOperationException("Nobody is calling.");
        // A broker ringing about the next load wants to know how much time you have: the lane is planned off it.
        if (ringing.Inbound)
            ApplyClocks(c, r?.Clocks ?? throw new InvalidOperationException(
                "Tell them your clocks: drive, shift, break and cycle left. That is how far they can plan you."),
                $"Told {c.Brokers.FirstOrDefault(b => b.Id == ringing.BrokerId)?.Name ?? "a broker"}");
        var call = Calls.Answer(c, id);
        if (Lanes.Refit(c, call) is { } moved) call.Turns.Add(new CallTurn { Who = "broker", Text = moved });
        return new BrokerReply("offer", call.Turns.Last().Text);
    });
    await Voice(id, reply, ct);
    return Results.Ok(new { call = Calls.View(store.Career, store.Career.Calls.First(x => x.Id == id)), snapshot = Snapshot(store.Career) });
});

app.MapPost("/api/lane/take", (TakeLaneRequest r) => Results.Ok(store.Mutate(c =>
{
    var booking = Lanes.Take(c, r.LoadId ?? "");
    return new { booking, snapshot = Snapshot(c) };
})));

app.MapPost("/api/lane/cancel", (HandBackRequest r) => Results.Ok(store.Mutate(c =>
{
    var said = Lanes.Cancel(c, r.Why ?? "");
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/lane/nothing-fits", () => Results.Ok(store.Mutate(c =>
{
    var said = Lanes.NothingFits(c);
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/trailer", (TrailerRequest r) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    Onboarding.OwnTrailer(c, r.Type, r.GameId, r.Year ?? 0);
    return Snapshot(c);
})));

app.MapPost("/api/trailer/power-only", () => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    Onboarding.PowerOnly(c);
    return Snapshot(c);
})));

app.MapPost("/api/booking/handback", (HandBackRequest r) => Results.Ok(store.Mutate(c =>
{
    Ledger.HandBack(c, r.Why ?? "", r.GameLost == true);
    return Snapshot(c);
})));

/// Company names, for a renaming mod (Real Companies and the like): found and read out of the mod file, as the
/// company-driver app does for dedicated accounts, or typed. See Companies.
app.MapGet("/api/mod/scan", () => Results.Ok(new
{
    candidates = ModCompanyNames.Scan(),
    current = store.Career.Game.Settings.CompanyNameModPath,
    known = store.Career.Game.Settings.ModCompanyNames.Count,
}));

app.MapPost("/api/mod/read", (ModReadRequest r) => Results.Ok(store.Mutate<object>(c =>
{
    var reading = ModCompanyNames.Read(r.Path ?? "");
    if (!reading.Ok) return new { reading.Ok, message = reading.Error, snapshot = Snapshot(c) };
    c.Game.Settings.ModCompanyNames = reading.Names;
    c.Game.Settings.CompanyNameModPath = r.Path ?? "";
    c.Game.Settings.RenamesCompanies = "yes";
    Companies.Apply(c);
    var said = $"Read {reading.Names.Count} company name(s) out of your mod. The companies go by what your game calls them now.";
    OoStore.Log(c, "broker", said);
    return new { reading.Ok, message = said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/companies", (CompanyNamesRequest r) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    Companies.SetTyped(c, r.Names);
    return Snapshot(c);
})));

app.MapPost("/api/home/family", (FamilyRequest r) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    HomeLife.SetFamily(c, new Family
    {
        Partner = r.Partner,
        PartnerName = r.PartnerName ?? "",
        Kids = (r.Kids ?? new()).Select(k => new Kid { Name = k.Name ?? "", Kind = k.Kind ?? "Daughter" }).ToList(),
    });
    return Snapshot(c);
})));

app.MapPost("/api/home/promise", (PromiseRequest r) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    HomeLife.SetPromise(c, r.EveryDays, r.HomeDays);
    return Snapshot(c);
})));

app.MapPost("/api/bank", (BankRequest r) => Results.Ok(store.Mutate(c =>
{
    RequireStarted(c);
    Ledger.ReportGameBank(c, r.Balance);
    return Snapshot(c);
})));

app.MapPost("/api/invoices/{id}/{action}", (string id, string action) => Results.Ok(store.Mutate(c =>
{
    var said = action switch
    {
        "factor" => Receivables.Factor(c, id),
        "chase" => Receivables.Chase(c, id),
        "writeoff" => Receivables.WriteOff(c, id),
        "argue" => Receivables.Argue(c, id),
        _ => throw new InvalidOperationException("Factor, chase, write off or argue."),
    };
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/transfers/{id}/done", (string id) => Results.Ok(store.Mutate(c =>
{
    Ledger.MarkDone(c, id);
    return Snapshot(c);
})));

// ---------------------------------------------------------------- tests only

/// Shaping a broker for a test: credit and personality are rolled per career, and a test of slow payers needs a slow
/// payer. Only there when the test runner sets TSO_TEST=1.
if (Environment.GetEnvironmentVariable("TSO_TEST") == "1")
    app.MapPost("/api/test/broker", (TestBrokerRequest r) => Results.Ok(store.Mutate(c =>
    {
        var b = c.Brokers.First(x => x.Id == r.Id);
        if (!string.IsNullOrWhiteSpace(r.Credit)) b.Credit = r.Credit;
        if (!string.IsNullOrWhiteSpace(r.Personality)) b.Personality = r.Personality;
        if (r.DaysToPay is > 0) b.DaysToPay = r.DaysToPay.Value;
        return Snapshot(c);
    })));
if (Environment.GetEnvironmentVariable("TSO_TEST") == "1")
    app.MapPost("/api/test/home", (TestHomeRequest r) => Results.Ok(store.Mutate(c =>
    {
        c.HomeLife.Score = r.Score;
        c.HomeLife.BottomUntilGameTime = "";
        c.HomeLife.Call = null;
        return Snapshot(c);
    })));
// What the boards have taught, for a test to read. Only that: the career file also holds the API key.
if (Environment.GetEnvironmentVariable("TSO_TEST") == "1")
    app.MapGet("/api/test/career", () => Results.Ok(new { paySeen = store.Career.PaySeen }));

// ---------------------------------------------------------------- run

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = $"http://127.0.0.1:{port}";
    Console.WriteLine();
    Console.WriteLine($"  TruckSim Owner-Operator {OoBuild.Version}");
    Console.WriteLine($"  Open {url} in your browser. Close this window to stop.");
    Console.WriteLine($"  Data file: {Path.Combine(store.DataDirectory, "career.json")}");
    Console.WriteLine();
    if (openBrowser)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { /* the URL is printed */ }
    }
});

app.Run();

// ---------------------------------------------------------------- helpers

static void RequireStarted(OoCareer c)
{
    if (!c.Started) throw new InvalidOperationException("Fill in the first screen first: home, the clock, your skills and the odometer.");
}

/// The broker's last line, said in their voice when there is a key. Out of the lock: it waits on the network.
async Task Voice(string callId, BrokerReply reply, CancellationToken ct)
{
    var c = store.Career;
    var call = c.Calls.First(x => x.Id == callId);
    var broker = c.Brokers.First(x => x.Id == call.BrokerId);
    var said = await PhoneAi.VoiceAsync(c, broker, call, reply, ct);
    if (said != reply.Line)
        store.Mutate(cc =>
        {
            var turn = cc.Calls.First(x => x.Id == callId).Turns.LastOrDefault(t => t.Who == "broker");
            if (turn != null && turn.Text == reply.Line) turn.Text = said;
        });
}

/// Typed words without a key: a figure is a counter, "take it" is yes, "pass" is no. The buttons do the rest.
static PlayerMove LocalParse(string text)
{
    var t = text.ToLowerInvariant();
    var m = System.Text.RegularExpressions.Regex.Match(t, @"\$?\s?(\d[\d,]*(\.\d+)?)\s*(k\b)?");
    var move = new PlayerMove { Said = text };
    if (m.Success && decimal.TryParse(m.Groups[1].Value.Replace(",", ""), System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture, out var a))
    {
        move.Kind = "counter";
        move.Amount = m.Groups[3].Success ? a * 1000 : a;
    }
    else if (t.Contains("take it") || t.Contains("deal") || t.Contains("book it") || t.Contains("accept")) move.Kind = "accept";
    else if (t.Contains("pass") || t.Contains("no thanks") || t.Contains("bye")) move.Kind = "decline";
    else if (t.Contains("better") || t.Contains("anything else")) move.Kind = "better";
    else if (PhoneAi.TermIn(t) is { } term) { move.Kind = "terms"; move.Term = term; }
    else move.Kind = "unclear";
    // A price with terms ("350 and quick pay") is a counter that carries them.
    if (move.Kind == "counter" && PhoneAi.TermIn(t) is { } with) move.Term = with;
    if (t.Contains("dead")) move.Arguments.Add("deadMarket");
    if (t.Contains("tight")) move.Arguments.Add("tight");
    if (t.Contains("empty") || t.Contains("deadhead")) move.Arguments.Add("deadhead");
    if (t.Contains("record") || t.Contains("on time")) move.Arguments.Add("record");
    if (t.Contains("walk") || t.Contains("someone else") || t.Contains("another broker")) move.Arguments.Add("walk");
    return move;
}

static object Snapshot(OoCareer c)
{
    var s = c.Game;
    var truck = DispatchEngine.AssignedTruck(s);
    var laneBoard = Lanes.Board(c);
    return new
    {
        version = OoBuild.Version,
        started = c.Started,
        game = s.Game,
        profile = c.Profile,
        settings = new
        {
            costPerMile = c.Settings.CostPerMile,
            longDistanceLimits = c.Settings.LongDistanceLimits,
            longDistanceLimit = c.Started ? LoadDesk.LongDistanceLimit(c) : null,
            hasApiKey = !string.IsNullOrWhiteSpace(s.Settings.AnthropicApiKey),
            anthropicModel = s.Settings.AnthropicModel,
            distanceUnit = Units.DistUnit,
        },
        status = new
        {
            city = s.Status.LocationCity,
            state = s.Status.LocationState,
            gameTime = s.Status.GameTime,
            day = GameClock.DayOf(s.Status.GameTime),
            pretty = GameClock.Pretty(s.Status.GameTime),
            // The month: ATS shows none, but the app's calendar has one (Day 1 is 1 January), and the holidays and the
            // seasons run on it.
            monthDay = GameClock.TryParse(s.Status.GameTime) is { } md
                ? HomeLife.Calendar(c, md).ToString("MMM d", System.Globalization.CultureInfo.InvariantCulture) : "",
            calendarOffset = HomeLife.CalendarOffset(c),
            month = c.Started ? Seasons.Month(c) : 1,
            region = Carriers.AtsRegionOf(s.Status.LocationState),
            odometer = s.Status.AtsOdometer,
            fuelPct = s.Status.FuelPct,
        },
        hos = new
        {
            drive = s.Hos.DriveRemaining,
            shift = s.Hos.ShiftRemaining,
            brk = s.Hos.BreakRemaining,
            cycle = s.Hos.CycleRemaining,
            recap = s.Hos.Recap,
            asOf = s.Hos.AsOfGameTime,
            confirmed = s.Hos.Confirmed,
            projected = s.Hos.Projected,
            carriedForwardFrom = s.Hos.CarriedForwardFrom,
            source = s.Hos.Source,
        },
        rules = new
        {
            breakLength = s.Settings.Hos.BreakLength,
            offDutyReset = s.Settings.Hos.OffDutyReset,
            appointmentGraceHours = s.Settings.AppointmentGraceHours,
            // The free time at a dock before detention runs, and the shorter free time on a wait for the door: what the
            // close-out bills on, so the preview on the Active Load tab can show the same figure before it is pressed.
            detentionFreeHours = s.Driver.Pay.DetentionFreeHours,
            queueFreeHours = s.Driver.Pay.QueueFreeHours,
        },
        truck = truck == null ? null : new { truck.Unit, truck.Year, truck.Make, truck.Model, truck.AvgMpg },
        trailer = DispatchEngine.AssignedTrailer(s) is { } tr ? new
        {
            tr.Unit, tr.Type, tr.Ref, tr.Year,
            powerOnly = DropHook.Is(tr.Type),
            market = DropHook.Is(tr.Type) ? "Freight Market" : "Cargo Market",
        } : null,
        ownedTrailer = s.Trailers.FirstOrDefault(x => x.Unit == "T1") is { } own ? new { own.Type, own.Ref, own.Year } : null,
        ownableTrailers = Specialties.OwnableTrailers,
        board = c.Started ? LoadDesk.Evaluate(c) : new List<LoadView>(),
        directory = c.Brokers.Where(b => b.Known).Select(b => BrokerBook.View(c, b)).ToList(),
        record = c.Started ? BrokerBook.Record(c) : null,
        call = Calls.Open(c) is { } open ? Calls.View(c, open) : null,
        lastCall = c.Calls.LastOrDefault() is { } last ? Calls.View(c, last) : null,
        booking = Calls.ActiveBooking(c),
        lane = Lanes.Booked(c) is { } bl ? Lanes.View(c, bl) : null,
        cantMake = c.CantMakeLoadIds,
        companies = c.Started ? Companies.View(c) : null,
        companyModPath = s.Settings.CompanyNameModPath,
        seasons = c.Started ? Seasons.Notable(c) : new List<object>(),
        seasonTable = c.Started ? Seasons.Table(c) : null,
        homePull = c.Started ? HomeLife.Pull(c) : null,
        homeRoute = c.Started && HomeLife.Route(c) is { } hr ? new
        {
            miles = hr.TotalMiles, arrival = hr.ProjectedArrivalGameTime, hr.RestsRequired, hr.BreaksRequired, hr.Timeline,
        } : null,
        laneFits = laneBoard.Fits,
        laneClose = laneBoard.Close,
        laneWhy = laneBoard.Why,
        payPerMile = Lanes.PayPerMile(c),
        // The run as Core keeps it, whole: the Active Load tab reads it the way the company-driver app's does.
        trip = Run.Trip(c, Calls.ActiveBooking(c)),
        tripViews = Run.Trip(c, Calls.ActiveBooking(c)) is { } t ? new
        {
            fromHere = Run.FromHere(c) is { } fh ? new
            {
                fh.Verdict, fh.SlackHours, fh.ProjectedArrivalGameTime, fh.ProjectedDockStartGameTime, fh.DueGameTime,
                fh.RestsRequired, fh.BreaksRequired, fh.Blockers, fh.Warnings, fh.Timeline,
            } : null,
            receiverParking = Facilities.ParkingFor(s, t),
            receiverSiteHours = FacilityProfile.SiteHoursFor(s, t),
            receiverIsSite = FacilityProfile.IsSiteTrip(t),
        } : null,
        bookings = c.Bookings.AsEnumerable().Reverse().Take(20),
        aiPhone = PhoneAi.Available(c),
        invoices = c.Invoices.AsEnumerable().Reverse().Take(30),
        transfers = c.Transfers.Where(t => t.Status == "Pending").Concat(c.Transfers.Where(t => t.Status == "Done").Reverse().Take(15)),
        notYoursInGameBank = Ledger.NotYoursInGameBank(c),
        gameBank = Ledger.GameBankView(c),
        holding = Ledger.HoldingView(c),
        owedToYou = c.Invoices.Where(i => i.Status is "Open" or "Overdue" or "Collections").Sum(i => i.Amount),
        home = c.Started ? HomeLife.View(c) : null,
        phoneModel = c.Settings.PhoneModel,
        events = s.Events.Take(30),
    };
}

/// The clocks, as the driver read them off the game: hours left on each, the recap, as of the game clock now.
static void ApplyClocks(OoCareer c, HosRequest h, string source)
{
    var s = c.Game;
    s.Hos.DriveRemaining = Math.Max(0, h.DriveRemaining);
    s.Hos.ShiftRemaining = Math.Max(0, h.ShiftRemaining);
    s.Hos.BreakRemaining = Math.Max(0, h.BreakRemaining);
    s.Hos.CycleRemaining = Math.Max(0, h.CycleRemaining);
    if (h.Recap != null) s.Hos.Recap = h.Recap.Where(x => x.Hours > 0 && x.InDays > 0).ToList();
    s.Hos.AsOfGameTime = s.Status.GameTime;
    s.Hos.Source = source;
    s.Hos.Confirmed = true;
    s.Hos.Projected = false;
    s.Hos.CarriedForwardFrom = "";
    s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
}

/// A row the screenshot reader returned, as a listing the board can take.
static BoardLoad ToBoardLoad(AppState s, ExtractedLoad x) => new()
{
    Id = Guid.NewGuid().ToString("N")[..8],
    Cargo = x.Cargo,
    OriginCity = string.IsNullOrWhiteSpace(x.OriginCity) ? s.Status.LocationCity : x.OriginCity,
    OriginState = string.IsNullOrWhiteSpace(x.OriginState) ? s.Status.LocationState : x.OriginState,
    DestCity = x.DestCity,
    DestState = x.DestState,
    LoadedMiles = x.LoadedMiles,
    GameRevenue = x.GameRevenue,
    DeadlineHours = x.DeadlineHours,
    AppointmentOpensHours = x.AppointmentOpensHours,
    WindowText = x.DeliverByText,
    WeightLbs = x.WeightLbs,
    ExpiresInHours = x.ExpiresInHours,
    TrailerType = x.TrailerType,
    Shipper = x.Shipper,
    Receiver = x.Receiver,
    IsUrgent = x.IsUrgent,
    IsFragile = x.IsFragile,
    IsHazmat = x.IsHazmat,
    HazmatClass = x.HazmatClass,
    Notes = "Imported from screenshot",
};

static Dictionary<string, string> LoadEmbeddedUi()
{
    var asm = Assembly.GetExecutingAssembly();
    var map = new Dictionary<string, string>();
    foreach (var name in new[] { "ui/index.html", "ui/app.js", "ui/styles.css" })
    {
        using var stream = asm.GetManifestResourceStream(name)
                           ?? throw new InvalidOperationException($"Embedded UI file missing: {name}");
        using var reader = new StreamReader(stream);
        map[name] = reader.ReadToEnd();
    }
    return map;
}

static int FindFreePort(int preferred)
{
    for (var p = preferred; p < preferred + 50; p++)
    {
        try
        {
            var l = new TcpListener(IPAddress.Loopback, p);
            l.Start();
            l.Stop();
            return p;
        }
        catch (SocketException) { }
    }
    return preferred;
}

record ResetRequest(string? Confirm);
record StatusRequest(string? LocationCity, string? LocationState, int? Day, string? Time, double? Odometer, double? FuelPct);
record HosRequest(double DriveRemaining, double ShiftRemaining, double BreakRemaining, double CycleRemaining, List<RecapDay>? Recap = null);
record AnswerRequest(HosRequest? Clocks);
record SettingsRequest(decimal? CostPerMile, List<double?>? LongDistanceLimits, bool? ResetLongDistance,
                       string? AnthropicApiKey, string? AnthropicModel, SkillsRequest? Skills, string? PhoneModel = null);
record SkillsRequest(int LongDistance, int HighValue, int Fragile, int JustInTime, List<string>? Adr);
record ExtractRequest(List<ScreenshotImage>? Images);
record ModReadRequest(string? Path);
record CompanyNamesRequest(Dictionary<string, string>? Names);
record CallRequest(string? BrokerId, HosRequest? Clocks = null);
record HandBackRequest(string? Why, bool? GameLost = null);
record TrailerRequest(string? Type, string? GameId, int? Year);
record TakeLaneRequest(string? LoadId);
record TestHomeRequest(double Score);
record TestBrokerRequest(string Id, string? Credit, string? Personality, int? DaysToPay = null);
record BankRequest(decimal Balance);
record PromiseRequest(int EveryDays, int HomeDays);
record SayRequest(string? Text, string? Kind, decimal? Amount, List<string>? Arguments, string? Term);
