using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What a preventable costs while the driver is on probation.
///
/// Probation is the period a carrier is deciding whether to keep somebody, so an incident during it is
/// not just a rung on the discipline ladder — it is evidence in the decision that is coming. The
/// ladder still applies; this is what happens to the <b>period</b> on top of it.
///
/// Scaled to what the event actually did, because the alternative is what the app had: a 2% pole tap
/// and a 24% wreck both counting as "1 incident" against an allowance of 1, so the damage tiers scaled
/// the ladder and the review threw that away.
///
/// <b>Only preventables.</b> An incident the driver logged as unavoidable is a note on the record and
/// nothing else — no extension, no strike, no bearing on the review. If the AI ran a light, that is not
/// the driver's probation to serve.
/// </summary>
public static class ProbationConduct
{
    /// <summary>Days added for a light preventable, where the roll says it costs anything at all.</summary>
    public const int LightExtensionDays = 10;

    /// <summary>Days added for a moderate one. Always applied — there is no roll at this level.</summary>
    public const int ModerateExtensionDays = 21;

    /// <summary>Odds a light preventable costs days rather than a word. Not every scrape moves the date.</summary>
    public const int LightExtensionChancePct = 55;

    /// <summary>
    /// Weighted strikes that end the period. Three is out.
    ///
    /// A count of events was too blunt in the light direction: the second 2% scrape ending a career
    /// treats a bad month of parking as though it were a bad driver. Three strikes gives somebody room
    /// to be clumsy twice and still show they can do the job, which is what the period is for.
    ///
    /// Weighted rather than counted so it stays sharp in the other direction — the same severity table
    /// the review uses, so one idea is expressed once:
    ///
    /// <list type="bullet">
    ///   <item>three light scrapes = 1 + 1 + 1 = out on the third</item>
    ///   <item>a scrape and a real one = 1 + 2 = out on the second</item>
    ///   <item>two real ones = 2 + 2 = out on the second</item>
    ///   <item>a wreck does not get here at all — Serious and Major end it where they are judged</item>
    /// </list>
    /// </summary>
    public const int StrikeWeightOut = 3;

    /// <summary>What one event is worth against <see cref="StrikeWeightOut"/>.</summary>
    public static int WeightOf(string severity) => severity switch
    {
        "None" => 0,
        "Minor" => 1,
        "Moderate" => 2,
        _ => StrikeWeightOut,        // serious or major: on its own, past the line
    };

    /// <summary>What the company decided, in the driver's terms.</summary>
    public class Outcome
    {
        /// <summary>None | Warned | Extended | Terminated</summary>
        public string Kind { get; set; } = "None";
        public double DaysAdded { get; set; }
        public bool Strike { get; set; }
        public string Message { get; set; } = "";
    }

