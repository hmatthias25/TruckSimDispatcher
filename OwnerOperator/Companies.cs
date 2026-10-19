using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// The game's companies by every name they go by: the base game's, a renaming mod's (Real Companies and the like), and any
/// the player typed. Asked for from play: "the company brokers are all game companies, and I use the real companies mod".
///
/// A board pasted from a modded game says "Walmart" where the app knows "Wallbert", so a company hiring the driver directly
/// could not find its own freight, and a job's trade could not be read off its shipper. The mod's names are read out of
/// the player's own mod file, as the company-driver app does for dedicated accounts (Core's ModCompanyNames); typing them
/// is the fallback for a mod that cannot be opened, or a name it does not change.
/// </summary>
public static class Companies
{
    /// <summary>
    /// What the player's Real Companies list (pasted from play, 2026-10-19) says the companies that hire directly are called.
    /// Offered as a fill-in, never applied unasked: the mod's own file is the authority where it can be read.
    /// </summary>
    public static readonly Dictionary<string, string> RealCompaniesList = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Wallbert"] = "Walmart, Target, Aldi",
        ["Gallon Oil"] = "Exxon",
    };

    private static IEnumerable<string> Split(string? typed) =>
        (typed ?? "").Split(new[] { ',', '/', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Every name a game company goes by: its own, the mod's, and the ones typed.</summary>
    public static List<string> Aliases(OoCareer c, string firmName)
    {
        var list = new List<string> { firmName };
        if (c.Game.Settings.ModCompanyNames.TryGetValue(firmName, out var mod) && !string.IsNullOrWhiteSpace(mod)) list.Add(mod);
        if (c.CompanyNames.TryGetValue(firmName, out var typed)) list.AddRange(Split(typed));
        return list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>What the player's game calls a company: the first name typed, or the mod's, or the base game's.</summary>
    public static string Called(OoCareer c, string firmName) =>
        c.CompanyNames.TryGetValue(firmName, out var typed) && Split(typed).FirstOrDefault() is { } first ? first
        : c.Game.Settings.ModCompanyNames.TryGetValue(firmName, out var mod) && !string.IsNullOrWhiteSpace(mod) ? mod
        : firmName;

    /// <summary>Whether a shipper on a listing is this company, by any of its names.</summary>
    public static bool Is(OoCareer c, string firmName, string? shipper) =>
        !string.IsNullOrWhiteSpace(shipper) && Aliases(c, firmName).Any(a => Dedicated.Mentions(shipper, a));

    /// <summary>The game company behind a listing's shipper, by the base game's name first, then any other it goes by.</summary>
    public static AtsCompanies.Firm? FirmOf(OoCareer c, string? shipper)
    {
        if (string.IsNullOrWhiteSpace(shipper)) return null;
        if (AtsCompanies.Find(shipper) is { } firm) return firm;
        if (c.CompanyNames.Count == 0 && c.Game.Settings.ModCompanyNames.Count == 0) return null;
        return AtsCompanies.All.FirstOrDefault(f => Aliases(c, f.Name).Skip(1).Any(a => Dedicated.Mentions(shipper, a)));
    }

    /// <summary>The base-game name a company broker is matched on; a career from before this kept it in the name.</summary>
    public static string Base(Broker b) => b.BaseName.Length > 0 ? b.BaseName : b.Name;

    /// <summary>The companies that hire directly go by what the player's game calls them, from here on.</summary>
    public static void Apply(OoCareer c)
    {
        foreach (var b in c.Brokers.Where(b => b.Kind == "Shipper"))
        {
            if (b.BaseName.Length == 0) b.BaseName = b.Name;
            b.Name = Called(c, b.BaseName);
        }
    }

    /// <summary>The names typed in, by base-game name. Blank clears one.</summary>
    public static void SetTyped(OoCareer c, Dictionary<string, string>? names)
    {
        foreach (var (firm, typed) in names ?? new())
        {
            if (string.IsNullOrWhiteSpace(typed)) c.CompanyNames.Remove(firm);
            else c.CompanyNames[firm] = string.Join(", ", Split(typed));
        }
        Apply(c);
        OoStore.Log(c, "broker", "Company names saved: " +
            string.Join("; ", Specialties.Shippers.Select(x => $"{x.Name} is {string.Join(" or ", Aliases(c, x.Name).Skip(1).DefaultIfEmpty(x.Name))}")));
    }

    /// <summary>The companies that hire directly, by every name, for the Settings tab.</summary>
    public static object View(OoCareer c) => Specialties.Shippers.Select(x => new
    {
        name = x.Name,
        called = Called(c, x.Name),
        mod = c.Game.Settings.ModCompanyNames.TryGetValue(x.Name, out var mod) ? mod : "",
        typed = c.CompanyNames.TryGetValue(x.Name, out var typed) ? typed : "",
        listed = RealCompaniesList.TryGetValue(x.Name, out var listed) ? listed : "",
    }).ToList();
}
