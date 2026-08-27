using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Brings career files written by older builds up to the current shape. Runs on every load and is
/// deliberately additive — it fills in what is missing and never discards or rewrites real history.
/// </summary>
public static class Migrations
{
    public static void Apply(AppState s)
    {
        // Nothing to bring forward in a file with no career in it, and nothing that could be damaged
        // by leaving it alone: the version only matters once there is history behind it.
        if (!s.Onboarded)
        {
            s.SchemaVersion = AppState.Current;
            return;
        }

        RebaseGameCalendar(s);
        MatchGameDayNumbering(s);
        ClearSafetyRecordWrittenUnderOldRules(s);
        UndoProbationClearedWithoutTheReviews(s);
        DropEndorsementsThatAreNotReal(s);
        ClearTrailerDecisionsLeftToTheDriver(s);
        GiveRunningLoadsAnAppointment(s);
        ClearLateMarksFromUnreachableSlots(s);
        WipeLateIncidents(s);
        RebookSlotsThatEatTheClock(s);
        MeasureDeliveryFromArrivalNotRelease(s);
        GiveTripEventsIds(s);
        KeyDockTimesToTheTrailerPulled(s);
        MoveWhereaboutsOntoTheTrailer(s);
        BackfillTrailerTenure(s);
        SettlementsAlreadyBankedAreNotNews(s);
        EnsureDropHookIsOnOffer(s);
        EnsureTerminals(s);
        EnsureEquipmentTerminalIds(s);
        EnsureAssignedEquipmentIsInGarage(s);
        EnsureAccounts(s);
        CollapseReservesIntoOneCashAccount(s);
        EnsureDiscoveredCities(s);
        EnsureTripFuelStops(s);
        EnsureHomeTimeArrangement(s);
        ClearPhantomBankBalance(s);
        EnsureEquipmentStandard(s);
        EnsureCarrierNetwork(s);
        EnsureEndorsements(s);
        EnsureAtHomeFlag(s);
        FlagImplausibleWindows(s);
        EnsureCarrierStanding(s);
        EnsureFleetStars(s);
    }

    /// <summary>
    /// Clears the safety record, once, because it was written under rules that were wrong.
    ///
    /// Every late delivery used to file an incident — non-preventable ones included — and each one
    /// restarted the clean-work counter, so a driver could never work anything off. On top of that a
    /// single late load could reach a written warning, and some of those loads were only late because of
    /// bugs since fixed. The result is a record that describes the app's mistakes rather than the
    /// driver's, and there is nothing in it worth keeping.
    ///
    /// So: incidents, discipline and the late flags on delivered trips all go. The driver starts clean,
    /// and the next thing that genuinely is their fault starts at coaching. Trips keep everything else —
    /// pay, miles, times, settlements — because none of that was wrong.
    /// </summary>
    /// <summary>
    /// Puts back probation that was cleared without the three good reviews.
    ///
    /// The Career tab used to offer a button the moment the loads/miles/on-time thresholds were met,
    /// without counting the reviews at all — so a driver could be moved onto the Company Driver scale
    /// having never sat three good reviews in a row. The reviews are half the requirement.
    ///
    /// Deliberately narrow. It only touches a driver sitting at <b>exactly</b> the rank that button
    /// granted: anybody who has since been promoted on merit to senior or above is left alone, because
    /// by then the record speaks for itself and demoting them would do more damage than the original
    /// mistake. Anyone legitimately cleared still has their three passes on file and is untouched.
    /// </summary>
    /// <summary>
    /// Clears out "Tanker" and "Doubles/Triples", which were never endorsements.
    ///
    /// A tanker is a trailer and what gates it is what is inside — a fuel tanker is class 3, a gas
    /// tanker class 2, a food-grade tanker nothing at all. Doubles and triples are a trailer
    /// configuration available in particular states, not something on a licence. Both were written onto
    /// driver files anyway, and carriers were refusing applications over one of them.
    ///
    /// Real hazmat classes are left exactly as they are.
    /// </summary>
    /// <summary>
    /// Clears trailer replacement notes that asked the driver to make the decision.
    ///
    /// They read "replace with the same one, or re-rig for whatever the lane is actually offering — buy
    /// it in ATS and confirm it here", which is a fleet decision handed to a company driver as homework.
    /// Operations decides now, names the replacement type off utilisation across the fleet, and raises a
    /// numbered order for it.
    ///
    /// The stale notes are removed rather than rewritten: the replacement type has to be worked out from
    /// current utilisation, and inventing one here would be guessing at figures the next fleet report is
    /// about to read properly.
    /// </summary>
    /// <summary>
    /// Gives loads already on the road a booked slot.
    ///
    /// The plan used to target the moment the doors unlocked; it targets an appointment now, and a trip
    /// dispatched before that existed has no slot on it. Left empty, those loads would be judged against
    /// the window close alone while every load after them answered to a slot — the same job graded two
    /// different ways depending on when it happened to be dispatched.
    ///
    /// Only trips still running are touched. A delivered trip is a record of what happened and inventing
    /// an appointment for it afterwards would be rewriting history to match a rule it never ran under.
    /// The receiver-takes-early flag is deliberately NOT rolled retrospectively: that is a promise made
    /// at dispatch, and this driver was never given it.
    /// </summary>
    /// <summary>
    /// Takes back Late marks that only happened because the app booked a slot the driver could not reach.
    ///
    /// The appointment rule shipped with a real flaw: the slot was placed in the front half of the
    /// window without asking whether the run could physically get there. A driver who followed the plan
    /// they were given — overnight at the shipper, arrive on the window — could deliver inside the window
    /// and still be marked late against an appointment that was never achievable.
    ///
    /// Anything delivered inside its window and failed only by that comparison is put back to OnTime,
    /// because the driver did nothing wrong. A load genuinely delivered past its deadline is left exactly
    /// as it is — that one is real and clearing it would be falsifying the record in the other direction.
    /// </summary>
    /// <summary>
    /// Drops a late note and any discipline hanging off it. Returns how many notes went.
    /// </summary>
    private static int RemoveLateNotes(AppState s, Func<Incident, bool> match)
    {
        var doomed = s.Incidents.Where(i => i.Kind == "Late" && match(i)).ToList();
        if (doomed.Count == 0) return 0;

        var numbers = doomed.Select(i => i.Number).Where(x => !string.IsNullOrWhiteSpace(x))
                            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        s.Discipline.RemoveAll(d => numbers.Contains(d.IncidentNumber ?? ""));
        foreach (var i in doomed) s.Incidents.Remove(i);
        return doomed.Count;
    }

