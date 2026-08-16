using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The carrier job market. The same catalogue serves the first job and every move after it: you
/// apply, they screen you against their own standards, and they can turn you down. A carrier you
/// cannot get into today is one to come back to with more experience.
/// </summary>
public static class Carriers
{
    private record Spec(
        string Name, string Code, string[] Divisions,
        string Size, string HqCity, string HqState, string[] OtherYards,
        decimal LoadedCpm, decimal DeadheadCpm,
        double MinYears, int MinLoads, double MinOnTime, int MaxFaults, double MaxAvgDamage,
        bool NeedsHazmat, bool NeedsTanker, bool TakesRookies, bool Specialized,
        int EquipmentStars, int HomeTimeStars, int PayStars,
        string Blurb, string StandardsNote);

    /// <summary>
    /// Real US carriers. Names, headquarters, freight specialities and whether they run a
    /// driver-training programme are drawn from what these companies publish about themselves.
    ///
    /// Pay rates, hiring standards and star ratings here are ROLEPLAY VALUES invented for the game.
    /// They are not these companies' real terms of employment, and the app says so wherever they
    /// are shown. Nothing here characterises a real employer's equipment, safety or treatment of
    /// drivers — only the publicly known facts of what they haul and where they are based.
    /// </summary>
    private static readonly Spec[] RealWorld =
    {
        new("Schneider National", "SNI",
            new[] { "Dry Van", "Intermodal", "Dedicated", "Tanker" }, "Large",
            "Green Bay", "WI", new[] { "Dallas,TX", "Charlotte,NC", "Phoenix,AZ", "Chicago,IL" },
            0.52m, 0.42m, 0, 0, 0, 99, 100, false, false, true, false, 2, 2, 2,
            "One of the largest carriers in North America, running dry van, intermodal drayage and dedicated fleets out of Green Bay. Runs one of the industry's biggest driver-training programmes and regularly hires drivers straight out of CDL school.",
            "Hires inexperienced drivers through their training programme."),

        new("Werner Enterprises", "WER",
            new[] { "Dry Van", "Dedicated", "Reefer", "Intermodal" }, "Large",
            "Omaha", "NE", new[] { "Dallas,TX", "Atlanta,GA", "Phoenix,AZ" },
            0.50m, 0.40m, 0, 0, 0, 99, 100, false, false, true, false, 2, 2, 2,
            "Omaha-based nationwide truckload carrier running van, dedicated, temperature-controlled and intermodal freight. Long-standing entry point for new drivers.",
            "Takes recent CDL graduates."),

        new("Knight-Swift Transport", "KNX",
            new[] { "Dry Van", "Intermodal", "Reefer", "Dedicated" }, "Large",
            "Phoenix", "AZ", new[] { "Dallas,TX", "Atlanta,GA", "Memphis,TN", "Denver,CO" },
            0.51m, 0.41m, 0, 0, 0, 99, 100, false, false, true, false, 2, 2, 2,
            "The largest truckload carrier in the United States after the Knight and Swift merger, headquartered in Phoenix. Van, reefer, intermodal and dedicated across the whole country.",
            "Hires new CDL holders."),

        new("C.R. England", "CRE",
            new[] { "Reefer", "Dedicated", "Dry Van" }, "Large",
            "Salt Lake City", "UT", new[] { "Dallas,TX", "Indianapolis,IN", "Phoenix,AZ" },
            0.53m, 0.43m, 0, 0, 0, 99, 100, false, false, true, false, 2, 2, 2,
            "Salt Lake City refrigerated carrier, one of the biggest reefer fleets in the country, with dedicated and van divisions alongside. Operates large driver-training and hiring programmes for people entering the industry.",
            "Trains and hires inexperienced drivers."),

        new("Roehl Transport", "ROE",
            new[] { "Flatbed", "Reefer", "Dry Van", "Dedicated" }, "Regional",
            "Marshfield", "WI", new[] { "Chicago,IL", "Dallas,TX", "Atlanta,GA" },
            0.56m, 0.45m, 0, 0, 88, 3, 10, false, false, true, false, 4, 4, 3,
            "Family-owned Wisconsin carrier running flatbed, refrigerated and dry van, with around 2,000 trucks. Offers on-the-job training for recent CDL school graduates and is known for structured onboarding and home-time programmes.",
            "Hires inexperienced drivers with on-the-job training."),

        new("Prime Inc.", "PRI",
            new[] { "Reefer", "Flatbed", "Tanker", "Dry Van" }, "Large",
            "Springfield", "MO", new[] { "Salt Lake City,UT", "Pittston,PA", "Denver,CO" },
            0.57m, 0.46m, 0, 0, 88, 3, 9, false, false, true, false, 4, 3, 4,
            "Springfield, Missouri carrier with large refrigerated, flatbed and tanker divisions and over $2.5 billion in revenue. Its size and constant demand make it a common first job for new CDL graduates.",
            "Runs a well-known training programme for new drivers."),

        new("Marten Transport", "MRT",
            new[] { "Reefer", "Dedicated", "Intermodal" }, "Regional",
            "Mondovi", "WI", new[] { "Dallas,TX", "Atlanta,GA", "Ontario,CA" },
            0.59m, 0.48m, 2, 0, 93, 1, 6, false, false, false, false, 4, 3, 4,
            "A leader in refrigerated transportation, based in Mondovi, Wisconsin. Temperature-controlled truckload, dedicated and intermodal — food-grade freight with tight appointment windows.",
            "Two years of verifiable experience."),

        new("KLLM Transport Services", "KLM",
            new[] { "Reefer", "Dedicated", "Dry Van" }, "Regional",
            "Richland", "MS", new[] { "Dallas,TX", "Atlanta,GA", "Laredo,TX" },
            0.58m, 0.47m, 1, 0, 92, 1, 7, false, false, false, false, 3, 3, 3,
            "Mississippi-based temperature-controlled carrier that has moved perishables across the US and Mexico for around fifty years. Heavy cross-border produce and food freight.",
            "One year, or their training programme."),

        new("Melton Truck Lines", "MEL",
            new[] { "Flatbed", "Step Deck" }, "Regional",
            "Tulsa", "OK", new[] { "Laredo,TX", "Birmingham,AL", "Salt Lake City,UT" },
            0.62m, 0.50m, 2, 0, 92, 1, 6, false, false, false, true, 4, 2, 4,
            "Tulsa-based flatbed specialist running steel, building products and machinery across the US, Canada and Mexico. Tarping and load securement are the daily job.",
            "Two years, open-deck experience strongly preferred."),

        new("Maverick Transportation", "MAV",
            new[] { "Flatbed", "Step Deck", "Reefer" }, "Regional",
            "North Little Rock", "AR", new[] { "Dallas,TX", "Atlanta,GA", "Chicago,IL" },
            0.63m, 0.51m, 2, 0, 93, 1, 5, false, false, false, true, 4, 3, 4,
            "Arkansas open-deck carrier known for flatbed, glass and specialised securement work, with a temperature-controlled division alongside.",
            "Two years and demonstrated securement ability."),

        new("PS Logistics", "PSL",
            new[] { "Flatbed", "Step Deck", "Heavy Haul" }, "Large",
            "Birmingham", "AL", new[] { "Houston,TX", "Atlanta,GA", "Indianapolis,IN" },
            0.61m, 0.49m, 2, 0, 90, 2, 7, false, false, false, true, 3, 2, 4,
            "One of the largest flatbed operators in the country, grown through acquisition and headquartered in Birmingham, Alabama. Steel, building materials and heavy specialised freight.",
            "Two years of open-deck work."),

        new("Anderson Trucking Service", "ATS",
            new[] { "Heavy Haul", "Flatbed", "Step Deck", "Lowboy" }, "Regional",
            "St. Cloud", "MN", new[] { "Houston,TX", "Denver,CO", "Chicago,IL" },
            0.72m, 0.58m, 4, 25, 95, 0, 5, false, false, false, true, 5, 2, 5,
            "St. Cloud, Minnesota specialised carrier known for heavy haul, wind-energy components and oversized machinery. Permitted, route-surveyed freight.",
            "Four years and real heavy-haul history."),

        new("Bennett Motor Express", "BEN",
            new[] { "Heavy Haul", "Lowboy", "Flatbed", "Step Deck" }, "Regional",
            "McDonough", "GA", new[] { "Houston,TX", "Chicago,IL", "Denver,CO" },
            0.74m, 0.60m, 5, 40, 96, 0, 4, false, false, false, true, 5, 3, 5,
            "Georgia-based specialised and heavy-haul carrier moving oversize machinery, transformers and project cargo. Every load is planned around permits and routing.",
            "Five years and forty loads of verifiable specialised history."),

        new("Groendyke Transport", "GRO",
            new[] { "Tanker", "Hazmat", "Bulk" }, "Regional",
            "Enid", "OK", new[] { "Houston,TX", "Baton Rouge,LA", "Odessa,TX" },
            0.70m, 0.57m, 2, 0, 94, 1, 5, true, true, false, true, 4, 2, 5,
            "Enid, Oklahoma chemical and petroleum tank carrier. Placarded liquid bulk with the regulatory load that comes with it.",
            "Hazmat and tanker endorsements required."),

        new("Trimac Transportation", "TRI",
            new[] { "Tanker", "Bulk", "Pneumatic", "Hazmat" }, "Large",
            "Houston", "TX", new[] { "Baton Rouge,LA", "Chicago,IL", "Salt Lake City,UT" },
            0.68m, 0.55m, 2, 0, 94, 1, 5, true, true, false, true, 4, 2, 4,
            "Bulk tank carrier hauling chemicals, fuels and dry bulk across North America, with a strong emphasis on safety and driver training.",
            "Tanker and hazmat endorsements required."),

        new("Kenan Advantage Group", "KAG",
            new[] { "Tanker", "Bulk", "Hazmat" }, "Large",
            "North Canton", "OH", new[] { "Houston,TX", "Atlanta,GA", "Chicago,IL" },
            0.66m, 0.53m, 1, 0, 93, 1, 6, false, true, false, true, 4, 3, 4,
            "North Canton, Ohio bulk transporter — fuel delivery, chemicals and food-grade liquid across a large regional network. Shorter runs and more home time than most tank work.",
            "Tanker endorsement required; one year minimum."),

        new("Jack Cooper Transport", "JCT",
            new[] { "Auto", "Dry Van" }, "Regional",
            "Kansas City", "MO", new[] { "Detroit,MI", "Louisville,KY", "Dallas,TX" },
            0.65m, 0.53m, 3, 15, 95, 1, 3, false, false, false, true, 4, 3, 4,
            "Kansas City finished-vehicle carrier moving cars from assembly plants to dealers on multi-car rigs. Every unit is inspected at both ends.",
            "Three years and a clean damage record."),

        new("United Road Services", "URS",
            new[] { "Auto", "Dry Van" }, "Regional",
            "Romulus", "MI", new[] { "Dallas,TX", "Atlanta,GA", "Newark,NJ" },
            0.64m, 0.52m, 3, 15, 94, 1, 3, false, false, false, true, 4, 3, 4,
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
            0.46m, 0.36m, 0, 0, 0, 99, 100, false, false, true, false, 2, 2, 1,
            "Big nationwide van fleet running dry van, reefer and rail drayage. Freight is never short and neither are the miles, but the pay is bottom-of-market and the trucks are governed low. Where a lot of drivers get their first year.",
            "Takes anyone with a Class A. No experience required."),

        new("Sierra Freight Lines", "SFL",
            new[] { "Dry Van", "Reefer", "Flatbed" }, "Regional",
            "Phoenix", "AZ", new[] { "Denver,CO", "Salt Lake City,UT" },
            0.54m, 0.44m, 1, 0, 90, 2, 8, false, false, true, false, 3, 3, 3,
            "Steady southwestern regional. Mostly van and reefer with a small open-deck division for building materials. Treats drivers decently and will take a developing driver who wants to learn.",
            "One year preferred, not required. They will look past a rough patch."),

        new("Cold Harbor Carriers", "CHC",
            new[] { "Reefer", "Dry Van" }, "Regional",
            "Fresno", "CA", new[] { "Denver,CO", "Dallas,TX" },
            0.58m, 0.47m, 2, 0, 93, 1, 6, false, false, false, false, 3, 3, 3,
            "Produce and frozen out of the Central Valley. Appointment freight, tight windows, and they care about service numbers more than anything else.",
            "Two years and a service record they can actually look at."),

        new("Ironline Transport", "ILT",
            new[] { "Flatbed", "Step Deck", "Heavy Haul" }, "Regional",
            "Salt Lake City", "UT", new[] { "Denver,CO", "Casper,WY", "Boise,ID" },
            0.62m, 0.50m, 2, 0, 92, 1, 6, false, false, false, true, 4, 2, 4,
            "Steel, building materials and machinery across the mountain west. Flatbed and step deck daily, with an RGN division for the bigger machinery moves. Tarping is part of the job and the pay reflects it.",
            "Two years minimum. Open-deck experience helps a great deal."),

        new("Great Plains Livestock", "GPL",
            new[] { "Livestock", "Ag", "Hopper", "Reefer" }, "Regional",
            "Amarillo", "TX", new[] { "Dodge City,KS", "Grand Island,NE", "Sioux Falls,SD" },
            0.60m, 0.48m, 2, 0, 90, 1, 7, false, false, false, true, 3, 2, 3,
            "Cattle, grain and ag freight through the plains. Pot loads, hopper bottoms and some reefer in season. Live loads, odd hours, and a schedule that answers to the animals rather than to you.",
            "Two years. Livestock is its own skill — they will train the right person, but not a rookie."),

        new("Timberline Logging", "TLL",
            new[] { "Log", "Flatbed", "Heavy Haul" }, "Small",
            "Eugene", "OR", new[] { "Boise,ID", "Missoula,MT" },
            0.59m, 0.47m, 3, 0, 88, 2, 12, false, false, false, true, 2, 4, 3,
            "Log and lumber out of the Pacific Northwest, plus the occasional equipment move to a landing. Forest roads, weather, and equipment that takes a beating. Home most nights, which is why people stay.",
            "Three years. They expect you to handle a rough road without tearing up the truck."),

        new("Meridian Auto Transport", "MAT",
            new[] { "Auto", "Dry Van" }, "Regional",
            "Detroit", "MI", new[] { "Columbus,OH", "Louisville,KY", "Dallas,TX" },
            0.64m, 0.52m, 3, 15, 95, 1, 3, false, false, false, true, 4, 3, 4,
            "Finished vehicles from the plants to the dealers on multi-car stingers. Every unit is inspected at both ends and damage comes straight out of the settlement conversation.",
            "Three years and a genuinely clean damage record. They do not hire people who scrape things."),

        new("Redstone Bulk Lines", "RBL",
            new[] { "Tanker", "Bulk", "Pneumatic", "Dry Van" }, "Regional",
            "Houston", "TX", new[] { "Baton Rouge,LA", "Odessa,TX", "Corpus Christi,TX" },
            0.68m, 0.55m, 2, 0, 93, 1, 5, false, true, false, true, 4, 2, 4,
            "Petrochemical, food-grade and dry bulk on the gulf coast. Liquid tank, pneumatic and a small van division for packaged product. Surge is a real thing and so is the money.",
            "Tanker endorsement required, no exceptions. Two years minimum."),

        new("Anvil Chemical Transport", "ACT",
            new[] { "Tanker", "Hazmat", "Bulk" }, "Regional",
            "Baton Rouge", "LA", new[] { "Houston,TX", "Mobile,AL" },
            0.74m, 0.60m, 4, 25, 96, 0, 4, true, true, false, true, 5, 2, 5,
            "Regulated chemical haulage — placarded liquid and dry bulk. The best per-mile rate on this list and the least forgiving safety department attached to it.",
            "Hazmat AND tanker, four years, and a spotless record. They will check."),

        new("Cascade Heavy Haul", "CHH",
            new[] { "Heavy Haul", "Lowboy", "Step Deck", "Flatbed" }, "Small",
            "Portland", "OR", new[] { "Seattle,WA", "Boise,ID" },
            0.78m, 0.63m, 5, 40, 96, 0, 4, false, false, false, true, 5, 3, 5,
            "Permitted oversize and machinery moves on RGN and lowboy, with step deck and flat for the smaller pieces. Small outfit, senior drivers only, and every load is planned around a permit and a route survey.",
            "Five years, forty loads of verifiable history, and nothing preventable on your record."),
    };

