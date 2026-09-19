/* The driving day stops short of the clock, so there is time to find somewhere to sit.
 *
 *   "When I look at the HOS plan for a load it seems to take the drive right up to 0 HOS. This isn't
 *    really right — a player has to find a truck stop, and in ATS truck stops aren't as plentiful as in
 *    real life, so running up to like 15 mins left isn't a good plan. I try to stop with about an hour
 *    left."
 *
 * The planner drove every clock to nought and rested on the spot. That is a plan that ends wherever the
 * eleventh hour happens to end: the hard shoulder, an exit ramp, a mile short of a lot that turns out to
 * be full. Nobody drives that way and the app should not plan it.
 *
 * Settings.ParkingBufferHours already existed and already meant exactly this — "time reserved at the end
 * of a shift to find legal parking" — and was read in four places against the DELIVERY DEADLINE and in
 * none against the driving. So the app would refuse a load for arriving too late to park afterwards
 * while cheerfully planning three overnight stops with fifteen minutes in hand for each of them.
 *
 * The reserve applies only where the CLOCK is what ends the leg. Where the task finishes first the driver
 * is arriving at a shipper, a receiver or the yard and parks there — reserving against that would refuse
 * the last twenty minutes of a run for nothing.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (d, hm = '06:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;

/** Put the driver on a full clock and price one load. */
async function plan(miles, deadlineHours, clocks = {}) {
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70, ...clocks,
  });
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Machinery', originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: 'Chicago', destState: 'IL', loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: Math.round(miles * 2.4), deadlineHours, weightLbs: 38000,
  });
  return (r.evaluations || [])[0];
}

/** Longest unbroken run of Drive steps before a Rest, in hours. */
function longestDrivingDay(f) {
  let run = 0, best = 0;
  for (const st of f.timeline || []) {
    if (st.kind === 'Drive') run += st.hours;
    else if (st.kind === 'Rest') { best = Math.max(best, run); run = 0; }
  }
  return Math.max(best, run);
}

(async () => {
  const app = { driverName: 'H. Ndiaye', preferredDivision: 'Dry Van', experienceYears: 7,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  const buffer = S.settings.parkingBufferHours;
  ok('a parking buffer is on the settings', buffer > 0, `${buffer} h`);
  ok('and it is about the hour the driver asked for', buffer >= 0.75 && buffer <= 1.5, `${buffer} h`);

  head('1. A run long enough to need an overnight stops short of the clock');
  // Far enough that the eleven runs out well before the freight does, so the plan has to put a reset in.
  const long = await plan(1400, 96);
  const f = long?.feasibility;
  console.log(`  ..    ${f?.verdict}, ${f?.restsRequired} rest(s), ${f?.driveHours?.toFixed?.(1)} h driving`);
  ok('the plan needs at least one overnight', f?.restsRequired >= 1, `${f?.restsRequired} rest(s)`);
  ok('it says a parking reserve was applied', f?.parkingReserveApplied === true,
    `${f?.parkingReserveApplied}`);

  const day = longestDrivingDay(f);
  console.log(`  ..    longest driving day ${day.toFixed(2)} h against an 11-hour limit`);
  ok('no driving day runs the clock to nought', day <= 11 - buffer + 0.02,
    `${day.toFixed(2)} h, limit 11 less ${buffer}`);
  ok('and it is not stopping absurdly early either', day >= 11 - buffer - 0.5,
    `${day.toFixed(2)} h`);

  head('2. Arriving somewhere is not looking for parking');
  // The nuance the whole thing turns on. A driver twenty minutes from the receiver with forty minutes
  // left goes and delivers; they do not park short of it to preserve a reserve they will not need.
  // Window to spare and the drive clock tight: the drive is what is under test, so the dock work has to
  // fit or RestBeforeDock inserts a reset for a reason that has nothing to do with parking.
  const shortHop = await plan(35, 24, { driveRemaining: 0.9, shiftRemaining: 7, breakRemaining: 8 });
  const sf = shortHop?.feasibility;
  console.log(`  ..    ${sf?.verdict}, ${sf?.restsRequired} rest(s), ${sf?.driveHours?.toFixed?.(2)} h driving`);
  ok('a short run inside the clock is still feasible', sf?.verdict !== 'Infeasible', sf?.verdict);
  ok('it needs no reset to get there', sf?.restsRequired === 0, `${sf?.restsRequired} rest(s)`);
  ok('and no reserve was held back, because nobody is going looking',
    sf?.parkingReserveApplied !== true, `${sf?.parkingReserveApplied}`);

  head('3. Too little clock to be worth rolling means park now');
  // Under the reserve with real distance to cover: driving twenty minutes to burn the clock down is how
  // a driver ends up hunting for a space with nothing in hand to reach the next one.
  const stub = await plan(600, 72, { driveRemaining: 0.5, shiftRemaining: 3, breakRemaining: 8 });
  const tf = stub?.feasibility;
  console.log(`  ..    ${tf?.verdict}, ${tf?.restsRequired} rest(s), first step ${tf?.timeline?.[0]?.kind}`);
  ok('the plan opens by taking the ten rather than nibbling at it',
    (tf?.timeline || []).findIndex((x) => x.kind === 'Rest')
      <= (tf?.timeline || []).findIndex((x) => x.kind === 'Drive' && x.hours > 0.1),
    (tf?.timeline || []).slice(0, 3).map((x) => `${x.kind} ${x.hours}h`).join(' → '));

  head('4. The reserve is what the setting says, and is capped');
  // A typo in Settings should not silently halve the day, so it is clamped to a quarter of the drive
  // limit. Beyond that it is a rule set nobody asked for.
  let st = await api('/export');
  st.settings.parkingBufferHours = 8;      // absurd on an 11-hour limit
  S = un(await api('/import', 'POST', st));
  const capped = await plan(1400, 96);
  const cf = capped?.feasibility;
  const cappedDay = longestDrivingDay(cf);
  console.log(`  ..    longest driving day ${cappedDay.toFixed(2)} h with an 8 h buffer asked for`);
  ok('a nonsense buffer does not eat the whole day', cappedDay >= 11 * 0.75 - 0.02,
    `${cappedDay.toFixed(2)} h — clamped to a quarter of the limit`);

  st = await api('/export');
  st.settings.parkingBufferHours = 0;      // switched off entirely
  S = un(await api('/import', 'POST', st));
  const none = await plan(1400, 96);
  const nf = none?.feasibility;
  console.log(`  ..    longest driving day ${longestDrivingDay(nf).toFixed(2)} h with the buffer off`);
  ok('setting it to zero puts the old behaviour back', longestDrivingDay(nf) > 11 - 0.02,
    `${longestDrivingDay(nf).toFixed(2)} h`);
  ok('and nothing claims a reserve was applied', nf?.parkingReserveApplied !== true,
    `${nf?.parkingReserveApplied}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
