/* Real road distances in Europe (reported from play, v0.87).
 *
 * Kokkola to Groningen over the Helsinki boat: the road from Travemünde to Groningen planned at 247 km, where it is
 * nearer 400, and the driver was late. The app had a straight line and a road factor, and then squeezed the legs
 * either side of the ferry to make the listing add up.
 *
 *   - the legs either side of a crossing are the road as measured (data/eu-roads.txt), not squeezed to the listing
 *   - a load with no crossing still runs on its listing's own distance
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
const KM = 1.609344;

async function plan(from, to, km) {
  await api('/status', 'POST', { locationCity: from[0], locationState: from[1], locationKind: 'Shipper', gameTime: '2000-01-05T06:00',
    fuelPct: 95, atsOdometer: 1, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 1 });
  await api('/board/clear', 'POST', {});
  return (await api('/board/add', 'POST', { cargo: 'P', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: from[0],
    originState: from[1], destCity: to[0], destState: to[1], loadedMiles: km / KM, gameRevenue: 3000, weightLbs: 30000,
    atLocation: true, deadlineHours: 150 })).evaluations[0].feasibility;
}
const legKm = (f, side) => Math.round(f.timeline.filter((t) => t.kind === 'Drive' && t.label.includes(`(${side} the port)`))
  .reduce((a, t) => a + t.miles, 0) * KM);

(async () => {
  const app = { driverName: 'R. Oads', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-05T06:00' });
  const st = await api('/export');
  st.settings.runnableStates = [];
  await api('/import', 'POST', st);

  head('1. Kokkola to Groningen over the Helsinki boat, on two different listings');
  for (const listed of [2465, 2100, 1815]) {
    const f = await plan(['Kokkola', 'FI'], ['Groningen', 'NL'], listed);
    const after = legKm(f, 'from'), before = legKm(f, 'to');
    ok(`listed ${listed} km: Travemünde to Groningen is the road, 330-430 km`, f.crossingRoutes.includes('travemunde-helsinki') ? after >= 330 && after <= 430 : true,
      `${f.crossingRoutes.join('+')}: ${before} km to the port, ${after} km from it`);
    ok(`listed ${listed} km: Kokkola to the port is the road, 440-560 km`, before >= 440 && before <= 560, `${before} km`);
  }

  head('2. No crossing: the listing\'s own distance stands');
  const f = await plan(['Hamburg', 'DE'], ['Groningen', 'NL'], 300);
  ok('Hamburg to Groningen at its listed 300 km', Math.abs(f.totalMiles * KM - 300) < 5, `${Math.round(f.totalMiles * KM)} km`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
