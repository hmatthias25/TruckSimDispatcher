using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

// ==================================================================== maintenance

public static class MaintenanceService
{
    public static WorkOrder OpenWorkOrder(AppState s, WorkOrder wo)
    {
        var code = string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;
        wo.Number = $"{code}-WO-{++s.Counters.WorkOrder:0000}";
        if (string.IsNullOrWhiteSpace(wo.GameTime)) wo.GameTime = s.Status.GameTime;

        // An order that is still open has not been paid, so it must not post a cost to the books. Keep
        // the quoted figure as an estimate instead of discarding it — it pre-fills the close-out, which
        // is what stops a repair being recorded as free.
        if (wo.Status != "Completed" && wo.Cost > 0)
        {
            wo.EstimatedCost = wo.Cost;
            wo.Cost = 0;
        }
        if (wo.EstimatedCost <= 0 && wo.Cost > 0) wo.EstimatedCost = wo.Cost;

        s.WorkOrders.Insert(0, wo);
        if (wo.Status == "Completed") Close(s, wo);
        return wo;
    }

    public static WorkOrder CompleteWorkOrder(AppState s, string number, decimal cost,
        double damageAfter, string vendor, string paidBy, string notes)
    {
        var wo = s.WorkOrders.FirstOrDefault(w => w.Number == number)
                 ?? throw new InvalidOperationException("Work order not found.");
        wo.Cost = cost;
        wo.DamageAfter = damageAfter;
        wo.Vendor = vendor;
        wo.PaidBy = string.IsNullOrWhiteSpace(paidBy) ? "Company" : paidBy;
        wo.Status = "Completed";
        if (!string.IsNullOrWhiteSpace(notes))
            wo.Notes = string.IsNullOrWhiteSpace(wo.Notes) ? notes : wo.Notes + " | " + notes;
        Close(s, wo);
        return wo;
    }

    private static void Close(AppState s, WorkOrder wo)
    {
        LedgerService.PostWorkOrder(s, wo);

        if (wo.UnitKind == "Truck")
        {
            var t = s.Trucks.FirstOrDefault(x => x.Unit == wo.Unit);
            if (t != null)
            {
                // What the company has spent on this unit is what decides its trade date.
                if (wo.Cost > 0 && wo.PaidBy != "Driver")
                    t.LifetimeRepairCost = Math.Round(t.LifetimeRepairCost + wo.Cost, 2);
                t.DamagePct = wo.DamageAfter;
                if (t.Status is "OutOfService" or "Shop" && wo.DamageAfter < s.Settings.Maintenance.MandatoryReviewPct)
                    t.Status = "InService";
                if (wo.Kind == "Preventive")
                    t.LastServiceMiles = wo.OdometerAtService > 0 ? wo.OdometerAtService : t.ServiceMiles;
                if (t.Unit == s.Driver.AssignedTruckUnit) s.Status.TruckDamagePct = wo.DamageAfter;
            }
        }
        else
        {
            var t = s.Trailers.FirstOrDefault(x => x.Unit == wo.Unit);
            if (t != null)
            {
                t.DamagePct = wo.DamageAfter;
                if (t.Status is "OutOfService" or "Shop" && wo.DamageAfter < s.Settings.Maintenance.MandatoryReviewPct)
                    t.Status = "InService";
                if (t.Unit == s.Driver.AssignedTrailerUnit) s.Status.TrailerDamagePct = wo.DamageAfter;
            }
        }
    }

    /// <summary>Current company directive for a damage reading, per policy thresholds.</summary>
    public static (string Status, string Directive) Assess(AppSettings cfg, double damagePct, string unitLabel)
    {
        var m = cfg.Maintenance;
        if (damagePct >= m.OutOfServicePct)
            return ("OutOfService", $"{unitLabel} at {damagePct:0.#}% — out of service. Stop and contact operations.");
        if (damagePct >= m.MandatoryReviewPct)
            return ("MandatoryReview", $"{unitLabel} at {damagePct:0.#}% — mandatory maintenance review before the next dispatch.");
        if (damagePct >= m.ReportPct)
            return ("Report", $"{unitLabel} at {damagePct:0.#}% — report to the shop after this delivery.");
        return ("Monitor", $"{unitLabel} at {damagePct:0.#}% — monitor only.");
    }

    /// <summary>
    /// Shop directives, limited to equipment whose condition is actually knowable. ATS gives no way
    /// to set or read damage on trucks the driver is not in, so raising a directive against company
    /// backdrop equipment would be inventing a problem the driver could never resolve.
    /// </summary>
    public static List<string> FleetAlerts(AppState s)
    {
        var alerts = new List<string>();
        var openWorkOrderUnits = s.WorkOrders
            .Where(w => w.Status == "Open")
            .Select(w => w.Unit)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool Tracked(string unit, bool inGarage) => inGarage || openWorkOrderUnits.Contains(unit);

        foreach (var t in s.Trucks.Where(t => Tracked(t.Unit, t.InGameGarage)))
        {
            var (status, directive) = Assess(s.Settings, t.DamagePct, $"Unit {t.Ref}");
            if (status != "Monitor") alerts.Add(directive);
            var since = t.ServiceMiles - t.LastServiceMiles;
            if (since >= t.ServiceIntervalMiles)
                alerts.Add($"Unit {t.Ref} PM overdue by {since - t.ServiceIntervalMiles:N0} mi.");
        }
        foreach (var t in s.Trailers.Where(t => Tracked(t.Unit, t.InGameGarage)))
        {
            var (status, directive) = Assess(s.Settings, t.DamagePct, $"Trailer {t.Ref}");
            if (status is "MandatoryReview" or "OutOfService") alerts.Add(directive);
        }
        return alerts;
    }
}

// ==================================================================== safety

