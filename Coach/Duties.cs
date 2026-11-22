using TruckSimDispatcher.Services;

namespace TruckSimCoach;

public class CloseRequest
{
    public int? Day { get; set; }
    public string? Time { get; set; }
    /// <summary>The game's end-of-trip figures, where they were not entered at the last stop.</summary>
    public double? SatisfactionPct { get; set; }
    public int? VeryHappy { get; set; }
    public int? Happy { get; set; }
    public int? Unhappy { get; set; }
    public int? VeryUnhappy { get; set; }
    /// <summary>Driver (the default), Road, Game or Coach: whose doing any lateness was.</summary>
    public string? Fault { get; set; }
    public string? DelayReason { get; set; }
    /// <summary>The coach's damage as the game shows it at the end of the duty. Required: it is read after every run.</summary>
    public double? Damage { get; set; }
    /// <summary>Driver (the default), Other (another road user) or Game: whose doing any new damage was.</summary>
    public string? DamageCause { get; set; }
}

/// <summary>
/// A duty from the company's assignment to the close-out: the book-on, each stop's arrival and departure with the
/// passengers on and off and their satisfaction, the co-driver's legs on a night line, and the close-out that grades
/// it, pays it and says what it meant.
/// </summary>
public static class Duties
{
    public static Duty? Current(CoachCareer c) => c.Duties.LastOrDefault(d => d.Status is "Assigned" or "Running");

    public static DateTime Moment(CoachCareer c, int? day, string? time)
    {
        if (day is > 0 && GameClock.FromDayTime(day.Value, time) is { } t) return t;
        return GameClock.TryParse(c.GameTime) ?? throw new InvalidOperationException("The game clock is not set.");
    }

    /// <summary>The clock moves forward only. A time before the last one entered is a typo.</summary>
    static void MoveTo(CoachCareer c, DateTime at)
    {
        if (GameClock.TryParse(c.GameTime) is { } now && at < now.AddMinutes(-1))
            throw new InvalidOperationException($"That is before {GameClock.Pretty(now)}, the last time entered. Check the day and the time.");
        c.GameTime = GameClock.Format(at);
    }

    static void Require(CoachCareer c)
    {
        if (!c.Started) throw new InvalidOperationException("Fill in the first screen first.");
        if (c.Job.Status != "Active") throw new InvalidOperationException("You are not with a company. Join one on the Career tab.");
    }

    /// <summary>
    /// Time off between duties, as the clock moved over it: a break, a daily rest or a weekly one. A night's rest away
    /// from home earns the night allowance, in a hotel or in an opened depot's rest room.
    /// </summary>
    public static string? Rest(CoachCareer c, DateTime from, DateTime to)
    {
        if (to <= from) return null;
        var kind = Hours.Off(c, from, to, Lines.Place(c.City, c.Cc));
        if (kind is "Daily" or "Weekly" && c.Started && c.Job.Status == "Active" && !Depots.IsHome(c, c.City, c.Cc))
        {
            var depot = c.Depots.FirstOrDefault(d => d.Opened && Companies.SamePlace(d.City, d.Cc, c.City, c.Cc));
            c.Pay.Pending.Add(new PayLine { GameTime = GameClock.Format(to), Kind = "Night away", Amount = CoachPay.NightAway,
                Text = $"Night allowance: {(kind == "Weekly" ? "a weekly rest" : "a night")} away from home in {c.City}" +
                       (depot != null ? ", in the depot rest room" : ", in a hotel the company paid") });
        }
        return kind;
    }

    /// <summary>The clock moved on with no duty running: rest, and nothing else.</summary>
    public static string Clock(CoachCareer c, DateTime at)
    {
        if (Current(c) is { Status: "Running" }) throw new InvalidOperationException("A duty is running: log its stops instead.");
        var from = GameClock.TryParse(c.GameTime) ?? at;
        MoveTo(c, at);
        var kind = Rest(c, from, at);
        return kind switch
        {
            "Weekly" => $"Weekly rest taken: {Hhmm.Of((at - from).TotalHours)} off.",
            "Daily" => $"Daily rest taken: {Hhmm.Of((at - from).TotalHours)} off.",
            "Break" => $"A break of {Hhmm.Of((at - from).TotalHours)}.",
            _ => "Clock moved on.",
        };
    }

