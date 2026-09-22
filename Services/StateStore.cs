using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Single-document JSON persistence. Writes are atomic (temp file + replace) and every
/// save rotates a timestamped backup so a corrupted career can always be recovered.
/// </summary>
public class StateStore
{
    private readonly string _dataDir;
    private readonly string _file;
    private readonly string _backupDir;
    private readonly object _gate = new();
    private readonly List<string> _searched;
    private AppState _state;

    /// <summary>
    /// Where careers that are not the one being played are kept.
    ///
    /// <para><b>The career being played stays at career.json.</b> That is deliberate and it is what keeps
    /// this backward compatible: the resolver finds it, an older build finds it, and a player who copies
    /// the folder to another machine still has their live career exactly where it has always been. Only
    /// the ones sitting idle move into here.</para>
    ///
    /// <para>So there is no pointer file and nothing to keep in step. Whatever is in career.json is the
    /// current career, by definition, and a slot file exists for a career precisely when it is not the
    /// one loaded.</para>
    /// </summary>
    private string CareersDir => Path.Combine(_dataDir, "careers");

    public static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    public string DataDirectory => _dataDir;
    public string StateFile => _file;

    public StateStore(string baseDir)
    {
        _searched = Candidates(baseDir);
        _dataDir = ResolveDataDir(_searched);
        _backupDir = Path.Combine(_dataDir, "backups");
        _file = Path.Combine(_dataDir, "career.json");
        Directory.CreateDirectory(_backupDir);
        _state = Load();
    }

