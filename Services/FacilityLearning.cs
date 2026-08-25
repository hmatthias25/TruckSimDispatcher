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
            // Reported from play at around two hours: a flatbed is not dropped and hooked, the cargo goes
            // on and gets strapped and sometimes tarped, and the driver waits through it. The seed
            // matters more than it used to now that a short window refuses the board outright — under-
            // estimating it would let through exactly the load this is meant to stop.
            ["Flatbed"] = (2.0, 1.5),
            ["Step Deck"] = (2.0, 1.5),
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
        // Drop and hook has no dock time to learn. You back under what is there and pull the pin at the
        // other end — the hook time is the whole of it, and it never moves, so there is nothing to
        // measure and nothing that should be measured into it.
        if (DropHook.Is(trailerType))
        {
            var hook = Math.Max(0.1, s.Settings.HookHours);
            return (hook, hook, 0, false);
        }

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
        // Nothing was loaded, so there is nothing to learn. Folding a hook time into a dock average would
        // drag every future projection toward zero and start authorising loads that cannot be worked.
        if (DropHook.Is(trailerType)) return;

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

        // A reading this far out is a mistyped stamp, not a slow dock, and the average keeps a result
        // rather than its samples — so once one is folded in it cannot be taken back out. Refusing it at
        // the door is the only place this can be stopped cheaply. The driver is told; see QuestionSpan.
        var takeLoad = loadingHours is > 0 and < ImplausibleHours;
        var takeUnload = unloadingHours is > 0 and < ImplausibleHours;
        if (!takeLoad && !takeUnload) return;

        var weight = 1.0 / Math.Min(entry.Samples + 1, SettleAt);
        if (takeLoad)
            entry.LoadingHours = Math.Round(entry.LoadingHours + (loadingHours!.Value - entry.LoadingHours) * weight, 2);
        if (takeUnload)
            entry.UnloadingHours = Math.Round(entry.UnloadingHours + (unloadingHours!.Value - entry.UnloadingHours) * weight, 2);

        entry.Samples++;
        entry.LastGameTime = s.Status.GameTime;
    }

    /// <summary>
    /// Throws the learned averages away and works them out again from the trip logs.
    ///
    /// The average keeps a result and a count, not the samples, so a bad reading cannot be pulled back
    /// out of it once folded in — and one AM/PM swap on an End unload is enough to leave every future
    /// projection hours long. The event logs are still there on every trip, though, so the whole thing
    /// can be derived a second time from what actually happened.
    ///
    /// Only logged Begin/End pairs count, exactly as they do live: a typed figure is the driver's
    /// recollection and training on it would bake a guess in. Manual overrides are left alone — the
    /// driver set those deliberately.
    ///
    /// Returns the types it rebuilt and how many samples each ended up with.
    /// </summary>
    public static List<(string Type, int Samples)> Rebuild(AppState s)
    {
        var manual = s.Settings.FacilityTimes.Where(f => f.Manual).ToList();
        s.Settings.FacilityTimes = manual;

        var delivered = s.Trips
            .Where(t => t.Status == "Delivered" && t.Events.Count > 0)
            .OrderBy(t => GameClock.TryParse(t.DeliveredGameTime) ?? DateTime.MinValue)
            .ToList();

        foreach (var t in delivered)
        {
            double? Span(string beginKind, string endKind)
            {
                var begin = t.Events.Where(e => e.Kind == beginKind)
                    .Select(e => GameClock.TryParse(e.GameTime)).Where(d => d != null).Min();
                var end = t.Events.Where(e => e.Kind == endKind)
                    .Select(e => GameClock.TryParse(e.GameTime)).Where(d => d != null).Max();
                if (begin == null || end == null) return null;
                var hours = (end.Value - begin.Value).TotalHours;
                return hours >= 0 ? hours : null;
            }

            var loaded = t.PreLoaded ? null : Span("BeginLoad", "EndLoad");
            var unloaded = Span("BeginUnload", "EndUnload");
            if (loaded == null && unloaded == null) continue;

            Record(s, t.TrailerType, loaded, unloaded);
        }

        return s.Settings.FacilityTimes
            .Select(f => (f.TrailerType, f.Samples))
            .OrderBy(x => x.TrailerType)
            .ToList();
    }

    /// <summary>
    /// Whether a measured dock time is believable, and what it looks like if it is not.
    ///
    /// Twelve hours out is the fingerprint of an AM/PM swap on the end stamp, which is far and away the
    /// likeliest way a dock time goes wrong — and the app questions implausible readings everywhere
    /// else, so this one should not go quietly into the model. Nothing is corrected here; the driver is
    /// asked, the same as they are about a break-capped drive clock.
    /// </summary>
    public static string? QuestionSpan(AppState s, string? trailerType, double hours, string what)
    {
        if (hours < ImplausibleHours) return null;

        var expected = For(s, trailerType);
        var typical = what.Equals("loading", StringComparison.OrdinalIgnoreCase)
            ? expected.Loading : expected.Unloading;

        var swapped = hours - 12;
        return swapped > 0 && swapped < typical * 3
            ? $"{Hhmm.Of(hours)} {what} is not a dock time — it is most likely AM and PM the wrong way " +
              $"round on the end stamp, which would make it {Hhmm.Of(swapped)}. Correct the event on the " +
              "trip log and I will work the average out again; I have not learned anything from this one."
            : $"{Hhmm.Of(hours)} {what} is a long way off the {Hhmm.Of(typical)} I plan on. Check the " +
              "stamps on the trip log — I have not learned anything from this one.";
    }

    /// <summary>Beyond this a dock time is treated as a misreading rather than a slow day.</summary>
    public const double ImplausibleHours = 9;

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
