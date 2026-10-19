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

    /// <summary>
    /// The rank a plain dedicated account is open to: <b>senior and above</b>.
    ///
    /// <para>Steadier freight and more predictable home time, at a slightly lower rate — a seat the
    /// company gives a driver it has come to rely on. That is a senior driver, not a first-week hire.</para>
    ///
    /// <para>Deliberately a rung below <see cref="DropHook.RankAllowsDedicated"/>, which holds dedicated
    /// <i>drop and hook</i> at the top of the ladder. They are not the same seat: one is a customer to
    /// haul for, the other is the best job in the fleet with no dock work and pay over scale.</para>
    /// </summary>
    public static bool RankAllowsPlain(AppState s)
    {
        if (Probation.IsOn(s) || s.Driver.Probation.Active) return false;
        var mine = CareerService.RankIndex(s.Driver.Rank);
        var senior = CareerService.RankIndex("senior");
        return mine >= 0 && senior >= 0 && mine >= senior;
    }

    /// <summary>
    /// Why this driver cannot go on a dedicated account, or null when they may ask.
    ///
    /// <para>This used to be nothing at all. <see cref="SetAccount"/> checked whether the CARRIER ran
    /// dedicated freight and nothing else, so a probationary driver hired an hour ago at a carrier with
    /// a dedicated division saw the panel and put themselves on an account with a button. Reported from
    /// play on a fresh Schneider career. The rank rule existed the whole time — it just guarded the
    /// drop-and-hook variant further down the same panel and not this one.</para>
    ///
    /// <para>Said as a reason rather than a missing button, the same as everywhere else: a thing worth
    /// wanting should be visibly out of reach and visibly reachable.</para>
    /// </summary>
    public static string? BlockedBecause(AppState s)
    {
        if (!CarrierRunsDedicated(s))
            return $"{s.Company.Name} does not run a dedicated division, so there is no account to put you on.";

        if (Probation.IsOn(s) || s.Driver.Probation.Active)
            return "Not while you are on probation. A dedicated account is us putting your name in front of " +
                   "a customer, and we do not do that with a driver we are still assessing.";

        if (!RankAllowsPlain(s))
            return "A dedicated account goes to a driver the company has come to rely on — steady freight " +
                   "and home time you can plan around, in exchange for a slightly lower rate. That starts " +
                   "at Senior Company Driver. Keep the record clean and it comes.";

        return null;
    }

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

    /// <summary>
    /// Whether a name on a load refers to the driver's customer.
    ///
    /// Loose on purpose — ATS names the company on the job and the player types what they see, so
    /// "Walmart DC 6094", "Walmart Supercenter" and "Walmart" all have to be the same account. But loose
    /// on WORDS, not on raw substrings.
    ///
    /// It used to be a plain two-way Contains, which meant any name that happened to sit inside the
    /// account counted as the account's freight: "Art" is inside "Walmart". That mislabelled somebody
    /// else's load as the driver's, and then did real damage — with the app believing there was
    /// on-account work on the board, CanRunOffAccount withheld the off-account escape and hard-failed
    /// every other load. The driver was pushed onto freight that was not theirs and refused the freight
    /// they could legitimately have run. ATS is full of short names that trip it: Art, Cal, Sun, Tex.
    /// </summary>
    private static bool Mentions(string? field, string account)
    {
        var f = (field ?? "").Trim();
        if (f.Length == 0 || account.Length == 0) return false;

        var fieldWords = Words(f);
        var accountWords = Words(account);
        if (fieldWords.Count == 0 || accountWords.Count == 0) return false;

        // A shared word with enough letters in it to mean something. "Walmart" matches "Walmart DC";
        // "Foods" matches "US Foods Chicago". Three letters is the floor because "DC", "Co" and "Inc"
        // appear in half the names in the game and identify nobody.
        if (fieldWords.Any(w => w.Length >= 4 && accountWords.Contains(w))) return true;

        // Short accounts are real — BP, JBS, RC. They match as a whole word, never as a fragment.
        return accountWords.Count == 1 && fieldWords.Contains(accountWords[0])
               || fieldWords.Count == 1 && accountWords.Contains(fieldWords[0]);
    }

    /// <summary>Lower-cased words, punctuation and unit numbers stripped.</summary>
    private static List<string> Words(string text) =>
        text.Split(new[] { ' ', '\t', '-', '/', ',', '.', '&', '(', ')', '\'', '"', '#' },
                   StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.Trim().ToLowerInvariant())
            .Where(w => w.Length > 0 && !w.All(char.IsDigit))
            .ToList();

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
    /// <summary>What the company asks of a driver before it puts them in front of a customer.</summary>
    public const double RequiredOnTimePct = 95;
    public const int RequiredLoadsHere = 25;
    public const int AllowedFaults = 1;

    /// <summary>Days before a refusal can be argued with again.</summary>
    public const int CoolOffDays = 30;

    /// <summary>An ask still waiting on an answer.</summary>
    public static DedicatedAccountRequest? OpenRequest(AppState s) =>
        s.DedicatedAccountRequests.FirstOrDefault(r => r.Status == "Open");

    /// <summary>A yes that has not been used yet.</summary>
    public static DedicatedAccountRequest? Approved(AppState s) =>
        s.DedicatedAccountRequests.FirstOrDefault(r => r.Status == "Granted" && !r.Spent);

    /// <summary>
    /// Puts in for a dedicated account. Refused outright where the rank rule has not been met — there
    /// is nothing for operations to weigh and pretending to consider it would be theatre.
    /// </summary>
    public static DedicatedAccountRequest Submit(AppState s)
    {
        if (BlockedBecause(s) is { } no) throw new InvalidOperationException(no);
        if (Active(s) || s.Driver.OnDedicated)
            throw new InvalidOperationException("You are already on a dedicated account.");
        if (OpenRequest(s) != null)
            throw new InvalidOperationException("You already have one in. One at a time.");
        if (Approved(s) != null)
            throw new InvalidOperationException(
                "That is already approved — name the customer and you are on it.");

        var last = s.DedicatedAccountRequests.FirstOrDefault(r => r.Status == "Refused");
        if (last != null && GameClock.HoursBetween(last.AnsweredGameTime, s.Status.GameTime) is { } h
                         && h < CoolOffDays * 24)
            throw new InvalidOperationException(
                $"I said no to that {GameClock.Pretty(last.AnsweredGameTime)}. Give it {CoolOffDays} days " +
                "and show me something different in the meantime.");

        var req = new DedicatedAccountRequest
        {
            Number = $"{s.Company.Code}-DQ-{s.DedicatedAccountRequests.Count + 1:0000}",
            RequestedGameTime = s.Status.GameTime,
            Status = "Open",
            RankAtTime = s.Driver.Rank,
        };
        s.DedicatedAccountRequests.Insert(0, req);
        return req;
    }

    /// <summary>
    /// Operations answers, on the record and nothing else.
    ///
    /// <para>No roll. A dedicated account is a customer who will ring the company when a load is late,
    /// so what decides it is whether this driver is safe to put in front of one — service, the safety
    /// record, and enough work here to know. A driver who has earned it gets it every time, and one who
    /// has not is told which number is in the way and can go and fix it. A dice roll on top would make
    /// the record advisory, which is the opposite of what it is for.</para>
    /// </summary>
    public static DedicatedAccountRequest? Answer(AppState s)
    {
        var req = OpenRequest(s);
        if (req == null) return null;

        req.AnsweredGameTime = s.Status.GameTime;

        var stats = CareerService.Compute(s);
        var faults = stats.DriverFaultIncidents;
        var shortfalls = new List<string>();

        if (stats.LoadsDelivered < RequiredLoadsHere)
            shortfalls.Add($"{stats.LoadsDelivered} load(s) with us against the {RequiredLoadsHere} I want " +
                           "before I put somebody on an account");
        if (stats.OnTimePct < RequiredOnTimePct)
            shortfalls.Add($"{stats.OnTimePct:0.#}% on time against {RequiredOnTimePct:0}%");
        if (faults > AllowedFaults)
            shortfalls.Add($"{faults} driver-fault incident(s) on the record, and I can carry {AllowedFaults}");

        if (shortfalls.Count > 0)
        {
            req.Status = "Refused";
            req.Answer = "No, not yet. A dedicated customer rings us when a load is late, so the driver on " +
                         "their account has to be somebody I am not going to hear about: " +
                         string.Join("; ", shortfalls) + ". Fix that and ask me again — " +
                         $"give it {CoolOffDays} days.";
            return req;
        }

        req.Status = "Granted";
        req.Answer = $"Granted. {stats.LoadsDelivered} loads with us at {stats.OnTimePct:0.#}% on time and " +
                     "a clean enough record to put in front of a customer. Tell me which account as it " +
                     "appears on your board and I will filter your freight to it. It is not a promotion " +
                     "and you can come off it whenever you like.";
        return req;
    }

    public static string SetAccount(AppState s, bool onDedicated, string account)
    {
        // Going ON is operations' call and has to have been asked for. Coming OFF never is — a driver
        // who wants back on the open board says so and that is the end of it.
        //
        // This checked only whether the carrier ran a dedicated division, which meant the rank rule,
        // the request and the refusal were all bypassed by the one button that actually did the thing.
        if (onDedicated && !s.Driver.OnDedicated)
        {
            if (BlockedBecause(s) is { } no) throw new InvalidOperationException(no);

            var ok = Approved(s) ?? throw new InvalidOperationException(
                OpenRequest(s) != null
                    ? "Your request is in and I have not answered it yet."
                    : "You do not put yourself on a dedicated account — ask for one and I will answer it.");
            ok.Spent = true;
        }

        s.Driver.OnDedicated = onDedicated;
        s.Driver.DedicatedAccount = onDedicated ? (account ?? "").Trim() : "";

        if (!onDedicated) return "Off dedicated and back on the open board. Everything on the board is yours to be assigned.";
        if (string.IsNullOrWhiteSpace(s.Driver.DedicatedAccount))
            return "On dedicated. Tell me the customer's name as it appears on your board and I will filter to it.";

        return $"On dedicated to {s.Driver.DedicatedAccount}. I will only assign you their freight " +
               "unless the account runs dry, and then it goes on the record as an exception.";
    }
}
