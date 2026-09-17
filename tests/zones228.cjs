/* #228 — ATS time zones are on and the app did not know.
 *
 * ATS has had zones since 1.29, behind a gameplay option (Disabled / Only time / Full info). The map is
 * PST / MST / CST assigned per state, and the clock jumps at the state line. The app modelled none of it.
 *
 * With zones on, Status.GameTime is local to the TRUCK and the board's delivery window is local to the
 * RECEIVER. The app subtracted one from the other, so every cross-zone load was wrong by the offset —
 * and wrong in the direction that matters going east: a run into a later zone looked like it had two
 * more hours than it had, got authorised, and the driver was late through nobody's fault.
 *
 * What this suite holds:
 *   1. off by default — every figure identical to the behaviour before any of this existed
 *   2. eastbound loses hours, westbound gains them, and the sign is never backwards
 *   3. hours are durations and never pick up the offset as free time
 *   4. times the driver reads at the dock are the receiver's clock; the run's own elapsed time is not
 *   5. a state the table cannot place shifts nothing rather than guessing
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5938}/api`;
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

const iso = (day, hm) => `2000-01-${String(day).padStart(2, '0')}T${hm}`;
const gap = (a, b) => (new Date(b + ':00Z') - new Date(a + ':00Z')) / 3600000;

let S;

/** Put the truck somewhere, on a stated clock. That clock is local to wherever this is. */
async function park(city, st, day, hm) {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 95, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  return S;
}

async function setZones(on) {
  const cur = (await api('/bootstrap')).settings;
  S = un(await api('/settings', 'POST', { ...cur, timeZonesOn: on }));
  return (await api('/bootstrap')).settings.timeZonesOn;
}

/** Read a window exactly as the board shows it, for a load going to destState. */
const readWindow = (text, destState) => api('/window/read', 'POST', { text, destState });

/* The fixture window is an EVENING one on purpose, and not the "6:15 AM - 12:55 PM" that appears
 * everywhere else in these suites.
 *
 * Resolve() rolls an opening that has already passed to tomorrow and drags the due time with it, even
 * where the due time is still ahead — so reading a morning window at 06:00 in one zone and 08:00 in the
 * next puts the two readings a day apart rather than two hours, and the suite would be measuring that
 * instead of the offset. It is a real quirk and nothing to do with zones (it fires with them switched
 * off the moment a board is read from inside the window), so it is dodged here rather than folded in.
 */
const W = '2:15 PM - 8:55 PM';

