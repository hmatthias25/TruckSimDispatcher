using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Things that happen to hired drivers, as opposed to things their numbers say about them.
///
/// <para>The fleet report already judges a driver on money — $/day and $/mile against the fleet — and puts
/// them on probation or lets them go for it. What it never had was <b>conduct</b>. Nobody backed into a
/// dock, nobody rolled one, nobody got a ticket. A fleet of a dozen drivers running for a game-year
/// without a single preventable is not a fleet, it is a spreadsheet.</para>
///
/// <para><b>This is world, not reading.</b> The app cannot see that Tom hit a bridge — ATS reports a level,
/// a rating and some money, and nothing else. So the incident is the company's own, seeded on the driver
/// and the report, and it is never dressed up as something the game said. Same standing as a receiver's
/// opening hours or a yard's queue: the app is allowed to furnish the world it runs, so long as it does
/// not pretend the game furnished it.</para>
///
/// <para><b>Rare, and graded.</b> Most periods nothing happens. When something does it is usually a scrape
/// and a word; occasionally it ends a career; very occasionally it writes a tractor off, which is a real
/// bill the player has to go and pay in ATS. A fleet where somebody totals a truck every fortnight would
/// be unplayable, and one where nothing ever happens is what this is fixing.</para>
/// </summary>
public static class DriverConduct
{
    /// <summary>
    /// Reports a driver has to have filed before conduct is judged at all.
    ///
    /// Four fortnights, so roughly two months on the job. A company that sacks somebody for a preventable
    /// before it has properly seen them work is not one anybody would drive for.
    /// </summary>
    public const int SettlingInReports = 4;

    /// <summary>
    /// Chance per driver per report that anything at all happens, by the level ATS gives them.
    ///
    /// A rookie is likelier to hit something than a veteran, which is the whole reason a developed driver
    /// is worth keeping. One flat rate for everybody made level a decoration.
    /// </summary>
    public static int IncidentPercentFor(int level) => level switch
    {
        <= 0 => 10,          // unreported; treat as a middling hand rather than the worst case
        1 or 2 => 16,
        3 or 4 => 12,
        5 or 6 => 9,
        7 or 8 => 7,
        _ => 5,
    };

    /// <summary>
    /// Of everything that happens, the share that is nobody's fault.
    ///
    /// Trucks get hit. A car crosses the centre line, somebody runs a light, a tyre lets go on the
    /// interstate. The company still has to replace the tractor and it still costs real money, but the
    /// driver did nothing and is not marked for it — a carrier that disciplines people for being hit
    /// loses the people worth keeping.
    /// </summary>
    public const int NotAtFaultPercent = 30;

    /// <summary>
    /// What share of what they bring in a driver is paid, by the level ATS gives them.
    ///
    /// A developed driver is worth more and knows it — that is the whole reason a level is interesting
    /// rather than decorative. A flat share for everybody said a level 9 and a rookie cost the company
    /// the same, which is why nobody was ever worth keeping in particular.
    ///
    /// Percentage pay, as a great many real carriers run it: a quarter of the load at the bottom, two
    /// fifths at the top. The player still sets a driver's share by hand if they want to — this only
    /// fills in what the company would offer.
    /// </summary>
    public static double ShareForLevel(int level) =>
        Math.Round(Math.Clamp(0.25 + 0.0175 * Math.Max(0, level - 1), 0.25, 0.40), 4);

    /// <summary>What a driver did, and what it costs them.</summary>
    public class Event
    {
        public string DriverId { get; set; } = "";
        public string DriverName { get; set; } = "";
        /// <summary>Minor | Serious | Terminal | WriteOff</summary>
        public string Severity { get; set; } = "Minor";
        public string What { get; set; } = "";
        public string Outcome { get; set; } = "";
        public string TruckUnit { get; set; } = "";
        public double DamagePct { get; set; }
    }

    private static readonly string[] Minor =
    {
        "clipped a dock post backing in",
        "kerbed a trailer tandem on a tight turn",
        "picked up a citation for a rolling stop",
        "took a low-clearance route and scraped the roof fairing",
        "misjudged a fuel island and took the mirror off",
    };

    /// <summary>Things that happen TO a driver. Nobody is disciplined for being hit.</summary>
    private static readonly string[] NoFault =
    {
        "was rear-ended at a red light",
        "had a car cross the centre line into them",
        "took a steer blowout on the interstate",
        "was hit by somebody running a light at an intersection",
        "had a load shift on them after a shipper loaded it badly",
        "came off worst in a hailstorm on the plains",
    };

    private static readonly string[] Serious =
    {
        "went into the back of a car in stopped traffic",
        "jack-knifed on a wet ramp",
        "took a bridge strike warning and kept going",
        "was cited for hours — logbook did not match the run",
        "dropped a trailer on its nose in a customer's yard",
    };