    /// <summary>
    /// Clears every late note off the safety file, once.
    ///
    /// The targeted reversal above shipped with a predicate that matched nothing, so the notes from the
    /// unreachable-slot bug survived on careers that had already migrated — and a migration only runs
    /// once, so fixing the predicate could not reach them. This is the blunt instrument that can, done
    /// at the player's explicit request rather than on our own initiative.
    ///
    /// Service history is NOT touched. On-time percentage is computed from each trip's ServiceResult,
    /// not from these notes, so a genuinely late delivery still reads as late where it counts. What goes
    /// is the safety-file paperwork and any discipline issued off it.
    /// </summary>
    /// <summary>
    /// Re-books delivery slots on loads already out that cannot be worked on the hours available.
    ///
    /// The slot used to be placed against the window alone, never the clock. On an eight in the morning
    /// start an eight in the evening slot leaves two of the fourteen hours by the time the doors open —
    /// and loading, the drive and the sitting all came out of that same window first. The driver waits
    /// all day and then runs out at the dock.
    ///
    /// New loads get a slot that fits. These are the ones already accepted or rolling, which would
    /// otherwise carry the old booking all the way to the receiver.
    /// </summary>
    private static void RebookSlotsThatEatTheClock(AppState s)
    {
        if (s.SchemaVersion >= 10) return;
        s.SchemaVersion = 10;

        if (GameClock.TryParse(s.Status.GameTime) is not { } now) return;

        var moved = 0;
        foreach (var t in s.Trips.Where(x => x.Status is "Authorized" or "InTransit"))
        {
            if (GameClock.TryParse(t.AppointmentGameTime) is not { } slot) continue;
            if (GameClock.TryParse(t.AppointmentOpensGameTime) is not { } opens) continue;

            var dock = t.UnloadingHours > 0
                ? t.UnloadingHours
                : FacilityLearning.For(s, t.TrailerType).Unloading;
            var room = s.Hos.ShiftRemaining - dock - s.Settings.ParkingBufferHours;
            if (room <= 0) continue;

            var latest = DeliveryWindow.PrevHalfHour(now.AddHours(room));
            if (slot <= latest) continue;         // already workable on the hours in hand
            if (latest <= opens) continue;        // nothing in the window fits today; the rest handles it

            t.AppointmentGameTime = GameClock.Format(latest);
            moved++;
        }

        if (moved == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "dispatch",
            GameTime = s.Status.GameTime,
            Message = $"Moved the delivery slot on {moved} load(s) already out. They had been booked against " +
                      "the delivery window without checking the hours left in the day, so waiting for the " +
                      "appointment and then unloading would have run the clock out. Check the Active tab for " +
                      "the new time.",
        });
    }

    /// <summary>
    /// Puts delivery times back to the arrival, and takes back the Late marks that came of not doing so.
    ///
    /// <c>DeliveredGameTime</c> has always meant arrival — it is what the appointment is judged against
    /// and what dock time is measured from. But the close-out form prefills it with the clock as it
    /// stands, and for anybody who logs Begin and End unload that is the clock <b>after</b> the unload.
    /// Two hours on a dock then read as two hours of lateness: the receiver's time charged to the driver,
    /// who was there on time and could not make the dock go any faster.
    ///
    /// So any delivered load carrying a <c>BeginUnload</c> stamp earlier than its recorded delivery time
    /// has that time moved back to the stamp, and its service result judged again — by
    /// <see cref="TripService.LateByTheClock"/>, the same rule the live path runs, because a second copy
    /// of the appointment comparison would drift and the one nobody looks at would be the one rewriting
    /// history.
    ///
    /// A load that is still late on the corrected time stays late. That one is real, and clearing it
    /// would be falsifying the record in the other direction.
    /// </summary>
    private static void MeasureDeliveryFromArrivalNotRelease(AppState s)
    {
        if (s.SchemaVersion >= 11) return;
        s.SchemaVersion = 11;

        var moved = 0;
        var cleared = new List<string>();

        foreach (var t in s.Trips.Where(x => x.Status == "Delivered" && x.Kind == "Freight"))
        {
            var arrival = TripService.ArrivalFromLog(t, t.DeliveredGameTime, out _);
            if (string.Equals(arrival, t.DeliveredGameTime, StringComparison.Ordinal)) continue;

            t.DeliveredGameTime = arrival;
            moved++;

            if (t.ServiceResult != "Late") continue;
            if (TripService.LateByTheClock(s, t, out _) is not false) continue;

            t.ServiceResult = "OnTime";
            cleared.Add(t.Number);
        }

        if (moved == 0) return;

        var numbers = cleared.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var notes = numbers.Count == 0 ? 0
            : RemoveLateNotes(s, i => numbers.Contains(i.TripNumber ?? ""));

        s.Events.Insert(0, new LogEvent
        {
            Channel = "dispatch",
            GameTime = s.Status.GameTime,
            Message =
                $"Corrected the delivery time on {moved} closed load(s). They had been recorded at the time " +
                "the close-out was filed rather than the time you got to the receiver, so however long the " +
                "dock took was being counted as lateness. Arrival now comes off your Begin unload log." +
                (cleared.Count == 0
                    ? " No service results changed."
                    : $" {cleared.Count} of them go back to on time: {string.Join(", ", cleared)}." +
                      (notes > 0 ? $" {notes} late note(s) off the safety file with them." : "")),
        });
    }

    /// <summary>
    /// Gives every logged event an id, so a mistyped stamp can be addressed and corrected.
    ///
    /// Not version-gated. Ids are generated per object, so an event written by an older build has one
    /// already the moment it deserialises — but a career part-migrated by a build between the two could
    /// hold duplicates, and a duplicate id would let a correction land on the wrong event. Cheap to
    /// check, and it has to be right every load rather than once.
    /// </summary>
    private static void GiveTripEventsIds(AppState s)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in s.Trips)
            foreach (var e in t.Events)
                if (string.IsNullOrWhiteSpace(e.Id) || !seen.Add(e.Id))
                {
                    e.Id = Guid.NewGuid().ToString("N")[..8];
                    seen.Add(e.Id);
                }
    }

    /// <summary>
    /// Puts every trip's trailer type back to the trailer that was actually pulled, and rebuilds the
    /// dock averages off the corrected history.
    ///
    /// A trip used to record the trailer the JOB asked for. Since this app only ever runs cargo-market
    /// loads — the driver's own trailer, every time — that was a category off a job screen standing in
    /// for the thing being loaded. A listing read as "Lowboy" trained the Lowboy average while a flatbed
    /// was on the back of the truck, and careers grew learned figures for trailers they had never pulled.
    ///
    /// <see cref="Trip.TrailerUnit"/> has always recorded which trailer went out, so the history is
    /// recoverable. Rebuilding afterwards is the point of doing it here: the rebuild reads
    /// <c>Trip.TrailerType</c>, so re-keying without it would faithfully reconstruct the same wrong rows.
    /// </summary>
    /// <summary>
    /// v13 — where a trailer is stops being a fact about the driver pulling it.
    ///
    /// It was filed on <c>HiredDriver.TrailerWhereabouts</c> and keyed by <c>AssignedTrailerUnit</c>, on
    /// the assumption that a driver stays on the box the app has them down for. AI drivers in ATS change
    /// trailers whenever the game feels like it and never tell anybody, so the app asked where somebody
    /// was with DV-3 long after they had moved off it and filed the answer against the wrong trailer.
    ///
    /// What the player told us is still worth having — it was a real observation about a real trailer at
    /// the time it was made. It moves onto whichever trailer the driver was down for, and the timestamp
    /// comes with it so the staleness rule can decide on its own whether it is still worth anything.
    /// </summary>
    private static void MoveWhereaboutsOntoTheTrailer(AppState s)
    {
        if (s.SchemaVersion >= 13) return;

#pragma warning disable CS0618
        foreach (var d in s.HiredDrivers)
        {
            if (string.IsNullOrWhiteSpace(d.TrailerWhereabouts)) continue;
            if (string.IsNullOrWhiteSpace(d.AssignedTrailerUnit)) continue;

            var box = s.Trailers.FirstOrDefault(t =>
                t.Unit.Equals(d.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase));
            if (box == null) continue;

            // Do not overwrite something already answered against the trailer itself — that answer was
            // given about the right thing and this one only might have been.
            if (!string.IsNullOrWhiteSpace(box.Whereabouts)) continue;

            box.Whereabouts = Whereabouts.Normalise(d.TrailerWhereabouts);
            box.WhereaboutsCity = d.TrailerHeadingCity;
            box.WhereaboutsState = d.TrailerHeadingState;
            box.WhereaboutsGameTime = d.TrailerWhereaboutsGameTime;
        }
#pragma warning restore CS0618
    }

    /// <summary>
    /// v13 — how many tours the driver has already done on the trailer they are pulling.
    ///
    /// <see cref="Driver.HomeTimesOnTrailer"/> is new, and left at its default every existing career
    /// would read as freshly assigned — which is exactly wrong for the case the counter was added for.
    /// A driver who has been on the same box for six tours would be handed the LOWEST chance of being
    /// moved off it, and the feature would take another six tours to start meaning anything.
    ///
    /// So it is worked out from what the file already knows. The last completed trailer swap is the
    /// moment the current assignment began; the time since, over the arrangement they are on, is roughly
    /// how many home times they have had on it. Where there has never been a swap, they have been on it
    /// since they were hired, so every home time they have taken counts.
    ///
    /// An estimate, and it says so — but a wrong estimate here is off by a tour, where the default is
    /// wrong by the entire history.
    /// </summary>
    private static void BackfillTrailerTenure(AppState s)
    {
        if (s.SchemaVersion >= 13) return;
        if (s.Driver.HomeTimesOnTrailer > 0) return;          // already counted; nothing to work out

        var taken = Math.Max(0, s.Driver.HomeTimesTaken);
        if (taken == 0) return;                                // never been home, so no tours to count

        // When the current trailer was picked up, as best the file records it.
        var swap = s.EquipmentOrders
            .Where(o => o.Kind == "TrailerSwap" && o.Status != "Open"
                        && !string.IsNullOrWhiteSpace(o.CompletedGameTime))
            .Select(o => GameClock.TryParse(o.CompletedGameTime))
            .Where(x => x != null)
            .OrderByDescending(x => x!.Value)
            .FirstOrDefault();

        if (swap == null)
        {
            // No swap on record: they have had this one since day one, so every home time was on it.
            s.Driver.HomeTimesOnTrailer = taken;
            return;
        }

        var now = GameClock.TryParse(s.Status.GameTime);
        var interval = s.Driver.HomeTimeIntervalDays;
        if (now == null || interval <= 0)
        {
            // No arrangement to divide by, or no clock to measure from. One tour is the honest floor —
            // they have been home at least once since the swap or the swap would still be open.
            s.Driver.HomeTimesOnTrailer = 1;
            return;
        }

        var days = Math.Max(0, (now.Value - swap.Value).TotalDays);
        var tours = (int)Math.Floor(days / interval);
        s.Driver.HomeTimesOnTrailer = Math.Clamp(tours, 0, taken);
    }

    /// <summary>
    /// v13 — settlements already in the file are history, not a queue of announcements.
    ///
    /// <see cref="Settlement.Announced"/> is new and defaults to false, which on an existing career would
    /// mean every payday ever run comes back as an unread popup. They were read; the flag simply did not
    /// exist to record it. Only paydays raised from here on start unannounced.
    /// </summary>
    private static void SettlementsAlreadyBankedAreNotNews(AppState s)
    {
        if (s.SchemaVersion >= 13) return;
        s.SchemaVersion = 13;

        foreach (var st in s.Settlements) st.Announced = true;
    }

    private static void KeyDockTimesToTheTrailerPulled(AppState s)
    {
        if (s.SchemaVersion >= 12) return;
        s.SchemaVersion = 12;

        var moved = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var t in s.Trips)
        {
            if (string.IsNullOrWhiteSpace(t.TrailerUnit)) continue;

            var pulled = s.Trailers.FirstOrDefault(x =>
                x.Unit.Equals(t.TrailerUnit, StringComparison.OrdinalIgnoreCase)
                || (!string.IsNullOrWhiteSpace(x.GameId)
                    && x.GameId.Equals(t.TrailerUnit, StringComparison.OrdinalIgnoreCase)));
            if (pulled == null || string.IsNullOrWhiteSpace(pulled.Type)) continue;
            if (pulled.Type.Equals(t.TrailerType, StringComparison.OrdinalIgnoreCase)) continue;

            var key = $"{t.TrailerType} → {pulled.Type}";
            moved[key] = moved.TryGetValue(key, out var c) ? c + 1 : 1;
            t.TrailerType = pulled.Type;
        }

        if (moved.Count == 0) return;

        // Re-key first, rebuild second. The rebuild reads the field we have just corrected.
        FacilityLearning.Rebuild(s);

        s.Events.Insert(0, new LogEvent
        {
            Channel = "system",
            GameTime = s.Status.GameTime,
            Message =
                $"Corrected the trailer on {moved.Values.Sum()} closed load(s): " +
                string.Join(", ", moved.Select(x => $"{x.Value} × {x.Key}")) + ". " +
                "They had been filed against the trailer the job listing asked for rather than the one on " +
                "the back of the truck, so dock times were being learned for trailers you have never " +
                "pulled. The averages have been worked out again from the corrected history.",
        });
    }

    /// <summary>
    /// Puts the drop-and-hook arrangement on every carrier's books.
    ///
    /// Not version-gated, because it has to be true of a career that changes employer as much as one
    /// that was created before the arrangement existed. Every carrier runs freight-market work; the slot
    /// is what a driver gets assigned to or asks for when they want it.
    ///
    /// It is not equipment and nothing is bought for it — see <see cref="DropHook"/>.
    /// </summary>
    private static void EnsureDropHookIsOnOffer(AppState s)
    {
        if (s.Company.Terminals.Count == 0) return;
        if (s.Trailers.Any(t => DropHook.Is(t.Type))) return;

        DropHook.Ensure(s);

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message =
                $"{s.Company.Name} runs drop-and-hook work as well. It is on the board as a trailer you can " +
                "be put on or ask for: Freight Market jobs, the shipper's trailer, dropped at the other end " +
                "— no loading, no unloading, and nothing of ours to damage.",
        });
    }

    private static void WipeLateIncidents(AppState s)
    {
        if (s.SchemaVersion >= 9) return;
        s.SchemaVersion = 9;

        var removed = RemoveLateNotes(s, _ => true);
        if (removed == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "safety",
            GameTime = s.Status.GameTime,
            Message = $"Cleared {removed} late note(s) from the safety file, and any discipline issued off " +
                      "them. The app had booked delivery slots its own plans could not reach and filed notes " +
                      "when drivers missed them; the first attempt at reversing that missed the notes " +
                      "themselves. Your delivery history is unchanged — this is the paperwork, not the record.",
        });
    }

    private static void ClearLateMarksFromUnreachableSlots(AppState s)
    {
        if (s.SchemaVersion >= 8) return;
        s.SchemaVersion = 8;

        var grace = Math.Max(0, s.Settings.AppointmentGraceHours);
        var fixedUp = 0;

        foreach (var t in s.Trips.Where(x => x.ServiceResult == "Late" && x.Kind == "Freight"))
        {
            var due = GameClock.TryParse(t.DueGameTime);
            var del = GameClock.TryParse(t.DeliveredGameTime);
            if (due == null || del == null) continue;
            if (del.Value > due.Value) continue;                    // genuinely past the deadline

            // Inside the window, so the only thing that could have failed it is the slot comparison.
            var slot = GameClock.TryParse(t.AppointmentGameTime);
            if (slot == null) continue;

            var planned = GameClock.TryParse(t.FeasibilityAtDispatch?.ProjectedArrivalGameTime ?? "");
            var reachable = planned == null || planned.Value <= slot.Value.AddHours(grace);
            if (reachable) continue;                                // it was makeable; the mark stands

            t.ServiceResult = "OnTime";
            t.DelayFault = "";
            fixedUp++;
        }

        if (fixedUp == 0) return;

        // The incidents raised off those loads go too — a note filed on a service failure that did not
        // happen is not a record, it is an accusation. Matched on Kind and TripNumber: the first attempt
        // looked for Kind "Service" and searched the description text, so it matched nothing at all and
        // the notes outlived the reversal.
        var reversed = s.Trips.Where(t => t.ServiceResult == "OnTime" && !string.IsNullOrWhiteSpace(t.Number))
                              .Select(t => t.Number)
                              .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var removed = RemoveLateNotes(s, i => reversed.Contains(i.TripNumber ?? ""));

        s.Events.Insert(0, new LogEvent
        {
            Channel = "safety",
            GameTime = s.Status.GameTime,
            Message = $"Reversed {fixedUp} late mark(s){(removed > 0 ? $" and {removed} note(s)" : "")}: the app had " +
                      "booked a delivery slot earlier than its own plan could reach, then held the driver to it. " +
                      "Those loads were delivered inside their windows and are back to on time.",
        });
    }

    private static void GiveRunningLoadsAnAppointment(AppState s)
    {
        if (s.SchemaVersion >= 7) return;
        s.SchemaVersion = 7;

        var stamped = 0;
        foreach (var t in s.Trips.Where(x => x.Status is "Authorized" or "InTransit"))
        {
            if (!string.IsNullOrWhiteSpace(t.AppointmentGameTime)) continue;
            if (GameClock.TryParse(t.AppointmentOpensGameTime) is not { } opensAt) continue;
            if (GameClock.TryParse(t.DueGameTime) is not { } dueAt || dueAt <= opensAt) continue;

            t.AppointmentGameTime = GameClock.Format(DeliveryWindow.AppointmentIn(opensAt, dueAt, t.Id));
            stamped++;
        }

        if (stamped == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "dispatch",
            GameTime = s.Status.GameTime,
            Message = $"Booked a delivery slot on {stamped} load(s) already running. Receivers work to " +
                      "appointments now rather than taking anything from the moment they open, and a load " +
                      "dispatched before that would otherwise have had no slot to aim at. Check the Active " +
                      "tab for the time.",
        });
    }

    private static void ClearTrailerDecisionsLeftToTheDriver(AppState s)
    {
        if (s.SchemaVersion >= 6) return;
        s.SchemaVersion = 6;

        var cleared = 0;
        foreach (var report in s.FleetReports)
            cleared += report.Retirements.RemoveAll(r =>
                r.UnitKind == "Trailer" &&
                r.Evidence.Any(e => e.Contains("re-rig for whatever the lane", StringComparison.OrdinalIgnoreCase)));

        if (cleared == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "fleet",
            GameTime = s.Status.GameTime,
            Message = $"Dropped {cleared} trailer note(s) that left the replacement decision to you. Whether a " +
                      "trailer earns its place, and what replaces it, is operations' call — the next fleet report " +
                      "will say which trailers are going and what is ordered for them.",
        });
    }

    private static void DropEndorsementsThatAreNotReal(AppState s)
    {
        if (s.SchemaVersion >= 5) return;
        s.SchemaVersion = 5;

        var fictional = new[] { "tanker", "doubles/triples", "doubles", "triples" };
        bool IsFiction(string q) => fictional.Contains((q ?? "").Trim().ToLowerInvariant());

        var removedQuals = s.Driver.Qualifications.RemoveAll(IsFiction);
        var removedEnds = s.Driver.Endorsements.RemoveAll(IsFiction);
        if (removedQuals + removedEnds == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message = "Tidied the licence file: \"Tanker\" and \"Doubles/Triples\" are not endorsements — " +
                      "a tanker is a trailer and what gates it is what is inside. Your hazmat classes are " +
                      "untouched, and carriers now ask for the class their freight actually carries.",
        });
    }

    private static void UndoProbationClearedWithoutTheReviews(AppState s)
    {
        if (s.SchemaVersion >= 4) return;
        s.SchemaVersion = 4;

        if (s.Driver.Probation.Active) return;                 // still on it — nothing to undo
        if (s.Driver.Rank != "company") return;                // moved up on merit since; leave it
        if (s.Driver.CareerOver || s.Driver.TerminatedForCause) return;

        var passes = Probation.ConsecutivePasses(s);
        if (passes >= Probation.PassesToClear) return;          // earned it properly

        CareerService.RestoreProbation(s,
            $"Probation restored: cleared on thresholds alone with {passes} good review(s) in a row against " +
            $"{Probation.PassesToClear} required.");

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message = $"Probation put back: it had been cleared without the reviews ({passes} of " +
                      $"{Probation.PassesToClear} good reviews in a row). Back on the probationary scale until " +
                      "you have sat them. Settlements already paid are untouched.",
        });
    }

    private static void ClearSafetyRecordWrittenUnderOldRules(AppState s)
    {
        if (s.SchemaVersion >= 3) return;
        s.SchemaVersion = 3;

        var incidents = s.Incidents.Count;
        var actions = s.Discipline.Count;
        var lateTrips = s.Trips.Count(t => t.ServiceResult == "Late");

        s.Incidents.Clear();
        s.Discipline.Clear();

        // The late flags too. Loads that were never actually late are still marked so, and the on-time
        // percentage those flags feed is what a review judges.
        foreach (var t in s.Trips.Where(t => t.ServiceResult == "Late"))
        {
            t.ServiceResult = "OnTime";
            t.DelayFault = "";
        }

        if (incidents + actions + lateTrips == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            GameTime = s.Status.GameTime,
            Channel = "career",
            Message = $"Safety record cleared: {incidents} incident(s), {actions} disciplinary action(s) and " +
                      $"{lateTrips} late flag(s) removed. They were recorded under rules that punished a single " +
                      "late load like a pattern, and some of those loads were only late because of faults in this " +
                      "app. You start clean; the next thing that is genuinely yours starts at coaching."
        });
    }

    /// <summary>
    /// Moves a career onto the game's own day numbering.
    ///
    /// The app used to count the epoch as day 1 where ATS counts it as day 0, so every day number a
    /// driver read was one ahead of the one in front of them: the game's day 14 was shown as day 15.
    ///
    /// Almost nothing has to be rewritten, because almost nothing stores a day <i>number</i>. Times are
    /// stored as timestamps and the day is worked out from them, so every trip, delivery window, home
    /// time and log entry renumbers itself the moment <see cref="GameClock.DayOf"/> stops adding one —
    /// and every duration between two of them is untouched, because differences do not care what the
    /// days are called. The weekday anchor moved with the numbering (see <see cref="GameClock.WeekdayOf"/>),
    /// so paydays stay on the same actual Fridays; they are simply now called 4, 11, 18 rather than
    /// 5, 12, 19.
    ///
    /// That leaves exactly one stored number: the day the driver was last paid. It is bookkeeping
    /// against the same real day, so it moves down with everything else. Leaving it alone would make
    /// the app think a payday was still owed, or already settled, depending on which side of it the
    /// career sat.
    /// </summary>
    private static void MatchGameDayNumbering(AppState s)
    {
        if (s.SchemaVersion >= 2) return;
        s.SchemaVersion = 2;

        // Day 0 is a legitimate day now, so only a real recorded payday moves.
        if (s.Driver.LastPaydayDay > 0) s.Driver.LastPaydayDay -= 1;
    }

    /// <summary>
    /// Finds loads still running whose delivery window does not match the run.
    ///
    /// The screenshot reader used to be asked for hours-to-deliver while never being told the game
    /// time, and could not return "I could not tell" — so it invented windows, and those windows are
    /// the appointments live loads are still being judged against.
    ///
    /// Nothing is rewritten. The app cannot know what the board actually said, and quietly moving an
    /// appointment is how a driver ends up late against a number nobody chose. It flags them so the
    /// driver can read the real figure off the game and correct it in one field.
    /// </summary>
    private static void FlagImplausibleWindows(AppState s)
    {
        foreach (var t in s.Trips.Where(x => x.Status is "Authorized" or "InTransit"))
        {
            if (!string.IsNullOrWhiteSpace(t.WindowWarning)) continue;
            var miles = (t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles) + t.DeadheadMiles;
            if (DeliveryWindow.Implausible(s, t.DeadlineHoursAtDispatch, miles, t.TrailerType) is { } why)
                t.WindowWarning = why;
        }
    }

    /// <summary>
    /// Home time used to be counted on every status report made from the yard rather than on arriving
    /// at it, so a driver sitting out a 34 at the house and reporting their clocks each morning was
    /// recorded as taking home time again every day.
    ///
    /// Seeds the flag from where the truck actually is, so a career loaded while parked at home does
    /// not get one final phantom count on the next report.
    /// </summary>
    private static void EnsureAtHomeFlag(AppState s)
    {
        if (s.Driver.AtHomeYard) return;
        var home = HomeTime.HomeTerminal(s);
        if (home == null) return;
        var miles = Geo.MilesBetween(s.Status.LocationCity, s.Status.LocationState, home.City, home.State);
        if (miles is { } m && m <= 1) s.Driver.AtHomeYard = true;
    }

    /// <summary>
    /// Endorsements used to live in the qualifications list, which rank promotion also writes company
    /// unlocks into — so being promoted to company driver handed the driver a hazmat endorsement they
    /// never sat an exam for. They have their own list now.
    ///
    /// Carried across from the application flags only. A "Hazmat" that arrived through promotion is NOT
    /// moved over, because it was never a licence — it was the carrier lifting its own restriction, and
    /// treating it as an endorsement is the bug being fixed.
    /// </summary>
    private static void EnsureEndorsements(AppState s)
    {
        if (s.Driver.Endorsements.Count > 0) return;
        if (s.Application == null) return;

        // Nothing is carried across. The old flags said "has hazmat" without saying which class, and
        // ATS gates on the class — guessing would let somebody take a load they are not cleared for.
        // The flag stays on the application so the app can ask them to pick their classes.
        Endorsements.MigrateFromCdlModel(s);
    }

    /// <summary>
    /// Pay and home-time ratings were not stored, so retention had nothing to work from. Look them up
    /// from the carrier code. A career at a generated carrier keeps zeros and falls back to neutral.
    /// </summary>
    private static void EnsureCarrierStanding(AppState s)
    {
        if (s.Company.PayStars > 0 || s.Company.HomeTimeStars > 0) return;
        var (pay, home) = Carriers.StandingFor(s.Company.Code);
        if (pay <= 0 && home <= 0) return;
        s.Company.PayStars = pay;
        s.Company.HomeTimeStars = home;
    }

    /// <summary>
    /// Careers written before the app understood that ATS shows STARS for equipment under a hired
    /// driver — never a damage percentage — have no star readings at all.
    ///
    /// Nothing is invented here. A star rating cannot be derived from a percentage the player was
    /// wrongly asked to guess at, so units are left at zero stars, which the app reads as "not
    /// reported" and simply asks for on the next fortnightly report. What does get set is the trailer
    /// acquisition date, because age has to start counting from somewhere and the career's own hire
    /// date is the honest floor.
    /// </summary>
    private static void EnsureFleetStars(AppState s)
    {
        var fallback = string.IsNullOrWhiteSpace(s.Driver.HiredGameDate)
            ? s.Status.GameTime
            : s.Driver.HiredGameDate;
        if (string.IsNullOrWhiteSpace(fallback)) return;

        foreach (var tr in s.Trailers)
            if (string.IsNullOrWhiteSpace(tr.AcquiredGameTime))
                tr.AcquiredGameTime = fallback;

        // Yards had no trailer capacity, so an unset one would read as zero and refuse every purchase.
        foreach (var yard in s.Company.Terminals)
            if (yard.TrailerCapacity <= 0)
                yard.TrailerCapacity = yard.Level switch
                {
                    "Large" => 12,
                    "Medium" => 6,
                    _ => 3
                };
    }

    /// <summary>
    /// Careers written before the employer's terminal network was stored have nothing to check garage
    /// opportunities against, so the app offered a yard in every city the truck reached. Look the
    /// network up from the carrier code.
    ///
    /// Yards the driver already owns are left alone, even off-network — they bought those garages in
    /// ATS and they are real. This only affects what gets offered from here on.
    /// </summary>
    private static void EnsureCarrierNetwork(AppState s)
    {
        if (s.Company.NetworkCities.Count > 0) return;
        var net = Carriers.NetworkCitiesFor(s.Company.Code);
        if (net.Count == 0) return;      // fictional carrier: no real network to be faithful to

        // Anywhere we already have a yard belongs on the network too, or the app would start telling
        // the driver their own terminal is somewhere the company does not operate.
        foreach (var t in s.Company.Terminals)
        {
            var key = $"{t.City},{t.State}";
            if (!net.Any(n => n.Equals(key, StringComparison.OrdinalIgnoreCase))) net.Add(key);
        }
        s.Company.NetworkCities = net;
    }

    /// <summary>
    /// Careers written before the carrier's equipment standard was stored have no idea what tier of
    /// truck their employer runs. Look it up from the carrier code so upgrades and stocked yards
    /// issue the right equipment from here on. Nothing already in the fleet is touched.
    /// </summary>
    private static void EnsureEquipmentStandard(AppState s)
    {
        if (s.Company.EquipmentStars > 0) return;
        s.Company.EquipmentStars = Carriers.EquipmentStarsFor(s.Company.Code);
    }

    /// <summary>
    /// Older builds stamped the balance-reported timestamp on every status update, because the UI sent
    /// 0 for an untouched box rather than "not reported". The app then believed the game held zero and
    /// warned about a mismatch against its own perfectly correct figure — with no way out except
    /// zeroing the books to match a phantom.
    ///
    /// A zero balance on a career that has been trading is not a real reading, so treat it as never
    /// reported and ask for it properly. Nothing is destroyed; the ledger is untouched.
    /// </summary>
    private static void ClearPhantomBankBalance(AppState s)
    {
        if (s.Status.AtsBankBalance != 0) return;
        if (string.IsNullOrWhiteSpace(s.Status.AtsBalanceGameTime)) return;
        s.Status.AtsBalanceGameTime = "";
    }

    /// <summary>
    /// Home time used to be free text on the application ("every couple of weeks", "whenever") and was
    /// never acted on. Read what the driver wrote into a real interval where the wording is clear, and
    /// otherwise fall back to the common OTR arrangement rather than silently deciding they never go
    /// home. They can change it on the Career tab.
    /// </summary>
    private static void EnsureHomeTimeArrangement(AppState s)
    {
        if (s.Driver.HomeTimeIntervalDays != 0) return;                 // already set, or deliberately none
        if (s.Application == null) return;
        if (!string.IsNullOrWhiteSpace(s.Driver.LastHomeGameTime)) return;

        var text = (s.Application.HomeTimePreference ?? "").Trim().ToLowerInvariant();
        var key = text switch
        {
            _ when text.Length == 0 => "biweekly",
            _ when HomeTime.DaysFor(text) > 0 => text,                   // already a key
            _ when text.Contains("never") || text.Contains("stay out") || text.Contains("no pref") => "none",
            _ when text.Contains("week") && (text.Contains("every") || text.Contains("each"))
                   && !text.Contains("other") && !text.Contains("two") && !text.Contains("three") => "weekly",
            _ when text.Contains("other week") || text.Contains("two week") || text.Contains("biweek")
                   || text.Contains("14") => "biweekly",
            _ when text.Contains("three week") || text.Contains("21") => "threeweeks",
            _ when text.Contains("month") || text.Contains("30") => "monthly",
            _ when text.Contains("six week") || text.Contains("42") => "sixweeks",
            _ => "biweekly"
        };

        s.Application.HomeTimePreference = key;
        s.Driver.HomeTimeIntervalDays = HomeTime.DaysFor(key);
        // Start the clock from the hire date rather than pretending they just got home.
        s.Driver.LastHomeGameTime = s.Driver.HiredGameDate;
    }

    /// <summary>
    /// Careers written before city discovery was tracked know nothing about where the truck has been.
    /// Rebuild that from the history we do have, so an established career is not told it has
    /// discovered nothing. Backfilled cities are marked notified — a career with forty loads behind it
    /// should not open to forty "new city" notices.
    /// </summary>
    private static void EnsureDiscoveredCities(AppState s)
    {
        if (s.Discovered.Count == 0) DiscoveryService.Backfill(s);
        else DiscoveryService.SyncOwnership(s);
    }

    /// <summary>
    /// Fuel used to be one gallons/cost pair per trip. Promote those to a single fuel stop so every
    /// closed trip stores fuel the same way and the per-stop reporting has something to show.
    /// </summary>
    private static void EnsureTripFuelStops(AppState s)
    {
        foreach (var t in s.Trips)
        {
            if (t.FuelStops.Count > 0) continue;
            if (t.FuelGallons <= 0 && t.FuelCost <= 0) continue;
            t.FuelStops.Add(new FuelPurchase
            {
                GameTime = t.DeliveredGameTime,
                City = t.DestCity,
                State = t.DestState,
                Gallons = t.FuelGallons,
                Cost = t.FuelCost,
                PricePerGal = t.FuelGallons > 0 ? Math.Round(t.FuelCost / (decimal)t.FuelGallons, 3) : 0,
                Notes = "Reconstructed from the trip total — this build records each stop separately."
            });
        }
    }

    /// <summary>
    /// Equipment the carrier "owns" on paper but that does not exist in the driver's ATS garage.
    ///
    /// Older careers were seeded with a six-truck fleet across three yards. That cannot be reconciled
    /// with the game: the player never bought those units, so their damage and mileage are fiction,
    /// and yards in cities they never drove to would never see cargo anyway. This reports the problem
    /// and <see cref="TrimBackdropEquipment"/> fixes it — but only when the player asks, because
    /// deleting equipment is not something a migration should do behind their back.
    /// </summary>
    public static (int trucks, int trailers, int yards) CountBackdrop(AppState s)
    {
        var trucks = s.Trucks.Count(t => !t.InGameGarage && t.Unit != s.Driver.AssignedTruckUnit
                                         && !s.HiredDrivers.Any(h => h.AssignedTruckUnit == t.Unit));
        // The drop-and-hook slot is deliberately not in an ATS garage — there is nothing to buy — so it
        // looks exactly like backdrop equipment to a count that only reads that flag. Offering to trim it
        // would take away the arrangement itself.
        var trailers = s.Trailers.Count(t => !t.InGameGarage && !DropHook.Is(t.Type)
                                             && t.Unit != s.Driver.AssignedTrailerUnit
                                             && !s.HiredDrivers.Any(h => h.AssignedTrailerUnit == t.Unit));
        var yards = s.Company.Terminals.Count(t => !t.IsHeadquarters
                                                   && !DiscoveryService.IsDiscovered(s, t.City, t.State));
        return (trucks, trailers, yards);
    }

    /// <summary>
    /// Removes on-paper-only equipment and undiscovered yards, keeping anything real: the driver's own
    /// units, anything assigned to a hired driver, anything flagged as being in an ATS garage, and
    /// headquarters. Units carrying real history are re-homed rather than deleted.
    /// </summary>
    public static List<string> TrimBackdropEquipment(AppState s, bool includeYards)
    {
        var notes = new List<string>();

        bool TruckIsReal(Truck t) => t.InGameGarage
                                     || t.Unit == s.Driver.AssignedTruckUnit
                                     || s.HiredDrivers.Any(h => h.AssignedTruckUnit == t.Unit)
                                     || s.Trips.Any(x => x.TruckUnit == t.Unit);

        // The drop-and-hook slot is deliberately not in a garage, which to a check that only reads that
        // flag looks exactly like backdrop. Trimming it would delete the arrangement itself — and unless
        // the driver happened to be on it at the time, that is what would have happened.
        bool TrailerIsReal(Trailer t) => t.InGameGarage
                                         || DropHook.Is(t.Type)
                                         || t.Unit == s.Driver.AssignedTrailerUnit
                                         || s.HiredDrivers.Any(h => h.AssignedTrailerUnit == t.Unit)
                                         || s.Trips.Any(x => x.TrailerUnit == t.Unit);

        var droppedTrucks = s.Trucks.Where(t => !TruckIsReal(t)).Select(t => t.Unit).ToList();
        s.Trucks.RemoveAll(t => droppedTrucks.Contains(t.Unit));
        if (droppedTrucks.Count > 0)
            notes.Add($"Removed {droppedTrucks.Count} tractor(s) that were never in your garage: {string.Join(", ", droppedTrucks)}.");

        var droppedTrailers = s.Trailers.Where(t => !TrailerIsReal(t)).Select(t => t.Unit).ToList();
        s.Trailers.RemoveAll(t => droppedTrailers.Contains(t.Unit));
        if (droppedTrailers.Count > 0)
            notes.Add($"Removed {droppedTrailers.Count} trailer(s) that were never in your garage: {string.Join(", ", droppedTrailers)}.");

        if (includeYards)
        {
            var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
            var doomed = s.Company.Terminals
                .Where(t => !t.IsHeadquarters && !DiscoveryService.IsDiscovered(s, t.City, t.State))
                .ToList();
            foreach (var y in doomed)
            {
                // Never orphan a unit. Anything based here comes back to headquarters.
                foreach (var t in s.Trucks.Where(t => t.HomeTerminalId == y.Id)) t.HomeTerminalId = hq?.Id ?? "";
                foreach (var t in s.Trailers.Where(t => t.HomeTerminalId == y.Id)) t.HomeTerminalId = hq?.Id ?? "";
                foreach (var d in s.HiredDrivers.Where(d => d.HomeTerminalId == y.Id)) d.HomeTerminalId = hq?.Id ?? "";
                if (s.Driver.HomeTerminalId == y.Id) s.Driver.HomeTerminalId = hq?.Id ?? "";
                s.Company.Terminals.Remove(y);
            }
            if (doomed.Count > 0)
                notes.Add($"Closed {doomed.Count} yard(s) in cities you have not reached: " +
                          $"{string.Join(", ", doomed.Select(y => DispatchEngine.Place(y.City, y.State)))}. " +
                          "Anything based there came back to headquarters.");
        }

        SyncHeadquarters(s);
        DiscoveryService.SyncOwnership(s);
        if (notes.Count == 0) notes.Add("Nothing to trim — every unit and yard on the book is real.");
        return notes;
    }

    /// <summary>
    /// Older careers physically moved money into "maintenance" and "payroll" reserve accounts. ATS
    /// has a single bank account, so that split invented cash the game does not have. Sweep any
    /// reserve balances back into operating once; from then on the reserves are computed earmarks
    /// against the one balance rather than pots holding money.
    /// </summary>
    private static void CollapseReservesIntoOneCashAccount(AppState s)
    {
        if (!s.Settings.SingleCashAccount) return;

        foreach (var key in new[] { LedgerService.MaintenanceReserve, LedgerService.PayrollReserve })
        {
            var acct = s.Accounts.FirstOrDefault(a => a.Key == key);
            if (acct == null) continue;

            var balance = LedgerService.Balance(s, key);
            if (Math.Abs(balance) < 0.01m) continue;

            // Move the money, preserving the history that put it there.
            LedgerService.Post(s, key, -balance, "Transfer",
                $"Reserve folded into operating cash — ATS has one bank account.", isAdjustment: true);
            LedgerService.Post(s, LedgerService.Operating, balance, "Transfer",
                $"{acct.Name} folded in; now tracked as an earmark, not separate cash.", isAdjustment: true);
        }
    }

    /// <summary>
    /// Careers written before the clock moved to day numbers stored real-world dates like
    /// 2026-03-02. ATS has no calendar, so those dates were fiction — and they would now render as
    /// "Day 9558". Shift every recorded moment so the career starts at Day 1, preserving all the
    /// intervals between them, which is the only thing the dates ever meant.
    /// </summary>
    private static void RebaseGameCalendar(AppState s)
    {
        // Anchor on the EARLIEST recorded moment, not the hire date. A career whose clock was moved
        // backwards at some point would otherwise shift below the epoch and render as a negative day.
        var earliest = AllGameTimes(s)
            .Select(GameClock.TryParse)
            .Where(d => d != null)
            .Select(d => d!.Value)
            .DefaultIfEmpty()
            .Min();
        if (earliest == default) return;

        // Anything at or before the epoch year is already on day numbering.
        if (earliest.Year <= GameClock.Epoch.Year) return;

        var offset = earliest.Date - GameClock.Epoch;

        string Shift(string? v) =>
            GameClock.TryParse(v) is { } dt ? GameClock.Format(dt - offset) : (v ?? "");

        s.Status.GameTime = Shift(s.Status.GameTime);
        s.Hos.AsOfGameTime = Shift(s.Hos.AsOfGameTime);
        s.Driver.HiredGameDate = Shift(s.Driver.HiredGameDate);
        s.Driver.Probation.StartedGameDate = Shift(s.Driver.Probation.StartedGameDate);
        s.Driver.Probation.ClearedGameDate = Shift(s.Driver.Probation.ClearedGameDate);

        foreach (var t in s.Driver.Transfers) t.RequestedGameTime = Shift(t.RequestedGameTime);
        foreach (var h in s.Driver.EmploymentHistory)
        {
            h.StartedGameDate = Shift(h.StartedGameDate);
            h.EndedGameDate = Shift(h.EndedGameDate);
        }

        foreach (var t in s.Trips)
        {
            t.DispatchedGameTime = Shift(t.DispatchedGameTime);
            t.DueGameTime = Shift(t.DueGameTime);
            t.DeliveredGameTime = Shift(t.DeliveredGameTime);
            foreach (var e in t.Events) e.GameTime = Shift(e.GameTime);
            if (t.FeasibilityAtDispatch is { } f)
            {
                f.ProjectedArrivalGameTime = Shift(f.ProjectedArrivalGameTime);
                f.DueGameTime = Shift(f.DueGameTime);
                foreach (var step in f.Timeline)
                {
                    step.StartGameTime = Shift(step.StartGameTime);
                    step.EndGameTime = Shift(step.EndGameTime);
                }
            }
        }

        foreach (var e in s.Ledger) e.GameTime = Shift(e.GameTime);
        foreach (var w in s.WorkOrders) w.GameTime = Shift(w.GameTime);
        foreach (var i in s.Incidents) i.GameTime = Shift(i.GameTime);
        foreach (var d in s.Discipline) d.GameTime = Shift(d.GameTime);
        foreach (var o in s.EquipmentOrders)
        {
            o.IssuedGameTime = Shift(o.IssuedGameTime);
            o.CompletedGameTime = Shift(o.CompletedGameTime);
        }
        foreach (var st in s.Settlements)
        {
            st.PeriodStartGame = Shift(st.PeriodStartGame);
            st.PeriodEndGame = Shift(st.PeriodEndGame);
        }
        foreach (var r in s.FleetReports)
        {
            r.PeriodStartGame = Shift(r.PeriodStartGame);
            r.PeriodEndGame = Shift(r.PeriodEndGame);
        }
        foreach (var d in s.HiredDrivers) d.HiredGameDate = Shift(d.HiredGameDate);
        foreach (var e in s.Events) e.GameTime = Shift(e.GameTime);
    }

    /// <summary>Every stored game moment, used to find the true start of the career.</summary>
    private static IEnumerable<string> AllGameTimes(AppState s)
    {
        yield return s.Status.GameTime;
        yield return s.Hos.AsOfGameTime;
        yield return s.Driver.HiredGameDate;
        yield return s.Driver.Probation.StartedGameDate;
        foreach (var h in s.Driver.EmploymentHistory) yield return h.StartedGameDate;
        foreach (var t in s.Trips)
        {
            yield return t.DispatchedGameTime;
            foreach (var e in t.Events) yield return e.GameTime;
        }
        foreach (var e in s.Ledger) yield return e.GameTime;
        foreach (var w in s.WorkOrders) yield return w.GameTime;
        foreach (var i in s.Incidents) yield return i.GameTime;
        foreach (var d in s.Discipline) yield return d.GameTime;
        foreach (var st in s.Settlements) yield return st.PeriodStartGame;
        foreach (var r in s.FleetReports) yield return r.PeriodStartGame;
        foreach (var d in s.HiredDrivers) yield return d.HiredGameDate;
    }

    /// <summary>
    /// Equipment used to record its yard as free text, which meant capacity checks did fragile
    /// string matching on city names. Resolve each unit to a real terminal id once.
    /// </summary>
    private static void EnsureEquipmentTerminalIds(AppState s)
    {
        if (s.Company.Terminals.Count == 0) return;
        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters) ?? s.Company.Terminals[0];

        string Resolve(string legacy)
        {
            if (string.IsNullOrWhiteSpace(legacy)) return hq.Id;
            var city = legacy.Split(',')[0].Trim();
            var hit = s.Company.Terminals.FirstOrDefault(t =>
                t.City.Equals(city, StringComparison.OrdinalIgnoreCase));
            return hit?.Id ?? hq.Id;
        }

