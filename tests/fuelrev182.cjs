/* #181 / #182 — the damage figure the safety ladder grades from, and fuel in the reviews.
 *
 * #181: RecordIncident derives severity from DamageIncurredPct and only from it. The form never sent
 *       the field, so the branch never ran, severity was always the driver's own dropdown pick, and the
 *       whole of the damage-graded ladder was unreachable from the app.
 * #182: Fuel.Assess had one caller, PayEngine — so it existed only on a settlement, after the period was
 *       over and the money decided. Nothing told a driver how they were driving while they could still
 *       do something about it, and nothing told them their scale pays no bonus at all.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5872}/api`;
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
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

const H = require('./lib/helpers.cjs');
let day = 2;
let S;

const app = { driverName: 'M. Vasquez', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 8, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
  homeTimePreference: 'biweekly' };

async function place(city, st, d, kind = 'TruckStop') {
  day = d;
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: at(d),
    fuelPct: 70, atsOdometer: 100000 + d * 400, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  }));
  return S;
}

/** A run with a fuel stop on it, so there is something to judge the driving and the buying on. */
async function runLoad(destCity, destState, { gallons, price, state }) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 600, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 240, weightLbs: 40000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 600, endOdometer: 0, actualRevenue: 2400,
    fuelStops: [{ gallons, pricePerGal: price, city: destCity, state }],
    tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done;
}

(async () => {
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1), code: 'WER' }));
  await place('Kansas City', 'MO', 2, 'Terminal');

  head('1. #181 The damage figure is what grades an incident');
  // A 2% scrape and a 26% wreck used to walk the same ladder, because severity was whatever the caller
  // passed. Derived from damage now — and the form had no field for it, so nothing ever derived.
  const scrape = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Major', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 2, description: 'Clipped a bollard', locationCity: 'Kansas City', locationState: 'MO',
  });
  ok('a 2% knock is graded Minor however it was filed', scrape.incident.severity === 'Minor',
    `filed as Major, graded ${scrape.incident.severity}`);

  const wreck = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Minor', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 26, description: 'Rolled it on a grade', locationCity: 'Kansas City', locationState: 'MO',
  });
  ok('and a wreck cannot be filed as Minor', wreck.incident.severity === 'Major',
    `filed as Minor, graded ${wreck.incident.severity}`);

  head('1b. But an event with no damage in it keeps the severity it was given');
  // A citation or a fatigue call has no damage to grade from. Overriding those to Minor anyway would be
  // the app inventing a reading in the one direction that lets something off.
  const cite = await api('/incidents', 'POST', {
    kind: 'Citation', severity: 'Moderate', faultAttribution: 'Driver', preventable: true,
    description: 'Logbook citation at a scale', locationCity: 'Kansas City', locationState: 'MO',
  });
  ok('an ungraded event stands as reported', cite.incident.severity === 'Moderate',
    cite.incident.severity);
  ok('and it is marked as having no damage figure', cite.incident.damageIncurredPct < 0,
    `${cite.incident.damageIncurredPct}`);

  head('1c. The noise floor is company policy, not a magic number');
  const m = (await api('/bootstrap')).settings.maintenance;
  ok('the floor is on the settings the form can read', m.incidentNoiseFloorPct > 0,
    `${m.incidentNoiseFloorPct}%`);
  const paint = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Minor', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 0.4, description: 'Traffic clipped the mirror', locationCity: 'Kansas City', locationState: 'MO',
  });
  ok('under it, the event is logged and nothing else', paint.incident.severity === 'None',
    `${paint.incident.damageIncurredPct}% -> ${paint.incident.severity}`);
  ok('and no discipline attaches to it', !paint.action, paint.action?.level || 'none');

  head('2. #182 Fuel is in the fortnightly probation review');
  // Werner rates its tractors around 6.5. Six hundred miles on sixty gallons is 10 mpg, comfortably
  // over, so the economy half has something to say FOR the driver.
  //
  // A fresh seat: the wreck above ended the last one, which is the point of section 1 and inconvenient
  // here. Re-hiring does not clear a safety record, but nothing in this section reads one.
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(40), code: 'WER' }));
  await place('Kansas City', 'MO', 41, 'Terminal');

  // Reviews are written when the driver reports in at their OWN yard, not at any terminal — that is
  // the whole shape of the thing, somebody going through the period with them face to face.
  const yard = (S.company.terminals || []).find((x) => x.id === S.driver.homeTerminalId)
            || (S.company.terminals || [])[0];
  const [hCity, hState] = [yard.city, yard.state];
  console.log(`     home yard: ${hCity}, ${hState}`);

  for (const [c, st] of [['Tulsa', 'OK'], [hCity, hState], ['Tulsa', 'OK'], [hCity, hState]]) {
    await runLoad(c, st, { gallons: 60, price: 3.2, state: st });
  }
  await place(hCity, hState, day + 3, 'Terminal');

  const pr = ((await api('/bootstrap')).views.probation?.reviews || [])[0];
  ok('a probation review was written', !!pr, pr ? pr.number : '(none)');
  const said = [...(pr?.strengths || []), ...(pr?.concerns || [])].join(' | ');
  ok('and it talks about fuel economy', /mpg/i.test(said), said.slice(0, 220) || '(silent on fuel)');
  ok('measured against what the truck is rated for, not the driver own average',
    /rated/i.test(said), said.slice(0, 200));

  head('3. And the review says what the scale pays, so nobody waits on a bonus');
  const pay = (await api('/bootstrap')).driver.pay;
  const paysEconomy = pay.fuelEfficiencyBonusCpm > 0;
  ok('the scale is readable either way', typeof pay.fuelEfficiencyBonusCpm === 'number',
    `economy ${pay.fuelEfficiencyBonusCpm}/mi, buying share ${pay.fuelSavingShare}`);
  ok(paysEconomy
    ? 'it pays for economy, and the review names the bonus rather than staying quiet'
    : 'it pays nothing for economy, and the review says so rather than leaving them waiting',
    paysEconomy ? /economy bonus is for/i.test(said) : /not coming|shows up here/i.test(said),
    said.slice(0, 220));

  head('4. And it carries on after probation, in the periodic review');
  // Clearing probation should not stop the company telling somebody how they are driving. The periodic
  // review runs on a sixty-day cycle, so the clock has to go past one.
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  // Four runs again rather than two: FuelReview refuses to judge a period with under 150 gallons in
  // it, because a confident mpg off one splash of fuel is a figure invented from almost no data.
  for (const [c, st] of [['Tulsa', 'OK'], [hCity, hState], ['Tulsa', 'OK'], [hCity, hState]]) {
    await runLoad(c, st, { gallons: 60, price: 3.2, state: st });
  }
  // Away first. Only ARRIVING at the yard writes a review — sitting on it and reporting clocks each
  // morning is one home time, not four — so a driver already parked there is not arriving at anything.
  await place('Tulsa', 'OK', day + 60);
  await place(hCity, hState, day + 4, 'Terminal');

  const per = ((await api('/bootstrap')).views.periodicReviews || [])[0];
  ok('a periodic review was written', !!per, per ? per.number : '(none)');
  const laterSaid = [...(per?.strengths || []), ...(per?.concerns || [])].join(' | ');
  ok('and fuel is in it too', /mpg/i.test(laterSaid),
    laterSaid.slice(0, 220) || '(silent on fuel)');
  ok('judged against the rating there as well', /rated/i.test(laterSaid),
    laterSaid.slice(0, 240));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
