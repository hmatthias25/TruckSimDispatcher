using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// A trailer change worked out at the <b>last drop before the run home</b>, rather than sprung on the
/// driver once they have parked.
///
/// <para>
/// The old shape did all of this at the yard. The driver reported in, was told whether they were being
/// re-rigged, and only then — standing on the property with nothing left to decide — was asked where the
/// company trailers were. Reported from play in one go: told on arrival that nothing was changing, asked to
/// record trailer positions anyway, and then shown a notice saying a change was coming and quoting a trailer
/// three days out. It read as nonsense because it was: the change being described was the home time AFTER
/// this one, a fortnight away, and the position it was costed against had been typed in seconds earlier and
/// would be meaningless long before it mattered.
/// </para>
///
/// <para>
/// Every piece of that arrives too late to act on. So the whole conversation moves to the drop that ends the
/// tour — the point where the driver is about to run home empty and there is still time for the answer to
/// change what they do. They are asked about the home yard trailers <b>from wherever they are standing</b>,
/// the box is picked there, and the wait is quoted against the home time they are actually driving to.
/// </para>
///
/// <para><b>Idle trailers first.</b> A box nobody is on costs nothing to take: no days out, no time skip, no
/// home time spent waiting. One out under a hired driver costs whatever ATS decides to skip when the player
/// accepts it. Given the choice the company takes the free one — and then tells the driver to mark it as
/// their own in the ATS trailer manager, which is the only way to stop an AI driver hooking it during the
/// fortnight before they get back.</para>
///
/// <para><b>Drop and hook is not a box.</b> DH-1 is a slot, not a trailer standing on a yard. It has no
/// position to report, no wait to forecast, and nothing to reserve — the trailer is the shipper's. So a
/// changeover onto drop and hook skips this flow entirely, and DH is never a candidate when looking for
/// somewhere to move a driver: it is picked by its own roll in <see cref="HomeTime.ReassignmentTypeFor"/>
/// and must never win on being idle, because it is idle by definition and would then win every time.</para>
/// </summary>
public static class TrailerChangeover
{
    /// <summary>
    /// The trailer type the driver is being moved onto at the home time they are <b>currently running
    /// toward</b>, or null for no change.
    ///
    /// <para>The same seeded answer <see cref="HomeTime.ConsiderTrailerReassignment"/> will issue on
    /// arrival — <c>HomeTimesTaken + 1</c> here because <see cref="HomeTime.Touch"/> has not ticked the
    /// counter yet. Two different answers would be worse than saying nothing at all.</para>
    ///
    /// <para>The exemptions are applied here as well as there. They used to live only in the issuing, so a
    /// dedicated driver, or one pulling a trailer they had asked for, was told on the way in that they were
    /// changing trailers and then arrived to find nothing happening.</para>
    /// </summary>
    public static string? ComingType(AppState s)
    {
        if (Dedicated.Active(s)) return null;
        if (s.Driver.TrailerByRequest) return null;

        // A swap already on the books stops the next one being announced, the same way it stops the next
        // one being issued — <see cref="EquipmentService.IssueTrailerReassignment"/> refuses while one is
        // open. Without this the app talks about a change it will then decline to make: a driver who has
        // not got round to hooking the last box gets told about the next one, goes home, and nothing
        // happens, which is the complaint this whole issue started from.
        if (s.EquipmentOrders.Any(o => o.Status == "Open" && o.Kind == "TrailerSwap")) return null;

        return HomeTime.ReassignmentTypeFor(s, s.Driver.HomeTimesTaken + 1);
    }

