/* Issue #101 — overdue for home time, and dispatch sent him 500 miles the other way.
 *
 * Reported from play. Two and a half days past a home time he was promised, standing in Tulsa 200 miles
 * from the Springfield yard, and the board handed back a load 500 miles into Texas. It was authorized.
 *
 * Three things were wrong and they compounded:
 *
 *   1. Running the wrong way was a PENALTY, capped at the same value however far wrong it went. Sixty
 *      miles and seven hundred miles scored identically, so the rate decided.
 *   2. Nothing scaled with distance, in the score or as a ceiling.
 *   3. The home area was a fixed 200 miles whatever the arrangement was doing, so a driver two and a
 *      half days late and practically home read as "still out" and the search carried on.
 *
 * The fix separates arguing from refusing. The scorer still argues, and now argues harder the further
 * wrong the load goes. On top of it sits a ceiling: dispatch will not CHOOSE a load past it. The driver
 * still can — they can see their own game — and it is recorded as their call.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5971}/api`;
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
async function place(city, state, day, hm = '07:00') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 92, atsOdometer: 20000 + day * 55, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  return S;
}

/* The board comes back with every add, so the last one carries the whole decision. */
async function board(rows) {
  await api('/board/clear', 'POST', {});
  let last;
  for (const [city, st, mi, revenue] of rows) {
    last = await api('/board/add', 'POST', {
      cargo: `To ${city}`, trailerType: S.trailers[0].type, atLocation: false,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: city, destState: st, loadedMiles: mi, deadheadMiles: 0,
      gameRevenue: revenue, deadlineHours: Math.max(40, mi / 9), weightLbs: 34000,
    });
  }
  return last;
}

const byCity = (bd, city) => (bd.evaluations || []).find((e) => e.load.destCity === city) || {};
const refusal = (e) => (e.homeTimeFails || []).join(' ');
const miles = async (a, b, c, d) =>
  (await api(`/geo/distance?cityA=${encodeURIComponent(a)}&stateA=${b}&cityB=${encodeURIComponent(c)}&stateB=${d}`))?.miles;