    /// <summary>Driving the coach empty to where the work is: driving on the clocks, paid at the plain rate.</summary>
    public static string Position(CoachCareer c, string city, string cc, DateTime departs, DateTime arrives, double? damage = null, string? cause = null)
    {
        Require(c);
        if (Current(c) is { Status: "Running" }) throw new InvalidOperationException("A duty is running.");
        if (arrives <= departs) throw new InvalidOperationException("The arrival must be after the departure.");
        if (damage == null && c.Job.CoachBought)
            throw new InvalidOperationException("Enter the coach's damage as the game shows it at the end of the run (0 if there is none). It is read after every run.");
        if (c.Job.CoachBought && GameClock.TryParse(c.Coach.InShopUntil) is { } inShop && inShop > departs)
            throw new InvalidOperationException($"The coach is in the shop until {GameClock.Pretty(inShop)}.");
        var (toCity, toCc) = Lines.Normalise(city, cc);
        var from = GameClock.TryParse(c.GameTime) ?? departs;
        MoveTo(c, departs);
        Rest(c, from, departs);
        var broke = Hours.Drive(c, departs, arrives);
        var hours = (arrives - departs).TotalHours + (Assign.PreTripMinutes + Assign.PostTripMinutes) / 60.0;
        CoachPay.Positioning(c, hours, $"Positioning, {c.City} to {toCity}");
        var fromPlace = Lines.Place(c.City, c.Cc);
        var km = Lines.Km(c.City, c.Cc, toCity, toCc);
        c.City = toCity;
        c.Cc = toCc;
        c.GameTime = GameClock.Format(arrives);
        var depot = Depots.Arrive(c, toCity, toCc);
        CoachStore.Log(c, "duty", $"Positioned empty from {fromPlace} to {Lines.Place(toCity, toCc)}.");
        var coach = new List<string>();
        if (c.Job.CoachBought)
        {
            var e = Maintenance.Reading(c, damage, cause, km, "Empty run");
            if (e.Incurred >= c.Settings.Maintenance.NoiseFloorPct)
                coach.Add($"The coach took {e.Incurred:0.#}% on the way ({Maintenance.CauseWord(e.Cause)}).");
            if (e.Cause == "Driver") coach.AddRange(Grading.EmptyRunDamage(c, e));
            if (e.Note.Length > 0) coach.Add(e.Note);
            var o = Maintenance.Assess(c);
            if (o.Band != "Fine") coach.Add(o.Headline);
        }
        return $"Positioned to {toCity}." + (broke.Count > 0 ? " " + string.Join(" ", broke) : "") + (depot != null ? " " + depot : "")
               + (coach.Count > 0 ? " " + string.Join(" ", coach) : "");
    }

    /// <summary>Take the company's assignment off the board.</summary>
    public static Duty Accept(CoachCareer c, string offerId, List<StopInput>? between = null)
    {
        Require(c);
        if (!c.Job.CoachBought)
            throw new InvalidOperationException($"Buy the {c.Job.CoachModel} in the game first (Contract Jobs need a coach of your own), then confirm it on the Today tab.");
        if (Current(c) is { } open) throw new InvalidOperationException($"{open.Number} is still open. Finish it or hand it back first.");
        var judged = Assign.Judge(c);
        var choice = judged.FirstOrDefault(x => x.Offer.Id == offerId) ?? throw new InvalidOperationException("That job is not on the board.");
        if (choice.Why.Count > 0) throw new InvalidOperationException($"Not for you: {string.Join(" ", choice.Why)}");
        var pick = judged.First(x => x.Why.Count == 0);
        if (pick.Offer.Id != offerId)
            throw new InvalidOperationException($"The company has given you the {pick.Line.From.Time} {(pick.Line.Kind == "Tourist" ? pick.Line.Landmark : "to " + pick.Line.To.City)}, not this one.");
        // The menu counted the stops but named only the ends: the cities between come off the game's route, once, and the
        // library keeps them from then on.
        var plan = choice.Plan!;
        if (choice.Line.UnknownStops > 0)
        {
            Lines.FillStops(c, choice.Line, between ?? new());
            plan = Assign.Plan(c, choice.Line, choice.Plan!.Departs);
        }
        var d = Create(c, choice.Line, plan, choice.Offer.Passengers > 0 ? choice.Offer.Passengers : choice.Line.Passengers,
                       string.Join(" ", choice.Reasons));
        c.Board.Clear();
        return d;
    }

