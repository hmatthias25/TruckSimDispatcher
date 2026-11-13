using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

public static class BrokerStatus
{
    public const string Active = "Active";
    /// <summary>Shut their doors: they pay what they owe, and take no more calls.</summary>
    public const string Closed = "Closed";
    /// <summary>Gone under: what they owe is frozen, and a settlement claim gets back a little of it, in time.</summary>
    public const string Bankrupt = "Bankrupt";
}

/// <summary>The brokers' trade, week by week: when the last Friday was looked at, and what each Friday brought.</summary>
public class BrokerMarketState
{
    /// <summary>The game day of the last Friday evaluated. Null until the first look, which starts the count from there.</summary>
    public int? LastFriday { get; set; }
    public List<MarketReport> Reports { get; set; } = new();
}

/// <summary>One Friday's news, as the player hears it: only the regions they have reached.</summary>
public class MarketReport
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public int Day { get; set; }
    public string GameTime { get; set; } = "";
    /// <summary>Read: the popup has been closed.</summary>
    public bool Seen { get; set; }
    public List<MarketNews> News { get; set; } = new();
}

public class MarketNews
{
    /// <summary>New, Closed, Bankrupt, Up or Down (a credit grade).</summary>
    public string Kind { get; set; } = "";
    public string BrokerId { get; set; } = "";
    public string BrokerName { get; set; } = "";
    public string Region { get; set; } = "";
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public string Said { get; set; } = "";
}

/// <summary>
/// Brokers come and go. Every Friday evening new ones open (on poor credit, getting established), some close their doors
/// (still paying what they owe), some go bankrupt (what they owe is frozen: claim a settlement for a little of it), and
/// credit grades move. The game's own companies hiring directly are exempt: they are always there. Every region keeps
/// at least one broker who takes new authorities. The player hears only of the regions they have reached. Asked for from
/// play on 2026-10-30. Everything is seeded off the career, the Friday and the broker, so nothing can be re-rolled.
/// </summary>
public static class BrokerMarket
{
    /// <summary>When on a Friday the week is looked at.</summary>
    public const int FridayHour = 18;

    /// <summary>The weekly odds, in tenths of a percent, of going under, by credit grade. D is far the likeliest.</summary>
    public static int BankruptPerMille(string credit) => credit switch { "A" => 1, "B" => 3, "C" => 8, _ => 25 };

    /// <summary>The weekly odds, in tenths of a percent, of an established broker deciding to close.</summary>
    public const int ClosePerMille = 3;

    /// <summary>The weekly odds, in percent, of a broker's credit grade moving one step.</summary>
    public const int CreditMovesPct = 6;

    /// <summary>How long a settlement claim takes, and the share of what was owed it gets back.</summary>
    public const int SettleMinDays = 14, SettleMaxDays = 28;
    public const decimal SettleMinShare = 0.05m, SettleMaxShare = 0.20m;

    /// <summary>Forced outcomes for the next Friday, for the tests only (see /api/test/market). Never set in play.</summary>
    public static readonly List<(string BrokerOrRegion, string Kind)> Forced = new();

    /// <summary>
    /// Every Friday evening passed since the last look, in order. Before each, invoices due by then are paid, so a broker
    /// who paid on the Thursday has paid before going under on the Friday.
    /// </summary>
    public static void Advance(OoCareer c)
    {
        if (!c.Started || GameClock.TryParse(c.Game.Status.GameTime) is not { } now) return;
        var m = c.Market;
        var latest = LatestFriday(now);
        // First look on a career (new, or from before 0.92): the count starts here. No old Fridays replayed.
        if (m.LastFriday is null) { m.LastFriday = latest; return; }
        for (var day = m.LastFriday.Value + 7; day <= latest; day += 7)
        {
            var at = GameClock.FromDay(day, FridayHour, 0);
            Receivables.Advance(c, at);
            Friday(c, day, at);
            m.LastFriday = day;
        }
    }

