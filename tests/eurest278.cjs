/* EU rests, decided by dispatch (reported from play, v0.80).
 *
 *   - the stop messages on an ETS2 career say the EU rest — an 11-hour daily rest, the weekly rest, or wait for
 *     Monday — never ATS's 10-hour reset, the 70 or the 34
 *   - the weekly rest's length is dispatch's call: a reduced weekly rest is anything from 24 up to 45, and what
 *     it is short of 45 is owed back. 24 by default; until Monday when weekly driving is nearly spent; 45 at the
 *     yard; 45 plus what is owed after a reduced one
 *   - what is owed is kept: a 30-hour rest owes 15, and a later status-line report does not forget it
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
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const near = (a, b) => Math.abs(a - b) < 0.02;
const US = /10-hour|34|70-hour|\bcycle\b|reset/i;

async function at(day, hm, city = 'Lyon', cc = 'FR') {
  await api('/status', 'POST', { locationCity: city, locationState: cc, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
}
/** Clocks as given, nothing derived. */
const clocks = (day, hm, c) => api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 40,
  asOfGameTime: iso(day, hm), euWeekDriven: 16, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 40, ...c });
async function board(day, hm) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Lyon', originState: 'FR',
    destCity: 'Marseille', destState: 'FR', loadedMiles: 190, deadheadMiles: 0, gameRevenue: 2500, deadlineHours: 30, weightLbs: 30000, atLocation: true });
}
const freshOrders = async () => { const st = await api('/export'); st.restartOrders = []; await api('/import', 'POST', st); };

