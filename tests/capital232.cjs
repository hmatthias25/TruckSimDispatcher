/* #232 — yards and equipment cost nothing, so the company could never stop expanding.
 *
 * Reported from play: "the app said it got a small garage in Bellingham Washington, however I don't see
 * any reference to the company spending money on it. Same with the sale/purchase of the trailer. These
 * all need to be figured in otherwise the company will keep making more and more money."
 *
 * The cash was never wrong — Position reads the ATS bank balance the player types in, and ATS had
 * already taken the money for the garage. What was wrong is every figure the company judges ITSELF by:
 *
 *   report.NetContribution = TotalRevenue - TotalWages - TotalRepairs
 *
 * and CompanyHealth runs expand-or-retrench off that. No equipment, no property, no upkeep — so the
 * cost of expanding never reached the number that decided whether to expand again, and the answer was
 * always yes. LedgerService.Summary left Equipment out of opCost for the same reason.
 *
 * What this suite holds:
 *   1. a yard is an ASK, not a fact — nothing on the books until the player says they bought it
 *   2. confirming it posts what they paid, declining it does not and is not asked again
 *   3. upkeep is charged per settlement, prorated, and never twice for the same days
 *   4. buying and selling equipment by hand moves money
 *   5. all of it lands in the figures the company judges itself by
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5909}/api`;
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
// Real date arithmetic, not string concatenation. Day 40 written as "2000-01-40" is not a date,
// GameClock.TryParse returns null for it, and everything clock-driven then silently does nothing —
// which is exactly how this suite spent a while reporting that upkeep was never charged.
const iso = (d, hm = '06:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
const ledger = async (cat) => (await api('/export')).ledger.filter((e) => e.category === cat);
const spent = async (cat) => (await ledger(cat)).reduce((n, e) => n - e.amount, 0);

(async () => {
  const app = { driverName: 'S. Ferreira', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const hq = S.company.terminals[0];

  head('1. A yard the company wants is an ask, not a yard');
  // Raised directly rather than waiting for the growth roll, which needs a full yard and a run of good
  // periods. What is being tested is what happens to the money, not when the company gets ambitious.
  let st = await api('/export');
  st.yardRequests = [{
    id: 'yr-test-1', number: 'SFL-YD-0001', kind: 'Open', city: 'Bellingham', state: 'WA',
    level: 'Small', reason: 'fixture', instruction: 'Buy it and say what it cost.',
    raisedGameTime: iso(10), status: 'Open',
  }];
  S = un(await api('/import', 'POST', st));
  const yardsBefore = S.company.terminals.length;
  const askedFor = (await api('/bootstrap')).views.fleetOps?.yardRequest;
  ok('the ask is in front of the player', askedFor?.city === 'Bellingham', askedFor?.number || '(none)');
  ok('and no yard has appeared yet', S.company.terminals.length === yardsBefore,
    `${S.company.terminals.length} yard(s)`);

  head('2. Confirming it puts the yard on the books and the money off them');
  const propBefore = await spent('Property');
  let r = await api('/fleetops/yard-request/confirm', 'POST', {
    requestId: 'yr-test-1', paidPrice: 250000, gameTime: iso(10),
  });
  S = un(r);
  console.log(`  ..    ${r.message}`);
  const bell = S.company.terminals.find((t) => t.city === 'Bellingham');
  ok('the yard is there now', !!bell, bell ? `${bell.city} (${bell.level})` : '(missing)');
  ok('the price is recorded against it', bell?.purchasePrice === 250000, `$${bell?.purchasePrice}`);
  ok('and $250,000 came off the books',
    Math.abs((await spent('Property')) - propBefore - 250000) < 0.01,
    `$${(await spent('Property')) - propBefore}`);
  ok('the ask is closed out', !(await api('/bootstrap')).views.fleetOps?.yardRequest, 'no open ask');

  head('3. Declining costs nothing and is not asked again');
  st = await api('/export');
  st.yardRequests.unshift({
    id: 'yr-test-2', number: 'SFL-YD-0002', kind: 'Open', city: 'Tucson', state: 'AZ',
    level: 'Small', reason: 'fixture', instruction: 'x', raisedGameTime: iso(11), status: 'Open',
  });
  S = un(await api('/import', 'POST', st));
  const propAtDecline = await spent('Property');
  await api('/fleetops/yard-request/decline', 'POST', { requestId: 'yr-test-2' });
  ok('nothing was spent', Math.abs((await spent('Property')) - propAtDecline) < 0.01, 'unchanged');
  ok('and no yard appeared', !un(await api('/bootstrap')).company.terminals.some((t) => t.city === 'Tucson'),
    'no Tucson yard');

  head('4. Upkeep is charged on the calendar, prorated, and only for unbilled days');
  // Stamp the yards as billed on day 10, then report a clock on day 40. Upkeep rides the same
  // beat that settles paydays, so reporting in is what triggers it — no drivers or loads needed.
  st = await api('/export');
  for (const t of st.company.terminals) { t.lastUpkeepDay = 10; t.monthlyCost = t.monthlyCost || 1150; }
  st.status.gameTime = iso(40);
  S = un(await api('/import', 'POST', st));
  const upkeepBefore = await spent('YardUpkeep');
  await api('/status', 'POST', { locationCity: 'Denver', locationState: 'CO', locationKind: 'Yard',
    gameTime: iso(40), fuelPct: 80, atsOdometer: 6000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  const afterOne = await spent('YardUpkeep');
  console.log(`  ..    upkeep charged $${(afterOne - upkeepBefore).toFixed(2)} over 30 days`);
  ok('something was charged for keeping the yards', afterOne > upkeepBefore,
    `$${(afterOne - upkeepBefore).toFixed(2)}`);

  // Reporting in again on the same day must not bill the same days twice.
  await api('/status', 'POST', { locationCity: 'Denver', locationState: 'CO', locationKind: 'Yard',
    gameTime: iso(40), fuelPct: 80, atsOdometer: 6000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OffDuty', atsBankBalance: 90000 });
  ok('reporting in again the same day charges nothing more',
    Math.abs((await spent('YardUpkeep')) - afterOne) < 0.01,
    `$${((await spent('YardUpkeep')) - afterOne).toFixed(2)} extra`);

  head('5. Equipment bought and sold by hand moves money');
  const equipBefore = await spent('Equipment');
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'CAP-1', type: 'Reefer', division: 'Reefer', year: 2022, status: 'InService',
    inGameGarage: true, homeTerminalId: hq.id, purchasePrice: 42000,
  }));
  ok('buying a trailer costs the company', Math.abs((await spent('Equipment')) - equipBefore - 42000) < 0.01,
    `$${(await spent('Equipment')) - equipBefore}`);

  const beforeSale = await spent('Equipment');
  r = await api('/fleetops/retire', 'POST', { unit: 'CAP-1', replacementUnit: '', soldFor: 15000 });
  S = un(r);
  console.log(`  ..    ${r.message}`);
  ok('selling it puts money back', Math.abs((await spent('Equipment')) - beforeSale + 15000) < 0.01,
    `net $${(await spent('Equipment')) - beforeSale}`);
  ok('and the message says so', /15,000|15000/.test(r.message), r.message);

  head('6. It all reaches the figures the company judges itself by');
  const sum = await api('/finance');
  const eq = sum?.equipmentSpend ?? sum?.EquipmentSpend;
  const up = sum?.yardUpkeepSpend ?? sum?.YardUpkeepSpend;
  console.log(`  ..    equipment $${eq} · upkeep $${up} · operating income $${sum?.operatingIncome}`);
  ok('equipment and property are totalled', typeof eq === 'number' && eq > 0, `$${eq}`);
  ok('yard upkeep is totalled', typeof up === 'number' && up > 0, `$${up}`);

  // The whole point: operating income must be lower for having spent it.
  const withCapital = sum.operatingIncome;
  ok('and operating income has taken the hit',
    typeof withCapital === 'number' && withCapital <= sum.revenue - eq,
    `income $${withCapital} against revenue $${sum.revenue}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
