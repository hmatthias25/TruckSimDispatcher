namespace TruckSimDispatcher.Models;

/// <summary>Root persisted document. One file = one driver career.</summary>
public class AppState
{
    public int SchemaVersion { get; set; } = 1;
    /// <summary>Build that last wrote this file, so an old career can say where it came from.</summary>
    public string AppVersion { get; set; } = "";
    public bool Onboarded { get; set; }
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");

    public DriverApplication? Application { get; set; }
    public Company Company { get; set; } = new();
    public Driver Driver { get; set; } = new();
    public AppSettings Settings { get; set; } = new();

    public List<Truck> Trucks { get; set; } = new();
    public List<Trailer> Trailers { get; set; } = new();

    public DriverStatus Status { get; set; } = new();
    public HosSnapshot Hos { get; set; } = new();

    public List<Account> Accounts { get; set; } = new();
    public List<LedgerEntry> Ledger { get; set; } = new();

    public List<Trip> Trips { get; set; } = new();
    public List<BoardLoad> Board { get; set; } = new();
    public List<Settlement> Settlements { get; set; } = new();
    public List<Incident> Incidents { get; set; } = new();
    public List<DisciplineAction> Discipline { get; set; } = new();
    public List<WorkOrder> WorkOrders { get; set; } = new();
    public List<MarketCity> MarketExtras { get; set; } = new();
    public List<DiscoveredCity> Discovered { get; set; } = new();
    public List<HiredDriver> HiredDrivers { get; set; } = new();
    public List<FleetReport> FleetReports { get; set; } = new();
    public List<EquipmentOrder> EquipmentOrders { get; set; } = new();
    /// <summary>Trailers the company has asked for. The player buys them in ATS and reports the price.</summary>
    public List<TrailerRequest> TrailerRequests { get; set; } = new();
    /// <summary>Home time the driver has asked for, and what operations said.</summary>
    public List<HomeTimeRequest> HomeTimeRequests { get; set; } = new();
    /// <summary>Fortnightly reviews while on probation. Kept on the file afterwards.</summary>
    public List<ProbationReview> ProbationReviews { get; set; } = new();
    /// <summary>Trailer types the driver has asked to be re-rigged onto.</summary>
    public List<TrailerTypeRequest> TrailerTypeRequests { get; set; } = new();

    public Counters Counters { get; set; } = new();
    public List<LogEvent> Events { get; set; } = new();
}

// ---------------------------------------------------------------- onboarding

public class DriverApplication
{
    public string DriverName { get; set; } = "";
    public string PreferredDivision { get; set; } = "";
    public string SecondDivision { get; set; } = "";
    /// <summary>"automatic" | "manual" | "either"</summary>
    public string TransmissionPreference { get; set; } = "either";
    /// <summary>Years behind the wheel, driver-reported.</summary>
    public double ExperienceYears { get; set; }
    public List<string> FreightExperience { get; set; } = new();
    /// <summary>"short" | "medium" | "long" | "otr"</summary>
    public string PreferredTripLength { get; set; } = "medium";
    /// <summary>
    /// How long the driver is willing to stay out: weekly | biweekly | threeweeks | monthly |
    /// sixweeks | none. A key rather than free text, because dispatch actually routes for it —
    /// see <see cref="Driver.HomeTimeIntervalDays"/>.
    /// </summary>
    public string HomeTimePreference { get; set; } = "biweekly";
    public string HomeCity { get; set; } = "";
    public string HomeState { get; set; } = "";
    public List<string> WillNotHaul { get; set; } = new();
    public bool AcceptsProbation { get; set; } = true;
    public bool HasHazmat { get; set; }
    public bool HasTanker { get; set; }
    public bool HasDoublesTriples { get; set; }
    public string Notes { get; set; } = "";
    public string SubmittedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

public class HireDecision
{
    public bool Hired { get; set; }
    public string Decision { get; set; } = "";
    public List<string> Reasons { get; set; } = new();
    public List<string> Conditions { get; set; } = new();
}

// ---------------------------------------------------------------- company

/// <summary>
/// A company yard. Mirrors an ATS garage, but modelled as a real carrier terminal: a yard is only
/// useful to dispatch if it can actually fuel and fix a truck, so services are tracked explicitly
/// and feed fuel cost, repair cost and reset planning.
/// </summary>
public class Terminal
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    /// <summary>Small | Medium | Large — the ATS garage tiers.</summary>
    public string Level { get; set; } = "Small";
    /// <summary>Tractors the yard can hold. ATS tiers are roughly 1 / 3 / 5.</summary>
    public int TruckCapacity { get; set; } = 1;
    /// <summary>
    /// How many trailers this yard can hold. ATS garages take more trailers than tractors, so this is
    /// deliberately roomier than <see cref="TruckCapacity"/>.
    /// </summary>
    public int TrailerCapacity { get; set; } = 3;
    public bool IsHeadquarters { get; set; }

    // --- services
    public bool HasFuel { get; set; }
    public bool HasShop { get; set; }
    public bool HasParking { get; set; } = true;
    public bool HasTrailerDrop { get; set; } = true;
    public bool HasDriverFacilities { get; set; }

    /// <summary>Bulk contract fuel price at this yard. 0 = no fuel island, pay retail.</summary>
    public decimal FuelPricePerGal { get; set; }
    /// <summary>Share off a repair bill when the work is done in our own shop (0.25 = 25% cheaper).</summary>
    public double ShopLabourDiscount { get; set; }
    public decimal MonthlyCost { get; set; }
    public string Notes { get; set; } = "";
}

public class Company
{
    public string Name { get; set; } = "";
    /// <summary>Trip-number prefix, e.g. SFL.</summary>
    public string Code { get; set; } = "SFL";
    public string DotNumber { get; set; } = "";
    public string McNumber { get; set; } = "";
    /// <summary>Mirror of the headquarters terminal, kept in step by <see cref="Terminals"/>.</summary>
    public string TerminalCity { get; set; } = "";
    public string TerminalState { get; set; } = "";
    /// <summary>Every yard the carrier operates. The headquarters is flagged inside.</summary>
    public List<Terminal> Terminals { get; set; } = new();

    /// <summary>
    /// Cities this carrier runs terminals in, as "City,ST" — headquarters plus its published yards.
    ///
    /// A company driver does not decide where their employer opens terminals, so this is what garage
    /// opportunities are checked against. Empty means a fictional carrier with no real network to be
    /// faithful to, and anywhere the driver has reached is fair game.
    /// </summary>
    public List<string> NetworkCities { get; set; } = new();

    /// <summary>
    /// What this carrier is like to work for, 1-5, mirroring the ratings shown in the job market.
    ///
    /// These decide retention. A five-star outfit with good pay and good equipment keeps its people; a
    /// two-star one trains drivers up and watches them leave. That gives working up the carrier ladder
    /// a consequence on the fleet side, not just on the player's own payslip.
    /// </summary>
    public int PayStars { get; set; }
    public int HomeTimeStars { get; set; }

    /// <summary>Overall standing as an employer — the average of the three, 1-5. Zero means unknown.</summary>
    public double EmployerStars =>
        EquipmentStars + PayStars + HomeTimeStars <= 0
            ? 0
            : Math.Round(new[] { EquipmentStars, PayStars, HomeTimeStars }.Where(x => x > 0).Average(), 2);
    [Obsolete("Superseded by Terminals; retained so older career files still load.")]
    public List<string> SecondaryTerminals { get; set; } = new();
    public string Founded { get; set; } = "";
    /// <summary>
    /// The carrier's equipment standard, 1-5. Decides what you are put in: a five-star fleet issues
    /// current-model tractors with low mileage, a one-star fleet issues what it has. Signing with a
    /// better carrier should be something you can see from the driver's seat, not just on the payslip.
    /// </summary>
    public int EquipmentStars { get; set; } = 3;
    public List<string> Divisions { get; set; } = new();
    public string OperatingAuthorityNotes { get; set; } = "";
    public string Motto { get; set; } = "";
}

public class Counters
{
    public int Freight { get; set; }
    public int EmptyMove { get; set; }
    public int Maintenance { get; set; }
    public int Cancelled { get; set; }
    public int Settlement { get; set; }
    public int WorkOrder { get; set; }
    public int Incident { get; set; }
}

// ---------------------------------------------------------------- driver

public class Driver
{
    public string Name { get; set; } = "";
    public string EmployeeId { get; set; } = "";
    public string HiredGameDate { get; set; } = "";
    public string HiredUtc { get; set; } = "";
    /// <summary>Probation | Active | Suspended | Terminated | Resigned</summary>
    public string Status { get; set; } = "Probation";
    /// <summary>Rank key from CareerService ladder.</summary>
    public string Rank { get; set; } = "probationary";

    /// <summary>
    /// Operations approved a home-time request, so dispatch is routing home whether or not the
    /// interval says they are due. Cleared when they actually get there.
    ///
    /// For a driver on no arrangement this is the only thing that ever routes them home — which is the
    /// deal they signed when they elected to stay out.
    /// </summary>
    public bool HomeTimeGranted { get; set; }
    public string HomeTimeGrantedGameTime { get; set; } = "";

    /// <summary>
    /// True while the driver is parked at their home yard.
    ///
    /// Home time is counted on the <b>transition</b> into the yard, not on every status report made
    /// from it. Without this, a driver sitting out a 34 at the house and reporting their clocks each
    /// day was recorded as taking home time again every day.
    /// </summary>
    public bool AtHomeYard { get; set; }
    public string RankTitle { get; set; } = "Probationary Company Driver";
    public PayPlan Pay { get; set; } = new();
    /// <summary>
    /// Company unlocks — what the carrier permits this driver to run. Written by rank promotion.
    /// NOT the driver's licence: see <see cref="Endorsements"/>.
    /// </summary>
    public List<string> Qualifications { get; set; } = new();

