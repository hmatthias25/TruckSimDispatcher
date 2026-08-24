using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Things the driver asks operations for, and what operations says back.
///
/// Both requests here share a shape on purpose. A driver puts something in, it is <b>not</b> answered
/// on the spot, and the answer explains what it turned on. That is how asking your dispatcher for
/// something actually goes: you send the message, you keep driving, and you hear back.
///
/// Every answer is seeded on the request so it cannot be re-rolled by reloading, and a refusal carries
/// a cooling-off so the ask does not become a button to mash until the answer changes.
/// </summary>
public static class Requests
{
    /// <summary>Days after a refusal before the same thing can be asked again.</summary>
    public const double CoolOffDays = 5;

    // ================================================================= a better truck

    /// <summary>
    /// Asking to be moved into a better unit sitting at the yard.
    ///
    /// Answered <b>on the spot</b>, unlike the other two. The driver is standing at the yard with the
    /// truck twenty feet away and a fortnight before they will be back — making them wait for the next
    /// close-out would waste the trip. The arrival brief used to tell them to "ask operations to move you
    /// into it" with nothing behind it, which is worse than not offering.
    ///
    /// It can be turned down. Noticing the newest tractor on the property does not entitle anybody to
    /// it: rank decides, and a driver-fault record counts against.
    /// </summary>
    /// <summary>
    /// Refuses to let the driver move themselves onto different equipment.
    ///
    /// A company driver does not pick their own tractor. They can <b>ask</b> — and be told no — which is
    /// what <see cref="AskForBetterUnit"/> and the trailer request are for. Letting them assign
    /// themselves whatever is on the property makes both of those pointless, and makes the whole ladder
    /// pointless with them: there is no reward for clearing probation if the good unit was always one
    /// dropdown away.
    ///
    /// Three things are still allowed, because none of them is the driver helping themselves:
    /// <list type="bullet">
    ///   <item>The first assignment of a career, when they have nothing yet.</item>
    ///   <item>Equipment the company has already ordered them onto — an open order naming that unit.</item>
    ///   <item>Staying where they are. Re-reporting the same unit is not a change.</item>
    /// </list>
    /// </summary>
    public static void GuardSelfAssignment(AppState s, string? truckUnit, string? trailerUnit)
    {
        var open = EquipmentService.OpenOrder(s);

        void Check(string? wanted, string? current, string kind, string ordered, string howToAsk)
        {
            if (string.IsNullOrWhiteSpace(wanted)) return;                       // not changing it
            if (string.IsNullOrWhiteSpace(current)) return;                      // nothing to change from
            if (wanted.Equals(current, StringComparison.OrdinalIgnoreCase)) return;
            if (!string.IsNullOrWhiteSpace(ordered)
                && wanted.Equals(ordered, StringComparison.OrdinalIgnoreCase)) return;   // the company said so

            if (s.Driver.Rank == "probationary")
                throw new InvalidOperationException(
                    $"You do not pick your own {kind}, and you cannot ask for one while you are on probation. " +
                    "Take what you are given until that is behind you.");

            throw new InvalidOperationException(
                $"You do not pick your own {kind} — operations does. {howToAsk} It can be turned down, and " +
                "what you have behind you is what earns it a hearing.");
        }

        Check(truckUnit, s.Driver.AssignedTruckUnit, "tractor", open?.ToTruckUnit,
              "Put in for one from the arrival briefing when you are at the yard.");
        Check(trailerUnit, s.Driver.AssignedTrailerUnit, "trailer", open?.ToTrailerUnit,
              "Ask to be re-rigged on the Career tab and it happens at your next home time.");
    }

