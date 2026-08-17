using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What happens when equipment gets hurt.
///
/// ATS repairs a truck instantly for money, which makes damage a line item rather than a
/// consequence. Three rules put the weight back on it, and all three are roleplay the app enforces
/// and the driver observes in their own game:
///
/// <list type="number">
///   <item>A repair takes time, quoted before the driver commits so it can be weighed against the clock.</item>
///   <item>At a threshold the company stops dispatching and orders the truck to a shop.</item>
///   <item>Past a second threshold the tractor is written off and does not come back.</item>
/// </list>
///
/// Only equipment ATS actually knows about is subject to any of it. A backdrop unit the driver has
/// never sat in has no real condition to read, so sending it to the shop would be inventing a problem
/// they could never resolve.
/// </summary>
public static class Shop
{
    public class RepairQuote
    {
        public double TruckDamagePct { get; set; }
        public double TrailerDamagePct { get; set; }
        public double TruckHours { get; set; }
        public double TrailerHours { get; set; }
        /// <summary>What the driver actually waits. A shop works both units at once.</summary>
        public double WaitHours { get; set; }
        public bool AtCompanyShop { get; set; }
        /// <summary>The write-off line for this particular unit, scaled by what is on its odometer.</summary>
        public double TotalLossAtPct { get; set; }
        public List<string> Lines { get; set; } = new();
        /// <summary>Set when this repair is not a repair at all — the tractor is past saving.</summary>
        public bool TotalLoss { get; set; }
    }

    /// <summary>
    /// How long the shop needs. Roughly <b>forty minutes a point</b> on the tractor and about a third
    /// of that rate on the trailer, with the two running in parallel because a shop does not queue them
    /// one behind the other. Our own yard is quicker than a roadside dealer — our people, our bays, no
    /// waiting for a slot.
    ///
    /// The tractor rate is deliberately heavy. If ten points of damage cost two hours, being routed
    /// home for it would be absurd — the whole point is that real body work on a tractor is most of a
    /// day, which is what makes "run it to our own shop and take your home time while it is in" the
    /// obviously right call instead of an inconvenience.
    /// </summary>
    public static RepairQuote Quote(AppState s, double truckDamagePct, double trailerDamagePct,
        bool atCompanyShop, Truck? truck = null)
    {
        var m = s.Settings.Maintenance;
        var q = new RepairQuote
        {
            TruckDamagePct = Math.Max(0, truckDamagePct),
            TrailerDamagePct = Math.Max(0, trailerDamagePct),
            AtCompanyShop = atCompanyShop,
            TotalLossAtPct = TotalLossPctFor(s, truck)
        };

        var factor = atCompanyShop ? Math.Clamp(m.CompanyShopFactor, 0.1, 1.0) : 1.0;
        q.TruckHours = q.TruckDamagePct * m.RepairHoursPerPoint * factor;
        q.TrailerHours = q.TrailerDamagePct * m.RepairHoursPerPoint * m.TrailerRepairFactor * factor;
        q.WaitHours = Math.Max(q.TruckHours, q.TrailerHours);

        if (q.TruckDamagePct >= q.TotalLossAtPct)
        {
            q.TotalLoss = true;
            q.Lines.Add($"The tractor is at {q.TruckDamagePct:0.#}%, past the {q.TotalLossAtPct:0.#}% write-off line for this unit. " +
                        "This one does not go through the shop — it goes on the insurance claim.");
            if (truck != null) q.Lines.Add(ExplainTotalLossLine(s, truck));
            return q;
        }

        if (q.WaitHours <= 0)
        {
            q.Lines.Add("Nothing to fix.");
            return q;
        }

        if (q.TruckHours > 0)
            q.Lines.Add($"Tractor at {q.TruckDamagePct:0.#}%: about {Hhmm.Of(q.TruckHours)} in the bay.");
        if (q.TrailerHours > 0)
            q.Lines.Add($"Trailer at {q.TrailerDamagePct:0.#}%: about {Hhmm.Of(q.TrailerHours)} — trailer work goes quicker.");
        if (q.TruckHours > 0 && q.TrailerHours > 0)
            q.Lines.Add($"They work both at once, so the wait is the longer of the two: {Hhmm.Of(q.WaitHours)}, not the sum.");

        q.Lines.Add(atCompanyShop
            ? "That is at our own yard, which is the quicker option."
            : $"That is a roadside dealer. Our own shop would turn it round in about {Hhmm.Of(q.WaitHours * Math.Clamp(m.CompanyShopFactor, 0.1, 1.0))}.");
        q.Lines.Add("It is on-duty-not-driving time. Report it when it is done and it lands in your HOS like anything else.");

        return q;
    }

