using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Which game a career is played in, and everything that differs because of it.
///
/// <para>Step 1 of Euro Truck Simulator 2 support (#266, #267). One app, the game chosen per career and
/// fixed for it: a US career and a European one have different cities, distances, pay and clock rules,
/// and a career that changed game halfway would be wrong in every one of them. So the choice lives on
/// <see cref="AppState.Game"/>, and this is what it resolves to.</para>
///
/// <para><b>ATS and ETS2.</b> ETS2's data arrived in step 3 (#269); its own rules — hours of service, pay —
/// come in later steps, and until they do an ETS2 career borrows ATS's. Step 1 moved no behaviour. It is the seam: the tables that were
/// read directly — the freight markets, the city coordinates, the regions, the time zones, fuel, the
/// in-game companies, the carriers, the starting companies, the dealer trucks, the trailer makes, the HazMat
/// classes, payroll tax, the mod folders — are now
/// reached through the profile, so a second one can supply its own. Each table keeps its ATS data where it
/// always was, under an <c>Ats</c> name, and this class points at it.</para>
///
/// <para><b>Why an active profile rather than a parameter.</b> Most of those lookups — <c>Geo.Locate</c>,
/// <c>GameZones.ZoneOf</c>, <c>PayrollTax.StateRate</c> — never see the career, and they are called from
/// hundreds of places. The app has exactly one career open at a time, and <see cref="StateStore"/> is the
/// only thing that opens one, so it sets <see cref="Current"/> whenever it does. Anything that reads a
/// table therefore reads it for the career that is open.</para>
/// </summary>
public sealed class GameProfile
{
    /// <summary>Stored on the career. Never changes once the career has started.</summary>
    public string Id { get; }
    public string Name { get; }
    /// <summary>What the app calls the game in running text: "ATS".</summary>
    public string ShortName { get; }

    /// <summary>The Steam app id, which is also the workshop folder mods are kept under.</summary>
    public string SteamAppId { get; }
    /// <summary>The game's folder name, under Documents and under steamapps\common alike.</summary>
    public string GameFolder { get; }

    /// <summary>Which hours-of-service rules apply. "FMCSA" is the only engine there is.</summary>
    public string HosRuleset { get; }
    /// <summary>Miles, gallons and pounds ("US"), or metric. Only "US" is implemented.</summary>
    public string Units { get; }
    public string Currency { get; }
    /// <summary>What goes in front of an amount: "$" for USD.</summary>
    public string CurrencySymbol => Currency switch { "EUR" => "€", "GBP" => "£", "CHF" => "CHF ", _ => "$" };
    /// <summary>How pay is taxed. "US" is federal brackets, FICA, state rates and W-2s.</summary>
    public string TaxModel { get; }

    private readonly Lazy<IReadOnlyList<MarketCity>> _markets;
    private readonly Lazy<IReadOnlyList<MapCoverage.Region>> _regions;
    private readonly Lazy<IReadOnlyList<string>> _defaultRegions;
    private readonly Lazy<IReadOnlyDictionary<string, (double Lat, double Lon)>> _centres;
    private readonly Lazy<IReadOnlyDictionary<string, int>> _zones;
    private readonly Lazy<IReadOnlyDictionary<int, string>> _zoneNames;
    private readonly Lazy<IReadOnlyDictionary<string, double>> _fuelIndex;
    private readonly Lazy<AtsCompanies.Firm[]> _companies;
    private readonly Lazy<Endorsements.HazClass[]> _hazmat;
    private readonly Lazy<IReadOnlyDictionary<string, decimal>> _regionTax;
    private readonly Lazy<(decimal Upto, decimal Rate)[]> _incomeTax;
    private readonly Lazy<Carriers.Spec[]> _carriersReal, _carriersFictional, _carriersSecondChance;
    private readonly Lazy<(string Name, string Code, string Division, string City, string State, string Motto)[]> _startingCompanies;
    private readonly Lazy<Seed.TruckSpec[]> _trucksAutomatic, _trucksManual, _trucksShowcase;

