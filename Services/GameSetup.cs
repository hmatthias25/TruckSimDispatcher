using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Choosing the game for a career, and the settings that come with it. Step 9 of ETS2 support (#266, #275).
///
/// <para>The game is fixed for a career: chosen on the application before the first hire, or when a new
/// career is started, and never changed after. Everything else in the app reads it through
/// <see cref="GameProfile"/>, so the choice is one field — but the settings a new career starts with are
/// facts about one game's install (fuel per gallon at ATS prices, a 65 mph governor, the US states you run),
/// and carrying them into the other game would start an ETS2 career on American assumptions. So a career
/// that changes game starts from that game's defaults, keeping only what is about the player rather than
/// the game: the AI key and how screenshots are read.</para>
/// </summary>
public static class GameSetup
{
    /// <summary>The games a career can be: the profile ids.</summary>
    public static readonly string[] Games = { GameProfile.Ats.Id, GameProfile.Ets2.Id };

    /// <summary>A game id as typed — "ets2", "Euro Truck Simulator 2" — to the profile's, or null.</summary>
    public static string? Normalise(string? game)
    {
        var g = (game ?? "").Trim();
        if (g.Length == 0) return null;
        if (g.Equals(GameProfile.Ets2.Id, StringComparison.OrdinalIgnoreCase)
            || g.Contains("euro", StringComparison.OrdinalIgnoreCase)) return GameProfile.Ets2.Id;
        if (g.Equals(GameProfile.Ats.Id, StringComparison.OrdinalIgnoreCase)
            || g.Contains("american", StringComparison.OrdinalIgnoreCase)) return GameProfile.Ats.Id;
        return null;
    }

    /// <summary>
    /// Puts a career on a game, with that game's default settings. Only for a career with no hire yet —
    /// the caller checks — because everything after the hire was built for one game.
    /// </summary>
    public static void Choose(AppState s, string game)
    {
        var id = Normalise(game) ?? throw new InvalidOperationException("Which game: ATS or ETS2?");
        var same = string.Equals(s.Game, id, StringComparison.OrdinalIgnoreCase);
        s.Game = id;
        // Activated before the defaults are built, so the ones that read the profile read this game's.
        GameProfile.Activate(s);
        Units.Activate(s);
        if (!same) s.Settings = DefaultsFor(s, s.Settings);
    }

    /// <summary>
    /// A fresh set of settings for the career's game, keeping from <paramref name="keep"/> only what is
    /// about the player, not the game.
    /// </summary>
    public static AppSettings DefaultsFor(AppState s, AppSettings? keep)
    {
        var fresh = new AppSettings();
        if (keep != null)
        {
            fresh.AnthropicApiKey = keep.AnthropicApiKey;
            fresh.AnthropicModel = keep.AnthropicModel;
            fresh.AiEnabled = keep.AiEnabled;
        }
        fresh.RunnableStates = MapCoverage.DefaultSelection();
        if (GameProfile.For(s).Id == GameProfile.Ets2.Id)
        {
            // Diesel at the game's European price, the EU's 90 km/h limiter, and no US medical premium —
            // European health cover is part of the social contributions in the flat deduction.
            fresh.FuelPricePerGal = GameProfile.Ets2.DefaultFuelPrice;
            fresh.GovernedMph = 56;
            fresh.HealthPremiumPerPeriod = 0;
            fresh.TimeZonesOn = false;
            fresh.CarrierRoster = "Real";
        }
        return fresh;
    }
}