public static class SafetyService
{
    /// <summary>
    /// Progressive discipline. An equipment downgrade sits before suspension deliberately: taking the
    /// good truck away is a consequence a driver feels immediately, and it is recoverable, which
    /// makes it a fairer rung than jumping straight to putting someone out of work.
    /// </summary>
    private static readonly string[] Ladder =
        { "Coaching", "WrittenWarning", "FinalWarning", "EquipmentDowngrade", "Suspension", "Termination" };

    /// <summary>Driver-fault late deliveries it takes, inside the window, before discipline starts.</summary>
    public const int LateStrikesBeforeDiscipline = 3;

    /// <summary>How many recent loads the strikes are counted over. Clean work walks them off.</summary>
    public const int LateStrikeWindow = 10;

    /// <summary>
    /// Driver-fault late deliveries among the last <see cref="LateStrikeWindow"/> loads.
    ///
    /// One late load is a bad day. Three in ten is a pattern, and only a pattern is worth disciplining
    /// over — the app was reaching a written warning off a single one, for a load that was late because
    /// of a bug in the app itself.
    ///
    /// Counted off the trips rather than the incident list, so lateness nobody blamed the driver for
    /// leaves no trace here at all.
    /// </summary>
    public static int LateStrikes(AppState s)
    {
        var recent = s.Trips
            .Where(t => t.Status == "Delivered" && t.Kind == "Freight")
            .OrderByDescending(t => GameClock.TryParse(t.DeliveredGameTime) ?? DateTime.MinValue)
            .Take(LateStrikeWindow)
            .ToList();

        return recent.Count(t => t.ServiceResult == "Late"
                                 && t.DelayFault.Equals("Driver", StringComparison.OrdinalIgnoreCase));
    }

    public static Incident RecordIncident(AppState s, Incident inc)
    {
        var code = string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;
        inc.Number = $"{code}-INC-{++s.Counters.Incident:0000}";
        if (string.IsNullOrWhiteSpace(inc.GameTime)) inc.GameTime = s.Status.GameTime;
        inc.LoadCountAtIncident = s.Trips.Count(t => t.Status == "Delivered");
        if (inc.AgesOffAfterLoads <= 0) inc.AgesOffAfterLoads = AgeOffFor(inc.Severity);
        s.Incidents.Insert(0, inc);
        return inc;
    }

    /// <summary>How much clean work it takes to put an incident behind you. Severity scales it.</summary>
    public static int AgeOffFor(string severity) => severity switch
    {
        "Major" => 60,
        "Serious" => 40,
        "Moderate" => 25,
        _ => 20
    };

    /// <summary>
    /// Driver-fault preventable incidents that still count against hiring.
    ///
    /// Excludes anything forgiven by Safety and anything that has aged off through clean work. The
    /// incident stays on the record permanently — this is only about whether it still bars the driver
    /// from a carrier, because a mistake in the first week should not end a career.
    /// </summary>
    public static List<Incident> CountingFaults(AppState s)
    {
        var loadsNow = s.Trips.Count(t => t.Status == "Delivered");
        return s.Incidents
            .Where(i => i.FaultAttribution == "Driver" && i.Preventable)
            .Where(i => string.IsNullOrWhiteSpace(i.ForgivenGameTime))
            .Where(i => i.AgesOffAfterLoads <= 0 || loadsNow - i.LoadCountAtIncident < i.AgesOffAfterLoads)
            .ToList();
    }

    /// <summary>
    /// Clean loads still needed before an incident stops counting. 0 = already clear.
    ///
    /// Only ever asked about an incident that actually counts. A non-preventable one is not something
    /// to work off — it never counted — and treating it as one is what made a driver look like they had
    /// run two clean loads when they had run a dozen.
    /// </summary>
    public static int LoadsToAgeOff(AppState s, Incident inc)
    {
        if (!string.IsNullOrWhiteSpace(inc.ForgivenGameTime)) return 0;
        if (inc.FaultAttribution != "Driver" || !inc.Preventable) return 0;
        if (inc.AgesOffAfterLoads <= 0) return 0;
        var loadsNow = s.Trips.Count(t => t.Status == "Delivered");
        return Math.Max(0, inc.AgesOffAfterLoads - (loadsNow - inc.LoadCountAtIncident));
    }

    /// <summary>
    /// Safety clearing an incident early — remedial training, a review that changed the picture, or a
    /// re-attribution. Requires real work behind it: half the age-off period, so it is earned rather
    /// than clicked away the moment it becomes inconvenient.
    /// </summary>
    public static Incident Forgive(AppState s, string number, string reason, bool force)
    {
        var inc = s.Incidents.FirstOrDefault(i => i.Number == number)
                  ?? throw new InvalidOperationException("No such incident.");
        if (!string.IsNullOrWhiteSpace(inc.ForgivenGameTime))
            throw new InvalidOperationException($"{inc.Number} has already been cleared.");
        if (inc.FaultAttribution != "Driver" || !inc.Preventable)
            throw new InvalidOperationException($"{inc.Number} is not a preventable driver-fault incident — it never counted against you.");

        var loadsNow = s.Trips.Count(t => t.Status == "Delivered");
        var clean = loadsNow - inc.LoadCountAtIncident;
        var required = Math.Max(1, inc.AgesOffAfterLoads / 2);
        if (clean < required && !force)
            throw new InvalidOperationException(
                $"{inc.Number} needs {required} clean loads before Safety will review it early; you have run {clean}. " +
                $"It ages off on its own after {inc.AgesOffAfterLoads}.");

        inc.ForgivenGameTime = s.Status.GameTime;
        inc.ForgivenReason = string.IsNullOrWhiteSpace(reason)
            ? $"Cleared by Safety after {clean} clean load(s)."
            : reason;
        return inc;
    }

