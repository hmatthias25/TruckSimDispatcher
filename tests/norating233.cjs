/* Driver rating is out of the promotion ladder, and off the books entirely.
 *
 * Reported from play: "not sure we should be using rating for anything. Do we know what goes into rating
 * in ATS? it is a mystery to me."
 *
 * It is not a mystery, and it is worse than one. SCS's own reference says rating is "totally based upon
 * combination of Skill sets which he/she upgrades in those six different Skill categories" and has
 * "nothing to do with any other aspect or talent of a Driver, like his/her good, efficient or
 * penalty-free driving." So it measured how the PLAYER had spent the skill points — gating a pay rise
 * on it let the player grant themselves one.
 *
 * And it is not the 0-10 scale it looks like. Rating takes exactly thirteen values:
 *
 *   0.0  0.8  1.7  2.5  3.3  4.2  5.0  5.8  6.7  7.5  8.3  9.2  10.0
 *
 * The old ladder gates were 6.0 / 7.0 / 8.0 / 8.5 / 9.0. None of those is reachable, so each became the
 * next real value up — and 8.5 and 9.0 both became 9.2, making Specialist and Master the same bar.
 * Drivers sat held against a number nobody had written down.
 *
 * Level replaces it: a plain integer off the driver manager, with no scale to fall between.
 *
 * What this suite holds:
 *   1. level gates the ladder, and moving it moves the grade
 *   2. rating does not gate anything, whatever is on the record
 *   3. a career held back by the old rating gate is re-graded on load, and told
 *   4. the shortfall names level, never rating
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5905}/api`;
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
const iso = (d, hm = '06:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
// The roster and the grading live in different places: /export carries the drivers themselves, while
// /fleetops works out the rung and what is standing in the way and returns it as a dossier by id.
const drv = async (name) => ((await api('/export')).hiredDrivers || []).find((d) => d.name === name);
const zone = async (name) => {
  const f = await api('/fleetops');
  const d = (f.drivers || []).find((x) => x.name === name);
  return d ? (f.dossiers || []).find((x) => x.id === d.id) : null;
};

/** A driver whose tenure and miles clear a high rung, so only the level gate is in question. */
function veteran(over) {
  return {
    id: 'drv-vet', name: 'A. Whitlock', status: 'Active', wageShare: 0.30,
    hiredGameDate: iso(1), lifetimeMiles: 250000, level: 30, rating: 0,
    grade: 0, onProbation: false, periods: [], ...over,
  };
}

(async () => {
  const app = { driverName: 'B. Nakamura', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Level gates the ladder');
  // Read off dueRank, not rank. A stored GRADE only moves when something settles it — a fleet report,
  // or the migration below — so `rank` is where the driver was last put. `dueRank` is the rung the
  // ladder says they have earned standing here, which is the thing under test.
  for (const [level, expect] of [[30, 'Master'], [14, 'Lead'], [3, 'Company']]) {
    let st = await api('/export');
    st.status.gameTime = iso(1500);
    st.hiredDrivers = [veteran({ level })];
    S = un(await api('/import', 'POST', st));
    const z = await zone('A. Whitlock');
    console.log(`  ..    level ${level} -> earns ${z?.dueRank || z?.rank}`);
    ok(`level ${level} earns ${expect}`, (z?.dueRank || '').includes(expect), z?.dueRank || '(none)');
  }

  head('2. Rating gates nothing at all');
  // Rating 0.0 on a driver whose tenure, miles and level all clear the top rung. Under the old ladder
  // this was stuck for want of a 9.0 the game could never actually show.
  let st = await api('/export');
  st.status.gameTime = iso(1500);
  st.hiredDrivers = [veteran({ level: 30, rating: 0 })];
  S = un(await api('/import', 'POST', st));
  let z = await zone('A. Whitlock');
  ok('a zero rating does not hold a qualified driver back',
    (z?.dueRank || '').includes('Master'), z?.dueRank || '(nothing due)');

  // And a perfect rating cannot carry an unqualified one.
  st = await api('/export');
  st.status.gameTime = iso(1500);
  st.hiredDrivers = [veteran({ level: 1, rating: 10 })];
  S = un(await api('/import', 'POST', st));
  z = await zone('A. Whitlock');
  ok('and a perfect rating does not promote an unqualified one',
    !(z?.dueRank || '').includes('Master'), z?.dueRank || 'nothing due');

  head('3. The shortfall names level, never rating');
  const gaps = (z?.shortfall || []).join(' | ');
  console.log(`  ..    ${gaps || '(none)'}`);
  ok('it says what level is wanted', /level/i.test(gaps), gaps.slice(0, 110));
  ok('and never mentions rating', !/rating/i.test(gaps), gaps.slice(0, 110));

  head('4. A career held back by the old gate is re-graded on load, and told');
  // The shape the player reported: a driver with the tenure, the miles and the level for a high rung,
  // sitting at a low grade because the old ladder wanted a rating the game does not show.
  st = await api('/export');
  st.schemaVersion = 20;
  st.status.gameTime = iso(1500);
  st.hiredDrivers = [veteran({ grade: 0, level: 30, rating: 5.8 })];
  S = un(await api('/import', 'POST', st));
  const after = await drv('A. Whitlock');
  console.log(`  ..    grade ${after?.grade} · share ${after?.wageShare}`);
  ok('the grade moved up off the stored 0', (after?.grade ?? 0) > 0, `grade ${after?.grade}`);
  ok('and the wage share moved with it', (after?.wageShare ?? 0) > 0.30, `${after?.wageShare}`);

  const events = await api('/events?take=60');
  const said = events.find((e) => /re-graded/i.test(e.message || ''));
  ok('the change is said out loud rather than done quietly', !!said, said?.message?.slice(0, 120) || '(silent)');
  ok('and the note explains why rating went', /rating/i.test(said?.message || ''), 'reason given');

  head('5. It is a one-shot — a hand-set share is not overwritten later');
  st = await api('/export');
  ok('the schema is stamped', (st.schemaVersion ?? 0) >= 21, `v${st.schemaVersion}`);
  st.hiredDrivers = [veteran({ grade: 5, level: 30, wageShare: 0.55, wageShareSetByHand: true })];
  S = un(await api('/import', 'POST', st));
  const byHand = await drv('A. Whitlock');
  ok('a share the player set by hand survives',
    Math.abs((byHand?.wageShare ?? 0) - 0.55) < 0.001, `${byHand?.wageShare}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
