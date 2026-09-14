/* #208, #209, #210, #211 — four things out of one session in play.
 *
 * 208  A hired driver with negative $/mile and negative per-week figures avoided probation. The
 *      underperformance test read "p.PerDay > 0", meaning to say "reported", and so exempted every
 *      figure at or below zero — the worst possible performance was the one case it could not see.
 *
 * 209  Told to collect a reefer "on the road 0 miles away" while it sat at the terminal.
 *
 * 210  Trailers had no section of their own. Their figures rode on a DRIVER line, so a box nobody was
 *      pulling was invisible to the one report meant to say whether it was worth keeping.
 *
 * 211  The company owned a chemical tanker nobody was cleared to run.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5956}/api`;
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
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;

(async () => {
  const app = { driverName: 'F. Okafor', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));

  head('1. A rookie carrier is not handed a tanker nobody can run');
  // ATS gates freight on hazmat CLASSES, not CDL endorsements. A fuel tanker is class 3, chemical is
  // class 8, gas is class 2 — food grade and dry bulk need nothing at all. A driver holding none of them
  // must not be seeded a placarded box, whatever the carrier happens to be called.
  const noHaz = (S.driver.endorsements || []).length === 0;
  ok('this driver holds no hazmat class', noHaz, `${(S.driver.endorsements || []).length} class(es)`);
  const seeded = (S.trailers || []).filter((t) => /tanker/i.test(t.type) && !t.retired);
  console.log(`  ..    tankers seeded: ${seeded.map((t) => `${t.unit}/${t.subtype || '?'}`).join(', ') || 'none'}`);
  ok('no placarded tanker was seeded to a driver with no class',
    seeded.every((t) => /food|bulk/i.test(t.subtype || '')),
    seeded.map((t) => t.subtype || '(unnamed)').join(', ') || 'no tankers at all');

  // Both of the above pass trivially at a carrier that runs no tankers, so drive the seeding path at one
  // that does. Redstone Bulk Lines is a tank carrier; a driver with no hazmat class joining it must
  // still end up with a box they can legally pull, and that is exactly where the wrong one came from.
  await api('/onboarding/market', 'POST', app);
  const tankCo = un(await api('/onboarding/hire', 'POST',
    { application: app, force: true, gameTime: iso(1), code: 'RBL' }));
  console.log(`  ..    joined ${tankCo.company.name} — divisions ${(tankCo.company.divisions || []).join('/')}`);
  const tankYard = tankCo.company.terminals[0];
  await api(`/terminals/${tankYard.id}/level`, 'POST', { level: 'Large' });
  const stocked = un(await api('/fleet/stock', 'POST', {
    terminalId: tankYard.id, count: 2, alreadyBought: true,
    transmissionPreference: 'automatic', addTrailers: true,
  }));
  const afterStock = (stocked.trailers || []).filter((x) => /tanker/i.test(x.type) && !x.retired);
  console.log(`  ..    after stocking: ${afterStock.map((x) => `${x.unit}/${x.subtype || '?'}`).join(', ') || 'no tankers'}`);
  ok('a tank carrier does seed tankers, so this is actually testing something',
    afterStock.length > 0, `${afterStock.length} tanker(s)`);
  ok('but never a placarded one for a driver holding no class',
    afterStock.every((x) => /food|bulk/i.test(x.subtype || '')),
    afterStock.map((x) => x.subtype || '(unnamed)').join(', ') || 'none');

  // Back to the original career for the rest of the suite.
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST',
    { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard2 = S.company.terminals[0];
  S = un(await api(`/terminals/${yard2.id}/level`, 'POST', { level: 'Large' }));

  head('2. Every trailer gets a row, including the one nobody is pulling');
  for (const [u, ty, sub] of [['TB-VAN', 'Dry Van', ''], ['TB-REEF', 'Reefer', ''],
                              ['TB-CHEM', 'Tanker', 'Chemical'], ['TB-OLD', 'Flatbed', '']])
    await api('/fleet/trailer', 'POST', {
      unit: u, type: ty, subtype: sub, division: ty, year: 2019, make: 'Utility', length: "53'",
      inGameGarage: true, status: 'InService', homeTerminalId: yard2.id,
    });
  S = un(await api('/bootstrap'));

  // The three lifetime figures, straight off the Trailer Manager. Deliberately nobody is driving any of
  // these — under the old shape that meant no line at all and no verdict.
  const filed = await api('/fleetops/report', 'POST', {
    periodStartGame: iso(1), periodEndGame: iso(15), notes: 'fixture',
    lines: [],
    trailerLines: [
      { unit: 'TB-VAN', utilisationPct: 82, distanceOnJobMi: 90000, loadsTransported: 140, weightTransportedLbs: 4200000 },
      { unit: 'TB-REEF', utilisationPct: 74, distanceOnJobMi: 70000, loadsTransported: 120, weightTransportedLbs: 3900000 },
      { unit: 'TB-CHEM', utilisationPct: 0, distanceOnJobMi: 0, loadsTransported: 0, weightTransportedLbs: 0 },
      { unit: 'TB-OLD', utilisationPct: 61, distanceOnJobMi: 470000, loadsTransported: 900, weightTransportedLbs: 22000000 },
    ],
  });
  const rep = filed.report;
  const line = (u) => (rep.trailers || []).find((x) => x.unit === u);
  console.log(`  ..    verdicts: ${(rep.trailers || []).map((x) => `${x.unit}=${x.verdict}`).join(', ')}`);

  ok('a report with no drivers but trailers on it still files', !!rep?.number, rep?.number);
  ok('every trailer on the books has a row', (rep.trailers || []).length >= 4,
    `${(rep.trailers || []).length} row(s)`);
  ok('the figures are written through to the trailer', (() => {
    const b = (un(filed).trailers || []).find((x) => x.unit === 'TB-OLD');
    return b && Math.abs(b.distanceOnJobMi - 470000) < 1 && Math.abs(b.loadsTransported - 900) < 1;
  })(), 'distance and loads on file');

  head('3. Worn out and idle are different verdicts with opposite answers');
  ok('a high-mileage box that is still busy reads as worn', line('TB-OLD')?.verdict === 'Worn',
    `${line('TB-OLD')?.verdict}: ${line('TB-OLD')?.headline}`);
  ok('and it is replaced with the same thing, because it earns',
    line('TB-OLD')?.replaceWithType === 'Flatbed', line('TB-OLD')?.replaceWithType || '(none)');

  ok('a box nobody can legally pull is called out immediately', line('TB-CHEM')?.verdict === 'Idle',
    `${line('TB-CHEM')?.verdict}: ${line('TB-CHEM')?.headline}`);
  ok('and the reason is that nobody holds the class, not that it is under-used',
    /cleared|class/i.test((line('TB-CHEM')?.evidence || []).join(' ')),
    (line('TB-CHEM')?.evidence || []).join(' | ').slice(0, 120));
  ok('it is NOT replaced with another chemical tanker',
    (line('TB-CHEM')?.replaceWithSubtype || '') !== 'Chemical',
    `${line('TB-CHEM')?.replaceWithType}/${line('TB-CHEM')?.replaceWithSubtype || '-'}`);
  ok('the replacement is whatever the fleet actually keeps busy',
    ['Dry Van', 'Reefer'].includes(line('TB-CHEM')?.replaceWithType || ''),
    line('TB-CHEM')?.replaceWithType || '(none)');

  ok('a busy, unremarkable box is left alone', line('TB-VAN')?.verdict === 'Keep',
    `${line('TB-VAN')?.verdict}`);

  head('4. No stars on a trailer');
  ok('the report line carries no star rating for a trailer',
    !Object.prototype.hasOwnProperty.call(line('TB-VAN') || {}, 'stars'),
    Object.keys(line('TB-VAN') || {}).join(', ').slice(0, 110));

  head('5. Wear counts the trips and the weight, not just the odometer');
  // From play: "the more a trailer is used and more weight it carries the faster it will wear down."
  // Distance alone carried the whole verdict, so a box doing short heavy turns looked young forever.
  //
  // TB-BUSY has modest miles but a great many heavy loads; TB-EASY has MORE miles on light freight and
  // far fewer of them. Under the old rule neither was worn and the odometer said TB-EASY was the older
  // of the two.
  for (const u of ['TB-BUSY', 'TB-EASY'])
    await api('/fleet/trailer', 'POST', {
      unit: u, type: 'Flatbed', division: 'Flatbed', year: 2019, make: 'Fontaine', length: "48'",
      inGameGarage: true, status: 'InService', homeTerminalId: yard2.id,
    });

  const wear = await api('/fleetops/report', 'POST', {
    periodStartGame: iso(16), periodEndGame: iso(30), notes: 'wear', lines: [],
    trailerLines: [
      // 180k mi, 800 loads at 45,000 lb a trip.
      { unit: 'TB-BUSY', utilisationPct: 88, distanceOnJobMi: 180000, loadsTransported: 800, weightTransportedLbs: 36000000 },
      // 240k mi, 150 loads at 18,000 lb a trip.
      { unit: 'TB-EASY', utilisationPct: 40, distanceOnJobMi: 240000, loadsTransported: 150, weightTransportedLbs: 2700000 },
    ],
  });
  const wl = (u) => (wear.report.trailers || []).find((x) => x.unit === u);
  console.log(`  ..    TB-BUSY (180k mi, 800 heavy loads) = ${wl('TB-BUSY')?.verdict}`);
  console.log(`  ..    TB-EASY (240k mi, 150 light loads) = ${wl('TB-EASY')?.verdict}`);

  ok('the short-haul box working hard is called worn', wl('TB-BUSY')?.verdict === 'Worn',
    `${wl('TB-BUSY')?.verdict}`);
  ok('the higher-mileage box on light work is not', wl('TB-EASY')?.verdict !== 'Worn',
    `${wl('TB-EASY')?.verdict}`);
  ok('so the odometer alone no longer decides it',
    wl('TB-BUSY')?.verdict === 'Worn' && wl('TB-EASY')?.verdict !== 'Worn',
    'fewer miles, more wear');
  ok('and the working is shown, or "worn out" on 180k reads as a mistake',
    /mi of wear once the load cycles/i.test((wl('TB-BUSY')?.evidence || []).join(' ')),
    (wl('TB-BUSY')?.evidence || []).join(' | ').slice(0, 150));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
