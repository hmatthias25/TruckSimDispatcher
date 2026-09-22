using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// How the company is actually doing, and what it does about it.
///
/// <para>This is what the books are FOR, now that they have stopped pretending to be the ATS bank. A
/// ledger that had to tie out to a number the app could not see was never free to say anything
/// interesting; one that is the company's own profit and loss can say the only thing that matters — is
/// this carrier making money, and what is it going to do about the answer.</para>
///
/// <para>Judged on <b>net contribution across recent fleet reports</b>: revenue in, wages and repairs out.
/// Every figure behind it came off the player's own reports, so nothing here is invented. What IS invented
/// is the company's reaction to it, and that is the point — a carrier that never expands when it is doing
/// well and never retrenches when it is not is a backdrop, not an employer.</para>
///
/// <para><b>The player is still a driver.</b> None of this is theirs to decide. The company decides, the
/// report says what it decided, and the driver finds out the way a driver would: a yard closing, a
/// colleague let go, a better tractor turning up.</para>
/// </summary>
public static class CompanyHealth
{
    /// <summary>How many reports back the verdict looks. A fortnight each, so this is a quarter or so.</summary>
    public const int Window = 6;

    /// <summary>Net per report above which the company is genuinely making money.</summary>
    public const decimal ThrivingPerReport = 12_000m;

    /// <summary>And below which it is losing it.</summary>
    public const decimal StrugglingPerReport = 0m;

    public class Verdict
    {
        /// <summary>Thriving | Steady | Tight | Struggling</summary>
        public string Band { get; set; } = "Steady";
        public string Headline { get; set; } = "";
        public List<string> Evidence { get; set; } = new();

        public decimal NetOverWindow { get; set; }
        public decimal NetPerReport { get; set; }
        public int ReportsCounted { get; set; }
        public bool Improving { get; set; }

        /// <summary>What the company is doing about it, in the driver's words.</summary>
        public List<string> Actions { get; set; } = new();
    }

    /// <summary>
    /// Read the company's condition off its own reports.
    ///
    /// Needs at least two to say anything: one report is a fortnight, and a fortnight is weather rather
    /// than climate. Below that the company has an opinion about nothing and says so.
    /// </summary>
    public static Verdict Assess(AppState s, FleetReport? latest = null)
    {
        var reports = s.FleetReports
            .OrderByDescending(r => r.PeriodEndGame)
            .Take(Window)
            .ToList();

        if (latest != null && reports.All(r => r.Number != latest.Number))
            reports.Insert(0, latest);

        var v = new Verdict { ReportsCounted = reports.Count };

        if (reports.Count < 2)
        {
            v.Band = "Steady";
            v.Headline = "Too early to say how the company is doing.";
            v.Evidence.Add("One report is a fortnight, and a fortnight is weather rather than climate. " +
                           "Ask again next time.");
            return v;
        }

        v.NetOverWindow = Math.Round(reports.Sum(r => r.NetContribution), 2);
        v.NetPerReport = Math.Round(v.NetOverWindow / reports.Count, 2);

        // Is it heading the right way? The recent half against the older half, which is a coarse read and
        // deliberately so — a trend off six fortnights is as much precision as the data carries.
        var half = reports.Count / 2;
        if (half > 0)
        {
            var recent = reports.Take(half).Average(r => r.NetContribution);
            var older = reports.Skip(reports.Count - half).Average(r => r.NetContribution);
            v.Improving = recent > older;
        }

        v.Band = v.NetPerReport >= ThrivingPerReport ? "Thriving"
               : v.NetPerReport < StrugglingPerReport ? "Struggling"
               : v.NetPerReport < ThrivingPerReport / 3 ? "Tight"
               : "Steady";

        var per = $"${v.NetPerReport:N0} a report across {reports.Count}";
        v.Headline = v.Band switch
        {
            "Thriving" => $"The company is making money — {per}.",
            "Steady" => $"The company is holding its own — {per}.",
            "Tight" => $"The company is running thin — {per}.",
            _ => $"The company is losing money — {per}.",
        };

        v.Evidence.Add($"Net {(v.NetOverWindow < 0 ? "-" : "")}${Math.Abs(v.NetOverWindow):N0} over the " +
                       $"last {reports.Count} report(s), after wages and repairs.");
        v.Evidence.Add(v.Improving
            ? "And the trend is upward — the recent reports are better than the older ones."
            : "The trend is flat or downward on the recent reports.");

        return v;
    }

