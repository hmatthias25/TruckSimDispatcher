/* EU home time as a term of a salaried contract (v0.82).
 *
 *   - the tours are two, three or four weeks out; the days at home grow with the tour and with rank
 *   - fixed on probation, fixed for six months after it, then renegotiated at the yard and good for a year
 *   - leaving the yard with it on the table keeps it as it is
 *   - home time is the weekly rest: never less than 45 plus what is owed, held to Monday 00:00 where the week
 *     was driven, and nothing is dispatched before then
 *   - once it has run, it is on the record as a regular weekly rest: nothing owed, the six days fresh
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
const refused = async (p, b) => { try { await api(p, 'POST', b); return null; } catch (e) { return e.message; } };
/** The status line as the browser sends it: B D W 2W, hours left. */
const line = (at, b, d, w, w2) => api('/hos', 'POST', {
  breakRemaining: b, driveRemaining: d, shiftRemaining: 0, cycleRemaining: Math.min(w, w2), asOfGameTime: at,
  euWeekDriven: Math.max(0, 56 - w), euLastWeekDriven: Math.max(0, 90 - w2 - Math.max(0, 56 - w)),
  euDayDriven: null, spreadEstimated: true,
}).then((s) => s.hos);

let yard;
const at = (city, state, gameTime) => api('/status', 'POST', { locationCity: city, locationState: state, locationKind: 'TruckStop',
  gameTime, fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
const atYard = (gameTime) => at(yard.city, yard.state, gameTime);
const away = (gameTime) => at(yard.state === 'DE' ? 'Wien' : 'Hamburg', yard.state === 'DE' ? 'AT' : 'DE', gameTime);
const addLoad = () => api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
  originCity: yard.city, originState: yard.state, destCity: yard.city, destState: yard.state, loadedMiles: 60, deadheadMiles: 0,
  gameRevenue: 900, weightLbs: 30000, atLocation: false, deadlineHours: 30 });

