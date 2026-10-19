using System.Globalization;
using System.Text.Json;
using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// The owner/operator career on disk: <c>oo-data\career.json</c> beside the exe, with dated backups.
///
/// <para>A folder of its own, never the company-driver app's <c>data</c> folder, so the two exes can sit side by
/// side without either reading the other's career. <c>TSO_DATA_DIR</c> overrides it (the test runner uses it);
/// the company app's <c>TSD_DATA_DIR</c> is deliberately not honoured here.</para>
/// </summary>
public class OoStore
{
    private readonly object _gate = new();
    private readonly string _dir;
    private readonly string _file;
    private readonly string _backups;
    private OoCareer _career;

    public OoStore(string exeDir)
    {
        var explicitDir = Environment.GetEnvironmentVariable("TSO_DATA_DIR");
        _dir = !string.IsNullOrWhiteSpace(explicitDir) ? explicitDir : Path.Combine(exeDir, "oo-data");
        Directory.CreateDirectory(_dir);
        _backups = Path.Combine(_dir, "backups");
        Directory.CreateDirectory(_backups);
        _file = Path.Combine(_dir, "career.json");
        _career = Load();
        Activate(_career);
        if (HomeLife.MigrateFamily(_career)) Save();
        Companies.Apply(_career);
    }

    public string DataDirectory => _dir;

    /// <summary>Read the career. Callers must not change it outside <see cref="Mutate{T}"/>.</summary>
    public OoCareer Career => _career;

    /// <summary>Change under the lock, then save. The action's return value is passed through.</summary>
    public T Mutate<T>(Func<OoCareer, T> action)
    {
        lock (_gate)
        {
            var result = action(_career);
            Activate(_career);
            Save();
            return result;
        }
    }

    public void Mutate(Action<OoCareer> action) => Mutate<object?>(c => { action(c); return null; });

    /// <summary>Start again from nothing. The old career is kept in the backups folder.</summary>
    public void Reset()
    {
        lock (_gate)
        {
            if (File.Exists(_file))
                File.Copy(_file, Path.Combine(_backups, $"reset-{DateTime.Now:yyyyMMdd-HHmmss}.json"), true);
            _career = new OoCareer();
            Activate(_career);
            Save();
        }
    }

    public static void Log(OoCareer c, string channel, string message, string reference = "")
    {
        var s = c.Game;
        s.Events.Insert(0, new LogEvent { Channel = channel, Message = message, Ref = reference, GameTime = s.Status.GameTime });
        if (s.Events.Count > 2000) s.Events.RemoveRange(2000, s.Events.Count - 2000);
    }

    /// <summary>Core's tables follow the game being played: units, the map, the learned roads.</summary>
    private static void Activate(OoCareer c)
    {
        GameProfile.Activate(c.Game);
        Units.Activate(c.Game);
        RoadLearning.Activate(c.Game);
    }

    private OoCareer Load()
    {
        if (!File.Exists(_file)) return new OoCareer();
        try
        {
            return JsonSerializer.Deserialize<OoCareer>(File.ReadAllText(_file), StateStore.Json) ?? new OoCareer();
        }
        catch (Exception ex)
        {
            // Never silently discard a career. Park the unreadable one and start clean.
            var quarantine = Path.Combine(_backups, $"UNREADABLE-{DateTime.Now:yyyyMMdd-HHmmss}.json");
            try { File.Copy(_file, quarantine, true); } catch { /* best effort */ }
            Console.Error.WriteLine($"[state] career.json could not be read ({ex.Message}); kept at {quarantine}");
            return new OoCareer();
        }
    }

    private void Save()
    {
        _career.AppVersion = OoBuild.Version;
        var tmp = _file + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_career, StateStore.Json));
        if (!File.Exists(_file)) { File.Move(tmp, _file); return; }

        var backup = Path.Combine(_backups, $"career-{DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture)}.json");
        if (!File.Exists(backup))
        {
            try { File.Copy(_file, backup); } catch { /* best effort */ }
            try
            {
                foreach (var f in new DirectoryInfo(_backups).GetFiles("career-*.json")
                             .OrderByDescending(f => f.LastWriteTimeUtc).Skip(40))
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