    /// <summary>
    /// Progressive discipline. Only driver-fault preventable incidents advance the ladder —
    /// dispatcher errors, mechanical failures, unavoidable delays and game limitations never do.
    /// </summary>
    public static string? RecommendDiscipline(AppState s, Incident inc)
    {
        if (inc.FaultAttribution != "Driver" || !inc.Preventable) return null;

        var loadsNow = s.Trips.Count(t => t.Status == "Delivered");
        var active = ActiveDiscipline(s, loadsNow);
        var currentIndex = active.Count == 0 ? -1
            : active.Max(a => Array.IndexOf(Ladder, a.Level));

        var next = inc.Severity switch
        {
            // A major preventable event skips straight up the ladder.
            "Major" => Math.Max(currentIndex + 1, 2),
            "Serious" => Math.Max(currentIndex + 1, 1),
            _ => currentIndex + 1
        };
        next = Math.Clamp(next, 0, Ladder.Length - 1);
        return Ladder[next];
    }

    /// <summary>
    /// Files an incident and applies the consequence in one step.
    ///
    /// The driver reports what happened; the company decides what follows. Letting the driver pick
    /// their own level made the ladder meaningless — nobody chooses Termination — and inverted the one
    /// relationship the app is built on. <see cref="RecommendDiscipline"/> already knew the right
    /// answer; this makes it the decision rather than a suggestion the driver may ignore.
    /// </summary>
    public static (Incident Incident, DisciplineAction? Action) FileAndDecide(AppState s, Incident inc)
    {
        var created = RecordIncident(s, inc);
        var level = RecommendDiscipline(s, created);
        if (level == null) return (created, null);

        var action = Issue(s, level,
            $"{created.Kind} on {(string.IsNullOrWhiteSpace(created.TripNumber) ? "no trip" : created.TripNumber)} — {created.Description}".Trim(),
            CorrectiveFor(level, created), created.Number, ExpiryFor(level));
        action.DriverAcknowledged = false;

        // The top rung is not just a strongly worded note.
        if (level == "Termination")
            ApplyTermination(s, $"{action.Number}: {created.Kind} — {created.Description}", action.Number);

        return (created, action);
    }

    /// <summary>
    /// Being let go off the safety ladder, with the same consequence as a failed review.
    ///
    /// Termination was the top rung and stopped at issuing the action. A driver fired for preventables is
    /// employable, but not by the carriers that just read their record — so they land in front of
    /// second-chance carriers only, same as a driver who failed two reviews.
    /// </summary>
    public static void ApplyTermination(AppState s, string reason, string reference)
    {
        // Let go BY the second chance. There is nowhere after this — a driver with two terminations for
        // the work, the second from the outfit that exists to take drivers with one, is done. Said
        // plainly rather than leaving them applying to a market that will not answer.
        if (s.Driver.TerminatedForCause
            && string.IsNullOrWhiteSpace(s.Driver.RedeemedGameTime)
            && Carriers.IsSecondChance(s.Company.Code)
            && !s.Driver.CareerOver)
        {
            s.Driver.CareerOver = true;
            s.Driver.CareerOverGameTime = s.Status.GameTime;
            s.Driver.CareerOverReason =
                $"Let go by {s.Company.Name}, which is where drivers go after a termination. " +
                (string.IsNullOrWhiteSpace(reason) ? reference : reason) +
                " There is no carrier after this one. The record stays on file; a new career starts clean.";
            s.Driver.Rank = "terminated";
            s.Driver.Status = "Terminated";
            return;
        }

        if (s.Driver.TerminatedForCause) return;
        s.Driver.TerminatedForCause = true;
        s.Driver.TerminationReason = string.IsNullOrWhiteSpace(reason) ? reference : reason;
        s.Driver.TerminatedGameTime = s.Status.GameTime;
        s.Driver.Rank = "terminated";
        s.Driver.Status = "Terminated";
    }

    /// <summary>What the company requires of the driver at each rung of the ladder.</summary>
    public static string CorrectiveFor(string level, Incident inc) => level switch
    {
        "Coaching" =>
            "Coaching conversation logged. Slow down in the situation that caused this and it goes no further — " +
            "this ages off your record after twenty clean loads.",
        "WrittenWarning" =>
            "Written warning on file. Safety is watching the next stretch closely. Another preventable event " +
            "moves you to a final warning.",
        "FinalWarning" =>
            "Final warning. One more preventable incident and you are out of the truck. Take the extra minute " +
            "at every dock and every tight turn.",
        "EquipmentDowngrade" =>
            "You are being moved to a lesser unit while you prove this is behind you. Fifteen clean loads earns " +
            "the better truck back.",
        "Suspension" =>
            "Suspended from dispatch pending review. No freight moves under your name until Safety reinstates you.",
        "Termination" =>
            "Employment terminated. The record follows you — a future carrier will see it when you apply.",
        _ => "See Safety for what happens next."
    };

    /// <summary>Heavier actions stay on the record longer.</summary>
    private static int ExpiryFor(string level) => level switch
    {
        "Coaching" => 20,
        "WrittenWarning" => 30,
        "FinalWarning" => 45,
        "EquipmentDowngrade" => 30,
        _ => 0            // suspension and termination do not age off on their own
    };

    /// <summary>The driver signing that they have been told. Not optional, and not an agreement.</summary>
    public static DisciplineAction Acknowledge(AppState s, string number)
    {
        var a = s.Discipline.FirstOrDefault(x => x.Number == number)
                ?? throw new InvalidOperationException("No such disciplinary action.");
        a.DriverAcknowledged = true;
        return a;
    }

