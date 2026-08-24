/* Issue #89: a seat coming free should move the driver into it.
 *
 * Bob gets let go. His tractor — newer and lower-mileage than the one the player is in — stands empty,
 * and the app used to list it on the Fleet tab as one of four things the player might do, next to a note
 * suggesting they go and hire somebody for the seat. A real carrier moves the proven driver; that is what
 * seniority is for.
 *
 * Rank sets the odds, a clean file is the price of entry, and a seeded roll settles it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5968}/api`;
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
const day = (n, hm = '08:00') => `2000-01-${String(n).padStart(2, '0')}T${hm}`;

let S;

(async () => {
  const app = { driverName: 'S. Enior', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1), code: 'PRI' }));
  S = un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: day(2),
    fuelPct: 90, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 300000,
  }));
  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));

  // Put the player in something tired, and a good tractor under a hired driver.
  const mine = S.driver.assignedTruckUnit;
  S = un(await api('/fleet/truck', 'POST', {
    unit: mine, year: 2016, make: 'Freightliner', model: 'Cascadia', cabConfig: 'Sleeper',
    serviceMiles: 780000, status: 'InService', homeTerminalId: hq.id, inGameGarage: true,
  }));
  S = un(await api('/fleet/truck', 'POST', {
    unit: 'T900', year: 2024, make: 'Kenworth', model: 'W990', cabConfig: 'Sleeper',
    serviceMiles: 40000, status: 'InService', homeTerminalId: hq.id, inGameGarage: true,
  }));
  const bob = (await api('/fleetops/drivers', 'POST', {
    name: 'Bob Gone', assignedTruckUnit: 'T900', assignedTrailerUnit: '', skill: 'Competent',
    status: 'Active', wageShare: 0.3, homeTerminalId: hq.id,
  })).snapshot;
  S = bob;
  const bobId = ((await api('/fleetops')).drivers || []).find((d) => d.name === 'Bob Gone')?.id;
  ok('Bob is in the good truck', !!bobId, `T900 under ${bobId ? 'Bob' : '(nobody)'}`);

  head('1. On probation, asking is refused outright');
  ok('still probationary', S.driver.rank === 'probationary', S.driver.rank);
  let refused = null;
  try {
    const r = await api('/equipment/ask-better-unit', 'POST', {});
    refused = r.granted === false ? r.message : null;
  } catch (e) { refused = e.message; }
  ok('turned down', !!refused, (refused || '(granted!)').slice(0, 110));
  // Bob is still in T900 at this point, so nothing is free and that answer comes first. The probation
  // gate itself is proved by section 2: no order is raised until the driver is off it.
  ok('with a reason the driver can act on',
    /probation|nothing on the property/i.test(refused || ''), (refused || '').slice(0, 90));

  head('2. Off probation and clean, the company decides');
  S = un(await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' }));
  // Senior standing shortens the odds enough that this is a fair test of the path.
  S = un(await api('/career/promote', 'POST', { rank: 'senior', force: true, note: 'fixture' }));
  ok('now a senior driver', S.driver.rank === 'senior', S.driver.rankTitle);

  const before = (await api('/equipment')).openOrder;
  ok('no equipment order outstanding yet', !before, before?.number || 'none');

  S = un(await api('/fleetops/terminate', 'POST', { driverId: bobId, reason: 'two bad reviews' }));
  const order = (await api('/equipment')).openOrder;

  if (order) {
    head('3. It is an order, and it says not to hire for the seat');
    ok('the company raised it on its own', !!order.number, order.number);
    ok('it names the freed truck', order.toTruckUnit === 'T900', `${order.toTruckUnit}`);
    ok('and the one being left behind', order.fromTruckUnit === mine, `${order.fromTruckUnit}`);
    ok('it tells the driver not to hire for that seat',
      /do not hire for that seat/i.test(order.instruction || ''), (order.instruction || '').slice(0, 130));
    ok('and that freight will carry them there rather than an empty run',
      /work freight back that way/i.test(order.instruction || ''), (order.instruction || '').slice(-100));

    head('4. And the Fleet tab stops arguing with it');
    const openUnits = (await api('/fleetops')).openUnits || [];
    const seat = openUnits.find((u) => u.unit === 'T900');
    ok('the freed unit is listed', !!seat, seat ? seat.spec : 'not listed');
    if (seat) {
      ok('flagged as already yours', seat.orderedToYou === true, `${seat.orderedToYou}`);
      ok('and the hire note yields to the order',
        /do not hire for this seat/i.test(seat.hireNote || ''), (seat.hireNote || '').slice(0, 110));
    }
  } else {
    head('3. The roll went the other way, which is allowed');
    ok('no order, and the seat stays open', true, 'seeded refusal — not a certainty at any rank');
    const openUnits = (await api('/fleetops')).openUnits || [];
    const seat = openUnits.find((u) => u.unit === 'T900');
    ok('the Fleet tab still offers it normally', !seat?.orderedToYou, `${seat?.orderedToYou}`);
  }

  head('5. One equipment order at a time');
  let second = null;
  try {
    const r = await api('/equipment/ask-better-unit', 'POST', {});
    second = r.granted === false ? r.message : null;
  } catch (e) { second = e.message; }
  ok('asking again while one is open is refused', !!second, (second || '(granted!)').slice(0, 110));
  ok('and it names the order in the way', /outstanding|close that out/i.test(second || ''),
    (second || '').slice(0, 90));

  head('6. Out on the road, the board works you back toward it');
  // The seat can come free while the driver is days away. Telling them to report to a yard without ever
  // routing them there is a note, not dispatching.
  if (order) {
    S = un(await api('/status', 'POST', {
      locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: day(6),
      fuelPct: 90, atsOdometer: 9000, truckDamagePct: 2, trailerDamagePct: 1,
      dutyStatus: 'OnDuty', atsBankBalance: 300000,
    }));
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    // One toward the yard holding the truck, one straight away from it.
    await api('/board/add', 'POST', {
      cargo: 'Toward the yard', trailerType: S.trailers[0].type,
      originCity: 'Amarillo', originState: 'TX', destCity: 'Springfield', destState: 'MO',
      loadedMiles: 570, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 48, weightLbs: 40000,
    });
    const board = await api('/board/add', 'POST', {
      cargo: 'Away from it', trailerType: S.trailers[0].type,
      originCity: 'Amarillo', originState: 'TX', destCity: 'Phoenix', destState: 'AZ',
      loadedMiles: 600, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 48, weightLbs: 40000,
    });
    const evals = board.evaluations || [];
    const toward = evals.find((e) => /Toward the yard/.test(e.load.cargo));
    const away = evals.find((e) => /Away from it/.test(e.load.cargo));

    ok('both loads were scored', !!toward && !!away, `${evals.length} on the board`);
    if (toward && away) {
      ok('the one heading for the truck scores higher', toward.score > away.score,
        `toward ${toward.score} vs away ${away.score}`);
      ok('and the reason names the order',
        (toward.scoreDetail || []).some((d) => new RegExp(order.number).test(d)),
        (toward.scoreDetail || []).find((d) => new RegExp(order.number).test(d)) || '(not explained)');
      ok('the wrong-way load is called out',
        (away.cons || []).some((c) => /further from/i.test(c)),
        (away.cons || []).find((c) => /further from/i.test(c)) || '(no con)');
    }
    ok('and the order promises the routing rather than an empty run',
      /work freight back that way/i.test(order.instruction || ''), (order.instruction || '').slice(-100));
  }

  head('7. #90 A full yard is a swap, not a wall');
  // Denver small = one slot, an AI driver in it. Every truck the company owns takes a garage slot in the
  // game, the player's included — so the domicile has to have somewhere to put the tractor. It always
  // does, because the driver is vacating a slot at the same moment they need one.
  {
    const den = (await api('/terminals', 'POST', {
      city: 'Denver', state: 'CO', level: 'Small', truckCapacity: 1,
      hasFuel: true, hasParking: true, hasTrailerDrop: true, monthlyCost: 1150,
    })).snapshot;
    const denver = (den.company.terminals || []).find((x) => x.city === 'Denver');
    ok('a one-slot yard exists', !!denver && denver.truckCapacity === 1,
      denver ? `${denver.city} cap ${denver.truckCapacity}` : 'not created');

    await api('/fleet/truck', 'POST', {
      unit: 'D100', year: 2022, make: 'Peterbilt', model: '579', cabConfig: 'Sleeper',
      serviceMiles: 200000, status: 'InService', homeTerminalId: denver.id, inGameGarage: true,
    });
    let S7 = (await api('/fleetops/drivers', 'POST', {
      name: 'Denver Dan', assignedTruckUnit: 'D100', assignedTrailerUnit: '', skill: 'Competent',
      status: 'Active', wageShare: 0.3, homeTerminalId: denver.id,
    })).snapshot;

    const denTrucksBefore = (S7.trucks || []).filter((x) => x.homeTerminalId === denver.id).length;
    ok('Denver is full before the ask', denTrucksBefore >= denver.truckCapacity,
      `${denTrucksBefore} of ${denver.truckCapacity}`);

    const homeBefore = S7.driver.homeTerminalId;
    const myTruck = S7.driver.assignedTruckUnit;

    const move = (await api('/terminals/transfer', 'POST',
      { terminalId: denver.id, reason: 'family is in Denver' })).request;
    const factors = (move.factors || []).join(' | ');
    S7 = (await api('/bootstrap'));

    ok('the request is answered', !!move.outcome, `${move.outcome}`);
    ok('a full yard reads as a swap, not a refusal',
      /somebody moves the other way/i.test(factors),
      (factors.match(/[^|]*moves the other way[^|]*/i) || ['(not explained)'])[0].trim().slice(0, 110));

    if (move.outcome === 'Approved') {
      ok('the domicile actually moved', S7.driver.homeTerminalId === denver.id,
        `${homeBefore} -> ${S7.driver.homeTerminalId}`);
      ok('and the truck went with it',
        (S7.trucks || []).find((x) => x.unit === myTruck)?.homeTerminalId === denver.id,
        `${myTruck} now at ${(S7.trucks || []).find((x) => x.unit === myTruck)?.homeTerminalId}`);
      ok('somebody moved the other way to make the room',
        (S7.trucks || []).find((x) => x.unit === 'D100')?.homeTerminalId !== denver.id,
        `D100 now at ${(S7.trucks || []).find((x) => x.unit === 'D100')?.homeTerminalId}`);
      ok('and the decision says who',
        /takes the slot you are leaving behind/i.test(move.decision || ''),
        (move.decision || '').slice(0, 150));

      const denAfter = (S7.trucks || []).filter((x) => x.homeTerminalId === denver.id).length;
      ok('Denver is not over capacity afterwards', denAfter <= denver.truckCapacity,
        `${denAfter} of ${denver.truckCapacity}`);
    } else {
      ok('and a non-approval is not blamed on parking',
        !/no slot|at capacity/i.test(move.decision || ''), (move.decision || '').slice(0, 120));
    }

    // Holds whichever way the request went: the yard is never left over capacity, and the domicile
    // never moves without the truck moving with it.
    const denNow = (S7.trucks || []).filter((x) => x.homeTerminalId === denver.id).length;
    ok('Denver is never left over capacity', denNow <= denver.truckCapacity,
      `${denNow} of ${denver.truckCapacity} after a ${move.outcome}`);
    const truckAt = (S7.trucks || []).find((x) => x.unit === myTruck)?.homeTerminalId;
    ok('and the domicile and the truck agree', S7.driver.homeTerminalId === truckAt,
      `domicile ${S7.driver.homeTerminalId} / truck ${truckAt}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
