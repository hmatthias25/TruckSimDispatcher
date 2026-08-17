using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Tracks which cities the driver has actually reached, and tells them when one of those cities is
/// worth buying a yard in.
///
/// This exists to work around a real ATS behaviour rather than to add flavour. Revealing cities with
/// a save editor does not mark them discovered, and an undiscovered city never generates cargo — so
/// a yard bought there would sit empty and a truck based there would have nothing to haul. The
/// carrier's network therefore has to grow the way a real one does: you get there first, then you
/// decide whether it earns a terminal.
/// </summary>
public static class DiscoveryService
{
    /// <summary>What operations says when the driver reaches somewhere new.</summary>
    public class DiscoveryNotice
    {
        public string City { get; set; } = "";
        public string State { get; set; } = "";
        public string Place { get; set; } = "";
        public string Headline { get; set; } = "";
        public List<string> Detail { get; set; } = new();
        public bool GarageAvailable { get; set; }
        public bool Recommended { get; set; }
        public int Tier { get; set; } = 2;
        public bool ResetFriendly { get; set; }
    }

    public static DiscoveredCity? Find(AppState s, string? city, string? state) =>
        s.Discovered.FirstOrDefault(d =>
            d.City.Equals((city ?? "").Trim(), StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(d.State) ||
             d.State.Equals((state ?? "").Trim(), StringComparison.OrdinalIgnoreCase)));

    public static bool IsDiscovered(AppState s, string? city, string? state) => Find(s, city, state) != null;

    /// <summary>
    /// Records that the truck is in a city. Returns a notice only the first time, and only when there
    /// is something for the driver to act on — reaching a city we already know about is not news.
    /// </summary>
    public static DiscoveryNotice? Note(AppState s, string? city, string? state,
        string? gameTime = null, string tripNumber = "")
    {
        var c = (city ?? "").Trim();
        if (c.Length == 0) return null;
        var st = (state ?? "").Trim().ToUpperInvariant();

        SyncOwnership(s);

        var existing = Find(s, c, st);
        if (existing != null)
        {
            // Fill in a state we did not have the first time through.
            if (string.IsNullOrWhiteSpace(existing.State) && st.Length > 0) existing.State = st;
            if (string.IsNullOrWhiteSpace(existing.TripNumber) && tripNumber.Length > 0)
                existing.TripNumber = tripNumber;
            return null;
        }

        var market = Markets.Find(s, c, st);
        var entry = new DiscoveredCity
        {
            City = c,
            State = st,
            DiscoveredGameTime = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime,
            TripNumber = tripNumber,
            GarageAvailable = market?.HasGarage ?? true,
            GarageOwned = s.Company.Terminals.Any(t => Same(t.City, c) && (st.Length == 0 || Same(t.State, st))),
            Notes = market == null ? "Not in the market table — freight strength unknown." : ""
        };
        s.Discovered.Add(entry);

        var tier = market?.Tier ?? 2;
        var notice = new DiscoveryNotice
        {
            City = c, State = st,
            Place = DispatchEngine.Place(c, st),
            GarageAvailable = entry.GarageAvailable && !entry.GarageOwned,
            Tier = tier,
            ResetFriendly = market?.ResetFriendly ?? false
        };

        if (entry.GarageOwned)
        {
            notice.Headline = $"First run into {notice.Place} — we already have a yard here.";
            entry.Notified = true;
            store_Log(s, $"Discovered {notice.Place} (existing company yard).");
            return notice;
        }

        if (!entry.GarageAvailable)
        {
            notice.Headline = $"New city: {notice.Place}. No garage for sale here.";
            entry.Notified = true;
            store_Log(s, $"Discovered {notice.Place} — no yard available.");
            return notice;
        }

        // Off our employer's network. Still a city we have now reached — which matters, because the
        // freight board here becomes readable — but not somewhere the carrier is opening a terminal.
        // Asking a company driver whether to expand into Wichita is asking the wrong person.
        if (!OnNetwork(s, c, st))
        {
            notice.GarageAvailable = false;
            notice.Headline = $"First run into {notice.Place}. Noted — it is on our map now.";
            notice.Detail.Add(NetworkSummary(s) +
                              $" {notice.Place} is not on that network, so there is no yard here to open. " +
                              "That is not your call to make and it is not mine either.");
            if (market != null)
                notice.Detail.Add($"Tier-{tier} freight market{(market.ResetFriendly ? ", with the parking and services for a 34-hour restart" : "")} — " +
                                  "worth knowing when I am picking loads that end here.");
            entry.Notified = true;
            store_Log(s, $"Discovered {notice.Place} — off network, no yard offered.");
            return notice;
        }

        // Worth a yard? Freight strength and reset facilities are what make one pay for itself.
        notice.Recommended = tier <= 2;
        notice.Headline = $"New city discovered: {notice.Place}. ATS will sell you a garage here.";

        notice.Detail.Add(market == null
            ? "This city is not in our market table, so I cannot tell you how strong the freight is. Watch the board here for a few runs before you spend money on a yard."
            : $"Tier-{tier} freight market{(market.ResetFriendly ? ", and it has the parking and services for a 34-hour restart" : "")}.");

        notice.Detail.Add(tier switch
        {
            1 => "Strong market. A yard here would give you loads out in most directions — worth the money once you have it.",
            2 => "Moderate market. Useful as a relay point, but check the board before committing.",
            _ => "Thin market. A truck based here risks sitting. I would not buy a yard on this one."
        });

        notice.Detail.Add("Buy it in game first — then add it on the Terminals tab so dispatch knows it exists. Price and level are whatever ATS charges you.");
        notice.Detail.Add("Cities you reveal with a save editor rather than drive to never generate cargo, which is why this only fires when you actually arrive.");

        store_Log(s, $"Discovered {notice.Place} — garage available (tier {tier}).");
        return notice;
    }

