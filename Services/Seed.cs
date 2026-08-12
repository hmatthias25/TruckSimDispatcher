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

        // Relay yards in different states from HQ and from each other. A six-truck carrier runs a
        // regional network, not a coast-to-coast one, so aim for roughly a day or two out rather
        // than the farthest market on the map.
        const double RelayTarget = 10.0;   // ~700-1,000 mi in the crude centroid units
        var secondary = Markets.Effective(s)
            .Where(c => c.Tier == 1 && c.ResetFriendly && !c.State.Equals(hqState, StringComparison.OrdinalIgnoreCase))
            .GroupBy(c => c.State)
            .Select(g => g.OrderBy(c => c.City).First())
            .Where(c => StateDistanceScore(hqState, c.State) > 3)
            .OrderBy(c => Math.Abs(StateDistanceScore(hqState, c.State) - RelayTarget))
            .Take(2)
            .ToList();

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

        // HQ is a full-service yard; relay points are smaller. Even the smallest has fuel and
        // parking — a yard that cannot fuel or hold a truck is no use to dispatch.
        s.Company.Terminals.Clear();
        s.Company.Terminals.Add(Migrations.BuildTerminal(s, hqCity, hqState, isHq: true, "Large"));
        for (var i = 0; i < secondary.Count; i++)
            s.Company.Terminals.Add(Migrations.BuildTerminal(
                s, secondary[i].City, secondary[i].State, isHq: false, i == 0 ? "Medium" : "Small"));
        Migrations.SyncHeadquarters(s);

        s.Settings.FreightPrefix = profile.Code;

        // Starting finances for a small, real carrier — leveraged, not rich.
        ApplyDefaultAccounts(s);
        SetOpening(s, LedgerService.Operating, 184_500m);
        SetOpening(s, LedgerService.MaintenanceReserve, 46_000m);
        SetOpening(s, LedgerService.PayrollReserve, 28_500m);
        SetOpening(s, LedgerService.EquipmentNote, -412_000m);
    }

    /// <summary>
    /// Rough state centroids, used only to spread terminals apart geographically so the
    /// generated network looks like a real carrier's rather than three yards in one state.
    /// </summary>
    private static readonly Dictionary<string, (double Lat, double Lon)> StateCenters = new()
    {
        ["AL"] = (32.8, -86.8), ["AZ"] = (34.2, -111.7), ["AR"] = (34.9, -92.4), ["CA"] = (37.2, -119.5),
        ["CO"] = (39.0, -105.5), ["CT"] = (41.6, -72.7), ["DE"] = (39.0, -75.5), ["FL"] = (28.6, -82.4),
        ["GA"] = (32.6, -83.4), ["ID"] = (44.4, -114.6), ["IL"] = (40.0, -89.2), ["IN"] = (39.9, -86.3),
        ["IA"] = (42.1, -93.5), ["KS"] = (38.5, -98.4), ["KY"] = (37.5, -85.3), ["LA"] = (31.1, -92.0),
        ["ME"] = (45.4, -69.2), ["MD"] = (39.0, -76.8), ["MA"] = (42.3, -71.8), ["MI"] = (44.3, -85.4),
        ["MN"] = (46.3, -94.3), ["MS"] = (32.7, -89.7), ["MO"] = (38.4, -92.5), ["MT"] = (47.0, -109.6),
        ["NE"] = (41.5, -99.8), ["NV"] = (39.3, -116.6), ["NH"] = (43.7, -71.6), ["NJ"] = (40.2, -74.7),
        ["NM"] = (34.4, -106.1), ["NY"] = (42.9, -75.5), ["NC"] = (35.5, -79.4), ["ND"] = (47.4, -100.5),
        ["OH"] = (40.3, -82.8), ["OK"] = (35.6, -97.5), ["OR"] = (43.9, -120.6), ["PA"] = (40.9, -77.8),
        ["RI"] = (41.7, -71.6), ["SC"] = (33.9, -80.9), ["SD"] = (44.4, -100.2), ["TN"] = (35.8, -86.4),
        ["TX"] = (31.5, -99.3), ["UT"] = (39.3, -111.7), ["VT"] = (44.1, -72.7), ["VA"] = (37.5, -78.9),
        ["WA"] = (47.4, -120.5), ["WV"] = (38.6, -80.6), ["WI"] = (44.6, -89.7), ["WY"] = (43.0, -107.5),
    };

    private static double StateDistanceScore(string from, string to)
    {
        if (!StateCenters.TryGetValue((from ?? "").ToUpperInvariant(), out var a)) return 0;
        if (!StateCenters.TryGetValue((to ?? "").ToUpperInvariant(), out var b)) return 0;
        var dLat = a.Lat - b.Lat;
        var dLon = (a.Lon - b.Lon) * Math.Cos(a.Lat * Math.PI / 180);
        return Math.Sqrt(dLat * dLat + dLon * dLon);
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

    public static void CreateFleet(AppState s, DriverApplication app)
    {
        s.Trucks.Clear();
        s.Trailers.Clear();

        var wantsManual = app.TransmissionPreference == "manual";
        var pool = new List<TruckSpec>();
        // A real small fleet is mixed. Weight it toward the driver's preference.
        if (wantsManual) { pool.AddRange(ManualSpecs.Take(3)); pool.AddRange(AmtSpecs.Take(3)); }
        else { pool.AddRange(AmtSpecs.Take(3)); pool.AddRange(ManualSpecs.Take(3)); }

        // Spread the fleet across the yards the carrier actually operates, respecting each yard's
        // capacity, rather than parking everything at headquarters.
        var yards = s.Company.Terminals.Count > 0
            ? s.Company.Terminals.OrderByDescending(t => t.IsHeadquarters).ThenByDescending(t => t.TruckCapacity).ToList()
            : new List<Terminal>();
        var divisions = s.Company.Divisions;
        var rnd = new Random(StableSeed(app.DriverName + s.Company.Code));

        for (var i = 0; i < pool.Count; i++)
        {
            var spec = pool[i];
            var unit = $"{101 + i * 3}";
            // Company-service mileage is roleplay history and is fine to invent — it is the
            // carrier's own book, not something ATS reports. Damage is NOT: the driver cannot set
            // damage in ATS, so a fabricated figure could never be reconciled with the game.
            // Everything starts undamaged and only moves when the driver reports a real reading.
            var serviceMiles = rnd.Next(180, 720) * 1000 + rnd.Next(0, 999);
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
                AssignedFreightTypes = divisions.Skip(i % Math.Max(1, divisions.Count)).Take(2).ToList(),
                ServiceMiles = serviceMiles,
                LastServiceMiles = Math.Max(0, serviceMiles - rnd.Next(2000, 18000)),
                ServiceIntervalMiles = 25000,
                DamagePct = 0,
                InGameGarage = false,
                Status = "InService",
                HomeTerminalId = NextYardWithRoom(s, yards, i),
                PurchasePrice = 118_000m + rnd.Next(0, 46) * 1000m,
                MonthlyPayment = 2_150m + rnd.Next(0, 12) * 50m,
                Notes = spec.Cab == "Day Cab" ? "Local/regional spec — not for OTR dispatch." : ""
            });
        }

        // Trailers: cover every division the company runs, plus spares.
        var trailerPlan = new List<(string Type, string Division, string Len, int Count)>();
        foreach (var d in divisions)
        {
            var (type, len) = TrailerForDivision(d);
            trailerPlan.Add((type, d, len, d == divisions[0] ? 4 : 2));
        }

        var tNum = 501;
        foreach (var plan in trailerPlan)
        {
            for (var i = 0; i < plan.Count; i++)
            {
                s.Trailers.Add(new Trailer
                {
                    Unit = $"T{tNum}",
                    Type = plan.Type,
                    Division = plan.Division,
                    Year = 2016 + rnd.Next(0, 9),
                    Make = plan.Type switch
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
                    },
                    Length = plan.Len,
                    Axles = plan.Type is "Lowboy" or "Car Hauler" ? "Tri-axle" : "Tandem",
                    DamagePct = 0,
                    InGameGarage = false,
                    ServiceMiles = rnd.Next(60, 480) * 1000,
                    Status = "InService",
                    HomeTerminalId = yards.Count > 0 ? yards[0].Id : "",
                    CurrentLocation = yards.Count > 0 ? $"{yards[0].City}, {yards[0].State}" : ""
                });
                tNum += 2;
            }
        }
    }

    /// <summary>
    /// Places a tractor at the first yard with a free slot, so the seeded fleet never starts over
    /// capacity. Falls back to headquarters if every yard is full — the player can re-home units.
    /// </summary>
    private static string NextYardWithRoom(AppState s, List<Terminal> yards, int index)
    {
        if (yards.Count == 0) return "";
        foreach (var y in yards)
            if (Migrations.RoomAt(s, y) > 0) return y.Id;
        return yards[index % yards.Count].Id;
    }

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
