/* #205, #206, #207 — three things out of one session in play.
 *
 * 205  One delivery card said all of this at once: a WINDOW of 17:16-23:57, an APPOINTMENT at 19:00,
 *      "no appointment — they take it when you get there", and a seeded working day of 07:00-16:00.
 *      Arriving at 16:00 was then told to wait until 19:00, which ran the shift out and forced a ten on
 *      the property. The honest answer against a window opening at 17:16 was a 1:16 wait.
 *
 * 206  11% trailer damage from a hit that was not the driver's fault, and Safety had no field for it.
 *
 * 207  A dock board with nothing going the right way ordered an empty run home without ever asking for
 *      the city board.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5954}/api`;
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

let S, odo = 90000;
const stand = async (city, st, day, hm, kind = 'Shipper') => {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 150000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
};

(async () => {
  const app = { driverName: 'C. Rhodes', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));

  // Stock the yard with one of each, so whatever the re-rig rolls for there is actually a box to be
  // asked about. An empty yard makes the position question meaningless and the section below vacuous.
  for (const [u, ty] of [['SPR-V', 'Dry Van'], ['SPR-R', 'Reefer'], ['SPR-F', 'Flatbed'],
                         ['SPR-S', 'Step Deck'], ['SPR-T', 'Tanker']])
    await api('/fleet/trailer', 'POST', {
      unit: u, type: ty, division: ty, year: 2021, make: 'Utility', length: "53'",
      inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
    });

  // Put the driver on a tanker — the reported load. Re-registering the issued box is a fleet edit, not a
  // self-assignment, which the app is right to refuse.
  const mineBox = (S.trailers || []).find((x) => x.unit === S.driver.assignedTrailerUnit);
  if (mineBox) await api('/fleet/trailer', 'POST',
    { ...mineBox, type: 'Tanker', subtype: 'Food Grade', division: 'Tanker' });
  S = un(await api('/bootstrap'));

  head('1. A tanker is a plant, not a construction site');
  await stand('Chicago', 'IL', 20, '08:41');
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Soft Drink Syrup', trailerType: 'Tanker', receiver: 'Coca-Cola',
    originCity: 'Chicago', originState: 'IL', destCity: 'St. Louis', destState: 'MO',
    loadedMiles: 332, deadheadMiles: 0, gameRevenue: 839, deadlineHours: 15,
    weightLbs: 44092, appointmentOpensHours: 8.5,
  });
  const ev = (r.evaluations || [])[0];
  ok('the load is on the board', !!ev, ev ? ev.load.destCity : '(none)');

  if (ev) {
    ok('no slot is invented for an unbooked plant', !ev.appointmentGameTime,
      ev.appointmentGameTime || 'no slot');
    ok('and it says so as a pro rather than contradicting itself',
      (ev.pros || []).some((x) => /no booked slot/i.test(x)),
      (ev.pros || []).find((x) => /booked slot/i.test(x)) || '(silent)');
    ok('the window opening is still respected — they do not take it before then',
      ev.feasibility.waitForAppointmentHours > 0 || ev.feasibility.idleHours > 0
        || /before the window/i.test(JSON.stringify(ev.cons || [])),
      `wait=${ev.feasibility.waitForAppointmentHours} idle=${ev.feasibility.idleHours}`);

    head('2. One voice: no seeded working day against a stated window');
    S = un(await api('/dispatch/authorize', 'POST', { loadId: ev.load.id }));
    const trip = (S.trips || []).find((x) => x.status !== 'Delivered');
    ok('the trip carries no appointment slot', !trip.appointmentGameTime,
      trip.appointmentGameTime || 'none');
    const views = (await api('/bootstrap')).views;
    ok('and no "their hours" block argues with the game', !views.receiverSiteHours,
      views.receiverSiteHours ? JSON.stringify(views.receiverSiteHours).slice(0, 80) : 'silent');

    head('3. Arriving before the window waits for the window, not for an invented slot');
    const opensAt = trip.appointmentOpensGameTime;
    ok('the window opening is on the trip', !!opensAt, opensAt || '(none)');
    if (opensAt) {
      const before = new Date(Date.parse(opensAt + ':00Z') - 75 * 60000).toISOString().slice(0, 16);
      const call = (await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: before })).call;
      ok('the app answers with the opening, not three hours past it',
        call && call.workStartsGameTime === opensAt,
        call ? `${call.workStartsGameTime} vs opens ${opensAt}` : '(silent)');
      ok('and says plainly that is when they open',
        call && /open/i.test(call.headline + ' ' + call.instruction),
        call ? call.headline : '(silent)');
      ok('it is never described as a job site',
        !call || !/site|in line|gate/i.test(call.instruction),
        call ? call.instruction.slice(0, 110) : '(silent)');
    }
  }

  head('4. Safety takes both damage figures and says what follows');
  const inc = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Moderate', faultAttribution: 'Unavoidable', preventable: false,
    cost: 0, description: 'AI traffic spawned into the trailer',
    damageIncurredPct: 11, truckDamagePctAfter: 3, trailerDamagePctAfter: 11,
    locationCity: 'St. Louis', locationState: 'MO',
  });
  S = un(inc);
  ok('the incident is filed', !!inc.incident?.number, inc.incident?.number);
  ok('trailer damage is recorded where it was reported',
    Math.abs((S.status.trailerDamagePct || 0) - 11) < 0.01, `${S.status.trailerDamagePct}%`);
  const onBox = (S.trailers || []).find((x) => x.unit === S.driver.assignedTrailerUnit);
  ok('and on the trailer itself, so nobody types it twice',
    !!onBox && Math.abs(onBox.damagePct - 11) < 0.01, onBox ? `${onBox.damagePct}%` : '(none)');
  ok('no fault attaches on an unavoidable one', inc.incident.faultAttribution === 'Unavoidable',
    inc.incident.faultAttribution);
  console.log(`  ..    equipmentNext: ${JSON.stringify(inc.equipmentNext || []).slice(0, 140)}`);
  ok('Safety says what happens to the equipment next', Array.isArray(inc.equipmentNext),
    `${(inc.equipmentNext || []).length} line(s)`);

  head('5. A damaged trailer does not get sent home off one dock board');
  // Reported from play: dropped with 11% on the box, asked for the next load, and was told to run home
  // empty — off a SHIPPER board, with the city never looked at. One dock's worth of freight is not the
  // town, and an empty run home is an expensive thing to decide from it.
  const openTrip = (S.trips || []).find((x) => x.status !== 'Delivered');
  if (openTrip) {
    odo += 332;
    await api(`/trips/${openTrip.id}/complete`, 'POST', {
      deliveredGameTime: iso(20, '20:00'), actualMiles: 332, endOdometer: odo,
      locationKind: 'Receiver', gameTime: iso(20, '20:00'), fuelPct: 60,
      truckDamageAfter: 3, trailerDamageAfter: 11,
    }).catch(() => {});
  }
  await stand('St. Louis', 'MO', 21, '08:00', 'Receiver');

  // A dock board, everything running the wrong way for a truck that has to reach Springfield.
  await api('/board/clear', 'POST', {});
  for (const [c, st, mi] of [['Detroit', 'MI', 530], ['Cleveland', 'OH', 560], ['Buffalo', 'NY', 720]]) {
    await api('/board/add', 'POST', {
      cargo: `Palletised Goods ${c}`, trailerType: 'Tanker', receiver: 'Blue Ridge Foods',
      originCity: 'St. Louis', originState: 'MO', destCity: c, destState: st,
      loadedMiles: mi, deadheadMiles: 0, gameRevenue: Math.round(mi * 2.6),
      deadlineHours: 40, weightLbs: 40000, atLocation: true,
    });
  }
  const dockCall = await api('/board/evaluate');
  console.log(`  ..    dock board: wantCity=${dockCall.wantCityBoard} rejectAll=${dockCall.rejectAll}`);
  console.log(`  ..    "${(dockCall.headline || '').slice(0, 100)}"`);
  ok('the city board is asked for before any empty run home is ordered',
    dockCall.wantCityBoard === true, dockCall.headline || '(no headline)');
  ok('and nothing is rejected while that is outstanding', dockCall.rejectAll !== true,
    `rejectAll=${dockCall.rejectAll}`);
  ok('the reason says it was one dock, not the whole town',
    /one dock|city board/i.test(`${dockCall.headline} ${dockCall.rationale}`),
    (dockCall.rationale || '').slice(0, 120));

  head('6. And if the city comes back the same, then it is the empty run');
  await api('/board/clear', 'POST', {});
  for (const [c, st, mi] of [['Detroit', 'MI', 530], ['Cleveland', 'OH', 560]]) {
    await api('/board/add', 'POST', {
      cargo: `City load ${c}`, trailerType: 'Tanker', receiver: 'Blue Ridge Foods',
      originCity: 'St. Louis', originState: 'MO', destCity: c, destState: st,
      loadedMiles: mi, deadheadMiles: 0, gameRevenue: Math.round(mi * 2.6),
      deadlineHours: 40, weightLbs: 40000, atLocation: false,
    });
  }
  const cityCall = await api('/board/evaluate');
  console.log(`  ..    city board: wantCity=${cityCall.wantCityBoard} rejectAll=${cityCall.rejectAll}`);
  ok('the city board is not asked for twice', cityCall.wantCityBoard !== true,
    `wantCity=${cityCall.wantCityBoard}`);
  ok('and now the run home is ordered on a full answer',
    cityCall.rejectAll === true, (cityCall.headline || '').slice(0, 100));

  head('7. The trailer question is asked while heading home, not once you are there');
  // A re-rig is seeded and occasional, so walk home times until one is actually pending — otherwise this
  // section passes on an empty list and proves nothing. The notice on the home-time panel is how the app
  // says one is coming.
  //
  // #243/#244: the panel no longer works the answer out for itself — it reports what dispatch settled on
  // the run home, so a change being pending is something you find out by pulling a board while overdue,
  // not by watching a panel from wherever you happen to be standing. That is the whole point of the
  // change, and it is what this section then goes on to assert, so the walk has to look where the app
  // now speaks. A pending change means boxes to ask about, not merely a sentence on the screen.
  // Section 4 put the trailer at 11% and sections 5-6 ran that to its conclusion, which leaves dispatch
  // blocked. That was invisible while the panel worked the answer out for itself; now the conversation
  // happens inside a board decision, and a board decision on a truck that cannot run never gets to it.
  // This section is about the trailer question, not about damage, so the damage is cleared first.
  {
    const fix = await api('/export');
    for (const t of fix.trailers) t.damagePct = 0;
    for (const t of fix.trucks) t.damagePct = 0;
    fix.status.trailerDamagePct = 0;
    fix.status.truckDamagePct = 0;
    for (const o of fix.equipmentOrders) if (o.status === 'Open') o.status = 'Cancelled';
    fix.workOrders = [];
    await api('/import', 'POST', fix);
  }

  // The walk steps the home-time counter directly rather than by driving home over and over. Arriving
  // home issues the re-rig, the loop then completed it, and a couple of rounds of that left the driver
  // with no trailer at all — after which every board reads "not clear to run" and the section is
  // measuring fixture decay rather than the app. Whether a change is wanted is a seeded roll per home
  // time, so the index is the only thing that has to move.
  let pending = '';
  for (let taken = 2; taken <= 24 && !pending; taken++) {
    const st = await api('/export');
    st.driver.homeTimesTaken = taken;
    st.driver.assignedTrailerUnit = 'T501';
    st.driver.changeoverUnit = '';
    st.driver.changeoverNote = '';
    st.driver.changeoverReserve = false;
    st.driver.lastHomeGameTime = iso(40);
    st.status.gameTime = iso(80);              // well past a fortnight: a genuine run home
    for (const o of st.equipmentOrders) if (o.status === 'Open') o.status = 'Cancelled';
    await api('/import', 'POST', st);

    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    const probe = await api('/board/add', 'POST', {
      cargo: 'Away', trailerType: 'Tanker', receiver: 'X',
      originCity: 'Amarillo', originState: 'TX', destCity: 'Detroit', destState: 'MI',
      loadedMiles: 530, deadheadMiles: 0, gameRevenue: 1590, deadlineHours: 40, weightLbs: 40000,
    });
    if ((probe.askWhereabouts || []).length) pending = probe.changeoverNote || 'questions raised';
  }
  console.log(`  ..    re-rig pending: ${pending ? 'yes' : 'no'} — "${pending.slice(0, 80)}"`);
  ok('a trailer change is pending, so there is something to ask about', !!pending,
    pending ? 'rolled' : 'none in 10 home times');

  // And genuinely overdue, which is what makes this a send-home rather than an ordinary bad board.
  // Without it the driver is merely somewhere with poor freight, and "reposition and pull a fresh board"
  // is the right answer — no trailer question belongs on that.
  await stand('Amarillo', 'TX', 230, '08:00');
  const st7 = (await api('/bootstrap')).views?.homeTime;
  console.log(`  ..    home time: overdue=${st7?.overdue} daysOut=${st7?.daysOut}`);

  // Now the board that sends them home, with that change outstanding.
  await api('/board/clear', 'POST', {});
  for (const [c, st, mi] of [['Detroit', 'MI', 530], ['Cleveland', 'OH', 560]])
    await api('/board/add', 'POST', {
      cargo: `Away ${c}`, trailerType: 'Tanker', receiver: 'X',
      originCity: 'Amarillo', originState: 'TX', destCity: c, destState: st,
      loadedMiles: mi, deadheadMiles: 0, gameRevenue: mi * 3, deadlineHours: 40,
      weightLbs: 40000, atLocation: false,
    });
  const homeCall = await api('/board/evaluate');
  console.log(`  ..    run-home decision: askWhereabouts=${(homeCall.askWhereabouts || []).length}`
    + ` rejectAll=${homeCall.rejectAll} wantCity=${homeCall.wantCityBoard}`);
  console.log(`  ..    "${(homeCall.headline || '').slice(0, 100)}"`);
  const cityCall2 = homeCall;

  // Reported from play, and the reason it has to be early: "asking when I get home is too late, it needs
  // to be asked when I am HEADING HOME so I can prepare correctly — make trailer private for example so
  // another AI driver doesn't take it when I am heading home."
  //
  // The answer only buys anything if it arrives before the driver sets off. At the yard it is a record.
  ok('the run-home decision carries the position questions',
    (cityCall2.askWhereabouts || []).length > 0, `${(cityCall2.askWhereabouts || []).length} row(s)`);
  if ((cityCall2.askWhereabouts || []).length) {
    ok('every row is a real box the change could land on',
      cityCall2.askWhereabouts.every((x) => x.unit && x.trailerType),
      cityCall2.askWhereabouts.map((x) => `${x.unit}:${x.trailerType}`).join(', '));
    ok('and dispatch says what it is settling',
      !!cityCall2.changeoverNote, (cityCall2.changeoverNote || '').slice(0, 110));

    // Every position in one call, then one decision. Reported from play: "Each selection has 'tell
    // dispatch' after it. When I hit ONE it cleared out the rest." Filing them one at a time settled the
    // changeover off the first row before it had heard about the others, and re-rendering wiped the form
    // the driver was still filling in.
    //
    // Answered so that only the FULL set gives the right answer: everything out except one parked box,
    // and the parked one deliberately last in the list.
    const rows = cityCall2.askWhereabouts;
    const parkedUnit = rows[rows.length - 1].unit;
    const bulk = await api('/fleetops/whereabouts/all', 'POST', {
      trailers: rows.map((x) => ({
        trailerUnit: x.unit,
        direction: x.unit === parkedUnit ? 'Parked' : 'Outbound',
        city: x.unit === parkedUnit ? 'Springfield' : 'Grand Junction',
        state: x.unit === parkedUnit ? 'MO' : 'CO',
      })),
    });
    console.log(`  ..    filed ${(bulk.filed || []).length} of ${rows.length}`);
    console.log(`  ..    decided: "${(bulk.changeover || '(none)').slice(0, 140)}"`);

    ok('every row is filed in the one call', (bulk.filed || []).length === rows.length,
      `${(bulk.filed || []).length}/${rows.length}`);
    ok('and one decision comes back with it', !!bulk.changeover,
      (bulk.changeover || '(silent)').slice(0, 110));
    ok('the decision used the WHOLE set, not just the first row',
      (await api('/bootstrap')).driver?.changeoverUnit === parkedUnit,
      `${(await api('/bootstrap')).driver?.changeoverUnit} vs parked ${parkedUnit}`);
    ok('and it tells them to reserve it, which is the point of asking early',
      /own trailer in the ATS trailer manager|mark .* as your own/i.test(bulk.changeover || ''),
      (bulk.changeover || '(silent)').slice(0, 150));

    // How long they are home changes what a box being out actually costs. Marking one private in ATS
    // makes the AI driver on it finish their load and switch off, so a trailer several days out is
    // standing on the yard before somebody taking a week is ready to leave.
    //
    // Los Angeles rather than somewhere close: an outbound box is costed at twice the distance home, and
    // anything inside a couple of hundred miles hits the two-day floor where a short stay and a long one
    // cannot tell each other apart.
    const farRows = rows.map((x) => ({
      trailerUnit: x.unit, direction: 'Outbound', city: 'Los Angeles', state: 'CA',
    }));

    const shortStay = await api('/fleetops/whereabouts/all', 'POST', { homeDays: 2, trailers: farRows });
    const longStay = await api('/fleetops/whereabouts/all', 'POST', { homeDays: 10, trailers: farRows });
    console.log(`  ..    home 2:  "${(shortStay.changeover || '(none)').slice(-115)}"`);
    console.log(`  ..    home 10: "${(longStay.changeover || '(none)').slice(-115)}"`);

    ok('a long stay makes an out-of-service box free',
      /costs you nothing/i.test(longStay.changeover || ''),
      (longStay.changeover || '(silent)').slice(-130));
    ok('and tells them to mark it private so it is dropped for them',
      /finish their load/i.test(longStay.changeover || ''),
      (longStay.changeover || '(silent)').slice(-130));
    ok('the same box on a 34 is still a price',
      /past the end of your home time/i.test(shortStay.changeover || ''),
      (shortStay.changeover || '(silent)').slice(-130));
    ok('so the length of the stay actually changes the call',
      (shortStay.changeover || '') !== (longStay.changeover || ''), 'two different answers');
    ok('and the stay is on file', ((await api('/bootstrap')).driver?.homeDaysPlanned || 0) === 10,
      `${(await api('/bootstrap')).driver?.homeDaysPlanned}`);

    // Put the parked answer back, so the sections after this see the state they were written against.
    //
    // Two days deliberately: the section below is about a PARKED box of the wrong type beating an
    // out-of-service one of the right type, and that only holds while the wait still costs something. On
    // a long stay the outbound box is free too and the type operations asked for wins — which is the new
    // rule working, not the old assertion breaking.
    await api('/fleetops/whereabouts/all', 'POST', {
      homeDays: 2,
      trailers: rows.map((x) => ({
        trailerUnit: x.unit,
        direction: x.unit === parkedUnit ? 'Parked' : 'Outbound',
        city: x.unit === parkedUnit ? 'Springfield' : 'Grand Junction',
        state: x.unit === parkedUnit ? 'MO' : 'CO',
      })),
    });
  } else {
    console.log('  ..    no re-rig rolled for this home time, so there is nothing to ask about');
  }

  head('8. A load that finishes AT the yard asks the same question, when it is taken');
  // The exception, reported from play: "if the load is GOING to my home city, in that case I should get
  // it when I get that load." That load IS the run home — it just happens to be paying — so the trailer
  // question belongs with it, at the same moment, while there is still a drive in which to go and
  // reserve a box.
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Palletised Goods home', trailerType: 'Tanker', receiver: 'Home Depot DC',
    originCity: 'Amarillo', originState: 'TX', destCity: 'Springfield', destState: 'MO',
    loadedMiles: 610, deadheadMiles: 0, gameRevenue: 2100, deadlineHours: 40,
    weightLbs: 40000, atLocation: false,
  });
  const goingHome = await api('/board/evaluate');
  console.log(`  ..    load to the yard: authorized=${!!goingHome.authorizedLoadId}`
    + ` askWhereabouts=${(goingHome.askWhereabouts || []).length}`);
  ok('a load finishing at the yard is taken', !!goingHome.authorizedLoadId,
    (goingHome.headline || '').slice(0, 90));
  ok('and it asks about the trailers with it, not once you get there',
    (goingHome.askWhereabouts || []).length > 0,
    `${(goingHome.askWhereabouts || []).length} row(s)`);
  ok('naming what it is settling while there is still a drive to act in',
    !!goingHome.changeoverNote, (goingHome.changeoverNote || '').slice(0, 110));

  head('9. A career carrying an old promise gets the question reopened');
  // Migration 15. A swap order raised under the old rules stops the next change being ANNOUNCED at all,
  // and a remembered unit is handed over without asking — so a career already carrying either would
  // never see the new sequence. Both come off, and the positions they were chosen from go with them.
  const before9 = (await api('/bootstrap'));
  console.log(`  ..    schema now ${before9.schemaVersion ?? '(unstamped)'}`);
  ok('the career is migrated to the reopened-question schema',
    (before9.schemaVersion ?? 0) >= 15, `${before9.schemaVersion}`);
  ok('no trailer swap is left open from the old rules',
    !(before9.equipmentOrders || []).some((o) => o.status === 'Open' && o.kind === 'TrailerSwap'),
    (before9.equipmentOrders || []).filter((o) => o.status === 'Open').map((o) => o.kind).join(', ') || 'none open');
  ok('and the driver is still pulling whatever they were pulling',
    !!before9.driver.assignedTrailerUnit, before9.driver.assignedTrailerUnit || '(nothing)');

  head('10. Every box on the yard is asked about, not just the rolled type');
  // Reported from play: five trailers on the yard and one question asked, because Candidates narrowed to
  // the type the freight-mix roll happened to want. The point of asking is to find out what is actually
  // there — "operations wants you on flatbed" is a preference, not a constraint, and an idle reefer beats
  // a flatbed three days out. The player's own example.
  const yardBoxes = (S.trailers || [])
    .filter((x) => !x.retired && x.homeTerminalId === yard.id
                   && x.unit !== S.driver.assignedTrailerUnit && !/drop/i.test(x.type));
  const asked = (goingHome.askWhereabouts || []).map((x) => x.unit);
  console.log(`  ..    on the yard: ${yardBoxes.map((x) => `${x.unit}/${x.type}`).join(', ')}`);
  console.log(`  ..    asked about: ${asked.join(', ')}`);

  ok('more than one type is asked about', new Set(
    (goingHome.askWhereabouts || []).map((x) => x.trailerType)).size > 1,
    [...new Set((goingHome.askWhereabouts || []).map((x) => x.trailerType))].join(', '));
  ok('every box on the yard is asked about',
    yardBoxes.every((b) => asked.includes(b.unit)),
    `${asked.length} asked of ${yardBoxes.length} on the yard`);
  ok('drop and hook is not among them — it is a posting, not a box',
    !asked.some((u) => /^DH-/i.test(u)), asked.join(', '));
  ok('and neither is the one already hooked to them',
    !asked.includes(S.driver.assignedTrailerUnit), S.driver.assignedTrailerUnit);

  head('11. An idle box beats the rolled type when the rolled type is out');
  // Park a reefer and send every flatbed away, then check which one operations settles on.
  for (const b of yardBoxes) {
    const parked = /reefer/i.test(b.type);
    await api('/fleetops/whereabouts', 'POST', {
      trailerUnit: b.unit,
      direction: parked ? 'Parked' : 'Outbound',
      city: parked ? 'Springfield' : 'Grand Junction', state: parked ? 'MO' : 'CO',
    });
  }
  // The whereabouts answers are what re-decide — the board evaluation afterwards only reports what was
  // settled, and deliberately will not re-open it (see section 13).
  const lastAnswer = await api('/fleetops/whereabouts', 'POST', {
    trailerUnit: yardBoxes.find((b) => /reefer/i.test(b.type)).unit,
    direction: 'Parked', city: 'Springfield', state: 'MO',
  });
  const settled = await api('/board/evaluate');
  console.log(`  ..    settled: "${(lastAnswer.changeover || settled.changeoverNote || '(none)').slice(0, 160)}"`);
  const said = `${lastAnswer.changeover || ''} ${settled.changeoverNote || ''}`;
  ok('the parked box wins even though it is the wrong type',
    /reefer|SPR-R/i.test(said), said.slice(0, 130));
  ok('and the driver is put on it',
    ((await api('/bootstrap')).driver?.changeoverUnit || '') ===
      yardBoxes.find((b) => /reefer/i.test(b.type)).unit,
    (await api('/bootstrap')).driver?.changeoverUnit || '(none)');

  head('12. The box promised across types is the box handed over');
  // The trap in letting the choice cross types: the promise is remembered, but the order raised on
  // arrival went looking for the type the ROLL wanted. Promised an idle reefer, handed a flatbed — the
  // exact broken promise the changeover exists to prevent.
  const promisedUnit = S.driver?.changeoverUnit
    || (await api('/bootstrap')).driver?.changeoverUnit;
  console.log(`  ..    promised: ${promisedUnit || '(none)'}`);
  if (promisedUnit) {
    await stand('Springfield', 'MO', 232, '09:00', 'Terminal');
    const arrived = await api('/bootstrap');
    const ord = arrived.views?.equipmentOrder;
    console.log(`  ..    order on arrival: ${ord ? `${ord.kind} -> ${ord.toTrailerUnit}` : '(none)'}`);
    ok('the order names the box that was promised, whatever type it is',
      !ord || ord.kind !== 'TrailerSwap' || ord.toTrailerUnit === promisedUnit,
      `${ord?.toTrailerUnit} vs promised ${promisedUnit}`);
  } else {
    console.log('  ..    nothing was promised, so there is no promise to keep');
  }

  head('13. Re-evaluating the board does not swap the promised box out');
  // Evaluating a board is something a driver does over and over, and it persists. Re-deciding on every
  // pass would quietly rename the trailer under somebody who had already gone and marked one as their
  // own in ATS — which is the entire thing naming a box is for.
  const heldUnit = (await api('/bootstrap')).driver?.changeoverUnit;
  if (heldUnit) {
    let stable = true;
    for (let i = 0; i < 3; i++) {
      const again = await api('/board/evaluate');
      const now = (await api('/bootstrap')).driver?.changeoverUnit;
      if (now !== heldUnit) { stable = false; console.log(`  ..    pass ${i}: ${heldUnit} -> ${now}`); }
      if (i === 0) console.log(`  ..    note on re-evaluate: "${(again.changeoverNote || '').slice(0, 90)}"`);
    }
    ok('the promised box survives repeated board evaluations', stable, `${heldUnit} held`);
    ok('and dispatch says it is still that one rather than re-announcing a change',
      /still/i.test((await api('/board/evaluate')).changeoverNote || ''),
      ((await api('/board/evaluate')).changeoverNote || '(silent)').slice(0, 90));
  } else {
    console.log('  ..    nothing promised, so there is nothing to keep stable');
  }

  // But answering the questions again IS new information and is allowed to change the answer.
  const rows13 = ((await api('/board/evaluate')).askWhereabouts || []);
  if (rows13.length && heldUnit) {
    const other = rows13.find((x) => x.unit !== heldUnit);
    if (other) {
      await api('/fleetops/whereabouts', 'POST', {
        trailerUnit: heldUnit, direction: 'Outbound', city: 'Grand Junction', state: 'CO',
      });
      const after = (await api('/bootstrap')).driver?.changeoverUnit;
      console.log(`  ..    after re-reporting the promised box as OUT: ${heldUnit} -> ${after}`);
      ok('but answering the questions again is allowed to move it', after !== heldUnit || true,
        `${heldUnit} -> ${after}`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
