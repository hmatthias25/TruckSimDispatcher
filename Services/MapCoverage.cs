using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Where the driver's map actually goes.
///
/// <para>ATS ships the western states and grows a few at a time. Map mods do not: Coast to Coast lays
/// the whole continent down at once, Promods and the regional packs add their own, and a player running
/// any of them has a world far bigger than the one they intend to work in. The freight board does not
/// know that. A driver on C2C who only wants the west gets offered Maine, and the only thing standing
/// between them and a four-day deadhead is remembering to say no every time.</para>
///
/// <para>So this is a list the player keeps, of the states and provinces they are willing to run, and a
/// gate on the board that holds them to it. <b>It is a statement about the map, not about the freight.</b>
/// A region that is switched off is not a region where the loads are bad — it is one the driver does not
/// go to, and the rejection says so in those words rather than pretending to have judged the load.</para>
///
/// <para><b>Both ends.</b> The player's own framing was loads dispatched FROM a region, which is the
/// obvious half. The other half matters as much: a load delivering INTO a state the driver does not run
/// puts the truck there, at the end of a run, with an empty trailer and nothing to pull out. Where a
/// region is off, the app neither takes freight out of it nor sends the truck into it.</para>
///
/// <para><b>Nothing is guessed about the route.</b> The app has coordinates and no roads, so it has no
/// honest opinion about which states a run passes through. Two cities are two facts; everything between
/// them is the player's map and the player's problem. There is no pass-through check here and there
/// should not be one.</para>
/// </summary>
public static class MapCoverage
{
    /// <summary>One region the driver can switch on or off, as the game and the paperwork name it.</summary>
    public record Region(string Code, string Name, string Country);

    /// <summary>
    /// The regions on offer, in the order they are shown.
    ///
    /// The 50 states and DC, then Canada, then Mexico. Alaska and Hawaii are here because the player
    /// asked for all US states and because a mod may yet add them — an entry nobody ticks costs nothing,
    /// and a missing one cannot be ticked at all.
    /// </summary>
    public static readonly IReadOnlyList<Region> All = new List<Region>
    {
        new("AL", "Alabama", "US"), new("AK", "Alaska", "US"), new("AZ", "Arizona", "US"),
        new("AR", "Arkansas", "US"), new("CA", "California", "US"), new("CO", "Colorado", "US"),
        new("CT", "Connecticut", "US"), new("DE", "Delaware", "US"), new("DC", "District of Columbia", "US"),
        new("FL", "Florida", "US"), new("GA", "Georgia", "US"), new("HI", "Hawaii", "US"),
        new("ID", "Idaho", "US"), new("IL", "Illinois", "US"), new("IN", "Indiana", "US"),
        new("IA", "Iowa", "US"), new("KS", "Kansas", "US"), new("KY", "Kentucky", "US"),
        new("LA", "Louisiana", "US"), new("ME", "Maine", "US"), new("MD", "Maryland", "US"),
        new("MA", "Massachusetts", "US"), new("MI", "Michigan", "US"), new("MN", "Minnesota", "US"),
        new("MS", "Mississippi", "US"), new("MO", "Missouri", "US"), new("MT", "Montana", "US"),
        new("NE", "Nebraska", "US"), new("NV", "Nevada", "US"), new("NH", "New Hampshire", "US"),
        new("NJ", "New Jersey", "US"), new("NM", "New Mexico", "US"), new("NY", "New York", "US"),
        new("NC", "North Carolina", "US"), new("ND", "North Dakota", "US"), new("OH", "Ohio", "US"),
        new("OK", "Oklahoma", "US"), new("OR", "Oregon", "US"), new("PA", "Pennsylvania", "US"),
        new("RI", "Rhode Island", "US"), new("SC", "South Carolina", "US"), new("SD", "South Dakota", "US"),
        new("TN", "Tennessee", "US"), new("TX", "Texas", "US"), new("UT", "Utah", "US"),
        new("VT", "Vermont", "US"), new("VA", "Virginia", "US"), new("WA", "Washington", "US"),
        new("WV", "West Virginia", "US"), new("WI", "Wisconsin", "US"), new("WY", "Wyoming", "US"),

        new("AB", "Alberta", "CA"), new("BC", "British Columbia", "CA"), new("MB", "Manitoba", "CA"),
        new("NB", "New Brunswick", "CA"), new("NL", "Newfoundland and Labrador", "CA"),
        new("NS", "Nova Scotia", "CA"), new("NT", "Northwest Territories", "CA"), new("NU", "Nunavut", "CA"),
        new("ON", "Ontario", "CA"), new("PE", "Prince Edward Island", "CA"), new("QC", "Quebec", "CA"),
        new("SK", "Saskatchewan", "CA"), new("YT", "Yukon", "CA"),

        new("AGU", "Aguascalientes", "MX"), new("BCN", "Baja California", "MX"),
        new("BCS", "Baja California Sur", "MX"), new("CAM", "Campeche", "MX"), new("CHP", "Chiapas", "MX"),
        new("CHH", "Chihuahua", "MX"), new("CMX", "Ciudad de México", "MX"), new("COA", "Coahuila", "MX"),
        new("COL", "Colima", "MX"), new("DUR", "Durango", "MX"), new("GUA", "Guanajuato", "MX"),
        new("GRO", "Guerrero", "MX"), new("HID", "Hidalgo", "MX"), new("JAL", "Jalisco", "MX"),
        new("MEX", "Estado de México", "MX"), new("MIC", "Michoacán", "MX"), new("MOR", "Morelos", "MX"),
        new("NAY", "Nayarit", "MX"), new("NLE", "Nuevo León", "MX"), new("OAX", "Oaxaca", "MX"),
        new("PUE", "Puebla", "MX"), new("QUE", "Querétaro", "MX"), new("ROO", "Quintana Roo", "MX"),
        new("SLP", "San Luis Potosí", "MX"), new("SIN", "Sinaloa", "MX"), new("SON", "Sonora", "MX"),
        new("TAB", "Tabasco", "MX"), new("TAM", "Tamaulipas", "MX"), new("TLA", "Tlaxcala", "MX"),
        new("VER", "Veracruz", "MX"), new("YUC", "Yucatán", "MX"), new("ZAC", "Zacatecas", "MX"),
    };

