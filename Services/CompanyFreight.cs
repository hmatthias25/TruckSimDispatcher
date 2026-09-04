using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What this carrier runs, said before the driver reads a board rather than after they have typed
/// something in off it.
///
/// The check already existed — <c>"{division} is not a division this company operates"</c> — and it
/// fired at the wrong end. A driver opened the board in ATS, read forty jobs, picked one, entered it,
/// and only then found out their company does not haul that. That is a checker, not a dispatcher. The
/// slot to say it up front is the same one <see cref="Dedicated.BoardNote"/> uses to say which loads on
/// a board belong to the account.
///
/// <b>This is about the Freight Market only.</b> ATS has two, and they put a different question to the
/// driver:
///
///   * <b>Cargo Market</b> — you have a trailer, and the game only lists cargo that trailer can pull.
///     The company settled the division when it assigned the trailer, so every listing resolves to that
///     one division and this check cannot fail. Telling a driver hooked to a reefer that we run reefer
///     and dry van is noise about a choice they do not have.
///   * <b>Freight Market</b> — drop and hook, so the driver pulls whatever the shipper has and every
///     trailer on the lot is on offer. This is the only place they can hook something the company does
///     not run, and the only place the brief is worth anything.
///
/// <see cref="DispatchEngine.DivisionFor"/> already knew the difference. The first cut of this class did
/// not, read the listing's trailer type on both markets, and so gave a second and disagreeing answer to
/// a question the engine had already answered.
/// </summary>
public static class CompanyFreight
{
    /// <summary>
    /// What a division looks like on an ATS board. The inverse of
    /// <see cref="DispatchEngine.DivisionForTrailer"/>, and deliberately written from it — a driver
    /// reading a board sees a trailer and a cargo, never the word "division".
    /// </summary>
    public static string[] TrailersFor(string division) => (division ?? "").Trim() switch
    {
        "Dry Van" => new[] { "dry van", "curtainside" },
        "Reefer" => new[] { "reefer" },
        "Flatbed" => new[] { "flatbed", "step deck", "Conestoga" },
        "Heavy Haul" => new[] { "lowboy", "RGN", "oversize" },
        "Tanker" => new[] { "tanker", "pneumatic bulk" },
        "Auto" => new[] { "car hauler" },
        "Livestock" => new[] { "livestock" },
        "Log" => new[] { "log" },
        "Bulk" => new[] { "dump", "hopper" },
        "Intermodal" => new[] { "container chassis" },
        // Arrangements and credentials, not trailers. "Dedicated" describes who the freight belongs to
        // and "Hazmat" what is inside it — neither is something a driver can look for in a trailer
        // column, and listing them there would send somebody hunting a dedicated trailer.
        "Dedicated" or "Hazmat" or "Ag" => Array.Empty<string>(),
        "Pneumatic" => new[] { "pneumatic bulk" },
        "Step Deck" => new[] { "step deck" },
        "Lowboy" => new[] { "lowboy", "RGN" },
        "Hopper" => new[] { "hopper" },
        "" => Array.Empty<string>(),
        var v => new[] { v.ToLowerInvariant() },
    };

    /// <summary>Divisions this company runs, most-run first, blanks dropped.</summary>
    public static List<string> Divisions(AppState s) =>
        (s.Company.Divisions ?? new List<string>())
            .Where(d => !string.IsNullOrWhiteSpace(d))
            .ToList();

    /// <summary>Every trailer type the company's divisions cover, for matching against a listing.</summary>
    public static HashSet<string> Trailers(AppState s) =>
        Divisions(s).SelectMany(TrailersFor).ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The dispatch note. Two forms, because the driver needs different things at each moment: what to
    /// look for before they have read a board, and what they actually found once they have.
    /// </summary>
    public static string? BoardNote(AppState s)
    {
        // Silent on the Cargo Market. The game only lists what the assigned trailer can pull, so the
        // division was decided the day that trailer was hooked and there is nothing here to warn about.
        if (!DropHook.Active(s)) return null;

        var divisions = Divisions(s);
        if (divisions.Count == 0) return null;

        var kinds = divisions.SelectMany(TrailersFor).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var look = kinds.Count == 0 ? "" : $" That is {Join(kinds)}.";

        // ---- nothing entered yet: this is the moment the advice is worth anything
        if (s.Board.Count == 0)
            return $"The Freight Market will show you every trailer on the lot. {s.Company.Name} runs " +
                   $"{Join(divisions)}.{look} Hook one of those — anything else is somebody else's " +
                   "freight and I cannot authorise it, so there is no point writing it down.";

        // ---- something entered: say how much of it we can actually use
        var ours = s.Board.Count(b => Runs(s, b));
        if (ours == s.Board.Count) return null;         // all of it fits; saying so is noise

        return ours == 0
            ? $"None of this board is freight {s.Company.Name} runs — we are {Join(divisions)}.{look} " +
              "Go back and look again, or tell me the board is genuinely all off-division and I will " +
              "treat it as a dry market."
            : $"{ours} of {s.Board.Count} load(s) here are freight we run. The rest is off-division and " +
              $"I will not authorise it — we are {Join(divisions)}.";
    }

    /// <summary>
    /// Whether a listing is freight this company would move at all.
    ///
    /// Through <see cref="DispatchEngine.DivisionFor"/> rather than off the listing directly, so this
    /// and the dispatch refusal cannot disagree. Read straight off <c>load.TrailerType</c> it answered
    /// the Cargo Market wrongly: there the division comes from the trailer the company assigned, not
    /// from whatever the driver typed in the trailer column.
    /// </summary>
    public static bool Runs(AppState s, BoardLoad load)
    {
        var divisions = Divisions(s);
        if (divisions.Count == 0) return true;

        // A drop-and-hook listing with no trailer type recorded is an unknown, not a violation. Judging
        // it would fail every blank row at a carrier that does not happen to run dry van, which is what
        // DivisionFor falls back to.
        if (DropHook.Active(s) && string.IsNullOrWhiteSpace(load.TrailerType)) return true;

        var division = DispatchEngine.DivisionFor(load, DispatchEngine.AssignedTrailer(s));
        return string.IsNullOrWhiteSpace(division)
               || divisions.Any(d => d.Equals(division, StringComparison.OrdinalIgnoreCase));
    }

    private static string Join(IReadOnlyList<string> xs) =>
        xs.Count switch
        {
            0 => "",
            1 => xs[0],
            2 => $"{xs[0]} and {xs[1]}",
            _ => $"{string.Join(", ", xs.Take(xs.Count - 1))} and {xs[^1]}",
        };
}
