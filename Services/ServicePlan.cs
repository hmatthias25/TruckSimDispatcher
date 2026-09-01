using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The service schedule the fleet is held to.
///
/// The app's own scheme is one number: a PM interval, and a unit is either due or it is not. That is
/// right for a career running stock ATS, where the game tracks a single condition figure and nothing
/// underneath it.
///
/// A career on the <b>GDC economy mod</b> is a different proposition. GDC publishes a service interval
/// guide with separate checkpoints — engine, tyres and suspension, driveline, chassis, and long-term
/// major reviews — each on its own mileage. Holding a truck to one blended number there throws away
/// most of what the player is being asked to manage.
///
/// So the schedule is a setting. Off, it behaves exactly as it always did. On, every unit carries a
/// service record per checkpoint.
///
/// <para><b>Standard or Severe is a duty cycle, not a season.</b> GDC is explicit about this: seasonal
/// wear tuning changes how fast condition develops, and does NOT move a truck onto the severe schedule.
/// Severe is for repeated heavy haul, construction, forestry, rough access, mountain work, high idle.
/// One setting for the career, and the app never infers it from the weather.</para>
///
/// <para><b>Mileage is not damage.</b> Also GDC's point, and worth keeping: a truck can reach a service
/// checkpoint with almost no repairable damage, and an impact can justify service long before the next
/// checkpoint. The schedule says when routine work is due; the damage reading says when something needs
/// attention sooner. They are separate signals and the app keeps them separate.</para>
/// </summary>
public static class ServicePlan
{
    /// <summary>One checkpoint from the guide, and what it is on each schedule.</summary>
    public record Checkpoint(
        string Key,
        string Name,
        double StandardMiles,
        double SevereMiles,
        string Represents,
        double StandardUpperMiles = 0,
        double SevereUpperMiles = 0,
        bool Milestone = false);

    /// <summary>
    /// The GDC Service Interval Recommendation Guide, as published.
    ///
    /// A pre-trip check is in the guide too and is deliberately not here: "before every trip" is not a
    /// mileage interval, it is the walk-around, and the app already has a pre-trip flow. Inventing a
    /// counter for it would turn a habit into a chore.
    ///
    /// Where the guide gives a range, the lower figure is when it comes due and the upper is where it
    /// is overrun — that is what a range means on a maintenance schedule.
    /// </summary>
    public static readonly List<Checkpoint> Gdc = new()
    {
        new("tirecheck", "Early tyre / alignment check", 15_000, 15_000,
            "An early look at tyres and alignment before the full service falls due.", 30_000, 15_000),
        new("engine", "Engine service", 45_000, 35_000,
            "Routine preventive maintenance and inspection for the engine."),
        new("tires", "Tyre / suspension / alignment service", 60_000, 45_000,
            "Tyre rotation and condition, alignment, shocks, steering and wheel-end work."),
        new("chassis", "Chassis and cabin/body inspection", 100_000, 100_000,
            "The slower condition effects of normal use and age.", 150_000, 100_000),
        new("driveline", "Transmission and driveline service", 150_000, 125_000,
            "Transmission and driveline preventive maintenance and inspection."),
        new("suspension", "Major suspension / ride-control review", 200_000, 150_000,
            "A deeper review of suspension and ride control.", Milestone: true),
        new("emissions", "Major engine / emissions review", 250_000, 250_000,
            "A long-term milestone for a deeper engine and emissions inspection.", 300_000, 250_000,
            Milestone: true),
        new("powertrain", "Major powertrain inspection", 500_000, 400_000,
            "The long-horizon powertrain milestone.", Milestone: true),
    };

    public static Checkpoint? Find(string key) =>
        Gdc.FirstOrDefault(c => c.Key.Equals(key, StringComparison.OrdinalIgnoreCase));

    /// <summary>Whether the GDC schedule is the one in force right now.</summary>
    public static bool GdcActive(AppState s) => s.Settings.Maintenance.UseGdcSchedule;

