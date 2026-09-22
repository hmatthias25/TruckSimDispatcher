/* The company only asks for a garage somewhere the truck has actually been.
 *
 * Reported from play: "the game added a garage for me in Bellingham because company was doing well. I
 * had never been there before so I couldn't really add it in game. When game adds garage it should ONLY
 * add it in cities we have discovered so it can then be added in game."
 *
 * Everywhere else in the app a garage is discovery-gated, because ATS generates no cargo for a city that
 * was revealed rather than driven to — a yard there is a yard with nothing coming out of it. The
 * expansion path in CompanyHealth was the one place that was not, so the company could pick any official
 * tier-1 or tier-2 city on the map and send the player to buy a garage they had no way to use.
 *
 * Bellingham is also the city in the note attached to the PREVIOUS fault in this same code — the one
 * where a yard cost the company nothing. Same city, same panel, reported twice.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

/** Every yard the company has ever asked to open, across the whole run. */
const asks = async () => ((await api('/export')).yardRequests || []).filter((r) => r.kind === 'Open');

/**
 * Drive a stretch of fortnightly reports with the company visibly thriving.
 *
 * The band is read off NetContribution per report and Thriving wants $12,000 of it, which a one-truck
 * fixture does not turn over. Rather than simulate an economy, the stored reports are set to a healthy
 * figure before each filing — Assess reads them straight off the record. Expansion is then a roll per
 * report, so this files a run of them and stops as soon as the ask appears.
 */
async function prosperUntilItAsks(count, day0) {
  const driver = ((await api('/fleetops')).drivers || [])[0];
  for (let i = 0; i < count; i++) {
    const st = await api('/export');
    for (const r of st.fleetReports || []) r.netContribution = 60_000;
    st.status.atsBankBalance = 4_000_000;
    await api('/import', 'POST', st);

    await api('/fleetops/report', 'POST', {
      periodStartGame: iso(day0 + i * 14), periodEndGame: iso(day0 + 14 + i * 14),
      lines: driver ? [{ driverId: driver.id, level: 9, perMile: 2.40, perDay: 900,
                         truckStars: 5, truckOdometer: 200_000 + i * 9_000 }] : [],
    });

    const band = (((await api('/export')).fleetReports || [])[0])?.health?.band;
    if ((await asks()).length > 0) return { periods: i + 1, band };
    if (i === count - 1) return { periods: count, band };
  }
  return { periods: count, band: null };
}

