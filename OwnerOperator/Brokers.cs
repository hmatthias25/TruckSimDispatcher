using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// A freight broker. Fictional, always: a broker who pays late or not at all must not carry a real company's name.
/// See the plan, "Brokers".
/// </summary>
public class Broker
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>A company's base-game name, which its freight is matched on; Name is what the player's game calls it. See Companies.</summary>
    public string BaseName { get; set; } = "";
    /// <summary>The person who answers the phone.</summary>
    public string Rep { get; set; } = "";

    /// <summary>Starter, Established or Premium. See the plan, "Paying your dues".</summary>
    public string Tier { get; set; } = BrokerTiers.Starter;
    /// <summary>General, or one trade (<see cref="Specialties"/>). A specialist needs the trailer for it.</summary>
    public string Specialty { get; set; } = "General";
    /// <summary>Broker, or Shipper: one of the game's companies hiring directly, with its own freight and no margin.</summary>
    public string Kind { get; set; } = "Broker";
    /// <summary>One of <see cref="Personalities"/>. Fixed for life.</summary>
    public string Personality { get; set; } = "";

    public string City { get; set; } = "";
    public string State { get; set; } = "";
    /// <summary>The regions their freight starts in: Core's ATS regions (<c>Carriers.AtsRegionOf</c>).</summary>
    public List<string> Regions { get; set; } = new();

    /// <summary>The share of the shipper's rate they aim to keep, and the least they will keep. 0.25 = 25%.</summary>
    public decimal TargetMargin { get; set; }
    public decimal MinMargin { get; set; }

    public int DaysToPay { get; set; } = 30;
    public decimal QuickPayFeePct { get; set; } = 3;
    /// <summary>A to D, as a credit check shows it.</summary>
    public string Credit { get; set; } = "B";

    /// <summary>What they want to see before taking a carrier on.</summary>
    public int RequiresLoads { get; set; }
    public int RequiresDays { get; set; }
    public double RequiresOnTimePct { get; set; }

    /// <summary>In the player's directory yet. A broker joins when a region they work is reached.</summary>
    public bool Known { get; set; }
    public string KnownSinceGameTime { get; set; } = "";

    /// <summary>Your standing with them, -100 to 100. Starts at 0.</summary>
    public int Standing { get; set; }
    public int LoadsBooked { get; set; }
    /// <summary>What the player has learned of them from calls, in plain words. The personality itself is never shown.</summary>
    public List<string> Notes { get; set; } = new();
}

public static class BrokerTiers
{
    public const string Starter = "Starter";
    public const string Established = "Established";
    public const string Premium = "Premium";
}

/// <summary>
/// How a personality negotiates. The numbers are the app's; the model only voices them.
/// <para><c>Opening</c>: where they open, as a share of the way from their target rate to their ceiling (negative
/// opens below target). <c>Step</c>: each concession, as a share of what is left between offer and ceiling.
/// <c>Patience</c>: rounds before they hang up. <c>TradesTermsNotRate</c>: moves on terms, never on rate.
/// <c>Voice</c>: who they are on the phone. <c>Reputation</c>: what the player comes to say about them.</para>
/// </summary>
public record Personality(string Id, double Opening, double Step, int Patience, bool TradesTermsNotRate,
                          string Voice, string Reputation);

public static class Personalities
{
    public static readonly Personality[] All =
    {
        new("Grinder", -0.15, 0.25, 4, false,
            "Flat and patient. Numbers only. Says \"that's the rate\" a lot, and moves in small steps.",
            "Drives a hard bargain, and moves a little at a time."),
        new("Friend", 0.10, 0.50, 3, false,
            "Chatty, first names, asks how the last load went. Moves fast for people they trust, slowly for strangers.",
            "Friendly, and moves quickly for people they know."),
        new("Corporate", 0.0, 0.0, 3, true,
            "Polite and scripted. \"Per our policy.\" Will not move on rate, but will on terms: quick pay, detention.",
            "Won't move on rate. Ask about terms instead."),
        new("Hustler", 0.30, 0.40, 3, false,
            "Fast talker, over-promises, opens generous to hook you. Likely to argue detention later.",
            "Opens generous. Watch the paperwork."),
        new("OldHand", 0.20, 0.30, 4, false,
            "Dry, knows the roads. Fair from the first offer with little room either way; gives way to a true argument.",
            "Fair from the start, and listens to a real argument."),
        new("Rookie", 0.25, 0.60, 2, false,
            "Nervous, checks with the boss, over-generous by mistake.",
            "New at it. Generous, but nervous."),
    };

