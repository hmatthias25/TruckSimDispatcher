using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Cabotage: a truck from one country carrying a load that starts and ends inside another. Step 6 of Euro
/// Truck Simulator 2 support (#266, #272). Regulation (EC) 1072/2009 as amended by (EU) 2020/1055, the
/// EU-UK Trade and Cooperation Agreement, and the EU-Switzerland Land Transport Agreement.
///
/// <para><b>The rule, inside the EU and EEA.</b> An international load delivered INTO a host country opens a
/// cabotage period there: up to three domestic loads, with the same truck, within seven days of that
/// unloading. A country entered EMPTY allows one, within three days, counted in the three. When the period
/// ends the truck may do no cabotage in that country for four days, counted from the day after its last
/// unloading there. Loads at home and loads between countries are never restricted.</para>
///
/// <para><b>Outside it.</b> An EU truck in the UK: two, after a laden entry only. Switzerland, Russia, Türkiye,
/// the Balkan states outside the EU, Ukraine, Moldova, Georgia, the Faroes, Andorra and the Middle East: none
/// for a foreign truck. A UK-based company in the EU: one, in the country the UK load was dropped in. A
/// Swiss-based one: none. Sources are in docs/ets2-plan.md.</para>
///
/// <para><b>Refused, never fined.</b> Dispatch will not authorise a load that breaks any of this, and says why.
/// Operations chooses the freight, so a breach could only ever be the dispatcher's — and refusing it is how
/// that is never on anybody's record.</para>
///
/// <para>Counters are kept per truck (<see cref="AppState.CabotageByTruck"/>), because the law is about the
/// vehicle. Hired drivers' trucks are not tracked: their loads are not run here one at a time.</para>
/// </summary>
public static class Cabotage
{
    // ------------------------------------------------------------------ who is where

    private static readonly HashSet<string> Eu = new(StringComparer.OrdinalIgnoreCase)
    {
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
        "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
        "AX",                     // Åland: Finland, and in the EU
        "MC",                     // Monaco: inside the French customs territory for road haulage
    };
    private static readonly HashSet<string> Eea = new(StringComparer.OrdinalIgnoreCase) { "NO", "IS", "LI", "SJ" };
    private static readonly HashSet<string> Uk = new(StringComparer.OrdinalIgnoreCase) { "UK", "GB", "GG", "JE", "IM" };

    public static bool InEuOrEea(string? c) => c != null && (Eu.Contains(c) || Eea.Contains(c));
    public static bool IsUk(string? c) => c != null && Uk.Contains(c);

    /// <summary>Whether this career is under the EU's market rules at all.</summary>
    public static bool Applies(AppState s) => GameProfile.For(s).HosRuleset == "EU561";

