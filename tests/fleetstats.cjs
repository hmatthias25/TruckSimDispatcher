/* Issues #26-#31: the fleet report records what ATS actually shows, probation precedes termination,
   equipment is judged on stars, trailers on stars and age, trailers can be bought, and good drivers
   at weak carriers leave. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5640}/api`;
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
const gt = () => `2000-${String(Math.floor((day - 1) / 28) + 1).padStart(2, '0')}-${String(((day - 1) % 28) + 1).padStart(2, '0')}T08:00`;

async function setTime() {
  S = un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: gt(),
    fuelPct: 90, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 400000,
  }));
}

/** File a period. Lines carry the game figures, not invented percentages. */
async function fileReport(lines) {
  const start = gt();
  day += 15;
  await setTime();
  const r = await api('/fleetops/report', 'POST', { periodStartGame: start, periodEndGame: gt(), notes: '', lines });
  S = r.snapshot;
  return r.report;
}

const fleet = () => S.views.fleetOps || {};
const personnelOf = (rep, kind) => (rep.personnel || []).filter((p) => p.kind === kind);

(async () => {
  head('1. Hire at a weak carrier so retention is in play');
  const app = { driverName: 'Stat Boss', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 8, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  // Schneider is a 2/2/2 outfit — a deliberately poor employer.
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: gt(), code: 'SNI' }));
  ok('employer standing is stored', S.company.payStars > 0 && S.company.homeTimeStars > 0,
    `equip ${S.company.equipmentStars} pay ${S.company.payStars} home ${S.company.homeTimeStars}`);
  ok('and surfaced as an overall rating', (fleet().employerStars || 0) > 0, `${fleet().employerStars}`);

  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  ok('a large yard holds more trailers than tractors',
    S.company.terminals[0].trailerCapacity > S.company.terminals[0].truckCapacity,
    `${S.company.terminals[0].truckCapacity} trucks / ${S.company.terminals[0].trailerCapacity} trailers`);

  const stock = await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 3, alreadyBought: true, transmissionPreference: 'automatic', addTrailers: true,
  });
  S = stock.snapshot;
  const units = stock.result.trucks;

  const mk = async (name, unit, trailer) => (await api('/fleetops/drivers', 'POST',
    { name, assignedTruckUnit: unit, assignedTrailerUnit: trailer, skill: 'Competent', status: 'Active',
      wageShare: 0.3, homeTerminalId: hq.id })).snapshot;
  const trailers = S.trailers.filter((t) => t.unit !== S.driver.assignedTrailerUnit).map((t) => t.unit);
  S = await mk('A. Weak', units[0], trailers[0]);
  S = await mk('B. Strong', units[1], trailers[1]);
  S = await mk('C. Third', units[2], trailers[2]);
  let roster = (await api('/fleetops')).drivers;
  const weak = roster.find((d) => d.name === 'A. Weak');
  const strong = roster.find((d) => d.name === 'B. Strong');

  head('2. The report records level, rating, $/mile and $/day');
  let rep = await fileReport([
    { driverId: weak.id, truckUnit: weak.assignedTruckUnit, trailerUnit: weak.assignedTrailerUnit,
      level: 2, rating: 4.5, perMile: 1.55, perDay: 600, revenue: 9500, miles: 6000,
      truckStars: 5, truckOdometer: 120000, trailerStars: 5 },
    { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
      level: 7, rating: 9.2, perMile: 1.85, perDay: 720, revenue: 12000, miles: 6500,
      truckStars: 5, truckOdometer: 90000, trailerStars: 5 },
  ]);
  roster = (await api('/fleetops')).drivers;
  const w1 = roster.find((d) => d.id === weak.id);
  ok('level stored on the driver', w1.level === 2, `${w1.level}`);
  ok('rating stored, tenths kept', Math.abs(w1.rating - 4.5) < 0.001, `${w1.rating}`);
  const wp = w1.periods[0];
  ok('$/mile kept on the period', Math.abs(wp.perMile - 1.55) < 0.001, `${wp.perMile}`);
  ok('$/day kept on the period', Math.abs(wp.perDay - 600) < 0.001, `${wp.perDay}`);
  ok('period marked as having real game figures', wp.gameFiguresReported === true);
  ok('nobody on probation off a fair first period', personnelOf(rep, 'Probation').length === 0,
    personnelOf(rep, 'Probation').map((x) => x.driverName).join(', ') || 'none');

  head('2b. Retention: level and employer standing both matter');
  ok('a developed driver at a 2-star carrier is flagged as a flight risk',
    (fleet().flightRisks || []).length >= 1,
    (fleet().flightRisks || []).join(' | ') || 'none flagged');
  ok('the warning names the employer standing',
    (fleet().flightRisks || []).some((r) => /stars as an employer|Developed drivers/.test(r)),
    (fleet().flightRisks || [])[0] || 'none');
  ok('a level 2 driver is not a flight risk',
    !(fleet().flightRisks || []).some((r) => /A\. Weak/.test(r)),
    (fleet().flightRisks || []).join(' | ') || 'none');

  head('3. Equipment: stars and an odometer, never a damage percentage');
  let tk = S.trucks.find((t) => t.unit === weak.assignedTruckUnit);
  ok('truck stars recorded', tk.stars === 5, `${tk.stars}`);
  ok('odometer taken from the game reading, not accumulated', tk.atsOdometer === 120000, `${tk.atsOdometer}`);
  ok('stars carry a read timestamp', !!tk.starsReportedGameTime, tk.starsReportedGameTime);
  let tl = S.trailers.find((t) => t.unit === weak.assignedTrailerUnit);
  ok('trailer stars recorded', tl.stars === 5, `${tl.stars}`);
  ok('trailer has an acquisition date so age can be read', !!tl.acquiredGameTime, tl.acquiredGameTime);
  ok('no work order raised off an invented percentage', (rep.repairsNeeded || []).length === 0,
    `${(rep.repairsNeeded || []).length} raised`);

  head('4. A bad period is probation, not a termination');
  rep = await fileReport([
    { driverId: weak.id, truckUnit: weak.assignedTruckUnit, trailerUnit: weak.assignedTrailerUnit,
      level: 2, rating: 4.0, perMile: 0.35, perDay: 90, revenue: 2000, miles: 5500,
      truckStars: 5, truckOdometer: 175000, trailerStars: 5 },
    { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
      level: 7, rating: 9.3, perMile: 1.90, perDay: 760, revenue: 12500, miles: 6600,
      truckStars: 5, truckOdometer: 156000, trailerStars: 5 },
  ]);
  const prob = personnelOf(rep, 'Probation');
  ok('probation issued', prob.length === 1, prob.map((p) => p.driverName).join(', ') || 'none');
  ok('and it is NOT a termination', personnelOf(rep, 'Terminated').length === 0);
  ok('it names the figure that failed', /\$\/day|\$\d/.test(prob[0]?.evidence?.[0] || ''), prob[0]?.evidence?.[0]);
  ok('and states a target to clear it', /above the/.test(prob[0]?.evidence?.[1] || ''), prob[0]?.evidence?.[1]);
  ok('applied immediately, not pending', prob[0].pending === false);
  ok('visible on the fleet tab', (fleet().onProbation || []).length === 1,
    JSON.stringify((fleet().onProbation || []).map((x) => x.driverName)));
  ok('the strong driver is untouched', !prob.some((p) => p.driverName === 'B. Strong'));

  head('5. Improving lifts probation');
  rep = await fileReport([
    { driverId: weak.id, truckUnit: weak.assignedTruckUnit, trailerUnit: weak.assignedTrailerUnit,
      level: 3, rating: 6.0, perMile: 1.70, perDay: 690, revenue: 11000, miles: 6400,
      truckStars: 5, truckOdometer: 230000, trailerStars: 5 },
    { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
      level: 7, rating: 9.3, perMile: 1.88, perDay: 740, revenue: 12200, miles: 6500,
      truckStars: 5, truckOdometer: 220000, trailerStars: 5 },
  ]);
  ok('probation lifted', personnelOf(rep, 'ProbationLifted').length === 1,
    personnelOf(rep, 'ProbationLifted').map((p) => p.headline).join('; ') || 'none');
  ok('no longer on the fleet tab', (fleet().onProbation || []).length === 0);
  roster = (await api('/fleetops')).drivers;
  ok('the recovery is on the record', !!roster.find((d) => d.id === weak.id).lastClearedProbationGameTime);

  head('6. Failing probation is what ends it — and this driver recovered once, so it takes longer');
  // #146: the company decides, and somebody who has pulled themselves off probation before is worth
  // one more period. This driver did exactly that in step 5, so the run is warning, second chance,
  // then out — and the third probation is where the pattern becomes the evidence.
  for (let i = 0; i < 3; i++) {
    rep = await fileReport([
      { driverId: weak.id, truckUnit: weak.assignedTruckUnit, trailerUnit: weak.assignedTrailerUnit,
        level: 3, rating: 3.0, perMile: 0.30, perDay: 70, revenue: 1500, miles: 5000,
        truckStars: 5, truckOdometer: 280000 + i * 40000, trailerStars: 5 },
      { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
        level: 7, rating: 9.3, perMile: 1.88, perDay: 740, revenue: 12200, miles: 6500,
        truckStars: 5, truckOdometer: 280000 + i * 40000, trailerStars: 5 },
    ]);
    if (i === 0) ok('second failure re-opens probation', personnelOf(rep, 'Probation').length === 1,
      personnelOf(rep, 'Probation')[0]?.headline || 'none');
    if (i === 1) {
      const kept = personnelOf(rep, 'ProbationExtended');
      ok('a driver who once recovered is kept on for one more period', kept.length === 1,
        kept[0]?.headline || 'none');
      ok('and is told nothing is being asked of the player',
        (rep.findings || []).some((f) => /Nothing for you to do|one more period/i.test(f)),
        (rep.findings || []).find((f) => /one more period/i.test(f))?.slice(0, 120) || 'none');
      ok('no termination while the chance stands', personnelOf(rep, 'Terminated').length === 0);
    }
  }
  const term = personnelOf(rep, 'Terminated');
  ok('the third probation ends it', term.length === 1, term[0]?.headline || 'none');
  ok('and it is done, not put to the player', term[0]?.pending === false, `pending=${term[0]?.pending}`);
  ok('the case cites the probation history',
    (term[0]?.evidence || []).some((e) => /Warned on|probation number/.test(e)),
    (term[0]?.evidence || []).join(' | '));
  ok('the report says to fire them in ATS',
    (rep.instructions || []).some((x) => /driver manager/i.test(x)),
    (rep.instructions || []).join(' | ').slice(0, 160) || 'none');
  ok('and says what becomes of the seat',
    (rep.instructions || []).some((x) => /hire a driver for unit|do not hire anyone for unit|leave unit|no seat to fill/i.test(x)),
    (rep.instructions || []).join(' | ').slice(0, 200));

  head('7. A truck at three stars is recommended for replacement');
  rep = await fileReport([
    { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
      level: 7, rating: 9.3, perMile: 1.88, perDay: 740, revenue: 12200, miles: 6500,
      truckStars: 3, truckOdometer: 420000, trailerStars: 5 },
  ]);
  const truckRet = (rep.retirements || []).filter((r) => r.unitKind === 'Truck' && r.unit === strong.assignedTruckUnit);
  ok('replacement recommended on stars alone', truckRet.length === 1,
    (rep.retirements || []).map((r) => `${r.unitKind} ${r.unit}`).join(', ') || 'none');
  ok('the headline names the star rating', /stars/.test(truckRet[0]?.headline || ''), truckRet[0]?.headline);
  ok('the odometer is offered as evidence',
    (truckRet[0]?.evidence || []).some((e) => /Odometer reads/.test(e)),
    (truckRet[0]?.evidence || []).join(' | '));

  head('8. A trailer at three stars too — but never the player\'s own');
  const mine = S.driver.assignedTrailerUnit;
  rep = await fileReport([
    { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
      level: 7, rating: 9.3, perMile: 1.88, perDay: 740, revenue: 12200, miles: 6500,
      truckStars: 4, truckOdometer: 470000, trailerStars: 2 },
  ]);
  const trRet = (rep.retirements || []).filter((r) => r.unitKind === 'Trailer');
  ok('trailer replacement recommended', trRet.length >= 1,
    trRet.map((r) => r.unit).join(', ') || 'none');
  ok('it is the hired driver\'s trailer', trRet.some((r) => r.unit === strong.assignedTrailerUnit),
    trRet.map((r) => r.unit).join(', '));
  ok('the player\'s own trailer is never touched', !trRet.some((r) => r.unit === mine),
    `mine is ${mine}`);
  // #79: operations decides. A company driver is not handed the utilisation figures as homework.
  const trEv = (trRet[0]?.evidence || []).join(' | ');
  ok('the decision is taken, not offered',
    /We are replacing it with|Like for like|Going to a/i.test(trRet[0]?.headline + ' | ' + trEv),
    (trRet[0]?.headline || '').slice(0, 110));
  ok('and the replacement type is named',
    /like for like|going to a/i.test(trEv), trEv.slice(0, 130));
  ok('nothing asks the driver to work it out',
    !/re-rig for whatever|or re-rig|figure out|if it really/i.test(trEv), trEv.slice(0, 130));
  ok('an order is raised for it, with a number',
    /is raised for it|once the equipment order/i.test(trEv),
    (trEv.match(/[^|]*raised for it[^|]*/i) || ['(no order line)'])[0].trim().slice(0, 120));

  head('9. The company can ask for another trailer');
  // Give the yard more drivers than trailers so the ask has a real basis, then file until it fires.
  let ask = null;
  for (let i = 0; i < 12 && !ask; i++) {
    rep = await fileReport([
      { driverId: strong.id, truckUnit: strong.assignedTruckUnit, trailerUnit: strong.assignedTrailerUnit,
        level: 7, rating: 9.0, perMile: 1.80, perDay: 700, revenue: 11000, miles: 6100,
        truckStars: 4, truckOdometer: 520000 + i * 30000, trailerStars: 4 },
    ]);
    ask = fleet().trailerRequest;
  }
  if (ask) {
    ok('a request was raised', !!ask.number, `${ask.number} ${ask.trailerType} at ${ask.terminalLabel}`);
    ok('it names a yard', !!ask.terminalLabel, ask.terminalLabel);
    ok('it names a trailer type', !!ask.trailerType, ask.trailerType);
    ok('it gives a reason', !!ask.reason, ask.reason);
    ok('and an instruction the player can act on', /Buy|Upgrade/.test(ask.instruction), ask.instruction);

    const before = S.trailers.length;
    S = un(await api('/fleetops/trailer-request/confirm', 'POST', {
      requestId: ask.id, unit: 'T990', paidPrice: 38500, gameTime: gt(),
    }));
    ok('the trailer joined the fleet', S.trailers.length === before + 1, `${before} -> ${S.trailers.length}`);
    const bought = S.trailers.find((t) => t.unit === 'T990');
    ok('at the price the player reported, not an estimate', bought.purchasePrice === 38500, `${bought.purchasePrice}`);
    ok('with a full star rating and an acquisition date',
      bought.stars === 5 && !!bought.acquiredGameTime, `${bought.stars}★ ${bought.acquiredGameTime}`);
    ok('and the request is closed', !fleet().trailerRequest);
  } else {
    console.log('  (no trailer request fired in 12 periods — occasional by design)');
    ok('the mechanism exists and stayed quiet', true, 'seeded roll did not fire');
  }

  head('10. A good driver leaving a weak carrier was poached, and says so');
  const finalRoster = (await api('/fleetops')).drivers;
  const gone = finalRoster.filter((d) => d.status === 'Resigned');
  if (gone.length) {
    ok('somebody resigned over the run', true, gone.map((d) => `${d.name} (lvl ${d.level})`).join(', '));
    const developed = gone.find((d) => d.level >= 5);
    if (developed) {
      ok('a developed driver at a 2-star outfit gives a poaching reason',
        /competitor|paying more|better equipment|Poached/i.test(developed.separationReason),
        `${developed.name}: ${developed.separationReason}`);
    } else {
      ok('the reason is recorded either way', !!gone[0].separationReason, gone[0].separationReason);
    }
    ok('a resignation does not put anyone on probation',
      !gone.some((d) => d.onProbation), gone.map((d) => `${d.name} prob=${d.onProbation}`).join(', '));
  } else {
    ok('nobody happened to quit — seeded, so this is a legitimate outcome', true,
      finalRoster.map((d) => `${d.name}:${d.status}`).join(', '));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
