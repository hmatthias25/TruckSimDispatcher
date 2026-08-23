using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Working out when a load is actually due.
///
/// The delivery window becomes the appointment the driver is judged against, so a wrong one is not a
/// cosmetic problem — it decides whether they were late. It has to come from the game, and where the
/// arithmetic is ours to do, we do it here rather than asking a model to do it.
///
/// ATS shows the window as a <b>time range</b>: "6:15 AM - 12:55 PM". The end of that range is the
/// appointment; the start is when the receiver will actually take the load, which is why a nineteen-mile
/// run can still be hours away from being deliverable. The screenshot reader used to be asked to turn
/// that into "hours available to deliver" while never being told what time it was, and could not answer
/// "I could not tell" because the field was required — so it guessed, and a 6:01 dispatch against a
/// 12:55 appointment came back as a flat eight hours.
/// </summary>
public static class DeliveryWindow
{
    /// <summary>A window read off a listing: when the receiver opens, and when the load is due.</summary>
    public record Parsed(DateTime? OpensAt, DateTime DueAt, double HoursUntilDue, bool HadRange);

    /// <summary>
    /// Reads a delivery window as ATS presents it and works out the hours from now.
    ///
    /// Handles a range ("6:15 AM - 12:55 PM"), a single time ("12:55 PM"), and a day-qualified time
    /// ("Day 3 14:00"). Twelve-hour times with AM/PM are the common case and are read as such. Returns
    /// null when nothing usable can be made of it — an unreadable window is handled properly
    /// everywhere; a guessed one is not.
    /// </summary>
    public static Parsed? Read(AppState s, string? windowText)
    {
        var raw = (windowText ?? "").Trim();
        if (raw.Length == 0) return null;

        var now = GameClock.TryParse(s.Status.GameTime);
        if (now == null) return null;

        // An explicit day number wins, since it removes the ambiguity entirely.
        var dayIdx = raw.IndexOf("day", StringComparison.OrdinalIgnoreCase);
        int? day = null;
        if (dayIdx >= 0)
        {
            var rest = raw[(dayIdx + 3)..].TrimStart(' ', ':', ',');
            var digits = new string(rest.TakeWhile(char.IsDigit).ToArray());
            if (int.TryParse(digits, out var d)) day = d;
        }

        var times = ClockTimes(raw);
        if (times.Count == 0) return null;

        // A range gives an opening time and a due time. A single time is the due time.
        var hadRange = times.Count >= 2;
        var openSpec = hadRange ? times[0] : (TimeSpan?)null;
        var dueSpec = times[^1];

        DateTime Resolve(TimeSpan tod, DateTime notBefore)
        {
            if (day is { } dd) return GameClock.FromDay(dd, tod.Hours, tod.Minutes);
            var candidate = notBefore.Date.Add(tod);
            // A window that has already passed today is tomorrow's.
            if (candidate < notBefore.AddMinutes(-1)) candidate = candidate.AddDays(1);
            return candidate;
        }

        var opens = openSpec is { } o ? Resolve(o, now.Value) : (DateTime?)null;
        var due = Resolve(dueSpec, opens ?? now.Value);
        // A range that wrapped midnight: the end must not land before the start.
        if (opens is { } op && due < op) due = due.AddDays(1);

        var hours = (due - now.Value).TotalHours;
        if (hours <= 0) return null;

        return new Parsed(opens, due, Math.Round(hours, 2), hadRange);
    }

    /// <summary>Hours until the load is due, or null when the text cannot be read.</summary>
    public static double? HoursUntil(AppState s, string? windowText) => Read(s, windowText)?.HoursUntilDue;