    /// <summary>Keeps the owned flag in step with the terminal list.</summary>
    public static void SyncOwnership(AppState s)
    {
        foreach (var d in s.Discovered)
            d.GarageOwned = s.Company.Terminals.Any(t => Same(t.City, d.City) &&
                (string.IsNullOrWhiteSpace(d.State) || string.IsNullOrWhiteSpace(t.State) || Same(t.State, d.State)));
    }

    /// <summary>
    /// Is this city somewhere our employer actually runs terminals?
    ///
    /// A company driver does not pick where the carrier opens yards. Prime runs Springfield, Salt Lake
    /// City, Denver and Pittston — delivering to Wichita does not make Wichita a candidate. An empty
    /// network means a fictional carrier with nothing to be faithful to, so anywhere reached counts.
    /// </summary>
    public static bool OnNetwork(AppState s, string? city, string? state)
    {
        var net = s.Company.NetworkCities;
        if (net == null || net.Count == 0) return true;
        return net.Any(n =>
        {
            var parts = n.Split(',', StringSplitOptions.TrimEntries);
            if (parts.Length == 0 || !Same(parts[0], city)) return false;
            var ns = parts.ElementAtOrDefault(1);
            return string.IsNullOrWhiteSpace(ns) || string.IsNullOrWhiteSpace(state) || Same(ns, state);
        });
    }

    /// <summary>How the employer's network reads, for explaining why a city is not on the list.</summary>
    public static string NetworkSummary(AppState s)
    {
        var net = s.Company.NetworkCities ?? new List<string>();
        if (net.Count == 0) return "";
        var places = net.Select(n =>
        {
            var p = n.Split(',', StringSplitOptions.TrimEntries);
            return DispatchEngine.Place(p.ElementAtOrDefault(0) ?? "", p.ElementAtOrDefault(1) ?? "");
        }).ToList();
        var name = string.IsNullOrWhiteSpace(s.Company.Name) ? "We" : s.Company.Name;
        return places.Count == 1
            ? $"{name} runs out of {places[0]}."
            : $"{name} runs out of {string.Join(", ", places.Take(places.Count - 1))} and {places[^1]}.";
    }

    /// <summary>
    /// Cities we have reached, could buy a yard in, and have not yet decided about. This is the list
    /// the dispatch screen nags about — gently, once each.
    ///
    /// Limited to the employer's own network. Offering a yard in every town the truck passes through
    /// makes the driver the one choosing where the carrier expands, which is not the job they have.
    /// </summary>
    public static List<DiscoveredCity> GarageOpportunities(AppState s)
    {
        SyncOwnership(s);
        return s.Discovered
            .Where(d => d.GarageAvailable && !d.GarageOwned && !d.Declined)
            .Where(d => OnNetwork(s, d.City, d.State))
            .OrderBy(d => Markets.Find(s, d.City, d.State)?.Tier ?? 2)
            .ThenBy(d => d.City)
            .ToList();
    }

