/* Road miles as actually driven (asked for from play, v0.86): "we estimate until we have the actual mileage, based on
 * odometer, then the next loads between points will be more accurate." A load planned on a distance that came up short
 * missed its appointment.
 *
 *   - a closed-out load records what the odometer said the road was
 *   - the next load on that road is planned at the driven distance where the listing is shorter, and says so
 *   - the app's own estimate for the pair — an empty move with no distance given — uses it too
 *   - a reading shorter than the straight line is a typo and is not kept
 *   - a road not driven yet is planned the way the driven ones came out, once there are three
 *   - on an ATS career and an ETS2 one
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

// The fixture's clock runs in hours from day 2, so an EU driver who never logs a weekly rest stays inside the week.
let hour = 0, odo = 1000;
const now = () => { const d = 2 + Math.floor(hour / 24), m = hour % 24; return iso(d, `${String(m).padStart(2, '0')}:00`); };
const tick = (h = 1) => { const t = now(); hour += h; return t; };
async function at(p, gameTime, eu) {
  await api('/status', 'POST', { locationCity: p.city, locationState: p.state, locationKind: 'Shipper', gameTime,
    fuelPct: 100, atsOdometer: odo, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', eu
    ? { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: gameTime, euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false }
    : { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
}

/** One load from A to B, listed at `listed` miles, the odometer reading `driven` across it. */
async function run(A, Bp, listed, driven, eu) {
  const t0 = tick(3);
  await at(A, t0, eu);
  await api('/board/clear', 'POST', {});
  const b = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: A.city, originState: A.state, destCity: Bp.city, destState: Bp.state,
    loadedMiles: listed, deadheadMiles: 0, gameRevenue: 900, weightLbs: 30000, atLocation: true, deadlineHours: 48 });
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: b.evaluations[0].load.id, overrideTight: true })).trip;
  await api(`/trips/${trip.id}/loaded`, 'POST', { odometer: odo, weightLbs: 30000 });
  odo += driven;
  const done = await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: now(), endOdometer: odo,
    actualMiles: driven, truckDamageAfter: 1, trailerDamageAfter: 1 });
  // Operations now and then parks a driver after a close-out (an operational rest, seeded on the trip number). Not
  // what this suite is about, so any order it raises is stood down, as the other suites do.
  const st = await api('/export');
  if ((st.restartOrders || []).some((o) => o.status !== 'Completed')) { st.restartOrders = []; await api('/import', 'POST', st); }
  return done;
}

