using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How long getting to the shipper actually takes, learned from the driver's own pickups.
///
/// <para>Reported from play: a load from the city board was an hour and forty minutes away, on the far side of
/// town from the delivery, and the plan had it as no time at all — the listing gave no distance, so the shipper was
/// taken to be where the truck stood. The driver was late. And where a listing did give the distance, the leg was
/// planned at highway speed; the driver's own short pickup legs ran at 30 to 38 mph.</para>
///
/// <para>Everything needed is already on the trips: when the load was authorised, when the driver reported being at
/// the shipper, and the odometer between. Two figures come out of it, both cautious — the one that 3 in 4 of the
/// driver's recent pickups came in under:</para>
/// <list type="bullet">
/// <item><b>A pickup with no distance listed:</b> the time from authorisation to the shipper. Per city once it has
/// three pickups there; the driver's own overall figure otherwise.</item>
/// <item><b>A pickup with a distance listed:</b> the speed made on the way to the shipper, used instead of the highway
/// speed where it is slower.</item>
/// </list>
/// <para>Same-spot pickups (already on the property) teach nothing and are left out, as are legs over six hours —
/// those had a rest in them before the truck moved.</para>
/// </summary>
public static class PickupLearning
{
    /// <summary>How many recent pickups a figure is taken over.</summary>
    public const int Window = 10;

    /// <summary>Pickups needed before a figure is used at all — per city, or overall.</summary>
    public const int MinSamples = 3;

    /// <summary>Longest pickup leg believed: past this, the driver rested before setting off.</summary>
    public const double MaxLegHours = 6;

    /// <summary>A listed distance this short is the yard next door, not a leg to learn a speed from.</summary>
    public const double MinListedMiles = 5;

    public sealed record Sample(string City, string State, double Hours, double Miles, bool Listed, string GameTime);

    /// <summary>Every pickup leg the trips can vouch for, newest first.</summary>
    public static List<Sample> Samples(AppState s)
    {
        var list = new List<Sample>();
        foreach (var t in s.Trips)
        {
            if (!t.Kind.Equals("Freight", StringComparison.OrdinalIgnoreCase) || t.ShipperArrivalAuto) continue;
            if (GameClock.TryParse(t.DispatchedGameTime) is not { } from || GameClock.TryParse(t.ShipperArrivedGameTime) is not { } at) continue;
            var hours = (at - from).TotalHours;
            if (hours <= 0.02 || hours > MaxLegHours) continue;
            var measured = t.DeadheadMeasured && t.StartOdometer > t.DispatchOdometer ? t.StartOdometer - t.DispatchOdometer : 0;
            var listed = t.DeadheadMiles >= MinListedMiles;
            list.Add(new Sample(t.OriginCity, t.OriginState, hours, measured > 0 ? measured : t.DeadheadMiles, listed, t.DispatchedGameTime));
        }
        return list.OrderByDescending(x => x.GameTime, StringComparer.Ordinal).ToList();
    }

    /// <summary>How the cautious figure reads: with only three or four pickups, the upper quartile is the longest.</summary>
    private static string Share(int n) => n < 5 ? "the longest your last" : "what 3 in 4 of your last";

    /// <summary>The value 3 in 4 samples came in at or under.</summary>
    private static double UpperQuartile(IEnumerable<double> values)
    {
        var v = values.OrderBy(x => x).ToList();
        if (v.Count == 0) return 0;
        var i = (int)Math.Ceiling(v.Count * 0.75) - 1;
        return v[Math.Clamp(i, 0, v.Count - 1)];
    }

    /// <summary>
    /// The time to plan for getting to a shipper when the listing gives no distance, and a sentence saying where it
    /// came from. Null until there are enough pickups to say anything.
    /// </summary>
    public static (double Hours, string Basis)? UnlistedPickup(AppState s, string? city, string? state)
    {
        var unlisted = Samples(s).Where(x => !x.Listed).ToList();
        var here = unlisted.Where(x => x.City.Equals(city ?? "", StringComparison.OrdinalIgnoreCase)
                                       && x.State.Equals(state ?? "", StringComparison.OrdinalIgnoreCase)).Take(Window).ToList();
        if (here.Count >= MinSamples)
            return (UpperQuartile(here.Select(x => x.Hours)),
                    $"{Share(here.Count)} {here.Count} pickups in {DispatchEngine.Place(city ?? "", state ?? "")} took");
        var all = unlisted.Take(Window).ToList();
        if (all.Count >= MinSamples)
            return (UpperQuartile(all.Select(x => x.Hours)), $"{Share(all.Count)} {all.Count} pickups took");
        return null;
    }

