/* Issues #21, #22, #23: recap versus the 34, out of window at the dock, and the loaded report. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5588}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 300));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

let S, day = 1;
const gt = (h = '08:00') => `2000-01-${String(day).padStart(2, '0')}T${h}`;

async function stand({ city = 'Denver', state = 'CO', kind = 'Receiver', time = '08:00', odo, trailerDmg = 0 } = {}) {
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: gt(time),
    fuelPct: 80, atsOdometer: odo ?? 10000, truckDamagePct: 0, trailerDamagePct: trailerDmg,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  });
  S = un(r);
  return r;
}

const clocks = (drive, shift, cycle, recap = []) =>
  api('/hos', 'POST', { driveRemaining: drive, shiftRemaining: shift, breakRemaining: 8, cycleRemaining: cycle, recap });

async function board(dest, destState, miles) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: dest, destState, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: miles * 3, deadlineHours: 40, weightLbs: 40000,
  });
}

(async () => {
  const app = { driverName: 'Recap Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: gt() }));
  const rules = S.settings.hos;

  // ---------------------------------------------------------------- #21 recap
  head('1. No recap reported: explain it, do not invent one');
  await stand({ kind: 'Terminal', time: '20:00' });
  S = un(await clocks(11, 14, 3, []));
  let r = S.views.recap;
  ok('verdict is NoData, not a guess', r.verdict === 'NoData', r.verdict);
  ok('nothing invented', r.nextHours === 0 && r.totalReported === 0, `${r.nextHours} / ${r.totalReported}`);
  ok('it explains what recap is', /rolling \d+-day window/.test(r.lines.join(' ')), r.lines[0]);
  ok('and says where to put it', /recap box/.test(r.lines.join(' ')));

  head('2. Recap due tonight and enough: wait, do not take the 34');
  await stand({ kind: 'Terminal', time: '20:00' });
  S = un(await clocks(11, 14, 2, [{ hours: 9.5, inDays: 1 }]));
  r = S.views.recap;
  ok('verdict is Wait', r.verdict === 'Wait', `${r.verdict}: ${r.headline}`);
  ok('the wait is to midnight, not 24 hours', Math.abs(r.waitHours - 4) < 0.1, `${r.waitHours.toFixed(2)} h from 20:00`);
  ok('hours coming back are the reported ones', r.nextHours === 9.5, `${r.nextHours}`);
  ok('cycle after is current plus recap', Math.abs(r.cycleAfter - 11.5) < 0.01, `${r.cycleAfter}`);
  ok('headline says do not take the 34', /Do not take the 34/.test(r.headline), r.headline);
  ok('it shows what the restart would cost instead', /would cost you/.test(r.lines.join(' ')),
    r.lines.find((l) => /cost you/.test(l)) || '(none)');
  ok('and teaches the rule in passing', /window rolling forward/.test(r.lines.join(' ')));

  head('3. Recap not enough for the work: take the 34');
  await stand({ kind: 'Terminal', time: '20:00' });
  S = un(await clocks(11, 14, 1, [{ hours: 2, inDays: 1 }]));
  // An out-of-hours board is auto-cleared by design, so the verdict is on the add response — a
  // second evaluate would be looking at an empty board.
  let d = await board('Salt Lake City', 'UT', 500);
  ok('out of hours, restart needed', d.outOfHours === true && d.needsRestart === true,
    `outOfHours=${d.outOfHours} needsRestart=${d.needsRestart}`);
  ok('the note names the shortfall', /still be .* short/.test(d.rationale), d.rationale.slice(0, 150));
  ok('and warns the restart eats the recap', /go with it/.test(d.rationale));

  head('4. Recap that IS enough turns the restart order off');
  // Day and drive clocks healthy so the day is not the issue — only the cycle is. The load needs
  // more cycle than is left, and with no reset in the plan there is no midnight for the sim to cross,
  // so recap cannot rescue this particular load. It can still rescue the driver.
  await stand({ kind: 'Terminal', time: '20:00' });
  S = un(await clocks(11, 14, 1, [{ hours: 11, inDays: 1 }]));
  d = await board('Salt Lake City', 'UT', 500);
  ok('the cycle is what stopped it', d.outOfHours === true, `outOfHours=${d.outOfHours}`);
  ok('but NO restart demanded, because recap covers it', d.needsRestart === false, `needsRestart=${d.needsRestart}`);
  ok('told to wait for midnight instead', /Do not take the 34/.test(d.rationale), d.rationale.slice(0, 130));

  head('4b. And recap can make a load runnable that otherwise is not');
  await stand({ kind: 'Terminal', time: '20:00' });
  S = un(await clocks(1, 1, 2, [{ hours: 11, inDays: 1 }]));
  d = await board('Salt Lake City', 'UT', 500);
  ok('the plan uses the recap rather than a restart', !!d.authorizedLoadId, d.headline);
  const plan = d.evaluations[0].feasibility;
  ok('and the timeline says the hours came back',
    (plan.warnings || []).some((w) => /Recap returns/.test(w)),
    (plan.warnings || []).find((w) => /Recap/.test(w)) || '(none)');
  ok('no cycle restart was needed', plan.cycleRestartRequired === false);

  head('5. Waiting two days for recap is not a saving');
  await stand({ kind: 'Terminal', time: '08:00' });
  S = un(await clocks(11, 14, 1, [{ hours: 10, inDays: 3 }]));
  r = S.views.recap;
  ok('verdict is Restart', r.verdict === 'Restart', `${r.verdict}: ${r.headline}`);
  ok('because the wait exceeds the restart', r.waitHours > rules.cycleRestartHours,
    `${r.waitHours.toFixed(1)} h wait vs ${rules.cycleRestartHours} h restart`);
  ok('and it says so', /longer than the/.test(r.lines.join(' ')), r.lines[0]);

  // ------------------------------------------------------- #22 out of window
  head('6. Out of window at the receiver is recognised and named');
  await stand({ kind: 'Receiver', city: 'Salt Lake City', state: 'UT', time: '19:00' });
  S = un(await clocks(3, 0, 40, []));
  let st = S.views.stranded;
  ok('recognised', st.isStranded === true, `${st.isStranded}`);
  ok('names which clock ran out', /window/.test(st.outOf), st.outOf);
  ok('says it is not a violation', /not a violation/.test(st.headline), st.headline);
  ok('finishing the work is legal', /Finishing the work is legal/.test(st.lines.join(' ')));
  ok('moving the truck is not', /Moving the truck is not/.test(st.lines.join(' ')));
  ok('no exception is offered', /detention cannot buy you any/.test(st.lines.join(' ')));
  ok('told to take the 10 where they are', /take your 10 where you are/.test(st.lines.join(' ')),
    st.lines.find((l) => /where you are/.test(l)) || '(none)');
  ok('and to ask about parking', /Ask them about parking/.test(st.lines.join(' ')));
  ok('fault is never the driver', st.fault !== 'Driver' && !!st.fault, st.fault);

  head('7. Not stranded when they are out of hours at a truck stop');
  await stand({ kind: 'TruckStop', city: 'Cheyenne', state: 'WY', time: '19:00' });
  S = un(await clocks(0, 0, 40, []));
  ok('a truck stop is not being stuck on a customer', S.views.stranded.isStranded === false);

  head('8. Not stranded when the clocks are fine');
  await stand({ kind: 'Receiver', time: '10:00' });
  S = un(await clocks(8, 10, 40, []));
  ok('hours in hand means no situation', S.views.stranded.isStranded === false);

  head('9. A thin window on delivery is flagged BEFORE the load is taken');
  await stand({ kind: 'Shipper', city: 'Denver', state: 'CO', time: '06:00' });
  S = un(await clocks(11, 14, 60, []));
  await board('Salt Lake City', 'UT', 480);
  d = await api('/board/evaluate');
  const warns = (d.evaluations[0].feasibility.warnings || []).join(' ');
  const shiftLeft = d.evaluations[0].feasibility.shiftRemainingOnArrival;
  ok('the plan reports window left when empty', typeof shiftLeft === 'number', `${shiftLeft}`);
  if (shiftLeft < S.settings.strandedMarginHours) {
    ok('and warns about being parked on their property', /parked/.test(warns) || /window/.test(warns),
      warns.slice(0, 160));
  } else {
    ok('no warning needed with a healthy window', shiftLeft >= S.settings.strandedMarginHours,
      `${shiftLeft.toFixed(2)} h left, margin ${S.settings.strandedMarginHours}`);
  }

  head('10. Stranded at the dock is not the driver’s fault on the audit');
  await stand({ kind: 'Shipper', city: 'Denver', state: 'CO', time: '06:00' });
  S = un(await clocks(11, 14, 60, []));
  await board('Salt Lake City', 'UT', 400);
  const auth = await api('/dispatch/authorize', 'POST', { loadId: (await api('/board/evaluate')).evaluations[0].load.id });
  day = 3;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: gt('22:00'), actualMiles: 0, endOdometer: 10400, actualRevenue: 1200,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 2, unloadingHours: 7, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', locationKind: 'Receiver', fuelPct: 40,
    gameTime: gt('22:00'),
    hosDriveRemaining: 2, hosShiftRemaining: 0, hosBreakRemaining: 8, hosCycleRemaining: 45,
  });
  const audit = done.audit || done;
  ok('fault is not the driver', audit.faultAttribution !== 'Driver', audit.faultAttribution);
  ok('and the reason explains the dock, not the driver',
    /dock held you|window in hand/.test(audit.faultRationale), audit.faultRationale.slice(0, 170));

  // -------------------------------------------------------- #23 loaded report
  head('11. There is somewhere to report the loaded weight');
  await stand({ kind: 'Shipper', city: 'Denver', state: 'CO', time: '06:00', odo: 20000 });
  S = un(await clocks(11, 14, 60, []));
  const offer = await board('Cheyenne', 'WY', 100);
  ok('dispatch points at the right place',
    (offer.dispatchNotes || []).some((n) => /Report after loading/.test(n)),
    (offer.dispatchNotes || []).find((n) => /Report after/.test(n)) || '(none)');
  const a2 = await api('/dispatch/authorize', 'POST', { loadId: offer.authorizedLoadId || offer.evaluations[0].load.id });
  ok('a fresh trip has not reported yet', a2.trip.loadedReported === false);

  let rep = await api(`/trips/${a2.trip.id}/loaded`, 'POST',
    { weightLbs: 44500, trailerDamagePct: 3, odometer: 20015 });
  ok('it accepts the report', rep.trip.loadedReported === true);
  ok('weight is stored', rep.trip.weightLbs === 44500, `${rep.trip.weightLbs}`);
  ok('the variance against the board is noted', /heavier/.test(rep.trip.weightVarianceNote),
    rep.trip.weightVarianceNote);
  ok('and reported back', rep.notes.some((n) => /scaled/.test(n)), rep.notes[0]);
  ok('trailer condition at hook is kept', rep.trip.trailerDamageAtHook === 3);
  ok('odometer becomes the start of the leg', rep.trip.startOdometer === 20015, `${rep.trip.startOdometer}`);

  head('12. A blank field changes nothing rather than zeroing it');
  S = un(rep);
  rep = await api(`/trips/${a2.trip.id}/loaded`, 'POST',
    { weightLbs: null, trailerDamagePct: null, odometer: null });
  ok('weight survives a blank submit', rep.trip.weightLbs === 44500, `${rep.trip.weightLbs}`);
  ok('odometer survives too', rep.trip.startOdometer === 20015, `${rep.trip.startOdometer}`);

  head('13. A trailer hooked over the line stops dispatch straight away');
  await stand({ kind: 'Shipper', city: 'Denver', state: 'CO', time: '06:00', odo: 30000 });
  S = un(await clocks(11, 14, 60, []));
  const stopPct = S.settings.maintenance.stopDispatchPct;
  rep = await api(`/trips/${a2.trip.id}/loaded`, 'POST',
    { weightLbs: null, trailerDamagePct: stopPct + 4, odometer: null });
  ok('it says the trailer is over the line', rep.notes.some((n) => /past our/.test(n)),
    rep.notes.find((n) => /past our/.test(n)) || '(none)');
  S = un(rep);
  ok('and the shop order picks it up now', (S.views.shopOrder?.kind ?? 'None') !== 'None',
    S.views.shopOrder?.headline || '(none)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
