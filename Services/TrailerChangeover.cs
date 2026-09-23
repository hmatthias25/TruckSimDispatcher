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

        // EVERY box on the yard the driver could legally pull, not just the ones covering the type the
        // freight-mix roll asked for.
        //
        // Narrowing to the wanted type was wrong, and wrong in the way that matters: reported from play
        // as five trailers on the yard and one question asked. The point of asking is to find out what is
        // actually available, and "operations wants you on flatbed" is a preference, not a constraint —
        // if the only flatbed is three days out and a reefer is sitting there doing nothing, the reefer
        // is the better answer and the freight mix moves with it. That was the player's own example.
        //
        // DH-1 is still excluded. It is not standing on a yard and it is never in use, so it would take
        // the idle preference every single time.
        return s.Trailers
            .Where(t => !t.Retired && !DropHook.Is(t.Type))
            .Where(t => !t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase))
            .Where(t => t.HomeTerminalId.Equals(yard.Id, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    /// <summary>
    /// The ones operations could actually put this driver on.
    ///
    /// Asking is not the same as choosing, and they are filtered at different points on purpose. A
    /// position is cheap to give and useful to have whatever the box is, so the driver is asked about
    /// every trailer on the yard. Being PUT on one they are restricted from, or said they would not haul,
    /// is a different matter and does not happen.
    /// </summary>
    private static List<Trailer> Assignable(AppState s, IEnumerable<Trailer> boxes) =>
        boxes.Where(t => HomeTime.Qualified(s, t.Type)).ToList();

    /// <remarks>
    /// <b>Retired: there used to be an AskAtDrop here.</b>
    ///
    /// <para>It answered yes from three quarters of the way through the interval — day ten and a half of
    /// a fortnight — so a driver with two or three loads still to run got the questions, and a forecast
    /// built on the answers, about a home time that had not been planned yet. Reported from play: "having
    /// a heads up show with bad info a day out on my tour is not realistic and wrong."</para>
    ///
    /// <para>There is no drop-side ask any more. The questions belong to the moment dispatch actually
    /// sends the driver home — a load that finishes at the yard, or an order to run it in empty — and
    /// that is the only place <see cref="AskRows"/> is called from now. Kept as a comment rather than a
    /// method because the reasoning is the useful part: the trigger being early was not a tuning
    /// problem, it was asking a question before the thing it is about had been decided.</para>
    /// </remarks>

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

        // Ask about everything; choose from what they can legally pull.
        var pickFrom = Assignable(s, cands);
        if (pickFrom.Count == 0)
            return new Plan
            {
                Type = want,
                Note = $"Operations wants you on {want.ToLowerInvariant()} next tour and there is nothing " +
                       "standing at your yard you are cleared to pull, so they will be sourcing one. " +
                       "Expect a wait when you get in.",
            };

        var scored = pickFrom
            .Select(t => new { T = t, E = Whereabouts.Assess(s, t) })
            .Select(x => new
            {
                x.T,
                x.E,
                Idle = x.E.Known && x.E.Direction.Equals("Parked", StringComparison.OrdinalIgnoreCase),
                Wanted = EquipmentService.TypeCovers(x.T.Type, want),

                // What the wait ACTUALLY costs, against the days the driver is taking.
                //
                // Marking a box as private in ATS makes the AI driver on it finish their load and switch
                // off it. So a trailer three days out is standing on the yard before somebody taking five
                // days is ready to leave — it costs them nothing at all. The same box is a real price to a
                // driver home for two over a 34.
                //
                // With no answer on the board the days count in full, because the app does not guess at
                // how long somebody is staying.
                CostDays = Math.Max(0, (x.E.Days ?? 99)
                                       - (s.Driver.HomeDaysPlanned > 0 ? s.Driver.HomeDaysPlanned : 0)),
            })
            // Sitting still beats being the right kind of trailer. A box nobody is on is a hook and a
            // pull; the one operations asked for, three days out, costs days off the home time to fetch.
            // Within each group the wanted type still wins, so the freight mix is honoured wherever it
            // can be had for nothing.
            // What it costs comes first, and a box that is back before the driver leaves costs nothing —
            // so on a long home time a trailer three days out ranks level with one already parked. Where
            // two are equally free the type operations asked for wins, which is the whole point of having
            // asked. Only then does the raw distance break a tie.
            .OrderBy(x => x.CostDays)
            .ThenByDescending(x => x.Wanted)
            .ThenByDescending(x => x.Idle)
            .ThenBy(x => x.E.Days ?? 99)
            .ToList();

        var best = scored[0];

        // Nothing on file for any of them. Do NOT pick one — a box whose position nobody has reported is
        // a box we know nothing about, and naming it anyway is how a driver was promised a trailer the
        // app called parked while it sat in Grand Junction, a thousand miles from the yard.
        //
        // Ask instead. The positions are the decision, not decoration on one already made.
        if (!scored.Any(x => x.E.Known))
            return new Plan
            {
                Type = want,
                Note = $"Operations wants you on {want.ToLowerInvariant()} for the tour after this home time, " +
                       $"and we have {cands.Count} on the yard I could put you on — but I have nothing " +
                       "current on where any of them are, and I am not promising you one I cannot vouch " +
                       "for. Have a look at the trailer screen and tell me, and I will name the box.",
            };

        var plan = new Plan
        {
            Type = want,
            Trailer = best.T,
            Idle = best.Idle,
            WaitDays = best.E.Days,

            // Reserving is what MAKES a box free, not just a nicety once it already is. Marking one
            // private tells the AI driver to finish their load and drop it, so any trailer whose wait
            // lands inside the home time wants the same instruction as a parked one.
            Reserve = best.Idle || best.CostDays <= 0,
        };

        // Where the box that won is not the kind operations asked for, say so — the freight they put the
        // driver on next moves with the trailer, and that is not a detail to discover from the board.
        var head = best.Wanted
            ? $"Operations wants you on {want.ToLowerInvariant()} for the tour after this home time, so " +
              $"you are changing trailers when you get in — onto {best.T.Ref}. "
            : $"Operations wanted you on {want.ToLowerInvariant()} next tour, but the best box we have " +
              $"standing at the yard is {best.T.Ref} — " +
              $"{TrailerSpec.Describe(best.T.Type, best.T.Subtype).ToLowerInvariant()}. You are going on " +
              "that and the freight follows it, rather than losing days fetching the other. ";

        if (best.Idle)
            plan.Note = head +
                "It is parked and nobody is on it, so that is a straight hook and it costs you nothing. " +
                $"Do one thing for me before you pull out: mark {best.T.Ref} as your own trailer in the ATS " +
                "trailer manager. That reserves it — otherwise one of the hired drivers has it before you are " +
                "back and we are into skipping days to get it off them.";
        else if (best.E.Known && best.E.Days is { } d)
            plan.Note = head + best.E.Text +
                // A wait that finishes inside the home time is not a wait. Mark it private now and the
                // driver on it finishes their load and drops it; it is standing on the yard before this
                // driver is ready to leave. That is the mechanic, and it is why the days are worth asking
                // about — a box three days out is free to somebody taking five and dear to somebody
                // taking two.
                (best.CostDays <= 0 && s.Driver.HomeDaysPlanned > 0
                    ? $" You are home {s.Driver.HomeDaysPlanned} day(s) and it is {d:0.#} out, so it costs " +
                      $"you nothing — mark {best.T.Ref} as your own in the ATS trailer manager before you " +
                      "pull out, and whoever has it will finish their load, drop it, and leave it standing " +
                      "for you."
                    : best.CostDays <= Whereabouts.WorthWaitingDays
                        ? $" Reckon on about {best.CostDays:0.#} day(s) of it landing past the end of your " +
                          "home time. Those come out of your days off, not your hours."
                        : $" That is about {best.CostDays:0.#} day(s) past the end of your home time, which " +
                          "is a real price. Ask me for something else if it is not worth it.");
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
        // Nothing decided at all: clear the lot, note included.
        if (plan == null) { Forget(s); return; }

        // Decided, but there is no box to name — drop and hook, or a change with nothing on the yard to
        // make it with. Still worth keeping the words: it is what the driver was told, and the Home time
        // panel shows what they were told rather than working it out again on the way to the screen.
        s.Driver.ChangeoverNote = plan.Note ?? "";

        if (plan.Trailer == null)
        {
            s.Driver.ChangeoverUnit = "";
            s.Driver.ChangeoverReserve = false;
            s.Driver.ChangeoverWaitDays = null;
            return;
        }

        s.Driver.ChangeoverUnit = plan.Trailer.Unit;
        // The type of the box actually chosen, which since the choice can cross types is not always the
        // one the freight-mix roll asked for. Storing the wanted type meant the order raised on arrival
        // went looking for a flatbed while the driver had been promised a reefer.
        s.Driver.ChangeoverType = plan.Trailer.Type;
        s.Driver.ChangeoverReserve = plan.Reserve;
        s.Driver.ChangeoverGameTime = s.Status.GameTime;
        // Read by the arrival brief to work out when to be back on the truck.
        s.Driver.ChangeoverWaitDays = plan.Idle ? 0 : plan.WaitDays;
    }

    /// <summary>Clear the promise once it has been kept, or once it can no longer be.</summary>
    public static void Forget(AppState s)
    {
        s.Driver.ChangeoverUnit = "";
        s.Driver.ChangeoverType = "";
        s.Driver.ChangeoverReserve = false;
        s.Driver.ChangeoverGameTime = "";
        s.Driver.ChangeoverNote = "";
        s.Driver.ChangeoverWaitDays = null;
    }

    /// <summary>
    /// The box the driver was promised, if it is still a sensible thing to hand them.
    ///
    /// Checked rather than trusted: a promise made a fortnight ago is about a trailer that may since have
    /// been retired, sold, or hooked to the driver already.
    /// </summary>
    public static Trailer? Promised(AppState s)
    {
        if (string.IsNullOrWhiteSpace(s.Driver.ChangeoverUnit)) return null;

        var t = s.Trailers.FirstOrDefault(x =>
            x.Unit.Equals(s.Driver.ChangeoverUnit, StringComparison.OrdinalIgnoreCase));

        if (t == null || t.Retired) return null;
        if (t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase)) return null;

        // No type check. The promise is a specific unit, chosen deliberately and sometimes ACROSS types —
        // an idle reefer taken over a flatbed three days out. Checking it against the rolled type threw
        // exactly those picks away and handed the driver something else, which is the broken promise this
        // whole mechanism exists to prevent.
        return t;
    }
}
