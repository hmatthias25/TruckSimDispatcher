using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What the fuel says about the driver, at review time.
///
/// <see cref="Fuel.Assess"/> has worked all of this out for a long time and had exactly one caller —
/// <see cref="PayEngine"/> — so it existed only on a settlement, after the period was over and the
/// money was already decided. A driver heard nothing while there was still time to do something about
/// it, and a driver whose pay scale carries no economy bonus at all never heard that either: they
/// simply waited for a bonus that was never coming.
///
/// Reviews are where ongoing feedback lives, so fuel goes where equipment already goes — see
/// <see cref="WearReview"/>, whose shape this deliberately copies so both reviews take it the same way.
///
/// <b>Two separate questions</b>, kept apart because they are different skills and a driver can be good
/// at one and poor at the other:
///
/// <list type="bullet">
///   <item><b>Economy</b> — how it was driven, against what the tractor is rated for. Not against the
///     driver's own average, which would raise the bar every time they did well.</item>
///   <item><b>Buying</b> — where it was bought, against the cheapest pump actually reachable on that
///     run. Never against a flat national price, which would mark somebody down for a lane dispatch
///     chose for them.</item>
/// </list>
///
/// Nothing here recomputes any of that. Two versions of the mpg and best-price arithmetic is how the
/// settlement and the review would end up telling a driver two different things about one tank.
/// </summary>
public static class FuelReview
{
    /// <summary>
    /// Gallons below which a period is not worth judging.
    ///
    /// A short period with one splash of fuel produces a confident-looking mpg from almost no data, and
    /// a review that opens with it teaches the driver to skim past the findings that matter.
    /// </summary>
    public const double MinimumGallonsToJudge = 150;

    /// <summary>
    /// How far under the tractor's rating counts as worth saying, as a share of the rating.
    ///
    /// Forgiving on purpose. Terrain, weight, weather and traffic move mpg either way, and a review that
    /// comments on ordinary variation is noise.
    /// </summary>
    public const double PoorEconomyShortfall = 0.08;

    /// <summary>Money saved on buying below which nothing is worth a mention either way.</summary>
    public const decimal WorthMentioning = 20m;

    /// <summary>What the fuel came to, and what is worth saying about it.</summary>
    public sealed class Assessment
    {
        public double Gallons { get; set; }
        public double Mpg { get; set; }
        public double RatedMpg { get; set; }
        public decimal Saved { get; set; }

        /// <summary>Too little fuel in the window to say anything honest about it.</summary>
        public bool TooLittleToJudge { get; set; }

        /// <summary>What the carrier pays for this, if anything. Said plainly so nobody waits on it.</summary>
        public bool PaysForEconomy { get; set; }
        public bool PaysForBuying { get; set; }

        public string? EconomyStrength { get; set; }
        public string? EconomyConcern { get; set; }
        public string? BuyingStrength { get; set; }
        public string? BuyingConcern { get; set; }

        /// <summary>Said once per review where a scale pays nothing, rather than every period forever.</summary>
        public string? ScaleNote { get; set; }
    }

    /// <summary>Judges the fuel bought and burned inside one review's window.</summary>
    public static Assessment Assess(AppState s, DateTime since, DateTime now)
    {
        var trips = s.Trips
            .Where(t => t.Status == "Delivered" && t.Kind == "Freight")
            .Where(t => GameClock.TryParse(t.DeliveredGameTime) is { } d && d > since && d <= now)
            .ToList();

        var f = Fuel.Assess(s, trips);
        var pay = s.Driver.Pay;

        var a = new Assessment
        {
            Gallons = f.Gallons,
            Mpg = f.Mpg,
            RatedMpg = f.RatedMpg,
            Saved = f.Saved,
            PaysForEconomy = pay.FuelEfficiencyBonusCpm > 0,
            PaysForBuying = pay.FuelSavingShare > 0,
        };

        if (f.Gallons < MinimumGallonsToJudge)
        {
            a.TooLittleToJudge = true;
            return a;
        }

        // ---- how it was driven
        var over = (f.Mpg - f.RatedMpg) / Math.Max(f.RatedMpg, 0.1);
        if (over > 0)
            a.EconomyStrength = $"{f.Mpg:0.00} mpg against {f.RatedMpg:0.0} rated — {over * 100:0.#}% better " +
                                "than the truck is supposed to do." +
                                (a.PaysForEconomy ? " That is what the economy bonus is for." : "");
        else if (over < -PoorEconomyShortfall)
            a.EconomyConcern = $"{f.Mpg:0.00} mpg against {f.RatedMpg:0.0} rated — {-over * 100:0.#}% under " +
                               "what the truck should return. Steady throttle and staying off the top of " +
                               "the speed limiter is most of it.";

        // ---- where it was bought
        if (f.Overpaid.Count > 0)
            a.BuyingConcern = f.Overpaid[0];
        else if (f.Saved >= WorthMentioning)
            a.BuyingStrength = $"${f.Saved:N0} saved buying fuel where it was cheapest on the run, across " +
                               $"{f.Gallons:N0} gal." +
                               (a.PaysForBuying ? " A share of that is yours." : "");

        // ---- and what the scale does about any of it
        //
        // The reported gap: a driver waiting on a bonus their pay scale does not carry, never told.
        if (!a.PaysForEconomy && !a.PaysForBuying)
            a.ScaleNote = "Nothing on this pay scale pays for fuel, either for economy or for buying it " +
                          "well. Worth knowing so you are not waiting on a bonus that is not coming — it " +
                          "still costs the company, and it is still noticed here.";
        else if (!a.PaysForEconomy)
            a.ScaleNote = "This scale pays for buying fuel well but not for economy, so good mpg shows up " +
                          "here and not on your settlement.";
        else if (!a.PaysForBuying)
            a.ScaleNote = "This scale pays for economy but takes no share on cheap fuel, so where you buy " +
                          "shows up here and not on your settlement.";

        return a;
    }

    /// <summary>Puts the findings where the rest of the review's reasoning goes.</summary>
    public static void Apply(Assessment a, List<string> strengths, List<string> concerns)
    {
        if (a.TooLittleToJudge) return;

        if (!string.IsNullOrEmpty(a.EconomyStrength)) strengths.Add(a.EconomyStrength);
        if (!string.IsNullOrEmpty(a.EconomyConcern)) concerns.Add(a.EconomyConcern);
        if (!string.IsNullOrEmpty(a.BuyingStrength)) strengths.Add(a.BuyingStrength);
        if (!string.IsNullOrEmpty(a.BuyingConcern)) concerns.Add(a.BuyingConcern);

        // Not a mark either way — it is a fact about the contract, not about the driver. It goes with
        // whichever side the period landed on so it reads as context rather than as a finding.
        if (string.IsNullOrEmpty(a.ScaleNote)) return;
        if (!string.IsNullOrEmpty(a.EconomyConcern) || !string.IsNullOrEmpty(a.BuyingConcern))
            concerns.Add(a.ScaleNote);
        else
            strengths.Add(a.ScaleNote);
    }
}
