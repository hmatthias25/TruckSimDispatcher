/* Being held at a receiver is hours that passed, and the clock has to say so.
 *
 *   "I arrived to a receiver at 7:30 and told them I was there. Was told they couldn't take me until
 *    10:20 and to advance clock to that and unload. Did that and when I went to close out the load the
 *    delivery time was set to 7:30, my arrival time. This should default to the value given to me by the
 *    receiver to unload."
 *
 * Half right, and the half that is wrong is the more interesting one.
 *
 * The field is the ARRIVAL on purpose. TripService says so where it sets it: DeliveredGameTime means
 * arrival, it is what the appointment is judged against, and taking the later figure would charge the
 * receiver's door to the driver's service record — they were there at half past seven and could not make
 * the dock open sooner. Changing that default would hand the driver nearly three hours of lateness that
 * were not theirs.
 *
 * But the CLOCK was genuinely broken, and worse than a wrong default. Close-out sets the game time to the
 * arrival, then moves it on only for a released-at reading or a stated dock time — neither of which knows
 * anything about a wait the app itself ordered. So a driver who did exactly as they were told, advanced
 * to 10:20 and unloaded, had their clock put BACK to 7:30. Everything downstream plans off that moment:
 * the next load's window, its recap, whether it is even legal.
 *
 * Where the truck was is not the same question as what time it is.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const at = (day, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};
const hm = (iso) => (iso || '').slice(11);

let S, odo = 200000;

/** Authorize a load, run it out, and arrive at the stated time. Returns the trip and the arrival call. */
async function runTo(arriveHm, { opensHours } = {}) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', receiver: 'Kroger',
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 0, gameRevenue: 400, deadlineHours: 40,
    weightLbs: 38000, atLocation: true, ...(opensHours ? { appointmentOpensHours: opensHours } : {}),
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: (board.evaluations || [])[0].load.id });
  const call = await api(`/trips/${auth.trip.id}/arrived`, 'POST', { gameTime: at(5, arriveHm) });
  return { trip: auth.trip, call: call.call, after: un(call) };
}

/** Close it out with nothing but the arrival — no released-at, no dock hours. The reported flow. */
async function closeBare(tripId, arriveHm) {
  odo += 110;
  const done = await api(`/trips/${tripId}/complete`, 'POST', {
    deliveredGameTime: at(5, arriveHm), actualMiles: 110, endOdometer: odo, actualRevenue: 400,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(5, arriveHm),
  });
  S = done.snapshot;
  return done.audit;
}

(async () => {
  const app = { driverName: 'V. Brennan', preferredDivision: 'Dry Van', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(4) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: at(5, '05:00'),
    fuelPct: 95, atsOdometer: odo, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. Arrive early and be held');
  // A window that opens well after the truck rolls up, so the receiver genuinely cannot take it.
  const r = await runTo('07:30', { opensHours: 5 });
  console.log(`  ..    ${r.call?.headline || '(no call)'}`);
  console.log(`  ..    arrived ${hm(r.after.trips.find((t) => t.id === r.trip.id)?.arrivedGameTime)}, ` +
              `work starts ${hm(r.after.trips.find((t) => t.id === r.trip.id)?.workStartsGameTime)}`);
  const held = r.after.trips.find((t) => t.id === r.trip.id);
  ok('the arrival is stamped at half past seven', hm(held.arrivedGameTime) === '07:30',
    hm(held.arrivedGameTime));
  ok('and they are told to come back later', held.workStartsGameTime > held.arrivedGameTime,
    `${hm(held.arrivedGameTime)} → ${hm(held.workStartsGameTime)}`);

  head('2. The record keeps the arrival, which is the driver\'s side of it');
  const workStarts = held.workStartsGameTime;
  const audit = await closeBare(r.trip.id, '07:30');
  const closed = S.trips.find((t) => t.id === r.trip.id);
  ok('the delivery time on the trip is the arrival', hm(closed.deliveredGameTime) === '07:30',
    hm(closed.deliveredGameTime));
  ok('so waiting on their door is not charged as lateness',
    closed.serviceResult !== 'Late' || closed.faultAttribution !== 'Driver',
    `${closed.serviceResult} / ${closed.faultAttribution || 'no fault'}`);

  head('3. But the clock does not go backwards over it');
  // The bug. Close-out set the game time to the arrival and only ever moved it on for a released-at
  // reading or a stated dock time, neither of which knows about a hold the app itself ordered.
  console.log(`  ..    clock after close-out: ${hm(S.status.gameTime)} (was told to wait until ${hm(workStarts)})`);
  console.log(`  ..    ${(audit.carriedForward || []).find((x) => /would not take you/i.test(x))?.slice(0, 140) || '(silent)'}`);
  ok('the clock is not back at the arrival', hm(S.status.gameTime) !== '07:30', hm(S.status.gameTime));
  ok('it is at least when they took the truck', S.status.gameTime >= workStarts,
    `${hm(S.status.gameTime)} against ${hm(workStarts)}`);
  ok('and the driver is told why it moved',
    (audit.carriedForward || []).some((x) => /would not take you until/i.test(x)),
    (audit.carriedForward || []).find((x) => /would not take you/i.test(x))?.slice(0, 120) || '(silent)');
  ok('saying plainly whose the waiting was',
    (audit.carriedForward || []).some((x) => /theirs, not yours/i.test(x)), 'said');

  head('4. A dock time on top of the hold lands after both');
  // Held until ten past, then two hours on the dock, is half past twelve — not half past nine.
  const r2 = await runTo('07:30', { opensHours: 5 });
  const held2 = un(await api('/bootstrap')).trips.find((t) => t.id === r2.trip.id);
  odo += 110;
  const done2 = await api(`/trips/${r2.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(5, '07:30'), actualMiles: 110, endOdometer: odo, actualRevenue: 400,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 2, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    unloadAlreadyRan: true,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(5, '07:30'),
  });
  S = done2.snapshot;
  console.log(`  ..    held to ${hm(held2.workStartsGameTime)}, two hours on the dock → ${hm(S.status.gameTime)}`);
  ok('the dock time goes on top of when they took you, not when you arrived',
    S.status.gameTime > held2.workStartsGameTime,
    `${hm(held2.workStartsGameTime)} → ${hm(S.status.gameTime)}`);
  ok('and it is said that way', (done2.audit.carriedForward || []).some((x) => /they took you at/i.test(x)),
    (done2.audit.carriedForward || []).find((x) => /took you at/i.test(x))?.slice(0, 120) || '(silent)');

  head('5. Arriving to an open door changes nothing');
  // The rule only ever fires on a hold. A driver who rolls up and backs straight in has no wait to carry.
  const r3 = await runTo('07:30');
  const straight = un(await api('/bootstrap')).trips.find((t) => t.id === r3.trip.id);
  const same = !straight.workStartsGameTime || straight.workStartsGameTime <= straight.arrivedGameTime;
  console.log(`  ..    arrived ${hm(straight.arrivedGameTime)}, work starts ${hm(straight.workStartsGameTime)}`);
  const a3 = await closeBare(r3.trip.id, '07:30');
  ok('no hold, so nothing is invented about one',
    !same || !(a3.carriedForward || []).some((x) => /would not take you/i.test(x)),
    (a3.carriedForward || []).find((x) => /would not take you/i.test(x)) || 'quiet');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
