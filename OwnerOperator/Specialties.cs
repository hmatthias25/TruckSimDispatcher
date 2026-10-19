using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// The specialist trades, the trailers they need, and the game's companies that hire the owner/operator directly.
/// Decided with the project owner on 2026-10-18; see the plan, "Generalists, specialists and the shippers themselves".
/// </summary>
public static class Specialties
{
    public const string General = "General";
    public const string Agriculture = "Agriculture";
    public const string Fuel = "Fuel and petroleum";
    public const string Lumber = "Lumber and forest products";
    public const string Construction = "Construction and steel";

    public static readonly string[] All = { Agriculture, Fuel, Lumber, Construction };

    /// <summary>The trailers a specialty's freight goes on. A specialist will not take a carrier without one.</summary>
    public static string[] Trailers(string specialty) => specialty switch
    {
        Agriculture => new[] { "Hopper", "Dry Van", "Reefer", "Livestock" },
        Fuel => new[] { "Tanker" },
        Lumber => new[] { "Log", "Flatbed" },
        Construction => new[] { "Flatbed", "Step Deck", "Lowboy" },
        _ => Array.Empty<string>(),
    };

    /// <summary>ADR a specialty's freight needs. Fuel is flammable liquids.</summary>
    public static string? Adr(string specialty) => specialty == Fuel ? "Flammable liquids" : null;

    /// <summary>The trailers a player can own. Power-only is no trailer at all.</summary>
    public static readonly string[] OwnableTrailers =
        { "Dry Van", "Reefer", "Flatbed", "Step Deck", "Lowboy", "Tanker", "Log", "Livestock", "Hopper", "Dump", "Container" };

    /// <summary>
    /// Which trade a listing belongs to: the shipping company's industry where the game knows it, otherwise the
    /// trailer the listing names. General where neither says.
    /// </summary>
    public static string Of(BoardLoad l) => Of(null, l);

    /// <summary>The same, knowing the career's company names: a renaming mod's "Exxon" is Gallon Oil, and fuel.</summary>
    public static string Of(OoCareer? c, BoardLoad l)
    {
        var firm = c != null ? Companies.FirmOf(c, l.Shipper) : AtsCompanies.Find(l.Shipper);
        if (firm != null)
        {
            var ind = firm.Industry.ToLowerInvariant();
            if (ind.Contains("farm") || ind.Contains("crop") || ind.Contains("feed") || ind.Contains("livestock")) return Agriculture;
            if (firm.Category is "Chemical" || ind.Contains("fuel") || ind.Contains("gas station")) return Fuel;
            if (firm.Category is "Wood") return Lumber;
            if (firm.Category is "Construction" or "Quarrying") return Construction;
        }
        return (l.TrailerType ?? "").Trim() switch
        {
            "Tanker" => Fuel,
            "Log" => Lumber,
            "Hopper" or "Livestock" => Agriculture,
            "Step Deck" or "Lowboy" => Construction,
            _ => General,
        };
    }

    /// <summary>Why the carrier cannot run this trade yet: the trailer, and the ADR where it is needed. Null when it can.</summary>
    public static string? Missing(OoCareer c, string specialty)
    {
        if (specialty == General) return null;
        var hooked = DispatchEngine.AssignedTrailer(c.Game)?.Type ?? "";
        var need = new List<string>();
        if (!Trailers(specialty).Contains(hooked, StringComparer.OrdinalIgnoreCase))
            need.Add($"a {string.Join(" or ", Trailers(specialty)).ToLowerInvariant()} trailer of your own");
        if (Adr(specialty) is { } adr && !c.Profile.Skills.Adr.Contains(adr, StringComparer.OrdinalIgnoreCase))
            need.Add($"ADR for {adr.ToLowerInvariant()}");
        return need.Count == 0 ? null : string.Join(" and ", need);
    }

    /// <summary>The companies that hire directly, with the trade each belongs to.</summary>
    public static readonly (string Name, string Specialty)[] Shippers =
    {
        ("Wallbert", General), ("Shop Town", General),
        ("Plaster & Sons", Construction), ("Taylor Construction Group", Construction),
        ("Sunshine Crops", Agriculture), ("Farmer's Barn", Agriculture),
        ("Vortex", Fuel), ("Gallon Oil", Fuel),
    };

    /// <summary>A listing that is this company's own freight, the way a dedicated account reads one.</summary>
    public static bool IsShippersOwn(OoCareer c, Broker shipper, BoardLoad l) => Companies.Is(c, Companies.Base(shipper), l.Shipper);
}