    /// <summary>
    /// Which roster is in play. Real carriers exist and their freight and headquarters are factual;
    /// the fictional set exists for anyone who would rather not work for a real name.
    /// </summary>
    private static Spec[] Roster(AppState s) =>
        string.Equals(s.Settings.CarrierRoster, "Fictional", StringComparison.OrdinalIgnoreCase)
            ? Fictional : RealWorld;

    private static Spec[] AllSpecs => RealWorld.Concat(Fictional).ToArray();

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
        foreach (var spec in Roster(s))
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
                RequiresTanker = spec.NeedsTanker,
                TakesRookies = spec.TakesRookies,
                Specialized = spec.Specialized,
                MinExperienceYears = spec.MinYears,
                MinLoads = spec.MinLoads,
                MinOnTimePct = spec.MinOnTime,
                MaxDriverFaultIncidents = spec.MaxFaults,
                WouldHire = screening.Hired,
                Screening = screening,
                IsCurrentEmployer = spec.Code == s.Company.Code,
                IsRealCompany = IsRealCompany(spec.Code),
                CreditedExperienceYears = CreditedExperience(s, s.Application?.ExperienceYears ?? 0),
                LoadsToQualify = LoadsStillNeeded(s, spec),
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
    /// Loads that count as a year of experience. A regional driver realistically runs a few hundred
    /// loads a year, so this is deliberately generous — the point is that freight actually hauled in
    /// the app is what earns a move up, and the grind has to be reachable inside a game.
    /// </summary>
    public const double LoadsPerYear = 30;

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
        var credited = CreditedExperience(s, declared);
        if (credited < spec.MinYears && !(spec.TakesRookies && totalLoads == 0))
            byExperience = (int)Math.Ceiling((spec.MinYears - credited) * LoadsPerYear);

