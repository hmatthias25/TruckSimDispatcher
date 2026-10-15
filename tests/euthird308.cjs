/* Three reduced weekly rests in a row (reported from play, v0.86).
 *
 * A reduced weekly rest at Frankfurt, then the 29:30 Travemünde – Helsinki ferry taken as the second. The next long
 * ferry was going to be logged as a third, and the log took anything of 24 hours or more as the weekly rest and
 * started the six days again. Two reduced in a row is the most international work allows; the next weekly rest has
 * to be a regular 45 with what is owed paid back.
 *
 *   - two reduced weekly rests in a row both count
 *   - a third 24-to-45 is not a weekly rest: the six days run on, nothing more is owed, and the log says why
 *   - and home time comes due with that weekly rest (Mobility Package, Art. 8(8a)): the driver goes home for it
 *   - a regular 45 after it counts, and a reduced one is allowed again after that
 *   - 24 to 45 hours off is the weekly rest only where it is worth one (v0.87): early in the six days a long ferry is a
 *     long daily rest, nothing owed; the driver can switch it; near the end of the six days it is the weekly rest
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
const un = (x) => x?.state || x;
const hos = async () => (await api('/export')).hos;
const home = async () => (await api('/bootstrap')).views?.homeTime || {};
const log = async (trip, ev) => {
  await api(`/trips/${trip.id}/event`, 'POST', { cost: 0, detail: '', ...ev });
  const t = ((await api('/export')).trips || []).find((x) => x.id === trip.id);
  return (t?.events || []).find((e) => e.gameTime === ev.gameTime && e.kind === ev.kind)?.detail || '';
};

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const st = await api('/export');
  st.settings.runnableStates = [];
  await api('/import', 'POST', st);

  await api('/status', 'POST', { locationCity: 'Rotterdam', locationState: 'NL', locationKind: 'TruckStop', gameTime: '2000-01-03T06:00',
    fuelPct: 95, atsOdometer: 1000, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: '2000-01-03T06:00',
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Rotterdam', originState: 'NL', destCity: 'Kokkola', destState: 'FI', loadedMiles: 1263, deadheadMiles: 0,
    gameRevenue: 3000, deadlineHours: 400, weightLbs: 40000, atLocation: true }));
  const r = await api('/dispatch/authorize', 'POST', { loadId: (added.board || [])[0]?.id || added.evaluations?.[0]?.load?.id });
  const trip = r.trip || (un(r).trips || []).find((t) => t.status !== 'Delivered' && t.status !== 'Cancelled');
  ok('a trip to log against', !!trip, trip?.number);

  head('1. Two reduced weekly rests in a row (taken as weekly by the driver, as before v0.87)');
  await log(trip, { kind: 'Rest', gameTime: '2000-01-03T10:00', endGameTime: '2000-01-04T16:00', weeklyRest: 'weekly' });
  let h = await hos();
  ok('the first, 30:00, is the weekly rest: 15:00 owed', Math.abs(h.euCompensationOwed - 15) < 0.05 && h.euLastWeeklyRestReduced, `${h.euCompensationOwed}`);
  const second = await log(trip, { kind: 'Ferry', gameTime: '2000-01-05T03:00', endGameTime: '2000-01-06T08:30', ferryRoute: 'travemunde-helsinki', cabin: true, weeklyRest: 'weekly' });
  h = await hos();
  ok('the 29:30 ferry is the second: 30:30 owed', Math.abs(h.euCompensationOwed - 30.5) < 0.05, `${h.euCompensationOwed}`);
  ok('  and the log calls it a reduced weekly rest', /reduced weekly rest/.test(second) && !/long daily rest/.test(second), second);

  head('2. A third 29-hour ferry is not a weekly rest');
  const third = await log(trip, { kind: 'Ferry', gameTime: '2000-01-08T03:00', endGameTime: '2000-01-09T08:30', ferryRoute: 'travemunde-helsinki', cabin: true, weeklyRest: 'weekly' });
  await api('/status', 'POST', { locationCity: 'Helsinki', locationState: 'FI', locationKind: 'TruckStop', gameTime: '2000-01-09T10:00',
    fuelPct: 80, atsOdometer: 1500, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  h = await hos();
  ok('the log says it is a long daily rest, and why', /long daily rest, not a weekly one/.test(third) && /two reduced weekly rests in a row/.test(third), third);
  ok('nothing more is owed', Math.abs(h.euCompensationOwed - 30.5) < 0.05, `${h.euCompensationOwed}`);
  ok('the six days run from the second, not the third', h.euHoursSinceWeeklyRest == null || h.euHoursSinceWeeklyRest > 70,
    `${h.euHoursSinceWeeklyRest} h since the weekly rest`);
  const t3 = await log(trip, { kind: 'Rest', gameTime: '2000-01-09T12:00', endGameTime: '2000-01-10T12:00' });
  ok('a 24 logged as a rest says the same', /long daily rest, not a weekly one/.test(t3), t3);

  head('2b. Home time comes due with the weekly rest');
  await api('/status', 'POST', { locationCity: 'Helsinki', locationState: 'FI', locationKind: 'TruckStop', gameTime: '2000-01-10T12:00',
    fuelPct: 80, atsOdometer: 1500, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  let ht = await home();
  // The weekly rest is due 144 h after the ferry of Day 6 08:30: Day 12 08:30, 1.85 days from Day 10 12:00.
  ok('brought forward to the weekly rest', ht.forTheWeeklyRest === true && Math.abs(ht.daysUntilDue - 1.85) < 0.05 && ht.dueSoon,
    `${ht.forTheWeeklyRest} ${ht.daysUntilDue}`);
  ok('  and the headline says why', /two weekly rests were reduced/.test(ht.headline || ''), ht.headline);

  head('2c. A load that leaves the driver away from home when the rest falls due is refused');
  const hq = (await api('/export')).company.terminals.find((t) => t.isHeadquarters) || (await api('/export')).company.terminals[0];
  await api('/board/clear', 'POST', {});
  const far = await api('/board/add', 'POST', { cargo: 'Nylon Cord', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Helsinki', originState: 'FI', destCity: 'Portree', destState: 'UK', loadedMiles: 1700, deadheadMiles: 0,
    gameRevenue: 5000, weightLbs: 30000, atLocation: true, deadlineHours: 110 });
  const fe = far.evaluations.find((e) => e.load.destCity === 'Portree');
  const fw = JSON.stringify(fe.homeTimeFails || []);
  ok('Helsinki to Portree: refused, too late home for the weekly rest',
    fe.recommendation !== 'Authorize' && /too late to be home for the weekly rest|weekly rest in the middle/.test(fw), fw.slice(0, 220));
  await api('/board/clear', 'POST', {});
  const homeLoad = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Helsinki', originState: 'FI', destCity: hq.city, destState: hq.state, loadedMiles: 1100, deadheadMiles: 0,
    gameRevenue: 4000, weightLbs: 30000, atLocation: true, deadlineHours: 44 });
  const he = homeLoad.evaluations[0];
  ok(`a load to the yard (${hq.city}) is not refused for it`,
    !/home for the weekly rest/.test(JSON.stringify(he.homeTimeFails || [])), JSON.stringify(he.homeTimeFails || []).slice(0, 200));

  head('3. A regular 45 pays it back, and a reduced one is allowed again');
  await log(trip, { kind: 'Rest', gameTime: '2000-01-11T00:00', endGameTime: '2000-01-14T13:30' });
  h = await hos();
  ok('the 85:30 is the weekly rest, everything paid back', h.euCompensationOwed < 0.05 && !h.euLastWeeklyRestReduced, `${h.euCompensationOwed}`);
  await api('/status', 'POST', { locationCity: 'Helsinki', locationState: 'FI', locationKind: 'TruckStop', gameTime: '2000-01-14T14:00',
    fuelPct: 80, atsOdometer: 1500, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  ht = await home();
  ok('home time back on its own schedule', !ht.forTheWeeklyRest, `${ht.forTheWeeklyRest} ${ht.daysUntilDue}`);
  const after = await log(trip, { kind: 'Rest', gameTime: '2000-01-20T00:00', endGameTime: '2000-01-21T06:00' });
  ok('a 30:00 after it is a reduced weekly rest again', /reduced weekly rest/.test(after) && !/long daily rest/.test(after), after);

  head('4. A long ferry early in the six days is a long daily rest');
  // The weekly rest ended Day 21 06:00. A 29:30 ferry from Day 23 03:00 leaves 69:30 of the six days: not worth one.
  const early = await log(trip, { kind: 'Ferry', gameTime: '2000-01-23T03:00', endGameTime: '2000-01-24T08:30', ferryRoute: 'travemunde-helsinki', cabin: true });
  h = await hos();
  ok('said as a long daily rest, with what is left of the six days', /long daily rest, not your weekly one: 69:30/.test(early), early);
  ok('  nothing more owed (still the 15:00 from Day 20)', Math.abs(h.euCompensationOwed - 15) < 0.05, `${h.euCompensationOwed}`);
  ok('  and the six days still run from Day 21 06:00', Math.abs(h.euHoursSinceWeeklyRest - 74.5) < 0.1, `${h.euHoursSinceWeeklyRest}`);
  const ex = (await api('/export')).trips.find((x) => x.id === trip.id);
  const fev = ex.events.find((e) => e.gameTime === '2000-01-23T03:00');
  ok('  kept on the log entry', fev.weeklyRest === 'daily', fev.weeklyRest);

  head('4b. The driver switches it');
  await api(`/trips/${trip.id}/event/${fev.id}/weekly`, 'POST', { weekly: true });
  h = await hos();
  let fx = (await api('/export')).trips.find((x) => x.id === trip.id).events.find((e) => e.id === fev.id);
  ok('now the weekly rest: 15:30 more owed, six days from the ferry', Math.abs(h.euCompensationOwed - 30.5) < 0.05
    && Math.abs(h.euHoursSinceWeeklyRest) < 0.1 && /reduced weekly rest \(15:30 owed back\)/.test(fx.detail),
    `${h.euCompensationOwed} ${h.euHoursSinceWeeklyRest} ${fx.detail}`);
  await api(`/trips/${trip.id}/event/${fev.id}/weekly`, 'POST', { weekly: false });
  h = await hos();
  fx = (await api('/export')).trips.find((x) => x.id === trip.id).events.find((e) => e.id === fev.id);
  ok('and back again', Math.abs(h.euCompensationOwed - 15) < 0.05 && /long daily rest/.test(fx.detail), `${h.euCompensationOwed} ${fx.detail}`);

  head('4c. Near the end of the six days it is the weekly rest');
  // From Day 26 03:00 the six days (to Day 27 06:00) run out during the crossing.
  const late = await log(trip, { kind: 'Ferry', gameTime: '2000-01-26T03:00', endGameTime: '2000-01-27T08:30', ferryRoute: 'travemunde-helsinki', cabin: true });
  ok('the reduced weekly rest', /a reduced weekly rest \(15:30 owed back\)/.test(late), late);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