    /// <summary>
    /// Judges an incident against a running probation, applies it, and says what happened.
    ///
    /// Returns null where there is nothing to say — no probation, or an event that never counted.
    /// </summary>
    public static Outcome? Assess(AppState s, Incident inc)
    {
        if (!Probation.IsOn(s) || !s.Driver.Probation.Active) return null;
        if (inc.FaultAttribution != "Driver" || !inc.Preventable) return null;
        if (inc.Severity == "None") return null;              // under the noise floor, as everywhere

        var plan = s.Driver.Probation;

        // What is already against them THIS period, weighted the same way the review weighs it.
        //
        // Scoped to the period that is running. Strikes are what a carrier has seen while deciding
        // about this driver — an incident served out under a previous employer's probation, or a
        // previous period at this one, is on the safety record but is not one of these three. Without
        // the date bound a driver arriving with any history at all would start on their last strike.
        var since = GameClock.TryParse(plan.StartedGameDate)
                    ?? GameClock.TryParse(s.Driver.HiredGameDate);

        var priorWeight = s.Incidents
            .Where(i => i.Number != inc.Number && i.CountedOnProbation
                        && string.IsNullOrWhiteSpace(i.ForgivenGameTime))
            .Where(i => since == null
                        || (GameClock.TryParse(i.GameTime) is { } when && when >= since.Value))
            .Sum(i => WeightOf(i.Severity));
        var thisWeight = WeightOf(inc.Severity);
        var runningWeight = priorWeight + thisWeight;

        // ---- a wreck ends it outright. This is the case probation exists to catch.
        if (inc.Severity is "Serious" or "Major")
        {
            inc.CountedOnProbation = true;
            return End(s, inc,
                (inc.DamageIncurredPct >= 0
                    ? $"{inc.DamageIncurredPct:0.#}% damage on a preventable, during your probation."
                    : "A serious preventable, during your probation.") +
                " That is not something a carrier carries through a period they are already using to " +
                "decide about you.");
        }

        // ---- enough of them, and the pattern is the case
        if (runningWeight >= StrikeWeightOut)
        {
            inc.CountedOnProbation = true;
            var count = s.Incidents.Count(i => i.CountedOnProbation
                                               && string.IsNullOrWhiteSpace(i.ForgivenGameTime)
                                               && (since == null
                                                   || (GameClock.TryParse(i.GameTime) is { } w && w >= since.Value)));
            return End(s, inc,
                $"That is {count} preventable(s) in one probationary period. Any of them on their own would " +
                "have been survivable; the pattern is not, and a pattern is exactly what the period is for.");
        }

        // ---- moderate: always costs days
        if (inc.Severity == "Moderate")
        {
            inc.CountedOnProbation = true;
            return Extend(s, inc, ModerateExtensionDays,
                $"{inc.DamageIncurredPct:0.#}% and preventable. Not the end of it, but it does not pass without " +
                $"comment during a probation, and it counts for {thisWeight} against the {StrikeWeightOut} that " +
                "ends one.");
        }

        // ---- light: a judgement call, so it is one. Seeded on the incident, because a driver must not
        // be able to reload their way out of an answer they did not like.
        inc.CountedOnProbation = true;
        var left = StrikeWeightOut - runningWeight;
        var standing = left <= 1
            ? " One more of any size and you are done here."
            : $" You have room for {left} more like it; a heavier one counts for more.";

        if (Hash($"{inc.Number}|prob-extend") % 100 >= LightExtensionChancePct)
            return new Outcome
            {
                Kind = "Warned",
                Strike = true,
                Message = $"A preventable at {inc.DamageIncurredPct:0.#}% during your probation. Light enough that " +
                          "it is not moving your review — but it is on the record." + standing,
            };

        return Extend(s, inc, LightExtensionDays,
            $"A preventable at {inc.DamageIncurredPct:0.#}% during your probation. Light, but it happened while " +
            $"we were deciding about you.{standing}");
    }

    private static Outcome Extend(AppState s, Incident inc, int days, string why)
    {
        var plan = s.Driver.Probation;
        plan.DurationDays += days;
        plan.ExtendedDays += days;

        var ends = ProbationPlanner.EndsOn(s);
        var when = ends == null ? "" : $" Your review moves to {GameClock.Pretty(GameClock.Format(ends.Value))}.";

        return new Outcome
        {
            Kind = "Extended",
            DaysAdded = days,
            Strike = true,
            // Said in days, not left to be inferred from a date quietly changing.
            Message = $"{why} That is another {days} days on your probation.{when}",
        };
    }

    private static Outcome End(AppState s, Incident inc, string why)
    {
        // Built once and used for both. The reason on the driver's file and the message they are shown
        // have to be the same words — this set the file to the bare reason and the message to the
        // reason PLUS where to go next, so the one place a terminated driver looks was the one place
        // that did not tell them.
        var second = Carriers.IsSecondChance(s.Company.Code);
        var full = why + (second
            ? " This was the second-chance carrier, so there is nowhere further down to go. That is the career."
            : " A second-chance carrier will look past it. That is what they are for.");

        s.Driver.TerminatedForCause = true;
        s.Driver.TerminationReason = $"{inc.Number}: {full}";
        s.Driver.TerminatedGameTime = s.Status.GameTime;
        s.Driver.Rank = "terminated";
        s.Driver.Status = "Terminated";
        s.Driver.Probation.Active = false;

        return new Outcome { Kind = "Terminated", Strike = true, Message = full };
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }
}