    /// <summary>Every place a career file might live, in priority order.</summary>
    private static List<string> Candidates(string preferred)
    {
        var candidates = new List<string>();

        var explicitDir = Environment.GetEnvironmentVariable("TSD_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(explicitDir)) candidates.Add(explicitDir);

        if (!string.IsNullOrWhiteSpace(preferred)) candidates.Add(Path.Combine(preferred, "data"));

        var appBase = AppContext.BaseDirectory;
        if (!string.IsNullOrWhiteSpace(appBase)) candidates.Add(Path.Combine(appBase, "data"));

        candidates.Add(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TruckSimDispatcher", "data"));

        return candidates.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static bool HasCareer(string dir)
    {
        try { return File.Exists(Path.Combine(dir, "career.json")); }
        catch { return false; }
    }

    /// <summary>
    /// The career file lives beside the exe so the whole thing stays portable — copy the folder to
    /// another machine and the career comes with it.
    ///
    /// A location that already holds a career beats an empty one. That is what makes updating the app
    /// safe: drop a newer exe in and it finds the career that is already there rather than opening a
    /// blank one and looking like the save was lost. An explicit TSD_DATA_DIR still overrides
    /// everything, and if nothing is writable (Program Files, a read-only share, launched through the
    /// shared dotnet host) it falls back to LocalAppData rather than failing to start.
    /// </summary>
    private static string ResolveDataDir(List<string> candidates)
    {
        var explicitDir = Environment.GetEnvironmentVariable("TSD_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(explicitDir) && IsWritable(explicitDir))
            return explicitDir;

        foreach (var dir in candidates)
            if (HasCareer(dir) && IsWritable(dir))
            {
                Console.WriteLine($"  [data] found an existing career at {dir}");
                return dir;
            }

        foreach (var dir in candidates)
        {
            if (IsWritable(dir)) return dir;
            Console.WriteLine($"  [data] not writable, trying the next location: {dir}");
        }

        // Last resort — let the exception surface with a clear path rather than silently losing data.
        var last = candidates[^1];
        Directory.CreateDirectory(last);
        return last;
    }

    /// <summary>
    /// Career files sitting in the other locations we searched. Surfaced in the UI so a career left
    /// behind by an older copy of the app can be found and adopted instead of quietly abandoned.
    /// </summary>
    public List<object> OtherCareerFiles()
    {
        var found = new List<object>();
        foreach (var dir in _searched)
        {
            if (string.Equals(dir, _dataDir, StringComparison.OrdinalIgnoreCase)) continue;
            var path = Path.Combine(dir, "career.json");
            if (!File.Exists(path)) continue;
            try
            {
                var fi = new FileInfo(path);
                found.Add(new
                {
                    path,
                    sizeKb = Math.Round(fi.Length / 1024.0, 1),
                    modified = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
                });
            }
            catch { /* unreadable — nothing useful to offer */ }
        }
        return found;
    }

    /// <summary>Loads a career file from an arbitrary path, snapshotting the current one first.</summary>
    public AppState AdoptFile(string path)
    {
        var full = Path.GetFullPath(path);
        if (!File.Exists(full)) throw new FileNotFoundException("No career file at that path.", full);
        return ImportJson(File.ReadAllText(full));
    }

    // ---------------------------------------------------------------- careers

    /// <summary>What to call a career that has never been given a name.</summary>
    public static string LabelFor(AppState s)
    {
        if (!string.IsNullOrWhiteSpace(s.CareerName)) return s.CareerName.Trim();
        if (!string.IsNullOrWhiteSpace(s.Company.Name)) return s.Company.Name.Trim();
        if (!string.IsNullOrWhiteSpace(s.Driver.Name)) return s.Driver.Name.Trim();
        return s.Onboarded ? "Unnamed career" : "New career";
    }

    /// <summary>
    /// A filename for a career, derived from its name.
    ///
    /// Derived rather than stored because a slug that has drifted from the name it came from is a thing
    /// nobody can debug from a directory listing. Uniqueness is settled by the caller against what is
    /// already on disk.
    /// </summary>
    public static string SlugFor(string? label)
    {
        var cleaned = new string((label ?? "").Trim().ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray());
        var parts = cleaned.Split('-', StringSplitOptions.RemoveEmptyEntries);
        var slug = string.Join("-", parts);
        if (slug.Length > 48) slug = slug[..48].TrimEnd('-');
        return slug.Length > 0 ? slug : "career";
    }

    private string SlotPath(string slug) =>
        Path.Combine(CareersDir, Path.GetFileName(slug) + ".json");

    private string FreeSlug(string label)
    {
        var baseSlug = SlugFor(label);
        var slug = baseSlug;
        for (var n = 2; File.Exists(SlotPath(slug)); n++) slug = $"{baseSlug}-{n}";
        return slug;
    }

    /// <summary>One line about a career, read off its file without loading it as the live state.</summary>
    public record CareerInfo(string Slug, string Label, bool Current, string Company, string Driver,
                             string GameTime, int Day, int Trips, bool Onboarded, string SavedUtc);

    private static CareerInfo Describe(AppState s, string slug, bool current, DateTime savedUtc) =>
        new(slug, LabelFor(s), current, s.Company.Name ?? "", s.Driver.Name ?? "",
            s.Status.GameTime ?? "", GameClock.DayOf(s.Status.GameTime) ?? 0,
            s.Trips.Count(t => t.Status == "Delivered"), s.Onboarded,
            savedUtc.ToString("o", CultureInfo.InvariantCulture));

    /// <summary>
    /// Every career on file, the live one first.
    ///
    /// Reads each idle slot to describe it, which is a handful of files and only when the list is asked
    /// for. A slot that will not parse is skipped rather than thrown over: one unreadable career must not
    /// make the others unreachable.
    /// </summary>
    public List<CareerInfo> ListCareers()
    {
        lock (_gate)
        {
            var all = new List<CareerInfo>
            {
                Describe(_state, "", true,
                    File.Exists(_file) ? File.GetLastWriteTimeUtc(_file) : DateTime.UtcNow),
            };

            if (!Directory.Exists(CareersDir)) return all;

            foreach (var f in new DirectoryInfo(CareersDir).GetFiles("*.json")
                         .OrderByDescending(f => f.LastWriteTimeUtc))
            {
                try
                {
                    var loaded = JsonSerializer.Deserialize<AppState>(File.ReadAllText(f.FullName), Json);
                    if (loaded == null) continue;
                    all.Add(Describe(loaded, Path.GetFileNameWithoutExtension(f.Name), false, f.LastWriteTimeUtc));
                }
                catch
                {
                    // Unreadable, and saying so here would be noise on a list. It stays on disk and the
                    // player can still see the file; what matters is that it cannot hide the others.
                }
            }

            return all;
        }
    }

    /// <summary>
    /// Park the career being played and pick up another one.
    ///
    /// <para>Ordered so that no step can lose a career if the next one fails: the current career is
    /// written to its slot and confirmed on disk BEFORE the incoming one is read, and the incoming slot
    /// file is only removed once career.json holds it. A crash anywhere in the middle leaves both
    /// careers on disk — worst case one of them appears twice, which the player can see and sort out,
    /// rather than neither appearing at all.</para>
    /// </summary>
    public AppState SwitchTo(string slug)
    {
        lock (_gate)
        {
            var target = SlotPath(slug);
            if (!File.Exists(target)) throw new FileNotFoundException("No career by that name.", slug);

            var incomingText = File.ReadAllText(target);
            var incoming = JsonSerializer.Deserialize<AppState>(incomingText, Json)
                           ?? throw new InvalidOperationException(
                               "That career file could not be read, so I am not going to swap it in.");

            Park(_state);

            Migrations.Apply(incoming);
            _state = incoming;
            Save();

            // Only now, with the new career written where the app looks for it.
            try { File.Delete(target); } catch { /* it will show as a duplicate; nothing is lost */ }
            return _state;
        }
    }

    /// <summary>
    /// Start a fresh career, keeping the settings that describe the machine rather than the career.
    ///
    /// <para>HOS rules, the speed factor, fuel prices, the economy, the map you run and the API key are
    /// all facts about this player's game install, and retyping them per career would be busywork with a
    /// wrong answer waiting at the end of it. Same reasoning as Start over, which has always kept
    /// them.</para>
    /// </summary>
    public AppState CreateCareer(string? name, bool inheritSettings = true)
    {
        lock (_gate)
        {
            var fresh = Fresh();
            if (inheritSettings)
            {
                // Round-tripped rather than assigned, so the new career cannot end up sharing objects
                // with the old one and writing through to it.
                var carried = JsonSerializer.Deserialize<AppSettings>(
                    JsonSerializer.Serialize(_state.Settings, Json), Json);
                if (carried != null) fresh.Settings = carried;
            }
            fresh.CareerName = (name ?? "").Trim();

            Park(_state);
            _state = fresh;
            Save();
            return _state;
        }
    }

    /// <summary>Rename a career — the live one when the slug is blank, otherwise one sitting idle.</summary>
    public void RenameCareer(string? slug, string name)
    {
        var wanted = (name ?? "").Trim();
        if (wanted.Length == 0) throw new InvalidOperationException("A career needs a name.");

        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(slug))
            {
                _state.CareerName = wanted;
                Save();
                return;
            }

            var path = SlotPath(slug);
            if (!File.Exists(path)) throw new FileNotFoundException("No career by that name.", slug);
            var loaded = JsonSerializer.Deserialize<AppState>(File.ReadAllText(path), Json)
                         ?? throw new InvalidOperationException("That career file could not be read.");
            loaded.CareerName = wanted;

            // Renamed in place. Moving the file to match the new name would break nothing, and would
            // also mean a rename can fail halfway with the career under a filename nobody expects.
            WriteAtomic(path, JsonSerializer.Serialize(loaded, Json));
        }
    }

    /// <summary>
    /// Delete an idle career. The live one is not deletable — Start over is that, and it says so.
    ///
    /// Snapshotted first, under its own name, because this is the one action here that is meant to
    /// destroy something and "meant to" is not the same as "and I definitely picked the right one".
    /// </summary>
    public string DeleteCareer(string slug)
    {
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(slug))
                throw new InvalidOperationException(
                    "That is the career you are playing. Switch to another one first, or use Start over.");

            var path = SlotPath(slug);
            if (!File.Exists(path)) throw new FileNotFoundException("No career by that name.", slug);

            Directory.CreateDirectory(_backupDir);
            var kept = Path.Combine(_backupDir,
                $"deleted-career-{DateTime.Now:yyyyMMdd-HHmmss}-{Path.GetFileName(slug)}.json");
            File.Copy(path, kept, true);
            File.Delete(path);
            return kept;
        }
    }

