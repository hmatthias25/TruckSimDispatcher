/* #222 - the 11 is what covers ground, and dispatch was only watching the 14.
 *
 * Reported from play: "if I only have an hour of drive time left I can't go that far even though my
 * shift time may be 3 hours... I can get to a rest area with 30 mins of clock probably, but I can't get
 * very far down the road with a 30 min clock."
 *
 * Dispatch stopped only when the drive clock AND the window were both spent - an && that could never
 * fire on the ordinary shape of the problem, which is a window with hours left on it and a drive clock
 * with nothing. So the app would read a board, score it, and hand over a load the driver had no legal
 * way to move more than thirty miles.
 *
 * The other half of the same report: a short drive clock is FINE when the pickup and an immediate sleep
 * still make the appointment. That is a real day and a common one. It just has to be said out loud
 * before the driver hooks to it, rather than discovered at a shipper's gate.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5959}/api`;
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
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

/** Stand the driver at a shipper with the clocks set exactly. */
async function clocks(drive, shift, cycle = 50) {
  await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(10, '08:00'),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  });
  await api('/hos', 'POST', {
    driveRemaining: drive, shiftRemaining: shift, breakRemaining: 8, cycleRemaining: cycle,
  });
}

/** One pre-loaded flatbed of a given length, with plenty of time on the appointment. */
async function offer(city, miles, deadlineHours = 60) {
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed', receiver: 'Midwest Steel',
    originCity: 'Wichita', originState: 'KS', destCity: city, destState: 'KS',
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: 2400, deadlineHours,
    weightLbs: 42000, atLocation: true, preLoaded: true,
  });
}

const decide = async () => await api('/board/evaluate');
const notes = (d) => [...(d?.dispatchNotes || []), d?.headline || '', d?.rationale || ''].join(' || ');
const stops = (d) => (d?.evaluations || []).flatMap((e) => e.hardFails || []).join(' || ');

(async () => {
  const app = { driverName: 'K. Ruiz', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. The reported shape: half an hour of drive against three hours of window');
  // The deadline is what makes this the reported case rather than a nap. Thirty minutes of drive and
  // eight hours to cover 140 miles means the ten-hour reset lands past the appointment, so there is no
  // version of this the driver can run - and three hours of window says nothing about that either way.
  await clocks(0.5, 3.0);
  await offer('Topeka', 140, 8);
  let d = await decide();
  const all = stops(d) + ' || ' + notes(d);
  console.log(`  ..    ${(d.headline || '').slice(0, 80)}`);
  ok('it is called out of hours, not a bad board', d.outOfHours === true, `${d.outOfHours}`);
  ok('and the reset is ordered', /take the 10-hour reset|10-hour reset/i.test(all), all.slice(0, 110));
  ok('the drive clock is named as the one that ran out',
    /drive clock is the one that has run out/i.test(all),
    (all.match(/[^|]*run out[^|]*/i) || [''])[0].trim().slice(0, 110));
  ok('nothing is authorized on it',
    !(d.evaluations || []).some((e) => e.recommendation === 'Authorize'),
    (d.evaluations || []).map((e) => e.recommendation).join(','));

  head('2. The window being healthy does not rescue it');
  // The blocker used to need drive <= 0:15 AND shift <= 0:30, and the out-of-hours line used a
  // hardcoded half hour. Nine hours of window against thirty minutes of drive is what both missed.
  await clocks(0.5, 9.0);
  await offer('Topeka', 140, 8);
  d = await decide();
  ok('still out of hours with a full window and no drive clock', d.outOfHours === true,
    (notes(d).match(/[^|]*run out[^|]*/i) || [''])[0].trim().slice(0, 110));

  head('3. A clock at zero is a hard stop before the board is even read');
  await clocks(0, 6.0);
  await offer('Topeka', 140);
  d = await decide();
  ok('nothing at all is phrased as spent',
    /is spent/i.test(stops(d) + notes(d)), (stops(d) + notes(d)).slice(0, 100));

  head('3b. A short hop that fits is still a real day');
  // The exception the report made itself: thirty minutes will not run freight, but it will run a load
  // that only needs twenty minutes. A blanket stop on a short drive clock would refuse this, and it is
  // a perfectly good use of the end of a day.
  await clocks(0.6, 4.0);
  await offer('Topeka', 20, 48);
  d = await decide();
  const hop = (d.evaluations || [])[0];
  console.log(`  ..    ${(d.evaluations || []).length} eval(s): ` +
    `${(d.evaluations || []).map((e) => `${e.recommendation}/${e.feasibility?.verdict}`).join(' ')} — ` +
    `${(d.headline || '').slice(0, 60)}`);
  ok('the load is actually scored', !!hop, `${(d.evaluations || []).length}`);
  ok('and a twenty-mile hop inside the clock is not infeasible',
    hop?.feasibility?.verdict !== 'Infeasible', `${hop?.feasibility?.verdict}`);

  head('4. Enough to run on is left alone');
  await clocks(9.0, 11.0);
  await offer('Topeka', 140);
  d = await decide();
  ok('a healthy drive clock raises no stop',
    !/park it and take the/i.test(stops(d) + notes(d)),
    (d.evaluations || []).map((e) => e.recommendation).join(','));

  head('5. Pick up and sleep is allowed, and is said out loud');
  // Two hours of drive against a long run with days on the appointment. The planner already inserts
  // the reset and still makes the window; what was missing was telling the driver that is the day
  // they are agreeing to.
  await clocks(2.0, 5.0);
  await offer('Hays', 260, 96);
  d = await decide();
  const auth = (d.evaluations || []).find((e) => e.recommendation === 'Authorize');
  const tl = (auth || (d.evaluations || [])[0])?.feasibility;
  console.log(`  ..    rests=${tl?.restsRequired} timeline=${(tl?.timeline || []).map((x) => `${x.kind}:${x.hours}`).join(' ')}`);
  console.log(`  ..    ${auth ? 'authorized' : 'not authorized'}: ${(notes(d).match(/[^|]*pick-up-and-sleep[^|]*/i) || [''])[0].trim().slice(0, 110)}`);
  ok('the load is still allowed', !!auth, auth ? 'yes' : (d.headline || '').slice(0, 80));
  if (auth) {
    ok('and the early reset is named before they hook',
      /pick-up-and-sleep/i.test(notes(d)), 'said');
    ok('with the slack that justifies it',
      /still makes the appointment/i.test(notes(d)),
      (notes(d).match(/still makes the appointment[^|]*/i) || [''])[0].slice(0, 80));
  }

  head('6. A reset on the second night out is an ordinary run and says nothing');
  await clocks(10.0, 13.0);
  await offer('Hays', 900, 120);
  d = await decide();
  const long = (d.evaluations || [])[0];
  console.log(`  ..    ${long?.feasibility?.restsRequired ?? 0} reset(s) planned over ${long?.feasibility?.totalMiles ?? 0} mi`);
  ok('a long run still plans its resets', (long?.feasibility?.restsRequired || 0) > 0,
    `${long?.feasibility?.restsRequired}`);
  ok('and is not called a pick-up-and-sleep',
    !/pick-up-and-sleep/i.test(notes(d)), 'quiet');

  head('7. The threshold is a setting, like the cycle one');
  const st = await api('/bootstrap');
  const v = st?.settings?.hos?.stopDispatchAtDriveHours;
  ok('stopDispatchAtDriveHours is exposed', v != null, `${v}`);
  ok('and defaults under an hour', v > 0 && v < 1, `${v}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
