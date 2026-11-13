/* Owner-Operator 0.92: money moved out is not spending, and leaving the dock you dropped at.
 *
 *   - a balance update takes money moved out (a minus), and counts none of it as spending
 *   - money moved out that an earlier reading counted as spending is taken back at the Monday check
 *   - a career from before: the same, put right on load
 *   - "I've left the dock", and leaving it by itself after a rest
 *   - a lane at the dock cannot be given up on until the whole city's board is in, and the broker says so
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5999}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };
const CLOCKS = { driveRemaining: 9, shiftRemaining: 11, breakRemaining: 6, cycleRemaining: 55 };
const otherSpent = (S) => S.finance.weeks.reduce((a, w) => a + (w.other || 0), 0);

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'M. Oved', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });

  head('1. A balance update with money moved out');
  let r = await api('/bank', 'POST', { balance: 20000 });
  r = await api('/bank', 'POST', { balance: 15000, movedIn: -5000 });
  ok('the $5,000 moved out is not spending', otherSpent(r.snapshot) === 0 && !/went out/.test(r.said), r.said);

  head('2. Counted as spending first, said at the Monday check');
  r = await api('/bank', 'POST', { balance: 5000 });
  ok('without the moved box, $10,000 counts as spending', Math.abs(otherSpent(r.snapshot) - 10000) < 1 && /went out/.test(r.said), r.said);
  S = await api('/status', 'POST', { day: 8, time: '08:00' });
  ok('the check is due', !!S.mondayCheck);
  r = await api('/finance/check', 'POST', { balance: S.mondayCheck.expected - 10000 + 10000, movedIn: -10000 });
  ok('the check takes it back off', /taken back off/.test(r.said), r.said);
  ok('so it is not spending any more', otherSpent(r.snapshot) < 1, `${otherSpent(r.snapshot)}`);
  ok('and the check is square', Math.abs(r.snapshot.finance.checks.at(-1).gap) < 1, `${r.snapshot.finance.checks.at(-1).gap}`);

  head('3. A career from before: put right on load');
  r = await api('/bank', 'POST', { balance: (await api('/bootstrap')).gameBank.estimate - 3000 });
  ok('$3,000 counted as spending', Math.abs(otherSpent(r.snapshot) - 3000) < 1, `${otherSpent(r.snapshot)}`);
  r = await api('/test/legacy-check', 'POST', { week: 15, reported: 1000, movedIn: -3000, gap: -3000 });
  ok('repaired', r.repaired === true);
  ok('the $3,000 taken back off', otherSpent(r.snapshot) < 1, `${otherSpent(r.snapshot)}`);

  head('4. Leaving the dock you dropped at');
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30, receiver: 'Bolt Supply' }]);
  S = await api('/bootstrap');
  if (S.call) await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 8, time: '09:00' });
  S = (await api('/run/loaded', 'POST', { day: 8, time: '09:30', odometer: 5000 })).snapshot;
  const laneCall = S.call && S.call.lane ? S.call : null;
  if (laneCall) {
    r = await api(`/calls/${laneCall.id}/answer`, 'POST', { clocks: CLOCKS });
    r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  }
  S = (await api('/deliver', 'POST', { day: 8, time: '11:00', odometer: 5070, drive: 9, shift: 11, break: 6, cycle: 55 })).snapshot;
  ok('at Bolt Supply\'s dock after the drop', S.status.atDock && S.status.dock === 'Bolt Supply', JSON.stringify({ at: S.status.atDock, dock: S.status.dock }));
  const dockLane = S.lane && S.lane.stage === 'dock' ? S.lane : null;
  if (dockLane) {
    r = await api('/board/add-many', 'POST', [{ cargo: 'WrongWay', destCity: 'Des Moines', destState: 'IA', loadedMiles: 40, gameRevenue: 300, deadlineHours: 40, atLocation: true }]);
    ok('nothing at the dock fits: the broker asks for the city board, there and then', /Send me the whole Topeka board/.test(r.said || ''), r.said);
    ok('and no giving up on the lane until it is in', /whole Topeka board/.test(await refused(() => api('/lane/nothing-fits', 'POST'))));
  } else ok('(no lane at the dock this run: the guard is checked by oo-dockfirst\'s flow)', true);
  r = await api('/dock/leave', 'POST');
  ok('"I\'ve left the dock"', !r.snapshot.status.atDock && /Off Bolt Supply's dock/.test(r.said), r.said);
  if (dockLane) ok('and the lane asks for the city now', r.snapshot.lane.stage === '' && /whole Topeka board/.test(r.said), r.said);
  ok('not twice', /Not at a receiver's dock/.test(await refused(() => api('/dock/leave', 'POST'))));

  head('5. Leaving by itself, after a rest');
  // Back on a dock: deliver again, then a 10 with nothing reported in between.
  if (dockLane) { const fits = (await api('/bootstrap')).lane; if (fits) await api('/lane/cancel', 'POST', { why: 'test' }).catch(() => {}); }
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [{ cargo: 'Corn', destCity: 'Wichita', destState: 'KS', loadedMiles: 140, gameRevenue: 500, deadlineHours: 30, receiver: 'Grain Co' }]);
  S = await api('/bootstrap');
  if (S.call) await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  const s2 = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  r = await api('/calls', 'POST', { brokerId: s2.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 8, time: '12:00' });
  S = (await api('/run/loaded', 'POST', { day: 8, time: '12:30', odometer: 5070 })).snapshot;
  if (S.call) await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  S = (await api('/deliver', 'POST', { day: 8, time: '16:00', odometer: 5210 })).snapshot;
  ok('on Grain Co\'s dock', S.status.atDock, S.status.dock);
  S = await api('/status', 'POST', { day: 9, time: '02:30' });
  ok('a 10 later, off it', !S.status.atDock, JSON.stringify({ at: S.status.atDock }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
