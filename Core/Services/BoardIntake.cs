using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// A listing going onto the board: normalised, dated, its window read, and refused under the expiry floor.
/// Moved out of the company-driver app's Program.cs so the owner/operator app takes a board in the same way.
/// </summary>
public static class BoardIntake
{
    /// <summary>
    /// Whether a row flagged as offered at the driver's location really is: it starts in the town the truck is in,
    /// and the shipper it names is the place the truck is parked at. A row that names no shipper, or a position with
    /// no place on it, is taken at its word.
    /// </summary>
    public static bool AtThisDock(AppState s, BoardLoad l)
    {
        if (!string.Equals(l.OriginCity.Trim(), (s.Status.LocationCity ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
            return false;
        return !PickupLearning.NamedElsewhere(s, l);
    }

    /// <summary>One listing onto the board, normalised — without evaluating. Throws when it is under the expiry floor.</summary>
    public static void Add(AppState s, BoardLoad l)
    {
        if (string.IsNullOrWhiteSpace(l.Id)) l.Id = Guid.NewGuid().ToString("N")[..8];
        if (string.IsNullOrWhiteSpace(l.OriginCity)) { l.OriginCity = s.Status.LocationCity; l.OriginState = s.Status.LocationState; }
        l.OriginState = Ets2Data.RegionFor(s, l.OriginCity, l.OriginState);
        l.DestState = Ets2Data.RegionFor(s, l.DestCity, l.DestState);
        // "At this dock" only when it is this dock. The flag came from the tab the rows were entered on, and the tab
        // goes to the local board on its own at a customer — so a city board pasted while parked at a receiver came in
        // as freight under the truck. Reported from play: parked at Amazon in Phoenix, a FedEx load across town booked
        // as no pickup at all, and the forty-five minutes to get there cost a whole extra rest and the window.
        if (l.AtLocation && !AtThisDock(s, l)) l.AtLocation = false;
        // Fill a blank trailer type from what is hooked — except the arrangement, which is not a trailer.
        //
        // Drop and hook is modelled as a trailer type, and this is where that leaks: a listing entered
        // without a type was stamped "Drop & Hook", which then became its DIVISION, which no carrier
        // operates, so every load on the board hard-failed with "Drop & Hook is not a division this company
        // operates". Reported from play out of Odessa with two perfectly good listings refused.
        //
        // On the arrangement the freight decides the type and the listing may not say, so blank stays blank.
        // Everything downstream already handles that: DivisionFor reads the listing rather than the
        // arrangement, and the fit check does not gate on it at all.
        var hooked = DispatchEngine.AssignedTrailer(s)?.Type ?? "";
        if (string.IsNullOrWhiteSpace(l.TrailerType) && !DropHook.Is(hooked)) l.TrailerType = hooked;
        if (DropHook.Is(l.TrailerType)) l.TrailerType = "";

        // How long the listing itself has left. Anchored to the game clock here rather than trusted as a
        // frozen number, so it runs down as the driver reports time — see BoardExpiry.
        if (l.ExpiresInHours > 0 && string.IsNullOrWhiteSpace(l.ListedAtGameTime))
            l.ListedAtGameTime = s.Status.GameTime ?? "";

        // Under the floor it does not go on the board at all. Refused rather than added and then rejected:
        // a row the driver can see and cannot have is an invitation to argue with dispatch about it, and the
        // whole point is that this one is not a judgement call.
        if (BoardExpiry.TooTight(s, l) is { } tooTight)
            throw new InvalidOperationException(tooTight);

        // A window typed straight off the listing beats two figures the driver had to work out. Parsed here,
        // against the app's own game clock, which is the only place that knows what "tomorrow" means.
        if (!string.IsNullOrWhiteSpace(l.WindowText)
            && DeliveryWindow.Read(s, l.WindowText, l.DestState) is { } win)
        {
            // A clock range has no day in it, so it resolves to the soonest future occurrence — tonight.
            // Where the driver also typed the listing's time-to-deliver, that countdown says which day was
            // meant, and the window moves to match rather than replacing a correct deadline with a wrong one.
            win = DeliveryWindow.RollToDeadline(win, l.DeadlineHours);

            l.DeadlineHours = Math.Round(win.HoursUntilDue, 2);
            if (win.OpensAt != null) l.AppointmentOpensHours = win.HoursUntilOpens;
        }

        // The same job entered twice is a real hazard rather than a theoretical one: the dock board is not
        // cleared when the driver moves to the city board, so anything ATS lists in both places can go on
        // twice. Flagged rather than refused — two genuinely similar loads out of one shipper is ordinary,
        // and the driver is the one looking at the screen.
        l.LooksDuplicated = s.Board.Any(b =>
            b.Cargo.Equals(l.Cargo ?? "", StringComparison.OrdinalIgnoreCase)
            && b.DestCity.Equals(l.DestCity ?? "", StringComparison.OrdinalIgnoreCase)
            && b.DestState.Equals(l.DestState ?? "", StringComparison.OrdinalIgnoreCase)
            && b.OriginCity.Equals(l.OriginCity ?? "", StringComparison.OrdinalIgnoreCase)
            && Math.Abs(b.LoadedMiles - l.LoadedMiles) < 1
            && Math.Abs(b.GameRevenue - l.GameRevenue) < 1);

        s.Board.Add(l);
    }
}
