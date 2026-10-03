/* EU rest timed to a receiver's opening (reported from play, v0.80): Mannheim to Innsbruck from 08:00 on a clean
 * clock, an hour or so to load, and a 02:07 opening the next morning. The driver gets there about 17:20, too
 * late in the day to wait on the spread, so the night's rest is the wait — and the planner always made it the full
 * eleven: ready 04:20, after the opening, and the load came back infeasible. A reduced nine is on the dock at
 * 02:20, and that is what the three reduced rests are for.
 *
 *   - a reduced rest is taken where the eleven would cost the window
 *   - not where the eleven still makes it with the buffer: a reduced rest is not spent for nothing
 *   - a wait of eleven or more is a regular rest of that length
 *   - the board does not tell the driver to wait at the gate as other work on top of the rest
 *   - a finish inside the window that only the parking allowance tips over says so
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
const steps = (f) => (f.timeline || []).map((t) => `${t.label} [${t.kind} ${(+t.hours).toFixed(2)}]`).join(' | ');

async function offer(windowText) {
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Mannheim',
    originState: 'DE', destCity: 'Innsbruck', destState: 'AT', loadedMiles: 330, deadheadMiles: 0, gameRevenue: 2500, weightLbs: 30000,
    atLocation: true, windowText });
  return { d, f: (d.evaluations[0] || {}).feasibility || {} };
}

(async () => {
  const app = { driverName: 'M. Weber', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-10T08:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  // Every receiver books its loads, so the appointment is what is under test.
  const st = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...st, receiverTakesEarlyPct: 0 });
  await api('/status', 'POST', { locationCity: 'Mannheim', locationState: 'DE', locationKind: 'TruckStop', gameTime: '2000-01-10T08:00',
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: '2000-01-10T08:00',
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0 });

  head('1. A 02:07 opening the eleven would miss: a reduced nine');
  let { d, f } = await offer('Thu 02:07 - Thu 08:07');
  const tl = f.timeline || [];
  ok('feasible', f.verdict === 'Feasible', `${f.verdict}, slack ${f.slackHours}`);
  // Nine, or a few minutes more to land on the half-hour slot booked after it.
  ok('the rest before the dock is a reduced daily rest of 9', tl.some((t) => t.kind === 'Rest' && /reduced daily rest/.test(t.label) && t.hours >= 9 - 0.02 && t.hours < 9.5), steps(f));
  ok('and no 11-hour rest anywhere', !tl.some((t) => t.kind === 'Rest' && t.hours > 10.9), steps(f));
  ok('one reduced daily rest counted', f.reducedDailyRests === 1, String(f.reducedDailyRests));
  ok('the reduced rest is not put down to a 15-hour spread', !(f.warnings || []).some((w) => /15-hour spread/.test(w)), (f.warnings || []).join(' | ').slice(0, 300));
  ok('the board does not also say to wait at the gate', !(d.dispatchNotes || []).some((n) => /Wait at the receiver/.test(n)), (d.dispatchNotes || []).join(' | ').slice(0, 300));
  // The appointment is booked where the plan can be — never at an opening the rest cannot reach — and the plan
  // aims at it. The delivery is graded against this slot, so it is what the board states.
  const ev = d.evaluations[0] || {};
  if (ev.appointmentGameTime) {
    ok('booked for a slot the plan reaches: at the gate on the slot', f.projectedDockStartGameTime === ev.appointmentGameTime,
      `${f.projectedDockStartGameTime} vs ${ev.appointmentGameTime}`);
    ok('not at the 02:07 opening the rest cannot make', ev.appointmentGameTime > '2000-01-11T02:07', ev.appointmentGameTime);
    ok('the board leads with the appointment, not the window close called one',
      (d.dispatchNotes || []).some((n) => /^Booked in for .* at the gate .* late past/.test(n)), (d.dispatchNotes || []).join(' | ').slice(0, 300));
  } else ok('this receiver books its loads (fixture)', false, 'receiver takes early — fixture no longer exercises the booking');

  head('2. A window the eleven still makes with the buffer: the reduced rest is kept in hand');
  ({ f } = await offer('Thu 02:07 - Thu 10:07'));
  ok('feasible', f.verdict === 'Feasible', `${f.verdict}, slack ${f.slackHours}`);
  ok('a regular rest of 11 or a little more (to the half-hour slot)', (f.timeline || []).some((t) => t.kind === 'Rest' && t.hours >= 11 - 0.02 && t.hours < 11.5 && !/reduced/.test(t.label)), steps(f));
  ok('no reduced rest spent', !f.reducedDailyRests, String(f.reducedDailyRests));

  head('3. A wait longer than eleven: the wait is the rest, and regular');
  ({ f } = await offer('Thu 06:00 - Thu 12:00'));
  const r3 = (f.timeline || []).find((t) => t.kind === 'Rest');
  ok('one rest covering the wait, over eleven', r3 && r3.hours > 11, steps(f));
  ok('not reduced', !f.reducedDailyRests && r3 && !/reduced/.test(r3.label), r3 && r3.label);

  head('4. Done inside the window, tipped over by the parking allowance: said that way');
  ({ f } = await offer('Thu 02:07 - Thu 04:07'));
  const why = (f.blockers || []).join(' | ');
  ok('infeasible', f.verdict === 'Infeasible', f.verdict);
  ok('the blocker names the parking allowance rather than calling 03:50 past 04:07', /parking allowance/.test(why) && !/is past the/.test(why), why);

  head('5. Reported from play: Parma to Porto-Vecchio — the ferry is said in the briefing, not only in the plan');
  await api('/status', 'POST', { locationCity: 'Parma', locationState: 'IT', locationKind: 'TruckStop', gameTime: '2000-01-10T08:00',
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/board/clear', 'POST', {});
  const pv = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Parma',
    originState: 'IT', destCity: 'Porto-Vecchio', destState: 'FR', loadedMiles: 300, deadheadMiles: 0, gameRevenue: 4000, weightLbs: 30000,
    atLocation: true, deadlineHours: 60 });
  const pf = (pv.evaluations[0] || {}).feasibility || {};
  ok('the plan crosses Marseille – Porto-Vecchio', (pf.crossingRoutes || []).includes('marseille-portovecchio'), JSON.stringify(pf.crossingRoutes));
  ok('and the briefing says so, with the sailing', (pv.dispatchNotes || []).some((n) => /crosses the water.*Marseille.*Porto-Vecchio.*sailing/.test(n)),
    (pv.dispatchNotes || []).join(' | ').slice(0, 400));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
