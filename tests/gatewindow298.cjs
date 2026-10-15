/* The window is judged at the gate (asked for from play, v0.86): a driver on fresh clocks in Dresden was shut out of a
 * 32-load board, because every plan took the unload and an hour's parking allowance off its slack — hours the close-out
 * never counts, since a delivered load is graded on when it arrived.
 *
 *   - a load that reaches the gate with the buffer in hand is feasible, though the unload runs past the window close
 *   - one that reaches the gate after the window closes is refused, and the refusal says "at the gate"
 *   - the briefing says how long after getting there the window closes
 *   - on an ATS career and an ETS2 one
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
const iso = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const hours = (a, b) => (Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 3600000;

async function story(name, eu, A, Bp) {
  const t0 = iso(3, '06:00');
  await api('/status', 'POST', { locationCity: A.city, locationState: A.state, locationKind: 'Shipper', gameTime: t0,
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', eu
    ? { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: t0, euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false }
    : { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  const add = async (deadlineHours) => {
    await api('/board/clear', 'POST', {});
    const b = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
      originCity: A.city, originState: A.state, destCity: Bp.city, destState: Bp.state,
      loadedMiles: 120, deadheadMiles: 0, gameRevenue: 1500, weightLbs: 30000, atLocation: true, deadlineHours });
    return b.evaluations[0];
  };

  head(`${name}: 1. Where the gate falls`);
  let e = await add(48);
  const gate = e.feasibility.projectedDockStartGameTime, done = e.feasibility.projectedArrivalGameTime;
  const toGate = hours(t0, gate), toDone = hours(t0, done);
  ok('the plan has a gate time before the end of the unload', gate && toDone > toGate, `gate ${gate}, done ${done}`);

  head(`${name}: 2. At the gate with the buffer in hand, unloading past the close`);
  e = await add(Math.round((toGate + 2.5) * 100) / 100);
  ok('feasible', e.feasibility.verdict === 'Feasible', `${e.feasibility.verdict} ${JSON.stringify(e.feasibility.blockers)}`);
  ok('slack is to the gate: about 2:30', Math.abs(e.feasibility.slackHours - 2.5) < 0.05, `${e.feasibility.slackHours}`);
  // The old reckoning: to the end of the unload, less an hour's parking — short of the 2:00 buffer, so it was refused.
  const old = toGate + 2.5 - toDone - 1;
  ok('where counting the unload and parking would have refused it', old < 2, `old slack ${old.toFixed(2)}`);
  const d = await api('/board/evaluate');
  ok('the briefing says how long after getting there the window closes',
    (d.dispatchNotes || []).some((n) => /after you get there|of slack\./.test(n)), (d.dispatchNotes || []).join(' | ').slice(0, 300));

  head(`${name}: 3. At the gate after the close`);
  e = await add(Math.round((toGate - 0.5) * 100) / 100);
  ok('refused', e.feasibility.verdict === 'Infeasible', e.feasibility.verdict);
  ok('and it says so at the gate', (e.feasibility.blockers || []).some((x) => /^At the gate .* after the .* window closes/.test(x)),
    JSON.stringify(e.feasibility.blockers));
}

(async () => {
  const us = { driverName: 'G. Ate', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', us);
  await api('/onboarding/hire', 'POST', { application: us, force: true, gameTime: iso(1, '06:00') });
  await story('ATS', false, { city: 'Denver', state: 'CO' }, { city: 'Colorado Springs', state: 'CO' });

  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: false });
  const eu = { driverName: 'G. Tor', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', eu);
  await api('/onboarding/hire', 'POST', { application: eu, force: true, gameTime: iso(1, '06:00') });
  await story('ETS2', true, { city: 'Mannheim', state: 'DE' }, { city: 'Stuttgart', state: 'DE' });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