    /// <summary>
    /// CDL endorsements the driver actually holds. Hazmat, Tanker, Doubles/Triples.
    ///
    /// Deliberately separate from <see cref="Qualifications"/>. Promotion to company driver lifts the
    /// company's hazmat restriction, which is not the same thing as the driver having sat the exam —
    /// conflating the two hands out an endorsement nobody earned. Both have to be true to haul it.
    /// </summary>
    public List<string> Endorsements { get; set; } = new();
    public List<string> Restrictions { get; set; } = new();
    public string AssignedTruckUnit { get; set; } = "";
    public string AssignedTrailerUnit { get; set; } = "";
    /// <summary>Terminal the driver is domiciled out of — where home time starts and ends.</summary>
    public string HomeTerminalId { get; set; } = "";
    /// <summary>
    /// Game days the driver agreed to stay out before going home. 0 means no arrangement, so dispatch
    /// never routes for it. Taken from the application and honoured by the load scorer: as the driver
    /// approaches it, loads that finish near the home terminal are worth more, and once it is passed,
    /// freight running the other way is argued against.
    /// </summary>
    public int HomeTimeIntervalDays { get; set; }
    /// <summary>Game time the driver was last at their home terminal. Blank = never, count from hire.</summary>
    public string LastHomeGameTime { get; set; } = "";
    /// <summary>Home times taken, for the driver file.</summary>
    public int HomeTimesTaken { get; set; }

    /// <summary>
    /// The driver is on a dedicated account: assigned to one customer, hauling their freight only.
    ///
    /// Set when the carrier runs a Dedicated division and the driver asked for it. The customer is
    /// NOT invented — the app cannot see which shippers exist in the player's game or their mods, so
    /// the player names it from what they actually see on the board, and dispatch filters to it.
    /// </summary>
    public bool OnDedicated { get; set; }
    /// <summary>The customer, as they appear in ATS. Blank while the driver has not named them yet.</summary>
    public string DedicatedAccount { get; set; } = "";
    /// <summary>Loads run off-account by exception, so the pattern is visible rather than silent.</summary>
    public int OffAccountLoads { get; set; }
    public List<TransferRequest> Transfers { get; set; } = new();
    public ProbationPlan Probation { get; set; } = new();
    /// <summary>Driver pay accrued but not yet paid out on a settlement.</summary>
    public decimal UnsettledPay { get; set; }
    /// <summary>Game day of the last payday processed, so a Friday is never paid twice.</summary>
    public int LastPaydayDay { get; set; }
    public decimal LifetimeEarnings { get; set; }

    /// <summary>Loads run for previous employers. A carrier screens on your whole record, not
    /// just what you have done since you walked through their door.</summary>
    public int PriorLoads { get; set; }
    public double PriorMiles { get; set; }
    public int PriorFaultIncidents { get; set; }
    public List<EmploymentRecord> EmploymentHistory { get; set; } = new();

    public string Notes { get; set; } = "";
}

/// <summary>A completed stint at a carrier, kept so the record follows the driver.</summary>
public class EmploymentRecord
{
    public string CarrierCode { get; set; } = "";
    public string CarrierName { get; set; } = "";
    public string StartedGameDate { get; set; } = "";
    public string EndedGameDate { get; set; } = "";
    public string RankAtExit { get; set; } = "";
    public int LoadsDelivered { get; set; }
    public double Miles { get; set; }
    public double OnTimePct { get; set; }
    public int DriverFaultIncidents { get; set; }
    public decimal Earnings { get; set; }
    /// <summary>Resigned | Terminated | Laid off</summary>
    public string Separation { get; set; } = "Resigned";
    public string Reason { get; set; } = "";
}

/// <summary>A driver's request to re-domicile to another terminal, and what operations said.</summary>
public class TransferRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string FromTerminalId { get; set; } = "";
    public string ToTerminalId { get; set; } = "";
    public string ToTerminalName { get; set; } = "";
    public string RequestedGameTime { get; set; } = "";
    public string Reason { get; set; } = "";
    /// <summary>Approved | Conditional | Deferred | Denied</summary>
    public string Outcome { get; set; } = "";
    public string Decision { get; set; } = "";
    public List<string> Factors { get; set; } = new();
    /// <summary>For Conditional/Deferred: loads still to run before it is revisited.</summary>
    public int LoadsRequired { get; set; }
    public int LoadCountAtRequest { get; set; }
    public bool Effective { get; set; }
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

public class PayPlan
{
    public decimal LoadedCpm { get; set; } = 0.54m;
    public decimal DeadheadCpm { get; set; } = 0.44m;
    public decimal ReeferCpm { get; set; } = 0.03m;
    public decimal HazmatCpm { get; set; } = 0.04m;
    public decimal OversizeCpm { get; set; } = 0.06m;
    public decimal TarpPay { get; set; } = 50m;
    public decimal ExtraStopPay { get; set; } = 25m;
    /// <summary>Paid per hour after DetentionFreeHours at a shipper/receiver.</summary>
    public decimal DetentionPerHour { get; set; } = 20m;
    public double DetentionFreeHours { get; set; } = 2;
    public decimal LayoverPerDay { get; set; } = 125m;
    public decimal BreakdownPerDay { get; set; } = 100m;
    /// <summary>Retroactive per-mile kicker paid on a settlement with 100% on-time service.</summary>
    public decimal OnTimeBonusCpm { get; set; } = 0.02m;
    public decimal SafetyBonusPerSettlement { get; set; } = 150m;
    /// <summary>Minimum gross per settlement period once off probation. 0 = none.</summary>
    public decimal WeeklyGuarantee { get; set; } = 0m;
    public string Notes { get; set; } = "";
}

public class ProbationPlan
{
    public bool Active { get; set; } = true;
    public int RequiredLoads { get; set; } = 10;
    public double RequiredMiles { get; set; } = 6000;
    public double RequiredOnTimePct { get; set; } = 95;
    public double MaxAvgDamagePct { get; set; } = 5;
    public int MaxDriverFaultIncidents { get; set; } = 1;
    public int DurationDays { get; set; } = 90;
    public string StartedGameDate { get; set; } = "";
    public string ClearedGameDate { get; set; } = "";
    public string Notes { get; set; } = "";
}

// ---------------------------------------------------------------- equipment

public class Truck
{
    public string Unit { get; set; } = "";
    /// <summary>
    /// The ID ATS shows for this unit in game. Optional.
    ///
    /// This is the name the player can actually read off the truck when they walk up to it, so it is
    /// what the app calls the unit everywhere the player reads about one. It is a <b>display name
    /// only</b> — <see cref="Unit"/> stays the key that work orders, trips and driver assignments are
    /// filed against, because a career file full of cross-references must not break because somebody
    /// typed a plate in. Blank means nothing changes.
    /// </summary>
    public string GameId { get; set; } = "";

    /// <summary>What to call this unit when telling the player about it.</summary>
    public string Ref => string.IsNullOrWhiteSpace(GameId) ? Unit : GameId.Trim();
    public string Make { get; set; } = "";
    public string Model { get; set; } = "";
    public int Year { get; set; }
    public string Engine { get; set; } = "";
    public int Horsepower { get; set; }
    public string Transmission { get; set; } = "";
    /// <summary>"automatic" | "manual"</summary>
    public string TransmissionType { get; set; } = "manual";
    /// <summary>"Sleeper" | "Day Cab"</summary>
    public string CabConfig { get; set; } = "Sleeper";
    public string Wheelbase { get; set; } = "";
    public int GovernedMph { get; set; } = 65;
    public double FuelCapacityGal { get; set; } = 250;
    public double AvgMpg { get; set; } = 6.5;
    public List<string> AssignedFreightTypes { get; set; } = new();
    /// <summary>
    /// True when this unit actually exists in the driver's ATS garage, so its damage and odometer
    /// are real values reported from the game. False means it is company backdrop — the carrier
    /// "owns" it for roleplay, but ATS knows nothing about it, so the app must not invent damage
    /// for it or raise shop directives against it.
    /// </summary>
    public bool InGameGarage { get; set; }
    /// <summary>Roleplay company-service odometer (may differ from the ATS odometer).</summary>
    public double ServiceMiles { get; set; }
    /// <summary>Odometer as shown in ATS.</summary>
    public double AtsOdometer { get; set; }
    public double DamagePct { get; set; }

    /// <summary>
    /// Condition as ATS shows it for a unit the player is NOT driving: a star rating, five down to one.
    ///
    /// The game gives no damage percentage for a truck under a hired driver, only stars. So an AI unit's
    /// maintenance rules are written in stars and its <see cref="DamagePct"/> is left alone — asking the
    /// player for a percentage the game never displays is asking them to invent one.
    /// </summary>
    public double Stars { get; set; }
    /// <summary>When the star rating was last read off the game.</summary>
    public string StarsReportedGameTime { get; set; } = "";
    public string AssignedDriver { get; set; } = "";
    /// <summary>InService | Shop | OutOfService | Reserve</summary>
    public string Status { get; set; } = "InService";
    /// <summary>Terminal this unit is based out of. Authoritative — counts against yard capacity.</summary>
    public string HomeTerminalId { get; set; } = "";
    [Obsolete("Superseded by HomeTerminalId; kept so older career files still load.")]
    public string HomeTerminal { get; set; } = "";
    public double LastServiceMiles { get; set; }
    public double ServiceIntervalMiles { get; set; } = 25000;
    /// <summary>
    /// Everything the company has spent keeping this unit running. What turns a trade decision from a
    /// hunch into an argument: a truck costing more in the shop than the payment is worth is finished,
    /// whatever the odometer says.
    /// </summary>
    public decimal LifetimeRepairCost { get; set; }
    /// <summary>Retired from the fleet — kept on the book so its trip history still resolves.</summary>
    public bool Retired { get; set; }
    public string RetiredGameTime { get; set; } = "";
    public decimal PurchasePrice { get; set; }
    public decimal MonthlyPayment { get; set; }
    public string Notes { get; set; } = "";
}

