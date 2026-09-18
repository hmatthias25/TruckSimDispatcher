using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Property: what a yard costs to buy, and what it costs to keep.
///
/// <para>The company used to acquire yards for nothing. <c>CompanyHealth</c> added the terminal to the
/// books and told the player to buy the garage in ATS when they were next through, and no figure the
/// company judges itself by could see a yard at all — not the purchase, and not the upkeep, which was
/// set on every tier, printed on the Terminals tab, and charged nowhere. So the company looked exactly
/// as profitable with six yards as with one, and went on opening them. Reported from play.</para>
///
/// <para><b>Asked for, not taken.</b> The app cannot buy a garage and cannot know what ATS charged for
/// one, so a yard is a request until the player says they bought it and what it came to — the same
/// bargain <see cref="TrailerFleet"/> already strikes for a trailer. Nothing is estimated; a yard that
/// nobody has priced is simply a yard with no price on it.</para>
/// </summary>
public static class Yards
{
    /// <summary>Only ever one outstanding. A carrier does not shop for three garages at once.</summary>
    public static YardRequest? Open(AppState s) =>
        s.YardRequests.FirstOrDefault(r => r.Status == "Open");

    /// <summary>
    /// Roughly what an ATS garage runs to, used only to say whether the company can afford to ask.
    /// Never posted — what actually lands on the books is what the player reports paying.
    /// </summary>
    public const decimal TypicalGarageCost = 250_000m;

    /// <summary>
    /// Put the ask on the books. Null where there is already one outstanding, or where the same yard
    /// has been turned down before — a company that keeps asking for something it was refused is noise.
    /// </summary>
    public static YardRequest? Raise(AppState s, FleetReport report, YardRequest req)
    {
        if (Open(s) != null) return null;
        if (s.YardRequests.Any(r => r.Status == "Declined"
                                    && r.Kind == req.Kind
                                    && r.City.Equals(req.City, StringComparison.OrdinalIgnoreCase)
                                    && r.State.Equals(req.State, StringComparison.OrdinalIgnoreCase)
                                    && r.Level.Equals(req.Level, StringComparison.OrdinalIgnoreCase)))
            return null;

        var label = DispatchEngine.Place(req.City, req.State);
        var spendable = LedgerService.Position(s).Spendable;

        req.Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-YD-{s.YardRequests.Count + 1:0000}";
        req.RaisedGameTime = report.PeriodEndGame;
        req.Status = "Open";
        req.Unaffordable = spendable < TypicalGarageCost;

        req.Instruction = req.Kind == "Upgrade"
            ? $"Buy the {req.Level.ToLowerInvariant()} garage upgrade at {label} in ATS, then tell me what " +
              "it cost and I will move the yard up on the books."
            : $"Buy the {req.Level.ToLowerInvariant()} garage at {label} in ATS, then tell me what it cost " +
              "and I will put the yard on the books.";

        if (req.Unaffordable)
            req.Instruction += $" No rush — spendable cash is ${spendable:N0} and a garage runs somewhere " +
                               $"around ${TypicalGarageCost:N0}. This is what the figures say we could use, " +
                               "not what we can put our hands on today.";

        s.YardRequests.Insert(0, req);
        return req;
    }

