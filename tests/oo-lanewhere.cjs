/* Owner-Operator 0.92: asking for where the next load goes, on a lane's call, and the cargo deciding the trade.
 *
 *   - on a lane's call, "out of Kansas" goes on the lane, for the pickup
 *   - at the pickup, the jobs that leave the state are marked and come first
 *   - none does: the driver is told, and may still take one that stays
 *   - soybean oil in a tanker is the farm's freight, not fuel; diesel is fuel; water is anyone's
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5997}/api`;
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
// A city in each region, outside Kansas, for a job that leaves the state.
const AWAY = { 'Plains & Southwest': ['Tulsa', 'OK'], Midwest: ['Des Moines', 'IA'], South: ['Little Rock', 'AR'], West: ['Phoenix', 'AZ'],
  Northwest: ['Boise', 'ID'], Northeast: ['Pittsburgh', 'PA'] };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'W. Here', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });

  head('1. The trade a cargo names');
  let r = await api('/board/add-many', 'POST', [
    { cargo: 'Soybean Oil', trailerType: 'Tanker', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Diesel', trailerType: 'Tanker', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Water', trailerType: 'Tanker', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
  ]);
  const trade = (cargo) => r.snapshot.board.find((v) => v.load.cargo === cargo)?.trade;
  ok('soybean oil in a tanker is the farm\'s', trade('Soybean Oil') === 'Agriculture', trade('Soybean Oil'));
  ok('diesel is fuel', trade('Diesel') === 'Fuel and petroleum', trade('Diesel'));
  ok('water is anyone\'s', trade('Water') === 'General', trade('Water'));
  for (const v of r.snapshot.board) await api(`/board/${v.load.id}`, 'DELETE');

  head('2. On the lane\'s call: out of the state');
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  S = (await api('/bootstrap'));
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 3, time: '07:00' });
  S = (await api('/run/loaded', 'POST', { day: 3, time: '07:40', odometer: 5000 })).snapshot;
  ok('a broker rings with a lane', S.call && S.call.lane, JSON.stringify(S.call && S.call.status));
  r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: CLOCKS });
  const pickupState = r.call.lane.pickupState;
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'where', where: 'out' });
  ok('the broker takes it on, for the pickup, and says it may not be there', /out of/i.test(r.call.turns.at(-1).text)
    && /whatever fits|any load that fits/.test(r.call.turns.at(-1).text), r.call.turns.at(-1).text);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  ok('the lane carries it', S.lane && S.lane.avoidState === pickupState && /^out of /.test(S.lane.want), JSON.stringify(S.lane && { a: S.lane.avoidState, w: S.lane.want }));

  head('3. At the pickup: a job that leaves, and one that stays');
  await api('/deliver', 'POST', { day: 3, time: '10:00', odometer: 5070 });
  S = await api('/status', 'POST', { locationCity: S.lane.pickupCity, locationState: S.lane.pickupState, day: 3, time: '18:00' });
  const mid = Math.round((S.lane.minMiles + S.lane.maxMiles) / 2);
  const [awayCity, awayState] = AWAY[S.lane.destRegion];
  const staysFits = S.lane.destRegion === 'Plains & Southwest' && pickupState === 'KS';
  r = await api('/board/add-many', 'POST', [
    { cargo: 'Stays', destCity: 'Wichita', destState: 'KS', loadedMiles: mid, gameRevenue: 1100, deadlineHours: 40 },
    { cargo: 'Leaves', destCity: awayCity, destState: awayState, loadedMiles: mid, gameRevenue: 1100, deadlineHours: 40 },
  ]);
  S = r.snapshot;
  const id = (cargo) => S.board.find((v) => v.load.cargo === cargo).load.id;
  ok('the job that leaves fits, and comes first', S.laneFits[0] === id('Leaves'), JSON.stringify(S.laneFits));
  ok('it is the one marked as asked', S.laneWant && S.laneWant.ids.includes(id('Leaves')) && !S.laneWant.ids.includes(id('Stays')),
    JSON.stringify(S.laneWant));
  if (staysFits) ok('the one that stays still fits the lane', S.laneFits.includes(id('Stays')));

  head('4. None leaves: say so, and let them run one anyway');
  await api(`/board/${id('Leaves')}`, 'DELETE');
  S = await api('/bootstrap');
  if (staysFits) {
    ok('told plainly', S.laneWant && S.laneWant.none && /nothing that fits/.test(S.laneWant.said), JSON.stringify(S.laneWant));
    r = await api('/lane/take', 'POST', { loadId: id('Stays') });
    ok('and it can still be taken', r.booking && r.booking.load.destState === 'KS', r.booking && r.booking.load.destCity);
  } else ok('(the lane leaned out of the home region: nothing stays to take)', true, S.lane.destRegion);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
