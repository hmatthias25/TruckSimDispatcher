using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What to call a piece of equipment when telling the player about it.
///
/// ATS gives every truck and trailer an ID that is visible in game, and that is the name the player can
/// actually read off the unit when they walk up to it. So where they have entered one, that is what the
/// app uses.
///
/// It is a <b>display name only</b>. The assigned unit number stays the key that work orders, trips and
/// driver assignments are filed against — a career file full of cross-references must not start breaking
/// because somebody typed a plate in.
/// </summary>
public static class Equip
{
    /// <summary>
    /// The label for a unit number, resolved through the fleet. Use this where only the number is in
    /// hand — on a work order, a retirement recommendation, a repair flag. Where the truck or trailer
    /// object itself is available, its own <c>Ref</c> is more direct.
    /// </summary>
    public static string Label(AppState s, string? unit)
    {
        var u = (unit ?? "").Trim();
        if (u.Length == 0) return "";

        var truck = s.Trucks.FirstOrDefault(t => t.Unit.Equals(u, StringComparison.OrdinalIgnoreCase));
        if (truck != null) return truck.Ref;

        var trailer = s.Trailers.FirstOrDefault(t => t.Unit.Equals(u, StringComparison.OrdinalIgnoreCase));
        if (trailer != null) return trailer.Ref;

        return u;      // retired, deleted, or never ours — the number is all we have
    }

    /// <summary>
    /// Checks a game ID is free before it is set.
    ///
    /// Two units sharing one ID would make the label ambiguous in exactly the situation it exists to
    /// resolve, so it is refused rather than silently allowed.
    /// </summary>
    public static void GuardGameId(AppState s, string? gameId, string ownUnit)
    {
        var id = (gameId ?? "").Trim();
        if (id.Length == 0) return;

        var clashTruck = s.Trucks.FirstOrDefault(t =>
            !t.Unit.Equals(ownUnit, StringComparison.OrdinalIgnoreCase) &&
            t.GameId.Trim().Equals(id, StringComparison.OrdinalIgnoreCase));
        if (clashTruck != null)
            throw new InvalidOperationException(
                $"Truck {clashTruck.Unit} already carries the game ID \"{id}\". Two units cannot share one.");

        var clashTrailer = s.Trailers.FirstOrDefault(t =>
            !t.Unit.Equals(ownUnit, StringComparison.OrdinalIgnoreCase) &&
            t.GameId.Trim().Equals(id, StringComparison.OrdinalIgnoreCase));
        if (clashTrailer != null)
            throw new InvalidOperationException(
                $"Trailer {clashTrailer.Unit} already carries the game ID \"{id}\". Two units cannot share one.");
    }
}
