using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What the fuel receipts are worth, beyond a line in the cost model.
///
/// Every stop the driver logs already carried the state, the gallons and the price per gallon, and
/// none of it did anything except get totalled. Two real skills were going unrewarded:
///
/// <list type="number">
///   <item><b>Driving the truck economically.</b> Measured against what the tractor is rated for, which
///     is a bar the driver can see on the Fleet tab and which does not move when they do well.</item>
///   <item><b>Knowing where to buy.</b> Crossing into California with the tanks full is worth real money,
///     and the app knew enough to say so and never did.</item>
/// </list>
///
/// Both are paid on the settlement, beside the on-time and safety bonuses, and for the same reason those
/// are: a per-load bonus is farmable by settling after every load, where a period of good running is
/// not. Neither can ever go negative — an expensive fill has already cost the driver at the pump, and
/// billing them again for one decision is charging twice. The advice arrives before the state line
/// instead, which is when it is any use.
/// </summary>
public static class Fuel
{
    /// <summary>
    /// What a gallon costs in each state, relative to the average across the states ATS covers.
    ///
    /// A starting guess, and only that: it is replaced per state by what the driver has actually paid
    /// as soon as there are enough receipts to mean something. That matters because these are real-world
    /// figures and the game is not the real world — and because a fuel-price mod would make every one of
    /// them wrong, while the driver's own receipts would still be right.
    ///
    /// The shape is what carries: California and the Pacific Northwest dear, the Gulf and the plains
    /// cheap. That much holds in the game.
    /// </summary>
    private static readonly Dictionary<string, double> StateIndex = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CA"] = 1.335, ["WA"] = 1.221, ["OR"] = 1.112, ["NV"] = 1.100,
        ["AZ"] = 1.032, ["ID"] = 0.987, ["CO"] = 0.980, ["UT"] = 0.978,
        ["MT"] = 0.977, ["WY"] = 0.973, ["MN"] = 0.970, ["NM"] = 0.968,
        ["IA"] = 0.966, ["MO"] = 0.943, ["SD"] = 0.934, ["ND"] = 0.932,
        ["AR"] = 0.932, ["NE"] = 0.923, ["KS"] = 0.921, ["TX"] = 0.918,
        ["OK"] = 0.898,
    };

    /// <summary>Receipts in one state before the driver's own figures replace the table for it.</summary>
    public const int StopsToLearnAState = 3;

    /// <summary>
    /// How many game days back a receipt still counts toward what a state costs today.
    ///
    /// Prices move — in the game, and certainly if somebody installs an economy mod mid-career. A
    /// career-lifetime average would never notice: a hundred old receipts would outvote the three that
    /// describe what the pump is charging now. A window means the figures follow the game, and it means
    /// a state the driver has not visited in months honestly reads as out of date rather than as fact.
    /// </summary>
    public const int LearnedWindowDays = 90;

    /// <summary>Game days after which a state's own figure is called stale and worth re-checking.</summary>
    public const int StaleAfterDays = 60;

    /// <summary>How far over rated mpg earns the efficiency bonus in full.</summary>
    public const double FullEfficiencyAt = 0.10;

    /// <summary>Where a state stops being worth a warning on the way in.</summary>
    public const double ExpensiveStateIndex = 1.08;

    /// <summary>What a gallon is taken to cost before anywhere in particular is considered.</summary>
    public static decimal Reference(AppState s) =>
        s.Settings.FuelPricePerGal > 0 ? s.Settings.FuelPricePerGal : 3.90m;

    /// <summary>Every fuel stop the driver has ever logged.</summary>
    public static IEnumerable<FuelPurchase> AllStops(AppState s) =>
        s.Trips.SelectMany(t => t.FuelStops).Where(f => f.Gallons > 0 && f.PricePerGal > 0);

    /// <summary>Today, as a game day number, or null when the clock has never been reported.</summary>
    private static int? Today(AppState s) => GameClock.DayOf(s.Status.GameTime);

    /// <summary>How many game days ago a receipt was written, or null when it carries no time.</summary>
    private static int? AgeInDays(AppState s, FuelPurchase f) =>
        Today(s) is { } now && GameClock.DayOf(f.GameTime) is { } then ? Math.Max(0, now - then) : null;

    /// <summary>Stops in a state recent enough to describe what it costs now.</summary>
    private static List<FuelPurchase> RecentIn(AppState s, string state)
    {
        var mine = AllStops(s)
            .Where(f => f.State.Equals(state, StringComparison.OrdinalIgnoreCase))
            .ToList();

        // A receipt with no game time on it still counts — it is a real reading, and refusing it would
        // silently drop every stop logged before times were recorded.
        var windowed = mine.Where(f => AgeInDays(s, f) is not { } age || age <= LearnedWindowDays).ToList();
        return windowed.Count > 0 ? windowed : mine;
    }

    /// <summary>
    /// What a gallon costs in a state, relative to the reference, and where that figure came from.
    ///
    /// Learned beats the table the moment there is enough to learn from, because the driver's own
    /// receipts are the only figures in this app that are certainly true of their game.
    /// </summary>
    public static (double Index, string Source, int Stops) IndexFor(AppState s, string? state)
    {
        var st = (state ?? "").Trim();
        if (st.Length == 0) return (1.0, "unknown", 0);

        var mine = RecentIn(s, st);
        if (mine.Count >= StopsToLearnAState)
        {
            var avg = mine.Average(f => f.PricePerGal);
            return ((double)(avg / Reference(s)), "your receipts", mine.Count);
        }

        return StateIndex.TryGetValue(st, out var idx)
            ? (idx, "typical", mine.Count)
            : (1.0, "unknown", mine.Count);
    }

    /// <summary>What a gallon is expected to cost in a state.</summary>
    public static decimal ExpectedPrice(AppState s, string? state) =>
        Math.Round(Reference(s) * (decimal)IndexFor(s, state).Index, 2);

    /// <summary>
    /// Worth saying something about before the driver crosses into it, or null.
    ///
    /// Only ever advice. The money is not taken off anybody for ignoring it — the pump already did that.
    /// </summary>
    public static string? CrossingAdvice(AppState s, string? fromState, string? toState)
    {
        var to = (toState ?? "").Trim();
        var from = (fromState ?? "").Trim();
        if (to.Length == 0 || to.Equals(from, StringComparison.OrdinalIgnoreCase)) return null;

        var (there, source, _) = IndexFor(s, to);
        if (there < ExpensiveStateIndex) return null;

        var (here, _, _) = IndexFor(s, from);
        if (there <= here + 0.02) return null;   // no better where they are standing

        var over = (there - here) / Math.Max(here, 0.01) * 100;
        return $"Diesel in {to} runs about {over:0}% over what you pay in {from} " +
               $"(${ExpectedPrice(s, to):N2} against ${ExpectedPrice(s, from):N2} a gallon, {source}). " +
               "Fill before you cross if the tanks will take it.";
    }

    /// <summary>One state on the price board.</summary>
    public sealed class StatePrice
    {
        public string State { get; set; } = "";
        public decimal PerGallon { get; set; }
        public double Index { get; set; }
        /// <summary>"your receipts" | "typical" | "unknown"</summary>
        public string Source { get; set; } = "";
        public int Stops { get; set; }
        /// <summary>Game days since the last receipt here, or -1 where there is none.</summary>
        public int DaysSinceSeen { get; set; } = -1;
        /// <summary>Learned from receipts old enough to be worth re-checking.</summary>
        public bool Stale { get; set; }
        public bool Here { get; set; }
    }

    /// <summary>
    /// What fuel costs everywhere, cheapest first, so a route can be planned around it.
    ///
    /// This is the half of the feature that is worth more than the bonus. Being paid a share of what you
    /// saved is pleasant; being told before you set off that you are about to cross into the most
    /// expensive state on the map is what actually changes a decision.
    /// </summary>
    public static List<StatePrice> PriceBoard(AppState s)
    {
        var here = (s.Status.LocationState ?? "").Trim();
        var seen = new HashSet<string>(StateIndex.Keys, StringComparer.OrdinalIgnoreCase);
        foreach (var f in AllStops(s)) seen.Add(f.State.Trim().ToUpperInvariant());

        var board = new List<StatePrice>();
        foreach (var st in seen.Where(x => x.Length == 2))
        {
            var (index, source, stops) = IndexFor(s, st);
            if (source == "unknown" && stops == 0) continue;

            var mine = AllStops(s).Where(f => f.State.Equals(st, StringComparison.OrdinalIgnoreCase)).ToList();
            var age = mine.Count == 0 ? -1
                : mine.Select(f => AgeInDays(s, f)).Where(a => a is not null).Select(a => a!.Value)
                      .DefaultIfEmpty(-1).Min();

            board.Add(new StatePrice
            {
                State = st.ToUpperInvariant(),
                PerGallon = Math.Round(Reference(s) * (decimal)index, 2),
                Index = Math.Round(index, 3),
                Source = source,
                Stops = stops,
                DaysSinceSeen = age,
                Stale = source == "your receipts" && age >= StaleAfterDays,
                Here = st.Equals(here, StringComparison.OrdinalIgnoreCase),
            });
        }

        return board.OrderBy(x => x.PerGallon).ToList();
    }

    /// <summary>The cheapest states worth naming, and what the driver is standing in.</summary>
    public static object PlanningView(AppState s)
    {
        var board = PriceBoard(s);
        var here = board.FirstOrDefault(x => x.Here);
        var best = board.Take(5).ToList();
        var stale = board.Count(x => x.Stale);

        return new
        {
            reference = Reference(s),
            here,
            cheapest = best,
            dearest = board.OrderByDescending(x => x.PerGallon).Take(3).ToList(),
            board,
            staleCount = stale,
            note = here == null
                ? "Report in and I will tell you what fuel costs where you are standing."
                : here.Index >= ExpensiveStateIndex
                    ? $"You are in {here.State}, which is dear — ${here.PerGallon:N2} a gallon " +
                      $"({here.Source}). Buy what you need to get out, not a full pair of tanks."
                    : $"{here.State} is {(here.Index <= 0.95 ? "cheap" : "about average")} at " +
                      $"${here.PerGallon:N2} a gallon ({here.Source}). " +
                      (here.Index <= 0.95 ? "Worth filling before you leave." : ""),
            learning = $"A state switches from the typical figure to your own once you have logged " +
                       $"{StopsToLearnAState} stops there, and only counts receipts from the last " +
                       $"{LearnedWindowDays} game days — prices move, and an old reading should not " +
                       "outvote what the pump charged you last week.",
        };
    }

    /// <summary>What a period's fuel earned, and how.</summary>
    public sealed class PeriodFuel
    {
        public double Miles { get; set; }
        public double Gallons { get; set; }
        /// <summary>Miles per gallon actually achieved, or 0 when nothing was logged.</summary>
        public double Mpg { get; set; }
        /// <summary>What the tractor is rated for.</summary>
        public double RatedMpg { get; set; }
        public decimal EfficiencyBonus { get; set; }

        /// <summary>Money not spent, against what a gallon costs before anywhere in particular.</summary>
        public decimal Saved { get; set; }
        public decimal BuyingBonus { get; set; }
        public List<string> Lines { get; set; } = new();
    }

    /// <summary>
    /// Works out both fuel bonuses for a settlement period.
    ///
    /// Efficiency is judged against the tractor's rating rather than the driver's own recent average.
    /// A rolling bar would climb every time they did well, so a driver holding 7.2 mpg on a 6.5 truck
    /// would eventually earn nothing for it — which is the opposite of the point.
    ///
    /// Buying is judged against the reference price, NOT against what that state usually costs. Judging
    /// a California fill against California prices would pay for finding a cheap pump in an expensive
    /// state, when the thing worth rewarding is not filling up there at all.
    /// </summary>
    public static PeriodFuel Assess(AppState s, List<Trip> trips)
    {
        var cfg = s.Driver.Pay;
        var truck = DispatchEngine.AssignedTruck(s);
        var r = new PeriodFuel { RatedMpg = truck?.AvgMpg > 0 ? truck.AvgMpg : 6.5 };

        var stops = trips.SelectMany(t => t.FuelStops).Where(f => f.Gallons > 0).ToList();
        r.Gallons = Math.Round(stops.Sum(f => f.Gallons), 1);
        r.Miles = Math.Round(trips.Sum(t => t.DispatchedMiles + t.DeadheadMiles), 0);

        if (r.Gallons <= 0 || r.Miles <= 0)
        {
            r.Lines.Add("No fuel logged this period, so there is nothing to judge the driving on.");
            return r;
        }

        // ---- what the driving was worth
        r.Mpg = Math.Round(r.Miles / r.Gallons, 2);
        var over = (r.Mpg - r.RatedMpg) / Math.Max(r.RatedMpg, 0.1);
        if (over > 0 && cfg.FuelEfficiencyBonusCpm > 0)
        {
            var share = Math.Clamp(over / FullEfficiencyAt, 0, 1);
            var loaded = trips.Sum(t => t.DispatchedMiles) * Math.Clamp(s.Settings.PayMileMultiplier, 0.1, 20.0);
            r.EfficiencyBonus = Math.Round((decimal)loaded * cfg.FuelEfficiencyBonusCpm * (decimal)share, 2);
            r.Lines.Add($"Fuel economy: {r.Mpg:0.00} mpg against {r.RatedMpg:0.0} rated — " +
                        $"{over * 100:0.#}% better. Bonus ${r.EfficiencyBonus:N2}.");
        }
        else
        {
            r.Lines.Add($"Fuel economy: {r.Mpg:0.00} mpg against {r.RatedMpg:0.0} rated. " +
                        "No economy bonus this period.");
        }

        // ---- what the buying was worth
        //
        // Measured against the best price available ON THE RUN, not against one flat national figure.
        // A driver sent San Diego to Redding has to buy in California; judging that fill against
        // Oklahoma prices marks them down for a lane dispatch chose, which is the same mistake as
        // counting damage somebody else did to them.
        var stranded = new List<string>();

        foreach (var trip in trips)
        {
            var onThis = trip.FuelStops.Where(f => f.Gallons > 0 && f.PricePerGal > 0).ToList();
            if (onThis.Count == 0) continue;

            var best = BestAvailableOn(s, trip, onThis, out var hadAChoice);
            foreach (var f in onThis)
            {
                var under = best - f.PricePerGal;
                if (under > 0) r.Saved += Math.Round(under * (decimal)f.Gallons, 2);
            }

            // Worth naming only where somewhere cheaper was actually on the run. Where it was not, the
            // driver had no decision to get wrong and there is nothing to say to them about it.
            if (!hadAChoice) continue;
            foreach (var g in onThis.Where(f => f.PricePerGal > best * 1.05m)
                                    .GroupBy(f => f.State.ToUpperInvariant()))
            {
                var overpaid = g.Sum(x => (x.PricePerGal - best) * (decimal)x.Gallons);
                stranded.Add($"{g.Sum(x => x.Gallons):N0} gal bought in {g.Key} on {trip.Number} at over " +
                             $"the odds — about ${overpaid:N0} more than the same fill earlier on that run. " +
                             "Not charged for; worth planning around.");
            }
        }

        if (r.Saved > 0 && cfg.FuelSavingShare > 0)
        {
            r.BuyingBonus = Math.Round(r.Saved * cfg.FuelSavingShare, 2);
            r.Lines.Add($"Fuel buying: ${r.Saved:N2} saved against the cheapest state each run passed " +
                        $"through, across {r.Gallons:N0} gal. Your share ${r.BuyingBonus:N2}.");
        }

        foreach (var line in stranded.Take(2)) r.Lines.Add(line);

        // Said once, so a driver working an expensive corner of the map knows the app can tell a bad
        // decision from a bad lane.
        var forced = trips.Count(t => t.FuelStops.Any(f => f.Gallons > 0) && !HadACheaperOption(s, t));
        if (forced > 0)
            r.Lines.Add($"{forced} run(s) never left an expensive state, so there was nowhere cheaper to " +
                        "buy. Judged on the pumps that were actually available.");

        return r;
    }

    /// <summary>
    /// The cheapest a gallon could reasonably have been bought for on a given run.
    ///
    /// Origin and destination are always in the reckoning, plus wherever the driver actually stopped.
    /// Including the stops cannot open a loophole: origin and destination are in there too, so a poor
    /// choice can never pull the bar below what the lane itself offered.
    /// </summary>
    private static decimal BestAvailableOn(AppState s, Trip trip, List<FuelPurchase> stops,
                                           out bool hadACheaperOption)
    {
        var states = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(trip.OriginState)) states.Add(trip.OriginState.Trim());
        if (!string.IsNullOrWhiteSpace(trip.DestState)) states.Add(trip.DestState.Trim());
        foreach (var f in stops)
            if (!string.IsNullOrWhiteSpace(f.State)) states.Add(f.State.Trim());

        if (states.Count == 0)
        {
            hadACheaperOption = false;
            return Reference(s);
        }

        var prices = states.Select(x => ExpectedPrice(s, x)).ToList();
        var best = prices.Min();

        // Was anywhere on this run meaningfully cheaper than the dearest part of it? If not, the lane
        // offered no decision and the driver must not be judged as though it did.
        hadACheaperOption = prices.Max() > best * 1.05m;
        return best;
    }

    /// <summary>Whether a run passed through anywhere cheaper than its dearest point.</summary>
    private static bool HadACheaperOption(AppState s, Trip trip)
    {
        var stops = trip.FuelStops.Where(f => f.Gallons > 0 && f.PricePerGal > 0).ToList();
        BestAvailableOn(s, trip, stops, out var choice);
        return choice;
    }
}