    /// <summary>Write the given career out to a slot of its own. Caller holds the lock.</summary>
    private void Park(AppState s)
    {
        Directory.CreateDirectory(CareersDir);
        s.AppVersion = Build.Version;
        var slug = FreeSlug(LabelFor(s));
        WriteAtomic(SlotPath(slug), JsonSerializer.Serialize(s, Json));
    }

    private static void WriteAtomic(string path, string text)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text);
        if (File.Exists(path)) ReplaceWithRetry(tmp, path);
        else File.Move(tmp, path);
    }

    private static bool IsWritable(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
            var probe = Path.Combine(dir, ".write-test");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private AppState Load()
    {
        if (!File.Exists(_file)) return Fresh();
        try
        {
            var text = File.ReadAllText(_file);
            var loaded = JsonSerializer.Deserialize<AppState>(text, Json);
            if (loaded == null) return Fresh();
            Migrations.Apply(loaded);
            return loaded;
        }
        catch (Exception ex)
        {
            // Never silently discard a career file. Park it and start clean.
            var quarantine = Path.Combine(_backupDir,
                $"UNREADABLE-{DateTime.Now:yyyyMMdd-HHmmss}.json");
            try { File.Copy(_file, quarantine, true); } catch { /* best effort */ }
            Console.Error.WriteLine($"[state] career.json could not be read ({ex.Message}).");
            Console.Error.WriteLine($"[state] the unreadable file was preserved at {quarantine}");
            return Fresh();
        }
    }

    private static AppState Fresh()
    {
        var s = new AppState();
        Seed.ApplyDefaultAccounts(s);
        return s;
    }

    /// <summary>Read the state. Callers must not mutate outside <see cref="Mutate"/>.</summary>
    public AppState State => _state;

    /// <summary>Mutate under lock, then persist. The action's return value is passed through.</summary>
    public T Mutate<T>(Func<AppState, T> action)
    {
        lock (_gate)
        {
            var result = action(_state);
            Save();
            return result;
        }
    }

    public void Mutate(Action<AppState> action) => Mutate<object?>(s => { action(s); return null; });

    private void Save()
    {
        // Stamp the build that wrote this file, so a career can always say where it came from.
        _state.AppVersion = Build.Version;
        var text = JsonSerializer.Serialize(_state, Json);
        var tmp = _file + ".tmp";
        File.WriteAllText(tmp, text);

        if (File.Exists(_file))
        {
            // Keep the previous good copy before overwriting.
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);
            var backup = Path.Combine(_backupDir, $"career-{stamp}.json");
            if (!File.Exists(backup))
            {
                try { File.Copy(_file, backup); } catch { /* best effort */ }
                PruneBackups();
            }
            ReplaceWithRetry(tmp, _file);
        }
        else
        {
            File.Move(tmp, _file);
        }
    }

    /// <summary>
    /// Swaps the freshly written file in, allowing for something briefly holding it open.
    ///
    /// <see cref="File.Replace(string,string,string)"/> fails outright if anything has either file open
    /// for even a moment, and on Windows something always might: Defender scanning a file the instant it
    /// is written, a sync client, a backup agent. Losing that race threw the save away — the career on
    /// disk stayed at the previous write and the player was told nothing.
    ///
    /// Short retries rather than a swallowed exception. A scanner clears in milliseconds; anything that
    /// does not is a real problem and still throws, because a save that cannot be written is something
    /// the player has to know about.
    /// </summary>
    private static void ReplaceWithRetry(string tmp, string target)
    {
        const int attempts = 5;
        for (var i = 1; ; i++)
        {
            try
            {
                File.Replace(tmp, target, null);
                return;
            }
            catch (IOException) when (i < attempts)
            {
                Thread.Sleep(20 * i);
            }
            catch (UnauthorizedAccessException) when (i < attempts)
            {
                Thread.Sleep(20 * i);
            }
        }
    }

    private void PruneBackups()
    {
        try
        {
            var files = new DirectoryInfo(_backupDir)
                .GetFiles("career-*.json")
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .Skip(40)
                .ToList();
            foreach (var f in files) f.Delete();
        }
        catch { /* best effort */ }
    }

    /// <summary>Explicit user-triggered snapshot.</summary>
    public string Snapshot(string label)
    {
        lock (_gate)
        {
            var safe = string.Join("_", (label ?? "manual").Split(Path.GetInvalidFileNameChars()));
            var name = $"snapshot-{DateTime.Now:yyyyMMdd-HHmmss}-{safe}.json";
            var path = Path.Combine(_backupDir, name);
            File.WriteAllText(path, JsonSerializer.Serialize(_state, Json));
            return path;
        }
    }

    public List<string> ListBackups()
    {
        if (!Directory.Exists(_backupDir)) return new();
        return new DirectoryInfo(_backupDir).GetFiles("*.json")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => f.Name)
            .ToList();
    }

    public void RestoreBackup(string name)
    {
        var path = Path.Combine(_backupDir, Path.GetFileName(name));
        if (!File.Exists(path)) throw new FileNotFoundException("Backup not found.", name);
        var loaded = JsonSerializer.Deserialize<AppState>(File.ReadAllText(path), Json)
                     ?? throw new InvalidDataException("Backup is not a valid career file.");
        // Same reason as ImportJson: a backup is as old as the build that wrote it.
        Migrations.Apply(loaded);
        lock (_gate)
        {
            Snapshot("pre-restore");
            _state = loaded;
            Save();
        }
    }

    /// <summary>
    /// Wipe the career and start over. Always snapshots first.
    ///
    /// Settings are kept by default, and that is the point: the API key, the HOS rule set, the mod
    /// list and the economic assumptions describe the player's game and their machine, not the career
    /// that just ended. Losing them on every restart means re-entering an API key and re-unticking the
    /// 30-minute break to play the same way in the same install. Pass <paramref name="keepSettings"/>
    /// false only to genuinely start from factory defaults.
    /// </summary>
    public void ResetAll(bool keepSettings = true)
    {
        lock (_gate)
        {
            if (File.Exists(_file)) Snapshot("pre-reset");

            var settings = _state.Settings;
            var markets = _state.MarketExtras;

            _state = Fresh();

            if (keepSettings)
            {
                _state.Settings = settings;
                // Trip numbering belongs to the career that just ended, not to the new one.
                _state.Settings.FreightPrefix = "";
                // Map data the player entered describes their install, so it survives too.
                _state.MarketExtras = markets;
            }

            Save();
        }
    }

    public AppState ImportJson(string json)
    {
        var loaded = JsonSerializer.Deserialize<AppState>(json, Json)
                     ?? throw new InvalidDataException("Not a valid career file.");
        // A file coming in this way is exactly as old as one found on disk at startup, and until now only
        // startup migrated. Import, adopt and restore all landed an un-migrated career in memory and then
        // saved it — so the fixes ran late or, if the version had already been stamped forward, never.
        Migrations.Apply(loaded);
        lock (_gate)
        {
            if (File.Exists(_file)) Snapshot("pre-import");
            _state = loaded;
            Save();
            return _state;
        }
    }

    public string ExportJson() => JsonSerializer.Serialize(_state, Json);

    public void Log(AppState s, string channel, string message, string reference = "")
    {
        s.Events.Insert(0, new LogEvent
        {
            Channel = channel,
            Message = message,
            Ref = reference,
            GameTime = s.Status.GameTime
        });
        if (s.Events.Count > 2000) s.Events.RemoveRange(2000, s.Events.Count - 2000);
    }
}

