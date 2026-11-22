using TruckSimDispatcher.Services;

namespace TruckSimCoach;

public class MaintRequest
{
    /// <summary>Any of Repair, Service, Inspection, Annual test: what was done in this visit.</summary>
    public List<string>? Kinds { get; set; }
    /// <summary>When the coach went in. Defaults to now.</summary>
    public int? Day { get; set; }
    public string? Time { get; set; }
    /// <summary>A repair: the damage the game shows after it. Defaults to 0.</summary>
    public double? DamageAfter { get; set; }
    /// <summary>What the game charged, for the record. The company's bill, not the driver's.</summary>
    public decimal? Cost { get; set; }
    public string? Note { get; set; }
}

/// <summary>
/// The coach's condition, held to the Dispatcher's damage rules.
///
/// <para>The damage is read off the game after every run, a duty or an empty one, and what the run caused is after less
/// before. The bands are the company's: under 5% nothing; from 5% it is worth a look the next time the coach stands at a
/// depot anyway, not a trip on its own; from 10% no more passenger work until it is fixed, though a line that takes it home
/// to the company's garage is fine; from 15% nobody rides in it until it has been looked at; from 30% it is out of service.
/// Home is the better shop while the coach is fit to get there, as in the Dispatcher: cheaper labour, and the coach ends up
/// where it is needed.</para>
///
/// <para>What the driver caused counts against them as in the Dispatcher: under 1% it is noise; to 5% minor (no duty bonus);
/// to 15% a strike; to 25% a bad duty; past that one run can end the job. Another road user's doing, or the game's, is
/// noted and costs nothing.</para>
///
/// <para>The game has no service schedule, so the app keeps one from real coach practice: a service by distance, a safety
/// inspection every six weeks and the annual test, all done in the company's own garage.</para>
/// </summary>
public static class Maintenance
{
    /// <summary>Damage the driver caused per 1,000 km above which they are hard on the coach: the Dispatcher's 2.5 per 1,000 miles.</summary>
    public const double WearPer1000Km = 1.5, WearMinKm = 1600, WearMinPoints = 5;

    public static readonly string[] Kinds = { "Repair", "Service", "Inspection", "Annual test" };

    static DateTime Now(CoachCareer c) => GameClock.TryParse(c.GameTime) ?? GameClock.FromDay(1, 8, 0);

    public static string CauseWord(string cause) => cause switch { "Other" => "another road user", "Game" => "the game", _ => "you" };

    public static string NormaliseCause(string? cause) => cause switch
    {
        "Other" or "Road" => "Other",
        "Game" => "Game",
        _ => "Driver",
    };

    /// <summary>A new coach from the dealer: nothing on it, inspected and tested the day it was bought.</summary>
    public static void NewCoach(CoachCareer c)
    {
        var now = c.GameTime;
        c.Coach = new CoachCondition { ReadAt = now, LastServiceAt = now, LastInspectionAt = now, LastAnnualTestAt = now };
    }

    /// <summary>A career from before the coach was kept: start its clocks from now rather than from nothing.</summary>
    public static void Ensure(CoachCareer c)
    {
        c.Coach ??= new CoachCondition();
        c.Settings.Maintenance ??= new CoachMaintenance();
        if (!c.Started || !c.Job.CoachBought || c.Coach.LastInspectionAt.Length > 0) return;
        c.Coach.LastInspectionAt = c.Coach.LastAnnualTestAt = c.Coach.LastServiceAt = c.GameTime;
        if (c.Coach.ReadAt.Length == 0) c.Coach.ReadAt = c.GameTime;
    }

    /// <summary>What a run's damage means for the driver, from what it caused.</summary>
    public static string Severity(CoachMaintenance m, double incurred) =>
        incurred < m.NoiseFloorPct ? "None"
        : incurred < m.MinorPct ? "Minor"
        : incurred < m.SeriousPct ? "Moderate"
        : incurred < m.MajorPct ? "Serious"
        : "Major";

