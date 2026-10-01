/* #267 - step 1 of Euro Truck Simulator 2 support (#266): the game is chosen per career.
 *
 * Only ATS exists yet, and this step changes no behaviour: the US tables are reached through a game
 * profile instead of directly. What it has to prove is the seam itself - that every career knows its
 * game, that careers written before the field existed are ATS, that something it does not recognise
 * falls back to ATS rather than breaking, and that the tables still answer for the career that is open.
 * Everything else the ATS build does is the other 153 suites, unchanged.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5975}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const gameOf = async () => (await api('/bootstrap')).game;

(async () => {
  head('1. A career knows its game');
  const app = { driverName: 'L. Petrov', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) });
  let g = await gameOf();
  ok('the snapshot says which game', !!g && !!g.id, JSON.stringify(g));
  ok('and a new career is ATS', g?.id === 'ATS', g?.id);
  ok('by its full name too', g?.name === 'American Truck Simulator', g?.name);
  const careers = (await api('/careers')).careers || [];
  ok('the career list carries the game', careers.length > 0 && careers.every((c) => c.game === 'ATS'),
    careers.map((c) => `${c.label}=${c.game}`).join(', '));

  head('2. A career written before the field existed is ATS');
  const state = await api('/export');
  ok('the career file stores the game', state.game === 'ATS', String(state.game));
  delete state.game;
  await api('/import', 'POST', state);
  g = await gameOf();
  ok('a file with no game opens as ATS', g?.id === 'ATS', g?.id);
  const back = await api('/export');
  ok('and is saved as ATS from then on', back.game === 'ATS', String(back.game));

  head('3. Something it does not recognise falls back to ATS');
  back.game = 'NotAGame';
  await api('/import', 'POST', back);
  g = await gameOf();
  ok('an unknown game answers as ATS', g?.id === 'ATS', g?.id);

  head('4. The tables answer through the profile, for the career that is open');
  // Each of these reads a table that now sits behind the profile. They are spot checks that the seam
  // hands back the same data - the full behaviour is the rest of the suite.
  const boot = await api('/bootstrap');
  const v = boot.views || {};
  ok('the regions a driver can run are the US states and provinces',
    JSON.stringify(v).includes('"MO"'), 'Missouri is offered');
  const fuel = boot.settings?.fuelPricePerGal;
  ok('fuel still has a price', fuel > 0, String(fuel));
  const keys = [...new Set((JSON.stringify(boot).match(/"key":"(\d)"/g) || []).map((k) => k.slice(7, 8)))].sort().join(',');
  ok('the HazMat classes are the six ATS unlocks', keys === '1,2,3,4,6,8', keys);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
