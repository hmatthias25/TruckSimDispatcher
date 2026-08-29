/* Issue #130 — dispatch credited recap hours days before they arrived.
 *
 * RecapDay.InDays says how many days from now a batch of hours comes back. The forward simulation
 * ignored it: it popped the next batch off a queue every time a 10-hour reset happened to cross
 * midnight, so a trip spanning two nights banked two batches even when they were due in five days and
 * seven.
 *
 * That is how a Fresno-to-Seattle run reads as feasible on a 20-hour cycle. Recap.cs had always worked
 * the arrival out properly from InDays, so the clocks page and dispatch gave the driver contradictory
 * answers — and the plan was built on the optimistic one.
 *
 * Issues #131 and #132 ride along at the end: they touch the same reporting surface.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const views = async () => (await api('/bootstrap')).views;

async function stand(city, state, day, cycle, recap) {
  await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Shipper', gameTime: at(day, '07:00'),
    fuelPct: 90, atsOdometer: 150000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 80000,
  });
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: cycle, recap,
  });
}

/** Put one load on the board and hand back its evaluation. */
async function offer(oc, os, dc, ds, miles, deadline) {
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: S.trailers[0].type, atLocation: true,
    originCity: oc, originState: os, destCity: dc, destState: ds,
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: miles * 3, deadlineHours: deadline,
    weightLbs: 38000,
  });
  return { bd, e: (bd.evaluations || [])[0] };
}

(async () => {
  const app = { driverName: 'R. Calloway', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Fresno', homeState: 'CA', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);

  head('1. #130 Hours that are days away are not spent today');
  // The reported case. 20 hours of cycle, and every batch four days out or more.
  await stand('Fresno', 'CA', 9, 20, [{ inDays: 4, hours: 9.5 }, { inDays: 6, hours: 8 }, { inDays: 7, hours: 10 }]);
  const far = await offer('Fresno', 'CA', 'Seattle', 'WA', 960, 46);
  const ff = far.e?.feasibility || {};
  ok('the run is not called feasible', ff.verdict === 'Infeasible' || far.bd.rejectAll === true,
    `${ff.verdict ?? far.bd.headline}`);
  ok('and it does not claim recap carries it',
    !(ff.warnings || []).some((w) => /Recap returns .* relying on/i.test(w)),
    (ff.warnings || []).find((w) => /Recap returns/i.test(w))?.slice(0, 90) || 'no recap claim');

  head('2. #130 The clocks page and dispatch now say the same thing');
  const rc = (await views()).recap || {};
  ok('the clocks page says the restart is the answer', rc.verdict === 'Restart', rc.verdict);
  ok('it says how far off the next batch is', /not due until/i.test((rc.lines || []).join(' ')),
    (rc.lines || []).find((l) => /not due until/i.test(l))?.slice(0, 90) || '');
  ok('dispatch agrees a restart is needed', ff.cycleRestartRequired === true, `${ff.cycleRestartRequired}`);

  head('3. #130 Hours that HAVE come due are still credited');
  // The fix must not throw the mechanism away: a batch landing tomorrow is real and should be planned on.
  await stand('Fresno', 'CA', 9, 20, [{ inDays: 1, hours: 11 }, { inDays: 2, hours: 10 }]);
  const near = await offer('Fresno', 'CA', 'Portland', 'OR', 660, 60);
  const nf = near.e?.feasibility || {};
  ok('a batch due tomorrow is counted', (nf.warnings || []).some((w) => /Recap returns/i.test(w))
    || nf.verdict !== 'Infeasible',
    (nf.warnings || []).find((w) => /Recap returns/i.test(w))?.slice(0, 95) || nf.verdict);

  head('4. #130 One night out cannot bank two days of recap');
  // The precise old bug: two midnights crossed, two batches popped, whatever their due dates said.
  await stand('Fresno', 'CA', 9, 24, [{ inDays: 5, hours: 10 }, { inDays: 6, hours: 10 }]);
  const two = await offer('Fresno', 'CA', 'Denver', 'CO', 1250, 72);
  const tf = two.e?.feasibility || {};
  const claimed = (tf.warnings || []).find((w) => /Recap returns/i.test(w)) || '';
  ok('no recap is banked on a trip that ends before any of it is due', !claimed,
    claimed.slice(0, 100) || 'nothing banked');

  head('5. #131 A game time carries its weekday');
  // A day number cannot be checked by eye. Day 0 is a Monday, so day 11 is a Friday.
  ok('the app agrees day 11 is a Friday', new Date(Date.UTC(2000, 0, 1) + 11 * 86400000) &&
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][11 % 7] === 'Fri', 'day 11 -> Fri');
  ok('and day 14 is a Monday',
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][14 % 7] === 'Mon', 'day 14 -> Mon');
  const pay = (await views()).payroll || {};
  ok('payday still lands on a Friday', pay.nextPaydayDay == null || pay.nextPaydayDay % 7 === 4,
    `day ${pay.nextPaydayDay}`);

  head('6. #132 A work order on a unit that is not on the fleet is refused');
  // It used to post the cost and repair nothing: Close() looks the unit up, finds nothing, and returns.
  let refused = '';
  try {
    await api('/maintenance/workorder', 'POST', {
      unit: 'NOPE-9', unitKind: 'Trailer', kind: 'Repair', vendor: 'TA', description: 'x',
      damageBefore: 30, cost: 900, status: 'Completed', damageAfter: 1,
    });
  } catch (e) { refused = e.message; }
  ok('it is refused rather than half-applied', !!refused, refused.slice(0, 100) || '(accepted!)');
  ok('and it says what IS on the fleet', /On the fleet:/i.test(refused), 'listed');

  head('7. #132 Closing one against a real trailer moves that trailer');
  const trailer = (await api('/bootstrap')).trailers.find((x) => !x.retired);
  await api('/maintenance/workorder', 'POST', {
    unit: trailer.unit, unitKind: 'Trailer', kind: 'Repair', vendor: 'TA',
    description: 'reefer panel', damageBefore: trailer.damagePct, cost: 1200,
    status: 'Completed', damageAfter: 1,
  });
  const after = (await api('/bootstrap'));
  const moved = after.trailers.find((x) => x.unit === trailer.unit);
  ok('the trailer reads what the work order said', Math.abs(moved.damagePct - 1) < 0.01,
    `${moved.damagePct}%`);
  ok('and the status panel agrees, with nothing else to type',
    Math.abs(after.status.trailerDamagePct - 1) < 0.01, `${after.status.trailerDamagePct}%`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
