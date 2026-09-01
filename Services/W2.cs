using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The driver's W-2, and the tax year it closes.
///
/// The app paid a driver every Friday and then never drew a line under it. Year-to-date on a pay stub
/// was career-to-date — every settlement ever issued, summed — which is wrong in two ways that matter.
/// The driver could not answer "what do I make in a year", which is the question anyone in this job
/// actually asks. And the Social Security wage base never reset, so a career that had grossed past
/// $184,500 stopped paying Social Security for good, on a stub that went on claiming to be a year's
/// withholding.
///
/// <para>A year here is <b>365 game days from the day the career started</b>. Not a calendar year: the
/// game's calendar is day numbers and the app has never pretended otherwise, and picking a January
/// would mean inventing a date the player has no way to check against ATS. Day 365 closes year one,
/// day 730 closes year two, and so on.</para>
///
/// <para><b>One form per employer.</b> Change carrier in June and two W-2s turn up, because that is
/// what happens to a real driver who does the same thing — each employer reports what it paid. Which
/// is why a settlement remembers who paid it rather than the year end reading it off whoever the
/// driver happens to work for at the time.</para>
///
/// <para>What this is not is tax software. The withholding underneath it is
/// <see cref="PayrollTax"/>'s approximation, the form says so, and nobody should file from it.</para>
/// </summary>
public static class W2Service
{
    /// <summary>Days in a career year. The game counts days, so a year is a count of days.</summary>
    public const int DaysInYear = 365;

    /// <summary>
    /// The game day this career began.
    ///
    /// The earliest hire date on file, previous employers included — changing carrier does not restart
    /// the driver's tax year any more than it does in life.
    /// </summary>
    public static int? CareerStartDay(AppState s)
    {
        var days = new List<int>();
        if (GameClock.DayOf(s.Driver.HiredGameDate) is { } hired) days.Add(hired);
        foreach (var h in s.Driver.EmploymentHistory)
            if (GameClock.DayOf(h.StartedGameDate) is { } started) days.Add(started);
        return days.Count == 0 ? null : days.Min();
    }

    /// <summary>Days elapsed since the career opened, 1 on the first day. Null when there is no start.</summary>
    public static int? DayIntoCareer(AppState s, string? gameTime)
    {
        if (CareerStartDay(s) is not { } start) return null;
        if (GameClock.DayOf(gameTime) is not { } day) return null;
        return day - start + 1;
    }

    /// <summary>Which career year a moment falls in. 1 for the first 365 days.</summary>
    public static int? YearOf(AppState s, string? gameTime) =>
        DayIntoCareer(s, gameTime) is { } into ? Math.Max(1, (into - 1) / DaysInYear + 1) : null;

    /// <summary>The year the driver is in right now.</summary>
    public static int CurrentYear(AppState s) => YearOf(s, s.Status.GameTime) ?? 1;

    /// <summary>
    /// Years that have run their full course, so a W-2 is owed for them.
    ///
    /// The 365th day closes the first year — that is the day the form is issued, which is a good deal
    /// tidier than a real January and is what the game calendar can actually support.
    /// </summary>
    public static int YearsCompleted(AppState s) =>
        DayIntoCareer(s, s.Status.GameTime) is { } into ? Math.Max(0, into / DaysInYear) : 0;

    /// <summary>The game days a career year covers, as absolute day numbers.</summary>
    public static (int Start, int End) YearWindow(AppState s, int year)
    {
        var start = CareerStartDay(s) ?? 1;
        return (start + (year - 1) * DaysInYear, start + year * DaysInYear - 1);
    }

    /// <summary>
    /// Settlements paid inside a career year, optionally for one employer.
    ///
    /// Keyed on when the settlement was <i>paid</i> rather than the work it covers, which is how a real
    /// W-2 works: it reports wages paid in the year, whenever they were earned.
    /// </summary>
    public static List<Settlement> InYear(AppState s, int year, string? employerCode = null) =>
        s.Settlements
            .Where(x => YearOf(s, x.PeriodEndGame) == year)
            .Where(x => employerCode == null
                        || string.IsNullOrWhiteSpace(x.EmployerCode)
                        || x.EmployerCode.Equals(employerCode, StringComparison.OrdinalIgnoreCase))
            .ToList();

    /// <summary>
    /// This year's settlements from the current employer — what a pay stub's year-to-date means.
    ///
    /// <paramref name="asOfGameTime"/> is the settlement being computed, so a run that catches up
    /// several missed paydays across a year boundary counts each one against its own year rather than
    /// against today's.
    /// </summary>
    public static List<Settlement> YearToDate(AppState s, string? asOfGameTime = null)
    {
        var year = YearOf(s, string.IsNullOrWhiteSpace(asOfGameTime) ? s.Status.GameTime : asOfGameTime)
                   ?? CurrentYear(s);
        return InYear(s, year, s.Company.Code);
    }

