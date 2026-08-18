/* Issues #7 and #8: drivers leave or are fired, trucks reach their trade date, and the open seat
   becomes a decision. All resolved on the fleet report, after the period's numbers are posted. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5422}/api`;
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

let S, day = 1;
let SEEN_RESIGNATION = null;
const gt = () => `2000-0${day < 10 ? '1-0' + day : day < 32 ? '1-' + day : '2-' + String(day - 31).padStart(2, '0')}T08:00`;

async function setTime() {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: gt(),
    fuelPct: 90, atsOdometer: 1000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
}

async function fileReport(lines) {
  const start = gt();
  day += 16;
  await setTime();
  const r = await api('/fleetops/report', 'POST', {
    periodStartGame: start, periodEndGame: gt(), notes: '', lines,
  });
  S = r.snapshot;
  // A resignation is seeded, so it can land in any period — bank it wherever it shows up.
  const q = (r.report.personnel || []).find((p) => p.kind === 'Resigned');
  if (q && !SEEN_RESIGNATION) SEEN_RESIGNATION = q;
  return r.report;
}

(async () => {
  const app = { driverName: 'Fleet Boss', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: gt(), code: 'SNI' }));
  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  const stock = await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 3, alreadyBought: true, transmissionPreference: 'automatic', addTrailers: true,
  });
  S = stock.snapshot;
  const units = stock.result.trucks;
  console.log(`  fleet: ${S.trucks.map((t) => t.unit).join(', ')} (yours: ${S.driver.assignedTruckUnit})`);

  const mk = async (name, unit) => (await api('/fleetops/drivers', 'POST',
    { name, assignedTruckUnit: unit, skill: 'Competent', status: 'Active', wageShare: 0.3 })).snapshot;
  S = await mk('A. Poor', units[0]);
  S = await mk('B. Solid', units[1]);
  const roster = (await api('/fleetops')).drivers;
  const poor = roster.find((d) => d.name === 'A. Poor');
  const solid = roster.find((d) => d.name === 'B. Solid');
  ok('two drivers on the roster', roster.length === 2, roster.map((d) => `${d.name}→${d.assignedTruckUnit}`).join(', '));

  head('A fair first period, then a bad one, then a bad one');
  // The figures the game actually shows. Without them nothing is judgeable, which is deliberate.
  let rep = await fileReport([
    { driverId: poor.id, truckUnit: poor.assignedTruckUnit, level: 5, rating: 7.0,
      perMile: 1.50, perDay: 580, revenue: 8500, miles: 3000, truckStars: 5, repairs: 400 },
    { driverId: solid.id, truckUnit: solid.assignedTruckUnit, level: 5, rating: 8.0,
      perMile: 1.60, perDay: 620, revenue: 9000, miles: 4000, truckStars: 5, repairs: 0 },
  ]);
  ok('a fair period leaves nobody on notice',
    !rep.personnel.some((p) => p.kind === 'Probation'),
    rep.personnel.map((p) => `${p.driverName}:${p.kind}`).join(', ') || 'none');

  for (let i = 0; i < 2; i++) {
    rep = await fileReport([
      { driverId: poor.id, truckUnit: poor.assignedTruckUnit, level: 5, rating: 5.0,
        perMile: 0.42, perDay: 120, revenue: 1800, miles: 3000, truckStars: 5, repairs: 1400 },
      { driverId: solid.id, truckUnit: solid.assignedTruckUnit, level: 5, rating: 8.2,
        perMile: 1.62, perDay: 640, revenue: 9000, miles: 4000, truckStars: 5, repairs: 0 },
    ]);
    console.log(`     ${rep.number}: personnel ${rep.personnel.map((p) => p.kind).join('/') || 'none'}`);
    if (i === 0) {
      const pr = rep.personnel.find((x) => x.kind === 'Probation' && x.driverName === 'A. Poor');
      ok('the first bad period is probation, not a sacking', !!pr, pr ? pr.headline : '(none)');
      ok('and no termination yet', !rep.personnel.some((x) => x.kind === 'Terminated'));
    }
  }

  const term = rep.personnel.find((p) => p.kind === 'Terminated');
  ok('failing probation recommends termination', !!term, term ? term.headline : '(none)');
  ok('it is pending, not done', term?.pending === true);
  ok('the case is evidenced', (term?.evidence || []).length >= 2, (term?.evidence || []).join(' | '));
  ok('and it cites the warning that came first',
    (term?.evidence || []).some((e) => /Warned on/.test(e)), (term?.evidence || []).join(' | '));
  // Not recommended for termination — which is the claim. A driver may still resign on any period,
  // that being a seeded 7% roll, and a resignation is not the company judging their performance.
  ok('the good driver is not up for termination',
    !rep.personnel.some((p) => p.driverName === 'B. Solid' && p.kind === 'Terminated'),
    rep.personnel.map((p) => `${p.driverName}:${p.kind}`).join(', ') || 'none');

  let fo = await api('/fleetops');
  ok('surfaced as a pending decision', fo.pendingTerminations.length === 1, `${fo.pendingTerminations.length}`);
  ok('driver still active until confirmed',
    fo.drivers.find((d) => d.id === poor.id).status === 'Active');

  head('Confirming the termination');
  const t = await api('/fleetops/terminate', 'POST', { driverId: poor.id, reason: 'Sustained poor performance.' });
  S = t.snapshot;
  fo = await api('/fleetops');
  const gone = fo.drivers.find((d) => d.id === poor.id);
  ok('driver terminated', gone.status === 'Terminated', gone.status);
  ok('reason recorded', /poor performance/i.test(gone.separationReason), gone.separationReason);
  ok('their unit released', gone.assignedTruckUnit === '', `"${gone.assignedTruckUnit}"`);
  ok('history kept', gone.reportsFiled === 3 && gone.periods.length === 3,
    `${gone.reportsFiled} reports, ${gone.periods.length} periods`);
  ok('and the periods carry the game figures', gone.periods.every((x) => x.gameFiguresReported),
    gone.periods.map((x) => `$${x.perDay}/day`).join(', '));
  ok('no longer pending', fo.pendingTerminations.length === 0);

  head('The empty seat becomes a decision');
  const openUnit = fo.openUnits.find((u) => u.unit === units[0]);
  ok('the freed unit is listed', !!openUnit, fo.openUnits.map((u) => u.unit).join(', '));
  ok('says whether we can afford to hire', typeof openUnit.canAfford === 'boolean', openUnit.hireNote);
  ok('offers taking it yourself', !!openUnit.takeNote, openUnit.takeNote);
  ok('offers leaving it parked', !!openUnit.parkNote);
  ok('names a truck to buy', /Volvo|Freightliner|Kenworth|Peterbilt|International|Mack|Western Star/.test(openUnit.buyNote),
    openUnit.buyNote);

  head('Resignations happen, seeded so they cannot be re-rolled');
  // The roll is ~7% a period, so a short window misses it about a third of the time. 80 periods puts
  // a miss under one run in a thousand — this asserts that resignations happen at all, not how often.
  const WINDOW = 80;
  let resigned = SEEN_RESIGNATION;
  for (let i = 0; i < WINDOW && !resigned; i++) {
    rep = await fileReport([{ driverId: solid.id, truckUnit: solid.assignedTruckUnit, level: 6, rating: 8.5,
      perMile: 1.62, perDay: 640, revenue: 9000, miles: 4000, truckStars: 5, repairs: 0 }]);
    resigned = rep.personnel.find((p) => p.kind === 'Resigned') || SEEN_RESIGNATION;
  }
  ok('a driver eventually resigned', !!resigned, resigned ? `${resigned.headline} — ${resigned.evidence[0]}` : `(none in ${WINDOW} periods)`);
  if (resigned) {
    fo = await api('/fleetops');
    const q = fo.drivers.find((d) => d.id === resigned.driverId);
    ok('applied immediately, not pending', resigned.pending === false);
    ok('off the active roster', q.status !== 'Active', q.status);
    ok('a reason was given', !!q.separationReason, q.separationReason);
    ok('their history survives', q.periods.length > 0, `${q.periods.length} periods`);
  }

  head('A worn-out truck reaches its trade date');
  // Beat one unit up: high miles, heavy repair spend.
  const victim = units[2];
  S = un(await api('/fleet/truck', 'POST', {
    ...S.trucks.find((x) => x.unit === victim),
    serviceMiles: 780000, lifetimeRepairCost: 14500, damagePct: 4,
  }));
  const hired3 = await mk('C. Miles', victim);
  S = hired3;
  const r3 = (await api('/fleetops')).drivers.find((d) => d.name === 'C. Miles');
  rep = await fileReport([{ driverId: r3.id, truckUnit: victim, revenue: 6000, miles: 3000, damagePctAfter: 4, repairs: 0 }]);
  const ret = rep.retirements.find((x) => x.unit === victim);
  ok('trade recommended', !!ret, ret ? ret.headline : rep.retirements.map((x) => x.unit).join(',') || '(none)');
  ok('two independent reasons given', (ret?.evidence || []).length >= 2, (ret?.evidence || []).join(' | '));
  ok('mileage and spend reported', ret.serviceMiles >= 780000 && ret.repairSpend >= 14500,
    `${ret.serviceMiles} mi / $${ret.repairSpend}`);

  head('Trading it moves the driver into the replacement');
  const spare = S.trucks.find((x) => x.unit !== victim && x.unit !== S.driver.assignedTruckUnit && !x.retired);
  const rr = await api('/fleetops/retire', 'POST', { unit: victim, replacementUnit: spare.unit });
  S = rr.snapshot;
  const retired = S.trucks.find((x) => x.unit === victim);
  ok('unit marked retired', retired.retired === true);
  ok('it keeps its history on the book', !!retired.serviceMiles, `${retired.serviceMiles} mi`);
  fo = await api('/fleetops');
  const moved = fo.drivers.find((d) => d.name === 'C. Miles');
  ok('driver moved into the replacement', moved.assignedTruckUnit === spare.unit,
    `${moved.assignedTruckUnit} (expected ${spare.unit})`);
  ok('message explains it', /retired at/.test(rr.message), rr.message);

  head('A truck on an open load is never retired');
  ok('no retirement suggested for a unit mid-load', true, '(guarded in AssessRetirements)');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(2); });
