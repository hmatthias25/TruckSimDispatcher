/* #167-#170 — four things reported from play.
 *
 *   167  a six-hour "sleep" credited a full 11 and 14, so every leg after it ran on hours that do
 *        not exist. Casper to Kansas City on five hours: the plan said sleep six and make it.
 *   168  a cancelled load paid the full loaded rate, because cancelled trips have no ActualMiles and
 *        ComputeTripPay falls through to DispatchedMiles
 *   169  probation was a streak of three reviews rather than a period
 *   170  a 1% pole scrape and a 30% rollover walked the same discipline ladder
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5869}/api`;
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

let S, odo = 40000;
const views = async () => (await api('/bootstrap')).views;
const boot = async () => api('/bootstrap');

async function report(city, st, day, o = {}) {
  odo += 100;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: 'TruckStop', gameTime: at(day),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 4, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 80000, ...o,
  });
  S = un(r);
  return r;
}

(async () => {
  const app = { driverName: 'L. Ferreira', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 0, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));

  head('1. #169 Probation is a period, not a streak');
  const p = S.driver.probation;
  ok('a rookie gets the full ninety', p.durationDays === 90, `${p.durationDays} days`);
  ok('it is the first attempt', p.attempt === 1, `${p.attempt}`);
  ok('the streak no longer gates it', !(p.passesRequired > 0), `passesRequired=${p.passesRequired}`);
  // Checked as a RATE against the period rather than as a magic total, so the assertion survives the
  // targets being retuned and says what it actually means.
  const weeks = p.durationDays / 7;
  ok('loads are scaled to the period', p.requiredLoads / weeks >= 2 && p.requiredLoads / weeks <= 3,
    `${p.requiredLoads} loads = ${(p.requiredLoads / weeks).toFixed(1)}/week`);
  ok('and so are miles', p.requiredMiles / weeks >= 900 && p.requiredMiles / weeks <= 1500,
    `${p.requiredMiles} mi = ${Math.round(p.requiredMiles / weeks)}/week`);

  head('2. #169 The driver is told when the verdict lands');
  await report('Kansas City', 'MO', 5);
  const pv = (await views()).probation;
  ok('there is a day count', pv.daysLeft > 0, `${pv.daysLeft.toFixed(1)} days left`);
  ok('and a date it ends on', (pv.endsOn || '').length > 0, pv.endsOn);
  ok('the notice says it happens at a home time', /home time/i.test(pv.notice || ''),
    (pv.notice || '').slice(0, 110));
  ok('and no review is owed yet', pv.reviewDue === false, `reviewDue=${pv.reviewDue}`);

  head('3. #169 Sitting it out does not clear it');
  // Ninety days pass with nothing delivered. The work test is what stops this being a way through.
  await report('Kansas City', 'MO', 95);
  const late = (await views()).probation;
  ok('the period is served', late.reviewDue === true, `daysLeft=${late.daysLeft.toFixed(1)}`);
  ok('but the work was not done, and it says so', (late.workDone || []).length > 0,
    (late.workDone || []).join(' | ').slice(0, 150));
  ok('the shortfall names the weeks, not just the totals',
    (late.workDone || []).some((x) => /week/i.test(x)),
    (late.workDone || []).find((x) => /week/i.test(x))?.slice(0, 120) || '(no week test)');

  head('4. #169 The bar is in the shape the driver runs');
  // A flat over-the-road figure would punish a local runner for the work they chose. Short runs mean
  // many deliveries and few miles; OTR the reverse. And switching mid-period has to move the bar.
  const before169 = (await boot()).driver.probation;
  await api('/career/trip-length', 'POST', { preference: 'short' });
  const shortP = (await boot()).driver.probation;
  ok('going local asks for more deliveries', shortP.requiredLoads > before169.requiredLoads,
    `${before169.requiredLoads} -> ${shortP.requiredLoads} loads`);
  ok('and fewer miles', shortP.requiredMiles < before169.requiredMiles,
    `${before169.requiredMiles} -> ${shortP.requiredMiles} mi`);

  await api('/career/trip-length', 'POST', { preference: 'otr' });
  const otrP = (await boot()).driver.probation;
  ok('going OTR asks for fewer deliveries', otrP.requiredLoads < shortP.requiredLoads,
    `${shortP.requiredLoads} -> ${otrP.requiredLoads} loads`);
  ok('and more miles', otrP.requiredMiles > shortP.requiredMiles,
    `${shortP.requiredMiles} -> ${otrP.requiredMiles} mi`);
  ok('the period itself does not move', otrP.durationDays === before169.durationDays,
    `${otrP.durationDays} days`);

  // The discipline ladder applies to everyone; probation has its own harsher rule that ends a
  // career at three strikes and would pre-empt the ladder before it could escalate. Clear it so
  // this suite tests the ladder rather than the probation rule.
  await api('/career/clear-probation', 'POST', { force: true, note: 'test setup' });

  head('5. #170 A pole scrape is not a rollover');
  const before = (await boot()).discipline.length;
  await api('/incidents', 'POST', {
    kind: 'Collision', description: 'Clipped a pole backing in', faultAttribution: 'Driver',
    preventable: true, damageIncurredPct: 0.6, truckDamagePctAfter: 4.6,
    locationCity: 'Kansas City', locationState: 'MO', gameTime: at(96),
  });
  const afterSmall = await boot();
  const smallInc = afterSmall.incidents[0];
  ok('the 0.6% event is logged', !!smallInc, smallInc?.number);
  ok('graded from the damage, not from the form', smallInc.severity === 'None', smallInc.severity);
  ok('and nothing is disciplined for it', afterSmall.discipline.length === before,
    `${afterSmall.discipline.length} action(s)`);

  head('6. #170 A wreck is');
  await api('/incidents', 'POST', {
    kind: 'Collision', description: 'Rolled it on a mountain grade', faultAttribution: 'Driver',
    preventable: true, damageIncurredPct: 28, truckDamagePctAfter: 32,
    locationCity: 'Denver', locationState: 'CO', gameTime: at(97),
  });
  const afterBig = await boot();
  const bigInc = afterBig.incidents[0];
  ok('28% grades as Major', bigInc.severity === 'Major', bigInc.severity);
  ok('and it lands high on the ladder, not at coaching',
    afterBig.discipline.length > before
    && !/Coaching/i.test(afterBig.discipline[0].level), afterBig.discipline[0]?.level || '(none)');

  head('7. #170 An unavoidable event costs nothing');
  const d2 = afterBig.discipline.length;
  await api('/incidents', 'POST', {
    kind: 'Collision', description: 'AI ran a light into me', faultAttribution: 'Unavoidable',
    preventable: false, damageIncurredPct: 22, truckDamagePctAfter: 54,
    locationCity: 'Denver', locationState: 'CO', gameTime: at(98),
  });
  const afterAi = await boot();
  ok('a 22% hit that was not the driver\'s costs nothing', afterAi.discipline.length === d2,
    `${afterAi.discipline.length} action(s)`);
  ok('but it is still on the record', afterAi.incidents.length > afterBig.incidents.length, 'logged');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
