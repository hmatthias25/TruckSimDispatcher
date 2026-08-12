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
        - deadlineHours: hours available to deliver. ATS often shows this as a remaining time or
          a delivery window rather than a number of hours — convert it to whole hours if you can.
        - weightLbs: cargo weight in pounds. If shown in tons, convert (1 ton = 2000 lb).
        - trailerType: the trailer needed, using one of exactly these words where it is clear:
          Dry Van, Reefer, Flatbed, Step Deck, Tanker, Lowboy, Car Hauler, Livestock, Log, Hopper,
          Dump. Use an empty string if you cannot tell.
        - isUrgent / isFragile / isHazmat: true only if the row visibly carries that marker.

        Rules that matter:
        - Report only what is actually legible. NEVER guess or infer a number you cannot read.
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
                             "receiver","loadedMiles","gameRevenue","deadlineHours","weightLbs",
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

    /// <summary>
    /// Reads freight-board screenshots into candidate loads. The caller must present these for
    /// confirmation — a misread payout or mileage would corrupt every downstream feasibility and
    /// rate decision, so nothing here goes onto the board unreviewed.
    /// </summary>
    public static async Task<ExtractionResult> ExtractLoadsAsync(
        AppState state, List<ScreenshotImage> images, CancellationToken ct = default)
    {
        var cfg = state.Settings;
        if (!Configured(cfg))
            return new ExtractionResult { Ok = false, Error = "Screenshot import needs an Anthropic API key — add one in Settings → In-app dispatcher. Everything else in the app works without it." };
        if (images == null || images.Count == 0)
            return new ExtractionResult { Ok = false, Error = "No screenshots were supplied." };
        if (images.Count > 8)
            return new ExtractionResult { Ok = false, Error = "Send at most 8 screenshots at a time." };

        var model = string.IsNullOrWhiteSpace(cfg.AnthropicModel) ? "claude-opus-5" : cfg.AnthropicModel.Trim();

        try
        {
            var client = new AnthropicClient { ApiKey = cfg.AnthropicApiKey.Trim() };

            var content = new List<ContentBlockParam>();
            for (var i = 0; i < images.Count; i++)
            {
                content.Add(new TextBlockParam { Text = $"Screenshot {i + 1} of {images.Count}:" });
                content.Add(new ImageBlockParam
                {
                    Source = new Base64ImageSource
                    {
                        Data = images[i].DataBase64,
                        MediaType = images[i].MediaType == "image/jpeg"
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
                MaxTokens = 12000,
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
                return new ExtractionResult { Ok = false, Model = model, Error = "Ran out of output room — send fewer screenshots at once." };

            var text = string.Join("", response.Content
                .Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
            if (string.IsNullOrWhiteSpace(text))
                return new ExtractionResult { Ok = false, Model = model, Error = $"Empty response (stop reason: {response.StopReason})." };

            var parsed = JsonSerializer.Deserialize<ExtractionPayload>(text,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            var loads = parsed?.Loads ?? new List<ExtractedLoad>();
            foreach (var l in loads)
            {
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