#pragma warning disable CS0618 // reading the superseded field is the point of the migration
        foreach (var t in s.Trucks.Where(t => string.IsNullOrWhiteSpace(t.HomeTerminalId)))
            t.HomeTerminalId = Resolve(t.HomeTerminal);
        foreach (var t in s.Trailers.Where(t => string.IsNullOrWhiteSpace(t.HomeTerminalId)))
            t.HomeTerminalId = Resolve(t.HomeTerminal);
#pragma warning restore CS0618
    }

    /// <summary>Tractors based at a yard, which is what its capacity limits.</summary>
    /// <summary>
    /// Tractors actually taking up room at a yard.
    ///
    /// A RETIRED tractor is not one of them. It is off the fleet — the model says as much, it is kept
    /// only so its trip history still resolves — and counting it held the slot forever. Every new
    /// company starts with a Small yard: one slot, one truck. Wreck that truck and the career ended
    /// there: the replacement could not be added before the write-off because the wreck was in the way,
    /// and could not be added after it because the retirement did not give the slot back.
    ///
    /// Nor does a tractor already past its write-off line. It cannot be run and it is leaving, and
    /// keeping it in the count made the app's own recovery steps impossible to follow in the order they
    /// are printed.
    /// </summary>
    public static int TrucksBasedAt(AppState s, string terminalId) =>
        s.Trucks.Count(t => t.HomeTerminalId == terminalId && HoldsASlot(s, t));

    /// <summary>Whether this tractor is part of the working fleet at its yard.</summary>
    private static bool HoldsASlot(AppState s, Truck t)
    {
        if (t.Status is "OutOfService" or "Retired") return false;
        if (t.Retired) return false;
        return t.DamagePct < Shop.TotalLossPctFor(s, t);
    }

    /// <summary>Remaining tractor slots at a yard. Negative means it is over capacity.</summary>
    public static int RoomAt(AppState s, Terminal t) => t.TruckCapacity - TrucksBasedAt(s, t.Id);

    public static Terminal? TerminalOf(AppState s, string? terminalId) =>
        s.Company.Terminals.FirstOrDefault(t => t.Id == terminalId);

    /// <summary>Older files stored a single terminal city plus a list of strings.</summary>
    private static void EnsureTerminals(AppState s)
    {
        if (s.Company.Terminals.Count > 0)
        {
            SyncHeadquarters(s);
            return;
        }

        if (!string.IsNullOrWhiteSpace(s.Company.TerminalCity))
            s.Company.Terminals.Add(BuildTerminal(s, s.Company.TerminalCity, s.Company.TerminalState, isHq: true, "Large"));

#pragma warning disable CS0618 // reading the superseded field is the whole point of the migration
        foreach (var legacy in s.Company.SecondaryTerminals)
        {
            var parts = legacy.Split(',', StringSplitOptions.TrimEntries);
            if (parts.Length == 0 || string.IsNullOrWhiteSpace(parts[0])) continue;
            var city = parts[0];
            var st = parts.Length > 1 ? parts[1] : "";
            if (s.Company.Terminals.Any(t => t.City.Equals(city, StringComparison.OrdinalIgnoreCase)
                                             && t.State.Equals(st, StringComparison.OrdinalIgnoreCase))) continue;
            s.Company.Terminals.Add(BuildTerminal(s, city, st, isHq: false, "Medium"));
        }
        s.Company.SecondaryTerminals.Clear();
#pragma warning restore CS0618

        SyncHeadquarters(s);
    }

    /// <summary>
    /// The unit the driver sits in must be real equipment, otherwise its damage readings would be
    /// tracked against a truck ATS has never heard of.
    /// </summary>
    private static void EnsureAssignedEquipmentIsInGarage(AppState s)
    {
        var truck = s.Trucks.FirstOrDefault(t => t.Unit == s.Driver.AssignedTruckUnit);
        if (truck != null && !truck.InGameGarage) truck.InGameGarage = true;

        var trailer = s.Trailers.FirstOrDefault(t => t.Unit == s.Driver.AssignedTrailerUnit);

        // Whatever the driver is pulling is really in their garage — except drop and hook, which is an
        // arrangement rather than a box. Ticking that into an ATS garage claims they own a trailer they
        // were specifically told not to take, and once ticked it starts turning up in utilisation, age
        // and damage prompts for something that does not exist.
        if (trailer != null && !trailer.InGameGarage && !DropHook.Is(trailer.Type))
            trailer.InGameGarage = true;

        // And put back any that were ticked before this was noticed.
        foreach (var dh in s.Trailers.Where(t => DropHook.Is(t.Type) && t.InGameGarage))
        {
            dh.InGameGarage = false;
            dh.DamagePct = 0;
        }
    }

    private static void EnsureAccounts(AppState s)
    {
        if (s.Accounts.Count == 0) Seed.ApplyDefaultAccounts(s);
    }

    public static Terminal BuildTerminal(AppState s, string city, string state, bool isHq, string level)
    {
        var market = Markets.Find(s, city, state);
        var t = new Terminal
        {
            Name = isHq ? $"{s.Company.Name} — {city} (HQ)" : $"{s.Company.Name} — {city}",
            City = city,
            State = (state ?? "").Trim().ToUpperInvariant(),
            IsHeadquarters = isHq,
            Notes = market == null ? "" : $"Tier-{market.Tier} freight market."
        };
        ApplyLevel(t, level);
        return t;
    }

    /// <summary>
    /// Capacity and services follow the yard tier. Even the smallest yard fuels and parks a truck —
    /// a terminal that cannot do that is not a terminal — while a shop needs real square footage.
    /// </summary>
    public static void ApplyLevel(Terminal t, string level)
    {
        t.Level = level;
        switch (level)
        {
            case "Large":
                t.TruckCapacity = 5; t.TrailerCapacity = 12;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = true;
                t.FuelPricePerGal = 3.58m; t.ShopLabourDiscount = 0.35; t.MonthlyCost = 4_200m;
                break;
            case "Medium":
                t.TruckCapacity = 3; t.TrailerCapacity = 6;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = 3.72m; t.ShopLabourDiscount = 0.20; t.MonthlyCost = 2_400m;
                break;
            default:
                t.Level = "Small";
                t.TruckCapacity = 1; t.TrailerCapacity = 3;
                t.HasFuel = true; t.HasShop = false; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = 3.85m; t.ShopLabourDiscount = 0; t.MonthlyCost = 1_150m;
                break;
        }
    }

    /// <summary>Keeps the convenience HQ fields on Company in step with the terminal list.</summary>
    public static void SyncHeadquarters(AppState s)
    {
        if (s.Company.Terminals.Count == 0) return;
        var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters) ?? s.Company.Terminals[0];
        hq.IsHeadquarters = true;
        foreach (var t in s.Company.Terminals.Where(t => t != hq)) t.IsHeadquarters = false;
        s.Company.TerminalCity = hq.City;
        s.Company.TerminalState = hq.State;
    }

    /// <summary>The terminal the truck is standing in right now, if any.</summary>
    public static Terminal? At(AppState s) =>
        s.Status.LocationKind != "Terminal" ? null
        : s.Company.Terminals.FirstOrDefault(t =>
            t.City.Equals(s.Status.LocationCity, StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrWhiteSpace(t.State) || t.State.Equals(s.Status.LocationState, StringComparison.OrdinalIgnoreCase)));
}