    static Duty Create(CoachCareer c, Line l, DutyPlan p, int passengers, string why, string kind = "")
    {
        var d = new Duty
        {
            Number = $"D-{c.NextDutyNumber++:000}",
            LineId = l.Id,
            Kind = kind == "" ? l.Kind : kind,
            Title = l.Kind == "Tourist"
                ? $"{l.Landmark} from {l.From.City}"
                : $"{l.From.City} {l.From.Time} to {l.To.City}" + (l.Stops.Count > 2 ? $", {l.Stops.Count - 2} stop{(l.Stops.Count > 3 ? "s" : "")} between" : ""),
            Landmark = l.Landmark,
            CompanyId = c.Job.CompanyId,
            CoachModel = c.Job.CoachModel,
            RankAtTheTime = c.Job.Rank,
            Crew = p.Crew,
            BookOn = GameClock.Format(p.BookOn),
            BookOff = GameClock.Format(p.BookOff),
            Stops = p.Stops,
            Km = l.Km,
            Passengers = passengers,
            Why = why,
        };
        c.Duties.Add(d);
        CoachStore.Log(c, "duty", $"{d.Number} assigned: {d.Title}. Book on {GameClock.Pretty(p.BookOn)}.");
        return d;
    }

    /// <summary>A tour stage with no line for it: the group driven to the day's city.</summary>
    public static Duty TourLeg(CoachCareer c, DateTime departs)
    {
        Require(c);
        if (Current(c) is { } open) throw new InvalidOperationException($"{open.Number} is still open.");
        var l = Tours.LegLine(c, departs);
        var p = Assign.Plan(c, l, departs);
        return Create(c, l, p, c.Tour!.Passengers, "Today's tour stage.", "TourLeg");
    }

    /// <summary>
    /// Hand back an assignment not yet started (the job went from the game's menu), or give up a duty under way that the
    /// game lost: a crash, a reload, the job dropped. Nothing goes on the record either way. A duty under way was work done,
    /// though: the time from book-on to when it was lost is paid at the plain rate, the leg being driven counts as driving,
    /// and the coach's damage is read, as after any run. The coach is where the game left it; position it from there.
    /// </summary>
    public static string HandBack(CoachCareer c, string? why, int? day = null, string? time = null, double? damage = null, string? cause = null)
    {
        Require(c);
        var d = Current(c) ?? throw new InvalidOperationException("No duty to hand back.");
        if (d.Status != "Running")
        {
            d.Status = "Cancelled";
            d.ClosedGameTime = c.GameTime;
            CoachStore.Log(c, "duty", $"{d.Number} handed back{(string.IsNullOrWhiteSpace(why) ? "" : ": " + why)}.");
            return $"{d.Number} handed back. Nothing goes on your record.";
        }

        // Everything checked before anything changes: a refusal must leave the duty as it was.
        if (c.Job.CoachBought && damage is not (>= 0 and <= 100))
            throw new InvalidOperationException("Enter the coach's damage as the game shows it now (0 if there is none). It is read after every run.");
        var lostAt = Moment(c, day, time);
        if (GameClock.TryParse(c.GameTime) is { } last && lostAt < last.AddMinutes(-1))
            throw new InvalidOperationException($"That is before {GameClock.Pretty(last)}, the last time entered. Check the day and the time.");
        var said = new List<string>();
        // The leg on the road when it was lost: driven up to then, by whoever had it.
        var onRoad = d.Stops.Select((s, i) => (s, i)).LastOrDefault(x => x.s.DepartedAt.Length > 0);
        if (onRoad.s != null && onRoad.i < d.Stops.Count - 1 && d.Stops[onRoad.i + 1].ArrivedAt.Length == 0
            && GameClock.TryParse(onRoad.s.DepartedAt) is { } left && lostAt > left)
        {
            MoveTo(c, lostAt);
            if (onRoad.s.LegDriver == "You") d.HoursFindings.AddRange(Hours.Drive(c, left, lostAt));
            else Hours.Off(c, left, lostAt, "riding as co-driver");
        }
        else MoveTo(c, lostAt);

        if (c.Job.CoachBought)
        {
            var km = d.Stops.Where((s, i) => i < d.Stops.Count - 1 && d.Stops[i + 1].ArrivedAt.Length > 0).Sum(s => s.LegKm);
            var e = Maintenance.Reading(c, damage, cause, km, d.Number);
            d.DamageBefore = e.Before; d.DamageAfter = e.After; d.DamageIncurred = e.Incurred; d.DamageCause = e.Cause; d.DamageSeverity = e.Severity;
            if (e.Incurred >= c.Settings.Maintenance.NoiseFloorPct) said.Add($"The coach took {e.Incurred:0.#}% ({Maintenance.CauseWord(e.Cause)}).");
            // The game losing the job is not the driver's doing; damage they did on the way still is.
            if (e.Cause == "Driver") said.AddRange(Grading.EmptyRunDamage(c, e));
        }

        var bookOn = (GameClock.TryParse(d.Stops[0].DepartedAt) ?? lostAt).AddMinutes(-Assign.PreTripMinutes);
        var hours = Math.Max(0, (lostAt - bookOn).TotalHours);
        if (hours > 0) d.Pay = CoachPay.Positioning(c, hours, $"{d.Number}, worked until the game lost it").Amount;
        d.Status = "Cancelled";
        d.Grade = "";
        d.BookOn = GameClock.Format(bookOn);
        d.BookOff = GameClock.Format(lostAt);
        d.ClosedGameTime = GameClock.Format(lostAt);
        d.DelayReason = (why ?? "").Trim();
        CoachStore.Log(c, "duty", $"{d.Number} lost by the game at {GameClock.Pretty(lostAt)}: given up with nothing on the record.");
        said.Insert(0, $"{d.Number} given up: the game lost it. Nothing goes on your record, and the {Hhmm.Of(hours)} you worked is paid.");
        said.Add($"The coach is where the game left it, last at {Lines.Place(c.City, c.Cc)} on the app's books: log a positioning run from there to where you are, or to the next job.");
        if (Maintenance.Assess(c) is { Band: not "Fine" } o) said.Add(o.Headline);
        return string.Join(" ", said);
    }

