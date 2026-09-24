/* Turning a load down, and asking for a different one.
 *
 *   "I get one 'refuse load' but don't see where/how to tell the dispatch I am refusing a load, go to
 *    next one."
 *
 *   "There is also some feature where I can choose another load. I think we can keep this BUT we need
 *    to have it reject that request the more a player uses it. Keep using it and dispatch gets 'mad'
 *    and refuses the request. Make that somewhat random too so first requests can be rejected too."
 *
 * THE MISSING BUTTON. Two tables disagreed about the same driver. Rejections gave a company driver one
 * refusal a week and the Career tab printed it; CareerService.PrivilegesFor left CanRefuseLoad false at
 * that rank, and MayPass read the flag rather than the allowance. So the refusal was advertised on one
 * screen and the button for it existed on no screen at all.
 *
 * And the pass was FREE, which was the worse half. A passed-over load picks up a hard fail, so it drops
 * out of LoadsSkippedToReach, so the load behind it reads as dispatch's own pick and costs nothing to
 * take. Pass the top load for nothing, take the second for nothing, and the weekly ration never came
 * into it — a senior driver could walk the whole board that way.
 *
 * THE ASK. request-alternate logged the request, replied "operations decides", and then nothing
 * decided anything: it told the driver to go and raise it with dispatch, which is the app telling
 * somebody to go and ask the app. Now operations answers, and it answers worse the more it is asked —
 * a mood rather than a quota, with goodwill coming back on its own while the driver leaves it alone.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5896}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

/** Puts the driver on a rank without going through the ladder. */
async function atRank(rank, day = 30) {
  const st = await api('/export');
  st.driver.rank = rank;
  st.driver.probation = { ...st.driver.probation, active: false };
  st.status.gameTime = iso(day);
  st.driver.lastHomeGameTime = iso(day - 3);
  st.driver.atHomeYard = false;
  st.loadRefusals = [];
  st.alternateAsks = [];
  await api('/import', 'POST', st);
}

/** A board of plain, feasible, far-from-expiry loads out of the driver's own city. */
async function board(n = 4) {
  await api('/board/clear', 'POST', {});
  const st = await api('/export');
  const type = (st.trailers.find((t) => t.unit === st.driver.assignedTrailerUnit) || {}).type
               || st.trailers[0].type;
  const towns = [['Tulsa', 'OK', 180], ['Joplin', 'MO', 72], ['Wichita', 'KS', 230],
                 ['Fayetteville', 'AR', 130]];
  let last;
  for (let i = 0; i < n; i++) {
    const [city, state, miles] = towns[i % towns.length];
    last = await api('/board/add', 'POST', {
      cargo: `Palletised goods ${i + 1}`, trailerType: type, atLocation: true,
      originCity: st.status.locationCity, originState: st.status.locationState,
      destCity: city, destState: state, loadedMiles: miles + i, deadheadMiles: 0,
      // Descending revenue, so the ordering the engine settles on is stable and the "top" load is the
      // one a reader of this suite would expect it to be.
      gameRevenue: 1600 - i * 120, deadlineHours: 40, weightLbs: 30000,
    });
  }
  return last;
}

const evals = (d) => (d.evaluations || []);
const topTwo = (d) => evals(d).filter((e) => !e.hardFails.length && !e.homeTimeFails.length);