    public static string SeverityMeans(string severity) => severity switch
    {
        "Minor" => "Minor: on the record, and no duty bonus",
        "Moderate" => "Moderate: a poor duty and a strike",
        "Serious" => "Serious: a bad duty, a step up the ladder at once",
        "Major" => "Major: a final warning at once, or the end of the job",
        _ => "Nothing worth a mark",
    };

    /// <summary>
    /// The damage read off the game after a run: what it caused, whose doing, and the reading kept. Returns the entry.
    /// </summary>
    public static MaintEntry Reading(CoachCareer c, double? reading, string? cause, double km, string reference, string kind = "Run")
    {
        if (reading is not { } after)
            throw new InvalidOperationException("Enter the coach's damage as the game shows it now (0 if there is none). It is read after every run.");
        if (after < 0 || after > 100) throw new InvalidOperationException("Damage is a percentage: 0 to 100.");
        var m = c.Settings.Maintenance;
        var before = c.Coach.DamagePct;
        var e = new MaintEntry
        {
            GameTime = c.GameTime, Kind = kind, Ref = reference, Place = Lines.Place(c.City, c.Cc),
            Before = before, After = Math.Round(after, 1), Km = Math.Round(km),
            Incurred = Math.Round(Math.Max(0, after - before), 1), Cause = NormaliseCause(cause),
        };
        e.Severity = Severity(m, e.Incurred);
        if (after < before - 0.5)
            e.Note = $"Came back better than it went out: {before:0.#}% to {after:0.#}%. Repaired in the game without being logged? " +
                     "Log repairs on the Coach tab, so the time in the shop is kept.";
        c.Coach.DamagePct = e.After;
        c.Coach.ReadAt = c.GameTime;
        c.Coach.Km += Math.Max(0, km);
        c.Coach.Entries.Add(e);
        if (e.Incurred >= m.NoiseFloorPct)
            CoachStore.Log(c, "coach", $"{reference}: the coach took {e.Incurred:0.#}% ({CauseWord(e.Cause)}), now at {e.After:0.#}%.");
        return e;
    }

    // ---------------------------------------------------------------- what the company says about the coach

    /// <summary>
    /// The company's order for the coach as it stands. <c>OnlyHome</c>: passengers only on a line that ends at the home depot.
    /// <c>NoPassengers</c>: no passenger work at all until something is done.
    /// </summary>
    public record Order(string Band, string Headline, List<string> Lines, bool OnlyHome, bool NoPassengers);

    static bool AtGarage(CoachCareer c) => Depots.IsHome(c, c.City, c.Cc)
        || c.Depots.Any(d => d.Opened && Companies.SamePlace(d.City, d.Cc, c.City, c.Cc));

    static string GarageName(CoachCareer c) => Depots.IsHome(c, c.City, c.Cc) ? $"your home depot in {c.City}" : $"the {c.City} depot";

