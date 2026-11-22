using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using TruckSimCoach;
using TruckSimDispatcher.Services;

// ---------------------------------------------------------------- startup

var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
var store = new CoachStore(exeDir);

// A port of its own, beside the Dispatcher (5173) and the Owner-Operator (5273).
var port = 5373;
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
        if (Environment.GetEnvironmentVariable("TSC_TEST") == "1" && ex is not InvalidOperationException) Console.Error.WriteLine(ex);
        await ctx.Response.WriteAsJsonAsync(new { error = why });
    }
});

app.MapGet("/", () => Results.Content(ui["ui/index.html"], "text/html; charset=utf-8"));
app.MapGet("/app.js", () => Results.Content(ui["ui/app.js"], "text/javascript; charset=utf-8"));
app.MapGet("/styles.css", () => Results.Content(ui["ui/styles.css"], "text/css; charset=utf-8"));
app.MapGet("/favicon.ico", () => Results.NoContent());

// ---------------------------------------------------------------- career

app.MapGet("/api/bootstrap", () => Results.Ok(Snapshot(store.Career)));

app.MapPost("/api/start", (StartRequest r) => Results.Ok(store.Mutate(c =>
{
    if (c.Started) throw new InvalidOperationException("A career is running. Reset it in Settings to start again.");
    if (string.IsNullOrWhiteSpace(r.DriverName)) throw new InvalidOperationException("Your name, please.");
    var at = GameClock.FromDayTime(Math.Max(1, r.Day ?? 1), r.Time ?? "08:00") ?? GameClock.FromDay(1, 8, 0);
    c.Profile = new CoachProfile
    {
        DriverName = r.DriverName.Trim(), CoachLevel = Math.Max(0, r.CoachLevel ?? 0),
        Skills = Clamp(r.Skills ?? new CoachSkills()), StartedGameTime = GameClock.Format(at),
    };
    if (r.Roster is "Real" or "Invented") c.Settings.Roster = r.Roster;
    c.GameTime = GameClock.Format(at);
    var (city, cc) = Companies.Split(r.HomeDepot ?? "");
    c.City = city;
    c.Cc = cc;
    Hours.Start(c, at);
    var said = Companies.Hire(c, r.CompanyId ?? "", r.HomeDepot ?? "", r.Force == true);
    c.Started = true;
    Depots.Arrive(c, city, cc);
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/reset", (ConfirmRequest r) =>
{
    if (r.Confirm != "RESET") throw new InvalidOperationException("Type RESET to start again. The old career is kept in backups.");
    store.Reset();
    return Results.Ok(Snapshot(store.Career));
});

app.MapPost("/api/settings", (SettingsRequest r) => Results.Ok(store.Mutate(c =>
{
    if (r.Roster is "Real" or "Invented") c.Settings.Roster = r.Roster;
    if (!string.IsNullOrWhiteSpace(r.AnthropicApiKey)) c.Settings.AnthropicApiKey = r.AnthropicApiKey.Trim();
    if (r.ClearApiKey == true) c.Settings.AnthropicApiKey = "";
    if (!string.IsNullOrWhiteSpace(r.AnthropicModel)) c.Settings.AnthropicModel = r.AnthropicModel.Trim();
    if (r.Breaks is { } breaks) c.Settings.Breaks = breaks;
    if (r.Maintenance is { } mt)
    {
        var m = c.Settings.Maintenance;
        var watch = mt.WatchPct ?? m.WatchPct; var shop = mt.ShopPct ?? m.ShopPct;
        var review = mt.ReviewPct ?? m.ReviewPct; var oos = mt.OutOfServicePct ?? m.OutOfServicePct;
        if (!(watch > 0 && watch < shop && shop <= review && review < oos && oos <= 100))
            throw new InvalidOperationException("The damage lines go up in order: worth a look, then the shop, then the review, then out of service.");
        m.WatchPct = watch; m.ShopPct = shop; m.ReviewPct = review; m.OutOfServicePct = oos;
        if (mt.ServiceIntervalKm is { } km) m.ServiceIntervalKm = Math.Clamp(km, 5000, 200000);
        if (mt.InspectionIntervalDays is { } days) m.InspectionIntervalDays = Math.Clamp(days, 7, 365);
    }
    return Snapshot(c);
})));

/// The game's coach level and skill points, as the player gains them.
app.MapPost("/api/profile", (ProfileRequest r) => Results.Ok(store.Mutate(c =>
{
    if (r.CoachLevel is { } lv) c.Profile.CoachLevel = Math.Max(0, lv);
    if (r.Skills != null) c.Profile.Skills = Clamp(r.Skills);
    return Snapshot(c);
})));

app.MapPost("/api/coach/bought", () => Results.Ok(store.Mutate(c =>
{
    if (!c.Started) throw new InvalidOperationException("Fill in the first screen first.");
    if (!c.Job.CoachBought) Maintenance.NewCoach(c);
    c.Job.CoachBought = true;
    CoachStore.Log(c, "career", $"The {c.Job.CoachModel} is in the garage: fleet number {c.Job.FleetNumber}.");
    return Snapshot(c);
})));

app.MapPost("/api/jobs/apply", (ApplyRequest r) => Results.Ok(store.Mutate(c =>
{
    if (!c.Started) throw new InvalidOperationException("Fill in the first screen first.");
    if (Duties.Current(c) is { Status: "Running" }) throw new InvalidOperationException("Finish the duty you are on first.");
    var said = Companies.Hire(c, r.CompanyId ?? "", r.HomeDepot ?? "");
    var (city, cc) = Companies.Split(r.HomeDepot ?? "");
    if (!Companies.SamePlace(c.City, c.Cc, city, cc))
        said += $" Make your way to {city} to start: report the positioning run on the Today tab.";
    else Depots.Arrive(c, city, cc);
    return new { said, snapshot = Snapshot(c) };
})));

// ---------------------------------------------------------------- the clock and the coach

app.MapPost("/api/clock", (TimeRequest r) => Results.Ok(store.Mutate(c =>
{
    var said = Duties.Clock(c, Duties.Moment(c, r.Day, r.Time));
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/position", (PositionRequest r) => Results.Ok(store.Mutate(c =>
{
    var said = Duties.Position(c, r.City ?? "", r.Cc ?? "", Duties.Moment(c, r.DepartDay, r.DepartTime), Duties.Moment(c, r.ArriveDay, r.ArriveTime),
        r.Damage, r.DamageCause);
    return new { said, snapshot = Snapshot(c) };
})));

/// A shop visit: a repair, the service, the safety inspection, the annual test.
app.MapPost("/api/coach/maintenance", (MaintRequest r) => Results.Ok(store.Mutate(c => new { said = Maintenance.Visit(c, r), snapshot = Snapshot(c) })));

/// The damage read off the game outside a run: a reading put right.
app.MapPost("/api/coach/damage", (DamageRequest r) => Results.Ok(store.Mutate(c =>
{
    if (!c.Started || !c.Job.CoachBought) throw new InvalidOperationException("Buy the coach in the game first.");
    if (Duties.Current(c) is { Status: "Running" }) throw new InvalidOperationException("A duty is running: the damage is read when it closes.");
    var e = Maintenance.Reading(c, r.Damage, r.Cause, 0, "Reading", "Reading");
    var said = new List<string> { $"The coach reads {e.After:0.#}%." };
    if (e.Cause == "Driver") said.AddRange(Grading.EmptyRunDamage(c, e));
    said.Add(Maintenance.Assess(c).Headline);
    return new { said = string.Join(" ", said), snapshot = Snapshot(c) };
})));

// ---------------------------------------------------------------- the board and the library

app.MapPost("/api/board/add", (BoardRequest r) => Results.Ok(store.Mutate(c =>
{
    if (!c.Started) throw new InvalidOperationException("Fill in the first screen first.");
    if (c.Job.Status != "Active") throw new InvalidOperationException("You are not with a company. Join one on the Career tab.");
    var added = Lines.AddToBoard(c, r.Jobs ?? new(), r.Replace == true);
    return new { added = added.Count, snapshot = Snapshot(c) };
})));

app.MapPost("/api/board/read", async (ReadRequest r) =>
{
    var career = store.Career;
    if (career.Job.Status != "Active") throw new InvalidOperationException("You are not with a company. Join one on the Career tab.");
    var result = await CoachReader.ReadAsync(career, r.Images ?? new());
    if (!result.Ok) throw new InvalidOperationException(result.Error);
    return Results.Ok(store.Mutate(c =>
    {
        // Screenshots of one menu: the player said which, so every job read is that kind.
        if (r.Menu is "Contract" or "Tourist") foreach (var j in result.Jobs) j.Menu = r.Menu;
        var added = Lines.AddToBoard(c, result.Jobs, r.Replace == true);
        return new { added = added.Count, notes = result.Notes, snapshot = Snapshot(c) };
    }));
});

app.MapPost("/api/board/clear", () => Results.Ok(store.Mutate(c => { c.Board.Clear(); return Snapshot(c); })));

app.MapGet("/api/routes", () => Results.Ok(new
{
    lines = store.Career.Lines.OrderBy(l => l.From.City).ThenBy(l => l.From.Time).Select(l => Lines.View(store.Career, l)),
}));

app.MapGet("/api/routes/city", (string city, string? cc) => Results.Ok(Lines.CityView(store.Career, city, cc ?? "")));

// ---------------------------------------------------------------- duties

app.MapPost("/api/duty/accept", (OfferRequest r) => Results.Ok(store.Mutate(c =>
{
    var d = Duties.Accept(c, r.OfferId ?? "", r.Between);
    return new { said = $"{d.Number}: {d.Title}. Book on at {GameClock.Pretty(d.BookOn)}.", snapshot = Snapshot(c) };
})));

app.MapPost("/api/duty/depart", (StopRequest r) => Results.Ok(store.Mutate(c =>
{
    var said = Duties.Depart(c, r.Stop, Duties.Moment(c, r.Day, r.Time), r.Boarded);
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/duty/arrive", (StopRequest r) => Results.Ok(store.Mutate(c =>
{
    var handover = r.HandoverDay is > 0 && !string.IsNullOrWhiteSpace(r.HandoverTime) ? Duties.Moment(c, r.HandoverDay, r.HandoverTime) : (DateTime?)null;
    var said = Duties.Arrive(c, r.Stop, Duties.Moment(c, r.Day, r.Time), r.Alighted, r.Pct, r.VeryHappy, r.Happy, r.Unhappy, r.VeryUnhappy, r.BreakMinutes, handover);
    return new { said, snapshot = Snapshot(c) };
})));

app.MapPost("/api/duty/swap", (StopRequest r) => Results.Ok(store.Mutate(c => new { said = Duties.Swap(c, r.Stop), snapshot = Snapshot(c) })));

app.MapPost("/api/duty/close", (CloseRequest r) => Results.Ok(store.Mutate(c =>
{
    var closeout = Duties.Close(c, r);
    return new { closeout, snapshot = Snapshot(c) };
})));

app.MapPost("/api/duty/handback", (HandBackRequest r) => Results.Ok(store.Mutate(c =>
    new { said = Duties.HandBack(c, r.Why, r.Day, r.Time, r.Damage, r.DamageCause), snapshot = Snapshot(c) })));

// ---------------------------------------------------------------- depots and tours

app.MapPost("/api/depots/open", (PlaceRequest r) => Results.Ok(store.Mutate(c => new { said = Depots.Open(c, r.City ?? "", r.Cc ?? ""), snapshot = Snapshot(c) })));
app.MapPost("/api/depots/transfer", (PlaceRequest r) => Results.Ok(store.Mutate(c => new { said = Depots.Transfer(c, r.City ?? "", r.Cc ?? ""), snapshot = Snapshot(c) })));

app.MapPost("/api/tour/start", (TourRequest r) => Results.Ok(store.Mutate(c => new { said = Tours.Start(c, r.Days ?? 6), snapshot = Snapshot(c) })));
app.MapPost("/api/tour/leg", (TimeRequest r) => Results.Ok(store.Mutate(c =>
{
    var d = Duties.TourLeg(c, Duties.Moment(c, r.Day, r.Time));
    return new { said = $"{d.Number}: {d.Title}.", snapshot = Snapshot(c) };
})));

// What a test needs and a player never does: skills and a record set straight in.
if (Environment.GetEnvironmentVariable("TSC_TEST") == "1")
{
    app.MapPost("/api/test/rank", (TestRankRequest r) => Results.Ok(store.Mutate(c =>
    {
        if (r.Rank is { } rank) c.Job.Rank = rank;
        if (r.Probation is { } p) c.Job.OnProbation = p;
        if (r.Level is { } lv) c.Discipline.Level = lv;
        return Snapshot(c);
    })));
    app.MapPost("/api/test/coach", (TestCoachRequest r) => Results.Ok(store.Mutate(c =>
    {
        if (r.Km is { } km) c.Coach.Km = km;
        if (r.InspectionDaysAgo is { } ago) c.Coach.LastInspectionAt = GameClock.Format(GameClock.TryParse(c.GameTime)!.Value.AddDays(-ago));
        return Snapshot(c);
    })));
}

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = $"http://127.0.0.1:{port}";
    Console.WriteLine();
    Console.WriteLine($"  TruckSim Coach Driver {CoachBuild.Version}");
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

static CoachSkills Clamp(CoachSkills s) => new()
{
    LongerDuties = Math.Clamp(s.LongerDuties, 0, CoachSkills.Max),
    DemandingTimetables = Math.Clamp(s.DemandingTimetables, 0, CoachSkills.Max),
    PremiumService = Math.Clamp(s.PremiumService, 0, CoachSkills.Max),
    CushionedJourney = Math.Clamp(s.CushionedJourney, 0, CoachSkills.Max),
    PassengerFavourite = Math.Clamp(s.PassengerFavourite, 0, CoachSkills.Max),
    EcoDriving = Math.Clamp(s.EcoDriving, 0, CoachSkills.Max),
};

static object Snapshot(CoachCareer c)
{
    CoachStore.Activate();
    var co = Companies.Find(c.Job.CompanyId);
    var active = c.Started && c.Job.Status == "Active" && co != null;
    var next = active ? Companies.NextRank(co!, c.Job.Rank) : null;
    var duty = Duties.Current(c);
    return new
    {
        version = CoachBuild.Version,
        started = c.Started,
        profile = c.Profile,
        settings = new { c.Settings.Roster, hasApiKey = c.Settings.AnthropicApiKey.Length > 0, model = c.Settings.AnthropicModel, c.Settings.Breaks },
        gameTime = c.GameTime,
        city = c.City, cc = c.Cc, place = Lines.Place(c.City, c.Cc),
        atHome = c.Started && Depots.IsHome(c, c.City, c.Cc),
        job = co == null ? null : new
        {
            company = new { co.Id, name = co.Name(c), co.Kind, co.Tier, co.About },
            c.Job.Rank, rankName = Companies.RankName(c.Job.Rank), rate = Companies.HourlyRate(co, c.Job.Rank),
            c.Job.OnProbation, c.Job.ProbationEndsGameTime, c.Job.Status, c.Job.HiredGameTime,
            home = Lines.Place(c.Job.HomeCity, c.Job.HomeCc), c.Job.HomeCity, c.Job.HomeCc,
            c.Job.CoachModel, c.Job.FleetNumber, c.Job.CoachBought,
            ladder = Companies.Ladder(co).Select(r => new { rank = r, name = Companies.RankName(r), rate = Companies.HourlyRate(co, r) }),
            nextRank = next is { } n ? new { rank = n, name = Companies.RankName(n), gaps = Companies.PromotionGaps(c, co, n) } : null,
        },
        companies = Companies.All.Select(x => new
        {
            x.Id, name = x.Name(c), x.Kind, x.Tier, x.About, x.Coaches,
            depots = x.DepotList.Select(d => new { key = Companies.Key(d.City, d.Cc), place = Lines.Place(d.City, d.Cc) }),
            whyNot = Companies.WhyNot(c, x),
            ladder = Companies.Ladder(x).Select(r => Companies.RankName(r)),
            rate = Companies.HourlyRate(x, Companies.Ladder(x)[0]),
        }),
        depots = Depots.View(c),
        board = Assign.View(c),
        boardPlace = Lines.Place(c.BoardCity, c.BoardCc),
        duty,
        duties = c.Duties.Where(d => d.Status == "Done").TakeLast(25).Reverse().Select(d => new
        {
            d.Id, d.Number, d.Title, d.Kind, d.Grade, d.FinalSatisfaction, d.PunctualityPct, d.Pay, d.Tips, d.ClosedGameTime,
            d.Crew, d.Complaints, d.EarlyDepartures, d.VeryLateStops, d.DamageAfter, d.DamageIncurred, d.DamageCause,
        }),
        record = Companies.RecordOf(c),
        discipline = new
        {
            c.Discipline.Level, levelName = Grading.LevelName(c.Discipline.Level), c.Discipline.CleanRun, c.Discipline.StrikesSinceStep,
            entries = c.Discipline.Entries.TakeLast(30).Reverse(),
        },
        pay = new
        {
            pending = c.Pay.Pending, pendingTotal = c.Pay.Pending.Sum(l => l.Amount),
            payslips = c.Pay.Payslips.TakeLast(10).Reverse(),
            earned = c.Pay.Payslips.Sum(p => p.Gross),
        },
        hours = c.Started ? Hours.View(c) : null,
        coach = c.Started ? Maintenance.View(c) : null,
        tour = Tours.View(c),
        tourWhyNot = c.Started ? Tours.WhyNot(c) : new List<string>(),
        lineCount = c.Lines.Count,
        lines = c.Lines.OrderBy(l => l.From.City).ThenBy(l => l.From.Time).Select(l => Lines.View(c, l)),
        history = c.History,
        log = c.Log.Take(60),
    };
}

static Dictionary<string, string> LoadEmbeddedUi()
{
    var asm = Assembly.GetExecutingAssembly();
    var map = new Dictionary<string, string>();
    foreach (var name in new[] { "ui/index.html", "ui/app.js", "ui/styles.css" })
    {
        using var stream = asm.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"Embedded UI file missing: {name}");
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

record StartRequest(string? DriverName, int? CoachLevel, CoachSkills? Skills, string? Roster, int? Day, string? Time,
                    string? CompanyId, string? HomeDepot, bool? Force);
record ConfirmRequest(string? Confirm);
record SettingsRequest(string? Roster, string? AnthropicApiKey, bool? ClearApiKey, string? AnthropicModel, bool? Breaks, MaintSettings? Maintenance);
record MaintSettings(double? WatchPct, double? ShopPct, double? ReviewPct, double? OutOfServicePct, double? ServiceIntervalKm, int? InspectionIntervalDays);
record DamageRequest(double? Damage, string? Cause);
record TestCoachRequest(double? Km, double? InspectionDaysAgo);
record ProfileRequest(int? CoachLevel, CoachSkills? Skills);
record ApplyRequest(string? CompanyId, string? HomeDepot);
record TimeRequest(int? Day, string? Time);
record PositionRequest(string? City, string? Cc, int? DepartDay, string? DepartTime, int? ArriveDay, string? ArriveTime, double? Damage, string? DamageCause);
record BoardRequest(List<OfferInput>? Jobs, bool? Replace);
record ReadRequest(List<ScreenshotImage>? Images, bool? Replace, string? Menu);
record OfferRequest(string? OfferId, List<StopInput>? Between);
record StopRequest(int Stop, int? Day, string? Time, int? Boarded, int? Alighted, double? Pct, int? VeryHappy, int? Happy, int? Unhappy, int? VeryUnhappy,
                   int? BreakMinutes, int? HandoverDay, string? HandoverTime);
record HandBackRequest(string? Why, int? Day, string? Time, double? Damage, string? DamageCause);
record PlaceRequest(string? City, string? Cc);
record TourRequest(int? Days);
record TestRankRequest(int? Rank, bool? Probation, int? Level);
