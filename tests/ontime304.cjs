/* A board with a deliverable load on it is not rejected (reported from play, v0.86, on probation): "THEN THIS IS STILL
 * A REJECTION FOR A PROBATIONARY DRIVER — what am I supposed to do, just drive around randomly?"
 *
 *   - nothing clears the buffer but one load makes the window: it is booked, and the thin margin is said
 *   - a fuel stop takes no time of its own — it goes on a break or a rest — and is still counted and said
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
const un = (r) => r.snapshot || r;

(async () => {
  const app = { driverName: 'O. Time', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;
  await api('/status', 'POST', { locationCity: 'Denver', locationState: 'CO', locationKind: 'TruckStop', gameTime: '2000-01-03T06:00',
    fuelPct: 40, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const load = (over) => ({ cargo: 'Paper', trailerType: type, shipper: 'S', receiver: 'R', atLocation: false,
    originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 5, gameRevenue: 2600, weightLbs: 30000, deadlineHours: 48, ...over });

  head('1. One load, inside its window but short of the buffer');
  await api('/board/clear', 'POST', {});
  // Find a deadline that leaves it on time but under the buffer.
  let d = await api('/board/add', 'POST', load({}));
  const gateAfter = (48 - d.evaluations[0].feasibility.slackHours);
  await api('/board/clear', 'POST', {});
  d = await api('/board/add', 'POST', load({ deadlineHours: Math.round((gateAfter + 0.8) * 100) / 100 }));
  const e = d.evaluations[0];
  ok('it is tight: on time, short of the buffer', e.feasibility.verdict === 'Tight' && e.feasibility.slackHours >= 0,
    `${e.feasibility.verdict}, slack ${e.feasibility.slackHours}`);
  ok('and it is booked, not the board rejected', d.authorizedLoadId === e.load.id && !d.rejectAll, d.headline);
  ok('saying how thin it is', (d.dispatchNotes || []).some((n) => /still makes the window/.test(n)), (d.dispatchNotes || []).join(' | ').slice(0, 200));

  head('2. A run long enough to need fuel');
  await api('/board/clear', 'POST', {});
  d = await api('/board/add', 'POST', load({ destCity: 'Charlotte', destState: 'NC', loadedMiles: 1900, deadlineHours: 120 }));
  const f = d.evaluations[0].feasibility;
  ok('the fuel stop is counted', f.fuelStopsRequired >= 1, `${f.fuelStopsRequired}`);
  ok('it takes no time of its own', !f.timeline.some((t) => /Fuel stop/.test(t.label) && t.hours > 0),
    f.timeline.filter((t) => /Fuel/.test(t.label)).map((t) => `${t.label} ${t.hours}`).join(', ') || 'no fuel step');
  ok('and it is said: take it on a break or a rest', (f.warnings || []).some((w) => /on a break or a rest|on your breaks or rests/.test(w)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
