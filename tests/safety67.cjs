/* Issue #67 — safety was punishing the driver for the app's own mistakes.
 *
 * Every late delivery filed an incident, non-preventable ones included, and each one stamped a fresh
 * clean-load baseline — so a driver could never work anything off. On top of that a single late load
 * could reach a written warning, and some of those loads were only late because of bugs since fixed.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5820}/api`;
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
const H = require('./lib/helpers.cjs');
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, day = 1, odo = 60000;

/** One load, delivered either on time or late, with the fault the driver reports. */
async function haul(n, { late = false, reason = '', fault = '' } = {}) {
  day += 1;
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(day, '06:00'),
    fuelPct: 85, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 0, gameRevenue: 700,
    // Feasible when booked either way. A late run is one the driver then misses, not one that was
    // impossible to start -- dispatch refuses those outright, which is a different test.
    deadlineHours: late ? 12 : 40, weightLbs: 30000,
  });
  // Evaluating a board can clear it, so the evaluation handed back may name a load that is gone. Say
  // what blocked it rather than dying on "that load is not on the current board".
  if (!bd.evaluations?.[0]) throw new Error(`board empty: ${(bd.dispatchNotes || []).join(' ; ').slice(0, 200)}`);
  let auth;
  try {
    auth = await api('/dispatch/authorize', 'POST',
      { loadId: bd.evaluations[0].load.id, overrideTight: true });
  } catch (e) {
    // The operational 34 turns up unpredictably in a long run of loads. Sit it and carry on.
    const sat = await H.sitRestartIfOrdered(api, (d) => { day += d; return iso(day, '07:00'); });
    if (!sat) {
      const v = (await api('/bootstrap')).views;
      throw new Error(`${e.message} | blockers: ${(v.dispatchBlockers || []).join(' ; ').slice(0, 260) || 'none'}`);
    }
    await api('/board/clear', 'POST', {});
    const again = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type,
      originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
      loadedMiles: 110, deadheadMiles: 0, gameRevenue: 700,
      deadlineHours: late ? 12 : 40, weightLbs: 30000,
    });
    if (!again.evaluations?.[0]) throw new Error(`still no freight after sitting ${sat.number}`);
    auth = await api('/dispatch/authorize', 'POST',
      { loadId: again.evaluations[0].load.id, overrideTight: true });
  }
  odo += 110;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    // Late runs deliver a day later than the four hours allowed.
    deliveredGameTime: iso(day + (late ? 1 : 0), late ? '20:00' : '14:00'),
    actualMiles: 110, endOdometer: odo, actualRevenue: 700,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: reason, faultOverride: fault, damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', fuelPct: 60,
    gameTime: iso(day + (late ? 1 : 0), late ? '20:00' : '14:00'),
    hosDriveRemaining: 8, hosShiftRemaining: 10, hosBreakRemaining: 6, hosCycleRemaining: 55,
  });
  if (late) day += 1;
  S = done.snapshot;
  return done.audit;
}

const counting = async () => (await api('/bootstrap')).views.countingFaults ?? -1;
const discipline = async () => (await api('/bootstrap')).discipline || [];

(async () => {
  const app = { driverName: 'S. Record', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));

  head('1. A late load that is dispatch\'s fault leaves nothing behind');
  let audit = await haul(1, { late: true, reason: 'booked on a run that would not go', fault: 'Dispatcher' });
  const f1 = (audit.serviceFindings || []).join(' | ');
  ok('it is logged against dispatch', /against dispatch/i.test(f1), f1.slice(0, 170));
  ok('and says there is no incident', /no incident/i.test(f1), '');
  ok('nothing counts against the driver', await counting() === 0, `${await counting()}`);
  ok('and no discipline was issued', (await discipline()).length === 0, `${(await discipline()).length}`);

  head('2. The driver\'s own first late load is noted, not punished');
  audit = await haul(2, { late: true, reason: 'I misjudged the run', fault: 'Driver' });
  const f2 = (audit.serviceFindings || []).join(' | ');
  ok('it says it is down to them', /down to you/i.test(f2), f2.slice(0, 180));
  ok('and that it is noted and nothing more', /noted on the file and nothing more/i.test(f2), '');
  ok('it states what it would take', /takes 3 before/i.test(f2), '');
  ok('still no discipline', (await discipline()).length === 0, `${(await discipline()).length}`);
  ok('and still nothing counting', await counting() === 0, `${await counting()}`);

  head('3. A second is still short of a pattern');
  audit = await haul(3, { late: true, reason: 'ran out of daylight', fault: 'Driver' });
  ok('no discipline on the second either', (await discipline()).length === 0,
    `${(await discipline()).length}`);
  ok('and it says how many that is', /2 in your last 10/i.test((audit.serviceFindings || []).join(' ')),
    (audit.serviceFindings || []).join(' | ').slice(0, 150));

  head('4. The third inside ten loads IS a pattern');
  audit = await haul(4, { late: true, reason: 'late again, my own doing', fault: 'Driver' });
  const f4 = (audit.serviceFindings || []).join(' | ');
  const acts = await discipline();
  ok('now discipline is issued', acts.length === 1, `${acts.length}: ${acts.map((a) => a.level).join(', ')}`);
  ok('and it starts at coaching, not a written warning', acts[0]?.level === 'Coaching', acts[0]?.level);
  ok('the finding calls it a pattern', /this is a pattern/i.test(f4), f4.slice(0, 190));
  ok('it says clean work clears it', /10 clean loads clears the count/i.test(f4), '');
  ok('and one incident now counts', await counting() === 1, `${await counting()}`);

  head('5. Dispatch-fault lateness never contributes to the pattern');
  // Three more, all dispatch's fault. If these counted, the ladder would climb.
  for (let i = 0; i < 3; i++) await haul(10 + i, { late: true, reason: 'dispatch error again', fault: 'Dispatcher' });
  ok('still just the one action', (await discipline()).length === 1, `${(await discipline()).length}`);
  ok('and still one counting incident', await counting() === 1, `${await counting()}`);

  head('6. Clean work walks the strikes off');
  // A coaching action holds dispatch until the driver signs it off, which is correct -- and means the
  // clean run cannot start until they do.
  await H.clearDiscipline(api);
  ok('the coaching was signed off', (await discipline()).every((a2) => a2.driverAcknowledged), 'acknowledged');

  for (let i = 0; i < 10; i++) await haul(20 + i);
  audit = await haul(40, { late: true, reason: 'my fault, first in a while', fault: 'Driver' });
  const f6 = (audit.serviceFindings || []).join(' | ');
  ok('a late load after a clean run is a note again', /noted on the file and nothing more/i.test(f6),
    f6.slice(0, 180));
  ok('and it counts as the first, not the fourth', /is 1 in your last 10/i.test(f6),
    (f6.match(/is \d+ in your last 10/) || ['(no count)'])[0]);
  ok('no new discipline', (await discipline()).length === 1, `${(await discipline()).length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
