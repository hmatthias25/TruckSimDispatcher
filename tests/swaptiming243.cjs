/* The trailer change belongs to the run home, and to nothing before it.
 *
 *   "Having a heads up show with bad info a day out on my tour is not realistic and wrong. I don't see
 *    ANYTHING about trailer swaps when I get back for home time until the trip back to the terminal."
 *
 * It fired from four places. Three were already right, and all three are the same event: dispatch
 * sending the driver home — a load that finishes at the yard, a run-home order with nothing on the board
 * going that way, or a board where everything runs further out and home time is already late.
 *
 * The fourth fired at any drop from three quarters of the way through the interval. On a fortnight that
 * is day ten and a half, with two or three loads still to run, so the driver got the questions AND a
 * forecast off them about a home time nobody had planned yet. Being wrong early is worse than saying
 * nothing: the driver cannot tell which of the two answers they are going to get is the real one.
 *
 * And where the questions are asked, the answer now waits for them. It used to pick a box in the same
 * breath as asking where the boxes were, off whatever stale positions were on file, then re-decide when
 * the answers came in — so the first thing read was a forecast built on nothing and the second was a
 * different one.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S, yard, day = 3, odo = 5_000;

const report = (city, st, d, kind = 'TruckStop') => api('/status', 'POST', {
  locationCity: city, locationState: st, locationKind: kind, gameTime: iso(d),
  fuelPct: 80, atsOdometer: (odo += 400), truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OnDuty',
});

/** One load out and delivered, closed out away from the yard. Returns the close-out audit. */
async function runLoad(destCity, destState, d) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 380, deadheadMiles: 0,
    gameRevenue: 1600, deadlineHours: 60, weightLbs: 38000,
  });
  const pick = (board.evaluations || [])[0];
  if (!pick) return { board, audit: null };
  const auth = await api('/dispatch/authorize', 'POST', { loadId: pick.load.id });
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(d + 1), actualMiles: 380, endOdometer: (odo += 380), actualRevenue: 1600,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 5, trailerDamageAfter: 3, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, locationKind: 'Receiver',
    fuelPct: 50, gameTime: iso(d + 1),
  });
  S = done.snapshot;
  return { board, audit: done.audit };
}