    /// <summary>The game day of the last Friday whose evening has passed.</summary>
    public static int LatestFriday(DateTime now)
    {
        // Day 1 is a Monday, so Fridays are days 5, 12, 19... Before Day 5, the Friday before the career: day -2.
        var today = GameClock.DayOf(now);
        var day = today - ((today - 5) % 7 + 7) % 7;
        var evening = GameClock.FromDay(1, FridayHour, 0).AddDays(day - 1);
        return now >= evening ? day : day - 7;
    }

    private static int Roll(OoCareer c, string what) =>
        BrokerBook.Stable($"{c.Profile.HomeCity}|{c.Profile.StartedGameTime}|{what}");

    /// <summary>One Friday: failures, closures and credit moves for each broker, then new openings by region.</summary>
    public static MarketReport Friday(OoCareer c, int day, DateTime at)
    {
        var when = GameClock.Format(at);
        var news = new List<MarketNews>();
        var forced = Forced.ToList();
        Forced.Clear();
        string? ForcedFor(string key) => forced.FirstOrDefault(f => f.BrokerOrRegion == key).Kind;

        foreach (var b in c.Brokers.Where(b => b.Kind == "Broker" && b.IsTrading()).ToList())
        {
            var region = b.Regions.FirstOrDefault() ?? "";
            var force = ForcedFor(b.Id);
            var fails = force == "Bankrupt" || (force == null && Roll(c, $"fail|{day}|{b.Id}") % 1000 < BankruptPerMille(b.Credit));
            // Only a broker who has been around a while retires: one opened this year is still building.
            var old = b.OpenedGameTime.Length == 0 || (GameClock.HoursBetween(b.OpenedGameTime, when) ?? 0) >= 26 * 7 * 24;
            var closes = force == "Closed" || (force == null && !fails && old && Roll(c, $"close|{day}|{b.Id}") % 1000 < ClosePerMille);
            if ((fails || closes) && LastDoorIn(c, b))
                fails = closes = false;
            if (fails) { news.Add(GoUnder(c, b, region, when)); continue; }
            if (closes) { news.Add(Close(c, b, region, when)); continue; }

            var moves = force is "Up" or "Down" || (force == null && Roll(c, $"credit|{day}|{b.Id}") % 100 < CreditMovesPct);
            if (!moves) continue;
            // New brokers are getting established: their grade climbs more often than it falls.
            var upOdds = b.OpenedGameTime.Length > 0 ? 65 : 50;
            var up = force == "Up" || (force != "Down" && Roll(c, $"dir|{day}|{b.Id}") % 100 < upOdds);
            var to = Step(b.Credit, up);
            if (to == b.Credit) continue;
            var from = b.Credit;
            b.Credit = to;
            news.Add(new MarketNews
            {
                Kind = up ? "Up" : "Down", BrokerId = b.Id, BrokerName = b.Name, Region = region, From = from, To = to,
                Said = up ? $"{b.Name}'s credit went up, {from} to {to}: {BrokerBook.CreditSays(to)}"
                          : $"{b.Name}'s credit went down, {from} to {to}: {BrokerBook.CreditSays(to)}",
            });
        }

        foreach (var region in Regions(c))
        {
            var start = c.Brokers.Count(b => b.Kind == "Broker" && b.OpenedGameTime.Length == 0 && b.Regions.Contains(region));
            var trading = c.Brokers.Count(b => b.Kind == "Broker" && b.IsTrading() && b.Regions.Contains(region));
            var force = ForcedFor(region) == "New";
            if (!force && trading >= start + 2) continue;
            // Fewer than at the start: a gap in the market, and somebody fills it sooner.
            var chance = Math.Min(50, 4 + 10 * Math.Max(0, start - trading));
            if (!force && Roll(c, $"open|{day}|{region}") % 100 >= chance) continue;
            var nb = Open(c, region, day, when);
            news.Add(new MarketNews
            {
                Kind = "New", BrokerId = nb.Id, BrokerName = nb.Name, Region = region, To = nb.Credit,
                Said = $"{nb.Name} opened in {nb.City}, {nb.State}. New, so {nb.Credit} credit while they get established: they take new authorities.",
            });
        }

        // New brokers in reached regions join the directory now; elsewhere they join when the region is reached.
        BrokerBook.Refresh(c);
        var known = news.Where(n => c.Brokers.FirstOrDefault(b => b.Id == n.BrokerId) is { Known: true }).ToList();
        // A quiet week is reported too: no report at all reads as the feature not working. Asked for from play.
        var report = new MarketReport { Day = day, GameTime = when, News = known };
        c.Market.Reports.Add(report);
        OoStore.Log(c, "broker", known.Count == 0
            ? $"Friday Day {day}: nothing changed among the brokers you know."
            : $"Friday Day {day}, the brokers' week: " + string.Join(" ", known.Select(n => n.Said)));
        return report;
    }

