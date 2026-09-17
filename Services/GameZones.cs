using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// The clock jumping when you cross a state line.
///
/// <para>ATS has had time zones since 1.29, behind a gameplay option: <b>Disabled</b> (the game's own
/// default), <b>Only time</b>, and <b>Full info</b>. The last two differ only in whether the zone is
/// named on screen — under both, the clock changes as you cross between states in different zones, so
/// as far as this app is concerned there are two states of the world and not three.</para>
///
/// <para>The app cannot see the setting, so it has to be told: <see cref="AppSettings.TimeZonesOn"/>.
/// Off is the default and reproduces the arithmetic exactly as it was before any of this existed, which
/// is the right answer for a default ATS install and leaves every stored career reading the same.</para>
///
/// <para><b>Why it matters.</b> With zones on, <c>Status.GameTime</c> is local time <i>at the truck</i>,
/// while a delivery window read off the job board is local time <i>at the receiver</i>. Subtracting one
/// from the other — which is what the app did — is wrong by the offset between them, and wrong in the
/// dangerous direction eastbound: a run into a later zone looks like it has two more hours than it has,
/// so the load is authorised and the driver is late through no fault of their own. Westbound the error
/// reverses and merely turns down freight that was comfortable.</para>
///
/// <para><b>Standard time, always.</b> ATS does not observe daylight saving, so an offset here is a
/// fixed property of a state and never of a date. That is the whole reason this can be an exact lookup
/// rather than a calendar.</para>
///
/// <para><b>The game's map, not the real one.</b> ATS assigns a zone to a whole state. Reality splits
/// several of them — northern Idaho is Pacific, western Kansas and the Texas panhandle are Mountain,
/// eastern Oregon is Mountain — and the app has to match the clock in the player's game rather than the
/// one outside their window. Where the two disagree, the game wins.</para>
/// </summary>
public static class GameZones
{
    /// <summary>
    /// Hours ahead of Pacific. Only the differences are ever used, so the base is arbitrary — Pacific
    /// is zero because it is the western edge of the ATS map and makes every value non-negative.
    /// </summary>
    public const int Pacific = 0, Mountain = 1, Central = 2,Eastern = 3;

    /// <summary>
    /// Which zone each state keeps.
    ///
    /// The first three rows are what the game is documented to do. The rest are the predominant real-world
    /// zone, held ready for states ATS has not reached or that were added after this was written — they
    /// are an inference and should be corrected against the game the moment anybody runs freight there.
    /// A state that is not in this table has no offset and produces no shift at all, which is the honest
    /// answer for somewhere we cannot place.
    /// </summary>
    private static readonly Dictionary<string, int> ByState = new(StringComparer.OrdinalIgnoreCase)
    {
        // --- documented ATS assignments
        ["CA"] = Pacific, ["NV"] = Pacific, ["OR"] = Pacific, ["WA"] = Pacific,
        ["AZ"] = Mountain, ["CO"] = Mountain, ["ID"] = Mountain, ["MT"] = Mountain,
        ["NM"] = Mountain, ["UT"] = Mountain, ["WY"] = Mountain,
        ["KS"] = Central, ["OK"] = Central, ["TX"] = Central,

        // --- inferred from the real map, pending somebody driving them
        ["ND"] = Central, ["SD"] = Central, ["NE"] = Central, ["MN"] = Central, ["IA"] = Central,
        ["MO"] = Central, ["AR"] = Central, ["LA"] = Central, ["WI"] = Central, ["IL"] = Central,
        ["MS"] = Central, ["AL"] = Central, ["TN"] = Central,
        ["MI"] = Eastern, ["IN"] = Eastern, ["OH"] = Eastern, ["KY"] = Eastern, ["WV"] = Eastern,
        ["VA"] = Eastern, ["NC"] = Eastern, ["SC"] = Eastern, ["GA"] = Eastern, ["FL"] = Eastern,
        ["PA"] = Eastern, ["NY"] = Eastern, ["NJ"] = Eastern, ["DE"] = Eastern, ["MD"] = Eastern,
        ["DC"] = Eastern, ["CT"] = Eastern, ["RI"] = Eastern, ["MA"] = Eastern, ["VT"] = Eastern,
        ["NH"] = Eastern, ["ME"] = Eastern,
    };

