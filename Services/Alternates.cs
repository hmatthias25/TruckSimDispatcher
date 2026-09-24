using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Asking operations for a different load, and operations getting tired of being asked.
///
/// <para>The request used to be a formality with a decision-shaped message on the end of it. It logged
/// the ask, said "operations decides", and then nothing decided anything — the driver was told to raise
/// it with dispatch, which is the app telling somebody to go and ask the app. A request nobody can
/// refuse is not a request, and it made rank meaningless in the one place rank is supposed to bite:
/// freight selection is the privilege the whole ladder is built around.</para>
///
/// <para>So dispatch answers, and it answers worse the more it is asked. Not a quota with a hard edge —
/// a <b>mood</b>. The first ask of a quiet week is usually fine and occasionally is not; the fourth in
/// two days usually is not and occasionally is fine. Both ends matter. A ration teaches a driver to
/// count; a mood teaches them to judge whether this load is worth spending goodwill on, which is the
/// decision a real driver is actually making.</para>
///
/// <para><b>Goodwill comes back on its own.</b> One ask is forgiven every
/// <see cref="DaysPerForgiveness"/> quiet game days, so a driver who leans on it hard and then leaves it
/// alone is back where they started inside a week — without a Monday to game, and without a counter that
/// only ever goes up. Being refused costs nothing but the asking: the assignment stands, and no refusal
/// allowance is touched. See <see cref="Rejections"/> for that separate ration.</para>
///
/// <para><b>How far down the board matters too.</b> The board is ranked, and the ranking is the whole
/// subject of this conversation. Asking for the load one below the assignment is barely an argument;
/// asking for the tenth is asking operations to tear up the day. So depth stacks on top of the mood —
/// see <see cref="DepthPenaltyPct"/> — and it costs more goodwill as well as being likelier to be
/// refused, which is what makes a greedy ask expensive rather than merely unlikely.</para>
///
/// <para><b>Seeded, so it cannot be re-rolled.</b> The roll is a function of the driver, how many asks
/// deep they are and the game day — not of the load. Reloading the page gives the same answer, and so
/// does asking about a different load at the same heat on the same day. That is deliberate: the roll is
/// dispatch's mood for the day, and how far down the board you reach decides whether it clears. What
/// moves the mood is asking again. This is the same promise the rest of the app makes about every roll
/// it hides from the player.</para>
/// </summary>
public static class Alternates
{
    /// <summary>Quiet game days that win back one ask worth of patience.</summary>
    public const double DaysPerForgiveness = 2.0;

    /// <summary>
    /// Odds of a refusal, by how many asks deep the driver is.
    ///
    /// <para>Index 0 is the first ask. It is deliberately not zero: a dispatcher having a bad morning
    /// says no to a perfectly reasonable request, and a first ask that always worked would make the
    /// whole thing a button rather than a question.</para>
    ///
    /// <para>And the top is deliberately not a hundred. Something the player can see coming is not the
    /// same as something scheduled, and the last rung should still be a roll — the same argument
    /// <see cref="HomeTime.ReassignChancePercent"/> makes about the re-rig curve.</para>
    /// </summary>
    private static readonly int[] RefusalCurve = { 20, 40, 60, 75, 85 };

    /// <summary>
    /// What it costs to reach further down the board, in points added to the odds of a no.
    ///
    /// <para><b>The board is ranked for a reason.</b> Position one is dispatch's own pick and asking for
    /// position two is barely an argument — the freight behind it was nearly the assignment anyway.
    /// Asking for the tenth is asking operations to throw out its whole plan for the day, and it should
    /// read as a different kind of request, because it is one.</para>
    ///
    /// <para>Without this the mechanism could not tell those apart: a driver reaching past nine better
    /// loads faced the same odds as one nudging dispatch down a single rung, so the ranking carried no
    /// weight in the one conversation that is entirely about it.</para>
    ///
    /// <para>Position is <see cref="DispatchEngine.LoadsSkippedToReach"/> plus one — the same count the
    /// refusal allowance is charged on, deliberately, so "further down the board" means one thing in
    /// this app and not two.</para>
    /// </summary>
    public static int DepthPenaltyPct(int position) =>
        position <= 1 ? 0 : Math.Min(5 + (position - 2) * 10, 60);

    /// <summary>Where this load sits among the ones the driver could actually take. One-based.</summary>
    public static int PositionOf(AppState s, BoardLoad load) =>
        DispatchEngine.LoadsSkippedToReach(s, load.Id).Count + 1;

