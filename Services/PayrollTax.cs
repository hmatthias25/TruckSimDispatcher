using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Withholding for a driver's pay stub.
///
/// This is a game approximation, and the stub says so. Real withholding runs off a W-4, the IRS
/// percentage method and a state's own tables; what is here is the shape of it — annualise the
/// period, run it through the brackets, take FICA, take a flat state rate — which is enough to make
/// the gap between gross and net feel like a real paycheck without pretending to be tax software.
///
/// Figures are 2026: federal single-filer brackets and the $16,100 standard deduction, a $184,500
/// Social Security wage base at 6.2%, and Medicare at 1.45% uncapped.
/// </summary>
public static class PayrollTax
{
    // 2026 single-filer brackets: (ceiling of the band, rate).
    private static readonly (decimal Upto, decimal Rate)[] FederalSingle =
    {
        (12_400m, 0.10m),
        (50_400m, 0.12m),
        (105_700m, 0.22m),
        (201_775m, 0.24m),
        (256_225m, 0.32m),
        (640_600m, 0.35m),
        (decimal.MaxValue, 0.37m)
    };

    private const decimal FederalStandardDeduction = 16_100m;
    private const decimal SocialSecurityRate = 0.062m;
    /// <summary>
    /// Wages subject to Social Security in one year, per employer. Public because the W-2 has to say
    /// where box 3 stopped, and two figures for the same cap is a contradiction waiting to happen.
    /// </summary>
    public const decimal SocialSecurityWageBase = 184_500m;
    private const decimal MedicareRate = 0.0145m;

    /// <summary>
    /// A representative state wage-tax rate for a driver's income, by state.
    ///
    /// Deliberately a single flat rate rather than fifty bracket tables. For the fifteen or so flat-tax
    /// states this is exact; for graduated states it is the rate that actually bites around a driver's
    /// earnings, which is not the top marginal rate in the handful of states with genuinely
    /// progressive schedules. Missing states fall back to zero rather than to a guess.
    ///
    /// The nine states with no wage income tax are listed explicitly at 0 so the stub can show a zero
    /// line — the absence of state tax is worth seeing, not hiding.
    /// </summary>
    private static readonly Dictionary<string, decimal> StateRates = new(StringComparer.OrdinalIgnoreCase)
    {
        // No wage income tax
        ["AK"] = 0m, ["FL"] = 0m, ["NV"] = 0m, ["NH"] = 0m, ["SD"] = 0m,
        ["TN"] = 0m, ["TX"] = 0m, ["WA"] = 0m, ["WY"] = 0m,

        // Flat-rate states
        ["AZ"] = 0.025m, ["CO"] = 0.044m, ["GA"] = 0.0519m, ["ID"] = 0.053m, ["IL"] = 0.0495m,
        ["IN"] = 0.0295m, ["KY"] = 0.035m, ["LA"] = 0.03m, ["MA"] = 0.05m, ["MI"] = 0.0425m,
        ["MS"] = 0.04m, ["NC"] = 0.0399m, ["OH"] = 0.0275m, ["PA"] = 0.0307m, ["UT"] = 0.045m,

        // Graduated — the rate that applies around a driver's income
        ["AL"] = 0.05m, ["AR"] = 0.039m, ["CA"] = 0.05m, ["CT"] = 0.05m, ["DE"] = 0.0555m,
        ["DC"] = 0.065m, ["HI"] = 0.07m, ["IA"] = 0.038m, ["KS"] = 0.0558m, ["ME"] = 0.0675m,
        ["MD"] = 0.055m, ["MN"] = 0.068m, ["MO"] = 0.047m, ["MT"] = 0.0565m, ["NE"] = 0.0455m,
        ["NJ"] = 0.035m, ["NM"] = 0.049m, ["NY"] = 0.055m, ["ND"] = 0.025m, ["OK"] = 0.045m,
        ["OR"] = 0.0875m, ["RI"] = 0.0475m, ["SC"] = 0.06m, ["VT"] = 0.066m, ["VA"] = 0.0575m,
        ["WV"] = 0.044m, ["WI"] = 0.053m,
    };

