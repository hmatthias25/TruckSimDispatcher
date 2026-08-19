/* Issue #47: ATS filters the freight board by the trailer already hooked, so the app must not
   second-guess it. A flatbed load of fertilizer was being refused because the app's own compatibility
   table knew only two equivalences. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5740}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

let S;

async function offer(cargo, trailerType) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo, trailerType, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 1800, deadlineHours: 36, weightLbs: 40000,
  });
  const e = r.evaluations[0];
  return { fails: (e.hardFails || []).join(' | '), cons: (e.cons || []).join(' | '), eval: e, board: r };
}

(async () => {
  head('1. Hire, on a dry van');
  const app = { driverName: 'Fit Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T08:00' }));
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: '2000-01-01T08:00',
    fuelPct: 95, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 50000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const hooked = S.trailers.find((t) => t.unit === S.driver.assignedTrailerUnit);
  console.log(`  hooked: ${hooked.unit} (${hooked.type})`);

  head('2. The reported bug: flatbed fertilizer on a dry van');
  let r = await offer('Fertilizer', 'Flatbed');
  ok('NOT rejected for the trailer', !/Needs a Flatbed/i.test(r.fails), r.fails || '(no hard fails)');
  ok('no hard fails at all', r.fails === '', r.fails || '(clear)');
  ok('but the mismatch is noted', /Listed as a Flatbed/i.test(r.cons), r.cons || '(nothing said)');
  ok('and it explains why it is taken anyway',
    /only shows you freight your trailer can pull/i.test(r.cons), r.cons);

  head('3. It can actually be authorized');
  const auth = await api('/dispatch/authorize', 'POST', { loadId: r.eval.load.id });
  S = auth.snapshot;
  ok('the load went out', !!S.views.activeTrip, S.views.activeTrip?.number);
  ok('carrying the cargo as reported', S.views.activeTrip?.cargo === 'Fertilizer', S.views.activeTrip?.cargo);

  // Close it so the board is free again.
  await api(`/trips/${S.views.activeTrip.id}/complete`, 'POST', {
    deliveredGameTime: '2000-01-02T08:00', actualMiles: 400, endOdometer: 1400, actualRevenue: 1800,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', fuelPct: 60, gameTime: '2000-01-02T08:00',
  });
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: '2000-01-03T08:00',
    fuelPct: 95, atsOdometer: 1500, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 50000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  head('4. No trailer type is refused any more');
  for (const type of ['Flatbed', 'Step Deck', 'Tanker', 'Lowboy', 'Livestock', 'Log', 'Dump', 'Car Hauler', 'Hopper']) {
    r = await offer('Assorted Freight', type);
    ok(`${type} is not a hard fail`, !/Needs a/i.test(r.fails), r.fails || '(clear)');
  }

  head('5. A matching trailer says nothing at all');
  r = await offer('Palletised Goods', hooked.type);
  ok('no mismatch note when it matches', !/Listed as a/i.test(r.cons), r.cons || '(quiet)');

  head('6. Genuine gates still bite');
  // Hazmat class is the driver's licence, not the trailer — that must still refuse.
  await api('/board/clear', 'POST', {});
  const haz = await api('/board/add', 'POST', {
    cargo: 'Gasoline', trailerType: 'Tanker', originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 36, weightLbs: 40000, isHazmat: true, hazmatClass: '3',
  });
  const hazFails = (haz.evaluations[0].hardFails || []).join(' | ');
  ok('an unheld HazMat class still refuses', /Class 3/i.test(hazFails), hazFails || '(none)');
  ok('and it is not about the trailer', !/Needs a/i.test(hazFails), hazFails);

  head('7. Swap planning keeps its compatibility rules');
  const swap = await api('/equipment/swap-options?trailerType=Reefer');
  ok('the swap planner still answers', typeof swap.possible === 'boolean', JSON.stringify(swap.possible));
  ok('and still knows what it needs', swap.requiredType === 'Reefer', swap.requiredType);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
