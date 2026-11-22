namespace TruckSimCoach;

public static class CoachBuild
{
    /// <summary>The coach driver app's own version. The other two apps keep their own.</summary>
    public const string Version = "0.1";
}

/// <summary>
/// One coach driver's career: who they are, who employs them, the lines the app has seen, the duties they have run,
/// their record, their pay and their driving hours. Everything is the coach app's own; Core supplies the map, the
/// clock and the close-out summary format.
/// </summary>
public class CoachCareer
{
    public int SchemaVersion { get; set; } = 1;
    public string AppVersion { get; set; } = CoachBuild.Version;
    /// <summary>Set once the first screen is filled in and a company has taken the driver on.</summary>
    public bool Started { get; set; }

    public CoachProfile Profile { get; set; } = new();
    public CoachSettings Settings { get; set; } = new();

    /// <summary>The game clock, "yyyy-MM-ddTHH:mm" from the shared epoch (Day 1 is a Monday).</summary>
    public string GameTime { get; set; } = "";
    /// <summary>Where the driver is now.</summary>
    public string City { get; set; } = "";
    public string Cc { get; set; } = "";

    public Employment Job { get; set; } = new();
    /// <summary>Companies worked for before this one, and how each ended.</summary>
    public List<PastJob> History { get; set; } = new();
    /// <summary>The current employer's depots, and which of them the driver has reached and opened.</summary>
    public List<Depot> Depots { get; set; } = new();

    /// <summary>Every line read off the game's menus, kept and assumed to run daily. See <see cref="Lines"/>.</summary>
    public List<Line> Lines { get; set; } = new();
    /// <summary>What the game's menus offer where the driver is now: the board the company assigns from.</summary>
    public List<Offer> Board { get; set; } = new();
    public string BoardCity { get; set; } = "";
    public string BoardCc { get; set; } = "";

    public List<Duty> Duties { get; set; } = new();
    public int NextDutyNumber { get; set; } = 1;

    public DisciplineState Discipline { get; set; } = new();
    public PayState Pay { get; set; } = new();
    public HoursState Hours { get; set; } = new();
    public TourState? Tour { get; set; }
    /// <summary>The assigned coach's condition: damage read after every run, the distance on the books, the service and inspections.</summary>
    public CoachCondition Coach { get; set; } = new();

    /// <summary>Cities the driver has been to, "City|CC". A depot city opens when it first appears here.</summary>
    public List<string> Visited { get; set; } = new();
    public List<CoachEvent> Log { get; set; } = new();
}

public class CoachProfile
{
    public string DriverName { get; set; } = "";
    /// <summary>The game's coach level, separate from the truck level.</summary>
    public int CoachLevel { get; set; }
    public CoachSkills Skills { get; set; } = new();
    public string StartedGameTime { get; set; } = "";
}

/// <summary>The Coaches DLC's six coach skills, 0 to 6 points each.</summary>
public class CoachSkills
{
    public const int Max = 6;
    public int LongerDuties { get; set; }
    public int DemandingTimetables { get; set; }
    public int PremiumService { get; set; }
    public int CushionedJourney { get; set; }
    public int PassengerFavourite { get; set; }
    public int EcoDriving { get; set; }

    public int Get(string name) => name switch
    {
        nameof(LongerDuties) => LongerDuties,
        nameof(DemandingTimetables) => DemandingTimetables,
        nameof(PremiumService) => PremiumService,
        nameof(CushionedJourney) => CushionedJourney,
        nameof(PassengerFavourite) => PassengerFavourite,
        nameof(EcoDriving) => EcoDriving,
        _ => 0,
    };

    public static string Word(string name) => name switch
    {
        nameof(LongerDuties) => "Longer Duties",
        nameof(DemandingTimetables) => "Demanding Timetables",
        nameof(PremiumService) => "Premium Service",
        nameof(CushionedJourney) => "Cushioned Journey",
        nameof(PassengerFavourite) => "Passenger Favourite",
        nameof(EcoDriving) => "EcoDriving",
        _ => name,
    };
}

public class CoachSettings
{
    /// <summary>"Real" companies by their own names, or "Invented" ones in their place.</summary>
    public string Roster { get; set; } = "Real";
    /// <summary>For reading screenshots of the game's job menus. Optional: lines can be typed in instead.</summary>
    public string AnthropicApiKey { get; set; } = "";
    public string AnthropicModel { get; set; } = "claude-opus-5-5";
    /// <summary>
    /// Hold the driver to the 45-minute break after 4h30 at the wheel. Off by default: the game's lines are timed
    /// without room for it, and a stop the timetable does not allow cannot be taken without running late.
    /// </summary>
    public bool Breaks { get; set; }
    /// <summary>The company's damage lines and service intervals. See <see cref="Maintenance"/>.</summary>
    public CoachMaintenance Maintenance { get; set; } = new();
}

