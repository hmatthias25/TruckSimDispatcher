using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// How a duty went, and what follows from it: timekeeping at every stop, the passengers' verdict, the grade, and the
/// discipline ladder from a verbal warning to dismissal.
/// </summary>
public static class Grading
{
    public const double OnTimeMinutes = 5, VeryLateMinutes = 15, EarlyGraceMinutes = 1;

    public record StopTiming(int Index, string Place, string Event, double DelayMinutes, string Status);

    /// <summary>
    /// Each stop's timekeeping. The first stop is judged on its departure, the others on arrival. Leaving a stop before
    /// the timetable says is an early departure, whatever the arrival was: passengers waiting for the time on their
    /// ticket are left behind, which is worse than arriving late.
    /// </summary>
    public static List<StopTiming> Timings(Duty d)
    {
        var list = new List<StopTiming>();
        for (var i = 0; i < d.Stops.Count; i++)
        {
            var s = d.Stops[i];
            var place = Lines.Place(s.City, s.Cc);
            if (i == 0)
            {
                if (GameClock.TryParse(s.ScheduledDepart) is { } sd && GameClock.TryParse(s.DepartedAt) is { } ad)
                    list.Add(Judge(i, place, "departure", (ad - sd).TotalMinutes));
                continue;
            }
            if (GameClock.TryParse(s.ScheduledArrive) is { } sa && GameClock.TryParse(s.ArrivedAt) is { } aa)
            {
                var t = Judge(i, place, "arrival", (aa - sa).TotalMinutes);
                // Early arrival is fine; the coach waits.
                if (t.DelayMinutes < 0) t = t with { Status = "OnTime" };
                list.Add(t);
            }
            if (i < d.Stops.Count - 1 && GameClock.TryParse(s.ScheduledDepart) is { } sd2 && GameClock.TryParse(s.DepartedAt) is { } ad2
                && (ad2 - sd2).TotalMinutes < -EarlyGraceMinutes)
                list.Add(new StopTiming(i, place, "departure", (ad2 - sd2).TotalMinutes, "EarlyDeparture"));
        }
        return list;
    }

    static StopTiming Judge(int i, string place, string ev, double delay)
    {
        var status = delay < -EarlyGraceMinutes && ev == "departure" ? "EarlyDeparture"
            : delay <= OnTimeMinutes ? "OnTime" : delay <= VeryLateMinutes ? "Late" : "VeryLate";
        return new StopTiming(i, place, ev, Math.Round(delay), status);
    }

    /// <summary>
    /// The passengers' verdict over the whole duty. Every stop is an end for the passengers who get off there, and the game's
    /// reading at a stop is of everyone aboard at that moment, so every stop counts the same: the duty's satisfaction is the
    /// average of them all. Passengers made angry at the second stop are not undone by a happy coach at the last. The worst
    /// stop is kept as well, and the grade looks at it (see <see cref="Grade"/>). The four groups give the index the same
    /// way; the complaints are the most very unhappy passengers seen at any one stop.
    /// </summary>
    public static (double Pct, double Index, int Complaints, DutyStop? Worst) Satisfaction(Duty d)
    {
        var stops = d.Stops.Skip(1).Where(s => s.SatisfactionPct != null).ToList();
        if (stops.Count == 0) return (0, 0, 0, null);
        var pct = stops.Average(s => s.SatisfactionPct!.Value);
        double Index(DutyStop s)
        {
            var total = s.VeryHappy + s.Happy + s.Unhappy + s.VeryUnhappy;
            return total == 0 ? 0 : (2.0 * s.VeryHappy + s.Happy - s.Unhappy - 2.0 * s.VeryUnhappy) / total;
        }
        var worst = stops.OrderBy(s => s.SatisfactionPct).First();
        return (Math.Round(pct, 1), Math.Round(stops.Average(Index), 2), stops.Max(s => s.VeryUnhappy), worst);
    }