    public static bool HasStateTax(string? state) =>
        StateRates.TryGetValue((state ?? "").Trim(), out var r) && r > 0m;

    public static decimal StateRate(string? state) =>
        StateRates.TryGetValue((state ?? "").Trim(), out var r) ? r : 0m;

    /// <summary>Federal income tax for a year's taxable wages, run through the brackets.</summary>
    private static decimal AnnualFederal(decimal annualTaxable)
    {
        var taxable = Math.Max(0, annualTaxable - FederalStandardDeduction);
        decimal tax = 0, floor = 0;
        foreach (var (upto, rate) in FederalSingle)
        {
            if (taxable <= floor) break;
            var band = Math.Min(taxable, upto) - floor;
            if (band > 0) tax += band * rate;
            floor = upto;
        }
        return tax;
    }

    /// <summary>
    /// Works a settlement's gross down to net.
    ///
    /// <paramref name="periodsPerYear"/> is how the period annualises — 52 for a weekly payday. A short
    /// first week would otherwise annualise to a tiny salary and under-withhold, so the caller passes
    /// the nominal cadence rather than deriving it from the period length.
    /// </summary>
    public static PayStub Compute(AppState s, Settlement settlement, decimal ytdGross, decimal ytdSsWages)
    {
        var cfg = s.Settings;
        var gross = settlement.Gross;

        var stub = new PayStub
        {
            SettlementNumber = settlement.Number,
            Gross = gross,
            PeriodsPerYear = 52
        };

        // --- pre-tax deductions come off before anything is taxed. That is the point of them.
        stub.Medical = Math.Min(Math.Max(0, cfg.HealthPremiumPerPeriod), gross);
        stub.TaxableWages = Math.Round(gross - stub.Medical, 2);

        // --- federal, annualised through the brackets
        var annual = stub.TaxableWages * stub.PeriodsPerYear;
        stub.Federal = Math.Round(AnnualFederal(annual) / stub.PeriodsPerYear, 2);

        // --- FICA. A section 125 medical premium is exempt from Social Security and Medicare as well
        //     as income tax, so FICA runs on the same reduced wages.
        var ficaWages = stub.TaxableWages;
        var ssRoom = Math.Max(0, SocialSecurityWageBase - ytdSsWages);
        stub.SocialSecurity = Math.Round(Math.Min(ficaWages, ssRoom) * SocialSecurityRate, 2);
        stub.Medicare = Math.Round(ficaWages * MedicareRate, 2);

        // --- state, from where the driver is domiciled
        var home = HomeTime.HomeTerminal(s);
        stub.StateCode = (home?.State ?? s.Company.TerminalState ?? "").Trim().ToUpperInvariant();
        stub.StateRate = StateRate(stub.StateCode);
        stub.StateTax = Math.Round(stub.TaxableWages * stub.StateRate, 2);
        stub.StateHasTax = stub.StateRate > 0m;

        stub.TotalTaxes = Math.Round(stub.Federal + stub.SocialSecurity + stub.Medicare + stub.StateTax, 2);
        stub.Net = Math.Round(gross - stub.Medical - stub.TotalTaxes, 2);

        // --- year to date, including this period
        stub.YtdGross = Math.Round(ytdGross + gross, 2);
        return stub;
    }

    /// <summary>
    /// Wages already subject to Social Security <b>this year, from this employer</b> — which is what
    /// the wage base caps.
    ///
    /// It used to be every settlement ever issued. A career that had grossed past the base therefore
    /// stopped paying Social Security for good, and went on saying so on a stub that claimed to be a
    /// year's withholding. The base resets with the year, and it resets per employer, both of which are
    /// how the real thing works. See <see cref="W2Service"/>.
    /// </summary>
    public static decimal YtdSocialSecurityWages(AppState s, string? asOfGameTime = null) =>
        W2Service.YearToDate(s, asOfGameTime).Where(x => x.Stub != null).Sum(x => x.Stub!.TaxableWages);

    /// <summary>Gross paid this year by this employer. The figure "year to date" was always meant to be.</summary>
    public static decimal YtdGross(AppState s, string? asOfGameTime = null) =>
        W2Service.YearToDate(s, asOfGameTime).Sum(x => x.Gross);
}
