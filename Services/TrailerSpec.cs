using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Naming a trailer precisely enough to go and buy one.
///
/// "Tanker" is not an instruction. A fuel tanker, a food-grade tanker and a pneumatic dry-bulk tanker
/// are different trailers, carrying different freight, needing different endorsements — and in ATS
/// they are different purchases. The app was telling drivers to "buy a tanker" and leaving the actual
/// decision to them.
/// </summary>
public static class TrailerSpec
{
    /// <summary>The tanker subtypes, with what they haul and what they need.</summary>
    public static readonly (string Key, string Label, string Hauls, bool NeedsHazmat)[] TankerKinds =
    {
        ("Fuel", "fuel tanker", "petroleum, diesel and aviation fuel", true),
        ("Chemical", "chemical tanker", "industrial liquids, usually stainless or lined", true),
        ("Food Grade", "food-grade tanker", "milk, juice and edible liquids — sanitary wash required", false),
        ("Dry Bulk", "dry bulk / pneumatic tanker", "cement, plastic pellets and flour, blown off rather than pumped", false),
        ("Gas", "gas / cryogenic tanker", "pressurised and cryogenic gases — the most specialised end", true),
    };

    /// <summary>How to refer to a trailer in a sentence the driver can act on.</summary>
    public static string Describe(string? type, string? subtype)
    {
        var t = (type ?? "").Trim();
        var sub = (subtype ?? "").Trim();
        if (!IsTanker(t)) return t.Length == 0 ? "trailer" : t.ToLowerInvariant();

        var hit = TankerKinds.FirstOrDefault(k => k.Key.Equals(sub, StringComparison.OrdinalIgnoreCase));
        return hit.Key != null ? hit.Label : "tanker";
    }

    public static bool IsTanker(string? type) =>
        (type ?? "").Trim().Equals("Tanker", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Drop and hook is an arrangement rather than a box, so it is described as one.
    ///
    /// Nothing is bought for it, nothing is loaded on it and nothing about it can be damaged — see
    /// <see cref="DropHook"/>.
    /// </summary>
    public static bool IsDropHook(string? type) => DropHook.Is(type);

    /// <summary>
    /// What to tell a driver to buy. Where the subtype is known, name it; where it genuinely is not,
    /// name the options rather than saying "tanker" and leaving them to guess.
    /// </summary>
    public static string BuyingAdvice(AppState s, string? type, string? subtype)
    {
        if (!IsTanker(type)) return "";

        var known = TankerKinds.FirstOrDefault(k => k.Key.Equals((subtype ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        if (known.Key != null)
            return $"a {known.Label} — {known.Hauls}." +
                   (known.NeedsHazmat ? " Placarded, so you need the hazmat endorsement." : "");

        // No subtype on file. Suggest what the carrier's freight actually implies, and list the rest.
        var likely = LikelyFor(s);
        var others = TankerKinds.Where(k => k.Key != likely.Key).Select(k => k.Label);
        return $"a tanker — most likely a {likely.Label} for {s.Company.Name}'s freight ({likely.Hauls}). " +
               $"The alternatives are {string.Join(", ", others)}. Set the subtype on the Fleet tab once you know.";
    }

    /// <summary>
    /// The trailer a division is pulled with. Used when the company needs to say what to go and buy,
    /// so it names an actual trailer rather than a division.
    /// </summary>
    public static (string Type, string Subtype) ForDivision(string? division)
    {
        var d = (division ?? "").Trim();
        return d.ToLowerInvariant() switch
        {
            "reefer" => ("Reefer", ""),
            "flatbed" => ("Flatbed", ""),
            "step deck" => ("Step Deck", ""),
            "heavy haul" => ("Lowboy", ""),
            "tanker" => ("Tanker", "Fuel"),
            "livestock" => ("Livestock", ""),
            "car hauler" => ("Car Hauler", ""),
            "auto" => ("Car Hauler", ""),
            "log" => ("Log", ""),
            "dump" => ("Dump", ""),
            "intermodal" => ("Dry Van", ""),
            _ => ("Dry Van", "")
        };
    }

    /// <summary>Which division a trailer type belongs to. The inverse of <see cref="ForDivision"/>.</summary>
    public static string DivisionFor(string? type) =>
        (type ?? "").Trim().ToLowerInvariant() switch
        {
            "reefer" => "Reefer",
            "flatbed" => "Flatbed",
            "step deck" => "Step Deck",
            "lowboy" => "Heavy Haul",
            "tanker" => "Tanker",
            "livestock" => "Livestock",
            "car hauler" => "Car Hauler",
            "log" => "Log",
            "dump" => "Dump",
            _ => "Dry Van"
        };

    /// <summary>The tanker a carrier's divisions and the driver's endorsements point at.</summary>
    public static (string Key, string Label, string Hauls, bool NeedsHazmat) LikelyFor(AppState s)
    {
        var divisions = string.Join(" ", s.Company.Divisions ?? new List<string>()).ToLowerInvariant();
        var name = (s.Company.Name ?? "").ToLowerInvariant();
        var hasHazmat = (s.Application?.HasHazmat ?? false) || s.Driver.Qualifications.Contains("Hazmat");

        if (name.Contains("chemical") || divisions.Contains("chemical"))
            return TankerKinds.First(k => k.Key == "Chemical");
        if (name.Contains("fuel") || name.Contains("petroleum") || name.Contains("groendyke") || name.Contains("kenan"))
            return TankerKinds.First(k => k.Key == "Fuel");
        if (divisions.Contains("food") || divisions.Contains("reefer"))
            return TankerKinds.First(k => k.Key == "Food Grade");
        if (divisions.Contains("bulk"))
            return TankerKinds.First(k => k.Key == "Dry Bulk");

        // No endorsement, no placarded freight — food grade is the one they can actually run.
        return hasHazmat ? TankerKinds.First(k => k.Key == "Fuel") : TankerKinds.First(k => k.Key == "Food Grade");
    }
}
