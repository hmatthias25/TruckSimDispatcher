using System.Text.Json;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Messages;
using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

public class AiReply
{
    public bool Ok { get; set; }
    public string Text { get; set; } = "";
    public string Error { get; set; } = "";
    public string Model { get; set; } = "";
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
}

public class ScreenshotImage
{
    /// <summary>image/png or image/jpeg</summary>
    public string MediaType { get; set; } = "image/png";
    /// <summary>Base64 payload with no data: prefix and no newlines.</summary>
    public string DataBase64 { get; set; } = "";
}

/// <summary>One row read off an ATS freight-board screenshot, pending driver confirmation.</summary>
public class ExtractedLoad
{
    public string Cargo { get; set; } = "";
    public string OriginCity { get; set; } = "";
    public string OriginState { get; set; } = "";
    public string DestCity { get; set; } = "";
    public string DestState { get; set; } = "";
    public double LoadedMiles { get; set; }
    public decimal GameRevenue { get; set; }
    public double DeadlineHours { get; set; }
    public double WeightLbs { get; set; }
    /// <summary>ATS HazMat class off the listing, as a bare digit. Empty when nothing is placarded.</summary>
    public string HazmatClass { get; set; } = "";
    /// <summary>
    /// The delivery time exactly as the listing showed it, when it showed an absolute time rather
    /// than a remaining duration. The app converts this against the real game clock, because it has
    /// one and the model does not.
    /// </summary>
    public string DeliverByText { get; set; } = "";
    /// <summary>Set by the app, not the model: this window does not match the run. Shown for confirming.</summary>
    public string WindowWarning { get; set; } = "";
    public string TrailerType { get; set; } = "";
    public string Shipper { get; set; } = "";
    public string Receiver { get; set; } = "";
    public bool IsUrgent { get; set; }
    public bool IsFragile { get; set; }
    public bool IsHazmat { get; set; }
    /// <summary>high | medium | low — how sure the reader is about this row.</summary>
    public string Confidence { get; set; } = "medium";
    /// <summary>Field names the reader could not make out. These come back as 0 / empty.</summary>
    public List<string> Unreadable { get; set; } = new();
}

public class ExtractionResult
{
    public bool Ok { get; set; }
    public string Error { get; set; } = "";
    public string Model { get; set; } = "";
    public string Notes { get; set; } = "";
    public List<ExtractedLoad> Loads { get; set; } = new();
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
}

/// <summary>
/// The clocks read off a GDC Companion screenshot, before the driver has confirmed them.
///
/// Every clock is nullable and every one arrives as text the reader copied verbatim. Nothing here is
/// a number the model worked out: it reads "05:34" off a screen and this app turns it into hours,
/// because the app knows what a clock is and the model does not know what day the career is on.
/// </summary>
public class HosReading
{
    public bool Ok { get; set; }
    public string Error { get; set; } = "";
    public string Model { get; set; } = "";
    public string Notes { get; set; } = "";

    /// <summary>Hours remaining, parsed. Null means it could not be read — never 0, which is a reading.</summary>
    public double? DriveRemaining { get; set; }
    public double? ShiftRemaining { get; set; }
    public double? BreakRemaining { get; set; }
    public double? CycleRemaining { get; set; }

    /// <summary>Which part of the screen each clock came from, so the driver can check it.</summary>
    public string ClocksFrom { get; set; } = "";

    /// <summary>The day the screenshot calls today, in its own numbering.</summary>
    public int? TodayDay { get; set; }

    /// <summary>
    /// The recap batches to use — worked out from the rolling 8-day on-duty totals where those are
    /// legible, because then the app has computed them rather than trusted somebody else's table.
    /// </summary>
    public List<RecapDay> Recap { get; set; } = new();

    /// <summary>Where <see cref="Recap"/> came from, in words, for the driver.</summary>
    public string RecapSource { get; set; } = "";

    /// <summary>Worked out here from the day-by-day on-duty totals.</summary>
    public List<RecapDay> Derived { get; set; } = new();

    /// <summary>Copied from the tracker's own projection table, for comparison.</summary>
    public List<RecapDay> Projected { get; set; } = new();

    /// <summary>
    /// On-duty hours the cycle is charging the driver for that no day row accounts for.
    ///
    /// Cycle used is <c>limit - remaining</c>, and it should equal the sum of the rolling window. When it
    /// does not, hours are being counted against the driver with <b>no boundary to come back at</b> — and
    /// that is precisely the arithmetic a recap-versus-restart decision turns on.
    /// </summary>
    public double? UnaccountedHours { get; set; }

    /// <summary>Where the derivation and the tracker's own projection disagree.</summary>
    public List<string> Disagreements { get; set; } = new();

    /// <summary>What the rows said before conversion, so the driver can audit the arithmetic.</summary>
    public List<string> RecapShown { get; set; } = new();

    public List<string> Unreadable { get; set; } = new();
    public string Confidence { get; set; } = "";
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }

    /// <summary>True once the clocks have been written to the career file.</summary>
    public bool Applied { get; set; }

    /// <summary>What was written, in words, for the driver to read after the fact.</summary>
    public List<string> Saved { get; set; } = new();

    /// <summary>Clocks left as they were because the read could not make them out.</summary>
    public List<string> Kept { get; set; } = new();
}