    public static Order Assess(CoachCareer c)
    {
        var m = c.Settings.Maintenance;
        var d = c.Coach.DamagePct;
        var lines = new List<string>();
        var now = Now(c);
        if (GameClock.TryParse(c.Coach.InShopUntil) is { } ready && ready > now)
            return new Order("InShop", $"The coach is in the shop until {GameClock.Pretty(ready)}.", lines, false, true);

        var home = Lines.Place(c.Job.HomeCity, c.Job.HomeCc);
        var atHome = Depots.IsHome(c, c.City, c.Cc);
        if (d >= m.OutOfServicePct)
        {
            lines.Add($"At or over the {m.OutOfServicePct:0}% out-of-service line. Nobody rides in it, and it goes no further than the nearest shop.");
            lines.Add("Repair it in the game, then log the repair on the Coach tab.");
            return new Order("OutOfService", $"Coach at {d:0.#}%: out of service.", lines, false, true);
        }
        if (d >= m.ShopPct)
        {
            var review = d >= m.ReviewPct;
            if (AtGarage(c))
            {
                lines.Add($"You are at {GarageName(c)}: it is repaired here, in our own garage, before the next duty. Repair it in the game, then log it on the Coach tab.");
                return new Order("Repair", $"Coach at {d:0.#}%: no more passenger work until it is fixed.", lines, false, true);
            }
            var km = Lines.Km(c.City, c.Cc, c.Job.HomeCity, c.Job.HomeCc);
            var hours = km / Lines.PlanningKmh;
            var mustRunHome = !review;
            var homeClose = hours <= m.RunHomeMaxHours;
            if ((mustRunHome || homeClose) && d < m.RunHomeMaxPct)
            {
                lines.Add(homeClose
                    ? $"{home} is {km:N0} km out, about {Hhmm.Of(hours)} of driving. That is inside a day, and the damage is light enough to make it: " +
                      "our own garage rather than the first shop you pass. Cheaper labour, and the coach ends up where it is needed."
                    : $"{home} is {km:N0} km out, further than a day. At {d:0.#}% this is not something we patch up at a shop on the road: " +
                      "our garage is cheaper, the coach ends up where it is needed, and every kilometre spent hunting a shop is one it might get worse.");
                if (!review)
                    lines.Add($"If the board has a line ending at {c.Job.HomeCity}, the company puts you on it: passengers do not mind a scuffed coach, and a paying run home beats an empty one. If not, run it home empty.");
                else
                    lines.Add($"Over the {m.ReviewPct:0}% review line nobody rides in it until it has been looked at: run it home empty.");
                return new Order("RunHome", $"Coach at {d:0.#}%: no more passenger work until it is fixed. Run it home to {c.Job.HomeCity} and fix it in our garage.",
                    lines, !review, review);
            }
            lines.Add(d >= m.RunHomeMaxPct
                ? $"{home} is {km:N0} km out, but past {m.RunHomeMaxPct:0}% the company does not gamble another day's driving on it. Nearest shop."
                : $"{home} is {km:N0} km out, about {Hhmm.Of(hours)}: more than a day. Past {m.ReviewPct:0}% that is too far to nurse it. Nearest shop.");
            lines.Add("Repair it in the game, then log the repair on the Coach tab.");
            return new Order("NearestShop", $"Coach at {d:0.#}%: no more passenger work until it is fixed. Nearest shop on the road.", lines, false, true);
        }
        if (d >= m.WatchPct)
        {
            lines.Add(AtGarage(c)
                ? $"You are at {GarageName(c)}: have it seen to while it stands, and log the repair on the Coach tab."
                : $"Get it looked at the next time it stands at a depot anyway: on a rest at home or in a depot. Not a trip on its own.");
            return new Order("Watch", $"Coach at {d:0.#}%: worth a look at the next depot.", lines, false, false);
        }
        return new Order("Fine", $"Coach at {d:0.#}%: monitor only.", lines, false, false);
    }

    // ---------------------------------------------------------------- the service schedule

    /// <summary>One scheduled job: Ok, Soon, Due or Overdue, and whether it keeps the coach from passenger work.</summary>
    public record Check(string Kind, string Status, string Text, string DueAt, double KmLeft, bool Grounds, bool OnlyGarage);

