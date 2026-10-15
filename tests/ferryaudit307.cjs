/* Ferry audit (v0.86): what a sweep of cross-water lanes turned up, after Sundsvall to Vaasa was planned over
 * Kapellskär – Naantali (1,114 km of road) where the game routes it by Umeå and the Wasaline.
 *
 *   - a rest taken before a sailing runs to check-in, not eleven hours and then the wait on the new spread — and so
 *     no second rest on the far side
 *   - a crossing with no road either side (Bari to Durrës, port to port) is still sailed
 *   - Germany to Sweden and Zealand, and Jutland to Norway, go round by road: a short listing is a sailing
 *   - Funen to København is the Great Belt, not back through Jutland
 *   - a ferry whose ports the app cannot place is no shortcut (Skutvik – Svolvær on Rotterdam to Kokkola)
 *   - the road either side of a crossing is the listing less the sea, not the whole listing
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

async function plan(from, to, km, { hours = 120, drive = 9, spread = 13, when = '06:00', sinceWeekly = 0 } = {}) {
  await api('/status', 'POST', { locationCity: from[0], locationState: from[1], locationKind: 'TruckStop', gameTime: iso(DAY, when),
    fuelPct: 100, atsOdometer: 90000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: drive, shiftRemaining: spread, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(DAY, when),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: sinceWeekly });
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: from[0], originState: from[1], destCity: to[0], destState: to[1],
    loadedMiles: km / KM, deadheadMiles: 0, gameRevenue: 3000, weightLbs: 30000, atLocation: true, deadlineHours: hours });
  return d.evaluations[0].feasibility;
}
const routes = (f) => (f.crossingRoutes || []).join('+') || 'road';

(async () => {
  const app = { driverName: 'F. Audit', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(DAY) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const st = await api('/export');
  st.settings.runnableStates = [];
  await api('/import', 'POST', st);

  head('1. Sundsvall to Vaasa, 402 km, starting the afternoon with the spread half gone');
  let f = await plan(['Sundsvall', 'SE'], ['Vaasa', 'FI'], 402, { drive: 4, spread: 6, when: '14:00' });
  ok('over Umeå – Vaasa, the game\'s route', routes(f) === 'umea-vaasa', routes(f));
  const rests = f.timeline.filter((t) => t.kind === 'Rest');
  ok('one rest, run to check-in for the sailing', rests.length === 1 && /check-in|taken as the daily rest/.test(rests[0].label), rests.map((r) => r.label).join(' | '));
  ok('no long on-duty wait at the terminal', !f.timeline.some((t) => t.kind === 'Wait' && t.hours > 1.5),
    f.timeline.filter((t) => t.kind === 'Wait').map((t) => `${t.label} ${t.hours}`).join(' | ') || 'none');
  ok('the road is the listing less the sea: well under the 402 km', f.totalMiles * KM < 340, `${Math.round(f.totalMiles * KM)} km`);

  head('2. Bari to Durrës, port to port');
  f = await plan(['Bari', 'IT'], ['Durrës', 'AL'], 380);
  ok('the crossing is in the plan', f.timeline.some((t) => t.kind === 'Crossing' || /^Ferry /.test(t.label)), routes(f));
  ok('  and takes the time it takes', f.elapsedHours > 9, `${f.elapsedHours} h`);

  head('3. Round by road through Denmark');
  f = await plan(['Berlin', 'DE'], ['Malmö', 'SE'], 450);
  ok('Berlin to Malmö on a 450 km listing is a sailing', (f.crossingRoutes || []).length === 1, routes(f));
  f = await plan(['Rostock', 'DE'], ['København', 'DK'], 230);
  ok('Rostock to København is Gedser', routes(f) === 'rostock-gedser', routes(f));
  f = await plan(['Hamburg', 'DE'], ['Kristiansand', 'NO'], 600);
  ok('Hamburg to Kristiansand on 600 km crosses the Skagerrak', (f.crossingRoutes || []).length === 1, routes(f));
  f = await plan(['Odense', 'DK'], ['København', 'DK'], 165);
  ok('Odense to København is the Great Belt bridge: road at the listing', routes(f) === 'road' && Math.abs(f.totalMiles * KM - 165) < 10,
    `${routes(f)} ${Math.round(f.totalMiles * KM)} km`);

  head('4. Rotterdam to Kokkola');
  f = await plan(['Rotterdam', 'NL'], ['Kokkola', 'FI'], 2789, { hours: 150 });
  ok('over the Baltic, not a Lofoten ferry', (f.crossingRoutes || []).length > 0 && !/skutvik/.test(routes(f)), routes(f));

  head('4b. A 29-hour ferry is the weekly rest only where the six days are nearly up (v0.87)');
  const ferryStep = (p) => p.timeline.find((t) => /^Ferry Travemünde|^Ferry Helsinki/.test(t.label))?.label || '';
  f = await plan(['Rotterdam', 'NL'], ['Kokkola', 'FI'], 2789, { hours: 150 });
  ok('early in the six days: a long daily rest, the six days run on',
    /not your weekly rest/.test(ferryStep(f)) && !f.weeklyRestsRequired, ferryStep(f));
  f = await plan(['Rotterdam', 'NL'], ['Kokkola', 'FI'], 2789, { hours: 150, sinceWeekly: 110 });
  ok('110 hours in: the reduced weekly rest, on board', /reduced weekly rest: your six days were nearly up/.test(ferryStep(f))
    && f.weeklyRestsRequired === 1 && !(f.hotelNights > 0), `${ferryStep(f)} | weekly ${f.weeklyRestsRequired}, hotel ${f.hotelNights}`);

  head('5. Longyearbyen listed as Norway (reported from play)');
  await api('/board/clear', 'POST', {});
  const lyb = await api('/board/add', 'POST', { cargo: 'Used Plastics', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Kokkola', originState: 'FI', destCity: 'Longyearbyen', destState: 'NO', loadedMiles: 1658, deadheadMiles: 0,
    gameRevenue: 3300, weightLbs: 20000, atLocation: true, deadlineHours: 85 });
  const le = lyb.evaluations[0];
  ok('read as Svalbard, not mainland Norway', le.load.destState === 'SJ', le.load.destState);
  ok('and not planned as a road into Norway: no way across, so it is turned down',
    le.feasibility.verdict === 'Infeasible' && (le.feasibility.warnings || []).some((w) => /No way across/.test(w)),
    (le.feasibility.warnings || [])[0]);

  head('6. Kokkola to Yevlakh, Azerbaijan (reported from play)');
  await api('/board/clear', 'POST', {});
  const az = await api('/board/add', 'POST', { cargo: 'Young Seedlings', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Kokkola', originState: 'FI', destCity: 'Yevlakh', destState: 'AZ', loadedMiles: 3794, deadheadMiles: 0,
    gameRevenue: 7693, weightLbs: 6600, atLocation: true, deadlineHours: 173 });
  const ae = az.evaluations[0];
  const azWhy = [...(ae.hardFails || []), ...(ae.feasibility?.blockers || []), ae.reason || ''].join(' | ');
  ok('never run: turned down, not planned as a drive that ends at Tallinn',
    ae.verdict !== 'Accept' && /past anywhere the company runs/.test(JSON.stringify(ae)), azWhy.slice(0, 160));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
