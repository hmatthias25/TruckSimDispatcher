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

    /// <summary>
    /// The other direction: a clock read off a screen, back into hours.
    ///
    /// Returns null rather than 0 when nothing can be made of the text, because <b>0:00 is a real
    /// reading</b> — it means no hours left. Collapsing "could not read it" into "you are out of
    /// hours" would have dispatch refuse freight over a smudged screenshot.
    /// </summary>
    public static double? Read(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        // Strip anything that is not part of the number: "D 05:58", "05:58 left", "34:42 used".
        var cleaned = new string(text.Where(c => char.IsDigit(c) || c == ':' || c == '.' || c == '-').ToArray());
        if (cleaned.Length == 0) return null;
        if (cleaned.StartsWith('-')) return null;             // a negative clock is a misread

        if (cleaned.Contains(':'))
        {
            var bits = cleaned.Split(':', StringSplitOptions.RemoveEmptyEntries);
            if (bits.Length < 2) return null;
            if (!int.TryParse(bits[0], out var h) || !int.TryParse(bits[1], out var m)) return null;
            if (m > 59) return null;                          // 8:70 is not a clock
            return h + m / 60.0;
        }

        // A bare decimal, for displays that show 8.5 rather than 8:30.
        return double.TryParse(cleaned, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var dec) && dec >= 0
            ? dec
            : null;
    }

    /// <summary>
    /// A day number out of text like "Day 17", "Day 17 00:00" or "17". Null when there is no number,
    /// so a missing day is never mistaken for day zero.
    /// </summary>
    public static int? ReadDay(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var m = System.Text.RegularExpressions.Regex.Match(text, @"\d+");
        return m.Success && int.TryParse(m.Value, out var d) ? d : null;
    }

    /// <summary>Same, but signed — for drift and variance, where the direction is the point.</summary>
    public static string Signed(double hours)
    {
        var sign = hours < 0 ? "-" : "+";
        return sign + Of(Math.Abs(hours));
    }
}
