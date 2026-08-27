/* Issue #120: the ATS listing has a clock of its own, and dispatch was blind to it.
 *
 * The board always carried the DELIVERY deadline — how long the load has once it is yours. It never
 * carried how long the OFFER lasts, so a job with eleven hours to deliver and four minutes left on the
 * market was authorized, and the driver drove to a pickup that had gone.
 *
 * Three rules, tested here: at the dock it does not apply, under half an hour never reaches the board,
 * and in between the driver decides — including a probationary driver, which is the single exception to
 * freight selection being a privilege of rank.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5399}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 250));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

/** Whatever the call threw, or null if it did not throw. */
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

(async () => {
  const app = { driverName: 'Expiry Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;

  const at = (t) => `2000-01-01T${t}`;
  async function stand(time) {
    S = un(await api('/status', 'POST', {
      locationCity: 'Denver', locationState: 'CO', locationKind: 'Receiver',
      gameTime: at(time), fuelPct: 90, atsOdometer: 0,
      truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000,
    }));
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    return S;
  }

  /** A perfectly ordinary load, so the only thing under test is the listing clock. */
  const load = (over) => ({
    cargo: 'Machinery', trailerType: type, atLocation: false,
    originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 20, gameRevenue: 2300, deadlineHours: 48, weightLbs: 40000,
    ...over,
  });

  await stand('06:00');

  head('c. Half an hour or less never reaches the board');
  for (const [hours, why] of [[0.5, 'exactly the floor'], [0.25, 'well under it'], [0.1, 'six minutes']]) {
    await api('/board/clear', 'POST', {});
    const err = await refused(() => api('/board/add', 'POST', load({ expiresInHours: hours })));
    ok(`${why} is refused outright`, err !== null && /listing/i.test(err || ''), (err || 'ACCEPTED').slice(0, 70));
    const board = await api('/board/evaluate');
    ok(`  and it is not on the board afterwards`, (board.evaluations || []).length === 0,
      `${(board.evaluations || []).length} row(s)`);
  }

  head('a. At the dock the rule does not apply — you are standing at it');
  await api('/board/clear', 'POST', {});
  let dec = await api('/board/add', 'POST', load({
    atLocation: true, deadheadMiles: 0, expiresInHours: 0.1,
  }));
  ok('six minutes left is fine when the job is at this dock', !!dec.authorizedLoadId, dec.headline?.slice(0, 70));

  head('Plenty of time is simply an ordinary load');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', load({ expiresInHours: 6 }));
  let e = dec.evaluations[0];
  ok('authorized', !!dec.authorizedLoadId, dec.headline?.slice(0, 60));
  ok('the countdown is on the card', Math.abs(e.listingHoursLeft - 6) < 0.01, `${e.listingHoursLeft} h`);
  ok('and nothing is said about it', !e.cons.some((c) => /listing/i.test(c)), 'quiet');
  ok('no pass button for a probationary driver', e.mayPass === false, `mayPass=${e.mayPass}`);

  head('An unstated expiry plans exactly as it always did');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', load({}));
  e = dec.evaluations[0];
  ok('authorized', !!dec.authorizedLoadId, dec.headline?.slice(0, 60));
  ok('and there is no countdown to show', e.listingHoursLeft == null, `${e.listingHoursLeft}`);

  head('b. Between half an hour and an hour, the driver is asked');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', load({ expiresInHours: 0.75 }));
  e = dec.evaluations[0];
  ok('it is still on the board', !!e, 'present');
  ok('and still authorized — this is a question, not a refusal', !!dec.authorizedLoadId,
    dec.headline?.slice(0, 60));
  ok('dispatch says what is left', e.cons.some((c) => /listing/i.test(c)),
    (e.cons.find((c) => /listing/i.test(c)) || '(nothing)').slice(0, 80));
  ok('and says it cannot judge the road for you',
    e.cons.some((c) => /your call|where you are/i.test(c)), 'said');

  head('b. And a probationary driver may pass on it — the one exception');
  ok('the driver really is probationary', S.driver.rank === 'probationary' || !S.views.privileges?.canChooseAlternateLoad,
    `rank=${S.driver.rank}`);
  ok('the pass is offered anyway', e.mayPass === true, `mayPass=${e.mayPass}`);
  const passed = await api(`/board/${e.load.id}/pass`, 'POST', {});
  ok('and it is taken', (passed.evaluations || []).some((x) => x.load.id === e.load.id && x.load.passedOver),
    'passedOver');
  ok('dispatch will not then authorize it', passed.authorizedLoadId !== e.load.id,
    `${passed.authorizedLoadId}`);
  ok('the card says it was a decision, not a gap',
    passed.evaluations.find((x) => x.load.id === e.load.id)?.hardFails.some((h) => /passed on this one/i.test(h)),
    'named');

  head('b. Passing moves to the next load rather than emptying the board');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', load({ expiresInHours: 0.75, cargo: 'Tight One', gameRevenue: 2600 }));
  dec = await api('/board/add', 'POST', load({
    expiresInHours: 5, cargo: 'Roomy One', destCity: 'Salt Lake City', gameRevenue: 2400,
  }));
  const tight = dec.evaluations.find((x) => x.load.cargo === 'Tight One');
  ok('the better-paying tight one is the assignment first', dec.authorizedLoadId === tight.load.id,
    dec.evaluations.find((x) => x.load.id === dec.authorizedLoadId)?.load.cargo);
  const after = await api(`/board/${tight.load.id}/pass`, 'POST', {});
  const roomy = after.evaluations.find((x) => x.load.cargo === 'Roomy One');
  ok('after passing, the next one is assigned', after.authorizedLoadId === roomy.load.id,
    after.evaluations.find((x) => x.load.id === after.authorizedLoadId)?.load.cargo || 'none');

  head('Passing is not a way around freight selection');
  // The exception is narrow on purpose: it exists because a listing is evaporating, not because the
  // driver would rather have the other one.
  const err = await refused(() => api(`/board/${roomy.load.id}/pass`, 'POST', {}));
  ok('a load with five hours on it cannot be passed on probation', err !== null,
    (err || 'ALLOWED').slice(0, 80));
  ok('and it says why rather than just refusing', /freight selection/i.test(err || ''), 'explained');

  head('The countdown runs down with the game clock');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', load({ expiresInHours: 0.9 }));
  const id = dec.evaluations[0].load.id;
  ok('starts in the ask band', Math.abs(dec.evaluations[0].listingHoursLeft - 0.9) < 0.01,
    `${dec.evaluations[0].listingHoursLeft} h`);

  await stand('06:20');                                   // twenty minutes of game time gone
  let board = await api('/board/evaluate');
  let row = board.evaluations.find((x) => x.load.id === id);
  ok('twenty minutes later it reads twenty minutes shorter',
    Math.abs(row.listingHoursLeft - (0.9 - 1 / 3)) < 0.02, `${row.listingHoursLeft?.toFixed(3)} h`);

  await stand('06:40');                                   // now under the floor
  board = await api('/board/evaluate');
  row = board.evaluations.find((x) => x.load.id === id);
  ok('and once under the floor it is out of the running',
    row.hardFails.some((h) => /listing/i.test(h)), (row.hardFails[0] || '(none)').slice(0, 70));
  ok('rather than silently vanishing off the board', !!row, 'still shown');

  head('A ten-hour break empties every timed listing');
  await api('/board/clear', 'POST', {});
  await stand('06:00');
  await api('/board/add', 'POST', load({ expiresInHours: 3 }));
  await stand('18:00');
  board = await api('/board/evaluate');
  ok('a three-hour listing does not survive twelve hours',
    board.evaluations[0].listingHoursLeft === 0, `${board.evaluations[0].listingHoursLeft} h`);
  ok('and dispatch will not send anyone to it',
    board.authorizedLoadId !== board.evaluations[0].load.id, `${board.authorizedLoadId}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
