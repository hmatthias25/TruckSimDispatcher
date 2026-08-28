/* Issue #127 — the fleet report asked for three figures ATS never shows.
 *
 * Revenue and repairs are on no screen the player can read for a driver they are not sitting next to.
 * The manual says so two pages earlier: ATS gives level, rating, $/mile, $/day, stars and an odometer,
 * and that is the lot. So the report asked for numbers that could only be guessed, everybody sensibly
 * left them blank, and the fleet summary read zero revenue, zero wages, zero repairs for ever.
 *
 * All three come from what IS readable now.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, period = 0;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

async function truck(u, odo, serviceMiles, lastService) {
  await api('/fleet/truck', 'POST', {
    unit: u, make: 'Freightliner', model: 'Cascadia', year: 2020,
    atsOdometer: odo, serviceMiles, lastServiceMiles: lastService ?? serviceMiles,
    serviceIntervalMiles: 25000, damagePct: 4, inGameGarage: true,
    homeTerminalId: S.company.terminals[0].id,
  });
}

async function hire(name, u) {
  return (await api('/fleetops/drivers', 'POST', {
    name, status: 'Active', assignedTruckUnit: u, skill: 'Experienced',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;
}

/** File a report the way the form does now — no revenue, no wages, no repairs. */
async function fileReport(lines, days = 15) {
  const start = period + 5;
  period += days;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: at(start), periodEndGame: at(start + days),
    lines,
  })).report;
}

(async () => {
  const app = { driverName: 'C. Alc', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 12, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));
  await api('/finance/entry', 'POST', {
    accountKey: 'operating', amount: 300000, category: 'Other', memo: 'fixture — funded',
  });

  head('1. #127 Revenue comes off the $/mile and the odometer, with nothing typed');
  await truck('T800', 200000, 200000);
  const d1 = await hire('R. Vance', 'T800');
  const r1 = await fileReport([{
    driverId: d1.id, level: 6, rating: 8.2, perMile: 1.90, perDay: 520,
    truckStars: 4, trailerStars: 4, truckOdometer: 204200,
  }]);
  const l1 = r1.lines.find((l) => l.driverId === d1.id);
  ok('miles came from the odometer difference', near(l1.miles, 4200), `${l1.miles} mi`);
  ok('revenue is no longer zero', l1.revenue > 0, `$${l1.revenue}`);
  ok('and it is $/mi x miles', near(Number(l1.revenue), 1.90 * 4200, 2),
    `$${l1.revenue} vs $${(1.90 * 4200).toFixed(2)}`);
  ok('the line says how it was worked out', /\/mi/.test(l1.revenueBasis || ''), l1.revenueBasis);

  head('2. #127 Wages follow from the agreed share');
  ok('wages are not zero either', l1.wages > 0, `$${l1.wages}`);
  ok('and they are the driver\'s share of the revenue',
    near(Number(l1.wages), Number(l1.revenue) * 0.30, 2),
    `$${l1.wages} on $${l1.revenue}`);

  head('3. #127 The summary has real numbers in it');
  ok('report revenue totals up', r1.totalRevenue > 0, `$${r1.totalRevenue}`);
  ok('report wages total up', r1.totalWages > 0, `$${r1.totalWages}`);
  ok('and a net contribution falls out of it', r1.netContribution !== 0, `$${r1.netContribution}`);

  head('4. #127 With no odometer it falls back to $/day across the period');
  await truck('T801', 150000, 150000);
  const d2 = await hire('K. Sole', 'T801');
  const r2 = await fileReport([{
    driverId: d2.id, level: 4, rating: 7.5, perMile: 0, perDay: 480,
    truckStars: 4, trailerStars: 4, truckOdometer: 0,
  }], 15);
  const l2 = r2.lines.find((l) => l.driverId === d2.id);
  ok('revenue still comes out', l2.revenue > 0, `$${l2.revenue}`);
  ok('and it is $/day x the days in the period', near(Number(l2.revenue), 480 * 15, 2),
    `$${l2.revenue} vs $${480 * 15}`);
  ok('and it says which basis it used', /\/day/.test(l2.revenueBasis || ''), l2.revenueBasis);

  head('5. #127 Repairs are what the yard actually spent, not a number you hunt for');
  // A unit past its PM gets serviced as part of filing, and that spend is what the repairs column now
  // means — it was previously a box the player had no way to fill.
  await truck('T802', 260000, 90000, 0);   // 65,000 past a 25,000-mile interval
  const d3 = await hire('M. Ostend', 'T802');
  const r3 = await fileReport([{
    driverId: d3.id, level: 7, rating: 8.8, perMile: 2.05, perDay: 600,
    truckStars: 3, trailerStars: 4, truckOdometer: 264000,
  }]);
  const l3 = r3.lines.find((l) => l.driverId === d3.id);
  ok('the unit was serviced as part of filing',
    (r3.findings || []).some((f) => /T802/.test(f) && /PM/i.test(f)),
    (r3.findings || []).find((f) => /T802/.test(f))?.slice(0, 110) || '(nothing)');
  ok('and the spend landed on the line as repairs', l3.repairs > 0, `$${l3.repairs}`);
  ok('it is in the report total too', r3.totalRepairs > 0, `$${r3.totalRepairs}`);
  ok('and against the unit, where it counts toward a trade',
    (await api('/bootstrap')).trucks.find((t) => t.unit === 'T802').lifetimeRepairCost > 0,
    `$${(await api('/bootstrap')).trucks.find((t) => t.unit === 'T802').lifetimeRepairCost}`);

  head('6. #127 The money is posted once, not twice');
  // ServiceDueUnits posts to the ledger itself, so attributing the spend to the line must not post it
  // again. Two entries for one service would quietly double the fleet's costs.
  const pmEntries = (await api('/ledger?take=120')).filter((e) => /PM . unit T802/i.test(e.memo || ''));
  ok('exactly one ledger entry for that service', pmEntries.length === 1,
    `${pmEntries.length} entr(ies): ${pmEntries.map((e) => e.amount).join(', ')}`);

  head('7. #127 Money reads as money');
  // The app runs under invariant culture, where "C" formatting renders the generic currency sign — so
  // a price quoted with it comes out as "¤480.00/day". Twice bitten now; the codebase convention is a
  // literal $ with :N.
  const moneyish = [l1.revenueBasis, l2.revenueBasis, ...(r3.findings || [])].join(' | ');
  ok('no generic currency sign anywhere in what the player reads', !/¤/.test(moneyish),
    moneyish.match(/[^|]*¤[^|]*/)?.[0]?.slice(0, 70) || 'all dollars');

  head('8. #127 A figure given by hand still wins');
  // The derivation is a fallback for what cannot be read, not a wall. Somebody reconciling against
  // their bank balance can still say what a period actually made.
  await truck('T803', 100000, 100000);
  const d4 = await hire('P. Rior', 'T803');
  const r4 = await fileReport([{
    driverId: d4.id, level: 5, rating: 8, perMile: 1.5, perDay: 400,
    truckStars: 4, trailerStars: 4, truckOdometer: 102000, revenue: 12345,
  }]);
  const l4 = r4.lines.find((l) => l.driverId === d4.id);
  ok('the entered revenue is kept', near(Number(l4.revenue), 12345, 1), `$${l4.revenue}`);
  ok('and no basis is claimed for a number we were given', !l4.revenueBasis,
    l4.revenueBasis || '(none)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
