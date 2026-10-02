namespace TruckSimDispatcher.Services;

/// <summary>
/// The carriers an ETS2 driver can work for — the European counterpart of the rosters in
/// <see cref="Carriers"/>, in the same <see cref="Carriers.Spec"/> shape and read the same way.
///
/// <para><b>Real names, roleplay terms.</b> As in the US roster: the companies, their headquarters and the
/// kind of freight they are known for are real; the pay, the standards and the star ratings are the game's
/// and are nobody's actual offer. Where a head office is somewhere ETS2 has no city, the home yard is the
/// nearest city the game does have, and the description says where the real one is.</para>
///
/// <para>Rates are per mile like every other figure, set from European per-km rates (about €0.22 to €0.32 a
/// km loaded), so they read correctly in km. Divisions use the app's existing names — see
/// <see cref="Ets2Data"/>.</para>
/// </summary>
internal static partial class Ets2Data
{
    private static readonly string[] NoHaz = Array.Empty<string>();

    internal static readonly Carriers.Spec[] CarriersReal =
    {
        new("Girteka", "GIR",
            new[] { "Reefer", "Dry Van" }, "Large",
            "Vilnius", "LT", new[] { "Kaunas,LT", "Poznań,PL", "Duisburg,DE" },
            0.46m, 0.36m, 0, 0, 86, 4, 11, NoHaz, true, false, 4, 2, 3,
            "One of Europe's largest truckload carriers, run out of Lithuania with a very large fleet of " +
            "refrigerated and curtainsider units working the whole continent. Long trips, a lot of time away, " +
            "and freight that is never short.",
            "Takes new drivers and trains them."),

        new("DSV Road", "DSV",
            new[] { "Dry Van", "Intermodal", "Reefer" }, "Large",
            "Copenhagen", "DK", new[] { "Hamburg,DE", "Gothenburg,SE", "Rotterdam,NL" },
            0.50m, 0.40m, 1, 25, 88, 3, 10, NoHaz, false, false, 4, 3, 3,
            "The road arm of the Danish logistics group — groupage and full loads across Scandinavia and into " +
            "the rest of Europe. Scheduled, well-planned freight with less waiting around than most.",
            "Wants a year on the road first."),

        new("Waberer's", "WAB",
            new[] { "Dry Van", "Reefer" }, "Large",
            "Budapest", "HU", new[] { "Vienna,AT", "Bratislava,SK", "Milan,IT" },
            0.44m, 0.34m, 0, 0, 85, 4, 12, NoHaz, true, false, 3, 2, 3,
            "Hungary's big international carrier, running long-distance full loads from Central Europe to the " +
            "west and back. A common first job for drivers from the region.",
            "Takes newly qualified drivers."),

        new("Dachser", "DAC",
            new[] { "Dry Van", "Reefer" }, "Large",
            "Munich", "DE", new[] { "Stuttgart,DE", "Lyon,FR", "Vienna,AT" },
            0.52m, 0.41m, 1, 25, 90, 3, 9, NoHaz, false, false, 4, 4, 3,
            "Family-owned German logistics group, headquartered in Kempten in the Allgäu — the yard here is Munich, " +
            "the nearest city the game has. Groupage and food logistics on a tight network, and drivers who are home " +
            "more than most.",
            "A year of experience and a clean record."),

        new("DB Schenker", "DBS",
            new[] { "Dry Van", "Intermodal" }, "Large",
            "Duisburg", "DE", new[] { "Cologne,DE", "Warsaw,PL", "Malmö,SE" },
            0.50m, 0.40m, 1, 20, 88, 3, 10, NoHaz, false, false, 4, 3, 3,
            "One of the oldest names in European land transport, head office in Essen — Duisburg is its nearest city " +
            "in the game. Network freight between its own terminals, a lot of it to and from the rail head.",
            "Experienced drivers."),

        new("Raben", "RAB",
            new[] { "Dry Van", "Reefer" }, "Large",
            "Poznań", "PL", new[] { "Warsaw,PL", "Leipzig,DE", "Prague,CZ" },
            0.45m, 0.35m, 0, 0, 87, 4, 11, NoHaz, true, false, 3, 3, 3,
            "Polish-Dutch logistics group running groupage and full loads from Central and Eastern Europe. Fresh " +
            "food is a large part of it.",
            "Hires new drivers."),

        new("Hegelmann", "HEG",
            new[] { "Dry Van" }, "Large",
            "Mannheim", "DE", new[] { "Kaunas,LT", "Warsaw,PL" },
            0.44m, 0.34m, 0, 0, 85, 4, 12, NoHaz, true, false, 3, 2, 2,
            "German-Lithuanian group with a large curtainsider fleet; head office in Bruchsal, near Mannheim. " +
            "Full loads all over the continent, and plenty of them.",
            "Takes new drivers."),

        new("LKW Walter", "LKW",
            new[] { "Intermodal", "Dry Van" }, "Large",
            "Vienna", "AT", new[] { "Trieste,IT", "Rostock,DE", "Barcelona,ES" },
            0.48m, 0.38m, 1, 20, 88, 3, 10, NoHaz, false, false, 3, 3, 3,
            "Austrian full-load specialist that moves a great deal of its freight by rail and short-sea ferry, " +
            "with trucks at both ends. A lot of port and terminal work.",
            "A year on the road."),

        new("Fercam", "FER",
            new[] { "Dry Van", "Reefer" }, "Medium",
            "Verona", "IT", new[] { "Milan,IT", "Munich,DE" },
            0.48m, 0.38m, 1, 20, 88, 3, 10, NoHaz, false, false, 3, 3, 3,
            "South Tyrolean carrier from Bolzano, on the Brenner route — Verona is the nearest city in the game. " +
            "Italy to Germany and back, over the Alps.",
            "Experienced drivers."),

        new("STEF", "STF",
            new[] { "Reefer" }, "Large",
            "Paris", "FR", new[] { "Lyon,FR", "Madrid,ES", "Milan,IT" },
            0.52m, 0.41m, 1, 25, 91, 3, 9, NoHaz, false, true, 4, 3, 3,
            "France's big temperature-controlled carrier: chilled and frozen food to supermarket depots on tight " +
            "slots. Precise work, and the slot is the slot.",
            "Reefer experience and a clean record."),

        new("Primafrio", "PRF",
            new[] { "Reefer" }, "Large",
            "Murcia", "ES", new[] { "Valencia,ES", "Lyon,FR", "Rotterdam,NL" },
            0.47m, 0.37m, 0, 0, 87, 4, 11, NoHaz, true, false, 4, 2, 3,
            "Spanish refrigerated carrier hauling fruit and vegetables from the south of Spain to the rest of " +
            "Europe. Long runs north, loaded both ways when the season is on.",
            "Takes new drivers."),

        new("Hoyer", "HOY",
            new[] { "Tanker" }, "Large",
            "Hamburg", "DE", new[] { "Rotterdam,NL", "Antwerp,BE", "Duisburg,DE" },
            0.56m, 0.44m, 2, 40, 92, 2, 8, new[] { "2", "3", "8" }, false, true, 4, 3, 4,
            "Hamburg tank-logistics group: chemicals, gases, fuels and food-grade liquids in tank trailers and " +
            "tank containers. Every load matters and the paperwork is part of the job.",
            "ADR and two years on the road."),

        new("Bertschi", "BER",
            new[] { "Tanker", "Intermodal" }, "Medium",
            "Zurich", "CH", new[] { "Duisburg,DE", "Antwerp,BE" },
            0.58m, 0.46m, 2, 40, 93, 2, 8, new[] { "3", "6", "8" }, false, true, 5, 3, 4,
            "Swiss chemical-logistics specialist from Dürrenäsch, near Zurich — bulk liquids, much of it in tank " +
            "containers on rail with trucks at both ends.",
            "ADR, experience and a clean record."),

        new("Jan de Rijk", "JDR",
            new[] { "Reefer", "Dry Van" }, "Medium",
            "Rotterdam", "NL", new[] { "Calais,FR", "Milan,IT" },
            0.50m, 0.40m, 1, 25, 90, 3, 9, NoHaz, false, false, 4, 3, 3,
            "Dutch carrier from Roosendaal — Rotterdam in the game — known for high-value and temperature-controlled " +
            "freight, including a lot of work to and from the UK.",
            "A year of experience."),

        new("Maritime Transport", "MAR",
            new[] { "Intermodal", "Dry Van" }, "Large",
            "Felixstowe", "UK", new[] { "Southampton,UK", "Birmingham,UK", "Liverpool,UK" },
            0.50m, 0.40m, 1, 20, 88, 3, 10, NoHaz, false, false, 4, 4, 3,
            "The UK's big container haulier, working out of Felixstowe and the other deep-sea ports. Short and " +
            "medium runs, mostly home at night.",
            "A year of experience."),

        new("Nijhof-Wassink", "NWA",
            new[] { "Bulk", "Tanker" }, "Medium",
            "Groningen", "NL", new[] { "Duisburg,DE", "Antwerp,BE" },
            0.52m, 0.41m, 1, 20, 90, 3, 9, NoHaz, false, true, 4, 3, 3,
            "Dutch bulk carrier from Rijssen, in the east of the Netherlands — silos and tippers for food, feed " +
            "and chemicals.",
            "Experienced drivers."),
    };