(async () => {
  const app = { driverName: 'O. Verdue', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  const tulsaHome = await miles('Tulsa', 'OK', 'Springfield', 'MO');
  console.log(`     home yard Springfield, MO · Tulsa is ${Math.round(tulsaHome)} mi from it`);

  head('1. Well inside the arrangement, there is no ceiling at all');
  // A driver with most of their fortnight left goes where the freight is. That is the point of having
  // a date on the arrangement rather than a permanent leash.
  await place('Tulsa', 'OK', 3);
  let hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is nowhere near', hs.dueSoon === false, `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);
  ok('so no outbound ceiling is set', hs.outboundAllowance === null || hs.outboundAllowance === undefined,
    `${hs.outboundAllowance}`);
  let bd = await board([['El Paso', 'TX', 780, 2500]]);
  ok('a long run the wrong way is authorized', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('with nothing refused on home time', refusal(byCity(bd, 'El Paso')) === '', refusal(byCity(bd, 'El Paso')));

  head('2. Getting close: further out is allowed, but not by a different week');
  for (let d = 6; d <= 12; d += 3) await place('Tulsa', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is due soon but not broken', hs.dueSoon === true && hs.overdue === false,
    `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);
  ok('a ceiling exists now', hs.outboundAllowance > 0, `${Math.round(hs.outboundAllowance)} mi`);

  bd = await board([['Amarillo', 'TX', 380, 1250]]);
  ok('a normal leg out is still taken', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');

  bd = await board([['El Paso', 'TX', 780, 3400]]);
  ok('but 700-odd miles the wrong way is refused however it pays',
    !bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('and the refusal says why', /further from Springfield/i.test(refusal(byCity(bd, 'El Paso'))),
    refusal(byCity(bd, 'El Paso')).slice(0, 130));
  ok('naming the tolerance rather than just saying no',
    /not by more than about \d+ mi/i.test(refusal(byCity(bd, 'El Paso'))), 'tolerance named');

  head('3. Once the company is actually late, the tolerance closes right down');
  for (let d = 15; d <= 17; d += 1) await place('Tulsa', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is overdue', hs.overdue === true,
    `${hs.daysOut?.toFixed?.(1)} days out on ${hs.intervalDays}`);
  ok('by about two and a half days, as reported', Math.abs(hs.daysLate - 2.5) < 1.0,
    `${hs.daysLate?.toFixed?.(1)} days late`);
  ok('the ceiling drops to the overdue tolerance', hs.outboundAllowance <= 150 && hs.outboundAllowance >= 40,
    `${hs.outboundAllowance} mi at ${hs.daysLate?.toFixed?.(1)} days late`);

  head('3b. And it keeps narrowing the longer we keep him out');
  // 150 mi of sideways room is fair on the day a date slips and indefensible a week later. The promise
  // does not get less broken with time, so the room to work laterally should not stay the same size.
  const curve = [];
  for (const d of [15, 17, 19, 21, 24, 28]) {
    await place('Tulsa', 'OK', d);
    const st2 = (await api('/bootstrap')).views.homeTime;
    curve.push({ late: +st2.daysLate.toFixed(1), mi: st2.outboundAllowance });
  }
  console.log('     ' + curve.map((c) => `${c.late}d:${c.mi}mi`).join('  '));
  ok('it never widens as the driver gets later',
    curve.every((c, i) => i === 0 || c.mi <= curve[i - 1].mi), curve.map((c) => c.mi).join(' → '));
  ok('and it is genuinely narrower a week in than on day one',
    curve[curve.length - 1].mi < curve[0].mi,
    `${curve[0].mi} mi at ${curve[0].late}d down to ${curve[curve.length - 1].mi} mi at ${curve[curve.length - 1].late}d`);
  ok('but it stops rather than reaching zero — the geography is rougher than that',
    curve.every((c) => c.mi >= 40), `floor ${Math.min(...curve.map((c) => c.mi))} mi`);

  head('3c. A load that was fine early is refused once we are late enough');
  // The same load, the same board, judged at two different depths of lateness.
  //
  // Judged from Denver rather than Tulsa: at a fortnight late the home area reaches 400 mi, and Tulsa is
  // inside it — which is #114's territory, a different rule with its own message. Denver is 800 mi out
  // and stays outside however late the driver gets, so what is being measured here is the narrowing.
  await place('Denver', 'CO', 15);                      // a day over
  let early = await board([['Albuquerque', 'NM', 460, 1400]]);
  const earlyRefused = !!refusal(byCity(early, 'Albuquerque'));
  await place('Denver', 'CO', 28);                      // a fortnight over
  let late = await board([['Albuquerque', 'NM', 460, 1400]]);
  const lateRefused = !!refusal(byCity(late, 'Albuquerque'));
  ok('taken a day late, refused a fortnight late', !earlyRefused && lateRefused,
    `day one ${earlyRefused ? 'refused' : 'taken'}, fortnight ${lateRefused ? 'refused' : 'taken'}`);
  if (lateRefused)
    ok('and the refusal says the room is still shrinking',
      /shrinks every day we keep you/i.test(refusal(byCity(late, 'Albuquerque'))),
      refusal(byCity(late, 'Albuquerque')).slice(-90));

  await place('Tulsa', 'OK', 17);                       // back to the reported case for what follows

  head('4. The reported case: Tulsa, overdue, and a load 500 mi into Texas');
  bd = await board([['Dallas', 'TX', 260, 900], ['Springfield', 'MO', 205, 640]]);
  const dallasOut = Math.round((await miles('Dallas', 'TX', 'Springfield', 'MO')) - tulsaHome);
  console.log(`     Dallas is ${dallasOut} mi further from the yard than Tulsa is`);
  ok('the Texas load is refused', !!refusal(byCity(bd, 'Dallas')), refusal(byCity(bd, 'Dallas')).slice(0, 120));
  ok('it names the days late rather than a rule number',
    /days late/i.test(refusal(byCity(bd, 'Dallas'))), 'named');
  ok('and the load home is the one taken',
    byCity(bd, 'Springfield').load?.id === bd.authorizedLoadId,
    (bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId)?.load?.destCity || 'none');

  head('5. A board with nothing but wrong-way loads is not a bad board');
  // It may be perfectly good freight. What it cannot do is end the thing the company is failing at, and
  // saying "reposition and pull a fresh board" to somebody whose answer is to drive home is useless.
  bd = await board([['Dallas', 'TX', 260, 900], ['Houston', 'TX', 480, 1600], ['San Antonio', 'TX', 470, 1550]]);
  ok('nothing is authorized', !bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('the board is rejected', bd.rejectAll === true, `rejectAll=${bd.rejectAll}`);
  ok('and the headline says what is actually wrong with it',
    /runs further from Springfield/i.test(bd.headline || ''), bd.headline);
  ok('it says how late, not just that it is late',
    /days late/i.test(bd.headline || ''), bd.headline);
  const notes = (bd.dispatchNotes || []).join(' ');
  ok('and it says where to go instead', /Springfield, MO is \d+ mi|check what is loading out of/i.test(notes),
    notes.slice(-180));

  head('6. Tulsa is 200 mi out — far enough away on paper, near enough once we are late');
  const cfg = (await api('/bootstrap')).settings;
  hs = (await api('/bootstrap')).views.homeTime;
  ok('the configured radius still says Tulsa is outside it',
    tulsaHome > cfg.scoring.homeRadiusMiles,
    `${Math.round(tulsaHome)} mi vs ${cfg.scoring.homeRadiusMiles} configured`);
  ok('but the effective one has widened past it', hs.homeRadius > tulsaHome,
    `${Math.round(hs.homeRadius)} mi at ${hs.daysLate?.toFixed?.(1)} days late`);
  ok('so the driver reads as home rather than still out', hs.atHome === true, `atHome=${hs.atHome}`);
  ok('and the headline tells them to bring it in',
    /bring it in to Springfield/i.test(hs.headline || ''), hs.headline?.slice(0, 120));

  head('7. The widening has a stop on it');
  // Past some distance "close enough to run in empty" is a day of unpaid driving, and calling that home
  // would be the app solving its own scoring problem with the driver's time.
  for (let d = 20; d <= 60; d += 8) await place('Tulsa', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('weeks late now', hs.daysLate > 30, `${hs.daysLate?.toFixed?.(0)} days late`);
  ok('and the radius has stopped at twice the setting',
    Math.abs(hs.homeRadius - cfg.scoring.homeRadiusMiles * 2) < 0.5,
    `${hs.homeRadius} mi against a ${cfg.scoring.homeRadiusMiles} setting`);

  head('8. The penalty scales with how far wrong, rather than being flat');
  // A flat penalty said sixty miles and seven hundred were the same mistake, which is how a good rate
  // outbid a broken promise.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app2 = { ...app, driverName: 'S. Cale' };
  await api('/onboarding/market', 'POST', app2);
  S = un(await api('/onboarding/hire', 'POST', { application: app2, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  // Judged in the due-soon window rather than once overdue, because the overdue tolerance is 150 miles
  // and two loads that both fit inside it cannot be far enough apart to show anything. With 500 to play
  // with, a short hop out and a long one are both permitted and the scores can be compared properly.
  for (const d of [5, 9, 12]) await place('Kansas City', 'MO', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('due soon, so both of these are allowed to be taken',
    hs.dueSoon === true && hs.overdue === false, `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);

  bd = await board([['Des Moines', 'IA', 200, 700], ['Amarillo', 'TX', 560, 1950]]);
  const line = (e) => ((e.scoreDetail || []).find((x) => /further from/i.test(x)) || '');
  const pts = (e) => parseFloat((line(e).match(/(-?\d+\.\d\d)$/) || [])[1] || '0');
  const near = pts(byCity(bd, 'Des Moines'));
  const far = pts(byCity(bd, 'Amarillo'));
  ok('both are scored as running further out', near < 0 && far < 0, `${near} vs ${far}`);
  ok('and the longer one is punished harder', far < near - 0.1,
    `Amarillo ${far} against Des Moines ${near}`);
  ok('neither is refused, so the score is what decided it',
    !refusal(byCity(bd, 'Des Moines')) && !refusal(byCity(bd, 'Amarillo')),
    refusal(byCity(bd, 'Amarillo')).slice(0, 80) || 'both permitted');

  head('9. #109 Disqualified means disqualified — there is no override');
  // From Denver, which stays outside the home area however late the driver runs — so the refusal here is
  // the outbound ceiling rather than #114's "you are already near the yard" rule.
  for (let d = 14; d <= 20; d += 3) await place('Denver', 'CO', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('overdue for this one', hs.overdue === true, `${hs.daysOut?.toFixed?.(1)} days out`);

  // It was briefly overridable: dispatch would not choose one, but the driver could authorize it
  // directly and it went on the trip as their call. Nobody asked for that middle ground — it existed
  // because disqualifying the load left the city-board hold with no backup to name, which is a problem
  // with the hold rather than with this. A load taking an overdue driver further out is off the table.
  // Salt Lake City is 1,232 mi from Springfield against Denver's 790 — 442 mi further out, well past any
  // tolerance. Amarillo used to play this part and cannot: from Denver it is 195 mi NEARER the yard.
  bd = await board([['Salt Lake City', 'UT', 520, 1900]]);
  const refused = byCity(bd, 'Salt Lake City');
  ok('dispatch will not pick it', !bd.authorizedLoadId && !!refusal(refused),
    refusal(refused).slice(0, 110));
  ok('it is marked Reject, not held as a backup', refused.recommendation === 'Reject',
    refused.recommendation);

  let denied = null;
  try { await api('/dispatch/authorize', 'POST', { loadId: refused.load.id }); }
  catch (e) { denied = e.message; }
  ok('and authorizing it directly is refused too', !!denied, denied?.slice(0, 90) || '(it went through)');
  ok('with the same reason rather than a different one',
    /FURTHER from Springfield/i.test(denied || ''), denied?.slice(0, 80) || '');
  const booked = (await api('/trips')) || [];
  ok('no trip was raised for it',
    !booked.some((x) => x.destCity === 'Salt Lake City' && x.status === 'Authorized'), 'nothing booked');

  head('9b. #113 The tight load home can actually be accepted');
  // Decide() authorizes a Tight load in one case: the company is overdue and this is the load that heads
  // to the yard. It says out loud that it is taking it and owning the call. Authorize then refused it
  // unless the caller passed an override, so the green Accept button errored — and the rank gate on top
  // told a company driver "this is not your call to make" about a load operations had picked for them.
  //
  // Found simulating the Los Angeles run home: dispatch chose the load and then would not book it.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app4 = { ...app, driverName: 'T. Ight' };
  await api('/onboarding/market', 'POST', app4);
  S = un(await api('/onboarding/hire', 'POST', { application: app4, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  for (const d of [6, 11, 16, 19]) await place('Tulsa', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('overdue, and standing away from the yard', hs.overdue === true && hs.atHome !== undefined,
    `${hs.daysLate?.toFixed?.(1)} days late`);

  // A load home whose window leaves less than the safety buffer. Deadline tuned to land it on Tight.
  let tight = null;
  for (const hrs of [7, 8, 9, 10, 11, 12, 13, 14]) {
    await api('/board/clear', 'POST', {});
    const one = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
      originCity: 'Tulsa', originState: 'OK', receiver: 'Springfield Distribution',
      destCity: 'Springfield', destState: 'MO', loadedMiles: 210, deadheadMiles: 0,
      gameRevenue: 700, deadlineHours: hrs, weightLbs: 34000,
    });
    const e0 = (one.evaluations || [])[0];
    if (e0?.feasibility?.verdict === 'Tight' && one.authorizedLoadId === e0.load.id) { tight = { one, e0 }; break; }
  }

  if (!tight) {
    ok('could not tune a Tight-but-heads-home load in this fixture — skipped', true, 'skipped');
  } else {
    ok('dispatch authorizes it despite the tight window',
      tight.one.authorizedLoadId === tight.e0.load.id, tight.e0.feasibility.verdict);
    ok('and says it is owning the call',
      /I am taking it and owning the call/i.test((tight.one.dispatchNotes || []).join(' ')), 'said');

    let err = null, trip = null;
    try {
      const r = await api('/dispatch/authorize', 'POST',
        { loadId: tight.e0.load.id, rationale: null, overrideTight: false });
      trip = r.trip;
    } catch (e) { err = e.message; }

    ok('accepting it works without any override', !err && !!trip?.number,
      err ? err.slice(0, 110) : trip.number);
    if (trip)
      ok('and the trip records that operations made the call, not the driver',
        /Operations made this call, not the driver/i.test(trip.notes || ''),
        (trip.notes || '').slice(0, 100) || '(no note)');
    if (trip) await api(`/trips/${trip.id}/cancel`, 'POST', { reason: 'fixture' });
  }

  head('9c. #114 Already near the yard and late: only freight that closes the distance');
  // Found in the Los Angeles simulation. The driver landed in Kansas City, 182 mi from Springfield and
  // overdue, and the app booked a load to Tulsa — 208 mi from Springfield, so 26 mi FURTHER out — and
  // told them it was "being run to get you home". It was 250 loaded miles to end up further away, with a
  // 182-mile deadhead sitting on the Dispatch tab the whole time.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app5 = { ...app, driverName: 'K. Cee' };
  await api('/onboarding/market', 'POST', app5);
  S = un(await api('/onboarding/hire', 'POST', { application: app5, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  for (const d of [8, 12, 16]) await place('Kansas City', 'MO', d);
  hs = (await api('/bootstrap')).views.homeTime;
  const kcOut = hs.milesFromHome;
  ok('standing inside the home area and late', hs.atHome === true && hs.overdue === true,
    `${Math.round(kcOut)} mi out, ${hs.daysLate?.toFixed?.(1)} days late`);

  bd = await board([['Tulsa', 'OK', 250, 800], ['Wichita', 'KS', 210, 700], ['Little Rock', 'AR', 400, 1300]]);
  ok('nothing lateral is taken', !bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('Tulsa is refused even though it is only 26 mi further out',
    !!refusal(byCity(bd, 'Tulsa')), refusal(byCity(bd, 'Tulsa')).slice(0, 110));
  ok('and the reason is that it gets him no nearer, not that it is far',
    /which is no nearer/i.test(refusal(byCity(bd, 'Tulsa'))), 'no nearer');
  ok('nothing is described as the ride home',
    !/being run to get you home/i.test((bd.dispatchNotes || []).join(' ')), 'not claimed');
  ok('the board says to run it in empty instead',
    /Run it in empty and take your home time/i.test((bd.dispatchNotes || []).join(' ')), 'said');

  head('9d. #114 But freight that DOES close the distance is still taken');
  // The rule is about direction, not about refusing to work. A paid load ending nearer the yard beats a
  // deadhead on every count, and it should still win.
  bd = await board([['Tulsa', 'OK', 250, 800], ['Joplin', 'MO', 170, 560]]);
  const took = (bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId);
  ok('the one that closes the distance is authorized', took?.load?.destCity === 'Joplin',
    took?.load?.destCity || 'none');
  ok('and it IS called the ride home, because this time it is',
    /being run to get you home|your ride home/i.test((bd.dispatchNotes || []).join(' ')), 'said');

  head('11. #115 The rules are measured against the promise, not in absolute days');
  // Every distance in the home-time file used to be an absolute tuned against a fortnight. So a weekly
  // driver seven days late — a driver who has blown their entire arrangement — got exactly the treatment
  // of a six-week driver seven days late, who has blown a sixth of it.
  const shape = {};
  for (const [key, interval] of [['weekly', 7], ['biweekly', 14], ['sixweeks', 42]]) {
    await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
    const a = { ...app, driverName: `S. ${key}`, homeTimePreference: key };
    await api('/onboarding/market', 'POST', a);
    S = un(await api('/onboarding/hire', 'POST', { application: a, force: true, gameTime: iso(1), code: 'PRI' }));
    await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

    // Three days late, whatever the arrangement.
    await place('Tulsa', 'OK', 1 + interval + 3);
    const h = (await api('/bootstrap')).views.homeTime;
    shape[key] = { late: h.daysLate, ceiling: h.outboundAllowance, radius: h.homeRadius };

    // And on the due-soon line, where the room to work outward should reflect the days left.
    await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
    await api('/onboarding/market', 'POST', a);
    S = un(await api('/onboarding/hire', 'POST', { application: a, force: true, gameTime: iso(1), code: 'PRI' }));
    await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
    // Well inside the due-soon window, not on its edge: at 0.78 a weekly driver lands just SHORT of
    // the 0.75 threshold once the day is rounded, and the ceiling comes back null.
    await place('Tulsa', 'OK', Math.round(1 + interval * 0.85));
    const d = (await api('/bootstrap')).views.homeTime;
    shape[key].left = d.daysUntilDue;
    shape[key].dueCeiling = d.outboundAllowance;
  }
  console.log(`     3 days late   weekly ${shape.weekly.ceiling}mi/${Math.round(shape.weekly.radius)}mi  ` +
              `biweekly ${shape.biweekly.ceiling}mi/${Math.round(shape.biweekly.radius)}mi  ` +
              `sixweeks ${shape.sixweeks.ceiling}mi/${Math.round(shape.sixweeks.radius)}mi`);

  ok('three days late is tighter for a weekly driver than a fortnightly one',
    shape.weekly.ceiling < shape.biweekly.ceiling,
    `${shape.weekly.ceiling} mi against ${shape.biweekly.ceiling} mi`);
  ok('and tighter again than for a six-week driver',
    shape.biweekly.ceiling < shape.sixweeks.ceiling,
    `${shape.biweekly.ceiling} mi against ${shape.sixweeks.ceiling} mi`);
  ok('the home area widens fastest for the driver furthest past their word',
    shape.weekly.radius > shape.biweekly.radius && shape.biweekly.radius > shape.sixweeks.radius,
    `${Math.round(shape.weekly.radius)} > ${Math.round(shape.biweekly.radius)} > ${Math.round(shape.sixweeks.radius)}`);

  console.log(`     on the due-soon line   weekly ${shape.weekly.dueCeiling}mi with ` +
              `${shape.weekly.left?.toFixed(1)}d left  ·  sixweeks ${shape.sixweeks.dueCeiling}mi with ` +
              `${shape.sixweeks.left?.toFixed(1)}d left`);
  ok('both are genuinely in the due-soon window, so the numbers are comparable',
    shape.weekly.dueCeiling > 0 && shape.sixweeks.dueCeiling > 0,
    `weekly ${shape.weekly.dueCeiling}, sixweeks ${shape.sixweeks.dueCeiling}`);
  ok('a weekly driver with a day left is not offered the same room as one with six',
    shape.weekly.dueCeiling > 0 && shape.weekly.dueCeiling < shape.sixweeks.dueCeiling,
    `${shape.weekly.dueCeiling} mi with ${shape.weekly.left?.toFixed(1)}d against ` +
    `${shape.sixweeks.dueCeiling} mi with ${shape.sixweeks.left?.toFixed(1)}d`);

  head('12. #116 It will offer to run you home further than one shift');
  // Found in the weekly journey: delivered in Houston, 615 mi from the yard, and the app offered a
  // 497-mile empty leg to a market instead — because the run home was gated on a single shift and 615 is
  // ten miles past one. The driver ran 713 empty miles to avoid one 615-mile run.
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app6 = { ...app, driverName: 'F. Aroff' };
  await api('/onboarding/market', 'POST', app6);
  S = un(await api('/onboarding/hire', 'POST', { application: app6, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  for (const d of [8, 12, 16]) await place('Houston', 'TX', d);

  const away = (await api('/bootstrap')).views.homeTime;
  const oneShift = 11 * 55;
  ok('Houston is further from the yard than a single shift', away.milesFromHome > oneShift,
    `${Math.round(away.milesFromHome)} mi against ${oneShift} mi of driving`);

  await board([['San Antonio', 'TX', 200, 620], ['El Paso', 'TX', 750, 2300]]);
  const runs = (await api('/bootstrap')).views.repositionOffers || [];
  const goHome = runs.find((o) => o.isHomeRun);
  ok('the run home is offered anyway', !!goHome,
    goHome ? `${Math.round(goHome.miles)} mi` : runs.map((o) => o.city).join(', ') || '(nothing offered)');
  if (goHome) {
    ok('and it says a rest is needed on the way rather than pretending otherwise',
      /take your .* on the way/i.test(goHome.reason), goHome.reason.slice(-100));
    ok('no empty leg to a market is offered that is not meaningfully shorter',
      runs.filter((o) => !o.isHomeRun).every((o) => o.miles < goHome.miles * 0.6),
      runs.filter((o) => !o.isHomeRun).map((o) => `${o.city} ${Math.round(o.miles)}mi`).join(', ') || 'none offered');
  }

  head('10. A driver on no arrangement is untouched by any of it');
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app3 = { ...app, driverName: 'N. Oarrangement', homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app3);
  S = un(await api('/onboarding/hire', 'POST', { application: app3, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  for (let d = 8; d <= 40; d += 8) await place('Tulsa', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('nothing is being tracked', hs.tracked === false, `tracked=${hs.tracked}`);
  ok('and no ceiling is imposed', !hs.outboundAllowance, `${hs.outboundAllowance}`);
  bd = await board([['El Paso', 'TX', 780, 2400]]);
  ok('so the long run the wrong way is theirs to take', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
