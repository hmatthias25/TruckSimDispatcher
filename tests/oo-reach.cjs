/* Owner-Operator 0.9: what is left of a run, planned from where the driver really is. Asked about from play: resting
 * halfway, clocks and position given to a broker; does it know what the clocks will be at the receiver?
 *
 *   - the miles left come off the odometer where one was read since pulling out, and otherwise from where the truck was
 *     reported, as a share of the run by the map; never the whole run again from halfway
 *   - a lane's pickup waits for a 10-hour reset where the run leaves too little drive or shift to start another load
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5994}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const hrs = (a, b) => (Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 3600000;
const lineHaul = (S) => (S.tripViews.fromHere?.timeline || []).filter((x) => x.kind === 'Drive').reduce((n, x) => n + (x.miles || 0), 0);
const FULL = { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 };

async function bookAndLoad(day, job, clocks) {
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day, time: '06:00' });
  await api('/hos', 'POST', clocks);
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [job]);
  const b = (await api('/bootstrap')).directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day, time: '06:10' });
  return (await api('/run/loaded', 'POST', { day, time: '06:30', odometer: 1000 })).snapshot;
}

(async () => {
  await api('/start', 'POST', { game: 'ATS', driverName: 'R. Each', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 3, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 1 });

  head('1. Halfway, from where you are');
  let S = await bookAndLoad(3, { cargo: 'Paper', destCity: 'Dallas', destState: 'TX', loadedMiles: 500, gameRevenue: 1900, deadlineHours: 40 }, FULL);
  const atStart = lineHaul(S);
  ok('pulling out: the whole run ahead', atStart > 450, `${atStart} mi`);
  // Resting in Tulsa, the clocks and the position reported, the odometer not.
  S = await api('/status', 'POST', { locationCity: 'Tulsa', locationState: 'OK', day: 3, time: '11:00' });
  S = await api('/hos', 'POST', { driveRemaining: 6.5, shiftRemaining: 9, breakRemaining: 8, cycleRemaining: 55 });
  const fromTulsa = lineHaul(S);
  ok('reported in Tulsa, no odometer: what is left by the map, not the whole run again', fromTulsa > 150 && fromTulsa < 330, `${fromTulsa} mi`);
  S = await api('/status', 'POST', { odometer: 1460 });
  ok('with the odometer: what is left by it', Math.abs(lineHaul(S) - 40) < 2, `${lineHaul(S)} mi`);
  await api('/booking/handback', 'POST', { why: 'test', gameLost: true });

  head('2. The day spent at empty: a reset before the pickup');
  // Seventy miles on an hour and a half of driving: at the receiver with minutes of drive left.
  S = await bookAndLoad(5, { cargo: 'Corn', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 390, deadlineHours: 30 },
    { ...FULL, driveRemaining: 1.5 });
  const tired = S.call && S.call.lane;
  ok('a broker rings', !!tired, JSON.stringify(S.call && S.call.status));
  if (tired) ok('and the pickup waits for a 10-hour reset', hrs(S.status.gameTime, tired.pickupFromGameTime) >= 10,
    `${S.status.gameTime} -> ${tired.pickupFromGameTime}`);
  // Answered on a fresh day's clocks, the reset goes and the pickup comes forward.
  let r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: FULL });
  ok('answered with a fresh day: no reset, the pickup soon after empty', hrs(r.snapshot.status.gameTime, r.snapshot.call.lane.pickupFromGameTime) < 6,
    `${r.call.turns.at(-1).text}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