    /// <summary>The regions brokers work: those of the brokers made at the start.</summary>
    private static IEnumerable<string> Regions(OoCareer c) =>
        c.Brokers.Where(b => b.Kind == "Broker").SelectMany(b => b.Regions).Distinct().OrderBy(r => r);

    private static string Step(string credit, bool up)
    {
        const string grades = "ABCD";
        var i = grades.IndexOf(credit);
        if (i < 0) return credit;
        return grades[Math.Clamp(up ? i - 1 : i + 1, 0, 3)].ToString();
    }

    /// <summary>
    /// A broker who takes new authorities and books ordinary freight: every region keeps at least one, so a carrier who
    /// is new there always has someone to call.
    /// </summary>
    public static bool Door(Broker b) =>
        b.Kind == "Broker" && b.Specialty == Specialties.General && b.RequiresLoads == 0 && b.RequiresDays == 0;

    /// <summary>True when this broker going would leave a region they work with nobody who takes new authorities.</summary>
    private static bool LastDoorIn(OoCareer c, Broker going) =>
        Door(going) && going.Regions.Any(r => !c.Brokers.Any(b => b.Id != going.Id && b.IsTrading() && Door(b) && b.Regions.Contains(r)));

    private static MarketNews GoUnder(OoCareer c, Broker b, string region, string when)
    {
        b.Status = BrokerStatus.Bankrupt;
        b.StatusGameTime = when;
        var owed = 0m;
        foreach (var inv in c.Invoices.Where(i => i.BrokerId == b.Id))
        {
            if (inv.Status is "Open" or "Overdue" or "Collections")
            {
                inv.Status = "Bankrupt";
                owed += inv.Amount + (inv.DetentionStatus is "Billed" or "Granted" ? inv.DetentionAmount : 0);
            }
            else if (inv.Status == "Factored")
            {
                // Sold without recourse: the factor carries the loss, not the player.
                inv.Status = "Paid";
                inv.PaidGameTime = when;
                OoStore.Log(c, "money", $"{b.Name} went bankrupt owing on {inv.Number}. It was sold to a factor: their loss, not yours.", inv.Number);
            }
        }
        CancelLanes(c, b, "went bankrupt");
        var said = $"{b.Name} went bankrupt." + (owed > 0
            ? $" They owe you {Units.Money(owed)}: claim a settlement on the Money tab for a little of it back, in time."
            : " They owed you nothing.");
        return new MarketNews { Kind = "Bankrupt", BrokerId = b.Id, BrokerName = b.Name, Region = region, From = b.Credit, Said = said };
    }

    private static MarketNews Close(OoCareer c, Broker b, string region, string when)
    {
        b.Status = BrokerStatus.Closed;
        b.StatusGameTime = when;
        var owing = c.Invoices.Count(i => i.BrokerId == b.Id && i.Status is "Open" or "Overdue" or "Collections");
        CancelLanes(c, b, "closed");
        var said = $"{b.Name} closed its doors: no more calls." + (owing > 0 ? $" They still pay the {owing} invoice(s) they owe you." : "");
        return new MarketNews { Kind = "Closed", BrokerId = b.Id, BrokerName = b.Name, Region = region, From = b.Credit, Said = said };
    }