    /// <summary>The company's country of establishment: its headquarters yard's country.</summary>
    public static string HomeCountry(AppState s)
    {
        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters) ?? s.Company.Terminals.FirstOrDefault();
        return Norm(hq?.State);
    }

    // ------------------------------------------------------------------ the rule for a pair of countries

    /// <summary>What a truck based in <paramref name="home"/> may do inside <paramref name="host"/>.</summary>
    public sealed record Rule(bool Allowed, int MaxOperations, int WindowDays, bool UnladenEntry, int CoolingDays, string Why);

    public static Rule RuleFor(string home, string host)
    {
        if (IsUk(home))
            return InEuOrEea(host)
                ? new(true, 1, 7, false, 0, "A UK-based truck may do one cabotage job in the EU, in the country it " +
                                           "dropped its load from the UK, within seven days (EU-UK Trade and Cooperation Agreement).")
                : new(false, 0, 0, false, 0, $"A UK-based truck has no cabotage rights in {MapCoverage.Label(host)}.");
        if (Norm(home) == "CH")
            return new(false, 0, 0, false, 0, "A Swiss-based truck may carry loads between EU countries but not domestic " +
                                              "loads inside one (EU-Switzerland Land Transport Agreement).");
        if (!InEuOrEea(home))
            return new(false, 0, 0, false, 0, $"A truck based in {MapCoverage.Label(home)} has no cabotage rights in {MapCoverage.Label(host)}.");

        if (InEuOrEea(host))
            return new(true, 3, 7, true, 4, "Up to three cabotage loads within seven days of an international delivery " +
                                            "into the country, then four days off (Regulation 1072/2009).");
        if (IsUk(host))
            return new(true, 2, 7, false, 0, "An EU truck may do two cabotage loads in the UK within seven days of a laden " +
                                             "delivery into it, and none after arriving empty (EU-UK Trade and Cooperation Agreement).");
        if (Norm(host) == "CH")
            return new(false, 0, 0, false, 0, "Switzerland bans cabotage by foreign trucks outright (EU-Switzerland Land " +
                                              "Transport Agreement). International loads into, out of and through it are fine.");
        return new(false, 0, 0, false, 0, $"{MapCoverage.Label(host)} gives foreign trucks no cabotage rights — international " +
                                          "loads in and out are fine, domestic ones are not.");
    }

    // ------------------------------------------------------------------ what a load is

    /// <summary>Domestic (home country), International (between two countries) or Cabotage (inside a foreign one).</summary>
    public static (string Kind, string Host) Classify(AppState s, string? origin, string? dest)
    {
        var o = Norm(string.IsNullOrWhiteSpace(origin) ? s.Status.LocationState : origin);
        var d = Norm(dest);
        var home = HomeCountry(s);
        if (o.Length == 0 || d.Length == 0) return ("Unknown", "");
        if (o != d) return ("International", "");
        if (o == home) return ("Domestic", "");
        return ("Cabotage", o);
    }

    // ------------------------------------------------------------------ the truck's state

    /// <summary>The assigned truck's state, for reading. Never adds an entry: reads must not write.</summary>
    public static CabotageState Peek(AppState s) =>
        s.CabotageByTruck.TryGetValue(DispatchEngine.AssignedTruck(s)?.Unit ?? "", out var st) ? st : new CabotageState();

    /// <summary>The assigned truck's state, for changing — only ever called inside a mutation.</summary>
    public static CabotageState StateOf(AppState s)
    {
        var unit = DispatchEngine.AssignedTruck(s)?.Unit ?? "";
        if (!s.CabotageByTruck.TryGetValue(unit, out var st))
            s.CabotageByTruck[unit] = st = new CabotageState();
        return st;
    }

    /// <summary>When the four days off end in a country, or null where there are none running.</summary>
    public static DateTime? CoolingUntil(CabotageState st, string country, DateTime now)
    {
        if (st.CoolingOffUntil.TryGetValue(country, out var until) && GameClock.TryParse(until) is { } u && u > now) return u;
        // A period that has run its seven days without being closed yet is already on its days off — read so,
        // without writing anything, because this is asked on every evaluation.
        if (string.Equals(st.Host, country, StringComparison.OrdinalIgnoreCase)
            && GameClock.TryParse(st.WindowOpenedGameTime) is { } opened && now > opened.AddDays(7)
            && GameClock.TryParse(st.LastUnloadInHostGameTime) is { } last
            && last.Date.AddDays(1 + 4) is var cool && cool > now)
            return cool;
        return null;
    }

    /// <summary>The cabotage period, if one is open in the host now.</summary>
    private static bool WindowOpen(CabotageState st, Rule rule, DateTime now, out DateTime closes)
    {
        closes = default;
        if (GameClock.TryParse(st.WindowOpenedGameTime) is not { } opened) return false;
        closes = opened.AddDays(rule.WindowDays);
        return now <= closes;
    }

    /// <summary>
    /// Why a load may not be taken, under cabotage, or null where it may. Read on every evaluation, so a
    /// period that has lapsed since the last one is noticed then.
    /// </summary>
    public static string? RejectionFor(AppState s, BoardLoad load) => Check(s, load).Refusal;

    /// <summary>The verdict on a load, and what to say about it either way.</summary>
    public static (string? Refusal, string? Note) Check(AppState s, BoardLoad load)
    {
        if (!Applies(s)) return (null, null);
        var (kind, host) = Classify(s, load.OriginState, load.DestState);
        if (kind != "Cabotage") return (null, null);
        var now = GameClock.TryParse(s.Status.GameTime) ?? DateTime.MinValue;
        var home = HomeCountry(s);
        var rule = RuleFor(home, host);
        var name = MapCoverage.Label(host);

        if (!rule.Allowed)
            return ($"Cabotage — a domestic load inside {name}, and this company is based in {MapCoverage.Label(home)}. {rule.Why}", null);

        var st = Peek(s);
        if (CoolingUntil(st, host, now) is { } cool)
            return ($"Cabotage in {name} is on its four days off until {GameClock.Pretty(cool)}. The truck needs an international " +
                    $"load out and a new one in after that before it can work domestic freight there again.", null);

        // The period opened by an international delivery into this country.
        if (Norm(st.Host) == host && WindowOpen(st, rule, now, out var closes))
        {
            if (st.OperationsUsed >= rule.MaxOperations)
                return ($"Cabotage in {name}: all {rule.MaxOperations} loads allowed since the international delivery are used. " +
                        "Take an international load out first.", null);
            return (null, $"Cabotage in {name} — load {st.OperationsUsed + 1} of {rule.MaxOperations}; the period closes " +
                          $"{GameClock.Pretty(closes)}.");
        }

        // A country entered empty: one load, within three days, counted in the three.
        if (rule.UnladenEntry && st.Host.Length > 0 && WindowOpen(st, RuleFor(home, st.Host), now, out var hostCloses)
            && st.OperationsUsed < RuleFor(home, st.Host).MaxOperations
            && !st.UnladenUsed.Contains(host, StringComparer.OrdinalIgnoreCase)
            && GameClock.TryParse(st.LastUnloadGameTime) is { } free && (now - free).TotalDays <= 3)
            return (null, $"Cabotage in {name} after arriving empty — one load allowed, counted in the " +
                          $"{RuleFor(home, st.Host).MaxOperations} from the delivery into {MapCoverage.Label(st.Host)}. Load it by " +
                          $"{GameClock.Pretty(Min(free.AddDays(3), hostCloses))}.");

        if (Norm(st.Host) == host)
            return ($"Cabotage in {name}: the seven days since the international delivery there are up. Take an international " +
                    "load out first.", null);
        if (st.UnladenUsed.Contains(host, StringComparer.OrdinalIgnoreCase))
            return ($"Cabotage in {name}: the one load allowed after arriving there empty is used. Take an international " +
                    "load out first.", null);
        return ($"Cabotage — a domestic load inside {name}, and the truck has not delivered an international load there. " +
                $"Cabotage only follows an international delivery into the country{(IsUk(host) ? " (and never an empty arrival, in the UK)" : "")}. " +
                rule.Why, null);
    }

    private static DateTime Min(DateTime a, DateTime b) => a < b ? a : b;

    /// <summary>A period that has run its seven days ends, and its four days off begin.</summary>
    private static void Lapse(CabotageState st, DateTime now)
    {
        if (st.Host.Length == 0 || GameClock.TryParse(st.WindowOpenedGameTime) is not { } opened) return;
        if (now <= opened.AddDays(7)) return;
        EndPeriod(st);
    }

    /// <summary>Ends the open period: four days off in the host, from the day after the last unloading there.</summary>
    private static void EndPeriod(CabotageState st)
    {
        if (st.Host.Length == 0) return;
        if (GameClock.TryParse(st.LastUnloadInHostGameTime) is { } last)
            st.CoolingOffUntil[st.Host] = GameClock.Format(last.Date.AddDays(1 + 4));
        st.Host = "";
        st.WindowOpenedGameTime = "";
        st.OperationsUsed = 0;
        st.UnladenUsed.Clear();
    }

    // ------------------------------------------------------------------ what a delivered load changes

    /// <summary>
    /// Records a delivered load against the truck: an international delivery into a foreign country opens
    /// a period there (ending any other); a cabotage load spends one; a delivery home ends it.
    /// </summary>
    public static void Record(AppState s, Trip trip)
    {
        if (!Applies(s) || trip.Kind != "Freight") return;
        var at = GameClock.TryParse(trip.DeliveredGameTime) ?? GameClock.TryParse(s.Status.GameTime);
        if (at == null) return;
        var st = StateOf(s);
        Lapse(st, at.Value);
        var (kind, host) = Classify(s, trip.OriginState, trip.DestState);
        var dest = Norm(trip.DestState);
        var home = HomeCountry(s);

        if (kind == "International")
        {
            if (Norm(st.Host) != dest) EndPeriod(st);
            if (dest != home && RuleFor(home, dest).Allowed && Norm(st.Host) != dest)
            {
                st.Host = dest;
                st.WindowOpenedGameTime = GameClock.Format(at.Value);
                st.OperationsUsed = 0;
                st.UnladenUsed.Clear();
            }
            if (dest != home) st.LastUnloadInHostGameTime = GameClock.Format(at.Value);
        }
        else if (kind == "Cabotage")
        {
            st.OperationsUsed++;
            if (Norm(st.Host) == host) st.LastUnloadInHostGameTime = GameClock.Format(at.Value);
            else st.UnladenUsed.Add(host);
        }
        else if (kind == "Domestic")
        {
            EndPeriod(st);
        }
        st.LastUnloadGameTime = GameClock.Format(at.Value);
    }

    /// <summary>What the board shows: the period, what is left of it, and the countries on their days off.</summary>
    public static object? View(AppState s)
    {
        if (!Applies(s)) return null;
        var now = GameClock.TryParse(s.Status.GameTime) ?? DateTime.MinValue;
        var st = Peek(s);
        var home = HomeCountry(s);
        string? note = null;
        if (st.Host.Length > 0 && GameClock.TryParse(st.WindowOpenedGameTime) is { } opened)
        {
            var rule = RuleFor(home, st.Host);
            var closes = opened.AddDays(rule.WindowDays);
            if (now <= closes)
                note = $"Cabotage in {MapCoverage.Label(st.Host)}: {Math.Max(0, rule.MaxOperations - st.OperationsUsed)} of " +
                       $"{rule.MaxOperations} domestic loads left, until {GameClock.Pretty(closes)}. After that, an international " +
                       "load out.";
        }
        var cooling = st.CoolingOffUntil
            .Where(kv => GameClock.TryParse(kv.Value) is { } u && u > now)
            .Select(kv => new { country = kv.Key, name = MapCoverage.Label(kv.Key), until = kv.Value })
            .ToList();
        return new { home, homeName = MapCoverage.Label(home), host = st.Host, used = st.OperationsUsed, note, cooling };
    }

    private static string Norm(string? c) => (c ?? "").Trim().ToUpperInvariant();
}
