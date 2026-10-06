/* Working home on an EU tour (reported from play, v0.82): Novi Sad, a thousand kilometres from the yard with under
 * four days left. The app reckoned a day's driving at the US 605 miles, called Zenica and Tuzla "roughly neutral",
 * gave Bosnia's tier-1 market a bonus over Vienna, and ran the driver between Serbia and Bosnia. On probation, with
 * every homeward load tight on its window, there was nothing they were allowed to run.
 *
 *   - home is "tight" when the days left barely cover working home at the driver's own pace, and it says so
 *   - a load that gets no nearer is refused; one that closes more scores more
 *   - the feasible homeward load is booked; with none, a tight homeward one is dispatch's call, not the driver's
 *   - with nothing homeward at all, the run home is offered at any distance, with the EU rest named
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
const NOW = '2000-01-19T11:00';

async function board(loads) {
  await api('/board/clear', 'POST', {});
  let d;
  for (const l of loads)
    d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Novi Sad', originState: 'RS',
      deadheadMiles: 0, weightLbs: 30000, atLocation: false, ...l });
  return d;
}
const km = (k) => k / 1.609344;

(async () => {
  const app = { driverName: 'C. Novak', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 1, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });

  // Eighteen days into a three-week tour, standing in Novi Sad.
  const st = await api('/export');
  st.application.homeTimePreference = 'threeweeks';
  st.driver.homeTimeIntervalDays = 21;
  st.driver.lastHomeGameTime = '2000-01-01T11:00';
  st.driver.atHomeYard = false;
  st.restartOrders = [];
  await api('/import', 'POST', st);
  await api('/status', 'POST', { locationCity: 'Novi Sad', locationState: 'RS', locationKind: 'Shipper', gameTime: NOW,
    fuelPct: 100, atsOdometer: 5000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 40, asOfGameTime: NOW,
    euWeekDriven: 16, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 30, spreadEstimated: false });
  const S = await api('/bootstrap');
  const yard = S.company.terminals.find((t) => t.id === S.driver.homeTerminalId) || S.company.terminals[0];
  const ht = S.views.homeTime;

  head('1. Tight: the days left barely cover working home');
  ok('the yard is far', ht.milesFromHome * 1.609344 > 900, `${yard.city}, ${Math.round(ht.milesFromHome * 1.609344)} km`);
  ok('tight, and due', ht.tight === true && ht.dueSoon === true, `${ht.daysUntilDue.toFixed(1)} days left, ${ht.daysToGetHome?.toFixed(1)} to work home`);
  ok('the headline says how far in days', /days of working freight home at your pace/.test(ht.headline), ht.headline);
  ok('nothing more than a little further out', ht.outboundAllowance <= 70, `${ht.outboundAllowance} mi`);

  head('2. Sideways is refused; nearer wins; a strong market does not buy it back');
  const generous = { deadlineHours: 40 };
  let d = await board([
    { destCity: 'Zenica', destState: 'BA', loadedMiles: km(230), gameRevenue: 900, ...generous },
    { destCity: 'Banja Luka', destState: 'BA', loadedMiles: km(256), gameRevenue: 700, ...generous },
    { destCity: 'Vienna', destState: 'AT', loadedMiles: km(505), gameRevenue: 900, ...generous },
  ]);
  const by = (c) => d.evaluations.find((e) => e.load.destCity === c);
  ok('Zenica refused: no real progress', /no real progress/.test((by('Zenica').homeTimeFails || []).join(' ')), (by('Zenica').homeTimeFails || [])[0]);
  ok('Vienna outscores Banja Luka', by('Vienna').score > by('Banja Luka').score, `${by('Vienna').score.toFixed(2)} vs ${by('Banja Luka').score.toFixed(2)}`);
  ok('and Vienna is booked', d.authorizedLoadId === by('Vienna').load.id, d.headline);
  // "(1,190 → 715 km out)", not miles on the left and kilometres on the right.
  const closes = (by('Vienna').scoreDetail || []).find((l) => /toward/.test(l)) || '';
  const from = +((closes.match(/\(([\d,]+) →/) || [])[1] || '0').replace(/,/g, '');
  ok('distances in one unit', from > 900, closes);

  head('3. The only homeward load is tight on its window: dispatch books it, on probation');
  d = await board([
    { destCity: 'Zenica', destState: 'BA', loadedMiles: km(230), gameRevenue: 900, deadlineHours: 40 },
    { destCity: 'Vienna', destState: 'AT', loadedMiles: km(505), gameRevenue: 900, deadlineHours: 13.2 },
  ]);
  const vienna = d.evaluations.find((e) => e.load.destCity === 'Vienna');
  ok('Vienna is tight on its window', vienna.feasibility.verdict === 'Tight', `${vienna.feasibility.verdict}, slack ${vienna.feasibility.slackHours}`);
  ok('and dispatch takes it anyway', d.authorizedLoadId === vienna.load.id, d.headline);
  ok('saying why', (d.dispatchNotes || []).some((n) => /barely cover the run home/.test(n)), (d.dispatchNotes || []).join(' | ').slice(0, 300));
  let refusedAccept = null;
  try { await api('/dispatch/authorize', 'POST', { loadId: vienna.load.id, overrideTight: false }); } catch (e) { refusedAccept = e.message; }
  ok('a probationer can accept it', !refusedAccept, refusedAccept || 'accepted');

  head('4. Nothing on the board heads home: the run home, however far');
  const st2 = await api('/export');
  st2.trips = st2.trips.filter((t) => t.status !== 'Dispatched' && t.status !== 'InProgress');
  st2.status.activeTripId = '';
  await api('/import', 'POST', st2);
  d = await board([{ destCity: 'Zenica', destState: 'BA', loadedMiles: km(230), gameRevenue: 900, deadlineHours: 40 }]);
  ok('nothing authorized', !d.authorizedLoadId, d.headline);
  const B2 = await api('/bootstrap');
  const run = (B2.views.repositionOffers || []).find((o) => o.isHomeRun);
  ok('the run home is offered', !!run && run.city === yard.city, run ? `${run.city} ${Math.round(run.miles * 1.609344)} km` : 'none');
  // Within two shifts it reads as one overnight; past that, in days. Either way it is the EU rest that is named.
  // Planned, so the plan says how the days fall, on its own line beside the reason.
  ok('planned, with the arrival', run && /You get there/.test(run.planNote || ''), run?.planNote);
  ok('and the board says to go, naming the EU rest', (d.dispatchNotes || []).some((n) => /11-hour daily rest on the way/.test(n)),
    (d.dispatchNotes || []).find((n) => /Nothing on this board goes home/.test(n)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
