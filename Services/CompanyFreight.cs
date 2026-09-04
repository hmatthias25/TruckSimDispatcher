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
        var divisions = Divisions(s);
        if (divisions.Count == 0) return null;

        var kinds = divisions.SelectMany(TrailersFor).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var look = kinds.Count == 0 ? "" : $" On the board that is {Join(kinds)}.";

        // ---- nothing entered yet: this is the moment the advice is worth anything
        if (s.Board.Count == 0)
            return $"{s.Company.Name} runs {Join(divisions)}.{look} Anything else on that board is " +
                   "somebody else's freight and I cannot authorise it, so there is no point writing it down.";

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

    /// <summary>Whether a listing is freight this company would move at all.</summary>
    public static bool Runs(AppState s, BoardLoad load)
    {
        var divisions = Divisions(s);
        if (divisions.Count == 0) return true;

        var division = DispatchEngine.DivisionForTrailer(load.TrailerType);
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
