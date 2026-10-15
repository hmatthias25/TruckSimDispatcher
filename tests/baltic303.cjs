/* Finland across the Baltic (reported from play, v0.86): Rotterdam to Kokkola, 2,032 km on the listing, planned as a
 * drive straight over the sea with no ferry — the game routes it by Kapellskär and Naantali.
 *
 *   - the mainland to Finland goes round the Baltic, so a listing that short is a route over the water, and planned so
 *   - Tallinn to Helsinki is not 98 km of road across the Gulf of Finland
 *   - with no ProMods country in "Where you run", ProMods' crossings are not planned on
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const DAY = 7;
const KM = 1.609344;

async function at(city, cc) {
  await api('/status', 'POST', { locationCity: city, locationState: cc, locationKind: 'TruckStop', gameTime: iso(DAY),
    fuelPct: 100, atsOdometer: 90000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(DAY),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0 });
}
async function plan(from, to, km, hours) {
  await at(from.city, from.cc);
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: from.city, originState: from.cc, destCity: to.city, destState: to.cc,
    loadedMiles: km / KM, deadheadMiles: 0, gameRevenue: 3000, weightLbs: 30000, atLocation: true, deadlineHours: hours });
  return d.evaluations[0].feasibility;
}

(async () => {
  const app = { driverName: 'B. Altic', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(DAY) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const st = await api('/export');
  st.settings.runnableStates = [];
  await api('/import', 'POST', st);
  const ROT = { city: 'Rotterdam', cc: 'NL' }, KOK = { city: 'Kokkola', cc: 'FI' };

  head('1. Rotterdam to Kokkola, 2,032 km');
  let f = await plan(ROT, KOK, 2032, 90);
  ok('planned over the water', (f.crossingRoutes || []).length > 0, JSON.stringify(f.crossingRoutes));
  ok('  and the plan says the listing is a route over the water', (f.warnings || []).some((w) => /route over the water/.test(w)),
    ((f.warnings || []).find((w) => /water/.test(w)) || '').slice(0, 160));
  ok('  with a ferry step in the timeline', f.timeline.some((t) => /^Ferry /.test(t.label)));

  head('2. Tallinn to Helsinki');
  f = await plan({ city: 'Tallinn', cc: 'EE' }, { city: 'Helsinki', cc: 'FI' }, 90, 30);
  ok('a crossing, not 98 km of road across the Gulf of Finland', (f.crossingRoutes || []).length > 0, JSON.stringify(f.crossingRoutes));

  head('3. No ProMods country in "Where you run"');
  const s2 = await api('/export');
  s2.settings.runnableStates = ['NL', 'DE', 'DK', 'SE', 'FI', 'EE', 'LV', 'LT', 'PL', 'NO', 'RU', 'BE', 'FR'];
  await api('/import', 'POST', s2);
  f = await plan(ROT, KOK, 2032, 90);
  ok('still over the water', (f.crossingRoutes || []).length > 0, JSON.stringify(f.crossingRoutes));
  ok('  and not over a ProMods crossing', !(f.crossingRoutes || []).some((r) => ['stockholm-turku', 'hirtshals-larvik', 'puttgarden-rodby'].includes(r)),
    JSON.stringify(f.crossingRoutes));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
