/* Owner-Operator 0.9: the game's companies by the names a renaming mod gives them. Asked for from play: "the company
 * brokers are all game companies, and I use the real companies mod".
 *
 *   - a job shipped by "Exxon" is fuel once the app knows Gallon Oil goes by Exxon
 *   - the company that hires directly goes by what the player's game calls it, and back again when the names are cleared
 *   - a mod that cannot be read says so and changes nothing
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5985}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const shipperNamed = (S, re) => S.directory.find((b) => b.kind === 'Shipper' && re.test(b.name));

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'R. Eal', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '08:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 0, preset: 'Normal' });
  S = (await api('/board/add-many', 'POST', [{ cargo: 'Diesel', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 500,
    deadlineHours: 30, shipper: 'Exxon', trailerType: 'Dry Van' }])).snapshot;

  head('1. Before the names');
  ok('an Exxon job is not known as fuel', S.board[0].trade !== 'Fuel and petroleum', S.board[0].trade);
  ok('the company that hires directly is the game\'s Wallbert', !!shipperNamed(S, /^Wallbert$/));

  head('2. With the names');
  S = await api('/companies', 'POST', { names: { 'Gallon Oil': 'Exxon', 'Wallbert': 'Walmart, Target, Aldi' } });
  ok('the Exxon job is fuel now', S.board[0].trade === 'Fuel and petroleum', S.board[0].trade);
  ok('Wallbert goes by Walmart', !!shipperNamed(S, /^Walmart$/) && !shipperNamed(S, /^Wallbert$/));
  const row = S.companies.find((x) => x.name === 'Wallbert');
  ok('and Settings shows every name, with the list\'s suggestion', row.called === 'Walmart' && row.typed === 'Walmart, Target, Aldi' && row.listed === 'Walmart, Target, Aldi',
    JSON.stringify(row));

  head('3. Cleared');
  S = await api('/companies', 'POST', { names: { 'Gallon Oil': '', 'Wallbert': '' } });
  ok('back to the game\'s names', !!shipperNamed(S, /^Wallbert$/) && S.board[0].trade !== 'Fuel and petroleum');

  head('4. A mod that cannot be read');
  const r = await api('/mod/read', 'POST', { path: 'C:\\no\\such\\mod.scs' });
  ok('says so, and changes nothing', r.ok === false && r.message && !!shipperNamed(r.snapshot, /^Wallbert$/), r.message);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
