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
const fs = require('fs'), path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
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

  head('5. The carrier sets both, because the application no longer asks');
  const strict = open.find((c) => c.minHomeTimeDays > 7) || open[0];
  // The whole response, not just the snapshot: the setup checklist rides on the hire and is what
  // section 9 reads. It is the one moment it is handed over, because it is a list of things to go and
  // do in the game before the first load.
  // Both blank on the way in — the form has no field for either any more. They are terms of the job,
  // not preferences: asking and then overriding was the app offering a choice it was about to take back.
  const hire = await api('/onboarding/hire', 'POST', {
    application: rookie(), force: true, gameTime: iso(1), code: strict.code,
  });
  let S = un(hire);
  console.log(`  ..    signed at ${strict.name} → home ${S.application.homeTimePreference}, ` +
              `runs ${S.application.preferredTripLength}`);
  ok('an arrangement is on the file even though nobody asked for one',
    !!S.application.homeTimePreference && S.driver.homeTimeIntervalDays > 0,
    `${S.application.homeTimePreference} / ${S.driver.homeTimeIntervalDays}d`);
  ok('and it is one this carrier actually signs',
    S.driver.homeTimeIntervalDays >= strict.minHomeTimeDays,
    `${S.driver.homeTimeIntervalDays} days against a ${strict.minHomeTimeDays}-day minimum`);
  ok('a run length is set too', (strict.tripLengthsOffered || []).includes(S.application.preferredTripLength),
    `${S.application.preferredTripLength} from ${(strict.tripLengthsOffered || []).join('/')}`);
  ok('and the driver is told what they signed up to, not left to find out',
    (S.events || []).some((e) => /runs you .* and gets you home/i.test(e.message || '')),
    (S.events || []).find((e) => /runs you/i.test(e.message || ''))?.message?.slice(0, 110) || '(silent)');

  head('6. And neither can be talked into from the career tab afterwards');
  // Otherwise the terms on the card are decoration: take the job, change the setting a minute later.
  //
  // Cleared first so it is the CARRIER's refusal being read. A probationary driver is refused both
  // outright, whatever the carrier would sign, and that rule is probterms' subject — here it would
  // just mask the one this section exists for.
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  let threw = '';
  try { await api('/career/home-time', 'POST', { preference: 'weekly' }); } catch (e) { threw = e.message; }
  console.log(`  ..    ${threw.slice(0, 110) || '(allowed)'}`);
  ok('a carrier that will not sign weekly still will not', !!threw);
  ok('and it says so rather than silently doing something else',
    /will not sign/i.test(threw), threw.slice(0, 60));

  const barred = ['short', 'medium', 'long', 'otr'].find((k) => !(strict.tripLengthsOffered || []).includes(k));
  if (barred) {
    threw = '';
    try { await api('/career/trip-length', 'POST', { preference: barred }); } catch (e) { threw = e.message; }
    console.log(`  ..    ${threw.slice(0, 110) || '(allowed)'}`);
    ok(`and they will not put you on ${barred} runs either`, /does not run you/i.test(threw),
      threw.slice(0, 70));
  } else { ok('this carrier runs everything, so nothing to refuse', true, 'skipped'); }

  head('7. You pick which of their yards you are based at');
  const net = S.company.networkCities || [];
  console.log(`  ..    ${S.company.name} runs ${net.join(' | ')}`);
  ok('the carrier has a network to choose from', net.length > 1, `${net.length}`);

  const hqBefore = S.company.terminalCity;
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
  ok('and it says what to go and buy in the game', /buy a garage/i.test(moved.buyThis || ''),
    (moved.buyThis || '').slice(0, 90));

  // The carrier's HQ is marked reached at hire, because normally that is the yard you are standing in.
  // Pick a different one and you were never in the HQ at all — but it stayed on the discovered list and
  // came back as a yard to open, dated the morning of day one. Reported from play: "we've never been to
  // Green Bay", on a Schneider career domiciled in Phoenix.
  const reached = (S.views.reached || []).map((r) => r.city);
  const offers = (S.views.garageOpportunities || []).map((o) => o.city);
  console.log(`  ..    reached: ${reached.join(', ') || '(none)'} | offered: ${offers.join(', ') || '(none)'}`);
  ok('the yard actually chosen counts as reached', reached.includes(pick.c), pick.c);
  ok('and the headquarters nobody drove to does not',
    !reached.includes(hqBefore), `${hqBefore} ${reached.includes(hqBefore) ? 'still listed' : 'gone'}`);
  ok('so it is not offered as a garage to open either',
    !offers.includes(hqBefore), offers.join(', ') || 'nothing offered');

  // And the boxes come too. A trailer records where it is as free text rather than by yard id, so
  // mutating the terminal left T501 filed in the city the company no longer has a garage in — the
  // driver in one place and their trailer in another, on day one, having driven nowhere. Reported from
  // play off the fleet report: "showing my trailer in Green Bay, a garage we don't have".
  const stranded = (S.trailers || []).filter((t) => (t.currentLocation || '').includes(hqBefore));
  console.log(`  ..    trailers: ${(S.trailers || []).map((t) => `${t.unit}@${t.currentLocation || '—'}`).join(', ')}`);
  ok('no box is left filed at the yard the company moved off',
    stranded.length === 0, stranded.map((t) => `${t.unit} @ ${t.currentLocation}`).join(', ') || 'none');
  ok('and they are filed at the yard that actually exists',
    (S.trailers || []).every((t) => !t.currentLocation || t.currentLocation.includes(pick.c)),
    (S.trailers || []).map((t) => t.currentLocation || '—').join(' | '));

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
  ok('and the transmission named', /Transmission:/i.test(truckStep?.detail || ''), 'named');
  for (const gone of ['Coronado', 'Columbia', 'W900L', 'T800', 'ProStar', 'Eaton Fuller']) {
    ok(`no ${gone} — it is not in the game`, !all.includes(gone), gone);
  }

  const trailerStep = setup.find((x) => /you are on/i.test(x.title || ''));
  if (trailerStep) {
    console.log(`  ..    ${trailerStep.title}`);
    ok('the trailer warns about California', /California/i.test(trailerStep.detail || ''));
    ok('and says one trailer, no doubles', /no doubles/i.test(trailerStep.detail || ''));
    // A company driver is PUT on a trailer. "Decide on trailers — you can either buy your own or take
    // market trailers" is an owner-operator's decision and this driver does not get it.
    ok('it reads as an assignment, not a choice', !/^Decide/i.test(trailerStep.title || ''),
      trailerStep.title);
    ok('and says the company put them on it', /has put you on this one/i.test(trailerStep.detail || ''));

    // The LENGTH is assigned too. This ended "48' and 45' are also sold if you would rather have
    // something shorter for city work" — an owner-operator's decision handed to a company driver, and
    // the same mistake as letting them pick the trailer. Reported from play: "this should NOT be an
    // option, the app needs to assign lengths not let the player decide".
    // Scoped to LENGTH alternatives. A blanket search for "would rather" also catches the note about
    // not having bought the box yet, which is bookkeeping rather than a choice of trailer.
    ok('the length is stated, not offered',
      !/(also sold|is sold as well|are also|rather have something shorter|or shorter if)/i
        .test(trailerStep.detail || ''),
      (trailerStep.detail || '').match(/[^.]*(also sold|are also)[^.]*/)?.[0] || 'no alternatives');
    // And the length it names is the one on the unit, not a second copy of the same fact that is free
    // to drift from it.
    const assigned = (S.trailers || []).find((x) => trailerStep.title.includes(x.unit))
      || (S.trailers || [])[0];
    ok('and it is the length of the unit they were issued',
      !assigned || (trailerStep.detail || '').includes(assigned.length),
      `${assigned?.length} in "${(trailerStep.detail || '').match(/that is the [^.]*/)?.[0] || ''}"`);
  } else { ok('no trailer step in this career', true, 'skipped'); }

  head('10. Nothing in the checklist reaches the player as markup');
  // These strings are rendered through esc(), so a <b> in one arrives as the literal characters. It did,
  // twice in one sitting.
  // Real tag names only. The save-path instructions legitimately contain <profile> and <slot>, which are
  // placeholders in a Windows path and are meant to reach the player exactly as written.
  const markup = setup.filter((x) =>
    /<\/?(b|i|em|strong|p|br|div|span|ul|li|a)\b[^>]*>/i.test(`${x.title} ${x.detail} ${x.why} ${x.caution || ''}`));
  ok('no HTML tags anywhere in the checklist', markup.length === 0,
    markup.map((x) => x.title).join(', ') || 'clean');

  head('11. A model sold twice says which one');
  // ATS sells a 2019 Cascadia, a 2024 Cascadia and an electric eCascadia side by side. "Buy a Cascadia"
  // is not an instruction. Same for the T680 and the VNL.
  if (/Cascadia|T680|VNL/.test(truckStep?.title || '')) {
    ok('the dealer variant is named', /Take the/i.test(truckStep?.detail || ''),
      (truckStep?.detail || '').match(/Take the[^.]*\./)?.[0] || '(not said)');
  } else {
    ok('this truck is only sold one way, so no variant needed', true, truckStep?.title || '');
  }
  ok('the horsepower is not printed twice',
    !/(\d{3})\s+\1\s*hp/i.test(truckStep?.detail || ''),
    (truckStep?.detail || '').match(/Engine: [^\n]*/)?.[0] || '');

  head('12. Choosing a domicile redraws the checklist for the new city');
  // It was built at hire and left on screen: "buy a garage in Green Bay" under a note saying you are
  // domiciled in Phoenix. Reported from play.
  const before = (moved.setup || []).find((x) => /Buy a garage/i.test(x.title || ''));
  console.log(`  ..    ${before?.title || '(no garage step returned)'}`);
  ok('the domicile change hands back a fresh checklist', (moved.setup || []).length > 0,
    `${(moved.setup || []).length} steps`);
  ok('and its garage step names the city just chosen',
    (before?.title || '').includes(pick.c), before?.title || '');
  ok('with the tier that yard actually is, not a hardcoded small',
    new RegExp(String(moved.level), 'i').test(before?.detail || ''),
    `${moved.level}`);

  head('13. The speed limiter is a game setting, not something bought at the dealer');
  // It said "set the speed limiter to about 65 mph", which is not a thing you can do anywhere in ATS.
  // The limiter lives in Options, Gameplay, and it is on or off. Reported from play in those words.
  const limiterText = truckStep?.detail || '';
  console.log(`  ..    ${limiterText.match(/[^\n]*speed limiter[^\n]*/i)?.[0]?.slice(0, 120) || '(not mentioned)'}`);
  ok('the checklist sends the driver to the options screen',
    /Options, Gameplay/i.test(limiterText), 'named');
  ok('and says which way to set it, not what number to dial',
    /limiter (ON|OFF)\b/.test(limiterText),
    limiterText.match(/limiter (ON|OFF)/)?.[0] || '(no switch)');
  ok('nothing tells the player to set it TO a speed',
    !/(set|spec).{0,24}limiter.{0,24}\b(to|at)\b.{0,12}\d{2}\s*mph/i.test(all), 'clean');
  // The cap is worth stating where it applies, because the planner works to it — but only as the
  // consequence of switching it on, never as a value the player types in at the dealer.
  // Top level on the snapshot, beside careerName — NOT under views. It was written there and read from
  // S.views.terms, so every note rendered blank and the run-length picker always took the "they offer
  // exactly one" branch, which is the single-option text. A panel reading a key that is not there fails
  // silently and looks like a design decision.
  const boot = await api('/bootstrap');
  const governed = boot.terms;
  ok('the terms are where the browser looks for them', !!governed, governed ? 'found' : 'undefined');
  ok('and nothing still reads them off views', !/S\.views\.terms/.test(js), 'clean');
  ok('the snapshot says whether this employer governs its trucks',
    typeof governed?.limitsSpeed === 'boolean', String(governed?.limitsSpeed));
  ok('and the checklist agrees with it',
    governed.limitsSpeed === /turn .*limiter ON/i.test(limiterText),
    governed.limitsSpeed ? 'governed, told to switch it on' : 'ungoverned, told to leave it off');

  head('14. The career tab offers only what the carrier runs');
  // A dropdown listing four run lengths where the endpoint refuses three of them is the app presenting
  // choices it is about to take back. The picker is filtered to the offered set, and where a carrier
  // offers exactly one it is stated rather than picked.
  ok('the offered run lengths are published to the browser',
    Array.isArray(governed?.tripLengthsOffered) && governed.tripLengthsOffered.length > 0,
    (governed?.tripLengthsOffered || []).join('/'));
  ok('they match what the card said before signing',
    JSON.stringify([...(governed.tripLengthsOffered || [])].sort())
      === JSON.stringify([...(strict.tripLengthsOffered || [])].sort()),
    `${(governed.tripLengthsOffered || []).join('/')} vs ${(strict.tripLengthsOffered || []).join('/')}`);
  ok('and the reason is carried with them', (governed.tripLengthNote || '').length > 0,
    (governed.tripLengthNote || '').slice(0, 80));
  ok('the home-time arrangements are published the same way',
    Array.isArray(governed?.homeTimeOffered) && governed.homeTimeOffered.length > 0,
    (governed?.homeTimeOffered || []).join('/'));
  // Every offered key must be one the endpoint will actually accept. This is the invariant the whole
  // section exists for: offered and accepted are the same list, or the picker lies.
  let refused = [];
  for (const k of governed.tripLengthsOffered) {
    try { await api('/career/trip-length', 'POST', { preference: k }); } catch (e) { refused.push(k); }
  }
  ok('every run length on offer is one the endpoint takes', refused.length === 0,
    refused.join(', ') || 'all accepted');
  refused = [];
  for (const k of governed.homeTimeOffered) {
    try { await api('/career/home-time', 'POST', { preference: k }); } catch (e) { refused.push(k); }
  }
  ok('and every arrangement on offer is signable', refused.length === 0,
    refused.join(', ') || 'all accepted');

  head('15. Stocking a yard says what to go and buy in ATS');
  // It put five tractors on the books and told the player the type on a table row. Every one is a
  // different truck with a different engine and gearbox. Reported from play: "I also need to know what
  // to purchase in ATS (like my own truck), this just vaguely mentions a truck type".
  const stocked = await api('/fleet/stock', 'POST',
    { terminalId: S.company.terminals[0].id, count: 3, addTrailers: true });
  console.log(`  ..    ${(stocked.buy || []).length} tractors, ${(stocked.buyTrailers || []).length} trailers at ${stocked.yardLabel}`);
  ok('the yard it stocked is named back', (stocked.yardLabel || '').includes(pick.c), stocked.yardLabel);
  ok('every tractor bought is listed', (stocked.buy || []).length > 0, `${(stocked.buy || []).length}`);
  ok('each one names a real truck, not a type',
    (stocked.buy || []).every((b) => /\d{4} \w+/.test(b.what || '')),
    (stocked.buy || [])[0]?.what || '');
  ok('and which dealer to walk into, because that is the other half of the instruction',
    (stocked.buy || []).every((b) => (b.dealer || '').length > 0),
    (stocked.buy || [])[0]?.dealer || '(not said)');
  ok('with the engine and gearbox to spec it with',
    (stocked.buy || []).every((b) => (b.engine || '').length > 0 && (b.transmission || '').length > 0),
    `${(stocked.buy || [])[0]?.engine} / ${(stocked.buy || [])[0]?.transmission}`);
  ok('and the unit it goes on the books as',
    (stocked.buy || []).every((b) => (b.unit || '').length > 0),
    (stocked.buy || []).map((b) => b.unit).join(' '));
  if ((stocked.buyTrailers || []).length) {
    ok('the trailers say what to buy too',
      (stocked.buyTrailers || []).every((b) => (b.what || '').length > 0),
      (stocked.buyTrailers || [])[0]?.what || '');
    ok('and carry the California warning with them',
      (stocked.californiaRule || '').length > 0, (stocked.californiaRule || '').slice(0, 70));
  } else { ok('no trailers stocked in this run', true, 'skipped'); }
  ok('nothing in the buy list reaches the player as markup',
    !/<\/?(b|i|em|strong|p|br|div|span|ul|li|a)\b[^>]*>/i.test(JSON.stringify(stocked)), 'clean');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
