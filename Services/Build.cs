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
    public const string Version = "0.44";

    /// <summary>Alpha | Beta | Release — shown alongside the number.</summary>
    public const string Stage = "alpha";

    /// <summary>
    /// When this executable was built, read off the file itself.
    ///
    /// The version number moves once a release; a bug hunt moves through a dozen builds in an afternoon
    /// and every one of them says v0.44 alpha. That cost a whole diagnosis: a fix went out, the same
    /// fault came back, and neither of us could tell whether the build under test contained the fix.
    ///
    /// Off the file rather than stamped in at compile time, because a single-file publish rewrites the
    /// exe and its timestamp IS the publish. Nothing to remember, nothing to pass through MSBuild, and
    /// it cannot drift from the binary it describes.
    /// </summary>
    public static string Stamp
    {
        get
        {
            try
            {
                var path = Environment.ProcessPath;
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return "";
                return File.GetLastWriteTime(path).ToString("yyyy-MM-dd HH:mm");
            }
            catch
            {
                // A version string is not worth failing a page render over.
                return "";
            }
        }
    }

    public static string Display =>
        Stamp.Length > 0 ? $"v{Version} {Stage} · build {Stamp}" : $"v{Version} {Stage}";
}
