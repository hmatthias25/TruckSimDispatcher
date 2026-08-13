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
        if (app.HasTanker) endorsements.Add("tanker");
        if (app.HasDoublesTriples) endorsements.Add("doubles/triples");
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

    private record TruckSpec(string Make, string Model, int Year, string Engine, int Hp,
        string Trans, string TransType, string Cab, int Governed, double Fuel, double Mpg);

    private static readonly TruckSpec[] AmtSpecs =
    {
        new("Freightliner", "Cascadia 126", 2022, "Detroit DD15", 505, "Detroit DT12 12-spd AMT", "automatic", "Sleeper", 65, 240, 7.1),
        new("Kenworth",     "T680",         2021, "PACCAR MX-13", 510, "PACCAR TX-12 12-spd AMT", "automatic", "Sleeper", 65, 240, 6.9),
        new("Volvo",        "VNL 860",      2023, "Volvo D13TC",  500, "Volvo I-Shift 12-spd AMT", "automatic", "Sleeper", 68, 250, 7.3),
        new("International","LT625",        2020, "Cummins X15",  500, "Eaton Endurant 12-spd AMT", "automatic", "Sleeper", 65, 230, 6.8),
        new("Mack",         "Anthem",       2021, "Mack MP8",     505, "Mack mDRIVE 12-spd AMT", "automatic", "Sleeper", 65, 240, 6.7)
    };

    private static readonly TruckSpec[] ManualSpecs =
    {
        new("Kenworth",  "W900L",      2019, "Cummins X15",   565, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 68, 300, 5.9),
        new("Peterbilt", "389",        2018, "Cummins X15",   605, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 70, 300, 5.6),
        new("Peterbilt", "579",        2021, "Cummins X15",   500, "Eaton Fuller 13-spd manual", "manual", "Sleeper", 65, 240, 6.6),
        new("Western Star", "49X",     2022, "Detroit DD16",  600, "Eaton Fuller 18-spd manual", "manual", "Day Cab", 65, 280, 5.4),
        new("Freightliner", "Coronado",2017, "Detroit DD15",  505, "Eaton Fuller 18-spd manual", "manual", "Sleeper", 65, 250, 6.0)
    };

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

        var wantsManual = app.TransmissionPreference == "manual";
        var spec = wantsManual ? ManualSpecs[2] : AmtSpecs[0];

        var yard = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters)
                   ?? s.Company.Terminals.FirstOrDefault();
        var divisions = s.Company.Divisions;
        var rnd = new Random(StableSeed(app.DriverName + s.Company.Code));

        // Company-service mileage is roleplay history and is fine to invent — it is the carrier's own
        // book, not something ATS reports. Damage is NOT: the driver cannot set damage in ATS, so a
        // fabricated figure could never be reconciled with the game. It starts at zero and only moves
        // when the driver reports a real reading.
        var serviceMiles = rnd.Next(90, 260) * 1000 + rnd.Next(0, 999);
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
        var (type, len) = TrailerForDivision(primary);
        s.Trailers.Add(new Trailer
        {
            Unit = "T501",
            Type = type,
            Division = primary,
            Year = 2016 + rnd.Next(0, 9),
            Make = TrailerMake(type),
            Length = len,
            Axles = type is "Lowboy" or "Car Hauler" ? "Tri-axle" : "Tandem",
            DamagePct = 0,
            InGameGarage = false,
            ServiceMiles = rnd.Next(40, 220) * 1000,
            Status = "InService",
            HomeTerminalId = yard?.Id ?? "",
            CurrentLocation = yard == null ? "" : $"{yard.City}, {yard.State}",
            Notes = "Match this to the trailer you actually buy in game."
        });
    }

    private static string TrailerMake(string type) => type switch
    {
        "Reefer" => "Utility 3000R",
        "Dry Van" => "Wabash DuraPlate",
        "Flatbed" => "Fontaine Infinity",
        "Step Deck" => "Fontaine Velocity",
        "Tanker" => "Polar 7000 gal",
        "Lowboy" => "Trail King RGN",
        "Car Hauler" => "Cottrell 9-car",
        "Livestock" => "Wilson Silverstar",
        "Log" => "Peerless log trailer",
        _ => "Great Dane"
    };

    private static (string Type, string Len) TrailerForDivision(string division) => division switch
    {
        "Reefer" => ("Reefer", "53'"),
        "Flatbed" => ("Flatbed", "48'"),
        "Heavy Haul" => ("Lowboy", "48' RGN"),
        "Tanker" => ("Tanker", "42'"),
        "Auto" => ("Car Hauler", "75'"),
        "Livestock" => ("Livestock", "53'"),
        "Log" => ("Log", "40'"),
        "Bulk" => ("Hopper", "40'"),
        _ => ("Dry Van", "53'")
    };

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

    public static void HireDriver(AppState s, DriverApplication app, HireDecision decision)
    {
        var experienced = app.ExperienceYears >= 5;
        var green = app.ExperienceYears < 1;

        var pay = new PayPlan
        {
            LoadedCpm = green ? 0.48m : experienced ? 0.58m : 0.54m,
            DeadheadCpm = green ? 0.38m : experienced ? 0.48m : 0.44m,
            Notes = "Probationary scale. Reviewed when probation clears."
        };
        if (app.HasHazmat) pay.HazmatCpm = 0.05m;
        if (app.HasTanker) pay.ReeferCpm = Math.Max(pay.ReeferCpm, 0.03m);

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

        var quals = new List<string> { "Class A CDL" };
        if (app.HasHazmat) quals.Add("Hazmat");
        if (app.HasTanker) quals.Add("Tanker");
        if (app.HasDoublesTriples) quals.Add("Doubles/Triples");
        foreach (var f in app.FreightExperience) quals.Add($"Experience: {f}");

        var restrictions = new List<string> { "Oversize", "Heavy Haul" };
        if (green) restrictions.Add("Hazmat");

        s.Driver = new Driver
        {
            Name = app.DriverName,
            EmployeeId = $"{s.Company.Code}-{1000 + Math.Abs(StableSeed(app.DriverName) % 9000)}",
            HiredGameDate = s.Status.GameTime,
            HiredUtc = DateTime.UtcNow.ToString("o"),
            Status = "Probation",
            Rank = "probationary",
            RankTitle = "Probationary Company Driver",
            Pay = pay,
            Qualifications = quals,
            Restrictions = restrictions,
            Probation = probation,
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
