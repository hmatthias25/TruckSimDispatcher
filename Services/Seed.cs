using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Creates the carrier: hire decision, company, starting finances, fleet, equipment
/// assignment, pay plan and probation terms. Built from the driver's application so two
/// different applicants do not get the same company.
/// </summary>
public static class Seed
{
    public static void ApplyDefaultAccounts(AppState s)
    {
        if (s.Accounts.Count > 0) return;
        s.Accounts.AddRange(new[]
        {
            new Account { Key = LedgerService.Operating, Name = "General Operating Cash", Kind = "Asset",
                Notes = "Day-to-day cash: fuel, tolls, overhead, revenue deposits." },
            new Account { Key = LedgerService.MaintenanceReserve, Name = "Maintenance Reserve", Kind = "Asset",
                Notes = "Swept from revenue. Pays PM services and repairs first." },
            new Account { Key = LedgerService.PayrollReserve, Name = "Payroll Reserve", Kind = "Asset",
                Notes = "Swept from revenue. Funds driver settlements." },
            new Account { Key = LedgerService.EquipmentNote, Name = "Equipment Financing", Kind = "Liability",
                Notes = "Outstanding note on the tractor and trailer fleet." }
        });
    }

    // ---------------------------------------------------------------- hiring

    public static HireDecision Screen(DriverApplication app)
    {
        var d = new HireDecision();

        if (string.IsNullOrWhiteSpace(app.DriverName))
        {
            d.Hired = false;
            d.Decision = "Incomplete application";
            d.Reasons.Add("No name on the application. Recruiting cannot process it.");
            return d;
        }

        if (!app.AcceptsProbation && app.ExperienceYears < 5)
        {
            d.Hired = false;
            d.Decision = "Not hired";
            d.Reasons.Add($"Every driver here starts on probation. With {app.ExperienceYears:0.#} years of experience I cannot waive it — I would need 5+ years and a verifiable clean record to even consider it.");
            d.Conditions.Add("Reapply willing to run a probationary period and we will talk.");
            return d;
        }

        d.Hired = true;
        d.Decision = app.ExperienceYears >= 5 ? "Hired — abbreviated probation" : "Hired — standard probation";

        if (app.ExperienceYears >= 5)
            d.Reasons.Add($"{app.ExperienceYears:0.#} years behind the wheel. That earns a shortened probation and a starting rate above our floor.");
        else if (app.ExperienceYears >= 2)
            d.Reasons.Add($"{app.ExperienceYears:0.#} years is enough seat time to run our lanes without a trainer.");
        else if (app.ExperienceYears > 0)
            d.Reasons.Add($"{app.ExperienceYears:0.#} years is light, but we hire developing drivers. You will be watched closer and start on the lower end of the scale.");
        else
            d.Reasons.Add("No verifiable experience on file. We will start you on short-haul freight in easier lanes and build from there.");

        if (app.FreightExperience.Count > 0)
            d.Reasons.Add($"Prior freight experience in {string.Join(", ", app.FreightExperience)} is useful to us.");

        var endorsements = new List<string>();
        if (app.HasHazmat) endorsements.Add("hazmat");
        if (endorsements.Count > 0)
            d.Reasons.Add($"Your {string.Join(", ", endorsements)} endorsement(s) open freight most of our drivers cannot touch. That is worth money to us and to you.");

        if (!app.AcceptsProbation)
            d.Conditions.Add("You asked to skip probation. On your experience I will shorten it, not waive it.");

        d.Conditions.Add("Probationary drivers are restricted from oversize/heavy haul until Safety signs off.");
        if (app.WillNotHaul.Count > 0)
            d.Conditions.Add($"Noted that you will not haul: {string.Join(", ", app.WillNotHaul)}. I will not force that freight on you.");
        if (app.TransmissionPreference == "manual")
            d.Conditions.Add("Manual preference noted — I will put you in a unit with an 18-speed.");
        else if (app.TransmissionPreference == "automatic")
            d.Conditions.Add("Automated transmission noted — you will get an AMT unit.");

        return d;
    }

    // ---------------------------------------------------------------- company

    private static readonly (string Name, string Code, string Division, string City, string State, string Motto)[] Profiles =
    {
        ("Sierra Freight Lines",    "SFL", "Dry Van",   "Phoenix",        "AZ", "Loaded and legal."),
        ("Cold Harbor Carriers",    "CHC", "Reefer",    "Fresno",         "CA", "Cold on time, every time."),
        ("Ironline Transport",      "ILT", "Flatbed",   "Salt Lake City", "UT", "Secured, tarped, delivered."),
        ("Redstone Bulk Lines",     "RBL", "Tanker",    "Houston",        "TX", "Bulk done right."),
        ("Cascade Heavy Haul",      "CHH", "Heavy Haul","Portland",       "OR", "Nothing is too big."),
        ("Great Plains Livestock",  "GPL", "Livestock", "Amarillo",       "TX", "Cattle move, we move."),
        ("Timberline Logging",      "TLL", "Log",       "Eugene",         "OR", "Out of the woods, on time."),
        ("Meridian Auto Transport", "MAT", "Auto",      "Detroit",        "MI", "Every unit arrives clean.")
    };

