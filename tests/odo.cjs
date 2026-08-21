/* Issue #20: actual miles derived from the odometer, with warnings on a reading that looks wrong. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5544}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 250));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const mile = (a) => (a.mileageFindings || []).join(' | ');
const warn = (a) => (a.warnings || []).join(' | ');

let S, day = 1;

/** One load out and back, closed with whatever odometer/miles the case wants to try. */
async function runTrip({ startOdo, endOdo, typedMiles, loaded = 500, deadhead = 0 }) {
  const d0 = day, d1 = day + 1; day += 2;
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper',
    gameTime: `2000-01-${String(d0).padStart(2, '0')}T05:00`, fuelPct: 100,
    atsOdometer: startOdo, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 30000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: loaded, deadheadMiles: deadhead,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 40000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: `2000-01-${String(d1).padStart(2, '0')}T18:00`,
    actualMiles: typedMiles ?? 0, endOdometer: endOdo, actualRevenue: 2400,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', fuelPct: 55,
    gameTime: `2000-01-${String(d1).padStart(2, '0')}T18:00`,
  });
  // Reset home so the next leg starts from Denver again.
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper',
    gameTime: `2000-01-${String(day).padStart(2, '0')}T05:00`, fuelPct: 100,
    atsOdometer: endOdo, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 30000,
  });
  return done.audit || done;
}

(async () => {
  const app = { driverName: 'Odo Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T05:00' }));

  head('1. A clean reading: miles come off the odometer, nothing typed');
  let a = await runTrip({ startOdo: 1000, endOdo: 1500, typedMiles: 0 });
  ok('miles derived from the delta', a.trip.actualMiles === 500, `${a.trip.actualMiles} mi`);
  ok('start odometer recorded', a.trip.startOdometer === 1000, `${a.trip.startOdometer}`);
  ok('audit shows the working', /1,000 . 1,500 = 500 mi/.test(mile(a)), mile(a));
  ok('no warning on a good reading', (a.warnings || []).length === 0, warn(a));

  head('2. Deadhead comes off the delta — loaded miles are what is left');
  a = await runTrip({ startOdo: 1500, endOdo: 2100, typedMiles: 0, loaded: 500, deadhead: 100 });
  ok('600 mi run less 100 deadhead = 500 loaded', a.trip.actualMiles === 500, `${a.trip.actualMiles} mi`);
  ok('audit names the deadhead', /less 100 mi deadhead/.test(mile(a)), mile(a));

  head('3. The typed figure is an override and wins');
  a = await runTrip({ startOdo: 2100, endOdo: 2600, typedMiles: 640 });
  ok('override used, not the odometer', a.trip.actualMiles === 640, `${a.trip.actualMiles} mi`);
  ok('audit says it was overridden', /overrode the odometer/.test(mile(a)), mile(a));

  head('4. Odometer did not move');
  a = await runTrip({ startOdo: 2600, endOdo: 2600, typedMiles: 0 });
  ok('warned', /has not moved/.test(warn(a)), warn(a));
  ok('still posted, falling back to dispatched', a.trip.actualMiles === 500, `${a.trip.actualMiles} mi`);
  ok('trip is closed, not blocked', a.trip.status === 'Delivered', a.trip.status);

  head('5. Odometer ran backwards');
  a = await runTrip({ startOdo: 3200, endOdo: 2900, typedMiles: 0 });
  ok('warned', /does not run backwards/.test(warn(a)), warn(a));
  ok('still posted', a.trip.status === 'Delivered', `${a.trip.actualMiles} mi`);

  head('6. A stray digit — 5,000 miles on a 500 mile run');
  a = await runTrip({ startOdo: 4000, endOdo: 9000, typedMiles: 0 });
  ok('warned as implausibly high', /stray digit/.test(warn(a)), warn(a));

  head('7. A missing digit — 50 miles on a 500 mile run');
  a = await runTrip({ startOdo: 9000, endOdo: 9050, typedMiles: 0 });
  ok('warned as short of the run', /well short of the run/.test(warn(a)), warn(a));

  head('8. An override silences the complaint about a bad reading');
  a = await runTrip({ startOdo: 9050, endOdo: 9050, typedMiles: 500 });
  ok('uses what was typed', a.trip.actualMiles === 500, `${a.trip.actualMiles} mi`);

  head('9. The start carries forward from the last close-out');
  // Report a status with no odometer at all; the last trip's ending reading should still be found.
  const boot = await api('/bootstrap');
  const lastEnd = boot.trips.filter((t) => t.endOdometer > 0)
    .sort((x, y) => (y.deliveredGameTime || '').localeCompare(x.deliveredGameTime || ''))[0];
  ok('snapshot exposes a start for the next trip', boot.views.startOdometer === lastEnd.endOdometer,
    `snapshot ${boot.views.startOdometer} vs last close-out ${lastEnd.endOdometer}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