/// <summary>Raw shape of the model's reply. Strings throughout, on purpose.</summary>
public class HosPayload
{
    public string DriveText { get; set; } = "";
    public string ShiftText { get; set; } = "";
    public string BreakText { get; set; } = "";
    public string CycleText { get; set; } = "";
    public string ClocksFrom { get; set; } = "";
    public string TodayDayText { get; set; } = "";
    public List<HosRecapRow> Recap { get; set; } = new();
    public List<HosDayRow> DailyTotals { get; set; } = new();
    public List<string> Unreadable { get; set; } = new();
    public string Notes { get; set; } = "";
    public string Confidence { get; set; } = "";
}

public class HosRecapRow
{
    public string DayText { get; set; } = "";
    public string HoursText { get; set; } = "";
}

/// <summary>One row of the rolling on-duty table: a day, and what was worked on it.</summary>
public class HosDayRow
{
    public string DayText { get; set; } = "";
    public string OnDutyText { get; set; } = "";
}

/// <summary>
/// Optional: lets the app write the dispatch message itself instead of you pasting the packet
/// into a chat. Entirely opt-in — with no API key configured nothing here ever runs and the app
/// makes no network calls at all.
/// </summary>
public static class AiService
{
    private const string SystemPrompt = """
        You are the operations department of a fictional American Truck Simulator trucking company:
        owner, operations manager, dispatcher, safety manager and accounting, all in one voice. The
        user is one of your company drivers.

        Communicate like a real carrier's dispatch office. Be decisive and brief. Lead with the
        decision, then a short reason, then exactly what you need reported back. A dispatch call is
        a few sentences and a short list, not an essay. Use a table only for clocks, settlements,
        trip audits or fleet records.

        Standing company policy, which you must not violate:

        - You decide the assignment. Never ask the driver which load they would prefer.
        - Confirm feasibility BEFORE authorizing a load, never after they hook. Once the trailer is
          loaded the company is committed to the freight barring a genuine emergency.
        - Never plan a load that consumes every remaining minute of hours of service. Respect the
          stated safety buffer.
        - The driver's HOS display is authoritative for their clocks. Never confuse the break clock
          with available driving time. A normal overnight rest does not restore the 70-hour cycle.
        - If required information is missing, ask for it instead of authorizing the load.
        - You may reject the entire board if nothing on it makes operational sense.
        - Distinguish driver-caused, dispatcher-caused, unavoidable, mechanical and game-limitation
          delays. If you booked a load too tight, own it as the company; never blame the driver for
          a dispatch error.
        - Company freight revenue belongs to the company. Driver wages settle separately.
        - Where ATS lacks a real trucking mechanic, say so in one sentence and apply the roleplay
          rule already established in the packet rather than inventing a new one.

        The dispatch packet the user sends is the authoritative system of record. Never invent
        numbers that contradict it — trip numbers, balances, clocks, damage and history all come
        from the packet. If a value you need is absent, ask for it.
        """;

    public static bool Configured(AppSettings s) =>
        s.AiEnabled && !string.IsNullOrWhiteSpace(s.AnthropicApiKey);

    public static async Task<AiReply> AskAsync(AppState state, string userMessage, CancellationToken ct = default)
    {
        var cfg = state.Settings;
        if (!Configured(cfg))
            return new AiReply { Ok = false, Error = "No API key configured. The app works fully offline — copy the Dispatch Packet into a chat with Claude instead, or add a key in Settings." };

        var model = string.IsNullOrWhiteSpace(cfg.AnthropicModel) ? "claude-opus-5" : cfg.AnthropicModel.Trim();

        try
        {
            var client = new AnthropicClient { ApiKey = cfg.AnthropicApiKey.Trim() };

            var response = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 8000,
                Thinking = new ThinkingConfigAdaptive(),
                OutputConfig = new OutputConfig { Effort = Effort.High },
                System = new List<TextBlockParam>
                {
                    new() { Text = SystemPrompt, CacheControl = new CacheControlEphemeral() }
                },
                Messages = [new() { Role = Role.User, Content = userMessage }]
            }, cancellationToken: ct);

            // Safety classifiers can decline a request outright — check before reading content.
            if (response.StopReason == "refusal")
            {
                var why = response.StopDetails is { } sd
                    ? $" (category: {sd.Category})"
                    : "";
                return new AiReply
                {
                    Ok = false,
                    Model = model,
                    Error = $"The model declined this request{why}. Nothing about normal dispatch should trigger that — " +
                            "check the packet for anything unexpected, or just use the offline Dispatch Packet flow."
                };
            }

            var text = string.Join("\n\n", response.Content
                .Select(b => b.Value)
                .OfType<TextBlock>()
                .Select(t => t.Text)
                .Where(t => !string.IsNullOrWhiteSpace(t)));

            if (string.IsNullOrWhiteSpace(text))
                return new AiReply { Ok = false, Model = model, Error = $"Empty response (stop reason: {response.StopReason})." };

