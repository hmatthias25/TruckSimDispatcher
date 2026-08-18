using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What the driver is cleared to haul — as <b>American Truck Simulator</b> models it.
///
/// ATS does not use CDL endorsements. It gates dangerous freight on <b>HazMat classes</b>, six of them,
/// unlocked individually and in any order, and the class is what decides whether a given load can be
/// taken. Classes 5, 7 and 9 do not appear in the game.
///
/// Two things that look like endorsements are not:
/// <list type="bullet">
///   <item><b>Tanker is not an endorsement.</b> A tanker is a trailer; what gates it is what is inside.
///     A fuel tanker is class 3, a gas tanker is class 2, a food-grade tanker needs nothing at all.</item>
///   <item><b>Doubles and triples are not an endorsement.</b> They are trailer configurations available
///     in particular states — nothing to do with the driver's licence.</item>
/// </list>
///
/// <see cref="Driver.Endorsements"/> holds the classes the driver has unlocked. Deliberately separate
/// from the qualifications list, which rank promotion writes company unlocks into — lifting the
/// carrier's own hazmat restriction is a different thing from the driver being cleared for a class, and
/// both have to be true. Nothing here is ever inferred: the driver tells the app, and it records that.
/// </summary>
public static class Endorsements
{
    /// <summary>A HazMat class as ATS presents it.</summary>
    public record HazClass(string Key, string Label, string Covers, string Examples);

    /// <summary>
    /// The six classes in ATS. Class 2 carries subclasses (2.1 flammable, 2.2 non-flammable and
    /// cryogenic, 2.3 poisonous) but is unlocked as one class, so the subclasses describe what is
    /// inside rather than being separate unlocks.
    /// </summary>
    public static readonly HazClass[] All =
    {
        new("1", "Class 1 — Explosives",
            "explosive substances and articles",
            "dynamite, fireworks, ammunition"),
        new("2", "Class 2 — Gases",
            "compressed, liquefied and cryogenic gases — 2.1 flammable, 2.2 non-flammable, 2.3 poisonous",
            "acetylene and hydrogen; nitrogen and neon; chlorine"),
        new("3", "Class 3 — Flammable liquids",
            "flammable liquids, which is most fuel haulage",
            "gasoline, diesel, kerosene"),
        new("4", "Class 4 — Flammable solids",
            "flammable solids and spontaneously combustible materials",
            "matches, some metal powders"),
        new("6", "Class 6 — Toxic substances",
            "toxic and infectious substances",
            "pesticides, medical waste"),
        new("8", "Class 8 — Corrosives",
            "corrosive substances",
            "acids, batteries, caustic soda"),
    };

    public static HazClass? Find(string? key)
    {
        var k = Normalise(key);
        return All.FirstOrDefault(c => c.Key == k);
    }

    /// <summary>
    /// Reads a class off whatever the player or a screenshot gave us. "3", "Class 3", "2.1" and
    /// "Flammable liquids" all resolve; a subclass collapses to its parent, because that is the unlock.
    /// </summary>
    public static string Normalise(string? key)
    {
        var raw = (key ?? "").Trim();
        if (raw.Length == 0) return "";

        // "Class 2.1" / "2.1" -> "2". The subclass says what is in the tank, not what you unlock.
        var digits = new string(raw.TakeWhile(char.IsDigit).ToArray());
        if (digits.Length == 0)
        {
            var m = raw.IndexOf("class", StringComparison.OrdinalIgnoreCase);
            if (m >= 0)
                digits = new string(raw[(m + 5)..].TrimStart().TakeWhile(char.IsDigit).ToArray());
        }
        if (digits.Length > 0) return digits;

        // Fall back to the name.
        var byName = All.FirstOrDefault(c =>
            c.Label.Contains(raw, StringComparison.OrdinalIgnoreCase) ||
            c.Covers.Contains(raw, StringComparison.OrdinalIgnoreCase));
        return byName?.Key ?? "";
    }

    /// <summary>Is the driver cleared for this class?</summary>
    public static bool Has(AppState s, string? key)
    {
        var k = Normalise(key);
        if (k.Length == 0) return false;
        return s.Driver.Endorsements.Any(q => Normalise(q) == k);
    }