    public static void CreateCompany(AppState s, DriverApplication app)
    {
        var pref = string.IsNullOrWhiteSpace(app.PreferredDivision) ? "Dry Van" : app.PreferredDivision;
        var profile = Profiles.FirstOrDefault(p => p.Division.Equals(pref, StringComparison.OrdinalIgnoreCase));
        if (profile.Name == null) profile = Profiles[0];

        // Base the terminal near the driver's home when that is a workable freight market.
        var hqCity = profile.City; var hqState = profile.State;
        var home = Markets.Find(s, app.HomeCity, app.HomeState);
        if (home != null && home.Tier <= 2)
        {
            hqCity = home.City; hqState = home.State;
        }
        else if (!string.IsNullOrWhiteSpace(app.HomeState))
        {
            var inState = Markets.Effective(s)
                .Where(c => c.State.Equals(app.HomeState, StringComparison.OrdinalIgnoreCase) && c.Tier == 1)
                .OrderBy(c => c.City).FirstOrDefault();
            if (inState != null) { hqCity = inState.City; hqState = inState.State; }
        }

        var divisions = new List<string> { Norm(pref) };
        if (!string.IsNullOrWhiteSpace(app.SecondDivision) && !divisions.Contains(Norm(app.SecondDivision)))
            divisions.Add(Norm(app.SecondDivision));
        if (!divisions.Contains("Dry Van")) divisions.Add("Dry Van");

        s.Company = new Company
        {
            Name = profile.Name,
            Code = profile.Code,
            DotNumber = $"{2_100_000 + Math.Abs(profile.Code.GetHashCode() % 800_000)}",
            McNumber = $"MC-{500_000 + Math.Abs((profile.Code + hqState).GetHashCode() % 400_000)}",
            TerminalCity = hqCity,
            TerminalState = hqState,
            Founded = "2009",
            Divisions = divisions,
            Motto = profile.Motto,
            OperatingAuthorityNotes = $"48-state common carrier authority. {string.Join(" / ", divisions)} divisions. " +
                                      "Interstate for-hire; no brokerage authority — we haul our own freight only."
        };

        // One yard, at the smallest tier — which is what ATS actually sells you first.
        //
        // The carrier deliberately does NOT start with a relay network. Cities revealed with a save
        // editor rather than driven to never generate cargo in ATS, so a yard in a city the driver
        // has not reached would sit empty and a truck based there would have nothing to haul. The
        // network grows as the driver discovers cities; see DiscoveryService.
        s.Company.Terminals.Clear();
        s.Company.Terminals.Add(Migrations.BuildTerminal(s, hqCity, hqState, isHq: true, "Small"));
        Migrations.SyncHeadquarters(s);

        // The home city counts as discovered — the driver is standing in it.
        s.Discovered.Clear();
        DiscoveryService.Note(s, hqCity, hqState, s.Status.GameTime);

        s.Settings.FreightPrefix = profile.Code;

        // Starting finances for a one-truck operation, leveraged and thin. These are book figures:
        // the real number is whatever ATS shows, which the driver reports and the ledger trues up to.
        ApplyDefaultAccounts(s);
        SetOpening(s, LedgerService.Operating, 18_500m);
        SetOpening(s, LedgerService.MaintenanceReserve, 0m);
        SetOpening(s, LedgerService.PayrollReserve, 0m);
        SetOpening(s, LedgerService.EquipmentNote, -152_000m);
    }

    private static void SetOpening(AppState s, string key, decimal amount)
    {
        var a = s.Accounts.First(x => x.Key == key);
        a.OpeningBalance = amount;
    }

    private static string Norm(string division) => (division ?? "").Trim() switch
    {
        "Refrigerated" or "Reefer" or "Frozen" => "Reefer",
        "Van" or "Dry Van" => "Dry Van",
        "Open Deck" or "Flatbed" or "Step Deck" => "Flatbed",
        "Bulk" or "Tanker" => "Tanker",
        "Oversize" or "Heavy Haul" or "Specialized" => "Heavy Haul",
        "Car Hauling" or "Auto" => "Auto",
        "" => "Dry Van",
        var v => v
    };

    // ---------------------------------------------------------------- fleet

    /// <summary><see cref="Tier"/> is the equipment standard a carrier has to hold to issue this unit.</summary>
    private record TruckSpec(string Make, string Model, int Year, string Engine, int Hp,
        string Trans, string TransType, string Cab, int Governed, double Fuel, double Mpg, int Tier);

