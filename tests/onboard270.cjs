/* Starting a career: what you are asked, what the job actually is, and where you end up based.
 *
 * Five reports, one turn:
 *
 *   1. "It defaults to 3 years of experience, when most people will start with 0."
 *   2. "What is home city and state used for? I'm guessing nothing so we get rid of it?"
 *   5. "On the initial job list... some (Prime) pay way more than others (Knight-Swift). Why would
 *       anyone pick one that pays .48 cpm when they can make .51 cpm? Need ideas how to better gate
 *       this" — and then: lay the probation terms out there too, and let the carrier gate run length.
 *
 * On (5), the trade-off was already in the data and two thirds of it did nothing. Every carrier carries
 * equipment, home-time and pay stars; HomeTimeStars was stored, printed and never once consulted, and
 * EquipmentStars only decided which tractor turned up on a re-rig. So the rate was the only figure that
 * differed by anything a player could weigh, and the answer to "which job" was always "the one paying
 * most". Home time and run length now bite, and every term is stated on the card BEFORE signing —
 * because a cost you cannot see when you choose is not a trade-off, it is a trap.
 *
 * On (2), the home city was the right question in the wrong order. You do not decide where you live and
 * then hunt for a carrier to match; you take a job and then pick which of THEIR yards you run out of.
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
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

const rookie = (over = {}) => ({
  driverName: 'R. Green', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 0, homeCity: '', homeState: '', acceptsProbation: true,
  homeTimePreference: 'biweekly', preferredTripLength: 'medium', ...over,
});

const market = async (a) => (await api('/onboarding/market', 'POST', a)).market
  || (await api('/onboarding/market', 'POST', a)).carriers;

(async () => {
  head('1. A rookie sees the rookie half of the market');
  // The form defaulted to three years, which quietly put every new player past the bar at carriers that
  // turn rookies away — and hid the doors that would have taken them.
  let list = await market(rookie());
  const open = list.filter((c) => c.wouldHire);
  console.log(`  ..    ${open.length} of ${list.length} would take a rookie: ` +
              open.map((c) => `${c.name} $${(+c.loadedCpm).toFixed(3)}`).join(', '));
  ok('somebody will hire a driver with no experience', open.length >= 3, `${open.length}`);
  // Either the bar is already at zero, or the carrier trains — Carriers.Screen waives the years
  // requirement for a rookie carrier looking at a driver with no loads at all, which is the whole point
  // of a training programme. Both routes are legitimate, and asserting only the flag missed the first.
  ok('each open door is one a driver with nothing behind them can actually walk through',
    open.every((c) => c.minExperienceYears <= 0.001 || c.takesRookies),
    open.map((c) => `${c.code}:${c.minExperienceYears}${c.takesRookies ? '+trains' : ''}`).join(' '));

  head('2. The terms are on the card, not discovered in week three');
  const top = open.slice().sort((a, b) => b.loadedCpm - a.loadedCpm)[0];
  const bottom = open.slice().sort((a, b) => a.loadedCpm - b.loadedCpm)[0];
  console.log(`  ..    ${top.name} $${(+top.loadedCpm).toFixed(3)} — home ${top.minHomeTimeDays}d, ` +
              `runs ${(top.tripLengthsOffered || []).join('/')}, probation ${top.probationDays}d`);
  console.log(`  ..    ${bottom.name} $${(+bottom.loadedCpm).toFixed(3)} — home ${bottom.minHomeTimeDays}d, ` +
              `runs ${(bottom.tripLengthsOffered || []).join('/')}, probation ${bottom.probationDays}d`);
  for (const c of open) {
    ok(`${c.name} states its home-time policy`, c.minHomeTimeDays > 0 && !!c.homeTimeNote,
      `${c.minHomeTimeDays}d`);
    ok(`${c.name} states what runs it will give you`, (c.tripLengthsOffered || []).length > 0 && !!c.tripLengthNote,
      (c.tripLengthsOffered || []).join('/'));
    ok(`${c.name} states its probation up front`, c.probationDays > 0 && !!c.probationNote,
      `${c.probationDays} days`);
  }

  head('3. The rate is no longer the only thing that differs');
  // The whole point. If every open door offers identical terms then the highest number wins and the
  // choice is not a choice.
  const homeSpread = new Set(open.map((c) => c.minHomeTimeDays));
  console.log(`  ..    home-time minimums across the open doors: ${[...homeSpread].sort((a, b) => a - b).join(', ')} days`);
  ok('the open carriers do not all offer the same home time', homeSpread.size > 1,
    [...homeSpread].join(' / '));

  head('4. A rookie runs over-the-road, whatever they ticked');
  // Big carriers give their regional seats to drivers who have earned them.
  const bigOpen = open.find((c) => c.size === 'Large');
  if (bigOpen) {
    console.log(`  ..    ${bigOpen.name}: ${bigOpen.tripLengthNote}`);
    ok('no regional board for a rookie at a big carrier',
      !(bigOpen.tripLengthsOffered || []).includes('short')
      && !(bigOpen.tripLengthsOffered || []).includes('medium'),
      (bigOpen.tripLengthsOffered || []).join('/'));
  } else { ok('no large carrier open to a rookie in this market', true, 'skipped'); }

  // And with time in, the same carrier opens up.
  const veteran = await market(rookie({ experienceYears: 8 }));
  const bigVet = bigOpen ? veteran.find((c) => c.code === bigOpen.code) : null;
  if (bigVet) {
    console.log(`  ..    with 8 years: ${bigVet.tripLengthNote}`);
    ok('experience opens the regional seats', (bigVet.tripLengthsOffered || []).includes('medium'),
      (bigVet.tripLengthsOffered || []).join('/'));
  } else { ok('nothing to compare against', true, 'skipped'); }

  head('5. Asking for something they do not offer gets their answer, and it is logged');
  const strict = open.find((c) => c.minHomeTimeDays > 7) || open[0];
  // The whole response, not just the snapshot: the setup checklist rides on the hire and is what
  // section 9 reads. It is the one moment it is handed over, because it is a list of things to go and
  // do in the game before the first load.
  const hire = await api('/onboarding/hire', 'POST', {
    application: rookie({ homeTimePreference: 'weekly', preferredTripLength: 'short' }),
    force: true, gameTime: iso(1), code: strict.code,
  });
  let S = un(hire);
  console.log(`  ..    asked weekly + short at ${strict.name} → ` +
              `${S.application.homeTimePreference} / ${S.application.preferredTripLength}`);
  ok('the arrangement is what the carrier signs', S.driver.homeTimeIntervalDays >= strict.minHomeTimeDays,
    `${S.driver.homeTimeIntervalDays} days against a ${strict.minHomeTimeDays}-day minimum`);
  ok('and the driver is told, not left to notice',
    (S.events || []).some((e) => /you asked for/i.test(e.message || '')),
    (S.events || []).find((e) => /you asked for/i.test(e.message || ''))?.message?.slice(0, 100) || '(silent)');

  head('6. And it cannot be set from the career tab afterwards either');
  // Otherwise the gate at hire is decoration: take the job, change the setting a minute later.
  let threw = '';
  try { await api('/career/home-time', 'POST', { preference: 'weekly' }); } catch (e) { threw = e.message; }
  console.log(`  ..    ${threw.slice(0, 120) || '(allowed)'}`);
  ok('a carrier that will not sign weekly still will not', !!threw);
  ok('and it says so rather than silently doing something else',
    /will not sign/i.test(threw), threw.slice(0, 60));

  head('7. You pick which of their yards you are based at');
  const net = S.company.networkCities || [];
  console.log(`  ..    ${S.company.name} runs ${net.join(' | ')}`);
  ok('the carrier has a network to choose from', net.length > 1, `${net.length}`);

  const pick = net.map((n) => n.split(',')).map(([c, st]) => ({ c: c.trim(), st: st.trim() }))
    .find((x) => x.c !== S.company.terminalCity);
  const moved = await api('/career/domicile', 'POST', { city: pick.c, state: pick.st });
  S = moved.snapshot;
  console.log(`  ..    domiciled at ${pick.c}, ${pick.st} — a ${moved.level} yard`);
  ok('the home yard moves to the one chosen', S.company.terminalCity === pick.c, S.company.terminalCity);
  ok('it is still one yard, not two', S.company.terminals.length === 1, `${S.company.terminals.length}`);
  ok('the driver is domiciled there', S.driver.homeTerminalId === S.company.terminals[0].id, 'matched');
  ok('and is standing in it', S.status.locationCity === pick.c && S.status.locationKind === 'Terminal',
    `${S.status.locationCity} / ${S.status.locationKind}`);
  ok('the tier follows the carrier, not a flat small', ['Small', 'Medium', 'Large'].includes(moved.level),
    moved.level);
  ok('and it says what to go and buy in the game', /buy a garage/i.test(moved.setUp || ''),
    (moved.setUp || '').slice(0, 90));

  head('8. Somewhere they do not run is refused');
  threw = '';
  try { await api('/career/domicile', 'POST', { city: 'Nowhere', state: 'ZZ' }); } catch (e) { threw = e.message; }
  ok('you cannot be domiciled off your employer\'s network', /does not run a terminal/i.test(threw),
    threw.slice(0, 90));

  head('9. The setup checklist names trucks and trailers that exist in ATS');
  // It named a Freightliner Coronado, a Columbia, a Kenworth W900L and an "Eaton Fuller 18-spd manual",
  // none of which are in the game. Reported as not being able to find what to buy.
  const setup = hire.setup || [];
  const all = JSON.stringify(setup);
  const truckStep = setup.find((x) => /Buy a tractor/i.test(x.title || ''));
  console.log(`  ..    ${truckStep?.title || '(no truck step)'}`);
  ok('there is a tractor to go and buy', !!truckStep);
  ok('with the engine named', /engine/i.test(truckStep?.detail || ''), 'named');
  ok('and the gearbox named', /gearbox/i.test(truckStep?.detail || ''), 'named');
  for (const gone of ['Coronado', 'Columbia', 'W900L', 'T800', 'ProStar', 'Eaton Fuller']) {
    ok(`no ${gone} — it is not in the game`, !all.includes(gone), gone);
  }

  const trailerStep = setup.find((x) => /trailer/i.test(x.title || ''));
  if (trailerStep) {
    console.log(`  ..    ${(trailerStep.detail || '').split('\n\n').pop().slice(0, 150)}`);
    ok('the trailer step warns about California', /California/i.test(trailerStep.detail || ''));
    ok('and says singles only, no doubles', /no doubles/i.test(trailerStep.detail || ''));
  } else { ok('no trailer step in this career', true, 'skipped'); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
