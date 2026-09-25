/* A stop is a span, and the clock the driver reads is the one at the END of it.
 *
 *   "When we do put the rest in the game should advance to the end time put in, instead it is just
 *    going to the begin time which has caused things like payday not firing, wrong entry for I have
 *    arrived as that is pre-filled, etc"
 *
 * LogEvent set the clock to ev.GameTime and nothing else, so a ten-hour reset logged at 21:00 left the
 * driver standing at 21:00 — the moment they shut down rather than the moment they are in. Everything
 * downstream reads off that clock. A payday inside the rest never came due, because the career never
 * reached the Friday. The arrival panel came up prefilled from before the stop, so the next entries
 * went in wrong too and had to be unpicked one at a time.
 *
 * The other half is which events get asked at all:
 *
 *   "It is confusing on statuses like begin load/end load/fueling etc because those don't have an end
 *    time ... I think we should ONLY show the end time for statuses that require it"
 *
 * Begin load and End load are already a pair; a fuel stop has a length in Settings; a note is a moment.
 * The field is offered on the five that are genuinely a span, which are the same five SpeedLearning
 * measures — that list is worth pinning down, because it now decides what the form shows.
 */
const fs = require('fs');
const path = require('path');

const B = `http://127.0.0.1:${process.env.TSD_PORT || 5904}/api`;
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

/** The shipped form's own idea of which events have an end, loaded the way the browser loads it. */
function loadForm() {
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
  return new Function('document', 'window', 'location', 'navigator', 'fetch',
    src + '\nreturn { isSpanEvent, SPAN_EVENTS, defaultSpanEnd, eventNote };')(doc, win, { hash: '' }, {}, () => new Promise(() => {}));
}