    /// <summary>
    /// Roll conduct for every active driver on this report.
    ///
    /// Seeded on the report and the driver, so reloading cannot re-roll somebody's career, and a period
    /// filed twice tells the same story.
    /// </summary>
    public static List<Event> Resolve(AppState s, FleetReport report)
    {
        var events = new List<Event>();

        foreach (var d in s.HiredDrivers.Where(x => x.Status == "Active").ToList())
        {
            // Nobody is judged on their first fortnight. A driver who has filed one period has barely
            // been out of the yard, and a company that sacks somebody for a preventable before it has
            // seen them work is not one anybody would drive for.
            //
            // It also keeps the roster still while a career is being set up — conduct firing on a
            // brand-new hire was reaching into scenarios that had nothing to do with it and quietly
            // changing who was on the books.
            if (d.ReportsFiled < SettlingInReports) continue;

            var seed = $"{s.Driver.EmployeeId}|conduct|{report.Number}|{d.Id}";
            if (Hash(seed) % 100 >= IncidentPercentFor(d.Level)) continue;

            // A better driver is less likely to make the worse kind of mistake. Level is the game's own
            // figure, reported by the player, so this leans on something real.
            var green = d.Level > 0 && d.Level <= 3;
            var roll = Hash(seed + "|grade") % 100;

            // Some of it is nobody's doing. Decided before the grade, because whose fault it was changes
            // what happens to the driver rather than how bad the damage is.
            var atFault = Hash(seed + "|fault") % 100 >= NotAtFaultPercent;

            var severity = !atFault
                ? (roll < 70 ? "NotAtFault" : "NotAtFaultWriteOff")
                : roll < (green ? 55 : 72) ? "Minor"
                : roll < (green ? 85 : 93) ? "Serious"
                : roll < (green ? 96 : 98) ? "Terminal"
                : "WriteOff";

            var ev = new Event { DriverId = d.Id, DriverName = d.Name, Severity = severity };
            var truck = s.Trucks.FirstOrDefault(t => t.Unit == d.AssignedTruckUnit);
            ev.TruckUnit = truck?.Unit ?? "";

            switch (severity)
            {
                // Hit by somebody else. The company pays; the driver does not.
                case "NotAtFault":
                    ev.What = NoFault[(int)(Hash(seed + "|what") % (uint)NoFault.Length)];
                    ev.DamagePct = 8 + (Hash(seed + "|dmg") % 22);
                    ev.Outcome = $"{d.Name} {ev.What}. Nothing on them — they were hit. " +
                                 (truck != null
                                     ? $"{truck.Ref} took {ev.DamagePct:0}% and wants a shop."
                                     : "The tractor wants a shop.");
                    Bump(s, truck, ev.DamagePct);
                    break;

                case "NotAtFaultWriteOff":
                    ev.What = NoFault[(int)(Hash(seed + "|what") % (uint)NoFault.Length)];
                    ev.DamagePct = 100;
                    ev.Outcome = truck != null
                        ? $"{d.Name} {ev.What}. Unit {truck.Ref} is a write-off — and none of it is theirs " +
                          $"to answer for, so {d.Name} keeps their job and their record. You will need to " +
                          "replace that tractor in ATS."
                        : $"{d.Name} {ev.What}. The tractor is a write-off and none of it is theirs to " +
                          "answer for.";
                    if (truck != null)
                    {
                        truck.DamagePct = 100;
                        truck.Status = "OutOfService";
                    }
                    break;

                case "Minor":
                    ev.What = Minor[(int)(Hash(seed + "|what") % (uint)Minor.Length)];
                    ev.DamagePct = 2 + (Hash(seed + "|dmg") % 5);
                    ev.Outcome = $"{d.Name} {ev.What}. A word and a note on the file — nothing that " +
                                 "follows them.";
                    Bump(s, truck, ev.DamagePct);
                    break;

                case "Serious":
                    ev.What = Serious[(int)(Hash(seed + "|what") % (uint)Serious.Length)];
                    ev.DamagePct = 10 + (Hash(seed + "|dmg") % 18);
                    PutOnProbation(s, d, report, $"{d.Name} {ev.What}.");
                    ev.Outcome = $"{d.Name} {ev.What}. That is a preventable — they are on probation, and " +
                                 "the next one ends it.";
                    Bump(s, truck, ev.DamagePct);
                    break;

                case "Terminal":
                    ev.What = Serious[(int)(Hash(seed + "|what") % (uint)Serious.Length)];
                    ev.DamagePct = 15 + (Hash(seed + "|dmg") % 25);
                    Bump(s, truck, ev.DamagePct);
                    FleetOpsService.Separate(s, d, "Terminated", $"Preventable: {ev.What}.");
                    ev.Outcome = d.OnProbation
                        ? $"{d.Name} {ev.What} — on probation already, so that is the job. Let go."
                        : $"{d.Name} {ev.What}. Bad enough on its own. Let go.";
                    break;

                default:  // WriteOff
                    ev.What = "rolled it";
                    ev.DamagePct = 100;
                    ev.Outcome = truck != null
                        ? $"{d.Name} {ev.What}. Unit {truck.Ref} is a write-off and {d.Name} is gone. " +
                          "You will need to replace that tractor in ATS — sell the wreck for what it " +
                          "fetches and buy the replacement."
                        : $"{d.Name} {ev.What} and is gone.";
                    if (truck != null)
                    {
                        truck.DamagePct = 100;
                        truck.Status = "OutOfService";
                    }
                    FleetOpsService.Separate(s, d, "Terminated", $"Wrote off {truck?.Ref ?? "a tractor"}.");
                    break;
            }

            events.Add(ev);
            report.Findings.Add(ev.Outcome);
        }

        return events;
    }

    /// <summary>Damage the company can see because one of its own drivers reported it.</summary>
    private static void Bump(AppState s, Truck? t, double pct)
    {
        if (t == null) return;
        t.DamagePct = Math.Clamp(t.DamagePct + pct, 0, 100);
    }

    /// <summary>
    /// Conduct probation, using the same machinery performance already uses.
    ///
    /// Deliberately the same thing rather than a parallel one: a driver on probation is on probation, and
    /// a company that ran two separate ladders — one for money, one for conduct — would be telling a
    /// driver they were fine and not fine at once.
    /// </summary>
    private static void PutOnProbation(AppState s, HiredDriver d, FleetReport report, string why)
    {
        if (d.OnProbation) return;
        // OnProbation is derived from ProbationSince — setting the date IS putting them on it.
        d.ProbationSince = report.PeriodEndGame;
        d.ProbationCount++;
        d.ProbationReason = why;
        d.ProbationTarget = "No further preventables, and the numbers to hold up alongside it.";
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }
}
