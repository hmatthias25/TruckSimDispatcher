using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What a rank actually lets you do, in the driver's terms.
///
/// Clearing probation used to announce itself as <i>"Probation cleared. Moves to Company Driver at
/// $0.480/loaded mile."</i> — the pay, and nothing else. Every promotion after it did the same. The
/// driver was left to find out the rest by bumping into it: that they can now turn a load down, that
/// they can ask for a different trailer, that the review clock just went from a fortnight to two
/// months.
///
/// Every line here is <b>derived from the rule that enforces it</b>, never written out as prose.
/// <see cref="Rejections.WeeklyAllowance"/> is the authority on refusals and
/// <see cref="CareerService.Privileges"/> on freight authority, so editing either changes what the
/// driver is told. Hard-coded copy would have become a page of confident lies the first time somebody
/// touched the table — and a promise the app does not keep is worse than saying nothing.
/// </summary>
public static class RankMeaning
{
    /// <summary>What changed between two rungs, and what is still not theirs.</summary>
    public static RankBriefing Compare(AppState s, string? fromRank, string toRank)
    {
        var b = new RankBriefing { Rank = toRank, Title = CareerService.RankTitle(toRank) };

        var wasProbation = string.IsNullOrWhiteSpace(fromRank)
                           || fromRank.Equals("probationary", StringComparison.OrdinalIgnoreCase);

        // ---- refusals, which is the one that changes the job most and was never mentioned
        var before = Rejections.WeeklyAllowance(fromRank);
        var now = Rejections.WeeklyAllowance(toRank);
        if (now > before)
            b.Gained.Add(before == 0
                ? $"You can refuse a load. {Count(now)} a week, with a reason that goes on the record — " +
                  "on probation it was none at all, and \"run what you are given\" was the whole of it."
                : $"Refusals go from {before} a week to {now}.");
        else if (now > 0)
            b.Kept.Add($"Still {Count(now)} refusal(s) a week.");

        // ---- freight authority, straight off the privileges table
        var had = CareerService.PrivilegesFor(fromRank);
        var has = CareerService.PrivilegesFor(toRank);
        if (has.CanRequestAlternate && !had.CanRequestAlternate)
            b.Gained.Add("You can ask operations for a different load. The assignment is still dispatch's call, but asking is yours now.");
        if (has.CanRefuseLoad && !had.CanRefuseLoad)
            b.Gained.Add("You can refuse an assignment outright with a reason on record.");
        if (has.CanChooseAlternateLoad && !had.CanChooseAlternateLoad)
            b.Gained.Add("You pick from the cleared loads on the board rather than being handed one.");
        if (has.CanOverrideTightLoad && !had.CanOverrideTightLoad)
            b.Gained.Add("You can call a tight window yourself. Your judgement on whether it is runnable, not ours.");

        // ---- equipment
        if (wasProbation)
        {
            b.Gained.Add("You can ask for a different trailer type on the Career tab.");
            b.Gained.Add("And you are in the running for a better tractor — operations will not move a " +
                         "probationary driver, so nothing standing on the property was ever offered to you before.");
        }

        // ---- the review clock
        if (wasProbation)
            b.Gained.Add($"Reviews change. Probation was every {Probation.ReviewIntervalDays} days at the yard; " +
                         $"from here it is a periodic review roughly every {PeriodicReview.IntervalDays} days.");

        // ---- money
        if (s.Driver.Pay.WeeklyGuarantee > 0)
            b.Gained.Add($"There is a weekly guarantee behind you now: ${s.Driver.Pay.WeeklyGuarantee:N0}, " +
                         "whatever the freight does.");

        // ---- dedicated work, where the ladder reaches it
        if (!DropHook.RankAllowsDedicated(s) && CareerService.RankIndex(toRank) < CareerService.RankIndex(Carriers.CeilingRank(s)))
            b.Still.Add("Dedicated drop and hook is the top of this carrier's ladder, and you are not on it yet.");

        // ---- and what has not changed, which matters as much
        if (!has.CanChooseAlternateLoad)
            b.Still.Add("Dispatch still decides what you run. You can ask; the answer can be no.");
        if (!has.CanRefuseLoad && now == 0)
            b.Still.Add("You cannot turn work down yet.");

        b.Summary = has.Summary;
        return b;
    }

    private static string Count(int n) => n == 1 ? "One" : $"{n}";
}

/// <summary>What a rung means, assembled from the rules that enforce it.</summary>
public class RankBriefing
{
    public string Rank { get; set; } = "";
    public string Title { get; set; } = "";
    /// <summary>Things the driver can do now that they could not yesterday.</summary>
    public List<string> Gained { get; set; } = new();
    /// <summary>Things that carried over unchanged.</summary>
    public List<string> Kept { get; set; } = new();
    /// <summary>And what is still not theirs, so the latitude is not overread.</summary>
    public List<string> Still { get; set; } = new();
    public string Summary { get; set; } = "";
}