    private static readonly TruckSpec[] AmtSpecs =
    {
        new("Volvo",        "VNL 860",      2023, "Volvo D13TC",  500, "Volvo I-Shift 12-spd AMT", "automatic", "Sleeper", 68, 250, 7.3, 5),
        new("Freightliner", "Cascadia 126", 2022, "Detroit DD15", 505, "Detroit DT12 12-spd AMT", "automatic", "Sleeper", 65, 240, 7.1, 4),
        new("Kenworth",     "T680",         2021, "PACCAR MX-13", 510, "PACCAR TX-12 12-spd AMT", "automatic", "Sleeper", 65, 240, 6.9, 4),
        new("Mack",         "Anthem",       2021, "Mack MP8",     505, "Mack mDRIVE 12-spd AMT", "automatic", "Sleeper", 65, 240, 6.7, 3),
        new("International","LT625",        2020, "Cummins X15",  500, "Eaton Endurant 12-spd AMT", "automatic", "Sleeper", 65, 230, 6.8, 3),
        new("Freightliner", "Cascadia 125", 2017, "Detroit DD15", 455, "Detroit DT12 12-spd AMT", "automatic", "Sleeper", 63, 230, 6.4, 2),
        new("International","ProStar",      2016, "Cummins ISX15",450, "Eaton UltraShift 10-spd AMT", "automatic", "Sleeper", 62, 200, 6.1, 2),
        new("Freightliner", "Cascadia",     2013, "Detroit DD13", 410, "Eaton UltraShift 10-spd AMT", "automatic", "Sleeper", 62, 180, 5.8, 1),
        new("International","ProStar",      2012, "MaxxForce 13", 430, "Eaton UltraShift 10-spd AMT", "automatic", "Day Cab", 62, 150, 5.5, 1)
    };

    private static readonly TruckSpec[] ManualSpecs =
    {
        new("Peterbilt", "389",         2023, "Cummins X15",   605, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 70, 300, 5.9, 5),
        new("Peterbilt", "579",         2021, "Cummins X15",   500, "Eaton Fuller 13-spd manual", "manual", "Sleeper", 65, 240, 6.6, 4),
        new("Western Star", "49X",      2022, "Detroit DD16",  600, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 65, 280, 5.6, 4),
        new("Kenworth",  "W900L",       2019, "Cummins X15",   565, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 68, 300, 5.9, 3),
        new("Peterbilt", "389",         2018, "Cummins X15",   605, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 70, 300, 5.6, 3),
        new("Freightliner", "Coronado", 2017, "Detroit DD15",  505, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 65, 250, 6.0, 2),
        new("Kenworth",  "T800",        2015, "Cummins ISX15", 485, "Eaton Fuller 13-spd manual", "manual", "Sleeper", 63, 240, 5.5, 2),
        new("Freightliner", "Columbia", 2012, "Detroit DD15",  455, "Eaton Fuller 10-spd manual", "manual", "Sleeper", 62, 200, 5.3, 1),
        new("International","9900i",    2011, "Cummins ISX",   430, "Eaton Fuller 10-spd manual", "manual", "Day Cab", 62, 180, 5.1, 1)
    };

    /// <summary>
    /// The trucks a carrier hands its best driver.
    ///
    /// Not simply a newer Cascadia. These are the flagships spec-ed the way a driver would spec them if
    /// somebody else were paying — the big engines, the good gearboxes — sitting alongside the long-nose
    /// classics that are the whole point of being seen on the road. A Master Driver picks one.
    ///
    /// Every other reward in this app is a number: a rate, a rank, a percentage. This is the one that is
    /// visible out of the windscreen every mile, which is why it is a choice rather than an assignment.
    /// </summary>
    private static readonly TruckSpec[] ShowcaseSpecs =
    {
        // The long noses. Nothing else on this list turns a head in a truck stop.
        new("Peterbilt",    "389 Pride & Class", 2024, "Cummins X15",   605, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 70, 300, 5.7, 5),
        new("Kenworth",     "W900L Studio",      2024, "Cummins X15",   605, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 70, 300, 5.7, 5),
        new("Western Star", "49X",               2024, "Detroit DD16",  600, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 68, 300, 5.8, 5),

        // The modern flagships, for somebody who would rather have the quiet cab and the fuel.
        new("Volvo",        "VNL 860 Globetrotter", 2024, "Volvo D13TC", 500, "Volvo I-Shift 14-spd AMT", "automatic", "Sleeper", 70, 300, 7.6, 5),
        new("Mack",         "Anthem 70in Stand-Up", 2024, "Mack MP8HE",  505, "Mack mDRIVE HD 14-spd AMT", "automatic", "Sleeper", 70, 280, 7.2, 5),
        new("Peterbilt",    "579 UltraLoft",        2024, "PACCAR MX-13", 510, "PACCAR TX-12 Pro 12-spd AMT", "automatic", "Sleeper", 70, 280, 7.4, 5),
        new("Kenworth",     "T680 Next Gen",        2024, "PACCAR MX-13", 510, "PACCAR TX-12 Pro 12-spd AMT", "automatic", "Sleeper", 70, 280, 7.4, 5),
        new("Freightliner", "Cascadia 126 Raised",  2024, "Detroit DD16", 600, "Detroit DT12-O 12-spd AMT", "automatic", "Sleeper", 70, 300, 7.0, 5),
    };