    /// <summary>
    /// The damage at which <b>this</b> tractor gets written off rather than repaired.
    ///
    /// A flat threshold gets the decision wrong at both ends. Nobody scraps a truck with 60,000 miles
    /// on it over damage they would happily pay to fix, and nobody sinks that money into one with
    /// 600,000 — at that point the repair is worth more than the truck. So the line falls with the
    /// odometer: a fresh unit is held to the full threshold, a worn-out one to a fraction of it.
    ///
    /// The odometer is the one the driver reports out of ATS, because that is the number they can see.
    /// </summary>
    public static double TotalLossPctFor(AppState s, Truck? truck)
    {
        var m = s.Settings.Maintenance;
        if (truck == null) return m.TotalLossPct;

        var miles = truck.AtsOdometer > 0 ? truck.AtsOdometer : truck.ServiceMiles;
        var life = Math.Max(1, m.WriteOffLifeMiles);
        var worn = Math.Clamp(miles / life, 0, 1);
        var line = m.TotalLossPct * (1 - Math.Clamp(m.WriteOffWearFactor, 0, 1) * worn);
        return Math.Round(Math.Max(m.WriteOffFloorPct, Math.Min(m.TotalLossPct, line)), 1);
    }

    /// <summary>Why the line sits where it does, in words the driver can argue with.</summary>
    public static string ExplainTotalLossLine(AppState s, Truck truck)
    {
        var m = s.Settings.Maintenance;
        var miles = truck.AtsOdometer > 0 ? truck.AtsOdometer : truck.ServiceMiles;
        var line = TotalLossPctFor(s, truck);
        if (line >= m.TotalLossPct - 0.05)
            return $"Unit {truck.Unit} has {miles:N0} mi on it, so it is worth fixing right up to {line:0.#}%.";
        return $"Unit {truck.Unit} has {miles:N0} mi on it. We write that unit off at {line:0.#}%, not the " +
               $"{m.TotalLossPct:0.#}% a fresh one gets — past a certain mileage the repair is worth more than the truck.";
    }

