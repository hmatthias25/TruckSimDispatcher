/* Issues #84 and #85: the skills ATS levels up, and two ranks that were never in scope.
 *
 * #84 — a driver with Fragile maxed and one who has never hauled a pane of glass looked identical to
 * every carrier on the market. The player reports their levels; carriers hire on them, at different
 * levels depending on the outfit; and turning up already levelled starts you above probation.
 *
 * #85 — Lease-Purchase Operator and Owner-Operator are not what this app simulates, and were paid as
 * though they were: $1.28 and $1.65 a loaded mile against $0.60 for a company driver.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5979}/api`;
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
const iso = (d) => `2000-01-${String(d).padStart(2, '0')}T08:00`;

let S;
const app = { driverName: 'L. Veller', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 9, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
  homeTimePreference: 'biweekly' };

(async () => {
  head('1. #85 Nothing on the ladder is a lease or an owner-operator any more');
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  const titles = [];
  for (const rank of ['company', 'senior', 'lead', 'lease', 'owner']) {
    S = un(await api('/career/promote', 'POST', { rank, force: true, note: 'fixture' }));
    titles.push(`${rank}=${S.driver.rankTitle} $${(+S.driver.pay.loadedCpm).toFixed(3)}`);
  }
  console.log(`     ${titles.join(' | ')}`);
  const all = titles.join(' ');
  ok('no Lease-Purchase Operator', !/Lease-Purchase/i.test(all), all.slice(0, 90));
  ok('no Owner-Operator', !/Owner-Operator/i.test(all), '');
  ok('the top two are Specialist and Master Driver',
    /Specialist Driver/.test(all) && /Master Driver/.test(all), '');

  head('2. #85 And they are paid on a company scale, not owner gross');
  S = un(await api('/career/promote', 'POST', { rank: 'company', force: true, note: 'fixture' }));
  const companyRate = +S.driver.pay.loadedCpm;
  S = un(await api('/career/promote', 'POST', { rank: 'owner', force: true, note: 'fixture' }));
  const topRate = +S.driver.pay.loadedCpm;
  ok('the top rung still pays more than a company driver', topRate > companyRate,
    `$${companyRate.toFixed(3)} -> $${topRate.toFixed(3)}`);
  ok('but it is not owner-operator money', topRate < companyRate * 2,
    `$${topRate.toFixed(3)} against $${companyRate.toFixed(3)} — ${(topRate / companyRate).toFixed(2)}x`);

  head('3. #84 Skills go on the file, and only the player can put them there');
  S = un(await api('/career/skills', 'POST', { longDistance: 3, highValue: 2, fragile: 4, justInTime: 1 }));
  ok('they are recorded', S.driver.skills.fragile === 4,
    `LD ${S.driver.skills.longDistance} HV ${S.driver.skills.highValue} FR ${S.driver.skills.fragile} JIT ${S.driver.skills.justInTime}`);
  S = un(await api('/career/skills', 'POST', { fragile: 99 }));
  ok('and clamped to the top of the scale', S.driver.skills.fragile === 5, `${S.driver.skills.fragile}`);
  S = un(await api('/career/skills', 'POST', { longDistance: -4 }));
  ok('and to the bottom', S.driver.skills.longDistance === 0, `${S.driver.skills.longDistance}`);
  ok('a value left out is left alone', S.driver.skills.highValue === 2, `${S.driver.skills.highValue}`);

  head('4. #84 Carriers ask for different levels, and rookie fleets ask for none');
  await api('/career/skills', 'POST', { longDistance: 0, highValue: 0, fragile: 0, justInTime: 0 });
  const market = (await api('/onboarding/market', 'POST', app)).market || [];
  const asking = market.filter((c) => (c.skillsWanted || []).length);
  const silent = market.filter((c) => !(c.skillsWanted || []).length);
  ok('some carriers want skills', asking.length > 0,
    asking.slice(0, 4).map((c) => `${c.code}:${c.skillsWanted.join('+')}`).join(' '));
  ok('and some want none', silent.length > 0, silent.slice(0, 5).map((c) => c.code).join(', '));
  ok('a rookie fleet is one of the ones asking for none',
    silent.some((c) => c.takesRookies), silent.filter((c) => c.takesRookies).map((c) => c.code).join(', ') || 'none');

  // The reported requirement: the SAME skill at different levels across carriers.
  const levels = {};
  for (const c of asking)
    for (const w of c.skillsWanted) {
      const m = w.match(/^(.*) (\d)$/);
      if (m) (levels[m[1]] ||= new Set()).add(+m[2]);
    }
  const varied = Object.entries(levels).filter(([, v]) => v.size > 1);
  ok('the same skill is wanted at different levels by different carriers', varied.length > 0,
    varied.map(([k, v]) => `${k}: ${[...v].sort().join('/')}`).join(' · ') || 'all the same');

  head('5. #84 Being short is a refusal that names the level');
  const wants = asking[0];
  const gaps = (wants.skillShortfall || []).join(', ');
  ok('the shortfall is spelled out', gaps.length > 0, gaps.slice(0, 110));
  ok('with the level they want and the level held', /\d.*you are at \d/.test(gaps), gaps.slice(0, 110));
  const reasons = (wants.screening?.reasons || []).join(' | ');
  ok('and the screening says it too', /wants|level it up|Career tab/i.test(reasons), reasons.slice(0, 140));

  head('6. #84 Levelled up, the same carrier takes you');
  await api('/career/skills', 'POST', { longDistance: 5, highValue: 5, fragile: 5, justInTime: 5 });
  const after = ((await api('/onboarding/market', 'POST', app)).market || [])
    .find((c) => c.code === wants.code);
  ok('no shortfall now', (after.skillShortfall || []).length === 0,
    (after.skillShortfall || []).join(', ') || 'clear');
  ok('and clearing the bar by a margin starts you above probation',
    after.startsAboveProbation === true, `${after.startsAboveProbation}`);

  head('7. #84 Skills survive a change of employer');
  const before = (await api('/bootstrap')).driver.skills.fragile;
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(3), code: after.code }));
  ok('still on the file at the new carrier', S.driver.skills.fragile === before,
    `${before} -> ${S.driver.skills.fragile}`);
  ok('and the driver came in above probation', S.driver.rank !== 'probationary',
    `${S.driver.rank} / ${S.driver.rankTitle}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
