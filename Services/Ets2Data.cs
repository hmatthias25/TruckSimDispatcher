namespace TruckSimDispatcher.Services;

/// <summary>
/// Everything about Euro Truck Simulator 2 that differs from ATS, as data. Step 3 of ETS2 support (#266,
/// #269). <see cref="GameProfile.Ets2"/> points at it the way <see cref="GameProfile.Ats"/> points at the
/// ATS tables.
///
/// <para>The large tables — the freight markets, the country centres and the companies — are generated
/// (<c>Ets2Data.Generated.cs</c>), from the Truck Simulator Wiki, ProMods' own city list and GeoNames. What is
/// here is written by hand: the countries and where they come from, time zones, fuel, the ADR classes,
/// the dealer trucks, trailer makes, the starting companies and the carriers.</para>
///
/// <para><b>Divisions keep their ATS names for now.</b> A carrier runs "Dry Van", "Reefer", "Flatbed" and the
/// rest, because those strings run through the whole app. A curtainsider and a box trailer are Dry Van here,
/// a low loader is Heavy Haul. Trailer types get a list per game in a later step; until then the European
/// trailers sit on the nearest US name.</para>
///
/// <para><b>Pay is still per mile.</b> The rates below are European per-km rates written per mile, so they
/// read correctly once the units show km. The pay model itself — salary, hourly or per km — is #274.</para>
/// </summary>
internal static partial class Ets2Data
{
    // ------------------------------------------------------------------ countries

    /// <summary>
    /// Every country an ETS2 career can run, grouped by where it comes from: the base game, each SCS map
    /// DLC, ProMods, and the ProMods Middle-East add-on. All of them are on by default — a country you do
    /// not have installed lists no jobs, so leaving it ticked costs nothing, and the switch is there for
    /// somebody who would rather not drive to Iceland.
    ///
    /// Codes are ISO 3166 alpha-2, which is what the player types for a city's country, except UK (the
    /// game's own code; GeoNames says GB) and XK for Kosovo. Northern Ireland is part of UK, as in ProMods.
    /// </summary>
    internal static readonly (string Key, string Title, string Note)[] Groups =
    {
        ("Base game", "Base game", ""),
        ("Going East!", "Going East!", ""),
        ("Scandinavia", "Scandinavia", "Nordic Horizons adds the north of Norway, Sweden and Finland."),
        ("Beyond the Baltic Sea", "Beyond the Baltic Sea", ""),
        ("Road to the Black Sea", "Road to the Black Sea", ""),
        ("Iberia", "Iberia", ""),
        ("West Balkans", "West Balkans", ""),
        ("Greece", "Greece", ""),
        ("Iceland", "Iceland", "Announced by SCS, and in ProMods."),
        ("ProMods", "ProMods", "Countries ProMods: Europe adds. Leave them on if you run it, or switch them off."),
        ("ProMods Middle-East", "ProMods Middle-East", "The separate ProMods Middle-East add-on."),
    };

    internal static readonly IReadOnlyList<MapCoverage.Region> Regions = new List<MapCoverage.Region>
    {
        new("AT", "Austria", "Base game"), new("BE", "Belgium", "Base game"), new("CZ", "Czechia", "Base game"),
        new("FR", "France", "Base game"), new("DE", "Germany", "Base game"), new("IT", "Italy", "Base game"),
        new("LU", "Luxembourg", "Base game"), new("NL", "Netherlands", "Base game"), new("PL", "Poland", "Base game"),
        new("SK", "Slovakia", "Base game"), new("CH", "Switzerland", "Base game"), new("UK", "United Kingdom", "Base game"),
        new("HU", "Hungary", "Going East!"),
        new("DK", "Denmark", "Scandinavia"), new("NO", "Norway", "Scandinavia"), new("SE", "Sweden", "Scandinavia"),
        new("EE", "Estonia", "Beyond the Baltic Sea"), new("LV", "Latvia", "Beyond the Baltic Sea"),
        new("LT", "Lithuania", "Beyond the Baltic Sea"), new("FI", "Finland", "Beyond the Baltic Sea"),
        new("RU", "Russia", "Beyond the Baltic Sea"),
        new("RO", "Romania", "Road to the Black Sea"), new("BG", "Bulgaria", "Road to the Black Sea"),
        new("TR", "Türkiye", "Road to the Black Sea"),
        new("ES", "Spain", "Iberia"), new("PT", "Portugal", "Iberia"),
        new("AL", "Albania", "West Balkans"), new("BA", "Bosnia and Herzegovina", "West Balkans"),
        new("HR", "Croatia", "West Balkans"), new("XK", "Kosovo", "West Balkans"), new("ME", "Montenegro", "West Balkans"),
        new("MK", "North Macedonia", "West Balkans"), new("RS", "Serbia", "West Balkans"), new("SI", "Slovenia", "West Balkans"),
        new("GR", "Greece", "Greece"),
        new("IS", "Iceland", "Iceland"),
        new("AX", "Åland Islands", "ProMods"), new("AD", "Andorra", "ProMods"), new("CY", "Cyprus", "ProMods"),
        new("FO", "Faroe Islands", "ProMods"), new("GE", "Georgia", "ProMods"), new("GL", "Greenland", "ProMods"),
        new("GG", "Guernsey", "ProMods"), new("IE", "Ireland", "ProMods"), new("IM", "Isle of Man", "ProMods"),
        new("JE", "Jersey", "ProMods"), new("LI", "Liechtenstein", "ProMods"), new("MT", "Malta", "ProMods"),
        new("MD", "Moldova", "ProMods"), new("MC", "Monaco", "ProMods"), new("SJ", "Svalbard", "ProMods"),
        new("UA", "Ukraine", "ProMods"),
        new("EG", "Egypt", "ProMods Middle-East"), new("IQ", "Iraq", "ProMods Middle-East"),
        new("IL", "Israel", "ProMods Middle-East"), new("JO", "Jordan", "ProMods Middle-East"),
        new("LB", "Lebanon", "ProMods Middle-East"), new("PS", "Palestine", "ProMods Middle-East"),
        new("SA", "Saudi Arabia", "ProMods Middle-East"), new("SY", "Syria", "ProMods Middle-East"),
    };