(async () => {
  const app = { driverName: 'E. Bauer', preferredDivision: 'Dry Van', experienceYears: 8,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));

  // Boxes on the home yard, so there is something a change could land on.
  for (const [unit, type] of [['B-1', 'Reefer'], ['B-2', 'Flatbed'], ['B-3', 'Dry Van']])
    await api('/fleet/trailer', 'POST', {
      unit, type, division: type, year: 2021, status: 'InService',
      inGameGarage: true, homeTerminalId: yard.id,
    });
  let st = await api('/export');
  st.company.divisions = ['Dry Van', 'Reefer', 'Flatbed'];
  await api('/import', 'POST', st);

  head('1. Three quarters through the tour, nothing is said about trailers');
  // Day 11-ish of a fortnight: dueSoon is true and the old trigger fired here. The driver still has
  // loads to run and the home time has not been planned, so there is nothing honest to say yet.
  st = await api('/export');
  st.status.gameTime = iso(13);
  st.driver.lastHomeGameTime = iso(2);       // 11 days out of 14 — past the old 75% trigger
  st.driver.homeTimesTaken = 4;              // settled enough that a re-rig is on the cards at all
  S = un(await api('/import', 'POST', st));

  const hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is flagged due soon', hs?.dueSoon === true, `${hs?.daysOut?.toFixed?.(1)} of ${hs?.intervalDays}`);
  ok('but not actually due yet', hs?.overdue === false, `overdue=${hs?.overdue}`);

  const mid = await runLoad('Amarillo', 'TX', 13);
  ok('closing a load out asks for no trailer positions',
    !(mid.audit?.askWhereabouts || []).length,
    (mid.audit?.askWhereabouts || []).map((x) => x.unit).join(', ') || 'nothing asked');
  ok('and forecasts no changeover', !mid.audit?.changeoverNote,
    (mid.audit?.changeoverNote || '(silent)').slice(0, 90));
  ok('nor promises a box behind the scenes', !(await api('/export')).driver.changeoverUnit,
    (await api('/export')).driver.changeoverUnit || '(none)');

  head('1b. The Home time panel is silent about it too');
  // The surface that was missed, and the one actually reported: "TRAILER CHANGE COMING — operations
  // wants you on flatbed... 48K 9KU is 1,005 mi from the yard... reckon the game charges 4 days", shown
  // beside "2.5 days out of 14". It called Decide() on every render, so it announced a change the moment
  // the career was eligible for one, off positions nobody had been asked for — and clearing the stored
  // promise did not stop it, because it was never reading the stored promise.
  const hv = (await api('/bootstrap')).views.homeTime;
  ok('no trailer-change notice two days into the tour', !hv?.reassignmentNotice,
    (hv?.reassignmentNotice || '(silent)').slice(0, 95));
  ok('and nothing is stored for it to have come from', !(await api('/export')).driver.changeoverNote,
    (await api('/export')).driver.changeoverNote?.slice(0, 60) || '(nothing stored)');

  head('2. The run home is where the questions are put');
  // Overdue, and every load on the board runs further out. That is the "run it in empty" case.
  //
  // Whether a change is wanted at all is a seeded roll per home time — the factor that decides if the
  // driver should even be moved — so the tour index is walked until one comes up, the way changeover196
  // walks tours for the same reason. Not every fortnight re-rigs anybody, and it should not.
  let away = null, rows = [], atTour = 0, noChangeNote = '';
  for (let taken = 2; taken <= 24 && !rows.length; taken++) {
    st = await api('/export');
    st.status.gameTime = iso(20);
    st.driver.lastHomeGameTime = iso(2);     // 18 days out on a 14-day arrangement
    st.driver.homeTimesTaken = taken;
    st.driver.changeoverUnit = '';
    st.driver.changeoverReserve = false;
    S = un(await api('/import', 'POST', st));

    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    away = await api('/board/add', 'POST', {
      cargo: 'Machinery', originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: 'Phoenix', destState: 'AZ', loadedMiles: 600, deadheadMiles: 0,
      gameRevenue: 2400, deadlineHours: 72, weightLbs: 38000,
    });
    rows = away.askWhereabouts || [];
    console.log(`  ..    home time ${taken}: rejectAll=${away.rejectAll}, ${rows.length} row(s)`
      + `, note="${(away.changeoverNote || '').slice(0, 60)}"`);
    if (!rows.length && !noChangeNote) noChangeNote = away.changeoverNote || '';
    if (rows.length) atTour = taken;
  }
  console.log(`  ..    ${(away.headline || '').slice(0, 100)}`);
  console.log(`  ..    a change came up at home time ${atTour || '(never)'}`);
  ok('dispatch sends the driver home', away.rejectAll === true, `rejectAll=${away.rejectAll}`);

  // The other half of the spec, and it is the commoner outcome: told plainly that they are NOT swapping.
  // Whatever the reason — the roll said no change, or it wanted one and the yard had nothing to make it
  // with — the driver is told. A silence here is indistinguishable from the app having forgotten, and
  // they are running in expecting something to happen to their trailer.
  ok('a fortnight with no questions still says what is happening',
    noChangeNote.length > 0, noChangeNote.slice(0, 95) || '(silent)');
  ok('and says which of the three it is',
    /no trailer change this home time|nothing on the yard to do it with|drop and hook/i.test(noChangeNote),
    noChangeNote.slice(0, 85));

  ok('and when a change IS coming, the boxes are asked about then, not before', rows.length > 0,
    rows.map((x) => x.unit).join(', ') || '(nothing asked)');
  ok('every box on the yard is asked about', rows.length >= 3, `${rows.length} row(s)`);

  head('3. The determination waits for the answers');
  // The fix that matters as much as the timing. A verdict produced alongside the questions is a verdict
  // made without them, and it is the one the driver reads first.
  ok('no box is named while the questions are outstanding',
    !/still |you will be on |swapping onto/i.test(away.changeoverNote || ''),
    (away.changeoverNote || '(silent)').slice(0, 110));
  ok('it says the answer is coming once they reply',
    /fill the two in|tell you straight away/i.test(away.changeoverNote || ''),
    (away.changeoverNote || '').slice(0, 100));
  ok('and nothing is committed to the record yet', !(await api('/export')).driver.changeoverUnit,
    (await api('/export')).driver.changeoverUnit || '(none)');

  head('4. Answering settles it, and the answer is an answer');
  const told = await api('/fleetops/whereabouts/all', 'POST', {
    homeDays: 5,
    trailers: rows.map((r, i) => ({
      trailerUnit: r.unit, direction: i === 0 ? 'Parked' : 'Outbound',
      city: i === 0 ? yard.city : 'Salt Lake City', state: i === 0 ? yard.state : 'UT',
    })),
  });
  const dec = told.decision;
  console.log(`  ..    ${dec ? `${dec.swapping ? 'swapping to ' + dec.trailer : 'no change'} — ${(dec.note || '').slice(0, 80)}` : '(no decision)'}`);
  ok('a decision comes back', !!dec, dec ? 'decided' : '(none)');
  ok('it says plainly whether there is a swap', typeof dec?.swapping === 'boolean', `swapping=${dec?.swapping}`);
  ok('the days off are carried into it', dec?.homeDays === 5, `${dec?.homeDays} day(s)`);
  if (dec?.swapping) {
    ok('and names the box', !!dec.trailer && !!dec.unit, `${dec.trailer} (${dec.type})`);
    // Idle beats near, but what actually decides it is what the wait COSTS against the days being
    // taken. Mark a box private in ATS and whoever has it finishes their load and drops it — so a box
    // two days out is free to somebody home for five, and the wanted type wins on equal terms.
    ok('the wait, if any, lands inside the home time and so costs nothing',
      dec.idle === true || (dec.waitDays != null && dec.waitDays <= dec.homeDays),
      `idle=${dec.idle}, wait=${dec.waitDays}, home=${dec.homeDays}`);
    ok('and the driver is told to go and reserve it before pulling out', dec.reserve === true,
      `reserve=${dec.reserve}`);
    ok('the promise is on the record now', (await api('/export')).driver.changeoverUnit === dec.unit,
      (await api('/export')).driver.changeoverUnit);

    // And only NOW does the Home time panel carry it — word for word off what was settled, rather than
    // a second opinion worked out on the way to the screen.
    const after = (await api('/bootstrap')).views.homeTime;
    ok('the Home time panel now shows the change', !!after?.reassignmentNotice,
      (after?.reassignmentNotice || '(silent)').slice(0, 90));
    ok('and it is the words the driver was actually given',
      (after?.reassignmentNotice || '').startsWith(dec.note.slice(0, 40)),
      (after?.reassignmentNotice || '').slice(0, 70));
    ok('naming the box they are coming off as well',
      /you come off /i.test(after?.reassignmentNotice || ''),
      (after?.reassignmentNotice || '').slice(-60));
  }

  head('5. A load that finishes at the yard asks in the same place');
  // The other way home. Same moment, same questions — the run home is the run home.
  st = await api('/export');
  st.driver.changeoverUnit = '';
  st.driver.changeoverReserve = false;
  st.driver.homeTimesTaken = atTour;         // the tour that rolls a change, from section 2
  st.status.gameTime = iso(21);
  await api('/import', 'POST', st);
  await api('/board/clear', 'POST', {});
  const home = await api('/board/add', 'POST', {
    cargo: 'Machinery', originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: yard.city, destState: yard.state, loadedMiles: 420, deadheadMiles: 0,
    gameRevenue: 1900, deadlineHours: 60, weightLbs: 38000,
  });
  ok('the load home is authorized', !!home.authorizedLoadId, home.headline?.slice(0, 80));
  ok('and the trailer questions come with it', (home.askWhereabouts || []).length > 0,
    (home.askWhereabouts || []).map((x) => x.unit).join(', ') || '(nothing asked)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
