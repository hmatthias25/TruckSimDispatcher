/* Owner-Operator 0.9: a lane with nothing on the board in its band.
 *
 * Reported from play: a lane of 150-250 mi out of Lawton, a board whose shortest job was 273, no job marked, and nothing
 * to press but Nothing fits. Calling the lane's broker got a different load at a starter's rate. Now the broker puts up
 * the closest jobs at the lane rate, the lane says why nothing fit exactly, and the lane's broker talks about the lane.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5995}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const CLOCKS = { driveRemaining: 9, shiftRemaining: 11, breakRemaining: 6, cycleRemaining: 55 };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'L. Awton', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });

  head('1. A lane booked on the way in');
  await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
  ]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 3, time: '07:00' });
  r = await api('/run/loaded', 'POST', { day: 3, time: '07:40', odometer: r.snapshot.status.odometer });
  S = r.snapshot;
  ok('a broker rings with a lane', S.call && S.call.lane, JSON.stringify(S.call && S.call.status));
  r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: CLOCKS });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  const lane = S.lane;
  ok('booked', lane && lane.status === 'Booked', JSON.stringify(lane && { band: `${lane.minMiles}-${lane.maxMiles}`, region: lane.destRegion }));

  head('2. At the pickup, the board has nothing in the band');
  r = await api('/deliver', 'POST', { day: 3, time: '10:00', odometer: S.status.odometer + 70 });
  S = await api('/status', 'POST', { locationCity: lane.pickupCity, locationState: lane.pickupState, day: 3, time: '18:00' });
  r = await api('/board/add-many', 'POST', [
    { cargo: 'Longer', destCity: 'Tulsa', destState: 'OK', loadedMiles: Math.min(400, lane.maxMiles + 70), gameRevenue: 1200, deadlineHours: 40 },
    { cargo: 'Long', destCity: 'Tulsa', destState: 'OK', loadedMiles: lane.maxMiles + 20, gameRevenue: 1100, deadlineHours: 40 },
    { cargo: 'WrongWay', destCity: 'Des Moines', destState: 'IA', loadedMiles: Math.round((lane.minMiles + lane.maxMiles) / 2), gameRevenue: 1100, deadlineHours: 40 },
    { cargo: 'TooFar', destCity: 'Tulsa', destState: 'OK', loadedMiles: 900, gameRevenue: 2400, deadlineHours: 40 },
  ]);
  S = r.snapshot;
  const marked = S.laneFits.map((id) => S.board.find((v) => v.load.id === id)?.load.cargo);
  ok('the broker puts up the closest instead', S.laneClose === true && marked.length === 3, marked.join(','));
  ok('into the region first, nearest the band first', marked[0] === 'Long' && marked[1] === 'Longer' && marked[2] === 'WrongWay', marked.join(','));
  ok('never a job past your skills', !marked.includes('TooFar'));
  ok('and says why nothing fit exactly', /runs .* mi into the/.test(S.laneWhy || ''), S.laneWhy);

  head('3. Calling the lane\'s broker');
  const laneBroker = S.directory.find((b) => b.name === lane.brokerName);
  r = await api('/calls', 'POST', { brokerId: laneBroker.id });
  const said = r.call.turns.at(-1).text;
  ok('talks about the lane, not another load', /closest/.test(said) && /Long to Tulsa/.test(said) && r.call.status === 'Nothing', said);
  ok('at the lane rate', said.includes(`$${lane.ratePerMile.toFixed(2)}/mi`), said);

  head('4. Taking the closest');
  const job = S.board.find((v) => v.load.cargo === 'Long');
  r = await api('/lane/take', 'POST', { loadId: job.load.id });
  const expect = Math.min(job.load.gameRevenue, Math.round(lane.ratePerMile * job.load.loadedMiles * 100) / 100);
  ok('booked at the lane rate on its own miles', Math.abs(r.booking.rate - expect) < 0.01, `${r.booking.rate} vs ${expect}`);
  ok('the lane is matched and the run opens', !r.snapshot.lane && r.snapshot.trip && r.snapshot.trip.number === r.booking.number);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