    /// <summary>A lane booked with a broker who has gone: there is nobody to give the load. The load on the truck still runs.</summary>
    private static void CancelLanes(OoCareer c, Broker b, string why)
    {
        foreach (var lane in c.Lanes.Where(l => l.BrokerId == b.Id && l.Status == "Booked"))
        {
            lane.Status = "Cancelled";
            OoStore.Log(c, "broker", $"{lane.Number} is off: {b.Name} {why}. Find the next load with another broker.", lane.Number);
        }
    }

    /// <summary>A new broker, opening in a region: a starter on poor credit, taking new authorities.</summary>
    private static Broker Open(OoCareer c, string region, int day, string when)
    {
        var seed = Roll(c, $"new|{day}|{region}");
        var rng = new Random(seed);
        var cities = Markets.BuiltIn.Where(x => x.HasGarage && Carriers.AtsRegionOf(x.State) == region).ToList();
        if (cities.Count == 0) cities = Markets.BuiltIn.Where(x => x.HasGarage).ToList();
        var at = cities[rng.Next(cities.Count)];
        var taken = c.Brokers.Select(b => b.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var name = BrokerBook.NewName(rng, taken);
        var reps = c.Brokers.Select(b => b.Rep).ToHashSet();
        var rep = BrokerBook.NewRep(rng, reps);
        // Getting established: half open at D, half at C. A rookie on the phone more often than not.
        var credit = rng.Next(2) == 0 ? "D" : "C";
        var personality = rng.Next(3) == 0 ? Personalities.All[rng.Next(Personalities.All.Length)].Id : "Rookie";
        var next = c.Brokers.Select(b => int.TryParse(b.Id.TrimStart('B'), out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        var wobble = (decimal)(rng.NextDouble() * 0.04 - 0.02);
        var b = new Broker
        {
            Id = $"B{next:00}",
            Name = name,
            Rep = rep,
            Tier = BrokerTiers.Starter,
            Personality = personality,
            City = at.City,
            State = at.State,
            Regions = new() { region },
            TargetMargin = 0.28m + wobble,
            MinMargin = 0.18m + wobble,
            DaysToPay = rng.Next(2) == 0 ? 30 : 45,
            QuickPayFeePct = 2 + rng.Next(4),
            Credit = credit,
            OpenedGameTime = when,
        };
        c.Brokers.Add(b);
        return b;
    }

    // ---------------------------------------------------------------- reputation, and being turned down

    /// <summary>
    /// What the brokers of a region say about you: built on the loads hauled out of it (on time is good, late is bad, a
    /// claim or a load handed back worse) and on your standing with its brokers. -100 to 100; 0 is unknown.
    /// </summary>
    public static int Reputation(OoCareer c, string region)
    {
        if (region.Length == 0) return 0;
        var score = 0.0;
        foreach (var k in c.Bookings.Where(k => Carriers.AtsRegionOf(k.Load.OriginState) == region))
        {
            if (k.Status == BookingStatus.Delivered)
            {
                score += k.Late && !k.LateExcused ? -6 : 3;
                if (k.CargoDamagePct >= 1) score -= 10;
            }
            else if (k.Status == BookingStatus.Cancelled && k.OnCarrier) score -= 15;
        }
        var worked = c.Brokers.Where(b => b.LoadsBooked > 0 && b.Regions.Contains(region)).ToList();
        if (worked.Count > 0) score += worked.Average(b => b.Standing) / 4.0;
        return (int)Math.Round(Math.Clamp(score, -100, 100));
    }

    public static string RepWords(int rep, bool any) => !any ? "Unknown" : rep switch
    {
        >= 60 => "Strong",
        >= 25 => "Good",
        > -20 => "Fair",
        > -50 => "Poor",
        _ => "Bad",
    };

    /// <summary>The region a call to this broker is about: where the truck is, if they work it, else their own.</summary>
    public static string RegionFor(OoCareer c, Broker b, string? where = null)
    {
        var here = where ?? Carriers.AtsRegionOf(c.Game.Status.LocationState);
        return b.Regions.Contains(here) ? here : b.Regions.FirstOrDefault() ?? here;
    }

    /// <summary>
    /// The odds, in percent, that a broker above the starters gives today's freight to someone more experienced: high for a
    /// new carrier, gone by forty loads; a good name in the region brings it down, a bad one up (and keeps some of it even
    /// for an old hand). A broker who knows you well (standing 30 or more) never does. Starters want new carriers.
    /// </summary>
    public static int RefusalPct(OoCareer c, Broker b, string region)
    {
        if (b.Tier == BrokerTiers.Starter || b.Standing >= 30) return 0;
        var basePct = b.Tier == BrokerTiers.Premium ? 45.0 : 30.0;
        var loads = BrokerBook.Record(c).Loads;
        var newness = Math.Max(0, 1 - loads / 40.0);
        var rep = Reputation(c, region);
        var mult = rep >= 0 ? 1 - rep / 100.0 : 1 + -rep / 50.0;
        var floor = rep < 0 ? -rep / 2.0 : 0;
        return (int)Math.Round(Math.Min(90, basePct * newness * mult + floor));
    }

    /// <summary>Whether this broker turns you down today. Decided once a game day: calling back the same day changes nothing.</summary>
    public static bool Refuses(OoCareer c, Broker b, string region)
    {
        var pct = RefusalPct(c, b, region);
        if (pct <= 0) return false;
        var day = GameClock.DayOf(c.Game.Status.GameTime) ?? 0;
        return Roll(c, $"refuse|{day}|{b.Id}") % 100 < pct;
    }

    // ---------------------------------------------------------------- settlements

    /// <summary>
    /// Claiming against a bankrupt broker: in two to four weeks, five to twenty cents on the dollar. Decided at the claim.
    /// </summary>
    public static string Settle(OoCareer c, Invoice inv)
    {
        if (inv.Status != "Bankrupt") throw new InvalidOperationException("Only an invoice on a bankrupt broker is settled.");
        var now = GameClock.TryParse(c.Game.Status.GameTime) ?? DateTime.MinValue;
        var roll = Roll(c, "settle|" + inv.Id);
        inv.Status = "Claimed";
        inv.SettlementShare = SettleMinShare + (roll % 16) / 100m;
        inv.PaysGameTime = GameClock.Format(now.AddDays(SettleMinDays + roll / 16 % (SettleMaxDays - SettleMinDays + 1)));
        inv.WillPay = true;
        var said = $"{inv.Number}: claim filed against {inv.BrokerName}'s estate. Expect a small share of it around {GameClock.Pretty(inv.PaysGameTime)}.";
        OoStore.Log(c, "money", said, inv.Number);
        return said;
    }

    // ---------------------------------------------------------------- what the player sees

    public static object View(OoCareer c)
    {
        var regions = c.Brokers.Where(b => b.Known && b.Kind == "Broker").SelectMany(b => b.Regions).Distinct().OrderBy(r => r).ToList();
        return new
        {
            unseen = c.Market.Reports.Where(r => !r.Seen).ToList(),
            recent = c.Market.Reports.TakeLast(6).Reverse().ToList(),
            lastFriday = c.Market.LastFriday,
            reputation = regions.Select(r =>
            {
                var rep = Reputation(c, r);
                var any = c.Bookings.Any(k => Carriers.AtsRegionOf(k.Load.OriginState) == r && k.Status is BookingStatus.Delivered or BookingStatus.Cancelled)
                          || c.Brokers.Any(b => b.LoadsBooked > 0 && b.Regions.Contains(r));
                return new { region = r, score = rep, words = RepWords(rep, any) };
            }).ToList(),
        };
    }

    public static void MarkSeen(OoCareer c)
    {
        foreach (var r in c.Market.Reports) r.Seen = true;
    }
}