    static Duty Running(CoachCareer c)
    {
        Require(c);
        return Current(c) ?? throw new InvalidOperationException("No duty is assigned. Take one from the board first.");
    }

    /// <summary>Leaving a stop: the departure time and the passengers who boarded.</summary>
    public static string Depart(CoachCareer c, int index, DateTime at, int? boarded)
    {
        var d = Running(c);
        if (index < 0 || index >= d.Stops.Count - 1) throw new InvalidOperationException("That stop has no departure.");
        var s = d.Stops[index];
        if (index > 0 && GameClock.TryParse(s.ArrivedAt) is not { } arrived)
            throw new InvalidOperationException($"Log the arrival at {s.City} first.");
        // The load changes at every stop: who boarded here is part of the stop, as who got off is.
        if (boarded == null && d.Kind != "TourLeg")
            throw new InvalidOperationException($"How many passengers boarded at {s.City}? 0 if nobody did.");
        if (index == 0 && d.Status == "Assigned")
        {
            var from = GameClock.TryParse(c.GameTime) ?? at;
            var bookOn = at.AddMinutes(-Assign.PreTripMinutes);
            if (bookOn > from) Rest(c, from, bookOn);
            d.Status = "Running";
            c.Hours.MultiManned = d.Crew == "Double";
        }
        else if (index > 0)
        {
            // Standing at the stop is a break toward the 45 minutes, where it is long enough.
            Hours.Off(c, GameClock.TryParse(s.ArrivedAt)!.Value, at, s.City);
        }
        MoveTo(c, at);
        s.DepartedAt = GameClock.Format(at);
        if (boarded is { } b) s.Boarded = Math.Max(0, b);
        if (index == 0 && d.Passengers == 0 && s.Boarded > 0) d.Passengers = s.Boarded;
        var sched = GameClock.TryParse(s.ScheduledDepart);
        var early = sched is { } sd && (at - sd).TotalMinutes < -Grading.EarlyGraceMinutes;
        return early
            ? $"Left {s.City} {Math.Round((sched!.Value - at).TotalMinutes)} minutes early. Passengers who came for the timetable were left behind: that is worse than being late."
            : $"Left {s.City} at {at:HH:mm}." + (s.LegDriver == "Co-driver" ? " Your co-driver has this leg." : "");
    }

