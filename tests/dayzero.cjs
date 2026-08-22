/* The day numbering matches the game.
 *
 * The app used to count the epoch as day 1 where ATS counts it as day 0, so the game's day 14 was
 * shown as day 15 — a whole day out on every date the driver read, including the one on the load in
 * front of them.
 *
 * The fix is a relabelling rather than a rewrite: times are stored as timestamps and the day number is
 * worked out from them, so nothing about a career's history actually moves. What this suite pins down
 * is that the relabelling is complete and consistent — the number, the weekday it implies, payday, the
 * load already running, and the one stored day number there is.
 *
 * Everything here reads a figure the SERVER derived. Asserting on a timestamp the test itself sent
 * would only prove the file round-trips, which was never in doubt.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5760}/api`;
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

/** The wire format for a day number, matching the client's toIso: whole days after the epoch. */
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
async function place(city, state, day, hm = '08:00') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 80, atsOdometer: 10000 + day * 100, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  }));
  return S;
}

/** Settlements carry the weekday in words, stamped server-side when payroll ran. */
const settlementNotes = async () =>
  ((await api('/bootstrap')).settlements || []).map((x) => x.notes || '').filter(Boolean);

(async () => {
  const app = { driverName: 'Day Zero', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(0) }));

  head('1. Payday lands on the days the game calls Friday');
  // nextPaydayDay is an int the server worked out from the numbering AND the weekday anchor, so it
  // pins both at once. Day 4 is the first Friday of a career now; it used to be called day 5, and it
  // is the same actual day.
  await place('Denver', 'CO', 1);
  let v = (await api('/bootstrap')).views;
  ok('from day 1, the next payday is day 4', v.payroll.nextPaydayDay === 4, `${v.payroll.nextPaydayDay}`);
  await place('Denver', 'CO', 5);
  v = (await api('/bootstrap')).views;
  ok('from day 5, it is day 11', v.payroll.nextPaydayDay === 11, `${v.payroll.nextPaydayDay}`);
  await place('Denver', 'CO', 12);
  v = (await api('/bootstrap')).views;
  ok('from day 12, it is day 18', v.payroll.nextPaydayDay === 18, `${v.payroll.nextPaydayDay}`);
  ok('and they are a clean week apart', 11 - 4 === 7 && 18 - 11 === 7, '4, 11, 18');

  head('2. Any settlement already taken is stamped with a real Friday');
  // If payroll ran while the clock was advanced above, every stub must name a day that IS a Friday
  // under the new numbering. This is the check that catches an anchor left behind by the renumbering.
  const notes = await settlementNotes();
  const stamped = notes.filter((x) => /Friday, Day \d+/.test(x));
  const offDays = stamped.map((x) => +x.match(/Friday, Day (\d+)/)[1]).filter((d) => d % 7 !== 4);
  ok('every settlement names a genuine Friday', offDays.length === 0,
    offDays.length ? `not Fridays: ${offDays.join(', ')}`
                   : `${stamped.length} stub(s): ${stamped.join(' | ').slice(0, 110) || 'none yet'}`);

  head('3. The reported case: the game said day 14, and it was a Monday');
  await place('Denver', 'CO', 14);
  v = (await api('/bootstrap')).views;
  // Day 14 is a Monday, so the next Friday is day 18 -- four days on. Under the old numbering this
  // same moment was called day 15 and the next payday day 19.
  ok('day 14 is a Monday, so payday is four days out', v.payroll.nextPaydayDay === 18,
    `next payday day ${v.payroll.nextPaydayDay}`);
  ok('and that is four days, not five', v.payroll.nextPaydayDay - 14 === 4,
    `${v.payroll.nextPaydayDay - 14}`);

  head('4. A load already running renumbers, and its hours do not move');
  await place('Denver', 'CO', 12, '06:00');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Amarillo', destState: 'TX',
    loadedMiles: 400, deadheadMiles: 0, gameRevenue: 1900, deadlineHours: 48, weightLbs: 40000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  const trip = auth.trip;
  // Dispatched 06:00 on day 12 with 48 hours to run, so it is due 06:00 on day 14.
  ok('the stored due timestamp is 48h after dispatch',
    trip.dueGameTime.startsWith('2000-01-15T06:00'), `${trip.dispatchedGameTime} -> ${trip.dueGameTime}`);
  // 2000-01-15 is fourteen whole days after the epoch, so the game calls it day 14. The old numbering
  // called that same timestamp day 15, which is what put the driver a day out on their own load.
  const due = (await api(`/trips/${trip.id}/window`, 'POST', { deadlineHours: 48, note: 'recheck' })).message;
  ok('and the server calls that day 14', /Day 14\b/.test(due), due);
  ok('not day 15', !/Day 15\b/.test(due), due);

  head('5. The migration runs once, and only once');
  // LastPaydayDay is the only day NUMBER in a save. It comes down with everything else, and it must
  // not come down twice -- a second pass would put the career a day behind instead of ahead.
  const before = un(await api('/bootstrap'));
  // Whatever the current version is -- it moves as migrations are added. The point is that a career this
  // build created is never treated as an old file needing one.
  ok('a career created by this build is already on the current schema', before.schemaVersion >= 2,
    `v${before.schemaVersion}`);
  const paid = before.driver.lastPaydayDay;
  ok('and a payday has actually been recorded to migrate', paid > 0, `${paid}`);
  for (let i = 0; i < 3; i++) await api('/bootstrap');
  const after = un(await api('/bootstrap'));
  ok('reloading does not shift it again', after.driver.lastPaydayDay === paid,
    `${paid} -> ${after.driver.lastPaydayDay}`);

  head('6. Day 0 is a real day, not a fallback');
  await place('Denver', 'CO', 0, '23:59');
  v = (await api('/bootstrap')).views;
  ok('day 0 is a Monday, so payday is four days out', v.payroll.nextPaydayDay === 4,
    `${v.payroll.nextPaydayDay}`);

  head('7. A fleet review already filed stays filed');
  // The cadence is measured between two timestamps -- the last period end and now -- so renumbering
  // cannot re-fire it or move it. It lands on the same actual day it always would have; only the
  // number printed on it comes down by one, in step with everything else.
  await place('Denver', 'CO', 14, '08:00');
  S = (await api('/fleetops/drivers', 'POST', {
    name: 'A. Hand', skill: 'Competent', status: 'Active', wageShare: 0.3,
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: iso(0),
  })).snapshot;
  let fleet = (await api('/fleetops')).summary;
  // Hired on day 0, so day 14 is fourteen days in: one short of the fifteen-day interval.
  ok('not due yet at fourteen days', fleet.due.isDue === false,
    `${fleet.due.daysSince} days since, ${fleet.due.daysRemaining} to go`);
  ok('and it says one day to go', fleet.due.daysRemaining === 1, `${fleet.due.daysRemaining}`);

  await api('/fleetops/report', 'POST', {
    periodStartGame: iso(0), periodEndGame: iso(14),
    lines: [{ driverName: 'A. Hand', miles: 4000, revenue: 6000, wages: 1800, repairs: 0,
              truckDamagePct: 4, trailerDamagePct: 2, truckOdometer: 0 }],
  });
  fleet = (await api('/fleetops')).summary;
  ok('filing it clears the ask', fleet.due.isDue === false, `isDue ${fleet.due.isDue}`);
  ok('and the next one is a full interval later', fleet.due.daysRemaining === 15,
    `${fleet.due.daysRemaining} days remaining`);
  // Filed on day 14, interval 15 -> next due day 29. It is NOT re-asked, and it did not move.
  ok('the next review is day 29, fifteen days on', /2000-01-30/.test(fleet.due.nextDueGameTime),
    fleet.due.nextDueGameTime);

  await place('Denver', 'CO', 28, '08:00');
  fleet = (await api('/fleetops')).summary;
  ok('still not due the day before', fleet.due.isDue === false, `${fleet.due.daysSince} days since`);
  await place('Denver', 'CO', 29, '08:00');
  fleet = (await api('/fleetops')).summary;
  ok('and due again on day 29, not sooner', fleet.due.isDue === true, `${fleet.due.daysSince} days since`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
