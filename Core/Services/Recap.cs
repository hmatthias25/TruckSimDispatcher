using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Recap versus the 34-hour restart — the decision drivers get wrong most often, and the one that
/// costs the most when they do.
///
/// The 70-hour cycle is a <b>rolling 8-day window</b>, not a tank that empties and gets refilled.
/// Every midnight, the hours worked 8 days ago drop out of the window and come back. That is recap,
/// and nobody has to earn it — it happens because time passed.
///
/// So there are two ways to get cycle hours back and they are nothing alike. Recap returns only what
/// was worked 8 days ago and costs a wait until midnight. A restart returns the whole 70 and costs 34
/// hours parked. Sitting a 34 when four hours of waiting would have done is a day and a half thrown
/// away; waiting on a recap that turns out to be 2:00 when the load needs 8:00 is a wasted night.
/// Which one is right is a dispatch decision, so dispatch makes it and shows the arithmetic.
///
/// The projection is always the driver's. The app cannot see the game, an HOS mod displays recap
/// directly, and inventing a schedule from trip history would be fabricating clock values.
/// </summary>
public static class Recap
{
    public class Advice
    {
        /// <summary>None | Wait | Restart | NoData</summary>
        public string Verdict { get; set; } = "None";
        /// <summary>Hours the driver reported coming back at the next rollover.</summary>
        public double NextHours { get; set; }
        /// <summary>Days from now that batch arrives. 1 = tonight's midnight.</summary>
        public int NextInDays { get; set; }
        /// <summary>When those hours land, as a game time.</summary>
        public string ArrivesGameTime { get; set; } = "";
        /// <summary>Hours until then.</summary>
        public double WaitHours { get; set; }
        /// <summary>Cycle after the recap lands.</summary>
        public double CycleAfter { get; set; }
        /// <summary>What the driver needs to run the work in front of them, when we know it.</summary>
        public double NeededHours { get; set; }
        /// <summary>Total recap reported across every batch.</summary>
        public double TotalReported { get; set; }
        public string Headline { get; set; } = "";
        public List<string> Lines { get; set; } = new();
    }

    /// <summary>The next batch of recap hours due, or null when the driver has reported none.</summary>
    public static RecapDay? NextBatch(AppState s) =>
        s.Hos.Recap.Where(r => r.Hours > 0 && r.InDays > 0).OrderBy(r => r.InDays).FirstOrDefault();

    /// <summary>
    /// Hours until the day rolls over <paramref name="inDays"/> times. Recap lands at midnight, so
    /// "in 1 day" from 20:00 is four hours away, not twenty-four.
    /// </summary>
    public static double HoursUntilRollover(AppState s, int inDays)
    {
        var now = GameClock.TryParse(s.Status.GameTime);
        if (now == null) return Math.Max(0, inDays) * 24.0;
        var midnight = now.Value.Date.AddDays(Math.Max(1, inDays));
        return Math.Max(0, (midnight - now.Value).TotalHours);
    }

    /// <summary>
    /// Should the driver wait for recap or sit the 34?
    ///
    /// <paramref name="neededHours"/> is what the work in front of them costs in cycle time. Pass 0
    /// when that is unknown and the advice falls back to comparing the wait against the restart on
    /// time alone, which is still the useful half of the answer.
    /// </summary>
    public static Advice Assess(AppState s, double neededHours = 0)
    {
        var rules = s.Settings.Hos;
        var a = new Advice
        {
            NeededHours = Math.Max(0, neededHours),
            TotalReported = s.Hos.Recap.Where(r => r.Hours > 0).Sum(r => r.Hours)
        };

        var batch = NextBatch(s);
        if (batch == null)
        {
            a.Verdict = "NoData";
            a.Headline = "No recap reported, so I have nothing to weigh against the restart.";
            a.Lines.Add(
                $"Your {rules.CycleLimit:0}-hour cycle is a rolling {rules.CycleDays}-day window: the hours you worked " +
                $"{rules.CycleDays} days ago come back to you at midnight. That is recap, and it is often the difference " +
                $"between waiting a few hours and sitting a {rules.CycleRestartHours:0.#}-hour restart.");
            a.Lines.Add("If your HOS display projects hours returning, put them in the recap box on the Dispatch tab and I will work out which is the better play.");
            return a;
        }

        a.NextHours = batch.Hours;
        a.NextInDays = batch.InDays;
        a.WaitHours = HoursUntilRollover(s, batch.InDays);
        a.CycleAfter = Math.Min(rules.CycleLimit, Math.Max(0, s.Hos.CycleRemaining) + batch.Hours);

        if (GameClock.TryParse(s.Status.GameTime) is { } now)
            a.ArrivesGameTime = GameClock.Format(now.Date.AddDays(Math.Max(1, batch.InDays)));

        var when = string.IsNullOrEmpty(a.ArrivesGameTime) ? "the next rollover" : GameClock.Pretty(a.ArrivesGameTime);
        var enough = a.NeededHours <= 0 || a.CycleAfter >= a.NeededHours;

        // Waiting only wins if it is genuinely shorter than the restart. Two days of waiting for six
        // hours back is not a saving, it is a slower restart.
        var worthWaiting = a.WaitHours < rules.CycleRestartHours;

        if (enough && worthWaiting)
        {
            a.Verdict = "Wait";
            a.Headline = $"Do not take the {rules.CycleRestartHours:0.#}. You get {Hhmm.Of(a.NextHours)} back at {when}.";
            a.Lines.Add($"That is {Hhmm.Of(a.WaitHours)} from now, and it puts your cycle at {Hhmm.Of(a.CycleAfter)}.");
            if (a.NeededHours > 0)
                a.Lines.Add($"This work needs {Hhmm.Of(a.NeededHours)} of cycle, so that clears it.");
            a.Lines.Add($"Park, take your {rules.OffDutyReset:0.#}-hour rest, and roll after {when}. " +
                        $"Sitting the {rules.CycleRestartHours:0.#}-hour restart instead would cost you " +
                        $"{Hhmm.Of(rules.CycleRestartHours - a.WaitHours)} more for hours you do not need yet.");
            a.Lines.Add($"Recap is just the {rules.CycleDays}-day window rolling forward — the hours you worked " +
                        $"{rules.CycleDays} days ago coming back. You do not have to do anything to get them.");
            return a;
        }

        a.Verdict = "Restart";
        if (!enough)
        {
            a.Headline = $"Recap will not cover this — take the {rules.CycleRestartHours:0.#}.";
            a.Lines.Add($"You get {Hhmm.Of(a.NextHours)} back at {when}, which puts the cycle at {Hhmm.Of(a.CycleAfter)}. " +
                        $"This work needs {Hhmm.Of(a.NeededHours)}, so you would still be {Hhmm.Of(a.NeededHours - a.CycleAfter)} short.");
        }
        else
        {
            a.Headline = $"Waiting on recap is slower than the restart here — take the {rules.CycleRestartHours:0.#}.";
            a.Lines.Add($"The next {Hhmm.Of(a.NextHours)} is not due until {when}, which is {Hhmm.Of(a.WaitHours)} away — " +
                        $"longer than the {rules.CycleRestartHours:0.#}-hour restart itself.");
        }
        a.Lines.Add($"The restart puts the full {rules.CycleLimit:0} back. Find somewhere with real parking and services to sit it.");
        a.Lines.Add("And note the restart wipes the window clean, so the recap hours go with it. You get the 70, not the 70 plus recap.");
        return a;
    }
}