    /// <summary>Reaching a stop: the arrival time, the passengers off, and what the game shows for their satisfaction.</summary>
    public static string Arrive(CoachCareer c, int index, DateTime at, int? alighted, double? pct, int? vh, int? h, int? u, int? vu,
                                int? breakMinutes = null, DateTime? handover = null)
    {
        var d = Running(c);
        if (d.Status != "Running") throw new InvalidOperationException("Log the departure from the first stop first.");
        if (index < 1 || index >= d.Stops.Count) throw new InvalidOperationException("That stop has no arrival.");
        var prev = d.Stops[index - 1];
        if (GameClock.TryParse(prev.DepartedAt) is not { } left) throw new InvalidOperationException($"Log the departure from {prev.City} first.");
        if (at < left) throw new InvalidOperationException($"The arrival is before you left {prev.City}.");
        var s = d.Stops[index];
        // Every stop is judged as an end: the passengers who get off there give their verdict there. So every arrival needs
        // what the game shows for them. A tour stage driven with the group is the exception: the game has no passengers on it.
        if (d.Kind != "TourLeg" && (pct == null || vh == null || h == null || u == null || vu == null))
            throw new InvalidOperationException($"At {s.City}, enter what the game shows for the passengers: the satisfaction % and all four counts (0 where a group is empty).");
        var aboard = OnBoard(d, index);
        if (d.Kind != "TourLeg")
        {
            if (alighted == null)
                throw new InvalidOperationException(index == d.Stops.Count - 1
                    ? $"How many got off at {s.City}? Everyone still aboard does at the end: {aboard}."
                    : $"How many passengers got off at {s.City}? 0 if nobody did.");
            if (alighted > aboard)
                throw new InvalidOperationException($"{alighted} off at {s.City}, but only {aboard} were aboard. Check the counts at the stops before.");
        }
        var said = new List<string>();
        var brk = Math.Clamp(breakMinutes ?? 0, 0, (int)(at - left).TotalMinutes);
        prev.BreakMinutes = brk;
        if (handover is { } swap)
        {
            // Two drivers, changing over partway: each drives their side of the handover, and riding is a break.
            if (d.Crew != "Double") throw new InvalidOperationException("Only a duty with two drivers can hand over on the road.");
            if (swap <= left || swap >= at) throw new InvalidOperationException($"The handover has to be after you left {prev.City} and before you reached {s.City}.");
            prev.HandoverAt = GameClock.Format(swap);
            var broke = new List<string>();
            if (prev.LegDriver == "You") { broke.AddRange(Hours.Drive(c, left, swap)); Hours.Off(c, swap, at, "riding as co-driver"); }
            else { Hours.Off(c, left, swap, "riding as co-driver"); broke.AddRange(Hours.Drive(c, swap, at)); }
            d.HoursFindings.AddRange(broke);
            said.AddRange(broke);
            said.Add(prev.LegDriver == "You" ? $"Handed over to the co-driver at {swap:HH:mm}." : $"Took over from the co-driver at {swap:HH:mm}.");
        }
        else if (prev.LegDriver == "You")
        {
            // A break on the way: driving to the middle of the leg, the break, driving on.
            var driving = (at - left).TotalMinutes - brk;
            var mid = left.AddMinutes(driving / 2);
            var broke = brk > 0
                ? Hours.Drive(c, left, mid).Concat(BreakAndOn(c, mid, brk, at)).ToList()
                : Hours.Drive(c, left, at);
            d.HoursFindings.AddRange(broke.Distinct());
            said.AddRange(broke.Distinct());
        }
        else Hours.Off(c, left, at, "riding as co-driver");   // a break may be taken while the other driver drives
        if (handover == null) prev.HandoverAt = "";
        MoveTo(c, at);
        s.ArrivedAt = GameClock.Format(at);
        if (alighted is { } a) s.Alighted = Math.Max(0, a);
        if (pct is { } p)
        {
            s.SatisfactionPct = Math.Clamp(p, 0, 100);
            s.VeryHappy = Math.Max(0, vh ?? 0); s.Happy = Math.Max(0, h ?? 0);
            s.Unhappy = Math.Max(0, u ?? 0); s.VeryUnhappy = Math.Max(0, vu ?? 0);
        }
        c.City = s.City;
        c.Cc = s.Cc;
        if (Depots.Arrive(c, s.City, s.Cc) is { } depot) said.Add(depot);
        if (GameClock.TryParse(s.ScheduledArrive) is { } sa)
        {
            var late = (at - sa).TotalMinutes;
            said.Insert(0, late > Grading.OnTimeMinutes ? $"{s.City}: {Math.Round(late)} minutes late." : $"{s.City}: on time.");
        }
        return string.Join(" ", said);
    }

    static List<string> BreakAndOn(CoachCareer c, DateTime from, int minutes, DateTime arrive)
    {
        var back = from.AddMinutes(minutes);
        Hours.Off(c, from, back, "on the road");
        return Hours.Drive(c, back, arrive);
    }

