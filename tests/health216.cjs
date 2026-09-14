/* #215/#216 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the books stop shadowing the ATS bank, and start saying something.
 *
 * A ledger that had to tie out to a number the app cannot see was never free to be interesting. One that
 * is the company's own profit and loss can answer the only question worth asking: is this carrier making
 * money, and what is it going to do about the answer.
 *
 * Plus conduct, which the fleet report never had. The figures said whether a driver was earning; nothing
 * said whether they had put a tractor into a dock post ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so a fleet ran for a game-year without a single
 * preventable, which is a spreadsheet rather than a fleet.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5957}/api`;
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

/* File a period with a given per-driver economics, so the company's fortunes can be steered. */
async function file(day, drivers, perMile, perDay, miles) {
  return api('/fleetops/report', 'POST', {
    periodStartGame: iso(day - 14), periodEndGame: iso(day), notes: '',
    lines: drivers.map((d) => ({
      driverId: d.id, truckUnit: d.assignedTruckUnit,
      level: d.level || 5, rating: d.rating || 7,
      perMile, perDay, truckOdometer: 100000 + day * 400,
    })),
    trailerLines: [],
  });
}

(async () => {
  const app = { driverName: 'H. Ndiaye', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];
  await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' });

  head('1. Pay follows the level ATS gives them');
  // A flat share for everybody said a level 9 and a rookie cost the company the same, so nobody was ever
  // worth keeping in particular.
  // Proved below, once there are drivers of different levels on the books.

  head('2. The books no longer grade themselves against the game');
  const pos = (await api('/bootstrap')).views?.position;
  ok('no variance is reported', pos?.variance === undefined, `variance=${pos?.variance}`);
  ok('no in-sync verdict either', pos?.inSync === undefined, `inSync=${pos?.inSync}`);
  ok('and no reconciliation is owed', !(await api('/bootstrap')).views?.trueUp, 'gone');

  head('3. One report is weather, not climate');
  S = un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(20),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 200000,
  }));
  // Each needs a tractor of their own, or there is nothing for a preventable to damage.
  // Eight drivers across two large yards. A yard holds five tractors and the player's own takes one of
  // them, so they will not all fit at headquarters â€” and spreading them is closer to a real fleet
  // anyway. Eight over forty periods is three hundred driver-periods, which is enough that nought
  // not-at-fault stops being luck and starts being a bug.
  const second = un(await api('/terminals', 'POST', { city: 'Oklahoma City', state: 'OK', level: 'Large' }));
  const yard2 = (second.company.terminals || []).find((x) => x.city === 'Oklahoma City');

  const roster = [['Tom Reaney', 2], ['Ada Vance', 8], ['Kit Moreau', 5], ['Rea Lindqvist', 1],
                  ['Sam Okonjo', 3], ['Bea Hartnell', 6], ['Ivo Marek', 9], ['Nel Castro', 4]];
  for (let i = 0; i < roster.length; i++) {
    const [name, lvl] = roster[i];
    const unit = `F-${i + 1}`;
    const at = i < 4 ? yard.id : (yard2?.id || yard.id);
    await api('/fleet/truck', 'POST', {
      unit, year: 2020, make: 'Kenworth', model: 'T680', engine: 'Paccar MX-13',
      transmission: 'Automatic', governedMph: 65, atsOdometer: 120000, damagePct: 4,
      status: 'InService', inGameGarage: true, homeTerminalId: at,
    });
    // A FIXED id. Conduct is seeded on the career and the driver, and AddDriver mints a GUID when none
    // is given — so without this the whole thing re-rolls every run and no count can be asserted
    // honestly. A seeded system ought to be reproducible on purpose, not only in principle.
    await api('/fleetops/drivers', 'POST', {
      id: `qa-drv-${i + 1}`,
      name, status: 'Active', assignedTruckUnit: unit, assignedTrailerUnit: '',
      homeTerminalId: at, skill: 'Competent', wageShare: 0.3, level: lvl, rating: 7.5,
    });
  }

  S = un(await api('/bootstrap'));
  const drivers = ((await api('/fleetops')).drivers || []).filter((d) => d.status === 'Active');
  console.log(`  ..    ${drivers.length} hired driver(s): ${drivers.map((d) => `${d.name} L${d.level}`).join(', ')}`);

  const rookie = drivers.find((d) => d.level <= 2);
  const veteran = drivers.find((d) => d.level >= 8);
  if (rookie && veteran) {
    console.log(`  ..    shares: L${rookie.level} ${rookie.wageShare}, L${veteran.level} ${veteran.wageShare}`);
    // Pay followed the ATS level for one build and now follows the grade earned here — see rank218,
    // which owns that rule. What this suite cares about is that a new hire is a new hire: a level 12
    // walking in the door is on the same probationary money as a level 1, because neither has done
    // anything for THIS company yet.
    ok('a veteran hired today is on the same money as a rookie hired today',
      veteran.wageShare === rookie.wageShare,
      `${rookie.wageShare} vs ${veteran.wageShare}`);
    ok('and both are inside the band the company offers',
      rookie.wageShare >= 0.25 && veteran.wageShare <= 0.40,
      `${rookie.wageShare} / ${veteran.wageShare}`);
  }

  if (drivers.length === 0) {
    console.log('  ..    no hire endpoint in this shape; the rest needs drivers');
  } else {
    const first = await api('/fleetops/report', 'POST', {
      periodStartGame: iso(6), periodEndGame: iso(20), notes: '',
      lines: drivers.map((d) => ({ driverId: d.id, truckUnit: d.assignedTruckUnit,
        level: d.level, rating: 7.5, perMile: 2.2, perDay: 900, truckOdometer: 120000 })),
      trailerLines: [],
    });
    ok('the first report will not call the company anything',
      first.report?.health?.reportsCounted === 1, `${first.report?.health?.reportsCounted} report(s)`);
    ok('and says why rather than guessing',
      /weather rather than climate/i.test((first.report?.health?.evidence || []).join(' ')),
      (first.report?.health?.evidence || []).join(' ').slice(0, 90));

    head('4. A run of good periods and the company says so');
    let last = null;
    for (let i = 1; i <= 5; i++) {
      const d2 = (await api('/fleetops')).drivers.filter((x) => x.status === 'Active');
      if (!d2.length) break;
      last = await api('/fleetops/report', 'POST', {
        periodStartGame: iso(20 + (i - 1) * 14), periodEndGame: iso(20 + i * 14), notes: '',
        lines: d2.map((d) => ({ driverId: d.id, truckUnit: d.assignedTruckUnit,
          level: d.level, rating: 8, perMile: 3.4, perDay: 1600,
          truckOdometer: 120000 + i * 9000 })),
        trailerLines: [],
      });
    }
    const h = last?.report?.health;
    console.log(`  ..    band ${h?.band}, $${h?.netPerReport}/report over ${h?.reportsCounted}`);
    ok('the company has an opinion once there is history', (h?.reportsCounted || 0) >= 2,
      `${h?.reportsCounted}`);
    ok('and it is a band a driver would recognise',
      ['Thriving', 'Steady', 'Tight', 'Struggling'].includes(h?.band || ''), h?.band);
    ok('with the figures behind it', (h?.evidence || []).length > 0,
      (h?.evidence || [])[0]?.slice(0, 80));

    head('5. Conduct is rolled, and most periods nothing happens');
    let incidents = 0, notAtFault = 0, periods = 0;
    for (let i = 6; i <= 45; i++) {
      const d3 = (await api('/fleetops')).drivers.filter((x) => x.status === 'Active');
      if (!d3.length) break;
      const rep = await api('/fleetops/report', 'POST', {
        periodStartGame: iso(20 + (i - 1) * 14), periodEndGame: iso(20 + i * 14), notes: '',
        lines: d3.map((d) => ({ driverId: d.id, truckUnit: d.assignedTruckUnit,
          level: d.level, rating: 8, perMile: 3.0, perDay: 1400,
          truckOdometer: 120000 + i * 9000 })),
        trailerLines: [],
      });
      periods++;

      const c = rep.report?.conduct || [];
      incidents += c.length;
      notAtFault += c.filter((x) => /NotAtFault/.test(x.severity)).length;
    }
    console.log(`  ..    ${incidents} incident(s) across ${periods} period(s), ${notAtFault} not at fault`);
    ok('things do happen to a fleet', incidents > 0, `${incidents} in ${periods} periods`);
    ok('but not every period to every driver', incidents < periods * 3,
      `${incidents} against a ceiling of ${periods * 3}`);
    ok('and some of it is nobodyÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s fault', notAtFault > 0, `${notAtFault} not at fault`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
