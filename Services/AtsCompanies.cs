using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The companies American Truck Simulator actually ships freight for.
///
/// A dedicated account has to name a real place. Asking the player to type one from memory was fine
/// while the account was just a filter string, but it is not good enough for an account the app assigns
/// — "you are dedicated to a company you have to think of yourself" is not an assignment.
///
/// So the list is shipped. It is a matter of public record rather than anything invented: names,
/// industries, the states each one has depots in and how many, as documented on the Truck Simulator
/// Wiki. Only shippers and receivers are here — the truck dealers and garages under the game's Vehicles
/// category are not places anybody runs dedicated freight for.
///
/// <b>Two filters decide what can be offered</b>, and neither is about the carrier's geography, because
/// this app does not limit carriers to states — every one of them is a 48-state common carrier.
///
///   * <b>The player's map.</b> ATS generates no cargo for a city nobody has driven to, so an account
///     with a company whose depots are all in unreached states produces no loads at all. Not thin
///     freight — none.
///   * <b>The carrier's divisions.</b> A reefer outfit's account should be food or produce; a flatbed
///     outfit's should be steel, lumber or machinery. A quarry account at a reefer carrier is nonsense
///     before geography comes into it.
///
/// Where nothing survives both filters, no account is offered and the driver is told why. Inventing one
/// against a company they can never reach is the same failure as a yard in an undiscovered city.
/// </summary>
public static class AtsCompanies
{
    /// <summary>
    /// The base game is California, Nevada and Arizona. The wiki writes those three as "Base game" in
    /// the state column, so it is expanded here rather than carried around as a special case.
    /// </summary>
    private static readonly string[] BaseGame = { "CA", "NV", "AZ" };

    /// <summary>
    /// A company freight moves for.
    ///
    /// <paramref name="Depots"/> matters as much as the states: a one-depot airport is a fine receiver
    /// and a hopeless dedicated account, because there is nowhere for the next load to come from.
    /// </summary>
    public sealed record Firm(string Name, string Category, string Industry, string[] States, int Depots,
        string Token);

    /// <summary>Fewest depots a company needs before it can carry a dedicated account on its own.</summary>
    public const int MinDepotsForDedicated = 8;

