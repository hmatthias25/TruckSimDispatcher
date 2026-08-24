using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What the player has to do <b>in ATS</b> when they change employer.
///
/// The app's books turn over cleanly: a new carrier means a new fleet, a new headquarters and a new
/// ledger. The game does not turn over at all. Whatever the player actually bought is still sitting in
/// their garages under the old company's colours, and nothing told them what to do about it — so the
/// two drifted apart at exactly the moment the app was least able to notice.
///
/// So a change of employer raises an instruction: sell what belonged to the last company, buy what this
/// one runs, and get to the cities where that has to happen.
///
/// The last part is the awkward one. ATS will not sell a garage in a city the player has never driven
/// to, and a yard in an undiscovered city would never see freight even if it could be bought. A new
/// employer headquartered somewhere the player has never been therefore starts with a drive that is not
/// company work at all — no load, no pay, just getting yourself to your new job. That is a real thing a
/// driver does, and it is worth being told about before it is discovered at a dealer screen.
///
/// Nothing here touches ATS, because nothing can. Each step is confirmed by the player once they have
/// actually done it, and only then does the app change its own books — the same contract as an
/// <see cref="EquipmentOrder"/>.
/// </summary>
public static class Changeover
{
    public const string Sell = "Sell";
    public const string Buy = "Buy";
    public const string Reach = "Reach";
    public const string Keep = "Keep";

    /// <summary>Everything the old employer's books held that the player really owns in game.</summary>
    public class Holdings
    {
        public List<Truck> Trucks { get; set; } = new();
        public List<Trailer> Trailers { get; set; } = new();
        public List<Terminal> Terminals { get; set; } = new();
        public string CarrierName { get; set; } = "";
        public string CarrierCode { get; set; } = "";

        /// <summary>
        /// Whether the new employer's headquarters city had already been driven to.
        ///
        /// Read here rather than at the point the instruction is built, because employing a carrier marks
        /// its headquarters reached — the driver is standing in the yard by then, so by that point the
        /// answer is always yes and the one question worth asking has been erased.
        /// </summary>
        public bool NewHqAlreadyReached { get; set; }
    }

    /// <summary>
    /// Reads what the player owns in game off the current books, <b>before</b> the hire clears them.
    ///
    /// Only real equipment counts. A unit that was never flagged as being in an ATS garage is company
    /// backdrop — it exists so the books make sense, and telling somebody to sell a truck that was never
    /// bought is how an instruction loses its credibility. Yards are read the same way: a yard in a city
    /// nobody has driven to was never bought either.
    /// </summary>
    public static Holdings Read(AppState s, string? joiningCode)
    {
        var (hqCity, hqState) = Carriers.HeadquartersOf(joiningCode);
        return new Holdings
        {
            CarrierName = s.Company.Name,
            CarrierCode = s.Company.Code,
            Trucks = s.Trucks.Where(t => t.InGameGarage && !t.Retired).ToList(),
            Trailers = s.Trailers.Where(t => t.InGameGarage && !t.Retired).ToList(),
            Terminals = s.Company.Terminals
                .Where(t => DiscoveryService.IsDiscovered(s, t.City, t.State))
                .ToList(),
            NewHqAlreadyReached = string.IsNullOrWhiteSpace(hqCity)
                                  || DiscoveryService.IsDiscovered(s, hqCity, hqState),
        };
    }