    /// <summary>FNV-1a, so a slot and a receiver's mood are stable and cannot be re-rolled by reloading.</summary>
    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }

    /// <summary>
    /// The booked slot inside a window.
    ///
    /// ATS gives a range; a dock gives you a time. Targeting the front of the range meant every load was
    /// planned to arrive the moment the doors unlocked, which is not how an appointment works and threw
    /// away the difference as dead time.
    ///
    /// Kept off both edges — a slot right on opening or right on closing is not really a slot — and
    /// rounded to the half hour, because that is how docks book.
    ///
    /// Deliberately in the front half of the window. A slot near the close leaves no room for the dock
    /// work itself, which turned loads that had always been runnable into ones the planner refused —
    /// a difficulty change smuggled in by a cosmetic one. <see cref="TailRoomHours"/> keeps clear of
    /// the close so unloading still fits.
    /// </summary>
    public static DateTime AppointmentIn(DateTime opensAt, DateTime dueAt, string seedKey)
    {
        var span = (dueAt - opensAt).TotalHours;
        if (span <= 0.5) return opensAt;

        var frac = 0.10 + (Hash("slot|" + seedKey) % 46) / 100.0;      // 0.10 .. 0.55 of the window
        var at = opensAt.AddHours(span * frac);
        var halves = Math.Round((at - opensAt.Date).TotalHours * 2, MidpointRounding.AwayFromZero) / 2;
        var slot = opensAt.Date.AddHours(halves);

        // Never so late that the dock work cannot finish inside the window.
        var latest = dueAt.AddHours(-TailRoomHours);
        if (latest < opensAt) latest = opensAt;
        if (slot > latest) slot = latest;
        return slot < opensAt ? opensAt : slot;
    }

    /// <summary>Hours kept clear before the window closes, so unloading still fits after the slot.</summary>
    private const double TailRoomHours = 3;

    /// <summary>
    /// Whether this receiver will take the load whenever it turns up.
    ///
    /// A quiet week and a free dock. Uncommon on purpose — a window nobody keeps is not a window — and
    /// decided at dispatch rather than on arrival, so the hours it frees are bankable against a reload
    /// instead of a surprise the driver could not have planned around.
    /// </summary>
    public static bool TakesEarly(AppState s, string seedKey) =>
        Hash("early|" + seedKey) % 100 < Math.Clamp(s.Settings.ReceiverTakesEarlyPct, 0, 100);

    /// <summary>
    /// Every clock time in a string, in order, resolved through any AM/PM marker that follows it.
    ///
    /// "6:15 AM - 12:55 PM" gives 06:15 and 12:55. Without the AM/PM handling a 2:55 PM appointment
    /// would be read as ten hours early, which is exactly the kind of quiet error that turns into a
    /// service failure.
    /// </summary>
    private static List<TimeSpan> ClockTimes(string text)
    {
        var found = new List<TimeSpan>();
        var i = 0;
        while (i < text.Length)
        {
            if (!char.IsDigit(text[i])) { i++; continue; }

            var hDigits = new string(text[i..].TakeWhile(char.IsDigit).ToArray());
            var after = i + hDigits.Length;
            if (after >= text.Length || text[after] != ':') { i = after; continue; }

            var mDigits = new string(text[(after + 1)..].TakeWhile(char.IsDigit).ToArray());
            if (mDigits.Length == 0) { i = after + 1; continue; }

            var end = after + 1 + mDigits.Length;
            if (!int.TryParse(hDigits, out var hh) || !int.TryParse(mDigits, out var mm)
                || hh > 23 || mm > 59) { i = end; continue; }

            // Look just past the time for an am/pm marker.
            var tail = text[end..Math.Min(text.Length, end + 4)].TrimStart(' ', '.');
            if (tail.StartsWith("pm", StringComparison.OrdinalIgnoreCase) && hh < 12) hh += 12;
            else if (tail.StartsWith("am", StringComparison.OrdinalIgnoreCase) && hh == 12) hh = 0;

            if (hh < 24) found.Add(new TimeSpan(hh, mm, 0));
            i = end;
        }
        return found;
    }

    /// <summary>What a run genuinely needs: driving, the dock at both ends, and the trip either side.</summary>
    public static double HoursNeeded(AppState s, double totalMiles, string? trailerType)
    {
        var cfg = s.Settings;
        var mph = Math.Max(5, cfg.GovernedMph * Math.Clamp(cfg.SpeedFactor, 0.3, 1.0));
        var dock = FacilityLearning.For(s, trailerType ?? "");
        return Math.Max(0, totalMiles) / mph
               + dock.Loading + dock.Unloading
               + cfg.PreTripHours + cfg.PostTripHours;
    }

    /// <summary>
    /// Does this window make sense for this run?
    ///
    /// A check, never a correction. ATS genuinely gives generous windows on short runs, so a flagged
    /// row is a question for the driver rather than an error — they confirm and it goes through. What
    /// it catches is the window that is impossible, or so far out of proportion that it was almost
    /// certainly never on the screen.
    /// </summary>
    public static string? Implausible(AppState s, double deadlineHours, double totalMiles, string? trailerType)
    {
        if (deadlineHours <= 0 || totalMiles <= 0) return null;
        var needed = HoursNeeded(s, totalMiles, trailerType);
        if (needed <= 0) return null;

        if (deadlineHours < needed)
            return $"{Hhmm.Of(deadlineHours)} to deliver, but {totalMiles:N0} mi needs about {Hhmm.Of(needed)} " +
                   "with the dock at both ends. Check the window — as read, this load cannot be run.";

        // Ten times what the run needs, and at least half a day clear of it, before we say anything.
        if (deadlineHours > needed * 10 && deadlineHours - needed > 12)
            return $"{Hhmm.Of(deadlineHours)} to deliver on a {totalMiles:N0} mi run that needs about " +
                   $"{Hhmm.Of(needed)}. That may well be what the board said, but check it — a window read " +
                   "wrong becomes the appointment you are judged against.";

        return null;
    }
}
