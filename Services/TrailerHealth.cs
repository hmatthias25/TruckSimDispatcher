using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Whether each trailer on the books is worth keeping, judged on what ATS actually reports about one.
///
/// <para>ATS keeps three lifetime figures per trailer — <b>Distance on Job</b>, <b>Cargo transported</b>
/// and <b>Weight transported</b> — plus a utilisation percentage in the Trailer Manager. Between them
/// they answer the only two questions worth asking about a box: has it done enough work to be tired, and
/// is it doing any work now.</para>
///
/// <para><b>Those are different problems and they take opposite answers.</b> A trailer that has run four
/// hundred thousand miles and is still busy is worn out — replace it, with the same thing, because it is
/// earning. A trailer sitting at eight per cent utilisation is not worn at all; it is money parked on a
/// yard, and replacing it with another of the same kind repeats the mistake. Reported from play as a
/// chemical tanker nobody runs.</para>
///
/// <para>No stars here. ATS rates a tractor's condition in stars; it does not do the same for a trailer,
/// and the app was leaning on a figure that had not earned the weight.</para>
/// </summary>
public static class TrailerHealth
{
    /// <summary>
    /// Distance past which a trailer has had a working life.
    ///
    /// Trailers outlast tractors by a long way — no engine, no driveline, and the things that wear are
    /// cheap. Four hundred thousand miles is a box that has paid for itself several times over and is
    /// into the years where the floor, the roof and the suspension start costing real money.
    /// </summary>
    public const double WornDistanceMi = 400_000;

    /// <summary>And the loads that usually go with it, for a box whose odometer nobody has reported.</summary>
    public const double WornLoads = 600;

    /// <summary>
    /// What one load cycle costs a trailer, expressed in miles.
    ///
    /// Distance alone is the wrong measure and was carrying the whole verdict. A load is a coupling, a
    /// set of ramps or straps, a forklift working the deck and a dock hit or two — real wear whatever the
    /// run length. Four hundred miles a load puts a busy short-haul box and a long-haul one on terms:
    /// nine hundred loads is worth about as much as the 360,000 mi it would take to do them at distance.
    /// </summary>
    public const double MilesPerLoad = 400;

    /// <summary>A normal trip, against which heavier and lighter work is measured.</summary>
    public const double NominalLoadLbs = 40_000;

    /// <summary>
    /// Distance, loads and weight as one figure: what this box has actually been through.
    ///
    /// Weight tells against the frame and the suspension directly — a trailer averaging 44,000 lb a trip
    /// is having a harder life than one averaging 20,000 — so it scales the miles rather than being added
    /// to them. Clamped either side, because no amount of light freight makes a trailer immortal and no
    /// amount of heavy freight wears one out in a season.
    /// </summary>
    public static double EffectiveMiles(Trailer t)
    {
        var dist = Math.Max(0, t.DistanceOnJobMi);
        var loads = Math.Max(0, t.LoadsTransported);
        var weight = Math.Max(0, t.WeightTransportedLbs);

        var avgLoad = loads > 0 ? weight / loads : 0;
        var heavy = avgLoad > 0 ? Math.Clamp(avgLoad / NominalLoadLbs, 0.7, 1.5) : 1.0;

        return dist * heavy + loads * MilesPerLoad;
    }

    /// <summary>
    /// Utilisation below which a trailer is not equipment, it is money standing still.
    ///
    /// Deliberately well under the player's own low-utilisation warning: this is not "keep an eye on it",
    /// it is "sell it". A box working a quarter of the time is doing a job; one working a tenth is not.
    /// </summary>
    public const double IdleUtilisationPct = 15;

    /// <summary>How many reports it has to look like that before the company acts on it.</summary>
    public const int IdlePeriods = 2;

