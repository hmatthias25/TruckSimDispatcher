/* A gate wait on a drop and hook, and the hour of dock work that came with it.
 *
 *   "I just got to a gate at 5:44 with a flatbed drop and hook, was told I had to wait until 8:14. I did
 *    and when I Unloaded the close out said keep 5:44 on the close out even though they agreed to get it
 *    at 8:14. I did this and did not get any detention time recorded between 5:44 and 8:14. The place
 *    opened at 5:23."
 *
 * The 5:44 on the close-out is right and deliberate — see heldclock254. The arrival is what the
 * appointment is judged against; taking the later figure would charge the receiver's own queue to the
 * driver's service record.
 *
 * The detention is recorded, and this suite pins it: 2:30 sat at the gate produces 0:30 of BILLABLE
 * detention, because Pay.DetentionFreeHours is two hours and that is what the free window is for. The
 * whole 2:30 is stated too, in as many words — "on their property 2:30 ... 2:30 of that was waiting
 * rather than working" — so the time is neither lost nor silent. Somebody looking for the full 2:30 as a
 * payable figure will not find it, and should not: the free window is a setting, not an accident.
 *
 * What looking into it DID turn up is a different fault entirely. The trip came back carrying an hour of
 * unloading on a drop and hook, which has no unload at all — you pull the pin and leave. Authorize was
 * stamping every trip with a flat DefaultLoadingHours/DefaultUnloadingHours, one hour each, for
 * everything, while the HOS plan three hundred lines earlier used FacilityLearning: three hours for a
 * reefer, two for a flatbed, twenty-five minutes for a hook. The plan knew and the record did not.
 *
 * That matters because CLOSE-OUT reads the record. spentAtDock is UnloadingHours + DetentionHours, and
 * on a drop and hook that was an hour of dock work nobody did, waiting to be pushed onto the game clock.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${hm}`;
};
const hm = (i) => (i || '').slice(11);

let S, odo = 300000;

/** Put the driver on an arrangement or a real trailer, and stand them at the shipper. */
async function rig(trailerUnit) {
  const st = await api('/export');
  st.driver.assignedTrailerUnit = trailerUnit;
  S = un(await api('/import', 'POST', st));
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: at(5, '03:00'),
    fuelPct: 95, atsOdometer: odo, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
}

/** Authorize one load of the given freight type and hand back the trip. */
async function take(freightType) {
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: freightType === 'Reefer' ? 'Frozen Foods' : 'Steel Beams',
    trailerType: freightType, receiver: 'Brandt Construction',
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 40,
    weightLbs: 40000, atLocation: true, appointmentOpensHours: 2.4,
  });
  return (await api('/dispatch/authorize', 'POST', { loadId: (bd.evaluations || [])[0].load.id })).trip;
}

/** Drop a trip that was only ever taken to read its stamped figures. */
const bin = (id) => api(`/trips/${id}/cancel`, 'POST', { reason: 'fixture — only wanted the dispatch numbers' });

