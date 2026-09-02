using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The company asking for trailers.
///
/// A real carrier adds equipment as freight demands it, rather than only when the owner remembers to.
/// So operations raises the ask on the same fortnightly cycle as everything else: which yard, what
/// type, and why.
///
/// It stays an ask. The app cannot buy anything in ATS, and it never books a price it invented — the
/// player buys the trailer in game, reports what they actually paid, and that is what hits the books.
/// Declining is a real answer and the app does not come back next fortnight about the same thing.
/// </summary>
public static class TrailerFleet
{
    /// <summary>What a trailer roughly costs, only used to say whether we can afford one at all.</summary>
    private const decimal TypicalTrailerCost = 42_000m;

    public static TrailerRequest? Open(AppState s) =>
        s.TrailerRequests.FirstOrDefault(r => r.Status == "Open");

    /// <summary>
    /// Considers asking for another trailer at a yard.
    ///
    /// Deliberately occasional — a request every fortnight would be a treadmill, not a decision. It
    /// fires when a yard is genuinely short: more drivers based there than trailers to give them.
    /// </summary>
    public static TrailerRequest? Consider(AppState s, FleetReport report)
    {
        // One ask at a time. Two open requests is a shopping list nobody actions.
        if (Open(s) != null) return null;

        // How hard the boxes at a yard are actually working. Headcount used to decide this — drivers
        // times 1.5 — and headcount is the wrong signal: two drivers on short turns need fewer boxes
        // than two on drop and hook, and the app already has the figures that say which. A yard whose
        // trailers are running hot is a yard that is short one, whoever is based there.
        var candidates = new List<(Terminal Yard, int Drivers, int Trailers, double Util)>();

        foreach (var yard in s.Company.Terminals)
        {
            // A yard the player has not actually bought in ATS holds nothing, so there is nowhere to
            // put a trailer and no point asking them to buy one for it.
            if (!Migrations.Populated(s, yard.Id)) continue;

            var here = s.Trailers.Where(t => !t.Retired && !DropHook.Is(t.Type)
                                             && t.HomeTerminalId == yard.Id).ToList();
            if (here.Count == 0) continue;

            // Only real readings. An unreported box says nothing about how busy the yard is, and
            // treating silence as either busy or idle would be inventing the answer.
            var read = here.Where(t => t.UtilisationPct >= 0).ToList();
            if (read.Count == 0) continue;

            var util = read.Average(t => t.UtilisationPct);
            if (util < s.Settings.Maintenance.TrailerBusyPct) continue;   // not stretched, no case

            var drivers = s.HiredDrivers.Count(d => d.Status == "Active" && d.HomeTerminalId == yard.Id);
            candidates.Add((yard, drivers, here.Count, util));
        }

        if (candidates.Count == 0) return null;

        // Seeded on the report, so refreshing cannot re-roll it. Roughly one report in three.
        var pick = candidates[(int)(Hash($"{report.Number}|trailer-yard") % (uint)candidates.Count)];
        if (Hash($"{report.Number}|trailer-ask") % 100 >= 34) return null;

        // Already told no about this yard and type? Then it is settled.
        var type = TypeToBuy(s, pick.Yard, report);
        if (s.TrailerRequests.Any(r => r.Status == "Declined"
                                       && r.TerminalId == pick.Yard.Id
                                       && r.TrailerType.Equals(type.Type, StringComparison.OrdinalIgnoreCase)))
            return null;

        var label = DispatchEngine.Place(pick.Yard.City, pick.Yard.State);
        var req = new TrailerRequest
        {
            Number = $"{(string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code)}-TR-{s.TrailerRequests.Count + 1:0000}",
            Kind = "Add",
            TerminalId = pick.Yard.Id,
            TerminalLabel = label,
            TrailerType = type.Type,
            Subtype = type.Subtype,
            RaisedGameTime = report.PeriodEndGame,
            Status = "Open"
        };

        var spendable = LedgerService.Position(s).Spendable;
        req.Unaffordable = spendable < TypicalTrailerCost;

        var what = TrailerSpec.Describe(type.Type, type.Subtype);
        req.Reason = $"The {pick.Trailers} trailer(s) at {label} are running at {pick.Util:0.#}% of the week, over the " +
                     $"{s.Settings.Maintenance.TrailerBusyPct:0}% where we start looking for another one" +
                     (pick.Drivers > 0 ? $" — {pick.Drivers} driver(s) based there" : "") + ". " + type.Why;
        req.Instruction = req.Unaffordable
            ? $"Buy {what} for {label} when the money is there — spendable cash is ${spendable:N0} and a trailer runs " +
              $"around ${TypicalTrailerCost:N0}. I am not going to pretend this is free."
            : $"Buy {what} in ATS and base it at {label}, then confirm it here with what you paid.";

        // The box goes on the books now, as backdrop. It is the company's decision and the company has
        // made it; what is outstanding is the driver buying it in ATS and ticking it in garage, which is
        // the same flow every other unit uses. An ask with no equipment behind it left the fleet not
        // knowing about a trailer it had already decided to run.
        req.Unit = AddBackdrop(s, req, pick.Yard);
        req.Instruction = $"{what} added to {label} — unit {req.Unit}. " + (req.Unaffordable
            ? $"Buy it in ATS when the money is there and tick 'in garage' on the Equipment tab."
            : "Buy it in ATS, base it there, and tick 'in garage' on the Equipment tab.");

        s.TrailerRequests.Insert(0, req);
        report.Findings.Add($"{req.Number}: {req.Reason}");
        return req;
    }

