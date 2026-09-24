using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Naming a trailer precisely enough to go and buy one.
///
/// "Tanker" is not an instruction. A fuel tanker, a food-grade tanker and a pneumatic dry-bulk tanker
/// are different trailers, carrying different freight, needing different endorsements — and in ATS
/// they are different purchases. The app was telling drivers to "buy a tanker" and leaving the actual
/// decision to them.
/// </summary>
public static class TrailerSpec
{
    /// <summary>The tanker subtypes, with what they haul and what they need.</summary>
    public static readonly (string Key, string Label, string Hauls, bool NeedsHazmat)[] TankerKinds =
    {
        ("Fuel", "fuel tanker", "petroleum, diesel and aviation fuel", true),
        ("Chemical", "chemical tanker", "industrial liquids, usually stainless or lined", true),
        ("Food Grade", "food-grade tanker", "milk, juice and edible liquids — sanitary wash required", false),
        ("Dry Bulk", "dry bulk / pneumatic tanker", "cement, plastic pellets and flour, blown off rather than pumped", false),
        ("Gas", "gas / cryogenic tanker", "pressurised and cryogenic gases — the most specialised end", true),
    };

    /// <summary>How to refer to a trailer in a sentence the driver can act on.</summary>
    public static string Describe(string? type, string? subtype)
    {
        var t = (type ?? "").Trim();
        var sub = (subtype ?? "").Trim();
        if (!IsTanker(t)) return t.Length == 0 ? "trailer" : t.ToLowerInvariant();

        var hit = TankerKinds.FirstOrDefault(k => k.Key.Equals(sub, StringComparison.OrdinalIgnoreCase));
        return hit.Key != null ? hit.Label : "tanker";
    }

