using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Drop and hook: no trailer of your own.
///
/// You take Freight Market jobs in ATS, pull the shipper's trailer, drop it at the receiver and hook
/// the next one. So there is no loading, no unloading and no trailer damage — the tractor is the only
/// thing on the property that belongs to the company.
///
/// <b>It is modelled as a trailer type</b>, and that is the whole trick. A driver on drop and hook has
/// a trailer record like anybody else, typed <c>Drop &amp; Hook</c>. Nothing downstream has to learn
/// about a driver with no trailer — <c>trailer == null</c> is a hard dispatch blocker with eighteen
/// call sites and fifty-one references behind it, and teaching all of them a second meaning of null
/// would have been a minefield. As a type it also inherits the assign, request and re-rig path for
/// free: you can be put on it for a tour and taken off again exactly like being moved off a reefer.
///
/// Two arrangements:
///
///   * <b>Open</b> — any receiver on the map. What most carriers offer.
///   * <b>Dedicated</b> — one ATS company and their freight only. Harder to run, because it makes
///     deadhead unavoidable, so it pays a premium and only the top of the ladder gets offered it.
///     Sought after in real life, and it should feel like it here.
/// </summary>
public static class DropHook
{
    public const string TrailerType = "Drop & Hook";

    /// <summary>Unit number for the standing drop-and-hook slot on a carrier's books.</summary>
    public const string Unit = "DH-1";

    /// <summary>
    /// Extra per loaded mile for a dedicated drop-and-hook arrangement.
    ///
    /// Sized against the existing premiums — reefer is 0.03, hazmat 0.04, oversize 0.06 — and set above
    /// all of them because this is the one a driver competes for rather than one the freight imposes.
    /// </summary>
    public const decimal DedicatedPremiumCpm = 0.08m;