    /// <summary>
    /// Issues every W-2 the calendar owes, and brings an already-issued one up to date where a
    /// settlement has since landed inside its year.
    ///
    /// Called off the same hook as payday, after the settlements have run, so the last cheque of the
    /// year is on the form rather than a week behind it.
    /// </summary>
    /// <returns>Forms issued for the first time. An updated one is not news.</returns>
    public static List<W2Form> IssueDue(AppState s)
    {
        var issued = new List<W2Form>();
        var completed = YearsCompleted(s);
        if (completed < 1) return issued;

        for (var year = 1; year <= completed; year++)
        {
            // Grouped by who paid. A settlement with no employer on it predates the stamp and belongs
            // to whoever the driver was working for when it ran, which the migration has worked out.
            var groups = InYear(s, year)
                .GroupBy(x => string.IsNullOrWhiteSpace(x.EmployerCode) ? s.Company.Code : x.EmployerCode,
                         StringComparer.OrdinalIgnoreCase);

            foreach (var g in groups)
            {
                var built = Build(s, year, g.Key, g.ToList());
                var existing = s.W2s.FirstOrDefault(
                    w => w.TaxYear == year && w.EmployerCode.Equals(g.Key, StringComparison.OrdinalIgnoreCase));

                if (existing == null)
                {
                    s.W2s.Insert(0, built);
                    issued.Add(built);
                    continue;
                }

                // Already issued. Keep its identity and refresh the figures — a settlement dated inside
                // the year can arrive after the form did, and a W-2 that disagrees with the stubs behind
                // it is worse than no W-2 at all.
                built.Number = existing.Number;
                built.IssuedGameTime = existing.IssuedGameTime;
                s.W2s[s.W2s.IndexOf(existing)] = built;
            }
        }

        s.W2s = s.W2s.OrderByDescending(w => w.TaxYear).ThenBy(w => w.EmployerName).ToList();
        return issued;
    }

    private static W2Form Build(AppState s, int year, string employerCode, List<Settlement> paid)
    {
        var (startDay, endDay) = YearWindow(s, year);
        var stubs = paid.Where(x => x.Stub != null).Select(x => x.Stub!).ToList();
        var noStub = paid.Count - stubs.Count;

        // A carrier the driver has since left is still the one that paid these wages, so its name comes
        // off the employment record rather than off whoever they work for now.
        var (name, city, state) = Employer(s, employerCode);

        var gross = paid.Sum(x => x.Gross);
        var medical = stubs.Sum(x => x.Medical);
        // Settlements from before pay stubs existed carry no withholding at all. Their gross still
        // counts as wages — it was paid — and the note says the tax lines are short.
        var wages = stubs.Sum(x => x.TaxableWages) + paid.Where(x => x.Stub == null).Sum(x => x.Gross);

        var form = new W2Form
        {
            Number = $"{employerCode}-W2-{year}",
            TaxYear = year,
            YearStartDay = startDay,
            YearEndDay = endDay,
            IssuedGameTime = s.Status.GameTime,

            EmployerEin = Ein(employerCode),
            EmployerName = name,
            EmployerCode = employerCode,
            EmployerAddress = string.IsNullOrWhiteSpace(city) ? "" : $"{city}, {state}",

            EmployeeSsn = MaskedSsn(s),
            EmployeeName = s.Driver.Name,
            EmployeeAddress = EmployeeAddress(s),
            ControlNumber = $"{employerCode}-{year:0000}-{s.Driver.EmployeeId}",

            Box1Wages = Money(wages),
            Box2FederalWithheld = Money(stubs.Sum(x => x.Federal)),
            Box3SocialSecurityWages = Money(Math.Min(wages, PayrollTax.SocialSecurityWageBase)),
            Box4SocialSecurityWithheld = Money(stubs.Sum(x => x.SocialSecurity)),
            Box5MedicareWages = Money(wages),
            Box6MedicareWithheld = Money(stubs.Sum(x => x.Medicare)),

            // Nothing in this career is deferred compensation, employer-paid coverage the app knows the
            // cost of, or any of the other things box 12 exists for. Left empty rather than filled with
            // a number nobody could stand behind.
            RetirementPlan = false,
            StatutoryEmployee = false,
            ThirdPartySickPay = false,

            Settlements = paid.Count,
            Gross = Money(gross),
            PreTaxMedical = Money(medical),
            Net = Money(stubs.Sum(x => x.Net) + paid.Where(x => x.Stub == null).Sum(x => x.Gross)),
        };

        if (medical > 0)
            form.Box14.Add(new W2CodedAmount
            {
                Code = "SEC125",
                Label = "Pre-tax medical",
                Amount = Money(medical),
            });

        // One line per state the driver was domiciled in over the year. A state with no wage tax gets a
        // zero line rather than being dropped — not paying it is worth seeing.
        foreach (var g in stubs.Where(x => !string.IsNullOrWhiteSpace(x.StateCode))
                               .GroupBy(x => x.StateCode, StringComparer.OrdinalIgnoreCase))
            form.States.Add(new W2StateLine
            {
                State = g.Key.ToUpperInvariant(),
                EmployerStateId = StateId(employerCode, g.Key),
                Wages = Money(g.Sum(x => x.TaxableWages)),
                Withheld = Money(g.Sum(x => x.StateTax)),
            });

        var notes = new List<string>
        {
            $"Career year {year} — game days {startDay} to {endDay}. Withholding on this form is the " +
            "app's approximation of the real thing, not tax advice, and nothing here is filed anywhere.",
        };
        if (noStub > 0)
            notes.Add($"{noStub} settlement(s) in this year predate pay stubs, so their gross is in box 1 " +
                      "but no withholding was ever computed for them. The tax boxes are short by that much.");
        if (form.Box5MedicareWages > form.Box3SocialSecurityWages)
            notes.Add($"Box 3 stops at the ${PayrollTax.SocialSecurityWageBase:N0} Social Security wage " +
                      "base. Box 5 does not — Medicare is uncapped, which is why the two differ.");
        form.Note = string.Join(" ", notes);

        return form;
    }