    /// <summary>
    /// The player bought it. The yard goes on the books now, and the money comes off them.
    ///
    /// <paramref name="paidPrice"/> is what ATS charged, and it is the only figure that gets posted. Zero
    /// is allowed and means exactly what it says — the yard is recorded and nothing is booked against it,
    /// which is honest for somebody who would rather not track property at all.
    /// </summary>
    public static Terminal Confirm(AppState s, string requestId, decimal paidPrice, string gameTime)
    {
        var req = s.YardRequests.FirstOrDefault(r => r.Id == requestId)
                  ?? throw new InvalidOperationException("That yard request is not on file.");
        if (req.Status != "Open") throw new InvalidOperationException($"{req.Number} is already {req.Status.ToLowerInvariant()}.");

        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        var label = DispatchEngine.Place(req.City, req.State);
        var paid = Math.Max(0, paidPrice);

        Terminal yard;
        if (req.Kind == "Upgrade")
        {
            yard = Migrations.TerminalOf(s, req.TerminalId)
                   ?? throw new InvalidOperationException("The yard being upgraded is no longer on the books.");
            Migrations.ApplyLevel(yard, req.Level);
            // Added to, not replaced: the tier cost what it cost on top of what the site cost already.
            yard.PurchasePrice += paid;
        }
        else
        {
            yard = new Terminal
            {
                Id = $"yard-{req.City.ToLowerInvariant().Replace(' ', '-')}-{req.State.ToLowerInvariant()}",
                City = req.City,
                State = req.State,
                IsHeadquarters = false,
                PurchasePrice = paid,
                // Billed from today, not from whenever the last yard was billed, so a yard bought
                // mid-period is not charged for the weeks before the company owned it.
                LastUpkeepDay = GameClock.DayOf(when) ?? -1,
            };
            Migrations.ApplyLevel(yard, req.Level);
            s.Company.Terminals.Add(yard);
        }

        req.Status = "Bought";
        req.PaidPrice = paid;
        req.BoughtGameTime = when;

        if (paid > 0)
            LedgerService.Post(s, LedgerService.Operating, -paid, "Property",
                req.Kind == "Upgrade"
                    ? $"{req.Number} — {label} garage upgraded to {req.Level.ToLowerInvariant()}"
                    : $"{req.Number} — {req.Level.ToLowerInvariant()} garage bought at {label}");

        return yard;
    }

    /// <summary>Turned down. Recorded so the company does not ask for the same yard next period.</summary>
    public static YardRequest Decline(AppState s, string requestId, string gameTime)
    {
        var req = s.YardRequests.FirstOrDefault(r => r.Id == requestId)
                  ?? throw new InvalidOperationException("That yard request is not on file.");
        req.Status = "Declined";
        req.BoughtGameTime = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        return req;
    }

    /// <summary>
    /// Charges every yard its keep for the period just settled.
    ///
    /// <para>Prorated on the days actually covered and stamped per yard, so a settlement run twice bills
    /// once and a yard bought halfway through a period pays for half of it. ATS charges nothing to hold
    /// a garage — this is the app's own figure, and it exists so that owning six yards is a different
    /// proposition from owning one. Without it the only cost of expanding was a single purchase the
    /// company had already decided it could afford.</para>
    /// </summary>
    /// <summary>
    /// Days that have to have gone by before a yard is billed again.
    ///
    /// This is called from the same calendar beat that settles paydays, which runs on every status
    /// report — so without a floor a player reporting in twice a day would get two rent entries a day.
    /// A week matches the payday rhythm and keeps the ledger readable.
    /// </summary>
    public const int MinDaysToBill = 7;

    public static decimal ChargeUpkeep(AppState s, string periodEndGameTime)
    {
        var today = GameClock.DayOf(periodEndGameTime) ?? GameClock.DayOf(s.Status.GameTime);
        if (today == null) return 0;

        var total = 0m;
        foreach (var yard in s.Company.Terminals.Where(t => t.MonthlyCost > 0))
        {
            // A yard the app has never billed starts its clock now rather than being charged for every
            // period since the career opened.
            if (yard.LastUpkeepDay < 0) { yard.LastUpkeepDay = today.Value; continue; }

            var days = today.Value - yard.LastUpkeepDay;
            if (days < MinDaysToBill) continue;

            var due = Math.Round(yard.MonthlyCost * days / 30m, 2);
            if (due <= 0) { yard.LastUpkeepDay = today.Value; continue; }

            yard.LastUpkeepDay = today.Value;
            total += due;
            LedgerService.Post(s, LedgerService.Operating, -due, "YardUpkeep",
                $"{DispatchEngine.Place(yard.City, yard.State)} {yard.Level.ToLowerInvariant()} yard — " +
                $"{days} day(s) upkeep");
        }

        return Math.Round(total, 2);
    }
}