    public static bool IsTanker(string? type) =>
        (type ?? "").Trim().Equals("Tanker", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Drop and hook is an arrangement rather than a box, so it is described as one.
    ///
    /// Nothing is bought for it, nothing is loaded on it and nothing about it can be damaged — see
    /// <see cref="DropHook"/>.
    /// </summary>
    public static bool IsDropHook(string? type) => DropHook.Is(type);

    /// <summary>
    /// Whether the driver <b>works</b> the dock, or waits it out.
    ///
    /// <para>This is the difference between two hours that cost a driver their week and two hours that
    /// cost them nothing. Behind a van or a reefer there is nothing for them to do once the doors are
    /// open: the dock has the load, the driver is in the way, and what they actually do is go into the
    /// bunk until somebody bangs on the door. Same with a container — you sit and wait for the crane.
    /// That is sleeper-berth time, and sleeper-berth time is not on-duty time.</para>
    ///
    /// <para>Behind a flatbed or a tanker there is real work: straps, chains, corner boards, a tarp in
    /// the rain, hoses to couple and ground, a wash-out to stand over. The driver is on duty because the
    /// driver is working, and the seventy runs down accordingly.</para>
    ///
    /// <para><b>Unknown counts as work.</b> A type the app does not recognise is treated as hands-on,
    /// because the failure modes are not symmetrical: crediting a driver hours they did not have puts
    /// them over their cycle in the game with an app that told them they were fine.</para>
    /// </summary>
    public static bool WorksTheDock(string? type) =>
        !HandsOffAtTheDock.Contains((type ?? "").Trim());

    /// <summary>
    /// The trailers where the dock does the work and the driver waits.
    ///
    /// Deliberately a short allow-list rather than a list of the types that ARE work: new trailer types
    /// get added to this app regularly, and the safe default for one nobody has classified yet is that
    /// there is something to do behind it.
    /// </summary>
    private static readonly HashSet<string> HandsOffAtTheDock = new(StringComparer.OrdinalIgnoreCase)
    {
        "Dry Van", "Van", "Reefer", "Refrigerated", "Container", "Intermodal",
    };

    /// <summary>
    /// What to tell a driver to buy. Where the subtype is known, name it; where it genuinely is not,
    /// name the options rather than saying "tanker" and leaving them to guess.
    /// </summary>
    /// <summary>
    /// What to actually buy at the ATS trailer dealer, in the words on the dealer screen.
    ///
    /// <para><b>Length and axles, not just a type.</b> Telling somebody to "buy a dry van" leaves them at
    /// a dealer with three lengths and half a dozen axle setups, some of which cannot legally enter
    /// California — and finding that out is a refused delivery a thousand miles later.</para>
    ///
    /// <para>California bans a 53-footer with a <b>spread axle</b>, or with the <b>sliding tandems racked
    /// all the way back</b>: the game models the turning-radius rule. Anything shorter than 53 is fine
    /// whatever the axles do, and a 53 on standard or forward tandems is fine. Sliding tandems are not
    /// the problem — where they are slid TO is.</para>
    ///
    /// <para><b>Singles only.</b> Doubles and triples are a different licence and a different job, and
    /// nothing in this app models running a set. One box behind the truck.</para>
    /// </summary>
    // Plain text, no markup. These strings are rendered through esc() — a <b> in here reaches the player
    // as the literal characters. Reported from play twice in one sitting.
    public const string CaliforniaRule =
        "On the axles: 53' is fine in California on standard or forward tandems. Do NOT take the "
        + "spread-axle version, and do not rack the sliders all the way back — California refuses those "
        + "on the turning-radius rule, and you will not find out until a load takes you there. Anything "
        + "48' or shorter is fine whatever the axles are doing. One trailer: no doubles or triples.";

    /// <summary>
    /// The length this trailer type is issued in. <b>One source, because the advice quotes it.</b>
    ///
    /// This table lived inside <see cref="ForCarrier"/> while <see cref="LengthAdvice"/> wrote the same
    /// lengths out again in prose — two places holding the same fact, free to drift.
    /// </summary>
    public static string LengthFor(string? type)
    {
        var t = (type ?? "").Trim();
        if (DropHook.Is(t)) return "—";
        return t switch
        {
            "Flatbed" or "Step Deck" => "48'",
            "Container" => "53' chassis",
            "Lowboy" => "48' RGN",
            "Tanker" => "42'",
            "Log" or "Dump" or "Hopper" => "40'",
            _ => "53'",
        };
    }

    /// <summary>
    /// What to go and buy, for the trailer the company has put this driver on.
    ///
    /// <para><b>The length is assigned, not offered.</b> This used to end "48' and 45' are also sold if
    /// you would rather have something shorter for city work", which is an owner-operator's decision
    /// being handed to a company driver — the same mistake as letting them pick the trailer at all.
    /// Reported from play in those words. The app issues a unit at a length; the shopping list says what
    /// that unit is, and every "you could also take" is gone.</para>
    ///
    /// <para>What stays is anything that stops the driver buying the WRONG trailer: the reefer that is
    /// not an insulated box, the drop deck that is not a flatbed, the axle configuration California
    /// turns away. Those are not choices, they are ways to get it wrong.</para>
    /// </summary>
    /// <param name="assignedLength">
    /// The length on the unit the driver has actually been issued, where there is one. The advice is
    /// "go and buy the matching trailer", so it quotes the record rather than the table — otherwise a
    /// unit edited on the Equipment tab is a shopping list for a different trailer.
    /// </param>
    public static string LengthAdvice(string? type, string? assignedLength = null)
    {
        var t = (type ?? "").Trim();
        var len = string.IsNullOrWhiteSpace(assignedLength) ? LengthFor(t) : assignedLength.Trim();
        if (IsTanker(t)) return $"At the trailer dealer that is the {len} tank. One tank, not a set.";
        return t switch
        {
            "Dry Van" or "Van" =>
                $"At the trailer dealer that is the {len} dry van. That is the box you are issued — the "
                + "shorter ones are a different unit and not what you are on.",
            "Reefer" or "Refrigerated" =>
                $"At the trailer dealer that is the {len} refrigerated van. The insulated box is a "
                + "different trailer and will not take freight that needs the unit running.",
            "Flatbed" =>
                $"At the trailer dealer that is the {len} flatbed. A drop deck is a different trailer, "
                + "not a longer flatbed — do not come back with one.",
            "Step Deck" =>
                $"At the trailer dealer that is the {len} drop deck. Not the flatbed, and not the 53' "
                + "drop deck.",
            "Lowboy" => $"At the trailer dealer that is the {len} lowboy, for heavy haul.",
            "Log" => $"At the trailer dealer that is the {len} log trailer. Logs only; nothing else "
                     + "loads on it.",
            "Livestock" => $"At the trailer dealer that is the {len} livestock trailer. Livestock only.",
            "Hopper" or "Dump" => $"At the trailer dealer that is the {len} dumper. Bulk only.",
            // Intermodal rides a chassis, not a box. This division used to hand out a 53' dry van, which
            // is simply a different trailer — reported from play looking at a unit labelled "Intermodal"
            // and typed "53' Dry Van". ATS sells a container carrier and has since ownable trailers
            // arrived, so there is no reason to approximate it.
            "Container" =>
                $"At the trailer dealer that is the {len} container carrier — a chassis, not a box. It "
                + "carries the 20' and 40' containers as well, with the locks moved. Take the tandem: "
                + "the triple-axle version is one of the configurations California refuses.",
            _ => "",
        };
    }

    public static string BuyingAdvice(AppState s, string? type, string? subtype)
    {
        if (!IsTanker(type)) return "";

        var known = TankerKinds.FirstOrDefault(k => k.Key.Equals((subtype ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        if (known.Key != null)
            return $"a {known.Label} — {known.Hauls}." +
                   (known.NeedsHazmat ? " Placarded, so you need the hazmat endorsement." : "");

        // No subtype on file. Suggest what the carrier's freight actually implies, and list the rest.
        var likely = LikelyFor(s);
        var others = TankerKinds.Where(k => k.Key != likely.Key).Select(k => k.Label);
        return $"a tanker — most likely a {likely.Label} for {s.Company.Name}'s freight ({likely.Hauls}). " +
               $"The alternatives are {string.Join(", ", others)}. Set the subtype on the Equipment tab once you know.";
    }

    /// <summary>
    /// Trailer types ATS will actually sell. Anything else can be pulled, but never owned.
    ///
    /// <b>There is no ownable car carrier.</b> Ownable trailers arrived in 1.32 and auto transport was
    /// not among them — car hauling is Freight Market work with SCS's own trailer, or a mod. The app was
    /// stocking yards with a Cottrell 9-car, pricing it, basing it and telling the driver to go and buy
    /// one. See <see cref="CarHauling"/> for what happens instead.
    /// </summary>
    public static bool Ownable(string? type) => !IsCarHauler(type) && !IsDropHook(type);

    public static bool IsCarHauler(string? type) =>
        (type ?? "").Trim().Equals("Car Hauler", StringComparison.OrdinalIgnoreCase);

    /// <summary>The subtype that marks a drop-and-hook slot as auto-only.</summary>
    public const string CarHauling = "Auto";

    /// <summary>
    /// The trailer a division is pulled with. Used when the company needs to say what to go and buy,
    /// so it names an actual trailer rather than a division.
    ///
    /// Auto comes back as the drop-and-hook arrangement rather than a box, because that is what car
    /// hauling actually is in this game: freight you pull, not equipment you own.
    /// </summary>
    public static (string Type, string Subtype) ForDivision(string? division)
    {
        var d = (division ?? "").Trim();
        return d.ToLowerInvariant() switch
        {
            "reefer" => ("Reefer", ""),
            "flatbed" => ("Flatbed", ""),
            "step deck" => ("Step Deck", ""),
            "heavy haul" => ("Lowboy", ""),
            "tanker" => ("Tanker", "Fuel"),
            "livestock" => ("Livestock", ""),
            "car hauler" or "auto" or "car hauling" => (DropHook.TrailerType, CarHauling),
            "log" => ("Log", ""),
            "dump" => ("Dump", ""),
            "intermodal" or "container" => ("Container", ""),
            _ => ("Dry Van", "")
        };
    }

    /// <summary>
    /// What this carrier should actually be given for a division, with a length to put on the record.
    ///
    /// The one place that answers this. There used to be two: this, and <c>Seed.TrailerForDivision</c>,
    /// which returned <c>(type, length)</c> and dropped the subtype on the floor — so stocking a yard
    /// produced a bare "Tanker" with no indication of which of the five ATS sells you were meant to go
    /// and buy. Two helpers with nearly the same name is how that survived.
    /// </summary>
    public static (string Type, string Subtype, string Length) ForCarrier(AppState s, string? division)
    {
        var (type, subtype) = ForDivision(division);

        // A tanker is five different trailers. Name the one this carrier's freight points at rather
        // than writing "Tanker" and leaving the driver at the dealer guessing.
        if (IsTanker(type)) subtype = LikelyFor(s).Key;

        return (type, subtype, LengthFor(type));
    }

    /// <summary>Which division a trailer type belongs to. The inverse of <see cref="ForDivision"/>.</summary>
    public static string DivisionFor(string? type) =>
        (type ?? "").Trim().ToLowerInvariant() switch
        {
            "reefer" => "Reefer",
            "flatbed" => "Flatbed",
            "step deck" => "Step Deck",
            "container" => "Intermodal",
            "lowboy" => "Heavy Haul",
            "tanker" => "Tanker",
            "livestock" => "Livestock",
            "car hauler" => "Car Hauler",
            "log" => "Log",
            "dump" => "Dump",
            _ => "Dry Van"
        };

    /// <summary>The tanker a carrier's divisions and the driver's endorsements point at.</summary>
    public static (string Key, string Label, string Hauls, bool NeedsHazmat) LikelyFor(AppState s)
    {
        var divisions = string.Join(" ", s.Company.Divisions ?? new List<string>()).ToLowerInvariant();
        var name = (s.Company.Name ?? "").ToLowerInvariant();
        var hasHazmat = (s.Application?.HasHazmat ?? false)
                        || s.Driver.Qualifications.Contains("Hazmat")
                        || s.Driver.Endorsements.Count > 0;

        // Nothing placarded for a driver who is not cleared for it — whatever the carrier is called.
        //
        // The branches below read the company name and divisions, so a carrier with "chemical" in its
        // name handed a chemical tanker to anybody, endorsement or not. Reported from play: a company
        // owning a chem tank that cannot be used, because nobody there holds the class it needs. That is
        // not equipment, it is money parked on a yard.
        //
        // What gates a tanker is what goes IN it — fuel is class 3, chemical class 8, gas class 2, and
        // food-grade or dry-bulk need nothing at all. So the honest fallback is a tanker they can
        // actually run, and which of the two depends on what the carrier hauls.
        if (!hasHazmat)
            return divisions.Contains("bulk") || divisions.Contains("cement") || divisions.Contains("grain")
                ? TankerKinds.First(k => k.Key == "Dry Bulk")
                : TankerKinds.First(k => k.Key == "Food Grade");

        if (name.Contains("chemical") || divisions.Contains("chemical"))
            return TankerKinds.First(k => k.Key == "Chemical");
        if (name.Contains("fuel") || name.Contains("petroleum") || name.Contains("groendyke") || name.Contains("kenan"))
            return TankerKinds.First(k => k.Key == "Fuel");
        if (divisions.Contains("food") || divisions.Contains("reefer"))
            return TankerKinds.First(k => k.Key == "Food Grade");
        if (divisions.Contains("bulk"))
            return TankerKinds.First(k => k.Key == "Dry Bulk");

        // No endorsement, no placarded freight — food grade is the one they can actually run.
        return hasHazmat ? TankerKinds.First(k => k.Key == "Fuel") : TankerKinds.First(k => k.Key == "Food Grade");
    }
}
