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
  let pending = '';
  for (let i = 0; i < 10 && !pending; i++) {
    await stand('Amarillo', 'TX', 40 + i * 15, '08:00');
    pending = (await api('/bootstrap')).views?.homeTime?.reassignmentNotice || '';
    if (pending) break;
    await stand('Springfield', 'MO', 40 + i * 15 + 2, '09:00', 'Terminal');
    const o2 = (await api('/bootstrap')).views?.equipmentOrder;
    if (o2) await api(`/equipment/orders/${o2.number}/complete`, 'POST', {}).catch(() => {});
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

    // Answer one as parked and the reserve instruction has to come back, because that is the thing the
    // driver needs to act on before they drive away.
    const pick = cityCall2.askWhereabouts[0];
    const ans = await api('/fleetops/whereabouts', 'POST', {
      trailerUnit: pick.unit, direction: 'Parked', city: 'Springfield', state: 'MO',
    });
    ok('answering names the box and tells them to reserve it',
      /own trailer in the ATS trailer manager|mark .* as your own/i.test(ans.changeover || ''),
      (ans.changeover || '(silent)').slice(0, 150));
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
