/* Owner-Operator 0.91: a lane takes the job at the dock first.
 *
 * Asked for from play: "ideally if we were taking a lane the job would come from where we dropped off, if we didn't have
 * to take a reset". Decided 2026-10-21, as the company-driver app does it: the broker texts, in the lane panel, for what is
 * going out of the dock you dropped at; a job there counts for the lane with the miles band loosened 30% either way and can
 * be picked up now; if nothing there fits, the broker asks for the whole city. Only where the clocks go straight on.
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
const CLOCKS = { driveRemaining: 9, shiftRemaining: 11, breakRemaining: 6, cycleRemaining: 55 };

/** A career with a load to Topeka on the truck and a lane booked out of Topeka. */
async function laneBooked() {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'D. Ock', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30, receiver: 'Bolt Supply' }]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 3, time: '07:00' });
  r = await api('/run/loaded', 'POST', { day: 3, time: '07:40', odometer: 5001 });
  S = r.snapshot;
  if (!S.call || !S.call.lane) return null;
  r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: CLOCKS });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  return r.snapshot;
}

(async () => {
  head('1. Dropped in the pickup city, clocks to go on');
  let S = await laneBooked();
  ok('a lane booked out of Topeka', S && S.lane && S.lane.pickupCity === 'Topeka', JSON.stringify(S && S.lane && S.lane.pickupCity));
  const lane = S.lane;
  const was = lane.pickupFromGameTime;
  let r = await api('/deliver', 'POST', { day: 3, time: '10:00', odometer: 5071, drive: 9, shift: 11, break: 6, cycle: 55 });
  S = r.snapshot;
  ok('the broker asks for the dock\'s jobs', S.lane.stage === 'dock' && S.lane.dockName === 'Bolt Supply', JSON.stringify({ stage: S.lane.stage, dock: S.lane.dockName }));
  ok('and the pickup can be now', S.lane.pickupFromGameTime <= S.status.gameTime && S.lane.pickupFromGameTime <= was, `${was} -> ${S.lane.pickupFromGameTime}`);
  ok('the band loosened 30% for the dock', S.lane.dockMinMiles === Math.round(lane.minMiles * 0.7) && S.lane.dockMaxMiles === Math.round(lane.maxMiles * 1.3), `${S.lane.dockMinMiles}-${S.lane.dockMaxMiles}`);

  head('2. Nothing at the dock fits: the broker asks for the city');
  r = await api('/board/add-many', 'POST', [{ cargo: 'WrongWay', destCity: 'Des Moines', destState: 'IA', loadedMiles: Math.round((lane.minMiles + lane.maxMiles) / 2),
    gameRevenue: 1100, deadlineHours: 40, atLocation: true }]);
  S = r.snapshot;
  ok('marked as at this dock', S.board.every((v) => v.load.atLocation), JSON.stringify(S.board.map((v) => v.load.atLocation)));
  ok('nothing put up yet, not even the closest', S.laneFits.length === 0 && S.laneAskCity === true, JSON.stringify({ fits: S.laneFits, ask: S.laneAskCity }));
  ok('and says so', /Nothing at Bolt Supply/.test(S.laneWhy || ''), S.laneWhy);

  head('3. The city board, and a dock job just outside the band');
  r = await api('/board/add-many', 'POST', [{ cargo: 'AcrossTown', destCity: 'Tulsa', destState: 'OK', loadedMiles: Math.round((lane.minMiles + lane.maxMiles) / 2),
    gameRevenue: 1100, deadlineHours: 40 }]);
  r = await api('/board/add-many', 'POST', [{ cargo: 'RightHere', destCity: 'Tulsa', destState: 'OK', loadedMiles: Math.round(lane.maxMiles * 1.2),
    gameRevenue: 1200, deadlineHours: 40, atLocation: true }]);
  S = r.snapshot;
  const marked = S.laneFits.map((id) => S.board.find((v) => v.load.id === id)?.load.cargo);
  ok('the dock job counts, outside the band, and comes first', marked[0] === 'RightHere' && marked.includes('AcrossTown') && !S.laneClose, marked.join(','));
  ok('the broker no longer asks for the city', S.laneAskCity === false);
  const job = S.board.find((v) => v.load.cargo === 'RightHere');
  r = await api('/lane/take', 'POST', { loadId: job.load.id });
  ok('taken for the lane, at the lane rate on its miles', r.booking.load.cargo === 'RightHere'
    && Math.abs(r.booking.rate - Math.min(job.load.gameRevenue, Math.round(lane.ratePerMile * job.load.loadedMiles * 100) / 100)) < 0.01, String(r.booking.rate));

  head('4. A reset first: no dock ask');
  await api('/reset', 'POST', { confirm: 'RESET' });
  S = await laneBooked();
  if (!S) ok('lane booked', false);
  else {
    r = await api('/deliver', 'POST', { day: 3, time: '10:00', odometer: 5071, drive: 1, shift: 2, break: 1, cycle: 55 });
    ok('out of hours: straight to the city board', r.snapshot.lane && r.snapshot.lane.stage === '', JSON.stringify(r.snapshot.lane && r.snapshot.lane.stage));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