public class Trailer
{
    public string Unit { get; set; } = "";
    /// <summary>
    /// The ID ATS shows for this unit in game. Optional.
    ///
    /// This is the name the player can actually read off the truck when they walk up to it, so it is
    /// what the app calls the unit everywhere the player reads about one. It is a <b>display name
    /// only</b> — <see cref="Unit"/> stays the key that work orders, trips and driver assignments are
    /// filed against, because a career file full of cross-references must not break because somebody
    /// typed a plate in. Blank means nothing changes.
    /// </summary>
    public string GameId { get; set; } = "";

    /// <summary>What to call this unit when telling the player about it.</summary>
    public string Ref => string.IsNullOrWhiteSpace(GameId) ? Unit : GameId.Trim();
    /// <summary>Dry Van, Reefer, Flatbed, Step Deck, Tanker, Dump, Lowboy, Car Hauler, Livestock, Log</summary>
    public string Type { get; set; } = "";
    /// <summary>
    /// What kind of tanker: Fuel, Chemical, Food Grade, Dry Bulk, Gas. "Tanker" on its own is not
    /// something a driver can act on — a fuel tanker, a food-grade tanker and a pneumatic dry-bulk
    /// tanker are different trailers hauling different freight under different endorsements, and
    /// "buy a tanker" sends someone to a dealer with the decision still to make.
    /// </summary>
    public string Subtype { get; set; } = "";
    public string Division { get; set; } = "";
    public int Year { get; set; }
    public string Make { get; set; } = "";
    public string Length { get; set; } = "53'";
    public string Axles { get; set; } = "Tandem";
    /// <summary>See <see cref="Truck.InGameGarage"/> — real ATS equipment vs company backdrop.</summary>
    public bool InGameGarage { get; set; }
    public double DamagePct { get; set; }
    public double ServiceMiles { get; set; }

    /// <summary>
    /// Condition as ATS shows it for a trailer under a hired driver — a star rating, five down to one.
    /// Same reasoning as <see cref="Truck.Stars"/>: the game shows stars, not a percentage.
    /// </summary>
    public double Stars { get; set; }
    public string StarsReportedGameTime { get; set; } = "";

    /// <summary>
    /// When this trailer joined the fleet. Trailers carry no odometer, so age is the only independent
    /// signal of a tired unit — and star loss on a trailer may never come. An old box still earning is
    /// fine; an old box earning nothing is the one to replace.
    /// </summary>
    public string AcquiredGameTime { get; set; } = "";

    /// <summary>InService | Shop | OutOfService | Reserve</summary>
    public string Status { get; set; } = "InService";
    /// <summary>Terminal this trailer is based out of.</summary>
    public string HomeTerminalId { get; set; } = "";
    [Obsolete("Superseded by HomeTerminalId; kept so older career files still load.")]
    public string HomeTerminal { get; set; } = "";
    public string CurrentLocation { get; set; } = "";
    public string AssignedTruckUnit { get; set; } = "";
    public bool IsCompanyOwned { get; set; } = true;
    /// <summary>Replaced and out of the fleet — kept on the book so its trip history still resolves.</summary>
    public bool Retired { get; set; }
    public string RetiredGameTime { get; set; } = "";
    /// <summary>What the player actually paid for it in ATS. Never estimated.</summary>
    public decimal PurchasePrice { get; set; }
    public string Notes { get; set; } = "";
}

// ---------------------------------------------------------------- live status

public class DriverStatus
{
    /// <summary>Where the truck physically is right now.</summary>
    public string LocationCity { get; set; } = "";
    public string LocationState { get; set; } = "";
    /// <summary>Terminal | Shipper | Receiver | TruckStop | RestArea | Road | Other</summary>
    public string LocationKind { get; set; } = "Terminal";
    public string LocationDetail { get; set; } = "";
    /// <summary>In-game clock, ISO 8601 local, e.g. 2026-08-12T14:30.</summary>
    public string GameTime { get; set; } = "";
    public double FuelPct { get; set; } = 100;
    public double TruckDamagePct { get; set; }
    public double TrailerDamagePct { get; set; }
    public double AtsOdometer { get; set; }
    /// <summary>
    /// The bank balance shown in ATS. This IS the company's cash — the game already deducts fuel,
    /// repairs, garages, trucks and AI driver wages from it, so the app reconciles to it rather than
    /// keeping a parallel pot of imaginary money.
    /// </summary>
    public decimal AtsBankBalance { get; set; }
    public string AtsBalanceGameTime { get; set; } = "";
    /// <summary>Duty status: OffDuty | SleeperBerth | OnDuty | Driving</summary>
    public string DutyStatus { get; set; } = "OffDuty";
    public string ActiveTripId { get; set; } = "";
    /// <summary>
    /// Trip number whose close-out produced these readings. Closing a load already reports where the
    /// truck is, its fuel, damage and odometer — so the next dispatch inherits them instead of asking
    /// for the same numbers a second time. The driver confirms, or edits what actually changed.
    /// </summary>
    public string CarriedForwardFrom { get; set; } = "";
    /// <summary>Game time the carried-forward readings were taken.</summary>
    public string CarriedForwardGameTime { get; set; } = "";
    /// <summary>Set once the driver has confirmed or amended the carried-forward readings.</summary>
    public bool Confirmed { get; set; } = true;
    public string Notes { get; set; } = "";
    public string UpdatedUtc { get; set; } = "";
}

/// <summary>
/// Driver-reported HOS clocks. This is the authoritative source per company policy —
/// the app never invents clock values, it only projects forward from what the driver reports.
/// </summary>
public class HosSnapshot
{
    /// <summary>Game time the clocks were read.</summary>
    public string AsOfGameTime { get; set; } = "";
    /// <summary>Hours of driving left today (11-hour rule by default).</summary>
    public double DriveRemaining { get; set; } = 11;
    /// <summary>Hours left in the on-duty window (14-hour rule by default).</summary>
    public double ShiftRemaining { get; set; } = 14;
    /// <summary>Hours of DRIVING left before a 30-minute break is required.
    /// This is NOT available driving time.</summary>
    public double BreakRemaining { get; set; } = 8;
    /// <summary>Hours left on the 70-in-8 cycle.</summary>
    public double CycleRemaining { get; set; } = 70;
    /// <summary>Optional recap hours the driver's HOS display projects returning.</summary>
    public List<RecapDay> Recap { get; set; } = new();
    public string Source { get; set; } = "";
    /// <summary>Trip number whose close-out these clocks were read at, if they came in that way.</summary>
    public string CarriedForwardFrom { get; set; } = "";
    /// <summary>False until the driver confirms the clocks still read this. Stale clocks never plan a load.</summary>
    public bool Confirmed { get; set; } = true;
    public string Notes { get; set; } = "";
    public string UpdatedUtc { get; set; } = "";
}

public class RecapDay
{
    /// <summary>Days from now that these hours come back.</summary>
    public int InDays { get; set; }
    public double Hours { get; set; }
}

// ---------------------------------------------------------------- freight board

public class BoardLoad
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Cargo { get; set; } = "";
    public string Shipper { get; set; } = "";
    public string OriginCity { get; set; } = "";
    public string OriginState { get; set; } = "";
    public string Receiver { get; set; } = "";
    public string DestCity { get; set; } = "";
    public string DestState { get; set; } = "";
    public string TrailerType { get; set; } = "";
    public double LoadedMiles { get; set; }
    public double DeadheadMiles { get; set; }
    public decimal GameRevenue { get; set; }
    public double WeightLbs { get; set; }
    /// <summary>ATS navigation drive-time estimate in hours, if the driver reports it.</summary>
    public double? NavEstimateHours { get; set; }
    /// <summary>Hours until the load is late, from the ATS job listing.</summary>
    public double DeadlineHours { get; set; }
    /// <summary>
    /// Hours until the receiver will actually take the load — the first time in the ATS window range.
    /// Zero means unknown, and unknown plans exactly as it always did.
    /// </summary>
    public double AppointmentOpensHours { get; set; }
    public bool IsUrgent { get; set; }
    public bool IsFragile { get; set; }
    public bool IsHazmat { get; set; }
    /// <summary>
    /// Which ATS HazMat class this load needs — "1", "2", "3", "4", "6" or "8".
    ///
    /// Blank on a hazmat load means the listing did not say, and dispatch falls back to requiring at
    /// least one class rather than guessing which.
    /// </summary>
    public string HazmatClass { get; set; } = "";
    public bool IsOversize { get; set; }
    public bool RequiresTarp { get; set; }
    public int ExtraStops { get; set; }
    /// <summary>
    /// This job was offered right where the truck is standing — the "find other load from this
    /// location" list in ATS, rather than the wider city board.
    ///
    /// Dispatch looks at these first, because that is the order the driver actually meets them: you
    /// come off a dock, you see what is going out from that dock, and only if none of it works do you
    /// go and read the whole board for the city.
    /// </summary>
    public bool AtLocation { get; set; }
    /// <summary>Freight market / company that owns the load in ATS.</summary>
    public string Broker { get; set; } = "";
    public string Notes { get; set; } = "";
    public string AddedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

// ---------------------------------------------------------------- trips

