/* #171 — what a preventable costs the PROBATION, not just the discipline ladder.
 *
 * #170 said a preventable during the period should extend it, that repeated ones end it, and that a
 * wreck ends it there and then. None of that was built: ProbationPlan.ExtendedDays went onto the model
 * and was written by nothing and read by nothing. So a 2% preventable on probation got a Coaching and
 * changed nothing about the period, and the driver was told neither way.
 *
 * Its own suite because it needs a clean safety record. Re-hiring does NOT clear one — only a
 * changeover does — so running these after other incident tests inherits their strikes and the second
 * event reads as the third.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5870}/api`;
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

let odo = 40000;
const boot = async () => api('/bootstrap');

const app = { driverName: 'R. Okonkwo', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 0, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
  homeTimePreference: 'biweekly' };

async function report(city, st, day) {
  odo += 100;
  return api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: 'TruckStop', gameTime: at(day),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 4, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 80000,
  });
}

/** The severity-weighted incident total the review counts, read off the progress row. */
function incidentWeight(snap) {
  const row = (snap.views.career?.probationProgress || []).find((r) => /incident/i.test(r.label || ''));
  return row ? Number(row.current) : NaN;
}

async function incident(o) {
  return api('/incidents', 'POST', {
    kind: 'Collision', locationCity: 'Kansas City', locationState: 'MO', ...o,
  });
}

(async () => {
  head('1. The reported scenario: 2% and preventable, on probation');
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) });
  await report('Kansas City', 'MO', 3);

  const p0 = (await boot()).driver.probation;
  ok('probation is running', p0.active === true, `${p0.durationDays} days`);
  ok('and nothing has been added to it yet', (p0.extendedDays || 0) === 0, `${p0.extendedDays} days added`);

  await incident({
    description: 'Clipped a bollard at the dock', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 2, truckDamagePctAfter: 6, gameTime: at(4),
  });
  const after = await boot();
  const inc = after.incidents[0];
  const p1 = after.driver.probation;

  ok('it grades Minor, not None', inc.severity === 'Minor', inc.severity);
  ok('and is marked as counting against the period', inc.countedOnProbation === true,
    `counted=${inc.countedOnProbation}`);
  ok('the driver is still employed', after.driver.status !== 'Terminated', after.driver.status);

  // Seeded, so it lands on one of two outcomes. Both are legitimate; saying nothing is not.
  const extended = p1.durationDays > p0.durationDays;
  ok('the outcome is stated, whichever way it went',
    /probation/i.test(inc.notes || ''), (inc.notes || '').slice(0, 150) || '(silent)');
  ok(extended ? 'the period was extended' : 'it was a warning and the date did not move',
    extended
      ? p1.extendedDays > 0 && /[0-9]+ days/.test(inc.notes || '')
      : p1.extendedDays === 0 && /not moving your review/i.test(inc.notes || ''),
    extended ? `+${p1.extendedDays} days -> ${p1.durationDays}` : (inc.notes || '').slice(0, 90));

  head('2. A second one ends it, whatever size either was');
  await incident({
    description: 'Kerbed it turning in', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 1.5, truckDamagePctAfter: 8, gameTime: at(6),
  });
  const two = await boot();
  ok('two light preventables in one period end it', two.driver.status === 'Terminated',
    two.driver.status);
  ok('and the reason names the pattern, not the damage',
    (two.driver.terminationReason || '').includes('pattern'),
    (two.driver.terminationReason || '').slice(0, 120));
  ok('the file and the message say the same thing',
    (two.driver.terminationReason || '').includes('second-chance'),
    (two.driver.terminationReason || '').slice(-80));

  head('3. A wreck ends it on its own');
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) });
  await report('Kansas City', 'MO', 3);
  await incident({
    description: 'Rolled it on a grade', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 26, truckDamagePctAfter: 30, gameTime: at(4),
  });
  const wreck = await boot();
  ok('one wreck during probation is the end of it', wreck.driver.status === 'Terminated',
    wreck.driver.status);
  ok('and it says where to go from here',
    (wreck.driver.terminationReason || '').includes('second-chance'),
    (wreck.driver.terminationReason || '').slice(-80));

  head('4. An unavoidable one costs the period nothing');
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) });
  await report('Kansas City', 'MO', 3);
  const p2 = (await boot()).driver.probation;
  const weightBefore = incidentWeight(await boot());
  await incident({
    description: 'AI turned across me', faultAttribution: 'Unavoidable', preventable: false,
    damageIncurredPct: 24, truckDamagePctAfter: 28, gameTime: at(4),
  });
  const ai = await boot();
  ok('a 24% hit that was not the driver fault does not end probation',
    ai.driver.status !== 'Terminated', ai.driver.status);
  ok('nor extend it', ai.driver.probation.durationDays === p2.durationDays,
    `${p2.durationDays} -> ${ai.driver.probation.durationDays}`);
  ok('and it is not marked as counting', ai.incidents[0].countedOnProbation === false,
    `counted=${ai.incidents[0].countedOnProbation}`);

  head('5. The review weighs what an event cost, rather than counting heads');
  // A light bump used to consume the same allowance as a rollover: both were "1 incident" against a
  // max of 1, so the damage tiers scaled the ladder and the review threw that away.
  //
  // Re-hiring does not clear a safety record, so the running total spans this whole suite. That is
  // what makes it a good measure of the weighting: two Minors and one Major should be 1 + 1 + 4.
  const weightAfter = incidentWeight(await boot());
  ok('an unavoidable event adds nothing to the allowance', weightAfter === weightBefore,
    `${weightBefore} -> ${weightAfter}`);
  ok('and the total is weighted by severity, not a count of events',
    weightAfter === 6, `two Minors and a Major = ${weightAfter} (expected 1 + 1 + 4)`);
  const prog = (await boot()).views.career?.probationProgress || [];
  const row = prog.find((r) => /incident/i.test(r.label || ''));
  ok('the allowance itself is a weight, not a headcount of one',
    row && Number(String(row.required).replace(/[^0-9.]/g, '')) >= 2,
    row ? `${row.label}: ${row.current} of ${row.required}` : '(no row)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
