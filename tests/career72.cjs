/* Issues #72, #73, #74: probation clears itself, and only when it is actually earned.
 *
 * #72 — the Career tab offered "Clear probation & move to Company Driver scale" as soon as the loads,
 * miles and on-time numbers were met, having never counted the reviews. Three good reviews in a row is
 * the other half of the requirement, and the review path already knew that; the button did not.
 *
 * #73 — a company driver does not promote themselves any more than they authorise their own equipment.
 * Clearing and promotion happen on their own when earned, and the driver is told, with the new rates.
 *
 * #74 — and there is no box to type your own pay rate into.
 */
const H = require('./lib/helpers.cjs');
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5940}/api`;
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

let S, day = 1, HOME = ['Springfield', 'MO'];
const career = () => S.views.career;
const progressRow = (label) =>
  (career().probationProgress || []).find((r) => (r.label || '').toLowerCase().includes(label));

async function report(city, state, d, kind = 'TruckStop') {
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: at(d),
    fuelPct: 90, atsOdometer: 5000 + d * 400, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  S = un(r);
  return r;
}

/** Report in at the home yard. Resets the home-time clock, which a probationary driver on a fortnightly
    review cycle would be doing anyway — and without it the long batch below runs them overdue. */
async function goYard() {
  day += 1;
  await report(HOME[0], HOME[1], day, 'Terminal');
}

/** One clean, on-time load. Long enough that a dozen of them clear the mileage threshold. */
async function runLoad(destCity, destState) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 600, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 240, weightLbs: 40000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 600, endOdometer: 0, actualRevenue: 2400,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done;
}

(async () => {
  const app = { driverName: 'P. Bation', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 7, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    // The arrangement on the file barely matters here: a PROBATIONARY driver is held to a fortnightly
    // cycle whatever they asked for — Probation.EffectiveIntervalDays — because coming in for review is
    // the point of probation. So this fixture has to bring the driver home, or fifteen loads run them
    // weeks past their date and #109 and #114 correctly start refusing freight that takes them no nearer
    // the yard. See goYard() below.
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1), code: 'PRI' }));
  const yard = (S.company.terminals || []).find((x) => x.id === S.driver.homeTerminalId)
               || S.company.terminals[0];
  const label = `${yard.city}, ${yard.state}`;
  const [hCity, hState] = [yard.city, yard.state];
  HOME = [hCity, hState];
  const startLoaded = S.driver.pay.loadedCpm;
  ok('starts probationary', S.driver.rank === 'probationary', S.driver.rank);
  console.log(`     home yard ${label} · starting rate $${startLoaded}/loaded mi`);

  head('1. #72 The reviews are a listed requirement, not an unwritten one');
  day = 4;
  // Tulsa and Oklahoma City rather than Amarillo. This suite runs fifteen loads back and forth to build
  // review history, which drifts the driver past their fortnight — and #109 disqualifies a load that
  // takes an overdue driver materially further from the yard. Amarillo is 274 mi further out than OKC
  // and stopped being bookable halfway through; Tulsa is inside the tolerance in both directions.
  await report('Tulsa', 'OK', day);
  const row = progressRow('review');
  ok('probation progress counts the reviews', !!row,
    row ? `${row.label}: ${row.current} of ${row.required}` : '(no such row)');
  ok('and it wants three of them', row && Number(row.required) === 3, `${row?.required}`);
  ok('with none sat yet, it is not met', row && !row.met, `met=${row?.met}`);

  head('2. #72 Numbers alone do not clear it');
  // Enough loads and miles to satisfy every threshold except the reviews.
  for (let i = 0; i < 11; i++) {
    await runLoad(i % 2 ? 'Tulsa' : 'Oklahoma City', 'OK');
    if (i === 3 || i === 7) await goYard();     // in for review, and the clock starts over
  }
  S = un(await api('/bootstrap'));
  const thresholdRows = (career().probationProgress || []).filter((r) => !/review/i.test(r.label));
  ok('every other threshold is met', thresholdRows.every((r) => r.met),
    thresholdRows.filter((r) => !r.met).map((r) => r.label).join(', ') || 'all met');
  ok('but probation is NOT reported as met', career().probationMet === false,
    `probationMet=${career().probationMet}`);
  ok('and still probationary', S.driver.rank === 'probationary', S.driver.rank);

  head('3. #73 Nothing in the app offers to clear it for you');
  ok('no clear-probation action offered',
    !(career().availableActions || []).includes('clear-probation'),
    JSON.stringify(career().availableActions || []));
  ok('and no promote action either',
    !(career().availableActions || []).includes('promote'),
    JSON.stringify(career().availableActions || []));

  head('4. #72 The API refuses it too');
  let refused = null;
  try { await api('/career/clear-probation', 'POST', { note: 'trying it on' }); }
  catch (e) { refused = e.message; }
  ok('clearing without the reviews is refused', refused !== null, (refused || '(ALLOWED!)').slice(0, 140));
  ok('and it says what is missing', /review/i.test(refused || ''), (refused || '').slice(0, 140));

  head('5. #74 There is no way to set your own rate');
  let payGone = null;
  try { await api('/career/pay', 'POST', { loadedCpm: 5, deadheadCpm: 5, reason: 'nice try' }); }
  catch (e) { payGone = e.status; }
  ok('POST /career/pay is gone', payGone === 404, `status ${payGone}`);
  S = un(await api('/bootstrap'));
  ok('and the rate is untouched', S.driver.pay.loadedCpm === startLoaded, `$${S.driver.pay.loadedCpm}`);

  head('6. #73 Three good reviews, and it clears itself');
  let cleared = null;
  for (let period = 1; period <= 3 && !cleared; period++) {
    for (let i = 0; i < 4; i++) await runLoad(i % 2 ? 'Tulsa' : 'Oklahoma City', 'OK');
    day += 8;                                   // a review needs a period to review
    const r = await report(hCity, hState, day, 'Terminal');
    const revs = (S.views.probation?.reviews) || [];
    console.log(`     period ${period}: ${revs.length} review(s), latest ${revs[0]?.verdict}, ` +
                `${revs[0]?.passesInARow} in a row`);
    if (revs[0]?.verdict === 'Fail') console.log(`       concerns: ${(revs[0].concerns || []).join(' | ')}`);
    if (r.advance) cleared = r.advance;
    day += 2;
    await report('Tulsa', 'OK', day);           // leave, so the next arrival is an arrival
  }

  ok('probation cleared on its own', !!cleared, cleared ? cleared.headline : '(never cleared)');
  if (cleared) {
    ok('it is announced as a probation clearing', cleared.kind === 'probation', cleared.kind);
    ok('the driver is told the new rank', /Company Driver/i.test(cleared.rankTitle), cleared.rankTitle);
    ok('and the new rate', +cleared.loadedCpm > +cleared.previousLoadedCpm,
      `$${cleared.previousLoadedCpm} -> $${cleared.loadedCpm}`);
    ok('the empty rate too', +cleared.deadheadCpm > 0, `$${cleared.deadheadCpm}`);
    ok('with something to read', (cleared.detail || []).length >= 2,
      `${(cleared.detail || []).length} lines`);
    ok('and it says settled work stays settled',
      (cleared.detail || []).some((d) => /already paid|next settlement/i.test(d)),
      (cleared.detail || []).join(' | ').slice(0, 120));
  }

  S = un(await api('/bootstrap'));
  ok('rank actually moved', S.driver.rank === 'company', S.driver.rank);
  ok('and the pay on file moved with it', S.driver.pay.loadedCpm > startLoaded,
    `$${startLoaded} -> $${S.driver.pay.loadedCpm}`);
  ok('probation is behind them', career().probationActive === false, `${career().probationActive}`);

  head('7. #73 The next rung is not offered as a button either');
  ok('no promote action', !(career().availableActions || []).includes('promote'),
    JSON.stringify(career().availableActions || []));
  ok('and not eligible yet anyway', career().nextRankMet === false, `${career().nextRankMet}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