public class Trip
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..10];
    public string Number { get; set; } = "";
    /// <summary>Freight | EmptyMove | Maintenance</summary>
    public string Kind { get; set; } = "Freight";
    /// <summary>Authorized | InTransit | Delivered | Cancelled</summary>
    public string Status { get; set; } = "Authorized";
    /// <summary>OnTime | Late | NotApplicable</summary>
    public string ServiceResult { get; set; } = "NotApplicable";

    public string Cargo { get; set; } = "";
    public string Division { get; set; } = "";
    public string TrailerType { get; set; } = "";
    public string Shipper { get; set; } = "";
    public string OriginCity { get; set; } = "";
    public string OriginState { get; set; } = "";
    public string Receiver { get; set; } = "";
    public string DestCity { get; set; } = "";
    public string DestState { get; set; } = "";
    public double WeightLbs { get; set; }

    public double DispatchedMiles { get; set; }
    public double DeadheadMiles { get; set; }
    public double ActualMiles { get; set; }
    public double StartOdometer { get; set; }
    public double EndOdometer { get; set; }

    /// <summary>
    /// Set once the driver has reported what dispatch asks for after loading. Until then the
    /// instruction keeps asking; after it, the instruction stops. Same rule as the clocks carry-forward.
    /// </summary>
    public bool LoadedReported { get; set; }
    /// <summary>Trailer condition as hooked, which may not be the trailer they had yesterday.</summary>
    public double TrailerDamageAtHook { get; set; }
    /// <summary>Set when the scaled weight differed from what the board said.</summary>
    public string WeightVarianceNote { get; set; } = "";

    public decimal GameRevenue { get; set; }
    /// <summary>Revenue actually booked to the company after the realism factor.</summary>
    public decimal CompanyRevenue { get; set; }

    public string DispatchedGameTime { get; set; } = "";
    public string DueGameTime { get; set; } = "";
    public string DeliveredGameTime { get; set; } = "";
    public double DeadlineHoursAtDispatch { get; set; }

    /// <summary>Total gallons across every stop on the trip. Rolled up from <see cref="FuelStops"/>.</summary>
    public double FuelGallons { get; set; }
    /// <summary>Total fuel spend across every stop. Rolled up from <see cref="FuelStops"/>.</summary>
    public decimal FuelCost { get; set; }
    /// <summary>
    /// Every fuel purchase on this trip. A long run fuels two or three times at different prices, so
    /// each stop is recorded on its own rather than being averaged into one number by hand.
    /// </summary>
    public List<FuelPurchase> FuelStops { get; set; } = new();
    public decimal Tolls { get; set; }
    public decimal RepairCost { get; set; }
    public decimal Fines { get; set; }
    public decimal OtherExpense { get; set; }
    public string OtherExpenseMemo { get; set; } = "";

    public string TruckUnit { get; set; } = "";
    public string TrailerUnit { get; set; } = "";
    public double TruckDamageBefore { get; set; }
    public double TruckDamageAfter { get; set; }
    public double TrailerDamageBefore { get; set; }
    public double TrailerDamageAfter { get; set; }
    public double CargoDamagePct { get; set; }

    public double LoadingHours { get; set; }
    public double UnloadingHours { get; set; }
    /// <summary>
    /// BILLABLE detention hours — already net of the free window, worked out per stop from the
    /// Begin/End pairs in the trip log. Pay multiplies this directly; do not subtract free time again.
    /// </summary>
    public double DetentionHours { get; set; }
    public double LayoverDays { get; set; }
    public double BreakdownDays { get; set; }
    public int ExtraStops { get; set; }
    public int TarpsUsed { get; set; }
    public bool IsHazmat { get; set; }
    /// <summary>The ATS HazMat class this load needed. See <see cref="BoardLoad.HazmatClass"/>.</summary>
    public string HazmatClass { get; set; } = "";

    /// <summary>When the receiver opens, as a game time. Empty when the window did not say.</summary>
    public string AppointmentOpensGameTime { get; set; } = "";

    /// <summary>
    /// Set when the delivery window does not match the run and has not been confirmed.
    ///
    /// The window is the appointment this load is judged against, so one that came from a bad read is
    /// worth questioning before it decides whether the driver was late. The app never rewrites it on
    /// its own — it cannot know what the board said — it asks.
    /// </summary>
    public string WindowWarning { get; set; } = "";
    public bool IsOversize { get; set; }

    public PayBreakdown Pay { get; set; } = new();
    /// <summary>Settlement number this trip was paid on; empty = unsettled.</summary>
    public string SettlementNumber { get; set; } = "";

    /// <summary>
    /// Authorized to get the driver home rather than on its merits. Recorded at dispatch so the
    /// close-out can tell them to report to the yard and take their home time.
    /// </summary>
    public bool IsHomeRun { get; set; }
    /// <summary>Feasibility analysis snapshot captured at authorization, for later audit.</summary>
    public FeasibilityResult? FeasibilityAtDispatch { get; set; }
    public string AuthorizationRationale { get; set; } = "";
    public string CancelReason { get; set; } = "";
    /// <summary>Driver | Dispatcher | Unavoidable | Mechanical | GameLimitation | None</summary>
    public string FaultAttribution { get; set; } = "None";
    public string SafetyNotes { get; set; } = "";
    public string Notes { get; set; } = "";
    public List<TripEvent> Events { get; set; } = new();
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");
    public string ClosedUtc { get; set; } = "";
}

public class TripEvent
{
    public string GameTime { get; set; } = "";
    /// <summary>
    /// BeginLoad | EndLoad | BeginUnload | EndUnload | Fuel | Break | Rest | Scale | Delay |
    /// Breakdown | Note.
    ///
    /// The load and unload events are paired deliberately: their timestamps are what loading,
    /// unloading and detention are computed from, so the driver never hand-calculates time that the
    /// log already knows. "Loaded", "Departed" and "Arrived" are retained only so older trips still
    /// read correctly — they are not offered for new entries.
    /// </summary>
    public string Kind { get; set; } = "Note";
    public string Detail { get; set; } = "";
    /// <summary>City the event happened in, when it is worth recording (fuel stops, breakdowns).</summary>
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    /// <summary>For a Fuel event: what went in the tanks. Becomes a <see cref="FuelPurchase"/> on the trip.</summary>
    public double Gallons { get; set; }
    public decimal PricePerGal { get; set; }
    public decimal Cost { get; set; }
    public string LoggedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

/// <summary>
/// One fuel purchase. Recorded when it happens rather than reconstructed at the end of the trip, so
/// a run that fuels three times at three prices produces three lines and an honest blended cost.
/// </summary>
public class FuelPurchase
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string GameTime { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string Vendor { get; set; } = "";
    public double Gallons { get; set; }
    public decimal PricePerGal { get; set; }
    /// <summary>Total paid. Filled from gallons x price when the driver reports it that way.</summary>
    public decimal Cost { get; set; }
    /// <summary>Fuelled at one of our own yards, at the yard's contract price.</summary>
    public bool AtCompanyYard { get; set; }
    public string Notes { get; set; } = "";

    /// <summary>Whichever of cost / gallons x price the driver actually gave us.</summary>
    public decimal Total() => Cost > 0 ? Cost : Math.Round((decimal)Gallons * PricePerGal, 2);
}

public class PayBreakdown
{
    public double LoadedMiles { get; set; }
    public double DeadheadMiles { get; set; }
    public decimal LinehaulPay { get; set; }
    public decimal DeadheadPay { get; set; }
    public decimal DivisionPremium { get; set; }
    public decimal StopPay { get; set; }
    public decimal TarpPay { get; set; }
    public decimal DetentionPay { get; set; }
    public decimal LayoverPay { get; set; }
    public decimal BreakdownPay { get; set; }
    public decimal Chargebacks { get; set; }
    public string ChargebackMemo { get; set; } = "";
    public decimal Total { get; set; }
    public List<string> Lines { get; set; } = new();
}

// ---------------------------------------------------------------- money

public class Account
{
    /// <summary>Stable key: operating | maintenance_reserve | payroll_reserve | equipment_note</summary>
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>Asset | Liability</summary>
    public string Kind { get; set; } = "Asset";
    public decimal OpeningBalance { get; set; }
    public string Notes { get; set; } = "";
}

public class LedgerEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..10];
    public string AccountKey { get; set; } = "";
    /// <summary>Positive increases the account, negative decreases it.</summary>
    public decimal Amount { get; set; }
    /// <summary>FreightRevenue | Fuel | Repairs | Maintenance | Tolls | Payroll | Fines |
    /// Cancellation | Equipment | Transfer | Insurance | Overhead | Adjustment | Opening</summary>
    public string Category { get; set; } = "";
    public string Memo { get; set; } = "";
    public string TripNumber { get; set; } = "";
    public string GameTime { get; set; } = "";
    public string PostedUtc { get; set; } = DateTime.UtcNow.ToString("o");
    public bool IsAdjustment { get; set; }
}

public class Settlement
{
    public string Number { get; set; } = "";
    public string PeriodStartGame { get; set; } = "";
    public string PeriodEndGame { get; set; } = "";
    public List<string> TripNumbers { get; set; } = new();
    public double LoadedMiles { get; set; }
    public double DeadheadMiles { get; set; }
    public decimal LinehaulPay { get; set; }
    public decimal DeadheadPay { get; set; }
    public decimal DivisionPremium { get; set; }
    public decimal Accessorials { get; set; }
    public decimal OnTimeBonus { get; set; }
    public decimal SafetyBonus { get; set; }
    public decimal GuaranteeMakeup { get; set; }
    public decimal Chargebacks { get; set; }
    public decimal Gross { get; set; }
    public double OnTimePct { get; set; }
    /// <summary>Game days this settlement actually covered.</summary>
    public double PeriodDays { get; set; }
    /// <summary>Fraction of a full pay period covered — what the flat safety bonus is scaled by.</summary>
    public double SafetyBonusShare { get; set; } = 1;
    public string Notes { get; set; } = "";
    public List<string> Lines { get; set; } = new();
    /// <summary>
    /// Gross-to-net breakdown. Null on settlements issued before pay stubs existed — those still
    /// render, they simply show gross only.
    /// </summary>
    public PayStub? Stub { get; set; }
    /// <summary>Payday | JobChange — why this settlement ran.</summary>
    public string Trigger { get; set; } = "Payday";
    public string IssuedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

/// <summary>
/// What actually reaches the driver's bank. A game approximation of real withholding — enough to make
/// the gap between gross and net feel real, not enough to file a return from.
/// </summary>
public class PayStub
{
    public string SettlementNumber { get; set; } = "";
    public decimal Gross { get; set; }
    /// <summary>Pre-tax medical. Comes off before federal, state and FICA.</summary>
    public decimal Medical { get; set; }
    public decimal TaxableWages { get; set; }