    /// <summary>The countries every copy of ETS2 has, before any map DLC.</summary>
    internal static readonly string[] BaseGame = { "AT", "BE", "CZ", "FR", "DE", "IT", "LU", "NL", "PL", "SK", "CH", "UK" };

    // ------------------------------------------------------------------ time

    /// <summary>
    /// Standard time, as hours ahead of UTC. Only differences are used, and only when the career has
    /// time zones switched on. No summer time — the game has none either. Russia is Moscow time (its
    /// Kaliningrad corner is an hour behind that); Türkiye, Jordan and Syria keep UTC+3 all year.
    /// </summary>
    internal static readonly Dictionary<string, int> Zones = new(StringComparer.OrdinalIgnoreCase)
    {
        ["UK"] = 0, ["IE"] = 0, ["PT"] = 0, ["IS"] = 0, ["FO"] = 0, ["GG"] = 0, ["JE"] = 0, ["IM"] = 0,
        ["GL"] = -2,
        ["AT"] = 1, ["BE"] = 1, ["CZ"] = 1, ["FR"] = 1, ["DE"] = 1, ["IT"] = 1, ["LU"] = 1, ["NL"] = 1, ["PL"] = 1,
        ["SK"] = 1, ["CH"] = 1, ["HU"] = 1, ["DK"] = 1, ["NO"] = 1, ["SE"] = 1, ["ES"] = 1, ["AL"] = 1, ["BA"] = 1,
        ["HR"] = 1, ["XK"] = 1, ["ME"] = 1, ["MK"] = 1, ["RS"] = 1, ["SI"] = 1, ["AD"] = 1, ["MC"] = 1, ["MT"] = 1,
        ["LI"] = 1, ["SJ"] = 1,
        ["EE"] = 2, ["LV"] = 2, ["LT"] = 2, ["FI"] = 2, ["AX"] = 2, ["RO"] = 2, ["BG"] = 2, ["GR"] = 2, ["CY"] = 2,
        ["MD"] = 2, ["UA"] = 2, ["EG"] = 2, ["IL"] = 2, ["LB"] = 2, ["PS"] = 2,
        ["RU"] = 3, ["TR"] = 3, ["JO"] = 3, ["SY"] = 3, ["IQ"] = 3, ["SA"] = 3,
        ["GE"] = 4,
    };

    internal static readonly Dictionary<int, string> ZoneNames = new()
    {
        [-2] = "WGT", [0] = "WET", [1] = "CET", [2] = "EET", [3] = "MSK", [4] = "GET",
    };

    // ------------------------------------------------------------------ fuel

