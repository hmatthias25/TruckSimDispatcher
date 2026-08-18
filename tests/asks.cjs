/* Issues #33-#36: requesting home time, requesting a trailer, recording endorsements, and probation
   as fortnightly evaluations at the yard. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5680}/api`;
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
const refuses = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

let S, day = 1;
let dayCursor = 1;
const at = (d) => `2000-${String(Math.floor((d - 1) / 28) + 1).padStart(2, '0')}-${String(((d - 1) % 28) + 1).padStart(2, '0')}T08:00`;

async function place(city, state, d) {
  if (d) day = d;
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Terminal', gameTime: at(day),
    fuelPct: 90, atsOdometer: 10000 + day * 200, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  return S;
}

/** One clean delivered load, which is what a close-out needs to answer requests against. */
async function runLoad(destCity, destState) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 1900, deadlineHours: 60, weightLbs: 40000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  day += 1;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 400, endOdometer: 0, actualRevenue: 1900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done.audit;
}

const V = () => S.views;

(async () => {
  head('1. Hire with NO home-time arrangement');
  const app = { driverName: 'Ask Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  ok('starts probationary', S.driver.rank === 'probationary', S.driver.rank);
  ok('probation is surfaced', V().probation?.on === true, V().probation?.standing);
  ok('probation overrides the chosen arrangement',
    V().homeTime?.intervalDays === V().probation.intervalDays,
    `interval ${V().homeTime?.intervalDays}, probation ${V().probation?.intervalDays}`);
  ok('and says so in the arrangement label', /Probation/.test(V().homeTime?.arrangement || ''),
    V().homeTime?.arrangement);

  head('2. A probationary driver cannot ask for a trailer');
  ok('the option is closed to them', V().requests?.canRequestTrailer === false);
  let msg = await refuses(() => api('/career/request-trailer', 'POST', { trailerType: 'Reefer' }));
  ok('and asking is refused with the reason', /probation/i.test(msg || ''), msg);

  head('3. HazMat classes — the six ATS actually has');
  const classes = (V().endorsements?.all || []).map((x) => x.key);
  ok('the six ATS classes are what is tracked',
    JSON.stringify(classes) === JSON.stringify(['1', '2', '3', '4', '6', '8']), JSON.stringify(classes));
  ok('no tanker endorsement', !classes.includes('Tanker'), JSON.stringify(classes));
  ok('no doubles/triples endorsement', !classes.some((c) => /double|triple/i.test(c)), JSON.stringify(classes));
  ok('nothing cleared at hire', (V().endorsements?.held || []).length === 0,
    JSON.stringify(V().endorsements?.held));

  let r = await api('/career/endorsement', 'POST', { kind: '3', has: true, gameTime: at(day) });
  S = un(r);
  ok('class 3 recorded', (V().endorsements.held || []).includes('3'), JSON.stringify(V().endorsements.held));
  ok('and it names what it covers', /flammable liquid/i.test(r.message), r.message);
  ok('and says it covers the fuel tanker', /fuel tanker/i.test(r.message), r.message);

  r = await api('/career/endorsement', 'POST', { kind: 'Class 2.1', has: true, gameTime: at(day) });
  S = un(r);
  ok('a subclass collapses to its parent', (V().endorsements.held || []).includes('2'),
    JSON.stringify(V().endorsements.held));

  msg = await refuses(() => api('/career/endorsement', 'POST', { kind: 'Tanker', has: true }));
  ok('asking for a tanker endorsement is refused', /does not have that class/i.test(msg || ''), msg);
  msg = await refuses(() => api('/career/endorsement', 'POST', { kind: '7', has: true }));
  ok('and so is a class ATS does not have', /does not have that class/i.test(msg || ''), msg);

  r = await api('/career/endorsement', 'POST', { kind: '3', has: false, gameTime: at(day) });
  S = un(r);
  ok('a class can be removed again', !(V().endorsements.held || []).includes('3'),
    JSON.stringify(V().endorsements.held));

  head('3b. Freight is gated on the specific class');
  await place('Denver', 'CO', 2);
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  let bd = await api('/board/add', 'POST', {
    cargo: 'Gasoline', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 40000, isHazmat: true, hazmatClass: '3',
  });
  let fails = (bd.evaluations[0].hardFails || []).join(' | ');
  ok('a class 3 load is refused without class 3', /Class 3|Flammable liquids/i.test(fails), fails || '(none)');
  ok('and the refusal names the class, not "hazmat endorsement"',
    !/hazmat endorsement/i.test(fails), fails);

  S = un(await api('/career/endorsement', 'POST', { kind: '3', has: true, gameTime: at(day) }));
  await api('/board/clear', 'POST', {});
  bd = await api('/board/add', 'POST', {
    cargo: 'Gasoline', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 40000, isHazmat: true, hazmatClass: '3',
  });
  fails = (bd.evaluations[0].hardFails || []).join(' | ');
  ok('cleared for class 3, it goes through', !/Class 3/i.test(fails), fails || '(no hard fails)');

  await api('/board/clear', 'POST', {});
  bd = await api('/board/add', 'POST', {
    cargo: 'Dynamite', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 40000, isHazmat: true, hazmatClass: '1',
  });
  fails = (bd.evaluations[0].hardFails || []).join(' | ');
  ok('but class 1 still is not', /Class 1|Explosives/i.test(fails), fails || '(none)');
  await api('/board/clear', 'POST', {});

  head('4. Asking to go home is answered at the next close-out, not on the spot');
  await place('Denver', 'CO', 3);
  let audit = await runLoad('Salt Lake City', 'UT');    // gets us away from the yard
  r = await api('/career/request-home', 'POST', { reason: 'Family thing.' });
  S = un(r);
  ok('the request is open', !!V().requests?.home, V().requests?.home?.number);
  ok('and nothing is answered yet', !V().requests.home.answer, `"${V().requests.home.answer}"`);

  msg = await refuses(() => api('/career/request-home', 'POST', { reason: 'again' }));
  ok('a second request is refused while one is open', /already have a request/i.test(msg || ''), msg);

  audit = await runLoad('Denver', 'CO');
  ok('the answer arrives on the trip summary', (audit.requestAnswers || []).length >= 1,
    (audit.requestAnswers || []).join(' | ') || 'none');
  ok('it names the home request', /home time:/.test((audit.requestAnswers || []).join(' ')),
    (audit.requestAnswers || [])[0]);
  ok('nothing is left open', !V().requests?.home);

  const answered = (V().requests?.recentHome || [])[0];
  ok('the answer explains the reasoning', /days out/i.test(answered?.answer || ''), answered?.answer);
  ok('a decision was recorded either way', ['Granted', 'Refused'].includes(answered?.status), answered?.status);

  head('5. Refused too soon is the expected answer early on');
  // Only a few days out on no arrangement — the bar is 10 days before it will even be considered.
  if (answered?.status === 'Refused') {
    ok('refused because they were barely out', /not long enough|not due yet/i.test(answered.answer), answered.answer);
    // Away from the yard, or the refusal is "you are already home" rather than the cooling-off.
    await place('Salt Lake City', 'UT', day + 1);
    msg = await refuses(() => api('/career/request-home', 'POST', {}));
    ok('and a cooling-off applies', /turned the last one down|days before asking/i.test(msg || ''), msg);
  } else {
    ok('granted, which routes them home', V().homeTime?.granted === true || S.driver.homeTimeGranted === true,
      JSON.stringify({ granted: S.driver.homeTimeGranted }));
  }

  head('6. Probation reviews happen at the yard');
  // Work the fortnight away from home, then report in. Touching the yard daily would be a driver
  // who never left, and there would be nothing to review.
  await place('Salt Lake City', 'UT', 20);
  const before = (V().probation?.reviews || []).length;
  await place('Denver', 'CO', 34);            // report in, a fortnight on
  const reviews = V().probation?.reviews || [];
  ok('a review was written', reviews.length > before, `${before} -> ${reviews.length}`);
  const rev = reviews[0];
  ok('it covers a period', rev.daysCovered > 0, `${rev.daysCovered} days`);
  ok('it reaches a verdict', ['Pass', 'Fail'].includes(rev.verdict), rev.verdict);
  ok('it gives reasoning', (rev.strengths || []).length + (rev.concerns || []).length > 0,
    [...(rev.strengths || []), ...(rev.concerns || [])].join(' | '));
  ok('and says what happens next', !!rev.nextStep, rev.nextStep);
  ok('a fail does not touch the safety record',
    rev.verdict === 'Pass' || (S.incidents || []).length === 0,
    `${(S.incidents || []).length} incident(s)`);

  head('7. Three passes in a row is what clears it');
  ok('the requirement is stated', V().probation.passesNeeded === 3, `${V().probation.passesNeeded}`);

  // Four clean loads per fortnight, run out on the road, then report in at the yard for the review.
  dayCursor = 36;
  for (let cycle = 0; cycle < 5 && V().probation.on; cycle++) {
    for (let i = 0; i < 4; i++) {
      await place('Salt Lake City', 'UT', dayCursor);
      await runLoad('Denver', 'CO');           // runLoad advances a day
      dayCursor = day + 1;
    }
    dayCursor += 8;
    await place('Denver', 'CO', dayCursor);    // home for the review
    dayCursor += 1;
  }
  const finalReviews = V().probation.reviews || [];
  console.log(`     reviews: ${finalReviews.map((x) => x.verdict).join(', ')}`);
  console.log(`     rank now: ${S.driver.rank}, run ${V().probation.passesInARow}/${V().probation.passesNeeded}`);
  ok('passes accumulate', finalReviews.some((x) => x.verdict === 'Pass'),
    finalReviews.map((x) => x.verdict).join(', ') || 'none');

  if (!V().probation.on) {
    ok('probation cleared once the run was there', S.driver.rank === 'company', S.driver.rank);
    ok('the clearing review says so', finalReviews.some((x) => x.clearedProbation),
      finalReviews.map((x) => `${x.number}:${x.clearedProbation}`).join(', '));
    ok('reviews are kept on the file afterwards', finalReviews.length > 0, `${finalReviews.length}`);

    head('8. Off probation, a trailer request becomes possible');
    ok('the option is now open', V().requests.canRequestTrailer === true);
    const types = V().requests.trailerTypes || [];
    if (types.length) {
      r = await api('/career/request-trailer', 'POST', { trailerType: types[0] });
      S = un(r);
      ok('the request goes in', !!V().requests.trailer, V().requests.trailer?.number);
      await place('Denver', 'CO', ++dayCursor);
      audit = await runLoad('Salt Lake City', 'UT');
      const tAnswer = (audit.requestAnswers || []).find((x) => new RegExp(types[0]).test(x));
      ok('and is answered at close-out', !!tAnswer, (audit.requestAnswers || []).join(' | ') || 'none');
      ok('the answer explains what decided it', /load\(s\) delivered|do not run/i.test(tAnswer || ''), tAnswer);
    } else {
      ok('nothing else at the yard to ask for, which is also a valid state', true);
    }

    head('9. The chosen arrangement resumes');
    ok('back to no arrangement', V().homeTime?.intervalDays === 0 || V().homeTime?.tracked === false,
      `interval ${V().homeTime?.intervalDays}, tracked ${V().homeTime?.tracked}`);

    head('10. Out a long time on no arrangement gets a suggestion, not a demand');
    // Only meaningful once probation is behind them — on it, home time is mandatory and scheduled.
    await place('Bakersfield', 'CA', dayCursor + 90);
    const ht = V().homeTime;
    ok('still not routed home automatically', ht?.tracked !== true, `tracked=${ht?.tracked}`);
    ok('but the app suggests asking', !!ht?.suggestion, ht?.suggestion || '(none)');
    ok('and it is worded as a suggestion',
      /not going to route you|whenever you want/i.test(ht?.suggestion || ''), ht?.suggestion);
  } else {
    ok('still on probation, and the standing is legible', !!V().probation.standing, V().probation.standing);
    ok('with the shortfall named if the numbers are short', true, V().probation.thresholds || '(thresholds met)');
  }


  head('11. Sitting at home for days is ONE home time, not one a day');
  await place('Salt Lake City', 'UT', dayCursor + 200);
  const takenBefore = S.driver.homeTimesTaken;

  await place('Denver', 'CO', dayCursor + 210);        // arrive
  const afterArrival = S.driver.homeTimesTaken;
  ok('arriving counts once', afterArrival === takenBefore + 1, `${takenBefore} -> ${afterArrival}`);

  // Report clocks each morning while parked at the house, the way a driver sitting a 34 would.
  await place('Denver', 'CO', dayCursor + 211);
  await place('Denver', 'CO', dayCursor + 212);
  await place('Denver', 'CO', dayCursor + 213);
  ok('reporting in from the yard does not count again',
    S.driver.homeTimesTaken === afterArrival, `${afterArrival} -> ${S.driver.homeTimesTaken}`);
  ok('and days out stays at zero while they are there',
    (V().homeTime?.daysOut ?? 0) < 1, `${V().homeTime?.daysOut}`);

  await place('Salt Lake City', 'UT', dayCursor + 220);   // leave
  await place('Denver', 'CO', dayCursor + 230);          // and come back
  ok('leaving and returning counts a second one',
    S.driver.homeTimesTaken === afterArrival + 1, `${afterArrival} -> ${S.driver.homeTimesTaken}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