    /// <summary>
    /// The odometer every service decision counts against.
    ///
    /// <see cref="Truck.ServiceMiles"/>, because that is what the model says it is: the company's books,
    /// and the only figure any decision reads. <see cref="Truck.AtsOdometer"/> is a tape measure kept so
    /// the next game reading can be differenced against the last — it is optional on a fleet report
    /// line, and on a hired driver's tractor the player may never have entered one at all. Counting
    /// checkpoints against it read every such unit as zero miles since service, so nothing was ever due.
    /// </summary>
    public static double Odometer(Truck t) =>
        t.ServiceMiles > 0 ? t.ServiceMiles : Math.Max(0, t.AtsOdometer);

    /// <summary>
    /// What the tractor itself has on it: the game reading where there is one, the books otherwise.
    ///
    /// Deliberately not <see cref="Odometer"/>. Wear is a fact about the physical unit — a tractor
    /// bought used at 900,000 mi is worn out however few of those miles were run for us, and it is that
    /// one the shop refuses to rebuild. Miles <i>since a service</i> are a different question, and that
    /// one has to be counted on the books: they are the only continuous series, and a hired driver's
    /// unit may carry no game reading at all.
    /// </summary>
    public static double WearMiles(Truck t) =>
        t.AtsOdometer > 0 ? t.AtsOdometer : Math.Max(0, t.ServiceMiles);

    /// <summary>The interval for a checkpoint on a given unit's duty cycle.</summary>
    public static double IntervalFor(Checkpoint c, bool severe) => severe ? c.SevereMiles : c.StandardMiles;

    /// <summary>Where a checkpoint stops being "due" and starts being overrun. Zero when there is no range.</summary>
    public static double LimitFor(Checkpoint c, bool severe)
    {
        var upper = severe ? c.SevereUpperMiles : c.StandardUpperMiles;
        return upper > 0 ? upper : IntervalFor(c, severe);
    }

    /// <summary>
    /// Where a unit stands against every checkpoint.
    ///
    /// A unit with no service record at all is taken to have had the dealer baseline done at its current
    /// odometer — the guide's own rule for a used truck purchase. Anything else would open a career by
    /// declaring a freshly bought tractor two hundred thousand miles overdue.
    /// </summary>
    public static List<ServiceDue> Status(AppState s, Truck t)
    {
        var severe = s.Settings.Maintenance.SevereDuty;
        var odo = Odometer(t);
        var outp = new List<ServiceDue>();

        foreach (var c in Gdc)
        {
            var record = t.ServiceLog.FirstOrDefault(x => x.Key.Equals(c.Key, StringComparison.OrdinalIgnoreCase));
            var interval = IntervalFor(c, severe);
            var limit = LimitFor(c, severe);
            var done = record != null;

            if (c.Milestone)
            {
                // A one-off. Read against the odometer itself rather than against miles since a service,
                // because there is no previous one to count from — and anything the truck had already
                // passed before it joined the fleet counts as done, which is the guide's rule about a
                // used purchase carrying the dealer baseline.
                var passedBeforeUs = interval <= Baseline(t);
                outp.Add(new ServiceDue
                {
                    Key = c.Key,
                    Name = c.Name,
                    Represents = c.Represents,
                    Milestone = true,
                    IntervalMiles = interval,
                    LimitMiles = limit,
                    LastAtOdometer = record?.AtOdometer ?? 0,
                    MilesSince = Math.Round(odo, 0),
                    MilesUntilDue = Math.Round(interval - odo, 0),
                    Done = done || passedBeforeUs,
                    Due = !done && !passedBeforeUs && odo >= interval,
                    Overrun = !done && !passedBeforeUs && odo >= limit,
                });
                continue;
            }

            var lastAt = record?.AtOdometer ?? Baseline(t);
            var since = Math.Max(0, odo - lastAt);
            outp.Add(new ServiceDue
            {
                Key = c.Key,
                Name = c.Name,
                Represents = c.Represents,
                IntervalMiles = interval,
                LimitMiles = limit,
                LastAtOdometer = lastAt,
                MilesSince = Math.Round(since, 0),
                MilesUntilDue = Math.Round(interval - since, 0),
                Due = since >= interval,
                Overrun = since >= limit,
            });
        }

        // Overrun first, then whatever is closest to falling due. A milestone already behind you is not
        // news and sorts to the bottom.
        return outp
            .OrderByDescending(x => x.Overrun)
            .ThenBy(x => x.Done)
            .ThenBy(x => x.MilesUntilDue)
            .ToList();
    }

