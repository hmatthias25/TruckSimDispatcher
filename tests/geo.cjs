/* Distances are measured from real city coordinates, not guessed from state centroids.
   The old table returned a flat 130 mi for ANY two cities in the same state, which made Amarillo to
   Houston look the same as Colorado Springs to Denver — and since the home radius is 200 mi, that made
   anywhere in your home state count as being home. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5720}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

const dist = async (a, sa, b, sb) =>
  api(`/geo/distance?cityA=${encodeURIComponent(a)}&stateA=${sa}&cityB=${encodeURIComponent(b)}&stateB=${sb}`);

/** Real road distances, for reference. Straight line plus a road factor will not match exactly. */
const CASES = [
  ['Colorado Springs', 'CO', 'Denver', 'CO', 70],
  ['Amarillo', 'TX', 'Houston', 'TX', 600],
  ['Dallas', 'TX', 'Houston', 'TX', 240],
  ['Los Angeles', 'CA', 'San Francisco', 'CA', 380],
  ['Los Angeles', 'CA', 'Bakersfield', 'CA', 110],
  ['Denver', 'CO', 'Salt Lake City', 'UT', 520],
  ['Chicago', 'IL', 'Detroit', 'MI', 280],
  ['Seattle', 'WA', 'Portland', 'OR', 175],
  ['Phoenix', 'AZ', 'Tucson', 'AZ', 115],
  ['Atlanta', 'GA', 'Nashville', 'TN', 250],
];

(async () => {
  head('1. The table shipped and loaded');
  const meta = await api('/geo/meta');
  ok('tens of thousands of cities are on file', meta.knownCityCount > 25000, `${meta.knownCityCount} cities`);

  head('2. Same-state pairs are no longer all the same number');
  const cs = await dist('Colorado Springs', 'CO', 'Denver', 'CO');
  const ah = await dist('Amarillo', 'TX', 'Houston', 'TX');
  ok('Colorado Springs to Denver is a short hop', cs.miles < 130, `${cs.miles} mi`);
  ok('Amarillo to Houston is not', ah.miles > 400, `${ah.miles} mi`);
  ok('and the two are no longer identical', cs.miles !== ah.miles, `${cs.miles} vs ${ah.miles}`);
  ok('both are measured, not guessed', cs.measured && ah.measured, `${cs.measured}/${ah.measured}`);

  head('3. Within sight of the real road distances');
  for (const [a, sa, b, sb, real] of CASES) {
    const r = await dist(a, sa, b, sb);
    // Great-circle plus a road factor: within 35% of the real road miles is the bar.
    const off = Math.abs(r.miles - real) / real;
    ok(`${a} → ${b}`, off <= 0.35, `${r.miles} mi vs ~${real} real (${(off * 100).toFixed(0)}% off)`);
  }

  head('4. Same city is zero, whatever the punctuation');
  for (const [a, b] of [['St. Louis', 'Saint Louis'], ['Coeur d\'Alene', 'Coeur dAlene'], ['Denver', 'denver']]) {
    const r = await dist(a, a === 'Denver' ? 'CO' : (a.includes('Louis') ? 'MO' : 'ID'),
                         b, a === 'Denver' ? 'CO' : (a.includes('Louis') ? 'MO' : 'ID'));
    ok(`"${a}" and "${b}" are the same place`, r.miles === 0, `${r.miles} mi`);
  }

  head('5. Cities the app has never heard of still resolve');
  // Not in the app's own 425-city market table, but real US cities a map mod may well add.
  for (const [c, st] of [['Kalamazoo', 'MI'], ['Yakima', 'WA'], ['Laramie', 'WY'], ['Dubuque', 'IA']]) {
    const r = await dist(c, st, 'Denver', 'CO');
    ok(`${c}, ${st} is on the map`, r.measured === true && r.miles > 0, `${r.miles} mi`);
  }

  head('6. A city nobody knows falls back honestly');
  const made = await dist('Nonexistentville', 'CO', 'Denver', 'CO');
  ok('an answer still comes back', made.miles > 0, `${made.miles} mi`);
  ok('but it is flagged as not measured', made.measured === false, `${made.measured}`);
  const noState = await dist('Somewhere', 'ZZ', 'Denver', 'CO');
  ok('an unknown state gives no answer at all', noState.miles === null, JSON.stringify(noState.miles));

  head('7. The home radius no longer swallows a whole state');
  // 200 mi is the default home radius. Amarillo must not read as "home" for a Houston driver.
  ok('Amarillo is well outside a 200 mi radius of Houston', ah.miles > 200, `${ah.miles} mi`);
  ok('Colorado Springs IS inside 200 mi of Denver', cs.miles < 200, `${cs.miles} mi`);

  console.log(`\n${pass} passed, ${fail} failed`);
  // Set the code and let node wind down on its own. Calling process.exit() straight after a
  // burst of fetches trips a libuv assertion on Windows while the sockets are still closing.
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
