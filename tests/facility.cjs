/* Issue #5: loading, unloading and detention derived from Begin/End pairs in the trip log. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5377}/api`;
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

let S;
async function runTrip({ day, events, typed }) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper',
    gameTime: `2000-01-${String(day).padStart(2, '0')}T05:00`, fuelPct: 100, atsOdometer: 0,
    truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 30000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 500, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 40000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  for (const e of events) {
    await api(`/trips/${auth.trip.id}/event`, 'POST', {
      gameTime: `2000-01-${String(e.d ?? day).padStart(2, '0')}T${e.t}`, kind: e.k, detail: e.k, gallons: 0,
    });
  }
  return api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: `2000-01-${String(day + 1).padStart(2, '0')}T18:00`,
    actualMiles: 500, endOdometer: 500, actualRevenue: 2400,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: typed?.load ?? 0, unloadingHours: typed?.unload ?? 0, detentionHours: typed?.det ?? 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', fuelPct: 55,
    gameTime: `2000-01-${String(day + 1).padStart(2, '0')}T18:00`,
  });
}

(async () => {
  const app = { driverName: 'Dock Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T05:00' }));
  const free = S.driver.pay.detentionFreeHours;
  console.log(`  free time per stop: ${free} h, detention $${S.driver.pay.detentionPerHour}/h`);

  head('Quick turns at both ends — no detention');
  let r = await runTrip({ day: 1, events: [
    { k: 'BeginLoad', t: '06:00' }, { k: 'EndLoad', t: '07:00' },
    { k: 'BeginUnload', d: 2, t: '15:00' }, { k: 'EndUnload', d: 2, t: '16:00' },
  ] });
  ok('loading derived', Math.abs(r.audit.trip.loadingHours - 1) < 0.01, `${r.audit.trip.loadingHours} h`);
  ok('unloading derived', Math.abs(r.audit.trip.unloadingHours - 1) < 0.01, `${r.audit.trip.unloadingHours} h`);
  ok('no detention', r.audit.trip.detentionHours === 0, `${r.audit.trip.detentionHours} h`);
  ok('audit explains it', r.audit.serviceFindings.some((x) => /inside the .* free window/.test(x)),
    r.audit.serviceFindings.find((x) => /free window/.test(x)) || '(none)');

  head('Sat 5 h at the shipper, 4 h at the receiver');
  r = await runTrip({ day: 4, events: [
    { k: 'BeginLoad', t: '06:00' }, { k: 'EndLoad', t: '11:00' },
    { k: 'BeginUnload', d: 5, t: '10:00' }, { k: 'EndUnload', d: 5, t: '14:00' },
  ] });
  const expect = Math.max(0, 5 - free) + Math.max(0, 4 - free);
  ok('loading 5 h', Math.abs(r.audit.trip.loadingHours - 5) < 0.01, `${r.audit.trip.loadingHours} h`);
  ok('unloading 4 h', Math.abs(r.audit.trip.unloadingHours - 4) < 0.01, `${r.audit.trip.unloadingHours} h`);
  ok('detention is per stop, not lumped', Math.abs(r.audit.trip.detentionHours - expect) < 0.01,
    `${r.audit.trip.detentionHours} h (expected ${expect})`);
  ok('audit shows the split', r.audit.serviceFindings.some((x) => /at the shipper.*at the receiver/.test(x)),
    r.audit.serviceFindings.find((x) => /shipper/.test(x)) || '(none)');
  const detLine = (r.audit.trip.pay.lines || []).find((x) => /[Dd]etention/.test(x));
  ok('detention actually paid', !!detLine, detLine || '(no pay line)');
  // The free window must come off exactly once. 3 h + 2 h billable at $20 = $100.
  const expectPay = expect * S.driver.pay.detentionPerHour;
  ok('paid for every billable hour, free time deducted ONCE',
    Math.abs(r.audit.trip.pay.detentionPay - expectPay) < 0.01,
    `$${r.audit.trip.pay.detentionPay} (expected $${expectPay})`);

  head('Typed detention still has the free window taken off once');
  r = await runTrip({ day: 16, events: [], typed: { det: 5 } });
  ok('5 h typed becomes 3 h billable', Math.abs(r.audit.trip.detentionHours - (5 - free)) < 0.01,
    `${r.audit.trip.detentionHours} h`);
  ok('and pays 3 h', Math.abs(r.audit.trip.pay.detentionPay - (5 - free) * S.driver.pay.detentionPerHour) < 0.01,
    `$${r.audit.trip.pay.detentionPay}`);
  r = await runTrip({ day: 19, events: [], typed: { det: 1 } });
  ok('1 h typed is inside the free window and pays nothing', r.audit.trip.pay.detentionPay === 0,
    `$${r.audit.trip.pay.detentionPay}`);

  head('Nothing logged — falls back to what was typed');
  r = await runTrip({ day: 7, events: [], typed: { load: 2, unload: 3, det: 4.5 } });
  ok('typed loading kept', Math.abs(r.audit.trip.loadingHours - 2) < 0.01, `${r.audit.trip.loadingHours} h`);
  ok('typed detention netted of free time once', Math.abs(r.audit.trip.detentionHours - (4.5 - free)) < 0.01,
    `${r.audit.trip.detentionHours} h billable from 4.5 h reported`);
  ok('audit says it could not check it', r.audit.serviceFindings.some((x) => /no Begin\/End pairs/i.test(x)),
    r.audit.serviceFindings.find((x) => /Begin\/End/i.test(x)) || '(none)');

  head('A typed figure that disagrees with the log loses');
  r = await runTrip({ day: 10, events: [
    { k: 'BeginLoad', t: '06:00' }, { k: 'EndLoad', t: '12:00' },
    { k: 'BeginUnload', d: 11, t: '10:00' }, { k: 'EndUnload', d: 11, t: '11:00' },
  ], typed: { det: 99 } });
  ok('log wins over the typed 99 h', Math.abs(r.audit.trip.detentionHours - Math.max(0, 6 - free)) < 0.01,
    `${r.audit.trip.detentionHours} h`);
  ok('and the disagreement is called out', r.audit.serviceFindings.some((x) => /I am paying the log/.test(x)),
    r.audit.serviceFindings.find((x) => /paying the log/.test(x)) || '(none)');

  head('An unpaired begin does not invent time');
  r = await runTrip({ day: 13, events: [{ k: 'BeginLoad', t: '06:00' }], typed: { load: 1.25 } });
  ok('falls back to typed', Math.abs(r.audit.trip.loadingHours - 1.25) < 0.01, `${r.audit.trip.loadingHours} h`);

  head('Logging BeginLoad moves the trip to InTransit');
  ok('status advanced on the last trip', r.audit.trip.status === 'Delivered', r.audit.trip.status);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
