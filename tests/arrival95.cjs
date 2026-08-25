/* Issue #95 — the delivery time was the end of the unload, not the arrival.
 *
 * Reported from a real career: an 11:00 appointment, arrived 12:30 — inside the grace, on time — logged
 * Begin unload 12:30 and End unload 14:20, and was charged a LATE LOAD delivered at 14:20.
 *
 * DeliveredGameTime has always MEANT arrival: it is what the appointment is judged against and what dock
 * time is measured from. But the close-out form prefills it with the clock as it stands, which for
 * anybody who logs Begin/End unload is the clock after the unload. However long the dock took was being
 * counted as lateness — the receiver's time charged to the driver, who was there on time and could not
 * make the dock go any faster.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5965}/api`;
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

const iso = (day, hm) => `2000-01-${String(day).padStart(2, '0')}T${hm}`;
// Game timestamps are "YYYY-MM-DDTHH:MM" with no zone. Shift one by a number of hours.
const plus = (stamp, hours) => {
  const d = new Date(stamp + ':00Z');
  d.setUTCMinutes(d.getUTCMinutes() + Math.round(hours * 60));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
const gap = (a, b) => (new Date(b + ':00Z') - new Date(a + ':00Z')) / 3600000;

let S, day = 2, grace = 2, lateTrip = '';

async function place(hm) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  return S;
}

/** Every receiver keeps to its appointment, so the slot is always there to be measured against. */
async function setEarlyPct(pct) {
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, receiverTakesEarlyPct: pct });
}

/** A short run, authorized, with whatever slot the engine books for it. */
async function run(opensHours = 3, deadlineHours = 14) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
    loadedMiles: 22, deadheadMiles: 0, gameRevenue: 900, deadlineHours,
    weightLbs: 24000, appointmentOpensHours: opensHours,
  });
  const e = r.evaluations[0];
  const auth = await api('/dispatch/authorize', 'POST', { loadId: e.load.id, overrideTight: true });
  return auth.trip;
}

const log = (id, kind, stamp) => api(`/trips/${id}/event`, 'POST', { kind, gameTime: stamp, note: '' });

async function close(id, closedAt, extra = {}) {
  return api(`/trips/${id}/complete`, 'POST', {
    deliveredGameTime: closedAt, actualMiles: 22, endOdometer: 5022, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Aurora', locationState: 'CO', fuelPct: 70, gameTime: closedAt,
    ...extra,
  });
}

const findings = (done) => (done.audit.serviceFindings || []).join(' | ');
const tripOf = (done, id) => done.snapshot.trips.find((x) => x.id === id);