    /// <summary>
    /// What the company should buy instead, read off what its own fleet actually does.
    ///
    /// The whole point of the idle verdict: there is no sense replacing a chemical tanker nobody runs
    /// with another chemical tanker. The best answer available is the type the company is ALREADY
    /// keeping busy — that is a measurement rather than a guess, and it is the fleet's own.
    ///
    /// Anything the driver cannot legally pull is out. Recommending a fuel tanker to somebody without
    /// class 3 would reproduce the original complaint in a different colour.
    /// </summary>
    public static (string Type, string Subtype) BestEarningType(AppState s, Trailer exclude)
    {
        var pool = s.Trailers
            .Where(t => !t.Retired && !DropHook.Is(t.Type))
            .Where(t => !t.Unit.Equals(exclude.Unit, StringComparison.OrdinalIgnoreCase))
            .Where(t => t.UtilisationPct >= 0)
            .Where(t => Runnable(s, t))
            .ToList();

        if (pool.Count == 0) return ("", "");

        var best = pool
            .GroupBy(t => (t.Type, t.Subtype))
            .Select(g => new { g.Key, Util = g.Average(x => x.UtilisationPct), Count = g.Count() })
            .OrderByDescending(x => x.Util)
            .ThenByDescending(x => x.Count)
            .First();

        // Only worth naming if it is actually doing better than the thing being sold.
        return best.Util > IdleUtilisationPct ? (best.Key.Type, best.Key.Subtype) : ("", "");
    }

    /// <summary>
    /// Whether anybody at this company could legally pull this box.
    ///
    /// A tanker is gated on what goes IN it, not on the trailer — fuel is class 3, chemical class 8, gas
    /// class 2, and food-grade or dry-bulk need nothing at all. See <see cref="TrailerSpec.TankerKinds"/>.
    /// </summary>
    public static bool Runnable(AppState s, Trailer t)
    {
        if (!t.Type.Equals("Tanker", StringComparison.OrdinalIgnoreCase)) return true;

        var kind = TrailerSpec.TankerKinds
            .FirstOrDefault(k => k.Key.Equals(t.Subtype ?? "", StringComparison.OrdinalIgnoreCase));

        // An unnamed tanker subtype is treated as the harmless case rather than condemned on a blank.
        if (kind.Key == null || !kind.NeedsHazmat) return true;

        return s.Driver.Endorsements.Count > 0;
    }

