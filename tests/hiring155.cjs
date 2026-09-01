/* #155-#157 — the job market, which was a threshold test with bad data behind it.
 *
 *   155  four real megacarriers modelled with the "no gate" sentinel row (99 faults / 100 damage)
 *        and bottom-tier stars, beside the fictional filler
 *   156  probation fixed at three passes for everybody, so the veteran's shortened window allowed
 *        exactly three reviews for the three it required and one bad fortnight was terminal
 *   157  clearing the bar WAS the offer, so a carrier being picky could not be picky, being
 *        over-qualified was worth nothing, and leaving mid-probation cost nothing
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5866}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const app = { driverName: 'M. Halloran', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 6, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
  homeTimePreference: 'biweekly' };
const market = async (a = app) => (await api('/onboarding/market', 'POST', a)).market;
const find = (m, code) => m.find((c) => c.code === code);

(async () => {
  head('1. #155 The big entry-level carriers have real standards');
  let m = await market();
  const majors = ['SNI', 'WER', 'KNX', 'CRE'];
  for (const code of majors) {
    const c = find(m, code);
    ok(`${c.name} has a service standard`, c.minOnTimePct > 0, `${c.minOnTimePct}% on time`);
  }
  const sni = find(m, 'SNI');
  ok('and a fault limit that is not a sentinel', sni.maxDriverFaultIncidents < 99, `${sni.maxDriverFaultIncidents} faults`);
  ok('with stars off the floor', sni.equipmentStars >= 3, `${sni.equipmentStars} equipment stars`);

  head('2. #155 And they are no longer identical to each other');
  const sigs = new Set(majors.map((code) => {
    const c = find(m, code);
    return `${c.minOnTimePct}|${c.maxDriverFaultIncidents}|${c.equipmentStars}|${c.payStars}`;
  }));
  ok('the four differ from one another', sigs.size > 1, `${sigs.size} distinct profiles`);

  const filler = find(m, 'RFS') || find(m, 'CRC');
  if (filler) {
    ok('the sentinel row still belongs to the filler carriers', filler.maxDriverFaultIncidents >= 99,
      `${filler.name}: ${filler.maxDriverFaultIncidents} faults`);
    ok('and they are not confusable with the majors', filler.equipmentStars < sni.equipmentStars,
      `${filler.equipmentStars} vs ${sni.equipmentStars} stars`);
  }

  head('3. #157 Standing is published before you apply');
  // Closed is its own value: a hiring freeze says nothing about the driver, and reporting it as
  // "short of what they want" would send somebody off to fix a record that was never the problem.
  const withStanding = m.filter((c) => c.standing);
  ok('every carrier reports a standing', withStanding.length === m.length,
    `${withStanding.length}/${m.length}`);
  ok('and says what it means', m.every((c) => (c.standingNote || '').length > 0), 'all noted');
  ok('the values are the three the model defines',
    m.every((c) => ['Strong', 'Marginal', 'Short', 'Closed'].includes(c.standing)),
    [...new Set(m.map((c) => c.standing))].join(', '));

  head('4. #157 A clear margin is an offer whatever the quarter looks like');
  const strong = m.filter((c) => c.standing === 'Strong');
  ok('there are carriers this driver clears comfortably', strong.length > 0, `${strong.length}`);
  ok('and every one of them is a yes', strong.every((c) => c.wouldHire === true),
    strong.filter((c) => !c.wouldHire).map((c) => c.code).join(', ') || 'all hire');
  ok('quoted at 100%', strong.every((c) => c.chancePct === 100),
    [...new Set(strong.map((c) => c.chancePct))].join(', '));

  head('5. #157 The roll is seeded — you cannot re-read your way into a job');
  const again = await market();
  const drift = m.filter((c) => find(again, c.code).wouldHire !== c.wouldHire);
  ok('re-reading the market changes nothing', drift.length === 0,
    drift.map((c) => c.code).join(', ') || 'stable');

  head('6. #157 Leaving an unfinished probation is worth about one in ten');
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, code: 'SNI', gameTime: at(1) }));
  ok('the driver is on probation', S.driver.rank === 'probationary', S.driver.rank);

  const onProb = await market();
  // Second-chance carriers are exempt by design — looking past exactly this is what they are for —
  // and a frozen carrier reports the freeze, which is the operative fact there.
  const others = onProb.filter((c) => !c.isCurrentEmployer && !c.isSecondChance && c.standing !== 'Closed');
  ok('there are ordinary carriers to judge', others.length > 0, `${others.length}`);
  // Second-chance carriers are not on this board at all: Market only offers them to a driver who was
  // terminated for cause, and a terminated driver's rank is "terminated", not "probationary". So the
  // exemption inside the screening is belt-and-braces rather than a route out of probation.
  ok('the second-chance carriers are not an escape hatch from probation',
    onProb.filter((c) => c.isSecondChance).length === 0, 'not offered');
  ok('nobody is quoted better than the probation cap',
    others.every((c) => c.chancePct <= 10), `max ${Math.max(...others.map((c) => c.chancePct))}%`);
  ok('and the warning says why, before applying',
    others.every((c) => /still on probation/i.test(c.standingNote || '')),
    (others[0] || {}).standingNote || '(silent)');
  ok('almost none of them would take the application',
    others.filter((c) => c.wouldHire).length <= others.length * 0.25,
    `${others.filter((c) => c.wouldHire).length} of ${others.length}`);

  head('7. #156 Probation scales, and always leaves slack');
  const p = S.driver.probation;
  ok('the plan carries its own passes figure', p.passesRequired > 0, `${p.passesRequired} passes`);
  const reviews = Math.floor(p.durationDays / 14);
  ok('the window outlasts the passes it asks for', reviews >= p.passesRequired + 2,
    `${reviews} reviews available for ${p.passesRequired} required`);
  ok('so one bad fortnight is survivable', reviews - p.passesRequired >= 2,
    `${reviews - p.passesRequired} spare`);
  ok('and the plan says so in words', /review/i.test(p.notes || ''), (p.notes || '').slice(0, 120));

  head('8. #156 Every gate reads the plan, not the old constant');
  // PassesToClear was a const, and five references inside Probation.cs still read it after the figure
  // went per-career — including the auto-clear, so a two-pass probation would never have cleared.
  const want = p.passesRequired;
  const view = (await api('/bootstrap')).views.probation;
  ok('the view quotes the plan', view.passesNeeded === want, `${view.passesNeeded} vs ${want}`);
  // Whole numbers only, and deliberately without a regex: a word-boundary escape written through a
  // template literal is a backspace character, not a boundary, and the assertion then passes forever.
  const quoted = String(view.standing || '').match(/[0-9]+/g) || [];
  ok('and the standing text does too', quoted.includes(String(want)),
    `quotes ${quoted.join(', ') || 'no numbers'} — wanted ${want}`);

  let refusal = '';
  try { await api('/career/clear-probation', 'POST', { force: false, note: 'gate check' }); }
  catch (e) { refusal = e.message; }
  ok('clearing early is refused', refusal.length > 0, refusal.slice(0, 90) || '(allowed!)');
  ok('and the refusal counts against the plan, not a constant',
    new RegExp(`against ${want} required`).test(refusal), refusal.slice(0, 110));


  head('9. #158 The card leads with what YOU would be paid');
  const board = await market();
  const priced = board.filter((c) => c.startingCpm > 0);
  ok('every carrier quotes a starting rate', priced.length === board.length,
    `${priced.length}/${board.length}`);
  ok('and it is under the company rate, because every hire is probationary',
    priced.every((c) => c.startingCpm < c.loadedCpm),
    priced.filter((c) => c.startingCpm >= c.loadedCpm).map((c) => c.code).join(', ') || 'all lower');
  ok('roughly the probationary multiplier off it',
    priced.every((c) => Math.abs(c.startingCpm / c.loadedCpm - 0.9) < 0.06),
    `${priced[0].code}: ${priced[0].startingCpm} vs ${priced[0].loadedCpm}`);
  ok('the comparison against what you earn now is made for you',
    priced.every((c) => c.currentCpm > 0), `current $${priced[0].currentCpm}`);

  // The number on the card has to be the number in the books, or the driver was misled by the app
  // that then paid them something else.
  const target = board.find((c) => c.wouldHire && !c.isCurrentEmployer && c.standing === 'Strong');
  if (target) {
    const quoted = target.startingCpm;
    await api('/career/clear-probation', 'POST', { force: true, note: 'so the move can land' });
    const movedTo = un(await api('/market/apply', 'POST', { code: target.code, reason: 'pay check' }));
    ok(`what ${target.code} quoted is what got paid`,
      Math.abs(movedTo.driver.pay.loadedCpm - quoted) < 0.0005,
      `quoted $${quoted}, paid $${movedTo.driver.pay.loadedCpm}`);
  } else {
    ok('no strong-standing carrier to move to this run', true, 'skipped');
  }


  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
