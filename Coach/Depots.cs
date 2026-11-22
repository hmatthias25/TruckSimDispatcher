using TruckSimDispatcher.Services;

namespace TruckSimCoach;

/// <summary>
/// The company's depots. A coach operator runs from many bases, more than a haulier's yards. Each one is known from the
/// day the driver joins, but it only becomes a depot the driver can use once they have been there and bought the large
/// garage in the game: then a duty can start and end there, and a night there is in the depot's rest room rather than
/// a hotel. The home depot is where the driver lives; a transfer moves it to another opened depot.
/// </summary>
public static class Depots
{
    /// <summary>The driver is in a city: note it, and say so where it is one of the company's depots reached for the first time.</summary>
    public static string? Arrive(CoachCareer c, string city, string cc)
    {
        var key = Companies.Key(city, cc);
        if (!c.Visited.Any(v => Companies.Same(v, key))) c.Visited.Add(key);
        var depot = c.Depots.FirstOrDefault(d => Companies.SamePlace(d.City, d.Cc, city, cc));
        if (depot == null || depot.Reached) return null;
        depot.Reached = true;
        var said = $"{city} is one of {Companies.Of(c).Name(c)}'s depots. Buy the large garage here in the game, then open the depot on the Career tab.";
        CoachStore.Log(c, "depot", said);
        return said;
    }

    public static string Open(CoachCareer c, string city, string cc)
    {
        var d = c.Depots.FirstOrDefault(x => Companies.SamePlace(x.City, x.Cc, city, cc))
                ?? throw new InvalidOperationException($"{city} is not one of the company's depots.");
        if (!d.Reached) throw new InvalidOperationException($"You have not been to {city} yet. Get there first, then buy the garage.");
        if (d.Opened) return $"{city} is open already.";
        d.Opened = true;
        d.OpenedGameTime = c.GameTime;
        CoachStore.Log(c, "depot", $"{city} depot opened: the large garage is bought in the game.");
        return $"The {city} depot is open: duties can start and end there, and a night there is in the rest room.";
    }

    public static string Transfer(CoachCareer c, string city, string cc)
    {
        var d = c.Depots.FirstOrDefault(x => Companies.SamePlace(x.City, x.Cc, city, cc))
                ?? throw new InvalidOperationException($"{city} is not one of the company's depots.");
        if (!d.Opened) throw new InvalidOperationException($"The {city} depot is not open yet: get there and buy the garage first.");
        if (Companies.SamePlace(c.Job.HomeCity, c.Job.HomeCc, city, cc)) return $"{city} is your home depot already.";
        c.Job.HomeCity = city;
        c.Job.HomeCc = cc;
        CoachStore.Log(c, "depot", $"Transferred to the {city} depot: it is home now.");
        return $"Transferred: {city} is your home depot. Duties are planned to bring you back here.";
    }

    public static bool IsHome(CoachCareer c, string city, string cc) => Companies.SamePlace(c.Job.HomeCity, c.Job.HomeCc, city, cc);

    public static object View(CoachCareer c) => c.Depots.Select(d => new
    {
        city = d.City, cc = d.Cc, place = Lines.Place(d.City, d.Cc), reached = d.Reached, opened = d.Opened,
        home = IsHome(c, d.City, d.Cc), here = Companies.SamePlace(d.City, d.Cc, c.City, c.Cc),
        km = Companies.SamePlace(d.City, d.Cc, c.City, c.Cc) ? 0 : Lines.Km(c.City, c.Cc, d.City, d.Cc),
    });
}