    /// <summary>
    /// How much goodwill this ask burns.
    ///
    /// <para>Reaching deep costs more than nudging, in the tally as well as in the answer — that is what
    /// makes a greedy ask expensive rather than merely unlikely. A driver who asks for the load right
    /// below the assignment can do it a few times before operations tires of them; one who works their
    /// way down to the tenth has spent the same patience in a single request.</para>
    /// </summary>
    public static double WeightFor(int position) =>
        Math.Clamp(1.0 + Math.Max(0, position - 2) * 0.25, 1.0, 3.0);

    /// <summary>
    /// How much of a break the rank earns.
    ///
    /// A senior driver asking is a different conversation from a probationary one asking, and the ladder
    /// should be felt here as everywhere else. The ranks that can simply TAKE another load never reach
    /// this code — see <see cref="DriverPrivileges.CanChooseAlternateLoad"/> — so in practice this is the
    /// difference between a company driver and a senior one.
    /// </summary>
    private static int RankRelief(string? rank) => (rank ?? "").Trim().ToLowerInvariant() switch
    {
        "senior" => 15,
        "lead" or "lease" or "owner" => 25,
        _ => 0,
    };

    /// <summary>
    /// How tired of being asked operations is right now, in asks.
    ///
    /// <para>Walked forward through the history rather than counted, because the forgiveness has to be
    /// applied <b>between</b> asks and not once at the end: three asks on Monday and one on Friday is a
    /// driver who has calmed down, and a plain count of four in the week cannot tell that from four
    /// asks this morning.</para>
    /// </summary>
    public static double Heat(AppState s)
    {
        var today = GameClock.DayOf(s.Status.GameTime);
        if (today == null) return 0;

        // Oldest first: this is a running total, and it only makes sense in the order it happened.
        // Each ask carries the weight it was made at, so a reach down the board goes on costing more
        // than a nudge did long after the board it was made against has gone.
        var asks = s.AlternateAsks
            .Select(a => new { Day = GameClock.DayOf(a.GameTime), a.Weight })
            .Where(x => x.Day != null)
            .Select(x => new { Day = x.Day!.Value, Weight = x.Weight <= 0 ? 1.0 : x.Weight })
            .OrderBy(x => x.Day)
            .ToList();

        double heat = 0;
        int? previous = null;
        foreach (var ask in asks)
        {
            if (previous is { } p) heat = Math.Max(0, heat - (ask.Day - p) / DaysPerForgiveness);
            heat += ask.Weight;
            previous = ask.Day;
        }

        if (previous is { } last) heat = Math.Max(0, heat - (today.Value - last) / DaysPerForgiveness);
        return heat;
    }

    /// <summary>Which rung of the curve the next ask lands on. One-based, for saying out loud.</summary>
    public static int NextAskNumber(AppState s) => (int)Math.Floor(Heat(s)) + 1;

    /// <summary>
    /// Odds the next ask is turned down, as a percentage.
    ///
    /// Two things stack: how often they have asked lately, and how far down the board they are reaching
    /// this time. Rank takes a slice off the total, and the answer is never a certainty.
    /// </summary>
    public static int RefusalChancePct(AppState s, int position = 1)
    {
        var rung = Math.Clamp(NextAskNumber(s) - 1, 0, RefusalCurve.Length - 1);
        return Math.Clamp(RefusalCurve[rung] + DepthPenaltyPct(position) - RankRelief(s.Driver.Rank), 0, 95);
    }

