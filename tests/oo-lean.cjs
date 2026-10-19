/* Owner-Operator 0.9: lanes lean toward where the freight is. Asked for from play.
 *
 *   - April, with a reefer of your own: a run into the Midwest (produce ordinary there) gets a lane into a region where
 *     produce is busy and in reach of the lane's band, and the broker says why
 *   - January, nothing busy for produce anywhere: the lane stays in the run's own region
 *   - what the boards teach about the game's roads against the map is kept
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5986}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

async function ringOn(day) {
  await api('/test/home', 'POST', { score: 100 });
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day, time: '06:00' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [{ cargo: 'Lettuce', destCity: 'Des Moines', destState: 'IA', loadedMiles: 195, gameRevenue: 800, deadlineHours: 30, trailerType: 'Reefer' }]);
  const b = (await api('/bootstrap')).directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day, time: '06:10' });
  const S = (await api('/run/loaded', 'POST', { day, time: '06:30', odometer: 1000 })).snapshot;
  return S;
}

(async () => {
  await api('/start', 'POST', { game: 'ATS', driverName: 'L. Ean', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal', startMonth: 1 });
  await api('/trailer', 'POST', { type: 'Reefer', gameId: 'R1', year: 2015 });
  // Brokers who work the Midwest join the directory once it has been reached: been to Des Moines, and back.
  await api('/status', 'POST', { locationCity: 'Des Moines', locationState: 'IA', day: 2, time: '06:00' });
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 3, time: '06:00' });

  head('1. January: nowhere busy for produce');
  let S = await ringOn(5);
  let lane = S.call && S.call.lane;
  ok('a broker rings', !!lane, JSON.stringify(S.call && S.call.status));
  if (lane) ok('the lane stays in the run\'s own region', lane.destRegion === 'Midwest' && !lane.leanedFor, JSON.stringify({ r: lane.destRegion, why: lane.leanedFor }));
  await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  await api('/booking/handback', 'POST', { why: 'test', gameLost: true });

  head('2. April: produce busy in the Plains and the South');
  S = await ringOn(100);
  lane = S.call && S.call.lane;
  ok('a broker rings', !!lane, JSON.stringify(S.call && S.call.status));
  if (lane) {
    ok('the lane leans into a busy region for produce', ['Plains & Southwest', 'South'].includes(lane.destRegion) && /produce/.test(lane.leanedFor),
      JSON.stringify({ r: lane.destRegion, why: lane.leanedFor }));
    ok('and the broker says why', /running out of there right now/.test(S.call.turns[0].text), S.call.turns[0].text);
  }

  head('3. The game\'s roads against the map, learned from the boards');
  const raw = await api('/test/career');
  ok('every board job with a known origin and destination is a measured pair', raw.paySeen.mapRatioCount >= 2, JSON.stringify(raw.paySeen));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
