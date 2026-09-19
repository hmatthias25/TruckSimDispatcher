/* The break clock is not the drive clock, and "feasible after you sleep" is not feasible now.
 *
 *   "I had taken my break and put in D 0:44 S 2:24 B 8:00 C 34:00. The app still tried to give me a load
 *    and also said 'I have 44 minutes to drive until my break'. The way my HOS system works, it shows
 *    the time until break until I take the break, then the break number will be LARGER than the drive
 *    time until I need to reset. Should I record this differently or is this a bug?"
 *
 * The recording was right. B is time until the break falls due, and eight hours back on it after taking
 * one is exactly what it should read. Two bugs, and the entry convention is not either of them.
 *
 * First, the sentence. NextRequiredAction said "clear to drive X before the 30-minute break is due"
 * whatever X had been measured against, and X is the binding minimum of drive, shift and cycle capped by
 * the break. With 0:44 on the eleven and 8:00 on the break, X is the eleven — and the driver was told
 * their break was due in forty-four minutes when it was eight hours off. The arithmetic was right and
 * the sentence was not, which is worse: a number that is right for a reason the app states wrongly is
 * one the driver stops trusting.
 *
 * Second, the freight. Dispatch stops offering at StopDispatchAtDriveHours — forty-five minutes, on the
 * argument that it is enough to reach a rest area and not enough to run freight. It never got the chance:
 * the check bails the moment any load is not Infeasible, and since #244 a driver under the parking
 * reserve gets a ten-hour reset PLANNED rather than a refusal. So every load came back feasible, after
 * you sleep, and forty-four minutes of clock was handed a board.
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
const iso = (d, hm = '14:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
const clocks = (o) => api('/hos', 'POST', o);
const hos = async () => (await api('/bootstrap')).views.hos;

(async () => {
  const app = { driverName: 'P. Okafor', preferredDivision: 'Dry Van', experienceYears: 10,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. The exact clocks reported, and what the app says about them');
  // D 0:44  S 2:24  B 8:00  C 34:00 — the break has just been taken, so it reads higher than the drive.
  await clocks({ driveRemaining: 0.7333, shiftRemaining: 2.4, breakRemaining: 8, cycleRemaining: 34 });
  const v = await hos();
  console.log(`  ..    ${v?.nextRequiredAction}`);
  console.log(`  ..    binding=${v?.bindingClock} drivable=${v?.drivableNowHours}`);

  ok('the binding clock is the drive clock, not the break', /drive/i.test(v?.bindingClock || ''),
    v?.bindingClock);
  ok('the drivable figure is the 44 minutes', Math.abs((v?.drivableNowHours ?? 0) - 0.7333) < 0.02,
    `${v?.drivableNowHours}`);
  ok('and it no longer blames the break for it',
    !/0:44 before the .* break is due/i.test(v?.nextRequiredAction || ''),
    v?.nextRequiredAction);
  ok('it says which clock is actually stopping them',
    /not the break/i.test(v?.nextRequiredAction || ''), v?.nextRequiredAction);
  ok('and how far off the break really is',
    /not due for another 8:00/i.test(v?.nextRequiredAction || ''), v?.nextRequiredAction);

  head('2. When the break IS the binding one, it still says so');
  // The other way round: plenty of drive left, half an hour before the break falls due. That sentence
  // was right all along and has to stay right.
  await clocks({ driveRemaining: 9, shiftRemaining: 11, breakRemaining: 0.5, cycleRemaining: 40 });
  const bv = await hos();
  console.log(`  ..    ${bv?.nextRequiredAction}`);
  ok('a break that is genuinely next is named as next',
    /before the 30-minute break is due/i.test(bv?.nextRequiredAction || ''), bv?.nextRequiredAction);
  ok('and the stint is the half hour, not the nine', /0:30/.test(bv?.nextRequiredAction || ''),
    bv?.nextRequiredAction);

  head('3. Forty-four minutes is not handed a board');
  // The second half. Long enough that nobody could run it on the clock in hand, so the only plan is one
  // that opens with a ten — which is tomorrow's load with today's rate on it.
  //
  // Window deliberately roomy. On the reported clocks (S 2:24) the DOCK-window blocker gets there first
  // and says something better: 2:24 of window against a dock that wants 1:30 and a truck that has to get
  // off the property afterwards. That blocker is what #244 fixed by raising the parking buffer, and on
  // the numbers as reported it now catches the case on its own. This section is about the drive clock,
  // so the window is taken out of the argument.
  await clocks({ driveRemaining: 0.7333, shiftRemaining: 6, breakRemaining: 8, cycleRemaining: 34 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 520, deadheadMiles: 0,
    gameRevenue: 1850, deadlineHours: 48, weightLbs: 38000,
  });
  const ev = (board.evaluations || [])[0];
  console.log(`  ..    "${(board.headline || '').slice(0, 95)}"`);
  console.log(`  ..    verdict=${ev?.feasibility?.verdict} beginsWithRest=${ev?.feasibility?.beginsWithRest}`);

  ok('the plan can only be run after a reset', ev?.feasibility?.beginsWithRest === true,
    `${ev?.feasibility?.beginsWithRest}`);
  ok('so the board is not offered', !board.authorizedLoadId, board.authorizedLoadId || 'nothing authorized');
  ok('it is reported as being out of hours for the day', board.outOfHours === true, `${board.outOfHours}`);
  ok('and the answer is the ten, not the thirty-four', board.needsRestart !== true,
    `needsRestart=${board.needsRestart}`);

  head('4. A run that genuinely fits the clock in hand is still offered');
  // The floor is about freight nobody could start, not about refusing everything on a short clock. Half
  // an hour of driving against forty-four minutes is a job, and the driver should be given it.
  await clocks({ driveRemaining: 0.7333, shiftRemaining: 4, breakRemaining: 8, cycleRemaining: 34 });
  await api('/board/clear', 'POST', {});
  const shortRun = await api('/board/add', 'POST', {
    cargo: 'Packaged Food', originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: 'Boulder', destState: 'CO', loadedMiles: 25, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 18, weightLbs: 20000, preLoaded: true, atLocation: true,
  });
  const sev = (shortRun.evaluations || [])[0];
  console.log(`  ..    verdict=${sev?.feasibility?.verdict} beginsWithRest=${sev?.feasibility?.beginsWithRest}`);
  ok('a short hop does not need a reset first', sev?.feasibility?.beginsWithRest !== true,
    `${sev?.feasibility?.beginsWithRest}`);
  ok('and the board is not written off as out of hours', shortRun.outOfHours !== true,
    `${shortRun.outOfHours}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
