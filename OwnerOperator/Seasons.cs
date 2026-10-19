using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// Freight by the season, region by region, on the career's calendar (HomeLife.Calendar). Asked for from play, and laid
/// out from what the US trade press and load boards describe: a soft January and February; produce from the South in late
/// winter, California in late spring and the north in late summer; construction most of the year in the South and March to
/// October in the north; the grain harvest in the Midwest and Plains from late August to November; the retail peak building
/// from August to Christmas; heating fuel in the northern winter (that last from general knowledge, not a source).
///
/// The game pays what it pays whatever the month, so the season works through the brokers: how much of the game's pay
/// they keep, how often they ring, and what they will believe on the phone. The numbers are first guesses, to be tuned by
/// playing. 1.0 is a normal month; about 0.85 soft, 1.15 busy, 1.25 peak.
/// </summary>
public static class Seasons
{
    public const string Retail = "Retail", Produce = "Produce", Grain = "Grain", Building = "Building", Fuel = "Fuel";
    public static readonly string[] Kinds = { Retail, Produce, Grain, Building, Fuel };
    public static readonly string[] Regions = { "Northwest", "West", "Plains & Southwest", "Midwest", "South", "Northeast" };
    private static readonly HashSet<string> North = new() { "Northwest", "Midwest", "Northeast" };

    /// <summary>Busy at or over this, slow at or under that: said on the board and the phone.</summary>
    public const double Busy = 1.15, Slow = 0.85;

    /// <summary>The kind of freight a listing is, for the season: a reefer is produce, a hopper grain, a flatbed building.</summary>
    public static string KindOf(OoCareer c, BoardLoad l) => KindOf(l.TrailerType, Specialties.Of(c, l));

    public static string KindOf(string? trailer, string specialty)
    {
        var t = (trailer ?? "").ToLowerInvariant();
        if (t.Contains("reefer") || t.Contains("refrigerat")) return Produce;
        if (specialty == Specialties.Agriculture || t.Contains("hopper") || t.Contains("livestock")) return Grain;
        if (specialty is Specialties.Construction or Specialties.Lumber || t.Contains("flatbed") || t.Contains("step deck")
            || t.Contains("lowboy") || t.Contains("log")) return Building;
        if (specialty == Specialties.Fuel || t.Contains("tanker")) return Fuel;
        return Retail;
    }

    /// <summary>How busy a kind of freight is in a region in a month (1 to 12).</summary>
    public static double Index(string kind, string region, int month)
    {
        var m = Math.Clamp(month, 1, 12) - 1;
        double[] curve = kind switch
        {
            Retail => new[] { 0.85, 0.85, 0.95, 1.0, 1.0, 1.0, 1.05, 1.15, 1.15, 1.2, 1.2, 1.15 },
            Produce => region switch
            {
                "South" or "Plains & Southwest" => new[] { 0.9, 1.1, 1.2, 1.25, 1.2, 1.1, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9 },
                "West" => new[] { 0.9, 0.9, 1.0, 1.15, 1.25, 1.25, 1.15, 1.05, 0.95, 0.9, 0.9, 0.9 },
                _ => new[] { 0.85, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.2, 1.1, 0.9, 0.85 },
            },
            Building => region switch
            {
                "South" => new[] { 0.95, 1.0, 1.05, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.05, 1.0, 0.95 },
                _ when North.Contains(region) => new[] { 0.7, 0.7, 0.95, 1.1, 1.15, 1.15, 1.15, 1.15, 1.1, 1.05, 0.85, 0.7 },
                _ => new[] { 0.9, 0.9, 1.05, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.05, 0.95, 0.9 },
            },
            Grain => region is "Midwest" or "Plains & Southwest"
                ? new[] { 0.9, 0.9, 0.95, 1.0, 1.0, 0.95, 0.95, 1.05, 1.2, 1.25, 1.15, 0.95 }
                : new[] { 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.05, 1.0, 0.95 },
            Fuel => North.Contains(region)
                ? new[] { 1.15, 1.15, 1.05, 1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.05, 1.1, 1.15 }
                : new[] { 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0 },
            _ => new[] { 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0 },
        };
        return curve[m];
    }

    /// <summary>The month on the career's calendar, 1 to 12.</summary>
    public static int Month(OoCareer c) =>
        GameClock.TryParse(c.Game.Status.GameTime) is { } now ? HomeLife.Calendar(c, now).Month : 1;

    public static double Now(OoCareer c, string kind, string region) => Index(kind, region, Month(c));

    /// <summary>How busy a listing's freight is out of where it loads, this month.</summary>
    public static double Of(OoCareer c, BoardLoad l) =>
        Now(c, KindOf(c, l), Carriers.AtsRegionOf(string.IsNullOrWhiteSpace(l.OriginState) ? c.Game.Status.LocationState : l.OriginState));

    /// <summary>
    /// The share of the game's pay a broker gives back in a busy month, or keeps in a slow one: 0.15 of the swing, so a peak
    /// (1.25) is nearly four points of margin back to the carrier and a soft month (0.85) two more kept.
    /// </summary>
    public static decimal MarginBack(double index) => (decimal)Math.Round((index - 1) * 0.15, 4);

    /// <summary>Inbound calls follow the freight: more out of a busy region, fewer out of a slow one.</summary>
    public static int RingChance(int baseChance, double index) => Math.Clamp((int)Math.Round(baseChance * index), 15, 90);

    public static string Words(string kind) => kind switch
    {
        Produce => "produce on reefers",
        Grain => "grain and farm freight",
        Building => "flatbed and building freight",
        Fuel => "fuel on tankers",
        _ => "dry van freight for the stores",
    };

    /// <summary>What a busy or slow month means, in a line, or null when it is an ordinary one.</summary>
    public static string? Says(string kind, string region, double index) =>
        index >= Busy ? $"Busy season for {Words(kind)} out of the {region}: brokers keep less of it."
        : index <= Slow ? $"Slow season for {Words(kind)} out of the {region}: brokers keep more of it."
        : null;

    /// <summary>The broker, on the season, after an offer.</summary>
    public static string? BrokerSays(double index) =>
        index >= Busy ? "It's busy this time of year, so I can do a little better on it."
        : index <= Slow ? "It's slow out there this time of year."
        : null;

    /// <summary>
    /// Where the freight is, this month and the next two: every region against every kind, and the kind the truck's own
    /// trailer pulls (none on power-only, which takes whatever the Freight Market has). For the Board's "where the freight
    /// is" panel, so the player can see where to be and when. Asked for from play.
    /// </summary>
    public static object Table(OoCareer c)
    {
        var m = Month(c);
        var months = new[] { m, m % 12 + 1, (m + 1) % 12 + 1 };
        var trailer = DispatchEngine.AssignedTrailer(c.Game)?.Type;
        return new
        {
            months,
            kinds = Kinds,
            regions = Regions,
            index = months.Select(mm => Regions.Select(r => Kinds.Select(k => Index(k, r, mm)).ToArray()).ToArray()).ToArray(),
            yourKind = DropHook.Is(trailer) ? null : KindOf(trailer, Specialties.General),
        };
    }

    /// <summary>Every busy or slow season this month, for the Board's "this month" line.</summary>
    public static List<object> Notable(OoCareer c)
    {
        var month = Month(c);
        var list = new List<object>();
        foreach (var kind in Kinds)
            foreach (var region in Regions)
            {
                var i = Index(kind, region, month);
                if (i >= Busy || i <= Slow) list.Add(new { kind, region, index = i, busy = i >= Busy, says = Says(kind, region, i) });
            }
        return list;
    }
}
