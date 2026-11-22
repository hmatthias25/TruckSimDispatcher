/* Home by the date, checked on every board (asked for from play, v0.89).
 *
 * Bowling Green, KY, four days from home time and half a day from the yard: under the three-quarters mark, not tight,
 * so none of the home-time rules had switched on — and dispatch authorised Tucson, 1,645 miles west with as far again
 * back. A load is now refused when its finish plus the run home empty lands after the date, due soon or not.
 *
 *   - four days out: the westbound run is refused, said why; a short load toward home is taken
 *   - a fortnight out: the same westbound run is fine
 *   - the board from play: Tucson refused, and Raton too — home only with hours to spare, empty all the way
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5983}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

async function career(gameTime, code = 'PRI', homeCity = 'Springfield', homeState = 'MO') {
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: false });
  const app = { driverName: 'H. Ome', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity, homeState, acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T07:00', code });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', { locationCity: 'Bowling Green', locationState: 'KY', locationKind: 'Receiver', gameTime,
    fuelPct: 100, atsOdometer: 9000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
}
const load = (o) => ({ cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', deadheadMiles: 0, weightLbs: 30000,
  atLocation: false, originCity: 'Bowling Green', originState: 'KY', ...o });
const board = () => [
  load({ destCity: 'Medford', destState: 'OR', loadedMiles: 2281, gameRevenue: 9000, deadlineHours: 105 }),
  load({ destCity: 'Kansas City', destState: 'MO', loadedMiles: 520, gameRevenue: 1500, deadlineHours: 30 }),
];
// The board from play: Bowling Green, home time in Chicago four days off.
const played = () => [
  load({ destCity: 'Tucson', destState: 'AZ', loadedMiles: 1645, gameRevenue: 4507, deadlineHours: 78.35, appointmentOpensHours: 71.68 }),
  load({ destCity: 'Raton', destState: 'NM', loadedMiles: 1142, gameRevenue: 3084, deadlineHours: 55.28, appointmentOpensHours: 48.62 }),
  load({ destCity: 'Eau Claire', destState: 'WI', loadedMiles: 654, gameRevenue: 2105, deadlineHours: 32.82, appointmentOpensHours: 26.15 }),
  load({ destCity: 'Macon', destState: 'MO', loadedMiles: 380, gameRevenue: 985, deadlineHours: 15.55, appointmentOpensHours: 8.88 }),
];

(async () => {
  head('1. Four days from home time');
  await career('2000-01-11T03:00');
  const hs = (await api('/bootstrap')).views.homeTime;
  ok('home time not yet "due soon"', !hs.dueSoon && !hs.tight && !hs.overdue, `${hs.daysUntilDue?.toFixed?.(1)} days left`);
  let d = (await api('/board/add-many', 'POST', board())).decision;
  const tucson = d.evaluations.find((e) => e.load.destCity === 'Medford');
  ok('Medford refused for missing the date', tucson && (tucson.homeTimeFails || []).some((f) => /after your home time falls due/.test(f)),
    tucson && (tucson.homeTimeFails || []).join(' | ').slice(0, 260));
  const pick = d.evaluations.find((e) => e.load.id === d.authorizedLoadId);
  ok('the load toward home is taken instead', pick && pick.load.destCity === 'Kansas City', d.headline);

  head('2. A fortnight from home time');
  await career('2000-01-02T03:00');
  d = (await api('/board/add-many', 'POST', board())).decision;
  const t2 = d.evaluations.find((e) => e.load.destCity === 'Medford');
  ok('Medford is fine with the time to do it', t2 && (t2.homeTimeFails || []).length === 0, (t2?.homeTimeFails || []).join(' | '));

  head('3. The board from play: Bowling Green, Chicago four days off');
  await career('2000-01-11T03:42', 'SNI', 'Chicago', 'IL');
  const h3 = (await api('/bootstrap')).views.homeTime;
  ok('home time not yet due soon', !h3.dueSoon && !h3.tight, `${h3.terminalLabel}, ${h3.daysUntilDue?.toFixed?.(1)} days`);
  d = (await api('/board/add-many', 'POST', played())).decision;
  const west = d.evaluations.filter((e) => ['Tucson', 'Raton'].includes(e.load.destCity));
  ok('Tucson and Raton refused', west.length === 2 && west.every((e) => (e.homeTimeFails || []).length > 0),
    west.map((e) => `${e.load.destCity}: ${(e.homeTimeFails || [])[0] || 'allowed'}`).join(' | ').slice(0, 400));
  const p3 = d.evaluations.find((e) => e.load.id === d.authorizedLoadId);
  ok('a load toward home is taken', p3 && ['Eau Claire', 'Macon'].includes(p3.load.destCity), d.headline);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