    public decimal Federal { get; set; }
    public decimal SocialSecurity { get; set; }
    public decimal Medicare { get; set; }
    public decimal StateTax { get; set; }
    public string StateCode { get; set; } = "";
    public decimal StateRate { get; set; }
    /// <summary>False for the nine states with no wage income tax — shown as a zero line, not hidden.</summary>
    public bool StateHasTax { get; set; }

    public decimal TotalTaxes { get; set; }
    public decimal Net { get; set; }
    public decimal YtdGross { get; set; }
    /// <summary>Periods the pay was annualised over to find the federal rate.</summary>
    public int PeriodsPerYear { get; set; } = 52;
}

// ---------------------------------------------------------------- ops records

public class WorkOrder
{
    public string Number { get; set; } = "";
    public string Unit { get; set; } = "";
    /// <summary>Truck | Trailer</summary>
    public string UnitKind { get; set; } = "Truck";
    /// <summary>Preventive | Repair | Damage | Inspection | Tires | Recall</summary>
    public string Kind { get; set; } = "Repair";
    public string Description { get; set; } = "";
    public string Vendor { get; set; } = "";
    public string LocationCity { get; set; } = "";
    public string LocationState { get; set; } = "";
    public decimal Cost { get; set; }
    /// <summary>
    /// What the repair was quoted at when the order was raised. An open work order has no actual cost
    /// yet — nothing has been paid — but the figure the driver was quoted should not be thrown away.
    /// It pre-fills the cost when the order is closed.
    /// </summary>
    public decimal EstimatedCost { get; set; }
    /// <summary>Company | Driver — driver chargebacks only for abuse/unauthorized mods.</summary>
    public string PaidBy { get; set; } = "Company";
    public double DamageBefore { get; set; }
    public double DamageAfter { get; set; }
    public double OdometerAtService { get; set; }
    public string GameTime { get; set; } = "";
    /// <summary>Open | Completed | Deferred</summary>
    public string Status { get; set; } = "Completed";
    public string Notes { get; set; } = "";
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

public class Incident
{
    public string Number { get; set; } = "";
    public string GameTime { get; set; } = "";
    public string TripNumber { get; set; } = "";
    /// <summary>Collision | Late | Damage | Citation | Fatigue | Fuel | Overweight | Other</summary>
    public string Kind { get; set; } = "Other";
    public string Description { get; set; } = "";
    /// <summary>Driver | Dispatcher | Unavoidable | Mechanical | GameLimitation</summary>
    public string FaultAttribution { get; set; } = "Unavoidable";
    /// <summary>Minor | Moderate | Serious | Major</summary>
    public string Severity { get; set; } = "Minor";
    public bool Preventable { get; set; }
    public decimal Cost { get; set; }
    public string LocationCity { get; set; } = "";
    public string LocationState { get; set; } = "";
    public string DisciplineNumber { get; set; } = "";
    /// <summary>
    /// Clean loads that must pass before this stops counting against hiring. Scaled by severity —
    /// a scraped mirror is not a rollover. It stays on the record for ever either way; ageing off
    /// only stops it barring the driver from carriers.
    ///
    /// Without this a single preventable on load one permanently locks a driver out of every carrier
    /// that demands a spotless record, which is most of the good ones.
    /// </summary>
    /// <remarks>0 means "not set yet" — <c>RecordIncident</c> fills it in from the severity. A
    /// non-zero default here would silently override that scaling for every incident.</remarks>
    public int AgesOffAfterLoads { get; set; }
    /// <summary>Loads delivered when this happened, so "clean loads since" can be measured.</summary>
    public int LoadCountAtIncident { get; set; }
    /// <summary>Set when Safety has cleared it early — remedial training, review, or re-attribution.</summary>
    public string ForgivenGameTime { get; set; } = "";
    public string ForgivenReason { get; set; } = "";
    public string Notes { get; set; } = "";
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

public class DisciplineAction
{
    public string Number { get; set; } = "";
    /// <summary>Coaching | WrittenWarning | FinalWarning | Suspension | Termination | Commendation</summary>
    public string Level { get; set; } = "Coaching";
    public string GameTime { get; set; } = "";
    public string IncidentNumber { get; set; } = "";
    public string Reason { get; set; } = "";
    public string CorrectiveAction { get; set; } = "";
    public string IssuedBy { get; set; } = "Safety Department";
    public bool DriverAcknowledged { get; set; }
    /// <summary>Active discipline can age off the record after this many completed loads.</summary>
    public int ExpiresAfterLoads { get; set; } = 20;
    public int LoadCountAtIssue { get; set; }
    public string Notes { get; set; } = "";
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

/// <summary>
/// An AI driver hired in ATS and running one of the company's units. The app never invents their
/// numbers — the player reads revenue, miles and damage off the game and files a fleet report.
/// </summary>
public class HiredDriver
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name { get; set; } = "";
    public string HiredGameDate { get; set; } = "";
    /// <summary>Active | OnLeave | Resigned | Terminated. Only Active counts as running a unit.</summary>
    public string Status { get; set; } = "Active";
    public string AssignedTruckUnit { get; set; } = "";
    public string AssignedTrailerUnit { get; set; } = "";
    public string HomeTerminalId { get; set; } = "";
    /// <summary>Trainee | Competent | Experienced | Veteran — mirrors the ATS driver skill tiers.</summary>
    public string Skill { get; set; } = "Competent";

    /// <summary>
    /// Driver level as ATS shows it. Open-ended — they keep climbing as they haul.
    ///
    /// This is the number that makes a driver worth poaching. A developed driver has options, and the
    /// place they are most likely to use them is a company that cannot match what those options pay.
    /// </summary>
    public int Level { get; set; }

    /// <summary>Rating as ATS shows it: 0.0 to 10.0, in tenths.</summary>
    public double Rating { get; set; }

    /// <summary>
    /// On notice after a bad period. A carrier does not sack someone over one weak fortnight — it says
    /// what has to change and looks again next report. Empty means not on probation.
    /// </summary>
    public string ProbationSince { get; set; } = "";
    /// <summary>What put them on probation, in the words the report used.</summary>
    public string ProbationReason { get; set; } = "";
    /// <summary>The figure and number they have to clear to come off it.</summary>
    public string ProbationTarget { get; set; } = "";
    /// <summary>How many times they have been put on probation. A repeat is a different case to a first.</summary>
    public int ProbationCount { get; set; }
    /// <summary>Set when they cleared probation, so a recovery is on the record as one.</summary>
    public string LastClearedProbationGameTime { get; set; } = "";
    public bool OnProbation => !string.IsNullOrWhiteSpace(ProbationSince);
    /// <summary>Share of the revenue they generate that goes to their wages.</summary>
    public double WageShare { get; set; } = 0.30;
    public double LifetimeMiles { get; set; }
    public decimal LifetimeRevenue { get; set; }
    public decimal LifetimeWages { get; set; }
    public int ReportsFiled { get; set; }
    /// <summary>
    /// What each reporting period produced, so a run of bad numbers can be judged over time rather
    /// than on one bad fortnight. A carrier does not sack a driver for a single slow period.
    /// </summary>
    public List<DriverPeriodResult> Periods { get; set; } = new();
    /// <summary>Resigned | Terminated — set when they leave, alongside <see cref="Status"/>.</summary>
    public string SeparationReason { get; set; } = "";
    public string SeparatedGameTime { get; set; } = "";
    public string Notes { get; set; } = "";
}

/// <summary>One reporting period's production for a hired driver.</summary>
public class DriverPeriodResult
{
    public string ReportNumber { get; set; } = "";
    public string PeriodEndGame { get; set; } = "";
    public decimal Revenue { get; set; }
    public double Miles { get; set; }
    public decimal Wages { get; set; }
    public decimal Repairs { get; set; }
    [Obsolete("ATS shows no damage percentage for an AI-driven unit. Kept so older careers still load.")]
    public double DamageAfter { get; set; }
    /// <summary>Revenue per mile, derived from what was booked. See also <see cref="PerMile"/>.</summary>
    public decimal RatePerMile { get; set; }

    // ---- read straight off the game, which is what makes them trustworthy

    /// <summary>Driver level at the end of the period.</summary>
    public int Level { get; set; }
    /// <summary>Rating at the end of the period, 0.0-10.0.</summary>
    public double Rating { get; set; }
    /// <summary>Average income per mile, as ATS reports it for this driver.</summary>
    public decimal PerMile { get; set; }
    /// <summary>Average income per day, as ATS reports it. The productivity figure.</summary>
    public decimal PerDay { get; set; }

