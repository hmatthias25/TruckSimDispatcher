using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// What it actually costs this company to turn a wheel, and therefore the lowest rate a load can
/// pay before it loses money.
///
/// The app used to ship fixed real-world benchmarks ($2.10 target, $1.35 floor). Those are US
/// truckload rates measured over real miles, and ATS runs a scaled map — so on a short in-game haul
/// a real-world fixed overhead per load dominates everything and the thresholds stop meaning
/// anything. Deriving them from the operator's own numbers makes them honest for any economy mod,
/// fuel price, truck or pay scale.
/// </summary>
public static class CostModel
{
    /// <summary>
    /// Break-even revenue per mile for a load of the given length.
    ///
    ///   revenue = fuel + driver pay + fixed overhead + maintenance sweep(revenue)
    ///   r·M     = (price/mpg)·M + cpm·M + OH + mr·r·M
    ///   r       = [ (price/mpg + cpm) + OH/M ] / (1 - mr)
    ///
    /// Overhead is divided by the load's miles, which is exactly why a fixed per-load charge is
    /// punishing on short freight and why it is surfaced separately below.
    /// </summary>
    public static BreakEven Compute(AppState s, double loadedMiles, Truck? truck = null)
    {
        truck ??= DispatchEngine.AssignedTruck(s);
        var cfg = s.Settings;
        var miles = loadedMiles > 1 ? loadedMiles : AverageLoadedMiles(s);

        var mpg = truck?.AvgMpg > 0 ? truck.AvgMpg : 6.5;
        var fuelPerMile = mpg > 0 ? (double)cfg.FuelPricePerGal / mpg : 0;

        var payMult = Math.Clamp(cfg.PayMileMultiplier, 0.1, 20.0);
        var driverPerMile = (double)s.Driver.Pay.LoadedCpm * payMult;

        var overheadPerMile = miles > 0 ? (double)cfg.OverheadPerLoad / miles : 0;
        var reserveShare = Math.Clamp(cfg.MaintenanceReservePct, 0, 0.5);

        var variable = fuelPerMile + driverPerMile;
        var breakEven = (variable + overheadPerMile) / Math.Max(0.05, 1 - reserveShare);

        return new BreakEven
        {
            LoadedMiles = Math.Round(miles, 0),
            FuelPerMile = Math.Round(fuelPerMile, 4),
            DriverPayPerMile = Math.Round(driverPerMile, 4),
            OverheadPerMile = Math.Round(overheadPerMile, 4),
            MaintenanceShare = reserveShare,
            BreakEvenRpm = Math.Round((decimal)breakEven, 3),
            // The rate that also clears the margin the company wants on top of cost.
            TargetRpm = Math.Round((decimal)(breakEven * Math.Max(1.0, s.Settings.MarginGoal)), 3),
            OverheadDominates = variable > 0 && overheadPerMile > variable * 0.5
        };
    }

    /// <summary>
    /// Typical loaded miles for this operation, used when no specific load is in hand. Prefers real
    /// delivered history over a guess.
    /// </summary>
    public static double AverageLoadedMiles(AppState s)
    {
        var delivered = s.Trips
            .Where(t => t.Kind == "Freight" && t.Status == "Delivered")
            .Select(t => t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles)
            .Where(m => m > 0).ToList();
        if (delivered.Count >= 3) return delivered.Average();

        var board = s.Board.Where(b => b.LoadedMiles > 0).Select(b => b.LoadedMiles).ToList();
        if (board.Count > 0) return board.Average();

        return 300;
    }

    /// <summary>
    /// The floor and target dispatch should actually judge freight against. Honours a manual
    /// override so anyone who prefers fixed thresholds can still set them.
    /// </summary>
    public static (decimal Floor, decimal Target, BreakEven Detail) Thresholds(AppState s, double loadedMiles)
    {
        var detail = Compute(s, loadedMiles);
        if (s.Settings.Scoring.UseManualThresholds)
            return (s.Settings.Scoring.FloorAllInRpm, s.Settings.Scoring.TargetAllInRpm, detail);

        // The floor is break-even: below it the load is genuinely unprofitable.
        return (detail.BreakEvenRpm, detail.TargetRpm, detail);
    }

