namespace TruckSimDispatcher.Services;

/// <summary>
/// The build number, defined once.
///
/// Everything that shows a version reads it from here — the app header, Settings, the startup banner,
/// the career file and the manual. A version that has to be updated in four places is wrong in two of
/// them within a release.
/// </summary>
public static class Build
{
    /// <summary>
    /// Rising in 0.1 steps through alpha, and it keeps going past 0.9 rather than rolling to 1.0:
    /// <b>0.9 is followed by 0.10</b>, then 0.11. A 1.0 means released, and this is not that. Beta will
    /// have its own numbering.
    /// </summary>
    public const string Version = "0.11";

    /// <summary>Alpha | Beta | Release — shown alongside the number.</summary>
    public const string Stage = "alpha";

    public static string Display => $"v{Version} {Stage}";
}
