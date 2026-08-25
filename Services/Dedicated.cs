using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Dedicated freight: the driver is assigned to one customer and hauls their freight only.
///
/// Several real carriers in the market run a Dedicated division, and the term was appearing on their
/// cards without meaning anything. This is what it means here:
///
///   * one customer, named by the player from what they can actually see in their game
///   * the board is filtered to that customer — other companies' freight is visible but not yours
///   * steadier work and more predictable home time, at a rate that is usually a shade lower
///
/// The customer is deliberately not invented. The app cannot know which shippers exist in a given
/// install, which map mods are loaded, or what the player has discovered, so it asks rather than
/// making one up and then filtering the board against a company that is not there.
/// </summary>
public static class Dedicated
{
    /// <summary>
    /// Accounts this driver could be put on, best first.
    ///
    /// Filtered by the map they have actually driven and the divisions their carrier hauls — see
    /// <see cref="AtsCompanies.Candidates"/>. An empty list is a real answer and gets said out loud
    /// rather than producing an account nobody can reach.
    /// </summary>
    public static List<object> Offers(AppState s) =>
        AtsCompanies.Candidates(s).Take(6).Select(f => (object)new
        {
            name = f.Name,
            // What the player's own game calls them, where their mod has been read. The account is filed
            // under this, because it is the string they will be reading off job listings.
            called = ModCompanyNames.Display(s, f),
            industry = f.Industry,
            category = f.Category,
            depots = f.Depots,
            reach = AtsCompanies.Reach(s, f),
        }).ToList();

