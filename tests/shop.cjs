/* Issue #18: repairs take time, dispatch stops at 10%, and 40% writes the tractor off. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5566}/api`;
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
const gt = () => `2000-01-${String(day).padStart(2, '0')}T08:00`;

/** Park the driver somewhere with a given amount of damage on the equipment. */
let LAST_BRIEF = null;
async function stand({ city, state, truckDmg = 0, trailerDmg = 0, odo }) {
  // The status report carries the odometer through to the unit, so it has to be set here — setting it
  // on the truck and then reporting status would just overwrite it.
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Receiver', gameTime: gt(),
    fuelPct: 90, atsOdometer: odo ?? (5000 + day * 100), truckDamagePct: truckDmg, trailerDamagePct: trailerDmg,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  LAST_BRIEF = r.homeBrief || null;
  S = un(r);
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  return S;
}

async function board(dest, destState, miles = 400) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: dest, destState, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: miles * 3, deadlineHours: 60, weightLbs: 40000,
  });
}

const blockers = () => (S.views.dispatchBlockers || []).join(' | ');
const order = () => S.views.shopOrder || { kind: 'None' };

(async () => {
  const app = { driverName: 'Shop Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: gt() }));
  const m = S.settings.maintenance;
  console.log(`  thresholds: stop ${m.stopDispatchPct}% · total loss ${m.totalLossPct}% · run home under ${m.runHomeMaxDamagePct}% within ${m.runHomeMaxHours} h`);

  head('1. A repair is quoted in hours before it is committed to');
  // #138 A quote is an intake period plus labour by damage. Pure per-point labour put a 10% repair
  // under seven hours — a truck that is never booked in, never waiting on a part and never behind
  // anything else in the bay. The fixed part is why a small job still costs a day.
  const RATE = m.repairHoursPerPoint;
  const INTAKE = m.repairIntakeHours;
  const TRF = m.trailerRepairFactor;
  const expect = (truck, trailer) => INTAKE + Math.max(truck * RATE, trailer * RATE * TRF);

  let q = await api('/maintenance/quote?truck=15&trailer=0&companyShop=false');
  ok('a repair starts with a shop day before any labour', INTAKE >= 12, `${INTAKE} h intake`);
  ok('15 points is more than a day', q.waitHours >= 24, `${q.waitHours.toFixed(2)} h`);
  ok('and it is intake plus labour', Math.abs(q.waitHours - expect(15, 0)) < 0.2,
    `${q.waitHours.toFixed(2)} h vs ${expect(15, 0).toFixed(2)}`);
  ok('long enough to be worth routing home for', q.waitHours > 8);
  ok('the quote explains itself', q.lines.some((l) => /in the bay/.test(l)), q.lines[0]);

  q = await api('/maintenance/quote?truck=0&trailer=20&companyShop=false');
  ok('trailer LABOUR runs at a fraction of the tractor rate',
    Math.abs(q.waitHours - expect(0, 20)) < 0.2, `${q.waitHours.toFixed(2)} h for 20 pts`);
  ok('and a trailer is a much lighter job than a tractor', 20 * RATE * TRF < 20 * RATE * 0.5,
    `factor ${TRF}`);

  q = await api('/maintenance/quote?truck=18&trailer=18&companyShop=false');
  const tOnly = expect(18, 0);
  ok('both at once is the LONGER, not the sum', Math.abs(q.waitHours - tOnly) < 0.2,
    `${q.waitHours.toFixed(2)} h (tractor alone ${tOnly.toFixed(2)})`);
  ok('one intake covers the visit, not one per unit',
    q.waitHours < tOnly + INTAKE - 1,
    `${q.waitHours.toFixed(2)} h; a second intake would make it ${(tOnly + INTAKE).toFixed(2)}`);
  ok('and it says so', q.lines.some((l) => /longer of the two/.test(l)), q.lines.find((l) => /longer/.test(l)) || '(none)');

  const road = await api('/maintenance/quote?truck=20&trailer=0&companyShop=false');
  const yard = await api('/maintenance/quote?truck=20&trailer=0&companyShop=true');
  ok('a company shop is quicker than a dealer', yard.waitHours < road.waitHours,
    `yard ${yard.waitHours.toFixed(2)} h vs road ${road.waitHours.toFixed(2)} h`);

  head('2. #136 At 13% it goes home, however far that is');
  // This used to be the nearest shop. 13% is not catastrophic, our labour is cheaper, and the thing
  // that makes it worse is more miles hunting a dealer — so between the run-home line and the review
  // line it goes home at any distance.
  await stand({ city: 'Seattle', state: 'WA', truckDmg: 13 });
  ok('an order was raised', order().kind !== 'None', order().kind);
  ok('it is a run-home order', order().kind === 'RunHome', order().headline?.slice(0, 80));
  ok('and it does not pretend home is close',
    /further than a day|you are going anyway/.test(order().instructions.join(' ')),
    order().instructions.find((x) => /further than a day/.test(x))?.slice(0, 90) || '(none)');
  ok('freight is not stopped outright', order().blocksAllFreight === false, `${order().blocksAllFreight}`);

  head('2b. #136 Past the review line it is the nearest shop, as 10% used to be');
  await stand({ city: 'Seattle', state: 'WA', truckDmg: 17 });
  ok('nearest shop, not home', order().kind === 'Shop', order().headline?.slice(0, 80));
  ok('it says how far home is and why not',
    /Too far|more than a day|too far to nurse/.test(order().instructions.join(' ')),
    order().instructions.find((x) => /too far/i.test(x))?.slice(0, 90) || '(none)');
  ok('dispatch is blocked', blockers().includes(order().headline), blockers().slice(0, 120));

  await board('Portland', 'OR');
  let d = await api('/board/evaluate');
  ok('the board is rejected outright', d.rejectAll === true, d.headline);

  head('3. Inside a day of home and under 20% — run it home instead');
  day = 4;
  await stand({ city: 'Colorado Springs', state: 'CO', truckDmg: 13 });
  ok('the order is to run home', order().kind === 'RunHome', `${order().kind}: ${order().headline}`);
  ok('it names the yard', /Denver/.test(order().headline), order().headline);
  const ins = order().instructions.join(' ');
  ok('says why home beats the nearest dealer', /Cheaper labour/.test(ins), order().instructions[0]);
  ok('the repair counts as home time', /counts as your home time/.test(ins));
  ok('and the clock on the next one starts over', /starts over from here/.test(ins));
  ok('the 34 is spelled out, not implied', /restart while you are there/.test(ins),
    order().instructions.find((x) => /restart/.test(x)) || '(none)');
  ok('it asks for the board first', /Show me the board/.test(ins),
    order().instructions.find((x) => /board/.test(x)) || '(none)');

  head('4. A run-home order does NOT stop freight — it filters it');
  await board('Denver', 'CO', 70);
  d = await api('/board/evaluate');
  ok('a load home IS authorized', d.rejectAll === false && !!d.authorizedLoadId, d.headline);
  ok('and it says this is the run to the shop', d.dispatchNotes.some((n) => /run to the shop/.test(n)),
    d.dispatchNotes.find((n) => /shop/.test(n)) || '(none)');

  await board('Phoenix', 'AZ', 600);
  d = await api('/board/evaluate');
  ok('a load the wrong way is refused', d.rejectAll === true, d.headline);
  ok('and it tells them to deadhead in', /Run it in empty/.test(d.headline), d.headline);
  ok('not "reposition and pull a fresh board"', !/[Rr]eposition/.test(d.dispatchNotes.join(' ')));
  ok('the refusal reason is the damage, not the rate',
    /Not while the truck is at/.test((d.evaluations[0].hardFails || []).join(' ')),
    (d.evaluations[0].hardFails || [])[0] || '(none)');

  head('5. Too damaged to gamble a day on it — nearest shop even near home');
  await stand({ city: 'Colorado Springs', state: 'CO', truckDmg: 24 });
  ok('nearest shop, not home', order().kind === 'Shop', `${order().kind}: ${order().headline}`);
  ok('and it says why', /not gambling another day/.test(order().instructions.join(' ')),
    order().instructions[0]);

  head('6. Arriving home under a repair order says what home time means');
  day = 8;
  await stand({ city: 'Denver', state: 'CO', truckDmg: 13 });
  const brief = LAST_BRIEF || { shop: [] };
  ok('reporting in at the yard produced an arrival brief', !!LAST_BRIEF);
  const shop = (brief.shop || []).join(' ');
  ok('the brief quotes the shop time', /in the shop/.test(shop), (brief.shop || []).find((x) => /shop/.test(x)) || '(none)');
  ok('says it counts as home time', /counts as your home time/.test(shop));
  ok('and to sit the restart', /restart while you are here/.test(shop),
    (brief.shop || []).find((x) => /restart/.test(x)) || '(none)');

  head('7. Forty percent is a write-off, not a repair');
  await stand({ city: 'Denver', state: 'CO', truckDmg: 44 });
  ok('the order is a total loss', order().kind === 'TotalLoss', `${order().kind}: ${order().headline}`);
  ok('the quote refuses to price it', order().quote.totalLoss === true);
  ok('it asks for the scrap figure rather than inventing one',
    /tell me what it fetched/.test(order().instructions.join(' ')),
    order().instructions.find((x) => /scrap/.test(x)) || '(none)');

  const unit = S.driver.assignedTruckUnit;
  const cashBefore = S.views.finance.netPosition;
  const w = await api('/maintenance/writeoff', 'POST',
    { unit, driverFault: false, scrapRecovery: 4000, notes: '' });
  S = w.snapshot;
  const r = w.writeOff;
  ok('insurance settled against the unit value', r.insurancePayout > 0, money(r.insurancePayout));
  ok('a deductible came off', r.deductible > 0, money(r.deductible));
  ok('the reported scrap is booked, not guessed', r.scrapRecovery === 4000, money(r.scrapRecovery));
  ok('net is settlement less deductible plus scrap',
    Math.abs(r.netRecovery - (r.insurancePayout - r.deductible + 4000)) < 0.01, money(r.netRecovery));
  ok('a replacement is named', /Volvo|Freightliner|Kenworth|Peterbilt|International|Mack|Western Star/.test(r.replacementSpec),
    r.replacementSpec.slice(0, 90));
  ok('the driver is told to restart at the home terminal',
    /start again out of/.test(r.instructions.join(' ')),
    r.instructions.find((x) => /start again/.test(x)) || '(none)');
  ok('the unit is off the fleet', S.trucks.find((t) => t.unit === unit).status === 'Retired');
  ok('and the seat is empty until a replacement is reported', S.driver.assignedTruckUnit === '',
    `"${S.driver.assignedTruckUnit}"`);
  ok('dispatch now stops for no truck', blockers().includes('No truck assigned'), blockers().slice(0, 90));
  ok('the money moved', (S.views.finance.netPosition) !== cashBefore,
    `${cashBefore} → ${S.views.finance.netPosition}`);

  head('8. Driver-fault costs the higher deductible');
  const app2 = { ...app, driverName: 'Fault Tester' };
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  await api('/onboarding/market', 'POST', app2);
  S = un(await api('/onboarding/hire', 'POST', { application: app2, force: true, gameTime: '2000-01-01T08:00' }));
  const u2 = S.driver.assignedTruckUnit;
  await stand({ city: 'Denver', state: 'CO', truckDmg: 44 });
  const w2 = await api('/maintenance/writeoff', 'POST', { unit: u2, driverFault: true, scrapRecovery: 0, notes: '' });
  ok('driver-fault doubles the deductible', w2.writeOff.deductible === r.deductible * 2,
    `${money(w2.writeOff.deductible)} vs ${money(r.deductible)} no-fault`);
  ok('and it says why the deductible is higher', /down to the driver/.test(w2.writeOff.instructions.join(' ')),
    w2.writeOff.instructions.find((x) => /deductible/.test(x)) || '(none)');
  ok('with no scrap reported it asks for it', /Sell the wreck/.test(w2.writeOff.instructions.join(' ')));

  head('9. The write-off line falls with the odometer');
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T08:00' }));
  const u3 = S.driver.assignedTruckUnit;

  /**
   * Put mileage on the COMPANY's odometer and read back the line the unit is held to.
   *
   * Deliberately not the game reading: the odometer cannot be set in ATS, so a unit the books call
   * worn out may read almost nothing in game. The write-off has to judge on our own figure.
   */
  async function lineAt(miles, dmg = 0) {
    const tk = S.trucks.find((t) => t.unit === u3);
    S = un(await api('/fleet/truck', 'POST', { ...tk, serviceMiles: miles }));
    await stand({ city: 'Denver', state: 'CO', truckDmg: dmg });
    return (S.views.writeOffLines || []).find((l) => l.unit === u3);
  }

  const fresh = await lineAt(60000);
  const mid = await lineAt(400000);
  const worn = await lineAt(600000);
  const dead = await lineAt(2000000);

  ok('a 60k truck is worth fixing near the full line', fresh.atPct > 37, `${fresh.atPct}% at ${num0(fresh.miles)} mi`);
  ok('400k pulls it well down', mid.atPct < fresh.atPct - 8, `${mid.atPct}% at ${num0(mid.miles)} mi`);
  ok('600k lower still', worn.atPct < mid.atPct, `${worn.atPct}% at ${num0(worn.miles)} mi`);
  ok('it never falls below the floor', dead.atPct >= S.settings.maintenance.writeOffFloorPct,
    `${dead.atPct}% floor ${S.settings.maintenance.writeOffFloorPct}%`);
  ok('and it explains itself in miles', /mi on it/.test(worn.explain), worn.explain);

  head('10. The same damage is a repair on a new truck and a write-off on an old one');
  await lineAt(60000, 26);
  ok('26% on a 60k truck is still a repair', order().kind !== 'TotalLoss', `${order().kind}: ${order().headline}`);

  await lineAt(600000, 26);
  ok('the SAME 26% on a 600k truck is a write-off', order().kind === 'TotalLoss', `${order().kind}: ${order().headline}`);
  ok('and it says the mileage is why', /mi on it/.test(order().instructions.join(' ')),
    order().instructions[0]);

  head('11. A clean truck raises nothing');
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T08:00' }));
  await stand({ city: 'Denver', state: 'CO', truckDmg: 4 });
  ok('no shop order under the threshold', order().kind === 'None', order().kind);
  ok('nothing blocking dispatch on condition', !/damage|shop|Shop/.test(blockers()), blockers() || '(clear)');

  function money(n) { return '$' + (+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num0(n) { return (+n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