    /// <summary>Every city reached, with what can actually be done about a yard there.</summary>
    public static List<object> ReachedView(AppState s)
    {
        SyncOwnership(s);
        return s.Discovered
            .OrderByDescending(d => GameClock.TryParse(d.DiscoveredGameTime) ?? DateTime.MinValue)
            .ThenBy(d => d.City)
            .Select(d =>
            {
                var m = Markets.Find(s, d.City, d.State);
                var onNet = OnNetwork(s, d.City, d.State);
                var status = d.GarageOwned ? "Yard here"
                    : !d.GarageAvailable ? "No garage"
                    : !onNet ? "Off network"
                    : d.Declined ? "Dismissed"
                    : "Could buy";
                return (object)new
                {
                    city = d.City,
                    state = d.State,
                    discoveredGameTime = d.DiscoveredGameTime,
                    tripNumber = d.TripNumber,
                    tier = m?.Tier,
                    resetFriendly = m?.ResetFriendly ?? false,
                    onNetwork = onNet,
                    status
                };
            }).ToList();
    }

    /// <summary>
    /// The opportunity list with the freight-market facts folded in, so the UI can rank yards without
    /// having to carry a copy of the market table.
    /// </summary>
    public static List<object> GarageOpportunityView(AppState s) =>
        GarageOpportunities(s).Select(d =>
        {
            var m = Markets.Find(s, d.City, d.State);
            return (object)new
            {
                city = d.City,
                state = d.State,
                discoveredGameTime = d.DiscoveredGameTime,
                tripNumber = d.TripNumber,
                tier = m?.Tier,
                resetFriendly = m?.ResetFriendly ?? false
            };
        }).ToList();

    /// <summary>
    /// Whether a yard in this city would actually see freight. Advisory, not a block — the driver may
    /// well have driven here in an earlier profile, and only they can see their own game.
    /// </summary>
    public static string? YardWarning(AppState s, string city, string state)
    {
        if (s.Discovered.Count == 0) return null;   // nothing tracked yet; do not cry wolf
        if (IsDiscovered(s, city, state)) return null;
        return $"You have not reported being in {DispatchEngine.Place(city, state)} yet. If the city is not " +
               "discovered in your game, ATS will not generate cargo there and a yard would sit empty. " +
               "Add it anyway if you have already driven there.";
    }

    /// <summary>
    /// Seeds the discovered list for a career that predates this tracking, from everywhere the truck
    /// has demonstrably been. Additive — it only ever adds cities we have real evidence for.
    /// </summary>
    public static void Backfill(AppState s)
    {
        void Add(string? city, string? state, string? gameTime, string trip)
        {
            var c = (city ?? "").Trim();
            if (c.Length == 0) return;
            if (Find(s, c, state) != null) return;
            var st = (state ?? "").Trim().ToUpperInvariant();
            var market = Markets.Find(s, c, st);
            s.Discovered.Add(new DiscoveredCity
            {
                City = c, State = st,
                DiscoveredGameTime = gameTime ?? "",
                TripNumber = trip,
                GarageAvailable = market?.HasGarage ?? true,
                Notified = true,          // historic — do not fire a wave of notices on first load
                Notes = "Backfilled from career history."
            });
        }

        // Yards we own, the driver's current position, and every place a trip has touched.
        foreach (var t in s.Company.Terminals) Add(t.City, t.State, s.Driver.HiredGameDate, "");
        Add(s.Status.LocationCity, s.Status.LocationState, s.Status.GameTime, "");
        foreach (var t in s.Trips)
        {
            Add(t.OriginCity, t.OriginState, t.DispatchedGameTime, t.Number);
            Add(t.DestCity, t.DestState, t.DeliveredGameTime, t.Number);
        }
        foreach (var w in s.WorkOrders) Add(w.LocationCity, w.LocationState, w.GameTime, "");
        foreach (var tr in s.Trailers)
        {
            var parts = (tr.CurrentLocation ?? "").Split(',', StringSplitOptions.TrimEntries);
            if (parts.Length >= 1 && parts[0].Length > 0)
                Add(parts[0], parts.ElementAtOrDefault(1), "", "");
        }

        SyncOwnership(s);
    }

    private static bool Same(string? a, string? b) =>
        (a ?? "").Trim().Equals((b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Discovery logging goes through the career event log, but this service is called from inside
    /// mutations that already hold the store lock, so it appends directly.
    /// </summary>
    private static void store_Log(AppState s, string message)
    {
        s.Events.Insert(0, new LogEvent
        {
            Channel = "dispatch",
            Message = message,
            GameTime = s.Status.GameTime
        });
        if (s.Events.Count > 2000) s.Events.RemoveRange(2000, s.Events.Count - 2000);
    }
}