    /// <summary>
    /// Puts the driver on an account.
    ///
    /// <paramref name="asTheGameCallsIt"/> is what their own install shows, when a renaming mod means it
    /// is not what the base game calls it. The app files the account under that name, because that is
    /// the string the player will be reading off job listings — the vanilla name is kept beside it so
    /// the record still says which company it is.
    /// </summary>
    public static string AssignAccount(AppState s, string? company, string? asTheGameCallsIt)
    {
        var firm = AtsCompanies.Find(company)
                   ?? throw new InvalidOperationException("That is not a company this game ships freight for.");

        if (!AtsCompanies.Candidates(s).Any(f => f.Name.Equals(firm.Name, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException(
                $"{firm.Name} is not somewhere we can put you. {AtsCompanies.Reach(s, firm)}.");

        // Typed wins, then whatever was read out of their mod, then the stock name.
        var shown = (asTheGameCallsIt ?? "").Trim();
        if (shown.Length == 0)
        {
            var read = ModCompanyNames.Display(s, firm);
            if (!read.Equals(firm.Name, StringComparison.OrdinalIgnoreCase)) shown = read;
        }
        s.Driver.OnDedicated = true;
        s.Driver.DedicatedAccount = shown.Length > 0 ? shown : firm.Name;
        s.Driver.DedicatedVanillaName = shown.Length > 0 ? firm.Name : "";
        s.Driver.OffAccountLoads = 0;

        var called = shown.Length > 0 && !shown.Equals(firm.Name, StringComparison.OrdinalIgnoreCase)
            ? $" Your game calls them {shown}; unmodded it is {firm.Name}."
            : "";

        return $"You are dedicated to {s.Driver.DedicatedAccount} — {firm.Industry.ToLowerInvariant()}, " +
               $"{AtsCompanies.Reach(s, firm)}.{called} Their freight only from here.";
    }

    /// <summary>Whether the carrier the driver works for runs dedicated freight at all.</summary>
    public static bool CarrierRunsDedicated(AppState s) =>
        s.Company.Divisions.Any(d => d.Equals("Dedicated", StringComparison.OrdinalIgnoreCase));

    /// <summary>On a dedicated account and we know who the customer is.</summary>
    public static bool Active(AppState s) =>
        s.Driver.OnDedicated && !string.IsNullOrWhiteSpace(s.Driver.DedicatedAccount);

    /// <summary>On dedicated but the customer has not been named yet — dispatch has to ask.</summary>
    public static bool AwaitingAccount(AppState s) =>
        s.Driver.OnDedicated && string.IsNullOrWhiteSpace(s.Driver.DedicatedAccount);

    /// <summary>
    /// Whether a load belongs to the driver's account.
    ///
    /// Matches loosely on either end of the load, because ATS names the company on the job and the
    /// player types what they see — "Walmart DC" and "Walmart" are the same customer, and insisting
    /// on an exact string would reject the account's own freight.
    /// </summary>
    public static bool IsOnAccount(AppState s, BoardLoad load)
    {
        if (!Active(s)) return true;
        var account = s.Driver.DedicatedAccount.Trim();
        return Mentions(load.Shipper, account)
               || Mentions(load.Receiver, account)
               || Mentions(load.Broker, account);
    }

    private static bool Mentions(string? field, string account)
    {
        var f = (field ?? "").Trim();
        if (f.Length == 0 || account.Length == 0) return false;
        return f.Contains(account, StringComparison.OrdinalIgnoreCase)
               || account.Contains(f, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Why a load is not the driver's to take. Returned as a hard fail so it reads as a rule rather
    /// than a preference — but see <see cref="CanRunOffAccount"/>: it is not an absolute.
    /// </summary>
    public static string RejectionReason(AppState s, BoardLoad load) =>
        $"Not your account. You are dedicated to {s.Driver.DedicatedAccount}, and this is " +
        $"{Describe(load)} freight. It is on the board, but it is not yours to take.";

    private static string Describe(BoardLoad load)
    {
        var who = new[] { load.Shipper, load.Broker, load.Receiver }
            .FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
        return string.IsNullOrWhiteSpace(who) ? "another customer's" : who!;
    }

    /// <summary>
    /// Running off-account is an exception a dispatcher can authorise, not a thing the driver just
    /// does. It exists because a dedicated account can genuinely run dry in a region, and stranding
    /// the truck would be worse than the exception.
    /// </summary>
    public static bool CanRunOffAccount(AppState s, out string note)
    {
        note = "";
        if (!Active(s)) return true;

        // Only when the account really has nothing here.
        var onAccount = s.Board.Count(b => IsOnAccount(s, b));
        if (onAccount > 0)
        {
            note = $"{onAccount} load(s) on your account on this board — take one of those.";
            return false;
        }

        note = $"Nothing for {s.Driver.DedicatedAccount} on this board. Running another customer's " +
               "freight is an exception; I will authorise it and it goes on the record as off-account.";
        return true;
    }

    /// <summary>The dispatch-note line explaining how the board is being read.</summary>
    public static string? BoardNote(AppState s)
    {
        if (AwaitingAccount(s))
            return "You are on a dedicated account and I do not know who the customer is yet. " +
                   "Open your freight board in ATS, look at who the freight belongs to, and set the " +
                   "account on the Career tab — then I can tell your loads from everyone else's.";
        if (!Active(s)) return null;

        var onAccount = s.Board.Count(b => IsOnAccount(s, b));
        return onAccount > 0
            ? $"Dedicated to {s.Driver.DedicatedAccount} — {onAccount} of {s.Board.Count} load(s) on this board are yours."
            : $"Dedicated to {s.Driver.DedicatedAccount}, and none of this board is theirs.";
    }

    /// <summary>
    /// Putting a driver on, or taking them off, a dedicated account. Coming off is a real career move
    /// — open board pays better per mile and sees more of the map, at the cost of the routine.
    /// </summary>
    public static string SetAccount(AppState s, bool onDedicated, string account)
    {
        if (onDedicated && !CarrierRunsDedicated(s))
            throw new InvalidOperationException(
                $"{s.Company.Name} does not run a dedicated division. You are on open board here.");

        s.Driver.OnDedicated = onDedicated;
        s.Driver.DedicatedAccount = onDedicated ? (account ?? "").Trim() : "";

        if (!onDedicated) return "Off dedicated and back on the open board. Everything on the board is yours to be assigned.";
        if (string.IsNullOrWhiteSpace(s.Driver.DedicatedAccount))
            return "On dedicated. Tell me the customer's name as it appears on your board and I will filter to it.";

        return $"On dedicated to {s.Driver.DedicatedAccount}. I will only assign you their freight " +
               "unless the account runs dry, and then it goes on the record as an exception.";
    }
}