/// <summary>
/// The in-game clock.
///
/// ATS has no calendar — there is no year or month a player can reconcile against, only elapsed
/// days and a time of day. So the clock is expressed to the player as <b>Day N · HH:MM</b>, which
/// is something they can actually read off their game.
///
/// Internally it is still a DateTime measured from <see cref="Epoch"/>, because every HOS
/// projection, deadline and elapsed-time calculation is ordinary date arithmetic. Only the input
/// and display boundaries speak in day numbers.
/// </summary>
public static class GameClock
{
    /// <summary>Day 0, 00:00. Arbitrary but fixed — only differences between times ever matter.</summary>
    public static readonly DateTime Epoch = new(2000, 1, 1, 0, 0, 0);

    /// <summary>
    /// The game day a moment falls on, counted <b>the way ATS counts it</b>.
    ///
    /// This used to add one, so the app called the game's day 14 "day 15" and every date a driver read
    /// was a day ahead of the one in front of them. Whole days since the epoch, and nothing added: the
    /// app's day number and the game's are now the same number.
    /// </summary>
    public static int DayOf(DateTime dt) => (int)Math.Floor((dt - Epoch).TotalDays);

    public static int? DayOf(string? value) => TryParse(value) is { } dt ? DayOf(dt) : null;

    /// <summary>Builds a moment from a day number and a time of day. The exact inverse of <see cref="DayOf"/>.</summary>
    public static DateTime FromDay(int day, int hour, int minute) =>
        Epoch.AddDays(Math.Max(0, day)).AddHours(Math.Clamp(hour, 0, 23)).AddMinutes(Math.Clamp(minute, 0, 59));

