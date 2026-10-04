/* Loaded miles off the odometer (reported from play, v0.81).
 *
 *   - an odometer read at the shipper is already past the empty run: the close-out does not take the deadhead off again
 *   - ETS2: a ferry taken where the routing was by land is measured against the road either side of it — no
 *     "well short of the run", the odometer's miles posted, and the planning speed not taught off the land route
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5971}/api`;
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

async function take(o) {
  await api('/status', 'POST', { locationCity: o.from[0], locationState: o.from[1], locationKind: 'TruckStop', gameTime: o.at,
    fuelPct: 95, atsOdometer: o.odo, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  await api('/hos', 'POST', o.hos);
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: o.from[0], originState: o.from[1], destCity: o.to[0], destState: o.to[1], loadedMiles: o.miles,
    deadheadMiles: o.deadhead, gameRevenue: 3000, deadlineHours: 72, weightLbs: 40000 }));
  const d = await api('/board/evaluate');
  const pick = (d.evaluations || []).find((e) => e.recommendation === 'Authorize') || (d.evaluations || [])[0];
  const r = await api('/dispatch/authorize', 'POST', { loadId: pick?.load?.id || (added.board || [])[0]?.id });
  return r.trip || (un(r).trips || [])[0];
}
const close = async (trip, body) => {
  const r = await api(`/trips/${trip.id}/complete`, 'POST', { truckDamageAfter: 2, trailerDamageAfter: 2, ...body });
  return { done: (un(r).trips || []).find((x) => x.id === trip.id), audit: r.audit || {} };
};

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const hos = { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: '2000-01-03T06:00',
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false };

  head('1. Odometer read at the shipper: the deadhead is not taken off twice');
  let trip = await take({ from: ['Munich', 'DE'], to: ['Verona', 'IT'], at: '2000-01-03T06:00', odo: 1000, miles: 170, deadhead: 40, hos });
  await api(`/trips/${trip.id}/loaded`, 'POST', { weightLbs: 40000, odometer: 1040, pulledOutGameTime: '2000-01-03T08:00' });
  let c = await close(trip, { deliveredGameTime: '2000-01-03T13:00', endOdometer: 1215 });
  ok('loaded is the odometer from the shipper: 175', c.done.actualMiles === 175, `${c.done.actualMiles} loaded, ${c.done.deadheadMiles} empty`);
  ok('and the empty run is still paid as measured', c.done.deadheadMiles === 40);

  head('2. A ferry where the routing was by land: Rome to Mostar over Bari – Dubrovnik');
  const speedBefore = (await api('/export')).settings.speedFactor;
  trip = await take({ from: ['Rome', 'IT'], to: ['Mostar', 'BA'], at: '2000-01-04T12:00', odo: 3000, miles: 969, deadhead: 0,
    hos: { ...hos, asOfGameTime: '2000-01-04T12:00' } });
  await api(`/trips/${trip.id}/loaded`, 'POST', { weightLbs: 40000, odometer: 3000, pulledOutGameTime: '2000-01-04T13:00' });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Ferry', gameTime: '2000-01-05T11:00', endGameTime: '2000-01-05T19:00',
    ferryRoute: 'bari-dubrovnik', cabin: true, cost: 0, detail: '' });
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: '2000-01-05T21:00' });
  // About 340 mi of road: Rome to Bari, and Dubrovnik to Mostar.
  c = await close(trip, { deliveredGameTime: '2000-01-05T21:00', endOdometer: 3340 });
  const all = JSON.stringify(c.audit);
  ok('no "well short of the run"', !/well short/.test(all), all.match(/[^"]*well short[^"]*/)?.[0] || '');
  ok('the odometer\'s miles are posted, not the land route\'s', c.done.actualMiles === 340, `${c.done.actualMiles}`);
  ok('and the audit says the crossing is why', /You crossed by Bari – Dubrovnik/.test(all), (all.match(/You crossed[^"]*/) || [''])[0].slice(0, 160));
  const speedAfter = (await api('/export')).settings.speedFactor;
  ok('the planning speed is not taught off the land route\'s miles', speedAfter <= Math.max(speedBefore, 0.9), `${speedBefore} -> ${speedAfter}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