    /// <summary>True when the driver is sitting at one of our yards that has a shop in it.</summary>
    public static bool AtCompanyShop(AppState s)
    {
        var here = s.Company.Terminals.FirstOrDefault(t =>
            string.Equals(t.City, s.Status.LocationCity, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(t.State, s.Status.LocationState, StringComparison.OrdinalIgnoreCase));
        return here?.HasShop == true;
    }

    public class ShopOrder
    {
        /// <summary>None | Shop | RunHome | TotalLoss</summary>
        public string Kind { get; set; } = "None";
        public string Headline { get; set; } = "";
        public List<string> Instructions { get; set; } = new();
        public double TruckDamagePct { get; set; }
        public double TrailerDamagePct { get; set; }
        public RepairQuote? Quote { get; set; }
        /// <summary>Set on RunHome — where they are going and how far it is.</summary>
        public string HomeLabel { get; set; } = "";
        public double? HomeMiles { get; set; }
        public double? HomeDriveHours { get; set; }
        /// <summary>Where the write-off line sits for this unit, given its mileage.</summary>
        public double TotalLossAtPct { get; set; }
        /// <summary>Set when the repair will not be finished before home time falls due.</summary>
        public string LateWarning { get; set; } = "";

        /// <summary>
        /// True when the order stops freight outright. A run-home order does not: the driver still
        /// takes a board, and if something on it finishes at the yard they run it loaded rather than
        /// deadheading the whole way for nothing.
        /// </summary>
        public bool BlocksAllFreight => Kind is "Shop" or "TotalLoss";
    }

    /// <summary>
    /// Whether a load is acceptable under a run-home order — it has to actually end at the yard we are
    /// sending them to. "Toward home" is not good enough here: the truck is hurt and every extra mile
    /// on it is a mile it might not make.
    /// </summary>
    public static bool FinishesAtHome(AppState s, BoardLoad load)
    {
        var home = HomeTime.HomeTerminal(s);
        if (home == null) return false;
        var miles = Geo.MilesBetween(load.DestCity, load.DestState, home.City, home.State);
        return miles is { } m && m <= s.Settings.Scoring.HomeRadiusMiles;
    }

    /// <summary>
    /// What the company is telling the driver to do about the condition of their equipment.
    ///
    /// The interesting case is the middle one. When the home terminal is inside a day's drive and the
    /// unit is not too far gone, running it home beats stopping at the first dealer: our labour is
    /// cheaper, the truck ends up where it is needed, and the time in the shop is time the driver was
    /// going to spend at home anyway. So the app says which it is choosing and why, rather than
    /// issuing an order the driver has to take on faith.
    /// </summary>
    public static ShopOrder Assess(AppState s, Truck? truck, Trailer? trailer)
    {
        var m = s.Settings.Maintenance;
        var order = new ShopOrder();

        // Only equipment the driver actually sits in has condition we can read.
        if (truck is not { InGameGarage: true }) return order;

        var td = Math.Max(truck.DamagePct, s.Status.TruckDamagePct);
        var rd = trailer is { InGameGarage: true } ? Math.Max(trailer.DamagePct, s.Status.TrailerDamagePct) : 0;
        order.TruckDamagePct = td;
        order.TrailerDamagePct = rd;

        var writeOffAt = TotalLossPctFor(s, truck);
        order.TotalLossAtPct = writeOffAt;

        if (td >= writeOffAt)
        {
            order.Kind = "TotalLoss";
            order.Headline = $"Unit {truck.Unit} is at {td:0.#}% — that is a total loss, not a repair.";
            order.Quote = Quote(s, td, rd, false, truck);
            order.Instructions.Add(ExplainTotalLossLine(s, truck));
            order.Instructions.Add("We do not put that kind of money into a unit and get a good truck back.");
            order.Instructions.Add("Operations is filing the insurance claim. Sell the wreck for scrap in your game and tell me what it fetched — that goes against the claim.");
            order.Instructions.Add("Report to your home terminal to be issued a replacement. Write off the unit on the Fleet tab and I will tell you what to buy.");
            return order;
        }

        var worst = Math.Max(td, rd);
        if (worst < m.StopDispatchPct) return order;

        var atShop = AtCompanyShop(s);
        order.Quote = Quote(s, td, rd, atShop, truck);

        var what = td >= m.StopDispatchPct && rd >= m.StopDispatchPct
            ? $"Unit {truck.Unit} at {td:0.#}% and trailer {trailer?.Unit} at {rd:0.#}%"
            : td >= m.StopDispatchPct ? $"Unit {truck.Unit} at {td:0.#}%"
            : $"Trailer {trailer?.Unit} at {rd:0.#}%";

        // Is home close enough to be the better shop?
        var home = HomeTime.HomeTerminal(s);
        var miles = home == null ? null
            : Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        var driveHours = miles / Math.Max(20, s.Settings.GovernedMph * s.Settings.SpeedFactor);
        var homeIsClose = home != null && driveHours is { } dh && dh <= m.RunHomeMaxHours;

        // Never run home on a unit that is nearly a write-off. On a high-mileage truck that line is
        // low, so the cap has to move with it rather than sitting at a fixed 20%.
        var runHomeCap = Math.Min(m.RunHomeMaxDamagePct, writeOffAt * 0.75);

        if (homeIsClose && td < runHomeCap && rd < m.RunHomeMaxDamagePct)
        {
            order.Kind = "RunHome";
            order.HomeLabel = DispatchEngine.Place(home!.City, home.State);
            order.HomeMiles = miles;
            order.HomeDriveHours = driveHours;
            order.Quote = Quote(s, td, rd, true, truck);
            order.Headline = $"{what} — no more loads. Run it home to {order.HomeLabel} and fix it there.";
            order.Instructions.Add(
                $"{order.HomeLabel} is {miles:N0} mi out, about {Hhmm.Of(driveHours!.Value)} of driving. That is inside a day, " +
                "and the damage is light enough to make it — so you take it to our own shop rather than the first dealer you pass. " +
                "Cheaper labour, and the truck ends up where it needs to be.");
            order.Instructions.Add(
                "Show me the board where you are before you roll. If there is freight going that way I will put you on it — " +
                "a paying load home beats an empty one, and it costs nothing to look. If there is nothing, you deadhead in.");
            order.Instructions.AddRange(order.Quote.Lines);
            order.Instructions.Add("This counts as your home time. You are at the yard with the truck in the shop — that is home time, and the clock on the next one starts over from here.");
            order.Instructions.Add($"And it carries the same expectation as any home time: sit the {s.Settings.Hos.CycleRestartHours:0.#}-hour restart while you are there. " +
                                   "The truck is in pieces and you are not going anywhere, so take the reset — this is a repair and a restart, not a quick turn.");

            // Say it before they commit, not after.
            var st = HomeTime.Status(s);
            if (st.Tracked)
            {
                var totalDays = (driveHours.Value + order.Quote.WaitHours + s.Settings.Hos.CycleRestartHours) / 24.0;
                if (st.DaysUntilDue > 0 && totalDays > st.DaysUntilDue)
                    order.LateWarning =
                        $"Fair warning: the run plus the shop plus the restart is about {totalDays:0.#} days, and home time is due in " +
                        $"{st.DaysUntilDue:0.#}. You will be getting there late. That is the company's doing, not yours.";
            }
            return order;
        }

        order.Kind = "Shop";
        order.Headline = $"{what} — no more loads until it is fixed. Nearest shop on the road.";
        if (home != null && miles is { } mi)
            order.Instructions.Add(td >= runHomeCap || rd >= m.RunHomeMaxDamagePct
                ? $"{DispatchEngine.Place(home.City, home.State)} is {mi:N0} mi out, but past {runHomeCap:0.#}% I am not gambling another day's driving on it. Nearest shop."
                : $"{DispatchEngine.Place(home.City, home.State)} is {mi:N0} mi out — about {Hhmm.Of(driveHours ?? 0)}, which is more than a day. Too far. Nearest shop.");
        order.Instructions.AddRange(order.Quote.Lines);
        if (runHomeCap < m.RunHomeMaxDamagePct && td >= runHomeCap)
            order.Instructions.Add(ExplainTotalLossLine(s, truck) +
                $" That pulls the run-home line down to {runHomeCap:0.#}% with it — there is not much headroom left on this unit.");
        order.Instructions.Add("Raise a work order on the Maintenance tab when it is booked in, and close it out with what it actually cost.");
        return order;
    }

    public class WriteOffResult
    {
        public string Unit { get; set; } = "";
        public decimal InsurancePayout { get; set; }
        public decimal Deductible { get; set; }
        public decimal ScrapRecovery { get; set; }
        public decimal NetRecovery { get; set; }
        public bool DriverFault { get; set; }
        public string ReplacementSpec { get; set; } = "";
        public List<string> Instructions { get; set; } = new();
    }

    /// <summary>
    /// Writes a tractor off.
    ///
    /// Insurance settles against the unit's value less a deductible, and the deductible is heavier
    /// when the damage was the driver's doing — that is how insurance works, and it is the only place
    /// in the app where fault costs the company money directly. The scrap figure is whatever the
    /// player actually got for the wreck in their game; the app never guesses at it.
    /// </summary>
    public static WriteOffResult WriteOff(AppState s, string unit, bool driverFault,
        decimal scrapRecovery, string notes)
    {
        var truck = s.Trucks.FirstOrDefault(t => string.Equals(t.Unit, unit, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidOperationException($"No unit {unit} on the fleet.");
        if (truck.Status == "Retired")
            throw new InvalidOperationException($"Unit {unit} is already off the fleet.");

        var m = s.Settings.Maintenance;
        var r = new WriteOffResult { Unit = truck.Unit, DriverFault = driverFault, ScrapRecovery = Math.Max(0, scrapRecovery) };

        var value = truck.PurchasePrice > 0 ? truck.PurchasePrice : 0;
        r.InsurancePayout = Math.Round(value * (decimal)Math.Clamp(m.TotalLossPayoutFactor, 0, 1), 2);
        r.Deductible = driverFault ? m.TotalLossDeductible * 2 : m.TotalLossDeductible;
        if (r.Deductible > r.InsurancePayout) r.Deductible = r.InsurancePayout;
        r.NetRecovery = Math.Round(r.InsurancePayout - r.Deductible + r.ScrapRecovery, 2);

        truck.Status = "Retired";
        truck.DamagePct = 0;
        truck.AssignedDriver = "";

        // The seat is empty until the driver reports the replacement they bought.
        var wasMine = string.Equals(truck.Unit, s.Driver.AssignedTruckUnit, StringComparison.OrdinalIgnoreCase);
        if (wasMine)
        {
            s.Driver.AssignedTruckUnit = "";
            s.Status.TruckDamagePct = 0;
        }
        foreach (var d in s.HiredDrivers.Where(d => string.Equals(d.AssignedTruckUnit, truck.Unit, StringComparison.OrdinalIgnoreCase)))
            d.AssignedTruckUnit = "";

        if (r.InsurancePayout > 0)
            LedgerService.Post(s, LedgerService.Operating, r.InsurancePayout, "InsuranceRecovery",
                $"Insurance settlement on unit {truck.Unit} — total loss");
        if (r.Deductible > 0)
            LedgerService.Post(s, LedgerService.Operating, -r.Deductible, "InsuranceDeductible",
                driverFault
                    ? $"Deductible on unit {truck.Unit} — driver-fault, so the higher one applies"
                    : $"Deductible on unit {truck.Unit}");
        if (r.ScrapRecovery > 0)
            LedgerService.Post(s, LedgerService.Operating, r.ScrapRecovery, "ScrapRecovery",
                $"Scrap value reported on unit {truck.Unit}");

        r.ReplacementSpec = Seed.RecommendedTruck(s);

        var home = HomeTime.HomeTerminal(s);
        r.Instructions.Add($"Unit {truck.Unit} ({truck.Year} {truck.Make} {truck.Model}) is off the fleet as a total loss.");
        r.Instructions.Add(r.InsurancePayout > 0
            ? $"Insurance settled ${r.InsurancePayout:N2} against a ${r.Deductible:N2} deductible" +
              (driverFault ? " — the higher one, because the damage was down to the driver." : ".")
            : "No book value on file for that unit, so there is nothing for insurance to settle against.");
        if (r.ScrapRecovery > 0) r.Instructions.Add($"Scrap brought ${r.ScrapRecovery:N2}, which is booked as recovery.");
        else r.Instructions.Add("Sell the wreck for scrap in your game and report what it fetched — I will book it as recovery.");
        r.Instructions.Add($"Buy the replacement: {r.ReplacementSpec}");
        if (wasMine && home != null)
            r.Instructions.Add($"You start again out of {DispatchEngine.Place(home.City, home.State)} once the new unit is on the books. " +
                               "Add it on the Fleet tab and I will put you back in service.");
        if (!string.IsNullOrWhiteSpace(notes)) r.Instructions.Add(notes);

        s.Events.Insert(0, new LogEvent
        {
            Channel = "Maintenance",
            Message = $"Unit {truck.Unit} written off as a total loss. Net recovery ${r.NetRecovery:N2}.",
            Ref = truck.Unit,
            GameTime = s.Status.GameTime
        });

        return r;
    }
}
