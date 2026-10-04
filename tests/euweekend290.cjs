/* A Sunday with the week nearly done and nothing worth running (reported from play, v0.81): told to "see the
 * reset options list", which is the US restart and means nothing under EU rules. Weekly driving comes back at
 * Monday 00:00 and nothing else brings it back.
 *
 *   - the board says when the week comes back, and offers the weekly rest where the truck is
 *   - no "reset options" anywhere
 *   - taking it starts it on the spot, at the length dispatch sets: a reduced 24 into Monday here
 *   - a weekday with the week in hand says nothing of the sort
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

async function board(gameTime, weekLeft, sinceWeekly) {
  await api('/status', 'POST', { locationCity: 'Mostar', locationState: 'BA', locationKind: 'TruckStop', gameTime,
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: weekLeft, asOfGameTime: gameTime,
    euWeekDriven: 56 - weekLeft, euLastWeekDriven: 30, euHoursSinceWeeklyRest: sinceWeekly, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  // Freight not worth the truck: a long run for almost nothing.
  return api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Mostar', originState: 'BA',
    destCity: 'Sarajevo', destState: 'BA', loadedMiles: 80, deadheadMiles: 0, gameRevenue: 20, weightLbs: 30000, atLocation: false, deadlineHours: 30 });
}

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Sunday 01:00, 14:00 of the week left, nothing worth running');
  // Day 7 is a Sunday.
  let d = await board('2000-01-07T01:00', 14, 110);
  const notes = (d.dispatchNotes || []).join(' | ');
  ok('the board is turned down', d.rejectAll === true, d.headline);
  ok('it says when the week comes back', /Monday 00:00, 23:00 from now/.test(notes), notes.slice(0, 300));
  ok('and offers the weekly rest here', d.offerWeeklyRestHere === true && /take your weekly rest in Mostar/.test(notes), notes.slice(0, 400));
  ok('no "reset options" list', !/reset options/i.test(JSON.stringify(d)));

  head('2. Taking it: on the spot, a reduced 24 into Monday');
  const r = await api('/restart/take-here', 'POST', {});
  ok('started now, in Mostar', r.order.status === 'Arrived' && r.order.arrivedGameTime === '2000-01-07T01:00' && r.order.arrivedCity === 'Mostar',
    `${r.order.status} ${r.order.arrivedGameTime} ${r.order.arrivedCity}`);
  ok('24 hours, back on the road Monday 01:00', r.order.requiredHours === 24 && r.order.eligibleGameTime === '2000-01-08T01:00',
    `${r.order.requiredHours}h to ${r.order.eligibleGameTime}`);
  let refused = null;
  try { await api('/restart/take-here', 'POST', {}); } catch (e) { refused = e; }
  ok('a second one is refused while it runs', !!refused, refused?.message);
  const done = await api('/restart/complete', 'POST', { gameTime: '2000-01-08T01:00' });
  ok('and it completes at Monday 01:00', /complete/.test(done.message || ''), (done.message || '').slice(0, 160));

  head('3. A Wednesday with the week in hand: nothing of the sort');
  d = await board('2000-01-10T09:00', 40, 30);
  ok('no weekly rest offered', d.offerWeeklyRestHere !== true, (d.dispatchNotes || []).join(' | ').slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
