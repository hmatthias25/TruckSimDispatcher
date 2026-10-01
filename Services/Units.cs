using System.Globalization;
using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How figures are shown and typed: miles or kilometres, gallons or litres, pounds or kilograms, and
/// which currency. Step 2 of Euro Truck Simulator 2 support (#266, #268).
///
/// <para><b>Stored once, shown either way.</b> The career file keeps distance in miles, fuel in US
/// gallons, weight in pounds and speed in mph, whatever the player sees. Renaming seventy fields would
/// rewrite every career on disk for nothing; converting at the edges costs one multiplication. So
/// everything the app <i>says</i> goes through here, and everything the player <i>types</i> is converted
/// back before it is stored — the server's own API stays in miles.</para>
///
/// <para><b>Which system.</b> The career's game decides by default (<see cref="GameProfile.Units"/>):
/// US for ATS, metric for ETS2. <see cref="AppSettings.DisplayUnits"/> overrides it, because ATS itself
/// can be played in kilometres and a player who does should read the same figures here as on their dash.</para>
///
/// <para>Like <see cref="GameProfile.Current"/>, this answers for the career that is open; the store
/// re-reads it whenever a career is opened or changed.</para>
/// </summary>
public static class Units
{
    public const double KmPerMile = 1.609344;
    public const double LitresPerGallon = 3.785411784;
    public const double KgPerPound = 0.45359237;

    public sealed record UnitSystem(
        string Id,
        string Distance, double DistancePerMile,
        string Volume, double VolumePerGallon,
        string Weight, double WeightPerPound,
        string Speed)
    {
        public bool Metric => Id == "metric";
    }

    public static readonly UnitSystem Us = new("US", "mi", 1, "gal", 1, "lb", 1, "mph");
    public static readonly UnitSystem Metric = new("metric", "km", KmPerMile, "L", LitresPerGallon, "kg", KgPerPound, "km/h");

    public static UnitSystem For(string? id) =>
        string.Equals((id ?? "").Trim(), "metric", StringComparison.OrdinalIgnoreCase) ? Metric : Us;

    /// <summary>The system a career shows: its own choice if it made one, otherwise its game's.</summary>
    public static UnitSystem For(AppState s) =>
        string.IsNullOrWhiteSpace(s.Settings.DisplayUnits) ? For(GameProfile.For(s).Units) : For(s.Settings.DisplayUnits);

    public static string CurrencySymbolFor(AppState s) => GameProfile.For(s).CurrencySymbol;

    private static UnitSystem _current = Us;
    private static string _symbol = "$";

    /// <summary>The open career's system. Set by <see cref="Activate"/>, which the store calls.</summary>
    public static UnitSystem Current => Volatile.Read(ref _current);
    public static string Symbol => Volatile.Read(ref _symbol);

    public static void Activate(AppState? s)
    {
        Volatile.Write(ref _current, s == null ? Us : For(s));
        Volatile.Write(ref _symbol, s == null ? "$" : CurrencySymbolFor(s));
    }

    // Invariant, not en-US: the app runs with InvariantGlobalization, where asking for a named culture
    // throws. The invariant culture groups and points exactly as en-US does.
    private static readonly CultureInfo En = CultureInfo.InvariantCulture;

    // ------------------------------------------------------------------ distance

    /// <summary>A distance stored in miles, as the number the player reads.</summary>
    public static double Dist(double miles) => miles * Current.DistancePerMile;

    /// <summary>"1,234 mi" or "1,986 km".</summary>
    public static string Distance(double miles, string format = "N0") =>
        Dist(miles).ToString(format, En) + " " + Current.Distance;

    /// <summary>An optional distance. Empty prints nothing before the unit, as an empty hole always did.</summary>
    public static string Distance(double? miles, string format = "N0") =>
        miles is { } m ? Distance(m, format) : " " + Current.Distance;

    /// <summary>A distance the player typed, back into miles.</summary>
    public static double ToMiles(double shown) => shown / Current.DistancePerMile;

    public static string DistUnit => Current.Distance;

    // ------------------------------------------------------------------ money

    // Money is written the way the server always wrote it — the symbol, then the number as .NET formats
    // it, so a negative reads "$-12.00". Changing that here would change every audit line for ATS, and this
    // step is not allowed to change ATS at all.

