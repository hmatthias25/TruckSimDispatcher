using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// A tractor wrecked past the point of repairing it.
///
/// The app already knew how to write a truck off and settle the insurance — what it never did was
/// <b>tell the driver it had happened</b>. The write-off line was only quoted if somebody went and asked
/// the shop for an estimate, which is not what anybody does after putting a truck in a ditch.
///
/// So it is recognised where the driver actually reports it: on the safety incident. Fault decides what
/// the deductible costs and what goes on the record; it has nothing to do with whether the truck is
/// repairable. A wreck is a wreck either way.
///
/// The awkward part is the load. A driver whose tractor is finished is usually still under freight, and
/// nothing in the app said what to do about that — so the steps lead with it.
/// </summary>
public static class TotalLoss
{
    /// <summary>Damage kinds that can write a tractor off. Anything else is not that sort of event.</summary>
    private static readonly string[] DamageKinds = { "Damage", "Accident", "Collision", "Rollover" };

    /// <summary>Whether an incident just reported has finished the tractor.</summary>
    public static bool WrecksTheTruck(AppState s, Incident inc, double damagePctNow)
    {
        if (!DamageKinds.Any(k => k.Equals(inc.Kind, StringComparison.OrdinalIgnoreCase))) return false;
        var truck = DispatchEngine.AssignedTruck(s);
        if (truck == null || truck.Status == "Retired") return false;
        return damagePctNow >= Shop.TotalLossPctFor(s, truck);
    }

    /// <summary>
    /// The pending write-off, when the driver is sitting on a wreck they have not dealt with yet.
    ///
    /// Read off the damage on file rather than a flag, so it clears itself the moment the truck is
    /// written off or replaced — there is no state here to get out of step with the fleet.
    /// </summary>
    public static Truck? Pending(AppState s)
    {
        var truck = DispatchEngine.AssignedTruck(s);
        if (truck == null || truck.Status == "Retired") return null;
        var line = Shop.TotalLossPctFor(s, truck);
        return truck.DamagePct >= line ? truck : null;
    }

    /// <summary>
    /// What the driver does now, in order.
    ///
    /// Ordered because the sequence matters and getting it wrong strands them: the load has to come off
    /// first, in the game and here, or the app keeps planning around freight that is going nowhere and
    /// the wreck cannot be sold with a trailer attached to it.
    /// </summary>
    public static List<string> Steps(AppState s, Truck truck)
    {
        var steps = new List<string>();
        var openTrip = s.Trips.FirstOrDefault(t => t.Status is "Authorized" or "InTransit");
        var line = Shop.TotalLossPctFor(s, truck);

        steps.Add($"Unit {truck.Ref} is at {truck.DamagePct:0.#}%, past the {line:0.#}% write-off line for a " +
                  $"{truck.Year} {truck.Make} {truck.Model} with {truck.ServiceMiles:N0} mi on it. That tractor is " +
                  "finished — it does not go through a shop.");

        if (openTrip != null)
            steps.Add($"First, the load. Cancel {openTrip.Number} in ATS, then cancel it here on the Active tab " +
                      "and put the fault to **Dispatcher** — you did not choose this and it is not a service " +
                      "failure. The company wears the penalty; your record does not.");
        else
            steps.Add("Nothing is under load, so there is no freight to deal with first.");

        steps.Add("Sell the wreck for scrap in ATS. Note what it fetched — that goes on the claim as recovery, " +
                  "and I will not guess at it.");

        // What the company has bought them, named. Being handed a spec and told to choose is not what
        // happens to a driver whose truck is wrecked.
        var order = EquipmentService.OpenOrder(s);
        steps.Add(order != null && order.MustPurchase
            ? $"{order.Number}: we have put an order in for your replacement — {Seed.RecommendedTruck(s)} " +
              "Go and pick it up in ATS and add it on the Fleet tab."
            : "Buy the replacement in ATS: " + Seed.RecommendedTruck(s));

        steps.Add($"Then write {truck.Ref} off on the Maintenance tab — fault, scrap value, and it settles the " +
                  "insurance. Once the new unit is on the books I will put you back in service.");

        return steps;
    }

    /// <summary>
    /// Raises the order for the replacement tractor, so the driver is told what the company has bought
    /// them rather than handed a spec and left to decide.
    ///
    /// A carrier does not tell a driver whose truck is wrecked to go and pick something out. It orders a
    /// unit, and the driver goes and gets it — which in this app means an equipment order with the spec
    /// on it, a number to close out, and the same MustPurchase shape used when the replacement does not
    /// exist on the property yet.
    ///
    /// Returns the order, or the one already open if this has been through once.
    /// </summary>
    public static EquipmentOrder? OrderReplacement(AppState s, Truck wrecked)
    {
        if (EquipmentService.OpenOrder(s) is { } existing) return existing;

        var home = HomeTime.HomeTerminal(s);
        var label = home != null ? $"{home.City}, {home.State}" : "your home yard";
        var spec = Seed.RecommendedTruck(s);

        return EquipmentService.IssuePurchasedUpgrade(s,
            $"Unit {wrecked.Ref} written off at {wrecked.DamagePct:0.#}%. Replacement ordered.",
            label, home?.Id ?? "", "anybody else", wrecked.Unit, spec);
    }

    /// <summary>One line for the dispatch blocker: nothing runs on a wrecked tractor.</summary>
    public static string? Blocker(AppState s)
    {
        var truck = Pending(s);
        if (truck == null) return null;

        var openTrip = s.Trips.FirstOrDefault(t => t.Status is "Authorized" or "InTransit");
        return $"Unit {truck.Ref} is a write-off at {truck.DamagePct:0.#}%. No freight until it is off the fleet " +
               "and you are in something else" +
               (openTrip != null
                   ? $" — and {openTrip.Number} needs cancelling first, in the game and here, against dispatch."
                   : ". See the steps on the Maintenance tab.");
    }
}