    internal static readonly Carriers.Spec[] CarriersFictional =
    {
        new("Baltic Line Logistics", "BLL",
            new[] { "Dry Van", "Reefer" }, "Large",
            "Riga", "LV", new[] { "Tallinn,EE", "Kaunas,LT", "Gdańsk,PL" },
            0.43m, 0.33m, 0, 0, 85, 4, 12, NoHaz, true, false, 3, 2, 2,
            "Big Baltic fleet running full loads between the Baltic states, Poland and the west. Plenty of work, " +
            "and a good place to start.",
            "Takes new drivers."),

        new("Nordfrost Kylfrakt", "NFK",
            new[] { "Reefer" }, "Medium",
            "Gothenburg", "SE", new[] { "Oslo,NO", "Malmö,SE" },
            0.50m, 0.40m, 1, 20, 89, 3, 10, NoHaz, false, true, 4, 4, 3,
            "Swedish refrigerated carrier serving the Nordic supermarkets. Cold freight, short slots, home most weeks.",
            "Reefer experience preferred."),

        new("Alpenstahl Transporte", "AST",
            new[] { "Flatbed", "Heavy Haul" }, "Medium",
            "Linz", "AT", new[] { "Graz,AT", "Brno,CZ" },
            0.52m, 0.42m, 1, 25, 90, 3, 9, NoHaz, false, true, 4, 3, 4,
            "Steel and machinery on flatbeds and low loaders, out of the Upper Austrian steel country.",
            "Flatbed experience."),

        new("Rhein Tankdienst", "RTD",
            new[] { "Tanker" }, "Medium",
            "Cologne", "DE", new[] { "Rotterdam,NL", "Antwerp,BE" },
            0.55m, 0.44m, 2, 30, 92, 2, 8, new[] { "3" }, false, true, 4, 3, 4,
            "Fuel and chemicals between the Rhine refineries and the ports.",
            "ADR class 3 and two years."),

        new("Iberia Carga Pesada", "ICP",
            new[] { "Heavy Haul", "Flatbed" }, "Small",
            "Zaragoza", "ES", new[] { "Bilbao,ES", "Madrid,ES" },
            0.54m, 0.43m, 2, 40, 90, 2, 9, NoHaz, false, true, 4, 3, 4,
            "Oversize and heavy loads across Iberia: wind-turbine parts, machinery and construction plant.",
            "Experience with oversize loads."),

        new("Carpathia Trans", "CPT",
            new[] { "Dry Van" }, "Large",
            "Cluj-Napoca", "RO", new[] { "Bucharest,RO", "Budapest,HU" },
            0.40m, 0.31m, 0, 0, 84, 4, 12, NoHaz, true, false, 2, 2, 2,
            "Romanian full-load fleet running west and back. Older trucks, long trips, and a seat for anybody.",
            "Takes new drivers."),

        new("Hellas Freight", "HLF",
            new[] { "Dry Van", "Reefer" }, "Medium",
            "Thessaloniki", "GR", new[] { "Sofia,BG", "Skopje,MK" },
            0.44m, 0.34m, 0, 0, 86, 4, 11, NoHaz, true, false, 3, 3, 2,
            "Greek carrier linking the port of Thessaloniki with the Balkans and Central Europe.",
            "Takes new drivers."),

        new("Polska Droga", "PDR",
            new[] { "Dry Van", "Intermodal" }, "Large",
            "Łódź", "PL", new[] { "Warsaw,PL", "Wrocław,PL", "Berlin,DE" },
            0.44m, 0.34m, 0, 0, 86, 4, 11, NoHaz, true, false, 3, 3, 3,
            "Polish full-load and container carrier from the middle of the country — everywhere is a day away.",
            "Takes new drivers."),

        new("Highland Haulage", "HHL",
            new[] { "Log", "Flatbed" }, "Small",
            "Inverness", "UK", new[] { "Aberdeen,UK", "Glasgow,UK" },
            0.50m, 0.40m, 1, 20, 89, 3, 10, NoHaz, false, true, 3, 4, 3,
            "Timber and building materials across the Scottish Highlands. Hard roads, and home every night.",
            "Experienced drivers."),

        new("Lusitânia Frio", "LUF",
            new[] { "Reefer" }, "Medium",
            "Porto", "PT", new[] { "Lisbon,PT", "Madrid,ES" },
            0.45m, 0.35m, 0, 0, 87, 4, 11, NoHaz, true, false, 3, 3, 3,
            "Portuguese refrigerated carrier hauling fish and fruit from the Atlantic coast to the rest of Europe.",
            "Takes new drivers."),

        new("Adriatic Cargo", "ADC",
            new[] { "Dry Van", "Flatbed" }, "Medium",
            "Zagreb", "HR", new[] { "Ljubljana,SI", "Belgrade,RS", "Sarajevo,BA" },
            0.45m, 0.35m, 0, 0, 86, 4, 11, NoHaz, true, false, 3, 3, 3,
            "Balkan carrier running between the Adriatic ports and the interior.",
            "Takes new drivers."),

        new("Mittelland Express", "MLE",
            new[] { "Dry Van", "Reefer" }, "Small",
            "Bern", "CH", new[] { "Zurich,CH", "Geneva,CH" },
            0.60m, 0.48m, 3, 60, 94, 1, 7, NoHaz, false, false, 5, 5, 5,
            "Small Swiss carrier with new trucks, short runs and the best pay on the board — and the strictest " +
            "standards to go with it.",
            "Three years, a clean record and a spotless trailer."),
    };

