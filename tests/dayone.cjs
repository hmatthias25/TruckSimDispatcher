/* Day 1 is a Monday, and a career starts on it.
 *
 *   "Day 1 is monday not sunday, can you fix! Can't start new career right as we start on day 1
 *    (Monday)."
 *
 * The app briefly counted from zero. That came from MatchGameDayNumbering, which moved every career down
 * by one on the belief that ATS counts the first day of a profile as day 0 — and moved the weekday anchor
 * onto day 0 with it, so that paydays would stay on the same actual Fridays. The premise was wrong: a new
 * career starts on day 1 and that day is a Monday. Both halves move back together, because shifting the
 * numbering without the anchor slides every payday onto a different Friday.
 *
 * WHAT IS ACTUALLY LOAD-BEARING. Almost nothing stores a day number — times are stored as moments and the
 * day is derived — so the renumbering is carried by GameClock.DayOf alone and everything downstream
 * follows. The handful of places a number WAS written down are bookkeeping against a real day, and the
 * migration moves them: get that wrong and the app thinks a payday is owed twice, or already settled.
 *
 * The two independently-visible consequences are the ones worth pinning, because they are what the driver
 * reads: the first payday of a career, and the day the weekly refusal allowance comes back.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5899}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

/** The epoch is the first day of a career, and the app must call it day 1. */
const day = (n, hm = '09:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (n - 1) * 86400000);
  const p2 = (v) => String(v).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

/** Moves the clock to a game day and gives back the views that publish day numbers. */
async function at(n) {
  const st = await api('/export');
  st.status.gameTime = day(n);
  await api('/import', 'POST', st);
  const b = await api('/bootstrap');
  return { refusals: b.views.refusals, payroll: b.views.payroll, probation: b.views.probation };
}

(async () => {
  const app = { driverName: 'T. Alvarez', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1, '06:00') });
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: day(1, '06:00'),
    fuelPct: 90, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 10000,
  });

  head('1. The first day of a career is day 1');
  let v = await at(1);
  ok('the tax year opens on day 1, not day 0', v.payroll.taxYear.startDay === 1,
    `startDay ${v.payroll.taxYear.startDay}`);
  ok('and runs a full 365 to day 365', v.payroll.taxYear.endDay === 365,
    `endDay ${v.payroll.taxYear.endDay}`);
  ok('day one is the first day INTO that year, not the zeroth',
    v.payroll.taxYear.dayIntoYear === 1, `${v.payroll.taxYear.dayIntoYear}`);

  head('2. Day 1 is a Monday, so the first payday is Friday day 5');
  ok('the first payday of a career is day 5', v.payroll.nextPaydayDay === 5,
    `day ${v.payroll.nextPaydayDay}`);
  ok('and it is four days out from Monday', v.payroll.daysToPayday === 4,
    `${v.payroll.daysToPayday} day(s)`);

  head('3. The week runs Monday day 1 to Sunday day 7');
  // The refusal allowance resets on a Monday, so the day it names IS the next Monday. Walking the week
  // is the cheapest way to see the whole calendar at once.
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const w = await at(n);
    ok(`day ${n} still belongs to the week that resets on day 8`, w.refusals.resetsOnDay === 8,
      `resets day ${w.refusals.resetsOnDay}`);
  }
  for (const n of [8, 9, 14]) {
    const w = await at(n);
    ok(`day ${n} has rolled into the next week`, w.refusals.resetsOnDay === 15,
      `resets day ${w.refusals.resetsOnDay}`);
  }
  ok('and the app says which weekday that is', (await at(3)).refusals.resetsOnWeekday === 'Mon',
    (await at(3)).refusals.resetsOnWeekday);

  head('4. Paydays are Fridays all the way up, not just the first one');
  for (const [on, expected] of [[5, 5], [6, 12], [12, 12], [13, 19], [19, 19]]) {
    const w = await at(on);
    ok(`standing on day ${on}, the payday in view is day ${expected}`,
      w.payroll.nextPaydayDay === expected, `day ${w.payroll.nextPaydayDay}`);
  }

  head('5. A weekday the app names matches the day number it names');
  // Probation ends 90 days after day 1, which is day 91 — and 91 is a Sunday when day 1 is a Monday.
  // This is the one place the app prints a weekday and a day number in the same breath, so it is the
  // cheapest check that the label and the arithmetic have not drifted apart.
  v = await at(1);
  const notice = v.probation.notice || '';
  const m = notice.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) Day (\d+)/);
  ok('the notice carries a weekday and a day together', !!m, notice.slice(0, 70));
  if (m) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    ok('and they agree with day 1 being a Monday', names[Number(m[2]) % 7] === m[1],
      `${m[1]} Day ${m[2]} — day ${m[2]} % 7 = ${Number(m[2]) % 7} = ${names[Number(m[2]) % 7]}`);
  }

  head('6. Renumbering moves the label, never the moment');
  // Ported from dayzero.cjs, which pinned the renumbering in the other direction and has been retired —
  // its premise was the one that turned out to be wrong. The SAFETY argument it made still holds and is
  // worth keeping: a career's history is stored as timestamps, so a renumbering can only change what the
  // days are called. If it ever moved a stored moment, a load already running would shift under a driver
  // who had planned around it.
  //
  // The trip is built directly rather than authorized off a board. Feasibility is a moving target —
  // home time, hours, the trailer on the truck — and none of it is what this section is about; a load
  // that fails to authorize for an unrelated reason would read as the dating being wrong.
  {
    const st = await api('/export');
    st.status.gameTime = day(12, '09:00');
    st.trips = [{
      id: 'dating-probe', number: 'SFL-L-900', kind: 'Freight', status: 'InTransit',
      cargo: 'Machinery', trailerType: 'Dry Van',
      originCity: 'Denver', originState: 'CO', destCity: 'Amarillo', destState: 'TX',
      dispatchedGameTime: day(12, '09:00'), dueGameTime: day(14, '09:00'),
      loadedMiles: 400, startOdometer: 0, events: [],
    }];
    st.status.activeTripId = 'dating-probe';
    await api('/import', 'POST', st);

    const back = await api('/export');
    const trip = back.trips.find((x) => x.id === 'dating-probe');
    ok('the stored timestamps come back untouched, to the minute',
      trip.dispatchedGameTime === day(12, '09:00') && trip.dueGameTime === day(14, '09:00'),
      `${trip.dispatchedGameTime} -> ${trip.dueGameTime}`);

    // 48 hours after 09:00 on day 12 is 09:00 on day 14, and the server has to call it day 14.
    const due = (await api('/trips/dating-probe/window', 'POST',
      { deadlineHours: 48, note: 'recheck' })).message || '';
    ok('and the server labels that moment day 14', /Day 14(?![0-9])/.test(due), due);
    ok('not day 13 or day 15',
      !/Day 13(?![0-9])/.test(due) && !/Day 15(?![0-9])/.test(due), due);
  }

  head('7. The renumbering migration runs once, and only once');
  // The stored last-paid day is the one number a renumbering has to move by hand. Moving it twice puts
  // the career a day the wrong way, and the app then believes a payday is owed that has been settled.
  const before = await api('/export');
  ok('a career created by this build is already on the current schema',
    before.schemaVersion >= 30, `v${before.schemaVersion}`);
  const paid = before.driver.lastPaydayDay;
  for (let i = 0; i < 3; i++) await api('/bootstrap');
  const after = await api('/export');
  ok('reloading does not shift it again', after.driver.lastPaydayDay === paid,
    `${paid} -> ${after.driver.lastPaydayDay}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
