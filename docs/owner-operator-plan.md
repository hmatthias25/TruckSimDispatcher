# Owner/operator app: plan

Status: **proposed**, written 2026-10-16 against v0.87 (`80649f9`), revised the same day around the GDC Companion App (v1.61.1), and on 2026-10-17 for the clearing account, broker personalities, specialist brokers, the Long Distance skill, the broker directory and reputation tiers. Nothing here is built. Files and symbols named below are as they stood at that commit; check them before relying on this, because the code will have moved on.

## The idea

A second app for playing ATS and ETS2 as an **owner/operator**: you own the truck, you choose the loads, and the money is yours to make or lose.

It is **the freight side of the career and nothing else**. The GDC Companion App already runs the business around the truck — the bank, the books, loans, taxes, insurance, maintenance, the cost of living on the road, live hours of service — and this app does not replicate any of it. What the Companion App does not do is find, price and book freight. That is this app: brokers and lanes, the phone calls, rate confirmations and getting paid, and planning which load to take and whether it can legally be made.

The company-driver app (this one) is a dispatcher that assigns freight and polices the driver. The owner/operator app is an advisor: it tells you what each load really pays after your costs and whether you can make it, and then you decide.

## The boundary

**One rule: the Companion App owns the money and the truck; this app owns the freight.**

| GDC Companion App (exists) | Owner/operator app (new) |
|---|---|
| Live hours of service, log certification, audits | Planning ahead: whether a load can legally be made, rests, ferries, bans |
| Business Office ledger, Nexora banking, loans | Rate confirmations, invoices, what brokers owe you |
| Taxes (ATS) | — |
| Asset Center: trucks and trailers owned | — |
| Insurance per asset and company-wide, claims | — |
| Maintenance schedules, work orders, repairs and downtime | — |
| Lifestyle: home, household, hotels, meals, cost of living | — |
| Fuel planning, fuel cards, IFTA, DEF | — |
| Changing money in the game, calendar and weather | — |
| — | Brokers, lanes, phone calls, negotiation, relationships |
| — | Choosing loads: profit per km and per day, home direction |

What follows from it:

- **This app never posts fuel, repairs, insurance, hotels, meals, tolls or loan payments.** If both apps did, every one of them would be counted twice.
- **This app never moves money itself.** It says what should move, between which accounts, and when; the player moves it with the Companion App's own transfer interface and tells this app it is done (see [Two banks](#two-banks)).
- **The game bank holds only money the player can spend.** Pay the game hands over at delivery is not the player's until the broker pays, so it is moved out to a clearing account in the Companion App.
- **Costs come from the Companion App**: the all-in cost per km every load is judged on is worked out from its records, not from this app's own model.
- **Clocks come from the Companion App** where it can tell us: it tracks hours of service live, so the driver should not have to type them in.

## The decision

**A new app over a shared core, in this repo.** Not a fork, and not a mode inside the company-driver app.

- Roughly half of the company-driver app is about driving a load: hours rules, routes, ferries, road distances, the board, the docks. That half is the expensive, play-tested part, and both apps need it unchanged.
- The other half is about working for a company: probation, rank, reviews, refusals, discipline, payroll, the fleet. The owner/operator app has no use for it.
- **A fork was rejected.** The days spent fixing ferries, EU rest rules and road distances in v0.86–v0.87 would have had to be made twice, and every future fix after them.
- **A mode inside the company-driver app was considered** as a quick way to try the idea. It gets something playable in days, but that app's assumptions about who decides would get more tangled the longer it lived there. Worth doing only as a throwaway prototype.

### The pieces

| Piece | Owns |
|---|---|
| **Core** (class library, new) | Hours-of-service planning, routes, ferries, road distances, game data, board reading, the trip log |
| **Company-driver app** (this one) | Dispatch, employment, pay, the fleet. **Unchanged by this plan**, apart from the Core extraction underneath it. It does not use the Companion App; the player moves their paycheck into the Companion App by hand and tracks what is left after living costs there |
| **Owner/operator app** (new) | Brokers, lanes, invoices, choosing loads |
| **GDC Companion App** (exists) | Everything in its column above |

