/* #272 - step 6 of Euro Truck Simulator 2 support (#266): cabotage.
 *
 * A German-based company, run through real loads: board, dispatch, close-out. Inside the EU the period an
 * international delivery opens allows three domestic loads in seven days, one after arriving somewhere else
 * empty, then four days off. The UK allows two after a laden entry and none after an empty one; Switzerland
 * none at all. Refused with the reason, never authorised - and none of it on ATS.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5980}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
let odo = 100000;

/** Stand somewhere fresh, put one load on the board and read dispatch's verdict on it. */
async function judge(day, [oc, os], [dc, ds], hm = '06:00') {
  await api('/status', 'POST', { locationCity: oc, locationState: os, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 100, atsOdometer: odo, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(day, hm),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0 });
  const state = await api('/export');
  if ((state.restartOrders || []).some((o) => o.status !== 'Completed')) { state.restartOrders = []; await api('/import', 'POST', state); }
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'Shipper', receiver: 'Receiver',
    originCity: oc, originState: os, destCity: dc, destState: ds, loadedMiles: 180, deadheadMiles: 0, gameRevenue: 2500,
    deadlineHours: 40, weightLbs: 30000, atLocation: true });
  const d = await api('/board/evaluate');
  const e = (d.evaluations || [])[0];
  return { e, fails: (e?.hardFails || []).join(' || '), pros: (e?.pros || []).join(' || ') };
}

/** Take a judged load and deliver it. */
async function run(day, from, to) {
  const j = await judge(day, from, to);
  if (j.fails) return { ...j, delivered: false };
  const r = await api('/dispatch/authorize', 'POST', { loadId: j.e.load.id, overrideTight: true });
  const trip = r.trip;
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'BeginLoad', gameTime: iso(day, '07:00') });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'EndLoad', gameTime: iso(day, '08:00') });
  odo += 180;
  await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: iso(day, '13:00'), endOdometer: odo, actualMiles: 180,
    truckDamageAfter: 1, trailerDamageAfter: 1 });
  return { ...j, delivered: true };
}

(async () => {
  const app = { driverName: 'J. Weber', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(7) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('0. ATS has no cabotage');
  let j = await judge(8, ['Dallas', 'TX'], ['Houston', 'TX']);
  ok('a load inside Texas is just a load', !/abotage/.test(j.fails + j.pros), j.fails.slice(0, 80) || 'no refusal');

  // Re-open as an ETS2 career based in Germany.
  const st = await api('/export');
  st.game = 'ETS2';
  const hq = st.company.terminals[0];
  Object.assign(hq, { city: 'Frankfurt am Main', state: 'DE', isHeadquarters: true });
  st.driver.homeTimeIntervalDays = 28;
  st.settings.runnableStates = [];         // the game's own default: every country
  await api('/import', 'POST', st);

  head('1. Home and between countries: never limited');
  j = await judge(8, ['Berlin', 'DE'], ['München', 'DE']);
  ok('a domestic load at home is fine', !j.fails, j.fails.slice(0, 90) || 'no refusal');
  j = await judge(8, ['Berlin', 'DE'], ['Praha', 'CZ']);
  ok('an international load is fine', !j.fails, j.fails.slice(0, 90) || 'no refusal');

  head('2. Inside a foreign country, cabotage only follows an international delivery there');
  j = await judge(8, ['Lyon', 'FR'], ['Paris', 'FR']);
  ok('a load inside France, with no delivery into France, is refused', /has not delivered an international load/.test(j.fails), j.fails.slice(0, 120));
  j = await judge(8, ['Zürich', 'CH'], ['Bern', 'CH']);
  ok('and inside Switzerland it is banned outright', /Switzerland bans cabotage/.test(j.fails), j.fails.slice(0, 120));

  head('3. An international delivery into France opens three loads in seven days');
  let r = await run(9, ['Frankfurt am Main', 'DE'], ['Lyon', 'FR']);
  ok('Frankfurt to Lyon delivered', r.delivered, r.fails.slice(0, 100));
  let c = (await api('/bootstrap')).views.cabotage;
  ok('the board shows the period', /Cabotage in France: 3 of 3/.test(c?.note || ''), c?.note);
  for (let n = 1; n <= 3; n++) {
    r = await run(9 + n, ['Lyon', 'FR'], ['Paris', 'FR']);
    ok(`cabotage load ${n} in France is allowed and said`, r.delivered && new RegExp(`load ${n} of 3`).test(r.pros), r.pros.slice(0, 100) || r.fails.slice(0, 100));
    if (n < 3) {   // stand back in Lyon for the next one
    }
  }
  j = await judge(13, ['Lyon', 'FR'], ['Paris', 'FR']);
  ok('a fourth is refused', /all 3 loads allowed/.test(j.fails), j.fails.slice(0, 120));

  head('4. Another country entered empty: one load, within three days');
  // A fresh period, then an empty run into Belgium.
  await run(14, ['Paris', 'FR'], ['Berlin', 'DE']);        // home: ends the French period
  r = await run(15, ['Frankfurt am Main', 'DE'], ['Lyon', 'FR']);
  j = await judge(16, ['Brussel', 'BE'], ['Antwerpen', 'BE']);
  ok('one Belgian load is allowed after arriving empty', !j.fails && /after arriving empty/.test(j.pros), j.pros.slice(0, 110) || j.fails.slice(0, 110));
  r = await run(16, ['Brussel', 'BE'], ['Antwerpen', 'BE']);
  j = await judge(16, ['Antwerpen', 'BE'], ['Brussel', 'BE'], '18:00');
  ok('but only one, and it says why', /one load allowed after arriving there empty is used/.test(j.fails), j.fails.slice(0, 120));

  head('5. Leaving starts four days off');
  await run(17, ['Lyon', 'FR'], ['Berlin', 'DE']);
  c = (await api('/bootstrap')).views.cabotage;
  ok('France is on its four days off', (c?.cooling || []).some((x) => x.country === 'FR'), JSON.stringify(c?.cooling));
  r = await run(18, ['Frankfurt am Main', 'DE'], ['Lyon', 'FR']);
  j = await judge(19, ['Lyon', 'FR'], ['Paris', 'FR']);
  ok('so a French load is refused even after a new delivery in', /four days off/.test(j.fails), j.fails.slice(0, 120));
  j = await judge(24, ['Lyon', 'FR'], ['Paris', 'FR']);
  ok('until the days off are over', !/four days off/.test(j.fails) && /abotage/.test(j.fails + j.pros), (j.fails || j.pros).slice(0, 120));

  head('6. The UK: two after a laden entry, none after an empty one');
  await run(25, ['Calais', 'FR'], ['London', 'UK']);
  r = await run(26, ['London', 'UK'], ['Manchester', 'UK']);
  ok('a first UK load', r.delivered, r.fails.slice(0, 100));
  r = await run(27, ['Manchester', 'UK'], ['Birmingham', 'UK']);
  ok('a second', r.delivered, r.fails.slice(0, 100));
  j = await judge(28, ['Birmingham', 'UK'], ['London', 'UK']);
  ok('a third is refused', /all 2 loads allowed/.test(j.fails), j.fails.slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