    public static List<Check> Checks(CoachCareer c)
    {
        var list = new List<Check>();
        if (!c.Started || !c.Job.CoachBought) return list;
        var m = c.Settings.Maintenance;
        var now = Now(c);

        // The service, by distance. Overdue by a tenth of the interval, the coach works only toward the garage.
        var since = c.Coach.Km - c.Coach.LastServiceKm;
        var left = m.ServiceIntervalKm - since;
        if (since >= m.ServiceIntervalKm * 1.1)
            list.Add(new Check("Service", "Overdue", $"The service is {-left:N0} km overdue: only a line that ends at a garage of ours until it is done.", "", left, false, true));
        else if (since >= m.ServiceIntervalKm)
            list.Add(new Check("Service", "Due", $"The service is due ({-left:N0} km over). Book it in at the next depot: the company puts you on work that ends at one.", "", left, false, false));
        else if (since >= m.ServiceIntervalKm * 0.9)
            list.Add(new Check("Service", "Soon", $"The service is due in {left:N0} km.", "", left, false, false));
        else
            list.Add(new Check("Service", "Ok", $"Next service in {left:N0} km.", "", left, false, false));

        // The inspections, by date. A coach past its inspection carries nobody: that is the operator's licence.
        void ByDate(string kind, string last, int days, string what)
        {
            var from = GameClock.TryParse(last) ?? now;
            var due = from.AddDays(days);
            var dueAt = GameClock.Format(due);
            var daysLeft = (due - now).TotalDays;
            if (daysLeft <= 0)
                list.Add(new Check(kind, "Overdue", $"The {what} was due {GameClock.Pretty(due)}: the coach carries nobody until it is done in one of our garages.", dueAt, 0, true, false));
            else if (daysLeft <= 3)
                list.Add(new Check(kind, "Soon", $"The {what} is due {GameClock.Pretty(due)}. The company puts you on work that ends at a depot to have it done.", dueAt, 0, false, false));
            else
                list.Add(new Check(kind, "Ok", $"Next {what} {GameClock.Pretty(due)}.", dueAt, 0, false, false));
        }
        ByDate("Inspection", c.Coach.LastInspectionAt, m.InspectionIntervalDays, "safety inspection");
        ByDate("Annual test", c.Coach.LastAnnualTestAt, m.AnnualTestDays, "annual test");
        return list;
    }

    // ---------------------------------------------------------------- what it means for the board

    /// <summary>Why the coach may not take this line from this book-on. Empty when it may.</summary>
    public static List<string> WhyNot(CoachCareer c, Line l, DateTime bookOn)
    {
        var why = new List<string>();
        if (!c.Job.CoachBought) return why;
        var endsHome = Companies.SamePlace(l.To.City, l.To.Cc, c.Job.HomeCity, c.Job.HomeCc);
        var endsGarage = endsHome || c.Depots.Any(d => d.Opened && Companies.SamePlace(d.City, d.Cc, l.To.City, l.To.Cc));
        if (GameClock.TryParse(c.Coach.InShopUntil) is { } ready && ready > bookOn)
        {
            why.Add($"The coach is in the shop until {GameClock.Pretty(ready)}.");
            return why;
        }
        var o = Assess(c);
        if (o.Band != "InShop")
        {
            if (o.NoPassengers) why.Add($"{o.Headline}");
            else if (o.OnlyHome && !endsHome) why.Add($"The coach is at {c.Coach.DamagePct:0.#}% and goes home to {c.Job.HomeCity} to be fixed: only a line that ends there.");
        }
        foreach (var k in Checks(c))
        {
            if (k.Grounds && GameClock.TryParse(k.DueAt) is { } due && due <= bookOn) why.Add(k.Text);
            else if (k.OnlyGarage && !endsGarage) why.Add(k.Text);
        }
        return why;
    }

    /// <summary>The company's lean toward a line that ends where the coach can be seen to, when something is coming up.</summary>
    public static (int Score, string? Reason) Lean(CoachCareer c, Line l)
    {
        if (!c.Job.CoachBought) return (0, null);
        var endsGarage = Companies.SamePlace(l.To.City, l.To.Cc, c.Job.HomeCity, c.Job.HomeCc)
            || c.Depots.Any(d => d.Opened && Companies.SamePlace(d.City, d.Cc, l.To.City, l.To.Cc));
        if (!endsGarage) return (0, null);
        var due = Checks(c).FirstOrDefault(k => k.Status is "Soon" or "Due" or "Overdue");
        if (due != null) return (25, $"The coach's {(due.Kind == "Service" ? "service" : due.Kind.ToLowerInvariant())} is coming up: this ends where our garage can do it.");
        if (Assess(c).Band == "Watch") return (10, $"It ends at a garage of ours, where the {c.Coach.DamagePct:0.#}% can be seen to.");
        return (0, null);
    }

    // ---------------------------------------------------------------- the garage

