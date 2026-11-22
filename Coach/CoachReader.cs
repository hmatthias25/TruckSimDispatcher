using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;
using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// Reads screenshots of the Coaches DLC's Contract Jobs and Tourist Jobs menus into jobs: the stops, the times, the
/// landmark, the pay and the passengers. Transcription only: the app does every calculation. The same pattern as the
/// company-driver app's board reader (Core's AiService).
/// </summary>
public static class CoachReader
{
    public record Result(bool Ok, List<OfferInput> Jobs, string Notes, string Error);

    const string Prompt = """
        You read screenshots of the job menus in the Coaches DLC for Euro Truck Simulator 2: the Contract Jobs menu
        (timetabled coach lines between bus stations, often with intermediate stops) and the Tourist Jobs menu (an
        out-and-back trip from a bus station to a landmark: it names a landmark or sight rather than a destination
        station). A screenshot may show either menu; tell them apart by that. Transcribe every job you can read.

        For each job:
        - menu: "Contract" or "Tourist".
        - stopCount: the number of stops the job lists, the first and last included ("2 stops" is straight through,
          "4 stops" calls at two cities on the way). 0 if not shown.
        - stops: only the places the menu NAMES, in order. Usually that is the station the coach leaves from, with its
          departure time, and the city it ends at, with its arrival time if shown. Do not invent the cities between: the
          count says how many there are. For a tourist job, the first stop is the station and the second is the city the
          landmark is in, if shown. City names as the game spells them; country as the two-letter code ETS2 uses on its map
          (DE, FR, NL, BE, LU, CH, AT, IT, CZ, SK, PL, HU, SI, HR, DK, SE, NO, FI, EE, LV, LT, RO, BG, TR, GR, ES, PT,
          and UK for Great Britain). Use "" for a time that is not shown. Times as 24-hour HH:mm.
        - landmark: the landmark's name for a tourist job, "" otherwise.
        - landmarkScope: "Global" for a famous landmark, "Local" for a local one, "" if not shown or not a tourist job.
        - pay: the money the job pays, as a number, 0 if not shown.
        - passengers: the number of passengers, 0 if not shown.
        - returnTime: for a tourist job, the time the group is due back if shown, "" otherwise.
        Report what is on the screen. Do not invent stops or times. Put anything unclear in notes.
        """;

    static readonly Dictionary<string, JsonElement> Schema = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>("""
        {
          "type": "object", "additionalProperties": false, "required": ["jobs", "notes"],
          "properties": {
            "notes": { "type": "string" },
            "jobs": { "type": "array", "items": {
              "type": "object", "additionalProperties": false,
              "required": ["menu", "stopCount", "stops", "landmark", "landmarkScope", "pay", "passengers", "returnTime"],
              "properties": {
                "menu": { "type": "string", "enum": ["Contract", "Tourist"] },
                "stopCount": { "type": "number" },
                "stops": { "type": "array", "items": {
                  "type": "object", "additionalProperties": false, "required": ["city", "country", "station", "time"],
                  "properties": { "city": { "type": "string" }, "country": { "type": "string" },
                                  "station": { "type": "string" }, "time": { "type": "string" } } } },
                "landmark": { "type": "string" },
                "landmarkScope": { "type": "string", "enum": ["Global", "Local", ""] },
                "pay": { "type": "number" },
                "passengers": { "type": "number" },
                "returnTime": { "type": "string" }
              } } }
          }
        }
        """)!;

    class Payload
    {
        public List<Job> Jobs { get; set; } = new();
        public string Notes { get; set; } = "";
    }
    class Job
    {
        public string Menu { get; set; } = "Contract";
        public double StopCount { get; set; }
        public List<JobStop> Stops { get; set; } = new();
        public string Landmark { get; set; } = "";
        public string LandmarkScope { get; set; } = "";
        public double Pay { get; set; }
        public double Passengers { get; set; }
        public string ReturnTime { get; set; } = "";
    }
    class JobStop
    {
        public string City { get; set; } = "";
        public string Country { get; set; } = "";
        public string Station { get; set; } = "";
        public string Time { get; set; } = "";
    }

    /// <summary>As many as the company-driver app takes: the menus scroll, so a city's board is often several screens.</summary>
    public const int MaxScreenshots = 24;
    const int MaxConcurrentReads = 6;