    internal static readonly Carriers.Spec[] CarriersSecondChance =
    {
        new("Eastbound Haulage", "EBH",
            new[] { "Dry Van", "Reefer" }, "Large",
            "Sofia", "BG", new[] { "Plovdiv,BG", "Bucharest,RO", "Istanbul,TR" },
            0.30m, 0.22m, 0, 0, 0, 99, 100, NoHaz, true, false, 1, 1, 1,
            "Takes drivers other carriers have let go, and makes no secret of why it can. Long runs to the " +
            "far corners of the map, old tractors, and home when the board allows. Run clean here for a few " +
            "months and the industry will look at you again.",
            "Hires drivers with terminations on their record. That is the business model.",
            SecondChance: true),

        new("Last Mile Logistik", "LML",
            new[] { "Dry Van" }, "Medium",
            "Leipzig", "DE", new[] { "Dresden,DE", "Prague,CZ" },
            0.32m, 0.24m, 0, 0, 0, 99, 100, NoHaz, true, false, 1, 2, 1,
            "Agency fleet that fills seats for other carriers' overflow. The work is whatever is left, and " +
            "nobody asks about your record.",
            "Hires drivers with terminations on their record.",
            SecondChance: true),
    };

    /// <summary>The part of Europe a carrier is run from, for filtering the job board.</summary>
    internal static string RegionOf(string? code) => (code ?? "").Trim().ToUpperInvariant() switch
    {
        "UK" or "IE" or "IM" or "JE" or "GG" => "British Isles",
        "FR" or "BE" or "NL" or "LU" or "MC" => "Benelux & France",
        "DE" or "AT" or "CH" or "LI" => "Central",
        "DK" or "NO" or "SE" or "FI" or "IS" or "FO" or "AX" or "SJ" or "GL" => "Nordic",
        "EE" or "LV" or "LT" or "RU" => "Baltic",
        "PL" or "CZ" or "SK" or "HU" or "UA" or "MD" => "Eastern",
        "ES" or "PT" or "AD" => "Iberia",
        "IT" or "MT" or "SI" or "HR" or "BA" or "RS" or "ME" or "AL" or "MK" or "XK" => "Italy & Balkans",
        "RO" or "BG" or "GR" or "TR" or "CY" or "GE" => "South-east",
        "EG" or "IQ" or "IL" or "JO" or "LB" or "PS" or "SA" or "SY" => "Middle East",
        "" => "",
        _ => "Other",
    };
}