    /// <summary>The zone a state keeps, or null for one the table cannot place.</summary>
    public static int? ZoneOf(string? state)
    {
        var key = (state ?? "").Trim();
        return key.Length > 0 && ByState.TryGetValue(key, out var z) ? z : null;
    }

    /// <summary>Whether the player runs with the game's time zones switched on.</summary>
    public static bool On(AppState s) => s.Settings.TimeZonesOn;

    /// <summary>
    /// How far the clock moves driving from one state to the other. Positive going east — leave Nevada
    /// for Utah and the clock jumps an hour forward.
    ///
    /// Zero whenever the answer is not known to be anything else: zones switched off, either state
    /// unplaceable, or a run that never leaves its zone. That is deliberate — a guessed offset is worse
    /// than none, because it moves an appointment the driver is judged against.
    /// </summary>
    public static double ShiftHours(AppState s, string? fromState, string? toState)
    {
        if (!On(s)) return 0;
        if (ZoneOf(fromState) is not { } from || ZoneOf(toState) is not { } to) return 0;
        return to - from;
    }

    /// <summary>
    /// A time on the clock at <paramref name="fromState"/>, restated as the clock at
    /// <paramref name="toState"/> will read at that same moment.
    /// </summary>
    public static DateTime Restate(AppState s, DateTime at, string? fromState, string? toState) =>
        at.AddHours(ShiftHours(s, fromState, toState));

    /// <summary>
    /// The state the truck is standing in — the zone <see cref="DriverStatus.GameTime"/> is kept in.
    /// </summary>
    public static string HereState(AppState s) => s.Status.LocationState ?? "";

    /// <summary>
    /// A moment at the receiver, as the driver's own HUD will read it when they get there.
    ///
    /// Everything the planner computes runs on the clock where the truck is now, because that is the
    /// clock the driver typed in. Anything they will read off the game standing at the dock — a
    /// projected arrival, an appointment, a window closing — has to be handed back in the receiver's
    /// zone instead, or the app and the game disagree by the offset at exactly the moment the driver is
    /// acting on it.
    /// </summary>
    public static DateTime AtReceiver(AppState s, DateTime hereTime, string? destState) =>
        Restate(s, hereTime, HereState(s), destState);

    /// <summary>The inverse: a time read off the receiver's clock, put back on the clock here.</summary>
    public static DateTime BackHere(AppState s, DateTime thereTime, string? destState) =>
        Restate(s, thereTime, destState, HereState(s));

    /// <summary>
    /// What to call a zone when saying so out loud. Standard time only, because ATS keeps no other.
    /// </summary>
    public static string NameOf(int zone) => zone switch
    {
        Pacific => "PST", Mountain => "MST", Central => "CST", Eastern => "EST", _ => "",
    };

    /// <summary>
    /// The sentence to put in front of a driver whose load crosses a boundary, or empty where it does
    /// not. The hours are the point, not the zone names: gaining two is two more hours of window and
    /// losing two is two fewer, and which of those it is decides whether the run is worth taking.
    /// </summary>
    public static string NoteFor(AppState s, string? fromState, string? toState)
    {
        var shift = ShiftHours(s, fromState, toState);
        if (shift == 0) return "";

        var from = ZoneOf(fromState)!.Value;
        var to = ZoneOf(toState)!.Value;
        var hours = Hhmm.Of(Math.Abs(shift));
        return shift > 0
            ? $"You cross from {NameOf(from)} into {NameOf(to)} on this run, so the clock jumps {hours} " +
              $"forward and you lose {hours} of the day. The delivery time on the board is {NameOf(to)} " +
              "— it is nearer than it looks."
            : $"You cross from {NameOf(from)} into {NameOf(to)} on this run, so the clock goes {hours} " +
              $"back and you get {hours} of the day returned. The delivery time on the board is " +
              $"{NameOf(to)}, so there is more room here than the clock in the truck suggests.";
    }
}