    /// <summary>Where the driver stands in the year they are actually in.</summary>
    public static object Standing(AppState s)
    {
        var year = CurrentYear(s);
        var (startDay, endDay) = YearWindow(s, year);
        var paid = InYear(s, year, s.Company.Code);
        var stubs = paid.Where(x => x.Stub != null).Select(x => x.Stub!).ToList();
        var today = GameClock.DayOf(s.Status.GameTime) ?? startDay;

        return new
        {
            year,
            startDay,
            endDay,
            daysRemaining = Math.Max(0, endDay - today + 1),
            dayIntoYear = Math.Max(1, today - startDay + 1),
            employer = s.Company.Name,
            settlements = paid.Count,
            gross = Math.Round(paid.Sum(x => x.Gross), 2),
            taxableWages = Math.Round(stubs.Sum(x => x.TaxableWages), 2),
            federal = Math.Round(stubs.Sum(x => x.Federal), 2),
            socialSecurity = Math.Round(stubs.Sum(x => x.SocialSecurity), 2),
            medicare = Math.Round(stubs.Sum(x => x.Medicare), 2),
            stateTax = Math.Round(stubs.Sum(x => x.StateTax), 2),
            medical = Math.Round(stubs.Sum(x => x.Medical), 2),
            net = Math.Round(stubs.Sum(x => x.Net), 2),
            // What the year is running at, so "what do I make in a year" has an answer before the year
            // is over. Only meaningful once there is a fortnight or so behind it.
            annualisedGross = today - startDay + 1 >= 14
                ? Math.Round(paid.Sum(x => x.Gross) / (today - startDay + 1) * DaysInYear, 2)
                : 0m,
        };
    }

    /// <summary>The carrier that paid, by code — the employment record where they have since left.</summary>
    private static (string Name, string City, string State) Employer(AppState s, string code)
    {
        if (s.Company.Code.Equals(code, StringComparison.OrdinalIgnoreCase))
        {
            var hq = s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters)
                     ?? s.Company.Terminals.FirstOrDefault();
            return (s.Company.Name, hq?.City ?? s.Company.TerminalCity, hq?.State ?? s.Company.TerminalState);
        }

        var past = s.Driver.EmploymentHistory.FirstOrDefault(
            h => h.CarrierCode.Equals(code, StringComparison.OrdinalIgnoreCase));
        return (past?.CarrierName ?? code, "", "");
    }

    private static string EmployeeAddress(AppState s)
    {
        var home = HomeTime.HomeTerminal(s);
        if (home != null) return $"{home.City}, {home.State}";
        var app = s.Application;
        return app == null || string.IsNullOrWhiteSpace(app.HomeCity) ? "" : $"{app.HomeCity}, {app.HomeState}";
    }

    /// <summary>
    /// Box b. Derived from the carrier code, the same way the DOT number already is — a game document
    /// needs a number in the box, and a made-up one that is at least stable beats an empty box.
    /// </summary>
    private static string Ein(string code) =>
        $"{20 + Hash(code + "|ein") % 79:00}-{1_000_000 + Hash(code + "|ein2") % 8_999_999:0000000}";

    private static string StateId(string code, string state) =>
        $"{state.ToUpperInvariant()}-{1_000_000 + Hash(code + "|" + state) % 8_999_999:0000000}";

    /// <summary>
    /// Box a, masked the way the employee copy of a real W-2 is.
    ///
    /// The app has never asked for a Social Security number and is not about to start. What it can do
    /// is show the box in the shape the driver expects to see it.
    /// </summary>
    private static string MaskedSsn(AppState s) =>
        $"XXX-XX-{1000 + Hash(s.Driver.EmployeeId + "|ssn") % 9000:0000}";

    /// <summary>FNV-1a, so a number derived here is the same one next time the app starts.</summary>
    private static uint Hash(string text)
    {
        unchecked
        {
            var h = 2166136261u;
            foreach (var ch in text) { h ^= ch; h *= 16777619u; }
            return h;
        }
    }

    private static decimal Money(decimal v) => Math.Round(v, 2);
}