(async () => {
  const app = {
    driverName: 'G. Rowe', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: '', homeState: '', acceptsProbation: true,
    homeTimePreference: 'biweekly', preferredTripLength: 'otr',
  };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'SNI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // A report has to have somebody's figures on it, so the fleet needs a truck and a driver before any
  // of this runs. Without them every filing is refused and the whole suite passes on nothing.
  const yardId = (S.company.terminals || [])[0].id;
  await api('/fleet/truck', 'POST', {
    unit: 'P-1', make: 'Kenworth', model: 'W900', year: 2021, atsOdometer: 200_000,
    serviceMiles: 200_000, lastServiceMiles: 195_000, serviceIntervalMiles: 25_000,
    damagePct: 2, inGameGarage: true, homeTerminalId: yardId,
  });
  await api('/fleetops/drivers', 'POST', {
    name: 'M. Ortiz', status: 'Active', assignedTruckUnit: 'P-1', skill: 'Experienced',
    homeTerminalId: yardId, hiredGameDate: iso(2), level: 9, lifetimeMiles: 200_000,
  });

  head('1. Nothing is asked for in a city nobody has driven to');
  // The career has been nowhere but its own yard, so there is no honest expansion available at all.
  let st = await api('/export');
  const home = `${st.company.terminalCity}, ${st.company.terminalState}`;
  st.discovered = (st.discovered || []).filter((d) => `${d.city}, ${d.state}` === home);
  st.status.atsBankBalance = 4_000_000;
  await api('/import', 'POST', st);
  console.log(`  ..    discovered: ${((await api('/export')).discovered || []).map((d) => d.city).join(', ') || '(none)'}`);

  const blind = await prosperUntilItAsks(30, 20);
  const blindAsks = await asks();
  console.log(`  ..    ${blind.periods} period(s) filed, company ${blind.band}` +
              ` — ${blindAsks.length} yard ask(s)` +
              `${blindAsks.length ? ' — ' + blindAsks.map((r) => `${r.city}, ${r.state}`).join(' | ') : ''}`);
  // Asserted FIRST, because "nothing was asked for" is what a company with no money to expand also
  // looks like — and then this section proves nothing at all. It has to be a company that wanted to.
  ok('the company was in a state where it would open a yard', blind.band === 'Thriving',
    `band ${blind.band}`);
  ok('and it still never asks for a garage it has not seen', blindAsks.length === 0,
    blindAsks.map((r) => `${r.city}, ${r.state}`).join(', ') || 'none asked');

  head('2. Drive somewhere, and that is where it asks');
  // Three official cities the company could use. Whichever it picks has to be one of these.
  const visited = [['Seattle', 'WA'], ['Portland', 'OR'], ['Sacramento', 'CA']];
  for (const [city, state] of visited) {
    await api('/status', 'POST', {
      locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: iso(500),
      fuelPct: 70, atsOdometer: 400_000, truckDamagePct: 2, trailerDamagePct: 1,
      dutyStatus: 'OnDuty', atsBankBalance: 4_000_000,
    });
  }
  const reached = ((await api('/export')).discovered || []).map((d) => `${d.city}, ${d.state}`);
  console.log(`  ..    now reached: ${reached.join(' | ')}`);

  const seeing = await prosperUntilItAsks(40, 520);
  console.log(`  ..    ${seeing.periods} more period(s), company ${seeing.band}`);

  const after = await asks();
  console.log(`  ..    ${after.length} yard ask(s): ${after.map((r) => `${r.city}, ${r.state}`).join(' | ') || '(none)'}`);
  // Guarded: every assertion below is about WHERE it asked, and they all pass on an empty list.
  ok('the company did eventually ask for one', after.length > 0, `${after.length} ask(s)`);
  ok('and every ask names a city the truck has actually been to',
    after.every((r) => reached.some((c) => c.toLowerCase() === `${r.city}, ${r.state}`.toLowerCase())),
    after.map((r) => `${r.city}, ${r.state}`).join(', ') || 'none');
  ok('none of them is somewhere off the map we have driven',
    !after.some((r) => !reached.some((c) => c.toLowerCase() === `${r.city}, ${r.state}`.toLowerCase())),
    'clean');

  head('3. With nowhere left it has been, it says so rather than picking anywhere');
  // "It already has one everywhere it runs" is a different fact and sends the player looking in the
  // wrong place. The two cases are told apart.
  const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const cs = fs.readFileSync(path.join(__dirname, '..', 'Services', 'CompanyHealth.cs'), 'utf8');
  ok('the expansion filter is discovery-gated', /DiscoveryService\.IsDiscovered\(s, c\.City, c\.State\)/.test(cs),
    'gated');
  ok('and an empty list distinguishes "not been there" from "have them all"',
    /you have not driven to yet/i.test(cs) && /everywhere it runs/i.test(cs), 'both reasons');

  head('4. The network line lists only what you do NOT hold');
  // Reported from play: "the wording under terminals where it says 'you do not hold a yard in those
  // cities yet' is incorrect, I do (except for Pittston PA)." It printed the whole network under a
  // sentence claiming none of it was held.
  const line = js.slice(js.indexOf('function networkLine'), js.indexOf('function networkLine') + 2400);
  ok('the sentence is built from the outstanding cities, not the network',
    /outstanding\.map\(name\)/.test(line) && !/\$\{net\.map\(name\)/.test(line), 'outstanding only');
  ok('a yard the company itself asked for is listed too', /yardRequest/.test(line), 'included');
  ok('and the whole paragraph goes away when there is nothing left to open',
    /if \(!open\.length && !later\.length && !asked\.length\) return '';/.test(line), 'guarded');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