        var byHistory = Math.Max(0, spec.MinLoads - totalLoads);
        return Math.Max(byExperience, byHistory);
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
        return Math.Round(declaredYears + daysServed / 365.0 + loads / LoadsPerYear, 2);
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

        if (!cond.Hiring)
        {
            d.Hired = false;
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

        var hasHazmat = (app?.HasHazmat ?? false) || s.Driver.Qualifications.Contains("Hazmat");
        var hasTanker = (app?.HasTanker ?? false) || s.Driver.Qualifications.Contains("Tanker");

        if (spec.NeedsHazmat && !hasHazmat)
            fails.Add("Hazmat endorsement is required for their placarded freight and you do not hold one.");
        if (spec.NeedsTanker && !hasTanker)
            fails.Add("Tanker endorsement is required and you do not hold one.");

        var credited = CreditedExperience(s, years);
        if (years < minYears && !(spec.TakesRookies && totalLoads == 0))
        {
            if (credited < minYears)
            {
                var shortBy = minYears - credited;
                var loadsToGo = (int)Math.Ceiling(shortBy * LoadsPerYear);
                fails.Add($"They want {minYears:0.#} years on {spec.Divisions[0].ToLowerInvariant()}" +
                          (Math.Abs(cond.YearsShift) > 0.01 ? $" ({cond.State.ToLowerInvariant()} — normally {spec.MinYears:0.#})" : "") + ". " +
                          $"You credit at {credited:0.0} years ({years:0.#} declared" +
                          (totalLoads > 0 ? $" plus {totalLoads} loads and time served" : "") +
                          $") — roughly {loadsToGo} more load(s) to close the gap.");
            }
            else
            {
                notes.Add($"{years:0.#} declared years is light, but {totalLoads} loads of verifiable history " +
                          $"credits you at {credited:0.0} years, which clears their bar.");
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

        if (s.Driver.Status == "Terminated")
            fails.Add("You were terminated by your last carrier. That follows you.");

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

        if (fails.Count > 0)
        {
            d.Hired = false;
            d.Decision = $"{spec.Name} — application declined";
            d.Reasons.AddRange(fails);
            d.Conditions.Add("Build the record they are asking for and apply again. Carriers reconsider.");
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

    /// <summary>A carrier's equipment standard by code, for careers written before it was stored.</summary>
    public static int EquipmentStarsFor(string? code)
    {
        var spec = AllSpecs.FirstOrDefault(c => c.Code.Equals((code ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        return spec == null ? 3 : spec.EquipmentStars;
    }

    /// <summary>Turns a chosen carrier into the player's employer: company, terminals, pay.</summary>

    public static void Employ(AppState s, string code, DriverApplication app)
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
            Divisions = spec.Divisions.ToList(),
            OperatingAuthorityNotes = $"48-state common carrier authority. {string.Join(" / ", spec.Divisions)} divisions."
        };

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
        var loaded = Math.Round(spec.LoadedCpm * cond.PayFactor, 3);
        var deadhead = Math.Round(spec.DeadheadCpm * cond.PayFactor, 3);
        var note = cond.PayFactor > 1m
            ? $"{spec.Name} probationary scale, {(cond.PayFactor - 1m) * 100:0}% over posted while they are short of drivers."
            : $"{spec.Name} probationary scale.";

        // Under their experience bar with no history to lean on: start below the posted rate.
        if (years < spec.MinYears && totalLoads < 20)
        {
            loaded = Math.Round(loaded * 0.90m, 3);
            deadhead = Math.Round(deadhead * 0.90m, 3);
            note = $"{spec.Name} entry scale — 10% under the posted rate until probation clears.";
        }
        else if (totalLoads >= 60)
        {
            loaded = Math.Round(loaded * 1.04m, 3);
            deadhead = Math.Round(deadhead * 1.04m, 3);
            note = $"{spec.Name} scale with a seniority premium for {totalLoads} loads of history.";
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
                         $"unit {truck.Unit} → Edit and change the make, model, transmission and governed speed " +
                         "to what you actually bought. The planner uses those numbers for drive time.",
                Why = "Governed speed and fuel capacity drive every feasibility calculation."
            });

        if (trailer != null)
            steps.Add(new SetupStep
            {
                Title = $"Decide on trailers — you are assigned {trailer.Unit}, a {trailer.Length} " +
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
    public bool RequiresTanker { get; set; }
    public bool TakesRookies { get; set; }
    public bool Specialized { get; set; }
    public double MinExperienceYears { get; set; }
    public int MinLoads { get; set; }
    public double MinOnTimePct { get; set; }
    public int MaxDriverFaultIncidents { get; set; }
    public bool WouldHire { get; set; }
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
