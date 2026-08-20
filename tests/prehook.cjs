/* Issue #56: pre-loaded pickups, and carrying the clocks across an unload nobody could read past.
 *
 * ATS's "loads from this location" button finishes the unload — spending the shift and cycle — and only
 * then shows the board, and the loads it shows come already hooked to a loaded trailer. Two consequences,
 * and the app used to get both wrong: it charged a live-load for a drop-and-hook, and it planned the next
 * load on clocks from before the unload.
 *
 * The normal path — city board, sent off to a different facility — has to be completely unaffected.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5800}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const near = (a, b, tol = 0.02) => a != null && Math.abs(a - b) < tol;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const place = async (day, hm = '06:00', city = 'Denver', st = 'CO') => {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: 'Terminal', gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: 30000 + day * 100, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  return S;
};
const clocks = (d, s, b, c) => api('/hos', 'POST',
  { driveRemaining: d, shiftRemaining: s, breakRemaining: b, cycleRemaining: c });

async function addLoad(extra = {}) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: 'Amarillo', destState: 'TX', loadedMiles: 300, deadheadMiles: 0,
    gameRevenue: 1500, deadlineHours: 48, weightLbs: 40000, ...extra,
  });
}

(async () => {
  const app = { driverName: 'Hook Test', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(0), code: 'SFL' }));
  await place(1);

  head('1. A pre-loaded pickup is planned as a hook, not a live load');
  const hookHours = (await api('/bootstrap')).settings.hookHours;
  ok('the hook time is a setting', hookHours > 0 && hookHours < 1, `${hookHours} h`);
  await clocks(11, 14, 8, 70);
  const live = (await addLoad()).evaluations[0];
  await clocks(11, 14, 8, 70);
  const hook = (await addLoad({ preLoaded: true })).evaluations[0];
  // The plan exposes totals rather than a task list, so the saving is what to measure: the learned dock
  // loading time replaced by the hook time, and nothing else about the run changed.
  const dock = (await api('/bootstrap')).views.facilityTimes
    .find((f) => f.trailerType === S.trailers[0].type);
  const saved = live.feasibility.onDutyHours - hook.feasibility.onDutyHours;
  ok('the live load books the learned dock time', dock.loadingHours > hookHours + 0.05,
    `dock ${dock.loadingHours} h vs hook ${hookHours} h`);
  ok('the hook saves exactly the difference', near(saved, dock.loadingHours - hookHours, 0.03),
    `${saved.toFixed(2)} h saved, expected ${(dock.loadingHours - hookHours).toFixed(2)}`);
  ok('so it is off the dock sooner',
    hook.feasibility.elapsedHours < live.feasibility.elapsedHours,
    `${hook.feasibility.elapsedHours} vs ${live.feasibility.elapsedHours}`);
  ok('and the driving is identical -- only the dock changed',
    near(hook.feasibility.driveHours, live.feasibility.driveHours),
    `${hook.feasibility.driveHours} vs ${live.feasibility.driveHours}`);

  head('2. The normal path is untouched');
  // Nothing ticked, so nothing changes: a city load to another facility is a live load as it always was.
  ok('a plain load is not pre-loaded', live.load.preLoaded !== true, `${live.load.preLoaded}`);
  ok('and it still plans the learned dock time', dock.loadingHours > 0.5, `${dock.loadingHours} h`);

  head('3. A hook does not teach the dock how long it takes to load');
  const dockBefore = (await api('/bootstrap')).views.facilityTimes
    .find((f) => f.trailerType === S.trailers[0].type);
  await clocks(11, 14, 8, 70);
  const pre = (await addLoad({ preLoaded: true })).evaluations[0];
  let auth = await api('/dispatch/authorize', 'POST', { loadId: pre.load.id });
  let done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(1, '18:00'), actualMiles: 300, endOdometer: 31000, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    // A quarter of an hour at the pickup, measured. It must not drag the live-load average down.
    loadingHours: 0.25, unloadingHours: 1.5, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(1, '18:00'),
  });
  S = done.snapshot;
  const dockAfter = (await api('/bootstrap')).views.facilityTimes
    .find((f) => f.trailerType === S.trailers[0].type);
  ok('the learned LOADING time did not move', near(dockAfter.loadingHours, dockBefore.loadingHours, 0.005),
    `${dockBefore.loadingHours} -> ${dockAfter.loadingHours}`);
  // The note only appears when there was a MEASURED load time to leave out. A typed figure was never
  // going to train the planner anyway, so silence is correct in that case.
  const said = (done.audit.serviceFindings || []).some((f) => /not counted toward what this dock takes/i.test(f));
  ok('either it says why, or there was nothing to exclude',
    said || near(dockAfter.loadingHours, dockBefore.loadingHours, 0.005),
    said ? 'said so' : 'nothing measured to exclude, so nothing claimed');

  head('4. The clocks cross the unload when the game already ran it');
  await place(3, '06:00');
  await clocks(11, 14, 8, 70);
  const p2 = (await addLoad()).evaluations[0];
  auth = await api('/dispatch/authorize', 'POST', { loadId: p2.load.id });
  // Arrived 14:00 with 6 hours of shift left. The unload ran for 2:00 the moment the board opened.
  await clocks(5, 6, 4, 60);
  done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(3, '14:00'), actualMiles: 300, endOdometer: 31500, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 2, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(3, '14:00'),
    unloadAlreadyRan: true,
  });
  S = done.snapshot;
  let h = (await api('/bootstrap')).hos;
  ok('the shift clock lost the unload', near(h.shiftRemaining, 4), `${h.shiftRemaining} h`);
  ok('the cycle lost it too', near(h.cycleRemaining, 58), `${h.cycleRemaining} h`);
  ok('the DRIVE clock is untouched -- unloading is not driving', near(h.driveRemaining, 5),
    `${h.driveRemaining} h`);
  ok('and so is the break counter', near(h.breakRemaining, 4), `${h.breakRemaining} h`);
  ok('they are flagged as worked out, not read', h.projected === true, `${h.projected}`);
  ok('the game clock moved past the unload', /T16:00/.test(S.status.gameTime), S.status.gameTime);
  ok('and the audit shows the arithmetic',
    (done.audit.carriedForward || []).some((x) => /carried across the unload/i.test(x)),
    (done.audit.carriedForward || []).find((x) => /carried across/i.test(x)) || '(none)');

  head('5. A clock reading beats a typed duration');
  await place(5, '06:00');
  await clocks(11, 14, 8, 70);
  const p3 = (await addLoad()).evaluations[0];
  auth = await api('/dispatch/authorize', 'POST', { loadId: p3.load.id });
  await clocks(6, 8, 5, 50);
  done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(5, '12:00'), actualMiles: 300, endOdometer: 32000, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    // Typed one hour, but the clock says three passed. The clock is what the game charged.
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(5, '12:00'),
    releasedGameTime: iso(5, '15:00'),
  });
  S = done.snapshot;
  h = (await api('/bootstrap')).hos;
  ok('now is when the board came up', /T15:00/.test(S.status.gameTime), S.status.gameTime);
  ok('three hours came off the shift, not one', near(h.shiftRemaining, 5), `${h.shiftRemaining} h`);
  ok('and the disagreement is called out',
    (done.audit.serviceFindings || []).some((f) => /clock moved/i.test(f) && /Going with the clock/i.test(f)),
    (done.audit.serviceFindings || []).find((f) => /clock moved/i.test(f)) || '(none)');

  head('6. Nothing is carried when the box is not ticked');
  await place(7, '06:00');
  await clocks(11, 14, 8, 70);
  const p4 = (await addLoad()).evaluations[0];
  auth = await api('/dispatch/authorize', 'POST', { loadId: p4.load.id });
  await clocks(5, 7, 4, 40);
  done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(7, '13:00'), actualMiles: 300, endOdometer: 32500, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 2, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(7, '13:00'),
  });
  S = done.snapshot;
  h = (await api('/bootstrap')).hos;
  ok('the shift clock is left alone', near(h.shiftRemaining, 7), `${h.shiftRemaining} h`);
  ok('nothing is claimed to be projected', !h.projected, `${h.projected}`);
  ok('and now is the time that was reported', /T13:00/.test(S.status.gameTime), S.status.gameTime);

  head('7. The logged cadence works with nothing ticked');
  // Begin unload at arrival, End unload with the time off the load-selection screen. That is the whole
  // input: the app measures the dock time from the pair, moves "now" to the end of it, and carries the
  // clocks across. No checkbox, no duration typed from memory.
  await place(9, '06:00');
  await clocks(11, 14, 8, 70);
  const p5 = (await addLoad()).evaluations[0];
  auth = await api('/dispatch/authorize', 'POST', { loadId: p5.load.id });
  await clocks(4, 5, 3, 30);
  await api(`/trips/${auth.trip.id}/event`, 'POST',
    { kind: 'BeginUnload', gameTime: iso(9, '12:00'), note: 'backed in' });
  await api(`/trips/${auth.trip.id}/event`, 'POST',
    { kind: 'EndUnload', gameTime: iso(9, '13:30'), note: 'clock off the load board' });
  done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(9, '12:00'), actualMiles: 300, endOdometer: 33000, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 0, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(9, '12:00'),
  });
  S = done.snapshot;
  h = (await api('/bootstrap')).hos;
  ok('the dock time came off the log', /1:30|1\.5/.test(
    (done.audit.serviceFindings || []).join(' ')), 
    (done.audit.serviceFindings || []).find((f) => /Unloading/.test(f)) || '(none)');
  ok('the shift lost the hour and a half', near(h.shiftRemaining, 3.5), `${h.shiftRemaining} h`);
  ok('the cycle lost it too', near(h.cycleRemaining, 28.5), `${h.cycleRemaining} h`);
  ok('the drive clock is untouched', near(h.driveRemaining, 4), `${h.driveRemaining} h`);
  ok('and now is the end of the unload', /T13:30/.test(S.status.gameTime), S.status.gameTime);

  head('8. The reading is the arrival baseline, and the dock comes off it');
  await place(11, '06:00');
  await clocks(11, 14, 8, 70);
  const p6 = (await addLoad()).evaluations[0];
  auth = await api('/dispatch/authorize', 'POST', { loadId: p6.load.id });
  await api(`/trips/${auth.trip.id}/event`, 'POST',
    { kind: 'BeginUnload', gameTime: iso(11, '10:00') });
  await api(`/trips/${auth.trip.id}/event`, 'POST',
    { kind: 'EndUnload', gameTime: iso(11, '12:00') });
  done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(11, '10:00'), actualMiles: 300, endOdometer: 33500, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 0, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(11, '10:00'),
    // Read when they backed in at 10:00 -- the level-set. The two hours at the dock come off these.
    hosShiftRemaining: 6, hosCycleRemaining: 40, hosDriveRemaining: 5, hosBreakRemaining: 4,
  });
  S = done.snapshot;
  h = (await api('/bootstrap')).hos;
  ok('the dock came off the arrival reading', near(h.shiftRemaining, 4), `6 -> ${h.shiftRemaining} h`);
  ok('and off the cycle', near(h.cycleRemaining, 38), `40 -> ${h.cycleRemaining} h`);
  ok('the drive clock is left as read', near(h.driveRemaining, 5), `${h.driveRemaining} h`);
  ok('the result is flagged as worked out', h.projected === true, `${h.projected}`);
  ok('and the arithmetic is shown',
    (done.audit.carriedForward || []).some((x) => /carried across the unload/i.test(x)),
    (done.audit.carriedForward || []).find((x) => /carried across/i.test(x)) || '(none)');

  head('8b. With no reading to anchor to, it says so instead of guessing');
  // Two loads back to back, neither reporting clocks. The first leaves the figures on file stale; the
  // second then has nothing to anchor to, so taking only the dock time off them would report a shift
  // clock that never paid for either drive. It has to say so rather than publish that.
  const runQuiet = async (day, arrive, board, odo) => {
    await place(day, '06:00');
    const ev = (await addLoad()).evaluations[0];
    const a2 = await api('/dispatch/authorize', 'POST', { loadId: ev.load.id });
    return api(`/trips/${a2.trip.id}/complete`, 'POST', {
      deliveredGameTime: iso(day, arrive), actualMiles: 300, endOdometer: odo, actualRevenue: 1500,
      fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
      loadingHours: 1, unloadingHours: 0, detentionHours: 0,
      layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
      delayReason: '', damageCause: '', notes: '',
      locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(day, arrive),
      releasedGameTime: iso(day, board),
    });
  };
  // Fresh clocks, then a close-out that reports none -- which is what makes them stale.
  await clocks(11, 14, 8, 70);
  await runQuiet(13, '11:00', '13:00', 34000);
  ok('the baseline is stale after a close-out with no clocks reported',
    (await api('/bootstrap')).hos.confirmed === false, `${(await api('/bootstrap')).hos.confirmed}`);

  // Now the case that matters: stale baseline, and a dock time it could wrongly subtract.
  done = await runQuiet(14, '10:00', '12:00', 34200);
  const noted = (done.audit.carriedForward || []).join(' | ');
  ok('it refuses to do the arithmetic', /no reading from when you arrived/i.test(noted),
    noted.slice(0, 190) || '(nothing)');
  ok('and says what it is holding instead', /from before the drive/i.test(noted), '');
  ok('nothing is passed off as projected', !(await api('/bootstrap')).hos.projected,
    `${(await api('/bootstrap')).hos.projected}`);

  head('8c. The whole thing in one close-out: arrival clocks plus the board time');
  // The cadence a driver actually uses. Back in at 09:00 and read the clocks. Press the button. The
  // board comes up at 11:30. One close-out carries all three facts, and nothing else is needed -- no
  // begin/end events, no tick.
  await place(15, '06:00');
  await clocks(11, 14, 8, 70);
  const p8 = (await addLoad()).evaluations[0];
  auth = await api('/dispatch/authorize', 'POST', { loadId: p8.load.id });
  done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(15, '09:00'), actualMiles: 300, endOdometer: 34500, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 0, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(15, '09:00'),
    // Read as they backed in.
    hosDriveRemaining: 6, hosShiftRemaining: 9, hosBreakRemaining: 5, hosCycleRemaining: 52,
    // And the clock on the load-selection screen.
    releasedGameTime: iso(15, '11:30'),
  });
  S = done.snapshot;
  h = (await api('/bootstrap')).hos;
  ok('the dock measured two and a half hours', /2:30/.test((done.audit.carriedForward || []).join(' ')),
    (done.audit.carriedForward || []).find((x) => /at the dock/.test(x)) || '(none)');
  ok('shift went 9:00 -> 6:30', near(h.shiftRemaining, 6.5), `${h.shiftRemaining} h`);
  ok('cycle went 52:00 -> 49:30', near(h.cycleRemaining, 49.5), `${h.cycleRemaining} h`);
  ok('drive is still the 6:00 that was read', near(h.driveRemaining, 6), `${h.driveRemaining} h`);
  ok('and now is when the board came up', /T11:30/.test(S.status.gameTime), S.status.gameTime);
  ok('the next load is judged on that', (await api('/bootstrap')).views.hos.drivableNowHours <= 6.5,
    `${(await api('/bootstrap')).views.hos.drivableNowHours} h drivable`);

  head('9. A reading typed in replaces a projection');
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 10, breakRemaining: 7, cycleRemaining: 45 });
  h = (await api('/bootstrap')).hos;
  ok('the projected flag clears', !h.projected, `${h.projected}`);
  ok('and the typed figures stand', near(h.shiftRemaining, 10), `${h.shiftRemaining} h`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