    /// <summary>The freight-market table the game ships with, before any the driver added.</summary>
    public IReadOnlyList<MarketCity> Markets => _markets.Value;
    /// <summary>Embedded city-coordinate files, read into one table.</summary>
    public IReadOnlyList<string> CityResources { get; }
    /// <summary>Where each state or country sits, for distances when a city is not known.</summary>
    public IReadOnlyDictionary<string, (double Lat, double Lon)> RegionCentres => _centres.Value;
    /// <summary>The states, provinces or countries a driver can say they run.</summary>
    public IReadOnlyList<MapCoverage.Region> Regions => _regions.Value;
    /// <summary>How <see cref="Regions"/> are grouped on the Where you run panel: key, heading, note.</summary>
    public IReadOnlyList<(string Key, string Title, string Note)> RegionGroups { get; }
    /// <summary>The regions a career runs until the driver says otherwise.</summary>
    public IReadOnlyList<string> DefaultRegions => _defaultRegions.Value;
    /// <summary>What the default means, said on the Where you run panel.</summary>
    public string DefaultRegionsNote { get; }
    /// <summary>Time zone by region, as hours ahead of an arbitrary base. Only differences are used.</summary>
    public IReadOnlyDictionary<string, int> TimeZones => _zones.Value;
    public IReadOnlyDictionary<int, string> TimeZoneNames => _zoneNames.Value;
    /// <summary>Fuel price by region, as a multiple of the national figure.</summary>
    public IReadOnlyDictionary<string, double> FuelIndex => _fuelIndex.Value;
    public decimal DefaultFuelPrice { get; }
    public string FuelPriceBasis { get; }
    /// <summary>The companies in the game itself — the names on its freight board.</summary>
    public AtsCompanies.Firm[] Companies => _companies.Value;
    /// <summary>The regions every copy of the game has, before any map DLC.</summary>
    public IReadOnlyList<string> BaseGameRegions { get; }
    /// <summary>Dangerous-goods classes, as the game unlocks them.</summary>
    public Endorsements.HazClass[] HazmatClasses => _hazmat.Value;
    /// <summary>Income tax by region, a flat rate. Only the US tax model reads it.</summary>
    public IReadOnlyDictionary<string, decimal> RegionTaxRates => _regionTax.Value;
    /// <summary>National income tax brackets. Only the US tax model reads them.</summary>
    public (decimal Upto, decimal Rate)[] IncomeTaxBrackets => _incomeTax.Value;

    /// <summary>Carriers named after real companies, when the career chose the real roster.</summary>
    internal Carriers.Spec[] CarriersReal => _carriersReal.Value;
    /// <summary>Carriers invented for the app, when the career chose the fictional roster.</summary>
    internal Carriers.Spec[] CarriersFictional => _carriersFictional.Value;
    /// <summary>The only carriers that will take on a driver let go for the work.</summary>
    internal Carriers.Spec[] CarriersSecondChance => _carriersSecondChance.Value;
    /// <summary>The part of the map a carrier is run from, for filtering the job board.</summary>
    internal Func<string?, string> CarrierRegionOf { get; }
    /// <summary>The companies a new career can be started as.</summary>
    internal (string Name, string Code, string Division, string City, string State, string Motto)[] StartingCompanies =>
        _startingCompanies.Value;
    /// <summary>Dealer trucks with automated gearboxes.</summary>
    internal Seed.TruckSpec[] TrucksAutomatic => _trucksAutomatic.Value;
    /// <summary>Dealer trucks for a driver who asked for a manual.</summary>
    internal Seed.TruckSpec[] TrucksManual => _trucksManual.Value;
    /// <summary>Dealer trucks a five-star carrier issues.</summary>
    internal Seed.TruckSpec[] TrucksShowcase => _trucksShowcase.Value;
    /// <summary>The make written on a trailer of this type when the company buys one.</summary>
    internal Func<string, string> TrailerMake { get; }

