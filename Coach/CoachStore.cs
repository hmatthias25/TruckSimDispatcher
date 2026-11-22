using System.Globalization;
using System.Text.Json;
using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// The coach career on disk: <c>coach-data\career.json</c> beside the exe, with dated backups. A folder of its own, so
/// the three apps can sit side by side. <c>TSC_DATA_DIR</c> overrides it (the test runner uses it).
/// </summary>
public class CoachStore
{
    private readonly object _gate = new();
    private readonly string _dir;
    private readonly string _file;
    private readonly string _backups;
    private CoachCareer _career;

    /// <summary>Core's tables, set to Euro Truck Simulator 2: its map, its roads, kilometres and euros.</summary>
    private static readonly AppState Ets2 = new() { Game = "ETS2" };

    public CoachStore(string exeDir)
    {
        var explicitDir = Environment.GetEnvironmentVariable("TSC_DATA_DIR");
        _dir = !string.IsNullOrWhiteSpace(explicitDir) ? explicitDir : Path.Combine(exeDir, "coach-data");
        Directory.CreateDirectory(_dir);
        _backups = Path.Combine(_dir, "backups");
        Directory.CreateDirectory(_backups);
        _file = Path.Combine(_dir, "career.json");
        Activate();
        _career = Load();
        Save();
    }

    public static void Activate()
    {
        GameProfile.Activate(Ets2);
        Units.Activate(Ets2);
        RoadLearning.Activate(Ets2);
    }

    public string DataDirectory => _dir;
    public CoachCareer Career => _career;

    /// <summary>Change under the lock, catch up whatever the clock has moved through, then save.</summary>
    public T Mutate<T>(Func<CoachCareer, T> action)
    {
        lock (_gate)
        {
            Activate();
            // All or nothing: an action refused halfway (a check that fails after the clock or the hours have moved)
            // must leave the career exactly as it was, not half done and saved by the next action.
            var before = JsonSerializer.Serialize(_career, StateStore.Json);
            T result;
            try { result = action(_career); }
            catch
            {
                _career = JsonSerializer.Deserialize<CoachCareer>(before, StateStore.Json) ?? _career;
                throw;
            }
            CatchUp(_career);
            Save();
            return result;
        }
    }

    public void Mutate(Action<CoachCareer> action) => Mutate<object?>(c => { action(c); return null; });

    /// <summary>Payday and the reviews: each only does what is due.</summary>
    public static List<string> CatchUp(CoachCareer c)
    {
        var said = new List<string>();
        Maintenance.Ensure(c);
        if (!c.Started) return said;
        said.AddRange(CoachPay.Advance(c));
        said.AddRange(Companies.Review(c));
        return said;
    }

    public void Reset()
    {
        lock (_gate)
        {
            if (File.Exists(_file))
                File.Copy(_file, Path.Combine(_backups, $"reset-{DateTime.Now:yyyyMMdd-HHmmss}.json"), true);
            var keep = _career.Settings;
            _career = new CoachCareer { Settings = keep };
            Save();
        }
    }

    public static void Log(CoachCareer c, string channel, string message)
    {
        c.Log.Insert(0, new CoachEvent { Channel = channel, Message = message, GameTime = c.GameTime });
        if (c.Log.Count > 1500) c.Log.RemoveRange(1500, c.Log.Count - 1500);
    }

    private CoachCareer Load()
    {
        if (!File.Exists(_file)) return new CoachCareer();
        try
        {
            var c = JsonSerializer.Deserialize<CoachCareer>(File.ReadAllText(_file), StateStore.Json) ?? new CoachCareer();
            Maintenance.Ensure(c);
            return c;
        }
        catch (Exception ex)
        {
            var quarantine = Path.Combine(_backups, $"UNREADABLE-{DateTime.Now:yyyyMMdd-HHmmss}.json");
            try { File.Copy(_file, quarantine, true); } catch { /* best effort */ }
            Console.Error.WriteLine($"[state] career.json could not be read ({ex.Message}); kept at {quarantine}");
            return new CoachCareer();
        }
    }

    private void Save()
    {
        _career.AppVersion = CoachBuild.Version;
        var tmp = _file + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_career, StateStore.Json));
        if (!File.Exists(_file)) { File.Move(tmp, _file); return; }
        var backup = Path.Combine(_backups, $"career-{DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture)}.json");
        if (!File.Exists(backup))
        {
            try { File.Copy(_file, backup); } catch { /* best effort */ }
            try
            {
                foreach (var f in new DirectoryInfo(_backups).GetFiles("career-*.json").OrderByDescending(f => f.LastWriteTimeUtc).Skip(40))
                    f.Delete();
            }
            catch { /* best effort */ }
        }
        for (var i = 1; ; i++)
        {
            try { File.Replace(tmp, _file, null); return; }
            catch (Exception e) when (i < 5 && e is IOException or UnauthorizedAccessException) { Thread.Sleep(20 * i); }
        }
    }
}