/// <summary>
/// The company's maintenance policy. The damage lines are the Dispatcher's, so a coach is held to what a truck is:
/// under 5% nothing is said; from 5% it is worth a look the next time it stands at a depot anyway; from 10% it carries no
/// more passengers than the run home, and is fixed; from 15% it is reviewed before it carries anyone; from 30% it is out
/// of service. The service and inspection intervals are from real coach practice (see the manual).
/// </summary>
public class CoachMaintenance
{
    /// <summary>At or above: worth a look the next time the coach stands at a depot anyway. Not a trip on its own.</summary>
    public double WatchPct { get; set; } = 5;
    /// <summary>At or above: no more passenger work until it is fixed, beyond a line that takes it home to the garage.</summary>
    public double ShopPct { get; set; } = 10;
    /// <summary>At or above: reviewed before it carries passengers again. No line home either: it runs home empty, or to the nearest shop.</summary>
    public double ReviewPct { get; set; } = 15;
    /// <summary>At or above: out of service. The nearest shop and no further.</summary>
    public double OutOfServicePct { get; set; } = 30;
    /// <summary>Under this, the coach can be driven home to the company's garage; above it, the nearest shop.</summary>
    public double RunHomeMaxPct { get; set; } = 20;
    /// <summary>How far home can be, in hours of driving, and still beat the nearest shop between the review line and the run-home cap.</summary>
    public double RunHomeMaxHours { get; set; } = 9;

    /// <summary>Damage caused on one run below which it is logged and nothing follows: other people's mirrors are the job.</summary>
    public double NoiseFloorPct { get; set; } = 1;
    /// <summary>Up to this, Minor: on the record, and no duty bonus.</summary>
    public double MinorPct { get; set; } = 5;
    /// <summary>From this, Serious: a bad duty, a step up the ladder at once.</summary>
    public double SeriousPct { get; set; } = 15;
    /// <summary>From this, Major: one run can end the job.</summary>
    public double MajorPct { get; set; } = 25;

    /// <summary>The service in the company's garage: oil, filters, brakes, tyres, the lot. Kilometres on the books.</summary>
    public double ServiceIntervalKm { get; set; } = 40000;
    /// <summary>The periodic safety inspection, in days. Six weeks, as UK operators declare for coaches.</summary>
    public int InspectionIntervalDays { get; set; } = 42;
    /// <summary>The annual roadworthiness test (TÜV/MOT).</summary>
    public int AnnualTestDays { get; set; } = 365;

    /// <summary>Hours a coach stands in a shop before any labour: booked in, looked at, parts found.</summary>
    public double RepairIntakeHours { get; set; } = 8;
    /// <summary>Shop time per point of damage.</summary>
    public double RepairHoursPerPoint { get; set; } = 0.9;
    /// <summary>The company's own garage turns work round faster than a shop on the road.</summary>
    public double GarageFactor { get; set; } = 0.7;
    public double ServiceHours { get; set; } = 4;
    public double InspectionHours { get; set; } = 3;
    public double AnnualTestHours { get; set; } = 4;
}

public class CoachCondition
{
    /// <summary>The damage the game shows for the coach, as last read.</summary>
    public double DamagePct { get; set; }
    public string ReadAt { get; set; } = "";
    /// <summary>Kilometres on the company's books: the duties and the empty runs.</summary>
    public double Km { get; set; }
    public double LastServiceKm { get; set; }
    public string LastServiceAt { get; set; } = "";
    public string LastInspectionAt { get; set; } = "";
    public string LastAnnualTestAt { get; set; } = "";
    /// <summary>In a shop until then: no duty books on before it.</summary>
    public string InShopUntil { get; set; } = "";
    public List<MaintEntry> Entries { get; set; } = new();
}

public class MaintEntry
{
    public string GameTime { get; set; } = "";
    /// <summary>Run, Reading, Repair, Service, Inspection or Annual test.</summary>
    public string Kind { get; set; } = "";
    /// <summary>The duty number, "Empty run", or empty.</summary>
    public string Ref { get; set; } = "";
    public string Place { get; set; } = "";
    public double Before { get; set; }
    public double After { get; set; }
    /// <summary>Damage the run caused: after less before, never less than nothing.</summary>
    public double Incurred { get; set; }
    /// <summary>Driver, Other (another road user) or Game.</summary>
    public string Cause { get; set; } = "";
    /// <summary>None, Minor, Moderate, Serious or Major.</summary>
    public string Severity { get; set; } = "";
    public double Km { get; set; }
    public double ShopHours { get; set; }
    public decimal Cost { get; set; }
    public string Note { get; set; } = "";
}

