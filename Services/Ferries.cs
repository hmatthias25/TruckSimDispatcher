using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Ferries and the Channel Tunnel: the crossings ETS2 has, matched to the real routes they stand for. Step 7
/// of Euro Truck Simulator 2 support (#266, #273).
///
/// <para><b>The app's own data, not the game's files.</b> Decided: the game's archives change with every update
/// and DLC, so the app keeps this table itself. The game's side of each route — its crossing time, fare and
/// the DLC it needs — is off the Truck Simulator Wiki's ferry table. The real side — the operator, the real
/// crossing time, whether drivers get a cabin, and the sailings — is a TYPICAL weekly timetable, as each
/// operator runs it, recorded with how sure it is. Timetables change by season; this is realism for a game,
/// not a booking system, and a wrong sailing is never the reason a load is refused.</para>
///
/// <para><b>Where there is no real route</b> (Hull to Esbjerg, Barcelona to Napoli and a few others the game
/// invented), the game's own crossing time is used and there is no timetable.</para>
///
/// <para>ProMods' own crossings (Iceland, Ireland, the Faroes and more) are not in it yet.</para>
/// </summary>
public static class Ferries
{
    /// <summary>
    /// One crossing. Ports are named as the game names them; <see cref="ACity"/> and <see cref="BCity"/> are the
    /// nearest city the app can locate, for distances to and from the terminal.
    /// </summary>
    public sealed record Route(
        string Id, string A, string ACity, string ACc, string B, string BCity, string BCc,
        double GameHours, decimal GameFare, string Dlc,
        string Operator, double RealHours, bool Cabin,
        int EveryMinutes, string[] FromA, string[] FromB,
        double CheckInHours, string Confidence, bool Train = false, string Note = "")
    {
        /// <summary>The crossing time the app plans on: the real one where there is a real route.</summary>
        public double Hours => RealHours > 0 ? RealHours : GameHours;
        public bool HasTimetable => EveryMinutes > 0 || FromA.Length > 0 || FromB.Length > 0;
        public string Label => $"{A} – {B}";
    }

    private static readonly string[] None = Array.Empty<string>();
    private static string[] T(params string[] times) => times;