    /// <summary>
    /// The award list, described well enough to choose from and to go and buy.
    ///
    /// The whole list is offered whatever gearbox the driver asked for at hire, because this is a reward
    /// and not an issue of equipment — but anything against that preference is flagged rather than
    /// quietly handed over. Choosing it says they have changed their mind, and the app takes them at
    /// their word.
    /// </summary>
    /// <summary>
    /// The trucks THIS carrier would put its best driver in.
    ///
    /// A rookie outfit at two stars does not hand anybody a long-nose Pete, and pretending otherwise
    /// makes the good carriers worth nothing. So the list is drawn from where the employer actually sits:
    /// the showcase rigs only at the top of the market, a solid late-model tractor further down. Reaching
    /// the top of a weak carrier's ladder is still an achievement — it is just a smaller truck, which is
    /// its own argument for moving on.
    /// </summary>
    private static List<TruckSpec> AwardPool(AppState s)
    {
        var stars = Math.Clamp(s.Company.EquipmentStars <= 0 ? 3 : s.Company.EquipmentStars, 1, 5);

        if (stars >= 5) return ShowcaseSpecs.ToList();

        // The long noses are chrome, and chrome is not something a rookie outfit hands anybody. They live
        // in the ordinary catalogue too, so filtering on tier alone let a three-star fleet award a W900L.
        static bool IsChrome(TruckSpec x) =>
            x.Model.Contains("389", StringComparison.OrdinalIgnoreCase)
            || x.Model.Contains("W900", StringComparison.OrdinalIgnoreCase);

        // Everything the catalogue has at this standard or one better, best first.
        var pool = AmtSpecs.Concat(ManualSpecs)
            .Where(x => x.Tier >= stars && x.Tier <= stars + 1)
            .Where(x => stars >= 4 || !IsChrome(x))
            .OrderByDescending(x => x.Tier).ThenByDescending(x => x.Year).ThenByDescending(x => x.Hp)
            .Take(6)
            .ToList();

        // A four-star fleet stretches to one of the flagships, but not the chrome.
        if (stars == 4)
            pool.InsertRange(0, ShowcaseSpecs.Where(x => x.TransType == "automatic").Take(2));

        return pool.Count > 0 ? pool : AmtSpecs.Take(3).ToList();
    }

    public static List<object> ShowcaseChoices(AppState s)
    {
        var pref = (s.Application?.TransmissionPreference ?? "either").Trim().ToLowerInvariant();
        return AwardPool(s).Select((x, i) => (object)new
        {
            index = i,
            make = x.Make,
            model = x.Model,
            year = x.Year,
            engine = x.Engine,
            hp = x.Hp,
            transmission = x.Trans,
            transType = x.TransType,
            mpg = x.Mpg,
            label = $"{x.Year} {x.Make} {x.Model} — {x.Engine} {x.Hp} hp, {x.Trans}",
            matchesPreference = pref is "either" || pref == x.TransType,
        }).ToList();
    }

    /// <summary>The chosen unit, described the way an equipment order needs it.</summary>
    public static (string Label, string TransType)? ShowcaseChoice(AppState s, int index)
    {
        var pool = AwardPool(s);
        if (index < 0 || index >= pool.Count) return null;
        var x = pool[index];
        return ($"a {x.Year} {x.Make} {x.Model} — {x.Engine} at {x.Hp} hp, {x.Trans}, {x.Cab.ToLowerInvariant()}",
                x.TransType);
    }

    /// <summary>
    /// Equipment a carrier of this standard would put a driver in.
    ///
    /// Picks at the carrier's tier and falls outward if that band is thin, so every carrier issues
    /// something. The driver's transmission preference is always honoured — a better carrier means a
    /// better truck, not a truck they did not ask for.
    /// </summary>
    private static List<TruckSpec> SpecsForStandard(int stars, string transmissionPreference)
    {
        var tier = Math.Clamp(stars <= 0 ? 3 : stars, 1, 5);
        var pool = transmissionPreference switch
        {
            "manual" => ManualSpecs.ToList(),
            "automatic" => AmtSpecs.ToList(),
            _ => AmtSpecs.Concat(ManualSpecs).ToList()
        };
        // Nearest tier first, then next-nearest — never empty.
        return pool.OrderBy(x => Math.Abs(x.Tier - tier)).ThenByDescending(x => x.Year).ToList();
    }