    /// <summary>Puts the decided box on the yard as backdrop, and returns its unit number.</summary>
    private static string AddBackdrop(AppState s, TrailerRequest req, Terminal yard)
    {
        var n = 500;
        while (s.Trailers.Any(t => t.Unit.Equals($"T{n}", StringComparison.OrdinalIgnoreCase))) n++;
        var unit = $"T{n}";

        s.Trailers.Insert(0, new Trailer
        {
            Unit = unit,
            Type = req.TrailerType,
            Subtype = req.Subtype,
            Division = TrailerSpec.DivisionFor(req.TrailerType),
            HomeTerminalId = yard.Id,
            CurrentLocation = $"{yard.City}, {yard.State}",
            // Backdrop until the driver buys it. Damage and utilisation stay unreported rather than
            // invented — the app has never seen this box in the game.
            InGameGarage = false,
            IsCompanyOwned = true,
            AcquiredGameTime = req.RaisedGameTime,
            Notes = $"{req.Number}: the company wants this at {yard.City}. " +
                    "Buy it in ATS and tick 'in garage' once you have.",
        });
        return unit;
    }

    /// <summary>
    /// What kind of trailer to ask for. Whatever the yard's drivers are already pulling is the safe
    /// answer; where the carrier runs a division nobody there covers, that is the more useful one.
    /// </summary>
    private static (string Type, string Subtype, string Why) TypeToBuy(AppState s, Terminal yard, FleetReport report)
    {
        var here = s.Trailers.Where(t => !t.Retired && t.HomeTerminalId == yard.Id).ToList();

        // A division the company runs but this yard cannot cover at all.
        var covered = here.Select(t => t.Division).Where(d => !string.IsNullOrWhiteSpace(d)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var gap = s.Company.Divisions.FirstOrDefault(d => !covered.Contains(d)
                                                          && !d.Equals("Dedicated", StringComparison.OrdinalIgnoreCase));
        if (gap != null)
        {
            var (type, sub) = TrailerSpec.ForDivision(gap);
            return (type, sub, $"We run {gap} freight and nothing based there can pull it.");
        }

        // Otherwise more of what is already working out of that yard.
        var common = here.GroupBy(t => t.Type, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(g => g.Count())
            .FirstOrDefault();
        if (common != null)
        {
            var sub = here.First(t => t.Type.Equals(common.Key, StringComparison.OrdinalIgnoreCase)).Subtype;
            return (common.Key, sub, $"More of what is already moving there — {common.Key.ToLowerInvariant()} is what that yard runs.");
        }

        var division = s.Company.Divisions.FirstOrDefault() ?? "Dry Van";
        var (t0, s0) = TrailerSpec.ForDivision(division);
        return (t0, s0, $"Nothing based there yet, and {division} is our bread and butter.");
    }

    /// <summary>The player bought it. Record the trailer and book what they actually paid.</summary>
    public static Trailer Confirm(AppState s, string requestId, string unit, decimal paidPrice, string gameTime, string gameId = "")
    {
        var req = s.TrailerRequests.FirstOrDefault(r => r.Id == requestId || r.Number == requestId)
                  ?? throw new InvalidOperationException("No such trailer request.");
        if (req.Status != "Open")
            throw new InvalidOperationException($"{req.Number} is already {req.Status.ToLowerInvariant()}.");
        // The box raised with this request is already on the books as backdrop, so confirming means
        // marking THAT one bought rather than adding a second copy of the same trailer.
        var standing = s.Trailers.FirstOrDefault(t => !string.IsNullOrWhiteSpace(req.Unit)
            && t.Unit.Equals(req.Unit, StringComparison.OrdinalIgnoreCase));
        if (standing != null)
        {
            if (!string.IsNullOrWhiteSpace(unit) && !unit.Trim().Equals(standing.Unit, StringComparison.OrdinalIgnoreCase))
            {
                if (s.Trailers.Any(t => t.Unit.Equals(unit.Trim(), StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidOperationException($"Trailer {unit} is already on the books.");
                standing.Unit = unit.Trim();
            }
            Equip.GuardGameId(s, gameId, standing.Unit);
            if (!string.IsNullOrWhiteSpace(gameId)) standing.GameId = gameId.Trim();
            standing.InGameGarage = true;
            standing.Stars = 5;
            standing.PurchasePrice = paidPrice;
            standing.AcquiredGameTime = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
            standing.Notes = "";

            req.Status = "Bought";
            req.PaidPrice = paidPrice;
            req.Unit = standing.Unit;
            req.ResolvedGameTime = standing.AcquiredGameTime;
            return standing;
        }

        if (string.IsNullOrWhiteSpace(unit))
            throw new InvalidOperationException("Give the trailer a unit number so the fleet can track it.");
        if (s.Trailers.Any(t => t.Unit.Equals(unit.Trim(), StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"Trailer {unit} is already on the books.");
        Equip.GuardGameId(s, gameId, unit.Trim());

        var when = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;
        var yard = s.Company.Terminals.FirstOrDefault(x => x.Id == req.TerminalId);

        var trailer = new Trailer
        {
            Unit = unit.Trim(),
            GameId = (gameId ?? "").Trim(),
            Type = req.TrailerType,
            Subtype = req.Subtype,
            Division = TrailerSpec.DivisionFor(req.TrailerType),
            HomeTerminalId = req.TerminalId,
            CurrentLocation = yard == null ? "" : $"{yard.City}, {yard.State}",
            InGameGarage = true,
            IsCompanyOwned = true,
            Stars = 5,                                  // a new box, until the player reports otherwise
            AcquiredGameTime = when,
            StarsReportedGameTime = when,
            PurchasePrice = paidPrice,
            Notes = $"Bought on {req.Number}."
        };
        s.Trailers.Add(trailer);

        req.Status = "Bought";
        req.PaidPrice = paidPrice;
        req.ResolvedGameTime = when;

        // Only what the player says they paid goes on the books. Nothing estimated.
        if (paidPrice > 0)
            LedgerService.Post(s, LedgerService.Operating, -paidPrice, "Equipment",
                $"Trailer {trailer.Ref} ({trailer.Type}) for {req.TerminalLabel}", req.Number);

        return trailer;
    }

    /// <summary>Not interested. The app does not ask about this yard and type again.</summary>
    public static TrailerRequest Decline(AppState s, string requestId, string gameTime)
    {
        var req = s.TrailerRequests.FirstOrDefault(r => r.Id == requestId || r.Number == requestId)
                  ?? throw new InvalidOperationException("No such trailer request.");
        req.Status = "Declined";
        req.ResolvedGameTime = string.IsNullOrWhiteSpace(gameTime) ? s.Status.GameTime : gameTime;

        // The backdrop box went on the books when the company decided it wanted one. Saying no takes it
        // straight back off — leaving it there would put a trailer on the fleet that nobody agreed to
        // and that will never be bought.
        if (!string.IsNullOrWhiteSpace(req.Unit))
            s.Trailers.RemoveAll(x => x.Unit.Equals(req.Unit, StringComparison.OrdinalIgnoreCase)
                                      && !x.InGameGarage);
        return req;
    }

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
