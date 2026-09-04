using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How much of a driver's experience was spent on the freight a carrier actually runs.
///
/// The hiring screen has always written its refusals as though it knew — "they want two years on
/// flatbed" — while <see cref="Carriers.CreditedExperience"/> answered with days served anywhere, on
/// anything. Two years of reefer credited as two years of flatbed, and a driver who had never thrown a
/// strap cleared an open-deck carrier's bar on van time. The sentence claimed a check nobody made.
///
/// <b>A credit, not a bar.</b> Total years still open the door. Division time decides the close calls —
/// the "you cleared it, but others cleared it by more" path that already existed. This matters: gating
/// on it would mean needing flatbed time to get a flatbed job, and a career that cannot be started is
/// not a harder game, it is a shorter one. A flatbed outfit prefers open-deck time and will still take
/// a strong van driver who wants to learn.
/// </summary>
public static class DivisionExperience
{
    /// <summary>
    /// Declared years a hiring office will take on trust for a division the driver says they ran.
    ///
    /// They will believe you have pulled a reefer. They will not believe a decade of it on your word
    /// alone — past this, they want to see it on a record. It is also what keeps the answer honest when
    /// somebody ticks every box on the application: naming all six divisions buys a two-year floor in
    /// each, which helps at a van carrier and never clears a five-year specialist.
    /// </summary>
    public const double DeclaredCapYears = 2.0;

    /// <summary>Division time that makes a carrier actively want you, in years.</summary>
    public const double StrongYears = 2.0;

    /// <summary>Enough to show you have done the work at all.</summary>
    public const double SomeYears = 0.5;

    /// <summary>Points added to a marginal application by real time on their freight.</summary>
    public const int StrongBonusPct = 20;
    public const int SomeBonusPct = 10;

    /// <summary>
    /// The canonical division name. Lives here rather than in the seeder because two places spelling
    /// "Open Deck" differently is how a driver's flatbed years stop counting as flatbed years.
    /// </summary>
    public static string Norm(string division) => (division ?? "").Trim() switch
    {
        "Refrigerated" or "Reefer" or "Frozen" => "Reefer",
        "Van" or "Dry Van" => "Dry Van",
        "Open Deck" or "Flatbed" or "Step Deck" or "Lowboy" => "Flatbed",
        "Bulk" or "Tanker" => "Tanker",
        "Oversize" or "Heavy Haul" or "Specialized" or "Specialised" => "Heavy Haul",
        "Car Hauling" or "Auto" => "Auto",
        "" => "Dry Van",
        var v => v,
    };

    /// <summary>
    /// Years credited on each division, best first.
    ///
    /// Two sources, weighted differently because they are worth different amounts. Time served is on
    /// the app's own record and counts in full. What the driver wrote on the application is their word
    /// for it, and is capped at <see cref="DeclaredCapYears"/>.
    /// </summary>
    public static Dictionary<string, double> Credited(AppState s)
    {
        var years = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        void Add(string division, double amount)
        {
            if (amount <= 0) return;
            var key = Norm(division);
            if (string.IsNullOrWhiteSpace(key)) return;
            years[key] = years.TryGetValue(key, out var had) ? had + amount : amount;
        }

        // ---- what they told us, on trust and capped
        var app = s.Application;
        var declared = Math.Min(app?.ExperienceYears ?? 0, DeclaredCapYears);
        foreach (var f in app?.FreightExperience ?? new List<string>())
            Add(f, declared);

        // ---- what we watched them do. Days at an employer count toward the freight that employer ran.
        foreach (var h in s.Driver.EmploymentHistory)
        {
            var from = GameClock.TryParse(h.StartedGameDate);
            var to = GameClock.TryParse(h.EndedGameDate);
            if (from == null || to == null) continue;
            var days = Math.Max(0, (to.Value - from.Value).TotalDays);
            Add(Carriers.PrimaryDivisionOf(h.CarrierCode), days / Carriers.DaysPerYear);
        }

        // ---- and the seat they are in now
        if (s.Onboarded)
        {
            var served = CareerService.Compute(s).DaysEmployed;
            // By code where we know the carrier, by what the company says it runs otherwise — a
            // custom outfit the player typed in still has divisions, and its driver still earns time.
            var now = Carriers.PrimaryDivisionOf(s.Company.Code);
            if (string.IsNullOrWhiteSpace(now)) now = s.Company.Divisions.FirstOrDefault() ?? "";
            Add(now, served / Carriers.DaysPerYear);
        }

        return years;
    }

    /// <summary>Years credited on one division.</summary>
    public static double YearsOn(AppState s, string division) =>
        Credited(s).TryGetValue(Norm(division), out var y) ? Math.Round(y, 2) : 0;

    /// <summary>
    /// What time on this carrier's freight is worth to a marginal application, and how to say it.
    ///
    /// Never negative. A driver with no open-deck time is not being marked down for it — they simply do
    /// not get the lift, which is the whole difference between a credit and a bar.
    /// </summary>
    public static (int Points, string? Note) Weigh(AppState s, string code)
    {
        var division = Carriers.PrimaryDivisionOf(code);
        if (string.IsNullOrWhiteSpace(division)) return (0, null);

        var y = YearsOn(s, division);
        var what = division.ToLowerInvariant();

        if (y >= StrongYears)
            return (StrongBonusPct,
                $"{y:0.#} years on {what} behind you. That is their freight, and it is the difference " +
                "between an application they have to think about and one they want.");

        if (y >= SomeYears)
            return (SomeBonusPct,
                $"{y:0.#} years on {what}. Not deep, but you have done the work, and they would rather " +
                "have that than not.");

        return (0, null);
    }

    /// <summary>The line the market shows about a carrier's freight, whether or not it helps.</summary>
    public static string? MarketNote(AppState s, string code)
    {
        var division = Carriers.PrimaryDivisionOf(code);
        if (string.IsNullOrWhiteSpace(division)) return null;

        var y = YearsOn(s, division);
        if (y >= SomeYears) return Weigh(s, code).Note;

        return $"Nothing on your record is {division.ToLowerInvariant()}. Not a bar here — they hire on " +
               "years and a record, and both count whatever you pulled to get them — but a driver with " +
               "their freight behind them goes in front of you when it is close.";
    }
}
