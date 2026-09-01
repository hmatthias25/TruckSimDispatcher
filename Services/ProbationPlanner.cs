using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How long a new employer's probation runs, and how many good reviews it takes.
///
/// It used to be three consecutive passes for everybody, forever, because <c>PassesToClear</c> was a
/// constant. Everything else in the plan scaled with history — loads, miles, days all halved for a
/// driver with 40 loads behind them — and the one dimension that did not became the binding
/// constraint. It also bound <b>backwards</b>:
///
/// <list type="bullet">
///   <item><b>Veteran:</b> 45 days at a review every 14 = three reviews available, three required.
///     Zero slack. A single non-pass resets the run and the plan cannot be completed at all.</item>
///   <item><b>Rookie:</b> 90 days = six reviews for the same three. Room to stumble twice.</item>
/// </list>
///
/// So the reward for a long clean record was a probation that could not survive one bad fortnight.
///
/// It also took no notice of which way the move went. Dropping to an easier carrier, moving sideways
/// to a peer, and stretching up to an outfit that wants five years and 96% on time all produced the
/// same probation. A carrier at the top of the market expects more and looks harder for longer; that
/// is most of what makes moving up feel like moving up.
///
/// So the plan comes from <b>the stretch</b>: how far the new carrier's bar sits above what this
/// driver has actually proven. And whatever the passes figure is, the window always leaves slack for
/// it — see <see cref="ReviewsAvailable"/>. Passes required must never equal reviews available.
/// </summary>
public static class ProbationPlanner
{
    /// <summary>Reviews the window allows, at one every <see cref="Probation.ReviewIntervalDays"/> days.</summary>
    public static int ReviewsAvailable(int durationDays) => durationDays / Probation.ReviewIntervalDays;

    /// <summary>Spare reviews a driver must have beyond the passes required, so one bad one is survivable.</summary>
    public const int SlackReviews = 2;

    /// <summary>
    /// The plan for joining <paramref name="code"/>, on what this driver has behind them.
    ///
    /// Three bands. <b>Reaching</b> is a carrier asking for more than the driver has proven — they get
    /// the longest look. <b>Comparable</b> is the ordinary move. <b>Established</b> is a driver whose
    /// record clears the new bar with real room, which includes stepping down.
    /// </summary>
    public static ProbationPlan For(AppState s, string code, string startedGameDate)
    {
        var stats = s.Onboarded ? CareerService.Compute(s) : new CareerStats();
        var loads = stats.LoadsDelivered + s.Driver.PriorLoads;
        var onTime = loads > 0 ? stats.OnTimePct : 100;
        var faults = (s.Onboarded ? SafetyService.CountingFaults(s).Count : 0) + s.Driver.PriorFaultIncidents;

        var bar = Carriers.StandardsOf(s, code);
        var credited = Carriers.CreditedExperienceFor(s);

        // Does this carrier want more than the driver has actually proven?
        var reaching =
            (bar.MinYears > 0 && credited < bar.MinYears + 1)
            || (bar.MinLoads > 0 && loads < bar.MinLoads * 1.4)
            || (bar.MinOnTime > 0 && onTime < bar.MinOnTime + 2)
            || (bar.MaxFaults == 0 && faults > 0)
            || Carriers.HasSkillShortfall(s, code);

        // Or does the record clear it with room to spare?
        var established = !reaching && loads >= 40
                          && (bar.MinOnTime <= 0 || onTime >= bar.MinOnTime + 4)
                          && faults <= bar.MaxFaults;

        int passes, days, reqLoads;
        double reqMiles;
        string note;

        if (reaching)
        {
            passes = 4;
            days = 105;
            reqLoads = 12;
            reqMiles = 7000;
            note = "Reaching above your record — they want more than you have proven, so they will look " +
                   "harder and for longer. Four good reviews in a row.";
        }
        else if (established)
        {
            passes = 2;
            days = 60;
            reqLoads = 5;
            reqMiles = 3000;
            note = $"Shortened on {loads} verified loads and a record that clears their bar with room. " +
                   "Two good reviews in a row.";
        }
        else
        {
            passes = 3;
            days = 90;
            reqLoads = 10;
            reqMiles = 6000;
            note = "Standard probation. Three good reviews in a row.";
        }

        return EnsureSlack(new ProbationPlan
        {
            Active = true,
            PassesRequired = passes,
            RequiredLoads = reqLoads,
            RequiredMiles = reqMiles,
            DurationDays = days,
            StartedGameDate = startedGameDate,
            Notes = note,
        });
    }

    /// <summary>
    /// Widens the window until it outlasts the passes it asks for, and says how much room that leaves.
    ///
    /// Every plan goes through here, however it was built. The trap was never the passes figure on its
    /// own — it was a window sized independently of it. The first hire had the same shape in miniature:
    /// 60 days at a review a fortnight is four reviews for three passes, so a single bad one left the
    /// driver needing three in a row from two remaining.
    /// </summary>
    public static ProbationPlan EnsureSlack(ProbationPlan plan)
    {
        if (plan.PassesRequired <= 0) plan.PassesRequired = Probation.PassesToClear;

        var need = (plan.PassesRequired + SlackReviews) * Probation.ReviewIntervalDays;
        if (plan.DurationDays < need) plan.DurationDays = need;

        var have = ReviewsAvailable(plan.DurationDays);
        plan.Notes = (plan.Notes ?? "").TrimEnd() +
                     $" {plan.PassesRequired} good review(s) in a row, and {have} reviews in the window — " +
                     "so a bad one is not the end of it.";
        return plan;
    }
}