    /// <summary>
    /// The grade. Excellent: every stop on time, no early departure, passengers at 85% or better over the duty and 80% at
    /// every stop, none very unhappy, within the hours. Poor: a stop more than 15 minutes late or an early departure,
    /// passengers under 60% over the duty or under 50% at any stop, two or more very unhappy, or an hours infringement.
    /// Bad: two of those timekeeping failures, passengers under 45% over the duty or under 35% at any stop, or two
    /// infringements. Lateness the driver could not help (the road, the game, the coach) is set aside; an early
    /// departure never is.
    /// </summary>
    public static string Grade(Duty d)
    {
        var excused = d.Fault != "Driver";
        var veryLate = excused ? 0 : d.VeryLateStops;
        var early = d.EarlyDepartures;
        var infringements = d.HoursFindings.Count;
        // The worst stop counts on its own: passengers driven to anger at one stop are a bad duty there, however the rest went.
        var worst = d.WorstSatisfaction;
        // Damage the driver caused, judged as the Dispatcher judges an incident: by what it did.
        var damage = d.DamageCause == "Driver" ? d.DamageSeverity : "None";
        if (veryLate + early >= 2 || d.FinalSatisfaction < 45 || worst < 35 || infringements >= 2 || damage is "Serious" or "Major") return "Bad";
        if (veryLate >= 1 || early >= 1 || d.FinalSatisfaction < 60 || worst < 50 || d.Complaints >= 2 || infringements >= 1 || damage == "Moderate") return "Poor";
        if (d.LateStops == 0 && d.VeryLateStops == 0 && early == 0 && d.FinalSatisfaction >= 85 && worst >= 80 && d.Complaints == 0 && infringements == 0
            && damage == "None")
            return "Excellent";
        return "Good";
    }

    public static string LevelName(int level) => level switch
    {
        1 => "Verbal warning", 2 => "Written reprimand", 3 => "Final warning", 4 => "Dismissed", _ => "Clean",
    };

    /// <summary>
    /// The discipline ladder. A poor duty is a strike, a bad one two and a step up the ladder at once. Three strikes take
    /// the level up a step: verbal warning, written reprimand, final warning, dismissal. Ten clean duties in a row take it
    /// down one. On probation, a written reprimand ends it. Returns what happened, for the close-out.
    /// </summary>
    public static List<string> Discipline(CoachCareer c, Duty d)
    {
        var said = new List<string>();
        var ds = c.Discipline;
        d.Strikes = d.Grade switch { "Bad" => 2, "Poor" => 1, _ => 0 };
        if (d.Strikes == 0)
        {
            ds.CleanRun++;
            if (ds.CleanRun >= 10 && ds.Level is > 0 and < 4)
            {
                ds.Level--;
                ds.CleanRun = 0;
                ds.StrikesSinceStep = 0;
                Entry(c, d, "Stepped down", $"Ten clean duties: back to {LevelName(ds.Level).ToLowerInvariant()}.");
                said.Add($"Ten clean duties in a row: your record steps down to {LevelName(ds.Level).ToLowerInvariant()}.");
            }
            return said;
        }

        return Strike(c, d.Number, d.Strikes, d.Grade == "Bad", $"{d.Grade} duty: {d.Strikes} strike{(d.Strikes > 1 ? "s" : "")}. {WhyGrade(d)}",
            WhyGrade(d), d.DamageCause == "Driver" && d.DamageSeverity == "Major");
    }

    /// <summary>
    /// Damage the driver did to the coach on an empty run: no duty to grade, so it is judged on its own, as the Dispatcher
    /// judges an incident. Moderate is a strike, Serious a step up the ladder, Major a final warning at once.
    /// </summary>
    public static List<string> EmptyRunDamage(CoachCareer c, MaintEntry e)
    {
        if (e.Severity is "None" or "Minor") return new();
        var why = $"The coach damaged {e.Incurred:0.#}% on an empty run.";
        return Strike(c, "Empty run", e.Severity == "Moderate" ? 1 : 2, e.Severity != "Moderate", $"{why} {Maintenance.SeverityMeans(e.Severity)}.", why, e.Severity == "Major");
    }

