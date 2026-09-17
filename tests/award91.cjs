/* Issues #91 and #92: squaring the books against the game, and the truck a Master Driver earns.
 *
 * #91 — the app keeps the books and ATS keeps the bank balance, and nothing reconciled them. They drift
 * the moment anything is bought in game the app never posted. Weekly now, prompted on a Monday, and the
 * books only ever come UP to the game: if the game is short, that is money to put back with a save
 * editor, not something the company quietly writes off.
 *
 * #92 — every other reward here is a number on a settlement. This is the one visible out of the
 * windscreen, so it is a choice from the flagships and the long-nose classics.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5961}/api`;
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
// day(n) is 2000-01-n, and the epoch is the 1st — so GAME day is n-1. Monday is game day 0, 7, 14...
const day = (n, hm = '08:00') => `2000-01-${String(n).padStart(2, '0')}T${hm}`;

let S;
async function report(d, balance) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: day(d),
    fuelPct: 90, atsOdometer: 4000 + d * 100, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: balance,
  }));
  return S;
}

(async () => {
  const app = { driverName: 'T. Opdog', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(2), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. #215 There is no reconciliation to owe');
  // #91 put a weekly true-up on the driver: square the carrier's books against the game, and where ATS
  // held less, put the difference back with a save editor. That was the app asking somebody to edit
  // their save so its bookkeeping came out right. The books are a profit and loss now, not a bank to be
  // tied out, and the game is simply the world.
  ok('nothing is owed against the books', !(await api('/bootstrap')).views?.trueUp,
    JSON.stringify((await api('/bootstrap')).views?.trueUp ?? null));
  ok('and the position does not grade itself against them',
    (await api('/bootstrap')).views?.position?.inSync === undefined,
    `inSync=${(await api('/bootstrap')).views?.position?.inSync}`);

  head('4. #92 The award is offered at the top of the ladder, not before');
  let sc = (await api('/bootstrap')).views.showcase;
  ok('nothing on offer as a company driver', sc.offered === false, `offered=${sc.offered}`);

  const ceiling = (await api('/bootstrap')).views.career.ceilingRank;
  S = un(await api('/career/promote', 'POST', { rank: ceiling, force: true, note: 'fixture' }));
  ok('promoted to the top of THIS carrier', S.driver.rank === ceiling,
    `${S.driver.rankTitle} (${ceiling})`);
  sc = (await api('/bootstrap')).views.showcase;
  ok('the truck is on offer', sc.offered === true, `offered=${sc.offered}`);
  console.log(`     employer equipment standard: ${S.company.equipmentStars} star(s)`);

  head('5. #92 The list is flagships and long noses, spec-ed properly');
  const names = (sc.choices || []).map((x) => `${x.make} ${x.model}`);
  ok('there is a real choice', (sc.choices || []).length >= 5, `${(sc.choices || []).length} trucks`);
  const stars = S.company.equipmentStars;
  const chrome = names.some((x) => /389|W900/.test(x));
  if (stars >= 4) {
    ok('a good carrier hands over the long noses', chrome, names.join(', ').slice(0, 110));
    ok('and the big engines with them',
      (sc.choices || []).some((x) => x.hp >= 600),
      `up to ${Math.max(...sc.choices.map((x) => x.hp))} hp`);
  } else {
    ok('a rookie outfit does not hand out chrome', !chrome,
      `${stars}-star employer: ${names.join(', ').slice(0, 90)}`);
    ok('but it is still a decent late-model truck',
      (sc.choices || []).some((x) => x.year >= 2017), 
      `newest ${Math.max(...sc.choices.map((x) => x.year))}`);
  }
  // The list used to mark choices that went against a transmission preference taken at hire. There is
  // no such preference any more — an award truck is a reward and the gearbox is the driver's to pick —
  // so what matters is that both kinds are actually on offer rather than one being quietly filtered out.
  ok('both gearboxes are on the list, not just one',
    new Set((sc.choices || []).map((x) => x.transType)).size > 1,
    [...new Set((sc.choices || []).map((x) => x.transType))].join(', '));

  head('6. #92 Taking one orders it, and says what happens to the old truck');
  const manual = (sc.choices || []).find((x) => !x.matchesPreference) || sc.choices[0];
  const oldUnit = S.driver.assignedTruckUnit;
  const took = await api('/career/showcase', 'POST', { index: manual.index });
  ok('an order was raised', !!took.order?.number, took.order?.number || 'none');
  ok('it names the truck picked', /\d{4}/.test(took.picked || ''), (took.picked || '').slice(0, 90));
  ok('and says what becomes of the one being left',
    /sell|move into yours|spare/i.test(took.order?.instruction || ''),
    (took.order?.instruction || '').slice(-140));
  ok('the old unit is named in that instruction',
    new RegExp(oldUnit).test(took.order?.instruction || ''), `${oldUnit}`);

  const after92 = (await api('/bootstrap'));
  ok('the offer is spent', after92.views.showcase.offered === false, `${after92.views.showcase.offered}`);
  if (!manual.matchesPreference) {
    ok('and picking a different gearbox updates the preference',
      after92.application.transmissionPreference === manual.transType,
      `now ${after92.application.transmissionPreference}`);
  }

  head('7. #92 It is offered once');
  let again = null;
  try { await api('/career/showcase', 'POST', { index: 0 }); } catch (e) { again = e.message; }
  ok('asking twice is refused', again !== null, (again || '(allowed!)').slice(0, 90));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
