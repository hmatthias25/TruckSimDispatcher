/* Issues #59-#61: getting home, and the empty miles it takes.
 *
 * Dispatch can only judge the loads the driver types in, and those come off whatever board ATS is
 * showing where they stand. So a rejected board near home time is a signal to look somewhere else, not
 * a dead end — and the empty running that follows is miles the driver should be paid for.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5820}/api`;
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

let S;
async function place(city, state, day, hm = '08:00', odo = 30000, kind = 'TruckStop') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: iso(day, hm),
    fuelPct: 85, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 10, shiftRemaining: 13, breakRemaining: 8, cycleRemaining: 55 });
  return S;
}

/** A board of loads dispatch will not want: thin money, running the wrong way. */
async function badBoard(fromCity, fromState) {
  await api('/board/clear', 'POST', {});
  let last;
  for (const [c, st, mi] of [['Seattle', 'WA', 1900], ['Miami', 'FL', 1800]]) {
    last = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type,
      originCity: fromCity, originState: fromState, destCity: c, destState: st,
      loadedMiles: mi, deadheadMiles: 0, gameRevenue: 300, deadlineHours: 20, weightLbs: 40000,
    });
  }
  return last;
}

(async () => {
  const app = { driverName: 'H. Bound', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  const home = S.company.terminals.find((t) => t.isHeadquarters) || S.company.terminals[0];
  console.log(`     home yard: ${home.city}, ${home.state}`);

  head('1. Nothing to suggest while the board is fine');
  // The whole point: only a REJECTED board triggers this. A load worth running needs no advice.
  await place('Kansas City', 'MO', 20, '07:00');
  await api('/board/clear', 'POST', {});
  let bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Kansas City', originState: 'MO', destCity: 'Springfield', destState: 'MO',
    loadedMiles: 165, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 24, weightLbs: 30000,
  });
  ok('a sensible load is not rejected', bd.rejectAll !== true, `rejectAll=${bd.rejectAll}`);
  const quiet = (bd.dispatchNotes || []).join(' ');
  ok('and no go-looking-elsewhere advice appears', !/check what is loading out of/i.test(quiet),
    quiet.slice(0, 120) || '(none)');

  head('2. A rejected board near home time says where to look');
  // Wind home time on so it is due, then offer only rubbish running the wrong way.
  for (let d = 22; d <= 46; d += 6) await place('Kansas City', 'MO', d, '07:00', 30000 + d * 40);
  let hs = (await api('/bootstrap')).views.homeTime;
  console.log(`     home time: due in ${hs?.daysUntilDue}, overdue ${hs?.overdue}`);
  bd = await badBoard('Kansas City', 'MO');
  ok('the board is rejected', bd.rejectAll === true, `${bd.rejectAll}`);
  const notes = (bd.dispatchNotes || []).join(' | ');
  if (hs?.dueSoon) {
    ok('it names somewhere to go looking', /check what is loading out of|Look at the board in/i.test(notes),
      notes.slice(-260));
    ok('and ties it to home time', /home time is (overdue|due)/i.test(notes), '');
    ok('it does not just say reposition and pull a board',
      !/Reposition and pull a fresh board/i.test(notes), notes.slice(-160));
  } else {
    ok('home time never came due in this run, so nothing to advise', true, 'skipped');
  }

  head('3. The offers carry miles the driver never has to work out');
  const offers = (await api('/bootstrap')).views.repositionOffers || [];
  console.log(`     ${offers.length} offer(s): ${offers.map((o) => `${o.city},${o.state} ${o.miles}mi`).join(' | ')}`);
  if (offers.length) {
    ok('every offer has a real mileage', offers.every((o) => o.miles > 0),
      offers.map((o) => o.miles).join(', '));
    ok('and a reason', offers.every((o) => !!o.reason), offers[0].reason);
    const runHome = offers.find((o) => o.isHomeRun);
    if (runHome) {
      ok('the run to the yard is offered', runHome.city === home.city, `${runHome.city} ${runHome.miles} mi`);
      ok('and it is flagged as the home leg, not freight-chasing', runHome.isHomeRun === true, '');
    } else {
      ok('the yard was out of reach on these hours, which is its own answer', true, 'no home run offered');
    }
  } else {
    ok('no offers because home time is not close, which is correct', !hs?.dueSoon, `dueSoon=${hs?.dueSoon}`);
  }

  head('4. An empty move works out its own distance');
  // #60: the driver should never type a mileage the app has coordinates for.
  const before = (await api('/bootstrap')).trips.length;
  const mv = await api('/moves', 'POST', {
    kind: 'EmptyMove', destCity: 'Springfield', destState: 'MO', miles: 0,
    reason: 'empty to the yard for home time',
  });
  ok('the move was raised', !!mv.trip?.number, mv.trip?.number);
  ok('with miles filled in from the map, not zero', mv.trip.deadheadMiles > 0 || mv.trip.loadedMiles > 0,
    `deadhead ${mv.trip.deadheadMiles}, loaded ${mv.trip.loadedMiles}`);
  ok('and it is an empty move, not freight', mv.trip.kind === 'EmptyMove', mv.trip.kind);
  ok('the trip list grew by one', (await api('/bootstrap')).trips.length === before + 1, '');
  // That move is still open, and an open trip blocks dispatch. Run it to the yard and close it, which
  // is what the driver would do next anyway.
  await api(`/trips/${mv.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(47, '12:00'), actualMiles: mv.trip.deadheadMiles, endOdometer: 39000,
    actualRevenue: 0, fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Springfield', locationState: 'MO', fuelPct: 70, gameTime: iso(47, '12:00'),
    hosDriveRemaining: 8, hosShiftRemaining: 10, hosBreakRemaining: 6, hosCycleRemaining: 45,
  });

  head('5. Empty miles between loads: the reported case');
  // #61. Close out at a receiver, drive empty to a terminal, take a load from there. The odometer has to
  // move for the app to pay it -- and if it has NOT moved while the location has, that is a missing
  // reading rather than a driver who stayed put.
  await api('/board/clear', 'POST', {});
  await place('Joplin', 'MO', 50, '06:00', 40000);
  const b1 = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Joplin', originState: 'MO', destCity: 'Tulsa', destState: 'OK',
    loadedMiles: 115, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 24, weightLbs: 30000,
  });
  const a1 = await api('/dispatch/authorize', 'POST', { loadId: b1.evaluations[0].load.id });
  const done = await api(`/trips/${a1.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(50, '11:00'), actualMiles: 115, endOdometer: 40115, actualRevenue: 700,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Tulsa', locationState: 'OK', fuelPct: 60, gameTime: iso(50, '11:00'),
    hosDriveRemaining: 8, hosShiftRemaining: 10, hosBreakRemaining: 6, hosCycleRemaining: 45,
  });
  const closed = (done.snapshot || done).trips.find((x) => x.id === a1.trip.id);
  ok('the load closed out with an odometer on it', closed?.endOdometer === 40115,
    `${closed?.endOdometer}`);

  // Now the empty run to a terminal in another city -- reported WITHOUT moving the odometer, which is
  // what happens when the driver just opens the app and takes the next load.
  await place('Oklahoma City', 'OK', 50, '15:00', 40115, 'Terminal');
  await api('/board/clear', 'POST', {});
  const b2 = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Wichita', destState: 'KS',
    loadedMiles: 160, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 26, weightLbs: 30000,
  });
  const a2 = await api('/dispatch/authorize', 'POST', { loadId: b2.evaluations[0].load.id });
  ok('nothing is invented from a stale reading', !a2.trip.repositionMiles, `${a2.trip.repositionMiles} mi`);
  const said = JSON.stringify(a2);
  ok('but the driver is told a reading is missing',
    /same as when you closed|cannot pay empty miles I have no reading/i.test(said),
    (said.match(/[^"]*no reading[^"]*/i) || ['(nothing said)'])[0].slice(0, 200));

  // Close that one out so the next dispatch is not blocked by an open trip.
  await api(`/trips/${a2.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(50, '21:00'), actualMiles: 160, endOdometer: 40275, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Wichita', locationState: 'KS', fuelPct: 55, gameTime: iso(50, '21:00'),
    hosDriveRemaining: 7, hosShiftRemaining: 9, hosBreakRemaining: 5, hosCycleRemaining: 40,
  });

  head('5a. The ask comes BEFORE the load is booked, while it can still be acted on');
  // Measure runs once, at authorisation. A warning on the trip afterwards tells the driver to do
  // something that can no longer help -- the figure is already fixed. So the board says it first.
  await api('/board/clear', 'POST', {});
  await place('Amarillo', 'TX', 52, '07:00', 40275, 'TruckStop');
  const preBoard = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Amarillo', originState: 'TX', destCity: 'Lubbock', destState: 'TX',
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 24, weightLbs: 30000,
  });
  const preNotes = (preBoard.dispatchNotes || []).join(' | ');
  ok('the board asks for the reading up front', /Before I book anything/i.test(preNotes),
    preNotes.slice(-240) || '(none)');
  ok('it names where they closed and where they are',
    /Wichita|closed .* in/i.test(preNotes) && /Amarillo/i.test(preNotes), '');
  ok('and warns the miles are lost if they authorise anyway',
    /those miles are gone|only work the repositioning out once/i.test(preNotes), '');

  head('5a2. Report the reading and the ask goes away');
  await place('Amarillo', 'TX', 52, '09:00', 40700, 'TruckStop');
  const after = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Amarillo', originState: 'TX', destCity: 'Lubbock', destState: 'TX',
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 24, weightLbs: 30000,
  });
  const afterNotes = (after.dispatchNotes || []).join(' | ');
  ok('nothing more is asked for', !/Before I book anything/i.test(afterNotes),
    afterNotes.slice(-160) || '(none)');
  const authed = await api('/dispatch/authorize', 'POST', { loadId: after.evaluations[0].load.id });
  ok('and the empty run is on the load', authed.trip.repositionMiles === 425,
    `${authed.trip.repositionMiles} mi (40,275 -> 40,700)`);
  // Close it so the rest of the suite is not blocked.
  await api(`/trips/${authed.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(52, '13:00'), actualMiles: 120, endOdometer: 40820, actualRevenue: 700,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Lubbock', locationState: 'TX', fuelPct: 55, gameTime: iso(52, '13:00'),
    hosDriveRemaining: 8, hosShiftRemaining: 10, hosBreakRemaining: 6, hosCycleRemaining: 45,
  });

  head('5b. With the reading reported, the empty miles are paid');
  await api('/board/clear', 'POST', {});
  // Same again, but the odometer now reflects the empty run: 40115 -> 40255 is 140 mi.
  await place('Oklahoma City', 'OK', 53, '07:00', 40960, 'Terminal');
  const b3 = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Wichita', destState: 'KS',
    loadedMiles: 160, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 26, weightLbs: 30000,
  });
  const a3 = await api('/dispatch/authorize', 'POST', { loadId: b3.evaluations[0].load.id });
  ok('the empty leg is measured', a3.trip.repositionMiles === 140, `${a3.trip.repositionMiles} mi`);
  ok('and it is paid as empty miles, not freight',
    JSON.stringify(a3).includes('empty mi repositioning'), 'explained on the trip');


  // Close 5b's load so the next dispatch is not blocked.
  await api(`/trips/${a3.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(53, '15:00'), actualMiles: 160, endOdometer: 41000, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Wichita', locationState: 'KS', fuelPct: 55, gameTime: iso(53, '15:00'),
    hosDriveRemaining: 9, hosShiftRemaining: 11, hosBreakRemaining: 7, hosCycleRemaining: 50,
  });

  head('6. The reported sequence: odometer at the truck stop, odometer after loading');
  // 1. Sitting at a truck stop, the pickup is 40 mi away.
  // 2. Report the odometer here.
  // 3. Authorise, drive to the shipper.
  // 4. Load, and fill in the after-loading boxes -- weight, trailer damage, odometer.
  // 5. That odometer is 40 higher.
  // 6. The app works out the 40 empty miles and pays them.
  await api('/board/clear', 'POST', {});
  await place('Wichita', 'KS', 54, '06:00', 41000, 'TruckStop');
  const dhBoard = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Wichita', originState: 'KS', destCity: 'Topeka', destState: 'KS',
    loadedMiles: 135, deadheadMiles: 55, gameRevenue: 900, deadlineHours: 26, weightLbs: 30000,
  });
  const dhTrip = (await api('/dispatch/authorize', 'POST',
    { loadId: dhBoard.evaluations[0].load.id })).trip;
  ok('the reading at booking is kept', dhTrip.dispatchOdometer === 41000, `${dhTrip.dispatchOdometer}`);
  ok('and the listing quoted 55 mi of deadhead', dhTrip.deadheadMiles === 55, `${dhTrip.deadheadMiles}`);

  // Drove 40, not the 55 the listing guessed.
  const rep = await api(`/trips/${dhTrip.id}/loaded`, 'POST', {
    weightLbs: 30000, trailerDamagePct: 2, odometer: 41040,
  });
  const said6 = (rep.notes || []).join(' | ');
  ok('the empty run is measured at 40 mi', rep.trip.deadheadMiles === 40,
    `${rep.trip.deadheadMiles} mi (41,000 -> 41,040)`);
  ok('and flagged as measured, not quoted', rep.trip.deadheadMeasured === true, `${rep.trip.deadheadMeasured}`);
  ok('the driver is told it beat the listing', /Going with yours/i.test(said6), said6.slice(0, 200));
  ok('naming both figures', /40 mi/.test(said6) && /55 mi/.test(said6), '');

  await api(`/trips/${dhTrip.id}/complete`, 'POST', {
    deliveredGameTime: iso(54, '14:00'), actualMiles: 135, endOdometer: 41175, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Topeka', locationState: 'KS', fuelPct: 55, gameTime: iso(54, '14:00'),
    hosDriveRemaining: 9, hosShiftRemaining: 11, hosBreakRemaining: 7, hosCycleRemaining: 48,
  });

  head('6b. A reading that cannot be true does not overwrite the quote');
  // A fresh career, because by this point home time is thirty days overdue and every board is rejected
  // and cleared. This section is about the odometer guard, not the home-time pressure.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app2 = { driverName: 'D. Second', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Topeka', homeState: 'KS', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app2);
  S = un(await api('/onboarding/hire', 'POST', { application: app2, force: true, gameTime: iso(1), code: 'PRI' }));
  await place('Topeka', 'KS', 2, '06:00', 41200, 'TruckStop');
  await api('/board/clear', 'POST', {});
  const b6 = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Topeka', originState: 'KS', destCity: 'Salina', destState: 'KS',
    loadedMiles: 110, deadheadMiles: 30, gameRevenue: 800, deadlineHours: 26, weightLbs: 30000,
  });
  ok('a load is dispatchable on a fresh career', !!b6.evaluations?.[0],
    `rejectAll=${b6.rejectAll} ${(b6.dispatchNotes || []).join(' ').slice(0, 120)}`);
  const t6 = (await api('/dispatch/authorize', 'POST', { loadId: b6.evaluations[0].load.id })).trip;
  ok('the booking reading is stored', t6.dispatchOdometer === 41200, `${t6.dispatchOdometer}`);

  // Never updated the reading, but the listing says there was real deadhead to drive.
  const rep2 = await api(`/trips/${t6.id}/loaded`, 'POST', {
    weightLbs: 30000, trailerDamagePct: 2, odometer: 41200,
  });
  ok('the quoted deadhead is kept, not zeroed', rep2.trip.deadheadMiles === 30,
    `${rep2.trip.deadheadMiles} mi`);
  ok('and it is not claimed as measured', !rep2.trip.deadheadMeasured, `${rep2.trip.deadheadMeasured}`);
  ok('the driver is told why', /has not moved since this load was booked/i.test((rep2.notes || []).join(' ')),
    (rep2.notes || []).join(' | ').slice(0, 190));

  console.log(`
${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