## What carries over into Core

| Area | Today |
|---|---|
| Hours-of-service planning | `HosEngine`, `EuCounters`, `MobilityPackage` (the rules, not the hotel costs), `Restart` (the weekly-rest part), `GameZones`, weekend bans in `Ets2Data` |
| Routing | `Crossings`, `Ferries`, `Geo`, `RoadTable`, `RoadLearning`, `Replan` |
| Learning from play | `SpeedLearning`, `PickupLearning`, `FacilityLearning` |
| The board | screenshot import in `AiService`, `BoardExpiry`, `DeliveryWindow`, `ReceiverCall`, `ShipperCall`, feasibility verdicts |
| Game data | `GameProfile`, `Ets2Data`, `Markets`, city and road tables in `data-embedded/` |
| Plumbing | `StateStore` and snapshots, `Migrations`, the trip log and events, the UI shell, the test harness in `tests/` |

**What stays in the company-driver app:** `Probation`, `ProbationConduct`, `ProbationPlanner`, `DriverRank`, `PeriodicReview`, `Rejections`, `Alternates`, `Redemption`, `PayEngine`, `PayrollTax`, `EuHomeContract`, `Dedicated`, `Carriers`, the fleet services (`FleetOpsService`, `FleetMaintenance`, `CompanyHealth`, `Yards`, `TrailerFleet`), the dispatcher's authorize/reject logic in `DispatchEngine`, and the company's own books (`LedgerService`, `CostModel`, `Fuel`, `FuelReview`, `Shop`, `TotalLoss`).

**What the owner/operator app takes from none of them:** anything about money, fuel, maintenance, insurance or living costs. It reads those from the Companion App.

### The extraction problem

There are no interfaces in the codebase: every service is a static class reading the whole `AppState`. `HosEngine.Plan`, for example, reads the settings, the clocks, the status and (through `EuCounters`) the trip log. Core needs a smaller seam:

- **Clocks and rules:** the hours-of-service snapshot, the US or EU limits, the game profile. In the owner/operator app the snapshot comes from the Companion App where it can.
- **Where and when:** location, game time, fuel in the tank.
- **The trip log:** rests, ferries and breaks, for the EU counters.
- **Preferences:** ferries switched off, map coverage, buffers.
- **The truck:** speed, range, trailer type.

Each app maps its own state onto that seam. The work is mechanical but wide, and the existing test suite (about 4,900 checks) is what makes it safe: extract a service, run the suite, repeat.

## Two ways to run the business

Picked at onboarding, and changeable later as the career grows.

**Leased on to a carrier.**
- You keep a percentage of linehaul (typically 65–75%) plus the fuel surcharge.
- The carrier provides operating authority and its own load board, and settles weekly. The game's pay goes to Freight clearing as for a broker load, and the settlement moves your share on to the business account (see [Two banks](#two-banks)).
- No brokers, no invoices to chase.
- The easier start.

**Own authority.**
- Full revenue, but you find your own freight.
- Freight comes through **brokers** (see below) and, later, direct shippers.
- You invoice, wait to be paid, and decide whether to factor.
- The authority, permits and insurance it needs are set up in the Companion App; this app only knows whether you have them.

## Starting out

A new owner/operator starts with **an older truck, no trailer, and a nest egg**. The truck, the loan and the money all live in the game and the Companion App; this app recommends the starting position and checks it before the first load.

- **An older truck.** Cheap to buy, a small loan payment, and dear to run. The Companion App's maintenance and insurance make that bite, and the first real business decision is when to trade up.
- **No trailer.** The game lets a truck without a trailer take freight-market jobs on the shipper's trailer, which is how real power-only owner/operators work; the company-driver app already models it as its drop-and-hook arrangement (`DropHook`). Buying a trailer is a growth step: it opens the cargo market and its better pay.
- **A nest egg, sized to cash flow.** Owner/operators mostly fail on cash flow, not profit: fuel is paid today and the broker pays in thirty days. This app works out a recommended starting balance from the Companion App's cost figures and shows the sum:
  - about **two months of fixed costs** — the truck note, insurance, permits;
  - **running costs across the payment lag** — fuel and tolls for the first net-30, before any invoice is paid;
  - **one major repair.**
