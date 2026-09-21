/* Canada had no coordinates at all, which made the "Where you run" setting a trap.
 *
 *   "do you have C2C cities in the coordinate map? (example Memphis or Indianapolis)"
 *
 * Memphis and Indianapolis, yes — us-cities.txt is a full US gazetteer, 29,738 rows across all fifty
 * states, not a base-ATS list. Eastern coverage is dense, so C2C's American half was always measured.
 *
 * What the question turned up is that there was not one Canadian row in the table, and Geo.Centers held
 * states only. So the region list added for C2C would happily let a driver switch Ontario on, and then
 * every distance rule went silent the moment the truck crossed:
 *
 *   - the home-time outbound ceiling passed unmeasured, on "unmeasurable is not the same as unacceptable"
 *   - the unquoted-deadhead estimate was skipped
 *   - the home-time scorer said it could not tell whether the load moved you toward home
 *
 * The ceiling is the thing that stops a two-days-from-home driver being sent to California. Switching
 * Ontario on quietly switched that off for anything north of the border.
 *
 * So: GeoNames populated places, all ten provinces and three territories, in the same format and read by
 * the same loader. Provincial centroids too, on the same footing as the states — the answer for a town
 * the table has never heard of, and rough by construction, which is why Knows() tells a measurement
 * from a placeholder.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const q = (s) => encodeURIComponent(s);
const dist = (ca, sa, cb, sb) => api(`/geo/distance?cityA=${q(ca)}&stateA=${sa}&cityB=${q(cb)}&stateB=${sb}`);

let S, odo = 100000;

(async () => {
  head('1. The table holds both countries');
  const meta = await api('/geo/meta');
  console.log(`  ..    ${meta.knownCityCount.toLocaleString('en-US')} cities loaded`);
  ok('well past the US file on its own', meta.knownCityCount > 45000, `${meta.knownCityCount}`);

  head('2. The cities that prompted the question');
  for (const [c, st] of [['Memphis', 'TN'], ['Indianapolis', 'IN']]) {
    const r = await dist(c, st, 'Springfield', 'MO');
    console.log(`  ..    ${c}, ${st} → Springfield, MO: ${r.miles?.toFixed(0)} mi, measured ${r.measured}`);
    ok(`${c} is measured, not guessed`, r.measured === true && r.miles > 0, `${r.miles?.toFixed(0)} mi`);
  }

  head('3. Canada is measured now, coast to coast');
  // Spot checks with a known answer. Toronto to Detroit is a genuine lane; Vancouver to Halifax is the
  // width of the country and is there to catch a province mapped to the wrong centroid.
  const cases = [
    ['Toronto', 'ON', 'Detroit', 'MI', 200, 320],
    ['Montreal', 'QC', 'Boston', 'MA', 280, 400],
    ['Winnipeg', 'MB', 'Fargo', 'ND', 200, 300],
    ['Calgary', 'AB', 'Great Falls', 'MT', 300, 420],
    ['Vancouver', 'BC', 'Seattle', 'WA', 110, 190],
    // Straight line plus the road factor, which is what this app promises and all it promises. Real
    // road miles here are nearer 570, because you drive around the Bay of Fundy and the formula cannot
    // know there is water in the way. Pinned at what the documented arithmetic actually gives, not at
    // what a route planner would say — the bounds are a check on the coordinates, not on the model.
    ['Halifax', 'NS', 'Bangor', 'ME', 270, 360],
    ['Vancouver', 'BC', 'Halifax', 'NS', 3000, 3900],
  ];
  for (const [ca, sa, cb, sb, lo, hi] of cases) {
    const r = await dist(ca, sa, cb, sb);
    const good = r.measured === true && r.miles >= lo && r.miles <= hi;
    console.log(`  ..    ${ca}, ${sa} → ${cb}, ${sb}: ${r.miles?.toFixed(0)} mi (expect ${lo}-${hi})`);
    ok(`${ca} to ${cb} lands where it should`, good, `${r.miles?.toFixed(0)} mi, measured ${r.measured}`);
  }

  head('4. Every province and territory has cities in it');
  const provs = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
  const capitals = { AB: 'Edmonton', BC: 'Victoria', MB: 'Winnipeg', NB: 'Fredericton',
    NL: "St. John's", NS: 'Halifax', NT: 'Yellowknife', NU: 'Iqaluit', ON: 'Toronto',
    PE: 'Charlottetown', QC: 'Quebec', SK: 'Regina', YT: 'Whitehorse' };
  const missing = [];
  for (const p of provs) {
    const r = await dist(capitals[p], p, 'Toronto', 'ON');
    if (r.measured !== true) missing.push(`${capitals[p]}, ${p}`);
  }
  ok('all thirteen answer with a measured distance', missing.length === 0,
    missing.length ? `missing: ${missing.join('; ')}` : provs.join(' '));

  head('5. Accents fold, because that is how the game spells them');
  // The shipped rows are ASCII. What a driver types, or pastes out of the game, may not be.
  for (const [typed, st] of [['Montréal', 'QC'], ['Québec', 'QC'], ['Trois-Rivières', 'QC'],
                             ['Rivière-du-Loup', 'QC']]) {
    const r = await dist(typed, st, 'Toronto', 'ON');
    console.log(`  ..    ${typed}, ${st}: ${r.miles?.toFixed(0)} mi, measured ${r.measured}`);
    ok(`"${typed}" finds its row`, r.measured === true, `measured ${r.measured}`);
  }
  // And the plain spelling of the same place lands on the same coordinates.
  const acc = await dist('Montréal', 'QC', 'Toronto', 'ON');
  const plain = await dist('Montreal', 'QC', 'Toronto', 'ON');
  ok('accented and plain are the same place', Math.abs(acc.miles - plain.miles) < 0.5,
    `${acc.miles?.toFixed(1)} vs ${plain.miles?.toFixed(1)}`);

  head('6. The census name and the name everybody uses both work');
  const greater = await dist('Greater Sudbury', 'ON', 'Toronto', 'ON');
  const plainSud = await dist('Sudbury', 'ON', 'Toronto', 'ON');
  console.log(`  ..    Greater Sudbury ${greater.miles?.toFixed(0)} mi / Sudbury ${plainSud.miles?.toFixed(0)} mi`);
  ok('Sudbury resolves as well as Greater Sudbury',
    plainSud.measured === true && Math.abs(greater.miles - plainSud.miles) < 0.5,
    `${plainSud.miles?.toFixed(1)}`);

  head('7. An unknown Canadian town falls back to the province, and says so');
  // Same contract as a mod town in the US: an answer, flagged as not a measurement, so the callers that
  // must not invent miles can tell the difference.
  const modTown = await dist('Nordkapp Junction', 'ON', 'Toronto', 'ON');
  console.log(`  ..    ${modTown.miles?.toFixed(0)} mi, measured ${modTown.measured}`);
  ok('the province centroid answers', modTown.miles > 0, `${modTown.miles?.toFixed(0)} mi`);
  ok('but it is not passed off as measured', modTown.measured === false, `measured ${modTown.measured}`);

  head('8. The home-time ceiling now works north of the border');
  // The point of the whole exercise. Two days from home with the yard in Springfield, a load into
  // Ontario is 800-odd miles further out and has to be refused the same way California is — which it
  // could not be while Toronto had no coordinates.
  const app = { driverName: 'H. Bound', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // Ontario switched on, or the map gate refuses it before home time ever gets a look.
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, runnableStates: [...(cur.runnableStates || []), 'ON'] });

  odo += 400;
  S = un(await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(13),
    fuelPct: 90, atsOdometer: odo, truckDamagePct: 2, dutyStatus: 'OnDuty',
  }));
  const hs = (await api('/bootstrap')).views.homeTime;
  console.log(`  ..    due in ${hs.daysUntilDue.toFixed(1)} days, allowance ${hs.outboundAllowance} mi`);

  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Wichita', originState: 'KS', destCity: 'Toronto', destState: 'ON',
    loadedMiles: 1100, deadheadMiles: 0, gameRevenue: 5200, deadlineHours: 72,
    weightLbs: 34000, atLocation: true,
  });
  const e = (bd.evaluations || [])[0];
  const bar = (e.homeTimeFails || []).join(' | ');
  console.log(`  ..    ${bar.slice(0, 150) || '(allowed)'}`);
  ok('a run into Ontario two days from home is refused', !!bar);
  ok('and the reason has a real distance in it, not a shrug',
    /\d[\d,]* mi further/i.test(bar), bar.match(/[\d,]+ mi further/)?.[0] || '(no figure)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
