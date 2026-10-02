/* ETS2 city names (reported from play, v0.80): blank distances and an unrealistic delivery, because the place
 * list knew Hannover and Köln but not Hanover and Cologne — the names ETS2's cargo list shows in English.
 *
 *   - the English names the game shows, the local ones, and either without accents all find the city
 *   - a name two places share in a country is the bigger one: Halle is Halle (Saale), by Leipzig
 *   - accents beyond Latin-1 fold: Rīga, Plzeň, İstanbul, Łódź
 *   - every ETS2 and ProMods market city has coordinates
 *   - an ETS2 career shows the English names: the carriers
 */
const fs = require('fs');
const path = require('path');
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
const dist = (a, sa, b, sb) => api(`/geo/distance?cityA=${encodeURIComponent(a)}&stateA=${sa}&cityB=${encodeURIComponent(b)}&stateB=${sb}`);

(async () => {
  await api('/career/game', 'POST', { game: 'ETS2' });

  head('1. The names the cargo list shows');
  const pairs = [['Hanover', 'Hannover', 'DE'], ['Cologne', 'Köln', 'DE'], ['Munich', 'München', 'DE'], ['Nuremberg', 'Nürnberg', 'DE'],
    ['Vienna', 'Wien', 'AT'], ['Prague', 'Praha', 'CZ'], ['Brussels', 'Brussel', 'BE'], ['Warsaw', 'Warszawa', 'PL'],
    ['Copenhagen', 'København', 'DK'], ['Gothenburg', 'Göteborg', 'SE'], ['Milan', 'Milano', 'IT'], ['Lisbon', 'Lisboa', 'PT'],
    ['Bucharest', 'București', 'RO'], ['Belgrade', 'Beograd', 'RS'], ['Athens', 'Athina', 'GR'], ['Riga', 'Rīga', 'LV']];
  const bad = [];
  for (const [en, local, cc] of pairs) {
    const a = await dist(en, cc, 'Paris', 'FR'); const b = await dist(local, cc, 'Paris', 'FR');
    if (!a.measured || !b.measured || Math.abs(a.miles - b.miles) > 1) bad.push(`${en}/${local}`);
  }
  ok('English and local name, the same place', bad.length === 0, bad.join(', '));
  const cg = await dist('Cologne', 'DE', 'Groningen', 'NL');
  ok('Cologne to Groningen is measured, not a guess', cg.measured && cg.miles > 150 && cg.miles < 230, `${cg.miles} mi`);

  head('2. A shared name is the bigger place');
  const halle = await dist('Halle', 'DE', 'Leipzig', 'DE');
  ok('Halle is Halle (Saale), by Leipzig, not the Westphalian town 200 km off', halle.measured && halle.miles < 40, `${halle.miles} mi`);

  head('3. Accents beyond Latin-1, either way');
  for (const [a, b, cc] of [['Riga', 'Rīga', 'LV'], ['Plzen', 'Plzeň', 'CZ'], ['Istanbul', 'İstanbul', 'TR'], ['Lodz', 'Łódź', 'PL'],
    ['Iasi', 'Iași', 'RO'], ['Klaipeda', 'Klaipėda', 'LT'], ['Kosice', 'Košice', 'SK'], ['Thorlakshofn', 'Þorlákshöfn', 'IS']]) {
    const x = await dist(a, cc, 'Paris', 'FR'); const y = await dist(b, cc, 'Paris', 'FR');
    ok(`${b} and ${a}`, x.measured && y.measured && Math.abs(x.miles - y.miles) < 1, `${x.miles} / ${y.miles}`);
  }

  head('4. Every game city has coordinates');
  const src = fs.readFileSync(path.join(__dirname, '..', 'Services', 'Ets2Data.Generated.cs'), 'utf8');
  const i = src.indexOf('MarketTable = """');
  const rows = src.slice(i, src.indexOf('""";', i)).split('\n').slice(1).map((l) => l.trim().split('|')).filter((r) => r.length >= 5 && r[1].length === 2);
  const missing = [];
  for (const [city, cc] of rows) if (!(await dist(city, cc, 'Paris', 'FR')).measured) missing.push(`${city}, ${cc}`);
  // Zeni is a ProMods village with no published location: it falls back to Georgia's centre.
  ok(`all ${rows.length} market cities but Zeni are placed`, missing.length === 1 && missing[0] === 'Zeni, GE', missing.join('; '));

  head('5. An ETS2 career shows the English names');
  const market = (await api('/onboarding/market', 'POST', { driverName: 'T. Test', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, acceptsProbation: true })).market || [];
  const shown = JSON.stringify(market);
  ok('carriers head offices and yards in English: no Köln, München, Wien or Göteborg', !/Köln|München|Wien|Göteborg/.test(shown),
    (shown.match(/.{30}(Köln|München|Wien|Göteborg).{20}/) || [''])[0]);
  ok('and Munich, Cologne, Vienna or Gothenburg where they appear', /Munich|Cologne|Vienna|Gothenburg|Hanover/.test(shown));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