    /// <summary>
    /// Strikes on the record, and the step up the ladder they bring. A Major damage puts the driver on a final warning at
    /// once: one run can end the job.
    /// </summary>
    static List<string> Strike(CoachCareer c, string reference, int strikes, bool stepNow, string entry, string why, bool major)
    {
        var said = new List<string>();
        var ds = c.Discipline;
        ds.CleanRun = 0;
        ds.StrikesSinceStep += strikes;
        Entry(c, reference, "Strike", entry);
        var step = stepNow || ds.StrikesSinceStep >= 3;
        if (major) { ds.Level = Math.Max(ds.Level, 2); step = true; }
        if (!step)
        {
            said.Add($"A strike on your record ({ds.StrikesSinceStep} of 3). Three take you up a step; ten clean duties clear them.");
            return said;
        }

        ds.Level = Math.Min(4, ds.Level + 1);
        ds.StrikesSinceStep = 0;
        var co = Companies.Of(c);
        if (ds.Level >= 4 || (c.Job.OnProbation && ds.Level >= 2))
        {
            var probation = c.Job.OnProbation && ds.Level < 4;
            ds.Level = 4;
            Entry(c, reference, "Dismissal", major ? $"Dismissed: {why}" : probation ? "A written reprimand on probation: not kept on." : "After a final warning: dismissed.");
            Companies.Leave(c, co, probation ? "ProbationFailed" : "Dismissed",
                major ? $"Serious damage to the coach{(probation ? " during probation" : " after a final warning")}. {why}"
                : probation ? "A written reprimand during probation." : "Another failure after a final warning.");
            said.Add(major
                ? $"{co.Name(c)} has let you go: {why} Find another company on the Career tab."
                : probation
                ? $"{co.Name(c)} has let you go: a written reprimand during probation ends it. Find another company on the Career tab."
                : $"{co.Name(c)} has dismissed you after a final warning. Find another company on the Career tab.");
            return said;
        }
        var name = LevelName(ds.Level);
        Entry(c, reference, name, $"{name} after {reference}: {why}");
        said.Add(ds.Level switch
        {
            1 => "A verbal warning from the depot manager. It comes off after ten clean duties.",
            2 => "A written reprimand on your file. One more step is a final warning.",
            _ => "A final warning. One more step and you are dismissed.",
        });
        return said;
    }

    static void Entry(CoachCareer c, Duty d, string kind, string text) => Entry(c, d.Number, kind, text);
    static void Entry(CoachCareer c, string reference, string kind, string text) =>
        c.Discipline.Entries.Add(new DisciplineEntry { GameTime = c.GameTime, Duty = reference, Kind = kind, Text = text });

    /// <summary>The grade, said in a sentence.</summary>
    public static string WhyGrade(Duty d)
    {
        var parts = new List<string>();
        if (d.EarlyDepartures > 0) parts.Add($"{d.EarlyDepartures} early departure{(d.EarlyDepartures > 1 ? "s" : "")}");
        if (d.VeryLateStops > 0) parts.Add($"{d.VeryLateStops} stop{(d.VeryLateStops > 1 ? "s" : "")} more than 15 minutes late" + (d.Fault != "Driver" ? " (not your fault)" : ""));
        else if (d.LateStops > 0) parts.Add($"{d.LateStops} stop{(d.LateStops > 1 ? "s" : "")} a little late" + (d.Fault != "Driver" ? " (not your fault)" : ""));
        parts.Add($"passengers at {d.FinalSatisfaction:0}%");
        if (d.WorstStop.Length > 0 && d.WorstSatisfaction < 60 && d.WorstSatisfaction < d.FinalSatisfaction - 5)
            parts.Add($"{d.WorstSatisfaction:0}% at {d.WorstStop}");
        if (d.Complaints > 0) parts.Add($"{d.Complaints} very unhappy");
        if (d.HoursFindings.Count > 0) parts.Add($"{d.HoursFindings.Count} hours infringement{(d.HoursFindings.Count > 1 ? "s" : "")}");
        if (d.DamageCause == "Driver" && d.DamageSeverity != "None") parts.Add($"the coach damaged {d.DamageIncurred:0.#}%");
        var s = string.Join(", ", parts);
        return char.ToUpperInvariant(s[0]) + s[1..] + ".";
    }
}