    /// <summary>Actions the driver has been issued but not yet signed for.</summary>
    public static List<DisciplineAction> Unacknowledged(AppState s) =>
        s.Discipline.Where(d => !d.DriverAcknowledged && d.Level != "Commendation").ToList();

    public static List<DisciplineAction> ActiveDiscipline(AppState s, int loadsNow) =>
        s.Discipline
            .Where(d => d.Level is not ("Commendation" or "Termination"))
            .Where(d => d.ExpiresAfterLoads <= 0 || loadsNow - d.LoadCountAtIssue < d.ExpiresAfterLoads)
            .ToList();

    public static DisciplineAction Issue(AppState s, string level, string reason,
        string corrective, string incidentNumber, int expiresAfterLoads)
    {
        var code = string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;
        var action = new DisciplineAction
        {
            Number = $"{code}-DA-{s.Discipline.Count + 1:000}",
            Level = level,
            GameTime = s.Status.GameTime,
            IncidentNumber = incidentNumber,
            Reason = reason,
            CorrectiveAction = corrective,
            ExpiresAfterLoads = expiresAfterLoads > 0 ? expiresAfterLoads : 20,
            LoadCountAtIssue = s.Trips.Count(t => t.Status == "Delivered")
        };
        s.Discipline.Insert(0, action);

        if (!string.IsNullOrWhiteSpace(incidentNumber))
        {
            var inc = s.Incidents.FirstOrDefault(i => i.Number == incidentNumber);
            if (inc != null) inc.DisciplineNumber = action.Number;
        }

        s.Driver.Status = level switch
        {
            "Suspension" => "Suspended",
            "Termination" => "Terminated",
            _ => s.Driver.Status == "Suspended" ? "Active" : s.Driver.Status
        };

        // A downgrade is only real if the driver is actually moved out of the truck.
        if (level == "EquipmentDowngrade")
        {
            var order = EquipmentService.IssueDowngrade(s,
                $"{action.Number} — {reason}", restoreAfterLoads: 15);
            action.CorrectiveAction = order == null
                ? $"{corrective} (No lesser unit available to move you into, so this stands as a final warning.)"
                : $"{corrective} Equipment order {order.Number}: report to {order.TerminalLabel} and turn in " +
                  $"{order.FromTruckUnit} for {order.ToTruckUnit}. Fifteen clean loads earns it back.";
        }

        return action;
    }

    public static void Reinstate(AppState s, string note)
    {
        if (s.Driver.Status is "Suspended")
        {
            s.Driver.Status = s.Driver.Probation.Active ? "Probation" : "Active";
            s.Driver.Notes = $"{s.Driver.Notes} | Reinstated: {note}".Trim(' ', '|');
        }
    }

    public static SafetyRecord Record(AppState s)
    {
        var loadsNow = s.Trips.Count(t => t.Status == "Delivered");
        var driverFault = s.Incidents.Where(i => i.FaultAttribution == "Driver").ToList();
        return new SafetyRecord
        {
            TotalIncidents = s.Incidents.Count,
            DriverFault = driverFault.Count,
            DispatcherFault = s.Incidents.Count(i => i.FaultAttribution == "Dispatcher"),
            Mechanical = s.Incidents.Count(i => i.FaultAttribution == "Mechanical"),
            Unavoidable = s.Incidents.Count(i => i.FaultAttribution == "Unavoidable"),
            GameLimitation = s.Incidents.Count(i => i.FaultAttribution == "GameLimitation"),
            PreventableCollisions = s.Incidents.Count(i => i.Kind == "Collision" && i.Preventable),
            ActiveDiscipline = ActiveDiscipline(s, loadsNow),
            CurrentLevel = ActiveDiscipline(s, loadsNow) is { Count: > 0 } a
                ? Ladder[a.Max(x => Array.IndexOf(Ladder, x.Level))]
                : "Clear",
            NextStepIfPreventable = ActiveDiscipline(s, loadsNow) is { Count: > 0 } b
                ? Ladder[Math.Clamp(b.Max(x => Array.IndexOf(Ladder, x.Level)) + 1, 0, Ladder.Length - 1)]
                : "Coaching"
        };
    }
}

public class SafetyRecord
{
    public int TotalIncidents { get; set; }
    public int DriverFault { get; set; }
    public int DispatcherFault { get; set; }
    public int Mechanical { get; set; }
    public int Unavoidable { get; set; }
    public int GameLimitation { get; set; }
    public int PreventableCollisions { get; set; }
    public List<DisciplineAction> ActiveDiscipline { get; set; } = new();
    public string CurrentLevel { get; set; } = "Clear";
    public string NextStepIfPreventable { get; set; } = "Coaching";
}

// ==================================================================== career

public class CareerStats
{
    public int LoadsDelivered { get; set; }
    public int LoadsOnTime { get; set; }
    public int LoadsLate { get; set; }
    public int DriverFaultLate { get; set; }
    public double OnTimePct { get; set; }
    public double LoadedMiles { get; set; }
    public double DeadheadMiles { get; set; }
    public double TotalMiles { get; set; }
    public decimal CompanyRevenue { get; set; }
    public decimal DriverEarnings { get; set; }
    public decimal UnsettledPay { get; set; }
    public double AvgDamagePerTrip { get; set; }
    public double AvgRevenuePerLoadedMile { get; set; }
    public int Cancellations { get; set; }
    public int DriverFaultIncidents { get; set; }
    public int DaysEmployed { get; set; }
}

public class CareerReview
{
    public CareerStats Stats { get; set; } = new();
    public string Rank { get; set; } = "";
    public string RankTitle { get; set; } = "";
    public bool ProbationActive { get; set; }
    public List<RequirementProgress> ProbationProgress { get; set; } = new();
    public bool ProbationMet { get; set; }
    public string? NextRank { get; set; }
    public string? NextRankTitle { get; set; }
    public List<RequirementProgress> NextRankProgress { get; set; } = new();
    public bool NextRankMet { get; set; }
    public List<string> Findings { get; set; } = new();
    public List<string> AvailableActions { get; set; } = new();
    public SafetyRecord Safety { get; set; } = new();
}

