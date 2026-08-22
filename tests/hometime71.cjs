/* Issue #71: an approved home time must not be spent short of the yard.
 *
 * Two distances were doing one job. The planning radius — 200 miles — decides which loads point
 * homeward and how they score. Actually TAKING home time needs the yard itself, one mile, and the code
 * said so in a comment twenty lines below the place it got it wrong.
 *
 * So an approved request was cleared the moment the driver came within 200 miles: the grant vanished,
 * no home time was recorded, days-out kept climbing, and nothing said a word about it. The driver asked
 * to go home, was told yes, and then quietly was not.
 *
 * This also pins the question that turned it up: reporting in at a company terminal that is NOT your
 * home terminal must not read as home time.
 */
const H = require('./lib/helpers.cjs');
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5920}/api`;
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
const at = (d, hm = '08:00') =>
  `2000-${String(Math.floor((d - 1) / 28) + 1).padStart(2, '0')}-${String(((d - 1) % 28) + 1).padStart(2, '0')}T${hm}`;

let S, day = 1;
const home = () => S.views.homeTime;

async function report(city, state, d, kind = 'TruckStop') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: at(d),
    fuelPct: 90, atsOdometer: 5000 + d * 300, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  return home();
}

/** One clean delivered load — a close-out is what answers an outstanding request. */
async function runLoad(destCity, destState) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 1900, deadlineHours: 60, weightLbs: 40000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 400, endOdometer: 0, actualRevenue: 1900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done;
}

(async () => {
  const app = { driverName: 'R. Turner', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1), code: 'PRI' }));
  S = un(await api('/career/clear-probation', 'POST', { force: true }));

  const label = home().terminalLabel || '';
  const [hCity, hState] = label.split(',').map((x) => x.trim());
  console.log(`     home yard: ${label}  ·  arrangement ${home().intervalDays} days`);
  ok('the driver has a home terminal', !!hCity && !!hState, label);

  head('1. A company terminal that is not YOUR terminal is not home');
  // The question that turned this up: parked up at the Denver yard, based out of Springfield.
  day = 20;
  let h = await report('Denver', 'CO', day, 'Terminal');
  const takenBefore = h.homeTimesTaken;
  ok('it measures against your own yard, not "am I at a terminal"',
    h.milesFromHome > 200, `${h.milesFromHome} mi from ${label}`);
  ok('not at the yard', h.atYard === false, `atYard=${h.atYard}`);
  ok('and not even in the planning radius', h.atHome === false, `atHome=${h.atHome}`);
  ok('no home time recorded', h.homeTimesTaken === takenBefore, `${h.homeTimesTaken} taken`);
  ok('the headline does not claim they are home',
    !/you are here|at the yard/i.test(h.headline), h.headline);

  head('2. Find a city inside the planning radius but short of the yard');
  // Discovered rather than assumed, so the test calibrates to whatever yard this career got.
  const CANDIDATES = [['Joplin', 'MO'], ['Rolla', 'MO'], ['Branson', 'MO'], ['Kansas City', 'MO'],
    ['Columbia', 'MO'], ['Fayetteville', 'AR'], ['Tulsa', 'OK'], ['Wichita', 'KS']];
  let mid = null;
  for (const [c, st] of CANDIDATES) {
    day += 1;
    const probe = await report(c, st, day);
    if (probe.milesFromHome > 1 && probe.milesFromHome <= 200) { mid = { c, st, mi: probe.milesFromHome }; break; }
  }
  ok('found one', !!mid, mid ? `${mid.c}, ${mid.st} at ${mid.mi} mi` : 'no candidate landed in the band');
  if (!mid) { console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = 1; return; }

  head('3. Ask for home time, and get it approved');
  day = 60;                                   // well past a 14-day arrangement, so the answer is yes
  await report('Amarillo', 'TX', day);
  await api('/career/request-home', 'POST', { reason: 'family' });
  await runLoad('Oklahoma City', 'OK');
  S = un(await api('/bootstrap'));
  ok('operations approved it', home().granted === true, `granted=${home().granted}`);

  head('4. THE BUG: reporting in inside the radius must not spend the approval');
  day += 1;
  h = await report(mid.c, mid.st, day);
  ok('still approved', h.granted === true,
    `${mid.c} at ${h.milesFromHome} mi — granted=${h.granted}`);
  ok('inside the planning radius', h.atHome === true, `atHome=${h.atHome}`);
  ok('but not at the yard', h.atYard === false, `atYard=${h.atYard}`);
  ok('no home time recorded', h.homeTimesTaken === takenBefore, `${h.homeTimesTaken} taken`);
  ok('and it does not tell them they are home',
    !/you are here/i.test(h.headline), h.headline);
  ok('it says to bring it in instead', /bring it in|report in at the yard/i.test(h.headline), h.headline);

  head('5. Arriving at the yard is what takes it');
  day += 1;
  h = await report(hCity, hState, day, 'Terminal');
  ok('at the yard', h.atYard === true, `${h.milesFromHome} mi`);
  ok('the approval is spent now', h.granted === false, `granted=${h.granted}`);
  ok('and the home time is on the record', h.homeTimesTaken === takenBefore + 1,
    `${takenBefore} -> ${h.homeTimesTaken}`);
  ok('days out is back to nothing', h.daysOut < 1, `${h.daysOut} days`);

  head('6. Sitting at the yard is one home time, not one per report');
  day += 1;
  h = await report(hCity, hState, day, 'Terminal');
  ok('still just the one', h.homeTimesTaken === takenBefore + 1, `${h.homeTimesTaken} taken`);
  ok('and nothing re-grants itself', h.granted === false, `granted=${h.granted}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