    public static Personality For(string? id) =>
        All.FirstOrDefault(p => p.Id.Equals(id ?? "", StringComparison.OrdinalIgnoreCase)) ?? All[0];
}

/// <summary>The carrier's record, which every broker reads before taking you on.</summary>
public record CarrierRecord(int Loads, double OnTimePct, int DaysWithAuthority, int Claims);

/// <summary>The roster, the directory, and what a broker makes of you.</summary>
public static class BrokerBook
{
    private static readonly string[] First =
    {
        "Bluestem", "Ironwood", "Redrock", "Cottonwood", "Sandhill", "Tallgrass", "Copper Ridge", "Silver Creek",
        "Twin Rivers", "Blackwater", "Mesa Verde", "Northwind", "Lone Pine", "High Desert", "Riverbend", "Cedar Gap",
        "Sagebrush", "Thunder Basin", "Bridgewater", "Stonefield", "Crosswind", "Pinecrest", "Saltgrass", "Juniper",
    };
    private static readonly string[] Second =
    {
        "Freight Partners", "Logistics", "Brokerage", "Freight Desk", "Load Services", "Transport Brokers",
        "Freight Co.", "Shipping Agents",
    };
    private static readonly string[] Reps =
    {
        "Marco", "Dana", "Luis", "Kim", "Pete", "Rosa", "Hank", "Tamara", "Glen", "Priya", "Walt", "Jess",
        "Omar", "Beth", "Duane", "Nina", "Carl", "Ivy", "Russ", "Mei", "Gus", "Lena", "Abe", "Tess", "Ray",
        "Juana", "Bo", "Cheryl", "Dev", "Maggie", "Arlo", "Bea", "Cole", "Dina", "Eli", "Faye", "Gil", "Hope",
        "Ike", "June", "Kurt", "Lou", "Moe", "Nell", "Otis", "Pam", "Quinn", "Rita", "Sal", "Tina", "Vic", "Wren",
    };

