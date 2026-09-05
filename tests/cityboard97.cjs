/* Issue #97 — near home time, dispatch committed off a 3-load dock board without ever asking for the city.
 *
 * Reported from a real career: 0.2 days to home time, pulled in at a small receiver with three loads on
 * it — San Francisco, Sonora TX, Cody WY — and dispatch took Cody because it was the one that did not run
 * further out. But that was three loads at one dock. Other shippers in the same town may well have had
 * something toward Missouri, and nobody looked.
 *
 * The board screen has always promised "show me these first; if none of them work I will ask for the
 * whole city". It only ever asked down the rejection path, so a merely acceptable local load was
 * committed to and the city was never seen. Acceptable is not the same as gets you home.
 *
 * And Cody is a thin market — the worst kind of place to be needing a load out of when you are due home.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5967}/api`;
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
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

let S;
async function place(city, state, day, kind = 'Receiver') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: iso(day),
    fuelPct: 90, atsOdometer: 20000 + day * 60, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  return S;
}

/** The dock board: a handful of loads out of where the driver is standing. */
async function dockBoard(rows) {
  await api('/board/clear', 'POST', {});
  let last;
  for (const [city, state, miles, rev] of rows) {
    last = await api('/board/add', 'POST', {
      cargo: `To ${city}`, trailerType: S.trailers[0].type, atLocation: true,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: city, destState: state, loadedMiles: miles, deadheadMiles: 0,
      gameRevenue: rev, deadlineHours: 40, weightLbs: 30000,
    });
  }
  return last;
}

/** The same, but off the wider city board — a load you would deadhead to. */
async function cityBoard(rows) {
  await api('/board/clear', 'POST', {});
  let last;
  for (const [city, state, miles, rev] of rows) {
    last = await api('/board/add', 'POST', {
      cargo: `To ${city}`, trailerType: S.trailers[0].type, atLocation: false,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: city, destState: state, loadedMiles: miles, deadheadMiles: 12,
      gameRevenue: rev, deadlineHours: 40, weightLbs: 30000,
    });
  }
  return last;
}