public class Employment
{
    public string CompanyId { get; set; } = "";
    /// <summary>1 Probationary driver, 2 Line driver, 3 Senior line driver, 4 Excursion driver, 5 Tour driver.</summary>
    public int Rank { get; set; } = 1;
    public string HiredGameTime { get; set; } = "";
    public bool OnProbation { get; set; } = true;
    public string ProbationEndsGameTime { get; set; } = "";
    /// <summary>Probation is extended once, by 30 days, where there was too little work to judge.</summary>
    public bool ProbationExtended { get; set; }
    /// <summary>Active, Dismissed or Resigned. A dismissed driver must find another company.</summary>
    public string Status { get; set; } = "Active";
    public string HomeCity { get; set; } = "";
    public string HomeCc { get; set; } = "";
    /// <summary>The coach model the company has assigned, which the player buys in the game to stand in for it.</summary>
    public string CoachModel { get; set; } = "";
    public string FleetNumber { get; set; } = "";
    /// <summary>Confirmed by the player: the assigned model is in their game garage.</summary>
    public bool CoachBought { get; set; }
    /// <summary>When the last rank review ran, so it runs once a fortnight.</summary>
    public string LastReviewGameTime { get; set; } = "";
}

public class PastJob
{
    public string CompanyId { get; set; } = "";
    public string CompanyName { get; set; } = "";
    public int Rank { get; set; }
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    /// <summary>Resigned, Dismissed, or ProbationFailed.</summary>
    public string Ended { get; set; } = "";
    public string Why { get; set; } = "";
}

public class Depot
{
    public string City { get; set; } = "";
    public string Cc { get; set; } = "";
    /// <summary>The driver has been to the city since joining.</summary>
    public bool Reached { get; set; }
    /// <summary>The player bought the large garage there in the game and confirmed it: duties can start and end here.</summary>
    public bool Opened { get; set; }
    public string OpenedGameTime { get; set; } = "";
}

/// <summary>One stop of a line: the station, and the time of day the timetable puts the coach there.</summary>
public class LineStop
{
    public string City { get; set; } = "";
    public string Cc { get; set; } = "";
    public string Station { get; set; } = "";
    /// <summary>"HH:mm". Arrival at a stop, departure from the first. Empty where the menu showed none.</summary>
    public string Time { get; set; } = "";
    /// <summary>Days after the first departure (a night line crossing midnight is 1).</summary>
    public int DayOffset { get; set; }
    /// <summary>Worked out from the distance because the menu showed no time here.</summary>
    public bool Derived { get; set; }
    /// <summary>Minutes the timetable stands the coach at this stop.</summary>
    public int DwellMinutes { get; set; } = 5;
}

/// <summary>
/// A line: a timetabled coach service the game offered, saved so the app knows it from then on. Every line is
/// assumed to run every day at the same times; seeing it again confirms it.
/// </summary>
public class Line
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n")[..10];
    /// <summary>Line, Night or Tourist.</summary>
    public string Kind { get; set; } = "Line";
    public List<LineStop> Stops { get; set; } = new();
    /// <summary>
    /// The stops the game's menu says the line has, the first and last included: "2 stops" is straight through, "4 stops"
    /// calls at two cities on the way. The menu names only the ends, so a line can know where it goes before it knows where
    /// it calls: <see cref="Stops"/> holds what is known, and the cities between are asked for when the line is first run.
    /// </summary>
    public int StopCount { get; set; }
    /// <summary>Stops on the way the library does not know the cities of yet.</summary>
    public int UnknownStops => Math.Max(0, StopCount - Stops.Count);
    /// <summary>Tourist: the landmark visited, and whether it is locally or globally known.</summary>
    public string Landmark { get; set; } = "";
    public string LandmarkScope { get; set; } = "";
    public decimal GamePay { get; set; }
    public int Passengers { get; set; }
    public double Km { get; set; }
    public string FirstSeen { get; set; } = "";
    public string LastSeen { get; set; } = "";
    public int TimesSeen { get; set; }
    public int TimesRun { get; set; }
    public double AvgDelayMinutes { get; set; }
    public double AvgSatisfaction { get; set; }

    public LineStop From => Stops[0];
    public LineStop To => Stops[^1];
}

