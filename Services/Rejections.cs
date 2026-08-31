using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How many loads a driver may turn down in a week, and what happens when they run out.
///
/// The old rule was a switch: a probationary driver ran the load they were assigned, and everybody else
/// picked freely off the board. That made rank a cliff rather than a ladder — the promotion out of
/// probation handed over total freedom in one step, and no promotion after it changed anything at all.
///
/// An allowance is the better shape. Every rank gets a number of refusals a week, it grows as they
/// climb, and it is spent. A driver can turn down the first two loads on a board if they want, and then
/// live with what that costs them on Thursday. Running out is not a punishment, it is the end of the
/// latitude they had — dispatch's pick stands until Monday.
///
/// One refusal never counts, at any rank, including a probationary driver with an allowance of zero: a
/// load about to expire off the board. That is not preference, it is arithmetic, and refusing to let
/// somebody decline a job they cannot physically reach would be the app insisting on a fiction.
/// </summary>
public static class Rejections
{
    /// <summary>
    /// Refusals a week, by rank.
    ///
    /// Probation is zero deliberately — "run what you are given" is what probation MEANS here, and it is
    /// what makes the first promotion worth having. The steps widen at the top because that is where the
    /// latitude is supposed to be the reward for a career, not a starting condition.
    /// </summary>
    public static int WeeklyAllowance(string? rank) => (rank ?? "").Trim().ToLowerInvariant() switch
    {
        "company" => 1,
        "senior" => 2,
        "lead" => 3,
        "lease" => 5,
        "owner" => 8,
        _ => 0,          // probationary
    };

    /// <summary>The Monday on or before a game day. The week the allowance is counted against.</summary>
    public static int WeekStart(int day)
    {
        var d = Math.Max(0, day);
        return d - (d % 7);
    }

    /// <summary>Refusals already spent in the week containing the current game time.</summary>
    public static int SpentThisWeek(AppState s)
    {
        var today = GameClock.DayOf(s.Status.GameTime);
        if (today == null) return 0;
        var from = WeekStart(today.Value);
        return s.LoadRefusals.Count(r =>
            GameClock.DayOf(r.GameTime) is { } d && d >= from && d < from + 7 && !r.Free);
    }

    /// <summary>What is left this week. Never negative.</summary>
    public static int Remaining(AppState s) =>
        Math.Max(0, WeeklyAllowance(s.Driver.Rank) - SpentThisWeek(s));

    /// <summary>The day the allowance comes back, which is always a Monday.</summary>
    public static int? ResetsOnDay(AppState s)
    {
        var today = GameClock.DayOf(s.Status.GameTime);
        return today == null ? null : WeekStart(today.Value) + 7;
    }

    /// <summary>
    /// Whether this load can be turned down for free because it is going to expire.
    ///
    /// Always allowed, at every rank. See <see cref="BoardExpiry"/> for the window — the point is that a
    /// driver cannot be held to a job that will be off the board before they reach it, and making them
    /// spend an allowance on that would be charging them for the app's own arithmetic.
    /// </summary>
    public static bool IsFreeRefusal(AppState s, BoardLoad? load) =>
        load != null && BoardExpiry.MayPassRegardlessOfRank(s, load);

    /// <summary>
    /// Can this driver turn this load down right now, and what to tell them if not.
    /// </summary>
    public static (bool Allowed, string Reason) Check(AppState s, BoardLoad? load)
    {
        if (IsFreeRefusal(s, load))
            return (true, "That one is about to go off the board — passing on it costs you nothing.");

        var allowance = WeeklyAllowance(s.Driver.Rank);
        if (allowance == 0)
            return (false,
                "You are on probation. You run the load you are given — the only one you may turn down is one " +
                "that will expire before you can reach it. Clear probation and you get a say.");

        var left = Remaining(s);
        if (left <= 0)
        {
            var back = ResetsOnDay(s);
            return (false,
                $"You are out of refusals this week — {allowance} is what your rank carries, and they are gone. " +
                $"They come back Monday{(back is { } b ? $", day {b}" : "")}. Until then dispatch's pick stands, " +
                "unless a load is about to expire off the board.");
        }

        return (true, $"{left} refusal(s) left this week.");
    }

    /// <summary>Records a refusal against the week. Free ones are logged but do not count.</summary>
    public static LoadRefusal Record(AppState s, BoardLoad? load, string reason)
    {
        var free = IsFreeRefusal(s, load);
        var r = new LoadRefusal
        {
            GameTime = s.Status.GameTime,
            Cargo = load?.Cargo ?? "",
            Lane = load == null ? "" : $"{DispatchEngine.Place(load.OriginCity, load.OriginState)} → " +
                                       $"{DispatchEngine.Place(load.DestCity, load.DestState)}",
            Reason = reason,
            Free = free,
            RankAtTime = s.Driver.Rank,
        };
        s.LoadRefusals.Insert(0, r);
        // A career's worth of these is not worth carrying; the week is all that is ever read.
        if (s.LoadRefusals.Count > 200) s.LoadRefusals.RemoveRange(200, s.LoadRefusals.Count - 200);
        return r;
    }

    /// <summary>What the driver is shown about where they stand.</summary>
    public static object View(AppState s)
    {
        var allowance = WeeklyAllowance(s.Driver.Rank);
        var left = Remaining(s);
        var back = ResetsOnDay(s);
        return new
        {
            allowance,
            spent = SpentThisWeek(s),
            remaining = left,
            resetsOnDay = back,
            resetsOnWeekday = "Mon",
            summary = allowance == 0
                ? "On probation you run the load you are given. The one exception is a load that will expire " +
                  "before you can reach it, and that never counts against you."
                : left > 0
                    ? $"{left} of {allowance} refusal(s) left this week. They come back Monday" +
                      (back is { } b1 ? $", day {b1}." : ".")
                    : $"No refusals left this week. They come back Monday" +
                      (back is { } b2 ? $", day {b2}." : ".") +
                      " A load about to expire can still be passed on.",
        };
    }
}