    /// <summary>
    /// The answer, and why.
    ///
    /// Seeded on the driver, the rung and the day — not on the load — so the same ask cannot be re-rolled
    /// by reloading, and shopping the request around a board of loads does not buy a fresh coin flip.
    /// </summary>
    public static (bool Granted, int ChancePct, int Position, string Message) Decide(AppState s, BoardLoad load)
    {
        var position = PositionOf(s, load);
        var chance = RefusalChancePct(s, position);
        var rung = NextAskNumber(s);
        var day = GameClock.DayOf(s.Status.GameTime) ?? 0;

        var roll = (int)(Hash($"{s.Driver.Name}|alternate|{rung}|{day}") % 100);
        var granted = roll >= chance;
        var lane = $"{DispatchEngine.Place(load.OriginCity, load.OriginState)} to " +
                   $"{DispatchEngine.Place(load.DestCity, load.DestState)}";

        if (granted)
            return (true, chance, position, position >= 5
                ? $"That is a long way down my board, but all right — {load.Cargo}, {lane}. I have had to " +
                  "move several things to do it, so I would not come back tomorrow."
                : rung <= 1
                    ? $"Fine — take {load.Cargo}, {lane}, and I will move the other one. Ask me this often " +
                      "and the answer changes, but today it is yours."
                    : $"All right. {load.Cargo}, {lane} — it is yours. That is {rung} you have asked me for " +
                      "lately, so do not make a habit of it.");

        // A refusal for reaching deep says so, because it is a different no from "you have asked too
        // often" — and a driver who cannot tell them apart learns the wrong lesson from it.
        if (position >= 4)
            return (false, chance, position,
                $"No. {load.Cargo} is {Ordinal(position)} on my board and there are {position - 1} better " +
                "loads above it — I rank them for a reason. Ask me for something near the top and I will " +
                "listen; ask me to tear up the day and I will not.");

        return (false, chance, position, rung switch
        {
            1 => $"No. I have already planned the day around the load you were given — {load.Cargo} is not " +
                 "worth unpicking it for. Run what is on the board.",
            2 => $"No. That is twice now. The assignment stands — {load.Cargo} goes to somebody who was not " +
                 "already booked.",
            3 => "No, and you are starting to cost me a planner. I pick the freight, you run it. Ask me " +
                 "again this week and the answer will be shorter.",
            _ => "No. You have been through this board load by load and the answer has not changed. Take " +
                 "your dispatch. Leave it a few days and I will hear you out again.",
        });
    }

    /// <summary>Files the ask, granted or not. The asking is what operations remembers.</summary>
    public static AlternateAsk Record(AppState s, BoardLoad load, string reason, bool granted, int position)
    {
        var ask = new AlternateAsk
        {
            GameTime = s.Status.GameTime,
            LoadId = load.Id,
            Position = position,
            // Stored rather than recomputed: the board it was asked against is gone by the next status
            // report, and an ask that cost two ought to go on costing two.
            Weight = WeightFor(position),
            Cargo = load.Cargo,
            Lane = $"{DispatchEngine.Place(load.OriginCity, load.OriginState)} → " +
                   $"{DispatchEngine.Place(load.DestCity, load.DestState)}",
            Reason = reason ?? "",
            Granted = granted,
            RankAtTime = s.Driver.Rank,
        };

        s.AlternateAsks.Insert(0, ask);
        // Only the recent ones are ever read, and a career's worth is not worth carrying.
        if (s.AlternateAsks.Count > 100) s.AlternateAsks.RemoveRange(100, s.AlternateAsks.Count - 100);
        return ask;
    }

    /// <summary>
    /// A granted ask, still standing.
    ///
    /// Approval has to outlive the request itself or it buys the driver nothing: they ask, they are told
    /// yes, and then the authorize path has to agree. It is pinned to the load, so a yes about one load
    /// is not a yes about the board.
    /// </summary>
    public static AlternateAsk? Approved(AppState s, string loadId) =>
        s.AlternateAsks.FirstOrDefault(a => a.Granted && !a.Spent
                                            && a.LoadId.Equals(loadId, StringComparison.Ordinal));

    /// <summary>Where the driver stands, for the dispatch screen.</summary>
    public static object View(AppState s)
    {
        var heat = Heat(s);
        var chance = RefusalChancePct(s);
        var rung = NextAskNumber(s);

        return new
        {
            heat = Math.Round(heat, 2),
            askNumber = rung,
            // The floor: asking for the load directly below the assignment. Reaching further adds to it,
            // which is why this is quoted as a starting point rather than as the answer.
            refusalChancePct = chance,
            depthPenaltyPct = new[] { 2, 3, 4, 5, 6 }.ToDictionary(p => p, DepthPenaltyPct),
            note = (rung <= 1
                ? "Operations has not heard from you lately. A reasonable request will probably land — " +
                  $"though not certainly: about {chance}% of them get a no whatever the week has been like."
                : $"You are {rung} asks deep with operations, so about {chance}% of a no on the next one. " +
                  $"One ask is forgiven every {DaysPerForgiveness:0.#} quiet days.") +
                " That is for the load just below your assignment — every rung further down the board adds" +
                " to it, because the board is ranked for a reason.",
        };
    }

    /// <summary>"second", "third" — for a dispatcher who would say it that way.</summary>
    private static string Ordinal(int n) => n switch
    {
        2 => "second", 3 => "third", 4 => "fourth", 5 => "fifth", 6 => "sixth",
        7 => "seventh", 8 => "eighth", 9 => "ninth", 10 => "tenth",
        _ => $"{n}th",
    };

    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }
}
