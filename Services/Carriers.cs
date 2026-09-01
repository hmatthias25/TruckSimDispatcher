using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The carrier job market. The same catalogue serves the first job and every move after it: you
/// apply, they screen you against their own standards, and they can turn you down. A carrier you
/// cannot get into today is one to come back to with more experience.
/// </summary>
public static class Carriers
{
    /// <summary>
    /// The cities a carrier actually runs terminals in: headquarters plus its published yards, as
    /// "City,ST". This is the network a company driver works within — the app offers a yard here and
    /// nowhere else, because a driver does not decide where their employer opens terminals.
    /// </summary>
    private static List<string> NetworkFor(Spec spec)
    {
        var cities = new List<string> { $"{spec.HqCity},{spec.HqState}" };
        cities.AddRange(spec.OtherYards.Select(y => y.Replace(", ", ",").Trim()));
        return cities.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private record Spec(
        string Name, string Code, string[] Divisions,
        string Size, string HqCity, string HqState, string[] OtherYards,
        decimal LoadedCpm, decimal DeadheadCpm,
        double MinYears, int MinLoads, double MinOnTime, int MaxFaults, double MaxAvgDamage,
        string[] NeedsClasses, bool TakesRookies, bool Specialized,
        int EquipmentStars, int HomeTimeStars, int PayStars,
        string Blurb, string StandardsNote,
        // Last, with defaults, so every existing entry compiles untouched.
        bool SecondChance = false,
        // The highest rung this carrier promotes to. Empty means "work it out from their pay standing".
        string Ceiling = "")
    {
        /// <summary>
        /// Placarded freight of any class. Derived rather than stored so it cannot contradict the list
        /// beside it — which is exactly how a carrier ended up demanding an endorsement that is not real.
        /// </summary>
        public bool NeedsHazmat => NeedsClasses.Length > 0;
    }

    /// <summary>Nothing placarded. Most carriers.</summary>
    private static readonly string[] NoHaz = Array.Empty<string>();

    /// <summary>The hazmat classes a carrier's freight actually carries. Sugar, to keep the table readable.</summary>
    private static string[] Cls(params string[] classes) => classes;

    /// <summary>
    /// What each rung pays, as a multiple of the carrier's posted rate.
    ///
    /// Rank used to carry flat rates for everybody, so a senior driver at a bargain-basement fleet and a
    /// senior driver at the best-paying carrier on the list earned exactly the same — which left no
    /// reason to ever move. The shape of the ladder is the same everywhere; what it is a shape *of*
    /// belongs to the employer.
    ///
    /// Every rung is a company scale. The top two used to sit far above the rest because they were a
    /// lease-purchase and an owner-operator paying their own fuel — neither of which this app simulates,
    /// so neither is paid as though it does.
    /// </summary>
    private static readonly (string Rank, decimal Mult)[] RankMultipliers =
    {
        ("probationary", 0.90m),
        ("company",      1.00m),
        ("senior",       1.10m),
        ("lead",         1.20m),
        ("lease",        1.30m),   // Specialist Driver
        ("owner",        1.45m),   // Master Driver
    };

    private static decimal MultiplierFor(string? rank) =>
        RankMultipliers.FirstOrDefault(r => r.Rank.Equals(rank ?? "", StringComparison.OrdinalIgnoreCase)).Mult is var m
        && m > 0 ? m : 1.00m;

    /// <summary>
    /// How far a carrier will promote a driver.
    ///
    /// Taken from what they pay when they have not said otherwise: a fleet at the bottom of the market
    /// does not promote past a senior seat. A second-chance carrier stops at company driver — that
    /// is the whole point of it being somewhere you leave.
    /// </summary>
    private static string CeilingOf(Spec spec)
    {
        if (!string.IsNullOrWhiteSpace(spec.Ceiling)) return spec.Ceiling;
        if (spec.SecondChance) return "company";
        return spec.PayStars >= 5 ? "owner"
             : spec.PayStars == 4 ? "lease"
             : spec.PayStars == 3 ? "lead"
             : "senior";
    }

    /// <summary>
    /// What a carrier wants a driver levelled up in, and how far.
    ///
    /// Derived from the freight they actually run rather than typed into thirty table rows, so it stays
    /// honest when a carrier's divisions change: a car hauler wants fragile and a delivery window kept, a
    /// heavy-haul outfit wants high-value and the miles behind it, a grocery account lives on just in
    /// time. Fleets that hire rookies want none of it — that is what makes them the way in.
    ///
    /// The level is not the same everywhere. A four-star car hauler asking for Fragile 3 and a five-star
    /// one asking for Fragile 4 is the difference between them, and it is the whole point of having a
    /// market rather than a checklist.
    /// </summary>
    public static (int LongDistance, int HighValue, int Fragile, int JustInTime) SkillsNeeded(string code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code ?? "", StringComparison.OrdinalIgnoreCase));
        return spec == null ? (0, 0, 0, 0) : SkillsNeeded(spec);
    }

    private static (int LongDistance, int HighValue, int Fragile, int JustInTime) SkillsNeeded(Spec spec)
    {
        // The way in stays open, and it stays wide. Only specialised outfits and the top of the market
        // hire on skills at all — an ordinary dry van fleet takes anyone who can drive, which is what
        // makes a career possible from nothing. Gating the whole board on levels the player has not
        // entered yet would close the market on every existing career at once.
        if (spec.SecondChance) return (0, 0, 0, 0);
        if (spec.TakesRookies && !spec.Specialized) return (0, 0, 0, 0);
        if (!spec.Specialized && spec.PayStars < 4) return (0, 0, 0, 0);

        bool Runs(params string[] any) =>
            any.Any(x => spec.Divisions.Contains(x, StringComparer.OrdinalIgnoreCase));

        int lng = 0, hv = 0, fr = 0, jit = 0;

        if (Runs("Auto", "Car Hauling")) { fr = 3; hv = 2; jit = 2; }
        if (Runs("Heavy Haul", "Lowboy")) { hv = Math.Max(hv, 3); lng = Math.Max(lng, 2); }
        if (Runs("Dedicated")) jit = Math.Max(jit, 2);
        if (Runs("Tanker", "Hazmat", "Bulk", "Pneumatic")) hv = Math.Max(hv, 2);
        if (Runs("Livestock")) jit = Math.Max(jit, 2);

        // Open deck is deliberately absent. Flatbed freight is steel, lumber and machinery — securement
        // and tarping work, not delicate cargo — so asking a flatbed outfit's drivers for Fragile was
        // reading the trailer instead of the freight, and it shut a whole class of carrier to anyone who
        // had not levelled a skill their work never uses.

        // The better the outfit, the more they ask — but only where they were asking at all. A carrier
        // that does not care about fragile freight does not start caring because it pays well.
        var bump = spec.PayStars >= 5 ? 1 : 0;
        int Up(int v) => v <= 0 ? 0 : Math.Min(DriverSkills.Max, v + bump);

        return (Up(lng), Up(hv), Up(fr), Up(jit));
    }

    /// <summary>Which of a carrier's skill bars this driver is short of, and by how much.</summary>
    public static List<string> SkillShortfalls(AppState s, string code)
    {
        var need = SkillsNeeded(code);
        var have = s.Driver.Skills;
        var gaps = new List<string>();

        void Check(int want, int held, string label)
        {
            if (want > held) gaps.Add($"{label} {want} (you are at {held})");
        }

        Check(need.LongDistance, have.LongDistance, "Long Distance");
        Check(need.HighValue, have.HighValue, "High Value Cargo");
        Check(need.Fragile, have.Fragile, "Fragile Cargo");
        Check(need.JustInTime, have.JustInTime, "Just in Time");
        return gaps;
    }

    /// <summary>
    /// True when the driver clears every bar this carrier sets by a comfortable margin.
    ///
    /// Somebody turning up already levelled for the work is not a probationary hire, so this is what
    /// starts them further up the ladder. Requires the carrier to actually ask for something — clearing
    /// a bar nobody set is not an achievement.
    /// </summary>
    public static bool SkillsExceed(AppState s, string code, int by = 2)
    {
        var need = SkillsNeeded(code);
        if (need.LongDistance + need.HighValue + need.Fragile + need.JustInTime == 0) return false;

        var have = s.Driver.Skills;

        // Capped at the top of the scale, or the bar becomes unreachable: a carrier wanting 4 would need
        // a 6 to clear "by two", and the scale stops at 5. Maxing a skill counts as clearing it.
        bool Clears(int want, int held) => want <= 0 || held >= Math.Min(DriverSkills.Max, want + by);

        return Clears(need.LongDistance, have.LongDistance)
            && Clears(need.HighValue, have.HighValue)
            && Clears(need.Fragile, have.Fragile)
            && Clears(need.JustInTime, have.JustInTime);
    }

    private static Spec? SpecOf(AppState s) =>
        string.IsNullOrWhiteSpace(s.Company.Code)
            ? null
            : AllSpecs.FirstOrDefault(c => c.Code.Equals(s.Company.Code, StringComparison.OrdinalIgnoreCase));

    /// <summary>The rank this employer will not promote past. Empty when they have no ladder on file.</summary>
    public static string CeilingRank(AppState s) => SpecOf(s) is { } spec ? CeilingOf(spec) : "";

    /// <summary>
    /// What this employer pays at a given rung. Null when the driver works somewhere the app has no
    /// scale for — a hand-built company — and the caller should keep the generic ladder rate.
    /// </summary>
    public static (decimal Loaded, decimal Deadhead)? ScaleFor(AppState s, string? rank)
    {
        var spec = SpecOf(s);
        if (spec == null) return null;
        var mult = MultiplierFor(rank);
        return (Math.Round(spec.LoadedCpm * mult, 3), Math.Round(spec.DeadheadCpm * mult, 3));
    }

    /// <summary>The posted rate and the top of the scale, for the job market card.</summary>
    public static (decimal Posted, decimal Top, string TopRank)? ScaleSummary(string code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code ?? "", StringComparison.OrdinalIgnoreCase));
        if (spec == null) return null;
        var ceiling = CeilingOf(spec);
        return (spec.LoadedCpm, Math.Round(spec.LoadedCpm * MultiplierFor(ceiling), 3), ceiling);
    }

    /// <summary>
    /// Real US carriers. Names, headquarters, freight specialities and whether they run a
    /// driver-training programme are drawn from what these companies publish about themselves.
    ///
    /// Pay rates, hiring standards and star ratings here are ROLEPLAY VALUES invented for the game.
    /// They are not these companies' real terms of employment, and the app says so wherever they
    /// are shown. Nothing here characterises a real employer's equipment, safety or treatment of
    /// drivers — only the publicly known facts of what they haul and where they are based.
    /// </summary>
    /// <summary>
    /// The real carriers.
    ///
    /// <b>MaxFaults 99 / MaxAvgDamage 100 / MinOnTime 0 is a "no gate" sentinel, not a standard.</b> It
    /// belongs to the second-chance and bottom-of-market outfits, whose whole business is taking drivers
    /// nobody else will. Schneider, Werner, Knight-Swift and C.R. England carried it for a while, which
    /// modelled four of the largest carriers in North America as having no hiring standards at all and
    /// put them on the same rung as the invented filler. Taking rookies and having standards are
    /// independent — Prime and Roehl do both — and the data had conflated them.
    /// </summary>
    private static readonly Spec[] RealWorld =
    {
        new("Schneider National", "SNI",
            new[] { "Dry Van", "Intermodal", "Dedicated", "Tanker" }, "Large",
            "Green Bay", "WI", new[] { "Dallas,TX", "Charlotte,NC", "Phoenix,AZ", "Chicago,IL" },
            0.52m, 0.42m, 0, 0, 86, 4, 11, NoHaz, true, false, 4, 3, 3,
            "One of the largest carriers in North America, running dry van, intermodal drayage and dedicated fleets out of Green Bay. Runs one of the industry's biggest driver-training programmes and regularly hires drivers straight out of CDL school.",
            "Hires inexperienced drivers through their training programme."),

        new("Werner Enterprises", "WER",
            new[] { "Dry Van", "Dedicated", "Reefer", "Intermodal" }, "Large",
            "Omaha", "NE", new[] { "Dallas,TX", "Atlanta,GA", "Phoenix,AZ" },
            0.50m, 0.40m, 0, 0, 85, 4, 12, NoHaz, true, false, 3, 3, 2,
            "Omaha-based nationwide truckload carrier running van, dedicated, temperature-controlled and intermodal freight. Long-standing entry point for new drivers.",
            "Takes recent CDL graduates."),

        new("Knight-Swift Transport", "KNX",
            new[] { "Dry Van", "Intermodal", "Reefer", "Dedicated" }, "Large",
            "Phoenix", "AZ", new[] { "Dallas,TX", "Atlanta,GA", "Memphis,TN", "Denver,CO" },
            0.51m, 0.41m, 0, 0, 87, 4, 11, NoHaz, true, false, 4, 3, 3,
            "The largest truckload carrier in the United States after the Knight and Swift merger, headquartered in Phoenix. Van, reefer, intermodal and dedicated across the whole country.",
            "Hires new CDL holders."),

        new("C.R. England", "CRE",
            new[] { "Reefer", "Dedicated", "Dry Van" }, "Large",
            "Salt Lake City", "UT", new[] { "Dallas,TX", "Indianapolis,IN", "Phoenix,AZ" },
            0.53m, 0.43m, 0, 0, 89, 3, 9, NoHaz, true, false, 3, 2, 3,
            "Salt Lake City refrigerated carrier, one of the biggest reefer fleets in the country, with dedicated and van divisions alongside. Operates large driver-training and hiring programmes for people entering the industry.",
            "Trains and hires inexperienced drivers."),

        new("Roehl Transport", "ROE",
            new[] { "Flatbed", "Reefer", "Dry Van", "Dedicated" }, "Regional",
            "Marshfield", "WI", new[] { "Chicago,IL", "Dallas,TX", "Atlanta,GA" },
            0.56m, 0.45m, 0, 0, 88, 3, 10, NoHaz, true, false, 4, 4, 3,
            "Family-owned Wisconsin carrier running flatbed, refrigerated and dry van, with around 2,000 trucks. Offers on-the-job training for recent CDL school graduates and is known for structured onboarding and home-time programmes.",
            "Hires inexperienced drivers with on-the-job training."),

        new("Prime Inc.", "PRI",
            new[] { "Reefer", "Flatbed", "Tanker", "Dry Van" }, "Large",
            "Springfield", "MO", new[] { "Salt Lake City,UT", "Pittston,PA", "Denver,CO" },
            0.57m, 0.46m, 0, 0, 88, 3, 9, NoHaz, true, false, 4, 3, 4,
            "Springfield, Missouri carrier with large refrigerated, flatbed and tanker divisions and over $2.5 billion in revenue. Its size and constant demand make it a common first job for new CDL graduates.",
            "Runs a well-known training programme for new drivers."),

        new("Marten Transport", "MRT",
            new[] { "Reefer", "Dedicated", "Intermodal" }, "Regional",
            "Mondovi", "WI", new[] { "Dallas,TX", "Atlanta,GA", "Ontario,CA" },
            0.59m, 0.48m, 2, 0, 93, 1, 6, NoHaz, false, false, 4, 3, 4,
            "A leader in refrigerated transportation, based in Mondovi, Wisconsin. Temperature-controlled truckload, dedicated and intermodal — food-grade freight with tight appointment windows.",
            "Two years of verifiable experience."),

        new("KLLM Transport Services", "KLM",
            new[] { "Reefer", "Dedicated", "Dry Van" }, "Regional",
            "Richland", "MS", new[] { "Dallas,TX", "Atlanta,GA", "Laredo,TX" },
            0.58m, 0.47m, 1, 0, 92, 1, 7, NoHaz, false, false, 3, 3, 3,
            "Mississippi-based temperature-controlled carrier that has moved perishables across the US and Mexico for around fifty years. Heavy cross-border produce and food freight.",
            "One year, or their training programme."),

        new("Melton Truck Lines", "MEL",
            new[] { "Flatbed", "Step Deck" }, "Regional",
            "Tulsa", "OK", new[] { "Laredo,TX", "Birmingham,AL", "Salt Lake City,UT" },
            0.62m, 0.50m, 2, 0, 92, 1, 6, NoHaz, false, true, 4, 2, 4,
            "Tulsa-based flatbed specialist running steel, building products and machinery across the US, Canada and Mexico. Tarping and load securement are the daily job.",
            "Two years, open-deck experience strongly preferred."),

        new("Maverick Transportation", "MAV",
            new[] { "Flatbed", "Step Deck", "Reefer" }, "Regional",
            "North Little Rock", "AR", new[] { "Dallas,TX", "Atlanta,GA", "Chicago,IL" },
            0.63m, 0.51m, 2, 0, 93, 1, 5, NoHaz, false, true, 4, 3, 4,
            "Arkansas open-deck carrier known for flatbed, glass and specialised securement work, with a temperature-controlled division alongside.",
            "Two years and demonstrated securement ability."),

        new("PS Logistics", "PSL",
            new[] { "Flatbed", "Step Deck", "Heavy Haul" }, "Large",
            "Birmingham", "AL", new[] { "Houston,TX", "Atlanta,GA", "Indianapolis,IN" },
            0.61m, 0.49m, 2, 0, 90, 2, 7, NoHaz, false, true, 3, 2, 4,
            "One of the largest flatbed operators in the country, grown through acquisition and headquartered in Birmingham, Alabama. Steel, building materials and heavy specialised freight.",
            "Two years of open-deck work."),

        new("Anderson Trucking Service", "ATS",
            new[] { "Heavy Haul", "Flatbed", "Step Deck", "Lowboy" }, "Regional",
            "St. Cloud", "MN", new[] { "Houston,TX", "Denver,CO", "Chicago,IL" },
            0.72m, 0.58m, 4, 25, 95, 0, 5, NoHaz, false, true, 5, 2, 5,
            "St. Cloud, Minnesota specialised carrier known for heavy haul, wind-energy components and oversized machinery. Permitted, route-surveyed freight.",
            "Four years and real heavy-haul history."),

        new("Bennett Motor Express", "BEN",
            new[] { "Heavy Haul", "Lowboy", "Flatbed", "Step Deck" }, "Regional",
            "McDonough", "GA", new[] { "Houston,TX", "Chicago,IL", "Denver,CO" },
            0.74m, 0.60m, 5, 40, 96, 0, 4, NoHaz, false, true, 5, 3, 5,
            "Georgia-based specialised and heavy-haul carrier moving oversize machinery, transformers and project cargo. Every load is planned around permits and routing.",
            "Five years and forty loads of verifiable specialised history."),

        new("Groendyke Transport", "GRO",
            new[] { "Tanker", "Hazmat", "Bulk" }, "Regional",
            "Enid", "OK", new[] { "Houston,TX", "Baton Rouge,LA", "Odessa,TX" },
            0.70m, 0.57m, 2, 0, 94, 1, 5, Cls("3", "8"), false, true, 4, 2, 5,
            "Enid, Oklahoma chemical and petroleum tank carrier. Placarded liquid bulk with the regulatory load that comes with it.",
            "Hazmat endorsement required — they run class 3 and class 8."),

        new("Trimac Transportation", "TRI",
            new[] { "Tanker", "Bulk", "Pneumatic", "Hazmat" }, "Large",
            "Houston", "TX", new[] { "Baton Rouge,LA", "Chicago,IL", "Salt Lake City,UT" },
            0.68m, 0.55m, 2, 0, 94, 1, 5, Cls("3", "8"), false, true, 4, 2, 4,
            "Bulk tank carrier hauling chemicals, fuels and dry bulk across North America, with a strong emphasis on safety and driver training.",
            "Hazmat endorsement required — class 3 and class 8 chemical bulk."),

        new("Kenan Advantage Group", "KAG",
            new[] { "Tanker", "Bulk", "Hazmat" }, "Large",
            "North Canton", "OH", new[] { "Houston,TX", "Atlanta,GA", "Chicago,IL" },
            0.66m, 0.53m, 1, 0, 93, 1, 6, Cls("3"), false, true, 4, 3, 4,
            "North Canton, Ohio bulk transporter — fuel delivery, chemicals and food-grade liquid across a large regional network. Shorter runs and more home time than most tank work.",
            "Hazmat endorsement required — class 3 fuel haulage. One year minimum."),

        new("Jack Cooper Transport", "JCT",
            new[] { "Auto", "Dry Van" }, "Regional",
            "Kansas City", "MO", new[] { "Detroit,MI", "Louisville,KY", "Dallas,TX" },
            0.65m, 0.53m, 3, 15, 95, 1, 3, NoHaz, false, true, 4, 3, 4,
            "Kansas City finished-vehicle carrier moving cars from assembly plants to dealers on multi-car rigs. Every unit is inspected at both ends.",
            "Three years and a clean damage record."),

        new("United Road Services", "URS",
            new[] { "Auto", "Dry Van" }, "Regional",
            "Romulus", "MI", new[] { "Dallas,TX", "Atlanta,GA", "Newark,NJ" },
            0.64m, 0.52m, 3, 15, 94, 1, 3, NoHaz, false, true, 4, 3, 4,
            "Michigan-based vehicle logistics carrier hauling new and used automobiles for manufacturers, auctions and dealer groups.",
            "Three years and a clean damage record."),
    };

    /// <summary>
    /// Divisions are listed most-run first. Specialised outfits ask for more time behind the wheel
    /// and, where the freight is regulated, the endorsement to go with it — the freight decides the
    /// hiring bar, not the other way round.
    /// </summary>
    private static readonly Spec[] Fictional =
    {
        new("Beacon Express", "BEX",
            new[] { "Dry Van", "Reefer", "Intermodal" }, "Large",
            "Dallas", "TX", new[] { "Atlanta,GA", "Columbus,OH", "Phoenix,AZ", "Chicago,IL" },
            0.46m, 0.36m, 0, 0, 0, 99, 100, NoHaz, true, false, 2, 2, 1,
            "Big nationwide van fleet running dry van, reefer and rail drayage. Freight is never short and neither are the miles, but the pay is bottom-of-market and the trucks are governed low. Where a lot of drivers get their first year.",
            "Takes anyone with a Class A. No experience required."),

        new("Sierra Freight Lines", "SFL",
            new[] { "Dry Van", "Reefer", "Flatbed" }, "Regional",
            "Phoenix", "AZ", new[] { "Denver,CO", "Salt Lake City,UT" },
            0.54m, 0.44m, 1, 0, 90, 2, 8, NoHaz, true, false, 3, 3, 3,
            "Steady southwestern regional. Mostly van and reefer with a small open-deck division for building materials. Treats drivers decently and will take a developing driver who wants to learn.",
            "One year preferred, not required. They will look past a rough patch."),

        new("Cold Harbor Carriers", "CHC",
            new[] { "Reefer", "Dry Van" }, "Regional",
            "Fresno", "CA", new[] { "Denver,CO", "Dallas,TX" },
            0.58m, 0.47m, 2, 0, 93, 1, 6, NoHaz, false, false, 3, 3, 3,
            "Produce and frozen out of the Central Valley. Appointment freight, tight windows, and they care about service numbers more than anything else.",
            "Two years and a service record they can actually look at."),

        new("Ironline Transport", "ILT",
            new[] { "Flatbed", "Step Deck", "Heavy Haul" }, "Regional",
            "Salt Lake City", "UT", new[] { "Denver,CO", "Casper,WY", "Boise,ID" },
            0.62m, 0.50m, 2, 0, 92, 1, 6, NoHaz, false, true, 4, 2, 4,
            "Steel, building materials and machinery across the mountain west. Flatbed and step deck daily, with an RGN division for the bigger machinery moves. Tarping is part of the job and the pay reflects it.",
            "Two years minimum. Open-deck experience helps a great deal."),

        new("Great Plains Livestock", "GPL",
            new[] { "Livestock", "Ag", "Hopper", "Reefer" }, "Regional",
            "Amarillo", "TX", new[] { "Dodge City,KS", "Grand Island,NE", "Sioux Falls,SD" },
            0.60m, 0.48m, 2, 0, 90, 1, 7, NoHaz, false, true, 3, 2, 3,
            "Cattle, grain and ag freight through the plains. Pot loads, hopper bottoms and some reefer in season. Live loads, odd hours, and a schedule that answers to the animals rather than to you.",
            "Two years. Livestock is its own skill — they will train the right person, but not a rookie."),

        new("Timberline Logging", "TLL",
            new[] { "Log", "Flatbed", "Heavy Haul" }, "Small",
            "Eugene", "OR", new[] { "Boise,ID", "Missoula,MT" },
            0.59m, 0.47m, 3, 0, 88, 2, 12, NoHaz, false, true, 2, 4, 3,
            "Log and lumber out of the Pacific Northwest, plus the occasional equipment move to a landing. Forest roads, weather, and equipment that takes a beating. Home most nights, which is why people stay.",
            "Three years. They expect you to handle a rough road without tearing up the truck."),

        new("Meridian Auto Transport", "MAT",
            new[] { "Auto", "Dry Van" }, "Regional",
            "Detroit", "MI", new[] { "Columbus,OH", "Louisville,KY", "Dallas,TX" },
            0.64m, 0.52m, 3, 15, 95, 1, 3, NoHaz, false, true, 4, 3, 4,
            "Finished vehicles from the plants to the dealers on multi-car stingers. Every unit is inspected at both ends and damage comes straight out of the settlement conversation.",
            "Three years and a genuinely clean damage record. They do not hire people who scrape things."),

        new("Redstone Bulk Lines", "RBL",
            new[] { "Tanker", "Bulk", "Pneumatic", "Dry Van" }, "Regional",
            "Houston", "TX", new[] { "Baton Rouge,LA", "Odessa,TX", "Corpus Christi,TX" },
            0.68m, 0.55m, 2, 0, 93, 1, 5, Cls("3"), false, true, 4, 2, 4,
            "Petrochemical, food-grade and dry bulk on the gulf coast. Liquid tank, pneumatic and a small van division for packaged product. Surge is a real thing and so is the money.",
            "Hazmat endorsement required for the petrochemical side — class 3. Two years minimum."),

        new("Anvil Chemical Transport", "ACT",
            new[] { "Tanker", "Hazmat", "Bulk" }, "Regional",
            "Baton Rouge", "LA", new[] { "Houston,TX", "Mobile,AL" },
            0.74m, 0.60m, 4, 25, 96, 0, 4, Cls("8", "3"), false, true, 5, 2, 5,
            "Regulated chemical haulage — placarded liquid and dry bulk. The best per-mile rate on this list and the least forgiving safety department attached to it.",
            "Hazmat endorsement, four years, and a spotless record. Class 8 and class 3. They will check."),

        new("Cascade Heavy Haul", "CHH",
            new[] { "Heavy Haul", "Lowboy", "Step Deck", "Flatbed" }, "Small",
            "Portland", "OR", new[] { "Seattle,WA", "Boise,ID" },
            0.78m, 0.63m, 5, 40, 96, 0, 4, NoHaz, false, true, 5, 3, 5,
            "Permitted oversize and machinery moves on RGN and lowboy, with step deck and flat for the smaller pieces. Small outfit, senior drivers only, and every load is planned around a permit and a route survey.",
            "Five years, forty loads of verifiable history, and nothing preventable on your record."),
    };

    /// <summary>
    /// Which roster is in play. Real carriers exist and their freight and headquarters are factual;
    /// the fictional set exists for anyone who would rather not work for a real name.
    /// </summary>
    /// <summary>
    /// Carriers that will take a driver nobody else will.
    ///
    /// Deliberately <b>fictional</b>. The real-carrier table above carries an explicit promise that
    /// nothing in it characterises a real employer's equipment, safety or treatment of drivers, and
    /// "this is where fired drivers go, the pay is poor and the trucks are worn out" is exactly that.
    /// Inventing the names costs nothing and keeps that promise.
    ///
    /// Rough but survivable, which is the point: pay down about a third, tractors near the end of their
    /// lives, thin freight, no say in equipment or home time. Unpleasant enough that redemption means
    /// something, not so unpleasant that the career is over in practice.
    /// </summary>
    private static readonly Spec[] SecondChanceCarriers =
    {
        new("Rampart Freight Systems", "RFS",
            new[] { "Dry Van", "Reefer" }, "Large",
            "Memphis", "TN", new[] { "Laredo,TX", "Fontana,CA", "Gary,IN" },
            0.34m, 0.24m, 0, 0, 0, 99, 100, NoHaz, true, false, 1, 1, 1,
            "Takes drivers other carriers have let go, and makes no secret of why it can. The freight is " +
            "thin and long, the tractors are high-mileage and governed low, and home time happens when the " +
            "board allows. Run clean here for a few months and the industry will look at you again.",
            "Hires drivers with terminations on their record. That is the business model.",
            SecondChance: true),

        new("Crossroads Carriers", "CRC",
            new[] { "Dry Van", "Flatbed" }, "Medium",
            "Oklahoma City", "OK", new[] { "Amarillo,TX", "Kansas City,MO" },
            0.36m, 0.26m, 0, 0, 0, 99, 100, NoHaz, true, false, 1, 1, 1,
            "A second-chance fleet out of Oklahoma City. Older equipment, backhaul-heavy lanes and pay to " +
            "match, but they will put you in a truck when nobody else will and they do not hold the past " +
            "against you while you are running for them.",
            "No experience or record requirements. They hire on availability.",
            SecondChance: true),
    };

    private static Spec[] Roster(AppState s) =>
        string.Equals(s.Settings.CarrierRoster, "Fictional", StringComparison.OrdinalIgnoreCase)
            ? Fictional : RealWorld;

    private static Spec[] AllSpecs => RealWorld.Concat(Fictional).Concat(SecondChanceCarriers).ToArray();

    /// <summary>
    /// Whether this driver is only employable by a second-chance carrier.
    ///
    /// Being let go for the work — preventables, a failed review — is what puts somebody here. Quitting,
    /// or being let go for anything else, does not.
    /// </summary>
    public static bool NeedsSecondChance(AppState s) =>
        s.Driver.TerminatedForCause && string.IsNullOrWhiteSpace(s.Driver.RedeemedGameTime);

    /// <summary>Second-chance carriers are the only ones on offer to a driver who has been let go.</summary>
    public static bool IsSecondChance(string code) =>
        SecondChanceCarriers.Any(c => c.Code.Equals(code, StringComparison.OrdinalIgnoreCase));

    /// <summary>Game-days that make up one business period. Conditions are re-rolled per period.</summary>
    private const int PeriodDays = 30;

    /// <summary>
    /// How a carrier's business is going this period, and what that does to their hiring. Derived
    /// from the carrier and the current game month, so it is stable while the month is — a driver
    /// cannot re-roll a hiring freeze by reloading the page, only by running freight until the
    /// calendar moves.
    /// </summary>
    public static CarrierCondition ConditionOf(AppState s, string code)
    {
        var now = GameClock.TryParse(s.Status.GameTime) ?? new DateTime(2026, 1, 1);
        var period = (int)((now - new DateTime(2020, 1, 1)).TotalDays / PeriodDays);
        var roll = StableRoll($"{code}|{period}") % 100;

        var c = new CarrierCondition { Period = period };
        var periodEnd = new DateTime(2020, 1, 1).AddDays((period + 1) * PeriodDays);
        c.ReviewedOn = GameClock.Format(periodEnd);

        if (roll < 12)
        {
            c.State = "Hiring freeze";
            c.Hiring = false;
            c.Note = "Freight is soft and they have parked trucks. Not taking anyone on right now.";
            c.YearsShift = 0; c.LoadsFactor = 1; c.OnTimeShift = 0; c.PayFactor = 1m;
        }
        else if (roll < 30)
        {
            c.State = "Tightening";
            c.Hiring = true;
            c.Note = "Having a rough quarter. Still hiring, but only people they are sure about.";
            c.YearsShift = 1; c.LoadsFactor = 1.5; c.OnTimeShift = 1; c.PayFactor = 1m;
        }
        else if (roll < 78)
        {
            c.State = "Steady";
            c.Hiring = true;
            c.Note = "Business as usual. Standard hiring standards apply.";
            c.YearsShift = 0; c.LoadsFactor = 1; c.OnTimeShift = 0; c.PayFactor = 1m;
        }
        else
        {
            c.State = "Expanding";
            c.Hiring = true;
            c.Note = "Winning freight and short of seated trucks. Flexible on the usual bar and paying over scale.";
            c.YearsShift = -1; c.LoadsFactor = 0.6; c.OnTimeShift = -1; c.PayFactor = 1.04m;
        }
        return c;
    }

    private static int StableRoll(string text)
    {
        unchecked
        {
            // FNV-1a — spreads adjacent period numbers far apart, so consecutive months differ.
            uint h = 2166136261;
            foreach (var ch in text) { h ^= ch; h *= 16777619; }
            return (int)(h % int.MaxValue);
        }
    }

    /// <summary>The full job market, with a live view of whether this driver would get in.</summary>
    public static List<CarrierListing> Market(AppState s, bool includeCurrent = false)
    {
        var list = new List<CarrierListing>();

        // Nobody is hiring. Two terminations for the work, the second from the carrier that exists to
        // take drivers with one, and the industry is done with them.
        if (s.Driver.CareerOver) return list;

        // A driver let go for the work has one kind of employer available, and it is not the ordinary
        // market. Offering the usual roster to somebody who has just been fired would make the whole
        // consequence decorative.
        var roster = NeedsSecondChance(s) ? SecondChanceCarriers : Roster(s);

        foreach (var spec in roster)
        {
            if (!includeCurrent && spec.Code == s.Company.Code) continue;
            var screening = Screen(s, spec);
            var cond = ConditionOf(s, spec.Code);
            list.Add(new CarrierListing
            {
                Code = spec.Code,
                Name = spec.Name,
                Divisions = spec.Divisions.ToList(),
                PrimaryDivision = spec.Divisions[0],
                Size = spec.Size,
                HqCity = spec.HqCity,
                HqState = spec.HqState,
                Yards = spec.OtherYards.Select(y => y.Replace(",", ", ")).ToList(),
                // Show what they would actually pay this period, not the posted rate.
                LoadedCpm = Math.Round(spec.LoadedCpm * cond.PayFactor, 3),
                DeadheadCpm = Math.Round(spec.DeadheadCpm * cond.PayFactor, 3),
                PostedLoadedCpm = spec.LoadedCpm,
                EquipmentStars = spec.EquipmentStars,
                HomeTimeStars = spec.HomeTimeStars,
                PayStars = spec.PayStars,
                Blurb = spec.Blurb,
                StandardsNote = spec.StandardsNote,
                RequiresHazmat = spec.NeedsHazmat,
                RequiresClasses = spec.NeedsClasses.ToList(),
                RequiresClassesLabel = Endorsements.Describe(spec.NeedsClasses),
                SkillsWanted = SkillsNeeded(spec) is var sk
                    ? new List<string>(
                        new[]
                        {
                            sk.LongDistance > 0 ? $"Long Distance {sk.LongDistance}" : null,
                            sk.HighValue > 0 ? $"High Value {sk.HighValue}" : null,
                            sk.Fragile > 0 ? $"Fragile {sk.Fragile}" : null,
                            sk.JustInTime > 0 ? $"Just in Time {sk.JustInTime}" : null,
                        }.Where(x => x != null).Select(x => x!))
                    : new List<string>(),
                SkillShortfall = SkillShortfalls(s, spec.Code),
                StartsAboveProbation = SkillsExceed(s, spec.Code),
                CeilingRank = CeilingOf(spec),
                CeilingTitle = CareerService.RankTitle(CeilingOf(spec)),
                TopLoadedCpm = Math.Round(spec.LoadedCpm * MultiplierFor(CeilingOf(spec)), 3),
                TakesRookies = spec.TakesRookies,
                Specialized = spec.Specialized,
                MinExperienceYears = Math.Max(0, spec.MinYears + cond.YearsShift),
                MinLoads = (int)Math.Round(spec.MinLoads * cond.LoadsFactor),
                MinOnTimePct = Math.Clamp(spec.MinOnTime + cond.OnTimeShift, 0, 100),
                MaxAvgDamage = spec.MaxAvgDamage,
                IsSecondChance = spec.SecondChance,
                PostedMinExperienceYears = spec.MinYears,
                PostedMinLoads = spec.MinLoads,
                PostedMinOnTimePct = spec.MinOnTime,
                MaxDriverFaultIncidents = spec.MaxFaults,
                WouldHire = screening.Hired,
                Standing = screening.Standing,
                ChancePct = screening.ChancePct,
                StandingNote = HiringStanding.Explain(screening.Standing, ConditionOf(s, spec.Code).State,
                    screening.ChancePct, s.Onboarded && Probation.IsOn(s) && !spec.SecondChance),
                Screening = screening,
                IsCurrentEmployer = spec.Code == s.Company.Code,
                IsRealCompany = IsRealCompany(spec.Code),
                CreditedExperienceYears = CreditedExperience(s, s.Application?.ExperienceYears ?? 0),
                LoadsToQualify = LoadsStillNeeded(s, spec),
                DaysToQualify = DaysStillNeeded(s, spec),
                Condition = cond,
            });
        }
        return list.OrderByDescending(c => c.WouldHire).ThenByDescending(c => c.LoadedCpm).ToList();
    }

    public static bool Exists(string code) =>
        AllSpecs.Any(c => c.Code.Equals(code, StringComparison.OrdinalIgnoreCase));

    /// <summary>True when the named carrier is a real company rather than one we invented.</summary>
    public static bool IsRealCompany(string code) =>
        RealWorld.Any(c => c.Code.Equals(code, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Days that make a year of experience. Time served is the only thing that accrues years, because
    /// that is what years are.
    ///
    /// Loads used to buy them at thirty a year, which made the whole gate meaningless: a fortnight of
    /// running credited a driver with a year behind the wheel, and a hundred and fifty loads let a
    /// greenhorn apply to a fleet wanting five years. Loads still matter — a carrier's minimum-loads
    /// requirement is a separate gate and freight is what satisfies it — but they are corroboration
    /// that the time was worked, not a substitute for it.
    /// </summary>
    public const double DaysPerYear = 365.0;

    /// <summary>
    /// What a hiring office would credit this driver with: what they declared, plus time actually
    /// served, plus freight actually hauled. This is the number every experience gate is judged on.
    /// </summary>
    /// <summary>
    /// How many more loads would clear this carrier's gates, so the market can show a target rather
    /// than just a refusal. Returns 0 when loads are not what is holding the driver back — an
    /// endorsement or a service record cannot be fixed by running more freight.
    /// </summary>
    private static int LoadsStillNeeded(AppState s, Spec spec)
    {
        var stats = s.Onboarded ? CareerService.Compute(s) : new CareerStats();
        var totalLoads = stats.LoadsDelivered + s.Driver.PriorLoads;
        var declared = s.Application?.ExperienceYears ?? 0;

        var byExperience = 0;
        _ = byExperience;
        // Only the loads gate is answerable in loads. Being short of years is answered in days, which
        // DaysStillNeeded reports — quoting a load count against a time requirement was the bug.
        return Math.Max(0, spec.MinLoads - totalLoads);
    }

    /// <summary>
    /// Days of service still needed to clear this carrier's experience bar, so the market can show a
    /// target in the units that actually apply. Zero when years are not what is holding them back.
    /// </summary>
    public static int DaysStillNeeded(AppState s, string code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code ?? "", StringComparison.OrdinalIgnoreCase));
        if (spec == null) return 0;
        return DaysStillNeeded(s, spec);
    }

    private static int DaysStillNeeded(AppState s, Spec spec)
    {
        var stats = s.Onboarded ? CareerService.Compute(s) : new CareerStats();
        var totalLoads = stats.LoadsDelivered + s.Driver.PriorLoads;
        if (spec.TakesRookies && totalLoads == 0) return 0;

        var credited = CreditedExperience(s, s.Application?.ExperienceYears ?? 0);
        var cond = ConditionOf(s, spec.Code);
        var minYears = Math.Max(0, spec.MinYears + cond.YearsShift);
        if (credited >= minYears) return 0;
        return (int)Math.Ceiling((minYears - credited) * DaysPerYear);
    }

    public static double CreditedExperience(AppState s, double declaredYears)
    {
        var stats = s.Onboarded ? CareerService.Compute(s) : new CareerStats();
        var loads = stats.LoadsDelivered + s.Driver.PriorLoads;
        var daysServed = stats.DaysEmployed;
        foreach (var h in s.Driver.EmploymentHistory)
        {
            var from = GameClock.TryParse(h.StartedGameDate);
            var to = GameClock.TryParse(h.EndedGameDate);
            if (from != null && to != null) daysServed += Math.Max(0, (int)(to.Value - from.Value).TotalDays);
        }
        // Loads are deliberately absent. They satisfy a carrier's minimum-loads gate on their own and
        // they are what proves the time was actually worked — but a year is a year.
        _ = loads;
        return Math.Round(declaredYears + daysServed / DaysPerYear, 2);
    }

    /// <summary>
    /// Screens the driver against one carrier's standards. Experience counts, but so does the
    /// record built at previous employers — a carrier that wants four years is not impressed by
    /// four years of service failures.
    /// </summary>
    public static HireDecision Screen(AppState s, string code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code, StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("No such carrier.");
        return Screen(s, spec);
    }

    private static HireDecision Screen(AppState s, Spec spec)
    {
        var d = new HireDecision();
        var app = s.Application;
        var years = app?.ExperienceYears ?? 0;

        // Business conditions move the bar before anything about the driver is considered.
        var cond = ConditionOf(s, spec.Code);
        var minYears = Math.Max(0, spec.MinYears + cond.YearsShift);
        var minLoads = (int)Math.Round(spec.MinLoads * cond.LoadsFactor);
        var minOnTime = Math.Clamp(spec.MinOnTime + cond.OnTimeShift, 0, 100);

        // A second-chance carrier is always hiring. Being the place that takes drivers nobody else will
        // is the entire business model, and a freight downturn closing the only door available to a
        // terminated driver would leave them with nowhere to go and no way back — which is not a
        // consequence, it is a dead end the app walked them into.
        if (!cond.Hiring && !spec.SecondChance)
        {
            d.Hired = false;
            d.Standing = HiringStanding.Closed;
            d.Decision = $"{spec.Name} — not hiring";
            d.Reasons.Add($"{cond.State}. {cond.Note}");
            d.Conditions.Add($"Their hiring is reviewed around {GameClock.Pretty(cond.ReviewedOn)}. " +
                             "Keep running freight and check back when the month turns.");
            return d;
        }

        // A driver's record carries across employers.
        var stats = s.Onboarded ? CareerService.Compute(s) : new CareerStats();
        var totalLoads = stats.LoadsDelivered + s.Driver.PriorLoads;
        var onTime = totalLoads > 0 ? stats.OnTimePct : 100;
        // Only incidents that still count. Anything Safety has cleared, or that has aged off through
        // clean work, stays on the record but no longer bars the driver from a carrier — otherwise one
        // mistake in the first week locks them out of a third of the market for the life of the file.
        var faults = (s.Onboarded ? SafetyService.CountingFaults(s).Count : 0) + s.Driver.PriorFaultIncidents;

        var fails = new List<string>();
        var notes = new List<string>();

        // What gates a tank carrier is what is in the tank, not the trailer. A fuel hauler wants class 3,
        // a chemical hauler class 8; a food-grade or dry-bulk operator wants nothing at all. "Tanker
        // endorsement" was never a real credential and the freight is what decides.
        var hasHazmat = (app?.HasHazmat ?? false)
                        || Endorsements.HasAny(s)
                        || s.Driver.Qualifications.Contains("Hazmat");

        if (spec.NeedsClasses.Length > 0 && !hasHazmat)
            fails.Add($"Their freight is placarded — {Endorsements.Describe(spec.NeedsClasses)} — and you do not " +
                      "hold a hazmat endorsement.");

        // What the driver has levelled up in the game. Named to the level, the same way the hazmat
        // refusal names the class — "not qualified" tells somebody nothing they can act on.
        var skillGaps = SkillShortfalls(s, spec.Code);
        if (skillGaps.Count > 0)
            fails.Add($"They run freight that wants {string.Join(", ", skillGaps)}. " +
                      (s.Driver.Skills.Untouched
                          ? "If you have levelled these in the game, put them on the Career tab and apply again."
                          : "Level it up in the game and come back."));

        var credited = CreditedExperience(s, years);
        if (years < minYears && !(spec.TakesRookies && totalLoads == 0))
        {
            if (credited < minYears)
            {
                var shortBy = minYears - credited;
                var daysToGo = (int)Math.Ceiling(shortBy * DaysPerYear);
                var howLong = daysToGo >= 365
                    ? $"about {daysToGo / 365.0:0.#} more year(s) on the job"
                    : $"about {daysToGo} more day(s) on the job";
                fails.Add($"They want {minYears:0.#} years on {spec.Divisions[0].ToLowerInvariant()}" +
                          (Math.Abs(cond.YearsShift) > 0.01 ? $" ({cond.State.ToLowerInvariant()} — normally {spec.MinYears:0.#})" : "") + ". " +
                          $"You credit at {credited:0.0} years ({years:0.#} declared plus time served) — " +
                          $"{howLong}. Loads do not shorten it; running hard proves the time was worked, " +
                          "it does not make more of it.");
            }
            else
            {
                notes.Add($"{years:0.#} declared years is light, but time served brings you to " +
                          $"{credited:0.0} years, which clears their bar.");
            }
        }

        if (totalLoads < minLoads)
            fails.Add($"They want at least {minLoads} loads of verifiable history" +
                      (minLoads != spec.MinLoads ? $" ({cond.State.ToLowerInvariant()} — normally {spec.MinLoads})" : "") +
                      $"; you have {totalLoads}.");

        if (totalLoads >= 5 && onTime < minOnTime)
            fails.Add($"Service standard is {minOnTime:0.#}% on time" +
                      (Math.Abs(minOnTime - spec.MinOnTime) > 0.01 ? $" ({cond.State.ToLowerInvariant()})" : "") +
                      $"; your record shows {onTime:0.#}%.");

        if (faults > spec.MaxFaults)
            fails.Add($"They allow {spec.MaxFaults} driver-fault incident(s); you have {faults}.");

        if (totalLoads >= 5 && stats.AvgDamagePerTrip > spec.MaxAvgDamage)
            fails.Add($"Damage standard is {spec.MaxAvgDamage:0.#} points a trip; you average {stats.AvgDamagePerTrip:0.##}.");

        // A termination follows a driver everywhere EXCEPT the carriers that exist to look past one.
        // Refusing them there too would make the second chance unreachable, which is the opposite of
        // the point — and would leave a terminated driver stuck with no employer and no way back.
        if (s.Driver.Status == "Terminated" && !spec.SecondChance)
            fails.Add("You were terminated by your last carrier. That follows you.");
        else if (s.Driver.Status == "Terminated" && spec.SecondChance)
            notes.Add("They know about the termination and will take you anyway. That is what they do, and " +
                      "it is why the pay looks like it does.");

        // Refusing their bread-and-butter freight is disqualifying; refusing a side division is not.
        if (app != null)
        {
            var blockedPrimary = app.WillNotHaul.FirstOrDefault(x =>
                !string.IsNullOrWhiteSpace(x) &&
                spec.Divisions[0].Contains(x, StringComparison.OrdinalIgnoreCase));
            if (blockedPrimary != null)
                fails.Add($"Their bread and butter is {spec.Divisions[0].ToLowerInvariant()}, which is on your will-not-haul list.");

            var blockedSide = app.WillNotHaul.Where(x =>
                !string.IsNullOrWhiteSpace(x) && blockedPrimary != x &&
                spec.Divisions.Skip(1).Any(dv => dv.Contains(x, StringComparison.OrdinalIgnoreCase))).ToList();
            if (blockedSide.Count > 0 && blockedPrimary == null)
                notes.Add($"They also run {string.Join(" and ", blockedSide)}, which you will not haul — you would be kept off that division.");
        }

        // ---- how the driver reads against the bar, and what that is worth this month.
        //
        // Clearing every bar used to BE the offer. It is now the price of entry, and the margin above
        // it is what decides a close call — see HiringStanding.
        var skillsClear = skillGaps.Count == 0;
        var comfortable = HiringStanding.ClearsComfortably(
            credited, minYears, totalLoads, minLoads, onTime, minOnTime,
            faults, spec.MaxFaults, stats.AvgDamagePerTrip, spec.MaxAvgDamage, skillsClear);

        d.Standing = fails.Count == 0
            ? (comfortable ? HiringStanding.Strong : HiringStanding.Marginal)
            : HiringStanding.Short;

        if (fails.Count > 0)
        {
            // Short of the bar. One near miss is still a door while they are short of seated trucks —
            // a carrier winning freight takes a chance it would not take in a flat quarter.
            var reach = HiringStanding.ReachChanceFor(cond.State);
            var nearMiss = fails.Count == 1 && skillsClear && s.Driver.Status != "Terminated";
            d.ChancePct = nearMiss ? reach : 0;

            if (nearMiss && reach > 0 && HiringStanding.Roll(s, spec.Code, cond.Period, reach))
            {
                d.Hired = true;
                d.Decision = $"{spec.Name} — offer extended";
                d.Reasons.Add($"{cond.State}. {cond.Note}");
                d.Reasons.Add("You are short of what they normally want: " + fails[0] +
                              " They are taking you anyway — they need the seat filled more than they " +
                              "need the record, and that will not be true every month.");
                d.Conditions.Add("Taken on a stretch. Expect them to watch you closely.");
                d.Standing = HiringStanding.Marginal;
                FinishOffer(s, d, spec, cond, app, totalLoads, notes);
                return d;
            }

            d.Hired = false;
            d.Decision = $"{spec.Name} — application declined";
            d.Reasons.AddRange(fails);
            if (nearMiss && cond.State != "Expanding")
                d.Conditions.Add("Only one thing is short. Carriers that are expanding will sometimes take " +
                                 "a driver on that — worth watching this one when their quarter turns.");
            d.Conditions.Add("Build the record they are asking for and apply again. Carriers reconsider.");
            return d;
        }

        // Clears the bar. Comfortably is an offer; by a hair is a decision they get to make.
        d.ChancePct = comfortable ? 100 : HiringStanding.ChanceFor(cond.State);

        // Still on probation somewhere else. Recruiters read that as somebody who has not finished
        // anything, and it outranks the record — a strong application from a driver three weeks into a
        // probation they are already trying to leave is still an application nobody wants. Second-chance
        // carriers are exempt, because looking past exactly this is what they are for.
        var jumpingProbation = s.Onboarded && Probation.IsOn(s) && !spec.SecondChance;
        if (jumpingProbation)
        {
            d.ChancePct = Math.Min(d.ChancePct, HiringStanding.OnProbationChancePct);
            d.Standing = HiringStanding.Marginal;
        }

        if (d.ChancePct < 100 && !HiringStanding.Roll(s, spec.Code, cond.Period, d.ChancePct))
        {
            if (jumpingProbation)
            {
                d.Hired = false;
                d.Decision = $"{spec.Name} — application declined";
                d.Reasons.Add("You are still on probation where you are. Nobody here is going to take on a " +
                              "driver who has not finished the last place — clear it first and this is a " +
                              "different conversation.");
                d.Conditions.Add("Finish your probation. It is the single thing standing between you and " +
                                 "this application being taken seriously.");
                return d;
            }

            d.Hired = false;
            d.Decision = $"{spec.Name} — application declined";
            d.Reasons.Add($"{cond.State}. {cond.Note}");
            d.Reasons.Add("You meet what they ask for, but only just, and this month they had people in " +
                          "front of them who cleared it by more. Nothing on your record is disqualifying — " +
                          "you were simply not the strongest application on the desk.");
            d.Conditions.Add($"Their hiring is reviewed around {GameClock.Pretty(cond.ReviewedOn)}. " +
                             "More loads behind you, or a better month for them, and this goes the other way.");
            return d;
        }


        d.Hired = true;
        d.Decision = $"{spec.Name} — offer extended";
        if (cond.State != "Steady") d.Reasons.Add($"{cond.State}. {cond.Note}");
        if (notes.Count > 0) d.Reasons.AddRange(notes);
        d.Reasons.Add(spec.Blurb);
        if (cond.PayFactor > 1m)
            d.Conditions.Add($"They are paying {(cond.PayFactor - 1m) * 100:0}% over their posted scale while they are short of drivers.");

        if (app != null)
        {
            if (spec.Divisions[0].Equals(app.PreferredDivision, StringComparison.OrdinalIgnoreCase))
                d.Reasons.Add($"Their main division is {spec.Divisions[0]}, which is exactly what you asked for.");
            else if (spec.Divisions.Any(dv => dv.Equals(app.PreferredDivision, StringComparison.OrdinalIgnoreCase)))
                d.Reasons.Add($"They run {app.PreferredDivision} alongside {spec.Divisions[0]}, so you will see the freight you wanted.");
            else
                d.Conditions.Add($"Note they run {string.Join(", ", spec.Divisions)} — not the {app.PreferredDivision} you put first.");
        }

        d.Conditions.Add("Every driver starts on probation here.");
        if (spec.Specialized) d.Conditions.Add("Specialised freight — expect a longer orientation before they turn you loose.");
        if (totalLoads > 0) d.Conditions.Add($"Starting rate reflects your {totalLoads} loads of history.");
        return d;
    }

    /// <summary>
    /// The parts of an offer that do not depend on how close the call was. Shared so a driver taken on
    /// a stretch gets the same briefing as one who walked in — the freight, the divisions, the
    /// probation note.
    /// </summary>
    private static void FinishOffer(AppState s, HireDecision d, Spec spec, CarrierCondition cond,
        DriverApplication? app, int totalLoads, List<string> notes)
    {
        if (notes.Count > 0) d.Reasons.AddRange(notes);
        d.Reasons.Add(spec.Blurb);
        if (cond.PayFactor > 1m)
            d.Conditions.Add($"They are paying {(cond.PayFactor - 1m) * 100:0}% over their posted scale while they are short of drivers.");

        if (app != null)
        {
            if (spec.Divisions[0].Equals(app.PreferredDivision, StringComparison.OrdinalIgnoreCase))
                d.Reasons.Add($"Their main division is {spec.Divisions[0]}, which is exactly what you asked for.");
            else if (spec.Divisions.Any(dv => dv.Equals(app.PreferredDivision, StringComparison.OrdinalIgnoreCase)))
                d.Reasons.Add($"They run {app.PreferredDivision} alongside {spec.Divisions[0]}, so you will see the freight you wanted.");
        }

        d.Conditions.Add("Every driver starts on probation here.");
        if (spec.Specialized) d.Conditions.Add("Specialised freight — expect a longer orientation before they turn you loose.");
        if (totalLoads > 0) d.Conditions.Add($"Starting rate reflects your {totalLoads} loads of history.");
    }

    /// <summary>A carrier's hiring bar, condition-adjusted, for anything that needs to reason about it.</summary>
    public static (double MinYears, int MinLoads, double MinOnTime, int MaxFaults, double MaxAvgDamage)
        StandardsOf(AppState s, string code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code ?? "", StringComparison.OrdinalIgnoreCase));
        if (spec == null) return (0, 0, 0, 99, 100);
        var cond = ConditionOf(s, spec.Code);
        return (Math.Max(0, spec.MinYears + cond.YearsShift),
                (int)Math.Round(spec.MinLoads * cond.LoadsFactor),
                Math.Clamp(spec.MinOnTime + cond.OnTimeShift, 0, 100),
                spec.MaxFaults, spec.MaxAvgDamage);
    }

    /// <summary>Declared years plus time served, which is what every bar is actually measured against.</summary>
    public static double CreditedExperienceFor(AppState s) =>
        CreditedExperience(s, s.Application?.ExperienceYears ?? 0);

    /// <summary>Whether the driver is under this carrier's skill requirement on anything.</summary>
    public static bool HasSkillShortfall(AppState s, string code) => SkillShortfalls(s, code).Count > 0;

    /// <summary>A carrier's equipment standard by code, for careers written before it was stored.</summary>
    public static int EquipmentStarsFor(string? code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals((code ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        return spec == null ? 3 : spec.EquipmentStars;
    }

    /// <summary>
    /// The terminal cities a carrier code runs, for backfilling a career written before the network was
    /// stored. Empty for a code we do not recognise — a fictional carrier has no real network to honour,
    /// and returning a guess would invent terminals the company does not have.
    /// </summary>
    /// <summary>
    /// What a carrier code is like to work for: pay stars and home-time stars. Zeroes for a code we do
    /// not recognise, because a generated carrier has no published standing to look up.
    /// </summary>
    public static (int Pay, int HomeTime) StandingFor(string? code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals((code ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        return spec == null ? (0, 0) : (spec.PayStars, spec.HomeTimeStars);
    }

    /// <summary>Where a carrier is headquartered, without having to be employed by them.</summary>
    public static (string City, string State) HeadquartersOf(string? code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals((code ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        return spec == null ? ("", "") : (spec.HqCity, spec.HqState);
    }

    public static List<string> NetworkCitiesFor(string? code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals((code ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        return spec == null ? new List<string>() : NetworkFor(spec);
    }

    /// <summary>Turns a chosen carrier into the player's employer: company, terminals, pay.</summary>

    /// <param name="markHqReached">
    /// Whether being employed here proves the driver has been to the headquarters city.
    ///
    /// True on a first hire — they are standing in the yard. False when they are changing employer to a
    /// carrier based somewhere they have never driven: they have to get themselves there first, and
    /// marking the city reached before they have would hand them freight out of a city ATS will not
    /// generate any for. See <see cref="Changeover"/>.
    /// </param>
    public static void Employ(AppState s, string code, DriverApplication app, bool markHqReached = true)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code, StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("No such carrier.");

        // Garages the driver bought in ATS survive a change of employer — the app cannot un-buy them.
        var keptTerminals = s.Company.Terminals.Count > 0 ? s.Company.Terminals.ToList() : null;

        s.Company = new Company
        {
            Name = spec.Name,
            Code = spec.Code,
            DotNumber = $"{2_100_000 + Math.Abs(spec.Code.GetHashCode() % 800_000)}",
            McNumber = $"MC-{500_000 + Math.Abs((spec.Code + spec.HqState).GetHashCode() % 400_000)}",
            TerminalCity = spec.HqCity,
            TerminalState = spec.HqState,
            Founded = "2009",
            EquipmentStars = spec.EquipmentStars,
            // What this carrier is like to work for. Decides how well the fleet holds onto drivers:
            // a good outfit keeps its people, a poor one trains them up and watches them leave.
            PayStars = spec.PayStars,
            HomeTimeStars = spec.HomeTimeStars,
            Divisions = spec.Divisions.ToList(),
            OperatingAuthorityNotes = $"48-state common carrier authority. {string.Join(" / ", spec.Divisions)} divisions.",
            // Where this carrier actually runs terminals. A company driver does not decide where their
            // employer opens yards, so this is what garage opportunities are checked against — without
            // it the app offers a yard in every town the truck passes through.
            NetworkCities = NetworkFor(spec)
        };

        s.Company.NetworkCities = NetworkFor(spec);

        // Yards the driver already owns stay theirs — they bought those garages in ATS and switching
        // employer does not repossess them. Only the headquarters moves.
        //
        // The carrier's other yards are deliberately NOT created: a yard in a city the driver has not
        // driven to would never see cargo, because ATS does not generate freight for undiscovered
        // cities. They appear as the driver reaches them. See DiscoveryService.
        var existing = keptTerminals ?? new List<Terminal>();
        s.Company.Terminals.Clear();
        s.Company.Terminals.AddRange(existing);

        var hq = s.Company.Terminals.FirstOrDefault(t =>
            t.City.Equals(spec.HqCity, StringComparison.OrdinalIgnoreCase));
        if (hq == null)
        {
            hq = Migrations.BuildTerminal(s, spec.HqCity, spec.HqState, isHq: true, "Small");
            s.Company.Terminals.Add(hq);
        }
        foreach (var t in s.Company.Terminals) t.IsHeadquarters = t == hq;
        Migrations.SyncHeadquarters(s);

        // The yard you are based out of counts as reached — you are standing in it. Seed does this for
        // a generated carrier; without it here, hiring at a real one left the home city off the map.
        //
        // Not on a changeover to a city nobody has driven to, though. There the drive is the first thing
        // the driver owes, and saying otherwise would put freight on the board that ATS never generates.
        if (markHqReached) DiscoveryService.Note(s, spec.HqCity, spec.HqState, s.Status.GameTime);
        DiscoveryService.SyncOwnership(s);
        s.Settings.FreightPrefix = spec.Code;

        Seed.ApplyDefaultAccounts(s);
        var scale = spec.Size switch { "Large" => 3.2m, "Regional" => 1.0m, _ => 0.55m };
        SetOpening(s, LedgerService.Operating, Math.Round(184_500m * scale, 0));
        SetOpening(s, LedgerService.MaintenanceReserve, Math.Round(46_000m * scale, 0));
        SetOpening(s, LedgerService.PayrollReserve, Math.Round(28_500m * scale, 0));
        SetOpening(s, LedgerService.EquipmentNote, Math.Round(-412_000m * scale, 0));

        ApplyPayScale(s, code, app);
    }

    /// <summary>
    /// Sets pay from the carrier's posted scale. Must run AFTER the generic hire setup, which has
    /// its own starting-rate table — the employer's scale is what the driver is actually paid.
    /// A driver short of the carrier's experience bar starts under the posted rate, which is how
    /// carriers really treat drivers they are taking a chance on.
    /// </summary>
    public static void ApplyPayScale(AppState s, string code, DriverApplication app)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals(code, StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("No such carrier.");

        var years = app?.ExperienceYears ?? 0;
        var totalLoads = s.Driver.PriorLoads;
        var cond = ConditionOf(s, code);
        // Probation pays under the carrier's own scale — the same rung the ladder calls probationary.
        // Without this an experienced hire started ON the company rate, and clearing probation was worth
        // nothing at all: same money, new title.
        var probationary = MultiplierFor("probationary");
        var underTheBar = years < spec.MinYears && totalLoads < 20;
        var entry = underTheBar ? 0.85m : probationary;

        var loaded = Math.Round(spec.LoadedCpm * cond.PayFactor * entry, 3);
        var deadhead = Math.Round(spec.DeadheadCpm * cond.PayFactor * entry, 3);
        var note = underTheBar
            ? $"{spec.Name} entry scale — under even their probationary rate, on experience. It comes up when probation clears."
            : cond.PayFactor > 1m
                ? $"{spec.Name} probationary scale, {(cond.PayFactor - 1m) * 100:0}% over posted while they are short of drivers."
                : $"{spec.Name} probationary scale.";

        // A driver arriving with real history is worth more than a first-timer, even on probation.
        if (!underTheBar && totalLoads >= 60)
        {
            loaded = Math.Round(loaded * 1.04m, 3);
            deadhead = Math.Round(deadhead * 1.04m, 3);
            note = $"{spec.Name} probationary scale with a seniority premium for {totalLoads} loads of history.";
        }

        s.Driver.Pay.LoadedCpm = loaded;
        s.Driver.Pay.DeadheadCpm = deadhead;
        s.Driver.Pay.Notes = note;
        if (spec.NeedsHazmat) s.Driver.Pay.HazmatCpm = 0.06m;
        if (spec.Divisions.Contains("Heavy Haul")) s.Driver.Pay.OversizeCpm = 0.09m;
        if (spec.Divisions.Contains("Reefer")) s.Driver.Pay.ReeferCpm = Math.Max(s.Driver.Pay.ReeferCpm, 0.03m);
    }

    /// <summary>
    /// What the driver has to go and do in ATS before the first dispatch makes sense. The app can
    /// model a carrier, but only the player can buy the garage and the truck in the game.
    /// </summary>
    public static List<SetupStep> SetupChecklist(AppState s)
    {
        var truck = DispatchEngine.AssignedTruck(s);
        var trailer = DispatchEngine.AssignedTrailer(s);
        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
        var steps = new List<SetupStep>();

        // The honest first conversation: this carrier costs more than a new profile has.
        var yardCount = s.Company.Terminals.Count;
        var truckCount = s.Trucks.Count;
        steps.Add(new SetupStep
        {
            Title = "First — you start with one yard and one truck",
            Detail =
                $"{s.Company.Name} opens with {yardCount} yard and {truckCount} tractor, because that is what " +
                "a fresh ATS profile can afford. Seed some cash with an editor and you can start bigger: buy " +
                "a large garage, set the yard to Large here, and stock it with a full fleet from the Fleet " +
                "tab in one step.\n\n" +
                "What money cannot buy you is coverage. ATS only generates cargo for cities you have actually " +
                "driven to — reveal a city with a save editor and it stays undiscovered as far as the freight " +
                "system is concerned, so no jobs will ever appear there.\n\n" +
                "So the network grows the way a real one does. Run out of your home yard, and when you reach " +
                "somewhere new the app tells you a garage is for sale there and whether the freight is worth " +
                "it. Buy it in game, add it on the Terminals tab, and base trucks there.\n\n" +
                "For seeding cash: saves live in " +
                "Documents\\American Truck Simulator\\profiles\\<profile>\\save\\<slot>\\game.sii and are " +
                "encrypted — SII_Decrypt decrypts them for editing, and TS SE Tool is a purpose-built " +
                "editor. Money sits in the economy section of game.sii. Mods can also unlock all dealerships " +
                "and recruiting agencies, which ATS otherwise hides until you drive past them.",
            Why = "The app cannot buy anything in your game, and it will not pretend to own equipment ATS " +
                  "has never heard of — a fabricated damage figure could never be reconciled with the game.",
            Caution =
                "Back up your profile folder before running any editor. Save editors can corrupt a save, " +
                "TS SE Tool is explicitly alpha software, and SCS cannot offer support on a modified save " +
                "because they cannot tell what was changed. Note that editing cities to be visible does NOT " +
                "make them discovered — they will show on the map and still never offer freight."
        });

        steps.Add(new SetupStep
        {
            Title = $"Buy a garage in {s.Company.TerminalCity}, {s.Company.TerminalState}",
            Detail = "This is your headquarters yard. A small garage — one truck — is all you need to start, " +
                     "and it is what a fresh profile can afford.\n\n" +
                     "It is not a ceiling. If you have seeded cash, buy the large garage instead, set the " +
                     "tier to Large on the Terminals tab, and use 'Stock a yard' on the Fleet tab to put a " +
                     "five-truck fleet in it in one step. Tier decides capacity: Small 1, Medium 3, Large 5, " +
                     "matching the ATS garage upgrades. Upgrade the garage in game whenever you want more room.\n\n" +
                     "If you already own a garage elsewhere, either buy one here or edit the terminal so the " +
                     "app matches your game.",
            Why = "Dispatch plans your first load out of this city and treats it as home. Start where you " +
                  "are standing — that city is discovered, so it will actually offer freight."
        });

        if (truck != null)
            steps.Add(new SetupStep
            {
                Title = $"Buy a tractor — {truck.Year} {truck.Make} {truck.Model}",
                Detail = $"Spec it with a {truck.Transmission} and governed around {truck.GovernedMph} mph if you can. " +
                         "Exact match is not required: buy what you can afford, then open Fleet → " +
                         $"unit {truck.Ref} → Edit and change the make, model, transmission and governed speed " +
                         "to what you actually bought. The planner uses those numbers for drive time.",
                Why = "Governed speed and fuel capacity drive every feasibility calculation."
            });

        if (trailer != null)
            steps.Add(new SetupStep
            {
                Title = $"Decide on trailers — you are assigned {trailer.Ref}, a {trailer.Length} " +
                        $"{TrailerSpec.Describe(trailer.Type, trailer.Subtype)}",
                Detail = $"{s.Company.Name} runs {string.Join(", ", s.Company.Divisions)}. You can either buy your own " +
                         (TrailerSpec.IsTanker(trailer.Type)
                            ? $"in ATS — {TrailerSpec.BuyingAdvice(s, trailer.Type, trailer.Subtype)} — and run company trailers, "
                            : $"{trailer.Type.ToLowerInvariant()} in ATS and run company trailers, ") +
                         "or just take market trailers with each job and treat the company trailer as paperwork. " +
                         "Either works — the app only needs to know which trailer type you are pulling so it can gate " +
                         "freight correctly.",
                Why = "Freight requiring a trailer you cannot pull is hard-rejected at dispatch."
            });

        // The other yards are not decoration — every one of them is discounted fuel and a shop.
        var others = s.Company.Terminals.Where(t => !t.IsHeadquarters).ToList();
        if (others.Count > 0)
        {
            var withShop = others.Where(t => t.HasShop).Select(t => t.City).ToList();
            steps.Add(new SetupStep
            {
                Title = $"Buy the other {others.Count} company yard(s) as you can afford them",
                Detail = $"{s.Company.Name} operates {others.Count} more yard(s): " +
                         string.Join(", ", others.Select(t => $"{t.City}, {t.State} ({t.Level})")) + ". " +
                         "Buy a garage in each of those cities in ATS when the money allows. You do not need " +
                         "them all on day one — but every yard you own is somewhere you can pull in for " +
                         "contract fuel and shop work instead of paying retail on the road. " +
                         (withShop.Count > 0
                            ? $"The yards with a repair shop are {string.Join(", ", withShop)}."
                            : "Only the headquarters has a shop at this tier.") +
                         " If you would rather run a different network, edit or delete yards on the Fleet tab.",
                Why = "Fuel and repairs are the two biggest costs against the company, and a yard cuts both."
            });
        }

        steps.Add(new SetupStep
        {
            Title = "Build out the fleet and hire drivers in ATS",
            Detail = "Your truck is one unit; the company is bigger than you. In ATS, buy additional tractors " +
                     "and trailers and hire AI drivers to run them, assigning each to one of the company yards. " +
                     "Then in this app go to Fleet → Hired drivers, add each driver with the unit they are on, " +
                     "and tick those units as being in your ATS garage. Once a week (or whenever suits) file a " +
                     "Fleet report with each driver's revenue, miles and current damage reading off the game.",
            Why = "That is what makes the company's books real: hired-driver revenue funds the payroll and " +
                  "maintenance reserves, and their trucks accumulate wear that the shop has to deal with."
        });

        steps.Add(new SetupStep
        {
            Title = "Park at the yard and report your status",
            Detail = $"Drive to {s.Company.TerminalCity}, then on the Dispatch tab set the in-game date and time, " +
                     "location and fuel level, and hit Update status.",
            Why = "Every feasibility check is measured from where you are and what time it is."
        });

        steps.Add(new SetupStep
        {
            Title = "Report your HOS clocks",
            Detail = "Type in what your HOS display shows for drive, shift, break and cycle. Running vanilla with no " +
                     "HOS mod? Leave the full clocks as they are and use the app's numbers as the roleplay layer. " +
                     "If you play without the 30-minute break, switch it off in Settings → HOS rule set.",
            Why = "Your HOS display is authoritative — the app never invents clock values."
        });

        steps.Add(new SetupStep
        {
            Title = "Show operations the freight board",
            Detail = "Open the freight market in ATS and enter the jobs you can see on the Dispatch tab, or paste " +
                     "screenshots of the board if you have set up an API key. Then hit Evaluate & assign.",
            Why = $"Your first load will be {DispatchEngine.PeekNumber(s, "Freight")}."
        });

        if (hq is { HasShop: true })
            steps.Add(new SetupStep
            {
                Title = "Optional — remember the yard has a shop",
                Detail = $"{hq.City} has a repair shop ({hq.ShopLabourDiscount * 100:0}% off labour) and contract fuel at " +
                         $"${hq.FuelPricePerGal:0.00}/gal. Bringing damage home is cheaper than fixing it on the road.",
                Why = "Maintenance cost comes out of the company's reserve, which funds your equipment."
            });

        return steps;
    }

    private static void SetOpening(AppState s, string key, decimal amount)
    {
        var a = s.Accounts.FirstOrDefault(x => x.Key == key);
        if (a != null) a.OpeningBalance = amount;
    }
}

public class SetupStep
{
    public string Title { get; set; } = "";
    public string Detail { get; set; } = "";
    public string Why { get; set; } = "";
    /// <summary>Risk the player should read before acting — shown as a warning, not a footnote.</summary>
    public string Caution { get; set; } = "";
}

public class CarrierListing
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Divisions { get; set; } = new();
    public string PrimaryDivision { get; set; } = "";
    public string Size { get; set; } = "";
    public string HqCity { get; set; } = "";
    public string HqState { get; set; } = "";
    public List<string> Yards { get; set; } = new();
    /// <summary>What they would pay this period, after any condition adjustment.</summary>
    public decimal LoadedCpm { get; set; }
    public decimal DeadheadCpm { get; set; }
    /// <summary>Their normal posted rate, for comparison when conditions have moved it.</summary>
    public decimal PostedLoadedCpm { get; set; }
    public int EquipmentStars { get; set; }
    public int HomeTimeStars { get; set; }
    public int PayStars { get; set; }
    public string Blurb { get; set; } = "";
    public string StandardsNote { get; set; } = "";
    public bool RequiresHazmat { get; set; }
    /// <summary>The hazmat classes their freight actually carries. Empty means nothing placarded.</summary>
    public List<string> RequiresClasses { get; set; } = new();

    /// <summary>Those classes in words, for the job market card.</summary>
    public string RequiresClassesLabel { get; set; } = "";

    /// <summary>Days of service still needed to clear their experience bar. 0 when years are not the problem.</summary>
    public int DaysToQualify { get; set; }

    /// <summary>Skill levels this carrier asks for, in words. Empty when they ask for none.</summary>
    public List<string> SkillsWanted { get; set; } = new();

    /// <summary>Which of those the driver is short of, and by how much. Empty when they clear the bar.</summary>
    public List<string> SkillShortfall { get; set; } = new();

    /// <summary>Clears their bars by a margin, so they would come in above probation.</summary>
    public bool StartsAboveProbation { get; set; }

    /// <summary>How far they promote, and what the top of their scale pays.</summary>
    public string CeilingRank { get; set; } = "";
    public string CeilingTitle { get; set; } = "";
    public decimal TopLoadedCpm { get; set; }
    public bool TakesRookies { get; set; }
    public bool Specialized { get; set; }
    public double MinExperienceYears { get; set; }

    /// <summary>
    /// What they normally ask, before business conditions moved it. Kept beside the effective figure so
    /// a raised or lowered bar reads as exactly that rather than looking like a mistake.
    /// </summary>
    public double PostedMinExperienceYears { get; set; }
    public int PostedMinLoads { get; set; }
    public double PostedMinOnTimePct { get; set; }
    public int MinLoads { get; set; }
    public double MinOnTimePct { get; set; }
    public int MaxDriverFaultIncidents { get; set; }
    public double MaxAvgDamage { get; set; }

    /// <summary>
    /// Looks past a termination, and past an unfinished probation. Exposed so the driver can see which
    /// doors stay open when the rest of the board closes — that is the whole point of these carriers,
    /// and it was only knowable from inside the screening.
    /// </summary>
    public bool IsSecondChance { get; set; }
    public bool WouldHire { get; set; }

    /// <summary>Strong | Marginal | Short — how the driver reads against this carrier's bar.</summary>
    public string Standing { get; set; } = "";

    /// <summary>The odds, where it was a close call. 100 when the margin makes it certain.</summary>
    public int ChancePct { get; set; }

    /// <summary>What that means, said before the driver applies rather than after they are refused.</summary>
    public string StandingNote { get; set; } = "";
    public bool IsCurrentEmployer { get; set; }
    /// <summary>A real company — its name, headquarters and freight are factual; pay is not.</summary>
    public bool IsRealCompany { get; set; }
    /// <summary>Experience a hiring office would credit: declared + time served + freight hauled.</summary>
    public double CreditedExperienceYears { get; set; }
    /// <summary>Loads still needed to clear their gates; 0 when loads are not the blocker.</summary>
    public int LoadsToQualify { get; set; }
    /// <summary>How their business is going this game-month, and what it does to their hiring.</summary>
    public CarrierCondition Condition { get; set; } = new();
    public HireDecision Screening { get; set; } = new();
}

/// <summary>A carrier's business condition for one game-month.</summary>
public class CarrierCondition
{
    /// <summary>Expanding | Steady | Tightening | Hiring freeze</summary>
    public string State { get; set; } = "Steady";
    public string Note { get; set; } = "";
    public bool Hiring { get; set; } = true;
    /// <summary>Game time at which this condition is re-rolled.</summary>
    public string ReviewedOn { get; set; } = "";
    public int Period { get; set; }
    public double YearsShift { get; set; }
    public double LoadsFactor { get; set; } = 1;
    public double OnTimeShift { get; set; }
    public decimal PayFactor { get; set; } = 1m;
}