    /// <summary>
    /// The odometer a unit's schedule counts from when nothing has been recorded.
    ///
    /// GDC's guide says a used truck purchase assumes the dealer baseline service is complete, so the
    /// clock starts where the truck came onto the fleet rather than at zero.
    /// </summary>
    private static double Baseline(Truck t) =>
        t.BaselineOdometer > 0 && t.BaselineOdometer <= Odometer(t) ? t.BaselineOdometer : Odometer(t);

    /// <summary>Checkpoints a unit is at or past.</summary>
    public static List<ServiceDue> DueNow(AppState s, Truck t) =>
        Status(s, t).Where(x => x.Due && !x.Done).ToList();

    /// <summary>The checkpoint falling due soonest, or null when every one is behind this unit.</summary>
    public static ServiceDue? Next(AppState s, Truck t) =>
        Status(s, t).Where(x => !x.Done).OrderBy(x => x.MilesUntilDue).FirstOrDefault();

    /// <summary>
    /// Where a unit stands on service, in one line, in the language of the schedule actually in force.
    ///
    /// Everywhere the app used to print "every 25,000 mi (3,200 mi to go)" it was quoting a clock that
    /// nothing under GDC resets, on a page that might be showing eight checkpoints beside it. One line,
    /// one source, so the Fleet tab, the yard brief and the trip audit cannot disagree.
    /// </summary>
    public static string StandingLine(AppState s, Truck t)
    {
        if (!GdcActive(s))
        {
            var since = t.ServiceMiles - t.LastServiceMiles;
            var left = t.ServiceIntervalMiles - since;
            return left <= 0
                ? $"PM overdue by {-left:N0} mi — every {t.ServiceIntervalMiles:N0} mi"
                : $"PM in {left:N0} mi — every {t.ServiceIntervalMiles:N0} mi";
        }

        var due = DueNow(s, t);
        if (due.Count > 0)
        {
            var worst = due.OrderByDescending(d => d.MilesSince - d.IntervalMiles).First();
            var over = worst.MilesSince - worst.IntervalMiles;
            return $"{due.Count} checkpoint(s) due — {worst.Name.ToLowerInvariant()}" +
                   (over > 0 ? $", {over:N0} mi over" : "");
        }

        var next = Next(s, t);
        return next == null
            ? "Every checkpoint on the GDC schedule is behind this unit."
            : $"{next.Name} in {next.MilesUntilDue:N0} mi";
    }