    /// <summary>
    /// Boxes at the home yard the change could land on, whether or not we know where they are.
    ///
    /// Narrowed to the type the driver is being moved <b>onto</b>. Asking a driver standing at a receiver in
    /// Miami OK to account for every trailer on the Springfield yard is the noise
    /// <see cref="Whereabouts.WorthAsking"/> was written to stop; the only positions that change anything
    /// here are the ones this change could actually be made with.
    /// </summary>
    public static List<Trailer> Candidates(AppState s, string wantedType)
    {
        var yard = HomeTime.HomeTerminal(s);
        if (yard == null || string.IsNullOrWhiteSpace(wantedType)) return new List<Trailer>();

        // DH-1 excluded before anything else. It is not standing on a yard and it is never in use, so it
        // would take the idle preference every time it happened to cover the wanted type.
        return s.Trailers
            .Where(t => !t.Retired && !DropHook.Is(t.Type))
            .Where(t => !t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase))
            .Where(t => t.HomeTerminalId.Equals(yard.Id, StringComparison.OrdinalIgnoreCase))
            .Where(t => EquipmentService.TypeCovers(t.Type, wantedType))
            .ToList();
    }

    /// <summary>
    /// Whether to put the position questions in front of the driver at this drop.
    ///
    /// Only on the way in. A change decided at a drop three weeks out is a forecast, and any position given
    /// for it would be stale long before it was used.
    /// </summary>
    public static bool AskAtDrop(AppState s)
    {
        var st = HomeTime.Status(s);
        if (!st.Tracked || !(st.DueSoon || st.Overdue)) return false;
        if (st.AtYard) return false;                  // already there; the home brief has this

        var want = ComingType(s);
        if (want == null) return false;
        if (DropHook.Is(want)) return false;          // no box, no position, nothing to ask

        return Candidates(s, want).Count > 0;
    }

    /// <summary>The rows to ask about, in the shape the whereabouts form already renders.</summary>
    public static List<object> AskRows(AppState s)
    {
        var want = ComingType(s);
        if (want == null || DropHook.Is(want)) return new List<object>();

        return Candidates(s, want)
            .Select(t => (object)new
            {
                unit = t.Unit,
                trailer = t.Ref,
                trailerType = t.Type,
                current = t.Whereabouts,
                city = t.WhereaboutsCity,
                state = t.WhereaboutsState,
                known = Whereabouts.Assess(s, t).Text,
            })
            .ToList();
    }

    /// <summary>What the company settled on, once the driver has said what they can see.</summary>
    public class Plan
    {
        /// <summary>The type they are being moved onto.</summary>
        public string Type { get; set; } = "";
        /// <summary>The box, where one was found at the home yard.</summary>
        public Trailer? Trailer { get; set; }
        /// <summary>Nobody is on it — a straight hook, and worth reserving.</summary>
        public bool Idle { get; set; }
        /// <summary>Days ATS is likely to skip to hand it over. Null where nothing is known.</summary>
        public double? WaitDays { get; set; }
        /// <summary>Tell the driver to mark it as their own, so no AI driver takes it meanwhile.</summary>
        public bool Reserve { get; set; }
        /// <summary>What to say, at the drop and again on the way in.</summary>
        public string Note { get; set; } = "";
    }

    /// <summary>
    /// Pick the box and work out what it costs.
    ///
    /// <b>Idle beats near.</b> A parked trailer is a hook and a pull; anything under a hired driver costs
    /// days out of the home time it is taken during. Between two that are out, the shorter wait wins — and a
    /// box nobody has reported on is treated as an unknown rather than as free, because the app does not
    /// invent a reading the game never gave.
    /// </summary>
    public static Plan? Decide(AppState s)
    {
        var want = ComingType(s);
        if (want == null) return null;

        // Drop and hook: no yard, no box, no wait. Said plainly rather than run through machinery that
        // would ask the driver where a slot is parked.
        if (DropHook.Is(want))
            return new Plan
            {
                Type = want,
                Note = "Next tour is drop and hook — Freight Market jobs, the shipper trailer, dropped at the " +
                       "other end. There is no box to go and find and nothing to wait on: you will drop what " +
                       "you are pulling at the yard and work off the Freight Market from there.",
            };

        var cands = Candidates(s, want);
        if (cands.Count == 0)
            return new Plan
            {
                Type = want,
                Note = $"Operations wants you on {want.ToLowerInvariant()} next tour and we do not have one " +
                       "sitting at your yard, so they will be sourcing it. Expect a wait when you get in — " +
                       "take your days first rather than sitting on top of it.",
            };

        var scored = cands
            .Select(t => new { T = t, E = Whereabouts.Assess(s, t) })
            .Select(x => new
            {
                x.T,
                x.E,
                Idle = x.E.Known && x.E.Direction.Equals("Parked", StringComparison.OrdinalIgnoreCase),
            })
            .OrderByDescending(x => x.Idle)
            .ThenBy(x => x.E.Days ?? 99)
            .ToList();

        var best = scored[0];
        var plan = new Plan
        {
            Type = want,
            Trailer = best.T,
            Idle = best.Idle,
            WaitDays = best.E.Days,
            Reserve = best.Idle,
        };

        var head = $"Operations wants you on {want.ToLowerInvariant()} for the tour after this home time, so " +
                   $"you are changing trailers when you get in — onto {best.T.Ref}. ";

        if (best.Idle)
            plan.Note = head +
                "It is parked and nobody is on it, so that is a straight hook and it costs you nothing. " +
                $"Do one thing for me before you pull out: mark {best.T.Ref} as your own trailer in the ATS " +
                "trailer manager. That reserves it — otherwise one of the hired drivers has it before you are " +
                "back and we are into skipping days to get it off them.";
        else if (best.E.Known && best.E.Days is { } d)
            plan.Note = head + best.E.Text +
                (d <= Whereabouts.WorthWaitingDays
                    ? $" Reckon on about {d:0.#} day(s) skipped when you take it. Those come out of your home " +
                      "time, not your hours."
                    : $" That is about {d:0.#} day(s) skipped when you take it, which is most of your home " +
                      "time. Ask me for something else if it is not worth it.");
        else
            plan.Note = head +
                "I have nothing current on where it is. Have a look at the trailer screen and tell me, and I " +
                "can say whether that is a straight hook or days off your home time.";

        return plan;
    }

    /// <summary>
    /// Record the decision against the driver, so the order raised on arrival lands on the box they were
    /// told about a tour earlier. Promising DV-3 and issuing DV-7 is worse than not promising.
    /// </summary>
    public static void Remember(AppState s, Plan? plan)
    {
        if (plan?.Trailer == null)
        {
            s.Driver.ChangeoverUnit = "";
            s.Driver.ChangeoverReserve = false;
            return;
        }

        s.Driver.ChangeoverUnit = plan.Trailer.Unit;
        s.Driver.ChangeoverType = plan.Type;
        s.Driver.ChangeoverReserve = plan.Reserve;
        s.Driver.ChangeoverGameTime = s.Status.GameTime;
    }

    /// <summary>Clear the promise once it has been kept, or once it can no longer be.</summary>
    public static void Forget(AppState s)
    {
        s.Driver.ChangeoverUnit = "";
        s.Driver.ChangeoverType = "";
        s.Driver.ChangeoverReserve = false;
        s.Driver.ChangeoverGameTime = "";
    }

    /// <summary>
    /// The box the driver was promised, if it is still a sensible thing to hand them.
    ///
    /// Checked rather than trusted: a promise made a fortnight ago is about a trailer that may since have
    /// been retired, sold, or hooked to the driver already.
    /// </summary>
    public static Trailer? Promised(AppState s, string wantedType)
    {
        if (string.IsNullOrWhiteSpace(s.Driver.ChangeoverUnit)) return null;

        var t = s.Trailers.FirstOrDefault(x =>
            x.Unit.Equals(s.Driver.ChangeoverUnit, StringComparison.OrdinalIgnoreCase));

        if (t == null || t.Retired) return null;
        if (t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase)) return null;
        return EquipmentService.TypeCovers(t.Type, wantedType) ? t : null;
    }
}
