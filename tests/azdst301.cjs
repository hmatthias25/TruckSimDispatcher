/* Arizona on daylight time (reported from play, v0.86): ATS's board prints daylight time — PDT, MDT, CDT — and
 * Arizona does not change its clocks, so its MST is the same clock as California's PDT. The app had Arizona on
 * Mountain time, an hour out.
 *
 *   - daylight time (the default): Las Vegas to Phoenix moves no clock; Phoenix to Denver moves it an hour
 *   - and says so with the names on the board: MST into MDT
 *   - standard time: Arizona is back on Denver's clock — Las Vegas to Phoenix is an hour, Phoenix to Denver none
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
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

async function park(city, st) {
  await api('/status', 'POST', { locationCity: city, locationState: st, locationKind: 'Shipper', gameTime: '2000-01-03T08:00',
    fuelPct: 95, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1, dutyStatus: 'OnDuty', atsBankBalance: 80000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
}
async function settings(over) {
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, ...over });
  return (await api('/bootstrap')).settings;
}
/** The plan's zone note and its due time, for one load. */
async function run(from, to, type) {
  await park(from.city, from.st);
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: type, shipper: 'S', receiver: 'R',
    originCity: from.city, originState: from.st, destCity: to.city, destState: to.st,
    loadedMiles: 300, deadheadMiles: 0, gameRevenue: 1500, weightLbs: 30000, atLocation: true, deadlineHours: 30 });
  const f = d.evaluations[0].feasibility;
  return { note: (f.warnings || []).find((w) => /You cross from/.test(w)) || '', due: f.dueGameTime };
}

(async () => {
  const app = { driverName: 'A. Rizona', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6,
    homeCity: 'Phoenix', homeState: 'AZ', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;
  const LV = { city: 'Las Vegas', st: 'NV' }, PHX = { city: 'Phoenix', st: 'AZ' }, DEN = { city: 'Denver', st: 'CO' };

  head('1. Daylight time, the default');
  const st = await settings({ timeZonesOn: true });
  ok('daylight time is on by default', st.gameDaylightTime === true, String(st.gameDaylightTime));
  let r = await run(LV, PHX, type);
  ok('Las Vegas to Phoenix: no clock change — Arizona is on California time', !r.note, r.note || '(none)');
  ok('  due 30 hours on, on the same clock', r.due === '2000-01-04T14:00', r.due);
  r = await run(PHX, DEN, type);
  ok('Phoenix to Denver: an hour forward', /jumps 1:00 forward/.test(r.note), r.note);
  ok('  named the way the board names them: MST into MDT', /from MST into MDT/.test(r.note), r.note.slice(0, 60));

  head('2. Standard time');
  await settings({ timeZonesOn: true, gameDaylightTime: false });
  r = await run(LV, PHX, type);
  ok('Las Vegas to Phoenix: an hour forward — Arizona is on Denver time', /from PST into MST/.test(r.note) && /1:00 forward/.test(r.note), r.note);
  r = await run(PHX, DEN, type);
  ok('Phoenix to Denver: no clock change', !r.note, r.note || '(none)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