    public static bool Is(string? trailerType) =>
        (trailerType ?? "").Trim().Equals(TrailerType, StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether the driver is on it right now.</summary>
    public static bool Active(AppState s) => Is(DispatchEngine.AssignedTrailer(s)?.Type);

    /// <summary>On it AND tied to one company.</summary>
    public static bool DedicatedActive(AppState s) => Active(s) && Dedicated.Active(s);

    /// <summary>
    /// The rank a dedicated drop-and-hook arrangement is open to: the top of this carrier's ladder.
    ///
    /// AT the ceiling, not near it. "Top two rungs" reads generously until you meet a carrier whose
    /// ladder stops at company driver — then a hire who cleared probation last week is in the top two,
    /// and the best seat in the fleet is handed to somebody on their first month. Whatever the ladder,
    /// this is the end of it.
    /// </summary>
    public static bool RankAllowsDedicated(AppState s)
    {
        if (Probation.IsOn(s)) return false;
        var ceiling = Carriers.CeilingRank(s);
        if (string.IsNullOrWhiteSpace(ceiling)) return s.Driver.Rank is "lease" or "owner";

        var top = CareerService.RankIndex(ceiling);
        var mine = CareerService.RankIndex(s.Driver.Rank);
        return top >= 0 && mine >= top;
    }

    /// <summary>
    /// Why the driver cannot have a dedicated drop-and-hook account, or null when they can.
    ///
    /// Said as a reason rather than a missing button: a thing worth wanting should be visibly out of
    /// reach and visibly reachable.
    /// </summary>
    public static string? DedicatedBlockedBecause(AppState s)
    {
        if (!Dedicated.CarrierRunsDedicated(s))
            return $"{s.Company.Name} does not run dedicated freight, so there is no account to put you on.";

        if (!RankAllowsDedicated(s))
            return "A dedicated drop-and-hook run is the best seat we have — steady freight, no dock work, " +
                   "and it pays over the top of your scale. It goes to the top of the ladder, and you are " +
                   "not there yet. Keep the record clean and it comes.";

        if (AtsCompanies.Candidates(s).Count == 0)
            return "There is nowhere to put you yet. A dedicated account has to be with a company you can " +
                   "actually reach, and nothing we haul is on the part of the map you have driven. Run more " +
                   "of the country and this opens up.";

        return null;
    }

    /// <summary>
    /// The standing instruction for a driver on drop and hook.
    ///
    /// The one thing they must not do is take a trailer, and ATS puts the two markets side by side —
    /// so it is said every time rather than once at assignment.
    /// </summary>
    public static string Instruction(AppState s)
    {
        var dedicated = Dedicated.Active(s) ? $" Only {s.Driver.DedicatedAccount} freight — nothing else is yours." : "";
        return "You are on drop and hook. Use the ATS <b>Freight Market</b>, not the Cargo Market, and do " +
               "not take a trailer of your own — you pull what the shipper has and drop it at the other " +
               "end." + dedicated;
    }

    /// <summary>Board note, said plainly rather than in markup.</summary>
    public static string? BoardNote(AppState s)
    {
        if (!Active(s)) return null;
        return Dedicated.Active(s)
            ? $"Drop and hook, dedicated to {s.Driver.DedicatedAccount}. Freight Market jobs only, and only " +
              "theirs. No trailer of your own — hook what is there, drop it at the other end."
            : "Drop and hook. Take these off the ATS Freight Market rather than the Cargo Market: you pull " +
              "the shipper's trailer and drop it at the receiver, so there is no loading and no unloading.";
    }

    /// <summary>
    /// The trailer record a carrier keeps for the arrangement.
    ///
    /// Not equipment. It exists so the driver has something to be assigned to, and so the request and
    /// re-rig path works on it like any other type. Never in an ATS garage, never damaged, never
    /// counted in utilisation — see the guards in FleetOpsService and Shop.
    /// </summary>
    public static Trailer Build(AppState s, string terminalId, string subtype = "") => new()
    {
        Unit = Unit,
        Type = TrailerType,
        Subtype = subtype,
        Length = "—",
        Division = string.IsNullOrWhiteSpace(subtype) ? "Drop & Hook" : subtype,
        Status = "InService",
        HomeTerminalId = terminalId,
        InGameGarage = false,
        DamagePct = 0,
        AcquiredGameTime = s.Status.GameTime,
        Notes = "Not a trailer we own. The arrangement: Freight Market jobs, the shipper's trailer, " +
                "dropped at the other end. Nothing to buy in ATS.",
    };

    /// <summary>Makes sure the carrier has the slot on its books, and returns it.</summary>
    public static Trailer Ensure(AppState s, string subtype = "")
    {
        var existing = s.Trailers.FirstOrDefault(t => Is(t.Type));
        if (existing != null)
        {
            // A carrier that hauls cars needs the slot marked so dispatch knows to offer auto freight
            // and nothing else. Never cleared here — an existing open arrangement is not narrowed by
            // somebody stocking a yard.
            if (!string.IsNullOrWhiteSpace(subtype) && string.IsNullOrWhiteSpace(existing.Subtype))
            {
                existing.Subtype = subtype;
                existing.Division = subtype;
            }
            return existing;
        }

        var yard = HomeTime.HomeTerminal(s) ?? s.Company.Terminals.FirstOrDefault();
        var made = Build(s, yard?.Id ?? "", subtype);
        s.Trailers.Add(made);
        return made;
    }

    /// <summary>
    /// Whether the arrangement is the car-hauling one, which only ever gets auto freight.
    ///
    /// There is no ownable car carrier in ATS, so a carrier with an auto division runs it the only way
    /// the game allows: market jobs pulling the shipper's transporter. Dispatch narrows the board to
    /// match, because the whole point of the arrangement is that the trailer waiting at the shipper is
    /// the right one.
    /// </summary>
    public static bool CarHaulingActive(AppState s) =>
        Active(s) && (DispatchEngine.AssignedTrailer(s)?.Subtype ?? "")
            .Trim().Equals(TrailerSpec.CarHauling, StringComparison.OrdinalIgnoreCase);
}