    /// <summary>
    /// The brokers in this career, made once at the start and fixed after. Seeded from the home city so a career is
    /// the same every time it is opened. Every region gets brokers of every tier, and home gets at least three
    /// starter brokers, because that is who a new authority's first call is to.
    /// </summary>
    public static List<Broker> Generate(OoCareer c)
    {
        var seed = Stable($"{c.Profile.HomeCity}|{c.Profile.HomeState}|{c.Profile.StartedGameTime}");
        var rng = new Random(seed);
        var homeRegion = Carriers.AtsRegionOf(c.Profile.HomeState);
        var regions = new[] { "Northwest", "West", "Plains & Southwest", "Midwest", "South", "Northeast" };
        var cities = Markets.BuiltIn.Where(m => m.HasGarage).ToList();
        var names = First.SelectMany(f => Second.Select(sec => $"{f} {sec}")).OrderBy(_ => rng.Next()).ToList();
        // One of each name: two "Beth"s on the same desk list reads as a mistake.
        var reps = Reps.OrderBy(_ => rng.Next()).ToList();
        var list = new List<Broker>();

        Broker Make(string region, string tier)
        {
            var inRegion = cities.Where(m => Carriers.AtsRegionOf(m.State) == region).ToList();
            var at = region == homeRegion && tier == BrokerTiers.Starter && list.Count(b => b.Tier == BrokerTiers.Starter && b.Regions.Contains(homeRegion)) == 0
                ? cities.FirstOrDefault(m => m.City.Equals(c.Profile.HomeCity, StringComparison.OrdinalIgnoreCase) && m.State == c.Profile.HomeState)
                : null;
            at ??= inRegion.Count > 0 ? inRegion[rng.Next(inRegion.Count)] : cities[rng.Next(cities.Count)];
            var personality = Personalities.All[rng.Next(Personalities.All.Length)];
            var (target, min, days, credit, loads, age, onTime) = tier switch
            {
                // Starter brokers are where the bad payers are: one in six may not pay at all.
                BrokerTiers.Starter => (0.28m, 0.18m, rng.Next(2) == 0 ? 30 : 45, rng.Next(6) == 0 ? "D" : rng.Next(3) == 0 ? "C" : "B", 0, 0, 0.0),
                BrokerTiers.Established => (0.18m, 0.11m, 30, rng.Next(5) == 0 ? "B" : "A", 25, 60, 90.0),
                _ => (0.11m, 0.06m, rng.Next(2) == 0 ? 15 : 30, "A", 80, 180, 96.0),
            };
            var wobble = (decimal)(rng.NextDouble() * 0.04 - 0.02);
            var b = new Broker
            {
                Id = $"B{list.Count + 1:00}",
                Name = names[list.Count % names.Count],
                Rep = reps[list.Count % reps.Count],
                Tier = tier,
                Personality = personality.Id,
                City = at.City,
                State = at.State,
                Regions = new() { region },
                TargetMargin = target + wobble,
                MinMargin = min + wobble,
                DaysToPay = days,
                QuickPayFeePct = 2 + rng.Next(4),
                Credit = credit,
                RequiresLoads = loads,
                RequiresDays = age,
                RequiresOnTimePct = onTime,
            };
            list.Add(b);
            return b;
        }

        foreach (var region in regions)
        {
            var starters = region == homeRegion ? 3 : 1;
            for (var i = 0; i < starters; i++) Make(region, BrokerTiers.Starter);
            for (var i = 0; i < 2; i++) Make(region, BrokerTiers.Established);
            Make(region, BrokerTiers.Premium);

            // One specialist per trade in every region. Better money than a general broker, fewer trucks after the
            // freight, and nothing for a carrier without the trailer for it.
            foreach (var trade in Specialties.All)
            {
                var sp = Make(region, BrokerTiers.Established);
                sp.Specialty = trade;
                sp.TargetMargin -= 0.04m;
                sp.MinMargin -= 0.03m;
                sp.RequiresLoads = 10;
                sp.RequiresDays = 20;
                sp.RequiresOnTimePct = 90;
            }
        }

        // The game's own companies, hiring directly: their own freight, no broker margin, and only for a long, clean
        // record. They work wherever they have depots.
        foreach (var (firmName, trade) in Specialties.Shippers)
        {
            var firm = AtsCompanies.Find(firmName);
            if (firm == null) continue;
            var firmRegions = firm.States.Select(Carriers.AtsRegionOf).Where(r => r.Length > 0 && r != "Other").Distinct().ToList();
            var hq = cities.FirstOrDefault(m => firm.States.Contains(m.State)) ?? cities[0];
            list.Add(new Broker
            {
                Id = $"B{list.Count + 1:00}",
                Name = firm.Name,
                BaseName = firm.Name,
                Rep = reps[list.Count % reps.Count],
                Tier = BrokerTiers.Premium,
                Kind = "Shipper",
                Specialty = trade,
                Personality = "Corporate",
                City = hq.City,
                State = hq.State,
                Regions = firmRegions,
                TargetMargin = 0.04m,
                MinMargin = 0m,
                DaysToPay = 15,
                QuickPayFeePct = 1,
                Credit = "A",
                RequiresLoads = 60,
                RequiresDays = 120,
                RequiresOnTimePct = 97,
            });
        }
        return list;
    }

    /// <summary>
    /// Brokers join the directory as their regions are reached. A new career knows the brokers who work home; every
    /// discovered city brings in the brokers working its region.
    /// </summary>
    public static List<Broker> Refresh(OoCareer c)
    {
        var joined = new List<Broker>();
        var reached = c.Game.Discovered.Select(d => Carriers.AtsRegionOf(d.State)).ToHashSet();
        foreach (var b in c.Brokers.Where(b => !b.Known && b.Regions.Any(reached.Contains)))
        {
            b.Known = true;
            b.KnownSinceGameTime = c.Game.Status.GameTime;
            joined.Add(b);
        }
        return joined;
    }

