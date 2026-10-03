/* ETS2 vehicle codes as country codes (reported from play, v0.80).
 *
 * A screenshot read stored "Parma, I" and "Porto-Vecchio, F" — the codes the game prints — and nothing keyed by
 * country knew them: Corsica was not an island, so a ferry run was planned by road, with a 21-hour wait for the
 * window that read as a ferry wait nobody explained.
 *
 *   - a board entry with vehicle codes is stored on the app's codes, and the crossing is planned
 *   - so is a status report
 *   - and a career already holding them is put right by the migration
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

(async () => {
  const app = { driverName: 'C. Rossi', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-04T00:58' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. A status report with a vehicle code');
  await api('/status', 'POST', { locationCity: 'Parma', locationState: 'I', locationKind: 'Shipper', gameTime: '2000-01-04T00:58',
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  let boot = await api('/bootstrap');
  ok('"I" is stored as IT', boot.status.locationState === 'IT', boot.status.locationState);

  head('2. Parma, I to Porto-Vecchio, F off the board: the codes put right, and the ferry planned');
  await api('/hos', 'POST', { driveRemaining: 10, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: '2000-01-04T00:58',
    euWeekDriven: 0, euLastWeekDriven: 0, spreadEstimated: true });
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Empty Barrels', trailerType: 'Dry Van', shipper: 'Stellantis', receiver: 'Tirrenia',
    originCity: 'Parma', originState: 'I', destCity: 'Porto-Vecchio', destState: 'F', loadedMiles: 395, deadheadMiles: 0, gameRevenue: 4373,
    weightLbs: 19842, atLocation: true, deadlineHours: 50 });
  const e = d.evaluations[0];
  ok('stored as IT and FR', e.load.originState === 'IT' && e.load.destState === 'FR', `${e.load.originState} → ${e.load.destState}`);
  ok('the Marseille – Porto-Vecchio crossing is in the plan', (e.feasibility.crossingRoutes || []).includes('marseille-portovecchio'),
    JSON.stringify(e.feasibility.crossingRoutes));
  for (const [code, want] of [['A', 'AT'], ['D', 'DE'], ['E', 'ES'], ['GB', 'UK'], ['SLO', 'SI'], ['CH', 'CH'], ['Italy', 'IT'], ['fr', 'FR']]) {
    await api('/board/clear', 'POST', {});
    const x = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', originCity: 'Parma', originState: 'IT', destCity: 'Milan',
      destState: code, loadedMiles: 80, gameRevenue: 900, weightLbs: 20000, atLocation: true, deadlineHours: 20 });
    ok(`"${code}" is ${want}`, x.evaluations[0].load.destState === want, x.evaluations[0].load.destState);
  }

  head('3. The migration: a career already holding vehicle codes');
  const st = await api('/export');
  st.schemaVersion = 33;
  st.status.locationState = 'I';
  st.trailers.forEach((t) => { if (t.currentLocation) t.currentLocation = 'Parma, I'; });
  st.trips = st.trips || [];
  if (st.trips[0]) { st.trips[0].originState = 'I'; st.trips[0].destState = 'F'; }
  st.discovered = (st.discovered || []).concat([{ city: 'Innsbruck', state: 'A', discoveredGameTime: '2000-01-03T02:34', tripNumber: '', garageAvailable: true }]);
  await api('/import', 'POST', st);
  boot = await api('/bootstrap');
  const back = await api('/export');
  ok('status back on IT', back.status.locationState === 'IT', back.status.locationState);
  ok('the trailer is at "Parma, IT"', back.trailers.some((t) => t.currentLocation === 'Parma, IT'), JSON.stringify(back.trailers.map((t) => t.currentLocation)));
  ok('Innsbruck discovered in AT', back.discovered.some((x) => x.city === 'Innsbruck' && x.state === 'AT'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
