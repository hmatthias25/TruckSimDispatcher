using System.IO.Compression;
using System.Text.RegularExpressions;
using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Reads the player's own company-renaming mod, rather than shipping a copy of what is in it.
///
/// A mod that renames the in-game companies to real brands would otherwise leave a dedicated account
/// naming a company their game does not have. The obvious fix — ship the mapping — is the wrong one
/// twice over: it is the mod author's work rather than ours, and it goes stale the moment they publish
/// a new version. So the app reads the file the player already has.
///
/// <b>How the names are stored.</b> Each company is a plain-text definition under
/// <c>def/company/&lt;token&gt;.sui</c>, and the mod overrides it:
///
/// <code>
/// company_permanent: company.permanent.wal_mkt
/// {
///     name: "Walmart Megastore"
///     sort_name: "walmart megastore"
///     trailer_look: wallbert
/// }
/// </code>
///
/// The token on the left is base-game data — it is the company's identifier, the same in every install —
/// and <see cref="AtsCompanies.Firm.Token"/> carries it. So the join is ours and only the names come out
/// of the mod.
///
/// One company has several tokens: a store, a warehouse, a plant. They usually resolve to variations on
/// one brand, so the most common answer wins and the player can correct it. That last part matters —
/// the app proposes, the driver confirms, and nothing is filed under a name they have not seen.
/// </summary>
public static class ModCompanyNames
{
    /// <summary>ATS on Steam. The workshop keeps mods under this app id.</summary>
    public const string AtsAppId = "270880";

    public sealed record Candidate(string Path, string Name, long Bytes, string Format);

