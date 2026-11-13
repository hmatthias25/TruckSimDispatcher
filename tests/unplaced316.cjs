/* A town the map cannot place is said, with the spelling it probably meant.
 *
 * Reported from play on 2026-11-04: "Gedster, DK" was taken without a word, placed about 600 km from Rotterdam where
 * Gedser is nearer 1,000, and home time's trigger read the wrong distance off it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5959}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const at = (city, state, hm) => api('/status', 'POST', { locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: `2000-01-02T${hm}` });

(async () => {
  const app = { driverName: 'U. Nplaced', preferredDivision: 'Dry Van', experienceYears: 3, acceptsProbation: true };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });

  head('1. America: a slip of the keyboard');
  let r = await at('Dalas', 'TX', '08:00');
  ok('said, with the town it probably is', /cannot find Dalas, TX/.test(r.unplaced || '') && /Did you mean Dallas\?/.test(r.unplaced), r.unplaced);
  ok('and in the log', r.snapshot.events.some((e) => /cannot find Dalas/.test(e.message)));
  r = await at('Dallas', 'TX', '09:00');
  ok('spelled right, nothing to say', !r.unplaced, r.unplaced);
  r = await at('Dallas', 'TX', '10:00');
  ok('and not on a report that does not move', !r.unplaced);

  head('2. Europe: Gedster for Gedser');
  await api('/careers/new', 'POST', { name: 'Euro', game: 'ETS2' });
  const st = await api('/export');
  if (st.game !== 'ETS2') {
    ok('(could not open an ETS2 career here)', true);
  } else {
    await api('/onboarding/market', 'POST', app);
    await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
    r = await at('Gedster', 'DK', '08:00');
    ok('Gedster is not on the map, and Gedser is offered', /cannot find Gedster/.test(r.unplaced || '') && /Did you mean Gedser\?/.test(r.unplaced), r.unplaced);
    r = await at('Gedser', 'DK', '09:00');
    ok('Gedser is', !r.unplaced, r.unplaced);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