    public static (bool Granted, string Message, EquipmentOrder? Order) AskForBetterUnit(AppState s)
    {
        var current = DispatchEngine.AssignedTruck(s);
        var better = EquipmentService.BestAvailableTruck(s);

        if (better == null || (current != null && better.Unit == current.Unit))
            return (false, "There is nothing on the property better than what you are in.", null);

        if (EquipmentService.OpenOrder(s) is { } open)
            return (false, $"You already have {open.Number} outstanding. Close that out first.", null);

        // Turned down recently? Do not let the ask become a button to mash.
        var refused = s.Driver.LastUnitRequestRefusedGameTime;
        if (!string.IsNullOrWhiteSpace(refused)
            && GameClock.HoursBetween(refused, s.Status.GameTime) is { } since
            && since < CoolOffDays * 24)
            return (false,
                $"Operations turned this down on {GameClock.Pretty(refused)}. Give it " +
                $"{CoolOffDays - since / 24:0.#} days before asking again — nothing has changed since.", null);

        // Rank is the gate. A probationary driver takes what they are given; the ladder is what earns
        // the pick of the fleet, and that is the whole point of the ladder.
        var rank = s.Driver.Rank;
        var faults = SafetyService.CountingFaults(s).Count;

        if (rank == "probationary")
            return Refuse(s,
                "Not while you are on probation. Take what you are given until that is behind you — " +
                "the good units go to drivers who have earned them, and you are three good reviews away.");

        if (faults > 0)
            return Refuse(s,
                $"You have {faults} preventable incident(s) still counting against you. Operations is not " +
                "moving you into a better unit while that is on the record. Run it clean and ask again.");

        var order = EquipmentService.IssueUpgrade(s,
            $"Requested by {s.Driver.Name} at the yard; approved on rank ({rank}) and a clean record.");

        if (order == null)
            return (false, "Nothing on the property is enough of an improvement to be worth the swap.", null);

        s.Driver.LastUnitRequestRefusedGameTime = "";
        return (true,
            $"Approved. {order.Number}: {order.Instruction}", order);
    }

    private static (bool, string, EquipmentOrder?) Refuse(AppState s, string why)
    {
        s.Driver.LastUnitRequestRefusedGameTime = s.Status.GameTime;
        return (false, why, null);
    }

    // ================================================================= home time

    public static HomeTimeRequest? OpenHomeRequest(AppState s) =>
        s.HomeTimeRequests.FirstOrDefault(r => r.Status == "Open");

    /// <summary>
    /// Puts in for home time. Refused outright only where the ask makes no sense — already home, one
    /// already pending, or too soon after a refusal. Everything else goes to operations and is answered
    /// when the next load closes out.
    /// </summary>
    public static HomeTimeRequest SubmitHomeRequest(AppState s, string reason)
    {
        if (OpenHomeRequest(s) != null)
            throw new InvalidOperationException("You already have a request in. Operations will answer it when you close your next load out.");

        var st = HomeTime.Status(s);
        if (st.AtHome)
            throw new InvalidOperationException("You are at the yard. Nothing to request — take your time at home.");

        var last = s.HomeTimeRequests.FirstOrDefault(r => r.Status == "Refused");
        if (last != null && GameClock.HoursBetween(last.AnsweredGameTime, s.Status.GameTime) is { } h
                         && h < CoolOffDays * 24)
            throw new InvalidOperationException(
                $"Operations turned the last one down {GameClock.Pretty(last.AnsweredGameTime)}. " +
                $"Give it {CoolOffDays:0} days before asking again — nothing has changed since this morning.");

        var req = new HomeTimeRequest
        {
            Number = $"{Code(s)}-HR-{s.HomeTimeRequests.Count + 1:0000}",
            RequestedGameTime = s.Status.GameTime,
            Reason = (reason ?? "").Trim(),
            DaysOutAtRequest = Math.Round(st.DaysOut, 2),
            Status = "Open"
        };
        s.HomeTimeRequests.Insert(0, req);
        return req;
    }