    /// <summary>A visit to a shop: a repair anywhere, the service and the inspections in the company's own garage.</summary>
    public static string Visit(CoachCareer c, MaintRequest r)
    {
        if (!c.Started || c.Job.Status != "Active") throw new InvalidOperationException("You are not with a company.");
        if (!c.Job.CoachBought) throw new InvalidOperationException("Buy the coach in the game first.");
        if (Duties.Current(c) is { Status: "Running" }) throw new InvalidOperationException("A duty is running: finish it first.");
        var kinds = (r.Kinds ?? new()).Select(k => Kinds.FirstOrDefault(x => string.Equals(x, k, StringComparison.OrdinalIgnoreCase)) ?? "")
            .Where(k => k.Length > 0).Distinct().ToList();
        if (kinds.Count == 0) throw new InvalidOperationException("What was done: a repair, the service, the safety inspection or the annual test?");
        var m = c.Settings.Maintenance;
        var garage = AtGarage(c);
        var where = garage ? GarageName(c) : $"a shop in {c.City}";
        var scheduled = kinds.Where(k => k != "Repair").ToList();
        if (scheduled.Count > 0 && !garage)
            throw new InvalidOperationException($"The {string.Join(" and ", scheduled.Select(k => k.ToLowerInvariant()))} is done in the company's own garage: at your home depot or an opened depot. You are in {c.City}.");

        // The clock moves to when it went in: the time before is off duty, as any.
        var at = Duties.Moment(c, r.Day, r.Time);
        if (at > Now(c)) Duties.Clock(c, at);
        else at = Now(c);

        var said = new List<string>();
        double hours = 0;
        var before = c.Coach.DamagePct;
        foreach (var k in kinds)
        {
            var e = new MaintEntry { GameTime = GameClock.Format(at), Kind = k, Place = Lines.Place(c.City, c.Cc), Before = before, After = before, Km = Math.Round(c.Coach.Km) };
            switch (k)
            {
                case "Repair":
                    var after = Math.Round(r.DamageAfter ?? 0, 1);
                    if (before < 0.05) throw new InvalidOperationException("Nothing to repair: the coach reads 0%.");
                    if (after < 0 || after > before) throw new InvalidOperationException($"After the repair the damage is between 0 and {before:0.#}%.");
                    e.After = after;
                    e.ShopHours = Math.Round((m.RepairIntakeHours + (before - after) * m.RepairHoursPerPoint) * (garage ? m.GarageFactor : 1), 1);
                    c.Coach.DamagePct = after;
                    said.Add($"Repaired at {where}: {before:0.#}% to {after:0.#}%.");
                    break;
                case "Service":
                    e.ShopHours = m.ServiceHours;
                    c.Coach.LastServiceKm = c.Coach.Km;
                    c.Coach.LastServiceAt = e.GameTime;
                    said.Add($"Serviced at {where}.");
                    break;
                case "Inspection":
                    e.ShopHours = m.InspectionHours;
                    c.Coach.LastInspectionAt = e.GameTime;
                    said.Add($"Safety inspection passed at {where}.");
                    break;
                default:
                    e.ShopHours = m.AnnualTestHours;
                    c.Coach.LastAnnualTestAt = e.GameTime;
                    said.Add("Annual test passed.");
                    break;
            }
            e.Note = (r.Note ?? "").Trim();
            if (r.Cost is { } cost && kinds[0] == k) e.Cost = Math.Max(0, cost);
            hours += e.ShopHours;
            c.Coach.Entries.Add(e);
        }
        var ready = at.AddHours(hours);
        c.Coach.InShopUntil = GameClock.Format(ready);
        var text = string.Join(" ", said) + $" About {Hhmm.Of(hours)} in the shop: back in service {GameClock.Pretty(ready)}. Your rest goes on meanwhile.";
        CoachStore.Log(c, "coach", text);
        return text;
    }

    // ---------------------------------------------------------------- the record and the screens

    /// <summary>Damage the driver caused per 1,000 km over their last duties. Null where there is too little to judge.</summary>
    public static (double Km, double Points, double? Per1000) Wear(CoachCareer c, int duties = 15)
    {
        var recent = c.Duties.Where(d => d.Status == "Done" && d.CompanyId == c.Job.CompanyId).TakeLast(duties).ToList();
        var km = recent.Sum(d => d.Km);
        var pts = recent.Where(d => d.DamageCause == "Driver").Sum(d => d.DamageIncurred);
        return (km, pts, km >= WearMinKm ? Math.Round(pts / km * 1000, 2) : null);
    }