(async () => {
  const app = { driverName: 'D. Halloran', preferredDivision: 'Flatbed', experienceYears: 10,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  let st = await api('/export');
  st.company.divisions = ['Flatbed', 'Dry Van', 'Reefer'];
  for (const [unit, type, div] of [['DH-1', 'Drop & Hook', 'Flatbed'],
                                   ['FB-9', 'Flatbed', 'Flatbed'],
                                   ['RF-4', 'Reefer', 'Reefer']]) {
    st.trailers.push({ unit, type, subtype: '', division: div, year: 2022, status: 'InService',
      inGameGarage: true, homeTerminalId: st.company.terminals[0].id, damagePct: 0, stars: 5 });
  }
  S = un(await api('/import', 'POST', st));
  const free = S.driver.pay.detentionFreeHours;
  const queueFree = S.driver.pay.queueFreeHours;
  console.log(`  ..    free windows: ${free}h on the work, ${queueFree}h on waiting`);

  head('1. The trip carries the dock time the plan was built on');
  // Was a flat one hour for everything, whatever was hooked. FacilityLearning seeds a reefer at three
  // hours and a flatbed at an hour and a half, and drop and hook at the hook time.
  await rig('DH-1');
  const dh = await take('Flatbed');
  console.log(`  ..    drop and hook: load ${dh.loadingHours}h / unload ${dh.unloadingHours}h ` +
              `(hook setting ${S.settings.hookHours}h)`);
  ok('a drop and hook is not booked an hour of unloading',
    dh.unloadingHours < 0.75, `${dh.unloadingHours}h`);
  ok('it is the hook time', Math.abs(dh.unloadingHours - S.settings.hookHours) < 0.01,
    `${dh.unloadingHours} against ${S.settings.hookHours}`);

  await bin(dh.id);
  await rig('RF-4');
  const rf = await take('Reefer');
  console.log(`  ..    reefer: load ${rf.loadingHours}h / unload ${rf.unloadingHours}h`);
  ok('a reefer gets its real dock time, not the generic default',
    rf.unloadingHours > 1.5, `${rf.unloadingHours}h`);
  ok('and the two are not the same figure any more',
    Math.abs(rf.unloadingHours - dh.unloadingHours) > 1, `${rf.unloadingHours} vs ${dh.unloadingHours}`);

  await bin(rf.id);
  head('2. The reported run: a gate at 05:44, held to 08:14');
  await rig('DH-1');
  const trip = await take('Flatbed');
  await api(`/trips/${trip.id}/loaded`, 'POST',
    { startOdometer: odo, weightLbs: 40000, pulledOutGameTime: at(5, '03:30') });
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: at(5, '05:44') });

  // The reported figures exactly: arrived 05:44, taken at 08:14, the site open since 05:23. Forced
  // rather than rolled, because the queue is seeded and this suite is about what happens to 2:30 of it.
  st = await api('/export');
  const held = st.trips.find((t) => t.id === trip.id);
  held.arrivedGameTime = at(5, '05:44');
  held.workStartsGameTime = at(5, '08:14');
  held.appointmentOpensGameTime = at(5, '05:23');
  S = un(await api('/import', 'POST', st));
  const before = S.trips.find((t) => t.id === trip.id);
  console.log(`  ..    arrived ${hm(before.arrivedGameTime)}, they open ${hm(before.appointmentOpensGameTime)}, ` +
              `taken ${hm(before.workStartsGameTime)}`);
  ok('they were already open when the truck rolled up',
    before.appointmentOpensGameTime < before.arrivedGameTime, '05:23 before 05:44');
  ok('so the wait is a queue at the gate, not a shut gate',
    before.workStartsGameTime > before.arrivedGameTime, '2:30');

  head('3. Close out on the arrival, and the wait is not lost');
  odo += 110;
  const done = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: at(5, '05:44'), actualMiles: 110, endOdometer: odo, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(5, '05:44'),
  });
  const closed = done.snapshot.trips.find((t) => t.id === trip.id);
  const findings = (done.audit.serviceFindings || []).join(' | ');
  console.log(`  ..    detention ${closed.detentionHours}h, clock now ${hm(done.snapshot.status.gameTime)}`);
  (done.audit.serviceFindings || []).filter((f) => /property|detention/i.test(f))
    .forEach((f) => console.log(`  ..    ${f}`));

  ok('the delivery time is the arrival, as designed', hm(closed.deliveredGameTime) === '05:44',
    hm(closed.deliveredGameTime));
  ok('the clock moved to when they took the truck', hm(done.snapshot.status.gameTime) === '08:14',
    hm(done.snapshot.status.gameTime));
  ok('the whole wait is stated, not just the billable part',
    /on their property 2:30/i.test(findings), findings.match(/On their property [^—]*/i)?.[0] || '(silent)');
  ok('detention is recorded', closed.detentionHours > 0, `${closed.detentionHours}h`);
  // The split. Nobody was on the trailer for those 2:30, so it is charged against the queue window and
  // not the one that exists to cover unloading — 2:00 billable rather than the 0:30 it used to be.
  ok('the wait is billed against the queue window, not the work one',
    Math.abs(closed.detentionHours - (2.5 - queueFree)) < 0.01,
    `${closed.detentionHours}h = 2:30 less ${queueFree}h of queue allowance`);
  ok('and which window bit is said, not left as arithmetic',
    /gets .* free rather than the .* the work gets/i.test(findings),
    findings.match(/of it was waiting[^.]*\./i)?.[0]?.slice(0, 110) || '(not said)');

  head('4. A short queue is still just trucking');
  await rig('DH-1');
  const quick = await take('Flatbed');
  await api(`/trips/${quick.id}/loaded`, 'POST',
    { startOdometer: odo, weightLbs: 40000, pulledOutGameTime: at(6, '03:30') });
  await api(`/trips/${quick.id}/arrived`, 'POST', { gameTime: at(6, '05:44') });
  st = await api('/export');
  const q = st.trips.find((t) => t.id === quick.id);
  q.arrivedGameTime = at(6, '05:44');
  // Twenty minutes behind a couple of trucks. Half an hour is allowed for exactly this — billing a short
  // line from the first minute would make every arrival a claim, which is not what the split is for.
  q.workStartsGameTime = at(6, '06:04');
  S = un(await api('/import', 'POST', st));
  odo += 110;
  const done2 = await api(`/trips/${quick.id}/complete`, 'POST', {
    deliveredGameTime: at(6, '05:44'), actualMiles: 110, endOdometer: odo, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(6, '05:44'),
  });
  const q2 = done2.snapshot.trips.find((t) => t.id === quick.id);
  console.log(`  ..    0:20 at the gate → detention ${q2.detentionHours}h, clock ${hm(done2.snapshot.status.gameTime)}`);
  ok('a twenty-minute line costs them nothing', q2.detentionHours === 0, `${q2.detentionHours}h`);
  ok('but the clock still moved over it', hm(done2.snapshot.status.gameTime) === '06:04',
    hm(done2.snapshot.status.gameTime));

  head('5. The quoted time is a default, not a fact — the driver can overrule it');
  // The gate wait is the one figure here that is PRESCRIBED rather than measured. ATS has no opinion
  // about a queue, so the arrival call rolls one, tells the driver to set their clock to it, and the
  // driver makes it true by doing so. That left our own guess standing with nothing to correct it:
  // "so where do you get my ACTUAL unload time?"
  await rig('DH-1');
  const late = await take('Flatbed');
  await api(`/trips/${late.id}/loaded`, 'POST',
    { startOdometer: odo, weightLbs: 40000, pulledOutGameTime: at(7, '03:30') });
  await api(`/trips/${late.id}/arrived`, 'POST', { gameTime: at(7, '05:44') });
  st = await api('/export');
  const lt = st.trips.find((t) => t.id === late.id);
  lt.arrivedGameTime = at(7, '05:44');
  lt.workStartsGameTime = at(7, '08:14');       // what the app quoted
  S = un(await api('/import', 'POST', st));
  odo += 110;
  const done3 = await api(`/trips/${late.id}/complete`, 'POST', {
    deliveredGameTime: at(7, '05:44'), actualMiles: 110, endOdometer: odo, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(7, '05:44'),
    tookYouGameTime: at(7, '09:00'),            // they were actually another 46 minutes
  });
  const t3 = done3.snapshot.trips.find((t) => t.id === late.id);
  const f3 = (done3.audit.serviceFindings || []).join(' | ');
  console.log(`  ..    quoted 08:14, driver says 09:00 → taken ${hm(t3.workStartsGameTime)}, ` +
              `detention ${t3.detentionHours}h, clock ${hm(done3.snapshot.status.gameTime)}`);
  ok('the driver\'s reading replaces the quote', hm(t3.workStartsGameTime) === '09:00',
    hm(t3.workStartsGameTime));
  ok('and it is said rather than swapped quietly', /Going with yours/i.test(f3),
    f3.match(/You put them taking you[^.]*\./)?.[0]?.slice(0, 110) || '(silent)');
  ok('detention follows the real wait', Math.abs(t3.detentionHours - (3.267 - queueFree)) < 0.02,
    `${t3.detentionHours}h from a 3:16 wait`);
  ok('and so does the clock', hm(done3.snapshot.status.gameTime) === '09:00',
    hm(done3.snapshot.status.gameTime));

  head('6. A correction before the arrival is a typo, not a correction');
  await rig('DH-1');
  const typo = await take('Flatbed');
  await api(`/trips/${typo.id}/loaded`, 'POST',
    { startOdometer: odo, weightLbs: 40000, pulledOutGameTime: at(8, '03:30') });
  await api(`/trips/${typo.id}/arrived`, 'POST', { gameTime: at(8, '05:44') });
  st = await api('/export');
  const tp = st.trips.find((t) => t.id === typo.id);
  tp.arrivedGameTime = at(8, '05:44');
  tp.workStartsGameTime = at(8, '08:14');
  S = un(await api('/import', 'POST', st));
  odo += 110;
  const done4 = await api(`/trips/${typo.id}/complete`, 'POST', {
    deliveredGameTime: at(8, '05:44'), actualMiles: 110, endOdometer: odo, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(8, '05:44'),
    tookYouGameTime: at(8, '04:00'),            // before the truck was even there
  });
  const t4 = done4.snapshot.trips.find((t) => t.id === typo.id);
  console.log(`  ..    said 04:00 against an 05:44 arrival → taken ${hm(t4.workStartsGameTime)}`);
  ok('a time before the arrival is ignored', hm(t4.workStartsGameTime) === '08:14',
    hm(t4.workStartsGameTime));

  head('7. The gate survives the close-out, on the record');
  // It used to vanish: the finished trip showed a delivery time and a detention figure and nothing
  // joining them, and on a drop and hook there are no Begin/End events in the log either.
  const kept = done.snapshot.trips.find((t) => t.id === trip.id);
  console.log(`  ..    closed trip still holds arrived ${hm(kept.arrivedGameTime)} / ` +
              `taken ${hm(kept.workStartsGameTime)}`);
  ok('the arrival is still on the closed trip', hm(kept.arrivedGameTime) === '05:44',
    hm(kept.arrivedGameTime));
  ok('and so is the time they took the truck', hm(kept.workStartsGameTime) === '08:14',
    hm(kept.workStartsGameTime));
  ok('which is what makes the detention checkable',
    kept.detentionHours > 0 && kept.workStartsGameTime > kept.arrivedGameTime,
    `${kept.detentionHours}h against a 2:30 gap`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
