/* Issue #96 — a mistyped unload stamp is permanent, and it poisons the learned dock average.
 *
 * Reported from a real career: an End unload typed with AM and PM the wrong way round. The span came out
 * at thirteen hours and trained the planner on it, so every future load of that trailer type was planned
 * on a dock time hours too long.
 *
 * Three things were missing. The log only ever appended, so the stamp could not be corrected. The
 * average keeps a result and a count rather than its samples, so a bad reading could not be pulled back
 * out. And nothing questioned thirteen hours on a dock, though the app questions implausible readings
 * everywhere else.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5966}/api`;
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
let S, day = 2, type = 'Dry Van';

async function place(hm) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: 5000 + day * 30, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  return S;
}

async function runLoad() {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: type,
    originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
    loadedMiles: 22, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 20,
    weightLbs: 24000, appointmentOpensHours: 2,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: r.evaluations[0].load.id, overrideTight: true });
  return auth.trip;
}

const log = (id, kind, stamp) => api(`/trips/${id}/event`, 'POST', { kind, gameTime: stamp, note: '' });

async function close(id, at) {
  return api(`/trips/${id}/complete`, 'POST', {
    deliveredGameTime: at, actualMiles: 22, endOdometer: 5100 + day * 30, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Aurora', locationState: 'CO', fuelPct: 70, gameTime: at,
  });
}

/** Run a whole load with a logged unload. endStamp defaults to the same day. */
async function loadWithUnload(beginHm, endHm, endDayOffset = 0) {
  await place('06:00');
  const trip = await runLoad();
  const endStamp = iso(day + endDayOffset, endHm);
  await log(trip.id, 'BeginUnload', iso(day, beginHm));
  await log(trip.id, 'EndUnload', endStamp);
  const done = await close(trip.id, endStamp);
  day += 1 + endDayOffset;
  return done;
}

const dock = async () => ((await api('/bootstrap')).views.facilityTimes || [])
  .find((f) => f.trailerType === type);

(async () => {
  const app = { driverName: 'D. Ock', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1, '06:00'), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  type = S.trailers[0].type;
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, receiverTakesEarlyPct: 0 });
  console.log(`     trailer: ${type} · seed ${(await dock()).unloadingHours}h unload`);

  head('1. Two honest loads teach it a sensible figure');
  await loadWithUnload('12:00', '14:00');
  await loadWithUnload('12:00', '14:00');
  let f = await dock();
  ok('it has learned from both', f.samples === 2, `${f.samples} sample(s)`);
  ok('and settled near two hours', Math.abs(f.unloadingHours - 2) < 0.6, `${f.unloadingHours}h`);
  const learned = f.unloadingHours;

  head('2. The AM/PM swap: 1:00 PM typed as 1:00 AM lands on the next day — thirteen hours');
  const done = await loadWithUnload('12:00', '01:00', 1);
  const bad = done.snapshot.trips.find((t) => t.number === done.audit.trip.number);
  ok('the trip records the whole thirteen hours', bad.unloadingHours > 12, `${bad.unloadingHours}h`);
  ok('but the close-out questions it', (done.audit.warnings || []).some((w) => /not a dock time/i.test(w)),
    (done.audit.warnings || []).find((w) => /dock time/i.test(w))?.slice(0, 130) || '(silent)');
  ok('and names the AM/PM swap as the likely cause',
    (done.audit.warnings || []).some((w) => /AM and PM the wrong way round/i.test(w)), 'wording');
  ok('quoting what it would be if that is what happened',
    (done.audit.warnings || []).some((w) => /1:00/.test(w)),
    (done.audit.warnings || []).find((w) => /dock time/i.test(w))?.slice(-90) || '');

  head('3. It refuses to learn from it at all');
  f = await dock();
  ok('the sample count did not move', f.samples === 2, `${f.samples} sample(s)`);
  ok('and the average is untouched', Math.abs(f.unloadingHours - learned) < 0.001, `${f.unloadingHours}h`);

  head('4. The stamp can be corrected, and the trip re-derives');
  const evId = bad.events.find((e) => e.kind === 'EndUnload').id;
  ok('every logged event has an id to address', !!evId, evId || '(none)');
  const beginStamp = bad.events.find((e) => e.kind === 'BeginUnload').gameTime;
  let r = await api(`/trips/${bad.id}/event/${evId}`, 'POST', { gameTime: beginStamp.slice(0, 11) + '14:00' });
  let fixed = un(r).trips.find((t) => t.id === bad.id);
  ok('the trip now reads two hours', Math.abs(fixed.unloadingHours - 2) < 0.01, `${fixed.unloadingHours}h`);
  ok('and it says what it did', /moved from/i.test(r.message), r.message.slice(0, 90));
  ok('naming the recomputed average', /average out again|worked the/i.test(r.message), r.message.slice(-120));

  head('5. And the correction reaches the learned figure');
  f = await dock();
  ok('the corrected load is now counted', f.samples === 3, `${f.samples} sample(s)`);
  ok('and the average is still sensible', Math.abs(f.unloadingHours - 2) < 0.6, `${f.unloadingHours}h`);

  head('6. Dropping an entry works too, and the average follows');
  const doomedTrip = un(r).trips.find((t) => t.id === bad.id);
  const dropId = doomedTrip.events.find((e) => e.kind === 'EndUnload').id;
  r = await api(`/trips/${doomedTrip.id}/event/${dropId}`, 'POST', { remove: true });
  ok('it says the entry went', /Dropped/i.test(r.message), r.message.slice(0, 70));
  f = await dock();
  ok('and that load stops counting', f.samples === 2, `${f.samples} sample(s)`);

  head('7. A career already carrying a bad figure can be rebuilt on demand');
  // Pin something absurd the way a bad sample would have, then rebuild from the logs.
  await api('/settings/facility-time', 'POST', { trailerType: type, loadingHours: 9, unloadingHours: 11, manual: true });
  await api('/settings/facility-time', 'POST', { trailerType: type, manual: false });
  let before = await dock();
  ok('the bad figure is in place', before.unloadingHours > 8, `${before.unloadingHours}h`);
  r = await api('/facility/rebuild', 'POST', {});
  ok('rebuilding says what it worked from', /off \d+ load/i.test(r.message), r.message.slice(0, 130));
  f = await dock();
  ok('and the figure is back to what the logs actually say',
    Math.abs(f.unloadingHours - 2) < 0.6, `${f.unloadingHours}h off ${f.samples} load(s)`);

  head('8. A figure the driver set themselves is left alone');
  await api('/settings/facility-time', 'POST', { trailerType: type, loadingHours: 3, unloadingHours: 4, manual: true });
  await api('/facility/rebuild', 'POST', {});
  f = await dock();
  ok('the override survives a rebuild', f.manual === true && Math.abs(f.unloadingHours - 4) < 0.01,
    `${f.unloadingHours}h, manual=${f.manual}`);

  head('9. Correcting an event does not move the game clock');
  const clockBefore = (await api('/bootstrap')).status.gameTime;
  const anyTrip = (await api('/bootstrap')).trips.find((t) => t.events.some((e) => e.kind === 'BeginUnload'));
  const anyEv = anyTrip.events.find((e) => e.kind === 'BeginUnload');
  await api(`/trips/${anyTrip.id}/event/${anyEv.id}`, 'POST', { detail: 'noted after the fact' });
  ok('the clock is where it was', (await api('/bootstrap')).status.gameTime === clockBefore, clockBefore);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