    /// <summary>
    /// True when the player gave the figures the game shows. A period filed before the app collected
    /// them is incomplete, not a period where the driver earned nothing — and the difference decides
    /// whether it can be used as evidence against them.
    /// </summary>
    public bool GameFiguresReported { get; set; }
}

/// <summary>
/// A driver leaving the company, resolved on the fleet report after the period's numbers are in.
/// Terminations are recommended and confirmed; resignations simply happen.
/// </summary>
public class PersonnelChange
{
    public string DriverId { get; set; } = "";
    public string DriverName { get; set; } = "";
    /// <summary>Terminated | Resigned</summary>
    public string Kind { get; set; } = "Resigned";
    /// <summary>Recommended but not yet actioned — the player confirms a termination.</summary>
    public bool Pending { get; set; }
    public string Headline { get; set; } = "";
    public List<string> Evidence { get; set; } = new();
    public string TruckUnit { get; set; } = "";
    public string TrailerUnit { get; set; } = "";
}

/// <summary>A unit past its useful life, with the numbers behind the call.</summary>
public class RetirementRecommendation
{
    public string Unit { get; set; } = "";
    public string UnitKind { get; set; } = "Truck";
    public string Headline { get; set; } = "";
    public List<string> Evidence { get; set; } = new();
    public double ServiceMiles { get; set; }
    public decimal RepairSpend { get; set; }
    public double DamagePct { get; set; }
    public string AssignedTo { get; set; } = "";
    public bool IsPlayerUnit { get; set; }
}

/// <summary>A period's worth of hired-driver production, as read off the game and posted to the books.</summary>
public class FleetReport
{
    public string Number { get; set; } = "";
    public string PeriodStartGame { get; set; } = "";
    public string PeriodEndGame { get; set; } = "";
    public List<FleetReportLine> Lines { get; set; } = new();
    public decimal TotalRevenue { get; set; }
    public double TotalMiles { get; set; }
    public decimal TotalWages { get; set; }
    public decimal TotalRepairs { get; set; }
    public decimal NetContribution { get; set; }
    public string Notes { get; set; } = "";
    public List<string> Findings { get; set; } = new();
    /// <summary>Units the report put into the shop queue, with the work order raised for each.</summary>
    public List<RepairFlag> RepairsNeeded { get; set; } = new();
    /// <summary>Drivers who left, or are recommended for termination, on this period's numbers.</summary>
    public List<PersonnelChange> Personnel { get; set; } = new();
    /// <summary>Units the trade cycle says it is time to replace.</summary>
    public List<RetirementRecommendation> Retirements { get; set; } = new();
    public string FiledUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

/// <summary>
/// The company asking for another trailer at a yard.
///
/// The app cannot buy anything in ATS, so this is a request with a reason attached: which yard, what
/// type, and why. The player buys it in game if they want it and reports what they paid — nothing is
/// booked against a price the app made up.
/// </summary>
/// <summary>
/// A driver asking to go home.
///
/// Not answered on the spot — a dispatcher does not drop what they are doing to answer a text
/// mid-lane. It is answered when the next load closes out, which also stops the request being a free
/// "cancel my current load" button.
/// </summary>
/// <summary>
/// One fortnightly look at a probationary driver, written when they report in at the yard.
///
/// Kept on the file after probation ends. It is the driver's record of how they started, and a fail is
/// not discipline — it never touches the safety record, it means the probation carries on.
/// </summary>
public class ProbationReview
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    public int ReviewNumber { get; set; }
    public string GameTime { get; set; } = "";
    public string PeriodStartGameTime { get; set; } = "";
    public double DaysCovered { get; set; }

    public int LoadsDelivered { get; set; }
    public double OnTimePct { get; set; }
    public int PreventableFaults { get; set; }

    /// <summary>Pass | Fail</summary>
    public string Verdict { get; set; } = "Fail";
    public string Summary { get; set; } = "";
    /// <summary>What went well, in the words the review used.</summary>
    public List<string> Strengths { get; set; } = new();
    /// <summary>What did not, and what has to be different.</summary>
    public List<string> Concerns { get; set; } = new();
    /// <summary>Where they stand afterwards, and when they are back.</summary>
    public string NextStep { get; set; } = "";
    /// <summary>Passes standing after this one.</summary>
    public int PassesInARow { get; set; }
    /// <summary>This review is the one that ended probation.</summary>
    public bool ClearedProbation { get; set; }
}

public class HomeTimeRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    public string RequestedGameTime { get; set; } = "";
    /// <summary>Why they are asking. Optional, and it does not change the answer.</summary>
    public string Reason { get; set; } = "";
    /// <summary>Days off the yard when they asked. The whole argument, recorded.</summary>
    public double DaysOutAtRequest { get; set; }
    public double DaysOutAtAnswer { get; set; }
    /// <summary>Open | Granted | Refused</summary>
    public string Status { get; set; } = "Open";
    public string Answer { get; set; } = "";
    public string AnsweredGameTime { get; set; } = "";
}

/// <summary>
/// A driver asking to be re-rigged onto a different trailer type. Off probation only, and only for
/// something the company actually has at their yard.
/// </summary>
public class TrailerTypeRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    public string RequestedType { get; set; } = "";
    public string RequestedGameTime { get; set; } = "";
    /// <summary>Open | Granted | Refused</summary>
    public string Status { get; set; } = "Open";
    public string Answer { get; set; } = "";
    public string AnsweredGameTime { get; set; } = "";
    /// <summary>The swap order raised when it is granted, so the two can be followed together.</summary>
    public string EquipmentOrderNumber { get; set; } = "";
}

public class TrailerRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Number { get; set; } = "";
    /// <summary>Add | Replace — a new box for the yard, or one swapped out.</summary>
    public string Kind { get; set; } = "Add";
    public string TerminalId { get; set; } = "";
    public string TerminalLabel { get; set; } = "";
    public string TrailerType { get; set; } = "";
    /// <summary>Which tanker, flatbed variant and so on — "buy a tanker" is not an instruction.</summary>
    public string Subtype { get; set; } = "";
    /// <summary>The unit being replaced, when this is a Replace.</summary>
    public string ReplacingUnit { get; set; } = "";
    public string Reason { get; set; } = "";
    public string Instruction { get; set; } = "";
    public string RaisedGameTime { get; set; } = "";
    /// <summary>Open | Bought | Declined</summary>
    public string Status { get; set; } = "Open";
    /// <summary>What the player actually paid, once they confirm. Never estimated.</summary>
    public decimal PaidPrice { get; set; }
    public string ResolvedGameTime { get; set; } = "";
    /// <summary>Set when the company cannot currently afford it, so the ask is honest about that.</summary>
    public bool Unaffordable { get; set; }
}

/// <summary>A unit the fleet report sent for repair.</summary>
public class RepairFlag
{
    public string Unit { get; set; } = "";
    public string UnitKind { get; set; } = "Truck";
    public string DriverName { get; set; } = "";
    public double DamagePct { get; set; }
    public string Directive { get; set; } = "";
    public bool OutOfService { get; set; }
    public string WorkOrderNumber { get; set; } = "";
}

public class FleetReportLine
{
    public string DriverId { get; set; } = "";
    public string DriverName { get; set; } = "";
    public string TruckUnit { get; set; } = "";
    public string TrailerUnit { get; set; } = "";
    public decimal Revenue { get; set; }
    public double Miles { get; set; }

    // ---- the driver, as ATS shows them
    /// <summary>Driver level. Open-ended.</summary>
    public int Level { get; set; }
    /// <summary>Driver rating, 0.0-10.0 in tenths.</summary>
    public double Rating { get; set; }
    /// <summary>Average income per mile, off the game.</summary>
    public decimal PerMile { get; set; }
    /// <summary>Average income per day, off the game. This is the productivity number.</summary>
    public decimal PerDay { get; set; }

    // ---- the equipment, as ATS shows it for a unit we are not sitting in
    /// <summary>Tractor condition in stars, five down to one. Zero means not reported.</summary>
    public double TruckStars { get; set; }
    /// <summary>Tractor odometer read off the game. Zero means not reported.</summary>
    public double TruckOdometer { get; set; }
    /// <summary>Trailer condition in stars. Trailers have no odometer, so there is nothing else to read.</summary>
    public double TrailerStars { get; set; }

    [Obsolete("ATS shows no damage percentage for an AI-driven tractor. Kept so older careers still load.")]
    public double DamagePctAfter { get; set; }
    [Obsolete("ATS shows no damage percentage for an AI-driven trailer. Kept so older careers still load.")]
    public double TrailerDamagePctAfter { get; set; }
    public decimal Wages { get; set; }
    public decimal Repairs { get; set; }
    public string Notes { get; set; } = "";
}

/// <summary>
/// An instruction to change equipment: report to a yard and swap units. Issued rather than applied
/// silently, because only the player can actually do it in ATS — the app records the change once
/// they confirm it happened.
/// </summary>
public class EquipmentOrder
{
    public string Number { get; set; } = "";
    /// <summary>Upgrade | Downgrade | TrailerSwap | ShopVisit</summary>
    public string Kind { get; set; } = "Upgrade";
    public string IssuedGameTime { get; set; } = "";
    public string Reason { get; set; } = "";
    public string Instruction { get; set; } = "";
    public string FromTruckUnit { get; set; } = "";
    public string ToTruckUnit { get; set; } = "";
    public string FromTrailerUnit { get; set; } = "";
    public string ToTrailerUnit { get; set; } = "";
    public string TerminalId { get; set; } = "";
    public string TerminalLabel { get; set; } = "";
    /// <summary>Open | Completed | Declined | Expired</summary>
    public string Status { get; set; } = "Open";
    public string CompletedGameTime { get; set; } = "";
    /// <summary>For a downgrade: clean loads needed before the good unit comes back.</summary>
    public int RestoreAfterLoads { get; set; }
    public int LoadCountAtIssue { get; set; }
    /// <summary>
    /// Game time the equipment is actually available. Set when the trailer we want is out with a
    /// hired driver — you cannot hook to a trailer that is three states away under someone else, so
    /// the driver waits at the yard until it comes back. That wait is spent at home.
    /// </summary>
    public string AvailableFromGameTime { get; set; } = "";
    /// <summary>Hired driver currently on the trailer, if we are waiting for one.</summary>
    public string HeldByDriverName { get; set; } = "";
    /// <summary>The company has no trailer of this type — the player has to buy one in ATS.</summary>
    public bool MustPurchase { get; set; }
    public string Notes { get; set; } = "";
    public string CreatedUtc { get; set; } = DateTime.UtcNow.ToString("o");
}

public class LogEvent
{
    public string Utc { get; set; } = DateTime.UtcNow.ToString("o");
    public string GameTime { get; set; } = "";
    /// <summary>dispatch | trip | pay | ledger | safety | maintenance | career | system</summary>
    public string Channel { get; set; } = "system";
    public string Message { get; set; } = "";
    public string Ref { get; set; } = "";
}

// ---------------------------------------------------------------- settings

public class AppSettings
{
    // --- game environment
    public string AtsVersion { get; set; } = "";
    public List<string> Mods { get; set; } = new();
    public string HosModName { get; set; } = "";
    public bool UsesHosMod { get; set; }
    public bool UsesEconomyMod { get; set; }
    public List<string> MapMods { get; set; } = new();

    // --- HOS rule set (editable; the driver's mod always wins)
    public HosRules Hos { get; set; } = new();

