/* How long a new hire rides out free before the company starts judging them.
 *
 *   "Let's reduce that to 2. A month is fine for a grace period, 2 months is a bit long."
 *
 * It was four reports — two months at the default fortnightly interval — and it is two now.
 *
 * The constant was also off by one from what it read like, which is why this suite exists at all rather
 * than the change being a one-character edit. HiredDriver.ReportsFiled is incremented while the driver's
 * own line is processed, and that happens BEFORE conduct is rolled, so a driver's very first report
 * already reads 1 by the time the gate tests it. `ReportsFiled < 4` therefore protected three reports
 * while the comment beside it said four, and the manual repeated the comment. The test is inclusive now
 * and the name means what it says: SettlingInReports is how many reports are free.
 *
 * So: nothing at all on reports one and two, and the third is the first they can pick anything up on.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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

// Four: a Large yard holds five tractors and the player is sitting in one. All level 1: the greenest hands the game has, and the
// likeliest to hit something — 16% a report each, which is what makes the arithmetic below work.
const CREW = 4;
let S, yardId, day = 10, odo = 200_000;
const ids = [];

const file = async () => {
  const start = day, end = day + 14; day = end; odo += 4_000;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(start), periodEndGame: iso(end),
    lines: ids.map((id, i) => ({
      driverId: id, level: 1, perMile: 1.8, perDay: 520,
      truckStars: 5, truckOdometer: odo + i,
    })),
  })).report;
};

(async () => {
  const app = { driverName: 'S. Adeyemi', preferredDivision: 'Dry Van', experienceYears: 7,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yardId = S.company.terminals[0].id;
  S = un(await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' }));

  for (let i = 0; i < CREW; i++) {
    await api('/fleet/truck', 'POST', {
      unit: `G-${i}`, make: 'Freightliner', model: 'Cascadia', year: 2020, atsOdometer: 200_000,
      serviceMiles: 200_000, lastServiceMiles: 195_000, serviceIntervalMiles: 25_000,
      damagePct: 0, inGameGarage: true, homeTerminalId: yardId,
    });
    ids.push((await api('/fleetops/drivers', 'POST', {
      name: `Rook ${i}`, status: 'Active', assignedTruckUnit: `G-${i}`, skill: 'Green',
      homeTerminalId: yardId, hiredGameDate: iso(4), level: 1,
    })).driver.id);
  }
  ok(`${CREW} green hands on the books`, ids.length === CREW, `${ids.length}`);

  head('1. Nothing is rolled against them on their first two reports');
  // Deterministic, whatever the seed: the gate returns before the roll is even reached.
  const one = await file();
  ok('first report: no conduct at all', (one.conduct || []).length === 0,
    `${(one.conduct || []).length} line(s)`);
  const two = await file();
  ok('second report: still nothing', (two.conduct || []).length === 0,
    `${(two.conduct || []).length} line(s)`);

  const roster = await api('/fleetops');
  ok('and they have two reports on the file by now',
    (roster.drivers || []).every((d) => d.reportsFiled === 2),
    (roster.drivers || []).map((d) => d.reportsFiled).join(','));
  ok('with a clean sheet each', (roster.dossiers || []).every((z) => z.incidents === 0),
    (roster.dossiers || []).map((z) => z.incidents).join(','));

  head('2. The third is the first one they can pick something up on');
  // The roll is seeded on the career, the report number and the driver, so which report it lands on is
  // not fixed across runs — only that it CAN land from here. Four green hands at 16% a report over the
  // eighteen below is seventy-two rolls; never once would be about a three in a million miss.
  let firstAt = 0, lines = 0;
  for (let n = 3; n <= 20; n++) {
    const rep = await file();
    const c = (rep.conduct || []).length;
    lines += c;
    if (c > 0 && firstAt === 0) firstAt = n;
  }
  console.log(`  ..    ${lines} conduct line(s), first on report ${firstAt || '(none)'}`);
  ok('conduct happens once the grace period is behind them', lines > 0, `${lines} line(s)`);
  ok('and never before the third report', firstAt === 0 || firstAt >= 3, `report ${firstAt}`);

  head('3. A month, not two');
  // What the change is actually worth: the two reports that used to be free and are not any more.
  const fo = await api('/fleetops');
  const seen = (fo.reports || []).filter((r) => (r.conduct || []).length > 0).map((r) => r.number);
  ok('reports three and four are in the pool now',
    (fo.reports || []).length >= 4, `${(fo.reports || []).length} report(s) on file`);
  ok('and something has been recorded against the crew',
    (fo.dossiers || []).some((z) => z.incidents > 0),
    (fo.dossiers || []).map((z) => z.incidents).join(',') + ` — ${seen.length} report(s) with conduct`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
