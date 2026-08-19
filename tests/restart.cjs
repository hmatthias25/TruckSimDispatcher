/* Issues #41 and #42: the 34-hour restart is ordered, routed and verified; empty miles between loads
   are paid from the odometer readings. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5700}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