    /// <summary>"$1,234.56".</summary>
    public static string Money(decimal amount, string format = "N2") => Symbol + amount.ToString(format, En);
    public static string Money(double amount, string format = "N2") => Symbol + amount.ToString(format, En);

    /// <summary>"$1,235", whole units.</summary>
    public static string Money0(decimal amount) => Money(amount, "N0");
    public static string Money0(double amount) => Money(amount, "N0");

    /// <summary>A rate stored per mile, as "$1.23/mi" or "€0.76/km".</summary>
    public static string PerDistance(decimal perMile, string format = "0.00") =>
        PerDist(perMile, format) + "/" + Current.Distance;
    public static string PerDistance(double perMile, string format = "0.00") =>
        PerDistance((decimal)perMile, format);

    /// <summary>A rate stored per mile, as "$1.23" per mile or "€0.76" per km, with no unit after it.</summary>
    public static string PerDist(decimal perMile, string format) =>
        Symbol + (perMile / (decimal)Current.DistancePerMile).ToString(format, En);
    public static string PerDist(double perMile, string format) => PerDist((decimal)perMile, format);

    /// <summary>A rate stored per mile, as the bare number shown per km or per mile.</summary>
    public static decimal PerDist(decimal perMile) => perMile / (decimal)Current.DistancePerMile;

    // ------------------------------------------------------------------ fuel

    public static double Vol(double gallons) => gallons * Current.VolumePerGallon;

    /// <summary>"1,234 miles" or "1,986 km", for running text that spells the unit out.</summary>
    public static string DistanceWords(double miles, string format = "N0") =>
        Dist(miles).ToString(format, En) + " " + (Current.Metric ? "km" : "miles");

    public static string DistanceWords(double? miles, string format = "N0") =>
        miles is { } m ? DistanceWords(m, format) : " " + (Current.Metric ? "km" : "miles");

    /// <summary>"85.0 gal" or "321.8 L".</summary>
    public static string Volume(double gallons, string format = "N1") =>
        Vol(gallons).ToString(format, En) + " " + Current.Volume;

    public static double ToGallons(double shown) => shown / Current.VolumePerGallon;

    /// <summary>A price stored per gallon, as "$6.32/gal" or "€1.67/L".</summary>
    public static string FuelPrice(decimal perGallon, string format = "0.00") =>
        Symbol + (perGallon / (decimal)Current.VolumePerGallon).ToString(format, En) + "/" + Current.Volume;
    public static string FuelPrice(double perGallon, string format = "0.00") => FuelPrice((decimal)perGallon, format);

    /// <summary>Economy stored as miles per US gallon, as "6.5 mpg" or "36.2 L/100 km".</summary>
    public static string Economy(double mpg, string format = "0.0")
    {
        if (!Current.Metric) return mpg.ToString(format, En) + " mpg";
        return mpg > 0 ? (235.214583 / mpg).ToString(format, En) + " L/100 km" : "— L/100 km";
    }

    // ------------------------------------------------------------------ weight and speed

    public static double Wt(double pounds) => pounds * Current.WeightPerPound;

    /// <summary>"42,000 lb" or "19,051 kg".</summary>
    public static string Weight(double pounds, string format = "N0") =>
        Wt(pounds).ToString(format, En) + " " + Current.Weight;

    public static double ToPounds(double shown) => shown / Current.WeightPerPound;

    /// <summary>"65 mph" or "105 km/h".</summary>
    public static string Speed(double mph, string format = "0") =>
        (mph * Current.DistancePerMile).ToString(format, En) + " " + Current.Speed;

    /// <summary>What the browser needs to show and read figures the same way.</summary>
    public static object View(AppState s)
    {
        var u = For(s);
        return new
        {
            id = u.Id,
            distance = u.Distance, distancePerMile = u.DistancePerMile,
            volume = u.Volume, volumePerGallon = u.VolumePerGallon,
            weight = u.Weight, weightPerPound = u.WeightPerPound,
            speed = u.Speed,
            economy = u.Metric ? "L/100 km" : "mpg",
            currency = GameProfile.For(s).Currency,
            symbol = CurrencySymbolFor(s),
            // What the career would show with no override, so Settings can say what "game default" means.
            gameDefault = For(GameProfile.For(s).Units).Id,
            chosen = s.Settings.DisplayUnits ?? "",
        };
    }
}