(async () => {
  const app = { driverName: 'C. Board', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Home time nowhere near: a dock board is committed to as before');
  await place('Oklahoma City', 'OK', 4);
  let hs = (await api('/bootstrap')).views.homeTime;
  ok('not due yet', hs.dueSoon === false, `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);
  let bd = await dockBoard([['Denver', 'CO', 620, 1900], ['Amarillo', 'TX', 260, 850]]);
  ok('a load is authorized off the dock board', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('nothing asks for the city', bd.wantCityBoard !== true, `wantCityBoard=${bd.wantCityBoard}`);

  head('2. Wind home time on until it is close');
  // Close, not broken. Issue #97 was reported at 0.2 days to go, and that is the case this suite is
  // about: loads that are merely argued with, so there is still something to hold and name as a backup.
  // Once the arrangement is actually broken, #101/#109 disqualify a wrong-way load outright and there is
  // no backup to offer — that case has its own suite.
  for (const d of [10, 12]) await place('Oklahoma City', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is due but not yet broken', hs.dueSoon === true && hs.overdue === false,
    `due in ${hs.daysUntilDue?.toFixed?.(1)} days, overdue ${hs.overdue}`);
  ok('and at least one of these is still takeable, which is what the hold is for',
    hs.outboundAllowance > 400, `${hs.outboundAllowance} mi of room with ${hs.daysUntilDue?.toFixed?.(1)} days left`);

  head('3. The reported case — three loads at one dock, none of them going home');
  bd = await dockBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Sonora', 'TX', 480, 1500],
                        ['Cody', 'WY', 980, 2900]]);
  ok('nothing is authorized', !bd.authorizedLoadId, bd.authorizedLoadId || 'held');
  ok('but the board is NOT rejected either', bd.rejectAll !== true, `rejectAll=${bd.rejectAll}`);
  ok('it asks for the city board', bd.wantCityBoard === true, `${bd.wantCityBoard}`);
  ok('and says so in the headline', /show me the city board/i.test(bd.headline || ''), bd.headline);
  ok('counting the loads it saw', /3 load/i.test(bd.rationale || ''), (bd.rationale || '').slice(0, 90));
  ok('naming the yard none of them reaches', /Springfield/i.test(bd.rationale || ''), 'named');
  ok('it names the one it would have taken, so the override is one click',
    !!bd.heldLoadId, bd.heldLoadId || 'none');
  ok('and the one it names is genuinely takeable, not one it would refuse',
    ((bd.evaluations || []).find((e) => e.load.id === bd.heldLoadId)?.homeTimeFails || []).length === 0,
    'no home-time disqualification on the backup');
  ok('and that load is marked as the backup, not a reject',
    (bd.evaluations || []).find((e) => e.load.id === bd.heldLoadId)?.recommendation === 'Backup',
    (bd.evaluations || []).find((e) => e.load.id === bd.heldLoadId)?.recommendation || '?');

  head('4. The override: a dock really is all there is');
  const auth = await api('/dispatch/authorize', 'POST', { loadId: bd.heldLoadId });
  ok('authorizing the held load works', !!auth.trip?.number, auth.trip?.number || 'refused');
  await api(`/trips/${auth.trip.id}/cancel`, 'POST', { reason: 'fixture' });

  head('4b. #115 Closer to the date, nothing here is takeable — and it still says to show the city');
  // With two days left rather than three, the outbound room drops to 300 mi and none of these three
  // qualifies. There is no backup to name, so the hold cannot fire — but the advice it exists to give
  // must survive: this is one dock, go and look at the town.
  await place('Oklahoma City', 'OK', 13);
  const tight = await dockBoard([['San Francisco', 'CA', 1650, 4200],
                                 ['Sonora', 'TX', 480, 1500],
                                 ['Cody', 'WY', 980, 2900]]);
  ok('nothing is authorized', !tight.authorizedLoadId, tight.authorizedLoadId || 'none');
  ok('every one of them is refused on home time',
    (tight.evaluations || []).every((e) => (e.homeTimeFails || []).length > 0),
    (tight.evaluations || []).filter((e) => !(e.homeTimeFails || []).length).length + ' unrefused');
  ok('and the driver is still told to open the city board',
    /open the full freight board for/i.test((tight.dispatchNotes || []).join(' ')),
    'said');
  await place('Oklahoma City', 'OK', 12);      // back to where the rest of the suite expects him

  head('5. Pull the city board and it commits');
  bd = await cityBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Sonora', 'TX', 480, 1500],
                        ['Cody', 'WY', 980, 2900]]);
  ok('a wider board is not held', bd.wantCityBoard !== true, `wantCityBoard=${bd.wantCityBoard}`);
  ok('and something is authorized', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('but not one of the two that run a different week away — #101 disqualifies those',
    !['San Francisco', 'Cody'].includes(
      ((bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId) || {}).load?.destCity || ''),
    ((bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId) || {}).load?.destCity || 'none');

  head('5b. A city board with one load home prefers it');
  bd = await cityBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Springfield', 'MO', 330, 1050],
                        ['Cody', 'WY', 980, 2900]]);
  ok('something is authorized', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('and it is the one going home',
    /Springfield/i.test(((bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId)
      || {}).load?.destCity || ''), 'home');

  head('6. A dock board WITH a load going home is taken without any fuss');
  bd = await dockBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Springfield', 'MO', 210, 700],
                        ['Cody', 'WY', 980, 2900]]);
  ok('no question raised', bd.wantCityBoard !== true, `wantCityBoard=${bd.wantCityBoard}`);
  const picked = (bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId);
  ok('and the one going home is the one taken',
    /Springfield/i.test(picked?.load?.destCity || ''), picked?.load?.destCity || 'none');

  head('7. The thin market it wanted to send me to costs more now');
  // Cody is thin. Score it with home time close, then with home time reset, and compare.
  bd = await dockBoard([['Cody', 'WY', 980, 2900]]);
  const nearHome = (bd.evaluations || [])[0];
  const thinNear = (nearHome.scoreDetail || []).find((x) => /Cody/i.test(x)) || '';
  ok('the thin-market line says home time is why it hurts',
    /home time is close/i.test(thinNear), thinNear.slice(0, 120) || '(none)');
  ok('and it is spelled out on the card',
    (nearHome.cons || []).some((c) => /thin market and you are due home/i.test(c)),
    (nearHome.cons || []).find((c) => /thin market/i.test(c))?.slice(0, 110) || '(none)');
  const penaltyNear = parseFloat((thinNear.match(/(-?\d+\.\d\d)$/) || [])[1] || '0');

  // Home again resets the arrangement, so the same load should be judged more gently.
  await place('Springfield', 'MO', 27, 'Terminal');
  await api('/hometime/take', 'POST', {}).catch(() => {});
  await place('Oklahoma City', 'OK', 28);
  hs = (await api('/bootstrap')).views.homeTime;
  bd = await dockBoard([['Cody', 'WY', 980, 2900]]);
  const farHome = (bd.evaluations || [])[0];
  const thinFar = (farHome.scoreDetail || []).find((x) => /Cody/i.test(x)) || '';
  const penaltyFar = parseFloat((thinFar.match(/(-?\d+\.\d\d)$/) || [])[1] || '0');
  if (hs.dueSoon === false) {
    ok('with home time reset the thin-market penalty is lighter',
      penaltyNear < penaltyFar, `${penaltyNear} near home vs ${penaltyFar} not due`);
    ok('and the home-time reason is gone from the line',
      !/home time is close/i.test(thinFar), thinFar.slice(0, 110));
  } else {
    ok('(home time did not reset in this run; the near-home penalty still applied)',
      penaltyNear < 0, `${penaltyNear}`);
    ok('and it is still explained', /home time is close/i.test(thinFar), thinFar.slice(0, 90));
  }

  head('#187 A dock board of poor freight is held too, whatever the home-time date says');
  // Reported from play: "the dispatcher should not be shy to reject all jobs at a receiver if none of
  // them are that good... better to have a 20 mile deadhead run to another receiver than to lose money
  // on crappy jobs."
  //
  // The hold above existed for one trigger only — home time close — and its own comment called that
  // "the expensive case". It is AN expensive case. Committing the tractor for a day and a half to
  // freight that loses money is expensive whenever it happens.
  await place('Oklahoma City', 'OK', 30);           // home time freshly taken, so it is not the trigger
  const hsFar = (await api('/bootstrap')).views.homeTime;
  ok('home time is not what is driving this', hsFar.dueSoon === false,
    `due in ${hsFar.daysUntilDue?.toFixed?.(1)} days`);

  // Above break-even, so these are not the pre-existing "this load loses money" rejection — they are
  // genuinely takeable freight that is simply not worth the truck. That is the gap this fills.
  const poor = await dockBoard([['Denver', 'CO', 620, 840], ['Amarillo', 'TX', 260, 360]]);
  ok('nothing is authorized off a dock of loads this thin', !poor.authorizedLoadId,
    poor.authorizedLoadId || 'none authorized');
  ok('the city board is asked for instead', poor.wantCityBoard === true, `${poor.wantCityBoard}`);
  ok('and the money is named, not just asserted',
    /loses about \$|under our \$|an hour for as long/i.test(poor.rationale || ''),
    (poor.rationale || '').slice(0, 190));
  ok('it says how long the truck would be tied up',
    /tie the truck up/i.test(poor.rationale || ''), (poor.rationale || '').slice(0, 200));
  ok('a deadhead to better freight is offered as the point',
    /twenty miles of deadhead/i.test(poor.rationale || ''), (poor.rationale || '').slice(-120));

  head('#187b It is a hold, not a rejection — the driver can still take it');
  ok('the best of them is held and named', !!poor.heldLoadId, poor.heldLoadId || 'none');
  ok('and offered as the backup rather than binned',
    (poor.evaluations || []).find((e) => e.load.id === poor.heldLoadId)?.recommendation === 'Backup',
    (poor.evaluations || []).find((e) => e.load.id === poor.heldLoadId)?.recommendation || '?');
  const took = await api('/dispatch/authorize', 'POST', { loadId: poor.heldLoadId });
  ok('authorizing it directly is the override', !!took.trip, took.trip?.number || 'refused');
  await api('/trips/' + took.trip.id + '/cancel', 'POST', { reason: 'fixture' });

  head('#187c Decent freight off the same dock is still committed to');
  // The floor has to be a floor, not a mood. Rates that clear it are taken without ceremony.
  await place('Oklahoma City', 'OK', 33);
  const fine = await dockBoard([['Denver', 'CO', 620, 1900], ['Amarillo', 'TX', 260, 850]]);
  ok('a paying dock board is authorized as before', !!fine.authorizedLoadId,
    fine.authorizedLoadId || 'none');
  ok('and nothing asks for the city', fine.wantCityBoard !== true, `${fine.wantCityBoard}`);

  head('#188/#189 The reported scenario: 16 hours of cycle, 3.5 days to home time');
  // "Taking a load to Oklahoma City. When I get there I'll have around 16 hours on my cycle left. IN
  // ADDITION I am also 3.5 days from home time. Ideally dispatch would want to prioritize getting me
  // back to my terminal in Springfield MO to take my 34."
  //
  // Both triggers fire at those numbers — the reset watch at 18 hours of cycle, and DueSoon at
  // IntervalDays * 0.75, which on a biweekly is exactly 3.5 days out. They were scored as unrelated
  // terms, so a reset-capable truck stop anywhere scored what the driver's own yard scored.
  // Earlier sections took home time, so wind the clock forward to where the driver is due again rather
  // than assuming a day number.
  let hs34 = null;
  for (let d = 40; d <= 80 && !hs34; d += 1) {
    await place('Oklahoma City', 'OK', d);
    const st = (await api('/bootstrap')).views.homeTime;
    if (st.dueSoon === true && st.overdue === false) hs34 = st;
  }
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 16 });
  ok('home time is due, not yet overdue', !!hs34,
    hs34 ? `due in ${hs34.daysUntilDue?.toFixed?.(1)} days` : 'never landed in the window');

  // Both reset-capable, both paying about the same per mile — so the thing deciding this is the yard,
  // not the rate. Springfield is the terminal; Tulsa is a truck stop town like any other.
  const both = await dockBoard([['Springfield', 'MO', 250, 700], ['Tulsa', 'OK', 240, 680]]);
  const home34 = (both.evaluations || []).find((e) => e.load.destCity === 'Springfield');
  const away34 = (both.evaluations || []).find((e) => e.load.destCity === 'Tulsa');

  ok('the yard run is the one authorized', both.authorizedLoadId === home34?.load.id,
    `${(both.evaluations || []).find((e) => e.load.id === both.authorizedLoadId)?.load.destCity || 'none'}`);
  ok('and it outscores the reset-capable one that is not home',
    home34 && away34 && home34.score > away34.score,
    `Springfield ${home34?.score?.toFixed?.(2)} vs Tulsa ${away34?.score?.toFixed?.(2)}`);
  ok('the score line says the restart and the home time are the same 34',
    (home34?.scoreDetail || []).some((d) => /the same 34/i.test(d)),
    (home34?.scoreDetail || []).find((d) => /reset watch/i.test(d)) || '(not scored)');
  ok('and the card puts it in the driver terms',
    (home34?.pros || []).some((x) => /one stop for both/i.test(x)),
    (home34?.pros || []).find((x) => /Sit the 34/i.test(x))?.slice(0, 130) || '(silent)');
  ok('the reasoning says it too, rather than "somewhere you can sit the restart"',
    /one stop, not two/i.test(both.rationale || ''), (both.rationale || '').slice(-150));

  head('#188 A yard the market table has never heard of can still hold a restart');
  // DestResetFriendly read the city table alone, so a terminal in a town not listed came back false —
  // McDonough GA, Mondovi WI and Tontitown AR are all real carrier yards and none of them are in it.
  // The driver's own domicile scored as NOT a good restart location.
  const yards = (await api('/bootstrap')).company.terminals || [];
  ok('the company has a yard to test with', yards.length > 0, `${yards.length} terminal(s)`);
  ok('and a load finishing there is treated as restart-capable',
    home34?.destResetFriendly === true, `${home34?.destResetFriendly}`);

  head('#189b And when the dock has nothing going home, it asks BEFORE sending you elsewhere');
  // The follow-up question: "what would happen if I stop in Oklahoma City and the receiver has none of
  // these — would the app check the city board before sending me somewhere not in that area?"
  //
  // This is the #97 hold, and it has to keep working now the reset watch is also live: a load that is
  // reset-capable but nowhere near the yard must not walk past it on the strength of the new term.
  const away = await dockBoard([['Amarillo', 'TX', 260, 900], ['Wichita', 'KS', 160, 560]]);
  ok('nothing is committed to off that dock', !away.authorizedLoadId,
    (away.evaluations || []).find((e) => e.load.id === away.authorizedLoadId)?.load.destCity || 'none');
  ok('the city board is asked for first', away.wantCityBoard === true, `${away.wantCityBoard}`);
  ok('and the reason is the yard, not the money',
    /not one of them finishes near/i.test(away.rationale || ''), (away.rationale || '').slice(0, 160));
  ok('it still names one as the backup, so a dock that really is all there is can be taken',
    !!away.heldLoadId, away.heldLoadId || 'none');

  head('#189c Show it the city board and the yard run wins');
  await api('/board/clear', 'POST', {});
  for (const [c, st2, mi, rev, atLoc] of [
    ['Amarillo', 'TX', 260, 900, true], ['Wichita', 'KS', 160, 560, true],
    ['Springfield', 'MO', 250, 700, false]]) {
    await api('/board/add', 'POST', {
      cargo: `To ${c}`, trailerType: S.trailers[0].type, atLocation: atLoc,
      originCity: 'Oklahoma City', originState: 'OK',
      destCity: c, destState: st2, loadedMiles: mi, deadheadMiles: atLoc ? 0 : 20,
      gameRevenue: rev, deadlineHours: 40, weightLbs: 30000,
    });
  }
  const city = await api('/board/evaluate');
  const won = (city.evaluations || []).find((e) => e.load.id === city.authorizedLoadId);
  ok('a wider board is not held again', city.wantCityBoard !== true, `${city.wantCityBoard}`);
  ok('and the yard run is the one taken, deadhead and all', won?.load.destCity === 'Springfield',
    `${won?.load.destCity || 'none'} (${won?.load.deadheadMiles || 0} mi deadhead)`);
  ok('even against better-paying freight that is not home',
    (city.evaluations || []).some((e) => e.load.destCity === 'Amarillo' && e.score < (won?.score ?? 0)),
    `Springfield ${won?.score?.toFixed?.(2)} vs Amarillo ${(city.evaluations || []).find((e) => e.load.destCity === 'Amarillo')?.score?.toFixed?.(2)}`);

  head('Reported from play: Ottumwa IA against Kansas City MO, out of Oklahoma City');
  // Queried from a real career — "I was given the load to Ottumwa IA, which isn't in the 200 mile range
  // to get back to Springfield, when Kansas City was." Could not be reproduced: Kansas City wins on
  // comparable figures and wins clearly. Kept as the regression test, because the terms deciding it are
  // ones recent work has been moving — the reset watch scores the yard now, and both of these are
  // reset-capable, so neither gets an edge from it.
  const okc = await dockBoard([['Ottumwa', 'IA', 600, 2100], ['Kansas City', 'MO', 350, 1250]]);
  const kc = (okc.evaluations || []).find((e) => e.load.destCity === 'Kansas City');
  const ott = (okc.evaluations || []).find((e) => e.load.destCity === 'Ottumwa');

  ok('Kansas City is the one authorized', okc.authorizedLoadId === kc?.load.id,
    (okc.evaluations || []).find((e) => e.load.id === okc.authorizedLoadId)?.load.destCity || 'none');
  ok('and it is not close', (kc?.score ?? 0) - (ott?.score ?? 0) > 2,
    `Kansas City ${kc?.score?.toFixed?.(2)} vs Ottumwa ${ott?.score?.toFixed?.(2)}`);
  ok('because Kansas City lands inside the home radius',
    (kc?.scoreDetail || []).some((d) => /inside our .* home radius/i.test(d)),
    (kc?.scoreDetail || []).find((d) => /home radius/i.test(d)) || '(no home term)');
  ok('while Ottumwa is no nearer home than Oklahoma City already was',
    (ott?.scoreDetail || []).some((d) => /neutral on home time/i.test(d)),
    (ott?.scoreDetail || []).find((d) => /home time/i.test(d)) || '(no home term)');
  ok('both can hold a restart, so the reset watch does not pick between them',
    kc?.destResetFriendly === true && ott?.destResetFriendly === true,
    `KC ${kc?.destResetFriendly} / Ottumwa ${ott?.destResetFriendly}`);

  head('#190 A better load dropped on feasibility is named, not silently binned');
  // The real board, with the figures off the driver's own score cards: Kansas City scored 4.43 and came
  // out Tight on zero slack; Ottumwa scored 2.79, was feasible, and won by being the only candidate.
  // Both cards were on screen and neither said why the lower number was taken.
  // Home time taken first, and a CITY board. Two things have to be out of the way for this section to
  // be about what it says it is: on a dock-only board with nothing near the yard the #97 hold fires and
  // nothing is authorized at all, and with home time due a 561-mile run outbound is disqualified
  // outright. Both are covered above. This is about what happens once something IS being authorized.
  await place('Springfield', 'MO', 210, 'Terminal');
  await place('Oklahoma City', 'OK', 212);
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: false,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Ottumwa', destState: 'IA',
    loadedMiles: 561, deadheadMiles: 10, gameRevenue: 2136, deadlineHours: 40, weightLbs: 30000,
  });
  // Deliverable, but inside the safety buffer: 343 miles plus the dock at both ends is about 10:30,
  // so twelve hours leaves under the 2:00 we want. That is Tight, not impossible.
  const tightBoard = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: false,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Kansas City', destState: 'MO',
    loadedMiles: 343, deadheadMiles: 10, gameRevenue: 1237, deadlineHours: 12, weightLbs: 30000,
  });
  const kcT = (tightBoard.evaluations || []).find((e) => e.load.destCity === 'Kansas City');
  const ottT = (tightBoard.evaluations || []).find((e) => e.load.destCity === 'Ottumwa');

  ok('the Kansas City run does not clear the safety buffer', kcT?.feasibility.verdict !== 'Feasible',
    `${kcT?.feasibility.verdict}, ${kcT?.feasibility.slackHours}h slack`);
  ok('so Ottumwa is the one authorized', tightBoard.authorizedLoadId === ottT?.load.id,
    (tightBoard.evaluations || []).find((e) => e.load.id === tightBoard.authorizedLoadId)?.load.destCity || 'none');

  const notes = (tightBoard.dispatchNotes || []).join(' | ');
  const named = (tightBoard.dispatchNotes || []).find((x) => /scored better/i.test(x)) || '';
  if ((kcT?.score ?? 0) > (ottT?.score ?? 0)) {
    ok('the better-scoring one is named rather than left as a red card with no reason',
      /scored better/i.test(notes), named.slice(0, 200) || '(silent)');
    ok('with the slack that ruled it out', /slack against our/i.test(named), named.slice(0, 200));
    ok('and the override offered, the same as on a rejected board',
      /authorize it directly/i.test(named), named.slice(-110));
    ok('it is offered as the backup, not a reject', kcT?.recommendation === 'Backup',
      kcT?.recommendation || '?');
  } else {
    // A window that tight costs score as well as feasibility, so it does not always outscore.
    ok('nothing outscored the authorized load, so there is nothing to name', !named,
      `KC ${kcT?.score?.toFixed?.(2)} vs Ottumwa ${ottT?.score?.toFixed?.(2)}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