    /// <summary>
    /// The tractor the company would put this driver in, described well enough to go and buy it.
    ///
    /// Told to the player whenever they have to make the purchase themselves — replacing a traded
    /// unit, or filling an empty seat — because "buy a truck" is not an instruction. It follows the
    /// carrier's equipment standard and the driver's transmission preference, so what they come back
    /// with matches what the app expects to see on the book.
    /// </summary>
    public static string RecommendedTruck(AppState s)
    {
        var pref = s.Application?.TransmissionPreference ?? "either";
        var spec = SpecsForStandard(s.Company.EquipmentStars, pref).FirstOrDefault();
        if (spec == null) return "any sleeper tractor you can afford";

        return $"a {spec.Year}-or-newer {spec.Make} {spec.Model} — {spec.Engine} around {spec.Hp} hp, " +
               $"{spec.Trans}, {spec.Cab.ToLowerInvariant()}, roughly {spec.Fuel:N0} gal of fuel. " +
               $"Anything close to that spec is fine; match what you actually buy on the Fleet tab.";
    }

    /// <summary>
    /// Miles a carrier of this standard would hand over. A five-star fleet trades early, so their
    /// trucks are young; a one-star fleet runs them into the ground.
    /// </summary>
    private static int StartingServiceMiles(int stars, Random rnd)
    {
        var (lo, hi) = Math.Clamp(stars, 1, 5) switch
        {
            5 => (15, 90),
            4 => (60, 200),
            3 => (90, 300),
            2 => (200, 480),
            _ => (350, 720)
        };
        return rnd.Next(lo, hi) * 1000 + rnd.Next(0, 999);
    }

    /// <summary>
    /// Creates the starting equipment: exactly one tractor and one trailer, both at the home yard.
    ///
    /// It used to seed a six-truck fleet spread across three yards, and that was wrong for two
    /// reasons. The player has to buy every unit in ATS for its damage and odometer to mean anything,
    /// and a truck based in a city they have not driven to would never see cargo. So the book starts
    /// at what one driver can actually own, and grows on the Fleet tab as they buy real equipment.
    /// </summary>
    public static void CreateFleet(AppState s, DriverApplication app)
    {
        s.Trucks.Clear();
        s.Trailers.Clear();

        // What you are put in follows the carrier's equipment standard, not a fixed choice.
        var spec = SpecsForStandard(s.Company.EquipmentStars, app.TransmissionPreference).First();

        var yard = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters)
                   ?? s.Company.Terminals.FirstOrDefault();
        var divisions = s.Company.Divisions;
        var rnd = new Random(StableSeed(app.DriverName + s.Company.Code));

        // Company-service mileage is roleplay history and is fine to invent — it is the carrier's own
        // book, not something ATS reports. Damage is NOT: the driver cannot set damage in ATS, so a
        // fabricated figure could never be reconciled with the game. It starts at zero and only moves
        // when the driver reports a real reading.
        var serviceMiles = StartingServiceMiles(s.Company.EquipmentStars, rnd);
        s.Trucks.Add(new Truck
        {
            Unit = "101",
            Make = spec.Make, Model = spec.Model, Year = spec.Year,
            Engine = $"{spec.Engine} {spec.Hp} hp", Horsepower = spec.Hp,
            Transmission = spec.Trans, TransmissionType = spec.TransType,
            CabConfig = spec.Cab,
            Wheelbase = spec.Cab == "Day Cab" ? "228\"" : "265\"",
            GovernedMph = spec.Governed,
            FuelCapacityGal = spec.Fuel, AvgMpg = spec.Mpg,
            AssignedFreightTypes = divisions.Take(2).ToList(),
            ServiceMiles = serviceMiles,
            LastServiceMiles = Math.Max(0, serviceMiles - rnd.Next(2000, 18000)),
            ServiceIntervalMiles = 25000,
            DamagePct = 0,
            InGameGarage = false,
            Status = "InService",
            HomeTerminalId = yard?.Id ?? "",
            PurchasePrice = 118_000m + rnd.Next(0, 46) * 1000m,
            MonthlyPayment = 2_150m + rnd.Next(0, 12) * 50m,
            Notes = "Match this to the tractor you actually buy in game — edit the spec on the Fleet tab."
        });

        var primary = divisions.FirstOrDefault() ?? "Dry Van";
        var (type, subtype, len) = TrailerSpec.ForCarrier(s, primary);

        // An auto carrier gets no box at all: ATS sells no car carrier, so the division resolves to the
        // arrangement below rather than to something the driver would be sent to a dealer for.
        if (TrailerSpec.Ownable(type))
        {
            s.Trailers.Add(new Trailer
            {
                Unit = "T501",
                Type = type,
                Subtype = subtype,
                Division = primary,
                Year = 2016 + rnd.Next(0, 9),
                Make = TrailerMake(type),
                Length = len,
                Axles = type == "Lowboy" ? "Tri-axle" : "Tandem",
                DamagePct = 0,
                InGameGarage = false,
                ServiceMiles = rnd.Next(40, 220) * 1000,
                Status = "InService",
                HomeTerminalId = yard?.Id ?? "",
                CurrentLocation = yard == null ? "" : $"{yard.City}, {yard.State}",
                Notes = "Match this to the trailer you actually buy in game."
            });
        }