    /// <summary>
    /// Operations answers, on the driver's own arrangement rather than a flat rule.
    ///
    /// Somebody on a fourteen-day rotation asking at day sixteen has a case; somebody on a thirty-day
    /// asking at sixteen does not, and the same number of days means different things to the two of
    /// them. Past their own interval it is granted without much discussion. Under a third of it, they
    /// were home recently and the answer is no. In between it is a judgement, weighted by how far
    /// along they are — and the app says which of those it was.
    ///
    /// A driver who elected to stay out has no interval to measure against, so they get flat day
    /// counts. That is the deal they signed: getting home is something you ask for.
    /// </summary>
    public static HomeTimeRequest? Answer(AppState s)
    {
        var req = OpenHomeRequest(s);
        if (req == null) return null;

        var st = HomeTime.Status(s);
        var daysOut = st.DaysOut;
        var interval = s.Driver.HomeTimeIntervalDays;

        double yesAt, noUnder;
        string basis;
        if (interval > 0)
        {
            yesAt = interval;
            noUnder = interval / 3.0;
            basis = $"a {interval}-day arrangement";
        }
        else
        {
            // No arrangement on file: they chose to stay out, so the bar is fixed and higher.
            yesAt = 28;
            noUnder = 10;
            basis = "no home-time arrangement on file";
        }

        req.AnsweredGameTime = s.Status.GameTime;
        req.DaysOutAtAnswer = Math.Round(daysOut, 2);

        if (daysOut >= yesAt)
        {
            Grant(s, req, $"{daysOut:0.#} days out against {basis}. That is well past due — you are going home.");
            return req;
        }

        if (daysOut < noUnder)
        {
            req.Status = "Refused";
            req.Answer = $"{daysOut:0.#} days out against {basis}. That is not long enough for me to pull you off " +
                         $"the board — ask me again past {noUnder:0.#} days and we will talk.";
            return req;
        }

        // In between. How far along they are decides how likely it is, seeded so it cannot be re-rolled.
        var through = (daysOut - noUnder) / Math.Max(0.01, yesAt - noUnder);   // 0 at the floor, 1 at due
        var chance = (int)Math.Round(15 + through * 70);                       // 15% to 85%
        var roll = (int)(Hash($"{req.Number}|home|{req.RequestedGameTime}") % 100);

        if (roll < chance)
        {
            Grant(s, req, $"{daysOut:0.#} days out against {basis}. Not due yet, but close enough and we can cover " +
                          "your lane. Approved — I am working you back toward the house.");
            return req;
        }

        req.Status = "Refused";
        req.Answer = $"{daysOut:0.#} days out against {basis}. You are not due yet and I need the truck out here " +
                     $"a while longer. Ask me again in {CoolOffDays:0} days — it will be an easier yes then.";
        return req;
    }

    private static void Grant(AppState s, HomeTimeRequest req, string answer)
    {
        req.Status = "Granted";
        req.Answer = answer;
        // What actually routes them home. Read by HomeTime.Status, and cleared when they get there.
        s.Driver.HomeTimeGranted = true;
        s.Driver.HomeTimeGrantedGameTime = s.Status.GameTime;
    }

    // ================================================================= trailer type

    public static TrailerTypeRequest? OpenTrailerRequest(AppState s) =>
        s.TrailerTypeRequests.FirstOrDefault(r => r.Status == "Open");