(async () => {
  const app = { driverName: 'A. Novak', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) });
  let S = await api('/bootstrap');
  yard = S.company.terminals.find((t) => t.id === S.driver.homeTerminalId) || S.company.terminals[0];

  head('1. On probation: the EU tours, the table, and no changing it');
  let c = S.views.euHomeContract;
  ok('the contract is on the snapshot', !!c, JSON.stringify(c || {}).slice(0, 120));
  ok('the tours are two, three and four weeks', JSON.stringify(S.views.homeTimeOptions.map((o) => o.days)) === '[14,21,28]',
    JSON.stringify(S.views.homeTimeOptions.map((o) => o.key)));
  ok('the arrangement is one of them', [14, 21, 28].includes(S.driver.homeTimeIntervalDays), `${S.application.homeTimePreference} ${S.driver.homeTimeIntervalDays}`);
  ok('the table: probationary 4/5/7 up to lead 7/10/14',
    JSON.stringify(c.table.map((r) => r.days)) === '[[4,5,7],[5,7,9],[6,8,11],[7,10,14]]');
  ok('a probationer is on the first row', c.rankRow === 0 && c.onProbation === true);
  let why = await refused('/career/home-time', { preference: 'threeweeks' });
  ok('a change is refused on probation', /probation/i.test(why || ''), why);

  head('2. Probation cleared: fixed for six months');
  await atYard(iso(1, '07:00'));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  S = await api('/bootstrap');
  c = S.views.euHomeContract;
  ok('a company driver now, on the second row', c.rankRow === 1, `${S.driver.rank}`);
  ok('first renegotiation is 180 days after clearing', c.renewalDue === iso(181, '07:00'), c.renewalDue);
  why = await refused('/career/home-time', { preference: 'fourweeks' });
  ok('a change inside the six months is refused, with the date', /stands until/.test(why || ''), why);
  ok('nor is there anything to keep', /no home-time agreement up/i.test((await refused('/career/home-time/keep', {})) || ''));
  why = await refused('/career/home-time', { preference: 'sixweeks' });
  ok('six weeks is not a European tour', /two, three or four weeks/.test(why || ''), why);

  head('2b. At the yard before the tour is due: not held');
  // The first report after hire, and a run through the home city two days in, are being at the yard, not a home time.
  await away(iso(3, '05:00'));
  const early = await atYard(iso(3, '09:00'));
  ok('not held: no ready date', !(early.homeBrief || {}).readyToRunGameTime, (early.homeBrief || {}).readyToRunGameTime);
  await api('/board/clear', 'POST', {});
  const free = await addLoad();
  ok('and the board is open', !/on home time until/.test((free.dispatchNotes || []).join(' ')), free.headline);

  head('3. Home on a Monday after driving: held to the next Monday');
  // Off the yard first, so the next report there is an arrival.
  await away(iso(15, '05:00'));
  await line(iso(15, '05:00'), 4.5, 10, 56, 90);
  // A reduced weekly rest earlier, so there are hours owed back to see paid.
  await api('/restart/take-here', 'POST', {});
  await line(iso(15, '05:00'), 4.5, 10, 56, 90);
  const done = await api('/restart/complete', 'POST', { gameTime: iso(16, '05:00') });
  ok('a reduced 24 owes 21 back', /owed back/.test(done.message || ''), done.message);
  await line(iso(16, '05:00'), 4.5, 10, 56, 90);
  let h = await line(iso(16, '09:00'), 0.5, 6, 52, 86);
  ok('the week has driving in it, and hours owed', h.euCompensationOwed > 20, `${h.euCompensationOwed} owed`);
  // Tuesday day 16, fifteen days into a fortnight: the contract's 5 days run to Sunday day 21 07:00, so Monday day 22 00:00 is what sets it.
  const arrive = await atYard(iso(16, '10:00'));
  ok('home time taken', arrive.wentHome === true);
  const brief = arrive.homeBrief || {};
  ok('ready to run Monday 00:00', brief.readyToRunGameTime === iso(22, '00:00'), brief.readyToRunGameTime);
  ok('and it says why', /Monday 00:00/.test(brief.readyToRunNote || '') && /5 days at home/.test(brief.readyToRunNote || ''), brief.readyToRunNote);
  ok('no US restart advice in it', !/restart while|full 70/.test(JSON.stringify(brief)));
  S = arrive.snapshot;
  ok('the days on the trailer form are the contract\'s', S.driver.homeDaysPlanned === 5, `${S.driver.homeDaysPlanned}`);

  head('4. Nothing dispatched while home');
  await api('/board/clear', 'POST', {});
  let d = await addLoad();
  const stops = (d.dispatchNotes || []).join(' | ');
  ok('the board is refused', d.rejectAll === true, d.headline);
  ok('because of home time, with the date', /on home time until/.test(stops) && /weekly/.test(stops), stops.slice(0, 260));
  ok('no weekly rest is ordered on top of it', !d.needsRestart);

  head('5. Monday: the rest is on the record and the tour starts clean');
  await atYard(iso(22, '06:00'));
  h = await line(iso(22, '06:00'), 4.5, 10, 56, 90);
  ok('nothing owed', h.euCompensationOwed === 0, `${h.euCompensationOwed}`);
  ok('a regular weekly rest, not reduced', h.euLastWeeklyRestReduced === false);
  ok('the six days start from it', h.euHoursSinceWeeklyRest != null && h.euHoursSinceWeeklyRest < 7, `${h.euHoursSinceWeeklyRest}`);
  S = await api('/bootstrap');
  const rest = (S.restartOrders || []).find((o) => o.trigger === 'HomeTime');
  ok('written as a completed home-time rest', rest && rest.status === 'Completed' && rest.atHomeTerminal, JSON.stringify(rest || {}).slice(0, 200));
  await api('/board/clear', 'POST', {});
  d = await addLoad();
  ok('and the board is open again', !/on home time until/.test((d.dispatchNotes || []).join(' ')), d.headline);

  head('6. Six months on: renegotiated at the yard');
  await away(iso(190, '06:00'));
  await line(iso(190, '06:00'), 4.5, 10, 56, 90);
  S = await api('/bootstrap');
  ok('due, but not open off the yard', S.views.euHomeContract.renewalIsDue && !S.views.euHomeContract.renewalOpen);
  why = await refused('/career/home-time', { preference: 'fourweeks' });
  ok('so a change is still refused, pointing at the yard', /at the yard/.test(why || ''), why);
  const back = await atYard(iso(190, '12:00'));
  ok('open on arrival', back.snapshot.views.euHomeContract.renewalOpen === true);
  ok('and the brief says so', /up for renegotiation/.test(JSON.stringify(back.homeBrief || {})));
  const changed = await api('/career/home-time', 'POST', { preference: 'fourweeks' });
  c = changed.views.euHomeContract;
  ok('changed to four weeks: nine days at home', changed.driver.homeTimeIntervalDays === 28 && c.daysOff === 9, `${changed.driver.homeTimeIntervalDays} ${c.daysOff}`);
  ok('closed again, and good for a year', !c.renewalOpen && c.renewalDue === iso(555, '12:00'), c.renewalDue);
  why = await refused('/career/home-time', { preference: 'biweekly' });
  ok('a second change is refused', /stands until/.test(why || ''), why);

  head('7. A year on: left on the table, it is kept');
  await away(iso(560, '06:00'));
  await atYard(iso(560, '12:00'));
  S = await api('/bootstrap');
  ok('open again a year later', S.views.euHomeContract.renewalOpen === true);
  await away(iso(570, '06:00'));
  S = await api('/bootstrap');
  c = S.views.euHomeContract;
  ok('kept as it was on leaving', !c.renewalOpen && S.driver.homeTimeIntervalDays === 28, `${S.driver.homeTimeIntervalDays}`);
  ok('next due a year from that home time', c.renewalDue === iso(935, '06:00'), c.renewalDue);
  ok('and the log says so', (S.events || []).some((e) => /kept as it was/.test(e.message)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
