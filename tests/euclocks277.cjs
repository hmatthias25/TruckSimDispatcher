/* EU clocks as an HOS companion shows them in ETS2 (reported from play, v0.80).
 *
 * The companion's status line reads "B 4:30 D 10:00 W 56:00 2W 90": break, daily driving, the week and the
 * fortnight, all hours LEFT. Those four are all the driver types. Everything else is worked out (EuCounters)
 * and shown read-only:
 *   - the driving on each day, from how far W falls; a day over nine is a 10-hour day
 *   - today's limit: ten while the week has a 10-hour day left, nine after — and a D above it is capped
 *   - the spread, estimated: the day's driving with its breaks, or the time since the last logged rest
 *   - the weekly rest, whether it was reduced and what is owed, and reduced daily rests since, off the trip log
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
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const near = (a, b) => Math.abs(a - b) < 0.02;
/** The status line, typed as the browser sends it: B D W 2W, hours left. */
const line = (at, b, d, w, w2) => api('/hos', 'POST', {
  breakRemaining: b, driveRemaining: d, shiftRemaining: 0, cycleRemaining: Math.min(w, w2), asOfGameTime: at,
  euWeekDriven: Math.max(0, 56 - w), euLastWeekDriven: Math.max(0, 90 - w2 - Math.max(0, 56 - w)),
  euDayDriven: null, spreadEstimated: true,
}).then((s) => s.hos);