    /// <summary>
    /// Builds the instruction. Called after the new employer is in place, with the holdings read before
    /// it was.
    /// </summary>
    public static ChangeoverOrder Raise(AppState s, Holdings had)
    {
        var network = s.Company.NetworkCities ?? new List<string>();
        bool InNetwork(string? city, string? state) =>
            network.Any(n => n.Equals($"{city},{state}", StringComparison.OrdinalIgnoreCase));

        var order = new ChangeoverOrder
        {
            Number = $"CHG-{s.Company.Code}-{Math.Abs((had.CarrierCode + s.Company.Code).GetHashCode()) % 9000 + 1000}",
            FromCarrier = had.CarrierName,
            ToCarrier = s.Company.Name,
            RaisedGameTime = s.Status.GameTime,
        };

        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
        var hqCity = hq?.City ?? s.Company.TerminalCity;
        var hqState = hq?.State ?? s.Company.TerminalState;
        var hqPlace = DispatchEngine.Place(hqCity, hqState);

        // ---- the yards. Individually, because each one the player sells has to come off our books too.
        foreach (var yard in had.Terminals)
        {
            var place = DispatchEngine.Place(yard.City, yard.State);
            var isNewHq = yard.City.Equals(hqCity, StringComparison.OrdinalIgnoreCase)
                          && yard.State.Equals(hqState, StringComparison.OrdinalIgnoreCase);

            if (isNewHq || InNetwork(yard.City, yard.State))
            {
                order.Steps.Add(new ChangeoverStep
                {
                    Id = $"keep-yard-{yard.Id}",
                    Kind = Keep,
                    Title = $"Keep the garage in {place}",
                    Detail = isNewHq
                        ? $"{s.Company.Name} is headquartered here, so the garage you already own becomes your " +
                          "home yard. Nothing to do in game."
                        : $"{s.Company.Name} runs a yard here too, so it carries straight over. Nothing to do " +
                          "in game — it is contract fuel and a shop under new colours.",
                    Why = "You bought that garage; changing employer does not repossess it.",
                    City = yard.City, State = yard.State,
                    Done = true, DoneGameTime = s.Status.GameTime,
                });
                continue;
            }

            order.Steps.Add(new ChangeoverStep
            {
                Id = $"sell-yard-{yard.Id}",
                Kind = Sell,
                Title = $"Sell the garage in {place}",
                Detail =
                    $"{s.Company.Name} does not run a yard in {place}, so it is no use to you now — no freight " +
                    "worth basing out of, no contract fuel that suits the lanes you will be on. Sell the garage " +
                    "in ATS and I will take it off the books when you tick this off.\n\n" +
                    "Move anything parked there out first. ATS will not let a garage go while it still holds " +
                    "trucks or trailers.",
                Why = "A yard that is not on your employer's network costs money and earns nothing.",
                City = yard.City, State = yard.State,
                TerminalId = yard.Id,
            });
        }

        // ---- getting to the new headquarters, if it is somewhere nobody has been
        var hqUnowned = !had.Terminals.Any(t =>
            t.City.Equals(hqCity, StringComparison.OrdinalIgnoreCase)
            && t.State.Equals(hqState, StringComparison.OrdinalIgnoreCase));
        var hqUnreached = !had.NewHqAlreadyReached;

        if (hqUnowned && hqUnreached)
            order.Steps.Add(new ChangeoverStep
            {
                Id = "reach-hq",
                Kind = Reach,
                Title = $"Get yourself to {hqPlace} — you have never been there",
                Detail =
                    $"Your new yard is in {hqPlace} and you have not driven there, which is a problem before it " +
                    "is anything else: ATS will not sell you a garage in a city you have not discovered, and " +
                    "even if it would, an undiscovered city generates no cargo. So there is nothing to base out " +
                    "of until you have actually been.\n\n" +
                    "Drive it or fast travel it, whichever you would rather. Either way this leg is outside " +
                    "company scope — no load, no miles on your settlement, no hours against your cycle as far " +
                    "as I am concerned. It is you getting yourself to a new job, which is how it works in real " +
                    "life too.",
                Why = "Freight only exists in cities you have driven to. A yard in one you have not is a line " +
                      "on a map.",
                City = hqCity, State = hqState,
            });

        if (hqUnowned)
            order.Steps.Add(new ChangeoverStep
            {
                Id = "buy-hq",
                Kind = Buy,
                Title = $"Buy a garage in {hqPlace}",
                Detail =
                    $"A small garage is enough to start — {s.Company.Name} only needs somewhere to keep your " +
                    "tractor. Buy it in ATS, then set the tier on the Terminals tab so capacity here matches " +
                    "the game.\n\n" +
                    "I have already put your home yard here on the books, because that is where your new " +
                    "employer is and every plan I make starts from it. Until you have actually bought it, that " +
                    "is my assumption rather than a fact.",
                Why = "Dispatch plans every load out of your home yard and routes your home time to it.",
                City = hqCity, State = hqState,
            });

        // ---- the equipment. Grouped, because none of it changes our books — they are already cleared.
        if (had.Trucks.Count > 0)
            order.Steps.Add(new ChangeoverStep
            {
                Id = "sell-tractors",
                Kind = Sell,
                Title = had.Trucks.Count == 1
                    ? "Sell the tractor you were running"
                    : $"Sell the {had.Trucks.Count} tractors on the old books",
                Detail =
                    $"In ATS: {string.Join("; ", had.Trucks.Select(t => $"{t.Ref} — {t.Year} {t.Make} {t.Model}"))}.\n\n" +
                    (s.HiredDrivers.Any()
                        ? "Any of them with an AI driver in it has to be let go in game first; ATS will not sell " +
                          "a truck out from under an employee.\n\n"
                        : "") +
                    $"Those units belonged to {had.CarrierName}. They are already off our books — this is the " +
                    "game catching up with that.",
                Why = "Two companies' equipment in one garage is how the books and the game stop agreeing.",
            });

        if (had.Trailers.Count > 0)
            order.Steps.Add(new ChangeoverStep
            {
                Id = "sell-trailers",
                Kind = Sell,
                Title = had.Trailers.Count == 1
                    ? "Sell the trailer you were pulling"
                    : $"Sell the {had.Trailers.Count} trailers on the old books",
                Detail =
                    $"In ATS: {string.Join("; ", had.Trailers.Select(t => $"{t.Ref} — {t.Length} {TrailerSpec.Describe(t.Type, t.Subtype)}"))}.\n\n" +
                    $"{s.Company.Name} runs {string.Join(", ", s.Company.Divisions)}, so keep anything that " +
                    "matches and sell the rest — a reefer is no use at a flatbed outfit. If you would rather " +
                    "pull market trailers and treat the company boxes as paperwork, sell the lot.",
                Why = "Freight requiring a trailer you cannot pull is refused at dispatch.",
            });

        var truck = DispatchEngine.AssignedTruck(s);
        if (truck != null)
            order.Steps.Add(new ChangeoverStep
            {
                Id = "buy-tractor",
                Kind = Buy,
                Title = $"Buy your new tractor — {truck.Year} {truck.Make} {truck.Model}",
                Detail =
                    $"Spec it with a {truck.Transmission} and governed around {truck.GovernedMph} mph if the " +
                    "dealer has it. An exact match is not required: buy what the money runs to, then open " +
                    $"Fleet → unit {truck.Ref} → Edit and set the make, model, transmission and governed speed " +
                    "to what you actually bought. Those numbers are what every drive time is worked out from.",
                Why = $"{s.Company.Name} runs to a {s.Company.EquipmentStars}-star equipment standard, and this " +
                      "is what that buys a probationary driver.",
                Unit = truck.Ref,
            });

        var trailer = DispatchEngine.AssignedTrailer(s);
        if (trailer != null)
            order.Steps.Add(new ChangeoverStep
            {
                Id = "buy-trailer",
                Kind = Buy,
                Title = $"Sort a trailer — you are assigned {trailer.Ref}, a {trailer.Length} " +
                        $"{TrailerSpec.Describe(trailer.Type, trailer.Subtype)}",
                Detail =
                    $"Buy one in ATS and run company trailers, or take market trailers with each job and treat " +
                    $"{trailer.Ref} as paperwork. Either works — I only need to know which type you are pulling " +
                    "so the board is gated properly.",
                Why = "The trailer decides what freight you can be given.",
                Unit = trailer.Ref,
            });

        order.Steps.Add(new ChangeoverStep
        {
            Id = "true-up",
            Kind = Buy,
            Title = "Square the books once the money has moved",
            Detail =
                "Selling a garage and a couple of tractors puts a lot back in the bank, and buying replaces " +
                "it — neither of which I can see. Do the Monday true-up when the dust settles and the " +
                $"company's cash comes up to whatever ATS actually holds.\n\n" +
                "It is prompted on a Monday anyway. This is just a note that the figure will have moved.",
            Why = "The books only ever come up to the game, so the game has to be right first.",
        });

        return order;
    }