    private GameProfile(
        string id, string name, string shortName, string steamAppId, string gameFolder,
        string hosRuleset, string units, string currency, string taxModel,
        Func<IReadOnlyList<MarketCity>> markets, IReadOnlyList<string> cityResources,
        Func<IReadOnlyDictionary<string, (double Lat, double Lon)>> centres,
        Func<IReadOnlyList<MapCoverage.Region>> regions,
        IReadOnlyList<(string Key, string Title, string Note)> regionGroups,
        Func<IReadOnlyList<string>> defaultRegions, string defaultRegionsNote,
        Func<IReadOnlyDictionary<string, int>> zones, Func<IReadOnlyDictionary<int, string>> zoneNames,
        Func<IReadOnlyDictionary<string, double>> fuelIndex, decimal defaultFuelPrice, string fuelPriceBasis,
        Func<AtsCompanies.Firm[]> companies, IReadOnlyList<string> baseGameRegions,
        Func<Endorsements.HazClass[]> hazmat,
        Func<IReadOnlyDictionary<string, decimal>> regionTax, Func<(decimal Upto, decimal Rate)[]> incomeTax,
        Func<Carriers.Spec[]> carriersReal, Func<Carriers.Spec[]> carriersFictional,
        Func<Carriers.Spec[]> carriersSecondChance, Func<string?, string> carrierRegionOf,
        Func<(string Name, string Code, string Division, string City, string State, string Motto)[]> startingCompanies,
        Func<Seed.TruckSpec[]> trucksAutomatic, Func<Seed.TruckSpec[]> trucksManual, Func<Seed.TruckSpec[]> trucksShowcase,
        Func<string, string> trailerMake)
    {
        Id = id; Name = name; ShortName = shortName; SteamAppId = steamAppId; GameFolder = gameFolder;
        HosRuleset = hosRuleset; Units = units; Currency = currency; TaxModel = taxModel;
        _markets = new(markets);
        CityResources = cityResources;
        _centres = new(centres);
        _regions = new(regions);
        RegionGroups = regionGroups;
        _defaultRegions = new(defaultRegions);
        DefaultRegionsNote = defaultRegionsNote;
        _zones = new(zones);
        _zoneNames = new(zoneNames);
        _fuelIndex = new(fuelIndex);
        DefaultFuelPrice = defaultFuelPrice;
        FuelPriceBasis = fuelPriceBasis;
        _companies = new(companies);
        BaseGameRegions = baseGameRegions;
        _hazmat = new(hazmat);
        _regionTax = new(regionTax);
        _incomeTax = new(incomeTax);
        _carriersReal = new(carriersReal);
        _carriersFictional = new(carriersFictional);
        _carriersSecondChance = new(carriersSecondChance);
        CarrierRegionOf = carrierRegionOf;
        _startingCompanies = new(startingCompanies);
        _trucksAutomatic = new(trucksAutomatic);
        _trucksManual = new(trucksManual);
        _trucksShowcase = new(trucksShowcase);
        TrailerMake = trailerMake;
    }

    // Lazy throughout: the tables are static fields of other classes, and building this eagerly would make
    // the order those classes initialise in matter. Nothing is read until something asks.
    public static readonly GameProfile Ats = new(
        id: "ATS",
        name: "American Truck Simulator",
        shortName: "ATS",
        steamAppId: "270880",
        gameFolder: "American Truck Simulator",
        hosRuleset: "FMCSA",
        units: "US",
        currency: "USD",
        taxModel: "US",
        markets: () => Services.Markets.AtsBuiltIn,
        cityResources: new[] { "data/us-cities.txt", "data/ca-cities.txt" },
        centres: () => Geo.AtsCentres,
        regions: () => MapCoverage.AtsRegions,
        regionGroups: new[]
        {
            ("US", "United States", ""),
            ("CA", "Canada", "Coast to Coast, Promods Canada and the Canadian packs. Off unless you run one."),
            ("MX", "Mexico", "Viva Mexico and the southern packs. Off unless you run one."),
        },
        defaultRegions: () => MapCoverage.AtsRegions.Where(r => r.Country == "US").Select(r => r.Code).ToList(),
        defaultRegionsNote: "Defaults to every US state, which is a superset of anywhere base ATS goes — so on a " +
                            "stock install this does nothing at all. It is here for map mods. Turn a region off " +
                            "when you do not have it installed, or have it and do not want the work.",
        zones: () => GameZones.AtsZones,
        zoneNames: () => GameZones.AtsZoneNames,
        fuelIndex: () => Fuel.AtsStateIndex,
        defaultFuelPrice: Fuel.DefaultPricePerGal,
        fuelPriceBasis: Fuel.PriceBasis,
        companies: () => AtsCompanies.AtsFirms,
        baseGameRegions: new[] { "CA", "NV", "AZ" },
        hazmat: () => Endorsements.AtsClasses,
        regionTax: () => PayrollTax.AtsStateRates,
        incomeTax: () => PayrollTax.AtsFederalSingle,
        carriersReal: () => Carriers.AtsRealWorld,
        carriersFictional: () => Carriers.AtsFictional,
        carriersSecondChance: () => Carriers.AtsSecondChance,
        carrierRegionOf: Carriers.AtsRegionOf,
        startingCompanies: () => Seed.AtsProfiles,
        trucksAutomatic: () => Seed.AtsAmtSpecs,
        trucksManual: () => Seed.AtsManualSpecs,
        trucksShowcase: () => Seed.AtsShowcaseSpecs,
        trailerMake: Seed.AtsTrailerMake);

