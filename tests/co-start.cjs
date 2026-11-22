/* Coach Driver 0.1: the first screen, the companies and joining one.
 *
 *   - the roster: line operators, tour houses and mixed firms, in three tiers, Real or Invented names
 *   - every depot is a city on the ETS2 map
 *   - a rookie can join a budget company; a premium one says what it wants first
 *   - joining: probation, the bottom rank, a home depot, an assigned coach to buy in the game
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5991}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };

(async () => {
  head('1. Before a career: the roster');
  let S = await api('/bootstrap');
  ok('not started', S.started === false);
  const kinds = new Set(S.companies.map((c) => c.kind));
  ok('line operators, tour houses and mixed firms', kinds.has('Line') && kinds.has('Tour') && kinds.has('Mixed'), [...kinds].join(','));
  ok('three tiers', new Set(S.companies.map((c) => c.tier)).size === 3);
  ok('real names by default', S.companies.some((c) => c.name === 'FlixBus'));
  const minDepots = Math.min(...S.companies.map((c) => c.depots.length));
  ok('several depots each: more than a haulier\'s yards', minDepots >= 5, `fewest ${minDepots}`);
  ok('a premium company wants a record first', S.companies.find((c) => c.id === 'regiojet').whyNot.length > 0,
    S.companies.find((c) => c.id === 'regiojet').whyNot.join(' | '));
  ok('a budget company takes a rookie', S.companies.find((c) => c.id === 'blablacar').whyNot.length === 0);
  ok('a rookie can be based at Frankfurt with a budget company', S.companies.some((c) => c.tier === 1
    && c.depots.some((d) => d.key === 'Frankfurt am Main|DE')), 'BlaBlaCar Bus');

  head('2. Joining');
  let why = await refused(() => api('/start', 'POST', { driverName: 'C. Oach', coachLevel: 0, roster: 'Real', day: 1, time: '07:00',
    companyId: 'regiojet', homeDepot: 'Praha|CZ' }));
  ok('a premium company refuses a rookie, and says why', /will not take you yet/.test(why || ''), why);
  why = await refused(() => api('/start', 'POST', { driverName: 'C. Oach', coachLevel: 0, day: 1, time: '07:00',
    companyId: 'blablacar', homeDepot: 'Praha|CZ' }));
  ok('a home depot must be one of theirs', /not one of/.test(why || ''), why);
  const r = await api('/start', 'POST', { driverName: 'C. Oach', coachLevel: 1, skills: { demandingTimetables: 9 }, roster: 'Real',
    day: 1, time: '07:00', companyId: 'blablacar', homeDepot: 'Paris|FR' });
  S = r.snapshot;
  ok('started', S.started === true, r.said);
  ok('on probation, at the bottom', S.job.onProbation && S.job.rank === 1 && S.job.rankName === 'Probationary driver');
  ok('a skill is capped at 6', S.profile.skills.demandingTimetables === 6);
  ok('home is the Paris depot, and that is where the driver is', S.job.home === 'Paris, FR' && S.place === 'Paris, FR' && S.atHome);
  ok('a coach assigned, to buy in the game', !!S.job.coachModel && S.job.coachBought === false, `${S.job.coachModel} ${S.job.fleetNumber}`);
  ok('the rate is the budget tier\'s', S.job.rate === 14.5, S.job.rate);
  const away = S.depots.filter((d) => !d.here);
  ok('every other depot is on the map, with a distance', away.length >= 5 && away.every((d) => d.km > 0),
    away.map((d) => `${d.city} ${d.km}`).join(', '));
  ok('the home depot is reached; the others are not yet', S.depots.find((d) => d.home).reached && away.every((d) => !d.reached));
  ok('breaks are off by default', S.settings.breaks === false);
  ok('the clocks are open, fully rested', S.hours && S.hours.driveLeft >= 9 && S.hours.weekLeft === 56, JSON.stringify(S.hours).slice(0, 120));
  ok('a second start is refused', /career is running/.test(await refused(() => api('/start', 'POST', { driverName: 'X', companyId: 'blablacar', homeDepot: 'Paris|FR' })) || ''));

  head('3. Invented names');
  S = await api('/settings', 'POST', { roster: 'Invented' });
  ok('the companies take their invented names', S.job.company.name === 'Rideshare Coachlines' && !S.companies.some((c) => c.name === 'FlixBus'), S.job.company.name);
  S = await api('/settings', 'POST', { roster: 'Real' });

  head('4. The coach is bought');
  S = await api('/coach/bought', 'POST', {});
  ok('confirmed', S.job.coachBought === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