    /// <summary>The co-driver takes over (or hands back) from this stop: the leg from it changes hands.</summary>
    public static string Swap(CoachCareer c, int index)
    {
        var d = Running(c);
        if (d.Crew != "Double") throw new InvalidOperationException("This duty has no co-driver.");
        if (index < 0 || index >= d.Stops.Count - 1) throw new InvalidOperationException("No leg leaves from there.");
        var s = d.Stops[index];
        if (!string.IsNullOrEmpty(s.DepartedAt)) throw new InvalidOperationException("That leg is driven already.");
        s.LegDriver = s.LegDriver == "You" ? "Co-driver" : "You";
        return s.LegDriver == "You" ? $"You drive from {s.City}." : $"Your co-driver drives from {s.City}. In the game you still drive it; the hours are theirs.";
    }

    /// <summary>
    /// The close-out: the last arrival, the passengers' final verdict, whose fault any lateness was; then the grade, the
    /// pay, the record, and where the driver stands.
    /// </summary>
    public static object Close(CoachCareer c, CloseRequest r)
    {
        var d = Running(c);
        if (d.Status != "Running") throw new InvalidOperationException("The duty has not started.");
        var last = d.Stops[^1];
        if (string.IsNullOrEmpty(last.ArrivedAt))
        {
            if (r.Day == null) throw new InvalidOperationException($"Log the arrival at {last.City}, or give the time you got there.");
            Arrive(c, d.Stops.Count - 1, Moment(c, r.Day, r.Time), null, r.SatisfactionPct, r.VeryHappy, r.Happy, r.Unhappy, r.VeryUnhappy);
        }
        else if (r.SatisfactionPct is { } fp)
        {
            last.SatisfactionPct = Math.Clamp(fp, 0, 100);
            last.VeryHappy = r.VeryHappy ?? last.VeryHappy; last.Happy = r.Happy ?? last.Happy;
            last.Unhappy = r.Unhappy ?? last.Unhappy; last.VeryUnhappy = r.VeryUnhappy ?? last.VeryUnhappy;
        }

        var notes = new List<string>();
        var (pct, index, complaints, worstStop) = Grading.Satisfaction(d);
        if (!d.Stops.Any(s => s.SatisfactionPct != null))
        {
            if (d.Kind != "TourLeg") throw new InvalidOperationException("Enter the passengers' satisfaction from the game's end-of-trip summary: the % and the four counts.");
            // A tour stage driven with nobody aboard in the game: the group's mood carries from the tour so far.
            var tourDuties = c.Duties.Where(x => x.Status == "Done" && x.TourId == c.Tour?.Id).ToList();
            pct = tourDuties.Count > 0 ? tourDuties.Average(x => x.FinalSatisfaction) : 80;
            notes.Add("No satisfaction reading on this stage: the group's mood is carried over from the tour so far.");
        }

        // The coach, read after every run: what this duty did to it, and whose doing.
        d.DamageBefore = c.Coach.DamagePct;
        var reading = Maintenance.Reading(c, r.Damage, r.DamageCause, d.Km, d.Number);
        d.DamageAfter = reading.After;
        d.DamageIncurred = reading.Incurred;
        d.DamageCause = reading.Cause;
        d.DamageSeverity = reading.Severity;
        if (reading.Note.Length > 0) notes.Add(reading.Note);

        d.Fault = r.Fault is "Road" or "Game" or "Coach" ? r.Fault : "Driver";
        d.DelayReason = (r.DelayReason ?? "").Trim();
        var timings = Grading.Timings(d);
        d.LateStops = timings.Count(t => t.Status == "Late");
        d.VeryLateStops = timings.Count(t => t.Status == "VeryLate");
        d.EarlyDepartures = timings.Count(t => t.Status == "EarlyDeparture");
        d.PunctualityPct = timings.Count == 0 ? 100 : Math.Round(100.0 * timings.Count(t => t.Status == "OnTime") / timings.Count, 1);
        d.FinalSatisfaction = Math.Round(pct, 1);
        d.WorstSatisfaction = worstStop?.SatisfactionPct ?? pct;
        d.WorstStop = worstStop?.City ?? "";
        d.CategoryIndex = index;
        d.Complaints = complaints;
        d.Grade = Grading.Grade(d);

        var bookOn = GameClock.TryParse(d.Stops[0].DepartedAt)!.Value.AddMinutes(-Assign.PreTripMinutes);
        var arrived = GameClock.TryParse(last.ArrivedAt)!.Value;
        var bookOff = arrived.AddMinutes(Assign.PostTripMinutes);
        d.BookOn = GameClock.Format(bookOn);
        d.BookOff = GameClock.Format(bookOff);
        d.EndedAt = last.City;
        d.EndedAway = !Depots.IsHome(c, last.City, last.Cc);
        d.Status = "Done";
        d.ClosedGameTime = GameClock.Format(bookOff);
        c.GameTime = GameClock.Format(bookOff);
        c.City = last.City;
        c.Cc = last.Cc;