(async () => {
  const app = { driverName: 'M. Dubois', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  // The carrier's own country, so a domestic French load is not cabotage.
  const st0 = await api('/export');
  st0.settings.runnableStates = [];
  Object.assign(st0.company.terminals[0], { city: 'Lyon', state: 'FR', isHeadquarters: true });
  st0.company.terminalState = 'FR'; st0.company.terminalCity = 'Lyon';
  await api('/import', 'POST', st0);

  head('1. Out of hours for the day: the 11-hour daily rest, in EU words');
  await at(9, '18:00');
  await clocks(9, '18:00', { driveRemaining: 0.5, shiftRemaining: 3 });
  let d = await board(9, '18:00');
  const said = [d.headline, d.rationale, ...(d.dispatchNotes || []), ...((d.evaluations[0] || {}).hardFails || [])].join(' | ');
  ok('stopped, and told to take the 11-hour daily rest', d.rejectAll && /11-hour daily rest/.test(said), said.slice(0, 220));
  ok('nothing about a 10-hour reset, the 70 or a 34', !US.test(said), (said.match(/.{40}(10-hour|34|70-hour|cycle|reset).{40}/i) || [''])[0]);

  head('2. The weekly rest is due: dispatch sets the length');
  await freshOrders();
  await clocks(10, '08:00', { euHoursSinceWeeklyRest: 125, euLastWeeklyRestReduced: false, euCompensationOwed: 0, cycleRemaining: 40 });
  await at(10, '08:00');
  d = await board(10, '08:00');
  let S = await api('/bootstrap');
  let order = (S.restartOrders || [])[0];
  ok('ordered: 24 hours, a reduced weekly rest', order && near(order.requiredHours, 24), `${order?.requiredHours}`);
  const inst = ((d.evaluations[0] || {}).hardFails || []).join(' ');
  ok('the order says why, and what is owed', /set it at 24:00/.test(inst) && /21:00 short of 45 is owed back/.test(inst), inst.slice(0, 260));
  ok('headed as the weekly rest, not the 34', /weekly rest is due/.test(d.headline || '') || /weekly rest is due/.test(inst) && !/34/.test(inst));

  head('3. Weekly driving nearly spent: rest until Monday, less owed');
  await freshOrders();
  await clocks(13, '06:00', { euHoursSinceWeeklyRest: 125, euLastWeeklyRestReduced: false, cycleRemaining: 5, euWeekDriven: 51 });
  await at(13, '06:00');      // Saturday 06:00: Monday 00:00 is 42 hours away
  await board(13, '06:00');
  order = ((await api('/bootstrap')).restartOrders || [])[0];
  ok('42 hours, to Monday 00:00 — a reduced rest with 3 owed, not 21', order && near(order.requiredHours, 42), `${order?.requiredHours}`);

  head('4. Taken: 30 hours owes 15, and it is kept');
  await freshOrders();
  await clocks(16, '06:00', { euHoursSinceWeeklyRest: 125, euLastWeeklyRestReduced: false, euCompensationOwed: 0, cycleRemaining: 40 });
  await at(16, '06:00');
  await board(16, '06:00');
  // Away from the yard (Lyon), so dispatch sets the reduced 24 — at the yard it would be a full 45, home time.
  await api('/restart/arrived', 'POST', { gameTime: iso(16, '08:00'), city: 'Marseille', state: 'FR' });
  const done = await api('/restart/complete', 'POST', { gameTime: iso(17, '14:00') });
  S = await api('/bootstrap');
  ok('30 hours sat: a reduced weekly rest, 15 owed', S.hos.euLastWeeklyRestReduced === true && near(S.hos.euCompensationOwed, 15), `${S.hos.euCompensationOwed}`);
  ok('no hotel: under 45 the cab is allowed', !/hotel booked/.test(JSON.stringify(done)));
  const all = JSON.stringify(await api('/bootstrap'));
  ok('and nothing tells a European driver to sit thirty-four hours', !/thirty-four|34-hour/.test(all), (all.match(/.{120}(thirty-four|34-hour).{60}/) || [''])[0]);
  await at(17, '20:00');
  const h = (await api('/hos', 'POST', { breakRemaining: 4.5, driveRemaining: 6, shiftRemaining: 0, cycleRemaining: 50, asOfGameTime: iso(17, '20:00'),
    euWeekDriven: 6, euLastWeekDriven: 30, euDayDriven: null, spreadEstimated: true })).hos;
  ok('a status-line report afterwards keeps the 15 owed', near(h.euCompensationOwed, 15) && h.euLastWeeklyRestReduced === true,
    `${h.euCompensationOwed}, reduced ${h.euLastWeeklyRestReduced}`);

  head('4b. At the yard: a full 45, home time');
  {
    const st1 = await api('/export'); st1.restartOrders = []; await api('/import', 'POST', st1);
  }
  await clocks(19, '06:00', { euHoursSinceWeeklyRest: 125, euLastWeeklyRestReduced: false, euCompensationOwed: 0, cycleRemaining: 40 });
  await at(19, '06:00');
  await board(19, '06:00');
  const atYard = await api('/restart/arrived', 'POST', { gameTime: iso(19, '07:00'), city: 'Lyon', state: 'FR' });
  ok('parked at the yard: dispatch makes it the full 45', near(atYard.order.requiredHours, 45), `${atYard.order.requiredHours}`);
  await api('/restart/complete', 'POST', { gameTime: iso(21, '04:00') });

  head('5. After a reduced one: 45 plus what is owed');
  await freshOrders();
  await clocks(22, '08:00', { euHoursSinceWeeklyRest: 125, euLastWeeklyRestReduced: true, euCompensationOwed: 15, cycleRemaining: 40 });
  await at(22, '08:00');
  await board(22, '08:00');
  order = ((await api('/bootstrap')).restartOrders || [])[0];
  ok('60 hours: the full 45 and the 15 paid back', order && near(order.requiredHours, 60), `${order?.requiredHours}`);

  head('6. The planner takes a long wait as a longer reduced rest, not a 45 and a hotel');
  await freshOrders();
  await clocks(13, '06:00', { euHoursSinceWeeklyRest: 20, euLastWeeklyRestReduced: false, euCompensationOwed: 0, cycleRemaining: 0.2,
    euWeekDriven: 56, driveRemaining: 9 });
  const p = await api('/hos/plan', 'POST', { deadlineHours: 80, loadingHours: 0.5, unloadingHours: 0.5, trailerType: 'Dry Van',
    usableFuelRangeMiles: 99999, startGameTime: iso(13, '06:00'), loadedMiles: 100 });
  const wk = (p.timeline || []).find((t) => /weekly rest/.test(t.label));
  ok('weekly driving spent on Saturday: the wait to Monday is a longer reduced weekly rest, under 21 owed', wk
    && /41:15 reduced weekly rest/.test(wk.label) && /3:45 owed back/.test(wk.label), wk?.label);
  ok('and no hotel for it', (p.hotelNights || 0) === 0, `${p.hotelNights} night(s)`);

  head('7. Spending the week: home beats a hotel (reported from play: six hotel nights to Monday)');
  await freshOrders();
  // Tuesday (day 23) in Marseille with 6 hours of the week's driving left. The yard is Lyon.
  await clocks(23, '08:00', { euHoursSinceWeeklyRest: 30, euLastWeeklyRestReduced: false, euCompensationOwed: 0,
    cycleRemaining: 6, euWeekDriven: 50, euLastWeekDriven: 30, driveRemaining: 9, shiftRemaining: 13 });
  await api('/status', 'POST', { locationCity: 'Marseille', locationState: 'FR', locationKind: 'TruckStop', gameTime: iso(23, '08:00'),
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/board/clear', 'POST', {});
  const lane = (dest, cc, mi, rev) => api('/board/add', 'POST', { cargo: `Paper to ${dest}`, trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Marseille', originState: 'FR', destCity: dest, destState: cc, loadedMiles: mi, deadheadMiles: 0, gameRevenue: rev,
    deadlineHours: 30, weightLbs: 30000, atLocation: true });
  await lane('Nice', 'FR', 120, 2600);
  d = await lane('Lyon', 'FR', 195, 2600);
  const nice = d.evaluations.find((x) => x.load.destCity === 'Nice');
  const lyon = d.evaluations.find((x) => x.load.destCity === 'Lyon');
  ok('Nice spends the week away: parked until Monday, hotel nights costed', nice.euStrandedNights >= 2 && nice.euStrandedCost > 0
    && /parked|sits there/.test(nice.euWeekEnd), `${nice.euStrandedNights} night(s), ${nice.euStrandedCost}: ${nice.euWeekEnd}`);
  ok('and the cost comes off its margin', nice.cons.some((c) => /hotel/.test(c)));
  ok('Lyon ends at the yard: the wait to Monday is home time', /home time/.test(lyon.euWeekEnd), lyon.euWeekEnd);
  ok('so the load home is the one dispatch picks', (d.authorizedLoadId === lyon.load.id) || (lyon.score > nice.score),
    `Lyon ${lyon.score} vs Nice ${nice.score}`);

  await api('/board/clear', 'POST', {});
  d = await lane('Nice', 'FR', 120, 2600);
  const notes = (d.dispatchNotes || []).join(' | ');
  ok('with only Nice on the board: run home empty instead, the week still gets you there', /run home empty/.test(notes), notes.slice(0, 300));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
