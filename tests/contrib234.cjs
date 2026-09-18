/* What ATS reports for a hired driver is PROFIT, and the app was treating it as revenue.
 *
 * Reported from play: "$/mile and $/day are PROFIT."
 *
 * The game pays the driver, the fuel and the tolls out of the job before it prints that figure. The app
 * multiplied it by the period's miles, called the result Revenue, posted it as FreightRevenue, and then
 * worked out a wage as a share of it and posted THAT as Payroll. Three things wrong at once:
 *
 *   - the company's NET sat in its revenue line, so the operating ratio and revenue-per-mile were
 *     computed against a number that was not revenue
 *   - the driver was paid twice: once by ATS, once again in the app's books
 *   - NetContribution subtracted the invented wage from an already-net figure, and CompanyHealth
 *     expands and retrenches off NetContribution
 *
 * It is contribution now: what the driver put in the company's pocket, with nothing left to deduct.
 * The rung's share survives as a description of what somebody is worth, not as money.
 *
 * What this suite holds:
 *   1. contribution is the profit rate times the period, and no wage comes off it
 *   2. nothing posts to Payroll for a hired driver, and the contribution posts under its own category
 *   3. it reaches operating income without being mistaken for linehaul revenue
 *   4. an old career's figures carry across, and the invented wages are written off
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5901}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
const ledger = async (cat) => (await api('/export')).ledger.filter((e) => e.category === cat);

(async () => {
  const app = { driverName: 'H. Lindgren', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Phoenix', homeState: 'AZ', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yardId = S.company.terminals[0].id;
  S = un(await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' }));

  await api('/fleet/truck', 'POST', {
    unit: 'C-900', make: 'Volvo', model: 'VNL', year: 2021, atsOdometer: 100000,
    serviceMiles: 100000, lastServiceMiles: 100000, serviceIntervalMiles: 25000,
    damagePct: 3, inGameGarage: true, homeTerminalId: yardId,
  });
  const hired = (await api('/fleetops/drivers', 'POST', {
    name: 'T. Brenner', status: 'Active', assignedTruckUnit: 'C-900', skill: 'Experienced',
    homeTerminalId: yardId, hiredGameDate: iso(3), level: 8,
  })).driver;

  head('1. Contribution is the profit rate times the period, with nothing taken off it');
  const payrollBefore = (await ledger('Payroll')).length;
  const r1 = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(5), periodEndGame: iso(20),
    lines: [{ driverId: hired.id, level: 8, perMile: 2.00, perDay: 600,
              truckStars: 4, truckOdometer: 105000 }],
  })).report;
  const line = r1.lines.find((l) => l.driverId === hired.id);
  console.log(`  ..    ${line.miles} mi · contribution $${line.contribution} · ${line.revenueBasis}`);
  ok('miles came off the odometer', Math.abs(line.miles - 5000) < 1, `${line.miles} mi`);
  ok('contribution is the rate times the miles',
    Math.abs(Number(line.contribution) - 2.00 * 5000) < 1, `$${line.contribution}`);
  ok('and the basis says it is net', /net/i.test(line.revenueBasis || ''), line.revenueBasis);
  ok('no wage was worked out', !(line.wages > 0), `$${line.wages ?? 0}`);

  head('2. Nothing posts to payroll for a hired driver');
  // ATS already paid them. A Payroll entry here would be the company paying them a second time.
  const payrollAfter = await ledger('Payroll');
  ok('no new payroll entry was raised', payrollAfter.length === payrollBefore,
    `${payrollAfter.length} vs ${payrollBefore} before`);
  const contrib = await ledger('FleetContribution');
  ok('the contribution posted under its own category', contrib.length > 0, `${contrib.length} entr(ies)`);
  ok('and the memo says what ATS had already taken',
    /wages, fuel and tolls/i.test(contrib[0]?.memo || ''), (contrib[0]?.memo || '').slice(0, 90));
  const freight = await ledger('FreightRevenue');
  ok('and it is NOT filed as linehaul revenue',
    !freight.some((e) => /Brenner/.test(e.memo || '')), `${freight.length} linehaul entr(ies)`);

  head('3. It reaches the company figures without pretending to be revenue');
  const fin = await api('/finance');
  console.log(`  ..    revenue $${fin.revenue} · fleet contribution $${fin.fleetContribution} · income $${fin.operatingIncome}`);
  ok('the fleet contribution is totalled on its own', fin.fleetContribution > 0, `$${fin.fleetContribution}`);
  ok('it is not lumped into linehaul revenue', !(fin.revenue >= fin.fleetContribution) || fin.revenue === 0,
    `revenue $${fin.revenue}`);
  ok('and operating income is the better for it',
    fin.operatingIncome >= fin.fleetContribution - 1, `$${fin.operatingIncome}`);

  head('4. The report nets off repairs and capital, not a wage that never moved');
  console.log(`  ..    contribution $${r1.totalContribution} · net $${r1.netContribution}`);
  ok('the report totals contribution', r1.totalContribution > 0, `$${r1.totalContribution}`);
  ok('no wages are totalled', !(r1.totalWages > 0), `$${r1.totalWages ?? 0}`);
  ok('and net is contribution less repairs and capital',
    Math.abs(r1.netContribution - (r1.totalContribution - r1.totalRepairs - (r1.totalCapital || 0))) < 0.02,
    `${r1.netContribution} vs ${r1.totalContribution} - ${r1.totalRepairs} - ${r1.totalCapital || 0}`);

  head('5. An old career carries its figures across and the invented wages are written off');
  let st = await api('/export');
  st.schemaVersion = 21;
  const d = st.hiredDrivers.find((x) => x.id === hired.id);
  d.lifetimeContribution = 0;
  d.lifetimeRevenue = 48000;
  d.lifetimeWages = 14400;
  d.periods = [{ reportNumber: 'OLD-1', periodEndGame: iso(20), revenue: 48000, wages: 14400,
                 contribution: 0, miles: 24000, perMile: 2.0, gameFiguresReported: true }];
  st.fleetReports = [{ number: 'OLD-1', periodStartGame: iso(5), periodEndGame: iso(20),
                       totalRevenue: 48000, totalWages: 14400, totalRepairs: 0, totalCapital: 0,
                       totalContribution: 0, netContribution: 33600, lines: [] }];
  S = un(await api('/import', 'POST', st));
  const back = (await api('/export')).hiredDrivers.find((x) => x.id === hired.id);
  console.log(`  ..    contribution $${back.lifetimeContribution} · wages $${back.lifetimeWages}`);
  ok('the stored figure carried across under its right name',
    back.lifetimeContribution === 48000, `$${back.lifetimeContribution}`);
  ok('and the invented wages are gone', !(back.lifetimeWages > 0), `$${back.lifetimeWages}`);

  const rep = (await api('/export')).fleetReports.find((x) => x.number === 'OLD-1');
  ok('the old report carried across too', rep.totalContribution === 48000, `$${rep.totalContribution}`);
  ok('and its net no longer subtracts a wage nobody paid',
    Math.abs(rep.netContribution - 48000) < 0.02, `$${rep.netContribution} (was 33600)`);

  const events = await api('/events?take=60');
  const said = events.find((e) => /written off the books/i.test(e.message || ''));
  ok('and it was said out loud', !!said, said?.message?.slice(0, 110) || '(silent)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
