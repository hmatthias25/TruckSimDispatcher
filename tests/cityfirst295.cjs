/* The receiver's board, then the city's, then somewhere else or home — in that order (asked for from play, v0.86).
 *
 * A dock board with nothing on it worth running used to put the run home on offer beside "open the city board",
 * with the trailer question asked there and then — so the empty run home could be taken off one dock's freight.
 * And "nothing in the city either" cleared the board and said nothing at all about where to go.
 *
 *   - a dock board that fails asks for the city, and offers no run home and asks no trailer question yet
 *   - a city board that fails says where to go — home, or markets on the way — with the run home on offer
 *   - "nothing in the city either" gets that same answer
 *   - the same on an ATS career and an ETS2 one
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
const notes = (d) => (d.dispatchNotes || []).join(' | ');

async function board(here, loads, atLocation) {
  await api('/board/clear', 'POST', {});
  let d;
  for (const l of loads)
    d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
      originCity: here.city, originState: here.state, deadheadMiles: 0, weightLbs: 30000, atLocation, deadlineHours: 40, ...l });
  return d;
}

async function story(name, here, sideways) {
  head(`${name}: 1. The dock board has nothing going home`);
  const dock = await board(here, sideways, true);
  ok('nothing is authorized', !dock.authorizedLoadId, dock.headline);
  ok('it is the dock, and it asks for the city', dock.localOnly === true && /open the full\s+freight board/i.test(notes(dock)), notes(dock).slice(0, 200));
  ok('no trailer or days-off question off one dock', !dock.askHomeDays && !(dock.askWhereabouts || []).length,
    `askHomeDays=${dock.askHomeDays}, askWhereabouts=${(dock.askWhereabouts || []).length}`);
  ok('and it does not send anybody anywhere yet', !/Run it in empty|check what is loading out of/i.test(notes(dock)), notes(dock).slice(0, 200));

  head(`${name}: 2. The city board has nothing either`);
  const city = await board(here, sideways, false);
  ok('rejected, and not the dock any more', city.rejectAll === true && !city.localOnly, city.headline);
  ok('it says where to go — home, or markets on the way', /Run it in empty|check what is loading out of|take your rest/i.test(notes(city)),
    notes(city).slice(0, 260));
  const offers = (await api('/bootstrap')).views.repositionOffers || [];
  ok('with the run home on offer', offers.some((o) => o.isHomeRun), offers.map((o) => o.city).join(', ') || 'none');

  head(`${name}: 3. Or the driver says the city has nothing, without entering it`);
  await board(here, sideways, true);
  const r = await api('/dispatch/reject-all', 'POST', { reason: 'fixture', cityChecked: true });
  const next = r.next;
  ok('there is a next step, not silence', !!next && next.rejectAll === true, next?.headline);
  ok('saying where to go', /Run it in empty|check what is loading out of|take your rest/i.test(notes(next || {})), notes(next || {}).slice(0, 260));
  ok('and the run home brings its days-off question with it', next?.askHomeDays === true, `askHomeDays=${next?.askHomeDays}`);
}

(async () => {
  // ---- ATS: Denver, two days from home time, Springfield a long way off.
  const us = { driverName: 'C. First', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', us);
  await api('/onboarding/hire', 'POST', { application: us, force: true, gameTime: '2000-01-01T07:00', code: 'PRI' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', { locationCity: 'Denver', locationState: 'CO', locationKind: 'Receiver', gameTime: '2000-01-13T07:00',
    fuelPct: 100, atsOdometer: 9000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  const hs = (await api('/bootstrap')).views.homeTime;
  ok('ATS: home time is due', hs.dueSoon === true, `${hs.daysUntilDue?.toFixed?.(1)} days, ${Math.round(hs.milesFromHome)} mi`);
  await story('ATS', { city: 'Denver', state: 'CO' }, [
    { destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 520, gameRevenue: 1900 },
    { destCity: 'Cheyenne', destState: 'WY', loadedMiles: 100, gameRevenue: 400 },
  ]);

  // ---- ETS2: Novi Sad, three days left, the yard 1,200 km off.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: false });
  const eu = { driverName: 'C. Prvi', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 1, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', eu);
  await api('/onboarding/hire', 'POST', { application: eu, force: true, gameTime: '2000-01-01T06:00' });
  const st = await api('/export');
  st.application.homeTimePreference = 'threeweeks';
  st.driver.homeTimeIntervalDays = 21;
  st.driver.lastHomeGameTime = '2000-01-01T11:00';
  st.driver.atHomeYard = false;
  await api('/import', 'POST', st);
  await api('/status', 'POST', { locationCity: 'Novi Sad', locationState: 'RS', locationKind: 'Receiver', gameTime: '2000-01-19T11:00',
    fuelPct: 100, atsOdometer: 5000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 40, asOfGameTime: '2000-01-19T11:00',
    euWeekDriven: 16, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 30, spreadEstimated: false });
  await story('ETS2', { city: 'Novi Sad', state: 'RS' }, [
    { destCity: 'Zenica', destState: 'BA', loadedMiles: 230 / 1.609344, gameRevenue: 900 },
    { destCity: 'Tuzla', destState: 'BA', loadedMiles: 150 / 1.609344, gameRevenue: 600 },
  ]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