    // --- operational assumptions
    public int GovernedMph { get; set; } = 65;
    /// <summary>Fraction of governed speed actually averaged over a leg (traffic, ramps, terrain).</summary>
    public double SpeedFactor { get; set; } = 0.86;
    /// <summary>Minimum HOS slack the company requires between projected arrival and the deadline.</summary>
    public double SafetyBufferHours { get; set; } = 2.0;
    /// <summary>Time reserved at the end of a shift to find legal parking.</summary>
    public double ParkingBufferHours { get; set; } = 0.75;

    /// <summary>
    /// How much 14-hour window a load should still have in hand once the driver is empty at the
    /// receiver. Below this the load is flagged before it is accepted: if the dock holds them even a
    /// little, the window closes while they are on the property and they cannot legally move the truck.
    ///
    /// Deliberately separate from <see cref="SafetyBufferHours"/>. That one is about missing an
    /// appointment; this one is about being stranded after making it. Different risks, different number.
    /// </summary>
    public double StrandedMarginHours { get; set; } = 1.5;

    public double PreTripHours { get; set; } = 0.25;
    public double PostTripHours { get; set; } = 0.25;
    /// <summary>Fallback only. Real dock time is learned per trailer type — see <see cref="FacilityTimes"/>.</summary>
    public double DefaultLoadingHours { get; set; } = 1.0;
    public double DefaultUnloadingHours { get; set; } = 1.0;
    /// <summary>
    /// Measured dock time per trailer type. A reefer takes three or four hours to load and a flatbed
    /// can be one; planning both at the same figure made every reefer projection optimistic enough to
    /// authorize loads that could not be run. These converge on the truth as loads are delivered.
    /// </summary>
    public List<FacilityTimeSample> FacilityTimes { get; set; } = new();
    public double FuelStopHours { get; set; } = 0.35;
    /// <summary>Miles of range planned between fuel stops.</summary>
    public double FuelRangeMiles { get; set; } = 900;
    public decimal FuelPricePerGal { get; set; } = 4.05m;

    // --- economics / realism bridges
    /// <summary>ATS payouts are inflated vs real linehaul. Company books revenue x this factor.
    /// Economy mods make ATS revenue realistic, so this defaults to 1.0 when one is in use.</summary>
    public double RevenueFactor { get; set; } = 1.0;
    /// <summary>Multiplier applied to ATS miles when computing DRIVER PAY only.
    /// ATS runs a scaled map; raise this if scaled miles make settlements feel too small.</summary>
    public double PayMileMultiplier { get; set; } = 1.0;
    /// <summary>
    /// One cash account, reconciled to the ATS bank balance. Reserves become earmarks computed
    /// against that single balance rather than separate pots — the game only has one bank account,
    /// so pretending otherwise double-counts the money.
    /// </summary>
    public bool SingleCashAccount { get; set; } = true;
    /// <summary>Share of booked revenue earmarked for maintenance.</summary>
    public double MaintenanceReservePct { get; set; } = 0.08;
    /// <summary>Share of booked revenue earmarked for payroll.</summary>
    public double PayrollReservePct { get; set; } = 0.30;
    /// <summary>
    /// Fixed overhead charged per completed load (insurance, admin, plates, ELD). Kept modest
    /// because ATS distances are scaled — a real-world per-load figure spread over a short in-game
    /// haul swamps the genuine per-mile costs.
    /// </summary>
    public decimal OverheadPerLoad { get; set; } = 20m;
    /// <summary>Margin the company wants over break-even. 1.25 = a 25% markup on cost.</summary>
    public double MarginGoal { get; set; } = 1.25;
    /// <summary>Penalty the company eats when a booked load is cancelled.</summary>
    public decimal CancellationPenalty { get; set; } = 350m;

    // --- maintenance thresholds (damage %)
    public MaintenanceThresholds Maintenance { get; set; } = new();

    // --- dispatch scoring weights
    public ScoringWeights Scoring { get; set; } = new();

    // --- trip numbering
    public string FreightPrefix { get; set; } = "";
    public string EmptyMovePrefix { get; set; } = "MT";
    public string MaintenancePrefix { get; set; } = "MX";
    public string CancelPrefix { get; set; } = "CX";
    public int NumberPadding { get; set; } = 3;

    // --- settlement
    public int SettlementPeriodDays { get; set; } = 7;
    /// <summary>
    /// The driver's share of the medical premium, per pay period. Pre-tax, so it comes off before
    /// federal, state and FICA. Roughly a typical single-coverage employee contribution.
    /// </summary>
    public decimal HealthPremiumPerPeriod { get; set; } = 60m;
    /// <summary>
    /// Game days between fleet reports. The hired fleet keeps running whether or not the player is
    /// looking at it, so operations asks for its numbers on a cycle rather than waiting to be told.
    /// </summary>
    public int FleetReportIntervalDays { get; set; } = 15;

    /// <summary>
    /// "Real" uses actual US carriers — real names, headquarters and freight specialities, with
    /// roleplay pay and standards. "Fictional" uses invented carriers instead.
    /// </summary>
    public string CarrierRoster { get; set; } = "Real";

    // --- optional AI hookup (blank = fully offline; nothing is sent anywhere)
    public string AnthropicApiKey { get; set; } = "";
    public string AnthropicModel { get; set; } = "claude-sonnet-5";
    public bool AiEnabled { get; set; }

    public string Notes { get; set; } = "";
}

public class HosRules
{
    public double DriveLimit { get; set; } = 11;
    public double ShiftLimit { get; set; } = 14;
    /// <summary>
    /// Whether the 30-minute break is enforced at all. ATS runs on compressed time, which makes a
    /// short mandatory break awkward to actually sit, so plenty of drivers play without it. Turn it
    /// off and the planner stops inserting breaks and stops tracking the break clock entirely.
    /// </summary>
    public bool RequireBreak { get; set; } = true;
    /// <summary>Cumulative driving hours allowed before a break is required.</summary>
    public double DrivingBeforeBreak { get; set; } = 8;
    public double BreakLength { get; set; } = 0.5;
    public double CycleLimit { get; set; } = 70;
    public int CycleDays { get; set; } = 8;
    /// <summary>Off-duty hours that reset the drive and shift clocks.</summary>
    public double OffDutyReset { get; set; } = 10;
    /// <summary>Off-duty hours that restart the cycle. Report your mod's value if it differs.</summary>
    public double CycleRestartHours { get; set; } = 34;
    public bool SleeperSplitAllowed { get; set; } = true;
    /// <summary>Does the 30-minute break consume the 14-hour window? True under real FMCSA rules.</summary>
    public bool BreakConsumesShift { get; set; } = true;
    /// <summary>Does off-duty time other than a full reset extend the 14-hour window? False under real rules.</summary>
    public bool OffDutyExtendsShift { get; set; }
    public string Notes { get; set; } = "";
}

/// <summary>What a dock actually costs in hours, for one trailer type.</summary>
public class FacilityTimeSample
{
    public string TrailerType { get; set; } = "";
    public double LoadingHours { get; set; }
    public double UnloadingHours { get; set; }
    /// <summary>Measured close-outs behind these figures. 0 = still the starting estimate.</summary>
    public int Samples { get; set; }
    /// <summary>The driver set these by hand, so they stop moving.</summary>
    public bool Manual { get; set; }
    public string LastGameTime { get; set; } = "";
}

public class MaintenanceThresholds
{
    /// <summary>Below this: monitor only.</summary>
    public double MonitorPct { get; set; } = 5;
    /// <summary>At or above this: report to shop after delivery.</summary>
    public double ReportPct { get; set; } = 5;
    /// <summary>At or above this: mandatory maintenance review before next dispatch.</summary>
    public double MandatoryReviewPct { get; set; } = 15;
    /// <summary>At or above this: out of service, stop and contact operations.</summary>
    public double OutOfServicePct { get; set; } = 30;

    // (dock-margin setting lives on AppSettings — see StrandedMarginHours)
    public double PreventiveIntervalMiles { get; set; } = 25000;

    /// <summary>
    /// At or above this on tractor or trailer, no new loads are issued — the driver goes to a shop.
    /// A default, not a law: some players want a harder line and some want none at all.
    /// </summary>
    public double StopDispatchPct { get; set; } = 10;

    /// <summary>
    /// Write-off line for a <b>fresh</b> tractor. The line a given unit is actually held to falls with
    /// its odometer — see <see cref="WriteOffLifeMiles"/>. Nobody scraps a truck with 60,000 miles on
    /// it over damage they would happily fix; nobody puts that money into one with 600,000.
    /// </summary>
    public double TotalLossPct { get; set; } = 40;

    /// <summary>
    /// Stars at or below which a hired driver's tractor should be sold and replaced. Five is a new
    /// unit; three is worn enough that the company would rather put a fresh one under the driver.
    /// </summary>
    public double TruckReplaceStars { get; set; } = 3;

    /// <summary>Stars at or below which a trailer should be replaced.</summary>
    public double TrailerReplaceStars { get; set; } = 3;

    /// <summary>
    /// Years before a trailer counts as old. Age alone is not a reason to replace one — an old box
    /// still earning is fine — but old and unproductive together is.
    /// </summary>
    public double TrailerOldYears { get; set; } = 8;

    /// <summary>The mileage at which a tractor is treated as fully worn for write-off purposes.</summary>
    public double WriteOffLifeMiles { get; set; } = 800_000;

    /// <summary>
    /// How much of the write-off line a full life of miles eats. At 0.6, a worn-out tractor is written
    /// off at 40% of the fresh threshold — around 16% damage against 40% for a new one.
    /// </summary>
    public double WriteOffWearFactor { get; set; } = 0.6;

    /// <summary>The lowest the line can fall, however many miles are on it. A truck is still a truck.</summary>
    public double WriteOffFloorPct { get; set; } = 15;

    /// <summary>
    /// Under this much damage, running home for the repair is preferred to the nearest shop — labour
    /// is cheaper at a company yard and the truck ends up where it needs to be. Above it the unit is
    /// too far gone to gamble another day's driving on.
    /// </summary>
    public double RunHomeMaxDamagePct { get; set; } = 20;