(async () => {
  const app = { driverName: 'D. Ferreira', preferredDivision: 'Reefer', experienceYears: 5,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' });

  await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(30),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 250000,
  });

  head('1. A company driver can see the refusal they are told they have');
  // The reported bug, exactly: the Career tab says one a week, and the board offered no way to use it.
  await atRank('company');
  await board();
  let d = un(await api('/board/evaluate', 'POST'));
  let list = topTwo(d);
  ok('the board came back with loads to judge', list.length >= 2, `${list.length} takeable`);
  ok('the top load can be turned down', list[0].mayPass === true, String(list[0].mayPass));
  ok('and the app says what it will cost', /refusal\(s\) left/i.test(list[0].passNote || ''),
    list[0].passNote);
  ok('it is not being given away as a free expiry pass', list[0].passIsFree === false,
    String(list[0].passIsFree));

  head('2. Turning it down spends the allowance');
  // The exploit: this used to cost nothing, so the ration was decorative.
  let before = (await api('/export')).loadRefusals.length;
  d = await api('/board/' + list[0].load.id + '/pass', 'POST', { reason: 'Rate is poor for the lane.' });
  let st = await api('/export');
  ok('the refusal is on the record', st.loadRefusals.length === before + 1,
    `${st.loadRefusals.length} refusal(s) filed`);
  ok('and it counted against the week', st.loadRefusals[0].free === false,
    `free=${st.loadRefusals[0].free}`);
  ok('the reason went on with it', /rate is poor/i.test(st.loadRefusals[0].reason || ''),
    st.loadRefusals[0].reason);

  head('3. And that was the only one this week');
  list = topTwo(d);
  ok('the next load can no longer be turned down', list.length > 0 && list[0].mayPass === false,
    list.length ? String(list[0].mayPass) : 'no loads left to judge');
  ok('and it says why, rather than just hiding the button',
    /out of refusals/i.test(list[0]?.passNote || ''), list[0]?.passNote);

  const refused = await api('/board/' + list[0].load.id + '/pass', 'POST', { reason: 'again' })
    .catch((e) => ({ error: e.message }));
  ok('the endpoint refuses it too, not just the screen', /out of refusals/i.test(refused.error || ''),
    refused.error || 'it was allowed');

  head('4. A load about to expire is free, at every rank');
  // Arithmetic, not preference. A probationary driver gets this one too.
  await atRank('probationary');
  st = await api('/export');
  st.driver.rank = 'probationary';
  st.board = [];
  await api('/import', 'POST', st);
  await board(2);
  st = await api('/export');
  // Wind the listing down into the window where passing is free: under the hour the driver is asked
  // about, but over the half hour that hard-fails it outright. And off the at-the-door list, because a
  // load offered to somebody standing at the facility has no journey to lose the race on and is exempt
  // from the whole question — see BoardExpiry.AtTheDoor.
  st.board.forEach((b) => {
    b.atLocation = false;
    b.deadheadMiles = 15;
    b.listedAtGameTime = st.status.gameTime;
    b.expiresInHours = 0.8;
  });
  await api('/import', 'POST', st);
  d = un(await api('/board/evaluate', 'POST'));
  const expiring = evals(d)[0];
  ok('a probationary driver may still pass an expiring listing', expiring?.mayPass === true,
    String(expiring?.mayPass));
  ok('and it is marked free', expiring?.passIsFree === true, String(expiring?.passIsFree));
  if (expiring?.mayPass) {
    await api('/board/' + expiring.load.id + '/pass', 'POST', {});
    st = await api('/export');
    ok('a free pass does not count against the week', st.loadRefusals[0].free === true,
      `free=${st.loadRefusals[0].free}`);
  }

  head('5. Asking for a different load gets a real answer');
  await atRank('company', 40);
  st = await api('/export');
  st.board = [];
  await api('/import', 'POST', st);
  await board(4);
  d = un(await api('/board/evaluate', 'POST'));
  list = topTwo(d);
  const target = list[list.length - 1];

  const first = await api('/dispatch/request-alternate', 'POST',
    { loadId: target.load.id, reason: 'Better lane for my home time.' });
  ok('the answer is a decision, not a receipt', typeof first.granted === 'boolean',
    `granted=${first.granted}`);
  ok('and it says something a dispatcher would say', (first.message || '').length > 20,
    (first.message || '').slice(0, 90));
  ok('the odds on a first ask are real but not certain',
    first.chancePct > 0 && first.chancePct < 100, `${first.chancePct}% of a no`);
  // The quoted figure is the mood plus the reach. This ask is for the bottom of a four-load board, so
  // it carries the depth penalty for that position on top of the first-ask base of 20.
  ok('and it is the first-ask base plus what that reach costs',
    first.chancePct === 20 + Math.min(5 + (first.position - 2) * 10, 60),
    `#${first.position} at ${first.chancePct}%`);

  head('6. The same ask cannot be re-rolled by asking again about another load');
  // Seeded on the rung and the day rather than the load, so shopping the request around the board does
  // not buy a fresh coin flip — only a worse one, because asking is what operations counts.
  st = await api('/export');
  const askedOnce = st.alternateAsks.length;
  ok('the ask is on the record whichever way it went', askedOnce === 1, `${askedOnce} ask(s)`);

  head('7. Keep asking and dispatch runs out of patience');
  const odds = [first.alternates.refusalChancePct];
  for (let i = 1; i < 5; i++) {
    const r = await api('/dispatch/request-alternate', 'POST',
      { loadId: list[i % list.length].load.id, reason: `ask ${i + 1}` });
    odds.push(r.alternates.refusalChancePct);
  }
  ok('the odds of a no climb with every ask', odds[odds.length - 1] > odds[0], odds.join('% -> ') + '%');
  ok('and they stop short of certain', odds[odds.length - 1] <= 95, `${odds[odds.length - 1]}%`);

  const tired = await api('/dispatch/request-alternate', 'POST',
    { loadId: list[0].load.id, reason: 'one more' });
  ok('a driver deep in the hole is usually turned down', tired.granted === false,
    tired.message.slice(0, 80));

  head('8. Goodwill comes back while you leave it alone');
  const hot = (await api('/dispatch/request-alternate', 'POST',
    { loadId: list[0].load.id, reason: 'probe' })).alternates;
  st = await api('/export');
  st.status.gameTime = iso(60);      // a fortnight of not asking
  await api('/import', 'POST', st);
  const cooled = (await api('/bootstrap')).views?.alternates
    ?? { refusalChancePct: null };
  if (cooled.refusalChancePct === null) {
    // Not surfaced on the bootstrap view; ask the endpoint instead, which reports it either way.
    const probe = await api('/dispatch/request-alternate', 'POST',
      { loadId: list[0].load.id, reason: 'after a quiet fortnight' });
    ok('a fortnight of quiet puts the odds back down',
      probe.alternates.refusalChancePct < hot.refusalChancePct,
      `${hot.refusalChancePct}% -> ${probe.alternates.refusalChancePct}%`);
  } else {
    ok('a fortnight of quiet puts the odds back down',
      cooled.refusalChancePct < hot.refusalChancePct,
      `${hot.refusalChancePct}% -> ${cooled.refusalChancePct}%`);
  }

  head('9. Reaching further down the board costs more than nudging');
  // "They are ranked for a reason, as dispatch would really not want you to take a load 10 down on the
  // list!" Position one is dispatch's own pick; each rung below it adds to the odds of a no, so asking
  // for the load just underneath is a different request from asking for the sixth.
  await atRank('company', 80);
  st = await api('/export');
  st.board = [];
  await api('/import', 'POST', st);
  await board(4);
  d = un(await api('/board/evaluate', 'POST'));
  list = topTwo(d);
  ok('there is a ranked board to reach down', list.length >= 4, `${list.length} takeable`);

  // Each ask is measured on a clean slate, so the only thing differing between them is the depth.
  const oddsAt = [];
  for (let i = 1; i < list.length; i++) {
    await atRank('company', 80);
    const r = await api('/dispatch/request-alternate', 'POST',
      { loadId: list[i].load.id, reason: `reaching to ${i + 1}` });
    oddsAt.push({ pos: r.position, chance: r.chancePct });
  }
  ok('the app agrees with the board about where each load sits',
    oddsAt.every((x, i) => x.pos === i + 2), oddsAt.map((x) => x.pos).join(', '));
  ok('asking for the second costs least',
    oddsAt[0].chance < oddsAt[oddsAt.length - 1].chance,
    oddsAt.map((x) => `#${x.pos}=${x.chance}%`).join('  '));
  ok('and every rung down is worse than the one above it',
    oddsAt.every((x, i) => i === 0 || x.chance > oddsAt[i - 1].chance),
    oddsAt.map((x) => `${x.chance}%`).join(' < '));
  ok('a first ask for the second load is still usually fine', oddsAt[0].chance <= 30,
    `${oddsAt[0].chance}%`);

  head('10. A deep ask burns more goodwill than a shallow one');
  // The other half of "it should cost more": not just likelier to be refused, but more expensive to
  // have asked at all. Two careers, one ask each, and the deep one comes out hotter.
  await atRank('company', 80);
  await api('/dispatch/request-alternate', 'POST',
    { loadId: list[1].load.id, reason: 'nudge' });
  const shallow = (await api('/bootstrap')).views.alternates.heat;

  await atRank('company', 80);
  await api('/dispatch/request-alternate', 'POST',
    { loadId: list[list.length - 1].load.id, reason: 'reach' });
  const deep = (await api('/bootstrap')).views.alternates.heat;

  ok('one deep ask leaves operations more tired than one shallow ask', deep > shallow,
    `shallow ${shallow} vs deep ${deep}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
