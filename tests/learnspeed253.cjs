/* The planner stops dividing by a number somebody picked.
 *
 *   "I think one thing that would help is if the app calcs how long each drive actually took (need to add
 *    pickup time to drop and hook, end load will work for other types of loads) and then change the
 *    ASSUMPTION of how long loads take from each load by calculations. This would bring the accepted loads
 *    down to a good amount eventually. Would have to throw out outliers."
 *
 * Every hour the app projects is miles divided by GovernedMph × SpeedFactor, and the factor shipped as
 * 0.86 because somebody picked it. It decides whether a load is feasible, what it leaves on the cycle and
 * how much slack there is — #251 and #252 are both really arguments about how much that figure is worth.
 * So it is measured now, the same way FacilityLearning has measured dock times all along: a running
 * average that settles, a sample count, and a hand-set figure that stops it moving.
 *
 * The near end of the run is a clock the driver read off the game. A live load has it on its End load
 * event; drop and hook has no load events at all since #241, so it is asked for beside the odometer in
 * Report after hooking. Asked rather than stamped on submission, because filing the panel an hour after
 * pulling out would otherwise teach the planner that the run was an hour quicker than it was.
 *
 * And the same panel is what puts a drop-and-hook trip in transit. It never got there before: InTransit
 * came off a load event, and that arrangement has none, so the trip sat on Authorized for its whole life.
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
const at = (day, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S, odo = 100000, day = 4;
const settings = async () => (await api('/bootstrap')).settings;

/** Put the driver on drop and hook. */
async function ontoDropHook() {
  const st = await api('/export');
  st.trailers.push({
    unit: 'DH-1', type: 'Drop & Hook', subtype: '', division: 'Dry Van', year: 2022,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'DH-1';
  return un(await api('/import', 'POST', st));
}

/**
 * One delivered run at a chosen real speed. Pull out, arrive `miles / mph` later, close out.
 * Returns the close-out audit.
 */
async function run(miles, realMph, { logBreak = false } = {}) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', originCity: S.status.locationCity,
    originState: S.status.locationState, destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: Math.round(miles * 2.6),
    deadlineHours: 96, weightLbs: 38000, atLocation: true,
  });
  const pick = (board.evaluations || [])[0];
  const auth = await api('/dispatch/authorize', 'POST', { loadId: pick.load.id });
  const trip = auth.trip;

  const outAt = at(day, '06:00');
  await api(`/trips/${trip.id}/loaded`, 'POST', {
    weightLbs: 38000, odometer: odo, pulledOutGameTime: outAt,
  });

  let hours = miles / realMph;
  if (logBreak) {
    await api(`/trips/${trip.id}/events`, 'POST',
      { kind: 'Break', gameTime: at(day, '09:00'), detail: 'thirty' }).catch(() => {});
    hours += 0.5;                       // the break is real time on top of the driving
  }

  const arriveDay = day + Math.floor((6 + hours) / 24);
  const arriveHm = (() => {
    const t = (6 + hours) % 24;
    const h = Math.floor(t), m = Math.round((t - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(Math.min(59, m)).padStart(2, '0')}`;
  })();

  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: at(arriveDay, arriveHm) }).catch(() => {});
  odo += miles;
  const done = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: at(arriveDay, arriveHm), actualMiles: miles, endOdometer: odo,
    actualRevenue: Math.round(miles * 2.6), fuelStops: [], tolls: 0, repairCost: 0, fines: 0,
    otherExpense: 0, truckDamageAfter: 3, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(arriveDay, arriveHm),
  });
  S = done.snapshot;
  day = arriveDay + 1;
  return done.audit;
}

(async () => {
  const app = { driverName: 'M. Okonjo', preferredDivision: 'Dry Van', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  S = await ontoDropHook();
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: at(3),
    fuelPct: 95, atsOdometer: odo, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. It starts as an assumption and says so');
  let cfg = await settings();
  console.log(`  ..    factor ${cfg.speedFactor}, ${cfg.speedFactorSamples} sample(s)`);
  ok('the shipped factor is on the settings', cfg.speedFactor > 0, `${cfg.speedFactor}`);
  ok('with nothing behind it yet', cfg.speedFactorSamples === 0, `${cfg.speedFactorSamples}`);
  ok('and it is not marked as hand-set', cfg.speedFactorManual !== true, `${cfg.speedFactorManual}`);

  head('2. A drop-and-hook trip goes in transit when the hook form is filed');
  // Reported: it never did. InTransit came off a load event, and this arrangement has none.
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const b = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', originCity: 'Denver', originState: 'CO',
    destCity: 'Pueblo', destState: 'CO', loadedMiles: 110, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 40, weightLbs: 38000, atLocation: true,
  });
  const a2 = await api('/dispatch/authorize', 'POST', { loadId: (b.evaluations || [])[0].load.id });
  ok('it starts out authorized', a2.trip.status === 'Authorized', a2.trip.status);
  const filed = await api(`/trips/${a2.trip.id}/loaded`, 'POST',
    { weightLbs: 38000, odometer: odo, pulledOutGameTime: at(day, '06:00') });
  console.log(`  ..    ${(filed.notes || []).join(' | ').slice(0, 130)}`);
  ok('filing the hook form moves it to in transit', filed.trip.status === 'InTransit', filed.trip.status);
  ok('and says so', /in transit/i.test((filed.notes || []).join(' ')), 'said');
  ok('the pull-out clock is on the trip', !!filed.trip.pulledOutGameTime, filed.trip.pulledOutGameTime);
  await api(`/trips/${a2.trip.id}/cancel`, 'POST', { reason: 'fixture' }).catch(() => {});

  head('3. A slower map teaches the planner it is slower');
  // Deliberately below the shipped assumption: 46 mph against 65 × 0.86 = 55.9.
  const before = (await settings()).speedFactor;
  const audit = await run(500, 46);
  cfg = await settings();
  console.log(`  ..    ${(audit.serviceFindings || []).find((x) => /mph/i.test(x)) || '(nothing learned)'}`);
  console.log(`  ..    factor ${before} → ${cfg.speedFactor} over ${cfg.speedFactorSamples} run(s)`);
  ok('the run taught it something', cfg.speedFactorSamples === 1, `${cfg.speedFactorSamples}`);
  ok('and moved the factor down toward what was measured', cfg.speedFactor < before,
    `${before} → ${cfg.speedFactor}`);
  ok('the driver is told what it measured and what changed',
    (audit.serviceFindings || []).some((x) => /ran 500 mi .* mph. Planning speed is now/i.test(x)),
    (audit.serviceFindings || []).find((x) => /Planning speed/i.test(x))?.slice(0, 120) || '(silent)');

  head('4. It settles rather than lurching');
  // One run must not throw the whole assumption away — a bad afternoon is not the map. The shipped
  // figure is weighted as if it were a couple of runs, so the first real one moves it part of the way
  // and the map has to keep saying the same thing before the app fully believes it.
  const afterOne = cfg.speedFactor;
  ok('one run does not replace the assumption outright', afterOne > 46 / 65 + 0.02,
    `${afterOne} still short of ${(46 / 65).toFixed(3)}`);

  for (let i = 0; i < 6; i++) await run(500, 46);
  cfg = await settings();
  console.log(`  ..    factor now ${cfg.speedFactor} over ${cfg.speedFactorSamples} run(s)`);
  ok('more runs pull it further', cfg.speedFactor < afterOne, `${afterOne} → ${cfg.speedFactor}`);
  ok('toward the measured figure', Math.abs(cfg.speedFactor - 46 / 65) < 0.05,
    `${cfg.speedFactor} against ${(46 / 65).toFixed(3)}`);
  ok('and the sample count is the runs it learned from', cfg.speedFactorSamples === 7,
    `${cfg.speedFactorSamples}`);

  head('5. Outliers are thrown out, not averaged in');
  const steady = (await settings()).speedFactor;
  const samples = (await settings()).speedFactorSamples;

  // Too short to be a highway average.
  await run(30, 46);
  ok('a run under the mile floor teaches nothing',
    (await settings()).speedFactorSamples === samples, `${(await settings()).speedFactorSamples}`);

  // Faster than the truck's own governor — hours were spent and never logged.
  await run(500, 95);
  ok('a run faster than the governor is discarded',
    (await settings()).speedFactorSamples === samples, `${(await settings()).speedFactorSamples}`);
  ok('and the factor did not move for it',
    Math.abs((await settings()).speedFactor - steady) < 0.0001, `${(await settings()).speedFactor}`);

  // Far too slow to be driving — most of that was something the log does not show.
  await run(500, 12);
  ok('a run too slow to be driving is discarded too',
    (await settings()).speedFactorSamples === samples, `${(await settings()).speedFactorSamples}`);

  head('6. Logged stops come off before the speed is worked out');
  // A break is on the log precisely because it is not miles. Counting it as driving would teach the
  // planner the map is slower than it is, every time somebody takes their thirty.
  const beforeBreak = (await settings()).speedFactor;
  await run(500, 46, { logBreak: true });
  const afterBreak = (await settings()).speedFactor;
  console.log(`  ..    with a logged break: ${beforeBreak} → ${afterBreak}`);
  ok('a run with a logged break still lands on the same speed',
    Math.abs(afterBreak - beforeBreak) < 0.02, `${beforeBreak} → ${afterBreak}`);

  head('7. Setting it by hand stops it moving');
  let st = await api('/export');
  st.settings.speedFactor = 0.9;
  await api('/settings', 'POST', st.settings);
  cfg = await settings();
  ok('the hand-set figure is taken', Math.abs(cfg.speedFactor - 0.9) < 0.0001, `${cfg.speedFactor}`);
  ok('and it is marked as hand-set', cfg.speedFactorManual === true, `${cfg.speedFactorManual}`);
  await run(500, 46);
  cfg = await settings();
  ok('a later run does not move it', Math.abs(cfg.speedFactor - 0.9) < 0.0001, `${cfg.speedFactor}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
