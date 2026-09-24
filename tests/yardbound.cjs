/* Two things reported from play on the same home time, both of them the app telling the driver about
 * equipment they cannot reach.
 *
 *   "I was told I was to take a flatbed from Springfield and I set it to private. When I got back it
 *    said I was taking one from DENVER instead which makes no sense. I can ONLY get trailers from the
 *    yard I am at (my home yard in this case) on home time."
 *
 *   "I had a reposition and closed it and when I tried to swap trailers was told reposition was still
 *    active and it was not."
 *
 * THE FLATBED. The career had three of them: one on the home yard book and out under a hired driver
 * (the promised one, reserved in ATS a fortnight earlier), one on the Denver book standing free, and
 * one at Salt Lake City. IssueTrailerReassignment looked for something FREE at the yard, then at the
 * home yard, and then — the clause that did the damage — anywhere in the company. The promised box was
 * not free, so the search walked straight past it and took the Denver one, in an order that named
 * Springfield as the place to do the swap.
 *
 * Two separate faults, and each is enough on its own:
 *
 *   1. The promise was only ever a SORT KEY on a list that every branch then re-filtered. A promise
 *      that survives only while nothing else sorts above it is not a promise.
 *   2. The search could leave the yard. A trailer on another yard book is not available to a driver
 *      standing here, whatever its state — the second branch exists precisely so that a box on THIS
 *      book that happens to be out can still be taken, with the days quoted.
 *
 * THE REPOSITION. Ordering an empty move overwrote ActiveTripId without closing the move already
 * standing, so the old one was unreachable in both directions: nothing pointed at it, so no close-out
 * could reach it, and it was still Authorized, so SwapTrailer — which swept EVERY trip rather than the
 * active one — refused every swap for ever, citing freight the driver had closed weeks before.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5895}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let home, denver, S;

(async () => {
  const app = { driverName: 'H. Okafor', preferredDivision: 'Reefer', experienceYears: 5,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  home = S.company.terminals[0];
  await api(`/terminals/${home.id}/level`, 'POST', { level: 'Large' });
  const second = un(await api('/terminals', 'POST', { city: 'Denver', state: 'CO', level: 'Large' }));
  denver = (second.company.terminals || []).find((x) => x.city === 'Denver');
  ok('there are two yards to get this wrong between', !!denver && denver.id !== home.id,
    `${home.city} and ${denver?.city}`);

  head('1. The fleet from the reported career, in miniature');
  // A flatbed on the home book, out under one of ours. A flatbed on the Denver book, standing free.
  const st0 = await api('/export');
  st0.trailers.push(
    { unit: 'F-HOME', ref: 'F-HOME', type: 'Flatbed', division: 'Flatbed', status: 'InService',
      inGameGarage: true, homeTerminalId: home.id, currentLocation: 'Chicago, IL',
      whereabouts: 'Inbound', whereaboutsCity: 'Chicago', whereaboutsState: 'IL',
      assignedTruckUnit: 'H-9', isCompanyOwned: true, length: "48'", axles: 'Tandem' },
    { unit: 'F-DEN', ref: 'F-DEN', type: 'Flatbed', division: 'Flatbed', status: 'InService',
      inGameGarage: true, homeTerminalId: denver.id, currentLocation: 'Denver, CO',
      assignedTruckUnit: '', isCompanyOwned: true, length: "48'", axles: 'Tandem' },
    // And a box under the driver. Nobody is re-rigged OFF nothing: ConsiderTrailerReassignment wants a
    // current trailer before it will roll, so without this the whole mechanism sits out the suite.
    { unit: 'R-START', ref: 'R-START', type: 'Reefer', division: 'Reefer', status: 'InService',
      inGameGarage: true, homeTerminalId: home.id, currentLocation: 'Springfield, MO',
      whereabouts: 'Under me', assignedTruckUnit: st0.driver.assignedTruckUnit,
      isCompanyOwned: true, length: "53'", axles: 'Tandem' });
  st0.driver.assignedTrailerUnit = 'R-START';
  st0.driver.trailerByRequest = false;
  await api('/import', 'POST', st0);

  await api('/fleet/truck', 'POST', {
    unit: 'H-9', year: 2020, make: 'Kenworth', model: 'T680', atsOdometer: 150000,
    damagePct: 4, status: 'InService', inGameGarage: true, homeTerminalId: home.id,
  });
  await api('/fleetops/drivers', 'POST', {
    id: 'hire-holding-the-box', name: 'W. Fenner', status: 'Active', assignedTruckUnit: 'H-9',
    assignedTrailerUnit: 'F-HOME', homeTerminalId: home.id, level: 7, hiredGameDate: iso(2),
  });

  let st = await api('/export');
  ok('the home-yard flatbed is out under one of our drivers',
    st.hiredDrivers.some((d) => d.assignedTrailerUnit === 'F-HOME'), 'W. Fenner has it');
  ok('the Denver flatbed is standing free',
    !st.trailers.find((t) => t.unit === 'F-DEN').assignedTruckUnit, 'nobody on it');

  head('2. The promise is for the home-yard box, and it binds');
  // Standing at the home yard, promised F-HOME a fortnight ago and told to mark it as their own.
  //
  // The re-rig itself is a seeded roll, so the home time it fires on varies by career. Walk forward
  // until one fires: WHETHER a driver is re-rigged is not what this suite is about, only which box
  // they are handed when they are.
  /** Reports in at the home yard on home time `n`, and gives back any order that was raised. */
  async function reportIn(n, promise) {
    const x = await api('/export');
    x.equipmentOrders = x.equipmentOrders.filter((o) => o.status !== 'Open');
    x.status.activeTripId = '';
    x.driver.changeoverUnit = promise || '';
    x.driver.changeoverType = promise ? 'Flatbed' : '';
    x.driver.changeoverReserve = !!promise;
    x.driver.changeoverNote = promise
      ? 'Operations wants you on flatbed for the tour after this home time.' : '';
    x.driver.atHomeYard = false;
    // Standing somewhere else, because arriving is what takes home time. Importing a state already
    // parked at the yard does not work: EnsureAtHomeFlag sets the flag from the location on the way in,
    // so the status post that follows reads as another clock-in rather than an arrival and Touch
    // returns without rolling anything. Cost an hour to find; hence this note.
    x.status.locationCity = 'Tulsa';
    x.status.locationState = 'OK';
    x.status.locationKind = 'Receiver';
    x.driver.homeTimesTaken = 4 + n;
    x.driver.homeTimesOnTrailer = 4;
    x.driver.assignedTrailerUnit = 'R-START';
    await api('/import', 'POST', x);

    // Reporting in at the yard IS taking home time — the app observes it rather than scheduling it,
    // so a status post at the home city is what raises the re-rig order.
    await api('/status', 'POST', {
      locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal',
      gameTime: iso(40 + n * 14), fuelPct: 80, atsOdometer: 150000,
      truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 300000,
    });
    return (await api('/export')).equipmentOrders
      .find((o) => o.status === 'Open' && o.kind === 'TrailerSwap');
  }

  let order = null;
  for (let n = 1; n <= 8 && !order; n++) order = await reportIn(n, 'F-HOME');

  if (!order) {
    ok('a re-rig order was raised across eight home times', false, 'the roll never fired');
  } else {
    ok('the order is for the box that was promised', order.toTrailerUnit === 'F-HOME',
      `${order.toTrailerUnit}`);
    ok('and never for the one on the other yard book', order.toTrailerUnit !== 'F-DEN',
      order.toTrailerUnit);
    ok('the yard named is the one the driver is standing at',
      /Springfield/i.test(order.terminalLabel || ''), order.terminalLabel);
    ok('and Denver is nowhere in the instruction',
      !/denver/i.test(order.instruction || ''), (order.instruction || '').slice(0, 110));
  }

  head('3. With no promise standing, it still never leaves the yard');
  // The other half. Nothing reserved, nothing free on this book — the honest answer is "buy one here",
  // not "drive four hundred miles to Denver". Run over several home times because the re-rig is a
  // seeded roll: what is asserted is that NO home time ever produces the Denver box, which is the
  // invariant, rather than that a particular one fires.
  let sawDenver = null;
  let ordersSeen = 0;
  for (let n = 1; n <= 8; n++) {
    const raised = await reportIn(n, null);
    if (!raised) continue;
    ordersSeen++;
    if (raised.toTrailerUnit === 'F-DEN' || /denver/i.test(raised.instruction || '')) {
      sawDenver = raised;
      break;
    }
  }
  ok('no home time ever sends the driver to the other yard', sawDenver === null,
    sawDenver ? `${sawDenver.toTrailerUnit}: ${sawDenver.instruction}` : `${ordersSeen} order(s) raised, none at Denver`);

  head('4. A superseded reposition does not stay open behind you');
  st = await api('/export');
  st.equipmentOrders = st.equipmentOrders.filter((o) => o.status !== 'Open');
  await api('/import', 'POST', st);

  const move1 = await api('/moves', 'POST', {
    kind: 'EmptyMove', destCity: 'Tulsa', destState: 'OK', miles: 0, reason: 'first reposition',
  }).catch((e) => ({ error: e.message }));
  const move2 = await api('/moves', 'POST', {
    kind: 'EmptyMove', destCity: 'Joplin', destState: 'MO', miles: 0, reason: 'changed my mind',
  }).catch((e) => ({ error: e.message }));
  ok('both moves were accepted', !move1.error && !move2.error,
    move1.error || move2.error || 'two ordered');

  st = await api('/export');
  const empties = st.trips.filter((t) => t.kind === 'EmptyMove');
  const stillOpen = empties.filter((t) => t.status === 'Authorized' || t.status === 'InTransit');
  ok('ordering a second move does not leave the first one standing', stillOpen.length <= 1,
    `${empties.length} empty move(s), ${stillOpen.length} still open`);
  ok('and anything left open is the one the app points at',
    stillOpen.every((t) => t.id === st.status.activeTripId),
    stillOpen.map((t) => t.number).join(', ') || 'none open');

  head('5. A trip nothing points at cannot block a trailer swap');
  // The guard swept every trip in the file. One stale record refused the swap for ever, and said "you
  // are hooked to freight" about a run that had been closed out.
  st = await api('/export');
  st.status.activeTripId = '';
  st.trips.unshift({
    id: 'orphan-reposition', number: 'PRI-MT-999', kind: 'EmptyMove', status: 'Authorized',
    cargo: 'Empty repositioning', division: 'Repositioning',
    originCity: 'Junction City', originState: 'KS', destCity: 'Springfield', destState: 'MO',
    dispatchedGameTime: iso(39), startOdometer: 149000, events: [],
  });
  // A box standing on the yard, so the swap has somewhere to go.
  st.trailers.push({ unit: 'R-YARD', ref: 'R-YARD', type: 'Reefer', division: 'Reefer',
    status: 'InService', inGameGarage: true, homeTerminalId: home.id,
    currentLocation: 'Springfield, MO', whereabouts: 'Parked', assignedTruckUnit: '',
    isCompanyOwned: true, length: "53'", axles: 'Tandem' });
  // And the open order that makes the swap operations decision rather than the driver picking their
  // own trailer — which is the route the player was on when they hit this: re-rigged at the yard, box
  // named, and then told the reposition was still running.
  st.equipmentOrders = (st.equipmentOrders || []).filter((o) => o.status !== 'Open');
  st.equipmentOrders.unshift({
    number: 'PRI-EQ-900', kind: 'TrailerSwap', status: 'Open',
    reason: 'Freight mix', fromTrailerUnit: st.driver.assignedTrailerUnit, toTrailerUnit: 'R-YARD',
    terminalId: home.id, terminalLabel: 'Springfield, MO',
    issuedGameTime: iso(41), instruction: 'Drop yours and hook R-YARD at Springfield, MO.',
  });
  await api('/import', 'POST', st);

  const swap = await api('/equipment/swap', 'POST', { trailerUnit: 'R-YARD', force: true })
    .catch((e) => ({ error: e.message }));
  ok('the swap is not refused over a trip nobody is on',
    !/still open/i.test(swap.error || ''), swap.error || 'swap allowed');

  head('6. The trip the driver IS on still blocks it');
  // The guard is not being removed, only pointed at the right trip.
  st = await api('/export');
  st.trips.unshift({
    id: 'live-run', number: 'PRI-L-500', kind: 'Freight', status: 'InTransit',
    cargo: 'Steel coils', division: 'Flatbed',
    originCity: 'Springfield', originState: 'MO', destCity: 'Tulsa', destState: 'OK',
    dispatchedGameTime: iso(41), startOdometer: 150000, events: [],
  });
  st.status.activeTripId = 'live-run';
  await api('/import', 'POST', st);

  const blocked = await api('/equipment/swap', 'POST', { trailerUnit: 'R-YARD', force: true })
    .catch((e) => ({ error: e.message }));
  ok('a live run still refuses the swap', /still open/i.test(blocked.error || ''),
    blocked.error || 'allowed, and should not have been');
  ok('and it names the run the driver is actually on',
    /PRI-L-500/.test(blocked.error || ''), blocked.error);

  head('7. An older career carrying one gets it closed on load');
  st = await api('/export');
  st.status.activeTripId = '';
  // Deliberately one with miles behind it. An earlier cut of the migration asked whether the move had
  // been driven and skipped it if so, which left exactly this case stranded — and "was it driven" is
  // the wrong question anyway: no route can close a move the pointer is not on, driven or not.
  st.trips.unshift({
    id: 'legacy-orphan', number: 'PRI-MT-998', kind: 'EmptyMove', status: 'Authorized',
    cargo: 'Empty repositioning', division: 'Repositioning',
    originCity: 'Junction City', originState: 'KS', destCity: 'Springfield', destState: 'MO',
    dispatchedGameTime: iso(39), startOdometer: 149000, events: [],
  });
  st.schemaVersion = 1;                      // force the migrations to run over it
  await api('/import', 'POST', st);
  const migrated = (await api('/export')).trips.find((t) => t.id === 'legacy-orphan');
  ok('the stranded move is closed rather than left to bite', migrated.status === 'Cancelled',
    `${migrated.number} is ${migrated.status}`);
  ok('and nobody is blamed for a deadhead that was never driven',
    migrated.faultAttribution === 'None', migrated.faultAttribution);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