/// <summary>A job on the game's menu where the driver is now: a line from the library, and what the menu said about it today.</summary>
public class Offer
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n")[..10];
    public string LineId { get; set; } = "";
    /// <summary>Contract or Tourist, as the game's menus are split.</summary>
    public string Menu { get; set; } = "Contract";
    public decimal GamePay { get; set; }
    public int Passengers { get; set; }
    public string SeenGameTime { get; set; } = "";
}

/// <summary>One stop on a running duty: the timetable and what happened.</summary>
public class DutyStop
{
    public string City { get; set; } = "";
    public string Cc { get; set; } = "";
    public string Station { get; set; } = "";
    public string ScheduledArrive { get; set; } = "";
    public string ScheduledDepart { get; set; } = "";
    public string ArrivedAt { get; set; } = "";
    public string DepartedAt { get; set; } = "";
    public int Boarded { get; set; }
    public int Alighted { get; set; }
    /// <summary>What the game shows at the stop: the % and the count in each of the four categories. Null until entered.</summary>
    public double? SatisfactionPct { get; set; }
    public int VeryHappy { get; set; }
    public int Happy { get; set; }
    public int Unhappy { get; set; }
    public int VeryUnhappy { get; set; }
    /// <summary>Who drives the leg FROM this stop to the next: "You" or "Co-driver".</summary>
    public string LegDriver { get; set; } = "You";
    /// <summary>A break taken on the leg FROM this stop (a long leg has its 45 minutes on the way), in minutes.</summary>
    public int BreakMinutes { get; set; }
    /// <summary>
    /// Two drivers: the leg from this stop is too long for one, so the planned handover at a rest area, in minutes after
    /// leaving. The leg's driver drives to it, the other on from it. 0 where the leg is driven by one.
    /// </summary>
    public int HandoverAfterMinutes { get; set; }
    /// <summary>When the handover on this leg actually happened, as logged on arrival. Empty where nobody changed over.</summary>
    public string HandoverAt { get; set; } = "";
    public double LegKm { get; set; }
}

public class Duty
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n")[..10];
    public string Number { get; set; } = "";
    public string LineId { get; set; } = "";
    /// <summary>Line, Night, Tourist or TourLeg.</summary>
    public string Kind { get; set; } = "Line";
    public string Title { get; set; } = "";
    public string Landmark { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public string CoachModel { get; set; } = "";
    public int RankAtTheTime { get; set; }
    /// <summary>Solo, or Double on a night line: a co-driver the app simulates, who takes the legs marked theirs.</summary>
    public string Crew { get; set; } = "Solo";
    public string BookOn { get; set; } = "";
    public List<DutyStop> Stops { get; set; } = new();
    /// <summary>Assigned, Running, Done or Cancelled.</summary>
    public string Status { get; set; } = "Assigned";
    public string ClosedGameTime { get; set; } = "";
    public string BookOff { get; set; } = "";
    public double Km { get; set; }
    public int Passengers { get; set; }
    public string Why { get; set; } = "";

    // ---- the close-out
    /// <summary>Excellent, Good, Poor or Bad.</summary>
    public string Grade { get; set; } = "";
    public double PunctualityPct { get; set; }
    public int LateStops { get; set; }
    public int VeryLateStops { get; set; }
    public int EarlyDepartures { get; set; }
    /// <summary>The duty's satisfaction: every stop's reading, averaged.</summary>
    public double FinalSatisfaction { get; set; }
    /// <summary>The lowest reading at any stop. A stop where passengers were made angry is not undone by a happy finish.</summary>
    public double WorstSatisfaction { get; set; }
    public string WorstStop { get; set; } = "";
    public double CategoryIndex { get; set; }
    public int Complaints { get; set; }
    /// <summary>"Driver" (counts), or Road, Game, Coach (lateness not held against the driver).</summary>
    public string Fault { get; set; } = "Driver";
    public string DelayReason { get; set; } = "";
    public int Strikes { get; set; }
    public List<PayLine> PayLines { get; set; } = new();
    public decimal Pay { get; set; }
    public decimal Tips { get; set; }
    public bool EndedAway { get; set; }
    public string EndedAt { get; set; } = "";
    public List<string> HoursFindings { get; set; } = new();
    public string TourId { get; set; } = "";
    /// <summary>The coach's damage at the start and the end of the duty, as read off the game.</summary>
    public double DamageBefore { get; set; }
    public double DamageAfter { get; set; }
    public double DamageIncurred { get; set; }
    /// <summary>Driver, Other or Game. Only the driver's counts.</summary>
    public string DamageCause { get; set; } = "Driver";
    /// <summary>None, Minor, Moderate, Serious or Major, from the damage caused.</summary>
    public string DamageSeverity { get; set; } = "None";
}

