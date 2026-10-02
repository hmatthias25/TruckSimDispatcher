namespace TruckSimDispatcher.Services;

/// <summary>
/// City names as a driver types them, and as the app shows them on an ETS2 career.
///
/// <para><b>English names.</b> ETS2 with "Localized city and country names" on — the default in English — lists
/// cargo to Hanover, Cologne and Munich, not Hannover, Köln and München (reported from play: blank distances
/// and an unrealistic delivery, because the place list only knew the local names). So an ETS2 career shows
/// the English name where the game has one, and either spelling finds the same place. Made in
/// <c>tools/ets2-data/exonyms.py</c>; the coordinate file is built from the same table.</para>
///
/// <para><b>Accents.</b> A name typed or read off a screenshot may carry them or not: Rīga and Riga, Plzeň and
/// Plzen, İstanbul and Istanbul. Folded with an explicit table covering every accented Latin letter (Latin-1,
/// Extended-A and -B, Extended Additional), because the app ships with InvariantGlobalization and the
/// platform's own Unicode normalisation is a no-op there. The earlier hand-written table had only Latin-1,
/// so Polish, Czech, Romanian, Baltic and Turkish names did not fold and did not match.</para>
/// </summary>
public static class CityNames
{
    private const string FoldFrom = "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƠơƯưǄǅǆǇǈǉǊǋǌǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǱǲǳǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ";
    private const string FoldTo = "A|A|A|A|A|A|AE|C|E|E|E|E|I|I|I|I|D|N|O|O|O|O|O|O|U|U|U|U|Y|TH|ss|a|a|a|a|a|a|ae|c|e|e|e|e|i|i|i|i|d|n|o|o|o|o|o|o|u|u|u|u|y|th|y|A|a|A|a|A|a|C|c|C|c|C|c|C|c|D|d|D|d|E|e|E|e|E|e|E|e|E|e|G|g|G|g|G|g|G|g|H|h|H|h|I|i|I|i|I|i|I|i|I|i|IJ|ij|J|j|K|k|k|L|l|L|l|L|l|L|l|L|l|N|n|N|n|N|n|N|n|O|o|O|o|O|o|OE|oe|R|r|R|r|R|r|S|s|S|s|S|s|S|s|T|t|T|t|U|u|U|u|U|u|U|u|U|u|U|u|W|w|Y|y|Y|Z|z|Z|z|Z|z|s|O|o|U|u|DZ|Dz|dz|LJ|Lj|lj|NJ|Nj|nj|A|a|I|i|O|o|U|u|U|u|U|u|U|u|U|u|A|a|A|a|G|g|K|k|O|o|O|o|j|DZ|Dz|dz|G|g|N|n|A|a|A|a|A|a|E|e|E|e|I|i|I|i|O|o|O|o|R|r|R|r|U|u|U|u|S|s|T|t|H|h|A|a|E|e|O|o|O|o|O|o|O|o|Y|y|A|a|B|b|B|b|B|b|C|c|D|d|D|d|D|d|D|d|D|d|E|e|E|e|E|e|E|e|E|e|F|f|G|g|H|h|H|h|H|h|H|h|H|h|I|i|I|i|K|k|K|k|K|k|L|l|L|l|L|l|L|l|M|m|M|m|M|m|N|n|N|n|N|n|N|n|O|o|O|o|O|o|O|o|P|p|P|p|R|r|R|r|R|r|R|r|S|s|S|s|S|s|S|s|S|s|T|t|T|t|T|t|T|t|U|u|U|u|U|u|U|u|U|u|V|v|V|v|W|w|W|w|W|w|W|w|W|w|X|x|X|x|Y|y|Z|z|Z|z|Z|z|h|t|w|y|s|A|a|A|a|A|a|A|a|A|a|A|a|A|a|A|a|A|a|A|a|A|a|A|a|E|e|E|e|E|e|E|e|E|e|E|e|E|e|E|e|I|i|I|i|O|o|O|o|O|o|O|o|O|o|O|o|O|o|O|o|O|o|O|o|O|o|O|o|U|u|U|u|U|u|U|u|U|u|U|u|U|u|Y|y|Y|y|Y|y|Y|y";
    private static readonly Dictionary<char, string> FoldMap = BuildFold();

    private static Dictionary<char, string> BuildFold()
    {
        var to = FoldTo.Split('|');
        var map = new Dictionary<char, string>(FoldFrom.Length);
        for (var i = 0; i < FoldFrom.Length && i < to.Length; i++) map[FoldFrom[i]] = to[i];
        return map;
    }