    /// <summary>How far home can be and still be worth running to instead of the nearest shop.</summary>
    public double RunHomeMaxHours { get; set; } = 11;

    /// <summary>
    /// Shop time per point of tractor damage — forty minutes. A tractor is an engine, a cab, air
    /// systems and electronics, and real body work on one is a day in the bay, not an afternoon. This
    /// has to be long enough that routing a truck home for it is a decision rather than a detour.
    /// </summary>
    public double RepairHoursPerPoint { get; set; } = 2.0 / 3.0;

    /// <summary>
    /// Trailer work runs at a fraction of the tractor rate — a box on wheels has far less to take
    /// apart, and a shop turns one round in a morning.
    /// </summary>
    public double TrailerRepairFactor { get; set; } = 0.35;

    /// <summary>A company shop with our own people in it turns work round faster than a dealer.</summary>
    public double CompanyShopFactor { get; set; } = 0.7;

    /// <summary>Insurance deductible on a written-off unit. Doubled when the damage was driver-fault.</summary>
    public decimal TotalLossDeductible { get; set; } = 2500;

    /// <summary>Share of the unit's value insurance settles at. Nobody is made whole on a write-off.</summary>
    public double TotalLossPayoutFactor { get; set; } = 0.8;
}

public class ScoringWeights
{
    public double AllInRpm { get; set; } = 1.0;
    public double TotalRevenue { get; set; } = 0.35;
    public double DeadheadPenalty { get; set; } = 1.2;
    public double Positioning { get; set; } = 0.9;
    public double ResetPositioning { get; set; } = 1.1;
    public double HosSlack { get; set; } = 0.7;
    public double DivisionFit { get; set; } = 0.5;
    public double UtilizationFit { get; set; } = 0.4;
    /// <summary>
    /// Weight on getting the driver home when their home time is coming due. Deliberately heavier
    /// than division or trip-length fit: a carrier that misses home time loses drivers, so once the
    /// clock is up this should outrank a slightly better-paying load going the wrong way.
    /// </summary>
    public double HomeTime { get; set; } = 1.4;
    /// <summary>
    /// How near the home terminal counts as home. ATS generates loads to fixed cities, so insisting
    /// on the exact yard would strand the driver waiting for freight that may never appear.
    /// </summary>
    public double HomeRadiusMiles { get; set; } = 200;
    /// <summary>Cycle hours at or below which reset positioning starts dominating.</summary>
    public double ResetWatchCycleHours { get; set; } = 18;
    /// <summary>
    /// Use the fixed Floor/Target below instead of deriving them from the cost model. Off by
    /// default: derived thresholds stay honest across economy mods, fuel prices and pay scales,
    /// whereas fixed real-world rates do not survive a scaled map.
    /// </summary>
    public bool UseManualThresholds { get; set; }
    /// <summary>Manual target all-in revenue per mile. Only used when UseManualThresholds is on.</summary>
    public decimal TargetAllInRpm { get; set; } = 2.10m;
    /// <summary>Manual floor. Only used when UseManualThresholds is on.</summary>
    public decimal FloorAllInRpm { get; set; } = 1.35m;
    /// <summary>Deadhead beyond this share of loaded miles is a hard warning.</summary>
    public double MaxDeadheadRatio { get; set; } = 0.25;
}

// ---------------------------------------------------------------- market data

/// <summary>
/// A city the driver has actually reached in ATS.
///
/// This exists because of a real game behaviour: a city revealed with a save editor rather than
/// driven to is not truly "discovered", and ATS never generates cargo for it. So the carrier cannot
/// treat the whole map as its network on day one — it grows as the driver physically gets there.
/// A yard is only worth buying in a city that will actually offer freight.
/// </summary>
public class DiscoveredCity
{
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    /// <summary>Game time the driver first reported being here.</summary>
    public string DiscoveredGameTime { get; set; } = "";
    /// <summary>Trip that brought us here, if it was a load rather than a status report.</summary>
    public string TripNumber { get; set; } = "";
    /// <summary>ATS sells a garage here.</summary>
    public bool GarageAvailable { get; set; } = true;
    /// <summary>We own a yard here — mirrors a <see cref="Terminal"/> existing in this city.</summary>
    public bool GarageOwned { get; set; }
    /// <summary>The "you can buy a yard here" notice has been shown, so it does not nag.</summary>
    public bool Notified { get; set; }
    /// <summary>Driver passed on buying here. Keeps it off the recommendation list.</summary>
    public bool Declined { get; set; }
    public string Notes { get; set; } = "";
}

public class MarketCity
{
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    /// <summary>1 = strong freight market, 2 = moderate, 3 = thin/backhaul risk.</summary>
    public int Tier { get; set; } = 2;
    /// <summary>Legal truck parking + fuel + services suitable for a 34-hour restart.</summary>
    public bool ResetFriendly { get; set; }
    /// <summary>
    /// ATS offers a purchasable garage in this city. True for nearly every city in the game, so it
    /// defaults on; clear it for the handful that have no yard for sale.
    /// </summary>
    public bool HasGarage { get; set; } = true;
    public bool HasFuel { get; set; } = true;
    /// <summary>Official = SCS map DLC. C2C = Coast to Coast mod. MAC = More American Cities.</summary>
    public string Source { get; set; } = "Official";
    public List<string> StrongDivisions { get; set; } = new();
    public string Notes { get; set; } = "";
}

// ---------------------------------------------------------------- analysis DTOs

public class FeasibilityResult
{
    /// <summary>Feasible | Tight | Infeasible</summary>
    public string Verdict { get; set; } = "Infeasible";
    public List<string> Blockers { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public double TotalMiles { get; set; }
    public double DriveHours { get; set; }
    public double OnDutyHours { get; set; }
    public double ElapsedHours { get; set; }
    public string ProjectedArrivalGameTime { get; set; } = "";
    public string DueGameTime { get; set; } = "";
    /// <summary>Hours between projected arrival (incl. parking buffer) and the deadline.</summary>
    public double SlackHours { get; set; }
    public double RequiredBufferHours { get; set; }
    public int RestsRequired { get; set; }
    public int BreaksRequired { get; set; }
    public int FuelStopsRequired { get; set; }
    public bool CycleRestartRequired { get; set; }
    public double CycleRemainingAfter { get; set; }
    /// <summary>
    /// The 14-hour window left once the driver is empty at the receiver. Thin here means a dock that
    /// holds them even briefly closes the window while they are still on the property — at which point
    /// they cannot legally move the truck and are parked there for a 10.
    /// </summary>
    public double ShiftRemainingOnArrival { get; set; }
    public double DriveRemainingOnArrival { get; set; }
    /// <summary>
    /// Hours spent sitting at the receiver waiting for the window to open. Zero when the opening time
    /// is unknown, which is every load dispatched before the app started reading windows as ranges.
    /// </summary>
    public double WaitForAppointmentHours { get; set; }
    public double EffectiveMph { get; set; }
    public List<TimelineStep> Timeline { get; set; } = new();
}

public class TimelineStep
{
    public string Label { get; set; } = "";
    /// <summary>Drive | OnDuty | Break | Rest | Restart</summary>
    public string Kind { get; set; } = "Drive";
    public string StartGameTime { get; set; } = "";
    public string EndGameTime { get; set; } = "";
    public double Hours { get; set; }
    public double Miles { get; set; }
    public double DriveRemainingAfter { get; set; }
    public double ShiftRemainingAfter { get; set; }
    public double BreakRemainingAfter { get; set; }
    public double CycleRemainingAfter { get; set; }
}

public class LoadEvaluation
{
    public BoardLoad Load { get; set; } = new();
    public FeasibilityResult Feasibility { get; set; } = new();
    public decimal LoadedRpm { get; set; }
    public decimal AllInRpm { get; set; }
    public double DeadheadRatio { get; set; }
    public double Score { get; set; }
    /// <summary>Authorize | Backup | Reject</summary>
    public string Recommendation { get; set; } = "Reject";
    public List<string> HardFails { get; set; } = new();
    public List<string> Pros { get; set; } = new();
    public List<string> Cons { get; set; } = new();
    public int DestTier { get; set; } = 2;
    public bool DestResetFriendly { get; set; }
    public decimal EstimatedDriverPay { get; set; }
    public decimal EstimatedCompanyRevenue { get; set; }
    public decimal EstimatedFuelCost { get; set; }
    public decimal EstimatedMargin { get; set; }
    public List<string> ScoreDetail { get; set; } = new();
    /// <summary>True when the load is runnable but needs a different trailer first.</summary>
    public bool RequiresSwap { get; set; }
    public object? SwapPlan { get; set; }
    /// <summary>The cost breakdown the floor and target were derived from.</summary>
    public object? BreakEven { get; set; }
    public decimal FloorRpmUsed { get; set; }
    public decimal TargetRpmUsed { get; set; }
}

public class BoardDecision
{
    public List<LoadEvaluation> Evaluations { get; set; } = new();
    public string? AuthorizedLoadId { get; set; }
    public string Headline { get; set; } = "";
    public string Rationale { get; set; } = "";
    public List<string> DispatchNotes { get; set; } = new();
    public List<string> InfoNeeded { get; set; } = new();
    public bool RejectAll { get; set; }
    /// <summary>
    /// Everything considered was offered at the driver's current location. A rejection here means
    /// "show me the wider city board", not "reposition" — the city has not been looked at yet.
    /// </summary>
    public bool LocalOnly { get; set; }
    /// <summary>
    /// Every load failed on the clock rather than on the freight. The driver is not looking at a bad
    /// board — they are out of hours, and the answer is a rest, not a reposition. The board is cleared
    /// when this is set, because it will have turned over by the time they are legal again.
    /// </summary>
    public bool OutOfHours { get; set; }
    /// <summary>The 34-hour restart is required — a normal overnight will not fix the cycle.</summary>
    public bool NeedsRestart { get; set; }
    public bool ResetWatch { get; set; }
    public string NextTripNumberPreview { get; set; } = "";
}
