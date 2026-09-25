/* The terms of the offer are not settings, and a probationary driver cannot move them.
 *
 *   "lets lock down probation more, right now they can select home time and also distance, this should
 *    be locked in by the hiring requirements and not be changable until they are off probation"
 *
 *   "if this is a regional carrier we need to lock distance to short and medium if we haven't yet (and
 *    probation should go on medium). Converslet the OTR carriers should be locked to long and OTR
 *    (with probation on OTR)"
 *
 * Both were already gated to what the carrier would SIGN, and that was the wrong gate. The question is
 * not whether the employer would agree to it; it is that a driver being assessed does not get to move
 * the terms they are being assessed against.
 *
 * TRIP LENGTH IS THE ONE THAT BITES, because the probation targets are derived from it.
 * ProbationPlanner.TargetsFor reads the preference in force and asks for 4.0 loads and 700 miles a week
 * on "short" against 1.0 and 1,400 on "otr". Over a ninety-day period that is about 51 loads and 9,000
 * miles one way and 13 loads and 18,000 miles the other. A driver near the end of an OTR probation,
 * long on loads and short on miles, could switch to short and clear both bars in the same instant —
 * Retarget() wrote the easier numbers down and the app congratulated them.
 *
 * TWO THINGS TURNED UP WHILE CHECKING THE SECOND HALF.
 *
 * Regional carriers were already right: short and medium, defaulting to medium. But TripLengthOffer
 * only ever named "Regional", so "Small" fell through to the over-the-road branch — and every small
 * carrier on the roster used to be heavy haul, so nobody noticed. Joel Olson Trucking hauls logs
 * around the lower Columbia and is home nearly every night, and was being offered long and OTR only.
 *
 * And an EXPERIENCED driver joining a big over-the-road carrier has all four lengths open to them,
 * because they have the years its regional seats ask for. So they could serve a probation on "short"
 * at a carrier whose work is OTR. A period is meant to show somebody doing the carrier's actual work,
 * so a probationary hire now starts on the carrier's default whatever they asked for.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5906}/api`;
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
/** Returns the error message where the call was refused, or null where it went through. */
const refused = async (p, body) => {
  try { await api(p, 'POST', body); return null; } catch (e) { return e.message; }
};

const appFor = (years) => ({
  driverName: 'W. Probe', preferredDivision: 'Dry Van', experienceYears: years,
  homeCity: 'Chicago', homeState: 'IL', acceptsProbation: true,
  homeTimePreference: 'biweekly', preferredTripLength: 'short',
});

/** Hire onto a named carrier and come back with the snapshot. */
async function hire(code, years) {
  const app = appFor(years);
  await api('/onboarding/market', 'POST', app);
  return un(await api('/onboarding/hire', 'POST',
    { application: app, force: true, gameTime: '2000-01-01T06:00', code }));
}