- **ETS2's legal floor.** To operate a truck in the EU a carrier has to show financial standing of **€9,000 for the first vehicle and €5,000 for each after it**. That is a natural minimum starting balance for a European career, and the figure the hard preset starts at.

### Start leased on

The first chapter is **leased on**: the carrier pays weekly and supplies the loads, and the player learns the cost-per-km game without brokers or invoices. **Going independent** is a milestone: enough cash in the Companion App's bank for the authority, the insurance down payment and permits, and then brokers, invoices and factoring open up.

### Presets

| Preset | Truck | Trailer | Business | Recommended starting cash |
|---|---|---|---|---|
| Easy | Mid-age | None | Leased on | Generous |
| Normal | Older | None | Leased on | The calculated nest egg |
| Hard | Older | None | Own authority | The legal minimum |

A new career starts on a **fresh game profile** with a Companion App driver tied to it, so the game, the Companion App's books and this app begin from the same position.

## Choosing loads

Loads come two ways: **lanes booked through brokers** ahead of time (see [Brokers](#brokers)), and **spot loads** off the board where you are standing, which comes in as it does now, by screenshot. Every load is planned by Core. What changes is the verdict.

- **No authorize or reject.** The app ranks; you choose. It still says plainly when a load cannot be made legally, or when it misses the window.
- **Profit, not rate.** Each load shows what it nets after your all-in cost per km, worked out from the Companion App's records: fuel, tolls, the truck note, insurance, maintenance and the cost of living on the road.
- **Profit per day, as well as per km.** A short well-paid load into a dead market that leaves you sitting empty for two days loses money. Core knows market tiers (`Markets`) and can estimate the empty run out of the destination.
- **The truck's condition.** A truck the Companion App has in the shop, or with a service due before the run would end, is said on every load.
- **Home time is yours to set.** You choose how often you want to be home; the app plans backhauls toward it. The EU rules stay enforced, because they are law, not company policy, and that includes the Mobility Package obligations on an operator.

## Brokers

The game has no brokers. A freight-market job shows a pay figure, and the game pays it the moment you deliver. Brokers are a layer the app simulates on top of the game's loads, the same way the company-driver app simulates shipper and receiver behaviour on top of the game's docks.

Two things the game sets, which shape everything below:

- **Jobs exist only in cities you have discovered.** The game offers no freight anywhere else, so neither can a broker.
- **Screenshots stay at one board per load.** Cutting and pasting the freight boards of a dozen cities to shop for work is not a game anybody wants to play.

So a broker does not post a game job. A broker books you a **lane**, and the game supplies the job when you get there.

### Where offers come from

The app generates lane offers from what it already knows:

- **Pickups only in discovered cities** (`DiscoveryService` tracks them). Destinations can be anywhere, because a lane names a region, not a city. Discovery becomes progress: explore, and your broker network grows.
- **Each city's freight strength** (`Markets` tiers), your trailer type, where you will be when the current load delivers, and which way home is.
- **How far the game lets you haul** (see [The Long Distance skill](#the-long-distance-skill)). A lane longer than that is never offered.
- **Rates tuned to the game's own pay.** The app has read hundreds of jobs off your boards, so it learns what the game pays per km by country and trailer type, and sets broker rates from that.

### The Long Distance skill

The game only offers jobs as long as the driver's **Long Distance** skill allows. A broker who books a lane longer than that sends you to a pickup where no job fits, so every broker knows what you have unlocked.

**The default limits**, the same in both games:

| Level | Longest job |
|---|---|
| 0 | 400 km (250 mi) |
| 1 | 650 km (400 mi) |
| 2 | 1,000 km (650 mi) |
| 3 | 1,600 km (1,000 mi) |
| 4 | 2,500 km (1,600 mi) |
| 5 | 4,000 km (2,500 mi) |
| 6 | Anywhere |

- **The table is a setting, defaulting to the figures above.** Economy mods change these distances (the GDC Companion App's economy among them), so each level's limit can be edited. Kilometres in ETS2, miles in ATS.
- **The level is the player's**, typed in at onboarding and updated when they put a point into the skill. The company-driver app already keeps the game's skills on the driver (`Skills`), which can move into Core.
- **What it limits:** lane offers, the distance band on a rate confirmation, and the jobs marked as fitting at the pickup. The top of a lane's band never passes the limit.
- **On the phone:** a broker will not book past it ("I can't put you on a 1,200 km run yet"). A level gained is a reason to call round: longer lanes are better paid, and the game pays a long-distance bonus on them too.

### How you get offers

- **Inbound:** the phone rings while you are on a load, usually within a day of delivery — when a real owner/operator books the next one. A broker who knows you rings earlier, with better lanes.
- **Outbound:** you call around ("What have you got out of Groningen Thursday?"). Each broker answers with lanes in the regions they work.

### What you book

A **rate confirmation** for a lane, for example:

> **Groningen → northern Italy · loads Thursday 08:00–14:00 · 900–1,100 km · dry van · €1.45/km · detention €40/h after 2 h · net 30**

- **Per km**, because the exact game job is not known yet.
- **A pickup window**, which goes into your plan: the run to Groningen is scheduled around it. Arrive late and the broker can cancel or dock the rate.
- **Terms as well as rate:** detention, payment terms, quick pay, a fuel advance, a cancellation fee if the load falls through.

### At the pickup

1. You screenshot the board there — the one board, as now.
2. The app **marks which jobs fit the booking**: the right origin, a destination inside the booked region, a distance inside the band (and inside your Long Distance limit), your trailer type, and a deadline you can legally make. It picks the best fit, normally the one closest to the booked distance.
3. You take that job in the game. The broker owes you the booked rate on the job's actual distance, as an invoice. The game pays its own figure into the game bank at delivery; how the two are squared is in [Two banks](#two-banks).

### When nothing fits

- **Wait:** "it is still being loaded". Game boards refresh over time, so you check again after a break or a rest.
- **Call to renegotiate:** take the nearest fit, at a rate worked out on the call.
- **The broker cancels.** A reliable broker pays the cancellation fee (truck ordered not used, TONU); a flaky one leaves you with nothing — which is why reliability matters.

### Where you already are

The current flow stays as the base: the dock you are standing at, then the city board. Those jobs can be booked as **spot loads** through a broker on the spot, with no deadhead to plan. It always works, whatever lanes are on offer.

### Generalists, specialists and the shippers themselves

There are three kinds of freight source once you have your own authority.

**General brokers.** Any freight on any trailer, the most lanes, middling rates. Where a new owner/operator starts.

**Specialist brokers.** One kind of freight, for example:

| Specialty | Freight | Trailers |
|---|---|---|
| Agriculture | Grain, feed, fertilizer, produce | Hopper, dry van, livestock, reefer |
| Fuel and petroleum | Fuel, oil, chemicals | Tanker; hazmat for most of it |
| Lumber and forest products | Logs, sawn lumber, pulp | Log trailer, flatbed |

And others in the same vein: refrigerated food, heavy haul, containers off the ports, cars. A specialist:

- offers lanes only out of cities where that industry has depots, read from the game's data on which companies are where and what they ship;
- needs the right trailer, and endorsements where the freight calls for them;
- pays better, with fewer trucks chasing the lane, because the equipment is rarer;
- talks shop on the phone (see [Personalities](#personalities)).

This is how a tanker or a log trailer pays for itself: buying one opens a specialist's lanes.

**The shippers themselves.** The larger companies in the game hire the owner/operator directly to pull their own freight: no broker margin, and only for a carrier with a long, clean record (see [Paying your dues](#paying-your-dues)). They work the way dedicated accounts work in the company-driver app (`Dedicated`):

- the company's own freight, from its own depots;
- at the pickup, the job that fits is the one from that company, picked the way a dedicated load is picked now, not by region and distance band;
- regular runs once the arrangement is established.

**Which companies do this is decided with the project owner when this part is designed. Ask before building it; do not pick them.**

### What makes each broker different

| Trait | Range |
|---|---|
| Specialty | General, or one kind of freight (above) |
| Personality | How they negotiate and how they talk (below) |
| Margin | How much of the shipper's rate they keep |
| Days to pay | 15, 30 or 45 game days, with a quick-pay option at a 2–5% fee |
| Credit rating | Most pay reliably; a few pay late; the occasional one does not pay at all. You can check before booking |
| Reliability | Some cancel late. A good broker pays a cancellation fee (truck ordered not used, TONU); a bad one does not |
| Detention policy | Whether they pay for long waits at the dock, and whether they argue about it |

Brokers are **fictional companies**. A broker who does not pay should not carry a real company's name. (The shippers who hire you directly are the game's own companies; that is the point of them.)

### Personalities

Every broker has a fixed personality, and it shapes both halves of a call:

- **The app's rules for the numbers:** where they open against their ceiling, how big each step is, how patient they are, and which terms they trade.
- **The voice the model speaks in:** the personality, the specialty and your history with them make up the character brief for every call.

| Personality | Negotiates | Sounds |
|---|---|---|
| The grinder | Opens low, moves in small steps, patient | Flat; numbers only; "that's the rate" |
| The friend | Moves fast for people they trust, slowly for strangers | Chatty; first names; asks how the last load went |
| The corporate desk | Will not move on rate; trades terms instead (quick pay, detention) | Polite and scripted; "per our policy" |
| The hustler | Opens generous to hook you, then finds problems: detention disputes, slow pay | Fast; over-promises |
| The old hand | Fair from the first offer, little room either way; gives way to a true argument | Dry; knows the roads ("you'll hit the Brenner ban Saturday") |
| The rookie | Over-generous by mistake, and sometimes calls back to walk it back | Nervous; checks with the boss |

The same broker sounds the same on every call, and remembers you: a friend you let down cools off, and a grinder you have run well for starts a little higher. The personality never changes a number on its own say-so; every figure is still the app's.

### Paying your dues

A new authority cannot ring a big shipper and ask for freight. Nobody books an unknown carrier onto their best lanes, so **reputation is earned in steps**, and the start of the game is meant to be lean.

**Your record as a carrier** is what every broker looks at before taking you on:

- **Time with your own authority**, in game time. Loads run while leased on count toward your experience, but the authority's age starts when you go independent.
- **Loads delivered**, **on-time percentage**, and **claims**: damage and cancellations on you.

**Three tiers of freight source**, each with its requirement written down:

| Tier | Who | Takes on | What you get |
|---|---|---|---|
| Starter | Brokers who work with new authorities | Anyone with an authority | Rates at the bottom of the band; leftover loads, short notice, tight windows; lanes into thin markets you have to deadhead out of; slower pay and more arguments over detention |
| Established | Most general and specialist brokers | A record: some months with your authority, a few dozen loads, on time | Fair rates, normal terms, better destinations |
| Premium | Contract desks and the shippers themselves | A long, clean record, and standing with them in particular | Regular lanes, the best rates, quick pay, no broker margin from a shipper |

- **Calling above your tier is allowed.** It is a short call in the broker's own voice ("call me when you've got some history"), and costs nothing.
- **The starter tier is the point of the early game, not a trap.** It is where the record gets built, and it is always there to fall back on.
- **The profit-per-day ranking tells the truth about it.** A cheap load into a thin market shows its real cost, the empty run out included, so paying your dues is a choice the player can see the price of.
- **A record can go backwards.** Late loads, damage, cancellations and bluffs caught drop your standing, and a broker who cares about it stops taking your calls until it recovers.

The thresholds above are placeholders until they are tuned against how fast a career moves in game time (open question 3).

### The broker directory

**Who to call for what.** The directory is the player's contact book, and the screen most calls start from.

Each broker's entry shows:

- **Specialty** and the **trailers** they book.
- **Where they work:** the regions their lanes start in, so "a reload out of Groningen on a tanker" finds the right names.
- **Their requirement**, against your record: "Takes new authorities", or "Wants 3 months, 25 loads, 95% on time: you are at 1 month, 9 loads, 100%." This is the path from starter to premium, laid out.
- **Payment terms and credit rating**, as a real credit check would show them.
- **Your history with them:** loads, disputes, how they pay you, your standing.
- **What you know of them:** the personality is not printed; it fills in from your own calls ("drives a hard bargain", "pays slowly, argues detention"), the way a real driver's notes do.

How it works:

- **Filters** by specialty, trailer, region, tier and "will take my call". Sorted by default for where the current load delivers, which is when the next one is booked.
- **A broker joins the directory** when a city they work is discovered, or when another broker mentions them. A new career starts with a short list of starter brokers.
- **Calling is a button on the entry**, and the call opens with what the directory knows.

### Phone calls

Every booking, renegotiation, dispute and collection is a **call** with a broker. **The app negotiates; the AI only talks.** Every number — the most the broker will pay, how far they move, when they hang up — is the app's, worked out by rules. The model voices the broker and reads what you say. You cannot talk the model into paying €10,000, and it cannot make up a rate the economics do not allow.

**Before the call**, the app prepares a private sheet for the broker and the lane:

- **Posted rate and ceiling.** The ceiling is the shipper's rate less the broker's minimum margin: the most they will ever pay.
- **Urgency:** how soon the pickup is, and (for a spot load) how long the listing has left (`BoardExpiry`).
- **Other trucks:** how many carriers are "calling" about the lane, from the origin's and destination's market tiers.
- **Personality**, fixed per broker (see [Personalities](#personalities)): how far and how fast they move, and how they talk.
- **Specialty:** a specialist knows their freight and argues from it; a general broker does not.
- **Relationship:** your record with them — on time, damage, and any bluff they have caught you in.
- **What they can trade besides rate:** quick pay, detention terms, a fuel advance, a cancellation fee.

**Each turn:**

1. **You type**, or talk (optional push-to-talk through the browser's speech recognition).
2. **The AI reads your intent:** an amount, an acceptance, or an argument — deadhead, a dead market at the destination, a tight window, your record, walking away.
3. **The app decides the response.** Arguments earn concessions in proportion to how strong they actually are. The broker's patience drops each round; push past it and "I'll find another truck" — the lane is gone.
4. **The AI says it in the broker's voice**, with the exact figure the app chose.

**Bluffs are checked.** The app knows the truth. Claim you are twenty minutes away when you are two hundred kilometres out, and the broker finds out when you turn up late; their trust drops, and so do your rates with them.

**After the call** you have a rate confirmation (above), attached to the booking, and the basis of the invoice.

An example:

> **Broker:** "Hegel Logistics, this is Marco. Rotterdam to Lyon, €1,850, picks up today."
> **You:** "It's 1,050 km and Lyon's dead for freight this week. I'll be leaving empty. €2,300."
> **Broker:** "€2,300's more than the shipper's paying me. I can do €2,050, and that's me cutting into my own margin."
> **You:** "€2,150 and you pay detention after two hours."
> **Broker:** "...Fine. €2,150, detention at €40 an hour after two. Sending the rate con."

Behind it: "dead market" was a true argument (a low-tier destination), so a concession was allowed; the second push asked for little, plus a term this broker trades easily, and landed before the broker's patience ran out.

**Technically:**

- It runs on the AI connection the company-driver app already has for reading screenshots (`AiService`), with the player's own API key.
- Each turn comes back as structured data — the parsed intent and the spoken line — so the model stays on the subject and never supplies a number.
- A small, fast model is enough; a call costs a fraction of a cent.
- **Without a key, the same negotiation runs as a counter-offer box.** The calls are the presentation; the game does not depend on them.
- Voice in and out is an optional extra through the browser's speech features. Text comes first.

### Getting paid

- Each delivered load becomes an invoice: the line rate, plus **detention** (the trip log measures waits at the shipper and receiver), plus extra-stop pay.
- Brokers may dispute detention. The dispute is a call, argued with the trip log's timestamps.
- **Factoring:** sell an invoice for cash now, minus a fee. The decision is this app's; the money is moved between the [two banks](#two-banks) by the player.
- A broker who does not pay is chased by calls, then becomes a collections case, and eventually a write-off.
- **What this app keeps** is receivables (what each broker owes, when it is due, what has been paid) and the pending transfers, with what is still sitting in the game bank that is not yours. The accounts themselves, and everything else money touches, are the game's and the Companion App's.

### Relationships

- On-time deliveries and clean paperwork build a score with each broker. A higher score means better rates, earlier calls with first look at lanes, and eventually **regular lanes** — the same shape as the company-driver app's dedicated accounts (`Dedicated`).
- Late or damaged loads cost you standing.
- **The shippers themselves** are the long-term goal (see [Generalists, specialists and the shippers themselves](#generalists-specialists-and-the-shippers-themselves)): no broker margin, but only once your record is good, at the top of the tiers in [Paying your dues](#paying-your-dues).

## Two banks

There are two banks, and the Companion App already moves money between them in both directions:

- **The game bank**: the balance in ATS or ETS2. **Kept to money the player can spend.** The game pays a job's figure into it at delivery, and takes in-game spending out of it.
- **The Companion App bank** (Nexora), which holds several accounts. An owner/operator career uses two:
  - **Freight clearing**: the game's pay for each delivery, which is the shipper's money passing through. None of it is the player's until the broker pays.
  - **The business account**: the business's own money, with the ledger behind it.

The owner/operator app never touches any of them. It works out **what should move, between which accounts, and when**; the player does it through the Companion App's transfer screen and tells this app it is done.

### Transfers wait for the game to close

The Companion App can only move money into or out of the game bank while ATS or ETS2 is closed. So:

- **Every transfer this app asks for is pending until the player marks it done.** The list carries over between sessions and is the first thing shown when the app opens.
- **Until it moves, the app says how much of the game balance is not yours:** "€14,200 in the ATS bank; €5,100 of it is shipper money waiting to go to Freight clearing." Anything that budgets the game bank (fuel, a repair, a truck) counts only the rest.
- **The app can check whether the game is running**, since both are on the same PC, and offer the transfers once it is not.
- **Marking a transfer done is the player's word.** Once the Companion App link exists (open question 2), it can be checked against the balances.

### A broker load through the accounts

1. **Delivery.** The game pays the job's figure into the game bank. The app adds a pending transfer: move it to Freight clearing.
2. **Game closed, money moved.** The player moves it in the Companion App and marks it done here. The game bank is back to the player's own money.
3. **The broker's terms run.** The invoice sits in this app's receivables until it is due (net 30, or sooner with quick pay or factoring).
4. **Paid.** Move the booked amount from Freight clearing to the business account: "Hegel Logistics paid invoice 0041: move €2,150 from Freight clearing to the business account." This does not involve the game bank, so it should not need the game closed.
5. **Square the load.** Each load should leave Freight clearing at zero:
   - **The game paid more** (the usual case: the broker kept a margin). What is left is the broker's, and comes out of Freight clearing without becoming your income.
   - **The game paid less** (you negotiated above the game's pay). Freight clearing is short, and the difference has to be put in from outside the game.

How step 5 is recorded depends on what the Companion App allows; see open question 1.

### The other way

The Companion App moves money back to the game when the game needs it: to buy fuel, pay for in-game repairs, or cover what the game deducts. That is the Companion App's business; this app only reads the balances to forecast cash.

## The Companion App link

**Read from it:**

- **Costs**, for the cost per km: fuel, tolls, the truck note, insurance premiums, maintenance and repairs, living costs on the road.
- **The bank balance and what is coming due**, for a cash forecast: "with what is owed to you and what you owe, you can run three weeks without a load".
- **The truck:** in the shop, how long for, a service coming due, coverage that limits freight (cargo value, hazmat, countries).
- **Live hours-of-service clocks**, so the driver does not type them in.
- **The driver's home**, for home time and backhauls.

**Moves between the accounts**, done by the player through the Companion App's transfer interface on this app's word, and marked done here: each delivery's pay out of the game bank into Freight clearing, paid invoices on to the business account, cancellation fees, factoring fees and advances, and squaring each load. See [Two banks](#two-banks).

**How:** the Companion App's v1.61.1 release notes describe no export, API or data format. It reads game saves and telemetry, writes game files through a runtime mod, and keeps its own records. The options, best first:

1. **Ask the developer** (CorvidMommy, on Patreon or Discord) whether there is an export, or a local data file other tools may read. The only route that will not break on every update.
2. **Read its local data on the player's PC, read-only.** Often a local database or JSON files. Shows what is possible, but means keeping up with its changes.
3. **The game save as common ground.** Both apps can read the bank balance, the garages and owned trucks from it. Robust, but limited.
4. **Typed in** until a link exists: a cost per km and the clocks typed in, and the transfers listed for the player to make.

Whichever it is, the owner/operator app talks to the Companion App through **one adapter**. Typing things in is its first version; a real link replaces it without touching anything else.

## Growth

At some point the owner/operator hires a driver. The Companion App already handles multiple drivers on a profile and team driving; the freight side — dispatching a second truck, fleet reports, contribution, hiring by skill points — can come from the company-driver app's fleet operations. Where that line falls is decided when the owner/operator app reaches that stage, against whatever the Companion App does by then.

## Phases

| Phase | What | Notes |
|---|---|---|
| 0 | **Core extraction** | Planning, routing, game data and the board into a class library; the company-driver app on top of it; the full test suite green at every step |
| 1 | **Owner/operator skeleton** | Onboarding with the presets and the recommended nest egg, leased on only; board import, profit ranking on a typed-in cost per km, the trip lifecycle from Core |
| 2 | **Own authority and brokers** | Going independent as a milestone; the broker directory; the carrier record and the starter tier; the Long Distance limit as a setting that every lane respects; a roster of general and specialist brokers, with their personalities as negotiation rules; lane offers from discovered cities, rate confirmations, matching the pickup board to the booking, spot loads, the counter-offer box, invoices and payment terms |
| 3 | **Getting paid** | Freight clearing; pending transfers that wait for the game to close and are marked done by the player; receivables, factoring, collections, the cash forecast |
| 4 | **Companion App link** | The adapter: costs, balance, truck status and clocks read; money written. Depends on open question 2 |
| 5 | **Relationships and calls** | Broker scores, the established and premium tiers, inbound calls, regular lanes; the shippers themselves, on the dedicated-account pattern (which companies: ask first); the AI phone calls in each broker's personality over the phase 2 negotiation rules, then optional voice |
| 6 | **Growth** | A second truck and driver, the freight side from the company-driver app's fleet code |

Phase 1 runs on a typed-in cost per km and typed-in clocks, so the link does not block the game being playable.

## Open questions

1. **How is each load squared in Freight clearing?** (See [Two banks](#two-banks).) The broker's margin has to leave the account without arriving as income, and a rate negotiated above the game's pay has to be topped up from somewhere. It depends on what the Companion App's ledger allows: a withdrawal recorded as the broker's share, and a deposit recorded as revenue.
2. **How does the Companion App expose its data?** An export, a local file, an API, nothing? This decides whether phase 4 is a live link, an import, or typing.
3. **How long is "net 30" in game time?** Thirty game days is a long time at the game's pace. Payment terms may need scaling so cash flow matters without being tedious.
4. **How tight should a lane fit be?** A ±20% distance band and a named region are a guess. Too tight and nothing fits at the pickup; too loose and booking means nothing.
5. **One career type per app, or can a company driver "go independent"?** Carrying a career across from the company-driver app into the owner/operator one would be a good story, and needs a shared export format.
6. **Leased-on carriers:** real names, like the company-driver app's carrier roster, or fictional like the brokers?
7. **How quickly do game boards refresh?** "Wait, it is still being loaded" only works if a board changes within a rest or so. Worth measuring in both games before settling the rules for a lane that finds no fit.
8. **Does the starting truck fit the loans?** The game caps loans by level, and the Companion App has loans of its own. The presets may need to fit those limits rather than the other way round.
9. **Which game companies hire the owner/operator directly?** The project owner decides when that part is designed (see [Generalists, specialists and the shippers themselves](#generalists-specialists-and-the-shippers-themselves)).
10. **Can every Companion App account transfer while the game runs?** Step 4 of a broker load assumes so, because it does not touch the game bank. Worth confirming.
