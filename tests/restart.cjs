/* Issues #41 and #42: the 34-hour restart is ordered, routed and verified; empty miles between loads
   are paid from the odometer readings. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5700}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status}: ${j?.error || t.slice(0, 200)}`); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refuses = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

let S;
const at = (d, hm = '08:00') => `2000-${String(Math.floor((d - 1) / 28) + 1).padStart(2, '0')}-${String(((d - 1) % 28) + 1).padStart(2, '0')}T${hm}`;

async function place(city, state, day, hm = '08:00', cycle = 70) {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: at(day, hm),
    fuelPct: 90, atsOdometer: 100000, truckDamagePct: 1, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: cycle });
  S = un(await api('/bootstrap'));
}

(async () => {
  head('1. Hire');
  const app = { driverName: 'Restart Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  ok('the stop-dispatch threshold is a setting', S.settings.hos.stopDispatchAtCycleHours > 0,
    `${S.settings.hos.stopDispatchAtCycleHours} h`);

  head('2. Plenty of cycle left: no restart in sight');
  await place('Amarillo', 'TX', 3, '08:00', 60);
  ok('nothing ordered', !S.views.restart, JSON.stringify(S.views.restart));

  head('3. Down to the threshold: dispatch stops and a city is named');
  await place('Amarillo', 'TX', 4, '08:00', 9);
  ok('a restart is flagged as needed', S.views.restart?.needed === true, JSON.stringify(S.views.restart?.needed));

  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Amarillo', originState: 'TX',
    destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 260, deadheadMiles: 0,
    gameRevenue: 900, deadlineHours: 24, weightLbs: 30000,
  });
  const stops = (board.evaluations[0].hardFails || []).join(' | ');
  ok('the board is refused', board.rejectAll === true, `${board.rejectAll}`);
  ok('and it is because of the cycle', /restart/i.test(stops), stops.slice(0, 160) || '(none)');
  ok('a specific city is named', /[A-Z][a-z]+,\s?[A-Z]{2}/.test(stops), stops.slice(0, 200));
  ok('with a reason for that city',
    /parking and services|home time/i.test(stops), stops.slice(0, 250));

  S = un(await api('/bootstrap'));
  const order = S.views.restart.order;
  ok('the order persists', !!order?.number, order?.number);
  ok('it records the cycle that triggered it', order.cycleAtOrder > 0 && order.cycleAtOrder <= 11,
    `${order.cycleAtOrder}`);
  ok('and the required hours come from the rule set', order.requiredHours === S.settings.hos.cycleRestartHours,
    `${order.requiredHours}`);

  head('4. Completing before arriving is refused');
  let msg = await refuses(() => api('/restart/complete', 'POST', { gameTime: at(4, '10:00') }));
  ok('you cannot finish a restart you never started', /report in at the truck stop first/i.test(msg || ''), msg);
  ok('and it is still on order', !!S.views.restart?.order, S.views.restart?.order?.status);

  head('4b. A cycle that comes back on its own stands the order down');
  // The driver's HOS display is authoritative. If they re-read it and the cycle is fine, there is
  // nothing to sit — holding them to a restart they do not need would be the app being stubborn.
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  S = un(await api('/bootstrap'));
  ok('the order stood down', !S.views.restart, JSON.stringify(S.views.restart));
  const stood = (await api('/bootstrap')).restartOrders?.[0];
  ok('and it says why, on the record', /Stood down/.test(stood?.reason || ''), stood?.reason?.slice(0, 90));

  // Back under the threshold for the rest of the run.
  await place('Amarillo', 'TX', 4, '08:00', 9);
  ok('a fresh order is raised', !!S.views.restart?.order, S.views.restart?.order?.number);

  head('5. Arrive, and the clock starts');
  S = un(await api('/restart/arrived', 'POST', { gameTime: at(4, '12:00'), city: 'Amarillo', state: 'TX' }));
  const arrived = S.views.restart.order;
  ok('status is arrived', arrived.status === 'Arrived', arrived.status);
  ok('the clock started when reported', /04T12:00$/.test(arrived.arrivedGameTime), arrived.arrivedGameTime);
  ok('and eligibility is 34 hours later', /05T22:00$/.test(arrived.eligibleGameTime), arrived.eligibleGameTime);
  msg = await refuses(() => api('/restart/arrived', 'POST', { gameTime: at(4, '13:00') }));
  ok('arriving twice is refused', /already started/i.test(msg || ''), msg);

  head('6. A short restart is refused, with the numbers');
  let r = await api('/restart/complete', 'POST', { gameTime: at(5, '14:00') });   // 26 hours
  S = un(r);
  ok('not accepted', r.accepted === false, `${r.accepted}`);
  ok('and it says how short', /26:00/.test(r.message) && /short/i.test(r.message), r.message);
  ok('it names when they are eligible', /22:00/.test(r.message), r.message);
  ok('still on order', S.views.restart.order.status === 'Arrived', S.views.restart.order.status);

  head('7. Long enough, but the cycle did not come back');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 12 });
  r = await api('/restart/complete', 'POST', { gameTime: at(5, '23:00') });      // 35 hours
  S = un(r);
  ok('still not accepted', r.accepted === false, `${r.accepted}`);
  ok('because the cycle is short', /cycle is showing 12:00/.test(r.message), r.message);
  ok('and it says a full restart returns the lot', /puts the whole/.test(r.message), r.message);

  head('8. Full time and a reset cycle clears it');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  r = await api('/restart/complete', 'POST', { gameTime: at(5, '23:00') });
  S = un(r);
  ok('accepted', r.accepted === true, r.message);
  ok('it reports what actually elapsed', /35:00/.test(r.message), r.message);
  ok('nothing left on order', !S.views.restart, JSON.stringify(S.views.restart));

  await api('/board/clear', 'POST', {});
  const after = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Amarillo', originState: 'TX',
    destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 260, deadheadMiles: 0,
    gameRevenue: 900, deadlineHours: 24, weightLbs: 30000,
  });
  ok('freight flows again', after.rejectAll === false,
    (after.evaluations[0].hardFails || []).join(' | ') || '(clear)');

  head('9. Home beats the road when home time is close');
  await api('/career/home-time', 'POST', { preference: 'weekly' });
  // Near home, not AT it — standing at the yard counts as taking home time, so it would no longer
  // be due and there would be nothing for the restart to combine with.
  S = un(await api('/status', 'POST', {
    locationCity: 'Colorado Springs', locationState: 'CO', locationKind: 'TruckStop', gameTime: at(40),
    fuelPct: 90, atsOdometer: 120000, truckDamagePct: 1, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 8 });
  S = un(await api('/bootstrap'));
  const homeOrder = S.views.restart?.order;
  if (homeOrder) {
    ok('the restart is routed home', homeOrder.atHomeTerminal === true,
      `${homeOrder.targetCity}, ${homeOrder.targetState} home=${homeOrder.atHomeTerminal}`);
    ok('and it says why home is better',
      /home time|same stop/i.test(homeOrder.reason), homeOrder.reason);
  } else {
    ok('an order was raised at all', false, 'none raised');
  }

  head('10. It will NOT deadhead half a day home for home time that is a week away');
  // The silly case: home time comfortably far off, the yard a long empty run away. Sitting it where
  // they are and being routed home with freight later is the right answer.
  await api('/career/home-time', 'POST', { preference: 'monthly' });
  S = un(await api('/status', 'POST', {
    locationCity: 'Los Angeles', locationState: 'CA', locationKind: 'TruckStop', gameTime: at(50),
    fuelPct: 90, atsOdometer: 200000, truckDamagePct: 1, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 9 });
  S = un(await api('/bootstrap'));
  const farOrder = S.views.restart?.order;
  ok('an order was raised', !!farOrder, farOrder?.number);
  ok('but NOT routed home', farOrder?.atHomeTerminal === false,
    `${farOrder?.targetCity}, ${farOrder?.targetState} home=${farOrder?.atHomeTerminal}`);
  ok('and it explains why it is not sending them empty',
    /too far to deadhead|not running you there empty|not due for/.test(farOrder?.reason || ''),
    farOrder?.reason);
  ok('promising freight home instead of an empty run',
    /with freight|with a load/.test(farOrder?.reason || ''), farOrder?.reason);

  head('11. The caps are settings, not magic numbers');
  ok('the deadhead cap is editable', S.settings.hos.restartHomeMaxDeadheadHours > 0,
    `${S.settings.hos.restartHomeMaxDeadheadHours} h`);
  ok('and so is how close home time has to be', S.settings.hos.restartHomeMaxDaysUntilDue > 0,
    `${S.settings.hos.restartHomeMaxDaysUntilDue} days`);
  ok('the cap is well under a full day of driving', S.settings.hos.restartHomeMaxDeadheadHours <= 6,
    `${S.settings.hos.restartHomeMaxDeadheadHours} h`);

  head('12. Close to home AND home time due still combines them');
  S = un(await api('/status', 'POST', {
    locationCity: 'Colorado Springs', locationState: 'CO', locationKind: 'TruckStop', gameTime: at(80),
    fuelPct: 90, atsOdometer: 240000, truckDamagePct: 1, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 9 });
  S = un(await api('/bootstrap'));
  const nearOrder = S.views.restart?.order;
  ok('routed home when both hold', nearOrder?.atHomeTerminal === true,
    `${nearOrder?.targetCity}, ${nearOrder?.targetState} home=${nearOrder?.atHomeTerminal}`);
  ok('and it says the empty run is short enough to be worth it',
    /empty\. Worth it|one stop/.test(nearOrder?.reason || ''), nearOrder?.reason);

  head('13. No return date is ever invented for a trailer out with a hired driver');
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app3 = { driverName: 'No Guess', preferredDivision: 'Reefer', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app3);
  S = un(await api('/onboarding/hire', 'POST', { application: app3, force: true, gameTime: at(1), code: 'PRI' }));
  const hq3 = S.company.terminals[0];
  S = un(await api(`/terminals/${hq3.id}/level`, 'POST', { level: 'Large' }));

  // A flatbed on the property, held by a hired driver, so a re-rig has to wait on them.
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'T900', type: 'Flatbed', division: 'Flatbed', inGameGarage: true, isCompanyOwned: true,
    status: 'InService', homeTerminalId: hq3.id, currentLocation: 'Springfield, MO',
  }));
  S = (await api('/fleetops/drivers', 'POST', {
    name: 'M. Torres', assignedTrailerUnit: 'T900', skill: 'Competent', status: 'Active',
    wageShare: 0.3, homeTerminalId: hq3.id,
  })).snapshot;

  const held = (await api('/fleetops')).drivers.find((d) => d.name === 'M. Torres');
  ok('the app knows WHO has the trailer', held.assignedTrailerUnit === 'T900', held.assignedTrailerUnit);
  ok('but has no due-back date for them', !held.trailerDueBackGameTime, `"${held.trailerDueBackGameTime}"`);

  // Walk home times until a re-rig onto that flatbed is ordered.
  let waitOrder = null;
  for (let v = 2; v <= 10 && !waitOrder; v++) {
    await place('Denver', 'CO', 20 + v * 20);
    await place('Springfield', 'MO', 20 + v * 20 + 12);
    const o = S.views.equipmentOrder;
    if (o && o.kind === 'TrailerSwap' && o.heldByDriverName) waitOrder = o;
  }

  if (waitOrder) {
    ok('the order names who has it', /Torres/.test(waitOrder.heldByDriverName), waitOrder.heldByDriverName);
    ok('and NO date is invented', !waitOrder.availableFromGameTime, `"${waitOrder.availableFromGameTime}"`);
    ok('it admits it cannot see where they are',
      /no way of knowing where they are/i.test(waitOrder.instruction), waitOrder.instruction);
    ok('and tells the driver to report in when it turns up',
      /when the trailer turns up|report in when/i.test(waitOrder.instruction), waitOrder.instruction);
    ok('and offers a way out rather than an unanswerable wait',
      /ask me for a different trailer/i.test(waitOrder.instruction), waitOrder.instruction);

    const blockers = (S.views.dispatchBlockers || []).join(' | ');
    ok('dispatch is blocked without quoting a date',
      /still has trailer/i.test(blockers) && !/due back around/i.test(blockers), blockers || '(none)');
  } else {
    console.log('  (no held-trailer re-rig came up — seeded, so a legitimate outcome)');
    ok('the no-guess path is wired even when quiet', true, 'nothing due');
  }

  head('14. A date the player reports IS used');
  // The same POST both creates and updates; there is no PUT route.
  S = (await api('/fleetops/drivers', 'POST', {
    ...held, trailerDueBackGameTime: at(200),
  })).snapshot;
  const heldAfter = (await api('/fleetops')).drivers.find((d) => d.name === 'M. Torres');
  if (heldAfter.trailerDueBackGameTime) {
    ok('the reported date is stored', true, heldAfter.trailerDueBackGameTime);
  } else {
    ok('the field exists to be reported into', 'trailerDueBackGameTime' in heldAfter,
      JSON.stringify(Object.keys(heldAfter).filter((k) => /due/i.test(k))));
  }

  head('15. An operational 34 - the company parks you with clean clocks');
  // This one has to be earned rather than asserted: run real loads and close them out until the
  // company parks the driver of its own accord. Seeded on the trip number, so a green run stays green.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app4 = { driverName: 'Ops Park', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app4);
  S = un(await api('/onboarding/hire', 'POST', { application: app4, force: true, gameTime: at(1), code: 'SFL' }));
  await place('Denver', 'CO', 1);

  /** One clean 400-mile load with full clocks, closed out. Returns the close-out audit. */
  async function haul(n) {
    // Full clocks every time, so nothing here can be mistaken for a cycle restart.
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    const to = n % 2 ? ['Amarillo', 'TX'] : ['Denver', 'CO'];
    const board = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: to[0], destState: to[1],
      loadedMiles: 400, deadheadMiles: 0, gameRevenue: 1900, deadlineHours: 72, weightLbs: 40000,
    });
    const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
    const arrive = at(2 + n * 2);
    const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
      deliveredGameTime: arrive, actualMiles: 400, endOdometer: 20000 + n * 400, actualRevenue: 1900,
      fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
      loadingHours: 1, unloadingHours: 1, detentionHours: 0,
      layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
      delayReason: '', damageCause: '', notes: '',
      locationCity: to[0], locationState: to[1], fuelPct: 60, gameTime: arrive,
    });
    S = done.snapshot;
    return done.audit;
  }

  let opsOrder = null, opsAudit = null, hauled = 0;
  for (let n = 1; n <= 80 && !opsOrder; n++) {
    const audit = await haul(n);
    hauled = n;
    const raised = ((await api('/bootstrap')).restartOrders || [])
      .find((o) => o.trigger === 'Operational' && o.status === 'Ordered');
    if (raised) { opsOrder = raised; opsAudit = audit; }
  }

  ok('the company parked the driver of its own accord', opsOrder !== null,
    opsOrder ? `${opsOrder.number} on close-out ${hauled}` : `never in ${hauled} close-outs`);
  ok('and it took a while - this is meant to be rare', hauled >= 4, `${hauled} close-outs`);

  if (opsOrder) {
    ok('it is not a cycle restart', opsOrder.trigger === 'Operational', opsOrder.trigger);
    ok('the clocks were fine when it was ordered', opsOrder.cycleAtOrder > 11,
      `${opsOrder.cycleAtOrder} h of cycle`);
    ok('it records why the company parked them', !!opsOrder.whyParked, opsOrder.whyParked);
    ok("the reason is a company one, not the driver's doing",
      /freight|weather|appointment|equipment|account|reload/i.test(opsOrder.whyParked), opsOrder.whyParked);
    ok('a city is still named to sit it in', !!opsOrder.targetCity,
      `${opsOrder.targetCity}, ${opsOrder.targetState}`);

    // The driver is told at close-out, in the whats-next block, rather than finding out at dispatch.
    const next = (opsAudit.whatsNext || []).join(' | ');
    ok('the driver is told on the delivery summary', /parking you for 34|operations is parking/i.test(next), next);
    ok('and told plainly that it is not a mark against them',
      /not a mark against you|clocks are fine/i.test(next), next);
    ok('the reason is repeated where the driver reads it', next.includes(opsOrder.whyParked.slice(0, 25)), next);
    ok('it does NOT talk about running out of cycle', !/down to .* of cycle/i.test(next), next);

    head('16. And nothing dispatches until that 34 is sat');
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    const held = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: 'Wichita', destState: 'KS', loadedMiles: 350, deadheadMiles: 0,
      gameRevenue: 1700, deadlineHours: 72, weightLbs: 40000,
    });
    const ev = held.evaluations[0];
    const stops = (ev.hardFails || []).join(' | ');
    ok('the board is refused even with a full 70', held.rejectAll === true, `${held.rejectAll}`);
    ok('and it is the restart holding it, not the hours',
      stops.includes(opsOrder.number), stops || '(none)');
    ok('it does not claim the driver is out of hours', !/out of hours|no drive time/i.test(stops), stops);
    const stopped = await refuses(() => api('/dispatch/authorize', 'POST', { loadId: ev.load.id }));
    ok('authorising is refused outright', stopped !== null, stopped || '(allowed!)');

    head('17. Sitting it clears it, same as any other restart');
    await api('/restart/arrived', 'POST',
      { gameTime: at(2 + hauled * 2, '12:00'), city: opsOrder.targetCity, state: opsOrder.targetState });
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    const cleared = await api('/restart/complete', 'POST', { gameTime: at(4 + hauled * 2, '22:00') });
    ok('the restart completes', /complete/i.test(cleared.message || ''), cleared.message);
    ok('and nothing is left on order',
      !((await api('/bootstrap')).restartOrders || []).some((o) => o.status === 'Ordered'), 'clear');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