        // What the line taught: how late it runs and how passengers take it, for the next time it is planned.
        if (Lines.Find(c, d.LineId) is { } line)
        {
            var arrivals = timings.Where(t => t.Event == "arrival").Select(t => t.DelayMinutes).ToList();
            var delay = arrivals.Count == 0 ? 0 : arrivals.Average();
            line.AvgDelayMinutes = (line.AvgDelayMinutes * line.TimesRun + delay) / (line.TimesRun + 1);
            line.AvgSatisfaction = (line.AvgSatisfaction * line.TimesRun + d.FinalSatisfaction) / (line.TimesRun + 1);
            line.TimesRun++;
        }

        CoachPay.ForDuty(c, d, bookOn, bookOff);
        var discipline = Grading.Discipline(c, d);
        var tour = Tours.AfterDuty(c, d);
        var review = Companies.Review(c);
        CoachStore.Log(c, "duty", $"{d.Number} closed: {d.Grade}. {Grading.WhyGrade(d)}");
        return CloseOut(c, d, notes.Concat(discipline).Concat(tour).Concat(review).Concat(Maintenance.Notes(c)).ToList());
    }

    // ---------------------------------------------------------------- the close-out screen

    static string Delay(double m) => m > Grading.OnTimeMinutes ? $"{m:0} min late" : m < -0.5 ? $"{-m:0} min early" : "On time";

    public static object CloseOut(CoachCareer c, Duty d, List<string> notes)
    {
        var sections = new List<SummarySection>();
        var co = Companies.Find(d.CompanyId);

        var duty = new SummarySection { Key = "duty", Title = "The duty" }
            .Add("Duty", $"{d.Number}: {d.Title}")
            .Add("Crew", d.Crew == "Double" ? "Two drivers" : "Solo",
                 d.Crew == "Double" ? $"You drove {Hhmm.Of(MyDriving(d))} of it; the co-driver the rest" : "")
            .Add("Coach", $"{d.CoachModel}, {c.Job.FleetNumber}")
            .Add("On duty", $"{GameClock.Pretty(d.BookOn)} to {d.BookOff[^5..]}",
                 $"{Hhmm.Of((GameClock.TryParse(d.BookOff)!.Value - GameClock.TryParse(d.BookOn)!.Value).TotalHours)} including the checks")
            .Add("Distance", d.Km > 0 ? $"{d.Km:N0} km" : "");
        sections.Add(duty);

        var time = new SummarySection { Key = "time", Title = "Timekeeping" };
        foreach (var t in Grading.Timings(d))
            time.Add(t.Event == "departure" && t.Index == 0 ? $"{t.Place} (departure)" : t.Event == "departure" ? $"{t.Place} (left)" : t.Place,
                t.Status == "EarlyDeparture" ? $"Left {-t.DelayMinutes:0} min early" : Delay(t.DelayMinutes),
                t.Status == "EarlyDeparture" ? "Passengers could have been left behind" : "",
                t.Status switch { "OnTime" => "good", "Late" => "warn", _ => "bad" });
        time.Add("On time", $"{d.PunctualityPct:0}% of stops",
            d.Fault != "Driver" && d.LateStops + d.VeryLateStops > 0 ? $"Lateness put down to {d.Fault.ToLowerInvariant()}: not held against you" : "",
            d.PunctualityPct >= 95 ? "good" : d.PunctualityPct >= 80 ? "" : "bad");
        sections.Add(time);

