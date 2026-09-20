/* A probationary driver on the full company rate.
 *
 *   "Why am I making .57/mile as a probationary driver at Prime? I noticed that no other company I look
 *    at starts that high including the more premier ones. This seems like a bug."
 *
 * It is, and $0.57 is the tell: it is Prime's POSTED rate — the figure a cleared company driver earns.
 * The probationary multiplier is nine tenths of the posted rate, so the answer is $0.513, and a hire
 * made today gets exactly that. The second half of the observation is the same fact seen from outside:
 * nothing else on the board they could actually get hired by started as high, because the number was
 * never a starting rate.
 *
 * Carriers.ApplyPayScale says why it exists in as many words — "without this an experienced hire started
 * ON the company rate, and clearing probation was worth nothing at all: same money, new title". Pay is
 * written at hire and then only ever rewritten by a promotion or a carrier change, so a career made
 * before that landed carries the old number for the whole of its probation and is then "promoted" onto
 * the rate it was already being paid.
 *
 * Corrected downwards only. A second-chance scale or a hand-set rate below the probationary figure is
 * somebody's decision, not this bug, and settlements already run are left as they were paid.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const iso = (d) => `2000-01-${String(d).padStart(2, '0')}T08:00`;

const app = { driverName: 'A. Kowalczyk', preferredDivision: 'Dry Van', experienceYears: 6,
  homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };

let S;
const hire = async () => {
  await api('/onboarding/market', 'POST', app);
  return un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2), code: 'PRI' }));
};

(async () => {
  head('1. A hire made today starts under the company rate');
  S = await hire();
  console.log(`  ..    ${S.driver.rank}: $${S.driver.pay.loadedCpm} loaded, $${S.driver.pay.deadheadCpm} empty`);
  console.log(`  ..    ${S.driver.pay.notes}`);
  ok('they are on probation', S.driver.rank === 'probationary', S.driver.rank);
  ok('and not on the posted company rate', S.driver.pay.loadedCpm < 0.57, `$${S.driver.pay.loadedCpm}`);
  ok('it is nine tenths of it', Math.abs(S.driver.pay.loadedCpm - 0.513) < 0.002,
    `$${S.driver.pay.loadedCpm} against $0.513`);
  ok('and the note says which scale it is', /probationary scale/i.test(S.driver.pay.notes || ''),
    S.driver.pay.notes);

  head('2. Clearing probation is therefore worth something');
  // The whole point of the discount. It used to be same money, new title.
  const before = S.driver.pay.loadedCpm;
  S = un(await api('/career/promote', 'POST', { rank: 'company', force: true, note: 'fixture' }));
  console.log(`  ..    company driver: $${S.driver.pay.loadedCpm}`);
  ok('the company rate is higher than the probationary one', S.driver.pay.loadedCpm > before,
    `$${before} → $${S.driver.pay.loadedCpm}`);
  ok('and it is the posted rate', Math.abs(S.driver.pay.loadedCpm - 0.57) < 0.002,
    `$${S.driver.pay.loadedCpm}`);

  head('3. A career carrying the old number is corrected');
  // The reported save: still probationary, still being paid the cleared rate.
  S = await hire();
  let st = await api('/export');
  st.schemaVersion = 24;
  st.driver.pay.loadedCpm = 0.57;      // exactly as reported
  st.driver.pay.deadheadCpm = 0.46;
  S = un(await api('/import', 'POST', st));
  console.log(`  ..    after load: $${S.driver.pay.loadedCpm} loaded, $${S.driver.pay.deadheadCpm} empty`);
  ok('the schema moved on', S.schemaVersion >= 25, `${S.schemaVersion}`);
  ok('the rate comes off the company rate', S.driver.pay.loadedCpm < 0.57, `$${S.driver.pay.loadedCpm}`);
  ok('onto the probationary one', Math.abs(S.driver.pay.loadedCpm - 0.513) < 0.002,
    `$${S.driver.pay.loadedCpm}`);
  ok('and the empty rate with it', S.driver.pay.deadheadCpm < 0.46, `$${S.driver.pay.deadheadCpm}`);

  const ev = (await api('/events?take=40')).find((e) => /loaded rate is corrected/i.test(e.message || ''));
  ok('the player is told, with both figures', !!ev && /0\.570.*0\.513/s.test(ev.message || ''),
    ev?.message?.slice(0, 120) || '(silent)');
  ok('and told their settlements are not being rewritten',
    /settlements already run stay as they were paid/i.test(ev?.message || ''), 'said');

  head('4. It never raises anybody');
  // A rate under the probationary figure is somebody's decision — a second-chance scale, a hand-set
  // number — and correcting an overpayment is not licence to go rewriting pay generally.
  S = await hire();
  st = await api('/export');
  st.schemaVersion = 24;
  st.driver.pay.loadedCpm = 0.40;
  st.driver.pay.deadheadCpm = 0.32;
  S = un(await api('/import', 'POST', st));
  console.log(`  ..    low rate after load: $${S.driver.pay.loadedCpm}`);
  ok('a rate below the scale is left exactly alone', Math.abs(S.driver.pay.loadedCpm - 0.40) < 0.001,
    `$${S.driver.pay.loadedCpm}`);
  ok('and so is the empty rate', Math.abs(S.driver.pay.deadheadCpm - 0.32) < 0.001,
    `$${S.driver.pay.deadheadCpm}`);

  head('5. A cleared driver on the company rate is not touched');
  // 0.57 is exactly right for a company driver at Prime. The bug is only ever about who is on it.
  S = await hire();
  S = un(await api('/career/promote', 'POST', { rank: 'company', force: true, note: 'fixture' }));
  st = await api('/export');
  st.schemaVersion = 24;
  await api('/import', 'POST', st);
  const after = (await api('/bootstrap')).driver;
  ok('a company driver keeps the company rate', Math.abs(after.pay.loadedCpm - 0.57) < 0.002,
    `$${after.pay.loadedCpm}`);

  head('6. The job market quotes the rate you will actually be paid');
  // The other half of the report — "no other company I look at starts that high". The card leads with
  // the STARTING rate, not the company rate, and it has to be the same number the hire produces. Two
  // functions answering "what will I earn" is how the figure on screen stops matching the one in the
  // books, which is precisely what an inflated stored rate made it look like from the outside.
  const market = await api('/onboarding/market', 'POST', app);
  const cards = (market.market || market).filter((c) => c.wouldHire && c.startingCpm > 0).slice(0, 6);
  ok('there are carriers to check', cards.length >= 3, `${cards.length} hiring`);

  for (const c of cards) {
    const quoted = +c.startingCpm;
    await api('/onboarding/market', 'POST', app);
    const got = un(await api('/onboarding/hire', 'POST',
      { application: app, force: true, gameTime: iso(2), code: c.code })).driver.pay.loadedCpm;
    ok(`${c.code}: the card's starting rate is what you are paid`, Math.abs(got - quoted) < 0.002,
      `card $${quoted}, hired on $${got}`);
    ok(`${c.code}: and it is under their company rate`, quoted < +c.loadedCpm + 0.0005,
      `start $${quoted} vs company $${c.loadedCpm}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
