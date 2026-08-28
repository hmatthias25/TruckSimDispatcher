/* Issue #123 — a review that asks where the damage came from before holding anybody to it.
 *
 * The old rule read Status.TruckDamagePct and dinged anything over the mandatory-review line. That
 * cannot tell a wreck from a wreck that was not yours, and it never once saw wear: a driver who took a
 * tractor from 2% to 24% heard nothing as long as they finished under the line, and one who inherited a
 * unit at 14% heard about it every time while doing nothing wrong.
 *
 * Now: reported damage is accounted for, and whatever is left over is wear, judged per thousand miles.
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
const at = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, day = 1, odo = 90000;

/** Where the truck is, and what shape it is in. Damage is the whole point of this suite. */
async function stand(city, st, dmg, kind = 'TruckStop') {
  odo += 60;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: at(day, '09:00'),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: dmg, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 120000,
  });
  S = un(r);
  return r;
}

/** One delivered load, so the period has miles in it to divide by. */
async function runLoad(destCity, destState, miles, dmgAfter) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: miles * 2.4, deadlineHours: 240, weightLbs: 40000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  odo += miles;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: miles, endOdometer: odo, actualRevenue: miles * 2.4,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: dmgAfter, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done;
}

/** Home to the yard, which is what files a review. Returns the review or null. */
async function reviewAt(d, dmg) {
  day = d;
  await stand('Joplin', 'MO', dmg);
  day += 1;
  const r = await stand('Springfield', 'MO', dmg, 'Terminal');
  return r.homeBrief?.review || null;
}

const said = (rev) => [...(rev?.concerns || []), ...(rev?.strengths || [])].join(' | ');

/** Put it through a shop, the way a driver does when dispatch stops on damage. */
async function repair(to = 1) {
  const wo = (await api('/maintenance/workorder', 'POST', {
    unitKind: 'Truck', unit: S.driver.assignedTruckUnit, kind: 'Repair',
    description: 'Body and panel work', openedGameTime: at(day),
  })).workOrder;
  await api(`/maintenance/workorder/${wo.number}/complete`, 'POST', {
    cost: 900, damageAfter: to, vendor: 'Company shop', paidBy: 'Company', notes: '',
  });
  await stand(S.status.locationCity, S.status.locationState, to);
}

(async () => {
  const app = { driverName: 'W. Ear', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);

  head('1. #123 Ordinary wear over real miles is not mentioned at all');
  // Two points across 1,800 miles. Curbs, docks and gravel yards are the job, and a review that
  // comments on them teaches the driver to skim past the lines that matter.
  await stand('Springfield', 'MO', 1);
  await runLoad('Oklahoma City', 'OK', 600, 2);
  await runLoad('Wichita', 'KS', 600, 2);
  await runLoad('Springfield', 'MO', 600, 3);
  const quiet = await reviewAt(16, 3);
  ok('a review was filed', !!quiet, quiet ? quiet.number : '(none)');
  ok('nothing is said about the damage', !/wear|per thousand|ease up|nothing explains/i.test(said(quiet)),
    said(quiet).slice(0, 120) || '(nothing said)');
  ok('but the reading is banked for the record', quiet?.truckDamagePct >= 0, `${quiet?.truckDamagePct}%`);

  head('2. #123 Wear survives the repairs that used to hide it');
  // THE case the endpoint measure got wrong. Dispatch stops at 10%, so a heavy-handed driver never
  // shows a big number at review time — they show 9%, a repair, and 9% again. Damage-now-minus-
  // damage-then reads that as zero. The per-load rises read it as eighteen points.
  await stand('Springfield', 'MO', 1);
  await runLoad('Tulsa', 'OK', 600, 9);
  await repair(1);
  await runLoad('Springfield', 'MO', 600, 9);
  await repair(1);
  const heavy = await reviewAt(32, 1);
  ok('a second review was filed', !!heavy, heavy ? heavy.number : '(none)');
  ok('the truck reads clean at review time', heavy?.truckDamagePct <= 2, `${heavy?.truckDamagePct}%`);
  ok('and the wear is still found', (heavy?.concerns || []).some((c) => /nothing explains/i.test(c)),
    (heavy?.concerns || []).find((c) => /nothing explains/i.test(c))?.slice(0, 140) || said(heavy).slice(0, 130));
  ok('given as a rate, not a number off the gauge',
    (heavy?.concerns || []).some((c) => /per thousand/i.test(c)), 'rate given');
  ok('and it says what to do about it',
    (heavy?.concerns || []).some((c) => /ease up/i.test(c)), 'told');

  head('3. #123 Damage somebody else did is noted and not held against them');
  // Reported to Safety as not the driver's doing, with a description — the mechanism the player was
  // told to use. The review has to actually read it.
  await stand('Springfield', 'MO', 1);
  await api('/incidents', 'POST', {
    gameTime: at(34), kind: 'Collision', severity: 'Moderate',
    description: 'Rear-ended at a light by AI traffic while stopped.',
    faultAttribution: 'Unavoidable', preventable: false,
    truckDamagePctAfter: 9, locationCity: 'Joplin', locationState: 'MO',
  });
  await H.clearDiscipline(api);
  day = 35;
  await stand('Springfield', 'MO', 1);
  await runLoad('Tulsa', 'OK', 700, 9);      // the collision: one big jump
  await repair(1);
  await runLoad('Springfield', 'MO', 700, 2);  // ordinary miles either side of it
  const wreck = await reviewAt(48, 2);
  ok('a third review was filed', !!wreck, wreck ? wreck.number : '(none)');
  ok('the eight points from the collision are not called wear',
    !(wreck?.concerns || []).some((c) => /nothing explains/i.test(c)),
    (wreck?.concerns || []).find((c) => /nothing explains/i.test(c))?.slice(0, 140) || 'not called wear');
  ok('the incident is noted rather than passed over',
    /not down to the driver/i.test(said(wreck)),
    said(wreck).match(/not down to the driver[^|]*/i)?.[0]?.slice(0, 120) || said(wreck).slice(0, 120));
  ok('and it says plainly it is not being held against them',
    /not held against them/i.test(said(wreck)), 'said');
  ok('it counts as a point in their favour, not a black mark',
    (wreck?.strengths || []).some((x) => /not down to the driver/i.test(x)), 'in strengths');

  head('4. #123 A handful of miles is not a rate');
  // Dividing points by two hundred miles produces an alarming number out of nothing, so below the
  // floor the question is simply not asked.
  await stand('Springfield', 'MO', 1);
  await runLoad('Joplin', 'MO', 70, 9);
  const tiny = await reviewAt(64, 9);
  ok('a fourth review was filed', !!tiny, tiny ? tiny.number : '(none)');
  ok('eight points over seventy miles is not turned into a rate',
    !/per thousand/i.test(said(tiny)), said(tiny).slice(0, 120) || '(nothing said)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