public class PayLine
{
    public string GameTime { get; set; } = "";
    public string Duty { get; set; } = "";
    /// <summary>Hours, Night, Sunday, Allowance, Night away, Tips, Duty bonus, Performance bonus.</summary>
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
    public decimal Amount { get; set; }
}

public class Payslip
{
    public string Number { get; set; } = "";
    public string PeriodEnd { get; set; } = "";
    public List<PayLine> Lines { get; set; } = new();
    public decimal Gross { get; set; }
}

public class PayState
{
    /// <summary>Earned since the last payslip.</summary>
    public List<PayLine> Pending { get; set; } = new();
    public List<Payslip> Payslips { get; set; } = new();
    /// <summary>The last Friday paid, as a day number, so the weekly run catches up once per Friday.</summary>
    public int LastPayday { get; set; }
    /// <summary>The last four-weekly performance review, as a day number.</summary>
    public int LastPerformanceDay { get; set; }
}

public class DisciplineState
{
    /// <summary>0 none, 1 verbal warning, 2 written reprimand, 3 final warning, 4 dismissed.</summary>
    public int Level { get; set; }
    /// <summary>Clean duties since the level last moved: ten bring it down a step.</summary>
    public int CleanRun { get; set; }
    /// <summary>Strikes since the level last moved: three take it up a step.</summary>
    public int StrikesSinceStep { get; set; }
    public List<DisciplineEntry> Entries { get; set; } = new();
}

public class DisciplineEntry
{
    public string GameTime { get; set; } = "";
    public string Duty { get; set; } = "";
    /// <summary>Strike, Verbal warning, Written reprimand, Final warning, Dismissal, Stepped down, Bonus.</summary>
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
}

/// <summary>
/// EU 561/2006 as it applies to a coach driver, kept from what the app logs: the duties' legs, the breaks at stops
/// and the rests reported. See <see cref="Hours"/>.
/// </summary>
public class HoursState
{
    /// <summary>When the last daily rest ended: the start of today's spread.</summary>
    public string SpreadStart { get; set; } = "";
    public double DrivenToday { get; set; }
    public double DrivenSinceBreak { get; set; }
    /// <summary>Break taken toward the 45 minutes since the last one completed (the 15 + 30 split).</summary>
    public double BreakCredit { get; set; }
    public int ExtendedDaysUsed { get; set; }
    public string WeekStart { get; set; } = "";
    public double DrivenThisWeek { get; set; }
    public double DrivenLastWeek { get; set; }
    /// <summary>When the last weekly rest ended: six 24-hour periods from here, or twelve on a tour.</summary>
    public string LastWeeklyRestEnd { get; set; } = "";
    /// <summary>After a 12-day tour, the two weekly rests owed before the next working week.</summary>
    public bool OwesDoubleRest { get; set; }
    /// <summary>Today's spread is shared with a co-driver: 9 hours of rest in 30, not 11 in 24.</summary>
    public bool MultiManned { get; set; }
    /// <summary>Nothing driven since the career began: the time before the first duty is rest, however short.</summary>
    public bool Fresh { get; set; }
    public List<RestEntry> Rests { get; set; } = new();
}

public class RestEntry
{
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    /// <summary>Break, Daily or Weekly, as worked out from its length.</summary>
    public string Kind { get; set; } = "";
    public string Where { get; set; } = "";
}

/// <summary>A multi-day coach tour, the top rank's work: the group, the cities, the nights away and the 12-day rule.</summary>
public class TourState
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n")[..8];
    public string Name { get; set; } = "";
    public string StartGameTime { get; set; } = "";
    public int Days { get; set; }
    public int Passengers { get; set; }
    public List<TourDay> Itinerary { get; set; } = new();
    public int Today { get; set; }
    public bool International { get; set; }
    public string Status { get; set; } = "Planned";
    public int NightsAway { get; set; }
    public decimal Tips { get; set; }
}

public class TourDay
{
    public int Day { get; set; }
    public string City { get; set; } = "";
    public string Cc { get; set; } = "";
    public string Plan { get; set; } = "";
    public bool Done { get; set; }
}

public class CoachEvent
{
    public string GameTime { get; set; } = "";
    public string Channel { get; set; } = "";
    public string Message { get; set; } = "";
}
