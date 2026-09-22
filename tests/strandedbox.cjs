/* A box left behind at a yard the company moved off, and the one that was never left behind at all.
 *
 * Reported from play off the fleet report: "showing my trailer in Green Bay, a garage we don't have."
 *
 * Choosing a home terminal at hire MOVES the single yard rather than opening a second one — and a
 * trailer records where it is as free text rather than by yard id. So the yard became Phoenix, T501
 * stayed filed in Green Bay, and the fleet report offered a row for a box sitting in a city with no
 * garage, on day one, having never turned a wheel.
 *
 * The move takes the boxes with it now. This covers the careers made before it did, and the guard that
 * keeps the repair from touching anything real: a trailer that has been on a trip has been SOMEWHERE,
 * and where it ended up is not a migration's business.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5994}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

(async () => {
  const app = {
    driverName: 'B. Strand', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 7, homeCity: '', homeState: '', acceptsProbation: true,
    homeTimePreference: 'biweekly', preferredTripLength: 'medium',
  };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'SNI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const hq = `${S.company.terminalCity}, ${S.company.terminalState}`;

  // The reported shape exactly: hired at Schneider, whose HQ is Green Bay, then based at Phoenix. The
  // yard MOVES rather than a second one opening, so after this the company has no garage in Green Bay.
  S = un(await api('/career/domicile', 'POST', { city: 'Phoenix', state: 'AZ' }));
  const yard = `${S.company.terminalCity}, ${S.company.terminalState}`;
  console.log(`  ..    hired at Schneider (HQ ${hq}), based at ${yard}`);
  ok('the company has no yard in the city it was hired from',
    !(S.company.terminals || []).some((t) => t.city === 'Green Bay'), 'none in Green Bay');

  head('1. A career written before the fix, with a box left in the old HQ');
  // Put back by hand rather than by replaying the old bug: the point is that a file in this shape is
  // repaired on load, whatever put it in that shape.
  const raw = await api('/export');
  const box = raw.trailers.find((t) => t.currentLocation);
  box.currentLocation = hq;
  box.homeTerminal = hq;
  raw.schemaVersion = 26;
  S = un(await api('/import', 'POST', raw));

  const fixed = (S.trailers || []).find((t) => t.unit === box.unit);
  console.log(`  ..    ${box.unit}: '${hq}' -> '${fixed.currentLocation}'`);
  ok('the box is brought to the yard that actually exists', fixed.currentLocation === yard,
    fixed.currentLocation);
  ok('and its home yard label agrees', fixed.homeTerminal === yard, fixed.homeTerminal);
  ok('no trailer is left anywhere the company has no garage',
    (S.trailers || []).every((t) => !t.currentLocation
      || (S.company.terminals || []).some((y) => t.currentLocation.includes(y.city))),
    (S.trailers || []).map((t) => t.currentLocation || '—').join(' | '));

  head('2. It is said, not done quietly');
  // A migration that silently rewrites where the player thinks their equipment is would be the app
  // moving property behind their back. It moved a record that was wrong; it says which and why.
  const said = (S.events || []).find((e) => /Corrected where .* trailer/i.test(e.message || ''));
  console.log(`  ..    ${said ? said.message.slice(0, 160) : '(nothing said)'}`);
  ok('the correction is on the log', !!said);
  ok('it names the box that moved', (said?.message || '').includes(box.unit), box.unit);
  ok('and says the truck never actually went there',
    /never actually went there/i.test(said?.message || ''), 'explained');

  head('3. Running it again changes nothing');
  const before = JSON.stringify((S.trailers || []).map((t) => t.currentLocation));
  S = un(await api('/import', 'POST', await api('/export')));
  ok('the repair is stamped and does not run twice',
    JSON.stringify((S.trailers || []).map((t) => t.currentLocation)) === before, 'stable');
  ok('and it does not file a second correction',
    (S.events || []).filter((e) => /Corrected where .* trailer/i.test(e.message || '')).length === 1,
    `${(S.events || []).filter((e) => /Corrected where .* trailer/i.test(e.message || '')).length}`);

  head('4. THE GUARD: a box that has been on a trip is left exactly where it was reported');
  // This is what stops the migration inventing positions. A trailer dropped at a customer sits in a
  // city with no garage and that is entirely normal — the app has a report saying so, and a migration
  // that overrides a report is worse than the gap it fills.
  const raw2 = await api('/export');
  const hauled = raw2.trailers.find((t) => t.currentLocation && t.unit !== box.unit) || raw2.trailers[0];
  hauled.currentLocation = 'Laramie, WY';
  raw2.trips = raw2.trips || [];
  raw2.trips.push({
    id: 'fixture-trip', number: 'SNI-900', status: 'Delivered',
    trailerUnit: hauled.unit, truckUnit: '',
    originCity: S.company.terminalCity, originState: S.company.terminalState,
    destCity: 'Laramie', destState: 'WY',
    dispatchedGameTime: iso(2), deliveredGameTime: iso(3),
  });
  raw2.schemaVersion = 26;
  const S2 = un(await api('/import', 'POST', raw2));
  const kept = (S2.trailers || []).find((t) => t.unit === hauled.unit);
  console.log(`  ..    ${hauled.unit} was hauled to Laramie, WY -> '${kept.currentLocation}'`);
  ok('a box with a trip behind it is not dragged back to the yard',
    kept.currentLocation === 'Laramie, WY', kept.currentLocation);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
