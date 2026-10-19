/* Owner-Operator 0.9: listings about to come off the board, and the dock you are already at. Asked for from play.
 *
 *   - a broker offering a listing with under 45 minutes left says so
 *   - "can't make it in time" costs nothing: no patience, no standing; the broker offers another job, or says there is none
 *   - "can't make it" on any job: no penalty, the job is off the table for every broker, and where the plan had the
 *     driver making it easily, the broker says to check where the app has them
 *   - a broker knows where you are: at the receiver you just delivered to, that company's job is offered first
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
const said = (r) => r.call.turns.at(-1).text;
const job = (cargo, dest, st, miles, pay, extra = {}) => ({ cargo, destCity: dest, destState: st, loadedMiles: miles, gameRevenue: pay, deadlineHours: 30, ...extra });

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'E. Xpiry', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 1 });
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  const standing = () => api('/bootstrap').then((x) => x.directory.find((b) => b.id === starter.id).standing);

  head('1. Two listings about to go');
  // A starter offers the bottom half by what a job leaves per day: the two cheap ones, both nearly off the board.
  await api('/board/add-many', 'POST', [
    job('Paper', 'Topeka', 'KS', 70, 200, { expiresInHours: 0.6 }),
    job('Corn', 'Topeka', 'KS', 70, 210, { expiresInHours: 0.7 }),
    job('Lumber', 'Wichita', 'KS', 200, 1200), job('Steel', 'Wichita', 'KS', 200, 1300),
  ]);
  const before = await standing();
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  const first = r.call.load.cargo;
  ok('the broker warns it is about to come off the board', /comes off the board in 0:[34]\d/.test(said(r)) && r.call.listingLeftHours < 0.75, said(r));
  const mood = r.call.mood;
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'toolate' });
  ok('"can\'t make it": another job, no fuss', r.call.status === 'Open' && r.call.load.cargo !== first && /somebody closer/.test(said(r)), said(r));
  ok('and that one is warned about too', /comes off the board/.test(said(r)), said(r));
  ok('no patience lost', r.call.mood === mood, `${mood} -> ${r.call.mood}`);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'toolate' });
  ok('the last of them: the broker says so', r.call.status === 'Nothing' && /last I had/.test(said(r)), said(r));
  ok('and holds nothing against you', (await standing()) === before, `${before} -> ${await standing()}`);

  head('2. A window you cannot make, on a listing with time on it');
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [job('Paper', 'Topeka', 'KS', 70, 380)]);
  r = await api('/calls', 'POST', { brokerId: starter.id });
  ok('no warning', !/comes off the board/.test(said(r)) && r.call.listingLeftHours == null, said(r));
  const standing2 = await standing();
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'toolate' });
  ok('"can\'t make it" works on any job: dropped, nothing else here', r.call.status === 'Nothing' && /last I had/.test(said(r)), said(r));
  ok('and where the plan had you making it easily, check where the app has you', r.call.checkPosition && /check where/.test(said(r)));
  ok('no penalty', (await standing()) === standing2);
  const other = (await api('/bootstrap')).directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou && b.id !== starter.id);
  r = await api('/calls', 'POST', { brokerId: other.id });
  ok('off the table for every broker', r.call.status === 'Nothing', said(r));
  ok('and marked on the board', r.snapshot.board[0].notes.some((n) => /could not get there in time/.test(n)));

  head('3. The dock you are at');
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [job('Paper', 'Topeka', 'KS', 70, 380, { receiver: 'Wallbert' })]);
  r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 3, time: '07:00' });
  await api('/run/loaded', 'POST', { day: 3, time: '07:30', odometer: 1000 });
  await api('/deliver', 'POST', { day: 3, time: '09:00', odometer: 1070 });
  S = await api('/status', 'POST', { locationCity: 'Topeka', locationState: 'KS', day: 3, time: '10:00' });
  // The Wallbert job leaves the least per day of the bottom half, but it is the dock the truck is standing at.
  await api('/board/add-many', 'POST', [
    job('Furniture', 'Wichita', 'KS', 140, 500, { shipper: 'Wallbert' }), job('Canned Beans', 'Wichita', 'KS', 140, 520, { shipper: 'Shop Town' }),
    job('Lumber', 'Salina', 'KS', 110, 900), job('Steel', 'Salina', 'KS', 110, 950),
  ]);
  const b3 = (await api('/bootstrap')).directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  r = await api('/calls', 'POST', { brokerId: b3.id });
  ok('the broker offers the Wallbert job, and says why', r.call.load.shipper === 'Wallbert' && /right there/.test(said(r)), said(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
