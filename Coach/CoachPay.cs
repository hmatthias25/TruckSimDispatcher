using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// A coach driver's pay, the way the trade pays it: by the hour, from book-on to book-off, at the company's rate for the
/// rank. On top: 25% for hours between 22:00 and 06:00, 50% for hours on a Sunday, a daily allowance for a duty over
/// eight hours, the night allowance for a night away from home, tips on excursions and tours (more for happier
/// passengers, and more again with Passenger Favourite), and bonuses for excellent work. Paid weekly, on Fridays.
/// Gross figures: tax is the player's own business.
/// </summary>
public static class CoachPay
{
    public const decimal NightRate = 0.25m, SundayRate = 0.50m, DayAllowance = 14m, NightAway = 28m;

    static bool Sunday(DateTime t) => GameClock.WeekdayOf(GameClock.DayOf(t)) == DayOfWeek.Sunday;

    /// <summary>What a duty earned, as lines. Added to the duty and to the pay waiting for Friday.</summary>
    public static List<PayLine> ForDuty(CoachCareer c, Duty d, DateTime bookOn, DateTime bookOff)
    {
        var co = Companies.Of(c);
        var rate = Companies.HourlyRate(co, d.RankAtTheTime);
        var lines = new List<PayLine>();
        void Add(string kind, string text, decimal amount)
        {
            if (amount == 0) return;
            lines.Add(new PayLine { GameTime = c.GameTime, Duty = d.Number, Kind = kind, Text = text, Amount = Math.Round(amount, 2) });
        }

        var hours = Math.Max(0, (bookOff - bookOn).TotalHours);
        Add("Hours", $"{Hhmm.Of(hours)} on duty at {Units.Money(rate)}/h", (decimal)hours * rate);

        double night = 0, sunday = 0;
        for (var t = bookOn; t < bookOff; t = t.AddMinutes(15))
        {
            var step = Math.Min(15, (bookOff - t).TotalMinutes) / 60.0;
            if (t.Hour >= 22 || t.Hour < 6) night += step;
            if (Sunday(t)) sunday += step;
        }
        if (night > 0.01) Add("Night", $"{Hhmm.Of(night)} between 22:00 and 06:00 at +25%", (decimal)night * rate * NightRate);
        if (sunday > 0.01) Add("Sunday", $"{Hhmm.Of(sunday)} on a Sunday at +50%", (decimal)sunday * rate * SundayRate);
        if (hours > 8) Add("Allowance", "Daily allowance: over eight hours away from the depot", DayAllowance);
        // The night allowance is paid when the rest is taken away from home (Duties.Rest), not here: a duty that ends
        // away may still have a turnaround home after it.

        if (d.Kind is "Tourist" or "TourLeg")
        {
            var pax = d.Passengers > 0 ? d.Passengers : 30;
            var factor = d.FinalSatisfaction >= 90 ? 1.5m : d.FinalSatisfaction >= 75 ? 1.0m : d.FinalSatisfaction >= 60 ? 0.5m : 0m;
            var favourite = 1 + 0.1m * c.Profile.Skills.PassengerFavourite;
            var tips = pax * 1m * factor * favourite;
            d.Tips = Math.Round(tips, 2);
            Add("Tips", factor == 0
                ? "No tips: passengers under 60% do not tip"
                : $"Tips from {pax} passengers at {d.FinalSatisfaction:0}%" + (c.Profile.Skills.PassengerFavourite > 0 ? $", Passenger Favourite +{c.Profile.Skills.PassengerFavourite * 10}%" : ""), tips);
        }

        if (d.Grade == "Excellent")
            Add("Duty bonus", "Excellent duty: on time at every stop, passengers happy",
                15 + 5 * d.RankAtTheTime + Math.Min(15, (decimal)d.Km * 0.02m));

        d.PayLines = lines;
        d.Pay = lines.Sum(l => l.Amount);
        c.Pay.Pending.AddRange(lines);
        return lines;
    }

    /// <summary>Positioning: driving the coach empty to where the work is. Paid at the plain rate.</summary>
    public static PayLine Positioning(CoachCareer c, double hours, string text)
    {
        var co = Companies.Of(c);
        var rate = Companies.HourlyRate(co, c.Job.Rank);
        var line = new PayLine { GameTime = c.GameTime, Kind = "Hours", Text = $"{text}: {Hhmm.Of(hours)} at {Units.Money(rate)}/h", Amount = Math.Round((decimal)hours * rate, 2) };
        c.Pay.Pending.Add(line);
        return line;
    }

    /// <summary>
    /// Friday's payslip, for every Friday 18:00 the clock has passed since the last; and every fourth week the
    /// performance bonus: 150 for passengers at 85% and 95% of stops on time, 60 for 75% and 90%. Returns what was paid.
    /// </summary>
    public static List<string> Advance(CoachCareer c)
    {
        var said = new List<string>();
        if (!c.Started || GameClock.TryParse(c.GameTime) is not { } now) return said;
        var today = GameClock.DayOf(now);
        if (c.Pay.LastPayday == 0) { c.Pay.LastPayday = today - 1; c.Pay.LastPerformanceDay = today; }
        for (var day = c.Pay.LastPayday + 1; day <= today; day++)
        {
            if (GameClock.WeekdayOf(day) != DayOfWeek.Friday) continue;
            var cut = GameClock.FromDay(day, 18, 0);
            if (now < cut) break;
            c.Pay.LastPayday = day;

            if (day - c.Pay.LastPerformanceDay >= 28 && c.Job.Status == "Active")
            {
                c.Pay.LastPerformanceDay = day;
                var from = cut.AddDays(-28);
                var period = c.Duties.Where(x => x.Status == "Done" && GameClock.TryParse(x.ClosedGameTime) is { } t && t > from && t <= cut).ToList();
                if (period.Count >= 8)
                {
                    var sat = period.Average(x => x.FinalSatisfaction);
                    var punct = period.Average(x => x.PunctualityPct);
                    var bonus = sat >= 85 && punct >= 95 ? 150m : sat >= 75 && punct >= 90 ? 60m : 0m;
                    if (bonus > 0)
                    {
                        c.Pay.Pending.Add(new PayLine { GameTime = GameClock.Format(cut), Kind = "Performance bonus", Amount = bonus,
                            Text = $"Four weeks: {period.Count} duties, passengers at {sat:0}%, {punct:0}% of stops on time" });
                        c.Discipline.Entries.Add(new DisciplineEntry { GameTime = GameClock.Format(cut), Kind = "Bonus",
                            Text = $"Performance bonus of {Units.Money(bonus)}: passengers at {sat:0}%, {punct:0}% on time." });
                        said.Add($"A performance bonus of {Units.Money(bonus)} for the last four weeks.");
                    }
                }
            }

            var due = c.Pay.Pending.Where(l => (GameClock.TryParse(l.GameTime) ?? cut) <= cut).ToList();
            if (due.Count == 0) continue;
            var slip = new Payslip
            {
                Number = $"PAY-{c.Pay.Payslips.Count + 1:000}",
                PeriodEnd = GameClock.Format(cut),
                Lines = due,
                Gross = due.Sum(l => l.Amount),
            };
            c.Pay.Payslips.Add(slip);
            c.Pay.Pending.RemoveAll(due.Contains);
            said.Add($"Payslip {slip.Number}: {Units.Money(slip.Gross)} gross for the week to Friday.");
            CoachStore.Log(c, "pay", $"Payslip {slip.Number}: {Units.Money(slip.Gross)} gross.");
        }
        return said;
    }
}
