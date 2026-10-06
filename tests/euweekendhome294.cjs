/* The run home through a weekend ban (reported from play, v0.83): authorised to run home at 13:20 on a Saturday,
 * eleven hours out on six of driving, and the reposition order said nothing about Austria's ban from Saturday 15:00
 * or Germany's on Sunday. An empty run was a destination and a distance; only freight was planned.
 *
 *   - a country in the middle of a leg is seen: Maribor to Frankfurt goes through Austria, not half Slovenia and
 *     half Germany
 *   - the run home is planned like a load, and the order says when to be parked, where, and until when
 *   - a ban sat for a day or more is the weekly rest — a second reduced one in a row is allowed for it abroad
 *   - freight on the same road is held at the same border
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
// Day 1 is a Monday, so day 6 is a Saturday.
const SAT = '2000-01-06T13:20';
const steps = (f) => (f?.timeline || []).map((x) => `${x.startGameTime.slice(8)} ${x.label} [${x.kind}]`).join(' | ');

(async () => {
  const app = { driverName: 'C. Weber', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 3, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  // The last weekly rest was a reduced one, as it was in play.
  await api('/status', 'POST', { locationCity: 'Maribor', locationState: 'SI', locationKind: 'Receiver', gameTime: SAT,
    fuelPct: 100, atsOdometer: 4000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 6, shiftRemaining: 9, breakRemaining: 4.5, cycleRemaining: 16, asOfGameTime: SAT,
    euWeekDriven: 40, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 60, euLastWeeklyRestReduced: true, euCompensationOwed: 20, spreadEstimated: false });
  const S = await api('/bootstrap');
  const yard = S.company.terminals.find((t) => t.id === S.driver.homeTerminalId) || S.company.terminals[0];

  head('1. The run home from Maribor on a Saturday afternoon');
  const r = await api('/moves', 'POST', { destCity: yard.city, destState: yard.state, miles: 0, reason: 'Run home for home time.', kind: 'EmptyMove' });
  const f = r.trip.feasibilityAtDispatch;
  ok('the order is planned', !!f && (f.timeline || []).length > 0, steps(f).slice(0, 200));
  ok('it says to be parked in Austria by 15:00', /Be parked in Austria by Sat Day 6 · (14:59|15:00)/.test(r.trip.authorizationRationale), r.trip.authorizationRationale);
  ok('and until Sunday 22:00', /until Sun Day 7 · 22:00/.test(r.trip.authorizationRationale));
  ok('the plan is said once', (r.trip.authorizationRationale.match(/Be parked/g) || []).length === 1, r.trip.authorizationRationale);
  ok('an empty run: no slack, no window, no dock', f.emptyRun === true && !f.dockAdvice
     && !(f.warnings || []).some((w) => /before it is due|reduced to 24/.test(w)), (f.warnings || []).join(' | '));
  const ban = (f.timeline || []).find((x) => /Austria's truck ban/.test(x.label));
  ok('the ban is sat as a reduced weekly rest', ban && ban.kind === 'Restart' && /reduced weekly rest/.test(ban.label), ban?.label);
  ok('allowed as a second in a row, with home time the full one', /second reduced one in a row/.test(ban?.label || '') && /your home time/.test(ban?.label || ''));
  ok('not held past the ban', ban && ban.endGameTime === '2000-01-07T22:00', ban?.endGameTime);
  ok('and it says when it gets there', /You get there (Mon|Tue) Day 8/.test(r.trip.authorizationRationale), r.trip.authorizationRationale.slice(-80));

  head('2. Freight on the same road meets the same border');
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Maribor', originState: 'SI',
    destCity: yard.city, destState: yard.state, loadedMiles: 750 / 1.609344, deadheadMiles: 0, gameRevenue: 1500, weightLbs: 30000, atLocation: true, deadlineHours: 72 });
  const lf = d.evaluations[0].feasibility;
  ok('the load waits out Austria too', (lf.timeline || []).some((x) => /Austria's truck ban/.test(x.label)), steps(lf).slice(0, 400));

  head('3. Two countries and no third: the halfway border, as before');
  await api('/status', 'POST', { locationCity: 'Salzburg', locationState: 'AT', locationKind: 'Receiver', gameTime: '2000-01-05T08:00',
    fuelPct: 100, atsOdometer: 4500, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/board/clear', 'POST', {});
  const m = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Salzburg', originState: 'AT',
    destCity: 'Munich', destState: 'DE', loadedMiles: 145 / 1.609344, deadheadMiles: 0, gameRevenue: 500, weightLbs: 30000, atLocation: true, deadlineHours: 24 });
  const mf = m.evaluations[0].feasibility;
  ok('a Friday run with no ban in the way', !(mf.timeline || []).some((x) => /truck ban/.test(x.label)), steps(mf));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
