/* Issues #75 and #76: what a carrier pays, how far it promotes, and asking for credentials that exist.
 *
 * #76 — several carriers demanded a "Tanker endorsement". The app's own endorsement model says there is
 * no such thing and it is right: a tanker is a trailer, and what gates it is what is inside. A fuel
 * tanker is class 3, a gas tanker class 2, a food-grade tanker nothing at all.
 *
 * #75 — rank used to carry flat rates for everybody, so a senior driver at a bargain fleet earned the
 * same as one at the best carrier on the list, and there was no reason to ever move. Carriers now have
 * their own scale and their own ceiling, and the driver is told when they hit it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5970}/api`;
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
const at = (d, hm = '08:00') =>
  `2000-${String(Math.floor((d - 1) / 28) + 1).padStart(2, '0')}-${String(((d - 1) % 28) + 1).padStart(2, '0')}T${hm}`;

const REAL_CLASSES = ['1', '2', '3', '4', '6', '8'];
let S;

(async () => {
  const base = { driverName: 'S. Kale', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  const market = await api('/onboarding/market', 'POST', base);
  const list = market.market || [];
  ok('the job market lists carriers', list.length > 5, `${list.length} carriers`);

  head('1. #76 Nothing asks for a credential that is not real');
  ok('no carrier requires a "tanker endorsement"',
    list.every((c) => c.requiresTanker === undefined || c.requiresTanker === false),
    list.filter((c) => c.requiresTanker).map((c) => c.code).join(', ') || 'none');
  const placarded = list.filter((c) => (c.requiresClasses || []).length);
  ok('the ones that need something name hazmat classes', placarded.length > 0,
    placarded.map((c) => `${c.code}:${c.requiresClasses.join('+')}`).join(' '));
  ok('and every class named is one ATS actually has',
    placarded.every((c) => c.requiresClasses.every((k) => REAL_CLASSES.includes(k))),
    placarded.flatMap((c) => c.requiresClasses).join(', '));
  ok('each is described in words too',
    placarded.every((c) => /class \d/.test(c.requiresClassesLabel || '')),
    placarded[0]?.requiresClassesLabel || '');

  head('2. #76 A fuel hauler wants class 3, not a trailer licence');
  const fuel = placarded.find((c) => c.requiresClasses.includes('3'));
  ok('at least one carrier wants class 3', !!fuel,
    fuel ? `${fuel.code}: ${fuel.requiresClasses.join('+')}` : '(none in this market)');
  ok('and says so in words', /flammable liquid/i.test(fuel?.requiresClassesLabel || ''),
    fuel?.requiresClassesLabel);
  const dryBulk = list.find((c) => c.code === 'RBL' || /pneumatic/i.test((c.divisions || []).join(' ')));
  if (dryBulk) ok('a dry-bulk hauler is not asked for the impossible',
    (dryBulk.requiresClasses || []).every((k) => REAL_CLASSES.includes(k)),
    `${dryBulk.code}: ${(dryBulk.requiresClasses || []).join('+') || 'nothing'}`);

  head('3. #76 Nothing anywhere is turned down over a tanker endorsement');
  const allReasons = list.flatMap((c) => (c.screening?.reasons) || []).join(' ');
  ok('no screening reason mentions one', !/tanker endorsement/i.test(allReasons),
    (allReasons.match(/[^.]*tanker[^.]*/i) || ['none'])[0].slice(0, 110));
  const hazReasons = placarded.flatMap((c) => (c.screening?.reasons) || []).join(' ');
  ok('a placarded carrier that turns you down says what the freight is',
    !/hazmat/i.test(hazReasons) || /placarded|class \d/i.test(hazReasons),
    (hazReasons.match(/[^.]*(placarded|hazmat)[^.]*/i) || ['(not screened on hazmat here)'])[0].slice(0, 130));

  head('4. #75 Carriers have their own scale, and their own ceiling');
  ok('every offer says how far it promotes',
    list.every((c) => !!c.ceilingTitle), list.filter((c) => !c.ceilingTitle).map((c) => c.code).join(', ') || 'all do');
  ok('and what the top of the scale pays',
    list.every((c) => +c.topLoadedCpm >= +c.loadedCpm),
    list.filter((c) => +c.topLoadedCpm < +c.loadedCpm).map((c) => c.code).join(', ') || 'all sane');
  const ceilings = [...new Set(list.map((c) => c.ceilingTitle))];
  ok('they do not all stop in the same place', ceilings.length > 1, ceilings.join(' | '));
  const tops = [...new Set(list.map((c) => +c.topLoadedCpm))];
  ok('and they do not all pay the same at the top', tops.length > 1,
    `${Math.min(...tops)} .. ${Math.max(...tops)}`);

  head('5. #75 A better carrier pays more at the top');
  const best = list.slice().sort((a, b) => +b.topLoadedCpm - +a.topLoadedCpm)[0];
  const worst = list.slice().sort((a, b) => +a.topLoadedCpm - +b.topLoadedCpm)[0];
  ok('there is a real spread to move for', +best.topLoadedCpm > +worst.topLoadedCpm,
    `${best.code} $${best.topLoadedCpm} vs ${worst.code} $${worst.topLoadedCpm}`);

  head('6. #75 Probation pays under the carrier scale, so clearing it is worth something');
  // Whoever is on offer — the market shows a subset, so naming one carrier would be a coin flip.
  const pri = list.find((c) => c.code === 'PRI') || list.find((c) => !(c.requiresClasses || []).length) || list[0];
  S = un(await api('/onboarding/hire', 'POST', { application: base, force: true, gameTime: at(1), code: pri.code }));
  const probRate = +S.driver.pay.loadedCpm;
  ok('hired under their posted rate', probRate < +pri.loadedCpm,
    `${pri.code}: $${probRate} against a posted $${pri.loadedCpm}`);
  S = un(await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' }));
  const compRate = +S.driver.pay.loadedCpm;
  ok('clearing probation is a real raise', compRate > probRate, `$${probRate} -> $${compRate}`);
  ok('and it is THIS carrier\'s company rate', Math.abs(compRate - +pri.loadedCpm) < 0.02,
    `$${compRate} against posted $${pri.loadedCpm}`);

  head('7. #75 Told once when the ladder runs out here');
  const ceilingRank = S.views.career.ceilingRank;
  ok('the career view names the ceiling', !!S.views.career.ceilingTitle,
    `${ceilingRank} / ${S.views.career.ceilingTitle}`);
  // Force up to whatever this carrier tops out at, then report in.
  await api('/career/promote', 'POST', { rank: ceilingRank, force: true, note: 'fixture' });
  S = un(await api('/bootstrap'));
  ok('now standing on it', S.views.career.atCeiling === true, `${S.driver.rank} / atCeiling=${S.views.career.atCeiling}`);

  const r1 = await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: at(30),
    fuelPct: 80, atsOdometer: 40000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  ok('the driver is told', !!r1.advance, r1.advance ? r1.advance.headline : '(nothing said)');
  if (r1.advance) {
    ok('framed as a ceiling, not a promotion', r1.advance.kind === 'ceiling', r1.advance.kind);
    ok('it points at the job market',
      (r1.advance.detail || []).some((d) => /job market/i.test(d)),
      (r1.advance.detail || []).join(' | ').slice(-110));
    ok('and explains that carriers differ',
      (r1.advance.detail || []).some((d) => /own scale|pays more at every rank/i.test(d)), '');
  }
  const r2 = await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: at(31),
    fuelPct: 80, atsOdometer: 40400, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  ok('and not told again every time they report in', !r2.advance,
    r2.advance ? 'repeated: ' + r2.advance.headline : 'said once');

  head('8. #75 Holding an endorsement is worth money');
  S = un(await api('/bootstrap'));
  const before = +S.driver.pay.hazmatCpm;
  await api('/career/endorsement', 'POST', { kind: '3', has: true, gameTime: at(31) });
  S = un(await api('/career/endorsement', 'POST', { kind: '1', has: true, gameTime: at(31) }));
  const after = +S.driver.pay.hazmatCpm;
  ok('the hazmat premium went up', after > before, `$${before} -> $${after} per placarded mile`);
  ok('explosives is worth more than the base', after >= 0.09, `$${after}`);
  ok('the classes are on file', (S.views.endorsements?.held || []).includes('1'),
    (S.views.endorsements?.held || []).join(', '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
