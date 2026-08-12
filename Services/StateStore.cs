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
    private AppState _state;

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
        _dataDir = ResolveDataDir(baseDir);
        _backupDir = Path.Combine(_dataDir, "backups");
        _file = Path.Combine(_dataDir, "career.json");
        Directory.CreateDirectory(_backupDir);
        _state = Load();
    }

    /// <summary>
    /// The career file lives beside the exe so the whole thing stays portable — copy the folder to
    /// another machine and the career comes with it. If that location is not writable (dropped into
    /// Program Files, a read-only share, or launched through the shared dotnet host) fall back to
    /// LocalAppData rather than failing to start.
    /// </summary>
    private static string ResolveDataDir(string preferred)
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
            File.Replace(tmp, _file, null);
        }
        else
        {
            File.Move(tmp, _file);
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
        lock (_gate)
        {
            Snapshot("pre-restore");
            _state = loaded;
            Save();
        }
    }

    /// <summary>Wipe the career and start over. Always snapshots first.</summary>
    public void ResetAll()
    {
        lock (_gate)
        {
            if (File.Exists(_file)) Snapshot("pre-reset");
            _state = Fresh();
            Save();
        }
    }

    public AppState ImportJson(string json)
    {
        var loaded = JsonSerializer.Deserialize<AppState>(json, Json)
                     ?? throw new InvalidDataException("Not a valid career file.");
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
    /// <summary>Day 1, 00:00. Arbitrary but fixed — only differences between times ever matter.</summary>
    public static readonly DateTime Epoch = new(2000, 1, 1, 0, 0, 0);

    /// <summary>The game day a moment falls on. Day 1 is the first day of the career.</summary>
    public static int DayOf(DateTime dt) => (int)Math.Floor((dt - Epoch).TotalDays) + 1;

    public static int? DayOf(string? value) => TryParse(value) is { } dt ? DayOf(dt) : null;

    /// <summary>Builds a moment from a day number and a time of day.</summary>
    public static DateTime FromDay(int day, int hour, int minute) =>
        Epoch.AddDays(Math.Max(1, day) - 1).AddHours(Math.Clamp(hour, 0, 23)).AddMinutes(Math.Clamp(minute, 0, 59));

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

    /// <summary>How the clock is shown everywhere the player reads it.</summary>
    public static string PrettyDay(DateTime dt) => $"Day {DayOf(dt)} · {dt:HH\\:mm}";

    public static string PrettyDay(string? value) =>
        TryParse(value) is { } dt ? PrettyDay(dt) : (value ?? "—");


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