(async () => {
  const UI = loadForm();

  head('1. Only the events you sit through are asked for an end time');
  for (const k of ['Rest', 'Restart', 'Break', 'Delay', 'Breakdown']) {
    ok(`${k} is a span`, UI.isSpanEvent(k) === true);
  }
  // The four named in the report, plus the two that are moments by definition.
  for (const k of ['BeginLoad', 'EndLoad', 'BeginUnload', 'EndUnload', 'Fuel', 'Scale', 'Note']) {
    ok(`${k} is not`, UI.isSpanEvent(k) === false);
  }
  ok('and there are exactly five of them', UI.SPAN_EVENTS.size === 5, [...UI.SPAN_EVENTS].join(', '));

  head('1b. The break is the one stop that opens with its end already filled in');
  //   "For break if an end date isn't put we should assume 30 mins which is standard (maybe prefill
  //    the end date here to make it easier) this is the ONLY one we'd do that on"
  //
  // SpeedLearning has always assumed the thirty when nothing was said. Prefilling it puts the same
  // figure on screen, where it can be typed over by a driver who sat longer — and, now that the clock
  // follows the end of a span, actually moves the clock the thirty minutes as well.
  ok('a break opens thirty minutes out',
    UI.defaultSpanEnd('Break', '2000-01-04T21:00', 0.5) === '2000-01-04T21:30',
    UI.defaultSpanEnd('Break', '2000-01-04T21:00', 0.5));
  ok('and rolls into the next day when it has to',
    UI.defaultSpanEnd('Break', '2000-01-04T23:50', 0.5) === '2000-01-05T00:20',
    UI.defaultSpanEnd('Break', '2000-01-04T23:50', 0.5));
  // The thirty is a setting. Reading it in one place and assuming it in another is how the app comes
  // to disagree with itself.
  ok('off the configured length rather than a hardcoded thirty',
    UI.defaultSpanEnd('Break', '2000-01-04T21:00', 0.75) === '2000-01-04T21:45',
    UI.defaultSpanEnd('Break', '2000-01-04T21:00', 0.75));
  ok('and a break switched off is not assumed at all',
    UI.defaultSpanEnd('Break', '2000-01-04T21:00', 0) === '2000-01-04T21:00');

  for (const k of ['Rest', 'Restart', 'Delay', 'Breakdown']) {
    // Everything else opens as a zero-length span, which is the app's way of saying nothing was
    // stated. There is no standard length for any of them to fall back on.
    ok(`${k} opens with nothing assumed`,
      UI.defaultSpanEnd(k, '2000-01-04T21:00', 0.5) === '2000-01-04T21:00',
      UI.defaultSpanEnd(k, '2000-01-04T21:00', 0.5));
  }

  head('1c. Every event says what it is for');
  //   "When should a player use 'delay?' I've never used it. Should that be when waiting at the gate to
  //    be unloaded or something?"
  //
  // No — that is measured already, from I have arrived to Begin unload, and logging it here as well
  // would have it counted twice. The list offered no way to find that out, so it says so now.
  for (const k of ['BeginLoad', 'EndLoad', 'BeginUnload', 'EndUnload', 'Fuel', 'Break', 'Rest',
                   'Scale', 'Delay', 'Breakdown', 'Note']) {
    ok(`${k} carries a note`, UI.eventNote(k).length > 20);
  }
  ok('and the delay note heads off the guess that was actually made',
    /dock/i.test(UI.eventNote('Delay')) && /arrived/i.test(UI.eventNote('Delay')),
    UI.eventNote('Delay').slice(0, 60) + '...');

  // ---------------------------------------------------------------- a career with a load on it
  const app = { driverName: 'W. Probe', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Chicago', homeState: 'IL', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1, '06:00') });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', {
    locationCity: 'Chicago', locationState: 'IL', locationKind: 'Shipper', gameTime: at(4, '18:00'),
    fuelPct: 100, atsOdometer: 100000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 828450,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', originCity: 'Chicago', originState: 'IL',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 1400, deadheadMiles: 0,
    gameRevenue: 3600, deadlineHours: 96, weightLbs: 38000, atLocation: true,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  const trip = auth.trip;
  const clock = async () => (await api('/bootstrap')).status.gameTime;

  const log = (body) => api(`/trips/${trip.id}/event`, 'POST', body);

  head('2. A rest carries the clock to the far side of it');
  // Thursday night to Friday morning — the shape of the report.
  const rested = await log({
    kind: 'Rest', gameTime: at(4, '21:00'), endGameTime: at(5, '07:00'), detail: 'ten',
  });
  ok('the clock is at the end of the rest, not the start',
    un(rested).status.gameTime === at(5, '07:00'), un(rested).status.gameTime);
  ok('which is a different DAY, and that is the whole point',
    un(rested).status.gameTime.startsWith(at(5, '').slice(0, 10)), un(rested).status.gameTime);

  head('3. An event with no end leaves the clock where it was logged');
  const moment = await log({ kind: 'BeginUnload', gameTime: at(5, '09:30'), detail: 'at the dock' });
  ok('a moment is just its own time', un(moment).status.gameTime === at(5, '09:30'),
    un(moment).status.gameTime);

  head('4. An end time equal to the start is "not stated", not a zero-length stop');
  // What the field opens holding. It has to mean nothing was said, or forgetting it would log a stop.
  const same = await log({
    kind: 'Break', gameTime: at(5, '12:00'), endGameTime: at(5, '12:00'), detail: 'thirty',
  });
  ok('the clock lands on the one time given', un(same).status.gameTime === at(5, '12:00'),
    un(same).status.gameTime);

  // And the thirty the form now fills in for it goes through as a real span, clock and all.
  const thirty = await log({
    kind: 'Break', gameTime: at(5, '13:00'), endGameTime: at(5, '13:30'), detail: 'thirty',
  });
  ok('a prefilled thirty moves the clock thirty minutes',
    un(thirty).status.gameTime === at(5, '13:30'), un(thirty).status.gameTime);

  head('5. An end time BEFORE the start is ignored rather than winding the clock back');
  // A mistyped AM/PM, or a day box left on yesterday. Running the career backwards is worse than
  // dropping the end time, and everything that reads the clock would be reading a past one.
  const backwards = await log({
    kind: 'Delay', gameTime: at(5, '14:00'), endGameTime: at(5, '09:00'), detail: 'mistyped',
  });
  ok('the clock does not go backwards', un(backwards).status.gameTime === at(5, '14:00'),
    un(backwards).status.gameTime);

  head('6. The span is still on the event itself, for the planner to measure');
  // The clock moving is new; the record it moves from is not, and SpeedLearning divides by it.
  const t = (await api('/trips')).find((x) => x.id === trip.id);
  const rest = t.events.find((e) => e.kind === 'Rest');
  ok('the rest kept both of its stamps', rest.gameTime === at(4, '21:00') && rest.endGameTime === at(5, '07:00'),
    `${rest.gameTime} -> ${rest.endGameTime}`);
  const brk = t.events.find((e) => e.kind === 'Break');
  ok('and the one that said nothing kept no span', !(brk.endGameTime && brk.endGameTime > brk.gameTime),
    brk.endGameTime || '(none)');

  head('7. The payday the career used to be stepped over');
  // The reported symptom, end to end. Pay has to be owed for a Friday to produce anything — an empty
  // week deliberately settles nothing — so a delivered load is planted with pay on it and no
  // settlement. Cloned from the live trip rather than built by hand, so it is a shape the server
  // actually wrote.
  {
    // Thursday night of the second week first, and only then the pay. The other way round, moving the
    // clock is itself what settles — day 5's payday was still open, found the planted load on the way
    // past and paid it, leaving nothing owed by the Friday under test.
    await api('/status', 'POST', {
      locationCity: 'Chicago', locationState: 'IL', locationKind: 'Shipper', gameTime: at(11, '21:00'),
      fuelPct: 100, atsOdometer: 100000, truckDamagePct: 0, trailerDamagePct: 0,
      dutyStatus: 'OnDuty', atsBankBalance: 828450,
    });

    const st = await api('/export');
    const done = JSON.parse(JSON.stringify(st.trips[0]));
    done.id = 'T-PLANTED';
    done.number = 'PLANT-1';
    done.status = 'Delivered';
    done.settlementNumber = '';
    done.deliveredGameTime = at(11, '12:00');
    done.pay.total = 600;
    st.trips.push(done);
    await api('/import', 'POST', st);

    const before = (await api('/bootstrap')).views.payroll.nextPaydayDay;
    ok('standing on Thursday, the Friday is still ahead', before === 12, `day ${before}`);

    const over = await log({
      kind: 'Rest', gameTime: at(11, '21:00'), endGameTime: at(12, '07:00'), detail: 'ten',
    });
    ok('resting into Friday actually reaches Friday',
      un(over).status.gameTime === at(12, '07:00'), un(over).status.gameTime);
    ok('and the payday runs on the way through', (over.paid || []).length > 0,
      `${(over.paid || []).length} settlement(s)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
