/* Owner-Operator 0.9: roads learned off the odometer, only from readings the driver gave.
 *
 * Reported from play: Austin to Beaumont planned at 333 mi when the game lists it under 200.
 *   - pulling out with no odometer typed measures nothing: the leg is not learned from a stale reading
 *   - a true game reading shorter than the real-world straight line (the game's map is compressed) is kept
 *   - and the next job on that road plans at the listing
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5998}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const learned = (S) => (S.events || []).filter((e) => /on the odometer/.test(e.message)).map((e) => e.message);

async function haul(day, loadedOdo, endOdo) {
  await api('/status', 'POST', { locationCity: 'Austin', locationState: 'TX', day, time: '06:00' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Beaumont', destState: 'TX', loadedMiles: 190, gameRevenue: 900, deadlineHours: 30 }]);
  const S = await api('/bootstrap');
  const b = S.directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day, time: '06:30' });
  await api('/run/loaded', 'POST', { day, time: '07:00', odometer: loadedOdo });
  await api('/run/arrived', 'POST', { day, time: '11:00' });
  r = await api('/deliver', 'POST', { day, time: '11:30', odometer: endOdo });
  return r.snapshot;
}

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'R. Oad', homeCity: 'Austin', homeState: 'TX', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 1 });

  head('1. Pulled out with no odometer typed');
  // The last reading on file is 1,000; the truck has since driven 143 mi to the shipper and 190 loaded, so a leg measured
  // from the stale reading would be 333.
  S = await haul(3, null, 1333);
  ok('nothing learned from it', learned(S).length === 0, JSON.stringify(learned(S)));

  head('2. A true reading, shorter than the straight line');
  S = await haul(5, 2000, 2190);
  ok('kept: 190 mi on the odometer', learned(S).some((m) => /Austin, TX → Beaumont, TX: 190 mi/.test(m)), JSON.stringify(learned(S)));

  head('3. The next job on that road');
  await api('/status', 'POST', { locationCity: 'Austin', locationState: 'TX', day: 7, time: '06:00' });
  await api('/board/clear', 'POST');
  const r = await api('/board/add-many', 'POST', [{ cargo: 'Corn', destCity: 'Beaumont', destState: 'TX', loadedMiles: 190, gameRevenue: 900, deadlineHours: 30 }]);
  const v = r.snapshot.board[0];
  ok('planned at the listing, 190', Math.abs(v.miles - 190) < 1, `${v.miles}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
