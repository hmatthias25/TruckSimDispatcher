/* Rome to Dubrovnik (reported from play, v0.81): the game routes it over the Adriatic, by Ancona and Split, and
 * the listing's distance is that route's — far too short for the road, which goes round by Trieste. The app read
 * it as a short road run, arrived early, and sat a long wait for the window, with no ferry in the plan.
 *
 *   - a listing too short for the road round a sea is read as the ferry's route: the crossing is planned
 *   - the road option, where it is weighed, is at the road's real length, and the plan says which and why
 *   - a listing that is the road's own length plans by road, as before
 *   - Bari – Dubrovnik is a crossing; Trieste – Ancona and Trieste – Bari, not in the game's ferry list, are not
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
const steps = (f) => (f.timeline || []).map((t) => `${(t.startGameTime || '').slice(5)} ${t.label} [${t.kind} ${(+t.hours).toFixed(2)}]`).join(' | ');

async function plan(gameTime, miles, deadline) {
  await api('/status', 'POST', { locationCity: 'Rome', locationState: 'IT', locationKind: 'Shipper', gameTime,
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: gameTime,
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Rome', originState: 'IT',
    destCity: 'Dubrovnik', destState: 'HR', loadedMiles: miles, deadheadMiles: 0, gameRevenue: 5000, weightLbs: 30000, atLocation: true, deadlineHours: deadline });
  return d.evaluations[0].feasibility;
}

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Rome to Dubrovnik, 550 km listed, Thursday morning: the Ancona – Split crossing');
  // Day 4 is a Thursday: Ancona sails Monday and Thursday at 20:00.
  let f = await plan('2000-01-04T06:00', 550 / 1.609344, 72);
  const w = (f.warnings || []).join(' | ');
  ok('the plan crosses Ancona – Split', (f.crossingRoutes || []).includes('ancona-split'), steps(f));
  ok('and says the listing is the route over the water, with the road for comparison', /route over the water/.test(w) && /round the Adriatic by Trieste/.test(w), w.slice(0, 400));
  ok('no long sit for the window off a road run at the listing\'s length', !(f.timeline || []).some((t) => /Waiting for the receiver/.test(t.label) && t.hours > 12), steps(f));

  head('2. The road option is weighed at the road\'s length');
  // Friday: the next Ancona sailing is Monday. Whichever wins, the road is never planned at 550 km.
  f = await plan('2000-01-05T06:00', 550 / 1.609344, 120);
  const drove = (f.timeline || []).filter((t) => t.kind === 'Drive').reduce((a, t) => a + t.miles, 0);
  ok('either the crossing, or the road at well over the listing', (f.crossingRoutes || []).length > 0 || drove > 550 / 1.609344 * 1.5,
    `${(f.crossingRoutes || []).join(',') || 'road'}, ${Math.round(drove * 1.609344)} km driven`);

  head('3. A listing at the road\'s own length: by road, as before');
  f = await plan('2000-01-04T06:00', 1250 / 1.609344, 96);
  ok('no crossing forced on a road-length listing', !(f.warnings || []).some((x) => /route over the water/.test(x)), (f.warnings || []).join(' | ').slice(0, 200));

  head('4. Rome to Mostar (reported from play): Bari – Dubrovnik, and never Trieste – Ancona, which the game does not have');
  await api('/status', 'POST', { locationCity: 'Rome', locationState: 'IT', locationKind: 'Shipper', gameTime: '2000-01-04T14:00',
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: '2000-01-04T14:00',
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  const m = await api('/board/add', 'POST', { cargo: 'Fertilizer', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Rome', originState: 'IT',
    destCity: 'Mostar', destState: 'BA', loadedMiles: 1559 / 1.609344, deadheadMiles: 0, gameRevenue: 2089, weightLbs: 40000, atLocation: true, deadlineHours: 48 });
  f = m.evaluations[0].feasibility;
  // Thursday afternoon: Bari is reached that night, and the Friday 11:00 sailing is the one.
  ok('the Bari – Dubrovnik crossing, Friday 11:00', (f.crossingRoutes || []).includes('bari-dubrovnik') && (f.crossings || []).some((c) => /11:00 sailing/.test(c)), steps(f));
  ok('no Trieste – Ancona or Trieste – Bari', !(f.crossingRoutes || []).some((r) => /^trieste-(ancona|bari)$/.test(r)), (f.crossingRoutes || []).join(','));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