    /// <summary>Parses "12 14:30" or "12" or an ISO datetime into a moment.</summary>
    public static DateTime? FromDayTime(int day, string? timeOfDay)
    {
        var hh = 0; var mm = 0;
        if (!string.IsNullOrWhiteSpace(timeOfDay))
        {
            var parts = timeOfDay.Split(':');
            int.TryParse(parts.ElementAtOrDefault(0), out hh);
            int.TryParse(parts.ElementAtOrDefault(1), out mm);
        }
        return FromDay(day, hh, mm);
    }

    /// <summary>
    /// The weekday a game day falls on. ATS has no calendar, so the app defines one: <b>day 0 is a
    /// Monday</b>. That is the whole rule, and it is what makes payday mean something — Fridays are
    /// days 4, 11, 18, 25 and so on.
    ///
    /// The anchor moved with the numbering, and it had to. Payday is Friday, and Friday is worked out
    /// from the day number — so renumbering the days without moving the anchor would have slid every
    /// payday onto a different actual day. Anchoring day 0 instead of day 1 keeps every weekday on the
    /// moment it was always on: what the app called day 15 · Monday it now calls day 14 · Monday, which
    /// is what the game called it all along.
    /// </summary>
    public static DayOfWeek WeekdayOf(int day) =>
        (DayOfWeek)((Math.Max(0, day) % 7 + 1) % 7);   // day 0 -> Monday