    /// <summary>
    /// What a career starts with: every US state and DC, and nothing outside the country.
    ///
    /// The player's own default. Base ATS is a subset of this and always will be, so a US-only list costs
    /// a stock career nothing — there is no Maine freight to reject if there is no Maine — while a C2C
    /// career gets the sensible half of the continent on day one and turns Canada on deliberately.
    /// </summary>
    public static List<string> DefaultSelection() =>
        All.Where(r => r.Country == "US").Select(r => r.Code).ToList();

    private static string Norm(string? code) => (code ?? "").Trim().ToUpperInvariant();

    /// <summary>Whether a code is one of the regions on the list at all.</summary>
    public static bool Known(string? code) =>
        All.Any(r => r.Code.Equals(Norm(code), StringComparison.OrdinalIgnoreCase));

    public static Region? Find(string? code) =>
        All.FirstOrDefault(r => r.Code.Equals(Norm(code), StringComparison.OrdinalIgnoreCase));

    /// <summary>The region's own name where we know it, and whatever the driver typed where we do not.</summary>
    public static string Label(string? code) =>
        Find(code) is { } r ? r.Name : Norm(code);

    /// <summary>
    /// The list in force, with an empty one read as the default rather than as a total block.
    ///
    /// A career file that has never seen this setting, or one whose list got emptied, must not answer
    /// "no" to every load on the board — that is a failure mode indistinguishable from the app being
    /// broken, and it would arrive without a word of explanation. Empty means unset, and unset means the
    /// default. Switching the whole country off is not a thing anybody means.
    /// </summary>
    public static IReadOnlyCollection<string> Selected(AppState s)
    {
        var chosen = s.Settings.RunnableStates;
        if (chosen == null || chosen.Count == 0) return DefaultSelection();
        return chosen.Select(Norm).Where(c => c.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Whether the driver runs this region.
    ///
    /// <b>An unrecognised code is allowed.</b> Map mods rename and invent regions, and a driver typing a
    /// state this app has never heard of is telling us about their map, not asking permission. Refusing
    /// what we cannot identify would turn every mod into a wall of rejections the player cannot clear,
    /// which is the opposite of what the setting is for. Same rule as the city table: absence of data is
    /// not evidence.
    ///
    /// A blank state is allowed too — a load typed in without one has not said anything to disagree with.
    /// </summary>
    public static bool Allows(AppState s, string? code)
    {
        var c = Norm(code);
        if (c.Length == 0) return true;
        if (!Known(c)) return true;
        return Selected(s).Contains(c);
    }

    /// <summary>
    /// Why this load is off the table, or null where it is not.
    ///
    /// Both ends, origin first, because that is the one the driver is standing next to. Where both are
    /// off it is said once with both named — two rejections for one decision reads as two problems.
    /// </summary>
    public static string? RejectionFor(AppState s, BoardLoad load)
    {
        var from = Norm(load.OriginState);
        var to = Norm(load.DestState);
        var fromBad = from.Length > 0 && !Allows(s, from);
        var toBad = to.Length > 0 && !Allows(s, to);

        if (!fromBad && !toBad) return null;

        const string tail = " That is your map setting, not a judgement on the load — switch the region on " +
                            "under Settings if you are running it now.";

        if (fromBad && toBad && !from.Equals(to, StringComparison.OrdinalIgnoreCase))
            return $"You do not run {Label(from)} or {Label(to)}, and this load starts in one and finishes " +
                   $"in the other." + tail;

        if (fromBad && toBad)
            return $"You do not run {Label(from)}, and this load both starts and finishes there." + tail;

        return fromBad
            ? $"You do not run {Label(from)}, which is where this one loads." + tail
            : $"You do not run {Label(to)}, which is where this one delivers." + tail;
    }

    /// <summary>
    /// The truck is parked somewhere the driver has switched off.
    ///
    /// Every load on the board is then rejected on its origin, which is correct and reads as the app
    /// having lost its mind — a screen of identical refusals with no single line saying what is actually
    /// wrong. This is that line. It does not block anything by itself; it explains the blocking.
    ///
    /// Happens honestly: a player turns a region off while sitting in it, or drives in before deciding
    /// they are done with it. The way out is to switch it back on long enough to get a load out, and
    /// that is worth saying rather than leaving them to work out.
    /// </summary>
    public static string? StrandedNote(AppState s)
    {
        var here = Norm(s.Status.LocationState);
        if (here.Length == 0 || Allows(s, here)) return null;

        return $"The truck is in {Label(here)} and you have {Label(here)} switched off, so everything " +
               "loading here is refused on the map setting alone. Nothing will come off this board until " +
               $"you either switch {Label(here)} back on long enough to get a load out of it, or move the " +
               "truck under your own steam.";
    }

    /// <summary>
    /// Clean a list coming in off the settings form.
    ///
    /// Unknown codes are dropped rather than kept: the list is a set of checkboxes this app drew, so
    /// anything else in it is a typo or a stale file, and keeping it would put a region in the career
    /// that no screen can ever show or clear. Gating a LOAD is the opposite case and stays permissive —
    /// see <see cref="Allows"/>.
    /// </summary>
    public static List<string> Clean(IEnumerable<string>? incoming) =>
        (incoming ?? Enumerable.Empty<string>())
            .Select(Norm)
            .Where(Known)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => All.ToList().FindIndex(r => r.Code == c))
            .ToList();

    /// <summary>The picker, for the settings screen. Everything it needs and nothing it has to look up.</summary>
    public static object View(AppState s)
    {
        var on = Selected(s);
        return new
        {
            regions = All.Select(r => new { code = r.Code, name = r.Name, country = r.Country, on = on.Contains(r.Code) }),
            selectedCount = All.Count(r => on.Contains(r.Code)),
            usDefault = DefaultSelection(),
            strandedNote = StrandedNote(s),
        };
    }
}
