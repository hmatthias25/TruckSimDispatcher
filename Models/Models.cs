namespace TruckSimDispatcher.Models;

/// <summary>Root persisted document. One file = one driver career.</summary>
public class AppState
{
    public int SchemaVersion { get; set; } = 1;
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
    [Obsolete("Superseded by Terminals; retained so older career files still load.")]
    public List<string> SecondaryTerminals { get; set; } = new();
    public string Founded { get; set; } = "";
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
    public string RankTitle { get; set; } = "Probationary Company Driver";
    public PayPlan Pay { get; set; } = new();
    public List<string> Qualifications { get; set; } = new();
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
    public List<TransferRequest> Transfers { get; set; } = new();
    public ProbationPlan Probation { get; set; } = new();
    /// <summary>Driver pay accrued but not yet paid out on a settlement.</summary>
    public decimal UnsettledPay { get; set; }
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
    public string AssignedDriver { get; set; } = "";
    /// <summary>InService | Shop | OutOfService | Reserve</summary>
    public string Status { get; set; } = "InService";
    /// <summary>Terminal this unit is based out of. Authoritative — counts against yard capacity.</summary>
    public string HomeTerminalId { get; set; } = "";
    [Obsolete("Superseded by HomeTerminalId; kept so older career files still load.")]
    public string HomeTerminal { get; set; } = "";
    public double LastServiceMiles { get; set; }
    public double ServiceIntervalMiles { get; set; } = 25000;
    public decimal PurchasePrice { get; set; }
    public decimal MonthlyPayment { get; set; }
    public string Notes { get; set; } = "";
}

public class Trailer
{
    public string Unit { get; set; } = "";
    /// <summary>Dry Van, Reefer, Flatbed, Step Deck, Tanker, Dump, Lowboy, Car Hauler, Livestock, Log</summary>
    public string Type { get; set; } = "";
    public string Division { get; set; } = "";
    public int Year { get; set; }
    public string Make { get; set; } = "";
    public string Length { get; set; } = "53'";
    public string Axles { get; set; } = "Tandem";
    /// <summary>See <see cref="Truck.InGameGarage"/> — real ATS equipment vs company backdrop.</summary>
    public bool InGameGarage { get; set; }
    public double DamagePct { get; set; }
    public double ServiceMiles { get; set; }
    /// <summary>InService | Shop | OutOfService | Reserve</summary>
    public string Status { get; set; } = "InService";
    /// <summary>Terminal this trailer is based out of.</summary>
    public string HomeTerminalId { get; set; } = "";
    [Obsolete("Superseded by HomeTerminalId; kept so older career files still load.")]
    public string HomeTerminal { get; set; } = "";
    public string CurrentLocation { get; set; } = "";
    public string AssignedTruckUnit { get; set; } = "";
    public bool IsCompanyOwned { get; set; } = true;
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
    public bool IsUrgent { get; set; }
    public bool IsFragile { get; set; }
    public bool IsHazmat { get; set; }
    public bool IsOversize { get; set; }
    public bool RequiresTarp { get; set; }
    public int ExtraStops { get; set; }
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
    public double DetentionHours { get; set; }
    public double LayoverDays { get; set; }
    public double BreakdownDays { get; set; }
    public int ExtraStops { get; set; }
    public int TarpsUsed { get; set; }
    public bool IsHazmat { get; set; }
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
    /// <summary>Loaded | Departed | Fuel | Break | Rest | Scale | Delay | Breakdown | Arrived | Note</summary>
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
    public string IssuedUtc { get; set; } = DateTime.UtcNow.ToString("o");
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
    /// <summary>Active | OnLeave | Terminated</summary>
    public string Status { get; set; } = "Active";
    public string AssignedTruckUnit { get; set; } = "";
    public string AssignedTrailerUnit { get; set; } = "";
    public string HomeTerminalId { get; set; } = "";
    /// <summary>Trainee | Competent | Experienced | Veteran — mirrors the ATS driver skill tiers.</summary>
    public string Skill { get; set; } = "Competent";
    /// <summary>Share of the revenue they generate that goes to their wages.</summary>
    public double WageShare { get; set; } = 0.30;
    public double LifetimeMiles { get; set; }
    public decimal LifetimeRevenue { get; set; }
    public decimal LifetimeWages { get; set; }
    public int ReportsFiled { get; set; }
    public string Notes { get; set; } = "";
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
    public string FiledUtc { get; set; } = DateTime.UtcNow.ToString("o");
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
    /// <summary>Tractor damage read off the game at the end of the period.</summary>
    public double DamagePctAfter { get; set; }
    /// <summary>Trailer damage read off the game at the end of the period.</summary>
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
    public double PreTripHours { get; set; } = 0.25;
    public double PostTripHours { get; set; } = 0.25;
    public double DefaultLoadingHours { get; set; } = 1.0;
    public double DefaultUnloadingHours { get; set; } = 1.0;
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
    public double PreventiveIntervalMiles { get; set; } = 25000;
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
    public bool ResetWatch { get; set; }
    public string NextTripNumberPreview { get; set; } = "";
}
