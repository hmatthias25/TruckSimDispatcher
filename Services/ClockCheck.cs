using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Cross-checks the four clocks a driver reports against each other, and asks about the one reading
/// that is almost certainly a misread.
///
/// HOS mods cap the drive figure on their display at whatever will stop the driver next. Before the
/// first break of a shift that is the break threshold, not the drive limit, so a fresh clock reads
/// <c>D 8:00  S 14:00  B 8:00  C 70:00</c> when there are eleven hours of legal driving in it. A driver
/// copying their own display types 8:00 into Drive left, which is the sensible thing to do and exactly
/// wrong — the four clocks are independent counters here, so the engine takes the eight literally,
/// drives eight, and parks. Three hours vanish from every shift, and every load judged against that
/// shift is judged on a window three hours too short. The rejection then talks about hours rather than
/// about the misread, which is what makes it invisible.
///
/// Nothing here rewrites anything on its own. The app does not guess at numbers the driver reported,
/// and quietly correcting a clock would be worse than accepting a bad one — but accepting it without
/// comment is the bug. So it asks, and the driver answers.
/// </summary>
public static class ClockCheck
{
    /// <summary>A minute, in hours. Two clocks inside this of each other are the same reading.</summary>
    private const double Epsilon = 1.0 / 60 + 1e-9;

    /// <summary>The driver's answer about their own display, remembered on the rules.</summary>
    public const string CapsUnknown = "";
    public const string CapsYes = "yes";
    public const string CapsNo = "no";

    public class CapQuery
    {
        /// <summary>What the driver typed for Drive left.</summary>
        public double Reported { get; set; }
        /// <summary>What the break clock says.</summary>
        public double BreakClock { get; set; }
        /// <summary>What the drive clock would be if the display is capping at the break.</summary>
        public double Recovered { get; set; }
        /// <summary>Hours of driving at stake if it is a cap and nobody notices.</summary>
        public double AtStake { get; set; }
        /// <summary>Hours already driven, if the two clocks landing together is a genuine coincidence.</summary>
        public double DrivenIfGenuine { get; set; }
        /// <summary>True once the driver has said their display does this.</summary>
        public bool KnownToCap { get; set; }
        public string Question { get; set; } = "";
        public string Capped { get; set; } = "";
        public string Genuine { get; set; } = "";
    }

    /// <summary>
    /// The question to put to the driver about the clocks currently on file, or null when there is
    /// nothing to ask.
    ///
    /// Read off state rather than off a request, so both entry paths — hand entry and the screenshot
    /// reader — get it without either of them knowing about it, and so it survives a page reload. A
    /// query nobody answered is still a query.
    /// </summary>
    public static CapQuery? Capped(AppState s)
    {
        var r = s.Settings.Hos;
        var h = s.Hos;

        if (!r.RequireBreak) return null;                       // no break clock to be capped at
        if (h.CapQueryAnswered) return null;                    // asked about this reading already
        if (r.DriveDisplayCaps == CapsNo) return null;          // driver says their display never does this

        var room = r.DriveLimit - r.DrivingBeforeBreak;
        if (room <= Epsilon) return null;                       // the break threshold IS the drive limit

        // The fingerprint: the drive figure and the break clock reading the same, at or below the break
        // threshold. Above the threshold the display cannot be capping, and 0:00 on both is simply a
        // driver who is out of hours.
        if (h.BreakRemaining <= Epsilon) return null;
        if (h.DriveRemaining > r.DrivingBeforeBreak + Epsilon) return null;
        if (Math.Abs(h.DriveRemaining - h.BreakRemaining) > Epsilon) return null;

        var recovered = Math.Min(r.DriveLimit, room + h.BreakRemaining);
        if (recovered <= h.DriveRemaining + Epsilon) return null;

        var both = Hhmm.Of(h.DriveRemaining);
        var knows = r.DriveDisplayCaps == CapsYes;
        var driven = Math.Max(0, r.DriveLimit - h.DriveRemaining);

        return new CapQuery
        {
            Reported = h.DriveRemaining,
            BreakClock = h.BreakRemaining,
            Recovered = recovered,
            AtStake = recovered - h.DriveRemaining,
            DrivenIfGenuine = driven,
            KnownToCap = knows,
            Question =
                $"Drive left and the break clock are both {both}. " +
                (knows
                    ? "You have told me your display caps the drive figure at the break, and this looks like it. "
                    : "If that is straight off your display, your mod is capping the drive figure at the break. ") +
                "Which is it?",
            Capped =
                $"It is capped — I have {Hhmm.Of(recovered)} of driving. " +
                $"({Hhmm.Of(r.DriveLimit)} limit less the {Hhmm.Of(r.DrivingBeforeBreak)} before a break, " +
                $"plus the {Hhmm.Of(h.BreakRemaining)} on the break clock.)",
            Genuine =
                $"No, {both} is my drive clock. " +
                $"(You have driven {Hhmm.Of(driven)} since your last reset and your break is already behind " +
                "you, which lands both clocks in the same place.)",
        };
    }

    /// <summary>
    /// Re-arms the question. Called wherever clocks are written, because a new reading is a new chance
    /// to have copied a capped figure across — the same figures typed again included.
    /// </summary>
    public static void Rearm(AppState s) => s.Hos.CapQueryAnswered = false;

    /// <summary>
    /// The driver's answer.
    ///
    /// <paramref name="uncap"/> true takes the recovered figure — the only place in the app that changes
    /// a reported clock, and it changes it because the driver just said to. False leaves what they typed
    /// exactly where it is.
    ///
    /// <paramref name="stopAsking"/> is a statement about their HOS mod rather than about this reading:
    /// it is remembered on the rules, so a display that does not cap stops being asked about. Answering
    /// "it is capped" records the opposite fact for the same reason, but never silences the question —
    /// a driver whose display caps can still, genuinely, take their break three hours in and land both
    /// clocks together, and that reading is real.
    /// </summary>
    public static (string Message, double Drive) Answer(AppState s, bool uncap, bool stopAsking)
    {
        var q = Capped(s) ?? throw new InvalidOperationException("There is nothing to settle about your clocks.");

        s.Hos.CapQueryAnswered = true;

        if (uncap)
        {
            s.Settings.Hos.DriveDisplayCaps = CapsYes;
            s.Hos.DriveRemaining = q.Recovered;
            s.Hos.UpdatedUtc = DateTime.UtcNow.ToString("o");
            return ($"Drive clock set to {Hhmm.Of(q.Recovered)} — {Hhmm.Of(q.AtStake)} of driving your display " +
                    "was not showing you yet. I will keep asking whenever both clocks land together, because " +
                    "sometimes they genuinely do.", q.Recovered);
        }

        if (stopAsking) s.Settings.Hos.DriveDisplayCaps = CapsNo;

        return (stopAsking
            ? $"Left at {Hhmm.Of(q.Reported)}, and I will stop asking — your display does not cap the drive " +
              "figure. Turn that back on under Settings if you ever change mods."
            : $"Left at {Hhmm.Of(q.Reported)}, as you reported it.", q.Reported);
    }
}