    /// <summary>
    /// Euro Truck Simulator 2. Its data is <see cref="Ets2Data"/>; see that for what is real and what is
    /// still borrowed from ATS until a later step (trailer types, the pay model, the hours-of-service rules).
    /// </summary>
    public static readonly GameProfile Ets2 = new(
        id: "ETS2",
        name: "Euro Truck Simulator 2",
        shortName: "ETS2",
        steamAppId: "227300",
        gameFolder: "Euro Truck Simulator 2",
        // Not built yet (#270): until it is, the FMCSA engine runs on whatever numbers HosRules holds.
        hosRuleset: "EU561",
        units: "metric",
        currency: "EUR",
        taxModel: "Flat",
        markets: () => Services.Markets.Ets2BuiltIn,
        cityResources: new[] { "data/eu-cities.txt" },
        centres: () => Ets2Data.Centres,
        regions: () => Ets2Data.Regions,
        regionGroups: Ets2Data.Groups,
        // Every country. One you do not have installed lists no jobs, so leaving it on costs nothing.
        defaultRegions: () => Ets2Data.Regions.Select(r => r.Code).ToList(),
        defaultRegionsNote: "Every country is on by default — one you do not have installed lists no jobs, so " +
                            "leaving it ticked costs nothing. Switch a country off when you do not want the " +
                            "work there: nobody has to go all the way to Iceland.",
        zones: () => Ets2Data.Zones,
        zoneNames: () => Ets2Data.ZoneNames,
        fuelIndex: () => Ets2Data.FuelIndex,
        defaultFuelPrice: Ets2Data.DefaultFuelPricePerGallon,
        fuelPriceBasis: Ets2Data.FuelPriceBasis,
        companies: () => Ets2Data.Firms,
        baseGameRegions: Ets2Data.BaseGame,
        hazmat: () => Ets2Data.Adr,
        regionTax: () => Ets2Data.NoRegionTax,
        incomeTax: () => Ets2Data.FlatIncomeTax,
        carriersReal: () => Ets2Data.CarriersReal,
        carriersFictional: () => Ets2Data.CarriersFictional,
        carriersSecondChance: () => Ets2Data.CarriersSecondChance,
        carrierRegionOf: Ets2Data.RegionOf,
        startingCompanies: () => Ets2Data.StartingCompanies,
        trucksAutomatic: () => Ets2Data.TrucksAutomatic,
        trucksManual: () => Ets2Data.TrucksManual,
        trucksShowcase: () => Ets2Data.TrucksShowcase,
        trailerMake: Ets2Data.TrailerMake);

    private static readonly Dictionary<string, GameProfile> ById =
        new(StringComparer.OrdinalIgnoreCase) { [Ats.Id] = Ats, [Ets2.Id] = Ets2 };

    /// <summary>Every game the app supports.</summary>
    public static IReadOnlyCollection<GameProfile> All => ById.Values;

    /// <summary>The profile for a stored game id. Anything unknown is ATS, which is what every career was.</summary>
    public static GameProfile For(string? id) =>
        id != null && ById.TryGetValue(id.Trim(), out var p) ? p : Ats;

    public static GameProfile For(AppState s) => For(s.Game);

    private static GameProfile _current = Ats;

    /// <summary>The profile of the career that is open. Set by <see cref="StateStore"/>, nowhere else.</summary>
    public static GameProfile Current => Volatile.Read(ref _current);

    /// <summary>Make this career's game the one every table answers for.</summary>
    public static void Activate(AppState? s) => Volatile.Write(ref _current, s == null ? Ats : For(s));
}
