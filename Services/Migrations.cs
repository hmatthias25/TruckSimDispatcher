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

        MoveProbationOffTheStreak(s);
        TakeBackPayForLoadsNobodyHauled(s);
        RetireTheCarHaulerNobodyCanBuy(s);
        NameTheTankOnTheYard(s);
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
        ReopenTheTrailerQuestionNobodyWasAsked(s);
        ReopenTheHalfAnsweredTrailerQuestion(s);
        PayHiredDriversForTheLevelTheyAre(s);
        GiveConductLinesADriverAndADate(s);
        PlaceDriversOnTheGradeTheyHaveEarned(s);
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
        ReissueGdcServiceFromHistory(s);
        ResolveTerminationsLeftToThePlayer(s);
        EnsureSettlementEmployer(s);
        EnsureW2sForYearsAlreadyRun(s);
        LiftFuelPricesToWhatDieselCosts(s);
        RegradeWithoutRating(s);
        CallFleetTakingsWhatTheyAre(s);
        DropChangeoversDecidedTooEarly(s);
        PutAirBetweenWatchAndShop(s);
        PutProbationaryDriversBackOnTheProbationaryScale(s);
        GiveEveryCareerTheUnitedStates(s);
        // Not stamped: a box can leave the fleet at any time, and closing an order already closed is a
        // no-op. This is a standing tidy-up rather than a one-off correction.
        CloseOrdersForTrailersAlreadyGone(s);
    }

    /// <summary>
    /// Puts a driver still serving probation back on their carrier's probationary rate.
    ///
    /// <para>Reported from play: a probationary driver at Prime Inc. on $0.57 a loaded mile, which is
    /// Prime's <b>posted company rate</b> — the figure a cleared company driver earns. The probationary
    /// multiplier is nine tenths of it, so the rate should be $0.513, and a hire made today gets exactly
    /// that. The player also noticed the shape of it from the outside: nothing else on the board they
    /// could get hired by started as high, because the number was not a starting rate at all.</para>
    ///
    /// <para><see cref="Carriers.ApplyPayScale"/> says why it exists in as many words — "without this an
    /// experienced hire started ON the company rate, and clearing probation was worth nothing at all:
    /// same money, new title". Pay is written at hire and then only ever rewritten by a promotion or a
    /// carrier change, so a career created before that landed carries the old number for as long as its
    /// probation lasts, and then gets "promoted" to the rate it was already on.</para>
    ///
    /// <para><b>Only downwards.</b> A second-chance scale, a hand-set rate, anything below the
    /// probationary figure is left alone — this corrects being overpaid by a bug and is not licence to
    /// go rewriting pay generally. Settlements already run are untouched: they were paid, and unpaying
    /// them would be inventing history to fix a different mistake.</para>
    /// </summary>
    private static void PutProbationaryDriversBackOnTheProbationaryScale(AppState s)
    {
        if (s.SchemaVersion >= 25) return;
        s.SchemaVersion = 25;

        if (!s.Onboarded || s.Driver.Rank != "probationary") return;
        if (string.IsNullOrWhiteSpace(s.Company.Code) || s.Application == null) return;

        var (loaded, deadhead, _) = Carriers.StartingRate(s, s.Company.Code, s.Application);
        if (loaded <= 0 || s.Driver.Pay.LoadedCpm <= loaded + 0.0005m) return;

        var was = s.Driver.Pay.LoadedCpm;
        var wasDh = s.Driver.Pay.DeadheadCpm;
        Carriers.ApplyPayScale(s, s.Company.Code, s.Application);

        // Never up. ApplyPayScale reproduces the hire exactly, which is right for the reported case and
        // would be a raise for anybody sitting under it for a reason.
        if (s.Driver.Pay.LoadedCpm > was) s.Driver.Pay.LoadedCpm = was;
        if (s.Driver.Pay.DeadheadCpm > wasDh) s.Driver.Pay.DeadheadCpm = wasDh;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "pay",
            GameTime = s.Status.GameTime,
            Message =
                $"Your loaded rate is corrected from ${was:0.000} to ${s.Driver.Pay.LoadedCpm:0.000} a mile, " +
                $"and empty from ${wasDh:0.000} to ${s.Driver.Pay.DeadheadCpm:0.000}. You were on " +
                $"{s.Company.Name}'s full company rate while still serving probation — that is the figure a " +
                "cleared company driver earns, and it meant clearing probation was worth nothing at all. " +
                "Settlements already run stay as they were paid.",
        });
    }

    /// <summary>
    /// Fills in the map the driver runs, for a career that pre-dates there being one.
    ///
    /// <para>The 50 states and DC, which is the setting's own default and a superset of everywhere base
    /// ATS has ever gone — so a stock career cannot tell this ran, and that is the point. Nobody's board
    /// changes on the strength of an upgrade.</para>
    ///
    /// <para>A modded career gains the thing the setting is for: Canada and Mexico off until the player
    /// says otherwise. That IS a change to their board, and it is the change they asked for. It is also
    /// the only safe direction — starting a C2C career with the whole continent switched on would make
    /// the setting do nothing until it was found, and the driver who wanted it is the driver being
    /// offered Maine.</para>
    ///
    /// <para>Left alone where the list already has something in it, which on this version can only mean
    /// a hand-edited file or an import from a newer build. A migration that overwrites a deliberate
    /// choice is worse than the gap it fills.</para>
    /// </summary>
    private static void GiveEveryCareerTheUnitedStates(AppState s)
    {
        if (s.SchemaVersion >= 26) return;
        s.SchemaVersion = 26;

        if (s.Settings.RunnableStates is { Count: > 0 }) return;
        s.Settings.RunnableStates = MapCoverage.DefaultSelection();

        // Not logged. Nothing happened to this career that the driver did not already have — every state
        // base ATS knows about is on the list, and an event announcing that would be noise on a screen
        // that is meant to be read.
    }

    /// <summary>
    /// Separates "worth a look while you are stopped" from "go to a shop".
    ///
    /// <para>The two thresholds shipped on the same figure, five percent, so the band between them had no
    /// width and five landed straight in "report to the shop after this delivery". Reported from play:
    /// "5% isn't the threshold here, it is the threshold to get it looked at either on my 34 or at the
    /// shop." The settings are stored per career, so changing the default fixes nobody already playing.</para>
    ///
    /// <para><b>Only where it is still the old default.</b> A player who has deliberately set their own
    /// figure has said what they want, and a migration that overwrites a deliberate setting is worse than
    /// the bug it is fixing. Ten to match the line where dispatch stops issuing loads anyway — being sent
    /// to a shop and handed freight going the other way in the same breath is the incoherence that made
    /// two separate numbers wrong in the first place.</para>
    /// </summary>
    private static void PutAirBetweenWatchAndShop(AppState s)
    {
        if (s.SchemaVersion >= 24) return;
        s.SchemaVersion = 24;

        var m = s.Settings.Maintenance;
        if (Math.Abs(m.ReportPct - m.MonitorPct) > 0.001 || Math.Abs(m.ReportPct - 5) > 0.001) return;

        m.ReportPct = Math.Min(10, Math.Max(m.MonitorPct + 1, m.StopDispatchPct));

        s.Events.Insert(0, new LogEvent
        {
            Channel = "maintenance",
            GameTime = s.Status.GameTime,
            Message =
                $"Damage thresholds separated: {m.MonitorPct:0.#}% is now worth a look next time you are " +
                $"stopped anyway — a 34, a ten, standing at the yard — and {m.ReportPct:0.#}% is where you " +
                "are told to report to a shop after the delivery. They were the same figure, so anything " +
                "at five read as a trip to the shop when it was a job for the next time you were parked. " +
                "Both are on the Settings tab if you want them elsewhere.",
        });
    }

    /// <summary>
    /// Throws away every trailer change decided under the old timing.
    ///
    /// <para>The decision used to be taken at any drop from three quarters of the way through the home-time
    /// interval, off whatever trailer positions happened to be on file — usually none — and a long way
    /// before the home time it was about had been planned. Anything sitting on a career now was arrived at
    /// that way, and it is not a promise worth keeping: the driver was told a box on the strength of
    /// information nobody had, and the whole point of the new timing is that the answer waits for the
    /// questions.</para>
    ///
    /// <para><b>Open swap orders go too.</b> That is the player's call, made knowing the cost: a driver who
    /// has already gone and marked a box as private in ATS will find the app has forgotten why. The
    /// alternative was leaving orders standing that were raised on the same bad basis, and a stale
    /// instruction to collect a particular trailer is worse than no instruction — it is the one thing the
    /// driver cannot tell is stale. One will be raised again, properly, at the next run home.</para>
    /// </summary>
    private static void DropChangeoversDecidedTooEarly(AppState s)
    {
        if (s.SchemaVersion >= 23) return;
        s.SchemaVersion = 23;

        var had = s.Driver.ChangeoverUnit;
        var reserved = s.Driver.ChangeoverReserve;
        TrailerChangeover.Forget(s);

        var closed = new List<string>();
        foreach (var o in s.EquipmentOrders.Where(o => o.Status == "Open" && o.Kind == "TrailerSwap"))
        {
            o.Status = "Cancelled";
            o.CompletedGameTime = s.Status.GameTime;
            o.Notes = string.IsNullOrWhiteSpace(o.Notes)
                ? "Cancelled: decided under the old home-time timing."
                : o.Notes + " | Cancelled: decided under the old home-time timing.";
            closed.Add(o.Number);
        }

        if (string.IsNullOrWhiteSpace(had) && closed.Count == 0) return;

        var said = "Trailer changes for home time are decided at the run home now, not days out on tour. ";
        if (!string.IsNullOrWhiteSpace(had))
            said += $"The box you had been promised ({had}) was picked before anybody asked where the " +
                    "trailers were, so it is dropped. ";
        if (closed.Count > 0)
            said += $"So {(closed.Count == 1 ? "is the order" : "are the orders")} raised on the same " +
                    $"basis — {string.Join(", ", closed)}. ";
        if (reserved)
            said += "If you marked that trailer as your own in ATS you can release it; nothing is holding " +
                    "you to it. ";
        said += "You will be asked about the yard's boxes when dispatch next sends you home, and told " +
                "there and then whether you are swapping and onto what.";

        s.Events.Insert(0, new LogEvent { Channel = "fleet", GameTime = s.Status.GameTime, Message = said });
    }

    /// <summary>
    /// Names the carrier that paid each settlement, on careers written before the stamp existed.
    ///
    /// A driver who changes employers gets a W-2 from each, so a year's wages have to remember who paid
    /// them. Worked back off the employment record: anything on or after the current hire date belongs
    /// to the present employer, anything earlier to whichever stint covers the day it was paid.
    /// </summary>
    private static void EnsureSettlementEmployer(AppState s)
    {
        var hired = GameClock.DayOf(s.Driver.HiredGameDate);

        foreach (var st in s.Settlements)
        {
            if (!string.IsNullOrWhiteSpace(st.EmployerCode)) continue;

            var day = GameClock.DayOf(st.PeriodEndGame);
            if (day is { } paid && hired is { } from && paid < from)
            {
                var stint = s.Driver.EmploymentHistory.FirstOrDefault(h =>
                    GameClock.DayOf(h.StartedGameDate) is { } started && paid >= started &&
                    (GameClock.DayOf(h.EndedGameDate) is not { } ended || paid <= ended));

                if (stint != null && !string.IsNullOrWhiteSpace(stint.CarrierCode))
                {
                    st.EmployerCode = stint.CarrierCode;
                    st.EmployerName = stint.CarrierName;
                    continue;
                }
            }

            // No history that covers it, or no date to place it by. The present employer is the only
            // answer the file supports, and it is the right one for every career that never moved.
            st.EmployerCode = s.Company.Code;
            st.EmployerName = s.Company.Name;
        }
    }

    /// <summary>
    /// Issues W-2s for career years that have already run their course.
    ///
    /// Careers predating the tax year have no forms at all, and a driver three years in should not have
    /// to wait until day 1,460 to see one. Runs on every load rather than once: it only ever fills gaps,
    /// and it is also what keeps a form in step when a settlement lands inside a year already closed.
    /// </summary>
    private static void EnsureW2sForYearsAlreadyRun(AppState s) => W2Service.IssueDue(s);

    /// <summary>
    /// Puts existing hired drivers on the share their level earns.
    ///
    /// Everybody was on a flat 30% of what they brought in, which said a level 9 and a rookie cost the
    /// company exactly the same — and so nobody was ever worth keeping in particular. Pay follows the
    /// level ATS gives them now; see <see cref="DriverConduct.ShareForLevel"/>.
    ///
    /// Only where the share is still the old default. A figure the player typed themselves is theirs, and
    /// a migration that overwrites a deliberate decision is worse than one that does nothing.
    ///
    /// Nothing else is backdated. Nobody arrives carrying a preventable they never had, and no career is
    /// re-judged on conduct that did not exist until now — the first report filed after this is where any
    /// of that starts.
    /// </summary>
    private static void PayHiredDriversForTheLevelTheyAre(AppState s)
    {
        if (s.SchemaVersion >= 17) return;
        s.SchemaVersion = 17;

        var moved = 0;
        foreach (var d in s.HiredDrivers.Where(x => x.Status == "Active"))
        {
            if (Math.Abs(d.WageShare - 0.30) > 0.0001) continue;   // theirs, not ours
            var share = DriverConduct.ShareForLevel(d.Level);
            if (Math.Abs(share - d.WageShare) < 0.0001) continue;
            d.WageShare = share;
            moved++;
        }

        if (moved == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "ledger",
            GameTime = s.Status.GameTime,
            Message =
                $"{moved} driver(s) moved onto the share their level earns, between 25% and 40% of what " +
                "they bring in — a flat thirty for everybody meant a level 9 and a rookie cost the same. " +
                "Anyone whose share you had set by hand keeps it. Nothing is backdated: the first fleet " +
                "report from here is where it starts counting.",
        });
    }

    /// <summary>
    /// Puts existing hired drivers on the rung their record has already earned.
    ///
    /// The grade used to be read straight off the ATS level, which was wrong for the reason any fleet
    /// manager would give: an AI driver climbs levels fast, on nothing but miles turned, so a fortnight
    /// of good running read as a promotion to Senior and everybody was senior by the end of the quarter.
    /// It is earned now — time served, distance covered, the rating the game gives them, and a clean
    /// recent record — and every hire serves ninety days before any of it counts.
    ///
    /// Existing drivers keep every day they have already worked. Somebody two game-years in is placed on
    /// what that record is worth, not sent back to the start of a probation they served long ago. The
    /// same evidence the ladder always uses, applied to history that already existed.
    ///
    /// <para>Pay follows the rung from here, so a share has to be readable as chosen or offered. A
    /// figure that matches neither the old flat default nor what the level used to offer was typed by
    /// somebody, and that is what marks it as theirs. Anything else the company sets, and keeps set.</para>
    /// </summary>
    private static void PlaceDriversOnTheGradeTheyHaveEarned(AppState s)
    {
        if (s.SchemaVersion >= 19) return;
        s.SchemaVersion = 19;

        var placed = 0;
        foreach (var d in s.HiredDrivers)
        {
            // Was this share chosen, or handed out? Two figures could have come from the company: the
            // old flat 0.30 everybody started on, and the level-derived share migration 17 applied.
            // Anything else, somebody typed.
            var offeredByLevel = Math.Round(Math.Clamp(0.25 + 0.0175 * Math.Max(0, d.Level - 1), 0.25, 0.40), 4);
            d.WageShareSetByHand =
                Math.Abs(d.WageShare - 0.30) > 0.0001 && Math.Abs(d.WageShare - offeredByLevel) > 0.0001;

            var earned = DriverRank.Earned(s, d);
            d.Grade = earned.Index;
            if (!d.WageShareSetByHand) d.WageShare = earned.Share;
            placed++;
        }

        if (placed == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message =
                $"{placed} hired driver(s) placed on the grade their record earns. A grade is time served, " +
                "miles run, the rating the game gives them and a clean recent record — not the ATS level, " +
                "which climbs on miles alone and made everybody senior inside a quarter. Every new hire " +
                "serves ninety days before any of it counts, and pay follows the rung. A share you set " +
                "yourself is yours and is left alone.",
        });
    }

    /// <summary>
    /// Ties conduct already on record to the driver it happened to.
    ///
    /// A conduct line carried a name and nothing else, which was enough to print it on the report it
    /// belonged to and useless for anything else — a driver's record could not be read back, because
    /// "every line that says Marcus" is a search, not a key. Two people sharing a name shared a record,
    /// and renaming somebody lost theirs.
    ///
    /// Backfills the id off the name where exactly one driver on the roster answers to it, and the report
    /// number and date off the report the line is sitting on. Where a name is ambiguous the line keeps
    /// the name alone and <see cref="DriverRank.ConductFor"/> falls back to matching on it — a worse
    /// answer than an id, and a better one than guessing which of two people it was.
    ///
    /// Nothing is invented and nothing is re-judged. This is the same history, addressable.
    /// </summary>
    private static void GiveConductLinesADriverAndADate(AppState s)
    {
        if (s.SchemaVersion >= 18) return;
        s.SchemaVersion = 18;

        // Every name on the roster, including people who have left: a line about somebody terminated two
        // reports ago is still their line, and dropping it would quietly rewrite what happened.
        var byName = s.HiredDrivers
            .Where(d => !string.IsNullOrWhiteSpace(d.Name))
            .GroupBy(d => d.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() == 1)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        foreach (var r in s.FleetReports)
            foreach (var c in r.Conduct)
            {
                if (string.IsNullOrWhiteSpace(c.ReportNumber)) c.ReportNumber = r.Number;
                if (string.IsNullOrWhiteSpace(c.GameTime)) c.GameTime = r.PeriodEndGame;
                if (!string.IsNullOrWhiteSpace(c.DriverId)) continue;
                if (!string.IsNullOrWhiteSpace(c.DriverName)
                    && byName.TryGetValue(c.DriverName.Trim(), out var id))
                    c.DriverId = id;
            }
    }

    /// <summary>
    /// Takes back a changeover settled on half the answers.
    ///
    /// The position questions came with a button on every row, so filing one filed one — and dispatch
    /// then settled the whole changeover on that single answer before it had heard about the other four
    /// boxes on the yard. Re-rendering afterwards cleared the rest of the form, so from the driver's seat
    /// the screen ate the question and produced a decision nobody had finished giving it.
    ///
    /// It is one form and one button now, and the decision is made once everything is in. This puts back
    /// the careers caught by the old shape: the promise goes, and so do the positions it was settled
    /// from, because a decision made on one row out of five is not a record worth keeping.
    /// </summary>
    private static void ReopenTheHalfAnsweredTrailerQuestion(AppState s)
    {
        if (s.SchemaVersion >= 16) return;
        s.SchemaVersion = 16;

        var cancelled = 0;
        foreach (var o in s.EquipmentOrders.Where(x => x.Status == "Open" && x.Kind == "TrailerSwap"))
        {
            o.Status = "Closed";
            o.CompletedGameTime = s.Status.GameTime;
            o.Notes = "Withdrawn: settled before all the trailer positions were in.";
            cancelled++;
        }

        var hadPromise = !string.IsNullOrWhiteSpace(s.Driver.ChangeoverUnit);
        s.Driver.ChangeoverUnit = "";
        s.Driver.ChangeoverType = "";
        s.Driver.ChangeoverReserve = false;
        s.Driver.ChangeoverGameTime = "";

        var yard = HomeTime.HomeTerminal(s);
        var wiped = 0;
        if (yard != null)
            foreach (var t in s.Trailers.Where(x => !x.Retired
                                                    && x.HomeTerminalId.Equals(yard.Id, StringComparison.OrdinalIgnoreCase)
                                                    && !string.IsNullOrWhiteSpace(x.Whereabouts)))
            {
                t.Whereabouts = "";
                t.WhereaboutsCity = "";
                t.WhereaboutsState = "";
                t.WhereaboutsGameTime = "";
                wiped++;
            }

        if (cancelled == 0 && !hadPromise && wiped == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message =
                "Trailer question reopened. It used to file one row at a time and decide off the first " +
                "one, so anything settled that way is off the record — " +
                (cancelled > 0 ? $"{cancelled} swap order(s) withdrawn, " : "") +
                (wiped > 0 ? $"{wiped} yard position(s) cleared. " : "") +
                "Next time you are told to head home, fill the whole form in and press the one button; I " +
                "will decide once I have the lot.",
        });
    }

    /// <summary>
    /// Takes back a trailer promise made before anybody was asked where the trailers were.
    ///
    /// The changeover used to pick a box from whatever was on file and hand it over — no question asked,
    /// and the file could be months stale or simply wrong. Reported from play: a trailer the app called
    /// parked at the yard while it was actually sitting in Grand Junction, a thousand miles away. The
    /// driver quite reasonably turned it down, and turning it down left the career with no trailer at all.
    ///
    /// The question is now asked at the moment the driver is told to head home, which is the only moment
    /// the answer is worth anything — early enough to go and mark a parked box as your own before setting
    /// off. But a career already carrying one of the old promises would never see it: an open swap order
    /// stops the next change being announced at all, and a remembered unit is handed over without asking.
    ///
    /// So both come off, and the positions they were chosen from go with them. Nothing is lost that was
    /// worth keeping — a guess nobody verified is not a record, and the driver is about to be asked
    /// properly. What they are PULLING is untouched; this only clears what they were promised next.
    /// </summary>
    private static void ReopenTheTrailerQuestionNobodyWasAsked(AppState s)
    {
        if (s.SchemaVersion >= 15) return;
        s.SchemaVersion = 15;

        var cancelled = 0;
        foreach (var o in s.EquipmentOrders.Where(x => x.Status == "Open" && x.Kind == "TrailerSwap"))
        {
            o.Status = "Closed";
            o.CompletedGameTime = s.Status.GameTime;
            o.Notes = "Withdrawn: issued before anybody was asked where the trailers were.";
            cancelled++;
        }

        var hadPromise = !string.IsNullOrWhiteSpace(s.Driver.ChangeoverUnit);
        s.Driver.ChangeoverUnit = "";
        s.Driver.ChangeoverType = "";
        s.Driver.ChangeoverReserve = false;
        s.Driver.ChangeoverGameTime = "";

        // And the positions those choices were made from. Only the home yard's boxes — those are the ones
        // the changeover asks about, and a position the driver reported about anything else is still
        // theirs and still true.
        var yard = HomeTime.HomeTerminal(s);
        var wiped = 0;
        if (yard != null)
            foreach (var t in s.Trailers.Where(x => !x.Retired
                                                    && x.HomeTerminalId.Equals(yard.Id, StringComparison.OrdinalIgnoreCase)
                                                    && !string.IsNullOrWhiteSpace(x.Whereabouts)))
            {
                t.Whereabouts = "";
                t.WhereaboutsCity = "";
                t.WhereaboutsState = "";
                t.WhereaboutsGameTime = "";
                wiped++;
            }

        if (cancelled == 0 && !hadPromise && wiped == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message =
                "Trailer changeover reopened. " +
                (cancelled > 0 ? $"{cancelled} swap order(s) withdrawn — they were raised before anybody " +
                                 "asked where the trailers were. " : "") +
                (hadPromise ? "The box you were promised next is off the record too. " : "") +
                (wiped > 0 ? $"{wiped} yard trailer position(s) cleared so they are asked fresh. " : "") +
                "You are still pulling whatever you are pulling. Next time you are told to head home I " +
                "will ask where the yard's boxes are and settle it then, while there is still a drive in " +
                "which to go and reserve one.",
        });
    }

    /// <summary>
    /// Puts the GDC service clocks back on a career that was switched onto the schedule before the
    /// switch worked.
    ///
    /// Turning the schedule on used to mark every recurring checkpoint done at the unit's current
    /// odometer — the argument being that nothing should be backdated into instant overdue. What it
    /// actually did was write a service on every tractor in the fleet that nobody had performed, and
    /// with the clocks reading zero miles since, the first fleet report found nothing due, serviced
    /// nothing, and left the old PM alerts standing over units it had just declined to touch.
    ///
    /// The clocks are re-seeded from <see cref="Truck.LastServiceMiles"/> — when each unit was last
    /// actually serviced, which the app has had all along. Work that was genuinely overdue when the
    /// setting was flipped is due again straight away rather than a period from now, which is the point:
    /// those miles were run, and the schedule change only decides how they are counted.
    /// </summary>
    private static void ReissueGdcServiceFromHistory(AppState s)
    {
        if (s.SchemaVersion >= 14) return;
        s.SchemaVersion = 14;
        if (!s.Settings.Maintenance.UseGdcSchedule) return;

        var owing = 0;
        var units = 0;
        foreach (var t in s.Trucks.Where(x => !x.Retired))
        {
            ServicePlan.SeedFromHistory(t, overwrite: true);
            units++;
            if (ServicePlan.DueNow(s, t).Count > 0) owing++;
        }
        if (units == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "maintenance",
            GameTime = s.Status.GameTime,
            Message = owing > 0
                ? $"Service schedule corrected. Switching onto the GDC intervals had marked every unit " +
                  $"freshly serviced; the clocks now run from each one's last real service, and {owing} of " +
                  $"{units} unit(s) owe work as of today. The yard does the hired units at the next fleet " +
                  "report — yours is on the Maintenance tab."
                : $"Service schedule corrected. The GDC clocks now run from each unit's last real service " +
                  $"rather than from the day the setting changed. None of the {units} unit(s) owes anything yet.",
        });
    }

    /// <summary>
    /// Clears out terminations the app left hanging on the player as a decision to make.
    ///
    /// A company driver does not decide who gets sacked. The company decides now and says which way it
    /// went; these are the ones raised before it did. Idempotent, and it touches nothing else — a driver
    /// already off the roster is left as they are.
    /// </summary>
    private static void ResolveTerminationsLeftToThePlayer(AppState s)
    {
        foreach (var line in FleetOpsService.ResolveHangingTerminations(s))
            s.Events.Insert(0, new LogEvent
            {
                Channel = "career",
                GameTime = s.Status.GameTime,
                Message = line,
            });
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
    /// <b>Retired.</b> Kept only to stamp schema 4 so nothing downstream re-runs.
    ///
    /// It put a driver back on probation where the Career tab's old button had cleared it the moment the
    /// loads/miles/on-time thresholds were met, without counting the three good reviews. Probation is a
    /// period now and the reviews inside it are feedback, so there is no streak left to have been short
    /// of — and reimposing one on a career that has since run months past the period it would set would
    /// be enforcing a rule the app no longer has.
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

        // ---- retired, deliberately, and kept only to stamp the schema.
        //
        // This put a driver back on probation when it had been cleared on thresholds alone without the
        // three good reviews. That rule is gone: probation is a period now, and the reviews inside it
        // are feedback. Restoring probation on a streak would enforce a rule the app no longer has,
        // against careers that have since run months of game time past the period it would impose.
        //
        // It briefly became a silent no-op on its own, when PassesFor stopped substituting the old
        // default of three and the guard `passes >= PassesFor(s)` turned always-true. Better said out
        // loud than left as an accident of arithmetic.
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

        // Yard trailer capacity used to be backfilled here, because an unset one read as zero and
        // refused every purchase. ATS has no per-garage trailer limit, so the field was retired and has
        // no readers left — writing it was only keeping an obsolete-member warning alive.
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

    /// <summary>
    /// Whether this yard exists in the driver's game, rather than only on the company's books.
    ///
    /// There is no flag for it and there should not be one — the app cannot see ATS. What it can see is
    /// whether anything the player has actually BOUGHT is based there: a garage nobody has purchased
    /// holds nothing, so a yard with no in-game unit on it is a yard that does not exist yet.
    ///
    /// It matters because both the trailer fleet and the on-road re-rig would otherwise send a driver
    /// to a garage that is not there, or buy equipment for one.
    /// </summary>
    public static bool Populated(AppState s, string terminalId) =>
        !string.IsNullOrWhiteSpace(terminalId)
        && (s.Trucks.Any(t => !t.Retired && t.InGameGarage && t.HomeTerminalId == terminalId)
            || s.Trailers.Any(t => !t.Retired && t.InGameGarage && t.HomeTerminalId == terminalId));

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
    /// <summary>
    /// Converts a probation running on "three good reviews in a row" to a period.
    ///
    /// The clock runs from where probation actually STARTED, not from today — a driver eighty days in
    /// has served eighty days, and restarting them would be the migration taking three months off
    /// somebody for the crime of updating the app.
    ///
    /// Reviews already filed stay as history. They were the gate; they are feedback now, and deleting
    /// them would lose a record the driver earned.
    /// </summary>
    private static void MoveProbationOffTheStreak(AppState s)
    {
        if (!s.Driver.Probation.Active) return;
        if (s.Driver.Probation.Attempt > 0 && s.Driver.Probation.DurationDays >= ProbationPlanner.RookieDays
            && s.Driver.Probation.PassesRequired == 0)
            return;                                    // already on the period model

        var plan = s.Driver.Probation;
        plan.Attempt = Math.Max(1, plan.Attempt);

        // Anything short of the standard period came off the old ternaries, which shortened the days
        // while leaving the passes at three. Put it back to a real period.
        if (plan.DurationDays < 30) plan.DurationDays = ProbationPlanner.RookieDays;

        // Scale the work requirements to the period, which the old model never did.
        plan.RequiredLoads = Math.Max(4, (int)Math.Round(plan.DurationDays / 7.0));
        plan.RequiredMiles = Math.Round(plan.DurationDays * 220.0, 0);

        // The streak is not the gate any more. Kept at zero rather than deleted so the field reads as
        // "not used" rather than as a requirement of three that nothing enforces.
        plan.PassesRequired = 0;

        if (string.IsNullOrWhiteSpace(plan.StartedGameDate))
            plan.StartedGameDate = string.IsNullOrWhiteSpace(s.Driver.HiredGameDate)
                ? s.Status.GameTime : s.Driver.HiredGameDate;

        var left = ProbationPlanner.DaysLeft(s);
        plan.Notes = $"{plan.DurationDays}-day probation, reviewed at your first home time after it ends.";

        s.Events.Insert(0, new LogEvent
        {
            Channel = "career",
            GameTime = s.Status.GameTime,
            Message = left is { } d && d <= 0
                ? $"Probation is a {plan.DurationDays}-day period now rather than a run of reviews, and yours is " +
                  "already served — the review that decides it happens at your next home time."
                : $"Probation is a {plan.DurationDays}-day period now rather than a run of reviews. " +
                  $"Yours started {GameClock.Pretty(plan.StartedGameDate)}, so there are about " +
                  $"{Math.Max(0, left ?? 0):0.#} day(s) left. The reviews you have already had stay on the record.",
        });
    }

    /// <summary>
    /// Strips linehaul from cancelled loads that were paid as though they ran.
    ///
    /// Cancelling called ComputeTripPay, which falls through to DispatchedMiles when there are no
    /// ActualMiles — so a cancelled load paid the full planned distance at the loaded rate. That money
    /// is sitting in UnsettledPay waiting to be handed over for real.
    ///
    /// Only unsettled trips are touched. A settlement already issued is the driver's pay history and
    /// not something to reach back into — see the same reasoning in Changeover.
    /// </summary>
    private static void TakeBackPayForLoadsNobodyHauled(AppState s)
    {
        var wrong = s.Trips
            .Where(t => t.Status == "Cancelled"
                        && string.IsNullOrWhiteSpace(t.SettlementNumber)
                        && (t.Pay.LinehaulPay > 0 || t.Pay.DeadheadPay > 0 || t.Pay.DivisionPremium > 0))
            .ToList();
        if (wrong.Count == 0) return;

        var taken = 0m;
        foreach (var t in wrong)
        {
            // The breakdown day stays: that one is real, and it is the only part that was.
            var keep = t.Pay.BreakdownPay;
            var had = t.Pay.Total;
            t.Pay = new PayBreakdown();
            if (keep > 0)
            {
                t.Pay.BreakdownPay = keep;
                t.Pay.Total = keep;
                t.Pay.Lines.Add($"Cancelled by the company — one day of breakdown/detention pay = ${keep:N2}.");
            }
            taken += had - t.Pay.Total;
        }

        s.Driver.UnsettledPay = Math.Round(Math.Max(0, s.Driver.UnsettledPay - taken), 2);
        s.Events.Insert(0, new LogEvent
        {
            Channel = "payroll",
            GameTime = s.Status.GameTime,
            Message = $"${taken:N2} taken back off {wrong.Count} cancelled load(s) — they were paid the full " +
                      "loaded rate for freight that was never hauled. Empty miles still come back on the " +
                      "next dispatch at the empty rate.",
        });
    }

    /// <summary>
    /// Takes the car carrier off the books, because there has never been one to take off them in game.
    ///
    /// ATS sells no auto transporter — ownable trailers arrived in 1.32 and that was not among them — so
    /// a career carrying one has a box on its fleet count and against its yard capacity that could not
    /// possibly exist in the driver's garage. Car hauling runs as the drop-and-hook arrangement instead,
    /// which is what it actually is: the shipper's transporter, on a market job.
    ///
    /// The driver is moved onto the arrangement if they were sitting on the phantom trailer, because
    /// leaving them assigned to a deleted unit is a hard dispatch blocker with no way out of it.
    /// </summary>
    private static void RetireTheCarHaulerNobodyCanBuy(AppState s)
    {
        var phantom = s.Trailers.Where(t => TrailerSpec.IsCarHauler(t.Type)).ToList();
        if (phantom.Count == 0) return;

        var wasMine = phantom.Any(t => t.Unit.Equals(s.Driver.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase));
        foreach (var t in phantom) s.Trailers.Remove(t);

        var slot = DropHook.Ensure(s, TrailerSpec.CarHauling);
        if (wasMine) s.Driver.AssignedTrailerUnit = slot.Unit;

        foreach (var d in s.HiredDrivers)
            if (phantom.Any(t => t.Unit.Equals(d.AssignedTrailerUnit, StringComparison.OrdinalIgnoreCase)))
                d.AssignedTrailerUnit = "";

        s.Events.Insert(0, new LogEvent
        {
            Channel = "fleet",
            GameTime = s.Status.GameTime,
            Message = $"{phantom.Count} car carrier(s) taken off the books — ATS sells no auto transporter, " +
                      "so that box was never something you could have bought. Car hauling runs off the " +
                      "freight market on the shipper's trailer, and the arrangement is on your fleet now.",
        });
    }

    /// <summary>
    /// Says which tank is on the yard.
    ///
    /// "Tanker" is five different trailers in ATS — fuel, gas, chemical, food-grade and dry bulk — and a
    /// yard stocked before this named none of them, so the driver was sent to a dealer to buy one of five
    /// things with no way to tell which. The subtype is filled in from the carrier's own freight, which
    /// is the same judgement the buying advice already made and just never wrote down.
    /// </summary>
    private static void NameTheTankOnTheYard(AppState s)
    {
        var bare = s.Trailers
            .Where(t => TrailerSpec.IsTanker(t.Type) && string.IsNullOrWhiteSpace(t.Subtype))
            .ToList();
        if (bare.Count == 0) return;

        var likely = TrailerSpec.LikelyFor(s);
        foreach (var t in bare) t.Subtype = likely.Key;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "fleet",
            GameTime = s.Status.GameTime,
            Message = $"{bare.Count} tanker(s) on the books said only \"tanker\", which is five different " +
                      $"trailers at the dealer. Recorded as {likely.Label} on {s.Company.Name}'s freight — " +
                      "change it on the Equipment tab if the one you actually bought is different.",
        });
    }

    /// <summary>
    /// Lifts the shipped fuel price to what diesel actually costs.
    ///
    /// The app was built around $4.05 a gallon and the pump is charging $6.29. Anybody running a real
    /// fuel-price mod — which is the whole point of reporting receipts — was paying the real figure at
    /// the pump and being costed against two-thirds of it: every load's margin read low, the break-even
    /// rate read low, and the driver was effectively punished for fuelling their own truck. Reported
    /// from play, and it is a correction rather than a preference, so it is applied rather than offered.
    ///
    /// <para><b>What is not touched.</b> Logged receipts are left exactly as they are. They are what the
    /// driver actually paid on a day that actually happened, they are the figures the per-state learning
    /// is built on, and rewriting them would replace a measurement with a guess. Only the app's own
    /// assumptions move.</para>
    ///
    /// <para><b>Where the line is drawn.</b> A stored price at or under the old $4.05 default is the
    /// app's stale guess being carried forward, so it is lifted. Anything above it, somebody typed while
    /// looking at their own game, and it is left alone — including on a career running an economy mod
    /// that really does sell fuel cheap. The lift is logged either way, with how to put it back, because
    /// a number changing underneath somebody's cost model is not something to do quietly.</para>
    /// </summary>
    private static void LiftFuelPricesToWhatDieselCosts(AppState s)
    {
        // Stamped, and it has to be. Almost everything else in this file fills in something missing and
        // is harmless to run twice; this one WRITES OVER a number the player is allowed to set. Left
        // ungated it would run on every load and pin the setting above $4.05 forever, so a career on an
        // economy mod that really does sell cheap diesel could never be told so. Once, then never again.
        if (s.SchemaVersion >= 20) return;
        s.SchemaVersion = 20;

        const decimal staleDefault = 4.05m;
        var was = s.Settings.FuelPricePerGal;
        var moved = false;

        if (was > 0 && was <= staleDefault)
        {
            s.Settings.FuelPricePerGal = Fuel.DefaultPricePerGal;
            moved = true;
        }

        // The yards bought on contract off the same stale pump price. Only the ones still sitting on a
        // shipped figure — a yard somebody has priced themselves is theirs.
        var oldContract = new[] { 3.58m, 3.72m, 3.85m };
        var yards = s.Company.Terminals
            .Where(t => t.HasFuel && oldContract.Contains(t.FuelPricePerGal))
            .ToList();
        foreach (var t in yards) t.FuelPricePerGal = Fuel.ContractPrice(t.Level);

        if (!moved && yards.Count == 0) return;

        var parts = new List<string>();
        if (moved) parts.Add($"${was:0.00} to ${s.Settings.FuelPricePerGal:0.00} a gallon");
        if (yards.Count > 0) parts.Add($"contract fuel at {yards.Count} yard(s) with it");

        s.Events.Insert(0, new LogEvent
        {
            Channel = "ledger",
            GameTime = s.Status.GameTime,
            Message =
                $"Fuel repriced — {string.Join(", and ", parts)} ({Fuel.PriceBasis}). The app had been " +
                "costing loads at a price nobody has paid in a long time, so if you fuel at what your " +
                "game charges, every margin it quoted you was low. Your own receipts are untouched and " +
                "still outrank this in any state you have fuelled in. Settings if your game is cheaper.",
        });
    }

    /// <summary>
    /// Re-grades the hired fleet now that rating is out of the ladder.
    ///
    /// <para>The gate used to be the driver's ATS rating, on thresholds of 6.0 / 7.0 / 8.0 / 8.5 / 9.0.
    /// Rating only takes thirteen values and none of those five is one of them, so every gate silently
    /// became the next reachable value up — 8.5 and 9.0 both became 9.2, which made Specialist and
    /// Master the same bar. Drivers were held against a number that was not the one written down, and
    /// on a measure that describes the player's training policy rather than anything the driver did.</para>
    ///
    /// <para>So everybody is re-settled against the level gates that replaced it. Reported from play:
    /// "in my game I have some drivers who would be off of probation if it were not for this rating
    /// gate." Settle only ever moves somebody to the rung their record earns, and leaves a hand-set
    /// wage share alone, so this can only correct — it cannot demote anybody onto a bar they already
    /// cleared.</para>
    /// </summary>
    private static void RegradeWithoutRating(AppState s)
    {
        if (s.SchemaVersion >= 21) return;
        s.SchemaVersion = 21;

        var moved = new List<string>();
        foreach (var d in s.HiredDrivers.Where(d => d.Status == "Active"))
        {
            var was = d.Grade;
            var now = DriverRank.Settle(s, d);
            if (now != null && now.Index != was)
                moved.Add($"{d.Name} to {now.Name.ToLowerInvariant()}");
        }

        if (moved.Count == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "fleet",
            GameTime = s.Status.GameTime,
            Message =
                $"Fleet re-graded — {string.Join(", ", moved)}. Driver rating is out of the promotion " +
                "ladder: in ATS it only measures how the skill points were spent, so it said more about " +
                "how you had trained somebody than about them, and its gates were set at figures the " +
                "game never actually shows. Level is the gate now.",
        });
    }

    /// <summary>
    /// Moves the hired fleet's stored figures onto the name that describes them.
    ///
    /// <para>The app took ATS's $/mile for a hired driver as gross revenue. It is profit — the game pays
    /// the driver, the fuel and the tolls out of the job before it prints that figure — so the company's
    /// NET was sitting in its revenue line, and the app then worked out a wage share and deducted it
    /// again. The driver was paid twice: once by the game, once in the books.</para>
    ///
    /// <para>The values themselves were always contribution, so they carry across unchanged. What goes
    /// is the wage that was invented on top: it was never money that moved in the game, and leaving it
    /// on the record would keep it in the lifetime totals. Reported from play.</para>
    /// </summary>
    private static void CallFleetTakingsWhatTheyAre(AppState s)
    {
        if (s.SchemaVersion >= 22) return;
        s.SchemaVersion = 22;

#pragma warning disable CS0618 // reading the superseded fields is the point of the migration
        var wages = 0m;
        foreach (var d in s.HiredDrivers)
        {
            if (d.LifetimeContribution == 0 && d.LifetimeRevenue != 0) d.LifetimeContribution = d.LifetimeRevenue;
            wages += d.LifetimeWages;
            d.LifetimeWages = 0;

            foreach (var p in d.Periods)
            {
                if (p.Contribution == 0 && p.Revenue != 0) p.Contribution = p.Revenue;
                p.Wages = 0;
            }
        }

        foreach (var r in s.FleetReports)
        {
            if (r.TotalContribution == 0 && r.TotalRevenue != 0) r.TotalContribution = r.TotalRevenue;
            r.TotalWages = 0;
            foreach (var line in r.Lines)
                if (line.Contribution == 0 && line.Revenue != 0) line.Contribution = line.Revenue;

            // The figure the company expands and retrenches on. It used to subtract a wage that was
            // never paid out of a revenue that was already net.
            r.NetContribution = Math.Round(r.TotalContribution - r.TotalRepairs - r.TotalCapital, 2);
        }
#pragma warning restore CS0618

        if (wages <= 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "ledger",
            GameTime = s.Status.GameTime,
            Message =
                $"Fleet wages written off the books — ${wages:N0} of them. ATS pays hired drivers out of " +
                "the job before it shows you their $/mile, so that figure was already net and the app was " +
                "deducting a second wage from it. What they bring in is contribution now, and the rung's " +
                "share says what somebody is worth rather than moving money.",
        });
    }

    /// <summary>
    /// Closes trailer-swap orders whose box has already left the fleet.
    ///
    /// <para>Reported from play: a tanker retired by hand, and the app still asking for the swap. The
    /// order could not be cleared either — closing one goes looking for a replacement to hook and threw
    /// when it found none — so it sat there blocking the single open-order slot, which is the slot the
    /// next tractor or box the company wants has to come through.</para>
    ///
    /// <para>Only where the subject is genuinely gone: off the books entirely, or retired. An order
    /// against a trailer still standing is a live instruction and is left alone. If the company still
    /// wants a box it raises the ask again on the next report, priced and reasoned afresh.</para>
    /// </summary>
    private static void CloseOrdersForTrailersAlreadyGone(AppState s)
    {
        // A box is "gone" if it is off the books entirely or retired. Both happen: the Equipment tab
        // deletes, the fleet report retires, and a player clearing up does whichever is nearest.
        bool Gone(string unit) =>
            !string.IsNullOrWhiteSpace(unit)
            && s.Trailers.FirstOrDefault(t => t.Unit.Equals(unit, StringComparison.OrdinalIgnoreCase))
               is not { Retired: false };

        var cleared = new List<string>();

        // 1. Equipment orders — the fortnightly "replace this box" ask. These hold the single open-order
        //    slot, so one left dangling shuts the queue for tractors as well as trailers.
        foreach (var o in s.EquipmentOrders.Where(o => o.Status == "Open" && o.Kind == "TrailerSwap"))
        {
            if (!Gone(o.FromTrailerUnit) && !Gone(o.ToTrailerUnit)) continue;
            o.Status = "Completed";
            o.CompletedGameTime = s.Status.GameTime;
            o.Notes = (o.Notes + " Closed automatically — the trailer had already left the fleet.").Trim();
            cleared.Add($"{o.Number} on {(Gone(o.FromTrailerUnit) ? o.FromTrailerUnit : o.ToTrailerUnit)}");
        }

        // 2. Re-rigs on the road — a different record entirely, and the one that actually puts a prompt
        //    in front of the driver mid-tour. Told to drop or collect a box that no longer exists, the
        //    only honest answer is to call it off.
        foreach (var o in s.TrailerSwaps.Where(o => o.Status is "Open" or "Waiting"))
        {
            if (!Gone(o.DropUnit) && !Gone(o.TakeUnit)) continue;
            o.Status = "Cancelled";
            o.ResolvedGameTime = s.Status.GameTime;
            cleared.Add($"{o.Number} on {(Gone(o.TakeUnit) ? o.TakeUnit : o.DropUnit)}");
        }

        // 3. The promise made at a drop, a tour ahead of the box being hooked. Left pointing at nothing,
        //    the changeover planner keeps naming a trailer that is not there.
        if (Gone(s.Driver.ChangeoverUnit))
        {
            cleared.Add($"the promise of {s.Driver.ChangeoverUnit}");
            TrailerChangeover.Forget(s);
        }

        // 4. Anybody still hooked to it on the books. Dispatch plans freight onto an assigned trailer, so
        //    a driver pointed at a box that is gone is a load waiting to fail.
        if (Gone(s.Driver.AssignedTrailerUnit))
        {
            cleared.Add($"you were still shown on {s.Driver.AssignedTrailerUnit}");
            s.Driver.AssignedTrailerUnit = "";
        }
        foreach (var d in s.HiredDrivers.Where(d => Gone(d.AssignedTrailerUnit)))
        {
            cleared.Add($"{d.Name} was still shown on {d.AssignedTrailerUnit}");
            d.AssignedTrailerUnit = "";
        }

        if (cleared.Count == 0) return;

        s.Events.Insert(0, new LogEvent
        {
            Channel = "maintenance",
            GameTime = s.Status.GameTime,
            Message =
                $"Cleared {cleared.Count} reference(s) to trailers that are no longer on the fleet — " +
                string.Join("; ", cleared) + ". A box taken off the books by hand left orders and " +
                "promises pointing at nothing, which is where the \"not in the fleet\" errors were coming " +
                "from. Anything the company still wants it will ask for again on the next report.",
        });
    }

    /// <summary>Tractor slots a yard tier holds, without having to build one to find out.</summary>
    public static int CapacityOf(string level) => level switch
    {
        "Large" => 5,
        "Medium" => 3,
        _ => 1,
    };

    public static void ApplyLevel(Terminal t, string level)
    {
        t.Level = level;
        switch (level)
        {
            case "Large":
                t.TruckCapacity = 5;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = true;
                t.FuelPricePerGal = Fuel.ContractPrice("Large"); t.ShopLabourDiscount = 0.35; t.MonthlyCost = 4_200m;
                break;
            case "Medium":
                t.TruckCapacity = 3;
                t.HasFuel = true; t.HasShop = true; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = Fuel.ContractPrice("Medium"); t.ShopLabourDiscount = 0.20; t.MonthlyCost = 2_400m;
                break;
            default:
                t.Level = "Small";
                t.TruckCapacity = 1;
                t.HasFuel = true; t.HasShop = false; t.HasParking = true;
                t.HasTrailerDrop = true; t.HasDriverFacilities = false;
                t.FuelPricePerGal = Fuel.ContractPrice("Small"); t.ShopLabourDiscount = 0; t.MonthlyCost = 1_150m;
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
