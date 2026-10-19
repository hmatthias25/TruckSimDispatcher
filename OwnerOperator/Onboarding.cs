using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>What the first screen sends. See the plan, "The first screen".</summary>
public record StartRequest(
    string? Game,
    string? DriverName,
    string? HomeCity,
    string? HomeState,
    int Day,
    string? Time,
    int Level,
    int LongDistance,
    int HighValue,
    int Fragile,
    int JustInTime,
    List<string>? Adr,
    double Odometer,
    string? Preset);

/// <summary>
/// The first screen: home, the clock, level and skills, the odometer and the preset. Everything Core needs to plan
/// the first load is built from it: a home garage, one truck there, power-only, and full clocks.
/// </summary>
public static class Onboarding
{
    public static readonly string[] Presets = { "Easy", "Normal", "Hard" };

    public static void Start(OoCareer c, StartRequest r)
    {
        if (c.Started) throw new InvalidOperationException("This career has already started. Reset it to begin again.");

        // ATS first, as agreed. ETS2 is wired through Core already and opens up once brokers work there.
        var game = GameSetup.Normalise(r.Game) ?? GameProfile.Ats.Id;
        if (game != GameProfile.Ats.Id)
            throw new InvalidOperationException("Owner-Operator 0.9 runs American Truck Simulator careers. ETS2 is coming.");

        var s = new AppState();
        GameSetup.Choose(s, game);
        s.Settings = GameSetup.DefaultsFor(s, null);
        // The screenshot reader and the phone both run on the player's key once there is one.
        s.Settings.AiEnabled = true;

        var city = (r.HomeCity ?? "").Trim();
        var state = (r.HomeState ?? "").Trim().ToUpperInvariant();
        if (city.Length == 0 || state.Length == 0)
            throw new InvalidOperationException("Where is home? The city and state of the truck's home garage.");
        var market = Markets.Find(s, city, state);
        if (market == null && !Geo.Knows(city, state))
            throw new InvalidOperationException($"{city}, {state} is not a city I know in ATS. Pick it from the list.");
        if (market != null) { city = market.City; state = market.State; }

        if (r.Day < 1) throw new InvalidOperationException("The game's day number, off the clock in the game (Day 1 on a new profile).");
        var at = GameClock.FromDayTime(r.Day, r.Time)
                 ?? throw new InvalidOperationException("The game's time of day, as HH:MM.");
        if (r.Odometer < 0) throw new InvalidOperationException("The odometer cannot be negative.");

        var preset = Presets.FirstOrDefault(p => p.Equals(r.Preset ?? "", StringComparison.OrdinalIgnoreCase)) ?? "Normal";
        var name = string.IsNullOrWhiteSpace(r.DriverName) ? "Owner-Operator" : r.DriverName.Trim();

        s.CareerName = name;
        s.Onboarded = true;
        s.CreatedUtc = DateTime.UtcNow.ToString("o");

        // The home garage, as a yard of one. Core finds "home" through the terminal list.
        var home = new Terminal
        {
            Name = $"Home garage — {city}, {state}",
            City = city,
            State = state,
            Level = "Small",
            TruckCapacity = 1,
            IsHeadquarters = true,
            HasParking = true,
            HasFuel = market?.HasFuel ?? true,
        };
        s.Company.Name = name;
        s.Company.Terminals = new() { home };

        var truck = StartingTruck(preset, r.Odometer);
        s.Trucks = new() { truck };

        s.Driver.Name = name;
        // Core's shipper and receiver rolls are seeded off the driver's id.
        s.Driver.EmployeeId = $"OO-{BrokerBook.Stable($"{name}|{city}|{state}|{s.Status.GameTime}") % 100000:00000}";
        s.Driver.HomeTerminalId = home.Id;
        s.Driver.AssignedTruckUnit = truck.Unit;
        s.Driver.Skills = new DriverSkills
        {
            LongDistance = Math.Clamp(r.LongDistance, 0, OoSkills.Max),
            HighValue = Math.Clamp(r.HighValue, 0, OoSkills.Max),
            Fragile = Math.Clamp(r.Fragile, 0, OoSkills.Max),
            JustInTime = Math.Clamp(r.JustInTime, 0, OoSkills.Max),
        };
        // Company home time is not how this app sends a driver home; home life is (see the plan, "Home time").
        s.Driver.HomeTimeIntervalDays = 0;

        s.Status.LocationCity = city;
        s.Status.LocationState = state;
        s.Status.LocationKind = "Garage";
        s.Status.LocationDetail = "Home garage";
        s.Status.GameTime = GameClock.Format(at);
        s.Status.AtsOdometer = r.Odometer;
        s.Status.FuelPct = 100;
        s.Status.DutyStatus = "OffDuty";
        s.Status.Confirmed = true;

        // No trailer: freight-market jobs on the shipper's trailer, which Core models as drop and hook.
        var power = DropHook.Ensure(s);
        s.Driver.AssignedTrailerUnit = power.Unit;

        // A fresh profile starts rested.
        var rules = s.Settings.Hos;
        s.Hos.DriveRemaining = rules.DriveLimit;
        s.Hos.ShiftRemaining = rules.ShiftLimit;
        s.Hos.BreakRemaining = rules.DrivingBeforeBreak;
        s.Hos.CycleRemaining = rules.CycleLimit;
        s.Hos.AsOfGameTime = s.Status.GameTime;
        s.Hos.Source = "Fresh start";
        s.Hos.Confirmed = true;

        // Home is the one city a fresh profile has discovered, and so the only place the first board can come from.
        s.Discovered.Add(new DiscoveredCity
        {
            City = city, State = state, DiscoveredGameTime = s.Status.GameTime,
            GarageAvailable = true, GarageOwned = true, Notified = true,
        });

        c.Game = s;
        c.Settings = new OoSettings
        {
            LongDistanceLimits = OoSettings.DefaultLongDistanceMiles(),
            CostPerMile = preset == "Easy" ? 1.55m : preset == "Hard" ? 1.85m : 1.70m,
        };
        c.Profile = new OoProfile
        {
            DriverName = name,
            HomeCity = city,
            HomeState = state,
            Preset = preset,
            Level = Math.Max(0, r.Level),
            Skills = new OoSkills
            {
                LongDistance = s.Driver.Skills.LongDistance,
                HighValue = s.Driver.Skills.HighValue,
                Fragile = s.Driver.Skills.Fragile,
                JustInTime = s.Driver.Skills.JustInTime,
                Adr = (r.Adr ?? new()).Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim()).Distinct().ToList(),
            },
            StartedGameTime = s.Status.GameTime,
            StartOdometer = r.Odometer,
        };
        c.Started = true;

        // The broker roster, fixed for the career, and the directory: the brokers who work home.
        c.Brokers = BrokerBook.Generate(c);
        BrokerBook.Refresh(c);
        HomeLife.Begin(c);

        OoStore.Log(c, "career", $"{name} starts out of {city}, {state}: {preset} preset, power-only, Long Distance {c.Profile.Skills.LongDistance}.");
    }

    /// <summary>
    /// The truck a preset starts with. A placeholder until the Companion App supplies the real one; the player can
    /// edit it. Older is cheaper to buy and dearer to run, which the Companion App's costs will make bite.
    /// </summary>
    private static Truck StartingTruck(string preset, double odometer) => new()
    {
        Unit = "1",
        Make = preset == "Easy" ? "Freightliner" : "Peterbilt",
        Model = preset == "Easy" ? "Cascadia" : "579",
        Year = preset == "Easy" ? 2019 : 2013,
        CabConfig = "Sleeper",
        GovernedMph = 65,
        FuelCapacityGal = 240,
        AvgMpg = preset == "Easy" ? 6.8 : 6.0,
        InGameGarage = true,
        AtsOdometer = odometer,
        Status = "InService",
        Notes = "Your own truck. Match it to the one you bought in the game.",
    };
}