    /// <summary>The instruction as the browser needs it, or null when there is nothing outstanding.</summary>
    public static object? View(AppState s)
    {
        var o = s.Changeover;
        if (o == null || o.Closed) return null;

        var outstanding = o.Steps.Count(x => !x.Done);
        return new
        {
            o.Number, o.FromCarrier, o.ToCarrier, o.RaisedGameTime,
            outstanding,
            total = o.Steps.Count,
            blocked = o.Steps.Any(x => !x.Done && x.Kind == Reach),
            steps = o.Steps.Select(x => new
            {
                x.Id, x.Kind, x.Title, x.Detail, x.Why, x.City, x.State, x.Unit, x.Done, x.DoneGameTime
            }).ToList(),
        };
    }

    /// <summary>
    /// The player confirming they have done one of these in game.
    ///
    /// Selling a yard is the only step with a consequence for our books, and it has one because the app
    /// was carrying a garage the player no longer owns. The rest are things only ATS can record.
    /// </summary>
    public static string Confirm(AppState s, string? id)
    {
        var o = s.Changeover ?? throw new InvalidOperationException("There is no changeover instruction open.");
        var step = o.Steps.FirstOrDefault(x => x.Id.Equals((id ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
                   ?? throw new InvalidOperationException("That is not one of the steps.");
        if (step.Done) throw new InvalidOperationException("That one is already ticked off.");

        step.Done = true;
        step.DoneGameTime = s.Status.GameTime;

        var said = $"{step.Title} — done.";

        if (step.Kind == Sell && !string.IsNullOrWhiteSpace(step.TerminalId))
        {
            var yard = s.Company.Terminals.FirstOrDefault(t => t.Id == step.TerminalId);
            if (yard != null)
            {
                if (yard.IsHeadquarters)
                    throw new InvalidOperationException(
                        "That is your headquarters yard now — it is not one to sell.");

                s.Company.Terminals.Remove(yard);
                DiscoveryService.SyncOwnership(s);
                said = $"Garage in {DispatchEngine.Place(yard.City, yard.State)} is off the books.";
            }
        }

        if (step.Kind == Reach && !string.IsNullOrWhiteSpace(step.City))
        {
            DiscoveryService.Note(s, step.City, step.State, s.Status.GameTime);

            // They just drove there, so that is where they are. The resignation deliberately did not move
            // them — it cannot teleport somebody to a city they have never seen — and this is the moment
            // it becomes true.
            s.Status.LocationCity = step.City;
            s.Status.LocationState = step.State;
            s.Status.LocationKind = "Terminal";
            s.Status.LocationDetail = $"{s.Company.Name} yard";

            said = $"{DispatchEngine.Place(step.City, step.State)} is on your map, and that is where I have " +
                   "you. That city will offer freight now, and the dealer will sell you a garage.";
        }

        if (o.Steps.All(x => x.Done))
        {
            o.Closed = true;
            o.ClosedGameTime = s.Status.GameTime;
            said += $" That is the changeover done — you are set up at {o.ToCarrier}.";
        }

        return said;
    }

    /// <summary>
    /// Putting the instruction away without working through it.
    ///
    /// Allowed, because a player who did all of this before the app asked should not be made to tick
    /// boxes about it. Kept on file rather than deleted.
    /// </summary>
    public static void Close(AppState s)
    {
        var o = s.Changeover ?? throw new InvalidOperationException("There is no changeover instruction open.");
        o.Closed = true;
        o.ClosedGameTime = s.Status.GameTime;
    }
}