    /// <summary>ZIP, HashFS, or something we do not know.</summary>
    public static string FormatOf(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            var head = new byte[4];
            if (fs.Read(head, 0, 4) < 4) return "unknown";
            if (head[0] == 'P' && head[1] == 'K') return "zip";
            if (head[0] == 'S' && head[1] == 'C' && head[2] == 'S') return "hashfs";
            return "unknown";
        }
        catch { return "unreadable"; }
    }

    /// <summary>
    /// Steam library roots, including the ones on other drives.
    ///
    /// People put games on a second disk, and a mod reader that only looks in Program Files would tell
    /// half of them they have no mods installed.
    /// </summary>
    public static List<string> SteamLibraries()
    {
        var roots = new List<string>();
        foreach (var pf in new[]
                 {
                     Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                     Environment.GetEnvironmentVariable("ProgramFiles"),
                 })
        {
            if (string.IsNullOrWhiteSpace(pf)) continue;
            var steam = Path.Combine(pf, "Steam");
            if (Directory.Exists(steam)) roots.Add(steam);
        }

        var libs = new List<string>(roots);
        foreach (var r in roots)
        {
            var vdf = Path.Combine(r, "steamapps", "libraryfolders.vdf");
            if (!File.Exists(vdf)) continue;
            try
            {
                foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"(.+?)\""))
                    libs.Add(m.Groups[1].Value.Replace("\\\\", "\\"));
            }
            catch { /* an unreadable vdf just means fewer candidates */ }
        }

        return libs.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Every mod archive we can find, biggest first — the renaming mods are large.</summary>
    public static List<Candidate> Scan()
    {
        var found = new List<string>();

        foreach (var lib in SteamLibraries())
        {
            var ws = Path.Combine(lib, "steamapps", "workshop", "content", AtsAppId);
            if (!Directory.Exists(ws)) continue;
            try { found.AddRange(Directory.EnumerateFiles(ws, "*.scs", SearchOption.AllDirectories)); }
            catch { }
        }

        var manual = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "American Truck Simulator", "mod");
        if (Directory.Exists(manual))
        {
            try { found.AddRange(Directory.EnumerateFiles(manual, "*.scs", SearchOption.TopDirectoryOnly)); }
            catch { }
        }

        return found
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(p => new FileInfo(p))
            .Where(f => f.Exists)
            .OrderByDescending(f => f.Length)
            .Take(40)
            .Select(f => new Candidate(f.FullName, f.Name, f.Length, FormatOf(f.FullName)))
            .ToList();
    }

    public sealed class Reading
    {
        public bool Ok { get; set; }
        public string Format { get; set; } = "";
        public string Error { get; set; } = "";
        /// <summary>Vanilla company name to what this mod calls it.</summary>
        public Dictionary<string, string> Names { get; set; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>How many company definitions the archive held, mapped or not.</summary>
        public int Definitions { get; set; }
    }

    /// <summary>
    /// Pulls the renamed companies out of an archive.
    ///
    /// Only <c>def/company/</c> is touched — a few hundred kilobytes of text out of a file that is
    /// usually hundreds of megabytes of models and textures.
    /// </summary>
    public static Reading Read(string path)
    {
        var result = new Reading { Format = FormatOf(path) };

        if (!File.Exists(path)) { result.Error = "There is no file at that path."; return result; }

        if (result.Format == "hashfs")
        {
            result.Error = "That mod is packed in SCS's own HashFS format, which this build cannot open. " +
                           "Nothing is lost — the stock company names still work, and you can type what " +
                           "your game shows when the account is assigned.";
            return result;
        }
        if (result.Format != "zip")
        {
            result.Error = "That does not look like a mod archive.";
            return result;
        }

        // token -> every name this mod gives it. One company usually has several tokens: a store, a
        // warehouse, a plant, each renamed slightly differently.
        var byToken = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var zip = ZipFile.OpenRead(path);
            foreach (var entry in zip.Entries)
            {
                // The ZIP spec says forward slashes and most tools obey, but not all of them do —
                // Windows' own Compress-Archive writes backslashes. Normalise rather than trust it.
                var entryPath = entry.FullName.Replace('\\', '/');
                if (!entryPath.Contains("def/company/", StringComparison.OrdinalIgnoreCase)) continue;
                if (!entryPath.EndsWith(".sui", StringComparison.OrdinalIgnoreCase)
                    && !entryPath.EndsWith(".sii", StringComparison.OrdinalIgnoreCase)) continue;

                string text;
                using (var reader = new StreamReader(entry.Open())) text = reader.ReadToEnd();

                var token = Regex.Match(text, @"company\.permanent\.([A-Za-z0-9_]+)").Groups[1].Value;
                var name = Regex.Match(text, "(?m)^\\s*name:\\s*\"([^\"]*)\"").Groups[1].Value.Trim();
                if (token.Length == 0 || name.Length == 0) continue;

                result.Definitions++;
                if (!byToken.TryGetValue(token, out var list)) byToken[token] = list = new List<string>();
                list.Add(name);
            }
        }
        catch (Exception ex)
        {
            result.Error = $"That archive could not be read: {ex.Message}";
            return result;
        }

        if (byToken.Count == 0)
        {
            result.Error = "No company definitions in that archive — it is a mod, but not one that renames " +
                           "companies. Try another.";
            return result;
        }

        foreach (var firm in AtsCompanies.All)
        {
            var names = new List<string>();
            foreach (var prefix in firm.Token.Split('|', StringSplitOptions.RemoveEmptyEntries))
                foreach (var (token, list) in byToken)
                    if (token.Equals(prefix, StringComparison.OrdinalIgnoreCase)
                        || token.StartsWith(prefix + "_", StringComparison.OrdinalIgnoreCase))
                        names.AddRange(list);

            if (names.Count == 0) continue;

            result.Names[firm.Name] = Brand(names);
        }

        result.Ok = result.Names.Count > 0;
        if (!result.Ok)
            result.Error = $"{result.Definitions} company definitions read, but none of them matched a " +
                           "company we ship freight for. The stock names still work.";
        return result;
    }

    /// <summary>
    /// One brand out of the several names a mod gives a company's depots.
    ///
    /// A company usually has a store, a warehouse and a plant, renamed as variations on one brand:
    /// "Walmart store", "Walmart Megastore", "Walmart Logistics Centre". The shared opening words ARE
    /// the brand, so they are what comes out — "Walmart", not whichever variant happened to appear most.
    ///
    /// Where the variants share nothing — Turner Construction Group beside a stray Taylor Construction
    /// Group — there is no brand to find, and the commonest answer wins instead.
    /// </summary>
    private static string Brand(List<string> names)
    {
        var distinct = names.Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var wordLists = distinct
            .Select(x => x.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .ToList();

        var shared = new List<string>();
        for (var i = 0; i < wordLists.Min(w => w.Length); i++)
        {
            var word = wordLists[0][i];
            if (!wordLists.All(w => w[i].Equals(word, StringComparison.OrdinalIgnoreCase))) break;
            shared.Add(word);
        }

        if (shared.Count > 0) return string.Join(" ", shared);

        return names
            .GroupBy(x => x, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key.Length)
            .First().Key;
    }

    /// <summary>What to call a company, given whatever the career has learned.</summary>
    public static string Display(AppState s, AtsCompanies.Firm firm) =>
        s.Settings.ModCompanyNames.TryGetValue(firm.Name, out var real) && real.Length > 0
            ? real
            : firm.Name;
}
