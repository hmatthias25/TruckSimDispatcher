/* The browser has a calendar too, and it was a day behind the server's.
 *
 *   Reported from play: game clock Monday 11:40 am, app header "Mon · Day 1 · 11:39", and a Chicago to
 *   Kansas City load listed "Expected Mon 11:14 pm - Tue 5:54 am CDT" coming back due 162 hours out —
 *   the FOLLOWING Monday, with a 144-hour wait at the dock to go with it.
 *
 * Nothing was wrong with the parser, the roll, or the reader. "Day 1 is a Monday" renumbered
 * GameClock on the server and rewrote the comments in ui/app.js, but not its arithmetic:
 *
 *     const dayOf = (iso) => Math.floor((t - EPOCH) / DAY_MS);        // epoch was day ZERO
 *     GameClock.DayOf(dt)  => (int)Math.Floor(...TotalDays) + 1;      // epoch is day ONE
 *
 * Both directions of the UI used the same wrong offset, so it stayed invisible: the header read a day
 * out of a stamp and the forms wrote one back, and the two agreed with each other perfectly. What they
 * did not agree with was the server. A player looking at "Mon Day 1" was sending 2000-01-02, which the
 * server reads as Tuesday, Day 2 — and "Mon 11:14 pm" from Tuesday means SIX DAYS OUT.
 *
 * That is why three successive fixes to the window code changed nothing: the window code was right
 * every time and was being asked about the wrong day.
 *
 * So this suite does not test the parser. It tests that the day the driver sees is the day the server
 * thinks it is, across the wire, for every weekday — the one thing nothing else could catch, because
 * every other suite constructs its stamps in C# terms and never goes through the browser's arithmetic.
 */
const fs = require('fs');
const path = require('path');

const B = `http://127.0.0.1:${process.env.TSD_PORT || 5903}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

/**
 * The real ui/app.js, loaded the way the browser loads it.
 *
 * Deliberately the shipped file rather than a copy of the two functions: a copy would have been
 * updated alongside the fix and gone on passing while the file it was copied from did not.
 *
 * Loading it runs boot(), which paints the page and calls the server. The element stub swallows the
 * painting and fetch never settles, so boot gets as far as its first await and stops there — which is
 * all that is wanted. Nothing below depends on it; the calendar helpers are pure.
 */
function loadClientCalendar() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const el = {
    innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    focus() {}, click() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    querySelector: () => el, querySelectorAll: () => [], closest: () => null,
  };
  const doc = {
    addEventListener() {}, removeEventListener() {}, createElement: () => el,
    getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
    body: el, documentElement: el,
  };
  const win = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const make = new Function('document', 'window', 'location', 'navigator', 'fetch',
    src + '\nreturn { dayOf, toIso, dowOf, dowForDay, gt, DOW };');
  return make(doc, win, { hash: '' }, {}, () => new Promise(() => {}));
}

(async () => {
  const UI = loadClientCalendar();

  head('1. The browser agrees with GameClock on where the calendar starts');
  ok('the epoch is day one, not day zero', UI.dayOf('2000-01-01T00:00') === 1,
    `dayOf(epoch) = ${UI.dayOf('2000-01-01T00:00')}`);
  ok('and day one writes back to the epoch', UI.toIso(1, '00:00').startsWith('2000-01-01'),
    UI.toIso(1, '00:00'));

  head('2. Day one is a Monday, and the week runs from there');
  // The whole point of the renumbering: paydays are Fridays, and a driver checks the badge against
  // the game rather than counting days.
  const week = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun'], [8, 'Mon']];
  for (const [d, name] of week) {
    ok(`day ${d} is ${name} on the badge`, UI.dowForDay(d) === name, UI.dowForDay(d));
    ok(`day ${d} is ${name} read back out of a stamp`, UI.dowOf(UI.toIso(d, '08:00')) === name,
      UI.gt(UI.toIso(d, '08:00')));
  }

  head('3. A day typed in comes back as the same day');
  let tripped = 0;
  for (let d = 1; d <= 60; d++) if (UI.dayOf(UI.toIso(d, '13:45')) !== d) tripped++;
  ok('sixty days round-trip through the form and back', tripped === 0, `${tripped} disagreed`);

  head('4. There is no day zero to fall into');
  // The field used to allow it, and an empty or junk entry used to land there. Day 0 would be a
  // Sunday before the career started, which is a weekday the server has no answer for.
  ok('a zero is clamped to day one', UI.toIso(0, '06:00').startsWith('2000-01-01'), UI.toIso(0, '06:00'));
  ok('and so is an empty field', UI.toIso('', '06:00').startsWith('2000-01-01'), UI.toIso('', '06:00'));

  // ---------------------------------------------------------------- across the wire
  const app = { driverName: 'W. Probe', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Chicago', homeState: 'IL', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: UI.toIso(1, '06:00') });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  /** Set the clock the way the browser sets it: from a day number and a time of day. */
  async function clockTo(day, tod) {
    await api('/status', 'POST', {
      locationCity: 'Chicago', locationState: 'IL', locationKind: 'Shipper',
      gameTime: UI.toIso(day, tod), fuelPct: 100, atsOdometer: 0, truckDamagePct: 0,
      trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 828450,
    });
  }
  async function dueIn(text) {
    const r = await api('/board/interpret', 'POST', [{
      cargo: 'Waste Paper', originCity: 'Chicago', originState: 'IL',
      destCity: 'Kansas City', destState: 'MO', loadedMiles: 493, gameRevenue: 1598,
      weightLbs: 39199, trailerType: 'Dry Van', confidence: 'high', unreadable: [],
      deliverByText: text, deadlineHours: 0,
    }]);
    return (r.loads || [])[0].deadlineHours;
  }

  head('5. The weekday the driver sees is the weekday the server resolves');
  // THE ACTUAL TEST. A window naming today's weekday must come out as today, and it can only do that
  // if the browser and the server mean the same Monday. Both ends are exercised through the UI's own
  // arithmetic: the stamp is built by toIso and the weekday name comes from the UI's own table, so
  // any drift between the two calendars shows up as a window days out instead of hours.
  for (const [d, name] of week.slice(0, 7)) {
    await clockTo(d, '08:00');
    const h = await dueIn(`${name} 6:00 pm`);
    ok(`"${name} 6:00 pm" on the UI's day ${d} is ten hours away, not a week`,
      h > 9 && h < 11, `${h}h`);
  }

  head('6. The load from the report');
  // Mon Day 1, 11:39, the exact card: "Expected Mon 11:14 pm - Tue 5:54 am CDT". Due that night at
  // 23:14 — 11h35m out — and delivered by 05:54 the next morning, 18h15m out. It was coming back as
  // 162.15, which is the same window placed a week later.
  await clockTo(1, '11:39');
  const reported = await dueIn('Mon 11:14 pm - Tue 5:54 am');
  ok('the Kansas City load is due tonight, not a week on Tuesday',
    Math.abs(reported - 18.25) < 0.75, `162.15 was the bug -> ${reported}h`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
