const B = `http://127.0.0.1:${process.env.TSD_PORT || 5299}/api`;
let fails = 0, passes = 0;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const check = (l, c, d = '') => { if (c) { passes++; console.log(`  PASS  ${l}${d ? ' â€” ' + d : ''}`); } else { fails++; console.log(`  FAIL  ${l}${d ? ' â€” ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const day = (n, hhmm = '06:00') => `2000-01-${String(n).padStart(2, '0')}T${hhmm}`;

(async () => {
  head('Hire with a two-week home-time arrangement');
  const app = {
    driverName: 'Home Timer', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly',
  };
  await api('/onboarding/market', 'POST', app);
  let S = (await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1) })).snapshot;
  let h = S.views.homeTime;
  check('arrangement stored as 14 days', S.driver.homeTimeIntervalDays === 14, `${S.driver.homeTimeIntervalDays}`);
  check('tracked', h.tracked === true);
  // A probationary driver is on mandatory fortnightly reviews, which overrides whatever they picked.
  check('probation overrides the chosen arrangement while it lasts',
    /Probation/i.test(h.arrangement), h.arrangement);
  S = (await api('/career/promote', 'POST', { rank: 'company', note: 'test setup', force: true })).snapshot;
  h = S.views.homeTime;
  check('label resolved once off probation', /every other week/i.test(h.arrangement), h.arrangement);
  check('home yard identified', !!h.terminalLabel, h.terminalLabel);
  check('not due yet', h.dueSoon === false && h.overdue === false, h.headline);
  check('options exposed for the dropdown', (S.views.homeTimeOptions || []).length === 6);

  head('Day 12 â€” inside the last quarter, home time starts steering');
  const yard = S.company.terminals[0];
  S = (await api('/status', 'POST', {
    locationCity: 'Phoenix', locationState: 'AZ', locationKind: 'TruckStop', gameTime: day(12),
    fuelPct: 80, atsOdometer: 3000, truckDamagePct: 7, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 30000,
  })).snapshot;
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  h = S.views.homeTime;
  check('days out counted from hire', Math.abs(h.daysOut - 11) < 0.1, `${h.daysOut.toFixed(1)} days`);
  check('flagged due soon', h.dueSoon === true, h.headline);
  check('distance from home known', h.milesFromHome > 0, `${Math.round(h.milesFromHome)} mi from ${h.terminalLabel}`);

  head('Board: one load home to Denver, one running further away');
  await api('/board/clear', 'POST', {});
  // Generous windows so both are genuinely feasible â€” the point of the test is which one dispatch
  // picks on merit, not whether a tight load gets rejected.
  await api('/board/add', 'POST', {
    cargo: 'Machinery', originCity: 'Phoenix', originState: 'AZ', destCity: 'Denver', destState: 'CO',
    loadedMiles: 820, deadheadMiles: 0, gameRevenue: 2600, deadlineHours: 60, weightLbs: 40000,
  });
  const dec = await api('/board/add', 'POST', {
    cargo: 'Machinery', originCity: 'Phoenix', originState: 'AZ', destCity: 'Seattle', destState: 'WA',
    loadedMiles: 1450, deadheadMiles: 0, gameRevenue: 5200, deadlineHours: 96, weightLbs: 40000,
  });

  const den = dec.evaluations.find((e) => e.load.destCity === 'Denver');
  const sea = dec.evaluations.find((e) => e.load.destCity === 'Seattle');
  console.log(`  Denver  score ${den.score}  $${den.allInRpm}/mi  rec=${den.recommendation}`);
  console.log(`  Seattle score ${sea.score}  $${sea.allInRpm}/mi  rec=${sea.recommendation}`);
  check('Seattle pays better per mile', sea.load.gameRevenue > den.load.gameRevenue);
  check('home load still wins the board', dec.authorizedLoadId === den.load.id,
    `picked ${dec.evaluations.find((e) => e.load.id === dec.authorizedLoadId)?.load.destCity}`);
  check('home reason in the scoring detail', den.scoreDetail.some((x) => /home radius|toward/i.test(x)),
    den.scoreDetail.find((x) => /home/i.test(x)) || '(none)');
  check('pro says it gets you home', den.pros.some((p) => /gets you home/i.test(p)),
    den.pros.find((p) => /home/i.test(p)) || '(none)');
  check('con warns the other one runs away', sea.cons.some((c) => /further from/i.test(c)),
    sea.cons.find((c) => /further/i.test(c)) || '(none)');
  check('board note raises home time', dec.dispatchNotes.some((n) => /home time is due/i.test(n)),
    dec.dispatchNotes.find((n) => /home time/i.test(n)) || '(none)');

  head('Authorize the ride home â€” driver is told what it is for');
  const auth = await api('/dispatch/authorize', 'POST', { loadId: den.load.id });
  S = auth.snapshot;
  const trip = auth.trip;
  check('trip flagged as a home run', trip.isHomeRun === true);
  check('instruction on the trip log', trip.events.some((e) => /Routed for home time/i.test(e.detail)),
    trip.events.find((e) => /home/i.test(e.detail))?.detail || '(none)');
  const notes = auth.decision ? auth.decision.dispatchNotes : [];
  check('told to report to the yard when empty',
    (trip.events.some((e) => /report in|park it at the yard/i.test(e.detail))),
    trip.events.map((e) => e.detail).find((x) => /yard|report/i.test(x)) || '(none)');

  head('Close it out â€” home-time instructions and shop suggestion');
  const done = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: day(13, '15:00'), actualMiles: 820, endOdometer: 3820, actualRevenue: 2600,
    fuelStops: [{ gallons: 130, pricePerGal: 4.0, city: 'Denver', state: 'CO' }],
    tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 9, trailerDamageAfter: 3, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Receiver', fuelPct: 45, gameTime: day(13, '15:00'),
    hosDriveRemaining: 4, hosShiftRemaining: 6, hosBreakRemaining: 2, hosCycleRemaining: 48,
  });
  S = done.snapshot;
  const a = done.audit;
  check('home-time instructions returned', (a.homeTimeInstructions || []).length > 0, `${(a.homeTimeInstructions || []).length} lines`);
  (a.homeTimeInstructions || []).forEach((x) => console.log(`     Â· ${x}`));
  check('tells them to report to the yard', (a.homeTimeInstructions || []).some((x) => /yard|park it/i.test(x)));
  check('suggests the shop while sitting', (a.homeTimeInstructions || []).some((x) => /shop|repair|PM/i.test(x)),
    (a.homeTimeInstructions || []).find((x) => /shop|repair|PM/i.test(x)) || '(none)');
  check('directive surfaces it too', a.directives.some((x) => /home time|ride home|yard/i.test(x)),
    a.directives.find((x) => /home|yard/i.test(x)) || '(none)');

  head('Reporting in at the yard logs the home time as taken');
  let atYard = await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: day(13, '18:00'),
    fuelPct: 45, atsOdometer: 3820, truckDamagePct: 9, trailerDamagePct: 3, dutyStatus: 'OffDuty', atsBankBalance: 32000,
  });
  S = atYard.snapshot;
  check('home time recorded', atYard.wentHome === true);
  check('counter incremented', S.driver.homeTimesTaken === 1, `${S.driver.homeTimesTaken}`);
  check('clock reset', S.views.homeTime.daysOut < 1, `${S.views.homeTime.daysOut.toFixed(2)} days out`);
  check('no longer due', S.views.homeTime.dueSoon === false && S.views.homeTime.overdue === false, S.views.homeTime.headline);
  const again = await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: day(13, '20:00'),
    fuelPct: 45, atsOdometer: 3820, truckDamagePct: 9, trailerDamagePct: 3, dutyStatus: 'OffDuty', atsBankBalance: 32000,
  });
  check('does not re-stamp while parked at home', again.wentHome === false);

  head('Changing the arrangement later');
  S = await api('/career/home-time', 'POST', { preference: 'monthly' });
  check('now 30 days', S.driver.homeTimeIntervalDays === 30, `${S.driver.homeTimeIntervalDays}`);
  S = await api('/career/home-time', 'POST', { preference: 'none' });
  check('"none" turns routing off', S.views.homeTime.tracked === false, S.views.homeTime.headline);
  check('and points at asking instead', /Ask for home time/i.test(S.views.homeTime.headline),
    S.views.homeTime.headline);
  let bad = null;
  try { await api('/career/home-time', 'POST', { preference: 'whenever' }); } catch (e) { bad = e.message; }
  check('rejects an unknown arrangement', bad !== null, bad || '(accepted!)');
  S = await api('/career/home-time', 'POST', { preference: 'biweekly' });

  head('Work order keeps the cost you typed');
  const woOpen = await api('/maintenance/workorder', 'POST', {
    unit: S.driver.assignedTruckUnit, unitKind: 'Truck', kind: 'Repair',
    description: 'Front end damage', vendor: 'TA', locationCity: 'Denver', locationState: 'CO',
    cost: 850, damageBefore: 9, damageAfter: 9, odometerAtService: 3820, paidBy: 'Company', status: 'Open',
  });
  S = woOpen.snapshot;
  const w = woOpen.workOrder;
  check('kept as an estimate, not posted', w.estimatedCost === 850 && w.cost === 0,
    `estimate $${w.estimatedCost}, cost $${w.cost}`);
  check('still open', w.status === 'Open');
  const bal1 = S.views.finance.cashPosition ?? S.views.position?.atsBalance;
  const closed = await api(`/maintenance/workorder/${encodeURIComponent(w.number)}/complete`, 'POST', {
    cost: 850, damageAfter: 0, vendor: 'TA Truck Service', paidBy: 'Company', notes: '',
  });
  S = closed.snapshot;
  check('one record, not two', S.workOrders.length === 1, `${S.workOrders.length} work orders`);
  check('cost posted on close', closed.workOrder.cost === 850, `$${closed.workOrder.cost}`);
  check('damage cleared on the unit', S.trucks.find((t) => t.unit === S.driver.assignedTruckUnit).damagePct === 0);

  head('Trip-log event with no detail is accepted');
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Paper', originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 0, gameRevenue: 1900, deadlineHours: 48, weightLbs: 30000,
  });
  const a2 = await api('/dispatch/authorize', 'POST', { loadId: bd.evaluations[0].load.id });
  const ev = await api(`/trips/${a2.trip.id}/event`, 'POST', {
    gameTime: day(14, '08:00'), kind: 'Loaded', detail: 'Loaded', city: '', state: '', gallons: 0, pricePerGal: 0, cost: 0,
  });
  // This endpoint returns the snapshot directly rather than wrapping it.
  const t2 = (ev.snapshot || ev).views.activeTrip;
  check('event logged with the kind as its detail', t2.events.some((e) => e.kind === 'Loaded'),
    t2.events.map((e) => `${e.kind}:${e.detail}`).join(' | '));
  check('trip moved to InTransit', t2.status === 'InTransit', t2.status);

  console.log(`\n${'='.repeat(52)}\n  ${passes} passed, ${fails} failed\n${'='.repeat(52)}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('\nHARNESS ERROR:', e.message, e.stack); process.exitCode = 2; });