    public static CarrierRecord Record(OoCareer c)
    {
        var delivered = c.Bookings.Where(b => b.Status == BookingStatus.Delivered).ToList();
        var onTime = delivered.Count == 0 ? 100 : 100.0 * delivered.Count(b => !b.Late) / delivered.Count;
        var days = GameClock.HoursBetween(c.Profile.StartedGameTime, c.Game.Status.GameTime) is { } h ? (int)(h / 24) : 0;
        var claims = c.Bookings.Count(b => (b.Status == BookingStatus.Cancelled && b.OnCarrier) || b.CargoDamagePct >= 1);
        return new CarrierRecord(delivered.Count, Math.Round(onTime, 1), Math.Max(0, days), claims);
    }

    /// <summary>Why this broker will not take you on yet, or null when they will.</summary>
    public static string? NotYet(OoCareer c, Broker b)
    {
        var r = Record(c);
        var missing = new List<string>();
        if (r.DaysWithAuthority < b.RequiresDays) missing.Add($"{b.RequiresDays} days with your authority (you have {r.DaysWithAuthority})");
        if (r.Loads < b.RequiresLoads) missing.Add($"{b.RequiresLoads} loads (you have {r.Loads})");
        if (r.Loads > 0 && r.OnTimePct < b.RequiresOnTimePct) missing.Add($"{b.RequiresOnTimePct:0}% on time (you are at {r.OnTimePct:0}%)");
        if (b.Standing <= -50) missing.Add("a better standing with them");
        if (Specialties.Missing(c, b.Specialty) is { } kit) missing.Add(kit);
        return missing.Count == 0 ? null : string.Join(", ", missing);
    }

    public static string Requirement(Broker b) =>
        (b.RequiresLoads == 0 && b.RequiresDays == 0
            ? "Takes new authorities"
            : $"Wants {b.RequiresDays} days, {b.RequiresLoads} loads, {b.RequiresOnTimePct:0}% on time")
        + (b.Specialty == Specialties.General ? "" : $"; a {string.Join(" or ", Specialties.Trailers(b.Specialty)).ToLowerInvariant()}" +
           (Specialties.Adr(b.Specialty) is { } adr ? $" and ADR for {adr.ToLowerInvariant()}" : ""));

    /// <summary>What a credit grade means for getting paid, and for the rate: said plainly on the Brokers tab.</summary>
    public static string CreditSays(string credit) => credit switch
    {
        "A" => "Pays on time.",
        "B" => "Pays on time or a day or two late.",
        "C" => "Pays, but up to ten days late. Pays a little more for it, and gives quick pay more readily.",
        _ => "Slow, and about four in ten invoices never paid without collections. Pays well over the odds for it, " +
             "and gives quick pay to anyone who asks. No factor will buy their invoices.",
    };

    /// <summary>The directory as the player sees it. Margins, ceilings and the personality stay private.</summary>
    public static object View(OoCareer c, Broker b)
    {
        var notYet = NotYet(c, b);
        var here = Carriers.AtsRegionOf(c.Game.Status.LocationState);
        return new
        {
            b.Id, b.Name, b.Rep, b.Tier, b.Specialty, b.Kind, b.City, b.State, b.Regions,
            b.DaysToPay, b.QuickPayFeePct, b.Credit, b.Standing, b.LoadsBooked, b.Notes,
            requirement = Requirement(b),
            takesYou = notYet == null,
            notYet,
            worksHere = b.Regions.Contains(here),
            creditSays = CreditSays(b.Credit),
            payRecord = Receivables.PayRecord(c, b),
        };
    }

    /// <summary>A stable hash: string.GetHashCode is randomised per process, which would reshuffle a career on every start.</summary>
    public static int Stable(string text)
    {
        unchecked
        {
            var h = (int)2166136261;
            foreach (var ch in text) h = (h ^ ch) * 16777619;
            return h & 0x7fffffff;
        }
    }
}