    public static DayOfWeek? WeekdayOf(string? value) =>
        DayOf(value) is { } d ? WeekdayOf(d) : null;

    public static bool IsPayday(int day) => WeekdayOf(day) == DayOfWeek.Friday;

    /// <summary>The next payday on or after this day. Day 4 is the first one of a career.</summary>
    public static int NextPayday(int day)
    {
        for (var d = Math.Max(0, day); d < day + 8; d++)
            if (IsPayday(d)) return d;
        return day;
    }

    /// <summary>Every payday strictly after <paramref name="fromDay"/> and up to <paramref name="toDay"/>.</summary>
    public static IEnumerable<int> PaydaysBetween(int fromDay, int toDay)
    {
        for (var d = fromDay + 1; d <= toDay; d++)
            if (IsPayday(d)) yield return d;
    }

    /// <summary>How the clock is shown everywhere the player reads it.</summary>
    public static string PrettyDay(DateTime dt) =>
        $"{WeekdayOf(DayOf(dt)).ToString()[..3]} Day {DayOf(dt)} · {dt:HH\\:mm}";

    public static string PrettyDay(string? value) =>
        TryParse(value) is { } dt ? PrettyDay(dt) : (value ?? "—");

    /// <summary>
    /// Just the day, for text that means a date rather than a moment: "Sat day 49".
    ///
    /// <see cref="PrettyDay(DateTime)"/> carries a time with it, which is right for "you are due at" and
    /// wrong for "on". The epoch is arbitrary and exists only to be subtracted from, so a real date must
    /// never reach the player — ATS shows its own calendar and two of them cannot be reconciled.
    /// </summary>
    public static string DayLabel(DateTime dt) =>
        $"{WeekdayOf(DayOf(dt)).ToString()[..3]} day {DayOf(dt)}";


    private static readonly string[] Formats =
    {
        "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm",
        "yyyy/MM/dd HH:mm", "M/d/yyyy HH:mm", "M/d/yyyy h:mm tt"
    };

    public static DateTime? TryParse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTime.TryParseExact(value.Trim(), Formats, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var exact)) return exact;
        if (DateTime.TryParse(value.Trim(), CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var loose)) return loose;
        return null;
    }

    public static string Format(DateTime dt) => dt.ToString("yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture);

    /// <summary>Player-facing formatting. Day numbers, never a fictional calendar date.</summary>
    public static string Pretty(string? value)
    {
        var dt = TryParse(value);
        return dt == null ? (value ?? "") : Pretty(dt.Value);
    }

    public static string Pretty(DateTime dt) => PrettyDay(dt);

    /// <summary>Hours between two game times; null when either is unknown.</summary>
    public static double? HoursBetween(string? from, string? to)
    {
        var a = TryParse(from); var b = TryParse(to);
        if (a == null || b == null) return null;
        return (b.Value - a.Value).TotalHours;
    }
}
