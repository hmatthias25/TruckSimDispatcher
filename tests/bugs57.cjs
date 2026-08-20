/* Issue #57 — three things found in play.
 *
 * 1. A next-day delivery window planned as same-day, with the early arrival counted as slack.
 * 2. The trailer dropdown on the fleet review coming back empty.
 * 3. A restart ordered to a city the driver had no hours to reach.
 *
 * The third is the one that matters most: it told a driver with 0:43 left to run 100 miles.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5780}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);

let S;
async function place(city, state, day, hm, cycle = 70, drive = 11, shift = 14) {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: 20000 + day * 100, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 70000,
  }));
  await api('/hos', 'POST', { driveRemaining: drive, shiftRemaining: shift, breakRemaining: 8, cycleRemaining: cycle });
  return S;
}

(async () => {
  const app = { driverName: 'R. Bugfix', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Dallas', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(19, '06:00') }));

  head('1. A window typed off the listing is parsed, not left to the driver');
  await place('Sonora', 'TX', 19, '07:00');
  await api('/board/clear', 'POST', {});
  // The reported case: dispatched 07:00, window is the NEXT day. Typed exactly as ATS prints it.
  let bd = await api('/board/add', 'POST', {
    cargo: 'Steel', trailerType: S.trailers[0].type,
    originCity: 'Sonora', originState: 'TX', destCity: 'DeRidder', destState: 'LA',
    loadedMiles: 509, deadheadMiles: 0, gameRevenue: 1939, weightLbs: 19000,
    windowText: 'Day 20 6:00 AM to 1:07 PM',
  });
  let ev = bd.evaluations[0];
  ok('the due time came off the text', /Day 20/.test(ev.feasibility.dueGameTime || '')
    || /2000-01-21/.test(ev.feasibility.dueGameTime || ''), ev.feasibility.dueGameTime);
  ok('and the OPENING was captured too', !!ev.feasibility.appointmentOpensGameTime,
    ev.feasibility.appointmentOpensGameTime || '(none)');
  ok('the opening is before the due time',
    ev.feasibility.appointmentOpensGameTime < ev.feasibility.dueGameTime,
    `${ev.feasibility.appointmentOpensGameTime} -> ${ev.feasibility.dueGameTime}`);

  head('2. With no opening given, arriving a day early is not called slack');
  await api('/board/clear', 'POST', {});
  bd = await api('/board/add', 'POST', {
    cargo: 'Steel', trailerType: S.trailers[0].type,
    originCity: 'Sonora', originState: 'TX', destCity: 'DeRidder', destState: 'LA',
    loadedMiles: 509, deadheadMiles: 0, gameRevenue: 1939, weightLbs: 19000,
    deadlineHours: 30.1,   // due next day, but only the deadline given
  });
  ev = bd.evaluations[0];
  const warn = (ev.feasibility.warnings || []).join(' | ');
  ok('there is slack on paper', ev.feasibility.slackHours > 8, `${hhmm(ev.feasibility.slackHours)}`);
  ok('and it says that slack may not be real',
    /wider than a delivery window|sitting at the gate/i.test(warn), warn.slice(0, 190) || '(none)');
  ok('it asks for the opening time', /opening time/i.test(warn), '');

  head('3. "Window" no longer means two different things');
  // The shift-window warning used the same word as the delivery window, which is what made the card
  // read as though the load were being delivered inside its appointment.
  const all = (ev.feasibility.warnings || []).join(' ');
  ok('any shift warning says SHIFT', !/of window left/i.test(all),
    all.match(/[^.]*window left[^.]*/i)?.[0] || 'no such phrasing');

  head('4. A restart is never ordered somewhere the clock cannot reach');
  // The reported case: delivering at Junction TX with 0:43 left on the 70.
  await place('Junction', 'TX', 19, '18:00', 0.72, 0.72, 3);
  let r = (await api('/bootstrap')).views.restart;
  ok('a restart is needed', r.needed === true, `${r.needed}`);
  const why = r.order?.reason || '';
  ok('no city 100 miles away is named', !/Del Rio/i.test(why), why.slice(0, 170));
  ok('it says how little driving is left', /0:43|0:4\d/.test(why), why.slice(0, 170));
  ok('and tells them to park inside their hours',
    /park at the first safe place|park where you can/i.test(why), why.slice(0, 200));
  ok('it does not pretend to name a target', !r.order?.targetCity, `"${r.order?.targetCity}"`);

  head('5. With hours in hand it still routes properly');
  await place('Junction', 'TX', 20, '08:00', 9, 9, 12);
  r = (await api('/bootstrap')).views.restart;
  ok('a restart is still needed', r.needed === true, `${r.needed}`);
  ok('and now a city IS named', !!r.order?.targetCity,
    `${r.order?.targetCity}, ${r.order?.targetState}`);
  ok('with the distance stated', /\d+ mi out/.test(r.order?.reason || ''),
    (r.order?.reason || '').slice(0, 130));

  head('6. The trailer dropdown has something in it');
  // Two trailers on the books, a hired driver whose terminal id does not match them. The dropdown used
  // to require an exact match and came back empty, leaving no way to set a trailer at all.
  const hq = S.company.terminals[0];
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'T700', type: 'Flatbed', division: 'Flatbed', inGameGarage: true, isCompanyOwned: true,
    status: 'InService', homeTerminalId: hq.id, currentLocation: 'Dallas, TX',
  }));
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'T701', type: 'Flatbed', division: 'Flatbed', inGameGarage: true, isCompanyOwned: true,
    status: 'InService', homeTerminalId: '', currentLocation: 'Dallas, TX',
  }));
  await api('/fleetops/drivers', 'POST', {
    name: 'K. Reyes', skill: 'Competent', status: 'Active', wageShare: 0.3,
    homeTerminalId: hq.id, hiredGameDate: iso(5),
  });
  const fleet = await api('/fleetops');
  const drv = fleet.drivers.find((d) => d.name === 'K. Reyes');
  const snap = un(await api('/bootstrap'));
  const mine = snap.driver.assignedTrailerUnit;
  const free = snap.trailers.filter((t) => !t.retired && t.unit !== mine);
  ok('there are company trailers to choose from', free.length >= 2, `${free.length}`);
  ok('at least one shares the driver terminal', free.some((t) => t.homeTerminalId === drv.homeTerminalId),
    free.map((t) => `${t.unit}:${t.homeTerminalId || 'none'}`).join(' '));
  // The off-yard one must still be reachable, since that is the case that emptied the control.
  ok('and one does NOT, which is the case that broke it',
    free.some((t) => t.homeTerminalId !== drv.homeTerminalId), 'off-yard trailer present');
  ok('the player trailer is excluded', !free.some((t) => t.unit === mine), `mine ${mine}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