    /// <summary>
    /// Trailer types the driver could reasonably ask for: what the company actually has at their home
    /// terminal, minus what they are already pulling. Asking for a lowboy the yard does not own is not
    /// a request, it is a wish.
    /// </summary>
    public static List<string> RequestableTrailerTypes(AppState s)
    {
        var home = Migrations.TerminalOf(s, s.Driver.HomeTerminalId)
                   ?? s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
        if (home == null) return new List<string>();

        var current = DispatchEngine.AssignedTrailer(s)?.Type ?? "";
        return s.Trailers
            .Where(t => !t.Retired && t.HomeTerminalId == home.Id)
            .Select(t => t.Type)
            .Where(t => !string.IsNullOrWhiteSpace(t) && !t.Equals(current, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t)
            .ToList();
    }

    /// <summary>
    /// Puts in for a different trailer type.
    ///
    /// A probationary driver cannot. You take what you are given until you have shown you can do the
    /// job, and that is not a punishment — it is what probation is.
    /// </summary>
    public static TrailerTypeRequest SubmitTrailerRequest(AppState s, string type)
    {
        if (s.Driver.Rank == "probationary")
            throw new InvalidOperationException(
                "You are still on probation. Take what you are given until that is behind you, then ask me again.");

        if (OpenTrailerRequest(s) != null)
            throw new InvalidOperationException("You already have a request in for that. One at a time.");

        var wanted = (type ?? "").Trim();
        if (wanted.Length == 0) throw new InvalidOperationException("Which trailer type?");

        var available = RequestableTrailerTypes(s);
        if (!available.Contains(wanted, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                available.Count == 0
                    ? "There is nothing else based at your yard to put you on."
                    : $"We have no {wanted.ToLowerInvariant()} at your yard. What is there: {string.Join(", ", available)}.");

        var last = s.TrailerTypeRequests.FirstOrDefault(r => r.Status == "Refused");
        if (last != null && GameClock.HoursBetween(last.AnsweredGameTime, s.Status.GameTime) is { } h
                         && h < CoolOffDays * 24)
            throw new InvalidOperationException(
                $"I said no to that {GameClock.Pretty(last.AnsweredGameTime)}. Give it {CoolOffDays:0} days.");

        var req = new TrailerTypeRequest
        {
            Number = $"{Code(s)}-TQ-{s.TrailerTypeRequests.Count + 1:0000}",
            RequestedType = wanted,
            RequestedGameTime = s.Status.GameTime,
            Status = "Open"
        };
        s.TrailerTypeRequests.Insert(0, req);
        return req;
    }

    /// <summary>
    /// Operations answers, on freight and on the driver's record.
    ///
    /// Experience is what carries it. Someone six loads past probation asking to be re-rigged gets a
    /// thinner hearing than a veteran with two hundred behind them, and that is fair — the second one
    /// has earned the benefit of the doubt. Freight mix is the other half: a yard that is not seeing
    /// that work is not going to re-rig anybody for it.
    /// </summary>
    public static TrailerTypeRequest? AnswerTrailerRequest(AppState s)
    {
        var req = OpenTrailerRequest(s);
        if (req == null) return null;

        req.AnsweredGameTime = s.Status.GameTime;

        var loads = s.Trips.Count(t => t.Status == "Delivered");
        var rank = s.Driver.Rank;

        // Rank is the coarse signal, loads the fine one. Both point the same way: time served.
        var rankWeight = rank switch
        {
            "owner" or "lease" => 40,
            "lead" => 30,
            "senior" => 20,
            "company" => 10,
            _ => 0
        };
        var loadWeight = (int)Math.Min(30, loads / 4.0);

        // Does the company actually run this freight? A division we do not haul is a flat no.
        var runsIt = s.Company.Divisions.Any(d =>
            d.Equals(TrailerSpec.DivisionFor(req.RequestedType), StringComparison.OrdinalIgnoreCase));
        var spare = s.Trailers.Count(t => !t.Retired
                                          && t.Type.Equals(req.RequestedType, StringComparison.OrdinalIgnoreCase)
                                          && string.IsNullOrWhiteSpace(t.AssignedTruckUnit));

        if (!runsIt)
        {
            req.Status = "Refused";
            req.Answer = $"We do not run {req.RequestedType.ToLowerInvariant()} freight as a division. There is one on the " +
                         "property, but putting you on it would leave you sitting waiting for loads that do not come.";
            return req;
        }

        var chance = 25 + rankWeight + loadWeight + (spare > 0 ? 15 : 0);
        var roll = (int)(Hash($"{req.Number}|trailer|{req.RequestedGameTime}") % 100);

        var why = $"{loads} load(s) delivered, {RankLabel(rank)}" + (spare > 0 ? ", and one free on the property" : ", nothing spare on the property");

        if (roll < chance)
        {
            req.Status = "Granted";
            req.Answer = $"Approved on your record — {why}. I will get you re-rigged at the house on your next home time.";
            // Reuses the ordinary reassignment path: report to the yard and swap, same as any other.
            var order = EquipmentService.IssueTrailerReassignment(s, req.RequestedType,
                $"{req.Number}: driver requested {req.RequestedType.ToLowerInvariant()}.");
            req.EquipmentOrderNumber = order?.Number ?? "";
            if (order == null)
                req.Answer += " You are already on one, so there is nothing to change.";
            return req;
        }

        req.Status = "Refused";
        req.Answer = $"Not this time — {why}. The freight out of your yard is not there for it right now. " +
                     $"Ask me again when you have more behind you.";
        return req;
    }

    private static string RankLabel(string rank) => rank switch
    {
        "owner" => "a master driver",
        "lease" => "a specialist driver",
        "lead" => "a lead driver",
        "senior" => "a senior driver",
        "company" => "a company driver",
        _ => "still probationary"
    };

    private static string Code(AppState s) =>
        string.IsNullOrWhiteSpace(s.Company.Code) ? "SFL" : s.Company.Code;

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