    private static string[] S(params string[] states)
    {
        var all = new List<string>();
        foreach (var x in states)
        {
            if (x == "BASE") all.AddRange(BaseGame);
            else all.Add(x);
        }
        return all.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    /// <summary>
    /// Every shipper and receiver in the game, by category, with where they are.
    ///
    /// Sourced from the Truck Simulator Wiki's company table. Nothing here is invented — if a company
    /// or a state is wrong it is a transcription error, and it should be fixed against the wiki rather
    /// than adjusted to taste.
    /// </summary>
    public static readonly Firm[] All =
    {
        // ---------------------------------------------------------------- Logistics
        new("42 Print", "Logistics", "Printing", S("BASE","AZ","AR","CO","KS","MO","MT","NM","OR","TX"), 12, "42p"),
        new("Bloomscape", "Logistics", "Landscaping products", S("BASE","AZ","NM"), 3, "blo"),
        new("EliMax", "Logistics", "General logistics", S("AR","IL","IA","KS","LA","MO","NE","OK","TX"), 23, "elm"),
        new("Enterpriser", "Logistics", "General logistics", S("BASE","AZ","AR","CO","ID","IL","KS","LA","MO","MT","NE","NV","NM","OK","OR","TX","UT","WA","WY"), 52, "ent"),
        new("Equos Power Transport", "Logistics", "General logistics", S("AR","IL","IA","KS","LA","MO","NE","OK","TX"), 27, "equ"),
        new("GARC Railroads", "Logistics", "Railway logistics", S("AR","IL","KS","LA","NE","TX"), 11, "gar|garc"),
        new("MWM", "Logistics", "Waste management", S("BASE","AR","IL","IA","KS","LA","MO","MT","NE","OK","TX","WY"), 21, "mwm"),
        new("Rail Export", "Logistics", "Railway logistics", S("BASE","AZ","CO","ID","MT","NV","NM","OR","UT","WA","WY"), 23, "re"),
        new("Rock Port", "Logistics", "Port logistics", S("AR","IL","IA","LA","MO","OK"), 13, "rp"),
        new("Sell Goods", "Logistics", "General logistics", S("BASE","AZ","CO","ID","MT","NV","NM","OR","UT","WA","WY"), 31, "sg"),
        new("Starbridge", "Logistics", "General logistics", S("BASE","AZ","CO","MT","NV","NM","OR","UT","WA","WY"), 23, "sb"),
        new("Terrastore", "Logistics", "General logistics", S("IL","MO"), 5, "trs"),
        new("Ultimus", "Logistics", "Airport logistics", S("BASE","CO","IL","KS","NM","TX"), 7, "aport_ult"),
        new("Venture", "Logistics", "General logistics", S("BASE","AZ","AR","CO","ID","IL","IA","KS","LA","MO","MT","NE","NV","NM","OK","OR","TX","UT","WA","WY"), 47, "ven"),
        new("Walden's Landscape Supplies", "Logistics", "Landscaping products", S("BASE","IL","KS","LA","MT","NE","OK","TX"), 10, "wld"),
        new("WDS", "Logistics", "Waste management", S("BASE","AZ","NM"), 3, "wds"),

        // ---------------------------------------------------------------- Food
        new("Bushnell Farms", "Food", "Livestock farming", S("BASE","AZ","CO","ID","MT","NM","OR","UT","WA","WY"), 39, "bn"),
        new("Calimondo", "Food", "Almond farming", S("BASE"), 3, "cal_farm"),
        new("Evergreen", "Food", "Farming", S("AR","IL","IA","LA","MO","NE"), 11, "evg"),
        new("Farmer's Barn", "Food", "Animal feed processing and retail", S("BASE","AZ","AR","CO","ID","IL","IA","KS","LA","MO","MT","NE","OK","TX","UT","WY"), 46, "fb"),
        new("Fish Tail Foods", "Food", "Food processing", S("BASE","TX","WA"), 3, "ftf"),
        new("Flavorfair", "Food", "Food processing", S("AR","IL","IA","KS","LA","MO","NE"), 36, "flv"),
        new("Global Mills", "Food", "Food processing and distribution", S("BASE","CO","KS","MT","NM","OK","OR","TX","UT","WA"), 37, "gm"),
        new("Golden Meadows", "Food", "Crop farming", S("AR","IL","IA","LA","KS","MO","NE","OK","TX"), 28, "gld"),
        new("Grand Pastures", "Food", "Livestock farming", S("AR","IL","KS","MO","NE","OK","TX"), 27, "gp"),
        new("Mon Coeur", "Food", "Winemaking", S("BASE","AZ","ID","NE","OR","TX"), 15, "mon"),
        new("Sunshine Crops", "Food", "Crop farming", S("BASE","AZ","CO","ID","MT","NV","NM","OR","UT","WA","WY"), 52, "sc"),
        new("Sweet Beets", "Food", "Sugar production", S("MT","NE"), 3, "swb"),
        new("USBB", "Food", "Beverages", S("BASE","AR","CO","LA","MO","MT","NM","TX","WY"), 13, "usb"),

        // ---------------------------------------------------------------- Energy
        new("Aron", "Energy", "Gas stations", S("BASE","AR","IL","IA","KS","LA","MO","OR","TX","UT","WA"), 14, "aro"),
        new("Driverse", "Energy", "Gas stations", S("BASE","AR","IA","KS","MO","MT","TX","UT","WY"), 14, "dri"),
        new("Elegrid", "Energy", "Electric power", S("BASE"), 4, "ele"),
        new("Faraday Energy", "Energy", "Electric power", S("AR","IL","IA","KS","LA","MO","MT","NE","OK","TX"), 27, "frd"),
        new("Gallon Oil", "Energy", "Fuel production and gas stations", S("BASE","AR","AZ","CO","IA","KS","MO","MT","NE","NV","OK","OR","TX","UT","WA","WY"), 27, "gal_oil"),
        new("GreenPetrol", "Energy", "Gas stations", S("AZ","MO","MT"), 3, "grp"),
        new("Haulett", "Energy", "Gas stations", S("AZ","CO","ID","KS","NE","NV","OK","TX","WA","WY"), 16, "hau"),
        new("NAF", "Energy", "Gas stations", S("CO","IL","OR"), 3, "naf"),
        new("Petrolucent", "Energy", "Oil extraction", S("KS","OK","TX"), 11, "pet"),
        new("Phoenix", "Energy", "Gas stations", S("BASE","AR","CO","ID","IL","KS","LA","MO","MT","NE","NV","NM","OK","TX","UT","WA"), 23, "pho"),
        new("Vitas Power", "Energy", "Wind turbine manufacturing", S("BASE","CO","IL","IA","KS","MO","OK","TX","WY"), 23, "vp"),
        new("Vortex", "Energy", "Fuel production and gas stations", S("BASE","AR","IL","IA","KS","LA","MO","NE","OK","TX"), 31, "vor"),
        new("WP", "Energy", "Gas stations", S("BASE","IA","LA"), 5, "wp"),

        // ---------------------------------------------------------------- Retail
        new("Charged", "Retail", "Electronics", S("AZ","NV","NM","UT","WA"), 8, "cha"),
        new("Dr. Hammer", "Retail", "Home goods", S("AR","IL","IA","LA"), 7, "drh"),
        new("Eddy's", "Retail", "Grocery", S("AZ","ID","NV","NM","OR","UT","WA","WY"), 29, "ed"),
        new("Home Store", "Retail", "Home goods", S("AZ","CO","ID","KS","MO","MT","NM","OK","OR","TX","UT","WA","WY"), 43, "hs"),
        new("Myroo", "Retail", "Home goods", S("AR","IL","IA","KS","LA","MO","NE","OK"), 12, "myr"),
        new("Pickit", "Retail", "Grocery", S("AR","IL","KS","LA","MO","NE","OK","TX"), 15, "pic"),
        new("Shop Town", "Retail", "General merchandise", S("AZ","AR","CO","ID","IL","IA","KS","LA","MO","MT","NE","NV","NM","OK","OR","TX","UT","WA","WY"), 58, "sht"),
        new("Tidbit", "Retail", "Grocery", S("AZ","CO","MT","NM","OR","WA"), 18, "tid"),
        new("Wallbert", "Retail", "General merchandise", S("AZ","AR","CO","ID","IL","IA","KS","LA","MO","MT","NE","NV","NM","OK","OR","TX","UT","WA","WY"), 59, "wal"),

        // ---------------------------------------------------------------- Construction
        new("American Lines", "Construction", "Railroad construction", S("AZ","MT","NE","NM","WY"), 13, "aml"),
        new("Apex Steel", "Construction", "Metal processing", S("AR","IL","IA","LA"), 11, "apx"),
        new("Avalanche Steel", "Construction", "Metal processing", S("AZ","CO","ID","KS","MT","NE","NM","OK","OR","TX","UT","WA","WY"), 33, "avs"),
        new("Azure Glasswork", "Construction", "Glass manufacturing", S("AR","LA","TX"), 6, "az"),
        new("Bitumen", "Construction", "Roadworks", S("AZ","CO","ID","MT","NM","UT","WA","WY"), 46, "bit"),
        new("Buildmaster Manufacturing Company", "Construction", "Building materials production", S("IA","KS","LA","MO"), 5, "bm"),
        new("Central Civil Works", "Construction", "Public works", S("AR","IL","IA","KS","LA","MO","NE","OK"), 11, "ccw"),
        new("ElectraVolt", "Construction", "Electronics manufacturing", S("ID","KS","MO","OK"), 6, "elv"),
        new("Johnson & Smith", "Construction", "Railroad construction", S("IA","KS","LA","MO","NE","OK","TX"), 13, "jns"),
        new("Mary's Cotton", "Construction", "Cotton farming", S("AR","OK","TX"), 8, "mr"),
        new("Nielsen Roads", "Construction", "Roadworks", S("AR","IL","IA","KS","LA","MO","NE","TX"), 38, "nls"),
        new("Olthon Homes", "Construction", "House construction", S("ID","OK","OR","TX","WY"), 7, "oh"),
        new("Plaster & Sons", "Construction", "Building construction", S("AZ","CO","ID","MT","NV","NM","OR","UT","WA","WY"), 76, "pns"),
        new("Steeler", "Construction", "Metal processing", S("AZ","CO","ID","KS","MO","MT","NE","OK","OR","TX","WA","WY"), 34, "st_met"),
        new("Taylor Construction Group", "Construction", "Building construction", S("AR","IL","IA","KS","LA","MO","NE","OK","TX"), 54, "tay"),
        new("Technoma", "Construction", "Electronics manufacturing", S("AZ","AR","IA","KS","OK"), 6, "tch"),

        // ---------------------------------------------------------------- Chemical
        new("Chemso Ltd.", "Chemical", "Chemical works", S("AZ","ID","MT","NM","OR","UT","WY"), 13, "chm"),
        new("EPRO Gas", "Chemical", "Chemical works", S("AR","IL","IA","KS","LA","MO","NE","OK"), 15, "eg"),
        new("Gastream", "Chemical", "Chemical works", S("AZ","NV"), 7, "gas"),
        new("Syntetico", "Chemical", "Chemical works", S("AR","IL","IA","LA","MO","NE","OK","TX"), 17, "syn"),

        // ---------------------------------------------------------------- Wood
        new("Chuck & Jack's", "Wood", "Logging and sawmill", S("AR","IL","IA","LA","MO","TX"), 21, "ch_wd"),
        new("Deepgrove Forest Products", "Wood", "Logging and sawmill", S("AZ","CO","ID","MT","OR","WA","WY"), 44, "dg_wd"),
        new("Heartwood Furniture", "Wood", "Furniture manufacturing", S("AR","IA","KS","MO","OR","TX","WY"), 12, "hf"),
        new("Page & Price Paper", "Wood", "Papermaking", S("AR","ID","IL","KS","LA","OK","OR","WA"), 15, "pnp"),

        // ---------------------------------------------------------------- Quarrying
        new("Coastline Mining", "Quarrying", "Quarrying", S("AZ","ID","NV","NM","OR","UT","WA"), 48, "cm"),
        new("NAMIQ", "Quarrying", "Quarrying", S("AR","CO","IL","IA","KS","LA","MO","MT","NE","NM","OK","TX","WY"), 61, "nmq"),
    };

    /// <summary>
    /// Which of the carrier's divisions a company's freight would move under.
    ///
    /// Deliberately generous: most freight moves in a van, so a carrier that runs Dry Van can serve
    /// nearly anybody. It is the specialised divisions that narrow it — a tanker outfit wants chemical
    /// and fuel, a flatbed outfit wants steel and lumber.
    /// </summary>
    public static string[] DivisionsFor(Firm f) => f.Category switch
    {
        "Chemical" => new[] { "Tanker", "Bulk" },
        "Quarrying" => new[] { "Flatbed", "Bulk", "Heavy Haul", "Dump" },
        "Wood" => new[] { "Flatbed", "Log", "Dry Van" },
        "Construction" => f.Industry.Contains("Electronics", StringComparison.OrdinalIgnoreCase)
            ? new[] { "Dry Van" }
            : new[] { "Flatbed", "Heavy Haul", "Bulk", "Dry Van" },
        "Energy" => f.Industry.Contains("Wind turbine", StringComparison.OrdinalIgnoreCase)
            ? new[] { "Heavy Haul", "Flatbed" }
            : f.Industry.Contains("Electric power", StringComparison.OrdinalIgnoreCase)
                ? new[] { "Flatbed", "Heavy Haul" }
                : new[] { "Tanker", "Dry Van" },
        "Food" => f.Industry.Contains("Livestock", StringComparison.OrdinalIgnoreCase)
            ? new[] { "Livestock", "Dry Van" }
            : f.Industry.Contains("Crop", StringComparison.OrdinalIgnoreCase)
              || f.Industry.Contains("farming", StringComparison.OrdinalIgnoreCase)
                ? new[] { "Bulk", "Dry Van", "Reefer" }
                : new[] { "Reefer", "Dry Van" },
        "Retail" => f.Industry.Contains("Grocery", StringComparison.OrdinalIgnoreCase)
            ? new[] { "Reefer", "Dry Van" }
            : new[] { "Dry Van", "Intermodal" },
        _ => new[] { "Dry Van", "Intermodal", "Reefer" },     // Logistics and anything unclassified
    };

    /// <summary>States the driver has actually driven to, which is where freight can exist at all.</summary>
    public static HashSet<string> ReachedStates(AppState s) =>
        s.Discovered
            .Select(d => (d.State ?? "").Trim().ToUpperInvariant())
            .Where(x => x.Length == 2)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Companies this driver could actually be put on, best first.
    ///
    /// Ordered by how much of the company is inside the reached map rather than by raw size — a
    /// sixty-depot company the driver can only touch in one state is a worse account than a
    /// twenty-depot one they can reach everywhere.
    /// </summary>
    public static List<Firm> Candidates(AppState s)
    {
        var reached = ReachedStates(s);
        if (reached.Count == 0) return new List<Firm>();

        var divisions = s.Company.Divisions ?? new List<string>();

        return All
            .Where(f => f.Depots >= MinDepotsForDedicated)
            .Where(f => f.States.Any(reached.Contains))
            .Where(f => divisions.Count == 0
                        || DivisionsFor(f).Any(d => divisions.Any(cd => cd.Equals(d, StringComparison.OrdinalIgnoreCase))))
            .OrderByDescending(f => f.States.Count(reached.Contains))
            .ThenByDescending(f => f.Depots)
            .ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Look one up by name, however the player wrote it.</summary>
    public static Firm? Find(string? name)
    {
        var n = (name ?? "").Trim();
        return n.Length == 0
            ? null
            : All.FirstOrDefault(f => f.Name.Equals(n, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Where a company can be reached, as a driver would want it read back.</summary>
    public static string Reach(AppState s, Firm f)
    {
        var reached = ReachedStates(s);
        var hit = f.States.Where(reached.Contains).OrderBy(x => x).ToList();
        return hit.Count == 0
            ? $"{f.Depots} depots, none in a state you have driven"
            : $"{f.Depots} depots, {hit.Count} of your states: {string.Join(", ", hit)}";
    }
}
