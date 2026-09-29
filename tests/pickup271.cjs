/* #271 - the pickup gets the delivery's arrival.
 *
 * Asked from play:
 *   1. no appointment at a pickup (and none wanted) - a range. The player just reports being at the shipper
 *   2. picking up where they just dropped is not reported - it is the end of that unload
 *   3. they are told when they can load, immediately or held (not ready, running behind), the way the
 *      receiver tells them
 *   4. the wait counts as detention, along with the loading
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
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
function plus(isoTime, hours) {
  const d = new Date(Date.parse(isoTime + ':00Z') + hours * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` +
         `T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const hoursBetween = (a, b) => (Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 3600000;

let FREE = 2, QFREE = 0.5;

/** Take one load out of `from` and return the trip. */
async function take(day, { from = ['Wichita', 'KS'], to = ['Topeka', 'KS'], shipper = 'Prairie Mill',
                           receiver = 'Midwest Steel', atLocation = false, hm = '06:00' } = {}) {
  await api('/status', 'POST', {
    locationCity: from[0], locationState: from[1], locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 95, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  const state = await api('/export');
  if ((state.restartOrders || []).some((o) => o.status !== 'Complete')) {
    state.restartOrders = [];
    await api('/import', 'POST', state);
  }
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed', shipper, receiver,
    originCity: from[0], originState: from[1], destCity: to[0], destState: to[1],
    loadedMiles: 130, deadheadMiles: 0, gameRevenue: 1800, deadlineHours: 40,
    weightLbs: 42000, atLocation, appointmentOpensHours: 3,
  }));
  const d = await api('/board/evaluate');
  const pick = (d.evaluations || []).find((e) => e.recommendation === 'Authorize') || (d.evaluations || [])[0];
  if (!pick) { console.log(`  ..    no load on day ${day}: ${(d.headline || '').slice(0, 80)}`); return null; }
  const r = await api('/dispatch/authorize', 'POST', { loadId: pick.load?.id || (added.board || [])[0]?.id });
  return r.trip || (un(r).trips || [])[0];
}

async function close(trip, deliveredAt) {
  const r = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: deliveredAt, endOdometer: 90130, actualMiles: 130,
    truckDamageAfter: 2, trailerDamageAfter: 2,
  });
  const done = (un(r).trips || []).find((x) => x.id === trip.id);
  return { done, findings: (r.audit?.serviceFindings || []).join(' || ') };
}
const logEvent = (trip, kind, gameTime) => api(`/trips/${trip.id}/event`, 'POST', { kind, gameTime });
const tripOf = async (id) => ((await api('/bootstrap')).trips || []).find((t) => t.id === id)
  || ((await api('/export')).trips || []).find((t) => t.id === id);

