using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How long a dock actually takes, learned per trailer type.
///
/// A single global figure was wrong in a way that broke dispatch. A reefer takes three or four hours
/// to load; a flatbed can be an hour. Planning every load at one hour made every reefer projection
/// two to three hours optimistic, and loads were authorized that could not be run in the window.
///
/// So the app measures instead of assuming. Every close-out that produced a real Begin/End pair feeds
/// the average for that trailer type, and the planner uses the figure for whatever is hooked. Typed
/// fallbacks are deliberately NOT learned from — a guess should not train the model.
/// </summary>
public static class FacilityLearning
{
    /// <summary>
    /// Starting estimates, used until a type has real samples. Deliberately closer to reality than
    /// the old flat 1.0 so the first few loads are not badly wrong either.
    /// </summary>
    private static readonly Dictionary<string, (double Load, double Unload)> Seeds =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["Reefer"] = (3.0, 3.0),
            ["Dry Van"] = (1.5, 1.5),
            ["Flatbed"] = (1.0, 1.0),
            ["Step Deck"] = (1.0, 1.0),
            ["Lowboy"] = (1.5, 1.5),
            ["Tanker"] = (2.0, 2.0),
            ["Car Hauler"] = (2.5, 2.5),
            ["Livestock"] = (1.5, 1.0),
            ["Log"] = (1.0, 0.75),
            ["Hopper"] = (1.5, 1.0),
            ["Dump"] = (0.75, 0.5),
        };

    /// <summary>
    /// After this many samples the average stops chasing every load and settles. Before it, each new
    /// reading moves the figure a lot — which is what makes it converge quickly from a bad seed.
    /// </summary>
    private const int SettleAt = 10;

    public static string Normalise(string? trailerType)
    {
        var t = (trailerType ?? "").Trim();
        return t.Length == 0 ? "Dry Van" : t;
    }

    /// <summary>The figures the planner should use for this trailer type.</summary>
    public static (double Loading, double Unloading, int Samples, bool Learned) For(AppState s, string? trailerType)
    {
        var type = Normalise(trailerType);
        var hit = s.Settings.FacilityTimes
            .FirstOrDefault(f => f.TrailerType.Equals(type, StringComparison.OrdinalIgnoreCase));

        if (hit != null && (hit.Samples > 0 || hit.Manual))
            return (hit.LoadingHours, hit.UnloadingHours, hit.Samples, !hit.Manual);

        if (Seeds.TryGetValue(type, out var seed))
            return (seed.Load, seed.Unload, 0, false);

        return (Math.Max(0.25, s.Settings.DefaultLoadingHours),
                Math.Max(0.25, s.Settings.DefaultUnloadingHours), 0, false);
    }

    /// <summary>
    /// Folds a measured dock time into the average for this trailer type.
    ///
    /// Only call with times derived from logged Begin/End pairs. A hand-typed figure is the driver's
    /// recollection, and training on it would bake a guess into every future projection.
    /// </summary>
    public static void Record(AppState s, string? trailerType, double? loadingHours, double? unloadingHours)
    {
        if (loadingHours is null && unloadingHours is null) return;

        var type = Normalise(trailerType);
        var entry = s.Settings.FacilityTimes
            .FirstOrDefault(f => f.TrailerType.Equals(type, StringComparison.OrdinalIgnoreCase));

        if (entry == null)
        {
            var (l, u, _, _) = For(s, type);
            entry = new FacilityTimeSample { TrailerType = type, LoadingHours = l, UnloadingHours = u };
            s.Settings.FacilityTimes.Add(entry);
        }

        // An override stays put until the driver clears it — they can see their own game.
        if (entry.Manual) return;

        var weight = 1.0 / Math.Min(entry.Samples + 1, SettleAt);
        if (loadingHours is > 0 and < 24)
            entry.LoadingHours = Math.Round(entry.LoadingHours + (loadingHours.Value - entry.LoadingHours) * weight, 2);
        if (unloadingHours is > 0 and < 24)
            entry.UnloadingHours = Math.Round(entry.UnloadingHours + (unloadingHours.Value - entry.UnloadingHours) * weight, 2);

        entry.Samples++;
        entry.LastGameTime = s.Status.GameTime;
    }

    /// <summary>Everything learned so far, for the Settings screen.</summary>
    public static List<object> View(AppState s)
    {
        var types = Seeds.Keys
            .Concat(s.Settings.FacilityTimes.Select(f => f.TrailerType))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t)
            .ToList();

        return types.Select(t =>
        {
            var (l, u, n, learned) = For(s, t);
            var entry = s.Settings.FacilityTimes.FirstOrDefault(f => f.TrailerType.Equals(t, StringComparison.OrdinalIgnoreCase));
            return (object)new
            {
                trailerType = t,
                loadingHours = l,
                unloadingHours = u,
                samples = n,
                learned,
                manual = entry?.Manual ?? false,
                lastGameTime = entry?.LastGameTime ?? ""
            };
        }).ToList();
    }

    /// <summary>A driver setting the figure themselves, which then stops moving.</summary>
    public static void SetManual(AppState s, string trailerType, double loading, double unloading, bool manual)
    {
        var type = Normalise(trailerType);
        var entry = s.Settings.FacilityTimes
            .FirstOrDefault(f => f.TrailerType.Equals(type, StringComparison.OrdinalIgnoreCase));
        if (entry == null)
        {
            entry = new FacilityTimeSample { TrailerType = type };
            s.Settings.FacilityTimes.Add(entry);
        }

        if (manual)
        {
            entry.LoadingHours = Math.Clamp(loading, 0, 24);
            entry.UnloadingHours = Math.Clamp(unloading, 0, 24);
            entry.Manual = true;
        }
        else
        {
            // Back to learning. Keep what it knows rather than throwing the history away.
            entry.Manual = false;
        }
    }
}