            return new AiReply
            {
                Ok = true,
                Model = model,
                Text = text,
                InputTokens = response.Usage?.InputTokens ?? 0,
                OutputTokens = response.Usage?.OutputTokens ?? 0
            };
        }
        catch (Exception ex)
        {
            return new AiReply { Ok = false, Model = model, Error = Describe(ex) };
        }
    }

    // ---------------------------------------------------------------- screenshot import

    private const string ExtractPrompt = """
        You are reading screenshots of the freight/cargo market board from the game American Truck
        Simulator. Extract every job row you can see, across all the images provided.

        For each row read these, exactly as shown on screen:
        - cargo: the freight name (e.g. "Frozen Foods", "Steel Coils", "Machinery").
        - originCity / originState: the pickup city and its two-letter US state code.
        - destCity / destState: the delivery city and its two-letter US state code.
        - shipper / receiver: the company names at each end, if shown. Empty string if not.
        - loadedMiles: the trip distance in miles, as a plain number.
        - gameRevenue: the payout in dollars, as a plain number with no currency symbol,
          commas or decimals.
        - The delivery window. ATS usually shows this as a TIME RANGE, for example
          "6:15 AM - 12:55 PM" — the receiver opens at the first time and the load is due by the
          second. Report what you see verbatim and DO NOT convert it to a number of hours:
          * Put the window text, exactly as shown, in deliverByText — the whole range, both times,
            with any AM/PM and any day or date shown alongside it. Leave deadlineHours at 0.
          * Only use deadlineHours when the row shows a REMAINING TIME instead of a range or a clock
            time ("8h 30m" is 8.5, "2 days 4h" is 52).
          * If you cannot read the window at all, leave BOTH empty and add "deadlineHours" to
            "unreadable". An empty window is handled properly. A guessed one is not: it becomes the
            appointment the driver is judged against.
          The app knows the exact game clock and will do the subtraction. You do not, so any figure
          you work out yourself is a guess — which is how a nineteen-mile run once acquired an
          eight-hour appointment.
        - weightLbs: cargo weight in pounds. If shown in tons, convert (1 ton = 2000 lb).
        - hazmatClass: the ATS HazMat class the job needs, as a bare digit: "1" explosives,
          "2" gases, "3" flammable liquids, "4" flammable solids, "6" toxic, "8" corrosive. A
          subclass like 2.1 or 2.3 collapses to its parent ("2"). Leave empty when the listing
          shows no hazard placard or class.
        - trailerType: the trailer needed, using one of exactly these words where it is clear:
          Dry Van, Reefer, Flatbed, Step Deck, Tanker, Lowboy, Car Hauler, Livestock, Log, Hopper,
          Dump. Use an empty string if you cannot tell.
        - isUrgent / isFragile / isHazmat: true only if the row visibly carries that marker.

        Rules that matter:
        - Report only what is actually legible. NEVER guess or infer a number you cannot read.
        - The delivery window especially. It becomes the appointment the load is judged on, so a
          plausible-looking invention is worse than an empty field.
        - If a numeric field is not readable, put 0 and add that field's name to "unreadable".
        - If a text field is not readable, use an empty string and add it to "unreadable".
        - Set "confidence" per row: "high" when every field was crisp, "medium" when you had to
          work at it, "low" when you are unsure of the row at all.
        - Do not merge or deduplicate rows. If the same lane appears twice, return it twice.
        - Ignore UI chrome, the player's own truck info, buttons, and any row that is cut off at
          the edge of the image so badly you cannot read its cargo and payout.
        - Use "notes" to mention anything the operator should know: rows you skipped, a column you
          could not find, units that looked like kilometres rather than miles, and so on.
        """;

    private static readonly Dictionary<string, JsonElement> ExtractSchema = BuildExtractSchema();

    private static Dictionary<string, JsonElement> BuildExtractSchema()
    {
        // Numbers are always present (0 means "could not read", named in `unreadable`), which keeps
        // the schema free of nullable unions that structured outputs handles inconsistently.
        const string json = """
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["loads", "notes"],
          "properties": {
            "notes": { "type": "string" },
            "loads": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["cargo","originCity","originState","destCity","destState","shipper",
                             "receiver","loadedMiles","gameRevenue","deadlineHours","weightLbs","hazmatClass","deliverByText",
                             "trailerType","isUrgent","isFragile","isHazmat","confidence","unreadable"],
                "properties": {
                  "cargo":        { "type": "string" },
                  "originCity":   { "type": "string" },
                  "originState":  { "type": "string" },
                  "destCity":     { "type": "string" },
                  "destState":    { "type": "string" },
                  "shipper":      { "type": "string" },
                  "receiver":     { "type": "string" },
                  "loadedMiles":  { "type": "number" },
                  "gameRevenue":  { "type": "number" },
                  "deadlineHours":{ "type": "number" },
                  "weightLbs":    { "type": "number" },
                  "hazmatClass":  { "type": "string" },
                  "deliverByText":{ "type": "string" },
                  "trailerType":  { "type": "string" },
                  "isUrgent":     { "type": "boolean" },
                  "isFragile":    { "type": "boolean" },
                  "isHazmat":     { "type": "boolean" },
                  "confidence":   { "type": "string", "enum": ["high","medium","low"] },
                  "unreadable":   { "type": "array", "items": { "type": "string" } }
                }
              }
            }
          }
        }
        """;
        return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
    }

    private const string HosPrompt = """
        You are reading a screenshot of the Recap page of the GDC Companion app — an hours-of-service
        tracker a player runs alongside American Truck Simulator. Read the driver's clocks off it.

        REPORT TEXT, NOT ARITHMETIC. Every field below is a string, and you must copy what is printed
        on the screen character for character. Do not convert hours and minutes into decimals, do not
        add anything up, do not work out how many days away something is. The app does all of that,
        because the app knows the rules and the career's own calendar and you do not.

        The four clocks — REMAINING, not used:
        - driveText, shiftText, breakText, cycleText: the hours LEFT on each clock.
        - This page shows both used and remaining, and they are easy to confuse. A summary panel gives
          "Drive Used 02:55", "Shift Used 08:02", "Cycle Used 34:42" — those are USED and are the wrong
          numbers. A status line or tooltip gives remaining, usually compressed like
          "D 05:58 | S 05:58 | B 08:00 | C 35:18", and a header may give "left 35:18". Prefer whichever
          shows REMAINING.
        - Never subtract used from a limit to get remaining. If only used is legible, leave the clock
          empty and name it in "unreadable" — say in notes which used figures you could see.
        - Drive-left is often smaller than the drive limit minus drive-used, because the 14-hour shift
          is the binding clock. That is correct. Copy what is shown and do not fix it.
        - clocksFrom: say in a few words where you read them, e.g. "status tooltip D/S/B/C row" or
          "header for cycle, tooltip for the rest". This is how the driver checks you read the right panel.

        Today:
        - todayDayText: the day the screen marks as today, exactly as printed — "Day 13", or the day
          number on the row labelled Today in the rolling totals table. This is what lets the app work
          out how far off each recap boundary is, so it matters.

        The rolling on-duty table — READ THIS, it is the important one:
        - dailyTotals: one entry per row of the rolling 8-day on-duty totals table.
        - dayText: the day as printed — "Today • Day 13", "-4d • Day 9". Copy it whole; the app pulls
          the number out.
        - onDutyText: that row's ON DUTY total, exactly as printed — "02:30", "09:54", "00:00".
        - Use the ON DUTY column, not the Driving column, when both are shown. On duty is what the
          cycle counts.
        - Include every row, including ones reading 00:00 and ones whose status column says something
          like "STATUS REQUIRED". A row the tracker has no data for is itself worth knowing about.

        Projected recap returns:
        - One entry per row of the recap/projection table, in the order shown.
        - dayText: the boundary day exactly as printed — "Day 17", "Day 17 00:00".
        - hoursText: the hours coming back on that boundary, exactly as printed — "05:34", "00:25".
        - Include rows showing zero hours back. Do not skip them and do not reorder them; the app
          filters and converts.
        - Ignore the resulting-cycle column. The app recomputes that from its own rules.
        - This table may be missing rows or be out of step with the daily totals. Copy it as it is
          anyway; the app compares the two and tells the driver when they disagree.

        Rules that matter:
        - Report only what is legible. NEVER guess a clock. A wrong cycle figure is worse than a blank
          one, because dispatch will plan freight on it and refuse freight over it.
        - Anything you cannot read: leave the field an empty string and add its name to "unreadable"
          ("driveText", "cycleText", "todayDayText", and so on).
        - If the screenshot is not a GDC Companion recap page at all, leave every field empty, add
          "notScreen" to "unreadable", and say what you are actually looking at in notes.
        - confidence: "high" when every figure was crisp, "medium" when you had to work at it, "low"
          when you are unsure you read the right panel.
        - Use notes for anything the driver should check: a panel you could not find, used-only
          figures, a cut-off table, rows that looked inconsistent.
        """;

    private static readonly Dictionary<string, JsonElement> HosSchema = BuildHosSchema();

    private static Dictionary<string, JsonElement> BuildHosSchema()
    {
        // Strings throughout. The model transcribes; this app parses. That division is the whole point:
        // a model asked for "hours as a decimal" will happily turn 05:34 into 5.34.
        const string json = """
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["driveText","shiftText","breakText","cycleText","clocksFrom","todayDayText",
                       "recap","dailyTotals","unreadable","notes","confidence"],
          "properties": {
            "driveText":    { "type": "string" },
            "shiftText":    { "type": "string" },
            "breakText":    { "type": "string" },
            "cycleText":    { "type": "string" },
            "clocksFrom":   { "type": "string" },
            "todayDayText": { "type": "string" },
            "recap": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["dayText","hoursText"],
                "properties": {
                  "dayText":   { "type": "string" },
                  "hoursText": { "type": "string" }
                }
              }
            },
            "dailyTotals": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["dayText","onDutyText"],
                "properties": {
                  "dayText":    { "type": "string" },
                  "onDutyText": { "type": "string" }
                }
              }
            },
            "unreadable": { "type": "array", "items": { "type": "string" } },
            "notes":      { "type": "string" },
            "confidence": { "type": "string", "enum": ["high","medium","low"] }
          }
        }
        """;
        return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
    }

    /// <summary>
    /// Reads a GDC Companion recap screenshot into the four clocks and the recap projection.
    ///
    /// One screenshot, one request: this is one page of one app, not a board that scrolls. Nothing is
    /// applied — the caller stages it for the driver to confirm, because these four numbers gate every
    /// dispatch decision the app makes.
    /// </summary>
    public static async Task<HosReading> ExtractHosAsync(
        AppState state, List<ScreenshotImage> images, CancellationToken ct = default)
    {
        var cfg = state.Settings;
        if (!Configured(cfg))
            return new HosReading { Ok = false, Error = "Reading your clocks from a screenshot needs an Anthropic API key — add one in Settings → In-app dispatcher. You can always type them in by hand." };
        if (images == null || images.Count == 0)
            return new HosReading { Ok = false, Error = "No screenshot was supplied." };

        var model = string.IsNullOrWhiteSpace(cfg.AnthropicModel) ? "claude-opus-5" : cfg.AnthropicModel.Trim();

        // More than a couple of images means the driver has staged a board by mistake, or is pasting
        // the same page twice. Read the first few and say so rather than burning tokens on all of them.
        var batch = images.Take(3).ToList();

        try
        {
            var client = new AnthropicClient { ApiKey = cfg.AnthropicApiKey.Trim() };
            var content = new List<ContentBlockParam>();

            for (var i = 0; i < batch.Count; i++)
            {
                content.Add(new TextBlockParam { Text = $"Screenshot {i + 1} of {batch.Count}:" });
                content.Add(new ImageBlockParam
                {
                    Source = new Base64ImageSource
                    {
                        Data = batch[i].DataBase64,
                        MediaType = batch[i].MediaType == "image/jpeg" ? MediaType.ImageJpeg : MediaType.ImagePng
                    }
                });
            }
            content.Add(new TextBlockParam
            {
                Text = "Read the clocks and the recap projection from the screenshot(s) above into the " +
                       "required schema. Copy every figure verbatim as text."
            });

            var response = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 8000,
                Thinking = new ThinkingConfigAdaptive(),
                OutputConfig = new OutputConfig
                {
                    Effort = Effort.High,
                    Format = new JsonOutputFormat { Schema = HosSchema }
                },
                System = new List<TextBlockParam>
                {
                    new() { Text = HosPrompt, CacheControl = new CacheControlEphemeral() }
                },
                Messages = [new() { Role = Role.User, Content = content }]
            }, cancellationToken: ct);

            if (response.StopReason == "refusal")
                return new HosReading { Ok = false, Model = model, Error = "The model declined to read that image." };
            if (response.StopReason == "max_tokens")
                return new HosReading { Ok = false, Model = model, Error = "The reply ran out of room. Try a single, tighter capture of just the recap page." };

            var text = string.Join("", response.Content.Select(b => b.Value).OfType<TextBlock>().Select(x => x.Text));
            if (string.IsNullOrWhiteSpace(text))
                return new HosReading { Ok = false, Model = model, Error = $"Empty response (stop reason: {response.StopReason})." };

            var raw = JsonSerializer.Deserialize<HosPayload>(text,
                          new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                      ?? new HosPayload();

            var reading = Interpret(state, raw);
            reading.Model = model;
            reading.InputTokens = response.Usage?.InputTokens ?? 0;
            reading.OutputTokens = response.Usage?.OutputTokens ?? 0;

            if (images.Count > batch.Count)
                reading.Notes = $"Read the first {batch.Count} of {images.Count} staged images — this page is one screen. " + reading.Notes;

            return reading;
        }
        catch (Exception ex)
        {
            return new HosReading { Ok = false, Model = model, Error = Describe(ex) };
        }
    }

    /// <summary>
    /// Turns what the reader transcribed into clocks and recap batches.
    ///
    /// Separated from the API call so it can be exercised directly, the same way <c>/api/geo/distance</c>
    /// exposes the distance arithmetic. All the judgement lives here — what parses, what stays blank,
    /// which boundaries are still ahead — and none of it needs a model to test.
    /// </summary>
    public static HosReading Interpret(AppState state, HosPayload raw)
    {
        raw ??= new HosPayload();
        var reading = new HosReading
        {
            Ok = true,
            ClocksFrom = raw.ClocksFrom ?? "",
            Notes = raw.Notes ?? "",
            Confidence = raw.Confidence ?? "",
            Unreadable = raw.Unreadable ?? new List<string>(),
            DriveRemaining = Hhmm.Read(raw.DriveText),
            ShiftRemaining = Hhmm.Read(raw.ShiftText),
            BreakRemaining = Hhmm.Read(raw.BreakText),
            CycleRemaining = Hhmm.Read(raw.CycleText),
            TodayDay = Hhmm.ReadDay(raw.TodayDayText)
        };

        // A clock the reader transcribed but that will not parse is worse than a missing one, because
        // the field would sit there looking answered. Name it instead.
        void Check(double? parsed, string? shown, string field)
        {
            if (parsed == null && !string.IsNullOrWhiteSpace(shown)
                && !reading.Unreadable.Contains(field, StringComparer.OrdinalIgnoreCase))
                reading.Unreadable.Add(field);
        }
        Check(reading.DriveRemaining, raw.DriveText, "driveText");
        Check(reading.ShiftRemaining, raw.ShiftText, "shiftText");
        Check(reading.BreakRemaining, raw.BreakText, "breakText");
        Check(reading.CycleRemaining, raw.CycleText, "cycleText");

        ConvertRecap(state, raw, reading);
        DeriveRecap(state, raw, reading);
        return reading;
    }

    /// <summary>
    /// Works the recap projection out from the day-by-day on-duty totals, rather than believing a
    /// projection table.
    ///
    /// Recap is mechanical: the hours worked on a day drop out of the rolling window when that day does,
    /// which is <c>CycleDays</c> later. Given the daily totals and today's day number, every boundary and
    /// every batch follows — no tracker needed. Doing it here means the app can also check the tracker's
    /// own table, and check the totals against the cycle, and say so when they do not add up.
    /// </summary>
    private static void DeriveRecap(AppState state, HosPayload raw, HosReading reading)
    {
        reading.Projected = reading.Recap.Select(r => new RecapDay { InDays = r.InDays, Hours = r.Hours }).ToList();
        reading.RecapSource = reading.Projected.Count > 0 ? "the tracker's own projection table" : "";

        var rows = raw.DailyTotals ?? new List<HosDayRow>();
        var today = reading.TodayDay;
        if (rows.Count == 0 || today == null) return;

        var window = Math.Max(1, state.Settings.Hos.CycleDays);
        double known = 0;
        var seen = new HashSet<int>();

        foreach (var row in rows)
        {
            var day = Hhmm.ReadDay(row.DayText);
            var onDuty = Hhmm.Read(row.OnDutyText);
            if (day == null || onDuty == null || !seen.Add(day.Value)) continue;

            known += onDuty.Value;
            var inDays = day.Value + window - today.Value;
            if (inDays <= 0 || onDuty.Value <= 0) continue;   // already back, or nothing to come back
            reading.Derived.Add(new RecapDay { InDays = inDays, Hours = onDuty.Value });
        }

        reading.Derived = reading.Derived.OrderBy(x => x.InDays).ToList();
        if (reading.Derived.Count == 0 && seen.Count == 0) return;

        // The cycle is charging for hours; the rows say which days they were worked. If those two do not
        // agree, the difference is hours with no boundary to return at — and the driver is about to make
        // a recap-versus-restart call on a projection that is short by exactly that much.
        if (reading.CycleRemaining is { } left)
        {
            var used = state.Settings.Hos.CycleLimit - left;
            var gap = used - known;
            if (gap > 0.05)
            {
                reading.UnaccountedHours = gap;
                reading.Disagreements.Add(
                    $"Your cycle is charging {Hhmm.Of(used)} but the day rows only account for " +
                    $"{Hhmm.Of(known)} of it. {Hhmm.Of(gap)} is counted against you with no day to come " +
                    "back on — most likely worked on a day the tracker has no status for. Expect up to " +
                    $"{Hhmm.Of(gap)} more than this projection shows, and treat a 'take the 34' call " +
                    "on these numbers with suspicion.");
            }
            else if (gap < -0.05)
            {
                reading.Disagreements.Add(
                    $"The day rows add up to {Hhmm.Of(known)}, which is more than the {Hhmm.Of(used)} your " +
                    "cycle says you have used. One of the two is wrong; the clocks are the safer bet.");
            }
        }

        // Now the tracker's own table, against ours.
        foreach (var mine in reading.Derived)
        {
            var theirs = reading.Projected.FirstOrDefault(p => p.InDays == mine.InDays);
            if (theirs == null)
                reading.Disagreements.Add(
                    $"The day rows say {Hhmm.Of(mine.Hours)} comes back in {mine.InDays} day(s), but the " +
                    "projection table has no boundary there.");
            else if (Math.Abs(theirs.Hours - mine.Hours) > 0.02)
                reading.Disagreements.Add(
                    $"In {mine.InDays} day(s) the day rows say {Hhmm.Of(mine.Hours)} and the projection " +
                    $"says {Hhmm.Of(theirs.Hours)}. Going with the day rows.");
        }
        foreach (var theirs in reading.Projected)
            if (reading.Derived.All(m => m.InDays != theirs.InDays))
                reading.Disagreements.Add(
                    $"The projection expects {Hhmm.Of(theirs.Hours)} back in {theirs.InDays} day(s), but no " +
                    "day row accounts for it. Left out.");

        // Ours wins: we can show the working.
        reading.Recap = reading.Derived.Select(r => new RecapDay { InDays = r.InDays, Hours = r.Hours }).ToList();
        reading.RecapSource = $"worked out here from the {seen.Count} day row(s), " +
                              $"each day's hours returning {window} days later";
    }

    /// <summary>
    /// Turns "hours back on Day 17" into "hours back in 4 days".
    ///
    /// The subtraction happens inside the screenshot's own numbering — boundary day minus the day the
    /// screen calls today. That way it does not matter whether GDC Companion and this app agree on what
    /// day the career is on, which they need not: one counts from when the player started tracking, the
    /// other from when the career was created. Only the gap between two of its own rows is portable.
    /// </summary>
    private static void ConvertRecap(AppState state, HosPayload raw, HosReading reading)
    {
        var rows = raw.Recap ?? new List<HosRecapRow>();
        if (rows.Count == 0) return;

        var today = reading.TodayDay;
        if (today == null)
        {
            // Without a "today" there is no frame to subtract in. Say so rather than guessing one:
            // assuming the app's own day number would silently shift every batch to the wrong midnight.
            reading.RecapShown = rows
                .Where(r => Hhmm.Read(r.HoursText) is > 0)
                .Select(r => $"{r.DayText?.Trim()} — {r.HoursText?.Trim()}")
                .ToList();
            if (reading.RecapShown.Count > 0)
                reading.Notes = ("I could not read which day the screen calls today, so I cannot work out how far " +
                                 "off these boundaries are. Enter them by hand, or crop the capture to include the " +
                                 "day header. " + reading.Notes).Trim();
            return;
        }

        foreach (var r in rows)
        {
            var day = Hhmm.ReadDay(r.DayText);
            var hours = Hhmm.Read(r.HoursText);
            if (day == null || hours == null) continue;

            reading.RecapShown.Add($"Day {day} — {Hhmm.Of(hours.Value)}");
            var inDays = day.Value - today.Value;
            if (inDays <= 0 || hours.Value <= 0) continue;      // past boundaries and empty rows carry nothing
            reading.Recap.Add(new RecapDay { InDays = inDays, Hours = hours.Value });
        }

        reading.Recap = reading.Recap.OrderBy(x => x.InDays).ToList();
    }

    /// <summary>
    /// Reads freight-board screenshots into candidate loads. The caller must present these for
    /// confirmation — a misread payout or mileage would corrupt every downstream feasibility and
    /// rate decision, so nothing here goes onto the board unreviewed.
    /// </summary>
    /// <summary>
    /// Screenshots per request. A full ATS board is about ten rows, and ten rows of structured JSON is
    /// a lot of output — seven boards in one call exhausted the token budget and failed the whole read.
    /// Reading in small batches and merging keeps every request well inside its budget, so the driver
    /// can paste as many boards as they like without having to know any of this.
    /// </summary>
    private const int BatchSize = 3;

    /// <summary>Generous ceiling. Not a limit anyone will meet in practice — the board is ten rows.</summary>
    private const int MaxScreenshots = 24;

    public static async Task<ExtractionResult> ExtractLoadsAsync(
        AppState state, List<ScreenshotImage> images, CancellationToken ct = default)
    {
        var cfg = state.Settings;
        if (!Configured(cfg))
            return new ExtractionResult { Ok = false, Error = "Screenshot import needs an Anthropic API key — add one in Settings → In-app dispatcher. Everything else in the app works without it." };
        if (images == null || images.Count == 0)
            return new ExtractionResult { Ok = false, Error = "No screenshots were supplied." };
        if (images.Count > MaxScreenshots)
            return new ExtractionResult { Ok = false, Error = $"That is {images.Count} screenshots. Send at most {MaxScreenshots} at a time." };

        var model = string.IsNullOrWhiteSpace(cfg.AnthropicModel) ? "claude-opus-5" : cfg.AnthropicModel.Trim();

        var batches = images
            .Select((img, i) => (img, i))
            .GroupBy(x => x.i / BatchSize)
            .Select(g => g.Select(x => x.img).ToList())
            .ToList();

        var merged = new ExtractionResult { Ok = true, Model = model };
        var notes = new List<string>();
        var failures = new List<string>();
        var offset = 0;

        foreach (var batch in batches)
        {
            var part = await ExtractBatchAsync(state, model, batch, offset, images.Count, ct);
            offset += batch.Count;

            if (!part.Ok)
            {
                // One bad batch must not lose the rows the others read successfully.
                failures.Add(part.Error);
                continue;
            }

            merged.Loads.AddRange(part.Loads);
            if (!string.IsNullOrWhiteSpace(part.Notes)) notes.Add(part.Notes);
            merged.InputTokens += part.InputTokens;
            merged.OutputTokens += part.OutputTokens;
        }

        // The same job can appear on two screenshots when boards overlap or are re-pasted.
        merged.Loads = Deduplicate(merged.Loads);

        if (merged.Loads.Count == 0)
            return new ExtractionResult
            {
                Ok = false,
                Model = model,
                Error = failures.Count > 0
                    ? string.Join(" ", failures.Distinct())
                    : "Nothing readable in those screenshots."
            };

        if (failures.Count > 0)
            notes.Add($"{failures.Count} of {batches.Count} batches could not be read: {string.Join(" ", failures.Distinct())}");
        if (batches.Count > 1)
            notes.Insert(0, $"Read in {batches.Count} batches of up to {BatchSize} screenshots.");

        merged.Notes = string.Join(" ", notes);
        return merged;
    }

    /// <summary>One request's worth of screenshots.</summary>
    private static async Task<ExtractionResult> ExtractBatchAsync(AppState state, string model,
        List<ScreenshotImage> batch, int offset, int total, CancellationToken ct)
    {
        try
        {
            var cfg = state.Settings;
            var client = new AnthropicClient { ApiKey = cfg.AnthropicApiKey.Trim() };

            var content = new List<ContentBlockParam>();

            // The reader has to be told what time it is. Without a clock it cannot turn a delivery
            // time shown on a listing into hours remaining — and being asked for a number it has no
            // way to derive is what made it invent eight-hour windows for twenty-mile runs.
            var now = GameClock.TryParse(state.Status.GameTime);
            content.Add(new TextBlockParam
            {
                Text = now is { } clock
                    ? $"Current in-game time: {GameClock.PrettyDay(clock)} (day {GameClock.DayOf(clock)}, {clock:HH\\:mm}). " +
                      "Use it only to recognise an absolute delivery time as being in the future — report what you read, " +
                      "do not do the subtraction yourself."
                    : "The current in-game time is not on file. Report any delivery window exactly as shown and do not convert it."
            });
            for (var i = 0; i < batch.Count; i++)
            {
                content.Add(new TextBlockParam { Text = $"Screenshot {offset + i + 1} of {total}:" });
                content.Add(new ImageBlockParam
                {
                    Source = new Base64ImageSource
                    {
                        Data = batch[i].DataBase64,
                        MediaType = batch[i].MediaType == "image/jpeg"
                            ? MediaType.ImageJpeg
                            : MediaType.ImagePng
                    }
                });
            }
            content.Add(new TextBlockParam
            {
                Text = "Extract every legible job row from the screenshot(s) above into the required schema."
            });

            var response = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 16000,
                Thinking = new ThinkingConfigAdaptive(),
                OutputConfig = new OutputConfig
                {
                    Effort = Effort.High,
                    Format = new JsonOutputFormat { Schema = ExtractSchema }
                },
                System = new List<TextBlockParam>
                {
                    new() { Text = ExtractPrompt, CacheControl = new CacheControlEphemeral() }
                },
                Messages = [new() { Role = Role.User, Content = content }]
            }, cancellationToken: ct);

            if (response.StopReason == "refusal")
                return new ExtractionResult { Ok = false, Model = model, Error = "The model declined to read these images." };
            if (response.StopReason == "max_tokens")
                return new ExtractionResult { Ok = false, Model = model, Error = "A batch ran out of output room even at three screenshots — try pasting fewer, larger-text captures." };

            var text = string.Join("", response.Content
                .Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
            if (string.IsNullOrWhiteSpace(text))
                return new ExtractionResult { Ok = false, Model = model, Error = $"Empty response (stop reason: {response.StopReason})." };

            var parsed = JsonSerializer.Deserialize<ExtractionPayload>(text,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            var loads = parsed?.Loads ?? new List<ExtractedLoad>();
            foreach (var l in loads)
            {
                // The reader reports what it saw; the subtraction is ours, because we have the clock.
                if (l.DeadlineHours <= 0 && !string.IsNullOrWhiteSpace(l.DeliverByText)
                    && DeliveryWindow.HoursUntil(state, l.DeliverByText) is { } derived)
                {
                    l.DeadlineHours = derived;
                    l.Unreadable.RemoveAll(u => u.Equals("deadlineHours", StringComparison.OrdinalIgnoreCase));
                }

                // A window out of proportion to the run is a question, not an error — ATS is generous
                // on short jobs. Flagging it puts it in front of the driver before it becomes the
                // appointment they are judged against.
                if (DeliveryWindow.Implausible(state, l.DeadlineHours, l.LoadedMiles, l.TrailerType) is { } why)
                    l.WindowWarning = why;

                l.OriginState = (l.OriginState ?? "").Trim().ToUpperInvariant();
                l.DestState = (l.DestState ?? "").Trim().ToUpperInvariant();
                l.Unreadable ??= new List<string>();
            }

            return new ExtractionResult
            {
                Ok = true,
                Model = model,
                Loads = loads,
                Notes = parsed?.Notes ?? "",
                InputTokens = response.Usage?.InputTokens ?? 0,
                OutputTokens = response.Usage?.OutputTokens ?? 0
            };
        }
        catch (Exception ex)
        {
            return new ExtractionResult { Ok = false, Model = model, Error = Describe(ex) };
        }
    }

    /// <summary>
    /// Drops rows that are the same job read twice — boards overlap between screenshots, and a driver
    /// re-pasting one they already had should not end up with the load on the board twice.
    /// </summary>
    private static List<ExtractedLoad> Deduplicate(List<ExtractedLoad> loads)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var kept = new List<ExtractedLoad>();
        foreach (var l in loads)
        {
            var key = string.Join("|",
                (l.Cargo ?? "").Trim(), (l.DestCity ?? "").Trim(), (l.DestState ?? "").Trim(),
                Math.Round(l.LoadedMiles), Math.Round(l.GameRevenue));
            if (seen.Add(key)) kept.Add(l);
        }
        return kept;
    }

    private class ExtractionPayload
    {
        public List<ExtractedLoad> Loads { get; set; } = new();
        public string Notes { get; set; } = "";
    }

    private static string Describe(Exception ex) => ex switch
    {
        AnthropicUnauthorizedException => "API key rejected (401). Check the key in Settings — it must be an API key from console.anthropic.com, not your Claude subscription login.",
        AnthropicNotFoundException => "Model not found (404). Check the model ID in Settings.",
        AnthropicRateLimitException => "Rate limited (429). Wait a moment and try again.",
        AnthropicForbiddenException => "Permission denied (403). The key may lack access to this model, or the account needs credit.",
        Anthropic5xxException => "Anthropic API is having trouble (5xx). Try again shortly.",
        AnthropicIOException => "Could not reach the API. Check this machine's internet connection — or just use the offline Dispatch Packet flow.",
        AnthropicApiException e => $"API error: {e.Message}",
        _ => $"{ex.GetType().Name}: {ex.Message}"
    };
}