(async () => {
  head('1. A probationary driver cannot change their trip length');
  let S = await hire('SNI', 1);           // Schneider: large, over-the-road
  ok('they are on probation', S.driver.rank === 'probationary', S.driver.rank);
  const before = S.application.preferredTripLength;
  const why = await refused('/career/trip-length', { preference: 'medium' });
  ok('the change is refused', !!why, why || 'WENT THROUGH');
  ok('and says it is a term of the job, not a setting',
    /probation/i.test(why || '') && /card/i.test(why || ''), (why || '').slice(0, 120));
  S = await api('/bootstrap');
  ok('nothing moved', S.application.preferredTripLength === before,
    `${before} -> ${S.application.preferredTripLength}`);

  head('2. Nor their home-time arrangement');
  const why2 = await refused('/career/home-time', { preference: 'weekly' });
  ok('also refused', !!why2, why2 || 'WENT THROUGH');
  ok('for the same reason', /probation/i.test(why2 || ''), (why2 || '').slice(0, 120));

  head('3. Which closes the way the targets used to be moved');
  // The exploit, spelled out. Both figures come off the preference, and they trade against each other:
  // whichever bar a driver was closer to, the other preference made it the only one that counted.
  const plan = async () => (await api('/export')).driver.probation;
  const p = await plan();
  ok('the period asks for loads and miles', p.requiredLoads > 0 && p.requiredMiles > 0,
    `${p.requiredLoads} loads, ${p.requiredMiles} mi`);
  // On "otr" that is the long, few-loads shape. Switching to "short" would have asked for roughly four
  // times the loads and half the miles, and Retarget() would have written it down as the new bar.
  ok('shaped like the over-the-road work they were hired for', p.requiredMiles > 12000,
    `${p.requiredMiles} mi over ${p.durationDays} days`);
  await refused('/career/trip-length', { preference: 'short' });
  const still = await plan();
  ok('and a refused change moves neither',
    still.requiredLoads === p.requiredLoads && still.requiredMiles === p.requiredMiles,
    `${still.requiredLoads} loads, ${still.requiredMiles} mi`);

  head('4. Clearing the period hands both back');
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const okNow = await refused('/career/trip-length', { preference: 'long' });
  ok('trip length can be set once cleared', okNow === null, okNow || 'accepted');
  const okHome = await refused('/career/home-time', { preference: 'biweekly' });
  ok('and so can home time', okHome === null, okHome || 'accepted');

  head('5. A regional carrier runs short and medium, and probation starts on medium');
  //   "if this is a regional carrier we need to lock distance to short and medium ... (and probation
  //    should go on medium)"
  // Applied for "short" every time, deliberately: the point is that the carrier decides, not the form.
  for (const code of ['MRT', 'MEL', 'HIT']) {
    const st = await hire(code, 1);
    const offered = st.terms.tripLengthsOffered;
    ok(`${code}: only short and medium are offered`,
      offered.length === 2 && offered.includes('short') && offered.includes('medium'),
      offered.join(', '));
    ok(`${code}: and the period is served on medium`,
      st.application.preferredTripLength === 'medium', st.application.preferredTripLength);
  }

  head('6. A small carrier is regional too, which it was not');
  // Only "Regional" was named in TripLengthOffer, so "Small" fell through to the over-the-road branch.
  // Joel Olson is home nearly every night and was being offered long and OTR only.
  const jot = await hire('JOT', 4);
  ok('a local log hauler is not an over-the-road seat',
    !jot.terms.tripLengthsOffered.includes('otr'), jot.terms.tripLengthsOffered.join(', '));
  ok('it runs short and medium like any other regional outfit',
    jot.terms.tripLengthsOffered.join(',') === 'short,medium', jot.terms.tripLengthsOffered.join(', '));
  ok('and its probation is served on medium',
    jot.application.preferredTripLength === 'medium', jot.application.preferredTripLength);

  head('7. An over-the-road carrier runs long and OTR, and probation starts on OTR');
  //   "the OTR carriers should be locked to long and OTR (with probation on OTR)"
  const sni = await hire('SNI', 1);
  ok('long and OTR only', sni.terms.tripLengthsOffered.join(',') === 'long,otr',
    sni.terms.tripLengthsOffered.join(', '));
  ok('and the period is served on OTR', sni.application.preferredTripLength === 'otr',
    sni.application.preferredTripLength);

  head('8. Even for a driver experienced enough to have earned the regional boards');
  // THE HOLE IN THE SECOND HALF. Years unlock a big carrier's regional seats, so all four lengths are
  // open — and a probationary hire could take "short" at a carrier whose work is OTR, then be measured
  // on four loads and 700 miles a week while running freight that pays out at one and 1,400.
  const vet = await hire('SNI', 8);
  ok('all four lengths are genuinely open to them',
    vet.terms.tripLengthsOffered.length === 4, vet.terms.tripLengthsOffered.join(', '));
  ok('but the period is still served on what the carrier runs',
    vet.application.preferredTripLength === 'otr',
    `asked for short, got ${vet.application.preferredTripLength}`);
  // And once cleared it really is theirs — the lock is the period, not the carrier.
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const taken = await refused('/career/trip-length', { preference: 'short' });
  ok('and short is theirs the moment the period is served', taken === null, taken || 'accepted');
  ok('which is the thing clearing probation buys them',
    (await api('/bootstrap')).application.preferredTripLength === 'short');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