    /// <summary>Cleared for anything at all — what a hazmat load with no stated class needs.</summary>
    public static bool HasAny(AppState s) => s.Driver.Endorsements.Any(q => Find(q) != null);

    /// <summary>Classes currently held, in game order.</summary>
    public static List<string> Held(AppState s) =>
        All.Where(c => Has(s, c.Key)).Select(c => c.Key).ToList();

    /// <summary>
    /// The class a tanker subtype needs. Food-grade and dry-bulk need none — milk and cement are not
    /// placarded, and pretending otherwise would refuse perfectly ordinary freight.
    /// </summary>
    public static string ClassForTanker(string? subtype) => (subtype ?? "").Trim().ToLowerInvariant() switch
    {
        "fuel" => "3",          // gasoline, diesel — flammable liquid
        "gas" => "2",           // pressurised and cryogenic
        "chemical" => "8",      // corrosives are the common chemical haul
        _ => ""                 // food grade, dry bulk: nothing needed
    };

    /// <summary>Records the driver gaining or losing a class, and says what it changes.</summary>
    public static string Record(AppState s, string key, bool has, string gameTime)
    {
        var cls = Find(key)
                  ?? throw new InvalidOperationException(
                      $"ATS does not have that class. It uses {string.Join(", ", All.Select(c => c.Key))} — " +
                      "there is no tanker or doubles endorsement, and no classes 5, 7 or 9.");

        var already = Has(s, cls.Key);
        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;

        if (has && already) return $"{cls.Label} is already on your file. Nothing to change.";
        if (!has && !already) return $"You do not have {cls.Label} to remove.";

        if (has)
        {
            s.Driver.Endorsements.Add(cls.Key);
            SyncLegacyFlags(s);
            var msg = $"{cls.Label} added as of {GameClock.Pretty(when)} — {cls.Covers} ({cls.Examples}).";

            // Say what it opens up in equipment terms, which is what the driver is actually asking.
            var tankers = TrailerSpec.TankerKinds
                .Where(t => ClassForTanker(t.Key) == cls.Key)
                .Select(t => t.Label)
                .ToList();
            if (tankers.Count > 0)
                msg += $" That also covers {string.Join(" and ", tankers)}.";
            return msg;
        }

        s.Driver.Endorsements.RemoveAll(q => Normalise(q) == cls.Key);
        SyncLegacyFlags(s);
        return $"{cls.Label} removed as of {GameClock.Pretty(when)}. Dispatch will stop assigning freight that needs it.";
    }

    /// <summary>
    /// Keeps the old application flags roughly in step, for anything still reading them.
    ///
    /// Approximate on purpose: the flags describe a model ATS does not use, so they are derived from
    /// the classes rather than the other way round. Any class means "hazmat" to an old reader, and the
    /// tanker flag follows from holding what a placarded tanker actually needs.
    /// </summary>
    private static void SyncLegacyFlags(AppState s)
    {
        if (s.Application == null) return;
        s.Application.HasHazmat = HasAny(s);
        s.Application.HasTanker = Has(s, "3") || Has(s, "2") || Has(s, "8");
    }

    /// <summary>
    /// Migrates a career off the CDL-endorsement model.
    ///
    /// A stored "Hazmat" said nothing about which class, and guessing would let somebody take a load
    /// they are not cleared for — so it is dropped and the driver is asked to pick their classes. The
    /// application flag is left alone so the career remembers something was there.
    /// </summary>
    public static bool MigrateFromCdlModel(AppState s)
    {
        var stale = s.Driver.Endorsements.Where(e => Find(e) == null).ToList();
        if (stale.Count == 0) return false;
        s.Driver.Endorsements.RemoveAll(e => Find(e) == null);
        return true;
    }

    /// <summary>Set when the driver has hazmat on their old application but no classes chosen yet.</summary>
    public static bool NeedsClassesChosen(AppState s) =>
        (s.Application?.HasHazmat ?? false) && !HasAny(s);
}