(async () => {
  const app = { driverName: 'R. Okafor', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const boot = await api('/bootstrap');
  FREE = boot.driver?.pay?.detentionFreeHours ?? 2;
  QFREE = boot.driver?.pay?.queueFreeHours ?? 0.5;
  console.log(`  ..    free ${hhmm(FREE)} for work, ${hhmm(QFREE)} for waiting`);

  head('1. Reporting at the shipper gets an answer, once');
  let trip = await take(10);
  ok('a load was authorized', !!trip, trip?.number);
  ok('and nobody has said they are at the shipper yet', !trip.shipperArrivedGameTime);
  const arrive = iso(10, '11:00');
  const r1 = await api(`/trips/${trip.id}/at-shipper`, 'POST', { gameTime: arrive });
  console.log(`  ..    ${r1.call.headline} | ${r1.call.instruction.slice(0, 140)}`);
  ok('it answers with a headline and an instruction', !!r1.call.headline && !!r1.call.instruction);
  ok('and a time the freight goes on, not before the arrival',
    r1.call.workStartsGameTime >= arrive, r1.call.workStartsGameTime);
  ok('there is no appointment in it', !/appointment|slot/i.test(r1.call.instruction), r1.call.instruction.slice(0, 80));
  let stored = await tripOf(trip.id);
  ok('the answer is on the trip', stored.shipperArrivedGameTime === arrive && stored.loadStartsGameTime === r1.call.workStartsGameTime,
    `${stored.shipperArrivedGameTime} -> ${stored.loadStartsGameTime}`);
  ok('and it was reported, not assumed', stored.shipperArrivalAuto === false);
  let refused = null;
  try { await api(`/trips/${trip.id}/at-shipper`, 'POST', { gameTime: plus(arrive, -3) }); } catch (e) { refused = e; }
  ok('a second report cannot shop for freight that is ready', !!refused, refused?.message?.slice(0, 80));
  await logEvent(trip, 'BeginLoad', r1.call.workStartsGameTime);
  await logEvent(trip, 'EndLoad', plus(r1.call.workStartsGameTime, 1));
  await close(trip, plus(r1.call.workStartsGameTime, 5));

  head('2. The wait is detention, with the loading');
  // Whatever the shipper rolled, the pay has to be the arithmetic on what it said: from their clock to
  // the end of the loading, the waiting part with the queue allowance and the work with the standard one.
  const found = [];
  for (let day = 11; day <= 24 && found.length < 1; day++) {
    const t = await take(day);
    if (!t) continue;
    const r = await api(`/trips/${t.id}/at-shipper`, 'POST', { gameTime: iso(day, '10:00') });
    if (r.call.waitHours > QFREE + 0.25) { found.push({ t, call: r.call, day }); break; }
    // Not held long enough to matter — run it anyway so the day moves on, and try the next.
    await logEvent(t, 'BeginLoad', r.call.workStartsGameTime);
    await logEvent(t, 'EndLoad', plus(r.call.workStartsGameTime, 1));
    const c = await close(t, plus(r.call.workStartsGameTime, 5));
    if (r.call.waitHours < 0.01)
      ok(`straight in (day ${day}) — loading alone is the shipper's time`, c.done.detentionHours === 0, hhmm(c.done.detentionHours));
  }
  ok('some pickup in two weeks was held long enough to pay', found.length === 1);
  if (found.length) {
    const { t, call } = found[0];
    console.log(`  ..    ${call.headline} — waited ${hhmm(call.waitHours)}`);
    const starts = call.workStartsGameTime;
    await logEvent(t, 'BeginLoad', starts);
    await logEvent(t, 'EndLoad', plus(starts, 2.5));
    const st = await tripOf(t.id);
    const clock = st.shipperClockFromGameTime || st.shipperArrivedGameTime;
    const on = hoursBetween(clock, plus(starts, 2.5));
    const waited = hoursBetween(clock, starts);
    const expected = Math.max(0, (on - waited) - FREE) + Math.max(0, waited - QFREE);
    const c = await close(t, plus(starts, 6));
    console.log(`  ..    on their property ${hhmm(on)}, ${hhmm(waited)} waiting -> detention ${hhmm(c.done.detentionHours)}`);
    ok('detention is the wait and the loading, each against its own allowance',
      Math.abs(c.done.detentionHours - expected) < 0.02, `${hhmm(c.done.detentionHours)} vs ${hhmm(expected)}`);
    ok('the audit names the shipper wait', /waiting for the freight/.test(c.findings),
      (c.findings.match(/At the shipper[^|]*/) || ['(no line)'])[0].slice(0, 120));
    ok('and pays more than the loading alone would have', c.done.detentionHours > Math.max(0, 2.5 - FREE));
  }

  head('3. Picking up where you dropped is not reported');
  let first = await take(26, { receiver: 'Midwest Steel' });
  ok('a load into Midwest Steel, Topeka', !!first, first?.number);
  await api(`/trips/${first.id}/arrived`, 'POST', { gameTime: iso(27, '09:00') });
  const f1 = await tripOf(first.id);
  const unloadAt = f1.workStartsGameTime || iso(27, '09:00');
  await logEvent(first, 'BeginUnload', unloadAt);
  await logEvent(first, 'EndUnload', plus(unloadAt, 1.25));
  await close(first, iso(27, '09:00'));
  const reload = await take(27, { from: ['Topeka', 'KS'], to: ['Wichita', 'KS'], shipper: 'Midwest Steel',
                                  receiver: 'Prairie Mill', hm: plus(unloadAt, 2).slice(11) });
  ok('a reload out of the same place', !!reload, reload?.number);
  ok('the arrival was set for them', reload.shipperArrivalAuto === true, String(reload.shipperArrivalAuto));
  ok('to the moment the unload finished', reload.shipperArrivedGameTime === plus(unloadAt, 1.25),
    `${reload.shipperArrivedGameTime} vs ${plus(unloadAt, 1.25)}`);
  ok('and they are told when it goes on all the same', !!reload.loadStartsGameTime && !!reload.shipperCallNote,
    (reload.shipperCallNote || '').slice(0, 100));
  ok('saying they are still there from the drop', /still on their property/.test(reload.shipperCallNote || ''));
  await logEvent(reload, 'BeginLoad', reload.loadStartsGameTime);
  await logEvent(reload, 'EndLoad', plus(reload.loadStartsGameTime, 1));
  await close(reload, plus(reload.loadStartsGameTime, 5));

  head('3b. Same city, somebody else — they drove across town, so they report');
  const back = await take(29, { from: ['Wichita', 'KS'], to: ['Topeka', 'KS'], receiver: 'Midwest Steel' });
  await api(`/trips/${back.id}/arrived`, 'POST', { gameTime: iso(30, '09:00') });
  await logEvent(back, 'BeginUnload', iso(30, '10:00'));
  await logEvent(back, 'EndUnload', iso(30, '11:00'));
  await close(back, iso(30, '09:00'));
  const across = await take(30, { from: ['Topeka', 'KS'], to: ['Wichita', 'KS'], shipper: 'Kaw Valley Grain', hm: '13:00' });
  ok('a different shipper in the same city is not assumed', !!across && !across.shipperArrivedGameTime,
    across?.shipperArrivedGameTime || 'not set');
  await api(`/trips/${across.id}/cancel`, 'POST', {}).catch(() => {});

  head('4. What dispatch plans on is the stay, wait included');
  // "add the DETENTION piece to both the loading and unloading time calculations we do on every load".
  // The learned figure moves toward what this trip cost at each end: the span plus the hold.
  const flatbed = async () => ((await api('/bootstrap')).views.facilityTimes || [])
    .find((x) => x.trailerType.toLowerCase() === 'flatbed');
  let held = null;
  for (let day = 32; day <= 50 && !held; day++) {
    const t = await take(day, { from: ['Wichita', 'KS'], to: ['Topeka', 'KS'], shipper: 'Prairie Mill',
                                receiver: 'Midwest Steel', hm: '09:00' });
    if (!t) continue;
    const r = await api(`/trips/${t.id}/at-shipper`, 'POST', { gameTime: iso(day, '10:00') });
    if (r.call.waitHours > 0.25) { held = { t, call: r.call }; break; }
    await logEvent(t, 'BeginLoad', r.call.workStartsGameTime);
    await logEvent(t, 'EndLoad', plus(r.call.workStartsGameTime, 1));
    await close(t, plus(r.call.workStartsGameTime, 5));
  }
  ok('a held pickup to learn from', !!held);
  if (held) {
    const { t, call } = held;
    await logEvent(t, 'BeginLoad', call.workStartsGameTime);
    await logEvent(t, 'EndLoad', plus(call.workStartsGameTime, 1.5));
    // The receiver: arrive on the stated opening and get started on an hour and a half after it.
    const st0 = await tripOf(t.id);
    const due = st0.appointmentGameTime || st0.appointmentOpensGameTime;
    const reach = due > plus(call.workStartsGameTime, 4) ? due : plus(call.workStartsGameTime, 4);
    await api(`/trips/${t.id}/arrived`, 'POST', { gameTime: reach });
    await logEvent(t, 'BeginUnload', plus(reach, 1.5));
    await logEvent(t, 'EndUnload', plus(reach, 2.5));
    const st = await tripOf(t.id);

    const before = await flatbed();
    const weight = 1 / Math.min(before.samples + 1, 10);
    const shipperWait = hoursBetween(st.shipperClockFromGameTime || st.shipperArrivedGameTime, call.workStartsGameTime);
    const floor = [st.arrivedGameTime, st.appointmentGameTime || st.appointmentOpensGameTime].filter(Boolean).sort().pop();
    const line = Math.max(0, (st.queuePosition || 0) - 1) * 0.5;
    const receiverHold = Math.max(0, hoursBetween(floor, plus(reach, 1.5)) - line);
    const loadSample = 1.5 + shipperWait;
    const unloadSample = 1 + (receiverHold > 0.01 ? receiverHold : 0);

    await close(t, reach);
    const after = await flatbed();
    const wantLoad = Math.round((before.loadingHours + (loadSample - before.loadingHours) * weight) * 100) / 100;
    const wantUnload = Math.round((before.unloadingHours + (unloadSample - before.unloadingHours) * weight) * 100) / 100;
    console.log(`  ..    shipper held ${hhmm(shipperWait)} + 1:30 loading -> sample ${hhmm(loadSample)}; ` +
                `receiver held ${hhmm(receiverHold)} (line ${hhmm(line)}) + 1:00 -> ${hhmm(unloadSample)}`);
    console.log(`  ..    flatbed load ${hhmm(before.loadingHours)} -> ${hhmm(after.loadingHours)}, ` +
                `unload ${hhmm(before.unloadingHours)} -> ${hhmm(after.unloadingHours)}`);
    ok('loading learned the wait at the shipper as well as the loading',
      Math.abs(after.loadingHours - wantLoad) < 0.015, `${after.loadingHours} vs ${wantLoad}`);
    ok('unloading learned the hold at the receiver as well as the unload',
      Math.abs(after.unloadingHours - wantUnload) < 0.015, `${after.unloadingHours} vs ${wantUnload}`);
    ok('and it counted as one sample', after.samples === before.samples + 1, `${before.samples} -> ${after.samples}`);

    // The recompute from the logs has to land on the same figure, or the next correction undoes this.
    const rb = await api('/facility/rebuild', 'POST', {});
    const again = (rb.facilityTimes || []).find((x) => x.trailerType.toLowerCase() === 'flatbed');
    ok('recomputing from the trip logs lands on the same figures, waits in',
      !!again && again.samples === after.samples
        && Math.abs(again.loadingHours - after.loadingHours) < 0.015
        && Math.abs(again.unloadingHours - after.unloadingHours) < 0.015,
      again ? `${again.loadingHours}/${again.unloadingHours} off ${again.samples}` : 'none');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