(async () => {
  const app = { driverName: 'R. Okonkwo', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2, '06:00') }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Off by default, and off means nothing moves');
  const boot = (await api('/bootstrap')).settings;
  ok('the setting exists and starts off', boot.timeZonesOn === false, String(boot.timeZonesOn));

  await park('Oklahoma City', 'OK', 10, '06:00');
  const plainEast = await readWindow(W, 'CA');
  const plainWest = await readWindow(W, 'OK');
  ok('with zones off, the destination changes nothing',
    plainEast.hoursUntilDue === plainWest.hoursUntilDue,
    `${plainEast.hoursUntilDue} vs ${plainWest.hoursUntilDue}`);
  ok('and it is the plain subtraction it always was',
    Math.abs(plainEast.hoursUntilDue - 14.917) < 0.02, String(plainEast.hoursUntilDue));
  ok('no shift is reported', plainEast.zoneShiftHours === 0, String(plainEast.zoneShiftHours));
  const wasOff = plainEast.hoursUntilDue;

  head('2. On, westbound: OK (CST) to CA (PST) hands two hours back');
  ok('the setting sticks', (await setZones(true)) === true);
  await park('Oklahoma City', 'OK', 10, '06:00');
  const west = await readWindow(W, 'CA');
  console.log(`  ..    shift ${west.zoneShiftHours}h · due in ${west.hoursUntilDue}h (was ${wasOff}h)`);
  ok('the clock goes back two hours going west', west.zoneShiftHours === -2, String(west.zoneShiftHours));
  ok('so the load has two MORE hours than the truck clock suggests',
    Math.abs(west.hoursUntilDue - (wasOff + 2)) < 0.02, `${west.hoursUntilDue} vs ${wasOff + 2}`);

  head('3. On, eastbound: CA (PST) to OK (CST) takes two hours away');
  await park('Bakersfield', 'CA', 10, '06:00');
  const east = await readWindow(W, 'OK');
  console.log(`  ..    shift ${east.zoneShiftHours}h · due in ${east.hoursUntilDue}h (was ${wasOff}h)`);
  ok('the clock jumps two hours forward going east', east.zoneShiftHours === 2, String(east.zoneShiftHours));
  ok('so the load has two FEWER hours — the direction that made drivers late',
    Math.abs(east.hoursUntilDue - (wasOff - 2)) < 0.02, `${east.hoursUntilDue} vs ${wasOff - 2}`);
  ok('and it is strictly less time than the app used to claim',
    east.hoursUntilDue < wasOff, `${east.hoursUntilDue} < ${wasOff}`);

  head('4. One zone step is one hour, and the sign never flips');
  await park('Denver', 'CO', 10, '06:00');
  const mtToCst = await readWindow('12:55 PM', 'OK');   // MST -> CST, east, +1
  const mtToPst = await readWindow('12:55 PM', 'CA');   // MST -> PST, west, -1
  const mtToMt = await readWindow('12:55 PM', 'UT');    // MST -> MST, no step
  ok('Mountain into Central is one hour lost', mtToCst.zoneShiftHours === 1, String(mtToCst.zoneShiftHours));
  ok('Mountain into Pacific is one hour gained', mtToPst.zoneShiftHours === -1, String(mtToPst.zoneShiftHours));
  ok('Mountain into Mountain is no change at all', mtToMt.zoneShiftHours === 0, String(mtToMt.zoneShiftHours));
  ok('and the three sit an hour apart in the right order',
    mtToCst.hoursUntilDue < mtToMt.hoursUntilDue && mtToMt.hoursUntilDue < mtToPst.hoursUntilDue,
    `${mtToCst.hoursUntilDue} < ${mtToMt.hoursUntilDue} < ${mtToPst.hoursUntilDue}`);

  head('5. A state the table cannot place shifts nothing rather than guessing');
  const nowhere = await readWindow('12:55 PM', 'ZZ');
  const blank = await readWindow('12:55 PM', '');
  ok('an unknown state reports no shift', nowhere.zoneShiftHours === 0, String(nowhere.zoneShiftHours));
  ok('and reads exactly as it did with zones off',
    Math.abs(nowhere.hoursUntilDue - mtToMt.hoursUntilDue) < 0.02, String(nowhere.hoursUntilDue));
  ok('no destination at all behaves the same way', blank.zoneShiftHours === 0, String(blank.zoneShiftHours));

  head('6. The opening time moves with the due time, not against it');
  await park('Bakersfield', 'CA', 10, '06:00');
  const pair = await readWindow(W, 'OK');
  ok('the window still has both ends', pair.opensAt && pair.dueAt, `${pair.opensAt} / ${pair.dueAt}`);
  ok('and they stay 6:40 apart — the range itself is one clock',
    Math.abs(gap(pair.opensAt, pair.dueAt) - 6.667) < 0.02, `${gap(pair.opensAt, pair.dueAt)}h`);
  ok('hours-to-open is measured on the receiver clock too, and both lost the same two',
    Math.abs(pair.hoursUntilDue - pair.hoursUntilOpens - 6.667) < 0.02,
    `due ${pair.hoursUntilDue} - opens ${pair.hoursUntilOpens}`);

  head('7. A run across a boundary: hours are durations, clocks are faces');
  await park('Oklahoma City', 'OK', 11, '06:00');
  await api('/board/clear', 'POST', {});
  const added = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, receiver: 'Pacific Freightways',
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Barstow', destState: 'CA',
    loadedMiles: 1050, deadheadMiles: 0, gameRevenue: 3400, deadlineHours: 40,
    weightLbs: 30000, appointmentOpensHours: 20,
  });
  const ev = added.evaluations[0];
  const f = ev.feasibility;
  console.log(`  ..    elapsed ${f.elapsedHours}h · arrive ${f.projectedArrivalGameTime} · due ${f.dueGameTime}`);
  const departed = iso(11, '06:00');

  // Elapsed is a duration and must stay on one clock: the run does not get two free hours because the
  // sun does. Arrival is a clock FACE at the far end, so it reads two hours behind what the elapsed
  // hours alone would put it at.
  ok('elapsed hours are untouched by the crossing',
    f.elapsedHours > 0 && Math.abs(gap(departed, f.projectedArrivalGameTime) - (f.elapsedHours - 2)) < 0.02,
    `elapsed ${f.elapsedHours}h vs face ${gap(departed, f.projectedArrivalGameTime)}h`);
  ok('the arrival is quoted on the receiver clock, two behind the truck clock',
    Math.abs(gap(departed, f.projectedArrivalGameTime) - f.elapsedHours + 2) < 0.02,
    f.projectedArrivalGameTime);
  ok('the due time is on that same receiver clock',
    Math.abs(gap(departed, f.dueGameTime) - 38) < 0.02, `${gap(departed, f.dueGameTime)}h from depart`);
  ok('slack is still measured in hours and stays positive',
    typeof f.slackHours === 'number' && f.slackHours > 0, `${f.slackHours}h`);
  ok('the driver is told the clock jumps rather than left to work it out',
    (f.warnings || []).some((w) => /clock goes .* back|clock jumps/i.test(w)),
    (f.warnings || []).find((w) => /clock/i.test(w))?.slice(0, 110) || '(no note)');
  ok('and the note says which of the two clocks the step list is on',
    (f.warnings || []).some((w) => /step times below run on the clock you are reading now/i.test(w)),
    'wording');

  head('8. Back off again, and the arithmetic returns to exactly what it was');
  ok('the setting goes back off', (await setZones(false)) === false);
  await park('Oklahoma City', 'OK', 10, '06:00');
  const again = await readWindow(W, 'CA');
  ok('the same window reads the same as it did at the start',
    Math.abs(again.hoursUntilDue - wasOff) < 0.001, `${again.hoursUntilDue} vs ${wasOff}`);
  ok('and no shift is reported', again.zoneShiftHours === 0, String(again.zoneShiftHours));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
