/* What a load LEAVES on the seventy, which is not the same question as what is on it now.
 *
 *   "Just was given a load that will take 18:21 when I have 19:08 on my cycle. Good chance based on
 *    roads/conditions I will go over cycle. Why was I given this?"
 *
 * Because every piece of reset reasoning in the app reads Hos.CycleRemaining — the cycle the driver is
 * standing on — and none of it read CycleRemainingAfter, the cycle the load hands back. At 19:08 the
 * driver is comfortably above the eighteen-hour reset-watch line, so none of the reset positioning
 * engages; the load then drops them to forty-seven minutes, which is exactly the state that line exists
 * to plan for. The figure was computed, printed on the load card, and read by nothing at all.
 *
 * The driver's own reasoning is the part worth keeping: the plan runs at governed speed times a factor,
 * and real roads do not. A margin thinner than a tenth of the driving is inside the error bars on the
 * number it is being measured against, so "you will just make it" is not something the app is entitled
 * to say.
 *
 * NOTE ON THE TRAILER. These loads are flatbeds. Dock time only comes off the cycle where the driver
 * is working it — straps and tarps and hoses — and behind a van or a reefer they are in the bunk and it
 * does not (see TrailerSpec.WorksTheDock and dockduty.cjs). This suite is about the DRIVING eating the
 * seventy, so it names a trailer where the dock hours behave as they did when these numbers were set,
 * rather than quietly testing two things at once.
 *
 * It is a warning and a score, not a refusal. Running the cycle down and sitting a 34 is ordinary
 * trucking, and a load that is legal and deliverable should not be refused — but between two loads that
 * both pay, the one that does not spend the rest of the week is the better load, and noticing that is
 * the app's job rather than the driver's.
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
const cons = (e) => (e?.cons || []).join(' | ');

/** One load of the given length, against the given cycle. */
async function offer(miles, cycle, dest = 'Chicago', st = 'IL') {
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: cycle,
  });
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Flatbed',
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: dest, destState: st, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: Math.round(miles * 2.6), deadlineHours: 96, weightLbs: 38000,
  });
  return (r.evaluations || [])[0];
}