public class RequirementProgress
{
    public string Label { get; set; } = "";
    public string Current { get; set; } = "";
    public string Required { get; set; } = "";
    public bool Met { get; set; }
    public double Pct { get; set; }
}

/// <summary>
/// What a driver is allowed to do about their own dispatch. A probationary driver runs what they
/// are assigned — that is the whole point of the arrangement — and freedom over freight selection
/// is something the ladder hands out as it is earned.
/// </summary>
public class DriverPrivileges
{
    /// <summary>Take a different feasible load off the board instead of the assigned one.</summary>
    public bool CanChooseAlternateLoad { get; set; }
    /// <summary>Ask operations for a different load. It is a request, not a decision.</summary>
    public bool CanRequestAlternate { get; set; }
    /// <summary>Commit a load that sits inside the safety buffer, as an explicit exception.</summary>
    public bool CanOverrideTightLoad { get; set; }
    /// <summary>Refuse an assignment outright.</summary>
    public bool CanRefuseLoad { get; set; }
    public string Summary { get; set; } = "";
}

public static class CareerService
{
    private record Rank(string Key, string Title, int Loads, double Miles, double OnTime,
        double MaxDamage, int MaxFaults, decimal LoadedCpm, decimal DeadheadCpm, string[] Unlocks, string Note);

    /// <summary>Freight-selection authority by rank.</summary>
    public static DriverPrivileges Privileges(AppState s) => s.Driver.Rank switch
    {
        "company" => new DriverPrivileges
        {
            CanRequestAlternate = true,
            Summary = "As a company driver you can ask operations for a different load, but the assignment is still dispatch's call."
        },
        "senior" => new DriverPrivileges
        {
            CanRequestAlternate = true, CanRefuseLoad = true,
            Summary = "Senior drivers may request an alternative and may refuse an assignment with a reason on record."
        },
        "lead" => new DriverPrivileges
        {
            CanRequestAlternate = true, CanRefuseLoad = true, CanChooseAlternateLoad = true,
            Summary = "Lead drivers pick from the cleared loads on the board."
        },
        "lease" => new DriverPrivileges
        {
            CanRequestAlternate = true, CanRefuseLoad = true, CanChooseAlternateLoad = true,
            CanOverrideTightLoad = true,
            Summary = "On a lease-purchase you carry the risk, so you choose your freight and may accept a tight window as your own call."
        },
        "owner" => new DriverPrivileges
        {
            CanRequestAlternate = true, CanRefuseLoad = true, CanChooseAlternateLoad = true,
            CanOverrideTightLoad = true,
            Summary = "Owner-operator: your truck, your freight decisions, within our operating authority."
        },
        _ => new DriverPrivileges
        {
            Summary = "Probationary drivers run the load they are assigned. Freight selection is not yours yet — clear probation and that changes."
        },
    };

    private static readonly Rank[] Ladder =
    {
        new("probationary", "Probationary Company Driver", 0, 0, 0, 100, 99, 0.54m, 0.44m,
            Array.Empty<string>(), "Starting position."),
        new("company", "Company Driver", 10, 6_000, 95, 5, 1, 0.60m, 0.48m,
            new[] { "Hazmat" }, "Probation cleared. Full freight access within your divisions and a rate bump."),
        new("senior", "Senior Company Driver", 35, 30_000, 96, 4, 1, 0.66m, 0.52m,
            new[] { "Oversize" }, "Trusted with tighter windows, high-value freight and oversize with a permit."),
        new("lead", "Lead Driver / Driver Trainer", 70, 65_000, 97, 3, 0, 0.72m, 0.56m,
            new[] { "Heavy Haul" }, "Newest tractor in the fleet, heavy haul access, and trainer pay."),
        new("lease", "Lease-Purchase Operator", 120, 120_000, 97, 3, 0, 1.28m, 1.05m,
            Array.Empty<string>(), "Lease-purchase on your tractor: you take fuel and maintenance, you keep far more per mile."),
        new("owner", "Owner-Operator", 200, 220_000, 98, 3, 0, 1.65m, 1.35m,
            Array.Empty<string>(), "Truck is yours. Percentage or per-mile settlement, and you choose your own freight within our authority.")
    };

    public static CareerStats Compute(AppState s)
    {
        var delivered = s.Trips.Where(t => t.Status == "Delivered").ToList();
        var freight = delivered.Where(t => t.Kind == "Freight").ToList();

        var st = new CareerStats
        {
            LoadsDelivered = freight.Count,
            LoadsOnTime = freight.Count(t => t.ServiceResult == "OnTime"),
            LoadsLate = freight.Count(t => t.ServiceResult == "Late"),
            DriverFaultLate = freight.Count(t => t.ServiceResult == "Late" && t.FaultAttribution == "Driver"),
            LoadedMiles = Math.Round(freight.Sum(t => t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles), 0),
            DeadheadMiles = Math.Round(delivered.Sum(t => t.DeadheadMiles) + delivered.Where(t => t.Kind != "Freight").Sum(t => t.ActualMiles), 0),
            CompanyRevenue = Math.Round(delivered.Sum(t => t.CompanyRevenue), 2),
            DriverEarnings = s.Driver.LifetimeEarnings,
            UnsettledPay = s.Driver.UnsettledPay,
            Cancellations = s.Trips.Count(t => t.Status == "Cancelled"),
            DriverFaultIncidents = s.Incidents.Count(i => i.FaultAttribution == "Driver" && i.Preventable)
        };

        st.TotalMiles = st.LoadedMiles + st.DeadheadMiles;
        st.OnTimePct = freight.Count > 0 ? Math.Round(st.LoadsOnTime * 100.0 / freight.Count, 1) : 100;
        st.AvgDamagePerTrip = freight.Count > 0
            ? Math.Round(freight.Average(t => Math.Max(0, t.TruckDamageAfter - t.TruckDamageBefore)), 2)
            : 0;
        st.AvgRevenuePerLoadedMile = st.LoadedMiles > 0
            ? Math.Round((double)st.CompanyRevenue / st.LoadedMiles, 3) : 0;

        var hired = GameClock.TryParse(s.Driver.HiredGameDate);
        var now = GameClock.TryParse(s.Status.GameTime);
        st.DaysEmployed = hired != null && now != null ? Math.Max(0, (int)(now.Value - hired.Value).TotalDays) : 0;

        return st;
    }