async function story(name, eu, A, Bp, km, extra) {
  const u = (mi) => (km ? `${Math.round(mi * 1.609344)} km` : `${Math.round(mi)} mi`);
  head(`${name}: 1. A load that drove longer than its listing`);
  const done = await run(A, Bp, 100, 140, eu);
  ok('the close-out says the road was recorded', (done.audit.serviceFindings || []).some((f) => /Driven distance recorded/.test(f)),
    (done.audit.serviceFindings || []).find((f) => /Driven distance/.test(f)) || '(silent)');
  const legs = ((await api('/bootstrap')).views.roadLegs || {}).roads || [];
  const leg = legs.find((l) => l.a.startsWith(A.city) || l.b.startsWith(A.city));
  ok('the pair is in the table at what was driven', leg && Math.abs(leg.miles - 140) < 0.5, leg ? `${leg.a} ↔ ${leg.b} ${u(leg.miles)}` : 'none');

  head(`${name}: 2. The next load on that road is planned at the driven distance`);
  await at(A, tick(), eu);
  await api('/board/clear', 'POST', {});
  const b = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: A.city, originState: A.state, destCity: Bp.city, destState: Bp.state,
    loadedMiles: 100, deadheadMiles: 0, gameRevenue: 900, weightLbs: 30000, atLocation: true, deadlineHours: 48 });
  const f = b.evaluations[0].feasibility;
  const drive = (f.timeline || []).filter((x) => x.kind === 'Drive').reduce((a, x) => a + x.miles, 0);
  ok('planned at 140, not the listing\'s 100', Math.abs(drive - 140) < 1, u(drive));
  ok('and the plan says why', (f.warnings || []).some((w) => /what you actually drove/.test(w)), (f.warnings || []).find((w) => /drove/.test(w)) || '(silent)');

  head(`${name}: 3. The app's own estimate uses it too`);
  const mv = await api('/moves', 'POST', { destCity: Bp.city, destState: Bp.state, miles: 0, reason: 'fixture', kind: 'EmptyMove' });
  ok('an empty move with no distance given is measured at the driven 140', Math.abs(mv.trip.deadheadMiles - 140) < 0.5, u(mv.trip.deadheadMiles));
  await api(`/trips/${mv.trip.id}/cancel`, 'POST', { reason: 'fixture', fault: 'GameLimitation' }).catch(() => {});

  head(`${name}: 4. A reading shorter than the straight line is a typo, not a road`);
  const before = (((await api('/bootstrap')).views.roadLegs || {}).roads || []).find((l) => l.a.startsWith(A.city) || l.b.startsWith(A.city));
  await run(A, Bp, 100, 5, eu);
  const after = (((await api('/bootstrap')).views.roadLegs || {}).roads || []).find((l) => l.a.startsWith(A.city) || l.b.startsWith(A.city));
  ok('not kept', after.runs === before.runs && Math.abs(after.miles - 140) < 0.5, `${after.runs} run(s), ${u(after.miles)}`);

  head(`${name}: 5. Roads not driven yet are planned the way the driven ones came out`);
  // The app's own figure for a pair, read off an empty move with no distance given, then stood down.
  // On the fixture's hourly clock, so the week does not run into a weekly rest.
  const estimate = async (P) => {
    await at(A, tick(), eu);
    const mv = await api('/moves', 'POST', { destCity: P.city, destState: P.state, miles: 0, reason: 'fixture', kind: 'EmptyMove' });
    await api(`/trips/${mv.trip.id}/cancel`, 'POST', { reason: 'fixture', fault: 'GameLimitation' }).catch(() => {});
    return mv.trip.deadheadMiles;
  };
  const neverBefore = await estimate(extra.C);
  // Two more roads, each driven at half as long again as the estimate: with the first, three roads and a factor.
  for (const P of [extra.B2, extra.B3]) { const e = await estimate(P); await run(A, P, e, e * 1.5, eu); }
  const v = (await api('/bootstrap')).views.roadLegs;
  ok('a factor is learned from three roads', v.factor != null && Math.abs(v.factor - 1.5) < 0.05, `${v.factor}`);
  const now = await estimate(extra.C);
  ok(`${extra.C.city}, never driven, is planned at 1.5× what it was`, Math.abs(now - neverBefore * 1.5) < 2, `${u(neverBefore)} → ${u(now)}`);
}

(async () => {
  const us = { driverName: 'R. Oad', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', us);
  await api('/onboarding/hire', 'POST', { application: us, force: true, gameTime: iso(1, '06:00') });
  await story('ATS', false, { city: 'Denver', state: 'CO' }, { city: 'Pueblo', state: 'CO' }, false,
    { B2: { city: 'Colorado Springs', state: 'CO' }, B3: { city: 'Fort Collins', state: 'CO' }, C: { city: 'Grand Junction', state: 'CO' } });

  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: false });
  hour = 0; odo = 1000;
  const eu = { driverName: 'R. Strasse', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', eu);
  await api('/onboarding/hire', 'POST', { application: eu, force: true, gameTime: iso(1, '06:00') });
  await story('ETS2', true, { city: 'Mannheim', state: 'DE' }, { city: 'Stuttgart', state: 'DE' }, true,
    { B2: { city: 'Würzburg', state: 'DE' }, B3: { city: 'Karlsruhe', state: 'DE' }, C: { city: 'Fulda', state: 'DE' } });
  // Fulda rather than Nürnberg: a game city is on the road table (v0.87), measured, and a learned factor corrects
  // only a straight-line estimate.

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