    /// <summary>
    /// What a pickup with no distance listed is planned at before there are enough of the driver's own to go on.
    /// </summary>
    public const double DefaultUnlistedHours = 1.0;

    /// <summary>
    /// The time to plan for getting to a shipper when the listing gives no distance — learned where it can be. Until
    /// it can, an hour (or the longest pickup on record, if that is more) wherever the shipper is plainly not where
    /// the truck is (<see cref="ShipperElsewhere"/>), and nothing otherwise, as before. Reported from play: a fresh career, parked
    /// at Amazon in Phoenix, a FedEx load forty-five minutes across town planned as no time at all, and those minutes
    /// were the difference between one rest on the way to San Francisco and two.
    /// </summary>
    public static (double Hours, string Basis)? PlannedUnlistedPickup(AppState s, BoardLoad load, string? city, string? state)
    {
        if (UnlistedPickup(s, city, state) is { } learned) return learned;
        if (!ShipperElsewhere(s, load)) return null;
        var longest = Samples(s).Where(x => !x.Listed).Select(x => x.Hours).DefaultIfEmpty(0).Max();
        return longest > DefaultUnlistedHours
            ? (longest, "the longest pickup you have logged, until there are enough to learn from")
            : (DefaultUnlistedHours, "the default until there are enough of your own pickups to learn from");
    }

    /// <summary>
    /// Whether the shipper is plainly not where the truck is: the truck is somewhere nothing is loaded, or the row
    /// names a shipper and the position names another place. A row or a customer with no name on it says nothing.
    /// </summary>
    public static bool ShipperElsewhere(AppState s, BoardLoad load)
    {
        // Nothing is loaded at a truck stop, a rest area or the side of the road — wherever the shipper is, it is not
        // here. Reported from play: after a game reset the driver was at a rest stop in Phoenix, with no place name to
        // compare the shipper against, so the run across town would have been planned as nothing again.
        if (s.Status.LocationKind is "TruckStop" or "RestArea" or "Road") return true;
        return NamedElsewhere(s, load);
    }

    /// <summary>The row names a shipper and the position names another place: both named, neither inside the other.</summary>
    public static bool NamedElsewhere(AppState s, BoardLoad load)
    {
        static string Key(string? v) => new((v ?? "").Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
        var shipper = Key(load.Shipper);
        var here = Key(s.Status.LocationDetail);
        return shipper.Length > 0 && here.Length > 0 && !shipper.Contains(here) && !here.Contains(shipper);
    }

    /// <summary>
    /// The speed to plan a listed pickup leg at: what 3 in 4 recent legs at least made. Null until there are enough.
    /// </summary>
    public static (double Mph, int Count)? ListedPickupMph(AppState s)
    {
        var legs = Samples(s).Where(x => x.Listed && x.Miles > 0).Take(Window).ToList();
        if (legs.Count < MinSamples) return null;
        // Cautious is slow: the speed three in four legs beat is the lower quartile of the speeds.
        var speeds = legs.Select(x => x.Miles / x.Hours).OrderBy(x => x).ToList();
        var i = (int)Math.Floor(speeds.Count * 0.25);
        return (speeds[Math.Clamp(i, 0, speeds.Count - 1)], legs.Count);
    }

    /// <summary>For the Settings screen: what the app has learned, in the driver's own units.</summary>
    public static object View(AppState s)
    {
        var all = Samples(s);
        var unlisted = UnlistedPickup(s, null, null);
        var mph = ListedPickupMph(s);
        return new
        {
            samples = all.Count,
            unlistedHours = unlisted?.Hours,
            unlistedCount = all.Count(x => !x.Listed),
            listedMph = mph?.Mph,
            listedCount = mph?.Count ?? all.Count(x => x.Listed),
            cities = all.Where(x => !x.Listed).GroupBy(x => DispatchEngine.Place(x.City, x.State))
                        .Where(g => g.Count() >= MinSamples)
                        .Select(g => new { place = g.Key, count = Math.Min(Window, g.Count()), hours = UpperQuartile(g.Take(Window).Select(x => x.Hours)) })
                        .ToList(),
        };
    }
}
