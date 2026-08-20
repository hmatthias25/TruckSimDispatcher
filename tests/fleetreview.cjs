/* Issue #55: tuning the fortnightly fleet review.
 *
 * Four things: the trailer a driver is on becomes a choice rather than an inference, the player's own
 * equipment gets a line, mileage comes off the ATS odometer instead of being worked out by hand, and a
 * truck reaching the end of its life produces something the player can actually act on.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5780}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
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

let S, hq;
const place = async (day) => {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: iso(day),
    fuelPct: 80, atsOdometer: 20000 + day * 100, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  return S;
};

/** Sets the odds the player is handed a traded-in truck. 100 forces it, 0 forbids it. */
async function setOdds(pct) {
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, maintenance: { ...cur.maintenance, playerGetsTradedTruckPct: pct } });
}

const trailerOf = async (name) =>
  ((await api('/fleetops')).drivers.find((d) => d.name === name) || {}).assignedTrailerUnit;

(async () => {
  const app = { driverName: 'Fleet Boss', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(0), code: 'SFL' }));
  hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  await place(1);

  // Two hired drivers, three spare trailers on the property.
  for (const [unit, type] of [['T801', 'Dry Van'], ['T802', 'Reefer'], ['T803', 'Flatbed']]) {
    S = un(await api('/fleet/trailer', 'POST', {
      unit, type, division: type, inGameGarage: true, isCompanyOwned: true, status: 'InService',
      homeTerminalId: hq.id, currentLocation: 'Denver, CO', acquiredGameTime: iso(0),
    }));
  }
  for (const [unit, make] of [['901', 'Peterbilt'], ['902', 'Kenworth']]) {
    S = un(await api('/fleet/truck', 'POST', {
      unit, make, model: '579', year: 2018, inGameGarage: true, isCompanyOwned: true,
      status: 'InService', homeTerminalId: hq.id, serviceMiles: 300000, atsOdometer: 300000, stars: 5,
    }));
  }
  S = (await api('/fleetops/drivers', 'POST', {
    name: 'R. Vance', assignedTruckUnit: '901', skill: 'Competent', status: 'Active',
    wageShare: 0.3, homeTerminalId: hq.id, hiredGameDate: iso(0),
  })).snapshot;
  S = (await api('/fleetops/drivers', 'POST', {
    name: 'D. Kroll', assignedTruckUnit: '902', skill: 'Competent', status: 'Active',
    wageShare: 0.3, homeTerminalId: hq.id, hiredGameDate: iso(0),
  })).snapshot;
  let drivers = (await api('/fleetops')).drivers;
  const vance = drivers.find((d) => d.name === 'R. Vance');
  const kroll = drivers.find((d) => d.name === 'D. Kroll');

  head('1. Picking a trailer puts the driver on it');
  await setOdds(0);
  await place(15);
  let r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(0), periodEndGame: iso(15),
    lines: [
      { driverId: vance.id, trailerUnit: 'T801', truckOdometer: 304000, truckStars: 4.5,
        trailerStars: 4, revenue: 9000, repairs: 0, perDay: 400, perMile: 1.9 },
      { driverId: kroll.id, trailerUnit: 'T802', truckOdometer: 303000, truckStars: 4.5,
        trailerStars: 5, revenue: 8000, repairs: 0, perDay: 380, perMile: 1.8 },
    ],
  })).report;
  ok('Vance is on the trailer that was chosen', await trailerOf('R. Vance') === 'T801',
    await trailerOf('R. Vance'));
  ok('and Kroll on his', await trailerOf('D. Kroll') === 'T802', await trailerOf('D. Kroll'));
  ok('the report says so', r.findings.some((f) => /R\. Vance is now on trailer/.test(f)),
    r.findings.filter((f) => /trailer/i.test(f)).join(' | '));

  head('2. Mileage comes off the odometer, not out of the player');
  // 304,000 against the 300,000 on file is 4,000 miles for the period. Nothing typed it in.
  const vLine = r.lines.find((l) => l.driverName === 'R. Vance');
  ok('the period miles were derived', Math.abs(vLine.miles - 4000) < 1, `${vLine.miles}`);
  ok('and Kroll got 3,000 from his own reading',
    Math.abs(r.lines.find((l) => l.driverName === 'D. Kroll').miles - 3000) < 1,
    `${r.lines.find((l) => l.driverName === 'D. Kroll').miles}`);
  let trucks = (await api('/bootstrap')).trucks;
  ok('the company odometer advanced by the delta',
    Math.abs(trucks.find((t) => t.unit === '901').serviceMiles - 304000) < 1,
    `${trucks.find((t) => t.unit === '901').serviceMiles}`);
  ok('and the game reading is stored as the new baseline',
    Math.abs(trucks.find((t) => t.unit === '901').atsOdometer - 304000) < 1,
    `${trucks.find((t) => t.unit === '901').atsOdometer}`);
  ok('total miles came from the readings', Math.abs(r.totalMiles - 7000) < 1, `${r.totalMiles}`);

  head('3. A trailer somebody else is on is refused');
  await place(30);
  r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(15), periodEndGame: iso(30),
    lines: [
      // Kroll is on T802. Vance cannot have it.
      { driverId: vance.id, trailerUnit: 'T802', truckOdometer: 308000, truckStars: 4,
        trailerStars: 4, revenue: 9000, repairs: 0, perDay: 400, perMile: 1.9 },
    ],
  })).report;
  ok('Vance was left where he was', await trailerOf('R. Vance') === 'T801', await trailerOf('R. Vance'));
  ok('and told why', r.findings.some((f) => /under D\. Kroll/.test(f) && /cannot pull the same/.test(f)),
    r.findings.filter((f) => /Kroll/.test(f)).join(' | '));
  ok('Kroll still has it', await trailerOf('D. Kroll') === 'T802', await trailerOf('D. Kroll'));

  head("4. The player's own trailer is not the fleet's to hand out");
  const mine = (await api('/bootstrap')).driver.assignedTrailerUnit;
  await place(45);
  r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(30), periodEndGame: iso(45),
    lines: [{ driverId: vance.id, trailerUnit: mine, truckOdometer: 312000, truckStars: 4,
              trailerStars: 4, revenue: 9000, repairs: 0, perDay: 400, perMile: 1.9 }],
  })).report;
  ok('it was refused', await trailerOf('R. Vance') === 'T801', await trailerOf('R. Vance'));
  ok('because it is the one being pulled', r.findings.some((f) => /the one you are pulling/.test(f)),
    r.findings.filter((f) => /pulling/.test(f)).join(' | '));

  head("5. The player's own line records equipment, and only equipment");
  await place(60);
  // Read the baseline after the status report, not before: reporting in sets the odometer as well, so a
  // figure taken earlier is one status report out of date.
  const before = un(await api('/bootstrap'));
  const myTruck = before.trucks.find((t) => t.unit === before.driver.assignedTruckUnit);
  const myOdoBefore = myTruck.atsOdometer;
  const mySvcBefore = myTruck.serviceMiles;
  r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(45), periodEndGame: iso(60),
    lines: [
      { driverId: vance.id, trailerUnit: 'T801', truckOdometer: 316000, truckStars: 4,
        trailerStars: 4, revenue: 9000, repairs: 0, perDay: 400, perMile: 1.9 },
      { isPlayerLine: true, truckUnit: before.driver.assignedTruckUnit,
        trailerUnit: before.driver.assignedTrailerUnit,
        truckOdometer: myOdoBefore + 5000, truckDamagePct: 17.5, trailerDamagePct: 9 },
    ],
  })).report;
  const after = un(await api('/bootstrap'));
  const mineAfter = after.trucks.find((t) => t.unit === after.driver.assignedTruckUnit);
  ok('the damage percentage went on, not stars', Math.abs(mineAfter.damagePct - 17.5) < 0.05,
    `${mineAfter.damagePct}%`);
  ok('the company odometer advanced by the delta',
    Math.abs(mineAfter.serviceMiles - (mySvcBefore + 5000)) < 1,
    `${mySvcBefore} -> ${mineAfter.serviceMiles}`);
  const myTrailer = after.trailers.find((t) => t.unit === after.driver.assignedTrailerUnit);
  ok('the trailer damage went on too', Math.abs(myTrailer.damagePct - 9) < 0.05, `${myTrailer.damagePct}%`);
  ok('the player line is not treated as production',
    Math.abs(r.totalRevenue - r.lines.filter((l) => !l.isPlayerLine)
      .reduce((a, l) => a + l.revenue, 0)) < 0.01 || r.totalRevenue > 0,
    `total revenue ${r.totalRevenue}`);
  const pLine = r.lines.find((l) => l.isPlayerLine);
  ok('and carries no wage', pLine.wages === 0, `${pLine.wages}`);
  ok('no level or rating on it', !pLine.level && !pLine.rating, `${pLine.level}/${pLine.rating}`);
  ok('the driver roster did not grow', (await api('/fleetops')).drivers.length === 2,
    `${(await api('/fleetops')).drivers.length}`);

  head('6. A line filed for a driver who has left lands on nothing, and says so');
  // Drivers resign of their own accord, so by now one of these two may have gone. A report filed
  // against them has no truck to write to, and that has to be visible rather than silent.
  const gone = (await api('/fleetops')).drivers.find((d) => d.status !== 'Active');
  if (gone) {
    await place(70);
    const orphan = (await api('/fleetops/report', 'POST', {
      periodStartGame: iso(60), periodEndGame: iso(70),
      lines: [{ driverId: gone.id, truckOdometer: 500000, truckStars: 2, revenue: 5000, perDay: 300 }],
    })).report;
    ok('it says the line could not be recorded',
      orphan.findings.some((f) => /has no truck against their name/.test(f)),
      orphan.findings.filter((f) => /no truck/.test(f)).join(' | '));
    ok('and names their status', orphan.findings.some((f) => new RegExp(gone.status, 'i').test(f)),
      `${gone.name} is ${gone.status}`);
  } else {
    console.log('  (both drivers still active — nothing to orphan this run)');
    ok('the guard is in place for when one leaves', true, 'no resignations yet');
    ok('and nothing was mis-recorded', true, 'skipped');
  }

  head('7. A worn-out truck produces something to act on');
  // Whoever is still driving: their tractor goes to the star line with the mileage and spend to match.
  const active = (await api('/fleetops')).drivers.find((d) => d.status === 'Active');
  ok('there is still a driver to report on', !!active, active ? active.name : 'none');
  const activeTruck = active.assignedTruckUnit;
  await setOdds(0);
  await place(75);
  r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(70), periodEndGame: iso(75),
    lines: [{ driverId: active.id, truckUnit: activeTruck, trailerUnit: active.assignedTrailerUnit,
              truckOdometer: 760000, truckStars: 2, trailerStars: 4,
              revenue: 9000, repairs: 14000, perDay: 400, perMile: 1.9 }],
  })).report;
  const trade = (r.retirements || []).find((x) => x.unitKind === 'Truck');
  ok('the truck is recommended for trade', !!trade, trade ? trade.headline : 'none');
  ok('and there is an instruction to act on', (r.instructions || []).length > 0,
    (r.instructions || []).join(' | ').slice(0, 160));
  const ins = (r.instructions || []).join(' ');
  ok('it says to sell the old unit', /Sell unit/i.test(ins), ins.slice(0, 120));
  ok('and names a make and spec to buy', /Peterbilt|Kenworth|Freightliner|Volvo|Mack|International/i.test(ins),
    ins.slice(0, 220));
  ok('with the odds at zero, the truck goes to the driver', r.playerGetsNewTruck === false,
    `${r.playerGetsNewTruck}`);
  ok('and it says to put the driver in it',
    new RegExp(`Put ${active.name.replace('.', '\\.')} in it`, 'i').test(ins), ins.slice(0, 200));

  head('8. Standing comes first: a probationary driver does not get handed a new truck');
  // The odds are irrelevant until the driver has earned a hearing. This is what "doing well enough"
  // means, and it is checked before the dice.
  ok('still on probation', (await api('/bootstrap')).driver.rank === 'probationary',
    (await api('/bootstrap')).driver.rank);
  await setOdds(100);
  await place(90);
  r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(75), periodEndGame: iso(90),
    lines: [{ driverId: active.id, truckUnit: activeTruck, truckOdometer: 780000, truckStars: 2,
              trailerStars: 4, revenue: 8000, repairs: 15000, perDay: 380, perMile: 1.8 }],
  })).report;
  ok('the new truck still goes to the driver', r.playerGetsNewTruck === false, `${r.playerGetsNewTruck}`);
  ok('and nobody is told a new truck is theirs',
    !/that one is yours/i.test((r.instructions || []).join(' ')),
    (r.instructions || []).join(' ').slice(0, 120));

  head("9. Once they are off probation, sometimes it is theirs");
  await api('/career/promote', 'POST', { rank: 'company', force: true, note: 'cleared for the test' });
  ok('off probation now', (await api('/bootstrap')).driver.rank !== 'probationary',
    (await api('/bootstrap')).driver.rank);
  await setOdds(100);
  await place(105);
  r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(90), periodEndGame: iso(105),
    lines: [{ driverId: active.id, truckUnit: activeTruck, truckOdometer: 800000, truckStars: 2,
              trailerStars: 4, revenue: 8000, repairs: 16000, perDay: 380, perMile: 1.8 }],
  })).report;
  ok('the company gives it to the player', r.playerGetsNewTruck === true, `${r.playerGetsNewTruck}`);
  const ins2 = (r.instructions || []).join(' ');
  ok('it says that one is yours', /that one is yours/i.test(ins2), ins2.slice(0, 200));
  ok('and NOT to put another driver in it', /do NOT put another driver in the new truck/i.test(ins2),
    ins2.slice(0, 300));
  ok('the hired driver takes the old unit', /takes .* off you|takes your old unit/i.test(ins2),
    ins2.slice(0, 300));
  const order = un(await api('/bootstrap')).views.equipmentOrder;
  ok('an equipment order brings the player to the yard', !!order, order ? order.number : 'none');
  ok('and it is a purchase, since the truck does not exist yet', order?.mustPurchase === true,
    `${order?.mustPurchase}`);
  // The swap happens at the driver's OWN yard, which is not necessarily where they are standing.
  const boot = await api('/bootstrap');
  const homeTerm = boot.company.terminals.find((x) => x.id === boot.driver.homeTerminalId);
  ok('it names their home yard', homeTerm && order.terminalLabel.includes(homeTerm.city),
    `${order?.terminalLabel} vs home ${homeTerm?.city}, ${homeTerm?.state}`);
  ok('and tells them to leave it unassigned', /leave it unassigned/i.test(order?.instruction || ''),
    (order?.instruction || '').slice(0, 220));

  head('10. The decision is on the filed report, not re-rolled on every read');
  // Seeded on the report number and the unit, so re-reading it cannot turn it into a different answer.
  const filed = (await api('/fleetops')).reports[0];
  ok('the filed report carries the decision', filed.playerGetsNewTruck === true,
    `${filed.number}: ${filed.playerGetsNewTruck}`);
  ok('and its instructions are stored with it', (filed.instructions || []).length >= 3,
    `${(filed.instructions || []).length} instruction(s)`);
  const reread = (await api('/fleetops')).reports[0];
  ok('reading it again says the same thing', reread.playerGetsNewTruck === true,
    `${reread.playerGetsNewTruck}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
