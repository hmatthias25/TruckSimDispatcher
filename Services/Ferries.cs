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
/// <para><b>ProMods</b>: real ferries serving the regions ProMods adds — Iceland and the Faroes, Ireland, the
/// Scottish islands, Åland, the Estonian islands, Malta, the Channel Islands — marked "promods" because they
/// have not been confirmed against ProMods' own map. ProMods' route list could not be read (its forum refuses
/// automated requests); the in-game ferry list is the authority.</para>
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
    /// Every crossing. Sailings are local times at the port of departure — ETS2 has one clock, so they are read
    /// as it shows — either every day ("09:00") or on named days ("Mon-Fri 20:30", "Sun,Wed 16:00"). Timetables
    /// that change with the season are given in their off-season pattern, since the game has no real dates.
    ///
    /// Confidence: "checked" (the operator's current timetable, read 2026-10-01), "frequent" (a shuttle, so the
    /// frequency is what matters), "estimate" (a real route whose times were not confirmed), "game" (no real
    /// counterpart: the game's own time, no timetable), "promods" (a real ferry serving a ProMods region, not yet
    /// confirmed against ProMods' own map — the in-game ferry list is the authority).
    /// </summary>
    public static readonly Route[] All =
    {
        // ---- the Channel and the North Sea
        new("dover-calais", "Dover", "Dover", "UK", "Calais", "Calais", "FR", 1.52, 384, "",
            "P&O Ferries / DFDS / Irish Ferries", 1.5, false, 60, None, None, 0.75, "frequent",
            Note: "Round the clock, about a sailing an hour between the three operators."),
        new("tunnel", "Folkestone", "Folkestone", "UK", "Calais (Coquelles)", "Calais", "FR", 0.58, 300, "",
            "LeShuttle Freight", 0.58, false, 15, None, None, 0.5, "frequent", Train: true,
            Note: "The Channel Tunnel: 35 minutes, round the clock, up to four shuttles an hour; drivers ride in a separate carriage."),
        new("harwich-hook", "Harwich", "Harwich", "UK", "Europoort", "Rotterdam", "NL", 8, 960, "",
            "Stena Line (Harwich – Hook of Holland)", 8.5, true, 0, T("09:00", "23:00"), T("14:15", "22:00"), 1, "checked",
            Note: "The real route is to the Hook of Holland, next to Europoort. Day 09:00 – 17:15, night 23:00 – 08:00."),
        new("hull-rotterdam", "Hull", "Hull", "UK", "Europoort", "Rotterdam", "NL", 11, 995, "",
            "P&O Ferries", 11.25, true, 0, T("Mon-Fri 20:30", "Sat,Sun 20:00"), T("21:00"), 1.5, "checked", Note: "Overnight, every day."),
        new("tyne-ijmuiden", "Tyne", "Newcastle-upon-Tyne", "UK", "IJmuiden", "Amsterdam", "NL", 16.5, 1212, "",
            "DFDS", 16.75, true, 0, T("17:00"), T("17:30"), 1, "checked", Note: "Overnight, every day; check-in closes 16:15."),
        new("hull-esbjerg", "Hull", "Hull", "UK", "Esbjerg", "Esbjerg", "DK", 19, 1314, "Scandinavia",
            "", 0, true, 0, None, None, 1, "game", Note: "No passenger-and-truck service runs this route; the game's time is used."),
        new("plymouth-roscoff", "Plymouth", "Plymouth", "UK", "Roscoff", "Roscoff", "FR", 7, 910, "Vive la France!",
            "Brittany Ferries", 5.25, true, 0, T("Mon-Sat 08:45"), T("Mon-Sat 15:30"), 1, "estimate",
            Note: "One sailing a day, six days a week; about 5 h 15 by day."),
        new("plymouth-santander", "Plymouth", "Plymouth", "UK", "Santander", "Santander", "ES", 18, 1176, "Iberia",
            "Brittany Ferries", 21, true, 0, T("Sun,Wed 16:00"), T("Mon,Thu 17:00"), 1.5, "checked",
            Note: "Sundays and Wednesdays from Plymouth, Mondays and Thursdays back."),
        new("plymouth-bilbao", "Plymouth", "Plymouth", "UK", "Bilbao", "Bilbao", "ES", 17.93, 1172, "Iberia",
            "Brittany Ferries (from Portsmouth)", 0, true, 0, None, None, 1.5, "game",
            Note: "The real Bilbao service sails from Portsmouth, not Plymouth; the game's time is used."),

        // ---- the Baltic and Scandinavia
        new("rostock-gedser", "Rostock", "Rostock", "DE", "Gedser", "Gedser", "DK", 1.75, 404, "Scandinavia",
            "Scandlines", 2, false, 120, None, None, 0.5, "frequent", Note: "Every two hours, day and night."),
        new("rostock-trelleborg", "Rostock", "Rostock", "DE", "Trelleborg", "Trelleborg", "SE", 5.58, 668, "Scandinavia",
            "TT-Line / Stena Line", 6, true, 0, T("01:00", "08:00", "14:00", "22:30"), T("02:00", "09:00", "15:00", "22:00"), 1, "estimate"),
        new("gdynia-karlskrona", "Gdynia", "Gdynia", "PL", "Verkö", "Karlskrona", "SE", 10.5, 790, "Going East! + Scandinavia",
            "Stena Line", 10.5, true, 0, T("09:00", "21:00"), T("09:00", "21:00"), 1, "checked",
            Note: "Verkö is Karlskrona's ferry port. About 17 sailings a week; the two daily ones here."),
        new("gdansk-nynashamn", "Gdańsk", "Gdańsk", "PL", "Nynäshamn", "Nynäshamn", "SE", 19, 531, "Going East! + Scandinavia",
            "Polferries", 18, true, 0, T("Wed,Thu 18:00"), T("Tue,Wed 18:00"), 1.5, "checked",
            Note: "Two a week each way in season, one in the low season."),
        new("frederikshavn-goteborg", "Frederikshavn", "Frederikshavn", "DK", "Göteborg", "Göteborg", "SE", 3.25, 677, "Scandinavia",
            "Stena Line", 3.5, false, 0, T("04:00", "08:30", "12:30", "18:15", "23:55"), T("04:00", "08:15", "12:30", "18:30", "23:55"), 0.75, "estimate"),
        new("frederikshavn-oslo", "Frederikshavn", "Frederikshavn", "DK", "Oslo", "Oslo", "NO", 12, 993, "Scandinavia",
            "DFDS (København – Frederikshavn – Oslo)", 11, true, 0, T("19:00"), T("16:30"), 1, "estimate"),
        new("hirtshals-kristiansand", "Hirtshals", "Hirtshals", "DK", "Kristiansand", "Kristiansand", "NO", 3.25, 1052, "Scandinavia",
            "Color Line / Fjord Line", 3.25, false, 0, T("08:00", "12:15", "16:45", "20:45"), T("08:00", "12:15", "16:30", "20:45"), 0.75, "estimate"),
        new("hirtshals-stavanger", "Hirtshals", "Hirtshals", "DK", "Stavanger", "Stavanger", "NO", 9.5, 1621, "Scandinavia",
            "Fjord Line", 10, true, 0, T("20:00"), T("20:30"), 1, "estimate"),
        new("hirtshals-bergen", "Hirtshals", "Hirtshals", "DK", "Bergen", "Bergen", "NO", 17.25, 1793, "Scandinavia",
            "Fjord Line (via Stavanger)", 17, true, 0, T("20:00"), T("13:30"), 1, "estimate"),
        new("helsinki-tallinn", "Helsinki", "Helsinki", "FI", "Tallinn", "Tallinn", "EE", 2.5, 430, "Beyond the Baltic Sea",
            "Tallink / Viking Line / Eckerö Line", 2, false, 120, None, None, 0.75, "frequent",
            Note: "Freight sails Vuosaari – Muuga; about every two hours across the operators."),
        new("kapellskar-naantali", "Kapellskär", "Kapellskär", "SE", "Naantali", "Naantali", "FI", 9, 1170, "Scandinavia + Beyond the Baltic Sea",
            "Finnlines", 9, true, 0, T("09:00", "22:00"), T("08:45", "21:15"), 1, "estimate"),
        new("kapellskar-paldiski", "Kapellskär", "Kapellskär", "SE", "Paldiski", "Paldiski", "EE", 9.5, 1270, "Scandinavia + Beyond the Baltic Sea",
            "DFDS", 10, true, 0, T("Mon,Tue,Sat,Sun 22:00", "Thu,Fri 10:30"), T("Mon,Tue,Sat,Sun 22:00", "Thu,Fri 10:30"), 1, "checked",
            Note: "A daily crossing: nights four days a week, mornings on Thursday and Friday."),
        new("nynashamn-ventspils", "Nynäshamn", "Nynäshamn", "SE", "Ventspils", "Ventspils", "LV", 8.5, 1110, "Scandinavia + Beyond the Baltic Sea",
            "Stena Line", 9.5, true, 0, T("09:00", "20:30"), T("10:00", "23:59"), 1, "checked", Note: "About ten sailings a week each way."),
        new("travemunde-helsinki", "Travemünde", "Travemünde", "DE", "Helsinki", "Helsinki", "FI", 29.5, 2525, "Beyond the Baltic Sea",
            "Finnlines", 29, true, 0, T("03:00"), T("17:00"), 1.5, "estimate"),
        new("travemunde-liepaja", "Travemünde", "Travemünde", "DE", "Liepāja", "Liepāja", "LV", 26.5, 1375, "Beyond the Baltic Sea",
            "Stena Line", 27, true, 0, T("Mon-Sat 22:00"), T("Mon-Sat 21:00"), 1.5, "estimate", Note: "Six sailings a week."),
        new("travemunde-priwall", "Travemünde", "Travemünde", "DE", "Priwall", "Travemünde", "DE", 0.5, 65, "",
            "Priwallfähre", 0.1, false, 15, None, None, 0, "frequent", Note: "The river crossing at the mouth of the Trave."),
        new("umea-vaasa", "Umeå", "Umeå", "SE", "Vaasa", "Vaasa", "FI", 5, 680, "Nordic Horizons",
            "Wasaline", 5, false, 0, T("08:00", "11:30", "18:15"), T("14:00", "20:00", "23:45"), 1, "checked",
            Note: "The times vary by weekday; the usual ones here. About 4 h at sea, and Finland is an hour ahead."),

        // ---- Norway's fjords (Nordic Horizons): short, frequent, no cabin
        new("anda-lote", "Anda", "Anda", "NO", "Lote", "Lote", "NO", 0.25, 31, "Nordic Horizons", "Fjord1", 0.17, false, 30, None, None, 0, "frequent"),
        new("bognes-skarberget", "Bognes", "Bognes", "NO", "Skarberget", "Skarberget", "NO", 0.5, 45, "Nordic Horizons", "Torghatten Nord", 0.42, false, 60, None, None, 0, "frequent"),
        new("halsa-kanestraum", "Halsa", "Halsa", "NO", "Kanestraum", "Kanestraum", "NO", 0.42, 36, "Nordic Horizons", "Fjord1", 0.33, false, 30, None, None, 0, "frequent"),
        new("lavik-oppedal", "Lavik", "Lavik", "NO", "Ytre Oppedal", "Oppedal", "NO", 0.42, 36, "Nordic Horizons", "Fjord1", 0.33, false, 30, None, None, 0, "frequent"),
        new("molde-vestnes", "Molde", "Molde", "NO", "Vestnes", "Vestnes", "NO", 0.67, 46, "Nordic Horizons", "Fjord1", 0.58, false, 30, None, None, 0, "frequent"),
        new("skutvik-svolvaer", "Skutvik", "Skutvik", "NO", "Svolvær", "Svolvær", "NO", 2.5, 132, "Nordic Horizons", "Torghatten Nord", 2, false, 0, T("07:00", "12:00", "17:30"), T("05:30", "10:00", "15:00"), 0.5, "estimate"),

        // ---- the Mediterranean and Italy
        new("marseille-portovecchio", "Marseille", "Marseille", "FR", "Porto-Vecchio", "Porto-Vecchio", "FR", 14, 1193, "Vive la France!",
            "La Méridionale", 14, true, 0, T("Tue,Thu,Sat 19:00"), T("Wed,Fri,Sun 19:00"), 1.5, "checked",
            Note: "Three a week each way; the days are confirmed, the time is not."),
        new("ajaccio-portotorres", "Ajaccio", "Ajaccio", "FR", "Porto Torres", "Porto Torres", "IT", 3.5, 355, "Vive la France! + Italia",
            "Corsica Sardinia Ferries", 4.75, false, 0, T("Sun,Mon,Thu,Sat 08:00"), T("Sun,Mon,Thu,Sat 14:00"), 1, "checked",
            Note: "Four a week; the days are confirmed, the times are not."),
        new("cagliari-napoli", "Cagliari", "Cagliari", "IT", "Napoli", "Napoli", "IT", 14, 750, "Italia",
            "Grimaldi Lines", 15, true, 0, T("Tue,Thu,Sun 19:00"), T("Mon,Wed,Sat 19:00"), 1.5, "checked",
            Note: "Grimaldi now runs it: Tuesday, Thursday and Sunday from Cagliari; the days back are an estimate."),
        new("cagliari-palermo", "Cagliari", "Cagliari", "IT", "Palermo", "Palermo", "IT", 12, 778, "Italia",
            "Grimaldi Lines", 12, true, 0, T("Sat 17:00"), T("Fri 19:00"), 1.5, "checked",
            Note: "Weekly: Saturday 17:00 from Cagliari, in on Sunday at 05:00. The day back is an estimate."),
        new("napoli-palermo", "Napoli", "Napoli", "IT", "Palermo", "Palermo", "IT", 11, 879, "Italia",
            "Tirrenia / GNV", 10.5, true, 0, T("20:15"), T("20:15"), 1.5, "estimate", Note: "Overnight, every day."),
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
            "Jadrolinija", 11, true, 0, T("Mon,Thu 20:00"), T("Sun,Wed 20:00"), 1.5, "checked",
            Note: "Overnight; Split's days confirmed (the low-season pattern), Ancona's an estimate."),
        new("ancona-durres", "Ancona", "Ancona", "IT", "Durrës", "Durrës", "AL", 18, 615, "Italia + West Balkans",
            "Adria Ferries", 19, true, 0, T("14:00"), T("21:00"), 1.5, "estimate"),
        new("bari-durres", "Bari", "Bari", "IT", "Durrës", "Durrës", "AL", 9, 420, "Italia + West Balkans",
            "Ventouris / Adria Ferries", 9, true, 0, T("22:00"), T("22:00"), 1.5, "estimate", Note: "Overnight, every day."),
        new("ancona-igoumenitsa", "Ancona", "Ancona", "IT", "Igoumenitsa", "Igoumenitsa", "GR", 18.5, 1425, "Italia + Greece",
            "Minoan Lines / Anek-Superfast", 16, true, 0, T("13:30", "17:30"), T("12:30", "23:59"), 2, "estimate"),
        new("ancona-patra", "Ancona", "Ancona", "IT", "Patra", "Patra", "GR", 25, 1425, "Italia + Greece",
            "Minoan Lines / Anek-Superfast", 21, true, 0, T("13:30", "17:30"), T("15:00", "18:00"), 2, "estimate"),
        new("bari-igoumenitsa", "Bari", "Bari", "IT", "Igoumenitsa", "Igoumenitsa", "GR", 9.5, 745, "Italia + Greece",
            "Anek-Superfast", 9.5, true, 0, T("Mon-Sat 19:00", "Sun 14:30"), T("23:59"), 2, "checked",
            Note: "From Bari 19:00, 14:30 on Sundays; the time back is an estimate."),
        new("bari-patra", "Bari", "Bari", "IT", "Patra", "Patra", "GR", 17.5, 870, "Italia + Greece",
            "Anek-Superfast", 17, true, 0, T("Mon-Sat 19:00", "Sun 14:30"), T("17:30"), 2, "checked",
            Note: "From Bari 19:00, 14:30 on Sundays; the time back is an estimate."),
        new("trieste-igoumenitsa", "Trieste", "Trieste", "IT", "Igoumenitsa", "Igoumenitsa", "GR", 27, 1590, "Greece",
            "Anek Lines", 25, true, 0, T("Mon,Tue,Wed 19:00", "Fri,Sat 13:00", "Sun 12:00"), T("Mon,Tue,Thu,Fri,Sun 06:00", "Sat 05:00"), 2, "estimate",
            Note: "The Trieste – Patras ship calls at Igoumenitsa: Trieste's days are confirmed, Igoumenitsa's are worked out from them."),
        new("trieste-patra", "Trieste", "Trieste", "IT", "Patra", "Patra", "GR", 33, 1860, "Greece",
            "Anek Lines", 32, true, 0, T("Mon,Tue,Wed 19:00", "Fri,Sat 13:00", "Sun 12:00"), T("Mon,Wed,Thu,Sat,Sun 23:59", "Fri 23:00"), 2, "checked",
            Note: "Six a week each way, 24 to 35 hours depending on the calls; 32 is the usual."),
        new("kavala-chios", "Kavala", "Kavala", "GR", "Chios", "Chios", "GR", 11.5, 1521, "Greece",
            "", 0, true, 0, None, None, 1, "game", Note: "Served via Lesvos in reality, a few times a week; the game's time is used."),
        new("kavala-mytilini", "Kavala", "Kavala", "GR", "Mytilini", "Mytilini", "GR", 12.17, 1440, "Greece",
            "", 0, true, 0, None, None, 1, "game", Note: "A few sailings a week in reality; the game's time is used."),
        new("chios-mytilini", "Chios", "Chios", "GR", "Mytilini", "Mytilini", "GR", 2.25, 468, "Greece",
            "Blue Star Ferries", 3, false, 0, T("05:00"), T("21:00"), 1, "estimate"),
        new("piraeus-chania", "Piraeus", "Piraeus", "GR", "Chania", "Chania", "GR", 9, 826, "Greece",
            "ANEK Lines", 9, true, 0, T("21:00"), T("22:00"), 1.5, "checked", Note: "Overnight, every day: 21:00 – 06:00 out, 22:00 – 06:30 back."),
        new("piraeus-chios", "Piraeus", "Piraeus", "GR", "Chios", "Chios", "GR", 9, 840, "Greece",
            "Blue Star Ferries", 8, true, 0, T("Mon-Sat 19:00"), T("Mon-Sat 09:00"), 1.5, "estimate", Note: "Six or seven a week; about 8 hours."),
        new("piraeus-irakleio", "Piraeus", "Piraeus", "GR", "Irakleio", "Irakleio", "GR", 9, 760, "Greece",
            "Minoan Lines", 9.5, true, 0, T("21:00"), T("21:00"), 1.5, "checked", Note: "Overnight, every day: 21:00 – 06:30."),
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

        // ---- ProMods: real ferries serving the regions ProMods adds. NOT yet confirmed against ProMods' own map —
        // the in-game ferry list is the authority; one ProMods does not have simply never comes up as a choice.
        new("hirtshals-seydisfjordur", "Hirtshals", "Hirtshals", "DK", "Seyðisfjörður", "Seyðisfjörður", "IS", 0, 0, "ProMods",
            "Smyril Line (via Tórshavn)", 47, true, 0, T("Sat 15:00"), T("Thu 10:00"), 2, "promods", Note: "Weekly, through the Faroes."),
        new("hirtshals-torshavn", "Hirtshals", "Hirtshals", "DK", "Tórshavn", "Tórshavn", "FO", 0, 0, "ProMods",
            "Smyril Line", 36, true, 0, T("Sat 15:00"), T("Mon 15:00"), 2, "promods"),
        new("torshavn-seydisfjordur", "Tórshavn", "Tórshavn", "FO", "Seyðisfjörður", "Seyðisfjörður", "IS", 0, 0, "ProMods",
            "Smyril Line", 19, true, 0, T("Mon 03:00"), T("Thu 10:00"), 2, "promods"),
        new("holyhead-dublin", "Holyhead", "Holyhead", "UK", "Dublin", "Dublin", "IE", 0, 0, "ProMods",
            "Stena Line / Irish Ferries", 3.25, false, 0, T("02:30", "08:55", "14:10", "20:15"), T("02:15", "08:05", "14:50", "20:55"), 1, "promods"),
        new("liverpool-dublin", "Liverpool", "Liverpool", "UK", "Dublin", "Dublin", "IE", 0, 0, "ProMods",
            "P&O Ferries", 8, true, 0, T("08:00", "21:30"), T("08:00", "21:30"), 1.5, "promods"),
        new("liverpool-belfast", "Liverpool (Birkenhead)", "Liverpool", "UK", "Belfast", "Belfast", "UK", 0, 0, "ProMods",
            "Stena Line", 8, true, 0, T("10:30", "22:30"), T("10:30", "22:30"), 1.5, "promods"),
        new("cairnryan-belfast", "Cairnryan", "Stranraer", "UK", "Belfast", "Belfast", "UK", 0, 0, "ProMods",
            "Stena Line", 2.25, false, 240, None, None, 1, "promods", Note: "About six a day."),
        new("cairnryan-larne", "Cairnryan", "Stranraer", "UK", "Larne", "Larne", "UK", 0, 0, "ProMods",
            "P&O Ferries", 2, false, 180, None, None, 1, "promods"),
        new("fishguard-rosslare", "Fishguard", "Fishguard", "UK", "Rosslare", "Rosslare", "IE", 0, 0, "ProMods",
            "Stena Line", 3.5, false, 0, T("02:30", "14:30"), T("09:15", "21:15"), 1, "promods"),
        new("pembroke-rosslare", "Pembroke", "Pembroke", "UK", "Rosslare", "Rosslare", "IE", 0, 0, "ProMods",
            "Irish Ferries", 4, false, 0, T("02:45", "14:45"), T("08:45", "20:45"), 1, "promods"),
        new("cherbourg-rosslare", "Cherbourg", "Cherbourg-en-Cotentin", "FR", "Rosslare", "Rosslare", "IE", 0, 0, "ProMods",
            "Stena Line / Brittany Ferries", 17, true, 0, T("Mon,Wed,Fri 21:30"), T("Tue,Thu,Sun 21:30"), 2, "promods"),
        new("cherbourg-dublin", "Cherbourg", "Cherbourg-en-Cotentin", "FR", "Dublin", "Dublin", "IE", 0, 0, "ProMods",
            "Irish Ferries", 18, true, 0, T("Tue,Thu,Sat 16:00"), T("Mon,Wed,Fri 16:00"), 2, "promods"),
        new("portsmouth-cherbourg", "Portsmouth", "Portsmouth", "UK", "Cherbourg", "Cherbourg-en-Cotentin", "FR", 0, 0, "ProMods",
            "Brittany Ferries", 3, false, 0, T("08:15", "23:00"), T("18:30", "23:00"), 1, "promods"),
        new("heysham-douglas", "Heysham", "Heysham", "UK", "Douglas", "Douglas", "IM", 0, 0, "ProMods",
            "Isle of Man Steam Packet", 3.75, false, 0, T("02:15", "14:15"), T("08:45", "19:45"), 1, "promods"),
        new("poole-stpeterport", "Poole", "Poole", "UK", "St. Peter Port", "St. Peter Port", "GG", 0, 0, "ProMods",
            "Condor Ferries", 3, false, 0, T("08:00"), T("17:00"), 1, "promods"),
        new("stpeterport-sthelier", "St. Peter Port", "St. Peter Port", "GG", "Saint Helier", "Saint Helier", "JE", 0, 0, "ProMods",
            "Condor Ferries", 1, false, 0, T("12:00"), T("15:00"), 0.75, "promods"),
        new("stmalo-sthelier", "Saint-Malo", "Saint-Malo", "FR", "Saint Helier", "Saint Helier", "JE", 0, 0, "ProMods",
            "Condor Ferries", 1.5, false, 0, T("09:00", "18:00"), T("07:00", "16:00"), 0.75, "promods"),
        new("ullapool-stornoway", "Ullapool", "Ullapool", "UK", "Stornoway", "Stornoway", "UK", 0, 0, "ProMods",
            "CalMac", 2.75, false, 0, T("10:30", "17:30"), T("07:00", "14:00"), 0.75, "promods"),
        new("uig-tarbert", "Uig", "Portree", "UK", "Tarbert", "Stornoway", "UK", 0, 0, "ProMods",
            "CalMac", 1.75, false, 0, T("09:40", "14:00"), T("07:30", "11:50"), 0.5, "promods"),
        new("uig-lochmaddy", "Uig", "Portree", "UK", "Lochmaddy", "Balivanich", "UK", 0, 0, "ProMods",
            "CalMac", 1.75, false, 0, T("09:40", "18:00"), T("07:30", "15:30"), 0.5, "promods"),
        new("scrabster-stromness", "Scrabster", "Thurso", "UK", "Stromness", "Stromness", "UK", 0, 0, "ProMods",
            "NorthLink Ferries", 1.5, false, 0, T("08:45", "13:15", "19:00"), T("06:30", "11:00", "16:45"), 0.75, "promods"),
        new("aberdeen-lerwick", "Aberdeen", "Aberdeen", "UK", "Lerwick", "Lerwick", "UK", 0, 0, "ProMods",
            "NorthLink Ferries", 12.5, true, 0, T("17:00"), T("17:30"), 1.5, "promods", Note: "Overnight, every day."),
        new("puttgarden-rodby", "Puttgarden", "Puttgarden", "DE", "Rødby", "Rødbyhavn", "DK", 0, 0, "ProMods",
            "Scandlines", 0.75, false, 30, None, None, 0.25, "promods", Note: "Every half hour, round the clock."),
        new("hirtshals-larvik", "Hirtshals", "Hirtshals", "DK", "Larvik", "Larvik", "NO", 0, 0, "ProMods",
            "Color Line", 3.75, false, 0, T("09:15", "21:15"), T("08:00", "20:00"), 1, "promods"),
        new("stockholm-turku", "Stockholm", "Stockholm", "SE", "Turku", "Turku", "FI", 0, 0, "ProMods",
            "Viking Line / Tallink Silja", 11, true, 0, T("07:45", "20:00"), T("08:15", "20:15"), 1, "promods"),
        new("grisslehamn-eckero", "Grisslehamn", "Hallstavik", "SE", "Eckerö", "Eckeroe", "AX", 0, 0, "ProMods",
            "Eckerö Linjen", 2, false, 0, T("09:00", "14:00", "18:30"), T("07:30", "12:30", "17:00"), 0.5, "promods"),
        new("kapellskar-mariehamn", "Kapellskär", "Kapellskär", "SE", "Mariehamn", "Mariehamn", "AX", 0, 0, "ProMods",
            "Viking Line", 2.25, false, 0, T("09:45", "16:45", "21:00"), T("06:00", "13:00", "18:00"), 0.5, "promods"),
        new("virtsu-kuivastu", "Virtsu", "Virtsu", "EE", "Kuivastu", "Orissaare", "EE", 0, 0, "ProMods",
            "Praamid", 0.5, false, 40, None, None, 0.25, "promods", Note: "To Muhu and Saaremaa; every 40 minutes or so."),
        new("rohukula-heltermaa", "Rohuküla", "Haapsalu", "EE", "Heltermaa", "Kaeina", "EE", 0, 0, "ProMods",
            "Praamid", 1.25, false, 0, T("07:00", "10:00", "13:00", "16:00", "19:00", "22:00"), T("05:30", "08:30", "11:30", "14:30", "17:30", "20:30"), 0.25, "promods",
            Note: "To Hiiumaa."),
        new("pozzallo-valletta", "Pozzallo", "Pozzallo", "IT", "Valletta", "Il-Belt Valletta", "MT", 0, 0, "ProMods",
            "Virtu Ferries", 1.75, false, 0, T("09:30", "19:00"), T("06:30", "16:30"), 1, "promods"),
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
        var sailings = (fromA ? r.FromA : r.FromB).Select(Parse).ToList();
        if (sailings.Count == 0) return ready;
        // Up to a week ahead, for the routes that sail on named days only.
        for (var d = 0; d < 8; d++)
        {
            var day = ready.Date.AddDays(d);
            var weekday = GameClock.WeekdayOf(GameClock.DayOf(day));
            var first = sailings.Where(x => x.Days == null || x.Days.Contains(weekday))
                                .Select(x => day + x.Time).Where(t => t >= ready).OrderBy(t => t).FirstOrDefault();
            if (first != default) return first;
        }
        return ready;
    }

    /// <summary>
    /// One timetable entry: "09:00" (every day), "Sat 15:00", "Sun,Wed 16:00" or "Mon-Fri 20:30". Days are
    /// read on the game's own calendar, where day 1 is a Monday.
    /// </summary>
    internal static (HashSet<DayOfWeek>? Days, TimeSpan Time) Parse(string entry)
    {
        var parts = entry.Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 1) return (null, TimeSpan.Parse(parts[0]));
        var days = new HashSet<DayOfWeek>();
        foreach (var piece in parts[0].Split(','))
        {
            var range = piece.Split('-');
            var a = Day(range[0]);
            var b = range.Length > 1 ? Day(range[1]) : a;
            for (var d = a; ; d = (DayOfWeek)(((int)d + 1) % 7))
            {
                days.Add(d);
                if (d == b) break;
            }
        }
        return (days, TimeSpan.Parse(parts[1]));
    }

    private static DayOfWeek Day(string s) => s.Trim()[..3].ToLowerInvariant() switch
    {
        "mon" => DayOfWeek.Monday, "tue" => DayOfWeek.Tuesday, "wed" => DayOfWeek.Wednesday,
        "thu" => DayOfWeek.Thursday, "fri" => DayOfWeek.Friday, "sat" => DayOfWeek.Saturday,
        _ => DayOfWeek.Sunday,
    };

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
                  (r.RealHours > 0 && r.GameHours > 0 && Math.Abs(r.RealHours - r.GameHours) > 0.1 ? $" (the game takes {Hhmm.Of(r.GameHours)})" : "") + ".");
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
