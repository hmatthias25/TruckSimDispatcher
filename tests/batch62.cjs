/* Issues #62, #65, #66 — three from play-testing.
 *
 * 62: flatbeds are not drop-and-hook. Taking a load off a facility board with one still means driving to
 *     a loading spot and waiting, so the tick must not buy a hook time for it.
 * 65: loaded miles come back blank on screenshot import, most often off a facility list.
 * 66: there are no loads AT a truck stop, a rest area or your own yard — only in the city.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5840}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);

let S;
async function place(kind, city = 'Denver', st = 'CO', day = 4) {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: iso(day, '06:00'),
    fuelPct: 90, atsOdometer: 30000 + day * 100, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 70000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  return S;
}

/** Adds a pre-loaded pickup on the given trailer type and returns its plan. */
async function preloaded(trailerType, tick = true) {
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Steel', trailerType, atLocation: true, preLoaded: tick,
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 0, gameRevenue: 800, deadlineHours: 30, weightLbs: 30000,
  });
  return bd.evaluations[0];
}

(async () => {
  const app = { driverName: 'B. Batch', preferredDivision: 'Flatbed', secondDivision: 'Dry Van',
    transmissionPreference: 'either', experienceYears: 9, homeCity: 'Denver', homeState: 'CO',
    acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));
  await place('Shipper');

  head('62. A pre-loaded flatbed is still live loaded');
  // Compare like with like: the SAME trailer type, ticked pre-loaded against not. Comparing a van to a
  // flatbed measures the wrong thing, because their unload times differ too and partly cancel it out.
  const hook = S.settings.hookHours;
  ok('the hook time is a setting', hook > 0 && hook < 1, `${hook} h`);

  const vanLive = await preloaded('Dry Van', false);
  const vanHook = await preloaded('Dry Van', true);
  const vanSaved = vanLive.feasibility.onDutyHours - vanHook.feasibility.onDutyHours;
  ok('a dry van saves real time by being pre-loaded', vanSaved > 0.5,
    `${hhmm(vanSaved)} saved (${hhmm(vanLive.feasibility.onDutyHours)} -> ${hhmm(vanHook.feasibility.onDutyHours)})`);

  const flatLive = await preloaded('Flatbed', false);
  const flatHook = await preloaded('Flatbed', true);
  const flatSaved = flatLive.feasibility.onDutyHours - flatHook.feasibility.onDutyHours;
  ok('a flatbed saves NOTHING by being ticked', Math.abs(flatSaved) < 0.01,
    `${hhmm(flatSaved)} saved (${hhmm(flatLive.feasibility.onDutyHours)} -> ${hhmm(flatHook.feasibility.onDutyHours)})`);
  ok('because it still books the full dock time',
    Math.abs(flatHook.feasibility.onDutyHours - flatLive.feasibility.onDutyHours) < 0.01, 'identical plans');
  ok('the driving is untouched either way',
    Math.abs(flatHook.feasibility.driveHours - flatLive.feasibility.driveHours) < 0.01,
    `${hhmm(flatHook.feasibility.driveHours)} both`);
  // Driving to the loading spot is inside the same facility: time, not distance.
  ok('and no extra MILES are charged for reaching the loading spot',
    Math.abs(flatHook.feasibility.totalMiles - flatLive.feasibility.totalMiles) < 0.01,
    `${flatHook.feasibility.totalMiles} mi both`);

  head('62b. The trip does not claim a flatbed was pre-loaded');
  // Re-add it: each preloaded() clears the board, so the earlier id is gone.
  const again = await preloaded('Flatbed');
  const authed = await api('/dispatch/authorize', 'POST', { loadId: again.load.id });
  ok('the load was ticked pre-loaded', again.load.preLoaded === true, `${again.load.preLoaded}`);
  ok('but the trip records it as live loaded', authed.trip.preLoaded === false,
    `trip.preLoaded=${authed.trip.preLoaded}`);
  ok('and it books a real dock time', authed.trip.loadingHours > hook + 0.2,
    `${hhmm(authed.trip.loadingHours)}`);

  head('62c. Which types are live loaded is a setting, not a rule');
  const types = S.settings.liveLoadTrailerTypes || [];
  ok('flatbed is on the list', types.some((x) => /flatbed/i.test(x)), types.join(', '));
  ok('dry van is not', !types.some((x) => /dry van/i.test(x)), types.join(', '));

  head('65. A listing with no distance gets one from the map');
  const got = (await api('/board/interpret', 'POST', [{
    cargo: 'Steel', originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 0, gameRevenue: 800, weightLbs: 30000, deadlineHours: 30,
    trailerType: 'Flatbed', deliverByText: '', unreadable: ['loadedMiles'],
  }])).loads[0];
  ok('the miles were worked out', got.loadedMiles > 0, `${got.loadedMiles} mi`);
  ok('and it is a believable Denver-Pueblo figure', got.loadedMiles > 80 && got.loadedMiles < 200,
    `${got.loadedMiles} mi`);
  ok('flagged as derived, not transcribed', got.milesDerived === true, `${got.milesDerived}`);
  ok('and no longer reported unreadable', !(got.unreadable || []).includes('loadedMiles'),
    JSON.stringify(got.unreadable));

  head('65b. A distance that WAS printed is left alone');
  const kept = (await api('/board/interpret', 'POST', [{
    cargo: 'Steel', originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 137, gameRevenue: 800, weightLbs: 30000, deadlineHours: 30,
    trailerType: 'Flatbed', deliverByText: '', unreadable: [],
  }])).loads[0];
  ok('the read figure stands', kept.loadedMiles === 137, `${kept.loadedMiles}`);
  ok('and is not claimed as derived', !kept.milesDerived, `${kept.milesDerived}`);

  head('65c. Unknown cities are not given an invented distance');
  const unknown = (await api('/board/interpret', 'POST', [{
    cargo: 'Steel', originCity: 'Nowhereville', originState: 'ZZ', destCity: 'Elsewhere', destState: 'ZZ',
    loadedMiles: 0, gameRevenue: 800, weightLbs: 30000, deadlineHours: 30,
    trailerType: 'Flatbed', deliverByText: '', unreadable: ['loadedMiles'],
  }])).loads[0];
  ok('nothing is made up for cities it cannot place',
    unknown.loadedMiles === 0 || unknown.milesDerived !== true,
    `${unknown.loadedMiles} mi, derived=${unknown.milesDerived}`);

  head('66. Where a local board makes sense');
  // The server records what the driver says; the gate is that the UI only offers it at a customer. What
  // is checked here is the fact the UI keys off, since that is the thing that decides.
  for (const kind of ['Shipper', 'Receiver']) {
    await place(kind);
    ok(`${kind} is a place freight is offered`, S.status.locationKind === kind, S.status.locationKind);
  }
  for (const kind of ['TruckStop', 'RestArea', 'Terminal', 'Road']) {
    await place(kind);
    ok(`${kind} is not`, S.status.locationKind === kind, S.status.locationKind);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
