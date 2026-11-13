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

    /// <summary>The store the app is running on, for the snapshot to count careers by. One per process.</summary>
    public static OoStore? Running { get; private set; }

    public OoStore(string exeDir)
    {
        Running = this;
        var explicitDir = Environment.GetEnvironmentVariable("TSO_DATA_DIR");
        _dir = !string.IsNullOrWhiteSpace(explicitDir) ? explicitDir : Path.Combine(exeDir, "oo-data");
        Directory.CreateDirectory(_dir);
        _backups = Path.Combine(_dir, "backups");
        Directory.CreateDirectory(_backups);
        _file = Path.Combine(_dir, "career.json");
        _career = Load();
        if (Prepare(_career)) Save();
    }

    /// <summary>
    /// Brings a career just read off disk up to date: the game tables it runs on, and the one-off repairs. Run on the
    /// career loaded at start-up and on one switched to. True where something changed and it wants saving.
    /// </summary>
    private static bool Prepare(OoCareer c)
    {
        Activate(c);
        var changed = HomeLife.MigrateFamily(c);
        Companies.Apply(c);
        // Money tracking starts this week; the first Monday check, and the factor's first recalculation, come next week.
        if (c.Started && c.Finance.StartWeek == 0) { Finance.Ensure(c); changed = true; }
        // Odometer readings that cannot be right, from before they were caught at the keyboard.
        if (c.Started && Odometer.Repair(c)) changed = true;
        // Monday check findings on the week they were found, from before they went on the week before.
        if (c.Started && Finance.MoveMondayGaps(c)) changed = true;
        // Terms from before quick pay moved to the invoice and detention onto every rate con.
        if (c.Started && Calls.MigrateTerms(c)) changed = true;
        // Away from home with no departure on file, from before home life caught every move.
        if (c.Started && HomeLife.RepairDeparture(c)) changed = true;
        // Money moved out, counted as spending by an earlier reading and entered as moved out at a Monday check as well.
        if (c.Started && Finance.RepairTakeBacks(c)) changed = true;
        return changed;
    }

    // ---------------------------------------------------------------- careers
    //
    // As the company-driver app keeps them (Core's StateStore): the career being played stays in career.json, where
    // it has always been, and the others are parked in oo-data\careers, one file each. Switching saves the one being
    // played first and loads the other straight away.

    private string CareersDir => Path.Combine(_dir, "careers");

    /// <summary>What to call a career: the name it was given, or the driver's.</summary>
    public static string LabelFor(OoCareer c)
    {
        if (!string.IsNullOrWhiteSpace(c.Game.CareerName)) return c.Game.CareerName.Trim();
        if (!string.IsNullOrWhiteSpace(c.Profile.DriverName)) return c.Profile.DriverName.Trim();
        return c.Started ? "Unnamed career" : "New career";
    }

    private string SlotPath(string slug) => Path.Combine(CareersDir, Path.GetFileName(slug) + ".json");

    private string FreeSlug(string label)
    {
        var baseSlug = StateStore.SlugFor(label);
        var slug = baseSlug;
        for (var n = 2; File.Exists(SlotPath(slug)); n++) slug = $"{baseSlug}-{n}";
        return slug;
    }

    /// <summary>One line about a career, read off its file without making it the one being played.</summary>
    public record CareerInfo(string Slug, string Label, bool Current, bool Started, string Driver, string Home,
                             string GameTime, int Day, int Loads, string SavedUtc);

    private static CareerInfo Describe(OoCareer c, string slug, bool current, DateTime savedUtc) =>
        new(slug, LabelFor(c), current, c.Started, c.Profile.DriverName ?? "",
            c.Started ? $"{c.Profile.HomeCity}, {c.Profile.HomeState}" : "",
            c.Game.Status.GameTime ?? "", GameClock.DayOf(c.Game.Status.GameTime) ?? 0,
            c.Game.Trips.Count(t => t.Status == "Delivered"), savedUtc.ToString("o", CultureInfo.InvariantCulture));

    /// <summary>How many careers are on file, counting the one being played. Cheap: it reads no career files.</summary>
    public int CareerCount => 1 + (Directory.Exists(CareersDir) ? Directory.GetFiles(CareersDir, "*.json").Length : 0);

    /// <summary>Every career on file, the one being played first. A parked file that will not read is skipped.</summary>
    public List<CareerInfo> ListCareers()
    {
        lock (_gate)
        {
            var all = new List<CareerInfo> { Describe(_career, "", true, File.Exists(_file) ? File.GetLastWriteTimeUtc(_file) : DateTime.UtcNow) };
            if (!Directory.Exists(CareersDir)) return all;
            foreach (var f in new DirectoryInfo(CareersDir).GetFiles("*.json").OrderByDescending(f => f.LastWriteTimeUtc))
            {
                try
                {
                    if (JsonSerializer.Deserialize<OoCareer>(File.ReadAllText(f.FullName), StateStore.Json) is { } parked)
                        all.Add(Describe(parked, Path.GetFileNameWithoutExtension(f.Name), false, f.LastWriteTimeUtc));
                }
                catch { /* unreadable: it stays on disk, and it cannot hide the others */ }
            }
            return all;
        }
    }

    /// <summary>
    /// Park the career being played and pick up another. Ordered so no step can lose one: the current career is on disk
    /// in its slot before the other is read in, and the other's slot goes only once career.json holds it.
    /// </summary>
    public OoCareer SwitchTo(string slug)
    {
        lock (_gate)
        {
            var target = SlotPath(slug);
            if (!File.Exists(target)) throw new InvalidOperationException("No career by that name.");
            var incoming = JsonSerializer.Deserialize<OoCareer>(File.ReadAllText(target), StateStore.Json)
                           ?? throw new InvalidOperationException("That career file could not be read, so it is not being swapped in.");
            Park(_career);
            _career = incoming;
            Prepare(_career);
            Save();
            try { File.Delete(target); } catch { /* it shows twice; nothing is lost */ }
            return _career;
        }
    }

    /// <summary>
    /// A fresh career, started on the Start screen. What describes the player's game rather than the career comes with
    /// it: the API key, the long-distance limits an economy mod sets, the cost per mile and the renamed companies.
    /// </summary>
    public OoCareer CreateCareer(string? name)
    {
        lock (_gate)
        {
            var fresh = new OoCareer();
            var carried = JsonSerializer.Deserialize<OoSettings>(JsonSerializer.Serialize(_career.Settings, StateStore.Json), StateStore.Json);
            if (carried != null) fresh.Settings = carried;
            fresh.CompanyNames = new Dictionary<string, string>(_career.CompanyNames, StringComparer.OrdinalIgnoreCase);
            fresh.Game.Settings.AnthropicApiKey = _career.Game.Settings.AnthropicApiKey;
            fresh.Game.Settings.AnthropicModel = _career.Game.Settings.AnthropicModel;
            fresh.Game.CareerName = (name ?? "").Trim();
            Park(_career);
            _career = fresh;
            Activate(_career);
            Save();
            return _career;
        }
    }

    /// <summary>Rename a career: the one being played when the slug is blank, otherwise one parked.</summary>
    public void RenameCareer(string? slug, string name)
    {
        var wanted = (name ?? "").Trim();
        if (wanted.Length == 0) throw new InvalidOperationException("A career needs a name.");
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(slug)) { _career.Game.CareerName = wanted; Save(); return; }
            var path = SlotPath(slug);
            if (!File.Exists(path)) throw new InvalidOperationException("No career by that name.");
            var parked = JsonSerializer.Deserialize<OoCareer>(File.ReadAllText(path), StateStore.Json)
                         ?? throw new InvalidOperationException("That career file could not be read.");
            parked.Game.CareerName = wanted;
            WriteAtomic(path, JsonSerializer.Serialize(parked, StateStore.Json));
        }
    }

    /// <summary>Delete a parked career, keeping a copy in backups. The one being played is not deletable.</summary>
    public string DeleteCareer(string slug)
    {
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(slug))
                throw new InvalidOperationException("That is the career you are playing. Switch to another one first.");
            var path = SlotPath(slug);
            if (!File.Exists(path)) throw new InvalidOperationException("No career by that name.");
            var kept = Path.Combine(_backups, $"deleted-career-{DateTime.Now:yyyyMMdd-HHmmss}-{Path.GetFileName(slug)}.json");
            File.Copy(path, kept, true);
            File.Delete(path);
            return kept;
        }
    }

    /// <summary>Write a career out to a slot of its own. Caller holds the lock.</summary>
    private void Park(OoCareer c)
    {
        Directory.CreateDirectory(CareersDir);
        c.AppVersion = OoBuild.Version;
        WriteAtomic(SlotPath(FreeSlug(LabelFor(c))), JsonSerializer.Serialize(c, StateStore.Json));
    }

    private static void WriteAtomic(string path, string text)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text);
        if (File.Exists(path)) File.Replace(tmp, path, null);
        else File.Move(tmp, path);
    }

    public string DataDirectory => _dir;

    /// <summary>Read the career. Callers must not change it outside <see cref="Mutate{T}"/>.</summary>
    public OoCareer Career => _career;

    /// <summary>Change under the lock, then save. The action's return value is passed through.</summary>
    public T Mutate<T>(Func<OoCareer, T> action)
    {
        lock (_gate)
        {
            Mutating = true;
            T result;
            try { result = action(_career); }
            finally { Mutating = false; }
            Activate(_career);
            CatchUp(_career);
            // Every change of the odometer, kept with the game time: a week's miles are read off it.
            Finance.Sample(_career);
            Save();
            return result;
        }
    }

    /// <summary>Inside <see cref="Mutate{T}"/>: a snapshot built now may catch the career up first.</summary>
    public bool Mutating { get; private set; }

    /// <summary>
    /// Whatever the game clock and the truck have moved through since anything last looked: the Friday market, brokers
    /// paying, home life. After every change, and before a snapshot built inside one, so no endpoint can move the clock
    /// past a Friday or the truck out of home without it counting. Each part only does what it has not done yet.
    /// </summary>
    public static void CatchUp(OoCareer c)
    {
        if (!c.Started) return;
        Ledger.Advance(c);
        HomeLife.Catch(c);
        Lanes.ExpireDock(c);
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