    /// <summary>
    /// What the company does about it, decided once per report and said out loud.
    ///
    /// Seeded on the report so a reload cannot re-roll a yard closing. Deliberately occasional at both
    /// ends: a carrier that buys a garage every fortnight is not prospering, it is a spending spree, and
    /// one that sells a yard every fortnight has nothing left by the spring.
    /// </summary>
    /// <summary>
    /// What calibre of driver this company can attract, by how it is doing.
    ///
    /// A carrier scraping along hires rookies because rookies are who will come; one that is making money
    /// can pay for somebody who has done it before. Naming the level matters because ATS shows it in the
    /// hiring screen — an instruction the player can actually follow.
    /// </summary>
    public static (int Min, int Max, string How) HiringBandFor(string band) => band switch
    {
        "Thriving" => (6, 9, "somebody who has done it before — the company can pay for it now"),
        "Steady" => (3, 6, "a middling hand; nothing fancy, but not green either"),
        "Tight" => (1, 3, "a rookie. It is what the company can afford, and they will learn on our freight"),
        _ => (1, 2, "the cheapest hand who will take it — this is not the week for a wage negotiation"),
    };

    /// <summary>
    /// Seats standing empty. A tractor with nobody in it earns nothing and still costs to keep.
    ///
    /// Asked here rather than left on the Fleet tab, because the company noticing its own idle equipment
    /// is the whole point of a fortnightly report.
    /// </summary>
    private static void AskForDrivers(AppState s, FleetReport report, Verdict v)
    {
        var empty = s.Trucks
            .Where(t => !t.Retired && t.Status == "InService" && t.InGameGarage)
            .Where(t => !t.Unit.Equals(s.Driver.AssignedTruckUnit, StringComparison.OrdinalIgnoreCase))
            .Where(t => string.IsNullOrWhiteSpace(t.AssignedDriver))
            .Where(t => !s.HiredDrivers.Any(h => h.Status == "Active"
                && h.AssignedTruckUnit.Equals(t.Unit, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (empty.Count == 0) return;

        var (min, max, how) = HiringBandFor(v.Band);
        var units = string.Join(", ", empty.Take(3).Select(t => t.Ref));
        var more = empty.Count > 3 ? $" and {empty.Count - 3} more" : "";

        v.Actions.Add($"{empty.Count} tractor(s) standing with nobody in them — {units}{more}. Hire in ATS " +
                      $"and look for <b>level {min}–{max}</b>: {how}. Add them on the Fleet tab once you " +
                      "have, and they go on the next report.");
        report.Findings.Add($"{empty.Count} seat(s) empty — hire at level {min}–{max}.");
    }

    public static void Act(AppState s, FleetReport report, Verdict v)
    {
        // Empty seats are worth saying whatever the figures look like — a tractor nobody is in earns
        // nothing and still costs to keep, and that is as true in a bad quarter as a good one. What the
        // company's fortunes change is who it can attract, not whether it needs somebody.
        AskForDrivers(s, report, v);

        if (v.ReportsCounted < 2) return;

        var roll = Hash($"{report.Number}|health-act") % 100;

        if (v.Band == "Thriving" && roll < 30) Expand(s, report, v);
        else if (v.Band == "Struggling" && roll < 45) Retrench(s, report, v);
        else if (v.Band == "Tight" && roll < 20)
            v.Actions.Add("Operations is holding off on anything new until the figures come back. No new " +
                          "equipment this period.");
    }

    /// <summary>
    /// Doing well: another yard on the map, or better equipment.
    ///
    /// A yard only ever in a city ATS actually has — the base map and the official DLC. The app has no
    /// business naming a town that only exists because somebody installed a mod, and it cannot know which
    /// mods are installed.
    /// </summary>
    private static void Expand(AppState s, FleetReport report, Verdict v)
    {
        // Growing a yard it already has is the cheaper, likelier move — and the only one available once
        // there is a terminal everywhere worth having one. Small holds one tractor, Medium three, Large
        // five, so an upgrade is what lets a yard take on people at all.
        var cramped = s.Company.Terminals
            .Where(t => t.Level != "Large")
            .Select(t => new
            {
                Yard = t,
                Trucks = s.Trucks.Count(x => !x.Retired && x.HomeTerminalId == t.Id),
            })
            .Where(x => x.Trucks >= x.Yard.TruckCapacity)      // actually full, not merely small
            .OrderByDescending(x => x.Trucks)
            .ToList();

        if (cramped.Count > 0 && Hash($"{report.Number}|grow-or-open") % 100 < 60)
        {
            var grow = cramped[0].Yard;
            var was = grow.Level;
            var to = was == "Small" ? "Medium" : "Large";
            var where = DispatchEngine.Place(grow.City, grow.State);

            // Asked for, not done. This used to call ApplyLevel straight away and tell the player to buy
            // the garage upgrade when they were next through — so the company got the bigger yard for
            // nothing, and none of its own figures ever saw a cost. It is the player who spends the money
            // in ATS and only they know what it came to, so the tier moves when they say it has.
            if (Yards.Raise(s, report, new YardRequest
                {
                    Kind = "Upgrade",
                    City = grow.City,
                    State = grow.State,
                    TerminalId = grow.Id,
                    FromLevel = was,
                    Level = to,
                    Reason = $"{where} is full — every slot it has is taken.",
                }) != null)
            {
                v.Actions.Add($"The company wants {where} taken from a {was.ToLowerInvariant()} yard to a " +
                              $"{to.ToLowerInvariant()} one. Buy the garage upgrade in ATS and tell me what " +
                              "it cost, and I will move it on the books.");
                report.Findings.Add($"Upgrade wanted at {where} — {was.ToLowerInvariant()} to {to.ToLowerInvariant()}.");
            }
            return;
        }

        // Official only — the base map and the SCS DLC. C2C and More American Cities are mods, and the
        // app cannot know which of them a player has installed. Sending somebody to buy a garage in a
        // town that does not exist in their game is worse than not expanding at all.
        //
        // And only where ATS actually sells a yard, which HasGarage already records.
        var candidates = Markets.BuiltIn
            .Where(c => c.Source.Equals("Official", StringComparison.OrdinalIgnoreCase) && c.HasGarage)
            .Where(c => !s.Company.Terminals.Any(t =>
                t.City.Equals(c.City, StringComparison.OrdinalIgnoreCase)
                && t.State.Equals(c.State, StringComparison.OrdinalIgnoreCase)))
            // A yard is worth having where the freight is.
            .Where(c => c.Tier <= 2)
            // And somewhere the truck has actually been.
            //
            // Everywhere else in the app a garage is discovery-gated, because ATS generates no cargo for
            // a city that was revealed rather than driven to — a yard there is a yard with nothing coming
            // out of it. This one place was not, so the company could ask for a garage in a city the
            // player had never seen and could not sensibly go and buy. Reported from play on Bellingham,
            // which is also the city named in the note below about the previous fault here.
            .Where(c => DiscoveryService.IsDiscovered(s, c.City, c.State))
            .ToList();

        if (candidates.Count == 0)
        {
            // Two different reasons, and telling the player the wrong one sends them looking in the wrong
            // place. "We already have one everywhere" is only true if there is nowhere left they have been.
            var anywhereLeft = Markets.BuiltIn.Any(c =>
                c.Source.Equals("Official", StringComparison.OrdinalIgnoreCase) && c.HasGarage && c.Tier <= 2
                && !s.Company.Terminals.Any(t => t.City.Equals(c.City, StringComparison.OrdinalIgnoreCase)
                                                 && t.State.Equals(c.State, StringComparison.OrdinalIgnoreCase)));
            v.Actions.Add(anywhereLeft
                ? "The company would open another yard on these figures, but every city we could use is " +
                  "one you have not driven to yet. A garage somewhere you have not been sees no freight — " +
                  "ATS only generates cargo for cities you have actually reached. Get out there and this " +
                  "comes back on its own."
                : "The company would open another yard on these figures, but it already has one " +
                  "everywhere it runs.");
            return;
        }

        var pick = candidates[(int)(Hash($"{report.Number}|yard") % (uint)candidates.Count)];
        var label = DispatchEngine.Place(pick.City, pick.State);

        // Asked for, not opened. The terminal used to be added here and the player told to buy the garage
        // when they were next through, so a yard landed on the company's property having cost it nothing
        // — and since no figure the company judges itself by could see a yard, it would do it again next
        // period, and again. Reported from play: "the app said it got a small garage in Bellingham, and I
        // don't see any reference to the company spending money on it."
        if (Yards.Raise(s, report, new YardRequest
            {
                Kind = "Open",
                City = pick.City,
                State = pick.State,
                Level = "Small",
                Reason = $"The figures carry another yard, and {label} is where the freight is.",
            }) == null) return;

        v.Actions.Add($"The company wants a yard at {label}. Buy the garage in ATS when you are next " +
                      "through and tell me what it cost — it goes on the books when you do, and freight " +
                      "will start routing that way once something is based there.");
        report.Findings.Add($"Yard wanted at {label} — the figures carry it.");
    }

    /// <summary>
    /// Doing badly: something has to go. Never headquarters, and never quietly.
    ///
    /// A yard closing takes its people and its equipment with it, which is the whole weight of the thing —
    /// a carrier in trouble is not an abstraction to the drivers based there.
    /// </summary>
    private static void Retrench(AppState s, FleetReport report, Verdict v)
    {
        // Thinning a yard comes before shutting one. A carrier in trouble lays people off; it does not
        // close a terminal the first bad quarter, and it never closes the one everything runs out of.
        // Reported as the shape wanted: three drivers at a garage down to one, rather than the lot.
        var overstaffed = s.Company.Terminals
            .Select(t => new
            {
                Yard = t,
                Crew = s.HiredDrivers.Where(d => d.Status == "Active" && d.HomeTerminalId == t.Id).ToList(),
            })
            .Where(x => x.Crew.Count >= 2)
            .OrderByDescending(x => x.Crew.Count)
            .ToList();

        if (overstaffed.Count > 0 && Hash($"{report.Number}|thin-or-shut") % 100 < 65)
        {
            var at = overstaffed[0];
            var label2 = DispatchEngine.Place(at.Yard.City, at.Yard.State);

            // Last in, first out, and the weakest earner of those — which is the order a real carrier
            // would use and the one the driver can see the sense of.
            var going = at.Crew
                .OrderBy(d => d.Level)
                .ThenBy(d => d.Level)
                .Take(at.Crew.Count - 1)
                .Take(Math.Max(1, at.Crew.Count / 2))
                .ToList();

            foreach (var d in going)
            {
                FleetOpsService.Separate(s, d, "Terminated", $"Laid off — {label2} cut back.");
                report.Findings.Add($"{d.Name} laid off at {label2}.");
            }

            v.Actions.Add($"The company is cutting back at {label2} — {going.Count} driver(s) let go, " +
                          $"{at.Crew.Count - going.Count} left there. Their tractors stay on the books; " +
                          "sell or park them in ATS as you see fit.");
            return;
        }

        // The weakest outpost: not HQ, and the one with least working there.
        var closable = s.Company.Terminals
            .Where(t => !t.IsHeadquarters)
            .Select(t => new
            {
                Yard = t,
                Drivers = s.HiredDrivers.Count(d => d.Status == "Active" && d.HomeTerminalId == t.Id),
                Boxes = s.Trailers.Count(x => !x.Retired && x.HomeTerminalId == t.Id),
            })
            .OrderBy(x => x.Drivers)
            .ThenBy(x => x.Boxes)
            .ToList();

        if (closable.Count == 0)
        {
            // Nothing to close. Then it is equipment, and the idle boxes go first — the trailer section
            // has already named them.
            var idle = s.Trailers.FirstOrDefault(t => !t.Retired && !DropHook.Is(t.Type)
                                                      && t.UtilisationPct >= 0
                                                      && t.UtilisationPct < TrailerHealth.IdleUtilisationPct
                                                      && !t.Unit.Equals(s.Driver.AssignedTrailerUnit,
                                                                        StringComparison.OrdinalIgnoreCase));
            if (idle != null)
            {
                idle.Retired = true;
                idle.Status = "Retired";
                v.Actions.Add($"Money is tight and {idle.Ref} was not earning, so the company has sold it. " +
                              "Sell it in ATS too and keep the money — it is the company's, and the books " +
                              "already say so.");
                report.Findings.Add($"{idle.Ref} sold — idle equipment against a losing quarter.");
            }
            else
            {
                v.Actions.Add("The figures are bad and there is nothing obvious left to cut. Operations is " +
                              "looking at the freight mix rather than the fleet.");
            }
            return;
        }

        var shut = closable[0];
        var label = DispatchEngine.Place(shut.Yard.City, shut.Yard.State);

        // Through Separate, so the seat is freed properly and the tractor does not stay showing a driver
        // who no longer works here.
        foreach (var d in s.HiredDrivers
                     .Where(d => d.Status == "Active" && d.HomeTerminalId == shut.Yard.Id)
                     .ToList())
        {
            FleetOpsService.Separate(s, d, "Terminated", $"{label} closed.");
            report.Findings.Add($"{d.Name} let go — {label} is closing.");
        }

        // The equipment moves rather than evaporating. It is the company's and it is still worth money.
        var home = HomeTime.HomeTerminal(s) ?? s.Company.Terminals.FirstOrDefault(t => t.IsHeadquarters);
        var moved = 0;
        if (home != null)
        {
            foreach (var t in s.Trucks.Where(x => !x.Retired && x.HomeTerminalId == shut.Yard.Id))
            { t.HomeTerminalId = home.Id; moved++; }
            foreach (var t in s.Trailers.Where(x => !x.Retired && x.HomeTerminalId == shut.Yard.Id))
            { t.HomeTerminalId = home.Id; t.CurrentLocation = $"{home.City}, {home.State}"; moved++; }
        }

        s.Company.Terminals.Remove(shut.Yard);

        v.Actions.Add($"The company is closing {label}. " +
                      (shut.Drivers > 0 ? $"{shut.Drivers} driver(s) let go. " : "") +
                      (moved > 0 ? $"{moved} unit(s) moved to {(home != null ? DispatchEngine.Place(home.City, home.State) : "the home yard")}. " : "") +
                      "Sell the garage in ATS when you can — that money is the company's.");
        report.Findings.Add($"{label} closed against a losing quarter.");
    }

    private static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var c in text ?? "") { h ^= c; h *= 16777619; }
            return h;
        }
    }
}