(async () => {
  const app = { driverName: 'D. Ivanov', preferredDivision: 'Flatbed', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // Put the driver ON a flatbed, not merely the load. What is hooked to the truck decides whether dock
  // time is work or waiting, so changing the listing alone left them on the seeded dry van and handed
  // the scenario three hours of cycle back it was never calibrated for.
  {
    const st0 = await api('/export');
    const box = st0.trailers.find((x) => /flatbed/i.test(x.type));
    if (box) { st0.driver.assignedTrailerUnit = box.unit; box.assignedTruckUnit = st0.driver.assignedTruckUnit; }
    else { st0.trailers[0].type = 'Flatbed'; st0.trailers[0].division = 'Flatbed'; }
    await api('/import', 'POST', st0);
    S = un(await api('/bootstrap'));
  }
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(4),
    fuelPct: 95, atsOdometer: 50000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. The reported case: a load that eats almost the whole cycle');
  // ~1000 miles is about eighteen hours of driving at the planning speed, against nineteen on the clock.
  const tight = await offer(830, 19.13);
  const f = tight?.feasibility;
  console.log(`  ..    plan ${f?.driveHours}h driving, cycle after ${f?.cycleRemainingAfter}h`);
  console.log(`  ..    ${cons(tight).slice(0, 190)}`);
  ok('the load is still deliverable', f?.verdict !== 'Infeasible', f?.verdict);
  ok('and it lands them near the end of the cycle', f?.cycleRemainingAfter < 4,
    `${f?.cycleRemainingAfter}h left`);
  ok('the app says what it leaves on the cycle',
    /left on the \d+-hour cycle/i.test(cons(tight)),
    (cons(tight).match(/[^|]*left on the[^|]*/i) || ['(silent)'])[0].slice(0, 120));
  ok('and says the estimate is not worth that margin',
    /thinner margin than the estimate is worth|slow stretch of road/i.test(cons(tight)),
    (cons(tight).match(/[^|]*estimate is worth[^|]*/i) || ['(not said)'])[0].slice(0, 120));
  ok('naming the driving it is measured against',
    /of driving planned at \d+ mph/i.test(cons(tight)), 'named');

  head('2. It is a warning, not a refusal');
  // Running the cycle down and sitting a 34 is ordinary trucking. A legal, deliverable load is not
  // refused for it — the driver is told and decides.
  ok('nothing hard-fails it', (tight?.hardFails || []).length === 0,
    (tight?.hardFails || []).join(' | ') || 'none');

  head('3. It counts in the scoring, so a kinder load wins');
  // The answer to "why was I given this". Two loads, both paying, one of which does not spend the week.
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 19.13 });
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Long one', trailerType: 'Flatbed', originCity: 'Denver', originState: 'CO',
    destCity: 'Chicago', destState: 'IL', loadedMiles: 830, deadheadMiles: 0,
    gameRevenue: 2158, deadlineHours: 96, weightLbs: 38000,
  });
  const both = await api('/board/add', 'POST', {
    cargo: 'Short one', trailerType: 'Flatbed', originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 380, deadheadMiles: 0,
    gameRevenue: 988, deadlineHours: 96, weightLbs: 38000,
  });
  const picked = (both.evaluations || []).find((e) => e.load.id === both.authorizedLoadId);
  const longOne = (both.evaluations || []).find((e) => e.load.cargo === 'Long one');
  const shortOne = (both.evaluations || []).find((e) => e.load.cargo === 'Short one');
  console.log(`  ..    long ${longOne?.score} (cycle after ${longOne?.feasibility?.cycleRemainingAfter}h)`);
  console.log(`  ..    short ${shortOne?.score} (cycle after ${shortOne?.feasibility?.cycleRemainingAfter}h)`);
  ok('both are the same rate a mile', Math.abs(longOne.allInRpm - shortOne.allInRpm) < 0.05,
    `${longOne.allInRpm} vs ${shortOne.allInRpm}`);
  ok('the one that does not spend the cycle scores better', shortOne.score > longOne.score,
    `short ${shortOne.score} vs long ${longOne.score}`);
  ok('and it is the one dispatch picks', picked?.load?.cargo === 'Short one',
    picked?.load?.cargo || '(none)');
  ok('the scoring detail shows the working',
    (longOne.scoreDetail || []).some((x) => /Leaves .* on the cycle/i.test(x)),
    (longOne.scoreDetail || []).find((x) => /on the cycle/i.test(x)) || '(not shown)');

  head('4. Plenty of cycle left, and nothing is said');
  // The rule must not nag. A load that finishes well clear of the watch line is an ordinary load.
  const easy = await offer(380, 60);
  console.log(`  ..    cycle after ${easy?.feasibility?.cycleRemainingAfter}h — ${cons(easy).slice(0, 90) || 'no cons'}`);
  ok('a load finishing well clear says nothing about the cycle',
    !/left on the \d+-hour cycle/i.test(cons(easy)), cons(easy).slice(0, 100) || 'quiet');
  ok('and nothing is scored against it either',
    !(easy?.scoreDetail || []).some((x) => /Leaves .* on the cycle/i.test(x)), 'no cycle term');

  head('5. Where it drops you is part of it');
  // A restart you cannot sit is worse than one you can, and the driver should know before they are
  // parked there with no hours.
  const nowhere = await offer(830, 19.13, 'Alamosa', 'CO');
  const said = cons(nowhere);
  console.log(`  ..    ${(said.match(/[^|]*sit a[^|]*/i) || ['(not said)'])[0].slice(0, 130)}`);
  ok('a thin finish somewhere that cannot hold a 34 says so',
    /not somewhere we know you can sit a/i.test(said) || nowhere?.destResetFriendly === true,
    nowhere?.destResetFriendly ? 'destination can hold one' : said.slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
