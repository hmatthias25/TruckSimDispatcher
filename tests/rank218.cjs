/* #216/#217/#218 - a hired driver's level gets a name, and their record stops scrolling away.
 *
 * The level was already doing real work: wages come off it, so do the odds of them hitting something,
 * and the company sends the player out to hire at one. It was simply never said out loud, so the fleet
 * table showed a 6 and the player got to guess what a 6 was.
 *
 * And conduct lived on the report it arrived on and nowhere else. A driver with three scrapes across six
 * reports read exactly like one who had never touched anything, because the scrapes went off the bottom
 * of the page with the report that carried them.
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
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const dz = (fo, id) => (fo.dossiers || []).find((x) => x.id === id) || {};

(async () => {
  const app = { driverName: 'P. Okafor', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];
  await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' });

  S = un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(20),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 200000,
  }));

  // Two large yards, because a yard holds five tractors and the player's own takes one of them.
  const second = un(await api('/terminals', 'POST', { city: 'Oklahoma City', state: 'OK', level: 'Large' }));
  const yard2 = (second.company.terminals || []).find((x) => x.city === 'Oklahoma City');

  // One driver in every band the rank ladder has, plus one with no level reported at all — which is the
  // case the ladder must refuse to answer rather than call a rookie.
  const roster = [['Rea Lindqvist', 1], ['Sam Okonjo', 3], ['Kit Moreau', 5],
                  ['Ivo Marek', 7], ['Ada Vance', 9], ['Bea Hartnell', 12], ['Nel Castro', 0],
                  ['Tom Reaney', 2]];
  for (let i = 0; i < roster.length; i++) {
    const [name, lvl] = roster[i];
    const unit = `F-${i + 1}`;
    const at = i < 4 ? yard.id : (yard2?.id || yard.id);
    await api('/fleet/truck', 'POST', {
      unit, year: 2020, make: 'Kenworth', model: 'T680', engine: 'Paccar MX-13',
      transmission: 'Automatic', governedMph: 65, atsOdometer: 120000, damagePct: 4,
      status: 'InService', inGameGarage: true, homeTerminalId: at,
    });
    // Pinned ids. Conduct is seeded on the career and the driver, so a minted GUID would re-roll the
    // whole thing every run and nothing below could be asserted honestly.
    await api('/fleetops/drivers', 'POST', {
      id: `qa-rank-${i + 1}`, name, status: 'Active', assignedTruckUnit: unit,
      assignedTrailerUnit: '', homeTerminalId: at, skill: 'Competent',
      wageShare: 0.3, level: lvl, rating: 7.5,
    });
  }

  head('1. A level has a name, and it is the ladder the player climbs');
  let fo = await api('/fleetops');
  const want = [
    ['qa-rank-1', 1, 'Probationary Company Driver', 'Probationary'],
    ['qa-rank-2', 3, 'Company Driver', 'Company'],
    ['qa-rank-3', 5, 'Senior Company Driver', 'Senior'],
    ['qa-rank-4', 7, 'Lead Driver', 'Lead'],
    ['qa-rank-5', 9, 'Specialist Driver', 'Specialist'],
    ['qa-rank-6', 12, 'Master Driver', 'Master'],
  ];
  for (const [id, lvl, full, short] of want) {
    const d = dz(fo, id);
    ok(`level ${lvl} is ${short}`, d.rank === full && d.rankShort === short, `${d.rank} / ${d.rankShort}`);
  }

  head('2. A level nobody has reported is not a rank');
  const blank = dz(fo, 'qa-rank-7');
  ok('no rank is invented for an unreported level', blank.rank === '' && blank.rankShort === '',
    `rank="${blank.rank}"`);
  ok('and the summary says what to do about it', /file a fleet report/i.test(blank.summary || ''),
    (blank.summary || '').slice(0, 70));

  head('3. The rung says what the next one costs');
  ok('a level 1 is pointed at level 3', dz(fo, 'qa-rank-1').nextAt === 3, `${dz(fo, 'qa-rank-1').nextAt}`);
  ok('and the top of the scale is not', dz(fo, 'qa-rank-6').nextAt == null, `${dz(fo, 'qa-rank-6').nextAt}`);

  head('4. Rank and pay tell the same story');
  const drivers = (fo.drivers || []).filter((d) => d.status === 'Active');
  const byId = (id) => drivers.find((d) => d.id === id);
  ok('a Master is paid more than a Probationary',
    byId('qa-rank-6').wageShare > byId('qa-rank-1').wageShare,
    `${byId('qa-rank-1').wageShare} vs ${byId('qa-rank-6').wageShare}`);
  ok('and Senior sits between them',
    byId('qa-rank-3').wageShare > byId('qa-rank-1').wageShare
    && byId('qa-rank-3').wageShare < byId('qa-rank-6').wageShare,
    `${byId('qa-rank-3').wageShare}`);

  head('5. Nothing on the record before anybody has been seen work');
  ok('a brand-new roster has no conduct at all',
    (fo.dossiers || []).every((d) => d.incidents === 0), 'clean');

  head('6. Run the fleet, and the record accumulates');
  let periods = 0;
  for (let i = 1; i <= 40; i++) {
    const active = (await api('/fleetops')).drivers.filter((x) => x.status === 'Active');
    if (!active.length) break;
    await api('/fleetops/report', 'POST', {
      periodStartGame: iso(20 + (i - 1) * 14), periodEndGame: iso(20 + i * 14), notes: '',
      lines: active.map((d) => ({ driverId: d.id, truckUnit: d.assignedTruckUnit,
        level: d.level, rating: 8, perMile: 3.0, perDay: 1400,
        truckOdometer: 120000 + i * 9000 })),
      trailerLines: [],
    });
    periods++;
  }
  fo = await api('/fleetops');
  const all = fo.dossiers || [];
  const incidents = all.reduce((n, d) => n + d.incidents, 0);
  const preventables = all.reduce((n, d) => n + d.preventables, 0);
  console.log(`  ..    ${periods} period(s) filed; ${incidents} incident(s), ${preventables} preventable`);
  for (const d of fo.drivers)
    console.log(`  ..    ${d.name.padEnd(16)} L${String(d.level).padEnd(3)} ${String(d.status).padEnd(11)}` +
      ` ${String(d.reportsFiled).padStart(3)} report(s)  ${dz(fo, d.id).incidents} incident(s)`);
  ok('things happened over a game-year', incidents > 0, `${incidents}`);

  head('7. A record outlives the report it arrived on');
  // The reports endpoint hands back the last 20. Anything older than that is off the page entirely, so a
  // dossier citing one is the whole point: the driver's file is not a view of what is still on screen.
  const shown = new Set((fo.reports || []).map((r) => r.number));
  const older = all.flatMap((d) => d.conduct).filter((c) => !shown.has(c.reportNumber));
  ok('conduct is still readable from reports that have scrolled off',
    older.length > 0, `${older.length} line(s) older than the last ${shown.size} reports`);

  head('8. Every line says who, when and on what report');
  const lines = all.flatMap((d) => d.conduct);
  ok('each carries a report number', lines.every((c) => !!c.reportNumber), `${lines.length} line(s)`);
  ok('and a game time', lines.every((c) => !!c.gameTime), `${lines.length} line(s)`);
  const owned = all.every((d) => d.conduct.every((c) => typeof c.outcome === 'string' && c.outcome.length > 0));
  ok('and reads as something that happened', owned, 'outcomes present');

  head('9. Being hit is on the record and not against you');
  const noFault = lines.filter((c) => !c.preventable);
  ok('some of it was nobody\'s doing', noFault.length > 0, `${noFault.length} of ${lines.length}`);
  ok('preventables are the smaller count', preventables === lines.length - noFault.length,
    `${preventables} preventable, ${noFault.length} not`);
  ok('and a not-at-fault write-off still does not count against them',
    noFault.every((c) => /NotAtFault/.test(c.severity)),
    noFault.map((c) => c.severity).join(', ').slice(0, 60));

  head('10. A driver with a record reads differently to one without');
  const marked = all.filter((d) => d.preventables > 0);
  const clean = all.filter((d) => d.incidents === 0);
  console.log(`  ..    ${marked.length} driver(s) carrying a preventable, ${clean.length} clean`);
  ok('the fleet is not uniform', marked.length > 0, `${marked.map((d) => d.preventables).join(',')}`);

  head('11. Two runs of the same career tell the same story');
  const again = await api('/fleetops');
  const sig = (x) => (x.dossiers || []).map((d) => `${d.id}:${d.incidents}:${d.preventables}`).join('|');
  ok('the record is read, not re-rolled', sig(again) === sig(fo), sig(again).slice(0, 70));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