    /// <summary>
    /// Records a checkpoint as done at an odometer reading.
    /// </summary>
    public static void MarkDone(Truck t, string key, double odometer)
    {
        var record = t.ServiceLog.FirstOrDefault(x => x.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
        if (record == null)
        {
            record = new ServiceRecord { Key = key };
            t.ServiceLog.Add(record);
        }
        record.AtOdometer = Math.Max(0, odometer);
    }

    /// <summary>
    /// Services everything due on a unit at once, which is how a fleet truck goes through the shop.
    ///
    /// A hired driver's tractor cannot be worked on piece by piece — the player is not there and ATS
    /// offers no such control — so when it goes in, everything that has come due gets done and the
    /// report says what. The player's own truck can be done a checkpoint at a time through a work order.
    /// </summary>
    public static List<ServiceDue> ServiceAll(Truck t, AppState s)
    {
        var did = DueNow(s, t);
        foreach (var d in did) MarkDone(t, d.Key, Odometer(t));
        return did;
    }

    /// <summary>
    /// Applies a staged schedule change, if one is waiting. Called when a fleet report is filed.
    ///
    /// Switching mid-period would re-date every unit against a different set of intervals while trucks
    /// are out working to the old one. The report is when fleet mileage is brought up to date, so it is
    /// the only moment the change can be applied to real readings rather than stale ones.
    /// </summary>
    public static string? ApplyPendingChange(AppState s)
    {
        var m = s.Settings.Maintenance;
        if (m.PendingGdcSchedule is not { } wanted || wanted == m.UseGdcSchedule)
        {
            m.PendingGdcSchedule = null;
            return null;
        }

        m.UseGdcSchedule = wanted;
        m.PendingGdcSchedule = null;

        if (!wanted)
            return "Maintenance is back on the single PM interval. The per-checkpoint history is kept in " +
                   "case you switch again.";

        var seeded = 0;
        var owing = 0;
        foreach (var t in s.Trucks.Where(x => !x.Retired))
        {
            SeedFromHistory(t);
            seeded++;
            if (DueNow(s, t).Count > 0) owing++;
        }

        return owing == 0
            ? $"Maintenance is now on the GDC service schedule. All {seeded} unit(s) start from the last " +
              "service each one actually had, and none of them owes anything yet."
            : $"Maintenance is now on the GDC service schedule. Clocks start from the last service each " +
              $"unit actually had, not from today — {owing} of {seeded} unit(s) already owe work, and the " +
              "yard does it on this report. That mileage was run before the schedule changed; the change " +
              "only makes it visible.";
    }

    /// <summary>
    /// Starts a unit's checkpoint clocks from the last service it actually had.
    ///
    /// The first cut started every clock at the current odometer instead, on the argument that nothing
    /// should be backdated into instant overdue. That was wrong, and wrong in the direction that hides
    /// work. The app already knows when each unit was last serviced — it is the same
    /// <see cref="Truck.LastServiceMiles"/> the single-interval schedule has always counted from — and
    /// throwing it away to declare every tractor freshly serviced is not declining to backdate, it is
    /// writing a service that never happened. A truck 160,000 mi past its last PM is overdue under
    /// GDC's intervals, and no reading of the guide makes it otherwise.
    ///
    /// Where there is no usable last service, the unit's baseline stands in, which is the guide's own
    /// rule about a used purchase carrying the dealer service as complete.
    /// </summary>
    /// <param name="overwrite">
    /// Replace checkpoint records that are already there. For the migration, whose whole job is to
    /// undo records written by the switch this replaces. Off for a live switch, so genuine history
    /// recorded since is left alone.
    /// </param>
    public static void SeedFromHistory(Truck t, bool overwrite = false)
    {
        var odo = Odometer(t);

        // A reading ahead of the odometer cannot be true of this unit — most often because it was taken
        // off the game rather than off the books, and the two never have to agree.
        var lastPm = t.LastServiceMiles > 0 && t.LastServiceMiles <= odo ? t.LastServiceMiles : 0;
        if (t.BaselineOdometer <= 0 || t.BaselineOdometer > odo)
            t.BaselineOdometer = lastPm > 0 ? lastPm : odo;

        var from = lastPm > 0 ? lastPm : Baseline(t);
        foreach (var c in Gdc.Where(c => !c.Milestone))
        {
            var have = t.ServiceLog.Any(x => x.Key.Equals(c.Key, StringComparison.OrdinalIgnoreCase));
            if (have && !overwrite) continue;
            MarkDone(t, c.Key, from);
        }
    }

    /// <summary>What a set of checkpoints costs, over and above the shop's intake.</summary>
    public static decimal CostOf(AppState s, IEnumerable<ServiceDue> items)
    {
        var m = s.Settings.Maintenance;
        decimal total = 0;
        foreach (var d in items)
        {
            // Long-horizon reviews are the expensive ones; a tyre check is not. Scaled off the interval
            // so the guide's own sense of proportion carries through rather than being retyped.
            var weight = (decimal)Math.Sqrt(Math.Max(1, d.IntervalMiles) / 15_000.0);
            total += Math.Round(m.CheckpointBaseCost * weight, 0);
        }
        return total;
    }
}

/// <summary>Where one checkpoint stands on one unit.</summary>
public class ServiceDue
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Represents { get; set; } = "";
    public double IntervalMiles { get; set; }
    /// <summary>Upper end of the guide's range, past which it is overrun rather than merely due.</summary>
    public double LimitMiles { get; set; }
    public double LastAtOdometer { get; set; }
    public double MilesSince { get; set; }
    public double MilesUntilDue { get; set; }
    public bool Due { get; set; }
    public bool Overrun { get; set; }
    /// <summary>A one-off review rather than a recurring service.</summary>
    public bool Milestone { get; set; }
    /// <summary>Set on a milestone already behind this unit — done, or passed before it joined us.</summary>
    public bool Done { get; set; }
}
