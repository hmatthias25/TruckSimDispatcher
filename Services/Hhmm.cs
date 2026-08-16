namespace TruckSimDispatcher.Services;

/// <summary>
/// Durations, written the way a driver reads them.
///
/// Every clock in the cab is hours and minutes. "8.75 h" is a spreadsheet number — the driver has to
/// convert it in their head before it means anything, and half the time they will convert it wrong.
/// So anything the driver reads as a length of time goes through here.
/// </summary>
public static class Hhmm
{
    /// <summary>"8:45". Negative durations clamp to 0:00 — a clock does not run below empty.</summary>
    public static string Of(double hours)
    {
        var h = Math.Max(0, hours);
        var whole = (int)Math.Floor(h + 1e-9);
        var mins = (int)Math.Round((h - whole) * 60);
        if (mins == 60) { whole++; mins = 0; }
        return $"{whole}:{mins:00}";
    }

    public static string Of(decimal hours) => Of((double)hours);

    /// <summary>Unknown stays unknown. Never render a missing clock as 0:00.</summary>
    public static string Of(double? hours) => hours is { } h ? Of(h) : "—";

    /// <summary>Same, but signed — for drift and variance, where the direction is the point.</summary>
    public static string Signed(double hours)
    {
        var sign = hours < 0 ? "-" : "+";
        return sign + Of(Math.Abs(hours));
    }
}
