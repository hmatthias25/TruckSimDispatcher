using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Where a driver stands against a carrier's bar, and what that is worth this month.
///
/// Hiring used to be a threshold test and nothing else: clear every bar and you were hired with
/// certainty, miss one and you were refused with certainty. Two things were wrong with that.
///
/// A carrier <b>being picky could not actually be picky</b>. "Tightening" only raised the bars, so a
/// driver who cleared the raised bar walked in exactly as reliably as in a good month — and a carrier
/// having a rough quarter, taking only people they are sure about, is not describing a higher bar. It
/// is describing a choice between applicants.
///
/// And <b>being over-qualified was worth nothing</b>. Skills were only ever a gate, and only at
/// specialised outfits; at most of the board they were not consulted at all. Nothing anywhere rewarded
/// being the strongest applicant in the room.
///
/// So: <b>margin</b>. How far above the bar the driver actually sits, across everything the carrier
/// asks about. Clear margin is a guaranteed yes whatever the business is doing — a driver who is
/// demonstrably better than they asked for can always work their way in, which is what keeps the
/// market something you can plan against. Only a marginal candidate is exposed to the roll, and the
/// odds on that roll are the carrier's condition.
///
/// Expanding cuts the other way, deliberately. A carrier winning freight and short of seated trucks
/// wants bodies in seats, so on top of the lowered bars it already runs, somebody short by a little on
/// one thing gets a look instead of an automatic no. That is the month a driver breaks into a carrier
/// above their record, and it should exist.
///
/// Seeded on driver, carrier and period — the same rule <see cref="Carriers.ConditionOf"/> holds
/// itself to. A refusal must not be re-rollable by reloading the market, only by running freight until
/// the calendar moves.
/// </summary>
public static class HiringStanding
{
    /// <summary>How a candidate reads against the bar.</summary>
    public const string Strong = "Strong";
    public const string Marginal = "Marginal";
    public const string Short = "Short";

    /// <summary>
    /// Not hiring at all this period. Deliberately its own value rather than folded into Short: a
    /// freeze says nothing about the driver, and reporting it as "you are short of what they want"
    /// would send somebody off to fix a record that was never the problem.
    /// </summary>
    public const string Closed = "Closed";

    /// <summary>Odds a MARGINAL candidate is taken, by what the carrier's quarter looks like.</summary>
    public static int ChanceFor(string conditionState) => conditionState switch
    {
        "Expanding" => 92,
        "Steady" => 75,
        "Tightening" => 45,
        _ => 0,                       // a freeze is refused before this is reached
    };

    /// <summary>
    /// Odds for a driver still serving probation somewhere else.
    ///
    /// Deliberately brutal, and it overrides the margin: a strong application from somebody three weeks
    /// into a probation they are already trying to leave is still an application nobody wants. This is
    /// most of what makes probation mean anything — without it a bad first fortnight costs nothing,
    /// because the driver simply walks across the road.
    /// </summary>
    public const int OnProbationChancePct = 10;

    /// <summary>
    /// Odds for somebody who misses one bar by a little. Only ever non-zero while expanding: that is
    /// what "short of seated trucks" means, and it is the only door open to a driver reaching above
    /// their record.
    /// </summary>
    public static int ReachChanceFor(string conditionState) =>
        conditionState == "Expanding" ? 55 : 0;

    /// <summary>
    /// Whether the driver clears each bar by a comfortable margin rather than by a hair.
    ///
    /// The margins are deliberately generous. This is the guarantee half of the mechanic, and a
    /// guarantee that almost nobody reaches is not a guarantee, it is a rounding error.
    /// </summary>
    public static bool ClearsComfortably(double credited, double minYears,
        int loads, int minLoads, double onTime, double minOnTime,
        int faults, int maxFaults, double damage, double maxDamage, bool skillsClear)
    {
        // A bar of zero is not something to clear comfortably — it is not a bar. Only the ones the
        // carrier actually set have to be beaten by a margin.
        var yearsOk = minYears <= 0 || credited >= minYears + 1;
        var loadsOk = minLoads <= 0 || loads >= minLoads * 1.4;
        var timeOk = minOnTime <= 0 || onTime >= minOnTime + 3;
        var faultsOk = faults < maxFaults || (maxFaults == 0 && faults == 0);
        var damageOk = maxDamage >= 100 || damage <= maxDamage * 0.8;

        return yearsOk && loadsOk && timeOk && faultsOk && damageOk && skillsClear;
    }

    /// <summary>
    /// What to tell the driver about where they stand, BEFORE they apply.
    ///
    /// The whole mechanic is only fair if it is visible in advance. A seeded refusal the driver never
    /// saw coming is a dice roll they were not told about; the same refusal after a plain warning is a
    /// risk they chose to take.
    /// </summary>
    public static string Explain(string standing, string conditionState, int chancePct,
        bool onProbation = false)
    {
        if (standing == Closed)
            return "They are not taking anyone on this period. Nothing to do with your record.";
        if (onProbation)
            return "You are still on probation where you are. Almost nobody will take a driver who has " +
                   $"not finished the last place — roughly {OnProbationChancePct}% here, whatever your " +
                   "record looks like. Clear it first.";
        return standing switch
        {
            Strong =>
                "You clear what they are asking for with room to spare. That is an offer whatever their " +
                "quarter looks like.",
            Marginal when conditionState == "Tightening" =>
                $"You meet their bar, but only just, and they are being picky this month — about {chancePct}% " +
                "either way. Another period, or a bit more history behind you, and it stops being a question.",
            Marginal when conditionState == "Expanding" =>
                $"You meet their bar. They are short of seated trucks, so that is about {chancePct}% in your " +
                "favour.",
            Marginal =>
                $"You meet their bar, but without much daylight — about {chancePct}%. More history would " +
                "settle it.",
            _ =>
                "You are short of what they are asking for.",
        };
    }

    /// <summary>
    /// The seeded roll. Stable for a driver, a carrier and a business period, so reloading the market
    /// cannot turn a no into a yes.
    /// </summary>
    public static bool Roll(AppState s, string code, int period, int chancePct)
    {
        if (chancePct <= 0) return false;
        if (chancePct >= 100) return true;
        var who = string.IsNullOrWhiteSpace(s.Driver.EmployeeId) ? s.Driver.Name : s.Driver.EmployeeId;
        return Hash($"{who}|{code}|{period}|hire") % 100 < (uint)chancePct;
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