(async () => {
  const app = { driverName: 'A. Rival', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1, '06:00'), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  grace = (await api('/bootstrap')).settings.appointmentGraceHours ?? 2;
  await setEarlyPct(0);
  console.log(`     appointment grace: ${grace}h · every receiver keeps to its slot`);

  head('1. The reported case — late to the slot but inside the grace, then a slow dock');
  await place('06:00');
  let trip = await run();
  const slot = trip.appointmentGameTime;
  ok('the load has a booked slot', !!slot, slot || '(none)');

  // Arrive inside the grace, exactly as reported: an hour and a half past the appointment.
  const arrived = plus(slot, Math.min(1.5, grace - 0.25));
  const released = plus(arrived, 1 + 50 / 60);            // 1:50 on the dock, as reported
  await log(trip.id, 'BeginUnload', arrived);
  await log(trip.id, 'EndUnload', released);
  console.log(`     slot ${slot} · arrived ${arrived} · off the dock ${released}`);

  // The close-out form prefills the clock as it stands, which by now is after the unload.
  let done = await close(trip.id, released);
  let t = tripOf(done, trip.id);
  ok('delivery is recorded at the arrival, not the release',
    t.deliveredGameTime === arrived, `${t.deliveredGameTime} (arrived ${arrived})`);
  ok('and it is ON TIME', t.serviceResult === 'OnTime', t.serviceResult);
  ok('the report explains the swap rather than doing it silently',
    /Begin unload/i.test(findings(done)),
    (done.audit.serviceFindings || []).find((x) => /Begin unload/i.test(x))?.slice(0, 120) || '(none)');
  ok('it says whose time the dock is',
    /receiver's, not yours/i.test(findings(done)), 'wording');
  ok('no late note on the safety file',
    !(un(done).incidents || []).some((i) => i.kind === 'Late' && i.tripNumber === t.number), 'clean');

  head('2. The clock still ends up after the unload — that part was never wrong');
  ok('the game clock is carried forward to the release',
    un(done).status.gameTime === released, un(done).status.gameTime);
  ok('and the dock time is measured off the log, not guessed',
    Math.abs(t.unloadingHours - (1 + 50 / 60)) < 0.02, `${t.unloadingHours?.toFixed?.(2)}h`);

  head('3. Genuinely late on arrival is still late');
  day += 1;
  await place('06:00');
  trip = await run();
  const lateArrival = plus(trip.appointmentGameTime, grace + 1);
  await log(trip.id, 'BeginUnload', lateArrival);
  await log(trip.id, 'EndUnload', plus(lateArrival, 1.5));
  done = await close(trip.id, plus(lateArrival, 1.5));
  t = tripOf(done, trip.id);
  lateTrip = t.number;
  ok('arrival is still read off the log', t.deliveredGameTime === lateArrival, t.deliveredGameTime);
  ok('and being late on arrival is late', t.serviceResult === 'Late', t.serviceResult);
  ok('the driver is told by how much', /LATE|past the slot/i.test(findings(done)),
    (done.audit.serviceFindings || []).find((x) => /LATE|past the slot/i.test(x))?.slice(0, 110) || '(none)');

  head('4. Arriving earlier than you logged is kept — a queue is not the dock');
  day += 1;
  await place('06:00');
  trip = await run();
  const backedIn = plus(trip.appointmentGameTime, 0.5);
  const onProperty = plus(backedIn, -0.5);            // sat in the queue half an hour
  await log(trip.id, 'BeginUnload', backedIn);
  await log(trip.id, 'EndUnload', plus(backedIn, 1.5));
  done = await close(trip.id, onProperty);
  t = tripOf(done, trip.id);
  ok('the earlier reported time wins over the log',
    t.deliveredGameTime === onProperty, `${t.deliveredGameTime} (typed ${onProperty}, logged ${backedIn})`);
  ok('and nothing is said about it, because nothing was corrected',
    !/Begin unload/i.test(findings(done)), 'quiet');

  head('5. No unload logged: what you type is what stands');
  day += 1;
  await place('06:00');
  trip = await run();
  const typed = plus(trip.appointmentGameTime, 0.25);
  done = await close(trip.id, typed, { unloadingHours: 1.5 });
  t = tripOf(done, trip.id);
  ok('the typed time is used, as before', t.deliveredGameTime === typed, t.deliveredGameTime);
  ok('and it is on time', t.serviceResult === 'OnTime', t.serviceResult);

  head('6. A load the receiver takes whenever is unaffected either way');
  day += 1;
  await place('06:00');
  await setEarlyPct(100);
  trip = await run(0, 20);
  ok('this one has no slot to miss', trip.receiverTakesEarly === true, `${trip.receiverTakesEarly}`);
  const got = iso(day, '10:00');
  await log(trip.id, 'BeginUnload', got);
  await log(trip.id, 'EndUnload', plus(got, 2));
  done = await close(trip.id, plus(got, 2));
  t = tripOf(done, trip.id);
  ok('arrival still comes off the log', t.deliveredGameTime === got, t.deliveredGameTime);
  ok('and it is on time', t.serviceResult === 'OnTime', t.serviceResult);

  await setEarlyPct(0);

  head('7. Nothing re-judges itself on reload');
  // The migration runs LateByTheClock, the same rule the close-out runs. If those ever diverged, a
  // reload would quietly restate history — so the check is that it does not move.
  const read = async () => (await api('/bootstrap')).trips
    .filter((x) => x.kind === 'Freight' && x.status === 'Delivered')
    .map((x) => `${x.number}:${x.deliveredGameTime}:${x.serviceResult}`).join(' | ');
  const before = await read();
  const after = await read();
  ok('every closed load reads the same twice', before === after, `${before.split(' | ').length} load(s)`);
  const lates = before.split(' | ').filter((x) => /Late$/.test(x));
  ok('exactly one of them is late, and it is the one that arrived late',
    lates.length === 1 && lates[0].startsWith(lateTrip), `${lates.join(', ') || 'none'} (expected ${lateTrip})`);

  head('8. The migration reaches a career that already carries the bad marks');
  // Build the career this bug actually produced: delivery recorded at the end of the unload, the trip
  // marked Late, a late note on the safety file — then wind the schema back and bring it in.
  const raw = await api('/export');
  const victim = raw.trips.find((x) => x.serviceResult === 'OnTime'
    && x.events.some((e) => e.kind === 'EndUnload')
    && x.events.some((e) => e.kind === 'BeginUnload'));
  const arrivalWas = victim.deliveredGameTime;
  const endUnload = victim.events.find((e) => e.kind === 'EndUnload').gameTime;

  victim.deliveredGameTime = endUnload;          // what the old close-out wrote
  victim.serviceResult = 'Late';
  raw.incidents.unshift({
    number: 'INC-9001', kind: 'Late', tripNumber: victim.number, gameTime: endUnload,
    description: `Late delivery on ${victim.number} - bad mark from the arrival bug.`,
    faultAttribution: 'Driver', severity: 'Minor', preventable: false,
    locationCity: 'Aurora', locationState: 'CO',
  });
  raw.schemaVersion = 10;

  const back = await api('/import', 'POST', raw);
  const fixed = (back.trips || []).find((x) => x.number === victim.number);
  ok('the delivery time is put back to the arrival',
    fixed.deliveredGameTime === arrivalWas, `${fixed.deliveredGameTime} (was ${endUnload})`);
  ok('and the load goes back to on time', fixed.serviceResult === 'OnTime', fixed.serviceResult);
  ok('the late note is off the safety file',
    !(back.incidents || []).some((i) => i.number === 'INC-9001'),
    `${(back.incidents || []).filter((i) => i.kind === 'Late').length} late note(s) left`);
  ok('the schema is moved on so it runs once', back.schemaVersion >= 11, `v${back.schemaVersion}`);
  ok('and the career log says what was changed and why',
    (back.events || []).some((e) => /Corrected the delivery time/i.test(e.message || '')),
    (back.events || []).find((e) => /Corrected the delivery time/i.test(e.message || ''))?.message?.slice(0, 150) || '(none)');

  head('9. A load that is late on the corrected time is left alone');
  const raw2 = await api('/export');
  const genuine = raw2.trips.find((x) => x.number === lateTrip);
  const trueArrival = genuine.deliveredGameTime;
  genuine.deliveredGameTime = genuine.events.find((e) => e.kind === 'EndUnload').gameTime;
  genuine.serviceResult = 'Late';
  raw2.schemaVersion = 10;

  const back2 = await api('/import', 'POST', raw2);
  const still = (back2.trips || []).find((x) => x.number === lateTrip);
  ok('its delivery time is corrected too', still.deliveredGameTime === trueArrival, still.deliveredGameTime);
  ok('but it stays LATE, because it really was', still.serviceResult === 'Late', still.serviceResult);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