    /// <summary>
    /// Reads what the market is actually paying against what the company needs, and says plainly
    /// whether the settings are survivable. Uses the current board plus delivered history so it
    /// works both before and after the driver has run freight.
    /// </summary>
    public static Calibration Calibrate(AppState s)
    {
        var c = new Calibration();

        var samples = new List<(double Miles, decimal Revenue)>();
        foreach (var b in s.Board.Where(b => b.LoadedMiles > 0 && b.GameRevenue > 0))
            samples.Add((b.LoadedMiles + b.DeadheadMiles, b.GameRevenue));
        foreach (var t in s.Trips.Where(t => t.Kind == "Freight" && t.GameRevenue > 0))
        {
            var m = (t.ActualMiles > 0 ? t.ActualMiles : t.DispatchedMiles) + t.DeadheadMiles;
            if (m > 0) samples.Add((m, t.GameRevenue));
        }

        c.SampleCount = samples.Count;
        if (samples.Count == 0)
        {
            c.Verdict = "No data yet";
            c.Summary = "Enter a freight board or deliver a load, then run this again — it needs to see " +
                        "what your economy actually pays before it can tell you anything.";
            return c;
        }

        var rpms = samples.Select(x => (double)(x.Revenue / (decimal)x.Miles)).OrderBy(x => x).ToList();
        c.MedianRpm = Math.Round((decimal)Median(rpms), 3);
        c.LowRpm = Math.Round((decimal)rpms.First(), 3);
        c.HighRpm = Math.Round((decimal)rpms.Last(), 3);
        c.MedianLoadedMiles = Math.Round(samples.Average(x => x.Miles), 0);

        var be = Compute(s, c.MedianLoadedMiles);
        c.BreakEven = be;
        c.SuggestedFloor = be.BreakEvenRpm;
        c.SuggestedTarget = be.TargetRpm;

        var headroom = c.MedianRpm - be.BreakEvenRpm;
        c.HeadroomPerMile = Math.Round(headroom, 3);
        c.ProfitableShare = Math.Round(
            rpms.Count(x => (decimal)x >= be.BreakEvenRpm) * 100.0 / rpms.Count, 0);

        if (c.ProfitableShare >= 70)
        {
            c.Verdict = "Healthy";
            c.Summary = $"Your market pays a median ${c.MedianRpm:0.00}/mi against a ${be.BreakEvenRpm:0.00} " +
                        $"break-even — {c.ProfitableShare:0}% of the freight you have shown me covers its costs. " +
                        "These settings are survivable.";
        }
        else if (c.ProfitableShare >= 35)
        {
            c.Verdict = "Marginal";
            c.Summary = $"Median ${c.MedianRpm:0.00}/mi against a ${be.BreakEvenRpm:0.00} break-even — only " +
                        $"{c.ProfitableShare:0}% of this freight pays for itself. Workable, but you will be " +
                        "turning a lot of loads down.";
        }
        else
        {
            c.Verdict = "Unsustainable";
            c.Summary = $"Median ${c.MedianRpm:0.00}/mi against a ${be.BreakEvenRpm:0.00} break-even — only " +
                        $"{c.ProfitableShare:0}% of this freight covers its costs. Something in the cost model " +
                        "is wrong for your game, not the freight.";
        }

        // Concrete, ranked advice. Overhead first, because it is the usual culprit on a scaled map.
        if (be.OverheadDominates)
            c.Recommendations.Add(
                $"Overhead is ${be.OverheadPerMile:0.000}/mi of a ${be.BreakEvenRpm:0.00} break-even — more than half " +
                $"your per-mile cost, purely because ${s.Settings.OverheadPerLoad:0} is spread over " +
                $"{be.LoadedMiles:N0} scaled miles. Drop overhead per load to about " +
                $"${Math.Max(5, Math.Round((double)s.Settings.OverheadPerLoad * 0.25 / 5) * 5):0} — that is the single " +
                "biggest lever on short ATS freight.");

        if (c.ProfitableShare < 70)
        {
            var fuelNeeded = be.FuelPerMile > 0 ? (double)c.MedianRpm * 0.35 : 0;
            if (be.FuelPerMile > fuelNeeded && fuelNeeded > 0)
                c.Recommendations.Add(
                    $"Fuel is ${be.FuelPerMile:0.000}/mi at ${s.Settings.FuelPricePerGal:0.00}/gal and " +
                    $"{(DispatchEngine.AssignedTruck(s)?.AvgMpg ?? 6.5):0.0} mpg. Set the fuel price to what your game " +
                    "actually charges at the pump, and check the truck's mpg on the Equipment tab.");

            if (be.DriverPayPerMile > (double)c.MedianRpm * 0.45)
                c.Recommendations.Add(
                    $"Your own pay is ${be.DriverPayPerMile:0.000}/mi against a ${c.MedianRpm:0.00} market rate. " +
                    "That is a large share of revenue — expected on a scaled map. Lower the pay-mile multiplier " +
                    "in Settings if you would rather the company stayed solvent than see big settlements.");
        }

        if (s.Settings.RevenueFactor < 0.999)
            c.Recommendations.Add(
                $"Revenue factor is ×{s.Settings.RevenueFactor:0.##}, so the company books less than ATS pays. " +
                "If you run an economy mod, that discount is being applied twice — set it to 1.00.");

        if (c.Recommendations.Count == 0)
            c.Recommendations.Add("Nothing to change — the cost model matches what your market pays.");

        return c;
    }

    private static double Median(List<double> sorted) =>
        sorted.Count == 0 ? 0
        : sorted.Count % 2 == 1 ? sorted[sorted.Count / 2]
        : (sorted[sorted.Count / 2 - 1] + sorted[sorted.Count / 2]) / 2;
}

public class BreakEven
{
    public double LoadedMiles { get; set; }
    public double FuelPerMile { get; set; }
    public double DriverPayPerMile { get; set; }
    public double OverheadPerMile { get; set; }
    public double MaintenanceShare { get; set; }
    public decimal BreakEvenRpm { get; set; }
    public decimal TargetRpm { get; set; }
    /// <summary>True when fixed per-load overhead is swamping the real per-mile costs.</summary>
    public bool OverheadDominates { get; set; }
}

public class Calibration
{
    public string Verdict { get; set; } = "";
    public string Summary { get; set; } = "";
    public int SampleCount { get; set; }
    public decimal MedianRpm { get; set; }
    public decimal LowRpm { get; set; }
    public decimal HighRpm { get; set; }
    public double MedianLoadedMiles { get; set; }
    public decimal HeadroomPerMile { get; set; }
    public double ProfitableShare { get; set; }
    public decimal SuggestedFloor { get; set; }
    public decimal SuggestedTarget { get; set; }
    public BreakEven BreakEven { get; set; } = new();
    public List<string> Recommendations { get; set; } = new();
}
