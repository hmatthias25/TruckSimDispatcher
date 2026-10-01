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
  ok('four hours driven by midday: the spread is 13 less 4, no break owed yet', near(h.shiftRemaining, 9), `${h.shiftRemaining}`);
  h = await line(iso(8, '19:00'), 4.5, 0, 46, 80);
  ok('ten hours on Monday is a 10-hour day', h.euExtensionsUsed === 1 && near(h.euDayDriving[8], 10), JSON.stringify(h.euDayDriving));
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