    /// <summary>
    /// Every crossing. Confidence: "frequent" (a shuttle service, so the frequency is what matters),
    /// "typical" (the operator's usual daily pattern), "estimate" (a real route whose times were not checked),
    /// "game" (no real counterpart: the game's own time, no timetable). Checked 2026-10-01.
    /// </summary>
    public static readonly Route[] All =
    {
        // ---- the Channel and the North Sea
        new("dover-calais", "Dover", "Dover", "UK", "Calais", "Calais", "FR", 1.52, 384, "",
            "P&O Ferries / DFDS / Irish Ferries", 1.5, false, 60, None, None, 0.75, "frequent",
            Note: "Round the clock, a sailing about every hour between the three operators."),
        new("tunnel", "Folkestone", "Folkestone", "UK", "Calais (Coquelles)", "Calais", "FR", 0.58, 300, "",
            "LeShuttle Freight", 0.58, false, 15, None, None, 0.5, "frequent", Train: true,
            Note: "The Channel Tunnel: 35 minutes, round the clock, up to four shuttles an hour; drivers ride in a separate carriage."),
        new("harwich-hook", "Harwich", "Harwich", "UK", "Europoort", "Rotterdam", "NL", 8, 960, "",
            "Stena Line (Harwich – Hook of Holland)", 7, true, 0, T("09:00", "23:00"), T("14:15", "22:00"), 1, "typical",
            Note: "The real route is to the Hook of Holland, next to Europoort."),
        new("hull-rotterdam", "Hull", "Hull", "UK", "Europoort", "Rotterdam", "NL", 11, 995, "",
            "P&O Ferries", 12, true, 0, T("20:30"), T("21:00"), 1.5, "typical", Note: "Overnight, every day."),
        new("tyne-ijmuiden", "Tyne", "Newcastle-upon-Tyne", "UK", "IJmuiden", "Amsterdam", "NL", 16.5, 1212, "",
            "DFDS", 16, true, 0, T("17:00"), T("17:30"), 1.5, "typical", Note: "Overnight, every day."),
        new("hull-esbjerg", "Hull", "Hull", "UK", "Esbjerg", "Esbjerg", "DK", 19, 1314, "Scandinavia",
            "", 0, true, 0, None, None, 1, "game", Note: "No passenger-and-truck service runs this route; the game's time is used."),
        new("plymouth-roscoff", "Plymouth", "Plymouth", "UK", "Roscoff", "Roscoff", "FR", 7, 910, "Vive la France!",
            "Brittany Ferries", 6, true, 0, T("08:30", "22:00"), T("15:00", "23:00"), 1, "estimate"),
        new("plymouth-santander", "Plymouth", "Plymouth", "UK", "Santander", "Santander", "ES", 18, 1176, "Iberia",
            "Brittany Ferries", 20, true, 0, T("16:00"), T("15:00"), 1.5, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("plymouth-bilbao", "Plymouth", "Plymouth", "UK", "Bilbao", "Bilbao", "ES", 17.93, 1172, "Iberia",
            "Brittany Ferries (from Portsmouth)", 0, true, 0, None, None, 1.5, "game",
            Note: "The real Bilbao service sails from Portsmouth, not Plymouth; the game's time is used."),

        // ---- the Baltic and Scandinavia
        new("rostock-gedser", "Rostock", "Rostock", "DE", "Gedser", "Gedser", "DK", 1.75, 404, "Scandinavia",
            "Scandlines", 2, false, 120, None, None, 0.5, "frequent", Note: "Every two hours, day and night."),
        new("rostock-trelleborg", "Rostock", "Rostock", "DE", "Trelleborg", "Trelleborg", "SE", 5.58, 668, "Scandinavia",
            "TT-Line / Stena Line", 6, true, 0, T("01:00", "08:00", "14:00", "22:30"), T("02:00", "09:00", "15:00", "22:00"), 1, "estimate"),
        new("gdynia-karlskrona", "Gdynia", "Gdynia", "PL", "Verkö", "Karlskrona", "SE", 10.5, 790, "Going East! + Scandinavia",
            "Stena Line", 10.5, true, 0, T("09:00", "21:00"), T("09:00", "21:00"), 1, "typical", Note: "Verkö is Karlskrona's ferry port."),
        new("gdansk-nynashamn", "Gdańsk", "Gdańsk", "PL", "Nynäshamn", "Nynäshamn", "SE", 19, 531, "Going East! + Scandinavia",
            "Polferries", 19, true, 0, T("18:00"), T("18:00"), 1.5, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("frederikshavn-goteborg", "Frederikshavn", "Frederikshavn", "DK", "Göteborg", "Göteborg", "SE", 3.25, 677, "Scandinavia",
            "Stena Line", 3.5, false, 0, T("04:00", "08:30", "12:30", "18:15", "23:55"), T("04:00", "08:15", "12:30", "18:30", "23:55"), 0.75, "estimate"),
        new("frederikshavn-oslo", "Frederikshavn", "Frederikshavn", "DK", "Oslo", "Oslo", "NO", 12, 993, "Scandinavia",
            "DFDS (København – Frederikshavn – Oslo)", 11, true, 0, T("19:00"), T("16:30"), 1, "estimate"),
        new("hirtshals-kristiansand", "Hirtshals", "Hirtshals", "DK", "Kristiansand", "Kristiansand", "NO", 3.25, 1052, "Scandinavia",
            "Color Line / Fjord Line", 3.25, false, 0, T("08:00", "12:15", "16:45", "20:45"), T("08:00", "12:15", "16:30", "20:45"), 0.75, "estimate"),
        new("hirtshals-stavanger", "Hirtshals", "Hirtshals", "DK", "Stavanger", "Stavanger", "NO", 9.5, 1621, "Scandinavia",
            "Fjord Line", 10, true, 0, T("20:00"), T("20:30"), 1, "typical"),
        new("hirtshals-bergen", "Hirtshals", "Hirtshals", "DK", "Bergen", "Bergen", "NO", 17.25, 1793, "Scandinavia",
            "Fjord Line (via Stavanger)", 17, true, 0, T("20:00"), T("13:30"), 1, "typical"),
        new("helsinki-tallinn", "Helsinki", "Helsinki", "FI", "Tallinn", "Tallinn", "EE", 2.5, 430, "Beyond the Baltic Sea",
            "Tallink / Viking Line / Eckerö Line", 2, false, 120, None, None, 0.75, "frequent",
            Note: "Freight sails Vuosaari – Muuga; about every two hours across the operators."),
        new("kapellskar-naantali", "Kapellskär", "Kapellskär", "SE", "Naantali", "Naantali", "FI", 9, 1170, "Scandinavia + Beyond the Baltic Sea",
            "Finnlines", 9, true, 0, T("09:00", "22:00"), T("08:45", "21:15"), 1, "typical"),
        new("kapellskar-paldiski", "Kapellskär", "Kapellskär", "SE", "Paldiski", "Paldiski", "EE", 9.5, 1270, "Scandinavia + Beyond the Baltic Sea",
            "DFDS", 10, true, 0, T("19:00"), T("18:00"), 1, "estimate"),
        new("nynashamn-ventspils", "Nynäshamn", "Nynäshamn", "SE", "Ventspils", "Ventspils", "LV", 8.5, 1110, "Scandinavia + Beyond the Baltic Sea",
            "Stena Line", 9, true, 0, T("10:00", "22:00"), T("10:00", "22:00"), 1, "estimate"),
        new("travemunde-helsinki", "Travemünde", "Travemünde", "DE", "Helsinki", "Helsinki", "FI", 29.5, 2525, "Beyond the Baltic Sea",
            "Finnlines", 29, true, 0, T("03:00"), T("17:00"), 1.5, "typical"),
        new("travemunde-liepaja", "Travemünde", "Travemünde", "DE", "Liepāja", "Liepāja", "LV", 26.5, 1375, "Beyond the Baltic Sea",
            "Stena Line", 27, true, 0, T("22:00"), T("21:00"), 1.5, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("travemunde-priwall", "Travemünde", "Travemünde", "DE", "Priwall", "Travemünde", "DE", 0.5, 65, "",
            "Priwallfähre", 0.1, false, 15, None, None, 0, "frequent", Note: "The river crossing at the mouth of the Trave."),
        new("umea-vaasa", "Umeå", "Umeå", "SE", "Vaasa", "Vaasa", "FI", 5, 680, "Nordic Horizons",
            "Wasaline", 4, false, 0, T("09:00", "18:00"), T("09:00", "18:00"), 1, "estimate"),

        // ---- Norway's fjords (Nordic Horizons): short, frequent, no cabin
        new("anda-lote", "Anda", "Anda", "NO", "Lote", "Lote", "NO", 0.25, 31, "Nordic Horizons", "Fjord1", 0.17, false, 30, None, None, 0, "frequent"),
        new("bognes-skarberget", "Bognes", "Bognes", "NO", "Skarberget", "Skarberget", "NO", 0.5, 45, "Nordic Horizons", "Torghatten Nord", 0.42, false, 60, None, None, 0, "frequent"),
        new("halsa-kanestraum", "Halsa", "Halsa", "NO", "Kanestraum", "Kanestraum", "NO", 0.42, 36, "Nordic Horizons", "Fjord1", 0.33, false, 30, None, None, 0, "frequent"),
        new("lavik-oppedal", "Lavik", "Lavik", "NO", "Ytre Oppedal", "Oppedal", "NO", 0.42, 36, "Nordic Horizons", "Fjord1", 0.33, false, 30, None, None, 0, "frequent"),
        new("molde-vestnes", "Molde", "Molde", "NO", "Vestnes", "Vestnes", "NO", 0.67, 46, "Nordic Horizons", "Fjord1", 0.58, false, 30, None, None, 0, "frequent"),
        new("skutvik-svolvaer", "Skutvik", "Skutvik", "NO", "Svolvær", "Svolvær", "NO", 2.5, 132, "Nordic Horizons", "Torghatten Nord", 2, false, 0, T("07:00", "12:00", "17:30"), T("05:30", "10:00", "15:00"), 0.5, "estimate"),

        // ---- the Mediterranean and Italy
        new("marseille-portovecchio", "Marseille", "Marseille", "FR", "Porto-Vecchio", "Porto-Vecchio", "FR", 14, 1193, "Vive la France!",
            "Corsica Linea", 14, true, 0, T("18:00"), T("19:00"), 1.5, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("ajaccio-portotorres", "Ajaccio", "Ajaccio", "FR", "Porto Torres", "Porto Torres", "IT", 3.5, 355, "Vive la France! + Italia",
            "Corsica Linea / La Méridionale", 4, false, 0, T("08:00"), T("13:00"), 1, "estimate"),
        new("cagliari-napoli", "Cagliari", "Cagliari", "IT", "Napoli", "Napoli", "IT", 14, 750, "Italia",
            "Tirrenia", 16, true, 0, T("19:00"), T("20:00"), 1.5, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("cagliari-palermo", "Cagliari", "Cagliari", "IT", "Palermo", "Palermo", "IT", 12, 778, "Italia",
            "Tirrenia", 12, true, 0, T("19:00"), T("19:00"), 1.5, "estimate", Note: "Weekly in reality; daily here."),
        new("napoli-palermo", "Napoli", "Napoli", "IT", "Palermo", "Palermo", "IT", 11, 879, "Italia",
            "Tirrenia / GNV", 10.5, true, 0, T("20:15"), T("20:15"), 1.5, "typical", Note: "Overnight, every day."),
        new("messina-villa", "Messina", "Messina", "IT", "Villa San Giovanni", "Villa San Giovanni", "IT", 0.33, 347, "Italia",
            "Caronte & Tourist", 0.33, false, 40, None, None, 0.25, "frequent", Note: "Across the Strait of Messina, round the clock."),
        new("barcelona-marseille", "Barcelona", "Barcelona", "ES", "Marseille", "Marseille", "FR", 7.63, 526, "Vive la France! + Iberia",
            "", 0, false, 0, None, None, 1, "game", Note: "No regular truck ferry runs this route; the game's time is used."),
        new("barcelona-napoli", "Barcelona", "Barcelona", "ES", "Napoli", "Napoli", "IT", 21.67, 1500, "Italia + Iberia",
            "", 0, true, 0, None, None, 1.5, "game", Note: "No direct service; the game's time is used."),
        new("barcelona-portotorres", "Barcelona", "Barcelona", "ES", "Porto Torres", "Porto Torres", "IT", 12, 827, "Italia + Iberia",
            "Grimaldi Lines", 12, true, 0, T("20:15"), T("19:30"), 1.5, "estimate"),
        new("palermo-valencia", "Palermo", "Palermo", "IT", "València", "València", "ES", 25.95, 1788, "Italia + Iberia",
            "", 0, true, 0, None, None, 1.5, "game", Note: "No direct service; the game's time is used."),
        new("braila-smardan", "Brăila", "Brăila", "RO", "Smârdan", "Smârdan", "RO", 0.5, 65, "Road to the Black Sea",
            "Danube ferry", 0.25, false, 30, None, None, 0, "frequent", Note: "Replaced by the Brăila bridge in 2023; the ferry is kept as the game has it."),

        // ---- the Adriatic and Greece
        new("trieste-ancona", "Trieste", "Trieste", "IT", "Ancona", "Ancona", "IT", 10.33, 335, "Italia",
            "", 0, true, 0, None, None, 1, "game", Note: "No regular truck ferry; the game's time is used."),
        new("trieste-bari", "Trieste", "Trieste", "IT", "Bari", "Bari", "IT", 19.17, 660, "Italia",
            "", 0, true, 0, None, None, 1, "game", Note: "No regular truck ferry; the game's time is used."),
        new("ancona-split", "Ancona", "Ancona", "IT", "Split", "Split", "HR", 10, 315, "Italia + West Balkans",
            "Jadrolinija / SNAV", 11, true, 0, T("20:00"), T("20:00"), 1.5, "estimate", Note: "Overnight; fewer sailings out of season."),
        new("ancona-durres", "Ancona", "Ancona", "IT", "Durrës", "Durrës", "AL", 18, 615, "Italia + West Balkans",
            "Adria Ferries", 19, true, 0, T("14:00"), T("21:00"), 1.5, "estimate"),
        new("bari-durres", "Bari", "Bari", "IT", "Durrës", "Durrës", "AL", 9, 420, "Italia + West Balkans",
            "Ventouris / Adria Ferries", 9, true, 0, T("22:00"), T("22:00"), 1.5, "typical", Note: "Overnight, every day."),
        new("ancona-igoumenitsa", "Ancona", "Ancona", "IT", "Igoumenitsa", "Igoumenitsa", "GR", 18.5, 1425, "Italia + Greece",
            "Minoan Lines / Anek-Superfast", 16, true, 0, T("13:30", "17:30"), T("12:30", "23:59"), 2, "estimate"),
        new("ancona-patra", "Ancona", "Ancona", "IT", "Patra", "Patra", "GR", 25, 1425, "Italia + Greece",
            "Minoan Lines / Anek-Superfast", 21, true, 0, T("13:30", "17:30"), T("15:00", "18:00"), 2, "estimate"),
        new("bari-igoumenitsa", "Bari", "Bari", "IT", "Igoumenitsa", "Igoumenitsa", "GR", 9.5, 745, "Italia + Greece",
            "Superfast Ferries", 9, true, 0, T("20:00"), T("23:59"), 2, "typical"),
        new("bari-patra", "Bari", "Bari", "IT", "Patra", "Patra", "GR", 17.5, 870, "Italia + Greece",
            "Superfast Ferries", 16, true, 0, T("20:00"), T("17:30"), 2, "typical"),
        new("trieste-igoumenitsa", "Trieste", "Trieste", "IT", "Igoumenitsa", "Igoumenitsa", "GR", 27, 1590, "Greece",
            "Anek Lines", 27, true, 0, T("14:00"), T("09:00"), 2, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("trieste-patra", "Trieste", "Trieste", "IT", "Patra", "Patra", "GR", 33, 1860, "Greece",
            "Anek Lines", 32, true, 0, T("14:00"), T("17:00"), 2, "estimate", Note: "A few sailings a week in reality; daily here."),
        new("kavala-chios", "Kavala", "Kavala", "GR", "Chios", "Chios", "GR", 11.5, 1521, "Greece",
            "", 0, true, 0, None, None, 1, "game", Note: "Served via Lesvos in reality, a few times a week; the game's time is used."),
        new("kavala-mytilini", "Kavala", "Kavala", "GR", "Mytilini", "Mytilini", "GR", 12.17, 1440, "Greece",
            "", 0, true, 0, None, None, 1, "game", Note: "A few sailings a week in reality; the game's time is used."),
        new("chios-mytilini", "Chios", "Chios", "GR", "Mytilini", "Mytilini", "GR", 2.25, 468, "Greece",
            "Blue Star Ferries", 3, false, 0, T("05:00"), T("21:00"), 1, "estimate"),
        new("piraeus-chania", "Piraeus", "Piraeus", "GR", "Chania", "Chania", "GR", 9, 826, "Greece",
            "ANEK Lines", 9, true, 0, T("21:00"), T("21:00"), 1.5, "typical", Note: "Overnight, every day."),
        new("piraeus-chios", "Piraeus", "Piraeus", "GR", "Chios", "Chios", "GR", 9, 840, "Greece",
            "Blue Star Ferries", 8, true, 0, T("19:00"), T("09:00"), 1.5, "estimate"),
        new("piraeus-irakleio", "Piraeus", "Piraeus", "GR", "Irakleio", "Irakleio", "GR", 9, 760, "Greece",
            "Minoan Lines", 9, true, 0, T("21:00"), T("21:00"), 1.5, "typical", Note: "Overnight, every day."),
        new("piraeus-rodos", "Piraeus", "Piraeus", "GR", "Rodos", "Rodos", "GR", 13.5, 1889, "Greece",
            "Blue Star Ferries", 15, true, 0, T("17:00"), T("17:00"), 1.5, "estimate"),
        new("kalamata-chania", "Kalamata", "Kalamata", "GR", "Chania", "Chania", "GR", 8.17, 1440, "Greece",
            "", 0, true, 0, None, None, 1, "game", Note: "No regular service; the game's time is used."),
        new("patra-argostoli", "Patra", "Patra", "GR", "Argostoli", "Argostoli", "GR", 4, 510, "Greece",
            "", 0, false, 0, None, None, 1, "game", Note: "Kefalonia is reached from Kyllini in reality; the game's time is used."),
        new("igoumenitsa-argostoli", "Igoumenitsa", "Igoumenitsa", "GR", "Argostoli", "Argostoli", "GR", 7.67, 720, "Greece",
            "", 0, false, 0, None, None, 1, "game", Note: "No regular service; the game's time is used."),
        new("argostoli-lixouri", "Argostoli", "Argostoli", "GR", "Lixouri", "Lixouri", "GR", 0.5, 40, "Greece",
            "Lixouri ferry", 0.33, false, 30, None, None, 0, "frequent"),
    };

    public static Route? Find(string? id) =>
        All.FirstOrDefault(r => r.Id.Equals((id ?? "").Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Whether the career waits for the real sailing. On by default for EU careers; a setting.</summary>
    public static bool RealSailings(AppState s) => s.Settings.RealFerrySailings;

    /// <summary>
    /// The next departure from this port at or after <paramref name="ready"/> — the moment the driver has
    /// checked in. With real sailings off, or no timetable, the ferry leaves when they are ready.
    /// </summary>
    public static DateTime NextDeparture(AppState s, Route r, bool fromA, DateTime ready)
    {
        if (!RealSailings(s) || !r.HasTimetable) return ready;
        if (r.EveryMinutes > 0)
        {
            var mins = ready.TimeOfDay.TotalMinutes;
            var next = Math.Ceiling(mins / r.EveryMinutes - 1e-9) * r.EveryMinutes;
            return ready.Date.AddMinutes(next);
        }
        var times = (fromA ? r.FromA : r.FromB).Select(t => TimeSpan.Parse(t)).OrderBy(t => t).ToList();
        if (times.Count == 0) return ready;
        for (var d = 0; d < 3; d++)
            foreach (var t in times)
                if (ready.Date.AddDays(d) + t >= ready) return ready.Date.AddDays(d) + t;
        return ready;
    }

    /// <summary>
    /// What a crossing counts as under EU 561/2006, Article 9. A regular daily rest (11 h) or a reduced weekly
    /// one may be taken on board with a cabin, broken at most twice for an hour in all to drive on and off; a
    /// regular weekly rest only on a crossing of 8 hours or more, with a cabin. Without a cabin it is a break.
    /// </summary>
    public static string RestValue(Route r, double hours, bool cabin)
    {
        if (cabin && hours >= 45) return "a regular weekly rest (a cabin, and 8 hours or more scheduled)";
        if (cabin && hours >= 24) return "a reduced weekly rest";
        if (cabin && hours >= 11) return "a regular daily rest";
        if (cabin && hours >= 9) return "a reduced daily rest (if you have one left)";
        if (hours >= 0.75) return cabin ? "a 45-minute break — too short for a daily rest" : "a break — without a cabin it is never a rest";
        if (hours >= 0.25) return "part of a split break — the 15 or the 30 of a 15 + 30 — and never a rest";
        return "nothing: too short even for part of a break";
    }

    /// <summary>
    /// The driver is at a port, ready to board: which sailing they make, and what to set the clock to. The
    /// same answer the shipper and receiver give — set the game clock, then do the thing.
    /// </summary>
    public static object Call(AppState s, Route r, bool fromA, DateTime arrived)
    {
        // Real sailings off means the crossing goes when you get there — no check-in to sit through either.
        var ready = RealSailings(s) && r.HasTimetable ? arrived.AddHours(r.CheckInHours) : arrived;
        var departs = NextDeparture(s, r, fromA, ready);
        var lands = departs.AddHours(r.Hours);
        var from = fromA ? r.A : r.B;
        var to = fromA ? r.B : r.A;
        var wait = (departs - arrived).TotalHours;
        var what = r.Train ? "shuttle" : "sailing";
        var lines = new List<string>();
        if (!RealSailings(s) || !r.HasTimetable)
            lines.Add(RealSailings(s)
                ? $"No real timetable for {r.Label} — it leaves when you are ready."
                : "Real ferry sailings are off in Settings, so it leaves when you are ready.");
        else
            lines.Add($"The next {r.Operator} {what} from {from} leaves {GameClock.Pretty(departs)}" +
                      (r.CheckInHours > 0 ? $" — check-in is {Hhmm.Of(r.CheckInHours)} before" : "") + ".");
        lines.Add($"It reaches {to} at {GameClock.Pretty(lands)} — {Hhmm.Of(r.Hours)} across" +
                  (r.RealHours > 0 && Math.Abs(r.RealHours - r.GameHours) > 0.1 ? $" (the game takes {Hhmm.Of(r.GameHours)})" : "") + ".");
        if (wait > 0.01)
            lines.Add($"Set the game clock to {GameClock.Pretty(departs)} and board then — the {Hhmm.Of(wait)} at the terminal is waiting, " +
                      (wait >= 0.75 ? "and counts as a break." : "on your clocks."));
        lines.Add($"After the crossing, set the clock to {GameClock.Pretty(lands)} if the game's crossing was shorter. " +
                  $"Under EU rules the crossing is {RestValue(r, r.Hours, r.Cabin)}" + (r.Cabin ? ", with a cabin." : ", with no cabin."));
        return new
        {
            route = r.Id, label = r.Label, from, to, @operator = r.Operator, train = r.Train,
            arrived = GameClock.Format(arrived), departs = GameClock.Format(departs), lands = GameClock.Format(lands),
            waitHours = Math.Round(wait, 2), crossingHours = r.Hours, cabin = r.Cabin, confidence = r.Confidence,
            restValue = RestValue(r, r.Hours, r.Cabin),
            headline = wait > 0.01 ? $"Next {what} {GameClock.Pretty(departs)}" : $"Board now — the {what} is leaving",
            instruction = string.Join(" ", lines),
        };
    }

    /// <summary>The table, for the browser: every route and what the app knows about it.</summary>
    public static object View(AppState s) => new
    {
        realSailings = RealSailings(s),
        routes = All.Select(r => new
        {
            id = r.Id, label = r.Label, a = r.A, b = r.B, train = r.Train, dlc = r.Dlc, @operator = r.Operator,
            hours = r.Hours, gameHours = r.GameHours, cabin = r.Cabin, confidence = r.Confidence, note = r.Note,
        }),
    };
}
