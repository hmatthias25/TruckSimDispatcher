using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The hours words for the career's game, for the messages that are written once for both. An ETS2 career is
/// planned on EU 561/2006 and its driver reads a status line of B, D, W and 2W; telling them the dock "comes
/// off your 13-hour window" or to "take the 10-hour reset" is ATS's vocabulary on Europe's rules (reported
/// from play). Read off the active profile, like <see cref="Units"/>.
/// </summary>
public static class HosWords
{
    /// <summary>Whether the open career plans on EU 561/2006.</summary>
    public static bool Eu => GameProfile.Current.HosRuleset == "EU561";

    private static EuHosRules R(AppSettings s) => s.EuHos ?? new EuHosRules();

    /// <summary>The working-day clock as a noun: "spread" in Europe, "window" in the US.</summary>
    public static string Window => Eu ? "spread" : "window";

    /// <summary>"13-hour spread" or "14-hour window".</summary>
    public static string ShiftClock(AppSettings s) =>
        Eu ? $"{R(s).Spread:0.#}-hour spread" : $"{s.Hos.ShiftLimit:0.#}-hour window";

    /// <summary>The overnight: "11-hour daily rest" or "10-hour reset".</summary>
    public static string Reset(AppSettings s) =>
        Eu ? $"{R(s).RegularDailyRest:0.#}-hour daily rest" : $"{s.Hos.OffDutyReset:0.#}-hour reset";

    /// <summary>How long the overnight is, in hours.</summary>
    public static double ResetHours(AppSettings s) => Eu ? R(s).RegularDailyRest : s.Hos.OffDutyReset;

    /// <summary>The long one: "weekly rest" or "34-hour restart".</summary>
    public static string Restart(AppSettings s) => Eu ? "weekly rest" : $"{s.Hos.CycleRestartHours:0.#}-hour restart";

    /// <summary>Dock work that is not driving: EU "other work", US "on-duty time".</summary>
    public static string DockWork => Eu ? "other work" : "on-duty time";

    /// <summary>Where the clocks are read: the HOS companion app in ETS2, the HOS display in ATS.</summary>
    public static string Display => Eu ? "HOS app" : "HOS display";

    /// <summary>The licence for dangerous goods: an ADR certificate, or a hazmat endorsement.</summary>
    public static string Endorsement => Eu ? "ADR certificate" : "hazmat endorsement";

    /// <summary>A state, or a country.</summary>
    public static string Region => Eu ? "country" : "state";
}