    /// <summary>
    /// Every screenshot read on its own, six at a time, as the company-driver app reads a board: one at a time
    /// meant a long wait, and the reads need nothing from each other. Merged in the order they were sent, with a job
    /// that showed on two overlapping screenshots kept once.
    /// </summary>
    public static async Task<Result> ReadAsync(CoachCareer c, List<ScreenshotImage> images, CancellationToken ct = default)
    {
        var key = c.Settings.AnthropicApiKey.Trim();
        if (key.Length == 0) return new(false, new(), "", "Reading screenshots needs an Anthropic API key, in Settings. Jobs can be typed in without one.");
        if (images.Count == 0) return new(false, new(), "", "No screenshots were sent.");
        if (images.Count > MaxScreenshots) return new(false, new(), "", $"That is {images.Count} screenshots. Send at most {MaxScreenshots} at a time.");
        var model = string.IsNullOrWhiteSpace(c.Settings.AnthropicModel) ? "claude-opus-5-5" : c.Settings.AnthropicModel.Trim();

        var results = new Result?[images.Count];
        using (var gate = new SemaphoreSlim(MaxConcurrentReads))
        {
            var running = images.Select(async (img, i) =>
            {
                await gate.WaitAsync(ct);
                try { results[i] = await ReadOneAsync(key, model, img, i, images.Count, ct); }
                finally { gate.Release(); }
            }).ToList();
            await Task.WhenAll(running);
        }

        var jobs = new List<OfferInput>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var notes = new List<string>();
        var failures = new List<string>();
        foreach (var r in results)
        {
            if (r == null) continue;
            if (!r.Ok) { failures.Add(r.Error); continue; }
            if (!string.IsNullOrWhiteSpace(r.Notes)) notes.Add(r.Notes);
            foreach (var j in r.Jobs)
            {
                var k = $"{j.Menu}|{string.Join(">", (j.Stops ?? new()).Select(s => $"{s.City}|{s.Cc}|{s.Time}"))}|{j.Landmark}";
                if (seen.Add(k)) jobs.Add(j);
            }
        }
        if (jobs.Count == 0)
            return new(false, new(), string.Join(" ", notes), failures.Count > 0 ? string.Join(" ", failures.Distinct()) : "Nothing readable on those screenshots.");
        if (failures.Count > 0) notes.Add($"{failures.Count} of {images.Count} screenshots could not be read: {string.Join(" ", failures.Distinct())}");
        return new(true, jobs, string.Join(" ", notes), "");
    }

    static async Task<Result> ReadOneAsync(string key, string model, ScreenshotImage image, int index, int total, CancellationToken ct)
    {
        var images = new List<ScreenshotImage> { image };
        try
        {
            var client = new AnthropicClient { ApiKey = key };
            var content = new List<ContentBlockParam>();
            for (var i = 0; i < images.Count; i++)
            {
                content.Add(new TextBlockParam { Text = $"Screenshot {index + 1} of {total}:" });
                content.Add(new ImageBlockParam
                {
                    Source = new Base64ImageSource
                    {
                        Data = images[i].DataBase64,
                        MediaType = images[i].MediaType == "image/jpeg" ? MediaType.ImageJpeg : MediaType.ImagePng,
                    },
                });
            }
            content.Add(new TextBlockParam { Text = "Transcribe every job in the screenshot(s) above into the required schema." });

            var response = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 16000,
                OutputConfig = new OutputConfig { Effort = Effort.High, Format = new JsonOutputFormat { Schema = Schema } },
                System = new List<TextBlockParam> { new() { Text = Prompt, CacheControl = new CacheControlEphemeral() } },
                Messages = [new() { Role = Role.User, Content = content }],
            }, cancellationToken: ct);

            if (response.StopReason == "refusal") return new(false, new(), "", "The model declined to read these images.");
            if (response.StopReason == "max_tokens") return new(false, new(), "", "Too much on these screenshots for one read: send fewer at a time.");
            var text = string.Join("", response.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
            var parsed = JsonSerializer.Deserialize<Payload>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            var jobs = (parsed?.Jobs ?? new()).Where(j => j.Stops.Count > 0).Select(j => new OfferInput
            {
                Menu = j.Menu,
                Stops = j.Stops.Select(s => new StopInput { City = s.City, Cc = s.Country, Station = s.Station, Time = s.Time }).ToList(),
                Landmark = j.Landmark,
                LandmarkScope = j.LandmarkScope,
                Pay = (decimal)j.Pay,
                Passengers = (int)Math.Round(j.Passengers),
                ReturnTime = j.ReturnTime,
                StopCount = (int)Math.Round(j.StopCount),
            }).ToList();
            return jobs.Count == 0
                ? new(false, new(), parsed?.Notes ?? "", "Nothing readable on those screenshots.")
                : new(true, jobs, parsed?.Notes ?? "", "");
        }
        catch (Exception ex)
        {
            return new(false, new(), "", AiService.Describe(ex));
        }
    }
}