        // Every carrier has freight-market work as well. It is not equipment and nothing is bought for
        // it — it is the arrangement a driver gets put on or asks for. See DropHook. Where the carrier
        // hauls cars, this IS their trailer, and it carries the subtype that narrows the board.
        s.Trailers.Add(DropHook.Build(s, yard?.Id ?? "",
            TrailerSpec.Ownable(type) ? "" : subtype));
    }

    /// <summary>What stocking a yard produced, so the UI can report it rather than guess.</summary>
    public class StockResult
    {
        public List<string> Trucks { get; set; } = new();
        public List<string> Trailers { get; set; } = new();
        public string Message { get; set; } = "";
        public int RoomLeft { get; set; }
    }

    /// <summary>
    /// Fills a yard with tractors (and optionally matching trailers) in one go.
    ///
    /// A career starts at one truck because that is what a fresh ATS profile can afford, but a player
    /// who has seeded cash can buy a large garage and run a real fleet out of it from day one. Adding
    /// five tractors one spec-form at a time is a chore, so this does it in a single step and respects
    /// the yard's tier — upgrade the yard first and it will take more.
    ///
    /// <paramref name="alreadyBought"/> is the honest bit: only tick it for units that actually exist
    /// in the ATS garage, because that flag is what makes the app track damage and odometer against
    /// them. Untick it and they sit on the book as company backdrop until you buy them.
    /// </summary>
    public static StockResult StockYard(AppState s, string terminalId, int count, bool alreadyBought,
        string transmissionPreference, bool addTrailers)
    {
        var yard = Migrations.TerminalOf(s, terminalId)
                   ?? throw new InvalidOperationException("That terminal is not one of ours.");

        var room = Migrations.RoomAt(s, yard);
        if (room <= 0)
        {
            var based = Migrations.TrucksBasedAt(s, yard.Id);
            // Only ever suggest a tier that is actually bigger than the one the yard is on.
            var next = yard.Level switch
            {
                "Small" => "Upgrade it to Medium (3) or Large (5) here — in ATS that means buying the garage upgrade.",
                "Medium" => "Upgrade it to Large (5) here — in ATS that means buying the garage upgrade.",
                _ => "It is already at the largest tier, so base these units at another yard."
            };
            throw new InvalidOperationException(
                $"{yard.City} is a {yard.Level.ToLowerInvariant()} yard: it holds {yard.TruckCapacity} tractor(s) " +
                $"and {based} {(based == 1 ? "is" : "are")} already based there. {next}");
        }

        var wanted = Math.Clamp(count, 1, room);
        var result = new StockResult();

        // Same equipment standard as the rest of the fleet — a yard you stock yourself should not
        // quietly hand you better trucks than the carrier issues.
        var pool = SpecsForStandard(s.Company.EquipmentStars, transmissionPreference);

        var rnd = new Random(StableSeed(yard.Id + s.Trucks.Count));
        var divisions = s.Company.Divisions.Count > 0 ? s.Company.Divisions : new List<string> { "Dry Van" };

        for (var i = 0; i < wanted; i++)
        {
            var spec = pool[i % pool.Count];
            var unit = NextTruckUnit(s);
            var serviceMiles = StartingServiceMiles(s.Company.EquipmentStars, rnd);
            s.Trucks.Add(new Truck
            {
                Unit = unit,
                Make = spec.Make, Model = spec.Model, Year = spec.Year,
                Engine = $"{spec.Engine} {spec.Hp} hp", Horsepower = spec.Hp,
                Transmission = spec.Trans, TransmissionType = spec.TransType,
                CabConfig = spec.Cab,
                Wheelbase = spec.Cab == "Day Cab" ? "228\"" : "265\"",
                GovernedMph = spec.Governed,
                FuelCapacityGal = spec.Fuel, AvgMpg = spec.Mpg,
                AssignedFreightTypes = divisions.Skip(i % divisions.Count).Take(2).ToList(),
                ServiceMiles = serviceMiles,
                LastServiceMiles = Math.Max(0, serviceMiles - rnd.Next(2000, 18000)),
                ServiceIntervalMiles = 25000,
                // Damage always starts at zero. The driver cannot set damage in ATS, so any figure we
                // invented here could never be reconciled against the game.
                DamagePct = 0,
                InGameGarage = alreadyBought,
                Status = "InService",
                HomeTerminalId = yard.Id,
                PurchasePrice = 118_000m + rnd.Next(0, 46) * 1000m,
                MonthlyPayment = 2_150m + rnd.Next(0, 12) * 50m,
                Notes = alreadyBought ? "" : "Not yet bought in ATS — tick 'in my garage' once you own it."
            });
            result.Trucks.Add(unit);

            if (addTrailers)
            {
                var division = divisions[i % divisions.Count];
                var (type, subtype, len) = TrailerSpec.ForCarrier(s, division);

                // Car hauling is freight, not equipment: the arrangement stands in for the box, and
                // nothing is bought. Anything else the game will not sell is skipped the same way.
                if (!TrailerSpec.Ownable(type))
                {
                    DropHook.Ensure(s, subtype);
                    continue;
                }

                var tUnit = NextTrailerUnit(s);
                s.Trailers.Add(new Trailer
                {
                    Subtype = subtype,
                    Unit = tUnit,
                    Type = type, Division = division,
                    Year = 2016 + rnd.Next(0, 9),
                    Make = TrailerMake(type),
                    Length = len,
                    Axles = type == "Lowboy" ? "Tri-axle" : "Tandem",
                    DamagePct = 0,
                    InGameGarage = alreadyBought,
                    ServiceMiles = rnd.Next(40, 220) * 1000,
                    Status = "InService",
                    HomeTerminalId = yard.Id,
                    CurrentLocation = $"{yard.City}, {yard.State}",
                    Notes = alreadyBought ? "" : "Not yet bought in ATS."
                });
                result.Trailers.Add(tUnit);
            }
        }

        result.RoomLeft = Migrations.RoomAt(s, yard);
        result.Message = $"{result.Trucks.Count} tractor(s)" +
                         (result.Trailers.Count > 0 ? $" and {result.Trailers.Count} trailer(s)" : "") +
                         $" based at {yard.City}" +
                         (alreadyBought ? "" : " as backdrop until you buy them in game") +
                         $". {result.RoomLeft} slot(s) left at this yard.";
        if (count > wanted)
            result.Message += $" You asked for {count}; the yard only had room for {wanted}.";
        return result;
    }

    /// <summary>Continues the seeded numbering (101, 104, 107...) rather than colliding with it.</summary>
    private static string NextTruckUnit(AppState s)
    {
        var highest = s.Trucks
            .Select(t => int.TryParse(t.Unit, out var n) ? n : 0)
            .DefaultIfEmpty(98)
            .Max();
        return $"{Math.Max(101, highest + 3)}";
    }

    private static string NextTrailerUnit(AppState s)
    {
        var highest = s.Trailers
            .Select(t => int.TryParse(t.Unit.TrimStart('T', 't'), out var n) ? n : 0)
            .DefaultIfEmpty(499)
            .Max();
        return $"T{Math.Max(501, highest + 2)}";
    }

    private static string TrailerMake(string type) => type switch
    {
        "Reefer" => "Utility 3000R",
        "Dry Van" => "Wabash DuraPlate",
        "Flatbed" => "Fontaine Infinity",
        "Step Deck" => "Fontaine Velocity",
        "Tanker" => "Polar 7000 gal",
        "Lowboy" => "Trail King RGN",
        "Livestock" => "Wilson Silverstar",
        "Log" => "Peerless log trailer",
        _ => "Great Dane"
    };

    // TrailerForDivision used to live here, returning (type, length) and silently discarding the
    // subtype — which is how a yard ended up holding a "Tanker" that named none of the five ATS sells,
    // and a "Car Hauler" that the game will not sell at all. One helper now, in TrailerSpec.

    private static int StableSeed(string text)
    {
        unchecked
        {
            var h = 17;
            foreach (var c in text ?? "") h = h * 31 + c;
            return h;
        }
    }

    // ---------------------------------------------------------------- driver setup

    /// <summary>
    /// What a probationary driver of this much experience starts on.
    ///
    /// Shared so hiring and any later restoration of probation cannot drift apart — a driver put back
    /// on probation should land on the scale they would have been hired onto, not a different number
    /// that happens to be written somewhere else.
    /// </summary>
    public static (decimal Loaded, decimal Deadhead) ProbationaryScale(double experienceYears)
    {
        var experienced = experienceYears >= 5;
        var green = experienceYears < 1;
        return (green ? 0.48m : experienced ? 0.58m : 0.54m,
                green ? 0.38m : experienced ? 0.48m : 0.44m);
    }

    public static void HireDriver(AppState s, DriverApplication app, HireDecision decision)
    {
        var experienced = app.ExperienceYears >= 5;
        var green = app.ExperienceYears < 1;
        var scale = ProbationaryScale(app.ExperienceYears);

        var pay = new PayPlan
        {
            LoadedCpm = scale.Loaded,
            DeadheadCpm = scale.Deadhead,
            Notes = "Probationary scale. Reviewed when probation clears."
        };
        if (app.HasHazmat) pay.HazmatCpm = 0.05m;

        var probation = new ProbationPlan
        {
            Active = true,
            RequiredLoads = experienced ? 8 : green ? 14 : 10,
            RequiredMiles = experienced ? 4500 : green ? 8000 : 6000,
            RequiredOnTimePct = 95,
            MaxAvgDamagePct = green ? 6 : 5,
            MaxDriverFaultIncidents = 1,
            DurationDays = experienced ? 60 : 90,
            StartedGameDate = s.Status.GameTime,
            Notes = experienced
                ? "Shortened on verified experience."
                : green
                    ? "Extended — developing driver. Expect closer coaching early."
                    : "Standard probation."
        };
        // Same slack rule as a changeover: the window has to outlast the passes, or one bad review
        // leaves the driver needing a clean run they no longer have the fortnights for.
        ProbationPlanner.EnsureSlack(probation);

        var quals = new List<string> { "Class A CDL" };
        if (app.HasHazmat) quals.Add("Hazmat");

        foreach (var f in app.FreightExperience) quals.Add($"Experience: {f}");

        var restrictions = new List<string> { "Oversize", "Heavy Haul" };
        if (green) restrictions.Add("Hazmat");

        // Skills belong to the driver, not the job. Changing employer does not un-learn them, and this
        // whole object is replaced below.
        var carriedSkills = s.Driver?.Skills ?? new DriverSkills();

        s.Driver = new Driver
        {
            Name = app.DriverName,
            EmployeeId = $"{s.Company.Code}-{1000 + Math.Abs(StableSeed(app.DriverName) % 9000)}",
            HiredGameDate = s.Status.GameTime,
            HiredUtc = DateTime.UtcNow.ToString("o"),
            // Squared up as at the day they started. The true-up now fires for any Monday that has GONE
            // BY unsquared rather than only for today — which, left at the default, would have meant a
            // brand-new career opening with a demand to reconcile a week it was not around for.
            LastTrueUpDay = LedgerService.MondayOnOrBefore(GameClock.DayOf(s.Status.GameTime) ?? 0),
            Status = "Probation",
            Rank = "probationary",
            RankTitle = "Probationary Company Driver",
            Pay = pay,
            Qualifications = quals,
            Restrictions = restrictions,
            Probation = probation,
            Skills = carriedSkills,
            // Deliberately not carried: the award is a thing THIS company does for its own best driver,
            // and what it runs to depends on what this company is. A new employer is a new ladder.
            ShowcaseOffered = false,
            ShowcaseTaken = false,
            // The home-time arrangement is a commitment the company makes, so it is recorded on the
            // driver file in days and routed for — not left as a note nobody reads.
            HomeTimeIntervalDays = HomeTime.DaysFor(app.HomeTimePreference),
            LastHomeGameTime = s.Status.GameTime,
            Notes = decision.Decision
        };
    }

    /// <summary>
    /// Assign equipment. A probationary driver does not get the newest truck in the fleet —
    /// they get a solid mid-life unit that matches their transmission preference.
    /// </summary>
    public static (Truck? truck, Trailer? trailer) AssignEquipment(AppState s, DriverApplication app)
    {
        var wantManual = app.TransmissionPreference == "manual";
        var wantAuto = app.TransmissionPreference == "automatic";

        var candidates = s.Trucks
            .Where(t => t.Status == "InService" && t.CabConfig == "Sleeper" && string.IsNullOrEmpty(t.AssignedDriver))
            .ToList();

        if (wantManual) candidates = Prefer(candidates, t => t.TransmissionType == "manual");
        else if (wantAuto) candidates = Prefer(candidates, t => t.TransmissionType == "automatic");

        // Probationary drivers get the higher-mileage unit, not the flagship.
        var truck = candidates
            .OrderByDescending(t => t.ServiceMiles)
            .ThenBy(t => t.Year)
            .FirstOrDefault();

        var division = s.Company.Divisions.FirstOrDefault() ?? "Dry Van";
        var trailer = s.Trailers
            .Where(t => t.Status == "InService" && string.IsNullOrEmpty(t.AssignedTruckUnit))
            .OrderBy(t => t.Division.Equals(division, StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(t => t.DamagePct)
            .FirstOrDefault();

        // The unit the driver actually sits in is the one that must exist in their ATS garage,
        // so it is the only one whose damage and odometer the app tracks against the game.
        if (truck != null)
        {
            truck.AssignedDriver = s.Driver.Name;
            truck.InGameGarage = true;
            truck.AtsOdometer = 0;
            s.Driver.AssignedTruckUnit = truck.Unit;
            s.Status.AtsOdometer = 0;
            s.Settings.GovernedMph = truck.GovernedMph;
            s.Status.TruckDamagePct = truck.DamagePct;
        }
        if (trailer != null)
        {
            trailer.AssignedTruckUnit = truck?.Unit ?? "";
            trailer.InGameGarage = true;
            s.Driver.AssignedTrailerUnit = trailer.Unit;
            s.Status.TrailerDamagePct = trailer.DamagePct;
        }

        return (truck, trailer);
    }

    private static List<Truck> Prefer(List<Truck> list, Func<Truck, bool> match)
    {
        var hits = list.Where(match).ToList();
        return hits.Count > 0 ? hits : list;
    }
}
