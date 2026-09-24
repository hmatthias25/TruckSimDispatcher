/* A window that named its own day is already placed.
 *
 *   Reported from play, with the game card beside it. Chicago to Kansas City, listing "Mon 11:14 pm -
 *   Tue 5:54 am", game clock Mon Day 1 11:39. The app showed the window as Sun Day 7 23:14 to Mon Day 8
 *   05:54 and a 144:09 wait at the dock — a load due that night, planned for a week out.
 *
 * The parse was never wrong. RollToDeadline moved it. That exists for a BARE clock range: "08:00 -
 * 18:00" has no day in it, so it resolves to the soonest future occurrence, and a stated time-to-deliver
 * is the only thing that can say which day was meant. It was being applied to every window — so a text
 * that named the day itself was rolled six whole days to agree with a 162-hour deadline that came in
 * with the load. The derived number beat the stated one because it was the one being deferred to.
 *
 * The distinction is the fix: a window is ANCHORED when the text said which day, by number or by
 * weekday name. Anchored windows are left alone; bare ones still roll, because for them the countdown
 * really is the only evidence of the day.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5901}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

/** The reported load, added with whatever deadline figure came along with it. */
async function add(windowText, deadlineHours) {
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Waste Paper', trailerType: 'Dry Van', atLocation: true,
    originCity: 'Chicago', originState: 'IL', destCity: 'Kansas City', destState: 'MO',
    loadedMiles: 493, deadheadMiles: 0, gameRevenue: 1598, weightLbs: 39199,
    windowText, deadlineHours,
  });
  return (bd.evaluations || [])[0];
}

(async () => {
  const app = { driverName: 'W. Probe', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Chicago', homeState: 'IL', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // The reported moment, to the minute.
  await api('/status', 'POST', {
    locationCity: 'Chicago', locationState: 'IL', locationKind: 'Shipper', gameTime: '2000-01-01T11:39',
    fuelPct: 100, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 828450,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  head('1. The text alone reads correctly — it always did');
  const r = await api('/window/read', 'POST', { text: 'Mon 11:14 pm - Tue 5:54 am' });
  ok('the window opens tonight, Monday day 1', (r.opensAt || '').startsWith('2000-01-01T23:14'), r.opensAt);
  ok('and is due Tuesday morning, day 2', (r.dueAt || '').startsWith('2000-01-02T05:54'), r.dueAt);
  ok('about eighteen hours out', Math.abs(r.hoursUntilDue - 18.25) < 0.5, `${r.hoursUntilDue}h`);

  head('2. A 162-hour deadline no longer drags it a week out');
  // The reported failure, exactly: the six-day roll that produced the 144-hour wait.
  const rolled = await add('Mon 11:14 pm - Tue 5:54 am', 162.25);
  ok('the window still opens tonight',
    (rolled.feasibility.appointmentOpensGameTime || '').startsWith('2000-01-01T23'),
    rolled.feasibility.appointmentOpensGameTime);
  ok('and is still due on day 2',
    (rolled.feasibility.dueGameTime || '').startsWith('2000-01-02T05:54'),
    rolled.feasibility.dueGameTime);
  ok('the stored deadline is the window, not the figure sent with it',
    Math.abs(rolled.load.deadlineHours - 18.25) < 0.5, `${rolled.load.deadlineHours}h`);
  ok('so there is no six-day wait at the dock',
    rolled.load.appointmentOpensHours < 24, `opens in ${rolled.load.appointmentOpensHours}h`);

  head('3. A day NUMBER anchors it just as well as a weekday');
  const byNumber = await add('Day 2 05:54', 162.25);
  ok('an explicit day is not rolled either',
    (byNumber.feasibility.dueGameTime || '').startsWith('2000-01-02T05:54'),
    byNumber.feasibility.dueGameTime);

  head('4. A bare clock range still rolls, because nothing else can place it');
  // The case the roll was written for, and it must keep working: no day in the text, so the stated
  // time-to-deliver is the only evidence of which day was meant.
  // 05:54 alone resolves to tomorrow morning, 18:15 out. A stated 42 hours is a clear day further
  // on, which is what the roll is for — a gap of less than a whole day is rounding and is left alone.
  const bare = await add('05:54', 42);
  ok('a bare time with a day further on in the countdown moves off tomorrow',
    (bare.feasibility.dueGameTime || '').startsWith('2000-01-03T05:54'),
    bare.feasibility.dueGameTime);
  ok('and lands where the countdown says', Math.abs(bare.load.deadlineHours - 42.25) < 2,
    `${bare.load.deadlineHours}h`);

  head('5. A row already rolled is repaired on load, with no screenshot');
  // The window TEXT is kept on the load, so the fix does not need anything read off the game again.
  let st = await api('/export');
  st.board = [{
    id: 'rolled-row', cargo: 'Waste Paper', trailerType: 'Dry Van', atLocation: true,
    originCity: 'Chicago', originState: 'IL', destCity: 'Kansas City', destState: 'MO',
    loadedMiles: 493, deadheadMiles: 0, gameRevenue: 1598, weightLbs: 39199,
    windowText: 'Mon 11:14 pm - Tue 5:54 am',
    deadlineHours: 162.25, appointmentOpensHours: 155.58,
    listedAtGameTime: '2000-01-01T11:39', expiresInHours: 6.8,
  }];
  st.schemaVersion = 30;          // the build that wrote the rolled row
  await api('/import', 'POST', st);

  st = await api('/export');
  const fixed = st.board.find((b) => b.id === 'rolled-row');
  ok('the stored deadline is brought back to the window', Math.abs(fixed.deadlineHours - 18.25) < 0.5,
    `162.25 -> ${fixed.deadlineHours}h`);
  ok('and the wait at the dock with it', fixed.appointmentOpensHours < 24,
    `155.58 -> ${fixed.appointmentOpensHours}h`);

  head('6. It repairs once and then leaves the board alone');
  // A board row is a countdown from when it was added. Re-reading the text on every load would keep
  // rewriting rows that are merely getting old, which is a different behaviour entirely.
  const after = (await api('/export')).board.find((b) => b.id === 'rolled-row').deadlineHours;
  for (let i = 0; i < 3; i++) await api('/bootstrap');
  ok('reloading does not touch it again',
    (await api('/export')).board.find((b) => b.id === 'rolled-row').deadlineHours === after,
    `${after}h held`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
