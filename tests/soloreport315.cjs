/* A company of one still files its report.
 *
 * Reported from play on 2026-11-04: with one truck and trailer and nobody hired, no fleet report was ever
 * due, so the company never recorded what it earned, never looked at its own truck and trailer, and could
 * never grow or change. Now:
 *
 *   - the report comes due every 15 game days without hired drivers, counted from the player's hire
 *   - it reads back what the player's own loads made the company, off the books, and counts it in the net
 *   - it files with nothing more than the date, and the player's own units' condition when given
 *   - two of them and the company has a health to judge itself on
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5958}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const status = (day) => api('/status', 'POST', { locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(day) });

/** Books entries for the player's own loads, as a trip close-out would, without driving one. */
async function book(entries) {
  const st = await api('/export');
  for (const [day, category, amount] of entries)
    st.ledger.push({ accountKey: 'operating', amount, category, memo: 'test', tripNumber: 'T', gameTime: iso(day, '12:00') });
  await api('/import', 'POST', st);
}

(async () => {
  const app = { driverName: 'S. Olo', preferredDivision: 'Dry Van', experienceYears: 3, homeCity: 'Springfield', homeState: 'MO',
    acceptsProbation: true };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  ok('nobody hired', !(S.hiredDrivers || []).some((d) => d.status === 'Active'));

  head('1. Due every 15 days, hired drivers or not');
  S = un(await status(8));
  let due = S.views.fleetOps.due;
  ok('counted from the hire: next due on Day 16', due.nextDueGameTime === iso(16), due.nextDueGameTime);
  ok('not due yet', !due.isDue);
  S = un(await status(17));
  due = S.views.fleetOps.due;
  ok('due after 15 days', due.isDue, JSON.stringify({ days: due.daysSince }));
  ok('as the company report, asking for what a company of one has', /Company report is due/.test(due.message) && /bank balance/.test(due.message), due.message);

  head('2. Filed with nothing but the period: the company\'s own loads, read back');
  await book([[5, 'FreightRevenue', 5200], [6, 'Fuel', -1300], [6, 'Tolls', -60], [12, 'Payroll', -1500], [12, 'Opening', 99999]]);
  let r = await api('/fleetops/report', 'POST', { periodStartGame: due.lastPeriodEnd, periodEndGame: iso(17), lines: [], trailerLines: [] });
  ok('filed with no drivers on it', !!r.report && /-FR-0001$/.test(r.report.number), r.report && r.report.number);
  ok('the own loads counted: revenue less fuel, tolls and pay, nothing else', Math.abs(r.report.ownOperations - 2340) < 0.01,
    `${r.report.ownOperations}`);
  ok('and in the net the company is judged on', Math.abs(r.report.netContribution - (2340 - r.report.totalRepairs - r.report.totalCapital)) < 0.01,
    `${r.report.netContribution}`);
  ok('and said on the report', r.report.findings.some((x) => /Your own loads/.test(x)), r.report.findings.join(' | '));
  S = un(await status(18));
  ok('not due again until the next 15 days', !S.views.fleetOps.due.isDue && S.views.fleetOps.due.nextDueGameTime === iso(32),
    S.views.fleetOps.due.nextDueGameTime);

  head('3. Your own truck and trailer, on the report');
  await book([[20, 'FreightRevenue', 6100], [21, 'Fuel', -1400]]);
  S = un(await status(32));
  r = await api('/fleetops/report', 'POST', {
    periodStartGame: S.views.fleetOps.due.lastPeriodEnd, periodEndGame: iso(32), trailerLines: [],
    lines: [{ isPlayerLine: true, truckUnit: S.driver.assignedTruckUnit, trailerUnit: S.driver.assignedTrailerUnit,
      truckOdometer: 0, truckDamagePct: 7, trailerDamagePct: 4 }],
  });
  ok('only this period\'s loads', Math.abs(r.report.ownOperations - 4700) < 0.01, `${r.report.ownOperations}`);
  S = un(await api('/bootstrap'));
  const tk = S.trucks.find((t) => t.unit === S.driver.assignedTruckUnit);
  ok('the truck\'s condition recorded', tk && Math.abs(tk.damagePct - 7) < 0.01, tk && `${tk.damagePct}`);

  head('4. Two reports, and the company has a health to go on');
  ok('judged on the two', r.report.health && r.report.health.reportsCounted === 2 && !/Too early/.test(r.report.health.headline),
    r.report.health && r.report.health.headline);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