    public static void Recalculate(AppState s)
    {
        // Keeps the truck's roleplay odometer and the driver's damage snapshot honest after edits.
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit);
        if (truck != null) s.Status.TruckDamagePct = truck.DamagePct;
        var trailer = s.Trailers.FirstOrDefault(t => t.Unit == s.Driver.AssignedTrailerUnit);
        if (trailer != null) s.Status.TrailerDamagePct = trailer.DamagePct;
    }

    public static CareerReview Review(AppState s)
    {
        var stats = Compute(s);
        var review = new CareerReview
        {
            Stats = stats,
            Rank = s.Driver.Rank,
            RankTitle = s.Driver.RankTitle,
            ProbationActive = s.Driver.Probation.Active,
            Safety = SafetyService.Record(s)
        };

        if (s.Driver.Probation.Active)
        {
            var p = s.Driver.Probation;
            review.ProbationProgress.Add(Req("Loads delivered", stats.LoadsDelivered, p.RequiredLoads));
            review.ProbationProgress.Add(Req("Company miles", stats.TotalMiles, p.RequiredMiles, "N0"));
            review.ProbationProgress.Add(ReqPct("On-time service", stats.OnTimePct, p.RequiredOnTimePct));
            review.ProbationProgress.Add(ReqMax("Avg damage per trip", stats.AvgDamagePerTrip, p.MaxAvgDamagePct, "0.##", "%"));
            review.ProbationProgress.Add(ReqMax("Driver-fault incidents", stats.DriverFaultIncidents, p.MaxDriverFaultIncidents));
            review.ProbationMet = review.ProbationProgress.All(r => r.Met);

            review.Findings.Add(review.ProbationMet
                ? "Probation requirements are met. Operations can clear probation and move you to the Company Driver scale."
                : $"Probation is still open: {string.Join(", ", review.ProbationProgress.Where(r => !r.Met).Select(r => r.Label.ToLowerInvariant()))} outstanding.");
            if (review.ProbationMet) review.AvailableActions.Add("clear-probation");
        }

        var idx = Array.FindIndex(Ladder, r => r.Key == s.Driver.Rank);
        if (idx < 0) idx = 0;
        if (idx < Ladder.Length - 1)
        {
            var next = Ladder[idx + 1];
            review.NextRank = next.Key;
            review.NextRankTitle = next.Title;
            review.NextRankProgress.Add(Req("Loads delivered", stats.LoadsDelivered, next.Loads));
            review.NextRankProgress.Add(Req("Company miles", stats.TotalMiles, next.Miles, "N0"));
            review.NextRankProgress.Add(ReqPct("On-time service", stats.OnTimePct, next.OnTime));
            review.NextRankProgress.Add(ReqMax("Avg damage per trip", stats.AvgDamagePerTrip, next.MaxDamage, "0.##", "%"));
            review.NextRankProgress.Add(ReqMax("Driver-fault incidents", stats.DriverFaultIncidents, next.MaxFaults));
            review.NextRankMet = review.NextRankProgress.All(r => r.Met) && !s.Driver.Probation.Active;

            if (review.NextRankMet)
            {
                review.Findings.Add($"Eligible for promotion to {next.Title}: ${next.LoadedCpm:0.000}/loaded mi. {next.Note}");
                review.AvailableActions.Add("promote");
            }
            else if (!s.Driver.Probation.Active)
            {
                var missing = review.NextRankProgress.Where(r => !r.Met)
                    .Select(r => $"{r.Label.ToLowerInvariant()} ({r.Current} of {r.Required})");
                review.Findings.Add($"Toward {next.Title}: {string.Join(", ", missing)}.");
            }
        }
        else
        {
            review.Findings.Add("Top of the ladder — owner-operator. Nothing left for me to promote you into.");
        }

        if (review.Safety.CurrentLevel != "Clear")
            review.Findings.Add($"Active discipline on file: {review.Safety.CurrentLevel}. It ages off after the stated load count with clean running.");
        if (stats.LoadsLate > stats.DriverFaultLate)
            review.Findings.Add($"{stats.LoadsLate - stats.DriverFaultLate} of your {stats.LoadsLate} late load(s) were not your fault and do not count against you.");

        return review;
    }

    public static string ClearProbation(AppState s, bool force, string note)
    {
        var review = Review(s);
        if (!s.Driver.Probation.Active) return "Probation is already cleared.";
        if (!review.ProbationMet && !force)
            throw new InvalidOperationException("Probation requirements are not met. Override explicitly if operations is clearing it early.");

        s.Driver.Probation.Active = false;
        s.Driver.Probation.ClearedGameDate = s.Status.GameTime;
        s.Driver.Status = "Active";
        Promote(s, "company", note, force: true);
        return $"Probation cleared. {s.Driver.Name} moves to {s.Driver.RankTitle} at ${s.Driver.Pay.LoadedCpm:0.000}/loaded mile.";
    }

    public static string Promote(AppState s, string? targetRank, string note, bool force)
    {
        var idx = Array.FindIndex(Ladder, r => r.Key == s.Driver.Rank);
        if (idx < 0) idx = 0;
        var target = string.IsNullOrWhiteSpace(targetRank)
            ? (idx < Ladder.Length - 1 ? Ladder[idx + 1] : Ladder[idx])
            : Ladder.FirstOrDefault(r => r.Key == targetRank) ?? Ladder[Math.Min(idx + 1, Ladder.Length - 1)];

        if (target.Key == s.Driver.Rank) return $"Already at {target.Title}.";

        if (!force)
        {
            var review = Review(s);
            if (review.NextRank != target.Key || !review.NextRankMet)
                throw new InvalidOperationException($"Not eligible for {target.Title} yet. Promotions come from performance, not from asking.");
        }

        s.Driver.Rank = target.Key;
        s.Driver.RankTitle = target.Title;
        s.Driver.Pay.LoadedCpm = target.LoadedCpm;
        s.Driver.Pay.DeadheadCpm = target.DeadheadCpm;
        s.Driver.Pay.Notes = $"{target.Title} scale. {note}".Trim();

        if (target.Key is "senior" or "lead" or "lease" or "owner")
            s.Driver.Pay.WeeklyGuarantee = target.Key switch
            {
                "senior" => 1_250m, "lead" => 1_450m, _ => 0m
            };

        foreach (var unlock in target.Unlocks)
        {
            s.Driver.Restrictions.RemoveAll(r => r.Equals(unlock, StringComparison.OrdinalIgnoreCase));
            if (!s.Driver.Qualifications.Contains(unlock)) s.Driver.Qualifications.Add(unlock);
            if (unlock == "Heavy Haul" && !s.Company.Divisions.Contains("Heavy Haul"))
                s.Company.Divisions.Add("Heavy Haul");
        }

        // A better truck comes with rank — but as an order the driver carries out in the game, not a
        // silent reassignment. Only the player can actually move trucks in ATS.
        var upgrade = EquipmentService.IssueUpgrade(s, $"Promoted to {target.Title}.");
        if (upgrade != null)
            s.Driver.Notes = $"{upgrade.Number} issued: report to {upgrade.TerminalLabel} for unit {upgrade.ToTruckUnit}.";

        if (target.Key is "lease" or "owner")
            s.Driver.Pay.Notes += " Driver now carries fuel and maintenance cost on this unit — settlement rate reflects that.";

        return $"{s.Driver.Name} promoted to {target.Title}: ${target.LoadedCpm:0.000}/loaded mi, ${target.DeadheadCpm:0.000}/empty mi. {target.Note}";
    }

    // ---------------------------------------------------------------- terminal transfers

    /// <summary>
    /// A domicile change is a request, not a switch. Seniority, service record, whether the target
    /// yard has room, and whether the company wants a truck in that market all weigh on it. The
    /// outcome is derived from those inputs plus a stable per-request seed, so a driver cannot
    /// re-roll a "no" by asking again — only a change in circumstances moves the answer.
    /// </summary>
    public static TransferRequest RequestTransfer(AppState s, string terminalId, string reason)
    {
        var target = s.Company.Terminals.FirstOrDefault(t => t.Id == terminalId)
                     ?? throw new InvalidOperationException("That terminal is not one of ours.");
        if (s.Driver.HomeTerminalId == terminalId)
            throw new InvalidOperationException($"You are already domiciled at {target.City}.");

        var stats = Compute(s);
        var loads = stats.LoadsDelivered;
        var req = new TransferRequest
        {
            FromTerminalId = s.Driver.HomeTerminalId,
            ToTerminalId = target.Id,
            ToTerminalName = $"{target.City}, {target.State}",
            RequestedGameTime = s.Status.GameTime,
            Reason = reason ?? "",
            LoadCountAtRequest = loads
        };

        // Hard stop: probation is not the time to be moving people around.
        if (s.Driver.Probation.Active)
        {
            req.Outcome = "Denied";
            req.Decision = $"Not while you are on probation. Clear it and ask again — {target.City} is not going anywhere.";
            req.Factors.Add("Probationary drivers stay domiciled where they were hired.");
            s.Driver.Transfers.Insert(0, req);
            return req;
        }

        const int ProvenAfterLoads = 5;
        var score = 0;

        // Seniority. A domicile change is something you earn by running freight here.
        if (loads >= 60) { score += 30; req.Factors.Add($"{loads} loads delivered — solid seniority."); }
        else if (loads >= 25) { score += 18; req.Factors.Add($"{loads} loads delivered."); }
        else if (loads >= 10) { score += 8; req.Factors.Add($"{loads} loads delivered — still building seniority."); }
        else { score -= 10; req.Factors.Add($"Only {loads} load(s) with us. That is not enough time here to move your domicile."); }

        // Service and safety only count once there is enough history to judge. A perfect record
        // over zero loads is not a record.
        if (loads >= ProvenAfterLoads)
        {
            if (stats.OnTimePct >= 97) { score += 22; req.Factors.Add($"{stats.OnTimePct:0.#}% on-time service is excellent."); }
            else if (stats.OnTimePct >= 92) { score += 12; req.Factors.Add($"{stats.OnTimePct:0.#}% on-time service is acceptable."); }
            else { score -= 8; req.Factors.Add($"{stats.OnTimePct:0.#}% on-time service is below where we want it."); }

            if (stats.DriverFaultIncidents == 0) { score += 12; req.Factors.Add("Clean safety record."); }
            else { score -= stats.DriverFaultIncidents * 10; req.Factors.Add($"{stats.DriverFaultIncidents} driver-fault incident(s) on file."); }
        }
        else
        {
            req.Factors.Add($"Too early to judge your service — we want at least {ProvenAfterLoads} loads before a record counts for anything.");
            // A bad record still counts against you even early on; a good one just is not proven yet.
            if (stats.DriverFaultIncidents > 0)
            {
                score -= stats.DriverFaultIncidents * 10;
                req.Factors.Add($"{stats.DriverFaultIncidents} driver-fault incident(s) already on file.");
            }
        }

        // Room at the target yard
        var based = Migrations.TrucksBasedAt(s, target.Id);
        var room = Migrations.RoomAt(s, target);
        if (room <= 0) { score -= 35; req.Factors.Add($"{target.City} is at capacity — {based} of {target.TruckCapacity} slots used."); }
        else { score += 10; req.Factors.Add($"{target.City} has {room} of {target.TruckCapacity} slots open."); }

        // Does the company want a truck there?
        var market = Markets.Find(s, target.City, target.State);
        if (market?.Tier == 1) { score += 12; req.Factors.Add($"{target.City} is a tier-1 market — we can keep you loaded out of there."); }
        else if (market?.Tier == 3) { score -= 15; req.Factors.Add($"{target.City} is a thin market — harder to keep a truck busy from there."); }

        // Stable per-request nudge so the same ask cannot be re-rolled.
        var seed = StableSeed($"{s.Driver.Name}|{target.Id}|{loads}|{stats.DriverFaultIncidents}");
        score += seed % 21 - 10;

        if (score >= 55)
        {
            req.Outcome = "Approved";
            req.Decision = $"Approved. You are domiciled out of {target.City} effective now.";
            req.Effective = true;
            s.Driver.HomeTerminalId = target.Id;
        }
        else if (score >= 38)
        {
            req.Outcome = "Conditional";
            req.LoadsRequired = 10;
            req.Decision = $"Conditionally approved — run {req.LoadsRequired} more clean loads and {target.City} is yours. " +
                           "Come back to me then and I will make it effective.";
        }
        else if (score >= 22)
        {
            req.Outcome = "Deferred";
            req.LoadsRequired = 20;
            req.Decision = room <= 0
                ? $"Deferred. {target.City} has no slot right now. I will revisit it in about {req.LoadsRequired} loads."
                : $"Deferred. Not yet — ask again in about {req.LoadsRequired} loads.";
        }
        else
        {
            req.Outcome = "Denied";
            req.Decision = "Denied. Fix the record first — service and safety are what earn a domicile change here.";
        }

        s.Driver.Transfers.Insert(0, req);
        return req;
    }

    /// <summary>Makes a conditional transfer effective once the driver has run the loads asked for.</summary>
    public static string SettleConditionalTransfer(AppState s, string requestId)
    {
        var req = s.Driver.Transfers.FirstOrDefault(t => t.Id == requestId)
                  ?? throw new InvalidOperationException("No such transfer request.");
        if (req.Effective) return "That transfer is already in effect.";
        if (req.Outcome is not ("Conditional" or "Deferred"))
            throw new InvalidOperationException("That request was not left open.");

        var loadsSince = Compute(s).LoadsDelivered - req.LoadCountAtRequest;
        if (loadsSince < req.LoadsRequired)
            return $"Not yet — {loadsSince} of {req.LoadsRequired} loads run since you asked.";

        var target = s.Company.Terminals.FirstOrDefault(t => t.Id == req.ToTerminalId);
        if (target == null) throw new InvalidOperationException("That terminal is no longer ours.");

        req.Outcome = "Approved";
        req.Effective = true;
        req.Decision = $"Condition met after {loadsSince} loads. Domiciled out of {target.City} effective now.";
        s.Driver.HomeTerminalId = target.Id;
        return req.Decision;
    }

    private static int StableSeed(string text)
    {
        unchecked
        {
            var h = 17;
            foreach (var c in text ?? "") h = h * 31 + c;
            return Math.Abs(h);
        }
    }

    public static string AdjustPay(AppState s, decimal loadedCpm, decimal deadheadCpm, string reason)
    {
        var oldLoaded = s.Driver.Pay.LoadedCpm;
        if (loadedCpm > 0) s.Driver.Pay.LoadedCpm = loadedCpm;
        if (deadheadCpm > 0) s.Driver.Pay.DeadheadCpm = deadheadCpm;
        s.Driver.Pay.Notes = reason;
        return $"Pay adjusted from ${oldLoaded:0.000} to ${s.Driver.Pay.LoadedCpm:0.000}/loaded mile. {reason}";
    }

    private static RequirementProgress Req(string label, double current, double required, string fmt = "0.#")
    {
        var met = current >= required;
        return new RequirementProgress
        {
            Label = label,
            Current = current.ToString(fmt),
            Required = required.ToString(fmt),
            Met = met,
            Pct = required > 0 ? Math.Round(Math.Clamp(current / required, 0, 1) * 100, 0) : 100
        };
    }

    private static RequirementProgress ReqPct(string label, double current, double required)
    {
        var met = current >= required;
        return new RequirementProgress
        {
            Label = label,
            Current = $"{current:0.#}%",
            Required = $"{required:0.#}%",
            Met = met,
            Pct = required > 0 ? Math.Round(Math.Clamp(current / required, 0, 1) * 100, 0) : 100
        };
    }

    private static RequirementProgress ReqMax(string label, double current, double max, string fmt = "0.#", string suffix = "")
    {
        var met = current <= max;
        return new RequirementProgress
        {
            Label = label,
            Current = current.ToString(fmt) + suffix,
            Required = "≤ " + max.ToString(fmt) + suffix,
            Met = met,
            Pct = met ? 100 : 0
        };
    }
}
