using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How long a listing has left on the ATS market, and what that is allowed to change.
///
/// The board has always carried a delivery deadline — how long the load has once it is yours. It never
/// carried the other clock: how long the <b>offer</b> is on the market. So dispatch would authorize a
/// job with eleven hours to deliver and four minutes left on the board, and the driver drove to a pickup
/// that was not there any more.
///
/// Three rules, and the shape of them is deliberate:
///
/// <list type="number">
///   <item>A job offered where the truck is already standing cannot expire out from under anybody. No
///     gate at all — the driver is looking at it.</item>
///   <item>Under an hour, the driver decides. Not the app.</item>
///   <item>Half an hour or less, it never goes on the board.</item>
/// </list>
///
/// The thresholds are absolute on purpose, and this is the part worth defending. The obvious-looking
/// rule is "can they reach the pickup before it goes" — but the app knows which city the truck is in,
/// not where in it, not where on the road to it, and the deadhead figure is the driver's own estimate
/// typed off a listing. Judging reachability would be arithmetic on numbers the app cannot source, and
/// it would be wrong in the confident direction: refusing a load the driver was four minutes from, or
/// clearing one they had no chance at. A flat "under an hour, you tell me" is honest about what the app
/// can actually see.
/// </summary>
public static class BoardExpiry
{
    /// <summary>At or under this, the listing never reaches the board. Half an hour.</summary>
    public const double TooTightHours = 0.5;

    /// <summary>Under this and over <see cref="TooTightHours"/>, the driver is asked. One hour.</summary>
    public const double AskTheDriverHours = 1.0;

    /// <summary>
    /// Whether this listing is exempt from the whole question.
    ///
    /// A load off the "find other load from this location" list is being offered to a driver standing at
    /// the facility. There is no journey to the pickup to lose the race on.
    /// </summary>
    public static bool AtTheDoor(BoardLoad load) => load.AtLocation;

    /// <summary>
    /// Hours left on the listing, run down by however much game time has passed since it was read.
    /// Null when the listing did not say — which plans exactly as it always did.
    /// </summary>
    public static double? Remaining(AppState s, BoardLoad load)
    {
        if (load.ExpiresInHours <= 0) return null;

        // No anchor, or no clock to measure against: the figure stands as typed. Better a stale number
        // than pretending a load entered before this existed has been sitting there since the epoch.
        if (GameClock.TryParse(load.ListedAtGameTime) is not { } listedAt
            || GameClock.TryParse(s.Status.GameTime) is not { } now)
            return load.ExpiresInHours;

        // A clock that went backwards is the driver correcting a mistyped time, not time travel.
        var elapsed = Math.Max(0, (now - listedAt).TotalHours);
        return Math.Max(0, load.ExpiresInHours - elapsed);
    }

    /// <summary>
    /// Why this listing is too tight to be worth putting in front of anyone, or null.
    ///
    /// Used at two moments that look different and are the same rule: refusing the row as it is entered,
    /// and dropping a load that ran down to nothing while it sat on the board.
    /// </summary>
    public static string? TooTight(AppState s, BoardLoad load)
    {
        if (AtTheDoor(load)) return null;
        if (Remaining(s, load) is not { } left || left > TooTightHours) return null;

        return left <= 0
            ? $"That listing has run out — it was on the market for {Hhmm.Of(load.ExpiresInHours)} when you " +
              "read it and that has been and gone. It will not be there when you arrive."
            : $"Only {Hhmm.Of(left)} left on that listing. That is not enough to get to the pickup and I am " +
              "not sending you to an empty dock — find the next one.";
    }

    /// <summary>
    /// Why this listing is the driver's call rather than dispatch's, or null.
    ///
    /// The band between the floor and an hour. Dispatch will still plan it and still rank it; it simply
    /// says out loud what is left and that the driver is the one who knows whether they can make it.
    /// </summary>
    public static string? AskTheDriver(AppState s, BoardLoad load)
    {
        if (AtTheDoor(load)) return null;
        if (Remaining(s, load) is not { } left) return null;
        if (left <= TooTightHours || left >= AskTheDriverHours) return null;

        return $"{Hhmm.Of(left)} left on this listing. I cannot see where you are on the road, so whether " +
               $"you can reach {DispatchEngine.Place(load.OriginCity, load.OriginState)} in time is your " +
               "call — pass on it and I will move to the next one, and it costs you nothing.";
    }

    /// <summary>
    /// Whether the driver may decline this particular load whatever their rank.
    ///
    /// The one hole in freight selection being a privilege, and it is not really a hole. Passing on a
    /// listing that is about to disappear is not choosing your freight — it is declining to chase
    /// something that will not be there. A probationary driver runs the load they are assigned, and
    /// that stays true; it just cannot mean running at a job the app can see is evaporating.
    /// </summary>
    public static bool MayPassRegardlessOfRank(AppState s, BoardLoad load) =>
        !AtTheDoor(load) && Remaining(s, load) is { } left && left < AskTheDriverHours;

    /// <summary>Short countdown for a board card. Empty when the listing carried no expiry.</summary>
    public static string Countdown(AppState s, BoardLoad load) =>
        Remaining(s, load) is { } left ? Hhmm.Of(left) : "";
}