(async () => {
  const app = { driverName: 'L. Jensen', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', { locationCity: 'Hamburg', locationState: 'DE', locationKind: 'TruckStop', gameTime: iso(8, '06:00'),
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });

  head('1. "B 4:30 D 10:00 W 56:00 2W 90" — a fresh week (day 8 is a Monday)');
  let h = await line(iso(8, '06:00'), 4.5, 10, 56, 90);
  ok('stored as typed, all left', near(h.breakRemaining, 4.5) && near(h.driveRemaining, 10) && near(h.cycleRemaining, 56));
  ok('ten hours today: the week has both 10-hour days', h.euDailyLimit === 10 && h.euExtensionsUsed === 0, `${h.euDailyLimit}, ${h.euExtensionsUsed} used`);
  ok('the whole 13 hours of spread, estimated', h.spreadEstimated && near(h.shiftRemaining, 13), `${h.shiftRemaining}`);
  ok('no weekly rest logged: counted from Monday', h.euHoursSinceWeeklyRest == null && h.euCompensationOwed === 0);

  head('2. The 10-hour days come from how far W falls');
  h = await line(iso(8, '12:00'), 3, 6, 52, 86);
  // The 06:00 report was a fresh day's (B and D full), so the shift is known to have started then: the spread is
  // the time since, six hours, which is more than the four driven.
  ok('six hours since the fresh 06:00 report: 13 less 6', near(h.shiftRemaining, 7), `${h.shiftRemaining}`);
  h = await line(iso(8, '19:00'), 4.5, 0, 46, 80);
  ok('ten hours on Monday is a 10-hour day', h.euExtensionsUsed === 1 && Object.values(h.euDayDriving).some((v) => near(v, 10)), JSON.stringify(h.euDayDriving));
  h = await line(iso(9, '19:00'), 4.5, 0, 36, 70);
  ok('and ten on Tuesday is the second', h.euExtensionsUsed === 2, `${h.euExtensionsUsed}`);

  head('3. Out of 10-hour days: nine hours, and a D over it is capped');
  h = await line(iso(10, '06:00'), 4.5, 10, 36, 70);
  ok('Wednesday\'s limit is nine', h.euDailyLimit === 9, `${h.euDailyLimit}`);
  ok('the D of 10:00 typed is taken as 9:00, and said', near(h.driveRemaining, 9) && h.euDriveCapped === true, `${h.driveRemaining}`);
  h = await line(iso(10, '07:00'), 4.5, 9, 36, 70);
  ok('a D of 9:00 is not a correction', near(h.driveRemaining, 9) && h.euDriveCapped === false);
  const plan = await api('/hos/plan', 'POST', { deadlineHours: 100, loadingHours: 0.5, unloadingHours: 0.5, trailerType: 'Dry Van',
    usableFuelRangeMiles: 99999, startGameTime: iso(10, '07:00'), loadedMiles: 560 });
  ok('and the planner does not extend Wednesday', (plan.extendedDays || 0) === 0, `${plan.extendedDays} extended`);

  head('4. The weekly rest and the reduced daily rests, off the trip log');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Hamburg', originState: 'DE',
    destCity: 'Bremen', destState: 'DE', loadedMiles: 80, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 200, weightLbs: 30000, atLocation: true });
  const ev = (await api('/board/evaluate')).evaluations[0];
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true })).trip;
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(10, '08:00'), endGameTime: iso(11, '08:00') });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(11, '20:00'), endGameTime: iso(12, '05:30') });
  h = await line(iso(12, '15:30'), 4.5, 7, 30, 64);
  ok('a 24-hour rest is a reduced weekly rest, 21 hours owed', h.euLastWeeklyRestReduced === true && near(h.euCompensationOwed, 21),
    `${h.euCompensationOwed}`);
  ok('ended 31.5 hours ago', near(h.euHoursSinceWeeklyRest, 31.5), `${h.euHoursSinceWeeklyRest}`);
  ok('the 9.5-hour rest since is a reduced daily rest', h.euReducedRestsUsed === 1, `${h.euReducedRestsUsed}`);
  ok('and the spread runs from when it ended: 10 hours gone, 3 left', near(h.shiftRemaining, 3), `${h.shiftRemaining}`);

  head('5. Reported from play: Cologne to Groningen, "B 03:18 | D 04:59 | W 50:59 | 2W 84:59" at 18:54');
  // A new week (day 15 is a Monday), so both 10-hour days are left and D is counted from ten: today's
  // extension is already in the 4:59. It was added again, 5:46 of driving was planned straight through, and
  // a load that could not be made was authorised as Feasible.
  h = await line(iso(15, '18:54'), 3.3, 4.983, 50.983, 84.983);
  ok('D 4:59 is counted from ten, so the extension is inside it', h.euDriveIncludesExtension === true && near(h.driveRemaining, 4.983));
  const g = await api('/hos/plan', 'POST', { deadlineHours: 10.8, loadingHours: 0.5, unloadingHours: 0.5, trailerType: 'Dry Van',
    usableFuelRangeMiles: 99999, startGameTime: iso(15, '18:54'), loadedMiles: 252.3 });
  ok('no second extension is planned on top of it', (g.extendedDays || 0) === 0, `${g.extendedDays} extended`);
  ok('5:46 of driving does not fit in 4:59: a daily rest is needed on the way', g.restsRequired >= 1, `${g.restsRequired} rest(s)`);
  ok('and Groningen by Tuesday 05:42 is not on', g.verdict === 'Infeasible', `${g.verdict}, arrives ${g.projectedArrivalGameTime}`);

  head('6. Close-out: the status line as you arrived, and the unload carried by EU rules');
  // Reported from play: the hours reported on end trip were all wrong for Euro — the form asked for ATS's
  // shift and cycle, and the dock was carried by the US split ("in the bunk", the seventy).
  // Section 4's load is still open; close it out before booking another.
  await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: iso(12, '18:00'), endOdometer: 1050, actualMiles: 50,
    truckDamageAfter: 1, trailerDamageAfter: 1 });
  await api('/status', 'POST', { locationCity: 'Hamburg', locationState: 'DE', locationKind: 'TruckStop', gameTime: iso(16, '06:00'),
    fuelPct: 100, atsOdometer: 1050, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Hamburg', originState: 'DE',
    destCity: 'Bremen', destState: 'DE', loadedMiles: 80, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 200, weightLbs: 30000, atLocation: true });
  await line(iso(16, '06:00'), 4.5, 10, 50, 84);
  const ev2 = (await api('/board/evaluate')).evaluations[0];
  const t2 = (await api('/dispatch/authorize', 'POST', { loadId: ev2.load.id, overrideTight: true })).trip;
  await api(`/trips/${t2.id}/event`, 'POST', { kind: 'BeginLoad', gameTime: iso(16, '06:30') });
  await api(`/trips/${t2.id}/event`, 'POST', { kind: 'EndLoad', gameTime: iso(16, '07:00') });
  await api(`/trips/${t2.id}/event`, 'POST', { kind: 'BeginUnload', gameTime: iso(16, '09:00') });
  await api(`/trips/${t2.id}/event`, 'POST', { kind: 'EndUnload', gameTime: iso(16, '10:00') });
  const closed = await api(`/trips/${t2.id}/complete`, 'POST', { deliveredGameTime: iso(16, '09:00'), endOdometer: 1130, actualMiles: 80,
    truckDamageAfter: 1, trailerDamageAfter: 1, unloadAlreadyRan: true,
    hosBreakRemaining: 2.5, hosDriveRemaining: 8, hosEuWeekLeft: 48, hosEuTwoWeeksLeft: 82 });
  h = (await api('/bootstrap')).hos;
  const said = (closed.audit?.carriedForward || []).join(' | ');
  ok('B and D as typed', near(h.breakRemaining, 2.5) && near(h.driveRemaining, 8), `${h.breakRemaining} / ${h.driveRemaining}`);
  ok('W 48:00 is 8 hours driven this week, 2W 82:00 leaves last week at none', near(h.euWeekDriven, 8) && near(h.euLastWeekDriven, 0),
    `${h.euWeekDriven} / ${h.euLastWeekDriven}`);
  ok('the planner\'s week left is the lesser of W and 2W', near(h.cycleRemaining, 48), `${h.cycleRemaining}`);
  ok('the arrival is said as the status line', /B 2:30 · D 8:00 · W 48:00 · 2W 82:00/.test(said), said);
  ok('the unload comes off the spread, not off D or the week', /spread .* →/.test(said) && /D, W and 2W are driving only/.test(said)
    && !/bunk|seventy|cycle/.test(said), said);
  ok('D and the week are left as you arrived', near(h.driveRemaining, 8) && near(h.cycleRemaining, 48));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