    /// <summary>Strips accents: every accented Latin letter to its plain one(s). Anything else passes through.</summary>
    public static string Fold(string text)
    {
        var plain = true;
        foreach (var ch in text) if (ch > 127) { plain = false; break; }
        if (plain) return text;
        var sb = new System.Text.StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (ch < 128) sb.Append(ch);
            else if (FoldMap.TryGetValue(ch, out var r)) sb.Append(r);
            else if (ch is >= '\u0300' and <= '\u036F') { }          // a bare combining mark
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>The English name ETS2 shows for a city, keyed by country and the local name.</summary>
    private static readonly Dictionary<(string Cc, string Local), string> EnglishOf = new()
    {
        [("AL", "Tiranë")] = "Tirana",
        [("AT", "Wien")] = "Vienna",
        [("BE", "Antwerpen")] = "Antwerp",
        [("BE", "Brussel")] = "Brussels",
        [("CH", "Genève")] = "Geneva",
        [("CH", "Zürich")] = "Zurich",
        [("CZ", "Praha")] = "Prague",
        [("DE", "Hannover")] = "Hanover",
        [("DE", "Köln")] = "Cologne",
        [("DE", "München")] = "Munich",
        [("DE", "Nürnberg")] = "Nuremberg",
        [("DK", "København")] = "Copenhagen",
        [("ES", "Sevilla")] = "Seville",
        [("ES", "València")] = "Valencia",
        [("GR", "Athina")] = "Athens",
        [("IT", "Firenze")] = "Florence",
        [("IT", "Genova")] = "Genoa",
        [("IT", "Milano")] = "Milan",
        [("IT", "Napoli")] = "Naples",
        [("IT", "Roma")] = "Rome",
        [("IT", "Torino")] = "Turin",
        [("IT", "Venezia")] = "Venice",
        [("LV", "Rīga")] = "Riga",
        [("MC", "Monaco City")] = "Monaco",
        [("MD", "Chişinǎu")] = "Chisinau",
        [("MT", "Il-Belt Valletta")] = "Valletta",
        [("PL", "Warszawa")] = "Warsaw",
        [("PT", "Lisboa")] = "Lisbon",
        [("RO", "București")] = "Bucharest",
        [("RS", "Beograd")] = "Belgrade",
        [("SE", "Göteborg")] = "Gothenburg",
        [("TR", "İstanbul")] = "Istanbul",
        [("XK", "Prishtinë")] = "Pristina",
    };

    /// <summary>Other spellings a driver may type, to the local name they mean.</summary>
    private static readonly (string Cc, string Alt, string Local)[] Accepted =
    {
        ("AL", "Durres", "Durrës"),
        ("AL", "Durazzo", "Durrës"),
        ("AL", "Vlora", "Vlorë"),
        ("BE", "Bruxelles", "Brussel"),
        ("BE", "Ghent", "Gent"),
        ("BE", "Liege", "Liège"),
        ("BE", "Luik", "Liège"),
        ("BE", "Lüttich", "Liège"),
        ("CZ", "Pilsen", "Plzeň"),
        ("DE", "Aix-la-Chapelle", "Aachen"),
        ("DE", "Brunswick", "Braunschweig"),
        ("DE", "Frankfurt", "Frankfurt am Main"),
        ("DE", "Halle (Saale)", "Halle"),
        ("DE", "Halle an der Saale", "Halle"),
        ("DE", "Osnabrueck", "Osnabrück"),
        ("DK", "Kobenhavn", "København"),
        ("ES", "La Coruña", "A Coruña"),
        ("ES", "Corunna", "A Coruña"),
        ("ES", "Saragossa", "Zaragoza"),
        ("FI", "Helsingfors", "Helsinki"),
        ("FI", "Åbo", "Turku"),
        ("FR", "Dunkirk", "Dunkerque"),
        ("FR", "Lyons", "Lyon"),
        ("FR", "Marseilles", "Marseille"),
        ("GR", "Heraklion", "Irakleio"),
        ("GR", "Iraklion", "Irakleio"),
        ("GR", "Patras", "Patra"),
        ("GR", "Rhodes", "Rodos"),
        ("GR", "Salonica", "Thessaloniki"),
        ("IT", "Syracuse", "Siracusa"),
        ("NL", "The Hague", "Den Haag"),
        ("NL", "'s-Gravenhage", "Den Haag"),
        ("NO", "Strostlett", "Storslett"),
        ("PL", "Danzig", "Gdańsk"),
        ("PL", "Cracow", "Kraków"),
        ("PL", "Posen", "Poznań"),
        ("PL", "Stettin", "Szczecin"),
        ("PL", "Breslau", "Wrocław"),
        ("RU", "St Petersburg", "Saint Petersburg"),
        ("RU", "Sankt-Peterburg", "Saint Petersburg"),
        ("TR", "Adrianople", "Edirne"),
        ("UA", "Lvov", "Lviv"),
        ("UA", "Lemberg", "Lviv"),
    };

    private static readonly Dictionary<(string, string), string> LocalByKey = BuildLocal();

    private static string Key(string s) => Fold(s).Trim().ToLowerInvariant();

    private static Dictionary<(string, string), string> BuildLocal()
    {
        var m = new Dictionary<(string, string), string>();
        foreach (var ((cc, local), eng) in EnglishOf)
        {
            m[(cc, Key(eng))] = local;
            m[(cc, Key(local))] = local;
        }
        foreach (var (cc, alt, local) in Accepted) m.TryAdd((cc, Key(alt)), local);
        return m;
    }

    /// <summary>
    /// The one spelling the app keeps for a city on an ETS2 career: the English name where the game has one,
    /// otherwise the name as given. "Köln", "Koln" and "Cologne" in DE are all "Cologne".
    /// </summary>
    public static string Canonical(string? city, string? cc)
    {
        var c = (city ?? "").Trim();
        var k = (cc ?? "").Trim().ToUpperInvariant();
        if (c.Length == 0 || k.Length != 2) return c;
        var local = LocalByKey.TryGetValue((k, Key(c)), out var l) ? l : c;
        return EnglishOf.TryGetValue((k, local), out var e) ? e : local;
    }

    /// <summary>What a city is shown as: its English name on an ETS2 career, as given on ATS.</summary>
    public static string Display(string? city, string? cc) =>
        GameProfile.Current.Id == GameProfile.Ets2.Id ? Canonical(city, cc) : (city ?? "");

    /// <summary>A "City,CC" yard reference, with the city in its displayed spelling.</summary>
    public static string DisplayRef(string cityAndCc)
    {
        var i = cityAndCc.LastIndexOf(',');
        return i < 0 ? cityAndCc : $"{Display(cityAndCc[..i], cityAndCc[(i + 1)..])},{cityAndCc[(i + 1)..]}";
    }
}