    /// <summary>The wear standard as a promotion gap, or null when the driver meets it.</summary>
    public static string? WearGap(CoachCareer c)
    {
        var (_, pts, rate) = Wear(c);
        return rate is { } r && pts >= WearMinPoints && r > WearPer1000Km
            ? $"Easier on the coach: {r:0.#}% of damage per 1,000 km over your last 15 duties. The standard is under {WearPer1000Km:0.#}."
            : null;
    }

    /// <summary>The close-out's section on the coach.</summary>
    public static SummarySection Section(CoachCareer c, Duty d)
    {
        var s = new SummarySection { Key = "coach", Title = "The coach" };
        var o = Assess(c);
        var tone = o.Band switch { "Fine" => "good", "Watch" => "warn", _ => "bad" };
        s.Add("Damage", $"{d.DamageAfter:0.#}%",
            d.DamageIncurred > 0 ? $"Was {d.DamageBefore:0.#}%: {d.DamageIncurred:0.#}% on this duty" : $"Was {d.DamageBefore:0.#}%: nothing added", tone);
        if (d.DamageIncurred >= c.Settings.Maintenance.NoiseFloorPct)
            s.Add("Caused by", d.DamageCause == "Driver" ? "You" : d.DamageCause == "Other" ? "Another road user" : "The game",
                d.DamageCause == "Driver" ? SeverityMeans(d.DamageSeverity) : "On the record; not held against you",
                d.DamageCause != "Driver" ? "" : d.DamageSeverity == "Minor" ? "warn" : "bad");
        s.Add("The company says", o.Headline, "", tone);
        foreach (var k in Checks(c))
            s.Add(k.Kind == "Service" ? "Service" : k.Kind == "Inspection" ? "Safety inspection" : "Annual test",
                k.Kind == "Service" ? (k.KmLeft >= 0 ? $"in {k.KmLeft:N0} km" : $"{-k.KmLeft:N0} km over") : GameClock.Pretty(k.DueAt),
                k.Status == "Ok" ? "" : k.Text, k.Status switch { "Ok" => "", "Soon" => "warn", _ => "bad" });
        s.Add("On the books", $"{c.Coach.Km:N0} km");
        return s;
    }

    /// <summary>The order and the schedule as notes for the close-out, where there is anything to say.</summary>
    public static List<string> Notes(CoachCareer c)
    {
        var notes = new List<string>();
        var o = Assess(c);
        if (o.Band != "Fine") { notes.Add(o.Headline); notes.AddRange(o.Lines); }
        notes.AddRange(Checks(c).Where(k => k.Status != "Ok").Select(k => k.Text));
        return notes;
    }

    public static object View(CoachCareer c)
    {
        var m = c.Settings.Maintenance;
        var o = Assess(c);
        var (km, pts, rate) = Wear(c);
        return new
        {
            damagePct = c.Coach.DamagePct, readAt = c.Coach.ReadAt, km = Math.Round(c.Coach.Km),
            band = o.Band, headline = o.Headline, lines = o.Lines, onlyHome = o.OnlyHome, noPassengers = o.NoPassengers,
            inShopUntil = GameClock.TryParse(c.Coach.InShopUntil) is { } t && t > Now(c) ? c.Coach.InShopUntil : "",
            atGarage = c.Started && AtGarage(c),
            checks = Checks(c),
            wear = new { km = Math.Round(km), points = Math.Round(pts, 1), per1000 = rate, standard = WearPer1000Km },
            policy = new { m.WatchPct, m.ShopPct, m.ReviewPct, m.OutOfServicePct, m.RunHomeMaxPct, m.ServiceIntervalKm, m.InspectionIntervalDays, m.AnnualTestDays },
            entries = c.Coach.Entries.TakeLast(40).Reverse(),
        };
    }
}