        var pax = new SummarySection { Key = "passengers", Title = "Passengers" };
        var judged = d.Stops.Skip(1).Where(s => s.SatisfactionPct != null).ToList();
        pax.Add("Satisfaction", $"{d.FinalSatisfaction:0}%", judged.Count > 1 ? "Every stop, averaged: each one counts" : "",
            d.FinalSatisfaction >= 85 ? "good" : d.FinalSatisfaction >= 60 ? "" : "bad");
        if (judged.Count > 1)
            pax.Add("Worst stop", $"{d.WorstSatisfaction:0}% at {d.WorstStop}",
                d.WorstSatisfaction < 50 ? "Passengers made angry here hold the grade down, however the rest went" : "",
                d.WorstSatisfaction >= 80 ? "good" : d.WorstSatisfaction < 50 ? "bad" : "");
        pax.Add("How they felt", d.CategoryIndex >= 1 ? "Mostly delighted" : d.CategoryIndex >= 0.3 ? "Mostly content" : d.CategoryIndex >= -0.3 ? "Mixed" : "Mostly unhappy");
        // Each stop, as its own end: the % there and the four groups.
        foreach (var s in judged)
            pax.Add(s.City, $"{s.SatisfactionPct:0}%",
                $"{s.VeryHappy} very happy · {s.Happy} happy · {s.Unhappy} unhappy · {s.VeryUnhappy} very unhappy" + (s.Alighted > 0 ? $" · {s.Alighted} got off" : ""),
                s.SatisfactionPct >= 85 && s.VeryUnhappy == 0 ? "good" : s.SatisfactionPct < 60 || s.VeryUnhappy >= 2 ? "bad" : "");
        if (d.Complaints > 0) pax.Add("Complaints", $"{d.Complaints}", "Each very unhappy passenger is a complaint", "bad");
        var carried = d.Stops.Sum(s => s.Boarded);
        if (carried > 0) pax.Add("Carried", $"{carried} passengers");
        sections.Add(pax);

        var pay = new SummarySection { Key = "money", Title = "Pay" };
        foreach (var l in d.PayLines) pay.Add(l.Kind, Units.Money(l.Amount), l.Text, l.Kind is "Tips" or "Duty bonus" ? "good" : "");
        pay.Add("This duty", Units.Money(d.Pay), "Paid on Friday's payslip");
        sections.Add(pay);

        sections.Add(Maintenance.Section(c, d));

        var k = Hours.Now(c);
        var now = new SummarySection { Key = "now", Title = "Where you stand now" }
            .Add("Location", Lines.Place(c.City, c.Cc), Depots.IsHome(c, c.City, c.Cc) ? "Home depot" : "Away from home")
            .Add("Game clock", GameClock.Pretty(c.GameTime))
            .Add("Driving left today", Hhmm.Of(k.DriveLeft), c.Settings.Breaks ? $"Break due in {Hhmm.Of(k.UntilBreak)} of driving" : "")
            .Add("Week", $"{Hhmm.Of(k.WeekLeft)} left", $"Weekly rest due by {GameClock.Pretty(k.WeeklyRestDue)}");
        sections.Add(now);

        if (d.HoursFindings.Count > 0) notes.InsertRange(0, d.HoursFindings.Select(f => "Hours: " + f));
        if (d.EndedAway && c.Tour is not { Status: "Running" })
        {
            var back = Lines.From(c, c.City, c.Cc, GameClock.TryParse(c.GameTime)!.Value, 20)
                .FirstOrDefault(x => Depots.IsHome(c, x.Line.To.City, x.Line.To.Cc));
            notes.Add(back.Line != null
                ? $"Away from home. The {back.Line.From.Time} from {c.City} is the line the company expects to bring you back."
                : $"Away from home tonight. No line home from {c.City} is in the library yet: read in the board here and the company will find one.");
        }

        var who = co?.Name(c) ?? "the company";
        var headline = d.Grade switch
        {
            "Excellent" => $"Excellent: {d.Title}. On time, and the passengers loved it.",
            "Good" => $"Good: {d.Title}. A solid duty.",
            "Poor" => $"Poor: {d.Title}. {Grading.WhyGrade(d)}",
            _ => $"Bad: {d.Title}. {Grading.WhyGrade(d)}",
        };
        return new
        {
            headline, grade = d.Grade, summary = sections, notes,
            duty = new { d.Id, d.Number, d.Title, d.Grade, d.Pay, d.Kind },
            employer = who, status = c.Job.Status,
        };
    }

    /// <summary>Passengers aboard on arrival at a stop: everyone who boarded before it, less everyone who got off before it.</summary>
    public static int OnBoard(Duty d, int index) =>
        Math.Max(0, d.Stops.Take(index).Sum(x => x.Boarded) - d.Stops.Take(index).Sum(x => x.Alighted));

    public static double MyDriving(Duty d)
    {
        double h = 0;
        for (var i = 0; i < d.Stops.Count - 1; i++)
        {
            var s = d.Stops[i];
            if (GameClock.TryParse(s.DepartedAt) is not { } a || GameClock.TryParse(d.Stops[i + 1].ArrivedAt) is not { } b) continue;
            if (GameClock.TryParse(s.HandoverAt) is { } swap)
                h += s.LegDriver == "You" ? (swap - a).TotalHours : (b - swap).TotalHours;
            else if (s.LegDriver == "You") h += (b - a).TotalHours;
        }
        return h;
    }
}