    /// <summary>Real-world diesel, 28 September 2026, in euros per litre. EU countries off the EU Weekly
    /// Oil Bulletin as published by fuel-prices.eu; the UK, Switzerland, Norway, Serbia, Türkiye, Ukraine,
    /// Moldova, Georgia, Albania and Bosnia off the same week's national figures. The rest are estimates —
    /// marked — and are only ever a starting point: the app learns a country's real price from receipts.</summary>
    private static readonly Dictionary<string, double> DieselPerLitre = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MT"] = 1.210, ["BG"] = 1.928, ["HU"] = 1.932, ["CY"] = 2.023, ["SI"] = 2.011, ["HR"] = 2.036, ["PL"] = 2.060,
        ["SK"] = 1.978, ["CZ"] = 2.076, ["LU"] = 2.095, ["RO"] = 2.104, ["EE"] = 2.239, ["ES"] = 1.934, ["LT"] = 2.253,
        ["AT"] = 2.259, ["IE"] = 2.123, ["BE"] = 2.430, ["LV"] = 2.133, ["PT"] = 2.186, ["IT"] = 2.351, ["GR"] = 2.216,
        ["FR"] = 2.371, ["FI"] = 2.523, ["DE"] = 2.437, ["NL"] = 2.526, ["DK"] = 2.542, ["SE"] = 2.135,
        ["UK"] = 2.341, ["CH"] = 2.560, ["NO"] = 2.610, ["RS"] = 2.010, ["TR"] = 1.730, ["UA"] = 1.940, ["MD"] = 1.830,
        ["GE"] = 1.410, ["AL"] = 2.313, ["BA"] = 1.930,
        // estimates
        ["IS"] = 2.40, ["ME"] = 1.90, ["MK"] = 1.75, ["XK"] = 1.90, ["RU"] = 0.75, ["LI"] = 2.56, ["AD"] = 1.60,
        ["MC"] = 2.37, ["AX"] = 2.52, ["SJ"] = 1.50, ["FO"] = 1.90, ["GL"] = 1.60, ["GG"] = 2.20, ["JE"] = 2.20,
        ["IM"] = 2.30, ["EG"] = 0.40, ["IQ"] = 0.40, ["IL"] = 2.00, ["JO"] = 0.90, ["LB"] = 1.00, ["PS"] = 2.00,
        ["SA"] = 0.45, ["SY"] = 0.80,
    };

    /// <summary>The EU's unweighted mean that week, which the index is relative to.</summary>
    internal const double ReferencePerLitre = 2.20;

    internal static readonly Dictionary<string, double> FuelIndex =
        DieselPerLitre.ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value / ReferencePerLitre, 3), StringComparer.OrdinalIgnoreCase);

    /// <summary>The reference price, stored per US gallon like everything else (shown per litre).</summary>
    internal const decimal DefaultFuelPricePerGallon = 8.33m;      // €2.20/L x 3.785
    internal const string FuelPriceBasis = "EU Weekly Oil Bulletin week of 28 Sep 2026, EU mean €2.20/L";

    // ------------------------------------------------------------------ dangerous goods

    /// <summary>ADR classes, as ETS2 unlocks them in the skill tree — the same six as ATS's HazMat.</summary>
    internal static readonly Endorsements.HazClass[] Adr =
    {
        new("1", "ADR class 1 — Explosives", "explosive substances and articles", "explosives, fireworks"),
        new("2", "ADR class 2 — Gases", "compressed, liquefied and dissolved gases", "acetylene, chlorine, propane"),
        new("3", "ADR class 3 — Flammable liquids", "flammable liquids, which is most fuel haulage", "diesel, petrol, kerosene"),
        new("4", "ADR class 4 — Flammable solids", "flammable solids and self-reactive substances", "sulphur, magnesium"),
        new("6", "ADR class 6 — Toxic substances", "toxic and infectious substances", "pesticides, cyanides"),
        new("8", "ADR class 8 — Corrosives", "corrosive substances", "acids, alkalis"),
    };

    // ------------------------------------------------------------------ tax

    /// <summary>One flat band. A real per-country payroll is out of scope; #274 decides what an EU payslip
    /// takes. Until then an ETS2 career is taxed at a flat 20% with no regional rate.</summary>
    internal static readonly (decimal Upto, decimal Rate)[] FlatIncomeTax = { (decimal.MaxValue, 0.20m) };
    internal static readonly Dictionary<string, decimal> NoRegionTax = new(StringComparer.OrdinalIgnoreCase);

    // ------------------------------------------------------------------ companies a career can start as

    internal static readonly (string Name, string Code, string Division, string City, string State, string Motto)[] StartingCompanies =
    {
        ("Eurocross Logistics",   "ECL", "Dry Van",    "Frankfurt am Main", "DE", "Every border, on time."),
        ("Nordkyl Transport",     "NKT", "Reefer",     "Malmö",             "SE", "Kept cold, kept moving."),
        ("Stahlwerk Spedition",   "SWS", "Flatbed",    "Dortmund",          "DE", "Strapped, sheeted, delivered."),
        ("Maas Bulk Lines",       "MBL", "Tanker",     "Rotterdam",         "NL", "Bulk done right."),
        ("Alpine Heavy Haul",     "AHH", "Heavy Haul", "Graz",              "AT", "Nothing is too big."),
        ("Meseta Livestock",      "MLT", "Livestock",  "Salamanca",         "ES", "Animals first."),
        ("Taiga Timber Haulage",  "TTH", "Log",        "Kuopio",            "FI", "Out of the forest, on time."),
        ("Torino Auto Transport", "TAT", "Auto",       "Torino",            "IT", "Every unit arrives clean."),
    };

    // ------------------------------------------------------------------ dealer trucks

    // What the ETS2 dealers sell: seven brands, in the configurations a company actually buys. Governed at
    // 90 km/h (56 mph) — the EU speed limiter on every truck over 3.5 tonnes. Fuel in US gallons and economy
    // in miles per US gallon like every other figure; they read as litres and L/100 km on screen.
    internal static readonly Seed.TruckSpec[] TrucksAutomatic =
    {
        new("Volvo",         "FH",       2023, "Volvo D13K 500",          500, "I-Shift 12-spd",           "automatic", "Sleeper", 56, 211, 8.1, 5),
        new("Scania",        "S",        2023, "Scania DC13 500",         500, "Opticruise GRS905R 12+2",  "automatic", "Sleeper", 56, 211, 8.2, 5),
        new("DAF",           "XG",       2023, "PACCAR MX-13 480",        480, "TraXon 12-spd",            "automatic", "Sleeper", 56, 211, 8.4, 4),
        new("Mercedes-Benz", "Actros L", 2022, "OM471 480",               480, "PowerShift 3 12-spd",      "automatic", "Sleeper", 56, 198, 8.3, 4),
        new("MAN",           "TGX",      2022, "MAN D2676 470",           470, "TipMatic 12-spd",          "automatic", "Sleeper", 56, 198, 8.0, 4),
        new("Iveco",         "S-Way",    2021, "Cursor 13 490",           490, "Hi-Tronix 12-spd",         "automatic", "Sleeper", 56, 198, 7.8, 3),
        new("Renault",       "T",        2021, "DTI 13 480",              480, "Optidriver 12-spd",        "automatic", "Sleeper", 56, 198, 7.9, 3),
        new("DAF",           "XF",       2019, "PACCAR MX-13 460",        460, "TraXon 12-spd",            "automatic", "Sleeper", 56, 185, 7.7, 2),
        new("Scania",        "R",        2018, "Scania DC13 450",         450, "Opticruise GRS905R 12+2",  "automatic", "Sleeper", 56, 185, 7.6, 2),
        new("Mercedes-Benz", "Actros",   2016, "OM471 450",               450, "PowerShift 3 12-spd",      "automatic", "Sleeper", 56, 185, 7.4, 1),
        new("Iveco",         "Stralis",  2016, "Cursor 11 460",           460, "Hi-Tronix 12-spd",         "automatic", "Sleeper", 56, 185, 7.2, 1),
    };

    internal static readonly Seed.TruckSpec[] TrucksManual =
    {
        new("Scania",  "R",      2020, "Scania DC13 500",  500, "GRSO905 manual 12+2",   "manual", "Sleeper", 56, 211, 7.8, 4),
        new("Volvo",   "FH16",   2020, "Volvo D16K 650",   650, "I-Shift manual 14-spd", "manual", "Sleeper", 56, 238, 6.9, 4),
        new("MAN",     "TGX",    2018, "MAN D2676 500",    500, "ZF 16-spd manual",      "manual", "Sleeper", 56, 198, 7.5, 3),
        new("Renault", "Magnum", 2013, "DXi 13 520",       520, "ZF 16-spd manual",      "manual", "Sleeper", 56, 198, 7.0, 2),
    };

    /// <summary>What a five-star carrier issues.</summary>
    internal static readonly Seed.TruckSpec[] TrucksShowcase =
    {
        new("Scania", "S",    2024, "Scania DC16 770 V8", 770, "Opticruise GRS905R 12+2", "automatic", "Sleeper", 56, 238, 7.2, 5),
        new("Volvo",  "FH16", 2024, "Volvo D17 780",      780, "I-Shift 14-spd",          "automatic", "Sleeper", 56, 238, 7.0, 5),
        new("DAF",    "XG+",  2024, "PACCAR MX-13 530",   530, "TraXon 12-spd",           "automatic", "Sleeper", 56, 225, 8.3, 5),
    };

    /// <summary>The make written on a trailer of this type when the company buys one.</summary>
    internal static string TrailerMake(string type) => type switch
    {
        "Reefer" => "Schmitz Cargobull S.KO COOL",
        "Dry Van" => "Krone Profi Liner (curtainsider)",
        "Flatbed" => "Kögel Lightplus flatbed",
        "Step Deck" => "Faymonville MegaMAX",
        "Tanker" => "Feldbinder tank semi-trailer",
        "Lowboy" => "Goldhofer STZ low loader",
        "Livestock" => "Pezzaioli livestock trailer",
        "Log" => "Kässbohrer K.SLA timber trailer",
        "Container" => "Krone Box Liner container chassis",
        _ => "Schmitz Cargobull S.CS",
    };
}