    /// <summary>Builds a line for every trailer on the books, with the company's verdict on it.</summary>
    public static List<TrailerReportLine> Assess(AppState s)
    {
        var lines = new List<TrailerReportLine>();

        foreach (var t in s.Trailers.Where(x => !x.Retired && !DropHook.Is(x.Type)))
        {
            var line = new TrailerReportLine
            {
                Unit = t.Unit,
                Ref = t.Ref,
                Type = t.Type,
                Subtype = t.Subtype,
                UtilisationPct = t.UtilisationPct,
                DistanceOnJobMi = t.DistanceOnJobMi,
                LoadsTransported = t.LoadsTransported,
                WeightTransportedLbs = t.WeightTransportedLbs,
            };

            // Nobody can pull it. That outranks everything else — a box that cannot legally move is not
            // under-performing, it is not equipment at all.
            if (!Runnable(s, t))
            {
                line.Verdict = "Idle";
                line.Headline = $"{t.Ref} cannot be run — nobody here is cleared for what goes in it.";
                line.Evidence.Add($"A {TrailerSpec.Describe(t.Type, t.Subtype)} needs a hazmat class no " +
                                  "driver at this company holds, so it has never moved and will not.");
                var swap = BestEarningType(s, t);
                if (!string.IsNullOrWhiteSpace(swap.Type))
                {
                    line.ReplaceWithType = swap.Type;
                    line.ReplaceWithSubtype = swap.Subtype;
                    line.Evidence.Add($"Sell it and put the money into " +
                                      $"{TrailerSpec.Describe(swap.Type, swap.Subtype)} — that is what the " +
                                      "fleet is actually keeping busy.");
                }
                lines.Add(line);
                continue;
            }

            // Judged on everything the box has done, not on the odometer alone.
            var effective = EffectiveMiles(t);
            var worn = effective >= WornDistanceMi
                       || (t.DistanceOnJobMi < 0 && t.LoadsTransported >= WornLoads);
            var idle = t.UtilisationPct >= 0
                       && t.UtilisationPct < IdleUtilisationPct
                       && t.IdlePeriods >= IdlePeriods;

            // Idle is judged first. A box that is both tired and unused is still a box nobody wants, and
            // telling somebody to replace it like for like would be the wrong half of the answer.
            if (idle)
            {
                line.Verdict = "Idle";
                line.Headline = $"{t.Ref} is not earning — {t.UtilisationPct:0}% utilisation.";
                line.Evidence.Add($"{t.UtilisationPct:0}% utilisation across {t.IdlePeriods} report(s). " +
                                  "That is not a trailer working badly, it is money parked on a yard.");
                if (t.LoadsTransported >= 0)
                    line.Evidence.Add($"{t.LoadsTransported:N0} load(s) and " +
                                      $"{t.DistanceOnJobMi:N0} mi in its whole life.");

                var swap = BestEarningType(s, t);
                if (!string.IsNullOrWhiteSpace(swap.Type)
                    && !(swap.Type.Equals(t.Type, StringComparison.OrdinalIgnoreCase)
                         && (swap.Subtype ?? "").Equals(t.Subtype ?? "", StringComparison.OrdinalIgnoreCase)))
                {
                    line.ReplaceWithType = swap.Type;
                    line.ReplaceWithSubtype = swap.Subtype;
                    line.Evidence.Add($"If it is replaced at all, replace it with " +
                                      $"{TrailerSpec.Describe(swap.Type, swap.Subtype)}. Buying another " +
                                      $"{TrailerSpec.Describe(t.Type, t.Subtype)} repeats the mistake.");
                }
                else
                {
                    line.Evidence.Add("Nothing in the fleet is doing much better, so this is a question " +
                                      "about how many trailers the company needs rather than which kind.");
                }
            }
            else if (worn)
            {
                line.Verdict = "Worn";
                line.Headline = $"{t.Ref} has had a working life — time to plan its replacement.";
                if (t.DistanceOnJobMi >= 0)
                    line.Evidence.Add($"{t.DistanceOnJobMi:N0} mi on the job, {t.LoadsTransported:N0} load(s), " +
                                      $"{t.WeightTransportedLbs / 2000.0:N0} ton(s) moved.");

                // Say the working, because "worn out" on a box showing 180,000 mi reads as wrong unless
                // the loads and the weight behind it are on the page too.
                var avg = t.LoadsTransported > 0 ? t.WeightTransportedLbs / t.LoadsTransported : 0;
                line.Evidence.Add($"That is about {effective:N0} mi of wear once the load cycles and an " +
                                  $"average trip of {avg:N0} lb are counted — our line is " +
                                  $"{WornDistanceMi:N0}.");
                line.Evidence.Add($"It is still working at {t.UtilisationPct:0}%, so replace it with the " +
                                  $"same thing — a {TrailerSpec.Describe(t.Type, t.Subtype)} is what this " +
                                  "company keeps busy.");
                line.ReplaceWithType = t.Type;
                line.ReplaceWithSubtype = t.Subtype;
            }
            else
            {
                line.Verdict = "Keep";
                line.Headline = t.UtilisationPct >= 0
                    ? $"{t.Ref} — {t.UtilisationPct:0}% utilisation, nothing owing."
                    : $"{t.Ref} — nothing owing.";
            }

            lines.Add(line);
        }

        return lines
            .OrderBy(x => x.Verdict == "Keep" ? 2 : x.Verdict == "Worn" ? 1 : 0)
            .ThenBy(x => x.Unit)
            .ToList();
    }
}
