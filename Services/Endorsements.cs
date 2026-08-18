using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What the driver is licensed to haul.
///
/// This used to be captured once on the job application and never again, so a driver who went and got
/// their hazmat had no way to tell the app — dispatch just kept refusing the freight. Endorsements are
/// a licence, and licences change.
///
/// <see cref="Driver.Endorsements"/> is the single source of truth. The application flags are kept in
/// step with it so nothing that reads either one disagrees, but the list is what is actually consulted.
///
/// Note this is NOT the qualifications list. Rank promotion writes company unlocks into that one, and
/// lifting the carrier's hazmat restriction is a different thing from the driver having sat the exam —
/// conflating them hands out an endorsement nobody earned. Nothing here is ever inferred: the app does not decide a driver has an
/// endorsement because they hauled something. They tell it, and it records that.
/// </summary>
public static class Endorsements
{
    public const string Hazmat = "Hazmat";
    public const string Tanker = "Tanker";
    public const string DoublesTriples = "Doubles/Triples";

    /// <summary>The ones that actually gate freight, with what having them opens up.</summary>
    public static readonly (string Key, string Label, string Unlocks)[] All =
    {
        (Hazmat, "Hazmat (H)",
            "placarded freight — explosives, corrosives, flammables, and the hazmat side of tanker work"),
        (Tanker, "Tanker (N)",
            "the tanker division: food-grade and dry-bulk straight away, and with hazmat alongside it, fuel, chemical and gas"),
        (DoublesTriples, "Doubles/Triples (T)",
            "pulling more than one trailer, where the map and your carrier's freight allow it"),
    };

    /// <summary>
    /// Does the driver hold this endorsement?
    ///
    /// Checks the endorsement list first, then falls back to the application flags so a career written
    /// before any of this still answers correctly.
    /// </summary>
    public static bool Has(AppState s, string key)
    {
        var k = (key ?? "").Trim();
        if (k.Length == 0) return false;

        if (s.Driver.Endorsements.Any(q => q.Equals(k, StringComparison.OrdinalIgnoreCase)))
            return true;

        var app = s.Application;
        if (app == null) return false;
        return k switch
        {
            Hazmat => app.HasHazmat,
            Tanker => app.HasTanker,
            DoublesTriples => app.HasDoublesTriples,
            _ => false
        };
    }

    /// <summary>Everything the driver currently holds, for display and for carrier screening.</summary>
    public static List<string> Held(AppState s) =>
        All.Where(e => Has(s, e.Key)).Select(e => e.Key).ToList();

    /// <summary>
    /// Records the driver gaining or losing an endorsement, and says what it changes.
    ///
    /// Both stores are written so the endorsement list and the application flags cannot drift apart —
    /// the dispatch engine and the carrier market read different ones, and a driver whose endorsement is
    /// visible to one but not the other is the bug this replaces.
    /// </summary>
    public static string Record(AppState s, string key, bool has, string gameTime)
    {
        var known = All.FirstOrDefault(e => e.Key.Equals((key ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        if (known.Key == null)
            throw new InvalidOperationException(
                $"That is not an endorsement I track. I know about: {string.Join(", ", All.Select(e => e.Label))}.");

        var already = Has(s, known.Key);
        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;

        if (has && already)
            return $"You already have {known.Label} on file. Nothing to change.";
        if (!has && !already)
            return $"There is no {known.Label} on your file to remove.";

        if (has)
        {
            s.Driver.Endorsements.Add(known.Key);
            SetFlag(s, known.Key, true);
            var msg = $"{known.Label} added to your file as of {GameClock.Pretty(when)}. That opens up {known.Unlocks}.";

            // Tanker and hazmat are worth more together than apart, and a driver who has just got one
            // should be told plainly what the other would add.
            if (known.Key == Tanker && !Has(s, Hazmat))
                msg += " Note the placarded tankers — fuel, chemical, gas — still need hazmat alongside this.";
            if (known.Key == Hazmat && Has(s, Tanker))
                msg += " With your tanker endorsement that now includes fuel, chemical and gas tankers.";
            return msg;
        }

        s.Driver.Endorsements.RemoveAll(q => q.Equals(known.Key, StringComparison.OrdinalIgnoreCase));
        SetFlag(s, known.Key, false);
        return $"{known.Label} removed from your file as of {GameClock.Pretty(when)}. " +
               "Dispatch will stop assigning you freight that needs it.";
    }

    private static void SetFlag(AppState s, string key, bool value)
    {
        if (s.Application == null) return;
        switch (key)
        {
            case Hazmat: s.Application.HasHazmat = value; break;
            case Tanker: s.Application.HasTanker = value; break;
            case DoublesTriples: s.Application.HasDoublesTriples = value; break;
        }
    }

    /// <summary>
    /// Brings a career's two stores into agreement on load. Additive: an endorsement recorded in
    /// either place ends up in both, and nothing is ever taken away.
    /// </summary>
    public static void Reconcile(AppState s)
    {
        if (s.Application == null) return;
        foreach (var e in All)
        {
            if (!Has(s, e.Key)) continue;
            if (!s.Driver.Endorsements.Any(q => q.Equals(e.Key, StringComparison.OrdinalIgnoreCase)))
                s.Driver.Endorsements.Add(e.Key);
            SetFlag(s, e.Key, true);
        }
    }
}
