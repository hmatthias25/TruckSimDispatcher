using TruckSimDispatcher.Models;

namespace TruckSimOwnerOperator;

public static class OoBuild
{
    /// <summary>The owner/operator app's own version. The company-driver app keeps its own, in Core's Build.</summary>
    public const string Version = "0.9";
}

/// <summary>
/// One owner/operator career: the shared game state Core plans against, and what is the owner/operator's own.
///
/// <para><see cref="Game"/> is Core's <see cref="AppState"/>, so the planners, the board reader and the trip log
/// work on it unchanged. Its company-driver parts (employer, pay, probation) are left empty here and never read
/// by this app. See docs/owner-operator-plan.md, "Move first, untangle later".</para>
/// </summary>
public class OoCareer
{
    public int SchemaVersion { get; set; } = 1;
    public string AppVersion { get; set; } = OoBuild.Version;

    /// <summary>Set once the first screen has been filled in. Before that there is no truck and no home.</summary>
    public bool Started { get; set; }

    public OoProfile Profile { get; set; } = new();
    public OoSettings Settings { get; set; } = new();
    public AppState Game { get; set; } = new();

    /// <summary>Every broker in this career, known or not yet. Made once, at the start. See <see cref="BrokerBook"/>.</summary>
    public List<Broker> Brokers { get; set; } = new();
    public List<Call> Calls { get; set; } = new();
    public List<Booking> Bookings { get; set; } = new();
    public int NextBookingNumber { get; set; } = 1;
    public List<Invoice> Invoices { get; set; } = new();
    public List<Transfer> Transfers { get; set; } = new();
    public HomeLifeState HomeLife { get; set; } = new();
    public GameBankState GameBank { get; set; } = new();
    public List<Lane> Lanes { get; set; } = new();
    /// <summary>
    /// The calendar month Day 1 falls in: chosen on the first screen, 1 (January) on a career from before it, which is what
    /// those careers have always had. The game counts days and shows no month; the app's calendar is laid over the days from
    /// here, and the holidays and the month shown run on it. See HomeLife.Calendar.
    /// </summary>
    public int StartMonth { get; set; } = 1;
    /// <summary>
    /// What the player's game calls the companies, typed in, by base-game name: "Walmart, Target, Aldi" for Wallbert. Beside
    /// the names read out of a renaming mod (the game state's ModCompanyNames). See Companies.
    /// </summary>
    public Dictionary<string, string> CompanyNames { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Who is at home. Null on a career from before families, which is made single on loading (see HomeLife.MigrateFamily).</summary>
    public Family? Family { get; set; }
    /// <summary>Jobs on the board the driver told a broker they could not reach in time: no broker offers them again.</summary>
    public List<string> CantMakeLoadIds { get; set; } = new();
    public PaySeen PaySeen { get; set; } = new();
}

/// <summary>What the first screen asks, and what follows from it.</summary>
public class OoProfile
{
    public string DriverName { get; set; } = "";

    /// <summary>Where the driver lives: the truck's home garage, and where it starts.</summary>
    public string HomeCity { get; set; } = "";
    public string HomeState { get; set; } = "";

    /// <summary>Easy, Normal or Hard. Decides the starting truck and the recommended nest egg.</summary>
    public string Preset { get; set; } = "Normal";

    /// <summary>The driver's level in the game. Informational for now; brokers may look at it later.</summary>
    public int Level { get; set; }

    public OoSkills Skills { get; set; } = new();

    public string StartedGameTime { get; set; } = "";
    public double StartOdometer { get; set; }
}

/// <summary>
/// The game's skill tree as the owner/operator app reads it. ATS and ETS2 both run each skill 0 to 6; ADR is a
/// set of classes rather than a level.
/// </summary>
public class OoSkills
{
    public const int Max = 6;

    public int LongDistance { get; set; }
    public int HighValue { get; set; }
    public int Fragile { get; set; }
    public int JustInTime { get; set; }

    /// <summary>ADR (hazmat) classes unlocked, by the game's names: explosives, gases, flammable liquids, ...</summary>
    public List<string> Adr { get; set; } = new();
}

public class OoSettings
{
    /// <summary>
    /// The longest job the game offers at each Long Distance level, 0 to 6, in the game's distance unit (miles
    /// in ATS, km in ETS2). Null at a level means anywhere. Defaults to the vanilla game; economy mods (GDC's
    /// among them) change these, so every level is editable. See the plan, "The Long Distance skill".
    /// </summary>
    public List<double?> LongDistanceLimits { get; set; } = DefaultLongDistanceMiles();

    /// <summary>
    /// The all-in cost per mile every load is judged against, typed in until the Companion App link supplies
    /// it: fuel, tolls, the truck note, insurance, maintenance and living costs on the road.
    /// </summary>
    public decimal CostPerMile { get; set; } = 1.70m;

    /// <summary>The model that voices brokers on the phone. A small, fast one is enough: it only talks.</summary>
    public string PhoneModel { get; set; } = "claude-haiku-5-5";

    public static List<double?> DefaultLongDistanceMiles() => new() { 250, 400, 650, 1000, 1600, 2500, null };
    public static List<double?> DefaultLongDistanceKm() => new() { 400, 650, 1000, 1600, 2500, 4000, null };
}
