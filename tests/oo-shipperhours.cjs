/* Owner-Operator 0.9: the shipper is open for a job taken off the board.
 *
 * Reported from play: at the shipper, told they were shut and did not open until the next day. A site keeps working
 * hours in the company-driver app, but an owner/operator takes the job live off the game's board, where the window is
 * already running: no window survives a shipper shut until morning. The freight can still be late off the line.
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

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'N. Ight', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '01:30',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 10000, preset: 'Normal' });

  head('1. A site load, booked in the middle of the night');
  await api('/board/add-many', 'POST', [
    { cargo: 'Lumber', trailerType: 'Flatbed', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 900, deadlineHours: 12, shipper: 'Sawmill', receiver: 'Builder' },
  ]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  ok('booked', S.trip && S.trip.number === S.booking.number, S.booking?.number);

  head('2. At the shipper at 2 AM');
  r = await api('/run/at-shipper', 'POST', { day: 3, time: '02:00' });
  const t = r.snapshot.trip;
  ok('not shut', t.shipperCallKind !== 'Closed' && !/shut|do not open/i.test(r.said), `${t.shipperCallKind}: ${r.said}`);
  ok('and no wait for opening hours: at most the freight being late off the line', (r.call?.waitHours ?? 0) <= 3, String(r.call?.waitHours));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
