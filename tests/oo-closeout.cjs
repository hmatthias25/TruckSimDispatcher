/* Owner-Operator 0.9: the Active Load tab's run and close-out, on the company-driver app's pattern. Asked for from play.
 *
 *   - a booked load carries its window and appointment, set the way company dispatch sets them
 *   - at the shipper and at the receiver, the dock answers: straight in, or a time to set the clock to
 *   - an entry logged wrong can be corrected
 *   - the close-out reads the clocks at delivery, measures the dock off the log, and says what it carried forward,
 *     with the game clock moved across the unload and the clocks taken as read
 *   - a late that was not the driver's is said, and not held against them; damaged freight is a claim
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

async function book(day, job) {
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day, time: '06:00' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [job]);
  const S = await api('/bootstrap');
  const b = S.directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  return { S: r.snapshot, broker: b };
}

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'C. Lose', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 1 });

  head('1. Booked, with its window');
  let { S: B1, broker } = await book(3, { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380,
    deadlineHours: 20, appointmentOpensHours: 6 });
  const t = B1.trip;
  ok('the window opens on the receiver\'s clock', !!t.appointmentOpensGameTime && t.appointmentOpensGameTime < t.dueGameTime,
    `${t.appointmentOpensGameTime} -> ${t.dueGameTime}`);
  ok('and either a booked slot inside it, or they take it whenever it turns up',
    t.receiverTakesEarly || (t.appointmentGameTime && t.appointmentGameTime >= t.appointmentOpensGameTime && t.appointmentGameTime <= t.dueGameTime),
    JSON.stringify({ early: t.receiverTakesEarly, slot: t.appointmentGameTime }));
  ok('the run is whole on the snapshot, with the plan it was booked on', t.feasibilityAtDispatch && t.feasibilityAtDispatch.verdict && B1.tripViews);

  head('2. At the docks');
  let r = await api('/run/at-shipper', 'POST', { day: 3, time: '06:30' });
  ok('the shipper answers', r.call && r.call.headline && r.call.instruction, r.call && r.call.headline);
  await api('/run/event', 'POST', { kind: 'BeginLoad', day: 3, time: '06:40' });
  await api('/run/event', 'POST', { kind: 'EndLoad', day: 3, time: '17:15' });
  S = await api('/bootstrap');
  const wrong = S.trip.events.find((e) => e.kind === 'EndLoad');
  r = await api(`/run/event/${wrong.id}`, 'POST', { day: 3, time: '07:15', remove: false });
  ok('a stamp typed with AM and PM the wrong way round, corrected', r.snapshot.trip.events.find((e) => e.kind === 'EndLoad').gameTime.endsWith('07:15'), r.said);
  await api('/run/loaded', 'POST', { day: 3, time: '07:20', odometer: 1000 });
  r = await api('/run/arrived', 'POST', { day: 3, time: '12:30' });
  ok('the receiver answers', r.said && /arrived/.test(r.said), r.said);
  await api('/run/event', 'POST', { kind: 'BeginUnload', day: 3, time: '12:30' });
  await api('/run/event', 'POST', { kind: 'EndUnload', day: 3, time: '13:10' });

  head('3. Closed out, with the clocks as you arrived');
  r = await api('/deliver', 'POST', { day: 3, time: '12:30', odometer: 1070, drive: 9.5, shift: 8, break: 6, cycle: 60, fuelPct: 80 });
  const a = r.audit;
  ok('a summary comes back', a && a.headline && a.serviceFindings.length > 0, a && a.headline);
  ok('the dock times off the log', a.serviceFindings.some((x) => /Unloading 0:40 from the log/.test(x)), a.serviceFindings.find((x) => /Unloading/.test(x)));
  ok('the money said', a.moneyFindings.some((x) => /INV-001/.test(x)) && a.moneyFindings.some((x) => /Broker holding/.test(x)));
  ok('carried forward: where, the clock across the unload, the odometer, the clocks',
    a.clocksReported && a.carriedForward.some((x) => /Topeka, KS/.test(x)) && a.carriedForward.some((x) => /1,070/.test(x))
      && a.carriedForward.some((x) => /Clocks: drive 9:30/.test(x)), JSON.stringify(a.carriedForward));
  S = r.snapshot;
  ok('the game clock is where the unload left it', S.status.gameTime.endsWith('13:10'), S.status.gameTime);
  // Read at the arrival, then carried across the unload, so they stand as of the end of it.
  ok('the clocks are taken as read, and carried across the unload', S.hos.confirmed && S.hos.asOf.endsWith('13:10') && S.hos.carriedForwardFrom === t.number
    && Math.abs(S.hos.shift - (8 - 40 / 60)) < 0.02,
    JSON.stringify({ c: S.hos.confirmed, as: S.hos.asOf, from: S.hos.carriedForwardFrom }));
  ok('the fuel noted', S.status.fuelPct === 80);

  head('4. Late, and not your fault');
  const before = (await api('/bootstrap')).record;
  ({ S: B1 } = await book(4, { cargo: 'Corn', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 390, deadlineHours: 3 }));
  await api('/run/at-shipper', 'POST', { day: 4, time: '06:10' });
  await api('/run/loaded', 'POST', { day: 4, time: '06:30', odometer: 1070 });
  await api('/run/arrived', 'POST', { day: 4, time: '14:00' });
  r = await api('/deliver', 'POST', { day: 4, time: '14:00', odometer: 1140, fault: 'Unavoidable', delayReason: 'closed for construction' });
  ok('late, but not on you', r.audit.trip.serviceResult === 'Late' && /not on you/.test(r.audit.headline) && r.audit.faultAttribution === 'Unavoidable', r.audit.headline);
  const k4 = r.snapshot.bookings.find((x) => x.number === r.audit.trip.number);
  ok('excused, so not held against you', k4.lateExcused && !k4.late && r.snapshot.record.onTimePct === 100, JSON.stringify({ ex: k4.lateExcused, late: k4.late, pct: r.snapshot.record.onTimePct }));
  ok('and the clocks, not given, are marked for a re-read', r.snapshot.hos.confirmed === false);

  head('5. Damaged freight');
  ({ S: B1 } = await book(5, { cargo: 'Glass', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 400, deadlineHours: 20 }));
  const was = B1.directory.find((x) => x.name === B1.booking.brokerName).standing;
  await api('/run/at-shipper', 'POST', { day: 5, time: '06:10' });
  await api('/run/loaded', 'POST', { day: 5, time: '06:30', odometer: 1140 });
  await api('/run/arrived', 'POST', { day: 5, time: '08:00' });
  r = await api('/deliver', 'POST', { day: 5, time: '08:00', odometer: 1210, cargoDamagePct: 12 });
  const now = r.snapshot.directory.find((x) => x.name === B1.booking.brokerName);
  ok('a claim: on the record, and the broker remembers', r.snapshot.record.claims === before.claims + 1 && now.standing < was + 5
    && r.audit.equipmentFindings.some((x) => /cargo damage/.test(x)), `claims ${before.claims} -> ${r.snapshot.record.claims}, standing ${was} -> ${now.standing}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
