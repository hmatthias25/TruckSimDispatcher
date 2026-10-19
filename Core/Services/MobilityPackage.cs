using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The EU Mobility Package's rules on where a driver spends their weekly rest. Step 5 of Euro Truck
/// Simulator 2 support (#266, #271). Regulation (EU) 2020/1054, amending 561/2006.
///
/// <para><b>Home at least every four weeks.</b> The carrier must organise a driver's work so they can get home
/// — where they live, or the employer's base — at least every four consecutive weeks. For an EU career that
/// is a legal ceiling on the home-time arrangement rather than a preference: a driver who asked for six weeks,
/// or for no arrangement at all, still has the company bring them home inside four. The home-time machinery
/// does the rest — due soon from three weeks, overdue at four, outbound freight narrowed from there.</para>
///
/// <para><b>No regular weekly rest in the cab.</b> A regular weekly rest (45 hours or more) away from home has
/// to be in proper accommodation, and the employer pays for it. A reduced one (24 hours or more) may be taken
/// in a cab with a proper bunk, parked. The game lets you sleep anywhere, so the app is the only thing that
/// says so — in the plan, on the weekly rest order, and as a cost on the company's books.</para>
///
/// <para><b>Not modelled:</b> the 8-week return of the vehicle, which the EU Court of Justice annulled on
/// 4 October 2024; and the international exception that allows two reduced weekly rests in a row abroad,
/// which the planner never uses (it alternates).</para>
/// </summary>
public static class MobilityPackage
{
    /// <summary>The longest a driver may go without being brought home: four consecutive weeks.</summary>
    public const int HomeCeilingDays = 28;

    /// <summary>Whether this career is under EU rules at all.</summary>
    public static bool Applies(AppState s) => GameProfile.For(s).HosRuleset == "EU561";

    /// <summary>
    /// A home-time interval as the law allows it: unchanged where it is inside four weeks, and four weeks
    /// where it is longer or where there is no arrangement at all.
    /// </summary>
    public static int CapInterval(AppState s, int days) =>
        !Applies(s) ? days : days <= 0 || days > HomeCeilingDays ? HomeCeilingDays : days;

    /// <summary>Whether the four-week ceiling, not the driver's own arrangement, is what sets the interval.</summary>
    public static bool CeilingBinds(AppState s, int arrangedDays) =>
        Applies(s) && (arrangedDays <= 0 || arrangedDays > HomeCeilingDays);

    /// <summary>Hotel nights a weekly rest of this many hours takes: a night for each 24 hours started.</summary>
    public static int HotelNights(double hours) => Math.Max(1, (int)Math.Ceiling(hours / 24 - 1e-6));

    /// <summary>What the company pays for a regular weekly rest away from home, at the career's nightly rate.</summary>
    public static decimal HotelCost(AppState s, double hours) =>
        HotelNights(hours) * Math.Max(0, (s.Settings.EuHos ?? new EuHosRules()).HotelPerNight);

    /// <summary>
    /// Books a hotel stay for a regular weekly rest taken away from home to the company's operating account.
    /// Returns what was booked, or zero where nothing is owed (a reduced rest, or a rest at home).
    /// </summary>
    public static decimal BookHotel(AppState s, double hours, bool reduced, bool atHome, string reference)
    {
        if (!Applies(s) || reduced || atHome) return 0;
        var cost = HotelCost(s, hours);
        if (cost <= 0) return 0;
        LedgerService.Post(s, LedgerService.Operating, -cost, "Accommodation",
            $"{reference}: {HotelNights(hours)} hotel night(s) for a regular weekly rest away from home — " +
            "the Mobility Package bars it in the cab, and the company pays.", reference);
        return cost;
    }
}
